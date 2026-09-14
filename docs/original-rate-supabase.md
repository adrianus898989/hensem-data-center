# Original rate-sheet snapshots

This is a presentation-only pipeline, independent of normalized rates and volume.

`Google Sheets (read-only) → Supabase sync-original-rate-sheet → original snapshot tables → authenticated dashboard RPC → existing website`

The existing `bright-responder` function, rate/volume schedules, rate matching and business tables are unchanged. The website does not need Google credentials for this view. It uses its existing Supabase URL, anon key and the signed-in user's token. The hosting provider only serves the website/query proxy.

## Deployment

1. Apply `supabase/migrations/20260914050316_original_rate_sheet_snapshots.sql`.
2. Deploy all files in `supabase/functions/sync-original-rate-sheet/` with entrypoint `index.ts`. JWT verification is disabled only because the handler authenticates `x-sync-secret` against the existing `SYNC_SECRET` before any source or database access.
3. Reuse the existing project secrets: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SYNC_SECRET`, and `THIRD_PARTY_RATE_SHEET_ID`. Supabase supplies its URL/service key. Never copy these to browser code or a public environment variable.
4. Trigger `POST {"action":"sync"}` internally with the existing Vault secret. Verify a complete publication before deploying the website reader.
5. Schedule the independent `third-party-original-rates-auto` job at minute 48 each hour, after the existing minute-45 normalized-rate sync. Do not modify existing jobs. The cron request uses Vault, not a literal credential in SQL.

## Publication and access

- Every attempt has a unique generation and an eight-minute lease. Sheets stage sequentially; only the complete, validated workbook is published atomically.
- Failed attempts leave the previous published snapshot readable. Late workers cannot modify a published generation. The new and immediately previous successful generations are retained.
- Only an active account with `third_party` permission and `all` data scope can read the full original workbook. Country-restricted accounts retain the existing filtered rates view. RLS and the RPC recheck the current profile, not editable JWT metadata.
- Reader and sync RPCs are SECURITY INVOKER. Anonymous reads and client-side writes are denied. Sync RPCs are executable by the service role only.
- Native display text, zero/empty distinctions, cell colors, borders, dimensions, merged cells, frozen rows/columns, rich text and original tab order are retained. Formula source, URLs and non-presentation metadata are not exposed. Used extents include merges; unused trailing blank cells are not materialized.

## Operational checks

Read publication time, tab count and `last_error` from `third_party_rate_original_workbooks`. The browser's “刷新” queries Supabase only; it does not trigger Google collection. Never print Vault contents, service keys, Google private keys or queued HTTP headers during troubleshooting.

Bounds: 120 seconds per run, 15 seconds per request, 64 tabs, 10,000 allocated rows / 512 columns / 250,000 allocated cells per tab, 8 MiB per sanitized grid. A larger source fails explicitly rather than silently dropping data. If the source grows beyond these bounds, extend the chunking design before increasing limits.

Rollback: revert the website reader to the existing normalized-rate view and disable only `third-party-original-rates-auto`. No old business data or old sync job needs restoration.
