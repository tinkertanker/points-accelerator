-- GoFundMe donations are personal wallet donations. Preserve the original
-- group-ledger donation link for audit history, add a personal currency link
-- for the corrected source of funds, and migrate existing rows 1:1.

-- AlterTable
ALTER TABLE "GoFundMeDonation" ADD COLUMN "currencyEntryId" TEXT;

-- DropForeignKey
ALTER TABLE "GoFundMeDonation" DROP CONSTRAINT "GoFundMeDonation_ledgerEntryId_fkey";

-- AlterTable
ALTER TABLE "GoFundMeDonation" ALTER COLUMN "ledgerEntryId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "GoFundMeDonation_currencyEntryId_key" ON "GoFundMeDonation"("currencyEntryId");

-- AddForeignKey
ALTER TABLE "GoFundMeDonation" ADD CONSTRAINT "GoFundMeDonation_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoFundMeDonation" ADD CONSTRAINT "GoFundMeDonation_currencyEntryId_fkey" FOREIGN KEY ("currencyEntryId") REFERENCES "ParticipantCurrencyEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Refund any group points that were incorrectly used for GoFundMe donations.
INSERT INTO "LedgerEntry" (
  "id",
  "guildId",
  "type",
  "description",
  "createdByUserId",
  "createdByUsername",
  "externalRef",
  "createdAt"
)
SELECT
  'gfm_refund_' || md5(d."id") AS "id",
  d."guildId",
  'CORRECTION'::"LedgerEntryType",
  'Migrated GoFundMe donation from group points to personal points',
  d."createdByUserId",
  d."createdByUsername",
  'gofundme-migrate-refund:' || d."id",
  NOW()
FROM "GoFundMeDonation" d
WHERE d."ledgerEntryId" IS NOT NULL
  AND d."currencyEntryId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "LedgerEntry" existing
    WHERE existing."externalRef" = 'gofundme-migrate-refund:' || d."id"
  );

INSERT INTO "LedgerSplit" (
  "id",
  "entryId",
  "groupId",
  "pointsDelta",
  "currencyDelta",
  "createdAt"
)
SELECT
  'gfm_refund_split_' || md5(d."id") AS "id",
  'gfm_refund_' || md5(d."id") AS "entryId",
  d."groupId",
  d."amount",
  0,
  NOW()
FROM "GoFundMeDonation" d
WHERE d."ledgerEntryId" IS NOT NULL
  AND d."currencyEntryId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "LedgerEntry" refund
    WHERE refund."id" = 'gfm_refund_' || md5(d."id")
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "LedgerSplit" existing
    WHERE existing."id" = 'gfm_refund_split_' || md5(d."id")
  );

-- Charge the participant wallet by the same amount. This intentionally writes
-- the historical correction even if the participant no longer has enough
-- wallet currency; the migration must preserve the donation source of truth.
INSERT INTO "ParticipantCurrencyEntry" (
  "id",
  "guildId",
  "type",
  "description",
  "createdByUserId",
  "createdByUsername",
  "externalRef",
  "createdAt"
)
SELECT
  'gfm_personal_' || md5(d."id") AS "id",
  d."guildId",
  'DONATION'::"ParticipantCurrencyEntryType",
  'Migrated GoFundMe donation to personal points',
  d."createdByUserId",
  d."createdByUsername",
  'gofundme-migrate-personal:' || d."id",
  NOW()
FROM "GoFundMeDonation" d
WHERE d."ledgerEntryId" IS NOT NULL
  AND d."currencyEntryId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ParticipantCurrencyEntry" existing
    WHERE existing."externalRef" = 'gofundme-migrate-personal:' || d."id"
  );

INSERT INTO "ParticipantCurrencySplit" (
  "id",
  "entryId",
  "participantId",
  "currencyDelta",
  "createdAt"
)
SELECT
  'gfm_personal_split_' || md5(d."id") AS "id",
  'gfm_personal_' || md5(d."id") AS "entryId",
  d."participantId",
  -d."amount",
  NOW()
FROM "GoFundMeDonation" d
WHERE d."ledgerEntryId" IS NOT NULL
  AND d."currencyEntryId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "ParticipantCurrencyEntry" entry
    WHERE entry."id" = 'gfm_personal_' || md5(d."id")
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "ParticipantCurrencySplit" existing
    WHERE existing."id" = 'gfm_personal_split_' || md5(d."id")
  );

UPDATE "GoFundMeDonation" d
SET "currencyEntryId" = 'gfm_personal_' || md5(d."id")
WHERE d."ledgerEntryId" IS NOT NULL
  AND d."currencyEntryId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "ParticipantCurrencyEntry" entry
    WHERE entry."id" = 'gfm_personal_' || md5(d."id")
  );
