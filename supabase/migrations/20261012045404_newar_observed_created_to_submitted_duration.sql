-- Native NEWAR India duration: creation -> provider submission, not payment/handling completion.
-- Only MAANWIN/DhaniWin native dates >=2026-10-10; no historical/source/fact writes.
begin;
set local lock_timeout='2s';
do $patch$
declare p record;definition text;before_metadata jsonb;
begin
 select q.* into p from pg_proc q where q.oid=to_regprocedure('private.newar_withdraw_fact(public.newar_detail_records)');
 if not found or md5(p.prosrc)<>'244fe0b21d3b785a40c6409807b358bc' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef
  or p.provolatile<>'v' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='sql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  then raise exception 'NEWAR_SUBMISSION_DURATION_DEPENDENCY_DRIFT';end if;
 select q.* into p from pg_proc q where q.oid=to_regprocedure('private.newar_stats_time(text)');
 if not found or md5(p.prosrc)<>'5789c6b60e5bf5789b1ac1733df85c34' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef
  or p.provolatile<>'i' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  then raise exception 'NEWAR_SUBMISSION_DURATION_DEPENDENCY_DRIFT';end if;
 select q.*,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid=to_regprocedure('private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)');
 if not found or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from false
  or p.provolatile<>'s' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='sql')
  or p.proretset is distinct from true or pg_get_function_result(p.oid) is distinct from $result$TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, pending_count bigint, unknown_count bigint, unclassified_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, currencies jsonb, currency_unknown_count bigint)$result$
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  then raise exception 'NEWAR_SUBMISSION_DURATION_METADATA_DRIFT';end if;
 if md5(p.prosrc) not in('450e601fef3810bf73c438d37762dd70','46fa899cdbf78147c022e1813e197427') then raise exception 'NEWAR_SUBMISSION_DURATION_BODY_DRIFT';end if;
 if md5(p.prosrc)='450e601fef3810bf73c438d37762dd70' then
  before_metadata:=p.metadata;definition:=pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,$old0_0$   n.method,n.account,n.submitted_at,n.handled_at
