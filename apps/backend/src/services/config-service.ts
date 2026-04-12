import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { decimal } from "../utils/decimal.js";

export type GuildConfigUpdateInput = {
  appName?: string;
  pointsName?: string;
  currencyName?: string;
  passivePointsReward?: number;
  passiveCurrencyReward?: number;
  passiveCooldownSeconds?: number;
  passiveMinimumCharacters?: number;
  passiveAllowedChannelIds?: string[];
  passiveDeniedChannelIds?: string[];
  commandLogChannelId?: string | null;
  redemptionChannelId?: string | null;
  listingChannelId?: string | null;
  economyMode?: "SIMPLE" | "ADVANCED";
};

export class ConfigService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async getOrCreate(guildId: string) {
    const config = await this.prisma.guildConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        publicLeaderboardToken: this.createPublicLeaderboardToken(),
        passivePointsReward: decimal(1),
        passiveCurrencyReward: decimal(1),
      },
      update: {},
    });

    if (config.publicLeaderboardToken) {
      return config;
    }

    await this.prisma.guildConfig.updateMany({
      where: {
        guildId,
        publicLeaderboardToken: null,
      },
      data: {
        publicLeaderboardToken: this.createPublicLeaderboardToken(),
      },
    });

    return this.prisma.guildConfig.findUniqueOrThrow({
      where: { guildId },
    });
  }

  public async update(guildId: string, input: GuildConfigUpdateInput) {
    await this.getOrCreate(guildId);

    return this.prisma.guildConfig.update({
      where: { guildId },
      data: {
        appName: input.appName,
        pointsName: input.pointsName,
        currencyName: input.currencyName,
        passivePointsReward: input.passivePointsReward === undefined ? undefined : decimal(input.passivePointsReward),
        passiveCurrencyReward:
          input.passiveCurrencyReward === undefined ? undefined : decimal(input.passiveCurrencyReward),
        passiveCooldownSeconds: input.passiveCooldownSeconds,
        passiveMinimumCharacters: input.passiveMinimumCharacters,
        passiveAllowedChannelIds: input.passiveAllowedChannelIds,
        passiveDeniedChannelIds: input.passiveDeniedChannelIds,
        commandLogChannelId: input.commandLogChannelId,
        redemptionChannelId: input.redemptionChannelId,
        listingChannelId: input.listingChannelId,
        economyMode: input.economyMode,
      },
    });
  }

  private createPublicLeaderboardToken() {
    return randomBytes(18).toString("base64url");
  }
}
