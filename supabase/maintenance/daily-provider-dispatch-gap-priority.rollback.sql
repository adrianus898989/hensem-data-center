-- Code-only existing dispatcher gate: only source priority >=100 defers next_base.
-- Existing base/payment/withdraw rotation and fallback are byte-identical.
-- No queue mutations, reset, new worker or changed claim budget.
begin;
set local statement_timeout='8s';set local lock_timeout='500ms';
do $preflight$
declare p pg_proc%rowtype;e jsonb;s jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_dispatch_gap_priority_owner_required';end if;
 select *into p from pg_proc where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure;
 if md5(p.prosrc)is distinct from '783dcbb3399a2e8bdd795e29b5b30dde'or md5(pg_get_functiondef(p.oid))is distinct from 'e4c553d6e4323c24ee402ed5224a23f1'
 or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from $guard${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_prepared_prepare_claim","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_worker"],"proargtypes":["25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$guard$::jsonb
 or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'
 then raise exception'daily_provider_dispatch_gap_priority_helper_cas';end if;

 for e in select value from jsonb_array_elements($guard$[{"signature":"private.daily_provider_base_claim()","body":"3648171d9c60e0664eeb87eac4d7074e","definition":"7e62877a9196809f5c8e7f8b8309e36c"},{"signature":"private.daily_provider_base_enqueue(jsonb)","body":"3e91604fc68dd00b95cc2228465987a0","definition":"5885c2793fe673413574fdd60f509438"},{"signature":"private.daily_provider_base_prewarm(jsonb)","body":"961373610e68a9ffb875aba9bba9bdf6","definition":"6486017965c6b31a3cb8f558b884f7dd"},{"signature":"private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)","body":"9aa3342e3095e492bb9a8c0d5903507e","definition":"732492ecaefd89ac6079dfc3aec2b801"},{"signature":"private.dashboard_admin_daily_provider_prepared_read(text,jsonb)","body":"2d192bb43a5fdfb07230bc8a5f6d859f","definition":"6dccfdb87ea7eef3b7b851eed8f9467b"},{"signature":"private.daily_provider_base_admit_days(jsonb,boolean)","body":"f8d31324b482e07d0e2afa9f1e25b554","definition":"071e6affae9b21beb485546ce8eb7279"},{"signature":"private.withdraw_prepared_run_dispatch(text)","body":"6a4b1983ada38ae912c37f67720bb09c","definition":"613dfb11a3ca89c9ae35dfaa7e2ea5fe"},{"signature":"private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)","body":"a4e4e1a403bf0aa2dc70c7bb7ad4e6c9","definition":"51ab15b2eaedf6e682e9c5fbde1e3da4"},{"signature":"private.prepared_aggregate_read(text,jsonb)","body":"4a38ca3d9bbfbed3cc94250db95064da","definition":"df7914b8375708f883617b3d09265423"},{"signature":"private.prepared_aggregate_claim(text)","body":"f3d8d4bd4c21d52afe39c4149e39f46f","definition":"9a012a03870c50d7285dc78c07982a39"}]$guard$::jsonb)loop
  if not exists(select 1 from pg_proc x where x.oid=to_regprocedure(e->>'signature')and md5(x.prosrc)=e->>'body'and md5(pg_get_functiondef(x.oid))=e->>'definition')then raise exception'daily_provider_dispatch_gap_priority_protected_cas:%',e->>'signature';end if;
 end loop;
 perform set_config('audit.provider_dispatch_gap_priority_helper_meta',(to_jsonb(p)-array['prosrc','prosqlbody'])::text,true);
 select(select jsonb_agg(to_jsonb(snapshot_fn)order by snapshot_fn.oid)from pg_proc snapshot_fn where snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'),to_regprocedure('private.daily_provider_base_admit_days(jsonb,boolean)'),to_regprocedure('private.withdraw_prepared_run_dispatch(text)'),to_regprocedure('private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'),to_regprocedure('private.prepared_aggregate_read(text,jsonb)'),to_regprocedure('private.prepared_aggregate_claim(text)')]))into s;perform set_config('audit.provider_dispatch_gap_priority_functions',s::text,true);
 select(select jsonb_build_object('common',c.value,'targets',(select jsonb_agg(jsonb_build_array(to_jsonb(n),private.prepared_aggregate_dependency(to_jsonb(n),c.value))order by n.id)from private.prepared_aggregate_native_catalog()n where n.team='M8'and n.country='印度'and n.scope_group='IN'and n.source in('ar','newar','kb')))from(select private.prepared_aggregate_dependency_common('IN')value)c)into s;perform set_config('audit.provider_dispatch_gap_priority_dependency',s::text,true);
end;$preflight$;
-- BEGIN dispatcher-gap-priority
CREATE OR REPLACE FUNCTION private.withdraw_prepared_prepare_claim(p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE family text;c jsonb;base_turn boolean;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_claim_deadline_required';END IF;
 PERFORM set_config('daily_provider_base.claim','',false);
 PERFORM set_config('withdraw_prepared.claim','',false);PERFORM set_config('withdraw_prepared.family','',false);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 SELECT next_base INTO base_turn FROM private.daily_provider_base_scheduler WHERE singleton FOR UPDATE;
 IF base_turn AND EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()AND priority>=20)THEN
  c:=private.daily_provider_base_claim();
  IF c IS NOT NULL THEN
   PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);
   UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;RETURN c;
  END IF;
 END IF;
 SELECT next_family INTO family FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled FOR UPDATE;
 IF NOT FOUND THEN family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);IF c IS NOT NULL THEN PERFORM set_config('withdraw_prepared.family','payment',false);UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;ELSE c:=private.daily_provider_base_claim();IF c IS NOT NULL THEN PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;END IF;RETURN c;END IF;
 IF family='withdraw'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())THEN
  c:=private.withdraw_prepared_claim();
 ELSE family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);END IF;
 IF c IS NULL AND family='payment'THEN family:='withdraw';c:=private.withdraw_prepared_claim();END IF;
 IF c IS NOT NULL THEN
  PERFORM set_config('withdraw_prepared.family',family,false);IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
  UPDATE private.withdraw_prepared_scheduler SET next_family=CASE family WHEN'withdraw'THEN'payment'ELSE'withdraw'END WHERE singleton;
  UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;
 END IF;
 IF c IS NULL THEN
  c:=private.daily_provider_base_claim();
  IF c IS NOT NULL THEN PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;
 END IF;RETURN c;
