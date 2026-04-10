import type { PrismaClient } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";

export type AssignmentInput = {
  id?: string;
  title: string;
  description?: string;
  baseCurrencyReward: number;
  basePointsReward: number;
  bonusCurrencyReward: number;
  bonusPointsReward: number;
  deadline?: string | null;
  active: boolean;
  sortOrder?: number;
};

export class AssignmentService {
  public constructor(private readonly prisma: PrismaClient) {}

  private toAssignmentResponse(assignment: {
    id: string;
    guildId: string;
    title: string;
    description: string;
    baseCurrencyReward: Decimal;
    basePointsReward: Decimal;
    bonusCurrencyReward: Decimal;
    bonusPointsReward: Decimal;
    deadline: Date | null;
    active: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    _count?: { submissions: number };
  }) {
    return {
      ...assignment,
      baseCurrencyReward: decimalToNumber(assignment.baseCurrencyReward),
      basePointsReward: decimalToNumber(assignment.basePointsReward),
      bonusCurrencyReward: decimalToNumber(assignment.bonusCurrencyReward),
      bonusPointsReward: decimalToNumber(assignment.bonusPointsReward),
      submissionCount: assignment._count?.submissions,
    };
  }

  public async list(guildId: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { guildId },
      include: {
        _count: { select: { submissions: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return assignments.map((assignment) => this.toAssignmentResponse(assignment));
  }

  public async listActive(guildId: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { guildId, active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return assignments.map((assignment) => this.toAssignmentResponse(assignment));
  }

  public async upsert(guildId: string, input: AssignmentInput) {
    const data = {
      title: input.title,
      description: input.description ?? "",
      baseCurrencyReward: decimal(input.baseCurrencyReward),
      basePointsReward: decimal(input.basePointsReward),
      bonusCurrencyReward: decimal(input.bonusCurrencyReward),
      bonusPointsReward: decimal(input.bonusPointsReward),
      deadline: input.deadline ? new Date(input.deadline) : null,
      active: input.active,
      sortOrder: input.sortOrder ?? 0,
    };

    if (input.id) {
      const existing = await this.prisma.assignment.findFirst({
        where: { id: input.id, guildId },
      });

      if (!existing) {
        throw new AppError("Assignment not found.", 404);
      }

      const assignment = await this.prisma.assignment.update({
        where: { id: input.id },
        data,
      });

      return this.toAssignmentResponse(assignment);
    }

    const assignment = await this.prisma.assignment.create({
      data: { guildId, ...data },
    });

    return this.toAssignmentResponse(assignment);
  }

  public async getById(guildId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, guildId },
    });

    if (!assignment) {
      throw new AppError("Assignment not found.", 404);
    }

    return this.toAssignmentResponse(assignment);
  }
}
