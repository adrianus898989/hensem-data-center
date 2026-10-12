-- Scoped MAANWIN charge facts, beginning local 2026-10-10. No native data scan,
-- backfill, approval or reader cutover. Replay verifies; unknown objects abort.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';set local timezone='UTC';set local search_path='';
do $install$
declare native_ok boolean;existing integer;before_triggers jsonb;after_triggers jsonb;
begin
 if current_user<>'postgres'then raise exception'maan_submission_install_owner_only';end if;
 lock table public.newar_detail_records in access share mode nowait;
 select (exists(select 1 from pg_class c where c.oid='public.newar_detail_records'::regclass and c.relowner='postgres'::regrole and c.relkind='r'and c.relpersistence='p'and c.relrowsecurity and not c.relforcerowsecurity
   and c.relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'and not exists(select 1 from pg_policy where polrelid=c.oid)
   and not exists(select 1 from pg_inherits where inhparent=c.oid or inhrelid=c.oid))
  and(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attcollation::text)order by array_position(array['id','platform','dataset','source_id','order_number','member_id','provider','channel_type','currency','amount','status_group','created_at','success_at','raw']::text[],a.attname))from pg_attribute a
   where a.attrelid='public.newar_detail_records'::regclass and a.attnum>0 and not a.attisdropped and a.attname=any(array['id','platform','dataset','source_id','order_number','member_id','provider','channel_type','currency','amount','status_group','created_at','success_at','raw']))is not distinct from '[["id","uuid",true,"","","0"],["platform","text",true,"","","100"],["dataset","text",true,"","","100"],["source_id","text",true,"","","100"],["order_number","text",false,"","","100"],["member_id","text",false,"","","100"],["provider","text",false,"","","100"],["channel_type","text",false,"","","100"],["currency","text",false,"","","100"],["amount","numeric(24,8)",true,"","","0"],["status_group","text",true,"","","100"],["created_at","timestamp with time zone",true,"","","0"],["success_at","timestamp with time zone",false,"","","0"],["raw","jsonb",true,"","","0"]]'::jsonb
  and not exists(select 1 from pg_attribute where attrelid='public.newar_detail_records'::regclass and attname=any(array['recharge_level','recharge_count'])and not attisdropped)
  and exists(select 1 from pg_constraint k join pg_index i on i.indexrelid=k.conindid where k.conrelid='public.newar_detail_records'::regclass and k.contype='p'and k.convalidated and not k.condeferrable and not k.condeferred
   and i.indisvalid and i.indisready and i.indislive and i.indimmediate and i.indisunique and i.indisprimary and i.indpred is null and i.indexprs is null and pg_get_constraintdef(k.oid)='PRIMARY KEY (id)')
  and exists(select 1 from pg_constraint k join pg_index i on i.indexrelid=k.conindid where k.conrelid='public.newar_detail_records'::regclass and k.contype='u'and k.convalidated and not k.condeferrable and not k.condeferred
   and i.indisvalid and i.indisready and i.indislive and i.indimmediate and pg_get_constraintdef(k.oid)='UNIQUE (platform, dataset, source_id)'))into native_ok;
 if native_ok is distinct from true then raise exception'maan_submission_native_contract_drift';end if;
 select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled,md5(p.prosrc))order by t.tgname)into before_triggers
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.newar_detail_records'::regclass and not t.tgisinternal and t.tgname not like '0_maan_submission_sync_%';
 select count(*)into existing from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and c.relname=any(array['maan_submission_facts','maan_submission_epoch','maan_submission_ready','maan_submission_future_ready']);
 if existing=0 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and p.proname=any(array['maan_submission_fact','sync_maan_submission_fact','invalidate_maan_submission_ready','guard_maan_submission_control_write','maan_submission_generation','backfill_maan_submission_window','check_maan_submission_window','maintain_maan_submission_window']))
 and not exists(select 1 from pg_trigger where tgrelid='public.newar_detail_records'::regclass and tgname like '0_maan_submission_sync_%')then
 execute $objects$create table private.maan_submission_facts(
 record_id uuid primary key references public.newar_detail_records(id)on delete cascade deferrable initially deferred,
 platform text not null,dataset text not null,source_id text not null,order_id text not null,
 member_id text,created_at timestamptz not null,success_at timestamptz,
 amount numeric(24,8)not null,currency text,raw_provider text not null,
 paid boolean not null,status_known boolean not null,member_level integer,recharge_count integer,
 constraint maan_submission_population_check check(platform='MAANWIN'and dataset='charge'
  and(created_at>=timestamptz'2026-10-09 18:30:00Z' or(paid and success_at>=timestamptz'2026-10-09 18:30:00Z'))is true),
 constraint maan_submission_level_check check(member_level between 0 and 9999),
 constraint maan_submission_count_check check(recharge_count between 0 and 999999999)
)with(fillfactor=90,autovacuum_vacuum_scale_factor=0.02,autovacuum_vacuum_threshold=1000,
 autovacuum_analyze_scale_factor=0.02,autovacuum_analyze_threshold=1000);
