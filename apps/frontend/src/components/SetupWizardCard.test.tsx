import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SetupWizardCard from "./SetupWizardCard";
import { api } from "../services/api";

vi.mock("../services/api", () => ({
  api: {
    fetchGroupSuggestions: vi.fn(),
    applySetupPreset: vi.fn(),
    applyGroupSuggestion: vi.fn(),
  },
}));

const fetchGroupSuggestionsMock = vi.mocked(api.fetchGroupSuggestions);

describe("SetupWizardCard", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("stops showing the roster inspection loader when suggestions fail", async () => {
    fetchGroupSuggestionsMock.mockRejectedValueOnce(new Error("Discord unavailable"));

    render(
      <SetupWizardCard
        guildId="guild-test"
        presets={[]}
        discordRoles={[]}
        onApplied={async () => {}}
      />,
    );

    expect(screen.getByText("Inspecting guild roster…")).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByText(/Could not inspect the Discord roster/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Inspecting guild roster…")).not.toBeInTheDocument();
  });

  it("shows a roster inspection warning returned by the suggestions API", async () => {
    fetchGroupSuggestionsMock.mockResolvedValueOnce({
      totalHumanMembers: 0,
      evaluatedRoleCount: 0,
      primary: null,
      alternatives: [],
      inspectionWarning: "Could not inspect the Discord roster. Try again later or set group roles manually.",
    });

    render(
      <SetupWizardCard
        guildId="guild-test"
        presets={[]}
        discordRoles={[]}
        onApplied={async () => {}}
      />,
    );

    expect(await screen.findByText(/Try again later/i)).toBeInTheDocument();
    expect(screen.queryByText(/No clean role partition detected/i)).not.toBeInTheDocument();
  });
});
