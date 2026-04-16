import type { DiscordOption, GroupDraft, Participant } from "../types";

type GroupsPanelProps = {
  participants: Participant[];
  groupDrafts: GroupDraft[];
  discordRoles: DiscordOption[];
  isBusy: boolean;
  createGroupDraft: () => GroupDraft;
  slugify: (value: string) => string;
  onGroupDraftsChange: (next: GroupDraft[]) => void;
  onSaveGroups: () => Promise<void>;
};

export default function GroupsPanel({
  participants,
  groupDrafts,
  discordRoles,
  isBusy,
  createGroupDraft,
  slugify,
  onGroupDraftsChange,
  onSaveGroups,
}: GroupsPanelProps) {
  return (
    <div className="panel-stack">
      <section className="panel-stack">
        <article className="section">
          <header className="section-header">
            <h2>Map Discord roles to student groups</h2>
            <button className="primary-action" type="button" onClick={() => void onSaveGroups()} disabled={isBusy}>
              Save Groups
            </button>
          </header>
          <div className="group-mapping-matrix">
            <div className="matrix-scroll">
              <table className="matrix-table group-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-role">
                      Discord role
                    </th>
                    <th scope="col" className="col-display">
                      Display name
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
                  {groupDrafts.map((group, index) => (
                    <tr key={`${group.id ?? "new"}-${index}`}>
                      <td className="col-role">
                        <select
                          value={group.roleId}
                          aria-label="Discord role"
                          onChange={(event) => {
                            const selected = discordRoles.find((candidate) => candidate.id === event.target.value);
                            const next = [...groupDrafts];
                            const displayName = selected?.name ?? group.displayName;
                            const slug = group.slug || slugify(displayName);
                            next[index] = {
                              ...group,
                              roleId: event.target.value,
                              displayName,
                              slug,
                            };
                            onGroupDraftsChange(next);
                          }}
                        >
                          <option value="">Select role</option>
                          {discordRoles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="col-display">
                        <input
                          value={group.displayName}
                          aria-label="Display name"
                          onChange={(event) => {
                            const next = [...groupDrafts];
                            next[index] = { ...group, displayName: event.target.value };
                            onGroupDraftsChange(next);
                          }}
                          placeholder="Team name"
                        />
                      </td>
                      <td className="col-aliases">
                        <input
                          value={group.aliasesText}
                          aria-label="Aliases"
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
                          aria-label="Active"
                          onChange={(event) => {
                            const next = [...groupDrafts];
                            next[index] = { ...group, active: event.target.checked };
                            onGroupDraftsChange(next);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="matrix-add-row"
              onClick={() => onGroupDraftsChange([...groupDrafts, createGroupDraft()])}
            >
              + Add group
            </button>
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
