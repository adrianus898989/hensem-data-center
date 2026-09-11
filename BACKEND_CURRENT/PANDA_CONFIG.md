# Panda configuration snapshots

This feature is independent of AR configuration, withdrawal statistics, reasons, Google Sheets and TG. Source settings remain read-only: the private collector only fetches the observed `withdrawal.getAuto` GET with the registered tenant and an existing login. No settings mutation endpoint is implemented.

## Storage and authorization

- `panda_config_targets`: safe platform/country/timezone catalog (54 source registrations).
- `panda_config_daily`: one immutable first capture per platform-local date.
- `panda_config_receipts`: immutable UUID receipts; repeated uploads cannot replace a day row.
- `panda_config_credentials`: SHA-256 hashes of dedicated, expiring, target-scoped upload keys. Never browser keys or Panda login tokens.
- `panda_config_latest`: security-invoker view, read with existing dashboard authentication and `auto_withdraw` permission.

The Edge endpoint uses explicit `X-Config-Key` authentication; gateway JWT verification is disabled for this custom credential. Dashboard sessions have no ingest/RPC/write privileges. The service role has select-only target/credential access and append-only daily/receipt access. RLS with no browser policy on credentials/receipts is intentional default-deny, not an omitted public policy.

`accepted` means the first capture was stored. An identical UUID returns `unchanged`. A different UUID for an already captured local date returns `daily_exists` and the current snapshot UUID, without replacing the day's configuration. A reused UUID with conflicting metadata/hash fails. All requests have bounded, allowlisted data and fixed safe errors.

## Collector and UI

The private complete Python file is delivered separately and is never committed: it retains the user's existing private settings and adds an isolated SQLite outbox/lease. Existing `daily` starts the observer at the original daily schedule. Repeated `config-sync`, restarts and cooperating instances share the same platform-local-day guard. `config-upload` only replays queued snapshots; `config-status` reports actual server metadata. Keep the state directory stable and the computer/program/login available.

All 26 supplied source fields are represented with missing/null/zero distinctions. Only the two nonzero amount-range fields are proven to use /100 display conversion. Other units remain raw unless independently confirmed. The UI preserves unknown enums and IDs, rather than guessing channel/level/game names. Snapshot data is escaped text, with no upstream edits or interactive setting controls.

## Verification

```bash
node tests/panda-auto-withdraw-config.test.cjs
PGLITE_PATH=/path/to/@electric-sql/pglite node tests/panda-config-security.test.cjs
PGLITE_PATH=/path/to/@electric-sql/pglite node tests/ar-config-security.test.cjs
```

Contract/Edge checks: 182. SQL/RLS/day immutability checks: 113. Existing AR checks: 95. Separate private collector tests cover AST preservation, fixed GET, passive authentication, lease expiry, midnight, failed upload and daily receipts.

Live rollout verification uses read-only authenticated receipt queries plus rolled-back SQL assertions; screenshot fixtures are not inserted into production.
