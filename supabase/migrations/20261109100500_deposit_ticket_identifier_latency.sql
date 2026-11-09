-- The NewAR collector's explicit deposit form types are the two ordinary forms
-- and USDT存款未到账自动化. The latter has its own online partial (platform,date)
-- index. Match its predicate exactly; a speculative second USDT name makes
-- an empty identifier lookup scan every workorder in the reporting period.
do $upgrade$
declare
  definition text;
begin
  if md5((select prosrc from pg_proc where oid='private.dashboard_admin_deposit_ticket_list(jsonb)'::regprocedure))<>'38329d22026aa1e991a838c1557b36b8' then
    raise exception 'deposit ticket reader changed before identifier patch';
  end if;
  select pg_get_functiondef('private.dashboard_admin_deposit_ticket_list(jsonb)'::regprocedure) into definition;
  definition:=replace(definition,'d.workorder_type in (''USDT存款未到账'',''USDT存款未到账自动化'')',
    'd.workorder_type=''USDT存款未到账自动化''');
  definition:=replace(definition,'''存款未到账自动化'',''USDT存款未到账'',''USDT存款未到账自动化''',
    '''存款未到账自动化'',''USDT存款未到账自动化''');
  definition:=replace(definition,$old$and (d.raw->>'depositOrderNo'=exact_fields->>'orderNo' or d.raw->>'rechargeNumber'=exact_fields->>'orderNo')$old$,
    $new$and ((jsonb_typeof(d.raw->'depositOrderNo')='string' and btrim(d.raw->>'depositOrderNo')=exact_fields->>'orderNo')
            or (jsonb_typeof(d.raw->'rechargeNumber')='string' and btrim(d.raw->>'rechargeNumber')=exact_fields->>'orderNo'))$new$);

  -- The NewAR collector retains source_id/workOrderId, not a native
  -- workOrderNo column. Its separate source-order reference cannot substitute.
  definition:=replace(definition,$old$and (nullif(filters->>'workorderNo','') is null or d.raw->>'workOrderNo'=filters->>'workorderNo')$old$,
    $new$and nullif(filters->>'workorderNo','') is null$new$);
  definition:=replace(definition,$old$'workorderNo',nullif((w.newar).raw->>'workOrderNo',''),$old$,$new$'workorderNo',null,$new$);

  definition:=replace(definition,$old$'reminderCount',(w.ar).reminder_count$old$, $new$'reminderCount',(w.ar).reminder_count,
        'workorderName',(w.ar).work_order_name,'workorderTypeId',(w.ar).work_order_type_id::text,
        'sourcePayTypeId',(w.ar).source_pay_type_id,
        'attachmentTypes',case when (w.ar).attachment_types is not null then
           to_jsonb(array(select distinct kind from unnest((w.ar).attachment_types) kind where kind in ('image','video','pdf') order by kind)) end$new$);
  definition:=replace(definition,$old$'reminderCount',(w.newar).followup_count$old$, $new$'reminderCount',(w.newar).followup_count,
        'workorderName',null,'workorderTypeId',case when ((w.newar).raw->>'workorderTypeId') ~ '^[0-9]{1,20}$' then (w.newar).raw->>'workorderTypeId' end,
        'sourcePayTypeId',case when ((w.newar).raw->>'payTypeId') ~ '^[0-9]{1,20}$' then (w.newar).raw->>'payTypeId' end,
        'attachmentTypes',null$new$);
  definition:=replace(definition,$old$'formOrderReference','collectedCurrency'] end$old$,
    $new$'formOrderReference','collectedCurrency','workorderName','workorderTypeId','sourcePayTypeId','attachmentTypes'] end$new$);
  if strpos(definition,'''USDT存款未到账''')<>0 or strpos(definition,'''attachmentTypes'',case')=0 then
    raise exception 'unexpected deposit ticket patch result';
  end if;
  execute definition;
end;
$upgrade$;
