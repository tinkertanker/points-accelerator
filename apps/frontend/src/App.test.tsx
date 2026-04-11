import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

const authenticatedSession = {
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
};

const bootstrapPayload = {
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
    economyMode: "SIMPLE" as const,
  },
  capabilities: [],
  groups: [],
  shopItems: [],
  listings: [],
  leaderboard: [],
  ledger: [],
  assignments: [],
  participants: [],
  submissions: [],
  discord: {
    roles: [{ id: "role-1", name: "Admin" }],
    channels: [{ id: "channel-1", name: "general" }],
  },
};

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("shows the Discord sign-in prompt when there is no active session", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(/group rewards, transfers, shop pricing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with discord/i })).toBeInTheDocument();
  });

  it("shows dashboard tabs and swaps panels for an authenticated manager", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authenticatedSession), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(bootstrapPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    render(<App />);

    expect(await screen.findByRole("tab", { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /class launch checklist/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /settings/i }));

    expect(await screen.findByRole("button", { name: /save settings/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /class launch checklist/i })).not.toBeInTheDocument();
  });
});
