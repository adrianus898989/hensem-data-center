-- OFFLINE GUARDED CANDIDATE: controls only, reader unchanged.
begin;
set local lock_timeout='2s';set local statement_timeout='20s';
do $prerequisite$
declare c record;p record;
begin
 select q.*,pg_get_userbyid(q.relowner) owner_name into c from pg_class q where oid='public.ar_collected_orders'::regclass;
 if c.owner_name<>'postgres' or c.relkind<>'r' or not c.relrowsecurity or c.relforcerowsecurity
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee not in
   (c.relowner,(select oid from pg_roles where rolname='service_role'))) then raise exception 'ar_withdraw_fact_source_metadata_drift';end if;
 if exists(select 1 from (values ('source_system','text',true),
  ('country_code','text',true),
  ('platform','text',true),
  ('order_kind','text',true),
  ('order_no','text',true),
  ('status','text',false),
  ('operator','text',false),
  ('applied_at','timestamp without time zone',false),
  ('completed_at','timestamp without time zone',false),
  ('observed_at','timestamp with time zone',true),
  ('updated_at','timestamp with time zone',true))e(name,type,not_null)
  left join pg_attribute a on a.attrelid=c.oid and a.attname=e.name and not a.attisdropped
  where a.attname is null or format_type(a.atttypid,a.atttypmod)<>e.type or a.attnotnull<>e.not_null)
  then raise exception 'ar_withdraw_fact_source_columns_drift';end if;
 if not exists(select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='p' and k.convalidated and not k.condeferrable
  and pg_get_constraintdef(k.oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
  then raise exception 'ar_withdraw_fact_source_key_drift';end if;
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres}' or md5(p.prosrc) not in('53cf57763dca603f812cf91c1dea7bb7','90a9a7aa8e3142494d37d3a6cb6c2a8d')
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.proparallel<>'u' or not p.proretset or p.prorettype<>'record'::regtype
  or pg_get_function_result(p.oid)<>'TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])'
  then raise exception 'ar_withdraw_fact_reader_baseline_drift';end if;
end;$prerequisite$;
do $existing$
declare p record;
begin
 for p in select q.* from pg_proc q where q.oid in(to_regprocedure('private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp without time zone,timestamp without time zone,timestamp with time zone,timestamp with time zone)'),to_regprocedure('private.sync_ar_withdraw_fact()')) loop
  if pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   or p.proparallel<>'u' or (case when p.proname='ar_withdraw_fact' then not p.proretset or p.prorettype<>'record'::regtype or pg_get_function_result(p.oid)<>'TABLE(source_system text, country_code text, platform text, order_kind text, order_no text, status text, applied_at timestamp without time zone, account text, seconds numeric, is_success boolean, is_rejected boolean, method text, observed_at timestamp with time zone, updated_at timestamp with time zone)' or p.prosecdef or p.provolatile<>'i' or p.prolang<>(select oid from pg_language where lanname='sql') or md5(p.prosrc)<>'2ced394f03ebe7de5dbb8721c8f73304'
    else p.proretset or p.prorettype<>'trigger'::regtype or p.pronargs<>0 or not p.prosecdef or p.provolatile<>'v' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or md5(p.prosrc)<>'fd2f53c73d864b0a6daa5c1016053894' end)
   then raise exception 'ar_withdraw_fact_existing_function_drift';end if;
 end loop;
 if exists(select 1 from pg_class where oid=to_regclass('private.ar_withdraw_facts') and (not relrowsecurity or relforcerowsecurity or pg_get_userbyid(relowner)<>'postgres')) then raise exception 'ar_withdraw_fact_existing_table_security_drift';end if;
end;$existing$;
do $objects$
declare c record;k record;
begin
 select * into c from pg_class where oid='private.ar_withdraw_facts'::regclass;
 if pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity or c.relkind<>'r'
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
  or exists(select 1 from pg_policy where polrelid=c.oid)
  then raise exception 'ar_withdraw_fact_final_metadata_drift';end if;
 if (select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum)
  from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped) is distinct from '[["source_system", "text", true], ["country_code", "text", true], ["platform", "text", true], ["order_kind", "text", true], ["order_no", "text", true], ["status", "text", true], ["applied_at", "timestamp without time zone", true], ["account", "text", true], ["seconds", "numeric", false], ["is_success", "boolean", true], ["is_rejected", "boolean", true], ["method", "text", true], ["observed_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]]'::jsonb
  then raise exception 'ar_withdraw_fact_columns_drift';end if;
 if not exists(select 1 from pg_constraint where conrelid=c.oid and contype='p' and convalidated and not condeferrable
  and pg_get_constraintdef(oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
  or not exists(select 1 from pg_constraint where conrelid=c.oid and contype='f' and confrelid='public.ar_collected_orders'::regclass
   and convalidated and condeferrable and condeferred and confdeltype='c' and confupdtype='a' and confmatchtype='s' and cardinality(conkey)=5
   and (select array_agg(a.attname::text order by v.ordinality) from unnest(confkey) with ordinality v(attnum,ordinality) join pg_attribute a on a.attrelid='public.ar_collected_orders'::regclass and a.attnum=v.attnum)=array['source_system','country_code','platform','order_kind','order_no']::text[]
   and (select array_agg(a.attname::text order by v.ordinality) from unnest(conkey) with ordinality v(attnum,ordinality) join pg_attribute a on a.attrelid=c.oid and a.attnum=v.attnum)=array['source_system','country_code','platform','order_kind','order_no']::text[])
  then raise exception 'ar_withdraw_fact_constraints_drift';end if;
 if (select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) from pg_constraint where conrelid=c.oid and contype='c' and convalidated and not connoinherit) is distinct from '["CHECK (((source_system = ''AR''::text) AND (country_code = ''IN''::text) AND (order_kind = ''withdraw''::text) AND (applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)))", "CHECK ((method = ANY (ARRAY[''auto''::text, ''manual''::text, ''unknown''::text])))"]'::jsonb or (select count(*) from pg_constraint where conrelid=c.oid and contype='c')<>2 then raise exception 'ar_withdraw_fact_checks_drift';end if;
 if not exists(select 1 from pg_index i where i.indexrelid='private.ar_withdraw_facts_scope_applied_idx'::regclass
  and i.indrelid=c.oid and i.indisvalid and i.indisready and i.indislive and not i.indisunique and i.indpred is null and i.indexprs is null
  and i.indnkeyatts=3 and i.indnatts=3 and i.indoption::text='0 0 0'
  and (select array_agg(a.attname::text order by v.ordinality) from unnest(i.indkey) with ordinality v(attnum,ordinality) join pg_attribute a on a.attrelid=c.oid and a.attnum=v.attnum)=array['country_code','platform','applied_at']::text[])
  then raise exception 'ar_withdraw_fact_index_drift';end if;
end;$objects$;
do $ready_tables$
declare c record;
begin
 if to_regclass('private.ar_withdraw_fact_future_ready') is not null then
  select * into c from pg_class where oid=to_regclass('private.ar_withdraw_fact_future_ready');
  if pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity or c.relkind<>'r'
   or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   or exists(select 1 from pg_policy where polrelid=c.oid)
   or (select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped) is distinct from '[["country_code", "text", true], ["platform", "text", true], ["future_from", "date", true], ["generation", "text", true], ["validated_at", "timestamp with time zone", true]]'::jsonb
   or (select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) from pg_constraint where conrelid=c.oid and contype<>'n') is distinct from '["CHECK ((country_code = ''IN''::text))", "CHECK ((isfinite(future_from) AND (future_from >= ''2026-10-10''::date)))", "CHECK ((length(generation) = 32))", "PRIMARY KEY (country_code, platform)"]'::jsonb
   or exists(select 1 from pg_constraint where conrelid=c.oid and contype<>'n' and (not convalidated or (contype='c' and connoinherit) or condeferrable))
   then raise exception 'ar_withdraw_ready_table_metadata_drift';end if;
 end if;
 if to_regclass('private.ar_withdraw_fact_ready') is not null then
  select * into c from pg_class where oid=to_regclass('private.ar_withdraw_fact_ready');
  if pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity or c.relkind<>'r'
   or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   or exists(select 1 from pg_policy where polrelid=c.oid)
   or (select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped) is distinct from '[["country_code", "text", true], ["platform", "text", true], ["data_date", "date", true], ["generation", "text", true], ["source_count", "bigint", true], ["validated_at", "timestamp with time zone", true]]'::jsonb
   or (select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) from pg_constraint where conrelid=c.oid and contype<>'n') is distinct from '["CHECK ((country_code = ''IN''::text))", "CHECK ((isfinite(data_date) AND (data_date >= ''2026-10-10''::date)))", "CHECK ((length(generation) = 32))", "CHECK ((source_count >= 0))", "PRIMARY KEY (country_code, platform, data_date)"]'::jsonb
   or exists(select 1 from pg_constraint where conrelid=c.oid and contype<>'n' and (not convalidated or (contype='c' and connoinherit) or condeferrable))
   then raise exception 'ar_withdraw_ready_table_metadata_drift';end if;
 end if;
