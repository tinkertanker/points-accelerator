import { useMemo, useState } from "react";

import type { Participant, ShopItemDraft } from "../types";

const OWNER_DATALIST_ID = "shop-owner-participants";

type ShopSortKey = "audience" | "name" | "cost" | "stock" | "enabled";
type SortDirection = "asc" | "desc";

const AUDIENCE_LABELS: Record<ShopItemDraft["audience"], string> = {
  GROUP: "Group",
  INDIVIDUAL: "Personal",
};

const AUDIENCE_ORDER: Record<ShopItemDraft["audience"], number> = {
  GROUP: 0,
  INDIVIDUAL: 1,
};

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareShopItems(
  left: ShopItemDraft,
  right: ShopItemDraft,
  sortKey: ShopSortKey,
  direction: SortDirection,
) {
  const directionMultiplier = direction === "asc" ? 1 : -1;
  const normalisedLeftName = left.name.trim() || "\uffff";
  const normalisedRightName = right.name.trim() || "\uffff";
  const audienceComparison = AUDIENCE_ORDER[left.audience] - AUDIENCE_ORDER[right.audience];
  const nameComparison = compareText(normalisedLeftName, normalisedRightName);

  let primaryComparison = 0;

  switch (sortKey) {
    case "audience":
      primaryComparison = audienceComparison || nameComparison;
      break;
    case "name":
      primaryComparison = nameComparison || audienceComparison;
      break;
    case "cost":
      primaryComparison = left.cost - right.cost || audienceComparison || nameComparison;
      break;
    case "stock":
      primaryComparison =
        (left.stock ?? Number.POSITIVE_INFINITY) - (right.stock ?? Number.POSITIVE_INFINITY) ||
        audienceComparison ||
        nameComparison;
      break;
    case "enabled":
      primaryComparison = Number(right.enabled) - Number(left.enabled) || audienceComparison || nameComparison;
      break;
  }

  return primaryComparison * directionMultiplier;
}

type ShopPanelProps = {
  shopDrafts: ShopItemDraft[];
  isBusy: boolean;
  participants?: Participant[];
  createShopDraft: () => ShopItemDraft;
  onShopDraftsChange: (next: ShopItemDraft[]) => void;
  onSaveShop: () => Promise<void>;
};

