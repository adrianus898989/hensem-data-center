-- Read-only automatic-withdrawal and operator statistics for the private
-- detailed-admin preview. The legacy pages and collectors are untouched.
begin;

-- The existing auto_withdraw_daily_date_country_platform_idx covers this read path.
create index if not exists withdraw_operator_daily_admin_live_idx
  on public.withdraw_operator_daily(data_date,country,platform,account);

create or replace function private.dashboard_admin_live_auto_withdraw(p_request jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_start date; v_end date; v_country text; v_platform text; v_account text;
  v_offset integer := 0; v_limit integer := 20; v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'startAt','endAt','country','platform','account','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['country','platform','account'] loop
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
  v_account:=nullif(btrim(p_request->>'account'),'');

  with daily as materialized (
    select a.data_date,a.country,a.platform,
      coalesce(a.total,0)::bigint as total,coalesce(a.success,0)::bigint as success,
      coalesce(a.rejected,0)::bigint as rejected,coalesce(a.auto_count,0)::bigint as auto_count,
      coalesce(a.manual_count,0)::bigint as manual_count,a.avg_seconds,a.avg_time_text,
      a.source_updated_at,a.updated_at
    from public.auto_withdraw_daily a
    where a.data_date between v_start and v_end
      and (v_country is null or a.country=v_country)
      and (v_platform is null or a.platform=v_platform)
      and private.dashboard_scope_allows(v_scope,a.country,a.platform)
  ), operators as materialized (
    select o.data_date,o.country,o.platform,o.account,
      coalesce(o.processed,0)::bigint as processed,coalesce(o.rejected,0)::bigint as rejected,
      o.avg_seconds,o.avg_time_text,o.source_updated_at,o.updated_at
    from public.withdraw_operator_daily o
    where o.data_date between v_start and v_end
      and (v_country is null or o.country=v_country)
      and (v_platform is null or o.platform=v_platform)
      and (v_account is null or o.account=v_account)
      and private.dashboard_scope_allows(v_scope,o.country,o.platform)
  ), daily_page as (
    select * from daily order by data_date desc,country,platform offset v_offset limit v_limit
  ), operator_page as (
    select * from operators order by data_date desc,country,platform,account offset v_offset limit v_limit
  ), totals as (
    select coalesce(sum(total),0)::bigint as total,coalesce(sum(success),0)::bigint as success,
      coalesce(sum(rejected),0)::bigint as rejected,coalesce(sum(auto_count),0)::bigint as auto_count,
      coalesce(sum(manual_count),0)::bigint as manual_count
    from daily
  )
  select jsonb_build_object(
    'version',1,'source','Supabase auto_withdraw_daily + withdraw_operator_daily',
    'basis','stored_daily_fact_tables','startDate',v_start,'endDate',v_end,
    'offset',v_offset,'limit',v_limit,
    'dailyTotal',(select count(*) from daily),'operatorTotal',(select count(*) from operators),
    'hasMore',(select count(*) from daily)>v_offset::bigint+v_limit or (select count(*) from operators)>v_offset::bigint+v_limit,
    'totals',jsonb_build_object('total',(select total from totals),'success',(select success from totals),
      'rejected',(select rejected from totals),'autoCount',(select auto_count from totals),'manualCount',(select manual_count from totals)),
    'dailyRows',coalesce((select jsonb_agg(jsonb_build_object(
      'dataDate',d.data_date,'country',d.country,'platform',d.platform,'total',d.total,'success',d.success,
      'rejected',d.rejected,'autoCount',d.auto_count,'manualCount',d.manual_count,
      'successRate',case when d.total>0 then round(d.success::numeric/d.total*100,2) end,
      'autoRate',case when d.total>0 then round(d.auto_count::numeric/d.total*100,2) end,
      'avgSeconds',d.avg_seconds,'avgTimeText',d.avg_time_text,'sourceUpdatedAt',d.source_updated_at,'updatedAt',d.updated_at
      ) order by d.data_date desc,d.country,d.platform) from daily_page d),'[]'::jsonb),
    'operatorRows',coalesce((select jsonb_agg(jsonb_build_object(
      'dataDate',o.data_date,'country',o.country,'platform',o.platform,'account',o.account,
      'processed',o.processed,'rejected',o.rejected,
      'successRate',case when o.processed>0 then round(greatest(o.processed-o.rejected,0)::numeric/o.processed*100,2) end,
      'avgSeconds',o.avg_seconds,'avgTimeText',o.avg_time_text,'sourceUpdatedAt',o.source_updated_at,'updatedAt',o.updated_at
      ) order by o.data_date desc,o.country,o.platform,o.account) from operator_page o),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_auto_withdraw(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_auto_withdraw(jsonb) to authenticated;

create or replace function public.dashboard_admin_live_auto_withdraw(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_auto_withdraw(p_request);
$$;
revoke all on function public.dashboard_admin_live_auto_withdraw(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_auto_withdraw(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
