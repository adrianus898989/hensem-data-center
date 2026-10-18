-- Optional bounded provider projections; financial facts/permissions/windows are unchanged.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
do $guard$begin
 if current_user<>'postgres'then raise exception'provider_reuse_install_denied';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='4fed2fdf254b5a9c64b7d4d15e6bbcd3'and md5(pg_get_functiondef(oid))='af8c68d21d1fde5a1bebf74d3f7e9f12'and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}'and not p.prosecdef and p.provolatile='v'and p.proparallel='u'and not p.proisstrict and not p.proleakproof and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb)then raise exception'provider_reuse_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and ((md5(prosrc)='668e1b6947a4db12e260eacaf2c1dce9'and md5(pg_get_functiondef(oid))='b7c494aaa2a8c48fb6d237f16a879c12')or(md5(prosrc)='988291994779d7d25919e57db8715a82'and md5(pg_get_functiondef(oid))='e671aa71833ba75dc5f3812897ed4307'))and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}'and not p.prosecdef and p.provolatile='v'and p.proparallel='u'and not p.proisstrict and not p.proleakproof and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb)then raise exception'provider_reuse_entry_drift';end if;
 if to_regprocedure('private.daily_provider_base_reuse_pack(jsonb,jsonb,jsonb,jsonb,jsonb)')is not null then raise exception'provider_reuse_pack_presence_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure and md5(prosrc)='4a38ca3d9bbfbed3cc94250db95064da')then raise exception'provider_reuse_original_reader_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='58fee45de05fe5567a62e69b297cee88')then raise exception'provider_reuse_projection_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure and md5(prosrc)='008e5cee3a4f6ac9e90706c45bee56da'and pg_get_userbyid(proowner)='postgres'and prosecdef and not proisstrict and provolatile='s'and prolang=(select oid from pg_language where lanname='sql'))then raise exception'provider_reuse_native_resolver_drift';end if;
end;$guard$;
create temporary table provider_reuse_guard on commit drop as select oid::regprocedure::text key,to_jsonb(p)-'prosrc'value from pg_proc p where oid in('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure)union all select 'other',coalesce(jsonb_agg(to_jsonb(p)order by oid),'[]')from pg_proc p where oid not in('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure)and oid is distinct from to_regprocedure('private.daily_provider_base_reuse_pack(jsonb,jsonb,jsonb,jsonb,jsonb)');
-- BEGIN compact projection helper
-- Optional compact server projections of an already admitted exact base.
-- No source reader, fold, queue, cache table or financial kernel is added.
create function private.daily_provider_base_reuse_pack(p_payload jsonb,p_base jsonb,p_request jsonb,p_target jsonb,p_publication jsonb)returns jsonb
language plpgsql stable set search_path=''as $function$
declare started timestamptz:=clock_timestamp();deadline timestamptz:=started+interval'250milliseconds';
 rows jsonb;resolved jsonb;names jsonb;name_map jsonb:='[]';entries jsonb:='[]';common jsonb;scope jsonb;packed jsonb;
 reuse_names jsonb;canonical_map jsonb;n record;resolved_key text;native_country text;native_platform text;entry_index integer;empty_index integer;all_index integer;timestamp_ambiguous boolean;
