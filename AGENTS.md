# AGENTS.md

## Scope

This repository is `points accelerator`, a group-first Discord economy bot with group points and participant wallets.

It is a monorepo with:

- `apps/backend`: Fastify API, Discord bot runtime, Prisma schema, domain services, backend tests
- `apps/frontend`: React + Vite admin dashboard, frontend unit tests, Playwright E2E
- `docs`: deployment, Discord bot setup, and testing notes

## Source of truth

- Edit source files under `apps/backend/src` and `apps/frontend/src`.
- Database changes must go through `apps/backend/prisma/schema.prisma` and Prisma migrations.
- Do not hand-edit generated output under `apps/backend/dist`, `apps/frontend/dist`, or `.vite`.

## Important product constraints

- Groups are the primary accounts for points and leaderboard state.
- The ledger is append-only in practice: corrections should be new entries, not mutation of past balances.
- `points` are group-based, leaderboard-visible, and spendable for `/buyforgroup`.
- Spendable `currency` is participant-based for `/transfer`, `/buyforme`, and donation conversion.
- `/donate` converts participant currency into group points using the configured guild rate.
- Group purchases are approval-driven: a request waits for at least 50% of the current group role membership to approve, then charges the shared group points balance.
- Betting affects participant wallet currency, not group points.
- Role capability rules are first-class configuration. Avoid hardcoding role names or channel names.
- Staff tiers are defined by Discord role capability rows. A blank `maxAward` means uncapped, not zero.
- Admin auth uses Discord OAuth sessions backed by guild membership and dashboard-capable roles.
- Participants are Discord-linked student records. Staff access stays role-based and does not require participant records.
- Students are auto-provisioned from Discord identity plus one active mapped group role. Index IDs are internal metadata, not a required student-facing setup step.
- Students can submit text, an image, or both; empty submissions should be rejected.
- Approved and outstanding submissions create `SUBMISSION_REWARD` group ledger entries for points and participant wallet entries for currency. Outstanding adds the bonus reward.
- System-generated rewards must use explicit system paths instead of actor-role permission checks.
- Submission images may be stored in Cloudflare R2, with Discord attachment URLs as fallback when object storage is not configured.

## Common commands

From the repo root:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run e2e`

Useful backend commands:

- `npm --workspace apps/backend run prisma:generate`
- `npm --workspace apps/backend run prisma:migrate`
- `npm --workspace apps/backend run prisma:dev`

## Testing expectations

- Run `npm run build`, `npm run test`, and `npm run e2e` before handing off substantial changes.
- If you change backend behavior, add or update Vitest coverage in `apps/backend/test`.
- If you change dashboard flows, add or update frontend tests and Playwright coverage where practical.
- Backend Vitest currently uses one ephemeral Postgres per test file; do not enable file-level parallelism unless the harness is isolated per worker.
- If `BootstrapPayload` changes, keep `apps/frontend/src/designPreview.ts` and Playwright bootstrap mocks in sync.
- Prefer validating the split economy end-to-end: passive rewards, awards/deductions, `/transfer`, `/donate`, `/store`, `/buyforme`, `/buyforgroup`, `/approve_purchase`, and `/sell`.
- Prefer validating submission flows end-to-end as well: auto-provisioned participants, `/submit`, `/submissions`, `/missing`, `/review_submission`, and dashboard review.
- Include `/bet` and `/betstats` when touching betting or participant currency flow behaviour.

## Release announcements

- The bot posts the latest `CHANGELOG.md` entry to `GuildConfig.announcementsChannelId` once per backend version on `ready`. `lastAnnouncedVersion` on `GuildConfig` keeps restarts idempotent.
- Version is read from `apps/backend/package.json`. CHANGELOG is parsed by matching `## [x.y.z]` headings — keep that format.
- Before a deploy that should announce something, run the `/release-announce` skill: it drafts a grouped entry (Added / Changed / Fixed) from git history since the previous version, bumps `apps/backend/package.json`, and prepends the entry to `CHANGELOG.md`. Without a version bump + new entry, the bot stays silent on redeploy.
- `CHANGELOG.md` must be copied into the backend image (the Dockerfile already does this) — the runtime looks for it next to `package.json` in prod, monorepo root in dev.
- The announcements channel is selected in the dashboard Settings → Discord channels dropdown; `lastAnnouncedVersion` is bot-managed and not user-editable.

## Deployment

- Production deploys use `docker-compose.prod.yml`.
- The helper script is `scripts/deploy.sh`.
- Docker or build stages that run `npm install` must copy `apps/backend/prisma` before install because backend `postinstall` runs Prisma generate.
- Rename-sensitive deployment defaults live in `scripts/deploy.sh` and `.env.production.example`; migrate any legacy `economy-rice` server paths, volumes, or domains explicitly.
- Production configuration lives in `.env.production` on the server.

## Relevant docs

- `README.md`
- `docs/testing-plan.md`
- `docs/discord-bot-setup.md`
- `docs/deployment.md`
