-- Back the per-message passive-reward dedupe with a real uniqueness guarantee so
-- a concurrent duplicate delivery of the same message cannot double-pay. Scoped
-- to MESSAGE_REWARD only, because other entry types intentionally reuse
-- externalRef (e.g. a shop redemption id appears on its purchase and refund
-- entries). MESSAGE_REWARD entries are produced solely by rewardPassiveMessage,
-- one per (guildId, externalRef=messageId).

-- First, clean up any duplicate MESSAGE_REWARD rows already left by the previous
-- advisory-only dedupe (a pre-insert findFirst with no DB guarantee). Without
-- this, CREATE UNIQUE INDEX would abort on dirty production data and block the
-- deploy. We keep the lowest id per (guildId, externalRef); deleting the extra
-- entries cascades to their splits, which also rolls back the double-counted
-- points/currency from the original race.
DELETE FROM "LedgerEntry" a
USING "LedgerEntry" b
WHERE a."type" = 'MESSAGE_REWARD'::"LedgerEntryType"
  AND b."type" = 'MESSAGE_REWARD'::"LedgerEntryType"
  AND a."externalRef" IS NOT NULL
  AND a."guildId" = b."guildId"
  AND a."externalRef" = b."externalRef"
  AND a."id" > b."id";

DELETE FROM "ParticipantCurrencyEntry" a
USING "ParticipantCurrencyEntry" b
WHERE a."type" = 'MESSAGE_REWARD'::"ParticipantCurrencyEntryType"
  AND b."type" = 'MESSAGE_REWARD'::"ParticipantCurrencyEntryType"
  AND a."externalRef" IS NOT NULL
  AND a."guildId" = b."guildId"
  AND a."externalRef" = b."externalRef"
  AND a."id" > b."id";

CREATE UNIQUE INDEX "LedgerEntry_message_reward_dedupe_key"
  ON "LedgerEntry" ("guildId", "externalRef")
  WHERE "type" = 'MESSAGE_REWARD'::"LedgerEntryType" AND "externalRef" IS NOT NULL;

CREATE UNIQUE INDEX "ParticipantCurrencyEntry_message_reward_dedupe_key"
  ON "ParticipantCurrencyEntry" ("guildId", "externalRef")
  WHERE "type" = 'MESSAGE_REWARD'::"ParticipantCurrencyEntryType" AND "externalRef" IS NOT NULL;

