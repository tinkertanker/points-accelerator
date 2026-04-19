import { useState } from "react";

import type { ShopRedemption } from "../types";

const STATUS_LABELS: Record<ShopRedemption["status"], string> = {
  AWAITING_APPROVAL: "Awaiting approval",
  PENDING: "Pending fulfilment",
  FULFILLED: "Fulfilled",
  CANCELED: "Canceled",
};

const STATUS_CLASSES: Record<ShopRedemption["status"], string> = {
  AWAITING_APPROVAL: "badge--awaiting",
  PENDING: "badge--pending",
  FULFILLED: "badge--approved",
  CANCELED: "badge--rejected",
};

const STATUS_ORDER: Record<ShopRedemption["status"], number> = {
  PENDING: 0,
  AWAITING_APPROVAL: 1,
  FULFILLED: 2,
  CANCELED: 3,
};

type FulfilmentPanelProps = {
  redemptions: ShopRedemption[];
  isBusy: boolean;
  isLoading: boolean;
  onUpdateRedemptionStatus: (redemption: ShopRedemption, status: "FULFILLED" | "CANCELED") => Promise<boolean>;
};

function getRequesterLabel(redemption: ShopRedemption) {
  return (
    redemption.requestedByParticipant?.discordUsername ??
    redemption.requestedByParticipant?.indexId ??
    redemption.requestedByUsername ??
    redemption.requestedByUserId
  );
}

function getCostLabel(redemption: ShopRedemption) {
  const unit = redemption.purchaseMode === "GROUP" ? "pts" : "wallet";
  return `${redemption.totalCost} ${unit}`;
}

function getApprovalProgress(redemption: ShopRedemption) {
  if (redemption.purchaseMode !== "GROUP") {
    return "Immediate";
  }

  const threshold = redemption.approvalThreshold ?? 1;
  return `${redemption.approvals.length}/${threshold}`;
}

function getPurchaseLabel(redemption: ShopRedemption) {
  return `${redemption.purchaseMode === "GROUP" ? "Group purchase" : "Personal purchase"} x${redemption.quantity}`;
}

function getUpdatedLabel(redemption: ShopRedemption) {
  return new Date(redemption.updatedAt).toLocaleString();
}

