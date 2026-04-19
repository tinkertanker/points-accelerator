import { randomBytes } from "node:crypto";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppEnv } from "./config/env.js";
import type { DiscordOAuthClient } from "./auth/discord-oauth.js";
import type { BotRuntimeApi } from "./bot/runtime.js";
import type { AppServices } from "./services/app-services.js";
import type { StorageService } from "./services/storage-service.js";
import { resolveCapabilities } from "./domain/permissions.js";
import { AppError } from "./utils/app-error.js";
import { decimalToNumber } from "./utils/decimal.js";

const authCallbackSchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

const SESSION_COOKIE_NAME = "dashboard_session";
const OAUTH_STATE_COOKIE_NAME = "discord_oauth_state";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

const settingsSchema = z.object({
  appName: z.string().min(1),
  pointsName: z.string().min(1),
  pointsSymbol: z.string().min(1),
  currencyName: z.string().min(1),
  currencySymbol: z.string().min(1),
  groupPointsPerCurrencyDonation: z.number().positive(),
  mentorRoleIds: z.array(z.string()),
  passivePointsReward: z.number().nonnegative(),
  passiveCurrencyReward: z.number().nonnegative(),
  passiveCooldownSeconds: z.number().int().positive(),
  passiveMinimumCharacters: z.number().int().nonnegative(),
  passiveAllowedChannelIds: z.array(z.string()),
  passiveDeniedChannelIds: z.array(z.string()),
  commandLogChannelId: z.string().nullable(),
  redemptionChannelId: z.string().nullable(),
  listingChannelId: z.string().nullable(),
  betWinChance: z.number().int().min(0).max(100),
  bettingCooldownSeconds: z.number().int().nonnegative(),
});

const roleCapabilitySchema = z.object({
  roleId: z.string().min(1),
  roleName: z.string().min(1),
  canManageDashboard: z.boolean(),
  canAward: z.boolean(),
  maxAward: z.number().nonnegative().nullable(),
  actionCooldownSeconds: z.number().int().nonnegative().nullable().optional(),
  canDeduct: z.boolean(),
  canMultiAward: z.boolean(),
  canSell: z.boolean(),
  canReceiveAwards: z.boolean(),
  isGroupRole: z.boolean(),
});

const groupSchema = z.object({
  id: z.string().optional(),
  displayName: z.string().min(1),
  slug: z.string().optional(),
  mentorName: z.string().nullable().optional(),
  roleId: z.string().min(1),
  aliases: z.array(z.string()),
  active: z.boolean().default(true),
});

const shopItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().min(1),
  audience: z.enum(["INDIVIDUAL", "GROUP"]),
  cost: z.number().nonnegative(),
  stock: z.number().int().nonnegative().nullable(),
  enabled: z.boolean(),
  fulfillmentInstructions: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  ownerUserId: z
    .string()
    .nullable()
    .optional()
    .refine((value) => !value || /^\d{17,20}$/.test(value), {
      message: "Owner must be a Discord user ID (17–20 digits)",
    }),
  ownerUsername: z.string().nullable().optional(),
});

const listingSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  quantity: z.number().int().positive().nullable().optional(),
  actorUserId: z.string().min(1),
  actorUsername: z.string().optional(),
  actorRoleIds: z.array(z.string()),
});

const awardSchema = z.object({
  actorUserId: z.string().optional(),
  actorUsername: z.string().optional(),
  actorRoleIds: z.array(z.string()),
  targetGroupIds: z.array(z.string()).default([]),
  targetParticipantId: z.string().min(1).optional(),
  pointsDelta: z.number().default(0),
  currencyDelta: z.number().optional().default(0),
  description: z.string().min(1),
});

const paySchema = z.object({
  actorUserId: z.string().optional(),
  actorUsername: z.string().optional(),
  actorRoleIds: z.array(z.string()),
  sourceParticipantId: z.string().min(1),
  targetParticipantId: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
});

const donateSchema = z.object({
  actorUserId: z.string().optional(),
  actorUsername: z.string().optional(),
  actorRoleIds: z.array(z.string()),
  sourceParticipantId: z.string().min(1),
  groupId: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
});

const redeemSchema = z.object({
  participantId: z.string().min(1),
  shopItemId: z.string().min(1),
  requestedByUserId: z.string().min(1),
  requestedByUsername: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  purchaseMode: z.enum(["INDIVIDUAL", "GROUP"]).optional(),
});

