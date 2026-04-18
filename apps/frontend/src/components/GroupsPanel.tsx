import type { GroupDraft, Participant } from "../types";

type GroupsPanelProps = {
  participants: Participant[];
  groupDrafts: GroupDraft[];
  isBusy: boolean;
  onGroupDraftsChange: (next: GroupDraft[]) => void;
  onSaveGroups: () => Promise<void>;
};

export default function GroupsPanel({
  participants,
  groupDrafts,
  isBusy,
  onGroupDraftsChange,
  onSaveGroups,
}: GroupsPanelProps) {
  return (
    <div className="panel-stack">
      <section className="panel-stack">
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
