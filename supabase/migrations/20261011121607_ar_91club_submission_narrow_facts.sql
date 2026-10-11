-- OFFLINE STAGE1. Install only; no backfill and no reader switch.
-- Exact AR/IN/91CLUB/recharge union: current cohorts, completed successes,
-- and ALL historical native NULL-time rows. Original money fields/scales retained.
begin;set local lock_timeout='2s';set local statement_timeout='20s';
lock table public.ar_collected_orders in share update exclusive mode nowait;
do $cover_guard$
declare
 target oid:=to_regclass('public.ar_collected_orders');
 p record;m record;t record;idx record;spec record;
 col record;actual_columns text[];
 require_indexes boolean:=false;
begin
 if current_setting('server_encoding')<>'UTF8' or current_setting('block_size')<>'8192'
  or current_setting('server_version_num')::integer/10000<>17 then
  raise exception 'AR91_COVER_SERVER_LAYOUT_DRIFT';end if;
 select c.*,pg_get_userbyid(c.relowner) owner_name into t from pg_class c where c.oid=target;
 if not found or t.relkind<>'r' or t.relpersistence<>'p' or t.owner_name<>'postgres'
  or not t.relrowsecurity or t.relforcerowsecurity
  or t.relacl::text is distinct from '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'
  or exists(select 1 from pg_inherits where inhparent=target or inhrelid=target) then
  raise exception 'AR91_COVER_TABLE_METADATA_DRIFT';end if;
 -- The enforced, VALIDATED bounds prove every existing and future native
 -- entry fits. No raw fact scan, truncation, new constraint or policy change.
 for spec in select * from (values
  ('order_no','text',true,false,100),('member_id','text',false,false,100),
  ('status','text',false,false,100),('raw_channel','text',false,false,100),
  ('applied_at','timestamp without time zone',false,false,0),
  ('completed_at','timestamp without time zone',false,false,0),
  ('member_level','integer',false,false,0),('recharge_count','integer',false,false,0),
  ('source_system','text',true,false,100),('country_code','text',true,false,100),
  ('platform','text',true,false,100),('order_kind','text',true,false,100),
  ('channel_type','text',false,false,100),('money_format_version','smallint',false,false,0),
  ('amount_local','numeric',false,false,0),('currency_local','text',false,false,100),
  ('money_issue_code','text',false,false,100),('amount','numeric(20,2)',false,false,0)
 ) v(name,type_name,not_null,has_default,collation_oid) loop
  select a.*,format_type(a.atttypid,a.atttypmod) type_name into col from pg_attribute a
   where a.attrelid=target and a.attname=spec.name and a.attnum>0 and not a.attisdropped;
  if not found or col.type_name<>spec.type_name or col.attnotnull<>spec.not_null
   or col.atthasdef<>spec.has_default or col.attcollation<>spec.collation_oid then
   raise exception 'AR91_COVER_COLUMN_DRIFT';end if;
 end loop;
 for spec in select * from (values
  ('ar_collected_orders_order_no_check','CHECK (((length(order_no) >= 1) AND (length(order_no) <= 160)))'),
  ('ar_collected_orders_member_id_check','CHECK (((length(member_id) >= 1) AND (length(member_id) <= 80)))'),
  ('ar_collected_orders_status_check','CHECK ((length(status) <= 160))'),
  ('ar_collected_orders_raw_channel_check','CHECK ((length(raw_channel) <= 240))')
 ) v(name,definition) loop
  if not exists(select 1 from pg_constraint c where c.conrelid=target and c.conname=spec.name
   and c.contype='c' and c.convalidated and c.conislocal and not c.connoinherit
   and pg_get_constraintdef(c.oid,false)=spec.definition) then
   raise exception 'AR91_COVER_WIDTH_CONSTRAINT_DRIFT';end if;
 end loop;
 if not exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
  where c.conrelid=target and c.conname='ar_collected_orders_pkey' and c.contype='p'
   and c.convalidated and not c.condeferrable and not c.condeferred
   and i.indisunique and i.indisprimary and i.indisvalid and i.indisready and i.indislive
   and i.indimmediate and i.indpred is null and i.indexprs is null
   and pg_get_constraintdef(c.oid,false)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)') then
  raise exception 'AR91_COVER_NATIVE_PK_DRIFT';end if;
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or md5(p.prosrc) <>'325c95878225f211b91aed89c7abae86'
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prorettype<>'jsonb'::regtype
  or p.provolatile<>'s' or not p.prosecdef or p.proparallel<>'u' or p.lanname<>'plpgsql'
  or p.pronargdefaults<>0 or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off']
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then
  raise exception 'AR91_COVER_READER_BASELINE_DRIFT';end if;
 select f.*,l.lanname into m from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)');
 if not found or md5(m.prosrc)<>'dc8b95205e35b7366f4f9dbf052d307d'
  or pg_get_userbyid(m.proowner)<>'postgres' or m.prorettype<>'numeric'::regtype
  or m.provolatile<>'i' or m.prosecdef or m.proparallel<>'s' or m.lanname<>'sql'
  or m.pronargdefaults<>0 or m.proconfig is distinct from array['search_path=""']
  or m.proacl::text is distinct from '{postgres=X/postgres}' then
  raise exception 'AR91_COVER_MONEY_HELPER_DRIFT';end if;
 for spec in select * from (values
  ('ar_91club_recharge_applied_cover_idx',7,
   array['applied_at','order_no','member_id','status','raw_channel','member_level','recharge_count']::text[],
   $pred$((source_system = 'AR'::text) AND (country_code = 'IN'::text) AND (platform = '91CLUB'::text) AND (order_kind = 'recharge'::text))$pred$),
  ('ar_91club_recharge_paid_cover_idx',2,array['completed_at','member_id']::text[],
   $pred$((source_system = 'AR'::text) AND (country_code = 'IN'::text) AND (platform = '91CLUB'::text) AND (order_kind = 'recharge'::text) AND (status = '已支付'::text))$pred$)
 ) v(name,natts,columns,predicate) loop
  select i.*,cl.relkind,cl.relpersistence,cl.reloptions,cl.reltablespace,am.amname,
   pg_get_userbyid(cl.relowner) owner_name into idx
   from pg_class cl left join pg_index i on i.indexrelid=cl.oid left join pg_am am on am.oid=cl.relam
   where cl.oid=to_regclass('public.'||spec.name);
  if not found then
   if require_indexes then raise exception 'AR91_COVER_INDEX_MISSING';end if;
   continue;
  end if;
  if idx.indrelid is distinct from target or idx.relkind<>'i' or idx.relpersistence<>'p'
   or idx.owner_name<>'postgres' or idx.amname<>'btree' or idx.reloptions is not null or idx.reltablespace<>0
   or not idx.indisvalid or not idx.indisready or not idx.indislive or idx.indisunique
   or idx.indisprimary or idx.indisexclusion or idx.indisreplident or idx.indisclustered
   or idx.indnkeyatts<>1 or idx.indnatts<>spec.natts or idx.indexprs is not null
   or idx.indoption[0]<>0 or pg_get_expr(idx.indpred,idx.indrelid,false) is distinct from spec.predicate then
   raise exception 'AR91_COVER_INDEX_METADATA_DRIFT';end if;
  select array_agg(pg_get_indexdef(idx.indexrelid,pos,true) order by pos) into actual_columns
   from generate_series(1,spec.natts) pos;
  if actual_columns is distinct from spec.columns then raise exception 'AR91_COVER_INDEX_COLUMNS_DRIFT';end if;
  if not exists(select 1 from pg_opclass op join pg_namespace ns on ns.oid=op.opcnamespace
   join pg_attribute a on a.attrelid=target and a.attnum=idx.indkey[0]
   where op.oid=idx.indclass[0] and ns.nspname='pg_catalog' and op.opcname='timestamp_ops'
    and op.opcdefault and op.opcintype='timestamp without time zone'::regtype
    and idx.indcollation[0]=a.attcollation and a.attcollation=0) then
   raise exception 'AR91_COVER_INDEX_KEY_DRIFT';end if;
 end loop;
