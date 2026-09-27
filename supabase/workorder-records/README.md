# Collected workorder records — storage and read service

This page uses `public.ar_workorder_issue_details`, never the Sheet follow-up tables or daily aggregates. Existing statuses, including processed/rejected, remain queryable. There is no collector start, cleanup, attachment proxy, storage bucket, or retention trigger in this change.

Apply `001-storage.sql`, then `002-read.sql`, and deploy the three files in `supabase/functions/workorder-records-data/` as `workorder-records-data` with custom authentication (`verify_jwt=false`). Its handler requires the server proxy proof, trusted client IP, bearer session, and a fresh `workorder-account-admin` `me` response. It accepts active workorder agent/supervisor/auditor identities and the current team/platform catalogue; owner/dashboard identities do not pass. Neither public role can call either RPC or directly select the detail table. Only the existing service role can ingest/query; it has no DELETE privilege on the new table.

`001-storage.sql` is the frozen storage-only file shared byte-for-byte by the local V45 and V46 packages, plus one provenance comment. Original file SHA256: `8a173b76b35acaed5457996be9a5087ffd52aabdaa3534e9e2f83516383980be`. Both collectors use `ingest_ar_workorder_issue_details_v2` and the same 46 payload keys. They continue using their existing Supabase Secret/service-role configuration; no new credentials or RPC-name changes are required. Only this storage file is reused; V46 evidence/retention code is not installed or invoked. First publication creates an empty table; real future uploads populate it. This installation does not claim that historical detail was already collected.

The RPC validates the complete batch before writing, rejects unknown phone/bank/member/raw/attachment URL keys, deduplicates by `(system_name,country_code,platform,work_order_id)`, rejects older observations/source updates, and retains existing optional values when a newer payload omits them. It stores decimal amounts exactly. It does not delete records or calculate a paid amount from status 4.

`workorder_collected_records` is a service-only, read-only RPC with explicit business-field projection. The page queries India platforms only, after fresh authorization. It supports POST list/detail, 20/50/100 rows, independent column filters, and an exact detail key. Date searches use India submission/operation dates, up to 93 days. With no dates and at least one complete workorder/order/UTR identifier, identifiers match exactly across all retained history. Without either dates or identifiers, the query defaults to the latest 31 India calendar dates. Explicit date ranges always remain active.

Attachments return types only and `attachmentAccess: unavailable`; no source URL, path, signed URL, or download action is exposed. `observed_at` is labelled collection time separately from submitted/operated business timestamps. Status mappings come from the collector source: 1 pending, 2 processing, 3 rejected, 4 processed, 5 system processing. Processed is not proof of payment arrival.

Validation uses synthetic local PostgreSQL and mocked requests only:

- `tests/workorder-records-sql.test.cjs`
- `tests/workorder-records-data.test.cjs`
- Portal `tests/collected-workorder-server.test.ts`

No production data is included in these files.

## Dashboard reads

After the existing dashboard authorization and active follow-up read model are installed, apply `003-admin-read.sql`. It adds only the fixed authenticated RPC `dashboard_admin_live_workorder_records` and its guarded private implementation. Every request rechecks the current profile, preview grant and country/platform data scope. Direct table access stays denied. The browser uses its current user session, never a service key.

`view: records` lists retained collected tickets. `view: missing` reads source status 3 by local operation date and matches active Sheet/portal registration records across all retained dates, using same-platform full workorder/payment-order identifiers. Portal registrations additionally require the same confirmed catalogue team; an unknown or ambiguous team cannot match portal entries. Matching multiple registrations or conflicting known amounts is `review`; no match is `missing`, without inferring a cause. Missing operation timestamps, or timestamps supplied only through the lastUpdateTime fallback, are counted separately across retained platform records and are not assigned to a day. `view: workload` groups retained ticket rows by confirmed operationTime/operateTime local day, platform, source operator and issue kind. These counts reflect the latest collected ticket state, not a complete source action history and not employee follow-up actions.

The confirmed India/M8/AR source name RAJA displays as RAJALOTTERY while retaining the source identifier. Other aliases use exact authorized catalogue mapping or specifically confirmed pairs, never arbitrary punctuation removal. No new source-record mutations or attachment access are added.

Additional validation: `tests/admin-workorder-records-sql.test.cjs` and the dedicated action cases in `tests/admin-live-bridge.test.cjs`.
