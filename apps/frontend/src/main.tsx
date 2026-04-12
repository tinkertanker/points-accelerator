import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import PublicLeaderboardPage from "./components/PublicLeaderboardPage";

function getPublicLeaderboardToken(pathname: string) {
  const match = /^\/l\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

const publicLeaderboardToken =
  typeof window === "undefined" ? null : getPublicLeaderboardToken(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publicLeaderboardToken ? <PublicLeaderboardPage shareToken={publicLeaderboardToken} /> : <App />}
  </React.StrictMode>,
);
