-- Owner confirmed only this legacy source key is the Philippines M8 SUPERLG.
-- Keep the original LG country key and the historical report record unchanged.
begin;
insert into public.dashboard_platform_team_map
 (team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform,metadata)
values ('M8','LG系列','LG','菲律宾','PH','LG','SUPERLG','SUPERLG',
 jsonb_build_object('assignment_confirmation','owner_explicit_2026-09-26','assignment_scope','team_and_display_country_only','source_basis','legacy_operator_daily_2026-07-30'))
on conflict (source_system,source_country,source_platform) do nothing;
do $$
begin
 if (select count(*) from public.dashboard_platform_team_map where source_system='LG' and source_country='LG' and source_platform='SUPERLG'
   and team_name='M8' and system_name='LG系列' and country_name='菲律宾' and country_code='PH' and platform_name='SUPERLG' and active)<>1 then
  raise exception 'confirmed SUPERLG historical source conflicts with existing metadata';
 end if;
end;
$$;
commit;
