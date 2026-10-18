-- One-helper V4 correction: append fully validated provider arrays once per native day.
-- All original leaves, validation, native aliases, nulls, numeric/text output,
-- fee rules, evidence and final projection remain unchanged. No reader/queue change.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
do $guard$begin
 if current_user<>'postgres'then raise exception 'daily_rollup_v4_install_denied';end if;
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='3db6a5b8f8b3f104a08a2ed23c458df4'and md5(pg_get_functiondef(p.oid))='1c13d7415eba1a5bbb38bdbc166ed2d2'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_rollup_v4_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='fd65b0e03aee1a00861cea80666b4ecf'and md5(pg_get_functiondef(p.oid))='b95a83196f4c95de2684d85bf2c9f69f'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_rollup_v4_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='125afac728629ef0323c22887eb16b88'and md5(pg_get_functiondef(p.oid))='85ed3075a6bb501686cd01e960fbf5e7'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_rollup_v4_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='4e28cfb2d1690ce1b8f11daedb248c99'and md5(pg_get_functiondef(p.oid))='83c12cd4df61b8cfe69a8466d834ef9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_rollup_v4_entry_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure and md5(prosrc)='4a38ca3d9bbfbed3cc94250db95064da')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure and md5(prosrc)='0ce8e6980d543059024eb1010d600946')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_canonical_request(jsonb,jsonb)'::regprocedure and md5(prosrc)='56218033e0849e0744f34ba92ad96e72')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure and md5(prosrc)='008e5cee3a4f6ac9e90706c45bee56da')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='58fee45de05fe5567a62e69b297cee88')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)'::regprocedure and md5(prosrc)='e05bf399932d1441b3425a548e0af7ed')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency_common(text)'::regprocedure and md5(prosrc)='36966b6e1e434eb6d5990e551f816b8e')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='f72bd9afabd7c74de273f02f5e46499d')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_key(jsonb,jsonb)'::regprocedure and md5(prosrc)='220e789b11f814a39784fbf63ebdc30c')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_request_reason(jsonb,jsonb)'::regprocedure and md5(prosrc)='56807ad65f1f575fd4d46c1bff0fa885')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.provider_snapshot_dependency_token(jsonb)'::regprocedure and md5(prosrc)='ccf807a978ba7f0d3cb9f527dad6c5d4')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency(jsonb,text)'::regprocedure and md5(prosrc)='8abe872feeb5ab4b2a7f2ee662e39dba')then raise exception 'daily_rollup_v4_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='0909f6961bc2fe1de9101af88396760b')then raise exception 'daily_rollup_v4_dependency_drift';end if;
end;$guard$;
create temporary table daily_rollup_v4_metadata_guard on commit drop as
select 'entries'::text key,jsonb_agg(jsonb_build_array(p.oid,(case when p.proname='dashboard_admin_daily_provider_fold'then to_jsonb(p)-'prosrc'else to_jsonb(p)end))order by p.oid)value from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure)
union all select 'financial',to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))
union all select 'snapshot',to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')));

