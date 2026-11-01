import { extname } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BotRuntimeApi } from "../src/bot/runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import type { StorageService } from "../src/services/storage-service.js";
import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let appUrl: string;
let session: string;
let memberPresent = true;
let roles: string[] = [];
let storageConfigured = false;
const storedImages = new Map<string, Buffer>();
const postedListingChannels: string[] = [];
const connections: Array<{ close: () => Promise<void> }> = [];
const itemInput = { name: "Team reward", description: "An afternoon activity", cost: 17.5, stock: 3, enabled: true };

const botRuntime = {
  listBotGuilds: vi.fn(async () => [{ id: "guild-test", name: "Test", iconUrl: null }]),
  getRoles: vi.fn(async () => []),
  getTextChannels: vi.fn(async () => []),
  getMembers: vi.fn(async () => []),
  getGroupMemberCount: vi.fn(async () => 4),
  getGroupMemberDiscordUserIds: vi.fn(async () => ["student-one", "student-two", "student-three", "student-four"]),
  clearRedemptionButtons: vi.fn(async () => undefined),
  postListing: vi.fn(async (_guildId: string, channelId: string) => {
    postedListingChannels.push(channelId);
    return null;
  }),
  getDashboardMember: vi.fn(async () => memberPresent ? {
    userId: "staff-user", username: "Staff", displayName: "Staff", avatarUrl: null,
    roleIds: roles, isGuildOwner: false, hasAdministrator: false, hasManageGuild: false,
  } : null),
} as unknown as BotRuntimeApi;

async function connect(options: { guildId?: string; session?: string; stdio?: boolean } = {}) {
  const config = { appUrl, session: options.session ?? session, guildId: options.guildId ?? "guild-test" };
  const client = new Client({ name: "test-client", version: "1.0.0" });
  connections.push(client);
  if (options.stdio) {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/mcp/index.ts"],
      env: { PA_MCP_APP_URL: appUrl, PA_MCP_SESSION: config.session, PA_MCP_GUILD_ID: config.guildId },
    }));
  } else {
    const server = createMcpServer(config);
    connections.push(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }
  return client;
}

async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text: string }>;
  return { result, body: JSON.parse(blocks[0]!.text) };
}

async function createAccounts(client: Client) {
  const group = (await tool(client, "upsert_group", { input: { displayName: "Orchids", roleId: "group-role", aliases: [] } })).body.data;
  const participants = [];
  for (const [index, userId] of ["student-one", "student-two"].entries()) {
    participants.push((await tool(client, "register_participant", {
      input: { discordUserId: userId, indexId: `MCP${index}`, groupId: group.id },
    })).body.data);
  }
  return { group, first: participants[0], second: participants[1] };
}

