import { useState } from "react";

import type { BootstrapPayload } from "../types";

type ActivityPanelProps = {
  bootstrap: BootstrapPayload;
  publicLeaderboardUrl: string | null;
};

export default function ActivityPanel({ bootstrap, publicLeaderboardUrl }: ActivityPanelProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopyLink = async () => {
    if (!publicLeaderboardUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(publicLeaderboardUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <div className="panel-stack">
      <section className="section leaderboard-section">
        <header className="section-header">
          <h2>Track the leaderboard and ledger</h2>
        </header>

        {publicLeaderboardUrl ? (
          <aside className="leaderboard-share">
            <div>
              <h3>Unlisted web leaderboard</h3>
              <p>Share this private link when someone wants the public points leaderboard without dashboard access.</p>
            </div>
            <div className="leaderboard-share__controls">
              <input aria-label="Public leaderboard link" readOnly value={publicLeaderboardUrl} />
              <button type="button" onClick={() => void handleCopyLink()}>
                {copyStatus === "copied" ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="leaderboard-share__note">
              {copyStatus === "failed"
                ? "Clipboard copy failed. You can still copy the link manually."
                : "It is not linked anywhere else in the app, so it stays low-profile."}
            </p>
          </aside>
        ) : null}

        <section aria-labelledby="leaderboard-heading" className="leaderboard-panel">
          <h3 id="leaderboard-heading">Leaderboard</h3>
          <div className="matrix-scroll matrix-scroll--flush">
            <table className="matrix-table leaderboard-table">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Points</th>
                  <th scope="col">Currency</th>
                </tr>
              </thead>
              <tbody>
                {bootstrap.leaderboard.map((group) => (
                  <tr key={group.id}>
                    <td>{group.displayName}</td>
                    <td className="leaderboard-table__num">{group.pointsBalance}</td>
                    <td className="leaderboard-table__num">{group.currencyBalance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

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
      </section>
    </div>
  );
}
