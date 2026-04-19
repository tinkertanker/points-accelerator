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

  public async list(guildId: string, options: { includeInactive?: boolean } = {}) {
    const awardableRoleIds = await this.syncAwardableRoleGroups(guildId);
    if (awardableRoleIds.length === 0) {
      return [];
    }

    const groups = await this.prisma.group.findMany({
      where: {
        guildId,
        roleId: {
          in: awardableRoleIds,
        },
        ...(options.includeInactive ? {} : { active: true }),
      },
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
        groupPointsPerCurrencyDonation: decimal(10),
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
        update: {},
      }),
    ]);

    return this.prisma.group.findUniqueOrThrow({
      where: { id: group.id },
      include: { aliases: true },
    });
  }

  public async resolveGroupByIdentifier(guildId: string, identifier: string) {
    const awardableRoleIds = await this.syncAwardableRoleGroups(guildId);
    if (awardableRoleIds.length === 0) {
      return null;
    }

    const roleId = parseRoleMention(identifier);
    const normalized = normalizeIdentifier(identifier);

    const groups = await this.prisma.group.findMany({
      where: {
        guildId,
        active: true,
        roleId: {
          in: awardableRoleIds,
        },
      },
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
    const awardableRoleIds = await this.syncAwardableRoleGroups(guildId);
    const matchingRoleIds = roleIds.filter((roleId) => awardableRoleIds.includes(roleId));

    const groups = await this.prisma.group.findMany({
      where: {
        guildId,
        roleId: {
          in: matchingRoleIds,
        },
        active: true,
      },
    });

    if (groups.length === 0) {
      throw new AppError("You are not mapped to an active group.", 403);
    }

    const groupsByRoleId = new Map(groups.map((group) => [group.roleId, group]));
    for (const roleId of matchingRoleIds) {
      const group = groupsByRoleId.get(roleId);
      if (group) {
        return group;
      }
    }

    return groups[0];
  }

  public async findById(guildId: string, groupId: string) {
    return this.prisma.group.findFirst({
      where: {
        guildId,
        id: groupId,
      },
    });
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

  private async syncAwardableRoleGroups(guildId: string) {
    const awardableRoles = await this.prisma.discordRoleCapability.findMany({
      where: {
        guildId,
        isGroupRole: true,
        canReceiveAwards: true,
      },
      orderBy: { roleName: "asc" },
    });

    if (awardableRoles.length === 0) {
      return [];
    }

    const existingGroups = await this.prisma.group.findMany({
      where: {
        guildId,
      },
      select: {
        roleId: true,
        slug: true,
        displayName: true,
      },
    });

    const existingGroupsByRoleId = new Map(existingGroups.map((group) => [group.roleId, group]));
    const usedSlugs = new Set(existingGroups.map((group) => group.slug));

    await this.prisma.$transaction(
      awardableRoles.map((role) =>
        this.prisma.group.upsert({
          where: {
            guildId_roleId: {
              guildId,
              roleId: role.roleId,
            },
          },
          create: {
            guildId,
            displayName: role.roleName,
            slug: this.createUniqueSyncedSlug(role.roleName, role.roleId, usedSlugs),
            mentorName: null,
            roleId: role.roleId,
            active: true,
          },
          update: {},
        }),
      ),
    );

    return awardableRoles.map((role) => role.roleId);
  }

  private createUniqueSyncedSlug(roleName: string, roleId: string, usedSlugs: Set<string>) {
    const baseSlug = slugify(roleName) || "group";
    const roleSuffix = slugify(roleId).replace(/[^a-z0-9-]+/g, "") || "role";

    const candidates = [baseSlug, `${baseSlug}-${roleSuffix}`];
    for (const candidate of candidates) {
      if (!usedSlugs.has(candidate)) {
        usedSlugs.add(candidate);
        return candidate;
      }
    }

    let counter = 2;
    while (usedSlugs.has(`${baseSlug}-${roleSuffix}-${counter}`)) {
      counter += 1;
    }

    const slug = `${baseSlug}-${roleSuffix}-${counter}`;
    usedSlugs.add(slug);
    return slug;
  }
}
