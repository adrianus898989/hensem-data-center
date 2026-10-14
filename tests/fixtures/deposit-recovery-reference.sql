-- Independent wide JSON mathematical reference; synthetic tests only.
create function private.synthetic_deposit_recovery_cases(p_scope jsonb,p_details boolean default false,p_filter jsonb default '{}'::jsonb)
returns table(case_id text,country text,platform text,payment_id text,order_date date,provider text,original_amount numeric,registered_state text,recovery_kind text,recovery_amount numeric,completed_at date,raw_source_rows bigint,duplicate_source_rows bigint,history_progression boolean,conflict boolean,missing_identity boolean,sources jsonb,sources_truncated boolean,source_coverage jsonb,updated_at timestamptz)
language sql stable security invoker set search_path='' as $fn$
with raw_platforms as materialized (
 select distinct r.platform from public.admin_deposit_issue_rows r where r.country='印度'and r.stale_at is null
 union select distinct r.platform from public.admin_deposit_followup_rows r where r.country='印度'and r.stale_at is null
), platform_keys as materialized (
 select platform raw_platform,private.dashboard_admin_live_deposit_platform_key('IN',platform) platform_key
 from raw_platforms where private.dashboard_scope_allows(p_scope,'IN',platform)
), rows as materialized (
 select 'issue'::text source_kind,r.id source_id,r.source_sheet,r.source_tab,r.source_row,null::bigint source_gid,r.provider raw_provider,k.platform_key platform,
  upper(nullif(btrim(r.order_number),'')) payment_id,r.amount,
  coalesce(nullif(btrim(r.canonical_provider),''),nullif(btrim(r.provider),'')) provider,
  case when r.confirmation_status='已入款' then 'received'when r.confirmation_status in('入其他订单','转其他三方')then'other'when r.status='未入款'then'unreceived'else'unknown'end receipt_state,
  4 source_rank,'unknown'::text recovery_kind,null::numeric recovery_amount,null::date completed_at,false explicit_invalid,
  r.updated_at observed_at,
  jsonb_build_array(r.amount,r.provider,r.canonical_provider,r.utr,r.status,r.confirmation_status,r.match_status,r.kyc_correct,r.utr_match,r.provider_reply,r.upi_id,r.kyc_upi_id) semantic
 from public.admin_deposit_issue_rows r join platform_keys k on k.raw_platform is not distinct from r.platform where r.country='印度'and r.stale_at is null
 union all
 select r.source_kind,r.id,r.source_sheet,r.source_tab,r.source_row,r.source_gid,r.provider,k.platform_key,
  upper(nullif(btrim(r.order_number),'')),r.amount,nullif(btrim(r.provider),''),
  case when r.source_kind='portal' then case lower(btrim(coalesce(r.portal_payload->'entry'->>'outcome','')))when'success'then'received'when'pending'then'unreceived'when'other_order'then'other'when'other_platform'then'other'when'other_id'then'other'when'refund'then'other'else'unknown'end
   else case lower(btrim(coalesce(r.followup_status,'')))when'success'then'received'when'received'then'received'when'成功'then'received'when'成功到账'then'received'when'已到账'then'received'when'已入款'then'received'when'not yet received'then'unreceived'when'pending'then'unreceived'when'尚未收到'then'unreceived'when'未入款'then'unreceived'when'未到账'then'unreceived'when'refund'then'other'when'退款'then'other'when'success to other order'then'other'when'success to other platform'then'other'when'success to other id'then'other'else'unknown'end end,
  case when r.source_kind='portal'then 3 when r.source_sheet='1o0nhJfztjVX9gNwH43uPWg5BUuhBxDMZ-_WUWdRd588'then 2 when r.source_sheet='1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE'then 1 else 0 end,
  case when r.source_kind='portal'and e.valid then e.kind else'unknown'end,
  case when r.source_kind='portal'and e.valid then e.recovered_amount end,
  case when r.source_kind='portal'and e.valid then e.completed_date end,
  r.source_kind='portal'and e.provided and not coalesce(e.valid,false),
  r.updated_at,
  jsonb_build_array(r.amount,r.provider,r.followup_status,r.utr,r.kyc_correct,r.utr_match,r.provider_reply,r.upi_id,r.kyc_upi_id,r.portal_payload->'entry'->'outcome',r.portal_payload->'entry'->'recoveryKind',r.portal_payload->'entry'->'recoveryAmount',r.portal_payload->'entry'->'completedAt')
 from public.admin_deposit_followup_rows r join platform_keys k on k.raw_platform is not distinct from r.platform
 cross join lateral(select coalesce(r.portal_payload->'entry'->>'recoveryKind','unknown')kind,r.portal_payload->'entry'->>'recoveryAmount'amount_text,r.portal_payload->'entry'->>'completedAt'day_text, r.portal_payload->'entry'->>'outcome'outcome) raw
 cross join lateral(select raw.kind,raw.kind<>'unknown'or coalesce(raw.amount_text,'')<>''or coalesce(raw.day_text,'')<>''or(r.portal_payload->'entry'?'recoveryKind'and jsonb_typeof(r.portal_payload->'entry'->'recoveryKind')<>'string')or(r.portal_payload->'entry'?'recoveryAmount'and jsonb_typeof(r.portal_payload->'entry'->'recoveryAmount')<>'string')or(r.portal_payload->'entry'?'completedAt'and jsonb_typeof(r.portal_payload->'entry'->'completedAt')<>'string')provided,
  case when raw.amount_text~'^[0-9]{1,10}(\.[0-9]{1,2})?$'then raw.amount_text::numeric end recovered_amount,
  private.workorder_receipt_date('RC'||replace(raw.day_text,'-',''))completed_date) parsed
 cross join lateral(select parsed.*,jsonb_typeof(r.portal_payload->'entry'->'recoveryKind')='string'and jsonb_typeof(r.portal_payload->'entry'->'recoveryAmount')='string'and jsonb_typeof(r.portal_payload->'entry'->'completedAt')='string'and raw.outcome='success'and raw.kind in('unknown','third_party','manual')and parsed.recovered_amount>0 and raw.day_text~'^\d{4}-\d{2}-\d{2}$'and parsed.completed_date::text=raw.day_text and parsed.completed_date<=(now()at time zone'Asia/Kolkata')::date valid) e
 where r.country='印度'and r.stale_at is null and r.source_kind in('sheet','portal')
), keyed as materialized (
 select r.*,jsonb_build_array('IN',r.platform,coalesce(r.payment_id,'ROW:'||r.source_kind||':'||r.source_id))::text case_key
 from rows r
), source_stats as materialized (
 select case_key,source_kind,source_sheet,min(source_rank)source_rank,
 count(*)n,count(distinct semantic)variants,count(distinct receipt_state)filter(where receipt_state<>'unknown')state_variants,
 min(receipt_state)filter(where receipt_state<>'unknown')state,
 count(distinct jsonb_build_array(recovery_kind,recovery_amount,completed_at))filter(where recovery_amount is not null)recovery_variants,
 min(recovery_kind)filter(where recovery_kind<>'unknown')kind,min(recovery_amount)filter(where recovery_amount is not null) recovered_amount,min(completed_at)filter(where recovery_amount is not null)completed_date,
 bool_or(explicit_invalid)explicit_invalid,max(observed_at)observed_at
 from keyed group by case_key,source_kind,source_sheet
), totals as materialized (
 select k.case_key,min(k.platform)platform,min(k.payment_id)payment_id,
 case when count(distinct coalesce(k.amount::text,'(missing)'))=1 and min(k.amount)::text not in('NaN','Infinity','-Infinity')then min(k.amount)end amount,
 case when count(distinct k.provider)>1 then'来源冲突'when count(distinct k.provider)=1 then min(k.provider)else'未提供'end provider,
 count(*)raw_rows,
 count(distinct coalesce(k.amount::text,'(missing)'))<>1 or bool_or(k.amount::text in('NaN','Infinity','-Infinity'))or count(distinct k.provider)>1 amount_provider_conflict,
 bool_or(k.payment_id is null or k.platform is null) missing_identity,max(k.observed_at)observed_at
 from keyed k group by k.case_key
), case_source_stats as materialized (
 select case_key,sum(n-variants)duplicates,
 max(state)filter(where source_kind='issue'and state_variants=1)issue_state,
 bool_or(source_kind='issue'and variants>1)issue_conflict,
 bool_or(source_kind='portal'and(explicit_invalid or recovery_variants>1 or state_variants>1))portal_conflict,
 count(distinct jsonb_build_array(kind,recovered_amount,completed_date))filter(where source_kind='portal'and kind is not null)portal_variants,
 min(kind)filter(where source_kind='portal')portal_kind,min(recovered_amount)filter(where source_kind='portal')portal_amount,min(completed_date)filter(where source_kind='portal')portal_date,
 case when count(distinct state)filter(where source_kind='portal'and state_variants=1)=1 then min(state)filter(where source_kind='portal'and state_variants=1)end portal_state,
 max(state)filter(where source_kind='sheet'and source_rank=2 and state_variants=1)new_state,
 max(state)filter(where source_kind='sheet'and source_rank=1 and state_variants=1)old_state,
 bool_or(source_kind='sheet'and state_variants>1)sheet_conflict,
 jsonb_agg(jsonb_build_object('sourceKind',source_kind,'sourceSheet',source_sheet,'rawRows',n,'lastObservedAt',observed_at)order by source_kind,source_sheet)source_coverage
 from source_stats group by case_key
), positioned as materialized (
 select k.*,row_number()over(partition by case_key order by source_rank desc,source_sheet,source_row,source_id)source_position from keyed k where p_details
), provenance as materialized (
 select case_key,jsonb_agg(jsonb_build_object('sourceKind',source_kind,'sourceSheet',source_sheet,'sourceTab',source_tab,'sourceRow',source_row,'sourceGid',source_gid,'sourceId',source_id,'provider',raw_provider,'originalAmount',amount::text,'receiptState',receipt_state,'recoveryKind',recovery_kind,'recoveryAmount',recovery_amount::text,'completedAt',completed_at,'observedAt',observed_at)order by source_position)filter(where source_position<=20)sources
 from positioned group by case_key
), rolled as materialized (
 select t.*,s.duplicates,s.issue_state,s.issue_conflict,s.portal_conflict,s.portal_variants,s.portal_kind,s.portal_amount,s.portal_date,s.portal_state,s.new_state,s.old_state,s.sheet_conflict,s.source_coverage,p.sources
 from totals t join case_source_stats s using(case_key)left join provenance p using(case_key)
), final as (
 select r.*,r.amount_provider_conflict or r.issue_conflict or r.portal_conflict or r.portal_variants>1 or r.missing_identity or coalesce(r.portal_kind is not null and r.issue_state='other',false)
  or coalesce(r.issue_state is null and r.portal_kind is null and r.portal_state is null and (r.sheet_conflict or r.old_state='received'and r.new_state='unreceived'),false)is_conflict,
 r.old_state='unreceived'and(r.new_state='received'or r.issue_state='received'or r.portal_state='received'or r.portal_kind is not null)history_progression,
 case when r.portal_kind is not null then'received'else coalesce(r.issue_state,r.portal_state,r.new_state,r.old_state,'unknown')end receipt_state
 from rolled r
)
select md5(case_key),'印度',platform,payment_id,
 case when private.workorder_receipt_date(payment_id)<=(now()at time zone'Asia/Kolkata')::date then private.workorder_receipt_date(payment_id)end,
 provider,amount,case when is_conflict then'conflict'else receipt_state end,
 case when is_conflict then'unknown'else coalesce(portal_kind,'unknown')end,
 case when not is_conflict then portal_amount end,case when not is_conflict then portal_date end,
 raw_rows,duplicates,coalesce(history_progression,false),coalesce(is_conflict,false),missing_identity,sources,raw_rows>20,source_coverage,observed_at
