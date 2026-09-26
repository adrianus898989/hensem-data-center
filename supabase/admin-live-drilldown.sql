-- On-demand daily comparison for one selected analytical segment and platform.
-- Apply after configuration-query and provider-filter-performance. This adds
-- independent RPCs only; existing totals/queries, source tables and ACLs stay intact.
-- Source predicates below deliberately match admin-live-query-performance.sql.
-- One range scan yields only a range total and local-day groups. Never page
-- orders or fan out one query per day; the client may cache this scoped result.
begin;
create or replace function private.dashboard_admin_live_drilldown_raw(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  v_kind text; v_hour integer; v_bucket_text text; v_bucket integer; v_cumulative boolean; v_prefix text;
begin
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','offset','limit','view','kind','hour','bucket','cumulative'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  if v_action<>'aggregate' or p_request->>'view' is distinct from 'drilldown' then
    raise exception using errcode='22023',message='invalid_drilldown_view';
  end if;
  v_kind:=p_request->>'kind';
  if jsonb_typeof(p_request->'kind') is distinct from 'string' or v_kind not in('hourly','amount','amount_range','matrix','matrix_range','latency') then
    raise exception using errcode='22023',message='invalid_drilldown_kind';
  end if;
  if v_kind in('hourly','matrix','matrix_range') then
    if jsonb_typeof(p_request->'hour') is distinct from 'number' or p_request->>'hour' !~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
    v_hour:=(p_request->>'hour')::integer;
    if v_hour not between 0 and 23 then raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
  elsif p_request?'hour' then raise exception using errcode='22023',message='unexpected_drilldown_hour';end if;
  if v_kind='latency' then
    if jsonb_typeof(p_request->'bucket') is distinct from 'number' or p_request->>'bucket' !~ '^[0-9]$' then
      raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
    v_bucket:=(p_request->>'bucket')::integer;
    if p_request?'cumulative' and jsonb_typeof(p_request->'cumulative') is distinct from 'boolean' then
      raise exception using errcode='22023',message='invalid_drilldown_cumulative';end if;
    v_cumulative:=coalesce((p_request->>'cumulative')::boolean,false);
    if v_cumulative and v_bucket=9 then raise exception using errcode='22023',message='invalid_drilldown_threshold';end if;
  else
    if p_request?'cumulative' then raise exception using errcode='22023',message='unexpected_drilldown_cumulative';end if;
    if v_kind<>'hourly' then
      if jsonb_typeof(p_request->'bucket') is distinct from 'string' then raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket_text:=p_request->>'bucket';
      if (v_kind in('amount','matrix') and v_bucket_text not in('100','200','300','400','500','750','1000','1500','2000','5000','other','unknown'))
        or (v_kind in('amount_range','matrix_range') and v_bucket_text not in('100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown')) then
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
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit not in (20,30,50,100,500)
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status<>'all' or v_offset<>0 then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if v_utr is not null or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source='ar') then
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
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source<>'ar','utr',false,'historicalFees',false,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source<>'ar');
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
        coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
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
        and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  else
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
        and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))
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
        and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  end if;

  v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
    select direction,currency,status_group,created_at,success_at,
      case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (status_group='success' and success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms
    from orders where ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or amount<=$16)
  )
  $q$;
  if v_kind='latency' then
    v_sql:=v_prefix||$q$, candidates as (
      select *,case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end as duration_bucket
      from filtered where success_in_range
    ), selected as (
      select *,latency_ms is not null and case when $29 then duration_bucket>$28 else duration_bucket=$28 end as segment_match
      from candidates
    ), metrics as (
      select direction,currency,success_local_date as date,
        count(*) filter(where segment_match) as count,
        case when count(*) filter(where segment_match and amount is null)=0
          then coalesce(sum(amount) filter(where segment_match),0) end as amount,
        count(latency_ms) as valid_count,
        case when count(*) filter(where latency_ms is not null and amount is null)=0
          then coalesce(sum(amount) filter(where latency_ms is not null),0) end as valid_amount,
        count(*) as candidate_count,count(*) filter(where latency_ms is null) as excluded_count,
        count(*) filter(where segment_match and amount is null) as missing_amount_count,max(synced_at) as latest_synced_at
      from selected group by grouping sets ((direction,currency),(direction,currency,success_local_date))
    ), output as (
      select date,(to_jsonb(m)-array['amount','valid_amount'])||jsonb_build_object(
        'amount',amount::text,'valid_amount',valid_amount::text,'success_count',count,'success_amount',amount::text,
        'bucket',$28,'cumulative',$29,'count_share',count::numeric/nullif(valid_count,0),
        'amount_share',case when valid_amount>0 then amount/valid_amount end) as value from metrics m
    ) select jsonb_build_object(
      'summary',coalesce((select jsonb_agg(value-'date' order by value->>'direction',value->>'currency') from output where date is null),'[]'::jsonb),
      'groups',jsonb_build_object('daily',coalesce((select jsonb_agg(value order by date,value->>'direction',value->>'currency') from output where date is not null),'[]'::jsonb)),
      'rows','[]'::jsonb)
    $q$;
  else
    v_sql:=v_prefix||$q$, segment as (
      select *,
        created_in_range and ($25 not in('hourly','matrix','matrix_range') or local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27) as created_match,
        success_in_range and ($25 not in('hourly','matrix','matrix_range') or success_local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27) as success_match
      from filtered
    ), contributions as (
      -- Distinct event clocks: never copy a successful event into creation totals.
      select direction,currency,local_date as date,1::bigint as all_count,amount as all_amount,
        (amount is null)::integer as missing_amount_count,(amount<0)::integer as negative_amount_count,
        (status_group='success')::integer as created_success_count,0::bigint as success_count,0::numeric as success_amount,
        (status_group='pending')::integer as pending_count,case when status_group='pending' then amount else 0 end as pending_amount,
        (status_group='failed')::integer as failed_count,case when status_group='failed' then amount else 0 end as failed_amount,
        (status_group='rejected')::integer as rejected_count,case when status_group='rejected' then amount else 0 end as rejected_amount,
        (status_group='unknown')::integer as unknown_count,case when status_group='unknown' then amount else 0 end as unknown_amount,synced_at
      from segment where created_match
      union all
      select direction,currency,success_local_date,0,0,0,0,0,1,amount,0,0,0,0,0,0,0,0,synced_at from segment where success_match
    ), metrics as (
      select direction,currency,date,sum(all_count)::bigint as all_count,
        case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
        sum(missing_amount_count)::bigint as missing_amount_count,coalesce(sum(negative_amount_count),0)::bigint as negative_amount_count,
        sum(created_success_count)::bigint as created_success_count,sum(success_count)::bigint as success_count,
        case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
        sum(pending_count)::bigint as pending_count,
        case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
        sum(failed_count)::bigint as failed_count,
        case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
        sum(rejected_count)::bigint as rejected_count,
        case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
        sum(unknown_count)::bigint as unknown_count,
        case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from contributions group by grouping sets ((direction,currency),(direction,currency,date))
    ), output as (
      select date,(to_jsonb(m)-array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])||jsonb_build_object(
        'all_amount',all_amount::text,'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) as value from metrics m
    ) select jsonb_build_object(
      'summary',coalesce((select jsonb_agg(value-'date' order by value->>'direction',value->>'currency') from output where date is null),'[]'::jsonb),
      'groups',jsonb_build_object('daily',coalesce((select jsonb_agg(value order by date,value->>'direction',value->>'currency') from output where date is not null),'[]'::jsonb)),
      'rows','[]'::jsonb)
    $q$;
  end if;
  execute v_sql into v_result using v_id,v_platform.name,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,
    v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative;
  return v_result||jsonb_build_object('version',1,'platform',v_meta,'basis',case when v_kind='latency' then 'success_at' else 'mixed_created_success' end,
    'total',(select coalesce(sum((r->>case when v_kind='latency' then 'count' else 'all_count' end)::bigint),0) from jsonb_array_elements(v_result->'summary') r),
    'startAt',v_start,'endAt',v_end,'asOf',v_asof,'complete',true,'hasMore',false,
    'segment',jsonb_strip_nulls(jsonb_build_object('kind',v_kind,'hour',v_hour,'bucket',case when v_kind='latency' then to_jsonb(v_bucket) else to_jsonb(v_bucket_text) end,'cumulative',v_cumulative)),
    'capabilities',v_capabilities);
end;
$$;
revoke all on function private.dashboard_admin_live_drilldown_raw(jsonb) from public,anon,authenticated;

create or replace function private.dashboard_admin_live_drilldown(p_request jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.dashboard_admin_live_drilldown_raw(private.dashboard_admin_live_expand_provider_filter(p_request))
$$;
revoke all on function private.dashboard_admin_live_drilldown(jsonb) from public,anon,authenticated;
create or replace function public.dashboard_admin_live_drilldown(p_request jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_drilldown(p_request)$$;
revoke all on function public.dashboard_admin_live_drilldown(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_drilldown(jsonb),public.dashboard_admin_live_drilldown(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
