-- Only call this from an already authorized ticket page, after keyset pagination.
-- AR enforces one row per native compound key. NEW_AR allows repeated payment
-- references under different native source IDs: two matches are enough to withhold it.
create function private.dashboard_ticket_recharge_order(
  p_source text,p_country text,p_platform text,p_timezone text,p_order_no text)
returns jsonb language plpgsql stable security invoker set search_path='' as $charge$
declare
  result jsonb; matches jsonb;
begin
  if nullif(btrim(p_order_no),'') is null then return jsonb_build_object('match','no_reference');end if;
  if p_source='ar' then
    select jsonb_build_object(
      'match','matched','status',a.status,'amount',m.amount::text,
      'currency',case when p_country='IN' and a.money_format_version=1 and a.currency_local='INR'
                            and m.amount is not null then a.currency_local end,
      'provider',nullif(btrim(a.raw_channel),''),'channelType',nullif(btrim(a.channel_type),''),
      'utr',null,'completedAt',case when a.status='已支付' then a.completed_at at time zone p_timezone end)
    into result from public.ar_collected_orders a
    cross join lateral(select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,
       a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) as amount) m
    where a.source_system='AR' and a.country_code=p_country and a.platform=p_platform
      and a.order_kind='recharge' and a.order_no=p_order_no;
  elsif p_source='newar' then
    select jsonb_agg(jsonb_build_object(
      'match','matched','status',coalesce(nullif(c.raw->>'rechargeState',''),c.status_code),
      'amount',c.amount::text,'currency',case when jsonb_typeof(c.raw->'currency')='string'
                  then nullif(btrim(c.raw->>'currency'),'') end,
      'provider',nullif(btrim(c.provider),''),'channelType',nullif(btrim(c.channel_type),''),
      'utr',case when p_country='IN' and jsonb_typeof(c.raw->'utr')='string' then nullif(btrim(c.raw->>'utr'),'') end,
      'completedAt',case when c.raw->>'rechargeState'='Payed' then c.raw->>'sourcePaidAt' end))
    into matches from (
      select d.amount,d.raw,d.status_code,d.provider,d.channel_type
      from public.newar_detail_platforms cfg join public.newar_detail_records d on d.platform=cfg.platform
      where cfg.platform=p_platform and cfg.country_code=p_country and cfg.enabled and cfg.timezone=p_timezone
        and (cfg.launch_at is null or (cfg.launch_at<=statement_timestamp() and d.created_at>=cfg.launch_at))
        and d.dataset='charge' and d.order_number=p_order_no limit 2
    ) c;
    if jsonb_array_length(matches)>1 then return jsonb_build_object('match','ambiguous');end if;
    result:=matches->0;
  end if;
  return coalesce(result,jsonb_build_object('match','not_found'));
end;
$charge$;
revoke all on function private.dashboard_ticket_recharge_order(text,text,text,text,text) from public,anon,authenticated,service_role;

-- Extend the installed reader, without replacing other workorder views or the
-- canonical AR detail/snapshot merge. Native ticket fields keep their provenance.
do $upgrade$
declare
  reader text;
begin
  if (select md5(prosrc) from pg_proc where oid='private.dashboard_admin_deposit_ticket_list(jsonb)'::regprocedure)
     is distinct from 'aadd478d45f66967827a4c6282b2b9e2' then raise exception 'deposit ticket reader changed';end if;
  select pg_get_functiondef('private.dashboard_admin_deposit_ticket_list(jsonb)'::regprocedure) into reader;
  reader:=replace(reader,$old$and value<>'';
  hi:=$old$,$new$and value<>'';
  -- Candidate seeds are ORed; final filters still check each requested value.
  -- The displayed ticket number falls back to the ID only if no native number exists.
  if exact_fields?'workorderNo' and not exact_fields?'workorderId' then
    exact_fields:=exact_fields||jsonb_build_object('workorderId',exact_fields->>'workorderNo');
  end if;
  hi:=$new$);
  reader:=replace(reader,$old$or d.work_order_no=filters->>'workorderNo')$old$,
                          $new$or coalesce(nullif(d.work_order_no,''),d.work_order_id)=filters->>'workorderNo')$new$);
  reader:=replace(reader,$old$and nullif(filters->>'workorderNo','') is null
        and$old$,$new$and (nullif(filters->>'workorderNo','') is null or d.source_id=filters->>'workorderNo')
        and$new$);

  reader:=replace(reader,$old$'operatorAccount',(w.ar).operator_account$old$,$new$'sourceOperatedAt',case when (w.ar).operation_time_source in ('lastUpdateTime','operationTime','operateTime') then (w.ar).operated_at end,
        'operationTimeSource',(w.ar).operation_time_source,'lastUpdatedBy',(w.ar).last_updated_by,
        'ticketEvidence',case when (w.ar).query_date is not null or (w.ar).schema_version is not null then 'detail' else 'snapshot_only' end,
        'operatorAccount',(w.ar).operator_account$new$);
  reader:=replace(reader,$old$'operatorAccount',(w.newar).operator$old$,$new$'sourceOperatedAt',(w.newar).raw->>'sourceOperatedAt',
        'operationTimeSource',(w.newar).raw->>'sourceOperatedSourceField',
        'lastUpdatedBy',case when (w.newar).raw->>'operatorSourceField'='lastUpdateMan'
          then nullif(btrim((w.newar).raw->>'operatorName'),'') end,
        'operatorSourceField',case when (w.newar).raw->>'operatorSourceField' in ('lastUpdateMan','operator','operatorName','operatorUserName',
          'operatorAccount','opUserName','opName','operateName','operateUserName','dealUserName','processorName','handlerName',
          'currentOperatorName','lastOperatorName','lastUpdateName') then (w.newar).raw->>'operatorSourceField' end,
        'ticketEvidence','detail','operatorAccount',(w.newar).operator$new$);
  reader:=replace(reader,$old$'attachmentTypes'] end$old$,$new$'attachmentTypes','sourceOperatedAt','operationTimeSource','lastUpdatedBy','operatorSourceField'] end$new$);
  reader:=replace(reader,$old$select jsonb_agg(case when role_access->'permissions' ? 'workorders.detail' then row_data
    else row_data-array[$old$,$new$select jsonb_agg(case when role_access->'permissions' ? 'workorders.detail' then
    case when (role_access->'permissions' ?& array['orders.view','orders.query','orders.detail']
               or role_access->'permissions' ?& array['collection.view','collection.query','collection.detail'])
         then row_data||jsonb_build_object('rechargeOrder',private.dashboard_ticket_recharge_order(
            source,country_code,source_name,timezone,row_data->>'orderNo'))
         else row_data end
    else row_data-array[$new$);
  if strpos(reader,'exact_fields:=exact_fields||')=0 or strpos(reader,'d.source_id=filters->>''workorderNo''')=0
     or strpos(reader,'private.dashboard_ticket_recharge_order(')=0 or strpos(reader,'''attachmentTypes'',''sourceOperatedAt'',''operationTimeSource'',''lastUpdatedBy'',''operatorSourceField'']')=0
     then raise exception 'deposit ticket source field patch incomplete';end if;
  execute reader;
end;
$upgrade$;
