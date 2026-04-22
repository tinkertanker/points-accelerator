import type { PrismaClient } from "@prisma/client";

import { decimal } from "../utils/decimal.js";

const DEFAULT_ROLE_ACTION_COOLDOWN_SECONDS = 10;

export type RoleCapabilityInput = {
  roleId: string;
  roleName: string;
  canManageDashboard: boolean;
  canAward: boolean;
  maxAward: number | null;
  actionCooldownSeconds?: number | null;
  canDeduct: boolean;
  canMultiAward: boolean;
  canSell: boolean;
  canReceiveAwards: boolean;
  isGroupRole: boolean;
  riggedBetWinChance?: number | null;
};

export class RoleCapabilityService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async list(guildId: string) {
    return this.prisma.discordRoleCapability.findMany({
      where: { guildId },
      orderBy: { roleName: "asc" },
    });
  }

  public async replaceAll(guildId: string, capabilities: RoleCapabilityInput[]) {
    await this.prisma.guildConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        passivePointsReward: decimal(1),
        passiveCurrencyReward: decimal(1),
      },
      update: {},
    });

    await this.prisma.$transaction(async (tx) => {
      const incomingRoleIds = capabilities.map((capability) => capability.roleId);

      await tx.discordRoleCapability.deleteMany({
        where: {
          guildId,
          roleId: {
            notIn: incomingRoleIds.length > 0 ? incomingRoleIds : [""],
          },
        },
      });

      for (const capability of capabilities) {
        const actionCooldownSeconds =
          capability.canAward || capability.canDeduct
            ? capability.actionCooldownSeconds ?? DEFAULT_ROLE_ACTION_COOLDOWN_SECONDS
            : null;

        await tx.discordRoleCapability.upsert({
          where: {
            guildId_roleId: {
              guildId,
              roleId: capability.roleId,
            },
          },
          create: {
            guildId,
            roleId: capability.roleId,
            roleName: capability.roleName,
            canManageDashboard: capability.canManageDashboard,
            canAward: capability.canAward,
            maxAward: capability.maxAward === null ? null : decimal(capability.maxAward),
            actionCooldownSeconds,
            canDeduct: capability.canDeduct,
            canMultiAward: capability.canMultiAward,
            canSell: capability.canSell,
            canReceiveAwards: capability.canReceiveAwards,
            isGroupRole: capability.isGroupRole,
            riggedBetWinChance: capability.riggedBetWinChance ?? null,
          },
          update: {
            roleName: capability.roleName,
            canManageDashboard: capability.canManageDashboard,
            canAward: capability.canAward,
            maxAward: capability.maxAward === null ? null : decimal(capability.maxAward),
            actionCooldownSeconds,
            canDeduct: capability.canDeduct,
            canMultiAward: capability.canMultiAward,
            canSell: capability.canSell,
            canReceiveAwards: capability.canReceiveAwards,
            isGroupRole: capability.isGroupRole,
            riggedBetWinChance: capability.riggedBetWinChance ?? null,
          },
        });
      }
    });

    return this.list(guildId);
  }

  public async listForRoleIds(guildId: string, roleIds: string[]) {
    if (roleIds.length === 0) {
      return [];
    }

    return this.prisma.discordRoleCapability.findMany({
      where: {
        guildId,
        roleId: {
          in: roleIds,
        },
      },
    });
  }
}
