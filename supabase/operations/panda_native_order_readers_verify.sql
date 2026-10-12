-- Read-only verification; no identity/JWT override and no order identifiers.
-- Run metadata first. Run each bounded helper statement separately, not in parallel.
select now() as checked_at,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) index_definition,
 pg_size_pretty(pg_relation_size(i.indexrelid)) index_size
from pg_index i where i.indexrelid=to_regclass('public.panda_orders_provider_names_idx');
with expected(signature,body_md5,owner,acl) as (values
('private.dashboard_admin_live_query_raw(jsonb)','d15ed50d64563efd2d5a13ceb47bf9a7','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_live_drilldown_raw(jsonb)','aedac8e0b599492bd65f44d83573c377','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_live_analysis_orders_raw(jsonb)','1435201b5ebcb49e17011d4f09a2fa7c','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_live_query(jsonb)','396efe7ab32ea579475a7b72ab52597c','postgres','{postgres=X/postgres,authenticated=X/postgres}'),
('private.dashboard_admin_live_platforms()','9423bd69a95d21c9e6740c6709492395','postgres','{postgres=X/postgres,authenticated=X/postgres}'),
('private.dashboard_admin_live_provider_options(jsonb)','5c3d9e9612ef7acd3e0adf4a65d8e16c','postgres','{postgres=X/postgres,authenticated=X/postgres}'),
('private.dashboard_admin_live_expand_provider_filter(jsonb)','b07872f828acc18e8218ae6b2cc7d94e','postgres','{postgres=X/postgres,authenticated=X/postgres}'),
('private.dashboard_admin_live_intake_coverage(jsonb)','bc856a3698426d057fb51405b153f917','postgres','{postgres=X/postgres,authenticated=X/postgres}'),
('private.dashboard_admin_panda_capabilities(text)','b96efd846dc1131671cf5818f7ffa486','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_panda_provider(text)','c0697d60c37fcb4aab765be5cb6b1c7c','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_panda_provider_names(text,text)','246fdb6fa8a8ab3db675c629269e1f35','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_panda_order_source()','06271cc443dd7e3d32e211064f0b745d','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_panda_range_evidence(text,text,timestamptz,timestamptz)','af178a64713eccb10f42a6df964863ec','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_panda_day_evidence(text,text,date)','050b6b2b06abfe4db65fa052497a3c0e','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_panda_query_coverage(text,text,timestamptz,timestamptz)','19c808267463c60201a6945ab255d121','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_panda_order_result(jsonb)','3d7f080f728cd65522419b54ba87fdd6','postgres','{postgres=X/postgres}'),
('private.dashboard_admin_panda_alias_input(jsonb)','6d80139d9eec79d2e7c65dda829ab22b','postgres','{postgres=X/postgres}')) select signature,md5(p.prosrc)=e.body_md5 body_matches,p.proowner::regrole::text=e.owner owner_matches,
 p.proacl::text is not distinct from e.acl acl_matches,p.prosecdef,p.proconfig
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature) order by signature;

-- One scope at a time, administrator's authorized kernel verification.
-- This does NOT substitute for an authenticated frontend/gateway smoke test.
begin read only;
set local statement_timeout='8s';
select private.dashboard_admin_panda_range_evidence('2V222','charge','2026-10-01T03:00:00Z','2026-10-02T03:00:00Z') as creation_evidence;
rollback;

-- No ANALYZE here: demonstrate the first/next provider-name index seeks without scanning all rows.
explain (format json) select provider_name from public.panda_order_details
where platform='platform_2v222' and direction='deposit' and provider_name is not null
order by provider_name limit 1;
explain (format json) select provider_name from public.panda_order_details
where platform='platform_2v222' and direction='deposit' and provider_name>'PIX'
order by provider_name limit 1;
