# MCP interface

Points Accelerator provides an MCP server for **trusted local AI clients with
stdio support**. Authenticated dashboard administrators can use every exposed
administrator tool, including writes and destructive operations. There is no
separate writes opt-in flag. Mentors, viewers and unauthenticated users cannot
discover or execute these administrator tools.

The local process uses the MCP SDK and calls the running backend's authenticated
API. It does not need database credentials, the Discord bot token, or an
`ADMIN_TOKEN`. It does not start another bot or listen on a network port.

## Connection

1. Install Node.js 22 or newer and check out this repository on the machine
   running your MCP client. From the repository root, install and build:

   ```sh
   npm ci
   npm run build
   ```

2. Deploy/run a backend containing this MCP implementation using the normal
   deployment process. The adapter deliberately fails against older backends;
   it cannot silently fall back to unpinned or unaudited requests. Production
   deployments still require their normal review/deployment authorization.
3. Sign in to that application's dashboard with Discord and select the guild
   you want to administer. Your account must have dashboard **admin** access:
   guild owner, Discord Administrator/Manage Server, or a configured role with
   `canManageDashboard`. A mentor role alone is insufficient.
4. In your browser's developer tools, under Application/Storage → Cookies for
   the application's origin, copy the **value only** of `dashboard_session` to
   your client's private local configuration. Do not copy the entire Cookie
   header. Find the selected guild's ID in the dashboard session response
   (`GET /api/auth/session`, `user.activeGuildId`) or Discord's Copy Server ID
   action with Developer Mode enabled.
5. Add a stdio server to your MCP client's configuration, replacing the example
   paths and values. Use an absolute path to `node` too if your client does not
   inherit your normal PATH:

   ```json
   {
     "mcpServers": {
       "points-accelerator": {
         "command": "node",
         "args": ["/absolute/path/to/points-accelerator/apps/backend/dist/mcp/index.js"],
         "env": {
           "PA_MCP_APP_URL": "https://points.example.com",
           "PA_MCP_SESSION": "<48-hex-dashboard-session-value>",
           "PA_MCP_GUILD_ID": "<selected-discord-guild-id>"
         }
       }
     }
   }
   ```

6. Restart/reconnect the client. It should discover the tools below. Test with
   `get_settings` or `get_leaderboard` before making changes.

`PA_MCP_APP_URL` must be the application's **origin**, without `/api`, another
path, a query, URL credentials or a fragment. HTTPS is mandatory except for
loopback HTTP development origins. The adapter rejects redirects rather than
risk forwarding credentials. Configuration is read from the process environment;
the adapter does not load `.env` or require a particular working directory.

For a source checkout during development, replace `args` with
`["--import", "tsx", "src/mcp/index.ts"]` and set the client's working directory
to `apps/backend`. Production clients should use the built entry point above.
Do not wrap the process in a command that prints banners to stdout: stdout is
reserved for MCP JSON-RPC.

## Supported tools

`tools/list` returns current JSON Schemas generated from the backend's existing
validation schemas. Write bodies go under `input`, URL identifiers under `id`,
and optional read filters under `query`. Actor user IDs/role IDs are not inputs:
the server assigns the authenticated administrator's identity.

| Area | Tools |
| --- | --- |
| Overview/economy reads | `get_bootstrap`, `get_leaderboard`, `get_ledger` |
| Settings and role powers | `get_settings`, `update_settings`, `list_capabilities`, `replace_capabilities` |
| Groups and setup | `list_groups`, `upsert_group`, `suggest_groups`, `apply_group_suggestion`, `apply_setup_preset` |
| Points and participant currency | `adjust_balances`, `transfer_currency`, `donate_currency` |
| Economy corrections | `reset_economy` (reverse entries since a date, cap, set, modulo, or rescale balances) |
| Catalogue | `list_shop_items`, `upsert_shop_item`, `archive_shop_item`, `delete_shop_item` |
| Purchases | `list_shop_redemptions`, `redeem_shop_item`, `approve_group_purchase`, `update_redemption_status` |
| Marketplace | `list_listings`, `create_listing` |
| Participants | `list_participants`, `register_participant`, `delete_participant` |
| Restrictions | `list_sanctions`, `list_participant_sanctions`, `apply_sanction`, `revoke_sanction` |
| Assignments and review | `list_assignments`, `upsert_assignment`, `list_submissions`, `review_submission`, `get_submission_completion` |
| Reaction automation | `list_reaction_rules`, `create_reaction_rule`, `update_reaction_rule`, `delete_reaction_rule` |
| Images | `upload_image` (base64 PNG/JPEG/WebP/GIF, up to 5 MiB decoded, with object storage configured) |

Examples of tool arguments (not HTTP request bodies):

```json
{"query":{"limit":25,"cursor":"<previous-nextCursor>"}}
```

The above is for `get_ledger`; omit `cursor` for the first page.

```json
{"input":{"targetGroupIds":["<group-id>"],"pointsDelta":12,"description":"Workshop contribution"}}
```

