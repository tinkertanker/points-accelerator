-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EconomyMode" AS ENUM ('SIMPLE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('MESSAGE_REWARD', 'MANUAL_AWARD', 'MANUAL_DEDUCT', 'CORRECTION', 'TRANSFER', 'DONATION', 'SHOP_REDEMPTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELED');

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "appName" TEXT NOT NULL DEFAULT 'economy rice',
    "pointsName" TEXT NOT NULL DEFAULT 'points',
    "currencyName" TEXT NOT NULL DEFAULT 'rice',
    "passivePointsReward" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "passiveCurrencyReward" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "passiveCooldownSeconds" INTEGER NOT NULL DEFAULT 60,
    "passiveMinimumCharacters" INTEGER NOT NULL DEFAULT 4,
    "passiveAllowedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "passiveDeniedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commandLogChannelId" TEXT,
    "redemptionChannelId" TEXT,
    "listingChannelId" TEXT,
    "economyMode" "EconomyMode" NOT NULL DEFAULT 'SIMPLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "mentorName" TEXT,
    "roleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupAlias" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordRoleCapability" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "canManageDashboard" BOOLEAN NOT NULL DEFAULT false,
    "canAward" BOOLEAN NOT NULL DEFAULT false,
    "maxAward" DECIMAL(18,6),
    "canDeduct" BOOLEAN NOT NULL DEFAULT false,
    "canMultiAward" BOOLEAN NOT NULL DEFAULT false,
    "canSell" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveAwards" BOOLEAN NOT NULL DEFAULT true,
    "isGroupRole" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordRoleCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByUsername" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerSplit" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "pointsDelta" DECIMAL(18,6) NOT NULL,
    "currencyDelta" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopItem" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currencyCost" DECIMAL(18,6) NOT NULL,
    "stock" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "fulfillmentInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopRedemption" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "shopItemId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByUsername" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "totalCurrencyCost" DECIMAL(18,6) NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER,
    "createdByUserId" TEXT NOT NULL,
    "createdByUsername" TEXT,
    "channelId" TEXT,
    "messageId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorUsername" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_guildId_slug_key" ON "Group"("guildId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Group_guildId_roleId_key" ON "Group"("guildId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAlias_groupId_value_key" ON "GroupAlias"("groupId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordRoleCapability_guildId_roleId_key" ON "DiscordRoleCapability"("guildId", "roleId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAlias" ADD CONSTRAINT "GroupAlias_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscordRoleCapability" ADD CONSTRAINT "DiscordRoleCapability_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSplit" ADD CONSTRAINT "LedgerSplit_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSplit" ADD CONSTRAINT "LedgerSplit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopItem" ADD CONSTRAINT "ShopItem_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopRedemption" ADD CONSTRAINT "ShopRedemption_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopRedemption" ADD CONSTRAINT "ShopRedemption_shopItemId_fkey" FOREIGN KEY ("shopItemId") REFERENCES "ShopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopRedemption" ADD CONSTRAINT "ShopRedemption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

