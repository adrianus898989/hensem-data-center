-- Per-member invalid-order drilldown reuses the existing whole-day qualification,
-- exact selected provider/time/currency range, source money and role-scoped access.
begin;

do $member_orders_reader$
declare p record;updated record;authenticated_id oid;
 before_hash constant text:='1ddde0a5c1f7e9c79c9eb212c10e8667';after_hash constant text:='6e4fea5a233a2cca2e778e5a66cf0a40';
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
 where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or authenticated_id is null then raise exception 'submission_member_orders_reader_baseline_missing';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or not p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'plpgsql' or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off'] then
  raise exception 'submission_member_orders_reader_definition_drift';end if;
 if not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner,authenticated_id))) then
  raise exception 'submission_member_orders_reader_acl_drift';end if;
 if md5(p.prosrc)=before_hash then execute $definition$
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_submission_analysis(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
 SET enable_nestloop TO 'off'
AS $function$
declare
 v_platform record;v_id uuid;v_start timestamptz;v_end timestamptz;v_from timestamptz;v_to timestamptz;
 v_direction text;v_currency text;v_key text;v_providers text[];v_source text;v_success text;v_sql text;v_result jsonb;
 v_time_filter text;v_undated_filter text;
 v_confirmations jsonb:='{}'::jsonb;
 v_operation text:=coalesce(p_request->>'operation','summary');v_threshold integer:=15;v_thresholds integer[]:=array[10,15,20,30,50,100];
 v_level text:=coalesce(p_request->>'level','all');v_offset integer:=0;v_limit integer:=50;
 v_bands jsonb;v_edges numeric[];v_charts boolean:=true;
 v_member text:=nullif(btrim(p_request->>'memberId'),'');
 v_day date;
begin
  perform private.dashboard_admin_live_scope();
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'platformId','startAt','endAt','direction','providers','currency','operation','threshold','level','offset','limit','memberId','day','amountBands','charts'])) then
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

 if v_operation not in ('summary','members','memberOrders') or v_level not in ('all','new','funded','unknown','l0')
  or v_member is not null and (length(v_member)>200 or v_member ~ '[[:cntrl:]]') then
  raise exception using errcode='22023',message='invalid_filter';end if;
 if v_operation='memberOrders' then
  if v_member is null or p_request->>'memberId'<>v_member or jsonb_typeof(p_request->'memberId') is distinct from 'string'
   or jsonb_typeof(p_request->'day') is distinct from 'string' or coalesce(p_request->>'day','') !~ '^\d{4}-\d{2}-\d{2}$' then
   raise exception using errcode='22023',message='invalid_member_day';end if;
  begin v_day:=(p_request->>'day')::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='22023',message='invalid_member_day';end;
  if v_day::text<>p_request->>'day' or v_day<(v_start at time zone v_platform.timezone)::date
   or v_day>((v_end-interval '1 microsecond') at time zone v_platform.timezone)::date then
   raise exception using errcode='22023',message='invalid_member_day';end if;
 elsif p_request ? 'day' then raise exception using errcode='22023',message='invalid_member_day';end if;
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
   a.applied_at at time zone $4 created_at,private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) as amount,$17::text currency,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
   a.status='已支付' paid,coalesce(a.status in ('已支付','待支付','支付失败','已取消'),false) status_known,a.status::text source_status,$ar_level$ level_text,$ar_count$ count_text
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
   n.status_group='success' paid,coalesce(n.status_group in ('success','pending','failed','rejected'),false) status_known,n.status_group::text source_status,$newar_level$ level_text,$newar_count$ count_text
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
   l.status_class='success' paid,coalesce(l.status_class in ('success','pending','rejected'),false) status_known,l.status_class::text source_status,null::text level_text,null::text count_text
   from public.lg_orders l where l.country_code=$2 and l.platform=$3 and l.source_system='LG' and l.order_kind='recharge' and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(l.member_id),'') member_id,(l.paid_at at time zone $4)::date as day from public.lg_orders l
   where l.country_code=$2 and l.platform=$3 and l.source_system='LG' and l.order_kind='recharge' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6$q$;
 elsif v_platform.source='game66' then
  v_time_filter:='c.create_time>=$5 and c.create_time<$6';v_undated_filter:='c.create_time is null';
  v_source:=$q$select c.order_num order_id,nullif(btrim(c.uid),'') member_id,c.create_time created_at,coalesce(c.amount_display,c.amount_minor/100.0) amount,'INR'::text currency,
   coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') raw_provider,c.status_code='1' paid,coalesce(c.status_code in ('1','0'),false) status_known,c.status_code::text source_status,null::text level_text,null::text count_text
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
  select o.* from normalized_orders o where created_at is not null
 ), member_days as materialized (
  select day,member_id,count(*) submitted_count,
   case when count(*) filter(where amount is null or currency is distinct from $17)>0 then null else sum(amount) end platform_day_amount,
   count(*) filter(where paid) cohort_success_count,bool_and(status_known) statuses_known,
   count(*) filter(where nullif(btrim(order_id),'') is null)=0 and count(distinct order_id)=count(*)
    and not exists(select 1 from unplaced_members u where u.member_id=orders.member_id) sequence_known,
   count(*) platform_day_invalid_count,
   case when count(*) filter(where amount is null or currency is distinct from $17)>0 then null
    else coalesce(sum(amount),0) end platform_day_invalid_amount,
   case when max(recharge_count)>0 then 'funded' when count(recharge_count)=count(*) and max(recharge_count)=0 and count(member_level)=count(*) and max(member_level)=0 then 'new' else 'unknown' end member_class,
   max(recharge_count) recharge_count, bool_or(member_level=0) has_l0,
   case when count(member_level)>0 then 'L'||max(member_level)::text end member_level,
   min(created_at) first_at,max(created_at) last_at
  from orders where member_id is not null group by day,member_id
 ), eligible as materialized (
  select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
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
   count(*) invalid_count,count(*) filter(where amount is null) missing_amount,coalesce(sum(amount),0) invalid_amount
  from qualified where $14='summary' group by day,member_id,provider
 ), metric_values as (
  select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
   count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
   sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
  from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
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
   count(*) invalid_count,
   case when count(*) filter(where q.amount is null)>0 then null else coalesce(sum(q.amount),0)::text end invalid_amount,
   count(*) selected_count,case when count(*) filter(where q.amount is null)>0 then null else sum(q.amount)::text end submitted_amount,array_agg(distinct q.provider order by q.provider) providers,
   min(q.first_at) first_at,max(q.last_at) last_at,
   min(q.created_at) first_invalid_at,max(q.created_at) last_invalid_at
  from qualified q where $14='members' and q.submitted_count > $9 and ($10='all' or q.member_class=$10 or $10='l0' and q.has_l0) and ($13::text is null or q.member_id=$13)
  group by q.day,q.member_id,q.member_class
 ), detail_page as (select * from details order by day desc,submitted_count desc,member_id limit $12 offset $11),
 member_orders as materialized (
  select q.order_id,q.member_id,q.day,q.created_at,q.provider,q.raw_provider,q.amount,q.currency,q.source_status status
  from qualified q where $14='memberOrders' and q.submitted_count>$9 and q.member_id=$13 and q.day=$23
   and ($10='all' or q.member_class=$10 or $10='l0' and q.has_l0)
 ), member_order_page as (
  select order_id,member_id,day,created_at,provider,raw_provider,amount::text amount,currency,status
  from member_orders order by created_at,order_id limit $12 offset $11
 ), member_amount_groups as (
  select currency,amount::text amount,count(*) count,
   case when amount is null then null else sum(amount)::text end total_amount
  from member_orders group by currency,amount order by currency,amount::numeric nulls last
 ),
 dashboard_orders as materialized (
  select o.*,coalesce((o.day,o.member_id) in (select e.day,e.member_id from eligible e where submitted_count>$9),false) flagged
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
   'version',3,'threshold',$9,'exemptCount',0,'thresholdComparison','gt','amountBands',$20::jsonb,
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
  'total',case when $14='members' then (select count(*) from details) when $14='memberOrders' then (select count(*) from member_orders) end,
  'members',case when $14='members' then (select count(distinct member_id) from details) end,
  'rows',case when $14='members' then (select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from detail_page d)
   when $14='memberOrders' then (select coalesce(jsonb_agg(to_jsonb(o) order by created_at,order_id),'[]'::jsonb) from member_order_page o) end,
  'amountGroups',case when $14='memberOrders' then (select coalesce(jsonb_agg(to_jsonb(g) order by currency,amount::numeric nulls last),'[]'::jsonb) from member_amount_groups g) end,
  'memberId',case when $14='memberOrders' then $13 end,'day',case when $14='memberOrders' then $23 end,
  'offset',case when $14='memberOrders' then $11 end,'limit',case when $14='memberOrders' then $12 end,
  'hasMore',case when $14='memberOrders' then $11+$12<(select count(*) from member_orders) end)
 $q$;
 execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,
  v_providers,v_threshold,v_level,v_offset,v_limit,v_member,v_operation,v_start,v_end,coalesce(v_currency,v_platform.currency),v_confirmations,v_edges,v_bands,v_charts,v_thresholds,v_day;
 if v_operation<>'memberOrders' then v_result:=v_result-array['amountGroups','memberId','day','offset','limit','hasMore'];end if;
 return v_result||jsonb_build_object('version',3,'exemptCount',0,'thresholdComparison','gt','asOf',statement_timestamp(),'startAt',v_start,'endAt',v_end,'dayStart',v_from,'dayEnd',v_to,
  'platform',jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'country',v_platform.country,'currency',v_platform.currency,'timezone',v_platform.timezone),
  'basis','platform_local_day_all_providers_zero_success_whole_day_over_threshold','thresholds',to_jsonb(v_thresholds),'operation',v_operation);
