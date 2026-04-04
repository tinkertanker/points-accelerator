# AGENTS.md

## Scope

This repository is `economy rice`, a group-first Discord economy bot.

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
- Role capability rules are first-class configuration. Avoid hardcoding role names or channel names.
- Admin auth currently uses `ADMIN_TOKEN`, not Discord OAuth.

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
- Prefer validating group economy flows end-to-end: passive rewards, awards/deductions, `/pay`, `/donate`, `/store`, `/buy`, `/sell`.

## Deployment

- Production deploys use `docker-compose.prod.yml`.
- The helper script is `scripts/deploy.sh`.
- Current production target is `tinkertanker@dev.tk.sg:/home/tinkertanker-server/Docker/economy-rice`.
- Current public domain is `https://economyrice.tk.sg`.
- Production configuration lives in `.env.production` on the server.

## Relevant docs

- `README.md`
- `docs/testing-plan.md`
- `docs/discord-bot-setup.md`
- `docs/deployment.md`
