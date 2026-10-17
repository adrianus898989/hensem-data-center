-- Reuse the existing prewarm entry point with explicitly reviewed native targets.
-- No source kernels, original provider queue, artifact TTLs, payloads or cron are changed.
-- Generic semantic dependency changes once; rebuild the small canary set afterward.
BEGIN;SET LOCAL lock_timeout='500ms';SET LOCAL statement_timeout='15s';
DO $guard$DECLARE spec jsonb;actual jsonb;BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION 'prepared_bounded_installer_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0)) OR NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RAISE EXCEPTION 'prepared_bounded_install_busy';END IF;
 IF EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RAISE EXCEPTION 'prepared_bounded_active_lease';END IF;
 IF(SELECT count(*)FROM private.prepared_aggregate_schedule)<>1 OR EXISTS(SELECT 1 FROM private.prepared_aggregate_schedule WHERE enabled)THEN RAISE EXCEPTION 'prepared_schedule_must_be_disabled';END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements($guards$[{"owner":"postgres","bodyMd5":"7c644384d4120c8f0c7f5546cae18354","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_complete","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_job","p_run","p_fence","p_payload"],"proargtypes":["2950","2950","20","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"signature":"private.prepared_aggregate_complete(uuid,uuid,bigint,jsonb)"},{"owner":"postgres","bodyMd5":"70c0d035b25286c54e8c9ecebe49c459","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_prewarm","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_now"],"proargtypes":["1184"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":"({FUNCEXPR :funcid 1299 :funcresulttype 1184 :funcretset false :funcvariadic false :funcformat 0 :funccollid 0 :inputcollid 0 :args <> :location -1})","pronargdefaults":1},"signature":"private.prepared_aggregate_prewarm(timestamp with time zone)"}]$guards$::jsonb)LOOP
 SELECT jsonb_build_object('metadata',to_jsonb(p)-'oid'-'prosrc'-'prolang'-'proowner'-'pronamespace'-'prorettype','bodyMd5',md5(prosrc),'owner',pg_get_userbyid(proowner),'language',l.lanname)INTO actual FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(spec->>'signature');
 IF actual IS DISTINCT FROM spec-'signature'THEN RAISE EXCEPTION 'prepared_bounded_baseline_drift: %',spec->>'signature';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.prepared_aggregate_base_request(jsonb,jsonb,timestamptz)'::regprocedure AND md5(prosrc)='e00ba5572ef6e4d0986af2099a4b7124'AND pg_get_userbyid(proowner)='postgres'AND proacl::text='{postgres=X/postgres}'AND proconfig=array['search_path=""']AND NOT prosecdef AND provolatile='s')THEN RAISE EXCEPTION 'prepared_master_base_drift';END IF;
END;$guard$;
ALTER TABLE private.prepared_aggregate_schedule ADD COLUMN approved_targets jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(approved_targets)='array'AND jsonb_array_length(approved_targets)<=250),ADD COLUMN current_interval_seconds integer NOT NULL DEFAULT 1200 CHECK(current_interval_seconds BETWEEN 300 AND 3600);
-- Cadence is a refresh plan, not a claim of new data or a longer artifact TTL.
create function private.prepared_aggregate_scheduled_due(q jsonb,t jsonb,p_computed timestamptz,p_now timestamptz default now())
returns timestamptz language plpgsql stable security invoker set search_path=''as $due$
declare state private.prepared_aggregate_schedule%rowtype;local_computed timestamp;local_day date;window_day date;
begin
 select *into state from private.prepared_aggregate_schedule where singleton;
 if not state.enabled or not exists(select 1 from jsonb_array_elements(state.approved_targets)x where x=t)then return null;end if;
 local_computed:=p_computed at time zone(t->>'timezone');local_day:=(p_now at time zone(t->>'timezone'))::date;
 window_day:=((greatest((q->>'endAt')::timestamptz,coalesce(q->>'successEndAt',q->>'endAt')::timestamptz)-interval'1microsecond')at time zone(t->>'timezone'))::date;
 if window_day>=local_day then return p_computed+make_interval(secs=>state.current_interval_seconds);end if;
 return(case when local_computed::time<time'08:00'then local_computed::date+time'08:00'
  when local_computed::time<time'20:00'then local_computed::date+time'20:00'
  else local_computed::date+1+time'08:00'end)at time zone(t->>'timezone');
