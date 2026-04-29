# Changelog

All notable user-facing changes are announced by the bot on each redeploy to
the configured announcements channel. Entries follow
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

The bot reads the version from `apps/backend/package.json` on startup,
finds the matching entry here, and announces it once per version.

## [0.5.1] - 2026-04-29

### Fixed
- React-to-reward editor: layout now fits on a single row, channel and bot user ID persist across consecutive adds (so chaining ✅ then ❌ on the same bot is two clicks), the emoji column is tightened, the "Note" field is renamed to "Label" with a dashboard-only tooltip, and the misleading green-tick placeholder is gone.
- React-to-reward editor: the currency delta field now accepts negative numbers. The previous `type="number"` input was silently rejecting `-` mid-edit and snapping back to a positive value, which blocked any deduction rule from being created.

## [0.5.0] - 2026-04-29

### Added
- React-to-reward rules: admins can configure a channel + bot user + emoji to credit or debit the message author's wallet currency when that bot reacts. Each reaction credits at most once. Both unicode (✅) and custom emoji (paste either the raw `<:name:id>` form or the bare ID) are accepted.
- `/luckydraw` — random-winner currency giveaways with a configurable prize, winner count, and entry window.
- Shop fulfilment can now be handled directly from chat: fulfilment messages carry buttons so handlers don't need to switch to the dashboard for routine cases.

## [0.4.0] - 2026-04-23

### Added
- `/award currencybulk` — award wallet currency to an explicit list of up to 10 members by mention or ID in one shot.

### Changed
- Award, deduct, and buy commands are grouped under parent commands with subcommands. Old flat names no longer appear in the Discord picker:
  - `/awardpoints` → `/award points`
  - `/awardcurrency` → `/award currency`
  - `/awardcurrencybulk` → `/award currencygroup`
  - `/deductgroup` → `/deduct group`
  - `/deductmember` → `/deduct member`
  - `/deductmixed` → `/deduct mixed`
  - `/buyforme` → `/buy personal`
  - `/buyforgroup` → `/buy group`
- `/award currencygroup` keeps the "award currency to every eligible member in the selected groups" behaviour that used to live on `/awardcurrencybulk`.

### Removed
- The placeholder `/awardmixed` command (it only ever returned a "disabled" error). Use `/award points` and `/award currency` together when both balances should change.

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
