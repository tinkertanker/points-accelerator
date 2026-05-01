import { type GuildConfig, Prisma, type PrismaClient } from "@prisma/client";

import { decimal, decimalToNumber } from "../utils/decimal.js";

import type { AuditService } from "./audit-service.js";

export type GuardedActivity = "betting" | "luckyDraw" | "points" | "shop";

const CATEGORY_TO_CONFIG_FIELD: Record<GuardedActivity, keyof GuildConfig> = {
  betting: "bettingChannelIds",
  luckyDraw: "luckyDrawChannelIds",
  points: "pointsChannelIds",
  shop: "shopChannelIds",
};

const SNARKY_MESSAGES: Record<GuardedActivity, string> = {
  betting: "🎲 Wrong channel for betting. The casino is elsewhere — and the bouncer charged you {penalty}.",
  luckyDraw: "🎁 Lucky draws aren't run here. The wrong-room fee was {penalty}.",
  points: "💼 Points commands belong somewhere else. That'll be {penalty}, thanks.",
  shop: "🛒 The shop is somewhere else. {penalty} paid as a delivery fee for nothing.",
};

export type ChannelGuardCheck =
  | { ok: true; penaltyApplied: 0 }
  | { ok: false; penaltyApplied: number; message: string };

export class ChannelGuardService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  public allowsActivity(config: GuildConfig, activity: GuardedActivity, channelId: string | null): boolean {
    const allowed = config[CATEGORY_TO_CONFIG_FIELD[activity]] as string[] | undefined;
    if (!allowed || allowed.length === 0) return true;
    if (!channelId) return false;
    return allowed.includes(channelId);
  }

  /**
   * If the channel is allowed for the activity, returns ok. Otherwise applies
   * the configured wrong-channel currency tax (capped at the participant's
   * current balance so we never go negative for normal users) and returns the
   * snarky message to surface to the user.
   */
  public async check(params: {
    guildId: string;
    config: GuildConfig;
    activity: GuardedActivity;
    channelId: string | null;
    participantId: string | null;
    actorUserId: string;
    actorUsername: string;
    currencyName: string;
    currencySymbol: string;
  }): Promise<ChannelGuardCheck> {
    if (this.allowsActivity(params.config, params.activity, params.channelId)) {
      return { ok: true, penaltyApplied: 0 };
    }

    const fullPenalty = decimalToNumber(params.config.wrongChannelPenalty);
    let appliedPenalty = 0;

    if (fullPenalty > 0 && params.participantId) {
      appliedPenalty = await this.prisma.$transaction(async (tx) => {
        const grouped = await tx.participantCurrencySplit.groupBy({
          by: ["participantId"],
          where: { participantId: params.participantId! },
          _sum: { currencyDelta: true },
        });
        const balance = decimalToNumber(grouped[0]?._sum.currencyDelta);
        const tax = Math.min(fullPenalty, Math.max(0, balance));
        if (tax <= 0) return 0;

        await tx.participantCurrencyEntry.create({
          data: {
            guildId: params.guildId,
            type: "WRONG_CHANNEL_TAX",
            description: `Wrong-channel tax (${params.activity})`,
            createdByUserId: params.actorUserId,
            createdByUsername: params.actorUsername,
            splits: {
              create: [{ participantId: params.participantId!, currencyDelta: decimal(-tax) }],
            },
          },
        });

        await this.auditService.record({
          guildId: params.guildId,
          actorUserId: params.actorUserId,
          actorUsername: params.actorUsername,
          action: "channel_guard.taxed",
          entityType: "Participant",
          entityId: params.participantId!,
          payload: {
            activity: params.activity,
            channelId: params.channelId,
            attemptedPenalty: fullPenalty,
            appliedPenalty: tax,
            balanceBefore: balance,
          },
          executor: tx,
        });

        return tax;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    const penaltyLabel =
      appliedPenalty > 0
        ? `${params.currencySymbol}${appliedPenalty} ${params.currencyName}`
        : "nothing this time (you're broke)";
    const message = SNARKY_MESSAGES[params.activity].replace("{penalty}", penaltyLabel);

    return { ok: false, penaltyApplied: appliedPenalty, message };
  }
}
