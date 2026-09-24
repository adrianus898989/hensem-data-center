-- Read model for the private detailed-admin deposit-not-received page.
-- Google Sheets is ingested by the sync-deposit-issue-sheet Edge Function;
-- the page itself reads this bounded Supabase table and never scans Google.
begin;

create table if not exists public.admin_deposit_issue_rows (
  id text primary key,
  source_sheet text not null,
  source_tab text not null default 'UPI核对',
  source_row integer not null check (source_row > 0),
  platform text,
  country text,
  order_number text,
  utr text,
  amount numeric(24,2),
  provider text,
  match_status text,
  status text,
  unreceived_days integer,
  record_date date,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (source_sheet, source_tab, source_row)
);

create index if not exists admin_deposit_issue_rows_date_idx
  on public.admin_deposit_issue_rows(record_date desc, platform, provider, status);
create index if not exists admin_deposit_issue_rows_scope_idx
  on public.admin_deposit_issue_rows(country, platform, record_date desc);
create index if not exists admin_deposit_issue_rows_order_idx
  on public.admin_deposit_issue_rows(order_number, utr);

alter table public.admin_deposit_issue_rows enable row level security;
revoke all on public.admin_deposit_issue_rows from public, anon, authenticated;
grant all on public.admin_deposit_issue_rows to service_role;

create or replace function private.dashboard_admin_live_deposit_issues(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_start date; v_end date; v_country text; v_platform text; v_provider text;
  v_status text := 'all'; v_query text; v_offset integer := 0; v_limit integer := 20;
  v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'startAt','endAt','country','platform','provider','status','query','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['country','platform','provider','status','query'] loop
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
  begin
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=left(p_request->>'startAt',10)::date;
    v_end:=left(p_request->>'endAt',10)::date;
    v_offset:=coalesce((p_request->>'offset')::integer,0);
    v_limit:=coalesce((p_request->>'limit')::integer,20);
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_time';
  end;
  if v_start is null or v_end is null or v_start>v_end or v_end-v_start>31
    or v_offset<0 or v_offset>1000000 or v_limit not in (20,30,50,100,500) then
    raise exception using errcode='22023',message='invalid_range';
  end if;
  v_country:=nullif(btrim(p_request->>'country'),'');
  v_platform:=nullif(btrim(p_request->>'platform'),'');
  v_provider:=nullif(btrim(p_request->>'provider'),'');
  v_status:=coalesce(nullif(btrim(p_request->>'status'),''),'all');
  v_query:=nullif(btrim(p_request->>'query'),'');
  if v_status not in ('all','未入款','已入款','待核对') then
    raise exception using errcode='22023',message='invalid_status';
  end if;

  with catalog as materialized (
    select lower(p.name) as lookup_name,p.name,p.country
    from private.dashboard_admin_live_platforms() p
  ), enriched as materialized (
    select r.id,r.source_row,r.platform,r.order_number,r.utr,r.amount,r.provider,
      r.match_status,r.status,r.unreceived_days,r.record_date,r.source_updated_at,r.updated_at,
      coalesce(nullif(btrim(r.country),''),c.country) as display_country
    from public.admin_deposit_issue_rows r
    left join lateral (select c.country from catalog c where c.lookup_name=lower(btrim(r.platform)) limit 1) c on true
    where (r.record_date between v_start and v_end or r.record_date is null and v_start is null)
      and (v_country is null or coalesce(nullif(btrim(r.country),''),c.country)=v_country)
      and (v_platform is null or r.platform=v_platform)
      and (v_provider is null or r.provider=v_provider)
      and (v_status='all' or coalesce(r.status,'')=v_status)
      and (v_query is null or r.order_number ilike '%'||v_query||'%' or r.utr ilike '%'||v_query||'%')
      and private.dashboard_scope_allows(v_scope,coalesce(nullif(btrim(r.country),''),c.country,''),coalesce(r.platform,''))
  ), totals as (
    select count(*)::bigint as count,coalesce(sum(amount),0)::numeric as amount,
      count(*) filter (where coalesce(unreceived_days,0)>0)::bigint as unreceived_count,
      coalesce(max(unreceived_days),0)::integer as max_unreceived_days,
      max(coalesce(source_updated_at,updated_at)) as updated_at
    from enriched
  ), page as (
    select * from enriched order by record_date desc nulls last,platform,provider,source_row
      offset v_offset limit v_limit
  )
  select jsonb_build_object(
    'version',1,'source','Google Sheet UPI核对 -> Supabase admin_deposit_issue_rows',
    'sourceTab','UPI核对','basis','synced_safe_columns','startDate',v_start,'endDate',v_end,
    'offset',v_offset,'limit',v_limit,'total',(select count(*) from enriched),
    'hasMore',(select count(*) from enriched)>v_offset::bigint+v_limit,
    'updatedAt',(select updated_at from totals),
    'summary',jsonb_build_object('count',(select count from totals),'amount',(select amount from totals),
      'unreceivedCount',(select unreceived_count from totals),'maxUnreceivedDays',(select max_unreceived_days from totals)),
    'facets',jsonb_build_object('providers',coalesce((select jsonb_agg(provider order by provider) from (select distinct provider from enriched where provider is not null and provider<>'') x),'[]'::jsonb)),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'recordDate',p.record_date,'country',p.display_country,'platform',p.platform,'provider',p.provider,
      'orderNumber',p.order_number,'utr',p.utr,'amount',p.amount,'unreceivedDays',p.unreceived_days,
      'matchStatus',p.match_status,'status',p.status,'sourceUpdatedAt',p.source_updated_at,'updatedAt',p.updated_at)
      order by p.record_date desc nulls last,p.platform,p.provider,p.source_row) from page p),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_deposit_issues(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_deposit_issues(jsonb) to authenticated;

create or replace function public.dashboard_admin_live_deposit_issues(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_deposit_issues(p_request);
$$;
revoke all on function public.dashboard_admin_live_deposit_issues(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_deposit_issues(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