end;$ready_tables$;
create table if not exists private.ar_withdraw_fact_ready(
 country_code text not null check(country_code='IN'),platform text not null,
 data_date date not null check(isfinite(data_date) and data_date>=date '2026-10-10'),
 generation text not null check(length(generation)=32),source_count bigint not null check(source_count>=0),validated_at timestamptz not null,
 primary key(country_code,platform,data_date));
create table if not exists private.ar_withdraw_fact_future_ready(
 country_code text not null check(country_code='IN'),platform text not null,
 future_from date not null check(isfinite(future_from) and future_from>=date '2026-10-10'),
 generation text not null check(length(generation)=32),validated_at timestamptz not null,
 primary key(country_code,platform));
alter table private.ar_withdraw_fact_ready enable row level security;
alter table private.ar_withdraw_fact_future_ready enable row level security;
revoke all on private.ar_withdraw_fact_ready,private.ar_withdraw_fact_future_ready from public,anon,authenticated,service_role;
alter table private.ar_withdraw_fact_ready owner to postgres;alter table private.ar_withdraw_fact_future_ready owner to postgres;
do $install_invalidate_ar_withdraw_ready$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.invalidate_ar_withdraw_ready()');
 if p.oid is null then
  execute $new_invalidate_ar_withdraw_ready$create or replace function private.invalidate_ar_withdraw_ready() returns trigger language plpgsql volatile security definer set search_path='' as $control$
