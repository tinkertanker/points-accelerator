import { Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { AuditService } from "./audit-service.js";
import type { ParticipantCurrencyService } from "./participant-currency-service.js";

const REACTION_REWARD_AMOUNT_MODES = ["FIXED", "COUNT_MULTIPLIER"] as const;
type ReactionRewardAmountMode = (typeof REACTION_REWARD_AMOUNT_MODES)[number];
const MAX_REACTION_REWARD_MAGNITUDE = 999_999_999_999;

export type ReactionRewardRuleInput = {
  channelId: string;
  botUserId: string;
  emoji: string;
  currencyDelta: number;
  amountMode?: ReactionRewardAmountMode;
  maxCurrencyDelta?: number | null;
  description?: string | null;
  enabled?: boolean;
};

export type ReactionRewardRuleDto = {
  id: string;
  guildId: string;
  channelId: string;
  botUserId: string;
  emoji: string;
  currencyDelta: number;
  amountMode: ReactionRewardAmountMode;
  maxCurrencyDelta: number | null;
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
    currencyDelta: decimalToNumber(rule.currencyDelta),
    amountMode: rule.amountMode,
    maxCurrencyDelta: rule.maxCurrencyDelta === null ? null : decimalToNumber(rule.maxCurrencyDelta),
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
  "amountMode" | "maxCurrencyDelta" | "description" | "enabled"
>;

function normaliseInput(input: ReactionRewardRuleInput, existing?: ExistingReactionRuleSettings) {
  const channelId = input.channelId.trim();
  const botUserId = input.botUserId.trim();
  const emoji = normaliseEmoji(input.emoji);
  const description =
    input.description === undefined ? existing?.description ?? null : input.description?.trim() || null;
  const amountMode = input.amountMode ?? existing?.amountMode ?? "FIXED";
  const maxCurrencyDelta =
    input.maxCurrencyDelta === undefined
      ? existing?.maxCurrencyDelta == null
        ? null
        : decimalToNumber(existing.maxCurrencyDelta)
      : input.maxCurrencyDelta;
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
  if (!Number.isFinite(input.currencyDelta) || input.currencyDelta === 0) {
    throw new AppError("Currency delta must be a non-zero number.");
  }
  if (Math.abs(input.currencyDelta) > MAX_REACTION_REWARD_MAGNITUDE) {
    throw new AppError("Currency delta is too large.");
  }
  if (!REACTION_REWARD_AMOUNT_MODES.includes(amountMode)) {
    throw new AppError("Reaction reward amount mode is invalid.");
  }
  if (maxCurrencyDelta !== null && (!Number.isFinite(maxCurrencyDelta) || maxCurrencyDelta <= 0)) {
    throw new AppError("Maximum payout must be a positive number.");
  }
  if (maxCurrencyDelta !== null && maxCurrencyDelta > MAX_REACTION_REWARD_MAGNITUDE) {
    throw new AppError("Maximum payout is too large.");
  }
  if (amountMode === "COUNT_MULTIPLIER" && maxCurrencyDelta === null) {
    throw new AppError("Maximum payout is required for count multiplier rules.");
  }

  return {
    channelId,
    botUserId,
    emoji,
    description,
    enabled,
    currencyDelta: input.currencyDelta,
    amountMode,
    maxCurrencyDelta,
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

function resolveCurrencyDelta(params: {
  currencyDelta: Prisma.Decimal | number;
  amountMode?: ReactionRewardAmountMode;
  maxCurrencyDelta?: Prisma.Decimal | number | null;
  messageContent?: string;
}) {
  const baseDelta =
    typeof params.currencyDelta === "number"
      ? params.currencyDelta
      : decimalToNumber(params.currencyDelta);
  const maxCurrencyDelta =
    params.maxCurrencyDelta === null || params.maxCurrencyDelta === undefined
      ? null
      : typeof params.maxCurrencyDelta === "number"
        ? params.maxCurrencyDelta
        : decimalToNumber(params.maxCurrencyDelta);

  if (params.amountMode !== "COUNT_MULTIPLIER") {
    return { delta: baseDelta, countedNumber: null, wasCapped: false };
  }

  const countedNumber = parseCountedNumber(params.messageContent ?? "");
  if (countedNumber === null) {
    return { delta: 0, countedNumber: null, wasCapped: false };
  }

  if (maxCurrencyDelta === null) {
    return { delta: 0, countedNumber, wasCapped: false };
  }

  const computedDelta = baseDelta * countedNumber;
  if (!Number.isFinite(computedDelta)) {
    return { delta: Math.sign(baseDelta) * maxCurrencyDelta, countedNumber, wasCapped: true };
  }

  const magnitude = Math.abs(computedDelta);
  if (magnitude > maxCurrencyDelta) {
    return { delta: Math.sign(computedDelta) * maxCurrencyDelta, countedNumber, wasCapped: true };
  }

  return { delta: computedDelta, countedNumber, wasCapped: false };
}

export class ReactionRewardService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly participantCurrencyService: ParticipantCurrencyService,
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
        currencyDelta: decimal(data.currencyDelta),
        amountMode: data.amountMode,
        maxCurrencyDelta: data.maxCurrencyDelta === null ? null : decimal(data.maxCurrencyDelta),
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
          currencyDelta: decimal(data.currencyDelta),
          amountMode: data.amountMode,
          maxCurrencyDelta: data.maxCurrencyDelta === null ? null : decimal(data.maxCurrencyDelta),
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
      currencyDelta: Prisma.Decimal | number;
      amountMode?: ReactionRewardAmountMode;
      maxCurrencyDelta?: Prisma.Decimal | number | null;
      emoji: string;
      botUserId: string;
    };
    participantId: string;
    messageId: string;
    messageContent?: string;
    messageAuthorUserId: string;
    messageAuthorUsername?: string;
  }) {
    const { delta, countedNumber, wasCapped } = resolveCurrencyDelta({
      currencyDelta: params.rule.currencyDelta,
      amountMode: params.rule.amountMode,
      maxCurrencyDelta: params.rule.maxCurrencyDelta,
      messageContent: params.messageContent,
    });
    if (delta === 0) {
      return null;
    }

    const externalRef = `reaction:${params.messageId}:${params.rule.botUserId}:${params.rule.emoji}`;

    const previous = await this.prisma.participantCurrencyEntry.findFirst({
      where: { guildId: params.guildId, externalRef },
    });
    if (previous) {
      return null;
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
        description:
          countedNumber === null
            ? `Reaction reward (${params.rule.emoji})`
            : `Reaction reward (${params.rule.emoji}: count ${countedNumber}${wasCapped ? ", capped" : ""})`,
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
