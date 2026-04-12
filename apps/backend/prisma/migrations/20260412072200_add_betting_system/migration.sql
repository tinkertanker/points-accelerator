-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'BET_WIN';
ALTER TYPE "LedgerEntryType" ADD VALUE 'BET_LOSS';

-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN "betWinChance" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "BetExclusion" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetUsername" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdByUsername" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BetExclusion_guildId_targetUserId_expiresAt_idx" ON "BetExclusion"("guildId", "targetUserId", "expiresAt");

-- AddForeignKey
ALTER TABLE "BetExclusion" ADD CONSTRAINT "BetExclusion_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
