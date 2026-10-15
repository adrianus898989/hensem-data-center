-- Shadow-only provider snapshots. No target registration, cron activation or business data writes.
begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $install$
declare e jsonb;actual jsonb;installed boolean;
begin
if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_installer_denied';end if;
for e in select value from jsonb_array_elements($meta_dependency$[{"signature":"private.dashboard_admin_live_expand_provider_filter(jsonb)","body_md5":"b07872f828acc18e8218ae6b2cc7d94e","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_intake_coverage(jsonb)","body_md5":"bc856a3698426d057fb51405b153f917","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_intake_order_feeds(timestamp with time zone)","body_md5":"0560f55418f87b16a1e9a1a570ebb21f","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"1184","allargtypes":null,"argmodes":null,"argnames":"{p_asof}","arguments":"p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.dashboard_admin_live_platforms()","body_md5":"9423bd69a95d21c9e6740c6709492395","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":1000,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":true,"argtypes":"","allargtypes":"{2950,25,25,25,25,25,25,25,25}","argmodes":"{t,t,t,t,t,t,t,t,t}","argnames":"{id,name,team,country,scope_group,source,timezone,currency,source_name}","arguments":"","result":"TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)"},{"signature":"private.dashboard_admin_live_query(jsonb)","body_md5":"396efe7ab32ea579475a7b72ab52597c","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{\"action\": \"catalog\"}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_query_raw(jsonb)","body_md5":"8877cb8cee3ec54c65fa6400f590c11d","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{\"action\": \"catalog\"}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_remap_groups(jsonb, text, text, boolean)","body_md5":"0ce8e6980d543059024eb1010d600946","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 25 25 16","allargtypes":null,"argmodes":null,"argnames":"{p_rows,p_country,p_platform,p_daily}","arguments":"p_rows jsonb, p_country text, p_platform text, p_daily boolean DEFAULT false","result":"jsonb"},{"signature":"private.dashboard_admin_live_scope()","body_md5":"bab25103334aa222d6220a27881ce000","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"jsonb"},{"signature":"private.dashboard_admin_live_submission_analysis(jsonb)","body_md5":"08f4fda2ac67706ff667addfca4ffdf2","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off","enable_nestloop=off"],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"},{"signature":"private.dashboard_role_access()","body_md5":"423aab3bb0ec685aa745a18ea6b7811a","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"jsonb"},{"signature":"private.dashboard_role_context_valid()","body_md5":"4fe8d4b2586aef960d9ad5d0b826e426","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"boolean"},{"signature":"private.dashboard_role_require_gateway()","body_md5":"0e9013820396aab2c7230dc133c3888b","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"void"}]$meta_dependency$::jsonb)loop
 select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
 if actual is distinct from e then raise exception using errcode='55000',message='snapshot_dependency_function_drift',detail=e->>'signature';end if;
 end loop;
installed:=to_regclass('private.provider_snapshot_jobs')is not null;
if installed then
for e in select value from jsonb_array_elements($meta_installed$[{"signature":"private.dashboard_role_catalog()","body_md5":"c17ef47cce1d9d31d65431e4d5dde19a","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"i","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"jsonb"},{"signature":"public.dashboard_admin_execute(text, jsonb)","body_md5":"009ae170ac7df031cbec919bee4c8442","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25 3802","allargtypes":null,"argmodes":null,"argnames":"{p_page,p_request}","arguments":"p_page text, p_request jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_provider_snapshot(jsonb)","body_md5":"1aefbcd4f74092762329a6b6fe99502c","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_artifact_immutable()","body_md5":"be3063a3f9dbf0c802a267736163f228","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"trigger"},{"signature":"private.provider_snapshot_claim(text, integer)","body_md5":"b5a42d60738f676b320183435b87d1b2","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25 23","allargtypes":null,"argmodes":null,"argnames":"{p_worker,p_lease_seconds}","arguments":"p_worker text, p_lease_seconds integer DEFAULT 120","result":"jsonb"},{"signature":"private.provider_snapshot_complete(uuid, uuid, bigint, jsonb, jsonb)","body_md5":"57bb4fb51423ddbf59e356e54fee99b2","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":5,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 2950 20 3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_run_id,p_fence,p_payload,p_provenance}","arguments":"p_job_id uuid, p_run_id uuid, p_fence bigint, p_payload jsonb, p_provenance jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_compute_payload(jsonb, jsonb, text)","body_md5":"e771df2214096b0988cea30c1e130b09","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":3,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802 25","allargtypes":null,"argmodes":null,"argnames":"{p_target,p_request,p_component}","arguments":"p_target jsonb, p_request jsonb, p_component text","result":"jsonb"},{"signature":"private.provider_snapshot_dependency_token(jsonb)","body_md5":"bb55f7c959f987864b9eb2f1ca44b6be","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_target}","arguments":"p_target jsonb","result":"text"},{"signature":"private.provider_snapshot_dispatch(timestamp with time zone, integer)","body_md5":"7d123f5838e7c67ccf374ccf17a88e93","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":2,"variadic":0,"prokind":"f","proretset":false,"argtypes":"1184 23","allargtypes":null,"argmodes":null,"argnames":"{p_observed_at,p_interval_seconds}","arguments":"p_observed_at timestamp with time zone DEFAULT now(), p_interval_seconds integer DEFAULT 600","result":"jsonb"},{"signature":"private.provider_snapshot_enqueue(jsonb, jsonb, text, timestamp with time zone)","body_md5":"30c885963300c3f2241aa4defef18fee","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802 25 1184","allargtypes":null,"argmodes":null,"argnames":"{p_target,p_request,p_component,p_not_before}","arguments":"p_target jsonb, p_request jsonb, p_component text, p_not_before timestamp with time zone DEFAULT now()","result":"uuid"},{"signature":"private.provider_snapshot_fail(uuid, uuid, bigint, text)","body_md5":"f4b9c34e2ec3fe64f347894ec67f8182","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 2950 20 25","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_run_id,p_fence,p_error_code}","arguments":"p_job_id uuid, p_run_id uuid, p_fence bigint, p_error_code text","result":"boolean"},{"signature":"private.provider_snapshot_intake_rows_kernel(jsonb, text[], date, date, timestamp with time zone)","body_md5":"6e0177cc753d3bb635a62df1d9eb7a5f","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":5,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 1009 1082 1082 1184","allargtypes":null,"argmodes":null,"argnames":"{p_feeds,p_ids,p_from,p_to,p_asof}","arguments":"p_feeds jsonb, p_ids text[], p_from date, p_to date, p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.provider_snapshot_iso(timestamp with time zone)","body_md5":"149dc5b89d2b91a57c7472a798db1333","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"1184","allargtypes":null,"argmodes":null,"argnames":"{p_time}","arguments":"p_time timestamp with time zone","result":"text"},{"signature":"private.provider_snapshot_kernel_contract_current()","body_md5":"ac21d75d1aaae2f396c670530821e494","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"boolean"},{"signature":"private.provider_snapshot_native_catalog()","body_md5":"20bfe572c317e9e63ff18d418d3231f5","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":1000,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":true,"argtypes":"","allargtypes":"{2950,25,25,25,25,25,25,25,25}","argmodes":"{t,t,t,t,t,t,t,t,t}","argnames":"{id,name,team,country,scope_group,source,timezone,currency,source_name}","arguments":"","result":"TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)"},{"signature":"private.provider_snapshot_order_feeds_kernel(jsonb, timestamp with time zone)","body_md5":"cdb133b88c825d3ad2013b4de874c9c1","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 1184","allargtypes":null,"argmodes":null,"argnames":"{p_catalog,p_asof}","arguments":"p_catalog jsonb, p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.provider_snapshot_orders_raw_kernel(jsonb, jsonb)","body_md5":"d4f9fec4111a4afdb07f4b40e833b24f","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_request,p_catalog}","arguments":"p_request jsonb, p_catalog jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_orders_result_kernel(jsonb, jsonb)","body_md5":"715baaebbacef17e302c4c6721d776ef","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_result,p_request}","arguments":"p_result jsonb, p_request jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_prepare_claim(text)","body_md5":"1d107b3d2286643e17952bcb971a00fc","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25","allargtypes":null,"argmodes":null,"argnames":"{p_worker}","arguments":"p_worker text","result":"jsonb"},{"signature":"private.provider_snapshot_register_target(jsonb, boolean)","body_md5":"c8f1df4cdb3acdd1a8ca78fa33d16fa3","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 16","allargtypes":null,"argmodes":null,"argnames":"{p_target,p_enabled}","arguments":"p_target jsonb, p_enabled boolean DEFAULT true","result":"jsonb"},{"signature":"private.provider_snapshot_renew(uuid, uuid, bigint, integer)","body_md5":"39a7e7970701e93db1a47ea493d415ff","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 2950 20 23","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_run_id,p_fence,p_lease_seconds}","arguments":"p_job_id uuid, p_run_id uuid, p_fence bigint, p_lease_seconds integer DEFAULT 120","result":"boolean"},{"signature":"private.provider_snapshot_requeue(uuid, timestamp with time zone)","body_md5":"8c0720a228ba979092acdc469dc71899","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 1184","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_not_before}","arguments":"p_job_id uuid, p_not_before timestamp with time zone DEFAULT now()","result":"boolean"},{"signature":"private.provider_snapshot_run_claimed(text)","body_md5":"e835c7b23fe9acfd314ced1961b85ef5","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25","allargtypes":null,"argmodes":null,"argnames":"{p_worker}","arguments":"p_worker text","result":"jsonb"},{"signature":"private.provider_snapshot_submission_kernel(jsonb, jsonb)","body_md5":"3d1188218a0aada52cfd2a5d6dbcbed6","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off","enable_nestloop=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_request,p_catalog}","arguments":"p_request jsonb, p_catalog jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_target(jsonb)","body_md5":"ef472533cf24b3bb6cb6d739c0ecb91d","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"i","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_target}","arguments":"p_target jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_target_current(jsonb)","body_md5":"6f13cbb170779ada75dddd91b5377bbe","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_target}","arguments":"p_target jsonb","result":"boolean"},{"signature":"public.dashboard_admin_provider_snapshot(jsonb)","body_md5":"8cce331c7834298f8c15dc2b4445b61d","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"}]$meta_installed$::jsonb)loop
 select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
 if actual is distinct from e then raise exception using errcode='55000',message='snapshot_installed_function_drift',detail=e->>'signature';end if;
 end loop;
for e in select value from jsonb_array_elements($tables$[{"name":"private.provider_snapshot_artifacts","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["id","uuid",true,"","","gen_random_uuid()"],["job_id","uuid",true,"","",null],["run_id","uuid",true,"","",null],["fence","bigint",true,"","",null],["revision","bigint",true,"","",null],["dependency_token","text",true,"","",null],["payload","jsonb",true,"","",null],["payload_hash","text",true,"","",null],["stored_bytes","integer",true,"","",null],["provenance","jsonb",true,"","",null],["next_due_at","timestamp with time zone",false,"","",null],["computed_at","timestamp with time zone",true,"","","clock_timestamp()"]],"constraints":[["provider_snapshot_artifacts_job_id_fkey","f","FOREIGN KEY (job_id) REFERENCES private.provider_snapshot_jobs(id)",true,false,false],["provider_snapshot_artifacts_job_id_run_id_key","u","UNIQUE (job_id, run_id)",true,false,false],["provider_snapshot_artifacts_payload_check","c","CHECK (jsonb_typeof(payload) = 'object'::text)",true,false,false],["provider_snapshot_artifacts_pkey","p","PRIMARY KEY (id)",true,false,false],["provider_snapshot_artifacts_provenance_check","c","CHECK (jsonb_typeof(provenance) = 'object'::text)",true,false,false],["provider_snapshot_artifacts_stored_bytes_check","c","CHECK (stored_bytes > 0)",true,false,false]],"indexes":[["private.provider_snapshot_artifacts_job_id_run_id_key","CREATE UNIQUE INDEX provider_snapshot_artifacts_job_id_run_id_key ON private.provider_snapshot_artifacts USING btree (job_id, run_id)",true,true,true,true,true],["private.provider_snapshot_artifacts_pkey","CREATE UNIQUE INDEX provider_snapshot_artifacts_pkey ON private.provider_snapshot_artifacts USING btree (id)",true,true,true,true,true]],"triggers":[["provider_snapshot_artifact_immutable","O","CREATE TRIGGER provider_snapshot_artifact_immutable BEFORE UPDATE ON private.provider_snapshot_artifacts FOR EACH ROW EXECUTE FUNCTION private.provider_snapshot_artifact_immutable()"]],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_cohort_jobs","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["cohort_id","uuid",true,"","",null],["job_id","uuid",true,"","",null]],"constraints":[["provider_snapshot_cohort_jobs_cohort_id_fkey","f","FOREIGN KEY (cohort_id) REFERENCES private.provider_snapshot_cohorts(id)",true,false,false],["provider_snapshot_cohort_jobs_job_id_fkey","f","FOREIGN KEY (job_id) REFERENCES private.provider_snapshot_jobs(id)",true,false,false],["provider_snapshot_cohort_jobs_pkey","p","PRIMARY KEY (cohort_id, job_id)",true,false,false]],"indexes":[["private.provider_snapshot_cohort_jobs_job","CREATE INDEX provider_snapshot_cohort_jobs_job ON private.provider_snapshot_cohort_jobs USING btree (job_id)",true,true,true,false,true],["private.provider_snapshot_cohort_jobs_pkey","CREATE UNIQUE INDEX provider_snapshot_cohort_jobs_pkey ON private.provider_snapshot_cohort_jobs USING btree (cohort_id, job_id)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_cohorts","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["id","uuid",true,"","","gen_random_uuid()"],["lane","text",true,"","",null],["local_date","date",true,"","",null],["cutoff","timestamp with time zone",true,"","",null],["supplement_pass","integer",true,"","",null],["roster_token","text",true,"","",null],["targets","jsonb",true,"","",null],["status","text",true,"","","'building'::text"],["created_at","timestamp with time zone",true,"","","clock_timestamp()"],["updated_at","timestamp with time zone",true,"","","clock_timestamp()"]],"constraints":[["provider_snapshot_cohorts_lane_check","c","CHECK (lane = ANY (ARRAY['current'::text, 'closed'::text]))",true,false,false],["provider_snapshot_cohorts_lane_local_date_cutoff_supplement_key","u","UNIQUE (lane, local_date, cutoff, supplement_pass, roster_token)",true,false,false],["provider_snapshot_cohorts_pkey","p","PRIMARY KEY (id)",true,false,false],["provider_snapshot_cohorts_status_check","c","CHECK (status = ANY (ARRAY['building'::text, 'ready'::text, 'failed'::text, 'obsolete'::text]))",true,false,false],["provider_snapshot_cohorts_supplement_pass_check","c","CHECK (supplement_pass >= 0 AND supplement_pass <= 2)",true,false,false],["provider_snapshot_cohorts_targets_check","c","CHECK (jsonb_typeof(targets) = 'array'::text)",true,false,false]],"indexes":[["private.provider_snapshot_cohorts_lane_local_date_cutoff_supplement_key","CREATE UNIQUE INDEX provider_snapshot_cohorts_lane_local_date_cutoff_supplement_key ON private.provider_snapshot_cohorts USING btree (lane, local_date, cutoff, supplement_pass, roster_token)",true,true,true,true,true],["private.provider_snapshot_cohorts_pkey","CREATE UNIQUE INDEX provider_snapshot_cohorts_pkey ON private.provider_snapshot_cohorts USING btree (id)",true,true,true,true,true],["private.provider_snapshot_one_active_cohort","CREATE UNIQUE INDEX provider_snapshot_one_active_cohort ON private.provider_snapshot_cohorts USING btree ((true)) WHERE (status = 'building'::text)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_heads","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["job_id","uuid",true,"","",null],["snapshot_id","uuid",true,"","",null],["published_at","timestamp with time zone",true,"","","clock_timestamp()"]],"constraints":[["provider_snapshot_heads_job_id_fkey","f","FOREIGN KEY (job_id) REFERENCES private.provider_snapshot_jobs(id)",true,false,false],["provider_snapshot_heads_pkey","p","PRIMARY KEY (job_id)",true,false,false],["provider_snapshot_heads_snapshot_id_fkey","f","FOREIGN KEY (snapshot_id) REFERENCES private.provider_snapshot_artifacts(id)",true,false,false],["provider_snapshot_heads_snapshot_id_key","u","UNIQUE (snapshot_id)",true,false,false]],"indexes":[["private.provider_snapshot_heads_pkey","CREATE UNIQUE INDEX provider_snapshot_heads_pkey ON private.provider_snapshot_heads USING btree (job_id)",true,true,true,true,true],["private.provider_snapshot_heads_snapshot_id_key","CREATE UNIQUE INDEX provider_snapshot_heads_snapshot_id_key ON private.provider_snapshot_heads USING btree (snapshot_id)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_jobs","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["id","uuid",true,"","","gen_random_uuid()"],["request_key","jsonb",true,"","",null],["target","jsonb",true,"","",null],["request","jsonb",true,"","",null],["component","text",true,"","",null],["platform_id","uuid",true,"","",null],["window_from","timestamp with time zone",true,"","",null],["window_to","timestamp with time zone",true,"","",null],["dependency_token","text",true,"","",null],["revision","bigint",true,"","","1"],["fence","bigint",true,"","","0"],["run_id","uuid",false,"","",null],["worker","text",false,"","",null],["claim_backend_pid","integer",false,"","",null],["claim_backend_start","timestamp with time zone",false,"","",null],["lease_until","timestamp with time zone",false,"","",null],["status","text",true,"","","'queued'::text"],["attempts","integer",true,"","","0"],["not_before","timestamp with time zone",true,"","","now()"],["next_due_at","timestamp with time zone",false,"","",null],["last_error_code","text",false,"","",null],["created_at","timestamp with time zone",true,"","","now()"],["updated_at","timestamp with time zone",true,"","","now()"]],"constraints":[["provider_snapshot_jobs_attempts_check","c","CHECK (attempts >= 0)",true,false,false],["provider_snapshot_jobs_check","c","CHECK (window_to > window_from)",true,false,false],["provider_snapshot_jobs_component_check","c","CHECK (component = ANY (ARRAY['orders'::text, 'submission'::text, 'intake'::text]))",true,false,false],["provider_snapshot_jobs_fence_check","c","CHECK (fence >= 0)",true,false,false],["provider_snapshot_jobs_pkey","p","PRIMARY KEY (id)",true,false,false],["provider_snapshot_jobs_request_check","c","CHECK (jsonb_typeof(request) = 'object'::text)",true,false,false],["provider_snapshot_jobs_request_key_key","u","UNIQUE (request_key)",true,false,false],["provider_snapshot_jobs_revision_check","c","CHECK (revision > 0)",true,false,false],["provider_snapshot_jobs_status_check","c","CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text]))",true,false,false],["provider_snapshot_jobs_target_check","c","CHECK (jsonb_typeof(target) = 'object'::text)",true,false,false]],"indexes":[["private.provider_snapshot_jobs_due","CREATE INDEX provider_snapshot_jobs_due ON private.provider_snapshot_jobs USING btree (status, not_before, lease_until)",true,true,true,false,true],["private.provider_snapshot_jobs_pkey","CREATE UNIQUE INDEX provider_snapshot_jobs_pkey ON private.provider_snapshot_jobs USING btree (id)",true,true,true,true,true],["private.provider_snapshot_jobs_request_key_key","CREATE UNIQUE INDEX provider_snapshot_jobs_request_key_key ON private.provider_snapshot_jobs USING btree (request_key)",true,true,true,true,true],["private.provider_snapshot_jobs_window","CREATE INDEX provider_snapshot_jobs_window ON private.provider_snapshot_jobs USING btree (platform_id, window_from, window_to DESC, component)",true,true,true,false,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_schedule_state","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["singleton","boolean",true,"","","true"],["pending_current_cutoff","timestamp with time zone",false,"","",null],["last_lane","text",false,"","",null]],"constraints":[["provider_snapshot_schedule_state_last_lane_check","c","CHECK (last_lane = ANY (ARRAY['current'::text, 'closed'::text]))",true,false,false],["provider_snapshot_schedule_state_pkey","p","PRIMARY KEY (singleton)",true,false,false],["provider_snapshot_schedule_state_singleton_check","c","CHECK (singleton)",true,false,false]],"indexes":[["private.provider_snapshot_schedule_state_pkey","CREATE UNIQUE INDEX provider_snapshot_schedule_state_pkey ON private.provider_snapshot_schedule_state USING btree (singleton)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_targets","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["platform_id","uuid",true,"","",null],["target","jsonb",true,"","",null],["enabled","boolean",true,"","","true"],["updated_at","timestamp with time zone",true,"","","clock_timestamp()"]],"constraints":[["provider_snapshot_targets_pkey","p","PRIMARY KEY (platform_id)",true,false,false],["provider_snapshot_targets_target_check","c","CHECK (jsonb_typeof(target) = 'object'::text)",true,false,false]],"indexes":[["private.provider_snapshot_targets_pkey","CREATE UNIQUE INDEX provider_snapshot_targets_pkey ON private.provider_snapshot_targets USING btree (platform_id)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0}]$tables$::jsonb)loop
 select to_jsonb(q)into actual from(select n.nspname||'.'||c.relname name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner)owner,c.relacl::text acl,
(select coalesce(jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))order by a.attnum),'[]')from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)columns,
(select coalesce(jsonb_agg(jsonb_build_array(k.conname,k.contype,pg_get_constraintdef(k.oid,true),k.convalidated,k.condeferrable,k.condeferred)order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid and k.contype<>'n')constraints,
(select coalesce(jsonb_agg(jsonb_build_array(i.indexrelid::regclass::text,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indimmediate)order by i.indexrelid::regclass::text),'[]')from pg_index i where i.indrelid=c.oid)indexes,
(select coalesce(jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true))order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)triggers,
(select count(*)from pg_policy pol where pol.polrelid=c.oid)policies,
(select count(*)from pg_inherits h where h.inhparent=c.oid or h.inhrelid=c.oid)inheritance
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid=to_regclass(e->>'name'))q;
 if actual is distinct from e then raise exception using errcode='55000',message='snapshot_table_drift',detail=e->>'name';end if;
 end loop;
return;end if;
for e in select value from jsonb_array_elements($meta_baseline$[{"signature":"private.dashboard_role_catalog()","body_md5":"884f974e27ae09afbe7375b824191874","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"i","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"jsonb"},{"signature":"public.dashboard_admin_execute(text, jsonb)","body_md5":"f4070e4c3b21d717ddd445d7384964f0","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25 3802","allargtypes":null,"argmodes":null,"argnames":"{p_page,p_request}","arguments":"p_page text, p_request jsonb","result":"jsonb"}]$meta_baseline$::jsonb)loop
 select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
 if actual is distinct from e then raise exception using errcode='55000',message='snapshot_baseline_function_drift',detail=e->>'signature';end if;
 end loop;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and p.proname like 'provider_snapshot_%')or to_regprocedure('private.dashboard_admin_live_provider_snapshot(jsonb)')is not null or to_regprocedure('public.dashboard_admin_provider_snapshot(jsonb)')is not null or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and c.relname like 'provider_snapshot_%')then raise exception using errcode='55000',message='snapshot_partial_install';end if;
execute $payload$set local check_function_bodies=off;
-- BEGIN native-catalog.sql
-- Exact native catalog branches extracted from the current authorized catalog.
-- Maintenance-only universe: no Auth/JWT/session context is installed or impersonated.
-- Keep the source/catalog definition fingerprint guarded when installing this copy.
create function private.provider_snapshot_native_catalog()
returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)
language sql stable security invoker set search_path=''as $native$
  with ar_targets as (
    select md5('ar:'||t.country_code||':'||src.platform)::uuid as id,
      coalesce(m.platform_name,t.platform)::text as name,
      case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end::text as team,
      t.country_name::text as country,t.country_code::text as scope_group,
      'ar'::text as source,
      coalesce(nullif(t.timezone,''),case t.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end)::text as timezone,
      coalesce(nullif(t.currency,''),case t.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end)::text as currency,
      src.platform::text as source_name
    from public.ar_config_targets t
    cross join lateral (
      select case when t.country_code='IN' and upper(btrim(t.platform))='SHREEWIN'
        and not exists(select 1 from public.ar_collected_orders a where a.country_code=t.country_code
          and a.platform=t.platform and a.source_system='AR' and a.order_kind in ('recharge','withdraw') offset 0)
        then 'Shree.Win' else t.platform end as platform
    ) src
    left join public.dashboard_platform_team_map m on m.active
      and m.source_system=case when t.source_system='NEW_AR' then 'NEW_AR' else 'AR' end
      and (m.source_country=t.country_name or m.source_country=t.country_code)
      and upper(btrim(m.source_platform))=upper(btrim(src.platform))
    where true
      and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
        where n.platform=t.platform and n.country_code=t.country_code and n.enabled
          and (n.launch_at is null or n.launch_at<=now()) offset 0))
  ),
  ar_mapped_only as (
    select md5('ar:'||m.country_code||':'||m.source_platform)::uuid as id,
      m.platform_name::text as name,case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end::text as team,m.country_name::text as country,
      m.country_code::text as scope_group,'ar'::text as source,
      case m.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end::text as timezone,
      case m.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end::text as currency,
      m.source_platform::text as source_name
    from public.dashboard_platform_team_map m
    where m.active and m.source_system='AR'
      and true
      and not exists(select 1 from public.ar_config_targets t
        where t.country_code=m.country_code
          and upper(btrim(t.platform))=upper(btrim(m.source_platform)))
  )
  select a.id,a.name,a.team,a.country,a.scope_group,a.source,a.timezone,a.currency,a.source_name from ar_targets a
  union all
  select a.id,a.name,a.team,a.country,a.scope_group,a.source,a.timezone,a.currency,a.source_name from ar_mapped_only a
  union all
  select md5('newar:'||n.country_code||':'||n.platform)::uuid,
    coalesce(m.platform_name,n.platform),case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end,n.country,n.country_code,
    'newar'::text,n.timezone,n.currency,n.platform
  from public.newar_detail_platforms n
  left join public.dashboard_platform_team_map m on m.active and m.source_system='NEW_AR'
    and (m.source_country=n.country or m.source_country=n.country_code)
    and upper(btrim(m.source_platform))=upper(btrim(n.platform))
  where n.enabled and (n.launch_at is null or n.launch_at<=now())
    and true
  union all
 select md5('kb:IN:YASH.BET')::uuid,coalesce(m.platform_name,'YASH.BET'),m.team_name,'印度'::text,'IN'::text,
  'kb'::text,'Asia/Kolkata'::text,'INR'::text,'YASH.BET'::text
 from (values(1))s(n)
 left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
  where t.active and t.source_system='KB' and t.country_code='IN' and upper(btrim(t.source_platform))='YASH.BET'
  order by (t.source_country='IN') desc,t.source_country limit 1)m on true
 where true


$native$;
revoke all on function private.provider_snapshot_native_catalog()from public,anon,authenticated,service_role;
-- END native-catalog.sql

-- BEGIN snapshot-objects.sql
-- Offline shadow foundation. No schedule is activated and no existing source is rewritten.
create table private.provider_snapshot_targets (
 platform_id uuid primary key,target jsonb not null check(jsonb_typeof(target)='object'),enabled boolean not null default true,
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.provider_snapshot_targets enable row level security;
revoke all on private.provider_snapshot_targets from public,anon,authenticated,service_role;
create table private.provider_snapshot_jobs (
 id uuid primary key default gen_random_uuid(),request_key jsonb not null unique,
 target jsonb not null,request jsonb not null,component text not null check(component in('orders','submission','intake')),
 platform_id uuid not null,window_from timestamptz not null,window_to timestamptz not null,
 dependency_token text not null,revision bigint not null default 1 check(revision>0),fence bigint not null default 0 check(fence>=0),
 run_id uuid,worker text,claim_backend_pid integer,claim_backend_start timestamptz,lease_until timestamptz,status text not null default 'queued' check(status in('queued','running','ready','failed')),
 attempts integer not null default 0 check(attempts>=0),not_before timestamptz not null default now(),
 next_due_at timestamptz,last_error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(window_to>window_from),check(jsonb_typeof(target)='object'),check(jsonb_typeof(request)='object')
);
create index provider_snapshot_jobs_due on private.provider_snapshot_jobs(status,not_before,lease_until);
create index provider_snapshot_jobs_window on private.provider_snapshot_jobs(platform_id,window_from,window_to desc,component);
create table private.provider_snapshot_artifacts (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references private.provider_snapshot_jobs(id),
 run_id uuid not null,fence bigint not null,revision bigint not null,dependency_token text not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),payload_hash text not null,stored_bytes integer not null check(stored_bytes>0),
 provenance jsonb not null check(jsonb_typeof(provenance)='object'),next_due_at timestamptz,computed_at timestamptz not null default clock_timestamp(),
 unique(job_id,run_id)
);
create table private.provider_snapshot_heads (
 job_id uuid primary key references private.provider_snapshot_jobs(id),
 snapshot_id uuid not null unique references private.provider_snapshot_artifacts(id),published_at timestamptz not null default clock_timestamp()
);
alter table private.provider_snapshot_jobs enable row level security;
alter table private.provider_snapshot_artifacts enable row level security;
alter table private.provider_snapshot_heads enable row level security;
revoke all on private.provider_snapshot_jobs,private.provider_snapshot_artifacts,private.provider_snapshot_heads from public,anon,authenticated,service_role;

create function private.provider_snapshot_artifact_immutable()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin raise exception using errcode='55000',message='snapshot_artifact_immutable';end;$fn$;
revoke all on function private.provider_snapshot_artifact_immutable()from public,anon,authenticated,service_role;
create trigger provider_snapshot_artifact_immutable before update on private.provider_snapshot_artifacts for each row execute function private.provider_snapshot_artifact_immutable();

