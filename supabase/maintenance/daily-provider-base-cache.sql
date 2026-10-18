-- Stage 1: private async jobs/workers only. Original V4 query reader remains active.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
do $guard$begin
 if current_user<>'postgres'then raise exception'daily_base_async_install_denied';end if;
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='3db6a5b8f8b3f104a08a2ed23c458df4'and md5(pg_get_functiondef(p.oid))='1c13d7415eba1a5bbb38bdbc166ed2d2'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='e032c2062fc64bb81481593df061a9e9'and md5(pg_get_functiondef(p.oid))='3114e3bb4274b891c45edc7212e78c06'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='125afac728629ef0323c22887eb16b88'and md5(pg_get_functiondef(p.oid))='85ed3075a6bb501686cd01e960fbf5e7'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='4e28cfb2d1690ce1b8f11daedb248c99'and md5(pg_get_functiondef(p.oid))='83c12cd4df61b8cfe69a8466d834ef9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure and md5(prosrc)='956360b22e515f11b2eef4d8577cda8c'and md5(pg_get_functiondef(p.oid))='3958399dbab9c624fb95279e1844e083'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_run_dispatch(text)'::regprocedure and md5(prosrc)='fa7d6f1e808b3d74787d95684262b895'and md5(pg_get_functiondef(p.oid))='80fd2482af08da0bc1c0994bb0704551'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_provider_gate()'::regprocedure and md5(prosrc)='4d05df11e47751ef3a703955ef82d1af'and md5(pg_get_functiondef(p.oid))='718cd27304eddae55cf51d130b385e9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure and md5(prosrc)='4a38ca3d9bbfbed3cc94250db95064da')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure and md5(prosrc)='0ce8e6980d543059024eb1010d600946')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_canonical_request(jsonb,jsonb)'::regprocedure and md5(prosrc)='56218033e0849e0744f34ba92ad96e72')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure and md5(prosrc)='008e5cee3a4f6ac9e90706c45bee56da')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='58fee45de05fe5567a62e69b297cee88')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)'::regprocedure and md5(prosrc)='e05bf399932d1441b3425a548e0af7ed')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency_common(text)'::regprocedure and md5(prosrc)='36966b6e1e434eb6d5990e551f816b8e')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='f72bd9afabd7c74de273f02f5e46499d')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_key(jsonb,jsonb)'::regprocedure and md5(prosrc)='220e789b11f814a39784fbf63ebdc30c')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_request_reason(jsonb,jsonb)'::regprocedure and md5(prosrc)='56807ad65f1f575fd4d46c1bff0fa885')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.provider_snapshot_dependency_token(jsonb)'::regprocedure and md5(prosrc)='ccf807a978ba7f0d3cb9f527dad6c5d4')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency(jsonb,text)'::regprocedure and md5(prosrc)='8abe872feeb5ab4b2a7f2ee662e39dba')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='0909f6961bc2fe1de9101af88396760b')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.prepared_aggregate_artifacts'::regclass and tgname='prepared_aggregate_immutable'and tgenabled in('O','A')and tgfoid=to_regprocedure('private.prepared_aggregate_immutable()')and(tgtype&19)=19)then raise exception'daily_base_async_immutable_required';end if;
 if not exists(select 1 from cron.job where jobid=40 and md5(command)='8bb7fcdf4d41a60db1a490326e67f440'and schedule='1 second'and active=true)then raise exception'daily_base_async_dispatch_schedule_drift';end if;
 if to_regclass('private.daily_provider_base_cache')is not null or to_regclass('private.daily_provider_base_force_seq')is not null then raise exception'daily_base_async_replaced_sync_storage_present';end if;
 if to_regclass('private.daily_provider_base_jobs')is not null then raise exception'daily_base_async_already_exists';end if;
 if to_regclass('private.daily_provider_base_artifacts')is not null then raise exception'daily_base_async_already_exists';end if;
 if to_regclass('private.daily_provider_base_heads')is not null then raise exception'daily_base_async_already_exists';end if;
 if to_regclass('private.daily_provider_base_scheduler')is not null then raise exception'daily_base_async_already_exists';end if;
 if to_regclass('private.daily_provider_base_admissions')is not null then raise exception'daily_base_async_already_exists';end if;
 if to_regprocedure('private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)')is not null then raise exception'daily_base_async_helper_present';end if;
 if to_regprocedure('private.daily_provider_base_manifest_matches(jsonb)')is not null then raise exception'daily_base_async_helper_present';end if;
 if to_regprocedure('private.daily_provider_base_current(jsonb,jsonb)')is not null then raise exception'daily_base_async_helper_present';end if;
 if to_regprocedure('private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)')is not null then raise exception'daily_base_async_helper_present';end if;
 if to_regprocedure('private.daily_provider_base_enqueue(jsonb)')is not null then raise exception'daily_base_async_helper_present';end if;
 if to_regprocedure('private.daily_provider_base_claim()')is not null then raise exception'daily_base_async_helper_present';end if;
 if to_regprocedure('private.daily_provider_base_run_claimed()')is not null then raise exception'daily_base_async_helper_present';end if;
 if to_regprocedure('private.daily_provider_base_prewarm(jsonb)')is not null then raise exception'daily_base_async_helper_present';end if;
