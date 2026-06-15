-- Back the per-message passive-reward dedupe with a real uniqueness guarantee so
-- a concurrent duplicate delivery of the same message cannot double-pay. Scoped
-- to MESSAGE_REWARD only, because other entry types intentionally reuse
-- externalRef (e.g. a shop redemption id appears on its purchase and refund
-- entries). MESSAGE_REWARD entries are produced solely by rewardPassiveMessage,
-- one per (guildId, externalRef=messageId).
CREATE UNIQUE INDEX "LedgerEntry_message_reward_dedupe_key"
  ON "LedgerEntry" ("guildId", "externalRef")
  WHERE "type" = 'MESSAGE_REWARD'::"LedgerEntryType" AND "externalRef" IS NOT NULL;

CREATE UNIQUE INDEX "ParticipantCurrencyEntry_message_reward_dedupe_key"
  ON "ParticipantCurrencyEntry" ("guildId", "externalRef")
  WHERE "type" = 'MESSAGE_REWARD'::"ParticipantCurrencyEntryType" AND "externalRef" IS NOT NULL;
