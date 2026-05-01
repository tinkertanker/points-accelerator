import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  chunkGroupSplits,
  chunkParticipantSplits,
} from "../src/services/economy-reset-service.js";
import { decimal, decimalToNumber } from "../src/utils/decimal.js";

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

async function seedGroup(slug: string, roleId: string) {
  return ctx.prisma.group.create({
    data: {
      guildId: GUILD_ID,
      displayName: slug,
      slug,
      roleId,
    },
  });
}

async function seedParticipant(groupId: string, discordUserId: string, indexId: string) {
  return ctx.prisma.participant.create({
    data: {
      guildId: GUILD_ID,
      groupId,
      discordUserId,
      discordUsername: discordUserId,
      indexId,
    },
  });
}

async function recordParticipantEntry(params: {
  type: "MANUAL_AWARD" | "LUCKYDRAW_WIN" | "MESSAGE_REWARD";
  participantId: string;
  currencyDelta: number;
  createdAt: Date;
}) {
  return ctx.prisma.participantCurrencyEntry.create({
    data: {
      guildId: GUILD_ID,
      type: params.type,
      description: `${params.type} test`,
      createdByUserId: "tester",
      createdAt: params.createdAt,
      splits: {
        create: [{ participantId: params.participantId, currencyDelta: decimal(params.currencyDelta) }],
      },
    },
  });
}

async function recordGroupEntry(params: {
  type: "MANUAL_AWARD" | "LUCKYDRAW_WIN";
  groupId: string;
  pointsDelta: number;
  currencyDelta: number;
  createdAt: Date;
}) {
  return ctx.prisma.ledgerEntry.create({
    data: {
      guildId: GUILD_ID,
      type: params.type,
      description: `${params.type} test`,
      createdByUserId: "tester",
      createdAt: params.createdAt,
      splits: {
        create: [
          {
            groupId: params.groupId,
            pointsDelta: decimal(params.pointsDelta),
            currencyDelta: decimal(params.currencyDelta),
          },
        ],
      },
    },
  });
}

async function getParticipantBalance(participantId: string) {
  const grouped = await ctx.prisma.participantCurrencySplit.groupBy({
    by: ["participantId"],
    where: { participantId },
    _sum: { currencyDelta: true },
  });
  return decimalToNumber(grouped[0]?._sum.currencyDelta);
}

async function getGroupBalance(groupId: string) {
  const grouped = await ctx.prisma.ledgerSplit.groupBy({
    by: ["groupId"],
    where: { groupId },
    _sum: { pointsDelta: true, currencyDelta: true },
  });
  return {
    points: decimalToNumber(grouped[0]?._sum.pointsDelta),
    currency: decimalToNumber(grouped[0]?._sum.currencyDelta),
  };
}

