import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from "discord.js";

import type { AppEnv } from "../config/env.js";
import type { AppServices } from "../services/app-services.js";
import { AppError } from "../utils/app-error.js";

type CooldownEntry = {
  seenAt: number;
};

type CommandLedgerEntry = Awaited<ReturnType<AppServices["economyService"]["getLedger"]>>[number];

const MAX_LEDGER_LINE_LENGTH = 160;

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
  getDashboardMember(userId: string): Promise<DashboardMember | null>;
  postListing(channelId: string, content: string): Promise<{ channelId: string; messageId: string } | null>;
}

function isDiscordUnknownMemberError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 10007
  );
}

export class BotRuntime {
  private readonly cooldowns = new Map<string, CooldownEntry>();
  private client: Client | null = null;

  public constructor(
    private readonly env: AppEnv,
    private readonly services: AppServices,
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
      if (!interaction.isChatInputCommand() || interaction.guildId !== this.env.GUILD_ID) {
        return;
      }

      try {
        await this.handleCommand(interaction);
      } catch (error) {
        const message = error instanceof AppError ? error.message : "Unexpected command error.";
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: message });
        } else {
          await interaction.reply({ content: message, ephemeral: true });
        }
      }
    });

    await this.client.login(this.env.DISCORD_BOT_TOKEN);
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

  private async handlePassiveMessage(params: {
    memberId: string;
    roleIds: string[];
    userId: string;
    username: string;
    messageId: string;
    content: string;
    channelId: string;
  }) {
    const group = await this.services.groupService.resolveGroupFromRoleIds(this.env.GUILD_ID, params.roleIds).catch(() => null);
    if (!group) {
      return;
    }

    const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
    const cooldownKey = `${params.memberId}:${group.id}`;
    const now = Date.now();
    const previous = this.cooldowns.get(cooldownKey);
    if (previous && now - previous.seenAt < config.passiveCooldownSeconds * 1000) {
      return;
    }

    const entry = await this.services.economyService.rewardPassiveMessage({
      guildId: this.env.GUILD_ID,
      groupId: group.id,
      userId: params.userId,
      username: params.username,
      messageId: params.messageId,
      content: params.content,
      channelId: params.channelId,
      config,
    });

    if (entry) {
      this.cooldowns.set(cooldownKey, { seenAt: now });
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction) {
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = member ? Array.from(member.roles.cache.keys()) : [];
    const actor = {
      userId: interaction.user.id,
      username: interaction.user.username,
      roleIds,
    };

    switch (interaction.commandName) {
      case "leaderboard": {
        const leaderboard = await this.services.economyService.getLeaderboard(this.env.GUILD_ID);
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        const content = leaderboard
          .slice(0, 10)
          .map((group, index) => `${index + 1}. ${group.displayName}: ${group.pointsBalance} ${config.pointsName}`)
          .join("\n");
        await interaction.reply({ content: content || "No groups yet." });
        return;
      }
      case "balance": {
        const sourceGroup = await this.services.groupService.resolveGroupFromRoleIds(this.env.GUILD_ID, roleIds);
        const balance = await this.services.economyService.getGroupBalance(sourceGroup.id);
        const config = await this.services.configService.getOrCreate(this.env.GUILD_ID);
        await interaction.reply({
          content: `${sourceGroup.displayName}: ${balance.pointsBalance} ${config.pointsName}, ${balance.currencyBalance} ${config.currencyName}`,
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
      case "pay": {
        const target = interaction.options.getString("target", true);
        const amount = interaction.options.getNumber("amount", true);
        const sourceGroup = await this.services.groupService.resolveGroupFromRoleIds(this.env.GUILD_ID, roleIds);
        const targetGroup = await this.services.groupService.resolveGroupByIdentifier(this.env.GUILD_ID, target);
        if (!targetGroup) {
          throw new AppError("Target group not found.", 404);
        }
        await this.services.economyService.transferCurrency({
          guildId: this.env.GUILD_ID,
          actor,
          sourceGroupId: sourceGroup.id,
          targetGroupId: targetGroup.id,
          amount,
          description: `${sourceGroup.displayName} paid ${targetGroup.displayName}`,
        });
        await interaction.reply(`${sourceGroup.displayName} paid ${amount} to ${targetGroup.displayName}.`);
        return;
      }
      case "donate": {
        const amount = interaction.options.getNumber("amount", true);
        const sourceGroup = await this.services.groupService.resolveGroupFromRoleIds(this.env.GUILD_ID, roleIds);
        await this.services.economyService.donateCurrency({
          guildId: this.env.GUILD_ID,
          actor,
          sourceGroupId: sourceGroup.id,
          amount,
          description: `${sourceGroup.displayName} donated ${amount}`,
        });
        await interaction.reply(`${sourceGroup.displayName} donated ${amount}.`);
        return;
      }
      case "award":
      case "deduct": {
        const targets = interaction.options.getString("targets", true);
        const points = interaction.options.getNumber("points", true);
        const currency = interaction.options.getNumber("currency") ?? points;
        const reason = interaction.options.getString("reason", true);
        const targetGroups = await Promise.all(
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

        const sign = interaction.commandName === "award" ? 1 : -1;
        await this.services.economyService.awardGroups({
          guildId: this.env.GUILD_ID,
          actor,
          targetGroupIds: targetGroups.map((group) => group.id),
          pointsDelta: points * sign,
          currencyDelta: currency * sign,
          description: reason,
        });
        await interaction.reply(
          `${interaction.commandName === "award" ? "Awarded" : "Deducted"} ${Math.abs(points)} points to ${targetGroups
            .map((group) => group.displayName)
            .join(", ")}.`,
        );
        return;
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
            `New listing from ${interaction.user.username}: **${listing.title}**\n${listing.description}\nQuantity: ${
              listing.quantity ?? "infinite"
            }`,
          );
        }

        await interaction.reply({ content: `Created listing: ${listing.title}`, ephemeral: true });
        return;
      }
      case "store": {
        const items = await this.services.shopService.list(this.env.GUILD_ID);
        const lines = items
          .filter((item) => item.enabled)
          .slice(0, 15)
          .map((item) => `${item.id}: ${item.name} (${item.currencyCost.toString()})`);
        await interaction.reply({
          content: lines.length > 0 ? `Store items:\n${lines.join("\n")}\nUse /buy with the full item id.` : "Store is empty.",
          ephemeral: true,
        });
        return;
      }
      case "buy": {
        const itemId = interaction.options.getString("item_id", true);
        const quantity = interaction.options.getInteger("quantity") ?? 1;
        const sourceGroup = await this.services.groupService.resolveGroupFromRoleIds(this.env.GUILD_ID, roleIds);
        const redemption = await this.services.shopService.redeem({
          guildId: this.env.GUILD_ID,
          groupId: sourceGroup.id,
          shopItemId: itemId,
          requestedByUserId: interaction.user.id,
          requestedByUsername: interaction.user.username,
          quantity,
        });
        await interaction.reply({
          content: `Redemption recorded for ${quantity} item(s). Request ID: ${redemption.id.slice(0, 8)}`,
          ephemeral: true,
        });
        return;
      }
      default:
        throw new AppError("Unknown command.", 404);
    }
  }

  private formatLedgerResponse(
    entries: CommandLedgerEntry[],
    config: Awaited<ReturnType<AppServices["configService"]["getOrCreate"]>>,
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
    config: Awaited<ReturnType<AppServices["configService"]["getOrCreate"]>>,
    index: number,
  ) {
    const timestamp = Math.floor(new Date(entry.createdAt).getTime() / 1000);
    const splitSummary = entry.splits
      .map((split) => {
        const deltas = [
          split.pointsDelta === 0 ? null : `${this.formatSignedNumber(split.pointsDelta)} ${config.pointsName}`,
          split.currencyDelta === 0 ? null : `${this.formatSignedNumber(split.currencyDelta)} ${config.currencyName}`,
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
      new SlashCommandBuilder().setName("balance").setDescription("Show your group balance."),
      new SlashCommandBuilder()
        .setName("ledger")
        .setDescription("Show the 10 most recent ledger entries.")
        .addIntegerOption((option) =>
          option.setName("page").setDescription("Page number, 10 entries per page").setRequired(false).setMinValue(1),
        ),
      new SlashCommandBuilder()
        .setName("pay")
        .setDescription("Pay another group from your group wallet.")
        .addStringOption((option) => option.setName("target").setDescription("Group role mention or alias").setRequired(true))
        .addNumberOption((option) => option.setName("amount").setDescription("Currency amount").setRequired(true)),
      new SlashCommandBuilder()
        .setName("donate")
        .setDescription("Donate currency from your group.")
        .addNumberOption((option) => option.setName("amount").setDescription("Currency amount").setRequired(true)),
      new SlashCommandBuilder()
        .setName("award")
        .setDescription("Award one or more groups.")
        .addStringOption((option) => option.setName("targets").setDescription("Comma-separated aliases or role mentions").setRequired(true))
        .addNumberOption((option) => option.setName("points").setDescription("Points delta").setRequired(true))
        .addNumberOption((option) =>
          option.setName("currency").setDescription("Currency delta; defaults to points amount").setRequired(false),
        )
        .addStringOption((option) => option.setName("reason").setDescription("Award reason").setRequired(true)),
      new SlashCommandBuilder()
        .setName("deduct")
        .setDescription("Deduct from one or more groups.")
        .addStringOption((option) => option.setName("targets").setDescription("Comma-separated aliases or role mentions").setRequired(true))
        .addNumberOption((option) => option.setName("points").setDescription("Points delta").setRequired(true))
        .addNumberOption((option) =>
          option.setName("currency").setDescription("Currency delta; defaults to points amount").setRequired(false),
        )
        .addStringOption((option) => option.setName("reason").setDescription("Deduction reason").setRequired(true)),
      new SlashCommandBuilder()
        .setName("store")
        .setDescription("Browse the custom shop."),
      new SlashCommandBuilder()
        .setName("buy")
        .setDescription("Buy a shop item.")
        .addStringOption((option) => option.setName("item_id").setDescription("Shop item id").setRequired(true))
        .addIntegerOption((option) => option.setName("quantity").setDescription("Quantity").setRequired(false)),
      new SlashCommandBuilder()
        .setName("sell")
        .setDescription("Create a marketplace listing.")
        .addStringOption((option) => option.setName("title").setDescription("Listing title").setRequired(true))
        .addStringOption((option) => option.setName("description").setDescription("Listing description").setRequired(true))
        .addIntegerOption((option) => option.setName("quantity").setDescription("Quantity, leave blank for infinite").setRequired(false)),
    ].map((command) => command.toJSON());

    await rest.put(Routes.applicationGuildCommands(this.env.DISCORD_APPLICATION_ID, this.env.DISCORD_GUILD_ID), {
      body: commands,
    });
  }
}
