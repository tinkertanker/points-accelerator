import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscordOAuthClient } from "../src/auth/discord-oauth.js";
import type { BotRuntimeApi } from "../src/bot/runtime.js";
import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

const dashboardMember = {
  userId: "discord-user-1",
  username: "mentor",
  displayName: "Mentor One",
  avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
  roleIds: ["role-admin"],
  isGuildOwner: false,
  hasAdministrator: false,
  hasManageGuild: false,
};

const botRuntime: BotRuntimeApi = {
  getRoles: vi.fn().mockResolvedValue([]),
  getTextChannels: vi.fn().mockResolvedValue([]),
  getDashboardMember: vi.fn(async (userId: string) => (userId === dashboardMember.userId ? dashboardMember : null)),
  postListing: vi.fn().mockResolvedValue(null),
};

const discordOAuthClient: DiscordOAuthClient = {
  buildAuthorizeUrl: vi.fn(({ state, redirectUri }) => `https://discord.com/oauth2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`),
  exchangeCode: vi.fn().mockResolvedValue({
    id: dashboardMember.userId,
    username: dashboardMember.username,
    globalName: dashboardMember.displayName,
    avatarUrl: dashboardMember.avatarUrl,
  }),
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

async function startDashboardSession() {
  await seedDashboardCapability();

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

  it("creates a dashboard session from a Discord OAuth callback for a role with dashboard access", async () => {
    await seedDashboardCapability();

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
        userId: dashboardMember.userId,
        username: dashboardMember.username,
        displayName: dashboardMember.displayName,
        canManageDashboard: true,
      },
    });
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
        userId: dashboardMember.userId,
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
        userId: dashboardMember.userId,
      },
    });
  });
});
