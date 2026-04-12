import type { DiscordOption, RoleCapability, Settings } from "../types";

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
  { key: "canManageDashboard", header: "Dashboard admin", abbr: "Admin" },
  { key: "canAward", header: "Award", abbr: "Award" },
  { key: "canDeduct", header: "Deduct", abbr: "Deduct" },
  { key: "canMultiAward", header: "Multi-target award", abbr: "Multi" },
  { key: "canSell", header: "Sell", abbr: "Sell" },
  { key: "canReceiveAwards", header: "Receivable", abbr: "Recv" },
  { key: "isGroupRole", header: "Group role", abbr: "Group" },
];

const EMPTY_ROLE_CAPABILITY: RoleCapability = {
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
};

type SettingsPanelProps = {
  settingsDraft: Settings;
  roleDrafts: RoleCapability[];
  discordRoles: DiscordOption[];
  discordChannels: DiscordOption[];
  isBusy: boolean;
  onSettingsChange: (next: Settings) => void;
  onRoleDraftsChange: (next: RoleCapability[]) => void;
  onSaveSettings: () => Promise<void>;
  onSaveRoles: () => Promise<void>;
};

export default function SettingsPanel({
  settingsDraft,
  roleDrafts,
  discordRoles,
  discordChannels,
  isBusy,
  onSettingsChange,
  onRoleDraftsChange,
  onSaveSettings,
  onSaveRoles,
}: SettingsPanelProps) {
  return (
    <div className="panel-stack">
      <section className="panel-stack">
        <article className="section">
          <header className="section-header">
            <h2>Set the economy shape</h2>
            <button className="primary-action" type="button" onClick={() => void onSaveSettings()} disabled={isBusy}>
              Save Settings
            </button>
          </header>

          <div className="form-grid">
            <label>
              App name
              <input
                value={settingsDraft.appName}
                onChange={(event) => onSettingsChange({ ...settingsDraft, appName: event.target.value })}
              />
            </label>
            <label>
              Points label
              <input
                value={settingsDraft.pointsName}
                onChange={(event) => onSettingsChange({ ...settingsDraft, pointsName: event.target.value })}
              />
            </label>
            <label>
              Currency label
              <input
                value={settingsDraft.currencyName}
                onChange={(event) => onSettingsChange({ ...settingsDraft, currencyName: event.target.value })}
              />
            </label>
            <fieldset className="span-3 role-checklist">
              <legend>Mentor roles</legend>
              <p className="role-checklist__help">
                These roles can manage the shop, assignments, and submission reviews without getting access to
                settings or groups.
              </p>
              <div className="role-checklist__options">
                {discordRoles.map((role) => {
                  const isChecked = settingsDraft.mentorRoleIds.includes(role.id);
                  return (
                    <label key={role.id} className="role-checklist__option">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(event) =>
                          onSettingsChange({
                            ...settingsDraft,
                            mentorRoleIds: event.target.checked
                              ? [...settingsDraft.mentorRoleIds, role.id]
                              : settingsDraft.mentorRoleIds.filter((candidate) => candidate !== role.id),
                          })
                        }
                      />
                      <span>{role.name}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label>
              Message points reward
              <input
                type="number"
                value={settingsDraft.passivePointsReward}
                onChange={(event) =>
                  onSettingsChange({ ...settingsDraft, passivePointsReward: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Message currency reward
              <input
                type="number"
                value={settingsDraft.passiveCurrencyReward}
                onChange={(event) =>
                  onSettingsChange({ ...settingsDraft, passiveCurrencyReward: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Cooldown seconds
              <input
                type="number"
                value={settingsDraft.passiveCooldownSeconds}
                onChange={(event) =>
                  onSettingsChange({ ...settingsDraft, passiveCooldownSeconds: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Min characters
              <input
                type="number"
                value={settingsDraft.passiveMinimumCharacters}
                onChange={(event) =>
                  onSettingsChange({ ...settingsDraft, passiveMinimumCharacters: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Economy mode
              <select
                value={settingsDraft.economyMode}
                onChange={(event) =>
                  onSettingsChange({
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
              Bet win chance (%)
              <input
                type="number"
                min={0}
                max={100}
                value={settingsDraft.betWinChance}
                onChange={(event) =>
                  onSettingsChange({ ...settingsDraft, betWinChance: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Listing channel
              <select
                value={settingsDraft.listingChannelId ?? ""}
                onChange={(event) =>
                  onSettingsChange({
                    ...settingsDraft,
                    listingChannelId: event.target.value || null,
                  })
                }
              >
                <option value="">Unset</option>
                {discordChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Redemption channel
              <select
                value={settingsDraft.redemptionChannelId ?? ""}
                onChange={(event) =>
                  onSettingsChange({
                    ...settingsDraft,
                    redemptionChannelId: event.target.value || null,
                  })
                }
              >
                <option value="">Unset</option>
                {discordChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Log channel
              <select
                value={settingsDraft.commandLogChannelId ?? ""}
                onChange={(event) =>
                  onSettingsChange({
                    ...settingsDraft,
                    commandLogChannelId: event.target.value || null,
                  })
                }
              >
                <option value="">Unset</option>
                {discordChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Allowed passive channels
              <input
                value={settingsDraft.passiveAllowedChannelIds.join(", ")}
                onChange={(event) =>
                  onSettingsChange({
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
                  onSettingsChange({
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
            <h2>Configure the role capability matrix</h2>
            <button className="primary-action" type="button" onClick={() => void onSaveRoles()} disabled={isBusy}>
              Save Roles
            </button>
          </header>

          <details className="capability-help">
            <summary>What do these columns mean?</summary>
            <dl>
              <dt>Admin</dt>
              <dd>Full dashboard access, including settings and groups.</dd>
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
                    {CAPABILITY_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className="capability-table__cap"
                        title={column.header}
                      >
                        <span className="capability-table__abbr">{column.abbr}</span>
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
                            onRoleDraftsChange(next);
                          }}
                        >
                          <option value="">Select role</option>
                          {discordRoles.map((roleOption) => (
                            <option key={roleOption.id} value={roleOption.id}>
                              {roleOption.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={role.roleName}
                          aria-label="Role label"
                          onChange={(event) => {
                            const next = [...roleDrafts];
                            next[index] = { ...role, roleName: event.target.value };
                            onRoleDraftsChange(next);
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
                            onRoleDraftsChange(next);
                          }}
                          placeholder="—"
                        />
                      </td>
                      {CAPABILITY_COLUMNS.map((column) => (
                        <td key={column.key} className="capability-table__cap">
                          <input
                            type="checkbox"
                            checked={role[column.key]}
                            aria-label={column.header}
                            onChange={(event) => {
                              const next = [...roleDrafts];
                              next[index] = { ...role, [column.key]: event.target.checked };
                              onRoleDraftsChange(next);
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
                onClick={() => onRoleDraftsChange([...roleDrafts, { ...EMPTY_ROLE_CAPABILITY }])}
              >
                Add Role Rule
              </button>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
