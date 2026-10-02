-- Bounded native-name expansion before the existing authorized order reader.
-- No order clock, fee, pagination, count, source identity or authorization changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $dependency$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_wg_provider_names(text,text,text)');
 if not found or md5(p.prosrc) is distinct from '756a84807ac1a1067c61393e162fbd6f'
  then raise exception 'wg_details_provider_names_dependency_drift';end if;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
  then raise exception 'wg_details_provider_names_metadata_drift';end if;
end;
$dependency$;
do $patch$
declare target regprocedure:='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure;
 p pg_proc%rowtype; metadata jsonb; definition text;
 old_fragment text:=$old$    with names as (
      select distinct coalesce(nullif(btrim(d.provider),''),'未识别通道') provider
      from public.wg_recharge_details d join private.dashboard_admin_wg_sites()s on s.site_code=d.site_code
      where s.country_code=v_platform.scope_group and s.platform=v_platform.source_name and coalesce(p_request->>'direction','all') in('all','charge')
      union select distinct coalesce(nullif(btrim(d.provider),''),'未识别通道')
      from public.wg_withdraw_details d join private.dashboard_admin_wg_sites()s on s.site_code=d.site_code
      where s.country_code=v_platform.scope_group and s.platform=v_platform.source_name and coalesce(p_request->>'direction','all') in('all','withdraw')
    ),$old$;
 new_fragment text:=$new$    with names as materialized (
      -- Canonicalize once per distinct native name, never once per historical order.
      -- The shared helper enumerates every raw name by the existing site/provider index.
      select provider from private.dashboard_admin_wg_provider_names(
        v_platform.scope_group,v_platform.source_name,coalesce(p_request->>'direction','all'))
    ),$new$;
begin
 select * into p from pg_proc where oid=target;
 if md5(p.prosrc) is distinct from 'c3af246b2aa3b4ac118815bdcec4e0ba'
  then raise exception 'wg_details_expand_baseline_drift';end if;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
  then raise exception 'wg_details_expand_metadata_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';
 definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  then raise exception 'wg_details_expand_patch_anchor_drift';end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata
  then raise exception 'wg_details_expand_metadata_changed';end if;
end;
$patch$;
commit;
