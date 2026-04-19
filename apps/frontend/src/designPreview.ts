import type {
  AuthSession,
  BootstrapPayload,
  DashboardAccessLevel,
  Group,
  GroupDraft,
  RoleCapability,
  Settings,
  ShopRedemption,
  ShopItem,
  ShopItemDraft,
} from "./types";

export function isDesignPreview(): boolean {
  return import.meta.env.VITE_DESIGN_PREVIEW === "true";
}

const DESIGN_PREVIEW_ACCESS_KEY = "points-accelerator:design-preview-access";

function isDashboardAccessLevel(value: string | null): value is DashboardAccessLevel {
  return value === "admin" || value === "mentor" || value === "viewer";
}

export function getDesignPreviewAccessLevel(): DashboardAccessLevel {
  if (typeof window === "undefined") {
    return "admin";
  }

  const url = new URL(window.location.href);
  const queryValue = url.searchParams.get("previewAs");
  if (isDashboardAccessLevel(queryValue)) {
    window.localStorage.setItem(DESIGN_PREVIEW_ACCESS_KEY, queryValue);
    return queryValue;
  }

  const storedValue = window.localStorage.getItem(DESIGN_PREVIEW_ACCESS_KEY);
  if (isDashboardAccessLevel(storedValue)) {
    return storedValue;
  }

  return "admin";
}

export function setDesignPreviewAccessLevel(accessLevel: DashboardAccessLevel) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(DESIGN_PREVIEW_ACCESS_KEY, accessLevel);

  const url = new URL(window.location.href);
  url.searchParams.set("previewAs", accessLevel);
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function createPreviewUser(accessLevel: DashboardAccessLevel): AuthSession["user"] {
  if (accessLevel === "admin") {
    return {
      userId: "preview-admin",
      username: "preview-admin",
      displayName: "Preview admin",
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
    };
  }

  if (accessLevel === "mentor") {
    return {
      userId: "preview-mentor",
      username: "preview-mentor",
      displayName: "Preview mentor",
      avatarUrl: null,
      roleIds: ["role-staff"],
      isGuildOwner: false,
      hasAdministrator: false,
      hasManageGuild: false,
      dashboardAccessLevel: "mentor",
      canManageDashboard: true,
      canManageSettings: false,
      canManageGroups: false,
      canManageShop: true,
      canManageAssignments: true,
      canViewLeaderboard: true,
    };
  }

  return {
    userId: "preview-viewer",
    username: "preview-member",
    displayName: "Preview member",
    avatarUrl: null,
    roleIds: ["role-member"],
    isGuildOwner: false,
    hasAdministrator: false,
    hasManageGuild: false,
    dashboardAccessLevel: "viewer",
    canManageDashboard: false,
    canManageSettings: false,
    canManageGroups: false,
    canManageShop: false,
    canManageAssignments: false,
    canViewLeaderboard: true,
  };
}

