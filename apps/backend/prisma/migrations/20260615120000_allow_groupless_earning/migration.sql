-- Allow participants to exist without a group so members can start earning
-- personal currency before they are mapped to a group.
ALTER TABLE "Participant" ALTER COLUMN "groupId" DROP NOT NULL;

-- Deleting a group now orphans its members to group-less instead of deleting
-- them, preserving their personal wallet history.
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_groupId_fkey";
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Admin toggle (default on) for letting group-less members earn personal currency.
ALTER TABLE "GuildConfig" ADD COLUMN "allowGrouplessEarning" BOOLEAN NOT NULL DEFAULT true;
