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
        currencyName: "personal points",
        currencySymbol: "⭐",
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

  it("deducts donated personal points and tracks campaign progress", async () => {
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

    await ctx.services.participantCurrencyService.awardParticipants({
      guildId: ctx.env.GUILD_ID,
      actor: { userId: "system", username: "System", roleIds: [] },
      targetParticipantIds: [participant.id],
      currencyDelta: 100,
      description: "Seed personal points",
      type: "CORRECTION",
      systemAction: true,
    });

    await ctx.services.goFundMeService.setActiveCampaign({
      guildId: ctx.env.GUILD_ID,
      actor: { userId: "admin-1", username: "Admin", roleIds: [] },
      title: "Pizza Fund",
      goalPoints: 120,
    });

    const result = await ctx.services.goFundMeService.donatePersonalCurrency({
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

    const balance = await ctx.services.participantCurrencyService.getParticipantBalance(participant.id);
    expect(balance).toBe(70);

    const donation = await ctx.prisma.goFundMeDonation.findUnique({
      where: { currencyEntryId: result.currencyEntry.id },
      include: { currencyEntry: { include: { splits: true } } },
    });
    expect(donation?.amount.toString()).toBe("30");
    expect(donation?.ledgerEntryId).toBeNull();
    expect(donation?.currencyEntry?.type).toBe("DONATION");
    expect(donation?.currencyEntry?.splits[0]?.currencyDelta.toString()).toBe("-30");
  });
});
