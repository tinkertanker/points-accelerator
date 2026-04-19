import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscordOAuthClient } from "../src/auth/discord-oauth.js";
import type { BotRuntimeApi } from "../src/bot/runtime.js";
import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

const defaultDashboardMember = {
  userId: "discord-user-1",
  username: "admin",
  displayName: "Admin One",
  avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
  roleIds: ["role-admin"],
  isGuildOwner: false,
  hasAdministrator: false,
  hasManageGuild: false,
};

let currentDashboardMember = { ...defaultDashboardMember };

const botRuntime: BotRuntimeApi = {
  getRoles: vi.fn().mockResolvedValue([]),
  getTextChannels: vi.fn().mockResolvedValue([]),
  getMembers: vi.fn().mockResolvedValue([]),
  getDashboardMember: vi.fn(async (userId: string) => (userId === currentDashboardMember.userId ? currentDashboardMember : null)),
  getGroupMemberCount: vi.fn().mockResolvedValue(null),
  getGroupMemberDiscordUserIds: vi.fn().mockResolvedValue(null),
  postListing: vi.fn().mockResolvedValue(null),
  clearRedemptionButtons: vi.fn().mockResolvedValue(undefined),
};

const discordOAuthClient: DiscordOAuthClient = {
  buildAuthorizeUrl: vi.fn(({ state, redirectUri }) => `https://discord.com/oauth2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`),
  exchangeCode: vi.fn(async () => ({
    id: currentDashboardMember.userId,
    username: currentDashboardMember.username,
    globalName: currentDashboardMember.displayName,
    avatarUrl: currentDashboardMember.avatarUrl,
  })),
};

function extractCookie(headers: string[] | undefined, name: string) {
  const header = headers?.find((value) => value.startsWith(`${name}=`));
  return header?.split(";")[0];
}

async function seedDashboardCapability() {
  await ctx.app.inject({
    method: "PUT",
    url: "/api/capabilities",
    headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    payload: [
      {
        roleId: "role-admin",
        roleName: "Admin",
        canManageDashboard: true,
        canAward: true,
        maxAward: 100,
        canDeduct: true,
        canMultiAward: true,
        canSell: true,
        canReceiveAwards: true,
        isGroupRole: false,
      },
    ],
  });
}

async function seedSettings(overrides: Partial<{ mentorRoleIds: string[] }> = {}) {
  await ctx.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
    payload: {
      appName: "points accelerator",
      pointsName: "points",
      pointsSymbol: "🏅",
      currencyName: "rice",
      currencySymbol: "💲",
      groupPointsPerCurrencyDonation: 10,
      mentorRoleIds: overrides.mentorRoleIds ?? [],
      passivePointsReward: 1,
      passiveCurrencyReward: 1,
      passiveCooldownSeconds: 60,
      passiveMinimumCharacters: 4,
      passiveAllowedChannelIds: [],
      passiveDeniedChannelIds: [],
      commandLogChannelId: null,
      redemptionChannelId: null,
      listingChannelId: null,
      announcementsChannelId: null,
      betWinChance: 50,
      bettingCooldownSeconds: 0,
    },
  });
}

async function startDashboardSession(options?: { seedAdminCapability?: boolean; mentorRoleIds?: string[] }) {
  if (options?.seedAdminCapability ?? true) {
    await seedDashboardCapability();
  }

  await seedSettings({ mentorRoleIds: options?.mentorRoleIds });

  const startResponse = await ctx.app.inject({
    method: "GET",
    url: "/api/auth/discord",
  });
  const oauthStateCookie = extractCookie(startResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`), "discord_oauth_state");
  const state = oauthStateCookie?.split("=")[1];

  const callbackResponse = await ctx.app.inject({
    method: "GET",
    url: `/api/auth/discord/callback?code=test-code&state=${state}`,
    headers: {
      cookie: oauthStateCookie ?? "",
    },
  });

  return extractCookie(callbackResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`), "dashboard_session");
}

