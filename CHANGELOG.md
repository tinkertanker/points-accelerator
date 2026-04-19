# Changelog

All notable user-facing changes are announced by the bot on each redeploy to
the configured announcements channel. Entries follow
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

The bot reads the version from `apps/backend/package.json` on startup,
finds the matching entry here, and announces it once per version.

## [0.2.0] - 2026-04-19

### Added
- Announcements channel on `GuildConfig` so admins can pick a Discord channel
  for release notes from the dashboard.
- Deploy-time announcement: the bot posts the latest changelog entry to the
  announcements channel once per version bump.
- `/release-announce` Claude Code skill that drafts a new changelog entry
  from git history and bumps the backend package version.
