do $guard$
begin
 if exists(select 1 from(values
 ('private.withdraw_prepared_claim()','e2b6616eff39a49cf9d2834f4d51ad0a'),
 ('private.withdraw_prepared_prepare_claim(text)','a906ee8562735dcc1c06e839d50dedaa'),
 ('private.shared_worker_priority_contract_current()','a29029ab6d0cfc916516e2a7c2adf541')
 )e(signature,hash)left join pg_proc p on p.oid=to_regprocedure(e.signature)
 where p.oid is null or md5(p.prosrc)<>e.hash or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proacl::text is distinct from'{postgres=X/postgres}'or p.proconfig is distinct from array['search_path=""']
  or p.prosecdef or p.provolatile<>case when p.proname='shared_worker_priority_contract_current'then's'else'v'end
  or p.prorettype<>case when p.proname='shared_worker_priority_contract_current'then'bool'::regtype else'jsonb'::regtype end
  or p.proparallel<>'u'or p.proisstrict or p.proleakproof or p.proretset or p.procost<>100 or p.prorows<>0)
 then raise exception'withdraw_stage_priority_drift';end if;
end;$guard$;
-- Scheduling only: immutable source checkpoints, source expiry, attempts,
-- native validation, shared locks and publication rules remain unchanged.
create temporary table withdraw_priority_guard as
 select 'withdraw'::text name,to_jsonb(private.withdraw_prepared_dependency())value
 union all select 'commons',jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))from unnest(array['IN','ID','BR','MX','CL','CO'])scope
 union all select p.proname,to_jsonb(p)-'prosrc'from pg_proc p where p.oid in('private.withdraw_prepared_claim()'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.shared_worker_priority_contract_current()'::regprocedure);

create function private.dashboard_withdraw_priority_at(j private.withdraw_prepared_jobs,p_at timestamptz)
returns timestamptz language plpgsql stable set search_path=''as $function$
declare b private.withdraw_prepared_builds%rowtype;done_count bigint;pending_count bigint;valid boolean;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_prepared_worker_denied';end if;
 if j.status not in('queued','failed')or j.attempts>=3 or j.not_before>p_at or not isfinite(p_at)then return null;end if;
 if j.request_key->>0='withdraw-reasons-blocking-v1'then
  if jsonb_typeof(j.scope->'humanRequestedAt')='string'and length(j.scope->>'humanRequestedAt')<=40
   and(j.scope->>'humanRequestedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+-][0-9]{2}:[0-9]{2}|Z)$'
   and pg_input_is_valid(j.scope->>'humanRequestedAt','timestamp with time zone')then
   if(j.scope->>'humanRequestedAt')::timestamptz between p_at-interval'2minutes'and p_at then return(j.scope->>'humanRequestedAt')::timestamptz;end if;
  end if;return null;
 end if;
 if j.request_key->>0 is distinct from'withdraw-independent-windows-v2'
  or j.interactive_requested_at is null or not isfinite(j.interactive_requested_at)
  or j.interactive_requested_at>p_at then return null;end if;
 if j.interactive_requested_at>=p_at-interval'2minutes'then return j.interactive_requested_at;end if;
 -- A real first interaction is mandatory. A background-only build cannot
 -- enter this lane. Both clocks are fixed; neither polling nor claims renew it.
 if j.interactive_requested_at<p_at-interval'10minutes'then return null;end if;
 select x.*into b from private.withdraw_prepared_builds x where x.job_id=j.id
  and x.revision=j.revision and x.dependency=j.dependency and x.request=j.request and x.scope=j.scope and x.catalog=j.catalog
  and x.created_at between p_at-interval'10minutes'and p_at;
 if not found then return null;end if;
 if j.request_key is distinct from jsonb_build_array('withdraw-independent-windows-v2',j.scope,j.catalog,j.request)
  or b.dependency is distinct from private.withdraw_prepared_dependency()
  or b.manifest is distinct from private.withdraw_prepared_stage_plan(j.request)
  or not private.withdraw_prepared_catalog_current(j.catalog)or not private.withdraw_prepared_source_contract_current()then return null;end if;
 select count(*)filter(where p.status='done'),count(*)filter(where p.status='pending'),
  bool_and(case when p.status='done'then p.source_at is not null and p.expires_at is not null
   and isfinite(p.source_at)and isfinite(p.expires_at)and p.source_at between b.created_at and p_at
   and p.expires_at>p_at else p.status in('pending','split')end)
 into done_count,pending_count,valid from private.withdraw_prepared_parts p where p.build_id=b.id;
 if done_count=0 or pending_count=0 or valid is distinct from true then return null;end if;
 return least(j.interactive_requested_at,b.created_at);
end;$function$;
revoke all on function private.dashboard_withdraw_priority_at(private.withdraw_prepared_jobs,timestamptz)from public,anon,authenticated,service_role;

create function private.dashboard_withdraw_first_interaction()
returns trigger language plpgsql set search_path=''as $function$
begin
 if new.request_key->>0 is distinct from'withdraw-independent-windows-v2'then return new;end if;
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_prepared_worker_denied';end if;
 if new.status='ready'or(new.status='failed'and new.attempts>=3)
  or new.revision is distinct from old.revision or new.dependency is distinct from old.dependency
  or new.request_key is distinct from old.request_key then new.interactive_requested_at:=null;
 elsif old.status='ready'then new.interactive_requested_at:=null;
 elsif old.interactive_requested_at is not null then new.interactive_requested_at:=old.interactive_requested_at;
 end if;
 return new;
end;$function$;
revoke all on function private.dashboard_withdraw_first_interaction()from public,anon,authenticated,service_role;
create trigger dashboard_withdraw_first_interaction before update on private.withdraw_prepared_jobs
 for each row execute function private.dashboard_withdraw_first_interaction();

-- The three exact production definitions below are generated from pinned
-- originals. Only priority selection changes; claim and lane accounting stay.


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
 ORDER BY CASE WHEN streak>=2 THEN 1-(CASE WHEN private.dashboard_withdraw_priority_at(withdraw_prepared_jobs,statement_timestamp())IS NOT NULL THEN 0 ELSE 1 END)ELSE(CASE WHEN private.dashboard_withdraw_priority_at(withdraw_prepared_jobs,statement_timestamp())IS NOT NULL THEN 0 ELSE 1 END)END,
  not_before,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN null;END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='source_contract_changed'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='obsolete_catalog'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.prepared_aggregate_take_turn('prepared')THEN RETURN null;END IF;
 -- Classify only the selected row after all existing eligibility/turn
 -- gates. No job, a busy lane, failed guards or no turn consumes no priority.
 SELECT (CASE WHEN private.dashboard_withdraw_priority_at(withdraw_prepared_jobs,statement_timestamp())IS NOT NULL THEN 0 ELSE 1 END)=0 INTO is_interactive FROM private.withdraw_prepared_jobs WHERE id=j.id;
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
   SELECT w.id,private.dashboard_withdraw_priority_at(w,statement_timestamp()) INTO wj,wm FROM private.withdraw_prepared_jobs w
    WHERE w.status IN('queued','failed')AND w.attempts<3 AND w.not_before<=clock_timestamp()AND private.dashboard_withdraw_priority_at(w,statement_timestamp()) IS NOT NULL ORDER BY private.dashboard_withdraw_priority_at(w,statement_timestamp()),w.not_before,w.created_at
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
 and md5(p.prosrc)='1a40e27e0b93bdb2de8185752e92b2a3'and md5(pg_get_functiondef(p.oid))='01a4b7a83fbe677ddf3ea19f49e3b71b'
 and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}')
 AND exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepared_aggregate_take_turn(text)')
 and md5(p.prosrc)='caa20e37e580b5a206c12ce8ed0b883b'and md5(pg_get_functiondef(p.oid))='e97499cc84102c37cd0b443f9caeaf40'
 and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}')
 AND exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepared_aggregate_prepare_claim(text)')
 and md5(p.prosrc)='4e7d5d7f00b006d2fd5bb5e7c37b59c8'and md5(pg_get_functiondef(p.oid))='e3e5932e070a16ac10e8f9e35d3c8739'
 and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}') AND exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_withdraw_priority_at(private.withdraw_prepared_jobs,timestamp with time zone)')
 and md5(p.prosrc)='133d3e3d7b313600bdd0bd30f7d5cc6f'and pg_get_userbyid(p.proowner)='postgres'
 and p.proacl::text='{postgres=X/postgres}'and p.proconfig=array['search_path=""']and not p.prosecdef
 and p.proparallel='u'and not p.proisstrict and not p.proleakproof and not p.proretset and p.procost=100 and p.prorows=0
 and p.provolatile=case when p.proname='dashboard_withdraw_priority_at'then's'else'v'end
 and p.prorettype=case when p.proname='dashboard_withdraw_priority_at'then'timestamptz'::regtype else'trigger'::regtype end
 and p.prolang=(select oid from pg_language where lanname='plpgsql'))
 AND exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_withdraw_first_interaction()')
 and md5(p.prosrc)='0109c1b4d84e734d0ef9702274c485a8'and pg_get_userbyid(p.proowner)='postgres'
 and p.proacl::text='{postgres=X/postgres}'and p.proconfig=array['search_path=""']and not p.prosecdef
 and p.proparallel='u'and not p.proisstrict and not p.proleakproof and not p.proretset and p.procost=100 and p.prorows=0
 and p.provolatile=case when p.proname='dashboard_withdraw_priority_at'then's'else'v'end
 and p.prorettype=case when p.proname='dashboard_withdraw_priority_at'then'timestamptz'::regtype else'trigger'::regtype end
 and p.prolang=(select oid from pg_language where lanname='plpgsql'))
 AND exists(select 1 from pg_trigger t where t.tgrelid='private.withdraw_prepared_jobs'::regclass and t.tgname='dashboard_withdraw_first_interaction'and t.tgenabled='O'and not t.tgisinternal and t.tgtype=19 and t.tgnargs=0 and t.tgattr=''::int2vector and t.tgqual is null and t.tgfoid='private.dashboard_withdraw_first_interaction()'::regprocedure)
