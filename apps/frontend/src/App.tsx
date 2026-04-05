import { startTransition, useEffect, useMemo, useState } from "react";

import ThemeToggle from "./components/ThemeToggle";
import { isDesignPreview } from "./designPreview";
import { api } from "./services/api";
import type {
  AuthUser,
  BootstrapPayload,
  Group,
  GroupDraft,
  RoleCapability,
  Settings,
  ShopItem,
  ShopItemDraft,
} from "./types";
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

export default function App() {
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<RoleCapability[]>([]);
  const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([]);
  const [shopDrafts, setShopDrafts] = useState<ShopItemDraft[]>([]);
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
              <h1>economy rice</h1>
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
          <dt>Role Rules</dt>
          <dd>{bootstrap.capabilities.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Shop Items</dt>
          <dd>{bootstrap.shopItems.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Listings</dt>
          <dd>{bootstrap.listings.length}</dd>
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
              In <strong>Capability matrix</strong>, add your admin and alumni roles, then turn on <strong>award</strong>{" "}
              and <strong>deduct</strong>. Set a max award if you want a hard cap per command.
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
          </header>
          <div className="group-mapping-matrix">
            <div className="matrix-scroll">
              <table className="matrix-table group-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-display">
                      Display name
                    </th>
                    <th scope="col" className="col-slug">
                      Slug
                    </th>
                    <th scope="col" className="col-role">
                      Discord role
                    </th>
                    <th scope="col" className="col-mentor">
                      Mentor
                    </th>
                    <th scope="col" className="col-aliases">
                      Aliases
                    </th>
                    <th scope="col" className="matrix-table__th--center col-active">
                      Active
                    </th>
                    <th scope="col" className="matrix-table__th--actions col-actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupDrafts.map((group, index) => (
                    <tr key={`${group.id ?? "new"}-${index}`}>
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
                      <td className="col-slug">
                        <input
                          value={group.slug ?? ""}
                          aria-label="Slug"
                          onChange={(event) => {
                            const next = [...groupDrafts];
                            next[index] = { ...group, slug: event.target.value };
                            setGroupDrafts(next);
                          }}
                          placeholder="team-slug"
                        />
                      </td>
                      <td className="col-role">
                        <select
                          value={group.roleId}
                          aria-label="Discord role"
                          onChange={(event) => {
                            const next = [...groupDrafts];
                            next[index] = { ...group, roleId: event.target.value };
                            setGroupDrafts(next);
                          }}
                        >
                          <option value="">Select role</option>
                          {roleOptions}
                        </select>
                      </td>
                      <td className="col-mentor">
                        <input
                          value={group.mentorName ?? ""}
                          aria-label="Mentor"
                          onChange={(event) => {
                            const next = [...groupDrafts];
                            next[index] = { ...group, mentorName: event.target.value };
                            setGroupDrafts(next);
                          }}
                          placeholder="Optional"
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
                      <td className="col-actions">
                        <button
                          type="button"
                          onClick={async () => {
                            setIsBusy(true);
                            try {
                              await api.saveGroup(group);
                              await loadBootstrap();
                              setStatus(`Saved ${group.displayName || "group"}.`);
                            } catch (error) {
                              setStatus(error instanceof Error ? error.message : "Failed to save group.");
                            } finally {
                              setIsBusy(false);
                            }
                          }}
                          disabled={!group.displayName || !group.roleId}
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
