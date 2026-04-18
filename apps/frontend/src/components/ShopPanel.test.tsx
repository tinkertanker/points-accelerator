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
    ownerUserId: null,
    ownerUsername: null,
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
    ownerUserId: null,
    ownerUsername: null,
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
    ownerUserId: null,
    ownerUsername: null,
  },
];

afterEach(() => {
  cleanup();
});

describe("ShopPanel", () => {
  it("shows audience as the first column and sorts by audience then name by default", () => {
    render(
      <ShopPanel
        shopDrafts={shopDrafts}
        isBusy={false}
        createShopDraft={() => ({
          name: "",
          description: "",
          audience: "INDIVIDUAL",
          cost: 0,
          stock: null,
          enabled: true,
          fulfillmentInstructions: "",
          ownerUserId: null,
          ownerUsername: null,
        })}
        onShopDraftsChange={vi.fn()}
        onSaveShop={vi.fn(async () => undefined)}
      />,
    );

    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent?.trim())).toEqual([
      "Audience",
      "Name",
      "Description",
      "Cost",
      "Stock",
      "Fulfilment",
      "Owner Discord ID",
      "Enabled",
    ]);

    const nameInputs = within(screen.getByRole("table")).getAllByLabelText("Item name") as HTMLInputElement[];
    expect(nameInputs.map((input) => input.value)).toEqual(["Apple crate", "Apple badge", "Zebra sticker"]);
    expect(screen.getByLabelText("Sort by")).toHaveValue("audience");
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
          audience: "INDIVIDUAL",
          cost: 0,
          stock: null,
          enabled: true,
          fulfillmentInstructions: "",
          ownerUserId: null,
          ownerUsername: null,
        })}
        onShopDraftsChange={vi.fn()}
        onSaveShop={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "name" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "desc" } });

    const nameInputs = within(screen.getByRole("table")).getAllByLabelText("Item name") as HTMLInputElement[];
    expect(nameInputs.map((input) => input.value)).toEqual(["Zebra sticker", "Apple crate", "Apple badge"]);
  });
});
