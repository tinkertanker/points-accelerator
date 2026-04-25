import { randomInt } from "node:crypto";

import { LuckyDrawStatus, Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";

export type LuckyDrawRecord = Awaited<ReturnType<LuckyDrawService["create"]>>;
export type LuckyDrawEntryRecord = Awaited<ReturnType<LuckyDrawService["recordEntry"]>>;

type RandomIntFn = (min: number, max: number) => number;

export class LuckyDrawService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly randomIntFn: RandomIntFn = randomInt,
  ) {}

  public async create(params: {
    guildId: string;
    channelId: string;
    createdByUserId: string;
    createdByUsername?: string | null;
    description?: string | null;
    prizeAmount: number;
    winnerCount: number;
    durationMs: number;
  }) {
    if (params.prizeAmount <= 0) {
      throw new AppError("Prize must be greater than zero.", 400);
    }
    if (params.winnerCount < 1) {
      throw new AppError("Winner count must be at least 1.", 400);
    }
    if (params.durationMs <= 0) {
      throw new AppError("Duration must be positive.", 400);
    }

    const endsAt = new Date(Date.now() + params.durationMs);
    return this.prisma.luckyDraw.create({
      data: {
        guildId: params.guildId,
        channelId: params.channelId,
        createdByUserId: params.createdByUserId,
        createdByUsername: params.createdByUsername ?? null,
        description: params.description ?? null,
        prizeAmount: decimal(params.prizeAmount),
        winnerCount: params.winnerCount,
        endsAt,
      },
    });
  }

  public async attachMessage(drawId: string, messageId: string) {
    await this.prisma.luckyDraw.update({
      where: { id: drawId },
      data: { messageId },
    });
  }

  public async findById(drawId: string) {
    return this.prisma.luckyDraw.findUnique({ where: { id: drawId } });
  }

  public async countEntries(drawId: string) {
    return this.prisma.luckyDrawEntry.count({ where: { luckyDrawId: drawId } });
  }

  public async listEntrants(drawId: string) {
    return this.prisma.luckyDrawEntry.findMany({
      where: { luckyDrawId: drawId },
      orderBy: { enteredAt: "asc" },
    });
  }

  public async recordEntry(params: { drawId: string; userId: string; username?: string | null }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string; status: LuckyDrawStatus; endsAt: Date }>>(
          Prisma.sql`SELECT "id", "status", "endsAt" FROM "LuckyDraw" WHERE "id" = ${params.drawId} FOR UPDATE`,
        );
        const draw = locked[0];
        if (!draw) {
          throw new AppError("Lucky draw not found.", 404);
        }
        if (draw.status !== LuckyDrawStatus.ACTIVE) {
          throw new AppError("This lucky draw has already ended.", 409);
        }
        if (draw.endsAt.getTime() <= Date.now()) {
          throw new AppError("This lucky draw has already ended.", 409);
        }
        return tx.luckyDrawEntry.create({
          data: {
            luckyDrawId: params.drawId,
            userId: params.userId,
            username: params.username ?? null,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("You're already in this draw.", 409);
      }
      throw error;
    }
  }

  public async listResumable(guildId: string) {
    return this.prisma.luckyDraw.findMany({
      where: {
        guildId,
        OR: [
          { status: LuckyDrawStatus.ACTIVE },
          { status: LuckyDrawStatus.COMPLETED, paidOutAt: null },
        ],
      },
      orderBy: { endsAt: "asc" },
    });
  }

  public async markPaidOut(drawId: string) {
    return this.prisma.luckyDraw.update({
      where: { id: drawId },
      data: { paidOutAt: new Date() },
    });
  }

  public async markCompleted(drawId: string) {
    return this.prisma.luckyDraw.update({
      where: { id: drawId },
      data: { status: LuckyDrawStatus.COMPLETED, settledAt: new Date() },
    });
  }

  public async settle(drawId: string) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: LuckyDrawStatus; winnerCount: number }>>(
        Prisma.sql`SELECT "id", "status", "winnerCount" FROM "LuckyDraw" WHERE "id" = ${drawId} FOR UPDATE`,
      );
      if (locked.length === 0) {
        throw new AppError("Lucky draw not found.", 404);
      }
      const lockedRow = locked[0]!;

      const existingWinners = await tx.luckyDrawEntry.findMany({
        where: { luckyDrawId: drawId, wonAt: { not: null } },
        orderBy: { wonAt: "asc" },
      });

      if (existingWinners.length > 0) {
        const draw = await tx.luckyDraw.findUnique({ where: { id: drawId } });
        return { draw: draw!, winners: existingWinners, freshlyPicked: false };
      }

      const entries = await tx.luckyDrawEntry.findMany({
        where: { luckyDrawId: drawId },
        orderBy: { enteredAt: "asc" },
      });

      const winners = this.selectWinners(entries, lockedRow.winnerCount);
      if (winners.length > 0) {
        const wonAt = new Date();
        await tx.luckyDrawEntry.updateMany({
          where: { id: { in: winners.map((entry) => entry.id) } },
          data: { wonAt },
        });
      }

      const draw = await tx.luckyDraw.findUnique({ where: { id: drawId } });
      const winnerEntries = await tx.luckyDrawEntry.findMany({
        where: { luckyDrawId: drawId, wonAt: { not: null } },
        orderBy: { wonAt: "asc" },
      });

      return { draw: draw!, winners: winnerEntries, freshlyPicked: true };
    });
  }

  public selectWinners<T extends { id: string }>(entries: T[], count: number): T[] {
    const target = Math.min(Math.max(0, count), entries.length);
    if (target === 0) {
      return [];
    }
    const pool = [...entries];
    for (let i = 0; i < target; i++) {
      const j = i + this.randomIntFn(0, pool.length - i);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, target);
  }

  public formatPrizeAmount(draw: { prizeAmount: Prisma.Decimal }) {
    return decimalToNumber(draw.prizeAmount);
  }
}
