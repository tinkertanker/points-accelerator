import {
  designPreviewSaveCapabilities,
  designPreviewSaveGroup,
  designPreviewSaveSettings,
  designPreviewSaveShopItem,
  getDesignPreviewBootstrap,
  getDesignPreviewSession,
  isDesignPreview,
} from "../designPreview";
import type {
  AuthSession,
  BootstrapPayload,
  GroupDraft,
  RoleCapability,
  Settings,
  ShopItemDraft,
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
  const response = await fetch(resolveApiUrl(API_BASE_URL, path), {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed with status ${response.status}`);
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
  saveShopItem(payload: ShopItemDraft) {
    if (isDesignPreview()) {
      return Promise.resolve(designPreviewSaveShopItem(payload));
    }
    return request("/api/shop-items", {
      method: "POST",
      body: payload,
    });
  },
};
