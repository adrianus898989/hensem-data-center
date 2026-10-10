-- YASH native submission analysis with dual-stream completeness proof.
-- Applied after submission_member_order_details; no order storage or grants change.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Proof is limited to a closed native YASH calendar day. Both receipt streams
-- must form a gap-free range and still match the current collected order table.
create or replace function private.dashboard_admin_yash_submission_coverage(p_day date)
returns jsonb language sql stable set search_path='' as $helper$
 with bounds as (
  select p_day::timestamp at time zone 'Asia/Kolkata' start_at,(p_day+1)::timestamp at time zone 'Asia/Kolkata' end_at
 ), verified as materialized (
  select w.stream,tstzrange(w.start_at,w.end_exclusive,'[)') span from private.yash_sync_windows w cross join bounds b
  where w.order_type='deposit' and w.stream in ('createTime','completeTime') and w.complete
   and w.source_count=w.uploaded_count and w.uploaded_count=w.stored_count and w.source_count>=0
   and isfinite(w.start_at) and isfinite(w.end_exclusive) and isfinite(w.observed_at)
   and w.start_at<w.end_exclusive and w.end_exclusive<=w.observed_at and w.observed_at<=statement_timestamp()
   and w.start_at<b.end_at and w.end_exclusive>b.start_at
   and w.stored_count=case when w.stream='createTime' then
    (select count(*) from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and y.created_at>=w.start_at and y.created_at<w.end_exclusive)
    else (select count(*) from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and y.completed_at>=w.start_at and y.completed_at<w.end_exclusive) end
 ), streams as (
  select s.stream,coalesce(range_agg(v.span) @> tstzrange(b.start_at,b.end_at,'[)'),false)
   and b.end_at<=statement_timestamp() as complete
  from bounds b cross join (values('createTime'),('completeTime'))s(stream) left join verified v using(stream)
  group by s.stream,b.start_at,b.end_at
 ), day_rows as materialized (
  select y.order_no,y.uid,y.status,y.created_at,y.completed_at from private.yash_orders y cross join bounds b
   where y.source_site='yash' and y.order_type='deposit' and y.created_at>=b.start_at and y.created_at<b.end_at
  union
  select y.order_no,y.uid,y.status,y.created_at,y.completed_at from private.yash_orders y cross join bounds b
   where y.source_site='yash' and y.order_type='deposit' and y.completed_at>=b.start_at and y.completed_at<b.end_at
 ), quality as (
  select count(*) filter(where nullif(btrim(uid),'') is null) missing_member_count,
   count(*) filter(where private.dashboard_admin_yash_status('deposit',status)='unknown') unknown_status_count,
   count(*) filter(where created_at is null or not isfinite(created_at) or nullif(btrim(order_no),'') is null)
    +count(*)-count(distinct order_no) uncertain_sequence_count,
   (select count(*) from private.yash_orders y cross join bounds b where y.source_site='yash' and y.order_type='deposit'
    and private.dashboard_admin_yash_status('deposit',y.status)='success' and (y.created_at<b.end_at or y.created_at is null)
    and private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is null) missing_success_time_count
  from day_rows
 ), proof as (select bool_and(complete) complete from streams)
 select jsonb_build_object('day',p_day,'createTimeComplete',(select complete from streams where stream='createTime'),
  'completeTimeComplete',(select complete from streams where stream='completeTime'),'complete',p.complete,
  'dataComplete',p.complete and q.missing_member_count=0 and q.unknown_status_count=0 and q.uncertain_sequence_count=0 and q.missing_success_time_count=0,
  'missingMemberCount',q.missing_member_count,'unknownStatusCount',q.unknown_status_count,
  'orderSequenceUncertainCount',q.uncertain_sequence_count,'missingSuccessTimeCount',q.missing_success_time_count)
 from proof p cross join quality q;
$helper$;
revoke all on function private.dashboard_admin_yash_submission_coverage(date) from public,anon,authenticated,service_role;

