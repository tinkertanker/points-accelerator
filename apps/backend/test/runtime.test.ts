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
    currencyName: "rice",
    groupPointsPerCurrencyDonation: {
      toNumber: () => 10,
    },
    passiveCooldownSeconds: 120,
    pointsName: "points",
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
    },
    participantService: {
      findByDiscordUser: vi.fn(),
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

  it("shows the full shop item id in /store output", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.shopService.list.mockResolvedValue([
      {
        id: "shop-item-1234567890",
        enabled: true,
        name: "Bubble Tea",
        audience: "INDIVIDUAL",
        cost: {
          toString: () => "3",
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
      options: {},
      reply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("shop-item-1234567890"),
      }),
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Personal items"),
      }),
    );
  });

  it("shows a paged ledger summary in Discord", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.economyService.getLedger.mockResolvedValue([
      {
        id: "entry-1",
        type: "MANUAL_AWARD",
        description: "Answered the toughest warm-up question",
        createdAt: "2026-04-01T12:00:00.000Z",
        splits: [
          {
            id: "split-1",
            group: { displayName: "Gryffindor" },
            pointsDelta: 5,
            currencyDelta: 0,
          },
        ],
      },
    ]);
    const reply = vi.fn().mockResolvedValue(undefined);

    await (runtime as any).handleCommand({
      commandName: "ledger",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      options: {
        getInteger: vi.fn().mockReturnValue(2),
      },
      reply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    expect(services.economyService.getLedger).toHaveBeenCalledWith("guild-test", {
      limit: 10,
      offset: 10,
    });
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Recent transactions, page 2"),
      }),
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Gryffindor +5 points"),
      }),
    );
  });

  it("truncates long ledger lines so Discord replies stay within the message limit", async () => {
    const { runtime, services } = createRuntimeFixture();
    services.economyService.getLedger.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `entry-${index + 1}`,
        type: "MANUAL_AWARD",
        description:
          "Awarded for consistently helping other tables, finishing every checkpoint, and writing up the clearest recap note of the day.",
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
      options: {
        getInteger: vi.fn().mockReturnValue(1),
      },
      reply,
      user: {
        id: "user-1",
        username: "Alice",
      },
    });

    const [{ content }] = reply.mock.calls[0] as [{ content: string }];
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain("...");
  });

  it("uses the Discord display name in /award replies for member currency awards", async () => {
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
      commandName: "award",
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
    expect(reply).toHaveBeenCalledWith("Awarded 100 currency to Alex Carter.");
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
      content: "Gryffindor: 12 points available for the leaderboard and /buyforgroup. Your wallet: 7 rice.",
      ephemeral: true,
    });
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
        content: expect.stringContaining("Request ID: redemption-12345678"),
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
    const awardGroupCommand = commands.find((command) => command.name === "awardgroup");
    const awardCommand = commands.find((command) => command.name === "award");
    const awardMixedCommand = commands.find((command) => command.name === "awardmixed");
    const deductMixedCommand = commands.find((command) => command.name === "deductmixed");

    expect(awardGroupCommand?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "targets", required: true }),
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
    );
    expect(awardCommand?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "member", required: true }),
        expect.objectContaining({ name: "amount", required: true, min_value: 0.01 }),
        expect.objectContaining({ name: "reason", required: false }),
      ]),
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
