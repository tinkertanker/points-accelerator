-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'GOFUNDME_DONATION';

-- CreateTable
CREATE TABLE "GoFundMeCampaign" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goalPoints" DECIMAL(18,6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoFundMeCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoFundMeDonation" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "createdByUserId" TEXT,
    "createdByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoFundMeDonation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoFundMeCampaign_guildId_active_createdAt_idx" ON "GoFundMeCampaign"("guildId", "active", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "GoFundMeDonation_ledgerEntryId_key" ON "GoFundMeDonation"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "GoFundMeDonation_guildId_createdAt_idx" ON "GoFundMeDonation"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GoFundMeDonation_campaignId_createdAt_idx" ON "GoFundMeDonation"("campaignId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GoFundMeDonation_participantId_createdAt_idx" ON "GoFundMeDonation"("participantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GoFundMeDonation_groupId_createdAt_idx" ON "GoFundMeDonation"("groupId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "GoFundMeCampaign" ADD CONSTRAINT "GoFundMeCampaign_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoFundMeDonation" ADD CONSTRAINT "GoFundMeDonation_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoFundMeDonation" ADD CONSTRAINT "GoFundMeDonation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GoFundMeCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoFundMeDonation" ADD CONSTRAINT "GoFundMeDonation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoFundMeDonation" ADD CONSTRAINT "GoFundMeDonation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoFundMeDonation" ADD CONSTRAINT "GoFundMeDonation_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
