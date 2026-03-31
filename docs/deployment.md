# Deployment

## Environment

Set these in your `.env` file before deploying:

- `DATABASE_URL`
- `GUILD_ID`
- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `ADMIN_TOKEN`
- `FRONTEND_DOMAIN`
- `BACKEND_DOMAIN`

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
5. Visit the frontend domain and sign in with `ADMIN_TOKEN`.

## First-run checklist

1. Configure role capability rules.
2. Create group mappings for the Discord roles that represent teams.
3. Set listing, redemption, and log channels if you want channel output.
4. Create shop items.
5. Test `/award`, `/pay`, `/donate`, `/store`, `/buy`, and `/sell` in the class server.

