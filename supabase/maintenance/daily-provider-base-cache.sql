-- Bounded private derived cache only, original prepared admission retained.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
do $guard$begin
 if current_user<>'postgres'then raise exception'daily_base_cache_install_denied';end if;
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='3db6a5b8f8b3f104a08a2ed23c458df4'and md5(pg_get_functiondef(p.oid))='1c13d7415eba1a5bbb38bdbc166ed2d2'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_base_cache_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='e032c2062fc64bb81481593df061a9e9'and md5(pg_get_functiondef(p.oid))='3114e3bb4274b891c45edc7212e78c06'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_base_cache_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='125afac728629ef0323c22887eb16b88'and md5(pg_get_functiondef(p.oid))='85ed3075a6bb501686cd01e960fbf5e7'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_base_cache_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='4e28cfb2d1690ce1b8f11daedb248c99'and md5(pg_get_functiondef(p.oid))='83c12cd4df61b8cfe69a8466d834ef9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_base_cache_entry_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure and md5(prosrc)='4a38ca3d9bbfbed3cc94250db95064da')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure and md5(prosrc)='0ce8e6980d543059024eb1010d600946')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_canonical_request(jsonb,jsonb)'::regprocedure and md5(prosrc)='56218033e0849e0744f34ba92ad96e72')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure and md5(prosrc)='008e5cee3a4f6ac9e90706c45bee56da')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='58fee45de05fe5567a62e69b297cee88')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)'::regprocedure and md5(prosrc)='e05bf399932d1441b3425a548e0af7ed')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency_common(text)'::regprocedure and md5(prosrc)='36966b6e1e434eb6d5990e551f816b8e')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='f72bd9afabd7c74de273f02f5e46499d')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_key(jsonb,jsonb)'::regprocedure and md5(prosrc)='220e789b11f814a39784fbf63ebdc30c')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_request_reason(jsonb,jsonb)'::regprocedure and md5(prosrc)='56807ad65f1f575fd4d46c1bff0fa885')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.provider_snapshot_dependency_token(jsonb)'::regprocedure and md5(prosrc)='ccf807a978ba7f0d3cb9f527dad6c5d4')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency(jsonb,text)'::regprocedure and md5(prosrc)='8abe872feeb5ab4b2a7f2ee662e39dba')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='0909f6961bc2fe1de9101af88396760b')then raise exception 'daily_base_cache_dependency_drift';end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.prepared_aggregate_artifacts'::regclass and tgname='prepared_aggregate_immutable'and tgenabled in('O','A')and tgfoid=to_regprocedure('private.prepared_aggregate_immutable()')and(tgtype&19)=19)then raise exception'daily_base_cache_immutable_artifact_required';end if;
 if to_regclass('private.daily_provider_base_force_seq')is not null and not exists(
 select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_sequence s on s.seqrelid=c.oid
 where c.oid=to_regclass('private.daily_provider_base_force_seq') and c.relkind='S'and pg_get_userbyid(c.relowner)='postgres'
 and s.seqincrement=1 and not s.seqcycle and s.seqcache=1
 and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('s',c.relowner)))a where a.grantee<>c.relowner))
 then raise exception'daily_base_cache_sequence_drift';end if;
 if to_regclass('private.daily_provider_base_cache')is not null then raise exception'daily_base_cache_already_exists';end if;
 if to_regprocedure('private.dashboard_admin_daily_base_cache_fence()')is not null then raise exception'daily_base_cache_helper_already_exists';end if;
 if to_regprocedure('private.dashboard_admin_daily_base_cache_original(text,jsonb)')is not null then raise exception'daily_base_cache_helper_already_exists';end if;
 if to_regprocedure('private.dashboard_admin_daily_base_cache_prepare(jsonb,jsonb,jsonb,text,bigint,boolean)')is not null then raise exception'daily_base_cache_helper_already_exists';end if;
 if to_regprocedure('private.dashboard_admin_daily_base_cache_flush(jsonb)')is not null then raise exception'daily_base_cache_helper_already_exists';end if;
end;$guard$;

