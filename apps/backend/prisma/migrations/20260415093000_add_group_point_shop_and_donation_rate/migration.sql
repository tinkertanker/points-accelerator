CREATE TYPE "ShopItemAudience" AS ENUM ('INDIVIDUAL', 'GROUP');

ALTER TABLE "GuildConfig"
ADD COLUMN "groupPointsPerCurrencyDonation" DECIMAL(18,6) NOT NULL DEFAULT 10;

ALTER TABLE "ShopItem"
ADD COLUMN "audience" "ShopItemAudience" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN "cost" DECIMAL(18,6);

UPDATE "ShopItem"
SET "cost" = "currencyCost";

ALTER TABLE "ShopItem"
ALTER COLUMN "cost" SET NOT NULL,
DROP COLUMN "currencyCost";

ALTER TABLE "ShopRedemption"
ADD COLUMN "ledgerEntryId" TEXT,
ADD COLUMN "totalCost" DECIMAL(18,6);

UPDATE "ShopRedemption"
SET "totalCost" = "totalCurrencyCost";

ALTER TABLE "ShopRedemption"
ALTER COLUMN "totalCost" SET NOT NULL,
DROP COLUMN "totalCurrencyCost";

CREATE UNIQUE INDEX "ShopRedemption_ledgerEntryId_key" ON "ShopRedemption"("ledgerEntryId");

ALTER TABLE "ShopRedemption"
ADD CONSTRAINT "ShopRedemption_ledgerEntryId_fkey"
FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
