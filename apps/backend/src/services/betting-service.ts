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

    const result = await this.prisma.$transaction(async (tx) => {
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

      const entry = await tx.ledgerEntry.create({
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

      return {
        entry,
        newBalance: currentBalance + currencyDelta,
      };
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.actor.userId,
      actorUsername: params.actor.username,
      action: won ? "bet.won" : "bet.lost",
      entityType: "LedgerEntry",
      entityId: result.entry.id,
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
      newCurrencyBalance: result.newBalance,
      groupDisplayName: params.groupDisplayName,
    };
  }

  /**
   * Get betting statistics for a specific user within a guild.
   */
  public async getStats(guildId: string, userId: string): Promise<BetStats> {
    const [wins, losses, winTotals, lossTotals] = await Promise.all([
      this.prisma.ledgerEntry.count({
        where: {
          guildId,
          type: "BET_WIN",
          createdByUserId: userId,
        },
      }),
      this.prisma.ledgerEntry.count({
        where: {
          guildId,
          type: "BET_LOSS",
          createdByUserId: userId,
        },
      }),
      this.prisma.ledgerSplit.aggregate({
        where: {
          entry: {
            guildId,
            type: "BET_WIN",
            createdByUserId: userId,
          },
        },
        _sum: { currencyDelta: true },
      }),
      this.prisma.ledgerSplit.aggregate({
        where: {
          entry: {
            guildId,
            type: "BET_LOSS",
            createdByUserId: userId,
          },
        },
        _sum: { currencyDelta: true },
      }),
    ]);

    const totalWon = decimalToNumber(winTotals._sum?.currencyDelta ?? decimal(0));
    const totalLost = Math.abs(decimalToNumber(lossTotals._sum?.currencyDelta ?? decimal(0)));

    return {
      totalBets: wins + losses,
      wins,
      losses,
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
   * Vote to exclude a group member from betting. The command layer is
   * responsible for validating that the target currently belongs to the same
   * group as the voter. This service persists that group context so pending
   * votes cannot be finalized across groups if membership changes later.
   */
  public async voteExclusion(params: {
    guildId: string;
    voterUserId: string;
    voterUsername?: string;
    targetUserId: string;
    targetUsername?: string;
    groupId: string;
  }): Promise<{ finalized: boolean; expiresAt: Date | null }> {
    if (params.voterUserId === params.targetUserId) {
      throw new AppError("You cannot exclude yourself.", 400);
    }

    const maxTransactionRetries = 3;
    const pendingEpoch = new Date(0);
    let attempt = 0;

    while (true) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const activeExclusion = await tx.betExclusion.findFirst({
              where: {
                guildId: params.guildId,
                targetUserId: params.targetUserId,
                expiresAt: { gt: new Date() },
              },
              orderBy: { expiresAt: "desc" },
            });

            if (activeExclusion) {
              const expiresTimestamp = Math.floor(activeExclusion.expiresAt.getTime() / 1000);
              throw new AppError(
                `This user is already excluded from betting until <t:${expiresTimestamp}:f>.`,
              );
            }

            const pendingVote = await tx.betExclusion.findUnique({
              where: {
                guildId_targetUserId_groupId_expiresAt: {
                  guildId: params.guildId,
                  targetUserId: params.targetUserId,
                  groupId: params.groupId,
                  expiresAt: pendingEpoch,
                },
              },
            });

            if (pendingVote) {
              if (pendingVote.createdByUserId === params.voterUserId) {
                throw new AppError("You have already voted to exclude this user. A second teammate must also vote.");
              }

              const expiresAt = new Date(Date.now() + BET_EXCLUSION_DURATION_MS);
              const finalized = await tx.betExclusion.updateMany({
                where: {
                  id: pendingVote.id,
                  expiresAt: pendingEpoch,
                },
                data: { expiresAt },
              });

              if (finalized.count !== 1) {
                throw new AppError("This exclusion vote is no longer pending. Please try again.");
              }

              return {
                finalized: true as const,
                expiresAt,
                audit: {
                  action: "bet.exclusion.finalized" as const,
                  entityId: pendingVote.id,
                  payload: {
                    targetUserId: params.targetUserId,
                    targetUsername: params.targetUsername,
                    groupId: params.groupId,
                    firstVoterUserId: pendingVote.createdByUserId,
                    secondVoterUserId: params.voterUserId,
                    expiresAt: expiresAt.toISOString(),
                  },
                },
              };
            }

            const vote = await tx.betExclusion.create({
              data: {
                guildId: params.guildId,
                groupId: params.groupId,
                targetUserId: params.targetUserId,
                targetUsername: params.targetUsername,
                createdByUserId: params.voterUserId,
                createdByUsername: params.voterUsername,
                expiresAt: pendingEpoch,
              },
            });

            return {
              finalized: false as const,
              expiresAt: null,
              audit: {
                action: "bet.exclusion.voted" as const,
                entityId: vote.id,
                payload: {
                  targetUserId: params.targetUserId,
                  targetUsername: params.targetUsername,
                  groupId: params.groupId,
                },
              },
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        await this.auditService.record({
          guildId: params.guildId,
          actorUserId: params.voterUserId,
          actorUsername: params.voterUsername,
          action: result.audit.action,
          entityType: "BetExclusion",
          entityId: result.audit.entityId,
          payload: result.audit.payload,
        });

        return { finalized: result.finalized, expiresAt: result.expiresAt };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === "P2002" || error.code === "P2034")
          && attempt < maxTransactionRetries
        ) {
          attempt += 1;
          continue;
        }

        throw error;
      }
    }
  }
}
