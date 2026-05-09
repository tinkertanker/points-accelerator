import { randomUUID } from "node:crypto";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  escapeMarkdown,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type GuildMember,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";

import type { AppEnv } from "../config/env.js";
import { resolveCapabilities, type ResolvedCapabilities } from "../domain/permissions.js";
import type { GuardedActivity } from "../services/channel-guard-service.js";
import type { AppServices } from "../services/app-services.js";
import type { StorageService } from "../services/storage-service.js";
import { AppError } from "../utils/app-error.js";
import { decimalToNumber } from "../utils/decimal.js";
import { parseDuration } from "../utils/duration.js";
import { readBackendVersion, readChangelogEntry } from "./announcements.js";

type CooldownEntry = {
  seenAt: number;
};

type BettingCooldownEntry = {
  lastBetAt: number;
  offenses: number;
};

type CommandLedgerEntry = Awaited<ReturnType<AppServices["economyService"]["getLedger"]>>[number];
type GroupLeaderboardEntry = Awaited<ReturnType<AppServices["economyService"]["getLeaderboard"]>>[number];
type GuildConfig = Awaited<ReturnType<AppServices["configService"]["getOrCreate"]>>;
type ActiveAssignment = Awaited<ReturnType<AppServices["assignmentService"]["listActive"]>>[number];
type CurrencyLeaderboardEntry = Awaited<ReturnType<AppServices["participantService"]["getCurrencyLeaderboard"]>>[number];
type ShopListItem = Awaited<ReturnType<AppServices["shopService"]["list"]>>[number];
type UserRedemption = Awaited<
  ReturnType<AppServices["shopService"]["listPersonalRedemptionsByUser"]>
>[number];
type GuildMemberCollection = Awaited<
  ReturnType<NonNullable<ChatInputCommandInteraction["guild"]>["members"]["fetch"]>
>;
type AssignmentLookupResult =
  | { kind: "resolved"; assignment: ActiveAssignment }
  | { kind: "ambiguous"; matches: ActiveAssignment[] }
  | { kind: "missing" };
type AwardSubcommand = "points" | "currency" | "currencygroup" | "currencybulk";
type DeductSubcommand = "group" | "member" | "mixed";
type AwardLikeCommandKey = `award:${AwardSubcommand}` | `deduct:${DeductSubcommand}`;
type PendingSubmissionReplacement = {
  createdAt: number;
  userId: string;
  guildId: string;
  assignmentId: string;
  participantId: string;
  text: string;
  imageUrl?: string;
  imageKey?: string;
  studentDisplay: string;
};

const CURRENCY_BULK_MAX_MEMBERS = 10;
const USER_MENTION_PATTERN = /^<@!?(\d{17,20})>$/;

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function isDiscordSnowflake(value: string | null | undefined): value is string {
  return typeof value === "string" && DISCORD_SNOWFLAKE_PATTERN.test(value);
}

const PAGINATION_VERSION = "v1";
const PAGINATION_PAGE_SIZE = 10;
const LEDGER_EMBED_COLOUR = 0x8b5cf6;
const LEDGER_DESCRIPTION_MAX = 300;
const LEDGER_FIELD_VALUE_MAX = 1024;
const ASSIGNMENT_CHOICE_FIELD_VALUE_MAX = 1024;
const MISSING_ASSIGNMENT_IDENTIFIER_MAX = 3900;
const LEADERBOARD_FEATURED_COUNT = 4;
const GROUP_LEADERBOARD_COLOUR = 0xf59e0b;
const FORBES_EMBED_COLOUR = 0x38bdf8;
const BALANCE_EMBED_COLOUR = 0x6366f1;
const STORE_EMBED_COLOUR = 0x10b981;
const INVENTORY_EMBED_COLOUR = 0xec4899;
const ASSIGNMENTS_EMBED_COLOUR = 0x14b8a6;
const AUTOCOMPLETE_CHOICE_LIMIT = 25;
const AUTOCOMPLETE_CHOICE_NAME_MAX = 100;
const DEFAULT_ROLE_ACTION_COOLDOWN_SECONDS = 10;

type PaginationKind = "inventory" | "store" | "ledger" | "leaderboard" | "forbes" | "assignments";
type InventoryAudience = "personal" | "group";
type StoreAudience = "personal" | "group";

type PaginationCustomId = {
  kind: PaginationKind;
  subkey: string;
  ownerId: string;
  page: number;
};

function buildPaginationCustomId(
  kind: PaginationKind,
  subkey: string,
  ownerId: string,
  page: number,
): string {
  return [PAGINATION_VERSION, "page", kind, subkey, ownerId, String(page)].join(":");
}

function parsePaginationCustomId(raw: string): PaginationCustomId | null {
  const parts = raw.split(":");
  if (parts.length !== 6) return null;
  const [version, tag, kind, subkey, ownerId, pageRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== PAGINATION_VERSION || tag !== "page") return null;
  if (!["inventory", "store", "ledger", "leaderboard", "forbes", "assignments"].includes(kind)) return null;
  const page = Number.parseInt(pageRaw, 10);
  if (!Number.isFinite(page) || page < 1) return null;
  return { kind: kind as PaginationKind, subkey, ownerId, page };
}

function paginateArray<T>(items: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGINATION_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * PAGINATION_PAGE_SIZE;
  const slice = items.slice(start, start + PAGINATION_PAGE_SIZE);
  return {
    slice,
    totalPages,
    clampedPage,
    hasPrev: clampedPage > 1,
    hasNext: clampedPage < totalPages,
    startIndex: start,
  };
}

function configureAwardLikeSubcommand(
  sub: SlashCommandSubcommandBuilder,
  commandKey: AwardLikeCommandKey,
  subcommandName: string,
  description: string,
) {
  const config = getAwardCommandConfig(commandKey);
  sub.setName(subcommandName).setDescription(description);

  if (config.includesGroupTargets) {
    sub.addStringOption((option) =>
      option.setName("targets").setDescription("Comma-separated group aliases or role mentions").setRequired(true),
    );
  }

  if (config.includesMembersList) {
    sub.addStringOption((option) =>
      option
        .setName("members")
        .setDescription(`Up to ${CURRENCY_BULK_MAX_MEMBERS} member mentions or IDs, separated by commas or spaces`)
        .setRequired(true),
    );
  }

  if (config.includesGroupPoints && config.groupAmountOptionName) {
    sub.addNumberOption((option) =>
      option
        .setName(config.groupAmountOptionName)
        .setDescription("Points delta for the target groups")
        .setRequired(true)
        .setMinValue(0.01),
    );
  }

  if (config.includesSingleMemberCurrency) {
    sub.addUserOption((option) =>
      option.setName("member").setDescription("Member whose wallet should change").setRequired(true),
    );
  }

  if (
    (config.includesSingleMemberCurrency || config.includesBulkMemberCurrency || config.includesMembersList) &&
    config.memberAmountOptionName
  ) {
    sub.addNumberOption((option) =>
      option
        .setName(config.memberAmountOptionName)
        .setDescription(
          config.includesBulkMemberCurrency
            ? "Currency delta for each eligible member in the selected groups"
            : config.includesMembersList
              ? "Currency delta awarded to each listed member"
              : "Currency delta for the selected member",
        )
        .setRequired(true)
        .setMinValue(0.01),
    );
  }

  sub.addStringOption((option) =>
    option
      .setName("reason")
      .setDescription(`${config.isDeduction ? "Deduction" : "Award"} reason`)
      .setRequired(false),
  );

  return sub;
}

function getAwardCommandConfig(commandKey: AwardLikeCommandKey) {
  switch (commandKey) {
    case "award:points":
      return {
        isDeduction: false,
        includesGroupTargets: true,
        includesGroupPoints: true,
        includesSingleMemberCurrency: false,
        includesBulkMemberCurrency: false,
        includesMembersList: false,
        groupAmountOptionName: "amount",
        memberAmountOptionName: null,
      };
    case "award:currency":
      return {
        isDeduction: false,
        includesGroupTargets: false,
        includesGroupPoints: false,
        includesSingleMemberCurrency: true,
        includesBulkMemberCurrency: false,
        includesMembersList: false,
        groupAmountOptionName: null,
        memberAmountOptionName: "amount",
      };
    case "award:currencygroup":
      return {
        isDeduction: false,
        includesGroupTargets: true,
        includesGroupPoints: false,
        includesSingleMemberCurrency: false,
        includesBulkMemberCurrency: true,
        includesMembersList: false,
        groupAmountOptionName: null,
        memberAmountOptionName: "amount",
      };
    case "award:currencybulk":
      return {
        isDeduction: false,
        includesGroupTargets: false,
        includesGroupPoints: false,
        includesSingleMemberCurrency: false,
        includesBulkMemberCurrency: false,
        includesMembersList: true,
        groupAmountOptionName: null,
        memberAmountOptionName: "amount",
      };
    case "deduct:group":
      return {
        isDeduction: true,
        includesGroupTargets: true,
        includesGroupPoints: true,
        includesSingleMemberCurrency: false,
        includesBulkMemberCurrency: false,
        includesMembersList: false,
        groupAmountOptionName: "points",
        memberAmountOptionName: null,
      };
    case "deduct:member":
      return {
        isDeduction: true,
        includesGroupTargets: false,
        includesGroupPoints: false,
        includesSingleMemberCurrency: true,
        includesBulkMemberCurrency: false,
        includesMembersList: false,
        groupAmountOptionName: null,
        memberAmountOptionName: "currency",
      };
    case "deduct:mixed":
      return {
        isDeduction: true,
        includesGroupTargets: true,
        includesGroupPoints: true,
        includesSingleMemberCurrency: true,
        includesBulkMemberCurrency: false,
        includesMembersList: false,
        groupAmountOptionName: "points",
        memberAmountOptionName: "currency",
      };
  }
}

function parseMembersList(raw: string): string[] {
  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const ids: string[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const token of tokens) {
    const mentionMatch = token.match(USER_MENTION_PATTERN);
    const id = mentionMatch?.[1] ?? (isDiscordSnowflake(token) ? token : null);
    if (!id) {
      invalid.push(token);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (invalid.length > 0) {
    throw new AppError(
      `Could not parse these member mentions or IDs: ${invalid.join(", ")}. Use @mentions or 17–20 digit Discord IDs.`,
      400,
    );
  }
  return ids;
}

export type DashboardMember = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  roleIds: string[];
  isGuildOwner: boolean;
  hasAdministrator: boolean;
  hasManageGuild: boolean;
};

export interface BotRuntimeApi {
  getRoles(): Promise<Array<{ id: string; name: string }>>;
  getTextChannels(): Promise<Array<{ id: string; name: string }>>;
  getMembers(): Promise<Array<{ id: string; name: string }>>;
  getDashboardMember(userId: string): Promise<DashboardMember | null>;
  getGroupMemberCount(roleId: string): Promise<number | null>;
  getGroupMemberDiscordUserIds(roleId: string): Promise<string[] | null>;
  postListing(channelId: string, content: string): Promise<{ channelId: string; messageId: string } | null>;
  clearRedemptionButtons(channelId: string, messageId: string, statusLine: string): Promise<void>;
}

function isDiscordUnknownMemberError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 10007
  );
}

const MEMBERS_CACHE_TTL_MS = 60_000;

export class BotRuntime {
  private readonly passiveCooldowns = new Map<string, CooldownEntry>();
  private readonly actionCooldowns = new Map<string, CooldownEntry>();
  private readonly bettingCooldowns = new Map<string, BettingCooldownEntry>();
  private readonly luckyDrawTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingSubmissionReplacements = new Map<string, PendingSubmissionReplacement>();
  private client: Client | null = null;
  private membersCache: { fetchedAt: number; value: Array<{ id: string; name: string }> } | null = null;

  public constructor(
    private readonly env: AppEnv,
    private readonly services: AppServices,
    private readonly storageService: StorageService,
  ) {}

  public async start() {
    if (!this.env.DISCORD_BOT_TOKEN) {
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });

    this.client.once("ready", async () => {
      await this.registerCommands();
      await this.announceDeploymentIfNew().catch((error) => {
        console.error("Failed to post deploy announcement", error);
      });
      await this.resumeLuckyDraws().catch((error) => {
        console.error("Failed to resume in-flight lucky draws", error);
      });
    });

    this.client.on("messageCreate", async (message) => {
      if (!message.guild || message.author.bot || message.guild.id !== this.env.GUILD_ID) {
        return;
      }

      const member = await message.member?.fetch().catch(() => null);
      if (!member) {
        return;
      }

      if (await this.handleBotMention(message)) {
        return;
      }

      await this.handlePassiveMessage({
        memberId: member.id,
        roleIds: this.getOrderedRoleIds(member),
        userId: message.author.id,
        username: message.author.username,
        messageId: message.id,
        content: message.content,
        channelId: message.channelId,
      });
    });

