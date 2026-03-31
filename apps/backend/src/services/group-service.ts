import type { PrismaClient } from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { normalizeIdentifier, parseRoleMention, slugify } from "../utils/normalize.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";

export type GroupInput = {
  id?: string;
  displayName: string;
  slug?: string;
  mentorName?: string | null;
  roleId: string;
  aliases: string[];
  active: boolean;
};

type ResolvedGroup = {
  id: string;
  displayName: string;
  slug: string;
  roleId: string;
  active: boolean;
};

export class GroupService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async list(guildId: string) {
    const groups = await this.prisma.group.findMany({
      where: { guildId },
      include: {
        aliases: true,
      },
      orderBy: { displayName: "asc" },
    });

    const balances = await this.getBalanceMap(groups.map((group) => group.id));

    return groups.map((group) => ({
      ...group,
      pointsBalance: balances[group.id]?.pointsBalance ?? 0,
      currencyBalance: balances[group.id]?.currencyBalance ?? 0,
    }));
  }

  public async upsert(guildId: string, input: GroupInput) {
    await this.prisma.guildConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        passivePointsReward: decimal(1),
        passiveCurrencyReward: decimal(1),
      },
      update: {},
    });

    const slug = slugify(input.slug ?? input.displayName);
    if (!slug) {
      throw new AppError("Group slug cannot be empty.");
    }

    const aliases = Array.from(
      new Set(
        input.aliases
          .map((alias) => normalizeIdentifier(alias))
          .filter(Boolean),
      ),
    );

    const group = input.id
      ? await this.prisma.group.update({
          where: { id: input.id },
          data: {
            displayName: input.displayName,
            slug,
            mentorName: input.mentorName ?? null,
            roleId: input.roleId,
            active: input.active,
          },
        })
      : await this.prisma.group.create({
          data: {
            guildId,
            displayName: input.displayName,
            slug,
            mentorName: input.mentorName ?? null,
            roleId: input.roleId,
            active: input.active,
          },
        });

    await this.prisma.$transaction([
      this.prisma.groupAlias.deleteMany({ where: { groupId: group.id } }),
      ...aliases.map((alias) =>
        this.prisma.groupAlias.create({
          data: {
            groupId: group.id,
            value: alias,
          },
        }),
      ),
      this.prisma.discordRoleCapability.upsert({
        where: {
          guildId_roleId: {
            guildId,
            roleId: input.roleId,
          },
        },
        create: {
          guildId,
          roleId: input.roleId,
          roleName: input.displayName,
          isGroupRole: true,
          canReceiveAwards: true,
        },
        update: {
          roleName: input.displayName,
          isGroupRole: true,
        },
      }),
    ]);

    return this.prisma.group.findUniqueOrThrow({
      where: { id: group.id },
      include: { aliases: true },
    });
  }

  public async resolveGroupByIdentifier(guildId: string, identifier: string) {
    const roleId = parseRoleMention(identifier);
    const normalized = normalizeIdentifier(identifier);

    const groups = await this.prisma.group.findMany({
      where: { guildId, active: true },
      include: { aliases: true },
    });

    return (
      groups.find((group) => group.roleId === roleId) ??
      groups.find((group) => group.roleId === identifier) ??
      groups.find((group) => normalizeIdentifier(group.slug) === normalized) ??
      groups.find((group) => normalizeIdentifier(group.displayName) === normalized) ??
      groups.find((group) => group.aliases.some((alias) => alias.value === normalized)) ??
      null
    );
  }

  public async resolveGroupFromRoleIds(guildId: string, roleIds: string[]): Promise<ResolvedGroup> {
    const groups = await this.prisma.group.findMany({
      where: {
        guildId,
        roleId: {
          in: roleIds,
        },
        active: true,
      },
    });

    if (groups.length === 0) {
      throw new AppError("You are not mapped to an active group.", 403);
    }

    if (groups.length > 1) {
      throw new AppError("You belong to multiple configured groups. Resolve the mapping before using this command.", 409);
    }

    return groups[0];
  }

  public async getBalanceMap(groupIds: string[]) {
    if (groupIds.length === 0) {
      return {};
    }

    const grouped = await this.prisma.ledgerSplit.groupBy({
      by: ["groupId"],
      where: {
        groupId: {
          in: groupIds,
        },
      },
      _sum: {
        pointsDelta: true,
        currencyDelta: true,
      },
    });

    return Object.fromEntries(
      grouped.map((row) => [
        row.groupId,
        {
          pointsBalance: decimalToNumber(row._sum.pointsDelta),
          currencyBalance: decimalToNumber(row._sum.currencyDelta),
        },
      ]),
    );
  }
}
