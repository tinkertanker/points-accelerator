import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./db/client.js";

const env = loadEnv();
const prisma = createPrismaClient();

await prisma.$connect();
await prisma.$queryRaw`SELECT 1`;
await prisma.$disconnect();

process.stdout.write(`ok:${env.GUILD_ID}`);

