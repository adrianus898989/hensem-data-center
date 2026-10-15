-- BEGIN quota.sql
-- Independent derived-storage budgets. These counters never inspect source orders.
create function private.provider_snapshot_storage_class(p_target jsonb,p_from timestamptz,p_to timestamptz)
returns text language sql immutable security invoker set search_path=''as $class$
 select case when p_target->>'scope_group'='IN'and p_target->>'timezone'in('Asia/Kolkata','Asia/Calcutta')
  and(p_from at time zone'Asia/Kolkata')::time=time'00:00:00'
  and(p_to at time zone'Asia/Kolkata')=(p_from at time zone'Asia/Kolkata')+interval'1day'
  then'history'else'hot'end;
$class$;
revoke all on function private.provider_snapshot_storage_class(jsonb,timestamptz,timestamptz)from public,anon,authenticated,service_role;
create table private.provider_snapshot_storage_usage(
 storage_class text primary key check(storage_class in('hot','history')),
 jobs bigint not null default 0 check(jobs>=0),failed_jobs bigint not null default 0 check(failed_jobs>=0),
 artifacts bigint not null default 0 check(artifacts>=0),stored_bytes bigint not null default 0 check(stored_bytes>=0)
);
alter table private.provider_snapshot_storage_usage enable row level security;
revoke all on private.provider_snapshot_storage_usage from public,anon,authenticated,service_role;
insert into private.provider_snapshot_storage_usage(storage_class)values('hot'),('history');
with j as(select private.provider_snapshot_storage_class(target,window_from,window_to)c,count(*)jobs,count(*)filter(where status='failed')failed from private.provider_snapshot_jobs group by 1)
update private.provider_snapshot_storage_usage u set jobs=j.jobs,failed_jobs=j.failed from j where u.storage_class=j.c;
with a as(select private.provider_snapshot_storage_class(j.target,j.window_from,j.window_to)c,count(*)artifacts,sum(a.stored_bytes)bytes
 from private.provider_snapshot_artifacts a join private.provider_snapshot_jobs j on j.id=a.job_id group by 1)
update private.provider_snapshot_storage_usage u set artifacts=a.artifacts,stored_bytes=a.bytes from a where u.storage_class=a.c;
create function private.provider_snapshot_job_identity_immutable()
returns trigger language plpgsql security invoker set search_path=''as $identity$
begin
 if row(new.request_key,new.target,new.request,new.component,new.platform_id,new.window_from,new.window_to)
  is distinct from row(old.request_key,old.target,old.request,old.component,old.platform_id,old.window_from,old.window_to)
 then raise exception using errcode='55000',message='snapshot_job_identity_immutable';end if;return new;
end;$identity$;
revoke all on function private.provider_snapshot_job_identity_immutable()from public,anon,authenticated,service_role;
create trigger provider_snapshot_job_identity_immutable before update on private.provider_snapshot_jobs for each row execute function private.provider_snapshot_job_identity_immutable();
create function private.provider_snapshot_account_jobs()
returns trigger language plpgsql security invoker set search_path=''as $jobs$
declare c text;delta integer;failed_delta integer;cap integer;
begin
 c:=private.provider_snapshot_storage_class(coalesce(new.target,old.target),coalesce(new.window_from,old.window_from),coalesce(new.window_to,old.window_to));
 delta:=case tg_op when'INSERT'then 1 when'DELETE'then -1 else 0 end;
 failed_delta:=case when tg_op<>'DELETE'and new.status='failed'then 1 else 0 end-case when tg_op<>'INSERT'and old.status='failed'then 1 else 0 end;
 cap:=case c when'history'then 50000 else 5000 end;
 -- AFTER INSERT runs only for actually inserted keys, never an ON CONFLICT replay.
 -- One counter row lock makes concurrent enqueue admission atomic.
 update private.provider_snapshot_storage_usage set jobs=jobs+delta,failed_jobs=failed_jobs+failed_delta
 where storage_class=c and(delta<>1 or(jobs<cap and failed_jobs<500));
 if not found then raise exception using errcode='54000',message='snapshot_queue_capacity';end if;
 return coalesce(new,old);
