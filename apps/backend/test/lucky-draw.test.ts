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

  it("rejects entries on a draw whose status is no longer ACTIVE", async () => {
    const draw = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    await ctx.services.luckyDrawService.markCompleted(draw.id);
    await expect(
      ctx.services.luckyDrawService.recordEntry({ drawId: draw.id, userId: "user-late" }),
    ).rejects.toThrow(/already ended/i);
  });

  it("settle picks winners on first call and is idempotent on retry", async () => {
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
    expect(first.freshlyPicked).toBe(true);
    expect(first.winners).toHaveLength(2);
    expect(first.draw.status).toBe("ACTIVE");
    expect(first.draw.paidOutAt).toBeNull();

    const winnerIds = new Set(first.winners.map((w) => w.userId));
    expect(winnerIds.size).toBe(2);

    const second = await ctx.services.luckyDrawService.settle(draw.id);
    expect(second.freshlyPicked).toBe(false);
    expect(second.winners.map((w) => w.userId).sort()).toEqual([...winnerIds].sort());
  });

  it("settle on an empty draw selects no winners and stays ACTIVE pending payout", async () => {
    const draw = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    const result = await ctx.services.luckyDrawService.settle(draw.id);
    expect(result.freshlyPicked).toBe(true);
    expect(result.winners).toEqual([]);
    expect(result.draw.status).toBe("ACTIVE");
  });

  it("rejects new entries against a draw that has already been settled", async () => {
    const draw = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    await ctx.services.luckyDrawService.recordEntry({ drawId: draw.id, userId: "early" });
    await ctx.services.luckyDrawService.settle(draw.id);
    await ctx.services.luckyDrawService.markCompleted(draw.id);
    await expect(
      ctx.services.luckyDrawService.recordEntry({ drawId: draw.id, userId: "late" }),
    ).rejects.toThrow(/already ended/i);
  });

  it("listResumable returns ACTIVE draws and COMPLETED-but-unpaid draws (not fully paid ones)", async () => {
    const active = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    const crashed = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    // crashed draw: completed but never marked paid
    await ctx.services.luckyDrawService.markCompleted(crashed.id);

    const fullyDone = await ctx.services.luckyDrawService.create({
      guildId: GUILD_ID,
      channelId: "channel-1",
      createdByUserId: "staff-1",
      prizeAmount: 10,
      winnerCount: 1,
      durationMs: 60_000,
    });
    await ctx.services.luckyDrawService.markPaidOut(fullyDone.id);
    await ctx.services.luckyDrawService.markCompleted(fullyDone.id);

    const resumable = await ctx.services.luckyDrawService.listResumable(GUILD_ID);
    expect(resumable.map((d) => d.id).sort()).toEqual([active.id, crashed.id].sort());
  });
});
