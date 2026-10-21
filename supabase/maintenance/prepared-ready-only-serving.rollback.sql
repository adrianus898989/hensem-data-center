-- Roll back only this exact serving change; do not alter any publication/job.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
do $rollback$
declare p record;h record;d text;injected text:=E' -- Explicit read-only phase follows all unchanged page/session/query grants.\n if p_request?''readMode''then return private.dashboard_serving_ready_read(p_page,p_request);end if;\n';
begin
 select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)');
 select *into h from pg_proc where oid=to_regprocedure('private.dashboard_serving_ready_read(text,jsonb)');
 if p.oid is null or h.oid is null
  or md5(h.prosrc)<>'227143c4c01682570c81edef9a336476'
  or pg_get_userbyid(h.proowner)<>'postgres'or h.proacl::text is distinct from'{postgres=X/postgres}'
  or h.proconfig is distinct from array['search_path=""']or h.prosecdef or h.provolatile<>'s'
  or h.proretset or h.proparallel<>'u'or h.proisstrict or h.proleakproof
  or pg_get_userbyid(p.proowner)<>'postgres'or p.proacl::text is distinct from'{postgres=X/postgres}'
  or p.proconfig is distinct from array['search_path=""']or p.prosecdef or p.provolatile<>'v'
  or p.proretset or p.proparallel<>'u'or p.proisstrict or p.proleakproof
  or(length(p.prosrc)-length(replace(p.prosrc,injected,'')))/length(injected)<>1
  or md5(replace(p.prosrc,injected,''))<>'1dd076b75533d3a1333dd6c739e4c72c'
 then raise exception'prepared_ready_rollback_drift';end if;
 d:=pg_get_functiondef(p.oid);execute replace(d,injected,'');
 if(select md5(prosrc)from pg_proc where oid=p.oid)<>'1dd076b75533d3a1333dd6c739e4c72c'
 then raise exception'prepared_ready_rollback_restore';end if;
 execute'drop function private.dashboard_serving_ready_read(text,jsonb)';
end;$rollback$;
commit;