function createInitialBootstrap(): BootstrapPayload {
  return {
    settings: {
      appName: "points accelerator",
      pointsName: "beans",
      pointsSymbol: "🏅",
      currencyName: "rice",
      currencySymbol: "💲",
      groupPointsPerCurrencyDonation: 10,
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
      betWinChance: 50,
      bettingCooldownSeconds: 0,
    },
    capabilities: [
      {
        id: "cap-1",
        roleId: "role-staff",
        roleName: "Staff",
        canManageDashboard: true,
        canAward: true,
        maxAward: 50,
        actionCooldownSeconds: 10,
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
        actionCooldownSeconds: null,
        canDeduct: false,
        canMultiAward: false,
        canSell: false,
        canReceiveAwards: true,
        isGroupRole: true,
      },
      {
        id: "cap-3",
        roleId: "role-beta",
        roleName: "Team Beta",
        canManageDashboard: false,
        canAward: false,
        maxAward: null,
        actionCooldownSeconds: null,
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
      },
    ],
    shopItems: [
      {
        id: "shop-1",
        name: "Sticker pack",
        description: "Class merit stickers (digital)",
        audience: "INDIVIDUAL",
        cost: 15,
        stock: 40,
        enabled: true,
        fulfillmentInstructions: "DM the bot with your email.",
      },
      {
        id: "shop-2",
        name: "Shared pizza run",
        description: "Team reward after enough approvals",
        audience: "GROUP",
        cost: 50,
        stock: 8,
        enabled: true,
        fulfillmentInstructions: "Coordinate with the staff desk.",
      },
    ],
    redemptions: [
      {
        id: "redeem-1",
        purchaseMode: "INDIVIDUAL",
        quantity: 1,
        totalCost: 15,
        approvalThreshold: null,
        status: "PENDING",
        notes: null,
        createdAt: new Date(Date.now() - 45 * 60_000).toISOString(),
        updatedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        requestedByUserId: "preview-student-1",
        requestedByUsername: "Ava",
        approvalMessageChannelId: null,
        approvalMessageId: null,
        shopItem: {
          id: "shop-1",
          name: "Sticker pack",
          audience: "INDIVIDUAL",
          fulfillmentInstructions: "DM the bot with your email.",
        },
        group: {
          id: "group-1",
          displayName: "Team Alpha",
        },
        requestedByParticipant: {
          id: "participant-1",
          discordUserId: "preview-student-1",
          discordUsername: "Ava",
          indexId: "A001",
        },
        approvals: [],
      },
      {
        id: "redeem-2",
        purchaseMode: "GROUP",
        quantity: 1,
        totalCost: 50,
        approvalThreshold: 2,
        status: "AWAITING_APPROVAL",
        notes: null,
        createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
        updatedAt: new Date(Date.now() - 75 * 60_000).toISOString(),
        requestedByUserId: "preview-student-2",
        requestedByUsername: "Mika",
        approvalMessageChannelId: "ch-redeem",
        approvalMessageId: "message-22",
        shopItem: {
          id: "shop-2",
          name: "Shared pizza run",
          audience: "GROUP",
          fulfillmentInstructions: "Coordinate with the staff desk.",
        },
        group: {
          id: "group-2",
          displayName: "Team Beta",
        },
        requestedByParticipant: {
          id: "participant-2",
          discordUserId: "preview-student-2",
          discordUsername: "Mika",
          indexId: "B004",
        },
        approvals: [
          {
            participant: {
              id: "participant-2",
              discordUserId: "preview-student-2",
              discordUsername: "Mika",
              indexId: "B004",
            },
          },
        ],
      },
      {
        id: "redeem-3",
        purchaseMode: "GROUP",
        quantity: 2,
        totalCost: 100,
        approvalThreshold: 2,
        status: "FULFILLED",
        notes: null,
        createdAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
        requestedByUserId: "preview-student-3",
        requestedByUsername: "Jordan",
        approvalMessageChannelId: "ch-redeem",
        approvalMessageId: "message-23",
        shopItem: {
          id: "shop-2",
          name: "Shared pizza run",
          audience: "GROUP",
          fulfillmentInstructions: "Coordinate with the staff desk.",
        },
        group: {
          id: "group-1",
          displayName: "Team Alpha",
        },
        requestedByParticipant: {
          id: "participant-3",
          discordUserId: "preview-student-3",
          discordUsername: "Jordan",
          indexId: "A006",
        },
        approvals: [
          {
            participant: {
              id: "participant-3",
              discordUserId: "preview-student-3",
              discordUsername: "Jordan",
              indexId: "A006",
            },
          },
          {
            participant: {
              id: "participant-4",
              discordUserId: "preview-student-4",
              discordUsername: "Noah",
              indexId: "A009",
            },
          },
        ],
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
      { id: "group-1", displayName: "Team Alpha", pointsBalance: 128 },
      { id: "group-2", displayName: "Team Beta", pointsBalance: 96 },
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
        currencyBalance: 24,
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

export function getDesignPreviewSession(accessLevel = getDesignPreviewAccessLevel()): AuthSession {
  return {
    authenticated: true,
    user: createPreviewUser(accessLevel),
  };
}

export function getDesignPreviewBootstrap(): BootstrapPayload {
  return structuredClone(mockBootstrap);
}

export function getDesignPreviewRedemptions(): ShopRedemption[] {
  return structuredClone(mockBootstrap.redemptions ?? []);
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
  syncMockGroupsFromCapabilities();
  return next;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function syncMockGroupsFromCapabilities() {
  const existingGroupsByRoleId = new Map(mockBootstrap.groups.map((group) => [group.roleId, group]));

  mockBootstrap.groups = mockBootstrap.capabilities
    .filter((capability) => capability.isGroupRole && capability.canReceiveAwards)
    .sort((left, right) => left.roleName.localeCompare(right.roleName))
    .map((capability) => {
      const existing = existingGroupsByRoleId.get(capability.roleId);
      return {
        id: existing?.id ?? `group-${capability.roleId}`,
        displayName: existing?.displayName ?? capability.roleName,
        slug: existing?.slug ?? slugify(capability.roleName),
        mentorName: existing?.mentorName ?? null,
        roleId: capability.roleId,
        active: existing?.active ?? true,
        aliases: existing?.aliases ?? [],
        pointsBalance: existing?.pointsBalance ?? 0,
      };
    });

  mockBootstrap.leaderboard = [...mockBootstrap.groups]
    .sort((a, b) => b.pointsBalance - a.pointsBalance)
    .map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      pointsBalance: entry.pointsBalance,
    }));
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
  };

  const existingIndex = mockBootstrap.groups.findIndex((candidate) => candidate.id === group.id);
  if (existingIndex >= 0) {
    const previous = mockBootstrap.groups[existingIndex];
    group.pointsBalance = previous.pointsBalance;
    mockBootstrap.groups[existingIndex] = group;
  } else {
    mockBootstrap.groups.push(group);
  }

  syncMockGroupsFromCapabilities();

  return group;
}

export function designPreviewSaveShopItem(draft: ShopItemDraft): ShopItem {
  const item: ShopItem = {
    id: draft.id ?? `shop-${Date.now()}`,
    name: draft.name,
    description: draft.description,
    audience: draft.audience,
    cost: draft.cost,
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

export function designPreviewUpdateRedemptionStatus(
  redemptionId: string,
  status: "FULFILLED" | "CANCELED",
): ShopRedemption {
  const existingIndex = (mockBootstrap.redemptions ?? []).findIndex((candidate) => candidate.id === redemptionId);
  if (existingIndex < 0) {
    throw new Error("Preview redemption not found.");
  }

  const previous = mockBootstrap.redemptions![existingIndex]!;
  const updated: ShopRedemption = {
    ...previous,
    status,
    updatedAt: new Date().toISOString(),
  };

  mockBootstrap.redemptions![existingIndex] = updated;
  return structuredClone(updated);
}
