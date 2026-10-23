begin;
set local statement_timeout='15s';
set local lock_timeout='500ms';
do $guard$declare e jsonb;a jsonb;begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='worker_eligibility_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('worker_eligibility_deploy_v1',0))then raise exception'worker_eligibility_deploy_busy';end if;
 for e in select value from jsonb_array_elements($meta$[{"identity":"private.prepared_aggregate_claim(text)","body_md5":"f217fa74665373642403b2217c3132aa","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_worker text","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_prepare_claim(text)","body_md5":"4e7d5d7f00b006d2fd5bb5e7c37b59c8","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_worker text","result":"jsonb","language":"plpgsql"},{"identity":"private.provider_snapshot_claim(text,integer)","body_md5":"4c8aef6bac0f4ff6a8f3ef8c92e6d6c7","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_worker text, p_lease_seconds integer DEFAULT 120","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_take_turn(text)","body_md5":"caa20e37e580b5a206c12ce8ed0b883b","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_kind text","result":"boolean","language":"plpgsql"},{"identity":"private.withdraw_prepared_claim()","body_md5":"1a40e27e0b93bdb2de8185752e92b2a3","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"","result":"jsonb","language":"plpgsql"},{"identity":"private.daily_provider_base_claim()","body_md5":"c0bd5fd60a5b4d2bb35cfec5c1ae8dea","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"","result":"jsonb","language":"plpgsql"},{"identity":"private.withdraw_prepared_prepare_claim(text)","body_md5":"49b05909f92c7e45ae497f64cd8bc9ef","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_worker text","result":"jsonb","language":"plpgsql"}]$meta$::jsonb)loop
 select jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'language',l.lanname)into a from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'identity');
 if a is distinct from e then raise exception'worker_eligibility_baseline_drift:%',e->>'identity';end if;end loop;
end;$guard$;
do $absent$begin if to_regprocedure('private.withdraw_prepared_family_claim(text,text)')is not null or exists(select 1 from cron.job where command like '%withdraw_prepared_family_claim%')then raise exception'worker_eligibility_helper_already_exists';end if;end;$absent$;
create temporary table worker_eligibility_semantics_before on commit drop as with natives as materialized(select to_jsonb(n)target,n.id,n.scope_group from private.prepared_aggregate_native_catalog()n),
 scopes as(select unnest(array['IN','ID','BR','MX','CL','CO'])scope union select scope_group from natives),
 common as materialized(select scope,private.prepared_aggregate_dependency_common(scope)dependency from scopes),
 pieces as(
 select 'common:'||scope k,dependency v from common
 union all select 'native:'||n.id::text,private.prepared_aggregate_dependency(n.target,c.dependency)from natives n join common c on c.scope=n.scope_group
 union all select 'provider:'||t.platform_id::text,private.provider_snapshot_dependency_token(t.target)from private.provider_snapshot_targets t where t.enabled
 union all select 'withdraw',private.withdraw_prepared_dependency()
 union all select 'base',private.daily_provider_base_reuse_semantics()
 )select k,v from pieces;
do $nonempty$begin if not exists(select 1 from worker_eligibility_semantics_before where k like 'native:%')or not exists(select 1 from worker_eligibility_semantics_before where k like 'provider:%')or exists(select 1 from worker_eligibility_semantics_before where v is null)then raise exception'worker_eligibility_semantics_incomplete';end if;end;$nonempty$;
CREATE OR REPLACE FUNCTION private.withdraw_prepared_family_claim(p_family text, p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE lane private.prepared_aggregate_worker_turn%rowtype;claim jsonb;bypassed boolean:=false;
BEGIN
 IF p_family IS NULL OR p_family NOT IN('payment','withdraw','base')THEN RAISE EXCEPTION USING errcode='22023',message='worker_eligibility_family_invalid';END IF;
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='worker_eligibility_owner_required';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION USING errcode='22023',message='worker_eligibility_deadline_required';END IF;
 -- The original claim and compute lane keep their locks, lease and fencing.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())
 OR EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())
 OR EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())
 OR EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 SELECT *INTO lane FROM private.prepared_aggregate_worker_turn WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RETURN null;END IF;
 -- FALSE is the same definitive refusal used by provider_snapshot_claim.
 -- NULL, future work and other eligibility checks retain original behavior.
 IF lane.next_kind='provider'AND private.provider_snapshot_kernel_contract_current() IS FALSE THEN
  UPDATE private.prepared_aggregate_worker_turn SET next_kind='prepared',waiting_since=null WHERE singleton;
  bypassed:=true;
 END IF;
 CASE p_family
  WHEN 'payment'THEN claim:=private.prepared_aggregate_prepare_claim(p_worker);
  WHEN 'withdraw'THEN claim:=private.withdraw_prepared_claim();
  WHEN 'base'THEN claim:=private.daily_provider_base_claim();
 END CASE;
 IF bypassed AND claim IS NULL THEN
  UPDATE private.prepared_aggregate_worker_turn SET next_kind=lane.next_kind,waiting_since=lane.waiting_since WHERE singleton;
 END IF;
 -- A granted inner claim already sets next_kind back to provider. No lane
 -- accounting is changed here, so a newly valid provider still owns its turn.
 RETURN claim;
