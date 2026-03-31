import type { PrismaClient } from "@prisma/client";

import { assertCanSell, resolveCapabilities } from "../domain/permissions.js";
import type { RoleCapabilityService } from "./role-capability-service.js";
import type { AuditService } from "./audit-service.js";

export class ListingService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly roleCapabilityService: RoleCapabilityService,
    private readonly auditService: AuditService,
  ) {}

  public async list(guildId: string) {
    return this.prisma.marketplaceListing.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
    });
  }

  public async create(params: {
    guildId: string;
    actor: {
      userId: string;
      username?: string;
      roleIds: string[];
    };
    title: string;
    description: string;
    quantity?: number | null;
    channelId?: string | null;
    messageId?: string | null;
  }) {
    const capabilities = await this.roleCapabilityService.listForRoleIds(params.guildId, params.actor.roleIds);
    assertCanSell(resolveCapabilities(capabilities));

    const listing = await this.prisma.marketplaceListing.create({
      data: {
        guildId: params.guildId,
        title: params.title,
        description: params.description,
        quantity: params.quantity ?? null,
        createdByUserId: params.actor.userId,
        createdByUsername: params.actor.username,
        channelId: params.channelId ?? null,
        messageId: params.messageId ?? null,
      },
    });

    await this.auditService.record({
      guildId: params.guildId,
      actorUserId: params.actor.userId,
      actorUsername: params.actor.username,
      action: "listing.created",
      entityType: "MarketplaceListing",
      entityId: listing.id,
      payload: {
        title: params.title,
        quantity: params.quantity ?? null,
      },
    });

    return listing;
  }
}

