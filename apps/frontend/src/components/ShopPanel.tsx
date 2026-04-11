import type { ShopItemDraft } from "../types";

type ShopPanelProps = {
  shopDrafts: ShopItemDraft[];
  isBusy: boolean;
  createShopDraft: () => ShopItemDraft;
  onShopDraftsChange: (next: ShopItemDraft[]) => void;
  onSaveShop: () => Promise<void>;
};

export default function ShopPanel({
  shopDrafts,
  isBusy,
  createShopDraft,
  onShopDraftsChange,
  onSaveShop,
}: ShopPanelProps) {
  return (
    <div className="panel-stack">
      <article className="section">
        <header className="section-header">
          <h2>Edit the shop catalogue</h2>
          <button className="primary-action" type="button" onClick={() => void onSaveShop()} disabled={isBusy}>
            Save Shop
          </button>
        </header>
        <div className="shop-catalog-matrix">
          <div className="matrix-scroll">
            <table className="matrix-table shop-table">
              <thead>
                <tr>
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
                  <th scope="col" className="matrix-table__th--center col-enabled">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {shopDrafts.map((item, index) => (
                  <tr key={`${item.id ?? "new"}-${index}`}>
                    <td className="col-name">
                      <input
                        value={item.name}
                        aria-label="Item name"
                        onChange={(event) => {
                          const next = [...shopDrafts];
                          next[index] = { ...item, name: event.target.value };
                          onShopDraftsChange(next);
                        }}
                        placeholder="Item name"
                      />
                    </td>
                    <td className="col-description">
                      <input
                        value={item.description}
                        aria-label="Description"
                        onChange={(event) => {
                          const next = [...shopDrafts];
                          next[index] = { ...item, description: event.target.value };
                          onShopDraftsChange(next);
                        }}
                        placeholder="Shown in the shop"
                      />
                    </td>
                    <td className="col-cost">
                      <input
                        type="number"
                        value={item.currencyCost}
                        aria-label="Cost in currency"
                        onChange={(event) => {
                          const next = [...shopDrafts];
                          next[index] = { ...item, currencyCost: Number(event.target.value) };
                          onShopDraftsChange(next);
                        }}
                        placeholder="0"
                      />
                    </td>
                    <td className="col-stock">
                      <input
                        type="number"
                        value={item.stock ?? ""}
                        aria-label="Stock"
                        onChange={(event) => {
                          const next = [...shopDrafts];
                          next[index] = { ...item, stock: event.target.value ? Number(event.target.value) : null };
                          onShopDraftsChange(next);
                        }}
                        placeholder="∞"
                      />
                    </td>
                    <td className="col-fulfil">
                      <input
                        value={item.fulfillmentInstructions ?? ""}
                        aria-label="Fulfilment notes"
                        onChange={(event) => {
                          const next = [...shopDrafts];
                          next[index] = { ...item, fulfillmentInstructions: event.target.value };
                          onShopDraftsChange(next);
                        }}
                        placeholder="How to redeem"
                      />
                    </td>
                    <td className="col-enabled">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        aria-label="Enabled"
                        onChange={(event) => {
                          const next = [...shopDrafts];
                          next[index] = { ...item, enabled: event.target.checked };
                          onShopDraftsChange(next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="matrix-add-row"
            onClick={() => onShopDraftsChange([...shopDrafts, createShopDraft()])}
          >
            + Add shop item
          </button>
        </div>
      </article>
    </div>
  );
}
