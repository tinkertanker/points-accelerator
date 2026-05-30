import { useMemo, useState } from "react";
import { Archive, Trash2, Zap } from "lucide-react";

import type { DiscordOption, Participant, ShopItemDraft } from "../types";

const OWNER_DATALIST_ID = "shop-owner-participants";

type ShopSortKey = "name" | "cost" | "stock";
type SortDirection = "asc" | "desc";

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
  const nameComparison = compareText(normalisedLeftName, normalisedRightName);

  let primaryComparison = 0;

  switch (sortKey) {
    case "name":
      primaryComparison = nameComparison;
      break;
    case "cost":
      primaryComparison = left.cost - right.cost || nameComparison;
      break;
    case "stock":
      primaryComparison =
        (left.stock ?? Number.POSITIVE_INFINITY) - (right.stock ?? Number.POSITIVE_INFINITY) ||
        nameComparison;
      break;
  }

  return primaryComparison * directionMultiplier;
}

type ShopPanelProps = {
  shopDrafts: ShopItemDraft[];
  isBusy: boolean;
  participants?: Participant[];
  members?: DiscordOption[];
  createShopDraft: () => ShopItemDraft;
  onShopDraftsChange: (next: ShopItemDraft[]) => void;
  onSaveShop: () => Promise<void>;
  onArchiveShopItem: (item: ShopItemDraft, index: number) => Promise<boolean>;
  onDeleteShopItem: (item: ShopItemDraft, index: number) => Promise<boolean>;
};

