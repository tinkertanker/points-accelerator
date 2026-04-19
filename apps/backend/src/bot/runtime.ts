import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type GuildMember,
  type Message,
} from "discord.js";

import type { AppEnv } from "../config/env.js";
import { resolveCapabilities } from "../domain/permissions.js";
import type { AppServices } from "../services/app-services.js";
import type { StorageService } from "../services/storage-service.js";
import { AppError } from "../utils/app-error.js";

type CooldownEntry = {
  seenAt: number;
};

type CommandLedgerEntry = Awaited<ReturnType<AppServices["economyService"]["getLedger"]>>[number];
type GroupLeaderboardEntry = Awaited<ReturnType<AppServices["economyService"]["getLeaderboard"]>>[number];
type GuildConfig = Awaited<ReturnType<AppServices["configService"]["getOrCreate"]>>;
type ActiveAssignment = Awaited<ReturnType<AppServices["assignmentService"]["listActive"]>>[number];
type CurrencyLeaderboardEntry = Awaited<ReturnType<AppServices["participantService"]["getCurrencyLeaderboard"]>>[number];
type GuildMemberCollection = Awaited<
  ReturnType<NonNullable<ChatInputCommandInteraction["guild"]>["members"]["fetch"]>
>;
type AssignmentLookupResult =
  | { kind: "resolved"; assignment: ActiveAssignment }
  | { kind: "ambiguous"; matches: ActiveAssignment[] }
  | { kind: "missing" };
type AwardLikeCommandName =
  | "awardpoints"
  | "awardcurrency"
  | "awardcurrencybulk"
  | "awardmixed"
  | "deductgroup"
  | "deductmember"
  | "deductmixed";

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function isDiscordSnowflake(value: string | null | undefined): value is string {
  return typeof value === "string" && DISCORD_SNOWFLAKE_PATTERN.test(value);
}

const MAX_LEDGER_LINE_LENGTH = 160;
const LEADERBOARD_EMBED_LIMIT = 10;
const LEADERBOARD_FEATURED_COUNT = 4;
const GROUP_LEADERBOARD_COLOUR = 0xf59e0b;
const FORBES_EMBED_COLOUR = 0x38bdf8;
const DEFAULT_ROLE_ACTION_COOLDOWN_SECONDS = 10;

function buildAwardLikeCommand(commandName: AwardLikeCommandName, description: string) {
  const config = getAwardCommandConfig(commandName);

  const builder = new SlashCommandBuilder()
    .setName(commandName)
    .setDescription(description);

  if (config.includesGroupTargets) {
    builder
      .addStringOption((option) =>
        option.setName("targets").setDescription("Comma-separated group aliases or role mentions").setRequired(true),
      );
  }

  if (config.includesGroupPoints && config.groupAmountOptionName) {
    builder.addNumberOption((option) =>
      option
        .setName(config.groupAmountOptionName)
        .setDescription("Points delta for the target groups")
        .setRequired(true)
        .setMinValue(0.01),
    );
  }

  if (config.includesSingleMemberCurrency) {
    builder.addUserOption((option) =>
      option.setName("member").setDescription("Member whose wallet should change").setRequired(true),
    );
  }

  if ((config.includesSingleMemberCurrency || config.includesBulkMemberCurrency) && config.memberAmountOptionName) {
    builder.addNumberOption((option) =>
      option
        .setName(config.memberAmountOptionName)
        .setDescription(
          config.includesBulkMemberCurrency
            ? "Currency delta for each eligible member in the selected groups"
            : "Currency delta for the selected member",
        )
        .setRequired(true)
        .setMinValue(0.01),
    );
  }

  builder.addStringOption((option) =>
    option
      .setName("reason")
      .setDescription(`${config.isDeduction ? "Deduction" : "Award"} reason`)
      .setRequired(false),
  );

  return builder;
}