;
$function$;

do $verify$
begin
 if(select value from pg_temp.withdraw_priority_guard where name='withdraw')is distinct from to_jsonb(private.withdraw_prepared_dependency())then raise exception'withdraw_stage_priority_dependency_changed';end if;
 if(select value from pg_temp.withdraw_priority_guard where name='commons')is distinct from(select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))from unnest(array['IN','ID','BR','MX','CL','CO'])scope)then raise exception'withdraw_stage_priority_common_changed';end if;
 if exists(select 1 from pg_temp.withdraw_priority_guard g join pg_proc p on p.proname=g.name and p.pronamespace='private'::regnamespace where g.name not in('commons','withdraw')and g.value is distinct from to_jsonb(p)-'prosrc')then raise exception'withdraw_stage_priority_security_changed';end if;
 if not private.shared_worker_priority_contract_current()then raise exception'withdraw_stage_priority_contract_invalid';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role'])r cross join unnest(array[
 'private.dashboard_withdraw_priority_at(private.withdraw_prepared_jobs,timestamp with time zone)',
 'private.dashboard_withdraw_first_interaction()'])f where has_function_privilege(r,f,'EXECUTE'))then raise exception'withdraw_stage_priority_external_grant';end if;
end;$verify$;
drop table pg_temp.withdraw_priority_guard;