create temporary table daily_base_cache_metadata_guard on commit drop as
select 'entries'::text key,jsonb_agg(jsonb_build_array(p.oid,(case when p.proname='dashboard_admin_daily_provider_prepared_read'then to_jsonb(p)-'prosrc'else to_jsonb(p)end))order by p.oid)value from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure)
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

-- BEGIN private derived base cache.
-- Private derived-only storage. Immutable source artifacts and the original
-- reader remain the sole financial facts, authorization and admission source.
create sequence if not exists private.daily_provider_base_force_seq start 1 increment 1 no cycle cache 1;
alter sequence private.daily_provider_base_force_seq owner to postgres;
revoke all on sequence private.daily_provider_base_force_seq from public,anon,authenticated,service_role;
create table private.daily_provider_base_cache(
 key_digest text primary key,
 cache_key jsonb not null,
 item jsonb not null,
 item_digest text not null,
 bytes integer not null,
 created_at timestamptz not null,
 expires_at timestamptz not null,
 check(jsonb_typeof(cache_key)='object'and jsonb_typeof(item)='object'),
 check(key_digest=md5(cache_key::text)and item_digest=md5(item::text)),
 check(bytes=octet_length(cache_key::text)+octet_length(item::text)+256 and bytes between 1 and 8388608),
 check(expires_at=created_at+interval'10minutes')
);
alter table private.daily_provider_base_cache owner to postgres;
alter table private.daily_provider_base_cache enable row level security;
revoke all on table private.daily_provider_base_cache from public,anon,authenticated,service_role;

create function private.dashboard_admin_daily_base_cache_fence()returns bigint
language sql volatile security invoker set search_path=''as $function$
 select case when is_called then last_value else 0 end from private.daily_provider_base_force_seq;
$function$;

-- Preserve every original fallback call and its errors. Force never bypasses
-- admission; after it completes, advance an unrepeatable, nontransactional fence.
create function private.dashboard_admin_daily_base_cache_original(p_page text,p_request jsonb)returns jsonb
language plpgsql volatile security invoker set search_path=''as $function$
declare result jsonb;begin
 result:=private.prepared_aggregate_read(p_page,p_request);
 if p_request->'forceRefresh'='true'::jsonb then perform nextval('private.daily_provider_base_force_seq'::regclass);end if;
 return result;
end;$function$;

-- Read/compute only. No cache locks or writes are held across any fold.
-- The caller has already obtained all ready items from the original reader.
create function private.dashboard_admin_daily_base_cache_prepare(p_items jsonb,p_request jsonb,p_target jsonb,p_dependency text,p_fence bigint,p_force boolean)
returns jsonb language plpgsql volatile security invoker set search_path=''as $function$
declare baseq jsonb;requested jsonb;cachekey jsonb;publications jsonb;semantics jsonb;
 baseitem jsonb;projected jsonb;stored private.daily_provider_base_cache%rowtype;pending jsonb;
