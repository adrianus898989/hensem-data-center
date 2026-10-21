-- Restore exactly the reviewed entry body; immutable publications/jobs remain.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
do $rollback$
declare d text;body text;dep text:=private.withdraw_prepared_dependency();
 anchor text:=E' -- NPG empty-template serving: exact authorized singleton only.\n last_complete:=private.dashboard_withdraw_npg_template_read(q,r,s,c,dep);\n IF last_complete IS NOT NULL THEN RETURN last_complete;END IF;\n';
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)')
  and md5(p.prosrc)='1c295caddaf735d8fa2d930b290c6e63'and pg_get_userbyid(p.proowner)='postgres'
  and p.proacl::text='{postgres=X/postgres}'and p.proconfig=array['search_path=""']and not p.prosecdef
  and p.provolatile='s'and p.proparallel='u'and not p.proisstrict and not p.proleakproof and not p.proretset
  and p.procost=100 and p.prorows=0 and p.pronargdefaults=0 and(select lanname from pg_language where oid=p.prolang)='plpgsql')
 then raise exception'withdraw_npg_template_rollback_helper_drift';end if;
 select pg_get_functiondef(p.oid),p.prosrc into d,body from pg_proc p where p.oid='private.withdraw_prepared_read(jsonb)'::regprocedure
  and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}'and p.proconfig=array['search_path=""']
  and p.prosecdef and p.provolatile='v'and p.proparallel='u'and not p.proisstrict and not p.proleakproof and not p.proretset;
 if d is null or(length(body)-length(replace(body,anchor,'')))/length(anchor)<>1
  or md5(replace(body,anchor,''))<>'d994db6ea7d4b7ed4d4ae627aabf803f'then raise exception'withdraw_npg_template_rollback_drift';end if;
 execute replace(d,anchor,'');
 drop function private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text);
 if dep is distinct from private.withdraw_prepared_dependency()then raise exception'withdraw_npg_template_rollback_dependency';end if;
end;$rollback$;
commit;
