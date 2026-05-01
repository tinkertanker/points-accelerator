-- AlterEnum
ALTER TYPE "ParticipantCurrencyEntryType" ADD VALUE 'WRONG_CHANNEL_TAX';

-- AlterTable
ALTER TABLE "GuildConfig"
    ADD COLUMN "bettingChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "luckyDrawChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "pointsChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "shopChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "wrongChannelPenalty" DECIMAL(18,6) NOT NULL DEFAULT 0;
