-- Preserve each native recharge category/channel row, including category 0.
-- Generated keys cannot be supplied by callers. Existing snapshot JSON and hashes stay unchanged.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
lock table private.ar_middle_channels in access exclusive mode;
do $baseline$
declare has_key boolean;pk text;names text[];
begin
 if not exists(select 1 from pg_class c where c.oid='private.ar_middle_channels'::regclass and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity and c.relacl::text='{postgres=arwdDxtm/postgres,service_role=arw/postgres}')
  or exists(select 1 from pg_policy where polrelid='private.ar_middle_channels'::regclass)
  or exists(select 1 from pg_constraint where confrelid='private.ar_middle_channels'::regclass) then raise exception 'AR_MIDDLE_CATEGORY_TABLE_BASELINE_MISMATCH';end if;
 if (select count(*) from pg_constraint where conrelid='private.ar_middle_channels'::regclass and contype<>'n')<>5 or not exists(select 1 from pg_constraint where conrelid='private.ar_middle_channels'::regclass and conname='ar_middle_channels_channel_data_check' and contype='c' and convalidated and not connoinherit and pg_get_constraintdef(oid)='CHECK ((jsonb_typeof(channel_data) = ''object''::text))') or not exists(select 1 from pg_constraint where conrelid='private.ar_middle_channels'::regclass and conname='ar_middle_channels_channel_id_check' and contype='c' and convalidated and not connoinherit and pg_get_constraintdef(oid)='CHECK (((length(channel_id) >= 1) AND (length(channel_id) <= 200)))') or not exists(select 1 from pg_constraint where conrelid='private.ar_middle_channels'::regclass and conname='ar_middle_channels_order_type_check' and contype='c' and convalidated and not connoinherit and pg_get_constraintdef(oid)='CHECK ((order_type = ANY (ARRAY[''deposit''::text, ''withdrawal''::text])))') or not exists(select 1 from pg_constraint where conrelid='private.ar_middle_channels'::regclass and conname='ar_middle_channels_source_origin_source_tenant_id_fkey' and contype='f' and convalidated and pg_get_constraintdef(oid)='FOREIGN KEY (source_origin, source_tenant_id) REFERENCES private.ar_middle_channel_platforms(source_origin, source_tenant_id)') then raise exception 'AR_MIDDLE_CATEGORY_CONSTRAINT_BASELINE_MISMATCH';end if;
 if exists(select 1 from pg_attribute where attrelid='private.ar_middle_channels'::regclass and attnum>0 and not attisdropped and not attnotnull) then raise exception 'AR_MIDDLE_CATEGORY_NULLABILITY_MISMATCH';end if;
 select exists(select 1 from pg_attribute where attrelid='private.ar_middle_channels'::regclass and attname='category_key' and not attisdropped) into has_key;
 select array_agg(attname::text order by attnum) into names from pg_attribute where attrelid='private.ar_middle_channels'::regclass and attnum>0 and not attisdropped;
 if names is distinct from (array['source_origin','source_tenant_id','order_type','channel_id','channel_data','is_present','snapshot_id','observed_at','received_at','first_seen_at','last_seen_at','config_changed_at']::text[] || case when has_key then array['category_key']::text[] else array[]::text[] end) then raise exception 'AR_MIDDLE_CATEGORY_COLUMNS_MISMATCH';end if;
 select pg_get_constraintdef(oid) into pk from pg_constraint where conrelid='private.ar_middle_channels'::regclass and conname='ar_middle_channels_pkey' and contype='p';
 if pk is distinct from (case when has_key then 'PRIMARY KEY (source_origin, source_tenant_id, order_type, channel_id, category_key)' else 'PRIMARY KEY (source_origin, source_tenant_id, order_type, channel_id)' end) then raise exception 'AR_MIDDLE_CATEGORY_PRIMARY_KEY_MISMATCH';end if;
 if (select count(*) from pg_index where indrelid='private.ar_middle_channels'::regclass)<>2 or not exists(select 1 from pg_index where indexrelid='private.ar_middle_channels_present_idx'::regclass and indisvalid and not indisunique and pg_get_indexdef(indexrelid)='CREATE INDEX ar_middle_channels_present_idx ON private.ar_middle_channels USING btree (source_origin, source_tenant_id, order_type, is_present)') then raise exception 'AR_MIDDLE_CATEGORY_INDEX_BASELINE_MISMATCH';end if;
 if has_key and not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='private.ar_middle_channels'::regclass and a.attname='category_key' and a.attgenerated='s' and a.attnotnull and a.atttypid='text'::regtype and regexp_replace(pg_get_expr(d.adbin,d.adrelid),'[[:space:]]+',' ','g')=$expected$ CASE WHEN ((order_type = 'deposit'::text) AND ((channel_data ->> 'category_id'::text) IS NOT NULL)) THEN ('id:'::text || (channel_data ->> 'category_id'::text)) ELSE ''::text END$expected$) then raise exception 'AR_MIDDLE_CATEGORY_GENERATED_KEY_MISMATCH';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.ar_middle_channel_ingest(text,jsonb)') and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and p.provolatile='v' and p.proconfig=ARRAY['search_path=""']::text[] and md5(p.prosrc) in ('5d7452ba7387bddafa22d55d65132414','bda694af31ea58b811ffbb4d42a48408')) then raise exception 'AR_MIDDLE_CATEGORY_FUNCTION_BASELINE_MISMATCH: public.ar_middle_channel_ingest(text,jsonb)';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_live_channel_status(jsonb)') and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}' and p.prosecdef=true and p.provolatile='s' and p.proconfig=ARRAY['search_path=""']::text[] and md5(p.prosrc) in ('814902dbd24fe5dd71c4aa206475b13d','8be5274830f4a8056b51f76aa63b6d6f')) then raise exception 'AR_MIDDLE_CATEGORY_FUNCTION_BASELINE_MISMATCH: private.dashboard_admin_live_channel_status(jsonb)';end if;
