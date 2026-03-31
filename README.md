# economy rice

`economy rice` is a group-first Discord points bot for class communities.

It tracks permanent `points` for leaderboards, separate spendable `currency` for the shop and transfers, and a role-driven capability system so each Discord role can be configured for what it can award, deduct, sell, or receive.

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

## Feature focus

- Group-based passive message rewards
- Manual awards and deductions with per-role caps
- Group transfers and donations
- Custom shop with spendable currency
- Role capability matrix
- Configurable channels and role mappings

