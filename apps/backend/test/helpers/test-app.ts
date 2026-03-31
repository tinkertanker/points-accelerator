import { loadEnv } from "../../src/config/env.js";
import { createPrismaClient } from "../../src/db/client.js";
import { createServices } from "../../src/services/app-services.js";
import { createApp } from "../../src/app.js";

export async function createTestApp(databaseUrl: string) {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    GUILD_ID: "guild-test",
    ADMIN_TOKEN: "test-admin-token",
    PORT: 1,
  });

  process.env.DATABASE_URL = databaseUrl;
  process.env.GUILD_ID = env.GUILD_ID;
  process.env.ADMIN_TOKEN = env.ADMIN_TOKEN;

  const prisma = createPrismaClient();
  const services = createServices(prisma);
  const app = createApp({
    env,
    services,
    botRuntime: null,
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
  await prisma.auditLog.deleteMany();
  await prisma.marketplaceListing.deleteMany();
  await prisma.shopRedemption.deleteMany();
  await prisma.shopItem.deleteMany();
  await prisma.ledgerSplit.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.groupAlias.deleteMany();
  await prisma.group.deleteMany();
  await prisma.discordRoleCapability.deleteMany();
  await prisma.guildConfig.deleteMany();
}
