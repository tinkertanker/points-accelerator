import { Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";
import type { AuditService } from "./audit-service.js";
import type { EconomyService } from "./economy-service.js";

export type ShopItemInput = {
  id?: string;
  name: string;
  description: string;
  currencyCost: number;
  stock: number | null;
  enabled: boolean;
  fulfillmentInstructions?: string | null;
};

export class ShopService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly economyService: EconomyService,
    private readonly auditService: AuditService,
  ) {}

  public async list(guildId: string) {
    return this.prisma.shopItem.findMany({
      where: { guildId },
      orderBy: { name: "asc" },
    });
  }

  public async upsert(guildId: string, input: ShopItemInput) {
    const item = input.id
      ? await this.prisma.shopItem.update({
          where: { id: input.id },
          data: {
            name: input.name,
            description: input.description,
            currencyCost: decimal(input.currencyCost),
            stock: input.stock,
            enabled: input.enabled,
            fulfillmentInstructions: input.fulfillmentInstructions ?? null,
          },
        })
      : await this.prisma.shopItem.create({
          data: {
            guildId,
            name: input.name,
            description: input.description,
            currencyCost: decimal(input.currencyCost),
            stock: input.stock,
            enabled: input.enabled,
            fulfillmentInstructions: input.fulfillmentInstructions ?? null,
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
    groupId: string;
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
      await this.lockGroup(tx, params.guildId, params.groupId);
      await this.lockShopItem(tx, params.guildId, params.shopItemId);

      const item = await tx.shopItem.findUnique({
        where: { id: params.shopItemId },
      });
      if (!item || item.guildId !== params.guildId) {
        throw new AppError("Shop item not found.", 404);
      }

      if (!item.enabled) {
        throw new AppError("This item is disabled.", 409);
      }

      if (item.stock !== null && item.stock < quantity) {
        throw new AppError("Not enough stock available.", 409);
      }

      const totalCurrencyCost = decimalToNumber(item.currencyCost) * quantity;
      const groupBalance = await this.getGroupCurrencyBalance(tx, params.groupId);
      if (groupBalance < totalCurrencyCost) {
        throw new AppError("Group does not have enough currency.", 409);
      }

      const redemption = await tx.shopRedemption.create({
        data: {
          guildId: params.guildId,
          shopItemId: params.shopItemId,
          groupId: params.groupId,
          requestedByUserId: params.requestedByUserId,
          requestedByUsername: params.requestedByUsername,
          quantity,
          totalCurrencyCost: decimal(totalCurrencyCost),
          status: "PENDING",
        },
      });

      await tx.ledgerEntry.create({
        data: {
          guildId: params.guildId,
          type: "SHOP_REDEMPTION",
          description: `Shop redemption: ${item.name}`,
          createdByUserId: params.requestedByUserId,
          createdByUsername: params.requestedByUsername,
          externalRef: redemption.id,
          splits: {
            create: {
              groupId: params.groupId,
              pointsDelta: decimal(0),
              currencyDelta: decimal(-totalCurrencyCost),
            },
          },
        },
      });

      if (item.stock !== null) {
        await tx.shopItem.update({
          where: { id: item.id },
          data: {
            stock: item.stock - quantity,
          },
        });
      }

      return {
        redemption,
        totalCurrencyCost,
      };
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.requestedByUserId,
      actorUsername: params.requestedByUsername,
      action: "shop.item.redeemed",
      entityType: "ShopRedemption",
      entityId: result.redemption.id,
      payload: {
        shopItemId: params.shopItemId,
        groupId: params.groupId,
        quantity,
        totalCurrencyCost: result.totalCurrencyCost,
      },
    });

    return result.redemption;
  }

  private async lockGroup(tx: Prisma.TransactionClient, guildId: string, groupId: string) {
    const lockedGroups = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM "Group"
      WHERE "guildId" = ${guildId}
        AND id = ${groupId}
      FOR UPDATE
    `);

    if (lockedGroups.length === 0) {
      throw new AppError("Group not found.", 404);
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

  private async getGroupCurrencyBalance(tx: Prisma.TransactionClient, groupId: string) {
    const [balanceRow] = await tx.ledgerSplit.groupBy({
      by: ["groupId"],
      where: {
        groupId,
      },
      _sum: {
        currencyDelta: true,
      },
    });

    return decimalToNumber(balanceRow?._sum.currencyDelta);
  }
}