end;
$cover_guard$;

do $existing$
declare p record;c record;
begin
 if current_user<>'postgres' then raise exception 'ar91_submission_fact_actor_drift';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.sync_ar_91club_submission_fact()');
 if found and (pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.provolatile<>'v' or p.proparallel<>'u'
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.prorettype<>'trigger'::regtype
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  or md5(p.prosrc)<>'aa90b34447201e26aa7e0b6ca0e8528a') then raise exception 'ar91_submission_fact_existing_function_drift';end if;
 select * into c from pg_class where oid=to_regclass('private.ar_91club_submission_facts');
 if found and (c.relkind<>'r' or c.relpersistence<>'p' or pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
  or exists(select 1 from pg_policy where polrelid=c.oid)) then raise exception 'ar91_submission_fact_existing_table_drift';end if;
end;$existing$;
create table if not exists private.ar_91club_submission_facts(
 source_system text not null,
 country_code text not null,
 platform text not null,
 order_kind text not null,
 order_no text not null,
 applied_at timestamp without time zone,
 completed_at timestamp without time zone,
 member_id text,
 status text,
 raw_channel text,
 member_level integer,
 recharge_count integer,
 channel_type text,
 money_format_version smallint,
 amount_local numeric,
 currency_local text,
 money_issue_code text,
 amount numeric(20,2),
 primary key(source_system,country_code,platform,order_kind,order_no),
 foreign key(source_system,country_code,platform,order_kind,order_no) references public.ar_collected_orders(source_system,country_code,platform,order_kind,order_no) on delete cascade deferrable initially deferred,
 constraint ar91_submission_population_check check(source_system='AR' and country_code='IN' and platform='91CLUB' and order_kind='recharge'
  and (applied_at>=timestamp '2026-10-10' or applied_at is null or(status='已支付' and completed_at>=timestamp '2026-10-10')) is true)
) with(fillfactor=90,autovacuum_vacuum_scale_factor=0.02,autovacuum_vacuum_threshold=1000,
 autovacuum_analyze_scale_factor=0.02,autovacuum_analyze_threshold=1000);
