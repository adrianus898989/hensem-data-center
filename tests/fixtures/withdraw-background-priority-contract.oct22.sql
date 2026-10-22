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
$function$

