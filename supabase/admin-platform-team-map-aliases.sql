begin;
update public.dashboard_platform_team_map
set source_platform='92.GAME', updated_at=now()
where source_system='AR' and source_country='巴基斯坦' and platform_name='92GAME';
notify pgrst,'reload schema';
commit;
