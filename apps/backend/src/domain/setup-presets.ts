// Sensible starter values for a new guild. Each preset is a partial
// GuildConfig plus a set of named staff tiers. The wizard asks the admin
// which Discord role plays each tier; applying then writes the capability
// row and (for tiers flagged grantsMentorDashboard) appends the role to
// GuildConfig.mentorRoleIds so it gains the mentor dashboard tabs.

import type { GuildConfigUpdateInput } from "../services/config-service.js";

export type SetupPresetKey = "classroom" | "community";

export type StaffTierKey = "admin" | "mentor" | "alumni" | "moderator";

export type StaffTierCapability = {
  canManageDashboard: boolean;
  canAward: boolean;
  maxAward: number | null;
  actionCooldownSeconds: number | null;
  canDeduct: boolean;
  canMultiAward: boolean;
  canSell: boolean;
  canReceiveAwards: boolean;
  isGroupRole: boolean;
  riggedBetWinChance: number | null;
};

export type StaffTierTemplate = {
  key: StaffTierKey;
  label: string;
  description: string;
  grantsMentorDashboard: boolean;
  capability: StaffTierCapability;
};

export type SetupPreset = {
  key: SetupPresetKey;
  label: string;
  description: string;
  settings: GuildConfigUpdateInput;
  staffTiers: StaffTierTemplate[];
};

const cap = (overrides: Partial<StaffTierCapability>): StaffTierCapability => ({
  canManageDashboard: false,
  canAward: false,
  maxAward: null,
  actionCooldownSeconds: 10,
  canDeduct: false,
  canMultiAward: false,
  canSell: false,
  canReceiveAwards: true,
  isGroupRole: false,
  riggedBetWinChance: null,
  ...overrides,
});

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
    staffTiers: [
      {
        key: "admin",
        label: "Admin",
        description: "Full dashboard access; uncapped awards; rigged bet odds.",
        grantsMentorDashboard: true,
        capability: cap({
          canManageDashboard: true,
          canAward: true,
          maxAward: 10000,
          canDeduct: true,
          canMultiAward: true,
          canSell: true,
          riggedBetWinChance: 90,
        }),
      },
      {
        key: "mentor",
        label: "Mentor",
        description: "Manages shop, assignments, and submissions; medium award cap.",
        grantsMentorDashboard: true,
        capability: cap({
          canAward: true,
          maxAward: 500,
          canDeduct: true,
          canMultiAward: true,
          canSell: true,
        }),
      },
      {
        key: "alumni",
        label: "Alumni",
        description: "Tiny award cap, no deductions — just enough to hand out kudos.",
        grantsMentorDashboard: false,
        capability: cap({
          canAward: true,
          maxAward: 1,
          canMultiAward: true,
          canSell: true,
        }),
      },
    ],
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
    staffTiers: [
      {
        key: "admin",
        label: "Admin",
        description: "Full dashboard access; uncapped awards.",
        grantsMentorDashboard: true,
        capability: cap({
          canManageDashboard: true,
          canAward: true,
          maxAward: null,
          canDeduct: true,
          canMultiAward: true,
          canSell: true,
        }),
      },
      {
        key: "moderator",
        label: "Moderator",
        description: "Manages shop and assignments; capped award amounts.",
        grantsMentorDashboard: true,
        capability: cap({
          canAward: true,
          maxAward: 100,
          canDeduct: true,
          canMultiAward: true,
          canSell: true,
        }),
      },
    ],
  },
};

export function listSetupPresets(): SetupPreset[] {
  return Object.values(SETUP_PRESETS);
}
