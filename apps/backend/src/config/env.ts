import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  GUILD_ID: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_APPLICATION_ID: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  ADMIN_TOKEN: z.string().min(8),
  PUBLIC_APP_NAME: z.string().default("economy rice"),
  MESSAGE_REWARD_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(overrides?: Partial<Record<keyof AppEnv, string | number | undefined>>): AppEnv {
  return envSchema.parse({
    ...process.env,
    ...overrides,
  });
}

