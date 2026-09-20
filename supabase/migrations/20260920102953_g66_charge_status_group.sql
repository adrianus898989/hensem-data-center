-- G66-v37 charge 0 means failed; EK charge 0 means pending.
-- Preserve the collector-validated group for this code only. No order writes,
-- successful amounts, success-time rules, API signatures or permissions change.
create or replace function private.dashboard_uploaded_order_query(
  p_mode text,p_platform uuid,p_start_at timestamptz,p_end_at timestamptz,
  p_basis text,p_direction text,p_created_start timestamptz,p_created_end timestamptz,
  p_providers text[],p_types text[],p_cursor jsonb,p_limit integer,
  p_member_id text,p_order_number text,p_status text,p_cross_day_only boolean,
  p_amount_min numeric,p_amount_max numeric,p_reference_start timestamptz
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_platform record; v_options jsonb; v_sql text; v_tail text; v_rows jsonb; v_more boolean;
  v_axis text; v_withdraw_axis text; v_cursor_at timestamptz; v_cursor_id uuid;
  v_member text:=nullif(btrim(p_member_id),''); v_order text:=nullif(btrim(p_order_number),'');
  v_reference timestamptz:=coalesce(p_reference_start,p_start_at);
begin
  -- The catalog checks auth, module permission and the current data scope.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.country,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_uploaded_order_platforms() p;
  if p_mode='aggregate' and p_platform is null then
    return jsonb_build_object('platforms',v_options,'rows','[]'::jsonb,'timezone','Asia/Kolkata');
  end if;
  if p_platform is null then raise exception using errcode='22023',message='请选择单个平台'; end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,country_code text,source text,timezone text,currency text)
    where p.id=p_platform;
  if not found then raise exception using errcode='42501',message='无权查看此平台或尚无已上传明细'; end if;
  if p_mode not in ('aggregate','details','search') or p_mode is null
    or p_basis is null or p_basis not in ('created','success')
    or p_direction is null or p_direction not in ('all','charge','withdraw')
    or p_start_at is null or p_end_at is null or not isfinite(p_start_at) or not isfinite(p_end_at)
    or p_start_at>=p_end_at
    or (p_end_at at time zone v_platform.timezone)-(p_start_at at time zone v_platform.timezone)>interval '31 days'
    or not isfinite(v_reference) or v_reference>p_start_at
    or (p_end_at at time zone v_platform.timezone)-(v_reference at time zone v_platform.timezone)>interval '31 days'
    or (p_created_start is not null and not isfinite(p_created_start))
    or (p_created_end is not null and not isfinite(p_created_end))
    or (p_created_start is not null and p_created_end is not null and p_created_start>=p_created_end)
    or (p_basis='created' and (p_created_start is not null or p_created_end is not null))
    or p_status is null or p_status not in ('all','success','pending','failed','rejected','unknown')
    or p_cross_day_only is null or length(v_member)>200 or length(v_order)>200
    or (p_mode<>'aggregate' and (p_limit is null or p_limit<1 or p_limit>case p_mode when 'search' then 50 else 200 end))
    or coalesce(cardinality(p_providers),0)>200 or coalesce(cardinality(p_types),0)>200 then
    raise exception using errcode='22023',message=case when p_mode='aggregate'
      then '时间范围无效或查询条件不支持；一次查询最多31天' else '无效查询条件；一次查询最多31天' end;
  end if;
  if (p_amount_min is not null and (p_amount_min<0 or p_amount_min::text in ('NaN','Infinity','-Infinity')))
    or (p_amount_max is not null and (p_amount_max<0 or p_amount_max::text in ('NaN','Infinity','-Infinity')))
    or (p_amount_min is not null and p_amount_max is not null and p_amount_min>p_amount_max) then
    raise exception using errcode='22023',message='无效金额范围';
  end if;
  if p_cursor is not null then
    begin
      v_cursor_at:=(p_cursor->>'at')::timestamptz; v_cursor_id:=(p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='无效分页位置';
    end;
    if jsonb_typeof(p_cursor)<>'object' or v_cursor_at is null or v_cursor_id is null or not isfinite(v_cursor_at)
      or p_cursor->>'direction' is null or p_cursor->>'direction' not in ('charge','withdraw') then
      raise exception using errcode='22023',message='无效分页位置';
    end if;
  end if;
  if v_platform.source='ar' then
    v_axis:=case p_basis when 'created' then 'applied_at' else 'completed_at' end;
    v_sql:=format($q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        a.%1$I at time zone $4 as axis,case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,
        a.order_no as order_number,a.member_id,null::text as third_party_order_number,
        coalesce(nullif(btrim(a.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,a.status,a.status as status_code,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case a.status when '已通过' then 'success' when '已提交' then 'pending' when '未通过' then 'rejected' else 'unknown' end end as status_group,
        coalesce((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'),false) as succeeded,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        a.amount,null::numeric as actual_amount,null::numeric as withdraw_fee,a.updated_at as synced_at,$22::text as currency,
        a.amount_text
      from public.ar_collected_orders a
      where a.country_code=$3 and a.platform=$2 and a.source_system='AR'
        and a.order_kind=any(case $8 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and a.%1$I>=($5 at time zone $4) and a.%1$I<($6 at time zone $4)
        and ($7='created' or (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and ($9 is null or a.applied_at>=($9 at time zone $4)) and ($10 is null or a.applied_at<($10 at time zone $4))
        and ($11 is null or a.member_id=$11) and ($12 is null or a.order_no=$12)
        and ($17 is null or a.%1$I<=((($17->>'at')::timestamptz) at time zone $4))
    $q$,v_axis);
  elsif v_platform.source='newar' then
    v_axis:=case p_basis when 'created' then 'created_at' else 'success_at' end;
    v_sql:=format($q$
      select n.id,n.%1$I as axis,n.dataset as direction,n.order_number,n.member_id,n.third_party_order_number,
        coalesce(nullif(btrim(n.provider),''),'未识别通道') as provider,
        coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.status_code as status,n.status_code,n.status_group,coalesce(n.status_group='success',false) as succeeded,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.received_at as synced_at,n.currency,null::text as amount_text
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$2 and n.dataset=any(case $8 when 'all' then array['charge','withdraw'] else array[$8] end)
        and n.%1$I>=$5 and n.%1$I<$6 and ($7='created' or n.status_group='success')
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.created_at>=$9) and ($10 is null or n.created_at<$10)
        and ($11 is null or n.member_id=$11)
        and ($12 is null or n.order_number=$12 or n.third_party_order_number=$12 or n.source_id=$12)
        and ($17 is null or n.%1$I<=($17->>'at')::timestamptz)
        and ($23='search' or n.currency=$22)
    $q$,v_axis);
  else
    v_axis:=case p_basis when 'created' then 'create_time' else 'pay_time' end;
    v_withdraw_axis:=case p_basis when 'created' then 'create_time' else 'update_time' end;
    v_sql:=format($q$
      select c.id,c.%1$I as axis,'charge'::text as direction,c.order_num as order_number,c.uid as member_id,c.out_trade_no as third_party_order_number,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        coalesce(nullif(c.status_text,''),c.status_code) as status,c.status_code,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end
          else 'unknown' end as status_group,
        coalesce(c.status_code='1',false) as succeeded,c.create_time as created_at,
        case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        c.last_seen_at as synced_at,'INR'::text as currency,null::text as amount_text
      from public.game66_charge_orders c where c.platform_id=$1 and $8 in ('all','charge')
        and c.%1$I>=$5 and c.%1$I<$6 and ($7='created' or c.status_code='1')
        and ($9 is null or c.create_time>=$9) and ($10 is null or c.create_time<$10)
        and ($11 is null or c.uid=$11) and ($12 is null or c.order_num=$12 or c.out_trade_no=$12)
        and ($17 is null or c.%1$I<=($17->>'at')::timestamptz)
      union all
      select w.id,w.%2$I,'withdraw',w.order_num,w.uid,w.out_trade_no,
        coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道'),coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),
        coalesce(nullif(w.status_text,''),w.status_code),w.status_code,
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then 'failed' when '-1' then 'rejected' else 'unknown' end,
        coalesce(w.status_code='3',false),w.create_time,case when w.status_code='3' then w.update_time end,
        coalesce(w.amount_display,w.amount_minor/100.0),coalesce(w.real_amount_display,w.real_amount_minor/100.0),
        coalesce(w.fee_display,w.fee_minor/100.0),w.last_seen_at,'INR',null::text
      from public.game66_withdraw_orders w where w.platform_id=$1 and $8 in ('all','withdraw')
        and w.%2$I>=$5 and w.%2$I<$6 and ($7='created' or w.status_code='3')
        and ($9 is null or w.create_time>=$9) and ($10 is null or w.create_time<$10)
        and ($11 is null or w.uid=$11) and ($12 is null or w.order_num=$12 or w.out_trade_no=$12)
        and ($17 is null or w.%2$I<=($17->>'at')::timestamptz)
    $q$,v_axis,v_withdraw_axis);
  end if;
  v_sql:='with orders as ('||v_sql||$q$), filtered as (
    select *,coalesce((created_at at time zone $4)::date<(success_at at time zone $4)::date,false) as cross_day
    from orders where ($13='all' or status_group=$13)
      and (not $14 or (succeeded and (created_at at time zone $4)::date<(success_at at time zone $4)::date))
      and ($15 is null or provider=any($15)) and ($16 is null or channel_type=any($16))
      and ($19 is null or amount>=$19) and ($20 is null or amount<=$20)
  ) $q$;
  if p_mode='aggregate' then
    v_tail:=$q$, cohorts as (
      select direction,provider,channel_type,currency,(created_at at time zone $4)::date as created_date,
        (success_at at time zone $4)::date as success_date,
        count(*) as submitted_count,
        case when count(amount)=count(*) then sum(amount) end as submitted_amount,
        count(*) filter(where amount is null) as missing_amount_count,
        count(*) filter(where status_group='pending') as pending_count,
        case when count(amount) filter(where status_group='pending')=count(*) filter(where status_group='pending')
          then coalesce(sum(amount) filter(where status_group='pending'),0) end as pending_amount,
        count(*) filter(where succeeded) as success_count,
        case when count(amount) filter(where succeeded)=count(*) filter(where succeeded)
          then coalesce(sum(amount) filter(where succeeded),0) end as success_amount,
        case when $24<>'ar' and count(actual_amount) filter(where succeeded)=count(*) filter(where succeeded)
          then coalesce(sum(actual_amount) filter(where succeeded),0) end as actual_amount,
        case when $24<>'ar' and count(withdraw_fee) filter(where succeeded)=count(*) filter(where succeeded)
          then coalesce(sum(withdraw_fee) filter(where succeeded),0) end as withdraw_fee,
        count(*) filter(where succeeded and cross_day) as cross_day_count,
        case when count(amount) filter(where succeeded and cross_day)=count(*) filter(where succeeded and cross_day)
          then coalesce(sum(amount) filter(where succeeded and cross_day),0) end as cross_day_amount,
        count(*) filter(where succeeded and created_at<$21) as earlier_count,
        case when count(amount) filter(where succeeded and created_at<$21)=count(*) filter(where succeeded and created_at<$21)
          then coalesce(sum(amount) filter(where succeeded and created_at<$21),0) end as earlier_amount,
        count(*) filter(where succeeded and success_at is null) as missing_success_time_count,
        min(created_at) as first_created_at,max(created_at) as last_created_at,
        min(success_at) as first_success_at,max(success_at) as last_success_at,max(synced_at) as last_synced_at
      from filtered group by 1,2,3,4,5,6
    ) select coalesce(jsonb_agg(to_jsonb(cohorts) order by direction,provider,channel_type,currency,created_date,success_date),'[]'::jsonb) from cohorts$q$;
  else
    v_tail:=$q$, page as (
      select * from filtered where ($17 is null or (axis,direction,id)<(($17->>'at')::timestamptz,$17->>'direction',($17->>'id')::uuid))
      order by axis desc,direction desc,id desc limit $18+1
    ) select coalesce(jsonb_agg(to_jsonb(page)||jsonb_build_object(
      'amount',amount::text,'actual_amount',actual_amount::text,'withdraw_fee',withdraw_fee::text)
      order by axis desc,direction desc,id desc),'[]'::jsonb) from page$q$;
  end if;
  execute v_sql||v_tail into v_rows using p_platform,v_platform.name,v_platform.country_code,v_platform.timezone,
    p_start_at,p_end_at,p_basis,p_direction,p_created_start,p_created_end,v_member,v_order,p_status,p_cross_day_only,
    p_providers,p_types,p_cursor,p_limit,p_amount_min,p_amount_max,v_reference,v_platform.currency,p_mode,v_platform.source;
  if p_mode='aggregate' then
    return jsonb_build_object('platforms',v_options,'platform',v_platform.name,'team',v_platform.team,
      'country',v_platform.country,'source',v_platform.source,'timezone',v_platform.timezone,
      'basis',p_basis,'start',p_start_at,'endExclusive',p_end_at,'rows',v_rows);
  end if;
  v_more:=jsonb_array_length(v_rows)>p_limit;
  if v_more then v_rows:=v_rows-p_limit; end if;
  return jsonb_build_object('rows',v_rows,'hasMore',v_more,
    'nextCursor',case when v_more then jsonb_build_object('at',v_rows->-1->'axis','direction',v_rows->-1->'direction','id',v_rows->-1->'id') end,
    'platform',v_platform.name,'country',v_platform.country,'source',v_platform.source,'timezone',v_platform.timezone);
end;
$$;
revoke all on function private.dashboard_uploaded_order_query(text,uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text[],text[],jsonb,integer,text,text,text,boolean,numeric,numeric,timestamptz) from public,anon,authenticated;

notify pgrst,'reload schema';
