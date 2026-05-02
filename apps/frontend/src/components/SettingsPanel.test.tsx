import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SettingsPanel from "./SettingsPanel";
import type { Settings } from "../types";

const baseSettings: Settings = {
  appName: "points accelerator",
  pointsName: "points",
  pointsSymbol: "pts",
  currencyName: "credits",
  currencySymbol: "cr",
  groupPointsPerCurrencyDonation: 10,
  mentorRoleIds: [],
  passivePointsReward: 1,
  passiveCurrencyReward: 1,
  passiveCooldownSeconds: 60,
  passiveMinimumCharacters: 4,
  passiveAllowedChannelIds: [],
  passiveDeniedChannelIds: [],
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
};

function renderSettingsPanel(overrides?: Partial<Settings>) {
  const onSettingsChange = vi.fn();

  render(
    <SettingsPanel
      settingsDraft={{ ...baseSettings, ...overrides }}
      roleDrafts={[]}
      reactionRules={[]}
      discordRoles={[]}
      discordChannels={[
        { id: "channel-alpha", name: "alpha-chat" },
        { id: "channel-general", name: "general" },
        { id: "channel-random", name: "random" },
      ]}
      isBusy={false}
      onSettingsChange={onSettingsChange}
      onRoleDraftsChange={vi.fn()}
      onSaveSettings={vi.fn(async () => undefined)}
      onSaveRoles={vi.fn(async () => undefined)}
      onCreateReactionRule={vi.fn(async () => true)}
      onUpdateReactionRule={vi.fn(async () => true)}
      onDeleteReactionRule={vi.fn(async () => true)}
    />,
  );

  return { onSettingsChange };
}

describe("SettingsPanel passive channel picker", () => {
  afterEach(() => {
    cleanup();
  });

  it("adds a passive allowed channel by channel name while storing its ID", () => {
    const { onSettingsChange } = renderSettingsPanel();

    fireEvent.change(screen.getByLabelText("Allowed passive channels"), {
      target: { value: "gen" },
    });

    fireEvent.click(screen.getByRole("button", { name: /#general channel-general/i }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        passiveAllowedChannelIds: ["channel-general"],
      }),
    );
  });

  it("shows the empty-list meaning for allowed and denied passive channels", () => {
    renderSettingsPanel();

    expect(screen.getByText("All channels are currently allowed.")).toBeInTheDocument();
    expect(screen.getByText("No channels are currently denied.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Leave this empty to allow passive rewards in every channel. Add channels here only if you want a strict allow-list.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Leave this empty to deny none. Denied channels always block passive rewards, even if they also appear in the allowed list.",
      ),
    ).toBeInTheDocument();
  });
});
