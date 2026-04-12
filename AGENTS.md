# AGENTS.md

## Scope

This repository is `points accelerator`, a group-first Discord economy bot.

It is a monorepo with:

- `apps/backend`: Fastify API, Discord bot runtime, Prisma schema, domain services, backend tests
- `apps/frontend`: React + Vite admin dashboard, frontend unit tests, Playwright E2E
- `docs`: deployment, Discord bot setup, and testing notes

## Source of truth

- Edit source files under `apps/backend/src` and `apps/frontend/src`.
- Database changes must go through `apps/backend/prisma/schema.prisma` and Prisma migrations.
- Do not hand-edit generated output under `apps/backend/dist`, `apps/frontend/dist`, or `.vite`.

## Important product constraints

- Groups are the primary accounts.
- The ledger is append-only in practice: corrections should be new entries, not mutation of past balances.
- `points` and `currency` are separate balances. Shop, `/pay`, and `/donate` affect currency, not leaderboard points.
- Betting also affects currency, not leaderboard points.
- Role capability rules are first-class configuration. Avoid hardcoding role names or channel names.
- Staff tiers are defined by Discord role capability rows. A blank `maxAward` means uncapped, not zero.
- Admin auth uses Discord OAuth sessions backed by guild membership and dashboard-capable roles.
- Participants are student registrations. Staff access stays role-based and does not require participant records.
- Student registration requires an alphanumeric index ID and one active group.
- Students can submit text, an image, or both; empty submissions should be rejected.
- Approved and outstanding submissions create `SUBMISSION_REWARD` ledger entries for the student's group. Outstanding adds the bonus reward.
- System-generated rewards must use explicit system paths instead of actor-role permission checks.
- Submission images may be stored in Cloudflare R2, with Discord attachment URLs as fallback when object storage is not configured.
- Betting exclusions require two distinct voters from the same group, and pending votes must stay scoped to that group until they expire or finalize.

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
- Prefer validating group economy flows end-to-end: passive rewards, awards/deductions, `/pay`, `/donate`, `/store`, `/buy`, `/sell`.
- Include `/bet`, `/betstats`, and `/exclusion` when touching betting or currency flow behaviour.
- Prefer validating submission flows end-to-end as well: `/register`, `/submit`, `/submissions`, `/missing`, `/review_submission`, and dashboard review.

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
