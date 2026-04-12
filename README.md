# points accelerator

`points accelerator` is a group-first Discord economy bot for class communities.

It tracks permanent `points` for leaderboards, separate spendable `currency` for the shop and transfers, and a role-driven capability system so each Discord role can be configured for what it can award, deduct, sell, or receive.

It also includes a Discord OAuth dashboard, marketplace listings, and a submission workflow for class use: students register once with an alphanumeric index ID and group, staff publish assignments, students submit work, and approved submissions award their group.

## Monorepo layout

- `apps/backend`: Fastify API, Discord bot, Prisma schema, domain services, and tests
- `apps/frontend`: Vite + React admin dashboard
- `docs`: deployment and configuration notes

## Quick start

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Start PostgreSQL and the apps with `docker compose up --build` or run the services separately.
4. Run database setup with `npm --workspace apps/backend run prisma:migrate`.
5. Start local development with `npm run dev`.

## Testing

- Backend unit and integration: `npm run test:backend`
- Frontend unit: `npm run test:frontend`
- Browser E2E: `npm run e2e`

## Deployment notes

- The app is designed to run with PostgreSQL and can be deployed on a single Docker host with the provided Compose stack.
- Apply schema changes with `docker compose exec backend npx prisma migrate deploy` after each deploy.
- Current dashboard sessions and passive reward cooldowns live in backend memory, so the backend should be treated as a single-instance service unless that state is moved into shared storage.
- The bundled Postgres volume provides persistence, but you still need proper backups.

## Feature focus

- Group-based passive message rewards
- Manual awards and deductions with per-role caps
- Discord ledger command with paging for recent transactions
- Discord-login leaderboard view for any guild member
- Group transfers and donations
- Custom shop with spendable currency
- Marketplace listings with optional Discord channel posting
- Role capability matrix
- Discord OAuth dashboard for staff configuration and review
- Configurable channels and role mappings
- Assignment, participant, and submission tracking
- Submission review with automatic `SUBMISSION_REWARD` ledger entries
- Optional Cloudflare R2 image storage with Discord attachment fallback

## Phase 1 command set

- Staff roles such as admins or alumni: `/award`, `/deduct`
- Students: `/balance`, `/leaderboard`, `/ledger`

## Submission command set

- Students: `/register`, `/submit`
- Staff roles: `/submissions`, `/missing`, `/review_submission`

The dashboard uses Discord sign-in with three access tiers:

- Guild members can sign in to view the leaderboard.
- Mentor roles chosen by admins can manage the shop, assignments, and submission review.
- Guild admins and roles with `canManageDashboard` enabled keep full access to settings and groups.

After signing into the dashboard, use the built-in walkthrough in the control room to configure role powers, map groups, create assignments, and smoke test the commands in Discord.
