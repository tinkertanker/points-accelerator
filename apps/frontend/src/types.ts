export type Settings = {
  appName: string;
  pointsName: string;
  pointsSymbol: string;
  currencyName: string;
  currencySymbol: string;
  groupPointsPerCurrencyDonation: number;
  mentorRoleIds: string[];
  passivePointsReward: number;
  passiveCurrencyReward: number;
  passiveCooldownSeconds: number;
  passiveMinimumCharacters: number;
  passiveAllowedChannelIds: string[];
  passiveDeniedChannelIds: string[];
  bettingChannelIds: string[];
  luckyDrawChannelIds: string[];
  pointsChannelIds: string[];
  shopChannelIds: string[];
  wrongChannelPenalty: number;
  commandLogChannelId: string | null;
  redemptionChannelId: string | null;
  listingChannelId: string | null;
  announcementsChannelId: string | null;
  submissionFeedChannelId: string | null;
  betWinChance: number;
  bettingCooldownSeconds: number;
};

export type RoleCapability = {
  id?: string;
  roleId: string;
  roleName: string;
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

export type Group = {
  id: string;
  displayName: string;
  slug: string;
  mentorName: string | null;
  roleId: string;
  active: boolean;
  aliases: Array<{ value: string }>;
  pointsBalance: number;
};

export type GroupSuggestion = {
  kind: "naming-family" | "size-cluster";
  label: string;
  roleIds: string[];
  roles: Array<{ id: string; name: string }>;
  coverage: number;
  exclusivity: number;
  uniformity: number;
  score: number;
};

export type GroupSuggestionResponse = {
  totalHumanMembers: number;
  evaluatedRoleCount: number;
  primary: GroupSuggestion | null;
  alternatives: GroupSuggestion[];
};

export type GroupDraft = {
  id?: string;
  displayName: string;
  slug?: string;
  mentorName: string | null;
  roleId: string;
  aliasesText: string;
  active: boolean;
};

export type ShopItem = {
  id: string;
  name: string;
  description: string;
  audience: "INDIVIDUAL" | "GROUP";
  cost: number;
  stock: number | null;
  enabled: boolean;
  fulfillmentInstructions: string | null;
  emoji: string;
  ownerUserId: string | null;
  ownerUsername: string | null;
  fulfillerRoleId: string | null;
  autoFulfil: boolean;
};

export type ShopItemDraft = Omit<ShopItem, "id"> & { id?: string };

export type RedemptionStatus = "AWAITING_APPROVAL" | "PENDING" | "FULFILLED" | "CANCELED";

export type ShopRedemption = {
  id: string;
  purchaseMode: "INDIVIDUAL" | "GROUP";
  quantity: number;
  totalCost: number;
  approvalThreshold: number | null;
  status: RedemptionStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  requestedByUserId: string;
  requestedByUsername: string | null;
  approvalMessageChannelId: string | null;
  approvalMessageId: string | null;
  shopItem: {
    id: string;
    name: string;
    audience: "INDIVIDUAL" | "GROUP";
    fulfillmentInstructions: string | null;
    emoji: string;
    ownerUserId: string | null;
    ownerUsername: string | null;
    fulfillerRoleId: string | null;
    autoFulfil: boolean;
  };
  group: {
    id: string;
    displayName: string;
  };
  requestedByParticipant: {
    id: string;
    discordUserId: string | null;
    discordUsername: string | null;
    indexId: string;
  } | null;
  approvals: Array<{
    participant: {
      id: string;
      discordUserId: string | null;
      discordUsername: string | null;
      indexId: string;
    };
  }>;
};

export type Listing = {
  id: string;
  title: string;
  description: string;
  quantity: number | null;
  createdByUsername: string | null;
  active: boolean;
  createdAt: string;
};

export type LeaderboardEntry = {
  id: string;
  displayName: string;
  pointsBalance: number;
};

export type LedgerEntry = {
  id: string;
  type: string;
  description: string;
  createdByUsername: string | null;
  createdAt: string;
  splits: Array<{
    id: string;
    group: { displayName: string };
    pointsDelta: number;
    currencyDelta: number;
  }>;
};

export type DiscordOption = {
  id: string;
  name: string;
};

export type ReactionRewardRule = {
  id: string;
  guildId: string;
  channelId: string;
  botUserId: string;
  emoji: string;
  currencyDelta: number;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReactionRewardRuleDraft = {
  id?: string;
  channelId: string;
  botUserId: string;
  emoji: string;
  currencyDelta: number;
  description: string | null;
  enabled: boolean;
};

export type DashboardAccessLevel = "viewer" | "mentor" | "admin";

export type AuthUser = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  roleIds?: string[];
  isGuildOwner?: boolean;
  hasAdministrator?: boolean;
  hasManageGuild?: boolean;
  dashboardAccessLevel?: DashboardAccessLevel;
  canManageDashboard?: boolean;
  canManageSettings?: boolean;
  canManageGroups?: boolean;
  canManageShop?: boolean;
  canManageAssignments?: boolean;
  canViewLeaderboard?: boolean;
  activeGuildId: string | null;
};

export type GuildSummary = {
  guildId: string;
  name: string;
  iconUrl: string | null;
};

export type AuthSession = {
  authenticated: boolean;
  user?: AuthUser;
  availableGuilds?: GuildSummary[];
  discordApplicationId?: string | null;
};

export type GuildListResponse = {
  guilds: GuildSummary[];
  activeGuildId: string | null;
};

export type SetupPresetKey = "classroom" | "community";

export type SetupStaffTier = {
  key: string;
  label: string;
  description: string;
  grantsMentorDashboard: boolean;
};

export type SetupPresetSummary = {
  key: SetupPresetKey;
  label: string;
  description: string;
  staffTiers: SetupStaffTier[];
};

export type SetupState = {
  isFreshInstall: boolean;
  presets: SetupPresetSummary[];
};

export type BootstrapPayload = {
  settings: Settings;
  capabilities: RoleCapability[];
  groups: Group[];
  shopItems: ShopItem[];
  redemptions?: ShopRedemption[];
  listings: Listing[];
  leaderboard: LeaderboardEntry[];
  ledger: LedgerEntry[];
  discord: {
    roles: DiscordOption[];
    channels: DiscordOption[];
    members: DiscordOption[];
  };
  assignments: Assignment[];
  participants: Participant[];
  submissions: Submission[];
  reactionRules: ReactionRewardRule[];
  setup: SetupState;
};

export type TabId =
  | "overview"
  | "settings"
  | "groups"
  | "shop"
  | "fulfilment"
  | "assignments"
  | "activity"
  | "admin"
  | "guide";

export type ParticipantLedgerEntryType =
  | "MESSAGE_REWARD"
  | "MANUAL_AWARD"
  | "MANUAL_DEDUCT"
  | "CORRECTION"
  | "TRANSFER"
  | "DONATION"
  | "SHOP_REDEMPTION"
  | "SUBMISSION_REWARD"
  | "BET_WIN"
  | "BET_LOSS"
  | "LUCKYDRAW_WIN"
  | "REACTION_REWARD";

export type GroupLedgerEntryType =
  | "MESSAGE_REWARD"
  | "MANUAL_AWARD"
  | "MANUAL_DEDUCT"
  | "CORRECTION"
  | "TRANSFER"
  | "DONATION"
  | "SHOP_REDEMPTION"
  | "ADJUSTMENT"
  | "SUBMISSION_REWARD"
  | "BET_WIN"
  | "BET_LOSS"
  | "LUCKYDRAW_WIN";

export type ResetParticipantImpact = {
  participantId: string;
  discordUserId: string;
  discordUsername: string | null;
  balanceBefore: number;
  delta: number;
  balanceAfter: number;
};

export type ResetGroupImpact = {
  groupId: string;
  displayName: string;
  pointsBefore: number;
  pointsDelta: number;
  pointsAfter: number;
  currencyBefore: number;
  currencyDelta: number;
  currencyAfter: number;
};

export type EconomyResetRequest =
  | {
      mode: "reverse-entries-since";
      since: string;
      participantTypes?: ParticipantLedgerEntryType[];
      groupTypes?: GroupLedgerEntryType[];
      note?: string;
      dryRun: boolean;
    }
  | {
      mode: "cap-balances";
      maxParticipantCurrency?: number;
      maxGroupPoints?: number;
      maxGroupCurrency?: number;
      note?: string;
      dryRun: boolean;
    }
  | {
      mode: "modulo-balance";
      modulus: number;
      applyToParticipantCurrency?: boolean;
      applyToGroupPoints?: boolean;
      applyToGroupCurrency?: boolean;
      note?: string;
      dryRun: boolean;
    }
  | {
      mode: "set-balances";
      targetParticipantCurrency?: number;
      targetGroupPoints?: number;
      targetGroupCurrency?: number;
      note?: string;
      dryRun: boolean;
    };

export type ParticipantSanctionFlag =
  | "CANNOT_BET"
  | "CANNOT_EARN_PASSIVE"
  | "CANNOT_BUY"
  | "CANNOT_TRANSFER"
  | "CANNOT_RECEIVE_REWARDS";

export type ParticipantSanction = {
  id: string;
  participantId: string;
  flag: ParticipantSanctionFlag;
  reason: string | null;
  expiresAt: string | null;
  createdByUserId: string | null;
  createdByUsername: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revokedByUsername: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SanctionApplyRequest = {
  flag: ParticipantSanctionFlag;
  reason?: string;
  expiresAt?: string | null;
};

export type EconomyResetResult =
  | {
      mode: "reverse-entries-since";
      dryRun: boolean;
      scannedParticipantEntries: number;
      scannedGroupEntries: number;
      participantImpact: ResetParticipantImpact[];
      groupImpact: ResetGroupImpact[];
      totalCurrencyDelta: number;
      totalPointsDelta: number;
      participantCorrectionEntryId: string | null;
      groupCorrectionEntryId: string | null;
    }
  | {
      mode: "cap-balances";
      dryRun: boolean;
      participantImpact: ResetParticipantImpact[];
      groupImpact: ResetGroupImpact[];
      totalCurrencyDelta: number;
      totalPointsDelta: number;
      participantCorrectionEntryId: string | null;
      groupCorrectionEntryId: string | null;
    }
  | {
      mode: "modulo-balance";
      dryRun: boolean;
      modulus: number;
      participantImpact: ResetParticipantImpact[];
      groupImpact: ResetGroupImpact[];
      totalCurrencyDelta: number;
      totalPointsDelta: number;
      participantCorrectionEntryId: string | null;
      groupCorrectionEntryId: string | null;
    }
  | {
      mode: "set-balances";
      dryRun: boolean;
      participantImpact: ResetParticipantImpact[];
      groupImpact: ResetGroupImpact[];
      totalCurrencyDelta: number;
      totalPointsDelta: number;
      participantCorrectionEntryId: string | null;
      groupCorrectionEntryId: string | null;
    };

export type Assignment = {
  id: string;
  title: string;
  description: string;
  baseCurrencyReward: number;
  basePointsReward: number;
  bonusCurrencyReward: number;
  bonusPointsReward: number;
  deadline: string | null;
  active: boolean;
  sortOrder: number;
  submissionCount: number;
};

export type AssignmentDraft = {
  id?: string;
  title: string;
  description: string;
  baseCurrencyReward: number;
  basePointsReward: number;
  bonusCurrencyReward: number;
  bonusPointsReward: number;
  deadline: string | null;
  active: boolean;
  sortOrder: number;
};

export type Participant = {
  id: string;
  discordUserId: string;
  discordUsername: string | null;
  indexId: string;
  groupId: string;
  currencyBalance: number;
  group: {
    id: string;
    displayName: string;
    slug: string;
  };
  createdAt: string;
};

export type Submission = {
  id: string;
  assignmentId: string;
  participantId: string;
  text: string;
  imageUrl: string | null;
  status: "PENDING" | "APPROVED" | "OUTSTANDING" | "REJECTED";
  reviewedByUsername: string | null;
  reviewNote: string | null;
  currencyAwarded: number | null;
  pointsAwarded: number | null;
  createdAt: string;
  assignment: {
    id: string;
    title: string;
  };
  participant: {
    id: string;
    indexId: string;
    discordUserId: string;
    discordUsername: string | null;
    group: {
      id: string;
      displayName: string;
    };
  };
};
