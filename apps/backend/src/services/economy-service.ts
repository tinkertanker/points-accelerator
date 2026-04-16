import { Prisma, type PrismaClient } from "@prisma/client";

import { assertCanAward, resolveCapabilities } from "../domain/permissions.js";
import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber, maxDecimalMagnitude } from "../utils/decimal.js";
import type { ConfigService } from "./config-service.js";
import type { GroupService } from "./group-service.js";
import type { RoleCapabilityService } from "./role-capability-service.js";
import type { AuditService } from "./audit-service.js";
import type { ParticipantCurrencyService } from "./participant-currency-service.js";

type Actor = {
  userId?: string;
  username?: string;
  roleIds: string[];
};

type LedgerEntryKind =
  | "MESSAGE_REWARD"
  | "MANUAL_AWARD"
  | "MANUAL_DEDUCT"
  | "CORRECTION"
  | "TRANSFER"
  | "DONATION"
  | "SHOP_REDEMPTION"
  | "ADJUSTMENT"
  | "SUBMISSION_REWARD";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export class EconomyService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly groupService: GroupService,
    private readonly roleCapabilityService: RoleCapabilityService,
    private readonly auditService: AuditService,
    private readonly participantCurrencyService: ParticipantCurrencyService,
  ) {}

  public async awardGroups(params: {
    guildId: string;
    actor: Actor;
    targetGroupIds: string[];
    pointsDelta: number;
    currencyDelta: number;
    description: string;
    type?: LedgerEntryKind;
    /** Skip actor permission checks for system-initiated awards (e.g. submission rewards). */
    systemAction?: boolean;
    executor?: PrismaExecutor;
    externalRef?: string;
  }) {
    if (params.targetGroupIds.length === 0) {
      throw new AppError("Select at least one group.");
    }

    const executor = params.executor ?? this.prisma;
    const isDeduction = params.pointsDelta < 0 || params.currencyDelta < 0;

    if (!params.systemAction) {
      const actorCapabilities = await this.roleCapabilityService.listForRoleIds(params.guildId, params.actor.roleIds);
      const resolved = resolveCapabilities(actorCapabilities);
      const magnitude = maxDecimalMagnitude(params.pointsDelta, params.currencyDelta);
      assertCanAward({
        capabilities: resolved,
        magnitude,
        targetCount: params.targetGroupIds.length,
        isDeduction,
      });
    }

    const groups = await executor.group.findMany({
      where: {
        guildId: params.guildId,
        id: {
          in: params.targetGroupIds,
        },
      },
    });

    if (groups.length !== params.targetGroupIds.length) {
      throw new AppError("One or more target groups do not exist.", 404);
    }

    const targetCapabilities = await executor.discordRoleCapability.findMany({
      where: {
        guildId: params.guildId,
        roleId: {
          in: groups.map((group) => group.roleId),
        },
      },
    });

    const blockedGroup = groups.find((group) => {
      const capability = targetCapabilities.find((candidate) => candidate.roleId === group.roleId);
      return capability ? !capability.canReceiveAwards : false;
    });

    if (blockedGroup) {
      throw new AppError(`${blockedGroup.displayName} is not configured to receive awards.`, 409);
    }

    const entry = await executor.ledgerEntry.create({
      data: {
        guildId: params.guildId,
        type:
          params.type ??
          (isDeduction ? "MANUAL_DEDUCT" : "MANUAL_AWARD"),
        description: params.description,
        createdByUserId: params.actor.userId,
        createdByUsername: params.actor.username,
        externalRef: params.externalRef,
        splits: {
          create: params.targetGroupIds.map((groupId) => ({
            groupId,
            pointsDelta: decimal(params.pointsDelta),
            currencyDelta: decimal(params.currencyDelta),
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
      action: "ledger.entry.created",
      entityType: "LedgerEntry",
      entityId: entry.id,
      payload: {
        type: entry.type,
        targetGroupIds: params.targetGroupIds,
        pointsDelta: params.pointsDelta,
        currencyDelta: params.currencyDelta,
        externalRef: params.externalRef,
      },
      executor,
    });

    return entry;
  }

  public async rewardPassiveMessage(params: {
    guildId: string;
    groupId: string;
    participantId?: string;
    userId: string;
    username?: string;
    messageId: string;
    content: string;
    channelId: string;
    config?: Awaited<ReturnType<ConfigService["getOrCreate"]>>;
  }) {
    const config = params.config ?? (await this.configService.getOrCreate(params.guildId));

    if (params.content.trim().length < config.passiveMinimumCharacters) {
      return null;
    }

    if (
      config.passiveAllowedChannelIds.length > 0 &&
      !config.passiveAllowedChannelIds.includes(params.channelId)
    ) {
      return null;
    }

    if (config.passiveDeniedChannelIds.includes(params.channelId)) {
      return null;
    }

    const previous = await this.prisma.ledgerEntry.findFirst({
      where: {
        guildId: params.guildId,
        externalRef: params.messageId,
      },
    });

    if (previous) {
      return null;
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.ledgerEntry.create({
        data: {
          guildId: params.guildId,
          type: "MESSAGE_REWARD",
          description: "Passive message reward",
          createdByUserId: params.userId,
          createdByUsername: params.username,
          externalRef: params.messageId,
          splits: {
            create: {
              groupId: params.groupId,
              pointsDelta: config.passivePointsReward,
              currencyDelta: decimal(0),
            },
          },
        },
      });

      if (params.participantId && decimalToNumber(config.passiveCurrencyReward) > 0) {
        await this.participantCurrencyService.awardParticipants({
          guildId: params.guildId,
          actor: {
            userId: params.userId,
            username: params.username,
            roleIds: [],
          },
          targetParticipantIds: [params.participantId],
          currencyDelta: decimalToNumber(config.passiveCurrencyReward),
          description: "Passive message reward",
          type: "MESSAGE_REWARD",
          systemAction: true,
          executor: tx,
          externalRef: params.messageId,
        });
      }

      return entry;
    });
  }

  public async transferCurrency(params: {
    guildId: string;
    actor: Actor;
    sourceGroupId: string;
    targetGroupId: string;
    amount: number;
    description?: string;
  }) {
    if (params.amount <= 0) {
      throw new AppError("Transfer amount must be greater than zero.");
    }

    if (params.sourceGroupId === params.targetGroupId) {
      throw new AppError("Source and destination groups must be different.");
    }

    const entry = await this.prisma.$transaction(async (tx) => {
      await this.lockGroups(tx, params.guildId, [params.sourceGroupId, params.targetGroupId]);

      const balances = await this.getBalanceMapWithExecutor(tx, [params.sourceGroupId]);
      const sourceBalance = balances[params.sourceGroupId]?.currencyBalance ?? 0;
      if (sourceBalance < params.amount) {
        throw new AppError("Source group does not have enough currency.", 409);
      }

      return tx.ledgerEntry.create({
        data: {
          guildId: params.guildId,
          type: "TRANSFER",
          description: params.description ?? "Group-to-group transfer",
          createdByUserId: params.actor.userId,
          createdByUsername: params.actor.username,
          splits: {
            create: [
              {
                groupId: params.sourceGroupId,
                pointsDelta: decimal(0),
                currencyDelta: decimal(-params.amount),
              },
              {
                groupId: params.targetGroupId,
                pointsDelta: decimal(0),
                currencyDelta: decimal(params.amount),
              },
            ],
          },
        },
      });
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.actor.userId,
      actorUsername: params.actor.username,
      action: "ledger.transfer.created",
      entityType: "LedgerEntry",
      entityId: entry.id,
      payload: {
        sourceGroupId: params.sourceGroupId,
        targetGroupId: params.targetGroupId,
        amount: params.amount,
      },
    });

    return entry;
  }

  public async donateCurrency(params: {
    guildId: string;
    actor: Actor;
    sourceGroupId: string;
    amount: number;
    description?: string;
  }) {
    if (params.amount <= 0) {
      throw new AppError("Donation amount must be greater than zero.");
    }

    const entry = await this.prisma.$transaction(async (tx) => {
      await this.lockGroups(tx, params.guildId, [params.sourceGroupId]);

      const balances = await this.getBalanceMapWithExecutor(tx, [params.sourceGroupId]);
      const sourceBalance = balances[params.sourceGroupId]?.currencyBalance ?? 0;
      if (sourceBalance < params.amount) {
        throw new AppError("Source group does not have enough currency.", 409);
      }

      return tx.ledgerEntry.create({
        data: {
          guildId: params.guildId,
          type: "DONATION",
          description: params.description ?? "Group donation",
          createdByUserId: params.actor.userId,
          createdByUsername: params.actor.username,
          splits: {
            create: {
              groupId: params.sourceGroupId,
              pointsDelta: decimal(0),
              currencyDelta: decimal(-params.amount),
            },
          },
        },
      });
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.actor.userId,
      actorUsername: params.actor.username,
      action: "ledger.donation.created",
      entityType: "LedgerEntry",
      entityId: entry.id,
      payload: {
        sourceGroupId: params.sourceGroupId,
        amount: params.amount,
      },
    });

    return entry;
  }

  public async assertGroupHasCurrency(groupId: string, amount: number) {
    const balances = await this.getBalanceMapWithExecutor(this.prisma, [groupId]);
    const balance = balances[groupId]?.currencyBalance ?? 0;

    if (balance < amount) {
      throw new AppError("Group does not have enough currency.", 409);
    }
  }

  public async assertGroupHasPoints(groupId: string, amount: number, executor: PrismaExecutor = this.prisma) {
    const balances = await this.getBalanceMapWithExecutor(executor, [groupId]);
    const balance = balances[groupId]?.pointsBalance ?? 0;

    if (balance < amount) {
      throw new AppError("Group does not have enough points.", 409);
    }
  }

  public async donateParticipantCurrencyToGroupPoints(params: {
    guildId: string;
    actor: Actor;
    participantId: string;
    groupId: string;
    amount: number;
    conversionRate: number;
    description?: string;
  }) {
    if (params.amount <= 0) {
      throw new AppError("Donation amount must be greater than zero.");
    }

    if (params.conversionRate <= 0) {
      throw new AppError("Donation conversion rate must be greater than zero.", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM "Participant"
        WHERE id = ${params.participantId}
          AND "guildId" = ${params.guildId}
        FOR UPDATE
      `);
      await this.lockGroups(tx, params.guildId, [params.groupId]);

      const participant = await tx.participant.findFirst({
        where: {
          id: params.participantId,
          guildId: params.guildId,
          groupId: params.groupId,
        },
      });

      if (!participant) {
        throw new AppError("Participant not found in the target group.", 404);
      }

      const groupPointsAward = params.amount * params.conversionRate;
      const externalRef = `donation:${participant.id}:${Date.now()}`;

      const currencyEntry = await this.participantCurrencyService.recordEntry({
        guildId: params.guildId,
        actor: params.actor,
        type: "DONATION",
        description: params.description ?? "Converted personal currency into group points",
        splits: [{ participantId: params.participantId, currencyDelta: -params.amount }],
        systemAction: true,
        executor: tx,
        externalRef,
        auditAction: "participant_currency.donated_to_group",
        auditPayload: {
          participantId: params.participantId,
          groupId: params.groupId,
          amount: params.amount,
          conversionRate: params.conversionRate,
          groupPointsAward,
        },
      });

      const ledgerEntry = await this.awardGroups({
        guildId: params.guildId,
        actor: params.actor,
        targetGroupIds: [params.groupId],
        pointsDelta: groupPointsAward,
        currencyDelta: 0,
        description: params.description ?? "Converted personal currency into group points",
        type: "DONATION",
        systemAction: true,
        executor: tx,
        externalRef,
      });

      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.actor.userId,
        actorUsername: params.actor.username,
        action: "economy.group_points_donated",
        entityType: "LedgerEntry",
        entityId: ledgerEntry.id,
        payload: {
          participantId: params.participantId,
          groupId: params.groupId,
          amount: params.amount,
          conversionRate: params.conversionRate,
          groupPointsAward,
          currencyEntryId: currencyEntry.id,
        },
        executor: tx,
      });

      return {
        currencyEntry,
        ledgerEntry,
        groupPointsAward,
      };
    });
  }

  public async getGroupBalance(groupId: string) {
    const balances = await this.groupService.getBalanceMap([groupId]);
    return balances[groupId] ?? { pointsBalance: 0, currencyBalance: 0 };
  }

  public async getLeaderboard(guildId: string) {
    const groups = await this.groupService.list(guildId);
    return groups.sort((left, right) => right.pointsBalance - left.pointsBalance);
  }

  public async getLedger(
    guildId: string,
    limitOrOptions: number | { limit?: number; offset?: number } = 50,
  ) {
    const options =
      typeof limitOrOptions === "number"
        ? {
            limit: limitOrOptions,
            offset: 0,
          }
        : {
            limit: limitOrOptions.limit ?? 50,
            offset: limitOrOptions.offset ?? 0,
          };

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { guildId },
      include: {
        splits: {
          include: {
            group: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: options.offset,
      take: options.limit,
    });

    return entries.map((entry) => ({
      ...entry,
      splits: entry.splits.map((split) => ({
        ...split,
        pointsDelta: decimalToNumber(split.pointsDelta),
        currencyDelta: decimalToNumber(split.currencyDelta),
      })),
    }));
  }

  private async getBalanceMapWithExecutor(executor: PrismaExecutor, groupIds: string[]) {
    if (groupIds.length === 0) {
      return {};
    }

    const grouped = await executor.ledgerSplit.groupBy({
      by: ["groupId"],
      where: {
        groupId: {
          in: groupIds,
        },
      },
      _sum: {
        pointsDelta: true,
        currencyDelta: true,
      },
    });

    return Object.fromEntries(
      grouped.map((row) => [
        row.groupId,
        {
          pointsBalance: decimalToNumber(row._sum.pointsDelta),
          currencyBalance: decimalToNumber(row._sum.currencyDelta),
        },
      ]),
    );
  }

  private async lockGroups(tx: Prisma.TransactionClient, guildId: string, groupIds: string[]) {
    const uniqueGroupIds = Array.from(new Set(groupIds)).sort();
    if (uniqueGroupIds.length === 0) {
      return;
    }

    const lockedGroups = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM "Group"
      WHERE "guildId" = ${guildId}
        AND id IN (${Prisma.join(uniqueGroupIds)})
      FOR UPDATE
    `);

    if (lockedGroups.length !== uniqueGroupIds.length) {
      throw new AppError("One or more groups do not exist.", 404);
    }
  }
}
