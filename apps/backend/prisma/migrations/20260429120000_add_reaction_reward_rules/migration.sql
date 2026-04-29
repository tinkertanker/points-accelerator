-- AlterEnum
ALTER TYPE "ParticipantCurrencyEntryType" ADD VALUE 'REACTION_REWARD';

-- CreateTable
CREATE TABLE "ReactionRewardRule" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "currencyDelta" DECIMAL(18,6) NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReactionRewardRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReactionRewardRule_guildId_channelId_botUserId_emoji_key" ON "ReactionRewardRule"("guildId", "channelId", "botUserId", "emoji");

-- CreateIndex
CREATE INDEX "ReactionRewardRule_guildId_channelId_botUserId_idx" ON "ReactionRewardRule"("guildId", "channelId", "botUserId");

-- AddForeignKey
ALTER TABLE "ReactionRewardRule" ADD CONSTRAINT "ReactionRewardRule_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
