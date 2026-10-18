begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
-- CAS only the two existing public/assigned hooks and immutable dependencies.
-- No facts, current heads, source configuration, role catalog or permissions change.
do $guard$begin
 if current_user<>'postgres'then raise exception 'daily_rollup_install_denied';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='5427339943a9cb521c2c43c3ed8be1bb'and md5(pg_get_functiondef(p.oid))='440b357be23118b96336429488321f42'and jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'securityDefiner',prosecdef,'volatility',provolatile,'config',proconfig,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'language',(select lanname from pg_language where oid=p.prolang),'parallel',proparallel,'strict',proisstrict,'leakproof',proleakproof,'cost',procost,'rows',prorows,'returnsSet',proretset,'inputCount',pronargs,'defaults',pronargdefaults)=$meta${"acl":"{postgres=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"defaults":0,"language":"plpgsql","parallel":"u","arguments":"p_request jsonb","leakproof":false,"inputCount":1,"returnsSet":false,"volatility":"v","securityDefiner":true}$meta$::jsonb)then raise exception 'daily_rollup_wrapper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='174e98afbde625ad15b6e257266d2a39'and md5(pg_get_functiondef(p.oid))='8cc5f075a93071460724018b9cc4a87e'and jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'securityDefiner',prosecdef,'volatility',provolatile,'config',proconfig,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'language',(select lanname from pg_language where oid=p.prolang),'parallel',proparallel,'strict',proisstrict,'leakproof',proleakproof,'cost',procost,'rows',prorows,'returnsSet',proretset,'inputCount',pronargs,'defaults',pronargdefaults)=$meta${"acl":"{postgres=X/postgres,authenticated=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"defaults":0,"language":"plpgsql","parallel":"u","arguments":"p_page text, p_request jsonb","leakproof":false,"inputCount":2,"returnsSet":false,"volatility":"v","securityDefiner":true}$meta$::jsonb)then raise exception 'daily_rollup_wrapper_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure and md5(prosrc)='4a38ca3d9bbfbed3cc94250db95064da')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure and md5(prosrc)='0ce8e6980d543059024eb1010d600946')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_canonical_request(jsonb,jsonb)'::regprocedure and md5(prosrc)='56218033e0849e0744f34ba92ad96e72')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure and md5(prosrc)='008e5cee3a4f6ac9e90706c45bee56da')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='58fee45de05fe5567a62e69b297cee88')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)'::regprocedure and md5(prosrc)='e05bf399932d1441b3425a548e0af7ed')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency_common(text)'::regprocedure and md5(prosrc)='36966b6e1e434eb6d5990e551f816b8e')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='f72bd9afabd7c74de273f02f5e46499d')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_key(jsonb,jsonb)'::regprocedure and md5(prosrc)='220e789b11f814a39784fbf63ebdc30c')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_request_reason(jsonb,jsonb)'::regprocedure and md5(prosrc)='56807ad65f1f575fd4d46c1bff0fa885')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.provider_snapshot_dependency_token(jsonb)'::regprocedure and md5(prosrc)='ccf807a978ba7f0d3cb9f527dad6c5d4')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency(jsonb,text)'::regprocedure and md5(prosrc)='8abe872feeb5ab4b2a7f2ee662e39dba')then raise exception 'daily_rollup_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='0909f6961bc2fe1de9101af88396760b')then raise exception 'daily_rollup_dependency_drift';end if;
 if to_regprocedure('private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)')is not null or to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)')is not null then raise exception 'daily_rollup_helper_already_exists';end if;
end;$guard$;
create temporary table daily_rollup_metadata_guard on commit drop as
select 'wrappers'::text key,jsonb_agg(jsonb_build_array(p.oid,(to_jsonb(p)-'prosrc'))order by p.oid)value from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure)
union all select 'financial_functions',to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))
union all select 'snapshot_functions',to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')));

