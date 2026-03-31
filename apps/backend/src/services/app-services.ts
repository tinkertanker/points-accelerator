import type { PrismaClient } from "@prisma/client";

import { AuditService } from "./audit-service.js";
import { ConfigService } from "./config-service.js";
import { EconomyService } from "./economy-service.js";
import { GroupService } from "./group-service.js";
import { ListingService } from "./listing-service.js";
import { RoleCapabilityService } from "./role-capability-service.js";
import { ShopService } from "./shop-service.js";

export type AppServices = ReturnType<typeof createServices>;

export function createServices(prisma: PrismaClient) {
  const configService = new ConfigService(prisma);
  const auditService = new AuditService(prisma);
  const roleCapabilityService = new RoleCapabilityService(prisma);
  const groupService = new GroupService(prisma);
  const economyService = new EconomyService(prisma, configService, groupService, roleCapabilityService, auditService);
  const shopService = new ShopService(prisma, economyService, auditService);
  const listingService = new ListingService(prisma, roleCapabilityService, auditService);

  return {
    prisma,
    configService,
    auditService,
    roleCapabilityService,
    groupService,
    economyService,
    shopService,
    listingService,
  };
}

