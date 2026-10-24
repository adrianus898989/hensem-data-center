-- Install before kernels.sql, then runtime.sql. All objects private; no source rows are changed.
CREATE TABLE private.withdraw_prepared_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_key jsonb NOT NULL,
 fingerprint text GENERATED ALWAYS AS(md5(request_key::text)) STORED UNIQUE,
 request jsonb NOT NULL, scope jsonb NOT NULL, catalog jsonb NOT NULL, dependency text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','ready','failed')),
 revision bigint NOT NULL DEFAULT 1, fence bigint NOT NULL DEFAULT 0, run_id uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, not_before timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_requested_at timestamptz NOT NULL DEFAULT clock_timestamp(), next_due_at timestamptz,
 claim_pid integer, claim_backend_start timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX withdraw_prepared_due ON private.withdraw_prepared_jobs(status,not_before,created_at);
CREATE TABLE private.withdraw_prepared_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES private.withdraw_prepared_jobs ON DELETE CASCADE,
 revision bigint NOT NULL,fence bigint NOT NULL,run_id uuid NOT NULL,dependency text NOT NULL,payload jsonb NOT NULL,
 computed_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,bytes integer NOT NULL CHECK(bytes BETWEEN 2 AND 4194304),UNIQUE(job_id,run_id)
);
CREATE TABLE private.withdraw_prepared_heads(job_id uuid PRIMARY KEY REFERENCES private.withdraw_prepared_jobs ON DELETE CASCADE,artifact_id uuid NOT NULL UNIQUE REFERENCES private.withdraw_prepared_artifacts);
CREATE TABLE private.withdraw_prepared_admissions(actor uuid NOT NULL,day date NOT NULL,total integer NOT NULL CHECK(total BETWEEN 0 AND 200),PRIMARY KEY(actor,day));
CREATE TABLE private.withdraw_prepared_scheduler(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),next_family text NOT NULL DEFAULT 'payment' CHECK(next_family IN('payment','withdraw')),enabled boolean NOT NULL DEFAULT false);
INSERT INTO private.withdraw_prepared_scheduler(singleton)VALUES(true);
ALTER TABLE private.withdraw_prepared_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.withdraw_prepared_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.withdraw_prepared_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.withdraw_prepared_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.withdraw_prepared_scheduler ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.withdraw_prepared_jobs,private.withdraw_prepared_artifacts,private.withdraw_prepared_heads,private.withdraw_prepared_admissions,private.withdraw_prepared_scheduler FROM public,anon,authenticated,service_role;
CREATE FUNCTION private.withdraw_prepared_immutable()RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'withdraw_prepared_artifact_immutable';END;$$;
CREATE TRIGGER withdraw_prepared_immutable BEFORE UPDATE ON private.withdraw_prepared_artifacts FOR EACH ROW EXECUTE FUNCTION private.withdraw_prepared_immutable();
CREATE FUNCTION private.withdraw_prepared_platforms(p_catalog jsonb)
RETURNS TABLE(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT * FROM jsonb_to_recordset(p_catalog)p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
$$;
CREATE FUNCTION private.withdraw_prepared_canonical(q jsonb)RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=''AS $$
DECLARE r jsonb:=q-ARRAY['offset','limit','sort','ascending','daily'];k text;
BEGIN
 IF q?'windowVersion'OR q?'successStartAt'OR q?'successEndAt'OR q?'successBasis'THEN PERFORM private.withdraw_window_validate(q);END IF;
 r:=r||jsonb_build_object('startAt',left(q->>'startAt',19)||'.000Z','endAt',left(q->>'endAt',19)||'.000Z','successStartAt',left(coalesce(q->>'successStartAt',q->>'startAt'),19)||'.000Z','successEndAt',left(coalesce(q->>'successEndAt',q->>'endAt'),19)||'.000Z','successBasis',coalesce(q->>'successBasis','success'),'windowVersion',2,'view',coalesce(q->>'view','auto'));
 PERFORM private.withdraw_window_validate(r);
 IF q?'platforms'THEN r:=jsonb_set(r,'{platforms}',coalesce((SELECT jsonb_agg(x ORDER BY x)FROM(SELECT DISTINCT value x FROM jsonb_array_elements(q->'platforms'))a),'[]'));END IF;
 IF q?'scopeTargets'THEN r:=jsonb_set(r,'{scopeTargets}',(SELECT jsonb_agg(jsonb_build_object('country',t->>'country','platforms',(SELECT jsonb_agg(v ORDER BY v)FROM(SELECT DISTINCT value v FROM jsonb_array_elements(t->'platforms'))a)) ORDER BY t->>'country')FROM jsonb_array_elements(q->'scopeTargets')t));END IF;
 RETURN r;
END;$$;
CREATE FUNCTION private.withdraw_prepared_catalog_current(c jsonb)RETURNS boolean LANGUAGE sql STABLE SET search_path=''AS $$
 SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c)x WHERE NOT EXISTS(SELECT 1 FROM private.prepared_aggregate_native_catalog()p WHERE to_jsonb(p)=x));
$$;
-- A west-of-UTC platform's local yesterday must not accidentally get the
-- historical TTL just because the database has crossed its UTC midnight.
-- Mixed catalogs conservatively retain the shorter TTL until every local
-- timezone is past the recent-day boundary.
CREATE FUNCTION private.withdraw_prepared_expiry(p_at timestamptz,p_last_day date,p_catalog jsonb)RETURNS timestamptz LANGUAGE sql STABLE SET search_path=''AS $$
 SELECT p_at+CASE WHEN p_last_day>=coalesce(min((p_at AT TIME ZONE coalesce(nullif(p.timezone,''),'UTC'))::date),(p_at AT TIME ZONE'UTC')::date)-1 THEN interval'10minutes'ELSE interval'6hours'END
 FROM private.withdraw_prepared_platforms(p_catalog)p;
$$;
CREATE FUNCTION private.withdraw_prepared_dependency()RETURNS text LANGUAGE sql STABLE SET search_path=''AS $$
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),md5(p.prosrc),p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,pg_get_function_result(p.oid))ORDER BY p.proname,p.oid),'[]')::text)
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND
 (p.proname LIKE 'withdraw_window_%' OR p.proname LIKE 'withdraw_prepared_native_%' OR p.proname IN('withdraw_prepared_render','withdraw_prepared_validate','withdraw_prepared_compute','withdraw_prepared_source_contract_current','withdraw_prepared_expiry','dashboard_admin_ar_withdraw_days','dashboard_admin_newar_withdraw_days','dashboard_admin_yash_withdraw_days','dashboard_admin_duoli_withdraw_days','dashboard_admin_wg_withdraw_days','dashboard_admin_ar_historical_duration_days','dashboard_admin_live_game66_withdraw','dashboard_admin_live_withdraw_key','dashboard_scope_allows','dashboard_admin_duoli_status','dashboard_admin_duoli_amount','dashboard_admin_wg_processing_seconds','dashboard_admin_wg_sites','dashboard_admin_yash_day_evidence','dashboard_admin_yash_status','ar_historical_duration_generation','ar_withdraw_detail_evidence_generation','ar_withdraw_fact_generation'));
$$;
