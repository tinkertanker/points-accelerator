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

## First-run checklist

1. Configure role capability rules.
2. Ensure at least one trusted admin role has `canManageDashboard` enabled, or rely on Discord server admins for fallback access.
3. Create group mappings for the Discord roles that represent teams.
4. Set listing, redemption, and log channels if you want channel output.
5. Create shop items.
6. Test `/award`, `/pay`, `/donate`, `/store`, `/buy`, and `/sell` in the class server.