begin
 if jsonb_typeof(p_items)is distinct from'array'or jsonb_array_length(p_items)not between 2 and 31
 or p_dependency is null or p_fence is null
 or exists(select 1 from jsonb_array_elements(p_items)x where x->>'status'is distinct from'ready'
   or jsonb_typeof(x->'publication')is distinct from'object'or x->'publication'->'calculationComplete'is distinct from'true'::jsonb)
 then return jsonb_build_object('item',private.dashboard_admin_daily_provider_fold(p_items,p_request,p_target));end if;
 baseq:=private.prepared_aggregate_canonical_request((p_request-array['providers','amountBands'])||jsonb_build_object('direction','all'),p_target);
 requested:=private.prepared_aggregate_canonical_request(p_request,p_target);
 -- Requests are retained too: publication components echo exact pagination and
 -- native dates even where the canonical financial base omits offset/limit.
 select jsonb_agg(jsonb_build_object('request',x->'request','publication',x->'publication')order by n)into publications
 from jsonb_array_elements(p_items)with ordinality p(x,n);
 select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.proacl::text)order by p.oid)into semantics
 from pg_proc p where p.oid=any(array[
 'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,
 'private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure,
 'private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure,
 'private.prepared_aggregate_canonical_request(jsonb,jsonb)'::regprocedure]);
 cachekey:=jsonb_build_object('contract',1,'forceFence',p_fence,'target',p_target,'dependency',p_dependency,
 'base',baseq,'dailyPublications',publications,'semantics',semantics);
 if not p_force then
  begin
   select *into stored from private.daily_provider_base_cache
    where key_digest=md5(cachekey::text)and cache_key=cachekey and expires_at>clock_timestamp();
   if found and stored.item_digest=md5(stored.item::text)and stored.item->>'status'='ready'
    and stored.item->'request'=baseq and stored.item->'publication'->'calculationComplete'='true'::jsonb
    and stored.item->'result'->'platform'->>'id'=p_target->>'id'
   then baseitem:=stored.item;end if;
  exception when undefined_table or undefined_column or undefined_function then
   return jsonb_build_object('item',private.dashboard_admin_daily_provider_fold(p_items,p_request,p_target));
  end;
 end if;
 if baseitem is null then
  baseitem:=private.dashboard_admin_daily_provider_fold(p_items,baseq,p_target);
  if baseitem is null then return jsonb_build_object('item',null);end if;
  if baseitem->>'status'='ready'and baseitem->'publication'->'calculationComplete'='true'::jsonb then
   pending:=jsonb_build_object('key',cachekey,'item',baseitem);
  end if;
 end if;
 projected:=private.prepared_aggregate_echo(private.dashboard_prepared_provider_projection(baseitem->'result',baseq,requested),p_request,p_target);
 return jsonb_build_object('item',baseitem||jsonb_build_object('request',p_request,'result',projected),'pending',pending);
end;$function$;

-- Flush only after every platform fold and the complete response-size check.
-- A contender skips storage; it never waits for another query's cache lock.
create function private.dashboard_admin_daily_base_cache_flush(p_pending jsonb)returns void
language plpgsql volatile security invoker set search_path=''as $function$
declare entry jsonb;k jsonb;v jsonb;size integer;stamp timestamptz;fence bigint;n bigint;b bigint;
begin
 if jsonb_typeof(p_pending)is distinct from'array'or jsonb_array_length(p_pending)not between 1 and 3 then return;end if;
 begin
  if not pg_try_advisory_xact_lock(1397048370,1684106312)then return;end if;
  fence:=private.dashboard_admin_daily_base_cache_fence();
  delete from private.daily_provider_base_cache where expires_at<=clock_timestamp()or cache_key->>'forceFence'is distinct from fence::text;
  for entry in select value from jsonb_array_elements(p_pending)loop
   k:=entry->'key';v:=entry->'item';
   if jsonb_typeof(k)is distinct from'object'or jsonb_typeof(v)is distinct from'object'
    or k->>'forceFence'is distinct from fence::text or v->>'status'is distinct from'ready'
    or v->'publication'->'calculationComplete'is distinct from'true'::jsonb then continue;end if;
   size:=octet_length(k::text)+octet_length(v::text)+256;
   if size>8388608 then continue;end if;
   stamp:=clock_timestamp();
   insert into private.daily_provider_base_cache values(md5(k::text),k,v,md5(v::text),size,stamp,stamp+interval'10minutes')
   on conflict(key_digest)do update set item=excluded.item,item_digest=excluded.item_digest,bytes=excluded.bytes,
    created_at=excluded.created_at,expires_at=excluded.expires_at
   where daily_provider_base_cache.cache_key=excluded.cache_key and daily_provider_base_cache.expires_at<=clock_timestamp();
  end loop;
  select count(*),coalesce(sum(bytes),0)into n,b from private.daily_provider_base_cache;
  while n>512 or b>134217728 loop
   delete from private.daily_provider_base_cache where key_digest=(select key_digest from private.daily_provider_base_cache order by created_at,key_digest limit 1);
   select count(*),coalesce(sum(bytes),0)into n,b from private.daily_provider_base_cache;
  end loop;
 exception when undefined_table or undefined_column or undefined_function or unique_violation or check_violation
  or lock_not_available or serialization_failure or deadlock_detected then return;
 end;
