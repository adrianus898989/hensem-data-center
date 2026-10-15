-- Pure projection of a validated, immutable providers publication. The caller
-- authorizes the native target and checks generation/dependency/expiry first.
-- Both requests are normalized by prepared_aggregate_canonical_request; this
-- function never reads orders, admits work, or changes either time window.
create or replace function private.dashboard_prepared_provider_projection(
  p_payload jsonb,p_base_request jsonb,p_request jsonb
) returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare
  selected jsonb; summaries jsonb:='[]'::jsonb; result jsonb; bucket record;
  summary jsonb; key text; value numeric; invalid boolean; total numeric;
  providers text[]; country text; platform text; stamp text;
  count_keys constant text[]:=array['all_count','success_count','pending_count','failed_count','rejected_count','unknown_count','missing_amount_count','negative_amount_count','created_success_count'];
  amount_keys constant text[]:=array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'];
begin
  if jsonb_typeof(p_base_request) is distinct from 'object'
    or jsonb_typeof(p_request) is distinct from 'object'
    or p_base_request->>'action' is distinct from 'aggregate'
    or p_request->>'action' is distinct from 'aggregate'
    or p_base_request->>'view' is distinct from 'providers'
    or p_request->>'view' is distinct from 'providers'
    or p_base_request->>'direction' is distinct from 'all'
    or coalesce(p_base_request->>'status','all')<>'all'
    or coalesce(p_request->>'status','all')<>'all'
    or coalesce(p_request->>'direction','') not in ('all','charge','withdraw')
    or (p_base_request-array['providers','direction']) is distinct from (p_request-array['providers','direction'])
    or coalesce(p_base_request->'providers','[]'::jsonb)<>'[]'::jsonb
    or jsonb_typeof(coalesce(p_request->'providers','[]'::jsonb)) is distinct from 'array'
  then raise exception using errcode='22023',message='prepared_projection_scope_mismatch';end if;
  if jsonb_array_length(coalesce(p_request->'providers','[]'::jsonb))>200 or exists(
    select 1 from jsonb_array_elements(coalesce(p_request->'providers','[]'::jsonb)) n
    where jsonb_typeof(n)<>'string' or length(btrim(n#>>'{}')) not between 1 and 200 or (n#>>'{}')~'[[:cntrl:]]'
  ) then raise exception using errcode='22023',message='prepared_projection_invalid_providers';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload->>'version' is distinct from '1'
    or p_payload->'rows' is distinct from '[]'::jsonb
    or jsonb_typeof(p_payload->'summary') is distinct from 'array'
    or jsonb_typeof(p_payload->'groups'->'provider') is distinct from 'array'
    or p_payload ?| array['error','partial','_parts']
    or p_payload->'platform'->>'id' is distinct from p_request->>'platformId'
    or (p_payload->>'startAt')::timestamptz is distinct from (p_request->>'startAt')::timestamptz
    or (p_payload->>'endAt')::timestamptz is distinct from (p_request->>'endAt')::timestamptz
  then raise exception using errcode='22023',message='prepared_projection_invalid_payload';end if;
  -- The publisher/reader validates the full native identity. Require the name
  -- context used by the same existing country/platform alias resolver as live.
  country:=p_payload->'platform'->>'country';platform:=p_payload->'platform'->>'sourceName';
  if nullif(btrim(country),'') is null or nullif(btrim(platform),'') is null then
    raise exception using errcode='22023',message='prepared_projection_invalid_native_identity';end if;
  -- The canonical request carries the effective success clock, including its
  -- native legacy default. Neither clock can be silently exchanged here.
  if p_request ? 'successStartAt' and (
    (p_payload->>'successStartAt')::timestamptz is distinct from (p_request->>'successStartAt')::timestamptz
    or (p_payload->>'successEndAt')::timestamptz is distinct from (p_request->>'successEndAt')::timestamptz
    or p_payload->>'successBasis' is distinct from p_request->>'successBasis'
  ) then raise exception using errcode='22023',message='prepared_projection_success_window_mismatch';end if;
  select array_agg(distinct private.dashboard_admin_live_provider_canonical(country,platform,n)) into providers
    from jsonb_array_elements_text(coalesce(p_request->'providers','[]'::jsonb)) n;
  if exists(select 1 from jsonb_array_elements(p_payload->'groups'->'provider') r
    where jsonb_typeof(r)<>'object' or coalesce(r->>'direction','') not in ('charge','withdraw'))
  then raise exception using errcode='22023',message='prepared_projection_invalid_provider_rows';end if;
  if providers is null and p_request->>'direction'='all' then return p_payload;end if;
  -- Keep the complete original provider row, including fee intervals, evidence,
  -- nulls and monetary precision. Duplicate requested aliases never duplicate it.
  select coalesce(jsonb_agg(r order by n),'[]'::jsonb) into selected
    from jsonb_array_elements(p_payload->'groups'->'provider') with ordinality a(r,n)
    where (p_request->>'direction'='all' or r->>'direction'=p_request->>'direction')
      and (providers is null or private.dashboard_admin_live_provider_canonical(country,platform,r->>'provider')=any(providers));
  for bucket in select r->'direction' direction,r->'currency' currency,jsonb_agg(r) leaves
    from jsonb_array_elements(selected) r group by r->'direction',r->'currency' order by r->'direction',r->'currency'
  loop
    summary:=jsonb_build_object('direction',bucket.direction,'currency',bucket.currency,'provider',null);
    foreach key in array count_keys loop
      if exists(select 1 from jsonb_array_elements(bucket.leaves) r where r ? key)
        or exists(select 1 from jsonb_array_elements(p_payload->'summary') r where r ? key) then
        select bool_or(r->>key is null or coalesce(r->>key,'')!~'^[0-9]+$'),
          sum(case when r->>key~'^[0-9]+$' then (r->>key)::numeric end)
          into invalid,value from jsonb_array_elements(bucket.leaves) r;
        summary:=summary||jsonb_build_object(key,case when invalid then null else value end);
      end if;
    end loop;
    foreach key in array amount_keys loop
      select bool_or(r->>key is null or coalesce(r->>key,'')!~'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'),
        sum(case when r->>key~'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then (r->>key)::numeric end)
        into invalid,value from jsonb_array_elements(bucket.leaves) r;
      summary:=summary||jsonb_build_object(key,case when invalid then null else value::text end);
    end loop;
    select r->>'latest_synced_at' into stamp from jsonb_array_elements(bucket.leaves) r
      where r->>'latest_synced_at' is not null order by (r->>'latest_synced_at')::timestamptz desc limit 1;
    summary:=summary||jsonb_build_object('latest_synced_at',stamp);
    -- Deliberately no fee/distinct-member/rate summation in summary: the kernel
    -- exposes fee facts on provider leaves, and unique people are not additive.
    summaries:=summaries||jsonb_build_array(summary);
  end loop;
  select coalesce(bool_or(r->>'all_count' is null or coalesce(r->>'all_count','')!~'^[0-9]+$'),false),
    coalesce(sum(case when r->>'all_count'~'^[0-9]+$' then (r->>'all_count')::numeric end),0)
    into invalid,total from jsonb_array_elements(selected) r;
  if invalid then total:=null;end if;
  result:=p_payload||jsonb_build_object('summary',summaries,'total',total,'rows','[]'::jsonb,
    'groups',jsonb_build_object('provider',selected));
  -- No whole-platform dimensional data may survive a provider projection.
  if p_payload ? 'latencySummary' then result:=result||jsonb_build_object('latencySummary','[]'::jsonb);end if;
  if p_payload ? 'pendingSummary' then result:=result||jsonb_build_object('pendingSummary','[]'::jsonb);end if;
  if p_payload ? 'hasMore' then result:=result||jsonb_build_object('hasMore',case when total is null then null else total>coalesce((p_payload->>'offset')::bigint,0)+coalesce((p_payload->>'limit')::bigint,20) end);end if;
  return result;
end;
$function$;
revoke all on function private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
