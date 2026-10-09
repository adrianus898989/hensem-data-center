-- Dedicated AR middle-platform channel snapshots. No payment/source writes.
-- Credentials are provisioned separately: only SHA-256 hashes belong in SQL.
begin;
create table private.ar_middle_channel_platforms (
 source_origin text not null check(source_origin='https://m8-admin.payplatform-manager.com'),
 source_tenant_id text not null check(source_tenant_id ~ '^[0-9]{1,18}$'),
 dashboard_platform_id uuid not null unique,
 country_code text not null check(country_code ~ '^[A-Z]{2}$'),
 native_platform text not null check(length(native_platform) between 1 and 200),
 enabled boolean not null default true,
 verified_at timestamptz not null default clock_timestamp(),
 primary key(source_origin,source_tenant_id)
);
-- Native getTenantFlatList evidence plus the prior PLATFORM_TENANT_ID_MAP and
-- current exact registry confirm these 40 bindings. 1040 "pop" stays unbound:
-- historical POPBRA uses tenant 3044, so no alias can attach it to this ID.
-- Select exact native tuples; never mint IDs from display names or aliases.
insert into private.ar_middle_channel_platforms(source_origin,source_tenant_id,dashboard_platform_id,country_code,native_platform)
select 'https://m8-admin.payplatform-manager.com',v.tenant,md5('ar:'||t.country_code||':'||t.platform)::uuid,t.country_code,t.platform
from (values
 ('1102','IN','Veer.Game'),('1093','IN','JAICLUB'),('1031','IN','IN999'),('1023','IN','51GAME'),('1041','IN','BIGMUMBAI'),
 ('1008','IN','RAJA'),('1101','IN','Shree.Win'),('1016','IN','TPPLAY'),('1001','IN','82LOTTERY'),('1064','IN','6CLUB'),
 ('1014','IN','LOTTERY7'),('1048','IN','91CLUB'),('1077','IN','JALWA'),('1013','IN','OKWIN'),('1021','IN','55CLUB'),
 ('1076','PK','92GO'),('1092','PK','YAYWIN'),('1072','PK','92DADU'),('1069','PK','92R'),('1078','PK','92COCO'),
 ('1067','PK','92PKR'),('1087','PK','92GLORY'),('1099','PK','92.GAME'),('1090','PK','92STRIKE'),('1089','PK','92STAR'),
 ('1074','BR','POPLUA'),('1082','BR','POPCEU'),('1003','BR','POPPG'),('1002','BR','POP678'),('1080','BR','POPBEM'),
 ('1038','BR','POP888'),('1019','BR','POP555'),('1045','ID','55FIVE'),('1035','VN','82VN'),('1042','VN','66CLUB'),
 ('1036','VN','VN168'),('1043','VN','92LOTTERY'),('1044','MM','6LOTTERY'),('1046','MY','MZPLAY'),('1004','NG','FB999')
)v(tenant,country_code,native_name)
join public.ar_config_targets t on t.source_system='AR' and t.country_code=v.country_code and t.platform=v.native_name
where exists(select 1 from private.collector_platform_identities i where i.platform_id=md5('ar:'||t.country_code||':'||t.platform)::uuid
 and i.source_system='AR' and i.country_code=t.country_code and i.source_platform=t.platform);
do $verified$ begin
 if (select count(*) from private.ar_middle_channel_platforms)<>40 then raise exception 'AR_MIDDLE_NATIVE_REGISTRY_DRIFT';end if;
end $verified$;

