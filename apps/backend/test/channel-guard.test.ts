import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

async function seedParticipantWithBalance(balance: number, discordUserId = "user-1") {
  const group = await ctx.prisma.group.create({
    data: { guildId: GUILD_ID, displayName: "Alpha", slug: "alpha", roleId: "role-alpha" },
  });
  const participant = await ctx.prisma.participant.create({
    data: {
      guildId: GUILD_ID,
      groupId: group.id,
      discordUserId,
      discordUsername: discordUserId,
      indexId: discordUserId,
    },
  });
  if (balance !== 0) {
    await ctx.prisma.participantCurrencyEntry.create({
      data: {
        guildId: GUILD_ID,
        type: "MANUAL_AWARD",
        description: "seed",
        splits: { create: [{ participantId: participant.id, currencyDelta: decimal(balance) }] },
      },
    });
  }
  return participant;
}

async function setConfig(updates: Parameters<typeof ctx.services.configService.update>[1]) {
  return ctx.services.configService.update(GUILD_ID, updates);
}

async function getBalance(participantId: string) {
  const grouped = await ctx.prisma.participantCurrencySplit.groupBy({
    by: ["participantId"],
    where: { participantId },
    _sum: { currencyDelta: true },
  });
  return decimalToNumber(grouped[0]?._sum.currencyDelta);
}

describe("ChannelGuardService", () => {
  it("empty allowlist means no restriction", async () => {
    const config = await ctx.services.configService.getOrCreate(GUILD_ID);
    const result = await ctx.services.channelGuardService.check({
      guildId: GUILD_ID,
      config,
      activity: "betting",
      channelId: "any-channel",
      participantId: null,
      actorUserId: "u1",
      actorUsername: "u1",
      currencyName: "rice",
      currencySymbol: "💲",
    });
    expect(result.ok).toBe(true);
  });

  it("allowlisted channel passes; other channels are blocked and taxed", async () => {
    const participant = await seedParticipantWithBalance(500);
    const config = await setConfig({ bettingChannelIds: ["allowed-channel"], wrongChannelPenalty: 50 });

    const allowed = await ctx.services.channelGuardService.check({
      guildId: GUILD_ID,
      config,
      activity: "betting",
      channelId: "allowed-channel",
      participantId: participant.id,
      actorUserId: "u1",
      actorUsername: "u1",
      currencyName: "rice",
      currencySymbol: "💲",
    });
    expect(allowed.ok).toBe(true);

    const blocked = await ctx.services.channelGuardService.check({
      guildId: GUILD_ID,
      config,
      activity: "betting",
      channelId: "wrong-channel",
      participantId: participant.id,
      actorUserId: "u1",
      actorUsername: "u1",
      currencyName: "rice",
      currencySymbol: "💲",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.penaltyApplied).toBe(50);
      expect(blocked.message).toContain("50");
    }
    expect(await getBalance(participant.id)).toBe(450);
  });

  it("caps the tax at the user's current balance — never goes negative", async () => {
    const participant = await seedParticipantWithBalance(20);
    const config = await setConfig({ bettingChannelIds: ["allowed-channel"], wrongChannelPenalty: 100 });

    const result = await ctx.services.channelGuardService.check({
      guildId: GUILD_ID,
      config,
      activity: "betting",
      channelId: "wrong-channel",
      participantId: participant.id,
      actorUserId: "u1",
      actorUsername: "u1",
      currencyName: "rice",
      currencySymbol: "💲",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.penaltyApplied).toBe(20);
    }
    expect(await getBalance(participant.id)).toBe(0);
  });

  it("blocks staff (no participant) without applying tax", async () => {
    const config = await setConfig({ pointsChannelIds: ["allowed-channel"], wrongChannelPenalty: 50 });

    const result = await ctx.services.channelGuardService.check({
      guildId: GUILD_ID,
      config,
      activity: "points",
      channelId: "wrong-channel",
      participantId: null,
      actorUserId: "staff-1",
      actorUsername: "staff",
      currencyName: "rice",
      currencySymbol: "💲",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.penaltyApplied).toBe(0);
    }
  });

  it("zero penalty config blocks but doesn't tax", async () => {
    const participant = await seedParticipantWithBalance(500);
    const config = await setConfig({ bettingChannelIds: ["allowed-channel"], wrongChannelPenalty: 0 });

    const result = await ctx.services.channelGuardService.check({
      guildId: GUILD_ID,
      config,
      activity: "betting",
      channelId: "wrong-channel",
      participantId: participant.id,
      actorUserId: "u1",
      actorUsername: "u1",
      currencyName: "rice",
      currencySymbol: "💲",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.penaltyApplied).toBe(0);
    }
    expect(await getBalance(participant.id)).toBe(500);
  });

  it("tracks each activity allowlist independently", async () => {
    const participant = await seedParticipantWithBalance(500);
    const config = await setConfig({
      bettingChannelIds: ["bet-channel"],
      shopChannelIds: ["shop-channel"],
      wrongChannelPenalty: 10,
    });

    const bettingInShop = await ctx.services.channelGuardService.check({
      guildId: GUILD_ID,
      config,
      activity: "betting",
      channelId: "shop-channel",
      participantId: participant.id,
      actorUserId: "u1",
      actorUsername: "u1",
      currencyName: "rice",
      currencySymbol: "💲",
    });
    expect(bettingInShop.ok).toBe(false);

    const shopInShop = await ctx.services.channelGuardService.check({
      guildId: GUILD_ID,
      config,
      activity: "shop",
      channelId: "shop-channel",
      participantId: participant.id,
      actorUserId: "u1",
      actorUsername: "u1",
      currencyName: "rice",
      currencySymbol: "💲",
    });
    expect(shopInShop.ok).toBe(true);
  });
});
