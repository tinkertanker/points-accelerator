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
    passiveCooldownSeconds: 120,
    pointsName: "blorgshj",
    pointsSymbol: "🏅",
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
      list: vi.fn().mockResolvedValue([]),
      getCompletionSummary: vi.fn().mockResolvedValue([]),
      resolveIdentifier: vi.fn(),
      review: vi.fn(),
    },
    assignmentService: {
      listActive: vi.fn().mockResolvedValue([]),
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
    const update = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handlePaginationButton({
      customId: "v1:page:ledger:-:user-1:2",
      message: { flags: { has: () => false } },
      user: { id: "user-1", username: "Alice" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      update,
      reply,
    });

    expect(services.economyService.getLedger).toHaveBeenCalledWith("guild-test", {
      limit: 11,
      offset: 10,
    });
    expect(reply).not.toHaveBeenCalled();
    const call = update.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.description).toContain("Page 2");
    expect(embed.fields[0].name).toContain("#11");
    expect(embed.fields[0].value).toContain("Answered the toughest warm-up question");
  });

  it("rejects pagination button clicks from non-invokers on public messages", async () => {
    const { runtime, services } = createRuntimeFixture();
    const update = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handlePaginationButton({
      customId: "v1:page:ledger:-:owner-1:2",
      message: { flags: { has: () => false } },
      user: { id: "stranger-1", username: "Stranger" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      update,
      reply,
    });

    expect(services.economyService.getLedger).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
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
    const update = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handlePaginationButton({
      customId: "v1:page:inventory:personal:owner-1:1",
      message: { flags: { has: (flag: number) => flag === 64 } },
      user: { id: "owner-1", username: "Owner" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      update,
      reply,
    });

    expect(reply).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
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
    const update = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handlePaginationButton({
      customId: "v1:page:ledger:-:user-1:5",
      message: { flags: { has: () => false } },
      user: { id: "user-1", username: "Alice" },
      guild: { members: { fetch: vi.fn().mockResolvedValue(null) } },
      update,
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
    const embed = update.mock.calls[0][0].embeds[0].data;
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

  it("mentions the selected student in /awardcurrency replies for member currency awards", async () => {
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
      commandName: "awardcurrency",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {
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

  it("mentions the student and group in /donate replies", async () => {
    const { runtime } = createRuntimeFixture();
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
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
      commandName: "awardcurrencybulk",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {
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

  it("echoes the reason in /awardpoints replies for group awards", async () => {
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
      commandName: "awardpoints",
      guild: {
        members: {
          fetch: fetchMember,
        },
      },
      options: {
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
      commandName: "awardcurrency",
      guild: { members: { fetch: fetchMember } },
      options: {
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
        commandName: "awardcurrency",
        guild: { members: { fetch: fetchMember } },
        options: {
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
      commandName: "awardcurrency",
      guild: { members: { fetch: fetchMember } },
      options: {
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
      commandName: "awardcurrency",
      guild: { members: { fetch: fetchMember } },
      options: {
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
    ).rejects.toThrow(/configured staff roles/i);
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

  it("uses the original message as the submission payload and cleans up replaced images", async () => {
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

    expect(services.submissionService.createOrReplace).toHaveBeenCalledWith({
      guildId: "guild-test",
      assignmentId: "assign-1",
      participantId: "participant-1",
      text: "Original submission notes",
      imageUrl: undefined,
      imageKey: undefined,
    });
    expect(deleteObject).toHaveBeenCalledWith("submissions/guild-test/old-image.png");
    expect(reply).toHaveBeenCalledWith(
      "Submission updated for **Reply Task**! It will be reviewed by an admin.",
    );
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
      },
    });

    expect(services.participantService.ensureForGroup).toHaveBeenCalledWith({
      guildId: "guild-test",
      discordUserId: "user-1",
      discordUsername: "Alice",
      groupId: "group-1",
    });
    expect(reply).toHaveBeenCalledWith({
      content: "Gryffindor: 12 blorgshj 🏅 available for the leaderboard and /buyforgroup. Your wallet: 7 bananas 💲.",
      ephemeral: true,
    });
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

  it("creates a group purchase from /buyforgroup", async () => {
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
      commandName: "buyforgroup",
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

  it("rejects /awardmixed while the command is disabled", async () => {
    const { runtime, services } = createRuntimeFixture();

    await expect(
      (runtime as any).handleCommand({
        commandName: "awardmixed",
        guild: {
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: { cache: new Map([["group-role", {}]]) },
            }),
          },
        },
        options: {},
        reply: vi.fn(),
        user: {
          id: "staff-1",
          username: "Mentor",
        },
      }),
    ).rejects.toThrow(/disabled for now/i);

    expect(services.economyService.awardGroups).not.toHaveBeenCalled();
    expect(services.participantCurrencyService.awardParticipants).not.toHaveBeenCalled();
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
        options?: Array<{ name: string; required?: boolean; min_value?: number }>;
      }>;
    }>;
    const awardPointsCommand = commands.find((command) => command.name === "awardpoints");
    const awardCurrencyCommand = commands.find((command) => command.name === "awardcurrency");
    const awardCurrencyBulkCommand = commands.find((command) => command.name === "awardcurrencybulk");
    const awardMixedCommand = commands.find((command) => command.name === "awardmixed");
    const deductMixedCommand = commands.find((command) => command.name === "deductmixed");
    const forbesCommand = commands.find((command) => command.name === "forbes");

    expect(forbesCommand).toEqual(expect.objectContaining({ name: "forbes" }));
    expect(awardPointsCommand?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "targets", required: true }),
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
    );
    expect(awardCurrencyCommand?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "member", required: true }),
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
    );
    expect(awardCurrencyBulkCommand?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "targets", required: true }),
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
    );
    expect(awardCurrencyBulkCommand?.options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "member" })]),
    );
    expect(awardMixedCommand).toBeUndefined();
    expect(deductMixedCommand?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "targets", required: true }),
        expect.objectContaining({ name: "points", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "member", required: true }),
        expect.objectContaining({ name: "currency", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
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
});
