-- NEWAR blocking reasons from verified received order labels; no source writes or snapshot substitution.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $prerequisite$
declare p record;h oid;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if p.owner_name<>'postgres' or not p.prosecdef or p.provolatile<>'s' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  then raise exception 'newar_blocking_reader_metadata_drift';end if;
 if md5(p.prosrc) not in ('602ca2fec8c9460eb4f9efb3f639ea35','f24047cc2ac6669a2cc251e6ecb6851c') then raise exception 'newar_blocking_reader_definition_drift';end if;
 for p in select q.*,pg_get_userbyid(q.proowner) owner_name from pg_proc q where q.oid in
  ('private.dashboard_admin_live_clean_note(text)'::regprocedure,'private.dashboard_admin_live_blocking_details_cleaned(text)'::regprocedure) loop
  if p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'i' or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proacl::text is distinct from '{postgres=X/postgres}'
   or md5(p.prosrc)<>(case when p.proname='dashboard_admin_live_clean_note' then '0a8b5a2afd3753a51127a1bd4e0baede' else '646a277faed684caa72fc427f4f53e75' end)
   then raise exception 'newar_blocking_taxonomy_drift';end if;
 end loop;
 h:=to_regprocedure('private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)');
 if h is not null then
  select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid=h;
  if p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'s' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' or md5(p.prosrc)<>'25998ec79da2b15a62892746e8321160'
   then raise exception 'newar_blocking_helper_drift';end if;
 end if;
end;$prerequisite$;
do $objects$
declare c record; p record; t record;
begin
 select q.*,pg_get_userbyid(q.relowner) owner_name into c from pg_class q where q.oid='private.newar_withdraw_facts'::regclass;
 if c.owner_name<>'postgres' or c.relkind<>'r' or not c.relrowsecurity or c.relforcerowsecurity
  or c.reloptions is distinct from array['fillfactor=90','autovacuum_vacuum_scale_factor=0.02','autovacuum_vacuum_threshold=1000','autovacuum_analyze_scale_factor=0.02','autovacuum_analyze_threshold=1000']::text[]
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)
  or exists(select 1 from pg_policy where polrelid=c.oid)
  then raise exception 'newar_withdraw_fact_table_metadata_drift';end if;
 if (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum)
  from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) is distinct from
  '[ ["record_id","uuid",true],["platform","text",true],["source_id","text",true],["status_group","text",true],["currency","text",false],["created_at","timestamp with time zone",true],["captured_at","timestamp with time zone",true],["received_at","timestamp with time zone",true],["method","text",false],["account","text",true],["submitted_at","timestamp with time zone",false],["handled_at","timestamp with time zone",false] ]'::jsonb
  then raise exception 'newar_withdraw_fact_columns_drift';end if;
 if not exists(select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='p' and k.convalidated and pg_get_constraintdef(k.oid)='PRIMARY KEY (record_id)')
  or not exists(select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='f' and k.convalidated
   and k.confrelid='public.newar_detail_records'::regclass and k.confdeltype='c' and k.confupdtype='c'
   and pg_get_constraintdef(k.oid)='FOREIGN KEY (record_id) REFERENCES newar_detail_records(id) ON UPDATE CASCADE ON DELETE CASCADE')
  then raise exception 'newar_withdraw_fact_constraints_drift';end if;
 if not exists(select 1 from pg_index i join pg_class x on x.oid=i.indexrelid
  where x.oid='private.newar_withdraw_facts_platform_created_idx'::regclass and i.indrelid=c.oid and i.indisvalid and i.indisready
   and not i.indisunique and i.indpred is null and i.indexprs is null and i.indnkeyatts=2 and i.indnatts=2
   and (select array_agg(a.attname::text order by v.ordinality) from unnest(i.indkey) with ordinality v(attnum,ordinality)
    join pg_attribute a on a.attrelid=c.oid and a.attnum=v.attnum)=array['platform','created_at']::text[])
  then raise exception 'newar_withdraw_fact_index_drift';end if;
 for p in select q.*,pg_get_userbyid(q.proowner) owner_name from pg_proc q where q.oid in
  ('private.newar_withdraw_fact(public.newar_detail_records)'::regprocedure,'private.sync_newar_withdraw_fact()'::regprocedure) loop
  if p.owner_name<>'postgres' or p.prosecdef is distinct from (p.proname='sync_newar_withdraw_fact') or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proacl::text is distinct from '{postgres=X/postgres}'
   or (case when p.proname='newar_withdraw_fact' then md5(p.prosrc)<>'f15a0b562b7f5def87aba1a36ba19506' or p.provolatile<>'i' or p.prolang<>(select oid from pg_language where lanname='sql')
    else md5(p.prosrc)<>'a3daa3b8470e92bc410b745f343a3a1e' or p.provolatile<>'v' or p.prolang<>(select oid from pg_language where lanname='plpgsql') end)
   then raise exception 'newar_withdraw_fact_projector_metadata_drift';end if;
 end loop;
 select * into t from pg_trigger where tgrelid='public.newar_detail_records'::regclass and tgname='newar_detail_withdraw_fact_sync' and not tgisinternal;
 if not found or t.tgfoid<>'private.sync_newar_withdraw_fact()'::regprocedure or t.tgtype<>29 or t.tgenabled<>'O'
  or t.tgqual is not null or t.tgattr::text<>'' or t.tgnargs<>0
  then raise exception 'newar_withdraw_fact_trigger_drift';end if;
