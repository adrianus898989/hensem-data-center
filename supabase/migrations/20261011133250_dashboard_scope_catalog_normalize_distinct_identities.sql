-- A directory identity does not depend on historical duplicate report rows.
-- Deduplicate all five native display/identity fields before normalization;
-- materialize that normalization once. Preserve every source branch, alias,
-- team conflict, report-only platform and fresh session/scope permission guard.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $scope_catalog_identity_once$
declare
 target regprocedure:='public.dashboard_account_data_scope_catalog()'::regprocedure;
 p pg_proc%rowtype; metadata jsonb; definition text; old_fragment text; new_fragment text;
begin
 select * into p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
 or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.prokind<>'f' or p.proretset
 or p.prorettype<>'jsonb'::regtype or p.pronargs<>0 or p.pronargdefaults<>0
 or p.proisstrict or p.proleakproof or p.proparallel<>'u'
 then raise exception 'scope_catalog_identity_metadata_drift';end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_data_group(text,text)'::regprocedure)<>'05cccb401a8b4981ef2ab837567bb5a1'
 or (select md5(prosrc) from pg_proc where oid='private.dashboard_scope_platform_identity(text,text)'::regprocedure)<>'61134c92422ef23380a94e7e2b474623'
 then raise exception 'scope_catalog_identity_dependency_drift';end if;
 if md5(p.prosrc)='6b83f864953cbfd7f3cf1c45a9a15693' then return;end if;
 if md5(p.prosrc)<>'a756992f2f1b6aa5a5b9c608c006ffc4' then raise exception 'scope_catalog_identity_baseline_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 old_fragment:=$old_0$with native as materialized ($old_0$;
 new_fragment:=$new_0$with native_rows as materialized ($new_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 then raise exception 'scope_catalog_identity_anchor_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_1$ ), canonical as ($old_1$;
 new_fragment:=$new_1$ ), native as materialized (
  select distinct country,platform,name,source,team from native_rows
 ), canonical as materialized ($new_1$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 then raise exception 'scope_catalog_identity_anchor_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata
 then raise exception 'scope_catalog_identity_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid=target)<>'6b83f864953cbfd7f3cf1c45a9a15693'
 then raise exception 'scope_catalog_identity_candidate_hash';end if;
end $scope_catalog_identity_once$;
commit;
