-- Owner-only exact MAAN charge correspondence proof. No approval or reader switch.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';set local timezone='UTC';set local search_path='';
do $install$
begin
 if current_user<>'postgres'then raise exception'maan_submission_install_owner_only';end if;
 lock table public.newar_detail_records in access share mode nowait;
 if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['maan_submission_fact','sync_maan_submission_fact','invalidate_maan_submission_ready','guard_maan_submission_control_write','maan_submission_generation','backfill_maan_submission_window','check_maan_submission_window','maintain_maan_submission_window']))::text))is distinct from '462bf7f52237cb34446203e56c14d58e'or private.maan_submission_generation()is null then raise exception'maan_submission_stage1_prerequisite_drift';end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and p.proname=any(array['begin_maan_submission_day','verify_maan_submission_hour','approve_maan_submission_day','approve_maan_submission_future','maan_submission_can_read']))then
 execute $objects$-- Local owner-only proof core. ONE explicit RR transaction, separate 3s
-- statements for BEGIN + each of 24 hours + APPROVE. No whole-day rescan.
-- This proves received native parity, not source-site completeness.
create function private.begin_maan_submission_day(p_day date)returns jsonb language plpgsql volatile security invoker set search_path=''as $proof$
declare g text;e bigint;m jsonb;
begin
 if current_user<>'postgres'or current_setting('transaction_isolation')<>'repeatable read'then raise exception'maan_proof_actor_snapshot_invalid';end if;
 if current_setting('statement_timeout')::interval>interval'3 seconds'or current_setting('statement_timeout')::interval=interval'0'
  or current_setting('lock_timeout')::interval>interval'1 second'or current_setting('lock_timeout')::interval=interval'0'then raise exception'maan_proof_budget_required';end if;
 if p_day is null or not isfinite(p_day)or p_day<date'2026-10-10'then raise exception'maan_proof_day_invalid';end if;
 lock table public.newar_detail_records in access share mode nowait;
 lock table private.maan_submission_facts in access share mode nowait;
 select epoch into e from private.maan_submission_epoch where singleton for share;
 if not found then raise exception'maan_proof_epoch_missing';end if;
 g:=private.maan_submission_generation();if g is null then raise exception'maan_proof_generation_invalid';end if;
 if to_regclass('pg_temp.maan_submission_proof_context')is not null then raise exception'maan_proof_already_started';end if;
 create temporary table maan_submission_proof_context(singleton boolean primary key check(singleton),data_date date not null,generation text not null,epoch bigint not null,started_at timestamptz not null,metadata jsonb not null)on commit drop;
 create temporary table maan_submission_proof_parts(hour integer primary key check(hour between 0 and 23),interval_start timestamptz not null,interval_end timestamptz not null,source_count bigint not null check(source_count>=0))on commit drop;
 select jsonb_agg(jsonb_build_array(p.oid,p.xmin::text,to_jsonb(p))order by p.oid)into m from pg_proc p where p.oid=any(array['private.begin_maan_submission_day(date)'::regprocedure,'private.verify_maan_submission_hour(date,integer)'::regprocedure,'private.approve_maan_submission_day(date)'::regprocedure,'private.approve_maan_submission_future(date)'::regprocedure,'private.maan_submission_can_read(date,date)'::regprocedure]);
 insert into pg_temp.maan_submission_proof_context values(true,p_day,g,e,clock_timestamp(),m);
 return jsonb_build_object('started',true,'day',p_day,'generation',g,'nullHistory','empty_by_native_not_null');
