-- Add group-points payouts to reaction reward rules while preserving existing
-- participant-currency rules as the default.
CREATE TYPE "ReactionRewardPayoutTarget" AS ENUM ('PARTICIPANT_CURRENCY', 'GROUP_POINTS');

ALTER TABLE "ReactionRewardRule"
  ADD COLUMN "payoutTarget" "ReactionRewardPayoutTarget" NOT NULL DEFAULT 'PARTICIPANT_CURRENCY',
  ADD COLUMN "pointsDelta" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  ADD COLUMN "maxPointsDelta" DECIMAL(18, 6);

ALTER TYPE "LedgerEntryType" ADD VALUE 'REACTION_REWARD';