describe("EconomyResetService.reverseEntriesByTypeSince", () => {
  it("dry run reports impact without writing CORRECTION entries", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const participant = await seedParticipant(group.id, "user-1", "p-1");
    const cutoff = new Date("2026-05-01T05:00:00Z");

    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: participant.id,
      currencyDelta: 100,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });
    await recordParticipantEntry({
      type: "LUCKYDRAW_WIN",
      participantId: participant.id,
      currencyDelta: 999_999_999_999,
      createdAt: new Date("2026-05-01T05:30:00Z"),
    });

    const result = await ctx.services.economyResetService.reverseEntriesByTypeSince({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      participantTypes: ["LUCKYDRAW_WIN"],
      since: cutoff,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.scannedParticipantEntries).toBe(1);
    expect(result.participantImpact).toHaveLength(1);
    expect(result.participantImpact[0]).toMatchObject({
      participantId: participant.id,
      balanceBefore: 999_999_999_999 + 100,
      delta: -999_999_999_999,
      balanceAfter: 100,
    });
    expect(result.totalCurrencyDelta).toBe(-999_999_999_999);
    expect(result.participantCorrectionEntryId).toBeNull();

    expect(await getParticipantBalance(participant.id)).toBe(999_999_999_999 + 100);
  });

  it("execute writes a CORRECTION entry that exactly reverses the targeted entries", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const p1 = await seedParticipant(group.id, "user-1", "p-1");
    const p2 = await seedParticipant(group.id, "user-2", "p-2");
    const cutoff = new Date("2026-05-01T05:00:00Z");

    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: p1.id,
      currencyDelta: 50,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });
    await recordParticipantEntry({
      type: "LUCKYDRAW_WIN",
      participantId: p1.id,
      currencyDelta: 1_000_000,
      createdAt: new Date("2026-05-01T06:00:00Z"),
    });
    await recordParticipantEntry({
      type: "LUCKYDRAW_WIN",
      participantId: p2.id,
      currencyDelta: 500_000,
      createdAt: new Date("2026-05-01T06:30:00Z"),
    });
    await recordParticipantEntry({
      type: "LUCKYDRAW_WIN",
      participantId: p2.id,
      currencyDelta: 200_000,
      createdAt: new Date("2026-05-01T07:00:00Z"),
    });

    const result = await ctx.services.economyResetService.reverseEntriesByTypeSince({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      participantTypes: ["LUCKYDRAW_WIN"],
      since: cutoff,
      dryRun: false,
      note: "Cleanup of 2026-05-01 abuse",
    });

    expect(result.scannedParticipantEntries).toBe(3);
    expect(result.participantCorrectionEntryId).toBeTruthy();
    expect(await getParticipantBalance(p1.id)).toBe(50);
    expect(await getParticipantBalance(p2.id)).toBe(0);

    const correction = await ctx.prisma.participantCurrencyEntry.findUnique({
      where: { id: result.participantCorrectionEntryId! },
      include: { splits: true },
    });
    expect(correction?.type).toBe("CORRECTION");
    expect(correction?.description).toBe("Cleanup of 2026-05-01 abuse");
    expect(correction?.splits).toHaveLength(2);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: "economy.reset.reverse_entries_since" },
    });
    expect(audit).toBeTruthy();
  });

  it("can take a balance negative if the abuser already spent the abused currency", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const participant = await seedParticipant(group.id, "user-1", "p-1");

    await recordParticipantEntry({
      type: "LUCKYDRAW_WIN",
      participantId: participant.id,
      currencyDelta: 1_000,
      createdAt: new Date("2026-05-01T06:00:00Z"),
    });
    await recordParticipantEntry({
      type: "MANUAL_DEDUCT" as never,
      participantId: participant.id,
      currencyDelta: -800,
      createdAt: new Date("2026-05-01T07:00:00Z"),
    });

    expect(await getParticipantBalance(participant.id)).toBe(200);

    const result = await ctx.services.economyResetService.reverseEntriesByTypeSince({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      participantTypes: ["LUCKYDRAW_WIN"],
      since: new Date("2026-05-01T05:00:00Z"),
      dryRun: false,
    });

    expect(result.participantCorrectionEntryId).toBeTruthy();
    expect(await getParticipantBalance(participant.id)).toBe(-800);
  });

  it("reverses group ledger entries when groupTypes is provided", async () => {
    const group = await seedGroup("alpha", "role-alpha");

    await recordGroupEntry({
      type: "MANUAL_AWARD",
      groupId: group.id,
      pointsDelta: 100,
      currencyDelta: 0,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });
    await recordGroupEntry({
      type: "LUCKYDRAW_WIN",
      groupId: group.id,
      pointsDelta: 9999,
      currencyDelta: 12_345,
      createdAt: new Date("2026-05-01T06:00:00Z"),
    });

    const result = await ctx.services.economyResetService.reverseEntriesByTypeSince({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      groupTypes: ["LUCKYDRAW_WIN"],
      since: new Date("2026-05-01T05:00:00Z"),
      dryRun: false,
    });

    expect(result.scannedGroupEntries).toBe(1);
    expect(result.groupCorrectionEntryId).toBeTruthy();
    expect(await getGroupBalance(group.id)).toEqual({ points: 100, currency: 0 });
  });

  it("rejects when no entry types are provided", async () => {
    await expect(
      ctx.services.economyResetService.reverseEntriesByTypeSince({
        guildId: GUILD_ID,
        actor: { userId: "admin-1", username: "Admin" },
        since: new Date(),
        dryRun: true,
      }),
    ).rejects.toThrow(/at least one entry type/i);
  });
});

