import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";
import { StorageService } from "../src/services/storage-service.js";

function createStorageService() {
  const env = loadEnv({
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/points_accelerator_test",
    GUILD_ID: "guild-test",
    ADMIN_TOKEN: "test-admin-token",
    PORT: 1,
    MESSAGE_REWARD_COOLDOWN_SECONDS: 1,
  });
  return new StorageService(env);
}

describe("storage service", () => {
  it("serves mp4 uploads with video/mp4 even when Discord reports QuickTime", () => {
    const service = createStorageService() as unknown as {
      normaliseUploadMetadata(params: { contentType: string; originalFilename?: string }): { contentType: string };
    };

    expect(
      service.normaliseUploadMetadata({
        contentType: "video/quicktime",
        originalFilename: "sample submission video.mp4",
      }),
    ).toEqual({ contentType: "video/mp4" });
  });

  it("keeps macOS mov screen recordings as QuickTime", () => {
    const service = createStorageService() as unknown as {
      normaliseUploadMetadata(params: { contentType: string; originalFilename?: string }): { contentType: string };
    };

    expect(
      service.normaliseUploadMetadata({
        contentType: "video/quicktime",
        originalFilename: "Screen Recording 2026-05-09 at 08.42.45.mov",
      }),
    ).toEqual({ contentType: "video/quicktime" });
  });
});
