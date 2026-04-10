import type { PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";

function normaliseIndexId(indexId: string): string {
  const normalised = indexId.trim().toUpperCase();

  if (!/^[A-Z0-9]+$/.test(normalised)) {
    throw new AppError("Index ID must be alphanumeric.", 400);
  }

  return normalised;
}

export class ParticipantService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async list(guildId: string) {
    return this.prisma.participant.findMany({
      where: { guildId },
      include: { group: { select: { id: true, displayName: true, slug: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  public async register(params: {
    guildId: string;
    discordUserId: string;
    discordUsername?: string;
    indexId: string;
    groupId: string;
  }) {
    const group = await this.prisma.group.findFirst({
      where: { id: params.groupId, guildId: params.guildId, active: true },
    });

    if (!group) {
      throw new AppError("The specified group does not exist or is inactive.", 404);
    }

    const indexId = normaliseIndexId(params.indexId);

    const existingByUser = await this.prisma.participant.findUnique({
      where: { guildId_discordUserId: { guildId: params.guildId, discordUserId: params.discordUserId } },
    });

    if (existingByUser) {
      throw new AppError("You are already registered. Use your existing registration or contact an admin.", 409);
    }

    const existingByIndex = await this.prisma.participant.findUnique({
      where: { guildId_indexId: { guildId: params.guildId, indexId } },
    });

    if (existingByIndex) {
      throw new AppError("That index ID is already taken. Check your ID or contact an admin.", 409);
    }

    return this.prisma.participant.create({
      data: {
        guildId: params.guildId,
        discordUserId: params.discordUserId,
        discordUsername: params.discordUsername,
        indexId,
        groupId: params.groupId,
      },
      include: { group: { select: { id: true, displayName: true, slug: true } } },
    });
  }

  public async findByDiscordUser(guildId: string, discordUserId: string) {
    return this.prisma.participant.findUnique({
      where: { guildId_discordUserId: { guildId, discordUserId } },
      include: { group: { select: { id: true, displayName: true, slug: true } } },
    });
  }

  public async delete(guildId: string, participantId: string) {
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, guildId },
    });

    if (!participant) {
      throw new AppError("Participant not found.", 404);
    }

    await this.prisma.participant.delete({ where: { id: participantId } });
    return participant;
  }
}