end;$jobs$;
revoke all on function private.provider_snapshot_account_jobs()from public,anon,authenticated,service_role;
create trigger provider_snapshot_account_jobs after insert or delete or update of status on private.provider_snapshot_jobs for each row execute function private.provider_snapshot_account_jobs();
create function private.provider_snapshot_account_artifacts()
returns trigger language plpgsql security invoker set search_path=''as $artifacts$
declare c text;delta integer;bytes bigint;cap integer;byte_cap bigint;
begin
 select private.provider_snapshot_storage_class(j.target,j.window_from,j.window_to)into strict c from private.provider_snapshot_jobs j where j.id=coalesce(new.job_id,old.job_id);
 delta:=case tg_op when'INSERT'then 1 else -1 end;bytes:=coalesce(new.stored_bytes,old.stored_bytes)*delta;
 cap:=case c when'history'then 25000 else 2048 end;byte_cap:=case c when'history'then 2147483648 else 268435456 end;
 update private.provider_snapshot_storage_usage set artifacts=artifacts+delta,stored_bytes=stored_bytes+bytes
 where storage_class=c and(delta<0 or(artifacts<cap and stored_bytes+bytes<=byte_cap));
 if not found then raise exception using errcode='54000',message='snapshot_artifact_capacity';end if;
 return coalesce(new,old);
end;$artifacts$;
revoke all on function private.provider_snapshot_account_artifacts()from public,anon,authenticated,service_role;
create trigger provider_snapshot_account_artifacts after insert or delete on private.provider_snapshot_artifacts for each row execute function private.provider_snapshot_account_artifacts();
create function private.provider_snapshot_deny_truncate()
returns trigger language plpgsql security invoker set search_path=''as $truncate$
begin raise exception using errcode='55000',message='snapshot_accounting_requires_bounded_delete';end;$truncate$;
revoke all on function private.provider_snapshot_deny_truncate()from public,anon,authenticated,service_role;
create trigger provider_snapshot_deny_truncate before truncate on private.provider_snapshot_jobs for each statement execute function private.provider_snapshot_deny_truncate();
create trigger provider_snapshot_deny_truncate before truncate on private.provider_snapshot_artifacts for each statement execute function private.provider_snapshot_deny_truncate();

-- BEGIN enqueue-after.sql
create or replace function private.provider_snapshot_enqueue(p_target jsonb,p_request jsonb,p_component text,p_not_before timestamptz default now())
returns uuid language plpgsql volatile security invoker set search_path='' as $fn$
declare t jsonb;q jsonb;k jsonb;f timestamptz;e timestamptz;j uuid;
begin
 t:=private.provider_snapshot_target(p_target);
 if not private.provider_snapshot_target_current(t)then raise exception using errcode='22023',message='snapshot_target_not_current';end if;
 if p_component not in('orders','submission','intake')or p_component is null or p_not_before is null or not isfinite(p_not_before)
  or jsonb_typeof(p_request)is distinct from'object'or p_request-array['action','view','platformId','startAt','endAt','direction','status','currency','offset','limit']<>'{}'::jsonb
  or p_request->>'action'is distinct from'aggregate'or p_request->>'view'is distinct from'providers'or p_request->>'platformId'is distinct from t->>'id'
  or p_request->>'direction'is distinct from'charge'or p_request->>'status'is distinct from'all'or p_request->>'currency'is distinct from'INR'
  or coalesce(p_request->'offset','0'::jsonb)<>'0'::jsonb or coalesce(p_request->'limit','20'::jsonb)<>'20'::jsonb
  or jsonb_typeof(p_request->'startAt')is distinct from'string'or jsonb_typeof(p_request->'endAt')is distinct from'string'
  or p_request->>'startAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
  or p_request->>'endAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
 then raise exception using errcode='22023',message='invalid_snapshot_request';end if;
 f:=(p_request->>'startAt')::timestamptz;e:=(p_request->>'endAt')::timestamptz;
 if not isfinite(f)or not isfinite(e)or e<=f or(e at time zone(t->>'timezone'))-(f at time zone(t->>'timezone'))>interval'1day'then raise exception using errcode='22023',message='unsupported_snapshot_window';end if;
 q:=p_request||jsonb_build_object('startAt',private.provider_snapshot_iso(f),'endAt',private.provider_snapshot_iso(e),'offset',0,'limit',20);
 k:=jsonb_build_object('version',1,'target',t,'component',p_component,'request',q);
 -- Bounded shadow footprint; do not evict last-good heads or silently truncate.
 -- Independent atomic quota admission is enforced by the table accounting trigger.
 insert into private.provider_snapshot_jobs(request_key,target,request,component,platform_id,window_from,window_to,dependency_token,not_before)
 values(k,t,q,p_component,(t->>'id')::uuid,f,e,private.provider_snapshot_dependency_token(t),p_not_before)
 on conflict(request_key)do nothing returning id into j;
 if j is null then select id into j from private.provider_snapshot_jobs where request_key=k;end if;return j;
