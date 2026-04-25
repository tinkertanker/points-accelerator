-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'LUCKYDRAW_WIN';

-- AlterEnum
ALTER TYPE "ParticipantCurrencyEntryType" ADD VALUE 'LUCKYDRAW_WIN';

-- CreateEnum
CREATE TYPE "LuckyDrawStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "LuckyDraw" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdByUsername" TEXT,
    "description" TEXT,
    "prizeAmount" DECIMAL(18,6) NOT NULL,
    "winnerCount" INTEGER NOT NULL DEFAULT 1,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "LuckyDrawStatus" NOT NULL DEFAULT 'ACTIVE',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LuckyDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LuckyDrawEntry" (
    "id" TEXT NOT NULL,
    "luckyDrawId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wonAt" TIMESTAMP(3),

    CONSTRAINT "LuckyDrawEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LuckyDraw_guildId_status_endsAt_idx" ON "LuckyDraw"("guildId", "status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "LuckyDrawEntry_luckyDrawId_userId_key" ON "LuckyDrawEntry"("luckyDrawId", "userId");

-- CreateIndex
CREATE INDEX "LuckyDrawEntry_luckyDrawId_enteredAt_idx" ON "LuckyDrawEntry"("luckyDrawId", "enteredAt");

-- AddForeignKey
ALTER TABLE "LuckyDraw" ADD CONSTRAINT "LuckyDraw_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LuckyDrawEntry" ADD CONSTRAINT "LuckyDrawEntry_luckyDrawId_fkey" FOREIGN KEY ("luckyDrawId") REFERENCES "LuckyDraw"("id") ON DELETE CASCADE ON UPDATE CASCADE;
