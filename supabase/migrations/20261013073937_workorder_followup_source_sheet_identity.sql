-- Return the row's actual workbook identity; historical and October rows remain separate.
-- This adds one response field only. No source rows, matching, counts or grants change.
begin;
set local lock_timeout='1s';
set local statement_timeout='3s';
do $migration$
declare
 target oid:=to_regprocedure('private.dashboard_admin_live_deposit_issues(jsonb)');
 p record;original_metadata jsonb;definition text;
 old_fragment constant text:=$old$'resultDate',p.result_date,'sourceRow'$old$;
 new_fragment constant text:=$new$'resultDate',p.result_date,'sourceSheet',p.source_sheet,'sourceRow'$new$;
begin
 select * into p from pg_proc where oid=target;
 if p.oid is null or pg_get_userbyid(p.proowner)<>'postgres' or p.prokind<>'f'
  or p.prorettype<>'jsonb'::regtype or p.proretset or p.pronargs<>1 or p.provariadic<>0
  or p.provolatile<>'s' or not p.prosecdef or p.proisstrict or p.proleakproof or p.proparallel<>'u'
  or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""','enable_nestloop=off','jit=off']::text[]
  or pg_get_function_arguments(p.oid)<>$args$p_request jsonb DEFAULT '{}'::jsonb$args$
  or p.procost<>100 or p.prorows<>0
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  then raise exception 'workorder_followup_source_sheet: execution metadata drift';end if;
 if md5(p.prosrc) not in('d590c4cfd8da1829416174bcd8dc4fa1','72e2dd160665a1c0bdebac238554cb23') then
  raise exception 'workorder_followup_source_sheet: definition drift';end if;
 if md5(p.prosrc)='72e2dd160665a1c0bdebac238554cb23' then return;end if;
 definition:=pg_get_functiondef(target);original_metadata:=to_jsonb(p)-'prosrc';
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception 'workorder_followup_source_sheet: replacement drift';end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(f)-'prosrc' from pg_proc f where f.oid=target) is distinct from original_metadata
  or (select md5(prosrc) from pg_proc where oid=target)<>'72e2dd160665a1c0bdebac238554cb23' then
  raise exception 'workorder_followup_source_sheet: postcondition drift';end if;
end;
$migration$;
commit;
