import { Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { AuditService } from "./audit-service.js";
import type { EconomyService } from "./economy-service.js";
import type { ParticipantCurrencyService } from "./participant-currency-service.js";

const REACTION_REWARD_AMOUNT_MODES = ["FIXED", "COUNT_MULTIPLIER"] as const;
type ReactionRewardAmountMode = (typeof REACTION_REWARD_AMOUNT_MODES)[number];
const REACTION_REWARD_PAYOUT_TARGETS = ["PARTICIPANT_CURRENCY", "GROUP_POINTS"] as const;
type ReactionRewardPayoutTarget = (typeof REACTION_REWARD_PAYOUT_TARGETS)[number];
const MAX_REACTION_REWARD_MAGNITUDE = 999_999_999_999;

export type ReactionRewardRuleInput = {
  channelId: string;
  botUserId: string;
  emoji: string;
  payoutTarget?: ReactionRewardPayoutTarget;
  currencyDelta?: number;
  pointsDelta?: number;
  amountMode?: ReactionRewardAmountMode;
  maxCurrencyDelta?: number | null;
  maxPointsDelta?: number | null;
  description?: string | null;
  enabled?: boolean;
};

export type ReactionRewardRuleDto = {
  id: string;
  guildId: string;
  channelId: string;
  botUserId: string;
  emoji: string;
  payoutTarget: ReactionRewardPayoutTarget;
  currencyDelta: number;
  pointsDelta: number;
  amountMode: ReactionRewardAmountMode;
  maxCurrencyDelta: number | null;
  maxPointsDelta: number | null;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function serialise(rule: Prisma.ReactionRewardRuleGetPayload<{}>): ReactionRewardRuleDto {
  return {
    id: rule.id,
    guildId: rule.guildId,
    channelId: rule.channelId,
    botUserId: rule.botUserId,
    emoji: rule.emoji,
    payoutTarget: rule.payoutTarget,
    currencyDelta: decimalToNumber(rule.currencyDelta),
    pointsDelta: decimalToNumber(rule.pointsDelta),
    amountMode: rule.amountMode,
    maxCurrencyDelta: rule.maxCurrencyDelta === null ? null : decimalToNumber(rule.maxCurrencyDelta),
    maxPointsDelta: rule.maxPointsDelta === null ? null : decimalToNumber(rule.maxPointsDelta),
    description: rule.description,
    enabled: rule.enabled,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

const CUSTOM_EMOJI_PATTERN = /^<a?:[^:]+:(\d{17,20})>$/;

function normaliseEmoji(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(CUSTOM_EMOJI_PATTERN);
  return match ? match[1] : trimmed;
}

type ExistingReactionRuleSettings = Pick<
  Prisma.ReactionRewardRuleGetPayload<{}>,
  | "payoutTarget"
  | "currencyDelta"
  | "pointsDelta"
  | "amountMode"
  | "maxCurrencyDelta"
  | "maxPointsDelta"
  | "description"
  | "enabled"
>;

function normaliseNonZeroDelta(value: number | undefined, label: string) {
  if (value === undefined || !Number.isFinite(value) || value === 0) {
    throw new AppError(`${label} must be a non-zero number.`);
  }
  if (Math.abs(value) > MAX_REACTION_REWARD_MAGNITUDE) {
    throw new AppError(`${label} is too large.`);
  }
  return value;
}

function normaliseInput(input: ReactionRewardRuleInput, existing?: ExistingReactionRuleSettings) {
  const channelId = input.channelId.trim();
  const botUserId = input.botUserId.trim();
  const emoji = normaliseEmoji(input.emoji);
  const description =
    input.description === undefined ? existing?.description ?? null : input.description?.trim() || null;
  const payoutTarget = input.payoutTarget ?? existing?.payoutTarget ?? "PARTICIPANT_CURRENCY";
  const amountMode = input.amountMode ?? existing?.amountMode ?? "FIXED";
  const currencyDelta =
    input.currencyDelta === undefined
      ? existing === undefined
        ? undefined
        : decimalToNumber(existing.currencyDelta)
      : input.currencyDelta;
  const pointsDelta =
    input.pointsDelta === undefined
      ? existing === undefined
        ? undefined
        : decimalToNumber(existing.pointsDelta)
      : input.pointsDelta;
  const maxCurrencyDelta =
    input.maxCurrencyDelta === undefined
      ? existing?.maxCurrencyDelta == null
        ? null
        : decimalToNumber(existing.maxCurrencyDelta)
      : input.maxCurrencyDelta;
  const maxPointsDelta =
    input.maxPointsDelta === undefined
      ? existing?.maxPointsDelta == null
        ? null
        : decimalToNumber(existing.maxPointsDelta)
      : input.maxPointsDelta;
  const enabled = input.enabled ?? existing?.enabled ?? true;

  if (!channelId) {
    throw new AppError("Channel ID is required.");
  }
  if (!botUserId) {
    throw new AppError("Bot user ID is required.");
  }
  if (!emoji) {
    throw new AppError("Emoji is required.");
  }
  if (!REACTION_REWARD_PAYOUT_TARGETS.includes(payoutTarget)) {
    throw new AppError("Reaction reward payout target is invalid.");
  }
  if (!REACTION_REWARD_AMOUNT_MODES.includes(amountMode)) {
    throw new AppError("Reaction reward amount mode is invalid.");
  }
  const normalisedCurrencyDelta =
    payoutTarget === "PARTICIPANT_CURRENCY" ? normaliseNonZeroDelta(currencyDelta, "Currency delta") : currencyDelta ?? 0;
  const normalisedPointsDelta =
    payoutTarget === "GROUP_POINTS" ? normaliseNonZeroDelta(pointsDelta, "Points delta") : pointsDelta ?? 0;
  if (maxCurrencyDelta !== null && (!Number.isFinite(maxCurrencyDelta) || maxCurrencyDelta <= 0)) {
    throw new AppError("Maximum payout must be a positive number.");
  }
  if (maxCurrencyDelta !== null && maxCurrencyDelta > MAX_REACTION_REWARD_MAGNITUDE) {
    throw new AppError("Maximum payout is too large.");
  }
  if (maxPointsDelta !== null && (!Number.isFinite(maxPointsDelta) || maxPointsDelta <= 0)) {
    throw new AppError("Maximum payout must be a positive number.");
  }
  if (maxPointsDelta !== null && maxPointsDelta > MAX_REACTION_REWARD_MAGNITUDE) {
    throw new AppError("Maximum payout is too large.");
  }
  if (amountMode === "COUNT_MULTIPLIER" && payoutTarget === "PARTICIPANT_CURRENCY" && maxCurrencyDelta === null) {
    throw new AppError("Maximum payout is required for count multiplier rules.");
  }
  if (amountMode === "COUNT_MULTIPLIER" && payoutTarget === "GROUP_POINTS" && maxPointsDelta === null) {
    throw new AppError("Maximum payout is required for count multiplier rules.");
  }

  return {
    channelId,
    botUserId,
    emoji,
    description,
    enabled,
    payoutTarget,
    currencyDelta: normalisedCurrencyDelta,
    pointsDelta: normalisedPointsDelta,
    amountMode,
    maxCurrencyDelta: payoutTarget === "PARTICIPANT_CURRENCY" ? maxCurrencyDelta : null,
    maxPointsDelta: payoutTarget === "GROUP_POINTS" ? maxPointsDelta : null,
  };
}

function parseCountedNumber(content: string): number | null {
  const firstToken = content.trim().split(/\s+/, 1)[0];
  if (!firstToken || !/^(?:[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(firstToken)) {
    return null;
  }

  const countedNumber = Number(firstToken.replaceAll(",", ""));
  if (!Number.isSafeInteger(countedNumber) || countedNumber <= 0) {
    return null;
  }
  return countedNumber;
}

function resolveRewardDelta(params: {
  amount: Prisma.Decimal | number;
  amountMode?: ReactionRewardAmountMode;
  maxAmount?: Prisma.Decimal | number | null;
  messageContent?: string;
}) {
  const baseDelta =
    typeof params.amount === "number"
      ? params.amount
      : decimalToNumber(params.amount);
  const maxAmount =
    params.maxAmount === null || params.maxAmount === undefined
      ? null
      : typeof params.maxAmount === "number"
        ? params.maxAmount
        : decimalToNumber(params.maxAmount);

  if (params.amountMode !== "COUNT_MULTIPLIER") {
    return { delta: baseDelta, countedNumber: null, wasCapped: false };
  }

  const countedNumber = parseCountedNumber(params.messageContent ?? "");
  if (countedNumber === null) {
    return { delta: 0, countedNumber: null, wasCapped: false };
  }

  if (maxAmount === null) {
    return { delta: 0, countedNumber, wasCapped: false };
  }

  const computedDelta = baseDelta * countedNumber;
  if (!Number.isFinite(computedDelta)) {
    return { delta: Math.sign(baseDelta) * maxAmount, countedNumber, wasCapped: true };
  }

  const magnitude = Math.abs(computedDelta);
  if (magnitude > maxAmount) {
    return { delta: Math.sign(computedDelta) * maxAmount, countedNumber, wasCapped: true };
  }

  return { delta: computedDelta, countedNumber, wasCapped: false };
}

export class ReactionRewardService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly participantCurrencyService: ParticipantCurrencyService,
    private readonly economyService: EconomyService,
    private readonly auditService: AuditService,
  ) {}

  public async list(guildId: string): Promise<ReactionRewardRuleDto[]> {
    const rules = await this.prisma.reactionRewardRule.findMany({
      where: { guildId },
      orderBy: [{ channelId: "asc" }, { createdAt: "asc" }],
    });
    return rules.map(serialise);
  }

  public async findApplicable(params: {
    guildId: string;
    channelId: string;
    botUserId: string;
    emoji: string;
  }) {
    const rule = await this.prisma.reactionRewardRule.findUnique({
      where: {
        guildId_channelId_botUserId_emoji: {
          guildId: params.guildId,
          channelId: params.channelId,
          botUserId: params.botUserId,
          emoji: params.emoji,
        },
      },
    });
    if (!rule || !rule.enabled) {
      return null;
    }
    return rule;
  }

  public async create(params: {
    guildId: string;
    actorUserId?: string;
    actorUsername?: string;
    input: ReactionRewardRuleInput;
  }): Promise<ReactionRewardRuleDto> {
    const data = normaliseInput(params.input);

    const created = await this.prisma.reactionRewardRule.create({
      data: {
        guildId: params.guildId,
        channelId: data.channelId,
        botUserId: data.botUserId,
        emoji: data.emoji,
        payoutTarget: data.payoutTarget,
        currencyDelta: decimal(data.currencyDelta),
        pointsDelta: decimal(data.pointsDelta),
        amountMode: data.amountMode,
        maxCurrencyDelta: data.maxCurrencyDelta === null ? null : decimal(data.maxCurrencyDelta),
        maxPointsDelta: data.maxPointsDelta === null ? null : decimal(data.maxPointsDelta),
        description: data.description,
        enabled: data.enabled,
      },
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("A rule for this channel, bot, and emoji already exists.", 409);
      }
      throw error;
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.actorUserId,
      actorUsername: params.actorUsername,
      action: "reaction_reward_rule.created",
      entityType: "ReactionRewardRule",
      entityId: created.id,
      payload: { ...data },
    });

    return serialise(created);
  }

  public async update(params: {
    guildId: string;
    actorUserId?: string;
    actorUsername?: string;
    id: string;
    input: ReactionRewardRuleInput;
  }): Promise<ReactionRewardRuleDto> {
    const existing = await this.prisma.reactionRewardRule.findFirst({
      where: { id: params.id, guildId: params.guildId },
    });
    if (!existing) {
      throw new AppError("Reaction reward rule not found.", 404);
    }

    const data = normaliseInput(params.input, existing);

    const updated = await this.prisma.reactionRewardRule
      .update({
        where: { id: params.id },
        data: {
          channelId: data.channelId,
          botUserId: data.botUserId,
          emoji: data.emoji,
          payoutTarget: data.payoutTarget,
          currencyDelta: decimal(data.currencyDelta),
          pointsDelta: decimal(data.pointsDelta),
          amountMode: data.amountMode,
          maxCurrencyDelta: data.maxCurrencyDelta === null ? null : decimal(data.maxCurrencyDelta),
          maxPointsDelta: data.maxPointsDelta === null ? null : decimal(data.maxPointsDelta),
          description: data.description,
          enabled: data.enabled,
        },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError("A rule for this channel, bot, and emoji already exists.", 409);
        }
        throw error;
      });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.actorUserId,
      actorUsername: params.actorUsername,
      action: "reaction_reward_rule.updated",
      entityType: "ReactionRewardRule",
      entityId: updated.id,
      payload: { ...data },
    });

    return serialise(updated);
  }

  public async remove(params: {
    guildId: string;
    actorUserId?: string;
    actorUsername?: string;
    id: string;
  }) {
    const existing = await this.prisma.reactionRewardRule.findFirst({
      where: { id: params.id, guildId: params.guildId },
    });
    if (!existing) {
      throw new AppError("Reaction reward rule not found.", 404);
    }

    await this.prisma.reactionRewardRule.delete({ where: { id: params.id } });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.actorUserId,
      actorUsername: params.actorUsername,
      action: "reaction_reward_rule.deleted",
      entityType: "ReactionRewardRule",
      entityId: params.id,
    });
  }

  public async applyReaction(params: {
    guildId: string;
    rule: {
      id: string;
      payoutTarget?: ReactionRewardPayoutTarget;
      currencyDelta: Prisma.Decimal | number;
      pointsDelta?: Prisma.Decimal | number;
      amountMode?: ReactionRewardAmountMode;
      maxCurrencyDelta?: Prisma.Decimal | number | null;
      maxPointsDelta?: Prisma.Decimal | number | null;
      emoji: string;
      botUserId: string;
    };
    participantId: string;
    groupId?: string;
    messageId: string;
    messageContent?: string;
    messageAuthorUserId: string;
    messageAuthorUsername?: string;
  }) {
    const payoutTarget = params.rule.payoutTarget ?? "PARTICIPANT_CURRENCY";
    const { delta, countedNumber, wasCapped } = resolveRewardDelta({
      amount:
        payoutTarget === "GROUP_POINTS"
          ? params.rule.pointsDelta ?? 0
          : params.rule.currencyDelta,
      amountMode: params.rule.amountMode,
      maxAmount:
        payoutTarget === "GROUP_POINTS"
          ? params.rule.maxPointsDelta
          : params.rule.maxCurrencyDelta,
      messageContent: params.messageContent,
    });
    if (delta === 0) {
      return null;
    }

    const externalRef = `reaction:${params.messageId}:${params.rule.botUserId}:${params.rule.emoji}`;

    const [previousCurrencyEntry, previousLedgerEntry] = await Promise.all([
      this.prisma.participantCurrencyEntry.findFirst({
        where: { guildId: params.guildId, externalRef },
      }),
      this.prisma.ledgerEntry.findFirst({
        where: { guildId: params.guildId, externalRef },
      }),
    ]);
    if (previousCurrencyEntry || previousLedgerEntry) {
      return null;
    }

    const description =
      countedNumber === null
        ? `Reaction reward (${params.rule.emoji})`
        : `Reaction reward (${params.rule.emoji}: count ${countedNumber}${wasCapped ? ", capped" : ""})`;

    if (payoutTarget === "GROUP_POINTS") {
      if (!params.groupId) {
        return null;
      }
      return this.economyService
        .awardGroups({
          guildId: params.guildId,
          actor: {
            userId: params.messageAuthorUserId,
            username: params.messageAuthorUsername,
            roleIds: [],
          },
          targetGroupIds: [params.groupId],
          pointsDelta: delta,
          currencyDelta: 0,
          description,
          type: "REACTION_REWARD",
          systemAction: true,
          externalRef,
        })
        .catch((error: unknown) => {
          if (error instanceof AppError && error.statusCode === 409) {
            return null;
          }
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return null;
          }
          throw error;
        });
    }

    return this.participantCurrencyService
      .awardParticipants({
        guildId: params.guildId,
        actor: {
          userId: params.messageAuthorUserId,
          username: params.messageAuthorUsername,
          roleIds: [],
        },
        targetParticipantIds: [params.participantId],
        currencyDelta: delta,
        description,
        type: "REACTION_REWARD",
        systemAction: true,
        externalRef,
      })
      .catch((error: unknown) => {
        if (error instanceof AppError && error.statusCode === 409) {
          return null;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return null;
        }
        throw error;
      });
  }
}