end;$proof$;
create function private.verify_maan_submission_hour(p_day date,p_hour integer)returns jsonb language plpgsql volatile security invoker set search_path=''as $proof$
declare c record;lo timestamptz;hi timestamptz;daylo timestamptz;dayhi timestamptz;v_count bigint;m bigint;x bigint;b bigint;
begin
 if current_user<>'postgres'or current_setting('transaction_isolation')<>'repeatable read'then raise exception'maan_proof_actor_snapshot_invalid';end if;
 if current_setting('statement_timeout')::interval>interval'3 seconds'or current_setting('statement_timeout')::interval=interval'0'
  or current_setting('lock_timeout')::interval>interval'1 second'or current_setting('lock_timeout')::interval=interval'0'then raise exception'maan_proof_budget_required';end if;
 select *into c from pg_temp.maan_submission_proof_context where singleton;
 if not found or c.data_date is distinct from p_day then raise exception'maan_proof_context_invalid';end if;
 if p_hour is null or p_hour not between 0 and 23 then raise exception'maan_proof_hour_invalid';end if;
 if clock_timestamp()-c.started_at>=interval'120 seconds'then raise exception'maan_proof_deadline';end if;
 if exists(select 1 from pg_temp.maan_submission_proof_parts where hour=p_hour)then raise exception'maan_proof_hour_repeated';end if;
 daylo:=p_day::timestamp at time zone'Asia/Kolkata';dayhi:=(p_day+1)::timestamp at time zone'Asia/Kolkata';
 lo:=daylo+p_hour*interval'1 hour';hi:=lo+interval'1 hour';
 with native as materialized(
  select n.*from public.newar_detail_records n where n.platform='MAANWIN'and n.dataset='charge'and n.created_at>=lo and n.created_at<hi
  union all select n.*from public.newar_detail_records n where n.platform='MAANWIN'and n.dataset='charge'and n.status_group='success'and n.success_at>=lo and n.success_at<hi and(n.created_at>=daylo and n.created_at<dayhi)is not true
 ),expected as materialized(select p.*from native n cross join lateral private.maan_submission_fact(n)p),actual as materialized(
  select f.*from private.maan_submission_facts f where f.created_at>=lo and f.created_at<hi
  union all select f.*from private.maan_submission_facts f where f.paid and f.success_at>=lo and f.success_at<hi and(f.created_at>=daylo and f.created_at<dayhi)is not true
 )select count(a.record_id),count(*)filter(where a.record_id is not null and f.record_id is null),count(*)filter(where a.record_id is null and f.record_id is not null),
 count(*)filter(where a.record_id is not null and f.record_id is not null and
 row(a.platform,a.dataset,a.source_id,a.order_id,a.member_id,a.created_at,a.success_at,a.amount::text,a.currency,a.raw_provider,a.paid,a.status_known,a.member_level,a.recharge_count)is distinct from
 row(f.platform,f.dataset,f.source_id,f.order_id,f.member_id,f.created_at,f.success_at,f.amount::text,f.currency,f.raw_provider,f.paid,f.status_known,f.member_level,f.recharge_count))into v_count,m,x,b from expected a full join actual f using(record_id);
 if m<>0 or x<>0 or b<>0 then raise exception'maan_proof_parity_failed'using detail=format('missing=%s extra=%s changed=%s',m,x,b);end if;
 if clock_timestamp()-c.started_at>=interval'120 seconds'then raise exception'maan_proof_deadline';end if;
 insert into pg_temp.maan_submission_proof_parts values(p_hour,lo,hi,v_count);
 return jsonb_build_object('verified',true,'hour',p_hour,'sourceCount',v_count);
end;$proof$;
create function private.approve_maan_submission_day(p_day date)returns jsonb language plpgsql volatile security invoker set search_path=''as $proof$
declare c record;g text;n bigint;m jsonb;
begin
 if current_user<>'postgres'or current_setting('transaction_isolation')<>'repeatable read'then raise exception'maan_proof_actor_snapshot_invalid';end if;
 if current_setting('statement_timeout')::interval>interval'3 seconds'or current_setting('statement_timeout')::interval=interval'0'
  or current_setting('lock_timeout')::interval>interval'1 second'or current_setting('lock_timeout')::interval=interval'0'then raise exception'maan_proof_budget_required';end if;
 select *into c from pg_temp.maan_submission_proof_context where singleton;
 if not found or c.data_date is distinct from p_day then raise exception'maan_proof_context_invalid';end if;
 if clock_timestamp()-c.started_at>=interval'120 seconds'then raise exception'maan_proof_deadline';end if;
 if(select count(*)from pg_temp.maan_submission_proof_parts)<>24 or exists(select 1 from generate_series(0,23)h left join pg_temp.maan_submission_proof_parts p on p.hour=h
  where p.hour is null or p.interval_start is distinct from(p_day::timestamp at time zone'Asia/Kolkata')+h*interval'1 hour'or p.interval_end is distinct from(p_day::timestamp at time zone'Asia/Kolkata')+(h+1)*interval'1 hour')then raise exception'maan_proof_parts_incomplete';end if;
 g:=private.maan_submission_generation();
 select jsonb_agg(jsonb_build_array(p.oid,p.xmin::text,to_jsonb(p))order by p.oid)into m from pg_proc p where p.oid=any(array['private.begin_maan_submission_day(date)'::regprocedure,'private.verify_maan_submission_hour(date,integer)'::regprocedure,'private.approve_maan_submission_day(date)'::regprocedure,'private.approve_maan_submission_future(date)'::regprocedure,'private.maan_submission_can_read(date,date)'::regprocedure]);
 if g is null or g is distinct from c.generation or(select epoch from private.maan_submission_epoch where singleton)is distinct from c.epoch or m is distinct from c.metadata then raise exception'maan_proof_generation_changed';end if;
 select sum(source_count)into n from pg_temp.maan_submission_proof_parts;
 insert into private.maan_submission_ready values(p_day,g,n,clock_timestamp())on conflict(data_date)do update set generation=excluded.generation,source_count=excluded.source_count,validated_at=excluded.validated_at;
 return jsonb_build_object('approved',true,'day',p_day,'generation',g,'sourceCount',n,'parts',24,'sourceCompletenessVerified',false);