create index maan_submission_created_idx on private.maan_submission_facts(created_at);
create index maan_submission_success_idx on private.maan_submission_facts(success_at)where paid;
create table private.maan_submission_epoch(singleton boolean primary key check(singleton),epoch bigint not null check(epoch>=0));
insert into private.maan_submission_epoch values(true,0);
create table private.maan_submission_ready(data_date date primary key check(isfinite(data_date)and data_date>=date'2026-10-10'),
 generation text not null check(length(generation)=32),source_count bigint not null check(source_count>=0),validated_at timestamptz not null);
create table private.maan_submission_future_ready(singleton boolean primary key check(singleton),
 future_from date not null check(isfinite(future_from)and future_from>=date'2026-10-10'),generation text not null check(length(generation)=32),validated_at timestamptz not null);
alter table private.maan_submission_facts enable row level security;
alter table private.maan_submission_epoch enable row level security;
alter table private.maan_submission_ready enable row level security;
alter table private.maan_submission_future_ready enable row level security;
revoke all on private.maan_submission_facts,private.maan_submission_epoch,private.maan_submission_ready,private.maan_submission_future_ready from public,anon,authenticated,service_role;

create function private.maan_submission_fact(p public.newar_detail_records)
returns table(record_id uuid,platform text,dataset text,source_id text,order_id text,member_id text,
 created_at timestamptz,success_at timestamptz,amount numeric,currency text,raw_provider text,paid boolean,status_known boolean,member_level integer,recharge_count integer)
language sql immutable security invoker set search_path=''as $projector$
 select p.id,p.platform,p.dataset,p.source_id,coalesce(nullif(p.order_number,''),p.source_id),nullif(btrim(p.member_id),''),
 p.created_at,p.success_at,p.amount,p.currency,
 case when coalesce(btrim(p.provider),'')=''and p.channel_type='ManualRecharge'then'人工充值'else coalesce(nullif(btrim(p.provider),''),'未识别通道')end,
 p.status_group='success',coalesce(p.status_group in('success','pending','failed','rejected'),false),
 case when upper(btrim(coalesce(p.raw->>'rechargeLevel',p.raw->>'memberLevel')))~'^L(V)?[0-9]{1,4}$'
 then regexp_replace(upper(btrim(coalesce(p.raw->>'rechargeLevel',p.raw->>'memberLevel'))),'^LV?','')::integer
 when btrim(coalesce(p.raw->>'rechargeLevel',p.raw->>'memberLevel'))~'^[0-9]{1,4}$'
 then btrim(coalesce(p.raw->>'rechargeLevel',p.raw->>'memberLevel'))::integer end,
 case when btrim(p.raw->>'rechargeCount')~'^[0-9]{1,9}$'then btrim(p.raw->>'rechargeCount')::integer end
 where p.platform='MAANWIN'and p.dataset='charge'and
 (p.created_at>=timestamptz'2026-10-09 18:30:00Z'or(p.status_group='success'and p.success_at>=timestamptz'2026-10-09 18:30:00Z'));
$projector$;

