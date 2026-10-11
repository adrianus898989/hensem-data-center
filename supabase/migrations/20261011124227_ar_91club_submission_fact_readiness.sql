-- OFFLINE GUARDED INSTALL; no source scan/backfill, no readiness approval, no reader switch.
begin;set local lock_timeout='2s';set local statement_timeout='20s';
lock table public.ar_collected_orders in share update exclusive mode nowait;
lock table private.ar_91club_submission_facts in share update exclusive mode nowait;
do $before$
declare spec record;f record;t record;
begin
 if current_user<>'postgres' or not exists(select 1 from pg_proc where oid='private.sync_ar_91club_submission_fact()'::regprocedure and md5(prosrc)='aa90b34447201e26aa7e0b6ca0e8528a' and proowner='postgres'::regrole and prosecdef and provolatile='v' and proparallel='u' and proconfig=array['search_path=""']::text[] and proacl::text='{postgres=X/postgres}')then raise exception 'ar91_ready_stage1_prerequisite_drift';end if;
for spec in select * from(values
 ('private.invalidate_ar_91club_submission_ready()','baf3365b826f76927f45b525f18ea080',true,'v','plpgsql','trigger',0,'[]'::jsonb),
 ('private.ar_91club_submission_generation()','acd188a5da0cb2f63381bd5922e3a1cf',false,'s','sql','text',0,'[]'::jsonb),
 ('private.approve_ar_91club_submission_day(date)','fe4f8523bc19a8e54086e3aa214aa56f',false,'v','plpgsql','jsonb',0,'["p_day"]'::jsonb),
 ('private.approve_ar_91club_submission_null()','63c7b2d1c8dccf8ea454e628c6150514',false,'v','plpgsql','jsonb',0,'[]'::jsonb),
 ('private.approve_ar_91club_submission_future()','7847142a3b5d3f30564950f61f9118da',false,'v','plpgsql','jsonb',0,'[]'::jsonb),
 ('private.ar_91club_submission_can_read(date,date)','7252e3966d916239a3ce212ba91dc763',false,'s','plpgsql','boolean',0,'["p_from","p_to"]'::jsonb),
 ('private.backfill_ar_91club_submission(text,date,integer)','1760737c9a2132d5b21a126a28048f1f',false,'v','plpgsql','bigint',1,'["p_stream","p_day","p_limit"]'::jsonb)
 )v(signature,hash,definer,volatility,language,return_type,defaults,argnames)loop
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
 if found then
  if md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef<>spec.definer or f.provolatile<>spec.volatility::"char" or f.proparallel<>'u' or f.lanname<>spec.language or f.prorettype<>spec.return_type::regtype or f.proretset or f.proisstrict or f.proleakproof or f.pronargdefaults<>spec.defaults or f.proconfig is distinct from array['search_path=""']::text[] or f.proacl::text is distinct from '{postgres=X/postgres}' or coalesce(to_jsonb(f.proargnames),'[]'::jsonb)<>spec.argnames then raise exception 'ar91_ready_function_metadata_drift';end if;
 elsif false then raise exception 'ar91_ready_function_missing';end if;
 end loop;
 for t in select c.* from pg_class c where c.oid=any(array[to_regclass('private.ar_91club_submission_epoch'),to_regclass('private.ar_91club_submission_ready'),to_regclass('private.ar_91club_submission_null_ready'),to_regclass('private.ar_91club_submission_future_ready')])loop
  if t.relowner<>'postgres'::regrole or t.relkind<>'r' or t.relpersistence<>'p' or not t.relrowsecurity or t.relforcerowsecurity or exists(select 1 from aclexplode(coalesce(t.relacl,acldefault('r',t.relowner)))a where a.grantee<>t.relowner)or exists(select 1 from pg_policy where polrelid=t.oid)then raise exception 'ar91_ready_existing_controls_security_drift';end if;
 end loop;
end;$before$;
do $install$
begin
 if to_regprocedure('private.ar_91club_submission_generation()')is null then
 execute $ddl$-- OFFLINE stage2 draft; stage1 required. No reader switch and no approval/backfill on install.
