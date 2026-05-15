import {
  designPreviewSaveCapabilities,
  designPreviewSaveGroup,
  designPreviewSaveSettings,
  designPreviewSaveShopItem,
  designPreviewUpdateRedemptionStatus,
  getDesignPreviewBootstrap,
  getDesignPreviewRedemptions,
  getDesignPreviewSession,
  isDesignPreview,
} from "../designPreview";
import type {
  AssignmentDraft,
  AuthSession,
  BootstrapPayload,
  EconomyResetRequest,
  EconomyResetResult,
  GuildListResponse,
  ParticipantSanction,
  SanctionApplyRequest,
  GroupDraft,
  GroupSuggestionResponse,
  ReactionRewardRule,
  ReactionRewardRuleDraft,
  RoleCapability,
  Settings,
  ShopRedemption,
  ShopItemDraft,
  Submission,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

type ApiOptions = {
  method?: string;
  body?: unknown;
};

function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function normalisePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function resolveApiUrl(baseUrl: string, path: string): string {
  const normalisedBaseUrl = normaliseBaseUrl(baseUrl);
  const normalisedPath = normalisePath(path);

  if (normalisedBaseUrl.endsWith("/api") && normalisedPath === "/api") {
    return normalisedBaseUrl;
  }

  if (normalisedBaseUrl.endsWith("/api") && normalisedPath.startsWith("/api/")) {
    return `${normalisedBaseUrl}${normalisedPath.slice(4)}`;
  }

  return `${normalisedBaseUrl}${normalisedPath}`;
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(resolveApiUrl(API_BASE_URL, path), {
    method: options.method ?? "GET",
    credentials: "include",
    headers: hasBody ? { "Content-Type": "application/json" } : {},
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  beginDiscordLogin() {
    if (isDesignPreview()) {
      return;
    }
    window.location.assign(resolveApiUrl(API_BASE_URL, "/api/auth/discord"));
  },
  logout() {
    if (isDesignPreview()) {
      return Promise.resolve({ authenticated: false });
    }
    return request<{ authenticated: boolean }>("/api/auth/logout", {
      method: "POST",
    });
  },
  session() {
    if (isDesignPreview()) {
      return Promise.resolve(getDesignPreviewSession());
    }
    return request<AuthSession>("/api/auth/session");
  },
  bootstrap() {
    if (isDesignPreview()) {
      return Promise.resolve(getDesignPreviewBootstrap());
    }
    return request<BootstrapPayload>("/api/bootstrap");
  },
  listGuilds() {
    if (isDesignPreview()) {
      return Promise.resolve({ guilds: [], activeGuildId: null });
    }
    return request<GuildListResponse>("/api/guilds");
  },
  selectGuild(guildId: string) {
    if (isDesignPreview()) {
      return Promise.resolve({ activeGuildId: guildId });
    }
    return request<{ activeGuildId: string }>("/api/guilds/select", {
      method: "POST",
      body: { guildId },
    });
  },
  leaveGuild() {
    if (isDesignPreview()) {
      return Promise.resolve({ activeGuildId: null });
    }
    return request<{ activeGuildId: null }>("/api/guilds/leave", {
      method: "POST",
    });
  },
  saveSettings(payload: Settings) {
    if (isDesignPreview()) {
      return Promise.resolve(designPreviewSaveSettings(payload));
    }
    return request<Settings>("/api/settings", {
      method: "PUT",
      body: payload,
    });
  },
  saveCapabilities(payload: RoleCapability[]) {
    if (isDesignPreview()) {
      return Promise.resolve(designPreviewSaveCapabilities(payload));
    }
    return request<RoleCapability[]>("/api/capabilities", {
      method: "PUT",
      body: payload,
    });
  },
  saveGroup(payload: GroupDraft) {
    if (isDesignPreview()) {
      return Promise.resolve(
        designPreviewSaveGroup(payload),
      );
    }
    return request("/api/groups", {
      method: "POST",
      body: {
        ...payload,
        aliases: payload.aliasesText
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
    });
  },
  fetchGroupSuggestions() {
    if (isDesignPreview()) {
      return Promise.resolve<GroupSuggestionResponse>({
        totalHumanMembers: 0,
        evaluatedRoleCount: 0,
        primary: null,
        alternatives: [],
      });
    }
    return request<GroupSuggestionResponse>("/api/groups/suggestions");
  },
  applyGroupSuggestion(roleIds: string[]) {
    if (isDesignPreview()) {
      return Promise.resolve({ groups: [] });
    }
    return request<{ groups: unknown[] }>("/api/groups/apply-suggestion", {
      method: "POST",
      body: { roleIds },
    });
  },
  saveShopItem(payload: ShopItemDraft) {
    if (isDesignPreview()) {
      return Promise.resolve(designPreviewSaveShopItem(payload));
    }
    return request("/api/shop-items", {
      method: "POST",
      body: payload,
    });
  },
  saveAssignment(payload: AssignmentDraft) {
    if (isDesignPreview()) {
      return Promise.resolve(payload);
    }
    return request("/api/assignments", {
      method: "POST",
      body: payload,
    });
  },
  reviewSubmission(submissionId: string, payload: { status: "APPROVED" | "OUTSTANDING" | "REJECTED"; reviewNote?: string }) {
    if (isDesignPreview()) {
      return Promise.resolve({} as Submission);
    }
    return request<Submission>(`/api/submissions/${submissionId}/review`, {
      method: "POST",
      body: payload,
    });
  },
  listShopRedemptions() {
    if (isDesignPreview()) {
      return Promise.resolve(getDesignPreviewRedemptions());
    }
    return request<ShopRedemption[]>("/api/shop-redemptions");
  },
  updateShopRedemptionStatus(redemptionId: string, payload: { status: "FULFILLED" | "CANCELED" }) {
    if (isDesignPreview()) {
      return Promise.resolve(designPreviewUpdateRedemptionStatus(redemptionId, payload.status));
    }
    return request<ShopRedemption>(`/api/shop-redemptions/${redemptionId}/status`, {
      method: "POST",
      body: payload,
    });
  },
  createReactionRule(payload: ReactionRewardRuleDraft) {
    return request<ReactionRewardRule>("/api/reaction-rules", {
      method: "POST",
      body: {
        channelId: payload.channelId,
        botUserId: payload.botUserId,
        emoji: payload.emoji,
        currencyDelta: payload.currencyDelta,
        description: payload.description,
        enabled: payload.enabled,
      },
    });
  },
  updateReactionRule(id: string, payload: ReactionRewardRuleDraft) {
    return request<ReactionRewardRule>(`/api/reaction-rules/${id}`, {
      method: "PUT",
      body: {
        channelId: payload.channelId,
        botUserId: payload.botUserId,
        emoji: payload.emoji,
        currencyDelta: payload.currencyDelta,
        description: payload.description,
        enabled: payload.enabled,
      },
    });
  },
  deleteReactionRule(id: string) {
    return request<void>(`/api/reaction-rules/${id}`, {
      method: "DELETE",
    });
  },
  economyReset(payload: EconomyResetRequest) {
    return request<EconomyResetResult>("/api/admin/economy/reset", {
      method: "POST",
      body: payload,
    });
  },
  listSanctions() {
    return request<ParticipantSanction[]>("/api/sanctions");
  },
  applySanction(participantId: string, payload: SanctionApplyRequest) {
    return request<ParticipantSanction>(`/api/participants/${participantId}/sanctions`, {
      method: "POST",
      body: payload,
    });
  },
  revokeSanction(sanctionId: string) {
    return request<ParticipantSanction>(`/api/sanctions/${sanctionId}/revoke`, {
      method: "POST",
    });
  },
};
