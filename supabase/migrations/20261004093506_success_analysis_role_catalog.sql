-- Register the new analysis entry without assigning it to any saved role.
-- Production baseline: body 0245134da03be7f9852c2e9a0cf62ceb,
-- definition d0636e1c6d1613cff65a8e097a99ef85; retain the function identity and ACL.
begin;
do $register_success_analysis$
declare
 before_catalog jsonb;
 after_catalog jsonb;
 before_meta jsonb;
 pages jsonb;
 new_page constant jsonb := '{"id":"success_analysis","moduleId":"analysis","moduleLabel":"数据分析中心","label":"成功率分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","aggregate","workorders"]}'::jsonb;
 new_permissions constant jsonb := '[{"key":"success_analysis.view"},{"key":"success_analysis.query"},{"key":"success_analysis.export"}]'::jsonb;
 function_id oid := to_regprocedure('private.dashboard_role_catalog()');
 body_hash text;
 definition_hash text;
begin
 if function_id is null then raise exception 'success_analysis_catalog_missing';end if;
 select to_jsonb(p)-'prosrc',md5(p.prosrc),md5(pg_get_functiondef(p.oid))
 into before_meta,body_hash,definition_hash from pg_proc p where p.oid=function_id;
 if (select pg_get_userbyid(proowner)<>'postgres'
   or proacl::text is distinct from '{postgres=X/postgres}' or prosecdef
   or provolatile<>'i' or prolang<>(select oid from pg_language where lanname='sql')
   or proconfig is distinct from array['search_path=""']
   from pg_proc where oid=function_id) then
  raise exception 'success_analysis_catalog_metadata_drift';
 end if;
 -- A replay is allowed only for this exact final function, never a partial registration.
 if body_hash='4962049325c861dd3537d59954565062'
  and definition_hash='a23f99c23637ecd7a8e4931ba98f6dca' then return;end if;
 if body_hash<>'0245134da03be7f9852c2e9a0cf62ceb'
  or definition_hash<>'d0636e1c6d1613cff65a8e097a99ef85' then
  raise exception 'success_analysis_catalog_baseline_drift';
 end if;
 before_catalog:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(before_catalog->'pages') p where p->>'id'='latency')<>1
  or exists(select 1 from jsonb_array_elements(before_catalog->'pages') p where p->>'id'='success_analysis')
  or exists(select 1 from jsonb_array_elements(before_catalog->'permissions') p where p->>'key' like 'success_analysis.%') then
  raise exception 'success_analysis_catalog_entry_drift';
 end if;
 select jsonb_agg(inserted.p order by original.ord,inserted.ord) into pages
 from jsonb_array_elements(before_catalog->'pages') with ordinality original(p,ord)
 cross join lateral jsonb_array_elements(case when original.p->>'id'='latency'
  then jsonb_build_array(new_page,original.p) else jsonb_build_array(original.p) end)
  with ordinality inserted(p,ord);
 after_catalog:=jsonb_set(jsonb_set(before_catalog,'{pages}',pages),'{permissions}',(before_catalog->'permissions')||new_permissions);
 execute format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L',
  'select '||quote_literal(after_catalog::text)||'::jsonb');
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid=function_id) is distinct from before_meta then
  raise exception 'success_analysis_catalog_metadata_changed';
 end if;
 if private.dashboard_role_catalog() is distinct from after_catalog
  or (select md5(prosrc)<>'4962049325c861dd3537d59954565062'
   or md5(pg_get_functiondef(oid))<>'a23f99c23637ecd7a8e4931ba98f6dca'
   from pg_proc where oid=function_id) then
  raise exception 'success_analysis_catalog_output_changed';
 end if;
end $register_success_analysis$;
notify pgrst,'reload schema';
commit;
