-- Cover ordinary AR deposit records without fetching the wide source heap.
-- Long text records remain in the source and use the reader's exact-PK fallback.
-- The size guard prevents new unusually long records from failing index writes.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
create index if not exists ar_workorder_deposit_safe_cover_v1_idx
 on public.ar_workorder_issue_details(country_code,platform,work_order_id)
 include(work_order_no,payment_order_no,amount,third_party,channel_type,kyc_connected,status_code,submitted_date,submitted_at,observed_at,utr)
 where system_name='AR' and issue_kind='deposit'
  and octet_length(coalesce(country_code,''))+octet_length(coalesce(platform,''))+octet_length(coalesce(work_order_id,''))
   +octet_length(coalesce(work_order_no,''))+octet_length(coalesce(payment_order_no,''))+octet_length(coalesce(third_party,''))
   +octet_length(coalesce(channel_type,''))+octet_length(coalesce(utr,''))<=1500;
do $validate_index$
declare i record;
begin
 select p.*,pg_get_indexdef(p.indexrelid) definition into i
 from pg_index p where p.indexrelid=to_regclass('public.ar_workorder_deposit_safe_cover_v1_idx');
 if i.indexrelid is null or i.indrelid<>'public.ar_workorder_issue_details'::regclass
  or not i.indisvalid or not i.indisready or i.indisunique or i.indnkeyatts<>3 or i.indnatts<>14
  or i.definition is distinct from $expected$CREATE INDEX ar_workorder_deposit_safe_cover_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, work_order_id) INCLUDE (work_order_no, payment_order_no, amount, third_party, channel_type, kyc_connected, status_code, submitted_date, submitted_at, observed_at, utr) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND ((((((((octet_length(COALESCE(country_code, ''::text)) + octet_length(COALESCE(platform, ''::text))) + octet_length(COALESCE(work_order_id, ''::text))) + octet_length(COALESCE(work_order_no, ''::text))) + octet_length(COALESCE(payment_order_no, ''::text))) + octet_length(COALESCE(third_party, ''::text))) + octet_length(COALESCE(channel_type, ''::text))) + octet_length(COALESCE(utr, ''::text))) <= 1500))$expected$
 then raise exception 'WORKORDER_DEPOSIT_SAFE_COVER_DRIFT';end if;
end;$validate_index$;
commit;
