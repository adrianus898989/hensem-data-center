-- Actual collected AR tickets and original payment orders. No member identity is inferred.
-- Summary comparison is the preceding equal-length local calendar period.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function private.dashboard_admin_live_workorder_analysis(p_query jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='20s' as $$
declare v_scope jsonb:=private.dashboard_admin_live_scope();v_view text:='records';
 v_code text;v_country text;v_timezone text;v_currency text;f jsonb;k text;v text;action text;first_day date;last_day date;
 page_offset int;page_limit int;answer jsonb;all_history boolean:=false;
 requested_view text;requested_operation text;span_days int;current_metrics jsonb;previous_metrics jsonb;
begin
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>8192 then raise exception using errcode='22023',message='invalid_query';end if;
 requested_view:=coalesce(p_query->>'view','records');requested_operation:=coalesce(p_query->>'operation','list');
 if requested_view not in ('records','orders') or not (requested_operation='summary' or requested_view='orders' and requested_operation in ('list','orderDetail')) then
  raise exception using errcode='22023',message='invalid_analysis_request';end if;
 if requested_operation='orderDetail' and (jsonb_typeof(p_query->'filters') is distinct from 'object'
  or (p_query->'filters')-array['platform','orderNo','issueKind']<>'{}'::jsonb
  or coalesce(p_query#>>'{filters,platform}','')='' or coalesce(p_query#>>'{filters,orderNo}','')=''
  or coalesce(p_query#>>'{filters,issueKind}','') not in ('deposit','withdraw')) then
  raise exception using errcode='22023',message='invalid_original_order_identity';end if;
 -- Reuse the established strict country, filter, amount, date and pagination validation.
 -- Original input keys remain present, so unrecognized fields still fail validation.
 p_query:=p_query||jsonb_build_object('view','records','operation','list');
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

 if to_regclass('public.ar_workorder_issue_details') is null then
  return jsonb_build_object('ok',true,'sourceStatus','not_connected','source','AR','rows','[]'::jsonb,'total',0,'version',1);end if;
 span_days:=last_day-first_day+1;
 with recursive period_ranges as materialized (
  select 'current'::text period,first_day from_day,last_day to_day
  union all select 'previous',first_day-span_days,first_day-1
   where requested_operation='summary' and not all_history
 ), native_platforms as materialized (
  select min(d.platform) platform from public.ar_workorder_issue_details d where d.system_name='AR' and d.country_code=v_code
  union all
  select (select min(d.platform) from public.ar_workorder_issue_details d where d.system_name='AR' and d.country_code=v_code and d.platform>p.platform)
  from native_platforms p where p.platform is not null
 ), allowed_platforms as materialized (
  select p.platform,private.dashboard_admin_live_workorder_platform_key(v_code,p.platform) platform_key
  from native_platforms p where p.platform is not null and private.dashboard_scope_allows(v_scope,v_code,p.platform)
 ), selected_platforms as materialized (
  select * from allowed_platforms p where coalesce(f->>'platform','')=''
   or p.platform=f->>'platform' or p.platform_key=private.dashboard_admin_live_workorder_platform_key(v_code,f->>'platform')
 ), candidates as (
  -- Mutually exclusive branches keep original exact-history search and use existing local-date indexes.
  select d.*,r.period,p.platform_key
  from selected_platforms p cross join period_ranges r join public.ar_workorder_issue_details d
   on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
  where all_history
  union all
  select d.*,r.period,p.platform_key
  from selected_platforms p cross join period_ranges r join public.ar_workorder_issue_details d
   on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
  where not all_history and f->>'dateBasis'='operation'
   and d.operated_at>=r.from_day::timestamp at time zone v_timezone and d.operated_at<(r.to_day+1)::timestamp at time zone v_timezone
  union all
  select d.*,r.period,p.platform_key
  from selected_platforms p cross join period_ranges r join public.ar_workorder_issue_details d
   on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
  where not all_history and coalesce(f->>'dateBasis','')<>'operation' and d.submitted_date between r.from_day and r.to_day
  union all
  select d.*,r.period,p.platform_key
  from selected_platforms p cross join period_ranges r join public.ar_workorder_issue_details d
   on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
  where not all_history and coalesce(f->>'dateBasis','')<>'operation' and d.submitted_date is null
   and d.submitted_at>=r.from_day::timestamp at time zone v_timezone and d.submitted_at<(r.to_day+1)::timestamp at time zone v_timezone
 ), filtered as materialized (
  select d.period,case when requested_operation<>'summary' then d.platform end platform,d.platform_key,
   case when requested_operation<>'summary' then d.work_order_id end work_order_id,
   case when requested_operation='orderDetail' then d.work_order_no end work_order_no,
   case when requested_operation='orderDetail' then d.payment_order_no end payment_order_no,
   nullif(btrim(d.payment_order_no),'') original_order_no,d.issue_kind,d.status_code,d.amount,case when requested_operation='orderDetail' then d.third_party end third_party,
   d.kyc_connected,d.utr_matched,
   case when requested_operation='orderDetail' then d.source_order_no end source_order_no,
   case when requested_operation='orderDetail' then d.utr end utr,
   d.utr detail_utr,
   case when requested_operation<>'summary' then d.submitted_at end submitted_at,
   case when requested_operation<>'summary' then d.operated_at end operated_at,
   case when requested_operation='orderDetail' then d.operator_account end operator_account,
   case when requested_operation='orderDetail' then d.operation_time_source end operation_time_source,
   case when requested_operation='orderDetail' then d.last_updated_by end last_updated_by,
   case when requested_operation='orderDetail' then d.source_updated_at end source_updated_at,
   case when requested_operation='orderDetail' then d.field_gaps end field_gaps,
   case when requested_operation='orderDetail' then d.attachment_types end attachment_types,
   case when requested_operation='summary' then null when f->>'dateBasis'='operation' then d.operated_at else coalesce(d.submitted_at,d.submitted_date::timestamp at time zone v_timezone) end sort_at
  from candidates d where
(coalesce(f->>'workorderId','')='' or case when all_history then lower(d.work_order_id)=lower(f->>'workorderId') else strpos(lower(coalesce(d.work_order_id,'')),lower(f->>'workorderId'))>0 end)
  and (coalesce(f->>'workorderNo','')='' or case when all_history then lower(d.work_order_no)=lower(f->>'workorderNo') else strpos(lower(coalesce(d.work_order_no,'')),lower(f->>'workorderNo'))>0 end)
  and (coalesce(f->>'orderNo','')='' or case when requested_operation='orderDetail' then nullif(btrim(d.payment_order_no),'')=f->>'orderNo' when all_history then lower(d.payment_order_no)=lower(f->>'orderNo') else strpos(lower(coalesce(d.payment_order_no,'')),lower(f->>'orderNo'))>0 end)
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

 ), originals as materialized (
  select period,platform_key,issue_kind,original_order_no,
   count(*) ticket_count,count(*) filter(where status_code=4) processed_ticket_count,bool_or(status_code=4) processed,
   count(*) filter(where status_code=1) status_pending_count,count(*) filter(where status_code=2) status_processing_count,
   count(*) filter(where status_code=3) status_rejected_count,count(*) filter(where status_code=4) status_processed_count,
   count(*) filter(where status_code=5) status_system_processing_count,count(*) filter(where status_code is null) status_unknown_count,
   count(*) filter(where kyc_connected is true) kyc_yes_count,count(*) filter(where kyc_connected is false) kyc_no_count,count(*) filter(where kyc_connected is null) kyc_unknown_count,
   count(*) filter(where utr_matched is true) utr_yes_count,count(*) filter(where utr_matched is false) utr_no_count,count(*) filter(where utr_matched is null) utr_unknown_count,
   coalesce(array_agg(distinct nullif(btrim(detail_utr),'') order by nullif(btrim(detail_utr),''))
     filter(where utr_matched is true and nullif(btrim(detail_utr),'') is not null),'{}') utr_values,
   case when min(amount) is null then 0 when min(amount)=max(amount) then 1 else 2 end amount_variants,
   case when min(amount)=max(amount) then min(amount) end amount,
   max(sort_at) latest_at,max(submitted_at) latest_submitted_at,max(operated_at) latest_operated_at
  from filtered where original_order_no is not null
  group by period,platform_key,issue_kind,original_order_no
 ), ticket_metrics as (
  select period,count(*) ticket_count,
   case when count(*) filter(where amount is null)=0 then sum(amount) end ticket_amount,
   count(*) filter(where amount is null) missing_ticket_amount_count,
   count(*) filter(where original_order_no is null) missing_order_number_count,
   count(*) filter(where status_code=4) processed_ticket_count,
   count(*) filter(where status_code=3) rejected_ticket_count,
   count(*) filter(where kyc_connected is true) kyc_yes_count,
   count(*) filter(where kyc_connected is false) kyc_no_count,
   count(*) filter(where kyc_connected is null) kyc_unknown_count,
   count(*) filter(where utr_matched is true) utr_yes_count,
   count(*) filter(where utr_matched is false) utr_no_count,
   count(*) filter(where utr_matched is null) utr_unknown_count,
   case when count(*) filter(where status_code=4 and amount is null)=0 then coalesce(sum(amount) filter(where status_code=4),0) end processed_ticket_amount
  from filtered group by period
 ), original_metrics as (
  select period,count(*) order_count,count(*) filter(where processed) processed_count,
   case when count(*) filter(where amount is null)=0 then sum(amount) end order_amount,
   case when count(*) filter(where processed and amount is null)=0 then coalesce(sum(amount) filter(where processed),0) end processed_amount,
   count(*) filter(where amount_variants>1) amount_conflict_count,count(*) filter(where amount_variants=0) missing_amount_count
  from originals group by period
 ), metrics as (
  select r.period,jsonb_build_object(
   'ticketCount',coalesce(t.ticket_count,0),'ticketAmount',case when t.period is null then '0' else t.ticket_amount::text end,
   'processedTicketCount',coalesce(t.processed_ticket_count,0),'processedTicketAmount',case when t.period is null then '0' else t.processed_ticket_amount::text end,
   'rejectedTicketCount',coalesce(t.rejected_ticket_count,0),
   'kycYesCount',coalesce(t.kyc_yes_count,0),'kycNoCount',coalesce(t.kyc_no_count,0),'kycUnknownCount',coalesce(t.kyc_unknown_count,0),
   'utrYesCount',coalesce(t.utr_yes_count,0),'utrNoCount',coalesce(t.utr_no_count,0),'utrUnknownCount',coalesce(t.utr_unknown_count,0),
   'uniqueOrderCount',case when coalesce(o.order_count,0)=0 and coalesce(t.ticket_count,0)>0 then null else coalesce(o.order_count,0) end,
   'uniqueOrderAmount',case when coalesce(o.order_count,0)=0 and coalesce(t.ticket_count,0)>0 then null when o.period is null then '0' else o.order_amount::text end,
   'uniqueProcessedCount',case when coalesce(o.order_count,0)=0 and coalesce(t.ticket_count,0)>0 then null else coalesce(o.processed_count,0) end,
   'uniqueProcessedAmount',case when coalesce(o.order_count,0)=0 and coalesce(t.ticket_count,0)>0 then null when o.period is null then '0' else o.processed_amount::text end,
   'coverage',jsonb_build_object('source','AR','status',case when coalesce(t.ticket_count,0)>0 and coalesce(o.order_count,0)=0 then 'unavailable'
     when coalesce(t.missing_order_number_count,0)+coalesce(o.amount_conflict_count,0)+coalesce(o.missing_amount_count,0)+coalesce(t.missing_ticket_amount_count,0)>0 then 'partial' else 'complete' end,
    'missingOrderNumberCount',coalesce(t.missing_order_number_count,0),'amountConflictCount',coalesce(o.amount_conflict_count,0),
    'missingAmountCount',coalesce(o.missing_amount_count,0),'missingTicketAmountCount',coalesce(t.missing_ticket_amount_count,0))
  ) value from period_ranges r left join ticket_metrics t using(period) left join original_metrics o using(period)
 ), orders_page as (
  select * from originals where period='current' order by latest_at desc nulls last,platform_key,issue_kind,original_order_no limit page_limit offset page_offset
 ), order_page_metadata as (
  select p.platform_key,p.issue_kind,p.original_order_no,array_agg(distinct d.platform order by d.platform) source_platforms,
   coalesce(array_agg(distinct detail.third_party order by detail.third_party) filter(where nullif(btrim(detail.third_party),'') is not null),'{}') providers,
   coalesce(array_agg(distinct detail.operator_account order by detail.operator_account) filter(where nullif(btrim(detail.operator_account),'') is not null),'{}') operators
  from orders_page p join filtered d on d.period='current' and d.platform_key=p.platform_key and d.issue_kind=p.issue_kind and d.original_order_no=p.original_order_no
  join public.ar_workorder_issue_details detail on detail.system_name='AR' and detail.country_code=v_code and detail.platform=d.platform and detail.work_order_id=d.work_order_id
  where requested_operation='list' group by p.platform_key,p.issue_kind,p.original_order_no
 ), tickets_page as (
  select * from filtered where period='current' order by sort_at desc nulls last,platform,work_order_id limit page_limit offset page_offset
 )
 select jsonb_build_object('ok',true,'sourceStatus','ready','source','AR','version',1,
  'view',requested_view,'operation',requested_operation,'country',v_country,'countryCode',v_code,'timezone',v_timezone,'currency',v_currency,
  'startDate',case when not all_history then first_day end,'endDate',case when not all_history then last_day end,
  'dateBasis',case when f->>'dateBasis'='operation' then 'operation' else 'submission' end,'allHistory',all_history,
  'offset',page_offset,'limit',page_limit,
  'total',case when requested_operation='orderDetail' then (select count(*) from filtered where period='current') else (select count(*) from originals where period='current') end,
  'platforms',(select coalesce(jsonb_agg(distinct platform_key order by platform_key),'[]'::jsonb) from allowed_platforms),
  'current',(select value from metrics where period='current'),
  'previous',(select value from metrics where period='previous'),
  'comparison',case when requested_operation='summary' and not all_history then jsonb_build_object('label',case when span_days=1 then '昨日' else '前期' end,'startDate',first_day-span_days,'endDate',first_day-1,'days',span_days) end,
  'rows',case when requested_operation='summary' then '[]'::jsonb when requested_operation='orderDetail' then coalesce((select jsonb_agg(jsonb_build_object(
   'platform',p.platform_key,'sourcePlatform',p.platform,'workorderId',p.work_order_id,'workorderNo',p.work_order_no,'orderNo',p.payment_order_no,
   'sourceOrderNo',p.source_order_no,'utr',p.utr,'issueKind',p.issue_kind,'statusCode',p.status_code,'amount',p.amount::text,'provider',p.third_party,
   'kycConnected',p.kyc_connected,'utrMatched',p.utr_matched,'submittedAt',p.submitted_at,'operatedAt',p.operated_at,
   'operatorAccount',p.operator_account,'operationTimeSource',p.operation_time_source,'lastUpdatedBy',p.last_updated_by,'sourceUpdatedAt',p.source_updated_at,
   'fieldGaps',p.field_gaps,'attachmentTypes',p.attachment_types,'country',v_country,'currency',v_currency,'source','AR','readOnly',true
  ) order by p.sort_at desc nulls last,p.platform,p.work_order_id) from tickets_page p),'[]'::jsonb)
  else coalesce((select jsonb_agg(jsonb_build_object(
   'platform',p.platform_key,'sourcePlatforms',m.source_platforms,'orderNo',p.original_order_no,'issueKind',p.issue_kind,'amount',p.amount::text,
   'amountStatus',case when p.amount_variants>1 then 'conflict' when p.amount_variants=0 then 'missing' else 'known' end,
   'ticketCount',p.ticket_count,'processedTicketCount',p.processed_ticket_count,'rejectedTicketCount',p.status_rejected_count,'processed',p.processed,
   'statusCounts',jsonb_build_object('1',p.status_pending_count,'2',p.status_processing_count,'3',p.status_rejected_count,'4',p.status_processed_count,'5',p.status_system_processing_count,'unknown',p.status_unknown_count),
   'kycCounts',jsonb_build_object('yes',p.kyc_yes_count,'no',p.kyc_no_count,'unknown',p.kyc_unknown_count),
   'utrCounts',jsonb_build_object('yes',p.utr_yes_count,'no',p.utr_no_count,'unknown',p.utr_unknown_count),'utrValues',p.utr_values,
   'providers',m.providers,'operators',m.operators,
   'latestSubmittedAt',p.latest_submitted_at,'latestOperatedAt',p.latest_operated_at,'country',v_country,'currency',v_currency,'source','AR','readOnly',true
  ) order by p.latest_at desc nulls last,p.platform_key,p.issue_kind,p.original_order_no) from orders_page p left join order_page_metadata m using(platform_key,issue_kind,original_order_no)),'[]'::jsonb) end
 ) into answer;
 current_metrics:=answer->'current';previous_metrics:=answer->'previous';
 if requested_operation='summary' and previous_metrics is not null and previous_metrics<>'null'::jsonb then
  answer:=answer||jsonb_build_object('changes',(select jsonb_object_agg(field,jsonb_build_object(
   'delta',case when current_metrics->>field is not null and previous_metrics->>field is not null then ((current_metrics->>field)::numeric-(previous_metrics->>field)::numeric)::text end,
   'percent',case when current_metrics->>field is not null and (previous_metrics->>field)::numeric>0 then round(((current_metrics->>field)::numeric-(previous_metrics->>field)::numeric)/(previous_metrics->>field)::numeric*100,2)::text end,
   'previous',previous_metrics->field
  )) from unnest(array['ticketCount','ticketAmount','processedTicketCount','processedTicketAmount','uniqueOrderCount','uniqueOrderAmount','uniqueProcessedCount','uniqueProcessedAmount']) field));
 end if;
 return answer;
end;$$;
revoke all on function private.dashboard_admin_live_workorder_analysis(jsonb) from public,anon,authenticated;
grant execute on function private.dashboard_admin_live_workorder_analysis(jsonb) to authenticated;

-- Preserve the optimized legacy path exactly; new reads remain behind the same fresh owner authorization.
create or replace function public.dashboard_admin_live_workorder_records(p_request jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
 select case when p_request->>'view'='orders' or p_request->>'operation' in ('summary','orderDetail')
  then private.dashboard_admin_live_workorder_analysis(p_request)
  else private.dashboard_admin_live_workorder_records(p_request) end;
$$;
revoke all on function public.dashboard_admin_live_workorder_records(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_workorder_records(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
