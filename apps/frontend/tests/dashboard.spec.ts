import { expect, test, type Page } from "@playwright/test";

const bootstrapPayload = {
  settings: {
    appName: "points accelerator",
    pointsName: "beans",
    pointsSymbol: "🏅",
    currencyName: "rice",
    currencySymbol: "💲",
    groupPointsPerCurrencyDonation: 10,
    mentorRoleIds: ["role-mentor"],
    passivePointsReward: 1,
    passiveCurrencyReward: 1,
    passiveCooldownSeconds: 60,
    passiveMinimumCharacters: 4,
    passiveAllowedChannelIds: [],
    passiveDeniedChannelIds: [],
    allowGrouplessEarning: true,
    bettingChannelIds: [],
    luckyDrawChannelIds: [],
    pointsChannelIds: [],
    shopChannelIds: [],
    wrongChannelPenalty: 0,
    commandLogChannelId: null,
    redemptionChannelId: null,
    listingChannelId: null,
    announcementsChannelId: null,
    submissionFeedChannelId: null,
    betWinChance: 50,
    bettingCooldownSeconds: 0,
  },
  capabilities: [],
  groups: [],
  shopItems: [],
  listings: [],
  leaderboard: [
    {
      id: "group-1",
      displayName: "Alpha",
      pointsBalance: 99,
    },
  ],
  ledger: [],
  assignments: [],
  participants: [],
  submissions: [],
  reactionRules: [],
  discord: {
    roles: [
      { id: "role-admin", name: "Admin" },
      { id: "role-mentor", name: "Mentor" },
    ],
    channels: [{ id: "channel-1", name: "general" }],
    members: [],
  },
  setup: {
    isFreshInstall: false,
    presets: [],
  },
};

async function mockDashboard(page: Page, sessionUser: object) {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: sessionUser,
      }),
    });
  });

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bootstrapPayload),
    });
  });
}

test("authenticated admin can see the full control room", async ({ page }) => {
  await mockDashboard(page, {
    userId: "user-1",
    username: "admin",
    displayName: "Admin",
    avatarUrl: null,
    roleIds: ["role-admin"],
    isGuildOwner: false,
    hasAdministrator: false,
    hasManageGuild: true,
    dashboardAccessLevel: "admin",
    canManageDashboard: true,
    canManageSettings: true,
    canManageGroups: true,
    canManageShop: true,
    canManageAssignments: true,
    canViewLeaderboard: true,
    activeGuildId: "guild-test",
  });

  await page.goto("/");

  await expect(page.getByRole("tab", { name: /overview/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /open the guide/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /settings/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /groups/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /activity/i })).toBeVisible();
});

test("authenticated mentor only sees store, assignments, and leaderboard", async ({ page }) => {
  await mockDashboard(page, {
    userId: "user-2",
    username: "mentor",
    displayName: "Mentor",
    avatarUrl: null,
    roleIds: ["role-mentor"],
    isGuildOwner: false,
    hasAdministrator: false,
    hasManageGuild: false,
    dashboardAccessLevel: "mentor",
    canManageDashboard: true,
    canManageSettings: false,
    canManageGroups: false,
    canManageShop: true,
    canManageAssignments: true,
    canViewLeaderboard: true,
    activeGuildId: "guild-test",
  });

  await page.goto("/");

  await expect(page.getByRole("tab", { name: /store/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /assignments/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /leaderboard/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /edit the store catalogue/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /settings/i })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /groups/i })).toHaveCount(0);
});

test("authenticated viewer only sees the leaderboard", async ({ page }) => {
  await mockDashboard(page, {
    userId: "user-3",
    username: "viewer",
    displayName: "Viewer",
    avatarUrl: null,
    roleIds: ["role-member"],
    isGuildOwner: false,
    hasAdministrator: false,
    hasManageGuild: false,
    dashboardAccessLevel: "viewer",
    canManageDashboard: false,
    canManageSettings: false,
    canManageGroups: false,
    canManageShop: false,
    canManageAssignments: false,
    canViewLeaderboard: true,
    activeGuildId: "guild-test",
  });

  await page.goto("/");

  await expect(page.getByRole("tab", { name: /leaderboard/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /view the leaderboard/i })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /points/i })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /currency/i })).toHaveCount(0);
  await expect(page.getByText("Alpha")).toBeVisible();
  await expect(page.getByText("99")).toBeVisible();
  await expect(page.getByText("500")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /ledger/i })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /store/i })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /settings/i })).toHaveCount(0);
});
