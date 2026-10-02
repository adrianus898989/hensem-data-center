-- Definition-only production baselines. No business payloads or credentials.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_pending_orders(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_pending_capture_day(p_day jsonb, p_catalog jsonb, p_heads jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r jsonb;rows jsonb:='[]';h jsonb;k text;n integer;verified boolean;timing_state text;
 on_time integer:=0;late integer:=0;
begin
 for r in select value from jsonb_array_elements(p_day->'rows')loop
  h:=null;verified:=false;k:=null;n:=0;
  if r->>'source'='wg'then
   r:=r||jsonb_build_object('observationSource','wg_midnight_snapshot','captureVerified',r->>'state'='complete',
    'midnightEligible',r->>'state'='complete'and r->>'timingState'='on_time');
  else
   select x->>'platform_key'into k from jsonb_array_elements(p_catalog)x where x->>'id'=r->>'id';
   select count(*)into n from jsonb_array_elements(p_heads)x
    where x->>'country_code'=r->>'scopeGroup'
     and private.dashboard_admin_pending_platform_key(x->>'country_code',x->>'platform')=k;
   if n=1 then select x into h from jsonb_array_elements(p_heads)x
    where x->>'country_code'=r->>'scopeGroup'
     and private.dashboard_admin_pending_platform_key(x->>'country_code',x->>'platform')=k;end if;
   verified:=r->>'state'='complete'and coalesce((h->>'captureVerified')::boolean,false);
   -- Current mutable summary is visible as an actual observation but cannot
   -- stand in for a receipt-verified, immutable midnight observation.
   timing_state:=case when not verified and r->>'timingState'='on_time'then 'unknown'else r->>'timingState'end;
   r:=r||jsonb_build_object('observationSource',case when verified then 'verified_archive'else 'current_summary'end,
    'captureVerified',verified,'archiveId',case when verified then h->>'archive_id'end,
    'timingState',timing_state,'midnightEligible',verified and timing_state='on_time');
  end if;
  if r->>'timingState'='on_time'then on_time:=on_time+1;elsif r->>'timingState'='late'then late:=late+1;end if;
  rows:=rows||jsonb_build_array(r);
 end loop;
 return p_day||jsonb_build_object('rows',rows,'onTimePlatformCount',on_time,'latePlatformCount',late);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_pending_capture_heads(p_catalog jsonb, p_scope jsonb, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with targets as materialized(select distinct x->>'scope_group' country,x->>'platform_key' platform_key,
   x->>'id' id,x->>'source' source,x->>'team' team,x->>'currency' currency,x->>'timezone' timezone
  from jsonb_array_elements(p_catalog)x where x->>'source'in('ar','newar','withdraw')),
 candidates as (
  select a.source_system,a.country_code,a.platform,a.stat_date,a.snapshot_at,
   case when a.within_midnight_window then 0 else 1 end priority,
   to_jsonb(a)||jsonb_build_object('archive_id',a.id,'captureVerified',true) data
  from private.withdraw_pending_capture_archive a
  where a.stat_date between p_start and p_end
   and private.dashboard_scope_allows(p_scope,a.country_code,a.platform)
   and exists(select 1 from targets t where t.country=a.country_code
    and t.platform_key=private.dashboard_admin_pending_platform_key(a.country_code,a.platform)
    and a.identity_status='resolved' and a.platform_id::text=t.id
    and a.native_source_system=case t.source when 'ar' then 'AR' when 'newar' then 'NEW_AR' end
    and a.team_name is not distinct from t.team and a.currency is not distinct from t.currency
    and a.timezone is not distinct from t.timezone)
  union all
  select b.source_system,b.country_code,b.platform,b.stat_date,b.snapshot_at,2,
   to_jsonb(b)||jsonb_build_object('archive_id',null,'captureVerified',false)
  from public.withdraw_pending_backlog_daily b
  where b.stat_date between p_start and p_end
   and private.dashboard_scope_allows(p_scope,b.country_code,b.platform)
   and exists(select 1 from targets t where t.country=b.country_code
    and t.platform_key=private.dashboard_admin_pending_platform_key(b.country_code,b.platform))
   -- An identity-rejected archive must not be bypassed by the mutable copy of
   -- that capture. Legacy-unbound archives cannot prove historical ownership.
   and not exists(select 1 from private.withdraw_pending_capture_archive a
    where a.source_system=b.source_system and a.country_code=b.country_code
     and a.platform=b.platform and a.stat_date=b.stat_date)
 ), ranked as (
  select c.*,dense_rank()over(partition by source_system,country_code,platform,stat_date
   order by priority,case when priority=0 then snapshot_at end asc,
    case when priority<>0 then snapshot_at end desc) pick from candidates c
 )select coalesce(jsonb_agg(data),'[]'::jsonb)from ranked where pick=1;
$function$;
revoke all on function private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date),private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb),private.dashboard_admin_live_pending_orders(jsonb)from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_live_pending_orders(jsonb)to authenticated;