end;$proof$;
create function private.approve_maan_submission_future(p_from date)returns jsonb language plpgsql volatile security invoker set search_path=''as $proof$
declare g text;e bigint;lo timestamptz;
begin
 if current_user<>'postgres'or current_setting('transaction_isolation')<>'repeatable read'then raise exception'maan_proof_actor_snapshot_invalid';end if;
 if current_setting('statement_timeout')::interval>interval'3 seconds'or current_setting('statement_timeout')::interval=interval'0'
  or current_setting('lock_timeout')::interval>interval'1 second'or current_setting('lock_timeout')::interval=interval'0'then raise exception'maan_proof_budget_required';end if;
 if p_from is null or not isfinite(p_from)or p_from<date'2026-10-10'then raise exception'maan_proof_day_invalid';end if;
 lock table public.newar_detail_records in access share mode nowait;lock table private.maan_submission_facts in access share mode nowait;
 select epoch into e from private.maan_submission_epoch where singleton for share;if not found then raise exception'maan_proof_epoch_missing';end if;
 g:=private.maan_submission_generation();if g is null then raise exception'maan_proof_generation_invalid';end if;
 lo:=p_from::timestamp at time zone'Asia/Kolkata';
 if exists(select 1 from public.newar_detail_records n where n.platform='MAANWIN'and n.dataset='charge'and n.created_at>=lo)
  or exists(select 1 from public.newar_detail_records n where n.platform='MAANWIN'and n.dataset='charge'and n.status_group='success'and n.success_at>=lo)
  or exists(select 1 from private.maan_submission_facts f where f.created_at>=lo)
  or exists(select 1 from private.maan_submission_facts f where f.paid and f.success_at>=lo)then raise exception'maan_proof_future_not_empty';end if;
 if private.maan_submission_generation()is distinct from g or(select epoch from private.maan_submission_epoch where singleton)is distinct from e then raise exception'maan_proof_generation_changed';end if;
 insert into private.maan_submission_future_ready values(true,p_from,g,clock_timestamp())on conflict(singleton)do update set future_from=excluded.future_from,generation=excluded.generation,validated_at=excluded.validated_at;
 return jsonb_build_object('approved',true,'futureFrom',p_from,'generation',g);
end;$proof$;
create function private.maan_submission_can_read(p_from date,p_to date)returns boolean language plpgsql stable security invoker set search_path=''as $ready$
declare g text;
begin
 if p_from is null or p_to is null or not isfinite(p_from)or not isfinite(p_to)or p_from<date'2026-10-10'or p_to<=p_from or p_to-p_from>31 then return false;end if;
 if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['begin_maan_submission_day','verify_maan_submission_hour','approve_maan_submission_day','approve_maan_submission_future','maan_submission_generation']))::text))is distinct from 'cdc808b656aa670334e65b964aac47fa'then return false;end if;
 g:=private.maan_submission_generation();if g is null then return false;end if;
 -- source_guard verifies created_at NOT NULL and therefore proves the complete
 -- all-history NULL-time population empty. A nullable schema fails the gate.
 return not exists(select 1 from generate_series(p_from::timestamp,(p_to-1)::timestamp,interval'1 day')d
  where not exists(select 1 from private.maan_submission_ready r where r.data_date=d::date and r.generation=g)
    and not exists(select 1 from private.maan_submission_future_ready r where r.singleton and d::date>=r.future_from and r.generation=g));
end;$ready$;
revoke all on function private.begin_maan_submission_day(date),private.verify_maan_submission_hour(date,integer),private.approve_maan_submission_day(date),private.approve_maan_submission_future(date),private.maan_submission_can_read(date,date)from public,anon,authenticated,service_role;
$objects$;
 end if;
 if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['begin_maan_submission_day','verify_maan_submission_hour','approve_maan_submission_day','approve_maan_submission_future','maan_submission_can_read']))::text))is distinct from '6501ed5e8575d0b74f9f8fde047fc4a8'then raise exception'maan_submission_proof_function_drift';end if;
 if private.maan_submission_generation()is null then raise exception'maan_submission_stage1_prerequisite_drift';end if;
end;$install$;
commit;