create table private.ar_middle_channel_ingest_credentials (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 source_origin text not null check(source_origin='https://m8-admin.payplatform-manager.com'),
 allowed_tenant_ids text[] not null check(cardinality(allowed_tenant_ids) between 1 and 500),
 action_scope text not null default 'channels' check(action_scope='channels'),
 label text not null check(length(label) between 1 and 200),
 expires_at timestamptz not null,revoked_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create table private.ar_middle_channels (
 source_origin text not null,source_tenant_id text not null,
 order_type text not null check(order_type in ('deposit','withdrawal')),
 channel_id text not null check(length(channel_id) between 1 and 200),
 channel_data jsonb not null check(jsonb_typeof(channel_data)='object'),
 is_present boolean not null default true,
 snapshot_id uuid not null,observed_at timestamptz not null,received_at timestamptz not null,
 first_seen_at timestamptz not null,last_seen_at timestamptz not null,config_changed_at timestamptz not null,
 primary key(source_origin,source_tenant_id,order_type,channel_id),
 foreign key(source_origin,source_tenant_id) references private.ar_middle_channel_platforms(source_origin,source_tenant_id)
);
create index ar_middle_channels_present_idx on private.ar_middle_channels(source_origin,source_tenant_id,order_type,is_present);
create table private.ar_middle_channel_sync_state (
 source_origin text not null,source_tenant_id text not null,
 order_type text not null check(order_type in ('deposit','withdrawal')),
 snapshot_id uuid not null,captured_at timestamptz not null,
 observed_at timestamptz not null,received_at timestamptz not null,
 source_count integer not null check(source_count between 0 and 10000),
 page_count integer not null check(page_count between 1 and 1000),
 payload_hash text not null,
 primary key(source_origin,source_tenant_id,order_type),
 foreign key(source_origin,source_tenant_id) references private.ar_middle_channel_platforms(source_origin,source_tenant_id)
);
alter table private.ar_middle_channel_platforms enable row level security;
alter table private.ar_middle_channel_ingest_credentials enable row level security;
alter table private.ar_middle_channels enable row level security;
alter table private.ar_middle_channel_sync_state enable row level security;
revoke all on private.ar_middle_channel_platforms,private.ar_middle_channel_ingest_credentials,private.ar_middle_channels,private.ar_middle_channel_sync_state from public,anon,authenticated,service_role;
grant select on private.ar_middle_channel_platforms,private.ar_middle_channel_ingest_credentials to service_role;
grant select,insert,update on private.ar_middle_channels,private.ar_middle_channel_sync_state to service_role;

create or replace function private.ar_middle_channel_clean_record(p_record jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $clean$
declare k text;r jsonb:=p_record;notes text;category jsonb;category_ids text[]:=array[]::text[];
 text_keys constant text[]:=array['channel_id','channel_name','provider','channel_type','payment_method','status_text','category_id','category_name','source_state','source_channel_state','source_merchant_state','sys_channel_id','third_pay_merchant_id','source_channel_name'];
 money_keys constant text[]:=array['min_amount','max_amount','balance','balance_threshold','weight','fee_rate','fee_amount','success_rate_15m','success_rate_30m','success_rate_1h','success_rate_4h','success_rate_8h','success_rate_24h','success_rate_today','success_rate_total'];
 unsafe_label constant text:='([a-z][a-z0-9+.-]*://|(javascript|data):|bearer[[:space:]]+[^[:space:]]|(password|passwd|token|secret|cookie|api[_-]?key|authorization|密码|密钥)[[:space:]]*[:=：][[:space:]]*[^[:space:]])';
begin
 if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r)x where x<>all(text_keys||money_keys||array['limit_currency','balance_currency','balance_threshold_currency','required_deposit_count','priority','source_position','enabled','notes','source_updated_at','fee_rate_basis','channel_categories'])) then raise exception 'AR_MIDDLE_INVALID_RECORD';end if;
 foreach k in array array['channel_id','channel_name','status_text'] loop
  if jsonb_typeof(r->k) is distinct from 'string' or length(r->>k) not between 1 and 200 then raise exception 'AR_MIDDLE_INVALID_TEXT';end if;
 end loop;
 foreach k in array text_keys loop
  if r->>k is not null and (jsonb_typeof(r->k)<>'string' or length(r->>k) not between 1 and 200 or r->>k<>btrim(r->>k) or r->>k ~ '[[:cntrl:]]|<[^>]*>') then raise exception 'AR_MIDDLE_INVALID_TEXT';end if;
 end loop;
 if r->>'source_channel_name' ~* unsafe_label then raise exception 'AR_MIDDLE_INVALID_SOURCE_LABEL';end if;
 -- Optional for previous collectors. Preserve every source category in its original order.
 if r->'channel_categories' is not null and jsonb_typeof(r->'channel_categories')<>'null' then
  if jsonb_typeof(r->'channel_categories')<>'array' then raise exception 'AR_MIDDLE_INVALID_CATEGORIES';end if;
  if jsonb_array_length(r->'channel_categories')>1000 then raise exception 'AR_MIDDLE_INVALID_CATEGORIES';end if;
  for category in select value from jsonb_array_elements(r->'channel_categories') loop
   if jsonb_typeof(category) is distinct from 'object' then raise exception 'AR_MIDDLE_INVALID_CATEGORIES';end if;
   if not category ?& array['category_id','category_name','sort'] or exists(select 1 from jsonb_object_keys(category)x where x<>all(array['category_id','category_name','sort'])) then raise exception 'AR_MIDDLE_INVALID_CATEGORIES';end if;
   if jsonb_typeof(category->'category_id') is distinct from 'string' or category->>'category_id'=any(category_ids) then raise exception 'AR_MIDDLE_INVALID_CATEGORIES';end if;
   foreach k in array array['category_id','category_name'] loop
    if category->>k is not null and (jsonb_typeof(category->k)<>'string' or length(category->>k) not between 1 and 200 or category->>k<>btrim(category->>k) or category->>k ~ '[[:cntrl:]]|<[^>]*>' or category->>k ~* unsafe_label) then raise exception 'AR_MIDDLE_INVALID_SOURCE_LABEL';end if;
   end loop;
   if category->>'sort' is not null and (jsonb_typeof(category->'sort')<>'number' or category->>'sort' !~ '^-?[0-9]{1,10}$' or (category->>'sort')::numeric not between -2147483648 and 2147483647) then raise exception 'AR_MIDDLE_INVALID_CATEGORIES';end if;
   category_ids:=array_append(category_ids,category->>'category_id');
  end loop;
 end if;
 foreach k in array money_keys loop
  if r->>k is not null and (jsonb_typeof(r->k)<>'string' or r->>k !~ (case when k='balance' then '^-?[0-9]{1,16}(\.[0-9]{1,8})?$' else '^[0-9]{1,16}(\.[0-9]{1,8})?$' end)) then raise exception 'AR_MIDDLE_INVALID_NUMBER';end if;
  if k like 'success_rate_%' and r->>k is not null and (r->>k)::numeric>100 then raise exception 'AR_MIDDLE_INVALID_RATE';end if;
 end loop;
 if r->>'min_amount' is not null and r->>'max_amount' is not null and (r->>'min_amount')::numeric>(r->>'max_amount')::numeric then raise exception 'AR_MIDDLE_INVALID_LIMIT';end if;
 foreach k in array array['required_deposit_count','priority','source_position'] loop
  if r->>k is not null and (jsonb_typeof(r->k)<>'number' or r->>k !~ '^[0-9]{1,10}$' or (r->>k)::numeric>2147483647) then raise exception 'AR_MIDDLE_INVALID_INTEGER';end if;
 end loop;
 foreach k in array array['limit_currency','balance_currency','balance_threshold_currency'] loop
  if r->>k is not null and (jsonb_typeof(r->k)<>'string' or r->>k !~ '^[A-Z0-9]{3,8}$') then raise exception 'AR_MIDDLE_INVALID_CURRENCY';end if;
 end loop;
 if r->>'enabled' is not null and jsonb_typeof(r->'enabled')<>'boolean' then raise exception 'AR_MIDDLE_INVALID_STATUS';end if;
 if r->>'fee_rate' is not null then
  if r->>'fee_rate_basis' is distinct from 'source_raw' then raise exception 'AR_MIDDLE_INVALID_FEE_BASIS';end if;
 elsif r->>'fee_rate_basis' is not null then raise exception 'AR_MIDDLE_INVALID_FEE_BASIS';end if;
 if r->>'source_updated_at' is not null and (jsonb_typeof(r->'source_updated_at')<>'string' or r->>'source_updated_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|\+00:00)$' or (r->>'source_updated_at')::timestamptz<'2020-01-01'::timestamptz) then raise exception 'AR_MIDDLE_INVALID_TIME';end if;
 if r->>'notes' is not null and (jsonb_typeof(r->'notes')<>'string' or length(r->>'notes')>400) then raise exception 'AR_MIDDLE_INVALID_TEXT';end if;
 notes:=regexp_replace(r->>'notes','<[^>]*>','','g');
 notes:=regexp_replace(notes,'(https?://[^[:space:]]+|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[+]?[0-9][0-9 .()+-]{5,}[0-9])','[已移除联系方式]','gi');
 notes:=regexp_replace(notes,'(password|passwd|token|secret|cookie|密码|密钥)[[:space:]]*[:=：][^[:space:];；,，]+','[已移除凭据]','gi');
 return r||jsonb_build_object('notes',nullif(btrim(notes),''));
