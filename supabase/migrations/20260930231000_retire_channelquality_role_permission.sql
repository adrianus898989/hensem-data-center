-- Retire only the removed channelquality directory; do not grant replacement permissions.
-- Existing role rows, account assignments, passwords and data scopes are not changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare p record;v_new text;v_after record;
begin
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('private.dashboard_role_catalog()');
 if not found or p.proowner<>(select oid from pg_roles where rolname=current_user)
  or p.prosecdef or p.provolatile<>'i' or p.prorettype<>'jsonb'::regtype or p.proretset
  or p.lanname<>'sql' or p.proconfig is distinct from array['search_path=""']::text[]
  or md5(p.prosrc) not in ('de973caa62402e8b5e07f7626010ee99','aa865d4b6f35a1bec1801643e86b1916')
 then raise exception 'dashboard_role_retired_catalog_drift';end if;
 if md5(p.prosrc)='de973caa62402e8b5e07f7626010ee99' then
  v_new:=p.prosrc;
  v_new:=replace(v_new,$remove0${"id":"channelquality","moduleId":"provider","moduleLabel":"三方通道中心","label":"稳定性与占比","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","workorders","submissionAnalysis","memberDaily"]},$remove0$,'');
  v_new:=replace(v_new,$remove1${"key":"channelquality.view"},$remove1$,'');
  v_new:=replace(v_new,$remove2${"key":"channelquality.query"},$remove2$,'');
  v_new:=replace(v_new,$remove3${"key":"channelquality.detail"},$remove3$,'');
  v_new:=replace(v_new,$remove4${"key":"channelquality.export"},$remove4$,'');
  if md5(v_new)<>'aa865d4b6f35a1bec1801643e86b1916' then raise exception 'dashboard_role_retired_catalog_anchor';end if;
  execute replace(pg_get_functiondef(p.oid),p.prosrc,v_new);
 end if;
 select proacl,proowner into v_after from pg_proc where oid=p.oid;
 if v_after.proacl is distinct from p.proacl or v_after.proowner<>p.proowner then raise exception 'dashboard_role_retired_catalog_acl_drift';end if;
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('private.dashboard_role_access()');
 if not found or p.proowner<>(select oid from pg_roles where rolname=current_user)
  or not p.prosecdef or p.provolatile<>'s' or p.prorettype<>'jsonb'::regtype or p.proretset
  or p.lanname<>'plpgsql' or p.proconfig is distinct from array['search_path=""']::text[]
  or md5(p.prosrc) not in ('274a0bfe3c8636c013bb9d1005281f84','423aab3bb0ec685aa745a18ea6b7811a')
 then raise exception 'dashboard_role_retired_access_drift';end if;
 if md5(p.prosrc)='274a0bfe3c8636c013bb9d1005281f84' then
  v_new:=replace(p.prosrc,$before$ if not found then raise exception using errcode='42501',message='role_unavailable';end if;$before$,$after$ if not found then raise exception using errcode='42501',message='role_unavailable';end if;
 -- Retired directory permissions never grant a visible page or gateway access.
 r.permissions:=array(select permission_code from unnest(r.permissions) permission_code
  where permission_code<>all(array['channelquality.view','channelquality.query','channelquality.detail','channelquality.export']::text[]));$after$);
  if md5(v_new)<>'423aab3bb0ec685aa745a18ea6b7811a' then raise exception 'dashboard_role_retired_access_anchor';end if;
  execute replace(pg_get_functiondef(p.oid),p.prosrc,v_new);
 end if;
 select proacl,proowner into v_after from pg_proc where oid=p.oid;
 if v_after.proacl is distinct from p.proacl or v_after.proowner<>p.proowner then raise exception 'dashboard_role_retired_access_acl_drift';end if;
end;$migration$;
commit;
