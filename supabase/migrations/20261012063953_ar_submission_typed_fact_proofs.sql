-- Only install owner-only proof entrypoints; no source/fact scans, no receipt
-- approval, backfill or reader cutover. Existing 91CLUB is untouched.
-- Each maintenance statement remains3s/lock1s. A24-hour proof requires ONE RR
-- transaction with24 separately-budgeted statements and120s TOTAL cap, used only
-- when expressly scheduled. This installation does not run such a proof.
begin;set local statement_timeout='3s';set local lock_timeout='1s';
do $install_proofs$
declare f record;spec record;existing integer:=0;g text;after_g text;before_main jsonb;after_main jsonb;
begin
 if current_user<>'postgres'then raise exception 'AR_SUB_PROOF_INSTALL_ACTOR_INVALID';end if;
 if to_regclass('private.ar_submission_typed_facts')is null then raise exception 'AR_SUB_PROOF_PREREQUISITE_MISSING';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_submission_typed_facts in share update exclusive mode nowait;
 perform 1 from private.ar_submission_fact_epoch where country_code='IN'and platform='OKWIN'for share;
 if not found then raise exception 'AR_SUB_PROOF_PREREQUISITE_EPOCH_MISSING';end if;
 for spec in select * from(values ('private.ar_submission_fact_scope(text,text)','61c447ed031f0d8c33b47ddf66051b0c',false,'i','s','sql','boolean','p_country text, p_platform text',0),
('private.guard_ar_submission_fact_write()','8a90ea2fb278583a37521fdc4de62765',false,'v','u','plpgsql','trigger','',0),
('private.guard_ar_submission_control_write()','b1a2d97a0272b6ba467db48cbaea005b',false,'v','u','plpgsql','trigger','',0),
('private.sync_ar_submission_typed_fact()','1f5f943b13f0cc4e843d0816baceefda',true,'v','u','plpgsql','trigger','',0),
('private.invalidate_ar_submission_fact_ready()','d3389ac2ed6bd9c6e357626c209b125c',true,'v','u','plpgsql','trigger','',0),
('private.ar_submission_fact_layout()','3e82491cdff83a6d98c9bf45abeb0ebd',false,'s','u','sql','jsonb','',0),
('private.ar_submission_fact_generation(text,text)','44e726b77cdbb15c8db7b0af81346a1b',false,'s','u','plpgsql','text','p_country text, p_platform text',0),
('private.ar_submission_fact_can_read(text,text,date,date)','59b1aaad5881647d9fb90dbb0074548d',false,'s','u','plpgsql','boolean','p_country text, p_platform text, p_from date, p_to date',0),
('private.backfill_ar_submission_fact(text,text,text,timestamp,timestamp,integer)','df7dd3ca8d84d01993d400359ed600e2',false,'v','u','plpgsql','bigint','p_country text, p_platform text, p_stream text, p_from timestamp without time zone, p_to timestamp without time zone, p_limit integer DEFAULT 1000',1))v(signature,hash,definer,volatility,parallel,language,result,arguments,defaults)loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
  if not found or md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef<>spec.definer or f.provolatile<>spec.volatility::"char"or f.proparallel<>spec.parallel::"char"or f.lanname<>spec.language or f.prorettype<>spec.result::regtype or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f'or f.pronargdefaults<>spec.defaults or f.provariadic<>0 or pg_get_function_arguments(f.oid)<>spec.arguments or f.proconfig is distinct from array['search_path=""']::text[]or f.proacl::text is distinct from '{postgres=X/postgres}'then raise exception 'AR_SUB_PROOF_PREREQUISITE_FUNCTION_DRIFT';end if;
 end loop;
 g:=private.ar_submission_fact_generation('IN','OKWIN');if g is null then raise exception 'AR_SUB_PROOF_PREREQUISITE_LAYOUT_DRIFT';end if;
 if exists(select 1 from pg_proc p where p.pronamespace='private'::regnamespace and p.proname=any(array['begin_ar_submission_fact_day','verify_ar_submission_fact_hour','approve_ar_submission_fact_day','approve_ar_submission_fact_null','approve_ar_submission_fact_future'])and not exists(select 1 from unnest(array[to_regprocedure('private.begin_ar_submission_fact_day(text,text,date)'),to_regprocedure('private.verify_ar_submission_fact_hour(text,text,date,integer)'),to_regprocedure('private.approve_ar_submission_fact_day(text,text,date)'),to_regprocedure('private.approve_ar_submission_fact_null(text,text)'),to_regprocedure('private.approve_ar_submission_fact_future(text,text)')])k(signature)where k.signature::oid=p.oid))then raise exception 'AR_SUB_PROOF_OVERLOAD_COLLISION';end if;
 select to_jsonb(p)into before_main from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 for spec in select * from(values ('private.begin_ar_submission_fact_day(text,text,date)','7a2baa8012a3e2edcb424acb6375f8ab','p_country text, p_platform text, p_day date'),
('private.verify_ar_submission_fact_hour(text,text,date,integer)','62bf1bacee2360de92e3576c96a5ab4b','p_country text, p_platform text, p_day date, p_hour integer'),
('private.approve_ar_submission_fact_day(text,text,date)','679ae551474718821cd1ee499775aff4','p_country text, p_platform text, p_day date'),
('private.approve_ar_submission_fact_null(text,text)','e6609f1152ecbb5e13e81e29e5d72958','p_country text, p_platform text'),
('private.approve_ar_submission_fact_future(text,text)','8cd45c0acae3b2ed96d489da8c4fb754','p_country text, p_platform text'))v(signature,hash,arguments)loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
  if found then
   existing:=existing+1;
   if md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>'v' or f.proparallel<>'u' or f.lanname<>'plpgsql' or f.prorettype<>'jsonb'::regtype or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f' or f.pronargdefaults<>0 or f.provariadic<>0 or f.procost<>100 or f.prorows<>0 or pg_get_function_arguments(f.oid)<>spec.arguments or f.proconfig is distinct from array['search_path=""']::text[] or f.proacl::text is distinct from '{postgres=X/postgres}'then raise exception 'AR_SUB_PROOF_FUNCTION_DRIFT';end if;
  end if;
 end loop;
 if existing not in(0,5)then raise exception 'AR_SUB_PROOF_PARTIAL_INSTALL';end if;
 if existing=0 then execute $newobjects$