    this.client.on("messageReactionAdd", async (reaction, user) => {
      try {
        await this.handleBotReaction(reaction, user);
      } catch (error) {
        console.error("messageReactionAdd handling failed", error);
      }
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.guildId !== this.env.GUILD_ID) {
        return;
      }

      if (interaction.isAutocomplete()) {
        try {
          await this.handleAutocomplete(interaction);
        } catch (error) {
          console.error("Autocomplete handling failed", error);
        }
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith("redemption:")) {
        try {
          await this.handleRedemptionButton(interaction);
        } catch (error) {
          console.error("Redemption button handling failed", error);
          const message = error instanceof AppError ? error.message : "Unexpected button error.";
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.editReply({ content: message });
            } else {
              await interaction.reply({ content: message, ephemeral: true });
            }
          } catch (replyError) {
            console.error("Failed to send button error response", replyError);
          }
        }
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith("luckydraw:")) {
        try {
          await this.handleLuckyDrawButton(interaction);
        } catch (error) {
          console.error("Lucky draw button handling failed", error);
          const message = error instanceof AppError ? error.message : "Unexpected button error.";
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.editReply({ content: message });
            } else {
              await interaction.reply({ content: message, ephemeral: true });
            }
          } catch (replyError) {
            console.error("Failed to send button error response", replyError);
          }
        }
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith("submission:")) {
        try {
          await this.handleSubmissionButton(interaction);
        } catch (error) {
          console.error("Submission button handling failed", error);
          const message = error instanceof AppError ? error.message : "Unexpected button error.";
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.editReply({ content: message });
            } else {
              await interaction.reply({ content: message, ephemeral: true });
            }
          } catch (replyError) {
            console.error("Failed to send button error response", replyError);
          }
        }
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith(`${PAGINATION_VERSION}:page:`)) {
        try {
          await this.handlePaginationButton(interaction);
        } catch (error) {
          console.error("Pagination button handling failed", error);
          const message = error instanceof AppError ? error.message : "Unexpected button error.";
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.editReply({ content: message });
            } else {
              await interaction.reply({ content: message, ephemeral: true });
            }
          } catch (replyError) {
            console.error("Failed to send button error response", replyError);
          }
        }
        return;
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      try {
        await this.handleCommand(interaction);
      } catch (error) {
        console.error("Command handling failed", error);
        const message = error instanceof AppError ? error.message : "Unexpected command error.";
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: message });
          } else {
            await interaction.reply({ content: message, ephemeral: true });
          }
        } catch (replyError) {
          console.error("Failed to send interaction error response", replyError);
        }
      }
    });

    await this.client.login(this.env.DISCORD_BOT_TOKEN);
  }

  private async handleBotMention(message: Message) {
    if (!this.client?.user || !message.mentions.has(this.client.user)) {
      return false;
    }

    if (message.reference?.messageId) {
      await this.handleReplySubmission(message);
      return true;
    }

    await message.reply("I am a helpful points bot.").catch(() => {});
    return true;
  }

  public async stop() {
    for (const timer of this.luckyDrawTimers.values()) {
      clearTimeout(timer);
    }
    this.luckyDrawTimers.clear();
    this.client?.destroy();
    this.client = null;
  }

  private getOrderedRoleIds(member: GuildMember | null): string[] {
    if (!member) {
      return [];
    }

    return Array.from(member.roles.cache.entries())
      .map(([roleId, role]) => ({
        roleId,
        rawPosition: typeof role.rawPosition === "number" ? role.rawPosition : -1,
      }))
      .sort((left, right) => right.rawPosition - left.rawPosition || left.roleId.localeCompare(right.roleId))
      .map((role) => role.roleId);
  }

  public async getRoles() {
    if (!this.client) {
      return [];
    }

    const guild = await this.client.guilds.fetch(this.env.GUILD_ID).catch(() => null);
    if (!guild) {
      return [];
    }

    const roles = await guild.roles.fetch();
    return roles
      .filter((role) => role !== null && !role.managed)
      .map((role) => ({
        id: role!.id,
        name: role!.name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public async getTextChannels() {
    if (!this.client) {
      return [];
    }

    const guild = await this.client.guilds.fetch(this.env.GUILD_ID).catch(() => null);
    if (!guild) {
      return [];
    }

    const channels = await guild.channels.fetch();
    return channels
      .filter((channel) => channel?.type === ChannelType.GuildText)
      .map((channel) => ({
        id: channel!.id,
        name: channel!.name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public async getMembers() {
    const now = Date.now();
    if (this.membersCache && now - this.membersCache.fetchedAt < MEMBERS_CACHE_TTL_MS) {
      return this.membersCache.value;
    }

    if (!this.client) {
      return this.membersCache?.value ?? [];
    }

    const guild = await this.client.guilds.fetch(this.env.GUILD_ID).catch(() => null);
    if (!guild) {
      return this.membersCache?.value ?? [];
    }

    const members = await guild.members.fetch().catch(() => null);
    if (!members) {
      return this.membersCache?.value ?? [];
    }

    const value = Array.from(members.values())
      .filter((member) => !member.user.bot)
      .map((member) => ({
        id: member.user.id,
        name: member.displayName || member.user.username,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    this.membersCache = { fetchedAt: now, value };
    return value;
  }

  public async getDashboardMember(userId: string): Promise<DashboardMember | null> {
    if (!this.client) {
      throw new AppError("Discord member lookup is unavailable because the bot is not connected.", 503);
    }

    const guild = await this.client.guilds
      .fetch(this.env.GUILD_ID)
      .catch((error: unknown) => {
        throw new AppError(
          `Discord guild lookup failed${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
          503,
        );
      });

    const member = await guild.members.fetch(userId).catch((error: unknown) => {
      if (isDiscordUnknownMemberError(error)) {
        return null;
      }

      throw new AppError(
        `Discord member lookup failed${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
        503,
      );
    });

    if (!member) {
      return null;
    }

    return {
      userId: member.user.id,
      username: member.user.username,
      displayName: member.displayName,
      avatarUrl: member.displayAvatarURL({ size: 128 }) || null,
      roleIds: this.getOrderedRoleIds(member),
      isGuildOwner: guild.ownerId === member.id,
      hasAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
      hasManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
    };
  }

  public async getGroupMemberCount(roleId: string): Promise<number | null> {
    const memberIds = await this.getGroupMemberDiscordUserIds(roleId);
    return memberIds?.length ?? null;
  }

  public async getGroupMemberDiscordUserIds(roleId: string): Promise<string[] | null> {
    if (!this.client) {
      return null;
    }

    const guild = await this.client.guilds.fetch(this.env.GUILD_ID).catch(() => null);
    if (!guild) {
      return null;
    }

    const group = await this.services.groupService.resolveGroupByIdentifier(this.env.GUILD_ID, roleId);
    if (!group) {
      return null;
    }

    const eligibleMembers = await this.getEligibleGroupMembers({
      groupId: group.id,
      roleId,
      guild,
    }).catch(() => null);
    if (!eligibleMembers) {
      return null;
    }

    return eligibleMembers.map((member) => member.user.id);
  }

  public async postListing(channelId: string, content: string): Promise<{ channelId: string; messageId: string } | null> {
    if (!this.client) {
      return null;
    }

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return null;
    }

    const sent = await (channel as GuildTextBasedChannel).send(content);
    return {
      channelId: sent.channelId,
      messageId: sent.id,
    };
  }

  private async announceDeploymentIfNew() {
    if (!this.client) return;

    const version = await readBackendVersion();
    if (!version) return;

    const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    if (!config.announcementsChannelId) return;
    if (config.lastAnnouncedVersion === version) return;

    const entry = await readChangelogEntry(version);
    if (!entry || entry.body.length === 0) return;

    const channel = await this.client.channels.fetch(config.announcementsChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const appName = config.appName || this.env.PUBLIC_APP_NAME;
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`${appName} — v${version}`)
      .setDescription(entry.body.slice(0, 4000));

    await (channel as GuildTextBasedChannel).send({ embeds: [embed] });
    await this.services.configService.markAnnounced(this.env.GUILD_ID, version);
  }

  public async clearRedemptionButtons(channelId: string, messageId: string, statusLine: string): Promise<void> {
    if (!this.client) {
      return;
    }

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const message = await (channel as GuildTextBasedChannel).messages.fetch(messageId).catch(() => null);
    if (!message) {
      return;
    }

    const original = message.content ?? "";
    const suffix = statusLine ? `\n\n${statusLine}` : "";
    await message
      .edit({
        content: `${original}${suffix}`,
        components: [],
        allowedMentions: { parse: [] },
      })
      .catch((error: unknown) => {
        console.error("Failed to clear redemption buttons", error);
      });
  }

  private buildRedemptionActionRow(redemptionId: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`redemption:fulfil:${redemptionId}`)
        .setLabel("Mark fulfilled")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`redemption:cancel:${redemptionId}`)
        .setLabel("Cancel & refund")
        .setStyle(ButtonStyle.Danger),
    );
  }

  private async postRedemptionFulfilmentNotice(params: {
    channelId: string;
    ownerUserId: string | null;
    fulfillerRoleId: string | null;
    buyerUserId: string;
    buyerMention: string;
    shopItemName: string;
    shopItemEmoji: string;
    quantity: number;
    redemptionId: string;
    audience: "INDIVIDUAL" | "GROUP";
    groupName: string;
    fulfillmentInstructions: string | null;
  }): Promise<{ channelId: string; messageId: string } | null> {
    if (!this.client) {
      return null;
    }

    const channel = await this.client.channels.fetch(params.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return null;
    }

    const validOwnerId = isDiscordSnowflake(params.ownerUserId) ? params.ownerUserId : null;
    const ownerMention = validOwnerId ? `<@${validOwnerId}>` : null;
    const validFulfillerRoleId = isDiscordSnowflake(params.fulfillerRoleId)
      ? params.fulfillerRoleId
      : null;
    const fulfillerRoleMention = validFulfillerRoleId ? `<@&${validFulfillerRoleId}>` : null;
    const subject =
      params.audience === "GROUP"
        ? `${params.buyerMention} (on behalf of **${params.groupName}**)`
        : params.buyerMention;
    const fulfilmentLine = params.fulfillmentInstructions
      ? `\nFulfilment notes: ${params.fulfillmentInstructions}`
      : "";
    const headerMentions = [ownerMention, fulfillerRoleMention].filter(
      (value): value is string => value !== null,
    );
    const header = headerMentions.length > 0 ? `${headerMentions.join(" ")} heads up — ` : "";
    const content = `${header}${subject} purchased ${params.shopItemEmoji} **${params.shopItemName}**${
      params.quantity > 1 ? ` x${params.quantity}` : ""
    }.\nRedemption ID: \`${params.redemptionId}\`${fulfilmentLine}`;

    const mentionUsers = [params.buyerUserId, ...(validOwnerId ? [validOwnerId] : [])].filter(
      isDiscordSnowflake,
    );
    const mentionRoles = validFulfillerRoleId ? [validFulfillerRoleId] : [];

    const sent = await (channel as GuildTextBasedChannel)
      .send({
        content,
        components: [this.buildRedemptionActionRow(params.redemptionId)],
        allowedMentions: { users: mentionUsers, roles: mentionRoles },
      })
      .catch((error: unknown) => {
        console.error("Failed to post redemption fulfilment notice", error);
        return null;
      });

    if (!sent) {
      return null;
    }

    return { channelId: sent.channelId, messageId: sent.id };
  }

  private buildSubmissionActionRow(submissionId: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`submission:approve:${submissionId}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`submission:outstanding:${submissionId}`)
        .setLabel("Outstanding")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`submission:reject:${submissionId}`)
        .setLabel("Reject")
        .setStyle(ButtonStyle.Danger),
    );
  }

  private buildSubmissionReplaceRow(token: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`submission:replace:${token}`)
        .setLabel("Replace submission")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`submission:keep:${token}`)
        .setLabel("Keep current")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private async postSubmissionFeedEntry(params: {
    channelId: string;
    submissionId: string;
    studentUserId: string | null;
    studentDisplay: string;
    assignmentTitle: string;
    groupName: string;
    text: string;
    imageUrl: string | null;
  }): Promise<{ channelId: string; messageId: string } | null> {
    if (!this.client) {
      return null;
    }

    const channel = await this.client.channels.fetch(params.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error("Submission feed channel is missing or not text-based", {
        submissionId: params.submissionId,
        channelId: params.channelId,
      });
      return null;
    }

    const validUserId = isDiscordSnowflake(params.studentUserId) ? params.studentUserId : null;
    // Escape student-controlled text so titles/group names with `**`, backticks, or
    // bare `<@…>` strings can't break formatting or impersonate a mention.
    const safeStudentDisplay = validUserId ? null : escapeMarkdown(params.studentDisplay);
    const studentMention = validUserId ? `<@${validUserId}>` : safeStudentDisplay;
    const safeTitle = escapeMarkdown(params.assignmentTitle);
    const safeGroupName = params.groupName ? escapeMarkdown(params.groupName) : "No group";
    const trimmedText = params.text.trim();
    const mediaLabel = params.imageUrl ? `[Submission file](${params.imageUrl})` : "No attachment";
    const fields: { name: string; value: string; inline: boolean }[] = [
      {
        name: "Awaiting review",
        value: `📝 **${safeTitle}**\n${safeGroupName} · ${studentMention ?? "Unknown"}`,
        inline: false,
      },
      { name: "Group", value: safeGroupName, inline: true },
      { name: "ID", value: `\`${params.submissionId.slice(0, 8)}\``, inline: true },
      { name: "Media", value: mediaLabel, inline: true },
    ];
    if (trimmedText) {
      const preview = trimmedText.length > 700 ? `${trimmedText.slice(0, 697)}...` : trimmedText;
      fields.push({ name: "Note", value: preview, inline: false });
    }
    const embed = new EmbedBuilder()
      .setColor(FORBES_EMBED_COLOUR)
      .setTitle("Submission Review Board")
      .setDescription("Newest submission ready for admin review.")
      .addFields(fields)
      .setFooter({ text: "Accept awards base rewards. Outstanding adds bonus rewards. Reject lets the student resubmit." });

    const messagePayload = {
      embeds: [embed],
      components: [this.buildSubmissionActionRow(params.submissionId)],
      allowedMentions: { users: validUserId ? [validUserId] : [] },
    };
    const textChannel = channel as GuildTextBasedChannel;

    const sent = params.imageUrl
      ? await textChannel
          .send({
            ...messagePayload,
            files: [{ attachment: params.imageUrl, name: this.buildSubmissionMediaFilename(params.imageUrl) }],
          })
          .catch(async (error: unknown) => {
            console.error("Failed to attach submission media; posting link-only feed entry", {
              submissionId: params.submissionId,
              channelId: params.channelId,
              error,
            });
            return textChannel.send(messagePayload).catch((fallbackError: unknown) => {
              console.error("Failed to post submission feed entry", {
                submissionId: params.submissionId,
                channelId: params.channelId,
                error: fallbackError,
              });
              return null;
            });
          })
      : await textChannel.send(messagePayload).catch((error: unknown) => {
          console.error("Failed to post submission feed entry", {
            submissionId: params.submissionId,
            channelId: params.channelId,
            error,
          });
          return null;
        });

    if (!sent) {
      return null;
    }

    return { channelId: sent.channelId, messageId: sent.id };
  }

  private buildSubmissionMediaFilename(mediaUrl: string) {
    try {
      const pathname = new URL(mediaUrl).pathname;
      const filename = pathname.split("/").filter(Boolean).at(-1);
      if (filename) {
        return filename.replace(/[^\w.-]/g, "_");
      }
    } catch {
      // Fall through to the generic name below.
    }

    return "submission-file";
  }

  private async broadcastSubmissionToFeed(params: {
    submissionId: string;
    studentUserId: string | null;
    studentDisplay: string;
    assignmentTitle: string;
    groupName: string;
    text: string;
    imageUrl: string | null;
  }): Promise<void> {
    const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    if (!config.submissionFeedChannelId) {
      return;
    }

    const posted = await this.postSubmissionFeedEntry({
      channelId: config.submissionFeedChannelId,
      submissionId: params.submissionId,
      studentUserId: params.studentUserId,
      studentDisplay: params.studentDisplay,
      assignmentTitle: params.assignmentTitle,
      groupName: params.groupName,
      text: params.text,
      imageUrl: params.imageUrl,
    });

    if (posted) {
      const stamped = await this.services.submissionService
        .setFeedMessage({
          guildId: this.env.GUILD_ID,
          submissionId: params.submissionId,
          feedChannelId: posted.channelId,
          feedMessageId: posted.messageId,
        })
        .catch((error: unknown) => {
          console.error("Failed to record submission feed message id", {
            submissionId: params.submissionId,
            error,
          });
          return true;
        });

      if (!stamped) {
        // Submission was deleted between post and stamp — clean up the orphan.
        await this.deleteSubmissionFeedMessage({
          channelId: posted.channelId,
          messageId: posted.messageId,
        });
      }
    }
  }

  private async deleteSubmissionFeedMessage(params: { channelId: string; messageId: string }) {
    if (!this.client) {
      return;
    }
    const channel = await this.client.channels.fetch(params.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return;
    }
    await (channel as GuildTextBasedChannel).messages
      .delete(params.messageId)
      .catch((error: unknown) => {
        console.error("Failed to delete stale submission feed message", error);
      });
  }

  private buildPaginationRow(
    kind: PaginationKind,
    subkey: string,
    ownerId: string,
    page: number,
    hasPrev: boolean,
    hasNext: boolean,
  ) {
    if (!hasPrev && !hasNext) {
      return null;
    }
    const prev = new ButtonBuilder()
      .setCustomId(buildPaginationCustomId(kind, subkey, ownerId, Math.max(1, page - 1)))
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev);
    const next = new ButtonBuilder()
      .setCustomId(buildPaginationCustomId(kind, subkey, ownerId, page + 1))
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next);
  }

  private async handlePaginationButton(interaction: ButtonInteraction) {
    const parsed = parsePaginationCustomId(interaction.customId);
    if (!parsed) {
      return;
    }

    const isEphemeralSource = Boolean(interaction.message.flags?.has?.(MessageFlags.Ephemeral));
    if (!isEphemeralSource && parsed.kind !== "assignments" && parsed.ownerId !== interaction.user.id) {
      await interaction.reply({
        content: "Only the person who ran this command can page through it.",
        ephemeral: true,
      });
      return;
    }

    // Acknowledge within Discord's 3-second window before running DB/guild fetches,
    // which for /forbes pagination can exceed the limit on cold caches.
    await interaction.deferUpdate();

    const view = await (async () => {
      switch (parsed.kind) {
        case "inventory":
          return this.buildInventoryView({
            ownerId: parsed.ownerId,
            audience: parsed.subkey === "group" ? "group" : "personal",
            page: parsed.page,
            guild: interaction.guild,
          });
        case "store":
          return this.buildStoreView({
            ownerId: parsed.ownerId,
            audience: parsed.subkey === "group" ? "group" : "personal",
            page: parsed.page,
          });
        case "ledger":
          return this.buildLedgerView({ ownerId: parsed.ownerId, page: parsed.page });
        case "leaderboard":
          return this.buildLeaderboardView({ ownerId: parsed.ownerId, page: parsed.page });
        case "forbes":
          return this.buildForbesView({
            ownerId: parsed.ownerId,
            page: parsed.page,
            guild: interaction.guild,
          });
        case "assignments":
          return this.buildAssignmentsView({ ownerId: parsed.ownerId, page: parsed.page });
      }
    })();

    await interaction.editReply({ embeds: [view.embed], components: view.row ? [view.row] : [] });
  }

  private async buildInventoryView(params: {
    ownerId: string;
    audience: InventoryAudience;
    page: number;
    guild: ChatInputCommandInteraction["guild"] | null;
    displayName?: string;
  }) {
    const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    const redemptions = await this.fetchInventoryRedemptions(params);
    const paged = paginateArray(redemptions, params.page);
    const displayName = params.displayName ?? (await this.resolveOwnerDisplayName(params.guild, params.ownerId));
    const embed = this.buildInventoryEmbed({
      redemptions,
      config,
      displayName,
      audience: params.audience,
      paged,
    });
    const row = this.buildPaginationRow(
      "inventory",
      params.audience,
      params.ownerId,
      paged.clampedPage,
      paged.hasPrev,
      paged.hasNext,
    );
    return { embed, row };
  }

  private async fetchInventoryRedemptions(params: {
    ownerId: string;
    audience: InventoryAudience;
    guild: ChatInputCommandInteraction["guild"] | null;
  }): Promise<UserRedemption[]> {
    if (params.audience === "personal") {
      return this.services.shopService.listPersonalRedemptionsByUser(this.env.GUILD_ID, params.ownerId);
    }
    const member = await params.guild?.members.fetch(params.ownerId).catch(() => null);
    const roleIds = member ? this.getOrderedRoleIds(member) : [];
    const group = await this.services.groupService
      .resolveGroupFromRoleIds(this.env.GUILD_ID, roleIds)
      .catch(() => null);
    if (!group) {
      return [];
    }
    return this.services.shopService.listGroupRedemptionsByGroup(this.env.GUILD_ID, group.id);
  }

  private async resolveOwnerDisplayName(
    guild: ChatInputCommandInteraction["guild"] | null,
    ownerId: string,
  ) {
    const member = await guild?.members.fetch(ownerId).catch(() => null);
    return member?.displayName ?? member?.user?.globalName ?? member?.user?.username ?? ownerId;
  }

  private async buildStoreView(params: {
    ownerId: string;
    audience: StoreAudience;
    page: number;
  }) {
    const [config, items] = await Promise.all([
      this.services.configService.getOrCreate(this.env.GUILD_ID),
      this.services.shopService.list(this.env.GUILD_ID),
    ]);
    const wantedAudience = params.audience === "group" ? "GROUP" : "INDIVIDUAL";
    const filtered = items.filter((item) => item.enabled && item.audience === wantedAudience);
    const paged = paginateArray(filtered, params.page);
    const embed = this.buildStoreEmbed({
      config,
      audience: params.audience,
      totalItems: filtered.length,
      paged,
    });
    const row = this.buildPaginationRow(
      "store",
      params.audience,
      params.ownerId,
      paged.clampedPage,
      paged.hasPrev,
      paged.hasNext,
    );
    return { embed, row, totalItems: filtered.length };
  }

  private async buildLedgerView(params: { ownerId: string; page: number }) {
    const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    let page = Math.max(1, params.page);
    let offset = (page - 1) * PAGINATION_PAGE_SIZE;
    let entries = await this.services.economyService.getLedger(this.env.GUILD_ID, {
      limit: PAGINATION_PAGE_SIZE + 1,
      offset,
    });
    // Stale custom_id can point past the end (data shrank since the buttons were posted).
    // Fall back to page 1 so users aren't stranded on an empty page.
    if (entries.length === 0 && page > 1) {
      page = 1;
      offset = 0;
      entries = await this.services.economyService.getLedger(this.env.GUILD_ID, {
        limit: PAGINATION_PAGE_SIZE + 1,
        offset,
      });
    }
    const hasNext = entries.length > PAGINATION_PAGE_SIZE;
    const visible = entries.slice(0, PAGINATION_PAGE_SIZE);
    const embed = this.buildLedgerEmbed(visible, config, page, offset);
    const row = this.buildPaginationRow("ledger", "-", params.ownerId, page, page > 1, hasNext);
    return { embed, row, entryCount: visible.length };
  }

  private async buildLeaderboardView(params: { ownerId: string; page: number }) {
    const [leaderboard, config] = await Promise.all([
      this.services.economyService.getLeaderboard(this.env.GUILD_ID),
      this.services.configService.getOrCreate(this.env.GUILD_ID),
    ]);
    const paged = paginateArray(leaderboard, params.page);
    const embed = this.buildGroupLeaderboardEmbed(leaderboard, config, paged);
    const row = this.buildPaginationRow(
      "leaderboard",
      "-",
      params.ownerId,
      paged.clampedPage,
      paged.hasPrev,
      paged.hasNext,
    );
    return { embed, row, totalEntries: leaderboard.length };
  }

  private async buildForbesView(params: {
    ownerId: string;
    page: number;
    guild: ChatInputCommandInteraction["guild"] | null;
  }) {
    const [leaderboard, config] = await Promise.all([
      this.services.participantService.getCurrencyLeaderboard(this.env.GUILD_ID),
      this.services.configService.getOrCreate(this.env.GUILD_ID),
    ]);
    const paged = paginateArray(leaderboard, params.page);
    const displayNames = await this.resolveParticipantDisplayNames(params.guild, paged.slice);
    const embed = this.buildForbesEmbed(leaderboard, displayNames, config, paged);
    const row = this.buildPaginationRow(
      "forbes",
      "-",
      params.ownerId,
      paged.clampedPage,
      paged.hasPrev,
      paged.hasNext,
    );
    return { embed, row, totalEntries: leaderboard.length };
  }

  private async buildAssignmentsView(params: { ownerId: string; page: number }) {
    const participant = await this.services.participantService
      .findByDiscordUser(this.env.GUILD_ID, params.ownerId)
      .catch(() => null);
    const [config, activeAssignments, submittedAssignmentIds] = await Promise.all([
      this.services.configService.getOrCreate(this.env.GUILD_ID),
      this.services.assignmentService.listActive(this.env.GUILD_ID),
      participant
        ? this.services.submissionService.listAssignmentIdsForParticipant({
            guildId: this.env.GUILD_ID,
            participantId: participant.id,
          })
        : Promise.resolve(new Set<string>()),
    ]);
    const assignments = this.sortAssignmentsRecentFirst(activeAssignments);
    const paged = paginateArray(assignments, params.page);
    const embed = this.buildAssignmentsEmbed(assignments, config, paged, submittedAssignmentIds);
    const row = this.buildPaginationRow(
      "assignments",
      "-",
      params.ownerId,
      paged.clampedPage,
      paged.hasPrev,
      paged.hasNext,
    );
    return { embed, row, totalEntries: assignments.length };
  }

  private async checkRedemptionActorPermissions(params: {
    redemption: NonNullable<Awaited<ReturnType<AppServices["shopService"]["getRedemption"]>>>;
    actorUserId: string;
    memberPermissions: ChatInputCommandInteraction["memberPermissions"];
    roleIds: string[];
  }): Promise<{ isOwner: boolean; isStaff: boolean; isFulfiller: boolean }> {
    // Authorize against the owner snapshot recorded when a notice was posted,
    // so re-assigning the item later doesn't yank fulfil/cancel rights from
    // the person actually @mentioned in the channel. fulfilmentMessageId is
    // the proxy for "snapshot recorded": once non-null, ownerUserIdAtPurchase
    // is the source of truth — it may itself be null, meaning the item had no
    // owner at purchase time. Only fall back to the live item owner for
    // legacy rows that never had a notice posted.
    const snapshotTaken = params.redemption.fulfilmentMessageId !== null;
    const ownerForRedemption = snapshotTaken
      ? params.redemption.ownerUserIdAtPurchase
      : params.redemption.shopItem.ownerUserId;
    const isOwner =
      ownerForRedemption !== null && ownerForRedemption === params.actorUserId;
    const hasStaffPerms = params.memberPermissions
      ? params.memberPermissions.has(PermissionFlagsBits.Administrator) ||
        params.memberPermissions.has(PermissionFlagsBits.ManageGuild)
      : false;

    let isStaff = hasStaffPerms;
    if (!isStaff) {
      const capabilities = await this.services.roleCapabilityService.listForRoleIds(
        this.env.GUILD_ID,
        params.roleIds,
      );
      const resolved = resolveCapabilities(capabilities);
      isStaff = resolved.canManageDashboard || resolved.canAward || resolved.canDeduct;
    }

    const fulfillerRoleId = params.redemption.shopItem.fulfillerRoleId;
    const isFulfiller =
      fulfillerRoleId !== null && params.roleIds.includes(fulfillerRoleId);

    return { isOwner, isStaff, isFulfiller };
  }

  private async handleRedemptionButton(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    if (parts.length !== 3 || parts[0] !== "redemption") {
      return;
    }

    const [, action, redemptionId] = parts;
    if (action !== "fulfil" && action !== "cancel") {
      return;
    }

    const redemption = await this.services.shopService.getRedemption(this.env.GUILD_ID, redemptionId);
    if (!redemption) {
      await interaction.reply({ content: "Redemption not found.", ephemeral: true });
      return;
    }

    const guildMember = await interaction.guild?.members
      .fetch(interaction.user.id)
      .catch(() => null) ?? null;
    const rawMember = interaction.member;
    const apiRoleIds =
      rawMember && "roles" in rawMember && Array.isArray((rawMember as { roles: unknown }).roles)
        ? ((rawMember as { roles: string[] }).roles)
        : [];
    const roleIds = guildMember ? this.getOrderedRoleIds(guildMember) : apiRoleIds;
    const memberPermissions = interaction.memberPermissions ?? guildMember?.permissions ?? null;
    const { isOwner, isStaff, isFulfiller } = await this.checkRedemptionActorPermissions({
      redemption,
      actorUserId: interaction.user.id,
      memberPermissions,
      roleIds,
    });

    if (!isOwner && !isStaff && !isFulfiller) {
      await interaction.reply({
        content: "Only the item owner, fulfiller role, or staff can act on this purchase.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();

    const nextStatus = action === "fulfil" ? "FULFILLED" : "CANCELED";

    try {
      const { redemption: updated, changed } = await this.services.shopService.updateRedemptionStatus({
        guildId: this.env.GUILD_ID,
        redemptionId,
        status: nextStatus,
        actorUserId: interaction.user.id,
        actorUsername: interaction.user.username,
      });

      if (!changed) {
        await interaction.followUp({
          content: `Redemption \`${redemptionId}\` is already **${updated.status}**.`,
          ephemeral: true,
        });
        return;
      }

      const actionLabel =
        nextStatus === "FULFILLED"
          ? `fulfilled by <@${interaction.user.id}>`
          : `cancelled and refunded by <@${interaction.user.id}>`;

      const originalContent = interaction.message?.content ?? `Redemption \`${redemptionId}\``;
      await interaction.editReply({
        content: `${originalContent}\n\n**Status:** ${updated.status} — ${actionLabel}.`,
        components: [],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Failed to update redemption.";
      await interaction.followUp({ content: message, ephemeral: true });
    }
  }

  private async handleSubmissionButton(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    if (parts.length !== 3 || parts[0] !== "submission") {
      return;
    }

    const [, action, submissionId] = parts;
    if (action === "replace" || action === "keep") {
      await this.handleSubmissionReplacementButton(interaction, action, submissionId);
      return;
    }

    if (action !== "approve" && action !== "outstanding" && action !== "reject") {
      return;
    }

    const isRewardAction = action === "approve" || action === "outstanding";

    // Defer immediately so slow auth/work stays inside Discord's 3s acknowledgement
    // window. Reward actions use deferUpdate (we'll edit the original feed message);
    // reject uses an ephemeral reply (we'll delete the original message separately).
    if (isRewardAction) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ ephemeral: true });
    }

    const respondWithError = async (message: string) => {
      if (isRewardAction) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      } else {
        await interaction.editReply({ content: message }).catch(() => {});
      }
    };

    const guildMember = await interaction.guild?.members
      .fetch(interaction.user.id)
      .catch(() => null) ?? null;
    const rawMember = interaction.member;
    const apiRoleIds =
      rawMember && "roles" in rawMember && Array.isArray((rawMember as { roles: unknown }).roles)
        ? ((rawMember as { roles: string[] }).roles)
        : [];
    const roleIds = guildMember ? this.getOrderedRoleIds(guildMember) : apiRoleIds;

    try {
      await this.assertCanManageSubmissions(guildMember, roleIds);
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Only staff can review submissions.";
      await respondWithError(message);
      return;
    }

    if (isRewardAction) {
      const status = action === "outstanding" ? "OUTSTANDING" : "APPROVED";
      let reviewed: Awaited<ReturnType<AppServices["submissionService"]["review"]>>;
      try {
        reviewed = await this.services.submissionService.review({
          guildId: this.env.GUILD_ID,
          submissionId,
          status,
          reviewedByUserId: interaction.user.id,
          reviewedByUsername: interaction.user.username,
        });
      } catch (error) {
        const message = error instanceof AppError ? error.message : "Failed to review submission.";
        await respondWithError(message);
        return;
      }

      const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
      const rewardParts: string[] = [];
      if (reviewed.pointsAwarded && reviewed.pointsAwarded > 0) {
        rewardParts.push(this.formatPointsAmount(reviewed.pointsAwarded, config));
      }
      if (reviewed.currencyAwarded && reviewed.currencyAwarded > 0) {
        rewardParts.push(this.formatCurrencyAmount(reviewed.currencyAwarded, config));
      }
      const rewardSuffix = rewardParts.length > 0 ? ` — +${rewardParts.join(" + ")}` : "";
      const reviewLabel = status === "OUTSTANDING" ? "Outstanding" : "Approved";
      const reviewIcon = status === "OUTSTANDING" ? "⭐" : "✅";
      const approvalLine = `\n\n${reviewIcon} ${reviewLabel} by <@${interaction.user.id}>${rewardSuffix}`;
      const rawOriginal = interaction.message?.content ?? "";
      const maxOriginalLen = Math.max(0, 1900 - approvalLine.length);
      const trimmedOriginal =
        rawOriginal.length > maxOriginalLen ? `${rawOriginal.slice(0, maxOriginalLen)}…` : rawOriginal;
      const updatedContent = `${trimmedOriginal}${approvalLine}`.trim();

      try {
        await interaction.editReply({
          content: updatedContent,
          components: [],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        console.error("Failed to update submission feed message after review", { submissionId, status, error });
      }
      return;
    }

    // Reject path: delete the record + the feed message + best-effort R2 cleanup.
    let deleted: Awaited<ReturnType<AppServices["submissionService"]["deletePending"]>>;
    try {
      deleted = await this.services.submissionService.deletePending({
        guildId: this.env.GUILD_ID,
        submissionId,
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Failed to reject submission.";
      await respondWithError(message);
      return;
    }

    console.info("Submission rejected via feed channel", {
      submissionId,
      rejecterUserId: interaction.user.id,
      rejecterUsername: interaction.user.username,
    });

    if (deleted.imageKey && this.storageService.isConfigured) {
      await this.storageService.delete(deleted.imageKey).catch(() => {});
    }

    await interaction.message?.delete().catch((error: unknown) => {
      console.error("Failed to delete submission feed message after reject", { submissionId, error });
    });

    await interaction.editReply({
      content: `Rejected submission \`${submissionId.slice(0, 8)}\`. The student can resubmit.`,
    });
  }

  private rememberPendingSubmissionReplacement(payload: Omit<PendingSubmissionReplacement, "createdAt">) {
    const now = Date.now();
    for (const [token, pending] of this.pendingSubmissionReplacements) {
      if (now - pending.createdAt > 15 * 60 * 1000) {
        this.pendingSubmissionReplacements.delete(token);
      }
    }

    const token = randomUUID().replace(/-/g, "").slice(0, 18);
    this.pendingSubmissionReplacements.set(token, { ...payload, createdAt: now });
    return token;
  }

  private async promptSubmissionReplacement(
    reply: (payload: {
      content: string;
      components: ActionRowBuilder<ButtonBuilder>[];
    }) => Promise<unknown>,
    payload: Omit<PendingSubmissionReplacement, "createdAt">,
    assignmentTitle: string,
  ) {
    const token = this.rememberPendingSubmissionReplacement(payload);
    await reply({
      content: `You already have a pending submission for **${assignmentTitle}**. Replace your last submission? The old one will be lost.`,
      components: [this.buildSubmissionReplaceRow(token)],
    });
  }

  private async submitPreparedReplacement(payload: PendingSubmissionReplacement) {
    const result = await this.services.submissionService.createOrReplace({
      guildId: payload.guildId,
      assignmentId: payload.assignmentId,
      participantId: payload.participantId,
      text: payload.text,
      imageUrl: payload.imageUrl,
      imageKey: payload.imageKey,
    });

    if (
      result.replaced &&
      result.previousImageKey &&
      result.previousImageKey !== payload.imageKey &&
      this.storageService.isConfigured
    ) {
      await this.storageService.delete(result.previousImageKey).catch(() => {});
    }

    if (result.replaced && result.previousFeedChannelId && result.previousFeedMessageId) {
      await this.deleteSubmissionFeedMessage({
        channelId: result.previousFeedChannelId,
        messageId: result.previousFeedMessageId,
      });
    }

    await this.broadcastSubmissionToFeed({
      submissionId: result.submission.id,
      studentUserId: payload.userId,
      studentDisplay: payload.studentDisplay,
      assignmentTitle: result.submission.assignment.title,
      groupName: result.submission.group?.displayName ?? "",
      text: payload.text,
      imageUrl: result.submission.imageUrl,
    });

    return result;
  }

  private async handleSubmissionReplacementButton(
    interaction: ButtonInteraction,
    action: "replace" | "keep",
    token: string,
  ) {
    const pending = this.pendingSubmissionReplacements.get(token);
    if (!pending) {
      await interaction.reply({
        content: "That replacement confirmation has expired. Run /submit again.",
        ephemeral: true,
      });
      return;
    }

    if (pending.userId !== interaction.user.id) {
      await interaction.reply({
        content: "Only the person who started this submission can confirm replacement.",
        ephemeral: true,
      });
      return;
    }

    this.pendingSubmissionReplacements.delete(token);

    if (action === "keep") {
      await interaction.update({
        content: "Kept your existing submission. Nothing was replaced.",
        components: [],
      });
      return;
    }

    await interaction.deferUpdate();
    try {
      const result = await this.submitPreparedReplacement(pending);
      await interaction.editReply({
        content: "Submission replacement confirmed.",
        components: [],
      });
      await interaction.followUp({
        content: this.buildSubmissionReceiptContent({
          action: "updated",
          assignmentTitle: result.submission.assignment.title,
          groupName: result.submission.group?.displayName,
          studentUserId: interaction.user.id,
        }),
        allowedMentions: this.buildStudentAllowedMentions(interaction.user.id),
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Something went wrong replacing your submission.";
      await interaction.editReply({ content: message, components: [] }).catch(() => {});
    }
  }

  private async assertCanManageSubmissions(member: GuildMember | null, roleIds: string[]) {
    if (!member) {
      throw new AppError("This command is only available to configured staff roles.", 403);
    }

    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      return;
    }

    const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    if (roleIds.some((roleId) => config.mentorRoleIds.includes(roleId))) {
      return;
    }

    const capabilities = await this.services.roleCapabilityService.listForRoleIds(this.env.GUILD_ID, roleIds);
    const resolved = resolveCapabilities(capabilities);
    const canManageSubmissions = resolved.canManageDashboard || resolved.canAward || resolved.canDeduct;

    if (!canManageSubmissions) {
      throw new AppError("This command is only available to configured staff roles.", 403);
    }
  }

  private async canBypassActionCooldown(member: GuildMember | null, roleIds: string[]) {
    if (!member) {
      return false;
    }

    const hasPermission = (permission: bigint) => member.permissions?.has(permission) ?? false;

    if (
      hasPermission(PermissionFlagsBits.Administrator) ||
      hasPermission(PermissionFlagsBits.ManageGuild)
    ) {
      return true;
    }

    const capabilities = await this.services.roleCapabilityService.listForRoleIds(this.env.GUILD_ID, roleIds);
    const resolved = resolveCapabilities(capabilities);
    return resolved.canManageDashboard;
  }

  private resolveRoleActionCooldownSeconds(params: {
    capabilities: Awaited<ReturnType<AppServices["roleCapabilityService"]["listForRoleIds"]>>;
    isDeduction: boolean;
  }) {
    const matchingCooldowns = params.capabilities
      .filter((capability) => (params.isDeduction ? capability.canDeduct : capability.canAward))
      .map((capability) => capability.actionCooldownSeconds ?? DEFAULT_ROLE_ACTION_COOLDOWN_SECONDS);

    if (matchingCooldowns.length === 0) {
      return null;
    }

    return Math.min(...matchingCooldowns);
  }

  private async enforceAwardCommandCooldown(
    params: {
      member: GuildMember | null;
      roleIds: string[];
      userId: string;
      isDeduction: boolean;
    },
  ) {
    if (await this.canBypassActionCooldown(params.member, params.roleIds)) {
      return null;
    }

    const capabilities = await this.services.roleCapabilityService.listForRoleIds(this.env.GUILD_ID, params.roleIds);
    const cooldownSeconds = this.resolveRoleActionCooldownSeconds({
      capabilities,
      isDeduction: params.isDeduction,
    });
    if (cooldownSeconds === null || cooldownSeconds <= 0) {
      return null;
    }

    const actionKind = params.isDeduction ? "deduct" : "award";
    const cooldownKey = `${this.env.GUILD_ID}:${params.userId}:${actionKind}`;
    const now = Date.now();
    const previous = this.actionCooldowns.get(cooldownKey);
    const cooldownMs = cooldownSeconds * 1000;

    if (previous && now - previous.seenAt < cooldownMs) {
      const remainingSeconds = Math.max(1, Math.ceil((cooldownMs - (now - previous.seenAt)) / 1000));
      throw new AppError(`Wait ${remainingSeconds}s before using another ${actionKind} command.`, 429);
    }

    this.actionCooldowns.set(cooldownKey, { seenAt: now });

    return () => {
      if (previous) {
        this.actionCooldowns.set(cooldownKey, previous);
      } else {
        this.actionCooldowns.delete(cooldownKey);
      }
    };
  }

  private checkBettingCooldown(
    userId: string,
    cooldownSeconds: number,
  ): string | null {
    if (cooldownSeconds <= 0) {
      return null;
    }

    const key = `${this.env.GUILD_ID}:${userId}:bet`;
    const entry = this.bettingCooldowns.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    const cooldownMs = cooldownSeconds * 1000;
    const elapsed = now - entry.lastBetAt;
    if (elapsed >= cooldownMs) {
      return null;
    }

    const offenses = entry.offenses + 1;
    this.bettingCooldowns.set(key, { lastBetAt: entry.lastBetAt, offenses });

    const remaining = this.formatDuration(Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000)));
    return this.buildBettingRebuke(offenses, remaining);
  }

  private recordBetPlaced(userId: string, cooldownSeconds: number) {
    if (cooldownSeconds <= 0) {
      return;
    }
    const key = `${this.env.GUILD_ID}:${userId}:bet`;
    this.bettingCooldowns.set(key, { lastBetAt: Date.now(), offenses: 0 });
  }

  private buildBettingRebuke(offenses: number, remaining: string): string {
    switch (offenses) {
      case 1:
        return `🛑 OK hang on. ${remaining} more before you can bet. Go touch some grass.`;
      case 2:
        return `😅 Still ${remaining} to go. Wait a bit OK.`;
      case 3:
        return `🚧 ${remaining} more. Go find a proper hobby.`;
      case 4:
        return `🧠 Another ${remaining}. This isn't a cry for points... it's a cry for help.`;
      default:
        return `⛔ ${remaining}. I'm calling security. You need help.`;
    }
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
  }

  private resolveActiveAssignment(assignments: ActiveAssignment[], identifier: string): AssignmentLookupResult {
    const value = identifier.trim();
    if (!value) {
      return { kind: "missing" };
    }

    const exactIdMatch = assignments.find((assignment) => assignment.id === value);
    if (exactIdMatch) {
      return { kind: "resolved", assignment: exactIdMatch };
    }

    const titleMatches = assignments.filter((assignment) => assignment.title.toLowerCase() === value.toLowerCase());
    if (titleMatches.length === 1) {
      return { kind: "resolved", assignment: titleMatches[0]! };
    }
    if (titleMatches.length > 1) {
      return { kind: "ambiguous", matches: titleMatches };
    }

    const idPrefixMatches = assignments.filter((assignment) => assignment.id.startsWith(value));
    if (idPrefixMatches.length === 1) {
      return { kind: "resolved", assignment: idPrefixMatches[0]! };
    }
    if (idPrefixMatches.length > 1) {
      return { kind: "ambiguous", matches: idPrefixMatches };
    }

    return { kind: "missing" };
  }

  private formatAssignmentChoices(assignments: ActiveAssignment[]) {
    return assignments.length > 0
      ? assignments.map((assignment) => `"${assignment.title}" [${assignment.id}]`).join(", ")
      : "none";
  }

  private formatAssignmentChoiceCards(assignments: ActiveAssignment[]) {
    if (assignments.length === 0) {
      return "No active assignments are open right now.";
    }

    const visibleAssignments = this.sortAssignmentsRecentFirst(assignments).slice(0, PAGINATION_PAGE_SIZE);
    const assignmentLines = visibleAssignments.map((assignment, index) => {
      const rank = `#${index + 1}`;
      return `${rank} **${escapeMarkdown(assignment.title)}**\nID \`${assignment.id}\``;
    });

    if (assignments.length > visibleAssignments.length) {
      assignmentLines.push(`+${assignments.length - visibleAssignments.length} more. Use /assignments to browse the full list.`);
    }

    return this.truncateText(assignmentLines.join("\n\n"), ASSIGNMENT_CHOICE_FIELD_VALUE_MAX);
  }

  private buildMissingAssignmentEmbed(identifier: string, assignments: ActiveAssignment[]) {
    const trimmedIdentifier = identifier.trim();
    const escapedIdentifier = this.truncateText(
      escapeMarkdown(trimmedIdentifier),
      MISSING_ASSIGNMENT_IDENTIFIER_MAX,
    );
    const description = trimmedIdentifier
      ? `No active assignment matches **${escapedIdentifier}**.`
      : "Please include an active assignment name or ID.";

    const fields: { name: string; value: string; inline: boolean }[] = [
      {
        name: assignments.length > 0 ? "Available assignments" : "Active assignments",
        value: this.formatAssignmentChoiceCards(assignments),
        inline: false,
      },
    ];

    if (assignments.length > 0) {
      fields.push({
        name: "Assignments tracked",
        value: `${assignments.length}`,
        inline: true,
      });
    }

    return new EmbedBuilder()
      .setColor(FORBES_EMBED_COLOUR)
      .setTitle("Assignment Not Found")
      .setDescription(description)
      .addFields(fields)
      .setFooter({ text: "Copy an ID into /submit if titles are similar." });
  }

  private sortAssignmentsRecentFirst(assignments: ActiveAssignment[]) {
    return [...assignments].sort((a, b) => {
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return (b.sortOrder ?? 0) - (a.sortOrder ?? 0);
    });
  }

  private formatAssignmentRewards(assignment: ActiveAssignment, config: GuildConfig) {
    const baseParts: string[] = [];
    if (assignment.basePointsReward > 0) {
      baseParts.push(this.formatPointsAmount(assignment.basePointsReward, config));
    }
    if (assignment.baseCurrencyReward > 0) {
      baseParts.push(this.formatCurrencyAmount(assignment.baseCurrencyReward, config));
    }

    const bonusParts: string[] = [];
    if (assignment.bonusPointsReward > 0) {
      bonusParts.push(this.formatPointsAmount(assignment.bonusPointsReward, config));
    }
    if (assignment.bonusCurrencyReward > 0) {
      bonusParts.push(this.formatCurrencyAmount(assignment.bonusCurrencyReward, config));
    }

    const parts: string[] = [];
    if (baseParts.length > 0) {
      parts.push(`Reward ${baseParts.join(" + ")}`);
    }
    if (bonusParts.length > 0) {
      parts.push(`Outstanding +${bonusParts.join(" + ")}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "No reward configured";
  }

  private formatAssignmentLine(
    assignment: ActiveAssignment,
    config: GuildConfig,
    submittedAssignmentIds: Set<string>,
  ) {
    const meta = [
      submittedAssignmentIds.has(assignment.id) ? "✅ Submitted" : "Not submitted",
      this.formatAssignmentRewards(assignment, config),
    ];
    if (assignment.deadline) {
      const deadlineSeconds = Math.floor(new Date(assignment.deadline).getTime() / 1000);
      meta.push(`Due <t:${deadlineSeconds}:R>`);
    }
    if (typeof assignment.submissionCount === "number") {
      meta.push(`${assignment.submissionCount} submitted`);
    }

    const description = assignment.description.trim();
    const clippedDescription = description.length > 180 ? `${description.slice(0, 177)}...` : description;
    return [
      clippedDescription,
      meta.join(" · "),
      `ID \`${assignment.id}\``,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private normalizeSubmissionLink(value: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return "";
    }

    try {
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      return url.toString();
    } catch {
      throw new AppError("Link must be a valid http or https URL, for example code.tk.sg.", 400);
    }
  }

  private buildSubmissionText(note: string, link: string) {
    const parts: string[] = [];
    const trimmedNote = note.trim();
    if (trimmedNote) {
      parts.push(trimmedNote);
    }
    if (link) {
      parts.push(`Link: ${link}`);
    }
    return parts.join("\n\n");
  }

  private isSupportedSubmissionAttachment(contentType: string | null | undefined) {
    return contentType?.startsWith("image/") || contentType?.startsWith("video/");
  }

  private formatGroupPurchaseProgress(approvalsCount: number, threshold: number) {
    return `${approvalsCount}/${threshold} approval${threshold === 1 ? "" : "s"}`;
  }

  private formatUserReference(discordUserId: string | null | undefined, fallbackLabel: string) {
    return discordUserId ? `<@${discordUserId}>` : fallbackLabel;
  }

  private formatGroupReference(group: { roleId?: string | null; displayName: string }) {
    return group.roleId ? `<@&${group.roleId}>` : group.displayName;
  }

  private formatParticipantReference(
    participant: {
      discordUserId?: string | null;
      discordUsername?: string | null;
      indexId: string;
    },
    fallbackLabel?: string,
  ) {
    return this.formatUserReference(
      participant.discordUserId,
      fallbackLabel ?? participant.discordUsername ?? participant.indexId,
    );
  }

  private buildSubmissionReceiptContent(params: {
    action: "received" | "updated";
    assignmentTitle: string;
    groupName: string | null | undefined;
    studentUserId: string;
  }) {
    const actionLabel = params.action === "updated" ? "Submission updated" : "Submission received";
    return `<@${params.studentUserId}> ${actionLabel} for **${params.assignmentTitle}** (${params.groupName ?? "your group"}). It will be reviewed by an admin.`;
  }

  private buildStudentAllowedMentions(studentUserId: string) {
    return { parse: [], users: isDiscordSnowflake(studentUserId) ? [studentUserId] : [] };
  }

  private async sendSubmissionReceiptToChannel(
    channel: ChatInputCommandInteraction["channel"],
    params: {
      action: "received" | "updated";
      assignmentTitle: string;
      groupName: string | null | undefined;
      studentUserId: string;
    },
  ) {
    if (!channel?.isTextBased()) {
      throw new AppError("Submission saved, but I could not post the public channel receipt.", 503);
    }

    await (channel as GuildTextBasedChannel).send({
      content: this.buildSubmissionReceiptContent(params),
      allowedMentions: this.buildStudentAllowedMentions(params.studentUserId),
    });
  }

  private formatRankMarker(index: number) {
    switch (index) {
      case 0:
        return "🥇";
      case 1:
        return "🥈";
      case 2:
        return "🥉";
      default:
        return `#${index + 1}`;
    }
  }

  private buildGroupLeaderboardEmbed(
    leaderboard: GroupLeaderboardEntry[],
    config: GuildConfig,
    paged: ReturnType<typeof paginateArray<GroupLeaderboardEntry>>,
  ) {
    const totalPoints = leaderboard.reduce((sum, group) => sum + group.pointsBalance, 0);
    const onFirstPage = paged.clampedPage === 1;
    const featuredCount = onFirstPage ? Math.min(LEADERBOARD_FEATURED_COUNT, paged.slice.length) : 0;
    const featuredGroups = paged.slice.slice(0, featuredCount);
    const compactGroups = paged.slice.slice(featuredCount);
    const standings = featuredGroups
      .map(
        (group, index) =>
          `${this.formatRankMarker(index)} **${group.displayName}**\n${this.formatPointsAmount(group.pointsBalance, config)}`,
      )
      .join("\n\n");
    const compactStandings = compactGroups
      .map((group, index) => {
        const rank = paged.startIndex + featuredCount + index + 1;
        return `#${rank} **${group.displayName}** · ${this.formatPointsAmount(group.pointsBalance, config)}`;
      })
      .join("\n");
    const fields: { name: string; value: string; inline: boolean }[] = [];
    if (standings) fields.push({ name: "Standings", value: standings, inline: false });
    if (compactStandings)
      fields.push({ name: onFirstPage ? "Also ranked" : "Standings", value: compactStandings, inline: false });
    fields.push({ name: "Groups", value: `${leaderboard.length}`, inline: true });
    fields.push({ name: "Total in play", value: this.formatPointsAmount(totalPoints, config), inline: true });
    if (paged.totalPages > 1) {
      fields.push({ name: "Page", value: `${paged.clampedPage}/${paged.totalPages}`, inline: true });
    }

    const embed = new EmbedBuilder()
      .setColor(GROUP_LEADERBOARD_COLOUR)
      .setTitle("Group Leaderboard")
      .setDescription(
        `${leaderboard.length} group${leaderboard.length === 1 ? "" : "s"} ranked by shared ${config.pointsName}.`,
      )
      .addFields(fields)
      .setFooter({ text: `Shared ${config.pointsName} drive the public board and /buy group.` });
    return embed;
  }

  private async resolveParticipantDisplayNames(
    guild: ChatInputCommandInteraction["guild"],
    participants: CurrencyLeaderboardEntry[],
  ) {
    const fallbackEntries = participants.map((participant) => [
      participant.id,
      participant.discordUsername ?? participant.indexId,
    ] as const);
    if (!guild) {
      return new Map(fallbackEntries);
    }

    const resolvedEntries = await Promise.all(
      participants.map(async (participant) => {
        const member = await guild.members.fetch(participant.discordUserId).catch(() => null);
        return [
          participant.id,
          member?.displayName || member?.user?.globalName || participant.discordUsername || participant.indexId,
        ] as const;
      }),
    );

    return new Map(resolvedEntries);
  }

  private buildForbesEmbed(
    leaderboard: CurrencyLeaderboardEntry[],
    displayNames: Map<string, string>,
    config: GuildConfig,
    paged: ReturnType<typeof paginateArray<CurrencyLeaderboardEntry>>,
  ) {
    const totalCurrency = leaderboard.reduce((sum, participant) => sum + participant.currencyBalance, 0);
    const onFirstPage = paged.clampedPage === 1;
    const featuredCount = onFirstPage ? Math.min(LEADERBOARD_FEATURED_COUNT, paged.slice.length) : 0;
    const featuredParticipants = paged.slice.slice(0, featuredCount);
    const compactParticipants = paged.slice.slice(featuredCount);
    const standings = featuredParticipants
      .map((participant, index) => {
        const displayName = this.formatParticipantReference(
          participant,
          displayNames.get(participant.id) ?? participant.discordUsername ?? participant.indexId,
        );
        return `${this.formatRankMarker(index)} **${displayName}**\n${this.formatCurrencyAmount(participant.currencyBalance, config)}`;
      })
      .join("\n\n");
    const compactStandings = compactParticipants
      .map((participant, index) => {
        const displayName = this.formatParticipantReference(
          participant,
          displayNames.get(participant.id) ?? participant.discordUsername ?? participant.indexId,
        );
        const rank = paged.startIndex + featuredCount + index + 1;
        return `#${rank} **${displayName}** · ${this.formatCurrencyAmount(participant.currencyBalance, config)}`;
      })
      .join("\n");
    const fields: { name: string; value: string; inline: boolean }[] = [];
    if (standings) fields.push({ name: "Standings", value: standings, inline: false });
    if (compactStandings)
      fields.push({ name: onFirstPage ? "Also ranked" : "Standings", value: compactStandings, inline: false });
    fields.push({ name: "Wallets tracked", value: `${leaderboard.length}`, inline: true });
    fields.push({ name: "Total held", value: this.formatCurrencyAmount(totalCurrency, config), inline: true });
    if (paged.totalPages > 1) {
      fields.push({ name: "Page", value: `${paged.clampedPage}/${paged.totalPages}`, inline: true });
    }

    const embed = new EmbedBuilder()
      .setColor(FORBES_EMBED_COLOUR)
      .setTitle("Forbes Wallet Board")
      .setDescription(
        `${leaderboard.length} participant${leaderboard.length === 1 ? "" : "s"} ranked by wallet ${config.currencyName}.`,
      )
      .addFields(fields)
      .setFooter({ text: "Server display names are shown when Discord can resolve them." });
    return embed;
  }

  private buildAssignmentsEmbed(
    assignments: ActiveAssignment[],
    config: GuildConfig,
    paged: ReturnType<typeof paginateArray<ActiveAssignment>>,
    submittedAssignmentIds: Set<string>,
  ) {
    const fields = paged.slice.map((assignment) => ({
      name: `📝 ${escapeMarkdown(assignment.title)}`,
      value: this.formatAssignmentLine(assignment, config, submittedAssignmentIds),
      inline: false,
    }));
    const footerParts = ["Use /submit with a note, link, image, or video"];
    if (paged.totalPages > 1) {
      footerParts.push(`page ${paged.clampedPage}/${paged.totalPages}`);
    }

    return new EmbedBuilder()
      .setColor(ASSIGNMENTS_EMBED_COLOUR)
      .setTitle("Active Assignments")
      .setDescription(
        `${assignments.length} active assignment${assignments.length === 1 ? "" : "s"}, newest first.`,
      )
      .addFields(fields)
      .setFooter({ text: footerParts.join(" · ") });
  }

  private formatStoreLine(item: ShopListItem, priceLabel: string) {
    const emoji = item.emoji ? `${item.emoji} ` : "";
    const parts = [`${emoji}**${item.name}**`, priceLabel];
    if (item.stock !== null) {
      parts.push(item.stock > 0 ? `${item.stock} left` : "sold out");
    }
    return `• ${parts.join(" · ")}`;
  }

  private formatInventoryStatus(status: UserRedemption["status"]) {
    switch (status) {
      case "FULFILLED":
        return "✅ Fulfilled";
      case "PENDING":
        return "📦 Pending fulfilment";
      case "AWAITING_APPROVAL":
        return "⏳ Awaiting approval";
      case "CANCELED":
        return "🚫 Canceled";
      default:
        return status;
    }
  }

  private formatInventoryLine(redemption: UserRedemption, config: GuildConfig) {
    const emoji = redemption.shopItem.emoji ? `${redemption.shopItem.emoji} ` : "";
    const unitLabel =
      redemption.purchaseMode === "GROUP"
        ? this.formatPointsAmount(redemption.totalCost.toString(), config)
        : this.formatCurrencyAmount(redemption.totalCost.toString(), config);
    const timestamp = Math.floor(new Date(redemption.createdAt).getTime() / 1000);
    const quantityLabel = redemption.quantity > 1 ? ` ×${redemption.quantity}` : "";
    const lines = [
      `${emoji}**${redemption.shopItem.name}**${quantityLabel}`,
      `${this.formatInventoryStatus(redemption.status)} · ${unitLabel} · <t:${timestamp}:R>`,
    ];
    return lines.join("\n");
  }

  private buildInventoryEmbed(params: {
    redemptions: UserRedemption[];
    config: GuildConfig;
    displayName: string;
    audience: InventoryAudience;
    paged: ReturnType<typeof paginateArray<UserRedemption>>;
  }) {
    const { redemptions, config, displayName, audience, paged } = params;
    const fulfilled = redemptions.filter((redemption) => redemption.status === "FULFILLED");
    const totalItems = fulfilled.reduce((sum, redemption) => sum + redemption.quantity, 0);
    const pendingCount = redemptions.filter(
      (redemption) => redemption.status === "PENDING" || redemption.status === "AWAITING_APPROVAL",
    ).length;

    const titleSuffix = audience === "personal" ? "personal inventory" : "group purchases";
    const emptyHint =
      audience === "personal"
        ? "Nothing yet — try `/store personal` to see what's for sale."
        : "No group purchases yet — try `/store group` to see what's for sale.";
    const description =
      redemptions.length === 0
        ? emptyHint
        : paged.slice
            .map((redemption) => `• ${this.formatInventoryLine(redemption, config)}`)
            .join("\n\n");

    const footerParts = [
      `${totalItems} item${totalItems === 1 ? "" : "s"} fulfilled`,
      `${pendingCount} in progress`,
    ];
    if (paged.totalPages > 1) {
      footerParts.push(`page ${paged.clampedPage}/${paged.totalPages}`);
    }

    return new EmbedBuilder()
      .setColor(INVENTORY_EMBED_COLOUR)
      .setTitle(`${displayName}'s ${titleSuffix}`)
      .setDescription(description)
      .setFooter({ text: footerParts.join(" · ") });
  }

  private buildStoreEmbed(params: {
    config: GuildConfig;
    audience: StoreAudience;
    totalItems: number;
    paged: ReturnType<typeof paginateArray<ShopListItem>>;
  }) {
    const { config, audience, totalItems, paged } = params;
    const priceFormatter = (item: ShopListItem) =>
      audience === "group"
        ? this.formatPointsAmount(item.cost.toString(), config)
        : this.formatCurrencyAmount(item.cost.toString(), config);
    const title = audience === "group" ? "Group store" : "Personal store";
    const headline =
      audience === "group"
        ? `Items buyable with shared ${config.pointsName}.`
        : `Items buyable with your ${config.currencyName}.`;
    const description =
      totalItems === 0
        ? audience === "group"
          ? "No group-purchase items are available right now."
          : "No personal items are available right now."
        : paged.slice.map((item) => this.formatStoreLine(item, priceFormatter(item))).join("\n");

    const fields = [{ name: "Items available", value: `${totalItems}`, inline: true }];
    if (paged.totalPages > 1) {
      fields.push({ name: "Page", value: `${paged.clampedPage}/${paged.totalPages}`, inline: true });
    }

    const footer =
      audience === "group"
        ? `/buy group spends shared ${config.pointsName} · /donate converts currency into points.`
        : `/buy personal spends your ${config.currencyName} · /donate converts currency into points.`;

    return new EmbedBuilder()
      .setColor(STORE_EMBED_COLOUR)
      .setTitle(title)
      .setDescription(`${headline}\n\n${description}`)
      .addFields(fields)
      .setFooter({ text: footer });
  }

  private async enforceChannelGuard(params: {
    interaction: ChatInputCommandInteraction;
    activity: GuardedActivity;
    participantId: string | null;
    config: GuildConfig;
  }): Promise<boolean> {
    const result = await this.services.channelGuardService.check({
      guildId: this.env.GUILD_ID,
      config: params.config,
      activity: params.activity,
      channelId: params.interaction.channelId ?? null,
      participantId: params.participantId,
      actorUserId: params.interaction.user.id,
      actorUsername: params.interaction.user.username,
      currencyName: params.config.currencyName,
      currencySymbol: params.config.currencySymbol,
    });
    if (result.ok) return true;
    const publicContent = `<@${params.interaction.user.id}> ${result.message}`;
    const allowedMentions = { users: [params.interaction.user.id] };
    if (params.interaction.replied || params.interaction.deferred) {
      await params.interaction
        .followUp({ content: publicContent, allowedMentions })
        .catch(() => undefined);
    } else {
      await params.interaction
        .reply({ content: publicContent, allowedMentions })
        .catch(() => undefined);
    }
    return false;
  }

  private async resolveActiveParticipant(params: {
    discordUserId: string;
    discordUsername?: string;
    roleIds: string[];
  }) {
    const group = await this.services.groupService.resolveGroupFromRoleIds(this.env.GUILD_ID, params.roleIds);
    const participant = await this.services.participantService.ensureForGroup({
      guildId: this.env.GUILD_ID,
      discordUserId: params.discordUserId,
      discordUsername: params.discordUsername,
      groupId: group.id,
    });

    return {
      group,
      participant,
    };
  }

  private async getEligibleGroupMembers(params: {
    groupId: string;
    roleId: string;
    guild: ChatInputCommandInteraction["guild"];
    prefetchedMembers?: GuildMemberCollection;
  }) {
    const guild = params.guild;
    if (!guild) {
      return [];
    }

    const members = params.prefetchedMembers ?? (await guild.members.fetch());
    const candidates = Array.from(members.values()).filter(
      (candidate) => !candidate.user.bot && candidate.roles.cache.has(params.roleId),
    );

    const eligibleMembers = await Promise.all(
      candidates.map(async (candidate) => {
        const resolvedGroup = await this.services.groupService
          .resolveGroupFromRoleIds(this.env.GUILD_ID, this.getOrderedRoleIds(candidate))
          .catch(() => null);

        return resolvedGroup?.id === params.groupId ? candidate : null;
      }),
    );

    return eligibleMembers.filter((candidate): candidate is GuildMember => candidate !== null);
  }

  private async syncGroupParticipantsFromGuild(params: {
    groupId: string;
    roleId: string;
    guild: ChatInputCommandInteraction["guild"];
    prefetchedMembers?: GuildMemberCollection;
  }) {
    const guild = params.guild;
    if (!guild) {
      return {
        count: 0,
        discordUserIds: [] as string[],
        participantIds: [] as string[],
      };
    }

    const eligibleMembers = await this.getEligibleGroupMembers(params);

    const participants = await Promise.all(
      eligibleMembers.map((candidate) =>
        this.services.participantService.ensureForGroup({
          guildId: this.env.GUILD_ID,
          discordUserId: candidate.user.id,
          discordUsername: candidate.user.username,
          groupId: params.groupId,
        }),
      ),
    );

    return {
      count: eligibleMembers.length,
      discordUserIds: eligibleMembers.map((member) => member.user.id),
      participantIds: participants.map((participant) => participant.id),
    };
  }

  private async resolveTargetGroups(targets: string) {
    const resolvedGroups = await Promise.all(
      targets
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map(async (segment) => {
          const group = await this.services.groupService.resolveGroupByIdentifier(this.env.GUILD_ID, segment);
          if (!group) {
            throw new AppError(`Could not resolve group: ${segment}`, 404);
          }
          return group;
        }),
    );

    return Array.from(new Map(resolvedGroups.map((group) => [group.id, group])).values());
  }

  private async handlePassiveMessage(params: {
    memberId: string;
    roleIds: string[];
    userId: string;
    username: string;
    messageId: string;
    content: string;
    channelId: string;
  }) {
    const resolved = await this.resolveActiveParticipant({
      discordUserId: params.userId,
      discordUsername: params.username,
      roleIds: params.roleIds,
    }).catch(() => null);
    if (!resolved) {
      return;
    }

    const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    const cooldownKey = `${params.memberId}:${resolved.group.id}`;
    const now = Date.now();
    const previous = this.passiveCooldowns.get(cooldownKey);
    if (previous && now - previous.seenAt < config.passiveCooldownSeconds * 1000) {
      return;
    }

    const sanctioned = await this.services.sanctionService.getActiveFlags(resolved.participant.id);
    if (sanctioned.has("CANNOT_EARN_PASSIVE") || sanctioned.has("CANNOT_RECEIVE_REWARDS")) {
      return;
    }

    const entry = await this.services.economyService.rewardPassiveMessage({
      guildId: this.env.GUILD_ID,
      groupId: resolved.group.id,
      participantId: resolved.participant.id,
      userId: params.userId,
      username: params.username,
      messageId: params.messageId,
      content: params.content,
      channelId: params.channelId,
      config,
    });

    if (entry) {
      this.passiveCooldowns.set(cooldownKey, { seenAt: now });
    }
  }

  private async handleBotReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ) {
    if (user.id === this.client?.user?.id) {
      return;
    }

    let resolvedReaction: MessageReaction;
    try {
      resolvedReaction = reaction.partial ? await reaction.fetch() : (reaction as MessageReaction);
    } catch {
      return;
    }

    const message = resolvedReaction.message;
    const guildId = message.guildId ?? message.guild?.id;
    if (!guildId || guildId !== this.env.GUILD_ID) {
      return;
    }

    const channelId = resolvedReaction.message.channelId;
    const emojiKey = resolvedReaction.emoji.id ?? resolvedReaction.emoji.name;
    if (!emojiKey) {
      return;
    }

    const rule = await this.services.reactionRewardService.findApplicable({
      guildId,
      channelId,
      botUserId: user.id,
      emoji: emojiKey,
    });
    if (!rule) {
      return;
    }

    let resolvedMessage: Message;
    try {
      resolvedMessage = message.partial ? await message.fetch() : (message as Message);
    } catch {
      return;
    }

    const author = resolvedMessage.author;
    if (!author || author.bot) {
      return;
    }

    let member: GuildMember | null = resolvedMessage.member ?? null;
    if (!member && resolvedMessage.guild) {
      member = await resolvedMessage.guild.members.fetch(author.id).catch(() => null);
    }
    if (!member) {
      return;
    }

    const resolved = await this.resolveActiveParticipant({
      discordUserId: author.id,
      discordUsername: author.username,
      roleIds: this.getOrderedRoleIds(member),
    }).catch(() => null);
    if (!resolved) {
      return;
    }

    const sanctioned = await this.services.sanctionService.getActiveFlags(resolved.participant.id);
    if (sanctioned.has("CANNOT_RECEIVE_REWARDS")) {
      return;
    }

    await this.services.reactionRewardService.applyReaction({
      guildId,
      rule,
      participantId: resolved.participant.id,
      messageId: resolvedMessage.id,
      messageAuthorUserId: author.id,
      messageAuthorUsername: author.username,
    });
  }

  /**
   * Handle a reply-based submission where the original message is the actual
   * submission payload and the reply only tells the bot which assignment it is
   * for.
   *
   * The original message provides the submission text and preferred image.
   * The reply only needs to @mention the bot and include the assignment
   * identifier, for example `@Bot submit reflection-1`.
   */
  private async handleReplySubmission(message: Message) {
    const guildId = this.env.GUILD_ID;

    try {
      // --- 1. Fetch the referenced (original) message -----------------------
      const referencedId = message.reference!.messageId!;
      const channel = message.channel;
      const original = await channel.messages.fetch(referencedId).catch(() => null);

      if (!original) {
        await message.reply("I couldn't find the message you replied to.");
        return;
      }

      // Must be the student's own message
      if (original.author.id !== message.author.id) {
        await message.reply("You can only submit your own messages. Reply to a message you sent.");
        return;
      }

      // --- 2. Extract the preferred submission media -------------------------
      // Prefer media on the original message. If the original is text-only,
      // allow the reply to provide the media instead.
      const mediaAttachment = original.attachments.find((a) =>
        this.isSupportedSubmissionAttachment(a.contentType),
      );

      // Also consider media in the reply itself as a fallback
      const replyMediaAttachment = message.attachments.find((a) =>
        this.isSupportedSubmissionAttachment(a.contentType),
      );

      const attachment = mediaAttachment ?? replyMediaAttachment;

      // Strip the bot mention from the reply so only the assignment selector remains.
      const botMentionPattern = this.client?.user
        ? new RegExp(`<@!?${this.client.user.id}>`, "g")
        : null;

      let commandText = message.content;
      if (botMentionPattern) {
        commandText = commandText.replace(botMentionPattern, "").trim();
      }

      // --- 3. Parse assignment identifier from the reply text ----------------
      // Supported formats:
      //   @Bot submit <assignment>
      //   @Bot <assignment>
      const submitPrefixMatch = commandText.match(/^submit\s+/i);
      const assignmentIdentifier = submitPrefixMatch
        ? commandText.slice(submitPrefixMatch[0].length).trim()
        : commandText.trim();

      if (!assignmentIdentifier) {
        const activeAssignments = await this.services.assignmentService.listActive(guildId);
        await message.reply(
          `Please include the assignment name or ID. Available assignments: ${this.formatAssignmentChoices(activeAssignments)}`,
        );
        return;
      }

      // --- 4. Look up participant -------------------------------------------
      const member =
        message.member ??
        (message.guild ? await message.guild.members.fetch(message.author.id).catch(() => null) : null);

      if (!member) {
        await message.reply("I couldn't determine your current group from Discord. Ask an admin to check your roles.");
        return;
      }

      const { participant } = await this.resolveActiveParticipant({
        discordUserId: message.author.id,
        discordUsername: message.author.username,
        roleIds: this.getOrderedRoleIds(member),
      });

      // --- 5. Resolve assignment --------------------------------------------
      const activeAssignments = await this.services.assignmentService.listActive(guildId);
      const assignmentLookup = this.resolveActiveAssignment(activeAssignments, assignmentIdentifier);

      if (assignmentLookup.kind === "missing") {
        await message.reply({ embeds: [this.buildMissingAssignmentEmbed(assignmentIdentifier, activeAssignments)] });
        return;
      }

      if (assignmentLookup.kind === "ambiguous") {
        await message.reply(
          `Multiple assignments match "${assignmentIdentifier}". Use the assignment ID instead: ${this.formatAssignmentChoices(assignmentLookup.matches)}`,
        );
        return;
      }

      const assignment = assignmentLookup.assignment;

      // --- 6. Collect submission content ------------------------------------
      // The submission content lives on the original message being replied to.
      const originalText = original.content.trim();
      const submissionText = originalText;

      if (!submissionText && !attachment) {
        await message.reply(
          "The message you replied to has no media and no text. There is nothing to submit.",
        );
        return;
      }

      // --- 7. Upload media if present ---------------------------------------
      let imageUrl: string | undefined;
      let imageKey: string | undefined;

      if (attachment) {
        if (attachment.size > 25 * 1024 * 1024) {
          await message.reply("Attachment must be under 25 MB.");
          return;
        }

        if (this.storageService.isConfigured) {
          try {
            const response = await fetch(attachment.url);
            if (!response.ok) {
              await message.reply("Failed to download the attachment. It may have expired — try re-uploading it.");
              return;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const result = await this.storageService.upload({
              buffer,
              contentType: attachment.contentType ?? "application/octet-stream",
              folder: `submissions/${guildId}`,
              originalFilename: attachment.name ?? undefined,
            });
            imageUrl = result.url;
            imageKey = result.key;
          } catch {
            await message.reply("Failed to upload the attachment. Please try again or contact an admin.");
            return;
          }
        } else {
          imageUrl = attachment.url;
        }
      }

      // --- 8. Create or confirm replacement --------------------------------
      const replacementPayload = {
        userId: message.author.id,
        guildId,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: submissionText,
        imageUrl,
        imageKey,
        studentDisplay: participant.discordUsername ?? message.author.username,
      };
      const existing = await this.services.submissionService.findForParticipantAssignment({
        guildId,
        assignmentId: assignment.id,
        participantId: participant.id,
      });

      if (existing) {
        if (existing.status !== "PENDING") {
          await message.reply(
            `Your submission has already been reviewed (${existing.status}). Contact an admin if you need to resubmit.`,
          );
          return;
        }

        await this.promptSubmissionReplacement(
          async (payload) => message.reply(payload),
          replacementPayload,
          assignment.title,
        );
        return;
      }

      const result = await this.services.submissionService.createOrReplace({
        guildId,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: submissionText,
        imageUrl,
        imageKey,
      });

      if (
        result.replaced &&
        result.previousImageKey &&
        result.previousImageKey !== imageKey &&
        this.storageService.isConfigured
      ) {
        // Best-effort cleanup for replaced R2 objects. A cleanup failure should
        // not make the submission itself fail.
        await this.storageService.delete(result.previousImageKey).catch(() => {});
      }

      if (result.replaced && result.previousFeedChannelId && result.previousFeedMessageId) {
        await this.deleteSubmissionFeedMessage({
          channelId: result.previousFeedChannelId,
          messageId: result.previousFeedMessageId,
        });
      }

      await this.broadcastSubmissionToFeed({
        submissionId: result.submission.id,
        studentUserId: message.author.id,
        studentDisplay: result.submission.participant?.discordUsername ?? message.author.username,
        assignmentTitle: result.submission.assignment.title,
        groupName: result.submission.group?.displayName ?? "",
        text: submissionText,
        imageUrl: result.submission.imageUrl,
      });

      await message.reply({
        content: this.buildSubmissionReceiptContent({
          action: "received",
          assignmentTitle: result.submission.assignment.title,
          groupName: result.submission.group?.displayName,
          studentUserId: message.author.id,
        }),
        allowedMentions: this.buildStudentAllowedMentions(message.author.id),
      });
    } catch (error) {
      const text = error instanceof AppError ? error.message : "Something went wrong with your submission.";
      await message.reply(text).catch(() => {});
    }
  }

  private async handleAutocomplete(interaction: AutocompleteInteraction) {
    if (interaction.commandName === "submit") {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "assignment") {
        await interaction.respond([]);
        return;
      }
      const assignments = await this.services.assignmentService.listActive(this.env.GUILD_ID);
      const query = focused.value.trim().toLowerCase();
      const matches = assignments
        .filter((assignment) => (query.length === 0 ? true : assignment.title.toLowerCase().includes(query)))
        .slice(0, AUTOCOMPLETE_CHOICE_LIMIT)
        .map((assignment) => {
          const name =
            assignment.title.length > AUTOCOMPLETE_CHOICE_NAME_MAX
              ? `${assignment.title.slice(0, AUTOCOMPLETE_CHOICE_NAME_MAX - 1)}…`
              : assignment.title;
          return { name, value: assignment.id };
        });
      await interaction.respond(matches);
      return;
    }

    if (interaction.commandName !== "buy") {
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== "personal" && subcommand !== "group") {
      return;
    }
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "item_id") {
      await interaction.respond([]);
      return;
    }
    const audience = subcommand === "group" ? "GROUP" : "INDIVIDUAL";
    const [config, items] = await Promise.all([
      this.services.configService.getOrCreate(this.env.GUILD_ID),
      this.services.shopService.list(this.env.GUILD_ID),
    ]);
    const query = focused.value.trim().toLowerCase();
    const matches = items
      .filter((item) => item.enabled && item.audience === audience)
      .filter((item) => (query.length === 0 ? true : item.name.toLowerCase().includes(query)))
      .slice(0, AUTOCOMPLETE_CHOICE_LIMIT)
      .map((item) => {
        const priceLabel =
          audience === "GROUP"
            ? this.formatPointsAmount(item.cost.toString(), config)
            : this.formatCurrencyAmount(item.cost.toString(), config);
        const label = `${item.name} · ${priceLabel}`;
        const name =
          label.length > AUTOCOMPLETE_CHOICE_NAME_MAX
            ? `${label.slice(0, AUTOCOMPLETE_CHOICE_NAME_MAX - 1)}…`
            : label;
        return { name, value: item.id };
      });
    await interaction.respond(matches);
  }

  private async handleLuckyDrawStart(params: {
    interaction: ChatInputCommandInteraction;
    member: GuildMember | null;
    roleIds: string[];
  }) {
    const { interaction } = params;
    if (!interaction.guild || !interaction.channel || !interaction.channel.isTextBased()) {
      throw new AppError("Lucky draws can only be started in a server text channel.", 400);
    }

    const luckyDrawConfig = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    const luckyDrawGuardOk = await this.enforceChannelGuard({
      interaction,
      activity: "luckyDraw",
      participantId: null,
      config: luckyDrawConfig,
    });
    if (!luckyDrawGuardOk) return;

    const isAdmin = await this.canBypassActionCooldown(params.member, params.roleIds);
    let resolvedCapabilities: ResolvedCapabilities | null = null;
    if (!isAdmin) {
      const capabilities = await this.services.roleCapabilityService.listForRoleIds(
        this.env.GUILD_ID,
        params.roleIds,
      );
      resolvedCapabilities = resolveCapabilities(capabilities);
      if (!resolvedCapabilities.canAward) {
        throw new AppError("Only roles with the award capability can start a lucky draw.", 403);
      }
    }

    const rollbackCooldown = await this.enforceAwardCommandCooldown({
      member: params.member,
      roleIds: params.roleIds,
      userId: interaction.user.id,
      isDeduction: false,
    });

    try {
      const durationInput = interaction.options.getString("duration", true);
      const prize = interaction.options.getInteger("prize", true);
      const winnerCount = interaction.options.getInteger("winners") ?? 1;
      const description = interaction.options.getString("description") ?? null;
      const durationMs = parseDuration(durationInput);

      if (resolvedCapabilities && Number.isFinite(resolvedCapabilities.maxAward)) {
        const totalPayout = prize * winnerCount;
        if (totalPayout > resolvedCapabilities.maxAward) {
          throw new AppError(
            `Total lucky-draw payout (${totalPayout}) exceeds your role's maximum award of ${resolvedCapabilities.maxAward}. Reduce the prize or winner count.`,
            403,
          );
        }
      }

      const draw = await this.services.luckyDrawService.create({
        guildId: this.env.GUILD_ID,
        channelId: interaction.channelId!,
        createdByUserId: interaction.user.id,
        createdByUsername: interaction.user.username,
        description,
        prizeAmount: prize,
        winnerCount,
        durationMs,
      });

      const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
      const embed = this.buildLuckyDrawEmbed({
        draw,
        config,
        entrantCount: 0,
        status: "active",
      });
      const components = [this.buildLuckyDrawActionRow(draw.id)];

      const channel = interaction.channel as GuildTextBasedChannel;
      const sent = await channel.send({ embeds: [embed], components });
      await this.services.luckyDrawService.attachMessage(draw.id, sent.id);
      this.scheduleLuckyDraw({ ...draw, messageId: sent.id });

      await interaction.reply({
        content: `🎲 Lucky draw started — ends ${this.formatRelativeTimestamp(draw.endsAt)}.`,
        ephemeral: true,
      });
    } catch (error) {
      rollbackCooldown?.();
      throw error;
    }
  }

  private async handleLuckyDrawButton(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    if (parts.length < 3 || parts[0] !== "luckydraw") {
      return;
    }
    const [, kind, drawId] = parts as [string, string, string];

    await interaction.deferReply({ ephemeral: true });

    if (kind === "enter") {
      await this.handleLuckyDrawEnter(interaction, drawId);
      return;
    }
    if (kind === "entrants") {
      await this.handleLuckyDrawListEntrants(interaction, drawId);
      return;
    }
  }

  private async handleLuckyDrawEnter(interaction: ButtonInteraction, drawId: string) {
    const member = interaction.member;
    const displayName =
      member && "displayName" in member && typeof member.displayName === "string"
        ? member.displayName
        : interaction.user.username;

    await this.services.luckyDrawService.recordEntry({
      drawId,
      userId: interaction.user.id,
      username: displayName,
    });

    const [draw, entrantCount] = await Promise.all([
      this.services.luckyDrawService.findById(drawId),
      this.services.luckyDrawService.countEntries(drawId),
    ]);

    if (draw) {
      const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
      await this.refreshLuckyDrawAnnouncement(draw, entrantCount, config, "active");
    }

    await interaction.editReply({
      content: `🎲 You're in! ${entrantCount} ${entrantCount === 1 ? "entrant" : "entrants"} so far.`,
    });
  }

  private async handleLuckyDrawListEntrants(interaction: ButtonInteraction, drawId: string) {
    const entrants = await this.services.luckyDrawService.listEntrants(drawId);
    if (entrants.length === 0) {
      await interaction.editReply({ content: "No one has entered this draw yet." });
      return;
    }
    const lines = entrants.map((entry, index) => `${index + 1}. <@${entry.userId}>`);
    const body = this.truncateText(lines.join("\n"), 1900);
    await interaction.editReply({
      content: `Entrants (${entrants.length}):\n${body}`,
      allowedMentions: { parse: [] },
    });
  }

  private buildLuckyDrawActionRow(drawId: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`luckydraw:enter:${drawId}`)
        .setLabel("Enter")
        .setEmoji("🎲")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`luckydraw:entrants:${drawId}`)
        .setLabel("Who's in?")
        .setEmoji("👀")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private buildLuckyDrawEmbed(params: {
    draw: { id: string; description: string | null; prizeAmount: { toString(): string } | unknown; winnerCount: number; endsAt: Date; createdByUserId: string };
    config: GuildConfig;
    entrantCount: number;
    status: "active" | "completed-empty" | "completed";
    winnerUserIds?: string[];
  }) {
    const { draw, config, entrantCount, status, winnerUserIds } = params;
    const prizeNumber = decimalToNumber(draw.prizeAmount as never);
    const prizeText = this.formatCurrencyAmount(prizeNumber, config);
    const winnerLine = draw.winnerCount === 1 ? "1 winner" : `${draw.winnerCount} winners`;
    const fields = [
      { name: "Prize", value: `${prizeText} each`, inline: true },
      { name: "Winners", value: winnerLine, inline: true },
      { name: "Entrants", value: String(entrantCount), inline: true },
    ];

    let descriptionLines: string[];
    if (status === "active") {
      descriptionLines = [
        draw.description ?? "Click 🎲 Enter to take part!",
        `Ends ${this.formatRelativeTimestamp(draw.endsAt)}.`,
      ];
    } else if (status === "completed-empty") {
      descriptionLines = [
        draw.description ?? "Lucky draw — no entrants this time.",
        "No one entered, so no winner was picked.",
      ];
    } else {
      const mentions = (winnerUserIds ?? []).map((id) => `<@${id}>`).join(" ");
      descriptionLines = [
        draw.description ?? "🎉 Lucky draw complete!",
        mentions.length > 0 ? `Winners: ${mentions}` : "No winners.",
      ];
    }

    const colour = status === "active" ? 0xfbbf24 : status === "completed-empty" ? 0x6b7280 : 0x10b981;
    const title = status === "active" ? "🎲 Lucky draw is live!" : "🎲 Lucky draw ended";

    return new EmbedBuilder()
      .setColor(colour)
      .setTitle(title)
      .setDescription(descriptionLines.join("\n\n"))
      .addFields(fields)
      .setFooter({ text: `Started by ${this.formatUserReference(draw.createdByUserId, "staff")}` });
  }

  private formatRelativeTimestamp(when: Date) {
    const seconds = Math.floor(when.getTime() / 1000);
    return `<t:${seconds}:R>`;
  }

  private async refreshLuckyDrawAnnouncement(
    draw: { id: string; channelId: string; messageId: string | null; description: string | null; prizeAmount: unknown; winnerCount: number; endsAt: Date; createdByUserId: string },
    entrantCount: number,
    config: GuildConfig,
    status: "active" | "completed-empty" | "completed",
    winnerUserIds?: string[],
  ) {
    if (!this.client || !draw.messageId) return;
    const channel = await this.client.channels.fetch(draw.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const message = await (channel as GuildTextBasedChannel).messages.fetch(draw.messageId).catch(() => null);
    if (!message) return;
    const embed = this.buildLuckyDrawEmbed({ draw, config, entrantCount, status, winnerUserIds });
    const components = status === "active" ? [this.buildLuckyDrawActionRow(draw.id)] : [];
    await message.edit({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch((error) => {
      console.error("Failed to refresh lucky draw announcement", error);
    });
  }

  private scheduleLuckyDraw(draw: { id: string; endsAt: Date; messageId?: string | null }) {
    const existing = this.luckyDrawTimers.get(draw.id);
    if (existing) {
      clearTimeout(existing);
    }
    const delay = Math.max(0, draw.endsAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.luckyDrawTimers.delete(draw.id);
      this.runLuckyDrawSettlement(draw.id).catch((error) => {
        console.error("Failed to settle lucky draw", error);
      });
    }, delay);
    this.luckyDrawTimers.set(draw.id, timer);
  }

  private async runLuckyDrawSettlement(drawId: string) {
    const result = await this.services.luckyDrawService.settle(drawId);
    const draw = result.draw;
    const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    const totalEntrants = await this.services.luckyDrawService.countEntries(drawId);

    if (result.winners.length === 0) {
      if (!draw.paidOutAt) {
        await this.services.luckyDrawService.markPaidOut(drawId);
      }
      await this.refreshLuckyDrawAnnouncement(draw, totalEntrants, config, "completed-empty");
      if (draw.status !== "COMPLETED") {
        await this.services.luckyDrawService.markCompleted(drawId);
      }
      return;
    }

    const guild = this.client ? await this.client.guilds.fetch(this.env.GUILD_ID).catch(() => null) : null;
    const resolvedParticipantIds: string[] = [];
    const resolvedWinnerUserIds: string[] = [];
    const skippedWinnerUserIds: string[] = [];
    for (const winner of result.winners) {
      try {
        const guildMember = guild ? await guild.members.fetch(winner.userId).catch(() => null) : null;
        const { participant } = await this.resolveActiveParticipant({
          discordUserId: winner.userId,
          discordUsername: winner.username ?? guildMember?.user?.username,
          roleIds: this.getOrderedRoleIds(guildMember ?? null),
        });
        const sanctioned = await this.services.sanctionService.getActiveFlags(participant.id);
        if (sanctioned.has("CANNOT_RECEIVE_REWARDS")) {
          skippedWinnerUserIds.push(winner.userId);
          continue;
        }
        resolvedParticipantIds.push(participant.id);
        resolvedWinnerUserIds.push(winner.userId);
      } catch (error) {
        skippedWinnerUserIds.push(winner.userId);
        console.warn(`Lucky draw ${drawId}: skipping unresolvable winner ${winner.userId}`, error);
      }
    }

    const prizeNumber = decimalToNumber(draw.prizeAmount as never);

    if (!draw.paidOutAt) {
      if (resolvedParticipantIds.length === 0) {
        await this.services.luckyDrawService.markPaidOut(drawId);
      } else {
        await this.services.prisma.$transaction(async (tx) => {
          await this.services.participantCurrencyService.awardParticipants({
            guildId: this.env.GUILD_ID,
            actor: {
              userId: draw.createdByUserId,
              username: draw.createdByUsername ?? undefined,
              roleIds: [],
            },
            targetParticipantIds: resolvedParticipantIds,
            currencyDelta: prizeNumber,
            description: `Lucky draw win — ${this.formatCurrencyAmount(prizeNumber, config)} each`,
            type: "LUCKYDRAW_WIN",
            systemAction: true,
            executor: tx,
          });
          await tx.luckyDraw.update({
            where: { id: drawId },
            data: { paidOutAt: new Date() },
          });
        });

        if (this.client) {
          const channel = await this.client.channels.fetch(draw.channelId).catch(() => null);
          if (channel && channel.isTextBased()) {
            const mentions = resolvedWinnerUserIds.map((id) => `<@${id}>`).join(" ");
            await (channel as GuildTextBasedChannel)
              .send({
                content: `🎉 Lucky draw winners! ${mentions} — each won ${this.formatCurrencyAmount(prizeNumber, config)}!`,
                allowedMentions: { users: resolvedWinnerUserIds },
              })
              .catch((error) => {
                console.error("Failed to post lucky draw winner announcement", error);
              });
          }
        }
      }
    }

    const allWinnerUserIds = result.winners.map((entry) => entry.userId);
    await this.refreshLuckyDrawAnnouncement(draw, totalEntrants, config, "completed", allWinnerUserIds);

    if (draw.status !== "COMPLETED") {
      await this.services.luckyDrawService.markCompleted(drawId);
    }

    if (skippedWinnerUserIds.length > 0) {
      console.warn(
        `Lucky draw ${drawId} settled with ${skippedWinnerUserIds.length} unresolvable winner(s) skipped:`,
        skippedWinnerUserIds,
      );
    }
  }

  private async resumeLuckyDraws() {
    const draws = await this.services.luckyDrawService.listResumable(this.env.GUILD_ID);
    for (const draw of draws) {
      this.scheduleLuckyDraw(draw);
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction) {
    if (interaction.commandName === "leaderboard") {
      await interaction.deferReply();
      const view = await this.buildLeaderboardView({ ownerId: interaction.user.id, page: 1 });
      if (view.totalEntries === 0) {
        await interaction.editReply({ content: "No groups yet." });
        return;
      }
      await interaction.editReply({ embeds: [view.embed], components: view.row ? [view.row] : [] });
      return;
    }

    if (interaction.commandName === "forbes") {
      await interaction.deferReply();
      const view = await this.buildForbesView({
        ownerId: interaction.user.id,
        page: 1,
        guild: interaction.guild,
      });
      if (view.totalEntries === 0) {
        await interaction.editReply({ content: "No participants yet." });
        return;
      }
      await interaction.editReply({ embeds: [view.embed], components: view.row ? [view.row] : [] });
      return;
    }

    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = this.getOrderedRoleIds(member ?? null);
    const actor = {
      userId: interaction.user.id,
      username: interaction.user.username,
      roleIds,
    };

    switch (interaction.commandName) {
      case "balance": {
        const { group, participant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });
        const [config, balance, walletBalance, groupLeaderboard, currencyLeaderboard] = await Promise.all([
          this.services.configService.getOrCreate(this.env.GUILD_ID),
          this.services.economyService.getGroupBalance(group.id),
          this.services.participantCurrencyService.getParticipantBalance(participant.id),
          this.services.economyService.getLeaderboard(this.env.GUILD_ID),
          this.services.participantService.getCurrencyLeaderboard(this.env.GUILD_ID),
        ]);

        const groupRankIndex = groupLeaderboard.findIndex((entry) => entry.id === group.id);
        const walletRankIndex = currencyLeaderboard.findIndex((entry) => entry.id === participant.id);
        const formatRankOf = (index: number, total: number) =>
          index >= 0
            ? index < 3
              ? `${this.formatRankMarker(index)} of ${total}`
              : `#${index + 1} of ${total}`
            : "Unranked";

        const memberDisplayName =
          member?.displayName ?? interaction.user.globalName ?? interaction.user.username;

        const embed = new EmbedBuilder()
          .setColor(BALANCE_EMBED_COLOUR)
          .setAuthor({
            name: memberDisplayName,
            iconURL: interaction.user.displayAvatarURL(),
          })
          .setTitle("Your Balance")
          .setDescription(
            `Snapshot of your shared ${config.pointsName} and personal ${config.currencyName}.`,
          )
          .addFields(
            {
              name: `Group ${config.pointsName}`,
              value: [
                `**${group.displayName}**`,
                this.formatPointsAmount(balance.pointsBalance, config),
                `Rank ${formatRankOf(groupRankIndex, groupLeaderboard.length)}`,
              ].join("\n"),
              inline: true,
            },
            {
              name: `Wallet ${config.currencyName}`,
              value: [
                `**${memberDisplayName}**`,
                this.formatCurrencyAmount(walletBalance, config),
                `Rank ${formatRankOf(walletRankIndex, currencyLeaderboard.length)}`,
              ].join("\n"),
              inline: true,
            },
          )
          .setFooter({
            text: `Group ${config.pointsName} fuel /leaderboard and /buy group · Wallet ${config.currencyName} powers /forbes and /buy personal.`,
          });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      case "ledger": {
        const view = await this.buildLedgerView({ ownerId: interaction.user.id, page: 1 });
        if (view.entryCount === 0) {
          await interaction.reply({ content: "No ledger entries yet." });
          return;
        }
        await interaction.reply({ embeds: [view.embed], components: view.row ? [view.row] : [] });
        return;
      }
      case "transfer": {
        const targetUser = interaction.options.getUser("member", true);
        const amount = interaction.options.getNumber("amount", true);
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const sourceLabel = this.formatUserReference(interaction.user.id, member?.displayName ?? interaction.user.username);
        const { participant: sourceParticipant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });
        const transferGuardOk = await this.enforceChannelGuard({
          interaction,
          activity: "points",
          participantId: sourceParticipant.id,
          config,
        });
        if (!transferGuardOk) return;
        await this.services.sanctionService.assertNotSanctioned(
          sourceParticipant.id,
          "CANNOT_TRANSFER",
          { message: "🚫 You are sanctioned and cannot transfer currency right now." },
        );
        const targetMember = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
          throw new AppError("Target user is not in this server.", 404);
        }
        const targetLabel = this.formatUserReference(
          targetUser.id,
          targetMember.displayName || targetUser.globalName || targetUser.username,
        );
        const { participant: targetParticipant } = await this.resolveActiveParticipant({
          discordUserId: targetUser.id,
          discordUsername: targetUser.username,
          roleIds: this.getOrderedRoleIds(targetMember),
        });
        await this.services.participantCurrencyService.transferCurrency({
          guildId: this.env.GUILD_ID,
          actor,
          sourceParticipantId: sourceParticipant.id,
          targetParticipantId: targetParticipant.id,
          amount,
          description: `${interaction.user.username} transferred ${amount} to ${targetUser.username}`,
        });
        await interaction.reply(`${sourceLabel} transferred ${this.formatCurrencyAmount(amount, config)} to ${targetLabel}.`);
        return;
      }
      case "donate": {
        const amount = interaction.options.getNumber("amount", true);
        const { group, participant: sourceParticipant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const donateGuardOk = await this.enforceChannelGuard({
          interaction,
          activity: "points",
          participantId: sourceParticipant.id,
          config,
        });
        if (!donateGuardOk) return;
        const donation = await this.services.economyService.donateParticipantCurrencyToGroupPoints({
          guildId: this.env.GUILD_ID,
          actor,
          participantId: sourceParticipant.id,
          groupId: group.id,
          amount,
          conversionRate: config.groupPointsPerCurrencyDonation.toNumber(),
          description: `${interaction.user.username} donated ${this.formatCurrencyAmount(amount, config)} to ${group.displayName}`,
        });
        const sourceLabel = this.formatUserReference(interaction.user.id, member?.displayName ?? interaction.user.username);
        const groupLabel = this.formatGroupReference(group);
        await interaction.reply(
          `${sourceLabel} donated ${this.formatCurrencyAmount(amount, config)} to ${groupLabel}, adding ${this.formatPointsAmount(donation.groupPointsAward, config)}.`,
        );
        return;
      }
      case "award":
      case "deduct": {
        const awardConfig = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const awardGuardOk = await this.enforceChannelGuard({
          interaction,
          activity: "points",
          participantId: null,
          config: awardConfig,
        });
        if (!awardGuardOk) return;
        const subcommand = interaction.options.getSubcommand();
        const commandKey = `${interaction.commandName}:${subcommand}` as AwardLikeCommandKey;
        const commandConfig = getAwardCommandConfig(commandKey);
        const rollbackCooldown = await this.enforceAwardCommandCooldown({
          member: member ?? null,
          roleIds,
          userId: interaction.user.id,
          isDeduction: commandConfig.isDeduction,
        });
        try {
          const targets = commandConfig.includesGroupTargets ? interaction.options.getString("targets", true) : null;
          const points =
            commandConfig.includesGroupPoints && commandConfig.groupAmountOptionName
              ? interaction.options.getNumber(commandConfig.groupAmountOptionName, true)
              : 0;
          const currency =
            (commandConfig.includesSingleMemberCurrency ||
              commandConfig.includesBulkMemberCurrency ||
              commandConfig.includesMembersList) &&
            commandConfig.memberAmountOptionName
              ? interaction.options.getNumber(commandConfig.memberAmountOptionName, true)
              : 0;
          const targetMember = commandConfig.includesSingleMemberCurrency
            ? interaction.options.getUser("member", true)
            : null;
          const reason =
            interaction.options.getString("reason") ??
            (commandConfig.isDeduction ? "Manual deduction via Discord command" : "Manual award via Discord command");
          const sign = commandConfig.isDeduction ? -1 : 1;
          const targetGroups = commandConfig.includesGroupTargets ? await this.resolveTargetGroups(targets ?? "") : [];

          if (commandConfig.includesGroupTargets && targetGroups.length === 0) {
            throw new AppError("Choose at least one target group.", 400);
          }

          if (commandConfig.includesGroupPoints && points === 0) {
            throw new AppError("Points delta must be greater than zero.", 400);
          }

          let currencyParticipant:
            | Awaited<ReturnType<BotRuntime["resolveActiveParticipant"]>>["participant"]
            | undefined;
          let currencyMemberLabel: string | undefined;
          let bulkCurrencyParticipantIds: string[] = [];
          let bulkCurrencyGroupSummary = "";
          let listedCurrencyParticipantIds: string[] = [];
          let listedMemberLabels: string[] = [];
          if (currency !== 0) {
            if (commandConfig.includesSingleMemberCurrency && !targetMember) {
              throw new AppError("Choose a member when awarding or deducting currency.", 400);
            }

            if (commandConfig.includesSingleMemberCurrency && targetMember) {
              const memberRecord = await interaction.guild?.members.fetch(targetMember.id).catch(() => null);
              if (!memberRecord) {
                throw new AppError("Selected member is not in this server.", 404);
              }
              currencyMemberLabel = memberRecord.displayName || targetMember.globalName || targetMember.username;

              ({ participant: currencyParticipant } = await this.resolveActiveParticipant({
                discordUserId: targetMember.id,
                discordUsername: targetMember.username,
                roleIds: this.getOrderedRoleIds(memberRecord),
              }));
            }
          }

          if (commandConfig.includesMembersList) {
            if (!interaction.guild) {
              throw new AppError("This command is only available in a server.", 400);
            }

            const rawMembers = interaction.options.getString("members", true);
            const ids = parseMembersList(rawMembers);
            if (ids.length === 0) {
              throw new AppError("List at least one member.", 400);
            }
            if (ids.length > CURRENCY_BULK_MAX_MEMBERS) {
              throw new AppError(
                `List up to ${CURRENCY_BULK_MAX_MEMBERS} members at a time (got ${ids.length}).`,
                400,
              );
            }

            const guild = interaction.guild;
            const fetched = await Promise.all(
              ids.map(async (id) => {
                const member = await guild.members.fetch(id).catch(() => null);
                return { id, member };
              }),
            );
            const missing = fetched.filter((entry) => !entry.member).map((entry) => entry.id);
            if (missing.length > 0) {
              throw new AppError(
                `These members are not in this server: ${missing.map((id) => `<@${id}>`).join(", ")}`,
                404,
              );
            }

            const resolved = await Promise.all(
              fetched.map(async ({ member }) => {
                const guildMember = member!;
                const label = guildMember.displayName || guildMember.user.globalName || guildMember.user.username;
                const { participant } = await this.resolveActiveParticipant({
                  discordUserId: guildMember.user.id,
                  discordUsername: guildMember.user.username,
                  roleIds: this.getOrderedRoleIds(guildMember),
                });
                return {
                  participantId: participant.id,
                  label: this.formatUserReference(guildMember.user.id, label),
                };
              }),
            );

            const seen = new Set<string>();
            for (const entry of resolved) {
              if (seen.has(entry.participantId)) continue;
              seen.add(entry.participantId);
              listedCurrencyParticipantIds.push(entry.participantId);
              listedMemberLabels.push(entry.label);
            }
          }

          if (commandConfig.includesBulkMemberCurrency) {
            if (!interaction.guild) {
              throw new AppError("This command is only available in a server.", 400);
            }

            const prefetchedMembers = await interaction.guild.members.fetch();
            const syncedTargetGroups = await Promise.all(
              targetGroups.map((group) =>
                this.syncGroupParticipantsFromGuild({
                  groupId: group.id,
                  roleId: group.roleId,
                  guild: interaction.guild,
                  prefetchedMembers,
                }),
              ),
            );

            bulkCurrencyParticipantIds = Array.from(
              new Set(syncedTargetGroups.flatMap((syncedGroup) => syncedGroup.participantIds)),
            );
            bulkCurrencyGroupSummary = syncedTargetGroups
              .map((syncedGroup, index) => ({
                displayName: this.formatGroupReference(targetGroups[index]!),
                count: syncedGroup.count,
              }))
              .filter((group) => group.count > 0)
              .map((group) => `${group.displayName} (${group.count})`)
              .join(", ");

            if (bulkCurrencyParticipantIds.length === 0) {
              throw new AppError("No eligible members found for the selected groups.", 404);
            }
          }

          if (targetGroups.length > 0) {
            await this.services.prisma.$transaction(async (tx) => {
              if (commandConfig.includesGroupPoints) {
                await this.services.economyService.awardGroups({
                  guildId: this.env.GUILD_ID,
                  actor,
                  targetGroupIds: targetGroups.map((group) => group.id),
                  pointsDelta: points * sign,
                  currencyDelta: 0,
                  description: reason,
                  executor: tx,
                });
              }

              if (currencyParticipant && currency !== 0) {
                await this.services.participantCurrencyService.awardParticipants({
                  guildId: this.env.GUILD_ID,
                  actor,
                  targetParticipantIds: [currencyParticipant.id],
                  currencyDelta: currency * sign,
                  description: reason,
                  executor: tx,
                });
              }

              if (bulkCurrencyParticipantIds.length > 0 && currency !== 0) {
                await this.services.participantCurrencyService.awardParticipants({
                  guildId: this.env.GUILD_ID,
                  actor,
                  targetParticipantIds: bulkCurrencyParticipantIds,
                  currencyDelta: currency * sign,
                  description: reason,
                  executor: tx,
                });
              }
            });
          } else if (currency !== 0) {
            if (currencyParticipant) {
              await this.services.participantCurrencyService.awardParticipants({
                guildId: this.env.GUILD_ID,
                actor,
                targetParticipantIds: [currencyParticipant.id],
                currencyDelta: currency * sign,
                description: reason,
              });
            } else if (listedCurrencyParticipantIds.length > 0) {
              await this.services.participantCurrencyService.awardParticipants({
                guildId: this.env.GUILD_ID,
                actor,
                targetParticipantIds: listedCurrencyParticipantIds,
                currencyDelta: currency * sign,
                description: reason,
              });
            }
          }

          const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
          const direction = commandConfig.isDeduction ? "from" : "to";
          const summaries = [
            commandConfig.includesGroupPoints && targetGroups.length > 0
              ? `${this.formatPointsAmount(Math.abs(points), config)} ${direction} ${targetGroups.map((group) => this.formatGroupReference(group)).join(", ")}`
              : null,
            currencyParticipant && currency !== 0
              ? `${this.formatCurrencyAmount(Math.abs(currency), config)} ${direction} ${this.formatUserReference(
                  targetMember?.id,
                  currencyMemberLabel ?? currencyParticipant.discordUsername ?? currencyParticipant.indexId,
                )}`
              : null,
            bulkCurrencyParticipantIds.length > 0 && currency !== 0
              ? `${this.formatCurrencyAmount(Math.abs(currency), config)} each ${direction} ${bulkCurrencyParticipantIds.length} member${
                  bulkCurrencyParticipantIds.length === 1 ? "" : "s"
                } across ${bulkCurrencyGroupSummary}`
              : null,
            listedCurrencyParticipantIds.length > 0 && currency !== 0
              ? `${this.formatCurrencyAmount(Math.abs(currency), config)} each ${direction} ${listedMemberLabels.join(", ")}`
              : null,
          ].filter((value): value is string => value !== null);

          await interaction.reply(
            `${commandConfig.isDeduction ? "Deducted" : "Awarded"} ${summaries.join(" and ")}. Reason: ${reason}`,
          );
          return;
        } catch (error) {
          rollbackCooldown?.();
          throw error;
        }
      }
      case "sell": {
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const title = interaction.options.getString("title", true);
        const description = interaction.options.getString("description", true);
        const quantity = interaction.options.getInteger("quantity");
        const listing = await this.services.listingService.create({
          guildId: this.env.GUILD_ID,
          actor,
          title,
          description,
          quantity,
          channelId: config.listingChannelId,
        });

        if (config.listingChannelId) {
          await this.postListing(
            config.listingChannelId,
            `New listing from ${this.formatUserReference(
              interaction.user.id,
              member?.displayName ?? interaction.user.username,
            )}: **${listing.title}**\n${listing.description}\nQuantity: ${listing.quantity ?? "infinite"}`,
          );
        }

        await interaction.reply({ content: `Created listing: ${listing.title}`, ephemeral: true });
        return;
      }
      case "store": {
        const audience: StoreAudience = interaction.options.getSubcommand() === "group" ? "group" : "personal";
        const view = await this.buildStoreView({ ownerId: interaction.user.id, audience, page: 1 });
        if (view.totalItems === 0) {
          await interaction.reply({
            content:
              audience === "group"
                ? "No group-purchase items are available right now."
                : "No personal items are available right now.",
            ephemeral: true,
          });
          return;
        }
        await interaction.reply({
          embeds: [view.embed],
          components: view.row ? [view.row] : [],
          ephemeral: true,
        });
        return;
      }
      case "inventory": {
        const audience: InventoryAudience = interaction.options.getSubcommand() === "group" ? "group" : "personal";
        const view = await this.buildInventoryView({
          ownerId: interaction.user.id,
          audience,
          page: 1,
          guild: interaction.guild,
          displayName: member?.displayName ?? interaction.user.username,
        });
        await interaction.reply({
          embeds: [view.embed],
          components: view.row ? [view.row] : [],
          ephemeral: true,
        });
        return;
      }
      case "buy": {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== "personal" && subcommand !== "group") {
          throw new AppError("Unknown /buy subcommand.", 400);
        }
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const itemId = interaction.options.getString("item_id", true);
        const quantity = interaction.options.getInteger("quantity") ?? 1;
        const purchaseMode = subcommand === "group" ? "GROUP" : "INDIVIDUAL";
        const { group, participant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });
        const buyGuardOk = await this.enforceChannelGuard({
          interaction,
          activity: "shop",
          participantId: participant.id,
          config,
        });
        if (!buyGuardOk) return;
        await this.services.sanctionService.assertNotSanctioned(participant.id, "CANNOT_BUY", {
          message: "🚫 You are sanctioned and cannot buy from the shop right now.",
        });
        let groupMemberCount: number | undefined;
        if (purchaseMode === "GROUP") {
          const syncedGroupMembers = await this.syncGroupParticipantsFromGuild({
            groupId: group.id,
            roleId: group.roleId,
            guild: interaction.guild,
          });
          groupMemberCount = syncedGroupMembers.count;
        }
        const redemption = await this.services.shopService.redeem({
          guildId: this.env.GUILD_ID,
          participantId: participant.id,
          shopItemId: itemId,
          requestedByUserId: interaction.user.id,
          requestedByUsername: interaction.user.username,
          quantity,
          purchaseMode,
          groupMemberCount,
        });
        let sharedMessageSuffix = "";
        if (purchaseMode === "GROUP") {
          const announcementChannelId = config.redemptionChannelId ?? interaction.channelId;
          const requesterLabel = this.formatUserReference(interaction.user.id, member?.displayName ?? interaction.user.username);
          const groupLabel = this.formatGroupReference(group);
          const posted = announcementChannelId
            ? await this.postListing(
                announcementChannelId,
                `Group purchase request for ${redemption.shopItem.emoji} **${redemption.shopItem.name}** x${redemption.quantity} from ${groupLabel}, requested by ${requesterLabel}.\nRequest ID: \`${redemption.id}\`\n${this.formatGroupPurchaseProgress(redemption.approvals.length, redemption.approvalThreshold ?? 1)} recorded.\nApprove with \`/approve_purchase purchase_id:${redemption.id}\`.`,
              )
            : null;
          if (posted) {
            await this.services.shopService.setApprovalMessage({
              guildId: this.env.GUILD_ID,
              redemptionId: redemption.id,
              channelId: posted.channelId,
              messageId: posted.messageId,
            });
            sharedMessageSuffix = " A shared approval message has been posted for your group.";
          }
        }

        if (redemption.status === "PENDING") {
          const fulfilmentChannelId = config.redemptionChannelId ?? interaction.channelId;
          if (fulfilmentChannelId) {
            const posted = await this.postRedemptionFulfilmentNotice({
              channelId: fulfilmentChannelId,
              ownerUserId: redemption.shopItem.ownerUserId,
              fulfillerRoleId: redemption.shopItem.fulfillerRoleId,
              buyerUserId: interaction.user.id,
              buyerMention: `<@${interaction.user.id}>`,
              shopItemName: redemption.shopItem.name,
              shopItemEmoji: redemption.shopItem.emoji,
              quantity: redemption.quantity,
              redemptionId: redemption.id,
              audience: redemption.shopItem.audience,
              groupName: group.displayName,
              fulfillmentInstructions: redemption.shopItem.fulfillmentInstructions,
            });
            if (posted) {
              await this.services.shopService.setFulfilmentMessage({
                guildId: this.env.GUILD_ID,
                redemptionId: redemption.id,
                channelId: posted.channelId,
                messageId: posted.messageId,
                ownerUserIdAtPurchase: redemption.shopItem.ownerUserId,
              });
            }
          }
        }

        const autoFulfilledIndividual =
          purchaseMode === "INDIVIDUAL" && redemption.status === "FULFILLED";
        const autoFulfilNotes = autoFulfilledIndividual
          ? redemption.shopItem.fulfillmentInstructions
          : null;
        const personalSuffix = autoFulfilledIndividual
          ? ` Fulfilled instantly.${autoFulfilNotes ? ` ${autoFulfilNotes}` : ""}`
          : "";
        await interaction.reply({
          content:
            purchaseMode === "GROUP"
              ? `Group purchase request created for ${this.formatGroupReference(group)} for ${quantity} item(s). Request ID: ${redemption.id}. ${this.formatGroupPurchaseProgress(redemption.approvals.length, redemption.approvalThreshold ?? 1)} recorded. Group members can approve it with /approve_purchase and spend shared ${config.pointsName} if it passes.${sharedMessageSuffix}`
              : `Purchase recorded for ${quantity} item(s). Request ID: ${redemption.id}. Cost uses your ${config.currencyName}.${personalSuffix}`,
          ephemeral: true,
        });
        return;
      }
      case "approve_purchase": {
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const purchaseId = interaction.options.getString("purchase_id", true);
        const { group, participant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });
        const syncedGroupMembers = await this.syncGroupParticipantsFromGuild({
          groupId: group.id,
          roleId: group.roleId,
          guild: interaction.guild,
        });
        const currentGroupMemberCount = syncedGroupMembers.count;
        const result = await this.services.shopService.approveGroupPurchase({
          guildId: this.env.GUILD_ID,
          redemptionId: purchaseId,
          participantId: participant.id,
          approvedByUserId: interaction.user.id,
          approvedByUsername: interaction.user.username,
          currentGroupMemberCount,
          currentGroupMemberDiscordUserIds: syncedGroupMembers.discordUserIds,
        });

        const progress = this.formatGroupPurchaseProgress(result.approvalsCount, result.threshold);
        const blockingSuffix =
          "blockingGroup" in result && result.blockingGroup
            ? ` ${this.formatGroupReference(group)} does not currently have enough ${config.pointsName}, so the request stays open until more are earned or donated.`
            : "";

        const fullRedemption = result.justExecuted
          ? await this.services.shopService.getRedemption(this.env.GUILD_ID, result.redemption.id)
          : null;

        if (fullRedemption && fullRedemption.status === "PENDING") {
          const fulfilmentChannelId = config.redemptionChannelId ?? interaction.channelId;
          if (fulfilmentChannelId) {
            const buyerUserId = fullRedemption.requestedByUserId;
            const posted = await this.postRedemptionFulfilmentNotice({
              channelId: fulfilmentChannelId,
              ownerUserId: fullRedemption.shopItem.ownerUserId,
              fulfillerRoleId: fullRedemption.shopItem.fulfillerRoleId,
              buyerUserId,
              buyerMention: `<@${buyerUserId}>`,
              shopItemName: fullRedemption.shopItem.name,
              shopItemEmoji: fullRedemption.shopItem.emoji,
              quantity: fullRedemption.quantity,
              redemptionId: fullRedemption.id,
              audience: fullRedemption.shopItem.audience,
              groupName: fullRedemption.group.displayName,
              fulfillmentInstructions: fullRedemption.shopItem.fulfillmentInstructions,
            });
            if (posted) {
              await this.services.shopService.setFulfilmentMessage({
                guildId: this.env.GUILD_ID,
                redemptionId: fullRedemption.id,
                channelId: posted.channelId,
                messageId: posted.messageId,
                ownerUserIdAtPurchase: fullRedemption.shopItem.ownerUserId,
              });
            }
          }
        }

        const autoFulfilled = fullRedemption?.status === "FULFILLED";
        const fulfilmentNotes = autoFulfilled
          ? fullRedemption?.shopItem.fulfillmentInstructions ?? null
          : null;
        const fulfilmentSuffix = autoFulfilled
          ? ` Fulfilled instantly.${fulfilmentNotes ? ` ${fulfilmentNotes}` : ""}`
          : " The group purchase is now funded and pending fulfilment.";
        await interaction.reply({
          content: result.executed
            ? `Approval recorded for ${this.formatGroupReference(group)}. ${progress}.${fulfilmentSuffix}${blockingSuffix}`
            : `Approval recorded for ${this.formatGroupReference(group)}. ${progress}.${blockingSuffix}`,
          ephemeral: true,
        });
        return;
      }
      case "assignments": {
        await interaction.deferReply();
        const view = await this.buildAssignmentsView({ ownerId: interaction.user.id, page: 1 });
        if (view.totalEntries === 0) {
          await interaction.editReply({ content: "There are no active assignments right now." });
          return;
        }
        await interaction.editReply({ embeds: [view.embed], components: view.row ? [view.row] : [] });
        return;
      }
      case "submit": {
        await interaction.deferReply({ ephemeral: true });

        const { participant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });

        const assignmentIdentifier = interaction.options.getString("assignment", true);
        const note = interaction.options.getString("note") ?? interaction.options.getString("text") ?? "";
        const link = this.normalizeSubmissionLink(interaction.options.getString("link"));
        const text = this.buildSubmissionText(note, link);
        const attachment = interaction.options.getAttachment("media") ?? interaction.options.getAttachment("image");

        const activeAssignments = await this.services.assignmentService.listActive(this.env.GUILD_ID);
        const assignmentLookup = this.resolveActiveAssignment(activeAssignments, assignmentIdentifier);

        if (assignmentLookup.kind === "missing") {
          await interaction.editReply({
            embeds: [this.buildMissingAssignmentEmbed(assignmentIdentifier, activeAssignments)],
          });
          return;
        }
        if (assignmentLookup.kind === "ambiguous") {
          await interaction.editReply(
            `Multiple active assignments match "${assignmentIdentifier}". Use the assignment ID instead: ${this.formatAssignmentChoices(assignmentLookup.matches)}`,
          );
          return;
        }

        const assignment = assignmentLookup.assignment;

        let imageUrl: string | undefined;
        let imageKey: string | undefined;

        if (attachment) {
          if (!this.isSupportedSubmissionAttachment(attachment.contentType)) {
            await interaction.editReply("Only image or video files are accepted as attachments.");
            return;
          }

          if (attachment.size > 25 * 1024 * 1024) {
            await interaction.editReply("Attachment must be under 25 MB.");
            return;
          }

          if (this.storageService.isConfigured) {
            try {
              const response = await fetch(attachment.url);
              const buffer = Buffer.from(await response.arrayBuffer());
              const result = await this.storageService.upload({
                buffer,
                contentType: attachment.contentType ?? "image/png",
                folder: `submissions/${this.env.GUILD_ID}`,
                originalFilename: attachment.name ?? undefined,
              });
              imageUrl = result.url;
              imageKey = result.key;
            } catch {
              await interaction.editReply("Failed to upload image. Please try again or contact an admin.");
              return;
            }
          } else {
            imageUrl = attachment.url;
          }
        }

        const replacementPayload = {
          userId: interaction.user.id,
          guildId: this.env.GUILD_ID,
          assignmentId: assignment.id,
          participantId: participant.id,
          text,
          imageUrl,
          imageKey,
          studentDisplay: participant.discordUsername ?? interaction.user.username,
        };
        const existing = await this.services.submissionService.findForParticipantAssignment({
          guildId: this.env.GUILD_ID,
          assignmentId: assignment.id,
          participantId: participant.id,
        });

        if (existing) {
          if (existing.status !== "PENDING") {
            await interaction.editReply(
              `Your submission has already been reviewed (${existing.status}). Contact an admin if you need to resubmit.`,
            );
            return;
          }

          await this.promptSubmissionReplacement(
            async (payload) => interaction.editReply(payload),
            replacementPayload,
            assignment.title,
          );
          return;
        }

        const submission = await this.services.submissionService.create({
          guildId: this.env.GUILD_ID,
          assignmentId: assignment.id,
          participantId: participant.id,
          text,
          imageUrl,
          imageKey,
        });

        await this.broadcastSubmissionToFeed({
          submissionId: submission.id,
          studentUserId: interaction.user.id,
          studentDisplay: submission.participant?.discordUsername ?? interaction.user.username,
          assignmentTitle: submission.assignment.title,
          groupName: submission.group?.displayName ?? "",
          text,
          imageUrl: submission.imageUrl,
        });

        await this.sendSubmissionReceiptToChannel(interaction.channel, {
          action: "received",
          assignmentTitle: submission.assignment.title,
          groupName: submission.group?.displayName,
          studentUserId: interaction.user.id,
        });
        await interaction.deleteReply().catch(() => {});
        return;
      }
      case "submissions": {
        await this.assertCanManageSubmissions(member ?? null, roleIds);

        const assignmentFilter = interaction.options.getString("assignment");
        const activeAssignments = await this.services.assignmentService.listActive(this.env.GUILD_ID);

        let assignmentId: string | undefined;
        if (assignmentFilter) {
          const assignmentLookup = this.resolveActiveAssignment(activeAssignments, assignmentFilter);
          if (assignmentLookup.kind === "ambiguous") {
            await interaction.reply({
              content: `Multiple active assignments match "${assignmentFilter}". Use the assignment ID instead: ${this.formatAssignmentChoices(assignmentLookup.matches)}`,
              ephemeral: true,
            });
            return;
          }
          if (assignmentLookup.kind === "resolved") {
            assignmentId = assignmentLookup.assignment.id;
          }
        }

        const submissions = await this.services.submissionService.list(this.env.GUILD_ID, { assignmentId });
        const recent = submissions.slice(0, 15);

        if (recent.length === 0) {
          await interaction.reply({
            content: assignmentFilter
              ? `No submissions found for "${assignmentFilter}".`
              : "No submissions yet.",
            ephemeral: true,
          });
          return;
        }

        const lines = recent.map((sub) => {
          const status = sub.status === "PENDING" ? "\u23f3" : sub.status === "APPROVED" ? "\u2705" : sub.status === "OUTSTANDING" ? "\u2b50" : "\u274c";
          const name = sub.participant.discordUsername ?? sub.participant.indexId;
          return `${status} \`${sub.id.slice(0, 8)}\` **${sub.assignment.title}** \u2014 ${name} (${sub.group.displayName})`;
        });

        await interaction.reply({
          content: `Recent submissions:\n${lines.join("\n")}`,
          ephemeral: true,
        });
        return;
      }
      case "review_submission": {
        await this.assertCanManageSubmissions(member ?? null, roleIds);

        const identifier = interaction.options.getString("submission_id", true);
        const status = interaction.options.getString("decision", true) as "APPROVED" | "OUTSTANDING" | "REJECTED";
        const note = interaction.options.getString("note") ?? undefined;
        const target = await this.services.submissionService.resolveIdentifier(this.env.GUILD_ID, identifier);
        const reviewed = await this.services.submissionService.review({
          guildId: this.env.GUILD_ID,
          submissionId: target.id,
          status,
          reviewNote: note,
          reviewedByUserId: interaction.user.id,
          reviewedByUsername: interaction.user.username,
        });
        const participantName = reviewed.participant.discordUsername ?? reviewed.participant.indexId;

        await interaction.reply({
          content: `Marked \`${reviewed.id.slice(0, 8)}\` as **${reviewed.status}** for **${reviewed.assignment.title}** by ${participantName}.`,
          ephemeral: true,
        });
        return;
      }
      case "missing": {
        await this.assertCanManageSubmissions(member ?? null, roleIds);

        const summary = await this.services.submissionService.getCompletionSummary(this.env.GUILD_ID);

        if (summary.length === 0) {
          await interaction.reply({ content: "No active assignments.", ephemeral: true });
          return;
        }

        const lines = summary.map((entry) => {
          const missing = entry.missingParticipants.length;
          const header = `**${entry.assignmentTitle}**: ${entry.submittedCount}/${entry.totalParticipants} submitted`;
          if (missing === 0) {
            return `${header} \u2014 all done!`;
          }
          const names = entry.missingParticipants
            .slice(0, 10)
            .map((p) => `${p.discordUsername ?? p.indexId} (${p.group})`)
            .join(", ");
          const extra = missing > 10 ? ` and ${missing - 10} more` : "";
          return `${header}\n  Missing: ${names}${extra}`;
        });

        await interaction.reply({
          content: lines.join("\n\n"),
          ephemeral: true,
        });
        return;
      }
      case "bet": {
        const amount = interaction.options.getNumber("amount", true);
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);

        const rebuke = this.checkBettingCooldown(
          interaction.user.id,
          config.bettingCooldownSeconds,
        );
        if (rebuke) {
          await interaction.reply(`<@${interaction.user.id}> ${rebuke}`);
          return;
        }

        const { participant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });
        const betGuardOk = await this.enforceChannelGuard({
          interaction,
          activity: "betting",
          participantId: participant.id,
          config,
        });
        if (!betGuardOk) return;
        await this.services.sanctionService.assertNotSanctioned(participant.id, "CANNOT_BET", {
          message: "🚫 You are sanctioned and cannot place bets right now.",
        });
        const result = await this.services.bettingService.placeBet({
          guildId: this.env.GUILD_ID,
          actor,
          participantId: participant.id,
          amount,
        });
        this.recordBetPlaced(interaction.user.id, config.bettingCooldownSeconds);

        if (result.won) {
          await interaction.reply(
            `🎉 **You won!** You bet ${this.formatCurrencyAmount(amount, config)} from your wallet and won. New balance: ${this.formatCurrencyAmount(result.newCurrencyBalance, config)}.`,
          );
        } else {
          await interaction.reply(
            `💸 **You lost!** You bet ${this.formatCurrencyAmount(amount, config)} from your wallet and lost. New balance: ${this.formatCurrencyAmount(result.newCurrencyBalance, config)}.`,
          );
        }
        return;
      }
      case "betstats": {
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const { participant: invokerParticipant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        }).catch(() => ({ participant: null as null | { id: string } }));
        const betstatsGuardOk = await this.enforceChannelGuard({
          interaction,
          activity: "betting",
          participantId: invokerParticipant?.id ?? null,
          config,
        });
        if (!betstatsGuardOk) return;
        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const stats = await this.services.bettingService.getStats(this.env.GUILD_ID, targetUser.id);

        if (stats.totalBets === 0) {
          await interaction.reply(
            targetUser.id === interaction.user.id
              ? "You haven't placed any bets yet."
              : `${targetUser.username} hasn't placed any bets yet.`,
          );
          return;
        }

        const winRate = ((stats.wins / stats.totalBets) * 100).toFixed(1);
        const label = targetUser.id === interaction.user.id ? "Your" : `${targetUser.username}'s`;
        const lines = [
          `📊 **${label} betting stats:**`,
          `Total bets: ${stats.totalBets}`,
          `Wins: ${stats.wins} / Losses: ${stats.losses} (${winRate}% win rate)`,
          `Total won: ${this.formatCurrencyAmount(stats.totalWon, config)}`,
          `Total lost: ${this.formatCurrencyAmount(stats.totalLost, config)}`,
          `Net gain: ${this.formatSignedCurrencyAmount(stats.netGain, config)}`,
        ];

        await interaction.reply(lines.join("\n"));
        return;
      }
      case "luckydraw": {
        await this.handleLuckyDrawStart({ interaction, member: member ?? null, roleIds });
        return;
      }
      case "fulfil":
      case "cancel_redemption": {
        await this.handleRedemptionSlashAction({
          interaction,
          action: interaction.commandName === "fulfil" ? "fulfil" : "cancel",
          guildMember: member ?? null,
          roleIds,
        });
        return;
      }
      default:
        throw new AppError("Unknown command.", 404);
    }
  }

  private async handleRedemptionSlashAction(params: {
    interaction: ChatInputCommandInteraction;
    action: "fulfil" | "cancel";
    guildMember: GuildMember | null;
    roleIds: string[];
  }) {
    const { interaction, action } = params;
    const redemptionId = interaction.options.getString("redemption_id", true).trim();
    const redemption = await this.services.shopService.getRedemption(this.env.GUILD_ID, redemptionId);
    if (!redemption) {
      await interaction.reply({ content: "Redemption not found.", ephemeral: true });
      return;
    }

    // Slash invocations from a DM don't carry guild context, so fall back to a
    // direct guild lookup so role-based and capability-based perms still apply.
    let guildMember = params.guildMember;
    let roleIds = params.roleIds;
    if (!guildMember && this.client) {
      const guild = await this.client.guilds.fetch(this.env.GUILD_ID).catch(() => null);
      const fetched = guild
        ? await guild.members.fetch(interaction.user.id).catch(() => null)
        : null;
      if (fetched) {
        guildMember = fetched;
        roleIds = this.getOrderedRoleIds(fetched);
      }
    }

    const memberPermissions = interaction.memberPermissions ?? guildMember?.permissions ?? null;
    const { isOwner, isStaff, isFulfiller } = await this.checkRedemptionActorPermissions({
      redemption,
      actorUserId: interaction.user.id,
      memberPermissions,
      roleIds,
    });

    if (!isOwner && !isStaff && !isFulfiller) {
      await interaction.reply({
        content: "Only the item owner, fulfiller role, or staff can act on this purchase.",
        ephemeral: true,
      });
      return;
    }

    const nextStatus = action === "fulfil" ? "FULFILLED" : "CANCELED";

    try {
      const { redemption: updated, changed } = await this.services.shopService.updateRedemptionStatus({
        guildId: this.env.GUILD_ID,
        redemptionId,
        status: nextStatus,
        actorUserId: interaction.user.id,
        actorUsername: interaction.user.username,
      });

      if (!changed) {
        await interaction.reply({
          content: `Redemption \`${redemptionId}\` is already **${updated.status}**.`,
          ephemeral: true,
        });
        return;
      }

      const verb = nextStatus === "FULFILLED" ? "Fulfilled" : "Cancelled";
      const refundSuffix = nextStatus === "CANCELED" ? " and refunded" : "";
      const statusLine = `**Status:** ${updated.status} — ${verb}${refundSuffix} by <@${interaction.user.id}> via /${interaction.commandName}.`;

      // Mirror the dashboard flow: dim the buttons on the original notice so
      // it stays in sync with whatever the slash command did.
      if (updated.fulfilmentMessageChannelId && updated.fulfilmentMessageId) {
        await this.clearRedemptionButtons(
          updated.fulfilmentMessageChannelId,
          updated.fulfilmentMessageId,
          statusLine,
        );
      }

      await interaction.reply({
        content: `Redemption \`${redemptionId}\` ${verb.toLowerCase()}${refundSuffix}.`,
        ephemeral: true,
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Failed to update redemption.";
      await interaction.reply({ content: message, ephemeral: true });
    }
  }

  private static readonly LEDGER_ENTRY_LABELS: Record<string, { emoji: string; label: string }> = {
    MESSAGE_REWARD: { emoji: "💬", label: "Message reward" },
    MANUAL_AWARD: { emoji: "🎁", label: "Award" },
    MANUAL_DEDUCT: { emoji: "📉", label: "Deduction" },
    CORRECTION: { emoji: "🛠️", label: "Correction" },
    TRANSFER: { emoji: "🔀", label: "Transfer" },
    DONATION: { emoji: "🎗️", label: "Donation" },
    SHOP_REDEMPTION: { emoji: "🛍️", label: "Shop redemption" },
    ADJUSTMENT: { emoji: "🧮", label: "Adjustment" },
    SUBMISSION_REWARD: { emoji: "📝", label: "Submission reward" },
    BET_WIN: { emoji: "💰", label: "Bet win" },
    BET_LOSS: { emoji: "💸", label: "Bet loss" },
    LUCKYDRAW_WIN: { emoji: "🎰", label: "Lucky draw win" },
  };

  private formatLedgerEntryType(type: string) {
    const mapping = BotRuntime.LEDGER_ENTRY_LABELS[type];
    if (mapping) {
      return `${mapping.emoji} ${mapping.label}`;
    }
    const pretty = type
      .toLowerCase()
      .split("_")
      .map((segment) => (segment.length === 0 ? segment : segment[0]!.toUpperCase() + segment.slice(1)))
      .join(" ");
    return `• ${pretty}`;
  }

  private formatLedgerSplitLine(
    split: CommandLedgerEntry["splits"][number],
    config: GuildConfig,
  ) {
    const deltas = [
      split.pointsDelta === 0 ? null : this.formatSignedPointsAmount(split.pointsDelta, config),
      split.currencyDelta === 0 ? null : this.formatSignedCurrencyAmount(split.currencyDelta, config),
    ].filter((value): value is string => value !== null);
    const amount = deltas.length > 0 ? deltas.join(" / ") : "no change";
    return `**${split.group.displayName}** ${amount}`;
  }

  private buildLedgerEntryField(
    entry: CommandLedgerEntry,
    config: GuildConfig,
    index: number,
  ) {
    const timestamp = Math.floor(new Date(entry.createdAt).getTime() / 1000);
    const name = `#${index} · ${this.formatLedgerEntryType(entry.type)}`;
    const splitLines = entry.splits.map((split) => this.formatLedgerSplitLine(split, config));
    const lines = [`<t:${timestamp}:R>`, ...splitLines];
    const description = entry.description?.trim();
    if (description) {
      lines.push(`> ${this.truncateText(description, LEDGER_DESCRIPTION_MAX)}`);
    }
    const value = this.truncateText(lines.join("\n"), LEDGER_FIELD_VALUE_MAX);
    return { name, value, inline: false };
  }

  private buildLedgerEmbed(
    entries: CommandLedgerEntry[],
    config: GuildConfig,
    page: number,
    offset: number,
  ) {
    const fields = entries.map((entry, index) =>
      this.buildLedgerEntryField(entry, config, offset + index + 1),
    );
    const firstIndex = offset + 1;
    const lastIndex = offset + entries.length;
    return new EmbedBuilder()
      .setColor(LEDGER_EMBED_COLOUR)
      .setTitle("Transaction ledger")
      .setDescription(
        entries.length === 0
          ? `Page ${page} · no entries.`
          : `Page ${page} · showing entries ${firstIndex}–${lastIndex}.`,
      )
      .addFields(fields);
  }

  private formatSignedNumber(value: number) {
    return `${value >= 0 ? "+" : ""}${value}`;
  }

  private formatNamedAmount(amount: number | string, label: string, symbol: string) {
    return `${amount} ${label} ${symbol}`;
  }

  private formatPointsAmount(amount: number | string, config: GuildConfig) {
    return this.formatNamedAmount(amount, config.pointsName, config.pointsSymbol);
  }

  private formatCurrencyAmount(amount: number | string, config: GuildConfig) {
    return this.formatNamedAmount(amount, config.currencyName, config.currencySymbol);
  }

  private formatSignedPointsAmount(amount: number, config: GuildConfig) {
    return this.formatPointsAmount(this.formatSignedNumber(amount), config);
  }

  private formatSignedCurrencyAmount(amount: number, config: GuildConfig) {
    return this.formatCurrencyAmount(this.formatSignedNumber(amount), config);
  }

  private truncateText(value: string, maxLength: number) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  private async registerCommands() {
    if (!this.env.DISCORD_APPLICATION_ID || !this.env.DISCORD_BOT_TOKEN || !this.env.DISCORD_GUILD_ID) {
      return;
    }

    const rest = new REST({ version: "10" }).setToken(this.env.DISCORD_BOT_TOKEN);
    const commands = [
      new SlashCommandBuilder().setName("leaderboard").setDescription("Show the group leaderboard."),
      new SlashCommandBuilder().setName("forbes").setDescription("Show the individual wallet leaderboard."),
      new SlashCommandBuilder().setName("balance").setDescription("Show your group points and personal wallet."),
      new SlashCommandBuilder()
        .setName("ledger")
        .setDescription("Show the 10 most recent ledger entries."),
      new SlashCommandBuilder()
        .setName("transfer")
        .setDescription("Send wallet currency to another student.")
        .addUserOption((option) => option.setName("member").setDescription("Recipient").setRequired(true))
        .addNumberOption((option) => option.setName("amount").setDescription("Currency amount").setRequired(true)),
      new SlashCommandBuilder()
        .setName("donate")
        .setDescription("Convert your wallet currency into group points.")
        .addNumberOption((option) => option.setName("amount").setDescription("Currency amount").setRequired(true)),
      new SlashCommandBuilder()
        .setName("award")
        .setDescription("Award group points or participant currency.")
        .addSubcommand((sub) => configureAwardLikeSubcommand(sub, "award:points", "points", "Award group points."))
        .addSubcommand((sub) => configureAwardLikeSubcommand(sub, "award:currency", "currency", "Award participant currency to one member."))
        .addSubcommand((sub) =>
          configureAwardLikeSubcommand(
            sub,
            "award:currencygroup",
            "currencygroup",
            "Award participant currency to every eligible member in selected groups.",
          ),
        )
        .addSubcommand((sub) =>
          configureAwardLikeSubcommand(
            sub,
            "award:currencybulk",
            "currencybulk",
            `Award participant currency to up to ${CURRENCY_BULK_MAX_MEMBERS} listed members.`,
          ),
        ),
      new SlashCommandBuilder()
        .setName("deduct")
        .setDescription("Deduct group points or participant currency.")
        .addSubcommand((sub) => configureAwardLikeSubcommand(sub, "deduct:group", "group", "Deduct group points."))
        .addSubcommand((sub) => configureAwardLikeSubcommand(sub, "deduct:member", "member", "Deduct participant currency from one member."))
        .addSubcommand((sub) =>
          configureAwardLikeSubcommand(
            sub,
            "deduct:mixed",
            "mixed",
            "Deduct group points and participant currency together.",
          ),
        ),
      new SlashCommandBuilder()
        .setName("store")
        .setDescription("Browse the custom shop.")
        .addSubcommand((sub) =>
          sub.setName("personal").setDescription("Items buyable with your wallet currency."),
        )
        .addSubcommand((sub) =>
          sub.setName("group").setDescription("Items buyable with shared group points."),
        ),
      new SlashCommandBuilder()
        .setName("inventory")
        .setDescription("Show the shop items you've bought.")
        .addSubcommand((sub) =>
          sub.setName("personal").setDescription("Items you bought with your wallet currency."),
        )
        .addSubcommand((sub) =>
          sub.setName("group").setDescription("Group purchases you're part of."),
        ),
      new SlashCommandBuilder()
        .setName("buy")
        .setDescription("Buy a shop item.")
        .addSubcommand((sub) =>
          sub
            .setName("personal")
            .setDescription("Buy a shop item for yourself with your wallet currency.")
            .addStringOption((option) =>
              option
                .setName("item_id")
                .setDescription("Item to buy — start typing to search by name")
                .setRequired(true)
                .setAutocomplete(true),
            )
            .addIntegerOption((option) => option.setName("quantity").setDescription("Quantity").setRequired(false)),
        )
        .addSubcommand((sub) =>
          sub
            .setName("group")
            .setDescription("Start a group purchase request paid from shared group points.")
            .addStringOption((option) =>
              option
                .setName("item_id")
                .setDescription("Item to buy — start typing to search by name")
                .setRequired(true)
                .setAutocomplete(true),
            )
            .addIntegerOption((option) => option.setName("quantity").setDescription("Quantity").setRequired(false)),
        ),
      new SlashCommandBuilder()
        .setName("approve_purchase")
        .setDescription("Approve a pending group shop purchase.")
        .addStringOption((option) =>
          option.setName("purchase_id").setDescription("Full purchase ID shared by /buy group").setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName("fulfil")
        .setDescription("Mark a shop redemption as fulfilled.")
        .addStringOption((option) =>
          option
            .setName("redemption_id")
            .setDescription("Redemption ID from the fulfilment notice or /inventory")
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName("cancel_redemption")
        .setDescription("Cancel a pending shop redemption and refund the buyer.")
        .addStringOption((option) =>
          option
            .setName("redemption_id")
            .setDescription("Redemption ID from the fulfilment notice or /inventory")
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName("sell")
        .setDescription("Create a marketplace listing.")
        .addStringOption((option) => option.setName("title").setDescription("Listing title").setRequired(true))
        .addStringOption((option) => option.setName("description").setDescription("Listing description").setRequired(true))
        .addIntegerOption((option) => option.setName("quantity").setDescription("Quantity, leave blank for infinite").setRequired(false)),
      new SlashCommandBuilder()
        .setName("submit")
        .setDescription("Submit work for an assignment.")
        .addStringOption((option) =>
          option
            .setName("assignment")
            .setDescription("Pick an active assignment")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((option) =>
          option.setName("note").setDescription("Note or comment shown with your submission").setRequired(false),
        )
        .addStringOption((option) =>
          option.setName("link").setDescription("Optional work link, for example code.tk.sg").setRequired(false),
        )
        .addAttachmentOption((option) =>
          option.setName("media").setDescription("Image or video attachment").setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName("assignments")
        .setDescription("List active assignments you can submit for."),
      new SlashCommandBuilder()
        .setName("submissions")
        .setDescription("View recent submissions (admin).")
        .addStringOption((option) => option.setName("assignment").setDescription("Filter by assignment ID or exact title").setRequired(false)),
      new SlashCommandBuilder()
        .setName("review_submission")
        .setDescription("Review a student submission (staff).")
        .addStringOption((option) =>
          option.setName("submission_id").setDescription("Full submission ID or short prefix from /submissions").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("decision")
            .setDescription("Review outcome")
            .setRequired(true)
            .addChoices(
              { name: "Approve", value: "APPROVED" },
              { name: "Outstanding", value: "OUTSTANDING" },
              { name: "Reject", value: "REJECTED" },
            ),
        )
        .addStringOption((option) => option.setName("note").setDescription("Optional review note").setRequired(false)),
      new SlashCommandBuilder()
        .setName("missing")
        .setDescription("See who hasn't submitted for each assignment (admin)."),
      new SlashCommandBuilder()
        .setName("bet")
        .setDescription("Bet currency in a game of double or nothing.")
        .addNumberOption((option) =>
          option.setName("amount").setDescription("Amount of currency to bet").setRequired(true).setMinValue(1),
        ),
      new SlashCommandBuilder()
        .setName("betstats")
        .setDescription("View betting statistics.")
        .addUserOption((option) =>
          option.setName("user").setDescription("User to check stats for (defaults to yourself)").setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName("luckydraw")
        .setDescription("Start a lucky-draw giveaway. Members click a button to enter; winners are picked randomly.")
        .addStringOption((option) =>
          option
            .setName("duration")
            .setDescription("How long entries stay open (e.g. 30s, 5m, 1 hour, 1d).")
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("prize")
            .setDescription("Wallet currency awarded to each winner.")
            .setRequired(true)
            .setMinValue(1),
        )
        .addIntegerOption((option) =>
          option
            .setName("winners")
            .setDescription("How many winners to pick (default 1, max 25).")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(25),
        )
        .addStringOption((option) =>
          option
            .setName("description")
            .setDescription("Optional flavour text shown on the announcement.")
            .setRequired(false),
        ),
    ].map((command) => command.toJSON());

    await rest.put(Routes.applicationGuildCommands(this.env.DISCORD_APPLICATION_ID, this.env.DISCORD_GUILD_ID), {
      body: commands,
    });
  }
}
