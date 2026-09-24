-- Align known source spellings with the live Supabase platform values while
-- preserving the user-facing platform labels from the supplied M8 registry.
begin;

update public.dashboard_platform_team_map
set source_platform='DHANIWIN', updated_at=now()
where source_system='NEW_AR' and source_country='印度'
  and platform_name='DHANIWIN';

update public.dashboard_platform_team_map
set source_platform='SHREE.WIN', updated_at=now()
where source_system='AR' and source_country='印度'
  and platform_name='SHREEWIN';

update public.dashboard_platform_team_map
set source_platform='VEER.GAME', updated_at=now()
where source_system='AR' and source_country='印度'
  and platform_name='VEERGAME';

notify pgrst,'reload schema';
commit;
