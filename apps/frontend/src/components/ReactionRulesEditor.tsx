import { useMemo, useState } from "react";

import type { DiscordOption, ReactionRewardRule, ReactionRewardRuleDraft } from "../types";

type ReactionRulesEditorProps = {
  rules: ReactionRewardRule[];
  channels: DiscordOption[];
  currencyName: string;
  pointsName: string;
  isBusy: boolean;
  onCreate: (draft: ReactionRewardRuleDraft) => Promise<boolean>;
  onUpdate: (id: string, draft: ReactionRewardRuleDraft) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
};

const NEW_ROW_KEY = "__new__";

const EMPTY_DRAFT: ReactionRewardRuleDraft = {
  channelId: "",
  botUserId: "",
  emoji: "",
  payoutTarget: "PARTICIPANT_CURRENCY",
  currencyDelta: 1,
  pointsDelta: 1,
  amountMode: "FIXED",
  maxCurrencyDelta: null,
  maxPointsDelta: null,
  description: "",
  enabled: true,
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "flex-end",
  flexWrap: "wrap",
};

const FIELD_STYLES = {
  channel: { flex: "1 1 180px", minWidth: 160 },
  botId: { flex: "1 1 200px", minWidth: 180 },
  emoji: { flex: "0 0 110px" },
  target: { flex: "0 0 150px" },
  mode: { flex: "0 0 150px" },
  delta: { flex: "0 0 120px" },
  max: { flex: "0 0 120px" },
  note: { flex: "1 1 160px", minWidth: 140 },
  enabled: { flex: "0 0 70px" },
  actions: { flex: "0 0 auto" },
} as const;

function ruleToDraft(rule: ReactionRewardRule): ReactionRewardRuleDraft {
  return {
    id: rule.id,
    channelId: rule.channelId,
    botUserId: rule.botUserId,
    emoji: rule.emoji,
    payoutTarget: rule.payoutTarget,
    currencyDelta: rule.currencyDelta,
    pointsDelta: rule.pointsDelta,
    amountMode: rule.amountMode,
    maxCurrencyDelta: rule.maxCurrencyDelta,
    maxPointsDelta: rule.maxPointsDelta,
    description: rule.description ?? "",
    enabled: rule.enabled,
  };
}

function isDirty(rule: ReactionRewardRule, draft: ReactionRewardRuleDraft) {
  return (
    rule.channelId !== draft.channelId ||
    rule.botUserId !== draft.botUserId ||
    rule.emoji !== draft.emoji ||
    rule.payoutTarget !== draft.payoutTarget ||
    rule.currencyDelta !== draft.currencyDelta ||
    rule.pointsDelta !== draft.pointsDelta ||
    rule.amountMode !== draft.amountMode ||
    rule.maxCurrencyDelta !== draft.maxCurrencyDelta ||
    rule.maxPointsDelta !== draft.maxPointsDelta ||
    (rule.description ?? "") !== (draft.description ?? "") ||
    rule.enabled !== draft.enabled
  );
}

function activeDelta(draft: ReactionRewardRuleDraft) {
  return draft.payoutTarget === "GROUP_POINTS" ? draft.pointsDelta : draft.currencyDelta;
}

function activeMax(draft: ReactionRewardRuleDraft) {
  return draft.payoutTarget === "GROUP_POINTS" ? draft.maxPointsDelta : draft.maxCurrencyDelta;
}

function activeUnit(draft: ReactionRewardRuleDraft, labels: { currencyName: string; pointsName: string }) {
  return draft.payoutTarget === "GROUP_POINTS" ? labels.pointsName : labels.currencyName;
}

function withActiveDelta(draft: ReactionRewardRuleDraft, delta: number): ReactionRewardRuleDraft {
  return draft.payoutTarget === "GROUP_POINTS"
    ? { ...draft, pointsDelta: delta }
    : { ...draft, currencyDelta: delta };
}

function withActiveMax(draft: ReactionRewardRuleDraft, maxDelta: number | null): ReactionRewardRuleDraft {
  return draft.payoutTarget === "GROUP_POINTS"
    ? { ...draft, maxPointsDelta: maxDelta, maxCurrencyDelta: null }
    : { ...draft, maxCurrencyDelta: maxDelta, maxPointsDelta: null };
}

function parseDelta(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return parsed;
}

