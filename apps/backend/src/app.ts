import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppEnv } from "./config/env.js";
import type { BotRuntime } from "./bot/runtime.js";
import type { AppServices } from "./services/app-services.js";
import { AppError } from "./utils/app-error.js";
import { decimalToNumber } from "./utils/decimal.js";

const loginSchema = z.object({
  token: z.string().min(1),
});

const settingsSchema = z.object({
  appName: z.string().min(1),
  pointsName: z.string().min(1),
  currencyName: z.string().min(1),
  passivePointsReward: z.number().nonnegative(),
  passiveCurrencyReward: z.number().nonnegative(),
  passiveCooldownSeconds: z.number().int().positive(),
  passiveMinimumCharacters: z.number().int().nonnegative(),
  passiveAllowedChannelIds: z.array(z.string()),
  passiveDeniedChannelIds: z.array(z.string()),
  commandLogChannelId: z.string().nullable(),
  redemptionChannelId: z.string().nullable(),
  listingChannelId: z.string().nullable(),
  economyMode: z.enum(["SIMPLE", "ADVANCED"]),
});

const roleCapabilitySchema = z.object({
  roleId: z.string().min(1),
  roleName: z.string().min(1),
  canManageDashboard: z.boolean(),
  canAward: z.boolean(),
  maxAward: z.number().nonnegative().nullable(),
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
  currencyCost: z.number().nonnegative(),
  stock: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  fulfillmentInstructions: z.string().nullable().optional(),
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
  targetGroupIds: z.array(z.string()).min(1),
  pointsDelta: z.number(),
  currencyDelta: z.number(),
  description: z.string().min(1),
});

const paySchema = z.object({
  actorUserId: z.string().optional(),
  actorUsername: z.string().optional(),
  actorRoleIds: z.array(z.string()),
  sourceGroupId: z.string().min(1),
  targetGroupId: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
});

const donateSchema = z.object({
  actorUserId: z.string().optional(),
  actorUsername: z.string().optional(),
  actorRoleIds: z.array(z.string()),
  sourceGroupId: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
});

const redeemSchema = z.object({
  groupId: z.string().min(1),
  shopItemId: z.string().min(1),
  requestedByUserId: z.string().min(1),
  requestedByUsername: z.string().optional(),
  quantity: z.number().int().positive().optional(),
});