create function private.sync_maan_submission_fact()returns trigger
language plpgsql volatile security definer set search_path=''as $sync$
begin
 if TG_RELID<>'public.newar_detail_records'::regclass or TG_WHEN<>'AFTER'or TG_LEVEL<>'ROW'or TG_OP not in('INSERT','UPDATE','DELETE')then raise exception'maan_submission_trigger_context_invalid';end if;
 if TG_OP='DELETE'then delete from private.maan_submission_facts where record_id=OLD.id;return OLD;end if;
 if TG_OP='UPDATE'then
  -- Capture/received timestamps and unrelated raw fields are not computation
  -- inputs. A same-input observation leaves the fact xmin unchanged.
  if row(OLD.id,OLD.platform,OLD.dataset,OLD.source_id,OLD.order_number,OLD.member_id,OLD.created_at,OLD.success_at,
    OLD.amount::text,OLD.currency,OLD.provider,OLD.channel_type,OLD.status_group)is not distinct from
    row(NEW.id,NEW.platform,NEW.dataset,NEW.source_id,NEW.order_number,NEW.member_id,NEW.created_at,NEW.success_at,
    NEW.amount::text,NEW.currency,NEW.provider,NEW.channel_type,NEW.status_group)
    and(OLD.raw is not distinct from NEW.raw or
     row(OLD.raw->>'rechargeLevel',OLD.raw->>'memberLevel',OLD.raw->>'rechargeCount')is not distinct from
     row(NEW.raw->>'rechargeLevel',NEW.raw->>'memberLevel',NEW.raw->>'rechargeCount'))then return NEW;end if;
  if OLD.id is distinct from NEW.id then delete from private.maan_submission_facts where record_id=OLD.id;end if;
 end if;
 if NEW.platform='MAANWIN'and NEW.dataset='charge'and
  (NEW.created_at>=timestamptz'2026-10-09 18:30:00Z'or(NEW.status_group='success'and NEW.success_at>=timestamptz'2026-10-09 18:30:00Z'))then
  insert into private.maan_submission_facts as oldfact select * from private.maan_submission_fact(NEW)
  on conflict(record_id)do update set
   platform=excluded.platform,dataset=excluded.dataset,source_id=excluded.source_id,order_id=excluded.order_id,member_id=excluded.member_id,
   created_at=excluded.created_at,success_at=excluded.success_at,amount=excluded.amount,currency=excluded.currency,raw_provider=excluded.raw_provider,
   paid=excluded.paid,status_known=excluded.status_known,member_level=excluded.member_level,recharge_count=excluded.recharge_count
  where row(oldfact.platform,oldfact.dataset,oldfact.source_id,oldfact.order_id,oldfact.member_id,oldfact.created_at,oldfact.success_at,
   oldfact.amount::text,oldfact.currency,oldfact.raw_provider,oldfact.paid,oldfact.status_known,oldfact.member_level,oldfact.recharge_count)
   is distinct from row(excluded.platform,excluded.dataset,excluded.source_id,excluded.order_id,excluded.member_id,excluded.created_at,excluded.success_at,
   excluded.amount::text,excluded.currency,excluded.raw_provider,excluded.paid,excluded.status_known,excluded.member_level,excluded.recharge_count);
 else delete from private.maan_submission_facts where record_id=NEW.id;end if;
 return NEW;
end;
$sync$;
create trigger "0_maan_submission_sync_insert" after insert on public.newar_detail_records for each row
 when(NEW.platform='MAANWIN'and NEW.dataset='charge'and(NEW.created_at>=timestamptz'2026-10-09 18:30:00Z'or(NEW.status_group='success'and NEW.success_at>=timestamptz'2026-10-09 18:30:00Z')))execute function private.sync_maan_submission_fact();
create trigger "0_maan_submission_sync_delete" after delete on public.newar_detail_records for each row
 when(OLD.platform='MAANWIN'and OLD.dataset='charge'and(OLD.created_at>=timestamptz'2026-10-09 18:30:00Z'or(OLD.status_group='success'and OLD.success_at>=timestamptz'2026-10-09 18:30:00Z')))execute function private.sync_maan_submission_fact();
