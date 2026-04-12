import { useEffect, useState } from "react";

import { api } from "../services/api";
import type { PublicLeaderboardPayload } from "../types";
import ThemeToggle from "./ThemeToggle";

type PublicLeaderboardPageProps = {
  shareToken: string;
};

function useNoIndexMeta() {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !meta;
    const previous = meta ? meta.getAttribute("content") : null;

    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.append(meta);
    }

    meta.setAttribute("content", "noindex, nofollow");

    return () => {
      if (!meta) {
        return;
      }

      if (created) {
        meta.remove();
        return;
      }

      if (previous === null) {
        meta.removeAttribute("content");
        return;
      }

      meta.setAttribute("content", previous);
    };
  }, []);
}

export default function PublicLeaderboardPage({ shareToken }: PublicLeaderboardPageProps) {
  const [payload, setPayload] = useState<PublicLeaderboardPayload | null>(null);
  const [status, setStatus] = useState("Loading leaderboard...");

  useNoIndexMeta();

  useEffect(() => {
    let cancelled = false;

    const loadLeaderboard = async () => {
      try {
        const nextPayload = await api.publicLeaderboard(shareToken);
        if (!cancelled) {
          setPayload(nextPayload);
          setStatus("");
          document.title = `${nextPayload.appName} leaderboard`;
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not load the leaderboard.");
          document.title = "Leaderboard unavailable";
        }
      }
    };

    void loadLeaderboard();

    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  return (
    <main className="shell public-shell">
      <div className="shell-toolbar">
        <ThemeToggle />
      </div>

      <section className="public-leaderboard">
        <header className="public-leaderboard__hero">
          <p className="public-leaderboard__eyebrow">Unlisted leaderboard</p>
          <h1>{payload ? `${payload.appName} leaderboard` : "Leaderboard"}</h1>
          <p className="public-leaderboard__copy">
            Shared privately by staff. This page is read-only and only shows the live points standings.
          </p>
        </header>

        {payload ? (
          <section className="section leaderboard-panel public-leaderboard__panel" aria-labelledby="public-leaderboard-heading">
            <header className="section-header">
              <h2 id="public-leaderboard-heading">Current standings</h2>
            </header>
            <div className="matrix-scroll matrix-scroll--flush">
              <table className="matrix-table leaderboard-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Group</th>
                    <th scope="col">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.leaderboard.map((group, index) => (
                    <tr key={group.id}>
                      <td className="leaderboard-table__num">{index + 1}</td>
                      <td>{group.displayName}</td>
                      <td className="leaderboard-table__num">
                        {group.pointsBalance} {payload.pointsName}
                      </td>
                    </tr>
                  ))}
                  {payload.leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty-cell">
                        No groups are on the leaderboard yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="section public-leaderboard__panel">
            <p className="status-bar">{status}</p>
          </section>
        )}
      </section>
    </main>
  );
}