-- LOCAL proof core; stage integration/metadata guards are owned separately.
-- No source facts are changed. Invoke only as postgres in ONE explicit RR txn.
-- SET LOCAL statement_timeout='3s'; lock_timeout='1s'; total day deadline120s.
-- Day calls are BEGIN, 24 separate SELECT verify_hour statements, then APPROVE.
-- Do not wrap the 24 calls in a DO/function loop with a shared statement budget.
-- Per-day receipt proves parity of received native rows, NOT upstream completeness.
-- Concurrency safety relies on installed atomic source sync and direct-fact epoch
-- invalidation. The tests below use one PGlite connection, not multi-connection IO.

create or replace function private.begin_ar_submission_fact_day(p_country text,p_platform text,p_day date)returns jsonb language plpgsql volatile security invoker set search_path='' as $proof$
declare g text;v_epoch bigint;m jsonb;v_started timestamptz:=clock_timestamp();
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar_submission_proof_actor_snapshot_invalid';end if;
 if private.ar_submission_fact_scope(p_country,p_platform) is distinct from true then raise exception 'ar_submission_proof_scope_invalid';end if;
 if p_day is null or not isfinite(p_day) or p_day<date '2026-10-10' then raise exception 'ar_submission_proof_day_invalid';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_submission_typed_facts in share update exclusive mode nowait;
 select epoch into v_epoch from private.ar_submission_fact_epoch where country_code=p_country and platform=p_platform for share;
 if not found then raise exception 'ar_submission_proof_epoch_missing';end if;
 g:=private.ar_submission_fact_generation(p_country,p_platform);if g is null or g!~'^[0-9a-f]{32}$'then raise exception 'ar_submission_proof_generation_invalid';end if;
 if to_regclass('pg_temp.ar_submission_proof_context')is not null then raise exception 'ar_submission_proof_already_started';end if;
 create temporary table ar_submission_proof_context(singleton boolean primary key check(singleton),country_code text not null,platform text not null,data_date date not null,generation text not null,epoch bigint not null,started_at timestamptz not null,metadata jsonb not null)on commit drop;
 create temporary table ar_submission_proof_parts(hour integer primary key check(hour between 0 and 23),interval_start timestamp not null,interval_end timestamp not null,source_count bigint not null check(source_count>=0),missing_count bigint not null check(missing_count>=0),extra_count bigint not null check(extra_count>=0),changed_count bigint not null check(changed_count>=0))on commit drop;
 select q.m into m from(select jsonb_agg(jsonb_build_array(p.oid,p.xmin::text,to_jsonb(p))order by p.oid) as m from pg_catalog.pg_proc p where p.oid=any(array['private.begin_ar_submission_fact_day(text,text,date)'::regprocedure,'private.verify_ar_submission_fact_hour(text,text,date,integer)'::regprocedure,'private.approve_ar_submission_fact_day(text,text,date)'::regprocedure,'private.approve_ar_submission_fact_null(text,text)'::regprocedure,'private.approve_ar_submission_fact_future(text,text)'::regprocedure]))q;
 insert into pg_temp.ar_submission_proof_context values(true,p_country,p_platform,p_day,g,v_epoch,v_started,m);
 return jsonb_build_object('started',true,'country',p_country,'platform',p_platform,'day',p_day,'generation',g);
