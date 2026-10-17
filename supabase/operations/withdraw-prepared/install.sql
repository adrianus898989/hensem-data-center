-- Generated offline installation only: original RPC and cron remain unchanged.
BEGIN;
SET LOCAL lock_timeout='500ms';
SET LOCAL statement_timeout='15s';

-- BEGIN ../withdraw-windows/clocks
-- Local wall-clock request contract, independent windows; Z is the existing
-- withdrawal endpoint's date carrier, never a claim that each platform is UTC.
CREATE FUNCTION private.withdraw_window_validate(q jsonb)RETURNS void LANGUAGE plpgsql STABLE SET search_path=''AS $$
DECLARE k text;a timestamp;b timestamp;
BEGIN
 IF q IS NULL OR jsonb_typeof(q)<>'object'OR q->'windowVersion'IS DISTINCT FROM'2'::jsonb OR coalesce(q->>'successBasis','')NOT IN('success','source_updated')THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_contract';END IF;
 FOREACH k IN ARRAY ARRAY['startAt','endAt','successStartAt','successEndAt']LOOP
  IF jsonb_typeof(q->k)IS DISTINCT FROM'string'OR q->>k!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.]000)?Z$'THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_time';END IF;
  a:=left(q->>k,19)::timestamp;
  IF to_char(a,'YYYY-MM-DD"T"HH24:MI:SS')<>left(q->>k,19)THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_time';END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['','success']LOOP
  a:=left(q->>(CASE WHEN k=''THEN'startAt'ELSE'successStartAt'END),19)::timestamp;b:=left(q->>(CASE WHEN k=''THEN'endAt'ELSE'successEndAt'END),19)::timestamp;
  IF a>b OR b::date-a::date>30 THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_range';END IF;
 END LOOP;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_window_time';
END;$$;
CREATE FUNCTION private.withdraw_window_created_local(q jsonb,t timestamp)RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 WITH w AS(SELECT left(q->>'startAt',19)::timestamp a,left(q->>'endAt',19)::timestamp+interval'1second'b,(left(q->>'endAt',10)::date-left(q->>'startAt',10)::date+1)*interval'1day'd)
 SELECT isfinite(t)AND((t>=a AND t<b)OR(t>=a-d AND t<b-d))FROM w;
$$;
CREATE FUNCTION private.withdraw_window_created(q jsonb,t timestamptz,z text)RETURNS boolean LANGUAGE sql STABLE SET search_path=''AS $$
 SELECT private.withdraw_window_created_local(q,t AT TIME ZONE z);
$$;
CREATE FUNCTION private.withdraw_window_whole_days(q jsonb)RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT substring(q->>'startAt'FROM 12 FOR 8)='00:00:00'AND substring(q->>'endAt'FROM 12 FOR 8)='23:59:59';
$$;
-- Availability refers to source-order timestamps, never bank settlement.
-- Audit/operated/observed/received/stored clocks are deliberately excluded.
CREATE FUNCTION private.withdraw_window_capability(s text,b text)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT CASE
 WHEN s='kb'AND b='success'THEN jsonb_build_object('available',true,'field','completed_at','meaning','source_order_completed')
 WHEN s='newar'AND b='success'THEN jsonb_build_object('available',true,'field','success_at','meaning','source_order_success')
 WHEN s='newar'AND b='source_updated'THEN jsonb_build_object('available',true,'field','source_updated_at','meaning','source_order_updated')
 WHEN s='duoli'AND b='source_updated'THEN jsonb_build_object('available',true,'field','updated_at','meaning','source_order_updated')
 WHEN s='game66'AND b='source_updated'THEN jsonb_build_object('available',true,'field','update_time','meaning','source_order_updated')
 WHEN s='lg'AND b='success'THEN jsonb_build_object('available',true,'field','paid_at','meaning','source_order_paid')
 ELSE jsonb_build_object('available',false,'field',null,'reason',CASE
  WHEN s='ar'AND b='success'THEN'source_completion_semantics_unverified'
  WHEN b='source_updated'THEN'source_update_time_unavailable'
  ELSE'payment_success_time_unavailable'END)
 END||jsonb_build_object('paymentSettlementTime',false);
$$;
REVOKE ALL ON FUNCTION private.withdraw_window_validate(jsonb),private.withdraw_window_created_local(jsonb,timestamp),private.withdraw_window_created(jsonb,timestamptz,text),private.withdraw_window_whole_days(jsonb),private.withdraw_window_capability(text,text)FROM public,anon,authenticated,service_role;

CREATE FUNCTION private.withdraw_window_legacy(q jsonb)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT q-ARRAY['windowVersion','successStartAt','successEndAt','successBasis'];
$$;
CREATE FUNCTION private.withdraw_window_default_day(q jsonb,d date)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT q||jsonb_build_object('startAt',d::text||'T00:00:00.000Z','endAt',d::text||'T23:59:59.000Z','successStartAt',d::text||'T00:00:00.000Z','successEndAt',d::text||'T23:59:59.000Z','windowVersion',2,'successBasis',coalesce(q->>'successBasis','success'));
$$;
REVOKE ALL ON FUNCTION private.withdraw_window_legacy(jsonb),private.withdraw_window_default_day(jsonb,date)FROM public,anon,authenticated,service_role;


-- BEGIN store
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


