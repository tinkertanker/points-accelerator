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

## CI timing and coverage

CI keeps the `test` job on `ubuntu-latest`, PostgreSQL 15, migration deployment,
both workspace builds/typechecks, and both Vitest suites. Feature branches run
on `pull_request`, not standalone pushes; pushes to `main` and all tags still
run. PR checks test GitHub's synthetic merge ref, not the branch head alone.
Branches without an open PR receive no CI; merge-conflicted PRs also receive no
CI until their conflicts are resolved, without the former push-check fallback.
This preserves the check set under the PR-first policy, not every previously
checked revision.

Competing runs of the same PR cancel each other; concurrency does not compare
commit age. Re-running an older PR workflow can cancel a newer running workflow,
so re-run the latest commit when current checks are active. Push runs have unique
concurrency groups so even pending main/tag checks cannot replace each other.
There are no path filters or conditional check skips. Playwright remains a
local pre-deploy check; it was not part of the original CI job.

### Measurement baseline (2026-11-04)

Audited the latest 150 CI runs (2026-05-09 through 2026-11-03): 148 successful,
2 awaiting approval. Job duration median/p95 was 83/95 seconds. The 146
first-attempt jobs had creation-to-job-start median/p95 of 3/10 seconds; this
is a scheduling/queue proxy, not a separate measurement of runner provisioning.
Step timing was available for 123 successful jobs:

| Step | Median | p95 |
| --- | ---: | ---: |
| Initialize PostgreSQL container | 22s | 26s |
| Checkout | 1s | 2s |
| Node setup and npm cache restore | 3s | 7s |
| `npm install` | 15s | 19s |
| Explicit Prisma generation | 1s | 2s |
| Migration deployment | 1s | 2s |
| Build | 14s | 16s |
| Test | 21s | 27s |

44 branch/SHA pairs ran both push and PR CI. Those paired push jobs consumed
3,662 seconds and are removed under the PR-first policy. This was overlapping
work, not identical executions: push jobs checked branch heads, while PR jobs
checked synthetic merge commits. Another 17 non-main push runs had no matching
PR branch/SHA pair in the sample; the policy removes standalone branch checks too.

Of the latest 20 logs, 17 restored the npm cache. The three
misses preceded or seeded the current main cache; all 15 sampled runs after that seed
hit. Keep `setup-node`'s lockfile-keyed npm download cache and main pushes;
there is no evidence for a new cache service or a `node_modules` cache.
An example baseline is [run 41588823572](https://github.com/tinkertanker/points-accelerator/actions/runs/41588823572).

### Changes and local verification

- PostgreSQL was ready an observed median 13.18s before Actions noticed it
  in those 20 logs. Probe every 2s instead of 10s, with 25 instead of 5 retries
  to retain the roughly 50s retry window. Probe TCP so the image's temporary
  initialization server, which only accepts Unix-socket connections, cannot
  satisfy readiness. Three alternating local Docker trials per setting measured
  median container-launch-to-healthy time of **11.70s → 3.85s**, excluding image
  pull; this does not include Actions' own polling backoff.
- `npm ci --prefer-offline` passed with both a warm and an empty npm cache,
  with unchanged lockfile bytes. Three fresh-install trials per command on
  Node 22.23.4/npm 10.9.9 measured warm medians **17.41s (`npm install`) → 16.86s
  (`npm ci`)**; cold `npm ci` took 23.77s. The install speed difference is small;
  deterministic lockfile enforcement is the main benefit. Audit and all install
  lifecycle scripts remain enabled.
- Backend `postinstall` generates Prisma Client, so the standalone generation
  step is redundant. Keep `prebuild`/`pretest` hooks for standalone commands.
  All 41 migrations applied to a fresh disposable PostgreSQL 15 container;
  migration deployment remains necessary because the test harness uses an
  existing `DATABASE_URL` without migrating it.
- Tests import source and passed with both `dist` directories absent: **295
  backend + 36 frontend tests**. Builds passed (17.63s); tests passed again
  afterward (29.76s); Playwright passed **3/3** (24.16s including npm startup).
  Keep sequential execution: the current build/test hooks both write Prisma's
  generated client, and backend files share one database with parallelism off.
- Actionlint 1.7.12 and a trigger/concurrency contract check passed. The workflow
  changes have not yet run on GitHub; local Docker timings are not a claimed
  end-to-end hosted-run speedup. No runner tier or paid service changed.

To repeat the audit, fetch workflow runs with `gh api
repos/tinkertanker/points-accelerator/actions/workflows/ci.yml/runs`, fetch each
run's `/actions/runs/{id}/jobs`, and inspect logs with `gh run view {id} --log`.
Compare job/step timestamps and cache-hit messages, separating attempts and
missing step records. Benchmark installs in disposable clean checkouts, alternate
commands, and check lockfile hashes; never use an existing development database
for migration or integration-test timing.

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
- Create a `/buy group` request
- Verify stock decreases for limited items
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
