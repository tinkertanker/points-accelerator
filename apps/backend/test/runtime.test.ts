import { REST } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BotRuntime } from "../src/bot/runtime.js";
import { loadEnv } from "../src/config/env.js";

function createRuntimeFixture() {
  const env = loadEnv({
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/points_accelerator_test",
    GUILD_ID: "guild-test",
    ADMIN_TOKEN: "test-admin-token",
    PORT: 1,
    MESSAGE_REWARD_COOLDOWN_SECONDS: 1,
  });

  const config = {
    currencyName: "bananas",
    currencySymbol: "💲",
    groupPointsPerCurrencyDonation: {
      toNumber: () => 10,
    },
    mentorRoleIds: [],
    passiveCooldownSeconds: 120,
    pointsName: "blorgshj",
    pointsSymbol: "🏅",
    allowGrouplessEarning: true,
  };
  const services = {
    prisma: {
      $transaction: vi.fn(async (callback: (tx: object) => Promise<unknown>) => callback({})),
    },
    configService: {
      getOrCreate: vi.fn().mockResolvedValue(config),
    },
    groupService: {
      resolveGroupFromRoleIds: vi
        .fn()
        .mockResolvedValue({ id: "group-1", displayName: "Gryffindor", roleId: "group-role" }),
      findGroupFromRoleIds: vi
        .fn()
        .mockResolvedValue({ id: "group-1", displayName: "Gryffindor", roleId: "group-role" }),
      resolveGroupByIdentifier: vi
        .fn()
        .mockResolvedValue({ id: "group-1", displayName: "Gryffindor", roleId: "group-role" }),
    },
    economyService: {
      getLeaderboard: vi.fn().mockResolvedValue([]),
      getLedger: vi.fn().mockResolvedValue([]),
      rewardPassiveMessage: vi.fn().mockResolvedValue({ id: "entry-1" }),
      getGroupBalance: vi.fn().mockResolvedValue({ pointsBalance: 12, currencyBalance: 0 }),
      awardGroups: vi.fn().mockResolvedValue({ id: "ledger-1" }),
      donateParticipantCurrencyToGroupPoints: vi.fn().mockResolvedValue({ groupPointsAward: 20 }),
    },
    goFundMeService: {
      setActiveCampaign: vi.fn().mockResolvedValue({
        id: "campaign-1",
        guildId: "guild-test",
        title: "Pizza Fund",
        goalPoints: 100,
        donatedPoints: 25,
        donationCount: 1,
        progress: 0.25,
        active: true,
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
        updatedAt: new Date("2026-04-01T12:00:00.000Z"),
        recentDonations: [],
      }),
      getActiveSummary: vi.fn().mockResolvedValue({
        id: "campaign-1",
        guildId: "guild-test",
        title: "Pizza Fund",
        goalPoints: 100,
        donatedPoints: 25,
        donationCount: 1,
        progress: 0.25,
        active: true,
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
        updatedAt: new Date("2026-04-01T12:00:00.000Z"),
        recentDonations: [],
      }),
      getActiveLeaderboard: vi.fn().mockResolvedValue({
        campaign: {
          id: "campaign-1",
          guildId: "guild-test",
          title: "Pizza Fund",
          goalPoints: 100,
        },
        donatedPoints: 35,
        donationCount: 2,
        entries: [
          {
            rank: 1,
            participant: {
              id: "participant-1",
              discordUserId: "user-1",
              discordUsername: "alice-user",
              indexId: "alice",
            },
            group: { id: "group-1", displayName: "Gryffindor", roleId: "group-role" },
            totalDonated: 35,
            donationCount: 2,
            lastDonatedAt: new Date("2026-04-01T12:00:00.000Z"),
          },
        ],
      }),
      donatePersonalCurrency: vi.fn().mockResolvedValue({
        donation: { id: "donation-1", amount: 10 },
        currencyEntry: { id: "currency-2" },
        summary: {
          id: "campaign-1",
          guildId: "guild-test",
          title: "Pizza Fund",
          goalPoints: 100,
          donatedPoints: 35,
          donationCount: 2,
          progress: 0.35,
          active: true,
          createdAt: new Date("2026-04-01T12:00:00.000Z"),
          updatedAt: new Date("2026-04-01T12:00:00.000Z"),
          recentDonations: [],
        },
      }),
    },
    roleCapabilityService: {
      listForRoleIds: vi.fn().mockResolvedValue([]),
    },
    shopService: {
      list: vi.fn().mockResolvedValue([]),
      redeem: vi
        .fn()
        .mockResolvedValue({
          id: "redemption-12345678",
          approvals: [],
          approvalThreshold: 2,
          quantity: 1,
          shopItem: { name: "Bubble Tea" },
        }),
      setApprovalMessage: vi.fn().mockResolvedValue(undefined),
      approveGroupPurchase: vi.fn().mockResolvedValue({ executed: false, approvalsCount: 1, threshold: 2 }),
      getRedemption: vi.fn().mockResolvedValue(null),
      listPersonalRedemptionsByUser: vi.fn().mockResolvedValue([]),
      listGroupRedemptionsByGroup: vi.fn().mockResolvedValue([]),
    },
    participantService: {
      findByDiscordUser: vi.fn(),
      getCurrencyLeaderboard: vi.fn().mockResolvedValue([]),
      ensureForGroup: vi.fn().mockResolvedValue({
        id: "participant-1",
        indexId: "AUTOUSER1",
        discordUsername: "Alice",
        groupId: "group-1",
        group: { id: "group-1", displayName: "Gryffindor", slug: "gryffindor" },
      }),
      ensureParticipant: vi.fn().mockResolvedValue({
        id: "participant-1",
        indexId: "AUTOUSER1",
        discordUsername: "Alice",
        groupId: "group-1",
        group: { id: "group-1", displayName: "Gryffindor", slug: "gryffindor" },
      }),
    },
    participantCurrencyService: {
      getParticipantBalance: vi.fn().mockResolvedValue(7),
      transferCurrency: vi.fn().mockResolvedValue({ id: "entry-1" }),
      awardParticipants: vi.fn().mockResolvedValue({ id: "entry-3" }),
    },
    bettingService: {
      placeBet: vi.fn().mockResolvedValue({ won: true, amount: 1, newCurrencyBalance: 8 }),
      getStats: vi.fn().mockResolvedValue({
        totalBets: 1,
        wins: 1,
        losses: 0,
        totalWon: 1,
        totalLost: 0,
        netGain: 1,
      }),
    },
    listingService: {
      create: vi.fn().mockResolvedValue({ title: "Listing" }),
    },
    submissionService: {
      create: vi.fn(),
      createOrReplace: vi.fn(),
      findForParticipantAssignment: vi.fn().mockResolvedValue(null),
      listAssignmentIdsForParticipant: vi.fn().mockResolvedValue(new Set<string>()),
      list: vi.fn().mockResolvedValue([]),
      getCompletionSummary: vi.fn().mockResolvedValue([]),
      resolveIdentifier: vi.fn(),
      review: vi.fn(),
    },
    assignmentService: {
      listActive: vi.fn().mockResolvedValue([]),
    },
    luckyDrawService: {
      create: vi.fn(),
      attachMessage: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue(null),
      countEntries: vi.fn().mockResolvedValue(0),
      listEntrants: vi.fn().mockResolvedValue([]),
      recordEntry: vi.fn().mockResolvedValue({ id: "entry-1" }),
      listResumable: vi.fn().mockResolvedValue([]),
      settle: vi.fn(),
    },
    sanctionService: {
      assertNotSanctioned: vi.fn().mockResolvedValue(undefined),
      getActiveFlags: vi.fn().mockResolvedValue(new Set()),
      getActiveFlagsByDiscordUserId: vi.fn().mockResolvedValue(new Set()),
    },
    channelGuardService: {
      check: vi.fn().mockResolvedValue({ ok: true, penaltyApplied: 0 }),
      allowsActivity: vi.fn().mockReturnValue(true),
    },
  };
  const storageService = {
    isConfigured: false,
    upload: vi.fn(),
    delete: vi.fn(),
  };

  return {
    config,
    runtime: new BotRuntime(env, services as never, storageService as never),
    services,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bot runtime", () => {
  it("uses the saved passive cooldown for message rewards", async () => {
    const { config, runtime, services } = createRuntimeFixture();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(61_000);

    await (runtime as any).handlePassiveMessage({
      memberId: "user-1",
      roleIds: ["role-1"],
      userId: "user-1",
      username: "Alice",
      messageId: "message-1",
      content: "hello world",
      channelId: "channel-1",
    });
    await (runtime as any).handlePassiveMessage({
      memberId: "user-1",
      roleIds: ["role-1"],
      userId: "user-1",
      username: "Alice",
      messageId: "message-2",
      content: "hello again",
      channelId: "channel-1",
    });

    expect(services.economyService.rewardPassiveMessage).toHaveBeenCalledTimes(1);
    expect(services.economyService.rewardPassiveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
      }),
    );
  });

  it("rewards group-less members with personal currency when the toggle is on", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.groupService.findGroupFromRoleIds.mockResolvedValue(null);
    services.participantService.ensureParticipant.mockResolvedValue({
      id: "participant-9",
      indexId: "AUTOUSER9",
      discordUsername: "Nomad",
      groupId: null,
      group: null,
    });

    await (runtime as any).handlePassiveMessage({
      guildId: "guild-test",
      memberId: "user-9",
      roleIds: ["role-unmapped"],
      userId: "user-9",
      username: "Nomad",
      messageId: "message-9",
      content: "hello without a group",
      channelId: "channel-1",
    });

    expect(services.participantService.ensureParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: null }),
    );
    expect(services.economyService.rewardPassiveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: null, participantId: "participant-9" }),
    );
  });

  it("skips group-less earning when the toggle is off", async () => {
    const { config, runtime, services } = createRuntimeFixture();
    config.allowGrouplessEarning = false;
    services.groupService.findGroupFromRoleIds.mockResolvedValue(null);

    await (runtime as any).handlePassiveMessage({
      guildId: "guild-test",
      memberId: "user-9",
      roleIds: ["role-unmapped"],
      userId: "user-9",
      username: "Nomad",
      messageId: "message-9",
      content: "hello without a group",
      channelId: "channel-1",
    });

    expect(services.participantService.ensureParticipant).not.toHaveBeenCalled();
    expect(services.economyService.rewardPassiveMessage).not.toHaveBeenCalled();
  });

  it("propagates a real group lookup failure instead of earning as group-less", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.groupService.findGroupFromRoleIds.mockRejectedValue(new Error("db down"));

    await expect(
      (runtime as any).handlePassiveMessage({
        guildId: "guild-test",
        memberId: "user-1",
        roleIds: ["role-1"],
        userId: "user-1",
        username: "Alice",
        messageId: "message-3",
        content: "hello world",
        channelId: "channel-1",
      }),
    ).rejects.toThrow("db down");

    expect(services.economyService.rewardPassiveMessage).not.toHaveBeenCalled();
  });

  it("orders member role ids by Discord hierarchy before resolving a group", () => {
    const { runtime } = createRuntimeFixture();

    const roleIds = (runtime as any).getOrderedRoleIds({
      roles: {
        cache: new Map([
          ["role-low", { id: "role-low", rawPosition: 1 }],
          ["role-high", { id: "role-high", rawPosition: 20 }],
          ["role-mid", { id: "role-mid", rawPosition: 10 }],
        ]),
      },
    });

    expect(roleIds).toEqual(["role-high", "role-mid", "role-low"]);
  });

  it("renders /store personal as an embed without exposing raw shop item ids", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.shopService.list.mockResolvedValue([
      {
        id: "shop-item-1234567890",
        enabled: true,
        name: "Bubble Tea",
        audience: "INDIVIDUAL",
        stock: null,
        cost: {
          toString: () => "3",
        },
      },
      {
        id: "group-item-0987654321",
        enabled: true,
        name: "Pizza Party",
        audience: "GROUP",
        stock: null,
        cost: {
          toString: () => "500",
        },
      },
    ]);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "store",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {
        getSubcommand: () => "personal",
      },
      reply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    const call = reply.mock.calls[0][0];
    expect(call.ephemeral).toBe(true);
    expect(call.embeds).toHaveLength(1);
    const embed = call.embeds[0].data;
    expect(embed.title).toBe("Personal store");
    const rendered = JSON.stringify(embed);
    expect(rendered).not.toContain("shop-item-1234567890");
    expect(rendered).not.toContain("group-item-0987654321");
    expect(rendered).toContain("Bubble Tea");
    expect(rendered).not.toContain("Pizza Party");
  });

  it("renders /store group with only group items", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.shopService.list.mockResolvedValue([
      {
        id: "shop-item-1234567890",
        enabled: true,
        name: "Bubble Tea",
        audience: "INDIVIDUAL",
        stock: null,
        cost: { toString: () => "3" },
      },
      {
        id: "group-item-0987654321",
        enabled: true,
        name: "Pizza Party",
        audience: "GROUP",
        stock: null,
        cost: { toString: () => "500" },
      },
    ]);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "store",
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      options: { getSubcommand: () => "group" },
      reply,
      user: { id: "user-1", username: "Alice" },
    });

    const call = reply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.title).toBe("Group store");
    const rendered = JSON.stringify(embed);
    expect(rendered).toContain("Pizza Party");
    expect(rendered).not.toContain("Bubble Tea");
  });

  it("renders the first ledger page with a Next button when more entries exist", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.economyService.getLedger.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => ({
        id: `entry-${index + 1}`,
        type: "MANUAL_AWARD",
        description: `Entry ${index + 1}`,
        createdAt: "2026-04-01T12:00:00.000Z",
        splits: [
          {
            id: `split-${index + 1}`,
            group: { displayName: "Gryffindor" },
            pointsDelta: 5,
            currencyDelta: 0,
          },
        ],
      })),
    );
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "ledger",
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      options: {},
      reply,
      user: { id: "user-1", username: "Alice" },
    });

    expect(services.economyService.getLedger).toHaveBeenCalledWith("guild-test", {
      limit: 11,
      offset: 0,
    });
    const call = reply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.title).toBe("Transaction ledger");
    expect(embed.description).toContain("Page 1");
    expect(embed.fields).toHaveLength(10);
    expect(embed.fields[0].name).toContain("#1");
    const row = call.components?.[0]?.toJSON();
    expect(row).toBeDefined();
    const buttons = row.components;
    expect(buttons).toHaveLength(2);
    expect(buttons[0].label).toBe("Prev");
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].label).toBe("Next");
    expect(buttons[1].disabled).toBe(false);
    expect(buttons[1].custom_id).toBe("v1:page:ledger:-:user-1:2");
  });

  it("handles pagination button clicks by re-fetching the next ledger page", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.economyService.getLedger.mockResolvedValue([
      {
        id: "entry-11",
        type: "MANUAL_AWARD",
        description: "Answered the toughest warm-up question",
        createdAt: "2026-04-01T12:00:00.000Z",
        splits: [
          {
            id: "split-11",
            group: { displayName: "Gryffindor" },
            pointsDelta: 5,
            currencyDelta: 0,
          },
        ],
      },
    ]);
    const deferUpdate = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handlePaginationButton({
      guildId: "guild-test",
      customId: "v1:page:ledger:-:user-1:2",
      message: { flags: { has: () => false } },
      user: { id: "user-1", username: "Alice" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      deferUpdate,
      editReply,
      reply,
    });

    expect(services.economyService.getLedger).toHaveBeenCalledWith("guild-test", {
      limit: 11,
      offset: 10,
    });
    expect(reply).not.toHaveBeenCalled();
    expect(deferUpdate).toHaveBeenCalledTimes(1);
    const call = editReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.description).toContain("Page 2");
    expect(embed.fields[0].name).toContain("#11");
    expect(embed.fields[0].value).toContain("Answered the toughest warm-up question");
  });

  it("rejects pagination button clicks from non-invokers on public messages", async () => {
    const { runtime, services } = createRuntimeFixture();
    const deferUpdate = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handlePaginationButton({
      guildId: "guild-test",
      customId: "v1:page:ledger:-:owner-1:2",
      message: { flags: { has: () => false } },
      user: { id: "stranger-1", username: "Stranger" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      deferUpdate,
      editReply,
      reply,
    });

    expect(services.economyService.getLedger).not.toHaveBeenCalled();
    expect(deferUpdate).not.toHaveBeenCalled();
    expect(editReply).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/only the person who ran/i),
        ephemeral: true,
      }),
    );
  });

  it("skips the owner check when paginating an ephemeral-source message", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.shopService.listPersonalRedemptionsByUser = vi.fn().mockResolvedValue([]);
    const deferUpdate = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handlePaginationButton({
      guildId: "guild-test",
      customId: "v1:page:inventory:personal:owner-1:1",
      message: { flags: { has: (flag: number) => flag === 64 } },
      user: { id: "owner-1", username: "Owner" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      deferUpdate,
      editReply,
      reply,
    });

    expect(reply).not.toHaveBeenCalled();
    expect(deferUpdate).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledTimes(1);
  });

  it("defers the interaction before running DB work on the pagination path", async () => {
    const { runtime, services } = createRuntimeFixture();
    const callOrder: string[] = [];
    const deferUpdate = vi.fn(async () => {
      callOrder.push("deferUpdate");
    });
    services.economyService.getLedger.mockImplementationOnce(async () => {
      callOrder.push("getLedger");
      return [];
    });

    await (runtime as any).handlePaginationButton({
      guildId: "guild-test",
      customId: "v1:page:ledger:-:user-1:1",
      message: { flags: { has: () => false } },
      user: { id: "user-1", username: "Alice" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      deferUpdate,
      editReply: vi.fn(),
      reply: vi.fn(),
    });

    expect(callOrder[0]).toBe("deferUpdate");
    expect(callOrder).toContain("getLedger");
  });

  it("falls back to page 1 when a stale ledger button lands past the last page", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.economyService.getLedger
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "entry-fresh",
          type: "MANUAL_AWARD",
          description: "Back at page 1",
          createdAt: "2026-04-01T12:00:00.000Z",
          splits: [
            {
              id: "split-fresh",
              group: { displayName: "Gryffindor" },
              pointsDelta: 5,
              currencyDelta: 0,
            },
          ],
        },
      ]);
    const editReply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handlePaginationButton({
      guildId: "guild-test",
      customId: "v1:page:ledger:-:user-1:5",
      message: { flags: { has: () => false } },
      user: { id: "user-1", username: "Alice" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply,
      reply: vi.fn(),
    });

    expect(services.economyService.getLedger).toHaveBeenNthCalledWith(1, "guild-test", {
      limit: 11,
      offset: 40,
    });
    expect(services.economyService.getLedger).toHaveBeenNthCalledWith(2, "guild-test", {
      limit: 11,
      offset: 0,
    });
    const embed = editReply.mock.calls[0][0].embeds[0].data;
    expect(embed.description).toContain("Page 1");
    expect(embed.fields[0].name).toContain("#1");
  });

  it("queries /inventory group by the invoker's active group, not by requester id", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.shopService.listGroupRedemptionsByGroup = vi.fn().mockResolvedValue([
      {
        id: "redemption-from-teammate",
        status: "FULFILLED",
        purchaseMode: "GROUP",
        quantity: 1,
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
        totalCost: { toString: () => "500" },
        shopItem: { name: "Pizza Party", emoji: "🍕" },
      },
    ]);
    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async () => ({
      displayName: "Alice Jones",
      roles: {
        cache: new Map([["group-role", { id: "group-role", rawPosition: 1 }]]),
      },
    }));

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "inventory",
      guild: { members: { fetch: fetchMember } },
      options: { getSubcommand: () => "group" },
      reply,
      user: { id: "user-1", username: "Alice" },
    });

    expect(services.groupService.resolveGroupFromRoleIds).toHaveBeenCalledWith(
      "guild-test",
      ["group-role"],
    );
    expect(services.shopService.listGroupRedemptionsByGroup).toHaveBeenCalledWith("guild-test", "group-1");
    expect(services.shopService.listPersonalRedemptionsByUser).not.toHaveBeenCalled();
    const embed = reply.mock.calls[0][0].embeds[0].data;
    expect(embed.title).toContain("group purchases");
    expect(JSON.stringify(embed)).toContain("Pizza Party");
  });

  it("keeps ledger entry field values within Discord's 1024 character limit", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.economyService.getLedger.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `entry-${index + 1}`,
        type: "MANUAL_AWARD",
        description:
          "Awarded for consistently helping other tables, finishing every checkpoint, and writing up the clearest recap note of the day. ".repeat(
            5,
          ),
        createdAt: "2026-04-01T12:00:00.000Z",
        splits: [
          {
            id: `split-a-${index + 1}`,
            group: { displayName: "Gryffindor" },
            pointsDelta: 5,
            currencyDelta: 0,
          },
          {
            id: `split-b-${index + 1}`,
            group: { displayName: "Hufflepuff" },
            pointsDelta: 0,
            currencyDelta: 3,
          },
        ],
      })),
    );
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "ledger",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {},
      reply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    const call = reply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.fields).toHaveLength(10);
    for (const field of embed.fields) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
    const longDescriptionField = embed.fields.find((f: { value: string }) => f.value.includes("..."));
    expect(longDescriptionField).toBeDefined();
  });

  it("mentions the selected student in /award currency replies for member currency awards", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.ensureForGroup.mockResolvedValue({
      id: "participant-2",
      indexId: "dffrffcrc67",
      discordUsername: null,
      groupId: "group-1",
      group: { id: "group-1", displayName: "Gryffindor", slug: "gryffindor" },
    });
    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId: string) => {
      if (userId === "staff-1") {
        return {
          roles: { cache: new Map([["staff-role", {}]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      if (userId === "student-1") {
        return {
          displayName: "Alex Carter",
          roles: { cache: new Map([["group-role", {}]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      return null;
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "award",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {
        getSubcommand: () => "currency",
        getNumber: vi.fn((name: string) => (name === "amount" ? 100 : null)),
        getUser: vi.fn((name: string) =>
          name === "member"
            ? {
                id: "student-1",
                username: "discord-user",
                globalName: "Alex Carter",
              }
            : null,
        ),
        getString: vi.fn().mockReturnValue("Great work"),
      },
      reply,
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    });

    expect(services.participantCurrencyService.awardParticipants).toHaveBeenCalledWith({
      guildId: "guild-test",
      actor: {
        userId: "staff-1",
        username: "Mentor",
        roleIds: ["staff-role"],
      },
      targetParticipantIds: ["participant-2"],
      currencyDelta: 100,
      description: "Great work",
    });
    expect(reply).toHaveBeenCalledWith("Awarded 100 bananas 💲 to <@student-1>. Reason: Great work");
  });

  it("mentions both students in /transfer replies", async () => {
    const { runtime } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId: string) => {
      if (userId === "user-1") {
        return {
          displayName: "Alice Jones",
          roles: { cache: new Map([["group-role", { id: "group-role", rawPosition: 1 }]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      if (userId === "student-2") {
        return {
          displayName: "Ben Taylor",
          roles: { cache: new Map([["group-role", { id: "group-role", rawPosition: 1 }]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      return null;
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "transfer",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {
        getNumber: vi.fn((name: string) => (name === "amount" ? 5 : null)),
        getUser: vi.fn((name: string) =>
          name === "member"
            ? {
                id: "student-2",
                username: "ben-user",
                globalName: "Ben Taylor",
              }
            : null,
        ),
      },
      reply,
      user: {
        id: "user-1",
        username: "alice-user",
      },
    });

    expect(reply).toHaveBeenCalledWith("<@user-1> transferred 5 bananas 💲 to <@student-2>.");
  });

  it("rejects /transfer to a bot recipient before provisioning a wallet", async () => {
    const { runtime, services } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);

    await expect(
      (runtime as any).handleCommand({
        guildId: "guild-test",
        commandName: "transfer",
        guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
        options: {
          getNumber: vi.fn((name: string) => (name === "amount" ? 5 : null)),
          getUser: vi.fn((name: string) =>
            name === "member" ? { id: "bot-1", username: "helper-bot", bot: true } : null,
          ),
        },
        reply,
        user: { id: "user-1", username: "alice-user" },
      }),
    ).rejects.toThrow("You can't transfer currency to a bot.");

    expect(services.participantService.ensureParticipant).not.toHaveBeenCalled();
    expect(services.participantCurrencyService.transferCurrency).not.toHaveBeenCalled();
  });

  it("mentions the student and group in /donate replies", async () => {
    const { runtime } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "donate",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            displayName: "Alice Jones",
            roles: { cache: new Map([["group-role", { id: "group-role", rawPosition: 1 }]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          }),
        },
      },
      options: {
        getNumber: vi.fn((name: string) => (name === "amount" ? 3 : null)),
      },
      reply,
      user: {
        id: "user-1",
        username: "alice-user",
      },
    });

    expect(reply).toHaveBeenCalledWith("<@user-1> donated 3 bananas 💲 to <@&group-role>, adding 20 blorgshj 🏅.");
  });

  it("lets admins set the active GoFundMe goal", async () => {
    const { runtime, services } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "gofundme",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            displayName: "Admin",
            roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 1 }]]) },
            permissions: { has: vi.fn().mockReturnValue(true) },
          }),
        },
      },
      options: {
        getSubcommand: () => "set",
        getNumber: vi.fn((name: string) => (name === "goal" ? 100 : null)),
        getString: vi.fn((name: string) => (name === "title" ? "Pizza Fund" : null)),
      },
      reply,
      user: {
        id: "admin-1",
        username: "mentor",
      },
    });

    expect(services.goFundMeService.setActiveCampaign).toHaveBeenCalledWith({
      guildId: "guild-test",
      actor: {
        userId: "admin-1",
        username: "mentor",
        roleIds: ["staff-role"],
      },
      title: "Pizza Fund",
      goalPoints: 100,
    });
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "GoFundMe goal set to 100 bananas 💲.",
      }),
    );
    const embed = reply.mock.calls[0][0].embeds[0].data;
    expect(embed.description).toContain("🟥🟥🟥🟧⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛");
  });

  it("shows display names for mentioned users in the GoFundMe title", async () => {
    const { runtime, services } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);
    services.goFundMeService.getActiveSummary.mockResolvedValueOnce({
      id: "campaign-1",
      guildId: "guild-test",
      title: "help <@529197897774923797> recover",
      goalPoints: 100,
      donatedPoints: 0,
      donationCount: 0,
      progress: 0,
      active: true,
      createdAt: new Date("2026-04-01T12:00:00.000Z"),
      updatedAt: new Date("2026-04-01T12:00:00.000Z"),
      recentDonations: [],
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "gofundme",
      guild: {
        members: {
          fetch: vi.fn(async (userId: string) => ({
            displayName: userId === "529197897774923797" ? "jiachen (2018)" : "Viewer",
            roles: { cache: new Map() },
            permissions: { has: vi.fn().mockReturnValue(false) },
          })),
        },
      },
      options: {
        getSubcommand: () => "status",
      },
      reply,
      user: {
        id: "user-1",
        username: "viewer",
      },
    });

    const embed = reply.mock.calls[0][0].embeds[0].data;
    expect(embed.title).toBe("GoFundMe: help jiachen (2018) recover");
  });

  it("shows the GoFundMe donation leaderboard", async () => {
    const { runtime, services } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "gofundme",
      guild: {
        members: {
          fetch: vi.fn(async (userId: string) => ({
            displayName: userId === "user-1" ? "Alice Jones" : "Viewer",
            roles: { cache: new Map() },
            permissions: { has: vi.fn().mockReturnValue(false) },
          })),
        },
      },
      options: {
        getSubcommand: () => "leaderboard",
      },
      reply,
      user: {
        id: "viewer-1",
        username: "viewer",
      },
    });

    expect(services.goFundMeService.getActiveLeaderboard).toHaveBeenCalledWith("guild-test");
    const embed = reply.mock.calls[0][0].embeds[0].data;
    expect(embed.title).toBe("GoFundMe Donor Leaderboard: Pizza Fund");
    expect(embed.description).toContain("🥇 **<@user-1>**");
    expect(embed.description).toContain("35 bananas 💲 · 2 donations");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Top donors", value: "1" }),
        expect.objectContaining({ name: "Total donated", value: "35 bananas 💲" }),
      ]),
    );
  });

  it("donates personal points to GoFundMe from the caller's wallet", async () => {
    const { runtime, services } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "gofundme",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            displayName: "Alice Jones",
            roles: { cache: new Map([["group-role", { id: "group-role", rawPosition: 1 }]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          }),
        },
      },
      options: {
        getSubcommand: () => "donate",
        getNumber: vi.fn((name: string) => (name === "amount" ? 10 : null)),
      },
      reply,
      user: {
        id: "user-1",
        username: "alice-user",
      },
    });

    expect(services.goFundMeService.donatePersonalCurrency).toHaveBeenCalledWith({
      guildId: "guild-test",
      actor: {
        userId: "user-1",
        username: "alice-user",
        roleIds: ["group-role"],
      },
      participantId: "participant-1",
      groupId: "group-1",
      amount: 10,
      description: "alice-user donated 10 bananas 💲 from their wallet to GoFundMe",
    });
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<@user-1> donated 10 bananas 💲 from their wallet to GoFundMe.",
      }),
    );
    const embed = reply.mock.calls[0][0].embeds[0].data;
    expect(embed.description).toContain("🟥🟥🟥🟧🟧🟧⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛");
  });

  it("awards currency in bulk to eligible members across selected groups", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.groupService.resolveGroupByIdentifier.mockImplementation(async (_guildId: string, identifier: string) => {
      if (identifier === "gryff" || identifier === "<@&group-role>") {
        return { id: "group-1", displayName: "Gryffindor", roleId: "group-role" };
      }

      return null;
    });
    services.groupService.resolveGroupFromRoleIds.mockImplementation(async (_guildId: string, roleIds: string[]) => {
      if (roleIds.includes("group-role")) {
        return { id: "group-1", displayName: "Gryffindor", roleId: "group-role" };
      }

      throw new Error("group not found");
    });
    services.participantService.ensureForGroup.mockImplementation(
      async ({ discordUserId, discordUsername, groupId }: { discordUserId: string; discordUsername: string; groupId: string }) => ({
        id: `participant-${discordUserId}`,
        indexId: `IDX-${discordUserId}`,
        discordUsername,
        groupId,
        group: { id: groupId, displayName: "Gryffindor", slug: "gryffindor" },
      }),
    );
    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId?: string) => {
      if (userId === "staff-1") {
        return {
          roles: { cache: new Map([["staff-role", {}]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      if (userId) {
        return null;
      }

      return new Map([
        [
          "staff-1",
          {
            user: { id: "staff-1", username: "Mentor", bot: false },
            roles: { cache: new Map([["staff-role", {}]]) },
          },
        ],
        [
          "student-1",
          {
            displayName: "Alex Carter",
            user: { id: "student-1", username: "alex", bot: false },
            roles: { cache: new Map([["group-role", {}]]) },
          },
        ],
        [
          "student-2",
          {
            displayName: "Bailey Kim",
            user: { id: "student-2", username: "bailey", bot: false },
            roles: { cache: new Map([["group-role", {}]]) },
          },
        ],
        [
          "student-bot",
          {
            user: { id: "student-bot", username: "helper-bot", bot: true },
            roles: { cache: new Map([["group-role", {}]]) },
          },
        ],
      ]);
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "award",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {
        getSubcommand: () => "currencygroup",
        getNumber: vi.fn((name: string) => (name === "amount" ? 15 : null)),
        getString: vi.fn((name: string) => (name === "targets" ? "gryff" : "Team effort")),
      },
      reply,
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    });

    expect(services.participantCurrencyService.awardParticipants).toHaveBeenCalledWith({
      guildId: "guild-test",
      actor: {
        userId: "staff-1",
        username: "Mentor",
        roleIds: ["staff-role"],
      },
      targetParticipantIds: ["participant-student-1", "participant-student-2"],
      currencyDelta: 15,
      description: "Team effort",
      executor: {},
    });
    expect(reply).toHaveBeenCalledWith("Awarded 15 bananas 💲 each to 2 members across <@&group-role> (2). Reason: Team effort");
  });

  describe("/award currencybulk", () => {
    function setupCurrencyBulkFixture() {
      const fixture = createRuntimeFixture();
      const { services } = fixture;
      services.groupService.resolveGroupFromRoleIds.mockImplementation(async (_guildId: string, roleIds: string[]) => {
        if (roleIds.includes("group-role")) {
          return { id: "group-1", displayName: "Gryffindor", roleId: "group-role" };
        }
        return { id: "group-0", displayName: "Staff", roleId: "staff-role" };
      });
      services.participantService.ensureForGroup.mockImplementation(
        async ({ discordUserId, discordUsername, groupId }: { discordUserId: string; discordUsername: string; groupId: string }) => ({
          id: `participant-${discordUserId}`,
          indexId: `IDX-${discordUserId}`,
          discordUsername,
          groupId,
          group: { id: groupId, displayName: "Gryffindor", slug: "gryffindor" },
        }),
      );
      return fixture;
    }

    it("awards currency to each listed member", async () => {
      const { runtime, services } = setupCurrencyBulkFixture();
      const reply = vi.fn().mockResolvedValue(undefined);
      const fetchMember = vi.fn(async (userId: string) => {
        if (userId === "staff-1") {
          return {
            roles: { cache: new Map([["staff-role", {}]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          };
        }
        if (userId === "111111111111111111") {
          return {
            displayName: "Alex",
            user: { id: "111111111111111111", username: "alex", globalName: "Alex Carter" },
            roles: { cache: new Map([["group-role", {}]]) },
          };
        }
        if (userId === "222222222222222222") {
          return {
            displayName: "Bailey",
            user: { id: "222222222222222222", username: "bailey", globalName: "Bailey Kim" },
            roles: { cache: new Map([["group-role", {}]]) },
          };
        }
        if (userId === "333333333333333333") {
          return {
            displayName: "Casey",
            user: { id: "333333333333333333", username: "casey", globalName: "Casey Lim" },
            roles: { cache: new Map([["group-role", {}]]) },
          };
        }
        return null;
      });

      await (runtime as any).handleCommand({
        guildId: "guild-test",
        commandName: "award",
        guild: { members: { fetch: fetchMember } },
        options: {
          getSubcommand: () => "currencybulk",
          getNumber: vi.fn((name: string) => (name === "amount" ? 25 : null)),
          getString: vi.fn((name: string) => {
            if (name === "members") return "<@111111111111111111>, 222222222222222222 <@!333333333333333333>";
            return null;
          }),
        },
        reply,
        user: { id: "staff-1", username: "Mentor" },
      });

      expect(services.participantCurrencyService.awardParticipants).toHaveBeenCalledWith({
        guildId: "guild-test",
        actor: {
          userId: "staff-1",
          username: "Mentor",
          roleIds: ["staff-role"],
        },
        targetParticipantIds: [
          "participant-111111111111111111",
          "participant-222222222222222222",
          "participant-333333333333333333",
        ],
        currencyDelta: 25,
        description: "Manual award via Discord command",
      });
      expect(reply).toHaveBeenCalledWith(
        "Awarded 25 bananas 💲 each to <@111111111111111111>, <@222222222222222222>, <@333333333333333333>. Reason: Manual award via Discord command",
      );
    });

    it("rejects when more than 10 members are listed", async () => {
      const { runtime, services } = setupCurrencyBulkFixture();
      const ids = Array.from({ length: 11 }, (_, i) => `1${String(i).padStart(17, "0")}`);
      const fetchMember = vi.fn(async (userId: string) => {
        if (userId === "staff-1") {
          return {
            roles: { cache: new Map([["staff-role", {}]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          };
        }
        return null;
      });

      await expect(
        (runtime as any).handleCommand({
          guildId: "guild-test",
          commandName: "award",
          guild: { members: { fetch: fetchMember } },
          options: {
            getSubcommand: () => "currencybulk",
            getNumber: vi.fn((name: string) => (name === "amount" ? 5 : null)),
            getString: vi.fn((name: string) => (name === "members" ? ids.join(",") : null)),
          },
          reply: vi.fn(),
          user: { id: "staff-1", username: "Mentor" },
        }),
      ).rejects.toThrow(/up to 10 members/i);

      expect(services.participantCurrencyService.awardParticipants).not.toHaveBeenCalled();
    });

    it("rejects unparseable member tokens", async () => {
      const { runtime, services } = setupCurrencyBulkFixture();
      const fetchMember = vi.fn(async (userId: string) => {
        if (userId === "staff-1") {
          return {
            roles: { cache: new Map([["staff-role", {}]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          };
        }
        return null;
      });

      await expect(
        (runtime as any).handleCommand({
          guildId: "guild-test",
          commandName: "award",
          guild: { members: { fetch: fetchMember } },
          options: {
            getSubcommand: () => "currencybulk",
            getNumber: vi.fn((name: string) => (name === "amount" ? 10 : null)),
            getString: vi.fn((name: string) => (name === "members" ? "notanid alex@example.com" : null)),
          },
          reply: vi.fn(),
          user: { id: "staff-1", username: "Mentor" },
        }),
      ).rejects.toThrow(/could not parse/i);

      expect(services.participantCurrencyService.awardParticipants).not.toHaveBeenCalled();
    });

    it("rejects when a listed member is not in the server", async () => {
      const { runtime, services } = setupCurrencyBulkFixture();
      const fetchMember = vi.fn(async (userId: string) => {
        if (userId === "staff-1") {
          return {
            roles: { cache: new Map([["staff-role", {}]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          };
        }
        if (userId === "111111111111111111") {
          return {
            displayName: "Alex",
            user: { id: "111111111111111111", username: "alex", globalName: "Alex Carter" },
            roles: { cache: new Map([["group-role", {}]]) },
          };
        }
        return null;
      });

      await expect(
        (runtime as any).handleCommand({
          guildId: "guild-test",
          commandName: "award",
          guild: { members: { fetch: fetchMember } },
          options: {
            getSubcommand: () => "currencybulk",
            getNumber: vi.fn((name: string) => (name === "amount" ? 10 : null)),
            getString: vi.fn((name: string) =>
              name === "members" ? "<@111111111111111111>, <@999999999999999999>" : null,
            ),
          },
          reply: vi.fn(),
          user: { id: "staff-1", username: "Mentor" },
        }),
      ).rejects.toThrow(/not in this server.*999999999999999999/);

      expect(services.participantCurrencyService.awardParticipants).not.toHaveBeenCalled();
    });
  });

  it("echoes the reason in /award points replies for group awards", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.groupService.resolveGroupByIdentifier.mockImplementation(async (_guildId: string, identifier: string) => {
      if (identifier === "gryff") {
        return { id: "group-1", displayName: "Gryffindor", roleId: "group-role" };
      }

      return null;
    });
    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId: string) => {
      if (userId === "staff-1") {
        return {
          roles: { cache: new Map([["staff-role", {}]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      return null;
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "award",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {
        getSubcommand: () => "points",
        getNumber: vi.fn((name: string) => (name === "amount" ? 5 : null)),
        getString: vi.fn((name: string) => (name === "targets" ? "gryff" : "Helped another group")),
      },
      reply,
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    });

    expect(services.economyService.awardGroups).toHaveBeenCalledWith({
      guildId: "guild-test",
      actor: {
        userId: "staff-1",
        username: "Mentor",
        roleIds: ["staff-role"],
      },
      targetGroupIds: ["group-1"],
      pointsDelta: 5,
      currencyDelta: 0,
      description: "Helped another group",
      executor: {},
    });
    expect(reply).toHaveBeenCalledWith("Awarded 5 blorgshj 🏅 to <@&group-role>. Reason: Helped another group");
  });

  it("blocks repeated award commands during the configured role cooldown for non-admin members", async () => {
    const { runtime, services } = createRuntimeFixture();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(5_000);
    services.roleCapabilityService.listForRoleIds.mockResolvedValue([
      {
        canManageDashboard: false,
        canAward: true,
        maxAward: 1000,
        actionCooldownSeconds: 10,
        canDeduct: true,
        canMultiAward: true,
        canSell: false,
      },
    ]);

    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId: string) => {
      if (userId === "staff-1") {
        return {
          roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 10 }]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      if (userId === "student-1") {
        return {
          displayName: "Alex Carter",
          roles: { cache: new Map([["group-role", { id: "group-role", rawPosition: 1 }]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      return null;
    });

    const awardInteraction = {
      guildId: "guild-test",
      commandName: "award",
      guild: { members: { fetch: fetchMember } },
      options: {
        getSubcommand: () => "currency",
        getNumber: vi.fn((name: string) => (name === "amount" ? 25 : null)),
        getUser: vi.fn((name: string) =>
          name === "member"
            ? {
                id: "student-1",
                username: "discord-user",
                globalName: "Alex Carter",
              }
            : null,
        ),
        getString: vi.fn().mockReturnValue("Great work"),
      },
      reply,
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    };

    await (runtime as any).handleCommand(awardInteraction);

    await expect(
      (runtime as any).handleCommand({
        guildId: "guild-test",
        commandName: "award",
        guild: { members: { fetch: fetchMember } },
        options: {
          getSubcommand: () => "currency",
          getNumber: vi.fn((name: string) => (name === "amount" ? 25 : null)),
          getUser: vi.fn((name: string) =>
            name === "member"
              ? {
                  id: "student-1",
                  username: "discord-user",
                  globalName: "Alex Carter",
                }
              : null,
          ),
          getString: vi.fn().mockReturnValue("Great work"),
        },
        reply,
        user: {
          id: "staff-1",
          username: "Mentor",
        },
      }),
    ).rejects.toThrow(/wait 6s before using another award command/i);

    expect(services.participantCurrencyService.awardParticipants).toHaveBeenCalledTimes(1);
    expect(services.listingService.create).not.toHaveBeenCalled();
  });

  it("does not apply the award cooldown to unrelated commands", async () => {
    const { runtime, services } = createRuntimeFixture();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(5_000);
    services.roleCapabilityService.listForRoleIds.mockResolvedValue([
      {
        canManageDashboard: false,
        canAward: true,
        maxAward: 1000,
        actionCooldownSeconds: 10,
        canDeduct: true,
        canMultiAward: true,
        canSell: true,
      },
    ]);

    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId: string) => {
      if (userId === "staff-1") {
        return {
          roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 10 }]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      if (userId === "student-1") {
        return {
          displayName: "Alex Carter",
          roles: { cache: new Map([["group-role", { id: "group-role", rawPosition: 1 }]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      return null;
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "award",
      guild: { members: { fetch: fetchMember } },
      options: {
        getSubcommand: () => "currency",
        getNumber: vi.fn((name: string) => (name === "amount" ? 25 : null)),
        getUser: vi.fn((name: string) =>
          name === "member"
            ? {
                id: "student-1",
                username: "discord-user",
                globalName: "Alex Carter",
              }
            : null,
        ),
        getString: vi.fn().mockReturnValue("Great work"),
      },
      reply,
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "sell",
      guild: { members: { fetch: fetchMember } },
      options: {
        getString: vi.fn((name: string) => {
          if (name === "title") return "Sticker";
          if (name === "description") return "Limited run";
          return null;
        }),
        getInteger: vi.fn().mockReturnValue(null),
      },
      reply,
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    });

    expect(services.listingService.create).toHaveBeenCalledTimes(1);
  });

  it("lets dashboard admins bypass the role cooldown", async () => {
    const { runtime, services } = createRuntimeFixture();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(5_000);
    services.roleCapabilityService.listForRoleIds.mockResolvedValue([
      {
        canManageDashboard: true,
        canAward: true,
        maxAward: null,
        actionCooldownSeconds: 10,
        canDeduct: true,
        canMultiAward: true,
        canSell: true,
      },
    ]);

    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId: string) => {
      if (userId === "staff-1") {
        return {
          roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 10 }]]) },
          permissions: { has: vi.fn().mockReturnValue(false) },
        };
      }

      return null;
    });

    const awardInteraction = {
      guildId: "guild-test",
      commandName: "award",
      guild: { members: { fetch: fetchMember } },
      options: {
        getSubcommand: () => "currency",
        getNumber: vi.fn((name: string) => (name === "amount" ? 25 : null)),
        getUser: vi.fn((name: string) =>
          name === "member"
            ? {
                id: "staff-1",
                username: "Mentor",
                globalName: "Mentor",
              }
            : null,
        ),
        getString: vi.fn().mockReturnValue("Great work"),
      },
      reply,
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    };

    await (runtime as any).handleCommand(awardInteraction);
    await (runtime as any).handleCommand(awardInteraction);

    expect(services.participantCurrencyService.awardParticipants).toHaveBeenCalledTimes(2);
  });

  it("rejects /submissions for non-staff members", async () => {
    const { runtime } = createRuntimeFixture();

    await expect(
      (runtime as any).handleCommand({
        guildId: "guild-test",
        commandName: "submissions",
        guild: {
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: { cache: new Map([["student-role", {}]]) },
              permissions: { has: vi.fn().mockReturnValue(false) },
            }),
          },
        },
        options: {
          getString: vi.fn().mockReturnValue(null),
        },
        reply: vi.fn(),
        user: {
          id: "user-1",
          username: "Alice",
        },
      }),
    ).rejects.toThrow(/configured reviewer roles/i);
  });

  it("lets configured mentor roles review submissions from Discord", async () => {
    const { config, runtime, services } = createRuntimeFixture();
    config.mentorRoleIds = ["mentor-role"];
    services.roleCapabilityService.listForRoleIds.mockResolvedValue([]);
    services.submissionService.resolveIdentifier.mockResolvedValue({
      id: "submission-12345678",
      assignment: { title: "Reflection 1" },
      participant: { indexId: "S001", discordUsername: "student1" },
    });
    services.submissionService.review.mockResolvedValue({
      id: "submission-12345678",
      status: "APPROVED",
      assignment: { title: "Reflection 1" },
      participant: { indexId: "S001", discordUsername: "student1" },
    });
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "review_submission",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            roles: { cache: new Map([["mentor-role", { id: "mentor-role", rawPosition: 5 }]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          }),
        },
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === "submission_id") return "submissi";
          if (name === "decision") return "APPROVED";
          return null;
        }),
      },
      reply,
      user: {
        id: "mentor-1",
        username: "Mentor",
      },
    });

    expect(services.submissionService.review).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "submission-12345678",
        reviewedByUserId: "mentor-1",
      }),
    );
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("APPROVED") }));
  });

  it("reviews a submission from Discord using a short identifier", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.roleCapabilityService.listForRoleIds.mockResolvedValue([
      {
        canManageDashboard: true,
        canAward: false,
        maxAward: null,
        canDeduct: false,
        canMultiAward: false,
        canSell: false,
      },
    ]);
    services.submissionService.resolveIdentifier.mockResolvedValue({
      id: "submission-12345678",
      assignment: { title: "Reflection 1" },
      participant: { indexId: "S001", discordUsername: "student1" },
    });
    services.submissionService.review.mockResolvedValue({
      id: "submission-12345678",
      status: "APPROVED",
      assignment: { title: "Reflection 1" },
      participant: { indexId: "S001", discordUsername: "student1" },
    });
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "review_submission",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            roles: { cache: new Map([["staff-role", {}]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          }),
        },
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === "submission_id") return "submissi";
          if (name === "decision") return "APPROVED";
          if (name === "note") return "Nicely done";
          return null;
        }),
      },
      reply,
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    });

    expect(services.submissionService.resolveIdentifier).toHaveBeenCalledWith("guild-test", "submissi");
    expect(services.submissionService.review).toHaveBeenCalledWith({
      guildId: "guild-test",
      submissionId: "submission-12345678",
      status: "APPROVED",
      reviewNote: "Nicely done",
      reviewedByUserId: "staff-1",
      reviewedByUsername: "Mentor",
    });
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("APPROVED"),
      }),
    );
  });

  it("reviews a submission as outstanding from the feed channel button", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.roleCapabilityService.listForRoleIds.mockResolvedValue([
      {
        canManageDashboard: true,
        canAward: false,
        maxAward: null,
        canDeduct: false,
        canMultiAward: false,
        canSell: false,
      },
    ]);
    services.submissionService.review.mockResolvedValue({
      id: "submission-12345678",
      status: "OUTSTANDING",
      pointsAwarded: 13,
      currencyAwarded: 7,
      assignment: { title: "Reflection 1" },
      participant: { indexId: "S001", discordUsername: "student1" },
    });

    const deferUpdate = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleSubmissionButton({
      guildId: "guild-test",
      customId: "submission:outstanding:submission-12345678",
      deferUpdate,
      editReply,
      followUp,
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 1 }]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          }),
        },
      },
      member: null,
      message: { content: "Original submission card" },
      user: {
        id: "staff-1",
        username: "Mentor",
      },
    });

    expect(deferUpdate).toHaveBeenCalled();
    expect(services.submissionService.review).toHaveBeenCalledWith({
      guildId: "guild-test",
      submissionId: "submission-12345678",
      status: "OUTSTANDING",
      reviewedByUserId: "staff-1",
      reviewedByUsername: "Mentor",
    });
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Outstanding by <@staff-1>"),
        components: [],
      }),
    );
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("+13 blorgshj 🏅 + 7 bananas 💲"),
      }),
    );
    expect(services.configService.getOrCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects ambiguous /submit assignment titles and asks for an assignment id", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.ensureForGroup.mockResolvedValue({
      id: "participant-1",
      indexId: "S001",
      groupId: "group-1",
      discordUsername: "Alice",
      group: { id: "group-1", displayName: "Gryffindor", slug: "gryffindor" },
    });
    services.assignmentService.listActive.mockResolvedValue([
      { id: "assign-11111111", title: "Reflection 1" },
      { id: "assign-22222222", title: "Reflection 1" },
    ]);

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "submit",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === "assignment") return "Reflection 1";
          if (name === "text") return "Here is my work";
          return null;
        }),
        getAttachment: vi.fn().mockReturnValue(null),
      },
      deferReply,
      editReply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(services.submissionService.create).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining('Multiple active assignments match "Reflection 1"'),
    );
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("assign-11111111"),
    );
  });

  it("shows a card-style /submit assignment not found response", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.ensureForGroup.mockResolvedValue({
      id: "participant-1",
      indexId: "S001",
      groupId: "group-1",
      discordUsername: "Alice",
      group: { id: "group-1", displayName: "Gryffindor", slug: "gryffindor" },
    });
    services.assignmentService.listActive.mockResolvedValue([
      {
        id: "assign-11111111",
        title: "Reflection 1",
        createdAt: new Date("2026-05-08T08:00:00Z"),
      },
      {
        id: "assign-22222222",
        title: "Demo Day",
        createdAt: new Date("2026-05-09T08:00:00Z"),
      },
    ]);

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "submit",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === "assignment") return "Missing Brief";
          if (name === "text") return "Here is my work";
          return null;
        }),
        getAttachment: vi.fn().mockReturnValue(null),
      },
      deferReply,
      editReply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(services.submissionService.create).not.toHaveBeenCalled();

    const [{ embeds }] = editReply.mock.calls[0] as [{ embeds: Array<{ toJSON(): Record<string, unknown> }> }];
    expect(embeds).toHaveLength(1);

    const embed = embeds[0]!.toJSON() as {
      title?: string;
      description?: string;
      fields?: Array<{ name: string; value: string }>;
      footer?: { text?: string };
    };

    expect(embed.title).toBe("Assignment Not Found");
    expect(embed.description).toContain("Missing Brief");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Available assignments",
          value: expect.stringContaining("Demo Day"),
        }),
        expect.objectContaining({
          name: "Assignments tracked",
          value: "2",
        }),
      ]),
    );
    expect(embed.fields?.[0]?.value).toContain("assign-22222222");
    expect(embed.fields?.[0]?.value.length).toBeLessThanOrEqual(1024);
    expect(embed.footer?.text).toContain("Copy an ID");
  });

  it("keeps long /submit assignment not found cards within Discord field limits", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.ensureForGroup.mockResolvedValue({
      id: "participant-1",
      indexId: "S001",
      groupId: "group-1",
      discordUsername: "Alice",
      group: { id: "group-1", displayName: "Gryffindor", slug: "gryffindor" },
    });
    services.assignmentService.listActive.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `assign-${String(index + 1).padStart(8, "0")}`,
        title: `Very long assignment title ${index + 1} ${"with detailed recovery text ".repeat(12)}`,
        createdAt: new Date(`2026-05-${String(index + 1).padStart(2, "0")}T08:00:00Z`),
      })),
    );

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "submit",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === "assignment") return "Missing Brief";
          if (name === "text") return "Here is my work";
          return null;
        }),
        getAttachment: vi.fn().mockReturnValue(null),
      },
      deferReply,
      editReply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    const [{ embeds }] = editReply.mock.calls[0] as [{ embeds: Array<{ toJSON(): Record<string, unknown> }> }];
    const embed = embeds[0]!.toJSON() as {
      fields?: Array<{ name: string; value: string }>;
    };

    expect(embed.fields?.[0]?.name).toBe("Available assignments");
    expect(embed.fields?.[0]?.value.length).toBeLessThanOrEqual(1024);
    expect(embed.fields?.[0]?.value).toContain("...");
    expect(services.submissionService.create).not.toHaveBeenCalled();
  });

  it("keeps long /submit assignment identifiers within Discord description limits", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.ensureForGroup.mockResolvedValue({
      id: "participant-1",
      indexId: "S001",
      groupId: "group-1",
      discordUsername: "Alice",
      group: { id: "group-1", displayName: "Gryffindor", slug: "gryffindor" },
    });
    services.assignmentService.listActive.mockResolvedValue([
      {
        id: "assign-11111111",
        title: "Reflection 1",
        createdAt: new Date("2026-05-08T08:00:00Z"),
      },
    ]);

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const longIdentifier = `Missing Brief ${"with a very long copied message ".repeat(180)}`;

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "submit",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === "assignment") return longIdentifier;
          if (name === "text") return "Here is my work";
          return null;
        }),
        getAttachment: vi.fn().mockReturnValue(null),
      },
      deferReply,
      editReply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    const [{ embeds }] = editReply.mock.calls[0] as [{ embeds: Array<{ toJSON(): Record<string, unknown> }> }];
    const embed = embeds[0]!.toJSON() as {
      description?: string;
    };

    expect(embed.description?.length).toBeLessThanOrEqual(4096);
    expect(embed.description).toContain("...");
    expect(services.submissionService.create).not.toHaveBeenCalled();
  });

  it("creates /submit payloads with note, link, video media, and group credit", async () => {
    const { runtime, services } = createRuntimeFixture();
    const studentUserId = "111111111111111111";
    services.assignmentService.listActive.mockResolvedValue([
      {
        id: "assign-1",
        title: "Video Demo",
        description: "Submit your demo.",
        basePointsReward: 5,
        baseCurrencyReward: 2,
        bonusPointsReward: 0,
        bonusCurrencyReward: 0,
        createdAt: new Date("2026-05-08T08:00:00Z"),
        sortOrder: 0,
      },
    ]);
    services.submissionService.create.mockResolvedValue({
      id: "submission-12345678",
      assignment: { title: "Video Demo" },
      group: { displayName: "Gryffindor" },
      participant: { discordUsername: "Alice" },
      imageUrl: "https://cdn.example.test/sample-submission-video.mp4",
    });
    const broadcast = vi.spyOn(runtime as any, "broadcastSubmissionToFeed").mockResolvedValue(undefined);

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const deleteReply = vi.fn().mockResolvedValue(undefined);
    const channelSend = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "submit",
      channel: {
        isTextBased: () => true,
        send: channelSend,
      },
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === "assignment") return "Video Demo";
          if (name === "note") return "Here is my walkthrough.";
          if (name === "link") return "code.tk.sg";
          return null;
        }),
        getAttachment: vi.fn((name: string) =>
          name === "media"
            ? {
                contentType: "video/mp4",
                size: 1024,
                url: "https://cdn.example.test/sample-submission-video.mp4",
              }
            : null,
        ),
      },
      deferReply,
      editReply,
      followUp,
      deleteReply,
      user: {
        id: studentUserId,
        username: "Alice",
      },
    });

    expect(services.submissionService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Here is my walkthrough.\n\nLink: https://code.tk.sg/",
        imageUrl: "https://cdn.example.test/sample-submission-video.mp4",
      }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        groupName: "Gryffindor",
        text: "Here is my walkthrough.\n\nLink: https://code.tk.sg/",
        imageUrl: "https://cdn.example.test/sample-submission-video.mp4",
      }),
    );
    expect(followUp).not.toHaveBeenCalled();
    expect(channelSend).toHaveBeenCalledWith({
      content: `<@${studentUserId}> Submission received for **Video Demo** (Gryffindor). It will be reviewed by an admin.`,
      allowedMentions: { parse: [], users: [studentUserId] },
    });
    expect(deleteReply).toHaveBeenCalledTimes(1);
  });

  it("posts submission feed media as a Discord attachment with tidy fallback link and review buttons", async () => {
    const { runtime } = createRuntimeFixture();
    const send = vi.fn().mockResolvedValue({ id: "message-1", channelId: "submissions-channel" });
    (runtime as any).client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          send,
        }),
      },
    };

    await (runtime as any).postSubmissionFeedEntry({
      channelId: "submissions-channel",
      submissionId: "submission-12345678",
      studentUserId: "111111111111111111",
      studentDisplay: "Alice",
      assignmentTitle: "1a",
      groupName: "7am",
      text: "Here is my walkthrough.",
      imageUrl: "https://pub-a465f2.r2.dev/submissions/guild-test/sample-video.mp4",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.content).toBeUndefined();
    expect(payload.files).toEqual([
      {
        attachment: "https://pub-a465f2.r2.dev/submissions/guild-test/sample-video.mp4",
        name: "sample-video.mp4",
      },
    ]);
    expect(payload.allowedMentions).toEqual({ parse: [], users: ["111111111111111111"] });
    const embed = payload.embeds[0].toJSON();
    expect(embed.fields).toContainEqual(expect.objectContaining({
      name: "Media",
      value: "[Submission file](https://pub-a465f2.r2.dev/submissions/guild-test/sample-video.mp4)",
    }));
    const buttons = payload.components[0].components.map((button: { data: { custom_id: string; label: string } }) => button.data);
    expect(buttons).toEqual([
      expect.objectContaining({ custom_id: "submission:approve:submission-12345678", label: "Accept" }),
      expect.objectContaining({ custom_id: "submission:outstanding:submission-12345678", label: "Outstanding" }),
      expect.objectContaining({ custom_id: "submission:reject:submission-12345678", label: "Reject" }),
    ]);
  });

  it("falls back to a link-only submission feed entry when Discord cannot attach media", async () => {
    const { runtime } = createRuntimeFixture();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("R2 fetch failed"))
      .mockResolvedValueOnce({ id: "message-1", channelId: "submissions-channel" });
    (runtime as any).client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          send,
        }),
      },
    };

    const posted = await (runtime as any).postSubmissionFeedEntry({
      channelId: "submissions-channel",
      submissionId: "submission-12345678",
      studentUserId: "111111111111111111",
      studentDisplay: "Alice",
      assignmentTitle: "1a",
      groupName: "7am",
      text: "Here is my walkthrough.",
      imageUrl: "https://pub-a465f2.r2.dev/submissions/guild-test/sample-video.mp4",
    });

    expect(posted).toEqual({ channelId: "submissions-channel", messageId: "message-1" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].files).toEqual([
      {
        attachment: "https://pub-a465f2.r2.dev/submissions/guild-test/sample-video.mp4",
        name: "sample-video.mp4",
      },
    ]);
    expect(send.mock.calls[1][0].files).toBeUndefined();
    expect(send.mock.calls[1][0].allowedMentions).toEqual({ parse: [], users: ["111111111111111111"] });
    const fallbackEmbed = send.mock.calls[1][0].embeds[0].toJSON();
    expect(fallbackEmbed.fields).toContainEqual(expect.objectContaining({
      name: "Media",
      value: "[Submission file](https://pub-a465f2.r2.dev/submissions/guild-test/sample-video.mp4)",
    }));
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to attach submission media; posting link-only feed entry",
      expect.objectContaining({
        submissionId: "submission-12345678",
        channelId: "submissions-channel",
      }),
    );
  });

  it("shows /assignments publicly as a newest-first paginated embed", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.findByDiscordUser.mockResolvedValue({
      id: "participant-1",
      discordUserId: "user-1",
      discordUsername: "Alice",
    });
    services.submissionService.listAssignmentIdsForParticipant.mockResolvedValue(new Set(["assign-11"]));
    services.assignmentService.listActive.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => ({
        id: `assign-${index + 1}`,
        title: `Task ${index + 1}`,
        description: `Prompt ${index + 1}`,
        basePointsReward: index + 1,
        baseCurrencyReward: 0,
        bonusPointsReward: 0,
        bonusCurrencyReward: 0,
        deadline: null,
        createdAt: new Date(`2026-05-${String(index + 1).padStart(2, "0")}T08:00:00Z`),
        sortOrder: index,
        submissionCount: index,
      })),
    );

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "assignments",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {},
      deferReply,
      editReply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(deferReply).toHaveBeenCalledWith();
    const [{ embeds, components }] = editReply.mock.calls[0] as [
      { embeds: Array<{ toJSON(): Record<string, unknown> }>; components: unknown[] },
    ];
    const embed = embeds[0]!.toJSON() as {
      title?: string;
      description?: string;
      fields?: Array<{ name: string; value: string }>;
      footer?: { text?: string };
    };
    expect(embed.title).toBe("Active Assignments");
    expect(embed.description).toContain("11 active assignments, newest first");
    expect(embed.fields?.[0]?.name).toBe("📝 Task 11");
    expect(embed.fields?.[0]?.value).toContain("✅ Submitted");
    expect(embed.fields?.[0]?.value).toContain("10 submitted");
    expect(embed.footer?.text).toContain("page 1/2");
    expect(components).toHaveLength(1);
  });

  it("asks for confirmation before replacing a reply-based submission", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.ensureForGroup.mockResolvedValue({
      id: "participant-1",
      indexId: "S001",
      groupId: "group-1",
      discordUsername: "student1",
      group: { id: "group-1", displayName: "Gryffindor", slug: "gryffindor" },
    });
    services.assignmentService.listActive.mockResolvedValue([
      { id: "assign-1", title: "Reply Task" },
    ]);
    services.submissionService.findForParticipantAssignment.mockResolvedValue({
      id: "existing-submission",
      status: "PENDING",
    });
    services.submissionService.createOrReplace.mockResolvedValue({
      replaced: true,
      previousImageKey: "submissions/guild-test/old-image.png",
      submission: {
        assignment: { title: "Reply Task" },
      },
    });

    const deleteObject = vi.fn().mockResolvedValue(undefined);
    (runtime as any).storageService = {
      isConfigured: true,
      upload: vi.fn(),
      delete: deleteObject,
    };
    (runtime as any).client = {
      user: { id: "bot-1" },
    };

    const reply = vi.fn().mockResolvedValue(undefined);
    await (runtime as any).handleReplySubmission({
      reference: { messageId: "message-original" },
      channel: {
        messages: {
          fetch: vi.fn().mockResolvedValue({
            author: { id: "user-1" },
            content: "Original submission notes",
            attachments: [],
          }),
        },
      },
      author: { id: "user-1" },
      member: {
        roles: { cache: new Map([["group-role", {}]]) },
      },
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            roles: { cache: new Map([["group-role", {}]]) },
          }),
        },
      },
      content: "<@bot-1> submit assign-1",
      attachments: [],
      reply,
    });

    expect(services.submissionService.createOrReplace).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Replace your last submission?"),
        components: expect.any(Array),
      }),
    );
  });

  it("replaces a pending submission after confirmation", async () => {
    const { runtime, services } = createRuntimeFixture();
    const studentUserId = "111111111111111111";
    services.submissionService.createOrReplace.mockResolvedValue({
      replaced: true,
      previousImageKey: "submissions/guild-test/old-image.png",
      previousFeedChannelId: "submissions-channel",
      previousFeedMessageId: "feed-message-1",
      submission: {
        id: "submission-2",
        imageUrl: undefined,
        assignment: { title: "Reply Task" },
        group: { displayName: "Gryffindor" },
      },
    });
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    (runtime as any).storageService = {
      isConfigured: true,
      upload: vi.fn(),
      delete: deleteObject,
    };
    const deleteFeed = vi.spyOn(runtime as any, "deleteSubmissionFeedMessage").mockResolvedValue(undefined);
    const broadcast = vi.spyOn(runtime as any, "broadcastSubmissionToFeed").mockResolvedValue(undefined);
    (runtime as any).pendingSubmissionReplacements.set("token-1", {
      createdAt: Date.now(),
      userId: studentUserId,
      guildId: "guild-test",
      assignmentId: "assign-1",
      participantId: "participant-1",
      text: "Latest notes",
      imageUrl: undefined,
      imageKey: undefined,
      studentDisplay: "student1",
    });

    const deferUpdate = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleSubmissionReplacementButton(
      {
        user: { id: studentUserId },
        deferUpdate,
        editReply,
        followUp,
      },
      "replace",
      "token-1",
    );

    expect(services.submissionService.createOrReplace).toHaveBeenCalledWith({
      guildId: "guild-test",
      assignmentId: "assign-1",
      participantId: "participant-1",
      text: "Latest notes",
      imageUrl: undefined,
      imageKey: undefined,
    });
    expect(deleteObject).toHaveBeenCalledWith("submissions/guild-test/old-image.png");
    expect(deleteFeed).toHaveBeenCalledWith({
      channelId: "submissions-channel",
      messageId: "feed-message-1",
    });
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        groupName: "Gryffindor",
        text: "Latest notes",
      }),
    );
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Submission replacement confirmed.",
        components: [],
      }),
    );
    expect(followUp).toHaveBeenCalledWith({
      content: `<@${studentUserId}> Submission updated for **Reply Task** (Gryffindor). It will be reviewed by an admin.`,
      allowedMentions: { parse: [], users: [studentUserId] },
    });
  });

  it("replies with a default message for direct bot mentions outside submission handling", async () => {
    const { runtime } = createRuntimeFixture();
    (runtime as any).client = {
      user: { id: "bot-1" },
    };

    const reply = vi.fn().mockResolvedValue(undefined);
    const handled = await (runtime as any).handleBotMention({
      reference: null,
      mentions: {
        has: vi.fn().mockReturnValue(true),
      },
      reply,
    });

    expect(handled).toBe(true);
    expect(reply).toHaveBeenCalledWith("I am a helpful points bot.");
  });

  it("shows balance without requiring manual registration", async () => {
    const { runtime, services } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "balance",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            roles: { cache: new Map([["group-role", {}]]) },
          }),
        },
      },
      options: {},
      reply,
      user: {
        id: "user-1",
        username: "Alice",
        displayAvatarURL: vi.fn().mockReturnValue("https://cdn.discordapp.com/embed/avatars/0.png"),
      },
    });

    expect(services.participantService.ensureParticipant).toHaveBeenCalledWith({
      guildId: "guild-test",
      discordUserId: "user-1",
      discordUsername: "Alice",
      groupId: "group-1",
    });

    const [{ embeds, ephemeral }] = reply.mock.calls[0] as [
      { embeds: Array<{ toJSON(): Record<string, unknown> }>; ephemeral: boolean },
    ];
    expect(ephemeral).toBe(true);
    expect(embeds).toHaveLength(1);

    const embed = embeds[0]!.toJSON() as {
      title?: string;
      fields?: Array<{ name: string; value: string }>;
    };
    expect(embed.title).toBe("Your Balance");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Group blorgshj",
          value: expect.stringContaining("Gryffindor"),
        }),
        expect.objectContaining({
          name: "Wallet bananas",
          value: expect.stringContaining("7 bananas 💲"),
        }),
      ]),
    );
    const groupField = embed.fields?.find((field) => field.name === "Group blorgshj");
    expect(groupField?.value).toContain("12 blorgshj 🏅");
  });

  it("shows the group leaderboard in an embed card", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.economyService.getLeaderboard.mockResolvedValue([
      { id: "group-1", displayName: "Gryffindor", pointsBalance: 12 },
      { id: "group-2", displayName: "Ravenclaw", pointsBalance: 7 },
      { id: "group-3", displayName: "Hufflepuff", pointsBalance: 6 },
      { id: "group-4", displayName: "Slytherin", pointsBalance: 5 },
      { id: "group-5", displayName: "Durmstrang", pointsBalance: 4 },
    ]);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn().mockResolvedValue({
      roles: { cache: new Map([["group-role", {}]]) },
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "leaderboard",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {},
      deferReply,
      editReply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(services.economyService.getLeaderboard).toHaveBeenCalledWith("guild-test");
    expect(deferReply).toHaveBeenCalledWith();
    expect(fetchMember).not.toHaveBeenCalled();

    const [{ embeds }] = editReply.mock.calls[0] as [{ embeds: Array<{ toJSON(): Record<string, unknown> }> }];
    expect(embeds).toHaveLength(1);

    const embed = embeds[0]!.toJSON() as {
      title?: string;
      description?: string;
      fields?: Array<{ name: string; value: string }>;
    };

    expect(embed.title).toBe("Group Leaderboard");
    expect(embed.description).toContain("5 groups ranked by shared blorgshj");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Standings",
          value: expect.stringContaining("🥇 **Gryffindor**"),
        }),
        expect.objectContaining({
          name: "Also ranked",
          value: expect.stringContaining("#5 **Durmstrang**"),
        }),
        expect.objectContaining({
          name: "Total in play",
          value: "34 blorgshj 🏅",
        }),
      ]),
    );
  });

  it("shows the personal wallet leaderboard in Discord", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.getCurrencyLeaderboard.mockResolvedValue([
      {
        id: "participant-2",
        discordUserId: "student-2",
        discordUsername: "Bob",
        indexId: "S002",
        currencyBalance: 9,
      },
      {
        id: "participant-1",
        discordUserId: "student-1",
        discordUsername: null,
        indexId: "S001",
        currencyBalance: 7,
      },
      {
        id: "participant-3",
        discordUserId: "student-3",
        discordUsername: "Charlie",
        indexId: "S003",
        currencyBalance: 6,
      },
      {
        id: "participant-4",
        discordUserId: "student-4",
        discordUsername: "Delta",
        indexId: "S004",
        currencyBalance: 5,
      },
      {
        id: "participant-5",
        discordUserId: "student-5",
        discordUsername: "Echo",
        indexId: "S005",
        currencyBalance: 4,
      },
    ]);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId: string) => {
      if (userId === "student-2") {
        return {
          displayName: "Bobby Tables",
          user: { globalName: "Bob" },
        };
      }

      if (userId === "student-1") {
        return null;
      }

      if (userId === "student-3") {
        return {
          displayName: "Charlie",
          user: { globalName: "Charlie" },
        };
      }

      if (userId === "student-4") {
        return {
          displayName: "Delta",
          user: { globalName: "Delta" },
        };
      }

      if (userId === "student-5") {
        return {
          displayName: "Echo",
          user: { globalName: "Echo" },
        };
      }

      return null;
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "forbes",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {},
      deferReply,
      editReply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(services.participantService.getCurrencyLeaderboard).toHaveBeenCalledWith("guild-test");
    expect(deferReply).toHaveBeenCalledWith();

    const [{ embeds }] = editReply.mock.calls[0] as [{ embeds: Array<{ toJSON(): Record<string, unknown> }> }];
    expect(embeds).toHaveLength(1);

    const embed = embeds[0]!.toJSON() as {
      title?: string;
      description?: string;
      fields?: Array<{ name: string; value: string }>;
      footer?: { text?: string };
    };

    expect(embed.title).toBe("Forbes Wallet Board");
    expect(embed.description).toContain("5 participants ranked by wallet bananas");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Standings",
          value: expect.stringContaining("🥇 **<@student-2>**"),
        }),
        expect.objectContaining({
          name: "Standings",
          value: expect.stringContaining("🥈 **<@student-1>**"),
        }),
        expect.objectContaining({
          name: "Also ranked",
          value: expect.stringContaining("#5 **<@student-5>**"),
        }),
        expect.objectContaining({
          name: "Total held",
          value: "31 bananas 💲",
        }),
      ]),
    );
    expect(embed.footer?.text).toContain("Server display names");
  });

  it("only resolves display names for the visible Forbes ranks", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.participantService.getCurrencyLeaderboard.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        id: `participant-${index + 1}`,
        discordUserId: `student-${index + 1}`,
        discordUsername: `User ${index + 1}`,
        indexId: `S${String(index + 1).padStart(3, "0")}`,
        currencyBalance: 120 - index,
      })),
    );
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const fetchMember = vi.fn(async (userId: string) => ({
      displayName: `Display ${userId}`,
      user: { globalName: `Display ${userId}` },
    }));

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "forbes",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {},
      deferReply,
      editReply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(deferReply).toHaveBeenCalledWith();
    expect(fetchMember).toHaveBeenCalledTimes(10);
    expect(fetchMember).not.toHaveBeenCalledWith("student-11");
    expect(fetchMember).not.toHaveBeenCalledWith("student-12");
  });

  it("creates a group purchase from /buy group", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.groupService.resolveGroupFromRoleIds.mockImplementation(async (_guildId: string, roleIds: string[]) => {
      if (roleIds.includes("other-group-role")) {
        throw new Error("multiple groups");
      }

      return { id: "group-1", displayName: "Gryffindor", roleId: "group-role" };
    });
    services.shopService.redeem.mockResolvedValue({
      id: "redemption-12345678",
      approvals: [{}],
      approvalThreshold: 2,
      quantity: 2,
      shopItem: { name: "Bubble Tea" },
    });
    const reply = vi.fn().mockResolvedValue(undefined);
    const postListingSpy = vi.spyOn(runtime, "postListing").mockResolvedValue({
      channelId: "channel-announce",
      messageId: "message-1",
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "buy",
      channelId: "channel-current",
      guild: {
        members: {
          fetch: vi.fn((userId?: string) => {
            if (userId) {
              return Promise.resolve({
                roles: { cache: new Map([["group-role", {}]]) },
              });
            }

            return Promise.resolve(
              new Map([
                [
                  "user-1",
                  {
                    user: { id: "user-1", username: "Alice", bot: false },
                    roles: { cache: new Map([["group-role", {}]]) },
                  },
                ],
                [
                  "user-2",
                  {
                    user: { id: "user-2", username: "Bob", bot: false },
                    roles: { cache: new Map([["group-role", {}]]) },
                  },
                ],
                [
                  "user-3",
                  {
                    user: { id: "user-3", username: "Charlie", bot: false },
                    roles: { cache: new Map([["group-role", {}], ["other-group-role", {}]]) },
                  },
                ],
              ]),
            );
          }),
        },
      },
      options: {
        getSubcommand: () => "group",
        getString: vi.fn((name: string) => (name === "item_id" ? "item-1" : null)),
        getInteger: vi.fn((name: string) => (name === "quantity" ? 2 : null)),
      },
      reply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(services.shopService.redeem).toHaveBeenCalledWith({
      guildId: "guild-test",
      participantId: "participant-1",
      shopItemId: "item-1",
      requestedByUserId: "user-1",
      requestedByUsername: "Alice",
      quantity: 2,
      purchaseMode: "GROUP",
      groupMemberCount: 2,
    });
    expect(services.participantService.ensureForGroup).toHaveBeenCalledTimes(3);
    expect(postListingSpy).toHaveBeenCalledWith(
      "channel-current",
      expect.stringContaining("from <@&group-role>, requested by <@user-1>"),
    );
    expect(postListingSpy).toHaveBeenCalledWith(
      "channel-current",
      expect.stringContaining("Request ID: `redemption-12345678`"),
    );
    expect(services.shopService.setApprovalMessage).toHaveBeenCalledWith({
      guildId: "guild-test",
      redemptionId: "redemption-12345678",
      channelId: "channel-announce",
      messageId: "message-1",
    });
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/<@&group-role>.*Request ID: redemption-12345678/),
      }),
    );
  });

  it("registers required award and deduct command options", async () => {
    const putSpy = vi.spyOn(REST.prototype, "put").mockResolvedValue({} as never);
    const { runtime } = createRuntimeFixture();
    (runtime as any).env.DISCORD_BOT_TOKEN = "bot-token";
    (runtime as any).env.DISCORD_APPLICATION_ID = "app-123";
    (runtime as any).env.DISCORD_GUILD_ID = "guild-123";

    await (runtime as any).registerCommands();

    expect(putSpy).toHaveBeenCalledTimes(1);
    const [, payload] = putSpy.mock.calls[0]!;
    const commands = payload.body as Array<{
      name: string;
      options?: Array<{
        name: string;
        type?: number;
        required?: boolean;
        min_value?: number;
        options?: Array<{ name: string; required?: boolean; min_value?: number }>;
      }>;
    }>;

    const awardCommand = commands.find((command) => command.name === "award");
    const deductCommand = commands.find((command) => command.name === "deduct");
    const forbesCommand = commands.find((command) => command.name === "forbes");
    const goFundMeCommand = commands.find((command) => command.name === "gofundme");
    const submitCommand = commands.find((command) => command.name === "submit");
    const kahootCommand = commands.find((command) => command.name === "kahoot");
    const flatAwardPoints = commands.find((command) => command.name === "awardpoints");
    const flatAwardMixed = commands.find((command) => command.name === "awardmixed");

    expect(forbesCommand).toEqual(expect.objectContaining({ name: "forbes" }));
    expect(flatAwardPoints).toBeUndefined();
    expect(flatAwardMixed).toBeUndefined();

    const awardPointsSub = awardCommand?.options?.find((option) => option.name === "points");
    const awardCurrencySub = awardCommand?.options?.find((option) => option.name === "currency");
    const awardCurrencyGroupSub = awardCommand?.options?.find((option) => option.name === "currencygroup");
    const deductMixedSub = deductCommand?.options?.find((option) => option.name === "mixed");
    const goFundMeSetSub = goFundMeCommand?.options?.find((option) => option.name === "set");
    const goFundMeDonateSub = goFundMeCommand?.options?.find((option) => option.name === "donate");
    const goFundMeLeaderboardSub = goFundMeCommand?.options?.find((option) => option.name === "leaderboard");

    expect(awardPointsSub?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "targets", required: true }),
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
    );
    expect(awardCurrencySub?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "member", required: true }),
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
    );
    expect(awardCurrencyGroupSub?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "targets", required: true }),
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
    );
    expect(awardCurrencyGroupSub?.options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "member" })]),
    );
    expect(deductMixedSub?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "targets", required: true }),
        expect.objectContaining({ name: "points", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "member", required: true }),
        expect.objectContaining({ name: "currency", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
    );
    expect(goFundMeSetSub?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "goal", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "title", required: false }),
      ]),
    );
    expect(goFundMeDonateSub?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
      ]),
    );
    expect(goFundMeLeaderboardSub).toEqual(expect.objectContaining({ name: "leaderboard" }));
    expect(submitCommand?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "assignment", required: true }),
        expect.objectContaining({ name: "note", required: false }),
        expect.objectContaining({ name: "link", required: false }),
        expect.objectContaining({ name: "media", required: false }),
      ]),
    );
    expect(kahootCommand?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "starting", required: true, min_value: 1 }),
        expect.objectContaining({ name: "quantum", required: true, min_value: 1 }),
        expect.objectContaining({ name: "winner1", required: true }),
        expect.objectContaining({ name: "winner5", required: false }),
      ]),
    );
  });

  it("recomputes group member count when approving a purchase", async () => {
    const { runtime, services } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);
    const fetchMembers = vi.fn((userId?: string) => {
      if (userId) {
        return Promise.resolve({
          roles: { cache: new Map([["group-role", {}]]) },
        });
      }

      return Promise.resolve(
        new Map([
          [
            "user-1",
            {
              user: { id: "user-1", username: "Alice", bot: false },
              roles: { cache: new Map([["group-role", {}]]) },
            },
          ],
          [
            "user-2",
            {
              user: { id: "user-2", username: "Bob", bot: false },
              roles: { cache: new Map([["group-role", {}]]) },
            },
          ],
        ]),
      );
    });

    await (runtime as any).handleCommand({
      guildId: "guild-test",
      commandName: "approve_purchase",
      guild: {
        members: {
          fetch: fetchMembers,
        },
      },
      options: {
        getString: vi.fn((name: string) => (name === "purchase_id" ? "redemption-12345678" : null)),
      },
      reply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(services.shopService.approveGroupPurchase).toHaveBeenCalledWith({
      guildId: "guild-test",
      redemptionId: "redemption-12345678",
      participantId: "participant-1",
      approvedByUserId: "user-1",
      approvedByUsername: "Alice",
      currentGroupMemberCount: 2,
      currentGroupMemberDiscordUserIds: ["user-1", "user-2"],
    });
  });

  describe("/kahoot", () => {
    function setupKahootFixture() {
      const fixture = createRuntimeFixture();
      const { services } = fixture;
      services.roleCapabilityService.listForRoleIds.mockResolvedValue([
        {
          canAward: true,
          canDeduct: true,
          canManageDashboard: false,
          canMultiAward: true,
          canSell: false,
          maxAward: null,
          actionCooldownSeconds: 0,
        },
      ]);
      services.groupService.resolveGroupFromRoleIds.mockImplementation(async (_guildId: string, roleIds: string[]) => {
        if (roleIds.includes("blue-role")) {
          return { id: "group-blue", displayName: "Blue", roleId: "blue-role" };
        }
        if (roleIds.includes("red-role")) {
          return { id: "group-red", displayName: "Red", roleId: "red-role" };
        }
        return { id: "group-staff", displayName: "Staff", roleId: "staff-role" };
      });
      return fixture;
    }

    it("awards staggered group points to ranked winners", async () => {
      const { runtime, services } = setupKahootFixture();
      const reply = vi.fn().mockResolvedValue(undefined);
      const fetchMember = vi.fn(async (userId: string) => {
        if (userId === "staff-1") {
          return {
            displayName: "Mentor",
            roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 10 }]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          };
        }
        if (userId === "winner-1") {
          return {
            displayName: "Alex",
            user: { id: "winner-1", username: "alex", globalName: "Alex Carter" },
            roles: { cache: new Map([["red-role", { id: "red-role", rawPosition: 1 }]]) },
          };
        }
        if (userId === "winner-2") {
          return {
            displayName: "Bailey",
            user: { id: "winner-2", username: "bailey", globalName: "Bailey Kim" },
            roles: { cache: new Map([["blue-role", { id: "blue-role", rawPosition: 1 }]]) },
          };
        }
        if (userId === "winner-3") {
          return {
            displayName: "Casey",
            user: { id: "winner-3", username: "casey", globalName: "Casey Lim" },
            roles: { cache: new Map([["red-role", { id: "red-role", rawPosition: 1 }]]) },
          };
        }
        return null;
      });

      await (runtime as any).handleCommand({
        guildId: "guild-test",
        commandName: "kahoot",
        guild: { members: { fetch: fetchMember } },
        channelId: "channel-1",
        options: {
          getInteger: vi.fn((name: string) => {
            if (name === "starting") return 10_000;
            if (name === "quantum") return 2_000;
            return null;
          }),
          getUser: vi.fn((name: string) => {
            if (name === "winner1") return { id: "winner-1", username: "alex", globalName: "Alex Carter" };
            if (name === "winner2") return { id: "winner-2", username: "bailey", globalName: "Bailey Kim" };
            if (name === "winner3") return { id: "winner-3", username: "casey", globalName: "Casey Lim" };
            return null;
          }),
        },
        reply,
        user: { id: "staff-1", username: "Mentor" },
      });

      expect(services.economyService.awardGroups).toHaveBeenNthCalledWith(1, {
        guildId: "guild-test",
        actor: { userId: "staff-1", username: "Mentor", roleIds: ["staff-role"] },
        targetGroupIds: ["group-red"],
        pointsDelta: 10_000,
        currencyDelta: 0,
        description: "Kahoot #1: Alex",
        executor: {},
      });
      expect(services.economyService.awardGroups).toHaveBeenNthCalledWith(2, {
        guildId: "guild-test",
        actor: { userId: "staff-1", username: "Mentor", roleIds: ["staff-role"] },
        targetGroupIds: ["group-blue"],
        pointsDelta: 8_000,
        currencyDelta: 0,
        description: "Kahoot #2: Bailey",
        executor: {},
      });
      expect(services.economyService.awardGroups).toHaveBeenNthCalledWith(3, {
        guildId: "guild-test",
        actor: { userId: "staff-1", username: "Mentor", roleIds: ["staff-role"] },
        targetGroupIds: ["group-red"],
        pointsDelta: 6_000,
        currencyDelta: 0,
        description: "Kahoot #3: Casey",
        executor: {},
      });
      expect(reply).toHaveBeenCalledWith(
        [
          "Kahoot awarded:",
          "#1 <@winner-1> earned 10000 blorgshj 🏅 for <@&red-role>",
          "#2 <@winner-2> earned 8000 blorgshj 🏅 for <@&blue-role>",
          "#3 <@winner-3> earned 6000 blorgshj 🏅 for <@&red-role>",
        ].join("\n"),
      );
    });

    it("rejects duplicate winners", async () => {
      const { runtime, services } = setupKahootFixture();
      const fetchMember = vi.fn(async () => ({
        roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 10 }]]) },
        permissions: { has: vi.fn().mockReturnValue(false) },
      }));

      await expect(
        (runtime as any).handleCommand({
          guildId: "guild-test",
          commandName: "kahoot",
          guild: { members: { fetch: fetchMember } },
          channelId: "channel-1",
          options: {
            getInteger: vi.fn((name: string) => (name === "starting" ? 100 : name === "quantum" ? 10 : null)),
            getUser: vi.fn((name: string) => {
              if (name === "winner1" || name === "winner2") {
                return { id: "winner-1", username: "alex", globalName: "Alex Carter" };
              }
              return null;
            }),
          },
          reply: vi.fn(),
          user: { id: "staff-1", username: "Mentor" },
        }),
      ).rejects.toThrow(/different member/i);

      expect(services.economyService.awardGroups).not.toHaveBeenCalled();
    });

    it("rejects total payouts above the caller's maxAward", async () => {
      const { runtime, services } = setupKahootFixture();
      services.roleCapabilityService.listForRoleIds.mockResolvedValue([
        {
          canAward: true,
          canDeduct: false,
          canManageDashboard: false,
          canMultiAward: true,
          canSell: false,
          maxAward: { toString: () => "15000" },
          actionCooldownSeconds: 0,
        },
      ]);
      const fetchMember = vi.fn(async (userId: string) => {
        if (userId === "staff-1") {
          return {
            roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 10 }]]) },
            permissions: { has: vi.fn().mockReturnValue(false) },
          };
        }
        return {
          displayName: userId,
          user: { id: userId, username: userId, globalName: userId },
          roles: { cache: new Map([["red-role", { id: "red-role", rawPosition: 1 }]]) },
        };
      });

      await expect(
        (runtime as any).handleCommand({
          guildId: "guild-test",
          commandName: "kahoot",
          guild: { members: { fetch: fetchMember } },
          channelId: "channel-1",
          options: {
            getInteger: vi.fn((name: string) => {
              if (name === "starting") return 10_000;
              if (name === "quantum") return 2_000;
              return null;
            }),
            getUser: vi.fn((name: string) => {
              if (name === "winner1") return { id: "winner-1", username: "winner-1", globalName: "winner-1" };
              if (name === "winner2") return { id: "winner-2", username: "winner-2", globalName: "winner-2" };
              return null;
            }),
          },
          reply: vi.fn(),
          user: { id: "staff-1", username: "Mentor" },
        }),
      ).rejects.toThrow(/total kahoot payout/i);

      expect(services.economyService.awardGroups).not.toHaveBeenCalled();
    });
  });

  describe("/luckydraw", () => {
    it("creates a draw, posts an announcement with two buttons, and replies ephemerally", async () => {
      const { runtime, services } = createRuntimeFixture();
      const drawRow = {
        id: "draw-1",
        guildId: "guild-test",
        channelId: "channel-1",
        messageId: null,
        createdByUserId: "staff-1",
        createdByUsername: "Mentor",
        description: null,
        prizeAmount: { toString: () => "25" } as never,
        winnerCount: 1,
        endsAt: new Date(Date.now() + 60_000),
        status: "ACTIVE" as const,
      };
      services.luckyDrawService.create.mockResolvedValue(drawRow);
      services.roleCapabilityService.listForRoleIds.mockResolvedValue([
        { canAward: true, canDeduct: true, canManageDashboard: false, canMultiAward: true, canSell: false, maxAward: null, actionCooldownSeconds: 0 },
      ]);

      const send = vi.fn().mockResolvedValue({ id: "msg-1", channelId: "channel-1" });
      const reply = vi.fn().mockResolvedValue(undefined);
      const fetchMember = vi.fn().mockResolvedValue({
        roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 5 }]]) },
        permissions: { has: vi.fn().mockReturnValue(false) },
      });

      await (runtime as any).handleCommand({
        guildId: "guild-test",
        commandName: "luckydraw",
        guild: { members: { fetch: fetchMember } },
        channel: { isTextBased: () => true, send },
        channelId: "channel-1",
        options: {
          getString: vi.fn((name: string) => (name === "duration" ? "5m" : null)),
          getInteger: vi.fn((name: string) => (name === "prize" ? 25 : null)),
        },
        reply,
        user: { id: "staff-1", username: "Mentor" },
      });

      expect(services.luckyDrawService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-test",
          channelId: "channel-1",
          createdByUserId: "staff-1",
          prizeAmount: 25,
          winnerCount: 1,
          durationMs: 5 * 60_000,
        }),
      );
      expect(send).toHaveBeenCalledTimes(1);
      const sendArgs = send.mock.calls[0][0];
      expect(sendArgs.embeds).toHaveLength(1);
      expect(sendArgs.components).toHaveLength(1);
      const buttons = sendArgs.components[0].components;
      expect(buttons[0].data.custom_id).toBe("luckydraw:enter:draw-1");
      expect(buttons[1].data.custom_id).toBe("luckydraw:entrants:draw-1");
      expect(services.luckyDrawService.attachMessage).toHaveBeenCalledWith("draw-1", "msg-1");
      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true, content: expect.stringContaining("Lucky draw started") }),
      );
    });

    it("rejects an unparseable duration without creating a draw", async () => {
      const { runtime, services } = createRuntimeFixture();
      services.roleCapabilityService.listForRoleIds.mockResolvedValue([
        { canAward: true, canDeduct: true, canManageDashboard: false, canMultiAward: true, canSell: false, maxAward: null, actionCooldownSeconds: 0 },
      ]);
      const fetchMember = vi.fn().mockResolvedValue({
        roles: { cache: new Map([["staff-role", { id: "staff-role", rawPosition: 5 }]]) },
        permissions: { has: vi.fn().mockReturnValue(false) },
      });

      await expect(
        (runtime as any).handleCommand({
          guildId: "guild-test",
          commandName: "luckydraw",
          guild: { members: { fetch: fetchMember } },
          channel: { isTextBased: () => true, send: vi.fn() },
          channelId: "channel-1",
          options: {
            getString: vi.fn((name: string) => (name === "duration" ? "forever" : null)),
            getInteger: vi.fn((name: string) => (name === "prize" ? 5 : null)),
          },
          reply: vi.fn(),
          user: { id: "staff-1", username: "Mentor" },
        }),
      ).rejects.toThrow(/duration/i);

      expect(services.luckyDrawService.create).not.toHaveBeenCalled();
    });

    it("rejects when total payout (prize × winners) exceeds the caller's maxAward", async () => {
      const { runtime, services } = createRuntimeFixture();
      services.roleCapabilityService.listForRoleIds.mockResolvedValue([
        { canAward: true, canDeduct: false, canManageDashboard: false, canMultiAward: true, canSell: false, maxAward: { toString: () => "100" }, actionCooldownSeconds: 0 },
      ]);
      const fetchMember = vi.fn().mockResolvedValue({
        roles: { cache: new Map([["mentor-role", { id: "mentor-role", rawPosition: 5 }]]) },
        permissions: { has: vi.fn().mockReturnValue(false) },
      });

      await expect(
        (runtime as any).handleCommand({
          guildId: "guild-test",
          commandName: "luckydraw",
          guild: { members: { fetch: fetchMember } },
          channel: { isTextBased: () => true, send: vi.fn() },
          channelId: "channel-1",
          options: {
            getString: vi.fn((name: string) => (name === "duration" ? "5m" : null)),
            getInteger: vi.fn((name: string) => {
              if (name === "prize") return 60;
              if (name === "winners") return 3;
              return null;
            }),
          },
          reply: vi.fn(),
          user: { id: "mentor-1", username: "Mentor" },
        }),
      ).rejects.toThrow(/maximum award/i);

      expect(services.luckyDrawService.create).not.toHaveBeenCalled();
    });

    it("rejects callers without canAward unless they're a guild admin", async () => {
      const { runtime, services } = createRuntimeFixture();
      services.roleCapabilityService.listForRoleIds.mockResolvedValue([
        { canAward: false, canDeduct: false, canManageDashboard: false, canMultiAward: false, canSell: false, maxAward: null, actionCooldownSeconds: 0 },
      ]);
      const fetchMember = vi.fn().mockResolvedValue({
        roles: { cache: new Map([["student-role", { id: "student-role", rawPosition: 1 }]]) },
        permissions: { has: vi.fn().mockReturnValue(false) },
      });

      await expect(
        (runtime as any).handleCommand({
          guildId: "guild-test",
          commandName: "luckydraw",
          guild: { members: { fetch: fetchMember } },
          channel: { isTextBased: () => true, send: vi.fn() },
          channelId: "channel-1",
          options: {
            getString: vi.fn((name: string) => (name === "duration" ? "5m" : null)),
            getInteger: vi.fn((name: string) => (name === "prize" ? 5 : null)),
          },
          reply: vi.fn(),
          user: { id: "student-1", username: "Student" },
        }),
      ).rejects.toThrow(/award capability/i);

      expect(services.luckyDrawService.create).not.toHaveBeenCalled();
    });

    it("Enter button records the entry, refreshes the count, and replies ephemerally", async () => {
      const { runtime, services } = createRuntimeFixture();
      services.luckyDrawService.findById.mockResolvedValue({
        id: "draw-1",
        channelId: "channel-1",
        messageId: "msg-1",
        description: null,
        prizeAmount: { toString: () => "25" } as never,
        winnerCount: 1,
        endsAt: new Date(Date.now() + 60_000),
        createdByUserId: "staff-1",
      });
      services.luckyDrawService.countEntries.mockResolvedValue(2);

      const deferReply = vi.fn().mockResolvedValue(undefined);
      const editReply = vi.fn().mockResolvedValue(undefined);
      await (runtime as any).handleLuckyDrawButton({
        customId: "luckydraw:enter:draw-1",
        member: { displayName: "Alice" },
        user: { id: "user-1", username: "alice" },
        deferReply,
        editReply,
      });

      expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(services.luckyDrawService.recordEntry).toHaveBeenCalledWith({
        drawId: "draw-1",
        userId: "user-1",
        username: "Alice",
      });
      expect(editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("2 entrants"),
        }),
      );
    });

    it("Who's-in button lists entrants ephemerally without pinging them", async () => {
      const { runtime, services } = createRuntimeFixture();
      services.luckyDrawService.listEntrants.mockResolvedValue([
        { id: "e1", userId: "user-1", username: "Alice" },
        { id: "e2", userId: "user-2", username: "Bob" },
      ]);

      const deferReply = vi.fn().mockResolvedValue(undefined);
      const editReply = vi.fn().mockResolvedValue(undefined);
      await (runtime as any).handleLuckyDrawButton({
        customId: "luckydraw:entrants:draw-1",
        user: { id: "staff-1" },
        deferReply,
        editReply,
      });

      expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedMentions: { parse: [] },
          content: expect.stringMatching(/Entrants \(2\):.*<@user-1>.*<@user-2>/s),
        }),
      );
    });
  });
});
