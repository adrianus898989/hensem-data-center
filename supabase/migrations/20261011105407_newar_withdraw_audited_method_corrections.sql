-- Audited per-order handling corrections; no source order data is changed.
-- This migration intentionally contains no real order IDs and performs no history backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $precondition$
declare r record;p record;
begin
 for r in select * from(values ('private.newar_withdraw_fact(public.newar_detail_records)','f15a0b562b7f5def87aba1a36ba19506','244fe0b21d3b785a40c6409807b358bc',false),
('private.sync_newar_withdraw_fact()','a3daa3b8470e92bc410b745f343a3a1e','cf7cbf7a51114d4cb72e8b2166ae10ab',true),
('private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)','450e601fef3810bf73c438d37762dd70','450e601fef3810bf73c438d37762dd70',false),
('private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)','25998ec79da2b15a62892746e8321160','25998ec79da2b15a62892746e8321160',false),
('private.newar_stats_time(text)','5789c6b60e5bf5789b1ac1733df85c34','5789c6b60e5bf5789b1ac1733df85c34',false)) x(sig,before_hash,after_hash,definer) loop
  select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid=to_regprocedure(r.sig);
  if not FOUND or p.owner_name<>'postgres' or p.prosecdef is distinct from r.definer
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   or md5(p.prosrc) not in(r.before_hash,r.after_hash) then raise exception 'newar_method_correction_prerequisite_drift';end if;
  if p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname=case when r.definer or r.sig in('private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)','private.newar_stats_time(text)') then 'plpgsql' else 'sql' end)
   or p.provolatile<>(case when r.sig='private.newar_withdraw_fact(public.newar_detail_records)' then case when md5(p.prosrc)=r.before_hash then 'i' else 'v' end
    when r.definer then 'v' when r.sig='private.newar_stats_time(text)' then 'i' else 's' end)
   then raise exception 'newar_method_correction_function_metadata_drift';end if;
 end loop;
 if to_regprocedure('private.sync_newar_withdraw_method_verification()') is not null then
  select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid='private.sync_newar_withdraw_method_verification()'::regprocedure;
  if p.owner_name<>'postgres' or not p.prosecdef or p.provolatile<>'v' or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proacl::text is distinct from '{postgres=X/postgres}' or md5(p.prosrc)<>'9d8563b59e60e6c5bed029953bdc566b' then raise exception 'newar_method_verification_function_drift';end if;
 end if;
 if to_regclass('private.newar_withdraw_method_verifications') is not null and not exists(
  select 1 from pg_class c where c.oid=to_regclass('private.newar_withdraw_method_verifications') and c.relkind='r'
   and c.relowner='postgres'::regrole and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner))
 then raise exception 'newar_method_verification_table_drift';end if;
end;$precondition$;
create table if not exists private.newar_withdraw_method_verifications(
 record_id uuid primary key references public.newar_detail_records(id) on delete cascade deferrable initially deferred,
 platform text not null,dataset text not null,source_id text not null,confirmed_method text not null,
 evidence_kind text not null,evidence_ref text not null,verified_at timestamptz not null default statement_timestamp(),
 constraint newar_method_verification_identity_check check(dataset='withdraw' and length(platform) between 1 and 200 and length(source_id) between 1 and 200),
 constraint newar_method_verification_method_check check(confirmed_method in('auto','manual')),
 constraint newar_method_verification_evidence_check check(evidence_kind='user_confirmed_source_ui' and evidence_ref ~ '^[A-Za-z0-9_.:-]{1,120}$')
);
alter table private.newar_withdraw_method_verifications enable row level security;
revoke all on private.newar_withdraw_method_verifications from public,anon,authenticated,service_role;
create or replace function private.newar_withdraw_fact(p public.newar_detail_records)
returns table(record_id uuid,platform text,source_id text,status_group text,currency text,created_at timestamptz,
 captured_at timestamptz,received_at timestamptz,method text,account text,submitted_at timestamptz,handled_at timestamptz)
