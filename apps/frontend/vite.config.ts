import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  esbuild:
    command === "build"
      ? {
          // Drop debug noise from production bundles. console.warn/error still ship so prod errors surface.
          drop: ["debugger"],
          pure: ["console.log", "console.debug", "console.info"],
        }
      : undefined,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/**"],
  },
}));
