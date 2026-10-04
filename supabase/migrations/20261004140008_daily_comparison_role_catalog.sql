-- Register Daily Comparison in Operations. Existing role assignments and native
-- data scopes are unchanged; the current gateway already routes these read actions.
begin;
do $register_daily_comparison$
declare
 before_catalog jsonb;
 after_catalog jsonb;
 before_meta jsonb;
 pages jsonb;
 new_page constant jsonb := '{"id":"daily_comparison","moduleId":"merchant","moduleLabel":"运营中心","label":"每日对比","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","aggregate","rates","syncHealth","workorders"]}'::jsonb;
 new_permissions constant jsonb := '[{"key":"daily_comparison.view"},{"key":"daily_comparison.query"},{"key":"daily_comparison.detail"},{"key":"daily_comparison.export"}]'::jsonb;
 function_id oid := to_regprocedure('private.dashboard_role_catalog()');
 body_hash text;
 definition_hash text;
begin
 if function_id is null then raise exception 'daily_comparison_catalog_missing';end if;
 select to_jsonb(p)-'prosrc',md5(p.prosrc),md5(pg_get_functiondef(p.oid))
 into before_meta,body_hash,definition_hash from pg_proc p where p.oid=function_id;
 if (select pg_get_userbyid(proowner)<>'postgres'
   or proacl::text is distinct from '{postgres=X/postgres}' or prosecdef
   or provolatile<>'i' or prolang<>(select oid from pg_language where lanname='sql')
   or proconfig is distinct from array['search_path=""']
   from pg_proc where oid=function_id) then
  raise exception 'daily_comparison_catalog_metadata_drift';
 end if;
 -- Replays accept only the exact final body and definition, never partial registration.
 if body_hash='a8d63fb20a46abf508c3bf9e07e0027d'
  and definition_hash='573d702c8135b4bb667feb23365054e5' then return;end if;
 if body_hash<>'b1c7a223fd9d4b5ea488ad0114bba9d4'
  or definition_hash<>'db24d518ed7aa439aae1c9fa87c33dab' then
  raise exception 'daily_comparison_catalog_baseline_drift';
 end if;
 before_catalog:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(before_catalog->'pages') p where p->>'id'='merchants')<>1
  or exists(select 1 from jsonb_array_elements(before_catalog->'pages') p where p->>'id'='daily_comparison')
  or exists(select 1 from jsonb_array_elements(before_catalog->'permissions') p where p->>'key' like 'daily_comparison.%') then
  raise exception 'daily_comparison_catalog_entry_drift';
 end if;
 select jsonb_agg(inserted.p order by original.ord,inserted.ord) into pages
 from jsonb_array_elements(before_catalog->'pages') with ordinality original(p,ord)
 cross join lateral jsonb_array_elements(case when original.p->>'id'='merchants'
  then jsonb_build_array(original.p,new_page) else jsonb_build_array(original.p) end)
  with ordinality inserted(p,ord);
 after_catalog:=jsonb_set(jsonb_set(before_catalog,'{pages}',pages),'{permissions}',(before_catalog->'permissions')||new_permissions);
 execute format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L',
  'select '||quote_literal(after_catalog::text)||'::jsonb');
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid=function_id) is distinct from before_meta then
  raise exception 'daily_comparison_catalog_metadata_changed';
 end if;
 if private.dashboard_role_catalog() is distinct from after_catalog
  or (select md5(prosrc)<>'a8d63fb20a46abf508c3bf9e07e0027d'
   or md5(pg_get_functiondef(oid))<>'573d702c8135b4bb667feb23365054e5'
   from pg_proc where oid=function_id) then
  raise exception 'daily_comparison_catalog_output_changed';
 end if;
end $register_daily_comparison$;
notify pgrst,'reload schema';
commit;
