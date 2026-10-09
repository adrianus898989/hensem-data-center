-- Reuse the existing read-only channel page and its permissions under Operations.
begin;
do $relocate$
declare
 before_catalog jsonb;after_catalog jsonb;before_meta jsonb;pages jsonb;channel_page jsonb;
 function_id oid:=to_regprocedure('private.dashboard_role_catalog()');
begin
 if function_id is null then raise exception 'platform_channel_navigation_catalog_missing';end if;
 if (select md5(prosrc)<>'99969554b74a7ca190d5e1ce9d330bec' or md5(pg_get_functiondef(oid))<>'694481b1e0e1b40f00a2ff0a4aa10675' from pg_proc where oid=function_id) then
  raise exception 'platform_channel_navigation_catalog_drift';end if;
 select to_jsonb(p)-'prosrc' into before_meta from pg_proc p where oid=function_id;
 if (select pg_get_userbyid(proowner)<>'postgres' or proacl::text is distinct from '{postgres=X/postgres}' or prosecdef or provolatile<>'i'
  or proconfig is distinct from array['search_path=""'] or prolang<>(select oid from pg_language where lanname='sql') from pg_proc where oid=function_id) then
  raise exception 'platform_channel_navigation_catalog_metadata_drift';end if;
 before_catalog:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(before_catalog->'pages')p where p->>'id'='channel_status')<>1
  or (select count(*) from jsonb_array_elements(before_catalog->'pages')p where p->>'id'='daily_comparison' and p->>'moduleId'='merchant')<>1 then
  raise exception 'platform_channel_navigation_page_drift';end if;
 select p into channel_page from jsonb_array_elements(before_catalog->'pages')p where p->>'id'='channel_status';
 if channel_page->>'moduleId'<>'provider' or channel_page->>'moduleLabel'<>'三方通道中心' or channel_page->>'label'<>'通道状态' then
  raise exception 'platform_channel_navigation_page_drift';end if;
 channel_page:=channel_page||'{"moduleId":"merchant","moduleLabel":"运营中心","label":"平台通道调整"}'::jsonb;
 select jsonb_agg(i.p order by o.ord,i.ord) into pages
 from jsonb_array_elements(before_catalog->'pages') with ordinality o(p,ord)
 cross join lateral jsonb_array_elements(case when o.p->>'id'='daily_comparison' then jsonb_build_array(o.p,channel_page) else jsonb_build_array(o.p) end) with ordinality i(p,ord)
 where o.p->>'id'<>'channel_status';
 after_catalog:=jsonb_set(before_catalog,'{pages}',pages);
 execute format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L','select '||quote_literal(after_catalog::text)||'::jsonb');
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid=function_id) is distinct from before_meta then raise exception 'platform_channel_navigation_metadata_changed';end if;
 if private.dashboard_role_catalog() is distinct from after_catalog or (after_catalog-'pages') is distinct from (before_catalog-'pages') then
  raise exception 'platform_channel_navigation_output_changed';end if;
end;$relocate$;
notify pgrst,'reload schema';
commit;
