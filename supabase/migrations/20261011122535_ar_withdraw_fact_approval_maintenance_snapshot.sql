-- Owner-only maintenance approval. Do not modify source/fact rows or existing approvals.
-- READ COMMITTED gives the parity SQL a fresh snapshot after the SHARE NOWAIT
-- lock. A RR snapshot taken before acquiring this lock can hide a direct cleanup.
-- Source+fact parity remains one SQL statement; ordinary source/cache commits are
-- atomic. SHARE prevents direct fact writes during proof/registration, briefly
-- blocking source-trigger writes. No waiting on an already active writer.
begin;
set local lock_timeout='2s';set local statement_timeout='20s';
do $patch_approve_ar_withdraw_fact_day$
declare p record;v_before jsonb;v_after jsonb;v_definition text;v_body text;
begin
 select * into p from pg_proc where oid='private.approve_ar_withdraw_fact_day(text,date)'::regprocedure;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.provolatile<>'v' or p.prosecdef or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  or pg_get_function_arguments(p.oid)<>'p_platform text, p_day date' or pg_get_function_result(p.oid)<>'jsonb' or md5(p.prosrc) not in('0dc75b2ca94f1e4104d202b31e53fe6b','8d2f3cf8d5c61e141c8484c854e3eb97')
  then raise exception 'ar_withdraw_approval_snapshot_metadata_drift';end if;
 v_before:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)='0dc75b2ca94f1e4104d202b31e53fe6b' then
  if (length(p.prosrc)-length(replace(p.prosrc,$approve_ar_withdraw_fact_day_old$
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
$approve_ar_withdraw_fact_day_old$,'')))/length($approve_ar_withdraw_fact_day_old$
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
$approve_ar_withdraw_fact_day_old$)<>1 then raise exception 'ar_withdraw_approval_snapshot_anchor_drift';end if;
  v_body:=replace(p.prosrc,$approve_ar_withdraw_fact_day_old$
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
$approve_ar_withdraw_fact_day_old$,$approve_ar_withdraw_fact_day_new$
declare v_generation text;v_source_count bigint;v_missing bigint;v_extra bigint;v_bad bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_withdraw_ready_requires_read_committed';end if;
 if p_platform is null or p_platform='' or p_day is null or not isfinite(p_day) or p_day<date '2026-10-10' then raise exception 'ar_withdraw_ready_partition_invalid';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_withdraw_facts in share mode nowait;
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
$approve_ar_withdraw_fact_day_new$);
  if md5(v_body)<>'8d2f3cf8d5c61e141c8484c854e3eb97' then raise exception 'ar_withdraw_approval_snapshot_afterhash_mismatch';end if;
  v_definition:=pg_get_functiondef(p.oid);execute replace(v_definition,p.prosrc,v_body);
 end if;
 select to_jsonb(t)-'prosrc' into v_after from pg_proc t where t.oid=p.oid;
 if v_after is distinct from v_before or (select md5(prosrc) from pg_proc where oid=p.oid)<>'8d2f3cf8d5c61e141c8484c854e3eb97' then raise exception 'ar_withdraw_approval_snapshot_post_metadata_drift';end if;
end;$patch_approve_ar_withdraw_fact_day$;
do $patch_approve_ar_withdraw_fact_future$
declare p record;v_before jsonb;v_after jsonb;v_definition text;v_body text;
begin
 select * into p from pg_proc where oid='private.approve_ar_withdraw_fact_future(text)'::regprocedure;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.provolatile<>'v' or p.prosecdef or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  or pg_get_function_arguments(p.oid)<>'p_platform text' or pg_get_function_result(p.oid)<>'jsonb' or md5(p.prosrc) not in('31423c8a867aee054ab2e1bbc4e7b2f3','08df778fb7144aa12c58f3876f73adf3')
  then raise exception 'ar_withdraw_approval_snapshot_metadata_drift';end if;
 v_before:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)='31423c8a867aee054ab2e1bbc4e7b2f3' then
  if (length(p.prosrc)-length(replace(p.prosrc,$approve_ar_withdraw_fact_future_old$
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
$approve_ar_withdraw_fact_future_old$,'')))/length($approve_ar_withdraw_fact_future_old$
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
$approve_ar_withdraw_fact_future_old$)<>1 then raise exception 'ar_withdraw_approval_snapshot_anchor_drift';end if;
  v_body:=replace(p.prosrc,$approve_ar_withdraw_fact_future_old$
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
$approve_ar_withdraw_fact_future_old$,$approve_ar_withdraw_fact_future_new$
declare v_generation text;v_last timestamp;v_from date;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_withdraw_ready_requires_read_committed';end if;
 if p_platform is null or p_platform='' then raise exception 'ar_withdraw_ready_partition_invalid';end if;
 lock table public.ar_collected_orders in share update exclusive mode nowait;
 lock table private.ar_withdraw_facts in share mode nowait;
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
$approve_ar_withdraw_fact_future_new$);
  if md5(v_body)<>'08df778fb7144aa12c58f3876f73adf3' then raise exception 'ar_withdraw_approval_snapshot_afterhash_mismatch';end if;
  v_definition:=pg_get_functiondef(p.oid);execute replace(v_definition,p.prosrc,v_body);
 end if;
 select to_jsonb(t)-'prosrc' into v_after from pg_proc t where t.oid=p.oid;
 if v_after is distinct from v_before or (select md5(prosrc) from pg_proc where oid=p.oid)<>'08df778fb7144aa12c58f3876f73adf3' then raise exception 'ar_withdraw_approval_snapshot_post_metadata_drift';end if;
end;$patch_approve_ar_withdraw_fact_future$;
commit;