describe("EconomyResetService.capBalances", () => {
  it("caps participants over the limit and leaves others alone", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const rich = await seedParticipant(group.id, "rich", "p-rich");
    const poor = await seedParticipant(group.id, "poor", "p-poor");

    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: rich.id,
      currencyDelta: 5_000,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });
    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: poor.id,
      currencyDelta: 50,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });

    const result = await ctx.services.economyResetService.capBalances({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      maxParticipantCurrency: 1_000,
      dryRun: false,
    });

    expect(result.participantImpact).toHaveLength(1);
    expect(result.participantImpact[0]).toMatchObject({
      participantId: rich.id,
      balanceBefore: 5_000,
      delta: -4_000,
      balanceAfter: 1_000,
    });
    expect(await getParticipantBalance(rich.id)).toBe(1_000);
    expect(await getParticipantBalance(poor.id)).toBe(50);
  });

  it("caps group points and currency independently", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    await recordGroupEntry({
      type: "MANUAL_AWARD",
      groupId: group.id,
      pointsDelta: 9_000,
      currencyDelta: 100,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });

    const result = await ctx.services.economyResetService.capBalances({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      maxGroupPoints: 500,
      dryRun: false,
    });

    expect(result.groupImpact).toHaveLength(1);
    expect(result.groupImpact[0]).toMatchObject({
      groupId: group.id,
      pointsBefore: 9_000,
      pointsDelta: -8_500,
      pointsAfter: 500,
      currencyBefore: 100,
      currencyDelta: 0,
      currencyAfter: 100,
    });
    expect(await getGroupBalance(group.id)).toEqual({ points: 500, currency: 100 });
  });

  it("dry run does not write any entries", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const participant = await seedParticipant(group.id, "rich", "p-rich");
    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: participant.id,
      currencyDelta: 5_000,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });

    const result = await ctx.services.economyResetService.capBalances({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      maxParticipantCurrency: 1_000,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.participantCorrectionEntryId).toBeNull();
    expect(await getParticipantBalance(participant.id)).toBe(5_000);
  });

  it("rejects when no cap values are provided", async () => {
    await expect(
      ctx.services.economyResetService.capBalances({
        guildId: GUILD_ID,
        actor: { userId: "admin-1", username: "Admin" },
        dryRun: true,
      }),
    ).rejects.toThrow(/at least one cap/i);
  });
});

describe("EconomyResetService.moduloBalances", () => {
  it("trims positive participant balances down to balance % modulus", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const huge = await seedParticipant(group.id, "huge", "p-huge");
    const small = await seedParticipant(group.id, "small", "p-small");
    const exact = await seedParticipant(group.id, "exact", "p-exact");

    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: huge.id,
      currencyDelta: 999_999_999_999,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });
    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: small.id,
      currencyDelta: 50,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });
    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: exact.id,
      currencyDelta: 1_000,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });

    const result = await ctx.services.economyResetService.moduloBalances({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      modulus: 1_000,
      applyToParticipantCurrency: true,
      dryRun: false,
    });

    expect(result.modulus).toBe(1_000);
    expect(result.participantImpact).toHaveLength(2);
    expect(await getParticipantBalance(huge.id)).toBe(999);
    expect(await getParticipantBalance(small.id)).toBe(50);
    expect(await getParticipantBalance(exact.id)).toBe(0);
  });

  it("ignores non-positive balances (no negative wrap-around)", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const negative = await seedParticipant(group.id, "neg", "p-neg");

    await recordParticipantEntry({
      type: "LUCKYDRAW_WIN",
      participantId: negative.id,
      currencyDelta: 1_000,
      createdAt: new Date("2026-05-01T06:00:00Z"),
    });
    await recordParticipantEntry({
      type: "MANUAL_DEDUCT" as never,
      participantId: negative.id,
      currencyDelta: -1_500,
      createdAt: new Date("2026-05-01T07:00:00Z"),
    });
    expect(await getParticipantBalance(negative.id)).toBe(-500);

    const result = await ctx.services.economyResetService.moduloBalances({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      modulus: 1_000,
      applyToParticipantCurrency: true,
      dryRun: false,
    });

    expect(result.participantImpact).toHaveLength(0);
    expect(await getParticipantBalance(negative.id)).toBe(-500);
  });

  it("dry run returns the impact preview without writing entries", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const participant = await seedParticipant(group.id, "huge", "p-huge");
    await recordParticipantEntry({
      type: "MANUAL_AWARD",
      participantId: participant.id,
      currencyDelta: 999_999,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });

    const result = await ctx.services.economyResetService.moduloBalances({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      modulus: 1_000,
      applyToParticipantCurrency: true,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.participantCorrectionEntryId).toBeNull();
    expect(result.participantImpact[0]).toMatchObject({
      balanceBefore: 999_999,
      delta: -999_000,
      balanceAfter: 999,
    });
    expect(await getParticipantBalance(participant.id)).toBe(999_999);
  });

  it("trims group points and currency independently when both are enabled", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    await recordGroupEntry({
      type: "MANUAL_AWARD",
      groupId: group.id,
      pointsDelta: 12_345,
      currencyDelta: 67_890,
      createdAt: new Date("2026-05-01T04:00:00Z"),
    });

    await ctx.services.economyResetService.moduloBalances({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      modulus: 1_000,
      applyToGroupPoints: true,
      applyToGroupCurrency: true,
      dryRun: false,
    });

    expect(await getGroupBalance(group.id)).toEqual({ points: 345, currency: 890 });
  });

  it("rejects when modulus is invalid", async () => {
    await expect(
      ctx.services.economyResetService.moduloBalances({
        guildId: GUILD_ID,
        actor: { userId: "admin-1", username: "Admin" },
        modulus: 0,
        applyToParticipantCurrency: true,
        dryRun: true,
      }),
    ).rejects.toThrow(/positive integer/i);
  });

  it("rejects when no targets are selected", async () => {
    await expect(
      ctx.services.economyResetService.moduloBalances({
        guildId: GUILD_ID,
        actor: { userId: "admin-1", username: "Admin" },
        modulus: 1_000,
        dryRun: true,
      }),
    ).rejects.toThrow(/at least one target/i);
  });
});

