-- Read-only, isolated WG dashboard. No grants on collector base tables.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.dashboard_wg_realtime(
  p_site text,p_start date,p_end date,p_business text,p_basis text,
  p_section text default 'orders',p_page integer default 1,p_size integer default 50,p_query text default ''
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  country_code text; platform_name text; tz text; parent_site text;
  lo timestamptz; hi timestamptz; axis text; tab text; base text; query_sql text;
  output jsonb; total_rows bigint; is_complete boolean:=false; epoch_lo bigint; epoch_hi bigint;
  scope jsonb;
begin
  if (select auth.uid()) is null or public.dashboard_has_permission('auto_withdraw') is not true then
    raise exception using errcode='42501',message='WG_DASHBOARD_PERMISSION_DENIED';
  end if;
  if p_site is null or p_site not in ('278','8311','12588','3257','3605') then
    raise exception using errcode='22023',message='WG_DASHBOARD_INVALID_SITE';
  end if;
  country_code:=case when p_site in ('278','8311','12588') then 'BR' else 'VN' end;
  platform_name:=case p_site when '278' then '26BET' when '8311' then 'POPKKK' when '12588' then 'POPMIU' when '3257' then '98VV' else 'XX98' end;
  tz:=case country_code when 'BR' then 'America/Sao_Paulo' else 'Asia/Ho_Chi_Minh' end;
  parent_site:=case country_code when 'BR' then '278' else '3257' end;
  scope:=private.dashboard_current_data_scope();
  if private.dashboard_scope_allows(scope,country_code,platform_name) is not true then
    raise exception using errcode='42501',message='WG_DASHBOARD_SCOPE_DENIED';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>30
    or p_business is null or p_business not in ('recharge','withdraw')
    or p_basis is null or not ((p_business='recharge' and p_basis in ('created','updated','success')) or (p_business='withdraw' and p_basis in ('created','operated')))
    or p_section is null or p_section not in ('orders','summary','providers','operators','reasons','config','midnight')
    or p_page is null or p_page<1 or p_page>10000 or p_size is null or p_size<1 or p_size>100
    or p_query is null or length(p_query)>128 or p_query ~ '[[:cntrl:]]' then
    raise exception using errcode='22023',message='WG_DASHBOARD_INVALID_QUERY';
  end if;
  lo:=p_start::timestamp at time zone tz; hi:=(p_end+1)::timestamp at time zone tz;
  epoch_lo:=extract(epoch from lo)::bigint; epoch_hi:=extract(epoch from hi)::bigint-1;
  select count(*)=(p_end-p_start+1) and coalesce(bool_and(c.complete),false)
    from public.wg_detail_coverage c where c.site_code=p_site and c.business=p_business and c.basis=p_basis and c.business_date between p_start and p_end
    into is_complete;
  if p_section='config' then
    select count(*) into total_rows from public.wg_realtime_config_daily where site_code=parent_site and observed_local_date between p_start and p_end;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into output from (
      select c.observed_local_date as date,c.observed_at,c.received_at,c.timezone,c.site_code,c.platform,c.country_code,c.parser_version,c.snapshot_id,
        jsonb_build_object('settings',jsonb_build_object('0',c.configuration->'settings'->'0',p_site,c.configuration->'settings'->p_site),
          'dictionaries',c.configuration->'dictionaries','completeness',c.configuration->'completeness') as configuration
      from public.wg_realtime_config_daily c where c.site_code=parent_site and c.observed_local_date between p_start and p_end
      order by c.observed_local_date desc limit p_size offset ((p_page-1)*p_size)
    ) r;
  elsif p_section='midnight' then
    select count(*) into total_rows from public.wg_withdraw_midnight_runs where site_code=p_site and snapshot_date between p_start and p_end;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into output from (
      select snapshot_date as date,scheduled_at,window_start,window_end,status,observed_started_at,observed_finished_at,record_count
      from public.wg_withdraw_midnight_runs where site_code=p_site and snapshot_date between p_start and p_end
      order by snapshot_date desc limit p_size offset ((p_page-1)*p_size)
    ) r;
  else
    tab:=case p_business when 'recharge' then 'wg_recharge_details' else 'wg_withdraw_details' end;
    axis:=case p_basis when 'created' then 'created_at' when 'updated' then 'updated_at' when 'operated' then 'operated_at' else 'success_at' end;
    -- Only fixed table/column identifiers are interpolated. Values are parameters.
    base:=format('select order_number,third_order_number,provider,channel,status_code,status_group,created_at,success_at,updated_at,operated_at,captured_at,member_currency,member_amount,settlement_currency,settlement_amount,settlement_fee,
      business_fields->>''operator_name'' as operator_name,coalesce(business_fields->>''operator_class'',''unknown'') as operator_class,
      business_fields->>''note_state'' as note_state,business_fields->>''remark_sanitized'' as remark,
      case when status_group=''rejected'' then business_fields->>''rejection_reason'' end as rejection_reason,business_fields->>''interception_reason'' as interception_reason,
      business_fields->>''front_note_sanitized'' as front_note,business_fields->>''back_note_sanitized'' as back_note,
      business_fields is not null as business_fields_present,%I as event_at
      from public.%I where site_code=$1 and %I >= $2 and %I < $3 and ($4='''' or order_number=$4 or third_order_number=$4)',axis,tab,axis,axis);
    if p_section='orders' then
      query_sql:='select order_number,third_order_number,provider,channel,status_code,status_group,event_at,created_at,success_at,updated_at,operated_at,captured_at,
        member_currency,member_amount::text,settlement_currency,settlement_amount::text,settlement_fee::text,
        operator_name,operator_class,note_state,remark,rejection_reason,interception_reason,front_note,back_note,business_fields_present from data order by event_at desc,order_number desc';
    elsif p_section in ('summary','providers','operators') then
      query_sql:='select member_currency,settlement_currency,'||
        case p_section when 'providers' then 'coalesce(provider,''未知三方'') as provider,coalesce(channel,''未提供'') as channel,'
          when 'operators' then 'coalesce(operator_name,''未提供'') as operator_name,operator_class,' else '' end||
        'count(*) as count,sum(member_amount)::text as member_amount,sum(settlement_amount)::text as settlement_amount,
        coalesce(sum(member_amount) filter(where status_code='||case p_business when 'recharge' then '2' else '4' end||'),0)::text as success_member_amount,
        coalesce(sum(settlement_amount) filter(where status_code='||case p_business when 'recharge' then '2' else '4' end||'),0)::text as success_settlement_amount,
        count(*) filter(where status_code='||case p_business when 'recharge' then '2' else '4' end||') as success,
        count(*) filter(where status_group=''paying'') as paying,count(*) filter(where status_group=''forced'') as forced,
        count(*) filter(where status_group=''rejected'') as rejected,count(*) filter(where status_group=''failed'') as failed,
        count(*) filter(where status_group=''cancelled'') as cancelled,count(*) filter(where status_group=''pending'') as pending,
        count(*) filter(where status_group=''unknown'') as unknown_status,
        count(*) filter(where operator_class=''auto'') as auto,count(*) filter(where operator_class=''manual'') as manual,
        count(*) filter(where operator_class=''unknown'') as unknown_operator,
        count(*) filter(where not business_fields_present) as missing_business_fields,max(captured_at) as captured_at
        from data group by member_currency,settlement_currency'||case p_section when 'providers' then ',provider,channel' when 'operators' then ',operator_name,operator_class' else '' end||
        ' order by count(*) desc,member_currency,settlement_currency'||case p_section when 'providers' then ',provider,channel' when 'operators' then ',operator_name,operator_class' else '' end;
    else
      query_sql:='select member_currency,reason.kind,reason.label,count(*) as count,
        count(*) filter(where status_code='||case p_business when 'recharge' then '2' else '4' end||') as success,
        count(*) filter(where status_group=''rejected'') as rejected,
        count(*) filter(where operator_class=''auto'') as auto,count(*) filter(where operator_class=''manual'') as manual
        from data cross join lateral (values (''驳回原因'',rejection_reason),(''出款拦截'',interception_reason),
          (''业务备注'',case when rejection_reason is null and interception_reason is null then remark end)) reason(kind,label)
        where reason.label is not null group by member_currency,reason.kind,reason.label order by count(*) desc,member_currency,reason.kind,reason.label';
    end if;
    execute 'with data as ('||base||'), results as ('||query_sql||') select count(*) from results'
      into total_rows using p_site,lo,hi,p_query;
    execute 'with data as ('||base||'), results as ('||query_sql||') select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from (select * from results limit $5 offset $6) r'
      into output using p_site,lo,hi,p_query,p_size,(p_page-1)*p_size;
  end if;
  return jsonb_build_object('source','wg_realtime_only','section',p_section,'site_code',p_site,'platform',platform_name,
    'country',country_code,'timezone',tz,'start',p_start,'end',p_end,'business',p_business,'basis',p_basis,
    'page',p_page,'page_size',p_size,'total',total_rows,'rows',output,
    'coverage',jsonb_build_object('complete',is_complete,'historical_merge',false));
end $$;
revoke all on function public.dashboard_wg_realtime(text,date,date,text,text,text,integer,integer,text) from public,anon;
grant execute on function public.dashboard_wg_realtime(text,date,date,text,text,text,integer,integer,text) to authenticated;
commit;
