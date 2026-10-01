-- Response-only compatibility for older deployed frontend catalogs. Owner and
-- legacy authorization remains mode/profile based; assigned keys are unchanged.
begin;
set local statement_timeout='30s';
do $compatibility$
declare p record;after_state record;before_core text;source_body text;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.dashboard_role_access()');
 if not found or p.proowner<>(select oid from pg_roles where rolname=current_user)
  or md5(pg_get_functiondef(p.oid))<>'dcadd85c673c5f0567d2f319da5a66f9'
  or md5(p.prosrc)<>'93f491b7653f5c5dfc8e04f2df409654'
  or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
  then raise exception 'role_read_projection_contract_drift';end if;
 select md5(pg_get_functiondef('private.dashboard_role_access()'::regprocedure)) into before_core;
 source_body:=$body$ with live as materialized (select private.dashboard_role_access() as value)
 select case when value->>'mode' in ('owner','legacy')
  then jsonb_set(value,'{permissions}','[]'::jsonb,false) else value end from live; $body$;
 execute replace(pg_get_functiondef(p.oid),p.prosrc,source_body);
 select proacl,proowner,proconfig,prosecdef,provolatile into after_state from pg_proc where oid=p.oid;
 if after_state.proacl is distinct from p.proacl or after_state.proowner<>p.proowner
  or after_state.proconfig is distinct from p.proconfig or after_state.prosecdef is distinct from p.prosecdef
  or after_state.provolatile<>p.provolatile
  or md5(pg_get_functiondef('private.dashboard_role_access()'::regprocedure))<>before_core
  then raise exception 'role_read_projection_authorization_changed';end if;
end;$compatibility$;
notify pgrst,'reload schema';
commit;