end;$guard$;
create temporary table daily_base_async_guard on commit drop as
select 'entries'::text key,jsonb_agg(jsonb_build_array(p.oid,case when p.oid in('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.withdraw_prepared_run_dispatch(text)'::regprocedure,'private.withdraw_prepared_provider_gate()'::regprocedure)then to_jsonb(p)-'prosrc'else to_jsonb(p)end)order by p.oid)value from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.withdraw_prepared_run_dispatch(text)'::regprocedure,'private.withdraw_prepared_provider_gate()'::regprocedure)
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
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))
union all select 'cron40',to_jsonb(c)from cron.job c where jobid=40;

-- BEGIN async prepared base read model.
-- Private derived facts only. No public RPC, source kernel, JWT or source job.
create table private.daily_provider_base_jobs(
 id uuid primary key default gen_random_uuid(), digest text unique not null, content_key jsonb not null,
 family_digest text not null, family_key jsonb not null, target jsonb not null, request jsonb not null, dependency text not null,daily_metadata jsonb not null,
 status text not null default 'queued' check(status in('queued','running','ready','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3), not_before timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(), last_requested_at timestamptz not null default clock_timestamp(),
 run_id uuid, fence bigint not null default 0, lease_until timestamptz, claim_pid integer, claim_backend_start timestamptz, last_error text,
 check(digest=md5(content_key::text) and family_digest=md5(family_key::text)),
 check(octet_length(content_key::text)+octet_length(family_key::text)+octet_length(daily_metadata::text)<262144)
);
create index daily_provider_base_jobs_due on private.daily_provider_base_jobs(not_before,created_at)where status in('queued','failed')and attempts<3;
create table private.daily_provider_base_artifacts(
 id uuid primary key default gen_random_uuid(), digest text unique not null, content_key jsonb not null,
 family_digest text not null, family_key jsonb not null, item jsonb not null, item_digest text not null,
 bytes integer not null check(bytes between 1 and 8388608), created_at timestamptz not null default clock_timestamp(),
 check(digest=md5(content_key::text) and family_digest=md5(family_key::text) and item_digest=md5(item::text)),
 check(bytes=octet_length(content_key::text)+octet_length(family_key::text)+octet_length(item::text)+256)
);
create table private.daily_provider_base_heads(
 family_digest text primary key, family_key jsonb not null, artifact_id uuid not null references private.daily_provider_base_artifacts(id),
 last_requested_at timestamptz not null default clock_timestamp(),check(family_digest=md5(family_key::text))
);
create table private.daily_provider_base_scheduler(singleton boolean primary key default true check(singleton), next_base boolean not null default true);
create table private.daily_provider_base_admissions(actor uuid not null,day date not null,family_digest text not null,primary key(actor,day,family_digest));
insert into private.daily_provider_base_scheduler values(true,true);
alter table private.daily_provider_base_jobs owner to postgres;
alter table private.daily_provider_base_artifacts owner to postgres;
alter table private.daily_provider_base_heads owner to postgres;
alter table private.daily_provider_base_scheduler owner to postgres;
alter table private.daily_provider_base_admissions owner to postgres;
alter table private.daily_provider_base_jobs enable row level security;
alter table private.daily_provider_base_artifacts enable row level security;
alter table private.daily_provider_base_heads enable row level security;
alter table private.daily_provider_base_scheduler enable row level security;
alter table private.daily_provider_base_admissions enable row level security;
revoke all on private.daily_provider_base_jobs,private.daily_provider_base_artifacts,private.daily_provider_base_heads,private.daily_provider_base_scheduler,private.daily_provider_base_admissions from public,anon,authenticated,service_role;

create function private.daily_provider_base_identity(p_items jsonb,p_request jsonb,p_target jsonb,p_dependency text)returns jsonb
language plpgsql stable set search_path=''as $function$
declare baseq jsonb;semantics jsonb;days jsonb;requests jsonb;family jsonb;k jsonb;
begin
 baseq:=private.prepared_aggregate_canonical_request((p_request-array['providers','amountBands'])||jsonb_build_object('direction','all'),p_target);
 select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.proacl::text)order by p.oid)into semantics
 from pg_proc p where p.oid=any(array[
 'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,
 'private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure,
 'private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)'::regprocedure,
 'private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure,
 'private.prepared_aggregate_canonical_request(jsonb,jsonb)'::regprocedure]);
 select jsonb_agg(jsonb_build_object('request',x->'request','publication',(x->'publication')-array['freshness','refreshState','nextRefreshAt'])order by n),
 jsonb_agg(x->'request'order by n)into days,requests from jsonb_array_elements(p_items)with ordinality p(x,n);
 family:=jsonb_build_object('contract','daily-provider-base-async-v1','target',p_target,'dependency',p_dependency,'base',baseq,'dailyRequests',requests,'semantics',semantics);
 k:=family||jsonb_build_object('dailyPublications',days);
 return jsonb_build_object('key',k,'family',family,'base',baseq);
end;$function$;

