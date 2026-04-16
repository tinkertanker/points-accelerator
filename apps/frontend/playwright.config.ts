import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:4199",
    trace: "on-first-retry",
  },
  webServer: {
    command: "VITE_API_BASE_URL=http://127.0.0.1:4199 npm run dev -- --host 127.0.0.1 --port 4199",
    port: 4199,
    reuseExistingServer: false,
  },
});
