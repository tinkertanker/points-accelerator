---
name: release-announce
description: Draft a new CHANGELOG.md entry from recent git history and bump apps/backend/package.json. Use when the user says "prep a release", "release-announce", "draft changelog", or is about to redeploy and wants the bot to announce new features.
---

# release-announce

The bot posts the latest `CHANGELOG.md` entry to the configured announcements
channel on startup, **once per backend version**. To trigger a fresh
announcement on the next redeploy, follow this flow:

## Inputs you need

- The current version in `apps/backend/package.json` (call this `prev`)
- The git log since the previous version entry in `CHANGELOG.md` (use the tag
  `v<prev>` if it exists, otherwise the date on the previous heading)
- A target new version (ask the user if unclear — default to a minor bump
  for new features, patch for fixes only)

## Steps

1. **Read** `apps/backend/package.json` to get `prev`.
2. **Read** `CHANGELOG.md` and note the most recent `## [x.y.z]` heading.
3. **Collect commits** since that version:
   ```
   git log v<prev>..HEAD --no-merges --pretty=format:'%h %s'
   ```
   If the tag does not exist, fall back to the date on the previous heading:
   ```
   git log --since=<YYYY-MM-DD> --no-merges --pretty=format:'%h %s'
   ```
4. **Group commits** into user-facing buckets. Use only these sections, in
   this order, and omit empty ones:
   - `### Added` — new features the user can see/use
   - `### Changed` — behavioural changes to existing features
   - `### Fixed` — bug fixes
   - `### Removed` — features taken out
5. **Rewrite commit messages as user-facing bullets.** Strip conventional-
   commit prefixes (`feat:`, `fix:`, etc.), drop refactors / chores / test
   scaffolding / dependency bumps, and describe the outcome, not the diff.
   One bullet per meaningful change — merge related commits into one line.
6. **Pick the new version** (`next`) using semver:
   - `Added` present → minor bump
   - Only `Fixed` / `Changed` → patch bump
   - Breaking change in `Changed`/`Removed` → major bump (confirm with user)
7. **Prepend** the new entry to `CHANGELOG.md` immediately after the intro
   paragraph, using this exact shape:
   ```markdown
   ## [<next>] - <YYYY-MM-DD>

   ### Added
   - ...

   ### Fixed
   - ...
   ```
   Use today's date in ISO format. The heading `## [<next>]` is required —
   the bot matches on it verbatim to find the entry.
8. **Bump** `apps/backend/package.json` `version` to `<next>`.
9. **Do not** edit `lastAnnouncedVersion` anywhere — the bot manages that on
   its own.
10. **Show the diff** and ask the user to confirm before committing. Do not
    tag or push unless asked.

## Notes

- The bot announces at most once per version. If you bump the version but
  forget to add a `CHANGELOG.md` entry for it, nothing is posted (the bot
  silently skips missing entries).
- The body of the entry is sent as a Discord embed description, capped at
  4000 characters. Keep bullets short.
- Keep the intro paragraph at the top of `CHANGELOG.md` intact — only the
  version entries below it are parsed.