describe("Points Accelerator MCP", () => {
  beforeAll(async () => {
    const managed = ensureTestDatabase();
    ctx = await createTestApp(managed.url, {
      botRuntime,
      storageService: {
        get isConfigured() { return storageConfigured; },
        async upload({ buffer, folder, originalFilename }: { buffer: Buffer; folder: string; originalFilename: string }) {
          const key = `${folder}/test-image${extname(originalFilename)}`;
          storedImages.set(key, buffer);
          return { key, url: `https://storage.example.com/${key}` };
        },
      } as unknown as StorageService,
      discordOAuthClient: {
        buildAuthorizeUrl: ({ state }) => `https://discord.com/oauth2/authorize?state=${state}`,
        exchangeCode: async () => ({
          identity: { id: "staff-user", username: "Staff", globalName: "Staff", avatarUrl: null },
          guilds: [{ id: "guild-test", name: "Test", iconUrl: null }],
        }),
      },
    });
    appUrl = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma, ctx.services);
    memberPresent = true;
    roles = ["admin-role"];
    storageConfigured = false;
    storedImages.clear();
    postedListingChannels.length = 0;
    await ctx.services.configService.getOrCreate("guild-test");
    await ctx.prisma.discordRoleCapability.create({
      data: { guildId: "guild-test", roleId: "admin-role", roleName: "Admin", canManageDashboard: true },
    });
    await ctx.prisma.guildConfig.update({ where: { guildId: "guild-test" }, data: { mentorRoleIds: ["mentor-role"] } });
    ctx.services.configService.clearCache();
    const start = await ctx.app.inject({ method: "GET", url: "/api/auth/discord" });
    const state = start.cookies.find((cookie) => cookie.name === "discord_oauth_state")!.value;
    const callback = await ctx.app.inject({
      method: "GET", url: `/api/auth/discord/callback?code=test&state=${state}`,
      headers: { cookie: `discord_oauth_state=${state}` },
    });
    session = callback.cookies.find((cookie) => cookie.name === "dashboard_session")!.value;
  });

  afterEach(async () => {
    for (const connection of connections.splice(0)) await connection.close();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.prisma.$disconnect();
  });

  it("negotiates real stdio and enables full admin writes without an opt-in flag", async () => {
    const group = await ctx.services.groupService.upsert("guild-test", { displayName: "Orchids", roleId: "group-role", aliases: [], active: true });
    await ctx.services.economyService.awardGroups({
      guildId: "guild-test", actor: { userId: "system", roleIds: [] }, targetGroupIds: [group.id],
      pointsDelta: 23, currencyDelta: 0, description: "Seed", systemAction: true,
    });
    const client = await connect({ stdio: true });
    const tools = (await client.listTools()).tools;
    expect(tools.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "adjust_balances", "transfer_currency", "donate_currency", "reset_economy", "replace_capabilities",
      "delete_participant", "delete_shop_item", "review_submission", "update_settings", "upsert_shop_item",
    ]));
    expect(tools.find((entry) => entry.name === "reset_economy")!.annotations?.destructiveHint).toBe(true);
    const leaderboard = await tool(client, "get_leaderboard");
    expect(leaderboard.body).toEqual({ status: 200, data: [{ id: group.id, displayName: "Orchids", pointsBalance: 23 }] });
    expect((await tool(client, "upsert_shop_item", { input: itemInput })).body.status).toBe(200);
    expect(await ctx.prisma.shopItem.count()).toBe(1);
  });

  it("requires live administrator authority even for mentors and previously connected clients", async () => {
    const client = await connect();
    const catalogue = (await client.listTools()).tools;
    expect((await tool(client, "get_settings")).body.status).toBe(200);
    expect((await tool(client, "list_capabilities")).body.data[0]).toMatchObject({ roleId: "admin-role", canManageDashboard: true });
    expect((await tool(client, "list_groups")).body).toEqual({ status: 200, data: [] });
    roles = ["mentor-role"];
    expect((await tool(client, "get_settings")).body.status).toBe(403);
    expect((await tool(client, "upsert_shop_item", { input: itemInput })).body.status).toBe(403);
    await expect(client.listTools()).rejects.toThrow("HTTP 403");
    roles = [];
    for (const entry of catalogue) {
      const denied = await tool(client, entry.name);
      expect(denied.result.isError).toBe(true);
      expect(denied.body.status).toBe(403);
    }
    expect((await tool(client, "reset_economy", { input: { mode: "set-balances", targetGroupPoints: 0, dryRun: false } })).body.status).toBe(403);
    expect(await ctx.prisma.shopItem.count()).toBe(0);
    expect(await ctx.prisma.auditLog.count()).toBe(0);
  });

  it("creates and archives group items, validates inputs, and cannot target other guilds", async () => {
    const client = await connect();
    const created = await tool(client, "upsert_shop_item", { input: itemInput });
    expect(created.body.data).toMatchObject({ ...itemInput, audience: "GROUP", guildId: "guild-test" });
    const id = created.body.data.id;
    expect((await tool(client, "list_shop_items")).body.data).toEqual([created.body.data]);
    expect((await tool(client, "archive_shop_item", { id })).body.data.enabled).toBe(false);
    expect((await tool(client, "archive_shop_item", { id })).body.status).toBe(200);
    expect(await ctx.prisma.shopItem.count()).toBe(1);
    expect(await ctx.prisma.auditLog.count({ where: { entityId: id } })).toBe(3);
    expect(await ctx.prisma.auditLog.count({ where: { action: "mcp.admin.requested", actorUserId: "staff-user" } })).toBe(3);
    await ctx.services.configService.getOrCreate("guild-other");
    const other = await ctx.services.shopService.upsert("guild-other", itemInput);
    expect((await tool(client, "archive_shop_item", { id: other.id })).body.status).toBe(404);
    expect((await ctx.services.shopService.list("guild-other"))[0]!.enabled).toBe(true);
    for (const bad of [{ cost: -1 }, { stock: 1.5 }]) {
      expect((await client.callTool({ name: "upsert_shop_item", arguments: { input: { ...itemInput, ...bad } } })).isError).toBe(true);
    }
    expect(await ctx.prisma.shopItem.count()).toBe(2);
  });

  it("allows administrator proxy approvals to charge group points, with real actor attribution and cancellation refunds", async () => {
    const client = await connect();
    const { group, first, second } = await createAccounts(client);
    await tool(client, "adjust_balances", { input: { targetGroupIds: [group.id], pointsDelta: 100, description: "Purchase funds" } });
    const item = (await tool(client, "upsert_shop_item", { input: itemInput })).body.data;
    const purchase = (await tool(client, "redeem_shop_item", { input: { participantId: first.id, shopItemId: item.id, quantity: 2, purchaseMode: "GROUP" } })).body.data;
    expect(purchase).toMatchObject({ status: "AWAITING_APPROVAL", approvalThreshold: 2, requestedByUserId: "staff-user" });
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(100);
    const approved = await tool(client, "approve_group_purchase", { input: { redemptionId: purchase.id, participantId: second.id } });
    expect(approved.body.data.redemption.status).toBe("PENDING");
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(65);
    const approvalAudit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: "shop.group_purchase.approved", entityId: purchase.id } });
    expect(approvalAudit.actorUserId).toBe("staff-user");
    expect(await ctx.prisma.auditLog.count({ where: { action: "mcp.admin.requested", actorUserId: "staff-user", payload: { path: ["tool"], equals: "approve_group_purchase" } } })).toBe(1);
    expect((await tool(client, "delete_shop_item", { id: item.id })).body.status).toBe(409);
    expect((await tool(client, "update_redemption_status", { id: purchase.id, input: { status: "CANCELED" } })).body.data.status).toBe("CANCELED");
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(100);
    expect((await tool(client, "list_shop_items")).body.data[0].stock).toBe(3);
  });

  it("moves points and currency with administrator authority, real actor attribution and atomic rollback", async () => {
    const client = await connect();
    const { group, first, second } = await createAccounts(client);
    expect((await tool(client, "adjust_balances", { input: {
      targetGroupIds: [group.id], targetParticipantId: first.id, pointsDelta: 137, currencyDelta: 53, description: "Admin award",
    } })).body.status).toBe(200);
    expect((await tool(client, "transfer_currency", { input: {
      sourceParticipantId: first.id, targetParticipantId: second.id, amount: 17,
    } })).body.status).toBe(200);
    expect((await tool(client, "donate_currency", { input: {
      sourceParticipantId: first.id, groupId: group.id, amount: 6,
    } })).body.status).toBe(200);
    const rate = Number((await ctx.services.configService.getOrCreate("guild-test")).groupPointsPerCurrencyDonation);
    expect(await ctx.services.participantCurrencyService.getParticipantBalance(first.id)).toBe(30);
    expect(await ctx.services.participantCurrencyService.getParticipantBalance(second.id)).toBe(17);
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(137 + 6 * rate);
    expect((await tool(client, "adjust_balances", { input: {
      targetGroupIds: [group.id], targetParticipantId: "missing", pointsDelta: 9, currencyDelta: 4, description: "Must roll back",
    } })).body.status).toBe(404);
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(137 + 6 * rate);
    expect((await tool(client, "transfer_currency", { input: {
      sourceParticipantId: first.id, targetParticipantId: second.id, amount: 31,
    } })).body.status).toBe(409);
    const entries = await ctx.prisma.participantCurrencyEntry.findMany();
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.createdByUserId === "staff-user")).toBe(true);
    expect((await tool(client, "adjust_balances", { input: {
      targetGroupIds: [group.id], pointsDelta: -7, description: "Admin deduction",
    } })).body.status).toBe(200);
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(130 + 6 * rate);
    expect((await tool(client, "adjust_balances", { input: {
      targetGroupIds: [group.id], pointsDelta: 1, description: "Spoof", actorUserId: "someone-else", actorRoleIds: ["fake-admin"],
    } })).body.status).toBe(400);
  });

  it("applies destructive resets only when requested and preserves append-only history and audit", async () => {
    const client = await connect();
    const { group, first } = await createAccounts(client);
    await tool(client, "adjust_balances", { input: {
      targetGroupIds: [group.id], targetParticipantId: first.id, pointsDelta: 97, currencyDelta: 41, description: "Original award",
    } });
    const original = await ctx.prisma.ledgerEntry.findFirstOrThrow();
    const input = { mode: "set-balances", targetGroupPoints: 12, targetParticipantCurrency: 8, dryRun: true };
    expect((await tool(client, "reset_economy", { input })).body.status).toBe(200);
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(97);
    expect(await ctx.services.participantCurrencyService.getParticipantBalance(first.id)).toBe(41);
    expect((await tool(client, "reset_economy", { input: { ...input, dryRun: false } })).body.status).toBe(200);
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(12);
    expect(await ctx.services.participantCurrencyService.getParticipantBalance(first.id)).toBe(8);
    expect(await ctx.prisma.ledgerEntry.findUnique({ where: { id: original.id } })).toEqual(original);
    const audit = await ctx.prisma.auditLog.findMany({ where: { action: "mcp.admin.completed" } });
    expect(audit.filter((entry) => (entry.payload as { tool: string }).tool === "reset_economy")).toHaveLength(2);
    expect(audit.every((entry) => entry.actorUserId === "staff-user")).toBe(true);
    const item = (await tool(client, "upsert_shop_item", { input: itemInput })).body.data;
    expect((await tool(client, "delete_shop_item", { id: item.id })).body.status).toBe(200);
    expect(await ctx.prisma.shopItem.count()).toBe(0);
    expect((await tool(client, "delete_participant", { id: first.id })).body.status).toBe(200);
    expect(await ctx.services.participantService.findById("guild-test", first.id)).toBeNull();
  });

  it("updates settings, automation and assignments and attributes review rewards to the administrator", async () => {
    const client = await connect();
    const settings = (await tool(client, "get_settings")).body.data;
    expect((await tool(client, "update_settings", { input: { ...settings, appName: "MCP managed" } })).body.status).toBe(200);
    expect((await tool(client, "get_settings")).body.data.appName).toBe("MCP managed");
    const { group, first } = await createAccounts(client);
    const assignment = (await tool(client, "upsert_assignment", { input: {
      title: "Reflection", description: "Weekly reflection", baseCurrencyReward: 7, basePointsReward: 11,
      bonusCurrencyReward: 3, bonusPointsReward: 5, active: true,
    } })).body.data;
    const submission = await ctx.services.submissionService.create({
      guildId: "guild-test", assignmentId: assignment.id, participantId: first.id, text: "Completed reflection",
    });
    expect((await tool(client, "review_submission", { id: submission.id, input: { status: "OUTSTANDING" } })).body.status).toBe(200);
    expect(await ctx.services.participantCurrencyService.getParticipantBalance(first.id)).toBe(10);
    expect((await ctx.services.economyService.getLeaderboard("guild-test"))[0]!.pointsBalance).toBe(16);
    const ruleInput = { channelId: "channel-one", botUserId: "bot-one", emoji: "✅", currencyDelta: 4 };
    const rule = (await tool(client, "create_reaction_rule", { input: ruleInput })).body.data;
    expect((await tool(client, "update_reaction_rule", { id: rule.id, input: { ...ruleInput, currencyDelta: 9 } })).body.data.currencyDelta).toBe(9);
    expect((await tool(client, "delete_reaction_rule", { id: rule.id })).body.status).toBe(200);
    const sanction = (await tool(client, "apply_sanction", { id: first.id, input: { flag: "CANNOT_BET", reason: "Test restriction" } })).body.data;
    expect(sanction.createdByUserId).toBe("staff-user");
    expect((await tool(client, "revoke_sanction", { id: sanction.id })).body.data.revokedByUserId).toBe("staff-user");
    expect((await tool(client, "create_listing", { input: { title: "Test listing", description: "No Discord channel configured" } })).body.data.createdByUserId).toBe("staff-user");
    expect((await tool(client, "list_groups")).body.data[0].id).toBe(group.id);
  });

  it("denies cross-guild money movement, record updates and destructive operations", async () => {
    const client = await connect();
    const { first } = await createAccounts(client);
    await ctx.services.configService.getOrCreate("guild-other");
    const group = await ctx.services.groupService.upsert("guild-other", { displayName: "Other", roleId: "other-role", aliases: [], active: true });
    const participant = await ctx.services.participantService.register({ guildId: "guild-other", groupId: group.id, discordUserId: "other-user", indexId: "OTHER" });
    const item = await ctx.services.shopService.upsert("guild-other", itemInput);
    const attempts: Array<[string, Record<string, unknown>]> = [
      ["adjust_balances", { input: { targetGroupIds: [group.id], pointsDelta: 10, description: "Cross guild" } }],
      ["adjust_balances", { input: { targetParticipantId: participant.id, currencyDelta: 10, description: "Cross guild" } }],
      ["transfer_currency", { input: { sourceParticipantId: participant.id, targetParticipantId: first.id, amount: 1 } }],
      ["donate_currency", { input: { sourceParticipantId: participant.id, groupId: group.id, amount: 1 } }],
      ["delete_participant", { id: participant.id }],
      ["apply_sanction", { id: participant.id, input: { flag: "CANNOT_BET" } }],
      ["upsert_shop_item", { input: { ...itemInput, id: item.id, name: "Hijacked" } }],
      ["delete_shop_item", { id: item.id }],
      ["upsert_group", { input: { id: group.id, displayName: "Hijacked", roleId: "other-role", aliases: [] } }],
    ];
    for (const [name, args] of attempts) expect((await tool(client, name, args)).body.status, name).toBe(404);
    expect((await ctx.services.shopService.list("guild-other"))[0]!.name).toBe(itemInput.name);
    expect(await ctx.services.participantService.findById("guild-other", participant.id)).not.toBeNull();
    expect(await ctx.prisma.ledgerEntry.count()).toBe(0);
    expect(await ctx.prisma.participantCurrencyEntry.count()).toBe(0);
    const wrongGuild = await connect({ guildId: "guild-other" });
    expect((await tool(wrongGuild, "reset_economy", { input: { mode: "set-balances", targetGroupPoints: 0, dryRun: false } })).body.status).toBe(409);
    const forged = await ctx.app.inject({
      method: "POST", url: "/api/actions/award",
      headers: { cookie: `dashboard_session=${session}`, "x-points-accelerator-guild-id": "guild-test", "x-points-accelerator-mcp-admin": "1" },
      payload: { actorRoleIds: [], pointsDelta: 1, targetGroupIds: [group.id], description: "Forge internal authority" },
    });
    expect(forged.statusCode).toBe(403);
  });

  it("rejects foreign Discord posting channels instead of trusting globally unique channel IDs", async () => {
    const client = await connect();
    const settings = (await tool(client, "get_settings")).body.data;
    expect((await tool(client, "update_settings", { input: { ...settings, listingChannelId: "foreign-channel" } })).body.status).toBe(404);
    expect((await tool(client, "get_settings")).body.data.listingChannelId).toBeNull();
    await ctx.prisma.guildConfig.update({ where: { guildId: "guild-test" }, data: { listingChannelId: "foreign-channel" } });
    ctx.services.configService.clearCache();
    expect((await tool(client, "create_listing", { input: { title: "Foreign", description: "Must not post" } })).body.status).toBe(404);
    const dashboard = await ctx.app.inject({
      method: "POST", url: "/api/listings",
      headers: { cookie: `dashboard_session=${session}` },
      payload: { title: "Dashboard foreign", description: "Must not post either", actorUserId: "staff-user", actorRoleIds: [] },
    });
    expect(dashboard.statusCode).toBe(404);
    expect(postedListingChannels).toEqual([]);
    expect(await ctx.prisma.marketplaceListing.count()).toBe(0);
  });

  it("posts only to the validated guild channel when settings change concurrently", async () => {
    const client = await connect();
    await ctx.prisma.guildConfig.update({ where: { guildId: "guild-test" }, data: { listingChannelId: "local-channel" } });
    ctx.services.configService.clearCache();
    vi.mocked(botRuntime.getTextChannels).mockImplementationOnce(async () => {
      await ctx.prisma.guildConfig.update({ where: { guildId: "guild-test" }, data: { listingChannelId: "foreign-channel" } });
      ctx.services.configService.clearCache();
      return [{ id: "local-channel", name: "local" }];
    });
    const result = await tool(client, "create_listing", { input: { title: "Concurrent change", description: "Must not cross guilds" } });
    expect(result.body.status).toBe(200);
    expect(postedListingChannels).toEqual(["local-channel"]);
    expect((await ctx.prisma.marketplaceListing.findFirstOrThrow()).channelId).toBe("local-channel");
  });

  it("validates image uploads and does not retain binary content in audit records", async () => {
    const client = await connect();
    const base64 = Buffer.from("test image bytes").toString("base64");
    expect((await tool(client, "upload_image", { input: { contentType: "image/png", base64 } })).body.status).toBe(503);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: "mcp.admin.requested" } });
    expect(audit.payload).toEqual({ tool: "upload_image", arguments: { contentType: "image/png", bytes: 16 } });
    expect(JSON.stringify(audit.payload)).not.toContain(base64);
    expect((await tool(client, "upload_image", { input: { contentType: "text/html", base64 } })).body.status).toBe(400);
    expect((await tool(client, "upload_image", { input: { contentType: "image/png", base64: "invalid!" } })).body.status).toBe(400);
    storageConfigured = true;
    const upload = await tool(client, "upload_image", { input: { contentType: "image/png", base64 } });
    expect(upload.body).toEqual({ status: 200, data: {
      key: "submissions/guild-test/test-image.png", url: "https://storage.example.com/submissions/guild-test/test-image.png",
    } });
    expect(storedImages.get(upload.body.data.key)?.toString()).toBe("test image bytes");
  });

  it("allows administrators to change all capability rows and immediately enforces self-revocation", async () => {
    const client = await connect();
    const result = await tool(client, "replace_capabilities", { input: [] });
    expect(result.body.status).toBe(200);
    expect((await tool(client, "upsert_shop_item", { input: itemInput })).body.status).toBe(403);
    expect(await ctx.prisma.shopItem.count()).toBe(0);
    expect(await ctx.prisma.auditLog.count({ where: { action: "mcp.admin.completed", actorUserId: "staff-user" } })).toBe(1);
  });

  it("paginates ledger history and bounds the requested page size", async () => {
    const group = await ctx.services.groupService.upsert("guild-test", { displayName: "Orchids", roleId: "group-role", aliases: [], active: true });
    for (const pointsDelta of [11, 7, 19]) {
      await ctx.services.economyService.awardGroups({
        guildId: "guild-test", actor: { userId: "system", roleIds: [] }, targetGroupIds: [group.id],
        pointsDelta, currencyDelta: 0, description: `Reward ${pointsDelta}`, systemAction: true,
      });
    }
    const client = await connect();
    const first = (await tool(client, "get_ledger", { query: { limit: 2 } })).body.data;
    expect(first.entries.map((entry: { description: string }) => entry.description)).toEqual(["Reward 19", "Reward 7"]);
    const second = (await tool(client, "get_ledger", { query: { limit: 2, cursor: first.nextCursor } })).body.data;
    expect(second.entries.map((entry: { description: string }) => entry.description)).toEqual(["Reward 11"]);
    expect(second.nextCursor).toBeNull();
    for (const limit of [0, 101, 1.5]) {
      expect((await client.callTool({ name: "get_ledger", arguments: { query: { limit } } })).isError).toBe(true);
    }
  });

  it("fails closed after guild selection changes, membership removal or logout", async () => {
    const wrongGuild = await connect({ guildId: "guild-other" });
    expect((await tool(wrongGuild, "get_leaderboard")).body.status).toBe(409);
    expect((await tool(wrongGuild, "upsert_shop_item", { input: itemInput })).body.status).toBe(409);
    const client = await connect();
    memberPresent = false;
    expect((await tool(client, "upsert_shop_item", { input: itemInput })).body.status).toBe(401);
    memberPresent = true;
    expect((await tool(client, "get_leaderboard")).body.status).toBe(401);
    const invalid = await connect({ session: "0".repeat(48) });
    expect((await tool(invalid, "get_leaderboard")).body.status).toBe(401);
    expect(await ctx.prisma.shopItem.count()).toBe(0);
  });

  it("revokes an active MCP client when its dashboard session logs out", async () => {
    const client = await connect();
    expect((await tool(client, "get_leaderboard")).body.status).toBe(200);
    await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: `dashboard_session=${session}` } });
    expect((await tool(client, "get_leaderboard")).body.status).toBe(401);
  });

  it("rejects unsafe URL origins and malformed credentials before connecting", () => {
    for (const url of ["http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com/?secret=value", "file:///tmp/app"]) {
      expect(() => createMcpServer({ appUrl: url, session, guildId: "guild-test" })).toThrow();
    }
    expect(() => createMcpServer({ appUrl, session: `${session}; injected=value`, guildId: "guild-test" })).toThrow();
  });
});
