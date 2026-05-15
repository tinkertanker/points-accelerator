// Sensible starter values for a new guild. Each preset is a partial
// GuildConfig: applying it only touches the fields it mentions, so anything
// the admin has already customised stays put.

import type { GuildConfigUpdateInput } from "../services/config-service.js";

export type SetupPresetKey = "classroom" | "community";

export type SetupPreset = {
  key: SetupPresetKey;
  label: string;
  description: string;
  settings: GuildConfigUpdateInput;
};

export const SETUP_PRESETS: Record<SetupPresetKey, SetupPreset> = {
  classroom: {
    key: "classroom",
    label: "Classroom",
    description:
      "Tuned for class communities (Swift Accelerator-style): 2 currency per message, anti-spam minimum length, wrong-channel penalty, slight house edge on betting.",
    settings: {
      passivePointsReward: 0,
      passiveCurrencyReward: 2,
      passiveCooldownSeconds: 20,
      passiveMinimumCharacters: 8,
      wrongChannelPenalty: 3,
      betWinChance: 51,
      bettingCooldownSeconds: 20,
      groupPointsPerCurrencyDonation: 10,
    },
  },
  community: {
    key: "community",
    label: "Community",
    description:
      "Lighter rules for general communities: 1 currency per message, no penalties, fair 50/50 bets, no cooldown between bets.",
    settings: {
      passivePointsReward: 0,
      passiveCurrencyReward: 1,
      passiveCooldownSeconds: 60,
      passiveMinimumCharacters: 4,
      wrongChannelPenalty: 0,
      betWinChance: 50,
      bettingCooldownSeconds: 0,
      groupPointsPerCurrencyDonation: 10,
    },
  },
};

export function listSetupPresets(): SetupPreset[] {
  return Object.values(SETUP_PRESETS);
}
