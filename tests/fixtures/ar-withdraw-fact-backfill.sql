-- Maintenance only. Bind params to ONE exact native platform and ONE native day.
-- Repeat the same partition, then verify unskipped parity; no reader switch.
-- FOR SHARE holds each native source row until insert commits. DO NOTHING never
-- overwrites a more recent row already maintained by the source trigger.
begin;
set local statement_timeout='5s';set local lock_timeout='1s';
with params as materialized (select '91CLUB'::text platform,date '2026-10-10' data_date), missing as materialized (
 select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.status,a.operator,a.applied_at,a.completed_at,a.observed_at,a.updated_at
 from public.ar_collected_orders a join params p on a.platform=p.platform
 where a.source_system='AR' and a.country_code='IN' and a.order_kind='withdraw' and a.applied_at>=timestamp '2026-10-10'
  and a.applied_at>=p.data_date::timestamp and a.applied_at<(p.data_date+1)::timestamp
  and not exists(select 1 from private.ar_withdraw_facts f where
   (f.source_system,f.country_code,f.platform,f.order_kind,f.order_no)=(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no))
 limit 1000 for share of a skip locked
), inserted as (
 insert into private.ar_withdraw_facts
 select p.* from missing a cross join lateral private.ar_withdraw_fact(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,
  a.status,a.operator,a.applied_at,a.completed_at,a.observed_at,a.updated_at)p
 on conflict(source_system,country_code,platform,order_kind,order_no) do nothing
 returning 1
)
select count(*) inserted_rows from inserted;
commit;