-- Cheap final admission CAS. It reads identifiers/metadata only, never payloads.
create function private.daily_provider_base_manifest_matches(p_key jsonb)returns boolean
language sql stable set search_path=''as $function$
 select jsonb_typeof(p_key->'dailyPublications')='array'and jsonb_array_length(p_key->'dailyPublications')between 2 and 31
 and not exists(select 1 from jsonb_array_elements(p_key->'dailyPublications')d where not exists(
  select 1 from private.prepared_aggregate_artifacts a join private.prepared_aggregate_heads h on h.artifact_id=a.id join private.prepared_aggregate_jobs j on j.id=h.job_id and j.id=a.job_id
  where a.id::text=d->'publication'->>'id'and a.revision::text||':'||a.fence::text=d->'publication'->>'generation'
  and a.computed_at=(d->'publication'->>'computedAt')::timestamptz and a.expires_at=(d->'publication'->>'expiresAt')::timestamptz
  and a.cutoff=(d->'publication'->>'cutoff')::timestamptz and a.source_complete=(d->'publication'->>'sourceComplete')::boolean
  and j.target=p_key->'target'and j.dependency=p_key->>'dependency'and a.dependency=j.dependency and a.revision=j.revision));
$function$;

-- Recreate the admitted immutable items from existing heads; never admit a day.
-- Publications are the actual original-reader metadata captured at admission.
create function private.daily_provider_base_current(p_key jsonb,p_metadata jsonb default null)returns jsonb
language plpgsql stable set search_path=''as $function$
declare t jsonb:=p_key->'target';dep text;day jsonb;q jsonb;b jsonb;k jsonb;pub jsonb;payload jsonb;items jsonb:='[]';
 j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;identity jsonb;i integer:=0;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if not private.prepared_aggregate_target_current(t)then return null;end if;
 dep:=private.prepared_aggregate_dependency(t,private.prepared_aggregate_dependency_common(t->>'scope_group'));
 if dep is distinct from p_key->>'dependency'then return null;end if;
 if jsonb_typeof(p_key->'dailyPublications')is distinct from'array'or jsonb_array_length(p_key->'dailyPublications')not between 2 and 31 then return null;end if;
 for day in select value from jsonb_array_elements(p_key->'dailyPublications')loop
  q:=day->'request';pub:=day->'publication';
  if p_metadata is not null then
   if p_metadata->i->'request'is distinct from q or((p_metadata->i->'publication')-array['freshness','refreshState','nextRefreshAt'])is distinct from pub then return null;end if;
   pub:=p_metadata->i->'publication';
  else pub:=pub||jsonb_build_object('freshness','refresh_due','refreshState','idle','nextRefreshAt',null);end if;
  if private.prepared_aggregate_request_reason(q,t)is not null then return null;end if;
  b:=private.prepared_aggregate_base_request(q,t);k:=private.prepared_aggregate_key(b,t);
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
  select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
  if a.id is null or j.target is distinct from t or j.dependency is distinct from dep or a.dependency is distinct from dep
   or a.revision is distinct from j.revision or a.id::text is distinct from pub->>'id'
   or a.revision::text||':'||a.fence::text is distinct from pub->>'generation'
   or a.computed_at is distinct from(pub->>'computedAt')::timestamptz or a.expires_at is distinct from(pub->>'expiresAt')::timestamptz
   or a.cutoff is distinct from(pub->>'cutoff')::timestamptz or a.source_complete is distinct from(pub->>'sourceComplete')::boolean
   or a.cutoff<(q->>'endAt')::timestamptz or a.expires_at<=a.computed_at or a.source_complete is null
  then return null;end if;
  payload:=private.prepared_aggregate_echo(case when b->>'view'='full'and b->>'durationVersion'='2'and not(b?'durationRange')then
   private.prepared_aggregate_master_projection(a.payload,private.prepared_aggregate_canonical_request(b,t),private.prepared_aggregate_canonical_request(q,t))else
   private.dashboard_prepared_provider_projection(a.payload,private.prepared_aggregate_canonical_request(b,t),private.prepared_aggregate_canonical_request(q,t))end,q,t);
  -- Only the three mutable fields are restored for fold validation. They are
  -- intentionally excluded from identity, and replaced live on exact hits.
  items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','result',payload,'publication',pub));i:=i+1;
 end loop;
 identity:=private.daily_provider_base_identity(items,p_key->'base',t,dep);
 if identity->'key'is distinct from p_key then return null;end if;
 return items;
end;$function$;

-- No fold on a miss. All input items have just passed the original reader.
create function private.daily_provider_base_lookup(p_items jsonb,p_request jsonb,p_target jsonb,p_dependency text)returns jsonb
language plpgsql volatile set search_path=''as $function$
declare identity jsonb;k jsonb;family jsonb;baseq jsonb;selected jsonb;meta jsonb;empty_items jsonb;ready jsonb;refresh text;
 a private.daily_provider_base_artifacts%rowtype;j private.daily_provider_base_jobs%rowtype;last_complete boolean:=false;