begin
 if TG_RELID<>'private.ar_withdraw_facts'::regclass or TG_WHEN<>'AFTER' then raise exception 'ar_withdraw_ready_context_invalid';end if;
 -- Source-maintenance/FK cascades are already atomic and preserve approvals.
 -- Direct private maintenance is not a source write and must revoke approval.
 if pg_trigger_depth()>1 then return null;end if;
 if TG_OP='TRUNCATE' then
  delete from private.ar_withdraw_fact_ready;delete from private.ar_withdraw_fact_future_ready;return null;
 end if;
 if TG_OP in('DELETE','UPDATE') then
  delete from private.ar_withdraw_fact_ready where country_code=OLD.country_code and platform=OLD.platform and data_date=OLD.applied_at::date;
  delete from private.ar_withdraw_fact_future_ready where country_code=OLD.country_code and platform=OLD.platform and OLD.applied_at>=future_from::timestamp;
 end if;
 if TG_OP in('INSERT','UPDATE') then
  delete from private.ar_withdraw_fact_ready where country_code=NEW.country_code and platform=NEW.platform and data_date=NEW.applied_at::date;
  delete from private.ar_withdraw_fact_future_ready where country_code=NEW.country_code and platform=NEW.platform and NEW.applied_at>=future_from::timestamp;
 end if;
 return null;
end;
$control$;
alter function private.invalidate_ar_withdraw_ready() owner to postgres;
revoke all on function private.invalidate_ar_withdraw_ready() from public,anon,authenticated,service_role;
$new_invalidate_ar_withdraw_ready$;
 else
  if pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
   or p.provolatile<>'v' or p.prosecdef<>true or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   or pg_get_function_arguments(p.oid)<>'' or pg_get_function_result(p.oid)<>'trigger' or md5(p.prosrc)<>'e38baf782d5ad203998661c79823e24f'
   then raise exception 'ar_withdraw_ready_function_metadata_drift';end if;
 end if;
