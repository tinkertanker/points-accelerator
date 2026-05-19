import { afterEach, describe, expect, it, vi } from "vitest";

import { api, resolveApiUrl } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("resolveApiUrl", () => {
  it("keeps a relative /api base from being prefixed twice", () => {
    expect(resolveApiUrl("/api", "/api/auth/login")).toBe("/api/auth/login");
  });

  it("joins a host base with api routes", () => {
    expect(resolveApiUrl("http://localhost:3001", "/api/auth/login")).toBe("http://localhost:3001/api/auth/login");
  });

  it("handles an absolute base that already ends in /api", () => {
    expect(resolveApiUrl("https://points-accelerator.tk.sg/api/", "/api/bootstrap")).toBe(
      "https://points-accelerator.tk.sg/api/bootstrap",
    );
  });
});

describe("api design preview reaction rules", () => {
  it("keeps reaction rule mutations local", async () => {
    vi.stubEnv("VITE_DESIGN_PREVIEW", "true");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const created = await api.createReactionRule({
      channelId: "ch-general",
      botUserId: "bot-1",
      emoji: "⭐",
      currencyDelta: 2,
      description: "Helpful reaction",
      enabled: true,
    });
    expect(created).toMatchObject({
      guildId: "preview-guild",
      channelId: "ch-general",
      botUserId: "bot-1",
      emoji: "⭐",
      currencyDelta: 2,
    });

    const updated = await api.updateReactionRule(created.id, {
      channelId: "ch-general",
      botUserId: "bot-1",
      emoji: "⭐",
      currencyDelta: 3,
      description: "Updated",
      enabled: false,
    });
    expect(updated).toMatchObject({
      id: created.id,
      currencyDelta: 3,
      description: "Updated",
      enabled: false,
    });

    await expect(api.deleteReactionRule(created.id)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("api design preview admin actions", () => {
  it("keeps economy reset and sanction actions local", async () => {
    vi.stubEnv("VITE_DESIGN_PREVIEW", "true");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const reset = await api.economyReset({
      mode: "modulo-balance",
      modulus: 10,
      applyToParticipantCurrency: true,
      applyToGroupPoints: true,
      applyToGroupCurrency: false,
      dryRun: true,
    });
    expect(reset).toMatchObject({
      mode: "modulo-balance",
      modulus: 10,
      dryRun: true,
      participantImpact: [],
      groupImpact: [],
    });

    await expect(api.listSanctions()).resolves.toEqual([]);
    const sanction = await api.applySanction("participant-1", {
      flag: "CANNOT_BET",
      reason: "Preview discipline",
      expiresAt: null,
    });
    expect(sanction).toMatchObject({
      participantId: "participant-1",
      flag: "CANNOT_BET",
      reason: "Preview discipline",
      revokedAt: null,
    });
    await expect(api.listSanctions()).resolves.toHaveLength(1);

    const revoked = await api.revokeSanction(sanction.id);
    expect(revoked.revokedAt).toEqual(expect.any(String));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
