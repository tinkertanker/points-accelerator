export type Settings = {
  appName: string;
  pointsName: string;
  currencyName: string;
  passivePointsReward: number;
  passiveCurrencyReward: number;
  passiveCooldownSeconds: number;
  passiveMinimumCharacters: number;
  passiveAllowedChannelIds: string[];
  passiveDeniedChannelIds: string[];
  commandLogChannelId: string | null;
  redemptionChannelId: string | null;
  listingChannelId: string | null;
  economyMode: "SIMPLE" | "ADVANCED";
};

export type RoleCapability = {
  id?: string;
  roleId: string;
  roleName: string;
  canManageDashboard: boolean;
  canAward: boolean;
  maxAward: number | null;
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
  currencyBalance: number;
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
  currencyCost: number;
  stock: number | null;
  enabled: boolean;
  fulfillmentInstructions: string | null;
};

export type ShopItemDraft = Omit<ShopItem, "id"> & { id?: string };

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
  currencyBalance: number;
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

export type AuthUser = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  roleIds: string[];
  isGuildOwner: boolean;
  hasAdministrator: boolean;
  hasManageGuild: boolean;
  canManageDashboard: boolean;
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
  listings: Listing[];
  leaderboard: LeaderboardEntry[];
  ledger: LedgerEntry[];
  discord: {
    roles: DiscordOption[];
    channels: DiscordOption[];
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
  | "assignments"
  | "activity";

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
