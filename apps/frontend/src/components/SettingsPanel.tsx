import { useId, useState } from "react";

import type {
  DiscordOption,
  ReactionRewardRule,
  ReactionRewardRuleDraft,
  RoleCapability,
  Settings,
} from "../types";
import ReactionRulesEditor from "./ReactionRulesEditor";

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
  actionCooldownSeconds: null,
  canDeduct: false,
  canMultiAward: false,
  canSell: false,
  canReceiveAwards: true,
  isGroupRole: false,
  riggedBetWinChance: null,
};

const DEFAULT_ROLE_ACTION_COOLDOWN_SECONDS = 10;

function normaliseRoleCapability(role: RoleCapability): RoleCapability {
  if (!role.canAward && !role.canDeduct) {
    return {
      ...role,
      actionCooldownSeconds: null,
    };
  }

  return {
    ...role,
    actionCooldownSeconds: role.actionCooldownSeconds ?? DEFAULT_ROLE_ACTION_COOLDOWN_SECONDS,
  };
}

type ChannelMultiSelectFieldProps = {
  label: string;
  selectedIds: string[];
  channels: DiscordOption[];
  hint: string;
  emptyState: string;
  placeholder: string;
  onChange: (nextIds: string[]) => void;
};

function getChannelDisplayName(channel: DiscordOption | undefined, channelId: string) {
  return channel ? `#${channel.name}` : `Unknown channel (${channelId})`;
}

