-- One latest collected ticket per native identity. Existing workorder RPC callers
-- keep their original views. Submit dates use each native platform's local clock.
set local search_path='';
-- Honor the established AR current-row merge, including source-only tickets.
-- Seed its two branches from indexed local dates. If a detail and its newer
-- observation disagree on submit day, either side can put the ticket in range.
-- The final predicate still uses the canonical merged day.
do $slice$
declare
  canonical text := pg_get_viewdef('private.ar_current_workorder_rows_v1'::regclass,false);
  query text;
begin
  if md5(canonical)<>'5e4373251c167ba0a245f62c842be948' then
    raise exception 'AR workorder current projection changed; verify the bounded selection';
  end if;
  query:=replace(canonical,'FROM public.ar_workorder_issue_details d'||chr(10)||'  WHERE',
    $legacy$FROM public.ar_workorder_issue_details d
    WHERE d.system_name='AR' and d.country_code=$1 and d.platform=$2 and d.issue_kind='deposit'
      and d.submitted_date between $3 and $4 and (($5 is null and d.submitted_at is null) or (d.submitted_at>=$5 and d.submitted_at<$6))
      and ($7='{}'::jsonb or exists(select 1 from matching_detail k where k.tenant_id=d.tenant_id and k.work_order_id=d.work_order_id))
      and $legacy$);
  query:=replace(query,'FROM ((((private.ar_workorder_latest_v1 l','FROM ((((selected_latest l');
  query:=$seed$
    with matching_detail as materialized (
      select d.tenant_id,d.work_order_id,d.source_record_id,d.work_order_no
      from public.ar_workorder_issue_details d
      where $7<>'{}'::jsonb and d.system_name='AR' and d.country_code=$1 and d.platform=$2 and (
        d.work_order_id=$7->>'workorderId' or lower(d.work_order_no)=lower($7->>'workorderNo')
        or lower(d.payment_order_no)=lower($7->>'orderNo') or lower(d.utr)=lower($7->>'utr'))
    ), detail_candidates as materialized (
      select d.tenant_id,d.work_order_id,d.source_record_id,d.work_order_no
      from public.ar_workorder_issue_details d
      where d.system_name='AR' and d.country_code=$1 and d.platform=$2 and d.issue_kind='deposit'
        and d.submitted_date between $3 and $4
        and $7='{}'::jsonb and (($5 is null and d.submitted_at is null) or (d.submitted_at>=$5 and d.submitted_at<$6))
      union all select * from matching_detail
    ), selected_latest as (
      select l.* from private.ar_workorder_latest_v1 l
      where l.system_name='AR' and l.country_code=$1 and l.platform=$2 and
        ( ($7='{}'::jsonb and l.submitted_date between $3 and $4 and (($5 is null and l.submitted_at is null) or (l.submitted_at>=$5 and l.submitted_at<$6)))
          or (l.source_record_id=$7->>'workorderId' or l.work_order_no=$7->>'workorderId' or l.work_order_no=$7->>'workorderNo'
              or l.payment_order_no=$7->>'orderNo') )
      union
      select match.* from detail_candidates d join private.ar_workorder_latest_v1 match
        on match.system_name='AR' and match.country_code=$1 and match.platform=$2 and match.tenant_id=d.tenant_id
         and match.source_record_id=d.source_record_id and match.source_record_id=d.work_order_id
      union
      select match.* from detail_candidates d join private.ar_workorder_latest_v1 match
        on match.system_name='AR' and match.country_code=$1 and match.platform=$2 and match.tenant_id=d.tenant_id
         and match.work_order_no=d.work_order_no and match.work_order_no=d.work_order_id
         and (match.source_record_id is null or d.source_record_id is null or match.source_record_id=d.source_record_id)
    )
    select q.* from (
  $seed$ || rtrim(query,';'||chr(10)) ||
      ') q where q.issue_kind=''deposit'' and q.submitted_date between $3 and $4 and (($5 is null and q.submitted_at is null) or (q.submitted_at>=$5 and q.submitted_at<$6))';
  execute 'create function private.dashboard_deposit_ticket_ar_slice(text,text,date,date,timestamptz,timestamptz,jsonb)
    returns setof private.ar_current_workorder_rows_v1 language sql stable
    as '||quote_literal(query);
end;
$slice$;
revoke all on function private.dashboard_deposit_ticket_ar_slice(text,text,date,date,timestamptz,timestamptz,jsonb) from public,anon,authenticated,service_role;

create function private.dashboard_admin_deposit_ticket_list(p_request jsonb)
returns jsonb language plpgsql stable security definer
set search_path = '' set jit = off set plan_cache_mode = force_custom_plan
as $tickets$
declare
  account_scope jsonb := private.dashboard_admin_live_scope();
  role_access jsonb := private.dashboard_role_access();
  continuation jsonb:=p_request->'cursor'; context_hash text; next_position jsonb; batch_position jsonb;
  after_time timestamptz; after_platform uuid; after_tenant text; after_key text;
  filters jsonb := p_request->'filters';
  first_day date; last_day date; row_offset integer; page_size integer;
  country_code text; country_label text; country_zone text;
  catalog jsonb; result jsonb; batch jsonb; output_rows jsonb:='[]'; remaining_offset integer;
  exact_fields jsonb; wanted integer; seen integer; more boolean:=false; lo timestamptz; hi timestamptz; first_instant timestamptz; end_instant timestamptz;
  step interval:=interval '1 hour';  names jsonb; systems jsonb;
begin
  if role_access->'canView' is distinct from 'true'::jsonb
     or not (role_access->'permissions' ?& array['workorders.view','workorders.query']) then
    raise exception using errcode='42501',message='role_permission_denied';
  end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>8192
     or p_request-array['view','operation','country','filters','offset','limit','cursor']<>'{}'::jsonb
     or p_request->>'view' is distinct from 'depositTickets'
     or coalesce(p_request->>'operation','list')<>'list'
     or jsonb_typeof(filters) is distinct from 'object'
     or filters-array['team','platform','from','to','statusCode','workorderId','workorderNo','orderNo','utr','issueKind','dateBasis']<>'{}'::jsonb then
    raise exception using errcode='22023',message='invalid_query';
  end if;
  if exists(select 1 from jsonb_each(filters) f where jsonb_typeof(f.value)<>'string'
      or length(f.value#>>'{}')>200 or (f.value#>>'{}')<>btrim(f.value#>>'{}') or (f.value#>>'{}')~'[[:cntrl:]]')
     or coalesce(filters->>'issueKind','') not in ('','deposit')
     or coalesce(filters->>'dateBasis','') not in ('','submission')
     or coalesce(filters->>'statusCode','') not in ('','1','2','3','4','5')
     or (p_request?'limit' and (jsonb_typeof(p_request->'limit')<>'number' or p_request->>'limit' !~ '^(20|50|100)$'))
     or (p_request?'offset' and (jsonb_typeof(p_request->'offset')<>'number' or p_request->>'offset' !~ '^[0-9]{1,7}$')) then
    raise exception using errcode='22023',message='invalid_filter';
  end if;
  page_size:=coalesce((p_request->>'limit')::integer,20);
  row_offset:=coalesce((p_request->>'offset')::integer,0);
  if row_offset>1000000 or coalesce(filters->>'from','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or coalesce(filters->>'to','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode='22023',message='invalid_dates';
  end if;
  first_day:=(filters->>'from')::date;last_day:=(filters->>'to')::date;
  if last_day-first_day not between 0 and 92 then raise exception using errcode='22023',message='invalid_dates';end if;
  select c.code,c.label,c.tz into country_code,country_label,country_zone from (values
    ('IN','印度','Asia/Kolkata'),('BR','巴西','America/Sao_Paulo'),('PK','巴基斯坦','Asia/Karachi'),
    ('ID','印尼','Asia/Jakarta'),('VN','越南','Asia/Ho_Chi_Minh'),('PH','菲律宾','Asia/Manila'),
    ('MY','马来','Asia/Kuala_Lumpur'),('MM','缅甸','Asia/Yangon'),('NG','尼日利亚','Africa/Lagos'),
    ('CO','哥伦比亚','America/Bogota'),('MX','墨西哥','America/Mexico_City'),('CL','智利','America/Santiago')
  ) c(code,label,tz) where p_request->>'country' in (c.code,c.label);
  if country_code is null or (country_code<>'IN' and coalesce(filters->>'utr','')<>'') then
    raise exception using errcode='22023',message='invalid_country';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into catalog from private.dashboard_admin_live_platforms() p
    where p.scope_group=country_code and p.source in ('ar','newar')
      and private.dashboard_scope_allows(account_scope,p.scope_group,p.source_name)
      and (nullif(filters->>'team','') is null or p.team=filters->>'team');
  select coalesce(jsonb_agg(distinct x->>'name' order by x->>'name'),'[]') into names from jsonb_array_elements(catalog) x;
  select coalesce(jsonb_agg(distinct case x->>'source' when 'newar' then 'NEW_AR' else 'AR' end),'[]') into systems
    from jsonb_array_elements(catalog)x where nullif(filters->>'platform','') is null or filters->>'platform' in (x->>'name',x->>'source_name');
  context_hash:=md5(jsonb_build_array(auth.uid(),role_access,account_scope,catalog,country_code,filters,page_size)::text);
  if continuation is not null then
    if jsonb_typeof(continuation)<>'object' or not (continuation ?& array['at','p','t','k','h'])
       or continuation-array['at','p','t','k','h']<>'{}'::jsonb or continuation->>'h' is distinct from context_hash
       or jsonb_typeof(continuation->'p')<>'string' or continuation->>'p' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(continuation->'k')<>'string' or length(continuation->>'k') not between 1 and 200 or continuation->>'k'~'[[:cntrl:]]'
       or jsonb_typeof(continuation->'t') not in('string','null') or coalesce(continuation->>'t','0')!~'^[0-9]{1,20}$'
       or jsonb_typeof(continuation->'at') not in('string','null') or (continuation->>'at' is not null and
          continuation->>'at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$') then
      raise exception using errcode='22023',message='invalid_ticket_cursor';
    end if;
    after_time:=(continuation->>'at')::timestamptz; after_platform:=(continuation->>'p')::uuid;
    after_tenant:=coalesce(continuation->>'t','');after_key:=continuation->>'k';
  end if;
  first_instant:=first_day::timestamp at time zone country_zone; end_instant:=(last_day+1)::timestamp at time zone country_zone;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into exact_fields from jsonb_each_text(filters)
    where key in ('workorderId','workorderNo','orderNo','utr') and value<>'';
  hi:=end_instant;lo:=case when exact_fields<>'{}'::jsonb then first_instant else greatest(first_instant,least(hi,statement_timestamp())-step) end;
  if continuation is not null then
    if after_time is null then lo:=null;hi:=null;
    else hi:=least(hi,after_time+interval '1 microsecond');
      if hi<=first_instant then lo:=null;hi:=null;else lo:=case when exact_fields<>'{}'::jsonb then first_instant else greatest(first_instant,hi-step) end;end if;
    end if;
  end if;
  remaining_offset:=case when continuation is null then row_offset else 0 end;
  loop
  wanted:=page_size-jsonb_array_length(output_rows);
  with targets as materialized (
    select x.* from jsonb_to_recordset(catalog) as x(id uuid,source text,name text,source_name text,team text,country text,scope_group text,timezone text)
    where nullif(filters->>'platform','') is null or filters->>'platform' in(x.name,x.source_name)
  ), ar_targets as materialized (
    select t.* from targets t where t.source='ar' and (
      exact_fields='{}'::jsonb or exists (
        select from public.ar_workorder_issue_details d where d.system_name='AR'
          and d.country_code=t.scope_group and d.platform=t.source_name and (
            d.work_order_id=exact_fields->>'workorderId' or lower(d.work_order_no)=lower(exact_fields->>'workorderNo')
            or lower(d.payment_order_no)=lower(exact_fields->>'orderNo') or lower(d.utr)=lower(exact_fields->>'utr'))
      ) or exists (
        select from private.ar_workorder_latest_v1 l where l.system_name='AR' and l.country_code=t.scope_group
          and l.platform=t.source_name and (l.source_record_id=exact_fields->>'workorderId'
            or l.work_order_no=exact_fields->>'workorderId' or l.work_order_no=exact_fields->>'workorderNo'
            or l.payment_order_no=exact_fields->>'orderNo')
      )
    )
  ), newar_order_matches as materialized (
    -- Use the existing typed, hashed reference indexes for the ordinary form
    -- types; USDT types are much smaller and bounded by their existing day index.
    select t.id as platform_id,m.id as record_id from targets t cross join lateral (
      select d.id from public.newar_detail_records d
        where d.platform=t.source_name and d.dataset='workorder' and d.workorder_type in ('存款未到账','存款未到账自动化')
          and jsonb_typeof(d.raw->'depositOrderNo')='string'
          and md5(upper(nullif(btrim(d.raw->>'depositOrderNo'),'')))=md5(upper(exact_fields->>'orderNo'))
      union
      select d.id from public.newar_detail_records d
        where d.platform=t.source_name and d.dataset='workorder' and d.workorder_type in ('存款未到账','存款未到账自动化')
          and jsonb_typeof(d.raw->'rechargeNumber')='string'
          and md5(upper(nullif(btrim(d.raw->>'rechargeNumber'),'')))=md5(upper(exact_fields->>'orderNo'))
      union
      select d.id from public.newar_detail_records d
        where d.platform=t.source_name and d.dataset='workorder' and d.workorder_type in ('USDT存款未到账','USDT存款未到账自动化')
          and d.created_at>=lo and d.created_at<hi
          and (d.raw->>'depositOrderNo'=exact_fields->>'orderNo' or d.raw->>'rechargeNumber'=exact_fields->>'orderNo')
    ) m where t.source='newar' and exact_fields?'orderNo'
  ), newar_targets as materialized (
    select t.* from targets t where t.source='newar' and
      (not exact_fields?'orderNo' or exists(select from newar_order_matches m where m.platform_id=t.id))
  ), candidates as materialized (
    select t.id as platform_id,t.source,t.name,t.source_name,t.team,t.country,t.timezone,
           a.submitted_at as sort_time,a.tenant_id::text as tenant,a.work_order_id as ticket_id,
           a::private.ar_current_workorder_rows_v1 as ar, null::public.newar_detail_records as newar
    from ar_targets t cross join lateral (
      select d.* from private.dashboard_deposit_ticket_ar_slice(t.scope_group,t.source_name,first_day,last_day,lo,hi,exact_fields) d
      where t.source='ar' and d.system_name='AR' and d.country_code=t.scope_group and d.platform=t.source_name
        and d.issue_kind='deposit' and d.submitted_date between first_day and last_day
        and (continuation is null or d.submitted_at<after_time or (d.submitted_at is null and after_time is not null)
          or (d.submitted_at is not distinct from after_time and (t.id,d.tenant_id::text,d.work_order_id)>(after_platform,after_tenant,after_key)))
        and (nullif(filters->>'statusCode','') is null or d.status_code=nullif(filters->>'statusCode','')::integer)
        and (nullif(filters->>'workorderId','') is null or d.work_order_id=filters->>'workorderId')
        and (nullif(filters->>'workorderNo','') is null or d.work_order_no=filters->>'workorderNo')
        and (nullif(filters->>'orderNo','') is null or d.payment_order_no=filters->>'orderNo')
        and (nullif(filters->>'utr','') is null or d.utr=filters->>'utr')
      order by d.submitted_at desc nulls last,d.tenant_id::text,d.work_order_id
      limit (remaining_offset+wanted+1)
    ) a
    union all
    select t.id,t.source,t.name,t.source_name,t.team,t.country,t.timezone,
           n.created_at,null::text,n.source_id,null::private.ar_current_workorder_rows_v1,n::public.newar_detail_records
    from newar_targets t join public.newar_detail_platforms cfg on cfg.enabled
       and cfg.platform=t.source_name and cfg.country_code=t.scope_group and cfg.timezone=t.timezone
       and (cfg.launch_at is null or cfg.launch_at<=statement_timestamp())
    cross join lateral (
      select d.* from public.newar_detail_records d
      where d.dataset='workorder' and d.platform=t.source_name
        and (continuation is null or d.created_at<after_time
          or (d.created_at=after_time and (t.id,''::text,d.source_id)>(after_platform,after_tenant,after_key)))
        and d.workorder_type in ('存款未到账','存款未到账自动化','USDT存款未到账','USDT存款未到账自动化')
        and lo is not null and d.created_at>=lo and d.created_at<hi
        and (cfg.launch_at is null or d.created_at>=cfg.launch_at)
        and (not exact_fields?'orderNo' or d.id in (select m.record_id from newar_order_matches m where m.platform_id=t.id))
        and (nullif(filters->>'statusCode','') is null or d.status_code=filters->>'statusCode')
        and (nullif(filters->>'workorderId','') is null or d.source_id=filters->>'workorderId')
        and (nullif(filters->>'workorderNo','') is null or d.raw->>'workOrderNo'=filters->>'workorderNo')
        and (nullif(filters->>'orderNo','') is null or coalesce(case when jsonb_typeof(d.raw->'depositOrderNo')='string' then nullif(btrim(d.raw->>'depositOrderNo'),'') end,
            case when jsonb_typeof(d.raw->'rechargeNumber')='string' then nullif(btrim(d.raw->>'rechargeNumber'),'') end)=filters->>'orderNo')
        and (nullif(filters->>'utr','') is null or d.raw->>'utr'=filters->>'utr')
      order by d.created_at desc nulls last,d.source_id
      limit (remaining_offset+wanted+1)
    ) n
  ), window_rows as materialized (
    select * from candidates order by sort_time desc nulls last, platform_id,tenant,ticket_id
    limit (remaining_offset+wanted+1)
  ), page_rows as (
    select * from window_rows order by sort_time desc nulls last,platform_id,tenant,ticket_id limit wanted offset remaining_offset
  ), display as (
    select w.*,
      jsonb_build_object(
        'id',jsonb_build_array(w.source,w.platform_id,w.tenant,w.ticket_id)::text,
        'source',case w.source when 'newar' then 'NEW_AR' else 'AR' end,
        'team',w.team,'platform',w.name,'sourcePlatform',w.source_name,'countryCode',country_code,
        'country',w.country,'timezone',w.timezone,'issueKind','deposit','workorderId',w.ticket_id,
        'submittedAt',w.sort_time
      ) || case when w.source='ar' then jsonb_build_object(
        'workorderNo',(w.ar).work_order_no,'orderNo',(w.ar).payment_order_no,'sourceOrderNo',(w.ar).source_order_no,
        'workorderType',(w.ar).work_order_type_name,'statusCode',(w.ar).status_code::text,
        'statusLabel',case (w.ar).status_code when 1 then '待处理' when 2 then '处理中' when 3 then '已驳回' when 4 then '已处理' when 5 then '系统处理中' end,
        'amount',(w.ar).amount::text,'currency',null,'requestedAmount',null,'requestedCurrency',null,
        'paidAmount',null,'paidCurrency',null,'paidAt',null,'receiptStatus',null,'collectedCurrency',null,'depositOrderNo',null,'rechargeNumber',null,
        'provider',(w.ar).third_party,'channelType',(w.ar).channel_type,'utr',case when country_code='IN' then (w.ar).utr end,
        'operatedAt',case when (w.ar).operation_time_source in ('operationTime','operateTime') then (w.ar).operated_at end,
        'operatorAccount',(w.ar).operator_account,'sourceUpdatedAt',(w.ar).source_updated_at,'collectedAt',(w.ar).observed_at,
        'kycConnected',(w.ar).kyc_connected,'utrMatched',(w.ar).utr_matched,'reminderCount',(w.ar).reminder_count
      ) else jsonb_build_object(
        'workorderNo',nullif((w.newar).raw->>'workOrderNo',''),
        'orderNo',coalesce(case when jsonb_typeof((w.newar).raw->'depositOrderNo')='string' then nullif(btrim((w.newar).raw->>'depositOrderNo'),'') end,
          case when jsonb_typeof((w.newar).raw->'rechargeNumber')='string' then nullif(btrim((w.newar).raw->>'rechargeNumber'),'') end),
        'sourceOrderNo',case when jsonb_typeof((w.newar).raw->'orderNo')='string' then nullif(btrim((w.newar).raw->>'orderNo'),'') end,'workorderType',(w.newar).workorder_type,
        'statusCode',(w.newar).status_code,'statusLabel',case (w.newar).status_code when '1' then '待处理' when '2' then '处理中' when '3' then '已驳回' when '4' then '已处理' when '5' then '系统处理中' end,
        'amount',(w.newar).amount::text,
        'currency',nullif((w.newar).raw->>'currency',''),'collectedCurrency',(w.newar).currency,
        'requestedAmount',nullif((w.newar).raw->>'requestedAmount',''),
        'requestedCurrency',nullif((w.newar).raw->>'currency',''),
        'depositOrderNo',case when (w.newar).raw?'sourceDepositOrderNo' then case when jsonb_typeof((w.newar).raw->'sourceDepositOrderNo')='string' then nullif(btrim((w.newar).raw->>'sourceDepositOrderNo'),'') end
          when jsonb_typeof((w.newar).raw->'depositOrderNo')='string' then nullif(btrim((w.newar).raw->>'depositOrderNo'),'') end,
        'rechargeNumber',case when (w.newar).raw?'sourceRechargeNumber' then case when jsonb_typeof((w.newar).raw->'sourceRechargeNumber')='string' then nullif(btrim((w.newar).raw->>'sourceRechargeNumber'),'') end
          when jsonb_typeof((w.newar).raw->'rechargeNumber')='string' then nullif(btrim((w.newar).raw->>'rechargeNumber'),'') end,
        'orderReferenceSource',(w.newar).raw->>'orderReferenceSource','formOrderReference',(w.newar).raw->>'sourceFormOrderReference',
        'paidAmount',(w.newar).raw->>'paidAmount','paidCurrency',case when (w.newar).raw->>'paidAmount' is not null then nullif((w.newar).raw->>'currency','') end,'paidAt',(w.newar).raw->>'sourcePaidAt',
        'receiptStatus',(w.newar).raw->>'rechargeState','provider',(w.newar).provider,'channelType',(w.newar).channel_type,
        'utr',case when country_code='IN' then (w.newar).raw->>'utr' end,
        'operatedAt',(w.newar).raw->>'sourceHandledAt','operatorAccount',(w.newar).operator,
        'sourceUpdatedAt',(w.newar).source_updated_at,'collectedAt',(w.newar).captured_at,
        'kycConnected',case lower((w.newar).raw->>'kycConnected') when 'true' then true when 'false' then false end,
        'utrMatched',case lower((w.newar).raw->>'utrMatched') when 'true' then true when 'false' then false end,
        'reminderCount',(w.newar).followup_count
      ) end row_data
    from page_rows w
  )
  select coalesce((select jsonb_agg(case when role_access->'permissions' ? 'workorders.detail' then row_data
    else row_data-array['sourceOrderNo','paidAmount','paidCurrency','paidAt','kycConnected','utrMatched','sourceUpdatedAt',
      'collectedAt','reminderCount','depositOrderNo','rechargeNumber','orderReferenceSource','formOrderReference','collectedCurrency'] end
    order by sort_time desc nulls last,platform_id,tenant,ticket_id) from display),'[]'),
         (select count(*)::integer from window_rows),
         (select jsonb_build_object('at',sort_time,'p',platform_id,'t',tenant,'k',ticket_id,'h',context_hash)
          from page_rows order by sort_time asc nulls first,platform_id desc,tenant desc,ticket_id desc limit 1)
         into batch,seen,batch_position;
  next_position:=coalesce(batch_position,next_position);
  output_rows:=output_rows||batch;
  if seen>remaining_offset+wanted then more:=true;exit;end if;
  remaining_offset:=greatest(0,remaining_offset-seen);
  if lo is null then exit; end if;
  if lo=first_instant then lo:=null; hi:=null; -- undated times, within native submitted_date
  else
    hi:=lo;
    step:=least(step*4,interval '8 days');
    lo:=greatest(first_instant,hi-step);
  end if;
  end loop;
  result:=jsonb_build_object('ok',true,'view','depositTickets','country',country_label,'countryCode',country_code,'timezone',country_zone,
    'sourceStatus',case when jsonb_array_length(systems)>0 then 'ready' else 'not_connected' end,
    'sourceComplete',false,'canDetail',role_access->'permissions' ? 'workorders.detail','platforms',names,'sources',systems,'offset',row_offset,'limit',page_size,'hasMore',more,'nextCursor',case when more then next_position end,'rows',output_rows);
  return result;
end
$tickets$;
revoke all on function private.dashboard_admin_deposit_ticket_list(jsonb) from public, anon, service_role;
grant execute on function private.dashboard_admin_deposit_ticket_list(jsonb) to authenticated;

-- Preserve the live branches of the shared wrapper and assigned-role gateway.
do $install$
declare definition text; patched text; old_clause text:='coalesce(v_view,''records'') in (''records'',''orders'')';
begin
  select pg_get_functiondef('public.dashboard_admin_live_workorder_records(jsonb)'::regprocedure) into definition;
  if strpos(definition,'select case when p_request->>''view''=''orders''')=0 then raise exception 'workorder wrapper changed';end if;
  patched:=replace(definition,'select case when p_request->>''view''=''orders''',
    'select case when p_request->>''view''=''depositTickets'' then private.dashboard_admin_deposit_ticket_list(p_request) when p_request->>''view''=''orders''');
  execute patched;
  select pg_get_functiondef('public.dashboard_admin_execute(text,jsonb)'::regprocedure) into definition;
  if strpos(definition,old_clause)=0 or strpos(definition,'p_page=''workorders'' and '||old_clause)=0 then raise exception 'workorder gateway changed';end if;
  patched:=replace(definition,'p_page=''workorders'' and '||old_clause,'p_page=''workorders'' and coalesce(v_view,''records'') in (''records'',''orders'',''depositTickets'')');
  execute patched;
end;
$install$;
