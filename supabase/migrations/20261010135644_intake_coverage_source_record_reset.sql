-- JSONB source evidence is scoped to a single feed/day. Coverage judgments stay unchanged.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $fix$
declare p pg_proc%rowtype;original_metadata jsonb;d text;
begin
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_intake_coverage(jsonb)');
 if not (pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}' and p.prosecdef and p.provolatile='s' and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=ARRAY['search_path=""','jit=off']::text[]) then raise exception 'intake_coverage_record_metadata_drift';end if;
 if md5(p.prosrc) not in ('67d6a8454f69b4fc78de63dccad88999','a6146e3dfa27ea0102fb77a5b929a09e') then raise exception 'intake_coverage_record_baseline_drift';end if;
 original_metadata:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)='67d6a8454f69b4fc78de63dccad88999' then
  d:=pg_get_functiondef(p.oid);
  if (length(d)-length(replace(d,$old0$v_run record;v_lg_runs jsonb;$old0$,'')))/length($old0$v_run record;v_lg_runs jsonb;$old0$)<>1 then raise exception 'intake_coverage_record_marker_drift';end if;
  d:=replace(d,$old0$v_run record;v_lg_runs jsonb;$old0$,$new0$v_run record;v_source_evidence jsonb;v_lg_runs jsonb;$new0$);
  if (length(d)-length(replace(d,$old1$    v_lg_window_coverage:=null;$old1$,'')))/length($old1$    v_lg_window_coverage:=null;$old1$)<>1 then raise exception 'intake_coverage_record_marker_drift';end if;
  d:=replace(d,$old1$    v_lg_window_coverage:=null;$old1$,$new1$    v_lg_window_coverage:=null;v_source_evidence:=null;$new1$);
  if (length(d)-length(replace(d,$old2$select private.dashboard_admin_yash_day_evidence(v_raw_country,v_raw_platform,v_kind,v_day) value into v_run;$old2$,'')))/length($old2$select private.dashboard_admin_yash_day_evidence(v_raw_country,v_raw_platform,v_kind,v_day) value into v_run;$old2$)<>1 then raise exception 'intake_coverage_record_marker_drift';end if;
  d:=replace(d,$old2$select private.dashboard_admin_yash_day_evidence(v_raw_country,v_raw_platform,v_kind,v_day) value into v_run;$old2$,$new2$select private.dashboard_admin_yash_day_evidence(v_raw_country,v_raw_platform,v_kind,v_day) value into v_run;
     v_source_evidence:=v_run.value;$new2$);
  if (length(d)-length(replace(d,$old3$select private.dashboard_admin_duoli_day_evidence(v_raw_platform,v_kind,v_day) value into v_run;$old3$,'')))/length($old3$select private.dashboard_admin_duoli_day_evidence(v_raw_platform,v_kind,v_day) value into v_run;$old3$)<>1 then raise exception 'intake_coverage_record_marker_drift';end if;
  d:=replace(d,$old3$select private.dashboard_admin_duoli_day_evidence(v_raw_platform,v_kind,v_day) value into v_run;$old3$,$new3$select private.dashboard_admin_duoli_day_evidence(v_raw_platform,v_kind,v_day) value into v_run;
     v_source_evidence:=v_run.value;$new3$);
  if (length(d)-length(replace(d,$old4$jsonb_build_object('sourceWindowCoverage',v_run.value->'progress',
       'createdCoverageAvailable',v_run.value->'createdCoverageAvailable')$old4$,'')))/length($old4$jsonb_build_object('sourceWindowCoverage',v_run.value->'progress',
       'createdCoverageAvailable',v_run.value->'createdCoverageAvailable')$old4$)<>1 then raise exception 'intake_coverage_record_marker_drift';end if;
  d:=replace(d,$old4$jsonb_build_object('sourceWindowCoverage',v_run.value->'progress',
       'createdCoverageAvailable',v_run.value->'createdCoverageAvailable')$old4$,$new4$jsonb_build_object('sourceWindowCoverage',v_source_evidence->'progress',
       'createdCoverageAvailable',v_source_evidence->'createdCoverageAvailable')$new4$);
  execute d;
 end if;
 select * into strict p from pg_proc where oid=p.oid;
 if to_jsonb(p)-'prosrc' is distinct from original_metadata or md5(p.prosrc)<>'a6146e3dfa27ea0102fb77a5b929a09e' then raise exception 'intake_coverage_record_postcheck_failed';end if;
end $fix$;
commit;
