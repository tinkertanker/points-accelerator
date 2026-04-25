# points accelerator

`points accelerator` is a group-first Discord economy bot for class communities.

It tracks group `points` that drive the leaderboard and also fund shared group purchases, separate spendable personal `currency` for wallet transfers and personal purchases, and a role-driven capability system so each Discord role can be configured for what it can award, deduct, sell, or receive.

It also includes a Discord OAuth dashboard, marketplace listings, and a submission workflow for class use: students are auto-provisioned from their Discord identity and active group role, staff publish assignments, students submit work, and approved submissions award group points plus personal currency.

The bot also supports participant-wallet betting: students can place double-or-nothing bets against their own wallet currency and view personal betting stats.

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
- Current dashboard sessions plus passive and role-based award/deduct cooldowns live in backend memory, so the backend should be treated as a single-instance service unless that state is moved into shared storage.
- The bundled Postgres volume provides persistence, but you still need proper backups.

## Feature focus

- Group-based passive message points with participant wallet rewards
- Configurable award/deduct cooldowns in the role matrix with admin bypass
- Manual awards and deductions with per-role caps
- Discord ledger command with paging for recent transactions
- Discord-login leaderboard view for any guild member
- Participant wallet transfers plus wallet-to-group point donations
- Custom shop with personal purchases and majority-approved group purchases
- Staff fulfilment queue for recorded and approved store redemptions
- Participant wallet betting with configurable win chance
- Lucky-draw giveaways: button-entry, random winner picking, automatic currency payout
- Marketplace listings with optional Discord channel posting
- Role capability matrix
- Discord OAuth dashboard for staff configuration and review
- Configurable channels and role mappings
- Assignment, participant, and submission tracking
- Submission review with automatic `SUBMISSION_REWARD` ledger entries
- Optional Cloudflare R2 image storage with Discord attachment fallback

## Command set

- Staff roles such as admins or alumni: `/award points`, `/award currency`, `/award currencygroup`, `/award currencybulk`, `/deduct group`, `/deduct member`, `/deduct mixed`, `/luckydraw`
- Students: `/balance`, `/leaderboard`, `/forbes`, `/ledger`, `/transfer`, `/donate`, `/store`, `/buy personal`, `/buy group`, `/approve_purchase`, `/bet`, `/betstats`

The award and deduct flows are split into subcommands so Discord enforces the required fields:

- `/award points` or `/deduct group` for group points
- `/award currency`, `/award currencygroup`, `/award currencybulk`, or `/deduct member` for participant wallet currency
- `/deduct mixed` when both group points and participant currency should change together
- `/award currencybulk` takes a `members` string with up to 10 mentions or IDs; `/award currencygroup` awards every eligible member in the selected groups
- `reason` is optional on each subcommand; the target and amount fields are required

For lucky draws, run `/luckydraw duration:<e.g. 5m> prize:<int> [winners:<n>] [description:<text>]`. Members click the 🎲 Enter button on the announcement to take part; the bot picks the configured number of winners at random when the timer ends and pays each one the prize.

## Submission command set

- Students: `/submit`
- Staff roles: `/submissions`, `/missing`, `/review_submission`

The dashboard uses Discord sign-in with three access tiers:

- Guild members can sign in to view the leaderboard.
- Mentor roles chosen by admins can manage the shop, fulfilment queue, assignments, and submission review.
- Guild admins and roles with `canManageDashboard` enabled keep full access to settings and groups.

After signing into the dashboard, use the built-in walkthrough in the control room to configure role powers, map groups, create assignments, and smoke test the commands in Discord.

For betting, review `Bet win chance (%)` in the dashboard settings before testing `/bet`; it defaults to `50` if you do not change it.