create trigger "0_maan_submission_sync_update" after update on public.newar_detail_records for each row
 when((OLD.platform='MAANWIN'and OLD.dataset='charge'and(OLD.created_at>=timestamptz'2026-10-09 18:30:00Z'or(OLD.status_group='success'and OLD.success_at>=timestamptz'2026-10-09 18:30:00Z')))
  or(NEW.platform='MAANWIN'and NEW.dataset='charge'and(NEW.created_at>=timestamptz'2026-10-09 18:30:00Z'or(NEW.status_group='success'and NEW.success_at>=timestamptz'2026-10-09 18:30:00Z'))))execute function private.sync_maan_submission_fact();

create function private.invalidate_maan_submission_ready()returns trigger
language plpgsql volatile security definer set search_path=''as $invalidate$
begin
 if TG_RELID<>'private.maan_submission_facts'::regclass or TG_WHEN<>'AFTER'or TG_LEVEL<>'STATEMENT'or TG_OP not in('INSERT','UPDATE','DELETE','TRUNCATE')then raise exception'maan_submission_control_context_invalid';end if;
 -- Native trigger maintenance preserves already-proved correspondence. It
 -- cannot endlessly revoke readiness as today's orders are collected.
 if pg_trigger_depth()>1 then return null;end if;
 if TG_OP in('INSERT','UPDATE')then if not exists(select 1 from newfacts)then return null;end if;
 elsif TG_OP='DELETE'then
  if not exists(select 1 from oldfacts)then return null;end if;
  -- FK cascade can execute after the source trigger stack unwinds.
  if not exists(select 1 from oldfacts o join public.newar_detail_records n on n.id=o.record_id)then return null;end if;
 end if;
 update private.maan_submission_epoch set epoch=epoch+1 where singleton;
 delete from private.maan_submission_ready;delete from private.maan_submission_future_ready;
 return null;
end;
$invalidate$;
create trigger maan_submission_ready_insert after insert on private.maan_submission_facts referencing new table as newfacts for each statement execute function private.invalidate_maan_submission_ready();
create trigger maan_submission_ready_update after update on private.maan_submission_facts referencing old table as oldfacts new table as newfacts for each statement execute function private.invalidate_maan_submission_ready();
create trigger maan_submission_ready_delete after delete on private.maan_submission_facts referencing old table as oldfacts for each statement execute function private.invalidate_maan_submission_ready();
create trigger maan_submission_ready_truncate after truncate on private.maan_submission_facts for each statement execute function private.invalidate_maan_submission_ready();
create function private.guard_maan_submission_control_write()returns trigger
language plpgsql volatile security invoker set search_path=''as $writeguard$
begin
 if TG_RELID not in('private.maan_submission_epoch'::regclass,'private.maan_submission_ready'::regclass,'private.maan_submission_future_ready'::regclass)or current_user<>'postgres'then raise exception using errcode='42501',message='maan_submission_control_owner_only';end if;
 if TG_LEVEL='STATEMENT'then return null;elsif TG_OP='DELETE'then return OLD;else return NEW;end if;