function ChannelMultiSelectField({
  label,
  selectedIds,
  channels,
  hint,
  emptyState,
  placeholder,
  onChange,
}: ChannelMultiSelectFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const [query, setQuery] = useState("");

  const selectedChannelIds = new Set(selectedIds);
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  const selectedChannels = selectedIds.map((channelId) => ({
    id: channelId,
    option: channels.find((channel) => channel.id === channelId),
  }));

  const matchingChannels = trimmedQuery
    ? channels.filter(
        (channel) =>
          !selectedChannelIds.has(channel.id) &&
          (channel.name.toLowerCase().includes(normalizedQuery) || channel.id.toLowerCase().includes(normalizedQuery)),
      )
    : [];

  const addChannel = (channelId: string) => {
    if (selectedChannelIds.has(channelId)) {
      setQuery("");
      return;
    }

    onChange([...selectedIds, channelId]);
    setQuery("");
  };

  const removeChannel = (channelId: string) => {
    onChange(selectedIds.filter((candidate) => candidate !== channelId));
  };

  const findBestMatch = () => {
    if (!trimmedQuery) {
      return null;
    }

    const exactMatch = channels.find(
      (channel) =>
        !selectedChannelIds.has(channel.id) &&
        (channel.id === trimmedQuery ||
          channel.name.toLowerCase() === normalizedQuery ||
          `#${channel.name}`.toLowerCase() === normalizedQuery),
    );

    return exactMatch ?? matchingChannels[0] ?? null;
  };

  const handleAddFromQuery = () => {
    const match = findBestMatch();
    if (!match) {
      return;
    }

    addChannel(match.id);
  };

  return (
    <div className="span-2 channel-picker-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="channel-picker">
        <div className="channel-picker__selected" aria-live="polite">
          {selectedChannels.length > 0 ? (
            selectedChannels.map(({ id, option }) => (
              <button
                key={id}
                className="channel-picker__chip"
                type="button"
                onClick={() => removeChannel(id)}
                title={`Remove ${getChannelDisplayName(option, id)}`}
              >
                <span>{getChannelDisplayName(option, id)}</span>
                <span aria-hidden="true">x</span>
              </button>
            ))
          ) : (
            <p className="channel-picker__empty">{emptyState}</p>
          )}
        </div>
        <div className="channel-picker__controls">
          <input
            id={inputId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                handleAddFromQuery();
                return;
              }

              if (event.key === "Backspace" && !query && selectedIds.length > 0) {
                removeChannel(selectedIds[selectedIds.length - 1]);
              }
            }}
            placeholder={placeholder}
            aria-describedby={hintId}
          />
          <button type="button" onClick={handleAddFromQuery} disabled={!findBestMatch()}>
            Add
          </button>
        </div>
        {matchingChannels.length > 0 ? (
          <ul className="channel-picker__matches" role="listbox" aria-label={`${label} suggestions`}>
            {matchingChannels.slice(0, 8).map((channel) => (
              <li key={channel.id}>
                <button type="button" onClick={() => addChannel(channel.id)}>
                  <span className="channel-picker__match-name">#{channel.name}</span>
                  <span className="channel-picker__match-id">{channel.id}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : trimmedQuery ? (
          <p className="channel-picker__no-match">No channels match that search.</p>
        ) : null}
        <p id={hintId} className="channel-picker__hint">
          {hint}
        </p>
      </div>
    </div>
  );
}

type SettingsPanelProps = {
  settingsDraft: Settings;
  roleDrafts: RoleCapability[];
  reactionRules: ReactionRewardRule[];
  discordRoles: DiscordOption[];
  discordChannels: DiscordOption[];
  isBusy: boolean;
  onSettingsChange: (next: Settings) => void;
  onRoleDraftsChange: (next: RoleCapability[]) => void;
  onSaveSettings: () => Promise<void>;
  onSaveRoles: () => Promise<void>;
  onCreateReactionRule: (draft: ReactionRewardRuleDraft) => Promise<boolean>;
  onUpdateReactionRule: (id: string, draft: ReactionRewardRuleDraft) => Promise<boolean>;
  onDeleteReactionRule: (id: string) => Promise<boolean>;
};

export default function SettingsPanel({
  settingsDraft,
  roleDrafts,
  reactionRules,
  discordRoles,
  discordChannels,
  isBusy,
  onSettingsChange,
  onRoleDraftsChange,
  onSaveSettings,
  onSaveRoles,
  onCreateReactionRule,
  onUpdateReactionRule,
  onDeleteReactionRule,
}: SettingsPanelProps) {
  const sortedDiscordChannels = [...discordChannels].sort((left, right) => left.name.localeCompare(right.name));

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

          <div className="form-grid settings-form-grid">
            <label>
              App name
              <input
                value={settingsDraft.appName}
                onChange={(event) => onSettingsChange({ ...settingsDraft, appName: event.target.value })}
              />
            </label>
            <fieldset className="settings-field-pair">
              <legend>Points</legend>
              <label className="settings-field-pair__label">
                Label
                <input
                  value={settingsDraft.pointsName}
                  onChange={(event) => onSettingsChange({ ...settingsDraft, pointsName: event.target.value })}
                />
              </label>
              <label className="settings-field-pair__symbol">
                Symbol
                <input
                  value={settingsDraft.pointsSymbol}
                  onChange={(event) => onSettingsChange({ ...settingsDraft, pointsSymbol: event.target.value })}
                />
              </label>
            </fieldset>
            <fieldset className="settings-field-pair">
              <legend>Currency</legend>
              <label className="settings-field-pair__label">
                Label
                <input
                  value={settingsDraft.currencyName}
                  onChange={(event) => onSettingsChange({ ...settingsDraft, currencyName: event.target.value })}
                />
              </label>
              <label className="settings-field-pair__symbol">
                Symbol
                <input
                  value={settingsDraft.currencySymbol}
                  onChange={(event) => onSettingsChange({ ...settingsDraft, currencySymbol: event.target.value })}
                />
              </label>
            </fieldset>
            <label className="settings-field settings-field--compact">
              Group points per donated currency
              <input
                type="number"
                min="1"
                value={settingsDraft.groupPointsPerCurrencyDonation}
                onChange={(event) =>
                  onSettingsChange({
                    ...settingsDraft,
                    groupPointsPerCurrencyDonation: Number(event.target.value),
                  })
                }
              />
            </label>
            <fieldset className="settings-section settings-section--reward span-full">
              <legend>Passive rewards</legend>
              <div className="settings-section__grid settings-section__grid--reward">
                <label className="settings-field">
                  Message points reward
                  <input
                    type="number"
                    value={settingsDraft.passivePointsReward}
                    onChange={(event) =>
                      onSettingsChange({ ...settingsDraft, passivePointsReward: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="settings-field">
                  Message currency reward
                  <input
                    type="number"
                    value={settingsDraft.passiveCurrencyReward}
                    onChange={(event) =>
                      onSettingsChange({ ...settingsDraft, passiveCurrencyReward: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="settings-field">
                  Passive cooldown (seconds)
                  <input
                    type="number"
                    value={settingsDraft.passiveCooldownSeconds}
                    onChange={(event) =>
                      onSettingsChange({ ...settingsDraft, passiveCooldownSeconds: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="settings-field">
                  Min characters
                  <input
                    type="number"
                    value={settingsDraft.passiveMinimumCharacters}
                    onChange={(event) =>
                      onSettingsChange({ ...settingsDraft, passiveMinimumCharacters: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className="settings-section span-full">
              <legend>Betting</legend>
              <div className="settings-section__grid settings-section__grid--compact">
                <label className="settings-field settings-field--compact">
                  Bet win chance (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={settingsDraft.betWinChance}
                    onChange={(event) =>
                      onSettingsChange({
                        ...settingsDraft,
                        betWinChance: Math.min(100, Math.max(0, Math.round(Number(event.target.value)))),
                      })
                    }
                  />
                </label>
                <label className="settings-field settings-field--compact">
                  Betting cooldown (seconds)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={settingsDraft.bettingCooldownSeconds}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      onSettingsChange({
                        ...settingsDraft,
                        bettingCooldownSeconds: Number.isFinite(parsed)
                          ? Math.max(0, Math.round(parsed))
                          : 0,
                      });
                    }}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className="settings-section span-full">
              <legend>Discord channels</legend>
              <div className="settings-section__grid">
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
                <label>
                  Announcements channel
                  <select
                    value={settingsDraft.announcementsChannelId ?? ""}
                    onChange={(event) =>
                      onSettingsChange({
                        ...settingsDraft,
                        announcementsChannelId: event.target.value || null,
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
              </div>
            </fieldset>
            <fieldset className="settings-section span-full">
              <legend>Passive channel eligibility</legend>
              <div className="settings-section__grid settings-section__grid--channels">
                <ChannelMultiSelectField
                  label="Allowed passive channels"
                  selectedIds={settingsDraft.passiveAllowedChannelIds}
                  channels={sortedDiscordChannels}
                  emptyState="All channels are currently allowed."
                  hint="Leave this empty to allow passive rewards in every channel. Add channels here only if you want a strict allow-list."
                  placeholder="Type a channel name or ID"
                  onChange={(passiveAllowedChannelIds) =>
                    onSettingsChange({
                      ...settingsDraft,
                      passiveAllowedChannelIds,
                    })
                  }
                />
                <ChannelMultiSelectField
                  label="Denied passive channels"
                  selectedIds={settingsDraft.passiveDeniedChannelIds}
                  channels={sortedDiscordChannels}
                  emptyState="No channels are currently denied."
                  hint="Leave this empty to deny none. Denied channels always block passive rewards, even if they also appear in the allowed list."
                  placeholder="Type a channel name or ID"
                  onChange={(passiveDeniedChannelIds) =>
                    onSettingsChange({
                      ...settingsDraft,
                      passiveDeniedChannelIds,
                    })
                  }
                />
              </div>
            </fieldset>
            <fieldset className="span-full role-checklist">
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
              <dd>Can give points to groups and handle staff-side currency adjustments.</dd>
              <dt>Max award</dt>
              <dd>Upper limit per award (blank = unlimited).</dd>
              <dt>Deduct</dt>
              <dd>Can subtract points from groups and handle staff-side currency corrections.</dd>
              <dt>Cooldown</dt>
              <dd>Seconds between award or deduct commands for that role. Defaults to 10 when enabled, and admins bypass it.</dd>
              <dt>Multi</dt>
              <dd>Can award multiple groups at once.</dd>
              <dt>Sell</dt>
              <dd>Can create marketplace listings.</dd>
              <dt>Recv</dt>
              <dd>Groups with this role can receive awards.</dd>
              <dt>Group</dt>
              <dd>Marks a Discord role as a student group.</dd>
              <dt>Rigged %</dt>
              <dd>
                Bet win chance for this role (0–100). Leave blank for the guild default. When a member has multiple
                rigged roles, the highest percentage wins.
              </dd>
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
                    <th scope="col" className="capability-table__cooldown">
                      Cooldown
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
                    <th scope="col" className="capability-table__max" title="Rigged bet win chance (%)">
                      Rigged %
                    </th>
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
                            next[index] = normaliseRoleCapability({
                              ...role,
                              roleId: event.target.value,
                              roleName: selected?.name ?? role.roleName,
                            });
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
                            next[index] = normaliseRoleCapability({ ...role, roleName: event.target.value });
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
                            next[index] = normaliseRoleCapability({
                              ...role,
                              maxAward: event.target.value ? Number(event.target.value) : null,
                            });
                            onRoleDraftsChange(next);
                          }}
                          placeholder="—"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={role.canAward || role.canDeduct ? (role.actionCooldownSeconds ?? DEFAULT_ROLE_ACTION_COOLDOWN_SECONDS) : ""}
                          aria-label="Action cooldown"
                          onChange={(event) => {
                            const next = [...roleDrafts];
                            next[index] = normaliseRoleCapability({
                              ...role,
                              actionCooldownSeconds: event.target.value ? Number(event.target.value) : null,
                            });
                            onRoleDraftsChange(next);
                          }}
                          placeholder="—"
                          disabled={!role.canAward && !role.canDeduct}
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
                              next[index] = normaliseRoleCapability({
                                ...role,
                                [column.key]: event.target.checked,
                              });
                              onRoleDraftsChange(next);
                            }}
                          />
                        </td>
                      ))}
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={role.riggedBetWinChance ?? ""}
                          aria-label="Rigged bet win chance"
                          onChange={(event) => {
                            const next = [...roleDrafts];
                            const raw = event.target.value;
                            const numeric = raw === "" ? Number.NaN : Number(raw);
                            const parsed = Number.isFinite(numeric)
                              ? Math.min(100, Math.max(0, Math.round(numeric)))
                              : null;
                            next[index] = normaliseRoleCapability({
                              ...role,
                              riggedBetWinChance: parsed,
                            });
                            onRoleDraftsChange(next);
                          }}
                          placeholder="—"
                        />
                      </td>
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

        <article className="section">
          <header className="section-header">
            <h2>React-to-reward rules</h2>
          </header>
          <div className="form-grid settings-form-grid">
            <ReactionRulesEditor
              rules={reactionRules}
              channels={discordChannels}
              currencyName={settingsDraft.currencyName}
              isBusy={isBusy}
              onCreate={onCreateReactionRule}
              onUpdate={onUpdateReactionRule}
              onDelete={onDeleteReactionRule}
            />
          </div>
        </article>
      </section>
    </div>
  );
}
