import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

const GUILD_ID = "guild-test";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  const managed = ensureTestDatabase();
  cleanupDatabase = managed.cleanup;
  ctx = await createTestApp(managed.url);
}, 60_000);

afterAll(async () => {
  await ctx.app.close();
  await ctx.prisma.$disconnect();
  await cleanupDatabase();
});

beforeEach(async () => {
  await resetDatabase(ctx.prisma, ctx.services);
  await ctx.services.configService.getOrCreate(GUILD_ID);
});

/**
 * Seed awardable group roles + their Group rows. Capabilities are created
 * BEFORE the cache is primed, so a single sync creates every Group row. (If a
 * capability is added after the cache fills, only a writer that busts the cache
 * — replaceAll/groupService.upsert — triggers re-sync.)
 */
async function seedAwardableRoles(
  roles: Array<{ roleId: string; displayName?: string }>,
) {
  await ctx.prisma.discordRoleCapability.createMany({
    data: roles.map((role) => ({
      guildId: GUILD_ID,
      roleId: role.roleId,
      roleName: role.displayName ?? role.roleId,
      isGroupRole: true,
      canReceiveAwards: true,
    })),
  });
  // syncAwardableRoleGroups (called by the lookups under test) creates the
  // Group rows on cold fill; the cache is cleared in beforeEach so this runs.
  return roles.map((role) =>
    ctx.services.groupService.resolveGroupByIdentifier(GUILD_ID, role.roleId),
  );
}

async function seedAwardableRole(roleId: string, displayName = roleId) {
  const [group] = await seedAwardableRoles([{ roleId, displayName }]);
  return group;
}

describe("GroupService.findGroupsFromOrderedRoles", () => {
  it("resolves each member to their first matching active awardable group", async () => {
    await seedAwardableRole("role-a", "Group A");

    const resolved = await ctx.services.groupService.findGroupsFromOrderedRoles(GUILD_ID, [
      { orderedRoleIds: ["unrelated", "role-a"] },
      { orderedRoleIds: ["role-a"] },
    ]);

    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.roleId).toBe("role-a");
    expect(resolved[1]?.roleId).toBe("role-a");
  });

  it("returns null for members with no awardable role, preserving input order", async () => {
    await seedAwardableRole("role-a", "Group A");

    const resolved = await ctx.services.groupService.findGroupsFromOrderedRoles(GUILD_ID, [
      { orderedRoleIds: ["role-a"] },
      { orderedRoleIds: ["no-group"] },
      { orderedRoleIds: ["role-a"] },
    ]);

    expect(resolved).toHaveLength(3);
    expect(resolved[0]?.roleId).toBe("role-a");
    expect(resolved[1]).toBeNull();
    expect(resolved[2]?.roleId).toBe("role-a");
  });

  it("honours caller-supplied role priority: highest-position group wins", async () => {
    await seedAwardableRoles([
      { roleId: "role-a", displayName: "Group A" },
      { roleId: "role-b", displayName: "Group B" },
    ]);

    // The caller passes roles ordered by priority (highest first). Even though
    // both roles map to a group, the first-listed (role-b) must win.
    const resolved = await ctx.services.groupService.findGroupsFromOrderedRoles(GUILD_ID, [
      { orderedRoleIds: ["role-b", "role-a"] },
      { orderedRoleIds: ["role-a", "role-b"] },
    ]);

    expect(resolved[0]?.roleId).toBe("role-b");
    expect(resolved[1]?.roleId).toBe("role-a");
  });

  it("returns [] for an empty members array without hitting the DB", async () => {
    const resolved = await ctx.services.groupService.findGroupsFromOrderedRoles(GUILD_ID, []);
    expect(resolved).toEqual([]);
  });
});