end;$install_invalidate_ar_withdraw_ready$;
do $install_ar_withdraw_fact_ready_change$
begin
 if exists(select 1 from pg_trigger where tgrelid='private.ar_withdraw_facts'::regclass and tgname='ar_withdraw_fact_ready_change' and not tgisinternal) then
  if not exists(select 1 from pg_trigger where tgrelid='private.ar_withdraw_facts'::regclass and tgname='ar_withdraw_fact_ready_change' and not tgisinternal and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER ar_withdraw_fact_ready_change AFTER INSERT OR DELETE OR UPDATE ON private.ar_withdraw_facts FOR EACH ROW EXECUTE FUNCTION private.invalidate_ar_withdraw_ready()')
   then raise exception 'ar_withdraw_ready_control_trigger_drift';end if;
 else
  CREATE TRIGGER ar_withdraw_fact_ready_change AFTER INSERT OR DELETE OR UPDATE ON private.ar_withdraw_facts FOR EACH ROW EXECUTE FUNCTION private.invalidate_ar_withdraw_ready();
 end if;
end;$install_ar_withdraw_fact_ready_change$;
do $install_ar_withdraw_fact_ready_truncate$
begin
 if exists(select 1 from pg_trigger where tgrelid='private.ar_withdraw_facts'::regclass and tgname='ar_withdraw_fact_ready_truncate' and not tgisinternal) then
  if not exists(select 1 from pg_trigger where tgrelid='private.ar_withdraw_facts'::regclass and tgname='ar_withdraw_fact_ready_truncate' and not tgisinternal and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER ar_withdraw_fact_ready_truncate AFTER TRUNCATE ON private.ar_withdraw_facts FOR EACH STATEMENT EXECUTE FUNCTION private.invalidate_ar_withdraw_ready()')
   then raise exception 'ar_withdraw_ready_control_trigger_drift';end if;
 else
  CREATE TRIGGER ar_withdraw_fact_ready_truncate AFTER TRUNCATE ON private.ar_withdraw_facts FOR EACH STATEMENT EXECUTE FUNCTION private.invalidate_ar_withdraw_ready();
 end if;
end;$install_ar_withdraw_fact_ready_truncate$;
do $install_ar_withdraw_fact_generation$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.ar_withdraw_fact_generation()');
 if p.oid is null then
  execute $new_ar_withdraw_fact_generation$create or replace function private.ar_withdraw_fact_generation() returns text language sql stable security invoker set search_path='' as $generation$
 with functions as materialized (
  select p.*,p.xmin,pg_get_userbyid(p.proowner) owner_name from pg_catalog.pg_proc p where p.oid in(
   'private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp,timestamp,timestamptz,timestamptz)'::regprocedure,
   'private.sync_ar_withdraw_fact()'::regprocedure,'private.invalidate_ar_withdraw_ready()'::regprocedure)
 ), source_triggers as materialized (
  select t.oid,t.xmin::text epoch,pg_get_triggerdef(t.oid) definition from pg_catalog.pg_trigger t
  where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal and t.tgenabled='O'
   and t.tgfoid='private.sync_ar_withdraw_fact()'::regprocedure and ((t.tgname='ar_withdraw_fact_sync_delete' AND pg_get_triggerdef(t.oid)='CREATE TRIGGER ar_withdraw_fact_sync_delete AFTER DELETE ON public.ar_collected_orders FOR EACH ROW WHEN (((old.source_system = ''AR''::text) AND (old.country_code = ''IN''::text) AND (old.order_kind = ''withdraw''::text) AND (old.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()') OR (t.tgname='ar_withdraw_fact_sync_insert' AND pg_get_triggerdef(t.oid)='CREATE TRIGGER ar_withdraw_fact_sync_insert AFTER INSERT ON public.ar_collected_orders FOR EACH ROW WHEN (((new.source_system = ''AR''::text) AND (new.country_code = ''IN''::text) AND (new.order_kind = ''withdraw''::text) AND (new.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()') OR (t.tgname='ar_withdraw_fact_sync_update' AND pg_get_triggerdef(t.oid)='CREATE TRIGGER ar_withdraw_fact_sync_update AFTER UPDATE ON public.ar_collected_orders FOR EACH ROW WHEN ((((old.source_system = ''AR''::text) AND (old.country_code = ''IN''::text) AND (old.order_kind = ''withdraw''::text) AND (old.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)) OR ((new.source_system = ''AR''::text) AND (new.country_code = ''IN''::text) AND (new.order_kind = ''withdraw''::text) AND (new.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()'))
 ), control_triggers as materialized (
  select t.oid,t.xmin::text epoch,pg_get_triggerdef(t.oid) definition from pg_catalog.pg_trigger t
  where t.tgrelid='private.ar_withdraw_facts'::regclass and not t.tgisinternal and t.tgenabled='O'
   and t.tgfoid='private.invalidate_ar_withdraw_ready()'::regprocedure and t.tgnargs=0 and t.tgattr::text='' and t.tgqual is null
   and ((t.tgname='ar_withdraw_fact_ready_change' and t.tgtype=29) or (t.tgname='ar_withdraw_fact_ready_truncate' and t.tgtype=32))
 )
 select case when
  (select count(*) from source_triggers)=3 and (select count(*) from control_triggers)=2
  and (select count(*) from functions)=3 and not exists(select 1 from functions p where
   p.owner_name<>'postgres' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proacl::text is distinct from '{postgres=X/postgres}'
   or case when p.proname='ar_withdraw_fact' then p.prosecdef or p.provolatile<>'i' or p.prolang<>(select oid from pg_language where lanname='sql') or md5(p.prosrc)<>'2ced394f03ebe7de5dbb8721c8f73304'
    when p.proname='sync_ar_withdraw_fact' then not p.prosecdef or p.provolatile<>'v' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or md5(p.prosrc)<>'fd2f53c73d864b0a6daa5c1016053894'
    else not p.prosecdef or p.provolatile<>'v' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or md5(p.prosrc)<>'e38baf782d5ad203998661c79823e24f' end)
  and not exists(select 1 from pg_class c where c.oid in('private.ar_withdraw_facts'::regclass,
    'private.ar_withdraw_fact_ready'::regclass,'private.ar_withdraw_fact_future_ready'::regclass)
   and (pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity or
    exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner) or
    exists(select 1 from pg_policy p where p.polrelid=c.oid)))
 and (select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) from pg_constraint where conrelid='private.ar_withdraw_facts'::regclass and contype='c' and convalidated and not connoinherit)='["CHECK (((source_system = ''AR''::text) AND (country_code = ''IN''::text) AND (order_kind = ''withdraw''::text) AND (applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)))", "CHECK ((method = ANY (ARRAY[''auto''::text, ''manual''::text, ''unknown''::text])))"]'::jsonb
 then md5(jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_array(oid,xmin::text,md5(prosrc),proowner,prosecdef,provolatile,proparallel,proconfig,proacl::text) order by oid) from functions),
  'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from (select * from source_triggers union all select * from control_triggers)t))::text) end;
