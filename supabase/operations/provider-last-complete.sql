-- Version 2 changes freshness visibility only. Existing scheduled producers stay authoritative.
-- No queue writes, requeue, source computation, TTL extension or dependency-token changes.
begin;
set local statement_timeout='5s';
set local lock_timeout='500ms';
do $install$
declare before_metadata jsonb;after_metadata jsonb;begin
 if current_user<>'postgres'then raise exception 'provider_last_complete_denied';end if;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_live_provider_snapshot(jsonb)')and md5(prosrc)='d9eab72829992b0ee59e75e9845f0681'and pg_get_userbyid(proowner)='postgres'and prosecdef=true and provolatile='s'and proconfig=array['search_path=""']and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and l.lanname='plpgsql'and not proisstrict and not proleakproof and proparallel='u'and prokind='f'and not proretset and procost=100 and prorows=0 and pronargdefaults=0)then raise exception 'provider_last_complete_baseline_drift: private.dashboard_admin_live_provider_snapshot(jsonb)';end if;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.provider_snapshot_retire_intraday(uuid)')and md5(prosrc)='121c25849b0328e5ed643e4d2b63ee94'and pg_get_userbyid(proowner)='postgres'and prosecdef=false and provolatile='v'and proconfig=array['search_path=""']and proacl::text='{postgres=X/postgres}'and l.lanname='plpgsql'and not proisstrict and not proleakproof and proparallel='u'and prokind='f'and not proretset and procost=100 and prorows=0 and pronargdefaults=0)then raise exception 'provider_last_complete_baseline_drift: private.provider_snapshot_retire_intraday(uuid)';end if;
 select jsonb_agg(to_jsonb(p)-array['prosrc']order by p.oid)into before_metadata from pg_proc p where p.oid in('private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure,'private.provider_snapshot_retire_intraday(uuid)'::regprocedure);
 execute $definition_0$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_snapshot(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_version integer;v_due boolean:=false;v_slot_due boolean;v_refresh text:='idle';v_slot_refresh text;v_refresh_at timestamptz;
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
  or p_request->'version'is null or p_request->'version'not in('1'::jsonb,'2'::jsonb)
  or jsonb_typeof(p_request->'platformIds')is distinct from'array'
  or jsonb_array_length(p_request->'platformIds')not between 1 and 50
  or exists(select 1 from jsonb_array_elements(p_request->'platformIds')x where jsonb_typeof(x)is distinct from'string'or x#>>'{}'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
 then raise exception using errcode='22023',message='invalid_snapshot_request';end if;
 v_version:=(p_request->>'version')::integer;
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
  return jsonb_build_object('version',v_version,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
 end if;
 if exists(select 1 from jsonb_array_elements(v_catalog)x where not private.provider_snapshot_target_current(private.provider_snapshot_target(x->'target')))then
  return jsonb_build_object('version',v_version,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
 end if;
 if jsonb_typeof(p_request->'startAt')is distinct from'string'or jsonb_typeof(p_request->'endAt')is distinct from'string'
  or p_request->>'startAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'or p_request->>'endAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'
 then raise exception using errcode='22023',message='invalid_snapshot_window';end if;
 v_from:=(p_request->>'startAt')::timestamp;v_to:=(p_request->>'endAt')::timestamp;
 if to_char(v_from,'YYYY-MM-DD"T"HH24:MI:SS')<>p_request->>'startAt'or to_char(v_to,'YYYY-MM-DD"T"HH24:MI:SS')<>p_request->>'endAt'or v_to<v_from then raise exception using errcode='22023',message='invalid_snapshot_window';end if;
 if v_from::date<>v_to::date or v_from::time<>time'00:00:00' or v_to::time<>time'23:59:59' or v_from::date>(statement_timestamp()at time zone'Asia/Kolkata')::date then return jsonb_build_object('version',v_version,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));end if;
 if jsonb_typeof(p_request->'components')is distinct from'array'or jsonb_array_length(p_request->'components')not between 1 and 3
  or exists(select 1 from jsonb_array_elements(p_request->'components')x where jsonb_typeof(x)is distinct from'string'or x#>>'{}'not in('orders','submission','intake'))then raise exception using errcode='22023',message='invalid_snapshot_components';end if;
 select array_agg(x order by x)into v_components from jsonb_array_elements_text(p_request->'components')x;
 if cardinality(v_components)<>(select count(distinct x)from unnest(v_components)x)then raise exception using errcode='22023',message='invalid_snapshot_components';end if;
 if v_components<>array['intake','orders','submission']::text[]then return jsonb_build_object('version',v_version,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));end if;
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
  select window_to cutoff,artifact_dependency=current_dependency and(status='ready'or v_version=2 and status in('queued','running','failed')and dependency_token=current_dependency)and artifact_revision=revision valid from eligible where window_from=v_start and window_to<=v_max
  union all
  select ((window_to at time zone'Asia/Kolkata')+interval'1day')at time zone'Asia/Kolkata',artifact_dependency=current_dependency and(status='ready'or v_version=2 and status in('queued','running','failed')and dependency_token=current_dependency)and artifact_revision=revision
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
    select j.status,j.last_error_code,j.dependency_token job_dependency,j.next_due_at job_next_due,j.revision job_revision,a.revision artifact_revision,a.next_due_at,a.id snapshot_id,a.payload,a.provenance,a.computed_at,a.dependency_token into v_j
     from private.provider_snapshot_jobs j left join private.provider_snapshot_heads h on h.job_id=j.id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
     where j.target=v_target and j.component=v_component and j.window_from=v_payload_from and j.window_to=v_payload_to;
    v_payload:=null;v_state:='missing';v_slot_due:=false;v_slot_refresh:='idle';
    if found then
     if v_j.snapshot_id is not null then
      v_payload:=v_j.payload;
      v_slot_due:=coalesce(v_j.next_due_at<=statement_timestamp(),false)
       or v_period='current'and v_from::date=(statement_timestamp()at time zone'Asia/Kolkata')::date and v_lookup_cut<statement_timestamp()-interval'30minutes';
      if v_version=2 then
       -- A job's lease/fence may advance during refresh. Only the exact semantic
       -- revision, native target and dependencies authorize its immutable prior head.
       v_state:=case when v_j.artifact_revision is distinct from v_j.job_revision or not v_kernel_current
        or v_j.dependency_token is distinct from v_dep or v_j.job_dependency is distinct from v_dep
        or v_j.provenance->'computationComplete'is distinct from'true'::jsonb
        or v_j.status not in('ready','queued','running','failed')then'stale'else'ready'end;
       if v_state<>'ready'then v_payload:=null;end if;
      else
       v_state:=case when v_j.status in('queued','running')then'building'when v_j.status='failed'then'failed'
        when v_j.status is distinct from'ready'or v_j.artifact_revision is distinct from v_j.job_revision or not v_kernel_current
         or v_j.dependency_token is distinct from v_dep or v_slot_due then'stale'else'ready'end;
      end if;
      v_slot_refresh:=case when v_j.status in('queued','running','failed')then v_j.status else'idle'end;
      v_due:=v_due or v_slot_due;
      if v_slot_refresh='running'or v_slot_refresh='queued'and v_refresh<>'running'or v_slot_refresh='failed'and v_refresh='idle'then v_refresh:=v_slot_refresh;end if;
      if v_j.job_next_due is not null and(v_refresh_at is null or v_j.job_next_due<v_refresh_at)then v_refresh_at:=v_j.job_next_due;end if;
      if v_state='stale'then v_stale:=true;end if;
      if v_first is null or v_j.computed_at<v_first then v_first:=v_j.computed_at;end if;
      if v_j.next_due_at is not null and(v_next is null or v_j.next_due_at<v_next)then v_next:=v_j.next_due_at;end if;
      v_snapshots:=v_snapshots||jsonb_build_array(jsonb_build_object('snapshotId',v_j.snapshot_id,'component',v_component,'period',v_period,
       'computedAt',private.provider_snapshot_iso(v_j.computed_at),'sourceReadStartedAt',v_j.provenance->>'sourceReadStartedAt','sourceReadCompletedAt',v_j.provenance->>'sourceReadCompletedAt',
       'upstreamComplete',v_j.provenance->'upstreamComplete','stale',v_state='stale','nextDueAt',private.provider_snapshot_iso(v_j.next_due_at))||case when v_version=2 then jsonb_build_object('freshness',case when v_state='ready'then case when v_slot_due then'refresh_due'else'fresh'end end,'refreshState',v_slot_refresh,'nextRefreshAt',private.provider_snapshot_iso(v_j.job_next_due))else'{}'::jsonb end);
     else v_state:=case when v_j.status in('queued','running')then'building'when v_j.status='failed'then'failed'else'missing'end;end if;
    end if;
    if v_state='building'then v_building:=true;end if;
    if v_state<>'ready'then v_all:=false;v_missing:=v_missing||jsonb_build_array(jsonb_build_object('platformId',v_target->>'id','component',v_component,'period',v_period,'state',v_state,'errorCode',case when v_state='failed'then v_j.last_error_code end));end if;
    if v_period='current'then v_current:=v_current||jsonb_build_object(v_component,v_payload);else v_previous:=v_previous||jsonb_build_object(v_component,v_payload);end if;
   end loop;
  end loop;
  v_platforms:=v_platforms||jsonb_build_array(jsonb_build_object('platform',(v_target-array['scope_group','source_name'])||jsonb_build_object('scopeGroup',v_target->'scope_group','sourceName',v_target->'source_name'),'current',v_current,'previous',v_previous,'snapshots',v_snapshots));
 end loop;
 return jsonb_build_object('version',v_version,'mode','published_snapshot','status',case when v_all then'ready'when v_stale then'stale'when v_building then'building'else'missing'end,'complete',v_all,
 'requested',jsonb_build_object('startAt',p_request->'startAt','endAt',p_request->'endAt'),
 'publishedCutoff',private.provider_snapshot_iso(v_cut),'cutoffEpochMs',case when v_cut is not null then floor(extract(epoch from v_cut)*1000)::bigint end,
 'window',case when v_cut is not null then jsonb_build_object('timezone','Asia/Kolkata','startAt',private.provider_snapshot_iso(v_start),'endAt',private.provider_snapshot_iso(v_cut),'previousStartAt',private.provider_snapshot_iso(v_previous_start),'previousEndAt',private.provider_snapshot_iso(v_previous_end),
  'localStartAt',to_char(v_from,'YYYY-MM-DD"T"HH24:MI:SS'),'localCutoff',to_char(v_cut at time zone'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS'),
  'previousLocalStartAt',to_char(v_from-interval'1day','YYYY-MM-DD"T"HH24:MI:SS'),'previousLocalCutoff',to_char(v_previous_end at time zone'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS'))end,
 'platforms',v_platforms,'missing',v_missing,'computedAt',private.provider_snapshot_iso(v_first),'nextDueAt',private.provider_snapshot_iso(v_next),
 'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'))||case when v_version=2 then jsonb_build_object('freshness',case when v_all then case when v_due then'refresh_due'else'fresh'end end,'refreshState',v_refresh,'nextRefreshAt',private.provider_snapshot_iso(v_refresh_at))else'{}'::jsonb end;
end;$function$
$definition_0$;
 execute $definition_1$CREATE OR REPLACE FUNCTION private.provider_snapshot_retire_intraday(p_cohort_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  and md5(prosrc)in('d9eab72829992b0ee59e75e9845f0681','66d7a6afd3e1951726da83daa258df22'))then raise exception 'snapshot_retention_reader_contract_changed';end if;
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
end;$function$
$definition_1$;
 select jsonb_agg(to_jsonb(p)-array['prosrc']order by p.oid)into after_metadata from pg_proc p where p.oid in('private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure,'private.provider_snapshot_retire_intraday(uuid)'::regprocedure);
 if after_metadata is distinct from before_metadata then raise exception 'provider_last_complete_metadata_changed';end if;
 if(select md5(prosrc)from pg_proc where oid='private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure)is distinct from'66d7a6afd3e1951726da83daa258df22'then raise exception 'provider_last_complete_postcheck';end if;
 if(select md5(prosrc)from pg_proc where oid='private.provider_snapshot_retire_intraday(uuid)'::regprocedure)is distinct from'2222dc8768404fa848930bf4a9533f3e'then raise exception 'provider_last_complete_postcheck';end if;
end;$install$;
commit;
