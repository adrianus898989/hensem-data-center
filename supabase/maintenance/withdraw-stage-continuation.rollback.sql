-- Restore exact selectors only. Jobs, parts, immutable heads, marker values and
-- all source/failure data remain in place. Later edits require a fresh review.
do $guard$
begin
 if exists(select 1 from(values
 ('private.withdraw_prepared_claim()','1a40e27e0b93bdb2de8185752e92b2a3','v'),
 ('private.withdraw_prepared_prepare_claim(text)','49b05909f92c7e45ae497f64cd8bc9ef','v'),
 ('private.shared_worker_priority_contract_current()','736081f304b289c4df42249cca6d9cb4','s'),
 ('private.dashboard_withdraw_priority_at(private.withdraw_prepared_jobs,timestamptz)','133d3e3d7b313600bdd0bd30f7d5cc6f','s'),
 ('private.dashboard_withdraw_first_interaction()','0109c1b4d84e734d0ef9702274c485a8','v')
 )e(signature,hash,volatility)left join pg_proc p on p.oid=to_regprocedure(e.signature)
 where p.oid is null or md5(p.prosrc)<>e.hash or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proacl::text is distinct from'{postgres=X/postgres}'or p.proconfig is distinct from array['search_path=""']
  or p.prosecdef or p.proparallel<>'u'or p.proisstrict or p.proleakproof or p.proretset or p.procost<>100 or p.prorows<>0 or p.provolatile::text<>e.volatility)
 or not exists(select 1 from pg_trigger t where t.tgrelid='private.withdraw_prepared_jobs'::regclass and t.tgname='dashboard_withdraw_first_interaction'and t.tgenabled='O'and not t.tgisinternal and t.tgtype=19 and t.tgnargs=0 and t.tgattr=''::int2vector and t.tgqual is null and t.tgfoid='private.dashboard_withdraw_first_interaction()'::regprocedure)
 then raise exception'withdraw_stage_priority_rollback_drift';end if;
