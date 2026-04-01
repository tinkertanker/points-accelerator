import { afterEach, describe, expect, it, vi } from "vitest";

import { BotRuntime } from "../src/bot/runtime.js";
import { loadEnv } from "../src/config/env.js";

function createRuntimeFixture() {
  const env = loadEnv({
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/economy_rice_test",
    GUILD_ID: "guild-test",
    ADMIN_TOKEN: "test-admin-token",
    PORT: 1,
    MESSAGE_REWARD_COOLDOWN_SECONDS: 1,
  });

  const config = {
    passiveCooldownSeconds: 120,
  };
  const services = {
    configService: {
      getOrCreate: vi.fn().mockResolvedValue(config),
    },
    groupService: {
      resolveGroupFromRoleIds: vi.fn().mockResolvedValue({ id: "group-1" }),
    },
    economyService: {
      rewardPassiveMessage: vi.fn().mockResolvedValue({ id: "entry-1" }),
    },
    shopService: {
      list: vi.fn().mockResolvedValue([]),
    },
  };

  return {
    config,
    runtime: new BotRuntime(env, services as never),
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
});
