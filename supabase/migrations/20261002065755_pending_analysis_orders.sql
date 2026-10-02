-- Read-only order drilldown from verified immutable observations.
-- No business rows or existing role assignments are changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $guard$
declare p pg_proc%rowtype;r record;
begin
 for r in select * from(values
  ('public.dashboard_admin_execute(text,jsonb)','c14d300d245ad6f4610969dd271745e9'),
  ('private.dashboard_role_catalog()','522e86d22ae0651e8e44e29f62ed75cb')
 )v(signature,definition_md5)loop
  select * into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(pg_get_functiondef(p.oid))<>r.definition_md5 or p.proowner<>'postgres'::regrole
   or p.proacl::text is distinct from (case when r.signature like 'public.%'then '{postgres=X/postgres,authenticated=X/postgres}'else '{postgres=X/postgres}'end) then
   raise exception 'pending_orders_baseline_drift: %',r.signature;end if;
 end loop;
 if to_regprocedure('private.dashboard_admin_live_pending_orders(jsonb)')is not null
  or to_regprocedure('public.dashboard_admin_live_pending_orders(jsonb)')is not null
  or to_regclass('private.withdraw_pending_capture_archive')is null then
  raise exception 'pending_orders_schema_drift';end if;
end $guard$;
create function private.dashboard_admin_live_pending_orders(p_request jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $orders$
declare
 s jsonb:=private.dashboard_admin_live_scope();a jsonb;c jsonb;t jsonb;row_value jsonb;
 d date;observed timestamptz;mode text;provider text;ids jsonb;v_platform_key text;v_country text;v_source_system text;
 h private.withdraw_pending_capture_archive%rowtype;n bigint;amount numeric;items jsonb;
 page_offset integer;page_limit integer;
begin
 perform private.dashboard_role_require_gateway();
 a:=private.dashboard_role_access();
 if a->>'mode'='assigned' and not(a->'permissions')?&array['stuck.view','stuck.query','stuck.detail']then
  raise exception using errcode='42501',message='role_permission_denied';end if;
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or exists(select 1 from jsonb_object_keys(p_request)k where k<>all(array['date','platformIds','observedAt','mode','provider','offset','limit']))
  or jsonb_typeof(p_request->'date')is distinct from 'string'
  or jsonb_typeof(p_request->'observedAt')is distinct from 'string'
  or p_request->>'date'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or p_request->>'observedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  or jsonb_typeof(p_request->'mode')is distinct from 'string'
  or p_request->>'mode'not in('midnight','observed')
  or jsonb_typeof(p_request->'platformIds')is distinct from 'array'
  or jsonb_array_length(p_request->'platformIds')not between 1 and 10 then
  raise exception using errcode='22023',message='invalid_request';end if;
 begin d:=(p_request->>'date')::date;observed:=(p_request->>'observedAt')::timestamptz;
 exception when data_exception then raise exception using errcode='22023',message='invalid_request';end;
 if to_char(d,'YYYY-MM-DD')<>p_request->>'date'then raise exception using errcode='22023',message='invalid_request';end if;
 mode:=p_request->>'mode';ids:=p_request->'platformIds';
 if p_request?'provider'then
  if jsonb_typeof(p_request->'provider')is distinct from 'string'
   or length(p_request->>'provider')not between 1 and 200
   or btrim(p_request->>'provider')<>p_request->>'provider'
   or p_request->>'provider'~'[[:cntrl:]]'then raise exception using errcode='22023',message='invalid_filter';end if;
  provider:=p_request->>'provider';
 end if;
 if p_request?'offset'and(jsonb_typeof(p_request->'offset')<>'number'or p_request->>'offset'!~'^[0-9]{1,7}$')
  or p_request?'limit'and(jsonb_typeof(p_request->'limit')<>'number'or p_request->>'limit'not in('20','50','100'))then
  raise exception using errcode='22023',message='invalid_paging';end if;
 page_offset:=coalesce((p_request->>'offset')::integer,0);page_limit:=coalesce((p_request->>'limit')::integer,50);
 c:=private.dashboard_admin_pending_resolve(jsonb_build_object('date',d,'platformIds',ids),s);
 -- Aliases are allowed only when every selected ID resolves to one exact source scope.
 select count(distinct jsonb_build_array(x->>'scope_group',x->>'platform_key',
  case when x->>'source'in('ar','newar','withdraw')then'withdraw_review'else x->>'source'end))
 into n from jsonb_array_elements(c)x;
 if n<>1 or (select count(distinct x->>'team')from jsonb_array_elements(c)x)>1
  or exists(select 1 from jsonb_array_elements(c)x where (x->>'mapping_ambiguous')::boolean
  or x->>'team'='__team_conflict__')then raise exception using errcode='42501',message='platform_denied';end if;
 t:=c->0;v_platform_key:=t->>'platform_key';v_country:=t->>'scope_group';
 if nullif(t->>'currency','')is null or nullif(t->>'timezone','')is null then
  return jsonb_build_object('version',1,'available',false,'state','identity_unavailable',
   'date',d,'observedAt',observed,'mode',mode,'rows','[]'::jsonb,'total',null,'amount',null);end if;
 v_source_system:=case when t->>'source'in('ar','newar','withdraw')then'withdraw_review'else t->>'source'end;
 select count(*)into n from private.withdraw_pending_capture_archive x
  where x.country_code=v_country and lower(x.source_system)=v_source_system
   and private.dashboard_admin_pending_platform_key(x.country_code,x.platform)=v_platform_key
   and private.dashboard_scope_allows(s,x.country_code,x.platform)
   and x.timezone=t->>'timezone'
   and x.identity_status='resolved'
   and exists(select 1 from jsonb_array_elements(c)y where x.platform_id=(y->>'id')::uuid
    and case x.native_source_system when'AR'then'ar'when'NEW_AR'then'newar'end=y->>'source' and x.team_name is not distinct from y->>'team'
    and x.currency is not distinct from y->>'currency' and x.timezone=y->>'timezone')
   and x.stat_date=d and x.snapshot_at=observed and x.capture_basis='actual_capture'
   and(mode='observed'or x.within_midnight_window);
 if n<>1 then return jsonb_build_object('version',1,'available',false,'state','capture_unavailable',
  'date',d,'observedAt',observed,'mode',mode,'rows','[]'::jsonb,'total',null,'amount',null);end if;
 select *into h from private.withdraw_pending_capture_archive x
  where x.country_code=v_country and lower(x.source_system)=v_source_system
   and private.dashboard_admin_pending_platform_key(x.country_code,x.platform)=v_platform_key
   and private.dashboard_scope_allows(s,x.country_code,x.platform)
   and x.timezone=t->>'timezone'
   and x.identity_status='resolved'
   and exists(select 1 from jsonb_array_elements(c)y where x.platform_id=(y->>'id')::uuid
    and case x.native_source_system when'AR'then'ar'when'NEW_AR'then'newar'end=y->>'source' and x.team_name is not distinct from y->>'team'
    and x.currency is not distinct from y->>'currency' and x.timezone=y->>'timezone')
   and x.stat_date=d and x.snapshot_at=observed and x.capture_basis='actual_capture'
   and(mode='observed'or x.within_midnight_window);
 with selected as materialized(
  select x.*,private.dashboard_admin_live_provider_canonical(t->>'country',h.platform,x.raw_channel) as provider_value
  from private.withdraw_pending_capture_orders x where x.archive_id=h.id
 ), filtered as materialized(select *from selected where provider is null or provider_value=provider),
 page as(select *from filtered order by applied_at nulls last,order_no offset page_offset limit page_limit)
 select(select count(*)from filtered),(select coalesce(sum(x.amount),0)from filtered x),
  (select coalesce(jsonb_agg(jsonb_build_object('orderNumber',x.order_no,'amount',x.amount::text,
   'appliedAt',x.applied_at,'appliedDate',x.stat_date,'provider',x.provider_value,
   'rawProvider',x.raw_channel,'channelType',x.channel_type,'status',x.status,
   'waitHours',case when x.applied_at is not null and x.timezone=h.timezone
    and x.applied_at at time zone x.timezone<=h.snapshot_at
    then extract(epoch from h.snapshot_at-(x.applied_at at time zone x.timezone))/3600 end)
   order by x.applied_at nulls last,x.order_no),'[]')from page x)
 into n,amount,items;
 return jsonb_build_object('version',1,'available',true,'state','complete','basis','actual_capture',
  'date',d,'mode',mode,'observedAt',h.snapshot_at,'timezone',h.timezone,
  'platform',jsonb_build_object('id',t->>'id','name',t->>'name','country',t->>'country','team',t->>'team'),
  'currency',t->>'currency','windowStart',h.window_start,'windowEnd',h.window_end,
  'total',n,'amount',amount::text,'rows',items,'offset',page_offset,'limit',page_limit,'hasMore',page_offset+page_limit<n);
end $orders$;
revoke all on function private.dashboard_admin_live_pending_orders(jsonb)from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_live_pending_orders(jsonb)to authenticated;
create function public.dashboard_admin_live_pending_orders(p_request jsonb)returns jsonb
language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_pending_orders(p_request)$$;
revoke all on function public.dashboard_admin_live_pending_orders(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.dashboard_admin_live_pending_orders(jsonb)to authenticated;
do $gateway$
declare fn text;meta jsonb;catalog jsonb;pages jsonb;old_fn text;
begin
 select to_jsonb(p)-'prosrc'into meta from pg_proc p where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure;
 fn:=pg_get_functiondef('public.dashboard_admin_execute(text,jsonb)'::regprocedure);old_fn:=fn;
 fn:=replace(fn,'''details'',''query'',''analysisOrders''','''details'',''query'',''analysisOrders'',''pendingOrders''');
 fn:=replace(fn,'when ''pendingAnalysis'' then ''dashboard_admin_live_pending_analysis''',
  'when ''pendingAnalysis'' then ''dashboard_admin_live_pending_analysis'''||chr(10)||'  when ''pendingOrders'' then ''dashboard_admin_live_pending_orders''');
 if fn=old_fn then raise exception 'pending_orders_gateway_patch_missing';end if;
 execute fn;
 if(select to_jsonb(p)-'prosrc'from pg_proc p where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure)is distinct from meta then
  raise exception 'pending_orders_gateway_metadata_drift';end if;
 select to_jsonb(p)-'prosrc'into meta from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure;
 catalog:=private.dashboard_role_catalog();
 select jsonb_agg(case when p->>'id'='stuck'then jsonb_set(jsonb_set(p,'{label}','"代付中分析"'),'{requests}',p->'requests'||'"pendingOrders"'::jsonb)else p end order by ord)
 into pages from jsonb_array_elements(catalog->'pages')with ordinality as q(p,ord);
 catalog:=jsonb_set(catalog,'{pages}',pages);
 execute format('create or replace function private.dashboard_role_catalog()returns jsonb language sql immutable set search_path='''' as %L',
  'select '||quote_literal(catalog::text)||'::jsonb');
 if(select to_jsonb(p)-'prosrc'from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure)is distinct from meta then
  raise exception 'pending_orders_catalog_metadata_drift';end if;
end $gateway$;
notify pgrst,'reload schema';
commit;
