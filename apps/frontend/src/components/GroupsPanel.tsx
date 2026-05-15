import { useEffect, useState } from "react";

import { api } from "../services/api";
import type { GroupDraft, GroupSuggestion, GroupSuggestionResponse, Participant } from "../types";

type GroupsPanelProps = {
  participants: Participant[];
  groupDrafts: GroupDraft[];
  isBusy: boolean;
  onGroupDraftsChange: (next: GroupDraft[]) => void;
  onSaveGroups: () => Promise<void>;
  onSuggestionApplied: () => Promise<void>;
};

export default function GroupsPanel({
  participants,
  groupDrafts,
  isBusy,
  onGroupDraftsChange,
  onSaveGroups,
  onSuggestionApplied,
}: GroupsPanelProps) {
  const [suggestions, setSuggestions] = useState<GroupSuggestionResponse | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [applyingRoleIds, setApplyingRoleIds] = useState<string[] | null>(null);

  const knownGroupRoleIds = new Set(groupDrafts.map((draft) => draft.roleId));

  const loadSuggestions = async () => {
    setIsDetecting(true);
    setDetectError(null);
    try {
      const next = await api.fetchGroupSuggestions();
      setSuggestions(next);
    } catch (error) {
      setDetectError(error instanceof Error ? error.message : "Could not load suggestions.");
    } finally {
      setIsDetecting(false);
    }
  };

  useEffect(() => {
    void loadSuggestions();
    // We only want to load once per mount; tab/guild change remounts this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = async (suggestion: GroupSuggestion) => {
    setApplyingRoleIds(suggestion.roleIds);
    setDetectError(null);
    try {
      await api.applyGroupSuggestion(suggestion.roleIds);
      await onSuggestionApplied();
      await loadSuggestions();
    } catch (error) {
      setDetectError(error instanceof Error ? error.message : "Could not apply suggestion.");
    } finally {
      setApplyingRoleIds(null);
    }
  };

  const visibleSuggestions: GroupSuggestion[] = [];
  if (suggestions?.primary) {
    visibleSuggestions.push(suggestions.primary);
  }
  for (const alt of suggestions?.alternatives ?? []) {
    visibleSuggestions.push(alt);
  }

  const renderSuggestion = (suggestion: GroupSuggestion, index: number) => {
    const alreadyMapped = suggestion.roleIds.every((roleId) => knownGroupRoleIds.has(roleId));
    const partiallyMapped =
      !alreadyMapped && suggestion.roleIds.some((roleId) => knownGroupRoleIds.has(roleId));
    const isApplyingThis =
      applyingRoleIds !== null &&
      applyingRoleIds.length === suggestion.roleIds.length &&
      applyingRoleIds.every((roleId, i) => roleId === suggestion.roleIds[i]);

    return (
      <li key={`${suggestion.kind}-${index}`} className="suggestion-row">
        <div className="suggestion-row__header">
          <strong>{suggestion.label}</strong>
          <span className="suggestion-row__badge">
            {Math.round(suggestion.coverage * 100)}% covered · {Math.round(suggestion.exclusivity * 100)}% exclusive
          </span>
        </div>
        <div className="suggestion-row__roles">
          {suggestion.roles.map((role) => (
            <span key={role.id} className="suggestion-chip">
              {role.name}
            </span>
          ))}
        </div>
        <div className="suggestion-row__actions">
          {alreadyMapped ? (
            <span className="section-help">Already mapped as groups.</span>
          ) : (
            <button
              type="button"
              className="primary-action"
              onClick={() => void handleApply(suggestion)}
              disabled={isBusy || applyingRoleIds !== null}
            >
              {isApplyingThis
                ? "Applying…"
                : partiallyMapped
                ? "Add remaining as groups"
                : "Use these as student groups"}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="panel-stack">
      <section className="panel-stack">
        <article className="section">
          <header className="section-header">
            <div>
              <h2>Suggested student groups</h2>
              <p className="section-help">
                Inspects how members are spread across roles and proposes the roles that look like student groups.
                Applying a suggestion flips the matching roles to Group role + Receivable so the bot starts treating
                them as point-receiving groups.
              </p>
            </div>
            <button
              className="primary-action"
              type="button"
              onClick={() => void loadSuggestions()}
              disabled={isDetecting || isBusy}
            >
              {isDetecting ? "Detecting…" : "Re-detect"}
            </button>
          </header>
          {detectError && <p className="section-help section-help--warning">{detectError}</p>}
          {isDetecting && !suggestions ? (
            <p className="section-help">Inspecting guild roster…</p>
          ) : visibleSuggestions.length === 0 ? (
            <p className="section-help">
              {suggestions
                ? `Looked at ${suggestions.evaluatedRoleCount} role${suggestions.evaluatedRoleCount === 1 ? "" : "s"} across ${suggestions.totalHumanMembers} members and didn't find a clean partition. You can still mark roles as Group role + Receivable in Settings.`
                : "No suggestions loaded yet."}
            </p>
          ) : (
            <ul className="suggestion-list">{visibleSuggestions.map(renderSuggestion)}</ul>
          )}
        </article>

        <article className="section">
          <header className="section-header">
            <div>
              <h2>Aliases</h2>
              <p className="section-help">
                Any role marked as both Group role and Receivable in Settings is synced here automatically. Add aliases
                so staff can target groups with shorthand in commands.
              </p>
            </div>
            <button className="primary-action" type="button" onClick={() => void onSaveGroups()} disabled={isBusy}>
              Save Aliases
            </button>
          </header>
          <div className="group-mapping-matrix">
            <div className="matrix-scroll">
              <table className="matrix-table group-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-display">
                      Group
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
                  {groupDrafts.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty-cell">
                        No point-receiving group roles configured yet. Turn on Group role and Receivable in Settings
                        first.
                      </td>
                    </tr>
                  ) : (
                    groupDrafts.map((group, index) => (
                      <tr key={`${group.id ?? group.roleId}-${index}`}>
                        <td className="col-display">{group.displayName}</td>
                        <td className="col-aliases">
                          <input
                            value={group.aliasesText}
                            aria-label={`Aliases for ${group.displayName}`}
                            onChange={(event) => {
                              const next = [...groupDrafts];
                              next[index] = { ...group, aliasesText: event.target.value };
                              onGroupDraftsChange(next);
                            }}
                            placeholder="comma separated"
                          />
                        </td>
                        <td className="col-active">
                          <input
                            type="checkbox"
                            checked={group.active}
                            aria-label={`Active for ${group.displayName}`}
                            onChange={(event) => {
                              const next = [...groupDrafts];
                              next[index] = { ...group, active: event.target.checked };
                              onGroupDraftsChange(next);
                            }}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </article>

        <article className="section">
          <header className="section-header">
            <h2>Review participants</h2>
          </header>
          <div className="matrix-scroll">
            <table className="matrix-table participant-table">
              <thead>
                <tr>
                  <th scope="col">Index ID</th>
                  <th scope="col">Discord user</th>
                  <th scope="col">Group</th>
                  <th scope="col">Wallet</th>
                  <th scope="col">Registered</th>
                </tr>
              </thead>
              <tbody>
                {participants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      No participants discovered yet.
                    </td>
                  </tr>
                ) : (
                  participants.map((participant) => (
                    <tr key={participant.id}>
                      <td>{participant.indexId}</td>
                      <td>{participant.discordUsername ?? participant.discordUserId}</td>
                      <td>{participant.group.displayName}</td>
                      <td>{participant.currencyBalance}</td>
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
    </div>
  );
}