alter table private.ar_91club_submission_facts owner to postgres;
alter table private.ar_91club_submission_facts enable row level security;
revoke all on private.ar_91club_submission_facts from public,anon,authenticated,service_role;
create index if not exists ar91_submission_facts_applied_cover_idx on private.ar_91club_submission_facts(applied_at)
 include(order_no,member_id,status,raw_channel,member_level,recharge_count);
create index if not exists ar91_submission_facts_paid_cover_idx on private.ar_91club_submission_facts(completed_at) include(member_id) where status='已支付';
create or replace function private.sync_ar_91club_submission_fact() returns trigger
language plpgsql volatile security definer set search_path='' as $trigger$
begin
 if TG_RELID<>'public.ar_collected_orders'::regclass or TG_WHEN<>'AFTER' or TG_LEVEL<>'ROW' or TG_OP not in('INSERT','UPDATE','DELETE') then
  raise exception 'ar91_submission_fact_trigger_context_invalid';end if;
 if TG_OP='DELETE' then
  delete from private.ar_91club_submission_facts where (source_system,country_code,platform,order_kind,order_no)=(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no);
  return OLD;
 end if;
 if TG_OP='UPDATE' then
  -- Observation/raw-payload churn alone does not dirty the narrow business heap.
  -- Numeric text comparison preserves source scale used by SUM(... )::text.
  if row(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no,OLD.applied_at,OLD.completed_at,OLD.member_id,OLD.status,OLD.raw_channel,OLD.member_level,OLD.recharge_count,OLD.channel_type,OLD.money_format_version,OLD.amount_local::text,OLD.currency_local,OLD.money_issue_code,OLD.amount::text) is not distinct from row(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.order_no,NEW.applied_at,NEW.completed_at,NEW.member_id,NEW.status,NEW.raw_channel,NEW.member_level,NEW.recharge_count,NEW.channel_type,NEW.money_format_version,NEW.amount_local::text,NEW.currency_local,NEW.money_issue_code,NEW.amount::text) then return NEW;end if;
  if row(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no) is distinct from row(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.order_no) then
   delete from private.ar_91club_submission_facts where (source_system,country_code,platform,order_kind,order_no)=(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no);
  end if;
 end if;
 if NEW.source_system='AR' and NEW.country_code='IN' and NEW.platform='91CLUB' and NEW.order_kind='recharge' and (NEW.applied_at>=timestamp '2026-10-10' or NEW.applied_at is null or (NEW.status='已支付' and NEW.completed_at>=timestamp '2026-10-10')) then
  insert into private.ar_91club_submission_facts as current_fact(source_system,country_code,platform,order_kind,order_no,applied_at,completed_at,member_id,status,raw_channel,member_level,recharge_count,channel_type,money_format_version,amount_local,currency_local,money_issue_code,amount)
  values(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.order_no,NEW.applied_at,NEW.completed_at,NEW.member_id,NEW.status,NEW.raw_channel,NEW.member_level,NEW.recharge_count,NEW.channel_type,NEW.money_format_version,NEW.amount_local,NEW.currency_local,NEW.money_issue_code,NEW.amount)
  on conflict(source_system,country_code,platform,order_kind,order_no) do update set
   applied_at=excluded.applied_at,
   completed_at=excluded.completed_at,
   member_id=excluded.member_id,
   status=excluded.status,
   raw_channel=excluded.raw_channel,
   member_level=excluded.member_level,
   recharge_count=excluded.recharge_count,
   channel_type=excluded.channel_type,
   money_format_version=excluded.money_format_version,
   amount_local=excluded.amount_local,
   currency_local=excluded.currency_local,
   money_issue_code=excluded.money_issue_code,
   amount=excluded.amount
  where row(current_fact.applied_at,current_fact.completed_at,current_fact.member_id,current_fact.status,current_fact.raw_channel,current_fact.member_level,current_fact.recharge_count,current_fact.channel_type,current_fact.money_format_version,current_fact.amount_local::text,current_fact.currency_local,current_fact.money_issue_code,current_fact.amount::text) is distinct from row(excluded.applied_at,excluded.completed_at,excluded.member_id,excluded.status,excluded.raw_channel,excluded.member_level,excluded.recharge_count,excluded.channel_type,excluded.money_format_version,excluded.amount_local::text,excluded.currency_local,excluded.money_issue_code,excluded.amount::text);
 else
  delete from private.ar_91club_submission_facts where (source_system,country_code,platform,order_kind,order_no)=(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.order_no);
 end if;
 return NEW;
