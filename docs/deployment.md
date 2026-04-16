# Deployment

## Environment

Set these in your `.env` file before deploying:

- `DATABASE_URL`
- `APP_PUBLIC_URL`
- `GUILD_ID`
- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `APP_DOMAIN`
- `DISCORD_OAUTH_REDIRECT_URI` if your OAuth callback does not live at `${APP_PUBLIC_URL}/api/auth/discord/callback`
- `POSTGRES_VOLUME_NAME` if you need to keep using a legacy Docker volume name during a rename cutover

## Local verification

1. `npm install`
2. `npm --workspace apps/backend run prisma:generate`
3. `npm run build`
4. `npm run test`
5. `npm run e2e`

## Docker Compose deploy

1. Ensure the external `devtksg` Docker network exists.
2. Copy `.env.example` to `.env` and fill in real values.
3. Run `docker compose up -d --build`.
4. Run `docker compose exec backend npx prisma migrate deploy`.
5. In the Discord Developer Portal OAuth2 settings, add `${APP_PUBLIC_URL}/api/auth/discord/callback` as a redirect URI unless you set `DISCORD_OAUTH_REDIRECT_URI` explicitly.
6. Visit the public app URL and sign in with Discord.

## Database and runtime notes

- The production stack is designed to run against PostgreSQL in Docker and is suitable for a single-host deployment.
- Prisma migrations are the supported way to evolve the schema. After pulling a new release, run `docker compose exec backend npx prisma migrate deploy` before relying on the new code path.
- The backend now adds explicit indexes for ledger history, passive reward dedupe, submissions, audit logs, and common dashboard list views. This improves behaviour once the ledger and submission tables grow.
- Dashboard sessions are currently stored in backend process memory, so signing users out on backend restart is expected.
- Passive message reward cooldowns are also stored in backend process memory, so cooldown state resets on backend restart.
- Because sessions and cooldowns are in memory, the current deployment model should be treated as single-instance. Do not scale the backend horizontally unless you first move that state into shared storage such as Redis or Postgres.
- The bundled `postgres` service uses a Docker volume for persistence. That is convenient, but it is not a backup strategy; schedule regular `pg_dump` or volume snapshots if the data matters.
- If you are renaming an existing `economy-rice` deployment in place, either keep `POSTGRES_VOLUME_NAME` pointed at the existing Docker volume for the first rollout or migrate the volume contents before switching names. If you reuse that existing Postgres data directory, keep `DATABASE_URL`, `POSTGRES_DB`, and `POSTGRES_USER` aligned with the legacy database and role until you perform an explicit database/user rename.

## First-run checklist

1. Configure role capability rules.
2. Ensure at least one trusted admin role has `canManageDashboard` enabled, or rely on Discord server admins for fallback access.
3. Create group mappings for the Discord roles that represent teams.
4. Set listing, redemption, and log channels if you want channel output.
5. Create shop items.
6. Test `/award`, `/transfer`, `/donate`, `/store`, `/buyforme`, `/buyforgroup`, and `/sell` in the class server.
