import { startTransition, useEffect, useMemo, useState } from "react";

import ThemeToggle from "./components/ThemeToggle";
import { isDesignPreview } from "./designPreview";
import { api } from "./services/api";
import type {
  AssignmentDraft,
  AuthUser,
  BootstrapPayload,
  Group,
  GroupDraft,
  RoleCapability,
  Settings,
  ShopItem,
  ShopItemDraft,
  Submission,
} from "./types";
import { fromDateTimeLocalInputValue, toDateTimeLocalInputValue } from "./utils/datetime-local";
import "./styles/app.css";

type CapabilityToggleKey = keyof Pick<
  RoleCapability,
  | "canManageDashboard"
  | "canAward"
  | "canDeduct"
  | "canMultiAward"
  | "canSell"
  | "canReceiveAwards"
  | "isGroupRole"
>;

const CAPABILITY_COLUMNS: Array<{ key: CapabilityToggleKey; header: string; abbr: string }> = [
  { key: "canManageDashboard", header: "Manage dashboard", abbr: "Dash" },
  { key: "canAward", header: "Award", abbr: "Award" },
  { key: "canDeduct", header: "Deduct", abbr: "Deduct" },
  { key: "canMultiAward", header: "Multi-target award", abbr: "Multi" },
  { key: "canSell", header: "Sell", abbr: "Sell" },
  { key: "canReceiveAwards", header: "Receivable", abbr: "Recv" },
  { key: "isGroupRole", header: "Group role", abbr: "Group" },
];

function getInitialStatus() {
  if (typeof window === "undefined") {
    return "Sign in with Discord to configure the bot.";
  }

  const url = new URL(window.location.href);
  const authError = url.searchParams.get("auth_error");
  if (!authError) {
    return "Sign in with Discord to configure the bot.";
  }

  url.searchParams.delete("auth_error");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  return authError;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toGroupDraft(group?: Group): GroupDraft {
  if (!group) {
    return {
      displayName: "",
      slug: "",
      mentorName: "",
      roleId: "",
      aliasesText: "",
      active: true,
    };
  }

  return {
    id: group.id,
    displayName: group.displayName,
    slug: group.slug,
    mentorName: group.mentorName,
    roleId: group.roleId,
    aliasesText: group.aliases.map((alias) => alias.value).join(", "),
    active: group.active,
  };
}

function toShopItemDraft(item?: ShopItem): ShopItemDraft {
  if (!item) {
    return {
      name: "",
      description: "",
      currencyCost: 0,
      stock: null,
      enabled: true,
      fulfillmentInstructions: "",
    };
  }

  return {
    id: item.id,
    name: item.name,
    description: item.description,
    currencyCost: item.currencyCost,
    stock: item.stock,
    enabled: item.enabled,
    fulfillmentInstructions: item.fulfillmentInstructions,
  };
}

function toAssignmentDraft(assignment?: { id: string; title: string; description: string; baseCurrencyReward: number; basePointsReward: number; bonusCurrencyReward: number; bonusPointsReward: number; deadline: string | null; active: boolean; sortOrder: number }): AssignmentDraft {
  if (!assignment) {
    return {
      title: "",
      description: "",
      baseCurrencyReward: 0,
      basePointsReward: 0,
      bonusCurrencyReward: 0,
      bonusPointsReward: 0,
      deadline: null,
      active: true,
      sortOrder: 0,
    };
  }

  return {
    id: assignment.id,
    title: assignment.title,
    description: assignment.description,
    baseCurrencyReward: assignment.baseCurrencyReward,
    basePointsReward: assignment.basePointsReward,
    bonusCurrencyReward: assignment.bonusCurrencyReward,
    bonusPointsReward: assignment.bonusPointsReward,
    deadline: assignment.deadline,
    active: assignment.active,
    sortOrder: assignment.sortOrder,
  };
}

const STATUS_LABELS: Record<Submission["status"], string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  OUTSTANDING: "Outstanding",
  REJECTED: "Rejected",
};

const STATUS_CLASSES: Record<Submission["status"], string> = {
  PENDING: "badge--pending",
  APPROVED: "badge--approved",
  OUTSTANDING: "badge--outstanding",
  REJECTED: "badge--rejected",
};

