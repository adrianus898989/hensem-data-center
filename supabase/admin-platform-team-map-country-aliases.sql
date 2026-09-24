-- Align the Panda Brazil source label with the production Supabase read model.
-- The user-facing team/system labels stay unchanged; only the join key is
-- corrected so current Brazil volumes are counted as mapped.
begin;

update public.dashboard_platform_team_map
set source_country='巴西',
    country_name='巴西',
    updated_at=now()
where source_system='PANDA'
  and source_country='胖虎巴西';

notify pgrst,'reload schema';
commit;