end;
$function$
$definition$;end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then
  raise exception 'submission_member_orders_reader_postcondition_failed';end if;
end;$member_orders_reader$;

do $member_orders_gateway$
declare p record;updated record;authenticated_id oid;
 before_hash constant text:='be717288ca760e7b83692e43179758ed';after_hash constant text:='212a33785c64b3266f4eb84de8b0492b';
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
 where f.oid=pg_catalog.to_regprocedure('public.dashboard_admin_execute(text,jsonb)');
 if not found or authenticated_id is null then raise exception 'submission_member_orders_gateway_baseline_missing';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'v'
  or not p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'plpgsql' or p.proconfig is distinct from array['search_path=""'] then
  raise exception 'submission_member_orders_gateway_definition_drift';end if;
 if not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner,authenticated_id))) then
  raise exception 'submission_member_orders_gateway_acl_drift';end if;
 if md5(p.prosrc)=before_hash then execute $definition$
CREATE OR REPLACE FUNCTION public.dashboard_admin_execute(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a jsonb;page jsonb;action text;capability text;rpc text;payload jsonb;signature text;k bytea;
 args jsonb;result jsonb;prior text;v_view text;v_operation text;needed text[];
begin
 a:=private.dashboard_role_access();
 if a->>'mode'<>'assigned' or not (a->>'canView')::boolean then raise exception using errcode='42501',message='assigned_role_required';end if;
 if p_page is null or p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or jsonb_typeof(p_request->'action') is distinct from 'string' then raise exception using errcode='22023',message='invalid_request';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages') where value->>'id'=p_page;
 action:=p_request->>'action';v_operation:=p_request->>'operation';v_view:=p_request->>'view';
 if page is null or action='portalOperationLogs' or not (page->'requests') ? action
  or not (a->'permissions') ? (p_page||'.view') then raise exception using errcode='42501',message='page_action_denied';end if;
 capability:=case when action in ('catalog','providerOptions','configurationAccess') then 'view'
   when action='withdrawNote' then 'edit' when action='configurationWrite' and v_operation='grant' then 'grant'
   when action='configurationWrite' then 'edit' else 'query' end;
 needed:=array[p_page||'.view',p_page||'.'||capability];
 if action in ('details','query','analysisOrders','pendingOrders') or action='aggregate' and v_view='drilldown'
  or action in ('submissionAnalysis','submissionStreak') and v_operation in ('members','memberOrders')
  or action='workorderRecords' and v_operation in ('detail','orderDetail')
  or action='depositStatistics' and (p_request->>'section'='details' or p_request->>'section'='kyc' and p_request->>'dimension'='orders')
  or action='depositIssues' and p_page='deposit_statistics'
 then needed:=array_append(needed,p_page||'.detail');end if;
 if not (a->'permissions') ?& needed then raise exception using errcode='42501',message='role_permission_denied';end if;
 if action='configurationWrite' and not (v_operation='grant' and p_page in ('provider_config','teams')
  or v_operation='provider' and p_page='provider_config' or v_operation='platform' and p_page='teams') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='workorderRecords' and not (p_page='workorders' and coalesce(v_view,'records') in ('records','orders')
  or p_page='workorder_reconciliation' and v_view='missing' or p_page='workorder_workload' and v_view='workload') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='autoWithdraw' and (p_page='withdraw_operators' and coalesce(v_view,'auto')<>'operators'
  or p_page in ('auto_withdraw','overview') and coalesce(v_view,'auto')<>'auto') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='submissionStreak' and p_page<>'events' then
  raise exception using errcode='42501',message='page_action_denied';end if;
 rpc:=case action
  when 'channelStatus' then 'dashboard_admin_live_channel_status'
  when 'submissionAnalysis' then 'dashboard_admin_live_submission_analysis'
  when 'submissionStreak' then 'dashboard_admin_live_submission_streak'
  when 'memberDaily' then 'dashboard_admin_live_member_daily'
  when 'pendingSnapshot' then 'dashboard_admin_live_pending_snapshot'
  when 'pendingAnalysis' then 'dashboard_admin_live_pending_analysis'
  when 'pendingOrders' then 'dashboard_admin_live_pending_orders'
  when 'depositStatistics' then 'dashboard_admin_deposit_statistics'
  when 'workorderRecords' then 'dashboard_admin_live_workorder_records'
  when 'intakeCoverage' then 'dashboard_admin_live_intake_coverage'
  when 'reportSummary' then 'dashboard_admin_live_report_summary'
  when 'syncHealth' then 'dashboard_admin_live_sync_health'
  when 'collectedData' then 'dashboard_admin_live_collected_data'
  when 'rates' then 'dashboard_admin_live_rates'
  when 'ratesSheet' then 'dashboard_admin_live_rate_sheet'
  when 'payoutConfig' then 'dashboard_admin_live_payout_config'
  when 'autoWithdraw' then 'dashboard_admin_live_auto_withdraw'
  when 'withdrawReasons' then 'dashboard_admin_live_withdraw_reasons'
  when 'withdrawNote' then 'dashboard_admin_live_withdraw_note'
  when 'depositIssues' then 'dashboard_admin_live_deposit_issues'
  when 'workorders' then 'dashboard_admin_live_workorders'
  when 'providerConfig' then 'dashboard_admin_live_provider_config'
  when 'platformAssignments' then 'dashboard_admin_live_platform_assignments'
  when 'providerOptions' then 'dashboard_admin_live_provider_options'
  when 'configurationAccess' then 'dashboard_admin_live_configuration_access'
  when 'configurationWrite' then 'dashboard_admin_live_configuration_write'
  when 'analysisOrders' then 'dashboard_admin_live_analysis_orders'
  when 'aggregate' then case when v_view='drilldown' then 'dashboard_admin_live_drilldown' else 'dashboard_admin_live_query' end
  when 'catalog' then 'dashboard_admin_live_query'
  when 'query' then 'dashboard_admin_live_query'
  when 'details' then 'dashboard_admin_live_query' end;
 if rpc is null then raise exception using errcode='42501',message='page_action_denied';end if;
 args:=case when rpc in ('dashboard_admin_live_query','dashboard_admin_live_drilldown') then p_request else p_request-'action' end;
 payload:=jsonb_build_object('uid',auth.uid(),'txid',pg_current_xact_id()::text,'pid',pg_backend_pid()::text,
  'roleId',a->>'roleId','roleVersion',a->>'version','assignmentVersion',a->>'assignmentVersion','page',p_page,'rpc',rpc,'action',action,'capability',capability);
 select secret into k from private.dashboard_role_context_secret where singleton;
 signature:=private.dashboard_role_hmac(payload::text,k);prior:=current_setting('hensem.dashboard_role_context',true);
 perform set_config('hensem.dashboard_role_context',jsonb_build_object('payload',payload,'signature',signature)::text,true);
 begin
  execute format('select private.%I($1)',rpc) into result using args;
 exception when others then
  perform set_config('hensem.dashboard_role_context',coalesce(prior,''),true);raise;
 end;
 perform set_config('hensem.dashboard_role_context',coalesce(prior,''),true);
 return result;
end;$function$
$definition$;end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then
  raise exception 'submission_member_orders_gateway_postcondition_failed';end if;
end;$member_orders_gateway$;

notify pgrst,'reload schema';

commit;