export default function App() {
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<RoleCapability[]>([]);
  const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([]);
  const [shopDrafts, setShopDrafts] = useState<ShopItemDraft[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([]);
  const [submissionFilter, setSubmissionFilter] = useState<{ assignmentId: string; status: string }>({ assignmentId: "", status: "" });
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [status, setStatus] = useState(getInitialStatus);
  const [isBusy, setIsBusy] = useState(false);

  const discordRoles = bootstrap?.discord.roles ?? [];
  const discordChannels = bootstrap?.discord.channels ?? [];

  const loadBootstrap = async () => {
    setIsBusy(true);
    try {
      const payload = await api.bootstrap();
      startTransition(() => {
        setBootstrap(payload);
        setSettingsDraft(payload.settings);
        setRoleDrafts(payload.capabilities);
        setGroupDrafts([...payload.groups.map((group) => toGroupDraft(group)), toGroupDraft()]);
        setShopDrafts([...payload.shopItems.map((item) => toShopItemDraft(item)), toShopItemDraft()]);
        setAssignmentDrafts([...payload.assignments.map((a) => toAssignmentDraft(a)), toAssignmentDraft()]);
      });
      setStatus("Dashboard synced.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load dashboard data.");
      throw error;
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrapDashboard = async () => {
      setIsBusy(true);
      try {
        const session = await api.session();
        if (!session.authenticated || !session.user) {
          if (!cancelled) {
            setSessionUser(null);
            setBootstrap(null);
            setSettingsDraft(null);
          }
          return;
        }

        if (!cancelled) {
          setSessionUser(session.user);
        }

        await loadBootstrap();
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not load the dashboard.");
          setSessionUser(null);
        }
      } finally {
        if (!cancelled && !bootstrap) {
          setIsBusy(false);
        }
      }
    };

    void bootstrapDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const roleOptions = useMemo(
    () =>
      discordRoles.map((role) => (
        <option key={role.id} value={role.id}>
          {role.name}
        </option>
      )),
    [discordRoles],
  );

  const channelOptions = useMemo(
    () =>
      discordChannels.map((channel) => (
        <option key={channel.id} value={channel.id}>
          {channel.name}
        </option>
      )),
    [discordChannels],
  );

  const handleLogin = () => {
    setStatus("Redirecting to Discord...");
    api.beginDiscordLogin();
  };

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    setSessionUser(null);
    setBootstrap(null);
    setStatus("Signed out.");
  };

  return (
    <main className="shell">
      <div className="shell-toolbar">
        <ThemeToggle />
      </div>
      {!bootstrap || !settingsDraft ? (
          <section className="login-page">
            <header className="login-hero">
              <h1>points accelerator</h1>
              <p className="lede">
                Group rewards, transfers, shop pricing, role capabilities, and passive chat earn rates all live here.
              </p>
            </header>

            <article className="login-card">
              <h2>Discord Sign-In</h2>
              <p>
                Use your Discord account for the configured server. Dashboard access follows your current guild permissions
                and any roles marked with <strong>manage dashboard</strong>.
              </p>
              <button onClick={handleLogin} disabled={isBusy}>
                {isBusy ? "Redirecting..." : "Sign In with Discord"}
              </button>
              <p className="status-bar">{status}</p>
            </article>
          </section>
        ) : (
          <>
      {isDesignPreview() ? (
        <p className="design-preview-banner" role="status">
          Design preview: local mock data only. No backend or Discord required; saves stay in this browser session.
        </p>
      ) : null}
      <header className="topbar">
        <hgroup className="topbar-brand">
          <h1>{bootstrap.settings.appName}</h1>
          <p>Manage groups, roles, shop, and economy settings.</p>
        </hgroup>
        <div className="topbar-right">
          {sessionUser ? (
            <p className="session-badge">
              {sessionUser.avatarUrl ? <img src={sessionUser.avatarUrl} alt="" /> : null}
              <strong>{sessionUser.displayName}</strong>
            </p>
          ) : null}
          <button
            onClick={() => void loadBootstrap().catch(() => undefined)}
            disabled={isBusy}
          >
            Refresh
          </button>
          {isDesignPreview() ? null : (
            <button onClick={() => void handleLogout()}>Sign Out</button>
          )}
        </div>
      </header>

      <dl className="stats-row">
        <div className="stat-item">
          <dt>Groups</dt>
          <dd>{bootstrap.groups.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Participants</dt>
          <dd>{bootstrap.participants.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Assignments</dt>
          <dd>{bootstrap.assignments.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Submissions</dt>
          <dd>{bootstrap.submissions.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Shop Items</dt>
          <dd>{bootstrap.shopItems.length}</dd>
        </div>
      </dl>

      <section className="walkthrough-section">
        <header className="section-header">
          <hgroup>
            <p className="section-label">Phase 1</p>
            <h2>Class launch walkthrough</h2>
          </hgroup>
        </header>
        <ol className="walkthrough">
          <li>
            <h3>Give staff roles their powers</h3>
            <p>
              In <strong>Capability matrix</strong>, add your admin, mentor, and alumni roles, then turn on the powers
              each role should have. Leave <strong>max award</strong> blank for no cap, or set a number if you want a
              hard limit per command.
            </p>
          </li>
          <li>
            <h3>Map every student team to a Discord role</h3>
            <p>
              In <strong>Role mapping</strong>, create one group per student role. Students can only use{" "}
              <code>/balance</code> when their Discord role maps to exactly one active group.
            </p>
          </li>
          <li>
            <h3>Name the economy once</h3>
            <p>
              In <strong>Economy shape</strong>, set the labels for <strong>{settingsDraft.pointsName}</strong> and{" "}
              <strong>{settingsDraft.currencyName}</strong>, plus any passive earning rules you want before class starts.
            </p>
          </li>
          <li>
            <h3>Smoke test the class commands in Discord</h3>
            <p>
              Staff should test award and deduct flows with a reason. Students should test their own balance, the shared
              leaderboard, and the paged ledger feed.
            </p>
          </li>
        </ol>
        <p className="walkthrough-commands">
          <code>/award targets:@gryffindor points:5 reason:"helped another group"</code>
          <code>/deduct targets:@gryffindor points:2 reason:"late submission"</code>
          <code>/balance</code>
          <code>/leaderboard</code>
          <code>/ledger</code>
          <code>/ledger page:2</code>
        </p>
      </section>

      <section className="two-col" style={{ marginTop: "1rem" }}>
        <article className="section">
          <header className="section-header">
            <hgroup>
              <p className="section-label">Settings</p>
              <h2>Economy shape</h2>
            </hgroup>
            <button
              className="primary-action"
              onClick={async () => {
                if (!settingsDraft) return;
                setIsBusy(true);
                try {
                  await api.saveSettings(settingsDraft);
                  await loadBootstrap();
                  setStatus("Settings saved.");
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : "Failed to save settings.");
                } finally {
                  setIsBusy(false);
                }
              }}
            >
              Save Settings
            </button>
          </header>

          <div className="form-grid">
            <label>
              App name
              <input
                value={settingsDraft.appName}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, appName: event.target.value })}
              />
            </label>
            <label>
              Points label
              <input
                value={settingsDraft.pointsName}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, pointsName: event.target.value })}
              />
            </label>
            <label>
              Currency label
              <input
                value={settingsDraft.currencyName}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, currencyName: event.target.value })}
              />
            </label>
            <label>
              Message points reward
              <input
                type="number"
                value={settingsDraft.passivePointsReward}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, passivePointsReward: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Message currency reward
              <input
                type="number"
                value={settingsDraft.passiveCurrencyReward}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, passiveCurrencyReward: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Cooldown seconds
              <input
                type="number"
                value={settingsDraft.passiveCooldownSeconds}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, passiveCooldownSeconds: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Min characters
              <input
                type="number"
                value={settingsDraft.passiveMinimumCharacters}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, passiveMinimumCharacters: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Economy mode
              <select
                value={settingsDraft.economyMode}
                onChange={(event) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    economyMode: event.target.value as Settings["economyMode"],
                  })
                }
              >
                <option value="SIMPLE">Simple</option>
                <option value="ADVANCED">Advanced</option>
              </select>
            </label>
            <label>
              Listing channel
              <select
                value={settingsDraft.listingChannelId ?? ""}
                onChange={(event) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    listingChannelId: event.target.value || null,
                  })
                }
              >
                <option value="">Unset</option>
                {channelOptions}
              </select>
            </label>
            <label>
              Redemption channel
              <select
                value={settingsDraft.redemptionChannelId ?? ""}
                onChange={(event) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    redemptionChannelId: event.target.value || null,
                  })
                }
              >
                <option value="">Unset</option>
                {channelOptions}
              </select>
            </label>
            <label>
              Log channel
              <select
                value={settingsDraft.commandLogChannelId ?? ""}
                onChange={(event) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    commandLogChannelId: event.target.value || null,
                  })
                }
              >
                <option value="">Unset</option>
                {channelOptions}
              </select>
            </label>
            <label className="span-2">
              Allowed passive channels
              <input
                value={settingsDraft.passiveAllowedChannelIds.join(", ")}
                onChange={(event) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    passiveAllowedChannelIds: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="comma-separated channel ids"
              />
            </label>
            <label className="span-2">
              Denied passive channels
              <input
                value={settingsDraft.passiveDeniedChannelIds.join(", ")}
                onChange={(event) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    passiveDeniedChannelIds: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="comma-separated channel ids"
              />
            </label>
          </div>
        </article>

        <article className="section">
          <header className="section-header">
            <hgroup>
              <p className="section-label">Roles</p>
              <h2>Capability matrix</h2>
            </hgroup>
            <button
              className="primary-action"
              onClick={async () => {
                setIsBusy(true);
                try {
                  await api.saveCapabilities(
                    roleDrafts.filter((role) => role.roleId.trim().length > 0 && role.roleName.trim().length > 0),
                  );
                  await loadBootstrap();
                  setStatus("Role capabilities saved.");
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : "Failed to save role capabilities.");
                } finally {
                  setIsBusy(false);
                }
              }}
            >
              Save Roles
            </button>
          </header>

          <details className="capability-help">
            <summary>What do these columns mean?</summary>
            <dl>
              <dt>Dash</dt>
              <dd>Can access and manage this dashboard.</dd>
              <dt>Award</dt>
              <dd>Can give points/currency to groups.</dd>
              <dt>Max award</dt>
              <dd>Upper limit per award (blank = unlimited).</dd>
              <dt>Deduct</dt>
              <dd>Can subtract points/currency from groups.</dd>
              <dt>Multi</dt>
              <dd>Can award multiple groups at once.</dd>
              <dt>Sell</dt>
              <dd>Can create marketplace listings.</dd>
              <dt>Recv</dt>
              <dd>Groups with this role can receive awards.</dd>
              <dt>Group</dt>
              <dd>Marks a Discord role as a student group.</dd>
            </dl>
          </details>

          <div className="capability-matrix">
            <div className="matrix-scroll">
              <table className="matrix-table capability-table">
                <thead>
                  <tr>
                    <th scope="col" className="capability-table__role">
                      Discord role
                    </th>
                    <th scope="col" className="capability-table__label">
                      Label
                    </th>
                    <th scope="col" className="capability-table__max">
                      Max award
                    </th>
                    {CAPABILITY_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className="capability-table__cap"
                        title={col.header}
                      >
                        <span className="capability-table__abbr">{col.abbr}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roleDrafts.map((role, index) => (
                    <tr key={`${role.roleId}-${index}`}>
                      <td>
                        <select
                          value={role.roleId}
                          aria-label="Discord role"
                          onChange={(event) => {
                            const selected = discordRoles.find((candidate) => candidate.id === event.target.value);
                            const next = [...roleDrafts];
                            next[index] = {
                              ...role,
                              roleId: event.target.value,
                              roleName: selected?.name ?? role.roleName,
                            };
                            setRoleDrafts(next);
                          }}
                        >
                          <option value="">Select role</option>
                          {roleOptions}
                        </select>
                      </td>
                      <td>
                        <input
                          value={role.roleName}
                          aria-label="Role label"
                          onChange={(event) => {
                            const next = [...roleDrafts];
                            next[index] = { ...role, roleName: event.target.value };
                            setRoleDrafts(next);
                          }}
                          placeholder="Display label"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={role.maxAward ?? ""}
                          aria-label="Max award"
                          onChange={(event) => {
                            const next = [...roleDrafts];
                            next[index] = { ...role, maxAward: event.target.value ? Number(event.target.value) : null };
                            setRoleDrafts(next);
                          }}
                          placeholder="—"
                        />
                      </td>
                      {CAPABILITY_COLUMNS.map((col) => (
                        <td key={col.key} className="capability-table__cap">
                          <input
                            type="checkbox"
                            checked={role[col.key]}
                            aria-label={col.header}
                            onChange={(event) => {
                              const next = [...roleDrafts];
                              next[index] = { ...role, [col.key]: event.target.checked };
                              setRoleDrafts(next);
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="capability-matrix-add">
              <button
                type="button"
                onClick={() =>
                  setRoleDrafts([
                    ...roleDrafts,
                    {
                      roleId: "",
                      roleName: "",
                      canManageDashboard: false,
                      canAward: false,
                      maxAward: null,
                      canDeduct: false,
                      canMultiAward: false,
                      canSell: false,
                      canReceiveAwards: true,
                      isGroupRole: false,
                    },
                  ])
                }
              >
                Add Role Rule
              </button>
            </div>
          </div>
        </article>
      </section>

      <section className="two-col">
        <article className="section">
          <header className="section-header">
            <hgroup>
              <p className="section-label">Groups</p>
              <h2>Role mapping</h2>
            </hgroup>
            <button
              className="primary-action"
              onClick={async () => {
                setIsBusy(true);
                try {
                  const validGroups = groupDrafts.filter(
                    (group) => group.displayName.trim().length > 0 && group.roleId.trim().length > 0,
                  );
                  for (const group of validGroups) {
                    await api.saveGroup(group);
                  }
                  await loadBootstrap();
                  setStatus(`Saved ${validGroups.length} group${validGroups.length === 1 ? "" : "s"}.`);
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : "Failed to save groups.");
                } finally {
                  setIsBusy(false);
                }
              }}
            >
              Save Groups
            </button>
          </header>
          <div className="group-mapping-matrix">
            <div className="matrix-scroll">
              <table className="matrix-table group-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-role">
                      Discord role
                    </th>
                    <th scope="col" className="col-display">
                      Display name
                    </th>
                    <th scope="col" className="col-aliases">
                      Aliases
                    </th>
                    <th scope="col" className="matrix-table__th--center col-active">
                      Active
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupDrafts.map((group, index) => (
                    <tr key={`${group.id ?? "new"}-${index}`}>
                      <td className="col-role">
                        <select
                          value={group.roleId}
                          aria-label="Discord role"
                          onChange={(event) => {
                            const selected = discordRoles.find((candidate) => candidate.id === event.target.value);
                            const next = [...groupDrafts];
                            const displayName = selected?.name ?? group.displayName;
                            const slug = group.slug || slugify(displayName);
                            next[index] = {
                              ...group,
                              roleId: event.target.value,
                              displayName,
                              slug,
                            };
                            setGroupDrafts(next);
                          }}
                        >
                          <option value="">Select role</option>
                          {roleOptions}
                        </select>
                      </td>
                      <td className="col-display">
                        <input
                          value={group.displayName}
                          aria-label="Display name"
                          onChange={(event) => {
                            const next = [...groupDrafts];
                            next[index] = { ...group, displayName: event.target.value };
                            setGroupDrafts(next);
                          }}
                          placeholder="Team name"
                        />
                      </td>
                      <td className="col-aliases">
                        <input
                          value={group.aliasesText}
                          aria-label="Aliases"
                          onChange={(event) => {
                            const next = [...groupDrafts];
                            next[index] = { ...group, aliasesText: event.target.value };
                            setGroupDrafts(next);
                          }}
                          placeholder="comma separated"
                        />
                      </td>
                      <td className="col-active">
                        <input
                          type="checkbox"
                          checked={group.active}
                          aria-label="Active"
                          onChange={(event) => {
                            const next = [...groupDrafts];
                            next[index] = { ...group, active: event.target.checked };
                            setGroupDrafts(next);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>

        <article className="section">
          <header className="section-header">
            <hgroup>
              <p className="section-label">Shop</p>
              <h2>Catalog</h2>
            </hgroup>
          </header>
          <div className="shop-catalog-matrix">
            <div className="matrix-scroll">
              <table className="matrix-table shop-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-name">
                      Name
                    </th>
                    <th scope="col" className="col-description">
                      Description
                    </th>
                    <th scope="col" className="col-cost">
                      Cost
                    </th>
                    <th scope="col" className="col-stock">
                      Stock
                    </th>
                    <th scope="col" className="col-fulfil">
                      Fulfilment
                    </th>
                    <th scope="col" className="matrix-table__th--center col-enabled">
                      Enabled
                    </th>
                    <th scope="col" className="matrix-table__th--actions col-actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shopDrafts.map((item, index) => (
                    <tr key={`${item.id ?? "new"}-${index}`}>
                      <td className="col-name">
                        <input
                          value={item.name}
                          aria-label="Item name"
                          onChange={(event) => {
                            const next = [...shopDrafts];
                            next[index] = { ...item, name: event.target.value };
                            setShopDrafts(next);
                          }}
                          placeholder="Item name"
                        />
                      </td>
                      <td className="col-description">
                        <input
                          value={item.description}
                          aria-label="Description"
                          onChange={(event) => {
                            const next = [...shopDrafts];
                            next[index] = { ...item, description: event.target.value };
                            setShopDrafts(next);
                          }}
                          placeholder="Shown in the shop"
                        />
                      </td>
                      <td className="col-cost">
                        <input
                          type="number"
                          value={item.currencyCost}
                          aria-label="Cost in currency"
                          onChange={(event) => {
                            const next = [...shopDrafts];
                            next[index] = { ...item, currencyCost: Number(event.target.value) };
                            setShopDrafts(next);
                          }}
                          placeholder="0"
                        />
                      </td>
                      <td className="col-stock">
                        <input
                          type="number"
                          value={item.stock ?? ""}
                          aria-label="Stock"
                          onChange={(event) => {
                            const next = [...shopDrafts];
                            next[index] = { ...item, stock: event.target.value ? Number(event.target.value) : null };
                            setShopDrafts(next);
                          }}
                          placeholder="∞"
                        />
                      </td>
                      <td className="col-fulfil">
                        <input
                          value={item.fulfillmentInstructions ?? ""}
                          aria-label="Fulfilment notes"
                          onChange={(event) => {
                            const next = [...shopDrafts];
                            next[index] = { ...item, fulfillmentInstructions: event.target.value };
                            setShopDrafts(next);
                          }}
                          placeholder="How to redeem"
                        />
                      </td>
                      <td className="col-enabled">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          aria-label="Enabled"
                          onChange={(event) => {
                            const next = [...shopDrafts];
                            next[index] = { ...item, enabled: event.target.checked };
                            setShopDrafts(next);
                          }}
                        />
                      </td>
                      <td className="col-actions">
                        <button
                          type="button"
                          onClick={async () => {
                            setIsBusy(true);
                            try {
                              await api.saveShopItem(item);
                              await loadBootstrap();
                              setStatus(`Saved ${item.name || "shop item"}.`);
                            } catch (error) {
                              setStatus(error instanceof Error ? error.message : "Failed to save shop item.");
                            } finally {
                              setIsBusy(false);
                            }
                          }}
                          disabled={!item.name || !item.description}
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>

      <section className="two-col">
        <article className="section">
          <header className="section-header">
            <hgroup>
              <p className="section-label">Assignments</p>
              <h2>Submission prompts</h2>
            </hgroup>
          </header>
          <p className="section-help">
            Create assignments that students can submit work for via <code>/submit</code> in Discord.
            Set base and bonus rewards; bonus rewards are given when a submission is marked as outstanding.
          </p>
          <div className="matrix-scroll">
            <table className="matrix-table assignment-table">
              <thead>
                <tr>
                  <th scope="col" className="col-title">Title</th>
                  <th scope="col" className="col-description">Description</th>
                  <th scope="col" className="col-pts">Base Pts</th>
                  <th scope="col" className="col-cur">Base Cur</th>
                  <th scope="col" className="col-pts">Bonus Pts</th>
                  <th scope="col" className="col-cur">Bonus Cur</th>
                  <th scope="col" className="col-deadline">Deadline</th>
                  <th scope="col" className="matrix-table__th--center col-active">Active</th>
                  <th scope="col" className="matrix-table__th--actions col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignmentDrafts.map((assignment, index) => (
                  <tr key={`${assignment.id ?? "new"}-${index}`}>
                    <td className="col-title">
                      <input
                        value={assignment.title}
                        aria-label="Title"
                        onChange={(event) => {
                          const next = [...assignmentDrafts];
                          next[index] = { ...assignment, title: event.target.value };
                          setAssignmentDrafts(next);
                        }}
                        placeholder="Assignment title"
                      />
                    </td>
                    <td className="col-description">
                      <input
                        value={assignment.description}
                        aria-label="Description"
                        onChange={(event) => {
                          const next = [...assignmentDrafts];
                          next[index] = { ...assignment, description: event.target.value };
                          setAssignmentDrafts(next);
                        }}
                        placeholder="Instructions"
                      />
                    </td>
                    <td className="col-pts">
                      <input
                        type="number"
                        value={assignment.basePointsReward}
                        aria-label="Base points"
                        onChange={(event) => {
                          const next = [...assignmentDrafts];
                          next[index] = { ...assignment, basePointsReward: Number(event.target.value) };
                          setAssignmentDrafts(next);
                        }}
                      />
                    </td>
                    <td className="col-cur">
                      <input
                        type="number"
                        value={assignment.baseCurrencyReward}
                        aria-label="Base currency"
                        onChange={(event) => {
                          const next = [...assignmentDrafts];
                          next[index] = { ...assignment, baseCurrencyReward: Number(event.target.value) };
                          setAssignmentDrafts(next);
                        }}
                      />
                    </td>
                    <td className="col-pts">
                      <input
                        type="number"
                        value={assignment.bonusPointsReward}
                        aria-label="Bonus points"
                        onChange={(event) => {
                          const next = [...assignmentDrafts];
                          next[index] = { ...assignment, bonusPointsReward: Number(event.target.value) };
                          setAssignmentDrafts(next);
                        }}
                      />
                    </td>
                    <td className="col-cur">
                      <input
                        type="number"
                        value={assignment.bonusCurrencyReward}
                        aria-label="Bonus currency"
                        onChange={(event) => {
                          const next = [...assignmentDrafts];
                          next[index] = { ...assignment, bonusCurrencyReward: Number(event.target.value) };
                          setAssignmentDrafts(next);
                        }}
                      />
                    </td>
                    <td className="col-deadline">
                      <input
                        type="datetime-local"
                        value={toDateTimeLocalInputValue(assignment.deadline)}
                        aria-label="Deadline"
                        onChange={(event) => {
                          const next = [...assignmentDrafts];
                          next[index] = {
                            ...assignment,
                            deadline: fromDateTimeLocalInputValue(event.target.value),
                          };
                          setAssignmentDrafts(next);
                        }}
                      />
                    </td>
                    <td className="col-active">
                      <input
                        type="checkbox"
                        checked={assignment.active}
                        aria-label="Active"
                        onChange={(event) => {
                          const next = [...assignmentDrafts];
                          next[index] = { ...assignment, active: event.target.checked };
                          setAssignmentDrafts(next);
                        }}
                      />
                    </td>
                    <td className="col-actions">
                      <button
                        type="button"
                        onClick={async () => {
                          setIsBusy(true);
                          try {
                            await api.saveAssignment(assignment);
                            await loadBootstrap();
                            setStatus(`Saved assignment "${assignment.title || "untitled"}".`);
                          } catch (error) {
                            setStatus(error instanceof Error ? error.message : "Failed to save assignment.");
                          } finally {
                            setIsBusy(false);
                          }
                        }}
                        disabled={!assignment.title}
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="section">
          <header className="section-header">
            <hgroup>
              <p className="section-label">Participants</p>
              <h2>Registered students</h2>
            </hgroup>
          </header>
          <p className="section-help">
            Students register via <code>/register index_id:&lt;id&gt; group:&lt;name&gt;</code> in Discord.
            Once registered, they can use <code>/submit</code> to submit work.
          </p>
          <div className="matrix-scroll">
            <table className="matrix-table participant-table">
              <thead>
                <tr>
                  <th scope="col">Index ID</th>
                  <th scope="col">Discord user</th>
                  <th scope="col">Group</th>
                  <th scope="col">Registered</th>
                </tr>
              </thead>
              <tbody>
                {bootstrap.participants.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">No participants registered yet.</td>
                  </tr>
                ) : (
                  bootstrap.participants.map((participant) => (
                    <tr key={participant.id}>
                      <td>{participant.indexId}</td>
                      <td>{participant.discordUsername ?? participant.discordUserId}</td>
                      <td>{participant.group.displayName}</td>
                      <td>
                        <time dateTime={participant.createdAt}>{new Date(participant.createdAt).toLocaleDateString()}</time>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="section submissions-section">
        <header className="section-header">
          <hgroup>
            <p className="section-label">Review</p>
            <h2>Submissions</h2>
          </hgroup>
          <div className="submission-filters">
            <select
              value={submissionFilter.assignmentId}
              onChange={(event) => setSubmissionFilter({ ...submissionFilter, assignmentId: event.target.value })}
              aria-label="Filter by assignment"
            >
              <option value="">All assignments</option>
              {bootstrap.assignments.map((a) => (
                <option key={a.id} value={a.id}>{a.title}</option>
              ))}
            </select>
            <select
              value={submissionFilter.status}
              onChange={(event) => setSubmissionFilter({ ...submissionFilter, status: event.target.value })}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="OUTSTANDING">Outstanding</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </header>

        <div className="matrix-scroll">
          <table className="matrix-table submissions-table">
            <thead>
              <tr>
                <th scope="col">Assignment</th>
                <th scope="col">Student</th>
                <th scope="col">Group</th>
                <th scope="col">Text</th>
                <th scope="col">Image</th>
                <th scope="col">Status</th>
                <th scope="col">Submitted</th>
                <th scope="col" className="matrix-table__th--actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filtered = bootstrap.submissions.filter((sub) => {
                  if (submissionFilter.assignmentId && sub.assignmentId !== submissionFilter.assignmentId) return false;
                  if (submissionFilter.status && sub.status !== submissionFilter.status) return false;
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <tr>
                      <td colSpan={8} className="empty-cell">No submissions match the current filters.</td>
                    </tr>
                  );
                }

                return filtered.map((sub) => (
                  <tr key={sub.id}>
                    <td>{sub.assignment.title}</td>
                    <td>{sub.participant.discordUsername ?? sub.participant.indexId}</td>
                    <td>{sub.participant.group.displayName}</td>
                    <td className="submission-text-cell" title={sub.text}>
                      {sub.text.length > 80 ? `${sub.text.slice(0, 80)}...` : sub.text || "\u2014"}
                    </td>
                    <td>
                      {sub.imageUrl ? (
                        <a href={sub.imageUrl} target="_blank" rel="noopener noreferrer" className="submission-image-link">
                          <img src={sub.imageUrl} alt="Submission" className="submission-thumbnail" />
                        </a>
                      ) : (
                        "\u2014"
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CLASSES[sub.status]}`}>{STATUS_LABELS[sub.status]}</span>
                    </td>
                    <td>
                      <time dateTime={sub.createdAt}>{new Date(sub.createdAt).toLocaleDateString()}</time>
                    </td>
                    <td className="col-actions submission-actions">
                      {sub.status === "PENDING" ? (
                        reviewingId === sub.id ? (
                          <div className="review-buttons">
                            <button
                              className="btn-approve"
                              onClick={async () => {
                                setIsBusy(true);
                                try {
                                  await api.reviewSubmission(sub.id, { status: "APPROVED" });
                                  setReviewingId(null);
                                  await loadBootstrap();
                                  setStatus(`Approved submission from ${sub.participant.discordUsername ?? sub.participant.indexId}.`);
                                } catch (error) {
                                  setStatus(error instanceof Error ? error.message : "Failed to approve.");
                                } finally {
                                  setIsBusy(false);
                                }
                              }}
                              disabled={isBusy}
                            >
                              Approve
                            </button>
                            <button
                              className="btn-outstanding"
                              onClick={async () => {
                                setIsBusy(true);
                                try {
                                  await api.reviewSubmission(sub.id, { status: "OUTSTANDING" });
                                  setReviewingId(null);
                                  await loadBootstrap();
                                  setStatus(`Marked outstanding: ${sub.participant.discordUsername ?? sub.participant.indexId}.`);
                                } catch (error) {
                                  setStatus(error instanceof Error ? error.message : "Failed to mark outstanding.");
                                } finally {
                                  setIsBusy(false);
                                }
                              }}
                              disabled={isBusy}
                            >
                              Outstanding
                            </button>
                            <button
                              className="btn-reject"
                              onClick={async () => {
                                setIsBusy(true);
                                try {
                                  await api.reviewSubmission(sub.id, { status: "REJECTED" });
                                  setReviewingId(null);
                                  await loadBootstrap();
                                  setStatus(`Rejected submission from ${sub.participant.discordUsername ?? sub.participant.indexId}.`);
                                } catch (error) {
                                  setStatus(error instanceof Error ? error.message : "Failed to reject.");
                                } finally {
                                  setIsBusy(false);
                                }
                              }}
                              disabled={isBusy}
                            >
                              Reject
                            </button>
                            <button onClick={() => setReviewingId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setReviewingId(sub.id)}>Review</button>
                        )
                      ) : (
                        <span className="review-done">
                          {sub.reviewedByUsername ? `by ${sub.reviewedByUsername}` : "Reviewed"}
                          {sub.pointsAwarded || sub.currencyAwarded
                            ? ` (+${sub.pointsAwarded ?? 0}pts, +${sub.currencyAwarded ?? 0}cur)`
                            : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section leaderboard-section">
        <header className="section-header">
          <hgroup>
            <p className="section-label">Live view</p>
            <h2>Leaderboard and activity</h2>
          </hgroup>
        </header>

        <section aria-labelledby="leaderboard-heading" className="leaderboard-panel">
          <h3 id="leaderboard-heading">Leaderboard</h3>
          <div className="matrix-scroll matrix-scroll--flush">
            <table className="matrix-table leaderboard-table">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Points</th>
                  <th scope="col">Currency</th>
                </tr>
              </thead>
              <tbody>
                {bootstrap.leaderboard.map((group) => (
                  <tr key={group.id}>
                    <td>{group.displayName}</td>
                    <td className="leaderboard-table__num">{group.pointsBalance}</td>
                    <td className="leaderboard-table__num">{group.currencyBalance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section aria-labelledby="ledger-heading" className="ledger-panel">
          <h3 id="ledger-heading">Ledger</h3>
          <div className="matrix-scroll matrix-scroll--flush">
            <table className="matrix-table ledger-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">When</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {bootstrap.ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td className="ledger-table__type">{entry.type}</td>
                    <td className="ledger-table__when">
                      <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                    </td>
                    <td>{entry.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <footer className="status-bar">{status}</footer>
          </>
        )}
      </main>
  );
}