end;$proof$;
revoke all on function private.begin_ar_submission_fact_day(text,text,date)from public,anon,authenticated,service_role;

create or replace function private.verify_ar_submission_fact_hour(p_country text,p_platform text,p_day date,p_hour integer)returns jsonb language plpgsql volatile security invoker set search_path='' as $proof$
declare c record;v_from timestamp;v_to timestamp;v_count bigint;v_missing bigint;v_extra bigint;v_bad bigint;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar_submission_proof_actor_snapshot_invalid';end if;
 if private.ar_submission_fact_scope(p_country,p_platform) is distinct from true then raise exception 'ar_submission_proof_scope_invalid';end if;
 if p_day is null or not isfinite(p_day) or p_day<date '2026-10-10' then raise exception 'ar_submission_proof_day_invalid';end if;
 select * into c from pg_temp.ar_submission_proof_context where singleton;
 if not found or c.country_code is distinct from p_country or c.platform is distinct from p_platform or c.data_date is distinct from p_day then raise exception 'ar_submission_proof_context_invalid';end if;
 if clock_timestamp()-c.started_at>=interval '120 seconds' then raise exception 'ar_submission_proof_deadline';end if;
 if p_hour is null or p_hour not between 0 and 23 then raise exception 'ar_submission_proof_hour_invalid';end if;
 if exists(select 1 from pg_temp.ar_submission_proof_parts where hour=p_hour)then raise exception 'ar_submission_proof_hour_repeated';end if;
 v_from:=p_day::timestamp+p_hour*interval '1 hour';v_to:=v_from+interval '1 hour';
 with expected as materialized(select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount from public.ar_collected_orders a where a.source_system='AR' and a.country_code=p_country and a.platform=p_platform and a.order_kind='recharge' and a.applied_at>=v_from and a.applied_at<v_to union all select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount from public.ar_collected_orders a where a.source_system='AR' and a.country_code=p_country and a.platform=p_platform and a.order_kind='recharge' and a.status='已支付' and a.completed_at>=v_from and a.completed_at<v_to and(a.applied_at>=p_day::timestamp and a.applied_at<(p_day+1)::timestamp)is not true),actual as materialized(select f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local,f.currency_local,f.money_issue_code,f.amount from private.ar_submission_typed_facts f where f.source_system='AR' and f.country_code=p_country and f.platform=p_platform and f.order_kind='recharge' and f.applied_at>=v_from and f.applied_at<v_to union all select f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local,f.currency_local,f.money_issue_code,f.amount from private.ar_submission_typed_facts f where f.source_system='AR' and f.country_code=p_country and f.platform=p_platform and f.order_kind='recharge' and f.status='已支付' and f.completed_at>=v_from and f.completed_at<v_to and(f.applied_at>=p_day::timestamp and f.applied_at<(p_day+1)::timestamp)is not true)
 select count(a.order_no),count(*)filter(where a.order_no is not null and f.order_no is null),count(*)filter(where a.order_no is null and f.order_no is not null),count(*)filter(where a.order_no is not null and f.order_no is not null and row(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local::text,a.currency_local,a.money_issue_code,a.amount::text)is distinct from row(f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local::text,f.currency_local,f.money_issue_code,f.amount::text)) into v_count,v_missing,v_extra,v_bad from expected a full join actual f using(source_system,country_code,platform,order_kind,order_no);
 if v_missing<>0 or v_extra<>0 or v_bad<>0 then raise exception 'ar_submission_proof_parity_failed' using detail=format('missing=%s extra=%s changed=%s',v_missing,v_extra,v_bad);end if;
 if clock_timestamp()-c.started_at>=interval '120 seconds' then raise exception 'ar_submission_proof_deadline';end if;
 insert into pg_temp.ar_submission_proof_parts values(p_hour,v_from,v_to,v_count,v_missing,v_extra,v_bad);
 return jsonb_build_object('verified',true,'hour',p_hour,'sourceCount',v_count);