begin
 identity:=private.daily_provider_base_identity(p_items,p_request,p_target,p_dependency);k:=identity->'key';family:=identity->'family';baseq:=identity->'base';
 select *into j from private.daily_provider_base_jobs where digest=md5(k::text)and content_key=k;
 if j.last_error='fold_incompatible'then return jsonb_build_object('fallback',true);end if;
 select *into a from private.daily_provider_base_artifacts where digest=md5(k::text)and content_key=k;
 if a.id is null then
  select a0.*into a from private.daily_provider_base_heads h join private.daily_provider_base_artifacts a0 on a0.id=h.artifact_id
   where h.family_digest=md5(family::text)and h.family_key=family and a0.family_key=family;
  last_complete:=a.id is not null;
 end if;
 if a.id is not null and a.item_digest=md5(a.item::text)and a.item->>'status'='ready'and a.item->'request'=baseq
  and a.item->'publication'->'calculationComplete'='true'::jsonb and a.item->'result'->'platform'->>'id'=p_target->>'id'then
  ready:=a.item;
  if last_complete then
   refresh:=case when j.status in('running','failed')then j.status else'queued'end;
   ready:=jsonb_set(ready,'{publication}',(ready->'publication')||jsonb_build_object('freshness','refresh_due','refreshState',refresh,'servedLastComplete',true));
  else
   select jsonb_agg(jsonb_set(x,'{result,groups,provider}','[]'::jsonb)order by n)into empty_items from jsonb_array_elements(p_items)with ordinality p(x,n);
   -- Exact existing immutable artifact only: this is metadata assembly, not
   -- validation of new leaves. The worker already validated every real leaf.
   meta:=private.dashboard_admin_daily_provider_fold(empty_items,baseq,p_target);
   if meta is null then return jsonb_build_object('fallback',true);end if;
   ready:=jsonb_set(ready,'{publication}',meta->'publication');
  end if;
  selected:=private.prepared_aggregate_echo(private.dashboard_prepared_provider_projection(ready->'result',baseq,private.prepared_aggregate_canonical_request(p_request,p_target)),p_request,p_target);
  ready:=ready||jsonb_build_object('request',p_request,'result',selected);
 else ready:=null;end if;
 if ready is null then
  ready:=jsonb_build_object('request',p_request,'status',case when j.status='failed'and j.attempts>=3 then'failed'else'building'end,
   'reason',case when j.status='failed'and j.attempts>=3 then coalesce(j.last_error,'daily_provider_base_failed')else'daily_provider_base_preparing'end,'result',null,'publication',null);
 end if;
 return jsonb_build_object('item',ready,'pending',jsonb_build_object('identity',identity,'target',p_target,'request',baseq,'dependency',p_dependency,
  'metadata',(select jsonb_agg(jsonb_build_object('request',x->'request','publication',x->'publication')order by n)from jsonb_array_elements(p_items)with ordinality p(x,n))));
end;$function$;

-- Called only after every lookup/fallback and the final response-size check.
-- Short, nonblocking admission lock; never held across fold or original reader.
create function private.daily_provider_base_enqueue(p_pending jsonb)returns jsonb
language plpgsql volatile set search_path=''as $function$
declare entry jsonb;identity jsonb;k jsonb;f jsonb;j private.daily_provider_base_jobs%rowtype;states jsonb:='{}';n integer;actor_id uuid:=coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid);
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if jsonb_typeof(p_pending)is distinct from'array'or jsonb_array_length(p_pending)not between 1 and 3 then return states;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('daily_provider_base_admission_v1',0))then return states;end if;
 delete from private.daily_provider_base_admissions where day<current_date-1;
 -- Preserve active families' last complete artifact. Retire only cold families.
 delete from private.daily_provider_base_heads h where h.last_requested_at<clock_timestamp()-interval'1day'
  and not exists(select 1 from jsonb_array_elements(p_pending)x where x->'identity'->'family'=h.family_key)
  and not exists(select 1 from private.daily_provider_base_jobs j0 where j0.family_digest=h.family_digest and j0.status='running'and j0.lease_until>clock_timestamp());
 delete from private.daily_provider_base_artifacts a where not exists(select 1 from private.daily_provider_base_heads h where h.artifact_id=a.id)
  and a.created_at<clock_timestamp()-interval'10minutes';
 delete from private.daily_provider_base_jobs j0 where j0.status<>'running'and j0.last_requested_at<clock_timestamp()-interval'1day'
  and not exists(select 1 from private.daily_provider_base_heads h where h.family_digest=j0.family_digest);
 for entry in select value from jsonb_array_elements(p_pending)loop
  identity:=entry->'identity';k:=identity->'key';f:=identity->'family';
  if k is null or f is null or k-'dailyPublications'is distinct from f then continue;end if;
  if not private.daily_provider_base_manifest_matches(k)then states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_obsolete');continue;end if;
  if octet_length(k::text)+octet_length(f::text)+octet_length((entry->'metadata')::text)>=262144 then states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_capacity');continue;end if;
  if exists(select 1 from private.daily_provider_base_heads where family_digest=md5(f::text)and family_key<>f)
   or exists(select 1 from private.daily_provider_base_jobs where digest=md5(k::text)and content_key<>k)
   or exists(select 1 from private.daily_provider_base_artifacts where digest=md5(k::text)and content_key<>k)then
   states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_identity_collision');continue;
  end if;
  -- New current immutable facts supersede queued/failed older work. Preserve
  -- any running lease and every previous complete head/artifact.
  delete from private.daily_provider_base_jobs where family_digest=md5(f::text)and family_key=f and digest<>md5(k::text)and status<>'running';
  select *into j from private.daily_provider_base_jobs where digest=md5(k::text)and content_key=k;
  if j.id is null then
   if not exists(select 1 from private.daily_provider_base_admissions where actor=actor_id and day=current_date and family_digest=md5(f::text))then
    if(select count(*)from private.daily_provider_base_admissions where actor=actor_id and day=current_date)>=200
     or(select count(*)from private.daily_provider_base_admissions where day=current_date)>=4096 then
     states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_admission_limited');continue;
    end if;
    insert into private.daily_provider_base_admissions values(actor_id,current_date,md5(f::text));
   end if;
   select count(*)into n from private.daily_provider_base_jobs;
   if n>=1024 then states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_capacity');continue;end if;
   insert into private.daily_provider_base_jobs(digest,content_key,family_digest,family_key,target,request,dependency,daily_metadata)
    values(md5(k::text),k,md5(f::text),f,entry->'target',entry->'request',entry->>'dependency',entry->'metadata')on conflict(digest)do nothing;
  else
   update private.daily_provider_base_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'1minute';
   update private.daily_provider_base_jobs set status='queued',attempts=0,not_before=clock_timestamp()where id=j.id and status='ready'
    and not exists(select 1 from private.daily_provider_base_artifacts a where a.digest=j.digest and a.content_key=j.content_key);
  end if;
  update private.daily_provider_base_heads set last_requested_at=clock_timestamp()where family_digest=md5(f::text)and family_key=f and last_requested_at<clock_timestamp()-interval'1minute';
 end loop;
 return states;
