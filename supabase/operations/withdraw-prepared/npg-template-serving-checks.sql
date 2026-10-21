-- Read-only production checks. No reader/admission RPC, session impersonation,
-- worker action, raw orders, operator names, or credential values.
-- Run before/after deployment or a controlled UI read and retain both results.
-- Counts can also change independently through the existing scheduled workers.
select statement_timestamp() checked_at,p.proname,md5(p.prosrc) body_hash,
 pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig,p.prosecdef,p.provolatile,
 private.withdraw_prepared_dependency() statistics_dependency
from pg_proc p where p.pronamespace='private'::regnamespace and p.proname in(
 'withdraw_prepared_read','dashboard_withdraw_npg_template_read',
 'dashboard_withdraw_npg_template_zone','withdraw_prepared_render','withdraw_window_result')
order by p.proname;

with maps(country,platform)as(values
 ('哥伦比亚','NPG-COLOMBIA'),('墨西哥','NPG-MEXICO'),('智利','NPG-CHILE')),
families as materialized(
 select m.country,m.platform,j.*from maps m join private.withdraw_prepared_jobs j
 on j.request->>'country'=m.country and j.request->>'view'='auto'
 and left(j.request->>'startAt',10)='2026-10-20'
 and j.request->'platforms' in('[]'::jsonb,jsonb_build_array(m.platform))
 and j.scope='{"mode":"all","countries":[]}'::jsonb and j.catalog='[]'::jsonb),
templates as materialized(
 select distinct on(j.country)j.*,a.id artifact_id,a.payload,a.computed_at,a.expires_at,
 a.revision artifact_revision,a.dependency artifact_dependency
 from families j join private.withdraw_prepared_heads h on h.job_id=j.id
 join private.withdraw_prepared_artifacts a on a.id=h.artifact_id and a.job_id=j.id
 where j.request->'platforms'='[]'::jsonb
 order by j.country,a.computed_at desc),
verified as materialized(
 select m.country,d.stat_date,(d.payload#>>'{rows,0,total_count}')::bigint total,
 (d.payload#>>'{rows,0,auto_count}')::bigint auto_count,
 (d.payload#>>'{rows,0,manual_count}')::bigint manual_count,
 (d.payload#>>'{npgSource,complete}')::boolean source_complete
 from maps m cross join lateral private.npg_withdraw_report_snapshots(
 date'2026-10-19',date'2026-10-20','{"mode":"all","countries":[]}'::jsonb,
 jsonb_build_array(jsonb_build_object('country',m.country,'platforms',jsonb_build_array(m.platform))),
 jsonb_build_object('country',m.country,'platforms',jsonb_build_array(m.platform),
 'startAt','2026-10-20T00:00:00.000Z','endAt','2026-10-20T23:59:59.000Z'))d)
select m.country,t.status template_status,t.attempts template_attempts,t.last_error,
 t.artifact_id,t.computed_at,t.expires_at,
 t.artifact_revision=t.revision and t.artifact_dependency=t.dependency
 and t.dependency=private.withdraw_prepared_dependency() exact_revision_dependency,
 t.payload->'request'=t.request and t.payload->'scope'=t.scope and t.payload->'catalog'=t.catalog artifact_identity,
 private.dashboard_withdraw_npg_template_zone(t.request,t.scope,t.catalog) pinned_template_zone,
 (select count(*)from families j where j.country=m.country) exact_family_jobs,
 (select count(*)from families j join private.withdraw_prepared_artifacts a on a.job_id=j.id where j.country=m.country) exact_family_artifacts,
 (select count(*)from verified v where v.country=m.country and v.stat_date=date'2026-10-20') current_verified_reports,
 (select sum(total)from verified v where v.country=m.country and v.stat_date=date'2026-10-20') current_total,
 (select sum(auto_count)from verified v where v.country=m.country and v.stat_date=date'2026-10-20') current_auto,
 (select sum(manual_count)from verified v where v.country=m.country and v.stat_date=date'2026-10-20') current_manual,
 (select bool_and(source_complete)from verified v where v.country=m.country and v.stat_date=date'2026-10-20') current_source_complete,
 (select sum(total)from verified v where v.country=m.country and v.stat_date=date'2026-10-19') previous_total,
 (select bool_and(source_complete)from verified v where v.country=m.country and v.stat_date=date'2026-10-19') previous_source_complete
from maps m left join templates t on t.country=m.country order by m.country;

