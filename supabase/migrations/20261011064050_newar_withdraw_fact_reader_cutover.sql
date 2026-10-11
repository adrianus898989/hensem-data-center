-- Separate cutover: install trigger and complete verified online backfill first.
-- Full exact typed parity; timeout/failure rolls back without switching the helper.
begin;
-- Maintenance-only full-history consistency scan; the application/RPC 8s budget is unchanged.
set local lock_timeout='5s';set local statement_timeout='120s';
do $prerequisite$
declare p record; c record;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q
  where q.oid='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres}'
  then raise exception 'newar_withdraw_fact_reader_metadata_drift';end if;
 if md5(p.prosrc) not in ('47fe6d24232211930ea6c0aae3e2ea11','450e601fef3810bf73c438d37762dd70')
  then raise exception 'newar_withdraw_fact_reader_definition_drift';end if;
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q
  where q.oid='private.newar_stats_time(text)'::regprocedure;
 if p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'i'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres}' or md5(p.prosrc)<>'5789c6b60e5bf5789b1ac1733df85c34'
  then raise exception 'newar_withdraw_fact_time_parser_drift';end if;
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q
  where q.oid='private.ingest_newar_detail_batch(text,jsonb)'::regprocedure;
 if p.owner_name<>'postgres' or not p.prosecdef or p.provolatile<>'v'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  or md5(p.prosrc)<>'1fb685e530ef1fe58964e69301e7f2c4'
  then raise exception 'newar_withdraw_fact_ingest_drift';end if;
 select q.*,pg_get_userbyid(q.relowner) owner_name into c from pg_class q
  where q.oid='public.newar_detail_records'::regclass;
 if c.owner_name<>'postgres' or c.relkind<>'r' or not c.relrowsecurity or c.relforcerowsecurity
  then raise exception 'newar_withdraw_fact_source_metadata_drift';end if;
 if exists(select 1 from (values
  ('id','uuid',true),('platform','text',true),('dataset','text',true),('source_id','text',true),
  ('status_group','text',true),('currency','text',false),('created_at','timestamp with time zone',true),
  ('captured_at','timestamp with time zone',true),('received_at','timestamp with time zone',true),('raw','jsonb',true)
 ) expected(name,type,not_null) left join pg_attribute a on a.attrelid=c.oid and a.attname=expected.name and not a.attisdropped
 where a.attname is null or format_type(a.atttypid,a.atttypmod)<>expected.type or a.attnotnull<>expected.not_null)
 then raise exception 'newar_withdraw_fact_source_columns_drift';end if;
 if not exists(select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='p' and k.convalidated
  and pg_get_constraintdef(k.oid)='PRIMARY KEY (id)') then raise exception 'newar_withdraw_fact_source_key_drift';end if;
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
do $parity$
declare proof record;
begin
 -- One source/fact snapshot replaces three full scans and random source-PK probes.
 -- Inline the fingerprinted projector's exact expressions: only referenced source
 -- columns are read, with no per-row SQL function/composite-record boundary.
 with expected as materialized (
  select n.id record_id,n.platform,n.source_id,n.status_group,n.currency,n.created_at,n.captured_at,n.received_at,
   case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
    and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual') then r."operatorType" end method,
   case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
    and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual')
    then btrim(r."operatorName") else '（未知操作人）' end account,
   case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
    and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceSubmittedAt") end submitted_at,
   case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
    and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceHandledAt") end handled_at
  from public.newar_detail_records n
  cross join lateral jsonb_to_record(case when jsonb_typeof(n.raw)='object' then n.raw else '{}'::jsonb end)
   r("businessSchemaVersion" text,"operatorType" text,"operatorName" text,"operatorSourceField" text,
     "sourceSubmittedAt" text,"sourceSubmittedSourceField" text,"sourceHandledAt" text,"sourceHandledSourceField" text)
  where n.dataset='withdraw'
 )
 select coalesce(bool_or(expected.record_id is not null and actual.record_id is null),false) missing,
  coalesce(bool_or(expected.record_id is null and actual.record_id is not null),false) extra,
  coalesce(bool_or(expected.record_id is not null and actual.record_id is not null and
   row(expected.record_id,expected.platform,expected.source_id,expected.status_group,expected.currency,expected.created_at,expected.captured_at,expected.received_at,expected.method,expected.account,expected.submitted_at,expected.handled_at) is distinct from
   row(actual.record_id,actual.platform,actual.source_id,actual.status_group,actual.currency,actual.created_at,actual.captured_at,actual.received_at,actual.method,actual.account,actual.submitted_at,actual.handled_at)),false) mismatch
 into proof
 from expected full join private.newar_withdraw_facts actual on actual.record_id=expected.record_id;
 if proof.missing then raise exception 'newar_withdraw_fact_backfill_incomplete';end if;
 if proof.extra then raise exception 'newar_withdraw_fact_backfill_extra';end if;
 if proof.mismatch then raise exception 'newar_withdraw_fact_backfill_mismatch';end if;
end;$parity$;
do $patch$
declare p record;definition text;before_metadata jsonb;
 old_part text:=$old$   case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
    and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual') then r."operatorType" end method,
   case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
    and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual')
    then btrim(r."operatorName") else '（未知操作人）' end account,
   case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
    and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceSubmittedAt") end submitted_at,
   case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
    and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceHandledAt") end handled_at
  from sites s join public.newar_detail_records n on n.platform=s.source_name and n.dataset='withdraw'
  cross join lateral jsonb_to_record(case when jsonb_typeof(n.raw)='object' then n.raw else '{}'::jsonb end)
   r("businessSchemaVersion" text,"operatorType" text,"operatorName" text,"operatorSourceField" text,
     "sourceSubmittedAt" text,"sourceSubmittedSourceField" text,"sourceHandledAt" text,"sourceHandledSourceField" text)
$old$;
 new_part text:=$new$   n.method,n.account,n.submitted_at,n.handled_at
  from sites s join private.newar_withdraw_facts n on n.platform=s.source_name
$new$;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q
  where q.oid='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if md5(p.prosrc)='450e601fef3810bf73c438d37762dd70' then return;end if;
 select pg_get_functiondef(q.oid),to_jsonb(q)-'prosrc' into definition,before_metadata from pg_proc q where q.oid=p.oid;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'newar_withdraw_fact_reader_anchor_drift';end if;
 execute replace(definition,old_part,new_part);
 if (select md5(q.prosrc) from pg_proc q where q.oid=p.oid)<>'450e601fef3810bf73c438d37762dd70'
  or (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=p.oid) is distinct from before_metadata
  then raise exception 'newar_withdraw_fact_reader_postcondition_failed';end if;
end;$patch$;
commit;