END;$function$;

revoke all on function private.withdraw_prepared_family_claim(text,text)from public,anon,authenticated,service_role;
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
  c:=private.withdraw_prepared_family_claim('base',p_worker);
  IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton;
   PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);
   UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;RETURN c;
  END IF;
 END IF;
 SELECT next_family INTO family FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled FOR UPDATE;
 IF NOT FOUND THEN family:='payment';c:=private.withdraw_prepared_family_claim('payment',p_worker);IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('withdraw_prepared.family','payment',false);UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;ELSE c:=private.withdraw_prepared_family_claim('base',p_worker);IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;END IF;RETURN c;END IF;
 IF family='withdraw'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())THEN
  c:=private.withdraw_prepared_family_claim('withdraw',p_worker);
 ELSE family:='payment';c:=private.withdraw_prepared_family_claim('payment',p_worker);END IF;
 IF c IS NULL AND family='payment'THEN family:='withdraw';c:=private.withdraw_prepared_family_claim('withdraw',p_worker);END IF;
 IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton;
  PERFORM set_config('withdraw_prepared.family',family,false);IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
  UPDATE private.withdraw_prepared_scheduler SET next_family=CASE family WHEN'withdraw'THEN'payment'ELSE'withdraw'END WHERE singleton;
  UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;
 END IF;
 IF c IS NULL THEN
  c:=private.withdraw_prepared_family_claim('base',p_worker);
  IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;
 END IF;RETURN c;
END;$function$
;
do $guard$declare e jsonb;a jsonb;begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='worker_eligibility_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('worker_eligibility_deploy_v1',0))then raise exception'worker_eligibility_deploy_busy';end if;
 for e in select value from jsonb_array_elements($meta$[{"identity":"private.prepared_aggregate_claim(text)","body_md5":"f217fa74665373642403b2217c3132aa","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_worker text","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_prepare_claim(text)","body_md5":"4e7d5d7f00b006d2fd5bb5e7c37b59c8","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_worker text","result":"jsonb","language":"plpgsql"},{"identity":"private.provider_snapshot_claim(text,integer)","body_md5":"4c8aef6bac0f4ff6a8f3ef8c92e6d6c7","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_worker text, p_lease_seconds integer DEFAULT 120","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_take_turn(text)","body_md5":"caa20e37e580b5a206c12ce8ed0b883b","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_kind text","result":"boolean","language":"plpgsql"},{"identity":"private.withdraw_prepared_claim()","body_md5":"1a40e27e0b93bdb2de8185752e92b2a3","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"","result":"jsonb","language":"plpgsql"},{"identity":"private.daily_provider_base_claim()","body_md5":"c0bd5fd60a5b4d2bb35cfec5c1ae8dea","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"","result":"jsonb","language":"plpgsql"},{"identity":"private.withdraw_prepared_prepare_claim(text)","body_md5":"418ab35dd4ac8938b66efb507a3b7b76","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_worker text","result":"jsonb","language":"plpgsql"},{"identity":"private.withdraw_prepared_family_claim(text,text)","body_md5":"d8eb230852bd578896132ffed5fad3d1","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_family text, p_worker text","result":"jsonb","language":"plpgsql"}]$meta$::jsonb)loop
 select jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'language',l.lanname)into a from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'identity');
 if a is distinct from e then raise exception'worker_eligibility_installed_drift:%',e->>'identity';end if;end loop;
end;$guard$;
create temporary table worker_eligibility_semantics_after on commit drop as with natives as materialized(select to_jsonb(n)target,n.id,n.scope_group from private.prepared_aggregate_native_catalog()n),
 scopes as(select unnest(array['IN','ID','BR','MX','CL','CO'])scope union select scope_group from natives),
 common as materialized(select scope,private.prepared_aggregate_dependency_common(scope)dependency from scopes),
 pieces as(
 select 'common:'||scope k,dependency v from common
 union all select 'native:'||n.id::text,private.prepared_aggregate_dependency(n.target,c.dependency)from natives n join common c on c.scope=n.scope_group
 union all select 'provider:'||t.platform_id::text,private.provider_snapshot_dependency_token(t.target)from private.provider_snapshot_targets t where t.enabled
 union all select 'withdraw',private.withdraw_prepared_dependency()
 union all select 'base',private.daily_provider_base_reuse_semantics()
 )select k,v from pieces;
do $unchanged$begin if exists((select*from worker_eligibility_semantics_before except select*from worker_eligibility_semantics_after)union all(select*from worker_eligibility_semantics_after except select*from worker_eligibility_semantics_before))then raise exception'worker_eligibility_dependency_changed';end if;end;$unchanged$;
commit;
