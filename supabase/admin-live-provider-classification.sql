-- Group the Supabase third-party read model once per raw name and platform.
-- A raw channel gets one classification for both directions. If the existing
-- source maps the same raw name to more than one canonical value on a platform,
-- expose that as a conflict for review instead of guessing.
begin;

create or replace function private.dashboard_admin_live_provider_config(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_raw text; v_canonical text; v_country text; v_direction text := 'all'; v_status text := 'all';
  v_offset integer := 0; v_limit integer := 20; v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'rawProvider','canonicalProvider','country','direction','status','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['rawProvider','canonicalProvider','country','direction','status'] loop
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
  v_status:=coalesce(nullif(p_request->>'status',''),'all');
  v_offset:=coalesce((p_request->>'offset')::integer,0);
  v_limit:=coalesce((p_request->>'limit')::integer,20);
  if v_direction not in ('all','charge','withdraw') or v_status not in ('all','assigned','unassigned','conflict')
    or v_limit not in (20,30,50,100,500) or v_offset<0 or v_offset>1000000 then
    raise exception using errcode='22023',message='invalid_filter';
  end if;

  with source_rows as materialized (
    select v.country,v.platform,nullif(btrim(v.raw_channel),'') as raw_provider,
      nullif(btrim(v.channel),'') as canonical_provider,v.direction,v.channel_type,
      v.count::bigint as row_count,v.data_date,v.updated_at
    from public.third_party_volume v
    where private.dashboard_scope_allows(v_scope,v.country,v.platform)
  ), names as materialized (
    select s.country,s.platform,s.raw_provider,
      count(distinct s.canonical_provider)::integer as canonical_count,
      min(s.canonical_provider) as canonical_provider,
      coalesce(array_agg(distinct s.canonical_provider order by s.canonical_provider)
        filter(where s.canonical_provider is not null),'{}'::text[]) as canonical_values
    from source_rows s
    group by s.country,s.platform,s.raw_provider
  ), metrics as materialized (
    select s.country,s.platform,s.raw_provider,
      sum(s.row_count)::bigint as matched_count,
      sum(s.row_count) filter(where s.direction='代收')::bigint as charge_count,
      sum(s.row_count) filter(where s.direction='代付')::bigint as withdraw_count,
      count(distinct s.direction)::integer as direction_count,
      coalesce(array_agg(distinct s.direction order by s.direction),'{}'::text[]) as directions,
      coalesce(array_agg(distinct s.channel_type order by s.channel_type)
        filter(where s.channel_type is not null),'{}'::text[]) as channel_types,
      max(s.data_date) as last_data_date,max(s.updated_at) as updated_at
    from source_rows s
    where v_direction='all' or s.direction=case v_direction when 'charge' then '代收' else '代付' end
    group by s.country,s.platform,s.raw_provider
  ), rows as materialized (
    select m.country,m.platform,m.raw_provider,n.canonical_count,n.canonical_provider,n.canonical_values,
      m.matched_count,m.charge_count,m.withdraw_count,m.direction_count,m.directions,m.channel_types,
      m.last_data_date,m.updated_at,
      case when n.canonical_count=0 then 'unassigned' when n.canonical_count=1 then 'assigned' else 'conflict' end as status
    from metrics m join names n using(country,platform,raw_provider)
    where (v_raw is null or m.raw_provider=v_raw)
      and (v_country is null or m.country=v_country)
      and (v_canonical is null or v_canonical=any(n.canonical_values))
  ), filtered as (
    select * from rows where v_status='all' or status=v_status
  ), page as (
    select * from filtered order by country,platform,canonical_provider nulls last,raw_provider
      offset v_offset limit v_limit
  )
  select jsonb_build_object(
    'version',2,'basis','third_party_volume','sourceLabel','Supabase 正式归类读模型',
    'source','Supabase · third_party_volume','total',(select count(*) from filtered),
    'offset',v_offset,'limit',v_limit,'hasMore',(select count(*) from filtered)>v_offset::bigint+v_limit,
    'summary',jsonb_build_object(
      'rawProviders',(select count(*) from rows),
      'assigned',(select count(*) from rows where status='assigned'),
      'unassigned',(select count(*) from rows where status='unassigned'),
      'conflict',(select count(*) from rows where status='conflict')),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'country',p.country,'platform',p.platform,'rawProvider',coalesce(p.raw_provider,'未识别通道'),
      'canonicalProvider',case when p.status='conflict' then '多重归类' else p.canonical_provider end,
      'canonicalProviders',to_jsonb(p.canonical_values),'direction','all','directionLabel','代收 + 代付',
      'directions',to_jsonb(p.directions),'channelTypes',to_jsonb(p.channel_types),
      'chargeCount',p.charge_count,'withdrawCount',p.withdraw_count,'matchedCount',p.matched_count,
      'status',p.status,'source','Supabase · third_party_volume','lastDataDate',p.last_data_date,'updatedAt',p.updated_at)
      order by p.country,p.platform,p.canonical_provider nulls last,p.raw_provider) from page p),'[]'::jsonb),
    'options',jsonb_build_object(
      'countries',coalesce((select jsonb_agg(x.country order by x.country) from (select distinct country from filtered) x),'[]'::jsonb),
      'canonicalProviders',coalesce((select jsonb_agg(x.canonical_provider order by x.canonical_provider)
        from (select distinct canonical_provider from filtered where canonical_provider is not null) x),'[]'::jsonb))
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