-- VOLATILE is required to see the audit row inserted by this statement's AFTER trigger.
language sql volatile security invoker set search_path='' as $projector$
 select p.id,p.platform,p.source_id,p.status_group,p.currency,p.created_at,p.captured_at,p.received_at,
  coalesce(v.confirmed_method,case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
   and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual') then r."operatorType" end),
  case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
   and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual')
   then btrim(r."operatorName") else '（未知操作人）' end,
  case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
   then private.newar_stats_time(r."sourceSubmittedAt") end,
  case when r."businessSchemaVersion"='2' and nullif(r."sourceHandledSourceField",'') is not null
   then private.newar_stats_time(r."sourceHandledAt") end
 from jsonb_to_record(case when jsonb_typeof(p.raw)='object' then p.raw else '{}'::jsonb end)
  r("businessSchemaVersion" text,"operatorType" text,"operatorName" text,"operatorSourceField" text,
    "sourceSubmittedAt" text,"sourceSubmittedSourceField" text,"sourceHandledAt" text,"sourceHandledSourceField" text)
 left join private.newar_withdraw_method_verifications v on v.record_id=p.id
  and v.platform=p.platform and v.dataset=p.dataset and v.source_id=p.source_id
 where p.dataset='withdraw';
$projector$;
create or replace function private.sync_newar_withdraw_fact() returns trigger
language plpgsql volatile security definer set search_path='' as $source_sync$
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
 if TG_OP='UPDATE' and row(OLD.id,OLD.platform,OLD.dataset,OLD.source_id) is distinct from row(NEW.id,NEW.platform,NEW.dataset,NEW.source_id) then
  delete from private.newar_withdraw_method_verifications where record_id in(OLD.id,NEW.id);
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
$source_sync$;
create or replace function private.sync_newar_withdraw_method_verification() returns trigger
language plpgsql volatile security definer set search_path='' as $verification_sync$
declare v private.newar_withdraw_method_verifications%rowtype;n public.newar_detail_records%rowtype;
begin
 if TG_RELID<>'private.newar_withdraw_method_verifications'::regclass or TG_WHEN<>'AFTER' or TG_LEVEL<>'ROW' then
  raise exception 'newar_method_verification_trigger_context_invalid';
 end if;
 if TG_OP='UPDATE' and row(OLD.record_id,OLD.platform,OLD.dataset,OLD.source_id) is distinct from row(NEW.record_id,NEW.platform,NEW.dataset,NEW.source_id) then
  raise exception 'newar_method_verification_identity_immutable';
 end if;
 if TG_OP='DELETE' then v:=OLD;else v:=NEW;end if;
 select s.* into n from public.newar_detail_records s
 where s.id=v.record_id and s.platform=v.platform and s.dataset=v.dataset and s.source_id=v.source_id
 for share of s;
 if not FOUND then
  if TG_OP='DELETE' then return OLD;end if;
  raise exception 'newar_method_verification_source_identity_mismatch';
 end if;
 insert into private.newar_withdraw_facts(record_id,platform,source_id,status_group,currency,created_at,captured_at,received_at,method,account,submitted_at,handled_at)
 select * from private.newar_withdraw_fact(n)
 on conflict(record_id) do update set
  platform=excluded.platform,source_id=excluded.source_id,status_group=excluded.status_group,currency=excluded.currency,
  created_at=excluded.created_at,captured_at=excluded.captured_at,received_at=excluded.received_at,
  method=excluded.method,account=excluded.account,submitted_at=excluded.submitted_at,handled_at=excluded.handled_at;
 if TG_OP='DELETE' then return OLD;else return NEW;end if;
end;
$verification_sync$;
revoke all on function private.newar_withdraw_fact(public.newar_detail_records),private.sync_newar_withdraw_fact(),private.sync_newar_withdraw_method_verification() from public,anon,authenticated,service_role;
grant execute on function private.newar_withdraw_fact(public.newar_detail_records),private.sync_newar_withdraw_fact(),private.sync_newar_withdraw_method_verification() to postgres;
do $install_trigger$
begin
 if not exists(select 1 from pg_trigger where tgrelid='private.newar_withdraw_method_verifications'::regclass and tgname='newar_withdraw_method_verification_sync' and not tgisinternal) then
  create trigger newar_withdraw_method_verification_sync after insert or delete or update on private.newar_withdraw_method_verifications
   for each row execute function private.sync_newar_withdraw_method_verification();
 end if;
end;$install_trigger$;
do $objects$
declare cols jsonb;checks jsonb;t record;
begin
 select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum) into cols
 from pg_attribute a where a.attrelid='private.newar_withdraw_method_verifications'::regclass and a.attnum>0 and not a.attisdropped;
 if cols is distinct from '[ ["record_id","uuid",true],["platform","text",true],["dataset","text",true],["source_id","text",true],["confirmed_method","text",true],["evidence_kind","text",true],["evidence_ref","text",true],["verified_at","timestamp with time zone",true] ]'::jsonb
 then raise exception 'newar_method_verification_columns_drift';end if;
 if exists(select 1 from pg_policy where polrelid='private.newar_withdraw_method_verifications'::regclass)
  or (select count(*) from pg_constraint where conrelid='private.newar_withdraw_method_verifications'::regclass and contype in('p','f','c'))<>5
  or not exists(select 1 from pg_constraint where conrelid='private.newar_withdraw_method_verifications'::regclass and contype='f'
    and confrelid='public.newar_detail_records'::regclass and conkey=array[1]::smallint[] and confkey=array[1]::smallint[]
    and confdeltype='c' and confupdtype='a' and condeferrable and condeferred and convalidated)
 then raise exception 'newar_method_verification_constraints_drift';end if;
 select jsonb_agg(jsonb_build_array(conname,pg_get_expr(conbin,conrelid),convalidated,connoinherit) order by conname) into checks
 from pg_constraint where conrelid='private.newar_withdraw_method_verifications'::regclass and contype='c';
 if checks is distinct from $checks$[["newar_method_verification_evidence_check", "((evidence_kind = 'user_confirmed_source_ui'::text) AND (evidence_ref ~ '^[A-Za-z0-9_.:-]{1,120}$'::text))", true, false], ["newar_method_verification_identity_check", "((dataset = 'withdraw'::text) AND ((length(platform) >= 1) AND (length(platform) <= 200)) AND ((length(source_id) >= 1) AND (length(source_id) <= 200)))", true, false], ["newar_method_verification_method_check", "(confirmed_method = ANY (ARRAY['auto'::text, 'manual'::text]))", true, false]]$checks$::jsonb then raise exception 'newar_method_verification_checks_drift';end if;
 if not exists(select 1 from pg_constraint where conrelid='private.newar_withdraw_method_verifications'::regclass and contype='p' and conkey=array[1]::smallint[] and not condeferrable)
 then raise exception 'newar_method_verification_primary_key_drift';end if;
 select * into t from pg_trigger where tgrelid='private.newar_withdraw_method_verifications'::regclass and tgname='newar_withdraw_method_verification_sync' and not tgisinternal;
 if not FOUND or t.tgfoid<>'private.sync_newar_withdraw_method_verification()'::regprocedure or t.tgtype<>29 or t.tgenabled<>'O'
  or t.tgqual is not null or t.tgnargs<>0 then raise exception 'newar_method_verification_trigger_drift';end if;
end;$objects$;
commit;