-- BEGIN kernels
-- Generated by scripts/ops/build-withdraw-prepared-kernels.cjs. No existing reader or source table is changed.
DO $install_withdraw_kernels$
DECLARE p record;r record;d text;body text;main_body text;render_body text;validate_body text;args text;ret text;anchor text;replacement text;signature text;contracts jsonb:='[]';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 FOR r IN SELECT * FROM jsonb_to_recordset('[{"key":"wg","name":"dashboard_admin_wg_withdraw_days","hash":"e7a568feac2f1e3496ef7f6de2d13151","args":"jsonb,jsonb,date,date"},{"key":"yash","name":"dashboard_admin_yash_withdraw_days","hash":"1e9eda16514b65889295810e6bf1d742","args":"jsonb,jsonb,date,date"},{"key":"newar","name":"dashboard_admin_newar_withdraw_days","hash":"3046cba0a3d11b7de9494bf629f4a002","args":"jsonb,jsonb,date,date"},{"key":"ar","name":"dashboard_admin_ar_withdraw_days","hash":"173bf1a012f07d69942571724ff8f658","args":"jsonb,jsonb,date,date"},{"key":"duoli","name":"dashboard_admin_duoli_withdraw_days","hash":"53ecaffec7eae57a4bec29334e43eda8","args":"jsonb,jsonb,date,date"},{"key":"arHistory","name":"dashboard_admin_ar_historical_duration_days","hash":"9a7bba61d4cdb9b185c7fb7a07c8dc03","args":"jsonb,jsonb,date,date"},{"key":"game66","name":"dashboard_admin_live_game66_withdraw","hash":"df9722109e2b1443531c017a3bcf7d5f","args":"date,date,text,text[]"}]'::jsonb)x(key text,name text,hash text,args text) LOOP
  signature:='private.'||r.name||'('||r.args||')';SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(signature);
  IF p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM r.hash OR pg_get_userbyid(p.proowner)<>'postgres' OR p.provolatile<>'s'
   OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.pronargdefaults<>0 OR p.pronargs<>4
   OR NOT(p.proconfig @> ARRAY['search_path=""']) OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a WHERE a.grantee<>p.proowner)
   OR p.prorettype<>(CASE WHEN r.key='game66'THEN'jsonb'::regtype ELSE'record'::regtype END)
   OR p.proretset IS DISTINCT FROM (r.key<>'game66') THEN RAISE EXCEPTION 'withdraw_prepared_source_contract_drift: %',signature;END IF;
  contracts:=contracts||jsonb_build_array(jsonb_build_object('signature',signature,'metadata',to_jsonb(p)-ARRAY['oid','prosrc']||jsonb_build_object('bodyMd5',md5(p.prosrc))));
  args:=pg_get_function_arguments(p.oid);ret:=pg_get_function_result(p.oid);body:=p.prosrc;
  -- The only authorization-bearing source call is replaced by an explicit,
  -- server-captured scope; all native dashboard_scope_allows predicates remain.
  IF r.key='game66' THEN
   IF (length(body)-length(replace(body,'private.dashboard_admin_live_scope()','')))/length('private.dashboard_admin_live_scope()')<>2 THEN RAISE EXCEPTION 'withdraw_prepared_game66_scope_drift';END IF;
   body:=replace(body,'perform private.dashboard_admin_live_scope();','perform 1;');body:=replace(body,'private.dashboard_admin_live_scope()','p_scope');args:=args||', p_scope jsonb';
  ELSE
   IF position('private.dashboard_admin_live_scope()' IN body)>0 THEN RAISE EXCEPTION 'withdraw_prepared_unexpected_scope_call';END IF;
  END IF;
  IF position('private.dashboard_admin_live_platforms()' IN body)>0 THEN body:=replace(body,'private.dashboard_admin_live_platforms()','private.withdraw_prepared_platforms(p_catalog)');END IF;
  IF body~'auth[.]|request[.]jwt|set_config|dashboard_role_context' THEN RAISE EXCEPTION 'withdraw_prepared_auth_call_in_kernel';END IF;
  IF r.key IN (SELECT jsonb_array_elements_text('["wg","yash","newar","ar","duoli","game66"]'::jsonb)) THEN
   -- Keep bounded, indexed date reads; only narrow their facts to exact local
   -- creation seconds. The independent secondary window is never a predicate.
   IF r.key='game66' THEN
    anchor:='w.create_time<v_end_at';replacement:=anchor||' and (private.withdraw_window_whole_days(p_window) OR private.withdraw_window_created(p_window,w.create_time,''Asia/Kolkata''))';args:=args||', p_window jsonb';
   ELSIF r.key='wg' THEN anchor:='d.created_at<(p_end+1)::timestamp at time zone s.timezone';replacement:=anchor||' and (private.withdraw_window_whole_days(p_request) OR private.withdraw_window_created(p_request,d.created_at,s.timezone))';
   ELSIF r.key='yash' THEN anchor:='y.created_at<(p_end+1)::timestamp at time zone ''Asia/Kolkata''';replacement:=anchor||' and (private.withdraw_window_whole_days(p_request) OR private.withdraw_window_created(p_request,y.created_at,''Asia/Kolkata''))';
   ELSIF r.key='newar' THEN anchor:='n.created_at<(p_end+1)::timestamp at time zone s.timezone';replacement:=anchor||' and (private.withdraw_window_whole_days(p_request) OR private.withdraw_window_created(p_request,n.created_at,s.timezone))';
   ELSIF r.key='duoli' THEN anchor:='d.created_at<(p_end+1)::timestamp AT TIME ZONE t.timezone';replacement:=anchor||' AND (private.withdraw_window_whole_days(p_request) OR private.withdraw_window_created(p_request,d.created_at,t.timezone))';
   ELSIF r.key='ar' THEN
    anchor:='a.applied_at<(q.data_date+1)::timestamp';replacement:=anchor||' AND (private.withdraw_window_whole_days(p_request) OR private.withdraw_window_created_local(p_request,a.applied_at))';
   END IF;
   IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'withdraw_window_creation_anchor: %',r.key;END IF;
   body:=replace(body,anchor,replacement);
   IF r.key='ar' THEN anchor:='f.applied_at<(q.data_date+1)::timestamp';IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'withdraw_window_ar_fact_anchor';END IF;body:=replace(body,anchor,anchor||' AND (private.withdraw_window_whole_days(p_request) OR private.withdraw_window_created_local(p_request,f.applied_at))');END IF;
  END IF;
  d:='CREATE FUNCTION private.withdraw_prepared_native_'||lower(r.key)||'('||args||', p_catalog jsonb) RETURNS '||ret||' LANGUAGE '||(SELECT lanname FROM pg_language WHERE oid=p.prolang)||' STABLE SECURITY INVOKER SET search_path='''''||' AS '||quote_literal(body);
  EXECUTE d;
 END LOOP;
 EXECUTE 'CREATE FUNCTION private.withdraw_prepared_source_contract_current()RETURNS boolean LANGUAGE sql STABLE SET search_path='''''||' AS '||quote_literal('SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements('||quote_literal(contracts::text)||'::jsonb)e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e->>''signature'') WHERE p.oid IS NULL OR(to_jsonb(p)-ARRAY[''oid'',''prosrc'']||jsonb_build_object(''bodyMd5'',md5(p.prosrc)))IS DISTINCT FROM e->''metadata'')');
 SELECT * INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(p.prosrc) IS DISTINCT FROM '12fe721956fb291f2c2b93a5d5187fbd' OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'s' OR p.prorettype<>'jsonb'::regtype
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 OR pg_get_function_arguments(p.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb' THEN RAISE EXCEPTION 'withdraw_prepared_main_contract_drift';END IF;
 main_body:=p.prosrc;render_body:=main_body;
 FOR r IN SELECT * FROM jsonb_to_recordset('[{"key":"wg","name":"dashboard_admin_wg_withdraw_days","hash":"e7a568feac2f1e3496ef7f6de2d13151","args":"jsonb,jsonb,date,date"},{"key":"yash","name":"dashboard_admin_yash_withdraw_days","hash":"1e9eda16514b65889295810e6bf1d742","args":"jsonb,jsonb,date,date"},{"key":"newar","name":"dashboard_admin_newar_withdraw_days","hash":"3046cba0a3d11b7de9494bf629f4a002","args":"jsonb,jsonb,date,date"},{"key":"ar","name":"dashboard_admin_ar_withdraw_days","hash":"173bf1a012f07d69942571724ff8f658","args":"jsonb,jsonb,date,date"},{"key":"duoli","name":"dashboard_admin_duoli_withdraw_days","hash":"53ecaffec7eae57a4bec29334e43eda8","args":"jsonb,jsonb,date,date"},{"key":"arHistory","name":"dashboard_admin_ar_historical_duration_days","hash":"9a7bba61d4cdb9b185c7fb7a07c8dc03","args":"jsonb,jsonb,date,date"},{"key":"game66","name":"dashboard_admin_live_game66_withdraw","hash":"df9722109e2b1443531c017a3bcf7d5f","args":"date,date,text,text[]"}]'::jsonb)x(key text,name text,hash text,args text) LOOP
  IF r.key='game66' THEN
   anchor:='private.dashboard_admin_live_game66_withdraw(v_before,v_end,v_target->>''country'',v_target_platforms)';
   replacement:='coalesce(p_bundle#>ARRAY[''game66'',v_target->>''country''],''{"rows":[],"operatorRows":[]}''::jsonb)';
   IF (length(render_body)-length(replace(render_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'withdraw_prepared_render_game66_anchor';END IF;
   render_body:=replace(render_body,anchor,replacement);
  ELSE
   -- This reader composes the same daily native rows; it never executes a
   -- raw native helper. Note reads and canWriteNotes stay live and authorized.
   SELECT pg_get_function_result(oid) INTO ret FROM pg_proc WHERE oid=to_regprocedure('private.'||r.name||'('||r.args||')');
   ret:=substring(ret FROM 7 FOR length(ret)-7);
   anchor:='from private.'||r.name||'(';
   IF (length(lower(render_body))-length(replace(lower(render_body),lower(anchor),'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'withdraw_prepared_render_anchor: %',r.name;END IF;
   render_body:=regexp_replace(render_body,'from private[.]'||r.name||'[(]p_request,v_scope,v_before,[^;]+[)] ([a-z]);',
    'from jsonb_to_recordset(p_bundle->'||quote_literal(r.key)||') AS \1('||ret||');','i');
  END IF;
 END LOOP;
 -- Daily-only legacy facts cannot answer sub-day creation windows. Notes and
 -- catalog identities remain live, but legacy counts never leak into the range.
 FOREACH anchor IN ARRAY ARRAY['s.stat_date between v_before and v_end','a.data_date between v_before and v_end','o.data_date between v_before and v_end'] LOOP
  IF position(anchor IN render_body)=0 THEN RAISE EXCEPTION 'withdraw_window_daily_report_anchor';END IF;
  render_body:=replace(render_body,anchor,anchor||' and private.withdraw_window_whole_days(p_request)');
 END LOOP;
 IF render_body=main_body OR render_body~'from private[.]dashboard_admin_(ar|newar|duoli|yash|wg)_withdraw_days' OR position('private.dashboard_admin_live_game66_withdraw(' IN render_body)>0 THEN RAISE EXCEPTION 'withdraw_prepared_render_still_raw';END IF;
 EXECUTE 'CREATE FUNCTION private.withdraw_prepared_render(p_request jsonb,p_bundle jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='''''||' AS '||quote_literal(render_body);
 anchor:=' for v_target in select value from jsonb_array_elements(v_targets) loop';
 IF position(anchor IN main_body)=0 THEN RAISE EXCEPTION 'withdraw_prepared_validation_anchor';END IF;
 validate_body:=substring(main_body FROM 1 FOR position(anchor IN main_body)-1)||E'\n RETURN;\nEND;';
 EXECUTE 'CREATE FUNCTION private.withdraw_prepared_validate(p_request jsonb) RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='''''||' AS '||quote_literal(validate_body);
 FOR p IN SELECT oid FROM pg_proc WHERE pronamespace='private'::regnamespace AND proname LIKE 'withdraw_prepared_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||p.oid::regprocedure||' FROM public,anon,authenticated,service_role';
 END LOOP;
END;$install_withdraw_kernels$;


-- BEGIN ../withdraw-windows/secondary
-- Only captured, authorized native targets. A secondary window NEVER filters
-- created cohorts, and created bounds NEVER filter the successful-time branch.
CREATE FUNCTION private.withdraw_window_targets(q jsonb,s jsonb,c jsonb)
RETURNS TABLE(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''AS $$
 SELECT p.*FROM private.withdraw_prepared_platforms(c)p
 WHERE private.dashboard_scope_allows(s,p.scope_group,p.source_name)
 AND(CASE WHEN q?'scopeTargets'THEN EXISTS(SELECT 1 FROM jsonb_array_elements(q->'scopeTargets')t WHERE t->>'country'=p.country AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(t->'platforms')x WHERE private.dashboard_admin_live_withdraw_key(x)IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name))))ELSE q->>'country'=p.country END)
 AND(nullif(q->>'platform','')IS NULL OR private.dashboard_admin_live_withdraw_key(q->>'platform')IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name)))
 AND(NOT q?'platforms'OR jsonb_array_length(q->'platforms')=0 OR nullif(q->>'platform','')IS NOT NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(q->'platforms')x WHERE private.dashboard_admin_live_withdraw_key(x)IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name))));