end;$objects$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_newar_withdraw_reasons(p_request jsonb,p_scope jsonb,p_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
 v_country text:=btrim(p_request->>'country');v_platform text:=btrim(p_request->>'platform');
 v_kind text:=coalesce(p_request->>'kind','blocking');v_date date:=(p_request->>'date')::date;
 v_offset integer:=coalesce((p_request->>'offset')::integer,0);v_limit integer:=coalesce((p_request->>'limit')::integer,20);
 v_reason text:=nullif(p_request->>'reasonKey','');v_query text:=nullif(btrim(p_request->>'query'),'');
 v_cfg record;v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
 -- Called only after the parent reader validates its request and obtains fresh scope.
 -- The helper itself has no external EXECUTE grant and never handles other sources.
 if p_meta->>'source' is distinct from 'newar' or v_kind not in('blocking','blockingVariants','blockingOrders') then return null;end if;
 if p_meta->>'country' is distinct from v_country
  or not private.dashboard_scope_allows(p_scope,v_country,v_platform)
  or not (private.dashboard_admin_live_withdraw_key(v_platform)=private.dashboard_admin_live_withdraw_key(p_meta->>'name')
   or private.dashboard_admin_live_withdraw_key(v_platform)=private.dashboard_admin_live_withdraw_key(p_meta->>'source_name'))
  then raise exception using errcode='42501',message='scope_denied';end if;
 select n.* into v_cfg from public.newar_detail_platforms n
  where n.platform=p_meta->>'source_name' and n.enabled
   and private.dashboard_scope_allows(p_scope,n.country_code,n.platform);
 if not found or v_cfg.country is distinct from v_country or v_cfg.timezone is distinct from p_meta->>'timezone'
  then raise exception using errcode='22023',message='platform_denied';end if;
 v_start:=v_date::timestamp at time zone v_cfg.timezone;v_end:=(v_date+1)::timestamp at time zone v_cfg.timezone;
 with scope_facts as materialized (
  -- The existing narrow indexed projection locates one platform/day. Automatic
  -- and unverified orders are counted without reading their wide source JSON.
  select f.* from private.newar_withdraw_facts f
  where f.platform=v_cfg.platform and f.created_at>=v_start and f.created_at<v_end
   and (v_cfg.launch_at is null or f.created_at>=v_cfg.launch_at)
 ), totals as (
  select count(*)::bigint collected,count(*) filter(where method='auto')::bigint system,
   count(*) filter(where method='manual')::bigint manual,count(*) filter(where method is null)::bigint unknown,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   max(captured_at) captured,max(received_at) received from scope_facts
 ), coverage as (
  select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) ranges,max(c.observed_at) seen
  from private.newar_detail_coverage_runs c where c.platform=v_cfg.platform and c.dataset='withdraw'
   and c.invalidated_at is null and c.observed_at<=statement_timestamp()
   and c.effective_start_at<v_end and c.end_at>v_start
 ), evidence as (
  select t.*,greatest(t.received,c.seen) updated,
   v_end<=statement_timestamp() and (v_cfg.launch_at is null or v_start>=v_cfg.launch_at)
    and coalesce(c.ranges @> tstzrange(v_start,v_end,'[)'),false)
    and coalesce(t.captured<=statement_timestamp(),true) complete from totals t cross join coverage c
 ), source_orders as materialized (
  select f.record_id,f.status_group,f.account,f.created_at,
   case when isfinite(f.submitted_at) and isfinite(f.handled_at) and f.handled_at>=f.submitted_at
    and f.handled_at<=f.captured_at and f.handled_at<=statement_timestamp() then f.handled_at end handled_at,
   case when v_kind='blockingOrders' or v_query is not null then n.order_number end order_no,
   case when v_kind='blockingOrders' then n.amount end amount,
   case when v_kind='blockingOrders' then case when jsonb_typeof(n.raw->'withdrawDisplayState') in('string','number')
     and length(n.raw->>'withdrawDisplayState') between 1 and 200 and n.raw->>'withdrawDisplayState' !~ '[[:cntrl:]]'
    then n.raw->>'withdrawDisplayState' else f.status_group end end status,
   -- These are already privacy-filtered labels, never the raw remark or userRemark.
   -- A missing/empty/withheld label cannot prove that the source operator left it blank.
   case when n.raw->>'businessSchemaVersion'='2' and n.raw->>'automaticReasonSource'='remark'
    and jsonb_typeof(n.raw->'automaticReasonLabel')='string'
    and length(n.raw->>'automaticReasonLabel')<=256 and n.raw->>'automaticReasonLabel' !~ '[[:cntrl:]]'
    then nullif(btrim(n.raw->>'automaticReasonLabel'),'') end source_label
  from scope_facts f left join public.newar_detail_records n on n.id=f.record_id
   and n.platform=v_cfg.platform and n.dataset='withdraw'
  where f.method='manual'
 ), distinct_labels as materialized (
  select distinct coalesce(source_label,'') label from source_orders
 ), normalized_labels as materialized (
  select label,private.dashboard_admin_live_clean_note(label) source_reason from distinct_labels
 ), classified_labels as materialized (
  select label,nullif(source_reason,'') source_reason,
   case when source_reason ~ '[^[:space:]]' then 'present' else 'unknown' end note_state,
   case when source_reason ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(source_reason)
    else jsonb_build_object('reason','检测没备注') end details from normalized_labels
 ), reason_labels as materialized (
  select c.*,coalesce(details->>'reason',source_reason,'检测没备注') reason,
   md5(jsonb_build_array('newar_blocking_sanitized_v1',note_state,coalesce(details->>'reason',source_reason,'检测没备注'))::text) reason_key
  from classified_labels c
 ), notes as materialized (
  select o.*,r.source_reason,r.note_state,r.reason,r.reason_key,r.details
  from source_orders o join reason_labels r on r.label=coalesce(o.source_label,'')
 ), note_stats as (
  select count(*) filter(where note_state='present')::bigint present,
   count(*) filter(where note_state='unknown')::bigint unknown from notes
 ), selected_notes as materialized (
  select * from notes where (v_reason is null or reason_key=v_reason)
   and (v_query is null or position(lower(v_query) in lower(coalesce(order_no,'')))>0)
 ), groups as (
  select reason,reason_key "reasonKey",note_state "noteState",count(*)::bigint count,
   min(source_reason) as "sourceReason",count(distinct source_reason)::bigint "sourceVariantCount",
   count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from selected_notes group by reason,reason_key,note_state
 ), variants as (
  select reason,reason_key "reasonKey",note_state "noteState",source_reason "sourceReason",reason "canonicalReason",
   count(*)::bigint count,count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from selected_notes group by reason,reason_key,note_state,source_reason
 ), rendered as materialized (
  select to_jsonb(g) item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time,null::uuid sort_id
  from groups g where v_kind='blocking'
  union all select to_jsonb(g),g.count,coalesce(g."sourceReason",''),null::timestamptz,null::uuid
  from variants g where v_kind='blockingVariants'
  union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',account,
   'operatorKey',md5(account),'createdAt',created_at,'completedAt',handled_at,
   'manualRemark',source_reason,'reasonKey',reason_key,'blockingReason',reason,'noteState',note_state,
   'blockingActualValue',details->>'actualValue','blockingActualField',details->>'actualField','blockingThreshold',details->>'threshold',
   'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true),0,coalesce(order_no,''),created_at,record_id
  from selected_notes where v_kind='blockingOrders'
 ), page as (
  select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text,sort_id
  offset v_offset limit v_limit
 )
 select jsonb_build_object('available',e.collected>0 or e.complete,'source','NEWAR 已采集订单','basis','automaticReasonLabel',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'offset',v_offset,'limit',v_limit,
  'total',(select count(*) from rendered),'rows',coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text,sort_id) from page),'[]'::jsonb),
  'noteCount',case when e.collected>0 or e.complete then e.manual end,'categories','[]'::jsonb,
  'summary',case when e.collected>0 or e.complete then jsonb_build_object(
   'totalRejected',e.rejected,'selectedCount',(select count(*) from selected_notes),
   'operatorBasis','verified_business_schema_v2','operatorCounts',jsonb_build_object('total',e.collected,'manual',e.manual,'system',e.system,'unknown',e.unknown,
    'manualWithReason',ns.present,'manualWithoutReason',ns.unknown),
   'blockingCounts',jsonb_build_object('raw',ns.present,'manual',ns.present,'system',0,'unknown',0)) else '{}'::jsonb end,
  'canViewBlockingOrders',true,'canViewOrders',false,'canViewOperators',false,'timeBasis','created_at',
  'coverage',jsonb_build_object('collected',e.collected,'expected',null,'complete',e.complete,'rejected',case when e.collected>0 or e.complete then e.rejected end,
   'withManualRemark',case when e.collected>0 or e.complete then ns.present end,'state',case when e.complete then 'complete' when e.collected>0 then 'received_partial' else 'no_received_facts' end),
  'updatedAt',e.updated,'latestSnapshotDate',null,'snapshotFallback',false,
  'message',case when e.collected=0 and not e.complete then '所选日期尚无已入库提现明细；不能认定为零笔或已完整采集' end)
 into v_result from evidence e cross join note_stats ns;
 return v_result;