The above is for `adjust_balances`. Positive/negative `pointsDelta` awards/deducts
group points. For wallet adjustments, use `targetParticipantId` and positive or
negative `currencyDelta`. Both may be supplied in the same atomic adjustment.

```json
{"input":{"mode":"set-balances","targetGroupPoints":0,"dryRun":true,"note":"Preview only"}}
```

The above previews `reset_economy`. Applying requires an explicit `dryRun:false`;
omitting it is invalid. No production reset is performed during verification.

## Authority and safety

- **This is full administrator authority**, not a scoped read-only credential.
  Treat the session value like a password. Only give it to a trusted local MCP
  client; protect its config file, keep it out of Git/logs/screenshots/prompts,
  and never paste it into chat or Slack. Tool results can contain participant
  identities, index IDs, submissions and Discord membership data, so consider
  the AI provider's data handling before connecting.
- The backend rechecks live Discord membership, administrator access and the
  pinned guild on discovery and every call, then rechecks before dispatch to
  the existing route. A cached tool list grants no authority. Switching guilds
  in the dashboard results in HTTP 409 rather than operating in the new guild.
  MCP cannot switch guilds itself. Discord posting channels selected through
  MCP must be text channels belonging to the selected guild.
- Administrator balance adjustments and listings use explicit privileged paths,
  not fabricated staff roles. Staff award powers, caps and actor cooldowns do
  not limit an authenticated administrator's adjustment. Existing service
  validation, recipient eligibility, sufficient-funds checks, guild-scoped
  lookups and transactions remain in force. The ordinary Discord staff command
  permission model is unchanged.
- Administrators can manage purchases and record approvals **on behalf of any
  eligible participant without that participant's own consent**. A group purchase
  request records its named participant's approval. One administrator can approve
  for additional members and reach the live 50% membership threshold alone,
  completing approval and charging the group's points. Approval rows name the
  participants represented; the audit/ledger actor remains the administrator.
  These are administrator proxy approvals, not evidence of student consent.
  The current catalogue service creates GROUP items even though its legacy
  schema accepts an audience field. Cancellation uses existing refund paths.
- Read current settings/items before replacement-style writes to avoid resetting
  omitted optional fields. `replace_capabilities` replaces the entire role
  configuration and can immediately revoke your own access. Registrations reject
  duplicates; this interface does not invent a participant-edit operation.
- **Participant deletion uses existing database cascades**, deleting associated
  wallet splits, submissions, approvals and sanctions. It is not an append-only
  correction and cannot be reconstructed from MCP audit entries alone. Use
  `reset_economy` for balance corrections and take backups before deletion.
  Shop items with redemption history cannot be deleted; archive them instead.
- Every schema-valid write dispatched by MCP records `mcp.admin.requested` with
  actor, tool and arguments before execution, and `mcp.admin.completed` with
  status and a reference to that request afterward, alongside existing domain
  audit/ledger entries. Invalid/unauthorized requests do not reach mutations.
  Image audit records contain MIME type and byte count, not the image data.
  Audit rows live in the existing `AuditLog` table. Completion status describes
  the API response, not delivery guarantees for Discord or object storage.
- Tool annotations and instructions recommend user confirmation but are not
  approval gates. Your client's per-tool approval settings control when it asks.
  Destructive operations are available without a separate server opt-in.
- Requests time out after 60 seconds and are **never retried automatically**.
  A timeout/disconnect can happen after a write succeeded. Inspect the app and
  audit records before retrying. Creates, payments and applied resets are not
  idempotent; an audit request without completion may have an unknown outcome.

## Session lifetime and troubleshooting

Sessions are the existing in-memory dashboard sessions, renewed by authenticated
requests and expiring after 12 hours of inactivity. Backend restart invalidates
them. Multiple backend replicas require the same session-routing considerations
as the dashboard (this implementation does not add distributed sessions).

- **401:** log in again and replace the local session value. Logging out in the
  originating browser immediately revokes that MCP session too.
- **403:** your live Discord account is not an administrator. Mentors do not gain
  admin access by running the adapter or supplying actor fields.
- **409:** reselect the configured guild in the dashboard, or inspect the
  operation-specific conflict (for example insufficient funds).
- **400/404:** inspect the returned validation message, entity ID and guild.
  Older backend versions lack the MCP gateway and must be updated.
- **503:** a required Discord capability or object storage is unavailable.

The backend's `/api/mcp/tools` and `/api/mcp/call` are authenticated JSON gateway
routes for this adapter, **not** Streamable HTTP/SSE MCP transports. Remote-only
MCP clients and OAuth-based remote delegation are not implemented. Do not expose
the stdio adapter via an unauthenticated network wrapper; remote OAuth, token
scopes, consent and revocation need a separate security design.

## Verification

Run the normal `npm run build`, `npm run test`, and `npm run e2e` commands.
`apps/backend/test/mcp.test.ts` additionally exercises a real SDK stdio client,
HTTP calls to the Fastify backend, and an ephemeral Postgres database. Discord
membership/OAuth and external posting are simulated; no production points,
Discord messages or object-storage uploads are used to verify this feature.
