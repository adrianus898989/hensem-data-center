CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_member_daily(p_platform jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_direction text, p_providers text[], p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_created boolean:=coalesce(p_platform->>'memberSuccessBasis'='created',false);s record; answer jsonb;
begin
 if p_platform?'memberSuccessBasis'and not v_created then raise exception using errcode='22023',message='invalid_member_success_basis';end if;
 select * into s from private.dashboard_admin_wg_sites() t
  where t.country_code=p_platform->>'scope_group' and t.platform=p_platform->>'source_name';
 if not found then raise exception using errcode='22023',message='invalid_wg_scope';end if;
 -- Bounds, direction, provider expansion, and fresh scope have already been
 -- validated by the existing public/private RPC path. This helper is not granted.
 with events as materialized (
  select 'created'::text basis,'charge'::text direction,d.created_at event_at,null::text member_id,
   coalesce(nullif(btrim(d.provider),''),'未识别通道') provider,d.member_currency currency
  from public.wg_recharge_details d where d.site_code=s.site_code and p_direction in('all','charge')
   and d.created_at>=p_start and d.created_at<p_end
  union all
  select 'success','charge',case when v_created then d.created_at else d.success_at end,null::text,
   coalesce(nullif(btrim(d.provider),''),'未识别通道'),d.member_currency
  from public.wg_recharge_details d where d.site_code=s.site_code and p_direction in('all','charge')
   and d.status_code=2 and((v_created and d.created_at>=p_start and d.created_at<p_end)or(not v_created and d.success_at>=p_start and d.success_at<p_end))
  union all
  select 'created','withdraw',d.created_at,nullif(btrim(d.member_id),''),
   coalesce(nullif(btrim(d.provider),''),'未识别通道'),d.member_currency
  from public.wg_withdraw_details d where d.site_code=s.site_code and p_direction in('all','withdraw')
   and d.created_at>=p_start and d.created_at<p_end
 union all
  select 'success','withdraw',d.created_at,nullif(btrim(d.member_id),''),
   coalesce(nullif(btrim(d.provider),''),'未识别通道'),d.member_currency
  from public.wg_withdraw_details d where v_created and d.site_code=s.site_code and p_direction in('all','withdraw')
   and d.created_at>=p_start and d.created_at<p_end and d.status_code=4
 ), filtered as materialized (
  select basis,direction,(event_at at time zone s.timezone)::date as date,member_id from events
  where (p_providers is null or provider=any(p_providers)) and (p_currency is null or currency=p_currency)
 ), counts as (
  select date,direction,count(distinct member_id) filter(where basis='created') as created_member_count,
   count(distinct member_id) filter(where basis='success') as success_member_count,
   count(*) filter(where basis='created') as created_order_count,count(*) filter(where basis='success') as success_order_count,
   count(*) filter(where basis='created' and member_id is null) as created_missing_member_count,
   count(*) filter(where basis='success' and member_id is null) as success_missing_member_count
  from filtered group by date,direction
 ), member_orders as (
  select date,direction,member_id,count(*)filter(where basis='created') as created_count,count(*)filter(where basis='success') as success_count from filtered where member_id is not null
  group by date,direction,member_id
 ), frequency as (
  select date,direction,count(*) filter(where created_count>=2) as ge2,count(*) filter(where created_count>=3) as ge3,
   count(*) filter(where created_count>=4) as ge4,count(*) filter(where created_count>=5) as ge5,
   count(*)filter(where success_count>=2)as sge2,count(*)filter(where success_count>=3)as sge3,
   count(*)filter(where success_count>=4)as sge4,count(*)filter(where success_count>=5)as sge5
  from member_orders group by date,direction
 ), days as (
  select d::date date from generate_series((p_start at time zone s.timezone)::date::timestamp,
   ((p_end-interval '1 microsecond') at time zone s.timezone)::date::timestamp,interval '1 day') d
 ), rows as (
  select days.date,d.direction,
   case when d.direction='withdraw' then coalesce(c.created_member_count,0) end as created_member_count,
   case when v_created and d.direction='withdraw'then coalesce(c.success_member_count,0)end as success_member_count,coalesce(c.created_order_count,0) as created_order_count,
   case when d.direction='charge'or v_created then coalesce(c.success_order_count,0) end as success_order_count,
   coalesce(c.created_missing_member_count,0) as created_missing_member_count,
   case when d.direction='charge'or v_created then coalesce(c.success_missing_member_count,0) end as success_missing_member_count,
   case when d.direction='withdraw' then coalesce(f.ge2,0) end as created_members_ge2,
   case when d.direction='withdraw' then coalesce(f.ge3,0) end as created_members_ge3,
   case when d.direction='withdraw' then coalesce(f.ge4,0) end as created_members_ge4,
   case when d.direction='withdraw' then coalesce(f.ge5,0) end as created_members_ge5,
   case when v_created and d.direction='withdraw'then coalesce(f.sge2,0)end as success_members_ge2,case when v_created and d.direction='withdraw'then coalesce(f.sge3,0)end as success_members_ge3,case when v_created and d.direction='withdraw'then coalesce(f.sge4,0)end as success_members_ge4,case when v_created and d.direction='withdraw'then coalesce(f.sge5,0)end as success_members_ge5,
   d.direction='withdraw' as created_available,(v_created and d.direction='withdraw')as success_available,
   case when d.direction='charge' then 'source_member_id_unavailable'::text end as created_unavailable_reason,
   case when d.direction='charge' then 'source_member_id_unavailable' when not v_created then 'source_success_time_unavailable' end as success_unavailable_reason
  from days cross join unnest(case p_direction when 'all' then array['charge','withdraw'] else array[p_direction] end) d(direction)
  left join counts c on c.date=days.date and c.direction=d.direction
  left join frequency f on f.date=days.date and f.direction=d.direction
 )
 select jsonb_build_object('version',1,'asOf',statement_timestamp(),'startAt',p_start,'endAt',p_end,
  'platform',jsonb_build_object('id',p_platform->>'id','name',p_platform->>'name','country',p_platform->>'country',
   'team',p_platform->>'team','source','wg','sourceName',s.platform,'scopeGroup',s.country_code,'timezone',s.timezone,'currency',s.currency),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.date,r.direction) from rows r),'[]'::jsonb),
  'capabilities',jsonb_build_object('memberIdentity',false,'memberIdentityByDirection',jsonb_build_object('charge',false,'withdraw',true),
   'createdBasis','created_at','successBasis',case when v_created then 'created_at_current_stored_status'else 'success_at'end,'dedupe','platform_local_date_direction_member',
   'sourceCompletenessVerified',false,'periodTotal','sum_daily_unique_member_visits',
   'frequencyBasis','per_platform_local_day_order_count','frequencyThresholds',jsonb_build_array(2,3,4,5),
   'availability',jsonb_build_object('charge',jsonb_build_object('created',false,'success',false),'withdraw',jsonb_build_object('created',true,'success',v_created)),
   'unavailabilityReasons',jsonb_build_object('charge','source_member_id_unavailable','withdrawSuccess',case when not v_created then 'source_success_time_unavailable'end)))
 into answer;
 if v_created then answer:=answer||jsonb_build_object('successBasis','created','capabilities',(answer->'capabilities')||jsonb_build_object('successCohort','created_at_current_stored_status','independentSuccessWindow',false,'withdrawSuccessTimeAvailable',false,'withdrawLatencyAvailable',false));end if;
 return answer;
end;
$function$
