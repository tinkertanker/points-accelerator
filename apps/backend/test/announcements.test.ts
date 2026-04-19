import { describe, expect, it } from "vitest";

import { parseChangelogEntry } from "../src/bot/announcements.js";

const CHANGELOG = `# Changelog

Some intro text.

## [0.2.0] - 2026-04-19

### Added
- Announcements channel on GuildConfig.
- Deploy-time announcement trigger.

## [0.1.0] - 2026-04-01

### Added
- Initial release.
`;

describe("parseChangelogEntry", () => {
  it("returns the body between the matching heading and the next heading", () => {
    const entry = parseChangelogEntry(CHANGELOG, "0.2.0");
    expect(entry?.version).toBe("0.2.0");
    expect(entry?.body).toContain("### Added");
    expect(entry?.body).toContain("Deploy-time announcement trigger.");
    expect(entry?.body).not.toContain("Initial release.");
  });

  it("returns null when the version is absent", () => {
    expect(parseChangelogEntry(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("handles the last entry with no following heading", () => {
    const entry = parseChangelogEntry(CHANGELOG, "0.1.0");
    expect(entry?.body).toContain("Initial release.");
  });
});
