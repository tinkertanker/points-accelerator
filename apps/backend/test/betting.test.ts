import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

const GUILD_ID = "guild-test";

async function seedSettingsAndGroup() {
  await ctx.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    payload: {
      appName: "points accelerator",
      pointsName: "points",
      currencyName: "rice",
      mentorRoleIds: [],
      passivePointsReward: 1,
      passiveCurrencyReward: 1,
      passiveCooldownSeconds: 60,
      passiveMinimumCharacters: 4,
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
        roleId: "role-alpha",
        roleName: "Team Alpha",
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
      displayName: "Team Alpha",
      slug: "team-alpha",
      mentorName: "Mentor",
      roleId: "role-alpha",
      aliases: ["alpha"],
      active: true,
    },
  });

  const group = groupResponse.json() as { id: string };

  // Give the group some starting currency via award
  await ctx.app.inject({
    method: "POST",
    url: "/api/actions/award",
    headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    payload: {
      actorUserId: "admin-user",
      actorUsername: "admin",
      actorRoleIds: ["role-admin"],
      targetGroupIds: [group.id],
      pointsDelta: 0,
      currencyDelta: 100,
      description: "Starting currency for betting tests",
    },
  });

  return group;
}

describe("betting system", () => {
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

  it("places a bet and creates a ledger entry", async () => {
    const group = await seedSettingsAndGroup();

    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };
    const result = await ctx.services.bettingService.placeBet({
      guildId: GUILD_ID,
      actor,
      groupId: group.id,
      groupDisplayName: "Team Alpha",
      amount: 10,
    });

    expect(result.amount).toBe(10);
    expect(typeof result.won).toBe("boolean");
    expect(typeof result.newCurrencyBalance).toBe("number");

    // Should have created a ledger entry of type BET_WIN or BET_LOSS
    const entries = await ctx.prisma.ledgerEntry.findMany({
      where: { guildId: GUILD_ID, type: { in: ["BET_WIN", "BET_LOSS"] } },
      include: { splits: true },
    });
    expect(entries).toHaveLength(1);

    if (result.won) {
      expect(entries[0].type).toBe("BET_WIN");
      expect(result.newCurrencyBalance).toBe(110);
    } else {
      expect(entries[0].type).toBe("BET_LOSS");
      expect(result.newCurrencyBalance).toBe(90);
    }
  });

  it("rejects bet when group has insufficient currency", async () => {
    const group = await seedSettingsAndGroup();

    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };
    await expect(
      ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        groupId: group.id,
        groupDisplayName: "Team Alpha",
        amount: 200,
      }),
    ).rejects.toThrow(/enough currency/i);
  });

  it("rejects bet with zero or negative amount", async () => {
    const group = await seedSettingsAndGroup();

    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };
    await expect(
      ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        groupId: group.id,
        groupDisplayName: "Team Alpha",
        amount: 0,
      }),
    ).rejects.toThrow(/greater than zero/i);

    await expect(
      ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        groupId: group.id,
        groupDisplayName: "Team Alpha",
        amount: -5,
      }),
    ).rejects.toThrow(/greater than zero/i);
  });

  it("returns betting stats for a user", async () => {
    const group = await seedSettingsAndGroup();
    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };

    // Place several small bets
    for (let i = 0; i < 5; i++) {
      await ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        groupId: group.id,
        groupDisplayName: "Team Alpha",
        amount: 1,
      });
    }

    const stats = await ctx.services.bettingService.getStats(GUILD_ID, "user-1");
    expect(stats.totalBets).toBe(5);
    expect(stats.wins + stats.losses).toBe(5);
    expect(stats.totalWon).toBeGreaterThanOrEqual(0);
    expect(stats.totalLost).toBeGreaterThanOrEqual(0);
  });

  it("returns empty stats for a user with no bets", async () => {
    await seedSettingsAndGroup();
    const stats = await ctx.services.bettingService.getStats(GUILD_ID, "unknown-user");
    expect(stats).toEqual({
      totalBets: 0,
      wins: 0,
      losses: 0,
      totalWon: 0,
      totalLost: 0,
      netGain: 0,
    });
  });

  it("allows exclusion voting and blocks betting when excluded", async () => {
    const group = await seedSettingsAndGroup();

    // First vote
    const vote1 = await ctx.services.bettingService.voteExclusion({
      guildId: GUILD_ID,
      voterUserId: "user-2",
      voterUsername: "bob",
      targetUserId: "user-1",
      targetUsername: "alice",
      groupRoleIds: ["role-alpha"],
    });
    expect(vote1.finalized).toBe(false);
    expect(vote1.expiresAt).toBeNull();

    // Second vote from a different user finalizes the exclusion
    const vote2 = await ctx.services.bettingService.voteExclusion({
      guildId: GUILD_ID,
      voterUserId: "user-3",
      voterUsername: "carol",
      targetUserId: "user-1",
      targetUsername: "alice",
      groupRoleIds: ["role-alpha"],
    });
    expect(vote2.finalized).toBe(true);
    expect(vote2.expiresAt).not.toBeNull();

    // Now user-1 should be excluded from betting
    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };
    await expect(
      ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        groupId: group.id,
        groupDisplayName: "Team Alpha",
        amount: 1,
      }),
    ).rejects.toThrow(/excluded from betting/i);
  });

  it("prevents self-exclusion voting", async () => {
    await seedSettingsAndGroup();

    await expect(
      ctx.services.bettingService.voteExclusion({
        guildId: GUILD_ID,
        voterUserId: "user-1",
        voterUsername: "alice",
        targetUserId: "user-1",
        targetUsername: "alice",
        groupRoleIds: ["role-alpha"],
      }),
    ).rejects.toThrow(/cannot exclude yourself/i);
  });

  it("prevents duplicate votes from the same user", async () => {
    await seedSettingsAndGroup();

    await ctx.services.bettingService.voteExclusion({
      guildId: GUILD_ID,
      voterUserId: "user-2",
      voterUsername: "bob",
      targetUserId: "user-1",
      targetUsername: "alice",
      groupRoleIds: ["role-alpha"],
    });

    await expect(
      ctx.services.bettingService.voteExclusion({
        guildId: GUILD_ID,
        voterUserId: "user-2",
        voterUsername: "bob",
        targetUserId: "user-1",
        targetUsername: "alice",
        groupRoleIds: ["role-alpha"],
      }),
    ).rejects.toThrow(/already voted/i);
  });

  it("settings API includes betWinChance", async () => {
    await seedSettingsAndGroup();

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });

    const settings = response.json() as { betWinChance: number };
    expect(settings.betWinChance).toBe(50);
  });

  it("settings API allows updating betWinChance", async () => {
    await seedSettingsAndGroup();

    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        appName: "points accelerator",
        pointsName: "points",
        currencyName: "rice",
        mentorRoleIds: [],
        passivePointsReward: 1,
        passiveCurrencyReward: 1,
        passiveCooldownSeconds: 60,
        passiveMinimumCharacters: 4,
        passiveAllowedChannelIds: [],
        passiveDeniedChannelIds: [],
        commandLogChannelId: null,
        redemptionChannelId: null,
        listingChannelId: null,
        economyMode: "SIMPLE",
        betWinChance: 75,
      },
    });

    const settings = response.json() as { betWinChance: number };
    expect(settings.betWinChance).toBe(75);
  });
});
