-- Install only: no source-table rewrite, historical backfill, or reader switch.
-- Commit this migration before online FOR SHARE SKIP LOCKED backfill batches.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
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
do $existing$
declare p record;
begin
 for p in select q.* from pg_proc q where q.oid in
  (to_regprocedure('private.newar_withdraw_fact(public.newar_detail_records)'),to_regprocedure('private.sync_newar_withdraw_fact()')) loop
  if pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from (p.proname='sync_newar_withdraw_fact') or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proacl::text is distinct from '{postgres=X/postgres}'
   or (case when p.proname='newar_withdraw_fact' then md5(p.prosrc)<>'f15a0b562b7f5def87aba1a36ba19506' else md5(p.prosrc)<>'a3daa3b8470e92bc410b745f343a3a1e' end)
   then raise exception 'newar_withdraw_fact_existing_function_drift';end if;
 end loop;
 if exists(select 1 from pg_trigger where tgrelid='public.newar_detail_records'::regclass and tgname='newar_detail_withdraw_fact_sync' and not tgisinternal)
  and not exists(select 1 from pg_trigger where tgrelid='public.newar_detail_records'::regclass and tgname='newar_detail_withdraw_fact_sync'
   and not tgisinternal and tgfoid=to_regprocedure('private.sync_newar_withdraw_fact()') and tgtype=29 and tgenabled='O'
   and tgqual is null and tgattr::text='' and tgnargs=0)
  then raise exception 'newar_withdraw_fact_existing_trigger_drift';end if;
end;$existing$;
create table if not exists private.newar_withdraw_facts(
 record_id uuid primary key references public.newar_detail_records(id) on update cascade on delete cascade,
 platform text not null,source_id text not null,status_group text not null,currency text,
 created_at timestamptz not null,captured_at timestamptz not null,received_at timestamptz not null,
 method text check(method in ('auto','manual')),account text not null,submitted_at timestamptz,handled_at timestamptz
) with(fillfactor=90,autovacuum_vacuum_scale_factor=0.02,autovacuum_vacuum_threshold=1000,
 autovacuum_analyze_scale_factor=0.02,autovacuum_analyze_threshold=1000);
-- Refuse preexisting objects with unexpected data access instead of silently repairing drift.
do $table_acl$
declare c record;
begin
 select * into c from pg_class where oid='private.newar_withdraw_facts'::regclass;
 if pg_get_userbyid(c.relowner)<>'postgres' or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)
  or exists(select 1 from pg_policy where polrelid=c.oid) then raise exception 'newar_withdraw_fact_existing_table_acl_drift';end if;
end;$table_acl$;
alter table private.newar_withdraw_facts enable row level security;
revoke all on private.newar_withdraw_facts from public,anon,authenticated,service_role;
create index if not exists newar_withdraw_facts_platform_created_idx on private.newar_withdraw_facts(platform,created_at);
create or replace function private.newar_withdraw_fact(p public.newar_detail_records)
returns table(record_id uuid,platform text,source_id text,status_group text,currency text,created_at timestamptz,
 captured_at timestamptz,received_at timestamptz,method text,account text,submitted_at timestamptz,handled_at timestamptz)
language sql immutable security invoker set search_path='' as $projector$
 select p.id,p.platform,p.source_id,p.status_group,p.currency,p.created_at,p.captured_at,p.received_at,
  case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
   and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual') then r."operatorType" end,
  case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
   and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual')
   then btrim(r."operatorName") else '（未知操作人）' end,
  case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
   and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceSubmittedAt") end,
  case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
   and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceHandledAt") end
 from jsonb_to_record(case when jsonb_typeof(p.raw)='object' then p.raw else '{}'::jsonb end)
  r("businessSchemaVersion" text,"operatorType" text,"operatorName" text,"operatorSourceField" text,
    "sourceSubmittedAt" text,"sourceSubmittedSourceField" text,"sourceHandledAt" text,"sourceHandledSourceField" text)
 where p.dataset='withdraw';
$projector$;
create or replace function private.sync_newar_withdraw_fact() returns trigger
language plpgsql volatile security definer set search_path='' as $trigger$
begin
 if TG_RELID<>'public.newar_detail_records'::regclass or TG_WHEN<>'AFTER' or TG_LEVEL<>'ROW' then
  raise exception 'newar_withdraw_fact_trigger_context_invalid';
 end if;
 if TG_OP='INSERT' and NEW.dataset<>'withdraw' then return NEW;end if;
 if TG_OP='UPDATE' and OLD.dataset<>'withdraw' and NEW.dataset<>'withdraw' then return NEW;end if;
 if TG_OP='DELETE' and OLD.dataset<>'withdraw' then return OLD;end if;
 if TG_OP='DELETE' then
  delete from private.newar_withdraw_facts where record_id=OLD.id;
  return OLD;
 end if;
 if TG_OP='UPDATE' and OLD.id is distinct from NEW.id then
  delete from private.newar_withdraw_facts where record_id=OLD.id;
 end if;
 if NEW.dataset='withdraw' then
  insert into private.newar_withdraw_facts(record_id,platform,source_id,status_group,currency,created_at,captured_at,received_at,method,account,submitted_at,handled_at)
  select * from private.newar_withdraw_fact(NEW)
  on conflict(record_id) do update set
   platform=excluded.platform,source_id=excluded.source_id,status_group=excluded.status_group,currency=excluded.currency,
   created_at=excluded.created_at,captured_at=excluded.captured_at,received_at=excluded.received_at,
   method=excluded.method,account=excluded.account,submitted_at=excluded.submitted_at,handled_at=excluded.handled_at;
 else
  delete from private.newar_withdraw_facts where record_id=NEW.id;
 end if;
 return NEW;
end;
$trigger$;
revoke all on function private.newar_withdraw_fact(public.newar_detail_records),private.sync_newar_withdraw_fact() from public,anon,authenticated,service_role;
grant execute on function private.newar_withdraw_fact(public.newar_detail_records),private.sync_newar_withdraw_fact() to postgres;
do $install_trigger$
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.newar_detail_records'::regclass and tgname='newar_detail_withdraw_fact_sync' and not tgisinternal) then
  create trigger newar_detail_withdraw_fact_sync after insert or delete or update on public.newar_detail_records
   for each row execute function private.sync_newar_withdraw_fact();
 end if;
end;$install_trigger$;
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
commit;