end;$fn$;
revoke all on function private.provider_snapshot_enqueue(jsonb,jsonb,text,timestamptz)from public,anon,authenticated,service_role;


-- BEGIN complete-after.sql
create or replace function private.provider_snapshot_complete(p_job_id uuid,p_run_id uuid,p_fence bigint,p_payload jsonb,p_provenance jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare j private.provider_snapshot_jobs%rowtype;s uuid;f timestamptz;e timestamptz;
begin
 select *into j from private.provider_snapshot_jobs where id=p_job_id for update;
 if not found or j.run_id is distinct from p_run_id or j.fence is distinct from p_fence then return jsonb_build_object('published',false,'reason','obsolete');end if;
 if not private.provider_snapshot_kernel_contract_current()then return jsonb_build_object('published',false,'reason','kernel_contract_changed');end if;
 if not private.provider_snapshot_target_current(j.target)then return jsonb_build_object('published',false,'reason','target_changed');end if;
 if j.dependency_token is distinct from private.provider_snapshot_dependency_token(j.target)then return jsonb_build_object('published',false,'reason','dependency_changed');end if;
 if j.status='ready'then
  select a.id into s from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
   where h.job_id=j.id and a.run_id=p_run_id and a.fence=p_fence and a.payload=p_payload and a.provenance=p_provenance;
  if found then return jsonb_build_object('published',true,'snapshotId',s,'replayed',true);end if;
  return jsonb_build_object('published',false,'reason','replay_mismatch');
 end if;
 if j.status<>'running'or j.lease_until<=clock_timestamp()then return jsonb_build_object('published',false,'reason','obsolete');end if;
 if jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>4194304 or jsonb_typeof(p_provenance)is distinct from'object'or octet_length(p_provenance::text)>65536
  or p_provenance->'computationComplete'is distinct from'true'::jsonb or jsonb_typeof(p_provenance->'upstreamComplete')is distinct from'boolean'
  or jsonb_typeof(p_provenance->'sourceWatermark')is distinct from'object'
  or jsonb_typeof(p_provenance->'sourceReadStartedAt')is distinct from'string'or jsonb_typeof(p_provenance->'sourceReadCompletedAt')is distinct from'string'
  or p_provenance->>'sourceReadStartedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'or p_provenance->>'sourceReadCompletedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
  or p_provenance?'nextDueAt'and p_provenance->'nextDueAt'<>'null'::jsonb and(jsonb_typeof(p_provenance->'nextDueAt')is distinct from'string'or p_provenance->>'nextDueAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$')
 then raise exception using errcode='22023',message='incomplete_snapshot';end if;
 f:=(p_provenance->>'sourceReadStartedAt')::timestamptz;e:=(p_provenance->>'sourceReadCompletedAt')::timestamptz;
 if not isfinite(f)or not isfinite(e)or e<f or e>clock_timestamp()+interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_provenance';end if;
 if j.component in('orders','submission','intake')then
  if p_payload->'version'is distinct from to_jsonb(case when j.component='submission'then 3 else 1 end) or p_payload#>>'{platform,id}'is distinct from j.target->>'id'
   or p_payload#>>'{platform,source}'is distinct from j.target->>'source'or p_payload#>>'{platform,sourceName}'is distinct from j.target->>'source_name'
   or p_payload#>>'{platform,scopeGroup}'is distinct from j.target->>'scope_group'or p_payload#>>'{platform,currency}'is distinct from j.target->>'currency'
   or p_payload#>>'{platform,timezone}'is distinct from j.target->>'timezone'
   or(case when j.component='intake'then p_payload#>>'{snapshotWindow,startAt}'else p_payload->>'startAt'end)::timestamptz is distinct from j.window_from or(case when j.component='intake'then p_payload#>>'{snapshotWindow,endAt}'else p_payload->>'endAt'end)::timestamptz is distinct from j.window_to
  then raise exception using errcode='22023',message='snapshot_scope_mismatch';end if;
 end if;
 if j.component='orders'and(jsonb_typeof(p_payload->'summary')is distinct from'array'or jsonb_typeof(p_payload#>'{groups,provider}')is distinct from'array'or p_payload->'rows'is distinct from'[]'::jsonb)then raise exception using errcode='22023',message='invalid_orders_snapshot';end if;
 if j.component='submission'and(jsonb_typeof(p_payload->'metrics')is distinct from'array'or jsonb_typeof(p_payload->'coverage')is distinct from'object'
  or p_payload->'rows'is not null and p_payload->'rows'<>'null'::jsonb or p_payload->'members'is not null and p_payload->'members'<>'null'::jsonb)then raise exception using errcode='22023',message='invalid_submission_snapshot';end if;
 if j.component='intake'and(p_payload->'version'is distinct from'1'::jsonb or jsonb_typeof(p_payload->'rows')is distinct from'array')then raise exception using errcode='22023',message='invalid_intake_snapshot';end if;
 -- Independent atomic quota admission is enforced by the table accounting trigger.
 insert into private.provider_snapshot_artifacts(job_id,run_id,fence,revision,dependency_token,payload,payload_hash,stored_bytes,provenance,next_due_at)
 values(j.id,j.run_id,j.fence,j.revision,j.dependency_token,p_payload,md5(p_payload::text),octet_length(p_payload::text)+octet_length(p_provenance::text),p_provenance,coalesce(j.next_due_at,case when jsonb_typeof(p_provenance->'nextDueAt')='string'then(p_provenance->>'nextDueAt')::timestamptz end))returning id into s;
 insert into private.provider_snapshot_heads(job_id,snapshot_id)values(j.id,s)on conflict(job_id)do update set snapshot_id=excluded.snapshot_id,published_at=clock_timestamp();
 update private.provider_snapshot_jobs set status='ready',lease_until=null,worker=null,last_error_code=null,updated_at=clock_timestamp(),
 next_due_at=coalesce(next_due_at,case when jsonb_typeof(p_provenance->'nextDueAt')='string'then(p_provenance->>'nextDueAt')::timestamptz end) where id=j.id;
 return jsonb_build_object('published',true,'snapshotId',s);
end;$fn$;
revoke all on function private.provider_snapshot_complete(uuid,uuid,bigint,jsonb,jsonb)from public,anon,authenticated,service_role;


-- BEGIN reader-after.sql
create or replace function private.dashboard_admin_live_provider_snapshot(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
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
  select j.*,a.dependency_token artifact_dependency,c->>'dependency'current_dependency
  from private.provider_snapshot_jobs j join private.provider_snapshot_heads h on h.job_id=j.id
  join private.provider_snapshot_artifacts a on a.id=h.snapshot_id cross join jsonb_array_elements(v_catalog)c
  where j.target=private.provider_snapshot_target(c->'target')and j.component=any(v_components)
   and j.platform_id=any(v_ids)and(j.window_from=v_start and j.window_to<=v_max
    or j.component<>'submission'and j.window_from=v_previous_start
     and j.window_to<=((v_max at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata')
 ),slots as(
  select window_to cutoff,artifact_dependency=current_dependency valid from eligible where window_from=v_start and window_to<=v_max
  union all
  select ((window_to at time zone'Asia/Kolkata')+interval'1day')at time zone'Asia/Kolkata',artifact_dependency=current_dependency
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
    select j.status,j.last_error_code,a.next_due_at,a.id snapshot_id,a.payload,a.provenance,a.computed_at,a.dependency_token into v_j
     from private.provider_snapshot_jobs j left join private.provider_snapshot_heads h on h.job_id=j.id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
     where j.target=v_target and j.component=v_component and j.window_from=v_payload_from and j.window_to=v_payload_to;
    v_payload:=null;v_state:='missing';
    if found then
     if v_j.snapshot_id is not null then
      v_payload:=v_j.payload;v_state:=case when not v_kernel_current or v_j.dependency_token is distinct from v_dep or v_j.next_due_at<=statement_timestamp()
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
end;$fn$;
revoke all on function private.dashboard_admin_live_provider_snapshot(jsonb)from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_live_provider_snapshot(jsonb)to authenticated;

-- BEGIN retention.sql
-- OFFLINE CANDIDATE ONLY. Not part of the frozen shadow migration.
-- Retirement is explicit; an ordinary version GC never deletes a head.
create table if not exists private.provider_snapshot_retired_cohorts(
 cohort_id uuid primary key references private.provider_snapshot_cohorts(id),
 replacement_cohort_id uuid not null,retired_at timestamptz not null default clock_timestamp(),
 retired_jobs integer not null,retired_heads integer not null
);
create table if not exists private.provider_snapshot_retired_jobs(
 job_id uuid primary key references private.provider_snapshot_jobs(id)on delete cascade,
 cohort_id uuid not null,retired_at timestamptz not null default clock_timestamp()
);
alter table private.provider_snapshot_retired_cohorts enable row level security;
alter table private.provider_snapshot_retired_jobs enable row level security;
revoke all on private.provider_snapshot_retired_cohorts,private.provider_snapshot_retired_jobs from public,anon,authenticated,service_role;
create index provider_snapshot_cohorts_retention on private.provider_snapshot_cohorts(local_date,roster_token,cutoff desc)where status='ready';

-- A full common cohort means EXACTLY all five native/current+prior slots exist.
-- Individual source completeness is deliberately not invented or required here.
create function private.provider_snapshot_cohort_complete(p_id uuid)
returns boolean language sql stable security invoker set search_path=''as $complete$
 with c as materialized(select *from private.provider_snapshot_cohorts where id=p_id and status='ready'
  and jsonb_array_length(targets)between 1 and 18),
 t as materialized(select x.value target,private.provider_snapshot_dependency_token(x.value)dependency from c cross join lateral jsonb_array_elements(c.targets)x),
 expected as(
  select c.id,t.target,t.dependency,v.component,
   ((c.local_date-case when v.prior then 1 else 0 end)::timestamp at time zone'Asia/Kolkata')window_from,
   (((c.cutoff at time zone'Asia/Kolkata')-case when v.prior then interval'1day'else interval'0'end)at time zone'Asia/Kolkata')window_to
  from c cross join t cross join(values('orders',false),('orders',true),('intake',false),('intake',true),('submission',false))v(component,prior)
 ),checked as(
  select e.*,j.id job_id,j.status,j.revision,j.dependency_token job_dependency,a.id artifact_id,a.revision artifact_revision,a.dependency_token artifact_dependency,a.provenance,a.next_due_at
  from expected e left join private.provider_snapshot_jobs j on j.target=e.target and j.component=e.component and j.window_from=e.window_from and j.window_to=e.window_to
  left join private.provider_snapshot_cohort_jobs cj on cj.cohort_id=e.id and cj.job_id=j.id
  left join private.provider_snapshot_heads h on h.job_id=cj.job_id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
 )select exists(select 1 from c)and private.provider_snapshot_kernel_contract_current()
 and not exists(select 1 from t where not private.provider_snapshot_target_current(target))
 and not exists(select 1 from c where c.local_date=(statement_timestamp()at time zone'Asia/Kolkata')::date and c.cutoff<statement_timestamp()-interval'30minutes')
 and(select count(distinct target)from t)=(select jsonb_array_length(targets)from c)
 and(select count(*)from private.provider_snapshot_cohort_jobs where cohort_id=p_id)=(select jsonb_array_length(targets)*5 from c)
 and(select count(*)from checked)=(select jsonb_array_length(targets)*5 from c)
 and not exists(select 1 from checked where job_id is null or artifact_id is null or status<>'ready'
  or artifact_revision<>revision or artifact_dependency<>dependency or job_dependency<>dependency
  or next_due_at<=statement_timestamp()or provenance->'computationComplete'is distinct from'true'::jsonb);
$complete$;
revoke all on function private.provider_snapshot_cohort_complete(uuid)from public,anon,authenticated,service_role;

create function private.provider_snapshot_retire_intraday(p_cohort_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path=''as $retire$
declare c private.provider_snapshot_cohorts%rowtype;replacement uuid;members uuid[];removable uuid[];n integer;h integer;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='snapshot_retention_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into c from private.provider_snapshot_cohorts where id=p_cohort_id for update nowait;
 if not found then return jsonb_build_object('status','missing');end if;
 if exists(select 1 from private.provider_snapshot_retired_cohorts where cohort_id=c.id)then return jsonb_build_object('status','already_retired');end if;
 if c.lane<>'current'or c.status not in('ready','failed','obsolete')or c.cutoff>=(c.local_date+1)::timestamp at time zone'Asia/Kolkata'
  or c.updated_at>clock_timestamp()-interval'1hour'or jsonb_array_length(c.targets)not between 1 and 18 then return jsonb_build_object('status','protected');end if;
 select id into replacement from private.provider_snapshot_cohorts n where n.local_date=c.local_date and n.roster_token=c.roster_token and n.targets=c.targets and n.cutoff>c.cutoff
  and n.status='ready'order by n.cutoff desc limit 1;
 -- Validate one latest ready candidate, never execute metadata hashes once per
 -- historical cutoff. An invalid latest candidate stops retirement conservatively.
 if replacement is null or not private.provider_snapshot_cohort_complete(replacement)then return jsonb_build_object('status','no_complete_replacement');end if;
 select array_agg(job_id order by job_id)into members from private.provider_snapshot_cohort_jobs where cohort_id=c.id;
 if cardinality(members)is distinct from jsonb_array_length(c.targets)*5 or cardinality(members)>90 then return jsonb_build_object('status','protected');end if;
 if exists(select 1 from private.provider_snapshot_jobs j where j.id=any(members)and(
  not c.targets@>jsonb_build_array(j.target)or not(
   j.window_from=c.local_date::timestamp at time zone'Asia/Kolkata'and j.window_to=c.cutoff
   or j.component<>'submission'and j.window_from=(c.local_date-1)::timestamp at time zone'Asia/Kolkata'
    and j.window_to=((c.cutoff at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata'
  )))then return jsonb_build_object('status','invalid_cohort_membership');end if;
 perform 1 from private.provider_snapshot_jobs where id=any(members)order by id for update nowait;
 if exists(select 1 from private.provider_snapshot_jobs where id=any(members)and(status in('queued','running','failed')))then return jsonb_build_object('status','active_jobs_protected');end if;
 -- Keep a tombstone so the scheduler cannot reconstruct an already retired cutoff.
 delete from private.provider_snapshot_cohort_jobs where cohort_id=c.id;
 update private.provider_snapshot_cohorts set status='obsolete',updated_at=clock_timestamp()where id=c.id;
 select array_agg(j.id order by j.id)into removable from private.provider_snapshot_jobs j where j.id=any(members)
  and not exists(select 1 from private.provider_snapshot_cohort_jobs x where x.job_id=j.id)
  and j.window_to<((j.window_from at time zone'Asia/Kolkata')::date+1)::timestamp at time zone'Asia/Kolkata';
 insert into private.provider_snapshot_retired_jobs(job_id,cohort_id)select x,c.id from unnest(removable)x on conflict do nothing;
 get diagnostics n=row_count;
 -- This is the only head deletion: these exact windows were explicitly retired
 -- after proving a newer complete common cutoff. Other heads remain untouched.
 delete from private.provider_snapshot_heads where job_id=any(removable);get diagnostics h=row_count;
 insert into private.provider_snapshot_retired_cohorts(cohort_id,replacement_cohort_id,retired_jobs,retired_heads)values(c.id,replacement,n,h);
 return jsonb_build_object('status','retired','replacementCohortId',replacement,'jobs',n,'heads',h);
end;$retire$;
revoke all on function private.provider_snapshot_retire_intraday(uuid)from public,anon,authenticated,service_role;

create function private.provider_snapshot_gc_versions(p_limit integer default 100)
returns jsonb language plpgsql volatile security invoker set search_path=''as $gc$
declare removed integer;freed bigint;jobs integer;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_limit is null or p_limit not between 1 and 200 or budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_gc_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then return jsonb_build_object('status','busy');end if;
 with candidates as materialized(
  select a.id from private.provider_snapshot_artifacts a where a.computed_at<clock_timestamp()-interval'1hour'
   and not exists(select 1 from private.provider_snapshot_heads h where h.snapshot_id=a.id)
   order by a.computed_at,a.id for update of a skip locked limit p_limit
 ),gone as(delete from private.provider_snapshot_artifacts a using candidates c where a.id=c.id
  and not exists(select 1 from private.provider_snapshot_heads h where h.snapshot_id=a.id)returning a.stored_bytes)
 select count(*),coalesce(sum(stored_bytes),0)into removed,freed from gone;
 with candidates as materialized(
  select j.id from private.provider_snapshot_jobs j join private.provider_snapshot_retired_jobs r on r.job_id=j.id
  where (j.status='ready'or j.status='failed'and j.attempts>=3)
   and not exists(select 1 from private.provider_snapshot_heads h where h.job_id=j.id)
   and not exists(select 1 from private.provider_snapshot_artifacts a where a.job_id=j.id)
   and not exists(select 1 from private.provider_snapshot_cohort_jobs c where c.job_id=j.id)
  order by j.id for update of j skip locked limit p_limit
 ),gone as(delete from private.provider_snapshot_jobs j using candidates c where j.id=c.id returning j.id)
 select count(*)into jobs from gone;
 return jsonb_build_object('status','collected','artifacts',removed,'storedBytes',freed,'retiredJobs',jobs);
end;$gc$;
revoke all on function private.provider_snapshot_gc_versions(integer)from public,anon,authenticated,service_role;

-- BEGIN maintenance.sql
-- Optional bounded maintenance call; this file creates no schedule.
create function private.provider_snapshot_maintain(p_artifact_limit integer default 100)
returns jsonb language plpgsql volatile security invoker set search_path=''as $maintain$
declare c uuid;r jsonb;g jsonb;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_artifact_limit is null or p_artifact_limit not between 1 and 200 or budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_gc_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select o.id into c from private.provider_snapshot_cohorts o where o.lane='current'and o.status in('ready','failed','obsolete')
  and o.cutoff<(o.local_date+1)::timestamp at time zone'Asia/Kolkata'and o.updated_at<clock_timestamp()-interval'1hour'
  and not exists(select 1 from private.provider_snapshot_retired_cohorts r where r.cohort_id=o.id)
  and not exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id where cj.cohort_id=o.id and j.status in('queued','running','failed'))
  and exists(select 1 from private.provider_snapshot_cohorts n where n.local_date=o.local_date and n.roster_token=o.roster_token and n.targets=o.targets and n.cutoff>o.cutoff and n.status='ready')
  order by o.cutoff,o.id limit 1;
 if c is not null then r:=private.provider_snapshot_retire_intraday(c);end if;
 g:=private.provider_snapshot_gc_versions(p_artifact_limit);
 return jsonb_build_object('retirement',r,'gc',g);
end;$maintain$;
revoke all on function private.provider_snapshot_maintain(integer)from public,anon,authenticated,service_role;
