-- Keep the per-provider canonical lookup index-friendly. Country and platform
-- are already normalized by the Supabase source/read model, so avoid applying
-- lower() to both indexed columns for every aggregate row.
begin;
create or replace function private.dashboard_admin_live_provider_canonical(p_country text,p_platform text,p_raw text)
returns text language sql stable security definer set search_path='' as $$
  select case
    when p_raw is null or btrim(p_raw)='' then p_raw
    when count(distinct nullif(btrim(v.channel),''))=1
      then private.dashboard_admin_live_provider_alias(p_country,min(nullif(btrim(v.channel),'')))
    else private.dashboard_admin_live_provider_alias(p_country,p_raw)
  end
  from public.third_party_volume v
  where v.country=p_country
    and v.platform=p_platform
    and v.raw_channel=p_raw;
$$;
revoke all on function private.dashboard_admin_live_provider_canonical(text,text,text) from public,anon;
grant execute on function private.dashboard_admin_live_provider_canonical(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