create function private.provider_snapshot_iso(p_time timestamptz)
returns text language sql stable security invoker set search_path='' as $fn$
 select to_char(p_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$fn$;
revoke all on function private.provider_snapshot_iso(timestamptz)from public,anon,authenticated,service_role;

create function private.provider_snapshot_target(p_target jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $fn$
declare k text;u uuid;
begin
 if jsonb_typeof(p_target)is distinct from'object'or p_target-array['id','name','team','country','scope_group','source','timezone','currency','source_name']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_snapshot_target';end if;
 foreach k in array array['id','name','country','scope_group','source','timezone','currency','source_name']loop
  if jsonb_typeof(p_target->k)is distinct from'string'or length(p_target->>k)not between 1 and 200 or p_target->>k~'[[:cntrl:]]'then raise exception using errcode='22023',message='invalid_snapshot_target';end if;
 end loop;
 if p_target?'team'and p_target->'team'<>'null'::jsonb and(jsonb_typeof(p_target->'team')is distinct from'string'or length(p_target->>'team')>200)then raise exception using errcode='22023',message='invalid_snapshot_target';end if;
 if p_target->>'id'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'then raise exception using errcode='22023',message='invalid_snapshot_target';end if;u:=(p_target->>'id')::uuid;
 if p_target->>'source'not in('ar','newar','kb')or p_target->>'scope_group'<>'IN'or p_target->>'currency'<>'INR'or p_target->>'timezone'not in('Asia/Kolkata','Asia/Calcutta')then raise exception using errcode='22023',message='unsupported_snapshot_target';end if;
 return p_target||jsonb_build_object('id',u::text,'team',p_target->'team');
end;$fn$;
revoke all on function private.provider_snapshot_target(jsonb)from public,anon,authenticated,service_role;

-- Trusted target registration never grants any employee/user access. Both the roster
-- AND current native catalog must agree; a removed/disabled/remapped source cannot publish.
create function private.provider_snapshot_target_current(p_target jsonb)
returns boolean language sql stable security invoker set search_path=''as $fn$
 select exists(select 1 from private.provider_snapshot_targets t
  where t.platform_id=(p_target->>'id')::uuid and t.enabled and t.target=p_target)
 and (select count(*)=1 and bool_and(to_jsonb(n)=p_target)
  from private.provider_snapshot_native_catalog()n where n.id=(p_target->>'id')::uuid);
$fn$;
revoke all on function private.provider_snapshot_target_current(jsonb)from public,anon,authenticated,service_role;
create function private.provider_snapshot_register_target(p_target jsonb,p_enabled boolean default true)
returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
declare t jsonb;
begin
 t:=private.provider_snapshot_target(p_target);
 if p_enabled is null or not(select count(*)=1 and bool_and(to_jsonb(n)=t)from private.provider_snapshot_native_catalog()n where n.id=(t->>'id')::uuid)then
  raise exception using errcode='22023',message='snapshot_target_not_current';end if;
 insert into private.provider_snapshot_targets(platform_id,target,enabled)values((t->>'id')::uuid,t,p_enabled)
 on conflict(platform_id)do update set target=excluded.target,enabled=excluded.enabled,updated_at=clock_timestamp();
 return t;
end;$fn$;
revoke all on function private.provider_snapshot_register_target(jsonb,boolean)from public,anon,authenticated,service_role;

-- Content-derived semantic/configuration dependencies; observation timestamps and volume counters
-- do not invalidate canonical mapping. This is not a source data completeness watermark.
create function private.provider_snapshot_dependency_token(p_target jsonb)
returns text language sql stable security invoker set search_path='' as $fn$
 select md5(jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(p.prosrc),p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  'feeHead',(select coalesce(jsonb_agg(jsonb_build_array(source_key,semantic_hash,projection_hash,evidence_hash)order by source_key),'[]'::jsonb)from private.fee_rate_head),
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text);
$fn$;
revoke all on function private.provider_snapshot_dependency_token(jsonb)from public,anon,authenticated,service_role;

create function private.provider_snapshot_enqueue(p_target jsonb,p_request jsonb,p_component text,p_not_before timestamptz default now())
returns uuid language plpgsql volatile security invoker set search_path='' as $fn$
declare t jsonb;q jsonb;k jsonb;f timestamptz;e timestamptz;j uuid;
begin
 t:=private.provider_snapshot_target(p_target);
 if not private.provider_snapshot_target_current(t)then raise exception using errcode='22023',message='snapshot_target_not_current';end if;
 if p_component not in('orders','submission','intake')or p_component is null or p_not_before is null or not isfinite(p_not_before)
  or jsonb_typeof(p_request)is distinct from'object'or p_request-array['action','view','platformId','startAt','endAt','direction','status','currency','offset','limit']<>'{}'::jsonb
  or p_request->>'action'is distinct from'aggregate'or p_request->>'view'is distinct from'providers'or p_request->>'platformId'is distinct from t->>'id'
  or p_request->>'direction'is distinct from'charge'or p_request->>'status'is distinct from'all'or p_request->>'currency'is distinct from'INR'
  or coalesce(p_request->'offset','0'::jsonb)<>'0'::jsonb or coalesce(p_request->'limit','20'::jsonb)<>'20'::jsonb
  or jsonb_typeof(p_request->'startAt')is distinct from'string'or jsonb_typeof(p_request->'endAt')is distinct from'string'
  or p_request->>'startAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
  or p_request->>'endAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
 then raise exception using errcode='22023',message='invalid_snapshot_request';end if;
 f:=(p_request->>'startAt')::timestamptz;e:=(p_request->>'endAt')::timestamptz;
 if not isfinite(f)or not isfinite(e)or e<=f or(e at time zone(t->>'timezone'))-(f at time zone(t->>'timezone'))>interval'1day'then raise exception using errcode='22023',message='unsupported_snapshot_window';end if;
 q:=p_request||jsonb_build_object('startAt',private.provider_snapshot_iso(f),'endAt',private.provider_snapshot_iso(e),'offset',0,'limit',20);
 k:=jsonb_build_object('version',1,'target',t,'component',p_component,'request',q);
 -- Bounded shadow footprint; do not evict last-good heads or silently truncate.
 if not exists(select 1 from private.provider_snapshot_jobs where request_key=k)and((select count(*)from private.provider_snapshot_jobs)>=5000 or(select count(*)from private.provider_snapshot_jobs where status='failed')>=500)then raise exception using errcode='54000',message='snapshot_queue_capacity';end if;
 insert into private.provider_snapshot_jobs(request_key,target,request,component,platform_id,window_from,window_to,dependency_token,not_before)
 values(k,t,q,p_component,(t->>'id')::uuid,f,e,private.provider_snapshot_dependency_token(t),p_not_before)
 on conflict(request_key)do nothing returning id into j;
 if j is null then select id into j from private.provider_snapshot_jobs where request_key=k;end if;return j;
end;$fn$;
revoke all on function private.provider_snapshot_enqueue(jsonb,jsonb,text,timestamptz)from public,anon,authenticated,service_role;

create function private.provider_snapshot_requeue(p_job_id uuid,p_not_before timestamptz default now())
returns boolean language plpgsql volatile security invoker set search_path='' as $fn$
begin
 if p_not_before is null or not isfinite(p_not_before)then raise exception using errcode='22023',message='invalid_snapshot_schedule';end if;
 update private.provider_snapshot_jobs set status='queued',revision=revision+1,run_id=null,worker=null,lease_until=null,attempts=0,
  dependency_token=private.provider_snapshot_dependency_token(target),not_before=p_not_before,last_error_code=null,updated_at=clock_timestamp()
 where id=p_job_id and private.provider_snapshot_target_current(target)and(status<>'running'or lease_until<=clock_timestamp());return found;
end;$fn$;
revoke all on function private.provider_snapshot_requeue(uuid,timestamptz)from public,anon,authenticated,service_role;

create function private.provider_snapshot_claim(p_worker text,p_lease_seconds integer default 120)
returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare j private.provider_snapshot_jobs%rowtype;
begin
 if p_worker is null or p_worker!~'^[a-zA-Z0-9_.:-]{1,80}$'or p_lease_seconds is null or p_lease_seconds not between 10 and 300 then raise exception using errcode='22023',message='invalid_snapshot_worker';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;
 if not private.provider_snapshot_kernel_contract_current()then return null;end if;
 -- The compute transaction may time out after its claim transaction committed.
 -- Expired third attempts are parked instead of silently retrying forever.
 update private.provider_snapshot_jobs set status='failed',worker=null,lease_until=null,last_error_code='worker_interrupted',updated_at=clock_timestamp()
 where status='running'and lease_until<=clock_timestamp()and attempts>=3;
 update private.provider_snapshot_jobs set status='failed',worker=null,lease_until=null,last_error_code='worker_interrupted',not_before=clock_timestamp()+interval'1minute',updated_at=clock_timestamp()
 where status='running'and lease_until<=clock_timestamp()and attempts<3;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 with verified as materialized(select t.target from private.provider_snapshot_targets t where t.enabled and private.provider_snapshot_target_current(t.target))
 select q.*into j from private.provider_snapshot_jobs q join verified v on v.target=q.target
 where q.not_before<=clock_timestamp()and q.attempts<3
  and(not exists(select 1 from private.provider_snapshot_cohort_jobs cj where cj.job_id=q.id)or exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_cohorts c on c.id=cj.cohort_id where cj.job_id=q.id and c.status='building'))
  and(q.status in('queued','failed')or q.status='running'and q.lease_until<=clock_timestamp())order by q.not_before,q.id for update of q skip locked limit 1;
 if not found then return null;end if;
 update private.provider_snapshot_jobs set status='running',fence=fence+1,run_id=gen_random_uuid(),worker=p_worker,claim_backend_pid=pg_backend_pid(),claim_backend_start=(select backend_start from pg_stat_activity where pid=pg_backend_pid()),lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
  attempts=attempts+1,dependency_token=private.provider_snapshot_dependency_token(target),last_error_code=null,updated_at=clock_timestamp()where id=j.id returning *into j;
 return jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence::text,'revision',j.revision::text,'target',j.target,'request',j.request,'component',j.component,'dependencyToken',j.dependency_token,'leaseUntil',private.provider_snapshot_iso(j.lease_until));
end;$fn$;
revoke all on function private.provider_snapshot_claim(text,integer)from public,anon,authenticated,service_role;

create function private.provider_snapshot_renew(p_job_id uuid,p_run_id uuid,p_fence bigint,p_lease_seconds integer default 120)
returns boolean language plpgsql volatile security invoker set search_path='' as $fn$
begin
 if p_lease_seconds is null or p_lease_seconds not between 10 and 300 then raise exception using errcode='22023',message='invalid_snapshot_lease';end if;
 update private.provider_snapshot_jobs set lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp()
 where id=p_job_id and run_id=p_run_id and fence=p_fence and status='running'and lease_until>clock_timestamp();return found;
end;$fn$;
revoke all on function private.provider_snapshot_renew(uuid,uuid,bigint,integer)from public,anon,authenticated,service_role;

create function private.provider_snapshot_complete(p_job_id uuid,p_run_id uuid,p_fence bigint,p_payload jsonb,p_provenance jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare j private.provider_snapshot_jobs%rowtype;s uuid;f timestamptz;e timestamptz;
begin
 select *into j from private.provider_snapshot_jobs where id=p_job_id for update;
 if not found or j.run_id is distinct from p_run_id or j.fence is distinct from p_fence then return jsonb_build_object('published',false,'reason','obsolete');end if;
 if not private.provider_snapshot_kernel_contract_current()then return jsonb_build_object('published',false,'reason','kernel_contract_changed');end if;
 if not private.provider_snapshot_target_current(j.target)then return jsonb_build_object('published',false,'reason','target_changed');end if;
 if j.dependency_token is distinct from private.provider_snapshot_dependency_token(j.target)then return jsonb_build_object('published',false,'reason','dependency_changed');end if;
 if j.status='ready'then
  select a.id into s from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
   where h.job_id=j.id and a.run_id=p_run_id and a.fence=p_fence and a.payload=p_payload and a.provenance=p_provenance;
  if found then return jsonb_build_object('published',true,'snapshotId',s,'replayed',true);end if;
  return jsonb_build_object('published',false,'reason','replay_mismatch');
 end if;
 if j.status<>'running'or j.lease_until<=clock_timestamp()then return jsonb_build_object('published',false,'reason','obsolete');end if;
 if jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>4194304 or jsonb_typeof(p_provenance)is distinct from'object'or octet_length(p_provenance::text)>65536
  or p_provenance->'computationComplete'is distinct from'true'::jsonb or jsonb_typeof(p_provenance->'upstreamComplete')is distinct from'boolean'
  or jsonb_typeof(p_provenance->'sourceWatermark')is distinct from'object'
  or jsonb_typeof(p_provenance->'sourceReadStartedAt')is distinct from'string'or jsonb_typeof(p_provenance->'sourceReadCompletedAt')is distinct from'string'
  or p_provenance->>'sourceReadStartedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'or p_provenance->>'sourceReadCompletedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
  or p_provenance?'nextDueAt'and p_provenance->'nextDueAt'<>'null'::jsonb and(jsonb_typeof(p_provenance->'nextDueAt')is distinct from'string'or p_provenance->>'nextDueAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$')
 then raise exception using errcode='22023',message='incomplete_snapshot';end if;
 f:=(p_provenance->>'sourceReadStartedAt')::timestamptz;e:=(p_provenance->>'sourceReadCompletedAt')::timestamptz;
 if not isfinite(f)or not isfinite(e)or e<f or e>clock_timestamp()+interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_provenance';end if;
 if j.component in('orders','submission','intake')then
  if p_payload->'version'is distinct from to_jsonb(case when j.component='submission'then 3 else 1 end) or p_payload#>>'{platform,id}'is distinct from j.target->>'id'
   or p_payload#>>'{platform,source}'is distinct from j.target->>'source'or p_payload#>>'{platform,sourceName}'is distinct from j.target->>'source_name'
   or p_payload#>>'{platform,scopeGroup}'is distinct from j.target->>'scope_group'or p_payload#>>'{platform,currency}'is distinct from j.target->>'currency'
   or p_payload#>>'{platform,timezone}'is distinct from j.target->>'timezone'
   or(case when j.component='intake'then p_payload#>>'{snapshotWindow,startAt}'else p_payload->>'startAt'end)::timestamptz is distinct from j.window_from or(case when j.component='intake'then p_payload#>>'{snapshotWindow,endAt}'else p_payload->>'endAt'end)::timestamptz is distinct from j.window_to
  then raise exception using errcode='22023',message='snapshot_scope_mismatch';end if;
 end if;
 if j.component='orders'and(jsonb_typeof(p_payload->'summary')is distinct from'array'or jsonb_typeof(p_payload#>'{groups,provider}')is distinct from'array'or p_payload->'rows'is distinct from'[]'::jsonb)then raise exception using errcode='22023',message='invalid_orders_snapshot';end if;
 if j.component='submission'and(jsonb_typeof(p_payload->'metrics')is distinct from'array'or jsonb_typeof(p_payload->'coverage')is distinct from'object'
  or p_payload->'rows'is not null and p_payload->'rows'<>'null'::jsonb or p_payload->'members'is not null and p_payload->'members'<>'null'::jsonb)then raise exception using errcode='22023',message='invalid_submission_snapshot';end if;
 if j.component='intake'and(p_payload->'version'is distinct from'1'::jsonb or jsonb_typeof(p_payload->'rows')is distinct from'array')then raise exception using errcode='22023',message='invalid_intake_snapshot';end if;
 if(select count(*)from private.provider_snapshot_artifacts)>=2048 or(select coalesce(sum(stored_bytes),0)from private.provider_snapshot_artifacts)+octet_length(p_payload::text)+octet_length(p_provenance::text)>268435456 then raise exception using errcode='54000',message='snapshot_artifact_capacity';end if;
 insert into private.provider_snapshot_artifacts(job_id,run_id,fence,revision,dependency_token,payload,payload_hash,stored_bytes,provenance,next_due_at)
 values(j.id,j.run_id,j.fence,j.revision,j.dependency_token,p_payload,md5(p_payload::text),octet_length(p_payload::text)+octet_length(p_provenance::text),p_provenance,coalesce(j.next_due_at,case when jsonb_typeof(p_provenance->'nextDueAt')='string'then(p_provenance->>'nextDueAt')::timestamptz end))returning id into s;
 insert into private.provider_snapshot_heads(job_id,snapshot_id)values(j.id,s)on conflict(job_id)do update set snapshot_id=excluded.snapshot_id,published_at=clock_timestamp();
 update private.provider_snapshot_jobs set status='ready',lease_until=null,worker=null,last_error_code=null,updated_at=clock_timestamp(),
 next_due_at=coalesce(next_due_at,case when jsonb_typeof(p_provenance->'nextDueAt')='string'then(p_provenance->>'nextDueAt')::timestamptz end) where id=j.id;
 return jsonb_build_object('published',true,'snapshotId',s);
end;$fn$;
revoke all on function private.provider_snapshot_complete(uuid,uuid,bigint,jsonb,jsonb)from public,anon,authenticated,service_role;

create function private.provider_snapshot_fail(p_job_id uuid,p_run_id uuid,p_fence bigint,p_error_code text)
returns boolean language plpgsql volatile security invoker set search_path='' as $fn$
begin
 if p_error_code not in('compute_timeout','compute_failed','source_incomplete','dependency_changed','invalid_payload','worker_interrupted')or p_error_code is null then raise exception using errcode='22023',message='invalid_snapshot_error';end if;
 update private.provider_snapshot_jobs set status='failed',last_error_code=p_error_code,worker=null,lease_until=null,not_before=clock_timestamp()+interval'1minute',updated_at=clock_timestamp()
 where id=p_job_id and run_id=p_run_id and fence=p_fence and status='running'and lease_until>clock_timestamp();return found;
end;$fn$;
revoke all on function private.provider_snapshot_fail(uuid,uuid,bigint,text)from public,anon,authenticated,service_role;
-- END snapshot-objects.sql

-- BEGIN snapshot-scheduler.sql
-- Metadata-only, postgres-only dispatcher. No cron is activated by this migration.
-- One complete native cohort at a time. New current cutoffs coalesce into one slot;
-- they never revise or preempt an in-progress cohort. Closed-day passes alternate
-- with current cohorts, and only a completed earlier pass permits the next pass.
create table private.provider_snapshot_cohorts(
 id uuid primary key default gen_random_uuid(),lane text not null check(lane in('current','closed')),
 local_date date not null,cutoff timestamptz not null,supplement_pass integer not null check(supplement_pass between 0 and 2),
 roster_token text not null,targets jsonb not null check(jsonb_typeof(targets)='array'),
 status text not null default 'building'check(status in('building','ready','failed','obsolete')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(lane,local_date,cutoff,supplement_pass,roster_token)
);
create unique index provider_snapshot_one_active_cohort on private.provider_snapshot_cohorts((true))where status='building';
create table private.provider_snapshot_cohort_jobs(
 cohort_id uuid not null references private.provider_snapshot_cohorts(id),job_id uuid not null references private.provider_snapshot_jobs(id),
 primary key(cohort_id,job_id)
);
create index provider_snapshot_cohort_jobs_job on private.provider_snapshot_cohort_jobs(job_id);
create table private.provider_snapshot_schedule_state(
 singleton boolean primary key default true check(singleton),pending_current_cutoff timestamptz,last_lane text check(last_lane in('current','closed'))
);
insert into private.provider_snapshot_schedule_state(singleton)values(true);
alter table private.provider_snapshot_cohorts enable row level security;
alter table private.provider_snapshot_cohort_jobs enable row level security;
alter table private.provider_snapshot_schedule_state enable row level security;
revoke all on private.provider_snapshot_cohorts,private.provider_snapshot_cohort_jobs,private.provider_snapshot_schedule_state from public,anon,authenticated,service_role;

create function private.provider_snapshot_dispatch(p_observed_at timestamptz default now(),p_interval_seconds integer default 600)
returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
declare r jsonb;rh text;c private.provider_snapshot_cohorts%rowtype;st private.provider_snapshot_schedule_state%rowtype;
 v_now timestamp;v_today date;v_cut timestamptz;v_current timestamptz;v_lane text;v_date date;v_pass integer;
 v_closed_date date;v_closed_pass integer;v_due timestamptz;v_closed_due timestamptz;v_end timestamptz;
 v_refresh record;v_target jsonb;v_component text;v_prior boolean;v_shift interval;v_from timestamptz;v_to timestamptz;q jsonb;j uuid;n integer;
begin
 if p_observed_at is null or not isfinite(p_observed_at)or p_observed_at>clock_timestamp()+interval'5seconds'
  or p_interval_seconds is null or p_interval_seconds not between 60 and 3600 then raise exception using errcode='22023',message='invalid_snapshot_schedule';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select coalesce(jsonb_agg(t.target order by t.platform_id),'[]')into r from private.provider_snapshot_targets t
  where t.enabled and private.provider_snapshot_target_current(t.target);
 if jsonb_array_length(r)not between 1 and 18 then return jsonb_build_object('status','no_verified_targets');end if;rh:=md5(r::text);
 v_now:=p_observed_at at time zone'Asia/Kolkata';v_today:=v_now::date;
 v_current:=(date_trunc('day',v_now)+make_interval(secs=>(floor(extract(epoch from(v_now-date_trunc('day',v_now)))/p_interval_seconds)*p_interval_seconds)::int))at time zone'Asia/Kolkata';
 if v_current>v_today::timestamp at time zone'Asia/Kolkata'then
  update private.provider_snapshot_schedule_state set pending_current_cutoff=greatest(pending_current_cutoff,v_current)where singleton;
 end if;
 update private.provider_snapshot_jobs set status='failed',worker=null,lease_until=null,last_error_code='worker_interrupted',updated_at=clock_timestamp()
 where status='running'and lease_until<=clock_timestamp()and attempts>=3;
 select *into st from private.provider_snapshot_schedule_state where singleton for update;
 select *into c from private.provider_snapshot_cohorts where status='building'for update;
 if found then
  -- Configuration can change after earlier components publish. Requeue only those
  -- completed components, without stealing any lease or replacing last-good heads.
  if c.roster_token=rh then
   for v_refresh in select j.id from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id
    join private.provider_snapshot_heads h on h.job_id=j.id join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
    where cj.cohort_id=c.id and j.status='ready'and a.dependency_token is distinct from private.provider_snapshot_dependency_token(j.target)loop
    perform private.provider_snapshot_requeue(v_refresh.id);
   end loop;
  end if;
  if c.roster_token<>rh then update private.provider_snapshot_cohorts set status='obsolete',updated_at=clock_timestamp()where id=c.id;
  elsif exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id where cj.cohort_id=c.id and j.status='failed'and j.attempts>=3)then
   update private.provider_snapshot_cohorts set status='failed',updated_at=clock_timestamp()where id=c.id;
  elsif not exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id
   left join private.provider_snapshot_heads h on h.job_id=j.id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
   where cj.cohort_id=c.id and(j.status<>'ready'or a.id is null or a.revision<>j.revision or a.dependency_token<>private.provider_snapshot_dependency_token(j.target)or not private.provider_snapshot_target_current(j.target)))then
   update private.provider_snapshot_cohorts set status='ready',updated_at=clock_timestamp()where id=c.id;
  else return jsonb_build_object('status','building','cohortId',c.id,'pendingCutoff',private.provider_snapshot_iso(st.pending_current_cutoff),'jobs',(select count(*)from private.provider_snapshot_cohort_jobs where cohort_id=c.id));end if;
 end if;
 -- A standalone/shutdown/obsolete worker also keeps its lease until it finishes.
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return jsonb_build_object('status','busy');end if;
 -- At most two prior local dates are considered: primary close + 2h + 24h.
 -- Exhausted failed cohorts stay parked for explicit operator review, never spin.
 for n in reverse 2..1 loop
  v_date:=v_today-n;v_end:=(v_date+1)::timestamp at time zone'Asia/Kolkata';
  for v_pass in 0..2 loop
   v_due:=v_end+case v_pass when 0 then interval'10minutes'when 1 then interval'2hours'else interval'24hours'end;
   if v_due>p_observed_at then exit;end if;
   if v_pass>0 and not exists(select 1 from private.provider_snapshot_cohorts where lane='closed'and local_date=v_date and supplement_pass=v_pass-1 and roster_token=rh and status='ready')then exit;end if;
   if not exists(select 1 from private.provider_snapshot_cohorts where lane='closed'and local_date=v_date and supplement_pass=v_pass and roster_token=rh)then
    if v_closed_due is null or v_due<v_closed_due then v_closed_due:=v_due;v_closed_date:=v_date;v_closed_pass:=v_pass;end if;exit;
   end if;
  end loop;
 end loop;
 v_cut:=st.pending_current_cutoff;
 if v_cut is not null and exists(select 1 from private.provider_snapshot_cohorts where lane='current'and cutoff=v_cut and roster_token=rh)then v_cut:=null;end if;
 if v_closed_date is not null and(st.last_lane='current'or v_cut is null)then v_lane:='closed';v_date:=v_closed_date;v_pass:=v_closed_pass;v_cut:=(v_date+1)::timestamp at time zone'Asia/Kolkata';
 elsif v_cut is not null then v_lane:='current';v_date:=(v_cut at time zone'Asia/Kolkata')::date;v_pass:=0;
 else return jsonb_build_object('status','idle');end if;
 insert into private.provider_snapshot_cohorts(lane,local_date,cutoff,supplement_pass,roster_token,targets)values(v_lane,v_date,v_cut,v_pass,rh,r)returning *into c;
 update private.provider_snapshot_schedule_state set last_lane=v_lane,pending_current_cutoff=case when v_lane='current'then null else pending_current_cutoff end where singleton;
 for v_component,v_prior in select *from(values('orders',false),('orders',true),('intake',false),('intake',true),('submission',false))v(component,prior)loop
  v_shift:=case when v_prior then interval'1day'else interval'0'end;
  v_from:=(v_date::timestamp-v_shift)at time zone'Asia/Kolkata';v_to:=((v_cut at time zone'Asia/Kolkata')-v_shift)at time zone'Asia/Kolkata';
  for v_target in select value from jsonb_array_elements(r)loop
   q:=jsonb_build_object('action','aggregate','view','providers','platformId',v_target->>'id','startAt',private.provider_snapshot_iso(v_from),'endAt',private.provider_snapshot_iso(v_to),'direction','charge','status','all','currency','INR','offset',0,'limit',20);
   j:=private.provider_snapshot_enqueue(v_target,q,v_component);
   if v_lane='closed'then perform private.provider_snapshot_requeue(j);end if;
   update private.provider_snapshot_jobs set next_due_at=case when v_lane='current'then v_cut+make_interval(secs=>p_interval_seconds)
    when v_pass=0 then v_cut+interval'2hours'when v_pass=1 then v_cut+interval'24hours'else null end where id=j;
   insert into private.provider_snapshot_cohort_jobs values(c.id,j);
  end loop;
 end loop;
 return jsonb_build_object('status','building','cohortId',c.id,'lane',c.lane,'supplementPass',c.supplement_pass,'cutoff',private.provider_snapshot_iso(c.cutoff),'jobs',(select count(*)from private.provider_snapshot_cohort_jobs where cohort_id=c.id),'upstreamFinalityProven',false);
end;$fn$;
revoke all on function private.provider_snapshot_dispatch(timestamptz,integer)from public,anon,authenticated,service_role;
-- END snapshot-scheduler.sql

-- BEGIN kernels.sql
CREATE OR REPLACE FUNCTION private.provider_snapshot_orders_raw_kernel(p_request jsonb,p_catalog jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $kernel$
declare
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  v_fee_country text; v_fee_currency_proven boolean := false;
  -- aggregate_exclusive_amount_max_v1: one parsed boolean, never epsilon math.
  v_max_exclusive boolean := false;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  v_options:=p_catalog;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit','view'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  if p_request ? 'view' and (jsonb_typeof(p_request->'view')<>'string' or p_request->>'view' not in ('full','providers') or v_action<>'aggregate') then
    raise exception using errcode='22023',message='invalid_view';
  end if;
  if v_action not in ('catalog','query','aggregate','details') then raise exception using errcode='22023',message='invalid_action'; end if;
  if v_action='catalog' then
    if p_request-array['action']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_catalog_request'; end if;
    return jsonb_build_object('version',1,'asOf',v_asof,'platforms',(
      select coalesce(jsonb_agg((p-array['scope_group','source_name'])||jsonb_build_object('scopeGroup',p->'scope_group','sourceName',p->'source_name',
        'capabilities',jsonb_build_object('systemOrderId',p->>'source'='newar','thirdPartyOrderNumber',p->>'source' in ('newar','game66'),'utr',false,
          'historicalFees',true,'actualAmount',p->>'source'<>'ar','recordedFee',p->>'source' in ('newar','game66'),'scopeGroupIsGeographicCountry',p->>'source'<>'game66')||case when p->>'source'='ar' then private.ar_middle_channel_capabilities((p->>'id')::uuid)
      when p->>'source'='panda' then private.dashboard_admin_panda_capabilities()
      when p->>'source'='kb' then private.dashboard_admin_yash_capabilities()
      when p->>'source'='duoli' then private.dashboard_admin_duoli_capabilities()
      when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end)),'[]'::jsonb)
      from jsonb_array_elements(v_options) p));
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'amountMaxExclusive' then
    if v_action<>'aggregate' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then
      raise exception using errcode='22023',message='invalid_range';
    end if;
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  -- Fee evidence is stricter than the legacy display projection. In particular
  -- a country-default AR currency is not source currency proof.
  v_fee_country:=v_platform.scope_group;
  if v_platform.source='ar' then
    v_fee_currency_proven:=exists(select 1 from public.ar_config_targets t
      where t.source_system='AR' and t.country_code=v_platform.scope_group and t.platform=v_platform.source_name
        and nullif(btrim(t.currency),'') is not null and t.currency=v_platform.currency);
  elsif v_platform.source in ('newar','wg') then
    -- These adapters project each order's explicit native currency.
    v_fee_currency_proven:=true;
  elsif v_platform.source='lg' then
    -- Existing confirmed LG adapters have an explicit currency contract; no
    -- generic country fallback or unknown-country adapter may price orders.
    v_fee_currency_proven:=case v_platform.scope_group when 'PH' then v_platform.currency='PHP'
      when 'ID' then v_platform.currency='IDR' when 'PK' then v_platform.currency='PKR' else false end;
  elsif v_platform.source='game66' then
    -- GAME66's source scope identifies the owning team, while its native
    -- monetary unit is explicitly INR. Authorization still uses that scope.
    v_fee_country:='IN';
    v_fee_currency_proven:=v_platform.scope_group in ('HK_TEAM','RED_CRAB') and v_platform.currency='INR';
  end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit not in (20,30,50,100,500)
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status not in ('all','success','pending','failed','rejected','unknown') then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',true,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    if v_status='success' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- ar_local_amount_known_inline_v1: only the fingerprinted native rule is
    -- expanded. A future amount-helper change retains the original call.
    if exists(select 1 from pg_catalog.pg_proc m
      where m.oid=pg_catalog.to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
        and pg_catalog.md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
        and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
        and m.provolatile='i' and m.proparallel='s' and not m.prosecdef and not m.proisstrict and not m.proleakproof
        and m.proconfig is not distinct from array['search_path=""']
        and m.proacl::text is not distinct from '{postgres=X/postgres}' and m.pronargdefaults=0
        and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8) then
      v_source:=replace(v_source,$ar_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))$ar_amount_call$,$ar_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
 END$ar_amount_case$);
    end if;
    -- custom_ar_date_union_v1: index each clock, retain each source row once.
    if position($ar_guard$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
    if v_action='aggregate' or v_status='success' then
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,false);
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;
  -- Group and page the identical materialized, filtered source set. The old
  -- detail RPC is never paged repeatedly to manufacture aggregate totals.
  -- Details lets PostgreSQL inline the shared predicate: COUNT can prune all
  -- display/time calculations, and the page can use source time indexes.
  -- Aggregate materializes only compact analytical values (no order IDs/MD5).
  v_sql:='with orders as ('||v_source||'), filtered as '||
    case when v_action='details' then 'not materialized' else 'materialized' end||$q$ (
    select case when $19<>'aggregate' then id end as id,
      case when $19<>'aggregate' then system_order_id end as system_order_id,
      case when $19<>'aggregate' then order_number end as order_number,
      case when $19<>'aggregate' then third_party_order_number end as third_party_order_number,
      case when $19<>'aggregate' then member_id end as member_id,provider,
      case when $19<>'aggregate' then raw_provider end as raw_provider,
      channel_type,direction,
      case when $19<>'aggregate' then status end as status,status_group,
      created_at,success_at,case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,
      case when $19<>'aggregate' and actual_amount::text not in ('NaN','Infinity','-Infinity') then actual_amount end as actual_amount,
      case when $19<>'aggregate' and withdraw_fee::text not in ('NaN','Infinity','-Infinity') then withdraw_fee end as withdraw_fee,
      currency,synced_at,utr,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      -- Disjoint amount ranges with the labels used by the admin UI. Integer
      -- boundaries are explicit: 100–200, 201–300, and so on. Every order
      -- remains in exactly one range; low/missing values stay visible.
      case when (case when direction='charge' then $25::numeric[] else $26::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $25::numeric[] else $26::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms,
      case when direction='withdraw' and status_group='pending' and created_at<=$20 then extract(epoch from $20-created_at)*1000 end as pending_wait_ms
    from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
  ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), created_metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,
      case when grouping(local_date)=0 then 'daily' when grouping(local_hour,amount_bucket)=0 then 'matrix'
        when grouping(local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      count(*) as all_count,case when count(amount)=count(*) then sum(amount) end as all_amount,
      count(*) filter(where amount is null) as missing_amount_count,
      count(*) filter(where amount<0) as negative_amount_count,
      count(*) filter(where status_group='success') as created_success_count,
      0::bigint as success_count,0::numeric as success_amount,
      count(*) filter(where status_group='pending') as pending_count,
      case when count(amount) filter(where status_group='pending')=count(*) filter(where status_group='pending') then coalesce(sum(amount) filter(where status_group='pending'),0) end as pending_amount,
      count(*) filter(where status_group='failed') as failed_count,
      case when count(amount) filter(where status_group='failed')=count(*) filter(where status_group='failed') then coalesce(sum(amount) filter(where status_group='failed'),0) end as failed_amount,
      count(*) filter(where status_group='rejected') as rejected_count,
      case when count(amount) filter(where status_group='rejected')=count(*) filter(where status_group='rejected') then coalesce(sum(amount) filter(where status_group='rejected'),0) end as rejected_amount,
      count(*) filter(where status_group='unknown') as unknown_count,
      case when count(amount) filter(where status_group='unknown')=count(*) filter(where status_group='unknown') then coalesce(sum(amount) filter(where status_group='unknown'),0) end as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and created_in_range and $8<>'success'
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,local_date),(direction,currency,local_hour),
      (direction,currency,amount_bucket),(direction,currency,local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,local_hour,amount_range_bucket))
  ), success_metrics as (
    select direction,currency,provider,success_local_date as local_date,success_local_hour as local_hour,amount_bucket,amount_range_bucket,
      case when grouping(success_local_date)=0 then 'daily' when grouping(success_local_hour,amount_bucket)=0 then 'matrix'
        when grouping(success_local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(success_local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      case when $8='success' then count(*) else 0 end as all_count,
      case when $8='success' then case when count(amount)=count(*) then sum(amount) end else 0 end as all_amount,
      case when $8='success' then count(*) filter(where amount is null) else 0 end as missing_amount_count,
      case when $8='success' then count(*) filter(where amount<0) else 0 end as negative_amount_count,
      0::bigint as created_success_count,
      count(*) as success_count,
      case when count(amount)=count(*) then coalesce(sum(amount),0) end as success_amount,
      0::bigint as pending_count,0::numeric as pending_amount,
      0::bigint as failed_count,0::numeric as failed_amount,
      0::bigint as rejected_count,0::numeric as rejected_amount,
      0::bigint as unknown_count,0::numeric as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and status_group='success' and success_in_range and $8 in ('all','success')
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,success_local_date),(direction,currency,success_local_hour),
      (direction,currency,amount_bucket),(direction,currency,success_local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,success_local_hour,amount_range_bucket))
  ), metrics_raw as (
    select * from created_metrics union all select * from success_metrics
  ), metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind,
      sum(all_count)::bigint as all_count,
      case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
      sum(missing_amount_count)::bigint as missing_amount_count,
      sum(negative_amount_count)::bigint as negative_amount_count,
      sum(created_success_count)::bigint as created_success_count,
      sum(success_count)::bigint as success_count,
      case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
      sum(pending_count)::bigint as pending_count,
      case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
      sum(failed_count)::bigint as failed_count,
      case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
      sum(rejected_count)::bigint as rejected_count,
      case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
      sum(unknown_count)::bigint as unknown_count,
      case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
      max(latest_synced_at) as latest_synced_at
    from metrics_raw
    group by direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind
  ), metric_json as (
    select kind,(to_jsonb(m)-array['kind','local_date','local_hour','amount_bucket','amount_range_bucket','all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])
      || jsonb_build_object('date',local_date,'hour',local_hour,'bucket',coalesce(amount_range_bucket,amount_bucket),'all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,'failed_amount',failed_amount::text,
        'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value
    from metrics m left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
  ), time_bounds(kind,bucket,min_ms,max_ms) as (
    select k.kind,b.* from (values('pending_age'::text),('latency'::text))k(kind)
    cross join (values
      (0,null::numeric,300000::numeric),(1,300000,1800000),(2,1800000,3600000),(3,3600000,10800000),
      (4,10800000,21600000),(5,21600000,43200000),(6,43200000,86400000),
      (7,86400000,172800000),(8,172800000,259200000),(9,259200000,null))b(bucket,min_ms,max_ms)
    where k.kind='pending_age' or $27<>2
    union all select 'latency',b.* from (values
      (0,null::numeric,60000::numeric),(1,60000,180000),(2,180000,300000),
      (3,300000,1800000),(4,1800000,3600000),(5,3600000,10800000),
      (6,10800000,21600000),(7,21600000,43200000),(8,43200000,86400000),
      (9,86400000,172800000),(10,172800000,259200000),(11,259200000,null))b(bucket,min_ms,max_ms)
    where $27=2),
  duration_rows as materialized (
    select direction,currency,amount,
      case when status_group='success' then 'latency'::text else 'pending_age'::text end as kind,
      case when status_group='success' then latency_ms else pending_wait_ms end as duration_ms,
      case when status_group='success' then
        case when success_at is null then 'missing_success_at' when not isfinite(success_at) then 'invalid_success_at'
          when success_at<created_at then 'reversed_time' when success_at>$20 then 'future_success_at' end
        else case when created_at>$20 then 'future_created_at' end end as excluded_reason
    from filtered where $19<>'details' and ((status_group='success' and success_in_range)
      or (direction='withdraw' and status_group='pending' and created_in_range))
  ), duration_summary as (
    select kind,direction,currency,count(*) as candidate_count,
      count(duration_ms) as valid_count,count(*) filter(where duration_ms is null) as excluded_count,
      case when count(amount) filter(where duration_ms is not null)=count(duration_ms)
        then coalesce(sum(amount) filter(where duration_ms is not null),0) end as valid_amount,
      count(*) filter(where duration_ms is not null and amount is null) as missing_amount_count,
      jsonb_build_object('missing_success_at',count(*) filter(where excluded_reason='missing_success_at'),
        'invalid_success_at',count(*) filter(where excluded_reason='invalid_success_at'),
        'reversed_time',count(*) filter(where excluded_reason='reversed_time'),
        'future_success_at',count(*) filter(where excluded_reason='future_success_at'),
        'future_created_at',count(*) filter(where excluded_reason='future_created_at')) as excluded_reasons,
      avg(duration_ms) as mean_ms,percentile_cont(0.5) within group(order by duration_ms) as p50_ms,
      percentile_cont(0.95) within group(order by duration_ms) as p95_ms,max(duration_ms) as max_ms
    from duration_rows group by kind,direction,currency
  ), duration_bucket_totals as materialized (
    -- Classify each valid order once. Maxima are inclusive; subsequent bins
    -- have strict lower bounds. No join of every order to every threshold.
    select kind,direction,currency,
      case when kind='latency' and $27=2 then case when duration_ms<=60000 then 0 when duration_ms<=180000 then 1 when duration_ms<=300000 then 2 else (case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end)+2 end else case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end end as bucket,
      count(*) as count,count(*) filter(where amount is null) as missing_amount_count,
      coalesce(sum(amount),0) as known_amount
    from duration_rows where duration_ms is not null group by 1,2,3,4
  ), duration_bins as materialized (
    select s.kind,s.direction,s.currency,b.bucket,b.min_ms,b.max_ms,coalesce(r.count,0) as count,
      case when coalesce(r.missing_amount_count,0)=0 then coalesce(r.known_amount,0) end as amount,
      s.valid_count,s.valid_amount
    from duration_summary s join time_bounds b on b.kind=s.kind left join duration_bucket_totals r
      on r.kind=s.kind and r.direction=s.direction and r.currency is not distinct from s.currency and r.bucket=b.bucket
  ), duration_thresholds as (
    -- Only ten tiny aggregate bins are scanned here. Excluding the current
    -- inclusive bin makes these cumulative values strictly > threshold.
    select kind,direction,currency,bucket,max_ms as threshold_ms,
      coalesce(sum(count) over tail,0) as count,
      case when count(*) filter(where amount is null) over tail=0 then coalesce(sum(amount) over tail,0) end as amount,
      valid_count,valid_amount
    from duration_bins
    window tail as (partition by kind,direction,currency order by bucket rows between 1 following and unbounded following)
  ), duration_json as (
    select kind,false as cumulative,bucket,(to_jsonb(b)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_bins b
    union all
    select kind,true,bucket,(to_jsonb(t)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end)
    from duration_thresholds t where threshold_ms is not null
  ), duration_custom as (
    select r.direction,r.currency,$28::numeric as min_ms,$29::numeric as max_ms,
      count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)) as count,
      case when count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29) and amount is null)=0
        then coalesce(sum(amount) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)),0) end as amount,
      s.valid_count,s.valid_amount
    from duration_rows r join duration_summary s on s.kind=r.kind and s.direction=r.direction and s.currency is not distinct from r.currency
    where $30 and r.kind='latency' group by r.direction,r.currency,s.valid_count,s.valid_amount
  ), duration_custom_json as (
    select (to_jsonb(c)-array['amount','valid_amount'])||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
      'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_custom c
  ), page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,provider,raw_provider,channel_type,direction,status,status_group,
      created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,currency,synced_at,utr,latency_ms,pending_wait_ms
    from filtered where $19<>'aggregate'
      and ($8<>'success' or (status_group='success' and success_in_range))
      order by case when $8='success' then success_at else created_at end desc,direction desc,id desc limit $18 offset $17
  ) select jsonb_build_object('total',(select case when $8='success'
      then count(*) filter(where status_group='success' and success_in_range)
      else count(*) filter(where created_in_range) end from filtered),
    'summary',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from metric_json where kind='summary'),'[]'::jsonb),
    'groups',jsonb_build_object(
      'provider',coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='provider'),'[]'::jsonb),
      'daily',coalesce((select jsonb_agg(value order by value->>'date',value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='daily'),'[]'::jsonb),
      'hourly',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'direction',value->>'currency') from metric_json where kind='hourly'),'[]'::jsonb),
      'amount',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount'),'[]'::jsonb),
      'matrix',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix'),'[]'::jsonb),
      'amount_range',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount_range'),'[]'::jsonb),
      'matrix_range',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix_range'),'[]'::jsonb),
      'latency',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and not cumulative),'[]'::jsonb),
      'latency_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and cumulative),'[]'::jsonb),
      'pending_age',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and not cumulative),'[]'::jsonb),
      'pending_age_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and cumulative),'[]'::jsonb))
      ||case when $30 then jsonb_build_object('latency_custom',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from duration_custom_json),'[]'::jsonb)) else '{}'::jsonb end,
    'latencySummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='latency'),'[]'::jsonb),
    'pendingSummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='pending_age'),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by case when $8='success' then success_at else created_at end desc,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;

  -- Provider pages do not need the eight chart grouping sets or duration bins.
  -- Reuse exactly the same scoped source and predicates, with two grouping sets.
  if p_request->>'view'='providers' and v_action='aggregate' then
    if v_status<>'all' then raise exception using errcode='22023',message='unsupported_filter';end if;
    v_sql:='with orders as ('||v_source||$q$), filtered as materialized (
      select direction,currency,provider,channel_type,status_group,created_at,success_at,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (created_at >= $5 and created_at < $6) as created_in_range,
        (success_at >= $5 and success_at < $6 and status_group='success') as success_in_range
      from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
    ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), metric as (
      select direction,currency,provider,case when grouping(provider)=0 then 'provider' else 'summary' end as kind,
        count(*) filter(where created_in_range) as all_count,
        case when count(*) filter(where created_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range),0) end as all_amount,
        count(*) filter(where created_in_range and amount is null) as missing_amount_count,
        count(*) filter(where created_in_range and amount<0) as negative_amount_count,
        count(*) filter(where created_in_range and status_group='success') as created_success_count,
        count(*) filter(where success_in_range) as success_count,
        case when count(*) filter(where success_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where success_in_range),0) end as success_amount,
        count(*) filter(where created_in_range and status_group='pending') as pending_count,
        case when count(*) filter(where created_in_range and status_group='pending' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='pending'),0) end as pending_amount,
        count(*) filter(where created_in_range and status_group='failed') as failed_count,
        case when count(*) filter(where created_in_range and status_group='failed' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='failed'),0) end as failed_amount,
        count(*) filter(where created_in_range and status_group='rejected') as rejected_count,
        case when count(*) filter(where created_in_range and status_group='rejected' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='rejected'),0) end as rejected_amount,
        count(*) filter(where created_in_range and status_group='unknown') as unknown_count,
        case when count(*) filter(where created_in_range and status_group='unknown' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='unknown'),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from filtered group by grouping sets ((direction,currency),(direction,currency,provider))
    ), output as (
      select kind,(to_jsonb(m)-'kind')||jsonb_build_object('all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,
        'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value from metric m
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
    ) select jsonb_build_object('total',(select count(*) from filtered where created_in_range),
      'summary',coalesce((select jsonb_agg(value) from output where kind='summary'),'[]'::jsonb),
      'groups',jsonb_build_object('provider',coalesce((select jsonb_agg(value order by value->>'provider')
        from output where kind='provider'),'[]'::jsonb)),'rows','[]'::jsonb)
    $q$;
    -- ar_provider_fee_fold_v1: unchanged facts, one fewer filtered scan.
    if v_platform.source='ar' then
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$,'')))/length($ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$,$ar_fee_fold_0$$ar_fee_fold_0$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,'')))/length($ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,$ar_fee_fold_1$max(synced_at) as latest_synced_at,
        jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts$ar_fee_fold_1$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,'')))/length($ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,$ar_fee_fold_2$(to_jsonb(m)-array['kind','fee_facts'])$ar_fee_fold_2$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,'')))/length($ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,$ar_fee_fold_3$case when m.kind='provider' then m.fee_facts else '{}'::jsonb end$ar_fee_fold_3$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,'')))/length($ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,$ar_fee_fold_4$$ar_fee_fold_4$);
    end if;
  end if;

  if v_platform.source='duoli' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,v_platform.name,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_fee_country,v_fee_currency_proven,(v_platform.source='wg');
  if v_action='details' then
    v_result:=jsonb_set(v_result,'{rows}',coalesce((select jsonb_agg(x||case when v_platform.source='wg' and x->>'direction'='charge' and x->>'channel_type'='提现转充值' then
      jsonb_build_object('fee_exempt',true,'fee_exempt_reason','wg_withdraw_to_charge','fee_version_state','complete',
        'fee_version_ids','[]'::jsonb,'fee_version_percent_rate','0','fee_version_fixed_fee','0',
        'fee_version_estimated_amount','0','fee_version_basis','native_business_rule')
      else private.dashboard_admin_fee_quote(v_fee_country,v_platform.name,
      x->>'provider',x->>'direction',case when v_fee_currency_proven then x->>'currency' end,(x->>'created_at')::timestamptz,(x->>'amount')::numeric,private.dashboard_admin_fee_category(v_fee_country,x->>'channel_type')) end order by n)
      from jsonb_array_elements(v_result->'rows') with ordinality t(x,n)),'[]'::jsonb));
  end if;
  if v_action='details' and v_platform.source='ar' then v_result:=private.dashboard_admin_ar_order_money(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  v_result:=private.dashboard_admin_order_business_result(v_result,v_platform.source,v_platform.scope_group,v_platform.source_name,v_platform.id);
  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,'basis','mixed_created_success','startAt',v_start,'endAt',v_end,
    'asOf',v_asof,'offset',v_offset,'limit',v_limit,'hasMore',(v_result->>'total')::bigint>v_offset::bigint+v_limit,
    'capabilities',v_capabilities);
