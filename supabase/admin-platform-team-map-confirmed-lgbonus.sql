-- Owner confirmed on 2026-10-21: LGBONUS belongs to M8.
-- Native lg_platform_country explicitly maps LGBONUS to PH. This records only
-- the team/display mapping; it does not create registry, receipts or orders.
begin;
set local lock_timeout='2s';
select pg_advisory_xact_lock(hashtextextended(jsonb_build_array('platform','菲律宾','LGBONUS')::text,0));
do $$
begin
 if public.lg_platform_country('LGBONUS') is distinct from 'PH' then
  raise exception 'LGBONUS native country changed';
 end if;
 if exists(select 1 from public.dashboard_platform_team_map
  where upper(trim(source_platform))='LGBONUS' or upper(trim(platform_name))='LGBONUS'
  group by source_system,source_country,source_platform,platform_name,team_name,system_name,country_name,country_code,active
  having not(source_system='LG' and source_country='菲律宾' and source_platform='LGBONUS'
   and platform_name='LGBONUS' and team_name='M8' and system_name='LG系列'
   and country_name='菲律宾' and country_code='PH' and active))then
  raise exception 'LGBONUS mapping conflicts with owner-confirmed assignment';
 end if;
end;
$$;
insert into public.dashboard_platform_team_map
 (team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform,metadata)
values ('M8','LG系列','LG','菲律宾','PH','菲律宾','LGBONUS','LGBONUS',
 jsonb_build_object('assignment_confirmation','owner_explicit_2026-10-21',
  'assignment_scope','team_and_display_country_only','source_basis','lg_platform_country_explicit_PH'))
on conflict(source_system,source_country,source_platform)do nothing;
do $$
begin
 if(select count(*)from public.dashboard_platform_team_map where source_system='LG'
  and source_country='菲律宾' and source_platform='LGBONUS' and platform_name='LGBONUS'
  and team_name='M8' and system_name='LG系列' and country_name='菲律宾' and country_code='PH' and active)<>1 then
  raise exception 'LGBONUS assignment verification failed';
 end if;
end;
$$;
commit;
