import { createDiscordOAuthClient } from "./auth/discord-oauth.js";
import { createApp } from "./app.js";
import { BotRuntime } from "./bot/runtime.js";
import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./db/client.js";
import { createServices } from "./services/app-services.js";

const env = loadEnv();
const prisma = createPrismaClient();
const services = createServices(prisma);
const botRuntime = new BotRuntime(env, services);
const discordOAuthClient = createDiscordOAuthClient({
  applicationId: env.DISCORD_APPLICATION_ID,
  clientSecret: env.DISCORD_CLIENT_SECRET,
});
const app = createApp({ env, services, botRuntime, discordOAuthClient });

const start = async () => {
  await prisma.$connect();
  await botRuntime.start();
  await app.listen({
    port: env.PORT,
    host: "0.0.0.0",
  });
};

void start();

const shutdown = async () => {
  await botRuntime.stop();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
