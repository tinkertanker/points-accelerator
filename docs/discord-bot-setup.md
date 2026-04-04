# Discord Bot Setup

## 1. Create the Discord application

1. Open the Discord Developer Portal.
2. Create a new application called `economy rice`.
3. Under **Bot**, add a bot user.
4. Enable these privileged intents:
   - Server Members Intent
   - Message Content Intent

## 2. Collect the IDs and token

You will need:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
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
- `DISCORD_GUILD_ID`
- `GUILD_ID`
- `ADMIN_TOKEN`

## 5. First-run dashboard setup

After deployment:

1. Sign in at `https://economyrice.tk.sg` with `ADMIN_TOKEN`.
2. Follow the **Phase 1 walkthrough** shown in the control room.
3. Create role capability rules for admin and alumni roles.
4. Map each student group role to a group entry.
5. Set listing, redemption, and log channels.
6. Add shop items if you want the shop enabled during phase 1.

## 6. Test commands

Run these in the test server before production rollout:

- `/award`
- `/deduct`
- `/leaderboard`
- `/balance`
- `/ledger`
- `/pay`
- `/donate`
- `/store`
- `/buy`
- `/sell`
