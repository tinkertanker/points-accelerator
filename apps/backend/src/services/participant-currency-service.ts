import { Prisma, type PrismaClient } from "@prisma/client";

import { assertCanAward, resolveCapabilities } from "../domain/permissions.js";
import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber, maxDecimalMagnitude } from "../utils/decimal.js";
import type { AuditService } from "./audit-service.js";
import type { RoleCapabilityService } from "./role-capability-service.js";

type Actor = {
  userId?: string;
  username?: string;
  roleIds: string[];
};

type EntryKind =
  | "MESSAGE_REWARD"
  | "MANUAL_AWARD"
  | "MANUAL_DEDUCT"
  | "CORRECTION"
  | "TRANSFER"
  | "DONATION"
  | "SHOP_REDEMPTION"
  | "SUBMISSION_REWARD"
  | "BET_WIN"
  | "BET_LOSS"
  | "LUCKYDRAW_WIN";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

type SplitInput = {
  participantId: string;
  currencyDelta: number;
};

export class ParticipantCurrencyService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly roleCapabilityService: RoleCapabilityService,
    private readonly auditService: AuditService,
  ) {}

  public async awardParticipants(params: {
    guildId: string;
    actor: Actor;
    targetParticipantIds: string[];
    currencyDelta: number;
    description: string;
    type?: EntryKind;
    systemAction?: boolean;
    executor?: Prisma.TransactionClient;
    externalRef?: string;
  }) {
    if (params.targetParticipantIds.length === 0) {
      throw new AppError("Select at least one participant.");
    }

    return this.recordEntry({
      guildId: params.guildId,
      actor: params.actor,
      type:
        params.type ??
        (params.currencyDelta < 0 ? "MANUAL_DEDUCT" : "MANUAL_AWARD"),
      description: params.description,
      splits: params.targetParticipantIds.map((participantId) => ({
        participantId,
        currencyDelta: params.currencyDelta,
      })),
      systemAction: params.systemAction,
      executor: params.executor,
      externalRef: params.externalRef,
      auditAction:
        params.currencyDelta < 0 ? "participant_currency.deducted" : "participant_currency.awarded",
    });
  }

  public async transferCurrency(params: {
    guildId: string;
    actor: Actor;
    sourceParticipantId: string;
    targetParticipantId: string;
    amount: number;
    description?: string;
  }) {
    if (params.amount <= 0) {
      throw new AppError("Transfer amount must be greater than zero.");
    }

    if (params.sourceParticipantId === params.targetParticipantId) {
      throw new AppError("Source and destination participants must be different.");
    }

    return this.recordEntry({
      guildId: params.guildId,
      actor: params.actor,
      type: "TRANSFER",
      description: params.description ?? "Participant-to-participant transfer",
      splits: [
        { participantId: params.sourceParticipantId, currencyDelta: -params.amount },
        { participantId: params.targetParticipantId, currencyDelta: params.amount },
      ],
      systemAction: true,
      auditAction: "participant_currency.transferred",
      auditPayload: {
        sourceParticipantId: params.sourceParticipantId,
        targetParticipantId: params.targetParticipantId,
        amount: params.amount,
      },
    });
  }

  public async donateCurrency(params: {
    guildId: string;
    actor: Actor;
    sourceParticipantId: string;
    amount: number;
    description?: string;
  }) {
    if (params.amount <= 0) {
      throw new AppError("Donation amount must be greater than zero.");
    }

    return this.recordEntry({
      guildId: params.guildId,
      actor: params.actor,
      type: "DONATION",
      description: params.description ?? "Participant donation",
      splits: [{ participantId: params.sourceParticipantId, currencyDelta: -params.amount }],
      systemAction: true,
      auditAction: "participant_currency.donated",
      auditPayload: {
        sourceParticipantId: params.sourceParticipantId,
        amount: params.amount,
      },
    });
  }

  public async getParticipantBalance(participantId: string) {
    const balances = await this.getBalanceMap([participantId]);
    return balances[participantId] ?? 0;
  }

  public async getBalanceMap(participantIds: string[]) {
    return this.getBalanceMapWithExecutor(this.prisma, participantIds);
  }

  public async listLedgerForParticipant(participantId: string, limit = 10) {
    const entries = await this.prisma.participantCurrencyEntry.findMany({
      where: {
        splits: {
          some: {
            participantId,
          },
        },
      },
      include: {
        splits: {
          include: {
            participant: {
              select: {
                id: true,
                discordUserId: true,
                discordUsername: true,
                indexId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return entries.map((entry) => ({
      ...entry,
      splits: entry.splits.map((split) => ({
        ...split,
        currencyDelta: decimalToNumber(split.currencyDelta),
      })),
    }));
  }

  public async assertParticipantHasCurrency(participantId: string, amount: number) {
    const balance = await this.getParticipantBalance(participantId);
    if (balance < amount) {
      throw new AppError("Participant does not have enough currency.", 409);
    }
  }

  public async recordEntry(params: {
    guildId: string;
    actor: Actor;
    type: EntryKind;
    description: string;
    splits: SplitInput[];
    systemAction?: boolean;
    executor?: Prisma.TransactionClient;
    externalRef?: string;
    auditAction: string;
    auditPayload?: Record<string, unknown>;
  }) {
    const splits = params.splits.filter((split) => split.currencyDelta !== 0);
    if (splits.length === 0) {
      throw new AppError("At least one non-zero currency split is required.");
    }

    if (!params.systemAction) {
      const actorCapabilities = await this.roleCapabilityService.listForRoleIds(params.guildId, params.actor.roleIds);
      const resolved = resolveCapabilities(actorCapabilities);
      const magnitude = maxDecimalMagnitude(...splits.map((split) => split.currencyDelta));
      const isDeduction = splits.some((split) => split.currencyDelta < 0);
      assertCanAward({
        capabilities: resolved,
        magnitude,
        targetCount: splits.length,
        isDeduction,
      });
    }

    const run = async (tx: Prisma.TransactionClient) => {
      const participantIds = Array.from(new Set(splits.map((split) => split.participantId)));
      await this.lockParticipants(tx, params.guildId, participantIds);

      const participants = await tx.participant.findMany({
        where: {
          guildId: params.guildId,
          id: {
            in: participantIds,
          },
        },
      });

      if (participants.length !== participantIds.length) {
        throw new AppError("One or more participants do not exist.", 404);
      }

      const negativeParticipantIds = splits
        .filter((split) => split.currencyDelta < 0)
        .map((split) => split.participantId);

      if (negativeParticipantIds.length > 0) {
        const balances = await this.getBalanceMapWithExecutor(tx, negativeParticipantIds);
        for (const split of splits) {
          if (split.currencyDelta >= 0) {
            continue;
          }

          const balance = balances[split.participantId] ?? 0;
          if (balance < Math.abs(split.currencyDelta)) {
            throw new AppError("Participant does not have enough currency.", 409);
          }
        }
      }

      const entry = await tx.participantCurrencyEntry.create({
        data: {
          guildId: params.guildId,
          type: params.type,
          description: params.description,
          createdByUserId: params.actor.userId,
          createdByUsername: params.actor.username,
          externalRef: params.externalRef,
          splits: {
            create: splits.map((split) => ({
              participantId: split.participantId,
              currencyDelta: decimal(split.currencyDelta),
            })),
          },
        },
        include: {
          splits: true,
        },
      });

      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.actor.userId,
        actorUsername: params.actor.username,
        action: params.auditAction,
        entityType: "ParticipantCurrencyEntry",
        entityId: entry.id,
        payload: {
          type: params.type,
          splits,
          ...params.auditPayload,
        },
        executor: tx,
      });

      return entry;
    };

    return params.executor ? run(params.executor) : this.prisma.$transaction(run);
  }

  private async getBalanceMapWithExecutor(executor: PrismaExecutor, participantIds: string[]) {
    if (participantIds.length === 0) {
      return {};
    }

    const grouped = await executor.participantCurrencySplit.groupBy({
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

  private async lockParticipants(tx: Prisma.TransactionClient, guildId: string, participantIds: string[]) {
    const uniqueParticipantIds = Array.from(new Set(participantIds)).sort();
    if (uniqueParticipantIds.length === 0) {
      return;
    }

    const lockedParticipants = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM "Participant"
      WHERE "guildId" = ${guildId}
        AND id IN (${Prisma.join(uniqueParticipantIds)})
      FOR UPDATE
    `);

    if (lockedParticipants.length !== uniqueParticipantIds.length) {
      throw new AppError("One or more participants do not exist.", 404);
    }
  }
}
