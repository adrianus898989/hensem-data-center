-- Independent NEWAR business snapshot transport. Legacy Google records stay intact.
begin;
create table private.newar_business_credentials (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  allowed_scopes jsonb not null check(jsonb_typeof(allowed_scopes)='array'),
  expires_at timestamptz not null, revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create table private.newar_business_batches (
  batch_id uuid primary key, payload_hash text not null,
  platform text not null, kind text not null, receipt jsonb not null,
  received_at timestamptz not null default now()
);
create table public.newar_business_snapshots (
  kind text not null check(kind in ('third_party_volume','auto_withdraw_bundle','workorder_daily_bundle')),
  platform text not null check(platform in ('POPZAR','DhaniWin','92BLAZE')),
  country_code text not null, country text not null, stat_date date not null,
  direction text not null check(direction in ('charge','withdraw','all')),
  captured_at timestamptz not null, payload jsonb not null,
  component_captured_at jsonb not null, updated_at timestamptz not null default now(),
  primary key(kind,platform,stat_date,direction)
);
create index newar_business_dates_idx on public.newar_business_snapshots(kind,stat_date,platform);
alter table private.newar_business_credentials enable row level security;
alter table private.newar_business_batches enable row level security;
alter table public.newar_business_snapshots enable row level security;
revoke all on private.newar_business_credentials,private.newar_business_batches,public.newar_business_snapshots from public,anon,authenticated;
grant usage on schema private to service_role;

create function private.newar_business_receipt_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='NEWAR_BUSINESS_RECEIPT_IMMUTABLE'; end;
$$;
create trigger newar_business_receipt_immutable before update or delete on private.newar_business_batches
  for each row execute function private.newar_business_receipt_immutable();
revoke all on function private.newar_business_receipt_immutable() from public,anon,authenticated;

create function private.newar_business_row_keys(p_kind text,p_field text) returns text[]
language sql immutable set search_path='' as $$
  select array['stat_date','system_name','country','country_code','platform']::text[] || case
  when p_kind='third_party_volume' and p_field='rows' then array['biz_type','biz_label','type','third_party','mapping_code','mappingCode','map_code','mapping','pay_method','payMethod','映射码','success_count','success_amount','total_count','total_amount','failed_count','success_rate','count','amount','updated_at']
  when p_kind='auto_withdraw_bundle' and p_field='rows' then array['total_count','success_count','reject_count','auto_count','manual_count','total_handle_seconds','handle_count']
  when p_kind='auto_withdraw_bundle' and p_field='operator_rows' then array['operator','processed_count','reject_count','total_handle_seconds','handle_count']
  when p_kind='workorder_daily_bundle' then array['total_count','pending_count','in_progress_count','system_processing_count','completed_count','rejected_count','one_to_one_count','total_conversation_count','total_conversation_rate_text','total_message_count','avg_conversation_duration_text','avg_first_response_time_text','account_type','employee_id','employee_name','order_type','order_name','one_to_one_work_order_count','total_sation_duration_text','first_response_time_text']
  else array[]::text[] end;
$$;
create function private.newar_business_fields(p_kind text) returns text[] language sql immutable set search_path='' as $$
  select case p_kind when 'third_party_volume' then array['rows'] when 'auto_withdraw_bundle' then array['rows','operator_rows']
    when 'workorder_daily_bundle' then array['rows','employee_rows','type_rows'] else array[]::text[] end;
$$;
create function private.newar_business_assert_batch(p_batch jsonb) returns void language plpgsql set search_path='' as $$
declare
  kind text; platform text; payload jsonb; field text; row jsonb; k text; v jsonb;
  stat_date date; captured timestamptz; zone text; country text; country_code text;
  total integer:=0; seen text[]; identity text;
begin
  if jsonb_typeof(p_batch) is distinct from 'object' or octet_length(p_batch::text)>2000000
    or not(p_batch ?& array['action','kind','batch_id','platform','captured_at','payload'])
    or (p_batch-array['action','kind','batch_id','platform','captured_at','snapshot_at','payload'])<>'{}'::jsonb
    or p_batch->>'action' is distinct from 'ingest' or jsonb_typeof(p_batch->'batch_id') is distinct from 'string'
    or p_batch->>'batch_id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    or jsonb_typeof(p_batch->'kind') is distinct from 'string' or jsonb_typeof(p_batch->'platform') is distinct from 'string'
    or jsonb_typeof(p_batch->'payload') is distinct from 'object' then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_BATCH';
  end if;
  kind:=p_batch->>'kind';platform:=p_batch->>'platform';payload:=p_batch->'payload';
  if kind not in ('third_party_volume','auto_withdraw_bundle','workorder_daily_bundle') or platform not in ('POPZAR','DhaniWin','92BLAZE') then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_SCOPE';
  end if;
  zone:=case platform when 'DhaniWin' then 'Asia/Kolkata' else 'Asia/Karachi' end;
  country:=case platform when 'DhaniWin' then '印度' else '巴基斯坦' end;
  country_code:=case platform when 'DhaniWin' then 'IN' else 'PK' end;
  if jsonb_typeof(p_batch->'captured_at') is distinct from 'string'
    or p_batch->>'captured_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+]00:00)$'
    or (p_batch ? 'snapshot_at' and p_batch->'snapshot_at' is distinct from p_batch->'captured_at') then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TIME';
  end if;
  begin captured:=(p_batch->>'captured_at')::timestamptz;
  exception when others then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TIME'; end;
  if not isfinite(captured) or captured<'2020-01-01Z'::timestamptz or captured>clock_timestamp()+interval '5 minutes'
    or (platform='92BLAZE' and (captured<'2026-09-21T19:00:00Z'::timestamptz or clock_timestamp()<'2026-09-21T19:00:00Z'::timestamptz)) then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_LAUNCH_OR_TIME';
  end if;
  if (payload-(private.newar_business_fields(kind)||array['action','source','system_name','third_party_rows']))<>'{}'::jsonb
    or (kind<>'third_party_volume' and payload ? 'third_party_rows')
    or (payload ? 'third_party_rows' and payload->'third_party_rows' is distinct from payload->'rows') then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_PAYLOAD';
  end if;
  foreach k in array array['action','source','system_name'] loop
    if payload ? k and (jsonb_typeof(payload->k) is distinct from 'string' or length(payload->>k)>200 or payload->>k ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_PAYLOAD';
    end if;
  end loop;
  foreach field in array private.newar_business_fields(kind) loop
    if jsonb_typeof(payload->field) is distinct from 'array' or jsonb_array_length(payload->field)>5000 then
      raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_ROWS';
    end if;
    seen:=array[]::text[];total:=total+jsonb_array_length(payload->field);
    for row in select value from jsonb_array_elements(payload->field) loop
      if jsonb_typeof(row) is distinct from 'object' or (row-private.newar_business_row_keys(kind,field))<>'{}'::jsonb
        or not(row ?& array['stat_date','platform','system_name','country'])
        or row->>'platform' is distinct from platform or row->>'country' is distinct from country
        or (row ? 'country_code' and row->>'country_code' is distinct from country_code)
        or jsonb_typeof(row->'stat_date') is distinct from 'string' or row->>'stat_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_ROW';
      end if;
      begin stat_date:=(row->>'stat_date')::date;
      exception when others then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_DATE'; end;
      if stat_date<'2020-01-01'::date or stat_date>(captured at time zone zone)::date
        or (platform='92BLAZE' and stat_date<'2026-09-22'::date) then
        raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_LAUNCH_OR_DATE';
      end if;
      for k,v in select * from jsonb_each(row) loop
        if k ~ '(_count|_seconds)$' or k in ('count','amount','total_amount','success_amount','success_rate') then
          if jsonb_typeof(v) is distinct from 'number' or (v::text)::numeric<0 or (v::text)::numeric>9007199254740991
            or (k ~ '_count$' or k='count') and trunc((v::text)::numeric)<>(v::text)::numeric
            or k='success_rate' and (v::text)::numeric>1 then
            raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_NUMBER';
          end if;
        elsif jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>500 or v#>>'{}' ~ '[[:cntrl:]]' then
          raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TEXT';
        end if;
      end loop;
      if nullif(btrim(row->>'system_name'),'') is null then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_ROW'; end if;
      if kind='workorder_daily_bundle' and not(row ?& (case when field='rows' then
        array['total_count','pending_count','in_progress_count','system_processing_count','completed_count','rejected_count','one_to_one_count',
          'total_conversation_count','total_conversation_rate_text','total_message_count','avg_conversation_duration_text','avg_first_response_time_text']
        else array['account_type','employee_id','employee_name','order_type','order_name','total_count','in_progress_count','completed_count','rejected_count',
          'one_to_one_work_order_count','total_conversation_count','total_conversation_rate_text','total_message_count','avg_conversation_duration_text',
          'avg_first_response_time_text','total_sation_duration_text','first_response_time_text'] end)) then
        raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_WORKORDER_FIELDS';
      end if;
      if kind='third_party_volume' then
        if not(row ?& array['biz_type','third_party','mapping_code','success_count','success_amount','total_count','total_amount','failed_count','success_rate','count','amount'])
          or row->>'biz_type' not in ('recharge','withdraw') or nullif(btrim(row->>'third_party'),'') is null
          or (row->>'success_count')::numeric>(row->>'total_count')::numeric
          or (row->>'failed_count')::numeric<>(row->>'total_count')::numeric-(row->>'success_count')::numeric
          or row->'count'<>row->'success_count' or row->'amount'<>row->'success_amount'
          or (row->>'success_amount')::numeric>(row->>'total_amount')::numeric then
          raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TOTALS';
        end if;
        identity:=jsonb_build_array(stat_date,row->>'biz_type',row->>'third_party',row->>'mapping_code')::text;
      elsif kind='auto_withdraw_bundle' and field='operator_rows' then
        if not(row ?& array['operator','processed_count','reject_count','total_handle_seconds','handle_count']) or nullif(btrim(row->>'operator'),'') is null then
          raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_OPERATOR';
        end if;
        identity:=jsonb_build_array(stat_date,row->>'operator')::text;
      elsif kind='workorder_daily_bundle' and field<>'rows' then
        if not(row ?& array['employee_name','order_type','order_name','total_count']) then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_EMPLOYEE_OR_TYPE'; end if;
        identity:=jsonb_build_array(stat_date,row->>'employee_name',row->>'order_type',row->>'order_name',row->>'account_type',row->>'employee_id')::text;
      else
        if not(row ? 'total_count') then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TOTALS'; end if;
        if kind='auto_withdraw_bundle' and not(row ?& array['success_count','reject_count','auto_count','manual_count','total_handle_seconds','handle_count']) then
          raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TOTALS';
        end if;
        identity:=stat_date::text;
      end if;
      if identity=any(seen) then raise exception using errcode='22023',message='NEWAR_BUSINESS_DUPLICATE_ROW'; end if;
      seen:=array_append(seen,identity);
    end loop;
  end loop;
  if total not between 1 and 10000 then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_SIZE'; end if;
end;
$$;

create function private.ingest_newar_business_batch(p_token_hash text,p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  credential private.newar_business_credentials%rowtype; receipt private.newar_business_batches%rowtype;
  old public.newar_business_snapshots%rowtype; v_id uuid; v_hash text; v_kind text; v_platform text;
  v_at timestamptz; field text; part jsonb; body jsonb; clocks jsonb; counts jsonb:='{}'; scope record;
  existing_at timestamptz; changed boolean; writes integer:=0; ack jsonb; country text; country_code text;
begin
  select * into credential from private.newar_business_credentials where token_hash=p_token_hash for share;
  if not found or credential.revoked or credential.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='NEWAR_BUSINESS_AUTH_INVALID'; end if;
  perform private.newar_business_assert_batch(p_batch);
  v_kind:=p_batch->>'kind';v_platform:=p_batch->>'platform';v_at:=(p_batch->>'captured_at')::timestamptz;
  if not credential.allowed_scopes @> jsonb_build_array(jsonb_build_object('platform',v_platform,'kind',v_kind)) then
    raise exception using errcode='42501',message='NEWAR_BUSINESS_SCOPE_DENIED';
  end if;
  v_id:=(p_batch->>'batch_id')::uuid;v_hash:=encode(sha256(convert_to(p_batch::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('newar-business-batch:'||v_id::text,0));
  select * into receipt from private.newar_business_batches where batch_id=v_id;
  if found then
    if receipt.payload_hash<>v_hash then raise exception using errcode='23505',message='NEWAR_BUSINESS_BATCH_CONFLICT'; end if;
    return receipt.receipt||jsonb_build_object('status','unchanged');
  end if;
  country:=case v_platform when 'DhaniWin' then '印度' else '巴基斯坦' end;
  country_code:=case v_platform when 'DhaniWin' then 'IN' else 'PK' end;
  foreach field in array array['rows','operator_rows','employee_rows','type_rows'] loop
    counts:=counts||jsonb_build_object(field,case when p_batch->'payload' ? field then jsonb_array_length(p_batch->'payload'->field) else 0 end);
  end loop;
  for scope in
    select distinct (r.value->>'stat_date')::date as day,
      case when v_kind='third_party_volume' then case r.value->>'biz_type' when 'recharge' then 'charge' else 'withdraw' end else 'all' end as direction
    from unnest(private.newar_business_fields(v_kind)) f cross join lateral jsonb_array_elements(p_batch->'payload'->f) r
    order by 1,2
  loop
    perform pg_advisory_xact_lock(hashtextextended('newar-business-scope:'||jsonb_build_array(v_kind,v_platform,scope.day,scope.direction)::text,0));
    select * into old from public.newar_business_snapshots s where s.kind=v_kind and s.platform=v_platform and s.stat_date=scope.day and s.direction=scope.direction for update;
    body:=coalesce(old.payload,'{}');clocks:=coalesce(old.component_captured_at,'{}');changed:=false;
    foreach field in array private.newar_business_fields(v_kind) loop
      select coalesce(jsonb_agg(value),'[]') into part from jsonb_array_elements(p_batch->'payload'->field)
        where (value->>'stat_date')::date=scope.day and (v_kind<>'third_party_volume' or
          case value->>'biz_type' when 'recharge' then 'charge' else 'withdraw' end=scope.direction);
      -- A day-level primary row makes its empty auxiliary arrays authoritative.
      -- An operator-only repair never erases the already collected daily row.
      if jsonb_array_length(part)=0 and (field='rows' or not exists(
        select 1 from jsonb_array_elements(p_batch#>'{payload,rows}') r where (r->>'stat_date')::date=scope.day)) then continue; end if;
      existing_at:=(clocks->>field)::timestamptz;
      if existing_at=v_at and body->field is distinct from part then raise exception using errcode='23505',message='NEWAR_BUSINESS_SNAPSHOT_CONFLICT'; end if;
      if existing_at is null or existing_at<v_at then
        body:=body||jsonb_build_object(field,part);clocks:=clocks||jsonb_build_object(field,v_at);changed:=true;
      end if;
    end loop;
    if changed then
      if old.captured_at is null or v_at>=old.captured_at then
        body:=body||((p_batch->'payload')-array['rows','third_party_rows','operator_rows','employee_rows','type_rows']);
      end if;
      if v_kind='third_party_volume' then body:=body||jsonb_build_object('third_party_rows',body->'rows'); end if;
      insert into public.newar_business_snapshots(kind,platform,country_code,country,stat_date,direction,captured_at,payload,component_captured_at)
        values(v_kind,v_platform,country_code,country,scope.day,scope.direction,greatest(old.captured_at,v_at),body,clocks)
        on conflict(kind,platform,stat_date,direction) do update set captured_at=excluded.captured_at,payload=excluded.payload,component_captured_at=excluded.component_captured_at,updated_at=clock_timestamp();
      writes:=writes+1;
    end if;
  end loop;
  ack:=jsonb_build_object('ok',true,'batch_id',v_id,'kind',v_kind,'platform',v_platform,
    'status',case when writes>0 then 'accepted' else 'unchanged' end,'counts',counts,'operator_insert',0,'operator_update',counts->'operator_rows');
  insert into private.newar_business_batches(batch_id,payload_hash,platform,kind,receipt) values(v_id,v_hash,v_platform,v_kind,ack);
  return ack;
end;
$$;
create function public.ingest_newar_business_batch(p_token_hash text,p_batch jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.ingest_newar_business_batch(p_token_hash,p_batch); $$;
revoke all on function private.newar_business_row_keys(text,text),private.newar_business_fields(text),private.newar_business_assert_batch(jsonb),private.ingest_newar_business_batch(text,jsonb),public.ingest_newar_business_batch(text,jsonb) from public,anon,authenticated;
grant execute on function private.ingest_newar_business_batch(text,jsonb),public.ingest_newar_business_batch(text,jsonb) to service_role;

create function private.dashboard_newar_business_snapshots(p_kind text,p_start date,p_end date,p_country text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare scope jsonb; data jsonb; module text;
begin
  if (select auth.uid()) is null then raise exception using errcode='28000',message='请先登录'; end if;
  module:=case p_kind when 'third_party_volume' then 'third_party' when 'auto_withdraw_bundle' then 'auto_withdraw' when 'workorder_daily_bundle' then 'work_orders' end;
  if module is null or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start or p_end-p_start>365 or p_country is null then
    raise exception using errcode='22023',message='无效业务日期范围';
  end if;
  if public.dashboard_has_permission(module) is not true then raise exception using errcode='42501',message='没有查询权限'; end if;
  scope:=private.dashboard_current_data_scope();
  select coalesce(jsonb_agg(jsonb_build_object('kind',s.kind,'platform',s.platform,'country_code',s.country_code,'country',s.country,
    'stat_date',s.stat_date,'direction',s.direction,'captured_at',s.captured_at,'payload',s.payload) order by s.stat_date,s.platform,s.direction),'[]') into data
  from public.newar_business_snapshots s where s.kind=p_kind and s.stat_date between p_start and p_end
    and (p_country='' or p_country=s.country_code or p_country=s.country)
    and private.dashboard_scope_allows(scope,s.country_code,s.platform);
  if octet_length(data::text)>8388608 then raise exception using errcode='54000',message='业务查询范围过大'; end if;
  return jsonb_build_object('source','newar_direct','snapshots',data);
end;
$$;
create function public.dashboard_newar_business_snapshots(p_kind text,p_start date,p_end date,p_country text default '') returns jsonb
language sql stable security invoker set search_path='' as $$ select private.dashboard_newar_business_snapshots(p_kind,p_start,p_end,p_country); $$;
revoke all on function private.dashboard_newar_business_snapshots(text,date,date,text),public.dashboard_newar_business_snapshots(text,date,date,text) from public,anon;
grant execute on function private.dashboard_newar_business_snapshots(text,date,date,text),public.dashboard_newar_business_snapshots(text,date,date,text) to authenticated;
notify pgrst,'reload schema';
commit;
