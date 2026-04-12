import { Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { ConfigService } from "./config-service.js";
import type { AuditService } from "./audit-service.js";

type Actor = {
  userId: string;
  username?: string;
  roleIds: string[];
};

type BetResult = {
  won: boolean;
  amount: number;
  newCurrencyBalance: number;
  groupDisplayName: string;
};

type BetStats = {
  totalBets: number;
  wins: number;
  losses: number;
  totalWon: number;
  totalLost: number;
  netGain: number;
};

const BET_EXCLUSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

export class BettingService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Place a double-or-nothing bet. The actor's group currency is wagered.
   * On win the group gains `amount` currency; on loss the group loses `amount`.
   */
  public async placeBet(params: {
    guildId: string;
    actor: Actor;
    groupId: string;
    groupDisplayName: string;
    amount: number;
  }): Promise<BetResult> {
    if (params.amount <= 0) {
      throw new AppError("Bet amount must be greater than zero.");
    }

    if (!Number.isFinite(params.amount)) {
      throw new AppError("Bet amount must be a valid number.");
    }

    // Check for active exclusion
    await this.assertNotExcluded(params.guildId, params.actor.userId);

    const config = await this.configService.getOrCreate(params.guildId);
    const winChance = config.betWinChance;

    // Roll: random integer from 0–99, win if < winChance
    const roll = Math.floor(Math.random() * 100);
    const won = roll < winChance;

    const currencyDelta = won ? params.amount : -params.amount;
    const type = won ? "BET_WIN" : "BET_LOSS";
    const description = won
      ? `${params.groupDisplayName} won a bet of ${params.amount}`
      : `${params.groupDisplayName} lost a bet of ${params.amount}`;

    const entry = await this.prisma.$transaction(async (tx) => {
      // Lock the group row
      const lockedGroups = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM "Group"
        WHERE "guildId" = ${params.guildId}
          AND id = ${params.groupId}
        FOR UPDATE
      `);

      if (lockedGroups.length === 0) {
        throw new AppError("Group not found.", 404);
      }

      // Check balance
      const grouped = await tx.ledgerSplit.groupBy({
        by: ["groupId"],
        where: { groupId: params.groupId },
        _sum: { currencyDelta: true },
      });

      const currentBalance = grouped.length > 0
        ? decimalToNumber(grouped[0]._sum.currencyDelta)
        : 0;

      if (currentBalance < params.amount) {
        throw new AppError(
          `Your group doesn't have enough currency. Current balance: ${currentBalance}.`,
          409,
        );
      }

      return tx.ledgerEntry.create({
        data: {
          guildId: params.guildId,
          type,
          description,
          createdByUserId: params.actor.userId,
          createdByUsername: params.actor.username,
          splits: {
            create: {
              groupId: params.groupId,
              pointsDelta: decimal(0),
              currencyDelta: decimal(currencyDelta),
            },
          },
        },
        include: { splits: true },
      });
    });

    // Compute new balance after the bet
    const balanceAfter = await this.prisma.ledgerSplit.groupBy({
      by: ["groupId"],
      where: { groupId: params.groupId },
      _sum: { currencyDelta: true },
    });

    const newBalance = balanceAfter.length > 0
      ? decimalToNumber(balanceAfter[0]._sum.currencyDelta)
      : 0;

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.actor.userId,
      actorUsername: params.actor.username,
      action: won ? "bet.won" : "bet.lost",
      entityType: "LedgerEntry",
      entityId: entry.id,
      payload: {
        amount: params.amount,
        groupId: params.groupId,
        won,
        roll,
        winChance,
      },
    });

    return {
      won,
      amount: params.amount,
      newCurrencyBalance: newBalance,
      groupDisplayName: params.groupDisplayName,
    };
  }

  /**
   * Get betting statistics for a specific user within a guild.
   */
  public async getStats(guildId: string, userId: string): Promise<BetStats> {
    const wins = await this.prisma.ledgerEntry.findMany({
      where: {
        guildId,
        type: "BET_WIN",
        createdByUserId: userId,
      },
      include: { splits: true },
    });

    const losses = await this.prisma.ledgerEntry.findMany({
      where: {
        guildId,
        type: "BET_LOSS",
        createdByUserId: userId,
      },
      include: { splits: true },
    });

    const totalWon = wins.reduce(
      (sum, entry) =>
        sum + entry.splits.reduce((splitSum, split) => splitSum + decimalToNumber(split.currencyDelta), 0),
      0,
    );

    const totalLost = losses.reduce(
      (sum, entry) =>
        sum + entry.splits.reduce((splitSum, split) => splitSum + Math.abs(decimalToNumber(split.currencyDelta)), 0),
      0,
    );

    return {
      totalBets: wins.length + losses.length,
      wins: wins.length,
      losses: losses.length,
      totalWon,
      totalLost,
      netGain: totalWon - totalLost,
    };
  }

  /**
   * Check if a user has an active betting exclusion. Throws if excluded.
   */
  public async assertNotExcluded(guildId: string, userId: string): Promise<void> {
    const exclusion = await this.prisma.betExclusion.findFirst({
      where: {
        guildId,
        targetUserId: userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: "desc" },
    });

    if (exclusion) {
      const expiresTimestamp = Math.floor(exclusion.expiresAt.getTime() / 1000);
      throw new AppError(
        `You are excluded from betting until <t:${expiresTimestamp}:f>.`,
        403,
      );
    }
  }

  /**
   * Vote to exclude a group member from betting. Requires two distinct voters
   * from the same group to complete the exclusion.
   *
   * Uses a simple approach: if a pending exclusion vote already exists from a
   * different group member, the exclusion is finalized. Otherwise, the vote is
   * recorded as a pending exclusion.
   *
   * We store an unfinalized exclusion with expiresAt in the past (epoch 0)
   * to mark a single vote. When a second vote arrives, we update expiresAt
   * to one week from now, activating the exclusion.
   */
  public async voteExclusion(params: {
    guildId: string;
    voterUserId: string;
    voterUsername?: string;
    targetUserId: string;
    targetUsername?: string;
    groupRoleIds: string[];
  }): Promise<{ finalized: boolean; expiresAt: Date | null }> {
    if (params.voterUserId === params.targetUserId) {
      throw new AppError("You cannot exclude yourself.", 400);
    }

    // Check if target already has an active exclusion
    const activeExclusion = await this.prisma.betExclusion.findFirst({
      where: {
        guildId: params.guildId,
        targetUserId: params.targetUserId,
        expiresAt: { gt: new Date() },
      },
    });

    if (activeExclusion) {
      const expiresTimestamp = Math.floor(activeExclusion.expiresAt.getTime() / 1000);
      throw new AppError(
        `This user is already excluded from betting until <t:${expiresTimestamp}:f>.`,
      );
    }

    // Look for a pending vote (expiresAt at epoch 0 = pending single vote)
    const pendingEpoch = new Date(0);
    const pendingVote = await this.prisma.betExclusion.findFirst({
      where: {
        guildId: params.guildId,
        targetUserId: params.targetUserId,
        expiresAt: pendingEpoch,
      },
    });

    if (pendingVote) {
      // A vote already exists
      if (pendingVote.createdByUserId === params.voterUserId) {
        throw new AppError("You have already voted to exclude this user. A second teammate must also vote.");
      }

      // Second distinct voter — finalize the exclusion
      const expiresAt = new Date(Date.now() + BET_EXCLUSION_DURATION_MS);
      await this.prisma.betExclusion.update({
        where: { id: pendingVote.id },
        data: { expiresAt },
      });

      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.voterUserId,
        actorUsername: params.voterUsername,
        action: "bet.exclusion.finalized",
        entityType: "BetExclusion",
        entityId: pendingVote.id,
        payload: {
          targetUserId: params.targetUserId,
          targetUsername: params.targetUsername,
          firstVoterUserId: pendingVote.createdByUserId,
          secondVoterUserId: params.voterUserId,
          expiresAt: expiresAt.toISOString(),
        },
      });

      return { finalized: true, expiresAt };
    }

    // No pending vote — create one (with expiresAt = epoch 0 to mark it as pending)
    const vote = await this.prisma.betExclusion.create({
      data: {
        guildId: params.guildId,
        targetUserId: params.targetUserId,
        targetUsername: params.targetUsername,
        createdByUserId: params.voterUserId,
        createdByUsername: params.voterUsername,
        expiresAt: pendingEpoch,
      },
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.voterUserId,
      actorUsername: params.voterUsername,
      action: "bet.exclusion.voted",
      entityType: "BetExclusion",
      entityId: vote.id,
      payload: {
        targetUserId: params.targetUserId,
        targetUsername: params.targetUsername,
      },
    });

    return { finalized: false, expiresAt: null };
  }
}
