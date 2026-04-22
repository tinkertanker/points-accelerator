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
- Confirm group points increase and the sender's personal currency increases
- Confirm cooldown blocks spam
- Confirm denied channels do not reward

### Manual economy actions

- Award a single group within cap
- Award multiple groups from a multi-award role
- Verify over-cap award is rejected
- Verify deduction is blocked for roles without deduct power
- Verify a non-receivable group role cannot be awarded

### Personal wallet flows

- Ensure at least two test users each have exactly one mapped active group role
- `/transfer` from one student to another
- `/donate` from one student
- Verify `/transfer` affects participant currency only
- Verify `/donate` reduces participant currency and increases the caller's group points using the configured conversion rate
- Verify `/balance` auto-creates the wallet view without any manual registration step

### Shop

- Open `/store`
- Buy an item with `/buy personal`
- Verify the buyer's personal currency decreases
- Verify stock decreases for limited items
- Open the dashboard `Fulfilment` tab and mark the personal purchase fulfilled
- Create a `/buy group` request
- Approve it from enough group members with `/approve_purchase`
- Verify the group's shared points are charged and the request moves to pending fulfilment
- Mark the group redemption fulfilled from the dashboard queue

### Listings

- Create a `/sell` listing from a role with sell permission
- Confirm it posts in the configured listing channel
- Confirm a user without sell permission is rejected

### Submissions

- Ensure at least two student test users each have exactly one mapped active group role
- Submit one assignment with `/submit`
- Confirm an empty submission is rejected
- Run `/submissions` and `/missing` from a staff role
- Confirm a non-staff user is blocked from `/submissions`
- Review a submission with `/review_submission`
- Verify approved and outstanding reviews add group points plus personal currency for the submitter

## Production cutover

1. Deploy the same commit to `points-accelerator.tk.sg`.
2. Re-run the staging checklist with the production bot in the real server.
3. Keep the old system available for one class cycle if you want rollback insurance.