end;
$writeguard$;
create trigger maan_epoch_owner_write before insert or update or delete on private.maan_submission_epoch for each row execute function private.guard_maan_submission_control_write();
create trigger maan_epoch_owner_truncate before truncate on private.maan_submission_epoch for each statement execute function private.guard_maan_submission_control_write();
create trigger maan_ready_owner_write before insert or update or delete on private.maan_submission_ready for each row execute function private.guard_maan_submission_control_write();
create trigger maan_ready_owner_truncate before truncate on private.maan_submission_ready for each statement execute function private.guard_maan_submission_control_write();
create trigger maan_future_owner_write before insert or update or delete on private.maan_submission_future_ready for each row execute function private.guard_maan_submission_control_write();
create trigger maan_future_owner_truncate before truncate on private.maan_submission_future_ready for each statement execute function private.guard_maan_submission_control_write();
revoke all on function private.maan_submission_fact(public.newar_detail_records),private.sync_maan_submission_fact(),private.invalidate_maan_submission_ready(),private.guard_maan_submission_control_write()from public,anon,authenticated,service_role;
create function private.maan_submission_generation()returns text language sql stable security invoker set search_path=''set timezone='UTC'as $generation$
 with snapshot as materialized(select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),
  'result',pg_get_function_result(p.oid),'lang',l.lanname,'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),
  'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,
  'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)
  from pg_proc p join pg_language l on l.oid=p.prolang where p.oid in(
    to_regprocedure('private.maan_submission_fact(public.newar_detail_records)'),to_regprocedure('private.sync_maan_submission_fact()'),
    to_regprocedure('private.invalidate_maan_submission_ready()'),to_regprocedure('private.guard_maan_submission_control_write()'))),
 'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,
  'definition',pg_get_triggerdef(t.oid))order by t.tgrelid::regclass::text,t.tgname)
  from pg_trigger t where not t.tgisinternal and
  ((t.tgrelid='public.newar_detail_records'::regclass and t.tgname=any(array['0_maan_submission_sync_insert','0_maan_submission_sync_update','0_maan_submission_sync_delete']))
   or t.tgrelid in('private.maan_submission_facts'::regclass,'private.maan_submission_epoch'::regclass,'private.maan_submission_ready'::regclass,'private.maan_submission_future_ready'::regclass))),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'persistence',c.relpersistence,
  'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,'options',c.reloptions,
  'policies',(select count(*)from pg_policy where polrelid=c.oid),
  'inheritance',(select count(*)from pg_inherits where inhparent=c.oid or inhrelid=c.oid),
  'rules',(select count(*)from pg_rewrite where ev_class=c.oid),
  'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.atthasdef,a.attgenerated,a.attidentity,a.attcollation,a.attacl::text)order by a.attnum)
   from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_array(k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid))order by k.conname)
   from pg_constraint k where k.conrelid=c.oid and k.contype<>'n'),
  'indexes',(select jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive,i.indimmediate)order by pg_get_indexdef(i.indexrelid))
   from pg_index i where i.indrelid=c.oid))order by c.relname)
  from pg_class c where c.oid in('private.maan_submission_facts'::regclass,'private.maan_submission_epoch'::regclass,'private.maan_submission_ready'::regclass,'private.maan_submission_future_ready'::regclass))
)as specification),source_guard as materialized(select
  exists(select 1 from pg_class c where c.oid='public.newar_detail_records'::regclass and c.relowner='postgres'::regrole and c.relkind='r'and c.relpersistence='p'and c.relrowsecurity and not c.relforcerowsecurity
   and c.relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'and not exists(select 1 from pg_policy where polrelid=c.oid)
   and not exists(select 1 from pg_inherits where inhparent=c.oid or inhrelid=c.oid))
  and(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attcollation::text)order by array_position(array['id','platform','dataset','source_id','order_number','member_id','provider','channel_type','currency','amount','status_group','created_at','success_at','raw']::text[],a.attname))from pg_attribute a
   where a.attrelid='public.newar_detail_records'::regclass and a.attnum>0 and not a.attisdropped and a.attname=any(array['id','platform','dataset','source_id','order_number','member_id','provider','channel_type','currency','amount','status_group','created_at','success_at','raw']))is not distinct from '[["id","uuid",true,"","","0"],["platform","text",true,"","","100"],["dataset","text",true,"","","100"],["source_id","text",true,"","","100"],["order_number","text",false,"","","100"],["member_id","text",false,"","","100"],["provider","text",false,"","","100"],["channel_type","text",false,"","","100"],["currency","text",false,"","","100"],["amount","numeric(24,8)",true,"","","0"],["status_group","text",true,"","","100"],["created_at","timestamp with time zone",true,"","","0"],["success_at","timestamp with time zone",false,"","","0"],["raw","jsonb",true,"","","0"]]'::jsonb
  and not exists(select 1 from pg_attribute where attrelid='public.newar_detail_records'::regclass and attname=any(array['recharge_level','recharge_count'])and not attisdropped)
  and exists(select 1 from pg_constraint k join pg_index i on i.indexrelid=k.conindid where k.conrelid='public.newar_detail_records'::regclass and k.contype='p'and k.convalidated and not k.condeferrable and not k.condeferred
   and i.indisvalid and i.indisready and i.indislive and i.indimmediate and i.indisunique and i.indisprimary and i.indpred is null and i.indexprs is null and pg_get_constraintdef(k.oid)='PRIMARY KEY (id)')
  and exists(select 1 from pg_constraint k join pg_index i on i.indexrelid=k.conindid where k.conrelid='public.newar_detail_records'::regclass and k.contype='u'and k.convalidated and not k.condeferrable and not k.condeferred
   and i.indisvalid and i.indisready and i.indislive and i.indimmediate and pg_get_constraintdef(k.oid)='UNIQUE (platform, dataset, source_id)')ok)
 select case when(select ok from source_guard)and(select md5(specification::text)from snapshot)='3a89da0beb95eff2f4238b86aaefd1db'
 and(select count(*)from private.maan_submission_epoch)=1 then md5(jsonb_build_object('formula','3a89da0beb95eff2f4238b86aaefd1db',
  'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.xmin::text)order by p.oid)from pg_proc p where p.oid in(to_regprocedure('private.maan_submission_fact(public.newar_detail_records)'),to_regprocedure('private.sync_maan_submission_fact()'),to_regprocedure('private.invalidate_maan_submission_ready()'),to_regprocedure('private.guard_maan_submission_control_write()'))),
  'triggers',(select jsonb_agg(jsonb_build_array(t.oid,t.xmin::text)order by t.oid)from pg_trigger t where not t.tgisinternal and((t.tgrelid='public.newar_detail_records'::regclass and t.tgname=any(array['0_maan_submission_sync_insert','0_maan_submission_sync_update','0_maan_submission_sync_delete']))or t.tgrelid in('private.maan_submission_facts'::regclass,'private.maan_submission_epoch'::regclass,'private.maan_submission_ready'::regclass,'private.maan_submission_future_ready'::regclass))),
  'maintenanceEpoch',(select epoch from private.maan_submission_epoch where singleton))::text)end;
