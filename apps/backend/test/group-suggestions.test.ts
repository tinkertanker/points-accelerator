import { describe, expect, it } from "vitest";

import { suggestGroupRoles } from "../src/domain/group-suggestions.js";

function role(id: string, name: string, memberIds: string[]) {
  return { id, name, memberIds };
}

function range(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

describe("suggestGroupRoles", () => {
  it("identifies the swift-accelerator timeslot family across am/pm names", () => {
    const total = 80;
    const allMemberIds = range("u", total);
    const roles = [
      ...range("am", 8).map((suffix, sessionIndex) =>
        role(`role-${suffix}`, `${sessionIndex + 1}am`, allMemberIds.slice(sessionIndex * 5, sessionIndex * 5 + 5)),
      ),
      ...range("pm", 8).map((suffix, sessionIndex) =>
        role(
          `role-${suffix}`,
          `${sessionIndex + 1}pm`,
          allMemberIds.slice(40 + sessionIndex * 5, 40 + sessionIndex * 5 + 5),
        ),
      ),
      role("role-admin", "Admin", ["u1", "u2"]),
      role("role-mentor", "Mentor", ["u3", "u4", "u5"]),
    ];

    const result = suggestGroupRoles({ roles, totalHumanMembers: total });

    expect(result.primary).not.toBeNull();
    expect(result.primary!.kind).toBe("naming-family");
    expect(result.primary!.roleIds).toHaveLength(16);
    expect(result.primary!.coverage).toBeGreaterThan(0.9);
    expect(result.primary!.exclusivity).toBe(1);
    expect(result.primary!.label).toMatch(/timeslot/i);
  });

  it("clusters prefix-numbered groups like 'Group 1', 'Group 2'", () => {
    const total = 30;
    const roles = [
      role("g1", "Group 1", range("u", 10)),
      role("g2", "Group 2", range("u", 20).slice(10)),
      role("g3", "Group 3", range("u", 30).slice(20)),
      role("everyone-like", "Everyone", range("u", 30)),
      role("staff", "Staff", ["u1"]),
    ];

    const result = suggestGroupRoles({ roles, totalHumanMembers: total });

    expect(result.primary).not.toBeNull();
    expect(result.primary!.roleIds.sort()).toEqual(["g1", "g2", "g3"].sort());
    expect(result.primary!.label).toMatch(/group/i);
    expect(result.primary!.coverage).toBe(1);
    expect(result.primary!.exclusivity).toBe(1);
  });

  it("does not group unrelated staff roles into a family", () => {
    const total = 4;
    const roles = [
      role("admin", "Admin", ["u1"]),
      role("mentor", "Mentor", ["u2", "u3"]),
      role("alumni", "Alumni", ["u4"]),
    ];

    const result = suggestGroupRoles({ roles, totalHumanMembers: total });

    expect(result.primary).toBeNull();
    expect(result.alternatives).toHaveLength(0);
  });

  it("falls back to a size-cluster when names are arbitrary but counts cluster", () => {
    const total = 40;
    const roles = [
      role("r-sky", "Sky", range("u", 10)),
      role("r-river", "River", range("u", 20).slice(10)),
      role("r-forest", "Forest", range("u", 30).slice(20)),
      role("r-mountain", "Mountain", range("u", 40).slice(30)),
      role("everyone-like", "Member", range("u", 40)),
    ];

    const result = suggestGroupRoles({ roles, totalHumanMembers: total });

    expect(result.primary).not.toBeNull();
    expect(result.primary!.kind).toBe("size-cluster");
    expect(result.primary!.roleIds.sort()).toEqual(["r-forest", "r-mountain", "r-river", "r-sky"]);
  });

  it("dedupes overlapping suggestions, keeping the higher-scoring one", () => {
    const total = 12;
    const roles = [
      role("a", "Group 1", ["u1", "u2", "u3", "u4"]),
      role("b", "Group 2", ["u5", "u6", "u7", "u8"]),
      role("c", "Group 3", ["u9", "u10", "u11", "u12"]),
      // Same roles, second size-cluster candidate should be filtered out
      role("d", "Extra", ["u1", "u5", "u9"]),
    ];

    const result = suggestGroupRoles({ roles, totalHumanMembers: total });
    expect(result.primary).not.toBeNull();
    const allRoles = [result.primary!, ...result.alternatives].flatMap((s) => s.roleIds);
    const uniqueRoles = new Set(allRoles);
    expect(allRoles.length).toBe(uniqueRoles.size);
  });

  it("returns no suggestions when the guild has no human members", () => {
    const result = suggestGroupRoles({
      roles: [role("a", "Group 1", []), role("b", "Group 2", [])],
      totalHumanMembers: 0,
    });
    expect(result.primary).toBeNull();
  });

  it("ignores umbrella roles that cover most of the guild", () => {
    const total = 100;
    const all = range("u", total);
    const roles = [
      role("members", "All Members", all),
      role("g1", "Group 1", all.slice(0, 50)),
      role("g2", "Group 2", all.slice(50)),
    ];

    const result = suggestGroupRoles({ roles, totalHumanMembers: total });
    expect(result.primary).not.toBeNull();
    expect(result.primary!.roleIds.sort()).toEqual(["g1", "g2"]);
  });
});