end;$proof$;
revoke all on function private.verify_ar_submission_fact_hour(text,text,date,integer)from public,anon,authenticated,service_role;

create or replace function private.approve_ar_submission_fact_day(p_country text,p_platform text,p_day date)returns jsonb language plpgsql volatile security invoker set search_path='' as $proof$
declare c record;g text;m jsonb;n bigint;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar_submission_proof_actor_snapshot_invalid';end if;
 if private.ar_submission_fact_scope(p_country,p_platform) is distinct from true then raise exception 'ar_submission_proof_scope_invalid';end if;
 if p_day is null or not isfinite(p_day) or p_day<date '2026-10-10' then raise exception 'ar_submission_proof_day_invalid';end if;
 select * into c from pg_temp.ar_submission_proof_context where singleton;
 if not found or c.country_code is distinct from p_country or c.platform is distinct from p_platform or c.data_date is distinct from p_day then raise exception 'ar_submission_proof_context_invalid';end if;
 if clock_timestamp()-c.started_at>=interval '120 seconds' then raise exception 'ar_submission_proof_deadline';end if;
 if(select count(*)from pg_temp.ar_submission_proof_parts)<>24 or exists(select 1 from generate_series(0,23)h left join pg_temp.ar_submission_proof_parts p on p.hour=h where p.hour is null or p.interval_start is distinct from p_day::timestamp+h*interval '1 hour' or p.interval_end is distinct from p_day::timestamp+(h+1)*interval '1 hour' or p.missing_count<>0 or p.extra_count<>0 or p.changed_count<>0)then raise exception 'ar_submission_proof_parts_incomplete_or_invalid';end if;
 g:=private.ar_submission_fact_generation(p_country,p_platform);
 select q.m into m from(select jsonb_agg(jsonb_build_array(p.oid,p.xmin::text,to_jsonb(p))order by p.oid) as m from pg_catalog.pg_proc p where p.oid=any(array['private.begin_ar_submission_fact_day(text,text,date)'::regprocedure,'private.verify_ar_submission_fact_hour(text,text,date,integer)'::regprocedure,'private.approve_ar_submission_fact_day(text,text,date)'::regprocedure,'private.approve_ar_submission_fact_null(text,text)'::regprocedure,'private.approve_ar_submission_fact_future(text,text)'::regprocedure]))q;
 if g is null or g is distinct from c.generation or(select epoch from private.ar_submission_fact_epoch where country_code=p_country and platform=p_platform)is distinct from c.epoch or m is distinct from c.metadata then raise exception 'ar_submission_proof_generation_metadata_changed';end if;
 select sum(source_count)into n from pg_temp.ar_submission_proof_parts;
 insert into private.ar_submission_day_ready(country_code,platform,data_date,generation,source_count,validated_at)values(p_country,p_platform,p_day,g,n,clock_timestamp())on conflict(country_code,platform,data_date)do update set generation=excluded.generation,source_count=excluded.source_count,validated_at=excluded.validated_at;
 if clock_timestamp()-c.started_at>=interval '120 seconds' then raise exception 'ar_submission_proof_deadline';end if;
 return jsonb_build_object('approved',true,'country',p_country,'platform',p_platform,'day',p_day,'sourceCount',n,'parts',24,'generation',g);
