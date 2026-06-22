import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BotRuntimeApi } from "../src/bot/runtime.js";
import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
const botRuntime: BotRuntimeApi = {
  getRoles: vi.fn().mockResolvedValue([]),
  getTextChannels: vi.fn().mockResolvedValue([]),
  getMembers: vi.fn().mockResolvedValue([]),
  getDashboardMember: vi.fn().mockResolvedValue(null),
  getGroupMemberCount: vi.fn().mockResolvedValue(null),
  getGroupMemberDiscordUserIds: vi.fn().mockResolvedValue(null),
  postListing: vi.fn().mockResolvedValue(null),
  clearRedemptionButtons: vi.fn().mockResolvedValue(undefined),
};

async function seedGroupAndParticipant() {
  await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);
  const group = await ctx.services.groupService.upsert(ctx.env.GUILD_ID, {
    displayName: "Counters",
    roleId: "role-counters",
    aliases: [],
    active: true,
  });
  const participant = await ctx.services.participantService.register({
    guildId: ctx.env.GUILD_ID,
    discordUserId: "user-counter",
    discordUsername: "counter",
    indexId: "S001",
    groupId: group.id,
  });
  return { group, participant };
}

describe("reaction reward rules", () => {
  beforeAll(async () => {
    const managed = ensureTestDatabase();
    cleanupDatabase = managed.cleanup;
    ctx = await createTestApp(managed.url, { botRuntime });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase(ctx.prisma, ctx.services);
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.app.close();
      await ctx.prisma.$disconnect();
    }
    cleanupDatabase();
  });

  it("creates, lists, updates, and deletes rules via the admin API", async () => {
    await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);

    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 1,
        description: "Correct count",
      },
    });
    expect(create.statusCode).toBe(200);
    const created = create.json() as { id: string; currencyDelta: number; amountMode: string };
    expect(created.currencyDelta).toBe(1);
    expect(created.amountMode).toBe("FIXED");

    const list = await ctx.app.inject({
      method: "GET",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ id: string }>).length).toBe(1);

    const update = await ctx.app.inject({
      method: "PUT",
      url: `/api/reaction-rules/${created.id}`,
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "❌",
        currencyDelta: -2,
        amountMode: "COUNT_MULTIPLIER",
        maxCurrencyDelta: 100,
        description: null,
        enabled: true,
      },
    });
    expect(update.statusCode).toBe(200);
    expect((update.json() as { currencyDelta: number }).currencyDelta).toBe(-2);
    expect((update.json() as { amountMode: string }).amountMode).toBe("COUNT_MULTIPLIER");

    const remove = await ctx.app.inject({
      method: "DELETE",
      url: `/api/reaction-rules/${created.id}`,
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(remove.statusCode).toBe(204);

    const finalList = await ctx.app.inject({
      method: "GET",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(finalList.json()).toEqual([]);
  });

  it("normalises a pasted custom-emoji <:name:id> to the bare ID", async () => {
    await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);

    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "<:tally:123456789012345678>",
        currencyDelta: 1,
      },
    });
    expect(create.statusCode).toBe(200);
    expect((create.json() as { emoji: string }).emoji).toBe("123456789012345678");

    const animated = await ctx.app.inject({
      method: "POST",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "<a:partying:234567890123456789>",
        currencyDelta: 1,
      },
    });
    expect(animated.statusCode).toBe(200);
    expect((animated.json() as { emoji: string }).emoji).toBe("234567890123456789");
  });

  it("rejects zero currencyDelta and duplicate (channel, bot, emoji) tuples", async () => {
    await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);

    const zero = await ctx.app.inject({
      method: "POST",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: { channelId: "ch1", botUserId: "bot1", emoji: "✅", currencyDelta: 0 },
    });
    expect(zero.statusCode).toBe(400);

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: { channelId: "ch1", botUserId: "bot1", emoji: "✅", currencyDelta: 1 },
    });
    expect(first.statusCode).toBe(200);

    const duplicate = await ctx.app.inject({
      method: "POST",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: { channelId: "ch1", botUserId: "bot1", emoji: "✅", currencyDelta: 5 },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("requires a maximum payout for count multiplier rules", async () => {
    await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 10,
        amountMode: "COUNT_MULTIPLIER",
      },
    });

    expect(response.statusCode).toBe(400);

    const pointsResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/reaction-rules",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "⭐",
        payoutTarget: "GROUP_POINTS",
        pointsDelta: 10,
        amountMode: "COUNT_MULTIPLIER",
      },
    });

    expect(pointsResponse.statusCode).toBe(400);
  });

  it("preserves amount mode and maximum payout when an update omits those fields", async () => {
    await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);

    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 10,
        amountMode: "COUNT_MULTIPLIER",
        maxCurrencyDelta: 1000,
      },
    });

    const updated = await ctx.services.reactionRewardService.update({
      guildId: ctx.env.GUILD_ID,
      id: rule.id,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 5,
      },
    });

    expect(updated.amountMode).toBe("COUNT_MULTIPLIER");
    expect(updated.maxCurrencyDelta).toBe(1000);
  });

  it("applies a positive rule and credits the participant exactly once per message", async () => {
    const { participant } = await seedGroupAndParticipant();
    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 3,
      },
    });

    await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      messageId: "msg-1",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });
    await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      messageId: "msg-1",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });

    await expect(
      ctx.services.participantCurrencyService.getParticipantBalance(participant.id),
    ).resolves.toBe(3);
  });

  it("can multiply the configured reward by the number counted in the message", async () => {
    const { participant } = await seedGroupAndParticipant();
    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 10,
        amountMode: "COUNT_MULTIPLIER",
        maxCurrencyDelta: 5000,
      },
    });

    await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      messageId: "msg-count-100",
      messageContent: "100",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });

    await expect(
      ctx.services.participantCurrencyService.getParticipantBalance(participant.id),
    ).resolves.toBe(1000);
  });

  it("can award a fixed number of group points when count multiplier is off", async () => {
    const { group, participant } = await seedGroupAndParticipant();
    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "⭐",
        payoutTarget: "GROUP_POINTS",
        pointsDelta: 25,
      },
    });

    await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      groupId: group.id,
      messageId: "msg-fixed-points",
      messageContent: "100",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });

    await expect(ctx.services.economyService.getGroupBalance(group.id)).resolves.toMatchObject({
      pointsBalance: 25,
    });
    await expect(
      ctx.services.participantCurrencyService.getParticipantBalance(participant.id),
    ).resolves.toBe(0);
  });

  it("can multiply group points by the number counted in the message", async () => {
    const { group, participant } = await seedGroupAndParticipant();
    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "⭐",
        payoutTarget: "GROUP_POINTS",
        pointsDelta: 2,
        amountMode: "COUNT_MULTIPLIER",
        maxPointsDelta: 500,
      },
    });

    await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      groupId: group.id,
      messageId: "msg-count-points",
      messageContent: "100",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });

    await expect(ctx.services.economyService.getGroupBalance(group.id)).resolves.toMatchObject({
      pointsBalance: 200,
    });
  });

  it("caps count-multiplier rewards at the configured maximum payout", async () => {
    const { participant } = await seedGroupAndParticipant();
    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 10,
        amountMode: "COUNT_MULTIPLIER",
        maxCurrencyDelta: 1000,
      },
    });

    await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      messageId: "msg-count-200",
      messageContent: "200",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });

    await expect(
      ctx.services.participantCurrencyService.getParticipantBalance(participant.id),
    ).resolves.toBe(1000);
  });

  it("accepts comma-formatted counted numbers", async () => {
    const { participant } = await seedGroupAndParticipant();
    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 2,
        amountMode: "COUNT_MULTIPLIER",
        maxCurrencyDelta: 5000,
      },
    });

    await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      messageId: "msg-count-1000",
      messageContent: "1,000",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });

    await expect(
      ctx.services.participantCurrencyService.getParticipantBalance(participant.id),
    ).resolves.toBe(2000);
  });

  it("skips count-multiplier rewards when the message does not start with a counted number", async () => {
    const { participant } = await seedGroupAndParticipant();
    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "✅",
        currencyDelta: 10,
        amountMode: "COUNT_MULTIPLIER",
        maxCurrencyDelta: 5000,
      },
    });

    const result = await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      messageId: "msg-not-count",
      messageContent: "great job 100",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });

    expect(result).toBeNull();
    await expect(
      ctx.services.participantCurrencyService.getParticipantBalance(participant.id),
    ).resolves.toBe(0);
  });

  it("applies a deduction safely when the participant has no balance", async () => {
    const { participant } = await seedGroupAndParticipant();
    const rule = await ctx.services.reactionRewardService.create({
      guildId: ctx.env.GUILD_ID,
      input: {
        channelId: "ch-counting",
        botUserId: "bot-counter",
        emoji: "❌",
        currencyDelta: -1,
      },
    });

    const result = await ctx.services.reactionRewardService.applyReaction({
      guildId: ctx.env.GUILD_ID,
      rule,
      participantId: participant.id,
      messageId: "msg-2",
      messageAuthorUserId: "user-counter",
      messageAuthorUsername: "counter",
    });

    expect(result).toBeNull();
    await expect(
      ctx.services.participantCurrencyService.getParticipantBalance(participant.id),
    ).resolves.toBe(0);
  });
});
