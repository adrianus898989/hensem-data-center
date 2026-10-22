-- Two existing metadata/admission entries only. No source facts, queues, schedules or privileges are mutated.
begin;
set local statement_timeout='15s';
do $guard$declare e jsonb;a jsonb;begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='created_daily_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('created_daily_admission_transition_v1',0))then raise exception'created_daily_busy';end if;
 for e in select value from jsonb_array_elements($meta$[{"identity":"private.daily_provider_base_claim()","body_md5":"c0bd5fd60a5b4d2bb35cfec5c1ae8dea","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"","result":"jsonb","language":"plpgsql"},{"identity":"private.daily_provider_base_admit_days(jsonb,boolean)","body_md5":"8ff07c81e8107a73412c362dea8700bc","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_entries jsonb, p_force boolean","result":"jsonb","language":"plpgsql"}]$meta$::jsonb)loop
 select jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'language',l.lanname)into a from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'identity');
 if a is distinct from e then raise exception'created_daily_function_drift:%',e->>'identity';end if;end loop;
end;$guard$;
create temporary table created_daily_before on commit drop as select scope,private.prepared_aggregate_dependency_common(scope)dependency from unnest(array['IN','ID','BR','MX','CL','CO'])s(scope);
create temporary table created_daily_target_before on commit drop as select to_jsonb(n)target,private.prepared_aggregate_dependency(to_jsonb(n))dependency from private.prepared_aggregate_native_catalog()n where n.id::text in('e7c4101c-bd8e-d51d-436a-6ffa61077937','6a05acd2-a892-9fa4-a376-af1f942d2a3b','014212b9-fbbc-954c-eb5e-77f981909029');
do $targets$begin if(select count(*)from created_daily_target_before)<>3 then raise exception'created_daily_canary_catalog_drift';end if;end;$targets$;
CREATE OR REPLACE FUNCTION private.daily_provider_base_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.daily_provider_base_jobs%rowtype;warm_job private.daily_provider_base_jobs%rowtype;warm_request jsonb;started timestamptz;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.withdraw_prepared_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.daily_provider_base_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 -- Idle metadata maintenance runs BEFORE any base-row write/lock. Both this
 -- background path and the reader acquire actor/source rows before base rows.
 if not exists(select 1 from private.daily_provider_base_jobs where status='running')
  and not exists(select 1 from private.daily_provider_base_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp())then
  select *into warm_job from private.daily_provider_base_jobs where last_requested_at>=clock_timestamp()-interval'1day'and not_before<=clock_timestamp()
   and(status='ready'or(status='failed'and attempts>=3 and last_error='daily_provider_base_obsolete'))
   order by not_before,last_requested_at desc,created_at limit 1;
  if warm_job.id is not null then
   -- The family contains original daily q key presence/types. Canonical job
   -- request alone loses offset/limit and would prewarm a different family.
   warm_request:=(warm_job.content_key->'dailyRequests'->0)||jsonb_build_object(
    'startAt',warm_job.request->>'startAt','endAt',warm_job.request->>'endAt',
    'successStartAt',warm_job.request->>'successStartAt','successEndAt',warm_job.request->>'successEndAt');
   begin
    perform private.daily_provider_base_prewarm_internal(jsonb_build_array(warm_request),warm_job.last_requested_at);
   exception when invalid_parameter_value or object_not_in_prerequisite_state or lock_not_available then
    null; -- Conservative drift/contention miss; no authority/deadline catch.
   end;
   -- A new content key may have retired this old non-running row. Zero rows is
   -- expected; no running lease/retry budget/activity timestamp is rewritten.
   update private.daily_provider_base_jobs set not_before=clock_timestamp()+interval'5minutes'
    where id=warm_job.id and content_key=warm_job.content_key
     and(status='ready'or(status='failed'and attempts>=3 and last_error='daily_provider_base_obsolete'));
  end if;
 end if;
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

CREATE OR REPLACE FUNCTION private.daily_provider_base_admit_days(p_entries jsonb, p_force boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare entry jsonb;q jsonb;t jsonb;b jsonb;k jsonb;dep text;scope text;common text;commons jsonb:='{}';validated jsonb:='[]';states jsonb:='[]';seen jsonb:='{}';permits jsonb:='{}';fingerprint text;
 j private.prepared_aggregate_jobs%rowtype;a record;actor_id uuid:=coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid);budget integer;job_id uuid;state text;reason text;readable boolean;was_missing boolean;local_a timestamp;local_b timestamp;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if jsonb_typeof(p_entries)is distinct from'array'or jsonb_array_length(p_entries)>93 then raise exception using errcode='22023',message='daily_provider_days_invalid';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'::regprocedure and md5(prosrc)='a4e4e1a403bf0aa2dc70c7bb7ad4e6c9')then raise exception'daily_provider_days_enqueue_drift';end if;
 -- Validate the ENTIRE plan before the first admission. No partial mutation of
 -- an unauthorized or unsupported later native/date/filter is permitted.
 for entry in select value from jsonb_array_elements(p_entries)loop
  q:=entry->'request';t:=entry->'target';
  if private.prepared_aggregate_target_current(t)is distinct from true or private.prepared_aggregate_request_reason(q,t)is not null
   or t->>'source'not in('ar','newar','kb')or q->>'view'is distinct from'providers'or q->>'direction'is distinct from'all'or q->>'successBasis'is distinct from'success'or coalesce(q->>'status','all')<>'all'
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','currency','offset','limit']<>'{}'::jsonb
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
   or(q->>'startAt')::timestamptz is distinct from(q->>'successStartAt')::timestamptz or(q->>'endAt')::timestamptz is distinct from(q->>'successEndAt')::timestamptz
   or(q->>'endAt')::timestamptz>clock_timestamp()then raise exception using errcode='22023',message='daily_provider_days_unsupported';end if;
  local_a:=(q->>'startAt')::timestamptz at time zone(t->>'timezone');local_b:=(q->>'endAt')::timestamptz at time zone(t->>'timezone');
  if local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)or local_b::date-local_a::date<>1 then raise exception using errcode='22023',message='daily_provider_days_invalid_window';end if;
  scope:=t->>'scope_group';common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  if dep is distinct from entry->>'dependency'then raise exception using errcode='55000',message='daily_provider_days_dependency_changed';end if;
  b:=private.prepared_aggregate_base_request(q,t);k:=private.prepared_aggregate_key(b,t);
  validated:=validated||jsonb_build_array(entry||jsonb_build_object('base',b,'key',k));
 end loop;
 -- Original actor/day budget is acquired before any source-job row lock.
 -- This does not introduce a job->actor lock inversion for mixed daily plans.
 for entry in select value from jsonb_array_elements(validated)order by md5((value->'key')::text),(value->'key')::text collate"C"loop
  k:=entry->'key';fingerprint:=md5(k::text);
  if permits?fingerprint then continue;end if;
  if not exists(select 1 from private.prepared_aggregate_jobs where request_fingerprint=fingerprint and request_key=k)then
   budget:=null;
   insert into private.prepared_aggregate_admissions(actor,day,total)values(actor_id,current_date,1)
    on conflict(actor,day)do update set total=private.prepared_aggregate_admissions.total+1 where private.prepared_aggregate_admissions.total<1000 returning total into budget;
   permits:=permits||jsonb_build_object(fingerprint,budget is not null);
  end if;
 end loop;
 for entry in select value from jsonb_array_elements(validated)order by md5((value->'key')::text),(value->'key')::text collate"C"loop
  q:=entry->'request';t:=entry->'target';b:=entry->'base';k:=entry->'key';dep:=entry->>'dependency';fingerprint:=md5(k::text);reason:=null;
  -- Repeated exact source days share one admission and one original quota debit.
  if seen?fingerprint then
   if seen->fingerprint->'key'is distinct from k then raise exception'daily_provider_days_identity_collision';end if;
   states:=states||jsonb_build_array(((seen->fingerprint)-'key')||jsonb_build_object('owner',entry->'owner'));continue;end if;
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=fingerprint and request_key=k for update;
  select a0.id,a0.revision,a0.dependency,a0.cutoff,a0.computed_at,a0.expires_at,a0.source_complete into a
   from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
  readable:=a.id is not null and j.target=t and j.dependency=dep and a.dependency=dep and a.revision=j.revision
   and a.cutoff>=(q->>'endAt')::timestamptz and a.computed_at is not null and a.expires_at>a.computed_at and a.source_complete is not null;
  if readable is true then
   -- Exact original V2 force bookkeeping; it does not recompute, invalidate or
   -- replace the immutable publication, and failed/running jobs are not reset.
   if p_force then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp()
     where z.id=j.id and z.status='ready'and z.revision=a.revision and z.dependency=dep and z.target=t;
   end if;
   state:='ready';
  elsif j.status='running'then state:=case when j.target=t and j.dependency=dep then'running'else'failed'end;reason:=case when state='failed'then'daily_provider_day_running_scope_changed'end;
  elsif j.status='failed'and(j.last_error='superseded_by_full_master'and j.target=t and j.dependency=dep and(j.lease_until is null or j.lease_until<=clock_timestamp()))is not true then
   state:='failed';reason:='daily_provider_day_failed';
  elsif j.lease_until>clock_timestamp()then state:='failed';reason:='daily_provider_day_active_lease';
  else
   job_id:=null;budget:=null;was_missing:=j.id is null;
   if j.id is null then
    if permits->fingerprint='true'::jsonb then budget:=1;job_id:=private.prepared_aggregate_enqueue(b,t,dep,100::smallint);end if;
   else
    job_id:=private.prepared_aggregate_enqueue(b,t,dep,100::smallint);
    -- Only an ordinary READY job with no usable publication is repaired here.
    -- Running leases and all ordinary failed retry budgets remain untouched.
    update private.prepared_aggregate_jobs z set status='queued',not_before=clock_timestamp()
     where z.id=job_id and z.status='ready'and z.target=t and z.dependency=dep
      and(z.lease_until is null or z.lease_until<=clock_timestamp())and z.revision=j.revision;
   end if;
   select *into j from private.prepared_aggregate_jobs where id=job_id;
   state:=case when job_id is null then'failed'when j.target=t and j.dependency=dep and j.status in('queued','running')then j.status else'failed'end;
   reason:=case when job_id is null and was_missing and budget is null then'daily_provider_day_admission_limited'when job_id is null then'daily_provider_day_capacity'when state='failed'then'daily_provider_day_unavailable'end;
  end if;
  seen:=seen||jsonb_build_object(fingerprint,jsonb_build_object('key',k,'status',state,'reason',reason));
  states:=states||jsonb_build_array(jsonb_build_object('owner',entry->'owner','status',state,'reason',reason));
 end loop;
 return states;
