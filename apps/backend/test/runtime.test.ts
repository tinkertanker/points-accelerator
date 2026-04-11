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
    passiveCooldownSeconds: 120,
    pointsName: "points",
  };
  const services = {
    configService: {
      getOrCreate: vi.fn().mockResolvedValue(config),
    },
    groupService: {
      resolveGroupFromRoleIds: vi.fn().mockResolvedValue({ id: "group-1" }),
    },
    economyService: {
      getLedger: vi.fn().mockResolvedValue([]),
      rewardPassiveMessage: vi.fn().mockResolvedValue({ id: "entry-1" }),
    },
    roleCapabilityService: {
      listForRoleIds: vi.fn().mockResolvedValue([]),
    },
    shopService: {
      list: vi.fn().mockResolvedValue([]),
    },
    participantService: {
      findByDiscordUser: vi.fn(),
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
        currencyCost: {
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
    services.participantService.findByDiscordUser.mockResolvedValue({
      id: "participant-1",
      indexId: "S001",
      groupId: "group-1",
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
    services.participantService.findByDiscordUser.mockResolvedValue({
      id: "participant-1",
      indexId: "S001",
      groupId: "group-1",
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
});