do $migration_0$
declare p record;updated record;authenticated_id oid;definition text;
 before_hash constant text:='6e4fea5a233a2cca2e778e5a66cf0a40';after_hash constant text:='189d9c7ee57ee9cbcad72d29f8b124bc';
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
  where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or authenticated_id is null then raise exception 'yash_submission_baseline_missing_0';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or p.prosecdef is distinct from true or p.pronargdefaults<>0 or p.lanname<>'plpgsql'
  or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off'] then raise exception 'yash_submission_definition_drift_0';end if;
 if exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner,authenticated_id)))
 or not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable)
  then raise exception 'yash_submission_acl_drift_0';end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_catalog.pg_get_functiondef(p.oid);

  if (length(definition)-length(replace(definition,$old_0$ else
  raise exception using errcode='22023',message='submission_source_unavailable';$old_0$,'')))/length($old_0$ else
  raise exception using errcode='22023',message='submission_source_unavailable';$old_0$)<>1 then
   raise exception 'yash_submission_fragment_drift_0_0';end if;
  definition:=replace(definition,$old_0$ else
  raise exception using errcode='22023',message='submission_source_unavailable';$old_0$,$new_0$ elsif v_platform.source='kb' and v_platform.scope_group='IN' and v_platform.source_name='YASH.BET' and v_platform.id=md5('kb:IN:YASH.BET')::uuid and v_platform.timezone='Asia/Kolkata' then
  v_time_filter:='y.created_at>=$5 and y.created_at<$6';v_undated_filter:='y.created_at is null';
  v_source:=$q$select y.order_no order_id,nullif(btrim(y.uid),'') member_id,y.created_at,y.amount,y.currency,
   private.dashboard_admin_yash_provider(y.supplier) raw_provider,
   private.dashboard_admin_yash_status('deposit',y.status)='success' paid,private.dashboard_admin_yash_status('deposit',y.status)<>'unknown' status_known,y.status::text source_status,null::text level_text,null::text count_text
   from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(y.uid),'') member_id,(private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) at time zone $4)::date as day
   from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and private.dashboard_admin_yash_status('deposit',y.status)='success'
   and y.completed_at>=$5 and y.completed_at<$6 and private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is not null$q$;
  select jsonb_object_agg(d::date::text,private.dashboard_admin_yash_submission_coverage(d::date)) into v_yash_coverage
   from generate_series((v_from at time zone v_platform.timezone)::date::timestamp,(v_to at time zone v_platform.timezone)::date::timestamp-interval '1 day',interval '1 day') d;
 else
  raise exception using errcode='22023',message='submission_source_unavailable';$new_0$);

  if (length(definition)-length(replace(definition,$old_1$ v_day date;$old_1$,'')))/length($old_1$ v_day date;$old_1$)<>1 then
   raise exception 'yash_submission_fragment_drift_0_1';end if;
  definition:=replace(definition,$old_1$ v_day date;$old_1$,$new_1$ v_day date;v_yash_coverage jsonb;v_yash_unknown_days integer;v_yash_quality jsonb;$new_1$);

  if (length(definition)-length(replace(definition,$old_2$and cohort_success_count=0 and statuses_known and sequence_known
$old_2$,'')))/length($old_2$and cohort_success_count=0 and statuses_known and sequence_known
$old_2$)<>1 then
   raise exception 'yash_submission_fragment_drift_0_2';end if;
  definition:=replace(definition,$old_2$and cohort_success_count=0 and statuses_known and sequence_known
$old_2$,$new_2$and cohort_success_count=0 and statuses_known and sequence_known
   and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
$new_2$);

  if (length(definition)-length(replace(definition,$old_3$v_charts,v_thresholds,v_day;$old_3$,'')))/length($old_3$v_charts,v_thresholds,v_day;$old_3$)<>1 then
   raise exception 'yash_submission_fragment_drift_0_3';end if;
  definition:=replace(definition,$old_3$v_charts,v_thresholds,v_day;$old_3$,$new_3$v_charts,v_thresholds,v_day,v_yash_coverage;$new_3$);

  if (length(definition)-length(replace(definition,$old_4$ return v_result||jsonb_build_object('version',3$old_4$,'')))/length($old_4$ return v_result||jsonb_build_object('version',3$old_4$)<>1 then
   raise exception 'yash_submission_fragment_drift_0_4';end if;
  definition:=replace(definition,$old_4$ return v_result||jsonb_build_object('version',3$old_4$,$new_4$ if v_yash_coverage is not null then
  select count(*) filter(where not coalesce((e.value->>'complete')::boolean,false)),
   jsonb_build_object('missingMemberCount',coalesce(sum((e.value->>'missingMemberCount')::bigint),0),
    'unknownStatusCount',coalesce(sum((e.value->>'unknownStatusCount')::bigint),0),
    'orderSequenceUncertainCount',coalesce(sum((e.value->>'orderSequenceUncertainCount')::bigint),0),
    'missingSuccessTimeCount',coalesce(sum((e.value->>'missingSuccessTimeCount')::bigint),0))
   into v_yash_unknown_days,v_yash_quality from jsonb_each(v_yash_coverage)e;
  foreach v_key in array array['missingMemberCount','unknownStatusCount','orderSequenceUncertainCount','missingSuccessTimeCount'] loop
   v_yash_quality:=jsonb_set(v_yash_quality,array[v_key],to_jsonb(greatest(coalesce((v_result->'coverage'->>v_key)::bigint,0),(v_yash_quality->>v_key)::bigint)));
  end loop;
  v_result:=jsonb_set(v_result,'{coverage}',v_result->'coverage'||v_yash_quality||jsonb_build_object(
   'coverageUnknownDays',v_yash_unknown_days,'sourceCompletenessVerified',v_yash_unknown_days=0,
   'calculationComplete',v_yash_unknown_days=0 and not exists(select 1 from jsonb_each(v_yash_quality)q where (q.value#>>'{}')::bigint>0),
   'dayEvidence',v_yash_coverage));
 end if;
 return v_result||jsonb_build_object('version',3$new_4$);

  execute definition;
 end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then raise exception 'yash_submission_postcondition_failed_0';end if;
end;
$migration_0$;

do $migration_1$
declare p record;updated record;authenticated_id oid;definition text;
 before_hash constant text:='d154681ef237219a38343c4d3cc0b083';after_hash constant text:='1184e0aa90bd5f6ca14a078c2f03c318';
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
  where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_submission_streak(jsonb)');
 if not found or authenticated_id is null then raise exception 'yash_submission_baseline_missing_1';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'v'
  or p.prosecdef is distinct from true or p.pronargdefaults<>0 or p.lanname<>'plpgsql'
  or p.proconfig is distinct from array['search_path=""','jit=off','work_mem=64MB'] then raise exception 'yash_submission_definition_drift_1';end if;
 if exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner,authenticated_id)))
 or not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable)
  then raise exception 'yash_submission_acl_drift_1';end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_catalog.pg_get_functiondef(p.oid);

  if (length(definition)-length(replace(definition,$old_0$if v_platform.source not in ('ar','newar','lg','game66') then$old_0$,'')))/length($old_0$if v_platform.source not in ('ar','newar','lg','game66') then$old_0$)<>1 then
   raise exception 'yash_submission_fragment_drift_1_0';end if;
  definition:=replace(definition,$old_0$if v_platform.source not in ('ar','newar','lg','game66') then$old_0$,$new_0$if v_platform.source not in ('ar','newar','lg','game66') and not (v_platform.source='kb' and v_platform.scope_group='IN' and v_platform.source_name='YASH.BET' and v_platform.id=md5('kb:IN:YASH.BET')::uuid and v_platform.timezone='Asia/Kolkata') then$new_0$);

  execute definition;
 end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then raise exception 'yash_submission_postcondition_failed_1';end if;
end;
$migration_1$;

do $migration_2$
declare p record;updated record;authenticated_id oid;definition text;
 before_hash constant text:='021827c01109f47aa32130d49c99aec4';after_hash constant text:='8b03c0812522474616ea9cee7d098562';
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
  where f.oid=pg_catalog.to_regprocedure('private.dashboard_submission_streak_capture_day(jsonb,date,text[],text)');
 if not found or authenticated_id is null then raise exception 'yash_submission_baseline_missing_2';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or p.prosecdef is distinct from false or p.pronargdefaults<>0 or p.lanname<>'plpgsql'
  or p.proconfig is distinct from array['search_path=""','jit=off','work_mem=64MB','enable_mergejoin=off'] then raise exception 'yash_submission_definition_drift_2';end if;
 if exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner)))
 
  then raise exception 'yash_submission_acl_drift_2';end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_catalog.pg_get_functiondef(p.oid);

  if (length(definition)-length(replace(definition,$old_0$ else
  raise exception using errcode='22023',message='submission_source_unavailable';$old_0$,'')))/length($old_0$ else
  raise exception using errcode='22023',message='submission_source_unavailable';$old_0$)<>1 then
   raise exception 'yash_submission_fragment_drift_2_0';end if;
  definition:=replace(definition,$old_0$ else
  raise exception using errcode='22023',message='submission_source_unavailable';$old_0$,$new_0$ elsif v_platform.source='kb' and v_platform.scope_group='IN' and v_platform.source_name='YASH.BET' and v_platform.id=md5('kb:IN:YASH.BET')::uuid and v_platform.timezone='Asia/Kolkata' then
  v_time_filter:='y.created_at>=$5 and y.created_at<$6';v_undated_filter:='y.created_at is null';
  v_source:=$q$select y.order_no order_id,nullif(btrim(y.uid),'') member_id,(y.created_at at time zone $4)::date local_day,y.created_at,y.amount,y.currency,
   private.dashboard_admin_yash_provider(y.supplier) raw_provider,
   (private.dashboard_admin_yash_status('deposit',y.status)='success' and private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is null) success_time_missing,private.dashboard_admin_yash_status('deposit',y.status)<>'unknown' status_known
   from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(y.uid),'') member_id,(private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) at time zone $4)::date as day
   from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and private.dashboard_admin_yash_status('deposit',y.status)='success'
   and y.completed_at>=$5 and y.completed_at<$6 and private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is not null$q$;
  v_yash_coverage:=private.dashboard_admin_yash_submission_coverage(p_day);
 else
  raise exception using errcode='22023',message='submission_source_unavailable';$new_0$);

  if (length(definition)-length(replace(definition,$old_1$ v_time_filter text;v_undated_filter text;v_confirmations jsonb:='{}'::jsonb;$old_1$,'')))/length($old_1$ v_time_filter text;v_undated_filter text;v_confirmations jsonb:='{}'::jsonb;$old_1$)<>1 then
   raise exception 'yash_submission_fragment_drift_2_1';end if;
  definition:=replace(definition,$old_1$ v_time_filter text;v_undated_filter text;v_confirmations jsonb:='{}'::jsonb;$old_1$,$new_1$ v_time_filter text;v_undated_filter text;v_confirmations jsonb:='{}'::jsonb;v_yash_coverage jsonb;v_key text;v_quality jsonb;$new_1$);

  if (length(definition)-length(replace(definition,$old_2$from source_rows s where s.created_at is not null and s.member_id is not null
$old_2$,'')))/length($old_2$from source_rows s where s.created_at is not null and s.member_id is not null
$old_2$)<>1 then
   raise exception 'yash_submission_fragment_drift_2_2';end if;
  definition:=replace(definition,$old_2$from source_rows s where s.created_at is not null and s.member_id is not null
$old_2$,$new_2$from source_rows s where s.created_at is not null and s.member_id is not null
   and ($19::jsonb is null or coalesce(($19->>'dataComplete')::boolean,false))
$new_2$);

  if (length(definition)-length(replace(definition,$old_3$v_start,v_end,v_currency,v_confirmations;$old_3$,'')))/length($old_3$v_start,v_end,v_currency,v_confirmations;$old_3$)<>1 then
   raise exception 'yash_submission_fragment_drift_2_3';end if;
  definition:=replace(definition,$old_3$v_start,v_end,v_currency,v_confirmations;$old_3$,$new_3$v_start,v_end,v_currency,v_confirmations,v_yash_coverage;$new_3$);

  if (length(definition)-length(replace(definition,$old_4$ return v_result||jsonb_build_object('day',p_day$old_4$,'')))/length($old_4$ return v_result||jsonb_build_object('day',p_day$old_4$)<>1 then
   raise exception 'yash_submission_fragment_drift_2_4';end if;
  definition:=replace(definition,$old_4$ return v_result||jsonb_build_object('day',p_day$old_4$,$new_4$ if v_yash_coverage is not null then
  v_quality:=v_result->'coverage';
  v_quality:=v_quality||jsonb_build_object(
   'missing_member_count',greatest((v_quality->>'missing_member_count')::bigint,(v_yash_coverage->>'missingMemberCount')::bigint),
   'unknown_status_count',greatest((v_quality->>'unknown_status_count')::bigint,(v_yash_coverage->>'unknownStatusCount')::bigint),
   'uncertain_sequence_count',greatest((v_quality->>'uncertain_sequence_count')::bigint,(v_yash_coverage->>'orderSequenceUncertainCount')::bigint),
   'missing_success_time_count',greatest((v_quality->>'missing_success_time_count')::bigint,(v_yash_coverage->>'missingSuccessTimeCount')::bigint),
   'coverage_unknown_days',case when (v_yash_coverage->>'complete')::boolean then 0 else 1 end,
   'source_completeness_verified',(v_yash_coverage->>'complete')::boolean,'day_evidence',v_yash_coverage);
  v_result:=jsonb_set(v_result,'{coverage}',v_quality);
 end if;
 return v_result||jsonb_build_object('day',p_day$new_4$);

  execute definition;
 end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then raise exception 'yash_submission_postcondition_failed_2';end if;
end;
$migration_2$;

do $migration_3$
declare p record;updated record;authenticated_id oid;definition text;
 before_hash constant text:='1b3f301796d9286eedc64934d7fde72d';after_hash constant text:='8acc0d73187df3be84e38d94b950b5ed';
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
  where f.oid=pg_catalog.to_regprocedure('private.dashboard_submission_streak_result(uuid,text,integer,text,integer,integer)');
 if not found or authenticated_id is null then raise exception 'yash_submission_baseline_missing_3';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or p.prosecdef is distinct from false or p.pronargdefaults<>0 or p.lanname<>'sql'
  or p.proconfig is distinct from array['search_path=""','jit=off','work_mem=64MB'] then raise exception 'yash_submission_definition_drift_3';end if;
 if exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner)))
 
  then raise exception 'yash_submission_acl_drift_3';end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_catalog.pg_get_functiondef(p.oid);

  if (length(definition)-length(replace(definition,$old_0$   count(*) filter(where (result->'coverage'->>'order_count')::bigint>0) covered_day_count from captured$old_0$,'')))/length($old_0$   count(*) filter(where (result->'coverage'->>'order_count')::bigint>0) covered_day_count from captured$old_0$)<>1 then
   raise exception 'yash_submission_fragment_drift_3_0';end if;
  definition:=replace(definition,$old_0$   count(*) filter(where (result->'coverage'->>'order_count')::bigint>0) covered_day_count from captured$old_0$,$new_0$   coalesce(sum((result->'coverage'->>'coverage_unknown_days')::bigint),0) coverage_unknown_days,
   coalesce(bool_and(coalesce((result->'coverage'->>'source_completeness_verified')::boolean,false)),false) source_completeness_verified,
   count(*) filter(where (result->'coverage'->>'order_count')::bigint>0) covered_day_count from captured$new_0$);

  if (length(definition)-length(replace(definition,$old_1$and missing_success_time_count=0 calculation_complete$old_1$,'')))/length($old_1$and missing_success_time_count=0 calculation_complete$old_1$)<>1 then
   raise exception 'yash_submission_fragment_drift_3_1';end if;
  definition:=replace(definition,$old_1$and missing_success_time_count=0 calculation_complete$old_1$,$new_1$and missing_success_time_count=0 and coverage_unknown_days=0 calculation_complete$new_1$);

  if (length(definition)-length(replace(definition,$old_2$'coveredDayCount',covered_day_count,'noRecordDayCount',j.lookback_days-covered_day_count,'calculationComplete',calculation_complete,'sourceCompletenessVerified',false)$old_2$,'')))/length($old_2$'coveredDayCount',covered_day_count,'noRecordDayCount',j.lookback_days-covered_day_count,'calculationComplete',calculation_complete,'sourceCompletenessVerified',false)$old_2$)<>1 then
   raise exception 'yash_submission_fragment_drift_3_2';end if;
  definition:=replace(definition,$old_2$'coveredDayCount',covered_day_count,'noRecordDayCount',j.lookback_days-covered_day_count,'calculationComplete',calculation_complete,'sourceCompletenessVerified',false)$old_2$,$new_2$'coveredDayCount',covered_day_count,'noRecordDayCount',j.lookback_days-covered_day_count,'coverageUnknownDays',coverage_unknown_days,'calculationComplete',calculation_complete,'sourceCompletenessVerified',source_completeness_verified)$new_2$);

  execute definition;
 end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then raise exception 'yash_submission_postcondition_failed_3';end if;
end;
$migration_3$;

notify pgrst,'reload schema';
commit;