$old0_0$,'')))/length($old0_0$   n.method,n.account,n.submitted_at,n.handled_at
$old0_0$)<>1 then raise exception 'NEWAR_SUBMISSION_DURATION_ANCHOR_DRIFT';end if;
  definition:=replace(definition,$old0_0$   n.method,n.account,n.submitted_at,n.handled_at
$old0_0$,$new0_0$   n.method,n.account,n.submitted_at,n.handled_at,n.created_at,
   (s.country='印度' and s.source_name in('MAANWIN','DhaniWin') and n.created_at>=timestamp '2026-10-10' at time zone s.timezone) use_created_to_submitted
$new0_0$);
  if (length(definition)-length(replace(definition,$old0_1$   case when isfinite(submitted_at) and isfinite(handled_at) and handled_at>=submitted_at
    and handled_at<=captured_at and handled_at<=statement_timestamp()
    then extract(epoch from handled_at-submitted_at) end processing_seconds$old0_1$,'')))/length($old0_1$   case when isfinite(submitted_at) and isfinite(handled_at) and handled_at>=submitted_at
    and handled_at<=captured_at and handled_at<=statement_timestamp()
    then extract(epoch from handled_at-submitted_at) end processing_seconds$old0_1$)<>1 then raise exception 'NEWAR_SUBMISSION_DURATION_ANCHOR_DRIFT';end if;
  definition:=replace(definition,$old0_1$   case when isfinite(submitted_at) and isfinite(handled_at) and handled_at>=submitted_at
    and handled_at<=captured_at and handled_at<=statement_timestamp()
    then extract(epoch from handled_at-submitted_at) end processing_seconds$old0_1$,$new0_1$   case when use_created_to_submitted then
    case when isfinite(created_at) and isfinite(submitted_at) and submitted_at>=created_at
     and submitted_at<=captured_at and submitted_at<=statement_timestamp()
     and trunc(extract(epoch from submitted_at-created_at))>0
     then trunc(extract(epoch from submitted_at-created_at)) end
    else case when isfinite(submitted_at) and isfinite(handled_at) and handled_at>=submitted_at
     and handled_at<=captured_at and handled_at<=statement_timestamp()
     then extract(epoch from handled_at-submitted_at) end end processing_seconds$new0_1$);
  execute definition;
  select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid=to_regprocedure('private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)');
  if p.hash<>'46fa899cdbf78147c022e1813e197427' or p.metadata is distinct from before_metadata then raise exception 'NEWAR_SUBMISSION_DURATION_POSTCHECK';end if;
 end if;
 select q.*,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 if not found or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from true
  or p.provolatile<>'s' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proretset is distinct from false or pg_get_function_result(p.oid) is distinct from $result$jsonb$result$
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  then raise exception 'NEWAR_SUBMISSION_DURATION_METADATA_DRIFT';end if;
 if md5(p.prosrc) not in('cb33854922fdb014a665fba646ace941','4984364f524c3d3b5bf73d87ab69f0d2') then raise exception 'NEWAR_SUBMISSION_DURATION_BODY_DRIFT';end if;
 if md5(p.prosrc)='cb33854922fdb014a665fba646ace941' then
  before_metadata:=p.metadata;definition:=pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,$old1_0$case when h.duration_sample_count is not null then 'source_reported_processing' else 'source_submitted_to_handled' end::text$old1_0$,'')))/length($old1_0$case when h.duration_sample_count is not null then 'source_reported_processing' else 'source_submitted_to_handled' end::text$old1_0$)<>1 then raise exception 'NEWAR_SUBMISSION_DURATION_ANCHOR_DRIFT';end if;
  definition:=replace(definition,$old1_0$case when h.duration_sample_count is not null then 'source_reported_processing' else 'source_submitted_to_handled' end::text$old1_0$,$new1_0$case when h.duration_sample_count is not null then 'source_reported_processing' when n.country='印度' and n.platform_key in('MAANWIN','DHANIWIN') and n.data_date>=date '2026-10-10' then 'created_to_submitted' else 'source_submitted_to_handled' end::text$new1_0$);
  if (length(definition)-length(replace(definition,$old1_1$(r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'source_submitted_to_handled'::text,(r->>'success')::bigint$old1_1$,'')))/length($old1_1$(r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'source_submitted_to_handled'::text,(r->>'success')::bigint$old1_1$)<>1 then raise exception 'NEWAR_SUBMISSION_DURATION_ANCHOR_DRIFT';end if;
  definition:=replace(definition,$old1_1$(r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'source_submitted_to_handled'::text,(r->>'success')::bigint$old1_1$,$new1_1$(r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,
   case when n.country='印度' and n.platform_key in('MAANWIN','DHANIWIN') and n.data_date>=date '2026-10-10' then 'created_to_submitted' else 'source_submitted_to_handled' end::text,(r->>'success')::bigint$new1_1$);
  if (length(definition)-length(replace(definition,$old1_2$array['created_to_operated','created_to_completed','applied_to_completed','source_submitted_to_handled','source_reported_processing']$old1_2$,'')))/length($old1_2$array['created_to_operated','created_to_completed','applied_to_completed','source_submitted_to_handled','source_reported_processing']$old1_2$)<>1 then raise exception 'NEWAR_SUBMISSION_DURATION_ANCHOR_DRIFT';end if;
  definition:=replace(definition,$old1_2$array['created_to_operated','created_to_completed','applied_to_completed','source_submitted_to_handled','source_reported_processing']$old1_2$,$new1_2$array['created_to_operated','created_to_completed','applied_to_completed','source_submitted_to_handled','source_reported_processing','created_to_submitted']$new1_2$);
  if (length(definition)-length(replace(definition,$old1_3$'latestCollectedAt',max(n.updated_at),'durationBasis','source_submitted_to_handled')||$old1_3$,'')))/length($old1_3$'latestCollectedAt',max(n.updated_at),'durationBasis','source_submitted_to_handled')||$old1_3$)<>1 then raise exception 'NEWAR_SUBMISSION_DURATION_ANCHOR_DRIFT';end if;
  definition:=replace(definition,$old1_3$'latestCollectedAt',max(n.updated_at),'durationBasis','source_submitted_to_handled')||$old1_3$,$new1_3$'latestCollectedAt',max(n.updated_at),'durationBasis',
      case when v_yash_item->>'country'='印度' and private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform') in('MAANWIN','DHANIWIN')
       then case when v_yash_from>=date '2026-10-10' then 'created_to_submitted' else v_yash_item->>'durationBasis' end
       else 'source_submitted_to_handled' end)||$new1_3$);
  if (length(definition)-length(replace(definition,$old1_4$    v_yash_item:=v_yash_item||v_yash_meta;
    if v_view='auto' and v_yash_item#>>'{previous,durationBasis}'='source_reported_processing' then$old1_4$,'')))/length($old1_4$    v_yash_item:=v_yash_item||v_yash_meta;
    if v_view='auto' and v_yash_item#>>'{previous,durationBasis}'='source_reported_processing' then$old1_4$)<>1 then raise exception 'NEWAR_SUBMISSION_DURATION_ANCHOR_DRIFT';end if;
  definition:=replace(definition,$old1_4$    v_yash_item:=v_yash_item||v_yash_meta;
    if v_view='auto' and v_yash_item#>>'{previous,durationBasis}'='source_reported_processing' then$old1_4$,$new1_4$    v_yash_item:=v_yash_item||v_yash_meta;
    if v_yash_item->>'durationBasis'='created_to_submitted' then
     v_yash_item:=v_yash_item||jsonb_build_object('durationSource','native_created_to_submitted','durationCompletenessVerified',false);
    end if;
    if v_yash_item#>>'{previous,durationBasis}'='created_to_submitted' then
     v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||
      jsonb_build_object('durationSource','native_created_to_submitted','durationCompletenessVerified',false));
    end if;
    if v_view='auto' and v_yash_item#>>'{previous,durationBasis}'='source_reported_processing' then$new1_4$);
  execute definition;
  select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
  if p.hash<>'4984364f524c3d3b5bf73d87ab69f0d2' or p.metadata is distinct from before_metadata then raise exception 'NEWAR_SUBMISSION_DURATION_POSTCHECK';end if;
 end if;
end;$patch$;
commit;