end $clean$;
revoke all on function private.ar_middle_channel_clean_record(jsonb) from public,anon,authenticated;
grant execute on function private.ar_middle_channel_clean_record(jsonb) to service_role;

create function public.ar_middle_channel_ingest(p_token_hash text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $ingest$
declare t timestamptz:=clock_timestamp();origin text;tenant text;sid uuid;captured timestamptz;obs timestamptz;d jsonb;r jsonb;clean jsonb;kind text;n integer;total integer:=0;digest text;state private.ar_middle_channel_sync_state;previous private.ar_middle_channels;changed timestamptz;direction_count integer;
 volatile_keys constant text[]:=array['balance','source_updated_at','success_rate_15m','success_rate_30m','success_rate_1h','success_rate_4h','success_rate_8h','success_rate_24h','success_rate_today','success_rate_total'];
begin
 origin:=p_request->>'source_origin';tenant:=p_request->>'source_tenant_id';
 if not exists(select 1 from private.ar_middle_channel_ingest_credentials c where c.token_hash=p_token_hash and c.source_origin=origin and c.action_scope='channels' and c.revoked_at is null and c.expires_at>t and (p_request->>'action'='check' or tenant=any(c.allowed_tenant_ids))) then raise exception 'AR_MIDDLE_UNAUTHORIZED' using errcode='28000';end if;
 if p_request->>'source' is distinct from 'ar_middle' or origin is distinct from 'https://m8-admin.payplatform-manager.com' then raise exception 'AR_MIDDLE_SCOPE_DENIED';end if;
 if p_request->>'action'='check' then
  if exists(select 1 from jsonb_object_keys(p_request)x where x<>all(array['action','source','source_origin'])) then raise exception 'AR_MIDDLE_INVALID_REQUEST';end if;
  return jsonb_build_object('ok',true,'source','ar_middle','schema_version',1,'action_scope','channels');
 end if;
 if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>8388608 or p_request->>'action' is distinct from 'channels' or p_request->>'schema_version' is distinct from '1' or jsonb_typeof(p_request->'schema_version') is distinct from 'number' or tenant is null or tenant !~ '^[0-9]{1,18}$'
  or exists(select 1 from jsonb_object_keys(p_request)x where x<>all(array['action','schema_version','source','source_origin','source_tenant_id','snapshot_id','captured_at','directions'])) then raise exception 'AR_MIDDLE_INVALID_REQUEST';end if;
 if not exists(select 1 from private.ar_middle_channel_platforms b join public.ar_config_targets a on a.source_system='AR' and a.country_code=b.country_code and a.platform=b.native_platform and b.dashboard_platform_id=md5('ar:'||a.country_code||':'||a.platform)::uuid where b.source_origin=origin and b.source_tenant_id=tenant and b.enabled) then raise exception 'AR_MIDDLE_SCOPE_DENIED';end if;
 if jsonb_typeof(p_request->'directions') is distinct from 'array' or jsonb_array_length(p_request->'directions')<>2 then raise exception 'AR_MIDDLE_INVALID_SNAPSHOT';end if;
 sid:=(p_request->>'snapshot_id')::uuid;captured:=(p_request->>'captured_at')::timestamptz;
 if sid is null or captured is null or captured<'2020-01-01'::timestamptz or captured>t+interval '5 minutes' or p_request->>'captured_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|\+00:00)$' then raise exception 'AR_MIDDLE_INVALID_TIME';end if;
 select count(distinct x->>'order_type') into direction_count from jsonb_array_elements(p_request->'directions')x;
 if direction_count<>2 then raise exception 'AR_MIDDLE_DUPLICATE_DIRECTIONS';end if;
 -- Preflight every record and both source totals before touching current data.
 for d in select value from jsonb_array_elements(p_request->'directions') loop
  kind:=d->>'order_type';obs:=(d->>'observed_at')::timestamptz;
  if jsonb_typeof(d) is distinct from 'object' or kind is null or kind not in ('deposit','withdrawal') or d->'complete' is distinct from 'true'::jsonb or obs is null or obs<'2020-01-01'::timestamptz or obs>captured or d->>'observed_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|\+00:00)$'
   or jsonb_typeof(d->'records') is distinct from 'array' or exists(select 1 from jsonb_object_keys(d)x where x<>all(array['order_type','observed_at','source_count','fetched_count','complete','page_count','records'])) then raise exception 'AR_MIDDLE_INVALID_SNAPSHOT';end if;
  n:=jsonb_array_length(d->'records');
  if n>10000 or jsonb_typeof(d->'source_count') is distinct from 'number' or jsonb_typeof(d->'fetched_count') is distinct from 'number' or d->>'source_count' !~ '^[0-9]{1,5}$' or d->>'fetched_count' !~ '^[0-9]{1,5}$' or (d->>'source_count')::integer is distinct from n or (d->>'fetched_count')::integer is distinct from n or jsonb_typeof(d->'page_count') is distinct from 'number' or d->>'page_count' !~ '^[0-9]{1,4}$' or (d->>'page_count')::integer not between 1 and 1000 then raise exception 'AR_MIDDLE_INVALID_COUNT';end if;
  if (select count(distinct x->>'channel_id') from jsonb_array_elements(d->'records')x)<>n then raise exception 'AR_MIDDLE_DUPLICATE_KEYS';end if;
  if exists(select 1 from jsonb_array_elements(d->'records') with ordinality item(record,position) where jsonb_typeof(item.record->'source_position') is distinct from 'number' or item.record->>'source_position' is distinct from (item.position-1)::text) then raise exception 'AR_MIDDLE_INVALID_SOURCE_POSITION';end if;
  for r in select value from jsonb_array_elements(d->'records') loop
   clean:=private.ar_middle_channel_clean_record(r);
   if clean->>'source_updated_at' is not null and (clean->>'source_updated_at')::timestamptz>t+interval '5 minutes' then raise exception 'AR_MIDDLE_INVALID_TIME';end if;
  end loop;
  total:=total+n;
 end loop;
 select md5(jsonb_agg(value order by value->>'order_type')::text) into digest from jsonb_array_elements(p_request->'directions');
 perform pg_advisory_xact_lock(hashtextextended('ar_middle:'||origin||':'||tenant,0));
 select * into state from private.ar_middle_channel_sync_state s where s.source_origin=origin and s.source_tenant_id=tenant order by captured_at desc limit 1;
 if state.captured_at>captured then return jsonb_build_object('ok',true,'source','ar_middle','accepted',total,'source_count',total,'snapshot_applied',false,'snapshot_id',sid);end if;
 if state.captured_at=captured then
  if state.payload_hash<>digest or state.snapshot_id<>sid then raise exception 'AR_MIDDLE_INVALID_SNAPSHOT_CONFLICT';end if;
  return jsonb_build_object('ok',true,'source','ar_middle','accepted',total,'source_count',total,'snapshot_applied',true,'snapshot_id',sid);
 end if;
 if state.snapshot_id=sid then raise exception 'AR_MIDDLE_INVALID_SNAPSHOT_ID_REUSE';end if;
 if exists(select 1 from private.ar_middle_channel_sync_state s join jsonb_array_elements(p_request->'directions')incoming on incoming.value->>'order_type'=s.order_type where s.source_origin=origin and s.source_tenant_id=tenant and s.observed_at>(incoming.value->>'observed_at')::timestamptz) then raise exception 'AR_MIDDLE_INVALID_SNAPSHOT_CHRONOLOGY';end if;
 for d in select value from jsonb_array_elements(p_request->'directions') loop
  kind:=d->>'order_type';obs:=(d->>'observed_at')::timestamptz;n:=jsonb_array_length(d->'records');
  for r in select value from jsonb_array_elements(d->'records') loop
   clean:=private.ar_middle_channel_clean_record(r);
   select * into previous from private.ar_middle_channels c where c.source_origin=origin and c.source_tenant_id=tenant and c.order_type=kind and c.channel_id=clean->>'channel_id';
   changed:=case when previous.channel_id is null or not previous.is_present or (previous.channel_data-volatile_keys) is distinct from (clean-volatile_keys) then obs else previous.config_changed_at end;
   insert into private.ar_middle_channels(source_origin,source_tenant_id,order_type,channel_id,channel_data,is_present,snapshot_id,observed_at,received_at,first_seen_at,last_seen_at,config_changed_at)
   values(origin,tenant,kind,clean->>'channel_id',clean,true,sid,obs,t,coalesce(previous.first_seen_at,obs),obs,changed)
   on conflict(source_origin,source_tenant_id,order_type,channel_id) do update set channel_data=excluded.channel_data,is_present=true,snapshot_id=excluded.snapshot_id,observed_at=excluded.observed_at,received_at=excluded.received_at,last_seen_at=excluded.last_seen_at,config_changed_at=excluded.config_changed_at;
  end loop;
  update private.ar_middle_channels c set is_present=false,snapshot_id=sid,observed_at=obs,received_at=t,config_changed_at=obs where c.source_origin=origin and c.source_tenant_id=tenant and c.order_type=kind and c.is_present and not exists(select 1 from jsonb_array_elements(d->'records')x where x->>'channel_id'=c.channel_id);
  insert into private.ar_middle_channel_sync_state(source_origin,source_tenant_id,order_type,snapshot_id,captured_at,observed_at,received_at,source_count,page_count,payload_hash)
  values(origin,tenant,kind,sid,captured,obs,t,n,(d->>'page_count')::integer,digest)
  on conflict(source_origin,source_tenant_id,order_type) do update set snapshot_id=excluded.snapshot_id,captured_at=excluded.captured_at,observed_at=excluded.observed_at,received_at=excluded.received_at,source_count=excluded.source_count,page_count=excluded.page_count,payload_hash=excluded.payload_hash;
 end loop;
 return jsonb_build_object('ok',true,'source','ar_middle','accepted',total,'source_count',total,'snapshot_applied',true,'snapshot_id',sid);
end $ingest$;
revoke all on function public.ar_middle_channel_ingest(text,jsonb) from public,anon,authenticated;
grant execute on function public.ar_middle_channel_ingest(text,jsonb) to service_role;

create function private.ar_middle_channel_capabilities(p_platform_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $cap$
 select case when exists(select 1 from private.ar_middle_channel_platforms b join public.ar_config_targets t on t.source_system='AR' and t.country_code=b.country_code and t.platform=b.native_platform and b.dashboard_platform_id=md5('ar:'||t.country_code||':'||t.platform)::uuid where b.dashboard_platform_id=p_platform_id and b.enabled)
 then jsonb_build_object('channelStatusAvailable',true,'channelStatusSource','ar_middle') else '{}'::jsonb end;
$cap$;
revoke all on function private.ar_middle_channel_capabilities(uuid) from public,anon,authenticated,service_role;

-- Keep the existing YASH implementation and its semantics byte-for-byte.
alter function private.dashboard_admin_live_channel_status(jsonb) rename to dashboard_admin_yash_live_channel_status;
create function private.dashboard_admin_live_channel_status(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $reader$
declare scope jsonb:=private.dashboard_admin_live_scope();access jsonb:=private.dashboard_role_access();ids uuid[];providers text[];v_direction text;platform record;binding private.ar_middle_channel_platforms;result jsonb;yash jsonb;snapshots jsonb:='[]'::jsonb;platforms jsonb:='[]'::jsonb;
begin
 if coalesce(access->>'mode','') not in ('owner','assigned') or coalesce((access->>'canView')::boolean,false) is not true then raise exception using errcode='42501',message='channel_status_role_denied';end if;
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536 or exists(select 1 from jsonb_object_keys(p_request)x where x<>all(array['platformIds','direction','providers'])) then raise exception using errcode='22023',message='invalid_channel_status_request';end if;
 if jsonb_typeof(p_request->'platformIds') is distinct from 'array' or jsonb_array_length(p_request->'platformIds') not between 1 and 20 or exists(select 1 from jsonb_array_elements(p_request->'platformIds')x where jsonb_typeof(x)<>'string' or x#>>'{}' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then raise exception using errcode='22023',message='invalid_platform_ids';end if;
 select array_agg(x::uuid) into ids from jsonb_array_elements_text(p_request->'platformIds')x;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids)x) then raise exception using errcode='22023',message='duplicate_platform_ids';end if;
 v_direction:=coalesce(p_request->>'direction','all');
 if p_request?'direction' and (jsonb_typeof(p_request->'direction')<>'string' or v_direction not in ('all','charge','withdraw')) then raise exception using errcode='22023',message='invalid_direction';end if;
 if p_request?'providers' then
  if jsonb_typeof(p_request->'providers') is distinct from 'array' or jsonb_array_length(p_request->'providers')>200 or exists(select 1 from jsonb_array_elements(p_request->'providers')x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 200 or x#>>'{}'<>btrim(x#>>'{}') or x#>>'{}' ~ '[[:cntrl:]]') then raise exception using errcode='22023',message='invalid_providers';end if;
  select array_agg(x) into providers from jsonb_array_elements_text(p_request->'providers')x;
  if cardinality(providers)<>(select count(distinct x) from unnest(providers)x) then raise exception using errcode='22023',message='duplicate_providers';end if;
 end if;
 if (select count(*) from private.dashboard_admin_live_platforms()p where p.id=any(ids) and (p.id=md5('kb:IN:YASH.BET')::uuid and p.source='kb' or p.source='ar' and private.ar_middle_channel_capabilities(p.id)->>'channelStatusSource'='ar_middle' and exists(select 1 from private.ar_middle_channel_platforms b where b.dashboard_platform_id=p.id and b.enabled and b.country_code=p.scope_group and b.native_platform=p.source_name)))<>cardinality(ids) then raise exception using errcode='42501',message='platform_denied';end if;
 for platform in select * from private.dashboard_admin_live_platforms()p where p.id=any(ids) order by p.id loop
  if platform.source='kb' then
   yash:=private.dashboard_admin_yash_live_channel_status(p_request||jsonb_build_object('platformIds',jsonb_build_array(platform.id)));
   platforms:=platforms||(yash->'platforms');snapshots:=snapshots||(yash->'snapshots');continue;
  end if;
  select * into strict binding from private.ar_middle_channel_platforms b where b.dashboard_platform_id=platform.id and b.enabled;
  platforms:=platforms||jsonb_build_array(to_jsonb(platform)||jsonb_build_object('capabilities',private.ar_middle_channel_capabilities(platform.id)));
  select jsonb_agg(jsonb_build_object('platformId',platform.id,'direction',d.direction,'source','ar_middle','sourceOrigin',binding.source_origin,'sourceTenantId',binding.source_tenant_id,
   'snapshotId',s.snapshot_id,'capturedAt',s.captured_at,'observedAt',s.observed_at,'receivedAt',s.received_at,'sourceCount',s.source_count,'staleAfterSeconds',900,'stale',s.observed_at is null or statement_timestamp()-s.observed_at>interval '15 minutes',
   'complete',s.observed_at is not null and s.source_count=(select count(*) from private.ar_middle_channels c where c.source_origin=binding.source_origin and c.source_tenant_id=binding.source_tenant_id and c.order_type=d.order_type and c.is_present)
    and (select count(distinct z.snapshot_id)=1 and count(distinct z.captured_at)=1 and count(distinct z.payload_hash)=1 and count(*)=2 from private.ar_middle_channel_sync_state z where z.source_origin=binding.source_origin and z.source_tenant_id=binding.source_tenant_id)
    and not exists(select 1 from private.ar_middle_channels c where c.source_origin=binding.source_origin and c.source_tenant_id=binding.source_tenant_id and c.order_type=d.order_type and c.is_present and (c.snapshot_id is distinct from s.snapshot_id or c.observed_at is distinct from s.observed_at)),
   'channels',coalesce((select jsonb_agg(c.channel_data||jsonb_build_object('channel_id',c.channel_id,'success_rate_10m',null,'is_present',c.is_present,'snapshot_id',c.snapshot_id,'observed_at',c.observed_at,'received_at',c.received_at,'first_seen_at',c.first_seen_at,'last_seen_at',c.last_seen_at,'config_changed_at',c.config_changed_at) order by c.is_present desc,(c.channel_data->>'source_position')::integer nulls last,c.channel_id)
     from private.ar_middle_channels c where c.source_origin=binding.source_origin and c.source_tenant_id=binding.source_tenant_id and c.order_type=d.order_type and (providers is null or c.channel_data->>'provider'=any(providers))),'[]'::jsonb)) order by d.direction) into result
  from (values('deposit','charge'),('withdrawal','withdraw'))d(order_type,direction)
  left join private.ar_middle_channel_sync_state s on s.source_origin=binding.source_origin and s.source_tenant_id=binding.source_tenant_id and s.order_type=d.order_type
  where v_direction='all' or d.direction=v_direction;
  snapshots:=snapshots||coalesce(result,'[]'::jsonb);
 end loop;
 return jsonb_build_object('version',1,'queriedAt',statement_timestamp(),'basis','source_channel_snapshot','platforms',platforms,'snapshots',snapshots);
end $reader$;
revoke all on function private.dashboard_admin_live_channel_status(jsonb),private.dashboard_admin_yash_live_channel_status(jsonb) from public,anon,authenticated,service_role;
create or replace function public.dashboard_admin_live_channel_status(p_request jsonb)
returns jsonb language sql stable security definer set search_path='' as $public_reader$ select private.dashboard_admin_live_channel_status(p_request);$public_reader$;
revoke all on function public.dashboard_admin_live_channel_status(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dashboard_admin_live_channel_status(jsonb) to authenticated;

-- Add channel capability only to verified existing AR catalog IDs. The other
-- source/order capability expressions and their ACLs remain unchanged.
do $catalog$
declare p pg_proc%rowtype;d text;marker text:= $marker$case when p->>'source'='kb' then private.dashboard_admin_yash_capabilities()$marker$;old_acl aclitem[];old_owner oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'9480eb53fa7d7b3fad368ff011b3d41a' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""','jit=off'] then raise exception 'AR_MIDDLE_CATALOG_CONTRACT_DRIFT';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 if (length(d)-length(replace(d,marker,'')))/length(marker)<>1 then raise exception 'AR_MIDDLE_CATALOG_MARKER_DRIFT';end if;
 d:=replace(d,marker,$replacement$case when p->>'source'='ar' then private.ar_middle_channel_capabilities((p->>'id')::uuid)
      when p->>'source'='kb' then private.dashboard_admin_yash_capabilities()$replacement$);
 execute d;
 if exists(select 1 from pg_proc where oid=p.oid and (proacl is distinct from old_acl or proowner is distinct from old_owner)) then raise exception 'AR_MIDDLE_CATALOG_ACL_DRIFT';end if;
end $catalog$;
notify pgrst,'reload schema';
commit;
