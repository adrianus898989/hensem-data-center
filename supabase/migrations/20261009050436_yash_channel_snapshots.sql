-- Current source channel state only: no per-minute historical snapshot accumulation.
create table private.yash_channels (
 order_type text not null check(order_type in ('deposit','withdrawal')),
 channel_id text not null check(length(channel_id) between 1 and 200),
 channel_name text not null check(length(channel_name) between 1 and 200),
 provider text not null check(length(provider) between 1 and 200),
 channel_type text not null check(length(channel_type) between 1 and 200),
 payment_method text check(length(payment_method)<=200),
 min_amount numeric(24,8) check(min_amount>=0), max_amount numeric(24,8) check(max_amount>=min_amount),
 limit_currency text not null check(limit_currency ~ '^[A-Z0-9]{3,8}$'),
 success_rate_10m numeric(12,8) check(success_rate_10m between 0 and 100),
 success_rate_30m numeric(12,8) check(success_rate_30m between 0 and 100),
 success_rate_1h numeric(12,8) check(success_rate_1h between 0 and 100),
 success_rate_4h numeric(12,8) check(success_rate_4h between 0 and 100),
 success_rate_8h numeric(12,8) check(success_rate_8h between 0 and 100),
 success_rate_24h numeric(12,8) check(success_rate_24h between 0 and 100),
 success_rate_today numeric(12,8) check(success_rate_today between 0 and 100),
 success_rate_total numeric(12,8) check(success_rate_total between 0 and 100),
 balance numeric(24,8), balance_currency text check(balance_currency ~ '^[A-Z0-9]{3,8}$'),
 balance_threshold numeric(24,8) check(balance_threshold>=0),
 balance_threshold_currency text check(balance_threshold_currency ~ '^[A-Z0-9]{3,8}$'),
 required_deposit_count bigint check(required_deposit_count between 0 and 2147483647),
 priority bigint check(priority between 0 and 2147483647), weight bigint check(weight between 0 and 2147483647),
 status_text text not null check(length(status_text) between 1 and 200), enabled boolean,
 notes text check(length(notes)<=400), is_present boolean not null default true,
 observed_at timestamptz not null, received_at timestamptz not null default now(),
 first_seen_at timestamptz not null, last_seen_at timestamptz not null, config_changed_at timestamptz not null,
 primary key(order_type,channel_id)
);
create index yash_channels_provider_idx on private.yash_channels(order_type,is_present,provider);
create table private.yash_channel_sync_state (
 order_type text primary key check(order_type in ('deposit','withdrawal')),
 observed_at timestamptz not null, received_at timestamptz not null default now(),
 source_count integer not null check(source_count between 0 and 2000), snapshot_id uuid not null,
 payload_hash text not null
);
alter table private.yash_channels enable row level security;
alter table private.yash_channel_sync_state enable row level security;
revoke all on private.yash_channels,private.yash_channel_sync_state from public,anon,authenticated;
grant select,insert,update on private.yash_channels,private.yash_channel_sync_state to service_role;
create or replace function public.yash_channel_ingest(p_token_hash text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 t timestamptz:=clock_timestamp(); kind text; obs timestamptz; n integer; sid uuid; digest text;
 r jsonb; k text; v private.yash_channels; previous private.yash_channels; state private.yash_channel_sync_state;
begin
 if not exists(select 1 from private.yash_ingest_credentials c where c.token_hash=p_token_hash and c.revoked_at is null and c.expires_at>t) then
  raise exception 'YASH_UNAUTHORIZED' using errcode='28000';
 end if;
 if p_request->>'action' is distinct from 'channels' or p_request->>'schema_version' is distinct from '1'
  or jsonb_typeof(p_request->'records') is distinct from 'array'
  or exists(select 1 from jsonb_object_keys(p_request) x where x<>all(array['action','schema_version','snapshot_id','order_type','observed_at','source_count','fetched_count','records'])) then raise exception 'YASH_INVALID_REQUEST'; end if;
 kind:=p_request->>'order_type';obs:=(p_request->>'observed_at')::timestamptz;sid:=(p_request->>'snapshot_id')::uuid;
 n:=jsonb_array_length(p_request->'records');digest:=md5((p_request->'records')::text);
 if kind is null or kind not in ('deposit','withdrawal') or obs is null or obs<'2020-01-01'::timestamptz or obs>t+interval '5 minutes' or sid is null
  or n>2000 or (p_request->>'source_count')::integer is distinct from n or (p_request->>'fetched_count')::integer is distinct from n then raise exception 'YASH_INVALID_SNAPSHOT'; end if;
 if (select count(distinct x->>'channel_id') from jsonb_array_elements(p_request->'records') x)<>n then raise exception 'YASH_DUPLICATE_KEYS'; end if;
 -- Separate direction locks avoid blocking the order ingestion pipeline.
 perform pg_advisory_xact_lock(case kind when 'deposit' then 74910261011 else 74910261012 end::bigint);
 select * into state from private.yash_channel_sync_state where order_type=kind;
 if state.observed_at>obs then return jsonb_build_object('ok',true,'accepted',n,'source_count',n,'snapshot_applied',false); end if;
 if state.observed_at=obs then
  if state.payload_hash<>digest or state.source_count<>n then raise exception 'YASH_INVALID_SNAPSHOT_CONFLICT'; end if;
  return jsonb_build_object('ok',true,'accepted',n,'source_count',n,'snapshot_applied',true);
 end if;
 for r in select value from jsonb_array_elements(p_request->'records') loop
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'YASH_INVALID_RECORD'; end if;
  if exists(select 1 from jsonb_object_keys(r) x where x<>all(array['channel_id','channel_name','provider','channel_type','payment_method','min_amount','max_amount','limit_currency','success_rate_10m','success_rate_30m','success_rate_1h','success_rate_4h','success_rate_8h','success_rate_24h','success_rate_today','success_rate_total','balance','balance_currency','balance_threshold','balance_threshold_currency','required_deposit_count','priority','weight','status_text','enabled','notes'])) then raise exception 'YASH_INVALID_RECORD'; end if;
  foreach k in array array['channel_id','channel_name','provider','channel_type','status_text','limit_currency'] loop
   if jsonb_typeof(r->k) is distinct from 'string' or length(r->>k) not between 1 and 200 then raise exception 'YASH_INVALID_TEXT'; end if;
  end loop;
  foreach k in array array['channel_id','channel_name','provider','channel_type','payment_method','status_text','limit_currency','balance_currency','balance_threshold_currency','notes'] loop
   if r->>k is not null and (jsonb_typeof(r->k)<>'string' or length(r->>k)>(case when k='notes' then 400 else 200 end)
     or (k<>'notes' and ((r->>k)<>btrim(r->>k) or (r->>k) ~ '[[:cntrl:]]|<[^>]*>'))) then raise exception 'YASH_INVALID_TEXT'; end if;
  end loop;
  foreach k in array array['min_amount','max_amount','success_rate_10m','success_rate_30m','success_rate_1h','success_rate_4h','success_rate_8h','success_rate_24h','success_rate_today','success_rate_total','balance','balance_threshold'] loop
   if r->>k is not null and (jsonb_typeof(r->k)<>'string' or (r->>k)!~(case when k='balance' then '^-?[0-9]{1,16}(\.[0-9]{1,8})?$' else '^[0-9]{1,16}(\.[0-9]{1,8})?$' end)) then raise exception 'YASH_INVALID_NUMBER'; end if;
  end loop;
  foreach k in array array['required_deposit_count','priority','weight'] loop
   if r->>k is not null and (jsonb_typeof(r->k)<>'number' or (r->>k)!~'^[0-9]{1,10}$') then raise exception 'YASH_INVALID_INTEGER'; end if;
  end loop;
  if r->>'enabled' is not null and jsonb_typeof(r->'enabled')<>'boolean' then raise exception 'YASH_INVALID_STATUS'; end if;
  v:=jsonb_populate_record(null::private.yash_channels,r);v.order_type:=kind;
  -- Keep only business notes; source action HTML, links, contacts and credentials are excluded.
  v.notes:=regexp_replace(v.notes,'<[^>]*>','','g');
  v.notes:=regexp_replace(v.notes,'(https?://[^[:space:]]+|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[+]?[0-9][0-9 .()+-]{5,}[0-9])','[已移除联系方式]','gi');
  v.notes:=regexp_replace(v.notes,'(password|passwd|token|secret|cookie|密码|密钥)[[:space:]]*[:=：][^[:space:];；,，]+','[已移除凭据]','gi');
  select * into previous from private.yash_channels where order_type=kind and channel_id=v.channel_id;
  v.config_changed_at:=case when previous.channel_id is null or not previous.is_present or (to_jsonb(previous)-array['success_rate_10m','success_rate_30m','success_rate_1h','success_rate_4h','success_rate_8h','success_rate_24h','success_rate_today','success_rate_total','balance','observed_at','received_at','first_seen_at','last_seen_at','config_changed_at','is_present']) is distinct from (to_jsonb(v)-array['success_rate_10m','success_rate_30m','success_rate_1h','success_rate_4h','success_rate_8h','success_rate_24h','success_rate_today','success_rate_total','balance','observed_at','received_at','first_seen_at','last_seen_at','config_changed_at','is_present']) then obs else previous.config_changed_at end;
  insert into private.yash_channels (order_type,channel_id,channel_name,provider,channel_type,payment_method,min_amount,max_amount,limit_currency,success_rate_10m,success_rate_30m,success_rate_1h,success_rate_4h,success_rate_8h,success_rate_24h,success_rate_today,success_rate_total,balance,balance_currency,balance_threshold,balance_threshold_currency,required_deposit_count,priority,weight,status_text,enabled,notes,is_present,observed_at,received_at,first_seen_at,last_seen_at,config_changed_at)
  values (v.order_type,v.channel_id,v.channel_name,v.provider,v.channel_type,v.payment_method,v.min_amount,v.max_amount,v.limit_currency,v.success_rate_10m,v.success_rate_30m,v.success_rate_1h,v.success_rate_4h,v.success_rate_8h,v.success_rate_24h,v.success_rate_today,v.success_rate_total,v.balance,v.balance_currency,v.balance_threshold,v.balance_threshold_currency,v.required_deposit_count,v.priority,v.weight,v.status_text,v.enabled,v.notes,true,obs,t,coalesce(previous.first_seen_at,obs),obs,v.config_changed_at)
  on conflict(order_type,channel_id) do update set channel_name=excluded.channel_name,provider=excluded.provider,channel_type=excluded.channel_type,payment_method=excluded.payment_method,min_amount=excluded.min_amount,max_amount=excluded.max_amount,limit_currency=excluded.limit_currency,success_rate_10m=excluded.success_rate_10m,success_rate_30m=excluded.success_rate_30m,success_rate_1h=excluded.success_rate_1h,success_rate_4h=excluded.success_rate_4h,success_rate_8h=excluded.success_rate_8h,success_rate_24h=excluded.success_rate_24h,success_rate_today=excluded.success_rate_today,success_rate_total=excluded.success_rate_total,balance=excluded.balance,balance_currency=excluded.balance_currency,balance_threshold=excluded.balance_threshold,balance_threshold_currency=excluded.balance_threshold_currency,required_deposit_count=excluded.required_deposit_count,priority=excluded.priority,weight=excluded.weight,status_text=excluded.status_text,enabled=excluded.enabled,notes=excluded.notes,is_present=excluded.is_present,observed_at=excluded.observed_at,received_at=excluded.received_at,last_seen_at=excluded.last_seen_at,config_changed_at=excluded.config_changed_at;
 end loop;
 update private.yash_channels c set is_present=false,observed_at=obs,received_at=t,config_changed_at=obs
 where c.order_type=kind and c.is_present and not exists(select 1 from jsonb_array_elements(p_request->'records') x where x->>'channel_id'=c.channel_id);
 insert into private.yash_channel_sync_state(order_type,observed_at,received_at,source_count,snapshot_id,payload_hash)
 values(kind,obs,t,n,sid,digest) on conflict(order_type) do update set observed_at=excluded.observed_at,received_at=excluded.received_at,source_count=excluded.source_count,snapshot_id=excluded.snapshot_id,payload_hash=excluded.payload_hash;
 return jsonb_build_object('ok',true,'accepted',n,'source_count',n,'snapshot_applied',true);
end $$;
revoke all on function public.yash_channel_ingest(text,jsonb) from public,anon,authenticated;
grant execute on function public.yash_channel_ingest(text,jsonb) to service_role;
notify pgrst,'reload schema';