export default function FulfilmentPanel({
  redemptions,
  isBusy,
  isLoading,
  onUpdateRedemptionStatus,
}: FulfilmentPanelProps) {
  const [filters, setFilters] = useState<{ status: string; audience: string }>({
    status: "",
    audience: "",
  });
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const filteredRedemptions = [...redemptions]
    .filter((redemption) => {
      if (filters.status && redemption.status !== filters.status) {
        return false;
      }

      if (filters.audience && redemption.shopItem.audience !== filters.audience) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const statusDelta = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

  const pendingCount = redemptions.filter((redemption) => redemption.status === "PENDING").length;
  const awaitingCount = redemptions.filter((redemption) => redemption.status === "AWAITING_APPROVAL").length;
  const fulfilledRecentCount = redemptions.filter((redemption) => {
    if (redemption.status !== "FULFILLED") {
      return false;
    }

    return Date.now() - new Date(redemption.updatedAt).getTime() <= 24 * 60 * 60 * 1000;
  }).length;

  const handleStatusUpdate = async (redemption: ShopRedemption, status: "FULFILLED" | "CANCELED") => {
    setUpdatingId(redemption.id);
    try {
      await onUpdateRedemptionStatus(redemption, status);
    } finally {
      setUpdatingId(null);
    }
  };

  const renderAction = (redemption: ShopRedemption) => {
    const isUpdating = isBusy || updatingId === redemption.id;

    if (redemption.status === "PENDING") {
      return (
        <button
          type="button"
          className="primary-action"
          onClick={() => {
            void handleStatusUpdate(redemption, "FULFILLED");
          }}
          disabled={isUpdating}
        >
          Mark fulfilled
        </button>
      );
    }

    if (redemption.status === "AWAITING_APPROVAL") {
      return (
        <button
          type="button"
          onClick={() => {
            void handleStatusUpdate(redemption, "CANCELED");
          }}
          disabled={isUpdating}
        >
          Cancel request
        </button>
      );
    }

    return <span className="review-done">{redemption.status === "FULFILLED" ? "Completed" : "Closed"}</span>;
  };

  return (
    <div className="panel-stack">
      <section className="section fulfilment-section">
        <header className="section-header">
          <div>
            <h2>Run the fulfilment queue</h2>
            <p className="section-help">
              Pending rows have already charged points or wallet currency. Awaiting approval rows stay visible so staff
              can spot stalled requests before they turn into handover work.
            </p>
          </div>
          <div className="fulfilment-summary">
            <span>{pendingCount} pending</span>
            <span>{awaitingCount} awaiting approval</span>
            <span>{fulfilledRecentCount} fulfilled in 24h</span>
          </div>
        </header>

        <div className="submission-filters fulfilment-filters">
          <select
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            aria-label="Filter by redemption status"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending fulfilment</option>
            <option value="AWAITING_APPROVAL">Awaiting approval</option>
            <option value="FULFILLED">Fulfilled</option>
            <option value="CANCELED">Canceled</option>
          </select>
          <select
            value={filters.audience}
            onChange={(event) => setFilters({ ...filters, audience: event.target.value })}
            aria-label="Filter by item audience"
          >
            <option value="">All audiences</option>
            <option value="INDIVIDUAL">Personal</option>
            <option value="GROUP">Group</option>
          </select>
        </div>

        {isLoading && redemptions.length === 0 ? (
          <p className="section-help fulfilment-loading">Loading the latest redemption queue...</p>
        ) : filteredRedemptions.length === 0 ? (
          <p className="empty-cell fulfilment-empty">No redemptions match the current filters.</p>
        ) : (
          <>
            <div className="matrix-scroll fulfilment-table-shell">
              <table className="matrix-table fulfilment-table">
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Item</th>
                    <th scope="col">Requested by</th>
                    <th scope="col">Group</th>
                    <th scope="col">Cost</th>
                    <th scope="col">Approvals</th>
                    <th scope="col">Fulfilment</th>
                    <th scope="col">Updated</th>
                    <th scope="col" className="matrix-table__th--actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRedemptions.map((redemption) => (
                    <tr key={redemption.id}>
                      <td>
                        <span className={`badge ${STATUS_CLASSES[redemption.status]}`}>{STATUS_LABELS[redemption.status]}</span>
                      </td>
                      <td className="fulfilment-item-cell">
                        <strong>
                          <span aria-hidden>{redemption.shopItem.emoji}</span> {redemption.shopItem.name}
                        </strong>
                        <span>{getPurchaseLabel(redemption)}</span>
                      </td>
                      <td>{getRequesterLabel(redemption)}</td>
                      <td>{redemption.group.displayName}</td>
                      <td>{getCostLabel(redemption)}</td>
                      <td>{getApprovalProgress(redemption)}</td>
                      <td className="fulfilment-notes-cell">{redemption.shopItem.fulfillmentInstructions || "\u2014"}</td>
                      <td>
                        <time dateTime={redemption.updatedAt}>{getUpdatedLabel(redemption)}</time>
                      </td>
                      <td className="col-actions fulfilment-actions">{renderAction(redemption)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fulfilment-card-list" aria-label="Fulfilment queue">
              {filteredRedemptions.map((redemption) => (
                <article className="fulfilment-card" key={`${redemption.id}-mobile`}>
                  <div className="fulfilment-card__header">
                    <span className={`badge ${STATUS_CLASSES[redemption.status]}`}>{STATUS_LABELS[redemption.status]}</span>
                    <time dateTime={redemption.updatedAt} className="fulfilment-card__time">
                      {getUpdatedLabel(redemption)}
                    </time>
                  </div>
                  <div className="fulfilment-card__title-row">
                    <div>
                      <h3>
                        <span aria-hidden>{redemption.shopItem.emoji}</span> {redemption.shopItem.name}
                      </h3>
                      <p>{getPurchaseLabel(redemption)}</p>
                    </div>
                    <strong>{getCostLabel(redemption)}</strong>
                  </div>
                  <dl className="fulfilment-card__meta">
                    <div>
                      <dt>Requested by</dt>
                      <dd>{getRequesterLabel(redemption)}</dd>
                    </div>
                    <div>
                      <dt>Group</dt>
                      <dd>{redemption.group.displayName}</dd>
                    </div>
                    <div>
                      <dt>Approvals</dt>
                      <dd>{getApprovalProgress(redemption)}</dd>
                    </div>
                    <div>
                      <dt>Fulfilment</dt>
                      <dd>{redemption.shopItem.fulfillmentInstructions || "\u2014"}</dd>
                    </div>
                  </dl>
                  <div className="fulfilment-card__actions">{renderAction(redemption)}</div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
