CREATE OR REPLACE FUNCTION private.dashboard_admin_live_member_daily(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_platform record; v_id uuid; v_start timestamptz; v_end timestamptz;
  v_direction text; v_currency text; v_key text; v_request jsonb;
  v_providers text[]; v_confirmations jsonb:='{}'::jsonb;
  v_created boolean:=coalesce(p_request->>'successBasis'='created',false); v_basis text; v_axis text; v_source text; v_sources text[]:='{}'; v_sql text; v_rows jsonb;
begin
  -- Same fresh Auth/profile/preview grant as the existing live order reader.
  -- The authorized catalog retains raw source identity and excludes disabled,
  -- future and replaced legacy order sources.
  perform private.dashboard_admin_live_scope();
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'platformId','startAt','endAt','direction','providers','currency','successBasis'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  if p_request?'successBasis'and(p_request->>'successBasis'is distinct from'created')then raise exception using errcode='22023',message='invalid_member_success_basis';end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','currency'] loop
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
    v_start:=(p_request->>'startAt')::timestamptz;v_end:=(p_request->>'endAt')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  select * into v_platform from private.dashboard_admin_live_platforms() p where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied';end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days' then
    raise exception using errcode='22023',message='invalid_range';
  end if;
  v_direction:=coalesce(p_request->>'direction','all');v_currency:=nullif(btrim(p_request->>'currency'),'');
  if v_direction not in ('all','charge','withdraw') then raise exception using errcode='22023',message='invalid_direction';end if;
  if p_request ? 'providers' and p_request->'providers'<>'null'::jsonb then
    if jsonb_typeof(p_request->'providers')<>'array' or jsonb_array_length(p_request->'providers')>200
      or exists(select 1 from jsonb_array_elements(p_request->'providers') a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end if;
  -- Expand canonical provider selections using the exact existing order-reader
  -- mapping. All selected providers enter one DISTINCT set, never summed sets.
  v_request:=private.dashboard_admin_live_expand_provider_filter(p_request);
  if jsonb_typeof(v_request->'providers')='array' and jsonb_array_length(v_request->'providers')>0 then
    select array_agg(value) into v_providers from jsonb_array_elements_text(v_request->'providers');
  end if;
  -- duoli_existing_members_v1: reuse the authorized native catalog identity.
  if v_platform.source='duoli' then
    return private.dashboard_admin_duoli_member_daily(to_jsonb(v_platform)||case when v_created then jsonb_build_object('memberSuccessBasis','created')else '{}'::jsonb end,v_start,v_end,v_direction,v_providers,v_currency);
  end if;
  -- wg_existing_members_v1: preserve all original source implementations.
  if v_platform.source='wg' then
    return private.dashboard_admin_wg_member_daily(to_jsonb(v_platform)||case when v_created then jsonb_build_object('memberSuccessBasis','created')else '{}'::jsonb end,v_start,v_end,v_direction,v_providers,v_currency);
  end if;
  if v_platform.source='ar' and v_providers is not null
    and to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
    execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
      from private.dashboard_admin_order_provider_confirmations where source_system=$1 and country_code=$2 and platform=$3 and active'
      into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
  end if;

  -- Separate indexed creation/success scans preserve cross-day successes. The
  -- axes below are internal constants; every request value is a bound parameter.
  foreach v_basis in array array['created','success'] loop
    if v_platform.source='ar' and v_providers is null then
      -- member_daily_read_performance_v1: expose exact kind/status predicates
      -- to the existing partial covering indexes; keep both event clocks.
      v_axis:=case when v_basis='created'or v_created then 'applied_at' else 'completed_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,a.$axis$ at time zone $4 as event_at,
          'charge'::text as direction,a.member_id,null::text as provider,$10::text as currency
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and $6 in ('all','charge') and a.order_kind='recharge'
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4) $charge_success$
        union all
        select '$basis$'::text,a.$axis$ at time zone $4,'withdraw',a.member_id,null::text,$10::text
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and $6 in ('all','withdraw') and a.order_kind='withdraw'
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4) $withdraw_success$
      $q$;
      v_source:=replace(replace(v_source,
        '$charge_success$',case v_basis when 'success' then 'and a.status=''已支付''' else '' end),
        '$withdraw_success$',case v_basis when 'success' then 'and a.status=''已通过''' else '' end);
    elsif v_platform.source='ar' then
      v_axis:=case when v_basis='created'or v_created then 'applied_at' else 'completed_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,a.$axis$ at time zone $4 as event_at,
          case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.member_id,
          case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
            and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
            else coalesce(nullif(btrim(a.raw_channel),''),$9->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
          $10::text as currency
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and a.order_kind=any(case $6 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4)
      $q$;
      if v_basis='success' then v_source:=v_source||$q$ and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))$q$;end if;
    elsif v_platform.source='newar' then
      v_axis:=case when v_basis='created'or v_created then 'created_at' else 'success_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,n.$axis$ as event_at,n.dataset as direction,n.member_id,
          case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
            when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
            else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,n.currency
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where n.platform=$3 and n.dataset=any(case $6 when 'all' then array['charge','withdraw'] else array[$6] end)
          and n.$axis$>=$5 and n.$axis$<$11 and (t.launch_at is null or n.created_at>=t.launch_at)
      $q$;
      if v_basis='success' then v_source:=v_source||$q$ and n.status_group='success'$q$;end if;
    elsif v_platform.source='lg' then
      v_axis:=case when v_basis='created'or v_created then 'created_at' else 'paid_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,l.$axis$ as event_at,
          case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.member_id,
          coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,$10::text as currency
        from public.lg_orders l where l.country_code=$2 and l.platform=$3 and l.source_system='LG'
          and l.order_kind=any(case $6 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
          and l.$axis$>=$5 and l.$axis$<$11
      $q$;
      if v_basis='success' then v_source:=v_source||$q$ and l.status_class='success'$q$;end if;
    elsif v_platform.source='kb' then
      v_axis:=case when v_basis='created'or v_created then 'created_at' else 'completed_at' end;
      v_source:=replace(replace(replace($q$
       select '$basis$'::text basis,y.$axis$ event_at,
        case y.order_type when 'deposit' then 'charge' else 'withdraw' end direction,
        y.uid member_id,private.dashboard_admin_yash_order_provider(y.order_type,y.supplier,y.channel) provider,y.currency
       from private.yash_orders y where $2='IN' and $3='YASH.BET' and y.source_site='yash'
        and y.order_type=any(case $6 when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
        and y.$axis$ >= $5 and y.$axis$ < $11 $success$
       $q$,'$basis$',v_basis),'$axis$',v_axis),'$success$',case when v_basis='success' then
        case when v_created then 'and private.dashboard_admin_yash_status(y.order_type,y.status)=''success'''else 'and private.dashboard_admin_yash_completed_at(y.order_type,y.status,y.created_at,y.completed_at,statement_timestamp()) is not null'end else '' end);
    elsif v_platform.source='game66' then
      v_source:=$q$
        select '$basis$'::text as basis,c.$charge_axis$ as event_at,'charge'::text as direction,c.uid as member_id,
          coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,'INR'::text as currency
        from public.game66_charge_orders c where c.platform_id=$1 and $6 in ('all','charge')
          and c.$charge_axis$>=$5 and c.$charge_axis$<$11 $charge_success$
        union all
        select '$basis$'::text,w.$withdraw_axis$,'withdraw',w.uid,
          case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
            else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,'INR'
        from public.game66_withdraw_orders w where w.platform_id=$1 and $6 in ('all','withdraw')
          and w.$withdraw_axis$>=$5 and w.$withdraw_axis$<$11 $withdraw_success$
      $q$;
      v_source:=replace(replace(replace(replace(v_source,
        '$charge_axis$',case when v_basis='created'or v_created then 'create_time' else 'pay_time' end),
        '$withdraw_axis$',case when v_basis='created'or v_created then 'create_time' else 'update_time' end),
        '$charge_success$',case v_basis when 'success' then 'and c.status_code=''1''' else '' end),
        '$withdraw_success$',case v_basis when 'success' then 'and w.status_code=''3''' else '' end);
    else
      raise exception using errcode='22023',message='unsupported_source';
    end if;
    v_sources:=array_append(v_sources,replace(replace(v_source,'$basis$',v_basis),'$axis$',coalesce(v_axis,'')));
  end loop;

  v_sql:='with events as ('||array_to_string(v_sources,' union all ')||$q$), filtered as (
    select basis,(event_at at time zone $4)::date as date,direction,nullif(btrim(member_id),'') as member_id
    from events where ($7::text[] is null or provider=any($7)) and ($8::text is null or currency=$8)
  ), member_orders as (
    -- member_daily_single_group_v1: include NULL IDs to preserve missing-order
    -- coverage; they never count as a member or a frequency-threshold member.
    select date,direction,member_id,
      count(*) filter(where basis='created') as created_count,
      count(*) filter(where basis='success') as success_count
    from filtered group by date,direction,member_id
  ), counts as (
    select date,direction,
      count(*) filter(where member_id is not null and created_count>0) as created_member_count,
      count(*) filter(where member_id is not null and success_count>0) as success_member_count,
      sum(created_count) as created_order_count,
      sum(success_count) as success_order_count,
      coalesce(sum(created_count) filter(where member_id is null),0) as created_missing_member_count,
      coalesce(sum(success_count) filter(where member_id is null),0) as success_missing_member_count,
      count(*) filter(where member_id is not null and created_count>=2) as created_members_ge2,
      count(*) filter(where member_id is not null and created_count>=3) as created_members_ge3,
      count(*) filter(where member_id is not null and created_count>=4) as created_members_ge4,
      count(*) filter(where member_id is not null and created_count>=5) as created_members_ge5,
      count(*) filter(where member_id is not null and success_count>=2) as success_members_ge2,
      count(*) filter(where member_id is not null and success_count>=3) as success_members_ge3,
      count(*) filter(where member_id is not null and success_count>=4) as success_members_ge4,
      count(*) filter(where member_id is not null and success_count>=5) as success_members_ge5
    from member_orders group by date,direction
  ), days as (
    select d::date as date from generate_series(($5 at time zone $4)::date::timestamp,
      (($11-interval '1 microsecond') at time zone $4)::date::timestamp,interval '1 day') d
  ), rows as (
    select days.date,d.direction,coalesce(c.created_member_count,0) as created_member_count,
      coalesce(c.success_member_count,0) as success_member_count,
      coalesce(c.created_order_count,0) as created_order_count,coalesce(c.success_order_count,0) as success_order_count,
      coalesce(c.created_missing_member_count,0) as created_missing_member_count,
      coalesce(c.success_missing_member_count,0) as success_missing_member_count,
      coalesce(c.created_members_ge2,0) as created_members_ge2,
      coalesce(c.created_members_ge3,0) as created_members_ge3,
      coalesce(c.created_members_ge4,0) as created_members_ge4,
      coalesce(c.created_members_ge5,0) as created_members_ge5,
      coalesce(c.success_members_ge2,0) as success_members_ge2,
      coalesce(c.success_members_ge3,0) as success_members_ge3,
      coalesce(c.success_members_ge4,0) as success_members_ge4,
      coalesce(c.success_members_ge5,0) as success_members_ge5
    from days cross join unnest(case $6 when 'all' then array['charge','withdraw'] else array[$6] end) d(direction)
    left join counts c on c.date=days.date and c.direction=d.direction
  ) select coalesce(jsonb_agg(to_jsonb(r) order by r.date,r.direction),'[]'::jsonb) from rows r$q$;
  execute v_sql into v_rows using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,
    v_start,v_direction,v_providers,v_currency,v_confirmations,v_platform.currency,v_end;
  return jsonb_build_object('version',1,'asOf',statement_timestamp(),'startAt',v_start,'endAt',v_end,
    'platform',jsonb_build_object('id',v_platform.id,'name',v_platform.name,'country',v_platform.country,
      'team',v_platform.team,'source',v_platform.source,'sourceName',v_platform.source_name,
      'scopeGroup',v_platform.scope_group,'timezone',v_platform.timezone,'currency',v_platform.currency),
    'rows',v_rows,'capabilities',jsonb_build_object('memberIdentity',true,'createdBasis','created_at',
      'successBasis',case when v_created then 'created_at_current_stored_status'else 'success_at'end,'dedupe','platform_local_date_direction_member',
      'sourceCompletenessVerified',false,'periodTotal','sum_daily_unique_member_visits',
      'frequencyBasis','per_platform_local_day_order_count','frequencyThresholds',jsonb_build_array(2,3,4,5))||case when v_created then jsonb_build_object('successCohort','created_at_current_stored_status','independentSuccessWindow',false)else '{}'::jsonb end)||case when v_created then jsonb_build_object('successBasis','created')else '{}'::jsonb end;
end;
$function$