export default function ShopPanel({
  shopDrafts,
  isBusy,
  participants = [],
  members = [],
  createShopDraft,
  onShopDraftsChange,
  onSaveShop,
  onArchiveShopItem,
  onDeleteShopItem,
}: ShopPanelProps) {
  const [sortKey, setSortKey] = useState<ShopSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const ownerSuggestions = useMemo(() => {
    const byUserId = new Map<string, { userId: string; username: string }>();

    for (const member of members) {
      if (!member.id || byUserId.has(member.id)) {
        continue;
      }
      byUserId.set(member.id, { userId: member.id, username: member.name || member.id });
    }

    for (const participant of participants) {
      if (!participant.discordUserId || byUserId.has(participant.discordUserId)) {
        continue;
      }
      byUserId.set(participant.discordUserId, {
        userId: participant.discordUserId,
        username: participant.discordUsername ?? participant.indexId,
      });
    }

    const entries = Array.from(byUserId.values()).sort((left, right) =>
      left.username.localeCompare(right.username),
    );

    // Always disambiguate the datalist label with the user ID so duplicate
    // display names don't silently bind to the wrong account on selection.
    return entries.map((entry) => ({
      ...entry,
      label: `${entry.username} · ${entry.userId}`,
    }));
  }, [members, participants]);

  const handleOwnerInput = (item: ShopItemDraft, rawValue: string): ShopItemDraft => {
    const value = rawValue.trim();
    if (!value) {
      return { ...item, ownerUserId: null, ownerUsername: null };
    }

    const matchedByLabel = ownerSuggestions.find((suggestion) => suggestion.label === value);
    if (matchedByLabel) {
      return { ...item, ownerUserId: matchedByLabel.userId, ownerUsername: matchedByLabel.username };
    }

    const matchedByUserId = ownerSuggestions.find((suggestion) => suggestion.userId === value);
    if (matchedByUserId) {
      return { ...item, ownerUserId: matchedByUserId.userId, ownerUsername: matchedByUserId.username };
    }

    if (/^\d{17,20}$/.test(value)) {
      return { ...item, ownerUserId: value, ownerUsername: null };
    }

    // Freeform text that matches nothing: clear the bound ID so the displayed
    // name can never disagree with the actual owner. The UI shows a hint when
    // ownerUsername is set but ownerUserId is null, so the staffer can pick a
    // suggestion or paste a snowflake.
    return { ...item, ownerUserId: null, ownerUsername: value };
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

  const activeDrafts = sortedDrafts.filter(({ item }) => item.enabled);
  const archivedDrafts = sortedDrafts.filter(({ item }) => !item.enabled);
  const shopSections = [
    {
      title: "Active store items",
      description: "Visible in the student store.",
      emptyState: "No active store items.",
      entries: activeDrafts,
    },
    {
      title: "Archived items",
      description: "Hidden from the student store but kept for records.",
      emptyState: "No archived items.",
      entries: archivedDrafts,
    },
  ];

  const getItemLabel = (item: ShopItemDraft) => item.name.trim() || "new store item";

  const renderItemActions = (item: ShopItemDraft, index: number) => (
    <div className="shop-row-actions">
      <button
        type="button"
        className="shop-icon-button"
        disabled={isBusy || !item.enabled}
        onClick={() => void onArchiveShopItem(item, index)}
        aria-label={`Archive ${getItemLabel(item)}`}
        title="Archive"
      >
        <Archive aria-hidden="true" size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="shop-icon-button shop-icon-button--danger"
        disabled={isBusy}
        onClick={() => void onDeleteShopItem(item, index)}
        aria-label={`Delete ${getItemLabel(item)}`}
        title="Delete"
      >
        <Trash2 aria-hidden="true" size={16} strokeWidth={2} />
      </button>
    </div>
  );

  const renderAutoFulfilToggle = (item: ShopItemDraft, index: number) => (
    <button
      type="button"
      className={`shop-toggle-icon${item.autoFulfil ? " shop-toggle-icon--on" : ""}`}
      aria-label={`${item.autoFulfil ? "Disable" : "Enable"} auto-fulfil for ${getItemLabel(item)}`}
      aria-pressed={item.autoFulfil}
      title={item.autoFulfil ? "Auto-fulfil on" : "Auto-fulfil off"}
      onClick={() => updateShopDraft(index, { ...item, autoFulfil: !item.autoFulfil })}
    >
      <Zap aria-hidden="true" size={16} strokeWidth={2.2} />
    </button>
  );

  return (
    <div className="panel-stack">
      {ownerSuggestions.length > 0 ? (
        <datalist id={OWNER_DATALIST_ID}>
          {ownerSuggestions.map((suggestion) => (
            <option key={suggestion.userId} value={suggestion.label}>
              {suggestion.username}
            </option>
          ))}
        </datalist>
      ) : null}
      <article className="section">
        <header className="section-header">
          <h2>Edit the store catalogue</h2>
          <button className="primary-action" type="button" onClick={() => void onSaveShop()} disabled={isBusy}>
            Save Store
          </button>
        </header>
        <div className="shop-catalog-matrix">
          <div className="shop-catalog-toolbar">
            <div className="shop-sort-controls">
              <label className="shop-sort-control">
                <span>Sort by</span>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as ShopSortKey)}>
                  <option value="name">Name</option>
                  <option value="cost">Cost</option>
                  <option value="stock">Stock</option>
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

          {shopSections.map((section) => (
            <section className="shop-section" key={section.title}>
              <div className="shop-section__header">
                <h3>{section.title}</h3>
                <p>{section.description}</p>
              </div>

              {section.entries.length === 0 ? (
                <p className="shop-section__empty">{section.emptyState}</p>
              ) : (
                <>
                  <div className="shop-table-shell">
                    <div className="matrix-scroll">
                      <table className="matrix-table shop-table">
                        <thead>
                          <tr>
                            <th scope="col" className="col-emoji">Emoji</th>
                            <th scope="col" className="col-name">Name</th>
                            <th scope="col" className="col-description">Description</th>
                            <th scope="col" className="col-cost">Cost</th>
                            <th scope="col" className="col-stock">Stock</th>
                            <th scope="col" className="col-fulfil">Fulfilment</th>
                            <th scope="col" className="col-owner">Owner</th>
                            <th scope="col" className="matrix-table__th--center col-auto-fulfil">Auto-fulfil</th>
                            <th scope="col" className="matrix-table__th--center col-actions">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.entries.map(({ item, index }) => (
                            <tr key={`${section.title}-${item.id ?? "new"}-${index}`}>
                              <td className="col-emoji">
                                <input
                                  value={item.emoji}
                                  aria-label="Item emoji"
                                  maxLength={8}
                                  onChange={(event) => updateShopDraft(index, { ...item, emoji: event.target.value })}
                                  placeholder="💸"
                                />
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
                                  placeholder="Shown in the store"
                                />
                              </td>
                              <td className="col-cost">
                                <input
                                  type="number"
                                  value={item.cost}
                                  aria-label="Cost in group points"
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
                                {item.ownerUsername && !item.ownerUserId ? (
                                  <small className="shop-owner-hint">No match — pick a suggestion or paste a Discord user ID.</small>
                                ) : null}
                              </td>
                              <td className="col-auto-fulfil">{renderAutoFulfilToggle(item, index)}</td>
                              <td className="col-actions">{renderItemActions(item, index)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="shop-card-list" aria-label={`${section.title} cards`}>
                    {section.entries.map(({ item, index }) => (
                      <article className="shop-card" key={`card-${section.title}-${item.id ?? "new"}-${index}`}>
                        <div className="shop-card__header">
                          <h3>
                            <span aria-hidden>{item.emoji}</span> {item.name.trim() || "New store item"}
                          </h3>
                          <span className="shop-card__audience">Group points</span>
                          <div className="shop-card__actions">{renderItemActions(item, index)}</div>
                        </div>
                        <div className="shop-card__grid">
                          <label className="shop-field">
                            <span className="shop-field__label">Emoji</span>
                            <input
                              value={item.emoji}
                              aria-label="Item emoji"
                              maxLength={8}
                              onChange={(event) => updateShopDraft(index, { ...item, emoji: event.target.value })}
                              placeholder="💸"
                            />
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
                              placeholder="Shown in the store"
                            />
                          </label>
                          <label className="shop-field">
                            <span className="shop-field__label">Cost</span>
                            <input
                              type="number"
                              value={item.cost}
                              aria-label="Cost in group points"
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
                            {item.ownerUsername && !item.ownerUserId ? (
                              <small className="shop-owner-hint">No match — pick a suggestion or paste a Discord user ID.</small>
                            ) : null}
                          </label>
                          <div className="shop-field shop-field--toggle shop-field--full">
                            <span className="shop-field__label">Auto-fulfil</span>
                            {renderAutoFulfilToggle(item, index)}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          ))}
          <button
            type="button"
            className="matrix-add-row"
            onClick={() => onShopDraftsChange([...shopDrafts, createShopDraft()])}
          >
            + Add store item
          </button>

          <details className="capability-help">
            <summary>What do these store columns mean?</summary>
            <dl>
              <dt>Emoji</dt>
              <dd>Shown next to the item name in the store, redemption notices, and the fulfilment queue. Defaults to 💸.</dd>
              <dt>Name</dt>
              <dd>The item title shown in the store and purchase flows.</dd>
              <dt>Description</dt>
              <dd>Short copy explaining what the student or group is buying.</dd>
              <dt>Cost</dt>
              <dd>The group points charged per purchase. All store items use shared group points and group approvals.</dd>
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
              <dt>Auto-fulfil</dt>
              <dd>Completes purchases automatically instead of handing them to the fulfilment queue.</dd>
              <dt>Archive</dt>
              <dd>Archive items to hide them from the student store without deleting purchase history.</dd>
            </dl>
          </details>
        </div>
      </article>
    </div>
  );
}
