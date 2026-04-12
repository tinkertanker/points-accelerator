import type { BootstrapPayload } from "../types";

type ActivityPanelProps = {
  bootstrap: BootstrapPayload;
  canViewLedger: boolean;
  showCurrencyBalances: boolean;
};

export default function ActivityPanel({
  bootstrap,
  canViewLedger,
  showCurrencyBalances,
}: ActivityPanelProps) {
  return (
    <div className="panel-stack">
      <section className="section leaderboard-section">
        <header className="section-header">
          <h2>{canViewLedger ? "Track the leaderboard and ledger" : "View the leaderboard"}</h2>
        </header>

        <section aria-labelledby="leaderboard-heading" className="leaderboard-panel">
          <h3 id="leaderboard-heading">Leaderboard</h3>
          <div className="matrix-scroll matrix-scroll--flush">
            <table className="matrix-table leaderboard-table">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Points</th>
                  {showCurrencyBalances ? <th scope="col">Currency</th> : null}
                </tr>
              </thead>
              <tbody>
                {bootstrap.leaderboard.map((group) => (
                  <tr key={group.id}>
                    <td>{group.displayName}</td>
                    <td className="leaderboard-table__num">{group.pointsBalance}</td>
                    {showCurrencyBalances ? (
                      <td className="leaderboard-table__num">{group.currencyBalance}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {canViewLedger ? (
          <section aria-labelledby="ledger-heading" className="ledger-panel">
            <h3 id="ledger-heading">Ledger</h3>
            <div className="matrix-scroll matrix-scroll--flush">
              <table className="matrix-table ledger-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">When</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {bootstrap.ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="ledger-table__type">{entry.type}</td>
                      <td className="ledger-table__when">
                        <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                      </td>
                      <td>{entry.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
