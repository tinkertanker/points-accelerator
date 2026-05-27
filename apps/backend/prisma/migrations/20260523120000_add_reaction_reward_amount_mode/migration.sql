-- CreateEnum
CREATE TYPE "ReactionRewardAmountMode" AS ENUM ('FIXED', 'COUNT_MULTIPLIER');

-- AlterTable
ALTER TABLE "ReactionRewardRule"
ADD COLUMN "amountMode" "ReactionRewardAmountMode" NOT NULL DEFAULT 'FIXED',
ADD COLUMN "maxCurrencyDelta" DECIMAL(18,6);
