import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

describe("GoFundMe service", () => {
  beforeAll(async () => {
    const managed = ensureTestDatabase();
    cleanupDatabase = managed.cleanup;
    ctx = await createTestApp(managed.url);
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.prisma.guildConfig.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        pointsName: "points",
        pointsSymbol: "🏅",
      },
    });
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.app.close();
      await ctx.prisma.$disconnect();
    }
    cleanupDatabase();
  });

  it("deducts donated group points and tracks campaign progress", async () => {
    const group = await ctx.prisma.group.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        displayName: "Gryffindor",
        slug: "gryffindor",
        roleId: "role-gryffindor",
      },
    });
    const participant = await ctx.prisma.participant.create({
      data: {
        guildId: ctx.env.GUILD_ID,
        discordUserId: "user-1",
        discordUsername: "Alice",
        indexId: "alice",
        groupId: group.id,
      },
    });

    await ctx.services.economyService.awardGroups({
      guildId: ctx.env.GUILD_ID,
      actor: { userId: "system", username: "System", roleIds: [] },
      targetGroupIds: [group.id],
      pointsDelta: 100,
      currencyDelta: 0,
      description: "Seed points",
      type: "CORRECTION",
      systemAction: true,
    });

    await ctx.services.goFundMeService.setActiveCampaign({
      guildId: ctx.env.GUILD_ID,
      actor: { userId: "admin-1", username: "Admin", roleIds: [] },
      title: "Pizza Fund",
      goalPoints: 120,
    });

    const result = await ctx.services.goFundMeService.donateGroupPoints({
      guildId: ctx.env.GUILD_ID,
      actor: { userId: "user-1", username: "Alice", roleIds: [] },
      participantId: participant.id,
      groupId: group.id,
      amount: 30,
    });

    expect(result.summary.title).toBe("Pizza Fund");
    expect(result.summary.donatedPoints).toBe(30);
    expect(result.summary.goalPoints).toBe(120);
    expect(result.summary.progress).toBe(0.25);

    const balance = await ctx.services.economyService.getGroupBalance(group.id);
    expect(balance.pointsBalance).toBe(70);

    const donation = await ctx.prisma.goFundMeDonation.findUnique({
      where: { ledgerEntryId: result.ledgerEntry.id },
      include: { ledgerEntry: { include: { splits: true } } },
    });
    expect(donation?.amount.toString()).toBe("30");
    expect(donation?.ledgerEntry.type).toBe("GOFUNDME_DONATION");
    expect(donation?.ledgerEntry.splits[0]?.pointsDelta.toString()).toBe("-30");
  });
});
