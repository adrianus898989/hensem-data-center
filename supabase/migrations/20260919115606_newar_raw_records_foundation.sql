-- LOCAL-ONLY foundation. No credentials are provisioned, no existing query or
-- collector is switched, and no legacy/GAME66 rows or aggregates are modified.
-- A batch acknowledgement proves storage only, never date-range completeness.
begin;

create table public.newar_detail_platforms (
  platform text primary key,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  country text not null,
  timezone text not null,
  currency text not null,
  enabled boolean not null default true
);
insert into public.newar_detail_platforms(platform,country_code,country,timezone,currency) values
  ('POPZAR','PK','巴基斯坦','Asia/Karachi','PKR'),
  ('92BLAZE','PK','巴基斯坦','Asia/Karachi','PKR'),
  ('DhaniWin','IN','印度','Asia/Kolkata','INR');

create table private.newar_detail_credentials (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  allowed_scopes jsonb not null check(jsonb_typeof(allowed_scopes)='array'),
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.newar_detail_records (
  id uuid primary key default gen_random_uuid(),
  platform text not null references public.newar_detail_platforms(platform),
  dataset text not null check(dataset in ('charge','withdraw','workorder')),
  source_id text not null check(length(source_id) between 1 and 200),
  member_id text, order_number text, third_party_order_number text,
  provider text, provider_id text, channel_type text,
  currency text check(currency is null or currency ~ '^[A-Z0-9]{3,8}$'),
  amount numeric(24,8) not null check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')),
  actual_amount numeric(24,8) check(actual_amount>=0 and actual_amount::text not in ('NaN','Infinity','-Infinity')),
  fee numeric(24,8) check(fee>=0 and fee::text not in ('NaN','Infinity','-Infinity')),
  status_code text,
  status_group text not null check(status_group in ('success','pending','failed','rejected','unknown')),
  created_at timestamptz not null,
  success_at timestamptz,
  processed_at timestamptz,
  source_updated_at timestamptz,
  captured_at timestamptz not null,
  workorder_type text, operator text, followup_count integer check(followup_count>=0),
  raw jsonb not null default '{}' check(jsonb_typeof(raw)='object'),
  received_at timestamptz not null default now(),
  unique(platform,dataset,source_id),
  check(success_at is null or (status_group='success' and success_at>=created_at)),
  check(processed_at is null or processed_at>=created_at)
);
create index newar_detail_created_idx on public.newar_detail_records(platform,dataset,created_at desc,id desc);
create index newar_detail_success_idx on public.newar_detail_records(platform,dataset,success_at desc,id desc)
  where status_group='success' and success_at is not null;
create index newar_detail_processed_idx on public.newar_detail_records(platform,dataset,processed_at desc,id desc)
  where processed_at is not null;
create index newar_detail_member_idx on public.newar_detail_records(platform,dataset,member_id,created_at desc,id desc)
  where member_id is not null;
create index newar_detail_order_idx on public.newar_detail_records(platform,dataset,order_number) where order_number is not null;
create index newar_detail_third_order_idx on public.newar_detail_records(platform,dataset,third_party_order_number) where third_party_order_number is not null;
create table private.newar_detail_batches (
  batch_id uuid primary key,
  payload_hash text not null,
  platform text not null references public.newar_detail_platforms(platform),
  dataset text not null,
  received_count integer not null,
  written_count integer not null,
  stale_count integer not null,
  received_at timestamptz not null default now(),
  check(received_count=written_count+stale_count)
);
alter table public.newar_detail_platforms enable row level security;
alter table public.newar_detail_records enable row level security;
alter table private.newar_detail_credentials enable row level security;
alter table private.newar_detail_batches enable row level security;
revoke all on public.newar_detail_platforms,public.newar_detail_records,
  private.newar_detail_credentials,private.newar_detail_batches from public,anon,authenticated;
-- Credential provisioning is a separate, explicit administrative operation.
grant usage on schema private to service_role;

create function private.newar_detail_raw_keys() returns text[] language sql immutable set search_path='' as $$
  select array['id','userId','memberId','orderNo','thirdOrderNo','thirdId','payId',
    'createTime','created','originCreated','rechargeSuccessTime','submittedTime','lastUpdateTime',
    'withdrawState','thirdState','rechargeState','state','amount','actualAmount','fee',
    'rechargeChannelName','rechargeType','payMethod','withdrawChannelName','withdrawType',
    'type','operator','followUpCount','followupCount','countryId','currency','currencyEvidence',
    'workOrderId','workOrderTypeName','submissionTime','handledTime','payTypeId',
    'thirdPaymentName','thirdPartyMappingCode','rechargeChannelId','reminderCount','lastUpdateMan',
    'displayName','rechargeNumber','transactionId','rechargeChannelType','coinToFiatRate','uGold',
    'sysCurrency','uRate','withdrawChannelId','withdrawCategoryId','withdrawCategoryName']::text[];
$$;

create function private.newar_detail_assert_batch(p_batch jsonb) returns void
language plpgsql set search_path='' as $$
declare
  r jsonb; k text; v text; v_created timestamptz; v_captured timestamptz; v_time timestamptz;
  n integer; v_platform public.newar_detail_platforms%rowtype;
begin
  if p_batch is null or jsonb_typeof(p_batch)<>'object'
    or (p_batch-array['schema_version','batch_id','platform','dataset','records'])<>'{}'::jsonb
    or not (p_batch ?& array['schema_version','batch_id','platform','dataset','records'])
    or p_batch->'schema_version'<>'1'::jsonb
    or jsonb_typeof(p_batch->'batch_id')<>'string'
    or p_batch->>'batch_id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    or jsonb_typeof(p_batch->'platform')<>'string'
    or jsonb_typeof(p_batch->'dataset')<>'string'
    or p_batch->>'dataset' not in ('charge','withdraw','workorder')
    or jsonb_typeof(p_batch->'records')<>'array'
    or octet_length(p_batch::text)>2097152 then
    raise exception using errcode='22023',message='NEWAR_INVALID_BATCH';
  end if;
  select * into v_platform from public.newar_detail_platforms where platform=p_batch->>'platform' and enabled;
  if not found then raise exception using errcode='22023',message='NEWAR_INVALID_PLATFORM'; end if;
  n:=jsonb_array_length(p_batch->'records');
  if n not between 1 and 500 then raise exception using errcode='22023',message='NEWAR_INVALID_BATCH_SIZE'; end if;
  for r in select value from jsonb_array_elements(p_batch->'records') loop
    if jsonb_typeof(r)<>'object'
      or not (r ?& array['source_id','amount','status_code','status_group','created_at','captured_at','raw'])
      or (r-array['source_id','member_id','order_number','third_party_order_number','provider','provider_id',
        'channel_type','currency','amount','actual_amount','fee','status_code','status_group','created_at',
        'success_at','processed_at','source_updated_at','captured_at','workorder_type','operator','followup_count','raw'])<>'{}'::jsonb then
      raise exception using errcode='22023',message='NEWAR_INVALID_RECORD_FIELDS';
    end if;
    foreach k in array array['source_id','member_id','order_number','third_party_order_number','provider',
        'provider_id','channel_type','status_code','workorder_type','operator'] loop
      if r->k is not null and r->k<>'null'::jsonb and
        (jsonb_typeof(r->k)<>'string' or length(r->>k) not between 1 and 200
          or btrim(r->>k)<>r->>k or r->>k ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='NEWAR_INVALID_TEXT';
      end if;
    end loop;
    if r->>'source_id' is null or (r->>'status_code' is null and r->>'status_group'<>'unknown')
      or jsonb_typeof(r->'status_group')<>'string'
      or r->>'status_group' not in ('success','pending','failed','rejected','unknown')
      or (r->'currency' is not null and r->'currency'<>'null'::jsonb and
        (jsonb_typeof(r->'currency')<>'string' or r->>'currency' !~ '^[A-Z0-9]{3,8}$')) then
      raise exception using errcode='22023',message='NEWAR_INVALID_STATUS_OR_CURRENCY';
    end if;
    foreach k in array array['amount','actual_amount','fee'] loop
      if (k='amount' and r->>k is null) or (r->k is not null and r->k<>'null'::jsonb and
        (jsonb_typeof(r->k)<>'string' or r->>k !~ '^[0-9]{1,16}([.][0-9]{1,8})?$')) then
        raise exception using errcode='22023',message='NEWAR_INVALID_AMOUNT';
      end if;
    end loop;
    if r->'followup_count' is not null and r->'followup_count'<>'null'::jsonb and
      (jsonb_typeof(r->'followup_count')<>'number' or r->>'followup_count' !~ '^[0-9]{1,9}$') then
      raise exception using errcode='22023',message='NEWAR_INVALID_FOLLOWUP_COUNT';
    end if;
    foreach k in array array['created_at','success_at','processed_at','source_updated_at','captured_at'] loop
      v:=r->>k;
      if (k in ('created_at','captured_at') and v is null) or (v is not null and
        (jsonb_typeof(r->k)<>'string' or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+]00:00)$')) then
        raise exception using errcode='22023',message='NEWAR_INVALID_TIME';
      end if;
      begin v_time:=v::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023',message='NEWAR_INVALID_TIME';
      end;
      if v_time is not null and (not isfinite(v_time) or v_time<'2020-01-01Z'::timestamptz
        or v_time>clock_timestamp()+interval '5 minutes') then
        raise exception using errcode='22023',message='NEWAR_INVALID_TIME';
      end if;
    end loop;
    v_created:=(r->>'created_at')::timestamptz;v_captured:=(r->>'captured_at')::timestamptz;
    if v_created>v_captured+interval '5 minutes'
      or (r->>'success_at' is not null and (r->>'status_group'<>'success' or (r->>'success_at')::timestamptz<v_created))
      or (r->>'processed_at' is not null and (r->>'processed_at')::timestamptz<v_created) then
      raise exception using errcode='22023',message='NEWAR_INVALID_TIME_SEMANTICS';
    end if;
    if jsonb_typeof(r->'raw')<>'object' or octet_length((r->'raw')::text)>16384
      or ((r->'raw')-private.newar_detail_raw_keys())<>'{}'::jsonb
      or exists(select 1 from jsonb_each(r->'raw') x where jsonb_typeof(x.value) not in ('string','number','boolean','null')
        or (jsonb_typeof(x.value)='string' and length(x.value#>>'{}')>256)) then
      raise exception using errcode='22023',message='NEWAR_INVALID_RAW';
    end if;
  end loop;
  if (select count(distinct value->>'source_id') from jsonb_array_elements(p_batch->'records'))<>n then
    raise exception using errcode='22023',message='NEWAR_DUPLICATE_SOURCE_ID';
  end if;
end;
$$;

create function private.ingest_newar_detail_batch(p_token_hash text,p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  credential private.newar_detail_credentials%rowtype;
  receipt private.newar_detail_batches%rowtype;
  v_batch_id uuid; v_payload_hash text; received integer; written integer;
begin
  select * into credential from private.newar_detail_credentials where token_hash=p_token_hash for share;
  if not found or credential.revoked or credential.expires_at<=clock_timestamp() then
    raise exception using errcode='28000',message='NEWAR_AUTH_INVALID';
  end if;
  perform private.newar_detail_assert_batch(p_batch);
  if not credential.allowed_scopes @> jsonb_build_array(jsonb_build_object(
    'platform',p_batch->>'platform','dataset',p_batch->>'dataset')) then
    raise exception using errcode='42501',message='NEWAR_SCOPE_DENIED';
  end if;
  v_batch_id:=(p_batch->>'batch_id')::uuid;
  v_payload_hash:=encode(sha256(convert_to(p_batch::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('newar-detail-batch:'||v_batch_id::text,0));
  select * into receipt from private.newar_detail_batches b where b.batch_id=v_batch_id;
  if found then
    if receipt.payload_hash<>v_payload_hash then raise exception using errcode='23505',message='NEWAR_BATCH_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'batch_id',v_batch_id,'status','unchanged',
      'received_count',receipt.received_count,'written_count',receipt.written_count,'stale_count',receipt.stale_count);
  end if;
  received:=jsonb_array_length(p_batch->'records');
  insert into public.newar_detail_records as old (platform,dataset,source_id,member_id,order_number,third_party_order_number,
    provider,provider_id,channel_type,currency,amount,actual_amount,fee,status_code,status_group,created_at,success_at,
    processed_at,source_updated_at,captured_at,workorder_type,operator,followup_count,raw)
  select p_batch->>'platform',p_batch->>'dataset',r->>'source_id',r->>'member_id',r->>'order_number',r->>'third_party_order_number',
    r->>'provider',r->>'provider_id',r->>'channel_type',r->>'currency',(r->>'amount')::numeric,(r->>'actual_amount')::numeric,
    (r->>'fee')::numeric,r->>'status_code',r->>'status_group',(r->>'created_at')::timestamptz,(r->>'success_at')::timestamptz,
    (r->>'processed_at')::timestamptz,(r->>'source_updated_at')::timestamptz,(r->>'captured_at')::timestamptz,
    r->>'workorder_type',r->>'operator',(r->>'followup_count')::integer,r->'raw'
  from jsonb_array_elements(p_batch->'records') r order by r->>'source_id'
  on conflict(platform,dataset,source_id) do update set
    member_id=excluded.member_id,order_number=excluded.order_number,third_party_order_number=excluded.third_party_order_number,
    provider=excluded.provider,provider_id=excluded.provider_id,channel_type=excluded.channel_type,currency=excluded.currency,
    amount=excluded.amount,actual_amount=excluded.actual_amount,fee=excluded.fee,status_code=excluded.status_code,status_group=excluded.status_group,
    created_at=excluded.created_at,success_at=excluded.success_at,processed_at=excluded.processed_at,
    source_updated_at=excluded.source_updated_at,captured_at=excluded.captured_at,
    workorder_type=excluded.workorder_type,operator=excluded.operator,followup_count=excluded.followup_count,
    raw=excluded.raw,received_at=clock_timestamp()
  where (old.source_updated_at is null and (excluded.source_updated_at is not null or excluded.captured_at>=old.captured_at))
    or (old.source_updated_at is not null and excluded.source_updated_at is not null and
      (excluded.source_updated_at>old.source_updated_at or
       (excluded.source_updated_at=old.source_updated_at and excluded.captured_at>=old.captured_at)));
  get diagnostics written=row_count;
  insert into private.newar_detail_batches values(v_batch_id,v_payload_hash,p_batch->>'platform',p_batch->>'dataset',received,written,received-written,clock_timestamp());
  return jsonb_build_object('ok',true,'batch_id',v_batch_id,'status','accepted',
    'received_count',received,'written_count',written,'stale_count',received-written);
end;
$$;
create function public.ingest_newar_detail_batch(p_token_hash text,p_batch jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.ingest_newar_detail_batch(p_token_hash,p_batch)$$;
revoke all on function private.newar_detail_raw_keys(),private.newar_detail_assert_batch(jsonb),
  private.ingest_newar_detail_batch(text,jsonb),public.ingest_newar_detail_batch(text,jsonb) from public,anon,authenticated;
grant execute on function private.ingest_newar_detail_batch(text,jsonb),public.ingest_newar_detail_batch(text,jsonb) to service_role;

-- Single-platform AND single-dataset keyset search. No count-all, raw JSON, bank,
-- phone, IP, pictures or contact columns are returned. All amounts remain text.
create function private.dashboard_newar_detail_search(
  p_platform text,p_dataset text,p_start_at timestamptz,p_end_at timestamptz,
  p_basis text default 'created',p_filters jsonb default '{}',p_cursor jsonb default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  plat public.newar_detail_platforms%rowtype; scope jsonb; axis text; rows jsonb; more boolean;
  min_amount numeric;max_amount numeric; created_start timestamptz;created_end timestamptz;
  cursor_at timestamptz;cursor_id uuid;k text;
begin
  if (select auth.uid()) is null then raise exception using errcode='28000',message='请先登录'; end if;
  if p_platform is null or p_platform='' then raise exception using errcode='22023',message='请选择单个平台'; end if;
  if p_dataset is null or p_dataset not in ('charge','withdraw','workorder') then raise exception using errcode='22023',message='请选择一种记录类型'; end if;
  if public.dashboard_has_permission(case when p_dataset='workorder' then 'work_orders' else 'third_party' end) is not true then
    raise exception using errcode='42501',message='没有查询权限';
  end if;
  scope:=private.dashboard_current_data_scope();
  select * into plat from public.newar_detail_platforms p where p.platform=p_platform and p.enabled
    and private.dashboard_scope_allows(scope,p.country_code,p.platform);
  if not found then raise exception using errcode='42501',message='无权查看此平台'; end if;
  if p_basis is null or p_basis not in ('created','success','processed') or (p_basis='processed' and p_dataset<>'workorder')
    or p_start_at is null or p_end_at is null or not isfinite(p_start_at) or not isfinite(p_end_at)
    or p_start_at>=p_end_at or p_end_at-p_start_at>interval '31 days'
    or p_limit is null or p_limit not between 1 and 50
    or p_filters is null or jsonb_typeof(p_filters)<>'object'
    or (p_filters-array['member_id','order_number','provider','channel_type','status_group','amount_min','amount_max',
      'created_start','created_end','workorder_type','operator'])<>'{}'::jsonb then
    raise exception using errcode='22023',message='无效查询条件';
  end if;
  foreach k in array array['member_id','order_number','provider','channel_type','workorder_type','operator','status_group'] loop
    if p_filters->k is not null and p_filters->k<>'null'::jsonb and
      (jsonb_typeof(p_filters->k)<>'string' or length(p_filters->>k)>200) then
      raise exception using errcode='22023',message='无效搜索条件';
    end if;
  end loop;
  if p_filters->>'status_group' is not null and p_filters->>'status_group' not in ('success','pending','failed','rejected','unknown') then
    raise exception using errcode='22023',message='无效订单状态';
  end if;
  foreach k in array array['amount_min','amount_max'] loop
    if p_filters->k is not null and p_filters->k<>'null'::jsonb and
      (jsonb_typeof(p_filters->k)<>'string' or p_filters->>k !~ '^[0-9]{1,16}([.][0-9]{1,8})?$') then
      raise exception using errcode='22023',message='无效金额范围';
    end if;
  end loop;
  min_amount:=(p_filters->>'amount_min')::numeric;max_amount:=(p_filters->>'amount_max')::numeric;
  if min_amount>max_amount then raise exception using errcode='22023',message='无效金额范围'; end if;
  begin
    created_start:=(p_filters->>'created_start')::timestamptz;created_end:=(p_filters->>'created_end')::timestamptz;
    cursor_at:=(p_cursor->>'at')::timestamptz;cursor_id:=(p_cursor->>'id')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='无效时间或分页位置';
  end;
  if (created_start is not null and not isfinite(created_start)) or (created_end is not null and not isfinite(created_end))
    or created_start>=created_end or (p_basis='created' and (created_start is not null or created_end is not null))
    or (p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or (p_cursor-array['at','id'])<>'{}'::jsonb
      or cursor_at is null or cursor_id is null or not isfinite(cursor_at))) then
    raise exception using errcode='22023',message='无效时间或分页位置';
  end if;
  axis:=case p_basis when 'created' then 'created_at' when 'success' then 'success_at' else 'processed_at' end;
  execute format($query$
    select coalesce(jsonb_agg(to_jsonb(page) order by page.axis desc,page.id desc),'[]'::jsonb) from (
      select r.id,r.%1$I as axis,r.dataset,r.source_id,r.member_id,r.order_number,r.third_party_order_number,
        r.provider,r.provider_id,r.channel_type,r.currency,r.amount::text as amount,
        r.actual_amount::text as actual_amount,r.fee::text as fee,r.status_code,r.status_group,
        r.created_at,r.success_at,r.processed_at,r.source_updated_at,r.captured_at,
        r.workorder_type,r.operator,r.followup_count,
        coalesce((r.created_at at time zone $14)::date<(r.success_at at time zone $14)::date,false) as cross_day
      from public.newar_detail_records r
      where r.platform=$1 and r.dataset=$2 and r.%1$I >= $3 and r.%1$I < $4
        and ($5<>'success' or r.status_group='success')
        and ($6 is null or (r.%1$I,r.id)<($6,$7))
        and ($8 is null or r.amount >= $8) and ($9 is null or r.amount <= $9)
        and ($10 is null or r.created_at >= $10) and ($11 is null or r.created_at < $11)
        and ($12->>'member_id' is null or r.member_id=btrim($12->>'member_id'))
        and ($12->>'order_number' is null or r.order_number=btrim($12->>'order_number') or r.third_party_order_number=btrim($12->>'order_number') or r.source_id=btrim($12->>'order_number'))
        and ($12->>'provider' is null or r.provider=$12->>'provider')
        and ($12->>'channel_type' is null or r.channel_type=$12->>'channel_type')
        and ($12->>'status_group' is null or r.status_group=$12->>'status_group')
        and ($12->>'workorder_type' is null or r.workorder_type=$12->>'workorder_type')
        and ($12->>'operator' is null or r.operator=$12->>'operator')
      order by r.%1$I desc,r.id desc limit $13+1
    ) page
  $query$,axis) into rows using p_platform,p_dataset,p_start_at,p_end_at,p_basis,cursor_at,cursor_id,
    min_amount,max_amount,created_start,created_end,p_filters,p_limit,plat.timezone;
  more:=jsonb_array_length(rows)>p_limit;
  if more then rows:=rows-p_limit; end if;
  return jsonb_build_object('platform',plat.platform,'country_code',plat.country_code,'timezone',plat.timezone,
    'dataset',p_dataset,'basis',p_basis,'rows',rows,'hasMore',more,
    'nextCursor',case when more then jsonb_build_object('at',rows->-1->'axis','id',rows->-1->'id') end);
end;
$$;
create function public.dashboard_newar_detail_search(
  p_platform text,p_dataset text,p_start_at timestamptz,p_end_at timestamptz,
  p_basis text default 'created',p_filters jsonb default '{}',p_cursor jsonb default null,p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_newar_detail_search(p_platform,p_dataset,p_start_at,p_end_at,p_basis,p_filters,p_cursor,p_limit);
$$;
revoke all on function private.dashboard_newar_detail_search(text,text,timestamptz,timestamptz,text,jsonb,jsonb,integer),
  public.dashboard_newar_detail_search(text,text,timestamptz,timestamptz,text,jsonb,jsonb,integer) from public,anon;
grant execute on function private.dashboard_newar_detail_search(text,text,timestamptz,timestamptz,text,jsonb,jsonb,integer),
  public.dashboard_newar_detail_search(text,text,timestamptz,timestamptz,text,jsonb,jsonb,integer) to authenticated;
commit;
