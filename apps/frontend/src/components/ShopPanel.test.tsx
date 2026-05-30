import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ShopPanel from "./ShopPanel";
import type { ShopItemDraft } from "../types";

const shopDrafts: ShopItemDraft[] = [
  {
    id: "personal-zebra",
    name: "Zebra sticker",
    description: "Sticker reward",
    audience: "INDIVIDUAL",
    cost: 5,
    stock: 10,
    enabled: true,
    fulfillmentInstructions: "Collect from the desk",
    emoji: "🦓",
    ownerUserId: null,
    ownerUsername: null,
    fulfillerRoleId: null,
    autoFulfil: false,
  },
  {
    id: "group-apple",
    name: "Apple crate",
    description: "Shared reward",
    audience: "GROUP",
    cost: 25,
    stock: 3,
    enabled: true,
    fulfillmentInstructions: "Ask a mentor",
    emoji: "🍎",
    ownerUserId: null,
    ownerUsername: null,
    fulfillerRoleId: null,
    autoFulfil: false,
  },
  {
    id: "personal-apple",
    name: "Apple badge",
    description: "Badge reward",
    audience: "INDIVIDUAL",
    cost: 4,
    stock: null,
    enabled: false,
    fulfillmentInstructions: null,
    emoji: "💸",
    ownerUserId: null,
    ownerUsername: null,
    fulfillerRoleId: null,
    autoFulfil: false,
  },
];

afterEach(() => {
  cleanup();
});

describe("ShopPanel", () => {
  it("shows group-point shop columns and sorts by name by default", () => {
    render(
      <ShopPanel
        shopDrafts={shopDrafts}
        isBusy={false}
        createShopDraft={() => ({
          name: "",
          description: "",
          audience: "GROUP",
          cost: 0,
          stock: null,
          enabled: true,
          fulfillmentInstructions: "",
          emoji: "💸",
          ownerUserId: null,
          ownerUsername: null,
          fulfillerRoleId: null,
          autoFulfil: false,
        })}
        onShopDraftsChange={vi.fn()}
        onSaveShop={vi.fn(async () => undefined)}
        onArchiveShopItem={vi.fn(async () => true)}
        onDeleteShopItem={vi.fn(async () => true)}
      />,
    );

    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent?.trim())).toEqual([
      "Emoji",
      "Name",
      "Description",
      "Cost",
      "Stock",
      "Fulfilment",
      "Owner",
      "Fulfiller role",
      "Auto-fulfil",
      "Enabled",
      "Actions",
    ]);

    const nameInputs = within(screen.getByRole("table")).getAllByLabelText("Item name") as HTMLInputElement[];
    expect(nameInputs.map((input) => input.value)).toEqual(["Apple badge", "Apple crate", "Zebra sticker"]);
    expect(screen.getByLabelText("Sort by")).toHaveValue("name");
    expect(screen.getByLabelText("Direction")).toHaveValue("asc");
  });

  it("resorts the catalogue when the sort controls change", () => {
    render(
      <ShopPanel
        shopDrafts={shopDrafts}
        isBusy={false}
        createShopDraft={() => ({
          name: "",
          description: "",
          audience: "GROUP",
          cost: 0,
          stock: null,
          enabled: true,
          fulfillmentInstructions: "",
          emoji: "💸",
          ownerUserId: null,
          ownerUsername: null,
          fulfillerRoleId: null,
          autoFulfil: false,
        })}
        onShopDraftsChange={vi.fn()}
        onSaveShop={vi.fn(async () => undefined)}
        onArchiveShopItem={vi.fn(async () => true)}
        onDeleteShopItem={vi.fn(async () => true)}
      />,
    );

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "name" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "desc" } });

    const nameInputs = within(screen.getByRole("table")).getAllByLabelText("Item name") as HTMLInputElement[];
    expect(nameInputs.map((input) => input.value)).toEqual(["Zebra sticker", "Apple crate", "Apple badge"]);
  });

  it("offers archive and delete actions for each catalogue row", () => {
    const onArchiveShopItem = vi.fn(async () => true);
    const onDeleteShopItem = vi.fn(async () => true);

    render(
      <ShopPanel
        shopDrafts={shopDrafts}
        isBusy={false}
        createShopDraft={() => ({
          name: "",
          description: "",
          audience: "GROUP",
          cost: 0,
          stock: null,
          enabled: true,
          fulfillmentInstructions: "",
          emoji: "💸",
          ownerUserId: null,
          ownerUsername: null,
          fulfillerRoleId: null,
          autoFulfil: false,
        })}
        onShopDraftsChange={vi.fn()}
        onSaveShop={vi.fn(async () => undefined)}
        onArchiveShopItem={onArchiveShopItem}
        onDeleteShopItem={onDeleteShopItem}
      />,
    );

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const firstEnabledRow = rows[1]!;
    fireEvent.click(within(firstEnabledRow).getByRole("button", { name: "Archive" }));
    fireEvent.click(within(firstEnabledRow).getByRole("button", { name: "Delete" }));

    expect(onArchiveShopItem).toHaveBeenCalledWith(shopDrafts[1], 1);
    expect(onDeleteShopItem).toHaveBeenCalledWith(shopDrafts[1], 1);
  });
});
