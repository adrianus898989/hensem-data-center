-- Owner maintenance ONLY. No permanent schema or application timeout changes.
-- One RR transaction/snapshot and one held epoch lock cover all 24 statements.
-- Each statement retains 5s; total wall-clock guard is 120s (including setup).
-- A timeout/error rolls back the whole transaction. Never resume at a later hour.
-- Counts of zero only verify that hour; they do not approve an incomplete day.
begin isolation level repeatable read;
set local statement_timeout='5s';set local lock_timeout='1s';set local jit=off;
create temporary table ar91_hour_proof_context(
 singleton boolean primary key check(singleton),data_date date not null,
 started_at timestamptz not null,generation text not null,metadata jsonb not null
)on commit drop;
create temporary table ar91_hour_proof_parts(
 hour integer primary key check(hour between 0 and 23),interval_start timestamp not null,
 interval_end timestamp not null,source_count bigint not null check(source_count>=0),
 missing_count bigint not null check(missing_count>=0),extra_count bigint not null check(extra_count>=0),
 changed_count bigint not null check(changed_count>=0)
)on commit drop;
do $start$
declare f record;spec record;g text;m jsonb;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar91_hour_proof_actor_snapshot_invalid';end if;
 if not isfinite(date '2026-10-11')or date '2026-10-11'<date '2026-10-10' then raise exception 'ar91_hour_proof_day_invalid';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_91club_submission_facts in share update exclusive mode nowait;
 perform 1 from private.ar_91club_submission_epoch where singleton for share;
 if not found then raise exception 'ar91_hour_proof_epoch_missing';end if;
 for spec in select * from(values
 ('private.ar_91club_submission_generation()','acd188a5da0cb2f63381bd5922e3a1cf',false,'s','sql','text',0,'[]'::jsonb),
 ('private.approve_ar_91club_submission_day(date)','016a4d4963a6a23375a83f3440754eae',false,'v','plpgsql','jsonb',0,'["p_day"]'::jsonb),
 ('private.approve_ar_91club_submission_null()','63c7b2d1c8dccf8ea454e628c6150514',false,'v','plpgsql','jsonb',0,'[]'::jsonb),
 ('private.approve_ar_91club_submission_future()','7847142a3b5d3f30564950f61f9118da',false,'v','plpgsql','jsonb',0,'[]'::jsonb),
 ('private.ar_91club_submission_can_read(date,date)','7252e3966d916239a3ce212ba91dc763',false,'s','plpgsql','boolean',0,'["p_from","p_to"]'::jsonb),
 ('private.sync_ar_91club_submission_fact()','aa90b34447201e26aa7e0b6ca0e8528a',true,'v','plpgsql','trigger',0,'[]'::jsonb),
 ('private.invalidate_ar_91club_submission_ready()','baf3365b826f76927f45b525f18ea080',true,'v','plpgsql','trigger',0,'[]'::jsonb))v(signature,hash,definer,volatility,language,return_type,defaults,argnames)loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
  if not found or md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef<>spec.definer or f.provolatile<>spec.volatility::"char" or f.proparallel<>'u' or f.lanname<>spec.language or f.prorettype<>spec.return_type::regtype or f.proretset or f.proisstrict or f.proleakproof or f.pronargdefaults<>spec.defaults or f.proconfig is distinct from array['search_path=""']::text[] or f.proacl::text is distinct from '{postgres=X/postgres}' or coalesce(to_jsonb(f.proargnames),'[]'::jsonb)<>spec.argnames then raise exception 'ar91_hour_proof_function_drift';end if;
 end loop;
 g:=private.ar_91club_submission_generation();if g is null then raise exception 'ar91_hour_proof_generation_invalid';end if;
 select jsonb_agg(jsonb_build_array(p.oid,p.xmin::text,to_jsonb(p))order by p.oid)into m from pg_proc p where p.oid=any(array['private.ar_91club_submission_generation()'::regprocedure,'private.approve_ar_91club_submission_day(date)'::regprocedure,'private.approve_ar_91club_submission_null()'::regprocedure,'private.approve_ar_91club_submission_future()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure,'private.sync_ar_91club_submission_fact()'::regprocedure,'private.invalidate_ar_91club_submission_ready()'::regprocedure]);
 insert into pg_temp.ar91_hour_proof_context values(true,date '2026-10-11',transaction_timestamp(),g,m);
end;$start$;
create function pg_temp.ar91_verify_hour(p_hour integer)returns jsonb language plpgsql volatile security invoker set search_path='' as $hour$
declare c record;v_from timestamp;v_to timestamp;v_count bigint;v_missing bigint;v_extra bigint;v_bad bigint;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar91_hour_proof_actor_snapshot_invalid';end if;
 select * into c from pg_temp.ar91_hour_proof_context where singleton;
 if not found or clock_timestamp()-c.started_at>=interval '120 seconds' then raise exception 'ar91_hour_proof_deadline';end if;
 if p_hour is null or p_hour not between 0 and 23 then raise exception 'ar91_hour_proof_hour_invalid';end if;
 if exists(select 1 from pg_temp.ar91_hour_proof_parts where hour=p_hour)then raise exception 'ar91_hour_proof_hour_repeated';end if;
 v_from:=c.data_date::timestamp+p_hour*interval '1 hour';v_to:=v_from+interval '1 hour';
 with expected as materialized(select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform='91CLUB' and a.order_kind='recharge' and (a.applied_at>=v_from and a.applied_at<v_to) union all select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform='91CLUB' and a.order_kind='recharge' and a.status='已支付' and a.completed_at>=v_from and a.completed_at<v_to and (a.applied_at>=c.data_date::timestamp and a.applied_at<(c.data_date+1)::timestamp) is not true),actual as materialized(select f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local,f.currency_local,f.money_issue_code,f.amount from private.ar_91club_submission_facts f where (f.applied_at>=v_from and f.applied_at<v_to) union all select f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local,f.currency_local,f.money_issue_code,f.amount from private.ar_91club_submission_facts f where f.status='已支付' and f.completed_at>=v_from and f.completed_at<v_to and (f.applied_at>=c.data_date::timestamp and f.applied_at<(c.data_date+1)::timestamp) is not true)

 select count(a.order_no),count(*)filter(where a.order_no is not null and f.order_no is null),count(*)filter(where a.order_no is null and f.order_no is not null),count(*)filter(where a.order_no is not null and f.order_no is not null and row(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local::text,a.currency_local,a.money_issue_code,a.amount::text) is distinct from row(f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local::text,f.currency_local,f.money_issue_code,f.amount::text))
 into v_count,v_missing,v_extra,v_bad from expected a full join actual f using(source_system,country_code,platform,order_kind,order_no);
 if v_missing<>0 or v_extra<>0 or v_bad<>0 then raise exception 'ar91_hour_proof_parity_failed' using detail=format('hour=%s missing=%s extra=%s changed=%s',p_hour,v_missing,v_extra,v_bad);end if;
 if clock_timestamp()-c.started_at>=interval '120 seconds' then raise exception 'ar91_hour_proof_deadline';end if;
 insert into pg_temp.ar91_hour_proof_parts values(p_hour,v_from,v_to,v_count,v_missing,v_extra,v_bad);
 return jsonb_build_object('hour',p_hour,'sourceCount',v_count,'verified',true);
end;$hour$;
revoke all on function pg_temp.ar91_verify_hour(integer)from public,anon,authenticated,service_role;
create function pg_temp.ar91_finish_hourly_day()returns jsonb language plpgsql volatile security invoker set search_path='' as $finish$
declare c record;g text;m jsonb;n bigint;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar91_hour_proof_actor_snapshot_invalid';end if;
 select * into c from pg_temp.ar91_hour_proof_context where singleton;
 if not found or clock_timestamp()-c.started_at>=interval '120 seconds' then raise exception 'ar91_hour_proof_deadline';end if;
 if(select count(*)from pg_temp.ar91_hour_proof_parts)<>24 or exists(select 1 from generate_series(0,23)h left join pg_temp.ar91_hour_proof_parts p on p.hour=h where p.hour is null or p.interval_start is distinct from c.data_date::timestamp+h*interval '1 hour' or p.interval_end is distinct from c.data_date::timestamp+(h+1)*interval '1 hour' or p.missing_count<>0 or p.extra_count<>0 or p.changed_count<>0)then raise exception 'ar91_hour_proof_parts_incomplete_or_invalid';end if;
 g:=private.ar_91club_submission_generation();
 select jsonb_agg(jsonb_build_array(p.oid,p.xmin::text,to_jsonb(p))order by p.oid)into m from pg_proc p where p.oid=any(array['private.ar_91club_submission_generation()'::regprocedure,'private.approve_ar_91club_submission_day(date)'::regprocedure,'private.approve_ar_91club_submission_null()'::regprocedure,'private.approve_ar_91club_submission_future()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure,'private.sync_ar_91club_submission_fact()'::regprocedure,'private.invalidate_ar_91club_submission_ready()'::regprocedure]);
 if g is null or g is distinct from c.generation or m is distinct from c.metadata then raise exception 'ar91_hour_proof_generation_metadata_changed';end if;
 select sum(source_count)into n from pg_temp.ar91_hour_proof_parts;
 insert into private.ar_91club_submission_ready values(c.data_date,g,n,clock_timestamp())on conflict(data_date)do update set generation=excluded.generation,source_count=excluded.source_count,validated_at=excluded.validated_at;
 if clock_timestamp()-c.started_at>=interval '120 seconds' then raise exception 'ar91_hour_proof_deadline';end if;
 return jsonb_build_object('approved',true,'day',c.data_date,'sourceCount',n,'parts',24,'generation',g);
end;$finish$;
revoke all on function pg_temp.ar91_finish_hourly_day()from public,anon,authenticated,service_role;
-- Independent statements, not one loop statement with a shared 5s deadline.
select pg_temp.ar91_verify_hour(0) as verified_part_00;
select pg_temp.ar91_verify_hour(1) as verified_part_01;
select pg_temp.ar91_verify_hour(2) as verified_part_02;
select pg_temp.ar91_verify_hour(3) as verified_part_03;
select pg_temp.ar91_verify_hour(4) as verified_part_04;
select pg_temp.ar91_verify_hour(5) as verified_part_05;
select pg_temp.ar91_verify_hour(6) as verified_part_06;
select pg_temp.ar91_verify_hour(7) as verified_part_07;
select pg_temp.ar91_verify_hour(8) as verified_part_08;
select pg_temp.ar91_verify_hour(9) as verified_part_09;
select pg_temp.ar91_verify_hour(10) as verified_part_10;
select pg_temp.ar91_verify_hour(11) as verified_part_11;
select pg_temp.ar91_verify_hour(12) as verified_part_12;
select pg_temp.ar91_verify_hour(13) as verified_part_13;
select pg_temp.ar91_verify_hour(14) as verified_part_14;
select pg_temp.ar91_verify_hour(15) as verified_part_15;
select pg_temp.ar91_verify_hour(16) as verified_part_16;
select pg_temp.ar91_verify_hour(17) as verified_part_17;
select pg_temp.ar91_verify_hour(18) as verified_part_18;
select pg_temp.ar91_verify_hour(19) as verified_part_19;
select pg_temp.ar91_verify_hour(20) as verified_part_20;
select pg_temp.ar91_verify_hour(21) as verified_part_21;
select pg_temp.ar91_verify_hour(22) as verified_part_22;
select pg_temp.ar91_verify_hour(23) as verified_part_23;
select pg_temp.ar91_finish_hourly_day()as proof;
drop function pg_temp.ar91_verify_hour(integer);
drop function pg_temp.ar91_finish_hourly_day();
commit;