end;$guard$;
create temporary table withdraw_priority_rollback_guard as
 select 'withdraw'::text name,to_jsonb(private.withdraw_prepared_dependency())value
 union all select 'commons',jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))from unnest(array['IN','ID','BR','MX','CL','CO'])scope
 union all select p.proname,to_jsonb(p)-'prosrc'from pg_proc p where p.oid in('private.withdraw_prepared_claim()'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.shared_worker_priority_contract_current()'::regprocedure);
CREATE OR REPLACE FUNCTION private.withdraw_prepared_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE j private.withdraw_prepared_jobs%rowtype;started timestamptz;streak integer;is_interactive boolean;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,last_error='lease_expired',not_before=clock_timestamp()+interval'1minute'WHERE status='running'AND lease_until<=clock_timestamp();
 -- This row is already locked by prepare_claim in the ordinary worker
 -- path. The shared advisory lock also serializes owner-only direct claims.
 SELECT interactive_streak INTO streak FROM private.withdraw_prepared_scheduler WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RETURN null;END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()
 ORDER BY CASE WHEN streak>=2 THEN 1-(CASE WHEN request_key->>0='withdraw-independent-windows-v2'
  AND interactive_requested_at BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
  THEN 0 ELSE CASE WHEN request_key->>0='withdraw-reasons-blocking-v1'
  AND jsonb_typeof(scope->'humanRequestedAt')='string'
  AND length(scope->>'humanRequestedAt')<=40
  AND(scope->>'humanRequestedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+-][0-9]{2}:[0-9]{2}|Z)$'
  AND pg_input_is_valid(scope->>'humanRequestedAt','timestamp with time zone')
  THEN CASE WHEN(scope->>'humanRequestedAt')::timestamptz BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()THEN 0 ELSE 1 END
  ELSE 1 END END)ELSE(CASE WHEN request_key->>0='withdraw-independent-windows-v2'
  AND interactive_requested_at BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
  THEN 0 ELSE CASE WHEN request_key->>0='withdraw-reasons-blocking-v1'
  AND jsonb_typeof(scope->'humanRequestedAt')='string'
  AND length(scope->>'humanRequestedAt')<=40
  AND(scope->>'humanRequestedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+-][0-9]{2}:[0-9]{2}|Z)$'
  AND pg_input_is_valid(scope->>'humanRequestedAt','timestamp with time zone')
  THEN CASE WHEN(scope->>'humanRequestedAt')::timestamptz BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()THEN 0 ELSE 1 END
  ELSE 1 END END)END,
  not_before,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN null;END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='source_contract_changed'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='obsolete_catalog'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.prepared_aggregate_take_turn('prepared')THEN RETURN null;END IF;
 -- Classify only the selected row after all existing eligibility/turn
 -- gates. No job, a busy lane, failed guards or no turn consumes no priority.
 SELECT (CASE WHEN request_key->>0='withdraw-independent-windows-v2'
  AND interactive_requested_at BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
  THEN 0 ELSE CASE WHEN request_key->>0='withdraw-reasons-blocking-v1'
  AND jsonb_typeof(scope->'humanRequestedAt')='string'
  AND length(scope->>'humanRequestedAt')<=40
  AND(scope->>'humanRequestedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+-][0-9]{2}:[0-9]{2}|Z)$'
  AND pg_input_is_valid(scope->>'humanRequestedAt','timestamp with time zone')
  THEN CASE WHEN(scope->>'humanRequestedAt')::timestamptz BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()THEN 0 ELSE 1 END
  ELSE 1 END END)=0 INTO is_interactive FROM private.withdraw_prepared_jobs WHERE id=j.id;
 SELECT backend_start INTO started FROM pg_stat_activity WHERE pid=pg_backend_pid();
 UPDATE private.withdraw_prepared_jobs SET status='running',fence=fence+1,run_id=gen_random_uuid(),attempts=attempts+1,lease_until=clock_timestamp()+interval'120seconds',claim_pid=pg_backend_pid(),claim_backend_start=started,interactive_requested_at=NULL WHERE id=j.id RETURNING *INTO j;
 UPDATE private.withdraw_prepared_scheduler SET interactive_streak=CASE WHEN is_interactive THEN least(streak+1,2)ELSE 0 END WHERE singleton;
 RETURN jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence);
END;$function$;
CREATE OR REPLACE FUNCTION private.withdraw_prepared_prepare_claim(p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE family text;c jsonb;base_turn boolean;
 lane private.prepared_aggregate_worker_turn%rowtype;
 aj uuid;wj uuid;am timestamptz;wm timestamptz;withdraw_streak smallint;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_claim_deadline_required';END IF;
 PERFORM set_config('daily_provider_base.claim','',false);
 PERFORM set_config('withdraw_prepared.claim','',false);PERFORM set_config('withdraw_prepared.family','',false);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;

 -- All decisions below remain inside the original claim advisory lock.
 -- Lock a genuine eligible marked row before temporarily selecting its family.
 -- The unchanged inner claim still owns native checks, run/fence and lease.
 IF EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())
 OR EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 SELECT *INTO lane FROM private.prepared_aggregate_worker_turn WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RETURN null;END IF;
 IF lane.lane_interactive_streak<2 AND private.shared_worker_priority_contract_current()THEN
  SELECT a.id,a.interactive_requested_at INTO aj,am FROM private.prepared_aggregate_jobs a
   WHERE a.status IN('queued','failed')AND a.attempts<3 AND a.not_before<=clock_timestamp()AND a.interactive_requested_at BETWEEN statement_timestamp()-interval'20minutes'AND statement_timestamp() ORDER BY a.interactive_requested_at,a.not_before,a.created_at
   FOR UPDATE OF a SKIP LOCKED LIMIT 1;
  IF EXISTS(SELECT 1 FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled)THEN
   SELECT w.id,(CASE WHEN w.request_key->>0='withdraw-independent-windows-v2'
 AND w.interactive_requested_at BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
 THEN w.interactive_requested_at
 WHEN w.request_key->>0='withdraw-reasons-blocking-v1'
 AND jsonb_typeof(w.scope->'humanRequestedAt')='string'
 AND length(w.scope->>'humanRequestedAt')<=40
 AND(w.scope->>'humanRequestedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+-][0-9]{2}:[0-9]{2}|Z)$'
 AND pg_input_is_valid(w.scope->>'humanRequestedAt','timestamp with time zone')
 THEN CASE WHEN(w.scope->>'humanRequestedAt')::timestamptz BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
 THEN(w.scope->>'humanRequestedAt')::timestamptz END END) INTO wj,wm FROM private.withdraw_prepared_jobs w
    WHERE w.status IN('queued','failed')AND w.attempts<3 AND w.not_before<=clock_timestamp()AND (CASE WHEN w.request_key->>0='withdraw-independent-windows-v2'
 AND w.interactive_requested_at BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
 THEN w.interactive_requested_at
 WHEN w.request_key->>0='withdraw-reasons-blocking-v1'
 AND jsonb_typeof(w.scope->'humanRequestedAt')='string'
 AND length(w.scope->>'humanRequestedAt')<=40
 AND(w.scope->>'humanRequestedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+-][0-9]{2}:[0-9]{2}|Z)$'
 AND pg_input_is_valid(w.scope->>'humanRequestedAt','timestamp with time zone')
 THEN CASE WHEN(w.scope->>'humanRequestedAt')::timestamptz BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
 THEN(w.scope->>'humanRequestedAt')::timestamptz END END) IS NOT NULL ORDER BY (CASE WHEN w.request_key->>0='withdraw-independent-windows-v2'
 AND w.interactive_requested_at BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
 THEN w.interactive_requested_at
 WHEN w.request_key->>0='withdraw-reasons-blocking-v1'
 AND jsonb_typeof(w.scope->'humanRequestedAt')='string'
 AND length(w.scope->>'humanRequestedAt')<=40
 AND(w.scope->>'humanRequestedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+-][0-9]{2}:[0-9]{2}|Z)$'
 AND pg_input_is_valid(w.scope->>'humanRequestedAt','timestamp with time zone')
 THEN CASE WHEN(w.scope->>'humanRequestedAt')::timestamptz BETWEEN statement_timestamp()-interval'2minutes'AND statement_timestamp()
 THEN(w.scope->>'humanRequestedAt')::timestamptz END END),w.not_before,w.created_at
    FOR UPDATE OF w SKIP LOCKED LIMIT 1;
  END IF;
  IF aj IS NOT NULL OR wj IS NOT NULL THEN
   family:=CASE WHEN aj IS NOT NULL AND(wj IS NULL OR am<=wm)THEN'payment'ELSE'withdraw'END;
   -- A row locked above guarantees the chosen family has a waiting candidate.
   -- Reset only its inner priority selector for this bounded attempt, restoring
   -- original accounting afterwards. No job state or financial key is changed.
   UPDATE private.prepared_aggregate_worker_turn SET next_kind='prepared',waiting_since=null,
    interactive_streak=CASE WHEN family='payment'THEN 0 ELSE lane.interactive_streak END WHERE singleton;
   IF family='payment'THEN c:=private.prepared_aggregate_prepare_claim(p_worker);
   ELSE
    SELECT interactive_streak INTO withdraw_streak FROM private.withdraw_prepared_scheduler WHERE singleton FOR UPDATE;
    UPDATE private.withdraw_prepared_scheduler SET interactive_streak=0 WHERE singleton;
    c:=private.withdraw_prepared_claim();
    UPDATE private.withdraw_prepared_scheduler SET interactive_streak=CASE WHEN c IS NULL THEN withdraw_streak ELSE least(withdraw_streak+1,2)END WHERE singleton;
   END IF;
   IF c IS NOT NULL THEN
    UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=lane.lane_interactive_streak+1,
     next_kind=lane.next_kind,waiting_since=lane.waiting_since,lane_waiting_since=null,interactive_streak=CASE WHEN family='payment'THEN least(lane.interactive_streak+1,2)ELSE lane.interactive_streak END WHERE singleton;
    PERFORM set_config('withdraw_prepared.family',family,false);
    IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
    -- Preserve next_kind/next_base/next_family: burst service cannot erase an owed normal
    -- background turn. The third service follows the original rotation below.
    RETURN c;
   END IF;
   UPDATE private.prepared_aggregate_worker_turn SET next_kind=lane.next_kind,waiting_since=lane.waiting_since,
    interactive_streak=lane.interactive_streak WHERE singleton;
  END IF;
 END IF;
 SELECT next_base INTO base_turn FROM private.daily_provider_base_scheduler WHERE singleton FOR UPDATE;
 IF base_turn AND EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()AND priority>=100)THEN
  c:=private.daily_provider_base_claim();
  IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton;
   PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);
   UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;RETURN c;
  END IF;
 END IF;
 SELECT next_family INTO family FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled FOR UPDATE;
 IF NOT FOUND THEN family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('withdraw_prepared.family','payment',false);UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;ELSE c:=private.daily_provider_base_claim();IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;END IF;RETURN c;END IF;
 IF family='withdraw'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())THEN
  c:=private.withdraw_prepared_claim();
 ELSE family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);END IF;
 IF c IS NULL AND family='payment'THEN family:='withdraw';c:=private.withdraw_prepared_claim();END IF;
 IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton;
  PERFORM set_config('withdraw_prepared.family',family,false);IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
  UPDATE private.withdraw_prepared_scheduler SET next_family=CASE family WHEN'withdraw'THEN'payment'ELSE'withdraw'END WHERE singleton;
  UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;
 END IF;
 IF c IS NULL THEN
  c:=private.daily_provider_base_claim();
  IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;
 END IF;RETURN c;
END;$function$;
CREATE OR REPLACE FUNCTION private.shared_worker_priority_contract_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT current_user='postgres'AND exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepared_aggregate_claim(text)')
 and md5(p.prosrc)='f217fa74665373642403b2217c3132aa'and md5(pg_get_functiondef(p.oid))='30173300ed9ba1ca18af14b5438cfb42'
 and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}')
 AND exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.withdraw_prepared_claim()')
 and md5(p.prosrc)='e2b6616eff39a49cf9d2834f4d51ad0a'and md5(pg_get_functiondef(p.oid))='ab19943c4d526c162debd474ec3cd90a'
 and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}')
 AND exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepared_aggregate_take_turn(text)')
 and md5(p.prosrc)='caa20e37e580b5a206c12ce8ed0b883b'and md5(pg_get_functiondef(p.oid))='e97499cc84102c37cd0b443f9caeaf40'
 and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}')
 AND exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepared_aggregate_prepare_claim(text)')
 and md5(p.prosrc)='4e7d5d7f00b006d2fd5bb5e7c37b59c8'and md5(pg_get_functiondef(p.oid))='e3e5932e070a16ac10e8f9e35d3c8739'
 and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}');