end;$function$;

do $guard$declare e jsonb;a jsonb;begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='created_daily_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('created_daily_admission_transition_v1',0))then raise exception'created_daily_busy';end if;
 for e in select value from jsonb_array_elements($meta$[{"identity":"private.daily_provider_base_claim()","body_md5":"3648171d9c60e0664eeb87eac4d7074e","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"","result":"jsonb","language":"plpgsql"},{"identity":"private.daily_provider_base_admit_days(jsonb,boolean)","body_md5":"f8d31324b482e07d0e2afa9f1e25b554","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_entries jsonb, p_force boolean","result":"jsonb","language":"plpgsql"}]$meta$::jsonb)loop
 select jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'language',l.lanname)into a from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'identity');
 if a is distinct from e then raise exception'created_daily_function_drift:%',e->>'identity';end if;end loop;
end;$guard$;
do $verify$begin
 if exists(select 1 from created_daily_before b where b.dependency is distinct from private.prepared_aggregate_dependency_common(b.scope))or exists(select 1 from created_daily_target_before b where b.dependency is distinct from private.prepared_aggregate_dependency(b.target))then raise exception'created_daily_unexpected_prepared_dependency_change';end if;
end;$verify$;
select jsonb_build_object('scopeDependenciesUnchanged',true,'canaryTargetsChecked',3,'changedFunctions',2,'dataWrites',0);
commit;