end;$due$;
revoke all on function private.prepared_aggregate_scheduled_due(jsonb,jsonb,timestamptz,timestamptz)from public,anon,authenticated,service_role;

-- Replace the previous unfiltered directory loop. Reuse the same entry point,
-- schedule state, queue, native identities, workers, fences and admission limits.
create or replace function private.prepared_aggregate_prewarm(p_now timestamptz default now())returns jsonb language plpgsql volatile set search_path=''as $warm$
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
   q:=jsonb_build_object('action','aggregate','view','providers','platformId',t->>'id','startAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'endAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successStartAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'successEndAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successBasis',case when t->>'source'='duoli'then'source_updated'else'success'end,'direction','all','status','all','currency',t->>'currency','offset',0,'limit',20);
   if private.prepared_aggregate_request_reason(q,t)is not null then unsupported:=unsupported+1;continue;end if;
   baseq:=private.prepared_aggregate_base_request(q,t,p_now);k:=private.prepared_aggregate_key(baseq,t);
   select *into job from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   -- Do not change an already claimed job, even if a rollout changes dependency.
   if job.status='running'and job.lease_until>clock_timestamp()then continue;end if;
   admitted:=private.prepared_aggregate_enqueue(baseq,t,dep,(10-offset_day)::smallint);
   if admitted is not null then jobs:=jobs+1;end if;
   perform private.prepared_aggregate_retire_replaced(q,t,baseq,dep);n:=n+1;
  end loop;last_id:=(t->>'id')::uuid;
 end loop;
 -- Recently used exact/custom windows retain their own keys and do not borrow a
 -- default day. Refresh only approved native identities; running/failed states
 -- are never reset here. Stable computedAt determines the next planned slot.
 for job in select j.*from private.prepared_aggregate_jobs j where j.status='ready'and j.last_requested_at>p_now-interval'24hours'
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
end;$warm$;

DO $patch$DECLARE spec jsonb;definition text;before_meta jsonb;after_meta jsonb;BEGIN
 FOR spec IN SELECT value FROM jsonb_array_elements($specs$[{"signature":"private.prepared_aggregate_complete(uuid,uuid,bigint,jsonb)","before":"7c644384d4120c8f0c7f5546cae18354","from":"next_due_at=expires-interval'2minutes'","to":"next_due_at=coalesce(private.prepared_aggregate_scheduled_due(j.request,j.target,computed,computed),expires-interval'2minutes')"},{"signature":"private.prepared_aggregate_base_request(jsonb,jsonb,timestamptz)","before":"e00ba5572ef6e4d0986af2099a4b7124","from":"if t->>'scope_group'='IN'and greatest(","to":"if greatest("}]$specs$::jsonb)LOOP
 SELECT pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'INTO definition,before_meta FROM pg_proc p WHERE p.oid=to_regprocedure(spec->>'signature')AND md5(prosrc)=spec->>'before';
 IF definition IS NULL OR(length(definition)-length(replace(definition,spec->>'from','')))/length(spec->>'from')<>1 THEN RAISE EXCEPTION 'prepared_cadence_patch_anchor_drift: %',spec->>'signature';END IF;
 EXECUTE replace(definition,spec->>'from',spec->>'to');
 SELECT to_jsonb(p)-'prosrc'INTO after_meta FROM pg_proc p WHERE p.oid=to_regprocedure(spec->>'signature');
 IF before_meta IS DISTINCT FROM after_meta THEN RAISE EXCEPTION 'prepared_cadence_patch_metadata_drift';END IF;
 END LOOP;
END;$patch$;
COMMIT;
