import { Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { AuditService } from "./audit-service.js";
import type { ParticipantCurrencyService } from "./participant-currency-service.js";

type Actor = {
  userId?: string;
  username?: string;
  roleIds: string[];
};

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export type GoFundMeSummary = Awaited<ReturnType<GoFundMeService["getActiveSummary"]>>;

export class GoFundMeService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly participantCurrencyService: ParticipantCurrencyService,
    private readonly auditService: AuditService,
  ) {}

  public async setActiveCampaign(params: {
    guildId: string;
    actor: Actor;
    title: string;
    goalPoints: number;
  }) {
    if (params.goalPoints <= 0) {
      throw new AppError("GoFundMe goal must be greater than zero.", 400);
    }

    const title = params.title.trim() || "GoFundMe";

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.goFundMeCampaign.findFirst({
        where: { guildId: params.guildId, active: true },
        orderBy: { createdAt: "desc" },
      });

      const campaign = existing
        ? await tx.goFundMeCampaign.update({
            where: { id: existing.id },
            data: {
              title,
              goalPoints: decimal(params.goalPoints),
            },
          })
        : await tx.goFundMeCampaign.create({
            data: {
              guildId: params.guildId,
              title,
              goalPoints: decimal(params.goalPoints),
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
            },
          });

      await tx.goFundMeCampaign.updateMany({
        where: {
          guildId: params.guildId,
          active: true,
          id: { not: campaign.id },
        },
        data: { active: false },
      });

      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.actor.userId,
        actorUsername: params.actor.username,
        action: "gofundme.campaign_set",
        entityType: "GoFundMeCampaign",
        entityId: campaign.id,
        payload: {
          title,
          goalPoints: params.goalPoints,
          replacedCampaignId: existing?.id ?? null,
        },
        executor: tx,
      });

      return this.buildSummary(campaign, tx);
    });
  }

  public async getActiveSummary(guildId: string) {
    const campaign = await this.prisma.goFundMeCampaign.findFirst({
      where: { guildId, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!campaign) {
      return null;
    }

    return this.buildSummary(campaign, this.prisma);
  }

  public async donatePersonalCurrency(params: {
    guildId: string;
    actor: Actor;
    participantId: string;
    groupId: string;
    amount: number;
    description?: string;
  }) {
    if (params.amount <= 0) {
      throw new AppError("Donation amount must be greater than zero.", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      const campaigns = await tx.$queryRaw<
        Array<{ id: string; guildId: string; title: string; goalPoints: Prisma.Decimal; active: boolean; createdAt: Date; updatedAt: Date }>
      >(Prisma.sql`
        SELECT id, "guildId", title, "goalPoints", active, "createdAt", "updatedAt"
        FROM "GoFundMeCampaign"
        WHERE "guildId" = ${params.guildId}
          AND active = true
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR UPDATE
      `);
      const campaign = campaigns[0];
      if (!campaign) {
        throw new AppError("No active GoFundMe campaign. Ask an admin to run /gofundme set first.", 404);
      }

      const participant = await tx.participant.findFirst({
        where: {
          id: params.participantId,
          guildId: params.guildId,
          groupId: params.groupId,
        },
      });
      if (!participant) {
        throw new AppError("Participant not found in the donating group.", 404);
      }

      const balance = await this.getParticipantCurrencyBalance(tx, params.participantId);
      if (balance < params.amount) {
        throw new AppError("You do not have enough personal points to donate.", 409);
      }

      const currencyEntry = await this.participantCurrencyService.recordEntry({
        guildId: params.guildId,
        actor: params.actor,
        type: "DONATION",
        description: params.description ?? `GoFundMe donation to ${campaign.title}`,
        splits: [{ participantId: params.participantId, currencyDelta: -params.amount }],
        systemAction: true,
        executor: tx,
        externalRef: `gofundme:${campaign.id}:${params.participantId}:${Date.now()}`,
        auditAction: "participant_currency.gofundme_donated",
        auditPayload: {
          campaignId: campaign.id,
          participantId: params.participantId,
          groupId: params.groupId,
          amount: params.amount,
        },
      });

      const donation = await tx.goFundMeDonation.create({
        data: {
          guildId: params.guildId,
          campaignId: campaign.id,
          participantId: params.participantId,
          groupId: params.groupId,
          currencyEntryId: currencyEntry.id,
          amount: decimal(params.amount),
          createdByUserId: params.actor.userId,
          createdByUsername: params.actor.username,
        },
        include: {
          group: true,
          participant: true,
        },
      });

      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.actor.userId,
        actorUsername: params.actor.username,
        action: "gofundme.donated",
        entityType: "GoFundMeDonation",
        entityId: donation.id,
        payload: {
          campaignId: campaign.id,
          participantId: params.participantId,
          groupId: params.groupId,
          amount: params.amount,
          currencyEntryId: currencyEntry.id,
        },
        executor: tx,
      });

      return {
        donation: {
          ...donation,
          amount: decimalToNumber(donation.amount),
        },
        summary: await this.buildSummary(campaign, tx),
        currencyEntry,
      };
    });
  }

  private async getParticipantCurrencyBalance(executor: PrismaExecutor, participantId: string) {
    const grouped = await executor.participantCurrencySplit.groupBy({
      by: ["participantId"],
      where: { participantId },
      _sum: { currencyDelta: true },
    });
    return decimalToNumber(grouped[0]?._sum.currencyDelta);
  }

  private async buildSummary(
    campaign: {
      id: string;
      guildId: string;
      title: string;
      goalPoints: Prisma.Decimal;
      active: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    executor: PrismaExecutor,
  ) {
    const [aggregate, recentDonations] = await Promise.all([
      executor.goFundMeDonation.aggregate({
        where: { campaignId: campaign.id },
        _sum: { amount: true },
        _count: { id: true },
      }),
      executor.goFundMeDonation.findMany({
        where: { campaignId: campaign.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          group: true,
          participant: true,
        },
      }),
    ]);

    const donatedPoints = decimalToNumber(aggregate._sum.amount);
    const goalPoints = decimalToNumber(campaign.goalPoints);
    const progress = goalPoints > 0 ? Math.min(1, donatedPoints / goalPoints) : 0;

    return {
      id: campaign.id,
      guildId: campaign.guildId,
      title: campaign.title,
      goalPoints,
      donatedPoints,
      donationCount: aggregate._count.id,
      progress,
      active: campaign.active,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      recentDonations: recentDonations.map((donation) => ({
        id: donation.id,
        amount: decimalToNumber(donation.amount),
        createdByUserId: donation.createdByUserId,
        createdByUsername: donation.createdByUsername,
        createdAt: donation.createdAt,
        group: donation.group,
        participant: donation.participant,
      })),
    };
  }
}
