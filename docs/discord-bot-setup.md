# Discord Bot Setup

## 1. Create the Discord application

1. Open the Discord Developer Portal.
2. Create a new application called `points accelerator`.
3. Under **Bot**, add a bot user.
4. Enable these privileged intents:
   - Server Members Intent
   - Message Content Intent

## 2. Collect the IDs, bot token, and OAuth secret

You will need:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `GUILD_ID`

`DISCORD_GUILD_ID` and `GUILD_ID` can both be your class server ID.

## 3. Install the bot into a test server first

Use the OAuth URL generator with:

- Scopes:
  - `bot`
  - `applications.commands`
- Bot permissions:
  - View Channels
  - Send Messages
  - Read Message History
  - Use Slash Commands

## 4. Fill the environment file

In `.env.production` set:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `GUILD_ID`
- `APP_PUBLIC_URL`
- `APP_DOMAIN`

In the Discord Developer Portal, add this redirect URI under **OAuth2**:

- `${APP_PUBLIC_URL}/api/auth/discord/callback`

If your deployment uses a dedicated OAuth callback override, set and register `DISCORD_OAUTH_REDIRECT_URI` to that same value instead.

## 5. First-run dashboard setup

After deployment:

1. Sign in at `https://points-accelerator.tk.sg` with Discord.
2. Follow the **Phase 1 walkthrough** shown in the control room.
3. Create role capability rules for admin and alumni roles, and mark trusted staff roles with `canManageDashboard`.
4. Map each student group role to a group entry.
5. Set listing, redemption, and log channels.
6. Add shop items if you want the shop enabled during phase 1.
7. Set `Bet win chance (%)` in the dashboard if you want betting enabled for test users.

## 6. Test commands

Run these in the test server before production rollout:

- `/award`
- `/deduct`
- `/leaderboard`
- `/balance`
- `/ledger`
- `/transfer`
- `/donate`
- `/bet`
- `/betstats`
- `/exclusion`
- `/store`
- `/buyforme`
- `/buyforgroup`
- `/approve_purchase`
- `/sell`

For `/exclusion`, verify that two different members of the same group can exclude a teammate for one week, and that a vote from another group does not finalise the pending exclusion.
