-- The success analysis page reads the existing, scoped rate configuration
-- solely to display provider business types. Saved roles and grants are unchanged.
begin;
set local lock_timeout='3s';set local statement_timeout='20s';
do $type_reader$
declare
 function_id oid:=to_regprocedure('private.dashboard_role_catalog()');
 before_meta jsonb;before_catalog jsonb;after_catalog jsonb;pages jsonb;
 body_hash text;definition_hash text;
begin
 if function_id is null then raise exception 'success_type_catalog_missing';end if;
 select to_jsonb(p)-'prosrc',md5(prosrc),md5(pg_get_functiondef(oid))
 into before_meta,body_hash,definition_hash from pg_proc p where oid=function_id;
 if (select pg_get_userbyid(proowner)<>'postgres' or proacl::text is distinct from '{postgres=X/postgres}'
   or prosecdef or provolatile<>'i' or proconfig is distinct from array['search_path=""']
   or prolang<>(select oid from pg_language where lanname='sql') from pg_proc where oid=function_id) then
  raise exception 'success_type_catalog_metadata_drift';end if;
 if body_hash='eee3100170bb146782d4fb34e77d680a' and definition_hash='aff46e4d81404c6db383001cc8cc2443' then return;end if;
 if body_hash<>'4962049325c861dd3537d59954565062' or definition_hash<>'a23f99c23637ecd7a8e4931ba98f6dca' then
  raise exception 'success_type_catalog_baseline_drift';end if;
 before_catalog:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(before_catalog->'pages') p where p->>'id'='success_analysis'
   and p->'requests'='["catalog","providerOptions","syncHealth","aggregate","workorders"]'::jsonb)<>1 then
  raise exception 'success_type_catalog_entry_drift';end if;
 select jsonb_agg(case when p->>'id'='success_analysis'
  then jsonb_set(p,'{requests}',p->'requests'||'["rates"]'::jsonb) else p end order by ord) into pages
 from jsonb_array_elements(before_catalog->'pages') with ordinality t(p,ord);
 after_catalog:=jsonb_set(before_catalog,'{pages}',pages);
 execute format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L',
  'select '||quote_literal(after_catalog::text)||'::jsonb');
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid=function_id) is distinct from before_meta
  or private.dashboard_role_catalog() is distinct from after_catalog
  or (select md5(prosrc)<>'eee3100170bb146782d4fb34e77d680a' or md5(pg_get_functiondef(oid))<>'aff46e4d81404c6db383001cc8cc2443' from pg_proc where oid=function_id) then
  raise exception 'success_type_catalog_installation_drift';end if;
end $type_reader$;
notify pgrst,'reload schema';
commit;
