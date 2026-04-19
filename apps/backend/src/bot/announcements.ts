import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = resolve(MODULE_DIR, "..", "..", "package.json");
const CHANGELOG_PATH = resolve(MODULE_DIR, "..", "..", "..", "..", "CHANGELOG.md");

export type ChangelogEntry = {
  version: string;
  body: string;
};

export async function readBackendVersion(): Promise<string | null> {
  try {
    const raw = await readFile(PACKAGE_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : null;
  } catch {
    return null;
  }
}

export async function readChangelogEntry(version: string): Promise<ChangelogEntry | null> {
  let raw: string;
  try {
    raw = await readFile(CHANGELOG_PATH, "utf8");
  } catch {
    return null;
  }
  return parseChangelogEntry(raw, version);
}

export function parseChangelogEntry(changelog: string, version: string): ChangelogEntry | null {
  const headingPattern = /^##\s+\[([^\]]+)\](.*)$/gm;
  const matches = Array.from(changelog.matchAll(headingPattern));
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (match[1] !== version) continue;
    const start = (match.index ?? 0) + match[0].length;
    const next = matches[i + 1];
    const end = next?.index ?? changelog.length;
    const body = changelog.slice(start, end).trim();
    return { version, body };
  }
  return null;
}
