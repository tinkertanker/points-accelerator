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
  commandLogChannelId: string | null;
  redemptionChannelId: string | null;
  listingChannelId: string | null;
  betWinChance: number;
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

export type DashboardAccessLevel = "viewer" | "mentor" | "admin";

export type AuthUser = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  roleIds: string[];
  isGuildOwner: boolean;
  hasAdministrator: boolean;
  hasManageGuild: boolean;
  dashboardAccessLevel: DashboardAccessLevel;
  canManageDashboard: boolean;
  canManageSettings: boolean;
  canManageGroups: boolean;
  canManageShop: boolean;
  canManageAssignments: boolean;
  canViewLeaderboard: boolean;
};

export type AuthSession = {
  authenticated: boolean;
  user?: AuthUser;
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
};

export type TabId =
  | "overview"
  | "settings"
  | "groups"
  | "shop"
  | "fulfilment"
  | "assignments"
  | "activity"
  | "guide";

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