end;
$kernel$;
REVOKE ALL ON FUNCTION private.provider_snapshot_orders_raw_kernel(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.provider_snapshot_orders_result_kernel(p_result jsonb,p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $kernel$
declare v_result jsonb:=p_result;v_action text:=coalesce(p_request->>'action','catalog');v_country text;v_platform text;
begin
  v_country:=v_result#>>'{platform,country}';
  v_platform:=coalesce(v_result#>>'{platform,sourceName}',v_result#>>'{platform,name}');
  if v_country is null or v_platform is null then return v_result; end if;
  if v_result#>>'{platform,source}'='panda' then v_result:=private.dashboard_admin_panda_alias_input(v_result);end if;
  if v_result#>'{groups,provider}' is not null then
    v_result:=jsonb_set(v_result,'{groups,provider}',private.dashboard_admin_live_remap_groups(v_result#>'{groups,provider}',v_country,v_platform,false),true);
  end if;
  if v_result#>'{groups,daily}' is not null then
    v_result:=jsonb_set(v_result,'{groups,daily}',private.dashboard_admin_live_remap_groups(v_result#>'{groups,daily}',v_country,v_platform,true),true);
  end if;
  if v_action='details' and v_result#>'{rows}' is not null then
    v_result:=jsonb_set(v_result,'{rows}',private.dashboard_admin_live_remap_rows(v_result#>'{rows}',v_country,v_platform),true);
  end if;
  if v_result#>>'{platform,source}'='duoli' then
    v_result:=private.dashboard_admin_duoli_order_result(v_result);
  end if;
  if v_result#>>'{platform,source}'='panda' then v_result:=private.dashboard_admin_panda_order_result(v_result);end if;
  return v_result;
end;
$kernel$;
REVOKE ALL ON FUNCTION private.provider_snapshot_orders_result_kernel(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.provider_snapshot_submission_kernel(p_request jsonb,p_catalog jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
 SET enable_nestloop TO 'off'
AS $kernel$
declare
 v_platform record;v_id uuid;v_start timestamptz;v_end timestamptz;v_from timestamptz;v_to timestamptz;
 v_direction text;v_currency text;v_key text;v_providers text[];v_source text;v_success text;v_sql text;v_result jsonb;
 v_time_filter text;v_undated_filter text;v_undated_source text;
 v_confirmations jsonb:='{}'::jsonb;
 v_operation text:=coalesce(p_request->>'operation','summary');v_threshold integer:=15;v_thresholds integer[]:=array[10,15,20,30,50,100];
 v_level text:=coalesce(p_request->>'level','all');v_offset integer:=0;v_limit integer:=50;
 v_bands jsonb;v_edges numeric[];v_charts boolean:=true;
 v_member text:=nullif(btrim(p_request->>'memberId'),'');
 v_day date;v_yash_coverage jsonb;v_yash_unknown_days integer;v_yash_quality jsonb;
begin
  -- Caller supplies an already-authorized or private scheduled native catalog.
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'platformId','startAt','endAt','direction','providers','currency','operation','threshold','level','offset','limit','memberId','day','amountBands','charts'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz;v_end:=(p_request->>'endAt')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  select * into v_platform from jsonb_to_recordset(p_catalog) as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied';end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days' then
    raise exception using errcode='22023',message='invalid_range';
  end if;
  v_direction:=coalesce(p_request->>'direction','charge');v_currency:=nullif(btrim(p_request->>'currency'),'');
  if v_direction <> 'charge' then raise exception using errcode='22023',message='invalid_direction';end if;
  if p_request ? 'providers' and p_request->'providers'<>'null'::jsonb then
    if jsonb_typeof(p_request->'providers')<>'array' or jsonb_array_length(p_request->'providers')>200
      or exists(select 1 from jsonb_array_elements(p_request->'providers') a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end if;

 if v_operation not in ('summary','members','memberOrders') or v_level not in ('all','new','funded','unknown','l0')
  or v_member is not null and (length(v_member)>200 or v_member ~ '[[:cntrl:]]') then
  raise exception using errcode='22023',message='invalid_filter';end if;
 if v_operation='memberOrders' then
  if v_member is null or p_request->>'memberId'<>v_member or jsonb_typeof(p_request->'memberId') is distinct from 'string'
   or jsonb_typeof(p_request->'day') is distinct from 'string' or coalesce(p_request->>'day','') !~ '^\d{4}-\d{2}-\d{2}$' then
   raise exception using errcode='22023',message='invalid_member_day';end if;
  begin v_day:=(p_request->>'day')::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='22023',message='invalid_member_day';end;
  if v_day::text<>p_request->>'day' or v_day<(v_start at time zone v_platform.timezone)::date
   or v_day>((v_end-interval '1 microsecond') at time zone v_platform.timezone)::date then
   raise exception using errcode='22023',message='invalid_member_day';end if;
 elsif p_request ? 'day' then raise exception using errcode='22023',message='invalid_member_day';end if;
 if p_request ? 'threshold' then
  if jsonb_typeof(p_request->'threshold')<>'number' or p_request->>'threshold' not in ('10','15','20','30','50','100') then raise exception using errcode='22023',message='invalid_threshold';end if;
  v_threshold:=(p_request->>'threshold')::int;
  if v_threshold=15 then v_thresholds:=array[10,15,20,30,50,100];end if;
 end if;
 if p_request ? 'offset' then
  if jsonb_typeof(p_request->'offset')<>'number' or p_request->>'offset' !~ '^[0-9]{1,7}$' then raise exception using errcode='22023',message='invalid_offset';end if;
  v_offset:=(p_request->>'offset')::int;
 end if;
 if p_request ? 'limit' then
  if jsonb_typeof(p_request->'limit')<>'number' or p_request->>'limit' not in ('20','50','100') then raise exception using errcode='22023',message='invalid_limit';end if;
  v_limit:=(p_request->>'limit')::int;
 end if;
 if p_request ? 'charts' then if jsonb_typeof(p_request->'charts')<>'boolean' then raise exception using errcode='22023',message='invalid_charts';end if;v_charts:=(p_request->>'charts')::boolean;end if;
 v_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands','charge');
 select array_agg(value::numeric order by ordinality) into v_edges from jsonb_array_elements_text(v_bands->'charge') with ordinality;
 select array_agg(value) into v_providers from jsonb_array_elements_text(coalesce(nullif(p_request->'providers','null'::jsonb),'[]'::jsonb));
 -- Always evaluate whole local days, even if the dashboard clock range is shorter.
 v_from:=date_trunc('day',v_start at time zone v_platform.timezone) at time zone v_platform.timezone;
 v_to:=(date_trunc('day',(v_end-interval '1 microsecond') at time zone v_platform.timezone)+interval '1 day') at time zone v_platform.timezone;
 if v_platform.source='ar' then
  v_time_filter:='a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)';v_undated_filter:='a.applied_at is null';
  if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
   execute 'select coalesce(jsonb_object_agg(order_no,confirmed_provider),''{}''::jsonb) from private.dashboard_admin_order_provider_confirmations where source_system=''AR'' and country_code=$1 and platform=$2 and order_kind=''recharge'' and active'
    into v_confirmations using v_platform.scope_group,v_platform.source_name;
  end if;
  v_source:=$q$select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
   a.applied_at at time zone $4 created_at,private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) as amount,$17::text currency,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
   a.status='已支付' paid,coalesce(a.status in ('已支付','待支付','支付失败','已取消'),false) status_known,a.status::text source_status,$ar_level$ level_text,$ar_count$ count_text
   from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'
   and ($source_time_filter$)$q$;
  v_source:=replace(v_source,'$ar_level$',case when exists(select 1 from pg_catalog.pg_attribute where attrelid='public.ar_collected_orders'::regclass and attname='member_level' and not attisdropped) then 'a.member_level::text' else 'null::text' end);
  v_source:=replace(v_source,'$ar_count$',case when exists(select 1 from pg_catalog.pg_attribute where attrelid='public.ar_collected_orders'::regclass and attname='recharge_count' and not attisdropped) then 'a.recharge_count::text' else 'null::text' end);
  v_success:=$q$select nullif(btrim(a.member_id),'') member_id,a.completed_at::date as day
   from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'
   and a.status='已支付' and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)$q$;
 elsif v_platform.source='newar' then
  v_time_filter:='n.created_at>=$5 and n.created_at<$6';v_undated_filter:='n.created_at is null';
  v_source:=$q$select coalesce(nullif(n.order_number,''),n.source_id) order_id,nullif(btrim(n.member_id),'') member_id,n.created_at,n.amount,n.currency,
   case when coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值' else coalesce(nullif(btrim(n.provider),''),'未识别通道') end raw_provider,
   n.status_group='success' paid,coalesce(n.status_group in ('success','pending','failed','rejected'),false) status_known,n.status_code::text source_status,$newar_level$ level_text,$newar_count$ count_text
   from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
   where n.platform=$3 and n.dataset='charge' and ($source_time_filter$)
   and (t.launch_at is null or n.created_at>=t.launch_at or n.created_at is null)$q$;
  v_source:=replace(v_source,'$newar_level$',case when exists(select 1 from pg_catalog.pg_attribute where attrelid='public.newar_detail_records'::regclass and attname='recharge_level' and not attisdropped) then 'coalesce(n.recharge_level::text,n.raw->>''rechargeLevel'',n.raw->>''memberLevel'')' else 'coalesce(n.raw->>''rechargeLevel'',n.raw->>''memberLevel'')' end);
  v_source:=replace(v_source,'$newar_count$',case when exists(select 1 from pg_catalog.pg_attribute where attrelid='public.newar_detail_records'::regclass and attname='recharge_count' and not attisdropped) then 'coalesce(n.recharge_count::text,n.raw->>''rechargeCount'')' else 'n.raw->>''rechargeCount''' end);
  v_success:=$q$select nullif(btrim(n.member_id),'') member_id,(n.success_at at time zone $4)::date as day
   from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
   where n.platform=$3 and n.dataset='charge' and n.status_group='success' and n.success_at>=$5 and n.success_at<$6
   and (t.launch_at is null or n.created_at>=t.launch_at)$q$;
 elsif v_platform.source='lg' then
  v_time_filter:='l.created_at>=$5 and l.created_at<$6';v_undated_filter:='l.created_at is null';
  v_source:=$q$select l.order_no order_id,nullif(btrim(l.member_id),'') member_id,l.created_at,l.metric_amount amount,$17::text currency,
   coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') raw_provider,
   l.status_class='success' paid,coalesce(l.status_class in ('success','pending','rejected'),false) status_known,coalesce(nullif(l.status_text,''),l.status_code::text) source_status,null::text level_text,null::text count_text
   from public.lg_orders l where l.country_code=$2 and l.platform=$3 and l.source_system='LG' and l.order_kind='recharge' and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(l.member_id),'') member_id,(l.paid_at at time zone $4)::date as day from public.lg_orders l
   where l.country_code=$2 and l.platform=$3 and l.source_system='LG' and l.order_kind='recharge' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6$q$;
 elsif v_platform.source='game66' then
  v_time_filter:='c.create_time>=$5 and c.create_time<$6';v_undated_filter:='c.create_time is null';
  v_source:=$q$select c.order_num order_id,nullif(btrim(c.uid),'') member_id,c.create_time created_at,coalesce(c.amount_display,c.amount_minor/100.0) amount,'INR'::text currency,
   coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') raw_provider,c.status_code='1' paid,coalesce(c.status_code in ('1','0'),false) status_known,c.status_code::text source_status,null::text level_text,null::text count_text
   from public.game66_charge_orders c where c.platform_id=$1 and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(c.uid),'') member_id,(c.pay_time at time zone $4)::date as day from public.game66_charge_orders c
   where c.platform_id=$1 and c.status_code='1' and c.pay_time>=$5 and c.pay_time<$6$q$;
 elsif v_platform.source='kb' and v_platform.scope_group='IN' and v_platform.source_name='YASH.BET' and v_platform.id=md5('kb:IN:YASH.BET')::uuid and v_platform.timezone='Asia/Kolkata' then
  v_time_filter:='y.created_at>=$5 and y.created_at<$6';v_undated_filter:='y.created_at is null';
  v_source:=$q$select y.order_no order_id,nullif(btrim(y.uid),'') member_id,y.created_at,y.amount,y.currency,
   private.dashboard_admin_yash_provider(y.supplier) raw_provider,
   private.dashboard_admin_yash_status('deposit',y.status)='success' paid,private.dashboard_admin_yash_status('deposit',y.status)<>'unknown' status_known,y.status::text source_status,null::text level_text,null::text count_text
   from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(y.uid),'') member_id,(private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) at time zone $4)::date as day
   from private.yash_orders y where y.source_site='yash' and y.order_type='deposit' and private.dashboard_admin_yash_status('deposit',y.status)='success'
   and y.completed_at>=$5 and y.completed_at<$6 and private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is not null$q$;
  select jsonb_object_agg(d::date::text,private.dashboard_admin_yash_submission_coverage(d::date)) into v_yash_coverage
   from generate_series((v_from at time zone v_platform.timezone)::date::timestamp,(v_to at time zone v_platform.timezone)::date::timestamp-interval '1 day',interval '1 day') d;
 else
  raise exception using errcode='22023',message='submission_source_unavailable';
 end if;
 -- Keep bounded time reads and the sparse NULL-time lookup as independent
 -- indexable branches; an OR would encourage full platform-history scans.
 if v_platform.source='ar' then v_undated_source:=replace(v_source,'$source_time_filter$',v_undated_filter);end if;
 v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);
 if v_currency is not null and v_currency<>v_platform.currency then raise exception using errcode='22023',message='invalid_currency';end if;
 if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and v_charts
  and (v_from at time zone v_platform.timezone)::date>=date '2026-10-10' then
  -- Hold ordinary metadata read locks through the statement before checking
  -- exact source maintenance and three-set readiness. No source rows are read.
  perform 1 from public.ar_collected_orders limit 0;
  perform 1 from private.ar_91club_submission_facts limit 0;
  perform 1 from private.ar_91club_submission_epoch limit 0;
  perform 1 from private.ar_91club_submission_ready limit 0;
  perform 1 from private.ar_91club_submission_null_ready limit 0;
  perform 1 from private.ar_91club_submission_future_ready limit 0;
  if (select count(*)=2 from pg_catalog.pg_proc p where p.oid in('private.ar_91club_submission_generation()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure)
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s' and p.proparallel='u' and not p.proretset and not p.proisstrict and not p.proleakproof and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}'
   and(case when p.proname='ar_91club_submission_generation'then p.pronargs=0 and p.proargnames is null and pg_get_function_arguments(p.oid)=''else p.pronargs=2 and p.proargnames=array['p_from','p_to']::text[]and pg_get_function_arguments(p.oid)='p_from date, p_to date'end)
   and(case when p.proname='ar_91club_submission_generation' then p.prolang=(select oid from pg_language where lanname='sql')and md5(p.prosrc)='acd188a5da0cb2f63381bd5922e3a1cf'and p.prorettype='text'::regtype else p.prolang=(select oid from pg_language where lanname='plpgsql')and md5(p.prosrc)='7252e3966d916239a3ce212ba91dc763'and p.prorettype='boolean'::regtype end))then
   if private.ar_91club_submission_can_read((v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
   -- The same full-population proof also covers chart inputs. Keep the generic
   -- chart/amount/qualification SQL unchanged; only use the exact native copy.
   v_source:=replace(v_source,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   v_success:=replace(v_success,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   v_undated_source:=replace(v_undated_source,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   -- Current can_read fingerprints a VALIDATED CHECK fixing all four keys.
   -- Keep bind fences; do not remove any money atom or provider/date filter.
   v_source:=replace(v_source,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   v_success:=replace(v_success,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   v_undated_source:=replace(v_undated_source,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   -- The chart needs native amounts for every selected order. Expand only
   -- this exact current rule; drift keeps the ordinary helper call unchanged.
   if exists(select 1 from pg_catalog.pg_proc m
    where m.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
    and md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
    and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_language where lanname='sql')
    and m.provolatile='i'and m.proparallel='s'and not m.prosecdef and not m.proisstrict and not m.proleakproof
    and m.proconfig is not distinct from array['search_path=""']::text[]
    and m.proacl::text is not distinct from '{postgres=X/postgres}'and m.pronargdefaults=0
    and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8
    and m.proargnames=array['p_country','p_kind','p_channel_type','p_version','p_local','p_local_currency','p_issue','p_legacy_display']::text[]
    and pg_get_function_arguments(m.oid)='p_country text, p_kind text, p_channel_type text, p_version smallint, p_local numeric, p_local_currency text, p_issue text, p_legacy_display numeric')then
    v_source:=replace(v_source,$ar91_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)$ar91_amount_call$,$ar91_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (a.amount)
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (a.amount)
 END$ar91_amount_case$);
    v_undated_source:=replace(v_undated_source,$ar91_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)$ar91_amount_call$,$ar91_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (a.amount)
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (a.amount)
 END$ar91_amount_case$);
   end if;
   end if;
  end if;
 end if;
 v_sql:='with source_rows as not materialized ('||v_source||'), successes as materialized ('||v_success||$q$),
 canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider from (select distinct raw_provider from source_rows) names
 ), unplaced_members as materialized (
  select distinct member_id from source_rows where created_at is null and member_id is not null
 ), orders as materialized (
  select s.*,(created_at at time zone $4)::date as day,c.provider,
   case when upper(btrim(level_text)) ~ '^L(V)?[0-9]{1,4}$' then regexp_replace(upper(btrim(level_text)),'^LV?','')::int
    when btrim(level_text) ~ '^[0-9]{1,4}$' then btrim(level_text)::int end member_level,
   case when btrim(count_text) ~ '^[0-9]{1,9}$' then btrim(count_text)::int end recharge_count
  from source_rows s join canonical c using(raw_provider) where created_at is not null
 ), member_days as materialized (
  select day,member_id,count(*) submitted_count,
   case when count(*) filter(where amount is null or currency is distinct from $17)>0 then null else sum(amount) end platform_day_amount,
   count(*) filter(where paid) cohort_success_count,bool_and(status_known) statuses_known,
   count(*) filter(where nullif(btrim(order_id),'') is null)=0 and count(distinct order_id)=count(*)
    and bool_and(u.member_id is null) sequence_known,
   count(*) platform_day_invalid_count,
   case when count(*) filter(where amount is null or currency is distinct from $17)>0 then null
    else coalesce(sum(amount),0) end platform_day_invalid_amount,
   case when max(recharge_count)>0 then 'funded' when count(recharge_count)=count(*) and max(recharge_count)=0 and count(member_level)=count(*) and max(member_level)=0 then 'new' else 'unknown' end member_class,
   max(recharge_count) recharge_count, bool_or(member_level=0) has_l0,
   case when count(member_level)>0 then 'L'||max(member_level)::text end member_level,
   min(created_at) first_at,max(created_at) last_at
  from orders left join unplaced_members u using(member_id) where member_id is not null group by day,member_id
 ), eligible as materialized (
  select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
   and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
   and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
 ), selected_orders as materialized (
  select o.* from orders o where ($8::text[] is null or provider=any($8)) and created_at>=$15 and created_at<$16 and currency=$17
 ), selected_coverage as (
  select count(*) order_count,count(*) filter(where member_id is null) missing_member_count,
   count(*) filter(where member_level is null) missing_level_count,count(*) filter(where recharge_count is null) missing_recharge_count
  from selected_orders
 ), selected_member_days as materialized (
  select distinct day,member_id from selected_orders where member_id is not null
 ), qualified as materialized (
  select o.*,m.submitted_count,m.platform_day_amount,m.platform_day_invalid_count,m.platform_day_invalid_amount,m.member_class,m.member_level known_level,m.recharge_count known_recharge_count,m.has_l0,m.first_at,m.last_at
  from selected_orders o join eligible m using(day,member_id)
 ), qualified_members as materialized (
  -- Aggregate each provider/member/day once before calculating thresholds.
  select day,member_id,provider,max(submitted_count) submitted_count,max(member_class) member_class,bool_or(has_l0) has_l0,
   count(*) invalid_count,count(*) filter(where amount is null) missing_amount,coalesce(sum(amount),0) invalid_amount
  from qualified where $14='summary' group by day,member_id,provider
 ), metric_values as (
  select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
   count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
   sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
  from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
  group by grouping sets ((q.provider,t.threshold),(t.threshold))
 ), dimensions as (select null::text provider union all select distinct provider from selected_orders), metrics as (
  select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
   coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
   coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
   coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
  from dimensions d cross join unnest($22::integer[]) t(threshold)
  left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
 ), details as (
  select q.day,q.member_id,q.member_class,max(q.known_level) member_level,max(q.submitted_count) submitted_count,max(q.known_recharge_count) recharge_count,
   max(q.platform_day_amount)::text platform_day_amount,max(q.platform_day_invalid_count) platform_day_invalid_count,max(q.platform_day_invalid_amount)::text platform_day_invalid_amount,
   count(*) invalid_count,
   case when count(*) filter(where q.amount is null)>0 then null else coalesce(sum(q.amount),0)::text end invalid_amount,
   count(*) selected_count,case when count(*) filter(where q.amount is null)>0 then null else sum(q.amount)::text end submitted_amount,array_agg(distinct q.provider order by q.provider) providers,
   min(q.first_at) first_at,max(q.last_at) last_at,
   min(q.created_at) first_invalid_at,max(q.created_at) last_invalid_at
  from qualified q where $14='members' and q.submitted_count > $9 and ($10='all' or q.member_class=$10 or $10='l0' and q.has_l0) and ($13::text is null or q.member_id=$13)
  group by q.day,q.member_id,q.member_class
 ), detail_page as (select * from details order by day desc,submitted_count desc,member_id limit $12 offset $11),
 member_orders as materialized (
  select q.order_id,q.member_id,q.day,q.created_at,q.provider,q.raw_provider,q.amount,q.currency,q.source_status status
  from qualified q where $14='memberOrders' and q.submitted_count>$9 and q.member_id=$13 and q.day=$23
   and ($10='all' or q.member_class=$10 or $10='l0' and q.has_l0)
 ), member_order_page as (
  select order_id,member_id,day,created_at,provider,raw_provider,amount::text amount,currency,status
  from member_orders order by created_at,order_id limit $12 offset $11
 ), member_amount_groups as (
  select currency,amount::text amount,count(*) count,
   case when amount is null then null else sum(amount)::text end total_amount
  from member_orders group by currency,amount order by currency,amount::numeric nulls last
 ),
 dashboard_orders as materialized (
  select o.provider,o.created_at,o.day,o.amount,o.paid,coalesce((o.day,o.member_id) in (select e.day,e.member_id from eligible e where submitted_count>$9),false) flagged
  from selected_orders o where $14='summary' and $21
 ), monitoring as (
  select provider,count(*) order_count,count(*) filter(where paid) success_count,
   case when count(*) filter(where amount is null)>0 then null else coalesce(sum(amount),0)::text end order_amount,
   count(*) filter(where flagged) invalid_count,
   case when count(*) filter(where flagged and amount is null)>0 then null else coalesce(sum(amount) filter(where flagged),0)::text end invalid_amount,
   min(created_at at time zone $4) filter(where flagged) first_at,max(created_at at time zone $4) filter(where flagged) last_at
  from dashboard_orders group by grouping sets ((),(provider))
 ), heatmap as (
  select provider,extract(hour from created_at at time zone $4)::int as hour,count(*) count
  from dashboard_orders where flagged group by provider,hour
 ), daily_chart as (
  select day,count(*) order_count,count(*) filter(where flagged) invalid_count
  from dashboard_orders group by day
 ), amount_chart as (
  select case when amount is null then 'unknown' when $19::numeric[] is null then 'unconfigured'
   when amount<$19[1] then 'below' when amount>$19[11] then 'above' when amount=$19[11] then 'band:9'
   else 'band:'||(select i-1 from generate_series(1,10)i where amount >= $19[i] and amount < $19[i+1])::text end bucket,
   count(*) count
  from dashboard_orders where flagged group by bucket
 ), frequency_chart as (
  select case when max(submitted_count)>=100 then '100+' when max(submitted_count)>=50 then '50–99'
   when max(submitted_count)>=30 then '30–49' when max(submitted_count)>=20 then '20–29' else '10–19' end band
  from qualified_members where $14='summary' and $21 group by day,member_id
 ), frequency_counts as (select band,count(*) count from frequency_chart group by band)
 select jsonb_build_object(
  'dashboard',case when $14='summary' and $21 then jsonb_build_object(
   'version',3,'threshold',$9,'exemptCount',0,'thresholdComparison','gt','amountBands',$20::jsonb,
   'monitoring',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first),'[]'::jsonb) from monitoring m),
   'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by provider,hour),'[]'::jsonb) from heatmap h),
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]'::jsonb) from daily_chart d),
   'amounts',(select coalesce(jsonb_agg(to_jsonb(a) order by bucket),'[]'::jsonb) from amount_chart a),
   'frequency',(select coalesce(jsonb_agg(to_jsonb(f) order by band),'[]'::jsonb) from frequency_counts f)) end,
  'metrics',case when $14='summary' then (select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m) end,
  'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
   'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
   -- Count the actual unknown-status rows in the selected members' whole-day
   -- cohorts, including another provider/time slice. Those rows prevent a
   -- no-success conclusion; unrelated member-days must not taint this scope.
   -- Missing-member rows cannot be joined to a cohort, so retain the selected
   -- unknown rows separately without counting known affected rows as unknown.
   'unknownStatusCount',(select count(*) from orders o join selected_member_days s using(day,member_id) where not o.status_known)
     +(select count(*) from selected_orders where member_id is null and not status_known),
   'orderSequenceUncertainCount',(select count(*) from selected_orders o join member_days m using(day,member_id) where not m.sequence_known),
   'sourceCompletenessVerified',false) from selected_coverage sc),
  'total',case when $14='members' then (select count(*) from details) when $14='memberOrders' then (select count(*) from member_orders) end,
  'members',case when $14='members' then (select count(distinct member_id) from details) end,
  'rows',case when $14='members' then (select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from detail_page d)
   when $14='memberOrders' then (select coalesce(jsonb_agg(to_jsonb(o) order by created_at,order_id),'[]'::jsonb) from member_order_page o) end,
  'amountGroups',case when $14='memberOrders' then (select coalesce(jsonb_agg(to_jsonb(g) order by currency,amount::numeric nulls last),'[]'::jsonb) from member_amount_groups g) end,
  'memberId',case when $14='memberOrders' then $13 end,'day',case when $14='memberOrders' then $23 end,
  'offset',case when $14='memberOrders' then $11 end,'limit',case when $14='memberOrders' then $12 end,
  'hasMore',case when $14='memberOrders' then $11+$12<(select count(*) from member_orders) end)
 $q$;
 if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='OKWIN'
  and v_operation='summary' and not v_charts
  and (v_from at time zone v_platform.timezone)::date>=date '2026-10-10'
  and to_regclass('private.ar_submission_typed_facts')is not null
  and to_regclass('private.ar_submission_fact_epoch')is not null
  and to_regclass('private.ar_submission_day_ready')is not null
  and to_regclass('private.ar_submission_null_ready')is not null
  and to_regclass('private.ar_submission_future_ready')is not null then
  -- Metadata AccessShare locks and same-statement native proof precede any
  -- narrow projected read. This pair is a physical source identity, not a grant.
  perform 1 from public.ar_collected_orders limit 0;
  perform 1 from private.ar_submission_typed_facts limit 0;
  perform 1 from private.ar_submission_fact_epoch limit 0;
  perform 1 from private.ar_submission_day_ready limit 0;
  perform 1 from private.ar_submission_null_ready limit 0;
  perform 1 from private.ar_submission_future_ready limit 0;
  if (select count(*)=2 from pg_proc p where p.oid in(to_regprocedure('private.ar_submission_fact_generation(text,text)'),to_regprocedure('private.ar_submission_fact_can_read(text,text,date,date)'))
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s'and p.proparallel='u'and p.prolang=(select oid from pg_language where lanname='plpgsql')and not p.proretset and not p.proisstrict and not p.proleakproof and p.prokind='f'and p.pronargdefaults=0 and p.provariadic=0 and p.proconfig=array['search_path=""']::text[]and p.proacl::text='{postgres=X/postgres}'
   and((p.oid=to_regprocedure('private.ar_submission_fact_generation(text,text)')and md5(p.prosrc)='44e726b77cdbb15c8db7b0af81346a1b'and p.prorettype='text'::regtype and pg_get_function_arguments(p.oid)='p_country text, p_platform text') or (p.oid=to_regprocedure('private.ar_submission_fact_can_read(text,text,date,date)')and md5(p.prosrc)='59b1aaad5881647d9fb90dbb0074548d'and p.prorettype='boolean'::regtype and pg_get_function_arguments(p.oid)='p_country text, p_platform text, p_from date, p_to date')))then
   if private.ar_submission_fact_can_read(v_platform.scope_group,v_platform.source_name,(v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
    v_sql:=$q$with source_rows as not materialized (select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
 a.applied_at at time zone $4 created_at,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
 a.status='已支付' paid,coalesce(a.status in('已支付','待支付','支付失败','已取消'),false)status_known,
 a.member_level native_member_level,a.recharge_count native_recharge_count
 from private.ar_submission_typed_facts a where a.country_code=$2 and a.platform=$3 and $2::text='IN' and $3::text='OKWIN'
 and a.applied_at>=($5 at time zone $4)and a.applied_at<($6 at time zone $4)),successes as materialized(select nullif(btrim(a.member_id),'')member_id,a.completed_at::date as day from private.ar_submission_typed_facts a
 where a.country_code=$2 and a.platform=$3 and $2::text='IN'and $3::text='OKWIN'and a.status='已支付'
 and a.completed_at>=($5 at time zone $4)and a.completed_at<($6 at time zone $4)), typed_orders as materialized (
 select s.order_id,s.member_id,(s.created_at at time zone $4)::date as day,
  (s.created_at>=$15 and s.created_at<$16) selected_clock,
  s.raw_provider,s.paid,s.status_known,
  case when s.native_member_level between 0 and 9999 then s.native_member_level end member_level,
  case when s.native_recharge_count between 0 and 999999999 then s.native_recharge_count end recharge_count
 from source_rows s where s.created_at is not null
), native_provider_summary as materialized (
 -- One native-provider pass supplies both canonical names and selected coverage.
 -- Preserve every whole-day provider here; filtering happens after canonicalization.
 select o.raw_provider,
  count(*) filter(where o.selected_clock and $17::text is not null) selected_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null) missing_member_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_level is null) missing_level_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o group by o.raw_provider
), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from native_provider_summary
), unplaced_members as materialized (
 select distinct nullif(btrim(a.member_id),'') member_id
 from private.ar_submission_typed_facts a
 where a.country_code=$2 and a.platform=$3 and $2::text='IN' and $3::text='OKWIN'
  and a.applied_at is null
  and nullif(btrim(a.member_id),'') is not null
), member_days as materialized (
 select o.day,o.member_id,count(*) submitted_count,count(*) filter(where o.paid) cohort_success_count,
  bool_and(o.status_known) statuses_known,
  count(*) filter(where nullif(btrim(o.order_id),'') is null)=0 and count(distinct o.order_id)=count(*)
   and bool_and(u.member_id is null) sequence_known,
  count(*) filter(where not o.status_known) unknown_status_count,
  count(*) filter(where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null) selected_count,
  case when max(o.recharge_count)>0 then 'funded'
   when count(o.recharge_count)=count(*) and max(o.recharge_count)=0 and count(o.member_level)=count(*) and max(o.member_level)=0 then 'new' else 'unknown' end member_class,
  bool_or(o.member_level=0) has_l0
 from typed_orders o left join unplaced_members u using(member_id) join canonical c using(raw_provider)
 where o.member_id is not null group by o.day,o.member_id
), eligible as materialized (
 select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
  and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
  and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
), selected_provider_summary as materialized (
 -- Merge native aliases only after the existing canonical helper. Count sums
 -- retain bigint types and exclude zero selected rows exactly as the old WHERE.
 select c.provider,sum(n.selected_count)::bigint selected_count,
  sum(n.missing_member_count)::bigint missing_member_count,
  sum(n.missing_level_count)::bigint missing_level_count,
  sum(n.missing_recharge_count)::bigint missing_recharge_count,
  sum(n.missing_member_unknown_count)::bigint missing_member_unknown_count
 from native_provider_summary n join canonical c using(raw_provider)
 where n.selected_count>0 and ($8::text[] is null or c.provider=any($8))
 group by c.provider
), qualified_orders as materialized (
 -- This materialization contains only eligible, selected rows. It prevents the
 -- scalar money helper from moving back into the full-day source scan.
 select o.day,o.member_id,c.provider,m.submitted_count,m.member_class,m.has_l0,
  o.order_id
 from typed_orders o join eligible m using(day,member_id) join canonical c using(raw_provider)
 where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null
), qualified_amounts as materialized (
 select q.day,q.member_id,q.provider,q.submitted_count,q.member_class,q.has_l0,
  (select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)
   from private.ar_submission_typed_facts a
   where a.source_system='AR' and a.country_code=$2 and a.platform=$3
    and a.order_kind='recharge' and a.order_no=q.order_id) amount
 from qualified_orders q
), qualified_members as (
 select q.day,q.member_id,q.provider,max(q.submitted_count) submitted_count,max(q.member_class) member_class,bool_or(q.has_l0) has_l0,
  count(*) invalid_count,count(*) filter(where q.amount is null) missing_amount,coalesce(sum(q.amount),0) invalid_amount
 from qualified_amounts q group by q.day,q.member_id,q.provider
), metric_values as (
 select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,
  count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
  count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
  sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
 from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
 group by grouping sets ((q.provider,t.threshold),(t.threshold))
), dimensions as (select null::text provider union all select provider from selected_provider_summary), metrics as (
 select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
  coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
  coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
  coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,
  coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
 from dimensions d cross join unnest($22::integer[]) t(threshold)
 left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
), selected_coverage as (
 select coalesce(sum(selected_count),0)::bigint order_count,
  coalesce(sum(missing_member_count),0)::bigint missing_member_count,
  coalesce(sum(missing_level_count),0)::bigint missing_level_count,
  coalesce(sum(missing_recharge_count),0)::bigint missing_recharge_count,
  coalesce(sum(missing_member_unknown_count),0)::bigint missing_member_unknown_count
 from selected_provider_summary
)
select jsonb_build_object('dashboard',null,
 'metrics',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m),
 'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
  'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
  'unknownStatusCount',coalesce((select sum(m.unknown_status_count)::bigint from member_days m where m.selected_count>0),0)+sc.missing_member_unknown_count,
  'orderSequenceUncertainCount',coalesce((select sum(m.selected_count)::bigint from member_days m where not m.sequence_known),0),
  'sourceCompletenessVerified',false) from selected_coverage sc),
 'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$q$;
   end if;
  end if;
 end if;
 if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and not v_charts
  and (v_from at time zone v_platform.timezone)::date>=date '2026-10-10' then
  -- Hold ordinary metadata read locks through the statement before checking
  -- exact source maintenance and three-set readiness. No source rows are read.
  perform 1 from public.ar_collected_orders limit 0;
  perform 1 from private.ar_91club_submission_facts limit 0;
  perform 1 from private.ar_91club_submission_epoch limit 0;
  perform 1 from private.ar_91club_submission_ready limit 0;
  perform 1 from private.ar_91club_submission_null_ready limit 0;
  perform 1 from private.ar_91club_submission_future_ready limit 0;
  if (select count(*)=2 from pg_catalog.pg_proc p where p.oid in('private.ar_91club_submission_generation()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure)
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s' and p.proparallel='u' and not p.proretset and not p.proisstrict and not p.proleakproof and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}'
   and(case when p.proname='ar_91club_submission_generation' then p.prolang=(select oid from pg_language where lanname='sql')and md5(p.prosrc)='acd188a5da0cb2f63381bd5922e3a1cf'and p.prorettype='text'::regtype else p.prolang=(select oid from pg_language where lanname='plpgsql')and md5(p.prosrc)='7252e3966d916239a3ce212ba91dc763'and p.prorettype='boolean'::regtype end))then
   if private.ar_91club_submission_can_read((v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
   v_sql:=$q$with source_rows as not materialized (select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
 a.applied_at at time zone $4 created_at,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
 a.status='已支付' paid,coalesce(a.status in('已支付','待支付','支付失败','已取消'),false)status_known,
 a.member_level native_member_level,a.recharge_count native_recharge_count
 from private.ar_91club_submission_facts a where $2::text='IN' and $3::text='91CLUB'
 and a.applied_at>=($5 at time zone $4)and a.applied_at<($6 at time zone $4)),successes as materialized(select nullif(btrim(a.member_id),'')member_id,a.completed_at::date as day from private.ar_91club_submission_facts a
 where $2::text='IN'and $3::text='91CLUB'and a.status='已支付'
 and a.completed_at>=($5 at time zone $4)and a.completed_at<($6 at time zone $4)), typed_orders as materialized (
 select s.order_id,s.member_id,(s.created_at at time zone $4)::date as day,
  (s.created_at>=$15 and s.created_at<$16) selected_clock,
  s.raw_provider,s.paid,s.status_known,
  case when s.native_member_level between 0 and 9999 then s.native_member_level end member_level,
  case when s.native_recharge_count between 0 and 999999999 then s.native_recharge_count end recharge_count
 from source_rows s where s.created_at is not null
), native_provider_summary as materialized (
 -- One native-provider pass supplies both canonical names and selected coverage.
 -- Preserve every whole-day provider here; filtering happens after canonicalization.
 select o.raw_provider,
  count(*) filter(where o.selected_clock and $17::text is not null) selected_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null) missing_member_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_level is null) missing_level_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o group by o.raw_provider
), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from native_provider_summary
), unplaced_members as materialized (
 select distinct nullif(btrim(a.member_id),'') member_id
 from private.ar_91club_submission_facts a
 where $2::text='IN' and $3::text='91CLUB'
  and a.applied_at is null
  and nullif(btrim(a.member_id),'') is not null
), member_days as materialized (
 select o.day,o.member_id,count(*) submitted_count,count(*) filter(where o.paid) cohort_success_count,
  bool_and(o.status_known) statuses_known,
  count(*) filter(where nullif(btrim(o.order_id),'') is null)=0
   and bool_and(u.member_id is null) sequence_known,
  count(*) filter(where not o.status_known) unknown_status_count,
  count(*) filter(where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null) selected_count,
  case when max(o.recharge_count)>0 then 'funded'
   when count(o.recharge_count)=count(*) and max(o.recharge_count)=0 and count(o.member_level)=count(*) and max(o.member_level)=0 then 'new' else 'unknown' end member_class,
  bool_or(o.member_level=0) has_l0
 from typed_orders o left join unplaced_members u using(member_id) join canonical c using(raw_provider)
 where o.member_id is not null group by o.day,o.member_id
), eligible as materialized (
 select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
  and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
  and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
), selected_provider_summary as materialized (
 -- Merge native aliases only after the existing canonical helper. Count sums
 -- retain bigint types and exclude zero selected rows exactly as the old WHERE.
 select c.provider,sum(n.selected_count)::bigint selected_count,
  sum(n.missing_member_count)::bigint missing_member_count,
  sum(n.missing_level_count)::bigint missing_level_count,
  sum(n.missing_recharge_count)::bigint missing_recharge_count,
  sum(n.missing_member_unknown_count)::bigint missing_member_unknown_count
 from native_provider_summary n join canonical c using(raw_provider)
 where n.selected_count>0 and ($8::text[] is null or c.provider=any($8))
 group by c.provider
), qualified_orders as materialized (
 -- This materialization contains only eligible, selected rows. It prevents the
 -- scalar money helper from moving back into the full-day source scan.
 select o.day,o.member_id,c.provider,m.submitted_count,m.member_class,m.has_l0,
  o.order_id
 from typed_orders o join eligible m using(day,member_id) join canonical c using(raw_provider)
 where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null
), qualified_amounts as materialized (
 select q.day,q.member_id,q.provider,q.submitted_count,q.member_class,q.has_l0,
  (select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)
   from private.ar_91club_submission_facts a
   where a.source_system='AR' and a.country_code=$2 and a.platform=$3
    and a.order_kind='recharge' and a.order_no=q.order_id) amount
 from qualified_orders q
), qualified_members as (
 select q.day,q.member_id,q.provider,max(q.submitted_count) submitted_count,max(q.member_class) member_class,bool_or(q.has_l0) has_l0,
  count(*) invalid_count,count(*) filter(where q.amount is null) missing_amount,coalesce(sum(q.amount),0) invalid_amount
 from qualified_amounts q group by q.day,q.member_id,q.provider
), metric_values as (
 select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,
  count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
  count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
  sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
 from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
 group by grouping sets ((q.provider,t.threshold),(t.threshold))
), dimensions as (select null::text provider union all select provider from selected_provider_summary), metrics as (
 select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
  coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
  coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
  coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,
  coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
 from dimensions d cross join unnest($22::integer[]) t(threshold)
 left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
), selected_coverage as (
 select coalesce(sum(selected_count),0)::bigint order_count,
  coalesce(sum(missing_member_count),0)::bigint missing_member_count,
  coalesce(sum(missing_level_count),0)::bigint missing_level_count,
  coalesce(sum(missing_recharge_count),0)::bigint missing_recharge_count,
  coalesce(sum(missing_member_unknown_count),0)::bigint missing_member_unknown_count
 from selected_provider_summary
)
select jsonb_build_object('dashboard',null,
 'metrics',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m),
 'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
  'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
  'unknownStatusCount',coalesce((select sum(m.unknown_status_count)::bigint from member_days m where m.selected_count>0),0)+sc.missing_member_unknown_count,
  'orderSequenceUncertainCount',coalesce((select sum(m.selected_count)::bigint from member_days m where not m.sequence_known),0),
  'sourceCompletenessVerified',false) from selected_coverage sc),
 'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$q$;
   end if;
  end if;
 end if;
 if v_operation='summary'and v_charts
  and v_platform.source='ar'and v_platform.scope_group='IN'and v_platform.source_name='91CLUB'
  and position('from private.ar_91club_submission_facts'in v_source)>0 then
  -- Exact proved 91CLUB chart lane; main auth, proof/money guard, source dates,
  -- independent completed-day read, status and finite threshold rules persist.
 v_sql:=$compact$with source_rows as not materialized ($compact$||v_source||$compact$),successes as materialized ($compact$||v_success||$compact$),
 typed_orders as materialized (
  -- One compact native pass. Original getters/money atoms remain intact;
  -- the summary never consumes per-order source status or raw level text.
  select s.order_id,s.member_id,s.created_at,(s.created_at at time zone $4)::date as day,
   case when s.created_at is not null then s.amount end amount,s.currency,s.raw_provider,s.paid,s.status_known,
   case when s.created_at is not null then case
    when upper(btrim(s.level_text))~'^L(V)?[0-9]{1,4}$'then regexp_replace(upper(btrim(s.level_text)),'^LV?','')::int
    when btrim(s.level_text)~'^[0-9]{1,4}$'then btrim(s.level_text)::int end end member_level,
   case when s.created_at is not null and btrim(s.count_text)~'^[0-9]{1,9}$'then btrim(s.count_text)::int end recharge_count
  from source_rows s
 ),canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider)provider
  from(select distinct raw_provider from typed_orders)names
 ),unplaced_members as materialized (
  select distinct member_id from typed_orders where created_at is null and member_id is not null
 ),orders as not materialized (
  select o.*,c.provider,coalesce(($8::text[]is null or c.provider=any($8))and o.created_at>=$15 and o.created_at<$16 and o.currency=$17,false)selected
  from typed_orders o join canonical c using(raw_provider)where created_at is not null
 ),member_days as materialized (
  -- Keep whole-day/all-provider qualification and exact DISTINCT sequence.
  -- No full-cohort money SUM or detail-only first/last values in a chart read.
  select day,member_id,count(*)submitted_count,count(*)filter(where paid)cohort_success_count,
   bool_and(status_known)statuses_known,count(*)filter(where not status_known)unknown_status_count,
   count(*)filter(where nullif(btrim(order_id),'')is null)=0 and count(distinct order_id)=count(*)and bool_and(u.member_id is null)sequence_known,
   count(*)filter(where selected)selected_count,
   case when max(recharge_count)>0 then 'funded'when count(recharge_count)=count(*)and max(recharge_count)=0 and count(member_level)=count(*)and max(member_level)=0 then 'new'else 'unknown'end member_class,
   bool_or(member_level=0)has_l0
  from orders left join unplaced_members u using(member_id)where member_id is not null group by day,member_id
 ),eligible as materialized (
  select m.*from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
   and($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
   and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
 ),selected_orders as not materialized (
  select o.day,o.member_id,o.provider,o.created_at,o.amount,o.paid,o.status_known,o.member_level,o.recharge_count
  from orders o where selected
 ),selected_coverage as (
  select count(*)order_count,count(*)filter(where member_id is null)missing_member_count,
   count(*)filter(where member_level is null)missing_level_count,count(*)filter(where recharge_count is null)missing_recharge_count,
   count(*)filter(where member_id is null and not status_known)missing_member_unknown_count
  from selected_orders
 ),qualified as not materialized (
  select o.day,o.member_id,o.provider,o.amount,m.submitted_count,m.member_class,m.has_l0
  from selected_orders o join eligible m using(day,member_id)
 ), qualified_members as materialized (
  -- Aggregate each provider/member/day once before calculating thresholds.
  select day,member_id,provider,max(submitted_count) submitted_count,max(member_class) member_class,bool_or(has_l0) has_l0,
   count(*) invalid_count,count(*) filter(where amount is null) missing_amount,coalesce(sum(amount),0) invalid_amount
  from qualified where $14='summary' group by day,member_id,provider
 ), metric_values as (
  select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
   count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
   sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
  from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
  group by grouping sets ((q.provider,t.threshold),(t.threshold))
 ), dimensions as (select null::text provider union all select distinct provider from selected_orders), metrics as (
  select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
   coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
   coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
   coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
  from dimensions d cross join unnest($22::integer[]) t(threshold)
  left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
 ),
 dashboard_orders as materialized (
  select o.provider,o.created_at,o.day,o.amount,o.paid,(e.member_id is not null) flagged
  from selected_orders o left join eligible e on e.day=o.day and e.member_id=o.member_id and e.submitted_count>$9 where $14='summary' and $21
 ), monitoring as (
  select provider,count(*) order_count,count(*) filter(where paid) success_count,
   case when count(*) filter(where amount is null)>0 then null else coalesce(sum(amount),0)::text end order_amount,
   count(*) filter(where flagged) invalid_count,
   case when count(*) filter(where flagged and amount is null)>0 then null else coalesce(sum(amount) filter(where flagged),0)::text end invalid_amount,
   min(created_at at time zone $4) filter(where flagged) first_at,max(created_at at time zone $4) filter(where flagged) last_at
  from dashboard_orders group by grouping sets ((),(provider))
 ), heatmap as (
  select provider,extract(hour from created_at at time zone $4)::int as hour,count(*) count
  from dashboard_orders where flagged group by provider,hour
 ), daily_chart as (
  select day,count(*) order_count,count(*) filter(where flagged) invalid_count
  from dashboard_orders group by day
 ), amount_chart as (
  select case when amount is null then 'unknown' when $19::numeric[] is null then 'unconfigured'
   when amount<$19[1] then 'below' when amount>$19[11] then 'above' when amount=$19[11] then 'band:9'
   else 'band:'||(select i-1 from generate_series(1,10)i where amount >= $19[i] and amount < $19[i+1])::text end bucket,
   count(*) count
  from dashboard_orders where flagged group by bucket
 ), frequency_chart as (
  select case when max(submitted_count)>=100 then '100+' when max(submitted_count)>=50 then '50–99'
   when max(submitted_count)>=30 then '30–49' when max(submitted_count)>=20 then '20–29' else '10–19' end band
  from qualified_members where $14='summary' and $21 group by day,member_id
 ), frequency_counts as (select band,count(*) count from frequency_chart group by band)
 select jsonb_build_object(
  'dashboard',case when $14='summary' and $21 then jsonb_build_object(
   'version',3,'threshold',$9,'exemptCount',0,'thresholdComparison','gt','amountBands',$20::jsonb,
   'monitoring',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first),'[]'::jsonb) from monitoring m),
   'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by provider,hour),'[]'::jsonb) from heatmap h),
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]'::jsonb) from daily_chart d),
   'amounts',(select coalesce(jsonb_agg(to_jsonb(a) order by bucket),'[]'::jsonb) from amount_chart a),
   'frequency',(select coalesce(jsonb_agg(to_jsonb(f) order by band),'[]'::jsonb) from frequency_counts f)) end,
  'metrics',case when $14='summary' then (select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m) end,
  'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
   'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
   -- Count the actual unknown-status rows in the selected members' whole-day
   -- cohorts, including another provider/time slice. Those rows prevent a
   -- no-success conclusion; unrelated member-days must not taint this scope.
   -- Missing-member rows cannot be joined to a cohort, so retain the selected
   -- unknown rows separately without counting known affected rows as unknown.
   'unknownStatusCount',coalesce((select sum(unknown_status_count)::bigint from member_days where selected_count>0),0)
     +sc.missing_member_unknown_count,
   'orderSequenceUncertainCount',coalesce((select sum(selected_count)::bigint from member_days where not sequence_known),0),
   'sourceCompletenessVerified',false) from selected_coverage sc),
  'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$compact$;
 end if;
 if v_operation='summary' and v_charts and v_platform.source='ar'
  and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and position('from private.ar_91club_submission_facts' in v_source)>0 then
  -- Validated fixed four-key population + immediate five-key PK make order_id
  -- unique. Preserve blank IDs and whole-history unplaced-member exclusion.
  -- Exact generation has already proved native int4 types. Its canonical int
  -- text has only 0..9999 / 0..999999999 accepted by the original regex.
  v_sql:=replace(v_sql,'a.member_level::text level_text','a.member_level member_level_native');
  v_sql:=replace(v_sql,'a.recharge_count::text count_text','a.recharge_count recharge_count_native');
  v_sql:=replace(v_sql,$parseold$   case when s.created_at is not null then case
    when upper(btrim(s.level_text))~'^L(V)?[0-9]{1,4}$'then regexp_replace(upper(btrim(s.level_text)),'^LV?','')::int
    when btrim(s.level_text)~'^[0-9]{1,4}$'then btrim(s.level_text)::int end end member_level,
   case when s.created_at is not null and btrim(s.count_text)~'^[0-9]{1,9}$'then btrim(s.count_text)::int end recharge_count$parseold$,$parsenew$   case when s.created_at is not null and s.member_level_native between 0 and 9999 then s.member_level_native end member_level,
   case when s.created_at is not null and s.recharge_count_native between 0 and 999999999 then s.recharge_count_native end recharge_count$parsenew$);
  v_sql:=replace(v_sql,$seqold$count(*)filter(where nullif(btrim(order_id),'')is null)=0 and count(distinct order_id)=count(*)and bool_and(u.member_id is null)sequence_known$seqold$,$seqnew$count(*)filter(where nullif(btrim(order_id),'')is null)=0 and bool_and(u.member_id is null)sequence_known$seqnew$);
 end if;
 if v_platform.source='ar' then
  v_sql:=replace(v_sql,'select distinct member_id from source_rows where created_at is null and member_id is not null',
   'select distinct member_id from ('||v_undated_source||') s where created_at is null and member_id is not null');
 end if;
 -- Exact MAAN charge summaries. Original auth/catalog/filter validation has
 -- already completed; unproved days, schema/maintenance drift or other zones
 -- keep the ordinary native path. No cache or upstream completeness is implied.
 if v_operation='summary'and v_platform.source='newar'
 and v_platform.scope_group='IN'and v_platform.source_name='MAANWIN'
 and v_platform.timezone in('Asia/Kolkata','Asia/Calcutta')
 and (v_from at time zone v_platform.timezone)::date>=date'2026-10-10'
 and to_regclass('private.maan_submission_facts')is not null
 and to_regclass('private.maan_submission_epoch')is not null
 and to_regclass('private.maan_submission_ready')is not null
 and to_regclass('private.maan_submission_future_ready')is not null then
  perform 1 from public.newar_detail_records limit 0;
  perform 1 from private.maan_submission_facts limit 0;
  perform 1 from private.maan_submission_epoch limit 0;
  perform 1 from private.maan_submission_ready limit 0;
  perform 1 from private.maan_submission_future_ready limit 0;
  if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['maan_submission_generation','maan_submission_can_read']))::text))is not distinct from '8df2fa80e7e883e25106e7b77eb51bd9'then
   if private.maan_submission_can_read((v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
    v_sql:=$maan_query$with source_rows as not materialized (select f.order_id,f.member_id,f.created_at,f.amount,f.currency,f.raw_provider,f.paid,f.status_known,
 f.member_level member_level_native,f.recharge_count recharge_count_native
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.created_at>=$5 and f.created_at<$6
 and(t.launch_at is null or f.created_at>=t.launch_at or f.created_at is null)
 union all select f.order_id,f.member_id,f.created_at,f.amount,f.currency,f.raw_provider,f.paid,f.status_known,
 f.member_level member_level_native,f.recharge_count recharge_count_native
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.created_at is null
 and(t.launch_at is null or f.created_at>=t.launch_at or f.created_at is null)),successes as materialized (select f.member_id,(f.success_at at time zone $4)::date as day
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.paid and f.success_at>=$5 and f.success_at<$6
 and(t.launch_at is null or f.created_at>=t.launch_at)),
 typed_orders as materialized (
  -- One compact native pass. Original getters/money atoms remain intact;
  -- the summary never consumes per-order source status or raw level text.
  select s.order_id,s.member_id,s.created_at,(s.created_at at time zone $4)::date as day,
   case when s.created_at is not null then s.amount end amount,s.currency,s.raw_provider,s.paid,s.status_known,
   case when s.created_at is not null then s.member_level_native end member_level,
   case when s.created_at is not null then s.recharge_count_native end recharge_count
  from source_rows s
 ),canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider)provider
  from(select distinct raw_provider from typed_orders)names
 ),unplaced_members as materialized (
  select distinct member_id from typed_orders where created_at is null and member_id is not null
 ),orders as not materialized (
  select o.*,c.provider,coalesce(($8::text[]is null or c.provider=any($8))and o.created_at>=$15 and o.created_at<$16 and o.currency=$17,false)selected
  from typed_orders o join canonical c using(raw_provider)where created_at is not null
 ),member_days as materialized (
  -- Keep whole-day/all-provider qualification and exact DISTINCT sequence.
  -- No full-cohort money SUM or detail-only first/last values in a chart read.
  select day,member_id,count(*)submitted_count,count(*)filter(where paid)cohort_success_count,
   bool_and(status_known)statuses_known,count(*)filter(where not status_known)unknown_status_count,
   count(*)filter(where nullif(btrim(order_id),'')is null)=0 and count(distinct order_id)=count(*)and bool_and(u.member_id is null)sequence_known,
   count(*)filter(where selected)selected_count,
   case when max(recharge_count)>0 then 'funded'when count(recharge_count)=count(*)and max(recharge_count)=0 and count(member_level)=count(*)and max(member_level)=0 then 'new'else 'unknown'end member_class,
   bool_or(member_level=0)has_l0
  from orders left join unplaced_members u using(member_id)where member_id is not null group by day,member_id
 ),eligible as materialized (
  select m.*from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
   and($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
   and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
 ),selected_orders as not materialized (
  select o.day,o.member_id,o.provider,o.created_at,o.amount,o.paid,o.status_known,o.member_level,o.recharge_count
  from orders o where selected
 ),selected_coverage as (
  select count(*)order_count,count(*)filter(where member_id is null)missing_member_count,
   count(*)filter(where member_level is null)missing_level_count,count(*)filter(where recharge_count is null)missing_recharge_count,
   count(*)filter(where member_id is null and not status_known)missing_member_unknown_count
  from selected_orders
 ),qualified as not materialized (
  select o.day,o.member_id,o.provider,o.amount,m.submitted_count,m.member_class,m.has_l0
  from selected_orders o join eligible m using(day,member_id)
 ), qualified_members as materialized (
  -- Aggregate each provider/member/day once before calculating thresholds.
  select day,member_id,provider,max(submitted_count) submitted_count,max(member_class) member_class,bool_or(has_l0) has_l0,
   count(*) invalid_count,count(*) filter(where amount is null) missing_amount,coalesce(sum(amount),0) invalid_amount
  from qualified where $14='summary' group by day,member_id,provider
 ), metric_values as (
  select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
   count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
   sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
  from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
  group by grouping sets ((q.provider,t.threshold),(t.threshold))
 ), dimensions as (select null::text provider union all select distinct provider from selected_orders), metrics as (
  select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
   coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
   coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
   coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
  from dimensions d cross join unnest($22::integer[]) t(threshold)
  left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
 ),
 dashboard_orders as materialized (
  select o.provider,o.created_at,o.day,o.amount,o.paid,(e.member_id is not null) flagged
  from selected_orders o left join eligible e on e.day=o.day and e.member_id=o.member_id and e.submitted_count>$9 where $14='summary' and $21
 ), monitoring as (
  select provider,count(*) order_count,count(*) filter(where paid) success_count,
   case when count(*) filter(where amount is null)>0 then null else coalesce(sum(amount),0)::text end order_amount,
   count(*) filter(where flagged) invalid_count,
   case when count(*) filter(where flagged and amount is null)>0 then null else coalesce(sum(amount) filter(where flagged),0)::text end invalid_amount,
   min(created_at at time zone $4) filter(where flagged) first_at,max(created_at at time zone $4) filter(where flagged) last_at
  from dashboard_orders group by grouping sets ((),(provider))
 ), heatmap as (
  select provider,extract(hour from created_at at time zone $4)::int as hour,count(*) count
  from dashboard_orders where flagged group by provider,hour
 ), daily_chart as (
  select day,count(*) order_count,count(*) filter(where flagged) invalid_count
  from dashboard_orders group by day
 ), amount_chart as (
  select case when amount is null then 'unknown' when $19::numeric[] is null then 'unconfigured'
   when amount<$19[1] then 'below' when amount>$19[11] then 'above' when amount=$19[11] then 'band:9'
   else 'band:'||(select i-1 from generate_series(1,10)i where amount >= $19[i] and amount < $19[i+1])::text end bucket,
   count(*) count
  from dashboard_orders where flagged group by bucket
 ), frequency_chart as (
  select case when max(submitted_count)>=100 then '100+' when max(submitted_count)>=50 then '50–99'
   when max(submitted_count)>=30 then '30–49' when max(submitted_count)>=20 then '20–29' else '10–19' end band
  from qualified_members where $14='summary' and $21 group by day,member_id
 ), frequency_counts as (select band,count(*) count from frequency_chart group by band)
 select jsonb_build_object(
  'dashboard',case when $14='summary' and $21 then jsonb_build_object(
   'version',3,'threshold',$9,'exemptCount',0,'thresholdComparison','gt','amountBands',$20::jsonb,
   'monitoring',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first),'[]'::jsonb) from monitoring m),
   'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by provider,hour),'[]'::jsonb) from heatmap h),
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]'::jsonb) from daily_chart d),
   'amounts',(select coalesce(jsonb_agg(to_jsonb(a) order by bucket),'[]'::jsonb) from amount_chart a),
   'frequency',(select coalesce(jsonb_agg(to_jsonb(f) order by band),'[]'::jsonb) from frequency_counts f)) end,
  'metrics',case when $14='summary' then (select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m) end,
  'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
   'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
   -- Count the actual unknown-status rows in the selected members' whole-day
   -- cohorts, including another provider/time slice. Those rows prevent a
   -- no-success conclusion; unrelated member-days must not taint this scope.
   -- Missing-member rows cannot be joined to a cohort, so retain the selected
   -- unknown rows separately without counting known affected rows as unknown.
   'unknownStatusCount',coalesce((select sum(unknown_status_count)::bigint from member_days where selected_count>0),0)
     +sc.missing_member_unknown_count,
   'orderSequenceUncertainCount',coalesce((select sum(selected_count)::bigint from member_days where not sequence_known),0),
   'sourceCompletenessVerified',false) from selected_coverage sc),
  'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$maan_query$;
   end if;
  end if;
 end if;
 -- ar_native_compact_summary_v1: reuse the existing exact compact summary
 -- algorithm for these two native scopes, without facts, proof or new objects.
 -- Native full5PK proves order_id uniqueness; integer bounds preserve old text
 -- parsing. Keep blank-ID/ALL-history NULL exclusions and independent paid day.
 if v_platform.source='ar' and v_platform.scope_group='IN'
  and v_platform.source_name in('JAICLUB','JALWA')
  and v_operation='summary' and not v_charts then
  perform 1 from public.ar_collected_orders limit 0;
  if(select count(*)=2 from pg_attribute a where a.attrelid='public.ar_collected_orders'::regclass
    and a.attname in('member_level','recharge_count')and a.attnum>0 and not a.attisdropped
    and a.atttypid='integer'::regtype and a.atttypmod=-1 and not a.atthasdef
    and a.attgenerated=''and a.attidentity='')
  and not exists(select 1 from pg_inherits where inhparent='public.ar_collected_orders'::regclass or inhrelid='public.ar_collected_orders'::regclass)
  and exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
    where c.conrelid='public.ar_collected_orders'::regclass and c.contype='p'
    and c.convalidated and not c.condeferrable and not c.condeferred
    and i.indisprimary and i.indisunique and i.indimmediate and i.indisvalid and i.indisready and i.indislive
    and i.indpred is null and i.indexprs is null
    and pg_get_constraintdef(c.oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
  and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
    and md5(p.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'and p.proowner='postgres'::regrole
    and p.prolang=(select oid from pg_language where lanname='sql')and p.provolatile='i'and p.proparallel='s'
    and not p.prosecdef and not p.proisstrict and not p.proleakproof and not p.proretset
    and p.prorettype='numeric'::regtype and p.pronargs=8 and p.pronargdefaults=0 and p.provariadic=0
    and p.proconfig=array['search_path=""']::text[]and p.proacl::text='{postgres=X/postgres}'
    and pg_get_function_arguments(p.oid)='p_country text, p_kind text, p_channel_type text, p_version smallint, p_local numeric, p_local_currency text, p_issue text, p_legacy_display numeric') then
  v_sql:=$ar_native_compact$with source_rows as not materialized (select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
 a.applied_at at time zone $4 created_at,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
 a.status='已支付' paid,coalesce(a.status in('已支付','待支付','支付失败','已取消'),false)status_known,
 a.member_level native_member_level,a.recharge_count native_recharge_count
 from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')
 and a.applied_at>=($5 at time zone $4)and a.applied_at<($6 at time zone $4)),successes as materialized(select nullif(btrim(a.member_id),'')member_id,a.completed_at::date as day from public.ar_collected_orders a
 where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')and a.status='已支付'
 and a.completed_at>=($5 at time zone $4)and a.completed_at<($6 at time zone $4)), typed_orders as materialized (
 select s.order_id,s.member_id,(s.created_at at time zone $4)::date as day,
  (s.created_at>=$15 and s.created_at<$16) selected_clock,
  s.raw_provider,s.paid,s.status_known,
  case when s.native_member_level between 0 and 9999 then s.native_member_level end member_level,
  case when s.native_recharge_count between 0 and 999999999 then s.native_recharge_count end recharge_count
 from source_rows s where s.created_at is not null
), native_provider_summary as materialized (
 -- One native-provider pass supplies both canonical names and selected coverage.
 -- Preserve every whole-day provider here; filtering happens after canonicalization.
 select o.raw_provider,
  count(*) filter(where o.selected_clock and $17::text is not null) selected_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null) missing_member_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_level is null) missing_level_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o group by o.raw_provider
), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from native_provider_summary
), unplaced_members as materialized (
 select distinct nullif(btrim(a.member_id),'') member_id
 from public.ar_collected_orders a
 where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge' and $2::text='IN' and $3::text in('JAICLUB','JALWA')
  and a.applied_at is null
  and nullif(btrim(a.member_id),'') is not null
), member_days as materialized (
 select o.day,o.member_id,count(*) submitted_count,count(*) filter(where o.paid) cohort_success_count,
  bool_and(o.status_known) statuses_known,
  count(*) filter(where nullif(btrim(o.order_id),'') is null)=0
   and bool_and(u.member_id is null) sequence_known,
  count(*) filter(where not o.status_known) unknown_status_count,
  count(*) filter(where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null) selected_count,
  case when max(o.recharge_count)>0 then 'funded'
   when count(o.recharge_count)=count(*) and max(o.recharge_count)=0 and count(o.member_level)=count(*) and max(o.member_level)=0 then 'new' else 'unknown' end member_class,
  bool_or(o.member_level=0) has_l0
 from typed_orders o left join unplaced_members u using(member_id) join canonical c using(raw_provider)
 where o.member_id is not null group by o.day,o.member_id
), eligible as materialized (
 select m.* from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
  and ($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
  and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
), selected_provider_summary as materialized (
 -- Merge native aliases only after the existing canonical helper. Count sums
 -- retain bigint types and exclude zero selected rows exactly as the old WHERE.
 select c.provider,sum(n.selected_count)::bigint selected_count,
  sum(n.missing_member_count)::bigint missing_member_count,
  sum(n.missing_level_count)::bigint missing_level_count,
  sum(n.missing_recharge_count)::bigint missing_recharge_count,
  sum(n.missing_member_unknown_count)::bigint missing_member_unknown_count
 from native_provider_summary n join canonical c using(raw_provider)
 where n.selected_count>0 and ($8::text[] is null or c.provider=any($8))
 group by c.provider
), qualified_orders as materialized (
 -- This materialization contains only eligible, selected rows. It prevents the
 -- scalar money helper from moving back into the full-day source scan.
 select o.day,o.member_id,c.provider,m.submitted_count,m.member_class,m.has_l0,
  o.order_id
 from typed_orders o join eligible m using(day,member_id) join canonical c using(raw_provider)
 where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null
), qualified_amounts as materialized (
 select q.day,q.member_id,q.provider,q.submitted_count,q.member_class,q.has_l0,
  (select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)
   from public.ar_collected_orders a
   where a.source_system='AR' and a.country_code=$2 and a.platform=$3
    and a.order_kind='recharge' and a.order_no=q.order_id) amount
 from qualified_orders q
), qualified_members as (
 select q.day,q.member_id,q.provider,max(q.submitted_count) submitted_count,max(q.member_class) member_class,bool_or(q.has_l0) has_l0,
  count(*) invalid_count,count(*) filter(where q.amount is null) missing_amount,coalesce(sum(q.amount),0) invalid_amount
 from qualified_amounts q group by q.day,q.member_id,q.provider
), metric_values as (
 select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,
  count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
  count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
  sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
  count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
 from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
 group by grouping sets ((q.provider,t.threshold),(t.threshold))
), dimensions as (select null::text provider union all select provider from selected_provider_summary), metrics as (
 select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
  coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
  coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
  coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,
  coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
 from dimensions d cross join unnest($22::integer[]) t(threshold)
 left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
), selected_coverage as (
 select coalesce(sum(selected_count),0)::bigint order_count,
  coalesce(sum(missing_member_count),0)::bigint missing_member_count,
  coalesce(sum(missing_level_count),0)::bigint missing_level_count,
  coalesce(sum(missing_recharge_count),0)::bigint missing_recharge_count,
  coalesce(sum(missing_member_unknown_count),0)::bigint missing_member_unknown_count
 from selected_provider_summary
)
select jsonb_build_object('dashboard',null,
 'metrics',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m),
 'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
  'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
  'unknownStatusCount',coalesce((select sum(m.unknown_status_count)::bigint from member_days m where m.selected_count>0),0)+sc.missing_member_unknown_count,
  'orderSequenceUncertainCount',coalesce((select sum(m.selected_count)::bigint from member_days m where not m.sequence_known),0),
  'sourceCompletenessVerified',false) from selected_coverage sc),
 'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$ar_native_compact$;
  end if;
 end if;
 execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,
  v_providers,v_threshold,v_level,v_offset,v_limit,v_member,v_operation,v_start,v_end,coalesce(v_currency,v_platform.currency),v_confirmations,v_edges,v_bands,v_charts,v_thresholds,v_day,v_yash_coverage;
 if v_operation<>'memberOrders' then v_result:=v_result-array['amountGroups','memberId','day','offset','limit','hasMore'];end if;
 if v_yash_coverage is not null then
  select count(*) filter(where not coalesce((e.value->>'complete')::boolean,false)),
   jsonb_build_object('missingMemberCount',coalesce(sum((e.value->>'missingMemberCount')::bigint),0),
    'unknownStatusCount',coalesce(sum((e.value->>'unknownStatusCount')::bigint),0),
    'orderSequenceUncertainCount',coalesce(sum((e.value->>'orderSequenceUncertainCount')::bigint),0),
    'missingSuccessTimeCount',coalesce(sum((e.value->>'missingSuccessTimeCount')::bigint),0))
   into v_yash_unknown_days,v_yash_quality from jsonb_each(v_yash_coverage)e;
  foreach v_key in array array['missingMemberCount','unknownStatusCount','orderSequenceUncertainCount','missingSuccessTimeCount'] loop
   v_yash_quality:=jsonb_set(v_yash_quality,array[v_key],to_jsonb(greatest(coalesce((v_result->'coverage'->>v_key)::bigint,0),(v_yash_quality->>v_key)::bigint)));
  end loop;
  v_result:=jsonb_set(v_result,'{coverage}',v_result->'coverage'||v_yash_quality||jsonb_build_object(
   'coverageUnknownDays',v_yash_unknown_days,'sourceCompletenessVerified',v_yash_unknown_days=0,
   'calculationComplete',v_yash_unknown_days=0 and not exists(select 1 from jsonb_each(v_yash_quality)q where (q.value#>>'{}')::bigint>0),
   'dayEvidence',v_yash_coverage));
 end if;
 return v_result||jsonb_build_object('version',3,'exemptCount',0,'thresholdComparison','gt','asOf',statement_timestamp(),'startAt',v_start,'endAt',v_end,'dayStart',v_from,'dayEnd',v_to,
  'platform',jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'country',v_platform.country,'currency',v_platform.currency,'timezone',v_platform.timezone),
  'basis','platform_local_day_all_providers_zero_success_whole_day_over_threshold','thresholds',to_jsonb(v_thresholds),'operation',v_operation);
end;
$kernel$;
REVOKE ALL ON FUNCTION private.provider_snapshot_submission_kernel(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.provider_snapshot_order_feeds_kernel(p_catalog jsonb,p_asof timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $kernel$
declare v_result jsonb;
begin
 with native as materialized (
  select jsonb_build_object('dataset','orders','system',p.source,'platformId',p.id,'name',p.name,'team',p.team,
   'country',p.country,'rawCountry',p.scope_group,'rawPlatform',p.source_name,'timezone',p.timezone,
   'provenance',jsonb_build_object('kind','direct')) f
  from jsonb_to_recordset(p_catalog) as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)
 ), expanded as (
  select f,d.direction,coalesce(nullif(f->>'timezone',''),case f->>'country'
   when '印度' then 'Asia/Kolkata' when '红膏蟹' then 'Asia/Kolkata' when '香港' then 'Asia/Kolkata' when '胖虎巴西' then 'America/Sao_Paulo' when '巴西' then 'America/Sao_Paulo' when '巴基斯坦' then 'Asia/Karachi' when '菲律宾' then 'Asia/Manila' when '印尼' then 'Asia/Jakarta' when '越南' then 'Asia/Ho_Chi_Minh' when '马来' then 'Asia/Kuala_Lumpur' when '缅甸' then 'Asia/Yangon' when '尼日利亚' then 'Africa/Lagos' when '智利' then 'America/Santiago' when '哥伦比亚' then 'America/Bogota' when '墨西哥' then 'America/Mexico_City' end) zone
  from native cross join (values('charge'::text),('withdraw'::text))d(direction)

 ), keyed as (
  select md5(jsonb_build_array(f->>'dataset',f->>'rawCountry',f->>'rawPlatform',f->>'system','direct',direction)::text) id,* from expanded
 ), dedup as (
  select distinct on(id) id,(f-'provenance')||jsonb_build_object('id',id,'direction',direction,'directions',jsonb_build_array(direction),
   'timezone',zone,'sourceKind','direct','provenance',f->'provenance','defaultEnd',case when zone is not null then (p_asof at time zone zone)::date-1 end) value
  from keyed order by id,(f?'timezone') desc,f::text
 ) select coalesce(jsonb_agg(value order by value->>'country',value->>'name',value->>'dataset',value->>'direction'),'[]'::jsonb) into v_result from dedup;
 return v_result;
end;$kernel$;
REVOKE ALL ON FUNCTION private.provider_snapshot_order_feeds_kernel(jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.provider_snapshot_intake_rows_kernel(p_feeds jsonb,p_ids text[],p_from date,p_to date,p_asof timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $kernel$
declare
 v_asof timestamptz:=p_asof;v_feeds jsonb:=p_feeds;v_feed jsonb;v_ids text[]:=p_ids;v_rows jsonb:='[]';v_result jsonb;
 -- LG_WINDOW_COVERAGE_V1: additive created-window evidence, never a full-day snapshot.
 v_lg_window_cursor jsonb;v_lg_window_coverage jsonb;v_lg_window_seconds bigint;v_lg_day_seconds bigint;
 v_from date:=p_from;v_to date:=p_to;v_day date;v_start timestamptz;v_end timestamptz;v_zone text;v_today date;v_launch timestamptz;v_run record;v_source_evidence jsonb;v_lg_runs jsonb;v_seen timestamptz;v_has boolean;
 v_raw_country text;v_raw_platform text;v_platform_id uuid;v_source text;v_direction text;v_kind text;dataset text;source_system text;source_kind text;
 status text;evidence text;received boolean;complete boolean;zero_confirmed boolean;expected boolean;collector_status text;expected_count bigint;fetched_count bigint;
 -- AR_CREATION_COVERAGE_DECL_BEGIN
 v_ar_snapshot record;v_ar_valid boolean;v_ar_counts numeric[];v_ar_value jsonb;v_ar_group jsonb;
 v_ar_expected_groups jsonb;v_ar_observed_groups jsonb;v_ar_group_key text;v_ar_group_total numeric;
 -- AR_CREATION_COVERAGE_DECL_END
begin
 for v_feed in select f from jsonb_array_elements(v_feeds)f where f->>'id'=any(v_ids) loop
  dataset:=v_feed->>'dataset';source_system:=v_feed->>'system';source_kind:=v_feed->>'sourceKind';v_source:=source_system;v_raw_country:=v_feed->>'rawCountry';v_raw_platform:=v_feed->>'rawPlatform';v_platform_id:=nullif(v_feed->>'platformId','')::uuid;v_direction:=v_feed->>'direction';v_kind:=case v_direction when 'charge' then 'recharge' else 'withdraw' end;v_zone:=v_feed->>'timezone';
  if v_zone is null or v_direction='unknown' or dataset='game66_config' then
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('feedId',v_feed->>'id','date',null,'status','unverified','received',false,'complete',false,'zeroConfirmed',false,'expected',false,'evidence',case when dataset='game66_config' then 'configuration_history_unavailable' when v_zone is null then 'source_timezone_unknown' else 'source_direction_unknown' end,'recordReceivedAt',null));continue;
  end if;
  v_today:=(v_asof at time zone v_zone)::date;v_launch:=null;
  if dataset='orders' and source_system in('newar','ar') then
   select n.launch_at into v_launch from public.newar_detail_platforms n
    where n.platform=v_raw_platform and n.country_code=v_raw_country and n.enabled
     and (source_system='newar' or exists(
      select 1 from public.ar_config_targets t where t.country_code=v_raw_country
       and t.platform=v_raw_platform and t.source_system='NEW_AR'));
  end if;
  -- All-status run history lacks a general scope index. Read it once per bounded feed, not once per day.
  v_lg_runs:='[]';v_lg_window_cursor:=null;
  if dataset='lg_orders' or(dataset='orders' and source_system='lg') then
   select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_lg_runs from(
    select distinct on(t.stat_date) t.stat_date,t.status,t.sync_mode,t.expected_count,t.source_total,t.fetched_count,t.published_at
    from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.sync_mode is distinct from 'window' and t.status is distinct from 'window' and t.stat_date between v_from and least(v_to,v_today-1)
    order by t.stat_date,t.observed_at desc,t.published_at desc nulls last)r;
   select jsonb_build_object('originAt',c.origin_at,'cursorAt',c.cursor_at) into v_lg_window_cursor
    from private.lg_window_cursors c
    where c.platform=v_raw_platform and c.country_code=v_raw_country and c.order_kind=v_kind and c.stream='created';
  end if;
  for v_day in select d::date from generate_series(v_from::timestamp,least(v_to,v_today-1)::timestamp,interval '1 day')d loop
    v_start:=v_day::timestamp at time zone v_zone;v_end:=(v_day+1)::timestamp at time zone v_zone;
    v_lg_window_coverage:=null;v_source_evidence:=null;
    if dataset='lg_orders' or(dataset='orders' and source_system='lg') then
     v_lg_day_seconds:=extract(epoch from v_end-v_start)::bigint;
     v_lg_window_seconds:=case when v_lg_window_cursor is null then 0 else greatest(0,
      extract(epoch from least(v_end,(v_lg_window_cursor->>'cursorAt')::timestamptz)
       -greatest(v_start,(v_lg_window_cursor->>'originAt')::timestamptz))::bigint) end;
     v_lg_window_coverage:=jsonb_build_object(
      'basis','created_stream_contiguous_windows','status',case
       when v_lg_window_cursor is null then 'not_initialized'
       when (v_lg_window_cursor->>'originAt')::timestamptz<=v_start
        and (v_lg_window_cursor->>'cursorAt')::timestamptz>=v_end then 'covered'
       when v_lg_window_seconds>0 then 'partial' else 'uncovered' end,
      'coveredSeconds',v_lg_window_seconds,'daySeconds',v_lg_day_seconds,
      'creationDayWindowCovered',coalesce((v_lg_window_cursor->>'originAt')::timestamptz<=v_start
       and (v_lg_window_cursor->>'cursorAt')::timestamptz>=v_end,false),
      'originAt',v_lg_window_cursor->'originAt','cursorAt',v_lg_window_cursor->'cursorAt',
      'fullDaySnapshotComplete',false,'reportComplete',false,'zeroConfirmed',false);
    end if;
   v_has:=false;v_seen:=null;status:='not_received';evidence:=case when v_direction='config' then 'no_daily_configuration_snapshot' when dataset in('orders','lg_orders') then 'no_created_orders_received' else 'no_daily_report_received' end;
   complete:=false;zero_confirmed:=false;expected:=true;collector_status:=null;expected_count:=null;fetched_count:=null;
   if v_launch is not null and v_end<=v_launch then status:='not_expected';expected:=false;evidence:='before_verified_launch';
   else
    -- WG_EXISTING_FEEDS_V1
    if dataset='orders' and source_system='panda' then
     select private.dashboard_admin_panda_day_evidence(v_raw_platform,v_direction,v_day) value into v_run;
     v_source_evidence:=v_run.value;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';fetched_count:=(v_run.value->>'count')::bigint;
     complete:=(v_run.value->>'complete')::boolean;zero_confirmed:=(v_run.value->>'zeroConfirmed')::boolean;
     collector_status:=case when complete then 'complete' else 'unverified' end;
    elsif dataset='orders' and source_system='kb' then
     select private.dashboard_admin_yash_day_evidence(v_raw_country,v_raw_platform,v_kind,v_day) value into v_run;
     v_source_evidence:=v_run.value;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';fetched_count:=(v_run.value->>'count')::bigint;
     complete:=(v_run.value->>'complete')::boolean;zero_confirmed:=(v_run.value->>'zeroConfirmed')::boolean;
     collector_status:=case when complete then 'complete' else 'unverified' end;
    elsif dataset='orders' and source_system='duoli' then
     select private.dashboard_admin_duoli_day_evidence(v_raw_platform,v_kind,v_day) value into v_run;
     v_source_evidence:=v_run.value;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';fetched_count:=(v_run.value->>'count')::bigint;
     collector_status:='source_windows';
    elsif dataset='orders' and source_system='wg' then
     select private.dashboard_admin_wg_day_evidence(s.site_code,v_kind,v_day) as value into v_run
      from private.dashboard_admin_wg_sites()s where s.country_code=v_raw_country and s.platform=v_raw_platform;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';complete:=(v_run.value->>'complete')::boolean;
     zero_confirmed:=(v_run.value->>'zeroConfirmed')::boolean;fetched_count:=(v_run.value->>'count')::bigint;
     collector_status:=case when complete then 'complete' else 'unverified' end;
    elsif dataset='orders' and source_system='ar' then
     select true,a.updated_at into v_has,v_seen from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR'
      and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR' and a.completed_at>=v_day::timestamp and a.completed_at<(v_day+1)::timestamp) then evidence:='only_success_day_records_received';end if;
     -- AR_CREATION_COVERAGE_BEGIN
     -- A successful API response or one created order is not a full-day receipt.
     -- Only charge is reconciled; payout and the independently timed success cohort stay unchanged.
     if v_direction='charge' then
      select t.snapshot,t.snapshot_id,t.snapshot_at,t.updated_at into v_ar_snapshot
       from public.collection_success_daily t where t.source_system='RECHARGE_REVIEW'
        and t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day;
      if found then
       v_ar_valid:=coalesce(jsonb_typeof(v_ar_snapshot.snapshot)='object'
        and v_ar_snapshot.snapshot->'schema_version'='1'::jsonb
        and v_ar_snapshot.snapshot->>'source_system'='RECHARGE_REVIEW'
        and v_ar_snapshot.snapshot->>'country_code'=v_raw_country
        and v_ar_snapshot.snapshot->>'platform'=v_raw_platform
        and v_ar_snapshot.snapshot->>'stat_date'=v_day::text
        and v_ar_snapshot.snapshot->>'timezone'=v_zone
        and v_ar_snapshot.snapshot->>'snapshot_id'=v_ar_snapshot.snapshot_id::text
        and v_ar_snapshot.snapshot#>'{coverage,complete}'='true'::jsonb
        and jsonb_typeof(v_ar_snapshot.snapshot->'coverage')='object'
        and jsonb_typeof(v_ar_snapshot.snapshot->'totals')='object'
        and jsonb_typeof(v_ar_snapshot.snapshot->'groups')='array'
        and isfinite(v_ar_snapshot.snapshot_at) and v_ar_snapshot.snapshot_at<=v_asof+interval '5 minutes'
        and (v_ar_snapshot.snapshot_at at time zone v_zone)::date>v_day,false);
       if v_ar_valid then
        begin
         v_ar_valid:=coalesce(jsonb_typeof(v_ar_snapshot.snapshot->'snapshot_at')='string'
          and v_ar_snapshot.snapshot->>'snapshot_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
          and (v_ar_snapshot.snapshot->>'snapshot_at')::timestamptz=v_ar_snapshot.snapshot_at,false);
        exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then v_ar_valid:=false;
        end;
       end if;
       v_ar_counts:=array[]::numeric[];
       if v_ar_valid then
        foreach v_ar_value in array array[v_ar_snapshot.snapshot#>'{coverage,expected_count}',
          v_ar_snapshot.snapshot#>'{coverage,fetched_count}',v_ar_snapshot.snapshot#>'{coverage,unique_count}',
          v_ar_snapshot.snapshot#>'{totals,submitted_count}'] loop
         if jsonb_typeof(v_ar_value) is distinct from 'number' then v_ar_valid:=false;exit;end if;
         if (v_ar_value::text)::numeric not between 0 and 9007199254740991
          or trunc((v_ar_value::text)::numeric)<>(v_ar_value::text)::numeric then v_ar_valid:=false;exit;end if;
         v_ar_counts:=array_append(v_ar_counts,(v_ar_value::text)::numeric);
        end loop;
       end if;
       if v_ar_valid then
        v_ar_valid:=v_ar_counts[1]=v_ar_counts[2] and v_ar_counts[1]=v_ar_counts[3]
         and v_ar_counts[1]=v_ar_counts[4] and jsonb_array_length(v_ar_snapshot.snapshot->'groups')<=2000;
       end if;
       v_ar_expected_groups:='{}';v_ar_group_total:=0;
       if v_ar_valid then
        for v_ar_group in select value from jsonb_array_elements(v_ar_snapshot.snapshot->'groups') loop
         if jsonb_typeof(v_ar_group) is distinct from 'object'
          or jsonb_typeof(v_ar_group->'raw_channel') is distinct from 'string'
          or jsonb_typeof(v_ar_group->'channel_type') is distinct from 'string'
          or length(v_ar_group->>'raw_channel') not between 1 and 96
          or length(v_ar_group->>'channel_type') not between 1 and 48
          or jsonb_typeof(v_ar_group->'submitted_count') is distinct from 'number' then v_ar_valid:=false;exit;end if;
         v_ar_value:=v_ar_group->'submitted_count';
         if (v_ar_value::text)::numeric not between 1 and 9007199254740991
          or trunc((v_ar_value::text)::numeric)<>(v_ar_value::text)::numeric then v_ar_valid:=false;exit;end if;
         v_ar_group_key:=jsonb_build_array(v_ar_group->>'raw_channel',v_ar_group->>'channel_type')::text;
         if v_ar_expected_groups ? v_ar_group_key then v_ar_valid:=false;exit;end if;
         v_ar_expected_groups:=v_ar_expected_groups||jsonb_build_object(v_ar_group_key,v_ar_value);
         v_ar_group_total:=v_ar_group_total+(v_ar_value::text)::numeric;
        end loop;
        v_ar_valid:=v_ar_valid and v_ar_group_total=v_ar_counts[1];
       end if;
       if v_ar_valid then
        expected_count:=v_ar_counts[1]::bigint;collector_status:='snapshot_complete';
        -- VN_INTAKE_CHANNEL_IDENTITY_BEGIN
        -- Validate raw snapshot duplicates and totals above BEFORE combining verified VN aliases.
        -- Retain channel type, including separate bank QR and MoMo identities; unknown values stay raw.
        if v_raw_country='VN' then
         select coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb)
          into v_ar_expected_groups from(
           select private.dashboard_admin_vn_intake_channel_identity(v_raw_country,r->>'raw_channel',r->>'channel_type') key,
            sum((r->>'submitted_count')::numeric) n
           from jsonb_array_elements(v_ar_snapshot.snapshot->'groups') r
           group by 1)g;
        end if;
        -- Count original groups first, then SUM canonical collisions; never let object aggregation overwrite them.
        -- No member/order fields or amounts leave this aggregate; status is deliberately irrelevant.
        select coalesce(sum(g.n),0)::bigint,coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb),max(g.seen)
         into fetched_count,v_ar_observed_groups,v_seen from(
          select private.dashboard_admin_vn_intake_channel_identity(v_raw_country,r.raw_channel,r.channel_type) key,
           sum(r.n) n,max(r.seen) seen from(
            select a.raw_channel,a.channel_type,count(*) n,max(a.updated_at) seen
            from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform
             and a.order_kind='recharge' and a.source_system='AR'
             and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp
            group by a.raw_channel,a.channel_type)r
          group by 1)g;
        -- VN_INTAKE_CHANNEL_IDENTITY_END
        v_has:=fetched_count>0;
        complete:=fetched_count=expected_count and v_ar_observed_groups=v_ar_expected_groups;
        zero_confirmed:=complete and expected_count=0;
        if complete then
         v_has:=true;v_seen:=coalesce(v_seen,v_ar_snapshot.updated_at,v_ar_snapshot.snapshot_at);
         status:=case when zero_confirmed then 'zero_complete' else 'complete' end;
         evidence:=case when zero_confirmed then 'source_completed_zero_rows' else 'source_created_counts_reconciled' end;
        else
         status:='partial';evidence:=case when fetched_count<>expected_count
          then 'source_created_count_mismatch' else 'source_created_channel_mismatch' end;
        end if;
       else
        collector_status:='snapshot_invalid';evidence:='source_snapshot_invalid';
        status:=case when coalesce(v_has,false) then 'received' else 'not_received' end;
       end if;
      end if;
     end if;
     -- AR_CREATION_COVERAGE_END
    elsif dataset='orders' and source_system='newar' then
     select true,n.received_at into v_has,v_seen from public.newar_detail_records n where n.platform=v_raw_platform and n.dataset=v_direction and n.created_at>=greatest(v_start,coalesce(v_launch,v_start)) and n.created_at<v_end limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.newar_detail_records n where n.platform=v_raw_platform and n.dataset=v_direction and n.status_group='success' and n.success_at>=v_start and n.success_at<v_end and n.created_at>=coalesce(v_launch,'-infinity'::timestamptz)) then evidence:='only_success_day_records_received';end if;
    elsif dataset='orders' and source_system='game66' then
     if v_direction='charge' then select true,g.last_seen_at into v_has,v_seen from public.game66_charge_orders g where g.platform_id=v_platform_id and g.create_time>=v_start and g.create_time<v_end limit 1;
     else select true,g.last_seen_at into v_has,v_seen from public.game66_withdraw_orders g where g.platform_id=v_platform_id and g.create_time>=v_start and g.create_time<v_end limit 1;end if;
     select r.status,r.finished_at,r.rows_fetched,r.rows_upserted,r.rows_skipped,r.error_count into v_run from public.game66_sync_runs r where r.platform_id=v_platform_id and r.data_type=v_direction and r.window_start<v_end and r.window_end>=v_start order by r.started_at desc limit 1;
     if found then
      collector_status:=v_run.status;fetched_count:=v_run.rows_fetched;
      if v_run.status='failed' then status:='failed';evidence:='source_collection_failed';
      elsif v_run.status='running' then status:='pending';evidence:='source_task_not_finished';
      elsif v_run.status='succeeded' then
       -- Fetched/upserted agreement proves receipt, not the remote day's total.
       -- This collector has no verified expected source count in its run metadata.
       status:=case when coalesce(v_has,false) then 'received' else 'unverified' end;evidence:='source_counts_not_verified';
      else status:='unverified';evidence:='source_task_state_unknown';end if;
     elsif not coalesce(v_has,false) then status:='not_started';if evidence<>'only_success_day_records_received' then evidence:='no_collection_run_evidence';end if;end if;
    elsif dataset='volume' then
     select true,t.updated_at into v_has,v_seen from public.third_party_volume t where t.country=v_raw_country and t.platform=v_raw_platform and t.data_date=v_day and t.quarantined_at is null
      and lower(btrim(t.direction))=any(case v_direction when 'charge' then array['charge','recharge','collect','deposit','代收'] else array['withdraw','payout','代付'] end)
      and case source_kind when 'google_sheets' then t.sheet_name like '[三方量表%]%' when 'direct' then (v_source='AR' and t.sheet_name like 'AR_DIRECT%') or (v_source='LG' and t.sheet_name like 'LG_DIRECT%') else coalesce(t.sheet_name,'') not like '[三方量表%]%' and coalesce(t.sheet_name,'') not like 'AR_DIRECT%' and coalesce(t.sheet_name,'') not like 'LG_DIRECT%' end limit 1;
    elsif dataset='panda_success' then
     select true,t.updated_at into v_has,v_seen from public.panda_success_rate_daily t where coalesce(nullif(t.country,''),t.country_code)=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and lower(btrim(t.direction))=any(case v_direction when 'charge' then array['charge','recharge','collect','deposit','代收'] else array['withdraw','payout','代付'] end) limit 1;
    elsif dataset='lg_success' then
     select true,coalesce(t.observed_at,t.updated_at) into v_has,v_seen from public.lg_success_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.order_kind=v_kind limit 1;
    elsif dataset='lg_orders' or (dataset='orders' and source_system='lg') then
     select true,t.updated_at into v_has,v_seen from public.lg_orders t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.created_at>=v_start and t.created_at<v_end limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.lg_orders t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.paid_at>=v_start and t.paid_at<v_end) then evidence:='only_success_day_records_received';end if;
     select t.status,t.sync_mode,t.expected_count,t.source_total,t.fetched_count,t.published_at into v_run from jsonb_to_recordset(v_lg_runs)t(stat_date date,status text,sync_mode text,expected_count bigint,source_total bigint,fetched_count bigint,published_at timestamptz) where t.stat_date=v_day;
     if found then
      collector_status:=v_run.status;expected_count:=v_run.expected_count;fetched_count:=v_run.fetched_count;
      if v_run.status='published' then
       if v_run.sync_mode='full' and v_run.expected_count>=0 and v_run.expected_count=v_run.fetched_count and v_run.source_total=v_run.expected_count and v_run.published_at is not null then
        complete:=case when v_run.expected_count=0 then not coalesce(v_has,false) else coalesce(v_has,false) end;zero_confirmed:=complete and v_run.expected_count=0;
        if complete then v_has:=true;v_seen:=v_run.published_at;status:=case when zero_confirmed then 'zero_complete' else 'complete' end;evidence:=case when zero_confirmed then 'source_completed_zero_rows' else 'source_day_task_completed' end;
        else status:='partial';evidence:=case when v_run.expected_count=0 then 'completed_zero_conflicts_with_records' else 'published_records_not_received' end;end if;
       else status:='partial';evidence:='source_counts_not_verified';end if;
      elsif v_run.status in('collecting','live') then status:='pending';evidence:=case when v_run.status='live' then 'source_full_day_not_published' else 'source_task_not_finished' end;
      elsif v_run.status='failed' then status:='failed';evidence:='source_collection_failed';
      else status:='unverified';evidence:='source_snapshot_not_published';end if;
      elsif v_lg_window_seconds>0 then status:='partial';collector_status:='window';evidence:='created_window_coverage_not_full_snapshot';
      elsif not coalesce(v_has,false) then status:='not_started';if evidence<>'only_success_day_records_received' then evidence:='no_collection_run_evidence';end if;end if;
     elsif dataset='collection_success' then
     select true,coalesce(t.snapshot_at,t.updated_at) into v_has,v_seen from public.collection_success_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.source_system=v_source limit 1;
    elsif dataset='newar_third_party_volume' then
     select true,coalesce(t.captured_at,t.updated_at) into v_has,v_seen from public.newar_business_snapshots t where coalesce(nullif(t.country,''),t.country_code)=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.kind='third_party_volume' and t.direction=v_direction limit 1;
    elsif dataset='auto' then
     select true,coalesce(t.source_updated_at,t.updated_at) into v_has,v_seen from public.auto_withdraw_daily t where t.country=v_raw_country and t.platform=v_raw_platform and t.data_date=v_day and case source_kind when 'google_sheets' then t.source_sheet like 'raw_daily_%' when 'direct' then (v_source='AR' and t.source_sheet like 'AR_DIRECT%') or (v_source='LG' and t.source_sheet like 'LG_DIRECT%') else coalesce(t.source_sheet,'') not like 'raw_daily_%' and coalesce(t.source_sheet,'') not like 'AR_DIRECT%' and coalesce(t.source_sheet,'') not like 'LG_DIRECT%' end limit 1;
    elsif dataset='ar_config' then
     select true,t.received_at into v_has,v_seen from public.ar_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    elsif dataset='panda_config' then
     select true,t.received_at into v_has,v_seen from public.panda_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    elsif dataset='wg_config' then
     
     select true,t.received_at into v_has,v_seen from (
      select c.observed_at received_at from public.wg_realtime_config_daily c
      join private.dashboard_admin_wg_sites()s on s.country_code=c.country_code
       and c.site_code=case s.country_code when 'BR' then '278' else '3257' end
      where s.country_code=v_raw_country and s.platform=v_raw_platform and c.observed_local_date=v_day
      union all
      select c.received_at from public.wg_config_daily c
      where c.country_code=v_raw_country and c.platform=v_raw_platform and c.observed_local_date=v_day
     )t order by t.received_at desc limit 1;
    else status:='unverified';evidence:='unsupported_source';end if;
   end if;
   received:=coalesce(v_has,false);if received and status='not_received' then status:='received';evidence:='records_received_completeness_unverified';end if;
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('feedId',v_feed->>'id','date',v_day,'status',status,'received',received,'complete',complete,'zeroConfirmed',zero_confirmed,'expected',expected,'evidence',evidence,'recordReceivedAt',v_seen,'collectorStatus',collector_status,'expectedCount',expected_count,'fetchedCount',fetched_count)
     ||case when dataset='lg_orders' or(dataset='orders' and source_system='lg') then jsonb_build_object('creationWindowCoverage',v_lg_window_coverage)
      when dataset='orders' and source_system in('duoli','kb','panda') then jsonb_build_object('sourceWindowCoverage',v_source_evidence->'progress',
       'createdCoverageAvailable',v_source_evidence->'createdCoverageAvailable') else '{}'::jsonb end);
  end loop;
 end loop;
 return jsonb_build_object('version',1,'complete',true,'checkedAt',v_asof,'feedIds',to_jsonb(v_ids),'startAt',v_from,'endAt',v_to,'timestampBasis','evidence_record_or_collector_receipt','rows',v_rows);
