DO $guard$
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_continuation_owner_only';END IF;
 IF EXISTS(SELECT 1 FROM(VALUES
 ('private.dashboard_withdraw_priority_at(private.withdraw_prepared_jobs,timestamptz)','208365f5d09a2c2a49814602a11d3bc6'),
 ('private.shared_worker_priority_contract_current()','9a0df0f0b315e79c62e17176ba6e8e97')
 )e(signature,hash)LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 WHERE p.oid IS NULL OR md5(p.prosrc)<>e.hash OR pg_get_userbyid(p.proowner)<>'postgres'
 OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
 OR p.prosecdef OR p.provolatile<>'s' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u')
 THEN RAISE EXCEPTION 'withdraw_continuation_function_drift';END IF;
 IF NOT private.shared_worker_priority_contract_current()THEN RAISE EXCEPTION 'withdraw_continuation_contract_drift';END IF;
 PERFORM set_config('hensem.withdraw_continuation_before',private.withdraw_prepared_dependency(),true);
END;$guard$;
CREATE OR REPLACE FUNCTION private.dashboard_withdraw_priority_at(j private.withdraw_prepared_jobs, p_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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


DO $verify$
BEGIN
 IF private.withdraw_prepared_dependency() IS DISTINCT FROM current_setting('hensem.withdraw_continuation_before')
 OR NOT private.shared_worker_priority_contract_current()THEN RAISE EXCEPTION 'withdraw_continuation_postcondition';END IF;
END;$verify$;
