import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    globals: true,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60_000,
  },
});
