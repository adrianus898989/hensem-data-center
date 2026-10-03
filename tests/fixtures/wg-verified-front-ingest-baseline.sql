-- Verified code-only ingest definitions; no records, credentials or connection values.
create function private.wg_detail_record_keys() returns text[] language sql immutable set search_path='' as $$
select array['system','country','platform','site_code','business','order_number','third_order_number','member_id','provider','channel','utr',
'status_code','status_group','created_at','success_at','updated_at','operated_at','completion_at_unverified','captured_at',
'member_currency','member_unit_scale','member_amount_units','member_amount','settlement_currency','settlement_amount','settlement_fee','exchange_rate','source_fields']::text[];
$$;

create or replace function private.wg_detail_validate_record_v2(r jsonb, site text, biz text) returns void
language plpgsql set search_path='' as $$
declare k text; v text; expected_country text; expected_platform text; cols text[]; ts timestamptz;
begin
  expected_country:=case when site in ('278','8311','12588') then 'BR' else 'VN' end;
  expected_platform:=case site when '278' then '26BET' when '8311' then 'POPKKK' when '12588' then 'POPMIU' when '3257' then '98VV' when '3605' then 'XX98' end;
  if jsonb_typeof(r) is distinct from 'object' or (r-private.wg_detail_record_keys())<>'{}'::jsonb
    or not (r ?& private.wg_detail_record_keys()) or r->>'system' is distinct from 'WG'
    or r->>'site_code' is distinct from site or r->>'business' is distinct from biz
    or r->>'platform' is distinct from expected_platform or r->>'country' is distinct from expected_country then
    raise exception 'WG_INVALID_RECORD';
  end if;
  foreach k in array array['order_number','third_order_number','member_id','utr'] loop
    v:=r->>k;
    if (k='order_number' and v is null) or (v is not null and (jsonb_typeof(r->k)<>'string' or v !~ '^[A-Za-z0-9_.:/+\-]{1,128}$')) then raise exception 'WG_INVALID_RECORD'; end if;
  end loop;
  foreach k in array array['provider','channel'] loop
    v:=r->>k;
    if v is not null and (jsonb_typeof(r->k)<>'string' or length(v)>120 or v ~ '[[:cntrl:]@]' or v ~ 'https?://|[0-9]{10,}') then raise exception 'WG_INVALID_RECORD'; end if;
  end loop;
  if jsonb_typeof(r->'status_code') is distinct from 'number' or (r->>'status_code') !~ '^-?[0-9]{1,8}$'
    or r->>'status_group' is distinct from (case
      when biz='recharge' then case r->>'status_code' when '1' then 'pending' when '2' then 'success' else 'unknown' end
      else case r->>'status_code' when '1' then 'pending' when '2' then 'pending' when '3' then 'paying' when '4' then 'success' when '5' then 'failed' when '6' then 'cancelled' when '7' then 'rejected' when '8' then 'forced' else 'unknown' end end)
    or r->>'member_currency' is distinct from (case expected_country when 'BR' then 'BRL' else 'VND' end)
    or r->>'settlement_currency' is null or r->>'settlement_currency' !~ '^[A-Z]{3,8}$'
    or jsonb_typeof(r->'member_unit_scale') is distinct from 'number' or r->>'member_unit_scale' not in ('1','1000')
    or (r->>'member_unit_scale'='1000' and expected_country<>'VN') then raise exception 'WG_INVALID_RECORD'; end if;
  foreach k in array array['member_amount_units','member_amount','settlement_amount','settlement_fee','exchange_rate'] loop
    v:=r->>k;
    if (k in ('member_amount_units','member_amount') and v is null)
      or (v is not null and (jsonb_typeof(r->k)<>'string' or v !~ '^-?[0-9]{1,23}([.][0-9]{1,18})?$')) then raise exception 'WG_INVALID_RECORD'; end if;
  end loop;
  foreach k in array array['created_at','success_at','updated_at','operated_at','completion_at_unverified','captured_at'] loop
    v:=r->>k;
    if k in ('created_at','captured_at') and v is null then raise exception 'WG_INVALID_RECORD'; end if;
    if v is not null then
      if jsonb_typeof(r->k)<>'string' or v !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' then raise exception 'WG_INVALID_RECORD'; end if;
      ts:=v::timestamptz;
      if ts<'2020-01-01 UTC'::timestamptz or ts>clock_timestamp()+interval '5 minutes' then raise exception 'WG_INVALID_RECORD'; end if;
    end if;
  end loop;
  if (r->>'member_amount')::numeric<>(r->>'member_amount_units')::numeric*(r->>'member_unit_scale')::numeric
    or (biz='withdraw' and (r->>'success_at' is not null or r->>'updated_at' is not null))
    or (biz='recharge' and (r->>'updated_at' is null or r->>'operated_at' is not null or r->>'completion_at_unverified' is not null))
    or ((r->>'success_at') is not null and r->>'status_code'<>'2') then raise exception 'WG_INVALID_RECORD'; end if;
  foreach k in array array['success_at','updated_at','operated_at','completion_at_unverified','captured_at'] loop
    if (r->>k)::timestamptz < (r->>'created_at')::timestamptz then raise exception 'WG_INVALID_RECORD'; end if;
  end loop;
  cols:=case biz when 'recharge' then array['amount','realAmount','callbackAmount','payedAmount','cryptoAmount','cryptoRate','fee','realFee','feeRate','reduceFee','channelRate','auditRate','auditRateBonus','allChangeAmount','changeAmount','deduceAmount','deduceBet']
    else array['money','realAmount','channelAmount','fee','exchangeRate','administrative_fee','discount_fee','withdrawToRechargeAmount','withdrawToRechargeGiftAmount','channelGift','withdrawActiveGiftAmount'] end;
  if jsonb_typeof(r->'source_fields') is distinct from 'object' then raise exception 'WG_INVALID_RECORD'; end if;
  for k,v in select key,value from jsonb_each_text(r->'source_fields') loop
    if k=any(cols) then
      if v is not null and (jsonb_typeof(r->'source_fields'->k)<>'string' or v !~ '^-?[0-9]{1,20}([.][0-9]{1,18})?$') then raise exception 'WG_INVALID_RECORD'; end if;
    elsif k=any(case biz when 'recharge' then array['payStatus','orderStatus','orderType','payTypeId','paymentId','paylineId','payEntryId','payReceiveId','merchAgentId','vipLevel']
      else array['status','order_type','merchAgentId','merchId','withdrawMainType','callbackStatus','thirdAbnormalStatus','review_count','vipLevel'] end) then
      if v is not null and (jsonb_typeof(r->'source_fields'->k)<>'number' or v !~ '^-?[0-9]{1,18}$') then raise exception 'WG_INVALID_RECORD'; end if;
    elsif k='channelType' and biz='recharge' then
      if v is not null and (jsonb_typeof(r->'source_fields'->k)<>'string' or length(v)>120 or v ~ '[[:cntrl:]@]' or v ~ 'https?://|[0-9]{10,}') then raise exception 'WG_INVALID_RECORD'; end if;
    else raise exception 'WG_INVALID_RECORD';
    end if;
  end loop;
