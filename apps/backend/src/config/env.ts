import "dotenv/config";

import { z } from "zod";

function optionalNonEmptyString() {
  return z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
}

function optionalUrlString() {
  return z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  GUILD_ID: optionalNonEmptyString(),
  APP_PUBLIC_URL: optionalUrlString(),
  APP_DOMAIN: optionalNonEmptyString(),
  DISCORD_BOT_TOKEN: optionalNonEmptyString(),
  DISCORD_APPLICATION_ID: optionalNonEmptyString(),
  DISCORD_CLIENT_SECRET: optionalNonEmptyString(),
  DISCORD_GUILD_ID: optionalNonEmptyString(),
  DISCORD_OAUTH_REDIRECT_URI: optionalUrlString(),
  ADMIN_TOKEN: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(8).optional()),
  PUBLIC_APP_NAME: z.string().default("points accelerator"),
  MESSAGE_REWARD_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  R2_ENDPOINT: optionalUrlString(),
  R2_ACCESS_KEY_ID: optionalNonEmptyString(),
  R2_SECRET_ACCESS_KEY: optionalNonEmptyString(),
  R2_BUCKET_NAME: optionalNonEmptyString(),
  R2_PUBLIC_URL: optionalUrlString(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(overrides?: Partial<Record<keyof AppEnv, string | number | undefined>>): AppEnv {
  return envSchema.parse({
    ...process.env,
    ...overrides,
  });
}
