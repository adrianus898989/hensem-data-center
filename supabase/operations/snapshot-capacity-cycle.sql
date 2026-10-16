-- Legacy full-day provider cache lifecycle; exact custom ranges use aggregatePrepared.
-- Apply only after storage-maintenance.sql. No business source reads or writes.
begin;
set local statement_timeout='5s';
set local lock_timeout='500ms';
do $guard$
declare e record;begin
 if current_user<>'postgres'then raise exception 'snapshot_cycle_denied';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))
 or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))
 or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then raise exception 'snapshot_cycle_busy';end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then raise exception 'snapshot_cycle_active_lease';end if;
 for e in select *from(values
 ('private.dashboard_admin_live_provider_snapshot(jsonb)','db3cb50f56d94e9a1930ac321b160a91',true),
 ('private.provider_snapshot_persist_storage_class()','54d515cde45c478c59dde6669fbe8c5c',false),
 ('private.provider_snapshot_archive_closed_storage(integer)','32ba6aee7d8473b7439862d29eec3a3a',false),
 ('private.provider_snapshot_retire_intraday(uuid)','1981546b68bf4fca5388a929cdcce94e',false)
 )v(sig,hash,definer)loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(e.sig)and md5(prosrc)=e.hash
   and pg_get_userbyid(proowner)='postgres'and prosecdef=e.definer and proconfig=array['search_path=""']
   and proacl::text=case when e.definer then'{postgres=X/postgres,authenticated=X/postgres}'else'{postgres=X/postgres}'end)then raise exception 'snapshot_cycle_baseline_drift: %',e.sig;end if;
 end loop;
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
end;$guard$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_snapshot(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_access jsonb:=private.dashboard_role_access();
 v_ids uuid[];v_components text[];v_catalog jsonb;v_entry jsonb;v_target jsonb;v_dep text;
 v_from timestamp;v_to timestamp;v_start timestamptz;v_max timestamptz;v_previous_start timestamptz;v_previous_end timestamptz;
 v_cut timestamptz;v_lookup_cut timestamptz;v_candidate timestamptz;v_fallback timestamptz;v_count integer;v_expected integer;v_export boolean:=false;
 v_all boolean:=true;v_stale boolean:=false;v_building boolean:=false;v_platforms jsonb:='[]';v_missing jsonb:='[]';v_snapshots jsonb;
 v_current jsonb;v_previous jsonb;v_component text;v_period text;v_j record;v_payload jsonb;v_state text;
 v_first timestamptz;v_next timestamptz;v_payload_from timestamptz;v_payload_to timestamptz;
 v_kernel_current boolean;v_context jsonb;v_need text[]:=array['providers.view','providers.query'];
begin
 if jsonb_typeof(p_request)is distinct from'object'or octet_length(p_request::text)>16384
  or p_request-array['version','platformIds','startAt','endAt','direction','status','currency','components','export']<>'{}'::jsonb
  or p_request->'version'is distinct from'1'::jsonb
  or jsonb_typeof(p_request->'platformIds')is distinct from'array'
  or jsonb_array_length(p_request->'platformIds')not between 1 and 50
  or exists(select 1 from jsonb_array_elements(p_request->'platformIds')x where jsonb_typeof(x)is distinct from'string'or x#>>'{}'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
 then raise exception using errcode='22023',message='invalid_snapshot_request';end if;
 if p_request?'export'then if jsonb_typeof(p_request->'export')is distinct from'boolean'then raise exception using errcode='22023',message='invalid_snapshot_request';end if;v_export:=(p_request->>'export')::boolean;end if;
 if v_export then v_need:=array_append(v_need,'providers.export');end if;
 if coalesce(v_access->>'canView','false')<>'true'or not coalesce(v_access->>'mode'in('owner','legacy')or v_access->>'mode'='assigned'and(v_access->'permissions')?&v_need,false)then raise exception using errcode='42501',message='role_permission_denied';end if;
 if v_access->>'mode'='assigned'then
  v_context:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb;
  if not private.dashboard_role_context_valid()or v_context#>>'{payload,page}'is distinct from'providers'
   or v_context#>>'{payload,rpc}'is distinct from'dashboard_admin_live_provider_snapshot'
   or v_context#>>'{payload,action}'is distinct from'providerSnapshot'then raise exception using errcode='42501',message='role_gateway_required';end if;
 end if;
 select array_agg(x::uuid order by x::uuid)into v_ids from jsonb_array_elements_text(p_request->'platformIds')x;
 if cardinality(v_ids)<>(select count(distinct x)from unnest(v_ids)x)then raise exception using errcode='22023',message='invalid_snapshot_request';end if;
 v_kernel_current:=private.provider_snapshot_kernel_contract_current();
 -- Exact native identity comes from today's authorized catalog, never client display names.
 select coalesce(jsonb_agg(jsonb_build_object('target',to_jsonb(p),'dependency',private.provider_snapshot_dependency_token(to_jsonb(p)))order by p.id),'[]')into v_catalog
 from private.dashboard_admin_live_platforms()p where p.id=any(v_ids);
 if jsonb_array_length(v_catalog)<>cardinality(v_ids)then raise exception using errcode='42501',message='platform_denied';end if;
 if p_request->>'direction'is distinct from'charge'or p_request->>'status'is distinct from'all'or p_request->>'currency'is distinct from'INR'
  or exists(select 1 from jsonb_array_elements(v_catalog)x where not coalesce(x#>>'{target,source}'in('ar','newar','kb')and x#>>'{target,scope_group}'='IN'
   and x#>>'{target,currency}'='INR'and x#>>'{target,timezone}'in('Asia/Kolkata','Asia/Calcutta'),false))then
  return jsonb_build_object('version',1,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
 end if;
 if exists(select 1 from jsonb_array_elements(v_catalog)x where not private.provider_snapshot_target_current(private.provider_snapshot_target(x->'target')))then
  return jsonb_build_object('version',1,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
 end if;
 if jsonb_typeof(p_request->'startAt')is distinct from'string'or jsonb_typeof(p_request->'endAt')is distinct from'string'
  or p_request->>'startAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'or p_request->>'endAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'
 then raise exception using errcode='22023',message='invalid_snapshot_window';end if;
 v_from:=(p_request->>'startAt')::timestamp;v_to:=(p_request->>'endAt')::timestamp;
 if to_char(v_from,'YYYY-MM-DD"T"HH24:MI:SS')<>p_request->>'startAt'or to_char(v_to,'YYYY-MM-DD"T"HH24:MI:SS')<>p_request->>'endAt'or v_to<v_from then raise exception using errcode='22023',message='invalid_snapshot_window';end if;
 if v_from::date<>v_to::date or v_from::time<>time'00:00:00' or v_to::time<>time'23:59:59' or v_from::date>(statement_timestamp()at time zone'Asia/Kolkata')::date then return jsonb_build_object('version',1,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));end if;
 if jsonb_typeof(p_request->'components')is distinct from'array'or jsonb_array_length(p_request->'components')not between 1 and 3
  or exists(select 1 from jsonb_array_elements(p_request->'components')x where jsonb_typeof(x)is distinct from'string'or x#>>'{}'not in('orders','submission','intake'))then raise exception using errcode='22023',message='invalid_snapshot_components';end if;
 select array_agg(x order by x)into v_components from jsonb_array_elements_text(p_request->'components')x;
 if cardinality(v_components)<>(select count(distinct x)from unnest(v_components)x)then raise exception using errcode='22023',message='invalid_snapshot_components';end if;
 if v_components<>array['intake','orders','submission']::text[]then return jsonb_build_object('version',1,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));end if;
 v_start:=v_from at time zone'Asia/Kolkata';v_max:=least((v_to+interval'1second')at time zone'Asia/Kolkata',statement_timestamp());v_previous_start:=(v_from-interval'1day')at time zone'Asia/Kolkata';
 v_expected:=cardinality(v_ids)*(cardinality(v_components)+(select count(*)from unnest(v_components)c where c<>'submission'));
 -- Find the full published intersection without a fixed candidate limit. Incomplete
 -- newer cutoffs can never evict the last fully published common generation.
 with eligible as materialized(
  select j.*,a.revision artifact_revision,a.dependency_token artifact_dependency,c->>'dependency'current_dependency
  from private.provider_snapshot_jobs j join private.provider_snapshot_heads h on h.job_id=j.id
  join private.provider_snapshot_artifacts a on a.id=h.snapshot_id cross join jsonb_array_elements(v_catalog)c
  where j.target=private.provider_snapshot_target(c->'target')and j.component=any(v_components)
   and j.platform_id=any(v_ids)
   and(v_from::date=(statement_timestamp()at time zone'Asia/Kolkata')::date
    or j.window_to=case when j.window_from=v_start then v_max else v_max-interval'1day'end)
   and(j.window_from=v_start and j.window_to<=v_max
    or j.component<>'submission'and j.window_from=v_previous_start
     and j.window_to<=((v_max at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata')
 ),slots as(
  select window_to cutoff,artifact_dependency=current_dependency and status='ready'and artifact_revision=revision valid from eligible where window_from=v_start and window_to<=v_max
  union all
  select ((window_to at time zone'Asia/Kolkata')+interval'1day')at time zone'Asia/Kolkata',artifact_dependency=current_dependency and status='ready'and artifact_revision=revision
  from eligible where component<>'submission'and window_from=v_previous_start
   and ((window_to at time zone'Asia/Kolkata')+interval'1day')at time zone'Asia/Kolkata'<=v_max
 )select max(cutoff)into v_cut from(select cutoff from slots group by cutoff having count(*)=v_expected and bool_and(valid))q;
 if v_cut is null then
  select max(j.window_to)into v_cut from private.provider_snapshot_jobs j join private.provider_snapshot_heads h on h.job_id=j.id
   cross join jsonb_array_elements(v_catalog)c where j.target=private.provider_snapshot_target(c->'target')
    and j.window_from=v_start and j.window_to<=v_max and j.component=any(v_components)
    and(v_from::date=(statement_timestamp()at time zone'Asia/Kolkata')::date or j.window_to=v_max);
  v_all:=false;
 end if;
 v_lookup_cut:=v_cut;
 if v_lookup_cut is null then
  -- No published head yet: expose a queued/running generation as building without
  -- calling its cutoff published or inventing zero payloads.
  select max(j.window_to)into v_lookup_cut from private.provider_snapshot_jobs j cross join jsonb_array_elements(v_catalog)c
   where j.target=private.provider_snapshot_target(c->'target')and j.window_from=v_start and j.window_to<=v_max and j.component=any(v_components)
    and(v_from::date=(statement_timestamp()at time zone'Asia/Kolkata')::date or j.window_to=v_max);
 end if;
 if v_lookup_cut is not null then v_previous_end:=((v_lookup_cut at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata';end if;
 for v_entry in select value from jsonb_array_elements(v_catalog)loop
  v_target:=private.provider_snapshot_target(v_entry->'target');v_dep:=v_entry->>'dependency';v_current:='{}';v_previous:='{}';v_snapshots:='[]';
  foreach v_period in array array['current','previous']loop
   v_payload_from:=case when v_period='current'then v_start else v_previous_start end;v_payload_to:=case when v_period='current'then v_lookup_cut else v_previous_end end;
   foreach v_component in array v_components loop
    if v_period='previous'and v_component='submission'then continue;end if;
    select j.status,j.last_error_code,j.revision job_revision,a.revision artifact_revision,a.next_due_at,a.id snapshot_id,a.payload,a.provenance,a.computed_at,a.dependency_token into v_j
     from private.provider_snapshot_jobs j left join private.provider_snapshot_heads h on h.job_id=j.id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
     where j.target=v_target and j.component=v_component and j.window_from=v_payload_from and j.window_to=v_payload_to;
    v_payload:=null;v_state:='missing';
    if found then
     if v_j.snapshot_id is not null then
      v_payload:=v_j.payload;v_state:=case when v_j.status in('queued','running')then'building'when v_j.status='failed'then'failed'
       when v_j.status is distinct from'ready'or v_j.artifact_revision is distinct from v_j.job_revision or not v_kernel_current or v_j.dependency_token is distinct from v_dep or v_j.next_due_at<=statement_timestamp()
       or v_period='current'and v_from::date=(statement_timestamp()at time zone'Asia/Kolkata')::date and v_lookup_cut<statement_timestamp()-interval'30minutes'
       then'stale'else'ready'end;
      if v_state='stale'then v_stale:=true;end if;
      if v_first is null or v_j.computed_at<v_first then v_first:=v_j.computed_at;end if;
      if v_j.next_due_at is not null and(v_next is null or v_j.next_due_at<v_next)then v_next:=v_j.next_due_at;end if;
      v_snapshots:=v_snapshots||jsonb_build_array(jsonb_build_object('snapshotId',v_j.snapshot_id,'component',v_component,'period',v_period,
       'computedAt',private.provider_snapshot_iso(v_j.computed_at),'sourceReadStartedAt',v_j.provenance->>'sourceReadStartedAt','sourceReadCompletedAt',v_j.provenance->>'sourceReadCompletedAt',
       'upstreamComplete',v_j.provenance->'upstreamComplete','stale',v_state='stale','nextDueAt',private.provider_snapshot_iso(v_j.next_due_at)));
     else v_state:=case when v_j.status in('queued','running')then'building'when v_j.status='failed'then'failed'else'missing'end;end if;
    end if;
    if v_state='building'then v_building:=true;end if;
    if v_state<>'ready'then v_all:=false;v_missing:=v_missing||jsonb_build_array(jsonb_build_object('platformId',v_target->>'id','component',v_component,'period',v_period,'state',v_state,'errorCode',case when v_state='failed'then v_j.last_error_code end));end if;
    if v_period='current'then v_current:=v_current||jsonb_build_object(v_component,v_payload);else v_previous:=v_previous||jsonb_build_object(v_component,v_payload);end if;
   end loop;
  end loop;
  v_platforms:=v_platforms||jsonb_build_array(jsonb_build_object('platform',(v_target-array['scope_group','source_name'])||jsonb_build_object('scopeGroup',v_target->'scope_group','sourceName',v_target->'source_name'),'current',v_current,'previous',v_previous,'snapshots',v_snapshots));
 end loop;
 return jsonb_build_object('version',1,'mode','published_snapshot','status',case when v_all then'ready'when v_stale then'stale'when v_building then'building'else'missing'end,'complete',v_all,
 'requested',jsonb_build_object('startAt',p_request->'startAt','endAt',p_request->'endAt'),
 'publishedCutoff',private.provider_snapshot_iso(v_cut),'cutoffEpochMs',case when v_cut is not null then floor(extract(epoch from v_cut)*1000)::bigint end,
 'window',case when v_cut is not null then jsonb_build_object('timezone','Asia/Kolkata','startAt',private.provider_snapshot_iso(v_start),'endAt',private.provider_snapshot_iso(v_cut),'previousStartAt',private.provider_snapshot_iso(v_previous_start),'previousEndAt',private.provider_snapshot_iso(v_previous_end),
  'localStartAt',to_char(v_from,'YYYY-MM-DD"T"HH24:MI:SS'),'localCutoff',to_char(v_cut at time zone'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS'),
  'previousLocalStartAt',to_char(v_from-interval'1day','YYYY-MM-DD"T"HH24:MI:SS'),'previousLocalCutoff',to_char(v_previous_end at time zone'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS'))end,
 'platforms',v_platforms,'missing',v_missing,'computedAt',private.provider_snapshot_iso(v_first),'nextDueAt',private.provider_snapshot_iso(v_next),
 'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
end;$function$;
create or replace function private.provider_snapshot_persist_storage_class()returns trigger language plpgsql security invoker set search_path=''as $fn$
begin
 if tg_op='INSERT'then
  if new.storage_class is not null and new.storage_class<>private.provider_snapshot_storage_class(new.target,new.window_from,new.window_to)then raise exception 'snapshot_storage_insert_class';end if;
  new.storage_class:=private.provider_snapshot_storage_class(new.target,new.window_from,new.window_to);
 elsif new.storage_class is distinct from old.storage_class then
  if current_user<>'postgres'or current_setting('app.snapshot_storage_move',true)is distinct from pg_current_xact_id()::text
   or old.storage_class<>'hot'or new.storage_class<>'history'
   or old.status='running'or old.lease_until>clock_timestamp()
   or old.status<>'ready'or old.window_to>statement_timestamp()-interval'1hour'
   or exists(select 1 from private.provider_snapshot_cohort_jobs m join private.provider_snapshot_cohorts c on c.id=m.cohort_id
    where m.job_id=old.id and(c.status='building'or c.cutoff>statement_timestamp()-interval'1hour'))
  then raise exception 'snapshot_storage_move_denied';end if;
 end if;
 return new;
end;$fn$;
create or replace function private.provider_snapshot_archive_closed_storage(p_limit integer default 100)returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
declare ids uuid[];n integer;budget interval;
begin
 if current_user<>'postgres'then raise exception 'snapshot_storage_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_limit is null or p_limit not between 1 and 100 or budget<=interval'0'or budget>interval'5seconds'then raise exception 'snapshot_storage_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return jsonb_build_object('status','busy');end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return jsonb_build_object('status','busy');end if;
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
 perform 1 from private.provider_snapshot_storage_usage order by storage_class for update;
 select array_agg(id order by id)into ids from(select q.id from private.provider_snapshot_jobs q where q.storage_class='hot'and q.status='ready'
  and(q.lease_until is null or q.lease_until<=clock_timestamp())
  and q.window_to<=statement_timestamp()-interval'1hour'
  and not exists(select 1 from private.provider_snapshot_cohort_jobs m join private.provider_snapshot_cohorts c on c.id=m.cohort_id where m.job_id=q.id and(c.status='building'or c.cutoff>statement_timestamp()-interval'1hour'))
  order by q.window_to,q.id for update of q skip locked limit p_limit)s;
 perform set_config('app.snapshot_storage_move',pg_current_xact_id()::text,true);
 update private.provider_snapshot_jobs set storage_class='history'where id=any(ids);
 get diagnostics n=row_count;
 perform set_config('app.snapshot_storage_move','',true);
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
 return jsonb_build_object('status','archived_storage','jobs',n);
end;$fn$;
-- Included atomically by snapshot-capacity-cycle.sql; not standalone.
-- This proof deliberately does not upgrade expiry to freshness. Expired full-day
-- artifacts remain stale in the reader, but older partial windows are no longer
-- part of its supported historical contract and cannot replace a full day.
create function private.provider_snapshot_closed_replacement(p_id uuid)
returns boolean language sql stable security invoker set search_path=''as $proof$
 with c as materialized(select *from private.provider_snapshot_cohorts where id=p_id and status='ready'
  and jsonb_array_length(targets)=18 and local_date<(statement_timestamp()at time zone'Asia/Kolkata')::date
  and cutoff=(local_date+1)::timestamp at time zone'Asia/Kolkata'),
 t as materialized(select x.value target,private.provider_snapshot_dependency_token(x.value)dependency from c cross join lateral jsonb_array_elements(c.targets)x),
 expected as(
  select c.id,t.target,t.dependency,v.component,
   ((c.local_date-case when v.prior then 1 else 0 end)::timestamp at time zone'Asia/Kolkata')window_from,
   ((c.local_date+case when v.prior then 0 else 1 end)::timestamp at time zone'Asia/Kolkata')window_to
  from c cross join t cross join(values('orders',false),('orders',true),('intake',false),('intake',true),('submission',false))v(component,prior)
 ),checked as(
  select e.*,j.id job_id,j.status,j.revision,j.dependency_token job_dependency,a.id artifact_id,a.revision artifact_revision,a.dependency_token artifact_dependency,a.provenance
  from expected e left join private.provider_snapshot_jobs j on j.target=e.target and j.component=e.component and j.window_from=e.window_from and j.window_to=e.window_to
  left join private.provider_snapshot_cohort_jobs cj on cj.cohort_id=e.id and cj.job_id=j.id
  left join private.provider_snapshot_heads h on h.job_id=cj.job_id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id and a.job_id=j.id
 )select exists(select 1 from c)and private.provider_snapshot_kernel_contract_current()
 and not exists(select 1 from t where not private.provider_snapshot_target_current(target))
 and(select count(distinct target)from t)=18
 and(select count(*)from private.provider_snapshot_cohort_jobs where cohort_id=p_id)=90
 and(select count(*)from checked)=90
 and not exists(select 1 from checked where job_id is null or artifact_id is null or status<>'ready'
  or artifact_revision<>revision or artifact_dependency<>dependency or job_dependency<>dependency
  or provenance->'computationComplete'is distinct from'true'::jsonb);
$proof$;
revoke all on function private.provider_snapshot_closed_replacement(uuid)from public,anon,authenticated,service_role;

-- Replace the old wider-cutoff rule instead of leaving a second unsafe entry.
create or replace function private.provider_snapshot_retire_intraday(p_cohort_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path=''as $retire$
declare c private.provider_snapshot_cohorts%rowtype;replacement uuid;members uuid[];removable uuid[];n integer;h integer;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='snapshot_retention_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))
  or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))
  or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return jsonb_build_object('status','busy');end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return jsonb_build_object('status','busy');end if;
 -- Retention must stop if a later release broadens the supported reader windows.
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure
  and md5(prosrc)='d9eab72829992b0ee59e75e9845f0681')then raise exception 'snapshot_retention_reader_contract_changed';end if;
 select *into c from private.provider_snapshot_cohorts where id=p_cohort_id for update nowait;
 if not found then return jsonb_build_object('status','missing');end if;
 if exists(select 1 from private.provider_snapshot_retired_cohorts where cohort_id=c.id)then return jsonb_build_object('status','already_retired');end if;
 if c.lane<>'current'or c.status not in('ready','failed','obsolete')or c.cutoff>=(c.local_date+1)::timestamp at time zone'Asia/Kolkata'
  or c.local_date>=(statement_timestamp()at time zone'Asia/Kolkata')::date-1
  or c.updated_at>clock_timestamp()-interval'1hour'or jsonb_array_length(c.targets)<>18 then return jsonb_build_object('status','protected');end if;
 select id into replacement from private.provider_snapshot_cohorts n where n.local_date=c.local_date and n.roster_token=c.roster_token and n.targets=c.targets
  and n.cutoff=(n.local_date+1)::timestamp at time zone'Asia/Kolkata'and n.status='ready'order by n.supplement_pass desc,n.updated_at desc,n.id limit 1;
 if replacement is null or not private.provider_snapshot_closed_replacement(replacement)then return jsonb_build_object('status','no_complete_replacement');end if;
 select array_agg(job_id order by job_id)into members from private.provider_snapshot_cohort_jobs where cohort_id=c.id;
 -- Archived no-head failures may already have left this cohort. Every remaining
-- member must still be one of its original exact slots; membership never expands.
 if coalesce(cardinality(members),0)not between 1 and 90 then return jsonb_build_object('status','protected');end if;
 if exists(select 1 from private.provider_snapshot_jobs j where j.id=any(members)and(
  not c.targets@>jsonb_build_array(j.target)or not(
   j.window_from=c.local_date::timestamp at time zone'Asia/Kolkata'and j.window_to=c.cutoff
   or j.component<>'submission'and j.window_from=(c.local_date-1)::timestamp at time zone'Asia/Kolkata'
    and j.window_to=((c.cutoff at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata'
  )))then return jsonb_build_object('status','invalid_cohort_membership');end if;
 perform 1 from private.provider_snapshot_jobs where id=any(members)order by id for update nowait;
 if exists(select 1 from private.provider_snapshot_jobs where id=any(members)and(status in('queued','running','failed')))then return jsonb_build_object('status','active_jobs_protected');end if;
 delete from private.provider_snapshot_cohort_jobs where cohort_id=c.id;
 update private.provider_snapshot_cohorts set status='obsolete',updated_at=clock_timestamp()where id=c.id;
 select array_agg(j.id order by j.id)into removable from private.provider_snapshot_jobs j where j.id=any(members)
  and not exists(select 1 from private.provider_snapshot_cohort_jobs x where x.job_id=j.id)
  and j.window_to<((j.window_from at time zone'Asia/Kolkata')::date+1)::timestamp at time zone'Asia/Kolkata';
 insert into private.provider_snapshot_retired_jobs(job_id,cohort_id)select x,c.id from unnest(removable)x on conflict do nothing;
 get diagnostics n=row_count;
 delete from private.provider_snapshot_heads where job_id=any(removable);get diagnostics h=row_count;
 insert into private.provider_snapshot_retired_cohorts(cohort_id,replacement_cohort_id,retired_jobs,retired_heads)values(c.id,replacement,n,h);
 return jsonb_build_object('status','retired','replacementCohortId',replacement,'jobs',n,'heads',h);
end;$retire$;
revoke all on function private.provider_snapshot_retire_intraday(uuid)from public,anon,authenticated,service_role;

-- Bounded cursor prevents a drifted or partially archived cohort from starving
-- another complete day. Its only state is the last attempted metadata key.
create table private.provider_snapshot_retirement_cursor(
 singleton boolean primary key default true check(singleton),
 local_date date not null,cutoff timestamptz not null,cohort_id uuid not null
);
alter table private.provider_snapshot_retirement_cursor enable row level security;
revoke all on private.provider_snapshot_retirement_cursor from public,anon,authenticated,service_role;
create function private.provider_snapshot_retire_closed_cycle()
returns jsonb language plpgsql volatile security invoker set search_path=''as $cycle$
declare c record;v_cursor private.provider_snapshot_retirement_cursor%rowtype;budget interval;result jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0'or budget>interval'5seconds'then raise exception 'snapshot_retention_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))
  or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))
  or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into v_cursor from private.provider_snapshot_retirement_cursor where singleton for update;
 select p.id,p.local_date,p.cutoff into c from private.provider_snapshot_cohorts p where p.lane='current'and p.status in('ready','failed')
  and p.local_date<(statement_timestamp()at time zone'Asia/Kolkata')::date-1
  and p.cutoff<(p.local_date+1)::timestamp at time zone'Asia/Kolkata'and jsonb_array_length(p.targets)=18
  and p.updated_at<clock_timestamp()-interval'1hour'
  and not exists(select 1 from private.provider_snapshot_retired_cohorts r where r.cohort_id=p.id)
  and exists(select 1 from private.provider_snapshot_cohorts n where n.local_date=p.local_date and n.targets=p.targets and n.roster_token=p.roster_token
   and n.status='ready'and n.cutoff=(n.local_date+1)::timestamp at time zone'Asia/Kolkata')
  order by case when row(p.local_date,p.cutoff,p.id)>row(v_cursor.local_date,v_cursor.cutoff,v_cursor.cohort_id)then 0 else 1 end,p.local_date,p.cutoff,p.id limit 1;
 if c.id is null then return jsonb_build_object('status','idle');end if;
 result:=private.provider_snapshot_retire_intraday(c.id);
 if result->>'status'<>'busy'then
  insert into private.provider_snapshot_retirement_cursor values(true,c.local_date,c.cutoff,c.id)
   on conflict(singleton)do update set local_date=excluded.local_date,cutoff=excluded.cutoff,cohort_id=excluded.cohort_id;
 end if;
 return result;
end;$cycle$;
revoke all on function private.provider_snapshot_retire_closed_cycle()from public,anon,authenticated,service_role;

commit;