$generation$;
alter function private.ar_withdraw_fact_generation() owner to postgres;
revoke all on function private.ar_withdraw_fact_generation() from public,anon,authenticated,service_role;
$new_ar_withdraw_fact_generation$;
 else
  if pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_language where lanname='sql')
   or p.provolatile<>'s' or p.prosecdef<>false or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   or pg_get_function_arguments(p.oid)<>'' or pg_get_function_result(p.oid)<>'text' or md5(p.prosrc)<>'d55ef2b1f99bd2543f01d228dbe5e445'
   then raise exception 'ar_withdraw_ready_function_metadata_drift';end if;
 end if;
end;$install_ar_withdraw_fact_generation$;
do $install_approve_ar_withdraw_fact_day$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.approve_ar_withdraw_fact_day(text,date)');
 if p.oid is null then
  execute $new_approve_ar_withdraw_fact_day$create or replace function private.approve_ar_withdraw_fact_day(p_platform text,p_day date) returns jsonb language plpgsql volatile security invoker set search_path='' as $approve$
declare v_generation text;v_source_count bigint;v_missing bigint;v_extra bigint;v_bad bigint;
begin
 if current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar_withdraw_ready_requires_repeatable_read';end if;
 if p_platform is null or p_platform='' or p_day is null or not isfinite(p_day) or p_day<date '2026-10-10' then raise exception 'ar_withdraw_ready_partition_invalid';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_withdraw_facts in share update exclusive mode nowait;
 v_generation:=private.ar_withdraw_fact_generation();
 if v_generation is null then raise exception 'ar_withdraw_ready_generation_invalid';end if;
 with expected as materialized (
  select p.* from public.ar_collected_orders a cross join lateral private.ar_withdraw_fact(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,
   a.status,a.operator,a.applied_at,a.completed_at,a.observed_at,a.updated_at)p
  where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=timestamp '2026-10-10' and a.applied_at>=p_day::timestamp and a.applied_at<(p_day+1)::timestamp
 ), actual as materialized (
  select * from private.ar_withdraw_facts f where f.country_code='IN' and f.platform=p_platform and f.applied_at>=p_day::timestamp and f.applied_at<(p_day+1)::timestamp
 )
 select count(e.order_no),count(*) filter(where e.order_no is not null and f.order_no is null),
  count(*) filter(where e.order_no is null and f.order_no is not null),
  count(*) filter(where e.order_no is not null and f.order_no is not null and row(e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.status,e.applied_at,e.account,e.seconds,e.is_success,e.is_rejected,e.method,e.observed_at,e.updated_at) is distinct from row(f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.status,f.applied_at,f.account,f.seconds,f.is_success,f.is_rejected,f.method,f.observed_at,f.updated_at))
 into v_source_count,v_missing,v_extra,v_bad
 from expected e full join actual f using(source_system,country_code,platform,order_kind,order_no);
 if v_missing<>0 or v_extra<>0 or v_bad<>0 then raise exception 'ar_withdraw_ready_parity_failed' using detail=format('missing=%s extra=%s changed=%s',v_missing,v_extra,v_bad);end if;
 insert into private.ar_withdraw_fact_ready values('IN',p_platform,p_day,v_generation,v_source_count,clock_timestamp())
 on conflict(country_code,platform,data_date) do update set generation=excluded.generation,source_count=excluded.source_count,validated_at=excluded.validated_at;
 return jsonb_build_object('platform',p_platform,'day',p_day,'sourceCount',v_source_count,'generation',v_generation,'approved',true);