end;$function$;

create function private.daily_provider_base_claim()returns jsonb
language plpgsql volatile set search_path=''as $function$
declare j private.daily_provider_base_jobs%rowtype;started timestamptz;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.withdraw_prepared_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.daily_provider_base_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 update private.daily_provider_base_jobs set status='failed',lease_until=null,last_error='daily_provider_base_lease_expired',not_before=clock_timestamp()+interval'1minute'
  where status='running'and lease_until<=clock_timestamp();
 select *into j from private.daily_provider_base_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp()
  order by not_before,created_at for update skip locked limit 1;
 if not found then return null;end if;
 if not private.prepared_aggregate_take_turn('prepared')then return null;end if;
 select backend_start into started from pg_stat_activity where pid=pg_backend_pid();
 update private.daily_provider_base_jobs set status='running',attempts=attempts+1,fence=fence+1,run_id=gen_random_uuid(),
  lease_until=clock_timestamp()+interval'120seconds',claim_pid=pg_backend_pid(),claim_backend_start=started where id=j.id returning *into j;
 return jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence);
end;$function$;

create function private.daily_provider_base_run_claimed()returns jsonb
language plpgsql volatile set search_path=''as $function$
declare claim jsonb:=nullif(current_setting('daily_provider_base.claim',true),'')::jsonb;
 j private.daily_provider_base_jobs%rowtype;items jsonb;folded_item jsonb;checked jsonb;aid uuid;size integer;stamp timestamptz;started timestamptz;n integer;b bigint;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if current_setting('statement_timeout')::interval<=interval'0seconds'or current_setting('statement_timeout')::interval>interval'50seconds'then raise exception 'daily_provider_base_deadline_required';end if;
 if current_setting('transaction_isolation')<>'read committed'then raise exception 'daily_provider_base_read_committed_required';end if;
 if claim is null then return jsonb_build_object('status','idle');end if;
 select *into j from private.daily_provider_base_jobs where id=(claim->>'jobId')::uuid;
 select backend_start into started from pg_stat_activity where pid=pg_backend_pid();
 if j.id is null or j.status<>'running'or j.claim_pid is distinct from pg_backend_pid()or j.claim_backend_start is distinct from started
  or j.run_id is distinct from(claim->>'runId')::uuid or j.fence is distinct from(claim->>'fence')::bigint or j.lease_until<=clock_timestamp()
 then return jsonb_build_object('status','obsolete');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then
  update private.daily_provider_base_jobs set status='queued',attempts=greatest(attempts-1,0),lease_until=null,claim_pid=null,claim_backend_start=null,not_before=clock_timestamp()+interval'1second'
   where id=j.id and run_id=j.run_id and fence=j.fence;
  perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('status','busy');
 end if;
 begin
  items:=private.daily_provider_base_current(j.content_key,j.daily_metadata);
  if items is null then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_obsolete'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','obsolete_manifest');
  end if;
  -- This is the only full fold in the new read model. It runs in the existing
  -- bounded worker, not in a user query, with every original validation intact.
  folded_item:=private.dashboard_admin_daily_provider_fold(items,j.request,j.target);
  if folded_item is null then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='fold_incompatible'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','fold_incompatible');
  end if;
  checked:=private.daily_provider_base_current(j.content_key,j.daily_metadata);
  if checked is null then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_obsolete'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','obsolete_manifest');
  end if;
  size:=octet_length(j.content_key::text)+octet_length(j.family_key::text)+octet_length(folded_item::text)+256;
  if size>8388608 then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_oversized'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','capacity');
  end if;
  -- Admission and publication share one short capacity lock. No lock is held
  -- across a source reader or fold; contention discards this attempt safely.
  if not pg_try_advisory_xact_lock(hashtextextended('daily_provider_base_admission_v1',0))then
   update private.daily_provider_base_jobs set status='queued',attempts=greatest(attempts-1,0),lease_until=null,not_before=clock_timestamp()+interval'1second'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('status','busy');
  end if;
  select *into j from private.daily_provider_base_jobs where id=j.id for update;
  if j.status<>'running'or j.run_id is distinct from(claim->>'runId')::uuid or j.fence is distinct from(claim->>'fence')::bigint
   or j.claim_pid is distinct from pg_backend_pid()or j.claim_backend_start is distinct from started or j.lease_until<=clock_timestamp()
  then return jsonb_build_object('status','obsolete');end if;
  select count(*)into n from private.daily_provider_base_heads;
  if n>=512 and not exists(select 1 from private.daily_provider_base_heads where family_digest=j.family_digest and family_key=j.family_key)then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_capacity'where id=j.id;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','capacity');
  end if;
  -- Replace only a fully calculated family head. The old head remains visible
  -- until this transaction commits; no new clocks are attached to its money.
  delete from private.daily_provider_base_artifacts a where not exists(select 1 from private.daily_provider_base_heads h where h.artifact_id=a.id);
  select count(*),coalesce(sum(bytes),0)into n,b from private.daily_provider_base_artifacts;
  if n>=512 or b+size>134217728 then
   -- The current family's previous publication can be retired atomically only
   -- after its replacement has passed all validation, never before a fold.
   size:=octet_length(j.content_key::text)+octet_length(j.family_key::text)+octet_length(folded_item::text)+256;
   if b+size-coalesce((select a0.bytes from private.daily_provider_base_heads h join private.daily_provider_base_artifacts a0 on a0.id=h.artifact_id where h.family_digest=j.family_digest and h.family_key=j.family_key),0)>134217728
    or (n+1-(case when exists(select 1 from private.daily_provider_base_heads where family_digest=j.family_digest and family_key=j.family_key)then 1 else 0 end))>512 then
    update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_capacity'where id=j.id;
    perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','capacity');
   end if;
  end if;
  insert into private.daily_provider_base_artifacts(digest,content_key,family_digest,family_key,item,item_digest,bytes)
   values(j.digest,j.content_key,j.family_digest,j.family_key,folded_item,md5(folded_item::text),size)on conflict(digest)do nothing;
  select id into aid from private.daily_provider_base_artifacts where digest=j.digest and content_key=j.content_key and item_digest=md5(folded_item::text);
  if aid is null then raise exception 'daily_provider_base_content_collision';end if;
  insert into private.daily_provider_base_heads(family_digest,family_key,artifact_id)values(j.family_digest,j.family_key,aid)
   on conflict(family_digest)do update set artifact_id=excluded.artifact_id,last_requested_at=clock_timestamp()where daily_provider_base_heads.family_key=excluded.family_key;
  delete from private.daily_provider_base_artifacts a where not exists(select 1 from private.daily_provider_base_heads h where h.artifact_id=a.id);
  update private.daily_provider_base_jobs set status='ready',attempts=0,lease_until=null,last_error=null where id=j.id;
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
  update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='fold_incompatible'where id=j.id and run_id=j.run_id and fence=j.fence;
  perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','fold_incompatible');
 end;
 perform set_config('daily_provider_base.claim','',false);
 return jsonb_build_object('published',true,'id',aid);