END;$function$;
-- END dispatcher-gap-priority
do $verify$
declare p pg_proc%rowtype;s jsonb;
begin
 select *into p from pg_proc where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure;
 if md5(p.prosrc)is distinct from '174aa423474363e135adeefa80530740'or md5(pg_get_functiondef(p.oid))is distinct from '664f6398837318c8e178983b83d55b1a'
 or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from $guard${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_prepared_prepare_claim","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_worker"],"proargtypes":["25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$guard$::jsonb
 or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'
 then raise exception'daily_provider_dispatch_gap_priority_helper_cas';end if;

 if (to_jsonb(p)-array['prosrc','prosqlbody'])is distinct from current_setting('audit.provider_dispatch_gap_priority_helper_meta')::jsonb then raise exception'daily_provider_dispatch_gap_priority_helper_metadata_changed';end if;
 select(select jsonb_agg(to_jsonb(snapshot_fn)order by snapshot_fn.oid)from pg_proc snapshot_fn where snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'),to_regprocedure('private.daily_provider_base_admit_days(jsonb,boolean)'),to_regprocedure('private.withdraw_prepared_run_dispatch(text)'),to_regprocedure('private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'),to_regprocedure('private.prepared_aggregate_read(text,jsonb)'),to_regprocedure('private.prepared_aggregate_claim(text)')]))into s;if s is distinct from current_setting('audit.provider_dispatch_gap_priority_functions')::jsonb then raise exception'daily_provider_dispatch_gap_priority_protected_changed';end if;
 select(select jsonb_build_object('common',c.value,'targets',(select jsonb_agg(jsonb_build_array(to_jsonb(n),private.prepared_aggregate_dependency(to_jsonb(n),c.value))order by n.id)from private.prepared_aggregate_native_catalog()n where n.team='M8'and n.country='印度'and n.scope_group='IN'and n.source in('ar','newar','kb')))from(select private.prepared_aggregate_dependency_common('IN')value)c)into s;if s is distinct from current_setting('audit.provider_dispatch_gap_priority_dependency')::jsonb then raise exception'daily_provider_dispatch_gap_priority_financial_dependency_changed';end if;
end;$verify$;
commit;
