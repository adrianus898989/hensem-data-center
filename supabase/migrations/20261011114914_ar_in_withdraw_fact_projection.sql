-- OFFLINE PROTOTYPE: install only, no backfill, no reader cutover, no source data rewrite.
-- Only AR/IN/withdraw/native applied_at>=Oct10 is projected. Root must review before DDL.
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
  or p.proacl::text is distinct from '{postgres=X/postgres}' or md5(p.prosrc)<>'53cf57763dca603f812cf91c1dea7bb7'
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
create table if not exists private.ar_withdraw_facts(
 source_system text not null,country_code text not null,platform text not null,order_kind text not null,order_no text not null,
 status text not null,applied_at timestamp not null,account text not null,seconds numeric,
 is_success boolean not null,is_rejected boolean not null,method text not null check(method in('auto','manual','unknown')),
 observed_at timestamptz not null,updated_at timestamptz not null,
 primary key(source_system,country_code,platform,order_kind,order_no),
 foreign key(source_system,country_code,platform,order_kind,order_no)
  references public.ar_collected_orders(source_system,country_code,platform,order_kind,order_no)
  on delete cascade deferrable initially deferred,
 check(source_system='AR' and country_code='IN' and order_kind='withdraw' and applied_at>=timestamp '2026-10-10')
) with(fillfactor=90,autovacuum_vacuum_scale_factor=0.02,autovacuum_vacuum_threshold=1000,
 autovacuum_analyze_scale_factor=0.02,autovacuum_analyze_threshold=1000);
do $table_acl$
declare c record;
begin
 select * into c from pg_class where oid='private.ar_withdraw_facts'::regclass;
 if pg_get_userbyid(c.relowner)<>'postgres' or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
  or exists(select 1 from pg_policy where polrelid=c.oid) then raise exception 'ar_withdraw_fact_table_acl_drift';end if;
end;$table_acl$;
alter table private.ar_withdraw_facts enable row level security;
revoke all on private.ar_withdraw_facts from public,anon,authenticated,service_role;
create index if not exists ar_withdraw_facts_scope_applied_idx on private.ar_withdraw_facts(country_code,platform,applied_at);
create or replace function private.ar_withdraw_fact(p_source_system text,p_country_code text,p_platform text,p_order_kind text,p_order_no text,
 p_status text,p_operator text,p_applied_at timestamp,p_completed_at timestamp,p_observed_at timestamptz,p_updated_at timestamptz)
returns table(source_system text,country_code text,platform text,order_kind text,order_no text,status text,applied_at timestamp,
 account text,seconds numeric,is_success boolean,is_rejected boolean,method text,observed_at timestamptz,updated_at timestamptz)
