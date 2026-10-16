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
 if v_from::date<>v_to::date then return jsonb_build_object('version',1,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));end if;
 if jsonb_typeof(p_request->'components')is distinct from'array'or jsonb_array_length(p_request->'components')not between 1 and 3
  or exists(select 1 from jsonb_array_elements(p_request->'components')x where jsonb_typeof(x)is distinct from'string'or x#>>'{}'not in('orders','submission','intake'))then raise exception using errcode='22023',message='invalid_snapshot_components';end if;
 select array_agg(x order by x)into v_components from jsonb_array_elements_text(p_request->'components')x;
 if cardinality(v_components)<>(select count(distinct x)from unnest(v_components)x)then raise exception using errcode='22023',message='invalid_snapshot_components';end if;
 v_start:=v_from at time zone'Asia/Kolkata';v_max:=least((v_to+interval'1second')at time zone'Asia/Kolkata',statement_timestamp());v_previous_start:=(v_from-interval'1day')at time zone'Asia/Kolkata';
 v_expected:=cardinality(v_ids)*(cardinality(v_components)+(select count(*)from unnest(v_components)c where c<>'submission'));
 -- Find the full published intersection without a fixed candidate limit. Incomplete
 -- newer cutoffs can never evict the last fully published common generation.
 with eligible as materialized(
  select j.*,a.revision artifact_revision,a.dependency_token artifact_dependency,c->>'dependency'current_dependency
  from private.provider_snapshot_jobs j join private.provider_snapshot_heads h on h.job_id=j.id
  join private.provider_snapshot_artifacts a on a.id=h.snapshot_id cross join jsonb_array_elements(v_catalog)c
  where j.target=private.provider_snapshot_target(c->'target')and j.component=any(v_components)
   and j.platform_id=any(v_ids)and(j.window_from=v_start and j.window_to<=v_max
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
    and j.window_from=v_start and j.window_to<=v_max and j.component=any(v_components);
  v_all:=false;
 end if;
 v_lookup_cut:=v_cut;
 if v_lookup_cut is null then
  -- No published head yet: expose a queued/running generation as building without
  -- calling its cutoff published or inventing zero payloads.
  select max(j.window_to)into v_lookup_cut from private.provider_snapshot_jobs j cross join jsonb_array_elements(v_catalog)c
   where j.target=private.provider_snapshot_target(c->'target')and j.window_from=v_start and j.window_to<=v_max and j.component=any(v_components);
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
