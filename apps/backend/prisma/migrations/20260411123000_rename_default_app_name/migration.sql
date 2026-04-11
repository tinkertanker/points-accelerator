ALTER TABLE "GuildConfig"
ALTER COLUMN "appName" SET DEFAULT 'points accelerator';

UPDATE "GuildConfig"
SET "appName" = 'points accelerator'
WHERE "appName" = 'economy rice';