describe("EconomyResetService chunking helpers", () => {
  it("chunkParticipantSplits leaves small deltas alone", () => {
    expect(chunkParticipantSplits([{ participantId: "p", currencyDelta: 500 }])).toEqual([
      { participantId: "p", currencyDelta: 500 },
    ]);
  });

  it("chunkParticipantSplits splits a delta exceeding the Decimal(18,6) integer limit", () => {
    const delta = -119_999_999_999_001; // bigger than 999_999_999_999
    const chunks = chunkParticipantSplits([{ participantId: "p", currencyDelta: delta }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Math.abs(chunk.currencyDelta)).toBeLessThanOrEqual(999_999_999_999);
    }
    const sum = chunks.reduce((acc, c) => acc + c.currencyDelta, 0);
    expect(sum).toBe(delta);
  });

  it("chunkGroupSplits chunks pointsDelta and currencyDelta independently", () => {
    const splits = [
      { groupId: "g", pointsDelta: 2_500_000_000_000, currencyDelta: 100 },
    ];
    const chunks = chunkGroupSplits(splits);
    for (const c of chunks) {
      expect(Math.abs(c.pointsDelta)).toBeLessThanOrEqual(999_999_999_999);
      expect(Math.abs(c.currencyDelta)).toBeLessThanOrEqual(999_999_999_999);
    }
    const sumPoints = chunks.reduce((a, c) => a + c.pointsDelta, 0);
    const sumCurrency = chunks.reduce((a, c) => a + c.currencyDelta, 0);
    expect(sumPoints).toBe(2_500_000_000_000);
    expect(sumCurrency).toBe(100);
  });
});

describe("EconomyResetService.setBalances", () => {
  it("nukes participant currency to 0 (handles even outsized abuse balances via chunking)", async () => {
    const group = await seedGroup("alpha", "role-alpha");
    const huge = await seedParticipant(group.id, "huge", "p-huge");

    // simulate the abuse: 50 entries of 999_999_999_999 each
    for (let i = 0; i < 50; i++) {
      await recordParticipantEntry({
        type: "LUCKYDRAW_WIN",
        participantId: huge.id,
        currencyDelta: 999_999_999_999,
        createdAt: new Date(`2026-05-01T0${i % 10}:00:00Z`),
      });
    }
    expect(await getParticipantBalance(huge.id)).toBe(50 * 999_999_999_999);

    const result = await ctx.services.economyResetService.setBalances({
      guildId: GUILD_ID,
      actor: { userId: "admin-1", username: "Admin" },
      targetParticipantCurrency: 0,
      dryRun: false,
    });

    expect(result.dryRun).toBe(false);
    expect(result.participantCorrectionEntryId).toBeTruthy();
    expect(await getParticipantBalance(huge.id)).toBe(0);
  });

  it("rejects when no buckets are selected", async () => {
    await expect(
      ctx.services.economyResetService.setBalances({
        guildId: GUILD_ID,
        actor: { userId: "admin-1", username: "Admin" },
        dryRun: true,
      }),
    ).rejects.toThrow(/at least one bucket/i);
  });
});
