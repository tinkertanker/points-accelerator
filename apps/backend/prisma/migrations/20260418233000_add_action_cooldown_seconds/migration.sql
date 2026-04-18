ALTER TABLE "DiscordRoleCapability"
ADD COLUMN "actionCooldownSeconds" INTEGER;

UPDATE "DiscordRoleCapability"
SET "actionCooldownSeconds" = 10
WHERE "canAward" = TRUE OR "canDeduct" = TRUE;
