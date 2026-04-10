import { describe, expect, it } from "vitest";

import { assertCanAward, resolveCapabilities } from "../src/domain/permissions.js";

describe("permission evaluation", () => {
  it("resolves the highest award cap and merged flags", () => {
    const resolved = resolveCapabilities([
      {
        canManageDashboard: false,
        canAward: true,
        maxAward: { toString: () => "10" } as never,
        canDeduct: false,
        canMultiAward: false,
        canSell: false,
      },
      {
        canManageDashboard: true,
        canAward: true,
        maxAward: { toString: () => "1000" } as never,
        canDeduct: true,
        canMultiAward: true,
        canSell: true,
      },
    ]);

    expect(resolved).toEqual({
      canManageDashboard: true,
      canAward: true,
      maxAward: 1000,
      canDeduct: true,
      canMultiAward: true,
      canSell: true,
    });
  });

  it("rejects awards above the role cap", () => {
    const resolved = resolveCapabilities([
      {
        canManageDashboard: false,
        canAward: true,
        maxAward: { toString: () => "10" } as never,
        canDeduct: false,
        canMultiAward: false,
        canSell: false,
      },
    ]);

    expect(() =>
      assertCanAward({
        capabilities: resolved,
        magnitude: 20,
        targetCount: 1,
        isDeduction: false,
      }),
    ).toThrow(/at most 10/i);
  });

  it("treats an empty max award as unlimited for award-capable staff roles", () => {
    const resolved = resolveCapabilities([
      {
        canManageDashboard: false,
        canAward: true,
        maxAward: null,
        canDeduct: false,
        canMultiAward: true,
        canSell: false,
      },
    ]);

    expect(() =>
      assertCanAward({
        capabilities: resolved,
        magnitude: 5000,
        targetCount: 2,
        isDeduction: false,
      }),
    ).not.toThrow();
  });
});
