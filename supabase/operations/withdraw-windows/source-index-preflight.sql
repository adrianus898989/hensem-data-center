-- Read-only metadata gate before v2 worker activation. This does not inspect
-- orders, create indexes, change functions, or imply production query timings.
-- Verify a valid/ready native-time range index for every enabled source/basis;
-- create any missing index separately and CONCURRENTLY, never in install.sql.
BEGIN READ ONLY;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
WITH sources(table_oid, source, basis, clock_column) AS (VALUES
 ('private.yash_orders'::regclass, 'kb', 'success', 'completed_at'),
 ('public.newar_detail_records'::regclass, 'newar', 'success', 'success_at'),
 ('public.newar_detail_records'::regclass, 'newar', 'source_updated', 'source_updated_at'),
 ('private.duoli_order_details'::regclass, 'duoli', 'source_updated', 'updated_at'),
 ('public.game66_withdraw_orders'::regclass, 'game66', 'source_updated', 'update_time'),
 ('public.lg_orders'::regclass, 'lg', 'success', 'paid_at')
)
SELECT s.source,s.basis,s.table_oid::text AS source_table,s.clock_column,
       i.indexrelid::regclass::text AS index_name,i.indisvalid,i.indisready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM sources s
LEFT JOIN pg_attribute a ON a.attrelid=s.table_oid AND a.attname=s.clock_column AND NOT a.attisdropped
LEFT JOIN pg_index i ON i.indrelid=s.table_oid AND a.attnum=ANY(i.indkey::smallint[])
ORDER BY s.source,s.basis,index_name;
COMMIT;
