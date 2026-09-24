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
- Deposit reconciliation remains a separately labelled Google snapshot. Unconnected risk, online heartbeat and audit-log panels disclose missing data instead of showing sample statistics.
- Provider options read a compact historical registry independently of aggregate queries. Approved country-specific aliases reuse the main dashboard's existing mapping; ambiguous names stay separate. A scheduled materialized-view refresh updates collected coverage without rewriting legacy facts.
- Provider and team/platform classification pages persist scoped changes with optimistic version checks and an audit trail. Owners can edit; an admin also needs an explicit classification grant. Viewers cannot edit. No grant is enabled by installation. Changing a display label never changes the physical source key or an existing country's identity.

## Restored presentation

The dashboard retains its complete section structure. Collection and payout never share a summed metric card. Compact country-local date/time controls include seconds, all/provider selection and calendar-aware comparisons. The amount/time matrix uses one amount per row and three values per hour cell; exact and interval buckets conserve the same order totals. Missing integrations retain the reference tables/tabs with explicit unavailable values. Rate-sheet source order, complex rate text, country tabs and platform columns use the existing original-sheet model. Automatic payout configuration is listed beneath deposit reconciliation and has no save action.

Collection and payout provider summaries are separate pages. They retain success-time amounts, created-cohort success rates, pending orders, current-rate estimates and full/page totals. Deposit workorders belong to collection, withdrawal workorders to payout. Successful withdrawal workorders are a subset of submitted workorders, not additional submissions. Missing or incomplete source capture is disclosed rather than counted as zero.

Automatic payout and operator statistics are separate subpages. The daily report uses the original five summary cards and sortable platform columns, with country-local date keys, NewAR direct-snapshot precedence and weighted durations. A previous day is never included in the current total. Incomplete previous-platform coverage suppresses total growth. Country remains mandatory and single-select; the platform picker supports search and multiselect.

Each platform has separate automatic-payout and rejection-reason buttons. AR interception/manual-review text comes from `manual_remark`; rejected-order text comes from `remark`. Authorized order detail shows the order number and those two fields, without bank/member fields. Snapshots do not substitute member notes for rejection notes. Missing capture or empty source remarks stay explicit. Daily operational notes retain their existing owner/admin and `auto_withdraw` permissions and database author stamping; they cannot modify an order or payment status.

Reason buttons open a right-side drawer. Rejection categories use the M8 `arwd.py` headings for India, Pakistan and Nigeria, plus all 53 untagged templates for Brazil, Indonesia, Myanmar, Malaysia and Vietnam. Matching is shared across platforms within the source country, not restricted to the validation sample. Full raw notes remain available; unknown text and blank notes remain distinct. Category, exact-note and operator drilldowns retain the full daily rejected-order denominator across all pages. Order details show the original rejection note, separate interception text, account, order number, amount and timestamps. Categorization never marks an order or operator as wrong. Sources with only aggregate snapshots explicitly disable unavailable order/operator details.

## Deployment

Apply the additive SQL files through the existing database deployment process. `admin-live-matrix-range.sql`, `admin-live-rate-sheet.sql` and `admin-live-payout-config.sql` add the restored read models; `admin-live-payout-config-shape-fix.sql` updates earlier deployments of the latter only. `admin-live-query-performance.sql` is the deployed replacement for the newly added private query function; it does not replace legacy RPCs.

For the configuration and split-report release, first regenerate approved aliases with `node admin-preview/build-provider-aliases.cjs`, then build the atomic SQL upgrade with `python3 admin-preview/build-live-upgrade.py --output /path/to/private-admin-upgrade.sql`. Review/apply that bundle through the existing database deployment process. Its order is: performance engine, approved aliases, compact registry/permissions, platform mappings, canonical query wrapper, workorders, withdrawal pages, country-specific reason templates, reasons, and daily notes. **Do not run the performance engine by itself after the wrapper**, because that would remove canonical provider presentation. The bundle requires the existing private admin/catalog, legacy daily-note and source-table migrations. It creates no users, automatic grants or order mutations.

The current release keeps the existing authenticated Edge Function and its private document unchanged. After the same authorized HTML request completes, `OwnerAdminPreview` calls the pure `restoreApprovedAdmin` transformer. It requires the exact deployed legacy adapter, replaces only that code, and adds the restored styles before the original iframe sandbox/nonce wrappers run. Unknown or partial versions fail closed. No endpoint, session, permission or legacy module changes are made.

Regenerate the code-only overlay with `python3 admin-preview/build-restoration.py`. `legacy-live-data.js` pins the deployed legacy adapter from c2247c0; the generated TypeScript contains code/styles only. Never include private HTML, the ignored gzip payload, source rows or Google snapshots in GitHub Pages or this public repository.

Treat `legacy-live-data.js` as an immutable match target, including its labels and whitespace. Change the active `live-*.js` modules for UI updates. The generator and release tests pin the deployed adapter's SHA-256 independently; changing both the matcher and generated bundle must fail before release. A new baseline requires a coordinated private-document deployment and verification, never bypassing the exact-match check.

Publish the host bundle through the existing Pages workflow. Session refresh must not remount the frame; fresh permission revocation still removes access.

Run `pnpm test:admin-preview`, the existing migration/filter/comparison suites, and `pnpm build`. The UI fixture uses synthetic data only; production validation uses bounded read-only RPC calls.