from final;
$fn$;

create function private.synthetic_deposit_recovery_statistics(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set plan_cache_mode=force_custom_plan as $fn$
declare v_scope jsonb:=private.dashboard_admin_live_scope();v_access jsonb;v_view text:=coalesce(p_request->>'view','summary');v_dates text:=coalesce(p_request->>'dateMode','all');v_state text:=coalesce(p_request->>'recoveryState','all');v_from date;v_to date;v_offset integer:=0;v_limit integer:=20;v_export boolean:=false;v_result jsonb;v_key text;v_annotations jsonb;v_page_keys jsonb;v_needed text[];v_sources jsonb;
begin
 if jsonb_typeof(p_request)is distinct from'object'or octet_length(p_request::text)>12000 or p_request-array['section','view','country','dateMode','startAt','endAt','platform','provider','orderNumber','recoveryState','offset','limit','export']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
 for v_key in select unnest(array['section','view','country','dateMode','startAt','endAt','platform','provider','orderNumber','recoveryState'])loop
  if p_request?v_key and(jsonb_typeof(p_request->v_key)is distinct from'string'or length(p_request->>v_key)>200 or p_request->>v_key~'[[:cntrl:]]')then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if p_request->>'section'is distinct from'recovery'or v_view not in('summary','details')or v_dates not in('all','range')or coalesce(p_request->>'country','')not in('','all','印度','IN')or v_state not in('all','third_party','manual','received_unknown','unreceived','conflict')then raise exception using errcode='22023',message='invalid_view';end if;
 if p_request?'export'then if jsonb_typeof(p_request->'export')is distinct from'boolean'then raise exception using errcode='22023',message='invalid_export';end if;v_export:=(p_request->>'export')::boolean;end if;
 v_access:=private.dashboard_role_access();v_needed:=array['deposit_statistics.view','deposit_statistics.query'];
 if v_view='details'or v_export then v_needed:=array_append(v_needed,'deposit_statistics.detail');end if;
 if v_export then v_needed:=array_append(v_needed,'deposit_statistics.export');end if;
 if not coalesce(v_access->>'mode'='owner'or v_access->>'mode'='assigned'and((v_access->'permissions')?&v_needed),false)then raise exception using errcode='42501',message='role_permission_denied';end if;
 for v_key in select unnest(array['offset','limit'])loop
  if p_request?v_key and(jsonb_typeof(p_request->v_key)is distinct from'number'or p_request->>v_key!~'^[0-9]{1,7}$')then raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 if v_offset>1000000 or v_limit not in(20,50,100)then raise exception using errcode='22023',message='invalid_pagination';end if;
 if v_dates='range'then
  if coalesce(p_request->>'startAt','')!~'^\d{4}-\d{2}-\d{2}T'or coalesce(p_request->>'endAt','')!~'^\d{4}-\d{2}-\d{2}T'then raise exception using errcode='22023',message='invalid_dates';end if;
  v_from:=left(p_request->>'startAt',10)::date;v_to:=left(p_request->>'endAt',10)::date;
  if v_from>v_to or v_to-v_from>366 then raise exception using errcode='22023',message='invalid_dates';end if;
 end if;
 with cases as materialized(
 select c.*,case when c.conflict then'conflict'when c.registered_state='received'then case c.recovery_kind when'third_party'then'third_party'when'manual'then'manual'else'received_unknown'end when c.registered_state='unreceived'then'unreceived'else'unknown'end recovery_state
 from private.synthetic_deposit_recovery_cases(v_scope,false,p_request)c
 ),filtered as materialized(
 select *from cases c where(v_dates='all'or c.order_date between v_from and v_to)
 and(coalesce(p_request->>'platform','')in('','all')or c.platform=private.dashboard_admin_live_deposit_platform_key('IN',p_request->>'platform'))
 and(coalesce(p_request->>'provider','')in('','all')or c.provider=p_request->>'provider')
 and(coalesce(p_request->>'orderNumber','')=''or strpos(lower(coalesce(c.payment_id,'')),lower(p_request->>'orderNumber'))>0)
 and(v_state='all'or c.recovery_state=v_state)
 ),metrics_input as materialized(
 select c.*,jsonb_build_object('registered_state',registered_state,'recovery_kind',recovery_kind,'original_amount',original_amount,'recovery_amount',recovery_amount,'raw_source_rows',raw_source_rows,'duplicate_source_rows',duplicate_source_rows,'history_progression',history_progression,'conflict',conflict,'missing_identity',missing_identity)metric
 from filtered c
 ),stats as materialized(select private.dashboard_admin_deposit_recovery_metrics(coalesce(jsonb_agg(metric),'[]'::jsonb))value,count(*)n,max(updated_at)observed_at from metrics_input),
 daily as materialized(select order_date,private.dashboard_admin_deposit_recovery_metrics(jsonb_agg(metric))||jsonb_build_object('date',order_date)value from metrics_input group by order_date),
 providers as materialized(select provider,private.dashboard_admin_deposit_recovery_metrics(jsonb_agg(metric))||jsonb_build_object('provider',provider)value from metrics_input group by provider),
 page as materialized(select *from filtered c order by order_date desc nulls last,platform,payment_id nulls last,case_id offset(case when v_export then 0 else v_offset end)limit(case when v_export then 50001 else v_limit end)),
 source_counts as materialized(
 select x."sourceKind",x."sourceSheet",sum(x."rawRows")raw_rows,max(x."lastObservedAt")observed_at
 from filtered c cross join lateral jsonb_to_recordset(c.source_coverage)x("sourceKind"text,"sourceSheet"text,"rawRows"bigint,"lastObservedAt"timestamptz)group by 1,2
 )
 select jsonb_build_object('version',1,'section','recovery','source','google-followups-and-portal','dateBasis','rc_receipt_date','view',v_view,'summary',stats.value,
 'daily',coalesce((select jsonb_agg(value order by order_date nulls last)from daily),'[]'::jsonb),'providers',coalesce((select jsonb_agg(value order by provider)from providers),'[]'::jsonb),
 'rows',case when v_view='details'or v_export then coalesce((select jsonb_agg(case when v_export then jsonb_build_object('id',case_id,'platform',platform,'orderNumber',payment_id,'orderDate',order_date,'provider',provider,'originalAmount',original_amount::text,'currency','INR','recoveryKind',recovery_kind,'recoveryAmount',recovery_amount::text,'completedAt',completed_at,'recoveryState',recovery_state,'rawSourceRows',raw_source_rows)else jsonb_build_object('id',case_id,'country',country,'platform',platform,'orderNumber',payment_id,'orderDate',order_date,'provider',provider,'originalAmount',original_amount::text,'currency','INR','registeredState',registered_state,'recoveryKind',recovery_kind,'recoveryAmount',recovery_amount::text,'completedAt',completed_at,'recoveryState',recovery_state,'rawSourceRows',raw_source_rows,'duplicateSourceRows',duplicate_source_rows,'historyProgression',history_progression,'sources',case when v_export then'[]'::jsonb else coalesce(sources,'[]'::jsonb)end,'sourcesTruncated',sources_truncated,'collectedWorkorderCount',null,'processedWorkorderCount',null,'collectedWorkorders','[]'::jsonb,'workorderCoverage','not_loaded','evidenceBasis',case when recovery_kind<>'unknown'then'explicit_portal_recovery'else'google_or_portal_registered_state'end)end order by order_date desc nulls last,platform,payment_id nulls last,case_id)from page),'[]'::jsonb)else'[]'::jsonb end,
 'total',stats.n,'offset',case when v_export then 0 else v_offset end,'limit',case when v_export then 50000 else v_limit end,'exportComplete',v_export,'updatedAt',stats.observed_at,
 'coverage',jsonb_build_object('complete',false,'label','登记记录与补单证据；采集完整性、实际到账仍未验证','methodComplete',coalesce((stats.value->>'receivedUnknownCount')::bigint,0)+coalesce((stats.value->>'unclassifiedCount')::bigint,0)+coalesce((stats.value->>'conflictCount')::bigint,0)=0,'unknownMethodCount',(stats.value->'receivedUnknownCount'),'missingIdentityCount',(select count(*)from filtered where missing_identity),'aggregateTruncated',false,'aggregateMaxGroups',5000,'exportMaxRows',50000,'exportMaxBytes',16777216,'sources',coalesce((select jsonb_agg(jsonb_build_object('sourceKind',"sourceKind",'sourceSheet',"sourceSheet",'rawRows',raw_rows,'lastObservedAt',observed_at)order by "sourceKind","sourceSheet")from source_counts),'[]'::jsonb)),
 '_dailyCount',(select count(*)from daily),'_providerCount',(select count(*)from providers))into v_result from stats;
 if(v_result->>'_dailyCount')::bigint>5000 or(v_result->>'_providerCount')::bigint>5000 then raise exception using errcode='22023',message='recovery_aggregate_too_large';end if;
 v_result:=v_result-array['_dailyCount','_providerCount'];
 if v_export and(v_result->>'total')::bigint>50000 then raise exception using errcode='22023',message='export_too_large';end if;
 if v_view='details'and not v_export then
  select coalesce(jsonb_agg(jsonb_build_object('id',r->'id','platform',r->'platform','orderNumber',r->'orderNumber','originalAmount',r->'originalAmount','currency',r->'currency')),'[]'::jsonb)into v_page_keys from jsonb_array_elements(v_result->'rows')r where jsonb_typeof(r->'platform')='string'and nullif(r->>'platform','')is not null;
  select coalesce(jsonb_object_agg(c.case_id,coalesce(c.sources,'[]'::jsonb)),'{}'::jsonb)into v_sources
  from private.synthetic_deposit_recovery_cases(v_scope,true,jsonb_build_object('caseIds',(select coalesce(jsonb_agg(r->'id'),'[]'::jsonb)from jsonb_array_elements(v_result->'rows')r)))c;
  if jsonb_array_length(v_page_keys)>0 then v_annotations:=private.dashboard_admin_deposit_recovery_workorders(v_scope,v_page_keys);else v_annotations:='{}'::jsonb;end if;
  select jsonb_set(v_result,'{rows}',coalesce(jsonb_agg(r.value||jsonb_build_object('sources',coalesce(v_sources->(r.value->>'id'),'[]'::jsonb))||coalesce(v_annotations->(r.value->>'id'),'{}'::jsonb)order by r.position),'[]'::jsonb))into v_result from jsonb_array_elements(v_result->'rows')with ordinality r(value,position);
 end if;
 if octet_length(v_result::text)>16777216 then raise exception using errcode='22023',message='export_payload_too_large';end if;
 return v_result;
end;
$fn$;
