-- Allow participants to exist without a group so members can start earning
-- personal currency before they are mapped to a group. The Group -> Participant
-- foreign key keeps its existing ON DELETE CASCADE behaviour.
ALTER TABLE "Participant" ALTER COLUMN "groupId" DROP NOT NULL;

-- Admin toggle (default on) for letting group-less members earn personal currency.
ALTER TABLE "GuildConfig" ADD COLUMN "allowGrouplessEarning" BOOLEAN NOT NULL DEFAULT true;
