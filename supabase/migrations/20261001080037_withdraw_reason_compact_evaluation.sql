-- Reuse the already decoded note in the parser and avoid copying unused order
-- fields through grouped views. Raw remarks, scope checks and grants stay intact.
begin;
do $guard$
declare item record; actual text;
begin
 for item in select * from (values
 ('private.dashboard_admin_live_withdraw_reasons(jsonb)','0ed5421ce0c4a9dfb143d804009fb434','7d47d0aff9c221d76775b4d0a84476f7'),
 ('private.dashboard_admin_live_blocking_details(text)','f2a2398f22116460677023dca82c8a83','ed48e04352f5230a39a99800b8977b76')
 ) expected(signature,before_hash,after_hash) loop
  select md5(prosrc) into actual from pg_proc where oid=to_regprocedure(item.signature);
  if actual is null or actual not in(item.before_hash,item.after_hash) then
   raise exception 'Withdrawal compact evaluation baseline changed: %; review before applying',item.signature;
  end if;
 end loop;
 select md5(prosrc) into actual from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_blocking_details_cleaned(text)');
 if actual is not null and actual <> 'dc7e5800d3afc9113d3b3664530a9013' then
  raise exception 'Withdrawal cleaned-note core already exists with another definition';
 end if;
end;
$guard$;
-- Only complete, observed diagnostic templates lose their actual values.
-- Configured thresholds, comparators, rule families and unknown/multiple rules survive.
create or replace function private.dashboard_admin_live_blocking_details_cleaned(p_note text)
returns jsonb language plpgsql immutable parallel safe set search_path='' as $fn$
declare
 note text:=p_note;
 compact text;parts text[];label text;actual text;field text;threshold text;numeric_part text;fields text[];head text[];suffix text;
 amount text:='([0-9]{1,18}(?:[.][0-9]{1,8})?)';
 diagnostic_amount text:='([+-]?[0-9]+(?:[.][0-9]+)?)';
 numeric_threshold text:='([0-9]{1,18}(?:[.][0-9]{1,8})?)';
 source_date text:='(?:[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}(?:[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:AM|PM)?)?|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T?[0-9]{2}:[0-9]{2}:[0-9]{2})?)';
