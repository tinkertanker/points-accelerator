import { useMemo, useState } from "react";

import type { DiscordOption, ReactionRewardRule, ReactionRewardRuleDraft } from "../types";

type ReactionRulesEditorProps = {
  rules: ReactionRewardRule[];
  channels: DiscordOption[];
  currencyName: string;
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
  currencyDelta: 1,
  amountMode: "FIXED",
  maxCurrencyDelta: null,
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
  mode: { flex: "0 0 150px" },
  delta: { flex: "0 0 110px" },
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
    currencyDelta: rule.currencyDelta,
    amountMode: rule.amountMode,
    maxCurrencyDelta: rule.maxCurrencyDelta,
    description: rule.description ?? "",
    enabled: rule.enabled,
  };
}

function isDirty(rule: ReactionRewardRule, draft: ReactionRewardRuleDraft) {
  return (
    rule.channelId !== draft.channelId ||
    rule.botUserId !== draft.botUserId ||
    rule.emoji !== draft.emoji ||
    rule.currencyDelta !== draft.currencyDelta ||
    rule.amountMode !== draft.amountMode ||
    rule.maxCurrencyDelta !== draft.maxCurrencyDelta ||
    (rule.description ?? "") !== (draft.description ?? "") ||
    rule.enabled !== draft.enabled
  );
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
  const deltaTextFor = (key: string, fallback: number) =>
    deltaTexts[key] ?? String(fallback);
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

  const handleSave = async (rule: ReactionRewardRule) => {
    const draft = draftFor(rule);
    const text = deltaTextFor(rule.id, draft.currencyDelta);
    const parsed = parseDelta(text);
    const maxText = maxTextFor(rule.id, draft.maxCurrencyDelta);
    const parsedMax = parseOptionalPositive(maxText);
    const maxCurrencyDelta = draft.amountMode === "COUNT_MULTIPLIER" && maxText.trim() ? parsedMax : null;
    if (parsed === null || (draft.amountMode === "COUNT_MULTIPLIER" && maxCurrencyDelta === null)) return;
    const success = await onUpdate(rule.id, { ...draft, currencyDelta: parsed, maxCurrencyDelta });
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
    const text = deltaTextFor(NEW_ROW_KEY, newDraft.currencyDelta);
    const parsed = parseDelta(text);
    const maxText = maxTextFor(NEW_ROW_KEY, newDraft.maxCurrencyDelta);
    const parsedMax = parseOptionalPositive(maxText);
    const maxCurrencyDelta = newDraft.amountMode === "COUNT_MULTIPLIER" && maxText.trim() ? parsedMax : null;
    if (parsed === null || (newDraft.amountMode === "COUNT_MULTIPLIER" && maxCurrencyDelta === null)) return;
    const success = await onCreate({ ...newDraft, currencyDelta: parsed, maxCurrencyDelta });
    if (success) {
      // Keep channel + bot ID — admins typically add several rules per bot.
      setNewDraft({
        channelId: newDraft.channelId,
        botUserId: newDraft.botUserId,
        emoji: "",
        currencyDelta: 1,
        amountMode: newDraft.amountMode,
        maxCurrencyDelta: newDraft.amountMode === "COUNT_MULTIPLIER" ? maxCurrencyDelta : null,
        description: "",
        enabled: true,
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

  const newDeltaText = deltaTextFor(NEW_ROW_KEY, newDraft.currencyDelta);
  const newDeltaValid = parseDelta(newDeltaText) !== null;
  const newMaxText = maxTextFor(NEW_ROW_KEY, newDraft.maxCurrencyDelta);
  const newMaxValid =
    newDraft.amountMode !== "COUNT_MULTIPLIER" || parseOptionalPositive(newMaxText) !== null;
  const canSubmitNew =
    !isBusy &&
    Boolean(newDraft.channelId) &&
    newDraft.botUserId.trim().length > 0 &&
    newDraft.emoji.trim().length > 0 &&
    newDeltaValid &&
    newMaxValid;

  return (
    <fieldset className="settings-section span-full">
      <legend>Bot reaction rewards</legend>
      <p className="role-checklist__help">
        Award or deduct {currencyName} when a configured bot reacts to a message in a chosen channel. Fixed
        amount pays the configured delta. Count multiplier reads a number at the start of the message and
        pays number x delta, capped at the configured maximum payout.
      </p>

      {rules.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
          {rules.map((rule) => {
            const draft = draftFor(rule);
            const text = deltaTextFor(rule.id, draft.currencyDelta);
            const parsed = parseDelta(text);
            const maxText = maxTextFor(rule.id, draft.maxCurrencyDelta);
            const parsedMax = parseOptionalPositive(maxText);
            const maxCurrencyDelta =
              draft.amountMode === "COUNT_MULTIPLIER" && maxText.trim() ? parsedMax : null;
            const dirty =
              isDirty(rule, draft) ||
              (parsed !== null && parsed !== draft.currencyDelta) ||
              maxCurrencyDelta !== draft.maxCurrencyDelta;
            const maxValid = draft.amountMode !== "COUNT_MULTIPLIER" || maxCurrencyDelta !== null;
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
                <label className="settings-field" style={FIELD_STYLES.mode}>
                  Reward mode
                  <select
                    aria-label="Reward mode"
                    value={draft.amountMode}
                    onChange={(event) =>
                      updateDraft(rule.id, {
                        ...draft,
                        amountMode: event.target.value as ReactionRewardRuleDraft["amountMode"],
                        maxCurrencyDelta:
                          event.target.value === "COUNT_MULTIPLIER" ? draft.maxCurrencyDelta : null,
                      })
                    }
                  >
                    <option value="FIXED">Fixed amount</option>
                    <option value="COUNT_MULTIPLIER">Count multiplier</option>
                  </select>
                </label>
                <label className="settings-field" style={FIELD_STYLES.delta}>
                  {draft.amountMode === "COUNT_MULTIPLIER" ? `${currencyName} per count` : `${currencyName} delta`}
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Currency amount"
                    value={text}
                    onChange={(event) => setDeltaText(rule.id, event.target.value)}
                    onBlur={() => {
                      if (parsed !== null) {
                        updateDraft(rule.id, { ...draft, currencyDelta: parsed });
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
                      if (maxCurrencyDelta !== null) {
                        updateDraft(rule.id, { ...draft, maxCurrencyDelta });
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
        <label className="settings-field" style={FIELD_STYLES.mode}>
          Reward mode
          <select
            value={newDraft.amountMode}
            onChange={(event) =>
              setNewDraft({
                ...newDraft,
                amountMode: event.target.value as ReactionRewardRuleDraft["amountMode"],
                maxCurrencyDelta: event.target.value === "COUNT_MULTIPLIER" ? newDraft.maxCurrencyDelta : null,
              })
            }
          >
            <option value="FIXED">Fixed amount</option>
            <option value="COUNT_MULTIPLIER">Count multiplier</option>
          </select>
        </label>
        <label className="settings-field" style={FIELD_STYLES.delta}>
          {newDraft.amountMode === "COUNT_MULTIPLIER" ? `${currencyName} per count` : `${currencyName} delta`}
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
