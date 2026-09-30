-- WG v3 read adapter for the existing withdrawal/operator/reason/config pages.
-- No source rows, source-table privileges, public RPC contracts, or other systems change.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $baseline$
declare x record; actual text; body text;
begin
 for x in select * from (values
  ('private.dashboard_admin_live_auto_withdraw(jsonb)','d5b20c1278340fdbb2709fafd92fb9aa','wg_existing_withdraw_v1'),
  ('private.dashboard_admin_live_withdraw_reasons(jsonb)','60ba567f98162549381ce7c4d7912ea5','wg_existing_reasons_v1'),
  ('private.dashboard_admin_live_payout_config(jsonb)','eec88f034ed9a00d50094d9334a5f7f0','wg_existing_config_v1'),
  ('private.dashboard_admin_live_withdraw_platforms()','9eb1b8bf1433ed68193ffd1dc48f9495','wg_existing_catalog_v1')) v(signature,fingerprint,marker)
 loop
  select md5(prosrc),prosrc into actual,body from pg_proc where oid=to_regprocedure(x.signature);
  if actual is distinct from x.fingerprint and coalesce(position(x.marker in body),0)=0 then
   raise exception 'WG existing-page baseline changed: %; review before applying',x.signature;
  end if;
 end loop;
end;
$baseline$;

create or replace function private.dashboard_admin_wg_withdraw_days(p_request jsonb,p_scope jsonb,p_start date,p_end date)
returns table(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
 auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,
 complete boolean,operator_rows jsonb,paying_count bigint,forced_count bigint,unknown_count bigint)
language sql stable security definer set search_path='' as $fn$
 with sites as materialized (
  select s.* from private.dashboard_admin_wg_sites() s
  where private.dashboard_scope_allows(p_scope,s.country_code,s.platform)
   and (case when p_request ? 'scopeTargets' then exists(
    select 1 from jsonb_array_elements(p_request->'scopeTargets') t where t->>'country'=s.country
     and exists(select 1 from jsonb_array_elements_text(t->'platforms') p where private.dashboard_admin_live_withdraw_key(p)=private.dashboard_admin_live_withdraw_key(s.platform)))
    else p_request->>'country'=s.country end)
   and (nullif(p_request->>'platform','') is null or private.dashboard_admin_live_withdraw_key(p_request->>'platform')=private.dashboard_admin_live_withdraw_key(s.platform))
   and (not p_request ? 'platforms' or jsonb_array_length(p_request->'platforms')=0 or nullif(p_request->>'platform','') is not null
    or exists(select 1 from jsonb_array_elements_text(p_request->'platforms') p where private.dashboard_admin_live_withdraw_key(p)=private.dashboard_admin_live_withdraw_key(s.platform)))
 ), orders as materialized (
  select d.*,s.country as display_country,s.platform as display_platform,(d.created_at at time zone s.timezone)::date as local_date
  from sites s join public.wg_withdraw_details d on d.site_code=s.site_code
  where d.created_at>=p_start::timestamp at time zone s.timezone and d.created_at<(p_end+1)::timestamp at time zone s.timezone
 ), days as materialized (
  select s.site_code,s.country,s.platform,c.business_date,
   bool_or(c.complete) and ((c.business_date+1)::timestamp at time zone max(s.timezone))<=statement_timestamp() complete
  from sites s join public.wg_detail_coverage c on c.site_code=s.site_code and c.business='withdraw' and c.basis='created'
  where c.business_date between p_start and p_end group by 1,2,3,4
  union all select distinct o.site_code,o.display_country,o.display_platform,o.local_date,false from orders o
  where not exists(select 1 from public.wg_detail_coverage c where c.site_code=o.site_code and c.business='withdraw' and c.basis='created' and c.business_date=o.local_date)
 ), operators as (
  select site_code,local_date,coalesce(nullif(btrim(business_fields->>'operator_name'),''),'（未知操作人）') account,
   count(*) processed,count(*) filter(where status_code=4) success,count(*) filter(where status_code=7) rejected,
   max(captured_at) source_updated_at,max(stored_at) updated_at
  from orders group by 1,2,3
 )
 select a.business_date,a.country,a.platform,private.dashboard_admin_live_withdraw_key(a.platform),count(o.order_number),
  count(o.order_number) filter(where o.status_code=4),count(o.order_number) filter(where o.status_code=7),
  count(o.order_number) filter(where o.business_fields->>'operator_class'='auto'),
  count(o.order_number) filter(where o.business_fields->>'operator_class'='manual'),null::numeric,
  max(o.captured_at),max(o.stored_at),a.complete,
  coalesce((select jsonb_agg(to_jsonb(r) order by r.account) from operators r where r.site_code=a.site_code and r.local_date=a.business_date),'[]'::jsonb),
  count(o.order_number) filter(where o.status_code=3),count(o.order_number) filter(where o.status_code=8),
  count(o.order_number) filter(where o.status_code not in(1,2,3,4,5,6,7,8))
 from days a left join orders o on o.site_code=a.site_code and o.local_date=a.business_date
 group by a.site_code,a.business_date,a.country,a.platform,a.complete;