$$;
CREATE FUNCTION private.withdraw_window_success_rows(t jsonb,b text,a timestamptz,z timestamptz)
RETURNS TABLE(account text,amount numeric,operator_available boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''AS $function$
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF coalesce((private.withdraw_window_capability(t->>'source',b)->>'available')::boolean,false)IS NOT TRUE THEN RETURN;END IF;
 IF t->>'source'='newar'THEN
  -- Join the verified source projection for operator/method only; its creation
  -- timestamp is not a filter on these independently timed successful orders.
  RETURN QUERY EXECUTE 'SELECT CASE WHEN f.method IS DISTINCT FROM ''auto''THEN coalesce(nullif(btrim(f.account),''''),''（未知操作人）'')END,CASE WHEN n.currency=$4 THEN n.amount END,f.method IS DISTINCT FROM ''auto'' FROM public.newar_detail_records n LEFT JOIN private.newar_withdraw_facts f ON f.record_id=n.id AND f.platform=n.platform AND f.source_id=n.source_id JOIN public.newar_detail_platforms p ON p.platform=n.platform AND p.enabled WHERE n.platform=$1 AND n.dataset=''withdraw''AND n.status_group=''success'' AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'>=$2 AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'<$3 AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'>=n.created_at AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'<=n.captured_at AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'<=statement_timestamp() AND(p.launch_at IS NULL OR n.created_at>=p.launch_at)' USING t->>'source_name',a,z,t->>'currency';
 ELSIF t->>'source'='kb'AND t->>'scope_group'='IN'AND t->>'source_name'='YASH.BET'AND b='success'THEN
  RETURN QUERY SELECT coalesce(nullif(btrim(y.operator),''),'（未知操作人）'),CASE WHEN y.currency=t->>'currency'THEN y.amount END,true FROM private.yash_orders y WHERE y.source_site='yash'AND y.order_type='withdrawal'AND private.dashboard_admin_yash_status(y.order_type,y.status)='success'AND y.completed_at>=a AND y.completed_at<z AND y.completed_at>=y.created_at AND y.completed_at<=y.observed_at AND y.completed_at<=statement_timestamp();
 ELSIF t->>'source'='duoli'AND t->>'scope_group'='ID'AND t->>'timezone'='Asia/Jakarta'AND b='source_updated'THEN
  RETURN QUERY SELECT coalesce(nullif(btrim(d.operator),''),'（未知操作人）'),private.dashboard_admin_duoli_amount(d.business,d.currency,d.amount_source,d.amount_raw),true FROM private.duoli_order_details d WHERE d.platform=t->>'source_name'AND d.business='withdraw'AND d.country='ID'AND d.system_name='DOLI'AND private.dashboard_admin_duoli_status('withdraw',d.status_code)='success'AND d.updated_at>=a AND d.updated_at<z AND d.updated_at>=d.created_at AND d.updated_at<=d.observed_at AND d.updated_at<=statement_timestamp();
 ELSIF t->>'source'='game66'AND b='source_updated'THEN
  RETURN QUERY SELECT CASE WHEN w.auto_commit='2'THEN'自动审核'ELSE coalesce(nullif(btrim(w.audit_admin),''),nullif(btrim(w.lock_admin),''),nullif(btrim(w.lock_user_admin),''),'人工审核（未标记账号）')END,coalesce(w.amount_display,w.amount_minor/100.0),true FROM public.game66_withdraw_orders w WHERE w.platform_id=(t->>'id')::uuid AND w.status_code='3'AND w.update_time>=a AND w.update_time<z AND w.update_time>=w.create_time AND w.update_time<=w.last_seen_at AND w.update_time<=statement_timestamp();
 ELSIF t->>'source'='lg'AND b='success'THEN
  RETURN QUERY SELECT null::text,l.metric_amount,false FROM public.lg_orders l WHERE l.country_code=t->>'scope_group'AND l.platform=t->>'source_name'AND l.source_system='LG'AND l.order_kind='withdraw'AND l.status_class='success'AND l.paid_at>=a AND l.paid_at<z AND l.paid_at>=l.created_at AND l.paid_at<=statement_timestamp();
 END IF;
END;$function$;
CREATE FUNCTION private.withdraw_window_secondary(q jsonb,s jsonb,c jsonb)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''AS $$
DECLARE t record;cap jsonb;rows jsonb:='[]';ops jsonb;v jsonb;a timestamptz;b timestamptz;n bigint;v_amount numeric;account_filter text:=nullif(btrim(q->>'account'),'');
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 PERFORM private.withdraw_window_validate(q);
 FOR t IN SELECT *FROM private.withdraw_window_targets(q,s,c)ORDER BY country,name,id LOOP
  cap:=private.withdraw_window_capability(t.source,q->>'successBasis');n:=null;v_amount:=null;ops:='[]';
  IF (cap->>'available')::boolean THEN
   a:=left(q->>'successStartAt',19)::timestamp AT TIME ZONE t.timezone;b:=(left(q->>'successEndAt',19)::timestamp+interval'1second')AT TIME ZONE t.timezone;
   WITH facts AS MATERIALIZED(SELECT f.account,CASE WHEN f.amount::text NOT IN('NaN','Infinity','-Infinity')THEN f.amount END amount,f.operator_available FROM private.withdraw_window_success_rows(to_jsonb(t),q->>'successBasis',a,b)f),groups AS(
    SELECT account,count(*)count,CASE WHEN count(amount)=count(*)THEN sum(amount)END amount FROM facts WHERE operator_available AND(account_filter IS NULL OR position(lower(account_filter)IN lower(account))>0)GROUP BY account)
   SELECT (SELECT count(*)FROM facts),(SELECT CASE WHEN count(amount)=count(*)THEN sum(amount)END FROM facts),coalesce(jsonb_agg(jsonb_build_object('account',account,'count',count,'amount',amount)ORDER BY account),'[]')INTO n,v_amount,ops FROM groups;
  END IF;
  v:=jsonb_build_object('platform',t.name,'country',t.country,'source',t.source,'timezone',t.timezone,'currency',t.currency,'capability',cap,'count',CASE WHEN n>0 THEN n END,'amount',v_amount,'observedCount',n,'complete',false,'coverageVerified',false,'state',CASE WHEN NOT(cap->>'available')::boolean THEN'timestamp_unavailable'WHEN n=0 THEN'no_matching_observed_records'ELSE'observed_records'END,'operatorAttributionAvailable',t.source<>'lg','operatorRows',ops);
  rows:=rows||jsonb_build_array(v);
 END LOOP;
 RETURN jsonb_build_object('basis',q->>'successBasis','startAt',q->>'successStartAt','endAt',q->>'successEndAt','createdIntersection',false,'complete',false,'rows',rows);
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_window_targets(jsonb,jsonb,jsonb),private.withdraw_window_success_rows(jsonb,text,timestamptz,timestamptz),private.withdraw_window_secondary(jsonb,jsonb,jsonb)FROM public,anon,authenticated,service_role;


-- BEGIN ../withdraw-windows/result
-- Per-row creation availability is explicit for report-only sources on a
-- sub-day query. Never present their old whole-day totals as exact time totals.
CREATE FUNCTION private.withdraw_window_result(q jsonb,v jsonb,b jsonb)RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=''AS $$
DECLARE row jsonb;outrows jsonb:='[]';p record;unsupported boolean:=false;availability jsonb:='[]';ok boolean;mask jsonb:=jsonb_build_object('total',null,'processed',null,'success',null,'rejected',null,'autoCount',null,'manualCount',null,'unclassifiedCount',null,'avgSeconds',null,'durationSampleCount',null,'durationTotalSeconds',null,'complete',false,'comparisonComparable',false,'creationTimeAvailable',false,'creationTimeReason','source_daily_report_only');
BEGIN
 FOR p IN SELECT *FROM private.withdraw_window_targets(q,b->'scope',b->'catalog')LOOP
  ok:=private.withdraw_window_whole_days(q)OR(p.source IN('wg','kb','newar','ar','duoli','game66')AND NOT(p.source='ar'AND left(q->>'startAt',10)::date<date'2026-10-10'));
  availability:=availability||jsonb_build_array(jsonb_build_object('platform',p.name,'country',p.country,'available',ok,'reason',CASE WHEN NOT ok THEN'source_daily_report_only'END));
  IF NOT ok THEN unsupported:=true;END IF;
 END LOOP;
 IF NOT private.withdraw_window_whole_days(q)THEN
  FOR row IN SELECT value FROM jsonb_array_elements(coalesce(v->'rows','[]'))LOOP
   SELECT x.*INTO p FROM private.withdraw_prepared_platforms(b->'catalog')x WHERE x.country=row->>'country'AND private.dashboard_admin_live_withdraw_key(row->>'platform')IN(private.dashboard_admin_live_withdraw_key(x.name),private.dashboard_admin_live_withdraw_key(x.source_name))LIMIT 1;
   ok:=FOUND AND p.source IN('wg','kb','newar','ar','duoli','game66')AND NOT(p.source='ar'AND left(q->>'startAt',10)::date<date'2026-10-10');
   IF NOT ok THEN unsupported:=true;row:=row||mask;IF row?'previous'THEN row:=jsonb_set(row,'{previous}',coalesce(row->'previous','{}')||mask);END IF;END IF;
   outrows:=outrows||jsonb_build_array(row);
  END LOOP;
  v:=jsonb_set(v,'{rows}',outrows);
  IF unsupported THEN v:=jsonb_set(v,'{totals}',coalesce(v->'totals','{}')||mask);v:=jsonb_set(v,'{previousTotals}',coalesce(v->'previousTotals','{}')||mask);v:=jsonb_set(v,'{comparison}',coalesce(v->'comparison','{}')||jsonb_build_object('complete',false));END IF;
 END IF;
 RETURN v||jsonb_build_object('creationAvailability',availability,'windows',jsonb_build_object('version',2,'creationStartAt',q->>'startAt','creationEndAt',q->>'endAt','successStartAt',q->>'successStartAt','successEndAt',q->>'successEndAt','successBasis',q->>'successBasis','creationMetricBasis','created_orders_current_status','successMetricBasis','independent_successful_source_orders'),'secondary',b->'secondary');
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_window_result(jsonb,jsonb,jsonb)FROM public,anon,authenticated,service_role;


-- BEGIN runtime
CREATE FUNCTION private.withdraw_prepared_compute(q jsonb,s jsonb,c jsonb)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''AS $$
DECLARE a date:=left(q->>'startAt',10)::date;b date:=left(q->>'endAt',10)::date;lo date;v jsonb:='{}';r record;t jsonb;parts jsonb:='{}';x jsonb;ps text[];
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RAISE EXCEPTION 'withdraw_prepared_source_contract_changed';END IF;
 lo:=a-(b-a+1);
 FOR r IN SELECT * FROM(VALUES('wg','wg'),('yash','yash'),('newar','newar'),('ar','ar'),('duoli','duoli'))z(k,fn) LOOP
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(d)),''[]''::jsonb)FROM private.withdraw_prepared_native_'||r.fn||'($1,$2,$3,$4,$5)d'INTO x USING q,s,lo,b,c;
  v:=v||jsonb_build_object(r.k,x);
 END LOOP;
 IF q->>'view'='auto'AND private.withdraw_window_whole_days(q)AND lo<date'2026-10-10'THEN
  SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]')INTO x FROM private.withdraw_prepared_native_arhistory(q,s,lo,least(b,date'2026-10-09'),c)d;
 ELSE x:='[]';END IF;v:=v||jsonb_build_object('arHistory',x);
 FOR t IN SELECT value FROM jsonb_array_elements(coalesce(q->'scopeTargets',jsonb_build_array(jsonb_build_object('country',q->>'country')))) LOOP
  IF EXISTS(SELECT 1 FROM public.game66_platforms WHERE team_name=t->>'country')THEN
   ps:=CASE WHEN q?'scopeTargets'THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(value)FROM jsonb_array_elements_text(t->'platforms'))WHEN nullif(q->>'platform','')IS NOT NULL THEN ARRAY[private.dashboard_admin_live_withdraw_key(q->>'platform')]WHEN q?'platforms'THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(value)FROM jsonb_array_elements_text(q->'platforms'))END;
   IF cardinality(ps)=0 THEN ps:=null;END IF;
   x:=private.withdraw_prepared_native_game66(lo,b,t->>'country',ps,s,q,c);parts:=parts||jsonb_build_object(t->>'country',x);
  END IF;
 END LOOP;
 RETURN v||jsonb_build_object('game66',parts,'contract','withdraw-independent-windows-v2','request',q,'catalog',c,'scope',s,'computedAt',clock_timestamp(),'secondary',private.withdraw_window_secondary(q,s,c));
END;$$;
CREATE FUNCTION private.withdraw_prepared_enqueue(q jsonb,s jsonb,c jsonb,dep text)RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE k jsonb:=jsonb_build_array('withdraw-independent-windows-v2',s,c,q);j private.withdraw_prepared_jobs%rowtype;
BEGIN
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k FOR UPDATE;
 IF FOUND THEN
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=clock_timestamp(),
   status=CASE WHEN dependency<>dep THEN'queued'ELSE status END,revision=revision+CASE WHEN dependency<>dep THEN 1 ELSE 0 END,
   attempts=CASE WHEN dependency<>dep THEN 0 ELSE attempts END,lease_until=CASE WHEN dependency<>dep THEN null ELSE lease_until END,
   not_before=CASE WHEN dependency<>dep THEN clock_timestamp()ELSE not_before END,dependency=dep WHERE id=j.id;
  RETURN j.id;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('withdraw_prepared_admission_v1',0))THEN RETURN null;END IF;
 IF(SELECT count(*)FROM private.withdraw_prepared_jobs)>=2000 THEN RETURN null;END IF;
 INSERT INTO private.withdraw_prepared_jobs(request_key,request,scope,catalog,dependency)VALUES(k,q,s,c,dep)
 ON CONFLICT(fingerprint)DO UPDATE SET last_requested_at=excluded.last_requested_at WHERE private.withdraw_prepared_jobs.request_key=excluded.request_key RETURNING id INTO j.id;
 RETURN j.id;
END;$$;
CREATE FUNCTION private.withdraw_prepared_read(q jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''AS $$
DECLARE s jsonb;c jsonb;r jsonb;k jsonb;dep text;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;budget integer;v_status text;v_refresh text;v_at timestamptz:=clock_timestamp();
BEGIN
 -- The original native auth/session/IP/scope checks remain live on every read.
 PERFORM private.withdraw_prepared_validate(private.withdraw_window_legacy(q));s:=private.dashboard_admin_live_scope();
 SELECT coalesce(jsonb_agg(to_jsonb(p)ORDER BY p.id),'[]')INTO c FROM private.dashboard_admin_live_platforms()p;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RETURN jsonb_build_object('prepared',jsonb_build_object('status','failed','reason','source_contract_changed','contract','withdraw-independent-windows-v2'),'rows',null,'totals',null,'total',null);END IF;
 r:=private.withdraw_prepared_canonical(q);k:=jsonb_build_array('withdraw-independent-windows-v2',s,c,r);dep:=private.withdraw_prepared_dependency();
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id;
 -- Expiry is a refresh deadline, not a loss of a complete, same-semantics
 -- publication. Permissions/catalog and notes still resolve live above/below.
 IF a.id IS NOT NULL AND a.job_id=j.id AND a.revision=j.revision AND a.dependency=dep AND j.dependency=dep
 AND a.payload->>'contract'='withdraw-independent-windows-v2' AND a.payload->'request'=r AND a.payload->'scope'=s AND a.payload->'catalog'=c
 AND jsonb_typeof(a.payload->'secondary')='object' AND jsonb_typeof(a.payload->'game66')='object'
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['wg','yash','newar','ar','duoli','arHistory'])part WHERE jsonb_typeof(a.payload->part)IS DISTINCT FROM'array')THEN
  -- Refresh only the same ready job. Never reset a running lease or the retry
  -- limit of a failed refresh, and never extend the artifact's expiry/time.
  UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=v_at
   WHERE id=j.id AND revision=a.revision AND dependency=dep AND status='ready'AND a.expires_at<=v_at;
  SELECT status INTO v_refresh FROM private.withdraw_prepared_jobs WHERE id=j.id;
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=v_at WHERE id=j.id AND last_requested_at<v_at-interval'5minutes';
  RETURN private.withdraw_window_result(r,private.withdraw_prepared_render(private.withdraw_window_legacy(q),a.payload),a.payload)||jsonb_build_object('prepared',jsonb_build_object('status','ready','contract','withdraw-independent-windows-v2','publicationVersion',2,'generation',a.id,'computedAt',a.computed_at,'expiresAt',a.expires_at,'calculationComplete',true,'freshness',CASE WHEN a.expires_at>v_at THEN'fresh'ELSE'refresh_due'END,'refreshState',CASE WHEN v_refresh IN('queued','running','failed')THEN v_refresh ELSE'idle'END));
 END IF;
 v_status:=CASE WHEN a.id IS NOT NULL THEN'stale'WHEN j.status='failed'AND j.attempts>=3 THEN'failed'WHEN j.status IN('queued','running')THEN'building'ELSE'missing'END;
 IF j.id IS NULL THEN
  INSERT INTO private.withdraw_prepared_admissions(actor,day,total)VALUES(auth.uid(),current_date,1)ON CONFLICT(actor,day)DO UPDATE SET total=private.withdraw_prepared_admissions.total+1 WHERE private.withdraw_prepared_admissions.total<200 RETURNING total INTO budget;
  IF budget IS NOT NULL THEN PERFORM private.withdraw_prepared_enqueue(r,s,c,dep);END IF;
 ELSE
  PERFORM private.withdraw_prepared_enqueue(r,s,c,dep);
  UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=clock_timestamp()WHERE id=j.id AND status='ready'AND(a.id IS NULL OR a.expires_at<=clock_timestamp());
 END IF;
 RETURN jsonb_build_object('prepared',jsonb_build_object('status',v_status,'contract','withdraw-independent-windows-v2','computedAt',a.computed_at,'expiresAt',a.expires_at),'rows',null,'totals',null,'total',null);
END;$$;
CREATE FUNCTION private.withdraw_prepared_claim()RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE j private.withdraw_prepared_jobs%rowtype;started timestamptz;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,last_error='lease_expired',not_before=clock_timestamp()+interval'1minute'WHERE status='running'AND lease_until<=clock_timestamp();
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()ORDER BY not_before,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN null;END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='source_contract_changed'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='obsolete_catalog'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.prepared_aggregate_take_turn('prepared')THEN RETURN null;END IF;
 SELECT backend_start INTO started FROM pg_stat_activity WHERE pid=pg_backend_pid();
 UPDATE private.withdraw_prepared_jobs SET status='running',fence=fence+1,run_id=gen_random_uuid(),attempts=attempts+1,lease_until=clock_timestamp()+interval'120seconds',claim_pid=pg_backend_pid(),claim_backend_start=started WHERE id=j.id RETURNING *INTO j;
 RETURN jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence);
END;$$;
CREATE FUNCTION private.withdraw_prepared_complete(claim jsonb,payload jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE j private.withdraw_prepared_jobs%rowtype;dep text;aid uuid;at timestamptz:=clock_timestamp();expires timestamptz;bytes integer;k text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))THEN RETURN jsonb_build_object('published',false,'reason','busy');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid FOR UPDATE;
 IF NOT FOUND OR j.claim_pid IS DISTINCT FROM pg_backend_pid()OR j.claim_backend_start IS DISTINCT FROM(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=at THEN RETURN jsonb_build_object('published',false,'reason','obsolete_claim');END IF;
 dep:=private.withdraw_prepared_dependency();
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,lease_until=null,last_error='source_contract_changed'WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','source_contract_changed');END IF;
 IF dep<>j.dependency OR NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='queued',attempts=0,lease_until=null,revision=revision+1,dependency=dep,not_before=at WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','dependency_changed');END IF;
 bytes:=octet_length(payload::text);
 IF payload->>'contract'IS DISTINCT FROM'withdraw-independent-windows-v2'OR payload->'request'IS DISTINCT FROM j.request OR payload->'catalog'IS DISTINCT FROM j.catalog OR payload->'scope'IS DISTINCT FROM j.scope OR bytes>4194304 OR jsonb_typeof(payload->'game66')IS DISTINCT FROM'object' OR jsonb_typeof(payload->'secondary')IS DISTINCT FROM'object'
 OR nullif(payload->>'computedAt','')IS NULL OR(payload->>'computedAt')::timestamptz>at OR(payload->>'computedAt')::timestamptz<at-interval'2minutes' THEN RAISE EXCEPTION 'withdraw_prepared_payload_mismatch';END IF;
 FOREACH k IN ARRAY ARRAY['wg','yash','newar','ar','duoli','arHistory']LOOP IF jsonb_typeof(payload->k)IS DISTINCT FROM'array'THEN RAISE EXCEPTION 'withdraw_prepared_payload_incomplete';END IF;END LOOP;
 IF(SELECT coalesce(sum(a.bytes),0)FROM private.withdraw_prepared_artifacts a)+bytes>134217728 THEN RAISE EXCEPTION 'withdraw_prepared_capacity';END IF;
 expires:=private.withdraw_prepared_expiry(at,greatest(left(j.request->>'endAt',10)::date,left(j.request->>'successEndAt',10)::date),j.catalog);
 INSERT INTO private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)VALUES(j.id,j.revision,j.fence,j.run_id,dep,payload,at,expires,bytes)RETURNING id INTO aid;
 INSERT INTO private.withdraw_prepared_heads VALUES(j.id,aid)ON CONFLICT(job_id)DO UPDATE SET artifact_id=excluded.artifact_id;
 UPDATE private.withdraw_prepared_jobs SET status='ready',attempts=0,lease_until=null,next_due_at=expires-interval'2minutes',last_error=null WHERE id=j.id;
 RETURN jsonb_build_object('published',true,'id',aid);
END;$$;
CREATE FUNCTION private.withdraw_prepared_run_claimed()RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE claim jsonb:=nullif(current_setting('withdraw_prepared.claim',true),'')::jsonb;j private.withdraw_prepared_jobs%rowtype;started timestamptz;result jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'60seconds'THEN RAISE EXCEPTION 'withdraw_prepared_deadline_required';END IF;
 IF claim IS NULL THEN RETURN jsonb_build_object('status','idle');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid;
 SELECT backend_start INTO started FROM pg_stat_activity WHERE pid=pg_backend_pid();
 IF j.claim_pid IS DISTINCT FROM pg_backend_pid()OR j.claim_backend_start IS DISTINCT FROM started OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=clock_timestamp()THEN RETURN jsonb_build_object('status','obsolete');END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))THEN
  UPDATE private.withdraw_prepared_jobs SET status='queued',attempts=greatest(attempts-1,0),lease_until=null,claim_pid=null,claim_backend_start=null,not_before=clock_timestamp()+interval'1second'WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  PERFORM set_config('withdraw_prepared.claim','',false);RETURN jsonb_build_object('status','busy');END IF;
 BEGIN
  result:=private.withdraw_prepared_compute(j.request,j.scope,j.catalog);result:=private.withdraw_prepared_complete(claim,result);
 EXCEPTION WHEN query_canceled OR OTHERS THEN
  UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,last_error=CASE WHEN SQLSTATE='57014'THEN'compute_timeout'ELSE'compute_failed'END,not_before=clock_timestamp()+interval'1minute'WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  result:=jsonb_build_object('published',false,'reason','compute_failed');
 END;
 PERFORM set_config('withdraw_prepared.claim','',false);RETURN result;
END;$$;
-- Use the existing payment-prepared cron connection, not a new parallel worker.
CREATE FUNCTION private.withdraw_prepared_prepare_claim(p_worker text)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE family text;c jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_claim_deadline_required';END IF;
 PERFORM set_config('withdraw_prepared.claim','',false);PERFORM set_config('withdraw_prepared.family','',false);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 SELECT next_family INTO family FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled FOR UPDATE;
 IF NOT FOUND THEN family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);IF c IS NOT NULL THEN PERFORM set_config('withdraw_prepared.family','payment',false);END IF;RETURN c;END IF;
 IF family='withdraw'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())THEN
  c:=private.withdraw_prepared_claim();
 ELSE family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);END IF;
 IF c IS NULL AND family='payment'THEN family:='withdraw';c:=private.withdraw_prepared_claim();END IF;
 IF c IS NOT NULL THEN
  PERFORM set_config('withdraw_prepared.family',family,false);IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
  UPDATE private.withdraw_prepared_scheduler SET next_family=CASE family WHEN'withdraw'THEN'payment'ELSE'withdraw'END WHERE singleton;
 END IF;RETURN c;
END;$$;
CREATE FUNCTION private.withdraw_prepared_run_dispatch(p_worker text)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('withdraw_prepared.family',true)='withdraw'THEN RETURN private.withdraw_prepared_run_claimed();END IF;
 IF current_setting('withdraw_prepared.family',true)='payment'THEN RETURN private.prepared_aggregate_run_claimed(p_worker);END IF;
 RETURN jsonb_build_object('status','idle');
END;$$;
CREATE FUNCTION private.withdraw_prepared_maintenance()RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE n integer;old_heads integer;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_maintenance_deadline_required';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('withdraw_prepared_admission_v1',0))THEN RETURN jsonb_build_object('status','busy');END IF;
 UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=clock_timestamp()WHERE id IN(SELECT id FROM private.withdraw_prepared_jobs WHERE status='ready'AND next_due_at<=clock_timestamp()AND last_requested_at>clock_timestamp()-interval'1day'ORDER BY next_due_at LIMIT 100);
 GET DIAGNOSTICS n=ROW_COUNT;
 -- Delete only unused cache publications, never business/source data. Old
 -- scopes have no refresh lease and must be admitted again under fresh auth.
 DELETE FROM private.withdraw_prepared_heads WHERE job_id IN(SELECT id FROM private.withdraw_prepared_jobs WHERE status<>'running'AND last_requested_at<clock_timestamp()-interval'7days'ORDER BY last_requested_at LIMIT 100);
 GET DIAGNOSTICS old_heads=ROW_COUNT;
 DELETE FROM private.withdraw_prepared_artifacts WHERE id IN(SELECT a.id FROM private.withdraw_prepared_artifacts a WHERE NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_heads h WHERE h.artifact_id=a.id)ORDER BY a.computed_at LIMIT 100);
 DELETE FROM private.withdraw_prepared_jobs WHERE id IN(SELECT j.id FROM private.withdraw_prepared_jobs j WHERE j.status<>'running'AND j.last_requested_at<clock_timestamp()-interval'7days'AND NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_heads h WHERE h.job_id=j.id)AND NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_artifacts a WHERE a.job_id=j.id)ORDER BY j.last_requested_at LIMIT 100);
 DELETE FROM private.withdraw_prepared_admissions WHERE day<current_date-2;
 RETURN jsonb_build_object('queued',n,'retiredUnusedHeads',old_heads);
END;$$;
DO $acl$DECLARE p record;BEGIN
 FOR p IN SELECT oid FROM pg_proc WHERE pronamespace='private'::regnamespace AND proname LIKE 'withdraw_prepared_%'LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||p.oid::regprocedure||' FROM public,anon,authenticated,service_role';
 END LOOP;
END;$acl$;
-- Cut over only after default scopes are warmed and independently verified.
-- Keep original RPC signature and real authorization context; caller roles do
-- not gain a new endpoint or permission. Original raw helpers remain private
-- worker dependencies; no click can invoke them through this reader.
CREATE FUNCTION private.withdraw_prepared_cutover(p_expected_templates text[])RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $cutover$
DECLARE p record;w record;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(w.prosrc)<>'c9de037699f382f66ea8de2c5ea6e25e'OR pg_get_userbyid(w.proowner)<>'postgres'OR w.prosecdef OR w.provolatile NOT IN('s','v')OR w.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR w.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'OR w.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')OR w.proparallel<>'u'OR w.proisstrict OR w.proleakproof OR w.procost<>100 OR w.prorows<>0 OR w.prokind<>'f'OR pg_get_function_arguments(w.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb'OR pg_get_function_result(w.oid)<>'jsonb'THEN RAISE EXCEPTION 'withdraw_prepared_public_wrapper_drift';END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RAISE EXCEPTION 'withdraw_prepared_source_contract_changed';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF(md5(p.prosrc)NOT IN('12fe721956fb291f2c2b93a5d5187fbd','e84cb272d9f9a417e5106169249a7b86')AND md5(p.prosrc)IS DISTINCT FROM(SELECT capture_hash FROM private.withdraw_prepared_release WHERE singleton AND cutover_at IS NULL))OR pg_get_userbyid(p.proowner)<>'postgres'OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_cutover_drift';END IF;
 IF p_expected_templates IS NULL OR cardinality(p_expected_templates)<2 OR(SELECT array_agg(fingerprint ORDER BY fingerprint)FROM private.withdraw_prepared_templates WHERE enabled)IS DISTINCT FROM(SELECT array_agg(DISTINCT x ORDER BY x)FROM unnest(p_expected_templates)x)THEN RAISE EXCEPTION 'withdraw_prepared_release_manifest_mismatch';END IF;
 IF (SELECT count(DISTINCT request->>'view')FROM private.withdraw_prepared_templates WHERE enabled)<2 THEN RAISE EXCEPTION 'withdraw_prepared_defaults_not_registered';END IF;
 IF EXISTS(WITH expected AS(
   SELECT jsonb_build_array('withdraw-independent-windows-v2',t.scope,t.catalog,private.withdraw_window_default_day(t.request,(clock_timestamp()AT TIME ZONE t.timezone)::date-n))k,t.catalog
   FROM private.withdraw_prepared_templates t CROSS JOIN generate_series(0,1)n WHERE t.enabled)
  SELECT 1 FROM expected e LEFT JOIN private.withdraw_prepared_jobs j ON j.fingerprint=md5(e.k::text)AND j.request_key=e.k
   LEFT JOIN private.withdraw_prepared_heads h ON h.job_id=j.id LEFT JOIN private.withdraw_prepared_artifacts a ON a.id=h.artifact_id
   WHERE j.id IS NULL OR j.status<>'ready'OR a.id IS NULL OR a.revision<>j.revision OR a.dependency<>private.withdraw_prepared_dependency()OR a.expires_at<=clock_timestamp()OR NOT private.withdraw_prepared_catalog_current(e.catalog))THEN RAISE EXCEPTION 'withdraw_prepared_not_warmed';END IF;
 EXECUTE $ddl$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_auto_withdraw(p_request jsonb DEFAULT '{}'::jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''AS $body$BEGIN RETURN private.withdraw_prepared_read(p_request);END;$body$$ddl$;
 IF w.provolatile<>'v'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;PERFORM pg_notify('pgrst','reload schema');END IF;
 UPDATE private.withdraw_prepared_release SET cutover_at=clock_timestamp(),capture_ends_at=null WHERE singleton;
 DROP FUNCTION private.withdraw_prepared_begin_capture();
 DROP FUNCTION private.withdraw_prepared_abort_capture();
 DROP FUNCTION private.withdraw_prepared_capture(jsonb);
END;$cutover$;
REVOKE ALL ON FUNCTION private.withdraw_prepared_cutover(text[])FROM public,anon,authenticated,service_role;


-- BEGIN schedule
-- Scheduling shares the existing generic worker connection. Templates are
-- registered only from an already-authorized exact job, never from client JSON.
CREATE TABLE private.withdraw_prepared_templates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request jsonb NOT NULL,scope jsonb NOT NULL,catalog jsonb NOT NULL,
 timezone text NOT NULL,enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 fingerprint text NOT NULL UNIQUE
);
ALTER TABLE private.withdraw_prepared_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.withdraw_prepared_templates FROM public,anon,authenticated,service_role;
CREATE FUNCTION private.withdraw_prepared_register_template(p_job uuid,p_timezone text)RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE j private.withdraw_prepared_jobs%rowtype;r jsonb;tid uuid;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone)THEN RAISE EXCEPTION 'withdraw_prepared_timezone_invalid';END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=p_job;
 IF NOT FOUND OR left(j.request->>'startAt',10)<>left(j.request->>'endAt',10)OR NOT private.withdraw_window_whole_days(j.request)OR j.request->>'startAt'IS DISTINCT FROM j.request->>'successStartAt'OR j.request->>'endAt'IS DISTINCT FROM j.request->>'successEndAt'OR NOT private.withdraw_prepared_catalog_current(j.catalog)THEN RAISE EXCEPTION 'withdraw_prepared_template_invalid';END IF;
 -- Account searches are not recurring defaults. Country/platform/native scope
 -- and view are kept exactly; no wider scope is silently substituted.
 IF nullif(j.request->>'account','')IS NOT NULL THEN RAISE EXCEPTION 'withdraw_prepared_template_account';END IF;
 r:=j.request-ARRAY['startAt','endAt','successStartAt','successEndAt'];
 PERFORM pg_advisory_xact_lock(hashtextextended('withdraw_prepared_admission_v1',0));
 SELECT id INTO tid FROM private.withdraw_prepared_templates WHERE fingerprint=md5(jsonb_build_array(r,j.scope,j.catalog)::text)AND request=r AND scope=j.scope AND catalog=j.catalog;
 IF FOUND THEN RETURN tid;END IF;
 IF(SELECT count(*)FROM private.withdraw_prepared_templates)>=100 THEN RAISE EXCEPTION 'withdraw_prepared_template_capacity';END IF;
 INSERT INTO private.withdraw_prepared_templates(request,scope,catalog,timezone,fingerprint)VALUES(r,j.scope,j.catalog,p_timezone,md5(jsonb_build_array(r,j.scope,j.catalog)::text))RETURNING id INTO tid;RETURN tid;
END;$$;
CREATE FUNCTION private.withdraw_prepared_prewarm()RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE t private.withdraw_prepared_templates%rowtype;d date;offset_day integer;n integer:=0;r jsonb;dep text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_maintenance_deadline_required';END IF;
 dep:=private.withdraw_prepared_dependency();
 FOR t IN SELECT *FROM private.withdraw_prepared_templates WHERE enabled ORDER BY id LIMIT 100 LOOP
  IF NOT private.withdraw_prepared_catalog_current(t.catalog)THEN CONTINUE;END IF;
  FOR offset_day IN 0..1 LOOP
   d:=(clock_timestamp()AT TIME ZONE t.timezone)::date-offset_day;
   r:=private.withdraw_window_default_day(t.request,d);
   IF private.withdraw_prepared_enqueue(r,t.scope,t.catalog,dep)IS NOT NULL THEN n:=n+1;END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('expected',n);
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_prepared_register_template(uuid,text),private.withdraw_prepared_prewarm() FROM public,anon,authenticated,service_role;


-- BEGIN capture
-- Temporary opt-in warmup uses the existing authenticated gateway. It records
-- only the server-derived scope/catalog and normalized aggregate request.
-- No JWT, login, role-context signature or source-order payload is copied.
CREATE TABLE private.withdraw_prepared_release(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),capture_hash text,capture_ends_at timestamptz,cutover_at timestamptz);
INSERT INTO private.withdraw_prepared_release(singleton)VALUES(true);
ALTER TABLE private.withdraw_prepared_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.withdraw_prepared_release FROM public,anon,authenticated,service_role;
CREATE FUNCTION private.withdraw_prepared_capture(q jsonb)RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE s jsonb;c jsonb;r jsonb;k jsonb;budget integer;old_lock text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_release WHERE singleton AND capture_ends_at>clock_timestamp()AND cutover_at IS NULL)THEN RETURN;END IF;
 -- Real main already validated this exact request. These calls preserve the
 -- existing signed gateway context and recheck current authorized identities.
 PERFORM private.withdraw_prepared_validate(q);s:=private.dashboard_admin_live_scope();
 SELECT coalesce(jsonb_agg(to_jsonb(p)ORDER BY p.id),'[]')INTO c FROM private.dashboard_admin_live_platforms()p;
 r:=private.withdraw_prepared_canonical(q);k:=jsonb_build_array('withdraw-independent-windows-v2',s,c,r);
 old_lock:=current_setting('lock_timeout');
 BEGIN
  PERFORM set_config('lock_timeout','100ms',true);
  IF NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k)THEN
   INSERT INTO private.withdraw_prepared_admissions(actor,day,total)VALUES(auth.uid(),current_date,1)ON CONFLICT(actor,day)DO UPDATE SET total=private.withdraw_prepared_admissions.total+1 WHERE private.withdraw_prepared_admissions.total<200 RETURNING total INTO budget;
   IF budget IS NULL THEN PERFORM set_config('lock_timeout',old_lock,true);RETURN;END IF;
  END IF;
  PERFORM private.withdraw_prepared_enqueue(r,s,c,private.withdraw_prepared_dependency());
 EXCEPTION WHEN OTHERS THEN
  -- A derived-cache admission failure cannot replace or block the established
  -- main result. Query cancellation is deliberately not swallowed.
  NULL;
 END;
 PERFORM set_config('lock_timeout',old_lock,true);
END;$$;
CREATE FUNCTION private.withdraw_prepared_begin_capture()RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE p record;w record;d text;b text;anchor text:=' for v_target in select value from jsonb_array_elements(v_targets) loop';expected text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(w.prosrc)<>'c9de037699f382f66ea8de2c5ea6e25e'OR pg_get_userbyid(w.proowner)<>'postgres'OR w.prosecdef OR w.provolatile NOT IN('s','v')OR w.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR w.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'OR w.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')OR w.proparallel<>'u'OR w.proisstrict OR w.proleakproof OR w.procost<>100 OR w.prorows<>0 OR w.prokind<>'f'OR pg_get_function_arguments(w.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb'OR pg_get_function_result(w.oid)<>'jsonb'THEN RAISE EXCEPTION 'withdraw_prepared_public_wrapper_drift';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 SELECT capture_hash INTO expected FROM private.withdraw_prepared_release WHERE singleton AND cutover_at IS NULL;
 IF expected IS NOT NULL AND md5(p.prosrc)=expected AND pg_get_userbyid(p.proowner)='postgres'AND p.prosecdef AND p.provolatile='v'AND p.proconfig=ARRAY['search_path=""']AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'THEN
 IF w.provolatile<>'v'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;PERFORM pg_notify('pgrst','reload schema');END IF;
  RETURN;END IF;
 IF md5(p.prosrc)<>'12fe721956fb291f2c2b93a5d5187fbd'OR pg_get_userbyid(p.proowner)<>'postgres'OR NOT p.prosecdef OR p.provolatile<>'s'OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_capture_baseline_drift';END IF;
 IF w.provolatile<>'s'THEN RAISE EXCEPTION 'withdraw_prepared_capture_public_baseline_drift';END IF;
 IF(length(p.prosrc)-length(replace(p.prosrc,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'withdraw_prepared_capture_anchor';END IF;
 b:=replace(p.prosrc,anchor,E' perform private.withdraw_prepared_capture(p_request);\n'||anchor);
 d:=pg_get_functiondef(p.oid);d:=replace(d,p.prosrc,b);EXECUTE d;ALTER FUNCTION private.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;
 IF w.provolatile<>'v'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;PERFORM pg_notify('pgrst','reload schema');END IF;
 UPDATE private.withdraw_prepared_release SET capture_hash=md5(b),capture_ends_at=clock_timestamp()+interval'15minutes'WHERE singleton;
END;$$;
-- Revert only this temporary insertion. Keep admitted jobs/templates for later
-- inspection; neither a retry nor rollback silently extends capture lifetime.
CREATE FUNCTION private.withdraw_prepared_abort_capture()RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE p record;w record;d text;b text;expected text;insertion text:=E' perform private.withdraw_prepared_capture(p_request);\n';
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(w.prosrc)<>'c9de037699f382f66ea8de2c5ea6e25e'OR pg_get_userbyid(w.proowner)<>'postgres'OR w.prosecdef OR w.provolatile NOT IN('s','v')OR w.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR w.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'OR w.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')OR w.proparallel<>'u'OR w.proisstrict OR w.proleakproof OR w.procost<>100 OR w.prorows<>0 OR w.prokind<>'f'OR pg_get_function_arguments(w.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb'OR pg_get_function_result(w.oid)<>'jsonb'THEN RAISE EXCEPTION 'withdraw_prepared_public_wrapper_drift';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 SELECT capture_hash INTO expected FROM private.withdraw_prepared_release WHERE singleton AND cutover_at IS NULL;
 IF md5(p.prosrc)='12fe721956fb291f2c2b93a5d5187fbd'AND p.provolatile='s'AND pg_get_userbyid(p.proowner)='postgres'AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'THEN
 IF w.provolatile<>'s'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)STABLE;PERFORM pg_notify('pgrst','reload schema');END IF;
  RETURN;END IF;
 IF expected IS NULL OR md5(p.prosrc)IS DISTINCT FROM expected OR pg_get_userbyid(p.proowner)<>'postgres'OR NOT p.prosecdef OR p.provolatile<>'v'OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_capture_rollback_drift';END IF;
 b:=replace(p.prosrc,insertion,'');
 IF md5(b)<>'12fe721956fb291f2c2b93a5d5187fbd'THEN RAISE EXCEPTION 'withdraw_prepared_capture_rollback_body';END IF;
 d:=pg_get_functiondef(p.oid);d:=replace(d,p.prosrc,b);EXECUTE d;ALTER FUNCTION private.dashboard_admin_live_auto_withdraw(jsonb)STABLE;
 IF w.provolatile<>'s'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)STABLE;PERFORM pg_notify('pgrst','reload schema');END IF;
 UPDATE private.withdraw_prepared_release SET capture_ends_at=null WHERE singleton;
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_prepared_capture(jsonb),private.withdraw_prepared_begin_capture(),private.withdraw_prepared_abort_capture() FROM public,anon,authenticated,service_role;


-- BEGIN coordination
-- Add this family to the existing provider/prepared fairness lane without
-- changing any prepared_aggregate_* function or its semantic dependency token.
CREATE FUNCTION private.withdraw_prepared_provider_gate()RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE t private.prepared_aggregate_worker_turn%rowtype;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 -- Caller has selected a provider job and holds provider_snapshot_claim_v1.
 SELECT *INTO t FROM private.prepared_aggregate_worker_turn WHERE singleton FOR UPDATE;
 IF t.next_kind='prepared'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())
  AND(t.waiting_since IS NULL OR t.waiting_since>clock_timestamp()-interval'3seconds')THEN
  UPDATE private.prepared_aggregate_worker_turn SET waiting_since=coalesce(waiting_since,clock_timestamp())WHERE singleton;RETURN false;
 END IF;
 RETURN true;
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_prepared_provider_gate()FROM public,anon,authenticated,service_role;
DO $coordinate$
DECLARE p record;d text;a text;before_meta jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.provider_snapshot_claim(text,integer)'::regprocedure;
 IF md5(p.prosrc)<>'e80a93aa8c6540b51cb086ee9d70b669'OR p.prosecdef OR p.provolatile<>'v'OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR pg_get_userbyid(p.proowner)<>'postgres'OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_provider_contract_drift';END IF;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 a:=$a$if exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;$a$;
 IF(length(d)-length(replace(d,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'withdraw_prepared_provider_lease_anchor';END IF;
 d:=replace(d,a,a||E'\n if exists(select 1 from private.withdraw_prepared_jobs where status=''running''and lease_until>clock_timestamp())then return null;end if;');
 a:=$a$if not private.prepared_aggregate_take_turn('provider')then return null;end if;$a$;
 IF(length(d)-length(replace(d,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'withdraw_prepared_provider_turn_anchor';END IF;
 d:=replace(d,a,$a$if not private.withdraw_prepared_provider_gate()then return null;end if;
 if not private.prepared_aggregate_take_turn('provider')then return null;end if;$a$);EXECUTE d;
 IF(SELECT to_jsonb(q)-'prosrc'FROM pg_proc q WHERE oid=p.oid)IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'withdraw_prepared_provider_metadata_changed';END IF;
END;$coordinate$;

COMMIT;