CREATE OR REPLACE FUNCTION private.dashboard_admin_daily_provider_fold(p_items jsonb, p_request jsonb, p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 item jsonb;current_row jsonb;leaf jsonb;bucket record;key text;n numeric;bad boolean;
 all_rows jsonb:='[]';providers jsonb:='[]';summaries jsonb:='[]';row_value jsonb;
 payload jsonb;first_payload jsonb;pub jsonb;components jsonb:='[]';baseq jsonb;canonicalq jsonb;
 computed timestamptz;expires timestamptz;cutoff timestamptz;maxcutoff timestamptz;
 next_refresh timestamptz;refresh_known boolean:=true;identity_token text;fresh boolean:=true;complete boolean:=true;refresh_state text:='idle';
 evidence jsonb;stamp text;total numeric;matched numeric;unmatched numeric;fee numeric;
 counts constant text[]:=array['all_count','success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count','missing_amount_count','negative_amount_count','fee_low_count','fee_high_count','fee_gap_count','fee_unpriced_count','fee_version_matched_count','fee_version_unmatched_count'];
 amounts constant text[]:=array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount','fee_low_amount','fee_high_amount','fee_gap_amount'];
 optional_counts constant text[]:=array['fee_exempt_count','reviewed_pending_count'];
 optional_amounts constant text[]:=array['created_success_amount','reviewed_pending_amount'];
begin
 if jsonb_typeof(p_items)is distinct from'array'or jsonb_array_length(p_items)not between 2 and 31 then return null;end if;
 for item in select value from jsonb_array_elements(p_items)loop
  payload:=item->'result';pub:=item->'publication';
  if item->>'status'is distinct from'ready'or jsonb_typeof(payload)is distinct from'object'
   or payload->>'version'is distinct from'1'or payload->'rows'is distinct from'[]'::jsonb
   or jsonb_typeof(payload->'summary')is distinct from'array'or jsonb_typeof(payload->'groups'->'provider')is distinct from'array'
   or payload?|array['error','partial','_parts','_preparedPublication']
   or payload->'platform'->>'id'is distinct from p_target->>'id'
   or payload->'platform'->>'source'is distinct from p_target->>'source'
   or payload->'platform'->>'name'is distinct from p_target->>'name'
   or payload->'platform'->>'sourceName'is distinct from p_target->>'source_name'
   or payload->'platform'->>'country'is distinct from p_target->>'country'
   or payload->'platform'->>'currency'is distinct from p_target->>'currency'
   or payload->'platform'->>'timezone'is distinct from p_target->>'timezone'
   or payload->>'successBasis'is distinct from'success'
   or (payload->>'startAt')::timestamptz is distinct from(item->'request'->>'startAt')::timestamptz
   or (payload->>'endAt')::timestamptz is distinct from(item->'request'->>'endAt')::timestamptz
   or (payload->>'successStartAt')::timestamptz is distinct from(payload->>'startAt')::timestamptz
   or (payload->>'successEndAt')::timestamptz is distinct from(payload->>'endAt')::timestamptz
   or payload->'coverage'->'calculationComplete'='false'::jsonb
   or jsonb_typeof(pub)is distinct from'object'or coalesce(pub->>'id','')=''
   or coalesce(pub->>'generation','')=''or pub->'calculationComplete'is distinct from'true'::jsonb
   or jsonb_typeof(pub->'sourceComplete')is distinct from'boolean'
   or coalesce(pub->>'freshness','')not in('fresh','refresh_due')or coalesce(pub->>'refreshState','')not in('idle','queued','running','failed')
   or pub->>'computedAt'is null or pub->>'expiresAt'is null or pub->>'cutoff'is null
   or (pub->>'expiresAt')::timestamptz<=(pub->>'computedAt')::timestamptz
   or (pub->>'cutoff')::timestamptz<(payload->>'endAt')::timestamptz
  then return null;end if;
  if first_payload is null then first_payload:=payload;end if;
  computed:=least(computed,(pub->>'computedAt')::timestamptz);
  expires:=least(expires,(pub->>'expiresAt')::timestamptz);
  cutoff:=least(cutoff,(pub->>'cutoff')::timestamptz);maxcutoff:=greatest(maxcutoff,(pub->>'cutoff')::timestamptz);
  next_refresh:=least(next_refresh,(pub->>'nextRefreshAt')::timestamptz);
  refresh_known:=refresh_known and pub->>'nextRefreshAt'is not null;
  fresh:=fresh and pub->>'freshness'='fresh';complete:=complete and(pub->>'sourceComplete')::boolean
   and coalesce(payload->'coverage'->'sourceComplete','true'::jsonb)<>'false'::jsonb
   and coalesce(payload->'capabilities'->'sourceCompletenessVerified','true'::jsonb)<>'false'::jsonb;
  if pub->>'refreshState'='running'then refresh_state:='running';
  elsif pub->>'refreshState'='queued'and refresh_state<>'running'then refresh_state:='queued';
  elsif pub->>'refreshState'='failed'and refresh_state='idle'then refresh_state:='failed';end if;
  components:=components||jsonb_build_array(jsonb_build_object('request',item->'request','publication',pub,
   'evidence',jsonb_build_object('basis',payload->'basis','coverage',payload->'coverage','capabilities',payload->'capabilities')));
  for current_row in select value from jsonb_array_elements(payload->'groups'->'provider')loop
   if jsonb_typeof(current_row)is distinct from'object'or coalesce(current_row->>'direction','')not in('charge','withdraw')
    or current_row->>'currency'is distinct from p_target->>'currency'or current_row->>'provider'is null then return null;end if;
   -- Required additive ABI is finite. Unknown numeric facts stay null; invalid
   -- non-null facts cause an ordinary original-reader fallback, never a zero.
   foreach key in array counts||optional_counts loop
    if key=any(counts)and not(current_row?key)then return null;end if;
    if current_row?key and current_row->>key is not null and current_row->>key!~'^[0-9]+$'then return null;end if;
   end loop;
   foreach key in array amounts||optional_amounts||array['fee_version_estimated_amount']loop
    if(key=any(amounts)or key='fee_version_estimated_amount')and not(current_row?key)then return null;end if;
    if current_row?key and current_row->>key is not null and current_row->>key!~'^[+-]?[0-9]+([.][0-9]*)?([eE][+-]?[0-9]+)?$'then return null;end if;
   end loop;
   if current_row->>'fee_version_matched_count'is not null and current_row->>'fee_version_unmatched_count'is not null and current_row->>'success_count'is not null
    and(current_row->>'fee_version_matched_count')::numeric+(current_row->>'fee_version_unmatched_count')::numeric<>(current_row->>'success_count')::numeric then return null;end if;
   if(current_row->>'fee_version_matched_count')::numeric>0 and current_row->>'fee_version_estimated_amount'is null then return null;end if;
  end loop;
  -- Preserve native day/row order while copying the full array once per day.
  all_rows:=all_rows||(payload->'groups'->'provider');
 end loop;
 -- Resolve every original label in the native platform context. No frontend
 -- dictionary, prefix inference, cross-platform override, or rate averaging.
 for bucket in with labels as materialized(select distinct r->>'provider' raw from jsonb_array_elements(all_rows)r),
 names as materialized(select raw,private.dashboard_admin_live_provider_canonical(p_target->>'country',p_target->>'source_name',raw)canonical from labels)
 select names.canonical provider,r->>'direction'direction,r->>'currency'currency,jsonb_agg(r)leaves
 from jsonb_array_elements(all_rows)r join names on names.raw=r->>'provider'
 group by names.canonical,r->>'direction',r->>'currency'order by names.canonical,r->>'direction',r->>'currency'
 loop
  -- Editable native aliases need not be idempotent. Such a chain could make a
  -- second canonical projection choose a different row than the original one.
  -- Preserve the exact existing contract by falling back rather than guessing.
  if bucket.provider is null or private.dashboard_admin_live_provider_canonical(p_target->>'country',p_target->>'source_name',bucket.provider)is distinct from bucket.provider then return null;end if;
  row_value:=jsonb_build_object('provider',bucket.provider,'direction',bucket.direction,'currency',bucket.currency,
   'items',bucket.leaves,'fee_items',bucket.leaves,'provider_names',(select jsonb_agg(name order by name)from(
    select distinct name from jsonb_array_elements(bucket.leaves)r cross join lateral jsonb_array_elements_text(
     jsonb_build_array(r->>'provider')||case when jsonb_typeof(r->'provider_names')='array'then r->'provider_names'else'[]'::jsonb end)n(name)where name is not null)a));
  foreach key in array counts||optional_counts||amounts||optional_amounts loop
   if(key=any(optional_counts)or key=any(optional_amounts))and not exists(select 1 from jsonb_array_elements(bucket.leaves)r where r?key)then continue;end if;
   select bool_or(r->>key is null),sum((r->>key)::numeric)into bad,n from jsonb_array_elements(bucket.leaves)r;
   row_value:=row_value||jsonb_build_object(key,case when bad then'null'::jsonb when key=any(counts||optional_counts)then to_jsonb(n)else to_jsonb(n::text)end);
  end loop;
  matched:=(row_value->>'fee_version_matched_count')::numeric;unmatched:=(row_value->>'fee_version_unmatched_count')::numeric;
  if matched is null or unmatched is null then fee:=null;
  elsif matched>0 then
   select sum(case when(r->>'fee_version_matched_count')::numeric>0 then(r->>'fee_version_estimated_amount')::numeric else 0 end)into fee from jsonb_array_elements(bucket.leaves)r;
  elsif unmatched>0 then fee:=null;else fee:=0;end if;
  row_value:=row_value||jsonb_build_object('fee_version_estimated_amount',fee::text,'fee_version_state',
   case when matched is null or unmatched is null then'unknown'when unmatched=0 then'complete'when matched>0 then'partial'else'unknown'end);
  foreach key in array array['success_time_available','success_time_basis','success_available','success_unavailable_reason','fee_available','fee_unavailable_reason','pending_count_available']loop
   select case when count(distinct r->key)=1 and bool_and(r?key)then(jsonb_agg(r->key))->0 end into evidence from jsonb_array_elements(bucket.leaves)r;
   if evidence is not null then row_value:=row_value||jsonb_build_object(key,evidence);end if;
  end loop;
  -- Non-additive statistics have no proved range union. Never copy day one's
  -- people, rates, submission deduplication, latency percentiles, or time bucket.
  foreach key in array array['member_count','distinct_member_count','unique_member_count','success_member_count','invalid_members','invalid_count','adjusted_rate','success_rate','p50','p90','p95','p99','avg_duration_seconds','median_duration_seconds']loop
   if exists(select 1 from jsonb_array_elements(bucket.leaves)r where r?key)then row_value:=row_value||jsonb_build_object(key,null);end if;
  end loop;
  select r->>'latest_synced_at'into stamp from jsonb_array_elements(bucket.leaves)r where r->>'latest_synced_at'is not null order by(r->>'latest_synced_at')::timestamptz desc limit 1;
  row_value:=row_value||jsonb_build_object('latest_synced_at',stamp);
  providers:=providers||jsonb_build_array(row_value);
 end loop;
 -- Reuse the existing backend provider projection for its exact summary ABI.
 -- An explicit direction avoids its providerless/all early return.
 baseq:=private.prepared_aggregate_canonical_request((p_request-'providers')||jsonb_build_object('direction','all'),p_target);
 canonicalq:=private.prepared_aggregate_canonical_request(p_request,p_target);
 payload:=jsonb_build_object('version',1,'platform',first_payload->'platform','summary','[]'::jsonb,'rows','[]'::jsonb,
  'groups',jsonb_build_object('provider',providers),'startAt',p_request->>'startAt','endAt',p_request->>'endAt',
  'successStartAt',p_request->>'successStartAt','successEndAt',p_request->>'successEndAt','successBasis','success',
  'asOf',cutoff,'asOfBasis','mixed_daily_publications','asOfRange',jsonb_build_object('earliest',cutoff,'latest',maxcutoff),
  'latencySummary','[]'::jsonb,'pendingSummary','[]'::jsonb,'nonAdditiveStatistics','unavailable_daily_union',
  'coverage',jsonb_build_object('calculationComplete',true,'sourceComplete',complete,'sourceCompletenessVerified',false,'basis','daily_prepared_heads'));
 foreach key in array array['source','timeBasis','capabilities','_preparedDirectionCapabilities','basis']loop
  if first_payload?key then payload:=payload||jsonb_build_object(key,first_payload->key);end if;
 end loop;
 foreach key in array array['charge','withdraw']loop
  current_row:=private.dashboard_prepared_provider_projection(payload,baseq,baseq||jsonb_build_object('direction',key));
  summaries:=summaries||(current_row->'summary');
 end loop;
 select coalesce(bool_or(r->>'all_count'is null),false),coalesce(sum((r->>'all_count')::numeric),0)into bad,total from jsonb_array_elements(providers)r;
 payload:=payload||jsonb_build_object('summary',summaries,'total',case when bad then null else total end);
 payload:=private.prepared_aggregate_echo(private.dashboard_prepared_provider_projection(payload,baseq,canonicalq),p_request,p_target);
 if jsonb_typeof(payload->'capabilities')='object'then payload:=jsonb_set(payload,'{capabilities}',payload->'capabilities'||jsonb_build_object('asOfBasis','mixed_daily_publications','sourceCompletenessVerified',false));end if;
 if jsonb_typeof(payload->'platform'->'capabilities')='object'then payload:=jsonb_set(payload,'{platform,capabilities}',payload->'platform'->'capabilities'||jsonb_build_object('asOfBasis','mixed_daily_publications','sourceCompletenessVerified',false));end if;
 select md5(jsonb_agg(jsonb_build_array(c->'publication'->>'id',c->'publication'->>'generation')order by ord)::text)into identity_token from jsonb_array_elements(components)with ordinality p(c,ord);
 return jsonb_build_object('request',p_request,'status','ready','result',payload,'publication',jsonb_build_object(
  'kind','daily_provider_rollup','id','daily:'||identity_token,'generation','daily:'||identity_token,
  'computedAt',computed,'expiresAt',expires,'cutoff',cutoff,'cutoffRange',jsonb_build_object('earliest',cutoff,'latest',maxcutoff),
  'calculationComplete',true,'sourceComplete',complete,'freshness',case when fresh then'fresh'else'refresh_due'end,
  'nextRefreshAt',case when refresh_known then next_refresh end,'refreshState',refresh_state,'components',components));
end;$function$;

do $verify$begin
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='3db6a5b8f8b3f104a08a2ed23c458df4'and md5(pg_get_functiondef(p.oid))='1c13d7415eba1a5bbb38bdbc166ed2d2'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_rollup_v4_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='e032c2062fc64bb81481593df061a9e9'and md5(pg_get_functiondef(p.oid))='3114e3bb4274b891c45edc7212e78c06'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_rollup_v4_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='125afac728629ef0323c22887eb16b88'and md5(pg_get_functiondef(p.oid))='85ed3075a6bb501686cd01e960fbf5e7'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_rollup_v4_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='4e28cfb2d1690ce1b8f11daedb248c99'and md5(pg_get_functiondef(p.oid))='83c12cd4df61b8cfe69a8466d834ef9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_rollup_v4_entry_drift';end if;
 if(select value from pg_temp.daily_rollup_v4_metadata_guard where key='entries')is distinct from(select jsonb_agg(jsonb_build_array(p.oid,(case when p.proname='dashboard_admin_daily_provider_fold'then to_jsonb(p)-'prosrc'else to_jsonb(p)end))order by p.oid)from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure))then raise exception 'daily_rollup_v4_metadata_changed';end if;
 if(select value from pg_temp.daily_rollup_v4_metadata_guard where key='financial')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception 'daily_rollup_v4_financial_dependency_changed';end if;
 if(select value from pg_temp.daily_rollup_v4_metadata_guard where key='snapshot')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception 'daily_rollup_v4_snapshot_dependency_changed';end if;
end;$verify$;
commit;
