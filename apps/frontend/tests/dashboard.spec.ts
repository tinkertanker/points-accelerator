import { expect, test } from "@playwright/test";

test("admin can sign in and see the control room", async ({ page }) => {
  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true }),
    });
  });

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        settings: {
          appName: "economy rice",
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
        discord: {
          roles: [{ id: "role-1", name: "Admin" }],
          channels: [{ id: "channel-1", name: "general" }],
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("Admin Token").fill("test-admin-token");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("heading", { name: /control room/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /class launch walkthrough/i })).toBeVisible();
  await expect(page.getByText(/dashboard synced/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /save settings/i })).toBeVisible();
  await expect(page.getByText("/ledger page:2")).toBeVisible();
});
