# New detailed-admin order read contract

SQL: `admin-live-query.sql`. Test: `tests/admin-live-query.test.cjs`.
Only new functions are created. No old RPC, collector, profile permission or source table is changed.

`POST /rest/v1/rpc/dashboard_admin_live_query`

```json
{
  "p_request": {
    "action": "query",
    "platformId": "catalog UUID",
    "startAt": "2026-09-21T18:30:00Z",
    "endAt": "2026-09-22T18:30:00Z",
    "direction": "all",
    "status": "all",
    "offset": 0,
    "limit": 20
  }
}
```

Use the caller's current authenticated token. Authorization is active Owner, or active admin/viewer with `dashboard_admin_preview_grants.can_view=true`. The old `third_party` grant is not required or modified. Production `private.dashboard_current_data_scope()` is always checked and intersected with source platforms. There is no arbitrary SQL, table name, URL or profile supplied by the client.

## Actions and filters

- `catalog`: use only `{action:"catalog"}` (also the default argument). Returns `version`, `asOf`, `platforms`.
- `query`: full-scope aggregate, full-scope exact total and one page.
- `aggregate`: same full aggregate and exact total, `rows:[]`.
- `details`: same filtered exact total and one page; summary/group arrays empty, avoiding repeated heavy grouping on pagination.

Each noncatalog action requires one `platformId`, `startAt`, `endAt`. Timestamps must include offset/Z. Start is inclusive and end exclusive; frontends convert an inclusive ending second to the next second. Maximum 31 local calendar days in the catalog platform timezone. This API uses creation time only.

Optional filters all combine with AND:

| Key | Values / exact meaning |
|---|---|
| direction | `all`, `charge`, `withdraw` |
| status | `all`, `success`, `pending`, `failed`, `rejected`, `unknown` |
| orderNumber | exact local order number only |
| thirdPartyOrderNumber | exact third-party order number only; unsupported for AR |
| memberId | exact member ID |
| systemOrderId | exact NEW_AR `source_id`; unsupported for other sources |
| utr | currently unsupported for all safe normalized sources |
| providers | array of exact raw provider names |
| channelTypes | array of exact raw channel type names |
| currency | exact currency; omitted means preserve all currencies as separate aggregates |
| amountMin / amountMax | inclusive original order amount; decimal strings accepted; negative signed adjustments preserved |
| offset | nonnegative integer |
| limit | 20, 30, 50, 100 or 500; default20 |

Unknown fields or nonempty unsupported filters fail with `22023`; they are never silently ignored. A denied platform fails with `42501`. Unsupported fields return null in records and are flagged in capabilities.

## Catalog identity

`platforms[]`: `id,name,source,sourceName,scopeGroup,country,team,timezone,currency,capabilities`.

`id` is the stable production source platform UUID. `scopeGroup` is the production authorization grouping. `country` remains the source label; for GAME66 its legacy value can be 香港/红膏蟹 team group, not geographic country. `team` is null for AR/NEW_AR because those source registries do not prove a team assignment. GAME66 retains its real team directory value. Display/entity mapping must never expand production data scope.

`sourceName` preserves physical source platform spelling. The only additional confirmed alias is configured India `SHREEWIN` → source `Shree.Win`, used only when the exact configured spelling has no orders. Exact spelling takes precedence and both are never added together. Other unconfirmed spellings are not guessed. AR/NEW_AR source precedence follows the existing authoritative-source rule.

## Query response

Top level: `version,platform,basis,startAt,endAt,asOf,total,offset,limit,hasMore,summary,groups,latencySummary,pendingSummary,rows,capabilities`.

`summary[]` is grouped by `direction,currency`. Every monetary value is a decimal **string or null**, not an integer-rounded display value. Never sum different currencies. Null is missing/unavailable and must not become zero.

Every business metric contains:

```
direction, currency,
all_count, all_amount,
success_count, success_amount,
pending_count, pending_amount,
failed_count, failed_amount,
rejected_count, rejected_amount,
unknown_count, unknown_amount,
missing_amount_count, negative_amount_count, latest_synced_at
```

Failure does not include rejected/unknown. The six states reconcile to all_count. Successful/failed amount is null when any corresponding order lacks money; zero is a valid amount.

Groups preserve this same metric:

- `provider`: adds `provider`.
- `daily`: adds `provider,date`; useful for per-provider daily success rates.
- `hourly`: adds `hour` (0–23, platform-local creation hour, combined over the chosen days).
- `amount`: adds `bucket`.
- `matrix`: adds `hour,bucket`.

Exact amount buckets: `100,200,300,400,500,750,1000,1500,2000,5000` as strings, plus `other` and `unknown`. Missing group rows represent no records in that cell; coverage of the source itself is not implied. Empty query returns total0 and empty arrays, not invented source coverage.

Rows contain only safe fields:

```
id, system_order_id, order_number, third_party_order_number, member_id,
provider, channel_type, direction, status, status_group,
created_at, success_at, amount, actual_amount, withdraw_fee,
currency, synced_at, utr, latency_ms, pending_wait_ms
```

Rows are ordered by creation time, direction and ID descending. Phone, bank/UPI account identifiers, raw payloads, amount source text and free-form comments are excluded. IDs retain their separate meanings. `withdraw_fee` is the recorded source field, not a historical fee estimate; AR has no actual amount/fee coverage.

## Durations

`groups.latency` and `groups.pending_age` are mutually exclusive bins indexed by `bucket:0..9`:
`[0,5m],(5m,30m],(30m,1h],(1h,3h],(3h,6h],(6h,12h],(12h,1d],(1d,2d],(2d,3d],(3d,∞)`.

Rows contain `direction,currency,bucket,min_ms,max_ms,count,amount,valid_count,valid_amount,count_share,amount_share`. Null min/max indicates an open boundary. `groups.latency_thresholds` and `groups.pending_age_thresholds` instead have `threshold_ms`, with strict `duration > threshold`; cumulative counts must not be added together. Shares use valid duration records; zero/unknown denominators return null.

`latencySummary` / `pendingSummary` contain `direction,currency,candidate_count,valid_count,valid_amount,excluded_count,excluded_reasons,missing_amount_count,mean_ms,p50_ms,p95_ms,max_ms`.

- Latency uses successful source status plus finite success time, success>=created and success<=query asOf. Missing/reversed/future/infinite times are excluded and diagnosed. It is source creation→source success, not independently verified customer payment time. GAME66 withdrawal uses its existing update-time success proxy.
- Pending age includes **withdraw only**, still-pending source records in the **selected creation interval**. Duration is query asOf minus creation time, not all historical outstanding balance or observed pending-state transition duration. Future creation times are excluded. Source records may be stale; asOf is query time, not last collector snapshot.
- Across platforms, count/amount bins can be combined by currency. Mean needs valid-count weighting. Exact p50/p95 cannot be averaged from per-platform quantiles.

Current stored status can change between page requests. Each request is internally one database snapshot, but this API does not claim a frozen export snapshot across multiple HTTP requests.

## Verification and deployment boundary

PGlite tests cover independent grants without legacy module permissions, live revocation/disable/scope changes, caller ACL, all grouping totals, exact AND filters, five page sizes/offsets, source aliases, missing/signed money, currency separation, time boundaries, latency diagnostics, and indexed range predicates. A bounded 10,000-order synthetic day exercises full aggregate and count+page independently. These timings do not predict production performance.

Recommended first production verification: authorized actor, one platform, one local day, aggregate only; return safe counts/aggregates, no page rows. Keep real source-completeness/freshness limitations visible. Do not default to every platform ×31 days.
