import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    globals: true,
    hookTimeout: 60_000,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60_000,
  },
});
