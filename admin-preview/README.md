# Authenticated detailed admin

`live-data.js` and `live-data.css` are the production-only adapter appended to the private detailed-admin document. They activate only when the host injects `HENSEM_PRODUCTION` and the nonce-bound request bridge. No order or sheet snapshot data is included in these files.

## Data and permissions

- `dashboard_admin_live_query`: source catalog, filtered aggregates and exact server-side pagination. See `../supabase/admin-live-query-contract.md`.
- `dashboard_admin_live_rates`: current rate configuration text, separately scoped country and platform rows.
- Active account and explicit detailed-admin grant are checked on every RPC; source data scopes remain authoritative. No token is passed into the opaque iframe.
- Six-hour aggregate partitions, at most two platform workers, timeout-only bisection; results are published only after every partition succeeds. Changed partition counts reject a stale details page. Quantiles are not averaged across partitions.
- Current rates are displayed in Third-party Channel Center. Complex rate text and missing historical effective versions are not converted into fabricated historical costs.
- Deposit reconciliation remains a separately labelled Google snapshot. Unconnected risk, online heartbeat and audit-log panels disclose missing data instead of showing sample statistics. Entity mapping pages remain local configuration drafts.

## Deployment

Apply the additive SQL files through the existing database deployment process. `admin-live-query-performance.sql` is the deployed replacement for the newly added private query function; it does not replace legacy RPCs.

Build the private preview document with this adapter appended after the sample modules. Gzip/base64 it into ignored `supabase/functions/owner-admin-preview/payload.generated.ts`, then deploy only through the authenticated Edge Function (`verify_jwt=true`, entry `index.ts`, import map `deno.json`). Never put this payload or the source sheet snapshot in GitHub Pages, `public/`, or the public repository.

Publish the host bundle with the existing Pages workflow. Session object refresh must not remount the frame; fresh permission revocation still removes access.

Run `pnpm test:admin-preview`, the existing migration/filter/comparison suites, and `pnpm build`. The UI fixture uses synthetic data only; production validation uses bounded read-only RPC calls.
