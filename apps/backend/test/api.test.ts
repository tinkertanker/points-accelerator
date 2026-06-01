import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BotRuntimeApi } from "../src/bot/runtime.js";
import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
const botRuntime: BotRuntimeApi = {
  listBotGuilds: vi.fn().mockResolvedValue([{ id: "guild-test", name: "Test Guild", iconUrl: null }]),
  getRoles: vi.fn().mockResolvedValue([]),
  getTextChannels: vi.fn().mockResolvedValue([]),
  getMembers: vi.fn().mockResolvedValue([]),
  getRoleMembership: vi.fn().mockResolvedValue({ roles: [], totalHumanMembers: 0 }),
  getDashboardMember: vi.fn().mockResolvedValue(null),
  getGroupMemberCount: vi.fn().mockResolvedValue(null),
  getGroupMemberDiscordUserIds: vi.fn().mockResolvedValue(null),
  postListing: vi.fn().mockResolvedValue(null),
  clearRedemptionButtons: vi.fn().mockResolvedValue(undefined),
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
        bettingCooldownSeconds: 0,
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

  it("returns an empty suggestion result instead of failing when Discord roster inspection is unavailable", async () => {
    vi.mocked(botRuntime.getRoleMembership).mockResolvedValueOnce(null);

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/groups/suggestions",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      totalHumanMembers: 0,
      evaluatedRoleCount: 0,
      primary: null,
      alternatives: [],
      inspectionWarning: "Could not inspect the Discord roster. Try again later or set group roles manually.",
    });
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

  it("prefers the first matching group role when multiple configured groups are present", async () => {
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
        {
          roleId: "role-beta",
          roleName: "Beta",
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

    await ctx.prisma.group.createMany({
      data: [
        {
          guildId: ctx.env.GUILD_ID,
          displayName: "Alpha",
          slug: "alpha",
          mentorName: null,
          roleId: "role-alpha",
          active: true,
        },
        {
          guildId: ctx.env.GUILD_ID,
          displayName: "Beta",
          slug: "beta",
          mentorName: null,
          roleId: "role-beta",
          active: true,
        },
      ],
    });

    await expect(ctx.services.groupService.resolveGroupFromRoleIds(ctx.env.GUILD_ID, ["role-beta", "role-alpha"])).resolves
      .toMatchObject({
        displayName: "Beta",
        roleId: "role-beta",
      });
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

  it("transfers currency and redeems from the shop using group points", async () => {
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
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        targetGroupIds: [target.id],
        pointsDelta: 3,
        currencyDelta: 0,
        description: "Seed shop points",
      },
    });

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
        purchaseMode: "GROUP",
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
    await expect(ctx.services.participantCurrencyService.getParticipantBalance(targetParticipant.id)).resolves.toBe(5);
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

  it("announces newly added store items in configured store channels", async () => {
    await ctx.services.configService.update(ctx.env.GUILD_ID, {
      pointsName: "beans",
      pointsSymbol: "🫘",
      shopChannelIds: ["store-channel"],
      listingChannelId: "listing-channel",
    });

    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        name: "Mystery Box",
        description: "limited drop",
        audience: "GROUP",
        cost: 8,
        stock: 3,
        enabled: true,
        fulfillmentInstructions: null,
      },
    });
    expect(createResponse.statusCode).toBe(200);
    expect(botRuntime.postListing).toHaveBeenCalledWith(
      "store-channel",
      expect.stringContaining("New store item"),
    );
    expect(botRuntime.postListing).toHaveBeenCalledWith(
      "store-channel",
      expect.stringContaining("Mystery Box"),
    );
    expect(botRuntime.postListing).not.toHaveBeenCalledWith("listing-channel", expect.any(String));

    const createdItem = createResponse.json() as { id: string };
    vi.mocked(botRuntime.postListing).mockClear();
    const updateResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        id: createdItem.id,
        name: "Mystery Box",
        description: "limited drop",
        audience: "GROUP",
        cost: 8,
        stock: 2,
        enabled: true,
        fulfillmentInstructions: null,
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(botRuntime.postListing).not.toHaveBeenCalled();
  });

  it("archives shop items without deleting their catalogue record", async () => {
    await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);

    const item = await ctx.prisma.shopItem.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        name: "Seasonal badge",
        description: "Limited time",
        audience: "GROUP",
        cost: 12,
        stock: null,
        enabled: true,
        fulfillmentInstructions: null,
        emoji: "🎁",
      },
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/shop-items/${item.id}/archive`,
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: item.id,
      enabled: false,
    });

    await expect(ctx.prisma.shopItem.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({
      enabled: false,
    });
  });

  it("deletes unused shop items but preserves items with redemption history", async () => {
    await ctx.services.configService.getOrCreate(ctx.env.GUILD_ID);

    const unusedItem = await ctx.prisma.shopItem.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        name: "Unused badge",
        description: "Can be deleted",
        audience: "GROUP",
        cost: 3,
        stock: null,
        enabled: true,
        fulfillmentInstructions: null,
        emoji: "🏷️",
      },
    });
    const usedItem = await ctx.prisma.shopItem.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        name: "Used badge",
        description: "Has purchase history",
        audience: "GROUP",
        cost: 5,
        stock: null,
        enabled: true,
        fulfillmentInstructions: null,
        emoji: "🎟️",
      },
    });
    const group = await ctx.prisma.group.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        displayName: "Archive testers",
        slug: "archive-testers",
        roleId: "role-archive-testers",
        active: true,
      },
    });
    await ctx.prisma.shopRedemption.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        shopItemId: usedItem.id,
        groupId: group.id,
        requestedByUserId: "user-buyer",
        requestedByUsername: "Buyer",
        purchaseMode: "GROUP",
        quantity: 1,
        totalCost: 5,
      },
    });

    const deleteUnusedResponse = await ctx.app.inject({
      method: "DELETE",
      url: `/api/shop-items/${unusedItem.id}`,
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(deleteUnusedResponse.statusCode).toBe(204);
    await expect(ctx.prisma.shopItem.findUnique({ where: { id: unusedItem.id } })).resolves.toBeNull();

    const deleteUsedResponse = await ctx.app.inject({
      method: "DELETE",
      url: `/api/shop-items/${usedItem.id}`,
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });
    expect(deleteUsedResponse.statusCode).toBe(409);
    expect(deleteUsedResponse.json()).toMatchObject({
      message: "Shop items with redemption history cannot be deleted. Disable the item instead.",
    });
    await expect(ctx.prisma.shopItem.findUniqueOrThrow({ where: { id: usedItem.id } })).resolves.toMatchObject({
      id: usedItem.id,
      enabled: true,
    });
  });

  it("prevents shop item updates across guilds", async () => {
    await ctx.services.configService.getOrCreate("guild-other");

    const foreignItem = await ctx.prisma.shopItem.create({
      data: {
        guildId: "guild-other",
        name: "Foreign item",
        description: "Should not be editable",
        audience: "INDIVIDUAL",
        cost: 5,
        stock: 2,
        enabled: true,
        fulfillmentInstructions: null,
        emoji: "🎁",
      },
    });

    await expect(
      ctx.services.shopService.upsert(ctx.env.GUILD_ID, {
        id: foreignItem.id,
        name: "Tampered item",
        description: "Cross-guild update",
        audience: "GROUP",
        cost: 99,
        stock: 0,
        enabled: false,
        fulfillmentInstructions: null,
      }),
    ).rejects.toThrow("Shop item not found.");

    const unchanged = await ctx.prisma.shopItem.findUniqueOrThrow({
      where: { id: foreignItem.id },
    });
    expect(unchanged).toMatchObject({
      guildId: "guild-other",
      name: "Foreign item",
      audience: "INDIVIDUAL",
      enabled: true,
    });
  });

  it("rejects group purchases when the group cannot afford them", async () => {
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

    expect(redeemResponse.statusCode).toBe(409);
    expect(redeemResponse.json()).toMatchObject({
      message: expect.stringMatching(/does not have enough group points/i),
    });
  });

  it("charges funded group purchases on creation", async () => {
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
        pointsDelta: 40,
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
        quantity: 4,
        purchaseMode: "GROUP",
      },
    });

    expect(redeemResponse.statusCode).toBe(200);
    expect(redeemResponse.json()).toMatchObject({
      purchaseMode: "GROUP",
      status: "PENDING",
      quantity: 4,
      totalCost: "40",
      approvalThreshold: null,
    });

    const overLimitResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/actions/redeem",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        participantId: participant.id,
        shopItemId: item.id,
        requestedByUserId: "user-sly",
        requestedByUsername: "Sly user",
        quantity: 5,
        purchaseMode: "GROUP",
      },
    });

    expect(overLimitResponse.statusCode).toBe(400);
  });

  it("lists fulfilment queue items and lets staff fulfil or cancel eligible requests", async () => {
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

    await ctx.app.inject({
      method: "POST",
      url: "/api/actions/award",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        actorUserId: "admin",
        actorUsername: "Admin",
        actorRoleIds: ["role-admin"],
        targetGroupIds: [group.id],
        pointsDelta: 40,
        currencyDelta: 0,
        description: "Seed fulfilment points",
      },
    });

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
          status: "PENDING",
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

  it("applies the classroom preset with staff role mappings", async () => {
    (botRuntime.getRoles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "role-admin-id", name: "Admin" },
      { id: "role-mentor-id", name: "Mentor" },
      { id: "role-alumni-id", name: "Alumni" },
    ]);

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/setup/apply-preset",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        key: "classroom",
        staffRoles: {
          admin: "role-admin-id",
          mentor: "role-mentor-id",
          alumni: "role-alumni-id",
        },
      },
    });

    expect(response.statusCode).toBe(200);

    const config = await ctx.prisma.guildConfig.findUniqueOrThrow({
      where: { guildId: ctx.env.GUILD_ID },
    });
    expect(config.mentorRoleIds).toEqual(expect.arrayContaining(["role-admin-id", "role-mentor-id"]));
    expect(config.mentorRoleIds).not.toContain("role-alumni-id");
    expect(Number(config.passiveCurrencyReward)).toBe(2);
    expect(config.betWinChance).toBe(51);

    const capabilities = await ctx.prisma.discordRoleCapability.findMany({
      where: { guildId: ctx.env.GUILD_ID },
    });
    const byRoleId = new Map(capabilities.map((capability) => [capability.roleId, capability]));
    expect(byRoleId.get("role-admin-id")?.canManageDashboard).toBe(true);
    expect(byRoleId.get("role-admin-id")?.maxAward).toBeNull();
    expect(byRoleId.get("role-admin-id")?.riggedBetWinChance).toBe(90);
    expect(byRoleId.get("role-mentor-id")?.canManageDashboard).toBe(false);
    expect(byRoleId.get("role-mentor-id")?.canAward).toBe(true);
    expect(Number(byRoleId.get("role-mentor-id")?.maxAward)).toBe(500);
    expect(byRoleId.get("role-alumni-id")?.canDeduct).toBe(false);
    expect(Number(byRoleId.get("role-alumni-id")?.maxAward)).toBe(1);
  });

  it("rejects duplicate role mappings across staff tiers", async () => {
    (botRuntime.getRoles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "role-staff", name: "Staff" },
    ]);

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/setup/apply-preset",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        key: "classroom",
        staffRoles: {
          admin: "role-staff",
          mentor: "role-staff",
        },
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
