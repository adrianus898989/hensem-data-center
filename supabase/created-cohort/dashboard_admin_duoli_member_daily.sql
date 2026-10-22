CREATE OR REPLACE FUNCTION private.dashboard_admin_duoli_member_daily(p_platform jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_direction text, p_providers text[], p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare v_created boolean:=coalesce(p_platform->>'memberSuccessBasis'='created',false);v_rows jsonb;v_source text:=p_platform->>'source_name';
begin
 if p_platform?'memberSuccessBasis'and not v_created then raise exception using errcode='22023',message='invalid_member_success_basis';end if;
 if (p_platform->>'source'='duoli' and p_platform->>'scope_group'='ID'
  and p_platform->>'timezone'='Asia/Jakarta' and p_platform->>'currency'='IDR'
  and v_source=any(array['FB168','FB333','HOT985','IND666','UANG'])
  and p_platform->>'id'=md5('duoli:ID:'||v_source)::uuid::text) is not true then
  raise exception using errcode='42501',message='platform_denied';
 end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end-p_start>interval '31 days' then
  raise exception using errcode='22023',message='invalid_range';
 end if;
 if p_direction is null or p_direction not in('all','charge','withdraw') then
  raise exception using errcode='22023',message='invalid_direction';
 end if;
 with events as (
  -- Separate native indexed clocks retain cross-day success updates.
  select 'created'::text basis,d.created_at event_at,d.business,d.member_id,d.provider_code,d.currency
  from private.duoli_order_details d
  where d.platform=v_source and d.country='ID' and d.system_name='DOLI'
   and d.business=any(case p_direction when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
   and d.created_at>=p_start and d.created_at<p_end
  union all
  select 'success',case when v_created then d.created_at else d.updated_at end,d.business,d.member_id,d.provider_code,d.currency
  from private.duoli_order_details d
  where d.platform=v_source and d.country='ID' and d.system_name='DOLI'
   and d.business=any(case p_direction when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
   and((v_created and d.created_at>=p_start and d.created_at<p_end and private.dashboard_admin_duoli_status(d.business,d.status_code)='success')
    or(not v_created and d.updated_at>=p_start and d.updated_at<p_end and private.dashboard_admin_duoli_success_updated_at(d.business,d.status_code,d.created_at,d.updated_at,statement_timestamp()) is not null))
 ), filtered as (
  select basis,(event_at at time zone 'Asia/Jakarta')::date date,
   case business when 'recharge' then 'charge' else 'withdraw' end direction,nullif(btrim(member_id),'') member_id
  from events where (p_providers is null or private.dashboard_admin_duoli_provider(provider_code)=any(p_providers))
   and (p_currency is null or currency=p_currency)
 ), members as (
  select date,direction,member_id,count(*) filter(where basis='created') created_count,
   count(*) filter(where basis='success') success_count from filtered group by date,direction,member_id
 ), counts as (
  select date,direction,
   count(*) filter(where member_id is not null and created_count>0) created_member_count,
   count(*) filter(where member_id is not null and success_count>0) success_member_count,
   sum(created_count) created_order_count,sum(success_count) success_order_count,
   coalesce(sum(created_count) filter(where member_id is null),0) created_missing_member_count,
   coalesce(sum(success_count) filter(where member_id is null),0) success_missing_member_count,
   count(*) filter(where member_id is not null and created_count>=2) created_members_ge2,
   count(*) filter(where member_id is not null and created_count>=3) created_members_ge3,
   count(*) filter(where member_id is not null and created_count>=4) created_members_ge4,
   count(*) filter(where member_id is not null and created_count>=5) created_members_ge5,
   count(*) filter(where member_id is not null and success_count>=2) success_members_ge2,
   count(*) filter(where member_id is not null and success_count>=3) success_members_ge3,
   count(*) filter(where member_id is not null and success_count>=4) success_members_ge4,
   count(*) filter(where member_id is not null and success_count>=5) success_members_ge5
  from members group by date,direction
 ), days as (
  select d::date date from generate_series((p_start at time zone 'Asia/Jakarta')::date::timestamp,
   ((p_end-interval '1 microsecond') at time zone 'Asia/Jakarta')::date::timestamp,interval '1 day')d
 ), rows as (
  select days.date,d.direction,coalesce(c.created_member_count,0) created_member_count,
   coalesce(c.success_member_count,0) success_member_count,coalesce(c.created_order_count,0) created_order_count,
   coalesce(c.success_order_count,0) success_order_count,coalesce(c.created_missing_member_count,0) created_missing_member_count,
   coalesce(c.success_missing_member_count,0) success_missing_member_count,
   coalesce(c.created_members_ge2,0) created_members_ge2,coalesce(c.created_members_ge3,0) created_members_ge3,
   coalesce(c.created_members_ge4,0) created_members_ge4,coalesce(c.created_members_ge5,0) created_members_ge5,
   coalesce(c.success_members_ge2,0) success_members_ge2,coalesce(c.success_members_ge3,0) success_members_ge3,
   coalesce(c.success_members_ge4,0) success_members_ge4,coalesce(c.success_members_ge5,0) success_members_ge5
  from days cross join unnest(case p_direction when 'all' then array['charge','withdraw'] else array[p_direction] end)d(direction)
  left join counts c on c.date=days.date and c.direction=d.direction
 ) select coalesce(jsonb_agg(to_jsonb(r) order by date,direction),'[]'::jsonb) into v_rows from rows r;
 return jsonb_build_object('version',1,'asOf',statement_timestamp(),'startAt',p_start,'endAt',p_end,
  'platform',jsonb_build_object('id',p_platform->'id','name',p_platform->'name','country',p_platform->'country',
   'team',p_platform->'team','source','duoli','sourceName',v_source,'scopeGroup','ID','timezone','Asia/Jakarta','currency','IDR'),
  'rows',v_rows,'capabilities',jsonb_build_object('memberIdentity',true,'memberDailyAvailable',true,
   'createdBasis','created_at','successBasis',case when v_created then 'created_at_current_stored_status'else 'success_at'end,'dedupe','platform_local_date_direction_member',
   'successTimeBasis','order_updated_at','successCohort',case when v_created then 'created_at_current_stored_status'else 'successful_status_updated_at_in_selected_range'end,
   'paymentSuccessTimeAvailable',false,'latencyAvailable',false,'sourceCompletenessVerified',false,
   'coverageBasis','collected_orders_only','withdrawCreatedCoverageAvailable',false,
   'periodTotal','sum_daily_unique_member_visits','frequencyBasis','per_platform_local_day_order_count',
   'frequencyThresholds',jsonb_build_array(2,3,4,5))||case when v_created then jsonb_build_object('independentSuccessWindow',false)else '{}'::jsonb end)||case when v_created then jsonb_build_object('successBasis','created')else '{}'::jsonb end;
end;
$function$
