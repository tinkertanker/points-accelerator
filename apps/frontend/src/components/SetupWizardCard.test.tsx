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
});