$fn$;
revoke all on function private.dashboard_admin_wg_withdraw_days(jsonb,jsonb,date,date) from public,anon,authenticated;

-- The caller validates the existing reason request and checks fresh country/platform scope first.
-- A null response means no WG observation on this day, so the original legacy reader remains authoritative.
create or replace function private.dashboard_admin_wg_withdraw_reasons(p_request jsonb,p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare s record; day date:=(p_request->>'date')::date; k text:=coalesce(p_request->>'kind','blocking');
 blocking boolean:=k in('blocking','blockingOrders','blockingVariants'); off integer:=coalesce((p_request->>'offset')::integer,0);
 lim integer:=coalesce((p_request->>'limit')::integer,20); answer jsonb; completed boolean; observed boolean;
begin
 select * into s from private.dashboard_admin_wg_sites() t where t.country=p_request->>'country'
  and private.dashboard_admin_live_withdraw_key(t.platform)=private.dashboard_admin_live_withdraw_key(p_request->>'platform')
  and private.dashboard_scope_allows(p_scope,t.country_code,t.platform);
 if not found then return null;end if;
 select coalesce(bool_or(c.complete),false),count(*)>0 into completed,observed from public.wg_detail_coverage c
  where c.site_code=s.site_code and c.business='withdraw' and c.basis='created' and c.business_date=day;
 completed:=completed and ((day+1)::timestamp at time zone s.timezone)<=statement_timestamp();
 if not observed and not exists(select 1 from public.wg_withdraw_details d where d.site_code=s.site_code
  and d.created_at>=day::timestamp at time zone s.timezone and d.created_at<(day+1)::timestamp at time zone s.timezone) then return null;end if;
 with orders as materialized (
  select d.order_number,d.member_amount as amount,d.status_code,d.status_group,d.created_at,d.captured_at,
   nullif(btrim(d.business_fields->>'operator_name'),'') as operator,
   nullif(btrim(d.business_fields->>'interception_reason'),'') as blocking_note,
   case when d.status_code=7 then nullif(btrim(d.business_fields->>'rejection_reason'),'') end as rejection_note
  from public.wg_withdraw_details d where d.site_code=s.site_code
   and d.created_at>=day::timestamp at time zone s.timezone and d.created_at<(day+1)::timestamp at time zone s.timezone
 ), notes as materialized (
  select o.*,case when blocking then blocking_note else coalesce(rejection_note,'（源备注为空）') end note,
   case when not blocking then coalesce(rejection_note,'源备注为空') end category
  from orders o where (blocking and blocking_note is not null) or (not blocking and status_code=7)
 ), selected as materialized (
  select * from notes where (nullif(p_request->>'reasonKey','') is null or md5(note)=p_request->>'reasonKey')
   and (nullif(p_request->>'category','') is null or md5(category)=p_request->>'category')
   and (nullif(p_request->>'operatorKey','') is null or md5(coalesce(operator,''))=p_request->>'operatorKey')
   and (nullif(btrim(p_request->>'query'),'') is null or position(lower(btrim(p_request->>'query')) in lower(order_number))>0)
 ), reason_groups as (
  select note reason,md5(note) "reasonKey",count(*) count,note "sourceReason",1::bigint "sourceVariantCount",
   count(*) filter(where status_code=4) success,count(*) filter(where status_code=7) rejected,
   count(*) filter(where status_code not in(4,7)) other from selected group by note
 ), categories as (
  select category,md5(category) "categoryKey",count(*) count,min(rejection_note) "sourceReason",
   count(distinct rejection_note) "sourceVariantCount" from selected group by category
 ), operators as (
  select operator,md5(coalesce(operator,'')) "operatorKey",count(*) count,count(distinct category) "categoryCount",
   count(*) filter(where rejection_note is null) "missingReasonCount" from selected group by operator
 ), rendered as (
  select to_jsonb(g) item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups g where k in('blocking','rejection')
  union all select to_jsonb(g)||jsonb_build_object('canonicalReason',g.reason),g.count,g.reason,null::timestamptz from reason_groups g where k='blockingVariants'
  union all select to_jsonb(g),g.count,g.category,null::timestamptz from categories g where k='categories'
  union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamptz from operators g where k='operators'
  union all select jsonb_build_object('orderNumber',order_number,'amount',amount,'currency',s.currency,'status',status_group,'statusCode',status_code,
   'operator',operator,'operatorKey',md5(coalesce(operator,'')),'createdAt',created_at,'completedAt',null,
   'manualRemark',blocking_note,'rejectionReason',rejection_note,'category',category,'categoryKey',md5(category),'reasonKey',md5(note),
   'blockingReason',case when blocking then note end,'blockingActualValue',null,'blockingActualField',null,'blockingThreshold',null),
   0,order_number,created_at from selected where k in('orders','blockingOrders')
 )
 select jsonb_build_object('available',true,'source','WG 实时明细（脱敏业务文本）','basis',case when blocking then 'interception_reason' else 'rejection_reason' end,
  'country',s.country,'platform',s.platform,'date',day,'kind',k,'total',(select count(*) from rendered),'offset',off,'limit',lim,
  'rows',coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
   (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset off limit lim) p),'[]'::jsonb),
  'noteCount',(select count(*) from notes),'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.count desc,c.category) from categories c),'[]'::jsonb),
  'summary',jsonb_build_object('totalRejected',(select count(*) from orders where status_code=7),
   'missingReason',(select count(*) from notes where rejection_note is null and not blocking),
   'withOperator',(select count(*) from notes where operator is not null),'operators',(select count(distinct operator) from notes),
   'selectedCount',(select count(*) from selected)),
  'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','created_at','operatorBasis','current_latest_operator',
  'coverage',jsonb_build_object('collected',(select count(*) from orders),'expected',null,'complete',completed,
   'rejected',(select count(*) from orders where status_code=7),'withManualRemark',(select count(*) from orders where blocking_note is not null)),
  'updatedAt',(select max(captured_at) from orders),'latestSnapshotDate',null,'snapshotFallback',false) into answer;
 return answer;