const approveGroupPurchaseSchema = z.object({
  redemptionId: z.string().min(1),
  participantId: z.string().min(1),
  approvedByUserId: z.string().min(1),
  approvedByUsername: z.string().optional(),
});

const redemptionStatusUpdateSchema = z.object({
  status: z.enum(["FULFILLED", "CANCELED"]),
});

const assignmentSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  baseCurrencyReward: z.number().nonnegative(),
  basePointsReward: z.number().nonnegative(),
  bonusCurrencyReward: z.number().nonnegative(),
  bonusPointsReward: z.number().nonnegative(),
  deadline: z.string().nullable().optional(),
  active: z.boolean(),
  sortOrder: z.number().int().optional(),
});

const submissionReviewSchema = z.object({
  status: z.enum(["APPROVED", "OUTSTANDING", "REJECTED"]),
  reviewNote: z.string().optional(),
});

const participantRegisterSchema = z.object({
  discordUserId: z.string().min(1),
  discordUsername: z.string().optional(),
  indexId: z.string().min(1),
  groupId: z.string().min(1),
});

export function createApp(params: {
  env: AppEnv;
  services: AppServices;
  botRuntime: BotRuntimeApi | null;
  discordOAuthClient?: DiscordOAuthClient | null;
  storageService?: StorageService | null;
}) {
  const app = Fastify({ logger: true, trustProxy: true });
  const { services } = params;
  const dashboardSessions = new Map<string, { userId: string; expiresAt: number }>();

  const buildAppUrl = (path = "/") => {
    const appUrl = params.env.APP_PUBLIC_URL ?? (params.env.APP_DOMAIN ? `https://${params.env.APP_DOMAIN}` : undefined);
    if (!appUrl) {
      return path;
    }

    return new URL(path, appUrl).toString();
  };

  const buildDiscordRedirectUri = (request: FastifyRequest) => {
    if (params.env.DISCORD_OAUTH_REDIRECT_URI) {
      return params.env.DISCORD_OAUTH_REDIRECT_URI;
    }

    const protocolHeader = request.headers["x-forwarded-proto"];
    const hostHeader = request.headers["x-forwarded-host"] ?? request.headers.host;
    const protocol = typeof protocolHeader === "string" ? protocolHeader.split(",")[0] : request.protocol;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

    if (!host) {
      throw new AppError("Could not determine the OAuth callback URL.", 500);
    }

    return `${protocol}://${host}/api/auth/discord/callback`;
  };

  const buildAuthRedirectUrl = (errorMessage?: string) => {
    const baseUrl = buildAppUrl("/");
    if (!errorMessage) {
      return baseUrl;
    }

    const url = new URL(baseUrl, "http://localhost");
    url.searchParams.set("auth_error", errorMessage);
    return baseUrl.startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
  };

  const shouldUseSecureCookies = (request: FastifyRequest) => {
    const configuredUrl =
      params.env.APP_PUBLIC_URL ??
      params.env.DISCORD_OAUTH_REDIRECT_URI ??
      (params.env.APP_DOMAIN ? `https://${params.env.APP_DOMAIN}` : undefined);

    if (configuredUrl) {
      return new URL(configuredUrl).protocol === "https:";
    }

    const protocolHeader = request.headers["x-forwarded-proto"];
    const forwardedProtocol = typeof protocolHeader === "string" ? protocolHeader.split(",")[0] : request.protocol;
    return forwardedProtocol === "https";
  };

  const destroyDashboardSession = (sessionId?: string) => {
    if (!sessionId) {
      return;
    }

    dashboardSessions.delete(sessionId);
  };

  const clearDashboardSession = (request: FastifyRequest, reply: FastifyReply) => {
    destroyDashboardSession(request.cookies[SESSION_COOKIE_NAME]);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  };

  const createDashboardSession = (userId: string) => {
    const sessionId = randomBytes(24).toString("hex");
    dashboardSessions.set(sessionId, {
      userId,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return sessionId;
  };

  const getSessionRecord = (sessionId?: string) => {
    if (!sessionId) {
      return null;
    }

    const session = dashboardSessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      dashboardSessions.delete(sessionId);
      return null;
    }

    return session;
  };

  const buildDashboardAccess = (params: {
    isGuildOwner: boolean;
    hasAdministrator: boolean;
    hasManageGuild: boolean;
    canManageDashboardRole: boolean;
    roleIds: string[];
    mentorRoleIds: string[];
  }) => {
    const isAdmin =
      params.canManageDashboardRole || params.isGuildOwner || params.hasAdministrator || params.hasManageGuild;
    const isMentor = isAdmin || params.roleIds.some((roleId) => params.mentorRoleIds.includes(roleId));
    const dashboardAccessLevel = isAdmin ? "admin" : isMentor ? "mentor" : "viewer";

    return {
      dashboardAccessLevel,
      canManageDashboard: isAdmin || isMentor,
      canManageSettings: isAdmin,
      canManageGroups: isAdmin,
      canManageShop: isMentor,
      canManageAssignments: isMentor,
      canViewLeaderboard: true,
    };
  };

  const resolveDashboardSession = async (request: FastifyRequest) => {
    if (params.env.NODE_ENV === "test") {
      const headerToken = typeof request.headers["x-admin-token"] === "string" ? request.headers["x-admin-token"] : undefined;
      if (headerToken && params.env.ADMIN_TOKEN && headerToken === params.env.ADMIN_TOKEN) {
        return {
          userId: "test-admin",
          username: "Test Admin",
          displayName: "Test Admin",
          avatarUrl: null,
          roleIds: [],
          isGuildOwner: false,
          hasAdministrator: true,
          hasManageGuild: true,
          ...buildDashboardAccess({
            isGuildOwner: false,
            hasAdministrator: true,
            hasManageGuild: true,
            canManageDashboardRole: true,
            roleIds: [],
            mentorRoleIds: [],
          }),
        };
      }
    }

    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const session = getSessionRecord(sessionId);
    if (!session) {
      throw new AppError("Unauthorized", 401);
    }

    const member = await params.botRuntime?.getDashboardMember(session.userId);
    if (!member) {
      destroyDashboardSession(sessionId);
      throw new AppError("You must be a member of the configured Discord server to use the dashboard.", 401);
    }

    const settings = await services.configService.getOrCreate(params.env.GUILD_ID);
    const capabilities = await services.roleCapabilityService.listForRoleIds(params.env.GUILD_ID, member.roleIds);
    const resolved = resolveCapabilities(capabilities);
    const access = buildDashboardAccess({
      isGuildOwner: member.isGuildOwner,
      hasAdministrator: member.hasAdministrator,
      hasManageGuild: member.hasManageGuild,
      canManageDashboardRole: resolved.canManageDashboard,
      roleIds: member.roleIds,
      mentorRoleIds: settings.mentorRoleIds,
    });

    dashboardSessions.set(sessionId!, {
      userId: session.userId,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return {
      ...member,
      ...access,
    };
  };

  const requireDashboardMember = async (request: FastifyRequest) => {
    await resolveDashboardSession(request);
  };

  const requireAdmin = async (request: FastifyRequest) => {
    const session = await resolveDashboardSession(request);
    if (!session.canManageSettings) {
      throw new AppError("Only dashboard admins can manage settings and groups.", 403);
    }
  };

  const requireMentor = async (request: FastifyRequest) => {
    const session = await resolveDashboardSession(request);
    if (!session.canManageShop || !session.canManageAssignments) {
      throw new AppError("Only mentors and dashboard admins can manage the shop and assignments.", 403);
    }
  };

  const serialiseSettings = (settings: Awaited<ReturnType<AppServices["configService"]["getOrCreate"]>>) => ({
    appName: settings.appName,
    pointsName: settings.pointsName,
    pointsSymbol: settings.pointsSymbol,
    currencyName: settings.currencyName,
    currencySymbol: settings.currencySymbol,
    groupPointsPerCurrencyDonation: decimalToNumber(settings.groupPointsPerCurrencyDonation),
    mentorRoleIds: settings.mentorRoleIds,
    passivePointsReward: decimalToNumber(settings.passivePointsReward),
    passiveCurrencyReward: decimalToNumber(settings.passiveCurrencyReward),
    passiveCooldownSeconds: settings.passiveCooldownSeconds,
    passiveMinimumCharacters: settings.passiveMinimumCharacters,
    passiveAllowedChannelIds: settings.passiveAllowedChannelIds,
    passiveDeniedChannelIds: settings.passiveDeniedChannelIds,
    commandLogChannelId: settings.commandLogChannelId,
    redemptionChannelId: settings.redemptionChannelId,
    listingChannelId: settings.listingChannelId,
    betWinChance: settings.betWinChance,
    bettingCooldownSeconds: settings.bettingCooldownSeconds,
  });

  const serialiseGroup = (group: Awaited<ReturnType<AppServices["groupService"]["list"]>>[number]) => ({
    id: group.id,
    displayName: group.displayName,
    slug: group.slug,
    mentorName: group.mentorName,
    roleId: group.roleId,
    active: group.active,
    aliases: group.aliases,
    pointsBalance: group.pointsBalance,
  });

  const serialiseLeaderboardEntry = (group: Awaited<ReturnType<AppServices["economyService"]["getLeaderboard"]>>[number]) => ({
    id: group.id,
    displayName: group.displayName,
    pointsBalance: group.pointsBalance,
  });

  const serialiseShopRedemption = (
    redemption: NonNullable<Awaited<ReturnType<AppServices["shopService"]["getRedemption"]>>>,
  ) => {
    return {
      id: redemption.id,
      purchaseMode: redemption.purchaseMode,
      quantity: redemption.quantity,
      totalCost: decimalToNumber(redemption.totalCost),
      approvalThreshold: redemption.approvalThreshold,
      status: redemption.status,
      notes: redemption.notes,
      createdAt: redemption.createdAt.toISOString(),
      updatedAt: redemption.updatedAt.toISOString(),
      requestedByUserId: redemption.requestedByUserId,
      requestedByUsername: redemption.requestedByUsername,
      approvalMessageChannelId: redemption.approvalMessageChannelId,
      approvalMessageId: redemption.approvalMessageId,
      shopItem: {
        id: redemption.shopItem.id,
        name: redemption.shopItem.name,
        audience: redemption.shopItem.audience,
        fulfillmentInstructions: redemption.shopItem.fulfillmentInstructions,
        emoji: redemption.shopItem.emoji,
        ownerUserId: redemption.shopItem.ownerUserId,
        ownerUsername: redemption.shopItem.ownerUsername,
      },
      group: {
        id: redemption.group.id,
        displayName: redemption.group.displayName,
      },
      requestedByParticipant: redemption.requestedByParticipant
        ? {
            id: redemption.requestedByParticipant.id,
            discordUserId: redemption.requestedByParticipant.discordUserId,
            discordUsername: redemption.requestedByParticipant.discordUsername,
            indexId: redemption.requestedByParticipant.indexId,
          }
        : null,
      approvals: redemption.approvals.map((approval) => ({
        participant: {
          id: approval.participant.id,
          discordUserId: approval.participant.discordUserId,
          discordUsername: approval.participant.discordUsername,
          indexId: approval.participant.indexId,
        },
      })),
    };
  };

  app.register(cors, {
    origin: true,
    credentials: true,
  });
  app.register(cookie);
  app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB
      files: 1,
    },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({ message: error.message });
      return;
    }

    if (error instanceof z.ZodError) {
      reply.status(400).send({ message: "Invalid request", issues: error.issues });
      return;
    }

    request.log?.error?.(error);
    reply.status(500).send({ message: "Internal server error" });
  });

  app.get("/api/health", async () => {
    await services.prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  });

  app.get("/api/auth/discord", async (request, reply) => {
    if (!params.discordOAuthClient) {
      throw new AppError("Discord login is not configured.", 503);
    }

    const state = randomBytes(18).toString("hex");
    const redirectUri = buildDiscordRedirectUri(request);
    const secureCookies = shouldUseSecureCookies(request);

    reply.setCookie(OAUTH_STATE_COOKIE_NAME, state, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });

    return reply.redirect(params.discordOAuthClient.buildAuthorizeUrl({ state, redirectUri }));
  });

  app.get("/api/auth/discord/callback", async (request, reply) => {
    if (!params.discordOAuthClient) {
      throw new AppError("Discord login is not configured.", 503);
    }

    const query = authCallbackSchema.parse(request.query);
    const cookieState = request.cookies[OAUTH_STATE_COOKIE_NAME];

    reply.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: "/" });

    if (query.error) {
      clearDashboardSession(request, reply);
      return reply.redirect(buildAuthRedirectUrl("Discord authorisation was cancelled."));
    }

    if (!query.code || !query.state || !cookieState || query.state !== cookieState) {
      clearDashboardSession(request, reply);
      return reply.redirect(buildAuthRedirectUrl("Discord login could not be verified. Please try again."));
    }

    const redirectUri = buildDiscordRedirectUri(request);
    const secureCookies = shouldUseSecureCookies(request);

    try {
      const identity = await params.discordOAuthClient.exchangeCode({
        code: query.code,
        redirectUri,
      });

      const member = await params.botRuntime?.getDashboardMember(identity.id);
      if (!member) {
        clearDashboardSession(request, reply);
        return reply.redirect(buildAuthRedirectUrl("Join the configured Discord server before signing in."));
      }

      const sessionId = createDashboardSession(identity.id);
      reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        maxAge: SESSION_TTL_MS / 1000,
      });

      return reply.redirect(buildAuthRedirectUrl());
    } catch (error) {
      request.log?.warn?.(error);
      return reply.redirect(buildAuthRedirectUrl("Discord login failed. Please try again."));
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    clearDashboardSession(request, reply);
    return { authenticated: false };
  });

  app.get("/api/auth/session", async (request, reply) => {
    try {
      const session = await resolveDashboardSession(request);
      return {
        authenticated: true,
        user: session,
      };
    } catch (error) {
      if (error instanceof AppError && (error.statusCode === 401 || error.statusCode === 403)) {
        clearDashboardSession(request, reply);
        return { authenticated: false };
      }

      throw error;
    }
  });

  app.get("/api/bootstrap", { preHandler: requireDashboardMember }, async (request) => {
    const session = await resolveDashboardSession(request);
    const canManageAdminPages = session.canManageSettings || session.canManageGroups;
    const canManageMentorPages = session.canManageShop || session.canManageAssignments;

    const [settings, leaderboard, capabilities, groups, shopItems, listings, ledger, roles, channels, members, assignments, participants, submissions] =
      await Promise.all([
        services.configService.getOrCreate(params.env.GUILD_ID),
        services.economyService.getLeaderboard(params.env.GUILD_ID),
        canManageAdminPages ? services.roleCapabilityService.list(params.env.GUILD_ID) : Promise.resolve([]),
        canManageAdminPages ? services.groupService.list(params.env.GUILD_ID, { includeInactive: true }) : Promise.resolve([]),
        canManageMentorPages ? services.shopService.list(params.env.GUILD_ID) : Promise.resolve([]),
        canManageAdminPages ? services.listingService.list(params.env.GUILD_ID) : Promise.resolve([]),
        canManageAdminPages ? services.economyService.getLedger(params.env.GUILD_ID, 25) : Promise.resolve([]),
        canManageAdminPages ? params.botRuntime?.getRoles() ?? [] : Promise.resolve([]),
        canManageAdminPages ? params.botRuntime?.getTextChannels() ?? [] : Promise.resolve([]),
        canManageMentorPages ? params.botRuntime?.getMembers() ?? [] : Promise.resolve([]),
        canManageMentorPages ? services.assignmentService.list(params.env.GUILD_ID) : Promise.resolve([]),
        canManageAdminPages || canManageMentorPages
          ? services.participantService.list(params.env.GUILD_ID)
          : Promise.resolve([]),
        canManageMentorPages ? services.submissionService.list(params.env.GUILD_ID) : Promise.resolve([]),
      ]);

    return {
      settings: serialiseSettings(settings),
      capabilities: capabilities.map((capability) => ({
        ...capability,
        maxAward: capability.maxAward ? decimalToNumber(capability.maxAward) : null,
        actionCooldownSeconds: capability.actionCooldownSeconds,
      })),
      groups: groups.map((group) => serialiseGroup(group)),
      shopItems: shopItems.map((item) => ({
        ...item,
        cost: decimalToNumber(item.cost),
      })),
      listings,
      leaderboard: leaderboard.map((entry) => serialiseLeaderboardEntry(entry)),
      ledger,
      discord: {
        roles,
        channels,
        members,
      },
      assignments,
      participants,
      submissions,
    };
  });

  app.get("/api/settings", { preHandler: requireAdmin }, async () => {
    const settings = await services.configService.getOrCreate(params.env.GUILD_ID);
    return serialiseSettings(settings);
  });

  app.put("/api/settings", { preHandler: requireAdmin }, async (request) => {
    const input = settingsSchema.parse(request.body);
    const settings = await services.configService.update(params.env.GUILD_ID, input);
    return serialiseSettings(settings);
  });

  app.get("/api/capabilities", { preHandler: requireAdmin }, async () => {
    const capabilities = await services.roleCapabilityService.list(params.env.GUILD_ID);
    return capabilities.map((capability) => ({
      ...capability,
      maxAward: capability.maxAward ? decimalToNumber(capability.maxAward) : null,
      actionCooldownSeconds: capability.actionCooldownSeconds,
    }));
  });

  app.put("/api/capabilities", { preHandler: requireAdmin }, async (request) => {
    const payload = z.array(roleCapabilitySchema).parse(request.body);
    const capabilities = await services.roleCapabilityService.replaceAll(params.env.GUILD_ID, payload);
    return capabilities.map((capability) => ({
      ...capability,
      maxAward: capability.maxAward ? decimalToNumber(capability.maxAward) : null,
      actionCooldownSeconds: capability.actionCooldownSeconds,
    }));
  });

  app.get("/api/groups", { preHandler: requireAdmin }, async () => {
    const groups = await services.groupService.list(params.env.GUILD_ID, { includeInactive: true });
    return groups.map((group) => serialiseGroup(group));
  });

  app.post("/api/groups", { preHandler: requireAdmin }, async (request) => {
    const group = await services.groupService.upsert(params.env.GUILD_ID, groupSchema.parse(request.body));
    return group;
  });

  app.get("/api/leaderboard", { preHandler: requireDashboardMember }, async () => {
    const leaderboard = await services.economyService.getLeaderboard(params.env.GUILD_ID);
    return leaderboard.map((entry) => serialiseLeaderboardEntry(entry));
  });

  app.get("/api/ledger", { preHandler: requireAdmin }, async (request) => {
    const limit = z.coerce.number().int().positive().max(100).default(25).parse((request.query as { limit?: string }).limit);
    return services.economyService.getLedger(params.env.GUILD_ID, limit);
  });

  app.get("/api/shop-items", { preHandler: requireMentor }, async () => {
    const items = await services.shopService.list(params.env.GUILD_ID);
    return items.map((item) => ({
      ...item,
      cost: decimalToNumber(item.cost),
    }));
  });

  app.post("/api/shop-items", { preHandler: requireMentor }, async (request) => {
    const item = await services.shopService.upsert(params.env.GUILD_ID, shopItemSchema.parse(request.body));
    return {
      ...item,
      cost: decimalToNumber(item.cost),
    };
  });

  app.get("/api/shop-redemptions", { preHandler: requireMentor }, async () => {
    const redemptions = await services.shopService.listRedemptions(params.env.GUILD_ID);
    return redemptions.map((redemption) => serialiseShopRedemption(redemption));
  });

  app.post("/api/shop-redemptions/:id/status", { preHandler: requireMentor }, async (request) => {
    const payload = redemptionStatusUpdateSchema.parse(request.body);
    const session = await resolveDashboardSession(request);
    const { id } = request.params as { id: string };
    const { redemption, changed } = await services.shopService.updateRedemptionStatus({
      guildId: params.env.GUILD_ID,
      redemptionId: id,
      status: payload.status,
      actorUserId: session.userId,
      actorUsername: session.username,
    });

    if (changed && redemption.fulfilmentMessageChannelId && redemption.fulfilmentMessageId) {
      const actor = session.username ?? session.userId;
      const verb = redemption.status === "FULFILLED" ? "Fulfilled" : "Cancelled";
      const refundSuffix = redemption.status === "CANCELED" ? " and refunded" : "";
      await params.botRuntime
        ?.clearRedemptionButtons(
          redemption.fulfilmentMessageChannelId,
          redemption.fulfilmentMessageId,
          `**Status:** ${redemption.status} — ${verb}${refundSuffix} by ${actor} via the dashboard.`,
        )
        .catch(() => {});
    }

    return serialiseShopRedemption(redemption);
  });

  app.get("/api/listings", { preHandler: requireAdmin }, async () => services.listingService.list(params.env.GUILD_ID));

  app.post("/api/listings", { preHandler: requireAdmin }, async (request) => {
    const payload = listingSchema.parse(request.body);
    const config = await services.configService.getOrCreate(params.env.GUILD_ID);
    const posted = config.listingChannelId
      ? await params.botRuntime?.postListing(
          config.listingChannelId,
          `New listing from ${payload.actorUsername ?? payload.actorUserId}: **${payload.title}**\n${payload.description}\nQuantity: ${
            payload.quantity ?? "infinite"
          }`,
        )
      : null;

    return services.listingService.create({
      guildId: params.env.GUILD_ID,
      actor: {
        userId: payload.actorUserId,
        username: payload.actorUsername,
        roleIds: payload.actorRoleIds,
      },
      title: payload.title,
      description: payload.description,
      quantity: payload.quantity ?? null,
      channelId: posted?.channelId ?? config.listingChannelId,
      messageId: posted?.messageId,
    });
  });

  app.post("/api/actions/award", { preHandler: requireAdmin }, async (request) => {
    const payload = awardSchema.parse(request.body);
    if (payload.pointsDelta === 0 && payload.currencyDelta === 0) {
      throw new AppError("At least one non-zero points or currency amount is required.", 400);
    }

    if (payload.pointsDelta !== 0 && payload.targetGroupIds.length === 0) {
      throw new AppError("Select at least one group when adjusting points.", 400);
    }

    if (payload.currencyDelta !== 0 && !payload.targetParticipantId) {
      throw new AppError("Select a participant when adjusting currency.", 400);
    }

    const actor = {
      userId: payload.actorUserId,
      username: payload.actorUsername,
      roleIds: payload.actorRoleIds,
    };

    await services.prisma.$transaction(async (tx) => {
      if (payload.pointsDelta !== 0) {
        await services.economyService.awardGroups({
          guildId: params.env.GUILD_ID,
          actor,
          targetGroupIds: payload.targetGroupIds,
          pointsDelta: payload.pointsDelta,
          currencyDelta: 0,
          description: payload.description,
          executor: tx,
        });
      }

      if (payload.currencyDelta !== 0 && payload.targetParticipantId) {
        await services.participantCurrencyService.awardParticipants({
          guildId: params.env.GUILD_ID,
          actor,
          targetParticipantIds: [payload.targetParticipantId],
          currencyDelta: payload.currencyDelta,
          description: payload.description,
          executor: tx,
        });
      }
    });

    return {
      ok: true,
      targetGroupIds: payload.targetGroupIds,
      targetParticipantId: payload.targetParticipantId ?? null,
      pointsDelta: payload.pointsDelta,
      currencyDelta: payload.currencyDelta,
    };
  });

  app.post("/api/actions/pay", { preHandler: requireAdmin }, async (request) => {
    const payload = paySchema.parse(request.body);
    return services.participantCurrencyService.transferCurrency({
      guildId: params.env.GUILD_ID,
      actor: {
        userId: payload.actorUserId,
        username: payload.actorUsername,
        roleIds: payload.actorRoleIds,
      },
      sourceParticipantId: payload.sourceParticipantId,
      targetParticipantId: payload.targetParticipantId,
      amount: payload.amount,
      description: payload.description,
    });
  });

  app.post("/api/actions/donate", { preHandler: requireAdmin }, async (request) => {
    const payload = donateSchema.parse(request.body);
    const settings = await services.configService.getOrCreate(params.env.GUILD_ID);
    return services.economyService.donateParticipantCurrencyToGroupPoints({
      guildId: params.env.GUILD_ID,
      actor: {
        userId: payload.actorUserId,
        username: payload.actorUsername,
        roleIds: payload.actorRoleIds,
      },
      participantId: payload.sourceParticipantId,
      groupId: payload.groupId,
      amount: payload.amount,
      conversionRate: decimalToNumber(settings.groupPointsPerCurrencyDonation),
      description: payload.description,
    });
  });

  app.post("/api/actions/redeem", { preHandler: requireAdmin }, async (request) => {
    const payload = redeemSchema.parse(request.body);
    let groupMemberCount: number | undefined;
    if ((payload.purchaseMode ?? "INDIVIDUAL") === "GROUP") {
      const participant = await services.participantService.findById(params.env.GUILD_ID, payload.participantId);
      if (!participant) {
        throw new AppError("Participant not found.", 404);
      }

      const group = await services.groupService.findById(params.env.GUILD_ID, participant.groupId);
      if (!group) {
        throw new AppError("Group not found.", 404);
      }

      groupMemberCount = (await params.botRuntime?.getGroupMemberCount(group.roleId)) ?? undefined;
      if (!groupMemberCount || groupMemberCount <= 0) {
        throw new AppError("Live Discord group membership is unavailable for this group purchase.", 503);
      }
    }

    return services.shopService.redeem({
      guildId: params.env.GUILD_ID,
      participantId: payload.participantId,
      shopItemId: payload.shopItemId,
      requestedByUserId: payload.requestedByUserId,
      requestedByUsername: payload.requestedByUsername,
      quantity: payload.quantity,
      purchaseMode: payload.purchaseMode,
      groupMemberCount,
    });
  });

  app.post("/api/actions/approve-group-purchase", { preHandler: requireAdmin }, async (request) => {
    const payload = approveGroupPurchaseSchema.parse(request.body);
    const redemption = await services.shopService.getRedemption(params.env.GUILD_ID, payload.redemptionId);
    if (!redemption) {
      throw new AppError("Group purchase request not found.", 404);
    }

    let currentGroupMemberCount: number | undefined;
    let currentGroupMemberDiscordUserIds: string[] | undefined;
    if (redemption.purchaseMode === "GROUP") {
      currentGroupMemberCount = (await params.botRuntime?.getGroupMemberCount(redemption.group.roleId)) ?? undefined;
      currentGroupMemberDiscordUserIds = (await params.botRuntime?.getGroupMemberDiscordUserIds(redemption.group.roleId)) ?? undefined;
      if (!currentGroupMemberCount || currentGroupMemberCount <= 0) {
        throw new AppError("Live Discord group membership is unavailable for this group purchase.", 503);
      }
    }

    return services.shopService.approveGroupPurchase({
      guildId: params.env.GUILD_ID,
      redemptionId: payload.redemptionId,
      participantId: payload.participantId,
      approvedByUserId: payload.approvedByUserId,
      approvedByUsername: payload.approvedByUsername,
      currentGroupMemberCount,
      currentGroupMemberDiscordUserIds,
    });
  });

  // --- Participants ---

  app.get("/api/participants", { preHandler: requireAdmin }, async () => {
    return services.participantService.list(params.env.GUILD_ID);
  });

  app.post("/api/participants", { preHandler: requireAdmin }, async (request) => {
    const payload = participantRegisterSchema.parse(request.body);
    return services.participantService.register({
      guildId: params.env.GUILD_ID,
      ...payload,
    });
  });

  app.delete("/api/participants/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    return services.participantService.delete(params.env.GUILD_ID, id);
  });

  // --- Assignments ---

  app.get("/api/assignments", { preHandler: requireMentor }, async () => {
    return services.assignmentService.list(params.env.GUILD_ID);
  });

  app.post("/api/assignments", { preHandler: requireMentor }, async (request) => {
    const payload = assignmentSchema.parse(request.body);
    return services.assignmentService.upsert(params.env.GUILD_ID, payload);
  });

  // --- Submissions ---

  app.get("/api/submissions", { preHandler: requireMentor }, async (request) => {
    const query = request.query as { assignmentId?: string; status?: string; participantId?: string };
    const status = query.status as "PENDING" | "APPROVED" | "OUTSTANDING" | "REJECTED" | undefined;
    return services.submissionService.list(params.env.GUILD_ID, {
      assignmentId: query.assignmentId,
      status,
      participantId: query.participantId,
    });
  });

  app.post("/api/submissions/:id/review", { preHandler: requireMentor }, async (request) => {
    const { id } = request.params as { id: string };
    const payload = submissionReviewSchema.parse(request.body);
    const session = await resolveDashboardSession(request);
    return services.submissionService.review({
      guildId: params.env.GUILD_ID,
      submissionId: id,
      status: payload.status,
      reviewNote: payload.reviewNote,
      reviewedByUserId: session.userId,
      reviewedByUsername: session.username,
    });
  });

  app.get("/api/submissions/completion", { preHandler: requireMentor }, async () => {
    return services.submissionService.getCompletionSummary(params.env.GUILD_ID);
  });

  // --- Image upload (for submissions via the dashboard) ---

  app.post("/api/upload/image", { preHandler: requireAdmin }, async (request) => {
    if (!params.storageService?.isConfigured) {
      throw new AppError("Image storage is not configured. Set R2 environment variables.", 503);
    }

    const file = await request.file();
    if (!file) {
      throw new AppError("No file uploaded.", 400);
    }

    if (!file.mimetype.startsWith("image/")) {
      throw new AppError("Only image files are accepted.", 400);
    }

    const buffer = await file.toBuffer();
    const result = await params.storageService.upload({
      buffer,
      contentType: file.mimetype,
      folder: `submissions/${params.env.GUILD_ID}`,
      originalFilename: file.filename,
    });

    return result;
  });

  return app;
}