end;$function$;

-- Explicit owner-only warming of at most three approved native windows. It
-- reads already prepared heads and enqueues derived work only; no source/day
-- admission, authenticated RPC, raw kernel, fabricated JWT or new cron.
create function private.daily_provider_base_prewarm(p_requests jsonb)returns jsonb
language plpgsql volatile set search_path=''as $function$
declare q jsonb;t jsonb;dep text;tz text;la timestamp;lb timestamp;d date;dq jsonb;baseq jsonb;k jsonb;
 j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;
 metadata jsonb;pending jsonb:='[]';identity jsonb;pub jsonb;valid boolean;n integer:=0;states jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if current_setting('statement_timeout')::interval<=interval'0seconds'or current_setting('statement_timeout')::interval>interval'3seconds'then raise exception 'daily_provider_base_claim_deadline_required';end if;
 if jsonb_typeof(p_requests)is distinct from'array'or jsonb_array_length(p_requests)not between 1 and 3 or octet_length(p_requests::text)>1048576 then raise exception 'daily_provider_base_prewarm_invalid';end if;
 for q in select value from jsonb_array_elements(p_requests)loop
  select to_jsonb(p)into t from private.prepared_aggregate_native_catalog()p join private.provider_snapshot_targets st on st.platform_id=p.id and st.enabled and st.target=to_jsonb(p)where p.id::text=q->>'platformId';
  if t is null then continue;end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')or q->>'view'is distinct from'providers'
   or q->>'successBasis'is distinct from'success'or coalesce(q->>'status','all')<>'all'
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or(q->>'startAt')::timestamptz is distinct from(q->>'successStartAt')::timestamptz or(q->>'endAt')::timestamptz is distinct from(q->>'successEndAt')::timestamptz
   or(q->>'endAt')::timestamptz>clock_timestamp()then continue;end if;
  tz:=t->>'timezone';la:=(q->>'startAt')::timestamptz at time zone tz;lb:=(q->>'endAt')::timestamptz at time zone tz;
  if la<>date_trunc('day',la)or lb<>date_trunc('day',lb)or lb::date-la::date not between 2 and 31 then continue;end if;
  dep:=private.prepared_aggregate_dependency(t,private.prepared_aggregate_dependency_common(t->>'scope_group'));metadata:='[]';valid:=true;
  for d in select generate_series(la::date,lb::date-1,interval'1day')::date loop
   dq:=(q-array['providers','amountBands'])||jsonb_build_object('direction','all',
    'startAt',to_char(d::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char((d+1)::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successStartAt',to_char(d::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successEndAt',to_char((d+1)::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
   baseq:=private.prepared_aggregate_base_request(dq,t);k:=private.prepared_aggregate_key(baseq,t);
   select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
   if a.id is null or j.target is distinct from t or j.dependency is distinct from dep or a.dependency is distinct from dep or a.revision is distinct from j.revision
    or a.cutoff<(dq->>'endAt')::timestamptz or a.cutoff is null or a.computed_at is null or a.expires_at<=a.computed_at or a.source_complete is null then valid:=false;exit;end if;
   pub:=jsonb_build_object('id',a.id,'generation',a.revision::text||':'||a.fence::text,'computedAt',a.computed_at,'expiresAt',a.expires_at,'cutoff',a.cutoff,
    'calculationComplete',true,'sourceComplete',a.source_complete,'freshness',case when a.expires_at>transaction_timestamp()then'fresh'else'refresh_due'end,
    'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end);
   metadata:=metadata||jsonb_build_array(jsonb_build_object('request',dq,'publication',pub));
  end loop;
  if not valid then continue;end if;
  identity:=private.daily_provider_base_identity(metadata,q,t,dep);
  pending:=pending||jsonb_build_array(jsonb_build_object('identity',identity,'target',t,'request',identity->'base','dependency',dep,'metadata',metadata));n:=n+1;
 end loop;
 states:=private.daily_provider_base_enqueue(pending);
 return jsonb_build_object('eligibleWindows',n,'limitedWindows',(select count(*)from jsonb_object_keys(states)));
end;$function$;


CREATE OR REPLACE FUNCTION private.withdraw_prepared_prepare_claim(p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE family text;c jsonb;base_turn boolean;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_claim_deadline_required';END IF;
 PERFORM set_config('daily_provider_base.claim','',false);
 PERFORM set_config('withdraw_prepared.claim','',false);PERFORM set_config('withdraw_prepared.family','',false);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 SELECT next_base INTO base_turn FROM private.daily_provider_base_scheduler WHERE singleton FOR UPDATE;
 IF base_turn AND EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()AND priority>=20)THEN
  c:=private.daily_provider_base_claim();
  IF c IS NOT NULL THEN
   PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);
   UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;RETURN c;
  END IF;
 END IF;
 SELECT next_family INTO family FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled FOR UPDATE;
 IF NOT FOUND THEN family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);IF c IS NOT NULL THEN PERFORM set_config('withdraw_prepared.family','payment',false);UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;ELSE c:=private.daily_provider_base_claim();IF c IS NOT NULL THEN PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;END IF;RETURN c;END IF;
 IF family='withdraw'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())THEN
  c:=private.withdraw_prepared_claim();
 ELSE family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);END IF;
 IF c IS NULL AND family='payment'THEN family:='withdraw';c:=private.withdraw_prepared_claim();END IF;
 IF c IS NOT NULL THEN
  PERFORM set_config('withdraw_prepared.family',family,false);IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
  UPDATE private.withdraw_prepared_scheduler SET next_family=CASE family WHEN'withdraw'THEN'payment'ELSE'withdraw'END WHERE singleton;
  UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;
 END IF;
 IF c IS NULL THEN
  c:=private.daily_provider_base_claim();
  IF c IS NOT NULL THEN PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;
 END IF;RETURN c;
END;$function$
;

CREATE OR REPLACE FUNCTION private.withdraw_prepared_run_dispatch(p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('withdraw_prepared.family',true)='base'THEN RETURN private.daily_provider_base_run_claimed();END IF;
 IF current_setting('withdraw_prepared.family',true)='withdraw'THEN RETURN private.withdraw_prepared_run_claimed();END IF;
 IF current_setting('withdraw_prepared.family',true)='payment'THEN RETURN private.prepared_aggregate_run_claimed(p_worker);END IF;
 RETURN jsonb_build_object('status','idle');
END;$function$
;

CREATE OR REPLACE FUNCTION private.withdraw_prepared_provider_gate()
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE t private.prepared_aggregate_worker_turn%rowtype;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN false;END IF;
 -- Caller has selected a provider job and holds provider_snapshot_claim_v1.
 SELECT *INTO t FROM private.prepared_aggregate_worker_turn WHERE singleton FOR UPDATE;
 IF t.next_kind='prepared'AND(EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())OR EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()))
  AND(t.waiting_since IS NULL OR t.waiting_since>clock_timestamp()-interval'3seconds')THEN
  UPDATE private.prepared_aggregate_worker_turn SET waiting_since=coalesce(waiting_since,clock_timestamp())WHERE singleton;RETURN false;
 END IF;
 RETURN true;
