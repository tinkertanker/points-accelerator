import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  const managed = ensureTestDatabase();
  cleanupDatabase = managed.cleanup;
  ctx = await createTestApp(managed.url);
}, 60_000);

afterAll(async () => {
  await ctx.app.close();
  await ctx.prisma.$disconnect();
  await cleanupDatabase();
});

beforeEach(async () => {
  await resetDatabase(ctx.prisma, ctx.services);
});

describe("ConfigService cache", () => {
  it("returns the cached row on a second call without an extra upsert", async () => {
    const first = await ctx.services.configService.getOrCreate("guild-a");
    expect(first.guildId).toBe("guild-a");

    // A second call should hit the cache (same object identity is the signal
    // the cache served it rather than re-running the upsert).
    const second = await ctx.services.configService.getOrCreate("guild-a");
    expect(second).toBe(first);

    // Only one row exists — no duplicate create.
    const rows = await ctx.prisma.guildConfig.findMany({ where: { guildId: "guild-a" } });
    expect(rows).toHaveLength(1);
  });

  it("write-throughs update() so a subsequent getOrCreate sees the new value", async () => {
    await ctx.services.configService.getOrCreate("guild-a");
    await ctx.services.configService.update("guild-a", {
      appName: "New App Name",
      passiveCooldownSeconds: 99,
    });

    const cached = await ctx.services.configService.getOrCreate("guild-a");
    expect(cached.appName).toBe("New App Name");
    expect(cached.passiveCooldownSeconds).toBe(99);
  });

  it("write-throughs markAnnounced so a subsequent getOrCreate sees the bump", async () => {
    await ctx.services.configService.getOrCreate("guild-a");
    await ctx.services.configService.markAnnounced("guild-a", "1.2.3");

    const cached = await ctx.services.configService.getOrCreate("guild-a");
    expect(cached.lastAnnouncedVersion).toBe("1.2.3");
  });

  it("keeps cached config guild-scoped: guild-A's cache is not returned for guild-B", async () => {
    const a = await ctx.services.configService.getOrCreate("guild-a");
    const b = await ctx.services.configService.getOrCreate("guild-b");

    expect(a.guildId).toBe("guild-a");
    expect(b.guildId).toBe("guild-b");
    expect(a).not.toBe(b);

    // Updating guild-A must not leak into guild-B's cached value.
    await ctx.services.configService.update("guild-a", { appName: "A App" });
    const bAgain = await ctx.services.configService.getOrCreate("guild-b");
    expect(bAgain.appName).not.toBe("A App");
  });

  it("clearCache prevents a stale cached row from masking a missing row", async () => {
    // Simulate the test-harness scenario: cache a config, wipe the row out of
    // band, clear the cache, and confirm the next getOrCreate re-provisions
    // instead of returning a dangling reference.
    const cached = await ctx.services.configService.getOrCreate("guild-a");
    await ctx.prisma.guildConfig.deleteMany({ where: { guildId: "guild-a" } });
    ctx.services.configService.clearCache();

    const reProvisioned = await ctx.services.configService.getOrCreate("guild-a");
    expect(reProvisioned.createdAt.getTime()).toBeGreaterThanOrEqual(cached.createdAt.getTime());
    // The row actually exists again (foreign keys would pass).
    const row = await ctx.prisma.guildConfig.findUnique({ where: { guildId: "guild-a" } });
    expect(row).not.toBeNull();
  });
});
