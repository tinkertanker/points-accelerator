import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function applyPublicLeaderboardNoIndexHeader(url: string | undefined, setHeader: (name: string, value: string) => void) {
  const pathname = (url ?? "").split("?")[0];
  if (!pathname.startsWith("/l/")) {
    return;
  }

  setHeader("X-Robots-Tag", "noindex, nofollow");
}

function publicLeaderboardNoIndexPlugin() {
  return {
    name: "public-leaderboard-noindex",
    configureServer(server: { middlewares: { use: (handler: (req: { url?: string }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        applyPublicLeaderboardNoIndexHeader(req.url, res.setHeader.bind(res));
        next();
      });
    },
    configurePreviewServer(server: { middlewares: { use: (handler: (req: { url?: string }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        applyPublicLeaderboardNoIndexHeader(req.url, res.setHeader.bind(res));
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [publicLeaderboardNoIndexPlugin(), react()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/**"],
  },
});
