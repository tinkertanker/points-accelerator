# Testing Plan

## Recommended rollout shape

Use a separate Discord staging server first. Do not test first on the real class server.

Create:

- 1 admin role
- 1 mentor or alumni role with smaller powers
- 2 to 3 dummy group roles
- 3 to 5 test users spread across those roles
- 1 listing channel
- 1 redemption/log channel

## Pre-deploy checks

Run locally:

1. `npm run build`
2. `npm run test`
3. `npm run e2e`

## Staging checklist

### Dashboard

- Sign in with Discord
- Save settings
- Create role capability rules
- Create group mappings
- Create at least one assignment
- Create at least two shop items
- Confirm leaderboard and ledger render

### Passive earning

- Send one valid message from a grouped test user
- Confirm points and currency both increase as configured
- Confirm cooldown blocks spam
- Confirm denied channels do not reward

### Manual economy actions

- Award a single group within cap
- Award multiple groups from a multi-award role
- Verify over-cap award is rejected
- Verify deduction is blocked for roles without deduct power
- Verify a non-receivable group role cannot be awarded

### Group economy flows

- `/pay` from one test group to another
- `/donate` from a test group
- Verify these affect currency only, not points

### Shop

- Open `/store`
- Buy an item with `/buy`
- Verify currency decreases
- Verify stock decreases for limited items

### Listings

- Create a `/sell` listing from a role with sell permission
- Confirm it posts in the configured listing channel
- Confirm a user without sell permission is rejected

### Submissions

- Register at least two student test users with `/register`
- Verify non-alphanumeric index IDs are rejected
- Submit one assignment with `/submit`
- Confirm an empty submission is rejected
- Run `/submissions` and `/missing` from a staff role
- Confirm a non-staff user is blocked from `/submissions`
- Review a submission with `/review_submission`
- Verify approved and outstanding reviews create `SUBMISSION_REWARD` ledger entries

## Production cutover

1. Deploy the same commit to `economyrice.tk.sg`.
2. Re-run the staging checklist with the production bot in the real server.
3. Keep the old system available for one class cycle if you want rollback insurance.
