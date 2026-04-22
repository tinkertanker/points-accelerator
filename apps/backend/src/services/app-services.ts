import type { PrismaClient } from "@prisma/client";

import { AssignmentService } from "./assignment-service.js";
import { AuditService } from "./audit-service.js";
import { BettingService } from "./betting-service.js";
import { ConfigService } from "./config-service.js";
import { EconomyService } from "./economy-service.js";
import { GroupService } from "./group-service.js";
import { ListingService } from "./listing-service.js";
import { ParticipantService } from "./participant-service.js";
import { ParticipantCurrencyService } from "./participant-currency-service.js";
import { RoleCapabilityService } from "./role-capability-service.js";
import { ShopService } from "./shop-service.js";
import { SubmissionService } from "./submission-service.js";

export type AppServices = ReturnType<typeof createServices>;

export function createServices(prisma: PrismaClient) {
  const configService = new ConfigService(prisma);
  const auditService = new AuditService(prisma);
  const roleCapabilityService = new RoleCapabilityService(prisma);
  const groupService = new GroupService(prisma);
  const participantCurrencyService = new ParticipantCurrencyService(prisma, roleCapabilityService, auditService);
  const economyService = new EconomyService(
    prisma,
    configService,
    groupService,
    roleCapabilityService,
    auditService,
    participantCurrencyService,
  );
  const bettingService = new BettingService(prisma, configService, participantCurrencyService, roleCapabilityService);
  const shopService = new ShopService(prisma, economyService, participantCurrencyService, auditService);
  const listingService = new ListingService(prisma, roleCapabilityService, auditService);
  const participantService = new ParticipantService(prisma);
  const assignmentService = new AssignmentService(prisma);
  const submissionService = new SubmissionService(prisma, economyService, participantCurrencyService, auditService);

  return {
    prisma,
    configService,
    auditService,
    roleCapabilityService,
    groupService,
    economyService,
    participantCurrencyService,
    bettingService,
    shopService,
    listingService,
    participantService,
    assignmentService,
    submissionService,
  };
}
