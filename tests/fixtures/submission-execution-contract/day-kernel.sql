CREATE OR REPLACE FUNCTION private.submission_cohort_day_compute(p_request jsonb, p_catalog jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
 SET enable_nestloop TO 'off'
AS $function$
declare
 v_platform record;v_id uuid;v_start timestamptz;v_end timestamptz;v_from timestamptz;v_to timestamptz;
 v_direction text;v_currency text;v_key text;v_providers text[];v_source text;v_success text;v_sql text;v_result jsonb;
 v_time_filter text;v_undated_filter text;v_undated_source text;
 v_confirmations jsonb:='{}'::jsonb;
 v_operation text:=coalesce(p_request->>'operation','summary');v_threshold integer:=15;v_thresholds integer[]:=array[10,15,20,30,50,100];
 v_level text:=coalesce(p_request->>'level','all');v_offset integer:=0;v_limit integer:=50;
 v_bands jsonb;v_edges numeric[];v_charts boolean:=true;
 v_member text:=nullif(btrim(p_request->>'memberId'),'');
 v_day date;v_yash_coverage jsonb;v_yash_unknown_days integer;v_yash_quality jsonb;
begin
  if current_user<>'postgres' or jsonb_typeof(p_catalog)is distinct from'array' or jsonb_array_length(p_catalog)<>1
   or coalesce(p_request->>'operation','summary')<>'summary' or p_request->'charts'is distinct from'false'::jsonb
   or coalesce(p_request->>'threshold','15')<>'15' or coalesce(p_request->'providers','[]'::jsonb)not in('[]'::jsonb,'null'::jsonb)
  then raise exception using errcode='22023',message='submission_cohort_day_contract';end if;
  -- Caller supplies an already-authorized or private scheduled native catalog.
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
  select * into v_platform from jsonb_to_recordset(p_catalog) as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
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
   n.status_group='success' paid,coalesce(n.status_group in ('success','pending','failed','rejected'),false) status_known,n.status_code::text source_status,$newar_level$ level_text,$newar_count$ count_text
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
   l.status_class='success' paid,coalesce(l.status_class in ('success','pending','rejected'),false) status_known,coalesce(nullif(l.status_text,''),l.status_code::text) source_status,null::text level_text,null::text count_text
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
 elsif v_platform.source='kb' and v_platform.scope_group='IN' and v_platform.source_name='YASH.BET' and v_platform.id=md5('kb:IN:YASH.BET')::uuid and v_platform.timezone='Asia/Kolkata' then
  v_time_filter:='y.created_at>=$5 and y.created_at<$6';v_undated_filter:='y.created_at is null';
  v_source:=$q$select y.order_no order_id,nullif(btrim(y.uid),'') member_id,y.created_at,y.amount,y.currency,
   private.dashboard_admin_yash_order_provider(y.order_type,y.supplier,y.channel) raw_provider,
   private.dashboard_admin_yash_status('deposit',y.status)='success' paid,private.dashboard_admin_yash_status('deposit',y.status)<>'unknown' status_known,y.status::text source_status,null::text level_text,null::text count_text
   from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(y.uid),'') member_id,(private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) at time zone $4)::date as day
   from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and private.dashboard_admin_yash_status('deposit',y.status)='success'
   and y.completed_at>=$5 and y.completed_at<$6 and private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is not null$q$;
  select jsonb_object_agg(d::date::text,private.dashboard_admin_yash_submission_coverage(d::date)) into v_yash_coverage
   from generate_series((v_from at time zone v_platform.timezone)::date::timestamp,(v_to at time zone v_platform.timezone)::date::timestamp-interval '1 day',interval '1 day') d;
 else
  raise exception using errcode='22023',message='submission_source_unavailable';
 end if;
 -- Keep bounded time reads and the sparse NULL-time lookup as independent
 -- indexable branches; an OR would encourage full platform-history scans.
 if v_platform.source='ar' then v_undated_source:=replace(v_source,'$source_time_filter$',v_undated_filter);end if;
 v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);
 if v_currency is not null and v_currency<>v_platform.currency then raise exception using errcode='22023',message='invalid_currency';end if;
 if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and v_charts
  and (v_from at time zone v_platform.timezone)::date>=date '2026-10-10' then
  -- Hold ordinary metadata read locks through the statement before checking
  -- exact source maintenance and three-set readiness. No source rows are read.
  perform 1 from public.ar_collected_orders limit 0;
  perform 1 from private.ar_91club_submission_facts limit 0;
  perform 1 from private.ar_91club_submission_epoch limit 0;
  perform 1 from private.ar_91club_submission_ready limit 0;
  perform 1 from private.ar_91club_submission_null_ready limit 0;
  perform 1 from private.ar_91club_submission_future_ready limit 0;
  if (select count(*)=2 from pg_catalog.pg_proc p where p.oid in('private.ar_91club_submission_generation()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure)
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s' and p.proparallel='u' and not p.proretset and not p.proisstrict and not p.proleakproof and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}'
   and(case when p.proname='ar_91club_submission_generation'then p.pronargs=0 and p.proargnames is null and pg_get_function_arguments(p.oid)=''else p.pronargs=2 and p.proargnames=array['p_from','p_to']::text[]and pg_get_function_arguments(p.oid)='p_from date, p_to date'end)
   and(case when p.proname='ar_91club_submission_generation' then p.prolang=(select oid from pg_language where lanname='sql')and md5(p.prosrc)='acd188a5da0cb2f63381bd5922e3a1cf'and p.prorettype='text'::regtype else p.prolang=(select oid from pg_language where lanname='plpgsql')and md5(p.prosrc)='7252e3966d916239a3ce212ba91dc763'and p.prorettype='boolean'::regtype end))then
   if private.ar_91club_submission_can_read((v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
   -- The same full-population proof also covers chart inputs. Keep the generic
   -- chart/amount/qualification SQL unchanged; only use the exact native copy.
   v_source:=replace(v_source,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   v_success:=replace(v_success,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   v_undated_source:=replace(v_undated_source,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   -- Current can_read fingerprints a VALIDATED CHECK fixing all four keys.
   -- Keep bind fences; do not remove any money atom or provider/date filter.
   v_source:=replace(v_source,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   v_success:=replace(v_success,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   v_undated_source:=replace(v_undated_source,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   -- The chart needs native amounts for every selected order. Expand only
   -- this exact current rule; drift keeps the ordinary helper call unchanged.
   if exists(select 1 from pg_catalog.pg_proc m
    where m.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
    and md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
    and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_language where lanname='sql')
    and m.provolatile='i'and m.proparallel='s'and not m.prosecdef and not m.proisstrict and not m.proleakproof
    and m.proconfig is not distinct from array['search_path=""']::text[]
    and m.proacl::text is not distinct from '{postgres=X/postgres}'and m.pronargdefaults=0
    and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8
    and m.proargnames=array['p_country','p_kind','p_channel_type','p_version','p_local','p_local_currency','p_issue','p_legacy_display']::text[]
    and pg_get_function_arguments(m.oid)='p_country text, p_kind text, p_channel_type text, p_version smallint, p_local numeric, p_local_currency text, p_issue text, p_legacy_display numeric')then
    v_source:=replace(v_source,$ar91_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)$ar91_amount_call$,$ar91_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (a.amount)
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (a.amount)
 END$ar91_amount_case$);
    v_undated_source:=replace(v_undated_source,$ar91_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)$ar91_amount_call$,$ar91_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (a.amount)
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (a.amount)
 END$ar91_amount_case$);
   end if;
   end if;
  end if;
 end if;
 v_sql:='with source_rows as not materialized ('||v_source||'), successes as materialized ('||v_success||$q$),
 canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider from (select distinct raw_provider from source_rows) names
 ), unplaced_members as materialized (
  select distinct member_id from source_rows where created_at is null and member_id is not null
 ), orders as materialized (
  select s.*,(created_at at time zone $4)::date as day,c.provider,
   case when upper(btrim(level_text)) ~ '^L(V)?[0-9]{1,4}$' then regexp_replace(upper(btrim(level_text)),'^LV?','')::int
    when btrim(level_text) ~ '^[0-9]{1,4}$' then btrim(level_text)::int end member_level,
   case when btrim(count_text) ~ '^[0-9]{1,9}$' then btrim(count_text)::int end recharge_count
  from source_rows s join canonical c using(raw_provider) where created_at is not null
 ), member_days as materialized (
  select day,member_id,count(*) submitted_count,
   case when count(*) filter(where amount is null or currency is distinct from $17)>0 then null else sum(amount) end platform_day_amount,
   count(*) filter(where paid) cohort_success_count,bool_and(status_known) statuses_known,
   count(*) filter(where nullif(btrim(order_id),'') is null)=0 and count(distinct order_id)=count(*)
    and bool_and(u.member_id is null) sequence_known,
   count(*) platform_day_invalid_count,
   case when count(*) filter(where amount is null or currency is distinct from $17)>0 then null
    else coalesce(sum(amount),0) end platform_day_invalid_amount,
   case when max(recharge_count)>0 then 'funded' when count(recharge_count)=count(*) and max(recharge_count)=0 and count(member_level)=count(*) and max(member_level)=0 then 'new' else 'unknown' end member_class,
   max(recharge_count) recharge_count, bool_or(member_level=0) has_l0,
   case when count(member_level)>0 then 'L'||max(member_level)::text end member_level,
   min(created_at) first_at,max(created_at) last_at
  from orders left join unplaced_members u using(member_id) where member_id is not null group by day,member_id
 ), eligible as materialized (
  select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
   and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
   and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
 ), selected_orders as materialized (
  select o.* from orders o where ($8::text[] is null or provider=any($8)) and created_at>=$15 and created_at<$16 and currency=$17
 ), selected_coverage as (
  select count(*) order_count,count(*) filter(where member_id is null) missing_member_count,
   count(*) filter(where member_level is null) missing_level_count,count(*) filter(where recharge_count is null) missing_recharge_count
  from selected_orders
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
  select o.provider,o.created_at,o.day,o.amount,o.paid,coalesce((o.day,o.member_id) in (select e.day,e.member_id from eligible e where submitted_count>$9),false) flagged
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
/* submission_cohort_final */ select jsonb_build_object(
  'dashboard',case when $14='summary' and $21 then jsonb_build_object(
   'version',3,'threshold',$9,'exemptCount',0,'thresholdComparison','gt','amountBands',$20::jsonb,
   'monitoring',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first),'[]'::jsonb) from monitoring m),
   'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by provider,hour),'[]'::jsonb) from heatmap h),
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]'::jsonb) from daily_chart d),
   'amounts',(select coalesce(jsonb_agg(to_jsonb(a) order by bucket),'[]'::jsonb) from amount_chart a),
   'frequency',(select coalesce(jsonb_agg(to_jsonb(f) order by band),'[]'::jsonb) from frequency_counts f)) end,
  'metrics',case when $14='summary' then (select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m) end,
  'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
   'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
   -- Count the actual unknown-status rows in the selected members' whole-day
   -- cohorts, including another provider/time slice. Those rows prevent a
   -- no-success conclusion; unrelated member-days must not taint this scope.
   -- Missing-member rows cannot be joined to a cohort, so retain the selected
   -- unknown rows separately without counting known affected rows as unknown.
   'unknownStatusCount',(select count(*) from orders o join selected_member_days s using(day,member_id) where not o.status_known)
     +(select count(*) from selected_orders where member_id is null and not status_known),
   'orderSequenceUncertainCount',(select count(*) from selected_orders o join member_days m using(day,member_id) where not m.sequence_known),
   'sourceCompletenessVerified',false) from selected_coverage sc),
  'total',case when $14='members' then (select count(*) from details) when $14='memberOrders' then (select count(*) from member_orders) end,
  'members',case when $14='members' then (select count(distinct member_id) from details) end,
  'rows',case when $14='members' then (select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from detail_page d)
   when $14='memberOrders' then (select coalesce(jsonb_agg(to_jsonb(o) order by created_at,order_id),'[]'::jsonb) from member_order_page o) end,
  'amountGroups',case when $14='memberOrders' then (select coalesce(jsonb_agg(to_jsonb(g) order by currency,amount::numeric nulls last),'[]'::jsonb) from member_amount_groups g) end,
  'memberId',case when $14='memberOrders' then $13 end,'day',case when $14='memberOrders' then $23 end,
  'offset',case when $14='memberOrders' then $11 end,'limit',case when $14='memberOrders' then $12 end,
  'hasMore',case when $14='memberOrders' then $11+$12<(select count(*) from member_orders) end)
 $q$;
 if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='OKWIN'
  and v_operation='summary' and not v_charts
  and (v_from at time zone v_platform.timezone)::date>=date '2026-10-10'
  and to_regclass('private.ar_submission_typed_facts')is not null
  and to_regclass('private.ar_submission_fact_epoch')is not null
  and to_regclass('private.ar_submission_day_ready')is not null
  and to_regclass('private.ar_submission_null_ready')is not null
  and to_regclass('private.ar_submission_future_ready')is not null then
  -- Metadata AccessShare locks and same-statement native proof precede any
  -- narrow projected read. This pair is a physical source identity, not a grant.
  perform 1 from public.ar_collected_orders limit 0;
  perform 1 from private.ar_submission_typed_facts limit 0;
  perform 1 from private.ar_submission_fact_epoch limit 0;
  perform 1 from private.ar_submission_day_ready limit 0;
  perform 1 from private.ar_submission_null_ready limit 0;
  perform 1 from private.ar_submission_future_ready limit 0;
  if (select count(*)=2 from pg_proc p where p.oid in(to_regprocedure('private.ar_submission_fact_generation(text,text)'),to_regprocedure('private.ar_submission_fact_can_read(text,text,date,date)'))
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s'and p.proparallel='u'and p.prolang=(select oid from pg_language where lanname='plpgsql')and not p.proretset and not p.proisstrict and not p.proleakproof and p.prokind='f'and p.pronargdefaults=0 and p.provariadic=0 and p.proconfig=array['search_path=""']::text[]and p.proacl::text='{postgres=X/postgres}'
   and((p.oid=to_regprocedure('private.ar_submission_fact_generation(text,text)')and md5(p.prosrc)='44e726b77cdbb15c8db7b0af81346a1b'and p.prorettype='text'::regtype and pg_get_function_arguments(p.oid)='p_country text, p_platform text') or (p.oid=to_regprocedure('private.ar_submission_fact_can_read(text,text,date,date)')and md5(p.prosrc)='59b1aaad5881647d9fb90dbb0074548d'and p.prorettype='boolean'::regtype and pg_get_function_arguments(p.oid)='p_country text, p_platform text, p_from date, p_to date')))then
   if private.ar_submission_fact_can_read(v_platform.scope_group,v_platform.source_name,(v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
    v_sql:=$q$with source_rows as not materialized (select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
 a.applied_at at time zone $4 created_at,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
 a.status='已支付' paid,coalesce(a.status in('已支付','待支付','支付失败','已取消'),false)status_known,
 a.member_level native_member_level,a.recharge_count native_recharge_count
 from private.ar_submission_typed_facts a where a.country_code=$2 and a.platform=$3 and $2::text='IN' and $3::text='OKWIN'
 and a.applied_at>=($5 at time zone $4)and a.applied_at<($6 at time zone $4)),successes as materialized(select nullif(btrim(a.member_id),'')member_id,a.completed_at::date as day from private.ar_submission_typed_facts a
 where a.country_code=$2 and a.platform=$3 and $2::text='IN'and $3::text='OKWIN'and a.status='已支付'
 and a.completed_at>=($5 at time zone $4)and a.completed_at<($6 at time zone $4)), typed_orders as materialized (
 select s.order_id,s.member_id,(s.created_at at time zone $4)::date as day,
  (s.created_at>=$15 and s.created_at<$16) selected_clock,
  s.raw_provider,s.paid,s.status_known,
  case when s.native_member_level between 0 and 9999 then s.native_member_level end member_level,
  case when s.native_recharge_count between 0 and 999999999 then s.native_recharge_count end recharge_count
 from source_rows s where s.created_at is not null
), native_provider_summary as materialized (
 -- One native-provider pass supplies both canonical names and selected coverage.
 -- Preserve every whole-day provider here; filtering happens after canonicalization.
 select o.raw_provider,
  count(*) filter(where o.selected_clock and $17::text is not null) selected_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null) missing_member_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_level is null) missing_level_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o group by o.raw_provider
), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from native_provider_summary
), unplaced_members as materialized (
 select distinct nullif(btrim(a.member_id),'') member_id
 from private.ar_submission_typed_facts a
 where a.country_code=$2 and a.platform=$3 and $2::text='IN' and $3::text='OKWIN'
  and a.applied_at is null
  and nullif(btrim(a.member_id),'') is not null
), member_days as materialized (
 select o.day,o.member_id,count(*) submitted_count,count(*) filter(where o.paid) cohort_success_count,
  bool_and(o.status_known) statuses_known,
  count(*) filter(where nullif(btrim(o.order_id),'') is null)=0 and count(distinct o.order_id)=count(*)
   and bool_and(u.member_id is null) sequence_known,
  count(*) filter(where not o.status_known) unknown_status_count,
  count(*) filter(where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null) selected_count,
  case when max(o.recharge_count)>0 then 'funded'
   when count(o.recharge_count)=count(*) and max(o.recharge_count)=0 and count(o.member_level)=count(*) and max(o.member_level)=0 then 'new' else 'unknown' end member_class,
  bool_or(o.member_level=0) has_l0
 from typed_orders o left join unplaced_members u using(member_id) join canonical c using(raw_provider)
 where o.member_id is not null group by o.day,o.member_id
), eligible as materialized (
 select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
  and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
  and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
), selected_provider_summary as materialized (
 -- Merge native aliases only after the existing canonical helper. Count sums
 -- retain bigint types and exclude zero selected rows exactly as the old WHERE.
 select c.provider,sum(n.selected_count)::bigint selected_count,
  sum(n.missing_member_count)::bigint missing_member_count,
  sum(n.missing_level_count)::bigint missing_level_count,
  sum(n.missing_recharge_count)::bigint missing_recharge_count,
  sum(n.missing_member_unknown_count)::bigint missing_member_unknown_count
 from native_provider_summary n join canonical c using(raw_provider)
 where n.selected_count>0 and ($8::text[] is null or c.provider=any($8))
 group by c.provider
), qualified_orders as materialized (
 -- This materialization contains only eligible, selected rows. It prevents the
 -- scalar money helper from moving back into the full-day source scan.
 select o.day,o.member_id,c.provider,m.submitted_count,m.member_class,m.has_l0,
  o.order_id
 from typed_orders o join eligible m using(day,member_id) join canonical c using(raw_provider)
 where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null
), qualified_amounts as materialized (
 select q.day,q.member_id,q.provider,q.submitted_count,q.member_class,q.has_l0,
  (select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)
   from private.ar_submission_typed_facts a
   where a.source_system='AR' and a.country_code=$2 and a.platform=$3
    and a.order_kind='recharge' and a.order_no=q.order_id) amount
 from qualified_orders q
), qualified_members as (
 select q.day,q.member_id,q.provider,max(q.submitted_count) submitted_count,max(q.member_class) member_class,bool_or(q.has_l0) has_l0,
  count(*) invalid_count,count(*) filter(where q.amount is null) missing_amount,coalesce(sum(q.amount),0) invalid_amount
 from qualified_amounts q group by q.day,q.member_id,q.provider
), metric_values as (
 select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,
  count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
  count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
  sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
 from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
 group by grouping sets ((q.provider,t.threshold),(t.threshold))
), dimensions as (select null::text provider union all select provider from selected_provider_summary), metrics as (
 select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
  coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
  coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
  coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,
  coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
 from dimensions d cross join unnest($22::integer[]) t(threshold)
 left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
), selected_coverage as (
 select coalesce(sum(selected_count),0)::bigint order_count,
  coalesce(sum(missing_member_count),0)::bigint missing_member_count,
  coalesce(sum(missing_level_count),0)::bigint missing_level_count,
  coalesce(sum(missing_recharge_count),0)::bigint missing_recharge_count,
  coalesce(sum(missing_member_unknown_count),0)::bigint missing_member_unknown_count
 from selected_provider_summary
)
/* submission_cohort_final */select jsonb_build_object('dashboard',null,
 'metrics',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m),
 'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
  'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
  'unknownStatusCount',coalesce((select sum(m.unknown_status_count)::bigint from member_days m where m.selected_count>0),0)+sc.missing_member_unknown_count,
  'orderSequenceUncertainCount',coalesce((select sum(m.selected_count)::bigint from member_days m where not m.sequence_known),0),
  'sourceCompletenessVerified',false) from selected_coverage sc),
 'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$q$;
   end if;
  end if;
 end if;
 if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and not v_charts
  and (v_from at time zone v_platform.timezone)::date>=date '2026-10-10' then
  -- Hold ordinary metadata read locks through the statement before checking
  -- exact source maintenance and three-set readiness. No source rows are read.
  perform 1 from public.ar_collected_orders limit 0;
  perform 1 from private.ar_91club_submission_facts limit 0;
  perform 1 from private.ar_91club_submission_epoch limit 0;
  perform 1 from private.ar_91club_submission_ready limit 0;
  perform 1 from private.ar_91club_submission_null_ready limit 0;
  perform 1 from private.ar_91club_submission_future_ready limit 0;
  if (select count(*)=2 from pg_catalog.pg_proc p where p.oid in('private.ar_91club_submission_generation()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure)
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s' and p.proparallel='u' and not p.proretset and not p.proisstrict and not p.proleakproof and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}'
   and(case when p.proname='ar_91club_submission_generation' then p.prolang=(select oid from pg_language where lanname='sql')and md5(p.prosrc)='acd188a5da0cb2f63381bd5922e3a1cf'and p.prorettype='text'::regtype else p.prolang=(select oid from pg_language where lanname='plpgsql')and md5(p.prosrc)='7252e3966d916239a3ce212ba91dc763'and p.prorettype='boolean'::regtype end))then
   if private.ar_91club_submission_can_read((v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
   v_sql:=$q$with source_rows as not materialized (select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
 a.applied_at at time zone $4 created_at,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
 a.status='已支付' paid,coalesce(a.status in('已支付','待支付','支付失败','已取消'),false)status_known,
 a.member_level native_member_level,a.recharge_count native_recharge_count
 from private.ar_91club_submission_facts a where $2::text='IN' and $3::text='91CLUB'
 and a.applied_at>=($5 at time zone $4)and a.applied_at<($6 at time zone $4)),successes as materialized(select nullif(btrim(a.member_id),'')member_id,a.completed_at::date as day from private.ar_91club_submission_facts a
 where $2::text='IN'and $3::text='91CLUB'and a.status='已支付'
 and a.completed_at>=($5 at time zone $4)and a.completed_at<($6 at time zone $4)), typed_orders as materialized (
 select s.order_id,s.member_id,(s.created_at at time zone $4)::date as day,
  (s.created_at>=$15 and s.created_at<$16) selected_clock,
  s.raw_provider,s.paid,s.status_known,
  case when s.native_member_level between 0 and 9999 then s.native_member_level end member_level,
  case when s.native_recharge_count between 0 and 999999999 then s.native_recharge_count end recharge_count
 from source_rows s where s.created_at is not null
), native_provider_summary as materialized (
 -- One native-provider pass supplies both canonical names and selected coverage.
 -- Preserve every whole-day provider here; filtering happens after canonicalization.
 select o.raw_provider,
  count(*) filter(where o.selected_clock and $17::text is not null) selected_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null) missing_member_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_level is null) missing_level_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o group by o.raw_provider
), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from native_provider_summary
), unplaced_members as materialized (
 select distinct nullif(btrim(a.member_id),'') member_id
 from private.ar_91club_submission_facts a
 where $2::text='IN' and $3::text='91CLUB'
  and a.applied_at is null
  and nullif(btrim(a.member_id),'') is not null
), member_days as materialized (
 select o.day,o.member_id,count(*) submitted_count,count(*) filter(where o.paid) cohort_success_count,
  bool_and(o.status_known) statuses_known,
  count(*) filter(where nullif(btrim(o.order_id),'') is null)=0
   and bool_and(u.member_id is null) sequence_known,
  count(*) filter(where not o.status_known) unknown_status_count,
  count(*) filter(where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null) selected_count,
  case when max(o.recharge_count)>0 then 'funded'
   when count(o.recharge_count)=count(*) and max(o.recharge_count)=0 and count(o.member_level)=count(*) and max(o.member_level)=0 then 'new' else 'unknown' end member_class,
  bool_or(o.member_level=0) has_l0
 from typed_orders o left join unplaced_members u using(member_id) join canonical c using(raw_provider)
 where o.member_id is not null group by o.day,o.member_id
), eligible as materialized (
 select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
  and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
  and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
), selected_provider_summary as materialized (
 -- Merge native aliases only after the existing canonical helper. Count sums
 -- retain bigint types and exclude zero selected rows exactly as the old WHERE.
 select c.provider,sum(n.selected_count)::bigint selected_count,
  sum(n.missing_member_count)::bigint missing_member_count,
  sum(n.missing_level_count)::bigint missing_level_count,
  sum(n.missing_recharge_count)::bigint missing_recharge_count,
  sum(n.missing_member_unknown_count)::bigint missing_member_unknown_count
 from native_provider_summary n join canonical c using(raw_provider)
 where n.selected_count>0 and ($8::text[] is null or c.provider=any($8))
 group by c.provider
), qualified_orders as materialized (
 -- This materialization contains only eligible, selected rows. It prevents the
 -- scalar money helper from moving back into the full-day source scan.
 select o.day,o.member_id,c.provider,m.submitted_count,m.member_class,m.has_l0,
  o.order_id
 from typed_orders o join eligible m using(day,member_id) join canonical c using(raw_provider)
 where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null
), qualified_amounts as materialized (
 select q.day,q.member_id,q.provider,q.submitted_count,q.member_class,q.has_l0,
  (select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)
   from private.ar_91club_submission_facts a
   where a.source_system='AR' and a.country_code=$2 and a.platform=$3
    and a.order_kind='recharge' and a.order_no=q.order_id) amount
 from qualified_orders q
), qualified_members as (
 select q.day,q.member_id,q.provider,max(q.submitted_count) submitted_count,max(q.member_class) member_class,bool_or(q.has_l0) has_l0,
  count(*) invalid_count,count(*) filter(where q.amount is null) missing_amount,coalesce(sum(q.amount),0) invalid_amount
 from qualified_amounts q group by q.day,q.member_id,q.provider
), metric_values as (
 select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,
  count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
  count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
  sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
 from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
 group by grouping sets ((q.provider,t.threshold),(t.threshold))
), dimensions as (select null::text provider union all select provider from selected_provider_summary), metrics as (
 select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
  coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
  coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
  coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,
  coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
 from dimensions d cross join unnest($22::integer[]) t(threshold)
 left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
), selected_coverage as (
 select coalesce(sum(selected_count),0)::bigint order_count,
  coalesce(sum(missing_member_count),0)::bigint missing_member_count,
  coalesce(sum(missing_level_count),0)::bigint missing_level_count,
  coalesce(sum(missing_recharge_count),0)::bigint missing_recharge_count,
  coalesce(sum(missing_member_unknown_count),0)::bigint missing_member_unknown_count
 from selected_provider_summary
)
/* submission_cohort_final */select jsonb_build_object('dashboard',null,
 'metrics',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m),
 'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
  'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
  'unknownStatusCount',coalesce((select sum(m.unknown_status_count)::bigint from member_days m where m.selected_count>0),0)+sc.missing_member_unknown_count,
  'orderSequenceUncertainCount',coalesce((select sum(m.selected_count)::bigint from member_days m where not m.sequence_known),0),
  'sourceCompletenessVerified',false) from selected_coverage sc),
 'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$q$;
   end if;
  end if;
 end if;
 if v_operation='summary'and v_charts
  and v_platform.source='ar'and v_platform.scope_group='IN'and v_platform.source_name='91CLUB'
  and position('from private.ar_91club_submission_facts'in v_source)>0 then
  -- Exact proved 91CLUB chart lane; main auth, proof/money guard, source dates,
  -- independent completed-day read, status and finite threshold rules persist.
 v_sql:=$compact$with source_rows as not materialized ($compact$||v_source||$compact$),successes as materialized ($compact$||v_success||$compact$),
 typed_orders as materialized (
  -- One compact native pass. Original getters/money atoms remain intact;
  -- the summary never consumes per-order source status or raw level text.
  select s.order_id,s.member_id,s.created_at,(s.created_at at time zone $4)::date as day,
   case when s.created_at is not null then s.amount end amount,s.currency,s.raw_provider,s.paid,s.status_known,
   case when s.created_at is not null then case
    when upper(btrim(s.level_text))~'^L(V)?[0-9]{1,4}$'then regexp_replace(upper(btrim(s.level_text)),'^LV?','')::int
    when btrim(s.level_text)~'^[0-9]{1,4}$'then btrim(s.level_text)::int end end member_level,
   case when s.created_at is not null and btrim(s.count_text)~'^[0-9]{1,9}$'then btrim(s.count_text)::int end recharge_count
  from source_rows s
 ),canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider)provider
  from(select distinct raw_provider from typed_orders)names
 ),unplaced_members as materialized (
  select distinct member_id from typed_orders where created_at is null and member_id is not null
 ),orders as not materialized (
  select o.*,c.provider,coalesce(($8::text[]is null or c.provider=any($8))and o.created_at>=$15 and o.created_at<$16 and o.currency=$17,false)selected
  from typed_orders o join canonical c using(raw_provider)where created_at is not null
 ),member_days as materialized (
  -- Keep whole-day/all-provider qualification and exact DISTINCT sequence.
  -- No full-cohort money SUM or detail-only first/last values in a chart read.
  select day,member_id,count(*)submitted_count,count(*)filter(where paid)cohort_success_count,
   bool_and(status_known)statuses_known,count(*)filter(where not status_known)unknown_status_count,
   count(*)filter(where nullif(btrim(order_id),'')is null)=0 and count(distinct order_id)=count(*)and bool_and(u.member_id is null)sequence_known,
   count(*)filter(where selected)selected_count,
   case when max(recharge_count)>0 then 'funded'when count(recharge_count)=count(*)and max(recharge_count)=0 and count(member_level)=count(*)and max(member_level)=0 then 'new'else 'unknown'end member_class,
   bool_or(member_level=0)has_l0
  from orders left join unplaced_members u using(member_id)where member_id is not null group by day,member_id
 ),eligible as materialized (
  select m.*from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
   and($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
   and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
 ),selected_orders as not materialized (
  select o.day,o.member_id,o.provider,o.created_at,o.amount,o.paid,o.status_known,o.member_level,o.recharge_count
  from orders o where selected
 ),selected_coverage as (
  select count(*)order_count,count(*)filter(where member_id is null)missing_member_count,
   count(*)filter(where member_level is null)missing_level_count,count(*)filter(where recharge_count is null)missing_recharge_count,
   count(*)filter(where member_id is null and not status_known)missing_member_unknown_count
  from selected_orders
 ),qualified as not materialized (
  select o.day,o.member_id,o.provider,o.amount,m.submitted_count,m.member_class,m.has_l0
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
 ),
 dashboard_orders as materialized (
  select o.provider,o.created_at,o.day,o.amount,o.paid,(e.member_id is not null) flagged
  from selected_orders o left join eligible e on e.day=o.day and e.member_id=o.member_id and e.submitted_count>$9 where $14='summary' and $21
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
/* submission_cohort_final */ select jsonb_build_object(
  'dashboard',case when $14='summary' and $21 then jsonb_build_object(
   'version',3,'threshold',$9,'exemptCount',0,'thresholdComparison','gt','amountBands',$20::jsonb,
   'monitoring',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first),'[]'::jsonb) from monitoring m),
   'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by provider,hour),'[]'::jsonb) from heatmap h),
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]'::jsonb) from daily_chart d),
   'amounts',(select coalesce(jsonb_agg(to_jsonb(a) order by bucket),'[]'::jsonb) from amount_chart a),
   'frequency',(select coalesce(jsonb_agg(to_jsonb(f) order by band),'[]'::jsonb) from frequency_counts f)) end,
  'metrics',case when $14='summary' then (select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m) end,
  'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
   'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
   -- Count the actual unknown-status rows in the selected members' whole-day
   -- cohorts, including another provider/time slice. Those rows prevent a
   -- no-success conclusion; unrelated member-days must not taint this scope.
   -- Missing-member rows cannot be joined to a cohort, so retain the selected
   -- unknown rows separately without counting known affected rows as unknown.
   'unknownStatusCount',coalesce((select sum(unknown_status_count)::bigint from member_days where selected_count>0),0)
     +sc.missing_member_unknown_count,
   'orderSequenceUncertainCount',coalesce((select sum(selected_count)::bigint from member_days where not sequence_known),0),
   'sourceCompletenessVerified',false) from selected_coverage sc),
  'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$compact$;
 end if;
 if v_operation='summary' and v_charts and v_platform.source='ar'
  and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and position('from private.ar_91club_submission_facts' in v_source)>0 then
  -- Validated fixed four-key population + immediate five-key PK make order_id
  -- unique. Preserve blank IDs and whole-history unplaced-member exclusion.
  -- Exact generation has already proved native int4 types. Its canonical int
  -- text has only 0..9999 / 0..999999999 accepted by the original regex.
  v_sql:=replace(v_sql,'a.member_level::text level_text','a.member_level member_level_native');
  v_sql:=replace(v_sql,'a.recharge_count::text count_text','a.recharge_count recharge_count_native');
  v_sql:=replace(v_sql,$parseold$   case when s.created_at is not null then case
    when upper(btrim(s.level_text))~'^L(V)?[0-9]{1,4}$'then regexp_replace(upper(btrim(s.level_text)),'^LV?','')::int
    when btrim(s.level_text)~'^[0-9]{1,4}$'then btrim(s.level_text)::int end end member_level,
   case when s.created_at is not null and btrim(s.count_text)~'^[0-9]{1,9}$'then btrim(s.count_text)::int end recharge_count$parseold$,$parsenew$   case when s.created_at is not null and s.member_level_native between 0 and 9999 then s.member_level_native end member_level,
   case when s.created_at is not null and s.recharge_count_native between 0 and 999999999 then s.recharge_count_native end recharge_count$parsenew$);
  v_sql:=replace(v_sql,$seqold$count(*)filter(where nullif(btrim(order_id),'')is null)=0 and count(distinct order_id)=count(*)and bool_and(u.member_id is null)sequence_known$seqold$,$seqnew$count(*)filter(where nullif(btrim(order_id),'')is null)=0 and bool_and(u.member_id is null)sequence_known$seqnew$);
 end if;
 if v_platform.source='ar' then
  v_sql:=replace(v_sql,'select distinct member_id from source_rows where created_at is null and member_id is not null',
   'select distinct member_id from ('||v_undated_source||') s where created_at is null and member_id is not null');
 end if;
 -- Exact MAAN charge summaries. Original auth/catalog/filter validation has
 -- already completed; unproved days, schema/maintenance drift or other zones
 -- keep the ordinary native path. No cache or upstream completeness is implied.
 if v_operation='summary'and v_platform.source='newar'
 and v_platform.scope_group='IN'and v_platform.source_name='MAANWIN'
 and v_platform.timezone in('Asia/Kolkata','Asia/Calcutta')
 and (v_from at time zone v_platform.timezone)::date>=date'2026-10-10'
 and to_regclass('private.maan_submission_facts')is not null
 and to_regclass('private.maan_submission_epoch')is not null
 and to_regclass('private.maan_submission_ready')is not null
 and to_regclass('private.maan_submission_future_ready')is not null then
  perform 1 from public.newar_detail_records limit 0;
  perform 1 from private.maan_submission_facts limit 0;
  perform 1 from private.maan_submission_epoch limit 0;
  perform 1 from private.maan_submission_ready limit 0;
  perform 1 from private.maan_submission_future_ready limit 0;
  if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['maan_submission_generation','maan_submission_can_read']))::text))is not distinct from '8df2fa80e7e883e25106e7b77eb51bd9'then
   if private.maan_submission_can_read((v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
    v_sql:=$maan_query$with source_rows as not materialized (select f.order_id,f.member_id,f.created_at,f.amount,f.currency,f.raw_provider,f.paid,f.status_known,
 f.member_level member_level_native,f.recharge_count recharge_count_native
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.created_at>=$5 and f.created_at<$6
 and(t.launch_at is null or f.created_at>=t.launch_at or f.created_at is null)
 union all select f.order_id,f.member_id,f.created_at,f.amount,f.currency,f.raw_provider,f.paid,f.status_known,
 f.member_level member_level_native,f.recharge_count recharge_count_native
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.created_at is null
 and(t.launch_at is null or f.created_at>=t.launch_at or f.created_at is null)),successes as materialized (select f.member_id,(f.success_at at time zone $4)::date as day
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.paid and f.success_at>=$5 and f.success_at<$6
 and(t.launch_at is null or f.created_at>=t.launch_at)),
 typed_orders as materialized (
  -- One compact native pass. Original getters/money atoms remain intact;
  -- the summary never consumes per-order source status or raw level text.
  select s.order_id,s.member_id,s.created_at,(s.created_at at time zone $4)::date as day,
   case when s.created_at is not null then s.amount end amount,s.currency,s.raw_provider,s.paid,s.status_known,
   case when s.created_at is not null then s.member_level_native end member_level,
   case when s.created_at is not null then s.recharge_count_native end recharge_count
  from source_rows s
 ),canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider)provider
  from(select distinct raw_provider from typed_orders)names
 ),unplaced_members as materialized (
  select distinct member_id from typed_orders where created_at is null and member_id is not null
 ),orders as not materialized (
  select o.*,c.provider,coalesce(($8::text[]is null or c.provider=any($8))and o.created_at>=$15 and o.created_at<$16 and o.currency=$17,false)selected
  from typed_orders o join canonical c using(raw_provider)where created_at is not null
 ),member_days as materialized (
  -- Keep whole-day/all-provider qualification and exact DISTINCT sequence.
  -- No full-cohort money SUM or detail-only first/last values in a chart read.
  select day,member_id,count(*)submitted_count,count(*)filter(where paid)cohort_success_count,
   bool_and(status_known)statuses_known,count(*)filter(where not status_known)unknown_status_count,
   count(*)filter(where nullif(btrim(order_id),'')is null)=0 and count(distinct order_id)=count(*)and bool_and(u.member_id is null)sequence_known,
   count(*)filter(where selected)selected_count,
   case when max(recharge_count)>0 then 'funded'when count(recharge_count)=count(*)and max(recharge_count)=0 and count(member_level)=count(*)and max(member_level)=0 then 'new'else 'unknown'end member_class,
   bool_or(member_level=0)has_l0
  from orders left join unplaced_members u using(member_id)where member_id is not null group by day,member_id
 ),eligible as materialized (
  select m.*from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
   and($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
   and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
 ),selected_orders as not materialized (
  select o.day,o.member_id,o.provider,o.created_at,o.amount,o.paid,o.status_known,o.member_level,o.recharge_count
  from orders o where selected
 ),selected_coverage as (
  select count(*)order_count,count(*)filter(where member_id is null)missing_member_count,
   count(*)filter(where member_level is null)missing_level_count,count(*)filter(where recharge_count is null)missing_recharge_count,
   count(*)filter(where member_id is null and not status_known)missing_member_unknown_count
  from selected_orders
 ),qualified as not materialized (
  select o.day,o.member_id,o.provider,o.amount,m.submitted_count,m.member_class,m.has_l0
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
 ),
 dashboard_orders as materialized (
  select o.provider,o.created_at,o.day,o.amount,o.paid,(e.member_id is not null) flagged
  from selected_orders o left join eligible e on e.day=o.day and e.member_id=o.member_id and e.submitted_count>$9 where $14='summary' and $21
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
/* submission_cohort_final */ select jsonb_build_object(
  'dashboard',case when $14='summary' and $21 then jsonb_build_object(
   'version',3,'threshold',$9,'exemptCount',0,'thresholdComparison','gt','amountBands',$20::jsonb,
   'monitoring',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first),'[]'::jsonb) from monitoring m),
   'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by provider,hour),'[]'::jsonb) from heatmap h),
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]'::jsonb) from daily_chart d),
   'amounts',(select coalesce(jsonb_agg(to_jsonb(a) order by bucket),'[]'::jsonb) from amount_chart a),
   'frequency',(select coalesce(jsonb_agg(to_jsonb(f) order by band),'[]'::jsonb) from frequency_counts f)) end,
  'metrics',case when $14='summary' then (select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m) end,
  'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
   'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
   -- Count the actual unknown-status rows in the selected members' whole-day
   -- cohorts, including another provider/time slice. Those rows prevent a
   -- no-success conclusion; unrelated member-days must not taint this scope.
   -- Missing-member rows cannot be joined to a cohort, so retain the selected
   -- unknown rows separately without counting known affected rows as unknown.
   'unknownStatusCount',coalesce((select sum(unknown_status_count)::bigint from member_days where selected_count>0),0)
     +sc.missing_member_unknown_count,
   'orderSequenceUncertainCount',coalesce((select sum(selected_count)::bigint from member_days where not sequence_known),0),
   'sourceCompletenessVerified',false) from selected_coverage sc),
  'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$maan_query$;
   end if;
  end if;
 end if;
 -- ar_native_compact_summary_v1: reuse the existing exact compact summary
 -- algorithm for these two native scopes, without facts, proof or new objects.
 -- Native full5PK proves order_id uniqueness; integer bounds preserve old text
 -- parsing. Keep blank-ID/ALL-history NULL exclusions and independent paid day.
 if v_platform.source='ar' and v_platform.scope_group='IN'
  and v_platform.source_name in('JAICLUB','JALWA')
  and v_operation='summary' and not v_charts then
  perform 1 from public.ar_collected_orders limit 0;
  if(select count(*)=2 from pg_attribute a where a.attrelid='public.ar_collected_orders'::regclass
    and a.attname in('member_level','recharge_count')and a.attnum>0 and not a.attisdropped
    and a.atttypid='integer'::regtype and a.atttypmod=-1 and not a.atthasdef
    and a.attgenerated=''and a.attidentity='')
  and not exists(select 1 from pg_inherits where inhparent='public.ar_collected_orders'::regclass or inhrelid='public.ar_collected_orders'::regclass)
  and exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
    where c.conrelid='public.ar_collected_orders'::regclass and c.contype='p'
    and c.convalidated and not c.condeferrable and not c.condeferred
    and i.indisprimary and i.indisunique and i.indimmediate and i.indisvalid and i.indisready and i.indislive
    and i.indpred is null and i.indexprs is null
    and pg_get_constraintdef(c.oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
  and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
    and md5(p.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'and p.proowner='postgres'::regrole
    and p.prolang=(select oid from pg_language where lanname='sql')and p.provolatile='i'and p.proparallel='s'
    and not p.prosecdef and not p.proisstrict and not p.proleakproof and not p.proretset
    and p.prorettype='numeric'::regtype and p.pronargs=8 and p.pronargdefaults=0 and p.provariadic=0
    and p.proconfig=array['search_path=""']::text[]and p.proacl::text='{postgres=X/postgres}'
    and pg_get_function_arguments(p.oid)='p_country text, p_kind text, p_channel_type text, p_version smallint, p_local numeric, p_local_currency text, p_issue text, p_legacy_display numeric') then
  v_sql:=$ar_native_compact$with source_rows as not materialized (select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
 a.applied_at at time zone $4 created_at,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
 a.status='已支付' paid,coalesce(a.status in('已支付','待支付','支付失败','已取消'),false)status_known,
 a.member_level native_member_level,a.recharge_count native_recharge_count
 from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')
 and a.applied_at>=($5 at time zone $4)and a.applied_at<($6 at time zone $4)),successes as materialized(select nullif(btrim(a.member_id),'')member_id,a.completed_at::date as day from public.ar_collected_orders a
 where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')and a.status='已支付'
 and a.completed_at>=($5 at time zone $4)and a.completed_at<($6 at time zone $4)), typed_orders as materialized (
 select s.order_id,s.member_id,(s.created_at at time zone $4)::date as day,
  (s.created_at>=$15 and s.created_at<$16) selected_clock,
  s.raw_provider,s.paid,s.status_known,
  case when s.native_member_level between 0 and 9999 then s.native_member_level end member_level,
  case when s.native_recharge_count between 0 and 999999999 then s.native_recharge_count end recharge_count
 from source_rows s where s.created_at is not null
), native_provider_summary as materialized (
 -- One native-provider pass supplies both canonical names and selected coverage.
 -- Preserve every whole-day provider here; filtering happens after canonicalization.
 select o.raw_provider,
  count(*) filter(where o.selected_clock and $17::text is not null) selected_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null) missing_member_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_level is null) missing_level_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o group by o.raw_provider
), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from native_provider_summary
), unplaced_members as materialized (
 select distinct nullif(btrim(a.member_id),'') member_id
 from public.ar_collected_orders a
 where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')
  and a.applied_at is null
  and nullif(btrim(a.member_id),'') is not null
), member_days as materialized (
 select o.day,o.member_id,count(*) submitted_count,count(*) filter(where o.paid) cohort_success_count,
  bool_and(o.status_known) statuses_known,
  count(*) filter(where nullif(btrim(o.order_id),'') is null)=0
   and bool_and(u.member_id is null) sequence_known,
  count(*) filter(where not o.status_known) unknown_status_count,
  count(*) filter(where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null) selected_count,
  case when max(o.recharge_count)>0 then 'funded'
   when count(o.recharge_count)=count(*) and max(o.recharge_count)=0 and count(o.member_level)=count(*) and max(o.member_level)=0 then 'new' else 'unknown' end member_class,
  bool_or(o.member_level=0) has_l0
 from typed_orders o left join unplaced_members u using(member_id) join canonical c using(raw_provider)
 where o.member_id is not null group by o.day,o.member_id
), eligible as materialized (
 select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
  and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
  and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
), selected_provider_summary as materialized (
 -- Merge native aliases only after the existing canonical helper. Count sums
 -- retain bigint types and exclude zero selected rows exactly as the old WHERE.
 select c.provider,sum(n.selected_count)::bigint selected_count,
  sum(n.missing_member_count)::bigint missing_member_count,
  sum(n.missing_level_count)::bigint missing_level_count,
  sum(n.missing_recharge_count)::bigint missing_recharge_count,
  sum(n.missing_member_unknown_count)::bigint missing_member_unknown_count
 from native_provider_summary n join canonical c using(raw_provider)
 where n.selected_count>0 and ($8::text[] is null or c.provider=any($8))
 group by c.provider
), qualified_orders as materialized (
 -- This materialization contains only eligible, selected rows. It prevents the
 -- scalar money helper from moving back into the full-day source scan.
 select o.day,o.member_id,c.provider,m.submitted_count,m.member_class,m.has_l0,
  o.order_id
 from typed_orders o join eligible m using(day,member_id) join canonical c using(raw_provider)
 where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null
), qualified_amounts as materialized (
 select q.day,q.member_id,q.provider,q.submitted_count,q.member_class,q.has_l0,
  (select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)
   from public.ar_collected_orders a
   where a.source_system='AR' and a.country_code=$2 and a.platform=$3
    and a.order_kind='recharge' and a.order_no=q.order_id) amount
 from qualified_orders q
), qualified_members as (
 select q.day,q.member_id,q.provider,max(q.submitted_count) submitted_count,max(q.member_class) member_class,bool_or(q.has_l0) has_l0,
  count(*) invalid_count,count(*) filter(where q.amount is null) missing_amount,coalesce(sum(q.amount),0) invalid_amount
 from qualified_amounts q group by q.day,q.member_id,q.provider
), metric_values as (
 select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,
  count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
  count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
  sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
 from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
 group by grouping sets ((q.provider,t.threshold),(t.threshold))
), dimensions as (select null::text provider union all select provider from selected_provider_summary), metrics as (
 select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
  coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
  coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
  coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,
  coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
 from dimensions d cross join unnest($22::integer[]) t(threshold)
 left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
), selected_coverage as (
 select coalesce(sum(selected_count),0)::bigint order_count,
  coalesce(sum(missing_member_count),0)::bigint missing_member_count,
  coalesce(sum(missing_level_count),0)::bigint missing_level_count,
  coalesce(sum(missing_recharge_count),0)::bigint missing_recharge_count,
  coalesce(sum(missing_member_unknown_count),0)::bigint missing_member_unknown_count
 from selected_provider_summary
)
/* submission_cohort_final */select jsonb_build_object('dashboard',null,
 'metrics',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m),
 'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
  'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
  'unknownStatusCount',coalesce((select sum(m.unknown_status_count)::bigint from member_days m where m.selected_count>0),0)+sc.missing_member_unknown_count,
  'orderSequenceUncertainCount',coalesce((select sum(m.selected_count)::bigint from member_days m where not m.sequence_known),0),
  'sourceCompletenessVerified',false) from selected_coverage sc),
 'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$ar_native_compact$;
  end if;
 end if;

 if v_start<>v_from or v_end<>v_to or v_to-v_from>interval'27hours'
  or v_to>statement_timestamp()then raise exception using errcode='22023',message='submission_cohort_closed_day_required';end if;
 if position('/* submission_cohort_final */'in v_sql)=0 then raise exception'submission_cohort_template_drift';end if;
 v_sql:=split_part(v_sql,'/* submission_cohort_final */',1);
 if position('selected_orders as'in v_sql)>0 then
  v_sql:=v_sql||$cohort$,
 submission_selected as materialized(select day,member_id,provider,status_known,member_level,recharge_count from selected_orders),
 submission_unknown as materialized(select day,member_id,count(*)filter(where not status_known)::bigint unknown_status_count from orders where member_id is not null group by day,member_id having count(*)filter(where not status_known)>0)
 $cohort$;
 else
  v_sql:=v_sql||$cohort$,
 submission_selected as materialized(select o.day,o.member_id,c.provider,o.status_known,o.member_level,o.recharge_count
  from typed_orders o join canonical c using(raw_provider)where o.selected_clock and $17::text is not null),
 submission_unknown as materialized(select day,member_id,unknown_status_count from member_days where unknown_status_count>0)
 $cohort$;
 end if;
 v_sql:=v_sql||$cohort$,
 submission_provider_stats as(
  select o.provider,count(*)::bigint order_count,count(*)filter(where o.member_id is null)::bigint missing_member_count,
   count(*)filter(where o.member_level is null)::bigint missing_level_count,count(*)filter(where o.recharge_count is null)::bigint missing_recharge_count,
   count(*)filter(where o.member_id is null and not o.status_known)::bigint missing_member_unknown_count,
   count(*)filter(where o.member_id is not null and not m.sequence_known)::bigint sequence_uncertain_count
  from submission_selected o left join member_days m using(day,member_id)group by o.provider
 ),submission_unknown_members as(
  select u.day,u.member_id,u.unknown_status_count,jsonb_agg(distinct o.provider order by o.provider)providers
  from submission_unknown u join submission_selected o using(day,member_id)group by u.day,u.member_id,u.unknown_status_count
 )
 select jsonb_build_object(
  'qualified',(select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object('invalid_amount',q.invalid_amount::text)order by q.day,q.member_id,q.provider),'[]'::jsonb)from qualified_members q),
  'providers',(select coalesce(jsonb_agg(to_jsonb(p)order by p.provider),'[]'::jsonb)from submission_provider_stats p),
  'unknownMembers',(select coalesce(jsonb_agg(to_jsonb(u)order by u.day,u.member_id),'[]'::jsonb)from submission_unknown_members u))
 $cohort$;
 execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,
  v_providers,v_threshold,v_level,v_offset,v_limit,v_member,v_operation,v_start,v_end,coalesce(v_currency,v_platform.currency),v_confirmations,v_edges,v_bands,v_charts,v_thresholds,v_day,v_yash_coverage;
 return v_result||jsonb_build_object('contract','submission-local-day-cohort-v1','startAt',v_start,'endAt',v_end,'target',p_catalog->0,'qualityEvidence',v_yash_coverage);
end;
$function$;
