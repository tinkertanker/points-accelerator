ALTER TABLE "GuildConfig"
ADD COLUMN "publicLeaderboardToken" TEXT;

CREATE UNIQUE INDEX "GuildConfig_publicLeaderboardToken_key"
ON "GuildConfig"("publicLeaderboardToken");
