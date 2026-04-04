import type {
  BootstrapPayload,
  GroupDraft,
  RoleCapability,
  Settings,
  ShopItemDraft,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

type ApiOptions = {
  token?: string | null;
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
      ...(options.token ? { "x-admin-token": options.token } : {}),
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
  login(token: string) {
    return request<{ authenticated: boolean }>("/api/auth/login", {
      method: "POST",
      body: { token },
    });
  },
  logout(token?: string | null) {
    return request<{ authenticated: boolean }>("/api/auth/logout", {
      method: "POST",
      token,
    });
  },
  session(token?: string | null) {
    return request<{ authenticated: boolean }>("/api/auth/session", {
      token,
    });
  },
  bootstrap(token?: string | null) {
    return request<BootstrapPayload>("/api/bootstrap", { token });
  },
  saveSettings(payload: Settings, token?: string | null) {
    return request<Settings>("/api/settings", {
      method: "PUT",
      token,
      body: payload,
    });
  },
  saveCapabilities(payload: RoleCapability[], token?: string | null) {
    return request<RoleCapability[]>("/api/capabilities", {
      method: "PUT",
      token,
      body: payload,
    });
  },
  saveGroup(payload: GroupDraft, token?: string | null) {
    return request("/api/groups", {
      method: "POST",
      token,
      body: {
        ...payload,
        aliases: payload.aliasesText
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
    });
  },
  saveShopItem(payload: ShopItemDraft, token?: string | null) {
    return request("/api/shop-items", {
      method: "POST",
      token,
      body: payload,
    });
  },
};
