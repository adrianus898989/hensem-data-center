-- AR unplaced identities come only from native NULL applied_at rows.
-- Preserve full-day/cohort/provider/later-paid eligibility and all response fields.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $fix$
declare p record;original_metadata jsonb;d text;authenticated_id oid;
 before_hash constant text:='ab63c0ce48fe0ab393b4d5e6ef8a4d83';
 after_hash constant text:='325c95878225f211b91aed89c7abae86';
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select q.*,l.lanname,pg_catalog.pg_get_userbyid(q.proowner) owner_name into p
 from pg_catalog.pg_proc q join pg_catalog.pg_language l on l.oid=q.prolang
 where q.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or authenticated_id is null or p.owner_name<>'postgres'
  or p.lanname<>'plpgsql' or not p.prosecdef or p.provolatile<>'s' or p.prorettype<>'jsonb'::regtype
  or p.pronargs<>1 or p.pronargdefaults<>0
  or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off']::text[]
  or md5(p.prosrc) not in(before_hash,after_hash)
 then raise exception 'ar_submission_native_null_definition_drift';end if;
 if p.proacl is null
  or not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.privilege_type='EXECUTE'
   and (a.is_grantable or a.grantee not in(p.proowner,authenticated_id)))
 then raise exception 'ar_submission_native_null_acl_drift';end if;
 original_metadata:=to_jsonb(p)-array['prosrc','lanname','owner_name'];
 if md5(p.prosrc)=before_hash then
  d:=pg_catalog.pg_get_functiondef(p.oid);
  if (length(d)-length(replace(d,$old0$v_time_filter text;v_undated_filter text;$old0$,'')))/length($old0$v_time_filter text;v_undated_filter text;$old0$)<>1 then
   raise exception 'ar_submission_native_null_anchor_0_drift';end if;
  d:=replace(d,$old0$v_time_filter text;v_undated_filter text;$old0$,$new0$v_time_filter text;v_undated_filter text;v_undated_source text;$new0$);
  if (length(d)-length(replace(d,$old1$ v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);$old1$,'')))/length($old1$ v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);$old1$)<>1 then
   raise exception 'ar_submission_native_null_anchor_1_drift';end if;
  d:=replace(d,$old1$ v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);$old1$,$new1$ if v_platform.source='ar' then v_undated_source:=replace(v_source,'$source_time_filter$',v_undated_filter);end if;
 v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);$new1$);
  if (length(d)-length(replace(d,$old2$ execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,$old2$,'')))/length($old2$ execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,$old2$)<>1 then
   raise exception 'ar_submission_native_null_anchor_2_drift';end if;
  d:=replace(d,$old2$ execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,$old2$,$new2$ if v_platform.source='ar' then
  v_sql:=replace(v_sql,'select distinct member_id from source_rows where created_at is null and member_id is not null',
   'select distinct member_id from ('||v_undated_source||') s where created_at is null and member_id is not null');
 end if;
 execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,$new2$);
  execute d;
 end if;
 select q.*,l.lanname,pg_catalog.pg_get_userbyid(q.proowner) owner_name into p
 from pg_catalog.pg_proc q join pg_catalog.pg_language l on l.oid=q.prolang where q.oid=p.oid;
 if to_jsonb(p)-array['prosrc','lanname','owner_name'] is distinct from original_metadata or md5(p.prosrc)<>after_hash
 then raise exception 'ar_submission_native_null_postcondition_failed';end if;
end;$fix$;
commit;