end;
$fn$;
revoke all on function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) from public,anon,authenticated;

create or replace function private.dashboard_admin_wg_payout_config(p_request jsonb,p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare targets jsonb; target jsonb; summaries jsonb:='[]'::jsonb; snap jsonb; cfg jsonb; chosen jsonb; result_snapshot jsonb;
begin
 -- Only the five collector sites, never an obsolete sibling from wg_config_targets.
 select coalesce(jsonb_agg(t order by t->>'country_code'),'[]'::jsonb) into targets from (
  select jsonb_build_object('country_code',s.country_code,'country_name',s.country,'platform',case s.country_code when 'BR' then '26BET' else '98VV' end,
   'timezone',s.timezone,'site_code',case s.country_code when 'BR' then '278' else '3257' end,'display_group',s.country_code,'display_name',s.country,
   'members',jsonb_agg(jsonb_build_object('site_code',s.site_code,'name',s.platform) order by s.site_code)) t
  from private.dashboard_admin_wg_sites() s where private.dashboard_scope_allows(p_scope,s.country_code,s.platform)
  group by s.country_code,s.country,s.timezone
 ) q;
 for target in select value from jsonb_array_elements(targets) loop
  select jsonb_build_object('country_code',d.country_code,'platform',d.platform,'timezone',d.timezone,'observed_at',d.observed_at,
   'observed_local_date',d.observed_local_date,'received_at',d.received_at,'parser_version',d.parser_version,'configuration',d.configuration,'source','WG 实时每日配置')
   into snap from public.wg_realtime_config_daily d where d.site_code=target->>'site_code' order by d.observed_at desc limit 1;
  if snap is null then
   select jsonb_build_object('country_code',d.country_code,'platform',d.platform,'timezone',d.timezone,'observed_at',d.observed_at,
    'observed_local_date',d.observed_local_date,'received_at',d.received_at,'parser_version',d.parser_version,'configuration',d.configuration,'source','WG 历史配置快照')
    into snap from public.wg_config_daily d where d.country_code=target->>'country_code' and d.platform=target->>'platform' order by d.observed_at desc limit 1;
  end if;
  if snap is not null then
   summaries:=summaries||jsonb_build_array(snap-'configuration'-'received_at'-'parser_version');
  end if;
  if target->>'country_code'=p_request->>'country' and target->>'platform'=p_request->>'platform' then
   chosen:=target;
   if snap is not null then
    if jsonb_typeof(snap#>'{configuration,settings}') is distinct from 'object'
     or jsonb_typeof(snap#>'{configuration,dictionaries}') is distinct from 'object'
     or jsonb_typeof(snap#>'{configuration,completeness}') is distinct from 'object' then
     raise exception using errcode='22023',message='config_snapshot_incomplete';end if;
    cfg:=private.dashboard_admin_config_projection('WG',snap->'configuration');
    cfg:=jsonb_set(cfg,'{settings}',coalesce((select jsonb_object_agg(k,v) from jsonb_each(cfg->'settings') e(k,v)
     where k='0' or exists(select 1 from jsonb_array_elements(target->'members') m where m->>'site_code'=k)),'{}'::jsonb));
    result_snapshot:=snap||jsonb_build_object('configuration',cfg);
   end if;
  end if;
 end loop;
 if coalesce(p_request->>'operation','index')='index' then
  return jsonb_build_object('version',1,'system','WG','targets',targets,'summaries',summaries,'readOnly',true);
 end if;
 if chosen is null then raise exception using errcode='42501',message='config_target_denied';end if;
 return jsonb_build_object('version',1,'system','WG','target',chosen,'snapshot',result_snapshot,'readOnly',true);
end;
$fn$;
revoke all on function private.dashboard_admin_wg_payout_config(jsonb,jsonb) from public,anon,authenticated;

-- Protected, idempotent patch: preserve the current live source adapters and ACLs.
do $patch$
declare definition text; old text; replacement text; pairs jsonb; pair jsonb;
begin
 select pg_get_functiondef('private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure) into definition;
 if position('wg_existing_withdraw_v1' in definition)=0 then
  if position('scope_targets_v1' in definition)=0 then raise exception 'WG withdrawal baseline lacks scopeTargets; review before applying';end if;
  pairs:=jsonb_build_array(
   jsonb_build_array(' v_targets jsonb;v_target jsonb;v_game_part jsonb;v_target_platforms text[];',
    ' v_targets jsonb;v_target jsonb;v_game_part jsonb;v_target_platforms text[];v_wg_days jsonb;'),
   jsonb_build_array(' with selected_targets as materialized (',$new$ select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) into v_wg_days
 from private.dashboard_admin_wg_withdraw_days(p_request,v_scope,v_before,v_end) w;
 with selected_targets as materialized ($new$),
   jsonb_build_array(' ), daily_source as materialized (',' ), prior_daily_source as materialized ('),
   jsonb_build_array(' ), operator_source as materialized (',' ), prior_operator_source as materialized ('),
   jsonb_build_array(' ), daily as materialized (',$new$ ), wg_days as materialized (
  select * from jsonb_to_recordset(v_wg_days) w(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,
   complete boolean,operator_rows jsonb,paying_count bigint,forced_count bigint,unknown_count bigint)
 ), daily_source as materialized (
  select p.* from prior_daily_source p where not exists(select 1 from wg_days w where w.data_date=p.data_date and w.country=p.country and w.platform_key=p.platform_key)
  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at from wg_days
 ), operator_source as materialized (
  select p.*,greatest(p.processed-p.rejected,0) as success from prior_operator_source p
   where not exists(select 1 from wg_days w where w.data_date=p.data_date and w.country=p.country and w.platform_key=p.platform_key)
  union all select w.data_date,w.country,w.platform,w.platform_key,r->>'account',(r->>'processed')::bigint,(r->>'rejected')::bigint,
   null::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,(r->>'success')::bigint
  from wg_days w cross join lateral jsonb_array_elements(w.operator_rows) r
 ), daily as materialized ($new$),
   jsonb_build_array('(data_date>=v_start) current_period,sum(processed)::bigint processed,sum(rejected)::bigint rejected,',
    '(data_date>=v_start) current_period,sum(processed)::bigint processed,sum(rejected)::bigint rejected,sum(success)::bigint success,'),
   jsonb_build_array('greatest(d.processed-d.rejected,0)','d.success'),
   jsonb_build_array('greatest(p.processed-p.rejected,0),''rejected''','p.success,''rejected'''),
   jsonb_build_array('''success'',sum(greatest(processed-rejected,0))','''success'',sum(success)'),
   jsonb_build_array(' return v_result;',$new$ -- wg_existing_withdraw_v1: only observed WG site-days replace legacy, never add both.
 if jsonb_array_length(v_wg_days)>0 then
  v_result:=v_result||jsonb_build_object('wgCoverage',(
   select jsonb_build_object('timeBasis','created_at','operatorBasis','current_latest_operator',
    'complete',bool_and(w.complete) and count(*)=count(distinct(w.country,w.platform))*(v_end-v_before+1),
    'currentComplete',coalesce(bool_and(w.complete) filter(where w.data_date>=v_start),false)
      and count(*) filter(where w.data_date>=v_start)=count(distinct(w.country,w.platform))*v_days,
    'previousComplete',coalesce(bool_and(w.complete) filter(where w.data_date<v_start),false)
      and count(*) filter(where w.data_date<v_start)=count(distinct(w.country,w.platform))*v_days,
    'days',jsonb_agg(jsonb_build_object('country',w.country,'platform',w.platform,'date',w.data_date,'complete',w.complete,
     'collected',w.total,'paying',w.paying_count,'forced',w.forced_count,'unknown',w.unknown_count) order by w.country,w.platform,w.data_date))
   from jsonb_to_recordset(v_wg_days) w(country text,platform text,data_date date,complete boolean,total bigint,paying_count bigint,forced_count bigint,unknown_count bigint)));
  if (v_result#>>'{wgCoverage,complete}')::boolean is not true then v_result:=jsonb_set(v_result,'{comparison,complete}','false'::jsonb);end if;
 end if;
 return v_result;$new$)
  );
  for pair in select value from jsonb_array_elements(pairs) loop
   old:=pair->>0;replacement:=pair->>1;
   if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'WG withdrawal baseline changed at %; review before applying',left(old,90);end if;
   definition:=replace(definition,old,replacement);
  end loop;
  execute definition;
 end if;
 select pg_get_functiondef('private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure) into definition;
 if position('wg_existing_reasons_v1' in definition)=0 then
  old:=' select * into v_meta from private.dashboard_admin_live_platforms() p where p.country=v_country';
  replacement:=$new$ -- wg_existing_reasons_v1: existing request validation and scope checks ran above.
 v_rows:=private.dashboard_admin_wg_withdraw_reasons(p_request,v_scope);
 if v_rows is not null then return v_rows;end if;
 select * into v_meta from private.dashboard_admin_live_platforms() p where p.country=v_country$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'WG reason baseline changed; review before applying';end if;
  execute replace(definition,old,replacement);
 end if;
 select pg_get_functiondef('private.dashboard_admin_live_payout_config(jsonb)'::regprocedure) into definition;
 if position('wg_existing_config_v1' in definition)=0 then
  old:=$old$  elsif v_system='WG' then
    select$old$;
  replacement:=$new$  elsif v_system='WG' then
    -- wg_existing_config_v1: parent snapshots projected to authorized member settings only.
    return private.dashboard_admin_wg_payout_config(p_request,v_scope);
    select$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'WG config baseline changed; review before applying';end if;
  execute replace(definition,old,replacement);
 end if;
end;
$patch$;

-- Existing ownership mapping and scope rules remain authoritative for selector options.
do $catalog$
declare definition text; old text; replacement text;
begin
 select pg_get_functiondef('private.dashboard_admin_live_withdraw_platforms()'::regprocedure) into definition;
 if position('wg_existing_catalog_v1' in definition)>0 then return;end if;
 old:=$old$    from public.auto_withdraw_daily a
    where nullif(btrim(a.country),'') is not null and nullif(btrim(a.platform),'') is not null$old$;
 replacement:=old||$new$
    -- wg_existing_catalog_v1: identities keep the existing withdrawal catalog's mapping/scope.
    union select s.country,s.platform,s.country_code from private.dashboard_admin_wg_sites() s$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'WG withdrawal catalog baseline changed; review before applying';end if;
 execute replace(definition,old,replacement);
 select pg_get_functiondef('private.dashboard_admin_live_withdraw_platforms()'::regprocedure) into definition;
 old:=' select distinct w.id,w.name,w.team,w.country,w.scope_group,w.source,w.timezone,w.currency,w.source_name from withdraw_targets w;';
 replacement:=$new$ select distinct coalesce(md5('WG:'||s.site_code)::uuid,w.id),w.name,w.team,w.country,w.scope_group,
  case when s.site_code is null then w.source else 'wg' end,w.timezone,w.currency,w.source_name
 from withdraw_targets w left join private.dashboard_admin_wg_sites() s on s.country=w.country
  and private.dashboard_admin_live_withdraw_key(s.platform)=private.dashboard_admin_live_withdraw_key(w.name);$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'WG withdrawal catalog identity baseline changed; review before applying';end if;
 execute replace(definition,old,replacement);
end;
$catalog$;
notify pgrst,'reload schema';
commit;