export function createApp(params: {
  env: AppEnv;
  services: AppServices;
  botRuntime: BotRuntime | null;
}) {
  const app = Fastify({ logger: true });
  const { services } = params;

  const requireAdmin = async (request: FastifyRequest) => {
    const headerToken = typeof request.headers["x-admin-token"] === "string" ? request.headers["x-admin-token"] : undefined;
    const cookieToken = request.cookies.admin_session;
    const token = headerToken ?? cookieToken;

    if (token !== params.env.ADMIN_TOKEN) {
      throw new AppError("Unauthorized", 401);
    }
  };

  app.register(cors, {
    origin: true,
    credentials: true,
  });
  app.register(cookie);

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

  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    if (body.token !== params.env.ADMIN_TOKEN) {
      throw new AppError("Invalid admin token", 401);
    }

    reply.setCookie("admin_session", body.token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });

    return { authenticated: true };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie("admin_session", { path: "/" });
    return { authenticated: false };
  });

  app.get("/api/auth/session", async (request) => ({
    authenticated:
      request.cookies.admin_session === params.env.ADMIN_TOKEN ||
      request.headers["x-admin-token"] === params.env.ADMIN_TOKEN,
  }));

  app.get("/api/bootstrap", { preHandler: requireAdmin }, async () => {
    const [settings, capabilities, groups, shopItems, listings, leaderboard, ledger, roles, channels] = await Promise.all([
      services.configService.getOrCreate(params.env.GUILD_ID),
      services.roleCapabilityService.list(params.env.GUILD_ID),
      services.groupService.list(params.env.GUILD_ID),
      services.shopService.list(params.env.GUILD_ID),
      services.listingService.list(params.env.GUILD_ID),
      services.economyService.getLeaderboard(params.env.GUILD_ID),
      services.economyService.getLedger(params.env.GUILD_ID, 25),
      params.botRuntime?.getRoles() ?? [],
      params.botRuntime?.getTextChannels() ?? [],
    ]);

    return {
      settings: {
        ...settings,
        passivePointsReward: decimalToNumber(settings.passivePointsReward),
        passiveCurrencyReward: decimalToNumber(settings.passiveCurrencyReward),
      },
      capabilities: capabilities.map((capability) => ({
        ...capability,
        maxAward: capability.maxAward ? decimalToNumber(capability.maxAward) : null,
      })),
      groups,
      shopItems: shopItems.map((item) => ({
        ...item,
        currencyCost: decimalToNumber(item.currencyCost),
      })),
      listings,
      leaderboard,
      ledger,
      discord: {
        roles,
        channels,
      },
    };
  });

  app.get("/api/settings", { preHandler: requireAdmin }, async () => {
    const settings = await services.configService.getOrCreate(params.env.GUILD_ID);
    return {
      ...settings,
      passivePointsReward: decimalToNumber(settings.passivePointsReward),
      passiveCurrencyReward: decimalToNumber(settings.passiveCurrencyReward),
    };
  });

  app.put("/api/settings", { preHandler: requireAdmin }, async (request) => {
    const input = settingsSchema.parse(request.body);
    const settings = await services.configService.update(params.env.GUILD_ID, input);
    return {
      ...settings,
      passivePointsReward: decimalToNumber(settings.passivePointsReward),
      passiveCurrencyReward: decimalToNumber(settings.passiveCurrencyReward),
    };
  });

  app.get("/api/capabilities", { preHandler: requireAdmin }, async () => {
    const capabilities = await services.roleCapabilityService.list(params.env.GUILD_ID);
    return capabilities.map((capability) => ({
      ...capability,
      maxAward: capability.maxAward ? decimalToNumber(capability.maxAward) : null,
    }));
  });

  app.put("/api/capabilities", { preHandler: requireAdmin }, async (request) => {
    const payload = z.array(roleCapabilitySchema).parse(request.body);
    const capabilities = await services.roleCapabilityService.replaceAll(params.env.GUILD_ID, payload);
    return capabilities.map((capability) => ({
      ...capability,
      maxAward: capability.maxAward ? decimalToNumber(capability.maxAward) : null,
    }));
  });

  app.get("/api/groups", { preHandler: requireAdmin }, async () => services.groupService.list(params.env.GUILD_ID));

  app.post("/api/groups", { preHandler: requireAdmin }, async (request) => {
    const group = await services.groupService.upsert(params.env.GUILD_ID, groupSchema.parse(request.body));
    return group;
  });

  app.get("/api/leaderboard", { preHandler: requireAdmin }, async () => services.economyService.getLeaderboard(params.env.GUILD_ID));

  app.get("/api/ledger", { preHandler: requireAdmin }, async (request) => {
    const limit = z.coerce.number().int().positive().max(100).default(25).parse((request.query as { limit?: string }).limit);
    return services.economyService.getLedger(params.env.GUILD_ID, limit);
  });

  app.get("/api/shop-items", { preHandler: requireAdmin }, async () => {
    const items = await services.shopService.list(params.env.GUILD_ID);
    return items.map((item) => ({
      ...item,
      currencyCost: decimalToNumber(item.currencyCost),
    }));
  });

  app.post("/api/shop-items", { preHandler: requireAdmin }, async (request) => {
    const item = await services.shopService.upsert(params.env.GUILD_ID, shopItemSchema.parse(request.body));
    return {
      ...item,
      currencyCost: decimalToNumber(item.currencyCost),
    };
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
    return services.economyService.awardGroups({
      guildId: params.env.GUILD_ID,
      actor: {
        userId: payload.actorUserId,
        username: payload.actorUsername,
        roleIds: payload.actorRoleIds,
      },
      targetGroupIds: payload.targetGroupIds,
      pointsDelta: payload.pointsDelta,
      currencyDelta: payload.currencyDelta,
      description: payload.description,
    });
  });

  app.post("/api/actions/pay", { preHandler: requireAdmin }, async (request) => {
    const payload = paySchema.parse(request.body);
    return services.economyService.transferCurrency({
      guildId: params.env.GUILD_ID,
      actor: {
        userId: payload.actorUserId,
        username: payload.actorUsername,
        roleIds: payload.actorRoleIds,
      },
      sourceGroupId: payload.sourceGroupId,
      targetGroupId: payload.targetGroupId,
      amount: payload.amount,
      description: payload.description,
    });
  });

  app.post("/api/actions/donate", { preHandler: requireAdmin }, async (request) => {
    const payload = donateSchema.parse(request.body);
    return services.economyService.donateCurrency({
      guildId: params.env.GUILD_ID,
      actor: {
        userId: payload.actorUserId,
        username: payload.actorUsername,
        roleIds: payload.actorRoleIds,
      },
      sourceGroupId: payload.sourceGroupId,
      amount: payload.amount,
      description: payload.description,
    });
  });

  app.post("/api/actions/redeem", { preHandler: requireAdmin }, async (request) => {
    const payload = redeemSchema.parse(request.body);
    return services.shopService.redeem({
      guildId: params.env.GUILD_ID,
      groupId: payload.groupId,
      shopItemId: payload.shopItemId,
      requestedByUserId: payload.requestedByUserId,
      requestedByUsername: payload.requestedByUsername,
      quantity: payload.quantity,
    });
  });

  return app;
}
