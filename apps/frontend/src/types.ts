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
};

