import type { DiscordOAuthClient } from "../../src/auth/discord-oauth.js";
import type { BotRuntimeApi } from "../../src/bot/runtime.js";
import { loadEnv } from "../../src/config/env.js";
import { createPrismaClient } from "../../src/db/client.js";
import { createServices } from "../../src/services/app-services.js";
import { createApp } from "../../src/app.js";

export async function createTestApp(
  databaseUrl: string,
  options?: {
    botRuntime?: BotRuntimeApi | null;
    discordOAuthClient?: DiscordOAuthClient | null;
  },
) {
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    GUILD_ID: "guild-test",
    ADMIN_TOKEN: "test-admin-token",
    APP_PUBLIC_URL: "http://localhost:4173",
    DISCORD_OAUTH_REDIRECT_URI: "http://localhost:3001/api/auth/discord/callback",
    PORT: 1,
  });

  process.env.NODE_ENV = env.NODE_ENV;
  process.env.DATABASE_URL = databaseUrl;
  process.env.GUILD_ID = env.GUILD_ID;
  process.env.ADMIN_TOKEN = env.ADMIN_TOKEN ?? "";

  const prisma = createPrismaClient();
  const services = createServices(prisma);
  const app = createApp({
    env,
    services,
    botRuntime: options?.botRuntime ?? null,
    discordOAuthClient: options?.discordOAuthClient ?? null,
  });

  await prisma.$connect();
  await app.ready();

  return {
    env,
    prisma,
    services,
    app,
  };
}

export async function resetDatabase(prisma: ReturnType<typeof createPrismaClient>) {
  await prisma.luckyDrawEntry.deleteMany();
  await prisma.luckyDraw.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.shopRedemptionApproval.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.participantCurrencySplit.deleteMany();
  await prisma.participantCurrencyEntry.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.marketplaceListing.deleteMany();
  await prisma.shopRedemption.deleteMany();
  await prisma.shopItem.deleteMany();
  await prisma.ledgerSplit.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.groupAlias.deleteMany();
  await prisma.group.deleteMany();
  await prisma.discordRoleCapability.deleteMany();
  await prisma.reactionRewardRule.deleteMany();
  await prisma.guildConfig.deleteMany();
}
