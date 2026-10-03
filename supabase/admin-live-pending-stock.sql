-- Reviewed read-only projection draft. No source-table/schema/collector mutation.
-- Explicit modes reuse overview's existing pendingSnapshot permission and RPC.
-- Legacy requests retain their original seven-day contract and function ACL/OID.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $baseline$
declare p pg_proc%rowtype; r record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_pending_snapshot(jsonb)');
 if not found or md5(p.prosrc)<>'cae9ce8fc354621eea3754872768e88d'
  or p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then
  raise exception 'pending_stock_baseline_drift';end if;
 if to_regprocedure('private.dashboard_admin_pending_stock_legacy_v1(jsonb)') is not null
  or to_regprocedure('private.dashboard_admin_pending_stock_row_v1(jsonb,text[],integer,text,date)') is not null then
  raise exception 'pending_stock_objects_exist';end if;
 for r in select * from(values
  ('private.dashboard_admin_pending_resolve(jsonb,jsonb)','b2923536c9275990e8689ffb40631146'),
  ('private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date)','9b7e0bc4551884b54f01a5ca0134f6a5'),
  ('private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb)','6fa40fa54d1483f06df4d4f92710e06f')
 )v(signature,source_md5) loop
  select * into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(p.prosrc)<>r.source_md5 or p.proowner<>'postgres'::regrole
   or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
   or p.proacl::text is distinct from '{postgres=X/postgres}' then
   raise exception 'pending_stock_dependency_drift: %',r.signature;end if;
 end loop;
 for r in select * from(values
  ('public.game66_withdraw_orders','public.game66_withdraw_orders_platform_status_idx',array['platform_id','status_code']),
  ('public.wg_withdraw_details','public.wg_withdraw_details_status',array['site_code','status_group']),
  ('public.lg_orders','public.lg_orders_pending_dates',array['platform','order_kind']),
  ('public.lg_pending_runs','public.lg_pending_runs_scope',array['platform','country_code','capture_date']),
  ('public.lg_pending_snapshot_orders','public.lg_pending_snapshot_orders_pkey',array['snapshot_id']),
  ('public.lg_pending_chunks','public.lg_pending_chunks_pkey',array['snapshot_id'])
 )v(table_name,index_name,leading_columns) loop
  if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indrelid
   where i.indexrelid=to_regclass(r.index_name) and i.indrelid=to_regclass(r.table_name)
    and i.indisvalid and i.indisready and c.relowner='postgres'::regrole
    and (i.indpred is null and r.index_name<>'public.lg_orders_pending_dates'
     or r.index_name='public.lg_orders_pending_dates'and pg_get_expr(i.indpred,i.indrelid)='(status_class = ANY (ARRAY[''pending''::text, ''unknown''::text]))')
    and (select array_agg(a.attname::text order by k.n) from unnest(i.indkey)with ordinality k(attnum,n)
     join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
     where k.n<=cardinality(r.leading_columns))=r.leading_columns) then
   raise exception 'pending_stock_safe_index_required: %',r.index_name;end if;
 end loop;
 -- Copy the exact old body into an owner-only helper, rather than rewriting it.
 select * into p from pg_proc where oid='private.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure;
 execute format('create function private.dashboard_admin_pending_stock_legacy_v1(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path='''' as %L',p.prosrc);
end $baseline$;
revoke all on function private.dashboard_admin_pending_stock_legacy_v1(jsonb) from public,anon,authenticated,service_role;

-- Owner-only adapter. Caller has already resolved every selected identity/scope.
-- A fixed 20k request-wide row budget bounds reads through verified status/PK indexes.
create function private.dashboard_admin_pending_stock_row_v1(p jsonb,providers text[],budget integer,mode text,display_date date)
returns jsonb language plpgsql stable security invoker set search_path='' as $row$
declare src text:=p->>'source'; q text; result jsonb; head record; ties integer;
 site text; capture uuid; expected bigint; chunk_n bigint; chunk_rows bigint;
 whole boolean:=false; verified boolean:=false; receipt_valid boolean:=false; scope_name text:='received_latest_order_rows';
 state_name text:='partial'; reason_name text:='stored_status_not_source_complete'; observed timestamptz;
 local_day date; target timestamptz; read_n bigint; known_n bigint; known_amount text;
begin
 if budget<1 then return jsonb_build_object('state','missing','reason','query_budget_exhausted','readRows',0);end if;
 if nullif(p->>'currency','') is null or nullif(p->>'timezone','') is null then
  return jsonb_build_object('state','unsupported','reason','metadata_missing','readRows',0);end if;
 if src='lg' then
  local_day:=(statement_timestamp() at time zone (p->>'timezone'))::date;
  if mode='midnight' then target:=display_date::timestamp at time zone (p->>'timezone');end if;
  select r.snapshot_id,r.observed_at,r.captured_at,r.expected_count,r.expected_chunks,
   r.source_total,r.fetched_count,r.pending_window_days into head
  from public.lg_pending_runs r
  where r.platform=p->>'source_name' and r.country_code=p->>'scope_group'
   and r.status in('published','superseded')
   and (mode='current' and r.capture_date between local_day-2 and local_day and r.pending_window_days is null
    or mode='midnight' and r.capture_date=display_date and r.observed_at>=target and r.observed_at<=target+interval '5 minutes')
  order by case when mode='current' then r.observed_at end desc,
   case when mode='midnight' then r.observed_at end asc,r.captured_at desc,r.snapshot_id limit 1;
  if found then
   select count(*) into ties from public.lg_pending_runs r
    where r.platform=p->>'source_name' and r.country_code=p->>'scope_group'
     and r.capture_date=(head.observed_at at time zone (p->>'timezone'))::date
     and r.status in('published','superseded') and r.observed_at=head.observed_at
     and r.captured_at=head.captured_at and r.pending_window_days is not distinct from head.pending_window_days;
   if ties<>1 then return jsonb_build_object('state','ambiguous','reason','target_ambiguous','readRows',0);end if;
   capture:=head.snapshot_id; expected:=head.expected_count; observed:=head.observed_at;
   scope_name:=case when head.pending_window_days is null then 'all_current_pending'else 'last_7_created_days'end;
   select count(*),coalesce(sum(c.order_count),0) into chunk_n,chunk_rows
    from public.lg_pending_chunks c where c.snapshot_id=capture;
   receipt_valid:=expected>=0 and head.source_total=expected and head.fetched_count=expected
    and chunk_n=head.expected_chunks and chunk_rows=expected
    and head.captured_at>=observed and head.captured_at<=statement_timestamp()
    and observed<=statement_timestamp();
   if not coalesce(receipt_valid,false)then return jsonb_build_object('state','invalid','reason','receipt_inconsistent','readRows',0);end if;
   verified:=receipt_valid and expected<=budget;
   whole:=verified and head.pending_window_days is null;
   if mode='current' and observed<statement_timestamp()-interval '15 minutes' then
    state_name:='stale';reason_name:='latest_capture_stale';whole:=false;
   elsif expected>budget then state_name:='partial';reason_name:='query_budget_exhausted';whole:=false;
   elsif head.pending_window_days=7 then reason_name:='last_7_created_days_only';
   else state_name:='complete';reason_name:=null;end if;
   q:=$source$select s.order_amount member_amount,$1->>'currency' member_currency,
    coalesce(nullif(btrim(s.third_party),''),nullif(btrim(s.raw_channel),''),'未识别通道') raw_provider,
    coalesce(nullif(btrim(s.payment_method),''),'其他类型') channel_type,
    null::text settlement_currency,null::numeric settlement_amount,null::timestamptz record_at,true eligible_row
    from public.lg_pending_snapshot_orders s where s.snapshot_id=$4 limit ($3+1)$source$;
  elsif mode='midnight' then return jsonb_build_object('state','missing','reason','full_capture_missing','readRows',0);
  else
   -- Date-window sync does not prove source-complete current inventory.
   q:=$source$select s.metric_amount member_amount,$1->>'currency' member_currency,
    coalesce(nullif(btrim(s.third_party),''),nullif(btrim(s.raw_channel),''),'未识别通道') raw_provider,
    coalesce(nullif(btrim(s.payment_method),''),'其他类型') channel_type,
    null::text settlement_currency,null::numeric settlement_amount,s.updated_at record_at,
    s.country_code=$1->>'scope_group'and s.source_system='LG'and s.status_class='pending' eligible_row
    from public.lg_orders s where s.platform=$1->>'source_name' and s.order_kind='withdraw'
     and s.status_class in('pending','unknown') limit ($3+1)$source$;
  end if;
 elsif mode='midnight' then return jsonb_build_object('state','missing','reason','full_capture_missing','readRows',0);
 elsif src='game66' then
  q:=$source$select coalesce(s.amount_display,s.amount_minor/100.0) member_amount,$1->>'currency' member_currency,
   coalesce(nullif(btrim(s.pay_channel),''),nullif(btrim(s.pay_method_name),''),'未识别通道') raw_provider,
   coalesce(nullif(btrim(s.payout_mode),''),'其他类型') channel_type,
   null::text settlement_currency,null::numeric settlement_amount,s.last_seen_at record_at,true eligible_row
   from public.game66_withdraw_orders s where s.platform_id=($1->>'id')::uuid and s.status_code='1' limit ($3+1)$source$;
 elsif src='wg' then
  select s.site_code into site from private.dashboard_admin_wg_sites() s
   where s.country_code=p->>'scope_group' and s.platform=p->>'source_name';
  if site is null then return jsonb_build_object('state','missing','reason','metadata_missing','readRows',0);end if;
  q:=$source$select s.member_amount,s.member_currency,
   coalesce(nullif(btrim(s.provider),''),nullif(btrim(s.channel),''),'未识别通道') raw_provider,
   '其他类型'::text channel_type,s.settlement_currency,s.settlement_amount,s.stored_at record_at,s.status_code=3 eligible_row
   from public.wg_withdraw_details s where s.site_code=$5 and s.status_group='paying' limit ($3+1)$source$;
 else return jsonb_build_object('state','missing','reason','safe_current_layer_unavailable','readRows',0);
 end if;
 execute $aggregate$
 with source as materialized($aggregate$||q||$aggregate$),
 bounded as materialized(select * from source limit $3),
 names as materialized(select distinct raw_provider from bounded where eligible_row),
 mappings as materialized(select raw_provider,private.dashboard_admin_live_provider_canonical($1->>'country',$1->>'source_name',raw_provider) provider from names),
 chosen as materialized(select s.*,m.provider,
  member_currency=$1->>'currency' and member_amount>=0 and member_amount::text not in('NaN','Infinity','-Infinity') valid_amount,
  settlement_currency~'^[A-Z][A-Z0-9]{1,11}$'and settlement_amount>=0 and settlement_amount::text not in('NaN','Infinity','-Infinity') valid_settlement
  from bounded s join mappings m using(raw_provider) where s.eligible_row and(cardinality($2)=0 or m.provider=any($2))),
 grouped as materialized(select provider,raw_provider,channel_type,count(*) n,
  sum(member_amount)filter(where valid_amount) a,count(*)filter(where not coalesce(valid_amount,false)) amount_missing
  from chosen group by 1,2,3),
 settlements as(select settlement_currency currency,count(*) n,sum(settlement_amount)amount from chosen where valid_settlement group by 1),
 summary as(select count(*) n,sum(member_amount)filter(where valid_amount)a,
  count(*)filter(where not coalesce(valid_amount,false))amount_missing,max(record_at)last_record_at from chosen)
 select jsonb_build_object('sourceRows',(select count(*)from source),'readRows',(select count(*)from bounded),
  'knownCount',s.n,'knownAmount',s.a::text,'amountUnknownCount',s.amount_missing,'lastRecordAt',s.last_record_at,
  'groupsLimited',(select count(*)from grouped)>200,
  'groups',(select coalesce(jsonb_agg(jsonb_build_object('provider',g.provider,'rawChannel',g.raw_provider,'channelType',g.channel_type,
   'currency',$1->>'currency','knownCount',g.n,'knownAmount',g.a::text,'amountUnknownCount',g.amount_missing,
   'count',null,'amount',null,'settlementAmounts','[]'::jsonb)order by g.n desc,g.provider),'[]'::jsonb)from(select * from grouped order by n desc,provider limit 200)g),
  'settlementAmounts',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'amount',amount::text,'count',n,
   'missingCount',(select count(*)from chosen where not coalesce(valid_settlement,false)),'state','partial')order by currency),'[]'::jsonb)from settlements))
 from summary s
 $aggregate$ into result using p,providers,budget,capture,site;
 read_n:=(result->>'readRows')::bigint;known_n:=(result->>'knownCount')::bigint;known_amount:=result->>'knownAmount';
 if capture is not null and expected<=budget and (result->>'sourceRows')::bigint is distinct from expected then
  verified:=false;whole:=false;state_name:='invalid';reason_name:='receipt_inconsistent';end if;
 if (result->>'sourceRows')::bigint>budget and state_name not in('invalid','stale')then whole:=false;state_name:='partial';reason_name:='query_budget_exhausted';end if;
 if (result->>'amountUnknownCount')::bigint>0 and state_name<>'invalid'then whole:=false;state_name:='partial';reason_name:='source_currency_mismatch';end if;
 -- Empty stored/subset rows never prove source zero; receipt-verified zero may.
 if known_n=0 and not verified then known_n:=null;known_amount:=null;
 elsif known_n=0 then known_amount:='0';end if;
 if state_name='invalid' then known_n:=null;known_amount:=null;result:=result||jsonb_build_object('groups','[]'::jsonb,'settlementAmounts','[]'::jsonb);end if;
 return result||jsonb_build_object('state',state_name,'reason',reason_name,'coverageScope',scope_name,
  'freshnessState',case when observed is null then 'unverified'when mode='current'and observed<statement_timestamp()-interval '15 minutes'then 'stale'else 'fresh'end,
  'wholeStockComplete',whole,'windowComplete',verified,'captureVerified',verified,
  'midnightEligible',mode='midnight'and verified,'captureId',capture,'observedAt',observed,
  'knownCount',known_n,'knownAmount',known_amount,'count',case when whole then known_n end,'amount',case when whole then known_amount end,
  'settlementState',case when src='wg' then 'partial'else 'unavailable'end);
end $row$;
revoke all on function private.dashboard_admin_pending_stock_row_v1(jsonb,text[],integer,text,date) from public,anon,authenticated,service_role;
do $private_acl$
declare r record;
begin
 for r in select p.oid::regprocedure signature,a.grantee
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
  where p.oid in('private.dashboard_admin_pending_stock_legacy_v1(jsonb)'::regprocedure,
   'private.dashboard_admin_pending_stock_row_v1(jsonb,text[],integer,text,date)'::regprocedure)
   and a.grantee<>p.proowner loop
  execute format('revoke all on function %s from %s',r.signature,
   case when r.grantee=0 then 'public'else quote_ident(pg_get_userbyid(r.grantee))end);
 end loop;
end $private_acl$;

create or replace function private.dashboard_admin_live_pending_snapshot(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $reader$
declare scope jsonb; catalog jsonb; heads jsonb; day jsonb; item jsonb; row_value jsonb; t record;
 display_date date; source_date date; providers text[]:='{}'; rows jsonb:='[]'; mode text;
 n bigint:=0;a numeric:=0;known boolean:=false;all_complete boolean:=true;complete_n integer:=0;
 remaining integer:=20000;currency text;metadata jsonb;amount_known boolean:=false;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' then raise exception using errcode='22023',message='invalid_request';end if;
 if not(p_request ? 'mode') then return private.dashboard_admin_pending_stock_legacy_v1(p_request);end if;
 mode:=p_request->>'mode';
 if jsonb_typeof(p_request->'mode')is distinct from 'string'or mode is null or mode not in('current','midnight') or octet_length(p_request::text)>65536
  or exists(select 1 from jsonb_object_keys(p_request)k where k<>all(array['mode','date','platformIds','providers']))
  or mode='current' and p_request ? 'date'
  or mode='midnight' and jsonb_typeof(p_request->'date')is distinct from 'string' then
  raise exception using errcode='22023',message='invalid_request';end if;
 if mode='midnight' then
  begin display_date:=(p_request->>'date')::date;
  exception when others then raise exception using errcode='22023',message='invalid_date';end;
  if display_date<date '2000-01-02' or display_date>current_date+1 or to_char(display_date,'YYYY-MM-DD')<>p_request->>'date' then
   raise exception using errcode='22023',message='invalid_date';end if;
  source_date:=display_date-1;
 end if;
 scope:=private.dashboard_admin_live_scope();
 catalog:=private.dashboard_admin_pending_resolve((p_request-array['mode','date'])||jsonb_build_object('date',coalesce(source_date,current_date)),scope);
 if mode='midnight'and exists(select 1 from jsonb_array_elements(catalog)x
  where display_date>(statement_timestamp() at time zone(x->>'timezone'))::date)then
  raise exception using errcode='22023',message='invalid_date';end if;
 select min(x->>'currency')into currency from jsonb_array_elements(catalog)x;
 if p_request ? 'providers' then select coalesce(array_agg(value),'{}')into providers from jsonb_array_elements_text(p_request->'providers');end if;
 if mode='midnight' then
  heads:=private.dashboard_admin_pending_capture_heads(catalog,scope,source_date,source_date);
  day:=private.dashboard_admin_pending_capture_day(private.dashboard_admin_pending_observation(
   private.dashboard_admin_pending_resolved_day((p_request-array['mode','date'])||jsonb_build_object('date',source_date),scope,catalog,heads)),catalog,heads);
 end if;
 for t in select x->>'scope_group'country,x->>'platform_key'platform_key,
  case when x->>'source'in('ar','newar','withdraw')then 'withdraw_review'else x->>'source'end family,
  (jsonb_agg(x order by(x->>'source'='withdraw'),x->>'id')->0)p,
  jsonb_agg(x->>'id'order by x->>'id')ids,
  bool_or(coalesce((x->>'mapping_ambiguous')::boolean,false)or x->>'team'='__team_conflict__')or count(distinct x->>'team')>1 ambiguous
  from jsonb_array_elements(catalog)x group by 1,2,3 order by 1,2,3 loop
  item:=t.p;
  metadata:=jsonb_build_object('id',item->>'id','selectedIds',t.ids,'name',item->>'name','source',item->>'source',
   'scopeGroup',item->>'scope_group','currency',item->>'currency','timezone',item->>'timezone',
   'date',display_date,'sourceDate',source_date,'wholeStockComplete',false,'windowComplete',false,
   'knownCount',null,'knownAmount',null,'count',null,'amount',null,'observedAt',null,'captureId',null,
   'coverageScope','unavailable','groups','[]'::jsonb,'settlementAmounts','[]'::jsonb,'settlementState','unavailable');
  if t.ambiguous then row_value:=jsonb_build_object('state','ambiguous','reason','target_ambiguous');
  elsif mode='midnight' and item->>'source'<>'lg' then
   select r into row_value from jsonb_array_elements(day->'rows')r where r->>'id'=item->>'id';
   if row_value is null then row_value:=jsonb_build_object('state','missing','reason','full_capture_missing');
   elsif row_value->>'state'='complete'and coalesce((row_value->>'midnightEligible')::boolean,false) then
    row_value:=row_value||jsonb_build_object('state','partial','reason','last_7_created_days_only','coverageScope','last_7_created_days',
     'windowComplete',true,'wholeStockComplete',false,'knownCount',row_value->'count','knownAmount',row_value->'amount',
     'count',null,'amount',null,'observedAt',row_value->'snapshotAt','captureId',row_value->'archiveId',
     'groups',(select coalesce(jsonb_agg(g||jsonb_build_object('currency',item->>'currency','knownCount',g->'count','knownAmount',g->'amount',
      'count',null,'amount',null,'settlementAmounts','[]'::jsonb)),'[]')from jsonb_array_elements(row_value->'groups')g));
   else
    row_value:=row_value||jsonb_build_object('state','missing','reason',case when coalesce((row_value->>'captureVerified')::boolean,false)
     then 'outside_midnight_window'else 'capture_not_verified'end,'knownCount',null,'knownAmount',null,'count',null,'amount',null,'groups','[]'::jsonb);
   end if;
  else
   begin
    row_value:=private.dashboard_admin_pending_stock_row_v1(item,providers,remaining,mode,display_date);
   exception when data_exception then
    -- Platform data errors preserve other known rows; cancellation/auth errors propagate.
    row_value:=jsonb_build_object('state','invalid','reason','source_currency_mismatch','readRows',0);
   end;
   remaining:=greatest(0,remaining-coalesce((row_value->>'readRows')::integer,0));
  end if;
  -- Candidate-row counts are internal budgets, not cross-country business data.
  row_value:=metadata||(row_value-array['sourceRows','readRows']);
  if coalesce((row_value->>'wholeStockComplete')::boolean,false) then complete_n:=complete_n+1;else all_complete:=false;end if;
  if row_value->>'knownCount'is not null then known:=true;n:=n+(row_value->>'knownCount')::bigint;end if;
  if row_value->>'knownAmount'is not null then amount_known:=true;a:=a+(row_value->>'knownAmount')::numeric;end if;
  rows:=rows||jsonb_build_array(row_value);
 end loop;
 if jsonb_array_length(rows)=0 then all_complete:=false;end if;
 return jsonb_build_object('version',2,'mode',mode,'basis',case mode when 'current'then 'current_all_pending_stock'else 'local_midnight_pending_snapshot'end,
  'date',display_date,'sourceDate',source_date,'queriedAt',statement_timestamp(),'freshnessMaxSeconds',900,'currency',currency,
  'complete',all_complete,'expectedPlatformCount',jsonb_array_length(rows),'receivedPlatformCount',complete_n,
  'requestedIdCount',jsonb_array_length(p_request->'platformIds'),
  'count',case when all_complete then n end,'amount',case when all_complete then a::text end,
  'knownCount',case when known then n end,'knownAmount',case when amount_known then a::text end,
  'summary',jsonb_build_object('count',case when all_complete then n end,'amount',case when all_complete then a::text end,
   'knownCount',case when known then n end,'knownAmount',case when amount_known then a::text end),
  'rows',rows,'groups','[]'::jsonb,'missingPlatforms',(select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','name',r->>'name','state',r->>'state','reason',r->>'reason')),'[]')from jsonb_array_elements(rows)r where not coalesce((r->>'wholeStockComplete')::boolean,false)));
end $reader$;
-- CREATE OR REPLACE preserves the existing original/public entrypoint OIDs and ACLs.
-- The public wrapper and dashboard_admin_execute keep calling the same private name.
notify pgrst,'reload schema';
commit;