-- Per-native-local-day dual range proof plus independent ALL-history NULL-time proof.
create table if not exists private.ar_91club_submission_epoch(singleton boolean primary key check(singleton),epoch bigint not null check(epoch>=0));
create table if not exists private.ar_91club_submission_ready(data_date date primary key check(isfinite(data_date) and data_date>=date '2026-10-10'),generation text not null check(length(generation)=32),source_count bigint not null check(source_count>=0),validated_at timestamptz not null);
create table if not exists private.ar_91club_submission_null_ready(singleton boolean primary key check(singleton),generation text not null check(length(generation)=32),source_count bigint not null check(source_count>=0),validated_at timestamptz not null);
create table if not exists private.ar_91club_submission_future_ready(singleton boolean primary key check(singleton),future_from date not null check(isfinite(future_from) and future_from>=date '2026-10-10'),generation text not null check(length(generation)=32),validated_at timestamptz not null);
insert into private.ar_91club_submission_epoch values(true,0)on conflict(singleton)do nothing;
alter table private.ar_91club_submission_epoch enable row level security;
alter table private.ar_91club_submission_ready enable row level security;
alter table private.ar_91club_submission_null_ready enable row level security;
alter table private.ar_91club_submission_future_ready enable row level security;
revoke all on private.ar_91club_submission_epoch,private.ar_91club_submission_ready,private.ar_91club_submission_null_ready,private.ar_91club_submission_future_ready from public,anon,authenticated,service_role;
create or replace function private.invalidate_ar_91club_submission_ready() returns trigger language plpgsql volatile security definer set search_path='' as $control$
begin
 if TG_RELID<>'private.ar_91club_submission_facts'::regclass or TG_WHEN<>'AFTER' or TG_LEVEL<>'STATEMENT' or TG_OP not in('INSERT','UPDATE','DELETE','TRUNCATE') then raise exception 'ar91_ready_control_context_invalid';end if;
 -- Source trigger / source FK cascade changes facts atomically. Only direct
 -- owner maintenance revokes approvals, including a write before approval.
 if pg_trigger_depth()>1 then return null;end if;
 if TG_OP in('INSERT','UPDATE')then
  if not exists(select 1 from newfacts)then return null;end if;
 elsif TG_OP='DELETE'then
  if not exists(select 1 from oldfacts)then return null;end if;
  -- RI cascades can dispatch an AFTER STATEMENT trigger after the outer
  -- trigger stack unwinds. Removed parent keys prove these are atomic source
  -- deletes (or removal of impossible orphans), not loss of live source rows.
  if not exists(select 1 from oldfacts o join public.ar_collected_orders a using(source_system,country_code,platform,order_kind,order_no))then return null;end if;
 end if;
 update private.ar_91club_submission_epoch set epoch=epoch+1 where singleton;
 delete from private.ar_91club_submission_ready;
 delete from private.ar_91club_submission_null_ready;
 delete from private.ar_91club_submission_future_ready;
 return null;
