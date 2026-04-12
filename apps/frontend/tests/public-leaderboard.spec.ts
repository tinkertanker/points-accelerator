import { expect, test } from "@playwright/test";

test("public leaderboard route shows the shared points standings", async ({ page }) => {
  await page.route("**/api/public/leaderboard/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        appName: "points accelerator",
        pointsName: "beans",
        leaderboard: [
          {
            id: "group-1",
            displayName: "Team Alpha",
            pointsBalance: 128,
          },
          {
            id: "group-2",
            displayName: "Team Beta",
            pointsBalance: 96,
          },
        ],
      }),
    });
  });

  const response = await page.goto("/l/share-token");

  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.getByRole("heading", { name: /points accelerator leaderboard/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /current standings/i })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toContainText("1");
  await expect(page.locator("tbody tr").first()).toContainText("Team Alpha");
  await expect(page.locator("tbody tr").first()).toContainText("128 beans");
});