end;
$approve$;
alter function private.approve_ar_withdraw_fact_day(text,date) owner to postgres;
revoke all on function private.approve_ar_withdraw_fact_day(text,date) from public,anon,authenticated,service_role;
$new_approve_ar_withdraw_fact_day$;
 else
  if pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
   or p.provolatile<>'v' or p.prosecdef<>false or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   or pg_get_function_arguments(p.oid)<>'p_platform text, p_day date' or pg_get_function_result(p.oid)<>'jsonb' or md5(p.prosrc)<>'0dc75b2ca94f1e4104d202b31e53fe6b'
   then raise exception 'ar_withdraw_ready_function_metadata_drift';end if;
 end if;
end;$install_approve_ar_withdraw_fact_day$;
do $install_approve_ar_withdraw_fact_future$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.approve_ar_withdraw_fact_future(text)');
 if p.oid is null then
  execute $new_approve_ar_withdraw_fact_future$create or replace function private.approve_ar_withdraw_fact_future(p_platform text) returns jsonb language plpgsql volatile security invoker set search_path='' as $future$
declare v_generation text;v_last timestamp;v_from date;
begin
 if current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar_withdraw_ready_requires_repeatable_read';end if;
 if p_platform is null or p_platform='' then raise exception 'ar_withdraw_ready_partition_invalid';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_withdraw_facts in share update exclusive mode nowait;
 v_generation:=private.ar_withdraw_fact_generation();if v_generation is null then raise exception 'ar_withdraw_ready_generation_invalid';end if;
 -- Finite dates are the only dates accepted by the public request. Infinity
 -- never becomes a finite requested day and does not approve an existing day.
 select a.applied_at into v_last from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN'
  and a.platform=p_platform and a.order_kind='withdraw' and a.applied_at>=timestamp '2026-10-10' and isfinite(a.applied_at)
 order by a.applied_at desc limit 1;
 v_from:=coalesce(v_last::date+1,date '2026-10-10');
 if not isfinite(v_from) or exists(select 1 from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN'
  and a.platform=p_platform and a.order_kind='withdraw' and a.applied_at>=v_from::timestamp and isfinite(a.applied_at))
  or exists(select 1 from private.ar_withdraw_facts f where f.country_code='IN' and f.platform=p_platform and f.applied_at>=v_from::timestamp and isfinite(f.applied_at))
  then raise exception 'ar_withdraw_ready_future_not_empty';end if;
 insert into private.ar_withdraw_fact_future_ready values('IN',p_platform,v_from,v_generation,clock_timestamp())
 on conflict(country_code,platform) do update set future_from=excluded.future_from,generation=excluded.generation,validated_at=excluded.validated_at;
 return jsonb_build_object('platform',p_platform,'futureFrom',v_from,'generation',v_generation,'approved',true);
