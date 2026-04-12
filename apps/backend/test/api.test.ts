import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

describe("points accelerator API", () => {
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

  it("creates settings, groups, and awards with leaderboard output", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        appName: "points accelerator",
        pointsName: "beans",
        currencyName: "rice",
        mentorRoleIds: [],
        passivePointsReward: 2,
        passiveCurrencyReward: 1,
        passiveCooldownSeconds: 45,
        passiveMinimumCharacters: 5,
        passiveAllowedChannelIds: [],
        passiveDeniedChannelIds: [],
        commandLogChannelId: null,
        redemptionChannelId: null,
        listingChannelId: null,
        economyMode: "SIMPLE",
        betWinChance: 50,
      },
    });

    await ctx.app.inject({
      method: "PUT",
      url: "/api/capabilities",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: [
        {
          roleId: "role-admin",
          roleName: "Admin",
          canManageDashboard: true,
          canAward: true,
          maxAward: 1000,
          canDeduct: true,
          canMultiAward: true,
          canSell: true,
          canReceiveAwards: true,
          isGroupRole: false,
        },
        {
          roleId: "role-gryffindor",
          roleName: "Gryffindor",
          canManageDashboard: false,
          canAward: false,
          maxAward: null,
          canDeduct: false,
          canMultiAward: false,
          canSell: false,
          canReceiveAwards: true,
          isGroupRole: true,
        },
      ],
    });

    const groupResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Gryffindor",
        slug: "gryffindor",
        mentorName: "Minerva",
        roleId: "role-gryffindor",
        aliases: ["red", "lion"],
        active: true,
      },
    });
    const group = groupResponse.json() as { id: string };

    const awardResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "user-admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        targetGroupIds: [group.id],
        pointsDelta: 10,
        currencyDelta: 4,
        description: "Answered a challenge",
      },
    });

    expect(awardResponse.statusCode).toBe(200);

    const leaderboardResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/leaderboard",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    const leaderboard = leaderboardResponse.json() as Array<{ displayName: string; pointsBalance: number; currencyBalance: number }>;

    expect(leaderboard).toEqual([
      expect.objectContaining({
        displayName: "Gryffindor",
        pointsBalance: 10,
        currencyBalance: 4,
      }),
    ]);
  });

  it("rejects awards above the configured role cap", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/api/capabilities",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: [
        {
          roleId: "role-mentor",
          roleName: "Mentor",
          canManageDashboard: false,
          canAward: true,
          maxAward: 10,
          canDeduct: false,
          canMultiAward: false,
          canSell: false,
          canReceiveAwards: true,
          isGroupRole: false,
        },
      ],
    });

    const groupResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Slytherin",
        slug: "slytherin",
        mentorName: null,
        roleId: "role-slytherin",
        aliases: [],
        active: true,
      },
    });
    const group = groupResponse.json() as { id: string };

    const awardResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "mentor-1",
        actorUsername: "Mentor",
        actorRoleIds: ["role-mentor"],
        targetGroupIds: [group.id],
        pointsDelta: 50,
        currencyDelta: 50,
        description: "Too much",
      },
    });

    expect(awardResponse.statusCode).toBe(403);
    expect(awardResponse.json()).toMatchObject({ message: expect.stringMatching(/at most 10/i) });
  });

  it("transfers currency and redeems from the shop without affecting points", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/api/capabilities",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: [
        {
          roleId: "role-admin",
          roleName: "Admin",
          canManageDashboard: true,
          canAward: true,
          maxAward: 1000,
          canDeduct: true,
          canMultiAward: true,
          canSell: true,
          canReceiveAwards: true,
          isGroupRole: false,
        },
      ],
    });

    const sourceResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Alpha",
        slug: "alpha",
        mentorName: null,
        roleId: "role-alpha",
        aliases: [],
        active: true,
      },
    });
    const targetResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Beta",
        slug: "beta",
        mentorName: null,
        roleId: "role-beta",
        aliases: [],
        active: true,
      },
    });

    const source = sourceResponse.json() as { id: string };
    const target = targetResponse.json() as { id: string };

    await ctx.app.inject({
      method: "POST",
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        targetGroupIds: [source.id],
        pointsDelta: 20,
        currencyDelta: 20,
        description: "Seed funds",
      },
    });

    await ctx.app.inject({
      method: "POST",
      url: "/api/actions/pay",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        sourceGroupId: source.id,
        targetGroupId: target.id,
        amount: 5,
        description: "Prize split",
      },
    });

    const itemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        name: "Bubble Tea",
        description: "sweet reward",
        currencyCost: 3,
        stock: 10,
        enabled: true,
        fulfillmentInstructions: "manual",
      },
    });
    const item = itemResponse.json() as { id: string };

    await ctx.app.inject({
      method: "POST",
      url: "/api/actions/redeem",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        groupId: target.id,
        shopItemId: item.id,
        requestedByUserId: "user-2",
        requestedByUsername: "Beta user",
        quantity: 1,
      },
    });

    const leaderboardResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/leaderboard",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    const leaderboard = leaderboardResponse.json() as Array<{ displayName: string; pointsBalance: number; currencyBalance: number }>;

    expect(leaderboard).toEqual([
      expect.objectContaining({
        displayName: "Alpha",
        pointsBalance: 20,
        currencyBalance: 15,
      }),
      expect.objectContaining({
        displayName: "Beta",
        pointsBalance: 0,
        currencyBalance: 2,
      }),
    ]);
  });

  it("allows sold-out shop items to be saved with zero stock", async () => {
    await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);

    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        name: "Mystery Box",
        description: "limited drop",
        currencyCost: 8,
        stock: 1,
        enabled: true,
        fulfillmentInstructions: null,
      },
    });
    expect(createResponse.statusCode).toBe(200);
    const createdItem = createResponse.json() as { id: string };

    const updateResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        id: createdItem.id,
        name: "Mystery Box",
        description: "limited drop",
        currencyCost: 8,
        stock: 0,
        enabled: true,
        fulfillmentInstructions: null,
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: createdItem.id,
      stock: 0,
    });
  });
});
