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
      pointsSymbol: "🏅",
      currencyName: "rice",
      currencySymbol: "💲",
      groupPointsPerCurrencyDonation: 10,
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
  const participant = await ctx.services.participantService.ensureForGroup({
    guildId: GUILD_ID,
    discordUserId: "user-1",
    discordUsername: "alice",
    groupId: group.id,
  });

  await ctx.services.participantCurrencyService.awardParticipants({
    guildId: GUILD_ID,
    actor: {
      userId: "admin-user",
      username: "admin",
      roleIds: ["role-admin"],
    },
    targetParticipantIds: [participant.id],
    currencyDelta: 100,
    description: "Starting currency for betting tests",
    systemAction: true,
  });

  return { group, participant };
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
    const { participant } = await seedSettingsAndGroup();

    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };
    const result = await ctx.services.bettingService.placeBet({
      guildId: GUILD_ID,
      actor,
      participantId: participant.id,
      amount: 10,
    });

    expect(result.amount).toBe(10);
    expect(typeof result.won).toBe("boolean");
    expect(typeof result.newCurrencyBalance).toBe("number");

    const entries = await ctx.prisma.participantCurrencyEntry.findMany({
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

  it("rejects bet when the participant wallet has insufficient currency", async () => {
    const { participant } = await seedSettingsAndGroup();

    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };
    await expect(
      ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        participantId: participant.id,
        amount: 200,
      }),
    ).rejects.toThrow(/enough currency/i);
  });

  it("rejects bets against another participant's wallet", async () => {
    const { group, participant } = await seedSettingsAndGroup();
    const otherParticipant = await ctx.services.participantService.ensureForGroup({
      guildId: GUILD_ID,
      discordUserId: "user-2",
      discordUsername: "bob",
      groupId: group.id,
    });

    await ctx.services.participantCurrencyService.awardParticipants({
      guildId: GUILD_ID,
      actor: {
        userId: "admin-user",
        username: "admin",
        roleIds: ["role-admin"],
      },
      targetParticipantIds: [otherParticipant.id],
      currencyDelta: 50,
      description: "Starting currency for another participant",
      systemAction: true,
    });

    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };
    await expect(
      ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        participantId: otherParticipant.id,
        amount: 10,
      }),
    ).rejects.toThrow(/only bet with their own wallet currency/i);

    expect(participant.id).not.toBe(otherParticipant.id);
  });

  it("rejects bet with zero or negative amount", async () => {
    const { participant } = await seedSettingsAndGroup();

    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };
    await expect(
      ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        participantId: participant.id,
        amount: 0,
      }),
    ).rejects.toThrow(/greater than zero/i);

    await expect(
      ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        participantId: participant.id,
        amount: -5,
      }),
    ).rejects.toThrow(/greater than zero/i);
  });

  it("returns betting stats for a user", async () => {
    const { participant } = await seedSettingsAndGroup();
    const actor = { userId: "user-1", username: "alice", roleIds: ["role-alpha"] };

    for (let i = 0; i < 5; i++) {
      await ctx.services.bettingService.placeBet({
        guildId: GUILD_ID,
        actor,
        participantId: participant.id,
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
        pointsSymbol: "🏅",
        currencyName: "rice",
        currencySymbol: "💲",
        groupPointsPerCurrencyDonation: 10,
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
        betWinChance: 75,
        bettingCooldownSeconds: 0,
      },
    });

    expect(response.statusCode).toBe(200);

    const getResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    });

    const settings = getResponse.json() as { betWinChance: number };
    expect(settings.betWinChance).toBe(75);
  });
});
