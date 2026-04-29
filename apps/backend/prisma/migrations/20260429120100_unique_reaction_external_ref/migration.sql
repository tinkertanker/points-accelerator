-- Enforce exactly-once reaction rewards: a single (guildId, externalRef) per REACTION_REWARD entry.
-- Split from the previous migration because PostgreSQL forbids referencing a newly-added enum value
-- inside the same transaction in which it was created.
CREATE UNIQUE INDEX "ParticipantCurrencyEntry_reaction_externalRef_unique"
  ON "ParticipantCurrencyEntry"("guildId", "externalRef")
  WHERE "type" = 'REACTION_REWARD' AND "externalRef" IS NOT NULL;