end;
$function$;
revoke all on function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
alter function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb) owner to postgres;
do $patch$
declare p record;d text;before_meta jsonb;anchor text:=$anchor$ if v_meta.source='ar' then
$anchor$;
 replacement text:=$replacement$ -- newar_received_blocking_v1: validated request and fresh scoped native metadata.
 v_rows:=private.dashboard_admin_newar_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
 if v_rows is not null then return v_rows;end if;
 if v_meta.source='ar' then
$replacement$;
begin
 select q.*,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc)='f24047cc2ac6669a2cc251e6ecb6851c' then return;end if;
 if md5(p.prosrc)<>'602ca2fec8c9460eb4f9efb3f639ea35' then raise exception 'newar_blocking_reader_definition_drift';end if;
 if (length(p.prosrc)-length(replace(p.prosrc,anchor,'')))/length(anchor)<>1 then raise exception 'newar_blocking_reader_anchor_drift';end if;
 before_meta:=p.metadata;d:=pg_get_functiondef(p.oid);execute replace(d,anchor,replacement);
 select q.*,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid=p.oid;
 if md5(p.prosrc)<>'f24047cc2ac6669a2cc251e6ecb6851c' or p.metadata is distinct from before_meta then raise exception 'newar_blocking_reader_postcondition';end if;
end;$patch$;
do $postcondition$
declare p record;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid='private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)'::regprocedure;
 if p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres}' or md5(p.prosrc)<>'25998ec79da2b15a62892746e8321160' then raise exception 'newar_blocking_helper_postcondition';end if;
end;$postcondition$;
commit;