function getAwardCommandConfig(commandName: AwardLikeCommandName) {
  switch (commandName) {
    case "awardpoints":
      return {
        isDeduction: false,
        includesGroupTargets: true,
        includesGroupPoints: true,
        includesSingleMemberCurrency: false,
        includesBulkMemberCurrency: false,
        groupAmountOptionName: "amount",
        memberAmountOptionName: null,
      };
    case "awardcurrency":
      return {
        isDeduction: false,
        includesGroupTargets: false,
        includesGroupPoints: false,
        includesSingleMemberCurrency: true,
        includesBulkMemberCurrency: false,
        groupAmountOptionName: null,
        memberAmountOptionName: "amount",
      };
    case "awardcurrencybulk":
      return {
        isDeduction: false,
        includesGroupTargets: true,
        includesGroupPoints: false,
        includesSingleMemberCurrency: false,
        includesBulkMemberCurrency: true,
        groupAmountOptionName: null,
        memberAmountOptionName: "amount",
      };
    case "awardmixed":
      return {
        isDeduction: false,
        includesGroupTargets: true,
        includesGroupPoints: true,
        includesSingleMemberCurrency: true,
        includesBulkMemberCurrency: false,
        groupAmountOptionName: "points",
        memberAmountOptionName: "currency",
      };
    case "deductgroup":
      return {
        isDeduction: true,
        includesGroupTargets: true,
        includesGroupPoints: true,
        includesSingleMemberCurrency: false,
        includesBulkMemberCurrency: false,
        groupAmountOptionName: "points",
        memberAmountOptionName: null,
      };
    case "deductmember":
      return {
        isDeduction: true,
        includesGroupTargets: false,
        includesGroupPoints: false,
        includesSingleMemberCurrency: true,
        includesBulkMemberCurrency: false,
        groupAmountOptionName: null,
        memberAmountOptionName: "currency",
      };
    case "deductmixed":
      return {
        isDeduction: true,
        includesGroupTargets: true,
        includesGroupPoints: true,
        includesSingleMemberCurrency: true,
        includesBulkMemberCurrency: false,
        groupAmountOptionName: "points",
        memberAmountOptionName: "currency",
      };
  }
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
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });

    this.client.once("ready", async () => {
      await this.registerCommands();
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
        roleIds: Array.from(member.roles.cache.keys()),
        userId: message.author.id,
        username: message.author.username,
        messageId: message.id,
        content: message.content,
        channelId: message.channelId,
      });
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.guildId !== this.env.GUILD_ID) {
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
    this.client?.destroy();
    this.client = null;
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
      roleIds: Array.from(member.roles.cache.keys()),
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
    const subject =
      params.audience === "GROUP"
        ? `${params.buyerMention} (on behalf of **${params.groupName}**)`
        : params.buyerMention;
    const fulfilmentLine = params.fulfillmentInstructions
      ? `\nFulfilment notes: ${params.fulfillmentInstructions}`
      : "";
    const header = ownerMention ? `${ownerMention} heads up — ` : "";
    const content = `${header}${subject} purchased ${params.shopItemEmoji} **${params.shopItemName}**${
      params.quantity > 1 ? ` x${params.quantity}` : ""
    }.\nRedemption ID: \`${params.redemptionId}\`${fulfilmentLine}`;

    const mentionUsers = [params.buyerUserId, ...(validOwnerId ? [validOwnerId] : [])].filter(
      isDiscordSnowflake,
    );

    const sent = await (channel as GuildTextBasedChannel)
      .send({
        content,
        components: [this.buildRedemptionActionRow(params.redemptionId)],
        allowedMentions: { users: mentionUsers },
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
    const roleIds = guildMember ? Array.from(guildMember.roles.cache.keys()) : apiRoleIds;
    // Authorize against the owner snapshot taken when the notice was posted,
    // so that re-assigning the item later doesn't yank fulfil/cancel rights
    // away from the person actually @mentioned in the channel. Falls back to
    // the current item owner for legacy redemptions created before the
    // snapshot column existed.
    const ownerForRedemption = redemption.ownerUserIdAtPurchase ?? redemption.shopItem.ownerUserId;
    const isOwner = ownerForRedemption === interaction.user.id;
    const memberPermissions = interaction.memberPermissions ?? guildMember?.permissions ?? null;
    const hasStaffPerms = memberPermissions
      ? memberPermissions.has(PermissionFlagsBits.Administrator) ||
        memberPermissions.has(PermissionFlagsBits.ManageGuild)
      : false;

    let isStaff = hasStaffPerms;
    if (!isStaff) {
      const capabilities = await this.services.roleCapabilityService.listForRoleIds(this.env.GUILD_ID, roleIds);
      const resolved = resolveCapabilities(capabilities);
      isStaff = resolved.canManageDashboard || resolved.canAward || resolved.canDeduct;
    }

    if (!isOwner && !isStaff) {
      await interaction.reply({
        content: "Only the item owner or staff can act on this purchase.",
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

  private formatGroupPurchaseProgress(approvalsCount: number, threshold: number) {
    return `${approvalsCount}/${threshold} approval${threshold === 1 ? "" : "s"}`;
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

  private buildGroupLeaderboardEmbed(leaderboard: GroupLeaderboardEntry[], config: GuildConfig) {
    const rankedGroups = leaderboard.slice(0, LEADERBOARD_EMBED_LIMIT);
    const featuredGroups = rankedGroups.slice(0, LEADERBOARD_FEATURED_COUNT);
    const compactGroups = rankedGroups.slice(LEADERBOARD_FEATURED_COUNT);
    const totalPoints = leaderboard.reduce((sum, group) => sum + group.pointsBalance, 0);
    const standings = featuredGroups
      .map(
        (group, index) =>
          `${this.formatRankMarker(index)} **${group.displayName}**\n${this.formatPointsAmount(group.pointsBalance, config)}`,
      )
      .join("\n\n");
    const compactStandings = compactGroups
      .map(
        (group, index) =>
          `#${LEADERBOARD_FEATURED_COUNT + index + 1} **${group.displayName}** · ${this.formatPointsAmount(group.pointsBalance, config)}`,
      )
      .join("\n");
    const fields = [
      { name: "Standings", value: standings, inline: false },
      ...(compactStandings ? [{ name: "Also ranked", value: compactStandings, inline: false }] : []),
      { name: "Groups", value: `${leaderboard.length}`, inline: true },
      { name: "Total in play", value: this.formatPointsAmount(totalPoints, config), inline: true },
    ];

    return new EmbedBuilder()
      .setColor(GROUP_LEADERBOARD_COLOUR)
      .setTitle("Group Leaderboard")
      .setDescription(
        `${leaderboard.length} group${leaderboard.length === 1 ? "" : "s"} ranked by shared ${config.pointsName}.`,
      )
      .addFields(fields)
      .setFooter({ text: `Shared ${config.pointsName} drive the public board and /buyforgroup.` });
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
  ) {
    const rankedParticipants = leaderboard.slice(0, LEADERBOARD_EMBED_LIMIT);
    const featuredParticipants = rankedParticipants.slice(0, LEADERBOARD_FEATURED_COUNT);
    const compactParticipants = rankedParticipants.slice(LEADERBOARD_FEATURED_COUNT);
    const totalCurrency = leaderboard.reduce((sum, participant) => sum + participant.currencyBalance, 0);
    const standings = featuredParticipants
      .map((participant, index) => {
        const displayName = displayNames.get(participant.id) ?? participant.discordUsername ?? participant.indexId;
        return `${this.formatRankMarker(index)} **${displayName}**\n${this.formatCurrencyAmount(participant.currencyBalance, config)}`;
      })
      .join("\n\n");
    const compactStandings = compactParticipants
      .map((participant, index) => {
        const displayName = displayNames.get(participant.id) ?? participant.discordUsername ?? participant.indexId;
        return `#${LEADERBOARD_FEATURED_COUNT + index + 1} **${displayName}** · ${this.formatCurrencyAmount(participant.currencyBalance, config)}`;
      })
      .join("\n");
    const fields = [
      { name: "Standings", value: standings, inline: false },
      ...(compactStandings ? [{ name: "Also ranked", value: compactStandings, inline: false }] : []),
      { name: "Wallets tracked", value: `${leaderboard.length}`, inline: true },
      { name: "Total held", value: this.formatCurrencyAmount(totalCurrency, config), inline: true },
    ];

    return new EmbedBuilder()
      .setColor(FORBES_EMBED_COLOUR)
      .setTitle("Forbes Wallet Board")
      .setDescription(
        `${leaderboard.length} participant${leaderboard.length === 1 ? "" : "s"} ranked by wallet ${config.currencyName}.`,
      )
      .addFields(fields)
      .setFooter({ text: "Server display names are shown when Discord can resolve them." });
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
          .resolveGroupFromRoleIds(this.env.GUILD_ID, Array.from(candidate.roles.cache.keys()))
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

      // --- 2. Extract the preferred submission image -------------------------
      // Prefer an image on the original message. If the original is text-only,
      // allow the reply to provide the image instead.
      const imageAttachment = original.attachments.find((a) =>
        a.contentType?.startsWith("image/"),
      );

      // Also consider images in the reply itself as a fallback
      const replyImageAttachment = message.attachments.find((a) =>
        a.contentType?.startsWith("image/"),
      );

      const attachment = imageAttachment ?? replyImageAttachment;

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
        roleIds: Array.from(member.roles.cache.keys()),
      });

      // --- 5. Resolve assignment --------------------------------------------
      const activeAssignments = await this.services.assignmentService.listActive(guildId);
      const assignmentLookup = this.resolveActiveAssignment(activeAssignments, assignmentIdentifier);

      if (assignmentLookup.kind === "missing") {
        await message.reply(
          `Assignment not found. Available assignments: ${this.formatAssignmentChoices(activeAssignments)}`,
        );
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
          "The message you replied to has no image and no text. There is nothing to submit.",
        );
        return;
      }

      // --- 7. Upload image if present ---------------------------------------
      let imageUrl: string | undefined;
      let imageKey: string | undefined;

      if (attachment) {
        if (attachment.size > 10 * 1024 * 1024) {
          await message.reply("Image must be under 10 MB.");
          return;
        }

        if (this.storageService.isConfigured) {
          try {
            const response = await fetch(attachment.url);
            if (!response.ok) {
              await message.reply("Failed to download the image. It may have expired — try re-uploading it.");
              return;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const result = await this.storageService.upload({
              buffer,
              contentType: attachment.contentType ?? "image/png",
              folder: `submissions/${guildId}`,
              originalFilename: attachment.name ?? undefined,
            });
            imageUrl = result.url;
            imageKey = result.key;
          } catch {
            await message.reply("Failed to upload image. Please try again or contact an admin.");
            return;
          }
        } else {
          imageUrl = attachment.url;
        }
      }

      // --- 8. Create or replace submission ----------------------------------
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

      const verb = result.replaced ? "updated" : "received";
      await message.reply(
        `Submission ${verb} for **${result.submission.assignment.title}**! It will be reviewed by an admin.`,
      );
    } catch (error) {
      const text = error instanceof AppError ? error.message : "Something went wrong with your submission.";
      await message.reply(text).catch(() => {});
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction) {
    if (interaction.commandName === "leaderboard") {
      await interaction.deferReply();
      const [leaderboard, config] = await Promise.all([
        this.services.economyService.getLeaderboard(this.env.GUILD_ID),
        this.services.configService.getOrCreate(this.env.GUILD_ID),
      ]);
      if (leaderboard.length === 0) {
        await interaction.editReply({ content: "No groups yet." });
        return;
      }

      await interaction.editReply({ embeds: [this.buildGroupLeaderboardEmbed(leaderboard, config)] });
      return;
    }

    if (interaction.commandName === "forbes") {
      await interaction.deferReply();
      const [leaderboard, config] = await Promise.all([
        this.services.participantService.getCurrencyLeaderboard(this.env.GUILD_ID),
        this.services.configService.getOrCreate(this.env.GUILD_ID),
      ]);
      if (leaderboard.length === 0) {
        await interaction.editReply({ content: "No participants yet." });
        return;
      }

      const visibleParticipants = leaderboard.slice(0, LEADERBOARD_EMBED_LIMIT);
      const displayNames = await this.resolveParticipantDisplayNames(interaction.guild, visibleParticipants);
      await interaction.editReply({ embeds: [this.buildForbesEmbed(leaderboard, displayNames, config)] });
      return;
    }

    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = member ? Array.from(member.roles.cache.keys()) : [];
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
        const balance = await this.services.economyService.getGroupBalance(group.id);
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const walletBalance = await this.services.participantCurrencyService.getParticipantBalance(participant.id);
        await interaction.reply({
          content: `${group.displayName}: ${this.formatPointsAmount(balance.pointsBalance, config)} available for the leaderboard and /buyforgroup. Your wallet: ${this.formatCurrencyAmount(walletBalance, config)}.`,
          ephemeral: true,
        });
        return;
      }
      case "ledger": {
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const page = interaction.options.getInteger("page") ?? 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const entries = await this.services.economyService.getLedger(this.env.GUILD_ID, {
          limit,
          offset,
        });

        if (entries.length === 0) {
          await interaction.reply({
            content:
              page === 1
                ? "No ledger entries yet."
                : `No ledger entries found on page ${page}. Try a smaller page number.`,
          });
          return;
        }

        const content = this.formatLedgerResponse(entries, config, page, offset);

        await interaction.reply({ content });
        return;
      }
      case "transfer": {
        const targetUser = interaction.options.getUser("member", true);
        const amount = interaction.options.getNumber("amount", true);
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const { participant: sourceParticipant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });
        const targetMember = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
          throw new AppError("Target user is not in this server.", 404);
        }
        const { participant: targetParticipant } = await this.resolveActiveParticipant({
          discordUserId: targetUser.id,
          discordUsername: targetUser.username,
          roleIds: Array.from(targetMember.roles.cache.keys()),
        });
        await this.services.participantCurrencyService.transferCurrency({
          guildId: this.env.GUILD_ID,
          actor,
          sourceParticipantId: sourceParticipant.id,
          targetParticipantId: targetParticipant.id,
          amount,
          description: `${interaction.user.username} transferred ${amount} to ${targetUser.username}`,
        });
        await interaction.reply(
          `${interaction.user.username} transferred ${this.formatCurrencyAmount(amount, config)} to ${targetUser.username}.`,
        );
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
        const donation = await this.services.economyService.donateParticipantCurrencyToGroupPoints({
          guildId: this.env.GUILD_ID,
          actor,
          participantId: sourceParticipant.id,
          groupId: group.id,
          amount,
          conversionRate: config.groupPointsPerCurrencyDonation.toNumber(),
          description: `${interaction.user.username} donated ${this.formatCurrencyAmount(amount, config)} to ${group.displayName}`,
        });
        await interaction.reply(
          `${interaction.user.username} donated ${this.formatCurrencyAmount(amount, config)} to ${group.displayName}, adding ${this.formatPointsAmount(donation.groupPointsAward, config)}.`,
        );
        return;
      }
      case "awardpoints":
      case "awardcurrency":
      case "awardcurrencybulk":
      case "deductgroup":
      case "deductmember":
      case "deductmixed": {
        const commandConfig = getAwardCommandConfig(
          interaction.commandName as AwardLikeCommandName,
        );
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
            (commandConfig.includesSingleMemberCurrency || commandConfig.includesBulkMemberCurrency) &&
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
                roleIds: Array.from(memberRecord.roles.cache.keys()),
              }));
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
              .map((syncedGroup, index) => ({ displayName: targetGroups[index]!.displayName, count: syncedGroup.count }))
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
            }
          }

          const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
          const direction = commandConfig.isDeduction ? "from" : "to";
          const summaries = [
            commandConfig.includesGroupPoints && targetGroups.length > 0
              ? `${this.formatPointsAmount(Math.abs(points), config)} ${direction} ${targetGroups.map((group) => group.displayName).join(", ")}`
              : null,
            currencyParticipant && currency !== 0
              ? `${this.formatCurrencyAmount(Math.abs(currency), config)} ${direction} ${
                  currencyMemberLabel ?? currencyParticipant.discordUsername ?? currencyParticipant.indexId
                }`
              : null,
            bulkCurrencyParticipantIds.length > 0 && currency !== 0
              ? `${this.formatCurrencyAmount(Math.abs(currency), config)} each ${direction} ${bulkCurrencyParticipantIds.length} member${
                  bulkCurrencyParticipantIds.length === 1 ? "" : "s"
                } across ${bulkCurrencyGroupSummary}`
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
      case "awardmixed":
        throw new AppError("/awardmixed is disabled for now. Use /awardpoints and /awardcurrency separately.", 400);
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
            `New listing from ${interaction.user.username}: **${listing.title}**\n${listing.description}\nQuantity: ${
              listing.quantity ?? "infinite"
            }`,
          );
        }

        await interaction.reply({ content: `Created listing: ${listing.title}`, ephemeral: true });
        return;
      }
      case "store": {
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const items = await this.services.shopService.list(this.env.GUILD_ID);
        const enabledItems = items.filter((item) => item.enabled).slice(0, 20);
        const personalLines = enabledItems
          .filter((item) => item.audience === "INDIVIDUAL")
          .map((item) => `${item.id}: ${item.emoji} ${item.name} (${this.formatCurrencyAmount(item.cost.toString(), config)})`);
        const groupLines = enabledItems
          .filter((item) => item.audience === "GROUP")
          .map((item) => `${item.id}: ${item.emoji} ${item.name} (${this.formatPointsAmount(item.cost.toString(), config)})`);
        const sections = [
          personalLines.length > 0 ? `Personal items:\n${personalLines.join("\n")}` : null,
          groupLines.length > 0 ? `Group items:\n${groupLines.join("\n")}` : null,
        ].filter((value): value is string => value !== null);
        await interaction.reply({
          content:
            sections.length > 0
              ? `${sections.join("\n\n")}\nUse /buyforme for personal wallet purchases, /buyforgroup for shared ${config.pointsName} purchases, and /donate to convert ${config.currencyName} into ${config.pointsName}.`
              : "Store is empty.",
          ephemeral: true,
        });
        return;
      }
      case "buyforme":
      case "buyforgroup": {
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const itemId = interaction.options.getString("item_id", true);
        const quantity = interaction.options.getInteger("quantity") ?? 1;
        const purchaseMode = interaction.commandName === "buyforgroup" ? "GROUP" : "INDIVIDUAL";
        const { group, participant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
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
          const posted = announcementChannelId
            ? await this.postListing(
                announcementChannelId,
                `Group purchase request for ${redemption.shopItem.emoji} **${redemption.shopItem.name}** x${redemption.quantity} by **${group.displayName}**.\nRequest ID: \`${redemption.id}\`\n${this.formatGroupPurchaseProgress(redemption.approvals.length, redemption.approvalThreshold ?? 1)} recorded.\nApprove with \`/approve_purchase purchase_id:${redemption.id}\`.`,
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

        await interaction.reply({
          content:
            purchaseMode === "GROUP"
              ? `Group purchase request created for ${quantity} item(s). Request ID: ${redemption.id}. ${this.formatGroupPurchaseProgress(redemption.approvals.length, redemption.approvalThreshold ?? 1)} recorded. Group members can approve it with /approve_purchase and spend shared ${config.pointsName} if it passes.${sharedMessageSuffix}`
              : `Purchase recorded for ${quantity} item(s). Request ID: ${redemption.id}. Cost uses your ${config.currencyName}.`,
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
            ? ` ${result.blockingGroup} does not currently have enough ${config.pointsName}, so the request stays open until more are earned or donated.`
            : "";

        if (result.justExecuted) {
          const fulfilmentChannelId = config.redemptionChannelId ?? interaction.channelId;
          const fullRedemption = await this.services.shopService.getRedemption(
            this.env.GUILD_ID,
            result.redemption.id,
          );
          if (fulfilmentChannelId && fullRedemption) {
            const buyerUserId = fullRedemption.requestedByUserId;
            const posted = await this.postRedemptionFulfilmentNotice({
              channelId: fulfilmentChannelId,
              ownerUserId: fullRedemption.shopItem.ownerUserId,
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

        await interaction.reply({
          content: result.executed
            ? `Approval recorded. ${progress}. The group purchase is now funded and pending fulfilment.${blockingSuffix}`
            : `Approval recorded. ${progress}.${blockingSuffix}`,
          ephemeral: true,
        });
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
        const text = interaction.options.getString("text") ?? "";
        const attachment = interaction.options.getAttachment("image");

        const activeAssignments = await this.services.assignmentService.listActive(this.env.GUILD_ID);
        const assignmentLookup = this.resolveActiveAssignment(activeAssignments, assignmentIdentifier);

        if (assignmentLookup.kind === "missing") {
          await interaction.editReply(
            `Assignment not found. Available assignments: ${this.formatAssignmentChoices(activeAssignments)}`,
          );
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
          if (!attachment.contentType?.startsWith("image/")) {
            await interaction.editReply("Only image files are accepted as attachments.");
            return;
          }

          if (attachment.size > 10 * 1024 * 1024) {
            await interaction.editReply("Image must be under 10 MB.");
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

        const submission = await this.services.submissionService.create({
          guildId: this.env.GUILD_ID,
          assignmentId: assignment.id,
          participantId: participant.id,
          text,
          imageUrl,
          imageKey,
        });

        await interaction.editReply(
          `Submission received for **${submission.assignment.title}**! It will be reviewed by an admin.`,
        );
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
        const { participant } = await this.resolveActiveParticipant({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          roleIds,
        });
        const result = await this.services.bettingService.placeBet({
          guildId: this.env.GUILD_ID,
          actor,
          participantId: participant.id,
          amount,
        });

        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
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
        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const stats = await this.services.bettingService.getStats(this.env.GUILD_ID, targetUser.id);
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);

        if (stats.totalBets === 0) {
          await interaction.reply({
            content: targetUser.id === interaction.user.id
              ? "You haven't placed any bets yet."
              : `${targetUser.username} hasn't placed any bets yet.`,
            ephemeral: true,
          });
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

        await interaction.reply({ content: lines.join("\n"), ephemeral: true });
        return;
      }
      default:
        throw new AppError("Unknown command.", 404);
    }
  }

  private formatLedgerResponse(
    entries: CommandLedgerEntry[],
    config: GuildConfig,
    page: number,
    offset: number,
  ) {
    return [
      `Recent transactions, page ${page}:`,
      ...entries.map((entry, index) => this.formatLedgerLine(entry, config, offset + index + 1)),
      "Use /ledger with page:2, page:3, and so on to go back further.",
    ].join("\n");
  }

  private formatLedgerLine(
    entry: CommandLedgerEntry,
    config: GuildConfig,
    index: number,
  ) {
    const timestamp = Math.floor(new Date(entry.createdAt).getTime() / 1000);
    const splitSummary = entry.splits
      .map((split) => {
        const deltas = [
          split.pointsDelta === 0 ? null : this.formatSignedPointsAmount(split.pointsDelta, config),
          split.currencyDelta === 0 ? null : this.formatSignedCurrencyAmount(split.currencyDelta, config),
        ].filter((value): value is string => value !== null);

        return `${split.group.displayName} ${deltas.join(" / ")}`;
      })
      .join("; ");

    return this.truncateText(
      `${index}. <t:${timestamp}:g> · ${entry.type} · ${splitSummary} · ${entry.description}`,
      MAX_LEDGER_LINE_LENGTH,
    );
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
        .setDescription("Show the 10 most recent ledger entries.")
        .addIntegerOption((option) =>
          option.setName("page").setDescription("Page number, 10 entries per page").setRequired(false).setMinValue(1),
        ),
      new SlashCommandBuilder()
        .setName("transfer")
        .setDescription("Send wallet currency to another student.")
        .addUserOption((option) => option.setName("member").setDescription("Recipient").setRequired(true))
        .addNumberOption((option) => option.setName("amount").setDescription("Currency amount").setRequired(true)),
      new SlashCommandBuilder()
        .setName("donate")
        .setDescription("Convert your wallet currency into group points.")
        .addNumberOption((option) => option.setName("amount").setDescription("Currency amount").setRequired(true)),
      buildAwardLikeCommand("awardpoints", "Award group points."),
      buildAwardLikeCommand("awardcurrency", "Award participant currency."),
      buildAwardLikeCommand("awardcurrencybulk", "Award participant currency to every eligible member in selected groups."),
      // buildAwardLikeCommand("awardmixed", "Award group points and participant currency together."),
      buildAwardLikeCommand("deductgroup", "Deduct group points."),
      buildAwardLikeCommand("deductmember", "Deduct participant currency."),
      buildAwardLikeCommand("deductmixed", "Deduct group points and participant currency together."),
      new SlashCommandBuilder()
        .setName("store")
        .setDescription("Browse the custom shop."),
      new SlashCommandBuilder()
        .setName("buyforme")
        .setDescription("Buy a shop item for yourself.")
        .addStringOption((option) => option.setName("item_id").setDescription("Shop item id").setRequired(true))
        .addIntegerOption((option) => option.setName("quantity").setDescription("Quantity").setRequired(false)),
      new SlashCommandBuilder()
        .setName("buyforgroup")
        .setDescription("Start a group purchase request for a shop item.")
        .addStringOption((option) => option.setName("item_id").setDescription("Shop item id").setRequired(true))
        .addIntegerOption((option) => option.setName("quantity").setDescription("Quantity").setRequired(false)),
      new SlashCommandBuilder()
        .setName("approve_purchase")
        .setDescription("Approve a pending group shop purchase.")
        .addStringOption((option) =>
          option.setName("purchase_id").setDescription("Full purchase ID shared in /buyforgroup").setRequired(true),
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
        .addStringOption((option) => option.setName("assignment").setDescription("Assignment ID or exact title").setRequired(true))
        .addAttachmentOption((option) => option.setName("image").setDescription("Image attachment").setRequired(false))
        .addStringOption((option) => option.setName("text").setDescription("Description or notes for your submission").setRequired(false)),
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
    ].map((command) => command.toJSON());

    await rest.put(Routes.applicationGuildCommands(this.env.DISCORD_APPLICATION_ID, this.env.DISCORD_GUILD_ID), {
      body: commands,
    });
  }
}
