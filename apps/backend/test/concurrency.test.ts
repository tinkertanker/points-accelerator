import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { decimal } from "../src/utils/decimal.js";
import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

async function createGroup(displayName: string, roleId: string) {
  return ctx.services.groupService.upsert(ctx.env.GUILD_ID, {
    displayName,
    slug: displayName.toLowerCase(),
    mentorName: null,
    roleId,
    aliases: [],
    active: true,
  });
}

async function seedCurrency(groupId: string, amount: number) {
  await ctx.prisma.ledgerEntry.create({
    data: {
      guildId: ctx.env.GUILD_ID,
      type: "CORRECTION",
      description: "Test seed",
      splits: {
        create: {
          groupId,
          pointsDelta: decimal(0),
          currencyDelta: decimal(amount),
        },
      },
    },
  });
}

async function createParticipant(groupId: string, discordUserId: string, indexId: string) {
  return ctx.services.participantService.register({
    guildId: ctx.env.GUILD_ID,
    discordUserId,
    discordUsername: discordUserId,
    indexId,
    groupId,
  });
}

async function seedParticipantCurrency(participantId: string, amount: number) {
  await ctx.services.participantCurrencyService.awardParticipants({
    guildId: ctx.env.GUILD_ID,
    actor: {
      userId: "system",
      username: "System",
      roleIds: [],
    },
    targetParticipantIds: [participantId],
    currencyDelta: amount,
    description: "Test seed",
    type: "CORRECTION",
    systemAction: true,
  });
}

async function seedGroupPoints(groupId: string, amount: number) {
  await ctx.services.economyService.awardGroups({
    guildId: ctx.env.GUILD_ID,
    actor: {
      userId: "system",
      username: "System",
      roleIds: [],
    },
    targetGroupIds: [groupId],
    pointsDelta: amount,
    currencyDelta: 0,
    description: "Test seed",
    type: "CORRECTION",
    systemAction: true,
  });
}

describe("economy concurrency", () => {
  beforeAll(async () => {
    const managed = ensureTestDatabase();
    cleanupDatabase = managed.cleanup;
    ctx = await createTestApp(managed.url);
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.app.close();
      await ctx.prisma.$disconnect();
    }
    cleanupDatabase();
  });

  it("serialises concurrent group-to-group debits", async () => {
    const source = await createGroup("Alpha", "role-alpha");
    const firstTarget = await createGroup("Beta", "role-beta");
    const secondTarget = await createGroup("Gamma", "role-gamma");
    await seedCurrency(source.id, 10);

    const actor = {
      userId: "admin-1",
      username: "Admin",
      roleIds: [],
    };
    const [firstTransfer, secondTransfer] = await Promise.allSettled([
      ctx.services.economyService.transferCurrency({
        guildId: ctx.env.GUILD_ID,
        actor,
        sourceGroupId: source.id,
        targetGroupId: firstTarget.id,
        amount: 7,
      }),
      ctx.services.economyService.transferCurrency({
        guildId: ctx.env.GUILD_ID,
        actor,
        sourceGroupId: source.id,
        targetGroupId: secondTarget.id,
        amount: 7,
      }),
    ]);

    expect([firstTransfer.status, secondTransfer.status].sort()).toEqual(["fulfilled", "rejected"]);

    const balances = await ctx.services.groupService.getBalanceMap([source.id, firstTarget.id, secondTarget.id]);
    expect(balances[source.id]?.currencyBalance).toBe(3);
    expect((balances[firstTarget.id]?.currencyBalance ?? 0) + (balances[secondTarget.id]?.currencyBalance ?? 0)).toBe(7);
  });

  it("keeps redemptions inside stock and group point limits under concurrency", async () => {
    const group = await createGroup("Alpha", "role-alpha");
    const firstParticipant = await createParticipant(group.id, "user-1", "S001");
    const secondParticipant = await createParticipant(group.id, "user-2", "S002");
    await seedGroupPoints(group.id, 10);

    const item = await ctx.services.shopService.upsert(ctx.env.GUILD_ID, {
      name: "Limited Prize",
      description: "One only",
      audience: "GROUP",
      cost: 7,
      stock: 1,
      enabled: true,
      fulfillmentInstructions: null,
    });

    const [firstRedemption, secondRedemption] = await Promise.allSettled([
      ctx.services.shopService.redeem({
        guildId: ctx.env.GUILD_ID,
        participantId: firstParticipant.id,
        shopItemId: item.id,
        requestedByUserId: "user-1",
        requestedByUsername: "Alice",
        quantity: 1,
        purchaseMode: "GROUP",
        groupMemberCount: 1,
      }),
      ctx.services.shopService.redeem({
        guildId: ctx.env.GUILD_ID,
        participantId: secondParticipant.id,
        shopItemId: item.id,
        requestedByUserId: "user-2",
        requestedByUsername: "Bob",
        quantity: 1,
        purchaseMode: "GROUP",
        groupMemberCount: 1,
      }),
    ]);

    expect([firstRedemption.status, secondRedemption.status].sort()).toEqual(["fulfilled", "rejected"]);

    const refreshedItem = await ctx.prisma.shopItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    const redemptionCount = await ctx.prisma.shopRedemption.count();

    expect(refreshedItem.stock).toBe(0);
    const balances = await ctx.services.groupService.getBalanceMap([group.id]);
    expect(balances[group.id]?.pointsBalance).toBe(3);
    expect(redemptionCount).toBe(1);
  });

  it("does not double-pay passive rewards for the same message under concurrency", async () => {
    const group = await createGroup("Alpha", "role-alpha");
    const participant = await createParticipant(group.id, "user-1", "S001");

    const reward = () =>
      ctx.services.economyService.rewardPassiveMessage({
        guildId: ctx.env.GUILD_ID,
        groupId: group.id,
        participantId: participant.id,
        userId: "user-1",
        username: "Alice",
        messageId: "dup-message-1",
        content: "hello world this is long enough",
        channelId: "channel-1",
      });

    const results = await Promise.all([reward(), reward()]);

    // Exactly one of the racing calls pays out; the other is deduped (either by
    // the in-process pre-read or the partial unique index via a caught P2002).
    expect(results.filter((entry) => entry !== null)).toHaveLength(1);

    const ledgerCount = await ctx.prisma.ledgerEntry.count({
      where: { guildId: ctx.env.GUILD_ID, type: "MESSAGE_REWARD", externalRef: "dup-message-1" },
    });
    const currencyCount = await ctx.prisma.participantCurrencyEntry.count({
      where: { guildId: ctx.env.GUILD_ID, type: "MESSAGE_REWARD", externalRef: "dup-message-1" },
    });
    expect(ledgerCount).toBe(1);
    expect(currencyCount).toBe(1);

    const walletBalance = await ctx.services.participantCurrencyService.getParticipantBalance(participant.id);
    expect(walletBalance).toBe(1);
    const groupBalance = await ctx.services.groupService.getBalanceMap([group.id]);
    expect(groupBalance[group.id]?.pointsBalance).toBe(1);
  });
});
