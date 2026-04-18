import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BotRuntimeApi } from "../src/bot/runtime.js";
import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
const groupMemberCounts = new Map<string, number>();
const botRuntime: BotRuntimeApi = {
  getRoles: vi.fn().mockResolvedValue([]),
  getTextChannels: vi.fn().mockResolvedValue([]),
  getDashboardMember: vi.fn().mockResolvedValue(null),
  getGroupMemberCount: vi.fn(async (roleId: string) => groupMemberCounts.get(roleId) ?? null),
  getGroupMemberDiscordUserIds: vi.fn(async (roleId: string) => {
    const count = groupMemberCounts.get(roleId);
    return count ? Array.from({ length: count }, (_, index) => `${roleId}-member-${index + 1}`) : null;
  }),
  postListing: vi.fn().mockResolvedValue(null),
};

async function registerParticipant(params: {
  discordUserId: string;
  discordUsername?: string;
  indexId: string;
  groupId: string;
}) {
  return ctx.services.participantService.register({
    guildId: ctx.env.GUILD_ID,
    ...params,
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

describe("points accelerator API", () => {
  beforeAll(async () => {
    const managed = ensureTestDatabase();
    cleanupDatabase = managed.cleanup;
    ctx = await createTestApp(managed.url, { botRuntime });
  });

  beforeEach(async () => {
    groupMemberCounts.clear();
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

  it("creates settings, groups, and awards with leaderboard output", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        appName: "points accelerator",
        pointsName: "beans",
        pointsSymbol: "🏅",
        currencyName: "rice",
        currencySymbol: "💲",
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
    const participant = await registerParticipant({
      discordUserId: "user-student",
      discordUsername: "Student",
      indexId: "S001",
      groupId: group.id,
    });

    const awardResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "user-admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        targetGroupIds: [group.id],
        targetParticipantId: participant.id,
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
    const leaderboard = leaderboardResponse.json() as Array<{ displayName: string; pointsBalance: number }>;

    expect(leaderboard).toEqual([
      expect.objectContaining({
        displayName: "Gryffindor",
        pointsBalance: 10,
      }),
    ]);
    await expect(ctx.services.participantCurrencyService.getParticipantBalance(participant.id)).resolves.toBe(4);
  });

  it("sorts the wallet leaderboard by participant currency balance", async () => {
    await ctx.prisma.guildConfig.create({
      data: {
        guildId: ctx.env.GUILD_ID,
      },
    });

    const alphaGroup = await ctx.prisma.group.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        displayName: "Alpha",
        slug: "alpha",
        mentorName: "A Mentor",
        roleId: "role-alpha",
        active: true,
      },
    });
    const betaGroup = await ctx.prisma.group.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        displayName: "Beta",
        slug: "beta",
        mentorName: "B Mentor",
        roleId: "role-beta",
        active: true,
      },
    });
    const alice = await registerParticipant({
      discordUserId: "user-alice",
      discordUsername: "Alice",
      indexId: "S001",
      groupId: alphaGroup.id,
    });
    const bob = await registerParticipant({
      discordUserId: "user-bob",
      discordUsername: "Bob",
      indexId: "S002",
      groupId: betaGroup.id,
    });
    const carol = await registerParticipant({
      discordUserId: "user-carol",
      indexId: "S003",
      groupId: betaGroup.id,
    });

    await seedParticipantCurrency(alice.id, 6);
    await seedParticipantCurrency(bob.id, 10);
    await seedParticipantCurrency(carol.id, 10);

    await expect(ctx.services.participantService.getCurrencyLeaderboard(ctx.env.GUILD_ID)).resolves.toEqual([
      expect.objectContaining({
        id: bob.id,
        discordUsername: "Bob",
        indexId: "S002",
        currencyBalance: 10,
      }),
      expect.objectContaining({
        id: carol.id,
        discordUsername: null,
        indexId: "S003",
        currencyBalance: 10,
      }),
      expect.objectContaining({
        id: alice.id,
        discordUsername: "Alice",
        indexId: "S001",
        currencyBalance: 6,
      }),
    ]);
  });

  it("syncs groups for roles that can receive awards", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/api/capabilities",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: [
        {
          roleId: "role-alpha",
          roleName: "Alpha",
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

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        displayName: "Alpha",
        roleId: "role-alpha",
        active: true,
      }),
    ]);
  });

  it("drops stale synced groups from live queries when the role stops qualifying", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/api/capabilities",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: [
        {
          roleId: "role-alpha",
          roleName: "Alpha",
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

    await ctx.app.inject({
      method: "GET",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });

    await ctx.app.inject({
      method: "PUT",
      url: "/api/capabilities",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: [],
    });

    const groupsResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(groupsResponse.statusCode).toBe(200);
    expect(groupsResponse.json()).toEqual([]);

    const leaderboardResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/leaderboard",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(leaderboardResponse.statusCode).toBe(200);
    expect(leaderboardResponse.json()).toEqual([]);

    await expect(ctx.services.groupService.resolveGroupFromRoleIds(ctx.env.GUILD_ID, ["role-alpha"])).rejects.toThrow(
      /not mapped to an active group/i,
    );
  });

  it("preserves a stored group display name when syncing capability labels", async () => {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Red Team",
        slug: "red-team",
        mentorName: null,
        roleId: "role-alpha",
        aliases: ["red"],
        active: true,
      },
    });
    expect(createResponse.statusCode).toBe(200);

    await ctx.app.inject({
      method: "PUT",
      url: "/api/capabilities",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: [
        {
          roleId: "role-alpha",
          roleName: "Alpha",
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

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        displayName: "Red Team",
        roleId: "role-alpha",
        slug: "red-team",
      }),
    ]);
  });

  it("assigns unique slugs when synced role names normalise to the same value", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/api/capabilities",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: [
        {
          roleId: "role-a",
          roleName: "Team A",
          canManageDashboard: false,
          canAward: false,
          maxAward: null,
          canDeduct: false,
          canMultiAward: false,
          canSell: false,
          canReceiveAwards: true,
          isGroupRole: true,
        },
        {
          roleId: "role-b",
          roleName: "Team-A",
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

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const groups = response.json() as Array<{ slug: string; roleId: string }>;
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.slug)).size).toBe(2);
    expect(groups.map((group) => group.roleId)).toEqual(["role-a", "role-b"]);
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
        currencyDelta: 0,
        description: "Too much",
      },
    });

    expect(awardResponse.statusCode).toBe(403);
    expect(awardResponse.json()).toMatchObject({ message: expect.stringMatching(/at most 10/i) });
  });

  it("rolls back mixed awards when one leg fails", async () => {
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
          maxAward: 5,
          canDeduct: true,
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
        displayName: "Ravenclaw",
        slug: "ravenclaw",
        mentorName: null,
        roleId: "role-ravenclaw",
        aliases: [],
        active: true,
      },
    });
    const group = groupResponse.json() as { id: string };
    const participant = await registerParticipant({
      discordUserId: "user-raven",
      discordUsername: "Raven",
      indexId: "S777",
      groupId: group.id,
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "mentor-1",
        actorUsername: "Mentor",
        actorRoleIds: ["role-mentor"],
        targetGroupIds: [group.id],
        targetParticipantId: participant.id,
        pointsDelta: 4,
        currencyDelta: 6,
        description: "Should fail atomically",
      },
    });

    expect(response.statusCode).toBe(403);

    const leaderboardResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/leaderboard",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    const leaderboard = leaderboardResponse.json() as Array<{ displayName: string; pointsBalance: number }>;
    expect(leaderboard).toEqual([
      expect.objectContaining({
        displayName: "Ravenclaw",
        pointsBalance: 0,
      }),
    ]);
    await expect(ctx.services.participantCurrencyService.getParticipantBalance(participant.id)).resolves.toBe(0);
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
    const sourceParticipant = await registerParticipant({
      discordUserId: "user-1",
      discordUsername: "Alpha user",
      indexId: "S001",
      groupId: source.id,
    });
    const targetParticipant = await registerParticipant({
      discordUserId: "user-2",
      discordUsername: "Beta user",
      indexId: "S002",
      groupId: target.id,
    });

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
        currencyDelta: 0,
        description: "Seed funds",
      },
    });
    await seedParticipantCurrency(sourceParticipant.id, 20);

    await ctx.app.inject({
      method: "POST",
      url: "/api/actions/pay",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        sourceParticipantId: sourceParticipant.id,
        targetParticipantId: targetParticipant.id,
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
        audience: "INDIVIDUAL",
        cost: 3,
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
        participantId: targetParticipant.id,
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
    const leaderboard = leaderboardResponse.json() as Array<{ displayName: string; pointsBalance: number }>;

    expect(leaderboard).toEqual([
      expect.objectContaining({
        displayName: "Alpha",
        pointsBalance: 20,
      }),
      expect.objectContaining({
        displayName: "Beta",
        pointsBalance: 0,
      }),
    ]);

    await expect(ctx.services.participantCurrencyService.getParticipantBalance(sourceParticipant.id)).resolves.toBe(15);
    await expect(ctx.services.participantCurrencyService.getParticipantBalance(targetParticipant.id)).resolves.toBe(2);
  });

  it("supports currency-only staff awards through the admin API", async () => {
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

    const groupResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Ravenclaw",
        slug: "ravenclaw",
        mentorName: null,
        roleId: "role-ravenclaw",
        aliases: [],
        active: true,
      },
    });
    const group = groupResponse.json() as { id: string };
    const participant = await registerParticipant({
      discordUserId: "user-raven",
      discordUsername: "Raven",
      indexId: "S100",
      groupId: group.id,
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        targetGroupIds: [],
        targetParticipantId: participant.id,
        pointsDelta: 0,
        currencyDelta: 6,
        description: "Helpful demo answer",
      },
    });

    expect(response.statusCode).toBe(200);
    await expect(ctx.services.participantCurrencyService.getParticipantBalance(participant.id)).resolves.toBe(6);
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
        audience: "INDIVIDUAL",
        cost: 8,
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
        audience: "INDIVIDUAL",
        cost: 8,
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

  it("allows unfunded group purchase requests to be created before points are available", async () => {
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

    const groupResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Hufflepuff",
        slug: "hufflepuff",
        mentorName: null,
        roleId: "role-hufflepuff",
        aliases: [],
        active: true,
      },
    });
    const group = groupResponse.json() as { id: string };
    groupMemberCounts.set("role-hufflepuff", 1);
    const participant = await registerParticipant({
      discordUserId: "user-huff",
      discordUsername: "Hufflepuff user",
      indexId: "S123",
      groupId: group.id,
    });

    const itemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        name: "Shared feast",
        description: "Team reward",
        audience: "GROUP",
        cost: 25,
        stock: 5,
        enabled: true,
        fulfillmentInstructions: "manual",
      },
    });
    const item = itemResponse.json() as { id: string };

    const redeemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/redeem",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        participantId: participant.id,
        shopItemId: item.id,
        requestedByUserId: "user-huff",
        requestedByUsername: "Hufflepuff user",
        quantity: 1,
        purchaseMode: "GROUP",
      },
    });

    expect(redeemResponse.statusCode).toBe(200);
    expect(redeemResponse.json()).toMatchObject({
      purchaseMode: "GROUP",
      status: "AWAITING_APPROVAL",
      approvalThreshold: 1,
    });
  });

  it("auto-executes funded quorum-1 group purchases on creation", async () => {
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
    groupMemberCounts.set("role-slytherin", 1);

    const participant = await registerParticipant({
      discordUserId: "user-sly",
      discordUsername: "Sly user",
      indexId: "S777",
      groupId: group.id,
    });

    await ctx.app.inject({
      method: "POST",
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        targetGroupIds: [group.id],
        targetParticipantId: participant.id,
        pointsDelta: 30,
        currencyDelta: 0,
        description: "Seed points",
      },
    });

    const itemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        name: "Shared cauldron",
        description: "Team reward",
        audience: "GROUP",
        cost: 10,
        stock: 5,
        enabled: true,
        fulfillmentInstructions: "manual",
      },
    });
    const item = itemResponse.json() as { id: string };

    const redeemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/redeem",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        participantId: participant.id,
        shopItemId: item.id,
        requestedByUserId: "user-sly",
        requestedByUsername: "Sly user",
        quantity: 1,
        purchaseMode: "GROUP",
      },
    });

    expect(redeemResponse.statusCode).toBe(200);
    expect(redeemResponse.json()).toMatchObject({
      purchaseMode: "GROUP",
      status: "PENDING",
      approvalThreshold: 1,
    });
  });

  it("lists fulfilment queue items and lets staff fulfil or cancel eligible requests", async () => {
    const groupResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Ravenclaw",
        slug: "ravenclaw",
        mentorName: null,
        roleId: "role-ravenclaw",
        aliases: [],
        active: true,
      },
    });
    const group = groupResponse.json() as { id: string };
    groupMemberCounts.set("role-ravenclaw", 2);

    const participant = await registerParticipant({
      discordUserId: "user-raven",
      discordUsername: "Raven user",
      indexId: "R001",
      groupId: group.id,
    });
    const approver = await registerParticipant({
      discordUserId: "user-raven-2",
      discordUsername: "Raven mate",
      indexId: "R002",
      groupId: group.id,
    });

    await seedParticipantCurrency(participant.id, 50);

    const personalItemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        name: "Notebook",
        description: "Personal item",
        audience: "INDIVIDUAL",
        cost: 10,
        stock: 4,
        enabled: true,
        fulfillmentInstructions: "Pick it up from the desk.",
      },
    });
    const personalItem = personalItemResponse.json() as { id: string };

    const groupItemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        name: "Team snacks",
        description: "Group reward",
        audience: "GROUP",
        cost: 25,
        stock: 3,
        enabled: true,
        fulfillmentInstructions: "Hand over during break.",
      },
    });
    const groupItem = groupItemResponse.json() as { id: string };

    const personalRedeemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/redeem",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        participantId: participant.id,
        shopItemId: personalItem.id,
        requestedByUserId: participant.discordUserId,
        requestedByUsername: participant.discordUsername ?? undefined,
      },
    });
    const personalRedemption = personalRedeemResponse.json() as { id: string; status: string };

    const groupRedeemResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/redeem",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        participantId: approver.id,
        shopItemId: groupItem.id,
        requestedByUserId: approver.discordUserId,
        requestedByUsername: approver.discordUsername ?? undefined,
        purchaseMode: "GROUP",
      },
    });
    const groupRedemption = groupRedeemResponse.json() as { id: string; status: string };

    const queueResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/shop-redemptions",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(queueResponse.statusCode).toBe(200);
    expect(queueResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: personalRedemption.id,
          status: "PENDING",
          shopItem: expect.objectContaining({ name: "Notebook" }),
        }),
        expect.objectContaining({
          id: groupRedemption.id,
          status: "AWAITING_APPROVAL",
          shopItem: expect.objectContaining({ name: "Team snacks" }),
        }),
      ]),
    );

    const bootstrapResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(bootstrapResponse.statusCode).toBe(200);
    expect(bootstrapResponse.json()).not.toHaveProperty("redemptions");

    const fulfilResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/shop-redemptions/${personalRedemption.id}/status`,
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        status: "FULFILLED",
      },
    });
    expect(fulfilResponse.statusCode).toBe(200);
    expect(fulfilResponse.json()).toMatchObject({
      id: personalRedemption.id,
      status: "FULFILLED",
    });

    const cancelResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/shop-redemptions/${groupRedemption.id}/status`,
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        status: "CANCELED",
      },
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toMatchObject({
      id: groupRedemption.id,
      status: "CANCELED",
    });
  });

  it("ignores approvals from members who have left the group", async () => {
    const groupAlphaResponse = await ctx.app.inject({
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
    const alphaGroup = groupAlphaResponse.json() as { id: string };

    const groupBetaResponse = await ctx.app.inject({
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
    const betaGroup = groupBetaResponse.json() as { id: string };

    const requester = await registerParticipant({
      discordUserId: "user-a1",
      discordUsername: "Alpha One",
      indexId: "A001",
      groupId: alphaGroup.id,
    });
    const approver = await registerParticipant({
      discordUserId: "user-a2",
      discordUsername: "Alpha Two",
      indexId: "A002",
      groupId: alphaGroup.id,
    });
    await registerParticipant({
      discordUserId: "user-a3",
      discordUsername: "Alpha Three",
      indexId: "A003",
      groupId: alphaGroup.id,
    });
    await registerParticipant({
      discordUserId: "user-a4",
      discordUsername: "Alpha Four",
      indexId: "A004",
      groupId: alphaGroup.id,
    });

    await ctx.services.economyService.awardGroups({
      guildId: ctx.env.GUILD_ID,
      actor: {
        userId: "system",
        username: "System",
        roleIds: [],
      },
      targetGroupIds: [alphaGroup.id],
      pointsDelta: 20,
      currencyDelta: 0,
      description: "Seed points",
      type: "CORRECTION",
      systemAction: true,
    });

    const item = await ctx.services.shopService.upsert(ctx.env.GUILD_ID, {
      name: "Shared feast",
      description: "Group reward",
      audience: "GROUP",
      cost: 10,
      stock: 5,
      enabled: true,
      fulfillmentInstructions: null,
    });

    const redemption = await ctx.services.shopService.redeem({
      guildId: ctx.env.GUILD_ID,
      participantId: requester.id,
      shopItemId: item.id,
      requestedByUserId: requester.discordUserId,
      requestedByUsername: requester.discordUsername ?? undefined,
      quantity: 1,
      purchaseMode: "GROUP",
      groupMemberCount: 4,
    });

    await ctx.prisma.participant.update({
      where: { id: requester.id },
      data: { groupId: betaGroup.id },
    });

    const approvalResult = await ctx.services.shopService.approveGroupPurchase({
      guildId: ctx.env.GUILD_ID,
      redemptionId: redemption.id,
      participantId: approver.id,
      approvedByUserId: approver.discordUserId,
      approvedByUsername: approver.discordUsername ?? undefined,
      currentGroupMemberCount: 3,
      currentGroupMemberDiscordUserIds: ["user-a2", "user-a3", "user-a4"],
    });

    expect(approvalResult.executed).toBe(false);
    expect(approvalResult.approvalsCount).toBe(1);
    expect(approvalResult.threshold).toBe(2);
  });
});
