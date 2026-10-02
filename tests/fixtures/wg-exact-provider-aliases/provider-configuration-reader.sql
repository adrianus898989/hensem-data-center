-- Production reader definition only, no business rows; unchanged by this migration.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_config(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb; v_key text; v_limit integer:=20; v_offset integer:=0;
begin
  perform private.dashboard_admin_live_scope();
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['country','platform','rawProvider','canonicalProvider','direction','status','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  for v_key in select jsonb_object_keys(p_request-array['offset','limit']) loop
    if jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]' then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  foreach v_key in array array['offset','limit'] loop
    if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then
      raise exception using errcode='22023',message='invalid_pagination';
    end if;
  end loop;
  v_limit:=coalesce((p_request->>'limit')::integer,20);v_offset:=coalesce((p_request->>'offset')::integer,0);
  if v_limit not in(20,30,50,100,500) or v_offset>1000000
    or coalesce(p_request->>'direction','all') not in('all','charge','withdraw')
    or coalesce(p_request->>'status','all') not in('all','assigned','unassigned','conflict') then
    raise exception using errcode='22023',message='invalid_filter';
  end if;
  with allowed as materialized (select * from private.dashboard_admin_live_provider_rows()),
  filtered as materialized (select * from allowed r
    where (nullif(p_request->>'country','') is null or r.country=p_request->>'country')
      and (nullif(p_request->>'platform','') is null or r.platform=p_request->>'platform')
      and (nullif(p_request->>'rawProvider','') is null or position(lower(p_request->>'rawProvider') in lower(r.raw_provider))>0)
      and (nullif(p_request->>'canonicalProvider','') is null or position(lower(p_request->>'canonicalProvider') in lower(r.canonical_provider))>0)
      and (coalesce(p_request->>'direction','all')='all' or case p_request->>'direction' when 'charge' then '代收' else '代付' end=any(r.directions))
      and (coalesce(p_request->>'status','all')='all' or r.status=p_request->>'status')),
  page as (select * from filtered order by country,platform,raw_provider offset v_offset limit v_limit)
  select jsonb_build_object('version',3,'canManage',private.dashboard_admin_live_can_configure(),
    'canGrant',exists(select 1 from public.dashboard_profiles where auth_user_id=auth.uid() and active and role='owner'),
    'total',(select count(*) from filtered),'offset',v_offset,'limit',v_limit,
    'summary',jsonb_build_object('rawProviders',(select count(*) from filtered),'assigned',(select count(*) from filtered where status='assigned'),
      'unassigned',(select count(*) from filtered where status='unassigned'),'conflict',(select count(*) from filtered where status='conflict')),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('country',r.country,'platform',r.platform,'rawProvider',r.raw_provider,
      'canonicalProvider',r.canonical_provider,'canonicalProviders',r.canonical_values,'directions',r.directions,
      'chargeCount',r.charge_count,'withdrawCount',r.withdraw_count,'matchedCount',r.matched_count,'lastDataDate',r.last_data_date,
      'updatedAt',r.updated_at,'status',r.status,'version',r.version,'manual',r.manual) order by r.country,r.platform,r.raw_provider) from page r),'[]'::jsonb),
    'options',jsonb_build_object('countries',(select jsonb_agg(c order by c) from (select distinct country c from allowed) t),
      'platforms',(select jsonb_agg(p order by p) from (select distinct platform p from allowed where nullif(p_request->>'country','') is null or country=p_request->>'country') t),
      'canonicalProviders',(select jsonb_agg(c order by c) from (select distinct canonical_provider c from allowed where canonical_provider is not null) t))) into v_result;
  return v_result;
end;
$function$;
