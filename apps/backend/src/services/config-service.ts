import type { PrismaClient } from "@prisma/client";

import { decimal } from "../utils/decimal.js";

export type GuildConfigUpdateInput = {
  appName?: string;
  pointsName?: string;
  pointsSymbol?: string;
  currencyName?: string;
  currencySymbol?: string;
  groupPointsPerCurrencyDonation?: number;
  mentorRoleIds?: string[];
  passivePointsReward?: number;
  passiveCurrencyReward?: number;
  passiveCooldownSeconds?: number;
  passiveMinimumCharacters?: number;
  passiveAllowedChannelIds?: string[];
  passiveDeniedChannelIds?: string[];
  bettingChannelIds?: string[];
  luckyDrawChannelIds?: string[];
  pointsChannelIds?: string[];
  shopChannelIds?: string[];
  wrongChannelPenalty?: number;
  commandLogChannelId?: string | null;
  redemptionChannelId?: string | null;
  listingChannelId?: string | null;
  announcementsChannelId?: string | null;
  betWinChance?: number;
  bettingCooldownSeconds?: number;
};

export class ConfigService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async getOrCreate(guildId: string) {
    return this.prisma.guildConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        passivePointsReward: decimal(1),
        passiveCurrencyReward: decimal(1),
        groupPointsPerCurrencyDonation: decimal(10),
      },
      update: {},
    });
  }

  public async update(guildId: string, input: GuildConfigUpdateInput) {
    await this.getOrCreate(guildId);

    return this.prisma.guildConfig.update({
      where: { guildId },
      data: {
        appName: input.appName,
        pointsName: input.pointsName,
        pointsSymbol: input.pointsSymbol,
        currencyName: input.currencyName,
        currencySymbol: input.currencySymbol,
        groupPointsPerCurrencyDonation:
          input.groupPointsPerCurrencyDonation === undefined ? undefined : decimal(input.groupPointsPerCurrencyDonation),
        mentorRoleIds: input.mentorRoleIds,
        passivePointsReward: input.passivePointsReward === undefined ? undefined : decimal(input.passivePointsReward),
        passiveCurrencyReward:
          input.passiveCurrencyReward === undefined ? undefined : decimal(input.passiveCurrencyReward),
        passiveCooldownSeconds: input.passiveCooldownSeconds,
        passiveMinimumCharacters: input.passiveMinimumCharacters,
        passiveAllowedChannelIds: input.passiveAllowedChannelIds,
        passiveDeniedChannelIds: input.passiveDeniedChannelIds,
        bettingChannelIds: input.bettingChannelIds,
        luckyDrawChannelIds: input.luckyDrawChannelIds,
        pointsChannelIds: input.pointsChannelIds,
        shopChannelIds: input.shopChannelIds,
        wrongChannelPenalty:
          input.wrongChannelPenalty === undefined ? undefined : decimal(input.wrongChannelPenalty),
        commandLogChannelId: input.commandLogChannelId,
        redemptionChannelId: input.redemptionChannelId,
        listingChannelId: input.listingChannelId,
        announcementsChannelId: input.announcementsChannelId,
        betWinChance: input.betWinChance,
        bettingCooldownSeconds: input.bettingCooldownSeconds,
      },
    });
  }

  public async markAnnounced(guildId: string, version: string) {
    await this.prisma.guildConfig.update({
      where: { guildId },
      data: { lastAnnouncedVersion: version },
    });
  }
}
