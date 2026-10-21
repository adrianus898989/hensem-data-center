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

CREATE OR REPLACE FUNCTION private.prepared_aggregate_claim(p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.prepared_aggregate_jobs%rowtype;started timestamptz;streak smallint;is_interactive boolean;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if p_worker is null or length(p_worker)not between 1 and 80 or p_worker~'[[:cntrl:]]'then raise exception using errcode='22023',message='invalid_worker';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;
 if exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())
 or exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 update private.prepared_aggregate_jobs set status='failed',last_error='lease_expired',not_before=clock_timestamp()+interval'1minute',lease_until=null where status='running'and lease_until<=clock_timestamp();
 -- Same advisory lock and turn row as the existing one-writer lane.
 -- At most two waiting interactive jobs precede one due background job.
 select interactive_streak into streak from private.prepared_aggregate_worker_turn where singleton for update;
 if not found then return null;end if;
 select *into j from private.prepared_aggregate_jobs where status in('queued','failed')and not_before<=clock_timestamp()and attempts<3
 order by case when streak>=2 then case when coalesce((interactive_requested_at between statement_timestamp()-interval'20minutes'and statement_timestamp()),false)then 1 else 0 end
  else case when coalesce((interactive_requested_at between statement_timestamp()-interval'20minutes'and statement_timestamp()),false)then 0 else 1 end end,
  priority+least(60,floor(extract(epoch from(clock_timestamp()-not_before))/15))desc,not_before,created_at for update skip locked limit 1;
 if not found then return null;end if;
 if not private.prepared_aggregate_target_current(j.target)then update private.prepared_aggregate_jobs set status='failed',attempts=3,last_error='obsolete_target'where id=j.id;return null;end if;
 if not private.prepared_aggregate_take_turn('prepared')then return null;end if;
 -- A denied turn, invalid target or occupied lane consumes no marker.
 is_interactive:=coalesce(j.interactive_requested_at between statement_timestamp()-interval'20minutes'and statement_timestamp(),false);
 select backend_start into started from pg_stat_activity where pid=pg_backend_pid();
 update private.prepared_aggregate_jobs set status='running',fence=fence+1,run_id=gen_random_uuid(),lease_until=clock_timestamp()+interval'120seconds',attempts=attempts+1,worker=p_worker,claim_pid=pg_backend_pid(),claim_backend_start=started,interactive_requested_at=null where id=j.id returning *into j;
 update private.prepared_aggregate_worker_turn set interactive_streak=case when is_interactive then least(streak+1,2)else 0 end where singleton;
 return jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence,'revision',j.revision);
end;$function$;

CREATE OR REPLACE FUNCTION private.prepared_aggregate_prepare_claim(p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j jsonb;budget interval:=current_setting('statement_timeout')::interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if budget<=interval'0seconds'or budget>interval'3seconds'then raise exception using errcode='22023',message='prepared_claim_deadline_required';end if;
 perform set_config('prepared_aggregate.claim','',false);j:=private.prepared_aggregate_claim(p_worker);
 if j is not null then perform set_config('prepared_aggregate.claim',j::text,false);end if;return j;
end;$function$;

CREATE OR REPLACE FUNCTION private.prepared_aggregate_take_turn(p_kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare turn private.prepared_aggregate_worker_turn%rowtype;other_due boolean;
begin
 if current_user<>'postgres'or p_kind not in('provider','prepared')then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 -- Both callers already hold provider_snapshot_claim_v1 and have selected a
 -- runnable task. Only a successful grant advances the alternating turn.
 select *into turn from private.prepared_aggregate_worker_turn where singleton for update;
 if turn.next_kind is not null and turn.next_kind<>p_kind then
  if p_kind='provider'then
   select exists(select 1 from private.prepared_aggregate_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp())into other_due;
  else
   select exists(select 1 from private.provider_snapshot_jobs q join private.provider_snapshot_targets t on t.target=q.target and t.enabled
    where q.status in('queued','failed')and q.attempts<3 and q.not_before<=clock_timestamp()
    and(not exists(select 1 from private.provider_snapshot_cohort_jobs cj where cj.job_id=q.id)or exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_cohorts c on c.id=cj.cohort_id where cj.job_id=q.id and c.status='building')))into other_due;
  end if;
  -- Let the other one-second scheduler claim first. If it is unavailable,
  -- bounded fallback avoids indefinitely stalling a healthy scheduler.
  if other_due and(turn.waiting_since is null or turn.waiting_since>clock_timestamp()-interval'3seconds')then
   update private.prepared_aggregate_worker_turn set waiting_since=coalesce(waiting_since,clock_timestamp())where singleton;return false;
  end if;
 end if;
 update private.prepared_aggregate_worker_turn set next_kind=case p_kind when'provider'then'prepared'else'provider'end,waiting_since=null where singleton;
 return true;
end;$function$;