end;
$control$;
revoke all on function private.invalidate_ar_91club_submission_ready() from public,anon,authenticated,service_role;
create trigger ar91_submission_ready_insert after insert on private.ar_91club_submission_facts referencing new table as newfacts for each statement execute function private.invalidate_ar_91club_submission_ready();
create trigger ar91_submission_ready_update after update on private.ar_91club_submission_facts referencing old table as oldfacts new table as newfacts for each statement execute function private.invalidate_ar_91club_submission_ready();
create trigger ar91_submission_ready_delete after delete on private.ar_91club_submission_facts referencing old table as oldfacts for each statement execute function private.invalidate_ar_91club_submission_ready();
create trigger ar91_submission_ready_truncate after truncate on private.ar_91club_submission_facts for each statement execute function private.invalidate_ar_91club_submission_ready();
create or replace function private.ar_91club_submission_generation() returns text language sql stable security invoker set search_path='' as $generation$
 with funcs as materialized(select p.*,p.xmin from pg_catalog.pg_proc p where p.oid in('private.sync_ar_91club_submission_fact()'::regprocedure,'private.invalidate_ar_91club_submission_ready()'::regprocedure)),
 source_triggers as materialized(select t.oid,t.xmin::text epoch,pg_get_triggerdef(t.oid) definition from pg_catalog.pg_trigger t
 where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal and t.tgenabled='O' and t.tgfoid='private.sync_ar_91club_submission_fact()'::regprocedure and ((t.tgname='ar91_submission_fact_sync_delete' and pg_get_triggerdef(t.oid)=$tdelete$CREATE TRIGGER ar91_submission_fact_sync_delete AFTER DELETE ON public.ar_collected_orders FOR EACH ROW WHEN (((old.source_system = 'AR'::text) AND (old.country_code = 'IN'::text) AND (old.platform = '91CLUB'::text) AND (old.order_kind = 'recharge'::text) AND ((old.applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (old.applied_at IS NULL) OR ((old.status = '已支付'::text) AND (old.completed_at >= '2026-10-10 00:00:00'::timestamp without time zone))))) EXECUTE FUNCTION private.sync_ar_91club_submission_fact()$tdelete$) or (t.tgname='ar91_submission_fact_sync_insert' and pg_get_triggerdef(t.oid)=$tinsert$CREATE TRIGGER ar91_submission_fact_sync_insert AFTER INSERT ON public.ar_collected_orders FOR EACH ROW WHEN (((new.source_system = 'AR'::text) AND (new.country_code = 'IN'::text) AND (new.platform = '91CLUB'::text) AND (new.order_kind = 'recharge'::text) AND ((new.applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (new.applied_at IS NULL) OR ((new.status = '已支付'::text) AND (new.completed_at >= '2026-10-10 00:00:00'::timestamp without time zone))))) EXECUTE FUNCTION private.sync_ar_91club_submission_fact()$tinsert$) or (t.tgname='ar91_submission_fact_sync_update' and pg_get_triggerdef(t.oid)=$tupdate$CREATE TRIGGER ar91_submission_fact_sync_update AFTER UPDATE ON public.ar_collected_orders FOR EACH ROW WHEN ((((old.source_system = 'AR'::text) AND (old.country_code = 'IN'::text) AND (old.platform = '91CLUB'::text) AND (old.order_kind = 'recharge'::text) AND ((old.applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (old.applied_at IS NULL) OR ((old.status = '已支付'::text) AND (old.completed_at >= '2026-10-10 00:00:00'::timestamp without time zone)))) OR ((new.source_system = 'AR'::text) AND (new.country_code = 'IN'::text) AND (new.platform = '91CLUB'::text) AND (new.order_kind = 'recharge'::text) AND ((new.applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (new.applied_at IS NULL) OR ((new.status = '已支付'::text) AND (new.completed_at >= '2026-10-10 00:00:00'::timestamp without time zone)))))) EXECUTE FUNCTION private.sync_ar_91club_submission_fact()$tupdate$))),
 controls as materialized(select t.oid,t.xmin::text epoch,pg_get_triggerdef(t.oid) definition from pg_catalog.pg_trigger t where t.tgrelid='private.ar_91club_submission_facts'::regclass and not t.tgisinternal and t.tgenabled='O' and t.tgfoid='private.invalidate_ar_91club_submission_ready()'::regprocedure and t.tgnargs=0 and t.tgattr::text='' and t.tgqual is null and ((t.tgname='ar91_submission_ready_insert'and t.tgtype=4 and t.tgoldtable is null and t.tgnewtable='newfacts')or(t.tgname='ar91_submission_ready_update'and t.tgtype=16 and t.tgoldtable='oldfacts'and t.tgnewtable='newfacts')or(t.tgname='ar91_submission_ready_delete'and t.tgtype=8 and t.tgoldtable='oldfacts'and t.tgnewtable is null)or(t.tgname='ar91_submission_ready_truncate'and t.tgtype=32 and t.tgoldtable is null and t.tgnewtable is null))),
 guard as materialized(select (select count(*) from funcs)=2 and (select count(*) from source_triggers)=3 and (select count(*) from controls)=4 and(select count(*)from pg_trigger where tgrelid='private.ar_91club_submission_facts'::regclass and not tgisinternal)=4 and not exists(select 1 from pg_trigger where tgrelid in('private.ar_91club_submission_epoch'::regclass,'private.ar_91club_submission_ready'::regclass,'private.ar_91club_submission_null_ready'::regclass,'private.ar_91club_submission_future_ready'::regclass)and not tgisinternal)
 and not exists(select 1 from funcs p where p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'v' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' or md5(p.prosrc)<>case when p.proname='sync_ar_91club_submission_fact' then 'aa90b34447201e26aa7e0b6ca0e8528a' else 'baf3365b826f76927f45b525f18ea080' end)
 and (select count(*) from private.ar_91club_submission_epoch)=1
 and not exists(select 1 from pg_catalog.pg_class c where c.oid in('private.ar_91club_submission_facts'::regclass,'private.ar_91club_submission_epoch'::regclass,'private.ar_91club_submission_ready'::regclass,'private.ar_91club_submission_null_ready'::regclass,'private.ar_91club_submission_future_ready'::regclass) and (c.relowner<>'postgres'::regrole or c.relkind<>'r' or c.relpersistence<>'p' or not c.relrowsecurity or c.relforcerowsecurity or exists(select 1 from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner)))a where a.grantee<>c.relowner) or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=c.oid)))
 and (select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) from pg_attribute where attrelid='private.ar_91club_submission_facts'::regclass and attnum>0 and not attisdropped)='[["source_system","text",true],["country_code","text",true],["platform","text",true],["order_kind","text",true],["order_no","text",true],["applied_at","timestamp without time zone",false],["completed_at","timestamp without time zone",false],["member_id","text",false],["status","text",false],["raw_channel","text",false],["member_level","integer",false],["recharge_count","integer",false],["channel_type","text",false],["money_format_version","smallint",false],["amount_local","numeric",false],["currency_local","text",false],["money_issue_code","text",false],["amount","numeric(20,2)",false]]'::jsonb
 and not exists(select 1 from pg_attribute where attrelid='private.ar_91club_submission_facts'::regclass and attnum>0 and not attisdropped and (atthasdef or attgenerated<>'' or attidentity<>''))
 and (select count(*) from pg_constraint where conrelid='private.ar_91club_submission_facts'::regclass and contype<>'n')=3
 and exists(select 1 from pg_constraint where conrelid='private.ar_91club_submission_facts'::regclass and conname='ar91_submission_population_check' and convalidated and pg_get_constraintdef(oid)=$check$CHECK (((source_system = 'AR'::text) AND (country_code = 'IN'::text) AND (platform = '91CLUB'::text) AND (order_kind = 'recharge'::text) AND (((applied_at >= '2026-10-10 00:00:00'::timestamp without time zone) OR (applied_at IS NULL) OR ((status = '已支付'::text) AND (completed_at >= '2026-10-10 00:00:00'::timestamp without time zone))) IS TRUE)))$check$)
 and exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid where c.conrelid='private.ar_91club_submission_facts'::regclass and c.contype='p' and c.convalidated and not c.condeferrable and i.indimmediate and i.indisvalid and i.indisready and i.indislive and pg_get_constraintdef(c.oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
 and exists(select 1 from pg_constraint c where c.conrelid='private.ar_91club_submission_facts'::regclass and c.contype='f' and c.confrelid='public.ar_collected_orders'::regclass and c.convalidated and c.condeferrable and c.condeferred and c.confdeltype='c' and c.confupdtype='a' and c.conkey=array[1,2,3,4,5]::smallint[])

 and exists(select 1 from pg_class c where c.oid='public.ar_collected_orders'::regclass and c.relowner='postgres'::regrole and c.relkind='r' and c.relpersistence='p' and c.relrowsecurity and not c.relforcerowsecurity and c.relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}' and not exists(select 1 from pg_inherits where inhparent=c.oid or inhrelid=c.oid))
 and (select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull)order by array_position(array['source_system','country_code','platform','order_kind','order_no','applied_at','completed_at','member_id','status','raw_channel','member_level','recharge_count','channel_type','money_format_version','amount_local','currency_local','money_issue_code','amount']::text[],attname))from pg_attribute where attrelid='public.ar_collected_orders'::regclass and attnum>0 and not attisdropped and attname=any(array['source_system','country_code','platform','order_kind','order_no','applied_at','completed_at','member_id','status','raw_channel','member_level','recharge_count','channel_type','money_format_version','amount_local','currency_local','money_issue_code','amount']::text[]))='[["source_system","text",true],["country_code","text",true],["platform","text",true],["order_kind","text",true],["order_no","text",true],["applied_at","timestamp without time zone",false],["completed_at","timestamp without time zone",false],["member_id","text",false],["status","text",false],["raw_channel","text",false],["member_level","integer",false],["recharge_count","integer",false],["channel_type","text",false],["money_format_version","smallint",false],["amount_local","numeric",false],["currency_local","text",false],["money_issue_code","text",false],["amount","numeric(20,2)",false]]'::jsonb
 and not exists(select 1 from pg_attribute where attrelid='public.ar_collected_orders'::regclass and attnum>0 and not attisdropped and attname=any(array['source_system','country_code','platform','order_kind','order_no','applied_at','completed_at','member_id','status','raw_channel','member_level','recharge_count','channel_type','money_format_version','amount_local','currency_local','money_issue_code','amount']::text[]) and(atthasdef or attgenerated<>'' or attidentity<>'' or attcollation<>case when atttypid='text'::regtype then 100 else 0 end))
 and exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid where c.conrelid='public.ar_collected_orders'::regclass and c.contype='p' and c.convalidated and not c.condeferrable and not c.condeferred and i.indimmediate and i.indisvalid and i.indisready and i.indislive and i.indisprimary and i.indisunique and i.indpred is null and i.indexprs is null and pg_get_constraintdef(c.oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
 and exists(select 1 from pg_constraint c where c.conrelid='private.ar_91club_submission_facts'::regclass and c.contype='f' and(select array_agg(a.attname::text order by k.n)from unnest(c.confkey)with ordinality k(attnum,n)join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)=array['source_system','country_code','platform','order_kind','order_no']::text[])
 and not exists(select 1 from pg_inherits where inhparent='private.ar_91club_submission_facts'::regclass or inhrelid='private.ar_91club_submission_facts'::regclass)
 and (select jsonb_object_agg(c.relname,jsonb_build_object('columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.atthasdef,a.attgenerated,a.attidentity,a.attcollation)order by a.attnum)from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(jsonb_build_array(x.conname,x.contype,pg_get_constraintdef(x.oid),x.convalidated,x.condeferrable,x.condeferred)order by x.conname)from pg_constraint x where x.conrelid=c.oid and x.contype<>'n'))) layout from pg_class c where c.oid in('private.ar_91club_submission_epoch'::regclass,'private.ar_91club_submission_ready'::regclass,'private.ar_91club_submission_null_ready'::regclass,'private.ar_91club_submission_future_ready'::regclass)) is not distinct from $layout${"ar_91club_submission_epoch":{"columns":[["singleton","boolean",true,false,"","","0"],["epoch","bigint",true,false,"","","0"]],"constraints":[["ar_91club_submission_epoch_epoch_check","c","CHECK ((epoch >= 0))",true,false,false],["ar_91club_submission_epoch_pkey","p","PRIMARY KEY (singleton)",true,false,false],["ar_91club_submission_epoch_singleton_check","c","CHECK (singleton)",true,false,false]]},"ar_91club_submission_ready":{"columns":[["data_date","date",true,false,"","","0"],["generation","text",true,false,"","","100"],["source_count","bigint",true,false,"","","0"],["validated_at","timestamp with time zone",true,false,"","","0"]],"constraints":[["ar_91club_submission_ready_data_date_check","c","CHECK ((isfinite(data_date) AND (data_date >= '2026-10-10'::date)))",true,false,false],["ar_91club_submission_ready_generation_check","c","CHECK ((length(generation) = 32))",true,false,false],["ar_91club_submission_ready_pkey","p","PRIMARY KEY (data_date)",true,false,false],["ar_91club_submission_ready_source_count_check","c","CHECK ((source_count >= 0))",true,false,false]]},"ar_91club_submission_null_ready":{"columns":[["singleton","boolean",true,false,"","","0"],["generation","text",true,false,"","","100"],["source_count","bigint",true,false,"","","0"],["validated_at","timestamp with time zone",true,false,"","","0"]],"constraints":[["ar_91club_submission_null_ready_generation_check","c","CHECK ((length(generation) = 32))",true,false,false],["ar_91club_submission_null_ready_pkey","p","PRIMARY KEY (singleton)",true,false,false],["ar_91club_submission_null_ready_singleton_check","c","CHECK (singleton)",true,false,false],["ar_91club_submission_null_ready_source_count_check","c","CHECK ((source_count >= 0))",true,false,false]]},"ar_91club_submission_future_ready":{"columns":[["singleton","boolean",true,false,"","","0"],["future_from","date",true,false,"","","0"],["generation","text",true,false,"","","100"],["validated_at","timestamp with time zone",true,false,"","","0"]],"constraints":[["ar_91club_submission_future_ready_future_from_check","c","CHECK ((isfinite(future_from) AND (future_from >= '2026-10-10'::date)))",true,false,false],["ar_91club_submission_future_ready_generation_check","c","CHECK ((length(generation) = 32))",true,false,false],["ar_91club_submission_future_ready_pkey","p","PRIMARY KEY (singleton)",true,false,false],["ar_91club_submission_future_ready_singleton_check","c","CHECK (singleton)",true,false,false]]}}$layout$::jsonb ok)
 select case when (select ok from guard) then md5(jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(oid,xmin::text,md5(prosrc),proowner,prosecdef,provolatile,proparallel,proconfig,proacl::text)order by oid)from funcs),'triggers',(select jsonb_agg(to_jsonb(t)order by oid)from(select * from source_triggers union all select * from controls)t),'maintenanceEpoch',(select epoch from private.ar_91club_submission_epoch where singleton))::text)end;
$generation$;
revoke all on function private.ar_91club_submission_generation() from public,anon,authenticated,service_role;
create or replace function private.approve_ar_91club_submission_day(p_day date)returns jsonb language plpgsql volatile security invoker set search_path='' as $approve_day$
declare v_generation text;v_count bigint;v_missing bigint;v_extra bigint;v_bad bigint;
begin
 if p_day is null or not isfinite(p_day) or p_day<date '2026-10-10' then raise exception 'ar91_ready_day_invalid';end if;
 if current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar91_ready_requires_repeatable_read';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_91club_submission_facts in share update exclusive mode nowait;
 -- A direct maintenance writer updates this row. FOR SHARE makes approval
 -- conflict with that write; it cannot resurrect proof from an older snapshot.
 perform 1 from private.ar_91club_submission_epoch where singleton for share;
 v_generation:=private.ar_91club_submission_generation();if v_generation is null then raise exception 'ar91_ready_generation_invalid';end if;

 with expected as materialized(select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform='91CLUB' and a.order_kind='recharge' and ((a.applied_at>=p_day::timestamp and a.applied_at<(p_day+1)::timestamp) or(a.status='已支付' and a.completed_at>=p_day::timestamp and a.completed_at<(p_day+1)::timestamp))),actual as materialized(select * from private.ar_91club_submission_facts f where ((f.applied_at>=p_day::timestamp and f.applied_at<(p_day+1)::timestamp) or(f.status='已支付' and f.completed_at>=p_day::timestamp and f.completed_at<(p_day+1)::timestamp)))
 select count(a.order_no),count(*)filter(where a.order_no is not null and f.order_no is null),count(*)filter(where a.order_no is null and f.order_no is not null),count(*)filter(where a.order_no is not null and f.order_no is not null and row(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local::text,a.currency_local,a.money_issue_code,a.amount::text) is distinct from row(f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local::text,f.currency_local,f.money_issue_code,f.amount::text))
 into v_count,v_missing,v_extra,v_bad from expected a full join actual f using(source_system,country_code,platform,order_kind,order_no);
 if v_missing<>0 or v_extra<>0 or v_bad<>0 then raise exception 'ar91_ready_parity_failed' using detail=format('missing=%s extra=%s changed=%s',v_missing,v_extra,v_bad);end if;
 insert into private.ar_91club_submission_ready values(p_day,v_generation,v_count,clock_timestamp())on conflict(data_date)do update set generation=excluded.generation,source_count=excluded.source_count,validated_at=excluded.validated_at;
 return jsonb_build_object('approved',true,'sourceCount',v_count,'generation',v_generation);
end;$approve_day$;
revoke all on function private.approve_ar_91club_submission_day(date)from public,anon,authenticated,service_role;
create or replace function private.approve_ar_91club_submission_null()returns jsonb language plpgsql volatile security invoker set search_path='' as $approve_null$
declare v_generation text;v_count bigint;v_missing bigint;v_extra bigint;v_bad bigint;
begin
 
 if current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar91_ready_requires_repeatable_read';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_91club_submission_facts in share update exclusive mode nowait;
 -- A direct maintenance writer updates this row. FOR SHARE makes approval
 -- conflict with that write; it cannot resurrect proof from an older snapshot.
 perform 1 from private.ar_91club_submission_epoch where singleton for share;
 v_generation:=private.ar_91club_submission_generation();if v_generation is null then raise exception 'ar91_ready_generation_invalid';end if;

 with expected as materialized(select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform='91CLUB' and a.order_kind='recharge' and a.applied_at is null),actual as materialized(select * from private.ar_91club_submission_facts f where f.applied_at is null)
 select count(a.order_no),count(*)filter(where a.order_no is not null and f.order_no is null),count(*)filter(where a.order_no is null and f.order_no is not null),count(*)filter(where a.order_no is not null and f.order_no is not null and row(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local::text,a.currency_local,a.money_issue_code,a.amount::text) is distinct from row(f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local::text,f.currency_local,f.money_issue_code,f.amount::text))
 into v_count,v_missing,v_extra,v_bad from expected a full join actual f using(source_system,country_code,platform,order_kind,order_no);
 if v_missing<>0 or v_extra<>0 or v_bad<>0 then raise exception 'ar91_ready_parity_failed' using detail=format('missing=%s extra=%s changed=%s',v_missing,v_extra,v_bad);end if;
 insert into private.ar_91club_submission_null_ready values(true,v_generation,v_count,clock_timestamp())on conflict(singleton)do update set generation=excluded.generation,source_count=excluded.source_count,validated_at=excluded.validated_at;
 return jsonb_build_object('approved',true,'sourceCount',v_count,'generation',v_generation);
end;$approve_null$;
revoke all on function private.approve_ar_91club_submission_null()from public,anon,authenticated,service_role;
create or replace function private.approve_ar_91club_submission_future()returns jsonb language plpgsql volatile security invoker set search_path='' as $future$
declare v_generation text;v_from date;v_applied timestamp;v_completed timestamp;
begin

 if current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar91_ready_requires_repeatable_read';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_91club_submission_facts in share update exclusive mode nowait;
 -- A direct maintenance writer updates this row. FOR SHARE makes approval
 -- conflict with that write; it cannot resurrect proof from an older snapshot.
 perform 1 from private.ar_91club_submission_epoch where singleton for share;
 v_generation:=private.ar_91club_submission_generation();if v_generation is null then raise exception 'ar91_ready_generation_invalid';end if;

 select a.applied_at into v_applied from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform='91CLUB' and a.order_kind='recharge' and a.applied_at>=timestamp '2026-10-10' and isfinite(a.applied_at)order by a.applied_at desc limit 1;
 select a.completed_at into v_completed from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform='91CLUB' and a.order_kind='recharge' and a.status='已支付' and a.completed_at>=timestamp '2026-10-10' and isfinite(a.completed_at)order by a.completed_at desc limit 1;
 v_from:=coalesce(greatest(v_applied,v_completed)::date+1,date '2026-10-10');
 if not isfinite(v_from) or exists(select 1 from private.ar_91club_submission_facts f where(isfinite(f.applied_at)and f.applied_at>=v_from::timestamp)or(f.status='已支付'and isfinite(f.completed_at)and f.completed_at>=v_from::timestamp))then raise exception 'ar91_ready_future_not_empty';end if;
 insert into private.ar_91club_submission_future_ready values(true,v_from,v_generation,clock_timestamp())on conflict(singleton)do update set future_from=excluded.future_from,generation=excluded.generation,validated_at=excluded.validated_at;
 return jsonb_build_object('approved',true,'futureFrom',v_from,'generation',v_generation);
end;$future$;
revoke all on function private.approve_ar_91club_submission_future()from public,anon,authenticated,service_role;
create or replace function private.ar_91club_submission_can_read(p_from date,p_to date)returns boolean language plpgsql stable security invoker set search_path='' as $can_read$
declare g text;
begin
 if p_from is null or p_to is null or not isfinite(p_from)or not isfinite(p_to)or p_from<date '2026-10-10'or p_to<=p_from or p_to-p_from>32 then return false;end if;
 g:=private.ar_91club_submission_generation();if g is null then return false;end if;
 if not exists(select 1 from private.ar_91club_submission_null_ready where singleton and generation=g)then return false;end if;
 return not exists(select 1 from generate_series(p_from::timestamp,(p_to-1)::timestamp,interval '1 day')d where not exists(select 1 from private.ar_91club_submission_ready r where r.data_date=d::date and r.generation=g)and not exists(select 1 from private.ar_91club_submission_future_ready r where r.singleton and d::date>=r.future_from and r.generation=g));
end;$can_read$;
revoke all on function private.ar_91club_submission_can_read(date,date)from public,anon,authenticated,service_role;
-- OFFLINE owner-only invocation; bounded missing-only source-locked batches.
create or replace function private.backfill_ar_91club_submission(p_stream text,p_day date,p_limit integer default 1000)returns bigint language plpgsql volatile security invoker set search_path='' as $backfill$
declare n bigint;
begin
 if p_stream not in('cohort','success','nulltime') or p_stream is null or p_limit is null or p_limit<1 or p_limit>3000 or (p_stream<>'nulltime'and(p_day is null or not isfinite(p_day)or p_day<date '2026-10-10'))then raise exception 'ar91_backfill_bounds_invalid';end if;
 if private.ar_91club_submission_generation()is null then raise exception 'ar91_ready_generation_invalid';end if;
 with source as materialized(select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform='91CLUB' and a.order_kind='recharge' and case p_stream when 'cohort' then a.applied_at>=p_day::timestamp and a.applied_at<(p_day+1)::timestamp when 'success' then a.status='已支付'and a.completed_at>=p_day::timestamp and a.completed_at<(p_day+1)::timestamp else a.applied_at is null end
 and not exists(select 1 from private.ar_91club_submission_facts f where(f.source_system,f.country_code,f.platform,f.order_kind,f.order_no)=(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no))
 limit p_limit for share of a skip locked),written as(insert into private.ar_91club_submission_facts(source_system,country_code,platform,order_kind,order_no,applied_at,completed_at,member_id,status,raw_channel,member_level,recharge_count,channel_type,money_format_version,amount_local,currency_local,money_issue_code,amount)select * from source on conflict(source_system,country_code,platform,order_kind,order_no)do nothing returning 1)select count(*)into n from written;
 return n;
end;$backfill$;
revoke all on function private.backfill_ar_91club_submission(text,date,integer)from public,anon,authenticated,service_role;
$ddl$;
 end if;
end;$install$;
do $after$
declare spec record;f record;
begin
for spec in select * from(values
 ('private.invalidate_ar_91club_submission_ready()','baf3365b826f76927f45b525f18ea080',true,'v','plpgsql','trigger',0,'[]'::jsonb),
 ('private.ar_91club_submission_generation()','acd188a5da0cb2f63381bd5922e3a1cf',false,'s','sql','text',0,'[]'::jsonb),
 ('private.approve_ar_91club_submission_day(date)','fe4f8523bc19a8e54086e3aa214aa56f',false,'v','plpgsql','jsonb',0,'["p_day"]'::jsonb),
 ('private.approve_ar_91club_submission_null()','63c7b2d1c8dccf8ea454e628c6150514',false,'v','plpgsql','jsonb',0,'[]'::jsonb),
 ('private.approve_ar_91club_submission_future()','7847142a3b5d3f30564950f61f9118da',false,'v','plpgsql','jsonb',0,'[]'::jsonb),
 ('private.ar_91club_submission_can_read(date,date)','7252e3966d916239a3ce212ba91dc763',false,'s','plpgsql','boolean',0,'["p_from","p_to"]'::jsonb),
 ('private.backfill_ar_91club_submission(text,date,integer)','1760737c9a2132d5b21a126a28048f1f',false,'v','plpgsql','bigint',1,'["p_stream","p_day","p_limit"]'::jsonb)
 )v(signature,hash,definer,volatility,language,return_type,defaults,argnames)loop
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
 if found then
  if md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef<>spec.definer or f.provolatile<>spec.volatility::"char" or f.proparallel<>'u' or f.lanname<>spec.language or f.prorettype<>spec.return_type::regtype or f.proretset or f.proisstrict or f.proleakproof or f.pronargdefaults<>spec.defaults or f.proconfig is distinct from array['search_path=""']::text[] or f.proacl::text is distinct from '{postgres=X/postgres}' or coalesce(to_jsonb(f.proargnames),'[]'::jsonb)<>spec.argnames then raise exception 'ar91_ready_function_metadata_drift';end if;
 elsif true then raise exception 'ar91_ready_function_missing';end if;
 end loop;
 if private.ar_91club_submission_generation()is null then raise exception 'ar91_ready_object_layout_drift';end if;
end;$after$;
commit;
