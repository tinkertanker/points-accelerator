export type StoreAnnouncementKind = "new-item" | "sold-out";

export type StoreAnnouncementItem = {
  name: string;
  description?: string | null;
  emoji?: string | null;
  cost: number | string;
  stock: number | null;
};

export function buildStoreAnnouncementContent(params: {
  kind: StoreAnnouncementKind;
  item: StoreAnnouncementItem;
  pointsName: string;
  pointsSymbol: string;
}) {
  const emoji = params.item.emoji?.trim() ? `${params.item.emoji.trim()} ` : "";
  const itemName = `${emoji}**${params.item.name}**`;
  const price = `${params.item.cost} ${params.pointsName} ${params.pointsSymbol}`;
  const stock =
    params.item.stock === null
      ? "Stock: unlimited"
      : params.item.stock > 0
        ? `Stock: ${params.item.stock} left`
        : "Stock: sold out";

  if (params.kind === "sold-out") {
    return `Store update: ${itemName} is now sold out.\nUse \`/store\` to browse the remaining items.`;
  }

  const description = params.item.description?.trim() ? `\n${params.item.description.trim()}` : "";
  return `New store item: ${itemName}${description}\nCost: ${price}\n${stock}\nUse \`/store\` to browse and \`/buy\` to purchase.`;
}

