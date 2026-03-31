export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function slugify(value: string): string {
  return normalizeIdentifier(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseRoleMention(input: string): string | null {
  const match = input.trim().match(/^<@&(\d+)>$/);
  return match?.[1] ?? null;
}