begin
 if current_user<>'postgres'then return null;end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='58fee45de05fe5567a62e69b297cee88')
  or not exists(select 1 from pg_proc where oid='private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='f72bd9afabd7c74de273f02f5e46499d')then return null;end if;
 reuse_names:=p_request->'providerReuseNames';p_request:=p_request-'providerReuseNames';
 if reuse_names is null or jsonb_typeof(reuse_names)is distinct from'array'then reuse_names:='[]';end if;
 if jsonb_array_length(reuse_names)>200 or octet_length(reuse_names::text)>8192 or exists(select 1 from jsonb_array_elements(reuse_names)hint(value)where jsonb_typeof(hint.value)is distinct from'string'or length(btrim(hint.value#>>'{}'))not between 1 and 200 or(hint.value#>>'{}')~'[[:cntrl:]]')then reuse_names:='[]';end if;
 if p_request->>'view'is distinct from'providers'or not coalesce(p_request->>'direction'in('charge','withdraw'),false)
  or coalesce(p_request->>'status','all')<>'all'
  or p_request-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
  or p_publication->'calculationComplete'is distinct from'true'::jsonb
  or p_publication->'servedLastComplete'='true'::jsonb or p_publication->>'kind'is distinct from'daily_provider_rollup'
  or p_payload->'rows'is distinct from'[]'::jsonb or p_payload->'partial'='true'::jsonb or p_payload->'complete'='false'::jsonb
  or jsonb_typeof(p_payload->'groups'->'provider')is distinct from'array'then return null;end if;
 rows:=p_payload->'groups'->'provider';if jsonb_array_length(rows)>256 then return null;end if;
 native_country:=p_payload->'platform'->>'country';native_platform:=p_payload->'platform'->>'sourceName';
 -- The scalar native resolver has expensive repeated configuration startup.
 -- Mirror its exact current single-step relation once for the bounded input set;
 -- on future resolver drift omit metadata instead of changing main statistics.
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure
  and md5(prosrc)='008e5cee3a4f6ac9e90706c45bee56da'and pg_get_userbyid(proowner)='postgres'and prosecdef and not proisstrict and provolatile='s'
  and prolang=(select oid from pg_language where lanname='sql')and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then return null;end if;
 select coalesce(jsonb_agg(name order by name),'[]')into names from(
  select distinct name from(
   select r->>'provider'name from jsonb_array_elements(rows)r
   union all select x.name from jsonb_array_elements(rows)r cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r->'provider_names')='array'then r->'provider_names'else'[]'::jsonb end)x(name)
   union all select x.name from jsonb_array_elements_text(coalesce(p_request->'providers','[]'::jsonb))x(name)
   union all select x.name from jsonb_array_elements_text(reuse_names)x(name)
  )n where name is not null and length(name)between 1 and 200 and name!~'[[:cntrl:]]'
 )d;
 if jsonb_array_length(names)>200 or clock_timestamp()>deadline then return null;end if;
 with inputs as materialized (
  select distinct raw,case when raw='未识别通道'then''else coalesce(btrim(raw),'')end lookup_raw
  from(select r->>'provider'raw from jsonb_array_elements(rows)r union all select name from jsonb_array_elements_text(names)x(name))i
 ), approved as materialized (
  select a.*from private.dashboard_admin_wg_provider_aliases()a
   where native_country in(a.country_code,a.country)and native_platform=a.platform
 ), registry as materialized (
  select r.country,r.platform,r.raw_provider,r.canonical_values,o.canonical_provider override_name
   from private.dashboard_admin_provider_registry r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
   where r.country=native_country and r.platform=native_platform and exists(select 1 from inputs i where i.lookup_raw=r.raw_provider)
 ), direct as materialized (
  select r.*,coalesce(r.override_name,private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider))direct_name from registry r
 ), name_sets as materialized (
  select distinct d.country,d.canonical_values from direct d where d.direct_name is null
 ), aliases as materialized (
  select ns.country,ns.canonical_values,private.dashboard_admin_live_provider_alias_values(ns.country,ns.canonical_values)names from name_sets ns
 ), candidates as materialized (
  select i.raw,case when native_country in('IN','印度')and native_platform in('YASH.BET','YASHBET')and btrim(i.raw)='WinPay'
   then coalesce((select o.canonical_provider from private.dashboard_admin_provider_overrides o where o.country=native_country and o.platform=native_platform and o.raw_provider=btrim(i.raw)),'NewWinPay')
   else coalesce(
    (select coalesce(o.canonical_provider,a.canonical_provider)from approved a left join private.dashboard_admin_provider_overrides o on o.country=a.country and o.platform=a.platform and o.raw_provider=a.raw_provider where btrim(i.raw)=a.raw_provider),
    (select coalesce(d.direct_name,case when cardinality(a.names)=1 then a.names[1]end)from direct d left join aliases a on a.country=d.country and a.canonical_values is not distinct from d.canonical_values where d.raw_provider=i.lookup_raw),i.raw)end canonical_input
   from inputs i
 ), final_inputs as materialized (select distinct canonical_input from candidates),
 final_aliases as materialized (
  select f.canonical_input,private.dashboard_admin_live_provider_alias(native_country,f.canonical_input)result from final_inputs f
 )
 select coalesce(jsonb_agg(jsonb_build_object('raw',c.raw,'key',a.result)order by c.raw nulls first),'[]')into canonical_map
  from candidates c join final_aliases a on a.canonical_input is not distinct from c.canonical_input;
 if clock_timestamp()>deadline then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal-1,'key',m->>'key','raw',r->>'provider')order by ordinal),'[]')into resolved
  from jsonb_array_elements(rows)with ordinality a(r,ordinal)join jsonb_array_elements(canonical_map)m on m->>'raw'is not distinct from r->>'provider';
 if(select count(distinct r->>'key')from jsonb_array_elements(resolved)r)>128 or clock_timestamp()>deadline then return null;end if;
 scope:=p_request-'providers';
 common:=private.prepared_aggregate_echo(p_payload,p_request,p_target)-array['summary','groups','total','hasMore','latencySummary','pendingSummary'];
 -- Retain the original function's complete ABI/date/native/row validation.
 -- Direction all and an empty provider selector return the validated payload
 -- before its per-bucket numeric loops. No canonical label is resolved twice.
 perform private.dashboard_prepared_provider_projection(p_payload,p_base,p_base);
 if clock_timestamp()>deadline then return null;end if;
 -- Exact original 58fee count/amount/evidence formulas, evaluated together for
 -- every already-resolved selection. Common provenance is never cloned into
 -- each temporary projection. Monetary arithmetic stays PostgreSQL NUMERIC.
 with canonical_groups as materialized (
  select r->>'key'key,(row_number()over(order by r->>'key')-1)::integer selection
   from jsonb_array_elements(resolved)r where r->>'key'is not null group by r->>'key'
 ), selections as materialized (
  select selection,key from canonical_groups
  union all select count(*)::integer,null::text from canonical_groups
  union all select count(*)::integer+1,null::text from canonical_groups
 ), chosen as materialized (
  select g.selection,(r->>'ordinal')::integer ordinal,rows->(r->>'ordinal')::integer leaf
   from canonical_groups g join jsonb_array_elements(resolved)r on r->>'key'=g.key
   where rows->(r->>'ordinal')::integer->>'direction'=p_request->>'direction'
  union all
  select (select count(*)::integer+1 from canonical_groups),ordinal::integer-1,leaf
   from jsonb_array_elements(rows)with ordinality a(leaf,ordinal)where leaf->>'direction'=p_request->>'direction'
 ), buckets as materialized (
  select selection,leaf->'direction'direction,leaf->'currency'currency from chosen
   group by selection,leaf->'direction',leaf->'currency'
 ), metric_keys(key,kind,optional)as (values
  ('all_count','count',false),('success_count','count',false),('pending_count','count',false),('failed_count','count',false),('rejected_count','count',false),('unknown_count','count',false),('missing_amount_count','count',false),('negative_amount_count','count',false),('created_success_count','count',false),('reviewed_pending_count','count',true),
  ('all_amount','amount',false),('success_amount','amount',false),('pending_amount','amount',false),('failed_amount','amount',false),('rejected_amount','amount',false),('unknown_amount','amount',false),('created_success_amount','amount',true),('reviewed_pending_amount','amount',true)
 ), numeric_fields as materialized (
  select c.selection,c.leaf->'direction'direction,c.leaf->'currency'currency,k.key,k.kind,k.optional,
   bool_or(c.leaf?k.key)leaf_has,
   bool_or(c.leaf->>k.key is null or coalesce(c.leaf->>k.key,'')!~case when k.kind='count'then'^[0-9]+$'else'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'end)invalid,
   sum(case when c.leaf->>k.key~case when k.kind='count'then'^[0-9]+$'else'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'end then(c.leaf->>k.key)::numeric end)value
   from chosen c cross join metric_keys k group by c.selection,c.leaf->'direction',c.leaf->'currency',k.key,k.kind,k.optional
 ), numeric_objects as materialized (
  select f.selection,f.direction,f.currency,jsonb_object_agg(f.key,
   case when f.kind='count'then to_jsonb(case when f.invalid then null else f.value end)
    else to_jsonb(case when f.invalid then null else f.value::text end)end)
   filter(where case when f.optional then f.leaf_has when f.kind='amount'then true
    else f.leaf_has or exists(select 1 from jsonb_array_elements(p_payload->'summary')summary_row where summary_row?f.key)end)fields
   from numeric_fields f group by f.selection,f.direction,f.currency
 ), evidence_keys(key)as(values('success_time_available'),('success_time_basis'),('success_available'),('success_unavailable_reason'),('fee_available'),('fee_unavailable_reason'),('pending_count_available')),
 evidence_fields as materialized (
  select c.selection,c.leaf->'direction'direction,c.leaf->'currency'currency,k.key,
   case when count(distinct c.leaf->k.key)=1 and bool_and(c.leaf?k.key)then(jsonb_agg(c.leaf->k.key order by c.ordinal))->0 end value
   from chosen c cross join evidence_keys k group by c.selection,c.leaf->'direction',c.leaf->'currency',k.key
 ), evidence_objects as materialized (
  select selection,direction,currency,jsonb_object_agg(key,value)filter(where value is not null)fields
   from evidence_fields group by selection,direction,currency
 ), stamp_values as materialized (
  select c.selection,c.leaf->'direction'direction,c.leaf->'currency'currency,c.ordinal,c.leaf->>'latest_synced_at'stamp,(c.leaf->>'latest_synced_at')::timestamptz instant
   from chosen c where c.leaf->>'latest_synced_at'is not null
 ), stamp_maxima as materialized (
  select selection,direction,currency,max(instant)instant from stamp_values group by selection,direction,currency
 ), stamps as materialized (
  select v.selection,v.direction,v.currency,(array_agg(v.stamp order by v.ordinal))[1]stamp,count(distinct v.stamp)>1 ambiguous
   from stamp_values v join stamp_maxima m on m.selection=v.selection and m.direction is not distinct from v.direction and m.currency is not distinct from v.currency and m.instant=v.instant
   group by v.selection,v.direction,v.currency
 ), summaries as materialized (
  select bk.selection,jsonb_agg(jsonb_build_object('direction',bk.direction,'currency',bk.currency,'provider',null,'latest_synced_at',st.stamp)||coalesce(nf.fields,'{}')||coalesce(ef.fields,'{}')order by bk.direction,bk.currency)summary
   from buckets bk left join numeric_objects nf on nf.selection=bk.selection and nf.direction is not distinct from bk.direction and nf.currency is not distinct from bk.currency
   left join evidence_objects ef on ef.selection=bk.selection and ef.direction is not distinct from bk.direction and ef.currency is not distinct from bk.currency
   left join stamps st on st.selection=bk.selection and st.direction is not distinct from bk.direction and st.currency is not distinct from bk.currency
   group by bk.selection
 ), totals as materialized (
  select selection,bool_or(leaf->>'all_count'is null or coalesce(leaf->>'all_count','')!~'^[0-9]+$')invalid,
   coalesce(sum(case when leaf->>'all_count'~'^[0-9]+$'then(leaf->>'all_count')::numeric end),0)value,
   jsonb_agg(ordinal order by ordinal)indices from chosen group by selection
 ), assembled as materialized (
  select sel.selection,sel.key,coalesce(tot.indices,'[]')indices,
   case when tot.invalid then null else coalesce(tot.value,0)end total,coalesce(su.summary,'[]')summary
   from selections sel left join totals tot using(selection)left join summaries su using(selection)
 )
 , projected as materialized (
  select a.selection,a.key,a.indices,jsonb_build_object('summary',a.summary,'total',a.total)
   ||case when p_payload?'hasMore'then jsonb_build_object('hasMore',case when a.total is null then null else a.total>coalesce((p_payload->>'offset')::bigint,0)+coalesce((p_payload->>'limit')::bigint,20)end)else'{}'::jsonb end
   ||case when p_payload?'latencySummary'then jsonb_build_object('latencySummary','[]'::jsonb)else'{}'::jsonb end
   ||case when p_payload?'pendingSummary'then jsonb_build_object('pendingSummary','[]'::jsonb)else'{}'::jsonb end result
   from assembled a
 )
 select jsonb_agg(jsonb_build_object('key',a.key,'indices',a.indices,'result',
   private.prepared_aggregate_echo(a.result,p_request,p_target)-array['offset','limit','startAt','endAt','successStartAt','successEndAt','successBasis','amountBands','amountBandsVersion'])order by a.selection),
   (select count(*)::integer from canonical_groups),(select count(*)::integer+1 from canonical_groups),coalesce((select bool_or(ambiguous)from stamps),false)
  into entries,empty_index,all_index,timestamp_ambiguous from projected a;
 -- The original stamp query has no text tie-break. Never substitute a chosen
 -- text when equal latest instants have different source spellings.
 if timestamp_ambiguous then return null;end if;
 if clock_timestamp()>deadline then return null;end if;
 for n in select name from jsonb_array_elements_text(names)x(name)loop
  if clock_timestamp()>deadline then return null;end if;
  select m->>'key'into resolved_key from jsonb_array_elements(canonical_map)m where m->>'raw'=n.name;
  select ordinal-1 into entry_index from jsonb_array_elements(entries)with ordinality e(entry,ordinal)where entry->>'key'=resolved_key;
  name_map:=name_map||jsonb_build_array(jsonb_build_array(n.name,coalesce(entry_index,empty_index)));
 end loop;
 packed:=jsonb_build_object('version',1,'scope',scope,'base',common,'providers',rows,'names',name_map,'entries',entries,'all',all_index,'generatedMs',round(extract(epoch from clock_timestamp()-started)*1000,3));
 if clock_timestamp()>deadline or octet_length(packed::text)>1048576 then return null;end if;
 return packed;
