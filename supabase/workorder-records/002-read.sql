-- Private service-only list/detail access to real collected AR workorder rows.
-- No mutations, source collection, attachment URLs, or retention operations.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function public.workorder_collected_records(p_account jsonb,p_query jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='10s' as $$
declare f jsonb; k text; v text; action text; first_day date; last_day date; page_offset int; page_limit int; answer jsonb; all_history boolean:=false;
begin
 if jsonb_typeof(p_account) is distinct from 'object' or p_account->>'active' is distinct from 'true'
 or coalesce(p_account->>'role','') not in ('agent','supervisor','auditor') or coalesce(p_account->>'auth_user_id','')=''
 or coalesce(p_account->>'team','')='' or jsonb_typeof(p_account->'platforms') is distinct from 'array' then
 raise exception using errcode='42501',message='scope_denied';end if;
 if jsonb_array_length(p_account->'platforms') not between 1 and 200 or exists(select 1 from jsonb_array_elements(p_account->'platforms') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 100) then raise exception using errcode='42501',message='scope_denied';end if;
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>8192 then raise exception using errcode='22023',message='invalid_query';end if;
 action:=p_query->>'action';
 if action='detail' then
  if p_query-array['action','platform','workorderId']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_query';end if;
  f:=jsonb_build_object('platform',p_query->'platform','workorderId',p_query->'workorderId');page_offset:=0;page_limit:=1;
 else
  if action is distinct from 'list' or p_query-array['action','filters','offset','limit']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_query';end if;
  f:=coalesce(p_query->'filters','{}'::jsonb);
  if (p_query ? 'offset' and (jsonb_typeof(p_query->'offset')<>'number' or p_query->>'offset' !~ '^[0-9]{1,7}$'))
   or (p_query ? 'limit' and (jsonb_typeof(p_query->'limit')<>'number' or p_query->>'limit' !~ '^(20|50|100)$')) then raise exception using errcode='22023',message='invalid_pagination';end if;
  page_offset:=coalesce((p_query->>'offset')::int,0);page_limit:=coalesce((p_query->>'limit')::int,50);
  if page_offset>1000000 then raise exception using errcode='22023',message='invalid_pagination';end if;
 end if;
 if jsonb_typeof(f) is distinct from 'object' or f-array['platform','from','to','dateBasis','issueKind','statusCode','workorderId','workorderNo','orderNo','sourceOrderNo','utr','provider','operator','minAmount','maxAmount','kyc','utrMatch']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_filter';end if;
 for k,v in select key,value#>>'{}' from jsonb_each(f) loop
  if jsonb_typeof(f->k)<>'string' or length(v)>200 or v<>btrim(v) or v ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if coalesce(f->>'platform','')<>'' and not ((p_account->'platforms') ? (f->>'platform')) then raise exception using errcode='42501',message='scope_denied';end if;
 if action='detail' and (coalesce(f->>'platform','')='' or coalesce(f->>'workorderId','')='') then raise exception using errcode='22023',message='invalid_detail';end if;
 if coalesce(f->>'dateBasis','') not in ('','submission','operation') or coalesce(f->>'issueKind','') not in ('','deposit','withdraw') or coalesce(f->>'statusCode','') not in ('','1','2','3','4','5') or coalesce(f->>'kyc','') not in ('','yes','no','unknown') or coalesce(f->>'utrMatch','') not in ('','yes','no','unknown') then raise exception using errcode='22023',message='invalid_filter';end if;
 foreach k in array array['minAmount','maxAmount'] loop
  if coalesce(f->>k,'')<>'' and f->>k !~ '^[0-9]{1,16}([.][0-9]{1,8})?$' then raise exception using errcode='22023',message='invalid_amount';end if;
 end loop;
 if nullif(f->>'minAmount','')::numeric>nullif(f->>'maxAmount','')::numeric then raise exception using errcode='22023',message='invalid_amount';end if;
 if coalesce(f->>'from','')='' and coalesce(f->>'to','')='' then
  all_history:=exists(select 1 from unnest(array['workorderId','workorderNo','orderNo','sourceOrderNo','utr']) key where coalesce(f->>key,'')<>'');
  last_day:=(now() at time zone 'Asia/Kolkata')::date;first_day:=last_day-30;
 else
  if coalesce(f->>'from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(f->>'to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='invalid_dates';end if;
  first_day:=(f->>'from')::date;last_day:=(f->>'to')::date;
  if last_day<first_day or last_day-first_day>92 then raise exception using errcode='22023',message='invalid_dates';end if;
 end if;
 if to_regclass('public.ar_workorder_issue_details') is null then return jsonb_build_object('ok',true,'sourceStatus','not_connected','rows','[]'::jsonb,'total',0,'offset',page_offset,'limit',page_limit,'platforms',p_account->'platforms');end if;
 with scoped as (
  select d.*,a.display_platform,
   case when f->>'dateBasis'='operation' then d.operated_at else coalesce(d.submitted_at,d.submitted_date::timestamp at time zone 'Asia/Kolkata') end sort_at
  from public.ar_workorder_issue_details d
  join lateral(select min(value) display_platform from jsonb_array_elements_text(p_account->'platforms')
   where ((value=d.platform and not (d.platform='RAJA' and p_account->>'team'='M8' and (p_account->'platforms') ? 'RAJALOTTERY'))
    or (p_account->>'team'='M8' and value='RAJALOTTERY' and d.platform='RAJA')
    or (value,d.platform) in (('82LOTTERY','INDIA82'),('VEERGAME','Veer.Game'),('Veer.Game','VEERGAME'),('SHREEWIN','Shree.Win'),('Shree.Win','SHREEWIN'))) having count(*)=1) a on true
  where d.system_name='AR' and d.country_code='IN'
  and (coalesce(f->>'platform','')='' or a.display_platform=f->>'platform')
  and (action='detail' or all_history or case when f->>'dateBasis'='operation' then (d.operated_at at time zone 'Asia/Kolkata')::date else coalesce(d.submitted_date,(d.submitted_at at time zone 'Asia/Kolkata')::date) end between first_day and last_day)
 ), filtered as materialized (
  select * from scoped d where
  (action<>'detail' or d.work_order_id=f->>'workorderId')
  and (coalesce(f->>'workorderId','')='' or case when all_history then lower(d.work_order_id)=lower(f->>'workorderId') else strpos(lower(coalesce(d.work_order_id,'')),lower(f->>'workorderId'))>0 end)
  and (coalesce(f->>'workorderNo','')='' or case when all_history then lower(d.work_order_no)=lower(f->>'workorderNo') else strpos(lower(coalesce(d.work_order_no,'')),lower(f->>'workorderNo'))>0 end)
  and (coalesce(f->>'orderNo','')='' or case when all_history then lower(d.payment_order_no)=lower(f->>'orderNo') else strpos(lower(coalesce(d.payment_order_no,'')),lower(f->>'orderNo'))>0 end)
  and (coalesce(f->>'sourceOrderNo','')='' or case when all_history then lower(d.source_order_no)=lower(f->>'sourceOrderNo') else strpos(lower(coalesce(d.source_order_no,'')),lower(f->>'sourceOrderNo'))>0 end)
  and (coalesce(f->>'utr','')='' or case when all_history then lower(d.utr)=lower(f->>'utr') else strpos(lower(coalesce(d.utr,'')),lower(f->>'utr'))>0 end)
  and (coalesce(f->>'provider','')='' or strpos(lower(coalesce(d.third_party,'')),lower(f->>'provider'))>0)
  and (coalesce(f->>'operator','')='' or strpos(lower(coalesce(d.operator_account,'')),lower(f->>'operator'))>0)
  and (coalesce(f->>'issueKind','')='' or d.issue_kind=f->>'issueKind')
  and (coalesce(f->>'statusCode','')='' or d.status_code::text=f->>'statusCode')
  and (coalesce(f->>'minAmount','')='' or d.amount>=(f->>'minAmount')::numeric)
  and (coalesce(f->>'maxAmount','')='' or d.amount<=(f->>'maxAmount')::numeric)
  and (coalesce(f->>'kyc','')='' or case when d.kyc_connected is null then 'unknown' when d.kyc_connected then 'yes' else 'no' end=f->>'kyc')
  and (coalesce(f->>'utrMatch','')='' or case when d.utr_matched is null then 'unknown' when d.utr_matched then 'yes' else 'no' end=f->>'utrMatch')
 ), page as (select * from filtered order by sort_at desc nulls last,platform,work_order_id limit page_limit offset page_offset)
 select jsonb_build_object('ok',true,'sourceStatus','ready','total',(select count(*) from filtered),'offset',page_offset,'limit',page_limit,'platforms',p_account->'platforms',
 'rows',coalesce((select jsonb_agg(jsonb_build_object(
 'platform',p.display_platform,'workorderId',p.work_order_id,'workorderNo',p.work_order_no,'orderNo',p.payment_order_no,'sourceOrderNo',p.source_order_no,'utr',p.utr,
 'issueKind',p.issue_kind,'statusCode',p.status_code,'amount',p.amount::text,'provider',p.third_party,'workorderType',p.work_order_type_name,'workorderName',p.work_order_name,'channelType',p.channel_type,
 'kycConnected',p.kyc_connected,'utrMatched',p.utr_matched,'reminderCount',p.reminder_count,'submittedAt',p.submitted_at,'operatedAt',p.operated_at,'operatorAccount',p.operator_account,
 'lastUpdatedBy',p.last_updated_by,'sourceUpdatedAt',p.source_updated_at,'collectedAt',p.observed_at,'submittedDate',p.submitted_date,'queryDate',p.query_date,'queryBasis',p.query_basis,'fieldGaps',p.field_gaps,'attachmentTypes',p.attachment_types)
 order by p.sort_at desc nulls last,p.platform,p.work_order_id) from page p),'[]'::jsonb)) into answer;
 if action='detail' and (answer->>'total')::int>1 then raise exception using errcode='22023',message='ambiguous_record';end if;
 return answer;
end;
$$;
revoke all on function public.workorder_collected_records(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.workorder_collected_records(jsonb,jsonb) to service_role;
-- Fixed identifiers permit exact all-history searches without a date restriction.
-- Indexes contain only already-stored business identifiers, never new payloads.
do $record_indexes$ begin
 if to_regclass('public.ar_workorder_issue_details') is not null then
 execute 'create index if not exists ar_workorder_records_work_order_id_idx on public.ar_workorder_issue_details(country_code,platform,lower(work_order_id))';
 execute 'create index if not exists ar_workorder_records_work_order_no_idx on public.ar_workorder_issue_details(country_code,platform,lower(work_order_no))';
 execute 'create index if not exists ar_workorder_records_payment_order_no_idx on public.ar_workorder_issue_details(country_code,platform,lower(payment_order_no))';
 execute 'create index if not exists ar_workorder_records_source_order_no_idx on public.ar_workorder_issue_details(country_code,platform,lower(source_order_no))';
 execute 'create index if not exists ar_workorder_records_utr_idx on public.ar_workorder_issue_details(country_code,platform,lower(utr))';
 end if;end;$record_indexes$;
notify pgrst,'reload schema';
commit;
