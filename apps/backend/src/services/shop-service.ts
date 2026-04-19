import { Prisma, type PrismaClient, type ShopItemAudience, type ShopRedemption } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { AuditService } from "./audit-service.js";
import type { EconomyService } from "./economy-service.js";
import type { ParticipantCurrencyService } from "./participant-currency-service.js";

export const DEFAULT_SHOP_ITEM_EMOJI = "💸";

export type ShopItemInput = {
  id?: string;
  name: string;
  description: string;
  audience: ShopItemAudience;
  cost: number;
  stock: number | null;
  enabled: boolean;
  fulfillmentInstructions?: string | null;
  emoji?: string | null;
  ownerUserId?: string | null;
  ownerUsername?: string | null;
};

type PurchaseMode = "INDIVIDUAL" | "GROUP";
type ManagedRedemptionStatus = "FULFILLED" | "CANCELED";
type GroupApprovalParticipant = {
  id: string;
  discordUserId: string | null;
  discordUsername: string | null;
  indexId: string;
};

type GroupPurchaseApproval = {
  participant: GroupApprovalParticipant;
};

type GroupPurchaseRedemption = ShopRedemption & {
  shopItem: {
    id: string;
    guildId: string;
    name: string;
    enabled: boolean;
    stock: number | null;
    audience: ShopItemAudience;
    cost: Prisma.Decimal;
    fulfillmentInstructions: string | null;
    emoji: string;
    ownerUserId: string | null;
    ownerUsername: string | null;
  };
  group: {
    id: string;
    displayName: string;
    roleId: string;
    guildId: string;
    slug: string;
    mentorName: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  approvals: GroupPurchaseApproval[];
};

const redemptionInclude = {
  shopItem: true,
  group: true,
  requestedByParticipant: {
    select: {
      id: true,
      discordUserId: true,
      discordUsername: true,
      indexId: true,
    },
  },
  approvals: {
    include: {
      participant: {
        select: {
          id: true,
          discordUserId: true,
          discordUsername: true,
          indexId: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.ShopRedemptionInclude;

type FullRedemption = Prisma.ShopRedemptionGetPayload<{ include: typeof redemptionInclude }>;

export class ShopService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly economyService: EconomyService,
    private readonly participantCurrencyService: ParticipantCurrencyService,
    private readonly auditService: AuditService,
  ) {}

  public async list(guildId: string) {
    return this.prisma.shopItem.findMany({
      where: { guildId },
      orderBy: { name: "asc" },
    });
  }

  public async upsert(guildId: string, input: ShopItemInput) {
    const ownerUserId = input.ownerUserId?.trim() ? input.ownerUserId.trim() : null;
    const ownerUsername = input.ownerUsername?.trim() ? input.ownerUsername.trim() : null;
    const emoji = input.emoji?.trim() ? input.emoji.trim() : DEFAULT_SHOP_ITEM_EMOJI;

    const item = input.id
      ? await this.prisma.shopItem.update({
          where: { id: input.id },
          data: {
            name: input.name,
            description: input.description,
            audience: input.audience,
            cost: decimal(input.cost),
            stock: input.stock,
            enabled: input.enabled,
            fulfillmentInstructions: input.fulfillmentInstructions ?? null,
            emoji,
            ownerUserId,
            ownerUsername,
          },
        })
      : await this.prisma.shopItem.create({
          data: {
            guildId,
            name: input.name,
            description: input.description,
            audience: input.audience,
            cost: decimal(input.cost),
            stock: input.stock,
            enabled: input.enabled,
            fulfillmentInstructions: input.fulfillmentInstructions ?? null,
            emoji,
            ownerUserId,
            ownerUsername,
          },
        });

    await this.auditService.record({
      guildId,
      action: "shop.item.saved",
      entityType: "ShopItem",
      entityId: item.id,
      payload: input,
    });

    return item;
  }

  public async redeem(params: {
    guildId: string;
    participantId: string;
    shopItemId: string;
    requestedByUserId: string;
    requestedByUsername?: string;
    quantity?: number;
    purchaseMode?: PurchaseMode;
    groupMemberCount?: number;
  }) {
    const purchaseMode = params.purchaseMode ?? "INDIVIDUAL";

    if (purchaseMode === "GROUP") {
      return this.createGroupPurchaseRequest(params);
    }

    return this.redeemIndividual(params);
  }

  public async approveGroupPurchase(params: {
    guildId: string;
    redemptionId: string;
    participantId: string;
    approvedByUserId: string;
    approvedByUsername?: string;
    currentGroupMemberCount?: number;
    currentGroupMemberDiscordUserIds?: string[];
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockRedemption(tx, params.guildId, params.redemptionId);

      const redemption = await tx.shopRedemption.findUnique({
        where: { id: params.redemptionId },
        include: {
          shopItem: true,
          group: true,
          approvals: {
            include: {
              participant: {
                select: {
                  id: true,
                  discordUserId: true,
                  discordUsername: true,
                  indexId: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!redemption || redemption.guildId !== params.guildId) {
        throw new AppError("Group purchase request not found.", 404);
      }

      if (redemption.purchaseMode !== "GROUP") {
        throw new AppError("This redemption is not a group purchase request.", 409);
      }

      if (redemption.status !== "AWAITING_APPROVAL") {
        return {
          redemption,
          executed: redemption.status === "PENDING",
          justExecuted: false,
          approvalsCount: redemption.approvals.length,
          threshold: redemption.approvalThreshold ?? 1,
        };
      }

      const participant = await tx.participant.findFirst({
        where: { id: params.participantId, guildId: params.guildId },
      });

      if (!participant) {
        throw new AppError("Participant not found.", 404);
      }

      if (participant.groupId !== redemption.groupId) {
        throw new AppError("Only members of the same group can approve this purchase.", 403);
      }

      const existingApproval = await tx.shopRedemptionApproval.findUnique({
        where: {
          redemptionId_participantId: {
            redemptionId: params.redemptionId,
            participantId: params.participantId,
          },
        },
      });

      if (!existingApproval) {
        await tx.shopRedemptionApproval.create({
          data: {
            redemptionId: params.redemptionId,
            participantId: params.participantId,
          },
        });
      }

      const approvals = await tx.shopRedemptionApproval.findMany({
        where: { redemptionId: params.redemptionId },
        include: {
          participant: {
            select: {
              id: true,
              discordUserId: true,
              discordUsername: true,
              indexId: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });
      const currentMemberIds = new Set(params.currentGroupMemberDiscordUserIds ?? []);
      const eligibleApprovals =
        currentMemberIds.size > 0
          ? approvals.filter((approval) => approval.participant.discordUserId && currentMemberIds.has(approval.participant.discordUserId))
          : approvals;

      if (!params.currentGroupMemberCount || params.currentGroupMemberCount <= 0) {
        throw new AppError("Group purchases require the current Discord group membership count.", 409);
      }

      const threshold = this.getApprovalThreshold(params.currentGroupMemberCount);

      if (threshold !== redemption.approvalThreshold) {
        await tx.shopRedemption.update({
          where: { id: redemption.id },
          data: {
            approvalThreshold: threshold,
          },
        });
      }

      if (eligibleApprovals.length < threshold) {
        return {
          redemption: {
            ...redemption,
            approvals: eligibleApprovals,
          },
          executed: false,
          justExecuted: false,
          approvalsCount: eligibleApprovals.length,
          threshold,
        };
      }

      const executedPurchase = await this.executeGroupPurchase({
        tx,
        guildId: params.guildId,
        redemption,
        approvals: eligibleApprovals,
        threshold,
        actorUserId: params.approvedByUserId,
        actorUsername: params.approvedByUsername,
      });

      return {
        ...executedPurchase,
        justExecuted: executedPurchase.executed,
      };
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.approvedByUserId,
      actorUsername: params.approvedByUsername,
      action: result.executed ? "shop.group_purchase.approved" : "shop.group_purchase.vote.recorded",
      entityType: "ShopRedemption",
      entityId: result.redemption.id,
      payload: {
        approvalsCount: result.approvalsCount,
        threshold: result.threshold,
        executed: result.executed,
        blockingGroup: "blockingGroup" in result ? result.blockingGroup : undefined,
      },
    });

    return result;
  }

  public async setApprovalMessage(params: {
    guildId: string;
    redemptionId: string;
    channelId: string;
    messageId: string;
  }) {
    return this.prisma.shopRedemption.updateMany({
      where: {
        id: params.redemptionId,
        guildId: params.guildId,
        purchaseMode: "GROUP",
      },
      data: {
        approvalMessageChannelId: params.channelId,
        approvalMessageId: params.messageId,
      },
    });
  }

  public async setFulfilmentMessage(params: {
    guildId: string;
    redemptionId: string;
    channelId: string;
    messageId: string;
  }) {
    return this.prisma.shopRedemption.updateMany({
      where: {
        id: params.redemptionId,
        guildId: params.guildId,
      },
      data: {
        fulfilmentMessageChannelId: params.channelId,
        fulfilmentMessageId: params.messageId,
      },
    });
  }

  public async getRedemption(guildId: string, redemptionId: string) {
    return this.prisma.shopRedemption.findFirst({
      where: { id: redemptionId, guildId },
      include: redemptionInclude,
    });
  }

  public async listRedemptions(guildId: string) {
    return this.prisma.shopRedemption.findMany({
      where: { guildId },
      include: redemptionInclude,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
  }

  public async updateRedemptionStatus(params: {
    guildId: string;
    redemptionId: string;
    status: ManagedRedemptionStatus;
    actorUserId: string;
    actorUsername?: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockRedemption(tx, params.guildId, params.redemptionId);

      const redemption = await tx.shopRedemption.findUnique({
        where: { id: params.redemptionId },
        include: redemptionInclude,
      });

      if (!redemption || redemption.guildId !== params.guildId) {
        throw new AppError("Shop redemption not found.", 404);
      }

      if (redemption.status === params.status) {
        return {
          changed: false,
          refunded: false,
          previousStatus: redemption.status,
          redemption,
        };
      }

      if (params.status === "FULFILLED") {
        if (redemption.status !== "PENDING") {
          throw new AppError("Only funded purchases pending fulfilment can be marked fulfilled.", 409);
        }
      }

      let refunded = false;
      if (params.status === "CANCELED") {
        if (redemption.status === "FULFILLED") {
          throw new AppError("Fulfilled purchases cannot be canceled.", 409);
        }

        if (redemption.status !== "PENDING" && redemption.status !== "AWAITING_APPROVAL") {
          throw new AppError("Only open purchases can be canceled.", 409);
        }

        if (redemption.status === "PENDING") {
          await this.refundRedemption({
            tx,
            guildId: params.guildId,
            redemption,
            actorUserId: params.actorUserId,
            actorUsername: params.actorUsername,
          });
          refunded = true;
        }
      }

      const updatedRedemption = await tx.shopRedemption.update({
        where: { id: params.redemptionId },
        data: { status: params.status },
        include: redemptionInclude,
      });

      return {
        changed: true,
        refunded,
        previousStatus: redemption.status,
        redemption: updatedRedemption,
      };
    });

    if (result.changed) {
      await this.auditService.record({
        guildId: params.guildId,
        actorUserId: params.actorUserId,
        actorUsername: params.actorUsername,
        action: params.status === "FULFILLED" ? "shop.redemption.fulfilled" : "shop.redemption.canceled",
        entityType: "ShopRedemption",
        entityId: result.redemption.id,
        payload: {
          previousStatus: result.previousStatus,
          status: result.redemption.status,
          purchaseMode: result.redemption.purchaseMode,
          quantity: result.redemption.quantity,
          totalCost: decimalToNumber(result.redemption.totalCost),
          refunded: result.refunded,
        },
      });
    }

    return {
      redemption: result.redemption,
      changed: result.changed,
      previousStatus: result.previousStatus,
      refunded: result.refunded,
    };
  }

  private async refundRedemption(params: {
    tx: Prisma.TransactionClient;
    guildId: string;
    redemption: FullRedemption;
    actorUserId: string;
    actorUsername?: string;
  }) {
    const { tx, redemption } = params;
    const totalCost = decimalToNumber(redemption.totalCost);

    if (totalCost > 0) {
      if (redemption.purchaseMode === "INDIVIDUAL") {
        if (!redemption.requestedByParticipantId) {
          throw new AppError("Cannot refund: original participant is missing.", 409);
        }

        await this.participantCurrencyService.recordEntry({
          guildId: params.guildId,
          actor: {
            userId: params.actorUserId,
            username: params.actorUsername,
            roleIds: [],
          },
          type: "CORRECTION",
          description: `Refund: ${redemption.shopItem.name} (cancelled redemption ${redemption.id})`,
          splits: [{ participantId: redemption.requestedByParticipantId, currencyDelta: totalCost }],
          systemAction: true,
          executor: tx,
          externalRef: redemption.id,
          auditAction: "shop.redemption.refunded",
          auditPayload: {
            redemptionId: redemption.id,
            participantId: redemption.requestedByParticipantId,
            amount: totalCost,
          },
        });
      } else {
        await this.economyService.awardGroups({
          guildId: params.guildId,
          actor: {
            userId: params.actorUserId,
            username: params.actorUsername,
            roleIds: [],
          },
          type: "CORRECTION",
          description: `Refund: group purchase ${redemption.shopItem.name} (cancelled redemption ${redemption.id})`,
          targetGroupIds: [redemption.groupId],
          pointsDelta: totalCost,
          currencyDelta: 0,
          systemAction: true,
          executor: tx,
          externalRef: redemption.id,
        });
      }
    }

    // Restore exactly what was held back at redemption time. For legacy
    // rows without `stockHeld`, fall back to inferring from the current item
    // configuration (best effort — see migration add_redemption_stock_held).
    const stockToRestore =
      redemption.stockHeld ?? (redemption.shopItem.stock !== null ? redemption.quantity : 0);
    if (stockToRestore > 0 && redemption.shopItem.stock !== null) {
      await tx.shopItem.update({
        where: { id: redemption.shopItemId },
        data: { stock: { increment: stockToRestore } },
      });
    }
  }

  private async redeemIndividual(params: {
    guildId: string;
    participantId: string;
    shopItemId: string;
    requestedByUserId: string;
    requestedByUsername?: string;
    quantity?: number;
  }) {
    const quantity = params.quantity ?? 1;

    if (quantity <= 0) {
      throw new AppError("Quantity must be greater than zero.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockParticipant(tx, params.guildId, params.participantId);
      await this.lockShopItem(tx, params.guildId, params.shopItemId);

      const [item, participant] = await Promise.all([
        tx.shopItem.findUnique({
          where: { id: params.shopItemId },
        }),
        tx.participant.findUnique({
          where: { id: params.participantId },
        }),
      ]);

      if (!item || item.guildId !== params.guildId) {
        throw new AppError("Shop item not found.", 404);
      }

      if (!participant || participant.guildId !== params.guildId) {
        throw new AppError("Participant not found.", 404);
      }

      if (!item.enabled) {
        throw new AppError("This item is disabled.", 409);
      }

      if (item.stock !== null && item.stock < quantity) {
        throw new AppError("Not enough stock available.", 409);
      }

      if (item.audience !== "INDIVIDUAL") {
        throw new AppError("This item can only be purchased with /buyforme.", 409);
      }

      const totalCost = decimalToNumber(item.cost) * quantity;
      const participantBalance = await this.getParticipantCurrencyBalance(tx, participant.id);
      if (participantBalance < totalCost) {
        throw new AppError("You do not have enough currency.", 409);
      }

      const redemption = await tx.shopRedemption.create({
        data: {
          guildId: params.guildId,
          shopItemId: params.shopItemId,
          groupId: participant.groupId,
          requestedByParticipantId: participant.id,
          requestedByUserId: params.requestedByUserId,
          requestedByUsername: params.requestedByUsername,
          purchaseMode: "INDIVIDUAL",
          quantity,
          totalCost: decimal(totalCost),
          status: "PENDING",
        },
      });

      const currencyEntry = await this.participantCurrencyService.recordEntry({
        guildId: params.guildId,
        actor: {
          userId: params.requestedByUserId,
          username: params.requestedByUsername,
          roleIds: [],
        },
        type: "SHOP_REDEMPTION",
        description: `Shop redemption: ${item.name}`,
        splits: [{ participantId: participant.id, currencyDelta: -totalCost }],
        systemAction: true,
        executor: tx,
        externalRef: redemption.id,
        auditAction: "shop.item.redeemed",
        auditPayload: {
          shopItemId: params.shopItemId,
          participantId: participant.id,
          quantity,
          totalCost,
        },
      });

      const stockHeld = item.stock !== null ? quantity : 0;
      if (stockHeld > 0) {
        await tx.shopItem.update({
          where: { id: item.id },
          data: {
            stock: item.stock! - quantity,
          },
        });
      }

      return tx.shopRedemption.update({
        where: { id: redemption.id },
        data: {
          currencyEntryId: currencyEntry.id,
          stockHeld,
        },
        include: {
          shopItem: true,
          group: true,
          requestedByParticipant: {
            select: {
              id: true,
              discordUserId: true,
              discordUsername: true,
              indexId: true,
            },
          },
          approvals: true,
        },
      });
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.requestedByUserId,
      actorUsername: params.requestedByUsername,
      action: "shop.item.redeem.completed",
      entityType: "ShopRedemption",
      entityId: result.id,
      payload: {
        purchaseMode: "INDIVIDUAL",
        quantity: result.quantity,
        totalCost: decimalToNumber(result.totalCost),
      },
    });

    return result;
  }

  private async createGroupPurchaseRequest(params: {
    guildId: string;
    participantId: string;
    shopItemId: string;
    requestedByUserId: string;
    requestedByUsername?: string;
    quantity?: number;
    groupMemberCount?: number;
  }) {
    const quantity = params.quantity ?? 1;
    const groupMemberCount = params.groupMemberCount;

    if (quantity <= 0) {
      throw new AppError("Quantity must be greater than zero.");
    }

    if (!groupMemberCount || groupMemberCount <= 0) {
      throw new AppError("Group purchases require the current Discord group membership count.", 409);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [item, participant] = await Promise.all([
        tx.shopItem.findUnique({
          where: { id: params.shopItemId },
        }),
        tx.participant.findUnique({
          where: { id: params.participantId },
        }),
      ]);

      if (!item || item.guildId !== params.guildId) {
        throw new AppError("Shop item not found.", 404);
      }

      if (!participant || participant.guildId !== params.guildId) {
        throw new AppError("Participant not found.", 404);
      }

      if (!item.enabled) {
        throw new AppError("This item is disabled.", 409);
      }

      if (item.stock !== null && item.stock < quantity) {
        throw new AppError("Not enough stock available.", 409);
      }

      const approvalThreshold = this.getApprovalThreshold(groupMemberCount);
      if (item.audience !== "GROUP") {
        throw new AppError("This item can only be purchased with /buyforgroup.", 409);
      }

      const totalCost = decimalToNumber(item.cost) * quantity;

      const redemption = await tx.shopRedemption.create({
        data: {
          guildId: params.guildId,
          shopItemId: item.id,
          groupId: participant.groupId,
          requestedByParticipantId: participant.id,
          requestedByUserId: params.requestedByUserId,
          requestedByUsername: params.requestedByUsername,
          purchaseMode: "GROUP",
          quantity,
          totalCost: decimal(totalCost),
          approvalThreshold,
          status: "AWAITING_APPROVAL",
          approvals: {
            create: {
              participantId: participant.id,
            },
          },
        },
        include: {
          shopItem: true,
          group: true,
          requestedByParticipant: {
            select: {
              id: true,
              discordUserId: true,
              discordUsername: true,
              indexId: true,
            },
          },
          approvals: {
            include: {
              participant: {
                select: {
                  id: true,
                  discordUserId: true,
                  discordUsername: true,
                  indexId: true,
                },
              },
            },
          },
        },
      });

      if (redemption.approvals.length < approvalThreshold) {
        return {
          ...redemption,
          requiredApprovals: approvalThreshold,
        };
      }

      const executedPurchase = await this.executeGroupPurchase({
        tx,
        guildId: params.guildId,
        redemption,
        approvals: redemption.approvals,
        threshold: approvalThreshold,
        actorUserId: params.requestedByUserId,
        actorUsername: params.requestedByUsername,
      });

      return {
        ...executedPurchase.redemption,
        requiredApprovals: approvalThreshold,
      };
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.requestedByUserId,
      actorUsername: params.requestedByUsername,
      action: "shop.group_purchase.requested",
      entityType: "ShopRedemption",
      entityId: result.id,
      payload: {
        quantity: result.quantity,
        totalCost: decimalToNumber(result.totalCost),
        approvalThreshold: result.requiredApprovals,
        status: result.status,
      },
    });

    return result;
  }

  private getApprovalThreshold(groupMembers: number) {
    return Math.max(1, Math.ceil(groupMembers / 2));
  }

  private async executeGroupPurchase(params: {
    tx: Prisma.TransactionClient;
    guildId: string;
    redemption: GroupPurchaseRedemption;
    approvals: GroupPurchaseApproval[];
    threshold: number;
    actorUserId: string;
    actorUsername?: string;
  }) {
    await this.lockShopItem(params.tx, params.guildId, params.redemption.shopItemId);

    const item = await params.tx.shopItem.findUnique({
      where: { id: params.redemption.shopItemId },
    });
    if (!item || item.guildId !== params.guildId) {
      throw new AppError("Shop item not found.", 404);
    }

    if (!item.enabled) {
      throw new AppError("This item is disabled.", 409);
    }

    if (item.stock !== null && item.stock < params.redemption.quantity) {
      throw new AppError("Not enough stock available.", 409);
    }

    if (item.audience !== "GROUP") {
      throw new AppError("Only group shop items can be approved through group purchases.", 409);
    }

    const totalCost = decimalToNumber(params.redemption.totalCost);
    const groupBalance = await this.getGroupPointsBalance(params.tx, params.redemption.groupId);
    if (groupBalance < totalCost) {
      return {
        redemption: {
          ...params.redemption,
          approvals: params.approvals,
        },
        executed: false,
        approvalsCount: params.approvals.length,
        threshold: params.threshold,
        blockingGroup: params.redemption.group.displayName,
      };
    }

    const ledgerEntry = await this.economyService.awardGroups({
      guildId: params.guildId,
      actor: {
        userId: params.actorUserId,
        username: params.actorUsername,
        roleIds: [],
      },
      type: "SHOP_REDEMPTION",
      description: `Group shop redemption: ${item.name}`,
      targetGroupIds: [params.redemption.groupId],
      pointsDelta: -totalCost,
      currencyDelta: 0,
      systemAction: true,
      executor: params.tx,
      externalRef: params.redemption.id,
    });

    const stockHeld = item.stock !== null ? params.redemption.quantity : 0;
    if (stockHeld > 0) {
      await params.tx.shopItem.update({
        where: { id: item.id },
        data: {
          stock: item.stock! - params.redemption.quantity,
        },
      });
    }

    const updatedRedemption = await params.tx.shopRedemption.update({
      where: { id: params.redemption.id },
      data: {
        status: "PENDING",
        ledgerEntryId: ledgerEntry.id,
        stockHeld,
      },
      include: {
        shopItem: true,
        group: true,
        approvals: {
          include: {
            participant: {
              select: {
                id: true,
                discordUserId: true,
                discordUsername: true,
                indexId: true,
              },
            },
          },
          where: {
            participant: {
              discordUserId: {
                in: params.approvals.flatMap((approval) => approval.participant.discordUserId ?? []),
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return {
      redemption: updatedRedemption,
      executed: true,
      approvalsCount: params.approvals.length,
      threshold: params.threshold,
    };
  }

  private async getParticipantCurrencyBalance(tx: Prisma.TransactionClient, participantId: string) {
    const balances = await this.getParticipantCurrencyBalances(tx, [participantId]);
    return balances[participantId] ?? 0;
  }

  private async getGroupPointsBalance(tx: Prisma.TransactionClient, groupId: string) {
    const grouped = await tx.ledgerSplit.groupBy({
      by: ["groupId"],
      where: {
        groupId,
      },
      _sum: {
        pointsDelta: true,
      },
    });

    return decimalToNumber(grouped[0]?._sum.pointsDelta);
  }

  private async getParticipantCurrencyBalances(tx: Prisma.TransactionClient, participantIds: string[]) {
    const grouped = await tx.participantCurrencySplit.groupBy({
      by: ["participantId"],
      where: {
        participantId: {
          in: participantIds,
        },
      },
      _sum: {
        currencyDelta: true,
      },
    });

    return Object.fromEntries(grouped.map((row) => [row.participantId, decimalToNumber(row._sum.currencyDelta)]));
  }

  private async lockParticipant(tx: Prisma.TransactionClient, guildId: string, participantId: string) {
    const lockedParticipants = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM "Participant"
      WHERE "guildId" = ${guildId}
        AND id = ${participantId}
      FOR UPDATE
    `);

    if (lockedParticipants.length === 0) {
      throw new AppError("Participant not found.", 404);
    }
  }

  private async lockRedemption(tx: Prisma.TransactionClient, guildId: string, redemptionId: string) {
    const lockedRedemptions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM "ShopRedemption"
      WHERE "guildId" = ${guildId}
        AND id = ${redemptionId}
      FOR UPDATE
    `);

    if (lockedRedemptions.length === 0) {
      throw new AppError("Group purchase request not found.", 404);
    }
  }

  private async lockShopItem(tx: Prisma.TransactionClient, guildId: string, shopItemId: string) {
    const lockedItems = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM "ShopItem"
      WHERE "guildId" = ${guildId}
        AND id = ${shopItemId}
      FOR UPDATE
    `);

    if (lockedItems.length === 0) {
      throw new AppError("Shop item not found.", 404);
    }
  }
}
