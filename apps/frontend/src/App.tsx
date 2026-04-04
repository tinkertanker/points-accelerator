import { startTransition, useEffect, useMemo, useState } from "react";

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

  if (!bootstrap || !settingsDraft) {
    return (
      <main className="shell">
        <div className="login-page">
          <div>
            <h1>economy rice</h1>
            <p className="lede">
              Group rewards, transfers, shop pricing, role capabilities, and passive chat earn rates all live here.
            </p>
          </div>

          <div className="login-card">
            <h2>Discord Sign-In</h2>
            <p>
              Use your Discord account for the configured server. Dashboard access follows your current guild permissions
              and any roles marked with <strong>manage dashboard</strong>.
            </p>
            <button onClick={handleLogin} disabled={isBusy}>
              {isBusy ? "Redirecting..." : "Sign In with Discord"}
            </button>
            <p className="status-bar">{status}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <h1>{bootstrap.settings.appName}</h1>
          <p>Manage groups, roles, shop, and economy settings.</p>
        </div>
        <div className="topbar-right">
          {sessionUser ? (
            <div className="session-badge">
              {sessionUser.avatarUrl ? <img src={sessionUser.avatarUrl} alt="" /> : null}
              <strong>{sessionUser.displayName}</strong>
            </div>
          ) : null}
          <button
            onClick={() => void loadBootstrap().catch(() => undefined)}
            disabled={isBusy}
          >
            Refresh
          </button>
          <button onClick={() => void handleLogout()}>Sign Out</button>
        </div>
      </header>

      <section className="stats-row">
        <div className="stat-item">
          <span>Groups</span>
          <strong>{bootstrap.groups.length}</strong>
        </div>
        <div className="stat-item">
          <span>Role Rules</span>
          <strong>{bootstrap.capabilities.length}</strong>
        </div>
        <div className="stat-item">
          <span>Shop Items</span>
          <strong>{bootstrap.shopItems.length}</strong>
        </div>
        <div className="stat-item">
          <span>Listings</span>
          <strong>{bootstrap.listings.length}</strong>
        </div>
      </section>

      <section className="walkthrough-section">
        <div className="section-header">
          <div>
            <p className="section-label">Phase 1</p>
            <h2>Class launch walkthrough</h2>
          </div>
        </div>
        <div className="walkthrough">
          <div className="walkthrough-step">
            <div className="step-number">1</div>
            <h3>Give staff roles their powers</h3>
            <p>
              In <strong>Capability matrix</strong>, add your admin and alumni roles, then turn on <strong>award</strong>{" "}
              and <strong>deduct</strong>. Set a max award if you want a hard cap per command.
            </p>
          </div>
          <div className="walkthrough-step">
            <div className="step-number">2</div>
            <h3>Map every student team to a Discord role</h3>
            <p>
              In <strong>Role mapping</strong>, create one group per student role. Students can only use{" "}
              <code>/balance</code> when their Discord role maps to exactly one active group.
            </p>
          </div>
          <div className="walkthrough-step">
            <div className="step-number">3</div>
            <h3>Name the economy once</h3>
            <p>
              In <strong>Economy shape</strong>, set the labels for <strong>{settingsDraft.pointsName}</strong> and{" "}
              <strong>{settingsDraft.currencyName}</strong>, plus any passive earning rules you want before class starts.
            </p>
          </div>
          <div className="walkthrough-step">
            <div className="step-number">4</div>
            <h3>Smoke test the class commands in Discord</h3>
            <p>
              Staff should test award and deduct flows with a reason. Students should test their own balance, the shared
              leaderboard, and the paged ledger feed.
            </p>
          </div>
        </div>
        <div className="walkthrough-commands">
          <code>/award targets:@gryffindor points:5 reason:"helped another group"</code>
          <code>/deduct targets:@gryffindor points:2 reason:"late submission"</code>
          <code>/balance</code>
          <code>/leaderboard</code>
          <code>/ledger</code>
          <code>/ledger page:2</code>
        </div>
      </section>

      <section className="two-col" style={{ marginTop: "1rem" }}>
        <article className="section">
          <div className="section-header">
            <div>
              <p className="section-label">Settings</p>
              <h2>Economy shape</h2>
            </div>
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
          </div>

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
          <div className="section-header">
            <div>
              <p className="section-label">Roles</p>
              <h2>Capability matrix</h2>
            </div>
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
          </div>

          <div className="stack">
            {roleDrafts.map((role, index) => (
              <div className="data-row role-row" key={`${role.roleId}-${index}`}>
                <select
                  value={role.roleId}
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
                <input
                  value={role.roleName}
                  onChange={(event) => {
                    const next = [...roleDrafts];
                    next[index] = { ...role, roleName: event.target.value };
                    setRoleDrafts(next);
                  }}
                  placeholder="Role label"
                />
                <input
                  type="number"
                  value={role.maxAward ?? ""}
                  onChange={(event) => {
                    const next = [...roleDrafts];
                    next[index] = { ...role, maxAward: event.target.value ? Number(event.target.value) : null };
                    setRoleDrafts(next);
                  }}
                  placeholder="Max award"
                />
                <label>
                  <input
                    type="checkbox"
                    checked={role.canManageDashboard}
                    onChange={(event) => {
                      const next = [...roleDrafts];
                      next[index] = { ...role, canManageDashboard: event.target.checked };
                      setRoleDrafts(next);
                    }}
                  />
                  dashboard
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={role.canAward}
                    onChange={(event) => {
                      const next = [...roleDrafts];
                      next[index] = { ...role, canAward: event.target.checked };
                      setRoleDrafts(next);
                    }}
                  />
                  award
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={role.canDeduct}
                    onChange={(event) => {
                      const next = [...roleDrafts];
                      next[index] = { ...role, canDeduct: event.target.checked };
                      setRoleDrafts(next);
                    }}
                  />
                  deduct
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={role.canMultiAward}
                    onChange={(event) => {
                      const next = [...roleDrafts];
                      next[index] = { ...role, canMultiAward: event.target.checked };
                      setRoleDrafts(next);
                    }}
                  />
                  multi
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={role.canSell}
                    onChange={(event) => {
                      const next = [...roleDrafts];
                      next[index] = { ...role, canSell: event.target.checked };
                      setRoleDrafts(next);
                    }}
                  />
                  sell
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={role.canReceiveAwards}
                    onChange={(event) => {
                      const next = [...roleDrafts];
                      next[index] = { ...role, canReceiveAwards: event.target.checked };
                      setRoleDrafts(next);
                    }}
                  />
                  receivable
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={role.isGroupRole}
                    onChange={(event) => {
                      const next = [...roleDrafts];
                      next[index] = { ...role, isGroupRole: event.target.checked };
                      setRoleDrafts(next);
                    }}
                  />
                  group role
                </label>
              </div>
            ))}
            <div className="add-row">
              <button
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
          <div className="section-header">
            <div>
              <p className="section-label">Groups</p>
              <h2>Role mapping</h2>
            </div>
          </div>
          <div className="stack">
            {groupDrafts.map((group, index) => (
              <div className="data-row group-row" key={`${group.id ?? "new"}-${index}`}>
                <label>Display name</label>
                <input
                  value={group.displayName}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, displayName: event.target.value };
                    setGroupDrafts(next);
                  }}
                  placeholder="Display name"
                />
                <label>Slug</label>
                <input
                  value={group.slug ?? ""}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, slug: event.target.value };
                    setGroupDrafts(next);
                  }}
                  placeholder="slug"
                />
                <label>Role</label>
                <select
                  value={group.roleId}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, roleId: event.target.value };
                    setGroupDrafts(next);
                  }}
                >
                  <option value="">Select role</option>
                  {roleOptions}
                </select>
                <label>Mentor</label>
                <input
                  value={group.mentorName ?? ""}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, mentorName: event.target.value };
                    setGroupDrafts(next);
                  }}
                  placeholder="Mentor"
                />
                <label>Aliases</label>
                <input
                  value={group.aliasesText}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, aliasesText: event.target.value };
                    setGroupDrafts(next);
                  }}
                  placeholder="comma separated"
                />
                <label>
                  <input
                    type="checkbox"
                    checked={group.active}
                    onChange={(event) => {
                      const next = [...groupDrafts];
                      next[index] = { ...group, active: event.target.checked };
                      setGroupDrafts(next);
                    }}
                  />
                  Active
                </label>
                <button
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
              </div>
            ))}
          </div>
        </article>

        <article className="section">
          <div className="section-header">
            <div>
              <p className="section-label">Shop</p>
              <h2>Catalog</h2>
            </div>
          </div>
          <div className="stack">
            {shopDrafts.map((item, index) => (
              <div className="data-row shop-row" key={`${item.id ?? "new"}-${index}`}>
                <label>Name</label>
                <input
                  value={item.name}
                  onChange={(event) => {
                    const next = [...shopDrafts];
                    next[index] = { ...item, name: event.target.value };
                    setShopDrafts(next);
                  }}
                  placeholder="Item name"
                />
                <label>Description</label>
                <input
                  value={item.description}
                  onChange={(event) => {
                    const next = [...shopDrafts];
                    next[index] = { ...item, description: event.target.value };
                    setShopDrafts(next);
                  }}
                  placeholder="Description"
                />
                <label>Cost</label>
                <input
                  type="number"
                  value={item.currencyCost}
                  onChange={(event) => {
                    const next = [...shopDrafts];
                    next[index] = { ...item, currencyCost: Number(event.target.value) };
                    setShopDrafts(next);
                  }}
                  placeholder="Cost"
                />
                <label>Stock</label>
                <input
                  type="number"
                  value={item.stock ?? ""}
                  onChange={(event) => {
                    const next = [...shopDrafts];
                    next[index] = { ...item, stock: event.target.value ? Number(event.target.value) : null };
                    setShopDrafts(next);
                  }}
                  placeholder="Stock"
                />
                <label>Fulfillment</label>
                <input
                  value={item.fulfillmentInstructions ?? ""}
                  onChange={(event) => {
                    const next = [...shopDrafts];
                    next[index] = { ...item, fulfillmentInstructions: event.target.value };
                    setShopDrafts(next);
                  }}
                  placeholder="Notes"
                />
                <label>
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) => {
                      const next = [...shopDrafts];
                      next[index] = { ...item, enabled: event.target.checked };
                      setShopDrafts(next);
                    }}
                  />
                  Enabled
                </label>
                <button
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
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="section leaderboard-section">
        <div className="section-header">
          <div>
            <p className="section-label">Live view</p>
            <h2>Leaderboard and activity</h2>
          </div>
        </div>

        <div className="dual-list">
          <div>
            <h3>Leaderboard</h3>
            <ol className="leaderboard">
              {bootstrap.leaderboard.map((group) => (
                <li key={group.id}>
                  <span>{group.displayName}</span>
                  <strong>
                    {group.pointsBalance} / {group.currencyBalance}
                  </strong>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3>Ledger</h3>
            <ul className="ledger">
              {bootstrap.ledger.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.type}</strong>
                  <p>{entry.description}</p>
                  <small>{new Date(entry.createdAt).toLocaleString()}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="status-bar">{status}</footer>
    </main>
  );
}
