BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $guard$
DECLARE expected jsonb; actual jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='recent_prewarm_owner_required';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0)) THEN RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='recent_prewarm_dispatch_busy';END IF;
 FOR expected IN SELECT value FROM jsonb_array_elements($pins$[{"signature":"private.prepared_aggregate_dependency_common(text)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"9cba93eff52a872313d36e040b8e494d","definition_md5":"6a05db0a38d9808a024b2c238b6c5257"},{"signature":"private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"e05bf399932d1441b3425a548e0af7ed","definition_md5":"9aa161e7cc2ace98b3fac2fca1d292df"},{"signature":"private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"a4e4e1a403bf0aa2dc70c7bb7ad4e6c9","definition_md5":"51ab15b2eaedf6e682e9c5fbde1e3da4"},{"signature":"private.prepared_aggregate_retire_replaced(jsonb,jsonb,jsonb,text)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"5727bfa57092d8711769fcc81a060e3d","definition_md5":"ef2b556d6cf01503747dcbc7a04856fd"},{"signature":"private.prepared_aggregate_scheduled_due(jsonb,jsonb,timestamp with time zone,timestamp with time zone)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"c56ba8f6e92aecaa4595c68f1e128eff","definition_md5":"b2908f767799ab1bc5717dbe28b58e88"},{"signature":"private.dashboard_serving_country_prewarm(timestamp with time zone)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"f91f6f5217ceff0f7e428d560fc9215a"},{"signature":"private.dashboard_serving_recent_refresh_at(jsonb,jsonb,timestamp with time zone,timestamp with time zone)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"422aa5d2532a6b8780f11aa3d5898e36","definition_md5":"c770739c1aac368032d0a756ad14e9bd"}]$pins$::jsonb) LOOP
  SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
   'proconfig',to_jsonb(p.proconfig),'prosecdef',p.prosecdef,'provolatile',p.provolatile,'proparallel',p.proparallel,
   'proisstrict',p.proisstrict,'proleakproof',p.proleakproof,'procost',p.procost,'prorows',p.prorows,
   'body_md5',md5(p.prosrc),'definition_md5',md5(pg_get_functiondef(p.oid))) INTO actual
  FROM pg_proc p WHERE p.oid=to_regprocedure(expected->>'signature');
  IF actual IS NULL OR (actual-CASE WHEN expected?'definition_md5' THEN ARRAY[]::text[] ELSE ARRAY['definition_md5'] END) IS DISTINCT FROM expected
   THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='recent_prewarm_function_drift:'||(expected->>'signature');END IF;
 END LOOP;
END;$guard$;

CREATE OR REPLACE FUNCTION private.dashboard_serving_country_prewarm(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare state private.prepared_aggregate_schedule%rowtype;native jsonb;t jsonb;d date;offset_day integer;q jsonb;baseq jsonb;k jsonb;dep text;n integer:=0;jobs integer:=0;last_id uuid;
 commons jsonb:='{}';scope text;common text;job private.prepared_aggregate_jobs%rowtype;head private.prepared_aggregate_artifacts%rowtype;due timestamptz;admitted uuid;refreshed integer:=0;unsupported integer:=0;budget interval:=current_setting('statement_timeout')::interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if p_now is null or not isfinite(p_now)then raise exception using errcode='22023',message='invalid_schedule_time';end if;
 if budget<=interval'0'or budget>interval'3seconds'then raise exception using errcode='22023',message='prepared_schedule_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into state from private.prepared_aggregate_schedule where singleton for update;
 if not state.enabled then return jsonb_build_object('status','disabled');end if;
 if jsonb_array_length(state.approved_targets)=0 then return jsonb_build_object('status','no_approved_targets');end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb)into native from private.prepared_aggregate_native_catalog()p;
 if exists(select 1 from jsonb_array_elements(state.approved_targets)x where not exists(select 1 from jsonb_array_elements(native)y where x=y))
 or(select count(distinct x->>'id')from jsonb_array_elements(state.approved_targets)x)<>jsonb_array_length(state.approved_targets)
 then raise exception using errcode='55000',message='prepared_approved_manifest_drift';end if;
 -- Bound each tick to six reviewed targets. UUID order and persisted cursor
 -- rotate across all countries, without an automatic whole-directory expansion.
 for t in select x from jsonb_array_elements(state.approved_targets)x where state.cursor_id is null or(x->>'id')::uuid>state.cursor_id order by(x->>'id')::uuid limit 6 loop
  d:=(p_now at time zone(t->>'timezone'))::date;scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);
  for offset_day in 0..2 loop
   q:=jsonb_build_object('action','aggregate','view','providers','platformId',t->>'id','startAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'endAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successBasis','created','direction','all','status','all','currency',t->>'currency','offset',0,'limit',20);
   if private.prepared_aggregate_request_reason(q,t)is not null then unsupported:=unsupported+1;continue;end if;
   baseq:=private.prepared_aggregate_base_request(q,t,p_now);
   -- The single created default uses the same currency bands as the page.
   -- Explicit/custom manual requests below keep their exact original keys.
   if baseq->>'view'='full'and baseq->>'durationVersion'='2'then
    baseq:=baseq||jsonb_build_object('amountBands',private.dashboard_serving_default_amount_bands(t->>'currency'));
   end if;
   k:=private.prepared_aggregate_key(baseq,t);
   select *into job from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   -- Do not change an already claimed job, even if a rollout changes dependency.
   if job.status='running'and job.lease_until>clock_timestamp()then continue;end if;
   admitted:=private.prepared_aggregate_enqueue(baseq,t,dep,(10-offset_day)::smallint);
   if admitted is not null then jobs:=jobs+1;end if;
   perform private.prepared_aggregate_retire_replaced(q,t,baseq,dep);n:=n+1;
  end loop;last_id:=(t->>'id')::uuid;
 end loop;
 -- Only the created mode is an automatic default. Retain explicit/custom manual
 -- requests and recently interactive manual jobs, not former scheduled same-day
 -- success defaults. No existing head, budget, or running job is reset.
 -- Recently used exact/custom windows retain their own keys and do not borrow a
 -- default day. Refresh only approved native identities; running/failed states
 -- are never reset here. Stable computedAt determines the next planned slot.
 for job in select j.*from private.prepared_aggregate_jobs j where j.status='ready'and j.last_requested_at>p_now-interval'24hours'
  and (j.request->>'successBasis'='created' or j.interactive_requested_at>p_now-interval'24hours'
   or j.request->>'successStartAt'is distinct from j.request->>'startAt' or j.request->>'successEndAt'is distinct from j.request->>'endAt'
   or j.request?|array['durationRange','amountMin','amountMax','amountMaxExclusive','channelTypes']
   or coalesce(j.request->>'direction','all')<>'all' or coalesce(j.request->>'status','all')<>'all'
   or coalesce(j.request->'providers','[]'::jsonb)not in('[]'::jsonb,'null'::jsonb)
   or j.request?'amountBands'and j.request->'amountBands'<>private.dashboard_serving_default_amount_bands(j.target->>'currency')
    and not(j.priority between 8 and 10 and j.interactive_requested_at is null
     and j.request->'amountBands'=private.dashboard_serving_default_amount_bands('INR'))
   or ((j.request->>'startAt')::timestamptz at time zone(j.target->>'timezone'))<>date_trunc('day',(j.request->>'startAt')::timestamptz at time zone(j.target->>'timezone'))
   or ((j.request->>'endAt')::timestamptz at time zone(j.target->>'timezone'))<>((j.request->>'startAt')::timestamptz at time zone(j.target->>'timezone'))+interval'1day')
  and exists(select 1 from jsonb_array_elements(state.approved_targets)x where x=j.target)
  order by j.next_due_at nulls first,j.id limit 50 for update skip locked loop
  t:=job.target;scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);
  if job.dependency<>dep then perform private.prepared_aggregate_enqueue(job.request,t,dep,job.priority);continue;end if;
  select a.*into head from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a on a.id=h.artifact_id where h.job_id=job.id;
  if head.id is null or head.revision<>job.revision or head.dependency<>dep then
   update private.prepared_aggregate_jobs set status='queued',not_before=clock_timestamp()where id=job.id and status='ready';continue;
  end if;
  due:=private.prepared_aggregate_scheduled_due(job.request,t,head.computed_at,p_now);
  update private.prepared_aggregate_jobs set next_due_at=due where id=job.id and status='ready'and next_due_at is distinct from due;
  if due<=p_now then update private.prepared_aggregate_jobs set status='queued',not_before=clock_timestamp(),attempts=0 where id=job.id and status='ready';refreshed:=refreshed+1;end if;
 end loop;
 update private.prepared_aggregate_schedule set cursor_id=last_id,cursor_tier=0 where singleton;
 return jsonb_build_object('status','queued','requests',n,'backgroundJobs',jobs,'refreshed',refreshed,'unsupported',unsupported,'approvedTargets',jsonb_array_length(state.approved_targets),'currentIntervalSeconds',state.current_interval_seconds,'historicalLocalTimes',jsonb_build_array('08:00','20:00'));
end;$function$;

DO $guard$
DECLARE expected jsonb; actual jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='recent_prewarm_owner_required';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0)) THEN RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='recent_prewarm_dispatch_busy';END IF;
 FOR expected IN SELECT value FROM jsonb_array_elements($pins$[{"signature":"private.prepared_aggregate_dependency_common(text)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"9cba93eff52a872313d36e040b8e494d","definition_md5":"6a05db0a38d9808a024b2c238b6c5257"},{"signature":"private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"e05bf399932d1441b3425a548e0af7ed","definition_md5":"9aa161e7cc2ace98b3fac2fca1d292df"},{"signature":"private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"a4e4e1a403bf0aa2dc70c7bb7ad4e6c9","definition_md5":"51ab15b2eaedf6e682e9c5fbde1e3da4"},{"signature":"private.prepared_aggregate_retire_replaced(jsonb,jsonb,jsonb,text)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"5727bfa57092d8711769fcc81a060e3d","definition_md5":"ef2b556d6cf01503747dcbc7a04856fd"},{"signature":"private.prepared_aggregate_scheduled_due(jsonb,jsonb,timestamp with time zone,timestamp with time zone)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"c56ba8f6e92aecaa4595c68f1e128eff","definition_md5":"b2908f767799ab1bc5717dbe28b58e88"},{"signature":"private.dashboard_serving_country_prewarm(timestamp with time zone)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"7e09e38e4476ceed2593bfffa1c3b3de","definition_md5":"70f366e413f0545982242d207f09b9f7"},{"signature":"private.dashboard_serving_recent_refresh_at(jsonb,jsonb,timestamp with time zone,timestamp with time zone)","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"body_md5":"422aa5d2532a6b8780f11aa3d5898e36","definition_md5":"c770739c1aac368032d0a756ad14e9bd"}]$pins$::jsonb) LOOP
  SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
   'proconfig',to_jsonb(p.proconfig),'prosecdef',p.prosecdef,'provolatile',p.provolatile,'proparallel',p.proparallel,
   'proisstrict',p.proisstrict,'proleakproof',p.proleakproof,'procost',p.procost,'prorows',p.prorows,
   'body_md5',md5(p.prosrc),'definition_md5',md5(pg_get_functiondef(p.oid))) INTO actual
  FROM pg_proc p WHERE p.oid=to_regprocedure(expected->>'signature');
  IF actual IS NULL OR (actual-CASE WHEN expected?'definition_md5' THEN ARRAY[]::text[] ELSE ARRAY['definition_md5'] END) IS DISTINCT FROM expected
   THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='recent_prewarm_function_drift:'||(expected->>'signature');END IF;
 END LOOP;
END;$guard$;

COMMIT;