exception when others then raise exception 'WG_INVALID_RECORD';
end $$;

create or replace function public.wg_detail_sync(p_token_hash text, p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  credential private.wg_detail_credentials%rowtype;
  st private.wg_detail_progress%rowtype;
  receipt private.wg_detail_page_receipts%rowtype;
  action text:=p_request->>'action'; site text:=p_request->>'site_code'; biz text:=p_request->>'business'; axis text:=p_request->>'basis';
  owner_id uuid; run uuid; answer jsonb; state_rows jsonb; r jsonb; material jsonb;
  history_first bigint; history_last bigint; history_cursor bigint; history_rows jsonb; legacy_changed boolean;
  floor_time bigint; start_time bigint; end_time bigint; expected bigint; page_no integer; cnt integer; changed integer:=0; n integer;
  table_name text; column_list text; update_list text; all_cols text[]; ids text[]; records jsonb; body_hash text; tz text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'WG_AUTH_INVALID'; end if;
  select * into credential from private.wg_detail_credentials where key_hash=p_token_hash and enabled;
  if not found then raise exception 'WG_AUTH_INVALID'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'schema_version' is distinct from '1'
    or action is null or action not in ('state','history_state','claim','renew','page','finish','release') then raise exception 'WG_INVALID_REQUEST'; end if;
  answer:=jsonb_build_object('ok',true,'schema_version',1,'receiver_version',3,'action',action);
  if action='history_state' then
    if (p_request-array['schema_version','action'])<>'{}'::jsonb then raise exception 'WG_INVALID_REQUEST'; end if;
    select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into history_rows from (
      select site_code,business,basis,range_start,range_end,cursor from private.wg_detail_history
      where site_code=any(credential.allowed_sites) order by updated_at desc limit 2000
    ) q;
    return answer||jsonb_build_object('history',history_rows);
  end if;
  if action='state' then
    if (p_request-array['schema_version','action'])<>'{}'::jsonb then raise exception 'WG_INVALID_REQUEST'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('site_code',site_code,'business',business,'basis',basis,'floor',floor,'cursor',cursor)),'[]'::jsonb)
      into state_rows from private.wg_detail_progress where site_code=any(credential.allowed_sites);
    return answer||jsonb_build_object('streams',state_rows);
  end if;
  if site is null or not (site=any(credential.allowed_sites)) or site not in ('278','8311','12588','3257','3605') then raise exception 'WG_SCOPE_DENIED'; end if;
  if biz is null or axis is null or not ((biz='recharge' and axis in ('created','updated')) or (biz='withdraw' and axis in ('created','operated'))) then raise exception 'WG_INVALID_REQUEST'; end if;
  owner_id:=(p_request->>'owner')::uuid; run:=(p_request->>'run_id')::uuid;
  if owner_id is null or run is null then raise exception 'WG_INVALID_REQUEST'; end if;
  answer:=answer||jsonb_build_object('run_id',run,'stream','WG:'||site||':'||biz||':'||axis||':all');
  if action='claim' then
    if (p_request-array['schema_version','action','site_code','business','basis','owner','run_id','expected_cursor','floor','start','end','backfill','history_start','history_end'])<>'{}'::jsonb then raise exception 'WG_INVALID_REQUEST'; end if;
    start_time:=(p_request->>'start')::bigint; end_time:=(p_request->>'end')::bigint; expected:=(p_request->>'expected_cursor')::bigint;
    floor_time:=(p_request->>'floor')::bigint;
    if start_time is null or end_time is null or floor_time is null or start_time<1577836800 or start_time>end_time
      or end_time-start_time>10800 or end_time>extract(epoch from clock_timestamp())::bigint
      or jsonb_typeof(p_request->'backfill') is distinct from 'boolean' then raise exception 'WG_INVALID_WINDOW'; end if;
    -- Serialize one stream even before its first row exists.
    perform pg_advisory_xact_lock(hashtextextended('WG:'||site||':'||biz||':'||axis,0));
    select * into st from private.wg_detail_progress where site_code=site and business=biz and basis=axis for update;
    if not found then
      tz:=case when site in ('278','8311','12588') then 'America/Sao_Paulo' else 'Asia/Ho_Chi_Minh' end;
      if floor_time<>extract(epoch from (date_trunc('day',clock_timestamp() at time zone tz) at time zone tz))::bigint then raise exception 'WG_INVALID_FIRST_DAY'; end if;
      insert into private.wg_detail_progress(site_code,business,basis,floor) values(site,biz,axis,floor_time);
      select * into st from private.wg_detail_progress where site_code=site and business=biz and basis=axis for update;
    end if;
    if st.lease_until>clock_timestamp() then raise exception 'WG_STREAM_BUSY'; end if;
    if floor_time<>st.floor or (not (p_request->>'backfill')::boolean and
      (st.cursor is distinct from expected or start_time<st.floor or end_time<=coalesce(st.cursor,st.floor-1)
       or start_time>coalesce(st.cursor,st.floor-1)+1)) then raise exception 'WG_CURSOR_CONFLICT'; end if;
    if p_request ? 'history_start' or p_request ? 'history_end' then
      history_first:=(p_request->>'history_start')::bigint; history_last:=(p_request->>'history_end')::bigint;
      if not (p_request->>'backfill')::boolean or history_first is null or history_last is null
        or history_first<1577836800 or history_last<history_first or history_last-history_first>=31*86400
        or start_time<history_first or end_time>history_last then raise exception 'WG_INVALID_HISTORY_RANGE'; end if;
      insert into private.wg_detail_history(site_code,business,basis,range_start,range_end)
        values(site,biz,axis,history_first,history_last) on conflict do nothing;
      select cursor into history_cursor from private.wg_detail_history
        where site_code=site and business=biz and basis=axis and range_start=history_first and range_end=history_last for update;
      if start_time<>coalesce(history_cursor,history_first-1)+1 then raise exception 'WG_CURSOR_CONFLICT'; end if;
    end if;
    delete from private.wg_detail_page_receipts where site_code=site and business=biz and basis=axis;
    update private.wg_detail_progress set owner=owner_id, run_id=run, lease_until=clock_timestamp()+interval '5 minutes',
      window_start=start_time, window_end=end_time, history_start=history_first,history_end=history_last, backfill=(p_request->>'backfill')::boolean, received=0,pages=0
      where site_code=site and business=biz and basis=axis;
    return answer;
  end if;
  select * into st from private.wg_detail_progress where site_code=site and business=biz and basis=axis for update;
  if not found or st.owner is distinct from owner_id or st.run_id is distinct from run then raise exception 'WG_RUN_CONFLICT'; end if;
  if action='release' then
    update private.wg_detail_progress set lease_until=null,owner=null,run_id=null where site_code=site and business=biz and basis=axis;
    return answer;
  end if;
  if st.lease_until is null or st.lease_until<=clock_timestamp() then raise exception 'WG_LEASE_EXPIRED'; end if;
  if action='renew' then
    update private.wg_detail_progress set lease_until=clock_timestamp()+interval '5 minutes' where site_code=site and business=biz and basis=axis;
    return answer;
  end if;
  if action='page' then
    if (p_request-array['schema_version','action','site_code','business','basis','owner','run_id','page','records'])<>'{}'::jsonb then raise exception 'WG_INVALID_REQUEST'; end if;
    records:=p_request->'records'; page_no:=(p_request->>'page')::integer;
    if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records) not between 1 and 200 or page_no is null then raise exception 'WG_INVALID_REQUEST'; end if;
    cnt:=jsonb_array_length(records); body_hash:=md5(records::text);
    select * into receipt from private.wg_detail_page_receipts where site_code=site and business=biz and basis=axis and page=page_no;
    if found then
      if receipt.run_id<>run or receipt.body_hash<>body_hash then raise exception 'WG_BATCH_CONFLICT'; end if;
      return answer||jsonb_build_object('received',receipt.received,'written',receipt.written,'stale',receipt.stale);
    end if;
    if page_no<>st.pages+1 then raise exception 'WG_PAGE_SEQUENCE'; end if;
    select array_agg(value->>'order_number') into ids from jsonb_array_elements(records);
    if cardinality(ids)<>(select count(distinct v) from unnest(ids) v)
      or exists(select 1 from private.wg_detail_page_receipts where site_code=site and business=biz and basis=axis and order_ids&&ids) then raise exception 'WG_DUPLICATE_ORDER'; end if;
    all_cols:=private.wg_detail_record_keys()||array['business_fields','version_at','content_hash'];
    select string_agg(format('%I',v),','),string_agg(format('%1$I=excluded.%1$I',v),',')
      into column_list,update_list from unnest(all_cols) v;
    table_name:='wg_'||biz||'_details';
    for r in select value from jsonb_array_elements(records) loop
      perform private.wg_detail_validate_record(r,site,biz);
      if r->>(case axis when 'created' then 'created_at' when 'updated' then 'updated_at' else 'operated_at' end) is null
        or extract(epoch from (r->>(case axis when 'created' then 'created_at' when 'updated' then 'updated_at' else 'operated_at' end))::timestamptz) not between st.window_start and st.window_end then raise exception 'WG_RECORD_OUTSIDE_WINDOW'; end if;
      -- Old clients cannot erase business fields already supplied by v3.
      if not (r ? 'business_fields') then
        execute format('select business_fields,(to_jsonb(c)-$2) is distinct from (to_jsonb(jsonb_populate_record(null::public.%1$I,$1))-$2)
          from public.%1$I c where site_code=$3 and order_number=$4',table_name)
          into material,legacy_changed using r,array['business_fields','version_at','content_hash','stored_at','captured_at'],site,r->>'order_number';
        -- A v2 replay of the same business record is compatible. A changed
        -- order cannot transplant an old operator/reason onto a new state/day.
        if material is not null and legacy_changed then raise exception 'WG_CLIENT_UPGRADE_REQUIRED'; end if;
        r:=r||jsonb_build_object('business_fields',material);
      end if;
      material:=r||jsonb_build_object('version_at',coalesce(r->>'updated_at',r->>'operated_at',r->>'created_at'),'content_hash',md5((r-'captured_at')::text));
      execute format('insert into public.%1$I as current_row (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1)
        on conflict(site_code,order_number) do update set %3$s, stored_at=clock_timestamp()
        where excluded.version_at>=current_row.version_at and excluded.captured_at>=current_row.captured_at and excluded.content_hash<>current_row.content_hash',table_name,column_list,update_list) using material;
      get diagnostics n=row_count; changed:=changed+n;
    end loop;
    insert into private.wg_detail_page_receipts values(site,biz,axis,run,page_no,body_hash,ids,cnt,changed,cnt-changed);
    update private.wg_detail_progress set pages=page_no,received=received+cnt,lease_until=clock_timestamp()+interval '5 minutes'
      where site_code=site and business=biz and basis=axis;
    return answer||jsonb_build_object('received',cnt,'written',changed,'stale',cnt-changed);
  end if;
  if action='finish' then
    if (p_request-array['schema_version','action','site_code','business','basis','owner','run_id','count','pages'])<>'{}'::jsonb
      or (p_request->>'count')::integer is distinct from st.received or (p_request->>'pages')::integer is distinct from st.pages then raise exception 'WG_INCOMPLETE_WINDOW'; end if;
    if st.history_start is not null then
      update private.wg_detail_history set cursor=st.window_end,updated_at=clock_timestamp()
        where site_code=site and business=biz and basis=axis and range_start=st.history_start and range_end=st.history_end;
    end if;
    update private.wg_detail_progress set cursor=case when backfill then cursor else window_end end,
      last_success_at=clock_timestamp(), lease_until=null,owner=null,run_id=null
      where site_code=site and business=biz and basis=axis;
    delete from private.wg_detail_page_receipts where site_code=site and business=biz and basis=axis;
    return answer||jsonb_build_object('count',st.received,'cursor',case when st.backfill then st.cursor else st.window_end end);
  end if;
  raise exception 'WG_INVALID_REQUEST';
end $$;