$function$;
drop trigger dashboard_withdraw_first_interaction on private.withdraw_prepared_jobs;
drop function private.dashboard_withdraw_first_interaction();
drop function private.dashboard_withdraw_priority_at(private.withdraw_prepared_jobs,timestamptz);
do $verify$
begin
 if(select value from pg_temp.withdraw_priority_rollback_guard where name='withdraw')is distinct from to_jsonb(private.withdraw_prepared_dependency())then raise exception'withdraw_stage_priority_rollback_dependency_changed';end if;
 if(select value from pg_temp.withdraw_priority_rollback_guard where name='commons')is distinct from(select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))from unnest(array['IN','ID','BR','MX','CL','CO'])scope)then raise exception'withdraw_stage_priority_rollback_common_changed';end if;
 if exists(select 1 from pg_temp.withdraw_priority_rollback_guard g join pg_proc p on p.proname=g.name and p.pronamespace='private'::regnamespace where g.name not in('commons','withdraw')and g.value is distinct from to_jsonb(p)-'prosrc')then raise exception'withdraw_stage_priority_rollback_security_changed';end if;
 if not private.shared_worker_priority_contract_current()then raise exception'withdraw_stage_priority_rollback_contract_invalid';end if;
end;$verify$;
drop table pg_temp.withdraw_priority_rollback_guard;
