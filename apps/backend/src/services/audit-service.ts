import { Prisma, type PrismaClient } from "@prisma/client";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export class AuditService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async record(params: {
    guildId: string;
    actorUserId?: string;
    actorUsername?: string;
    action: string;
    entityType: string;
    entityId?: string;
    payload?: unknown;
    executor?: PrismaExecutor;
  }) {
    const executor = params.executor ?? this.prisma;

    return executor.auditLog.create({
      data: {
        guildId: params.guildId,
        actorUserId: params.actorUserId,
        actorUsername: params.actorUsername,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        payload: params.payload === undefined ? undefined : (params.payload as object),
      },
    });
  }
}