end;$function$;
revoke all on function private.daily_provider_base_reuse_pack(jsonb,jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated,service_role;

-- END compact projection helper
-- Internal exact-complete fast lane. Caller has performed the original page,
-- role-context, live native scope and request/dependency admission checks.
-- No payload from an individual daily artifact is fetched or projected here.
create or replace function private.daily_provider_base_exact_read(p_request jsonb,p_targets jsonb,p_mappings jsonb,p_metadata jsonb)returns jsonb
language plpgsql volatile set search_path=''as $function$
declare mapping jsonb;t jsonb;q jsonb;selected jsonb;identity jsonb;proofs jsonb:='[]';proof jsonb;part jsonb;c jsonb;pub jsonb;payload jsonb;
 current_items jsonb;items jsonb:='[]';ready jsonb;outcome jsonb;response jsonb;i integer:=0;j private.prepared_aggregate_jobs%rowtype;
 a private.daily_provider_base_artifacts%rowtype;reuse_pack jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if coalesce((p_request->>'forceRefresh')::boolean,false)then return null;end if;
 -- A future original-reader authorization/lifecycle change must fail closed to
 -- the unmodified pipeline until this narrow mirror is explicitly re-reviewed.
 if not exists(select 1 from pg_proc p where p.oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure
  and md5(p.prosrc)='4a38ca3d9bbfbed3cc94250db95064da'and md5(pg_get_functiondef(p.oid))='df7914b8375708f883617b3d09265423'
  and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}'and p.prosecdef
  and p.provolatile='v'and p.proparallel='u'and not p.proisstrict and not p.proleakproof
  and p.procost=100 and p.prorows=0 and not p.proretset and p.pronargs=2 and p.pronargdefaults=0
  and pg_get_function_arguments(p.oid)='p_page text, p_request jsonb'and pg_get_function_result(p.oid)='jsonb'
  and(select lanname from pg_language where oid=p.prolang)='plpgsql'and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb)
 then return null;end if;
 -- Prove the entire batch exact before performing even refresh bookkeeping.
 -- Miss, last-complete and force remain wholly on the previous reader path.
 for mapping in select value from jsonb_array_elements(p_mappings)loop
  q:=p_request->'requests'->i;t:=p_targets->i;
  select jsonb_agg(value order by n)into selected from jsonb_array_elements(p_metadata)with ordinality r(value,n)
   where n>(mapping->>'first')::integer and n<=(mapping->>'first')::integer+(mapping->>'count')::integer;
  identity:=private.daily_provider_base_identity(selected,q,t,mapping->>'dependency');
  select *into a from private.daily_provider_base_artifacts where digest=md5((identity->'key')::text)and content_key=identity->'key';
  if a.id is null or a.item_digest is distinct from md5(a.item::text)or a.item->>'status'is distinct from'ready'
   or a.item->'request'is distinct from identity->'base'or a.item->'publication'->'calculationComplete'is distinct from'true'::jsonb
   or a.item->'result'->'platform'->>'id'is distinct from t->>'id'
   or jsonb_array_length(a.item->'publication'->'components')is distinct from jsonb_array_length(selected)
   or not private.daily_provider_base_manifest_matches(identity->'key')then return null;end if;
  proofs:=proofs||jsonb_build_array(jsonb_build_object('identity',identity,'selected',selected,'item',a.item,'target',t,'request',q,'dependency',mapping->>'dependency'));
  i:=i+1;
 end loop;
 for proof in select value from jsonb_array_elements(proofs)loop
  current_items:='[]';i:=0;t:=proof->'target';q:=proof->'request';identity:=proof->'identity';
  for part in select value from jsonb_array_elements(proof->'selected')loop
   pub:=part->'publication';
   select *into j from private.prepared_aggregate_jobs where id=(part->>'jobId')::uuid;
   if j.id is null or j.target is distinct from t or j.dependency is distinct from proof->>'dependency'
    or j.revision::text is distinct from split_part(pub->>'generation',':',1)then return null;end if;
   -- Exact original V2 ready-head lifecycle; force is deliberately not admitted.
   if(pub->>'expiresAt')::timestamptz<=clock_timestamp()and coalesce(j.next_due_at,(pub->>'expiresAt')::timestamptz)<=clock_timestamp()then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp()
     where z.id=j.id and z.status='ready'and z.revision=j.revision and z.dependency=proof->>'dependency'and z.target=t;
    select *into j from private.prepared_aggregate_jobs where id=j.id;
    if j.revision::text is distinct from split_part(pub->>'generation',':',1)or j.dependency is distinct from proof->>'dependency'or j.target is distinct from t then return null;end if;
   end if;
   pub:=pub||jsonb_build_object('freshness',case when(pub->>'expiresAt')::timestamptz>clock_timestamp()then'fresh'else'refresh_due'end,
    'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end);
   update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'5minutes';
   c:=proof->'item'->'publication'->'components'->i;
   if c->'request'is distinct from part->'request'or((c->'publication')-array['freshness','refreshState','nextRefreshAt'])is distinct from((part->'publication')-array['freshness','refreshState','nextRefreshAt'])then return null;end if;
   -- Financial facts and immutable evidence were already fully validated by the
   -- worker for this exact publication vector. Reuse that evidence; V4 alone
   -- assembles the live publication from empty provider leaves.
   payload:=jsonb_build_object('version',1,'rows','[]'::jsonb,'summary','[]'::jsonb,'groups',jsonb_build_object('provider','[]'::jsonb),
    'platform',proof->'item'->'result'->'platform','startAt',part->'request'->>'startAt','endAt',part->'request'->>'endAt',
    'successStartAt',part->'request'->>'successStartAt','successEndAt',part->'request'->>'successEndAt','successBasis','success')||(c->'evidence');
   current_items:=current_items||jsonb_build_array(jsonb_build_object('request',part->'request','status','ready','result',payload,'publication',pub));i:=i+1;
  end loop;
  outcome:=private.daily_provider_base_lookup(current_items,q,t,proof->>'dependency');ready:=outcome->'item';
  if outcome->'fallback'='true'::jsonb or ready->>'status'is distinct from'ready'or ready->'publication'->'servedLastComplete'='true'::jsonb
   or(outcome->'pending'->'identity'->'key')is distinct from identity->'key'
   or not private.daily_provider_base_manifest_matches(identity->'key')
   or not private.prepared_aggregate_target_current(t)
   or private.prepared_aggregate_dependency(t,private.prepared_aggregate_dependency_common(t->>'scope_group'))is distinct from proof->>'dependency'then return null;end if;
  -- Optional ordinal-only reuse metadata; the main financial DTO is untouched.
  begin
   reuse_pack:=private.daily_provider_base_reuse_pack(proof->'item'->'result',identity->'base',q||case when p_request?'providerReuseNames'then jsonb_build_object('providerReuseNames',p_request->'providerReuseNames')else'{}'::jsonb end,t,ready->'publication');
  exception when insufficient_privilege then raise;
   when others then reuse_pack:=null;end; -- OTHERS excludes query_canceled (57014).
  if reuse_pack is not null then
   if not private.daily_provider_base_manifest_matches(identity->'key')or not private.prepared_aggregate_target_current(t)
    or private.prepared_aggregate_dependency(t,private.prepared_aggregate_dependency_common(t->>'scope_group'))is distinct from proof->>'dependency'then return null;end if;
   ready:=ready||jsonb_build_object('providerReuse',reuse_pack);
  end if;
  items:=items||jsonb_build_array(ready);
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 if octet_length(response::text)>16*1024*1024 then
  -- Optional metadata never causes a valid original response to be truncated
  -- or sent down the old daily-reader path solely due to its size.
  select jsonb_agg(value-'providerReuse'order by ordinal)into items from jsonb_array_elements(items)with ordinality r(value,ordinal);
  response:=jsonb_build_object('version',2,'items',items);
  if octet_length(response::text)>16*1024*1024 then return null;end if;
 end if;
 for proof in select value from jsonb_array_elements(proofs)loop
  identity:=proof->'identity';
  update private.daily_provider_base_jobs set last_requested_at=clock_timestamp()where digest=md5((identity->'key')::text)and content_key=identity->'key'and last_requested_at<clock_timestamp()-interval'1minute';
  update private.daily_provider_base_heads set last_requested_at=clock_timestamp()where family_digest=md5((identity->'family')::text)and family_key=identity->'family'and last_requested_at<clock_timestamp()-interval'1minute';
 end loop;
 return response;
end;$function$;
revoke all on function private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated,service_role;

create or replace function private.dashboard_admin_daily_provider_prepared_read(p_page text,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''as $function$
declare
 access jsonb;page jsonb;ctx jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;dq jsonb;
 commons jsonb:='{}';scope text;common text;dep text;baseq jsonb;k jsonb;
 metadata jsonb:='[]';parts jsonb:='[]';mappings jsonb:='[]';all_items jsonb:='[]';items jsonb:='[]';chunk jsonb;response jsonb;folded jsonb;
 a timestamptz;b timestamptz;local_a timestamp;local_b timestamp;day date;day_end timestamptz;tz text;
 i integer:=0;start_index integer;part_index integer:=0;mapping jsonb;selected jsonb;original_q jsonb;
 j private.prepared_aggregate_jobs%rowtype;artifact private.prepared_aggregate_artifacts%rowtype;prepared jsonb;pending jsonb:='[]';states jsonb;reason text;identity jsonb;
begin
 -- Same page, query grant and assigned-context checks as the unmodified reader.
 -- Do this before even looking up a prepared head or native platform metadata.
 access:=private.dashboard_role_access();
 if(access->>'canView')::boolean is not true then raise exception using errcode='42501',message='preview_denied';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages')where value->>'id'=p_page;
 if page is null or not(page->'requests'?'aggregate')or not(page->'requests'?'aggregatePrepared')then raise exception using errcode='42501',message='page_action_denied';end if;
 if access->>'mode'='assigned'then
  if not private.dashboard_role_context_valid()or not(access->'permissions'?&array[p_page||'.view',p_page||'.query'])then raise exception using errcode='42501',message='role_permission_denied';end if;
  ctx:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';
  if ctx->>'page'is distinct from p_page or ctx->>'rpc'is distinct from'dashboard_admin_live_aggregate_prepared'or ctx->>'action'is distinct from'aggregatePrepared'then raise exception using errcode='42501',message='page_action_denied';end if;
 end if;
 -- Optional display-name hints never become financial filters or identity.
 -- Invalid/oversized hints are omitted; valid main requests retain old behavior.
 if p_request?'providerReuseNames'then
  if p_request->'publicationVersion'is distinct from'2'::jsonb or jsonb_typeof(p_request->'providerReuseNames')is distinct from'array'then p_request:=p_request-'providerReuseNames';
  elsif jsonb_array_length(p_request->'providerReuseNames')>200 or octet_length((p_request->'providerReuseNames')::text)>8192 then p_request:=p_request-'providerReuseNames';
  elsif exists(select 1 from jsonb_array_elements(p_request->'providerReuseNames')n where jsonb_typeof(n)is distinct from'string'or length(btrim(n#>>'{}'))not between 1 and 200 or(n#>>'{}')~'[[:cntrl:]]')then p_request:=p_request-'providerReuseNames';end if;
 end if;
 if p_request is null or jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','forceRefresh','providerReuseNames']<>'{}'::jsonb or octet_length(p_request::text)>1048576
  or p_request->'publicationVersion'is distinct from'2'::jsonb or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 3
  or p_request?'forceRefresh'and jsonb_typeof(p_request->'forceRefresh')is distinct from'boolean'
 then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  -- Invalid UUIDs are delegated to the original validation, never coerced.
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or q->>'view'is distinct from'providers'or coalesce(q->>'status','all')<>'all'or q->>'successBasis'is distinct from'success'
   or q->>'successStartAt'is null or q->>'successEndAt'is null
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
  then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;tz:=t->>'timezone';
  local_a:=a at time zone tz;local_b:=b at time zone tz;
  if a is distinct from(q->>'successStartAt')::timestamptz or b is distinct from(q->>'successEndAt')::timestamptz
   or local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)
   or local_b::date-local_a::date not between 2 and 31 or b>clock_timestamp()
  then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  start_index:=jsonb_array_length(parts);targets:=targets||jsonb_build_array(t);
  scope:=t->>'scope_group';common:=commons->>scope;
  if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  for day in select generate_series(local_a::date,local_b::date-1,interval'1day')::date loop
   day_end:=(day+1)::timestamp at time zone tz;
   -- Provider totals ignore validated chart bands, just like the unchanged
   -- canonical/base request. Drop them before widening daily direction to all.
   dq:=(q-array['providers','amountBands'])||jsonb_build_object('direction','all',
    'startAt',to_char(day::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char(day_end at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successStartAt',to_char(day::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successEndAt',to_char(day_end at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
   baseq:=private.prepared_aggregate_base_request(dq,t);k:=private.prepared_aggregate_key(baseq,t);
   select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   select a0.*into artifact from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
   if artifact.id is null or artifact.revision is distinct from j.revision or artifact.dependency is distinct from dep
    or j.dependency is distinct from dep or j.target is distinct from t or artifact.cutoff<day_end
    or artifact.cutoff is null or artifact.computed_at is null or artifact.expires_at<=artifact.computed_at
    or artifact.source_complete is null
   then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
   metadata:=metadata||jsonb_build_array(jsonb_build_object('request',dq,'jobId',j.id,'publication',jsonb_build_object(
    'id',artifact.id,'generation',artifact.revision::text||':'||artifact.fence::text,'computedAt',artifact.computed_at,
    'expiresAt',artifact.expires_at,'cutoff',artifact.cutoff,'calculationComplete',true,'sourceComplete',artifact.source_complete,
    'freshness',case when artifact.expires_at>clock_timestamp()then'fresh'else'refresh_due'end,
    'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end)));
   parts:=parts||jsonb_build_array(dq);
  end loop;
  mappings:=mappings||jsonb_build_array(jsonb_build_object('first',start_index,'count',jsonb_array_length(parts)-start_index,'dependency',dep));
 end loop;
 -- 3 platforms ×31 local days, split sequentially. No client concurrency change,
 -- no broadened original RPC batch contract, no synchronous raw computation.
 if jsonb_array_length(parts)>93 then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
 -- Only exact completed batches can avoid the old full daily DTO path.
 -- Force, miss and last-complete retain the unchanged original admission.
 if not coalesce((p_request->>'forceRefresh')::boolean,false)then
  response:=private.daily_provider_base_exact_read(p_request,targets,mappings,metadata);
  if response is not null then return response;end if;
 end if;
 part_index:=0;
 while part_index<jsonb_array_length(parts)loop
  select jsonb_agg(value order by n)into chunk from jsonb_array_elements(parts)with ordinality p(value,n)where n>part_index and n<=part_index+50;
  response:=private.prepared_aggregate_read(p_page,(p_request-array['requests','providerReuseNames'])||jsonb_build_object('requests',chunk));
  if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
   or jsonb_array_length(response->'items')<>jsonb_array_length(chunk)
   or exists(select 1 from jsonb_array_elements(response->'items')with ordinality r(value,n)where value->>'status'is distinct from'ready'or value->'request'is distinct from chunk->(n::integer-1))
  then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  all_items:=all_items||(response->'items');part_index:=part_index+50;
 end loop;
 i:=0;
 for mapping in select value from jsonb_array_elements(mappings)loop
  original_q:=p_request->'requests'->i;t:=targets->i;
  select jsonb_agg(value order by n)into selected from jsonb_array_elements(all_items)with ordinality r(value,n)
   where n>(mapping->>'first')::integer and n<=(mapping->>'first')::integer+(mapping->>'count')::integer;
  begin
   prepared:=private.daily_provider_base_lookup(selected,original_q,t,mapping->>'dependency');
   if prepared->'fallback'='true'::jsonb then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
   folded:=prepared->'item';
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then folded:=null;end;
  if folded is null then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  items:=items||jsonb_build_array(folded);
  pending:=pending||jsonb_build_array(prepared->'pending');i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 -- Match the existing prepared manager's 16 MiB encoded-response bound.
 -- Preserve original fallback behavior instead of truncating providers/leaves.
 if octet_length(response::text)>16*1024*1024 then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
 states:=private.daily_provider_base_enqueue(pending);
 i:=0;
 for prepared in select value from jsonb_array_elements(pending)loop
  identity:=prepared->'identity';reason:=states->>md5((identity->'key')::text);
  if reason is not null then
   if response->'items'->i->>'status'='building'then
    response:=jsonb_set(response,array['items',i::text],(response->'items'->i)||jsonb_build_object('status','failed','reason',reason));
   elsif response->'items'->i->'publication'->'servedLastComplete'='true'::jsonb then
    response:=jsonb_set(response,array['items',i::text,'publication'],(response->'items'->i->'publication')||jsonb_build_object('refreshState','failed','refreshError',reason));
   end if;
  end if;
  i:=i+1;
 end loop;
 return response;
end;$function$;
revoke all on function private.dashboard_admin_daily_provider_prepared_read(text,jsonb)from public,anon,authenticated,service_role;

do $verify$begin
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='086664aa0861925c5dcdfd3040279055'and md5(pg_get_functiondef(oid))='39b8eecf4a25e9af632a6a6bb4b56edc'and to_jsonb(p)-'prosrc'=(select value from provider_reuse_guard where key='private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'))then raise exception'provider_reuse_metadata_changed';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='988291994779d7d25919e57db8715a82'and md5(pg_get_functiondef(oid))='e671aa71833ba75dc5f3812897ed4307'and to_jsonb(p)-'prosrc'=(select value from provider_reuse_guard where key='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'))then raise exception'provider_reuse_metadata_changed';end if;
 if(select value from provider_reuse_guard where key='other')is distinct from(select coalesce(jsonb_agg(to_jsonb(p)order by oid),'[]')from pg_proc p where oid not in('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure)and oid is distinct from to_regprocedure('private.daily_provider_base_reuse_pack(jsonb,jsonb,jsonb,jsonb,jsonb)'))then raise exception'provider_reuse_other_function_changed';end if;
 if not exists(select 1 from pg_proc where oid='private.daily_provider_base_reuse_pack(jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='4f5e7484f1c81cc81bf622566aac620c'and md5(pg_get_functiondef(oid))='db01b9719a8b3b1355250488f85bd76c'and not prosecdef and provolatile='s'and proacl::text='{postgres=X/postgres}')then raise exception'provider_reuse_pack_metadata_changed';end if;
end;$verify$;
commit;
