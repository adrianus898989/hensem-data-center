-- Only submissions after the first 15 per platform/member/local day are invalid.
-- Rank whole local days across every provider before applying UI filters.
-- A success anywhere that day, or any later-paid order in that day's cohort,
-- still excludes the member-day. Unknown ordering never assigns exemptions.
-- Missing-time rows cannot be assigned a day; exclude affected members in the
-- requested local days and surface the selected rows as ordering-unverified.
begin;
-- Replace only the reviewed predecessor or this exact completed migration.
-- Existing unexpected definitions, execution settings or grantees require review.
do $guard$
declare v_name text;v_proc record;v_authenticated oid;
begin
 select oid into v_authenticated from pg_catalog.pg_roles where rolname='authenticated';
 foreach v_name in array array['private.dashboard_admin_live_submission_analysis(jsonb)','public.dashboard_admin_live_submission_analysis(jsonb)'] loop
  select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_name);
  if not found or v_authenticated is null then raise exception 'submission_excess_baseline_missing: %',v_name;end if;
  if v_proc.prorettype<>'jsonb'::regtype or v_proc.provolatile<>'s' or v_proc.pronargdefaults<>0 then
   raise exception 'submission_excess_definition_drift: %',v_name;
  end if;
  if v_name like 'private.%' then
   if md5(v_proc.prosrc) not in ('509a5d3c8bfde4859f9c4a2ba6e889e1','96982df59a38fa6889a36634901ce94d')
    or not v_proc.prosecdef or v_proc.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off']
    or v_proc.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql') then
    raise exception 'submission_excess_definition_drift: %',v_name;
   end if;
  elsif md5(v_proc.prosrc)<>'83bc6984acba60790d2cc3f95fc7b338' or v_proc.prosecdef
    or v_proc.proconfig is distinct from array['search_path=""']
    or v_proc.prolang<>(select oid from pg_catalog.pg_language where lanname='sql') then
   raise exception 'submission_excess_definition_drift: %',v_name;
  end if;
  if not exists(select 1 from pg_catalog.aclexplode(v_proc.proacl) a where a.grantee=v_authenticated and a.privilege_type='EXECUTE' and not a.is_grantable)
    or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a
      where a.privilege_type='EXECUTE' and (a.grantee not in (v_proc.proowner,v_authenticated) or a.grantee=v_authenticated and a.is_grantable)) then
   raise exception 'submission_excess_acl_drift: %',v_name;
  end if;
 end loop;
