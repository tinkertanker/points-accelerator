import { expect, test } from "@playwright/test";

test("authenticated Discord manager can see the control room", async ({ page }) => {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: {
          userId: "user-1",
          username: "mentor",
          displayName: "Mentor",
          avatarUrl: null,
          roleIds: ["role-1"],
          isGuildOwner: false,
          hasAdministrator: false,
          hasManageGuild: true,
          canManageDashboard: true,
        },
      }),
    });
  });

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        settings: {
          appName: "points accelerator",
          pointsName: "beans",
          currencyName: "rice",
          passivePointsReward: 1,
          passiveCurrencyReward: 1,
          passiveCooldownSeconds: 60,
          passiveMinimumCharacters: 4,
          passiveAllowedChannelIds: [],
          passiveDeniedChannelIds: [],
          commandLogChannelId: null,
          redemptionChannelId: null,
          listingChannelId: null,
          economyMode: "SIMPLE",
        },
        capabilities: [],
        groups: [],
        shopItems: [],
        listings: [],
        leaderboard: [],
        ledger: [],
        publicLeaderboardUrl: "https://points-accelerator.example/l/share-token",
        assignments: [],
        participants: [],
        submissions: [],
        discord: {
          roles: [{ id: "role-1", name: "Admin" }],
          channels: [{ id: "channel-1", name: "general" }],
        },
      }),
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /points accelerator/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /overview/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /class launch checklist/i })).toBeVisible();
  await expect(page.getByText(/dashboard synced/i)).toBeVisible();
  await expect(page.getByText("/ledger page:2")).toBeVisible();

  await page.getByRole("tab", { name: /settings/i }).click();
  await expect(page.getByRole("button", { name: /save settings/i })).toBeVisible();

  await page.getByRole("tab", { name: /activity/i }).click();
  await expect(page.getByRole("heading", { name: /track the leaderboard and ledger/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /public leaderboard link/i })).toHaveValue(
    "https://points-accelerator.example/l/share-token",
  );
});
