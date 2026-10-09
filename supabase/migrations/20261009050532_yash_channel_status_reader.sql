-- Latest source channel snapshots. These percentages are not order aggregates.
begin;
create or replace function private.dashboard_admin_live_channel_status(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $reader$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();
 v_access jsonb:=private.dashboard_role_access();
 v_platform record;v_ids uuid[];v_providers text[];v_direction text;
 v_snapshots jsonb;
begin
 if coalesce(v_access->>'mode','') not in ('owner','assigned') or coalesce((v_access->>'canView')::boolean,false) is not true then
  raise exception using errcode='42501',message='channel_status_role_denied';end if;
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('platformIds','direction','providers')) then
  raise exception using errcode='22023',message='invalid_channel_status_request';end if;
 if jsonb_typeof(p_request->'platformIds') is distinct from 'array' then raise exception using errcode='22023',message='invalid_platform_ids';end if;
 if jsonb_array_length(p_request->'platformIds') not between 1 and 20 or exists(
  select 1 from jsonb_array_elements(p_request->'platformIds') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then
  raise exception using errcode='22023',message='invalid_platform_ids';end if;
 select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p_request->'platformIds')x;
 if cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids)x) then raise exception using errcode='22023',message='duplicate_platform_ids';end if;
 v_direction:=coalesce(p_request->>'direction','all');
 if p_request?'direction' and (jsonb_typeof(p_request->'direction')<>'string' or v_direction not in ('all','charge','withdraw')) then
  raise exception using errcode='22023',message='invalid_direction';end if;
 if p_request?'providers' then
  if jsonb_typeof(p_request->'providers') is distinct from 'array' then raise exception using errcode='22023',message='invalid_providers';end if;
  if jsonb_array_length(p_request->'providers')>200 or exists(select 1 from jsonb_array_elements(p_request->'providers')x
    where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 200 or x#>>'{}'<>btrim(x#>>'{}') or x#>>'{}' ~ '[[:cntrl:]]') then
   raise exception using errcode='22023',message='invalid_providers';end if;
  select array_agg(x) into v_providers from jsonb_array_elements_text(p_request->'providers')x;
  if cardinality(v_providers)<>(select count(distinct x) from unnest(v_providers)x) then raise exception using errcode='22023',message='duplicate_providers';end if;
 end if;
 if cardinality(v_ids)<>1 or v_ids[1]<>md5('kb:IN:YASH.BET')::uuid then raise exception using errcode='42501',message='platform_denied';end if;
 select * into v_platform from private.dashboard_admin_live_platforms() p where p.id=v_ids[1] and p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET';
 if not found then raise exception using errcode='42501',message='platform_denied';end if;
 select jsonb_agg(jsonb_build_object('platformId',v_platform.id,'direction',d.direction,
  'observedAt',s.observed_at,'receivedAt',s.received_at,'sourceCount',s.source_count,
  'complete',s.observed_at is not null and s.source_count=(select count(*) from private.yash_channels c where c.order_type=d.order_type and c.is_present)
   and not exists(select 1 from private.yash_channels c where c.order_type=d.order_type and c.is_present and c.observed_at is distinct from s.observed_at),
  'channels',coalesce((select jsonb_agg(jsonb_build_object(
    'channel_id',c.channel_id,
    'channel_name',c.channel_name,
    'provider',c.provider,
    'channel_type',c.channel_type,
    'payment_method',c.payment_method,
    'min_amount',c.min_amount,
    'max_amount',c.max_amount,
    'limit_currency',c.limit_currency,
    'success_rate_10m',c.success_rate_10m,
    'success_rate_30m',c.success_rate_30m,
    'success_rate_1h',c.success_rate_1h,
    'success_rate_4h',c.success_rate_4h,
    'success_rate_8h',c.success_rate_8h,
    'success_rate_24h',c.success_rate_24h,
    'success_rate_today',c.success_rate_today,
    'success_rate_total',c.success_rate_total,
    'balance',c.balance,
    'balance_currency',c.balance_currency,
    'balance_threshold',c.balance_threshold,
    'balance_threshold_currency',c.balance_threshold_currency,
    'required_deposit_count',c.required_deposit_count,
    'priority',c.priority,
    'weight',c.weight,
    'status_text',c.status_text,
    'enabled',c.enabled,
    'notes',c.notes,
    'is_present',c.is_present,
    'observed_at',c.observed_at,
    'received_at',c.received_at,
    'first_seen_at',c.first_seen_at,
    'last_seen_at',c.last_seen_at,
    'config_changed_at',c.config_changed_at
   ) order by c.is_present desc,c.priority nulls last,c.channel_id)
   from private.yash_channels c where c.order_type=d.order_type and (v_providers is null or c.provider=any(v_providers))), '[]'::jsonb)
 ) order by d.direction) into v_snapshots
 from (values('deposit','charge'),('withdrawal','withdraw'))d(order_type,direction)
 left join private.yash_channel_sync_state s on s.order_type=d.order_type
 where v_direction='all' or d.direction=v_direction;
 return jsonb_build_object('version',1,'queriedAt',statement_timestamp(),'basis','source_channel_snapshot',
  'platforms',jsonb_build_array(to_jsonb(v_platform)||jsonb_build_object('capabilities',private.dashboard_admin_yash_capabilities())),
  'snapshots',coalesce(v_snapshots,'[]'::jsonb));
end;$reader$;
revoke all on function private.dashboard_admin_live_channel_status(jsonb) from public,anon,authenticated,service_role;
create or replace function public.dashboard_admin_live_channel_status(p_request jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.dashboard_admin_live_channel_status(p_request);
$$;
revoke all on function public.dashboard_admin_live_channel_status(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dashboard_admin_live_channel_status(jsonb) to authenticated;

-- Register page permissions without changing any existing assignment.
do $catalog$
declare p record;before_meta jsonb;before_catalog jsonb;after_catalog jsonb;pages jsonb;
 new_page constant jsonb:='{"id":"channel_status","moduleId":"provider","moduleLabel":"三方通道中心","label":"通道状态","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","channelStatus"]}';
begin
 select * into strict p from pg_proc where oid='private.dashboard_role_catalog()'::regprocedure;
 before_meta:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)<>'39bf5d400a9c26c2c8614b18bf459ebc' or p.prosecdef or p.provolatile<>'i'
  or p.proconfig is distinct from array['search_path=""'] or p.prolang<>(select oid from pg_language where lanname='sql') then raise exception 'channel_status_catalog_drift';end if;
 before_catalog:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(before_catalog->'pages')entry where entry->>'id'='provider_daily')<>1
  or exists(select 1 from jsonb_array_elements(before_catalog->'pages')entry where entry->>'id'='channel_status') then raise exception 'channel_status_catalog_entry_drift';end if;
 select jsonb_agg(i.p order by o.ord,i.ord) into pages from jsonb_array_elements(before_catalog->'pages') with ordinality o(p,ord)
 cross join lateral jsonb_array_elements(case when o.p->>'id'='provider_daily' then jsonb_build_array(o.p,new_page) else jsonb_build_array(o.p) end)with ordinality i(p,ord);
 after_catalog:=jsonb_set(jsonb_set(before_catalog,'{pages}',pages),'{permissions}',(before_catalog->'permissions')||'[{"key":"channel_status.view"},{"key":"channel_status.query"},{"key":"channel_status.detail"},{"key":"channel_status.export"}]'::jsonb);
 execute format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L','select '||quote_literal(after_catalog::text)||'::jsonb');
 if (select to_jsonb(x)-'prosrc' from pg_proc x where oid=p.oid) is distinct from before_meta or private.dashboard_role_catalog() is distinct from after_catalog then raise exception 'channel_status_catalog_metadata_changed';end if;
end;$catalog$;
do $route$
declare p record;d text;before_meta jsonb;needle text;
begin
 select * into strict p from pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure;
 before_meta:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)<>'bedf2d843b4d2328013aea2f6cf8bb5d' or not p.prosecdef or p.proconfig is distinct from array['search_path=""'] then raise exception 'channel_status_gateway_drift';end if;
 d:=pg_get_functiondef(p.oid);needle:='rpc:=case action';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'channel_status_gateway_anchor_drift';end if;
 execute replace(d,needle,needle||E'\n  when ''channelStatus'' then ''dashboard_admin_live_channel_status''');
 if (select to_jsonb(x)-'prosrc' from pg_proc x where oid=p.oid) is distinct from before_meta then raise exception 'channel_status_gateway_metadata_changed';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_yash_capabilities()'::regprocedure;
 before_meta:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)<>'69be3a9ed7d78f03fad3f77a40bbb44b' then raise exception 'channel_status_capabilities_drift';end if;
 d:=pg_get_functiondef(p.oid);needle:='''sourceDetailSystem'',''KB''';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'channel_status_capabilities_anchor_drift';end if;
 execute replace(d,needle,needle||',''channelStatusAvailable'',true');
 if (select to_jsonb(x)-'prosrc' from pg_proc x where oid=p.oid) is distinct from before_meta then raise exception 'channel_status_capabilities_metadata_changed';end if;
end;$route$;
notify pgrst,'reload schema';
commit;