-- BEGIN daily provider read hooks. Closed native days, current prepared heads, no order scan.
-- New names and the two existing wrappers are outside the financial dependency
-- selectors. The existing reader remains the sole admission/authorization path.
create or replace function private.dashboard_admin_daily_provider_fold(
 p_items jsonb,p_request jsonb,p_target jsonb
) returns jsonb language plpgsql stable security invoker set search_path='' as $function$
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
   all_rows:=all_rows||jsonb_build_array(current_row);
  end loop;
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
revoke all on function private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)from public,anon,authenticated,service_role;

create or replace function private.dashboard_admin_daily_provider_prepared_read(p_page text,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''as $function$
declare
 access jsonb;page jsonb;ctx jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;dq jsonb;
 commons jsonb:='{}';scope text;common text;dep text;baseq jsonb;k jsonb;
 parts jsonb:='[]';mappings jsonb:='[]';all_items jsonb:='[]';items jsonb:='[]';chunk jsonb;response jsonb;folded jsonb;
 a timestamptz;b timestamptz;local_a timestamp;local_b timestamp;day date;day_end timestamptz;tz text;
 i integer:=0;start_index integer;part_index integer:=0;mapping jsonb;selected jsonb;original_q jsonb;
 j private.prepared_aggregate_jobs%rowtype;artifact private.prepared_aggregate_artifacts%rowtype;
begin
 -- Same page, query grant and assigned-context checks as the unmodified reader.
 -- Do this before even looking up a prepared head or native platform metadata.
 access:=private.dashboard_role_access();
 if(access->>'canView')::boolean is not true then raise exception using errcode='42501',message='preview_denied';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages')where value->>'id'=p_page;
 if page is null or not(page->'requests'?'aggregate')or not(page->'requests'?'aggregatePrepared')then raise exception using errcode='42501',message='page_action_denied';end if;
 if access->>'mode'='assigned'then
  if not private.dashboard_role_context_valid()or not(access->'permissions'?&array[p_page||'.view',p_page||'.query'])then raise exception using errcode='42501',message='role_permission_denied';end if;
  ctx:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';
  if ctx->>'page'is distinct from p_page or ctx->>'rpc'is distinct from'dashboard_admin_live_aggregate_prepared'or ctx->>'action'is distinct from'aggregatePrepared'then raise exception using errcode='42501',message='page_action_denied';end if;
 end if;
 if p_request is null or jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','forceRefresh']<>'{}'::jsonb or octet_length(p_request::text)>1048576
  or p_request->'publicationVersion'is distinct from'2'::jsonb or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 3
  or p_request?'forceRefresh'and jsonb_typeof(p_request->'forceRefresh')is distinct from'boolean'
 then return private.prepared_aggregate_read(p_page,p_request);end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  -- Invalid UUIDs are delegated to the original validation, never coerced.
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null then return private.prepared_aggregate_read(p_page,p_request);end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or q->>'view'is distinct from'providers'or coalesce(q->>'status','all')<>'all'or q->>'successBasis'is distinct from'success'
   or q->>'successStartAt'is null or q->>'successEndAt'is null
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
  then return private.prepared_aggregate_read(p_page,p_request);end if;
  a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;tz:=t->>'timezone';
  local_a:=a at time zone tz;local_b:=b at time zone tz;
  if a is distinct from(q->>'successStartAt')::timestamptz or b is distinct from(q->>'successEndAt')::timestamptz
   or local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)
   or local_b::date-local_a::date not between 2 and 31 or b>clock_timestamp()
  then return private.prepared_aggregate_read(p_page,p_request);end if;
  start_index:=jsonb_array_length(parts);targets:=targets||jsonb_build_array(t);
  scope:=t->>'scope_group';common:=commons->>scope;
  if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  for day in select generate_series(local_a::date,local_b::date-1,interval'1day')::date loop
   day_end:=(day+1)::timestamp at time zone tz;
   -- Provider totals ignore validated chart bands, just like the unchanged
   -- canonical/base request. Drop them before widening daily direction to all.
   dq:=(q-array['providers','amountBands'])||jsonb_build_object('direction','all',
    'startAt',to_char(day::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char(day_end at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successStartAt',to_char(day::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successEndAt',to_char(day_end at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
   baseq:=private.prepared_aggregate_base_request(dq,t);k:=private.prepared_aggregate_key(baseq,t);
   select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   select a0.*into artifact from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
   if artifact.id is null or artifact.revision is distinct from j.revision or artifact.dependency is distinct from dep
    or j.dependency is distinct from dep or j.target is distinct from t or artifact.cutoff<day_end
    or artifact.cutoff is null or artifact.computed_at is null or artifact.expires_at<=artifact.computed_at
    or artifact.source_complete is null
   then return private.prepared_aggregate_read(p_page,p_request);end if;
   parts:=parts||jsonb_build_array(dq);
  end loop;
  mappings:=mappings||jsonb_build_array(jsonb_build_object('first',start_index,'count',jsonb_array_length(parts)-start_index));
 end loop;
 -- 3 platforms ×31 local days, split sequentially. No client concurrency change,
 -- no broadened original RPC batch contract, no synchronous raw computation.
 if jsonb_array_length(parts)>93 then return private.prepared_aggregate_read(p_page,p_request);end if;
 part_index:=0;
 while part_index<jsonb_array_length(parts)loop
  select jsonb_agg(value order by n)into chunk from jsonb_array_elements(parts)with ordinality p(value,n)where n>part_index and n<=part_index+50;
  response:=private.prepared_aggregate_read(p_page,(p_request-'requests')||jsonb_build_object('requests',chunk));
  if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
   or jsonb_array_length(response->'items')<>jsonb_array_length(chunk)
   or exists(select 1 from jsonb_array_elements(response->'items')with ordinality r(value,n)where value->>'status'is distinct from'ready'or value->'request'is distinct from chunk->(n::integer-1))
  then return private.prepared_aggregate_read(p_page,p_request);end if;
  all_items:=all_items||(response->'items');part_index:=part_index+50;
 end loop;
 i:=0;
 for mapping in select value from jsonb_array_elements(mappings)loop
  original_q:=p_request->'requests'->i;t:=targets->i;
  select jsonb_agg(value order by n)into selected from jsonb_array_elements(all_items)with ordinality r(value,n)
   where n>(mapping->>'first')::integer and n<=(mapping->>'first')::integer+(mapping->>'count')::integer;
  begin
   folded:=private.dashboard_admin_daily_provider_fold(selected,original_q,t);
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then folded:=null;end;
  if folded is null then return private.prepared_aggregate_read(p_page,p_request);end if;
  items:=items||jsonb_build_array(folded);i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 -- Match the existing prepared manager's 16 MiB encoded-response bound.
 -- Preserve original fallback behavior instead of truncating providers/leaves.
 if octet_length(response::text)>16*1024*1024 then return private.prepared_aggregate_read(p_page,p_request);end if;
 return response;
end;$function$;
revoke all on function private.dashboard_admin_daily_provider_prepared_read(text,jsonb)from public,anon,authenticated,service_role;

create or replace function public.dashboard_admin_aggregate_prepared(p_page text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=''as $function$
declare a jsonb:=private.dashboard_role_access();begin
 if a->>'mode'='assigned'then
  return public.dashboard_admin_execute(p_page,p_request||jsonb_build_object('action','aggregatePrepared'));
 end if;
 return private.dashboard_admin_daily_provider_prepared_read(p_page,p_request);
end;$function$;
create or replace function private.dashboard_admin_live_aggregate_prepared(p_request jsonb)
returns jsonb language plpgsql security definer set search_path=''as $function$
declare ctx jsonb:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';begin
 return private.dashboard_admin_daily_provider_prepared_read(ctx->>'page',p_request);
end;$function$;

do $verify$begin
 if(select value from pg_temp.daily_rollup_metadata_guard where key='wrappers')is distinct from(select jsonb_agg(jsonb_build_array(p.oid,(to_jsonb(p)-'prosrc'))order by p.oid)from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure))then raise exception 'daily_rollup_wrapper_metadata_changed';end if;
 if(select value from pg_temp.daily_rollup_metadata_guard where key='financial_functions')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception 'daily_rollup_financial_dependency_changed';end if;
 if(select value from pg_temp.daily_rollup_metadata_guard where key='snapshot_functions')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception 'daily_rollup_snapshot_dependency_changed';end if;
end;$verify$;
commit;