language sql immutable security invoker set search_path='' as $projector$
 select p_source_system,p_country_code,p_platform,p_order_kind,p_order_no,f.status,p_applied_at,f.account,f.seconds,
  (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0
   OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0)
   OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0),
  (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0
   OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0),
  CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN 'unknown'
   WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END,
  p_observed_at,p_updated_at
 from (select coalesce(p_status,'') status,
  btrim(replace(replace(coalesce(p_operator,''),chr(8203),''),chr(65279),''),
   U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') account,
  CASE WHEN p_completed_at>p_applied_at THEN trunc(extract(epoch FROM p_completed_at-p_applied_at)) END seconds
  offset 0) f
 where p_source_system='AR' and p_country_code='IN' and p_order_kind='withdraw' and p_applied_at>=timestamp '2026-10-10';
$projector$;
create or replace function private.sync_ar_withdraw_fact() returns trigger
language plpgsql volatile security definer set search_path='' as $trigger$
begin
 if TG_RELID<>'public.ar_collected_orders'::regclass or TG_WHEN<>'AFTER' or TG_LEVEL<>'ROW' then
  raise exception 'ar_withdraw_fact_trigger_context_invalid';end if;
 if TG_OP='DELETE' then
  delete from private.ar_withdraw_facts where (source_system,country_code,platform,order_kind,order_no)=
   (OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no);return OLD;
 end if;
 if TG_OP='UPDATE' and (OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no) is distinct from
  (NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.order_no) then
  delete from private.ar_withdraw_facts where (source_system,country_code,platform,order_kind,order_no)=
   (OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no);
 end if;
 if NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw' and NEW.applied_at>=timestamp '2026-10-10' then
  insert into private.ar_withdraw_facts as current_fact(source_system,country_code,platform,order_kind,order_no,status,applied_at,account,seconds,is_success,is_rejected,method,observed_at,updated_at)
  select * from private.ar_withdraw_fact(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.order_no,
   NEW.status,NEW.operator,NEW.applied_at,NEW.completed_at,NEW.observed_at,NEW.updated_at)
  on conflict(source_system,country_code,platform,order_kind,order_no) do update set
   status=excluded.status,
   applied_at=excluded.applied_at,
   account=excluded.account,
   seconds=excluded.seconds,
   is_success=excluded.is_success,
   is_rejected=excluded.is_rejected,
   method=excluded.method,
   observed_at=excluded.observed_at,
   updated_at=excluded.updated_at
  where (current_fact.status,current_fact.applied_at,current_fact.account,current_fact.seconds,current_fact.is_success,current_fact.is_rejected,current_fact.method,current_fact.observed_at,current_fact.updated_at) is distinct from
   (excluded.status,excluded.applied_at,excluded.account,excluded.seconds,excluded.is_success,excluded.is_rejected,excluded.method,excluded.observed_at,excluded.updated_at);
 else
  delete from private.ar_withdraw_facts where (source_system,country_code,platform,order_kind,order_no)=
   (NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.order_no);
 end if;
 return NEW;
end;
$trigger$;
alter table private.ar_withdraw_facts owner to postgres;alter function private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp without time zone,timestamp without time zone,timestamp with time zone,timestamp with time zone) owner to postgres;alter function private.sync_ar_withdraw_fact() owner to postgres;
revoke all on function private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp without time zone,timestamp without time zone,timestamp with time zone,timestamp with time zone),private.sync_ar_withdraw_fact() from public,anon,authenticated,service_role;
do $install_insert$
begin
 if exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_withdraw_fact_sync_insert' and not tgisinternal) then
  if not exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_withdraw_fact_sync_insert' and not tgisinternal
   and tgfoid='private.sync_ar_withdraw_fact()'::regprocedure and tgtype=5 and tgenabled='O' and tgnargs=0 and tgattr::text=''
   and pg_get_triggerdef(oid)='CREATE TRIGGER ar_withdraw_fact_sync_insert AFTER INSERT ON public.ar_collected_orders FOR EACH ROW WHEN (((new.source_system = ''AR''::text) AND (new.country_code = ''IN''::text) AND (new.order_kind = ''withdraw''::text) AND (new.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()')
   then raise exception 'ar_withdraw_fact_trigger_drift';end if;
 else
  create trigger ar_withdraw_fact_sync_insert after insert on public.ar_collected_orders for each row when (NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw' and NEW.applied_at>=timestamp '2026-10-10') execute function private.sync_ar_withdraw_fact();
 end if;
end;$install_insert$;
do $install_update$
begin
 if exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_withdraw_fact_sync_update' and not tgisinternal) then
  if not exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_withdraw_fact_sync_update' and not tgisinternal
   and tgfoid='private.sync_ar_withdraw_fact()'::regprocedure and tgtype=17 and tgenabled='O' and tgnargs=0 and tgattr::text=''
   and pg_get_triggerdef(oid)='CREATE TRIGGER ar_withdraw_fact_sync_update AFTER UPDATE ON public.ar_collected_orders FOR EACH ROW WHEN ((((old.source_system = ''AR''::text) AND (old.country_code = ''IN''::text) AND (old.order_kind = ''withdraw''::text) AND (old.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)) OR ((new.source_system = ''AR''::text) AND (new.country_code = ''IN''::text) AND (new.order_kind = ''withdraw''::text) AND (new.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()')
   then raise exception 'ar_withdraw_fact_trigger_drift';end if;
 else
  create trigger ar_withdraw_fact_sync_update after update on public.ar_collected_orders for each row when ((OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw' and OLD.applied_at>=timestamp '2026-10-10') or (NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw' and NEW.applied_at>=timestamp '2026-10-10')) execute function private.sync_ar_withdraw_fact();
 end if;
end;$install_update$;
do $install_delete$
begin
 if exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_withdraw_fact_sync_delete' and not tgisinternal) then
  if not exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_withdraw_fact_sync_delete' and not tgisinternal
   and tgfoid='private.sync_ar_withdraw_fact()'::regprocedure and tgtype=9 and tgenabled='O' and tgnargs=0 and tgattr::text=''
   and pg_get_triggerdef(oid)='CREATE TRIGGER ar_withdraw_fact_sync_delete AFTER DELETE ON public.ar_collected_orders FOR EACH ROW WHEN (((old.source_system = ''AR''::text) AND (old.country_code = ''IN''::text) AND (old.order_kind = ''withdraw''::text) AND (old.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()')
   then raise exception 'ar_withdraw_fact_trigger_drift';end if;
 else
  create trigger ar_withdraw_fact_sync_delete after delete on public.ar_collected_orders for each row when (OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw' and OLD.applied_at>=timestamp '2026-10-10') execute function private.sync_ar_withdraw_fact();
 end if;
end;$install_delete$;
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
commit;
