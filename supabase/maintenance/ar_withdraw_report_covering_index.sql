-- pg-delta: transaction=false
-- Keep collection writes available while building this report-only index.
-- AR raw withdrawal reports start on 2026-10-10; older dates retain their
-- existing daily-report source. Include only fields required by daily and
-- operator aggregates, avoiding random reads of the wide order heap.
create index concurrently ar_collected_withdraw_report_cover_idx
 on public.ar_collected_orders (country_code,platform,applied_at)
 include (status,operator,completed_at,observed_at,updated_at)
 where source_system='AR' and order_kind='withdraw'
  and applied_at>=timestamp '2026-10-10';