begin
 -- Input has already had exactly one source-note decoding pass.
 note:=nullif(btrim(regexp_replace(coalesce(note,''),'[[:space:]]+',' ','g')),'');
 compact:=regexp_replace(translate(note,'：，',':,'),'[[:space:]]+','','g');

 -- These complete templates carry per-order measurements after a fixed rule.
 -- Keep configured thresholds and distinct outcomes; do not strip arbitrary
 -- numbers, user-written notes, extra conditions or unrecognized source text.
 if length(compact)>4096 then
  return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
 end if;
 if starts_with(compact,'充提差负盈利金额') then
  -- A fixed seven-field diagnostic is cheaper and clearer to validate by
  -- delimiters than one long Unicode regex with repeated decimal captures.
  fields:=string_to_array(compact,',');
  if cardinality(fields)=7 then
   head:=regexp_match(fields[1],'^充提差负盈利金额(小于|小于等于|大于|大于等于)([0-9]+(?:[.][0-9]+)?)$');
   suffix:=fields[7];
   if right(suffix,1)=any(array['。',';','；','!','！','?','？']) then suffix:=left(suffix,length(suffix)-1);end if;
   if head is not null and length(split_part(head[2],'.',1))<=18 and length(split_part(head[2],'.',2))<=8
    and starts_with(fields[2],'当前充提差负盈利金额:') and fields[3]='不能自动出款'
    and starts_with(fields[4],'(用户充值总额:') and starts_with(fields[5],'历史提现总额:')
    and starts_with(fields[6],'待处理金额:') and starts_with(suffix,'用户余额:') and right(suffix,1)=')' then
    parts:=array[substr(fields[2],length('当前充提差负盈利金额:')+1),substr(fields[4],length('(用户充值总额:')+1),substr(fields[5],length('历史提现总额:')+1),substr(fields[6],length('待处理金额:')+1),substr(suffix,length('用户余额:')+1,length(suffix)-length('用户余额:')-1)];
    if not exists (select 1 from unnest(parts) value where value !~ '^[+-]?[0-9]+(?:[.][0-9]+)?$'
      or length(split_part(ltrim(value,'+-'),'.',1))>24 or length(split_part(value,'.',2))>40) then
     threshold:=trim_scale(head[2]::numeric)::text;label:='充提差负盈利金额'||head[1]||threshold||'，不能自动出款';
     actual:=parts[1];field:='当前充提差负盈利金额';
    end if;
   end if;
  end if;
 elsif starts_with(compact,'打码倍数小于') then
  parts:=regexp_match(compact,'^打码倍数小于'||numeric_threshold||',不能自动出款,上次提现后的有效投注\(sumLotteryAmount\):'||diagnostic_amount||',上次提现后的成功充值总额:'||diagnostic_amount||',当前用户打码倍数\(userBetTurnoverMultiple\):'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null then
   threshold:=trim_scale(parts[1]::numeric)::text;label:='上次提现后打码倍数小于'||threshold||'，不能自动出款';
   actual:=parts[4];field:='当前用户打码倍数';
  else
   parts:=regexp_match(compact,'^打码倍数小于'||numeric_threshold||',不能自动出款,最后投注统计\(sumLotteryAmount\):'||diagnostic_amount||',最后一笔实际支付金额:('||substr(diagnostic_amount,2,length(diagnostic_amount)-2)||'|\{金额\}),当前用户打码倍数\(userBetTurnoverMultiple\):'||diagnostic_amount||',不能自动出款[。;；!！?？]?$');
   if parts is not null then
    threshold:=trim_scale(parts[1]::numeric)::text;label:='最后一笔充值打码倍数小于'||threshold||'，不能自动出款';
    actual:=parts[4];field:='当前用户打码倍数';
   end if;
  end if;
 elsif compact ~ '^[0-9]{1,3}日内人工充值' then
  parts:=regexp_match(compact,'^([0-9]{1,3})日内人工充值(彩金)?金额(大于|小于|大于等于|小于等于)'||numeric_threshold||',([0-9]{1,3})日内人工充值(彩金)?金额:'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null and parts[1]=parts[5] and coalesce(parts[2],'')=coalesce(parts[6],'') then
   threshold:=trim_scale(parts[4]::numeric)::text;label:=parts[1]||'日内人工充值'||coalesce(parts[2],'')||'金额'||parts[3]||threshold;
   actual:=parts[7];field:=parts[1]||'日内人工充值'||coalesce(parts[2],'')||'金额';
  end if;
 elsif starts_with(compact,'打码倍数校验通过@') then
  parts:=regexp_match(compact,'^打码倍数校验通过@[0-9]{4}-[0-9]{2}-[0-9]{2}[T]?[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?\(倍数'||diagnostic_amount||'(≥|>)'||numeric_threshold||',有效投注'||diagnostic_amount||',充值'||diagnostic_amount||'\)[。;；!！?？]?$');
  if parts is not null then
   threshold:=trim_scale(parts[3]::numeric)::text;label:='打码倍数校验通过（倍数'||parts[2]||threshold||'）';actual:=parts[1];field:='打码倍数';
  end if;
 elsif starts_with(compact,'打码倍数') then
  parts:=regexp_match(compact,'^打码倍数'||diagnostic_amount||'(小于|小于等于)'||numeric_threshold||',充提差负盈利金额'||diagnostic_amount||'(大于|大于等于)'||numeric_threshold||',按充提差负盈利放行[。;；!！?？]?$');
  if parts is not null then
   threshold:='打码'||parts[2]||trim_scale(parts[3]::numeric)::text||'；充提差'||parts[5]||trim_scale(parts[6]::numeric)::text;
   label:='打码倍数'||parts[2]||trim_scale(parts[3]::numeric)::text||'，充提差负盈利金额'||parts[5]||trim_scale(parts[6]::numeric)::text||'，按充提差负盈利放行';
   actual:=parts[1]||' / '||parts[4];field:='打码倍数 / 充提差负盈利金额';
  else
   parts:=regexp_match(compact,'^打码倍数'||diagnostic_amount||'(大于|大于等于)'||numeric_threshold||'\(累计打码量'||diagnostic_amount||'/需要打码量'||diagnostic_amount||'\)[。;；!！?？]?$');
   if parts is not null then
    threshold:=trim_scale(parts[3]::numeric)::text;label:='打码倍数'||parts[2]||threshold||'（累计打码量 / 需要打码量）';actual:=parts[1];field:='打码倍数';
   end if;
  end if;
 elsif starts_with(compact,'存在单号为空、缺少完成时间或实付金额、备份表重复或主备表不一致的成功充值单') then
  parts:=regexp_match(compact,'^(存在单号为空、缺少完成时间或实付金额、备份表重复或主备表不一致的成功充值单,无法核对打码倍数,不能自动出款),单号:([0-9]{1,30}(?:,[0-9]{1,30}){0,99})(?:等[0-9]{1,9}笔)?[。;；!！?？]?$');
  if parts is not null then label:=parts[1];actual:=parts[2];field:='相关充值单号';end if;
 elsif starts_with(compact,'打码统计源无法覆盖上次提现后的完整周期') then
  parts:=regexp_match(compact,'^(打码统计源无法覆盖上次提现后的完整周期,无法核对打码倍数,不能自动出款),上次提现后的成功充值总额:'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null then label:=parts[1];actual:=parts[2];field:='上次提现后的成功充值总额';end if;
 end if;
 if label is not null then
  -- Keep numeric bounds outside the matching expression: repeated bounded
  -- decimal ranges multiply the regex automaton for long source diagnostics.
  foreach numeric_part in array parts loop
   if field<>'相关充值单号' and numeric_part ~ '^[+-]?[0-9]+(?:[.][0-9]+)?$' and
    (length(split_part(ltrim(numeric_part,'+-'),'.',1))>24 or length(split_part(numeric_part,'.',2))>40) then
    return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
   end if;
  end loop;
  return jsonb_build_object('reason',label,'actualValue',actual,'actualField',field,'threshold',threshold);
 end if;
 -- A separator and matching actual-value field are mandatory; arbitrary numbers
 -- in bank errors, user IDs, balances or an additional condition are never stripped.
 parts:=regexp_match(compact,'^(首存金额|用户余额)(大于|小于|大于等于|小于等于|不大于|不小于)'||amount||',(首存金额|用户余额):'||amount||'[。;；!！?？]?$');
 if parts is not null and parts[1]=parts[4] then
  threshold:=trim_scale(parts[3]::numeric)::text;label:=parts[1]||parts[2]||threshold;actual:=parts[5];field:=parts[1];
 else
  parts:=regexp_match(compact,'^(用户历史总领取的红包大于或者等于配置值不能自动出款),用户历史红包领取总额\(userRedPacketTotalAmount\):'||amount||',当前配置的历史红包领取总额限制是\(ReceiveRedSumAmount\):'||amount||'[。;；!！?？]*$');
  if parts is not null then
   label:=parts[1];actual:=parts[2];field:='userRedPacketTotalAmount';threshold:=trim_scale(parts[3]::numeric)::text;
  else
   parts:=regexp_match(compact,'^(用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款),用户最后一次充值之后领取的红包总额\(userLastRechgRecvReadSumAmount\):'||amount||',当前配置的最后一次充值之后领取的红包总额限制是\(LastRechgRecvReadSumAmount\):'||amount||'[。;；!！?？]*$');
   if parts is not null then
    label:=parts[1];actual:=parts[2];field:='userLastRechgRecvReadSumAmount';threshold:=trim_scale(parts[3]::numeric)::text;
   else
  parts:=regexp_match(compact,'^当日盈利金额(大于|小于|大于等于|小于等于|不大于|不小于)('||substr(amount,2,length(amount)-2)||'|\{金额\}),当日盈利:'||amount||'[。;；!！?？]?$');
  if parts is not null then
   threshold:=case when parts[2]='{金额}' then parts[2] else trim_scale(parts[2]::numeric)::text end;
   label:='当日盈利金额'||parts[1]||threshold;actual:=parts[3];field:='当日盈利';
  else
   parts:=regexp_match(compact,'^累计提款次数不能小于([0-9]{1,18})次,当前累计提现次数:([0-9]{1,18})次[。;；!！?？]?$');
   if parts is not null then threshold:=(parts[1]::numeric)::text;label:='累计提款次数不能小于'||threshold||'次';actual:=parts[2];field:='当前累计提现次数';
   else
    parts:=regexp_match(compact,'^最后充值日限额超过当前配置的最后充值日限制:([0-9]{1,18})天[,;；]+最后充值时间:'||source_date||'[,;；]当前时间:'||source_date||'[,;；]间隔:([0-9]{1,18})天[.。,;；!！?？]*$');
    if parts is not null then threshold:=(parts[1]::numeric)::text;label:='最后充值日限额超过（限制'||threshold||'天）';actual:=parts[2];field:='间隔天数';
    else
     parts:=regexp_match(compact,'^会员在限制的游戏类型中总的投注数:([0-9]{1,18})$');
     if parts is not null then label:='会员在限制的游戏类型中总的投注数';actual:=parts[1];field:='实际投注数';end if;
    end if;
   end if;
  end if;
 end if;
  end if;
 end if;
 return jsonb_build_object('reason',coalesce(label,note),'actualValue',actual,'actualField',field,'threshold',threshold);
end;
$fn$;
revoke all on function private.dashboard_admin_live_blocking_details_cleaned(text) from public,anon,authenticated;
-- Raw callers decode once (up to the existing three entity passes); callers
-- that already normalized the source pass text directly to the private core.
create or replace function private.dashboard_admin_live_blocking_details(p_note text)
returns jsonb language plpgsql immutable parallel safe set search_path='' as $fn$
declare note text:=p_note;
begin
 if note ~ E'[\\r\\n]' or position('&' in note)>0 or note ~* '<br[[:space:]]*/?>' then
  note:=private.dashboard_admin_live_clean_note(note);
 end if;
 return private.dashboard_admin_live_blocking_details_cleaned(note);
end;
$fn$;
revoke all on function private.dashboard_admin_live_blocking_details(text) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_blocking_category(p_note text)
returns text language sql immutable parallel safe set search_path='' as $$
 select private.dashboard_admin_live_blocking_details(p_note)->>'reason'
$$;
revoke all on function private.dashboard_admin_live_blocking_category(text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_reasons(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_country text;v_platform text;v_code text;v_date date;v_kind text;
 v_offset integer;v_limit integer;v_meta record;v_aliases text[];v_snapshot record;v_expected bigint;v_latest date;
 v_rows jsonb;v_categories jsonb;v_summary jsonb;v_total bigint;v_count bigint;v_rejected bigint;v_noted bigint;v_updated timestamptz;v_key text;
 v_category text;v_reason text;v_operator text;v_query text;v_blocking boolean;v_grouped_snapshot jsonb;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
  or p_request-array['date','country','platform','kind','offset','limit','category','reasonKey','operatorKey','query']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
 foreach v_key in array array['date','country','platform','kind','category','reasonKey','operatorKey','query'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 if coalesce(p_request->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='invalid_time';end if;
 v_date:=(p_request->>'date')::date;v_country:=nullif(btrim(p_request->>'country'),'');v_platform:=nullif(btrim(p_request->>'platform'),'');
 v_kind:=coalesce(p_request->>'kind','blocking');v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 v_blocking:=v_kind in('blocking','blockingOrders','blockingVariants');
 v_category:=nullif(p_request->>'category','');v_reason:=nullif(p_request->>'reasonKey','');v_operator:=nullif(p_request->>'operatorKey','');v_query:=nullif(btrim(p_request->>'query'),'');
 foreach v_key in array array[v_category,v_reason,v_operator] loop
  if v_key is not null and v_key !~ '^[0-9a-f]{32}$' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if v_country is null or v_platform is null or v_kind not in('blocking','blockingOrders','blockingVariants','categories','rejection','operators','orders')
  or (v_kind='blocking' and (v_category is not null or v_reason is not null or v_operator is not null or v_query is not null))
  or (v_kind in('blockingOrders','blockingVariants') and (v_reason is null or v_category is not null or v_operator is not null))
  or (v_kind='blockingVariants' and v_query is not null)
  or v_offset>1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 if not private.dashboard_scope_allows(v_scope,v_country,v_platform) then raise exception using errcode='42501',message='scope_denied';end if;
 -- wg_existing_reasons_v1: existing request validation and scope checks ran above.
 v_rows:=private.dashboard_admin_wg_withdraw_reasons(p_request,v_scope);
 if v_rows is not null then return v_rows;end if;
 select * into v_meta from private.dashboard_admin_live_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
     or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform)) order by p.source limit 1;
 v_code:=coalesce(v_meta.scope_group,(select country_code from public.dashboard_platform_team_map m where m.country_name=v_country and m.active limit 1));
 if v_code is null then raise exception using errcode='22023',message='platform_denied';end if;
 v_aliases:=array[v_platform,v_meta.name,v_meta.source_name];
 select total into v_expected from public.auto_withdraw_daily where (country=v_country or (v_country='胖虎巴西' and upper(country) in ('巴西','BR','BR_PANGHU','PANGHU BRAZIL'))) and data_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform) order by updated_at desc limit 1;
 if v_meta.source='ar' then
  with source_orders as materialized (
   select case when v_kind in('orders','blockingOrders') or v_query is not null then order_no end order_no,
    case when v_kind in('orders','blockingOrders') then amount end amount,
    case when v_kind in('orders','blockingOrders') then status end status,
    nullif(btrim(operator),'') operator,
    case when v_kind in('orders','blockingOrders') then applied_at end applied_at,
    case when v_kind in('orders','blockingOrders') then completed_at end completed_at,
    nullif(btrim(manual_remark),'') manual_raw,case when not v_blocking or v_kind='blockingOrders' then nullif(btrim(remark),'') end rejection_raw,
    updated_at,
    case when nullif(regexp_replace(coalesce(operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end blocking_operator_class,
    case when status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (status in('失败','提现失败','出款失败') and coalesce(btrim(raw_channel),'') in ('','人工取消')) then 'rejected' when status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders where source_system='AR' and country_code=v_code and platform=any(v_aliases) and order_kind='withdraw'
     and applied_at>=v_date::timestamp and applied_at<(v_date+1)::timestamp
  ), note_values as materialized (
   select distinct coalesce(manual_raw,'') raw_note from source_orders
   where v_blocking and blocking_operator_class='manual'
  ), note_flags as materialized (
   select raw_note,private.dashboard_admin_live_clean_note(raw_note) normalized_note from note_values
  ), orders as materialized (
   select o.*,f.normalized_note from source_orders o left join note_flags f on f.raw_note=coalesce(o.manual_raw,'')
  ), blocking_stats as (
   select count(*)::bigint raw,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown
   from orders where manual_raw ~ '[^[:space:]]'
  ), operator_stats as (
   select count(*)::bigint total,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown,
    count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
    count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason"
   from orders
  ), candidates as materialized (
   select * from orders where (v_blocking and blocking_operator_class='manual') or (not v_blocking and status_group='rejected')
  ), distinct_reasons as materialized (
   -- Reuse the normalization already computed once per distinct manual note.
   -- Rejection-only requests never normalize successful/system manual notes.
   select distinct coalesce(case when v_blocking then manual_raw else rejection_raw end,'') raw_note,
    case when v_blocking then normalized_note end normalized_note from candidates
  ), normalized_reasons as materialized (
   select raw_note,case when v_blocking then normalized_note else private.dashboard_admin_live_clean_note(raw_note) end clean_note
   from distinct_reasons
  ), cleaned as materialized (
   select raw_note,case when v_blocking and not coalesce(clean_note ~ '[^[:space:]]',false) then null else clean_note end clean_note,
    case when v_blocking then case when clean_note ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(clean_note)
     else jsonb_build_object('reason','检测没备注') end end blocking_details
   from normalized_reasons
  ), classified as materialized (
   select raw_note,clean_note,blocking_details,case when v_blocking then blocking_details->>'reason' else clean_note end group_note,
    case when not v_blocking then private.dashboard_admin_live_rejection_category(v_code,clean_note) end category from cleaned
  ), notes as materialized (
   select o.order_no,o.amount,o.status,o.operator,o.applied_at,o.completed_at,
    case when v_kind in('orders','blockingOrders') then o.manual_raw end manual_raw,
    case when v_kind in('orders','blockingOrders') then o.rejection_raw end rejection_raw,
    case when v_kind in('orders','blockingOrders') then o.normalized_note end normalized_note,
    o.status_group,
    case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,c.blocking_details
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as materialized (
   select * from notes where (v_category is null or md5(category)=v_category) and (v_reason is null or md5(note)=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,md5(note) as "reasonKey",count(*)::bigint as count,min(source_note) as "sourceReason",count(distinct source_note)::bigint as "sourceVariantCount",
    count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note
  ), variant_groups as (
   select source_note as reason,source_note as "sourceReason",note as "canonicalReason",md5(note) as "reasonKey",count(*)::bigint count,
    count(*) filter(where status_group='success')::bigint success,count(*) filter(where status_group='rejected')::bigint rejected,count(*) filter(where status_group='other')::bigint other
   from selected_notes group by note,source_note
  ), category_groups as (
   select category,md5(category) "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
    count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from selected_notes group by category
  ), operator_groups as (
   select operator,md5(coalesce(operator,'')) "operatorKey",count(*)::bigint count,
    count(distinct category)::bigint "categoryCount",count(*) filter(where category='源备注为空')::bigint "missingReasonCount"
   from selected_notes group by operator
  ), rendered as materialized (
   select to_jsonb(g) item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.reason,null::timestamp from variant_groups g where v_kind='blockingVariants'
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',case when v_blocking then normalized_note else private.dashboard_admin_live_clean_note(manual_raw) end,
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',md5(category),'reasonKey',md5(note),
    'blockingReason',case when v_blocking then note end,
    'blockingActualValue',case when v_blocking then blocking_details->>'actualValue' end,
    'blockingActualField',case when v_blocking then blocking_details->>'actualField' end,
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end),0,order_no,applied_at
   from selected_notes where v_kind in('orders','blockingOrders')
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select case when v_blocking then (select manual from operator_stats) else raw end from blocking_stats),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset v_offset limit v_limit)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,md5(category) "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
      count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from notes group by category)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where category='源备注为空'),
    'withOperator',(select count(*) from notes where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',(select count(*) from selected_notes))
     ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis','current_operator') else '{}'::jsonb end
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_blocking then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_blocking then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',v_expected,'complete',v_count=v_expected,'rejected',v_rejected,'withManualRemark',case when v_blocking then (v_summary->'operatorCounts'->>'manualWithReason')::bigint else v_noted end),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true);end if;
 end if;
 select max(stat_date) into v_latest from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform);
 select * into v_snapshot from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and stat_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 if not v_blocking then
  select * into v_snapshot from public.withdraw_reasons_daily_grouped where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and stat_date=v_date
   and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
   and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 elsif v_snapshot.source_system='PANDA' then
  select snapshot into v_grouped_snapshot from public.withdraw_reasons_daily_grouped where country_code=v_snapshot.country_code and platform=v_snapshot.platform and stat_date=v_date and source_system=v_snapshot.source_system
   and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 end if;
 if v_snapshot.platform is null or v_kind in('orders','operators','blockingOrders') or v_operator is not null or v_query is not null
   or (v_snapshot.source_system='NEWAR' and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (not v_blocking and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (v_blocking and v_snapshot.snapshot->>'note_field'='remark') then
  return jsonb_build_object('available',false,'rows','[]'::jsonb,'total',0,'date',v_date,'kind',v_kind,'latestSnapshotDate',v_latest,
   'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
   'message',case when v_kind='blockingOrders' then '当前来源只有原因汇总，可查看全部原文及笔数；没有逐笔订单编号' when v_kind in('orders','operators') then '当前来源尚未采集逐笔驳回备注及对应操作人，只有原因汇总时不能还原订单详情'
    when not v_blocking then '当前来源尚未单独采集驳回订单的备注字段' else '所选日期尚无自动出款拦截原因采集记录' end);
 end if;
 with source_groups as materialized (
  -- Empty categories are included only when the snapshot explicitly records a manual group.
  -- Missing groups cannot be inferred from a source total or a different operator class.
  select g from jsonb_array_elements(v_snapshot.snapshot->'groups')g
 ), blocking_stats as (
  select coalesce(sum((g->>'count')::bigint),0)::bigint raw,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='manual'),0)::bigint manual,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='auto'),0)::bigint system,
   coalesce(sum((g->>'count')::bigint) filter(where coalesce(g->>'operator_class','unknown') not in('manual','auto')),0)::bigint unknown
  from source_groups where g->>'classification' is distinct from 'empty' and private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]'
 ), original_groups as materialized (
  select case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then null
    else private.dashboard_admin_live_clean_note(g->>'reason_label') end source_reason,
   case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then '检测没备注'
    when v_blocking then private.dashboard_admin_live_blocking_category(coalesce(
    (select gg->>'reason_label' from jsonb_array_elements(v_grouped_snapshot->'groups') gg
     where gg->>'operator_class'=g->>'operator_class' and (gg->>'reason_label'=g->>'reason_label'
      or exists(select 1 from jsonb_array_elements(gg->'variants') vv where vv->>'reason_label'=g->>'reason_label')) limit 1),g->>'reason_label'))
    else private.dashboard_admin_live_clean_note(g->>'reason_label') end reason,
   case when not v_blocking then private.dashboard_admin_live_rejection_category(v_code,private.dashboard_admin_live_clean_note(g->>'reason_label')) end category,
   sum(case when not v_blocking then (g->>'reject')::bigint else (g->>'count')::bigint end)::bigint count,
   sum((g->>'success')::bigint)::bigint success,sum((g->>'reject')::bigint)::bigint rejected,sum((g->>'other')::bigint)::bigint other
  from source_groups
  where (not v_blocking and (g->>'reject')::bigint>0) or (v_blocking and g->>'operator_class'='manual') group by 1,2,3
 ), selected_groups as materialized (
  select * from original_groups where (v_category is null or md5(category)=v_category) and (v_reason is null or md5(reason)=v_reason)
 ), rendered as (
  select jsonb_build_object('category',category,'categoryKey',md5(category),'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint) item,sum(count) count,category label
   from selected_groups where v_kind='categories' group by category
  union all select jsonb_build_object('reason',reason,'reasonKey',md5(reason),'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint,
    'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint) item,sum(count),reason
   from selected_groups g where v_kind in('blocking','rejection') group by reason
  union all select jsonb_build_object('reason',source_reason,'sourceReason',source_reason,'canonicalReason',reason,'reasonKey',md5(reason),
    'count',sum(count)::bigint,'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint),sum(count),source_reason
   from selected_groups where v_kind='blockingVariants' group by source_reason,reason
 ) select (select count(*) from rendered),
  coalesce((select jsonb_agg(item order by count desc,label) from (select * from rendered order by count desc,label offset v_offset limit v_limit)p),'[]'::jsonb),
  (select coalesce(sum(count),0) from original_groups),
  coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
   (select category,md5(category) "categoryKey",sum(count)::bigint count,min(source_reason) as "sourceReason",
     count(distinct source_reason)::bigint as "sourceVariantCount" from original_groups group by category)g),'[]'::jsonb),
  jsonb_build_object('totalRejected',v_snapshot.snapshot->'totals'->'reject','selectedCount',(select coalesce(sum(count),0) from selected_groups))
   ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),
    -- Reason snapshots do not prove the complete operator universe. Never infer totals from note groups.
    'operatorCounts',jsonb_build_object('total',null,'manual',null,'system',null,'unknown',null,
      'manualWithReason',(select manual from blocking_stats),'manualWithoutReason',
       (select sum((g->>'count')::bigint) from source_groups where g->>'operator_class'='manual'
        and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)))),'operatorBasis','snapshot_classification') else '{}'::jsonb end
 into v_total,v_rows,v_noted,v_categories,v_summary;
 return jsonb_build_object('available',true,'source',v_snapshot.source_system||' 原因采集快照','basis',coalesce(v_snapshot.snapshot->>'note_field','source_note'),
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'rows',v_rows,'total',v_total,'offset',v_offset,'limit',v_limit,
  'noteCount',case when v_blocking then v_noted else coalesce((v_snapshot.snapshot->'totals'->>'reject')::bigint,v_noted) end,
  'categories',v_categories,'summary',v_summary,'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
  'coverage',v_snapshot.snapshot->'coverage','updatedAt',v_snapshot.updated_at,'latestSnapshotDate',v_latest);
end;
$function$;
notify pgrst, 'reload schema';
commit;
