-- AlterTable
ALTER TABLE "BetExclusion" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE INDEX "BetExclusion_groupId_expiresAt_idx" ON "BetExclusion"("groupId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BetExclusion_guildId_targetUserId_groupId_expiresAt_key"
ON "BetExclusion"("guildId", "targetUserId", "groupId", "expiresAt");

-- AddForeignKey
ALTER TABLE "BetExclusion"
ADD CONSTRAINT "BetExclusion_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