$generation$;
revoke all on function private.maan_submission_generation()from public,anon,authenticated,service_role;
-- Work-only owner maintenance prototype. A zero batch is not a ready receipt.
create function private.backfill_maan_submission_window(p_lane text,p_from timestamptz,p_to timestamptz,p_limit integer default 250)
returns jsonb language plpgsql volatile security invoker set search_path=''as $backfill$
declare v_inserted bigint;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='maan_submission_backfill_owner_only';end if;
 if p_lane is null or p_lane not in('created','paid')or p_from is null or p_to is null or not isfinite(p_from)or not isfinite(p_to)
  or p_from<timestamptz'2026-10-09 18:30:00Z'or p_to<=p_from or p_to-p_from>interval'15 minutes'
  or p_limit is null or p_limit<1 or p_limit>1000 then raise exception using errcode='22023',message='maan_submission_backfill_invalid_window';end if;
 if current_setting('statement_timeout')::interval>interval'3 seconds'or current_setting('statement_timeout')::interval=interval'0'
  or current_setting('lock_timeout')::interval>interval'1 second'or current_setting('lock_timeout')::interval=interval'0'
  then raise exception'maan_submission_backfill_budget_required';end if;
 if private.maan_submission_generation()is null then raise exception'maan_submission_backfill_generation_invalid';end if;
 if p_lane='created'then
  with locked as materialized(
   select n.*from public.newar_detail_records n where n.platform='MAANWIN'and n.dataset='charge'and n.created_at>=p_from and n.created_at<p_to
    and not exists(select 1 from private.maan_submission_facts f where f.record_id=n.id)
   order by n.created_at,n.id limit p_limit for share of n skip locked
  )insert into private.maan_submission_facts select p.*from locked n cross join lateral private.maan_submission_fact(n)p on conflict(record_id)do nothing;
 else
  with locked as materialized(
   select n.*from public.newar_detail_records n where n.platform='MAANWIN'and n.dataset='charge'and n.status_group='success'and n.success_at>=p_from and n.success_at<p_to
    and not exists(select 1 from private.maan_submission_facts f where f.record_id=n.id)
   order by n.success_at,n.id limit p_limit for share of n skip locked
  )insert into private.maan_submission_facts select p.*from locked n cross join lateral private.maan_submission_fact(n)p on conflict(record_id)do nothing;
 end if;
 get diagnostics v_inserted=row_count;
 return jsonb_build_object('lane',p_lane,'from',p_from,'to',p_to,'inserted',v_inserted,'ready',false);
