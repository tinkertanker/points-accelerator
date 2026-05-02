-- AlterTable
ALTER TABLE "GuildConfig"
    ADD COLUMN "submissionFeedChannelId" TEXT;

-- AlterTable
ALTER TABLE "Submission"
    ADD COLUMN "feedChannelId" TEXT,
    ADD COLUMN "feedMessageId" TEXT;
