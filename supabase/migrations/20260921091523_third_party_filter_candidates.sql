-- Names only: existing aggregate metadata and the latest source dictionaries.
-- No order scans, amounts, member IDs, URLs or credentials are returned.
begin;
create function private.dashboard_third_party_filter_candidates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_scope jsonb; v_rows jsonb;
begin
  if (select auth.uid()) is null then raise exception using errcode='28000',message='请先登录'; end if;
  if public.dashboard_has_permission('third_party') is not true then
    raise exception using errcode='42501',message='没有三方查询权限';
  end if;
  v_scope := private.dashboard_current_data_scope();
  with legacy as materialized (
    select distinct country,platform,channel,
      coalesce(nullif(raw_channel,''),channel) provider,
      coalesce(channel_type,'') channel_type,direction,'history'::text source
    from public.third_party_volume where quarantined_at is null
  ), dictionaries as materialized (
    select distinct on (platform_id,data_type) platform_id,data_type,pay_methods,pay_method_list,withdraw_channel
    from public.game66_dictionary_snapshots where data_type in ('charge','withdraw')
    order by platform_id,data_type,fetched_at desc,id desc
  ), dictionary_names as (
    select case p.team_code when 'hong_kong' then '香港' when 'red_crab' then '红膏蟹' end country,
      p.platform_name platform,coalesce(item->>'label','') channel,coalesce(item->>'label','') provider,
      ''::text channel_type,case d.data_type when 'charge' then '代收' else '代付' end direction,'dictionary'::text source
    from dictionaries d join public.game66_platforms p on p.id=d.platform_id
    cross join lateral pg_catalog.jsonb_array_elements(case
      when d.data_type='charge' and pg_catalog.jsonb_typeof(d.pay_method_list)='array' then d.pay_method_list
      when d.data_type='withdraw' and pg_catalog.jsonb_typeof(d.withdraw_channel)='array' then d.withdraw_channel
      else '[]'::jsonb end) item
    where p.team_code in ('hong_kong','red_crab')
    union all
    select case p.team_code when 'hong_kong' then '香港' when 'red_crab' then '红膏蟹' end,
      p.platform_name,'','',method.value,'代收','dictionary'
    from dictionaries d join public.game66_platforms p on p.id=d.platform_id
    cross join lateral pg_catalog.jsonb_each_text(case when pg_catalog.jsonb_typeof(d.pay_methods)='object' then d.pay_methods else '{}'::jsonb end) method
    where d.data_type='charge' and p.team_code in ('hong_kong','red_crab')
  ), names as materialized (
    select * from legacy union select * from dictionary_names
  ), allowed as (
    select distinct n.* from names n
    where private.dashboard_scope_allows(v_scope,private.dashboard_data_group(n.country,n.platform),n.platform)
      and pg_catalog.length(n.country) between 1 and 120
      and pg_catalog.length(n.platform) between 1 and 120
      and pg_catalog.length(n.provider) <= 200 and pg_catalog.length(n.channel) <= 200
      and pg_catalog.length(n.channel_type) <= 120
      and (n.channel<>'' or n.channel_type<>'') and n.direction in ('代收','代付')
      and (n.country||n.platform||n.channel||n.provider||n.channel_type) !~ '[[:cntrl:]]'
    limit 20001
  ) select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(allowed) order by country,platform,channel,direction),'[]'::jsonb)
    into v_rows from allowed;
  if pg_catalog.jsonb_array_length(v_rows)>20000 then
    raise exception using errcode='54000',message='筛选候选目录超出安全上限';
  end if;
  return v_rows;
end;
$$;
create or replace function public.dashboard_third_party_filter_options()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.dashboard_third_party_filter_options() || pg_catalog.jsonb_build_object(
    'candidates',private.dashboard_third_party_filter_candidates())
$$;
revoke all on function private.dashboard_third_party_filter_candidates() from public,anon,authenticated,service_role;
grant execute on function private.dashboard_third_party_filter_candidates() to authenticated;
commit;
