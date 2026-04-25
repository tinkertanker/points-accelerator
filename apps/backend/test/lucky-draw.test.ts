import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { LuckyDrawService } from "../src/services/lucky-draw-service.js";
import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

const GUILD_ID = "guild-test";

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
  await resetDatabase(ctx.prisma);
  await ctx.services.configService.getOrCreate(GUILD_ID);
});

describe("LuckyDrawService.selectWinners", () => {
  it("returns the requested number of distinct entrants", () => {
    const seq = [0, 0, 0];
    const service = new LuckyDrawService(ctx.prisma, () => seq.shift() ?? 0);
    const entries = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const winners = service.selectWinners(entries, 3);
    expect(winners).toHaveLength(3);
    expect(new Set(winners.map((w) => w.id)).size).toBe(3);
  });

  it("returns every entrant when count exceeds the pool size", () => {
    const service = new LuckyDrawService(ctx.prisma, () => 0);
    const entries = [{ id: "a" }, { id: "b" }];
    const winners = service.selectWinners(entries, 5);
    expect(winners).toHaveLength(2);
  });

  it("returns an empty array for an empty pool", () => {
    const service = new LuckyDrawService(ctx.prisma);
    expect(service.selectWinners([], 3)).toEqual([]);
  });
});

describe("LuckyDrawService entries + settlement", () => {
  it("rejects duplicate entries with a friendly error", async () => {
    const draw = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    await ctx.services.luckyDrawService.recordEntry({
      drawId: draw.id,
      userId: "user-1",
    });
    await expect(
      ctx.services.luckyDrawService.recordEntry({ drawId: draw.id, userId: "user-1" }),
    ).rejects.toThrow(/already in this draw/i);
  });

  it("rejects entries on a draw that has ended", async () => {
    const draw = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    await ctx.services.luckyDrawService.settle(draw.id);
    await expect(
      ctx.services.luckyDrawService.recordEntry({ drawId: draw.id, userId: "user-late" }),
    ).rejects.toThrow(/already ended/i);
  });

  it("settle marks winners and is idempotent", async () => {
    const draw = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 25,
      winnerCount: 2,
      durationMs: 60_000,
    });
    for (const userId of ["alice", "bob", "carol", "dave"]) {
      await ctx.services.luckyDrawService.recordEntry({ drawId: draw.id, userId });
    }

    const first = await ctx.services.luckyDrawService.settle(draw.id);
    expect(first.alreadySettled).toBe(false);
    expect(first.winners).toHaveLength(2);
    expect(first.draw.status).toBe("COMPLETED");

    const winnerIds = new Set(first.winners.map((w) => w.userId));
    expect(winnerIds.size).toBe(2);

    const second = await ctx.services.luckyDrawService.settle(draw.id);
    expect(second.alreadySettled).toBe(true);
    expect(second.winners.map((w) => w.userId).sort()).toEqual([...winnerIds].sort());
  });

  it("settle on an empty draw still completes with no winners", async () => {
    const draw = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    const result = await ctx.services.luckyDrawService.settle(draw.id);
    expect(result.alreadySettled).toBe(false);
    expect(result.winners).toEqual([]);
    expect(result.draw.status).toBe("COMPLETED");
  });

  it("listResumable only returns ACTIVE draws", async () => {
    const active = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    const settled = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    await ctx.services.luckyDrawService.settle(settled.id);

    const resumable = await ctx.services.luckyDrawService.listResumable(GUILD_ID);
    expect(resumable.map((d) => d.id)).toEqual([active.id]);
  });
});