end;$function$;
revoke all on function private.dashboard_admin_daily_base_cache_fence()from public,anon,authenticated,service_role;
revoke all on function private.dashboard_admin_daily_base_cache_original(text,jsonb)from public,anon,authenticated,service_role;
revoke all on function private.dashboard_admin_daily_base_cache_prepare(jsonb,jsonb,jsonb,text,bigint,boolean)from public,anon,authenticated,service_role;
revoke all on function private.dashboard_admin_daily_base_cache_flush(jsonb)from public,anon,authenticated,service_role;

create or replace function private.dashboard_admin_daily_provider_prepared_read(p_page text,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''as $function$
declare
 access jsonb;page jsonb;ctx jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;dq jsonb;
 commons jsonb:='{}';cache_dependencies jsonb:='[]';cache_pending jsonb:='[]';cache_result jsonb;cache_fence bigint;scope text;common text;dep text;baseq jsonb;k jsonb;
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
 then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  -- Invalid UUIDs are delegated to the original validation, never coerced.
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or q->>'view'is distinct from'providers'or coalesce(q->>'status','all')<>'all'or q->>'successBasis'is distinct from'success'
   or q->>'successStartAt'is null or q->>'successEndAt'is null
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
  then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
  a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;tz:=t->>'timezone';
  local_a:=a at time zone tz;local_b:=b at time zone tz;
  if a is distinct from(q->>'successStartAt')::timestamptz or b is distinct from(q->>'successEndAt')::timestamptz
   or local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)
   or local_b::date-local_a::date not between 2 and 31 or b>clock_timestamp()
  then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
  start_index:=jsonb_array_length(parts);targets:=targets||jsonb_build_array(t);
  scope:=t->>'scope_group';common:=commons->>scope;
  if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);cache_dependencies:=cache_dependencies||to_jsonb(dep);
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
   then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
   parts:=parts||jsonb_build_array(dq);
  end loop;
  mappings:=mappings||jsonb_build_array(jsonb_build_object('first',start_index,'count',jsonb_array_length(parts)-start_index));
 end loop;
 -- 3 platforms ×31 local days, split sequentially. No client concurrency change,
 -- no broadened original RPC batch contract, no synchronous raw computation.
 if jsonb_array_length(parts)>93 then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
 part_index:=0;
 while part_index<jsonb_array_length(parts)loop
  select jsonb_agg(value order by n)into chunk from jsonb_array_elements(parts)with ordinality p(value,n)where n>part_index and n<=part_index+50;
  response:=private.prepared_aggregate_read(p_page,(p_request-'requests')||jsonb_build_object('requests',chunk));
  if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
   or jsonb_array_length(response->'items')<>jsonb_array_length(chunk)
   or exists(select 1 from jsonb_array_elements(response->'items')with ordinality r(value,n)where value->>'status'is distinct from'ready'or value->'request'is distinct from chunk->(n::integer-1))
  then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
  all_items:=all_items||(response->'items');part_index:=part_index+50;
 end loop;
 cache_fence:=case when p_request->'forceRefresh'='true'::jsonb then nextval('private.daily_provider_base_force_seq'::regclass)else private.dashboard_admin_daily_base_cache_fence()end;
 i:=0;
 for mapping in select value from jsonb_array_elements(mappings)loop
  original_q:=p_request->'requests'->i;t:=targets->i;
  select jsonb_agg(value order by n)into selected from jsonb_array_elements(all_items)with ordinality r(value,n)
   where n>(mapping->>'first')::integer and n<=(mapping->>'first')::integer+(mapping->>'count')::integer;
  begin
   cache_result:=private.dashboard_admin_daily_base_cache_prepare(selected,original_q,t,cache_dependencies->>i,cache_fence,coalesce((p_request->>'forceRefresh')::boolean,false));
   folded:=cache_result->'item';
   if folded='null'::jsonb then folded:=null;end if;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then folded:=null;end;
  if folded is null then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
  if jsonb_typeof(cache_result->'pending')='object'then cache_pending:=cache_pending||jsonb_build_array(cache_result->'pending');end if;
  items:=items||jsonb_build_array(folded);i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 -- Match the existing prepared manager's 16 MiB encoded-response bound.
 -- Preserve original fallback behavior instead of truncating providers/leaves.
 if octet_length(response::text)>16*1024*1024 then return private.dashboard_admin_daily_base_cache_original(p_page,p_request);end if;
 perform private.dashboard_admin_daily_base_cache_flush(cache_pending);
 return response;
