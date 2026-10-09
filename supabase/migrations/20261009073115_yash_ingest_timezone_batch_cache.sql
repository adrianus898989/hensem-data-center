-- Avoid repeated timezone catalog enumeration in YASH order batches.
-- Preserve exact order values, receipt verification, token scope and grants.
create or replace function public.yash_order_ingest(p_token_hash text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 r jsonb; v private.yash_orders; previous private.yash_orders; n integer; t timestamptz:=clock_timestamp();
 a text:=p_request->>'action'; clean jsonb; key_count bigint; found_count bigint; all_count bigint;
 st timestamptz; en timestamptz; obs timestamptz; kind text; stream_name text; tz text; verified boolean;
 timezone_names text[];
begin
 if not exists(select 1 from private.yash_ingest_credentials c where c.token_hash=p_token_hash
   and c.revoked_at is null and c.expires_at>t) then
   raise exception 'YASH_UNAUTHORIZED' using errcode='28000';
 end if;
 if a='check' then return jsonb_build_object('ok',true,'schema_version',1,'source_site','yash'); end if;
 if p_request->>'schema_version' is distinct from '1' then raise exception 'YASH_INVALID_VERSION'; end if;
 -- Serialise ingestion and receipt verification so a receipt sees an atomic snapshot.
 perform pg_advisory_xact_lock(74910261009::bigint);
 if a='ingest' then
  if jsonb_typeof(p_request->'records') is distinct from 'array' then raise exception 'YASH_INVALID_RECORDS'; end if;
  n:=jsonb_array_length(p_request->'records');
  if n<1 or n>500 then raise exception 'YASH_INVALID_RECORDS'; end if;
  if (select count(distinct (x->>'order_type',x->>'order_no')) from jsonb_array_elements(p_request->'records') x)<>n then raise exception 'YASH_DUPLICATE_KEYS'; end if;
  for r in select value from jsonb_array_elements(p_request->'records') loop
   if jsonb_typeof(r) is distinct from 'object' then raise exception 'YASH_INVALID_RECORD'; end if;
   v:=jsonb_populate_record(null::private.yash_orders,r);
   v.source_site:='yash';
   if r->>'source_site' is not null and r->>'source_site'<>'yash' then raise exception 'YASH_SCOPE_DENIED'; end if;
   if v.created_at>t+interval '5 minutes' or v.completed_at>t+interval '5 minutes'
      or v.observed_at>t+interval '5 minutes' or v.observed_at<v.created_at
      then raise exception 'YASH_INVALID_TIME'; end if;
   -- Fixed offsets are metadata: never convert them with PostgreSQL's POSIX
   -- timezone syntax. Validate directly; enumerate IANA names at most once per
   -- batch, only when needed. Per-row pg_timezone_names scans timed out at 200 rows.
   if not coalesce(v.source_timezone ~ '^UTC[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$',false) then
    if timezone_names is null then
     select array_agg(name) into timezone_names from pg_catalog.pg_timezone_names;
    end if;
    if not coalesce(v.source_timezone=any(timezone_names),false) then
     raise exception 'YASH_INVALID_TIME';
    end if;
   end if;
   select coalesce(jsonb_object_agg(key,value),'{}') into clean from jsonb_each(coalesce(r->'raw_fields','{}'))
    where key=any(array['UID','订单号','子订单号','三方订单号','订单状态','提现状态','充值金额','提现金额','手续费','充值前余额','提现后余额','充值总金额','优惠比例','下单时间','申请时间','完成时间','供应商商户','支付通道','支付方式','提现账户类型','来源','充值类型','提现类型','是否首单','币种','货币','Currency']) and jsonb_typeof(value) in ('string','number','boolean','null') and length(value::text)<=258;
   v.raw_fields:=clean;
   -- Contacts and links are never retained as a business operator account.
   if v.operator ~* '(https?://|@|[0-9][0-9 .()+-]{5,}[0-9])' then v.operator:='[已移除联系方式]'; end if;
   select * into previous from private.yash_orders where order_type=v.order_type and order_no=v.order_no;
   if previous.order_no is null or v.observed_at>=previous.observed_at then
    update private.yash_sync_windows w set complete=false
    where w.order_type=v.order_type and w.complete and (
     (w.stream='createTime' and v.created_at is distinct from previous.created_at and
       ((v.created_at>=w.start_at and v.created_at<w.end_exclusive) or (previous.created_at>=w.start_at and previous.created_at<w.end_exclusive))) or
     (w.stream='completeTime' and v.completed_at is distinct from previous.completed_at and
       ((v.completed_at>=w.start_at and v.completed_at<w.end_exclusive) or (previous.completed_at>=w.start_at and previous.completed_at<w.end_exclusive)))
    );
   end if;
   insert into private.yash_orders (source_site,order_type,order_no,uid,child_order_no,supplier_order_no,supplier,channel,payment_method,source_category,order_category,operator,amount,fee,balance_before,balance_after,credited_amount,discount_percent,status,created_at,completed_at,source_timezone,is_first_order,currency,currency_basis,raw_fields,observed_at)
   values (v.source_site,v.order_type,v.order_no,v.uid,v.child_order_no,v.supplier_order_no,v.supplier,v.channel,v.payment_method,v.source_category,v.order_category,v.operator,v.amount,v.fee,v.balance_before,v.balance_after,v.credited_amount,v.discount_percent,v.status,v.created_at,v.completed_at,v.source_timezone,v.is_first_order,v.currency,v.currency_basis,v.raw_fields,v.observed_at)
   on conflict(order_type,order_no) do update set uid=excluded.uid,child_order_no=excluded.child_order_no,supplier_order_no=excluded.supplier_order_no,supplier=excluded.supplier,channel=excluded.channel,payment_method=excluded.payment_method,source_category=excluded.source_category,order_category=excluded.order_category,operator=excluded.operator,amount=excluded.amount,fee=excluded.fee,balance_before=excluded.balance_before,balance_after=excluded.balance_after,credited_amount=excluded.credited_amount,discount_percent=excluded.discount_percent,status=excluded.status,created_at=excluded.created_at,completed_at=excluded.completed_at,source_timezone=excluded.source_timezone,is_first_order=excluded.is_first_order,currency=excluded.currency,currency_basis=excluded.currency_basis,raw_fields=excluded.raw_fields,observed_at=excluded.observed_at,received_at=t
   where excluded.observed_at>=yash_orders.observed_at;
  end loop;
  return jsonb_build_object('ok',true,'accepted',n);
 elsif a='receipt' then
  st:=(p_request->>'start_at')::timestamptz;en:=(p_request->>'end_exclusive')::timestamptz;
  obs:=(p_request->>'snapshot_at')::timestamptz;kind:=p_request->>'order_type';stream_name:=p_request->>'stream';tz:=p_request->>'source_timezone';
  if st is null or en is null or obs is null or st<'2020-01-01'::timestamptz or en<=st or en>st+interval '36 hours'
    or obs>t+interval '5 minutes' or en>obs or kind not in ('deposit','withdrawal') or kind is null
    or stream_name not in ('createTime','completeTime') or stream_name is null
    or not (case when coalesce(tz ~ '^UTC[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$',false)
      then true else exists(select 1 from pg_catalog.pg_timezone_names where name=tz) end)
    then raise exception 'YASH_INVALID_WINDOW'; end if;
  if jsonb_typeof(p_request->'order_keys') is distinct from 'array' then raise exception 'YASH_INVALID_KEYS'; end if;
  key_count:=jsonb_array_length(p_request->'order_keys');
  if key_count>50000 or key_count<>(p_request->>'source_count')::bigint
    or (p_request->>'source_count') is null
    or exists(select 1 from jsonb_array_elements(p_request->'order_keys') k where jsonb_typeof(k)<>'string' or length(k#>>'{}') not between 1 and 200)
    or (select count(distinct value) from jsonb_array_elements_text(p_request->'order_keys'))<>key_count then raise exception 'YASH_INVALID_KEYS'; end if;
  select count(*),count(*) filter(where o.order_no in(select jsonb_array_elements_text(p_request->'order_keys')))
    into all_count,found_count from private.yash_orders o where o.order_type=kind
    and (case when stream_name='createTime' then o.created_at else o.completed_at end)>=st
    and (case when stream_name='createTime' then o.created_at else o.completed_at end)<en;
  verified:=all_count=key_count and found_count=key_count;
  insert into private.yash_sync_windows(order_type,stream,start_at,end_exclusive,source_count,uploaded_count,stored_count,complete,observed_at,source_timezone)
  values(kind,stream_name,st,en,key_count,found_count,all_count,verified,obs,tz)
  on conflict(order_type,stream,start_at,end_exclusive) do update set
   source_count=excluded.source_count,uploaded_count=excluded.uploaded_count,stored_count=excluded.stored_count,
   complete=excluded.complete,observed_at=excluded.observed_at,source_timezone=excluded.source_timezone,received_at=t
  where excluded.observed_at>=yash_sync_windows.observed_at;
  return jsonb_build_object('ok',true,'verified',verified,'source_count',key_count,'uploaded_count',found_count,'stored_count',all_count);
 else raise exception 'YASH_INVALID_ACTION'; end if;
end $$;
revoke all on function public.yash_order_ingest(text,jsonb) from public,anon,authenticated;
grant execute on function public.yash_order_ingest(text,jsonb) to service_role;
