# Authenticated detailed admin

The `live-*.js` and `live-*.css` files form the production-only adapter appended to the private detailed-admin document. They activate only when the host injects `HENSEM_PRODUCTION` and the nonce-bound request bridge. No order or sheet snapshot data is included in these files.

## Data and permissions

- `dashboard_admin_live_query`: source catalog, filtered aggregates and exact server-side pagination. See `../supabase/admin-live-query-contract.md`.
- `dashboard_admin_live_rates`: current rate configuration text, separately scoped country and platform rows.
- `dashboard_admin_live_rate_sheet`: the existing Google original-sheet snapshot and layout, behind both preview and original rate permissions.
- `dashboard_admin_live_payout_config`: read-only legacy configuration snapshots for six source systems, with fresh original module/data-scope checks and a safe business-field projection.
- Active account and explicit detailed-admin grant are checked on every RPC; source data scopes remain authoritative. No token is passed into the opaque iframe.
- Six-hour aggregate partitions, at most two platform workers, timeout-only bisection; results are published only after every partition succeeds. Changed partition counts reject a stale details page. Quantiles are not averaged across partitions.
- Current rates are displayed in Third-party Channel Center. Complex rate text and missing historical effective versions are not converted into fabricated historical costs.
- Deposit reconciliation remains a separately labelled Google snapshot. Unconnected risk, online heartbeat and audit-log panels disclose missing data instead of showing sample statistics. Entity mapping pages remain local configuration drafts.

## Restored presentation

The dashboard retains its complete section structure. Collection and payout never share a summed metric card. Compact country-local date/time controls include seconds, all/provider selection and calendar-aware comparisons. The amount/time matrix uses one amount per row and three values per hour cell; exact and interval buckets conserve the same order totals. Missing integrations retain the reference tables/tabs with explicit unavailable values. Rate-sheet source order, complex rate text, country tabs and platform columns use the existing original-sheet model. Automatic payout configuration is listed beneath deposit reconciliation and has no save action.

## Deployment

Apply the additive SQL files through the existing database deployment process. `admin-live-matrix-range.sql`, `admin-live-rate-sheet.sql` and `admin-live-payout-config.sql` add the restored read models; `admin-live-payout-config-shape-fix.sql` updates earlier deployments of the latter only. `admin-live-query-performance.sql` is the deployed replacement for the newly added private query function; it does not replace legacy RPCs.

The current release keeps the existing authenticated Edge Function and its private document unchanged. After the same authorized HTML request completes, `OwnerAdminPreview` calls the pure `restoreApprovedAdmin` transformer. It requires the exact deployed legacy adapter, replaces only that code, and adds the restored styles before the original iframe sandbox/nonce wrappers run. Unknown or partial versions fail closed. No endpoint, session, permission or legacy module changes are made.

Regenerate the code-only overlay with `python3 admin-preview/build-restoration.py`. `legacy-live-data.js` pins the deployed legacy adapter from c2247c0; the generated TypeScript contains code/styles only. Never include private HTML, the ignored gzip payload, source rows or Google snapshots in GitHub Pages or this public repository.

Publish the host bundle through the existing Pages workflow. Session refresh must not remount the frame; fresh permission revocation still removes access.

Run `pnpm test:admin-preview`, the existing migration/filter/comparison suites, and `pnpm build`. The UI fixture uses synthetic data only; production validation uses bounded read-only RPC calls.
