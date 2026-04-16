ALTER TYPE "RedemptionStatus" ADD VALUE 'AWAITING_APPROVAL';

CREATE TYPE "RedemptionMode" AS ENUM ('INDIVIDUAL', 'GROUP');

CREATE TYPE "ParticipantCurrencyEntryType" AS ENUM (
    'MESSAGE_REWARD',
    'MANUAL_AWARD',
    'MANUAL_DEDUCT',
    'CORRECTION',
    'TRANSFER',
    'DONATION',
    'SHOP_REDEMPTION',
    'SUBMISSION_REWARD'
);

ALTER TABLE "ShopRedemption"
ADD COLUMN "requestedByParticipantId" TEXT,
ADD COLUMN "purchaseMode" "RedemptionMode" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN "approvalThreshold" INTEGER,
ADD COLUMN "approvalMessageChannelId" TEXT,
ADD COLUMN "approvalMessageId" TEXT,
ADD COLUMN "currencyEntryId" TEXT;

CREATE TABLE "ParticipantCurrencyEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" "ParticipantCurrencyEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByUsername" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipantCurrencyEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParticipantCurrencySplit" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "currencyDelta" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipantCurrencySplit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopRedemptionApproval" (
    "id" TEXT NOT NULL,
    "redemptionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopRedemptionApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopRedemption_currencyEntryId_key" ON "ShopRedemption"("currencyEntryId");
CREATE INDEX "ShopRedemption_requestedByParticipantId_createdAt_idx" ON "ShopRedemption"("requestedByParticipantId", "createdAt" DESC);

CREATE INDEX "ParticipantCurrencyEntry_guildId_createdAt_idx" ON "ParticipantCurrencyEntry"("guildId", "createdAt" DESC);
CREATE INDEX "ParticipantCurrencyEntry_guildId_externalRef_idx" ON "ParticipantCurrencyEntry"("guildId", "externalRef");

CREATE INDEX "ParticipantCurrencySplit_participantId_createdAt_idx" ON "ParticipantCurrencySplit"("participantId", "createdAt" DESC);
CREATE INDEX "ParticipantCurrencySplit_entryId_idx" ON "ParticipantCurrencySplit"("entryId");

CREATE UNIQUE INDEX "ShopRedemptionApproval_redemptionId_participantId_key" ON "ShopRedemptionApproval"("redemptionId", "participantId");
CREATE INDEX "ShopRedemptionApproval_participantId_createdAt_idx" ON "ShopRedemptionApproval"("participantId", "createdAt" DESC);

ALTER TABLE "ShopRedemption"
ADD CONSTRAINT "ShopRedemption_requestedByParticipantId_fkey" FOREIGN KEY ("requestedByParticipantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShopRedemption"
ADD CONSTRAINT "ShopRedemption_currencyEntryId_fkey" FOREIGN KEY ("currencyEntryId") REFERENCES "ParticipantCurrencyEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ParticipantCurrencyEntry"
ADD CONSTRAINT "ParticipantCurrencyEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ParticipantCurrencySplit"
ADD CONSTRAINT "ParticipantCurrencySplit_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ParticipantCurrencyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ParticipantCurrencySplit"
ADD CONSTRAINT "ParticipantCurrencySplit_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShopRedemptionApproval"
ADD CONSTRAINT "ShopRedemptionApproval_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "ShopRedemption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShopRedemptionApproval"
ADD CONSTRAINT "ShopRedemptionApproval_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
