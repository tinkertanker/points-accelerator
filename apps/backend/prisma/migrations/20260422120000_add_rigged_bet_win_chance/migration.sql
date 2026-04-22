ALTER TABLE "DiscordRoleCapability"
ADD COLUMN "riggedBetWinChance" INTEGER;

UPDATE "DiscordRoleCapability"
SET "riggedBetWinChance" = 80
WHERE "canAward" = TRUE;
