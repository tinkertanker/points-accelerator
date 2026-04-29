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
    await resetDatabase(ctx.prisma);
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
    const created = create.json() as { id: string; currencyDelta: number };
    expect(created.currencyDelta).toBe(1);

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
        description: null,
        enabled: true,
      },
    });
    expect(update.statusCode).toBe(200);
    expect((update.json() as { currencyDelta: number }).currencyDelta).toBe(-2);

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
