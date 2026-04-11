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
type ActiveAssignment = Awaited<ReturnType<AppServices["assignmentService"]["listActive"]>>[number];
type AssignmentLookupResult =
  | { kind: "resolved"; assignment: ActiveAssignment }
  | { kind: "ambiguous"; matches: ActiveAssignment[] }
  | { kind: "missing" };

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

      // Reply-based submission: user replies to their own message and @mentions the bot
      if (
        message.reference?.messageId &&
        this.client?.user &&
        message.mentions.has(this.client.user)
      ) {
        await this.handleReplySubmission(message);
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
      const participant = await this.services.participantService.findByDiscordUser(
        guildId,
        message.author.id,
      );

      if (!participant) {
        await message.reply(
          "You need to register first. Use `/register` with your index ID and group.",
        );
        return;
      }

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
      case "register": {
        const indexId = interaction.options.getString("index_id", true);
        const groupIdentifier = interaction.options.getString("group", true);
        const targetGroup = await this.services.groupService.resolveGroupByIdentifier(this.env.GUILD_ID, groupIdentifier);
        if (!targetGroup) {
          throw new AppError("Could not find that group. Check the name or ask an admin.");
        }

        const participant = await this.services.participantService.register({
          guildId: this.env.GUILD_ID,
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          indexId,
          groupId: targetGroup.id,
        });

        await interaction.reply({
          content: `Registered! Index ID: **${participant.indexId}**, Group: **${participant.group.displayName}**. You can now use /submit.`,
          ephemeral: true,
        });
        return;
      }
      case "submit": {
        await interaction.deferReply({ ephemeral: true });

        const participant = await this.services.participantService.findByDiscordUser(
          this.env.GUILD_ID,
          interaction.user.id,
        );
        if (!participant) {
          await interaction.editReply(
            "You need to register first. Use `/register` with your index ID and group.",
          );
          return;
        }

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
          return `${status} \`${sub.id.slice(0, 8)}\` **${sub.assignment.title}** \u2014 ${name} (${sub.participant.group.displayName})`;
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
      new SlashCommandBuilder()
        .setName("register")
        .setDescription("Register for the economy with your index ID and group.")
        .addStringOption((option) => option.setName("index_id").setDescription("Your index ID (e.g. student number)").setRequired(true))
        .addStringOption((option) => option.setName("group").setDescription("Your group name or role mention").setRequired(true)),
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
    ].map((command) => command.toJSON());

    await rest.put(Routes.applicationGuildCommands(this.env.DISCORD_APPLICATION_ID, this.env.DISCORD_GUILD_ID), {
      body: commands,
    });
  }
}
