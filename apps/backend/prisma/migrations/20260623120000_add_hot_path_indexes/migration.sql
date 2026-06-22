-- Hot-path indexes identified by a database-access review. These back queries
-- that fire on every passive message / reaction / group resolution.
--
-- 1. DiscordRoleCapability: `syncAwardableRoleGroups` and `hasGroupRole` filter
--    by `guildId` + `isGroupRole` + `canReceiveAwards`. The existing unique
--    constraint `guildId_roleId` only helps lookups keyed on `roleId`; the
--    boolean-filtered scan (which runs once per passive message, and N times
--    inside getEligibleGroupMembers) had no dedicated index. A partial index
--    covers the most common filter cheaply.
CREATE INDEX IF NOT EXISTS "DiscordRoleCapability_group_receive_index"
  ON "DiscordRoleCapability" ("guildId")
  WHERE "isGroupRole" = true AND "canReceiveAwards" = true;

-- 2. ParticipantSanction: `getActiveFlags` is called on every passive message
--    and every reaction (runtime.ts handlePassiveMessage/handleBotReaction) with
--    `WHERE participantId = ? AND revokedAt IS NULL AND (expiresAt IS NULL OR
--    expiresAt > now())`. The existing indexes lead with `guildId`, which is not
--    in this query, so every check was an unindexed scan. Lead with
--    participantId and filter on the revoked/expiry columns.
CREATE INDEX IF NOT EXISTS "ParticipantSanction_participant_active_index"
  ON "ParticipantSanction" ("participantId", "expiresAt")
  WHERE "revokedAt" IS NULL;