function parseOptionalPositive(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export default function ReactionRulesEditor({
  rules,
  channels,
  currencyName,
  pointsName,
  isBusy,
  onCreate,
  onUpdate,
  onDelete,
}: ReactionRulesEditorProps) {
  const sortedChannels = useMemo(
    () => [...channels].sort((left, right) => left.name.localeCompare(right.name)),
    [channels],
  );

  const [drafts, setDrafts] = useState<Record<string, ReactionRewardRuleDraft>>({});
  const [newDraft, setNewDraft] = useState<ReactionRewardRuleDraft>(EMPTY_DRAFT);
  const [deltaTexts, setDeltaTexts] = useState<Record<string, string>>({ [NEW_ROW_KEY]: "1" });
  const [maxTexts, setMaxTexts] = useState<Record<string, string>>({});

  const draftFor = (rule: ReactionRewardRule) => drafts[rule.id] ?? ruleToDraft(rule);
  const deltaTextFor = (key: string, fallback: number) => deltaTexts[key] ?? String(fallback);
  const maxTextFor = (key: string, fallback: number | null) =>
    maxTexts[key] ?? (fallback === null ? "" : String(fallback));

  const updateDraft = (id: string, next: ReactionRewardRuleDraft) => {
    setDrafts((prev) => ({ ...prev, [id]: next }));
  };

  const setDeltaText = (key: string, value: string) => {
    setDeltaTexts((prev) => ({ ...prev, [key]: value }));
  };

  const setMaxText = (key: string, value: string) => {
    setMaxTexts((prev) => ({ ...prev, [key]: value }));
  };

  const resetDraft = (id: string) => {
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setDeltaTexts((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setMaxTexts((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const handleTargetChange = (
    key: string,
    draft: ReactionRewardRuleDraft,
    nextTarget: ReactionRewardRuleDraft["payoutTarget"],
    update: (next: ReactionRewardRuleDraft) => void,
  ) => {
    const nextDraft = { ...draft, payoutTarget: nextTarget };
    update(nextDraft);
    setDeltaText(key, String(activeDelta(nextDraft)));
    setMaxText(key, activeMax(nextDraft) === null ? "" : String(activeMax(nextDraft)));
  };

  const normaliseForSave = (
    draft: ReactionRewardRuleDraft,
    key: string,
  ): ReactionRewardRuleDraft | null => {
    const parsed = parseDelta(deltaTextFor(key, activeDelta(draft)));
    const maxText = maxTextFor(key, activeMax(draft));
    const parsedMax = parseOptionalPositive(maxText);
    const maxDelta = draft.amountMode === "COUNT_MULTIPLIER" && maxText.trim() ? parsedMax : null;
    if (parsed === null || (draft.amountMode === "COUNT_MULTIPLIER" && maxDelta === null)) return null;
    return withActiveMax(withActiveDelta(draft, parsed), maxDelta);
  };

  const handleSave = async (rule: ReactionRewardRule) => {
    const draft = normaliseForSave(draftFor(rule), rule.id);
    if (!draft) return;
    const success = await onUpdate(rule.id, draft);
    if (success) {
      resetDraft(rule.id);
    }
  };

  const handleDelete = async (rule: ReactionRewardRule) => {
    const confirmed = window.confirm(
      `Delete rule for ${rule.emoji} in this channel? Past awards stay; only future reactions stop applying.`,
    );
    if (!confirmed) return;
    const success = await onDelete(rule.id);
    if (success) {
      resetDraft(rule.id);
    }
  };

  const handleCreate = async () => {
    const draft = normaliseForSave(newDraft, NEW_ROW_KEY);
    if (!draft) return;
    const success = await onCreate(draft);
    if (success) {
      // Keep channel + bot ID — admins typically add several rules per bot.
      setNewDraft({
        ...EMPTY_DRAFT,
        channelId: newDraft.channelId,
        botUserId: newDraft.botUserId,
        payoutTarget: newDraft.payoutTarget,
        amountMode: newDraft.amountMode,
        maxCurrencyDelta: draft.payoutTarget === "PARTICIPANT_CURRENCY" ? draft.maxCurrencyDelta : null,
        maxPointsDelta: draft.payoutTarget === "GROUP_POINTS" ? draft.maxPointsDelta : null,
      });
      setDeltaText(NEW_ROW_KEY, "1");
    }
  };

  const renderChannelOptions = () =>
    sortedChannels.map((channel) => (
      <option key={channel.id} value={channel.id}>
        #{channel.name}
      </option>
    ));

  const newDeltaText = deltaTextFor(NEW_ROW_KEY, activeDelta(newDraft));
  const newDeltaValid = parseDelta(newDeltaText) !== null;
  const newMaxText = maxTextFor(NEW_ROW_KEY, activeMax(newDraft));
  const newMaxValid =
    newDraft.amountMode !== "COUNT_MULTIPLIER" || parseOptionalPositive(newMaxText) !== null;
  const canSubmitNew =
    !isBusy &&
    Boolean(newDraft.channelId) &&
    newDraft.botUserId.trim().length > 0 &&
    newDraft.emoji.trim().length > 0 &&
    newDeltaValid &&
    newMaxValid;

  const labels = { currencyName, pointsName };

  return (
    <fieldset className="settings-section span-full">
      <legend>Bot reaction rewards</legend>
      <p className="role-checklist__help">
        Award or deduct participant {currencyName} or group {pointsName} when a configured bot reacts to a
        message in a chosen channel. Fixed amount pays the configured delta. Count multiplier reads a
        number at the start of the message and pays number x delta, capped at the configured maximum payout.
      </p>

      {rules.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
          {rules.map((rule) => {
            const draft = draftFor(rule);
            const text = deltaTextFor(rule.id, activeDelta(draft));
            const parsed = parseDelta(text);
            const maxText = maxTextFor(rule.id, activeMax(draft));
            const parsedMax = parseOptionalPositive(maxText);
            const maxDelta = draft.amountMode === "COUNT_MULTIPLIER" && maxText.trim() ? parsedMax : null;
            const normalisedDraft =
              parsed === null ? draft : withActiveMax(withActiveDelta(draft, parsed), maxDelta);
            const dirty = isDirty(rule, normalisedDraft);
            const maxValid = draft.amountMode !== "COUNT_MULTIPLIER" || maxDelta !== null;
            const unit = activeUnit(draft, labels);
            return (
              <div key={rule.id} style={ROW_STYLE}>
                <label className="settings-field" style={FIELD_STYLES.channel}>
                  Channel
                  <select
                    aria-label="Channel"
                    value={draft.channelId}
                    onChange={(event) =>
                      updateDraft(rule.id, { ...draft, channelId: event.target.value })
                    }
                  >
                    <option value="">Select channel</option>
                    {renderChannelOptions()}
                  </select>
                </label>
                <label className="settings-field" style={FIELD_STYLES.botId}>
                  Bot user ID
                  <input
                    aria-label="Bot user ID"
                    value={draft.botUserId}
                    onChange={(event) =>
                      updateDraft(rule.id, { ...draft, botUserId: event.target.value })
                    }
                  />
                </label>
                <label className="settings-field" style={FIELD_STYLES.emoji}>
                  Emoji
                  <input
                    aria-label="Emoji"
                    value={draft.emoji}
                    onChange={(event) =>
                      updateDraft(rule.id, { ...draft, emoji: event.target.value })
                    }
                  />
                </label>
                <label className="settings-field" style={FIELD_STYLES.target}>
                  Payout
                  <select
                    aria-label="Payout"
                    value={draft.payoutTarget}
                    onChange={(event) =>
                      handleTargetChange(
                        rule.id,
                        draft,
                        event.target.value as ReactionRewardRuleDraft["payoutTarget"],
                        (next) => updateDraft(rule.id, next),
                      )
                    }
                  >
                    <option value="PARTICIPANT_CURRENCY">Participant {currencyName}</option>
                    <option value="GROUP_POINTS">Group {pointsName}</option>
                  </select>
                </label>
                <label className="settings-field" style={FIELD_STYLES.mode}>
                  Reward mode
                  <select
                    aria-label="Reward mode"
                    value={draft.amountMode}
                    onChange={(event) =>
                      updateDraft(rule.id, {
                        ...withActiveMax(draft, null),
                        amountMode: event.target.value as ReactionRewardRuleDraft["amountMode"],
                      })
                    }
                  >
                    <option value="FIXED">Fixed amount</option>
                    <option value="COUNT_MULTIPLIER">Count multiplier</option>
                  </select>
                </label>
                <label className="settings-field" style={FIELD_STYLES.delta}>
                  {draft.amountMode === "COUNT_MULTIPLIER" ? `${unit} per count` : `${unit} delta`}
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Reward amount"
                    value={text}
                    onChange={(event) => setDeltaText(rule.id, event.target.value)}
                    onBlur={() => {
                      if (parsed !== null) {
                        updateDraft(rule.id, withActiveDelta(draft, parsed));
                      }
                    }}
                  />
                </label>
                <label className="settings-field" style={FIELD_STYLES.max}>
                  Max payout
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Maximum payout"
                    value={maxText}
                    disabled={draft.amountMode !== "COUNT_MULTIPLIER"}
                    onChange={(event) => setMaxText(rule.id, event.target.value)}
                    onBlur={() => {
                      if (maxDelta !== null) {
                        updateDraft(rule.id, withActiveMax(draft, maxDelta));
                      }
                    }}
                    placeholder={draft.amountMode === "COUNT_MULTIPLIER" ? "10000" : ""}
                  />
                </label>
                <label className="settings-field" style={FIELD_STYLES.note}>
                  Label
                  <input
                    aria-label="Label"
                    title="Internal label — shown only on the dashboard"
                    value={draft.description ?? ""}
                    onChange={(event) =>
                      updateDraft(rule.id, { ...draft, description: event.target.value })
                    }
                  />
                </label>
                <label className="settings-field" style={FIELD_STYLES.enabled}>
                  Enabled
                  <input
                    type="checkbox"
                    aria-label="Enabled"
                    checked={draft.enabled}
                    onChange={(event) =>
                      updateDraft(rule.id, { ...draft, enabled: event.target.checked })
                    }
                  />
                </label>
                <div style={{ ...FIELD_STYLES.actions, display: "flex", gap: "0.25rem" }}>
                  <button
                    type="button"
                    onClick={() => void handleSave(rule)}
                    disabled={isBusy || !dirty || parsed === null || !maxValid}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(rule)}
                    disabled={isBusy}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="channel-picker__empty" style={{ marginBottom: "0.5rem" }}>
          No reaction rules yet. Add one below.
        </p>
      )}

      <div style={ROW_STYLE}>
        <label className="settings-field" style={FIELD_STYLES.channel}>
          Channel
          <select
            value={newDraft.channelId}
            onChange={(event) => setNewDraft({ ...newDraft, channelId: event.target.value })}
          >
            <option value="">Select channel</option>
            {renderChannelOptions()}
          </select>
        </label>
        <label className="settings-field" style={FIELD_STYLES.botId}>
          Bot user ID
          <input
            value={newDraft.botUserId}
            onChange={(event) => setNewDraft({ ...newDraft, botUserId: event.target.value })}
            placeholder="e.g. 510016054391734273"
          />
        </label>
        <label className="settings-field" style={FIELD_STYLES.emoji}>
          Emoji
          <input
            value={newDraft.emoji}
            onChange={(event) => setNewDraft({ ...newDraft, emoji: event.target.value })}
            placeholder="paste here"
          />
        </label>
        <label className="settings-field" style={FIELD_STYLES.target}>
          Payout
          <select
            value={newDraft.payoutTarget}
            onChange={(event) =>
              handleTargetChange(
                NEW_ROW_KEY,
                newDraft,
                event.target.value as ReactionRewardRuleDraft["payoutTarget"],
                setNewDraft,
              )
            }
          >
            <option value="PARTICIPANT_CURRENCY">Participant {currencyName}</option>
            <option value="GROUP_POINTS">Group {pointsName}</option>
          </select>
        </label>
        <label className="settings-field" style={FIELD_STYLES.mode}>
          Reward mode
          <select
            value={newDraft.amountMode}
            onChange={(event) =>
              setNewDraft({
                ...withActiveMax(newDraft, null),
                amountMode: event.target.value as ReactionRewardRuleDraft["amountMode"],
              })
            }
          >
            <option value="FIXED">Fixed amount</option>
            <option value="COUNT_MULTIPLIER">Count multiplier</option>
          </select>
        </label>
        <label className="settings-field" style={FIELD_STYLES.delta}>
          {newDraft.amountMode === "COUNT_MULTIPLIER"
            ? `${activeUnit(newDraft, labels)} per count`
            : `${activeUnit(newDraft, labels)} delta`}
          <input
            type="text"
            inputMode="numeric"
            value={newDeltaText}
            onChange={(event) => setDeltaText(NEW_ROW_KEY, event.target.value)}
            placeholder={newDraft.amountMode === "COUNT_MULTIPLIER" ? "10" : "1 or -1"}
          />
        </label>
        <label className="settings-field" style={FIELD_STYLES.max}>
          Max payout
          <input
            type="text"
            inputMode="numeric"
            value={newMaxText}
            disabled={newDraft.amountMode !== "COUNT_MULTIPLIER"}
            onChange={(event) => setMaxText(NEW_ROW_KEY, event.target.value)}
            placeholder={newDraft.amountMode === "COUNT_MULTIPLIER" ? "10000" : ""}
          />
        </label>
        <label className="settings-field" style={FIELD_STYLES.note}>
          Label
          <input
            title="Internal label — shown only on the dashboard"
            value={newDraft.description ?? ""}
            onChange={(event) => setNewDraft({ ...newDraft, description: event.target.value })}
            placeholder="dashboard label (optional)"
          />
        </label>
        <label className="settings-field" style={FIELD_STYLES.enabled}>
          Enabled
          <input
            type="checkbox"
            checked={newDraft.enabled}
            onChange={(event) => setNewDraft({ ...newDraft, enabled: event.target.checked })}
          />
        </label>
        <div style={{ ...FIELD_STYLES.actions, display: "flex" }}>
          <button type="button" onClick={() => void handleCreate()} disabled={!canSubmitNew}>
            Add reaction rule
          </button>
        </div>
      </div>
    </fieldset>
  );
}