end;$function$;

-- END private derived base cache.

do $verify$begin
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='3db6a5b8f8b3f104a08a2ed23c458df4'and md5(pg_get_functiondef(p.oid))='1c13d7415eba1a5bbb38bdbc166ed2d2'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_base_cache_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='e032c2062fc64bb81481593df061a9e9'and md5(pg_get_functiondef(p.oid))='3114e3bb4274b891c45edc7212e78c06'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_base_cache_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='2a4b5167c6c9817e7b2fbcdb345a1da8'and md5(pg_get_functiondef(p.oid))='aa6fce36008c1ff902513424dd6b1645'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_base_cache_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='4e28cfb2d1690ce1b8f11daedb248c99'and md5(pg_get_functiondef(p.oid))='83c12cd4df61b8cfe69a8466d834ef9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception 'daily_base_cache_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_base_cache_fence()'::regprocedure and md5(prosrc)='0b85ae07c56bfe6545fd9a8717e8f69b'and md5(pg_get_functiondef(p.oid))='6c3eb9b2422de7a3abd0909d71f48777'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_cache_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_base_cache_original(text,jsonb)'::regprocedure and md5(prosrc)='ee9f14e9abb790f5da04bdfc1c824729'and md5(pg_get_functiondef(p.oid))='fd0dac23b01fa78f8f144ac976714308'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_cache_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_base_cache_prepare(jsonb,jsonb,jsonb,text,bigint,boolean)'::regprocedure and md5(prosrc)='ecb3610f0afc06b5caec38d4b73e7569'and md5(pg_get_functiondef(p.oid))='5910246eadca03d013a35c31dd819aab'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_cache_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_base_cache_flush(jsonb)'::regprocedure and md5(prosrc)='b19137022ca9335bd25dba6554abd2d0'and md5(pg_get_functiondef(p.oid))='324ab37ae0c4936d5e54a3f8424d039a'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_cache_helper_drift';end if;
 if to_regclass('private.daily_provider_base_force_seq')is not null and not exists(
 select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_sequence s on s.seqrelid=c.oid
 where c.oid=to_regclass('private.daily_provider_base_force_seq') and c.relkind='S'and pg_get_userbyid(c.relowner)='postgres'
 and s.seqincrement=1 and not s.seqcycle and s.seqcache=1
 and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('s',c.relowner)))a where a.grantee<>c.relowner))
 then raise exception'daily_base_cache_sequence_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_cache'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity
 and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
 and not exists(select 1 from pg_policy where polrelid=c.oid)
 and(select count(*)from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped)=7
 and(select count(*)from pg_constraint where conrelid=c.oid and contype in('p','c'))=5)
 then raise exception'daily_base_cache_storage_drift';end if;

 if(select value from pg_temp.daily_base_cache_metadata_guard where key='entries')is distinct from(select jsonb_agg(jsonb_build_array(p.oid,(case when p.proname='dashboard_admin_daily_provider_prepared_read'then to_jsonb(p)-'prosrc'else to_jsonb(p)end))order by p.oid)from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure))then raise exception'daily_base_cache_metadata_changed';end if;
 if(select value from pg_temp.daily_base_cache_metadata_guard where key='financial')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception'daily_base_cache_financial_dependency_changed';end if;
 if(select value from pg_temp.daily_base_cache_metadata_guard where key='snapshot')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception'daily_base_cache_snapshot_dependency_changed';end if;
end;$verify$;
commit;