end;$proof$;
revoke all on function private.approve_ar_submission_fact_day(text,text,date)from public,anon,authenticated,service_role;

create or replace function private.approve_ar_submission_fact_null(p_country text,p_platform text)returns jsonb language plpgsql volatile security invoker set search_path='' as $proof$
declare g text;v_epoch bigint;v_count bigint;v_missing bigint;v_extra bigint;v_bad bigint;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar_submission_proof_actor_snapshot_invalid';end if;
 if private.ar_submission_fact_scope(p_country,p_platform) is distinct from true then raise exception 'ar_submission_proof_scope_invalid';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_submission_typed_facts in share update exclusive mode nowait;
 select epoch into v_epoch from private.ar_submission_fact_epoch where country_code=p_country and platform=p_platform for share;
 if not found then raise exception 'ar_submission_proof_epoch_missing';end if;
 g:=private.ar_submission_fact_generation(p_country,p_platform);if g is null or g!~'^[0-9a-f]{32}$'then raise exception 'ar_submission_proof_generation_invalid';end if;
 with expected as materialized(select a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount from public.ar_collected_orders a where a.source_system='AR' and a.country_code=p_country and a.platform=p_platform and a.order_kind='recharge' and a.applied_at is null),actual as materialized(select f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local,f.currency_local,f.money_issue_code,f.amount from private.ar_submission_typed_facts f where f.source_system='AR' and f.country_code=p_country and f.platform=p_platform and f.order_kind='recharge' and f.applied_at is null)
 select count(a.order_no),count(*)filter(where a.order_no is not null and f.order_no is null),count(*)filter(where a.order_no is null and f.order_no is not null),count(*)filter(where a.order_no is not null and f.order_no is not null and row(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at,a.completed_at,a.member_id,a.status,a.raw_channel,a.member_level,a.recharge_count,a.channel_type,a.money_format_version,a.amount_local::text,a.currency_local,a.money_issue_code,a.amount::text)is distinct from row(f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at,f.completed_at,f.member_id,f.status,f.raw_channel,f.member_level,f.recharge_count,f.channel_type,f.money_format_version,f.amount_local::text,f.currency_local,f.money_issue_code,f.amount::text)) into v_count,v_missing,v_extra,v_bad from expected a full join actual f using(source_system,country_code,platform,order_kind,order_no);
 if v_missing<>0 or v_extra<>0 or v_bad<>0 then raise exception 'ar_submission_proof_parity_failed' using detail=format('missing=%s extra=%s changed=%s',v_missing,v_extra,v_bad);end if;
 if private.ar_submission_fact_generation(p_country,p_platform)is distinct from g or(select epoch from private.ar_submission_fact_epoch where country_code=p_country and platform=p_platform)is distinct from v_epoch then raise exception 'ar_submission_proof_generation_changed';end if;
 insert into private.ar_submission_null_ready(country_code,platform,generation,source_count,validated_at)values(p_country,p_platform,g,v_count,clock_timestamp())on conflict(country_code,platform)do update set generation=excluded.generation,source_count=excluded.source_count,validated_at=excluded.validated_at;
 return jsonb_build_object('approved',true,'country',p_country,'platform',p_platform,'sourceCount',v_count,'generation',g);
end;$proof$;
revoke all on function private.approve_ar_submission_fact_null(text,text)from public,anon,authenticated,service_role;

