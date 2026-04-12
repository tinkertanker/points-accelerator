import type {
  AuthSession,
  BootstrapPayload,
  Group,
  GroupDraft,
  RoleCapability,
  Settings,
  ShopItem,
  ShopItemDraft,
} from "./types";

export function isDesignPreview(): boolean {
  return import.meta.env.VITE_DESIGN_PREVIEW === "true";
}

function createInitialBootstrap(): BootstrapPayload {
  return {
    settings: {
      appName: "points accelerator",
      pointsName: "beans",
      currencyName: "rice",
      mentorRoleIds: ["role-staff"],
      passivePointsReward: 1,
      passiveCurrencyReward: 1,
      passiveCooldownSeconds: 60,
      passiveMinimumCharacters: 4,
      passiveAllowedChannelIds: [],
      passiveDeniedChannelIds: [],
      commandLogChannelId: "ch-log",
      redemptionChannelId: "ch-redeem",
      listingChannelId: "ch-listings",
      economyMode: "SIMPLE",
    },
    capabilities: [
      {
        id: "cap-1",
        roleId: "role-staff",
        roleName: "Staff",
        canManageDashboard: true,
        canAward: true,
        maxAward: 50,
        canDeduct: true,
        canMultiAward: false,
        canSell: true,
        canReceiveAwards: false,
        isGroupRole: false,
      },
      {
        id: "cap-2",
        roleId: "role-alpha",
        roleName: "Team Alpha",
        canManageDashboard: false,
        canAward: false,
        maxAward: null,
        canDeduct: false,
        canMultiAward: false,
        canSell: false,
        canReceiveAwards: true,
        isGroupRole: true,
      },
    ],
    groups: [
      {
        id: "group-1",
        displayName: "Team Alpha",
        slug: "team-alpha",
        mentorName: "Jordan",
        roleId: "role-alpha",
        active: true,
        aliases: [{ value: "alpha" }],
        pointsBalance: 128,
        currencyBalance: 24,
      },
      {
        id: "group-2",
        displayName: "Team Beta",
        slug: "team-beta",
        mentorName: "Sam",
        roleId: "role-beta",
        active: true,
        aliases: [],
        pointsBalance: 96,
        currencyBalance: 18,
      },
    ],
    shopItems: [
      {
        id: "shop-1",
        name: "Sticker pack",
        description: "Class merit stickers (digital)",
        currencyCost: 15,
        stock: 40,
        enabled: true,
        fulfillmentInstructions: "DM the bot with your email.",
      },
    ],
    listings: [
      {
        id: "list-1",
        title: "Spare graphing calculator",
        description: "TI-84, good condition. Pickup at lab.",
        quantity: 1,
        createdByUsername: "mentor",
        active: true,
        createdAt: new Date().toISOString(),
      },
    ],
    leaderboard: [
      { id: "group-1", displayName: "Team Alpha", pointsBalance: 128, currencyBalance: 24 },
      { id: "group-2", displayName: "Team Beta", pointsBalance: 96, currencyBalance: 18 },
    ],
    ledger: [
      {
        id: "ledger-1",
        type: "AWARD",
        description: "Helped another group during review",
        createdByUsername: "staff",
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        splits: [
          {
            id: "split-1",
            group: { displayName: "Team Alpha" },
            pointsDelta: 5,
            currencyDelta: 0,
          },
        ],
      },
      {
        id: "ledger-2",
        type: "PASSIVE",
        description: "Chat participation",
        createdByUsername: null,
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        splits: [
          {
            id: "split-2",
            group: { displayName: "Team Beta" },
            pointsDelta: 1,
            currencyDelta: 1,
          },
        ],
      },
    ],
    discord: {
      roles: [
        { id: "role-staff", name: "Staff" },
        { id: "role-alpha", name: "Team Alpha" },
        { id: "role-beta", name: "Team Beta" },
      ],
      channels: [
        { id: "ch-general", name: "general" },
        { id: "ch-log", name: "economy-log" },
        { id: "ch-redeem", name: "redemptions" },
        { id: "ch-listings", name: "listings" },
      ],
    },
    assignments: [
      {
        id: "assign-1",
        title: "Week 1 Reflection",
        description: "Write a short reflection on what you learnt this week.",
        baseCurrencyReward: 5,
        basePointsReward: 5,
        bonusCurrencyReward: 3,
        bonusPointsReward: 3,
        deadline: null,
        active: true,
        sortOrder: 0,
        submissionCount: 1,
      },
    ],
    participants: [
      {
        id: "participant-1",
        discordUserId: "user-1",
        discordUsername: "alice",
        indexId: "S001",
        groupId: "group-1",
        group: { id: "group-1", displayName: "Team Alpha", slug: "team-alpha" },
        createdAt: new Date().toISOString(),
      },
    ],
    submissions: [
      {
        id: "sub-1",
        assignmentId: "assign-1",
        participantId: "participant-1",
        text: "This week I learnt about teamwork and collaboration.",
        imageUrl: null,
        status: "PENDING",
        reviewedByUsername: null,
        reviewNote: null,
        currencyAwarded: null,
        pointsAwarded: null,
        createdAt: new Date().toISOString(),
        assignment: { id: "assign-1", title: "Week 1 Reflection" },
        participant: {
          id: "participant-1",
          indexId: "S001",
          discordUserId: "user-1",
          discordUsername: "alice",
          group: { id: "group-1", displayName: "Team Alpha" },
        },
      },
    ],
  };
}

