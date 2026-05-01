import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

const GUILD_ID = "guild-test";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  const managed = ensureTestDatabase();
  cleanupDatabase = managed.cleanup;
  ctx = await createTestApp(managed.url);
}, 60_000);

afterAll(async () => {
  await ctx.app.close();
  await ctx.prisma.$disconnect();
  await cleanupDatabase();
});

beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  await ctx.services.configService.getOrCreate(GUILD_ID);
});

async function seedParticipant(discordUserId = "user-1") {
  const group = await ctx.prisma.group.create({
    data: { guildId: GUILD_ID, displayName: "Alpha", slug: "alpha", roleId: "role-alpha" },
  });
  return ctx.prisma.participant.create({
    data: {
      guildId: GUILD_ID,
      groupId: group.id,
      discordUserId,
      discordUsername: discordUserId,
      indexId: discordUserId,
    },
  });
}

const ADMIN = { userId: "admin-1", username: "Admin" };

describe("SanctionService", () => {
  it("applies a sanction with reason and expiry, then lists it as active", async () => {
    const p = await seedParticipant();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const sanction = await ctx.services.sanctionService.apply({
      guildId: GUILD_ID,
      participantId: p.id,
      flag: "CANNOT_BET",
      reason: "Found rigging bets",
      expiresAt,
      actor: ADMIN,
    });

    expect(sanction.flag).toBe("CANNOT_BET");
    expect(sanction.reason).toBe("Found rigging bets");
    expect(sanction.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
    expect(sanction.revokedAt).toBeNull();

    const flags = await ctx.services.sanctionService.getActiveFlags(p.id);
    expect(flags.has("CANNOT_BET")).toBe(true);
    expect(flags.size).toBe(1);
  });

  it("rejects applying a sanction with an expiry in the past", async () => {
    const p = await seedParticipant();
    await expect(
      ctx.services.sanctionService.apply({
        guildId: GUILD_ID,
        participantId: p.id,
        flag: "CANNOT_BET",
        expiresAt: new Date(Date.now() - 1_000),
        actor: ADMIN,
      }),
    ).rejects.toThrow(/future/i);
  });

  it("revoking a sanction removes it from active flags", async () => {
    const p = await seedParticipant();
    const sanction = await ctx.services.sanctionService.apply({
      guildId: GUILD_ID,
      participantId: p.id,
      flag: "CANNOT_BUY",
      actor: ADMIN,
    });
    await ctx.services.sanctionService.revoke({
      guildId: GUILD_ID,
      sanctionId: sanction.id,
      actor: ADMIN,
    });

    const flags = await ctx.services.sanctionService.getActiveFlags(p.id);
    expect(flags.size).toBe(0);
  });

  it("expired sanctions are not active", async () => {
    const p = await seedParticipant();
    // bypass apply()'s guard by creating directly with a past expiry
    await ctx.prisma.participantSanction.create({
      data: {
        guildId: GUILD_ID,
        participantId: p.id,
        flag: "CANNOT_TRANSFER",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const flags = await ctx.services.sanctionService.getActiveFlags(p.id);
    expect(flags.size).toBe(0);
  });

  it("assertNotSanctioned throws when the flag is active", async () => {
    const p = await seedParticipant();
    await ctx.services.sanctionService.apply({
      guildId: GUILD_ID,
      participantId: p.id,
      flag: "CANNOT_BET",
      actor: ADMIN,
    });
    await expect(
      ctx.services.sanctionService.assertNotSanctioned(p.id, "CANNOT_BET"),
    ).rejects.toThrow(/sanctioned/i);
    await expect(
      ctx.services.sanctionService.assertNotSanctioned(p.id, "CANNOT_BUY"),
    ).resolves.toBeUndefined();
  });

  it("listForParticipant returns all sanctions including revoked and expired", async () => {
    const p = await seedParticipant();
    const active = await ctx.services.sanctionService.apply({
      guildId: GUILD_ID,
      participantId: p.id,
      flag: "CANNOT_BET",
      actor: ADMIN,
    });
    const revoked = await ctx.services.sanctionService.apply({
      guildId: GUILD_ID,
      participantId: p.id,
      flag: "CANNOT_BUY",
      actor: ADMIN,
    });
    await ctx.services.sanctionService.revoke({
      guildId: GUILD_ID,
      sanctionId: revoked.id,
      actor: ADMIN,
    });
    const list = await ctx.services.sanctionService.listForParticipant(GUILD_ID, p.id);
    expect(list.map((s) => s.id).sort()).toEqual([active.id, revoked.id].sort());
  });

  it("revoking an already-revoked sanction errors", async () => {
    const p = await seedParticipant();
    const sanction = await ctx.services.sanctionService.apply({
      guildId: GUILD_ID,
      participantId: p.id,
      flag: "CANNOT_BET",
      actor: ADMIN,
    });
    await ctx.services.sanctionService.revoke({
      guildId: GUILD_ID,
      sanctionId: sanction.id,
      actor: ADMIN,
    });
    await expect(
      ctx.services.sanctionService.revoke({
        guildId: GUILD_ID,
        sanctionId: sanction.id,
        actor: ADMIN,
      }),
    ).rejects.toThrow(/already revoked/i);
  });
});