end;$kernel$;
REVOKE ALL ON FUNCTION private.provider_snapshot_intake_rows_kernel(jsonb,text[],date,date,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
-- END kernels.sql

-- BEGIN compute-payload.sql
-- Internal only: one exact native platform and one exact source snapshot.
-- This is deliberately not an authenticated/Data API entry point.
CREATE OR REPLACE FUNCTION private.provider_snapshot_compute_payload(p_target jsonb,p_request jsonb,p_component text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' SET jit='off' AS $compute$
declare
 v_catalog jsonb;v_result jsonb;v_feeds jsonb;v_ids text[];v_q jsonb;
 v_from timestamptz;v_to timestamptz;v_day date;v_end_day date;v_zone text;
 v_started timestamptz:=clock_timestamp();v_upstream boolean:=false;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='provider_snapshot_worker_denied';end if;
 if not private.provider_snapshot_kernel_contract_current()then raise exception using errcode='55000',message='provider_snapshot_kernel_contract_changed';end if;
 if jsonb_typeof(p_target) is distinct from 'object' or jsonb_typeof(p_request) is distinct from 'object'
  or p_component is null or p_component not in('orders','submission','intake')
  or p_target-array['id','name','team','country','scope_group','source','timezone','currency','source_name']<>'{}'::jsonb
  or not(p_target?&array['id','name','team','country','scope_group','source','timezone','currency','source_name'])
  or exists(select 1 from unnest(array['id','name','country','scope_group','source','timezone','currency','source_name'])k where jsonb_typeof(p_target->k)is distinct from'string'or btrim(p_target->>k)=''or(p_target->>k)~'[[:cntrl:]]')
  or p_target->>'source'not in('ar','newar','kb')or p_target->>'scope_group'<>'IN'or p_target->>'currency'<>'INR'
  or p_target->>'timezone'not in('Asia/Kolkata','Asia/Calcutta')
  or p_target->>'id' is distinct from p_request->>'platformId'
  or (p_target->>'id')::uuid<>md5((p_target->>'source')||':IN:'||(p_target->>'source_name'))::uuid
  or p_target->>'source'='kb'and p_target->>'source_name'<>'YASH.BET'
  or p_request-array['action','view','platformId','startAt','endAt','direction','status','currency','offset','limit']<>'{}'::jsonb
  or p_request->>'action' is distinct from 'aggregate' or p_request->>'view' is distinct from 'providers'
  or p_request->>'direction' is distinct from 'charge' or p_request->>'status' is distinct from 'all'
  or p_request->>'currency' is distinct from 'INR'
  or p_request->'offset'is distinct from'0'::jsonb or p_request->'limit'is distinct from'20'::jsonb
  or coalesce(p_request->>'startAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
  or coalesce(p_request->>'endAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
 then raise exception using errcode='22023',message='provider_snapshot_unsupported_request';end if;
 if not private.provider_snapshot_target_current(p_target)then raise exception using errcode='42501',message='provider_snapshot_target_changed';end if;
 v_zone:=p_target->>'timezone';v_from:=(p_request->>'startAt')::timestamptz;v_to:=(p_request->>'endAt')::timestamptz;
 v_day:=(v_from at time zone v_zone)::date;v_end_day:=((v_to-interval'1 microsecond')at time zone v_zone)::date;
 if v_from is null or v_to is null or not isfinite(v_from)or not isfinite(v_to)or v_from>=v_to or v_day<>v_end_day then
  raise exception using errcode='22023',message='provider_snapshot_unsupported_window';end if;
 v_catalog:=jsonb_build_array(p_target);
 if p_component='orders' then
  -- No provider selection is allowed in phase1, so the original expansion is
  -- a no-op; raw kernel and the SAME final canonical result function are used.
  v_result:=private.provider_snapshot_orders_result_kernel(private.provider_snapshot_orders_raw_kernel(p_request,v_catalog),p_request);
  if jsonb_typeof(v_result->'summary') is distinct from 'array' or jsonb_typeof(v_result#>'{groups,provider}') is distinct from 'array'
   or v_result#>>'{platform,id}'is distinct from p_target->>'id' then raise exception using errcode='22023',message='provider_snapshot_incomplete_result';end if;
  v_upstream:=coalesce(v_result#>'{platform,capabilities,sourceCompletenessVerified}'='true'::jsonb,false);
 elsif p_component='submission' then
  v_q:=jsonb_build_object('platformId',p_request->'platformId','startAt',p_request->'startAt','endAt',p_request->'endAt','direction','charge','currency','INR','operation','summary','charts',false);
  -- Entire selected interval in one call: never sum per-hour distinct members.
  v_result:=private.provider_snapshot_submission_kernel(v_q,v_catalog);
  if jsonb_typeof(v_result->'metrics')is distinct from'array'or jsonb_typeof(v_result->'coverage')is distinct from'object'
   or v_result#>>'{platform,id}'is distinct from p_target->>'id' then raise exception using errcode='22023',message='provider_snapshot_incomplete_result';end if;
  v_upstream:=coalesce(v_result#>'{coverage,sourceCompletenessVerified}'='true'::jsonb,false);
 else
  select coalesce(jsonb_agg(f),'[]'::jsonb)into v_feeds from jsonb_array_elements(private.provider_snapshot_order_feeds_kernel(v_catalog,statement_timestamp()))f where f->>'direction'='charge';
  select array_agg(f->>'id'order by f->>'id')into v_ids from jsonb_array_elements(v_feeds)f;
  if cardinality(v_ids)is distinct from 1 then raise exception using errcode='22023',message='provider_snapshot_incomplete_result';end if;
  v_result:=private.provider_snapshot_intake_rows_kernel(v_feeds,v_ids,v_day,v_end_day,statement_timestamp());
  if v_result->'complete'is distinct from'true'::jsonb or jsonb_typeof(v_result->'rows')is distinct from'array' then raise exception using errcode='22023',message='provider_snapshot_incomplete_result';end if;
  -- The original coverage reader intentionally has no completed-day proof for
  -- today. Empty rows are computed evidence, not a complete source receipt.
  v_result:=v_result||jsonb_build_object('snapshotWindow',jsonb_build_object('startAt',p_request->'startAt','endAt',p_request->'endAt'),'platform',jsonb_build_object('id',p_target->'id','source',p_target->'source','sourceName',p_target->'source_name','scopeGroup',p_target->'scope_group','currency',p_target->'currency','timezone',p_target->'timezone'));
  select count(*)=1 and coalesce(bool_and(r->'complete'='true'::jsonb),false)into v_upstream from jsonb_array_elements(v_result->'rows')r;
 end if;
 v_result:=jsonb_set(v_result,'{platform}',coalesce(v_result->'platform','{}'::jsonb)||jsonb_build_object('id',p_target->'id','source',p_target->'source','sourceName',p_target->'source_name','scopeGroup',p_target->'scope_group','currency',p_target->'currency','timezone',p_target->'timezone'));
 return jsonb_build_object('payload',v_result,'provenance',jsonb_build_object(
  'computationComplete',true,'sourceReadStartedAt',private.provider_snapshot_iso(v_started),'sourceReadCompletedAt',private.provider_snapshot_iso(clock_timestamp()),
  'sourceWatermark',jsonb_build_object('kind','observed_mvcc_snapshot','transactionSnapshot',pg_current_snapshot()::text,'source',p_target->'source','scopeGroup',p_target->'scope_group','sourceName',p_target->'source_name','windowFrom',p_request->'startAt','windowTo',p_request->'endAt','payloadAsOf',coalesce(v_result->'asOf',v_result->'checkedAt'),'sourceFinalityProven',false),
  'upstreamComplete',v_upstream));
end;$compute$;
REVOKE ALL ON FUNCTION private.provider_snapshot_compute_payload(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
-- END compute-payload.sql

-- BEGIN kernel-contract.sql
-- Installed-copy contract. Data/configuration revisions may change and recompute;
-- changed live algorithms/catalog or changed extracted kernels must stop computing
-- until their equivalence is reviewed and this contract is regenerated.
create function private.provider_snapshot_kernel_contract_current()
returns boolean language sql stable security invoker set search_path=''as $contract$
 select not exists(select 1 from jsonb_array_elements($expected$[{"signature":"private.dashboard_admin_live_expand_provider_filter(jsonb)","body_md5":"b07872f828acc18e8218ae6b2cc7d94e","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_intake_coverage(jsonb)","body_md5":"bc856a3698426d057fb51405b153f917","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_intake_order_feeds(timestamp with time zone)","body_md5":"0560f55418f87b16a1e9a1a570ebb21f","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"1184","allargtypes":null,"argmodes":null,"argnames":"{p_asof}","arguments":"p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.dashboard_admin_live_platforms()","body_md5":"9423bd69a95d21c9e6740c6709492395","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":1000,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":true,"argtypes":"","allargtypes":"{2950,25,25,25,25,25,25,25,25}","argmodes":"{t,t,t,t,t,t,t,t,t}","argnames":"{id,name,team,country,scope_group,source,timezone,currency,source_name}","arguments":"","result":"TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)"},{"signature":"private.dashboard_admin_live_query(jsonb)","body_md5":"396efe7ab32ea579475a7b72ab52597c","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{\"action\": \"catalog\"}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_query_raw(jsonb)","body_md5":"8877cb8cee3ec54c65fa6400f590c11d","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{\"action\": \"catalog\"}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_remap_groups(jsonb, text, text, boolean)","body_md5":"0ce8e6980d543059024eb1010d600946","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 25 25 16","allargtypes":null,"argmodes":null,"argnames":"{p_rows,p_country,p_platform,p_daily}","arguments":"p_rows jsonb, p_country text, p_platform text, p_daily boolean DEFAULT false","result":"jsonb"},{"signature":"private.dashboard_admin_live_submission_analysis(jsonb)","body_md5":"08f4fda2ac67706ff667addfca4ffdf2","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off","enable_nestloop=off"],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_compute_payload(jsonb,jsonb,text)","body_md5":"e771df2214096b0988cea30c1e130b09","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargdefaults":0,"variadic":0,"arguments":"p_target jsonb, p_request jsonb, p_component text","result":"jsonb"},{"signature":"private.provider_snapshot_intake_rows_kernel(jsonb,text[],date,date,timestamp with time zone)","body_md5":"6e0177cc753d3bb635a62df1d9eb7a5f","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargdefaults":0,"variadic":0,"arguments":"p_feeds jsonb, p_ids text[], p_from date, p_to date, p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.provider_snapshot_order_feeds_kernel(jsonb,timestamp with time zone)","body_md5":"cdb133b88c825d3ad2013b4de874c9c1","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargdefaults":0,"variadic":0,"arguments":"p_catalog jsonb, p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.provider_snapshot_orders_raw_kernel(jsonb,jsonb)","body_md5":"d4f9fec4111a4afdb07f4b40e833b24f","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargdefaults":0,"variadic":0,"arguments":"p_request jsonb, p_catalog jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_orders_result_kernel(jsonb,jsonb)","body_md5":"715baaebbacef17e302c4c6721d776ef","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargdefaults":0,"variadic":0,"arguments":"p_result jsonb, p_request jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_submission_kernel(jsonb,jsonb)","body_md5":"3d1188218a0aada52cfd2a5d6dbcbed6","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off","enable_nestloop=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargdefaults":0,"variadic":0,"arguments":"p_request jsonb, p_catalog jsonb","result":"jsonb"}]$expected$::jsonb)e
 left join lateral(select md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))actual on true
 where not coalesce(to_jsonb(actual)@>(e-'signature'),false));
$contract$;
revoke all on function private.provider_snapshot_kernel_contract_current()from public,anon,authenticated,service_role;
-- END kernel-contract.sql

-- BEGIN provider-snapshot-prepare-claim.sql
-- One short transaction. This is session-local WORKER metadata, not Auth/JWT.
-- COMMIT it before run_claimed so timeout cannot reset the durable attempt.
CREATE OR REPLACE FUNCTION private.provider_snapshot_prepare_claim(p_worker text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $claim$
declare j jsonb;backend_started timestamptz;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='provider_snapshot_worker_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0seconds'or budget>interval'3seconds'then raise exception using errcode='22023',message='provider_snapshot_claim_deadline_required';end if;
 perform set_config('provider_snapshot.claim','',false);
 j:=private.provider_snapshot_claim(p_worker,120);
 if j is null then return null;end if;
 select backend_start into backend_started from pg_catalog.pg_stat_activity where pid=pg_backend_pid();
 perform set_config('provider_snapshot.claim',jsonb_build_object('jobId',j->'jobId','runId',j->'runId','fence',j->'fence','worker',p_worker,'pid',pg_backend_pid()::text,'backendStart',backend_started)::text,false);
 return jsonb_build_object('jobId',j->'jobId','runId',j->'runId','fence',j->'fence');
end;$claim$;
REVOKE ALL ON FUNCTION private.provider_snapshot_prepare_claim(text) FROM PUBLIC,anon,authenticated,service_role;
-- END provider-snapshot-prepare-claim.sql

-- BEGIN provider-snapshot-run-claimed.sql
-- Private one-component computation after a separately COMMITTED claim.
-- The caller must establish the top-level 50s deadline before this statement.
CREATE OR REPLACE FUNCTION private.provider_snapshot_run_claimed(p_worker text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $worker$
declare j private.provider_snapshot_jobs%rowtype;x jsonb;r jsonb;code text;budget interval;claimed jsonb;backend_started timestamptz;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='provider_snapshot_worker_denied';end if;
 if p_worker is null or p_worker!~'^[-a-zA-Z0-9_:]{1,80}$'then raise exception using errcode='22023',message='invalid_snapshot_worker';end if;
 if current_setting('transaction_isolation')<>'read committed'then raise exception using errcode='22023',message='provider_snapshot_read_committed_required';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0 seconds'or budget>interval'50 seconds'then raise exception using errcode='22023',message='provider_snapshot_outer_deadline_required';end if;
 claimed:=nullif(current_setting('provider_snapshot.claim',true),'')::jsonb;
 if claimed is null then return jsonb_build_object('status','idle');end if;
 select backend_start into backend_started from pg_catalog.pg_stat_activity where pid=pg_backend_pid();
 if claimed->>'worker'is distinct from p_worker or claimed->>'pid'is distinct from pg_backend_pid()::text
  or(claimed->>'backendStart')::timestamptz is distinct from backend_started then raise exception using errcode='42501',message='provider_snapshot_claim_connection_changed';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into j from private.provider_snapshot_jobs where id=(claimed->>'jobId')::uuid and run_id=(claimed->>'runId')::uuid and fence=(claimed->>'fence')::bigint
  and worker=p_worker and status='running'and lease_until>clock_timestamp()
  and claim_backend_pid=pg_backend_pid()and claim_backend_start=backend_started for update skip locked;
 if not found then perform set_config('provider_snapshot.claim','',false);return jsonb_build_object('status','idle');end if;
 perform set_config('provider_snapshot.claim','',false);
 begin
  -- A STABLE expression reads all source rows from one consistent SQL snapshot.
  select private.provider_snapshot_compute_payload(j.target,j.request,j.component)into x;
  if x#>'{provenance,computationComplete}'is distinct from'true'::jsonb then raise exception using errcode='22023',message='provider_snapshot_incomplete_result';end if;
  -- Fresh READ COMMITTED SPI visibility; the durable attempt is never reset.
  r:=private.provider_snapshot_complete(j.id,j.run_id,j.fence,x->'payload',x->'provenance');
  return jsonb_build_object('status',case when r->'published'='true'::jsonb then'published'else'superseded'end,'jobId',j.id,'snapshotId',r->'snapshotId');
 exception
  when query_canceled then
   -- Roll back this compute transaction only. The earlier claim and its attempt
   -- survive; lease expiry is reclaimed fairly or parked after the third attempt.
   raise;
  when others then
   code:=case when SQLSTATE='40001'then'dependency_changed'when SQLERRM='provider_snapshot_incomplete_result'then'source_incomplete'else'compute_failed'end;
   perform private.provider_snapshot_fail(j.id,j.run_id,j.fence,code);
   return jsonb_build_object('status','failed','jobId',j.id,'errorCode',code);
 end;
end;$worker$;
REVOKE ALL ON FUNCTION private.provider_snapshot_run_claimed(text) FROM PUBLIC,anon,authenticated,service_role;
-- END provider-snapshot-run-claimed.sql

-- BEGIN snapshot-reader.sql
create function private.dashboard_admin_live_provider_snapshot(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_access jsonb:=private.dashboard_role_access();
 v_ids uuid[];v_components text[];v_catalog jsonb;v_entry jsonb;v_target jsonb;v_dep text;
 v_from timestamp;v_to timestamp;v_start timestamptz;v_max timestamptz;v_previous_start timestamptz;v_previous_end timestamptz;
 v_cut timestamptz;v_lookup_cut timestamptz;v_candidate timestamptz;v_fallback timestamptz;v_count integer;v_expected integer;v_export boolean:=false;
 v_all boolean:=true;v_stale boolean:=false;v_building boolean:=false;v_platforms jsonb:='[]';v_missing jsonb:='[]';v_snapshots jsonb;
 v_current jsonb;v_previous jsonb;v_component text;v_period text;v_j record;v_payload jsonb;v_state text;
 v_first timestamptz;v_next timestamptz;v_payload_from timestamptz;v_payload_to timestamptz;
 v_kernel_current boolean;v_context jsonb;v_need text[]:=array['providers.view','providers.query'];
begin
 if jsonb_typeof(p_request)is distinct from'object'or octet_length(p_request::text)>16384
  or p_request-array['version','platformIds','startAt','endAt','direction','status','currency','components','export']<>'{}'::jsonb
  or p_request->'version'is distinct from'1'::jsonb
  or jsonb_typeof(p_request->'platformIds')is distinct from'array'
  or jsonb_array_length(p_request->'platformIds')not between 1 and 50
  or exists(select 1 from jsonb_array_elements(p_request->'platformIds')x where jsonb_typeof(x)is distinct from'string'or x#>>'{}'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
 then raise exception using errcode='22023',message='invalid_snapshot_request';end if;
 if p_request?'export'then if jsonb_typeof(p_request->'export')is distinct from'boolean'then raise exception using errcode='22023',message='invalid_snapshot_request';end if;v_export:=(p_request->>'export')::boolean;end if;
 if v_export then v_need:=array_append(v_need,'providers.export');end if;
 if coalesce(v_access->>'canView','false')<>'true'or not coalesce(v_access->>'mode'in('owner','legacy')or v_access->>'mode'='assigned'and(v_access->'permissions')?&v_need,false)then raise exception using errcode='42501',message='role_permission_denied';end if;
 if v_access->>'mode'='assigned'then
  v_context:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb;
  if not private.dashboard_role_context_valid()or v_context#>>'{payload,page}'is distinct from'providers'
   or v_context#>>'{payload,rpc}'is distinct from'dashboard_admin_live_provider_snapshot'
   or v_context#>>'{payload,action}'is distinct from'providerSnapshot'then raise exception using errcode='42501',message='role_gateway_required';end if;
 end if;
 select array_agg(x::uuid order by x::uuid)into v_ids from jsonb_array_elements_text(p_request->'platformIds')x;
 if cardinality(v_ids)<>(select count(distinct x)from unnest(v_ids)x)then raise exception using errcode='22023',message='invalid_snapshot_request';end if;
 v_kernel_current:=private.provider_snapshot_kernel_contract_current();
 -- Exact native identity comes from today's authorized catalog, never client display names.
 select coalesce(jsonb_agg(jsonb_build_object('target',to_jsonb(p),'dependency',private.provider_snapshot_dependency_token(to_jsonb(p)))order by p.id),'[]')into v_catalog
 from private.dashboard_admin_live_platforms()p where p.id=any(v_ids);
 if jsonb_array_length(v_catalog)<>cardinality(v_ids)then raise exception using errcode='42501',message='platform_denied';end if;
 if p_request->>'direction'is distinct from'charge'or p_request->>'status'is distinct from'all'or p_request->>'currency'is distinct from'INR'
  or exists(select 1 from jsonb_array_elements(v_catalog)x where not coalesce(x#>>'{target,source}'in('ar','newar','kb')and x#>>'{target,scope_group}'='IN'
   and x#>>'{target,currency}'='INR'and x#>>'{target,timezone}'in('Asia/Kolkata','Asia/Calcutta'),false))then
  return jsonb_build_object('version',1,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
 end if;
 if exists(select 1 from jsonb_array_elements(v_catalog)x where not private.provider_snapshot_target_current(private.provider_snapshot_target(x->'target')))then
  return jsonb_build_object('version',1,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
 end if;
 if jsonb_typeof(p_request->'startAt')is distinct from'string'or jsonb_typeof(p_request->'endAt')is distinct from'string'
  or p_request->>'startAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'or p_request->>'endAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'
 then raise exception using errcode='22023',message='invalid_snapshot_window';end if;
 v_from:=(p_request->>'startAt')::timestamp;v_to:=(p_request->>'endAt')::timestamp;
 if to_char(v_from,'YYYY-MM-DD"T"HH24:MI:SS')<>p_request->>'startAt'or to_char(v_to,'YYYY-MM-DD"T"HH24:MI:SS')<>p_request->>'endAt'or v_to<v_from then raise exception using errcode='22023',message='invalid_snapshot_window';end if;
 if v_from::date<>v_to::date then return jsonb_build_object('version',1,'mode','published_snapshot','status','unsupported','complete',false,'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));end if;
 if jsonb_typeof(p_request->'components')is distinct from'array'or jsonb_array_length(p_request->'components')not between 1 and 3
  or exists(select 1 from jsonb_array_elements(p_request->'components')x where jsonb_typeof(x)is distinct from'string'or x#>>'{}'not in('orders','submission','intake'))then raise exception using errcode='22023',message='invalid_snapshot_components';end if;
 select array_agg(x order by x)into v_components from jsonb_array_elements_text(p_request->'components')x;
 if cardinality(v_components)<>(select count(distinct x)from unnest(v_components)x)then raise exception using errcode='22023',message='invalid_snapshot_components';end if;
 v_start:=v_from at time zone'Asia/Kolkata';v_max:=least((v_to+interval'1second')at time zone'Asia/Kolkata',statement_timestamp());v_previous_start:=(v_from-interval'1day')at time zone'Asia/Kolkata';
 v_expected:=cardinality(v_ids)*(cardinality(v_components)+(select count(*)from unnest(v_components)c where c<>'submission'));
 -- Find the full published intersection without a fixed candidate limit. Incomplete
 -- newer cutoffs can never evict the last fully published common generation.
 with eligible as materialized(
  select j.*,a.dependency_token artifact_dependency,c->>'dependency'current_dependency
  from private.provider_snapshot_jobs j join private.provider_snapshot_heads h on h.job_id=j.id
  join private.provider_snapshot_artifacts a on a.id=h.snapshot_id cross join jsonb_array_elements(v_catalog)c
  where j.target=private.provider_snapshot_target(c->'target')and j.component=any(v_components)
 ),slots as(
  select window_to cutoff,artifact_dependency=current_dependency valid from eligible where window_from=v_start and window_to<=v_max
  union all
  select ((window_to at time zone'Asia/Kolkata')+interval'1day')at time zone'Asia/Kolkata',artifact_dependency=current_dependency
  from eligible where component<>'submission'and window_from=v_previous_start
   and ((window_to at time zone'Asia/Kolkata')+interval'1day')at time zone'Asia/Kolkata'<=v_max
 )select max(cutoff)into v_cut from(select cutoff from slots group by cutoff having count(*)=v_expected and bool_and(valid))q;
 if v_cut is null then
  select max(j.window_to)into v_cut from private.provider_snapshot_jobs j join private.provider_snapshot_heads h on h.job_id=j.id
   cross join jsonb_array_elements(v_catalog)c where j.target=private.provider_snapshot_target(c->'target')
    and j.window_from=v_start and j.window_to<=v_max and j.component=any(v_components);
  v_all:=false;
 end if;
 v_lookup_cut:=v_cut;
 if v_lookup_cut is null then
  -- No published head yet: expose a queued/running generation as building without
  -- calling its cutoff published or inventing zero payloads.
  select max(j.window_to)into v_lookup_cut from private.provider_snapshot_jobs j cross join jsonb_array_elements(v_catalog)c
   where j.target=private.provider_snapshot_target(c->'target')and j.window_from=v_start and j.window_to<=v_max and j.component=any(v_components);
 end if;
 if v_lookup_cut is not null then v_previous_end:=((v_lookup_cut at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata';end if;
 for v_entry in select value from jsonb_array_elements(v_catalog)loop
  v_target:=private.provider_snapshot_target(v_entry->'target');v_dep:=v_entry->>'dependency';v_current:='{}';v_previous:='{}';v_snapshots:='[]';
  foreach v_period in array array['current','previous']loop
   v_payload_from:=case when v_period='current'then v_start else v_previous_start end;v_payload_to:=case when v_period='current'then v_lookup_cut else v_previous_end end;
   foreach v_component in array v_components loop
    if v_period='previous'and v_component='submission'then continue;end if;
    select j.status,j.last_error_code,a.next_due_at,a.id snapshot_id,a.payload,a.provenance,a.computed_at,a.dependency_token into v_j
     from private.provider_snapshot_jobs j left join private.provider_snapshot_heads h on h.job_id=j.id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
     where j.target=v_target and j.component=v_component and j.window_from=v_payload_from and j.window_to=v_payload_to;
    v_payload:=null;v_state:='missing';
    if found then
     if v_j.snapshot_id is not null then
      v_payload:=v_j.payload;v_state:=case when not v_kernel_current or v_j.dependency_token is distinct from v_dep or v_j.next_due_at<=statement_timestamp()
       or v_period='current'and v_from::date=(statement_timestamp()at time zone'Asia/Kolkata')::date and v_lookup_cut<statement_timestamp()-interval'30minutes'
       then'stale'else'ready'end;
      if v_state='stale'then v_stale:=true;end if;
      if v_first is null or v_j.computed_at<v_first then v_first:=v_j.computed_at;end if;
      if v_j.next_due_at is not null and(v_next is null or v_j.next_due_at<v_next)then v_next:=v_j.next_due_at;end if;
      v_snapshots:=v_snapshots||jsonb_build_array(jsonb_build_object('snapshotId',v_j.snapshot_id,'component',v_component,'period',v_period,
       'computedAt',private.provider_snapshot_iso(v_j.computed_at),'sourceReadStartedAt',v_j.provenance->>'sourceReadStartedAt','sourceReadCompletedAt',v_j.provenance->>'sourceReadCompletedAt',
       'upstreamComplete',v_j.provenance->'upstreamComplete','stale',v_state='stale','nextDueAt',private.provider_snapshot_iso(v_j.next_due_at)));
     else v_state:=case when v_j.status in('queued','running')then'building'when v_j.status='failed'then'failed'else'missing'end;end if;
    end if;
    if v_state='building'then v_building:=true;end if;
    if v_state<>'ready'then v_all:=false;v_missing:=v_missing||jsonb_build_array(jsonb_build_object('platformId',v_target->>'id','component',v_component,'period',v_period,'state',v_state,'errorCode',case when v_state='failed'then v_j.last_error_code end));end if;
    if v_period='current'then v_current:=v_current||jsonb_build_object(v_component,v_payload);else v_previous:=v_previous||jsonb_build_object(v_component,v_payload);end if;
   end loop;
  end loop;
  v_platforms:=v_platforms||jsonb_build_array(jsonb_build_object('platform',(v_target-array['scope_group','source_name'])||jsonb_build_object('scopeGroup',v_target->'scope_group','sourceName',v_target->'source_name'),'current',v_current,'previous',v_previous,'snapshots',v_snapshots));
 end loop;
 return jsonb_build_object('version',1,'mode','published_snapshot','status',case when v_all then'ready'when v_stale then'stale'when v_building then'building'else'missing'end,'complete',v_all,
 'requested',jsonb_build_object('startAt',p_request->'startAt','endAt',p_request->'endAt'),
 'publishedCutoff',private.provider_snapshot_iso(v_cut),'cutoffEpochMs',case when v_cut is not null then floor(extract(epoch from v_cut)*1000)::bigint end,
 'window',case when v_cut is not null then jsonb_build_object('timezone','Asia/Kolkata','startAt',private.provider_snapshot_iso(v_start),'endAt',private.provider_snapshot_iso(v_cut),'previousStartAt',private.provider_snapshot_iso(v_previous_start),'previousEndAt',private.provider_snapshot_iso(v_previous_end),
  'localStartAt',to_char(v_from,'YYYY-MM-DD"T"HH24:MI:SS'),'localCutoff',to_char(v_cut at time zone'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS'),
  'previousLocalStartAt',to_char(v_from-interval'1day','YYYY-MM-DD"T"HH24:MI:SS'),'previousLocalCutoff',to_char(v_previous_end at time zone'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS'))end,
 'platforms',v_platforms,'missing',v_missing,'computedAt',private.provider_snapshot_iso(v_first),'nextDueAt',private.provider_snapshot_iso(v_next),
 'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
end;$fn$;
revoke all on function private.dashboard_admin_live_provider_snapshot(jsonb)from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_live_provider_snapshot(jsonb)to authenticated;
create function public.dashboard_admin_provider_snapshot(p_request jsonb)
returns jsonb language sql stable security invoker set search_path='' as $fn$
 select private.dashboard_admin_live_provider_snapshot(p_request);
$fn$;
revoke all on function public.dashboard_admin_provider_snapshot(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.dashboard_admin_provider_snapshot(jsonb)to authenticated;
-- END snapshot-reader.sql

-- BEGIN role-catalog-after.sql
CREATE OR REPLACE FUNCTION private.dashboard_role_catalog()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$select '{"pages":[{"id":"overview","label":"总览","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"dashboard","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","workorders","pendingSnapshot","autoWithdraw","details","query","analysisOrders"],"moduleLabel":"Dashboard"},{"id":"collected_data","label":"平台数据接入","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"dashboard","requests":["catalog","providerOptions","syncHealth","intakeCoverage","collectedData","reportSummary","payoutConfig"],"moduleLabel":"Dashboard"},{"id":"teamops","label":"团队经营","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"team","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"团队运营中心"},{"id":"teamcountries","label":"团队国家分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"team","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"团队运营中心"},{"id":"teamplatforms","label":"团队平台分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"team","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"团队运营中心"},{"id":"merchants","label":"平台汇总","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"merchant","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"商户运营中心"},{"id":"daily_comparison","label":"每日对比","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"merchant","requests":["catalog","providerOptions","aggregate","rates","syncHealth","workorders"],"moduleLabel":"运营中心"},{"id":"channel_status","label":"平台通道调整","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"merchant","requests":["catalog","channelStatus"],"moduleLabel":"运营中心"},{"id":"merchantproviders","label":"平台三方分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"merchant","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"商户运营中心"},{"id":"payout_config","label":"自动出款配置","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"}],"moduleId":"merchant","requests":["catalog","providerOptions","syncHealth","intakeCoverage","payoutConfig"],"moduleLabel":"商户运营中心"},{"id":"auto_withdraw","label":"自动出款","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"},{"id":"edit","label":"编辑出款备注","sensitive":true}],"moduleId":"merchant","requests":["catalog","providerOptions","syncHealth","intakeCoverage","autoWithdraw","withdrawReasons","withdrawNote"],"moduleLabel":"商户运营中心"},{"id":"withdraw_operators","label":"操作人统计","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"merchant","requests":["catalog","providerOptions","syncHealth","intakeCoverage","autoWithdraw","withdrawReasons"],"moduleLabel":"商户运营中心"},{"id":"workorders","label":"工单未到账","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"workorder","requests":["catalog","providerOptions","syncHealth","intakeCoverage","workorderRecords","workorders"],"moduleLabel":"工单运营中心"},{"id":"deposit_tracking","label":"存款未到账-跟进记录","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"workorder","requests":["catalog","providerOptions","syncHealth","intakeCoverage","depositIssues"],"moduleLabel":"工单运营中心"},{"id":"deposit_statistics","label":"存款未到账-统计","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"workorder","requests":["catalog","providerOptions","syncHealth","intakeCoverage","depositStatistics","depositIssues"],"moduleLabel":"工单运营中心"},{"id":"workorder_reconciliation","label":"漏登与状态核对","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"workorder","requests":["catalog","providerOptions","syncHealth","intakeCoverage","workorderRecords"],"moduleLabel":"工单运营中心"},{"id":"workorder_workload","label":"员工工作量","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"workorder","requests":["catalog","providerOptions","syncHealth","intakeCoverage","workorderRecords"],"moduleLabel":"工单运营中心"},{"id":"workorder_permissions","label":"权限与预警","actions":[{"id":"view","label":"查看目录与页面"}],"moduleId":"workorder","requests":[],"moduleLabel":"工单运营中心"},{"id":"providers","label":"代收汇总","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"provider","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","workorders","submissionAnalysis","memberDaily","analysisOrders","providerSnapshot"],"moduleLabel":"三方通道中心"},{"id":"provider_payout","label":"代付汇总","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"provider","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","workorders","submissionAnalysis","memberDaily","analysisOrders"],"moduleLabel":"三方通道中心"},{"id":"provider_daily","label":"代收代付成功率","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"provider","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","workorders","submissionAnalysis","memberDaily","analysisOrders"],"moduleLabel":"三方通道中心"},{"id":"rates","label":"费率表","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"}],"moduleId":"provider","requests":["catalog","providerOptions","syncHealth","intakeCoverage","rates","ratesSheet"],"moduleLabel":"三方通道中心"},{"id":"risk","label":"三方风控汇总","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"risk","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"智能风控中心"},{"id":"events","label":"刷单风控","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"risk","requests":["catalog","providerOptions","syncHealth","intakeCoverage","submissionAnalysis","memberDaily","aggregate","analysisOrders","submissionStreak"],"moduleLabel":"智能风控中心"},{"id":"stuck","label":"代付中分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","intakeCoverage","pendingAnalysis","pendingSnapshot","pendingOrders"],"moduleLabel":"数据分析中心"},{"id":"rules","label":"预警规则","actions":[{"id":"view","label":"查看目录与页面"}],"moduleId":"risk","requests":[],"moduleLabel":"智能风控中心"},{"id":"time","label":"时间段分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","memberDaily","analysisOrders"],"moduleLabel":"数据分析中心"},{"id":"amount","label":"金额段分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","memberDaily","analysisOrders"],"moduleLabel":"数据分析中心"},{"id":"matrix","label":"时间段 × 金额段","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","memberDaily","analysisOrders"],"moduleLabel":"数据分析中心"},{"id":"success_analysis","label":"成功率分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","aggregate","workorders","rates"],"moduleLabel":"数据分析中心"},{"id":"latency","label":"充值 / 提款到账时效","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","memberDaily","analysisOrders"],"moduleLabel":"数据分析中心"},{"id":"orders","label":"订单明细","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"数据分析中心"},{"id":"collection","label":"代收订单","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"数据分析中心"},{"id":"payout","label":"代付订单","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"moduleId":"analysis","requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","analysisOrders"],"moduleLabel":"数据分析中心"},{"id":"access","label":"账号与角色权限","actions":[{"id":"view","label":"查看目录与页面"},{"id":"create","label":"新建账号","sensitive":true},{"id":"edit","label":"修改账号","sensitive":true},{"id":"status","label":"启用 / 停用账号","sensitive":true},{"id":"reset_password","label":"重置账号密码","sensitive":true},{"id":"delete","label":"删除账号","sensitive":true}],"moduleId":"system","requests":[],"moduleLabel":"系统管理后台"},{"id":"collector_control","label":"采集管理","actions":[{"id":"view","label":"查看电脑与任务"},{"id":"edit","label":"连接电脑与启停任务","sensitive":true}],"moduleId":"system","requests":["collectorControl"],"moduleLabel":"系统管理后台"},{"id":"provider_config","label":"三方配置","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"},{"id":"edit","label":"修改三方归类","sensitive":true}],"moduleId":"system","requests":["catalog","providerOptions","syncHealth","intakeCoverage","providerConfig","configurationAccess","configurationWrite"],"moduleLabel":"系统管理后台"},{"id":"teams","label":"团队 / 平台归属","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"},{"id":"edit","label":"修改平台归属","sensitive":true}],"moduleId":"system","requests":["catalog","providerOptions","syncHealth","intakeCoverage","platformAssignments","configurationAccess","configurationWrite"],"moduleLabel":"系统管理后台"},{"id":"ip","label":"IP 白名单","actions":[{"id":"view","label":"查看目录与页面"},{"id":"edit","label":"新增 / 修改 IP 白名单","sensitive":true}],"moduleId":"system","requests":[],"moduleLabel":"系统管理后台"},{"id":"data_health","label":"采集与数据健康","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"},{"id":"refresh","label":"手动同步数据","sensitive":true}],"moduleId":"system","requests":["catalog","providerOptions","syncHealth","intakeCoverage"],"moduleLabel":"系统管理后台"},{"id":"login_logs","label":"登录日志","actions":[{"id":"view","label":"查看目录与页面"}],"moduleId":"system","requests":[],"moduleLabel":"系统管理后台"},{"id":"operation_logs","label":"操作日志","actions":[{"id":"view","label":"查看目录与页面"}],"moduleId":"system","requests":[],"moduleLabel":"系统管理后台"}],"version":1,"permissions":[{"key":"overview.view"},{"key":"overview.query"},{"key":"overview.detail"},{"key":"overview.export"},{"key":"collected_data.view"},{"key":"collected_data.query"},{"key":"collected_data.detail"},{"key":"collected_data.export"},{"key":"teamops.view"},{"key":"teamops.query"},{"key":"teamops.detail"},{"key":"teamops.export"},{"key":"teamcountries.view"},{"key":"teamcountries.query"},{"key":"teamcountries.detail"},{"key":"teamcountries.export"},{"key":"teamplatforms.view"},{"key":"teamplatforms.query"},{"key":"teamplatforms.detail"},{"key":"teamplatforms.export"},{"key":"merchants.view"},{"key":"merchants.query"},{"key":"merchants.detail"},{"key":"merchants.export"},{"key":"merchantproviders.view"},{"key":"merchantproviders.query"},{"key":"merchantproviders.detail"},{"key":"merchantproviders.export"},{"key":"payout_config.view"},{"key":"payout_config.query"},{"key":"payout_config.export"},{"key":"auto_withdraw.view"},{"key":"auto_withdraw.query"},{"key":"auto_withdraw.detail"},{"key":"auto_withdraw.export"},{"key":"auto_withdraw.edit"},{"key":"withdraw_operators.view"},{"key":"withdraw_operators.query"},{"key":"withdraw_operators.detail"},{"key":"withdraw_operators.export"},{"key":"workorders.view"},{"key":"workorders.query"},{"key":"workorders.detail"},{"key":"workorders.export"},{"key":"deposit_tracking.view"},{"key":"deposit_tracking.query"},{"key":"deposit_tracking.detail"},{"key":"deposit_tracking.export"},{"key":"deposit_statistics.view"},{"key":"deposit_statistics.query"},{"key":"deposit_statistics.detail"},{"key":"deposit_statistics.export"},{"key":"workorder_reconciliation.view"},{"key":"workorder_reconciliation.query"},{"key":"workorder_reconciliation.detail"},{"key":"workorder_reconciliation.export"},{"key":"workorder_workload.view"},{"key":"workorder_workload.query"},{"key":"workorder_workload.detail"},{"key":"workorder_workload.export"},{"key":"workorder_permissions.view"},{"key":"providers.view"},{"key":"providers.query"},{"key":"providers.detail"},{"key":"providers.export"},{"key":"provider_payout.view"},{"key":"provider_payout.query"},{"key":"provider_payout.detail"},{"key":"provider_payout.export"},{"key":"provider_daily.view"},{"key":"provider_daily.query"},{"key":"provider_daily.detail"},{"key":"provider_daily.export"},{"key":"rates.view"},{"key":"rates.query"},{"key":"rates.export"},{"key":"risk.view"},{"key":"risk.query"},{"key":"risk.detail"},{"key":"risk.export"},{"key":"events.view"},{"key":"events.query"},{"key":"events.detail"},{"key":"events.export"},{"key":"stuck.view"},{"key":"stuck.query"},{"key":"stuck.detail"},{"key":"stuck.export"},{"key":"rules.view"},{"key":"time.view"},{"key":"time.query"},{"key":"time.detail"},{"key":"time.export"},{"key":"amount.view"},{"key":"amount.query"},{"key":"amount.detail"},{"key":"amount.export"},{"key":"matrix.view"},{"key":"matrix.query"},{"key":"matrix.detail"},{"key":"matrix.export"},{"key":"latency.view"},{"key":"latency.query"},{"key":"latency.detail"},{"key":"latency.export"},{"key":"orders.view"},{"key":"orders.query"},{"key":"orders.detail"},{"key":"orders.export"},{"key":"collection.view"},{"key":"collection.query"},{"key":"collection.detail"},{"key":"collection.export"},{"key":"payout.view"},{"key":"payout.query"},{"key":"payout.detail"},{"key":"payout.export"},{"key":"access.view"},{"key":"access.create"},{"key":"access.edit"},{"key":"access.status"},{"key":"access.reset_password"},{"key":"access.delete"},{"key":"provider_config.view"},{"key":"provider_config.query"},{"key":"provider_config.export"},{"key":"provider_config.edit"},{"key":"teams.view"},{"key":"teams.query"},{"key":"teams.export"},{"key":"teams.edit"},{"key":"ip.view"},{"key":"ip.edit"},{"key":"data_health.view"},{"key":"data_health.query"},{"key":"data_health.export"},{"key":"data_health.refresh"},{"key":"login_logs.view"},{"key":"operation_logs.view"},{"key":"success_analysis.view"},{"key":"success_analysis.query"},{"key":"success_analysis.export"},{"key":"daily_comparison.view"},{"key":"daily_comparison.query"},{"key":"daily_comparison.detail"},{"key":"daily_comparison.export"},{"key":"collector_control.view"},{"key":"collector_control.edit"},{"key":"channel_status.view"},{"key":"channel_status.query"},{"key":"channel_status.detail"},{"key":"channel_status.export"}]}'::jsonb$function$;
-- END role-catalog-after.sql

-- BEGIN gateway-after.sql
CREATE OR REPLACE FUNCTION public.dashboard_admin_execute(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a jsonb;page jsonb;action text;capability text;rpc text;payload jsonb;signature text;k bytea;
 args jsonb;result jsonb;prior text;v_view text;v_operation text;needed text[];
begin
 a:=private.dashboard_role_access();
 if a->>'mode'<>'assigned' or not (a->>'canView')::boolean then raise exception using errcode='42501',message='assigned_role_required';end if;
 if p_page is null or p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or jsonb_typeof(p_request->'action') is distinct from 'string' then raise exception using errcode='22023',message='invalid_request';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages') where value->>'id'=p_page;
 action:=p_request->>'action';v_operation:=p_request->>'operation';v_view:=p_request->>'view';
 if page is null or action='portalOperationLogs' or not (page->'requests') ? action
  or not (a->'permissions') ? (p_page||'.view') then raise exception using errcode='42501',message='page_action_denied';end if;
 capability:=case when action in ('catalog','providerOptions','configurationAccess') then 'view'
   when action='withdrawNote' then 'edit' when action='configurationWrite' and v_operation='grant' then 'grant'
   when action='configurationWrite' then 'edit' else 'query' end;
 needed:=array[p_page||'.view',p_page||'.'||capability];
 if action in ('details','query','analysisOrders','pendingOrders') or action='aggregate' and v_view='drilldown'
  or action in ('submissionAnalysis','submissionStreak') and v_operation in ('members','memberOrders')
  or action='workorderRecords' and v_operation in ('detail','orderDetail')
  or action='depositStatistics' and (p_request->>'section'='details' or p_request->>'section'='kyc' and p_request->>'dimension'='orders' or p_request->>'section'='recovery' and (p_request->>'view'='details' or p_request->'export'='true'::jsonb))
  or action='depositIssues' and p_page='deposit_statistics'
 then needed:=array_append(needed,p_page||'.detail');end if;
 if action='depositStatistics'and p_request->>'section'='recovery'and p_request->'export'='true'::jsonb then needed:=array_append(needed,p_page||'.export');end if;
 if not (a->'permissions') ?& needed then raise exception using errcode='42501',message='role_permission_denied';end if;
 if action='configurationWrite' and not (v_operation='grant' and p_page in ('provider_config','teams')
  or v_operation='provider' and p_page='provider_config' or v_operation='platform' and p_page='teams') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='workorderRecords' and not (p_page='workorders' and coalesce(v_view,'records') in ('records','orders')
  or p_page='workorder_reconciliation' and v_view='missing' or p_page='workorder_workload' and v_view='workload') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='autoWithdraw' and (p_page='withdraw_operators' and coalesce(v_view,'auto')<>'operators'
  or p_page in ('auto_withdraw','overview') and coalesce(v_view,'auto')<>'auto') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='submissionStreak' and p_page<>'events' then
  raise exception using errcode='42501',message='page_action_denied';end if;
 rpc:=case action
  when 'providerSnapshot' then 'dashboard_admin_live_provider_snapshot'
  when 'channelStatus' then 'dashboard_admin_live_channel_status'
  when 'submissionAnalysis' then 'dashboard_admin_live_submission_analysis'
  when 'submissionStreak' then 'dashboard_admin_live_submission_streak'
  when 'memberDaily' then 'dashboard_admin_live_member_daily'
  when 'pendingSnapshot' then 'dashboard_admin_live_pending_snapshot'
  when 'pendingAnalysis' then 'dashboard_admin_live_pending_analysis'
  when 'pendingOrders' then 'dashboard_admin_live_pending_orders'
  when 'depositStatistics' then 'dashboard_admin_deposit_statistics'
  when 'workorderRecords' then 'dashboard_admin_live_workorder_records'
  when 'intakeCoverage' then 'dashboard_admin_live_intake_coverage'
  when 'reportSummary' then 'dashboard_admin_live_report_summary'
  when 'syncHealth' then 'dashboard_admin_live_sync_health'
  when 'collectedData' then 'dashboard_admin_live_collected_data'
  when 'rates' then 'dashboard_admin_live_rates'
  when 'ratesSheet' then 'dashboard_admin_live_rate_sheet'
  when 'payoutConfig' then 'dashboard_admin_live_payout_config'
  when 'autoWithdraw' then 'dashboard_admin_live_auto_withdraw'
  when 'withdrawReasons' then 'dashboard_admin_live_withdraw_reasons'
  when 'withdrawNote' then 'dashboard_admin_live_withdraw_note'
  when 'depositIssues' then 'dashboard_admin_live_deposit_issues'
  when 'workorders' then 'dashboard_admin_live_workorders'
  when 'providerConfig' then 'dashboard_admin_live_provider_config'
  when 'platformAssignments' then 'dashboard_admin_live_platform_assignments'
  when 'providerOptions' then 'dashboard_admin_live_provider_options'
  when 'configurationAccess' then 'dashboard_admin_live_configuration_access'
  when 'configurationWrite' then 'dashboard_admin_live_configuration_write'
  when 'analysisOrders' then 'dashboard_admin_live_analysis_orders'
  when 'aggregate' then case when v_view='drilldown' then 'dashboard_admin_live_drilldown' else 'dashboard_admin_live_query' end
  when 'catalog' then 'dashboard_admin_live_query'
  when 'query' then 'dashboard_admin_live_query'
  when 'details' then 'dashboard_admin_live_query' end;
 if rpc is null then raise exception using errcode='42501',message='page_action_denied';end if;
 args:=case when rpc in ('dashboard_admin_live_query','dashboard_admin_live_drilldown') then p_request else p_request-'action' end;
 payload:=jsonb_build_object('uid',auth.uid(),'txid',pg_current_xact_id()::text,'pid',pg_backend_pid()::text,
  'roleId',a->>'roleId','roleVersion',a->>'version','assignmentVersion',a->>'assignmentVersion','page',p_page,'rpc',rpc,'action',action,'capability',capability);
 select secret into k from private.dashboard_role_context_secret where singleton;
 signature:=private.dashboard_role_hmac(payload::text,k);prior:=current_setting('hensem.dashboard_role_context',true);
 perform set_config('hensem.dashboard_role_context',jsonb_build_object('payload',payload,'signature',signature)::text,true);
 begin
  execute format('select private.%I($1)',rpc) into result using args;
 exception when others then
  perform set_config('hensem.dashboard_role_context',coalesce(prior,''),true);raise;
 end;
 perform set_config('hensem.dashboard_role_context',coalesce(prior,''),true);
 return result;
end;$function$;
-- END gateway-after.sql

set local check_function_bodies=on;
$payload$;
for e in select value from jsonb_array_elements($meta_postcondition$[{"signature":"private.dashboard_admin_live_expand_provider_filter(jsonb)","body_md5":"b07872f828acc18e8218ae6b2cc7d94e","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_intake_coverage(jsonb)","body_md5":"bc856a3698426d057fb51405b153f917","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_intake_order_feeds(timestamp with time zone)","body_md5":"0560f55418f87b16a1e9a1a570ebb21f","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"1184","allargtypes":null,"argmodes":null,"argnames":"{p_asof}","arguments":"p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.dashboard_admin_live_platforms()","body_md5":"9423bd69a95d21c9e6740c6709492395","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":1000,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":true,"argtypes":"","allargtypes":"{2950,25,25,25,25,25,25,25,25}","argmodes":"{t,t,t,t,t,t,t,t,t}","argnames":"{id,name,team,country,scope_group,source,timezone,currency,source_name}","arguments":"","result":"TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)"},{"signature":"private.dashboard_admin_live_provider_snapshot(jsonb)","body_md5":"1aefbcd4f74092762329a6b6fe99502c","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_query(jsonb)","body_md5":"396efe7ab32ea579475a7b72ab52597c","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{\"action\": \"catalog\"}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_query_raw(jsonb)","body_md5":"8877cb8cee3ec54c65fa6400f590c11d","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb DEFAULT '{\"action\": \"catalog\"}'::jsonb","result":"jsonb"},{"signature":"private.dashboard_admin_live_remap_groups(jsonb, text, text, boolean)","body_md5":"0ce8e6980d543059024eb1010d600946","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 25 25 16","allargtypes":null,"argmodes":null,"argnames":"{p_rows,p_country,p_platform,p_daily}","arguments":"p_rows jsonb, p_country text, p_platform text, p_daily boolean DEFAULT false","result":"jsonb"},{"signature":"private.dashboard_admin_live_scope()","body_md5":"bab25103334aa222d6220a27881ce000","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"jsonb"},{"signature":"private.dashboard_admin_live_submission_analysis(jsonb)","body_md5":"08f4fda2ac67706ff667addfca4ffdf2","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off","enable_nestloop=off"],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"},{"signature":"private.dashboard_role_access()","body_md5":"423aab3bb0ec685aa745a18ea6b7811a","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"jsonb"},{"signature":"private.dashboard_role_catalog()","body_md5":"c17ef47cce1d9d31d65431e4d5dde19a","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"i","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"jsonb"},{"signature":"private.dashboard_role_context_valid()","body_md5":"4fe8d4b2586aef960d9ad5d0b826e426","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"boolean"},{"signature":"private.dashboard_role_require_gateway()","body_md5":"0e9013820396aab2c7230dc133c3888b","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"void"},{"signature":"private.provider_snapshot_artifact_immutable()","body_md5":"be3063a3f9dbf0c802a267736163f228","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"trigger"},{"signature":"private.provider_snapshot_claim(text, integer)","body_md5":"b5a42d60738f676b320183435b87d1b2","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25 23","allargtypes":null,"argmodes":null,"argnames":"{p_worker,p_lease_seconds}","arguments":"p_worker text, p_lease_seconds integer DEFAULT 120","result":"jsonb"},{"signature":"private.provider_snapshot_complete(uuid, uuid, bigint, jsonb, jsonb)","body_md5":"57bb4fb51423ddbf59e356e54fee99b2","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":5,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 2950 20 3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_run_id,p_fence,p_payload,p_provenance}","arguments":"p_job_id uuid, p_run_id uuid, p_fence bigint, p_payload jsonb, p_provenance jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_compute_payload(jsonb, jsonb, text)","body_md5":"e771df2214096b0988cea30c1e130b09","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":3,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802 25","allargtypes":null,"argmodes":null,"argnames":"{p_target,p_request,p_component}","arguments":"p_target jsonb, p_request jsonb, p_component text","result":"jsonb"},{"signature":"private.provider_snapshot_dependency_token(jsonb)","body_md5":"bb55f7c959f987864b9eb2f1ca44b6be","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_target}","arguments":"p_target jsonb","result":"text"},{"signature":"private.provider_snapshot_dispatch(timestamp with time zone, integer)","body_md5":"7d123f5838e7c67ccf374ccf17a88e93","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":2,"variadic":0,"prokind":"f","proretset":false,"argtypes":"1184 23","allargtypes":null,"argmodes":null,"argnames":"{p_observed_at,p_interval_seconds}","arguments":"p_observed_at timestamp with time zone DEFAULT now(), p_interval_seconds integer DEFAULT 600","result":"jsonb"},{"signature":"private.provider_snapshot_enqueue(jsonb, jsonb, text, timestamp with time zone)","body_md5":"30c885963300c3f2241aa4defef18fee","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802 25 1184","allargtypes":null,"argmodes":null,"argnames":"{p_target,p_request,p_component,p_not_before}","arguments":"p_target jsonb, p_request jsonb, p_component text, p_not_before timestamp with time zone DEFAULT now()","result":"uuid"},{"signature":"private.provider_snapshot_fail(uuid, uuid, bigint, text)","body_md5":"f4b9c34e2ec3fe64f347894ec67f8182","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 2950 20 25","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_run_id,p_fence,p_error_code}","arguments":"p_job_id uuid, p_run_id uuid, p_fence bigint, p_error_code text","result":"boolean"},{"signature":"private.provider_snapshot_intake_rows_kernel(jsonb, text[], date, date, timestamp with time zone)","body_md5":"6e0177cc753d3bb635a62df1d9eb7a5f","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":5,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 1009 1082 1082 1184","allargtypes":null,"argmodes":null,"argnames":"{p_feeds,p_ids,p_from,p_to,p_asof}","arguments":"p_feeds jsonb, p_ids text[], p_from date, p_to date, p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.provider_snapshot_iso(timestamp with time zone)","body_md5":"149dc5b89d2b91a57c7472a798db1333","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"1184","allargtypes":null,"argmodes":null,"argnames":"{p_time}","arguments":"p_time timestamp with time zone","result":"text"},{"signature":"private.provider_snapshot_kernel_contract_current()","body_md5":"ac21d75d1aaae2f396c670530821e494","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"","allargtypes":null,"argmodes":null,"argnames":null,"arguments":"","result":"boolean"},{"signature":"private.provider_snapshot_native_catalog()","body_md5":"20bfe572c317e9e63ff18d418d3231f5","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":1000,"pronargs":0,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":true,"argtypes":"","allargtypes":"{2950,25,25,25,25,25,25,25,25}","argmodes":"{t,t,t,t,t,t,t,t,t}","argnames":"{id,name,team,country,scope_group,source,timezone,currency,source_name}","arguments":"","result":"TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)"},{"signature":"private.provider_snapshot_order_feeds_kernel(jsonb, timestamp with time zone)","body_md5":"cdb133b88c825d3ad2013b4de874c9c1","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 1184","allargtypes":null,"argmodes":null,"argnames":"{p_catalog,p_asof}","arguments":"p_catalog jsonb, p_asof timestamp with time zone","result":"jsonb"},{"signature":"private.provider_snapshot_orders_raw_kernel(jsonb, jsonb)","body_md5":"d4f9fec4111a4afdb07f4b40e833b24f","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_request,p_catalog}","arguments":"p_request jsonb, p_catalog jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_orders_result_kernel(jsonb, jsonb)","body_md5":"715baaebbacef17e302c4c6721d776ef","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_result,p_request}","arguments":"p_result jsonb, p_request jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_prepare_claim(text)","body_md5":"1d107b3d2286643e17952bcb971a00fc","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25","allargtypes":null,"argmodes":null,"argnames":"{p_worker}","arguments":"p_worker text","result":"jsonb"},{"signature":"private.provider_snapshot_register_target(jsonb, boolean)","body_md5":"c8f1df4cdb3acdd1a8ca78fa33d16fa3","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 16","allargtypes":null,"argmodes":null,"argnames":"{p_target,p_enabled}","arguments":"p_target jsonb, p_enabled boolean DEFAULT true","result":"jsonb"},{"signature":"private.provider_snapshot_renew(uuid, uuid, bigint, integer)","body_md5":"39a7e7970701e93db1a47ea493d415ff","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 2950 20 23","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_run_id,p_fence,p_lease_seconds}","arguments":"p_job_id uuid, p_run_id uuid, p_fence bigint, p_lease_seconds integer DEFAULT 120","result":"boolean"},{"signature":"private.provider_snapshot_requeue(uuid, timestamp with time zone)","body_md5":"8c0720a228ba979092acdc469dc71899","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 1184","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_not_before}","arguments":"p_job_id uuid, p_not_before timestamp with time zone DEFAULT now()","result":"boolean"},{"signature":"private.provider_snapshot_run_claimed(text)","body_md5":"e835c7b23fe9acfd314ced1961b85ef5","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25","allargtypes":null,"argmodes":null,"argnames":"{p_worker}","arguments":"p_worker text","result":"jsonb"},{"signature":"private.provider_snapshot_submission_kernel(jsonb, jsonb)","body_md5":"3d1188218a0aada52cfd2a5d6dbcbed6","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\"","jit=off","enable_nestloop=off"],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_request,p_catalog}","arguments":"p_request jsonb, p_catalog jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_target(jsonb)","body_md5":"ef472533cf24b3bb6cb6d739c0ecb91d","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"i","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_target}","arguments":"p_target jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_target_current(jsonb)","body_md5":"6f13cbb170779ada75dddd91b5377bbe","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_target}","arguments":"p_target jsonb","result":"boolean"},{"signature":"public.dashboard_admin_execute(text, jsonb)","body_md5":"009ae170ac7df031cbec919bee4c8442","language":"plpgsql","owner":"postgres","prosecdef":true,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":2,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25 3802","allargtypes":null,"argmodes":null,"argnames":"{p_page,p_request}","arguments":"p_page text, p_request jsonb","result":"jsonb"},{"signature":"public.dashboard_admin_provider_snapshot(jsonb)","body_md5":"8cce331c7834298f8c15dc2b4445b61d","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"3802","allargtypes":null,"argmodes":null,"argnames":"{p_request}","arguments":"p_request jsonb","result":"jsonb"}]$meta_postcondition$::jsonb)loop
 select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
 if actual is distinct from e then raise exception using errcode='55000',message='snapshot_postcondition_function_drift',detail=e->>'signature';end if;
 end loop;
for e in select value from jsonb_array_elements($tables$[{"name":"private.provider_snapshot_artifacts","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["id","uuid",true,"","","gen_random_uuid()"],["job_id","uuid",true,"","",null],["run_id","uuid",true,"","",null],["fence","bigint",true,"","",null],["revision","bigint",true,"","",null],["dependency_token","text",true,"","",null],["payload","jsonb",true,"","",null],["payload_hash","text",true,"","",null],["stored_bytes","integer",true,"","",null],["provenance","jsonb",true,"","",null],["next_due_at","timestamp with time zone",false,"","",null],["computed_at","timestamp with time zone",true,"","","clock_timestamp()"]],"constraints":[["provider_snapshot_artifacts_job_id_fkey","f","FOREIGN KEY (job_id) REFERENCES private.provider_snapshot_jobs(id)",true,false,false],["provider_snapshot_artifacts_job_id_run_id_key","u","UNIQUE (job_id, run_id)",true,false,false],["provider_snapshot_artifacts_payload_check","c","CHECK (jsonb_typeof(payload) = 'object'::text)",true,false,false],["provider_snapshot_artifacts_pkey","p","PRIMARY KEY (id)",true,false,false],["provider_snapshot_artifacts_provenance_check","c","CHECK (jsonb_typeof(provenance) = 'object'::text)",true,false,false],["provider_snapshot_artifacts_stored_bytes_check","c","CHECK (stored_bytes > 0)",true,false,false]],"indexes":[["private.provider_snapshot_artifacts_job_id_run_id_key","CREATE UNIQUE INDEX provider_snapshot_artifacts_job_id_run_id_key ON private.provider_snapshot_artifacts USING btree (job_id, run_id)",true,true,true,true,true],["private.provider_snapshot_artifacts_pkey","CREATE UNIQUE INDEX provider_snapshot_artifacts_pkey ON private.provider_snapshot_artifacts USING btree (id)",true,true,true,true,true]],"triggers":[["provider_snapshot_artifact_immutable","O","CREATE TRIGGER provider_snapshot_artifact_immutable BEFORE UPDATE ON private.provider_snapshot_artifacts FOR EACH ROW EXECUTE FUNCTION private.provider_snapshot_artifact_immutable()"]],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_cohort_jobs","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["cohort_id","uuid",true,"","",null],["job_id","uuid",true,"","",null]],"constraints":[["provider_snapshot_cohort_jobs_cohort_id_fkey","f","FOREIGN KEY (cohort_id) REFERENCES private.provider_snapshot_cohorts(id)",true,false,false],["provider_snapshot_cohort_jobs_job_id_fkey","f","FOREIGN KEY (job_id) REFERENCES private.provider_snapshot_jobs(id)",true,false,false],["provider_snapshot_cohort_jobs_pkey","p","PRIMARY KEY (cohort_id, job_id)",true,false,false]],"indexes":[["private.provider_snapshot_cohort_jobs_job","CREATE INDEX provider_snapshot_cohort_jobs_job ON private.provider_snapshot_cohort_jobs USING btree (job_id)",true,true,true,false,true],["private.provider_snapshot_cohort_jobs_pkey","CREATE UNIQUE INDEX provider_snapshot_cohort_jobs_pkey ON private.provider_snapshot_cohort_jobs USING btree (cohort_id, job_id)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_cohorts","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["id","uuid",true,"","","gen_random_uuid()"],["lane","text",true,"","",null],["local_date","date",true,"","",null],["cutoff","timestamp with time zone",true,"","",null],["supplement_pass","integer",true,"","",null],["roster_token","text",true,"","",null],["targets","jsonb",true,"","",null],["status","text",true,"","","'building'::text"],["created_at","timestamp with time zone",true,"","","clock_timestamp()"],["updated_at","timestamp with time zone",true,"","","clock_timestamp()"]],"constraints":[["provider_snapshot_cohorts_lane_check","c","CHECK (lane = ANY (ARRAY['current'::text, 'closed'::text]))",true,false,false],["provider_snapshot_cohorts_lane_local_date_cutoff_supplement_key","u","UNIQUE (lane, local_date, cutoff, supplement_pass, roster_token)",true,false,false],["provider_snapshot_cohorts_pkey","p","PRIMARY KEY (id)",true,false,false],["provider_snapshot_cohorts_status_check","c","CHECK (status = ANY (ARRAY['building'::text, 'ready'::text, 'failed'::text, 'obsolete'::text]))",true,false,false],["provider_snapshot_cohorts_supplement_pass_check","c","CHECK (supplement_pass >= 0 AND supplement_pass <= 2)",true,false,false],["provider_snapshot_cohorts_targets_check","c","CHECK (jsonb_typeof(targets) = 'array'::text)",true,false,false]],"indexes":[["private.provider_snapshot_cohorts_lane_local_date_cutoff_supplement_key","CREATE UNIQUE INDEX provider_snapshot_cohorts_lane_local_date_cutoff_supplement_key ON private.provider_snapshot_cohorts USING btree (lane, local_date, cutoff, supplement_pass, roster_token)",true,true,true,true,true],["private.provider_snapshot_cohorts_pkey","CREATE UNIQUE INDEX provider_snapshot_cohorts_pkey ON private.provider_snapshot_cohorts USING btree (id)",true,true,true,true,true],["private.provider_snapshot_one_active_cohort","CREATE UNIQUE INDEX provider_snapshot_one_active_cohort ON private.provider_snapshot_cohorts USING btree ((true)) WHERE (status = 'building'::text)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_heads","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["job_id","uuid",true,"","",null],["snapshot_id","uuid",true,"","",null],["published_at","timestamp with time zone",true,"","","clock_timestamp()"]],"constraints":[["provider_snapshot_heads_job_id_fkey","f","FOREIGN KEY (job_id) REFERENCES private.provider_snapshot_jobs(id)",true,false,false],["provider_snapshot_heads_pkey","p","PRIMARY KEY (job_id)",true,false,false],["provider_snapshot_heads_snapshot_id_fkey","f","FOREIGN KEY (snapshot_id) REFERENCES private.provider_snapshot_artifacts(id)",true,false,false],["provider_snapshot_heads_snapshot_id_key","u","UNIQUE (snapshot_id)",true,false,false]],"indexes":[["private.provider_snapshot_heads_pkey","CREATE UNIQUE INDEX provider_snapshot_heads_pkey ON private.provider_snapshot_heads USING btree (job_id)",true,true,true,true,true],["private.provider_snapshot_heads_snapshot_id_key","CREATE UNIQUE INDEX provider_snapshot_heads_snapshot_id_key ON private.provider_snapshot_heads USING btree (snapshot_id)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_jobs","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["id","uuid",true,"","","gen_random_uuid()"],["request_key","jsonb",true,"","",null],["target","jsonb",true,"","",null],["request","jsonb",true,"","",null],["component","text",true,"","",null],["platform_id","uuid",true,"","",null],["window_from","timestamp with time zone",true,"","",null],["window_to","timestamp with time zone",true,"","",null],["dependency_token","text",true,"","",null],["revision","bigint",true,"","","1"],["fence","bigint",true,"","","0"],["run_id","uuid",false,"","",null],["worker","text",false,"","",null],["claim_backend_pid","integer",false,"","",null],["claim_backend_start","timestamp with time zone",false,"","",null],["lease_until","timestamp with time zone",false,"","",null],["status","text",true,"","","'queued'::text"],["attempts","integer",true,"","","0"],["not_before","timestamp with time zone",true,"","","now()"],["next_due_at","timestamp with time zone",false,"","",null],["last_error_code","text",false,"","",null],["created_at","timestamp with time zone",true,"","","now()"],["updated_at","timestamp with time zone",true,"","","now()"]],"constraints":[["provider_snapshot_jobs_attempts_check","c","CHECK (attempts >= 0)",true,false,false],["provider_snapshot_jobs_check","c","CHECK (window_to > window_from)",true,false,false],["provider_snapshot_jobs_component_check","c","CHECK (component = ANY (ARRAY['orders'::text, 'submission'::text, 'intake'::text]))",true,false,false],["provider_snapshot_jobs_fence_check","c","CHECK (fence >= 0)",true,false,false],["provider_snapshot_jobs_pkey","p","PRIMARY KEY (id)",true,false,false],["provider_snapshot_jobs_request_check","c","CHECK (jsonb_typeof(request) = 'object'::text)",true,false,false],["provider_snapshot_jobs_request_key_key","u","UNIQUE (request_key)",true,false,false],["provider_snapshot_jobs_revision_check","c","CHECK (revision > 0)",true,false,false],["provider_snapshot_jobs_status_check","c","CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text]))",true,false,false],["provider_snapshot_jobs_target_check","c","CHECK (jsonb_typeof(target) = 'object'::text)",true,false,false]],"indexes":[["private.provider_snapshot_jobs_due","CREATE INDEX provider_snapshot_jobs_due ON private.provider_snapshot_jobs USING btree (status, not_before, lease_until)",true,true,true,false,true],["private.provider_snapshot_jobs_pkey","CREATE UNIQUE INDEX provider_snapshot_jobs_pkey ON private.provider_snapshot_jobs USING btree (id)",true,true,true,true,true],["private.provider_snapshot_jobs_request_key_key","CREATE UNIQUE INDEX provider_snapshot_jobs_request_key_key ON private.provider_snapshot_jobs USING btree (request_key)",true,true,true,true,true],["private.provider_snapshot_jobs_window","CREATE INDEX provider_snapshot_jobs_window ON private.provider_snapshot_jobs USING btree (platform_id, window_from, window_to DESC, component)",true,true,true,false,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_schedule_state","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["singleton","boolean",true,"","","true"],["pending_current_cutoff","timestamp with time zone",false,"","",null],["last_lane","text",false,"","",null]],"constraints":[["provider_snapshot_schedule_state_last_lane_check","c","CHECK (last_lane = ANY (ARRAY['current'::text, 'closed'::text]))",true,false,false],["provider_snapshot_schedule_state_pkey","p","PRIMARY KEY (singleton)",true,false,false],["provider_snapshot_schedule_state_singleton_check","c","CHECK (singleton)",true,false,false]],"indexes":[["private.provider_snapshot_schedule_state_pkey","CREATE UNIQUE INDEX provider_snapshot_schedule_state_pkey ON private.provider_snapshot_schedule_state USING btree (singleton)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0},{"name":"private.provider_snapshot_targets","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["platform_id","uuid",true,"","",null],["target","jsonb",true,"","",null],["enabled","boolean",true,"","","true"],["updated_at","timestamp with time zone",true,"","","clock_timestamp()"]],"constraints":[["provider_snapshot_targets_pkey","p","PRIMARY KEY (platform_id)",true,false,false],["provider_snapshot_targets_target_check","c","CHECK (jsonb_typeof(target) = 'object'::text)",true,false,false]],"indexes":[["private.provider_snapshot_targets_pkey","CREATE UNIQUE INDEX provider_snapshot_targets_pkey ON private.provider_snapshot_targets USING btree (platform_id)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0}]$tables$::jsonb)loop
 select to_jsonb(q)into actual from(select n.nspname||'.'||c.relname name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner)owner,c.relacl::text acl,
(select coalesce(jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))order by a.attnum),'[]')from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)columns,
(select coalesce(jsonb_agg(jsonb_build_array(k.conname,k.contype,pg_get_constraintdef(k.oid,true),k.convalidated,k.condeferrable,k.condeferred)order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid and k.contype<>'n')constraints,
(select coalesce(jsonb_agg(jsonb_build_array(i.indexrelid::regclass::text,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indimmediate)order by i.indexrelid::regclass::text),'[]')from pg_index i where i.indrelid=c.oid)indexes,
(select coalesce(jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true))order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)triggers,
(select count(*)from pg_policy pol where pol.polrelid=c.oid)policies,
(select count(*)from pg_inherits h where h.inhparent=c.oid or h.inhrelid=c.oid)inheritance
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid=to_regclass(e->>'name'))q;
 if actual is distinct from e then raise exception using errcode='55000',message='snapshot_table_drift',detail=e->>'name';end if;
 end loop;

end;$install$;
notify pgrst,'reload schema';
commit;
