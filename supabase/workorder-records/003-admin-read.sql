-- Independent owner-authorized reads of actual collected workorders.
-- No collection, updates, attachment delivery, retention or cleanup.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function private.dashboard_admin_live_workorder_records(p_query jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='20s' as $$
declare v_scope jsonb:=private.dashboard_admin_live_scope();v_view text:=coalesce(p_query->>'view','records');
 v_code text;v_country text;v_timezone text;v_currency text;f jsonb;k text;v text;action text;first_day date;last_day date;
 page_offset int;page_limit int;answer jsonb;all_history boolean:=false;
begin
 select code,name,tz,currency into v_code,v_country,v_timezone,v_currency from (values
 ('IN','印度','Asia/Kolkata','INR'),('BR','巴西','America/Sao_Paulo','BRL'),('PK','巴基斯坦','Asia/Karachi','PKR'),
 ('ID','印尼','Asia/Jakarta','IDR'),('VN','越南','Asia/Ho_Chi_Minh','VND'),('PH','菲律宾','Asia/Manila','PHP'),
 ('MY','马来','Asia/Kuala_Lumpur','MYR'),('MM','缅甸','Asia/Yangon','MMK'),('NG','尼日利亚','Africa/Lagos','NGN'),
 ('CO','哥伦比亚','America/Bogota','COP'),('MX','墨西哥','America/Mexico_City','MXN'),('CL','智利','America/Santiago','CLP')
 ) countries(code,name,tz,currency) where p_query->>'country' in (code,name);
 if v_code is null or v_view not in ('records','missing','workload') then raise exception using errcode='22023',message='invalid_request';end if;
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>8192 then raise exception using errcode='22023',message='invalid_query';end if;
 action:=coalesce(p_query->>'operation','list');
 if action='detail' then
  if p_query-array['view','operation','country','filters','offset','limit']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_query';end if;
  if v_view<>'records' then raise exception using errcode='22023',message='invalid_detail';end if;
  f:=coalesce(p_query->'filters','{}'::jsonb);page_offset:=0;page_limit:=1;
 else
  if action is distinct from 'list' or p_query-array['view','operation','country','filters','offset','limit']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_query';end if;
  f:=coalesce(p_query->'filters','{}'::jsonb);
  if (p_query ? 'offset' and (jsonb_typeof(p_query->'offset')<>'number' or p_query->>'offset' !~ '^[0-9]{1,7}$'))
   or (p_query ? 'limit' and (jsonb_typeof(p_query->'limit')<>'number' or p_query->>'limit' !~ '^(20|50|100)$')) then raise exception using errcode='22023',message='invalid_pagination';end if;
  page_offset:=coalesce((p_query->>'offset')::int,0);page_limit:=coalesce((p_query->>'limit')::int,50);
  if page_offset>1000000 then raise exception using errcode='22023',message='invalid_pagination';end if;
 end if;
 if jsonb_typeof(f) is distinct from 'object' or f-array['platform','from','to','dateBasis','issueKind','statusCode','workorderId','workorderNo','orderNo','sourceOrderNo','utr','provider','operator','minAmount','maxAmount','kyc','utrMatch','registrationStatus']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_filter';end if;
 for k,v in select key,value#>>'{}' from jsonb_each(f) loop
  if jsonb_typeof(f->k)<>'string' or length(v)>200 or v<>btrim(v) or v ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if action='detail' and (coalesce(f->>'platform','')='' or coalesce(f->>'workorderId','')='') then raise exception using errcode='22023',message='invalid_detail';end if;
 if coalesce(f->>'dateBasis','') not in ('','submission','operation') or coalesce(f->>'issueKind','') not in ('','deposit','withdraw') or coalesce(f->>'statusCode','') not in ('','1','2','3','4','5') or coalesce(f->>'kyc','') not in ('','yes','no','unknown') or coalesce(f->>'utrMatch','') not in ('','yes','no','unknown') then raise exception using errcode='22023',message='invalid_filter';end if;
 foreach k in array array['minAmount','maxAmount'] loop
  if coalesce(f->>k,'')<>'' and f->>k !~ '^[0-9]{1,16}([.][0-9]{1,8})?$' then raise exception using errcode='22023',message='invalid_amount';end if;
 end loop;
 if nullif(f->>'minAmount','')::numeric>nullif(f->>'maxAmount','')::numeric then raise exception using errcode='22023',message='invalid_amount';end if;
 if coalesce(f->>'from','')='' and coalesce(f->>'to','')='' then
  all_history:=exists(select 1 from unnest(array['workorderId','workorderNo','orderNo','sourceOrderNo','utr']) key where coalesce(f->>key,'')<>'');
  last_day:=(now() at time zone v_timezone)::date;first_day:=last_day-30;
 else
  if coalesce(f->>'from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(f->>'to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='invalid_dates';end if;
  first_day:=(f->>'from')::date;last_day:=(f->>'to')::date;
  if last_day<first_day or last_day-first_day>92 then raise exception using errcode='22023',message='invalid_dates';end if;
 end if;

 if coalesce(f->>'registrationStatus','') not in ('','missing','matched','review') or (v_view<>'missing' and coalesce(f->>'registrationStatus','')<>'') then raise exception using errcode='22023',message='invalid_filter';end if;
 if v_view='workload' and coalesce(f->>'statusCode','')<>'' or v_view='missing' and coalesce(f->>'statusCode','') not in ('','3') then raise exception using errcode='22023',message='invalid_filter';end if;
 if v_view<>'records' then f:=f||jsonb_build_object('dateBasis','operation');all_history:=false;end if;
 if to_regclass('public.ar_workorder_issue_details') is null then return jsonb_build_object('ok',true,'sourceStatus','not_connected','rows','[]'::jsonb,'total',0,'offset',page_offset,'limit',page_limit,'platforms','[]'::jsonb,'view',v_view);end if;
 with catalog as materialized (
  select distinct p.source_name,p.name,p.team from private.dashboard_admin_live_platforms() p
  where p.scope_group=v_code and lower(p.source)='ar'
 ), names as (
  select d.*,coalesce(a.name,d.platform) display_platform,coalesce(a.team,'') display_team
  from public.ar_workorder_issue_details d
  left join lateral(select min(case when v_code='IN' and c.team='M8' and c.source_name='RAJA' then 'RAJALOTTERY' else c.name end) name,min(c.team) team
    from catalog c where c.source_name=d.platform
    having count(distinct case when v_code='IN' and c.team='M8' and c.source_name='RAJA' then 'RAJALOTTERY' else c.name end)=1
      and count(distinct nullif(btrim(c.team),''))=1) a on true
  where d.system_name='AR' and d.country_code=v_code and private.dashboard_scope_allows(v_scope,d.country_code,d.platform)
 ), eligible as (
  select d.*,case when f->>'dateBasis'='operation' then d.operated_at else coalesce(d.submitted_at,d.submitted_date::timestamp at time zone v_timezone) end sort_at
  from names d where (coalesce(f->>'platform','')='' or d.display_platform=f->>'platform')
  and (v_view<>'missing' or d.status_code=3)
 ), scoped as (
  select d.* from eligible d where (v_view='records' or d.operation_time_source in ('operationTime','operateTime')) and (action='detail' or all_history or
   case when f->>'dateBasis'='operation' then (d.operated_at at time zone v_timezone)::date else coalesce(d.submitted_date,(d.submitted_at at time zone v_timezone)::date) end between first_day and last_day)
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

 ), matches as (
  select d.*,coalesce(m.n,0) registration_count,coalesce(m.workorder_match,false) workorder_match,coalesce(m.order_match,false) order_match,coalesce(m.amount_conflict,false) amount_conflict,
   case when v_view<>'missing' then null when nullif(btrim(d.work_order_no),'') is null and nullif(btrim(d.payment_order_no),'') is null then 'review'
    when m.n>1 or m.amount_conflict then 'review' when m.n=1 then 'matched' when nullif(btrim(d.display_team),'') is null then 'review' else 'missing' end registration_status
  from filtered d
  left join lateral (
   select count(*) n,bool_or(d.amount is not null and e.amount is not null and d.amount<>e.amount) amount_conflict,bool_or(nullif(btrim(d.work_order_no),'') is not null and
    (lower(btrim(e.work_order_number))=lower(btrim(d.work_order_no)) or e.source_kind='portal' and exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(e.portal_payload->'workorders')='array' then e.portal_payload->'workorders' else '[]'::jsonb end) w where lower(btrim(w))=lower(btrim(d.work_order_no))))) workorder_match,
    bool_or(nullif(btrim(d.payment_order_no),'') is not null and lower(btrim(e.order_number))=lower(btrim(d.payment_order_no))) order_match
   from public.admin_deposit_followup_rows e
   where v_view='missing' and e.stale_at is null and e.source_kind in ('sheet','portal')
    and (e.source_kind='sheet' or nullif(btrim(d.display_team),'') is not null and e.portal_team=d.display_team) and e.country in (v_country,v_code)
    and (e.platform=d.platform or e.platform=d.display_platform or v_code='IN' and (
     (e.platform,d.platform) in (('82LOTTERY','INDIA82'),('INDIA82','82LOTTERY'),('VEERGAME','Veer.Game'),('Veer.Game','VEERGAME'),('SHREEWIN','Shree.Win'),('Shree.Win','SHREEWIN'))
     or d.display_team='M8' and (e.platform,d.platform) in (('RAJALOTTERY','RAJA'),('RAJA','RAJALOTTERY'))))
    and private.dashboard_scope_allows(v_scope,v_code,d.platform)
    and ((nullif(btrim(d.work_order_no),'') is not null and (lower(btrim(e.work_order_number))=lower(btrim(d.work_order_no)) or e.source_kind='portal' and exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(e.portal_payload->'workorders')='array' then e.portal_payload->'workorders' else '[]'::jsonb end) w where lower(btrim(w))=lower(btrim(d.work_order_no)))))
    or (nullif(btrim(d.payment_order_no),'') is not null and lower(btrim(e.order_number))=lower(btrim(d.payment_order_no))))
  ) m on v_view='missing'
 ), selected as (select * from matches where coalesce(f->>'registrationStatus','')='' or registration_status=f->>'registrationStatus'),
 records_page as (select * from selected order by sort_at desc nulls last,platform,work_order_id limit page_limit offset page_offset),
 workload as (
  select (operated_at at time zone v_timezone)::date as operation_day,display_platform,platform,operator_account,issue_kind,count(*) handled_count,
   sum(amount)::text amount,max(operated_at) last_operated,jsonb_build_object('1',count(*) filter(where status_code=1),'2',count(*) filter(where status_code=2),
   '3',count(*) filter(where status_code=3),'4',count(*) filter(where status_code=4),'5',count(*) filter(where status_code=5),'unknown',count(*) filter(where status_code is null)) status_counts
  from filtered where operated_at is not null group by 1,2,3,4,5
 ), workload_page as (select * from workload order by operation_day desc,handled_count desc,display_platform,operator_account nulls last,issue_kind limit page_limit offset page_offset)
 select jsonb_build_object('ok',true,'sourceStatus','ready','view',v_view,'country',v_country,'countryCode',v_code,'currency',v_currency,'timezone',v_timezone,
  'offset',page_offset,'limit',page_limit,'total',case when v_view='workload' then (select count(*) from workload) else (select count(*) from selected) end,
  'platforms',(select coalesce(jsonb_agg(distinct display_platform order by display_platform),'[]'::jsonb) from names),
  'summary',jsonb_build_object('missingCount',(select count(*) from matches where registration_status='missing'),'matchedCount',(select count(*) from matches where registration_status='matched'),
    'reviewCount',(select count(*) from matches where registration_status='review'),
    'unknownOperationCount',(select count(*) from eligible where operated_at is null or operation_time_source is distinct from 'operationTime' and operation_time_source is distinct from 'operateTime'),
    'fallbackOperationTimeCount',(select count(*) from eligible where operation_time_source='lastUpdateTime'),
    'unknownOperatorCount',(select count(*) from filtered where nullif(btrim(operator_account),'') is null),
    'latestCollectedAt',(select max(observed_at) from names)),
  'rows',case when v_view='workload' then coalesce((select jsonb_agg(jsonb_build_object('date',p.operation_day,'platform',p.display_platform,'sourcePlatform',p.platform,'operatorAccount',coalesce(p.operator_account,''),
    'issueKind',p.issue_kind,'handledCount',p.handled_count,'amount',p.amount,'statusCounts',p.status_counts,'latestOperatedAt',p.last_operated) order by p.operation_day desc,p.handled_count desc,p.display_platform,p.operator_account nulls last,p.issue_kind) from workload_page p),'[]'::jsonb)
   else coalesce((select jsonb_agg(jsonb_build_object(
 'platform',p.display_platform,'workorderId',p.work_order_id,'workorderNo',p.work_order_no,'orderNo',p.payment_order_no,'sourceOrderNo',p.source_order_no,'utr',p.utr,
 'issueKind',p.issue_kind,'statusCode',p.status_code,'amount',p.amount::text,'provider',p.third_party,'workorderType',p.work_order_type_name,'workorderName',p.work_order_name,'channelType',p.channel_type,
 'kycConnected',p.kyc_connected,'utrMatched',p.utr_matched,'reminderCount',p.reminder_count,'submittedAt',p.submitted_at,'operatedAt',p.operated_at,'operatorAccount',p.operator_account,
 'operationTimeSource',p.operation_time_source,'lastUpdatedBy',p.last_updated_by,'sourceUpdatedAt',p.source_updated_at,'collectedAt',p.observed_at,'submittedDate',p.submitted_date,'queryDate',p.query_date,'queryBasis',p.query_basis,'fieldGaps',p.field_gaps,'attachmentTypes',p.attachment_types,
 'id',jsonb_build_array(p.system_name,p.country_code,p.platform,p.work_order_id)::text,'source','AR','country',v_country,'countryCode',v_code,'currency',v_currency,
 'sourcePlatform',p.platform,'team',p.display_team,'attachmentAccess','unavailable','readOnly',true,'retained',true,
 'registrationStatus',p.registration_status,'matchStatus',p.registration_status,'registrationMatchCount',p.registration_count,
 'reason',case when v_view<>'missing' then null when nullif(btrim(p.work_order_no),'') is null and nullif(btrim(p.payment_order_no),'') is null then 'no_identifiers' when p.registration_count>1 then 'duplicate_registrations' when p.amount_conflict then 'amount_conflict' when p.registration_count=1 then 'matched' when nullif(btrim(p.display_team),'') is null then 'team_unconfirmed' else 'no_registration' end,
 'matchedBy',(case when p.workorder_match then '["workorderNo"]'::jsonb else '[]'::jsonb end)||(case when p.order_match then '["orderNo"]'::jsonb else '[]'::jsonb end)
 ) order by p.sort_at desc nulls last,p.platform,p.work_order_id) from records_page p),'[]'::jsonb) end) into answer;
 if action='detail' and (answer->>'total')::int>1 then raise exception using errcode='22023',message='ambiguous_record';end if;
 return answer;
end;$$;
revoke all on function private.dashboard_admin_live_workorder_records(jsonb) from public,anon,authenticated;
create or replace function public.dashboard_admin_live_workorder_records(p_request jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.dashboard_admin_live_workorder_records(p_request); $$;
revoke all on function public.dashboard_admin_live_workorder_records(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_workorder_records(jsonb) to authenticated;
-- The public invoker wrapper needs only the narrow, guarded private function.
grant usage on schema private to authenticated;
grant execute on function private.dashboard_admin_live_workorder_records(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
