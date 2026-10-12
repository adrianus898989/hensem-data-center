CREATE OR REPLACE FUNCTION private.dashboard_admin_live_analysis_orders_raw(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_basis text; v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  -- custom_analysis_ranges_v1: isolated hour/amount segment, no re-bucketing.
  v_max_exclusive boolean:=false;v_hour_min integer;v_hour_max integer;v_hour_range jsonb;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
  v_kind text; v_hour integer; v_bucket_text text; v_bucket integer; v_cumulative boolean; v_prefix text;
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','hourRange','amountBands','durationVersion','durationRange','offset','limit','basis','kind','hour','bucket','cumulative'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request||jsonb_build_object('action','aggregate','view','drilldown'));
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  v_basis:=p_request->>'basis';
  if v_action<>'analysisOrders' or jsonb_typeof(p_request->'basis') is distinct from 'string'
    or v_basis not in ('created','success') then
    raise exception using errcode='22023',message='invalid_analysis_orders_basis';
  end if;
  -- Keep the independent creation/success source union. The final cohort below
  -- chooses exactly one clock, including success events created on another day.
  v_action:='aggregate';
  v_kind:=p_request->>'kind';
  if jsonb_typeof(p_request->'kind') is distinct from 'string' or v_kind not in('hourly','amount','amount_range','matrix','matrix_range','latency','custom') then
    raise exception using errcode='22023',message='invalid_drilldown_kind';
  end if;
  if v_kind in('hourly','matrix','matrix_range') then
    if jsonb_typeof(p_request->'hour') is distinct from 'number' or p_request->>'hour' !~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
    v_hour:=(p_request->>'hour')::integer;
    if v_hour not between 0 and 23 then raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
  elsif p_request?'hour' then raise exception using errcode='22023',message='unexpected_drilldown_hour';end if;
  if v_kind='latency' then
    if v_duration_custom then
      v_bucket:=null;v_cumulative:=false;
    else
      if jsonb_typeof(p_request->'bucket') is distinct from 'number' or p_request->>'bucket' !~ '^[0-9]{1,2}$' then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket:=(p_request->>'bucket')::integer;
      if v_bucket not between 0 and (case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      if p_request?'cumulative' and jsonb_typeof(p_request->'cumulative') is distinct from 'boolean' then
        raise exception using errcode='22023',message='invalid_drilldown_cumulative';end if;
      v_cumulative:=coalesce((p_request->>'cumulative')::boolean,false);
      if v_cumulative and v_bucket=(case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_threshold';end if;
    end if;
  else
    if p_request?'cumulative' then raise exception using errcode='22023',message='unexpected_drilldown_cumulative';end if;
    if v_kind not in('hourly','custom') then
      if jsonb_typeof(p_request->'bucket') is distinct from 'string' then raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket_text:=p_request->>'bucket';
      if (v_kind in('amount','matrix') and v_bucket_text not in('100','200','300','400','500','750','1000','1500','2000','5000','other','unknown'))
        or (v_kind in('amount_range','matrix_range') and (
          (v_amount_bands is null and v_bucket_text not in('100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown'))
          or (v_amount_bands is not null and v_bucket_text !~ '^(band:[0-9]|below|above|unknown)$'))) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
    elsif p_request?'bucket' then raise exception using errcode='22023',message='unexpected_drilldown_bucket';end if;
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'hourRange' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'hourRange') is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_range:=p_request->'hourRange';
    if exists(select 1 from jsonb_object_keys(v_hour_range) k where k<>all(array['minHour','maxHour']))
      or jsonb_typeof(v_hour_range->'minHour') is distinct from 'number'
      or jsonb_typeof(v_hour_range->'maxHour') is distinct from 'number'
      or coalesce(v_hour_range->>'minHour','')!~ '^[0-9]{1,2}$'
      or coalesce(v_hour_range->>'maxHour','')!~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_min:=(v_hour_range->>'minHour')::integer;v_hour_max:=(v_hour_range->>'maxHour')::integer;
    if v_hour_min not between 0 and 23 or v_hour_max not between 1 and 24 or v_hour_min>=v_hour_max then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
  end if;
  if p_request?'amountMaxExclusive' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then raise exception using errcode='22023',message='invalid_range';end if;
  end if;
  if v_kind='custom' and (v_min<0 or v_max<0 or (v_hour_range is null and v_min is null and v_max is null)) then
    raise exception using errcode='22023',message='invalid_custom_segment';
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit<>20
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status<>'all' then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',false,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    if v_status='success' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    if v_basis='success' or v_kind='latency' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- custom_ar_date_union_v1: latency already reads only its successful clock.
    if v_kind<>'latency' then
      if position($ar_guard$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($25='latency' and n.status_group='success' and n.success_at>=$5 and n.success_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,v_kind='latency');
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($25='latency' and c.status_code='1' and c.pay_time>=$5 and c.pay_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($25='latency' and w.status_code='3' and w.update_time>=$5 and w.update_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;

  if v_kind='latency' and v_basis<>'success' then
    raise exception using errcode='22023',message='invalid_analysis_orders_basis';
  end if;
  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_payment_latency_for_duoli';
  end if;
  if v_platform.source='wg' and v_basis='success' and v_direction<>'charge' then
    raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
  end if;
  if v_kind='latency' then
    -- Materialize only latency inputs. Keep all successful-window candidates,
    -- including invalid durations and other bins, for independent denominators.
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
      select id,system_order_id,order_number,third_party_order_number,member_id,raw_provider,channel_type,status,status_group,created_at,success_at,actual_amount,withdraw_fee,utr,provider,direction,currency,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (success_at at time zone $4)::date as success_local_date,
        case when status_group='success' and isfinite(created_at) and isfinite(success_at) and success_at>=created_at and success_at<=$20
          then extract(epoch from success_at-created_at)*1000 end as latency_ms
      from orders where ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
    )
    $q$;
  else
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
    select id,system_order_id,order_number,third_party_order_number,member_id,raw_provider,channel_type,status,actual_amount,withdraw_fee,utr,provider,direction,currency,status_group,created_at,success_at,
      case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (status_group='success' and success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      case when (case when direction='charge' then $31::numeric[] else $32::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $31::numeric[] else $32::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms
    from orders where ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
  )
  $q$;
  end if;
  -- analysis_segment_orders_v1: stable source keys, numeric money, exact count.
  if v_kind='latency' then
    v_sql:=v_prefix||$q$, candidates as (
      select *,case when $33=2 then case when latency_ms<=60000 then 0 when latency_ms<=180000 then 1 when latency_ms<=300000 then 2 else (case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end)+2 end else case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end end as duration_bucket
      from filtered
    ), provider_names as materialized (
      -- Use the same authoritative mapping as the ordinary provider summary,
      -- once per distinct raw name, never once per order or once per day.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from candidates) names
    ), selected as (
      select c.*,n.provider as canonical_provider,
        latency_ms is not null and case when $36 then ($34 is null or latency_ms>$34) and ($35 is null or latency_ms<=$35) when $29 then duration_bucket>$28 else duration_bucket=$28 end as segment_match
      from candidates c join provider_names n on n.raw_provider=c.provider
    ), eligible as materialized (
      select * from selected where segment_match
    )
    $q$;
  else
    v_sql:=v_prefix||$q$, segment as (
      select *,
        created_in_range and ($25 not in('hourly','matrix','matrix_range') or local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or local_hour>=$38) and ($39 is null or local_hour<$39))) as created_match,
        success_in_range and ($25 not in('hourly','matrix','matrix_range') or success_local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or success_local_hour>=$38) and ($39 is null or success_local_hour<$39))) as success_match
      from filtered
    ), provider_names as materialized (
      -- Map each distinct raw name once, before provider/day grouping.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from segment where created_match or success_match) names
    ), selected as (
      select s.*,n.provider as canonical_provider from segment s
      join provider_names n on n.raw_provider=s.provider where s.created_match or s.success_match
    ), eligible as materialized (
      select * from selected where case when $40::text='success' then success_match else created_match end
    )
    $q$;
  end if;
  v_sql:=v_sql||$q$, page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,canonical_provider as provider,raw_provider,
      channel_type,direction,status,status_group,created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,
      currency,synced_at,utr,latency_ms,case when $40::text='success' then success_at else created_at end as event_at
    from eligible
    order by case when $40::text='success' then success_at else created_at end desc nulls last,direction desc,id desc
    limit $18 offset $17
  ) select jsonb_build_object(
    'total',(select count(*) from eligible),
    'hasMore',(select count(*)>$17+$18 from eligible),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by event_at desc nulls last,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;
  if v_platform.source='duoli' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,case when v_platform.source in('lg','wg','duoli','kb','panda') then v_platform.source_name else v_platform.name end,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,
    v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_hour_min,v_hour_max,v_basis;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  return v_result||jsonb_build_object('version',1,'platform',v_meta,'basis',v_basis,
    'startAt',v_start,'endAt',v_end,'asOf',v_asof,'offset',v_offset,'limit',v_limit,'complete',true,
    'segment',jsonb_strip_nulls(jsonb_build_object('kind',v_kind,'hour',v_hour,'hourRange',v_hour_range,
      'amountMin',v_min,'amountMax',v_max,'amountMaxExclusive',case when v_max is not null then v_max_exclusive end,
      'bucket',case when v_kind='latency' then to_jsonb(v_bucket) else to_jsonb(v_bucket_text) end,
      'cumulative',v_cumulative,'durationRange',case when v_duration_custom then v_duration->'range' end,
      'durationVersion',v_duration_version)),
    'capabilities',v_capabilities);
end;
$function$
