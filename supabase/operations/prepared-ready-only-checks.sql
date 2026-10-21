-- Read-only preflight/postflight for the ready-only serving candidate.
-- No application-session impersonation, authorized reader invocation, enqueue,
-- refresh, raw source scan or mutable write is performed here.
-- Save each result with its checked_at. Background workers may independently
-- replace heads; compare immutable old IDs/payload hashes, not only latest IDs.

-- Before: wrapper hash must be 1dd076b75533d3a1333dd6c739e4c72c and helper absent.
-- After: helper body must be 227143c4c01682570c81edef9a336476, STABLE, INVOKER,
-- private-only ACL. Parent should compare the saved per-scope dependency vector.
select statement_timestamp()checked_at,p.proname,md5(p.prosrc)body_hash,
 pg_get_userbyid(p.proowner)owner,p.proacl::text acl,p.proconfig,p.prosecdef,p.provolatile,
 p.proretset,p.proparallel,p.proisstrict,p.proleakproof
from pg_proc p where p.pronamespace='private'::regnamespace and p.proname in(
 'dashboard_admin_daily_provider_prepared_read','dashboard_serving_ready_read','prepared_aggregate_read')
order by p.proname;
select statement_timestamp()checked_at,jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))dependencies
from unnest(array['IN','ID','BR','MX','CL','CO'])scope;
select statement_timestamp()checked_at,role,
 case when to_regprocedure('private.dashboard_serving_ready_read(text,jsonb)')is null then null
 else has_function_privilege(role,'private.dashboard_serving_ready_read(text,jsonb)','EXECUTE')end helper_execute
from unnest(array['anon','authenticated','service_role'])role;

-- Same financial projection as the M8/IN/2026-10-20 provider request: creation
-- and success clocks are the same ended local day, direction charge, INR, all
-- providers. This does not replace per-session native authorization in the RPC.
with common as materialized(select private.prepared_aggregate_dependency_common('IN')v),
candidates as materialized(
 select j.*,a.id artifact_id,a.revision artifact_revision,a.dependency artifact_dependency,
 a.computed_at,a.expires_at,a.cutoff,a.source_complete,a.payload,
 jsonb_build_object('action','aggregate','view','providers','platformId',j.target->>'id',
 'startAt','2026-10-19T18:30:00.000Z','endAt','2026-10-20T18:30:00.000Z',
 'successStartAt','2026-10-19T18:30:00.000Z','successEndAt','2026-10-20T18:30:00.000Z',
 'successBasis','success','direction','charge','status','all','currency','INR','providers','[]'::jsonb)q,
 private.prepared_aggregate_dependency(j.target,common.v)expected_dep
 from private.prepared_aggregate_jobs j join private.prepared_aggregate_heads h on h.job_id=j.id
 join private.prepared_aggregate_artifacts a on a.id=h.artifact_id and a.job_id=j.id cross join common
 where j.target->>'team'='M8'and j.target->>'country'='印度'
 and j.request->>'view'='full'and j.request->>'durationVersion'='2'
 and(j.request->>'startAt')::timestamptz='2026-10-19T18:30:00Z'::timestamptz
 and(j.request->>'endAt')::timestamptz='2026-10-20T18:30:00Z'::timestamptz),
