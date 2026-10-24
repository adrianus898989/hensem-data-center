CREATE OR REPLACE FUNCTION private.submission_cohort_semantic(t jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT CASE WHEN private.provider_snapshot_kernel_contract_current()AND private.withdraw_prepared_catalog_current(jsonb_build_array(t))
 AND(SELECT hooks=private.submission_cohort_hooks_current()FROM private.submission_cohort_control WHERE singleton)
 AND(SELECT md5(jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod))ORDER BY a.attnum)::text)
  FROM pg_attribute a WHERE a.attrelid=CASE t->>'source'WHEN'ar'THEN'public.ar_collected_orders'::regclass WHEN'newar'THEN'public.newar_detail_records'::regclass WHEN'kb'THEN'private.yash_orders'::regclass END AND a.attnum>0 AND NOT a.attisdropped)
 =CASE t->>'source'WHEN'ar'THEN'579111e98e7fcb7df64d9fb0ccab96a0'WHEN'newar'THEN'576047ef4fd2bb64dbb3eb29ca349a41'WHEN'kb'THEN'f3f92c17b5ecd79604f5e530960e0c22'END
 THEN md5(jsonb_build_array('submission-local-day-window-v1',private.provider_snapshot_dependency_token(t),
  (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)))ORDER BY p.oid::regprocedure::text)FROM pg_proc p WHERE p.oid=ANY(ARRAY['private.submission_cohort_day_compute(jsonb,jsonb)'::regprocedure,'private.submission_cohort_project(jsonb,jsonb,jsonb,timestamptz)'::regprocedure])),
  CASE WHEN t->>'source'='newar'THEN(SELECT to_jsonb(n)FROM public.newar_detail_platforms n WHERE n.platform=t->>'source_name')END,
  (SELECT jsonb_agg(jsonb_build_array(c.oid::regclass::text,
   (SELECT jsonb_agg((to_jsonb(a)-ARRAY['attrelid','attstattarget','attcacheoff'])||jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'default',pg_get_expr(d.adbin,d.adrelid))ORDER BY a.attnum)FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
   (SELECT jsonb_agg(jsonb_build_array(i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid))ORDER BY i.indexrelid)FROM pg_index i WHERE i.indrelid=c.oid),
   (SELECT jsonb_agg(jsonb_build_array(g.tgname,g.tgenabled,pg_get_triggerdef(g.oid),md5(p.prosrc))ORDER BY g.tgname COLLATE"C")FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid WHERE g.tgrelid=c.oid AND NOT g.tgisinternal))ORDER BY c.oid)
   FROM pg_class c WHERE c.oid=CASE t->>'source'WHEN'ar'THEN'public.ar_collected_orders'::regclass WHEN'newar'THEN'public.newar_detail_records'::regclass WHEN'kb'THEN'private.yash_orders'::regclass END OR(t->>'source'='kb'AND c.oid='private.yash_sync_windows'::regclass))
 )::text)END;
$function$