END;$function$
;

do $acl$ declare r record;begin for r in select oid from pg_proc where pronamespace='private'::regnamespace and proname like'daily_provider_base_%' loop execute'revoke all on function '||r.oid::regprocedure||' from public,anon,authenticated,service_role';end loop;end;$acl$;

-- END async prepared base read model.
do $verify$begin
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='3db6a5b8f8b3f104a08a2ed23c458df4'and md5(pg_get_functiondef(p.oid))='1c13d7415eba1a5bbb38bdbc166ed2d2'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='e032c2062fc64bb81481593df061a9e9'and md5(pg_get_functiondef(p.oid))='3114e3bb4274b891c45edc7212e78c06'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='125afac728629ef0323c22887eb16b88'and md5(pg_get_functiondef(p.oid))='85ed3075a6bb501686cd01e960fbf5e7'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='4e28cfb2d1690ce1b8f11daedb248c99'and md5(pg_get_functiondef(p.oid))='83c12cd4df61b8cfe69a8466d834ef9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure and md5(prosrc)='174aa423474363e135adeefa80530740'and md5(pg_get_functiondef(p.oid))='664f6398837318c8e178983b83d55b1a'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_run_dispatch(text)'::regprocedure and md5(prosrc)='6a4b1983ada38ae912c37f67720bb09c'and md5(pg_get_functiondef(p.oid))='613dfb11a3ca89c9ae35dfaa7e2ea5fe'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_provider_gate()'::regprocedure and md5(prosrc)='ce8dd3bf6d00394ec6f66c5b312461ba'and md5(pg_get_functiondef(p.oid))='08689f2282ced4611d88802d595e29cb'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)'::regprocedure and md5(prosrc)='480ca3b477bda870fd4b35606429216f'and md5(pg_get_functiondef(p.oid))='0f925406c76f576e05d6e921a16b2186'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_manifest_matches(jsonb)'::regprocedure and md5(prosrc)='7b28ca322f500d36fcf3195b51b94f27'and md5(pg_get_functiondef(p.oid))='2954df9d970eaf0db6c7424ca8017d56'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_current(jsonb,jsonb)'::regprocedure and md5(prosrc)='b90f4e12c10f6eff54cc74f713b42d6d'and md5(pg_get_functiondef(p.oid))='3085c2eef73f7cf5aae356a129fca821'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)'::regprocedure and md5(prosrc)='823d756a9df2d4a8e2bcce7e6cfffe55'and md5(pg_get_functiondef(p.oid))='c68306dbb0eca5e44d421557f2ea9d10'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_enqueue(jsonb)'::regprocedure and md5(prosrc)='889c093d1ab76aa388d23b0f57a4cbf5'and md5(pg_get_functiondef(p.oid))='6dac86d72c0f8c823ac6cff95a6072a7'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_claim()'::regprocedure and md5(prosrc)='f3b25be0e0bc27cf3dc921aeede543aa'and md5(pg_get_functiondef(p.oid))='4472b2026c37879acca0ea70dda072c4'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_run_claimed()'::regprocedure and md5(prosrc)='526e5ed10164effd493031c34ce32064'and md5(pg_get_functiondef(p.oid))='5866b70c2deea1f6d620243314d678b8'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_prewarm(jsonb)'::regprocedure and md5(prosrc)='a47e0e34ee7530d2dc8fc63b3461fc9e'and md5(pg_get_functiondef(p.oid))='739d3ef7c8acbea783bf5e1e1441f5d4'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_jobs'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_artifacts'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_heads'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_scheduler'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_admissions'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if(select value from pg_temp.daily_base_async_guard where key='entries')is distinct from(select jsonb_agg(jsonb_build_array(p.oid,case when p.oid in('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.withdraw_prepared_run_dispatch(text)'::regprocedure,'private.withdraw_prepared_provider_gate()'::regprocedure)then to_jsonb(p)-'prosrc'else to_jsonb(p)end)order by p.oid)from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.withdraw_prepared_run_dispatch(text)'::regprocedure,'private.withdraw_prepared_provider_gate()'::regprocedure))then raise exception'daily_base_async_metadata_changed';end if;
 if(select value from pg_temp.daily_base_async_guard where key='financial')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception'daily_base_async_financial_changed';end if;
 if(select value from pg_temp.daily_base_async_guard where key='snapshot')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception'daily_base_async_snapshot_changed';end if;
 if(select value from pg_temp.daily_base_async_guard where key='cron40')is distinct from(select to_jsonb(c)from cron.job c where jobid=40)then raise exception'daily_base_async_cron_changed';end if;
end;$verify$;
commit;
