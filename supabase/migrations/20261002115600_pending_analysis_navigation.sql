-- Relocate the existing page in role editors without changing grants or request keys.
begin;
do $relocate$
declare
 before_catalog jsonb;
 after_catalog jsonb;
 before_meta jsonb;
 pages jsonb;
begin
 if md5(pg_get_functiondef('private.dashboard_role_catalog()'::regprocedure))<>'3e7cf90d4ee8c5f8012a6b6f38224af9' then
  raise exception 'pending_navigation_catalog_drift';
 end if;
 select to_jsonb(p)-'prosrc' into before_meta from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure;
 if (select pg_get_userbyid(proowner)<>'postgres' or proacl::text is distinct from '{postgres=X/postgres}' or prosecdef or provolatile<>'i' or proconfig is distinct from array['search_path=""'] from pg_proc where oid='private.dashboard_role_catalog()'::regprocedure) then
  raise exception 'pending_navigation_catalog_metadata_drift';
 end if;
 before_catalog:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(before_catalog->'pages') p where p->>'id'='stuck' and p->>'moduleId'='risk' and p->>'moduleLabel'='智能风控中心')<>1 then
  raise exception 'pending_navigation_page_drift';
 end if;
 select jsonb_agg(case when p->>'id'='stuck' then jsonb_set(jsonb_set(p,'{moduleId}','"analysis"'),'{moduleLabel}','"数据分析中心"') else p end order by ord)
 into pages from jsonb_array_elements(before_catalog->'pages') with ordinality as q(p,ord);
 after_catalog:=jsonb_set(before_catalog,'{pages}',pages);
 execute format('create or replace function private.dashboard_role_catalog()returns jsonb language sql immutable set search_path='''' as %L','select '||quote_literal(after_catalog::text)||'::jsonb');
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure) is distinct from before_meta then
  raise exception 'pending_navigation_metadata_changed';
 end if;
 if private.dashboard_role_catalog() is distinct from after_catalog or (after_catalog-'pages') is distinct from (before_catalog-'pages') then
  raise exception 'pending_navigation_output_changed';
 end if;
end $relocate$;
notify pgrst,'reload schema';
commit;
