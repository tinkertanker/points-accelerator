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
  it("shows grouped store columns and sorts active items by name by default", () => {
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

    expect(screen.getByRole("heading", { name: "Active store items" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived items" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Add store item" }).compareDocumentPosition(
        screen.getByRole("heading", { name: "Archived items" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const activeTable = screen.getAllByRole("table")[0]!;
    const headers = within(activeTable).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent?.trim())).toEqual([
      "Emoji",
      "Name",
      "Description",
      "Cost",
      "Stock",
      "Fulfilment",
      "Owner",
      "Auto-fulfil",
      "Actions",
    ]);
    expect(screen.queryByText("Merchant role")).not.toBeInTheDocument();

    const activeNameInputs = within(activeTable).getAllByLabelText("Item name") as HTMLInputElement[];
    expect(activeNameInputs.map((input) => input.value)).toEqual(["Apple crate", "Zebra sticker"]);
    const archivedTable = screen.getAllByRole("table")[1]!;
    const archivedNameInputs = within(archivedTable).getAllByLabelText("Item name") as HTMLInputElement[];
    expect(archivedNameInputs.map((input) => input.value)).toEqual(["Apple badge"]);
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

    const activeTable = screen.getAllByRole("table")[0]!;
    const nameInputs = within(activeTable).getAllByLabelText("Item name") as HTMLInputElement[];
    expect(nameInputs.map((input) => input.value)).toEqual(["Zebra sticker", "Apple crate"]);
  });

  it("offers duplicate, archive, and delete actions for each catalogue row", () => {
    const onShopDraftsChange = vi.fn();
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
        onShopDraftsChange={onShopDraftsChange}
        onSaveShop={vi.fn(async () => undefined)}
        onArchiveShopItem={onArchiveShopItem}
        onDeleteShopItem={onDeleteShopItem}
      />,
    );

    const activeTable = screen.getAllByRole("table")[0]!;
    const rows = within(activeTable).getAllByRole("row").slice(1);
    const firstEnabledRow = rows[0]!;
    fireEvent.click(within(firstEnabledRow).getByRole("button", { name: "Duplicate Apple crate" }));
    fireEvent.click(within(firstEnabledRow).getByRole("button", { name: "Archive Apple crate" }));
    fireEvent.click(within(firstEnabledRow).getByRole("button", { name: "Delete Apple crate" }));

    expect(onShopDraftsChange).toHaveBeenCalledWith([
      shopDrafts[0],
      shopDrafts[1],
      { ...shopDrafts[1], id: undefined, name: "Apple crate copy", enabled: true },
      shopDrafts[2],
    ]);
    expect(onArchiveShopItem).toHaveBeenCalledWith(shopDrafts[1], 1);
    expect(onDeleteShopItem).toHaveBeenCalledWith(shopDrafts[1], 1);
  });

  it("toggles auto-fulfil from the icon button", () => {
    const onShopDraftsChange = vi.fn();

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
        onShopDraftsChange={onShopDraftsChange}
        onSaveShop={vi.fn(async () => undefined)}
        onArchiveShopItem={vi.fn(async () => true)}
        onDeleteShopItem={vi.fn(async () => true)}
      />,
    );

    const activeTable = screen.getAllByRole("table")[0]!;
    const toggle = within(activeTable).getByRole("button", { name: "Enable auto-fulfil for Apple crate" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(onShopDraftsChange).toHaveBeenCalledWith([
      shopDrafts[0],
      { ...shopDrafts[1], autoFulfil: true },
      shopDrafts[2],
    ]);
  });
});