end;
$future$;
alter function private.approve_ar_withdraw_fact_future(text) owner to postgres;
revoke all on function private.approve_ar_withdraw_fact_future(text) from public,anon,authenticated,service_role;
$new_approve_ar_withdraw_fact_future$;
 else
  if pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
   or p.provolatile<>'v' or p.prosecdef<>false or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   or pg_get_function_arguments(p.oid)<>'p_platform text' or pg_get_function_result(p.oid)<>'jsonb' or md5(p.prosrc)<>'31423c8a867aee054ab2e1bbc4e7b2f3'
   then raise exception 'ar_withdraw_ready_function_metadata_drift';end if;
 end if;
end;$install_approve_ar_withdraw_fact_future$;
do $ready_tables$
declare c record;
begin
 if to_regclass('private.ar_withdraw_fact_future_ready') is not null then
  select * into c from pg_class where oid=to_regclass('private.ar_withdraw_fact_future_ready');
  if pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity or c.relkind<>'r'
   or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   or exists(select 1 from pg_policy where polrelid=c.oid)
   or (select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped) is distinct from '[["country_code", "text", true], ["platform", "text", true], ["future_from", "date", true], ["generation", "text", true], ["validated_at", "timestamp with time zone", true]]'::jsonb
   or (select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) from pg_constraint where conrelid=c.oid and contype<>'n') is distinct from '["CHECK ((country_code = ''IN''::text))", "CHECK ((isfinite(future_from) AND (future_from >= ''2026-10-10''::date)))", "CHECK ((length(generation) = 32))", "PRIMARY KEY (country_code, platform)"]'::jsonb
   or exists(select 1 from pg_constraint where conrelid=c.oid and contype<>'n' and (not convalidated or (contype='c' and connoinherit) or condeferrable))
   then raise exception 'ar_withdraw_ready_table_metadata_drift';end if;
 end if;
 if to_regclass('private.ar_withdraw_fact_ready') is not null then
  select * into c from pg_class where oid=to_regclass('private.ar_withdraw_fact_ready');
  if pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity or c.relkind<>'r'
   or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   or exists(select 1 from pg_policy where polrelid=c.oid)
   or (select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped) is distinct from '[["country_code", "text", true], ["platform", "text", true], ["data_date", "date", true], ["generation", "text", true], ["source_count", "bigint", true], ["validated_at", "timestamp with time zone", true]]'::jsonb
   or (select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) from pg_constraint where conrelid=c.oid and contype<>'n') is distinct from '["CHECK ((country_code = ''IN''::text))", "CHECK ((isfinite(data_date) AND (data_date >= ''2026-10-10''::date)))", "CHECK ((length(generation) = 32))", "CHECK ((source_count >= 0))", "PRIMARY KEY (country_code, platform, data_date)"]'::jsonb
   or exists(select 1 from pg_constraint where conrelid=c.oid and contype<>'n' and (not convalidated or (contype='c' and connoinherit) or condeferrable))
   then raise exception 'ar_withdraw_ready_table_metadata_drift';end if;
 end if;
end;$ready_tables$;
do $final$ begin if private.ar_withdraw_fact_generation() is null then raise exception 'ar_withdraw_ready_generation_invalid';end if;end;$final$;
commit;