let mockBootstrap = createInitialBootstrap();

export function getDesignPreviewSession(): AuthSession {
  return {
    authenticated: true,
    user: {
      userId: "preview-user",
      username: "preview",
      displayName: "Design preview",
      avatarUrl: null,
      roleIds: ["role-staff"],
      isGuildOwner: false,
      hasAdministrator: false,
      hasManageGuild: true,
      dashboardAccessLevel: "admin",
      canManageDashboard: true,
      canManageSettings: true,
      canManageGroups: true,
      canManageShop: true,
      canManageAssignments: true,
      canViewLeaderboard: true,
    },
  };
}

export function getDesignPreviewBootstrap(): BootstrapPayload {
  return structuredClone(mockBootstrap);
}

export function designPreviewSaveSettings(settings: Settings): Settings {
  mockBootstrap.settings = settings;
  return settings;
}

export function designPreviewSaveCapabilities(capabilities: RoleCapability[]): RoleCapability[] {
  const next = capabilities.map((capability, index) => ({
    ...capability,
    id: capability.id ?? `cap-${index + 1}`,
  }));
  mockBootstrap.capabilities = next;
  return next;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function designPreviewSaveGroup(draft: GroupDraft): Group {
  const slug = draft.slug?.trim() ? draft.slug.trim() : slugify(draft.displayName);
  const group: Group = {
    id: draft.id ?? `group-${Date.now()}`,
    displayName: draft.displayName,
    slug,
    mentorName: draft.mentorName ?? null,
    roleId: draft.roleId,
    active: draft.active,
    aliases: draft.aliasesText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => ({ value })),
    pointsBalance: 0,
    currencyBalance: 0,
  };

  const existingIndex = mockBootstrap.groups.findIndex((candidate) => candidate.id === group.id);
  if (existingIndex >= 0) {
    const previous = mockBootstrap.groups[existingIndex];
    group.pointsBalance = previous.pointsBalance;
    group.currencyBalance = previous.currencyBalance;
    mockBootstrap.groups[existingIndex] = group;
  } else {
    mockBootstrap.groups.push(group);
  }

  mockBootstrap.leaderboard = [...mockBootstrap.groups]
    .sort((a, b) => b.pointsBalance - a.pointsBalance)
    .map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      pointsBalance: entry.pointsBalance,
      currencyBalance: entry.currencyBalance,
    }));

  return group;
}

export function designPreviewSaveShopItem(draft: ShopItemDraft): ShopItem {
  const item: ShopItem = {
    id: draft.id ?? `shop-${Date.now()}`,
    name: draft.name,
    description: draft.description,
    currencyCost: draft.currencyCost,
    stock: draft.stock,
    enabled: draft.enabled,
    fulfillmentInstructions: draft.fulfillmentInstructions ?? null,
  };

  const existingIndex = mockBootstrap.shopItems.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex >= 0) {
    mockBootstrap.shopItems[existingIndex] = item;
  } else {
    mockBootstrap.shopItems.push(item);
  }

  return item;
}