end;
$trigger$;
alter function private.sync_ar_91club_submission_fact() owner to postgres;
revoke all on function private.sync_ar_91club_submission_fact() from public,anon,authenticated,service_role;
do $install_insert$
declare t record;
begin
 select * into t from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar91_submission_fact_sync_insert' and not tgisinternal;
 if found then
  if t.tgfoid<>'private.sync_ar_91club_submission_fact()'::regprocedure or t.tgtype<>5 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgattr::text<>''
   or pg_get_triggerdef(t.oid) is distinct from $expected_insert_qual$CREATE TRIGGER ar91_submission_fact_sync_insert AFTER INSERT ON public.ar_collected_orders FOR EACH ROW WHEN (((new.source_system = 'AR'::text) AND (new.country_code = 'IN'::text) AND (new.platform = '91CLUB'::text) AND (new.order_kind = 'recharge'::text) AND ((new.applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (new.applied_at IS NULL) OR ((new.status = '已支付'::text) AND (new.completed_at >= '2026-10-10 00:00:00'::timestamp without time zone))))) EXECUTE FUNCTION private.sync_ar_91club_submission_fact()$expected_insert_qual$ then
    raise exception 'ar91_submission_fact_trigger_drift';end if;
 else
  create trigger ar91_submission_fact_sync_insert after insert on public.ar_collected_orders for each row when(NEW.source_system='AR' and NEW.country_code='IN' and NEW.platform='91CLUB' and NEW.order_kind='recharge' and (NEW.applied_at>=timestamp '2026-10-10' or NEW.applied_at is null or (NEW.status='已支付' and NEW.completed_at>=timestamp '2026-10-10'))) execute function private.sync_ar_91club_submission_fact();
 end if;
end;$install_insert$;
do $install_update$
declare t record;
begin
 select * into t from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar91_submission_fact_sync_update' and not tgisinternal;
 if found then
  if t.tgfoid<>'private.sync_ar_91club_submission_fact()'::regprocedure or t.tgtype<>17 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgattr::text<>''
   or pg_get_triggerdef(t.oid) is distinct from $expected_update_qual$CREATE TRIGGER ar91_submission_fact_sync_update AFTER UPDATE ON public.ar_collected_orders FOR EACH ROW WHEN ((((old.source_system = 'AR'::text) AND (old.country_code = 'IN'::text) AND (old.platform = '91CLUB'::text) AND (old.order_kind = 'recharge'::text) AND ((old.applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (old.applied_at IS NULL) OR ((old.status = '已支付'::text) AND (old.completed_at >= '2026-10-10 00:00:00'::timestamp without time zone)))) OR ((new.source_system = 'AR'::text) AND (new.country_code = 'IN'::text) AND (new.platform = '91CLUB'::text) AND (new.order_kind = 'recharge'::text) AND ((new.applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (new.applied_at IS NULL) OR ((new.status = '已支付'::text) AND (new.completed_at >= '2026-10-10 00:00:00'::timestamp without time zone)))))) EXECUTE FUNCTION private.sync_ar_91club_submission_fact()$expected_update_qual$ then
    raise exception 'ar91_submission_fact_trigger_drift';end if;
 else
  create trigger ar91_submission_fact_sync_update after update on public.ar_collected_orders for each row when((OLD.source_system='AR' and OLD.country_code='IN' and OLD.platform='91CLUB' and OLD.order_kind='recharge' and (OLD.applied_at>=timestamp '2026-10-10' or OLD.applied_at is null or (OLD.status='已支付' and OLD.completed_at>=timestamp '2026-10-10'))) or (NEW.source_system='AR' and NEW.country_code='IN' and NEW.platform='91CLUB' and NEW.order_kind='recharge' and (NEW.applied_at>=timestamp '2026-10-10' or NEW.applied_at is null or (NEW.status='已支付' and NEW.completed_at>=timestamp '2026-10-10')))) execute function private.sync_ar_91club_submission_fact();
 end if;
end;$install_update$;
do $install_delete$
declare t record;
begin
 select * into t from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar91_submission_fact_sync_delete' and not tgisinternal;
 if found then
  if t.tgfoid<>'private.sync_ar_91club_submission_fact()'::regprocedure or t.tgtype<>9 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgattr::text<>''
   or pg_get_triggerdef(t.oid) is distinct from $expected_delete_qual$CREATE TRIGGER ar91_submission_fact_sync_delete AFTER DELETE ON public.ar_collected_orders FOR EACH ROW WHEN (((old.source_system = 'AR'::text) AND (old.country_code = 'IN'::text) AND (old.platform = '91CLUB'::text) AND (old.order_kind = 'recharge'::text) AND ((old.applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (old.applied_at IS NULL) OR ((old.status = '已支付'::text) AND (old.completed_at >= '2026-10-10 00:00:00'::timestamp without time zone))))) EXECUTE FUNCTION private.sync_ar_91club_submission_fact()$expected_delete_qual$ then
    raise exception 'ar91_submission_fact_trigger_drift';end if;
 else
  create trigger ar91_submission_fact_sync_delete after delete on public.ar_collected_orders for each row when(OLD.source_system='AR' and OLD.country_code='IN' and OLD.platform='91CLUB' and OLD.order_kind='recharge' and (OLD.applied_at>=timestamp '2026-10-10' or OLD.applied_at is null or (OLD.status='已支付' and OLD.completed_at>=timestamp '2026-10-10'))) execute function private.sync_ar_91club_submission_fact();
 end if;
end;$install_delete$;
do $objects$
declare c record;i record;
begin
 select * into c from pg_class where oid='private.ar_91club_submission_facts'::regclass;
 if pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity or c.relkind<>'r' or c.relpersistence<>'p'
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
  or exists(select 1 from pg_policy where polrelid=c.oid) then raise exception 'ar91_submission_fact_security_drift';end if;
 if (select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum)
  from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped) is distinct from $columns$[["source_system","text",true],["country_code","text",true],["platform","text",true],["order_kind","text",true],["order_no","text",true],["applied_at","timestamp without time zone",false],["completed_at","timestamp without time zone",false],["member_id","text",false],["status","text",false],["raw_channel","text",false],["member_level","integer",false],["recharge_count","integer",false],["channel_type","text",false],["money_format_version","smallint",false],["amount_local","numeric",false],["currency_local","text",false],["money_issue_code","text",false],["amount","numeric(20,2)",false]]$columns$::jsonb then raise exception 'ar91_submission_fact_columns_drift';end if;
 -- PG17 has no pg_constraint NOT NULL rows; nullability is checked above.
 if (select count(*) from pg_constraint where conrelid=c.oid and contype<>'n')<>3
  or not exists(select 1 from pg_constraint where conrelid=c.oid and contype='p' and convalidated and not condeferrable
   and pg_get_constraintdef(oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
  or not exists(select 1 from pg_constraint where conrelid=c.oid and contype='f' and confrelid='public.ar_collected_orders'::regclass
   and convalidated and condeferrable and condeferred and confdeltype='c' and confupdtype='a' and confmatchtype='s'
   and conkey=array[1,2,3,4,5]::smallint[] and (select array_agg(a.attname::text order by k.n) from unnest(confkey) with ordinality k(attnum,n)
    join pg_attribute a on a.attrelid=confrelid and a.attnum=k.attnum) = array['source_system','country_code','platform','order_kind','order_no']::text[])
  or not exists(select 1 from pg_constraint where conrelid=c.oid and conname='ar91_submission_population_check' and contype='c' and convalidated and not connoinherit
   and pg_get_constraintdef(oid)=$check$CHECK (((source_system = 'AR'::text) AND (country_code = 'IN'::text) AND (platform = '91CLUB'::text) AND (order_kind = 'recharge'::text) AND (((applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (applied_at IS NULL) OR ((status = '已支付'::text) AND (completed_at >= '2026-10-10 00:00:00'::timestamp without time zone))) IS TRUE)))$check$) then raise exception 'ar91_submission_fact_constraints_drift';end if;
 for i in select * from (values
  ('ar91_submission_facts_applied_cover_idx',$applied$CREATE INDEX ar91_submission_facts_applied_cover_idx ON private.ar_91club_submission_facts USING btree (applied_at) INCLUDE (order_no, member_id, status, raw_channel, member_level, recharge_count)$applied$),
  ('ar91_submission_facts_paid_cover_idx',$paid$CREATE INDEX ar91_submission_facts_paid_cover_idx ON private.ar_91club_submission_facts USING btree (completed_at) INCLUDE (member_id) WHERE (status = '已支付'::text)$paid$)
 )v(name,definition) loop
  if not exists(select 1 from pg_index x join pg_class r on r.oid=x.indexrelid where r.oid=to_regclass('private.'||i.name)
   and x.indrelid=c.oid and r.relowner=c.relowner and r.relkind='i' and r.relpersistence='p' and r.reloptions is null
   and x.indisvalid and x.indisready and x.indislive and not x.indisunique and not x.indisexclusion and not x.indisreplident
   and pg_get_indexdef(x.indexrelid)=i.definition) then raise exception 'ar91_submission_fact_index_drift';end if;
 end loop;
 if not exists(select 1 from pg_proc where oid='private.sync_ar_91club_submission_fact()'::regprocedure
  and md5(prosrc)='aa90b34447201e26aa7e0b6ca0e8528a' and proowner='postgres'::regrole and prosecdef and provolatile='v' and proparallel='u'
  and proconfig=array['search_path=""']::text[] and proacl::text='{postgres=X/postgres}') then raise exception 'ar91_submission_fact_function_drift';end if;
end;$objects$;
commit;