checked as materialized(select *,case
 when not private.prepared_aggregate_target_current(target)then'native_target_changed'
 when private.prepared_aggregate_request_reason(q,target)is not null then'request_invalid'
 when dependency<>expected_dep or artifact_dependency<>expected_dep then'dependency_mismatch'
 when revision<>artifact_revision then'revision_mismatch'
 when request_key<>private.prepared_aggregate_key(request,target)or request_fingerprint<>md5(request_key::text)then'key_mismatch'
 when request->>'direction'<>'all'or request?'durationRange'or coalesce(request->>'status','all')<>'all'
  or coalesce(request->'providers','[]'::jsonb)<>'[]'::jsonb then'master_filters'
 when(private.prepared_aggregate_canonical_request(request,target)-array['view','durationVersion','amountBands','direction','providers'])
  <>(private.prepared_aggregate_canonical_request(q,target)-array['view','durationVersion','amountBands','direction','providers'])then'canonical_window_or_filter'
 when computed_at is null or expires_at is null or cutoff is null or not isfinite(cutoff)or not isfinite(computed_at)
  or not isfinite(expires_at)or expires_at<=computed_at or computed_at>statement_timestamp()or source_complete is null then'invalid_publication_metadata'
 when jsonb_typeof(payload#>'{groups,provider}')is distinct from'array'then'missing_provider_group'
 else null end miss_reason from candidates),
chosen as materialized(select distinct on(target->>'id')*from checked
 order by target->>'id',(miss_reason is null)desc,computed_at desc),
projected as materialized(select target->>'id'platform_id,
 private.prepared_aggregate_master_projection(payload,private.prepared_aggregate_canonical_request(request,target),
 private.prepared_aggregate_canonical_request(q,target))result from chosen where miss_reason is null),
metrics as materialized(select p.platform_id,r from projected p cross join lateral jsonb_array_elements(p.result#>'{groups,provider}')r),
controls as materialized(select metric,count(*)row_count,count(*)filter(where r->>metric is null)unknown_rows,
 sum((r->>metric)::numeric)known_sum from metrics cross join unnest(array[
 'all_count','all_amount','created_success_count','created_success_amount','success_count','success_amount'])metric group by metric)
select statement_timestamp()checked_at,count(*)targets,
 count(*)filter(where miss_reason is null)usable_last_complete,
 count(*)filter(where miss_reason is null and expires_at>statement_timestamp())fresh,
 count(*)filter(where miss_reason is null and expires_at<=statement_timestamp())refresh_due,
 count(*)filter(where miss_reason is null and source_complete)source_complete,
 coalesce((select jsonb_object_agg(reason,n)from(select miss_reason reason,count(*)n from chosen where miss_reason is not null group by 1)x),'{}')miss_reasons,
 (select jsonb_object_agg(metric,jsonb_build_object('rows',row_count,'unknownRows',unknown_rows,'knownSum',known_sum))from controls)six_controls,
 jsonb_agg(jsonb_build_object('platform',target->>'name','jobId',id,'artifactId',artifact_id,'revision',revision,
 'computedAt',computed_at,'expiresAt',expires_at,'cutoff',cutoff,'sourceComplete',source_complete,
 'status',status,'attempts',attempts,'payloadHash',md5(payload::text))order by target->>'name')immutable_heads,
 (select count(*)from private.prepared_aggregate_jobs z where z.target->>'id'in(select target->>'id'from chosen)
  and(z.request->>'startAt')::timestamptz='2026-10-19T18:30:00Z'::timestamptz
  and(z.request->>'endAt')::timestamptz='2026-10-20T18:30:00Z'::timestamptz)family_jobs,
 (select count(*)from private.prepared_aggregate_artifacts a join private.prepared_aggregate_jobs z on z.id=a.job_id
  where z.target->>'id'in(select target->>'id'from chosen)
  and(z.request->>'startAt')::timestamptz='2026-10-19T18:30:00Z'::timestamptz
  and(z.request->>'endAt')::timestamptz='2026-10-20T18:30:00Z'::timestamptz)family_artifacts
from chosen;

-- Postflight checklist:
-- 1. Body/owner/ACL/security metadata match the reviewed candidate; all scope
--    dependency values are unchanged. No new table/worker/scheduler is created.
-- 2. The 19 existing immutable IDs, payload hashes, sourceComplete and original
--    computed/expires values survive. A concurrent newly published head is not
--    itself evidence of a probe write; retain and compare the prior IDs.
-- 3. Normal UI Query sends one ready-only transport and displays usable heads.
--    Its expired/missing continuations are the existing <=3, <=2 concurrent
--    reader calls. Fresh hits have no second read; misses have no cached result.
-- 4. Query cancellation, page/account/filter changes and permission denial stop
--    both phases. No late continuation overwrites a newer screen or cache.
-- 5. Do not infer source completeness from 19 returned heads. The saved controls
--    include unknown counts, and sourceComplete=false remains visible as such.
