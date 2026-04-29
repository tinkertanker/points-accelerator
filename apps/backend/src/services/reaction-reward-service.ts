import { Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { AuditService } from "./audit-service.js";
import type { ParticipantCurrencyService } from "./participant-currency-service.js";

export type ReactionRewardRuleInput = {
  channelId: string;
  botUserId: string;
  emoji: string;
  currencyDelta: number;
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

function normaliseInput(input: ReactionRewardRuleInput) {
  const channelId = input.channelId.trim();
  const botUserId = input.botUserId.trim();
  const emoji = normaliseEmoji(input.emoji);
  const description = input.description?.trim() || null;

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

  return {
    channelId,
    botUserId,
    emoji,
    description,
    enabled: input.enabled ?? true,
    currencyDelta: input.currencyDelta,
  };
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

    const data = normaliseInput(params.input);

    const updated = await this.prisma.reactionRewardRule
      .update({
        where: { id: params.id },
        data: {
          channelId: data.channelId,
          botUserId: data.botUserId,
          emoji: data.emoji,
          currencyDelta: decimal(data.currencyDelta),
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
    rule: { id: string; currencyDelta: Prisma.Decimal | number; emoji: string; botUserId: string };
    participantId: string;
    messageId: string;
    messageAuthorUserId: string;
    messageAuthorUsername?: string;
  }) {
    const delta =
      typeof params.rule.currencyDelta === "number"
        ? params.rule.currencyDelta
        : decimalToNumber(params.rule.currencyDelta);
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
        description: `Reaction reward (${params.rule.emoji})`,
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
