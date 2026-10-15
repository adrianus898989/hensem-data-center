-- MAAN charge summary reads reuse the existing proved typed kernel with charts on or off.
-- Only the selector changes. Authentication, proof guards, metrics and coverage are unchanged.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';set local timezone='UTC';set local search_path='';
do $install$
declare current_body text;definition text;original_metadata jsonb;
begin
 if current_user<>'postgres'then raise exception'maan_summary_install_owner_only';end if;
 if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['dashboard_admin_live_submission_analysis']))::text))is distinct from '35d256a0ebef927e80079083283a044c'then raise exception'maan_summary_install_metadata_drift';end if;
 select prosrc,to_jsonb(p)-'prosrc'into current_body,original_metadata from pg_proc p where p.oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure;
 if md5(current_body)='3a8012390d65b3a698c749bee099d0d0'then return;end if;
 if md5(current_body)is distinct from 'cd7a262ccf7398acd43d5c18d43e627a'then raise exception'maan_summary_install_definition_drift';end if;
 definition:=pg_get_functiondef('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,$anchor$ -- Exact MAAN charge charts only. Original auth/catalog/filter validation has
 -- already completed; unproved days, schema/maintenance drift or other zones
 -- keep the ordinary native path. No cache or upstream completeness is implied.
 if v_operation='summary'and v_charts and v_platform.source='newar'$anchor$,'')))/length($anchor$ -- Exact MAAN charge charts only. Original auth/catalog/filter validation has
 -- already completed; unproved days, schema/maintenance drift or other zones
 -- keep the ordinary native path. No cache or upstream completeness is implied.
 if v_operation='summary'and v_charts and v_platform.source='newar'$anchor$)<>1 then raise exception'maan_summary_install_anchor_drift';end if;
 definition:=replace(definition,$anchor$ -- Exact MAAN charge charts only. Original auth/catalog/filter validation has
 -- already completed; unproved days, schema/maintenance drift or other zones
 -- keep the ordinary native path. No cache or upstream completeness is implied.
 if v_operation='summary'and v_charts and v_platform.source='newar'$anchor$,$replacement$ -- Exact MAAN charge summaries. Original auth/catalog/filter validation has
 -- already completed; unproved days, schema/maintenance drift or other zones
 -- keep the ordinary native path. No cache or upstream completeness is implied.
 if v_operation='summary'and v_platform.source='newar'$replacement$);
 execute definition;
 if (select md5(prosrc)from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure)is distinct from '3a8012390d65b3a698c749bee099d0d0'or (select to_jsonb(p)-'prosrc'from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure)is distinct from original_metadata then raise exception'maan_summary_install_after_assertion_failed';end if;
end;$install$;
commit;