end $baseline$;
do $schema$
begin
 if not exists(select 1 from pg_attribute where attrelid='private.ar_middle_channels'::regclass and attname='category_key' and not attisdropped) then
  alter table private.ar_middle_channels add column category_key text generated always as (case when order_type='deposit' and channel_data->>'category_id' is not null then 'id:'||(channel_data->>'category_id') else '' end) stored not null;
  alter table private.ar_middle_channels drop constraint ar_middle_channels_pkey;
  alter table private.ar_middle_channels add constraint ar_middle_channels_pkey primary key(source_origin,source_tenant_id,order_type,channel_id,category_key);
 end if;
end $schema$;
create or replace function public.ar_middle_channel_ingest(p_token_hash text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $ingest$
declare t timestamptz:=clock_timestamp();origin text;tenant text;sid uuid;captured timestamptz;obs timestamptz;d jsonb;r jsonb;clean jsonb;kind text;time_key text;n integer;total integer:=0;digest text;state private.ar_middle_channel_sync_state;previous private.ar_middle_channels;changed timestamptz;direction_count integer;
 volatile_keys constant text[]:=array['balance','source_updated_at','real_time_weight','success_rate_15m','success_rate_30m','success_rate_1h','success_rate_4h','success_rate_8h','success_rate_24h','success_rate_today','success_rate_total'];
 withdrawal_volatile_keys constant text[]:=array['balance_updated_at','today_submit_count','recent_1h_success_count','last_updated_at'];
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
  if (select count(distinct (x->>'channel_id',case when kind='deposit' and x->>'category_id' is not null then 'id:'||(x->>'category_id') else '' end)) from jsonb_array_elements(d->'records')x)<>n then raise exception 'AR_MIDDLE_DUPLICATE_KEYS';end if;
  if exists(select 1 from jsonb_array_elements(d->'records') with ordinality item(record,position) where jsonb_typeof(item.record->'source_position') is distinct from 'number' or item.record->>'source_position' is distinct from (item.position-1)::text) then raise exception 'AR_MIDDLE_INVALID_SOURCE_POSITION';end if;
  for r in select value from jsonb_array_elements(d->'records') loop
   clean:=private.ar_middle_channel_clean_record(r);
   if kind<>'deposit' and clean->>'real_time_weight' is not null then raise exception 'AR_MIDDLE_INVALID_REAL_TIME_WEIGHT_DIRECTION';end if;
   if kind<>'withdrawal' and clean->'withdrawal_details' is not null and jsonb_typeof(clean->'withdrawal_details')<>'null' then raise exception 'AR_MIDDLE_INVALID_WITHDRAWAL_DETAILS';end if;
   foreach time_key in array array['balance_updated_at','last_updated_at'] loop
    if clean->'withdrawal_details'->>time_key is not null and (clean->'withdrawal_details'->>time_key)::timestamptz>t+interval '5 minutes' then raise exception 'AR_MIDDLE_INVALID_TIME';end if;
   end loop;
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
   select * into previous from private.ar_middle_channels c where c.source_origin=origin and c.source_tenant_id=tenant and c.order_type=kind and c.channel_id=clean->>'channel_id' and c.category_key=(case when kind='deposit' and clean->>'category_id' is not null then 'id:'||(clean->>'category_id') else '' end);
   changed:=case when previous.channel_id is null or not previous.is_present or ((previous.channel_data-volatile_keys-'withdrawal_details')||jsonb_build_object('withdrawal_details',coalesce(nullif(previous.channel_data->'withdrawal_details','null'::jsonb),'{}'::jsonb)-withdrawal_volatile_keys)) is distinct from ((clean-volatile_keys-'withdrawal_details')||jsonb_build_object('withdrawal_details',coalesce(nullif(clean->'withdrawal_details','null'::jsonb),'{}'::jsonb)-withdrawal_volatile_keys)) then obs else previous.config_changed_at end;
   insert into private.ar_middle_channels(source_origin,source_tenant_id,order_type,channel_id,channel_data,is_present,snapshot_id,observed_at,received_at,first_seen_at,last_seen_at,config_changed_at)
   values(origin,tenant,kind,clean->>'channel_id',clean,true,sid,obs,t,coalesce(previous.first_seen_at,obs),obs,changed)
   on conflict(source_origin,source_tenant_id,order_type,channel_id,category_key) do update set channel_data=excluded.channel_data,is_present=true,snapshot_id=excluded.snapshot_id,observed_at=excluded.observed_at,received_at=excluded.received_at,last_seen_at=excluded.last_seen_at,config_changed_at=excluded.config_changed_at;
  end loop;
  update private.ar_middle_channels c set is_present=false,snapshot_id=sid,observed_at=obs,received_at=t,config_changed_at=obs where c.source_origin=origin and c.source_tenant_id=tenant and c.order_type=kind and c.is_present and not exists(select 1 from jsonb_array_elements(d->'records')x where x->>'channel_id'=c.channel_id and (case when kind='deposit' and x->>'category_id' is not null then 'id:'||(x->>'category_id') else '' end)=c.category_key);
  insert into private.ar_middle_channel_sync_state(source_origin,source_tenant_id,order_type,snapshot_id,captured_at,observed_at,received_at,source_count,page_count,payload_hash)
  values(origin,tenant,kind,sid,captured,obs,t,n,(d->>'page_count')::integer,digest)
  on conflict(source_origin,source_tenant_id,order_type) do update set snapshot_id=excluded.snapshot_id,captured_at=excluded.captured_at,observed_at=excluded.observed_at,received_at=excluded.received_at,source_count=excluded.source_count,page_count=excluded.page_count,payload_hash=excluded.payload_hash;
 end loop;
 return jsonb_build_object('ok',true,'source','ar_middle','accepted',total,'source_count',total,'snapshot_applied',true,'snapshot_id',sid);
end $ingest$;

create or replace function private.dashboard_admin_live_channel_status(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $reader$
declare scope jsonb:=private.dashboard_admin_live_scope();access jsonb:=private.dashboard_role_access();can_detail boolean;ids uuid[];providers text[];v_direction text;platform record;binding private.ar_middle_channel_platforms;result jsonb;yash jsonb;snapshots jsonb:='[]'::jsonb;platforms jsonb:='[]'::jsonb;
begin
 if coalesce(access->>'mode','') not in ('owner','assigned') or coalesce((access->>'canView')::boolean,false) is not true then raise exception using errcode='42501',message='channel_status_role_denied';end if;
 can_detail:=access->>'mode'='owner' or coalesce(access->'permissions','[]'::jsonb) ? 'channel_status.detail';
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
  select jsonb_agg(jsonb_build_object('platformId',platform.id,'direction',d.direction,'source','ar_middle','sourceOrigin',binding.source_origin,'sourceTenantId',binding.source_tenant_id,'sourceRowIdentity',case when d.order_type='deposit' then 'category_channel' else null end,
   'snapshotId',s.snapshot_id,'capturedAt',s.captured_at,'observedAt',s.observed_at,'receivedAt',s.received_at,'sourceCount',s.source_count,'staleAfterSeconds',900,'stale',s.observed_at is null or statement_timestamp()-s.observed_at>interval '15 minutes',
   'complete',s.observed_at is not null and s.source_count=(select count(*) from private.ar_middle_channels c where c.source_origin=binding.source_origin and c.source_tenant_id=binding.source_tenant_id and c.order_type=d.order_type and c.is_present)
    and (select count(distinct z.snapshot_id)=1 and count(distinct z.captured_at)=1 and count(distinct z.payload_hash)=1 and count(*)=2 from private.ar_middle_channel_sync_state z where z.source_origin=binding.source_origin and z.source_tenant_id=binding.source_tenant_id)
    and not exists(select 1 from private.ar_middle_channels c where c.source_origin=binding.source_origin and c.source_tenant_id=binding.source_tenant_id and c.order_type=d.order_type and c.is_present and (c.snapshot_id is distinct from s.snapshot_id or c.observed_at is distinct from s.observed_at)),
   'channels',coalesce((select jsonb_agg((case when can_detail then c.channel_data else c.channel_data-'withdrawal_details' end)||jsonb_build_object('channel_id',c.channel_id,'success_rate_10m',null,'is_present',c.is_present,'snapshot_id',c.snapshot_id,'observed_at',c.observed_at,'received_at',c.received_at,'first_seen_at',c.first_seen_at,'last_seen_at',c.last_seen_at,'config_changed_at',c.config_changed_at) order by c.is_present desc,(c.channel_data->>'source_position')::integer nulls last,c.channel_id,c.category_key)
     from private.ar_middle_channels c where c.source_origin=binding.source_origin and c.source_tenant_id=binding.source_tenant_id and c.order_type=d.order_type and (providers is null or c.channel_data->>'provider'=any(providers))),'[]'::jsonb)) order by d.direction) into result
  from (values('deposit','charge'),('withdrawal','withdraw'))d(order_type,direction)
  left join private.ar_middle_channel_sync_state s on s.source_origin=binding.source_origin and s.source_tenant_id=binding.source_tenant_id and s.order_type=d.order_type
  where v_direction='all' or d.direction=v_direction;
  snapshots:=snapshots||coalesce(result,'[]'::jsonb);
 end loop;
 return jsonb_build_object('version',1,'queriedAt',statement_timestamp(),'basis','source_channel_snapshot','platforms',platforms,'snapshots',snapshots);
end $reader$;
do $verified$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.ar_middle_channel_ingest(text,jsonb)') and md5(p.prosrc)='bda694af31ea58b811ffbb4d42a48408' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and p.provolatile='v' and p.proconfig=ARRAY['search_path=""']::text[]) then raise exception 'AR_MIDDLE_CATEGORY_FUNCTION_VERIFY_FAILED';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_live_channel_status(jsonb)') and md5(p.prosrc)='8be5274830f4a8056b51f76aa63b6d6f' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}' and p.prosecdef=true and p.provolatile='s' and p.proconfig=ARRAY['search_path=""']::text[]) then raise exception 'AR_MIDDLE_CATEGORY_FUNCTION_VERIFY_FAILED';end if;
 if exists(select 1 from private.ar_middle_channels where category_key is distinct from (case when order_type='deposit' and channel_data->>'category_id' is not null then 'id:'||(channel_data->>'category_id') else '' end)) then raise exception 'AR_MIDDLE_CATEGORY_BACKFILL_VERIFY_FAILED';end if;
end $verified$;
commit;
