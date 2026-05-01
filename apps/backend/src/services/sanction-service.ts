import { type ParticipantSanctionFlag, type Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";

import type { AuditService } from "./audit-service.js";

type Executor = PrismaClient | Prisma.TransactionClient;

export type SanctionActor = {
  userId: string;
  username: string;
};

export type SanctionRecord = {
  id: string;
  participantId: string;
  flag: ParticipantSanctionFlag;
  reason: string | null;
  expiresAt: Date | null;
  createdByUserId: string | null;
  createdByUsername: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revokedByUsername: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class SanctionService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  public async apply(params: {
    guildId: string;
    participantId: string;
    flag: ParticipantSanctionFlag;
    reason?: string | null;
    expiresAt?: Date | null;
    actor: SanctionActor;
  }): Promise<SanctionRecord> {
    const participant = await this.prisma.participant.findFirst({
      where: { id: params.participantId, guildId: params.guildId },
      select: { id: true },
    });
    if (!participant) {
      throw new AppError("Participant not found.", 404);
    }
    if (params.expiresAt && params.expiresAt.getTime() <= Date.now()) {
      throw new AppError("`expiresAt` must be in the future.", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.participantSanction.create({
        data: {
          guildId: params.guildId,
          participantId: params.participantId,
          flag: params.flag,
          reason: params.reason ?? null,
          expiresAt: params.expiresAt ?? null,
          createdByUserId: params.actor.userId,
          createdByUsername: params.actor.username,
        },
      });
      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.actor.userId,
        actorUsername: params.actor.username,
        action: "sanction.applied",
        entityType: "ParticipantSanction",
        entityId: record.id,
        payload: {
          participantId: params.participantId,
          flag: params.flag,
          reason: params.reason ?? null,
          expiresAt: params.expiresAt?.toISOString() ?? null,
        },
        executor: tx,
      });
      return record;
    });
  }

  public async revoke(params: {
    guildId: string;
    sanctionId: string;
    actor: SanctionActor;
  }): Promise<SanctionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.participantSanction.findFirst({
        where: { id: params.sanctionId, guildId: params.guildId },
      });
      if (!existing) {
        throw new AppError("Sanction not found.", 404);
      }
      if (existing.revokedAt) {
        throw new AppError("Sanction is already revoked.", 409);
      }
      const record = await tx.participantSanction.update({
        where: { id: params.sanctionId },
        data: {
          revokedAt: new Date(),
          revokedByUserId: params.actor.userId,
          revokedByUsername: params.actor.username,
        },
      });
      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.actor.userId,
        actorUsername: params.actor.username,
        action: "sanction.revoked",
        entityType: "ParticipantSanction",
        entityId: record.id,
        payload: { participantId: existing.participantId, flag: existing.flag },
        executor: tx,
      });
      return record;
    });
  }

  public async listForGuild(guildId: string): Promise<SanctionRecord[]> {
    return this.prisma.participantSanction.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
    });
  }

  public async listForParticipant(guildId: string, participantId: string): Promise<SanctionRecord[]> {
    return this.prisma.participantSanction.findMany({
      where: { guildId, participantId },
      orderBy: { createdAt: "desc" },
    });
  }

  public async getActiveFlags(
    participantId: string,
    options: { executor?: Executor; now?: Date } = {},
  ): Promise<Set<ParticipantSanctionFlag>> {
    const executor = options.executor ?? this.prisma;
    const now = options.now ?? new Date();
    const rows = await executor.participantSanction.findMany({
      where: {
        participantId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { flag: true },
    });
    return new Set(rows.map((row) => row.flag));
  }

  public async getActiveFlagsByDiscordUserId(
    guildId: string,
    discordUserId: string,
    options: { executor?: Executor; now?: Date } = {},
  ): Promise<Set<ParticipantSanctionFlag>> {
    const executor = options.executor ?? this.prisma;
    const participant = await executor.participant.findFirst({
      where: { guildId, discordUserId },
      select: { id: true },
    });
    if (!participant) return new Set();
    return this.getActiveFlags(participant.id, options);
  }

  public async assertNotSanctioned(
    participantId: string,
    flag: ParticipantSanctionFlag,
    options: { executor?: Executor; now?: Date; message?: string } = {},
  ): Promise<void> {
    const flags = await this.getActiveFlags(participantId, options);
    if (flags.has(flag)) {
      throw new AppError(options.message ?? `You are sanctioned (${flag}).`, 403);
    }
  }
}
