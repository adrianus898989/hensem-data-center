CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency_common(p_scope text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','exact-prepared-dual-clock-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='1cfe700c87c0fa33bee5d0586cb78853' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')=p_scope) categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')=p_scope) blockers)
  )
 )::text);
$function$

