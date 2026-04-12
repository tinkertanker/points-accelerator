import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

function deferredResponse() {
  let resolve: (value: Response) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

const authenticatedSession = {
  authenticated: true,
  user: {
    userId: "user-1",
    username: "admin",
    displayName: "Admin",
    avatarUrl: null,
    roleIds: ["role-1"],
    isGuildOwner: false,
    hasAdministrator: false,
    hasManageGuild: true,
    dashboardAccessLevel: "admin" as const,
    canManageDashboard: true,
    canManageSettings: true,
    canManageGroups: true,
    canManageShop: true,
    canManageAssignments: true,
    canViewLeaderboard: true,
  },
};

const mentorSession = {
  authenticated: true,
  user: {
    userId: "user-2",
    username: "mentor",
    displayName: "Mentor",
    avatarUrl: null,
    roleIds: ["role-mentor"],
    isGuildOwner: false,
    hasAdministrator: false,
    hasManageGuild: false,
    dashboardAccessLevel: "mentor" as const,
    canManageDashboard: true,
    canManageSettings: false,
    canManageGroups: false,
    canManageShop: true,
    canManageAssignments: true,
    canViewLeaderboard: true,
  },
};

const viewerSession = {
  authenticated: true,
  user: {
    userId: "user-3",
    username: "viewer",
    displayName: "Viewer",
    avatarUrl: null,
    roleIds: ["role-member"],
    isGuildOwner: false,
    hasAdministrator: false,
    hasManageGuild: false,
    dashboardAccessLevel: "viewer" as const,
    canManageDashboard: false,
    canManageSettings: false,
    canManageGroups: false,
    canManageShop: false,
    canManageAssignments: false,
    canViewLeaderboard: true,
  },
};

const bootstrapPayload = {
  settings: {
    appName: "points accelerator",
    pointsName: "beans",
    currencyName: "rice",
    mentorRoleIds: ["role-mentor"],
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
  leaderboard: [
    {
      id: "group-1",
      displayName: "Alpha",
      pointsBalance: 99,
      currencyBalance: 500,
    },
  ],
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
    cleanup();
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

  it("keeps the login prompt hidden while the initial session check is still loading", async () => {
    const sessionRequest = deferredResponse();
    fetchMock.mockReturnValueOnce(sessionRequest.promise);

    render(<App />);

    expect(screen.getByText(/loading your dashboard/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in with discord/i })).not.toBeInTheDocument();

    sessionRequest.resolve(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(await screen.findByRole("button", { name: /sign in with discord/i })).toBeInTheDocument();
  });

  it("shows admin tabs and swaps panels for an authenticated admin", async () => {
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

  it("shows only mentor tabs for an authenticated mentor", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mentorSession), {
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

    expect(await screen.findByRole("tab", { name: /shop/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /assignments/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /leaderboard/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /groups/i })).not.toBeInTheDocument();
  });

  it("shows only the leaderboard tab for a guild viewer", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(viewerSession), {
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

    expect(await screen.findByRole("tab", { name: /leaderboard/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /shop/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /settings/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /view the leaderboard/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /points/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /currency/i })).not.toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.queryByText("500")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /ledger/i })).not.toBeInTheDocument();
  });
});
