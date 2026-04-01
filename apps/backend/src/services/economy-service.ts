import { Prisma, type PrismaClient } from "@prisma/client";

import { assertCanAward, resolveCapabilities } from "../domain/permissions.js";
import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber, maxDecimalMagnitude } from "../utils/decimal.js";
import type { ConfigService } from "./config-service.js";
import type { GroupService } from "./group-service.js";
import type { RoleCapabilityService } from "./role-capability-service.js";
import type { AuditService } from "./audit-service.js";

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
  | "ADJUSTMENT";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export class EconomyService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly groupService: GroupService,
    private readonly roleCapabilityService: RoleCapabilityService,
    private readonly auditService: AuditService,
  ) {}

  public async awardGroups(params: {
    guildId: string;
    actor: Actor;
    targetGroupIds: string[];
    pointsDelta: number;
    currencyDelta: number;
    description: string;
    type?: LedgerEntryKind;
  }) {
    if (params.targetGroupIds.length === 0) {
      throw new AppError("Select at least one group.");
    }

    const actorCapabilities = await this.roleCapabilityService.listForRoleIds(params.guildId, params.actor.roleIds);
    const resolved = resolveCapabilities(actorCapabilities);
    const magnitude = maxDecimalMagnitude(params.pointsDelta, params.currencyDelta);
    const isDeduction = params.pointsDelta < 0 || params.currencyDelta < 0;
    assertCanAward({
      capabilities: resolved,
      magnitude,
      targetCount: params.targetGroupIds.length,
      isDeduction,
    });

    const groups = await this.prisma.group.findMany({
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

    const targetCapabilities = await this.prisma.discordRoleCapability.findMany({
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

    const entry = await this.prisma.ledgerEntry.create({
      data: {
        guildId: params.guildId,
        type:
          params.type ??
          (isDeduction ? "MANUAL_DEDUCT" : "MANUAL_AWARD"),
        description: params.description,
        createdByUserId: params.actor.userId,
        createdByUsername: params.actor.username,
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
      },
    });

    return entry;
  }

  public async rewardPassiveMessage(params: {
    guildId: string;
    groupId: string;
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

    return this.prisma.ledgerEntry.create({
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
            currencyDelta: config.passiveCurrencyReward,
          },
        },
      },
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
