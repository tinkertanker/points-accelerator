import { Prisma, type PrismaClient, type SubmissionStatus } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { AuditService } from "./audit-service.js";
import type { EconomyService } from "./economy-service.js";

export class SubmissionService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly economyService: EconomyService,
    private readonly auditService: AuditService,
  ) {}

  private toSubmissionResponse<T extends {
    currencyAwarded: Decimal | null;
    pointsAwarded: Decimal | null;
  }>(submission: T) {
    return {
      ...submission,
      currencyAwarded: submission.currencyAwarded === null ? null : decimalToNumber(submission.currencyAwarded),
      pointsAwarded: submission.pointsAwarded === null ? null : decimalToNumber(submission.pointsAwarded),
    };
  }

  public async list(guildId: string, filters?: { assignmentId?: string; status?: SubmissionStatus; participantId?: string }) {
    const submissions = await this.prisma.submission.findMany({
      where: {
        guildId,
        ...(filters?.assignmentId ? { assignmentId: filters.assignmentId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.participantId ? { participantId: filters.participantId } : {}),
      },
      include: {
        assignment: { select: { id: true, title: true } },
        participant: {
          select: {
            id: true,
            indexId: true,
            discordUserId: true,
            discordUsername: true,
            group: { select: { id: true, displayName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return submissions.map((submission) => this.toSubmissionResponse(submission));
  }

  public async create(params: {
    guildId: string;
    assignmentId: string;
    participantId: string;
    text: string;
    imageUrl?: string;
    imageKey?: string;
  }) {
    const text = params.text.trim();

    if (text.length === 0 && !params.imageUrl) {
      throw new AppError("Add some text or an image before submitting.", 400);
    }

    const assignment = await this.prisma.assignment.findFirst({
      where: { id: params.assignmentId, guildId: params.guildId, active: true },
    });

    if (!assignment) {
      throw new AppError("Assignment not found or is no longer active.", 404);
    }

    if (assignment.deadline && new Date() > assignment.deadline) {
      throw new AppError("The deadline for this assignment has passed.", 409);
    }

    const existing = await this.prisma.submission.findFirst({
      where: {
        guildId: params.guildId,
        assignmentId: params.assignmentId,
        participantId: params.participantId,
      },
    });

    if (existing) {
      throw new AppError("You have already submitted for this assignment. Contact an admin if you need to resubmit.", 409);
    }

    try {
      const submission = await this.prisma.submission.create({
        data: {
          guildId: params.guildId,
          assignmentId: params.assignmentId,
          participantId: params.participantId,
          text,
          imageUrl: params.imageUrl ?? null,
          imageKey: params.imageKey ?? null,
        },
        include: {
          assignment: { select: { id: true, title: true } },
          participant: {
            select: {
              id: true,
              indexId: true,
              discordUserId: true,
              discordUsername: true,
              group: { select: { id: true, displayName: true } },
            },
          },
        },
      });

      return this.toSubmissionResponse(submission);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError("You have already submitted for this assignment. Contact an admin if you need to resubmit.", 409);
      }

      throw error;
    }
  }

  public async review(params: {
    guildId: string;
    submissionId: string;
    status: "APPROVED" | "OUTSTANDING" | "REJECTED";
    reviewNote?: string;
    reviewedByUserId: string;
    reviewedByUsername?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: params.submissionId, guildId: params.guildId },
        include: {
          assignment: true,
          participant: {
            include: { group: true },
          },
        },
      });

      if (!submission) {
        throw new AppError("Submission not found.", 404);
      }

      if (submission.status !== "PENDING") {
        throw new AppError(`This submission has already been reviewed (status: ${submission.status}).`, 409);
      }

      let currencyAwarded = 0;
      let pointsAwarded = 0;

      if (params.status === "APPROVED" || params.status === "OUTSTANDING") {
        currencyAwarded = decimalToNumber(submission.assignment.baseCurrencyReward);
        pointsAwarded = decimalToNumber(submission.assignment.basePointsReward);

        if (params.status === "OUTSTANDING") {
          currencyAwarded += decimalToNumber(submission.assignment.bonusCurrencyReward);
          pointsAwarded += decimalToNumber(submission.assignment.bonusPointsReward);
        }
      }

      // Claim the pending submission before creating any ledger entries so concurrent reviews cannot double-award it.
      const claim = await tx.submission.updateMany({
        where: {
          id: params.submissionId,
          guildId: params.guildId,
          status: "PENDING",
        },
        data: {
          status: params.status,
          reviewedByUserId: params.reviewedByUserId,
          reviewedByUsername: params.reviewedByUsername,
          reviewNote: params.reviewNote ?? null,
          currencyAwarded: currencyAwarded > 0 ? decimal(currencyAwarded) : null,
          pointsAwarded: pointsAwarded > 0 ? decimal(pointsAwarded) : null,
        },
      });

      if (claim.count === 0) {
        const latest = await tx.submission.findFirst({
          where: { id: params.submissionId, guildId: params.guildId },
          select: { status: true },
        });

        if (!latest) {
          throw new AppError("Submission not found.", 404);
        }

        throw new AppError(`This submission has already been reviewed (status: ${latest.status}).`, 409);
      }

      let ledgerEntryId: string | null = null;

      if (currencyAwarded > 0 || pointsAwarded > 0) {
        const description = params.status === "OUTSTANDING"
          ? `Outstanding submission for "${submission.assignment.title}" by ${submission.participant.discordUsername ?? submission.participant.indexId}`
          : `Submission approved for "${submission.assignment.title}" by ${submission.participant.discordUsername ?? submission.participant.indexId}`;

        const entry = await this.economyService.awardGroups({
          guildId: params.guildId,
          actor: {
            userId: params.reviewedByUserId,
            username: params.reviewedByUsername,
            roleIds: [],
          },
          targetGroupIds: [submission.participant.groupId],
          pointsDelta: pointsAwarded,
          currencyDelta: currencyAwarded,
          description,
          type: "SUBMISSION_REWARD",
          systemAction: true,
          executor: tx,
        });

        ledgerEntryId = entry.id;
      }

      const updated = await tx.submission.update({
        where: { id: params.submissionId },
        data: { ledgerEntryId },
        include: {
          assignment: { select: { id: true, title: true } },
          participant: {
            select: {
              id: true,
              indexId: true,
              discordUserId: true,
              discordUsername: true,
              group: { select: { id: true, displayName: true } },
            },
          },
        },
      });

      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.reviewedByUserId,
        actorUsername: params.reviewedByUsername,
        action: "submission.reviewed",
        entityType: "Submission",
        entityId: params.submissionId,
        payload: {
          status: params.status,
          currencyAwarded,
          pointsAwarded,
          reviewNote: params.reviewNote,
        },
        executor: tx,
      });

      return this.toSubmissionResponse(updated);
    });
  }

  public async resolveIdentifier(guildId: string, identifier: string) {
    const value = identifier.trim();
    if (!value) {
      throw new AppError("Submission ID is required.", 400);
    }

    const exact = await this.prisma.submission.findFirst({
      where: { guildId, id: value },
      select: {
        id: true,
        assignment: { select: { title: true } },
        participant: {
          select: {
            indexId: true,
            discordUsername: true,
          },
        },
      },
    });

    if (exact) {
      return exact;
    }

    const matches = await this.prisma.submission.findMany({
      where: {
        guildId,
        id: {
          startsWith: value,
        },
      },
      select: {
        id: true,
        assignment: { select: { title: true } },
        participant: {
          select: {
            indexId: true,
            discordUsername: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 2,
    });

    if (matches.length === 0) {
      throw new AppError("Submission not found.", 404);
    }

    if (matches.length > 1) {
      throw new AppError("Submission ID is ambiguous. Use a longer prefix.", 409);
    }

    return matches[0];
  }

  /**
   * Get a summary of who has and hasn't submitted for each active assignment.
   */
  public async getCompletionSummary(guildId: string) {
    const [assignments, participants, submissions] = await Promise.all([
      this.prisma.assignment.findMany({
        where: { guildId, active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.participant.findMany({
        where: { guildId },
        include: { group: { select: { id: true, displayName: true } } },
      }),
      this.prisma.submission.findMany({
        where: { guildId },
        select: { assignmentId: true, participantId: true, status: true },
      }),
    ]);

    return assignments.map((assignment) => {
      const submitted = new Set(
        submissions
          .filter((sub) => sub.assignmentId === assignment.id)
          .map((sub) => sub.participantId),
      );

      const missing = participants.filter((participant) => !submitted.has(participant.id));

      return {
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        totalParticipants: participants.length,
        submittedCount: submitted.size,
        missingParticipants: missing.map((participant) => ({
          id: participant.id,
          indexId: participant.indexId,
          discordUsername: participant.discordUsername,
          group: participant.group.displayName,
        })),
      };
    });
  }
}
