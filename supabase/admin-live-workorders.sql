-- Read-only work-order daily facts for the private detailed-admin preview.
-- This is a small indexed read model; it never scans the raw order tables and
-- does not change the legacy dashboard or any collector.
begin;

create or replace function private.dashboard_admin_live_workorders(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_start date; v_end date; v_country text; v_platform text; v_provider text;
  v_direction text := 'all'; v_offset integer := 0; v_limit integer := 20;
  v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'startAt','endAt','country','platform','provider','direction','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['country','platform','provider','direction'] loop
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
    -- Work-order facts are keyed by the source's local stat_date. Keep the
    -- date portion supplied by the UI instead of converting through UTC.
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
  v_direction:=coalesce(nullif(p_request->>'direction',''),'all');
  if v_direction not in ('all','charge','withdraw') then
    raise exception using errcode='22023',message='invalid_direction';
  end if;

  with scoped as materialized (
    select w.stat_date,w.country_code,w.country,w.platform,
      coalesce(nullif(btrim(w.third_party),''),'未识别三方') as raw_provider,
      coalesce(nullif(btrim(w.channel_type),''),'未识别通道') as channel_type,
      w.submitted_count,w.submitted_amount,w.success_count,w.success_amount,
      greatest(w.submitted_count-w.success_count,0) as pending_count,
      greatest(w.submitted_amount-w.success_amount,0) as pending_amount,
      w.withdraw_not_received_count,w.withdraw_not_received_amount,
      w.withdraw_success_count,w.withdraw_success_amount,w.source_updated_at,w.updated_at
    from public.workorder_deposit_daily w
    where w.source_system='AR_WORKORDER'
      and w.stat_date between v_start and v_end
      and (v_country is null or w.country_code=v_country or w.country=v_country)
      and (v_platform is null or w.platform=v_platform)
      and private.dashboard_scope_allows(v_scope,w.country_code,w.platform)
  ), mapped as materialized (
    select s.*,coalesce(cm.channel,s.raw_provider) as canonical_provider
    from scoped s
    left join lateral (select case
        when count(distinct nullif(btrim(v.channel),''))=1
          then min(nullif(btrim(v.channel),''))
        else null
      end as channel
      from public.third_party_volume v
      where v.country=s.country and v.platform=s.platform
        and v.raw_channel=s.raw_provider) cm on true
  ), rows as (
    select stat_date,country_code,country,platform,canonical_provider as provider,channel_type,'charge'::text as direction,
      submitted_amount as submitted_amount,submitted_count as submitted_count,
      success_amount as success_amount,success_count as success_count,
      pending_amount as not_received_amount,pending_count as not_received_count,
      source_updated_at,updated_at
    from mapped where v_direction in ('all','charge') and submitted_count>0
      and (v_provider is null or canonical_provider=v_provider)
    union all
    select stat_date,country_code,country,platform,canonical_provider as provider,channel_type,'withdraw'::text,
      (withdraw_not_received_amount+withdraw_success_amount),
      (withdraw_not_received_count+withdraw_success_count),
      withdraw_success_amount,withdraw_success_count,
      withdraw_not_received_amount,withdraw_not_received_count,
      source_updated_at,updated_at
    from mapped where v_direction in ('all','withdraw')
      and (withdraw_not_received_count>0 or withdraw_success_count>0)
      and (v_provider is null or canonical_provider=v_provider)
  ), grouped_rows as (
    select stat_date,country_code,country,platform,provider,channel_type,direction,
      sum(submitted_amount) as submitted_amount,
      sum(submitted_count) as submitted_count,
      sum(success_amount) as success_amount,
      sum(success_count) as success_count,
      sum(not_received_amount) as not_received_amount,
      sum(not_received_count) as not_received_count,
      max(source_updated_at) as source_updated_at,
      max(updated_at) as updated_at
    from rows
    group by stat_date,country_code,country,platform,provider,channel_type,direction
  ), totals as (
    select coalesce(sum(submitted_amount),0) as submitted_amount,
      coalesce(sum(submitted_count),0) as submitted_count,
      coalesce(sum(success_amount),0) as success_amount,
      coalesce(sum(success_count),0) as success_count,
      coalesce(sum(not_received_amount),0) as not_received_amount,
      coalesce(sum(not_received_count),0) as not_received_count
    from grouped_rows
  ), page as (
    select * from grouped_rows order by stat_date desc,platform,provider,channel_type,direction
      offset v_offset limit v_limit
  )
  select jsonb_build_object(
    'version',1,'basis','AR_WORKORDER_daily_read_model','startDate',v_start,'endDate',v_end,
    'offset',v_offset,'limit',v_limit,
    'total',(select count(*) from grouped_rows),
    'hasMore',(select count(*) from grouped_rows)>v_offset::bigint+v_limit,
    'summary',jsonb_build_object(
      'submittedAmount',(select submitted_amount from totals),
      'submittedCount',(select submitted_count from totals),
      'successAmount',(select success_amount from totals),
      'successCount',(select success_count from totals),
      'notReceivedAmount',(select not_received_amount from totals),
      'notReceivedCount',(select not_received_count from totals)),
    'byDirection',coalesce((select jsonb_object_agg(t.direction,jsonb_build_object(
      'submittedAmount',t.submitted_amount,'submittedCount',t.submitted_count,
      'successAmount',t.success_amount,'successCount',t.success_count,
      'notReceivedAmount',t.not_received_amount,'notReceivedCount',t.not_received_count))
      from (select direction,coalesce(sum(submitted_amount),0) as submitted_amount,
        coalesce(sum(submitted_count),0) as submitted_count,coalesce(sum(success_amount),0) as success_amount,
        coalesce(sum(success_count),0) as success_count,coalesce(sum(not_received_amount),0) as not_received_amount,
        coalesce(sum(not_received_count),0) as not_received_count from grouped_rows group by direction) t),'{}'::jsonb),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'date',p.stat_date,'countryCode',p.country_code,'country',p.country,'platform',p.platform,
      'provider',p.provider,'channelType',p.channel_type,'direction',p.direction,
      'submittedAmount',p.submitted_amount,'submittedCount',p.submitted_count,
      'successAmount',p.success_amount,'successCount',p.success_count,
      'notReceivedAmount',p.not_received_amount,'notReceivedCount',p.not_received_count,
      'successRate',case when p.submitted_count>0 then round(p.success_count::numeric/p.submitted_count*100,2) end,
      'sourceUpdatedAt',p.source_updated_at,'updatedAt',p.updated_at)
      order by p.stat_date desc,p.platform,p.provider,p.channel_type,p.direction) from page p),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_workorders(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_workorders(jsonb) to authenticated;

create or replace function public.dashboard_admin_live_workorders(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_workorders(p_request);
$$;
revoke all on function public.dashboard_admin_live_workorders(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_workorders(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
