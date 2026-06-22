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
  allowGrouplessEarning?: boolean;
  bettingChannelIds?: string[];
  luckyDrawChannelIds?: string[];
  pointsChannelIds?: string[];
  shopChannelIds?: string[];
  wrongChannelPenalty?: number;
  commandLogChannelId?: string | null;
  redemptionChannelId?: string | null;
  listingChannelId?: string | null;
  announcementsChannelId?: string | null;
  submissionFeedChannelId?: string | null;
  betWinChance?: number;
  bettingCooldownSeconds?: number;
};

type GuildConfig = Awaited<ReturnType<PrismaClient["guildConfig"]["upsert"]>>;

/**
 * In-process cache of GuildConfig rows, keyed by guildId.
 *
 * This is the single hottest read in the bot — `getOrCreate` was previously an
 * `upsert` fired on every passive message, every slash command, and every
 * dashboard request. GuildConfig is large and changes only when an admin edits
 * settings or the announcement marker bumps, so a write-through cache eliminates
 * the upsert round-trip (and the redundant no-op write on existing rows) from
 * the per-event path.
 *
 * Single process is guaranteed: src/index.ts constructs one ConfigService
 * shared by the bot runtime and the Fastify API. There is no second worker, so
 * no cross-process invalidation is needed.
 *
 * The cache never holds stale data for long: every mutation goes through this
 * service (getOrCreate/update/markAnnounced are the only three writers), and
 * each refreshes the entry it touched. A failed write does not populate the
 * cache. listAll() deliberately bypasses the cache because it crosses guilds
 * and is used infrequently (deployment announcements on boot).
 */
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes — config rarely changes

type CacheEntry = { value: GuildConfig; fetchedAt: number };

export class ConfigService {
  private readonly cache = new Map<string, CacheEntry>();

  public constructor(private readonly prisma: PrismaClient) {}

  public async getOrCreate(guildId: string) {
    const cached = this.readCache(guildId);
    if (cached) {
      return cached;
    }

    // upsert (not findFirst) so the very first call for a guild still
    // auto-provisions the row, exactly as before.
    const config = await this.prisma.guildConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        passivePointsReward: decimal(1),
        passiveCurrencyReward: decimal(1),
        groupPointsPerCurrencyDonation: decimal(10),
      },
      update: {},
    });
    this.writeCache(guildId, config);
    return config;
  }

  public async update(guildId: string, input: GuildConfigUpdateInput) {
    await this.getOrCreate(guildId);

    const updated = await this.prisma.guildConfig.update({
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
        allowGrouplessEarning: input.allowGrouplessEarning,
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
        submissionFeedChannelId: input.submissionFeedChannelId,
        betWinChance: input.betWinChance,
        bettingCooldownSeconds: input.bettingCooldownSeconds,
      },
    });
    this.writeCache(guildId, updated);
    return updated;
  }

  public async markAnnounced(guildId: string, version: string) {
    const updated = await this.prisma.guildConfig.update({
      where: { guildId },
      data: { lastAnnouncedVersion: version },
    });
    // Write-through so the announcement loop sees the new marker on its next
    // iteration and a restart doesn't double-post.
    this.writeCache(guildId, updated);
  }

  public async listAll() {
    return this.prisma.guildConfig.findMany({ orderBy: { createdAt: "asc" } });
  }

  public async listByGuildIds(guildIds: string[]) {
    if (guildIds.length === 0) {
      return [];
    }

    return this.prisma.guildConfig.findMany({
      where: { guildId: { in: guildIds } },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Drop every cached config. Call this when the underlying rows may have been
   * removed out-of-band (e.g. the test harness wipes tables between cases) so a
   * stale cache entry can't mask a missing row and starve a foreign key.
   */
  public clearCache() {
    this.cache.clear();
  }

  private readCache(guildId: string): GuildConfig | null {
    const entry = this.cache.get(guildId);
    if (!entry) {
      return null;
    }
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
      this.cache.delete(guildId);
      return null;
    }
    return entry.value;
  }

  private writeCache(guildId: string, value: GuildConfig) {
    this.cache.set(guildId, { value, fetchedAt: Date.now() });
  }
}