export default function ShopPanel({
  shopDrafts,
  isBusy,
  participants = [],
  createShopDraft,
  onShopDraftsChange,
  onSaveShop,
}: ShopPanelProps) {
  const [sortKey, setSortKey] = useState<ShopSortKey>("audience");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const ownerSuggestions = useMemo(() => {
    const seen = new Set<string>();
    return participants
      .filter((participant) => {
        if (!participant.discordUserId || seen.has(participant.discordUserId)) {
          return false;
        }
        seen.add(participant.discordUserId);
        return true;
      })
      .map((participant) => ({
        userId: participant.discordUserId,
        username: participant.discordUsername ?? participant.indexId,
      }))
      .sort((left, right) => left.username.localeCompare(right.username));
  }, [participants]);

  const resolveOwnerUsername = (ownerUserId: string | null) => {
    if (!ownerUserId) {
      return null;
    }

    return ownerSuggestions.find((suggestion) => suggestion.userId === ownerUserId)?.username ?? null;
  };

  const handleOwnerInput = (item: ShopItemDraft, rawValue: string): ShopItemDraft => {
    const value = rawValue.trim();
    if (!value) {
      return { ...item, ownerUserId: null, ownerUsername: null };
    }

    const matchedByUsername = ownerSuggestions.find((suggestion) => suggestion.username === value);
    if (matchedByUsername) {
      return { ...item, ownerUserId: matchedByUsername.userId, ownerUsername: matchedByUsername.username };
    }

    const matchedByUserId = ownerSuggestions.find((suggestion) => suggestion.userId === value);
    if (matchedByUserId) {
      return { ...item, ownerUserId: matchedByUserId.userId, ownerUsername: matchedByUserId.username };
    }

    return { ...item, ownerUserId: value, ownerUsername: null };
  };

  const updateShopDraft = (index: number, nextDraft: ShopItemDraft) => {
    const next = [...shopDrafts];
    next[index] = nextDraft;
    onShopDraftsChange(next);
  };

  const sortedDrafts = shopDrafts
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const comparison = compareShopItems(left.item, right.item, sortKey, sortDirection);
      return comparison || left.index - right.index;
    });

  return (
    <div className="panel-stack">
      {ownerSuggestions.length > 0 ? (
        <datalist id={OWNER_DATALIST_ID}>
          {ownerSuggestions.map((suggestion) => (
            <option key={suggestion.userId} value={suggestion.username}>
              {suggestion.userId}
            </option>
          ))}
        </datalist>
      ) : null}
      <article className="section">
        <header className="section-header">
          <h2>Edit the shop catalogue</h2>
          <button className="primary-action" type="button" onClick={() => void onSaveShop()} disabled={isBusy}>
            Save Shop
          </button>
        </header>
        <div className="shop-catalog-matrix">
          <div className="shop-catalog-toolbar">
            <div className="shop-sort-controls">
              <label className="shop-sort-control">
                <span>Sort by</span>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as ShopSortKey)}>
                  <option value="audience">Audience, then name</option>
                  <option value="name">Name</option>
                  <option value="cost">Cost</option>
                  <option value="stock">Stock</option>
                  <option value="enabled">Enabled</option>
                </select>
              </label>
              <label className="shop-sort-control">
                <span>Direction</span>
                <select
                  value={sortDirection}
                  onChange={(event) => setSortDirection(event.target.value as SortDirection)}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
            </div>
          </div>

          <div className="shop-table-shell">
            <div className="matrix-scroll">
              <table className="matrix-table shop-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-audience">
                      Audience
                    </th>
                    <th scope="col" className="col-name">
                      Name
                    </th>
                    <th scope="col" className="col-description">
                      Description
                    </th>
                    <th scope="col" className="col-cost">
                      Cost
                    </th>
                    <th scope="col" className="col-stock">
                      Stock
                    </th>
                    <th scope="col" className="col-fulfil">
                      Fulfilment
                    </th>
                    <th scope="col" className="col-owner">
                      Owner
                    </th>
                    <th scope="col" className="matrix-table__th--center col-enabled">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDrafts.map(({ item, index }) => (
                    <tr key={`${item.id ?? "new"}-${index}`}>
                      <td className="col-audience">
                        <select
                          value={item.audience}
                          aria-label="Audience"
                          onChange={(event) =>
                            updateShopDraft(index, {
                              ...item,
                              audience: event.target.value as ShopItemDraft["audience"],
                            })
                          }
                        >
                          <option value="GROUP">👥</option>
                          <option value="INDIVIDUAL">👤</option>
                        </select>
                      </td>
                      <td className="col-name">
                        <input
                          value={item.name}
                          aria-label="Item name"
                          onChange={(event) => updateShopDraft(index, { ...item, name: event.target.value })}
                          placeholder="Item name"
                        />
                      </td>
                      <td className="col-description">
                        <input
                          value={item.description}
                          aria-label="Description"
                          onChange={(event) => updateShopDraft(index, { ...item, description: event.target.value })}
                          placeholder="Shown in the shop"
                        />
                      </td>
                      <td className="col-cost">
                        <input
                          type="number"
                          value={item.cost}
                          aria-label={`Cost in ${item.audience === "GROUP" ? "points" : "currency"}`}
                          onChange={(event) => updateShopDraft(index, { ...item, cost: Number(event.target.value) })}
                          placeholder="0"
                        />
                      </td>
                      <td className="col-stock">
                        <input
                          type="number"
                          value={item.stock ?? ""}
                          aria-label="Stock"
                          onChange={(event) =>
                            updateShopDraft(index, {
                              ...item,
                              stock: event.target.value ? Number(event.target.value) : null,
                            })
                          }
                          placeholder="∞"
                        />
                      </td>
                      <td className="col-fulfil">
                        <input
                          value={item.fulfillmentInstructions ?? ""}
                          aria-label="Fulfilment notes"
                          onChange={(event) =>
                            updateShopDraft(index, { ...item, fulfillmentInstructions: event.target.value })
                          }
                          placeholder="How to redeem"
                        />
                      </td>
                      <td className="col-owner">
                        <input
                          value={item.ownerUsername ?? item.ownerUserId ?? ""}
                          aria-label="Owner Discord user"
                          list={ownerSuggestions.length > 0 ? OWNER_DATALIST_ID : undefined}
                          onChange={(event) => updateShopDraft(index, handleOwnerInput(item, event.target.value))}
                          placeholder="Pick a participant or type a user ID"
                        />
                      </td>
                      <td className="col-enabled">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          aria-label="Enabled"
                          onChange={(event) => updateShopDraft(index, { ...item, enabled: event.target.checked })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="shop-card-list" aria-label="Shop catalogue cards">
            {sortedDrafts.map(({ item, index }) => (
              <article className="shop-card" key={`card-${item.id ?? "new"}-${index}`}>
                <div className="shop-card__header">
                  <h3>{item.name.trim() || "New shop item"}</h3>
                  <span className="shop-card__audience">{AUDIENCE_LABELS[item.audience]}</span>
                </div>
                <div className="shop-card__grid">
                  <label className="shop-field">
                    <span className="shop-field__label">Audience</span>
                    <select
                      value={item.audience}
                      aria-label="Audience"
                      onChange={(event) =>
                        updateShopDraft(index, {
                          ...item,
                          audience: event.target.value as ShopItemDraft["audience"],
                        })
                      }
                    >
                      <option value="GROUP">👥</option>
                      <option value="INDIVIDUAL">👤</option>
                    </select>
                  </label>
                  <label className="shop-field">
                    <span className="shop-field__label">Name</span>
                    <input
                      value={item.name}
                      aria-label="Item name"
                      onChange={(event) => updateShopDraft(index, { ...item, name: event.target.value })}
                      placeholder="Item name"
                    />
                  </label>
                  <label className="shop-field shop-field--full">
                    <span className="shop-field__label">Description</span>
                    <input
                      value={item.description}
                      aria-label="Description"
                      onChange={(event) => updateShopDraft(index, { ...item, description: event.target.value })}
                      placeholder="Shown in the shop"
                    />
                  </label>
                  <label className="shop-field">
                    <span className="shop-field__label">Cost</span>
                    <input
                      type="number"
                      value={item.cost}
                      aria-label={`Cost in ${item.audience === "GROUP" ? "points" : "currency"}`}
                      onChange={(event) => updateShopDraft(index, { ...item, cost: Number(event.target.value) })}
                      placeholder="0"
                    />
                  </label>
                  <label className="shop-field">
                    <span className="shop-field__label">Stock</span>
                    <input
                      type="number"
                      value={item.stock ?? ""}
                      aria-label="Stock"
                      onChange={(event) =>
                        updateShopDraft(index, {
                          ...item,
                          stock: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                      placeholder="∞"
                    />
                  </label>
                  <label className="shop-field shop-field--full">
                    <span className="shop-field__label">Fulfilment</span>
                    <input
                      value={item.fulfillmentInstructions ?? ""}
                      aria-label="Fulfilment notes"
                      onChange={(event) => updateShopDraft(index, { ...item, fulfillmentInstructions: event.target.value })}
                      placeholder="How to redeem"
                    />
                  </label>
                  <label className="shop-field shop-field--full">
                    <span className="shop-field__label">Owner</span>
                    <input
                      value={item.ownerUsername ?? item.ownerUserId ?? ""}
                      aria-label="Owner Discord user"
                      list={ownerSuggestions.length > 0 ? OWNER_DATALIST_ID : undefined}
                      onChange={(event) => updateShopDraft(index, handleOwnerInput(item, event.target.value))}
                      placeholder="Pick a participant or type a user ID"
                    />
                  </label>
                  <label className="shop-field shop-field--checkbox shop-field--full">
                    <span className="shop-field__label">Enabled</span>
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      aria-label="Enabled"
                      onChange={(event) => updateShopDraft(index, { ...item, enabled: event.target.checked })}
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>
          <button
            type="button"
            className="matrix-add-row"
            onClick={() => onShopDraftsChange([...shopDrafts, createShopDraft()])}
          >
            + Add shop item
          </button>

          <details className="capability-help">
            <summary>What do these shop columns mean?</summary>
            <dl>
              <dt>Name</dt>
              <dd>The item title shown in the shop and purchase flows.</dd>
              <dt>Description</dt>
              <dd>Short copy explaining what the student or group is buying.</dd>
              <dt>Audience</dt>
              <dd>
                <strong>👤 Personal</strong> items are bought with <code>/buyforme</code> using participant currency.
                <strong> 👥 Group</strong> items are bought with <code>/buyforgroup</code> using shared group points and
                approvals.
              </dd>
              <dt>Cost</dt>
              <dd>The amount charged per purchase in the selected audience&apos;s economy.</dd>
              <dt>Stock</dt>
              <dd>Leave blank for unlimited supply. Set a number to cap how many times the item can be redeemed.</dd>
              <dt>Fulfilment</dt>
              <dd>
                What happens after purchase: for example, &ldquo;show this receipt to a mentor&rdquo; or
                &ldquo;collect from the staff desk&rdquo;.
              </dd>
              <dt>Owner</dt>
              <dd>
                The person responsible for fulfilling purchases of this item. Pick from registered participants, or
                paste a raw Discord user ID for a staff member. They will be pinged in the redemption channel with
                fulfil and refund buttons whenever someone buys this item.
              </dd>
              <dt>Enabled</dt>
              <dd>Turn items on or off without deleting them from the catalogue.</dd>
            </dl>
          </details>
        </div>
      </article>
    </div>
  );
}
