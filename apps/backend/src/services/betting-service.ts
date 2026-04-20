import { Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { ParticipantCurrencyService } from "./participant-currency-service.js";
import type { ConfigService } from "./config-service.js";

type Actor = {
  userId: string;
  username?: string;
  roleIds: string[];
};

type BetResult = {
  won: boolean;
  amount: number;
  newCurrencyBalance: number;
};

type BetStats = {
  totalBets: number;
  wins: number;
  losses: number;
  totalWon: number;
  totalLost: number;
  netGain: number;
};

export class BettingService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly participantCurrencyService: ParticipantCurrencyService,
  ) {}

  /**
   * Place a double-or-nothing bet against the participant's wallet balance.
   */
  public async placeBet(params: {
    guildId: string;
    actor: Actor;
    participantId: string;
    amount: number;
  }): Promise<BetResult> {
    if (!Number.isFinite(params.amount)) {
      throw new AppError("Bet amount must be a valid number.");
    }

    if (params.amount <= 0) {
      throw new AppError("Bet amount must be greater than zero.");
    }

    const config = await this.configService.getOrCreate(params.guildId);
    const winChance = config.betWinChance;
    const roll = Math.floor(Math.random() * 100);
    const won = roll < winChance;
    const currencyDelta = won ? params.amount : -params.amount;
    const type = won ? "BET_WIN" : "BET_LOSS";

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedParticipants = await tx.$queryRaw<Array<{ id: string; discordUserId: string }>>(Prisma.sql`
        SELECT id, "discordUserId"
        FROM "Participant"
        WHERE "guildId" = ${params.guildId}
          AND id = ${params.participantId}
        FOR UPDATE
      `);

      if (lockedParticipants.length !== 1) {
        throw new AppError("Participant not found.", 404);
      }

      if (lockedParticipants[0].discordUserId !== params.actor.userId) {
        throw new AppError("Participants may only bet with their own wallet currency.", 403);
      }

      const currentBalance = await tx.participantCurrencySplit.aggregate({
        where: { participantId: params.participantId },
        _sum: { currencyDelta: true },
      });

      if (decimalToNumber(currentBalance._sum.currencyDelta ?? decimal(0)) < params.amount) {
        throw new AppError("Participant does not have enough currency.", 409);
      }

      await this.participantCurrencyService.recordEntry({
        guildId: params.guildId,
        actor: params.actor,
        type,
        description: won
          ? `${params.actor.username ?? "A participant"} won a bet of ${params.amount}`
          : `${params.actor.username ?? "A participant"} lost a bet of ${params.amount}`,
        splits: [
          {
            participantId: params.participantId,
            currencyDelta,
          },
        ],
        systemAction: true,
        executor: tx,
        auditAction: won ? "bet.won" : "bet.lost",
        auditPayload: {
          amount: params.amount,
          participantId: params.participantId,
          won,
          roll,
          winChance,
        },
      });

      const balance = await tx.participantCurrencySplit.aggregate({
        where: { participantId: params.participantId },
        _sum: { currencyDelta: true },
      });

      return {
        newBalance: decimalToNumber(balance._sum.currencyDelta ?? decimal(0)),
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return {
      won,
      amount: params.amount,
      newCurrencyBalance: result.newBalance,
    };
  }

  /**
   * Get betting statistics for a specific user within a guild.
   */
  public async getStats(guildId: string, userId: string): Promise<BetStats> {
    const [wins, losses, winTotals, lossTotals] = await Promise.all([
      this.prisma.participantCurrencyEntry.count({
        where: {
          guildId,
          type: "BET_WIN",
          createdByUserId: userId,
        },
      }),
      this.prisma.participantCurrencyEntry.count({
        where: {
          guildId,
          type: "BET_LOSS",
          createdByUserId: userId,
        },
      }),
      this.prisma.participantCurrencySplit.aggregate({
        where: {
          entry: {
            guildId,
            type: "BET_WIN",
            createdByUserId: userId,
          },
        },
        _sum: { currencyDelta: true },
      }),
      this.prisma.participantCurrencySplit.aggregate({
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

    const totalWonDecimal = winTotals._sum?.currencyDelta ?? decimal(0);
    const totalLostDecimal = (lossTotals._sum?.currencyDelta ?? decimal(0)).abs();
    const netGainDecimal = totalWonDecimal.sub(totalLostDecimal);

    return {
      totalBets: wins + losses,
      wins,
      losses,
      totalWon: decimalToNumber(totalWonDecimal),
      totalLost: decimalToNumber(totalLostDecimal),
      netGain: decimalToNumber(netGainDecimal),
    };
  }
}
