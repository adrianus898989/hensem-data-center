# Collector control service

This is the control plane for a locally installed Python manager. It reports
process state only. It does not inspect order freshness, log in to a source
platform, execute arbitrary shell commands, or send a Telegram report.

The HTTP contract is `collector-control-contract.md` at repository root. Deploy
only after applying `supabase/collector-control.sql` and matching the frontend
role catalog. Its registration preserves the existing catalog and function ACL;
an unexpected production definition aborts the whole transaction. Existing role
assignments, account records, permissions and order data are unchanged. No
database migration or deployment is performed by the tests.

## Authentication and deployment

`supabase/config.toml` must set `functions.collector-control.verify_jwt = false`.
The platform JWT filter cannot accept the random device credential. Authentication
is instead explicit for every action in `handler.ts`:

- Human requests require the data-center Worker's authenticated proxy proof and
  trusted client IP. They validate `/auth/v1/user`, the current approved application
  session and account IP whitelist, then the current active profile. An
  owner may manage; all other users require `mode=assigned`, `canView=true` and
  explicit `collector_control.view` (plus `.edit` for a change). Legacy role
  fallback and user-editable JWT metadata never grant access.
- Pairing consumes a random 128-bit code once, before its ten-minute expiry.
  Polling verifies its separate random 256-bit bearer inside a transaction that
  locks exactly that device. Another device's ID and a revoked token fail.
- All new tables have RLS and no direct anon/authenticated access. RPC helpers
  are SECURITY INVOKER and executable only by service_role. Administrative actor
  IDs originate in fresh Auth, never from submitted JSON. Service keys remain
  in the Edge environment and are not returned to a browser or manager.

Required environment variables are `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`. The entrypoint's CORS origins match the current
official dashboard hosts; review those origins when moving the dashboard.
Human requests use the same-origin Worker route
`/hensem-data-center/api/collector-control`. Its proxy verifier matches
`application-entry-gate`; it does not use the separate login/portal proxy key.
Pairing and polling use the direct Edge endpoint and never accept human actions
under a device credential.

The service stores only pairing/device SHA-256 hashes. API responses never include
stored hashes, source credentials, local file paths or child stdout. Public errors
are fixed codes, and raw upstream errors are neither logged nor returned.

## Behaviour and limits

One manager polls per computer, every 15 seconds, with at most 100 registered
tasks. The service rejects polls less than five seconds apart. Heartbeats update
the device; an unchanged task does not get rewritten. `updatedAt` is the last
observed task-state change, not a claim of fresh order ingestion.

Task revision must match before an admin state change. A request for the same
state at the current revision is a no-op. A repeated old revision returns 409,
requiring a refreshed overview. The server does not create processes itself.

Missing inventory entries become unavailable and lose latent start requests.
Reappearing entries start with desired `stopped`. Up to 100 unavailable entries
are retained per device in addition to the current inventory. Control audit
records retain at most 10,000 rows and 30 days; heartbeats are not audited.

A maximum of 100 active devices is enforced. Revoking a computer invalidates
future polls; it cannot stop already running processes on an offline computer.
If a pairing response is lost before the manager saves its credential, revoke
the unused device shown in the overview, generate another code and pair again.
The consumed code cannot retrieve or reset that device's token.

An outage leaves existing local children running. Newly requested starts wait
for a fresh successful poll. The UI must show offline after 90 seconds without a
heartbeat and must distinguish requested state from observed process state.

## Verification

`tests/collector-control-backend.test.cjs` runs the real handler through mocked
HTTP Auth and database calls against the real SQL in a temporary PGlite database.
It exercises identity freshness, explicit permissions, device isolation, pairing
expiry/consumption/rollback, revision conflicts, absent inventories, bounded
payloads, RLS/function ACLs, error redaction and audit retention. No production
database, source browser, Telegram chat or existing collector is touched.

Run with the repository's Node dependencies:

```sh
node --test tests/collector-control-backend.test.cjs
```
