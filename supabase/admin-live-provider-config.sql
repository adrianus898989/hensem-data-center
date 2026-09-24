-- Supabase-backed third-party classification view for the private detailed admin.
-- third_party_volume is the published, canonicalized read model. This avoids
-- presenting the old Google snapshot label as the source of current data.
begin;

create or replace function private.dashboard_admin_live_provider_config(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_raw text; v_canonical text; v_country text; v_direction text := 'all';
  v_offset integer := 0; v_limit integer := 20; v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'rawProvider','canonicalProvider','country','direction','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['rawProvider','canonicalProvider','country','direction'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200
       or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  foreach v_key in array array['offset','limit'] loop
    if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number'
      or p_request->>v_key !~ '^[0-9]{1,7}$') then
      raise exception using errcode='22023',message='invalid_pagination';
    end if;
  end loop;
  v_raw:=nullif(btrim(p_request->>'rawProvider'),'');
  v_canonical:=nullif(btrim(p_request->>'canonicalProvider'),'');
  v_country:=nullif(btrim(p_request->>'country'),'');
  v_direction:=coalesce(nullif(p_request->>'direction',''),'all');
  v_offset:=coalesce((p_request->>'offset')::integer,0);
  v_limit:=coalesce((p_request->>'limit')::integer,20);
  if v_direction not in ('all','charge','withdraw') or v_limit not in (20,30,50,100,500)
    or v_offset<0 or v_offset>1000000 then
    raise exception using errcode='22023',message='invalid_filter';
  end if;
  with grouped as materialized (
    select v.country,v.platform,v.raw_channel,v.channel,v.direction,v.channel_type,
      sum(v.count)::bigint as matched_count,max(v.data_date) as last_data_date,max(v.updated_at) as updated_at
    from public.third_party_volume v
    where private.dashboard_scope_allows(v_scope,v.country,v.platform)
      and (v_raw is null or v.raw_channel=v_raw)
      and (v_canonical is null or v.channel=v_canonical)
      and (v_country is null or v.country=v_country)
      and (v_direction='all' or v.direction=case v_direction when 'charge' then '代收' else '代付' end)
    group by v.country,v.platform,v.raw_channel,v.channel,v.direction,v.channel_type
  ), page as (
    select * from grouped order by country,platform,channel nulls last,raw_channel,direction,channel_type
      offset v_offset limit v_limit
  )
  select jsonb_build_object(
    'version',1,'basis','third_party_volume','sourceLabel','Supabase 正式归类读模型',
    'total',(select count(*) from grouped),'offset',v_offset,'limit',v_limit,
    'hasMore',(select count(*) from grouped)>v_offset::bigint+v_limit,
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'country',p.country,'platform',p.platform,'rawProvider',p.raw_channel,
      'canonicalProvider',nullif(p.channel,''),'direction',case p.direction when '代收' then 'charge' else 'withdraw' end,
      'directionLabel',p.direction,'channelType',p.channel_type,'matchedCount',p.matched_count,
      'status',case when nullif(p.channel,'') is null then 'unassigned' else 'assigned' end,
      'source','Supabase · third_party_volume','lastDataDate',p.last_data_date,'updatedAt',p.updated_at)
      order by p.country,p.platform,p.channel nulls last,p.raw_channel,p.direction,p.channel_type) from page p),'[]'::jsonb),
    'options',jsonb_build_object(
      'countries',coalesce((select jsonb_agg(x.country order by x.country) from (select distinct country from grouped) x),'[]'::jsonb),
      'canonicalProviders',coalesce((select jsonb_agg(x.channel order by x.channel) from (select distinct channel from grouped where nullif(channel,'') is not null) x),'[]'::jsonb))
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_provider_config(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_provider_config(jsonb) to authenticated;

create or replace function public.dashboard_admin_live_provider_config(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_provider_config(p_request);
$$;
revoke all on function public.dashboard_admin_live_provider_config(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_provider_config(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
