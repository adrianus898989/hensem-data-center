-- Code-only helper priority: unreadable closed source days only, 20 -> 100.
-- Uses the existing source queue/aging/single lane. No job UPDATE or retry reset.
-- Rollback restores admission code; already admitted job priorities remain intact.
begin;
set local statement_timeout='8s';set local lock_timeout='500ms';
do $preflight$
declare p pg_proc%rowtype;e jsonb;s jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_day_priority_owner_required';end if;
 select *into p from pg_proc where oid='private.daily_provider_base_admit_days(jsonb,boolean)'::regprocedure;
 if md5(p.prosrc)is distinct from 'f8d31324b482e07d0e2afa9f1e25b554'or md5(pg_get_functiondef(p.oid))is distinct from '071e6affae9b21beb485546ce8eb7279'
 or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from $guard${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_admit_days","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_entries","p_force"],"proargtypes":["3802","16"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$guard$::jsonb
 or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'
 then raise exception'daily_provider_day_priority_helper_cas';end if;

 for e in select value from jsonb_array_elements($guard$[{"signature":"private.daily_provider_base_claim()","body":"3648171d9c60e0664eeb87eac4d7074e","definition":"7e62877a9196809f5c8e7f8b8309e36c"},{"signature":"private.daily_provider_base_enqueue(jsonb)","body":"3e91604fc68dd00b95cc2228465987a0","definition":"5885c2793fe673413574fdd60f509438"},{"signature":"private.daily_provider_base_prewarm(jsonb)","body":"961373610e68a9ffb875aba9bba9bdf6","definition":"6486017965c6b31a3cb8f558b884f7dd"},{"signature":"private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)","body":"9aa3342e3095e492bb9a8c0d5903507e","definition":"732492ecaefd89ac6079dfc3aec2b801"},{"signature":"private.dashboard_admin_daily_provider_prepared_read(text,jsonb)","body":"2d192bb43a5fdfb07230bc8a5f6d859f","definition":"6dccfdb87ea7eef3b7b851eed8f9467b"},{"signature":"private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)","body":"a4e4e1a403bf0aa2dc70c7bb7ad4e6c9","definition":"51ab15b2eaedf6e682e9c5fbde1e3da4"},{"signature":"private.prepared_aggregate_read(text,jsonb)","body":"4a38ca3d9bbfbed3cc94250db95064da","definition":"df7914b8375708f883617b3d09265423"},{"signature":"private.prepared_aggregate_claim(text)","body":"f3d8d4bd4c21d52afe39c4149e39f46f","definition":"9a012a03870c50d7285dc78c07982a39"}]$guard$::jsonb)loop
  if not exists(select 1 from pg_proc x where x.oid=to_regprocedure(e->>'signature')and md5(x.prosrc)=e->>'body'and md5(pg_get_functiondef(x.oid))=e->>'definition')then raise exception'daily_provider_day_priority_protected_cas:%',e->>'signature';end if;
 end loop;
 perform set_config('audit.provider_day_priority_helper_meta',(to_jsonb(p)-array['prosrc','prosqlbody'])::text,true);
 select(select jsonb_agg(to_jsonb(snapshot_fn)order by snapshot_fn.oid)from pg_proc snapshot_fn where snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'),to_regprocedure('private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'),to_regprocedure('private.prepared_aggregate_read(text,jsonb)'),to_regprocedure('private.prepared_aggregate_claim(text)')]))into s;perform set_config('audit.provider_day_priority_functions',s::text,true);
 select(select jsonb_build_object('common',c.value,'targets',(select jsonb_agg(jsonb_build_array(to_jsonb(n),private.prepared_aggregate_dependency(to_jsonb(n),c.value))order by n.id)from private.prepared_aggregate_native_catalog()n where n.team='M8'and n.country='印度'and n.scope_group='IN'and n.source in('ar','newar','kb')))from(select private.prepared_aggregate_dependency_common('IN')value)c)into s;perform set_config('audit.provider_day_priority_dependency',s::text,true);
end;$preflight$;
-- BEGIN admit-days-priority
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
    if permits->fingerprint='true'::jsonb then budget:=1;job_id:=private.prepared_aggregate_enqueue(b,t,dep,20::smallint);end if;
   else
    job_id:=private.prepared_aggregate_enqueue(b,t,dep,20::smallint);
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
-- END admit-days-priority
do $verify$
declare p pg_proc%rowtype;s jsonb;
begin
 select *into p from pg_proc where oid='private.daily_provider_base_admit_days(jsonb,boolean)'::regprocedure;
 if md5(p.prosrc)is distinct from 'd7994c11a4e27615eb774e4a65a92ffa'or md5(pg_get_functiondef(p.oid))is distinct from '748c5c28d9f8342b0996deff750bcf74'
 or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from $guard${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_admit_days","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_entries","p_force"],"proargtypes":["3802","16"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$guard$::jsonb
 or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'
 then raise exception'daily_provider_day_priority_helper_cas';end if;

 if (to_jsonb(p)-array['prosrc','prosqlbody'])is distinct from current_setting('audit.provider_day_priority_helper_meta')::jsonb then raise exception'daily_provider_day_priority_helper_metadata_changed';end if;
 select(select jsonb_agg(to_jsonb(snapshot_fn)order by snapshot_fn.oid)from pg_proc snapshot_fn where snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'),to_regprocedure('private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'),to_regprocedure('private.prepared_aggregate_read(text,jsonb)'),to_regprocedure('private.prepared_aggregate_claim(text)')]))into s;if s is distinct from current_setting('audit.provider_day_priority_functions')::jsonb then raise exception'daily_provider_day_priority_protected_changed';end if;
 select(select jsonb_build_object('common',c.value,'targets',(select jsonb_agg(jsonb_build_array(to_jsonb(n),private.prepared_aggregate_dependency(to_jsonb(n),c.value))order by n.id)from private.prepared_aggregate_native_catalog()n where n.team='M8'and n.country='印度'and n.scope_group='IN'and n.source in('ar','newar','kb')))from(select private.prepared_aggregate_dependency_common('IN')value)c)into s;if s is distinct from current_setting('audit.provider_day_priority_dependency')::jsonb then raise exception'daily_provider_day_priority_financial_dependency_changed';end if;
end;$verify$;
commit;
