-- CreateEnum
CREATE TYPE "ParticipantSanctionFlag" AS ENUM ('CANNOT_BET', 'CANNOT_EARN_PASSIVE', 'CANNOT_BUY', 'CANNOT_TRANSFER', 'CANNOT_RECEIVE_REWARDS');

-- CreateTable
CREATE TABLE "ParticipantSanction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "flag" "ParticipantSanctionFlag" NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdByUsername" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParticipantSanction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParticipantSanction_guildId_participantId_flag_idx" ON "ParticipantSanction"("guildId", "participantId", "flag");

-- CreateIndex
CREATE INDEX "ParticipantSanction_guildId_revokedAt_expiresAt_idx" ON "ParticipantSanction"("guildId", "revokedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "ParticipantSanction" ADD CONSTRAINT "ParticipantSanction_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantSanction" ADD CONSTRAINT "ParticipantSanction_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
