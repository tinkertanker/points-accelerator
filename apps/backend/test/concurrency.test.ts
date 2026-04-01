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

  it("keeps redemptions inside stock and wallet limits under concurrency", async () => {
    const group = await createGroup("Alpha", "role-alpha");
    await seedCurrency(group.id, 10);

    const item = await ctx.services.shopService.upsert(ctx.env.GUILD_ID, {
      name: "Limited Prize",
      description: "One only",
      currencyCost: 7,
      stock: 1,
      enabled: true,
      fulfillmentInstructions: null,
    });

    const [firstRedemption, secondRedemption] = await Promise.allSettled([
      ctx.services.shopService.redeem({
        guildId: ctx.env.GUILD_ID,
        groupId: group.id,
        shopItemId: item.id,
        requestedByUserId: "user-1",
        requestedByUsername: "Alice",
        quantity: 1,
      }),
      ctx.services.shopService.redeem({
        guildId: ctx.env.GUILD_ID,
        groupId: group.id,
        shopItemId: item.id,
        requestedByUserId: "user-2",
        requestedByUsername: "Bob",
        quantity: 1,
      }),
    ]);

    expect([firstRedemption.status, secondRedemption.status].sort()).toEqual(["fulfilled", "rejected"]);

    const refreshedItem = await ctx.prisma.shopItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    const balances = await ctx.services.groupService.getBalanceMap([group.id]);
    const redemptionCount = await ctx.prisma.shopRedemption.count();

    expect(refreshedItem.stock).toBe(0);
    expect(balances[group.id]?.currencyBalance).toBe(3);
    expect(redemptionCount).toBe(1);
  });
});