create or replace function private.approve_ar_submission_fact_future(p_country text,p_platform text)returns jsonb language plpgsql volatile security invoker set search_path='' as $proof$
declare g text;v_epoch bigint;v_from date;v_applied timestamp;v_completed timestamp;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'repeatable read' then raise exception 'ar_submission_proof_actor_snapshot_invalid';end if;
 if private.ar_submission_fact_scope(p_country,p_platform) is distinct from true then raise exception 'ar_submission_proof_scope_invalid';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_submission_typed_facts in share update exclusive mode nowait;
 select epoch into v_epoch from private.ar_submission_fact_epoch where country_code=p_country and platform=p_platform for share;
 if not found then raise exception 'ar_submission_proof_epoch_missing';end if;
 g:=private.ar_submission_fact_generation(p_country,p_platform);if g is null or g!~'^[0-9a-f]{32}$'then raise exception 'ar_submission_proof_generation_invalid';end if;
 select a.applied_at into v_applied from public.ar_collected_orders a where a.source_system='AR' and a.country_code=p_country and a.platform=p_platform and a.order_kind='recharge' and a.applied_at>=timestamp '2026-10-10' and isfinite(a.applied_at)order by a.applied_at desc limit 1;
 select a.completed_at into v_completed from public.ar_collected_orders a where a.source_system='AR' and a.country_code=p_country and a.platform=p_platform and a.order_kind='recharge' and a.status='已支付' and a.completed_at>=timestamp '2026-10-10' and isfinite(a.completed_at)order by a.completed_at desc limit 1;
 v_from:=coalesce(greatest(v_applied,v_completed)::date+1,date '2026-10-10');
 if not isfinite(v_from)or exists(select 1 from private.ar_submission_typed_facts f where f.source_system='AR' and f.country_code=p_country and f.platform=p_platform and f.order_kind='recharge' and((isfinite(f.applied_at)and f.applied_at>=v_from::timestamp)or(f.status='已支付'and isfinite(f.completed_at)and f.completed_at>=v_from::timestamp)))then raise exception 'ar_submission_proof_future_not_empty';end if;
 if private.ar_submission_fact_generation(p_country,p_platform)is distinct from g or(select epoch from private.ar_submission_fact_epoch where country_code=p_country and platform=p_platform)is distinct from v_epoch then raise exception 'ar_submission_proof_generation_changed';end if;
 insert into private.ar_submission_future_ready(country_code,platform,future_from,generation,validated_at)values(p_country,p_platform,v_from,g,clock_timestamp())on conflict(country_code,platform)do update set future_from=excluded.future_from,generation=excluded.generation,validated_at=excluded.validated_at;
 return jsonb_build_object('approved',true,'country',p_country,'platform',p_platform,'futureFrom',v_from,'generation',g);
end;$proof$;
revoke all on function private.approve_ar_submission_fact_future(text,text)from public,anon,authenticated,service_role;

$newobjects$;end if;
 existing:=0;
 for spec in select * from(values ('private.begin_ar_submission_fact_day(text,text,date)','7a2baa8012a3e2edcb424acb6375f8ab','p_country text, p_platform text, p_day date'),
('private.verify_ar_submission_fact_hour(text,text,date,integer)','62bf1bacee2360de92e3576c96a5ab4b','p_country text, p_platform text, p_day date, p_hour integer'),
('private.approve_ar_submission_fact_day(text,text,date)','679ae551474718821cd1ee499775aff4','p_country text, p_platform text, p_day date'),
('private.approve_ar_submission_fact_null(text,text)','e6609f1152ecbb5e13e81e29e5d72958','p_country text, p_platform text'),
('private.approve_ar_submission_fact_future(text,text)','8cd45c0acae3b2ed96d489da8c4fb754','p_country text, p_platform text'))v(signature,hash,arguments)loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
  if found then
   existing:=existing+1;
   if md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>'v' or f.proparallel<>'u' or f.lanname<>'plpgsql' or f.prorettype<>'jsonb'::regtype or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f' or f.pronargdefaults<>0 or f.provariadic<>0 or f.procost<>100 or f.prorows<>0 or pg_get_function_arguments(f.oid)<>spec.arguments or f.proconfig is distinct from array['search_path=""']::text[] or f.proacl::text is distinct from '{postgres=X/postgres}'then raise exception 'AR_SUB_PROOF_FUNCTION_DRIFT';end if;
  end if;
 end loop;
 if existing<>5 then raise exception 'AR_SUB_PROOF_POSTINSTALL_MISSING';end if;
 after_g:=private.ar_submission_fact_generation('IN','OKWIN');
 select to_jsonb(p)into after_main from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if after_g is distinct from g or after_main is distinct from before_main then raise exception 'AR_SUB_PROOF_POSTINSTALL_GENERATION_READER_CHANGED';end if;
end;$install_proofs$;
commit;