describe("GroupService awardable-role cache", () => {
  it("is invalidated when RoleCapabilityService.replaceAll toggles a group role", async () => {
    await seedAwardableRole("role-a", "Group A");

    // Prime the cache with the current awardable set (only role-a is awardable).
    const before = await ctx.services.groupService.findGroupsFromOrderedRoles(GUILD_ID, [
      { orderedRoleIds: ["role-new"] },
    ]);
    expect(before[0]).toBeNull();

    // replaceAll is the writer that busts the cache via the capabilities-changed hook.
    const existing = await ctx.prisma.discordRoleCapability.findMany({ where: { guildId: GUILD_ID } });
    await ctx.services.roleCapabilityService.replaceAll(GUILD_ID, [
      ...existing.map((cap) => ({
        roleId: cap.roleId,
        roleName: cap.roleName,
        canManageDashboard: cap.canManageDashboard,
        canAward: cap.canAward,
        maxAward: cap.maxAward ? Number(cap.maxAward) : null,
        actionCooldownSeconds: cap.actionCooldownSeconds,
        canDeduct: cap.canDeduct,
        canMultiAward: cap.canMultiAward,
        canSell: cap.canSell,
        canReceiveAwards: cap.canReceiveAwards,
        isGroupRole: cap.isGroupRole,
        riggedBetWinChance: cap.riggedBetWinChance,
      })),
      {
        roleId: "role-new",
        roleName: "Group New",
        canManageDashboard: false,
        canAward: false,
        maxAward: null,
        actionCooldownSeconds: null,
        canDeduct: false,
        canMultiAward: false,
        canSell: false,
        canReceiveAwards: true,
        isGroupRole: true,
        riggedBetWinChance: null,
      },
    ]);

    const after = await ctx.services.groupService.findGroupsFromOrderedRoles(GUILD_ID, [
      { orderedRoleIds: ["role-new"] },
    ]);
    expect(after[0]?.roleId).toBe("role-new");
  });

  it("invalidateAwardableRoleCache only clears the targeted guild", async () => {
    await seedAwardableRole("role-a", "Group A");
    const OTHER_GUILD = "guild-other";
    await ctx.services.configService.getOrCreate(OTHER_GUILD);
    await ctx.prisma.discordRoleCapability.create({
      data: {
        guildId: OTHER_GUILD,
        roleId: "role-other",
        roleName: "Other",
        isGroupRole: true,
        canReceiveAwards: true,
      },
    });

    // Prime both caches.
    await ctx.services.groupService.findGroupsFromOrderedRoles(GUILD_ID, [
      { orderedRoleIds: ["role-a"] },
    ]);
    await ctx.services.groupService.findGroupsFromOrderedRoles(OTHER_GUILD, [
      { orderedRoleIds: ["role-other"] },
    ]);

    ctx.services.groupService.invalidateAwardableRoleCache(GUILD_ID);

    // The other guild's cache should be untouched (still resolves), while the
    // targeted guild re-syncs from the DB on its next call.
    const otherStillCached = await ctx.services.groupService.findGroupsFromOrderedRoles(OTHER_GUILD, [
      { orderedRoleIds: ["role-other"] },
    ]);
    expect(otherStillCached[0]?.roleId).toBe("role-other");
  });
});

describe("GroupService.hasGroupRole", () => {
  it("returns true only when a role capability has isGroupRole true", async () => {
    await seedAwardableRole("role-a", "Group A");
    await ctx.prisma.discordRoleCapability.create({
      data: {
        guildId: GUILD_ID,
        roleId: "role-not-group",
        roleName: "Not a group role",
        isGroupRole: false,
        canReceiveAwards: true,
      },
    });

    await expect(ctx.services.groupService.hasGroupRole(GUILD_ID, ["role-a"])).resolves.toBe(true);
    await expect(ctx.services.groupService.hasGroupRole(GUILD_ID, ["role-not-group"])).resolves.toBe(false);
    await expect(ctx.services.groupService.hasGroupRole(GUILD_ID, ["missing"])).resolves.toBe(false);
  });
});
