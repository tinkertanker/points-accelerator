import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ReactionRulesEditor from "./ReactionRulesEditor";

function renderEditor(overrides?: Partial<ComponentProps<typeof ReactionRulesEditor>>) {
  const onCreate = vi.fn(async () => true);
  const onUpdate = vi.fn(async () => true);

  render(
    <ReactionRulesEditor
      rules={[]}
      channels={[{ id: "channel-counting", name: "counting" }]}
      currencyName="credits"
      pointsName="points"
      isBusy={false}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={vi.fn(async () => true)}
      {...overrides}
    />,
  );

  return { onCreate, onUpdate };
}

describe("ReactionRulesEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("saves count-multiplier rules with a blank maximum payout as uncapped", async () => {
    const { onCreate } = renderEditor();

    fireEvent.change(screen.getByLabelText("Channel"), {
      target: { value: "channel-counting" },
    });
    fireEvent.change(screen.getByLabelText("Bot user ID"), {
      target: { value: "bot-counter" },
    });
    fireEvent.change(screen.getByLabelText("Emoji"), {
      target: { value: "❌" },
    });
    fireEvent.change(screen.getByLabelText("Reward mode"), {
      target: { value: "COUNT_MULTIPLIER" },
    });
    fireEvent.change(screen.getByLabelText("credits per count"), {
      target: { value: "-2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add reaction rule" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMode: "COUNT_MULTIPLIER",
        currencyDelta: -2,
        maxCurrencyDelta: null,
        maxPointsDelta: null,
      }),
    );
  });

  it("saves group point count-multiplier rules with a blank maximum payout as uncapped", async () => {
    const { onCreate } = renderEditor();

    fireEvent.change(screen.getByLabelText("Channel"), {
      target: { value: "channel-counting" },
    });
    fireEvent.change(screen.getByLabelText("Bot user ID"), {
      target: { value: "bot-counter" },
    });
    fireEvent.change(screen.getByLabelText("Emoji"), {
      target: { value: "⭐" },
    });
    fireEvent.change(screen.getByLabelText("Payout"), {
      target: { value: "GROUP_POINTS" },
    });
    fireEvent.change(screen.getByLabelText("Reward mode"), {
      target: { value: "COUNT_MULTIPLIER" },
    });
    fireEvent.change(screen.getByLabelText("points per count"), {
      target: { value: "3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add reaction rule" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payoutTarget: "GROUP_POINTS",
        amountMode: "COUNT_MULTIPLIER",
        pointsDelta: 3,
        maxCurrencyDelta: null,
        maxPointsDelta: null,
      }),
    );
  });

  it("blocks count-multiplier rules with an invalid nonblank maximum payout", () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText("Channel"), {
      target: { value: "channel-counting" },
    });
    fireEvent.change(screen.getByLabelText("Bot user ID"), {
      target: { value: "bot-counter" },
    });
    fireEvent.change(screen.getByLabelText("Emoji"), {
      target: { value: "✅" },
    });
    fireEvent.change(screen.getByLabelText("Reward mode"), {
      target: { value: "COUNT_MULTIPLIER" },
    });
    fireEvent.change(screen.getByLabelText("Max payout"), {
      target: { value: "0" },
    });

    expect(screen.getByRole("button", { name: "Add reaction rule" })).toBeDisabled();
  });

  it("clears an existing count-multiplier maximum payout with explicit null", async () => {
    const { onUpdate } = renderEditor({
      rules: [
        {
          id: "rule-1",
          guildId: "guild-1",
          channelId: "channel-counting",
          botUserId: "bot-counter",
          emoji: "✅",
          payoutTarget: "PARTICIPANT_CURRENCY",
          currencyDelta: 10,
          pointsDelta: 0,
          amountMode: "COUNT_MULTIPLIER",
          maxCurrencyDelta: 100,
          maxPointsDelta: null,
          description: null,
          enabled: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    fireEvent.change(screen.getByLabelText("Maximum payout"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith(
      "rule-1",
      expect.objectContaining({
        maxCurrencyDelta: null,
        maxPointsDelta: null,
      }),
    );
  });
});
