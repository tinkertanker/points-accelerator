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

const EMPTY_DRAFT: ReactionRewardRuleDraft = {
  channelId: "",
  botUserId: "",
  emoji: "",
  currencyDelta: 1,
  description: "",
  enabled: true,
};

function ruleToDraft(rule: ReactionRewardRule): ReactionRewardRuleDraft {
  return {
    id: rule.id,
    channelId: rule.channelId,
    botUserId: rule.botUserId,
    emoji: rule.emoji,
    currencyDelta: rule.currencyDelta,
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
    (rule.description ?? "") !== (draft.description ?? "") ||
    rule.enabled !== draft.enabled
  );
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

  const draftFor = (rule: ReactionRewardRule) => drafts[rule.id] ?? ruleToDraft(rule);

  const updateDraft = (id: string, next: ReactionRewardRuleDraft) => {
    setDrafts((prev) => ({ ...prev, [id]: next }));
  };

  const resetDraft = (id: string) => {
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const handleSave = async (rule: ReactionRewardRule) => {
    const draft = draftFor(rule);
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
    const success = await onCreate(newDraft);
    if (success) {
      setNewDraft(EMPTY_DRAFT);
    }
  };

  const renderChannelOptions = () =>
    sortedChannels.map((channel) => (
      <option key={channel.id} value={channel.id}>
        #{channel.name}
      </option>
    ));

  return (
    <fieldset className="settings-section span-full">
      <legend>Bot reaction rewards</legend>
      <p className="role-checklist__help">
        Award or deduct {currencyName} when a configured bot reacts to a message in a chosen channel. The
        message author receives the delta. Find a bot's user ID by enabling Discord Developer Mode and
        right-clicking the bot user.
      </p>

      {rules.length === 0 ? (
        <p className="channel-picker__empty">No reaction rules yet. Add one below.</p>
      ) : (
        <div className="capability-matrix">
          <div className="matrix-scroll">
            <table className="matrix-table capability-table">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Bot user ID</th>
                  <th scope="col">Emoji</th>
                  <th scope="col">{currencyName} delta</th>
                  <th scope="col">Note</th>
                  <th scope="col">Enabled</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const draft = draftFor(rule);
                  const dirty = isDirty(rule, draft);
                  return (
                    <tr key={rule.id}>
                      <td>
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
                      </td>
                      <td>
                        <input
                          aria-label="Bot user ID"
                          value={draft.botUserId}
                          onChange={(event) =>
                            updateDraft(rule.id, { ...draft, botUserId: event.target.value })
                          }
                          placeholder="e.g. 510016054391734273"
                        />
                      </td>
                      <td>
                        <input
                          aria-label="Emoji"
                          value={draft.emoji}
                          onChange={(event) =>
                            updateDraft(rule.id, { ...draft, emoji: event.target.value })
                          }
                          placeholder="✅"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          aria-label="Currency delta"
                          value={draft.currencyDelta}
                          onChange={(event) =>
                            updateDraft(rule.id, {
                              ...draft,
                              currencyDelta: Number(event.target.value),
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label="Note"
                          value={draft.description ?? ""}
                          onChange={(event) =>
                            updateDraft(rule.id, { ...draft, description: event.target.value })
                          }
                          placeholder="optional"
                        />
                      </td>
                      <td className="capability-table__cap">
                        <input
                          type="checkbox"
                          aria-label="Enabled"
                          checked={draft.enabled}
                          onChange={(event) =>
                            updateDraft(rule.id, { ...draft, enabled: event.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void handleSave(rule)}
                          disabled={isBusy || !dirty}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="settings-section__grid settings-section__grid--reward">
        <label className="settings-field">
          Channel
          <select
            value={newDraft.channelId}
            onChange={(event) => setNewDraft({ ...newDraft, channelId: event.target.value })}
          >
            <option value="">Select channel</option>
            {renderChannelOptions()}
          </select>
        </label>
        <label className="settings-field">
          Bot user ID
          <input
            value={newDraft.botUserId}
            onChange={(event) => setNewDraft({ ...newDraft, botUserId: event.target.value })}
            placeholder="e.g. 510016054391734273"
          />
        </label>
        <label className="settings-field">
          Emoji
          <input
            value={newDraft.emoji}
            onChange={(event) => setNewDraft({ ...newDraft, emoji: event.target.value })}
            placeholder="✅"
          />
        </label>
        <label className="settings-field">
          {currencyName} delta
          <input
            type="number"
            value={newDraft.currencyDelta}
            onChange={(event) =>
              setNewDraft({ ...newDraft, currencyDelta: Number(event.target.value) })
            }
          />
        </label>
        <label className="settings-field">
          Note
          <input
            value={newDraft.description ?? ""}
            onChange={(event) => setNewDraft({ ...newDraft, description: event.target.value })}
            placeholder="optional"
          />
        </label>
        <label className="settings-field">
          Enabled
          <input
            type="checkbox"
            checked={newDraft.enabled}
            onChange={(event) => setNewDraft({ ...newDraft, enabled: event.target.checked })}
          />
        </label>
      </div>
      <div className="capability-matrix-add">
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={
            isBusy ||
            !newDraft.channelId ||
            !newDraft.botUserId.trim() ||
            !newDraft.emoji.trim() ||
            !Number.isFinite(newDraft.currencyDelta) ||
            newDraft.currencyDelta === 0
          }
        >
          Add reaction rule
        </button>
      </div>
    </fieldset>
  );
}