describe("Discord dashboard auth", () => {
  beforeAll(async () => {
    const managed = ensureTestDatabase();
    cleanupDatabase = managed.cleanup;
    ctx = await createTestApp(managed.url, {
      botRuntime,
      discordOAuthClient,
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase(ctx.prisma);
    currentDashboardMember = { ...defaultDashboardMember };
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.app.close();
      await ctx.prisma.$disconnect();
    }
    cleanupDatabase();
  });

  it("reports an unauthenticated session when no dashboard session cookie exists", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/session",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
  });

  it("creates an admin dashboard session for a role with dashboard access", async () => {
    await seedDashboardCapability();
    await seedSettings();

    const startResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/discord",
    });

    const oauthStateCookie = extractCookie(startResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`), "discord_oauth_state");
    expect(startResponse.statusCode).toBe(302);
    expect(oauthStateCookie).toMatch(/^discord_oauth_state=/);

    const state = oauthStateCookie?.split("=")[1];
    const callbackResponse = await ctx.app.inject({
      method: "GET",
      url: `/api/auth/discord/callback?code=test-code&state=${state}`,
      headers: {
        cookie: oauthStateCookie ?? "",
      },
    });

    const sessionCookie = extractCookie(callbackResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`), "dashboard_session");
    expect(callbackResponse.statusCode).toBe(302);
    expect(sessionCookie).toMatch(/^dashboard_session=/);

    const sessionResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toMatchObject({
      authenticated: true,
      user: {
        userId: currentDashboardMember.userId,
        username: currentDashboardMember.username,
        displayName: currentDashboardMember.displayName,
        dashboardAccessLevel: "admin",
        canManageDashboard: true,
        canManageSettings: true,
        canManageGroups: true,
        canManageShop: true,
        canManageAssignments: true,
        canViewLeaderboard: true,
      },
    });
  });

  it("creates a viewer dashboard session for a guild member without extra roles", async () => {
    currentDashboardMember = {
      ...defaultDashboardMember,
      roleIds: ["role-member"],
      username: "viewer",
      displayName: "Viewer One",
    };

    const sessionCookie = await startDashboardSession({ seedAdminCapability: false });
    expect(sessionCookie).toMatch(/^dashboard_session=/);

    const sessionResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toMatchObject({
      authenticated: true,
      user: {
        dashboardAccessLevel: "viewer",
        canManageDashboard: false,
        canManageSettings: false,
        canManageGroups: false,
        canManageShop: false,
        canManageAssignments: false,
        canViewLeaderboard: true,
      },
    });
  });

  it("creates a mentor dashboard session for a role listed in settings", async () => {
    currentDashboardMember = {
      ...defaultDashboardMember,
      roleIds: ["role-mentor"],
      username: "mentor",
      displayName: "Mentor One",
    };

    const sessionCookie = await startDashboardSession({
      seedAdminCapability: false,
      mentorRoleIds: ["role-mentor"],
    });
    expect(sessionCookie).toMatch(/^dashboard_session=/);

    const sessionResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toMatchObject({
      authenticated: true,
      user: {
        dashboardAccessLevel: "mentor",
        canManageDashboard: true,
        canManageSettings: false,
        canManageGroups: false,
        canManageShop: true,
        canManageAssignments: true,
        canViewLeaderboard: true,
      },
    });
  });

  it("limits a viewer to leaderboard access", async () => {
    currentDashboardMember = {
      ...defaultDashboardMember,
      roleIds: ["role-member"],
      username: "viewer",
      displayName: "Viewer One",
    };

    await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { "x-admin-token": ctx.env.ADMIN_TOKEN },
      payload: {
        displayName: "Team Alpha",
        slug: "team-alpha",
        mentorName: null,
        roleId: "role-alpha",
        aliases: [],
        active: true,
      },
    });

    const viewerCookie = await startDashboardSession({ seedAdminCapability: false });
    expect(viewerCookie).toMatch(/^dashboard_session=/);

    const bootstrapResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: {
        cookie: viewerCookie ?? "",
      },
    });

    expect(bootstrapResponse.statusCode).toBe(200);
    expect(bootstrapResponse.json()).toMatchObject({
      groups: [],
      shopItems: [],
      assignments: [],
      leaderboard: [expect.objectContaining({ displayName: "Team Alpha" })],
      ledger: [],
    });

    const leaderboardResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/leaderboard",
      headers: {
        cookie: viewerCookie ?? "",
      },
    });
    expect(leaderboardResponse.statusCode).toBe(200);

    const settingsResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/settings",
      headers: {
        cookie: viewerCookie ?? "",
      },
    });
    expect(settingsResponse.statusCode).toBe(403);
  });

  it("lets mentors manage shop and assignments without exposing admin pages", async () => {
    currentDashboardMember = {
      ...defaultDashboardMember,
      roleIds: ["role-mentor"],
      username: "mentor",
      displayName: "Mentor One",
    };

    const mentorCookie = await startDashboardSession({
      seedAdminCapability: false,
      mentorRoleIds: ["role-mentor"],
    });
    expect(mentorCookie).toMatch(/^dashboard_session=/);

    const shopResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/shop-items",
      headers: {
        cookie: mentorCookie ?? "",
      },
      payload: {
        name: "Sticker pack",
        description: "Reward stickers",
        audience: "INDIVIDUAL",
        cost: 10,
        stock: 5,
        enabled: true,
        fulfillmentInstructions: null,
      },
    });
    expect(shopResponse.statusCode).toBe(200);

    const assignmentResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/assignments",
      headers: {
        cookie: mentorCookie ?? "",
      },
      payload: {
        title: "Reflection 1",
        description: "Write a short reflection.",
        baseCurrencyReward: 5,
        basePointsReward: 5,
        bonusCurrencyReward: 2,
        bonusPointsReward: 2,
        deadline: null,
        active: true,
        sortOrder: 0,
      },
    });
    expect(assignmentResponse.statusCode).toBe(200);

    const bootstrapResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: {
        cookie: mentorCookie ?? "",
      },
    });

    expect(bootstrapResponse.statusCode).toBe(200);
    expect(bootstrapResponse.json()).toMatchObject({
      groups: [],
      capabilities: [],
      shopItems: [expect.objectContaining({ name: "Sticker pack" })],
      assignments: [expect.objectContaining({ title: "Reflection 1" })],
      ledger: [],
    });

    const settingsResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/settings",
      headers: {
        cookie: mentorCookie ?? "",
      },
    });
    expect(settingsResponse.statusCode).toBe(403);

    const groupsResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/groups",
      headers: {
        cookie: mentorCookie ?? "",
      },
    });
    expect(groupsResponse.statusCode).toBe(403);
  });

  it("does not mark auth cookies as Secure when the public app URL is plain HTTP", async () => {
    const startResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/discord",
    });

    const setCookieHeader = startResponse.headers["set-cookie"];
    const headerValue = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader ?? "";

    expect(startResponse.statusCode).toBe(302);
    expect(headerValue).not.toContain("Secure");
  });

  it("clears an existing dashboard session when a Discord account switch is rejected", async () => {
    const sessionCookie = await startDashboardSession();
    expect(sessionCookie).toMatch(/^dashboard_session=/);

    vi.mocked(discordOAuthClient.exchangeCode).mockResolvedValueOnce({
      id: "discord-user-2",
      username: "outsider",
      globalName: "Outsider",
      avatarUrl: null,
    });
    vi.mocked(botRuntime.getDashboardMember).mockImplementationOnce(async () => null);

    const startResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/discord",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });
    const oauthStateCookie = extractCookie(startResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`), "discord_oauth_state");
    const state = oauthStateCookie?.split("=")[1];

    const callbackResponse = await ctx.app.inject({
      method: "GET",
      url: `/api/auth/discord/callback?code=other-user&state=${state}`,
      headers: {
        cookie: [sessionCookie, oauthStateCookie].filter(Boolean).join("; "),
      },
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toContain("auth_error=");

    const sessionResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toEqual({ authenticated: false });
  });

  it("keeps the previous dashboard session when an OAuth account switch hits a transient Discord lookup error", async () => {
    const sessionCookie = await startDashboardSession();
    expect(sessionCookie).toMatch(/^dashboard_session=/);

    vi.mocked(discordOAuthClient.exchangeCode).mockResolvedValueOnce({
      id: "discord-user-2",
      username: "outsider",
      globalName: "Outsider",
      avatarUrl: null,
    });
    vi.mocked(botRuntime.getDashboardMember).mockImplementationOnce(async () => {
      throw new Error("discord outage");
    });

    const startResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/discord",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });
    const oauthStateCookie = extractCookie(startResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`), "discord_oauth_state");
    const state = oauthStateCookie?.split("=")[1];

    const callbackResponse = await ctx.app.inject({
      method: "GET",
      url: `/api/auth/discord/callback?code=other-user&state=${state}`,
      headers: {
        cookie: [sessionCookie, oauthStateCookie].filter(Boolean).join("; "),
      },
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toContain("auth_error=");

    const sessionResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toMatchObject({
      authenticated: true,
      user: {
        userId: currentDashboardMember.userId,
      },
    });
  });

  it("preserves a valid session when session resolution fails with a backend error", async () => {
    const sessionCookie = await startDashboardSession();
    expect(sessionCookie).toMatch(/^dashboard_session=/);

    vi.mocked(botRuntime.getDashboardMember).mockImplementationOnce(async () => {
      throw new Error("discord outage");
    });

    const failedSessionResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });

    expect(failedSessionResponse.statusCode).toBe(500);
    expect(failedSessionResponse.json()).toEqual({ message: "Internal server error" });

    const recoveredSessionResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: sessionCookie ?? "",
      },
    });

    expect(recoveredSessionResponse.statusCode).toBe(200);
    expect(recoveredSessionResponse.json()).toMatchObject({
      authenticated: true,
      user: {
        userId: currentDashboardMember.userId,
      },
    });
  });
});
