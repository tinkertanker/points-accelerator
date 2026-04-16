ALTER TABLE "Submission"
ADD COLUMN "groupId" TEXT;

UPDATE "Submission" AS submission
SET "groupId" = participant."groupId"
FROM "Participant" AS participant
WHERE participant."id" = submission."participantId";

ALTER TABLE "Submission"
ALTER COLUMN "groupId" SET NOT NULL;

ALTER TABLE "Submission"
ADD CONSTRAINT "Submission_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Submission_guildId_groupId_createdAt_idx"
ON "Submission"("guildId", "groupId", "createdAt" DESC);
