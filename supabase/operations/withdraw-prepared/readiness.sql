-- READ ONLY: retain this receipt AND the separately reviewed expected default
-- manifest before cutover. Mere count(view)=2 is not full-scope acceptance.
begin read only;
set local statement_timeout='3s';
set local lock_timeout='250ms';
with expected as materialized(
 select t.id,t.fingerprint,t.request,t.timezone,n.offset_day,
 ((now()at time zone t.timezone)::date-n.offset_day)::text local_date,
 jsonb_build_array('withdraw-independent-windows-v2',t.scope,t.catalog,private.withdraw_window_default_day(t.request,(now()at time zone t.timezone)::date-n.offset_day))k,
 private.withdraw_prepared_catalog_current(t.catalog)native_current
 from private.withdraw_prepared_templates t cross join generate_series(0,1)n(offset_day)where t.enabled),dep as materialized(select private.withdraw_prepared_dependency()d,private.withdraw_prepared_source_contract_current()source_contract_current)
select clock_timestamp()receipt_utc,e.fingerprint template_fingerprint,e.request->>'country'country,e.request->>'view'view,e.local_date,e.timezone,
 e.request->'platforms'platforms,e.request->'scopeTargets'scope_targets,e.native_current,j.status,j.attempts,j.last_error,
 coalesce(a.id is not null and a.job_id=j.id and a.revision=j.revision and a.dependency=dep.d and j.dependency=dep.d and e.native_current and dep.source_contract_current and a.payload->>'contract'='withdraw-independent-windows-v2' and a.payload->'request'=j.request and a.payload->'scope'=j.scope and a.payload->'catalog'=j.catalog and jsonb_typeof(a.payload->'secondary')='object' and jsonb_typeof(a.payload->'game66')='object' and not exists(select 1 from unnest(array['wg','yash','newar','ar','duoli','arHistory'])part where jsonb_typeof(a.payload->part)is distinct from'array'),false)semantic_current,
 coalesce(a.id is not null and a.job_id=j.id and a.revision=j.revision and a.dependency=dep.d and j.dependency=dep.d and a.expires_at>now()and e.native_current and dep.source_contract_current,false)cutover_ready,
 case when a.expires_at>now()then'fresh'else'refresh_due'end freshness,
 case when j.status in('queued','running','failed')then j.status else'idle'end refresh_state,
 a.id generation,a.computed_at,a.expires_at,a.bytes
 from expected e cross join dep left join private.withdraw_prepared_jobs j on j.fingerprint=md5(e.k::text)and j.request_key=e.k
 left join private.withdraw_prepared_heads h on h.job_id=j.id left join private.withdraw_prepared_artifacts a on a.id=h.artifact_id
 order by country,view,e.fingerprint,e.offset_day;
-- Compare supported native country × both views to explicitly registered
-- defaults. Team-specific and restricted-role defaults must also be listed in
-- the deployment manifest; country coverage alone does not prove them warm.
with expected as(select distinct p.country,v.view from private.prepared_aggregate_native_catalog()p cross join(values('auto'),('operators'))v(view)
 where p.source in('ar','newar','duoli','kb','wg','lg','game66'))
select e.country,e.view,'missing_default_template'issue from expected e where not exists(
 select 1 from private.withdraw_prepared_templates t where t.enabled and t.request->>'view'=e.view
 and(t.request->>'country'=e.country or exists(select 1 from jsonb_array_elements(coalesce(t.request->'scopeTargets','[]'))s where s->>'country'=e.country)))order by 1,2;
select status,count(*)jobs,max(attempts)max_attempts,min(not_before)oldest_due from private.withdraw_prepared_jobs group by status;
select jobname,schedule,active from cron.job where jobname like'withdraw-prepared-%'or jobname='exact-aggregate-worker-v1';
-- The exposed RPC controls PostgREST's transaction access mode. Both the
-- temporary capture and prepared reader can enqueue; a STABLE outer wrapper
-- would silently lose capture admission or reject prepared cache misses.
SELECT p.oid::regprocedure::text signature,md5(p.prosrc) body_md5,
 pg_get_userbyid(p.proowner)owner,p.provolatile,p.prosecdef,p.proacl::text,p.proconfig,
 CASE WHEN (SELECT provolatile FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure)='v' THEN 'v' ELSE 's' END expected_public_volatility
 FROM pg_proc p WHERE p.oid=ANY(ARRAY['public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure,'private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure]);
commit;