end;
$backfill$;
revoke all on function private.backfill_maan_submission_window(text,timestamptz,timestamptz,integer)from public,anon,authenticated,service_role;

create function private.check_maan_submission_window(p_lane text,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path=''as $check$
declare missing boolean;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='maan_submission_backfill_owner_only';end if;
 if p_lane is null or p_lane not in('created','paid')or p_from is null or p_to is null or not isfinite(p_from)or not isfinite(p_to)
  or p_from<timestamptz'2026-10-09 18:30:00Z'or p_to<=p_from or p_to-p_from>interval'15 minutes'then raise exception using errcode='22023',message='maan_submission_backfill_invalid_window';end if;
 if current_setting('statement_timeout')::interval>interval'3 seconds'or current_setting('statement_timeout')::interval=interval'0'
  or current_setting('lock_timeout')::interval>interval'1 second'or current_setting('lock_timeout')::interval=interval'0'
  then raise exception'maan_submission_backfill_budget_required';end if;
 if private.maan_submission_generation()is null then raise exception'maan_submission_backfill_generation_invalid';end if;
 if p_lane='created'then
  select exists(select 1 from public.newar_detail_records n where n.platform='MAANWIN'and n.dataset='charge'and n.created_at>=p_from and n.created_at<p_to
    and not exists(select 1 from private.maan_submission_facts f where f.record_id=n.id))into missing;
 else
  select exists(select 1 from public.newar_detail_records n where n.platform='MAANWIN'and n.dataset='charge'and n.status_group='success'and n.success_at>=p_from and n.success_at<p_to
    and not exists(select 1 from private.maan_submission_facts f where f.record_id=n.id))into missing;
 end if;
 return jsonb_build_object('lane',p_lane,'from',p_from,'to',p_to,'missingFactExists',missing,'windowComplete',not missing,'dayReady',false,
   'meaning','native keys only; exact field parity and whole-day readiness require separate proof');
end;$check$;
create function private.maintain_maan_submission_window(p_lane text,p_from timestamptz,p_to timestamptz,p_limit integer default 250)
returns jsonb language plpgsql volatile security invoker set search_path=''as $maintain$
declare receipt jsonb;checked jsonb;
begin
 -- One 3s statement budget covers both bounded write and the key-only check.
 receipt:=private.backfill_maan_submission_window(p_lane,p_from,p_to,p_limit);
 checked:=private.check_maan_submission_window(p_lane,p_from,p_to);
 return receipt||checked;
end;$maintain$;
revoke all on function private.check_maan_submission_window(text,timestamptz,timestamptz),private.maintain_maan_submission_window(text,timestamptz,timestamptz,integer)from public,anon,authenticated,service_role;
$objects$;
 elsif existing<>4 then raise exception'maan_submission_install_partial_or_unknown';end if;
 if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['maan_submission_fact','sync_maan_submission_fact','invalidate_maan_submission_ready','guard_maan_submission_control_write','maan_submission_generation','backfill_maan_submission_window','check_maan_submission_window','maintain_maan_submission_window']))::text))is distinct from '462bf7f52237cb34446203e56c14d58e'then raise exception'maan_submission_install_function_drift';end if;
 if private.maan_submission_generation()is null then raise exception'maan_submission_install_layout_or_generation_drift';end if;
 select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled,md5(p.prosrc))order by t.tgname)into after_triggers
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.newar_detail_records'::regclass and not t.tgisinternal and t.tgname not like '0_maan_submission_sync_%';
 if before_triggers is distinct from after_triggers then raise exception'maan_submission_existing_source_triggers_changed';end if;
end;$install$;
commit;
