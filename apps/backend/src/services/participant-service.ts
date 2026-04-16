import type { PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimalToNumber } from "../utils/decimal.js";

function normaliseIndexId(indexId: string): string {
  const normalised = indexId.trim().toUpperCase();

  if (!/^[A-Z0-9]+$/.test(normalised)) {
    throw new AppError("Index ID must be alphanumeric.", 400);
  }

  return normalised;
}

function buildAutomaticIndexId(discordUserId: string): string {
  return `AUTO${discordUserId}`.toUpperCase();
}

export class ParticipantService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async list(guildId: string) {
    const participants = await this.prisma.participant.findMany({
      where: { guildId },
      include: { group: { select: { id: true, displayName: true, slug: true } } },
      orderBy: { createdAt: "desc" },
    });

    const balances = await this.getCurrencyBalanceMap(participants.map((participant) => participant.id));

    return participants.map((participant) => ({
      ...participant,
      currencyBalance: balances[participant.id] ?? 0,
    }));
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

  public async findById(guildId: string, participantId: string) {
    return this.prisma.participant.findFirst({
      where: { id: participantId, guildId },
      include: { group: { select: { id: true, displayName: true, slug: true } } },
    });
  }

  public async ensureForGroup(params: {
    guildId: string;
    discordUserId: string;
    discordUsername?: string;
    groupId: string;
  }) {
    const group = await this.prisma.group.findFirst({
      where: { id: params.groupId, guildId: params.guildId, active: true },
    });

    if (!group) {
      throw new AppError("The specified group does not exist or is inactive.", 404);
    }

    const existing = await this.prisma.participant.findUnique({
      where: {
        guildId_discordUserId: {
          guildId: params.guildId,
          discordUserId: params.discordUserId,
        },
      },
      include: { group: { select: { id: true, displayName: true, slug: true } } },
    });

    if (existing) {
      if (existing.groupId === params.groupId && existing.discordUsername === params.discordUsername) {
        return existing;
      }

      return this.prisma.participant.update({
        where: { id: existing.id },
        data: {
          groupId: params.groupId,
          discordUsername: params.discordUsername,
        },
        include: { group: { select: { id: true, displayName: true, slug: true } } },
      });
    }

    return this.prisma.participant.create({
      data: {
        guildId: params.guildId,
        discordUserId: params.discordUserId,
        discordUsername: params.discordUsername,
        groupId: params.groupId,
        indexId: buildAutomaticIndexId(params.discordUserId),
      },
      include: { group: { select: { id: true, displayName: true, slug: true } } },
    });
  }

  public async findRequiredByDiscordUser(guildId: string, discordUserId: string) {
    const participant = await this.findByDiscordUser(guildId, discordUserId);
    if (!participant) {
      throw new AppError("You are not mapped to an active group yet. Ask an admin to check your Discord roles.", 409);
    }

    return participant;
  }

  public async listByGroup(guildId: string, groupId: string) {
    return this.prisma.participant.findMany({
      where: { guildId, groupId },
      include: { group: { select: { id: true, displayName: true, slug: true } } },
      orderBy: { createdAt: "asc" },
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

  private async getCurrencyBalanceMap(participantIds: string[]) {
    if (participantIds.length === 0) {
      return {};
    }

    const grouped = await this.prisma.participantCurrencySplit.groupBy({
      by: ["participantId"],
      where: {
        participantId: {
          in: participantIds,
        },
      },
      _sum: {
        currencyDelta: true,
      },
    });

    return Object.fromEntries(
      grouped.map((row) => [row.participantId, decimalToNumber(row._sum.currencyDelta)]),
    );
  }
}
