-- Exact normalisation used by submitted-original reconciliation.
-- Index AR deposit identities across countries; no rows or grants change.
-- This migration's DDL limit does not change the RPC/role statement timeout.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
create index if not exists ar_workorder_deposit_original_identity_v1_idx
 on public.ar_workorder_issue_details
 (country_code,platform,(upper(nullif(btrim(payment_order_no),''))))
 include(work_order_id,payment_order_no)
 where system_name='AR' and issue_kind='deposit' and payment_order_no is not null;
do $validate_index$
declare i record;
begin
 select p.*,pg_get_indexdef(p.indexrelid) definition into i
 from pg_index p where p.indexrelid=to_regclass('public.ar_workorder_deposit_original_identity_v1_idx');
 if i.indexrelid is null or i.indrelid<>'public.ar_workorder_issue_details'::regclass
  or not i.indisvalid or not i.indisready or i.indisunique or i.indnkeyatts<>3 or i.indnatts<>5
  or i.definition is distinct from $expected$CREATE INDEX ar_workorder_deposit_original_identity_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, upper(NULLIF(btrim(payment_order_no), ''::text))) INCLUDE (work_order_id, payment_order_no) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND (payment_order_no IS NOT NULL))$expected$
 then raise exception 'WORKORDER_ORIGINAL_IDENTITY_INDEX_DRIFT';end if;
end;$validate_index$;
commit;
