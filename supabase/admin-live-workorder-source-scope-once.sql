-- Resolve requested/authenticated source identities once per source, then use a
-- collision-safe tuple lookup for the already-scoped canonical provider names.
begin;
do $patch$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('private.dashboard_admin_live_workorders(jsonb)'::regprocedure) into definition;
 if position('workorder_provider_map_v3 as materialized' in definition)>0 then return;end if;
 original:=$old0$  ), scoped as materialized (
    select w.stat_date,w.country_code,w.country,w.platform,
      coalesce(nullif(btrim(w.third_party),''),'未识别三方') as raw_provider,
      coalesce(nullif(btrim(w.channel_type),''),'未识别通道') as channel_type,
      w.submitted_count,w.submitted_amount,w.success_count,w.success_amount,
      greatest(w.submitted_count-w.success_count,0) as pending_count,
      greatest(w.submitted_amount-w.success_amount,0) as pending_amount,
      w.withdraw_not_received_count,w.withdraw_not_received_amount,
      w.withdraw_success_count,w.withdraw_success_amount,w.source_updated_at,w.updated_at
    from public.workorder_deposit_daily w
    where w.source_system='AR_WORKORDER'
      and w.stat_date between v_start and v_end
      and (v_country is null or w.country_code=v_country or w.country=v_country)
      and (v_platform is null or private.dashboard_admin_live_workorder_platform_key(w.country_code,w.platform)
        =private.dashboard_admin_live_workorder_platform_key(w.country_code,v_platform))
      and (not(p_request ? 'platforms') or exists (
        select 1 from jsonb_array_elements_text(p_request->'platforms') f(platform)
        where private.dashboard_admin_live_workorder_platform_key(w.country_code,w.platform)
          =private.dashboard_admin_live_workorder_platform_key(w.country_code,f.platform)))
      and private.dashboard_scope_allows(v_scope,w.country_code,w.platform)
$old0$;
 replacement:=$new0$  ), workorder_source_names_v3 as materialized (
    select distinct w.country_code,w.country,w.platform from public.workorder_deposit_daily w
    where w.source_system='AR_WORKORDER' and w.stat_date between v_start and v_end
      and (v_country is null or w.country_code=v_country or w.country=v_country)
  ), workorder_source_scope_v3 as materialized (
    select s.* from workorder_source_names_v3 s where true
      and (v_platform is null or private.dashboard_admin_live_workorder_platform_key(s.country_code,s.platform)
        =private.dashboard_admin_live_workorder_platform_key(s.country_code,v_platform))
      and (not(p_request ? 'platforms') or exists (
        select 1 from jsonb_array_elements_text(p_request->'platforms') f(platform)
        where private.dashboard_admin_live_workorder_platform_key(s.country_code,s.platform)
          =private.dashboard_admin_live_workorder_platform_key(s.country_code,f.platform)))
      and private.dashboard_scope_allows(v_scope,s.country_code,s.platform)
  ), scoped as materialized (
    select w.stat_date,w.country_code,w.country,w.platform,
      coalesce(nullif(btrim(w.third_party),''),'未识别三方') as raw_provider,
      coalesce(nullif(btrim(w.channel_type),''),'未识别通道') as channel_type,
      w.submitted_count,w.submitted_amount,w.success_count,w.success_amount,
      greatest(w.submitted_count-w.success_count,0) as pending_count,
      greatest(w.submitted_amount-w.success_amount,0) as pending_amount,
      w.withdraw_not_received_count,w.withdraw_not_received_amount,
      w.withdraw_success_count,w.withdraw_success_amount,w.source_updated_at,w.updated_at
    from public.workorder_deposit_daily w join workorder_source_scope_v3 s
      on s.country_code=w.country_code and s.country=w.country and s.platform=w.platform
    where w.source_system='AR_WORKORDER' and w.stat_date between v_start and v_end
$new0$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Workorder source scope baseline 1 changed';end if;
 definition:=replace(definition,original,replacement);
 original:=$old1$  ), mapped as materialized (
    select s.*,names.canonical_provider from scoped s
    join workorder_provider_names_v1 names
      using(country,platform,raw_provider,channel_type)
$old1$;
 replacement:=$new1$  ), workorder_provider_map_v3 as materialized (
    select jsonb_object_agg(jsonb_build_array(country,platform,raw_provider,channel_type)::text,canonical_provider) as providers
    from workorder_provider_names_v1
  ), mapped as materialized (
    select s.*,m.providers->>jsonb_build_array(s.country,s.platform,s.raw_provider,s.channel_type)::text as canonical_provider
    from scoped s cross join workorder_provider_map_v3 m
$new1$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Workorder source scope baseline 2 changed';end if;
 definition:=replace(definition,original,replacement);
 execute definition;
end;
$patch$;
notify pgrst,'reload schema';
commit;
