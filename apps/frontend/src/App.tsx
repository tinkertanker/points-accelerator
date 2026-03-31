import { startTransition, useEffect, useMemo, useState } from "react";

import { api } from "./services/api";
import type {
  BootstrapPayload,
  Group,
  GroupDraft,
  RoleCapability,
  Settings,
  ShopItem,
  ShopItemDraft,
} from "./types";
import "./styles/app.css";

const STORAGE_KEY = "economy-rice-admin-token";

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
  const [token, setToken] = useState<string>(() => {
    if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
      return "";
    }
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  });
  const [loginValue, setLoginValue] = useState(token);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<RoleCapability[]>([]);
  const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([]);
  const [shopDrafts, setShopDrafts] = useState<ShopItemDraft[]>([]);
  const [status, setStatus] = useState("Sign in with the admin token to configure the bot.");
  const [isBusy, setIsBusy] = useState(false);

  const discordRoles = bootstrap?.discord.roles ?? [];
  const discordChannels = bootstrap?.discord.channels ?? [];

  const loadBootstrap = async (nextToken = token) => {
    setIsBusy(true);
    try {
      const payload = await api.bootstrap(nextToken);
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
    if (!token) {
      return;
    }

    void loadBootstrap().catch(() => {
      window.localStorage.removeItem(STORAGE_KEY);
      setToken("");
    });
  }, [token]);

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

  const handleLogin = async () => {
    setIsBusy(true);
    try {
      await api.login(loginValue);
      window.localStorage.setItem(STORAGE_KEY, loginValue);
      setToken(loginValue);
      setStatus("Signed in.");
      await loadBootstrap(loginValue);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleLogout = async () => {
    await api.logout(token).catch(() => undefined);
    window.localStorage.removeItem(STORAGE_KEY);
    setToken("");
    setBootstrap(null);
    setStatus("Signed out.");
  };

  if (!bootstrap || !settingsDraft) {
    return (
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">economy rice</p>
          <h1>Configure your class economy without editing env files every week.</h1>
          <p className="lede">
            Group rewards, transfers, shop pricing, role capabilities, and passive chat earn rates all live here.
          </p>
        </section>

        <section className="panel auth-panel">
          <label>
            Admin Token
            <input
              type="password"
              value={loginValue}
              onChange={(event) => setLoginValue(event.target.value)}
              placeholder="Paste the ADMIN_TOKEN value"
            />
          </label>
          <button onClick={() => void handleLogin()} disabled={isBusy || loginValue.length === 0}>
            {isBusy ? "Signing in..." : "Sign In"}
          </button>
          <p className="status">{status}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="hero compact">
        <div>
          <p className="eyebrow">{bootstrap.settings.appName}</p>
          <h1>economy rice control room</h1>
          <p className="lede">
            Manage group mapping, role powers, point flow, spendable currency, and what appears in the shop.
          </p>
        </div>
        <div className="hero-actions">
          <button className="secondary" onClick={() => void loadBootstrap()} disabled={isBusy}>
            Refresh
          </button>
          <button onClick={() => void handleLogout()}>Sign Out</button>
        </div>
      </header>

      <section className="grid overview-grid">
        <article className="panel stat-card">
          <span>Total Groups</span>
          <strong>{bootstrap.groups.length}</strong>
        </article>
        <article className="panel stat-card">
          <span>Role Rules</span>
          <strong>{bootstrap.capabilities.length}</strong>
        </article>
        <article className="panel stat-card">
          <span>Shop Items</span>
          <strong>{bootstrap.shopItems.length}</strong>
        </article>
        <article className="panel stat-card">
          <span>Listings</span>
          <strong>{bootstrap.listings.length}</strong>
        </article>
      </section>

      <section className="grid content-grid">
        <article className="panel section-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Settings</p>
              <h2>Economy shape</h2>
            </div>
            <button
              onClick={async () => {
                if (!settingsDraft) {
                  return;
                }
                setIsBusy(true);
                try {
                  await api.saveSettings(settingsDraft, token);
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
              App Name
              <input
                value={settingsDraft.appName}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, appName: event.target.value })}
              />
            </label>
            <label>
              Points Label
              <input
                value={settingsDraft.pointsName}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, pointsName: event.target.value })}
              />
            </label>
            <label>
              Currency Label
              <input
                value={settingsDraft.currencyName}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, currencyName: event.target.value })}
              />
            </label>
            <label>
              Message Points Reward
              <input
                type="number"
                value={settingsDraft.passivePointsReward}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, passivePointsReward: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Message Currency Reward
              <input
                type="number"
                value={settingsDraft.passiveCurrencyReward}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, passiveCurrencyReward: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Cooldown Seconds
              <input
                type="number"
                value={settingsDraft.passiveCooldownSeconds}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, passiveCooldownSeconds: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Min Characters
              <input
                type="number"
                value={settingsDraft.passiveMinimumCharacters}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, passiveMinimumCharacters: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Economy Mode
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
              Listing Channel
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
              Redemption Channel
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
              Log Channel
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
              Allowed Passive Channels
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
              Denied Passive Channels
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

        <article className="panel section-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Roles</p>
              <h2>Capability matrix</h2>
            </div>
            <button
              onClick={async () => {
                setIsBusy(true);
                try {
                  await api.saveCapabilities(
                    roleDrafts.filter((role) => role.roleId.trim().length > 0 && role.roleName.trim().length > 0),
                    token,
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
              <div className="role-row" key={`${role.roleId}-${index}`}>
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
            <button
              className="secondary"
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
        </article>

        <article className="panel section-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Groups</p>
              <h2>Role mapping</h2>
            </div>
          </div>
          <div className="stack">
            {groupDrafts.map((group, index) => (
              <div className="group-row" key={`${group.id ?? "new"}-${index}`}>
                <input
                  value={group.displayName}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, displayName: event.target.value };
                    setGroupDrafts(next);
                  }}
                  placeholder="Display name"
                />
                <input
                  value={group.slug ?? ""}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, slug: event.target.value };
                    setGroupDrafts(next);
                  }}
                  placeholder="slug"
                />
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
                <input
                  value={group.mentorName ?? ""}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, mentorName: event.target.value };
                    setGroupDrafts(next);
                  }}
                  placeholder="Mentor"
                />
                <input
                  value={group.aliasesText}
                  onChange={(event) => {
                    const next = [...groupDrafts];
                    next[index] = { ...group, aliasesText: event.target.value };
                    setGroupDrafts(next);
                  }}
                  placeholder="aliases, comma separated"
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
                  active
                </label>
                <button
                  onClick={async () => {
                    setIsBusy(true);
                    try {
                      await api.saveGroup(group, token);
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

        <article className="panel section-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Shop</p>
              <h2>Catalog</h2>
            </div>
          </div>
          <div className="stack">
            {shopDrafts.map((item, index) => (
              <div className="shop-row" key={`${item.id ?? "new"}-${index}`}>
                <input
                  value={item.name}
                  onChange={(event) => {
                    const next = [...shopDrafts];
                    next[index] = { ...item, name: event.target.value };
                    setShopDrafts(next);
                  }}
                  placeholder="Item name"
                />
                <input
                  value={item.description}
                  onChange={(event) => {
                    const next = [...shopDrafts];
                    next[index] = { ...item, description: event.target.value };
                    setShopDrafts(next);
                  }}
                  placeholder="Description"
                />
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
                <input
                  value={item.fulfillmentInstructions ?? ""}
                  onChange={(event) => {
                    const next = [...shopDrafts];
                    next[index] = { ...item, fulfillmentInstructions: event.target.value };
                    setShopDrafts(next);
                  }}
                  placeholder="Fulfillment notes"
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
                  enabled
                </label>
                <button
                  onClick={async () => {
                    setIsBusy(true);
                    try {
                      await api.saveShopItem(item, token);
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

        <article className="panel section-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Live view</p>
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
        </article>
      </section>

      <footer className="status-bar">{status}</footer>
    </main>
  );
}
