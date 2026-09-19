# Third-party filter metadata audit (2026-09-19)

Endpoint: `GET /api/third-party-filter-options`.
Response: `{platforms:[{country,platform}]}`. No date or order-detail query required.

## Read-only production evidence

- `private` schema: `authenticated` has USAGE; `anon` does not.
- Existing source columns were verified in `information_schema.columns`:
  - `ar_config_targets` / `panda_config_targets`: `country_name`, `platform`.
  - `wg_config_targets`: `country_name`, `platform`, `members[].name`.
  - `newar_detail_platforms`: `country`, `platform`.
  - `game66_platforms`: `team_code`, `platform_name`.
  - `third_party_platform_status`: `country`, `platform`.
  - Legacy `third_party_volume`: only indexed `country`, `platform` keys, using
    the existing `idx_tpv_country_platform_date` index. No business fields read.
- GAME66 registry currently has 16 Hong Kong and 8 Red Crab platforms, all
  collection switches disabled. These switches do not revoke history visibility.
- Final source-only EXPLAIN ANALYZE (no RPC deployment): 23.267 ms.
  Fee matrix: 4,339 index-only entries, zero heap fetches. Registries: 44 AR,
  54 Panda, 2 WG, 3 NEWAR, 24 GAME66 rows. Scope checks run on materialized
  metadata, not every fee cell. The legacy directory uses a loose index scan:
  first key plus 123 increasing pair seeks, each LIMIT 1; 89 heap visibility
  fetches, never a full historical aggregate/row scan. A cold standalone seek
  audit took 263.702 ms. Observed times are not latency guarantees.
- Registries alone missed real legacy NPG platforms. Read-only evidence confirmed
  哥伦比亚→NPG哥伦比亚盘口, 墨西哥→NPG墨西哥盘口, 智利→NPG智利盘口.
  The indexed metadata fallback includes these and other legacy-only platforms.
  Current sources have no Brazil-native metadata, but it will be included if
  present. There is no hardcoded/fabricated platform fallback. The 10,000-key
  safety ceiling throws an explicit error rather than returning a truncated list.

## Access contract

`private.dashboard_third_party_filter_options()` is a fixed-search-path definer
with explicit current UID, `third_party` permission, and current account data
scope checks. The public wrapper is invoker-only. Both deny anonymous execution.
The HTTP reader verifies the current profile/module again, re-filters scope,
normalizes only existing platform aliases and emits only country/platform.
Existing source table grants, collection settings and policies are unchanged.

## Verification

`tests/third-party-filter-options-server.test.cjs`: 15 offline tests cover SQL
authorization, restricted source access, disabled registered platforms, WG
members, legacy-only NPG/native platforms, bounded index-key traversal, country
projection, both HTTP readers, explicit errors, cancellation,
fresh-per-request permissions, routing and mirror parity. No production writes
or deployment were performed for the source audit above.

## Production rollout verification

- Applied `third_party_filter_options` after SQL and scope tests passed.
- Deployed `dashboard-api` version 17, preserving its existing custom JWT/profile
  authorization. Only the independent catalog route and its dependencies changed.
- Unauthenticated Edge and direct RPC requests both returned 401, with no names.
- Live function ACL check: anonymous execution denied; authenticated execution
  allowed; private definer and public invoker both have a fixed empty search path.
- Security advisor findings remain unchanged (55 findings before and after;
  observation timestamps excluded). No existing table policies were broadened.
- Frontend mount, country switch, ignored-abort responses, account changes,
  token refresh, explicit order-rate loading and failed-query date labels have
  dedicated lifecycle coverage. A real isolated Chrome fixture additionally
  checks search before querying, stale India response suppression, search reset
  and narrow viewports, with all external requests blocked.