end;
$guard$;
create or replace function private.dashboard_admin_live_submission_analysis(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set jit='off' set enable_nestloop='off' as $$
declare
 v_platform record;v_id uuid;v_start timestamptz;v_end timestamptz;v_from timestamptz;v_to timestamptz;
 v_direction text;v_currency text;v_key text;v_providers text[];v_source text;v_success text;v_sql text;v_result jsonb;
 v_time_filter text;v_undated_filter text;
 v_confirmations jsonb:='{}'::jsonb;
 v_operation text:=coalesce(p_request->>'operation','summary');v_threshold integer:=15;v_thresholds integer[]:=array[10,15,20,30,50,100];
 v_level text:=coalesce(p_request->>'level','all');v_offset integer:=0;v_limit integer:=50;
 v_bands jsonb;v_edges numeric[];v_charts boolean:=true;
 v_member text:=nullif(btrim(p_request->>'memberId'),'');
begin
  perform private.dashboard_admin_live_scope();
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'platformId','startAt','endAt','direction','providers','currency','operation','threshold','level','offset','limit','memberId','amountBands','charts'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
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
  v_direction:=coalesce(p_request->>'direction','charge');v_currency:=nullif(btrim(p_request->>'currency'),'');
  if v_direction <> 'charge' then raise exception using errcode='22023',message='invalid_direction';end if;
  if p_request ? 'providers' and p_request->'providers'<>'null'::jsonb then
    if jsonb_typeof(p_request->'providers')<>'array' or jsonb_array_length(p_request->'providers')>200
      or exists(select 1 from jsonb_array_elements(p_request->'providers') a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end if;

 if v_operation not in ('summary','members') or v_level not in ('all','new','funded','unknown','l0')
  or v_member is not null and (length(v_member)>200 or v_member ~ '[[:cntrl:]]') then
  raise exception using errcode='22023',message='invalid_filter';end if;
 if p_request ? 'threshold' then
  if jsonb_typeof(p_request->'threshold')<>'number' or p_request->>'threshold' not in ('10','15','20','30','50','100') then raise exception using errcode='22023',message='invalid_threshold';end if;
  v_threshold:=(p_request->>'threshold')::int;
  if v_threshold=15 then v_thresholds:=array[10,15,20,30,50,100];end if;
 end if;
 if p_request ? 'offset' then
  if jsonb_typeof(p_request->'offset')<>'number' or p_request->>'offset' !~ '^[0-9]{1,7}$' then raise exception using errcode='22023',message='invalid_offset';end if;
  v_offset:=(p_request->>'offset')::int;
 end if;
 if p_request ? 'limit' then
  if jsonb_typeof(p_request->'limit')<>'number' or p_request->>'limit' not in ('20','50','100') then raise exception using errcode='22023',message='invalid_limit';end if;
  v_limit:=(p_request->>'limit')::int;
 end if;
 if p_request ? 'charts' then if jsonb_typeof(p_request->'charts')<>'boolean' then raise exception using errcode='22023',message='invalid_charts';end if;v_charts:=(p_request->>'charts')::boolean;end if;
 v_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands','charge');
 select array_agg(value::numeric order by ordinality) into v_edges from jsonb_array_elements_text(v_bands->'charge') with ordinality;
 select array_agg(value) into v_providers from jsonb_array_elements_text(coalesce(nullif(p_request->'providers','null'::jsonb),'[]'::jsonb));
 -- Always evaluate whole local days, even if the dashboard clock range is shorter.
 v_from:=date_trunc('day',v_start at time zone v_platform.timezone) at time zone v_platform.timezone;
 v_to:=(date_trunc('day',(v_end-interval '1 microsecond') at time zone v_platform.timezone)+interval '1 day') at time zone v_platform.timezone;
 if v_platform.source='ar' then
  v_time_filter:='a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)';v_undated_filter:='a.applied_at is null';
  if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
   execute 'select coalesce(jsonb_object_agg(order_no,confirmed_provider),''{}''::jsonb) from private.dashboard_admin_order_provider_confirmations where source_system=''AR'' and country_code=$1 and platform=$2 and order_kind=''recharge'' and active'
    into v_confirmations using v_platform.scope_group,v_platform.source_name;
  end if;
  v_source:=$q$select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
   a.applied_at at time zone $4 created_at,a.amount,$17::text currency,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
   a.status='已支付' paid,coalesce(a.status in ('已支付','待支付','支付失败','已取消'),false) status_known,$ar_level$ level_text,$ar_count$ count_text
   from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'
   and ($source_time_filter$)$q$;
  v_source:=replace(v_source,'$ar_level$',case when exists(select 1 from pg_catalog.pg_attribute where attrelid='public.ar_collected_orders'::regclass and attname='member_level' and not attisdropped) then 'a.member_level::text' else 'null::text' end);
  v_source:=replace(v_source,'$ar_count$',case when exists(select 1 from pg_catalog.pg_attribute where attrelid='public.ar_collected_orders'::regclass and attname='recharge_count' and not attisdropped) then 'a.recharge_count::text' else 'null::text' end);
  v_success:=$q$select nullif(btrim(a.member_id),'') member_id,a.completed_at::date as day
   from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'
   and a.status='已支付' and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)$q$;
 elsif v_platform.source='newar' then
  v_time_filter:='n.created_at>=$5 and n.created_at<$6';v_undated_filter:='n.created_at is null';
  v_source:=$q$select coalesce(nullif(n.order_number,''),n.source_id) order_id,nullif(btrim(n.member_id),'') member_id,n.created_at,n.amount,n.currency,
   case when coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值' else coalesce(nullif(btrim(n.provider),''),'未识别通道') end raw_provider,
   n.status_group='success' paid,coalesce(n.status_group in ('success','pending','failed','rejected'),false) status_known,$newar_level$ level_text,$newar_count$ count_text
   from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
   where n.platform=$3 and n.dataset='charge' and ($source_time_filter$)
   and (t.launch_at is null or n.created_at>=t.launch_at or n.created_at is null)$q$;
  v_source:=replace(v_source,'$newar_level$',case when exists(select 1 from pg_catalog.pg_attribute where attrelid='public.newar_detail_records'::regclass and attname='recharge_level' and not attisdropped) then 'coalesce(n.recharge_level::text,n.raw->>''rechargeLevel'',n.raw->>''memberLevel'')' else 'coalesce(n.raw->>''rechargeLevel'',n.raw->>''memberLevel'')' end);
  v_source:=replace(v_source,'$newar_count$',case when exists(select 1 from pg_catalog.pg_attribute where attrelid='public.newar_detail_records'::regclass and attname='recharge_count' and not attisdropped) then 'coalesce(n.recharge_count::text,n.raw->>''rechargeCount'')' else 'n.raw->>''rechargeCount''' end);
  v_success:=$q$select nullif(btrim(n.member_id),'') member_id,(n.success_at at time zone $4)::date as day
   from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
   where n.platform=$3 and n.dataset='charge' and n.status_group='success' and n.success_at>=$5 and n.success_at<$6
   and (t.launch_at is null or n.created_at>=t.launch_at)$q$;
 elsif v_platform.source='lg' then
  v_time_filter:='l.created_at>=$5 and l.created_at<$6';v_undated_filter:='l.created_at is null';
  v_source:=$q$select l.order_no order_id,nullif(btrim(l.member_id),'') member_id,l.created_at,l.metric_amount amount,$17::text currency,
   coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') raw_provider,
   l.status_class='success' paid,coalesce(l.status_class in ('success','pending','rejected'),false) status_known,null::text level_text,null::text count_text
   from public.lg_orders l where l.country_code=$2 and l.platform=$3 and l.source_system='LG' and l.order_kind='recharge' and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(l.member_id),'') member_id,(l.paid_at at time zone $4)::date as day from public.lg_orders l
   where l.country_code=$2 and l.platform=$3 and l.source_system='LG' and l.order_kind='recharge' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6$q$;
 elsif v_platform.source='game66' then
  v_time_filter:='c.create_time>=$5 and c.create_time<$6';v_undated_filter:='c.create_time is null';
  v_source:=$q$select c.order_num order_id,nullif(btrim(c.uid),'') member_id,c.create_time created_at,coalesce(c.amount_display,c.amount_minor/100.0) amount,'INR'::text currency,
   coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') raw_provider,c.status_code='1' paid,coalesce(c.status_code in ('1','0'),false) status_known,null::text level_text,null::text count_text
   from public.game66_charge_orders c where c.platform_id=$1 and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(c.uid),'') member_id,(c.pay_time at time zone $4)::date as day from public.game66_charge_orders c
   where c.platform_id=$1 and c.status_code='1' and c.pay_time>=$5 and c.pay_time<$6$q$;
 else
  raise exception using errcode='22023',message='submission_source_unavailable';
 end if;
 -- Keep bounded time reads and the sparse NULL-time lookup as independent
 -- indexable branches; an OR would encourage full platform-history scans.
 v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);
 if v_currency is not null and v_currency<>v_platform.currency then raise exception using errcode='22023',message='invalid_currency';end if;
 v_sql:='with source_rows as materialized ('||v_source||'), successes as materialized ('||v_success||$q$),
 canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider from (select distinct raw_provider from source_rows) names
 ), normalized_orders as materialized (
  select s.*,(created_at at time zone $4)::date as day,c.provider,
   case when upper(btrim(level_text)) ~ '^L(V)?[0-9]{1,4}$' then regexp_replace(upper(btrim(level_text)),'^LV?','')::int
    when btrim(level_text) ~ '^[0-9]{1,4}$' then btrim(level_text)::int end member_level,
   case when btrim(count_text) ~ '^[0-9]{1,9}$' then btrim(count_text)::int end recharge_count
  from source_rows s join canonical c using(raw_provider)
 ), unplaced_members as materialized (
  select distinct member_id from normalized_orders where created_at is null and member_id is not null
 ), orders as materialized (
  select o.*,row_number() over(partition by day,member_id order by created_at,order_id collate "C") day_order_index
  from normalized_orders o where created_at is not null
 ), member_days as materialized (
  select day,member_id,count(*) submitted_count,
   case when count(*) filter(where amount is null or currency is distinct from $17)>0 then null else sum(amount) end platform_day_amount,
   count(*) filter(where paid) cohort_success_count,bool_and(status_known) statuses_known,
   count(*) filter(where nullif(btrim(order_id),'') is null)=0 and count(distinct order_id)=count(*)
    and not exists(select 1 from unplaced_members u where u.member_id=orders.member_id) sequence_known,
   count(*) filter(where day_order_index>15) platform_day_invalid_count,
   case when count(*) filter(where day_order_index>15 and (amount is null or currency is distinct from $17))>0 then null
    else coalesce(sum(amount) filter(where day_order_index>15),0) end platform_day_invalid_amount,
   case when max(recharge_count)>0 then 'funded' when count(recharge_count)=count(*) and max(recharge_count)=0 and count(member_level)=count(*) and max(member_level)=0 then 'new' else 'unknown' end member_class,
   max(recharge_count) recharge_count, bool_or(member_level=0) has_l0,
   case when count(member_level)>0 then 'L'||max(member_level)::text end member_level,
   min(created_at) first_at,max(created_at) last_at
  from orders where member_id is not null group by day,member_id
 ), eligible as materialized (
  select m.* from member_days m where submitted_count>=10 and cohort_success_count=0 and statuses_known and sequence_known
   and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
 ), selected_orders as materialized (
  select o.* from orders o where ($8::text[] is null or provider=any($8)) and created_at>=$15 and created_at<$16 and currency=$17
 ), selected_member_days as materialized (
  select distinct day,member_id from selected_orders where member_id is not null
 ), qualified as materialized (
  select o.*,m.submitted_count,m.platform_day_amount,m.platform_day_invalid_count,m.platform_day_invalid_amount,m.member_class,m.member_level known_level,m.recharge_count known_recharge_count,m.has_l0,m.first_at,m.last_at
  from selected_orders o join eligible m using(day,member_id)
 ), qualified_members as materialized (
  -- Aggregate each provider/member/day once before calculating thresholds.
  select day,member_id,provider,max(submitted_count) submitted_count,max(member_class) member_class,bool_or(has_l0) has_l0,
   count(*) filter(where day_order_index>15) invalid_count,count(*) filter(where day_order_index>15 and amount is null) missing_amount,coalesce(sum(amount) filter(where day_order_index>15),0) invalid_amount
  from qualified where $14='summary' group by day,member_id,provider
 ), metric_values as (
  select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
   count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
   sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
  from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>=t.threshold
  group by grouping sets ((q.provider,t.threshold),(t.threshold))
 ), dimensions as (select null::text provider union all select distinct provider from selected_orders), metrics as (
  select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
   coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
   coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
   coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
  from dimensions d cross join unnest($22::integer[]) t(threshold)
  left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
 ), details as (
  select q.day,q.member_id,q.member_class,max(q.known_level) member_level,max(q.submitted_count) submitted_count,max(q.known_recharge_count) recharge_count,
   max(q.platform_day_amount)::text platform_day_amount,max(q.platform_day_invalid_count) platform_day_invalid_count,max(q.platform_day_invalid_amount)::text platform_day_invalid_amount,
   count(*) filter(where q.day_order_index>15) invalid_count,
   case when count(*) filter(where q.day_order_index>15 and q.amount is null)>0 then null else coalesce(sum(q.amount) filter(where q.day_order_index>15),0)::text end invalid_amount,
   count(*) selected_count,case when count(*) filter(where q.amount is null)>0 then null else sum(q.amount)::text end submitted_amount,array_agg(distinct q.provider order by q.provider) providers,
   min(q.first_at) first_at,max(q.last_at) last_at
  from qualified q where $14='members' and q.submitted_count >= $9 and ($10='all' or q.member_class=$10 or $10='l0' and q.has_l0) and ($13::text is null or q.member_id=$13)
  group by q.day,q.member_id,q.member_class having count(*) filter(where q.day_order_index>15)>0
 ), detail_page as (select * from details order by day desc,submitted_count desc,member_id limit $12 offset $11),
 dashboard_orders as materialized (
  select o.*,coalesce(o.day_order_index>15 and (o.day,o.member_id) in (select e.day,e.member_id from eligible e where submitted_count>=$9),false) flagged
  from selected_orders o where $14='summary' and $21
 ), monitoring as (
  select provider,count(*) order_count,count(*) filter(where paid) success_count,
   case when count(*) filter(where amount is null)>0 then null else coalesce(sum(amount),0)::text end order_amount,
   count(*) filter(where flagged) invalid_count,
   case when count(*) filter(where flagged and amount is null)>0 then null else coalesce(sum(amount) filter(where flagged),0)::text end invalid_amount,
   min(created_at at time zone $4) filter(where flagged) first_at,max(created_at at time zone $4) filter(where flagged) last_at
  from dashboard_orders group by grouping sets ((),(provider))
 ), heatmap as (
  select provider,extract(hour from created_at at time zone $4)::int as hour,count(*) count
  from dashboard_orders where flagged group by provider,hour
 ), daily_chart as (
  select day,count(*) order_count,count(*) filter(where flagged) invalid_count
  from dashboard_orders group by day
 ), amount_chart as (
  select case when amount is null then 'unknown' when $19::numeric[] is null then 'unconfigured'
   when amount<$19[1] then 'below' when amount>$19[11] then 'above' when amount=$19[11] then 'band:9'
   else 'band:'||(select i-1 from generate_series(1,10)i where amount >= $19[i] and amount < $19[i+1])::text end bucket,
   count(*) count
  from dashboard_orders where flagged group by bucket
 ), frequency_chart as (
  select case when max(submitted_count)>=100 then '100+' when max(submitted_count)>=50 then '50–99'
   when max(submitted_count)>=30 then '30–49' when max(submitted_count)>=20 then '20–29' else '10–19' end band
  from qualified_members where $14='summary' and $21 group by day,member_id
 ), frequency_counts as (select band,count(*) count from frequency_chart group by band)
 select jsonb_build_object(
  'dashboard',case when $14='summary' and $21 then jsonb_build_object(
   'version',2,'threshold',$9,'exemptCount',15,'amountBands',$20::jsonb,
   'monitoring',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first),'[]'::jsonb) from monitoring m),
   'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by provider,hour),'[]'::jsonb) from heatmap h),
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]'::jsonb) from daily_chart d),
   'amounts',(select coalesce(jsonb_agg(to_jsonb(a) order by bucket),'[]'::jsonb) from amount_chart a),
   'frequency',(select coalesce(jsonb_agg(to_jsonb(f) order by band),'[]'::jsonb) from frequency_counts f)) end,
  'metrics',case when $14='summary' then (select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m) end,
  'coverage',jsonb_build_object('orderCount',(select count(*) from selected_orders),'missingMemberCount',(select count(*) from selected_orders where member_id is null),
   'missingLevelCount',(select count(*) from selected_orders where member_level is null),'missingRechargeCount',(select count(*) from selected_orders where recharge_count is null),
   -- Count the actual unknown-status rows in the selected members' whole-day
   -- cohorts, including another provider/time slice. Those rows prevent a
   -- no-success conclusion; unrelated member-days must not taint this scope.
   -- Missing-member rows cannot be joined to a cohort, so retain the selected
   -- unknown rows separately without counting known affected rows as unknown.
   'unknownStatusCount',(select count(*) from orders o join selected_member_days s using(day,member_id) where not o.status_known)
     +(select count(*) from selected_orders where member_id is null and not status_known),
   'orderSequenceUncertainCount',(select count(*) from selected_orders o join member_days m using(day,member_id) where not m.sequence_known),
   'sourceCompletenessVerified',false),
  'total',case when $14='members' then (select count(*) from details) end,
  'members',case when $14='members' then (select count(distinct member_id) from details) end,
  'rows',case when $14='members' then (select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from detail_page d) end)
 $q$;
 execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,
  v_providers,v_threshold,v_level,v_offset,v_limit,v_member,v_operation,v_start,v_end,coalesce(v_currency,v_platform.currency),v_confirmations,v_edges,v_bands,v_charts,v_thresholds;
 return v_result||jsonb_build_object('version',2,'exemptCount',15,'asOf',statement_timestamp(),'startAt',v_start,'endAt',v_end,'dayStart',v_from,'dayEnd',v_to,
  'platform',jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'country',v_platform.country,'currency',v_platform.currency,'timezone',v_platform.timezone),
  'basis','platform_local_day_all_providers_zero_success_after_first_15','thresholds',to_jsonb(v_thresholds),'operation',v_operation);
end;
$$;
revoke all on function private.dashboard_admin_live_submission_analysis(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to authenticated;
create or replace function public.dashboard_admin_live_submission_analysis(p_request jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_submission_analysis(p_request);$$;
revoke all on function public.dashboard_admin_live_submission_analysis(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_submission_analysis(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
