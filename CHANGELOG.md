# Changelog

All notable user-facing changes are announced by the bot on each redeploy to
the configured announcements channel. Entries follow
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

The bot reads the version from `apps/backend/package.json` on startup,
finds the matching entry here, and announces it once per version.

## [0.3.0] - 2026-04-22

### Added
- Per-role rigged bet win chance: members with specific Discord roles can be given a different win probability than the guild default, configurable from the dashboard.
- `/inventory` command for browsing the shop items you've bought, with `personal` and `group` variants.
- `/store` split into `personal` and `group` subcommands so each audience gets its own embed.
- Prev/Next pagination on `/ledger`, `/leaderboard`, `/forbes`, `/store`, and `/inventory` for walking further back through history. Pagination buttons on public commands are locked to the person who ran them.

### Changed
- `/ledger page:` integer option removed in favour of the new Prev/Next buttons.

### Fixed
- Betting stats and shop totals no longer show floating-point drift like `-63.29000000000008`; currency arithmetic stays on Prisma's Decimal end-to-end.

## [0.2.0] - 2026-04-19

### Added
- Announcements channel on `GuildConfig` so admins can pick a Discord channel
  for release notes from the dashboard.
- Deploy-time announcement: the bot posts the latest changelog entry to the
  announcements channel once per version bump.
- `/release-announce` Claude Code skill that drafts a new changelog entry
  from git history and bumps the backend package version.
