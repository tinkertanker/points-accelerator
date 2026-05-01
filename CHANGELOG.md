# Changelog

All notable user-facing changes are announced by the bot on each redeploy to
the configured announcements channel. Entries follow
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

The bot reads the version from `apps/backend/package.json` on startup,
finds the matching entry here, and announces it once per version.

## [0.6.0] - 2026-05-01

### Added
- **Admin tools** dashboard tab housing two new features for keeping the economy under control.
- **Economy reset tool** — four modes for recovering from runaway balances: keep the last N digits (modulo), cap at a maximum, reverse ledger entries since a timestamp, or set everyone to a fixed value (the ☢️ Nuke option). Every mode has a dry-run preview, and all writes are append-only `CORRECTION` ledger entries — nothing is destroyed; everything is auditable.
- **Per-participant sanctions** — timeout specific participants from betting, passive earnings, shop purchases, transfers, or receiving rewards. Reason and optional expiry per sanction; revoke any time.
- **Activity channel allowlists with a wrong-channel tax** — restrict `/bet`, `/luckydraw`, points commands (`/award`, `/deduct`, `/transfer`, `/donate`), and shop commands to designated channels. Running them elsewhere costs the offender a configurable currency penalty (capped at their balance — never goes negative) and gets called out publicly in the channel. Empty allowlist = no restriction.

### Changed
- `/luckydraw` minimum duration raised from 10 seconds to 5 minutes — so draws are actually winnable.
- `/luckydraw` prize cap — `prize × winners` must now fit under the caller's role `maxAward`. Admins with no max are still uncapped. The previous "system action" bypass is gone.

## [0.5.2] - 2026-04-29

### Changed
- `/balance` now replies with an embed styled to match `/forbes`: your group's shared points and your personal wallet sit side-by-side, each with your current rank on the matching leaderboard, and your display name and avatar are shown at the top.

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
