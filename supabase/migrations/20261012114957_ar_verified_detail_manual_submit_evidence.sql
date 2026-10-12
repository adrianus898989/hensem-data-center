-- Verified source-detail evidence; preserves raw listing values and existing native proof generations.
-- No source rows are scanned, rewritten, backfilled or approved by this installation.
BEGIN;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='1s';
LOCK TABLE public.ar_collected_orders IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;
DO $install_detail$
DECLARE f record;before_meta jsonb;old_fact_generation text;old_duration_generation text;old_check text:=current_setting('check_function_bodies');
BEGIN
 IF CURRENT_USER<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AR_DETAIL_INSTALL_OWNER_ONLY'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)');
 IF NOT FOUND OR md5(f.prosrc)<>ALL(ARRAY['1bfc6398524bc3194b91f1d411960425','3645bf1a24efd1ae7b89897616172fa5']::text[]) OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM false OR f.provolatile<>'s' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR pg_get_function_arguments(f.oid)<>'p_request jsonb, p_scope jsonb, p_start date, p_end date' OR pg_get_function_result(f.oid)<>'TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])' THEN RAISE EXCEPTION 'AR_DETAIL_BASELINE_DRIFT_dashboard_admin_ar_withdraw_days'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.dashboard_admin_live_withdraw_reasons(jsonb)');
 IF NOT FOUND OR md5(f.prosrc)<>ALL(ARRAY['dc349a32d5a9863b90920a7bf69781bb','100dd15063ed4560470f76418ab89c5c']::text[]) OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR f.prosecdef IS DISTINCT FROM true OR f.provolatile<>'s' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR pg_get_function_arguments(f.oid)<>'p_request jsonb' OR pg_get_function_result(f.oid)<>'jsonb' THEN RAISE EXCEPTION 'AR_DETAIL_BASELINE_DRIFT_dashboard_admin_live_withdraw_reasons'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.ar_historical_duration_generation()');
 IF NOT FOUND OR md5(f.prosrc)<>ALL(ARRAY['dab45cf30ff7388f2d0642737977460f','6ad649935379e96fae90ea7659be7b1c']::text[]) OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM false OR f.provolatile<>'s' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR pg_get_function_arguments(f.oid)<>'' OR pg_get_function_result(f.oid)<>'text' THEN RAISE EXCEPTION 'AR_DETAIL_BASELINE_DRIFT_ar_historical_duration_generation'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp,timestamp,timestamptz,timestamptz)');
 IF NOT FOUND OR md5(f.prosrc)<>ALL(ARRAY['2ced394f03ebe7de5dbb8721c8f73304']::text[]) OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM false OR f.provolatile<>'i' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR pg_get_function_arguments(f.oid)<>'p_source_system text, p_country_code text, p_platform text, p_order_kind text, p_order_no text, p_status text, p_operator text, p_applied_at timestamp without time zone, p_completed_at timestamp without time zone, p_observed_at timestamp with time zone, p_updated_at timestamp with time zone' OR pg_get_function_result(f.oid)<>'TABLE(source_system text, country_code text, platform text, order_kind text, order_no text, status text, applied_at timestamp without time zone, account text, seconds numeric, is_success boolean, is_rejected boolean, method text, observed_at timestamp with time zone, updated_at timestamp with time zone)' THEN RAISE EXCEPTION 'AR_DETAIL_BASELINE_DRIFT_ar_withdraw_fact'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.sync_ar_withdraw_fact()');
 IF NOT FOUND OR md5(f.prosrc)<>ALL(ARRAY['fd2f53c73d864b0a6daa5c1016053894']::text[]) OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM true OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR pg_get_function_arguments(f.oid)<>'' OR pg_get_function_result(f.oid)<>'trigger' THEN RAISE EXCEPTION 'AR_DETAIL_BASELINE_DRIFT_sync_ar_withdraw_fact'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.ar_withdraw_fact_generation()');
 IF NOT FOUND OR md5(f.prosrc)<>ALL(ARRAY['d55ef2b1f99bd2543f01d228dbe5e445']::text[]) OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM false OR f.provolatile<>'s' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR pg_get_function_arguments(f.oid)<>'' OR pg_get_function_result(f.oid)<>'text' THEN RAISE EXCEPTION 'AR_DETAIL_BASELINE_DRIFT_ar_withdraw_fact_generation'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('public.publish_ar_collected_orders(text,jsonb)');
 IF NOT FOUND OR md5(f.prosrc)<>ALL(ARRAY['f276a3d98f7f83edfa6cdbb585d8c85c']::text[]) OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' OR f.prosecdef IS DISTINCT FROM false OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR pg_get_function_arguments(f.oid)<>'p_token_hash text, p_payload jsonb' OR pg_get_function_result(f.oid)<>'jsonb' THEN RAISE EXCEPTION 'AR_DETAIL_BASELINE_DRIFT_publish_ar_collected_orders'; END IF;
 SELECT jsonb_agg(to_jsonb(z)-'prosrc' ORDER BY oid) INTO before_meta FROM pg_proc z WHERE z.oid=ANY(ARRAY['private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure,'private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.ar_historical_duration_generation()'::regprocedure,'private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp,timestamp,timestamptz,timestamptz)'::regprocedure,'private.sync_ar_withdraw_fact()'::regprocedure,'private.ar_withdraw_fact_generation()'::regprocedure,'public.publish_ar_collected_orders(text,jsonb)'::regprocedure]);
 old_fact_generation:=private.ar_withdraw_fact_generation();old_duration_generation:=private.ar_historical_duration_generation();
 IF to_regclass('private.ar_withdraw_detail_operator_evidence') IS NULL THEN
  IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND p.proname=ANY(ARRAY['guard_ar_withdraw_detail_evidence_write','invalidate_ar_withdraw_detail_evidence','record_ar_withdraw_detail_manual_evidence','ar_withdraw_detail_evidence_generation'])) OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.ar_collected_orders'::regclass AND tgname='ar_detail_evidence_identity_change') THEN RAISE EXCEPTION 'AR_DETAIL_INSTALL_NAME_COLLISION'; END IF;
  PERFORM set_config('check_function_bodies','off',true);
  EXECUTE $objects$-- Work-only draft. Empty sidecar installation; no source/order/fact modifications.
CREATE TABLE private.ar_withdraw_detail_operator_evidence (
 source_system text NOT NULL,
 country_code text NOT NULL,
 platform text NOT NULL,
 order_kind text NOT NULL,
 order_no text NOT NULL,
 source_applied_at timestamp NOT NULL,
 action text NOT NULL,
 source_event_label text NOT NULL,
 manual_submit_actor text,
 source_submitted_at timestamp NOT NULL,
 callback_actor text,
 evidence_path text NOT NULL,
 evidence_sha256 text NOT NULL,
 evidence_generation text NOT NULL,
 verified_at timestamptz NOT NULL,
 PRIMARY KEY(source_system,country_code,platform,order_kind,order_no),
 CONSTRAINT ar_detail_population CHECK(source_system='AR' AND country_code='IN' AND order_kind='withdraw' AND isfinite(source_applied_at) AND source_applied_at>=timestamp '2026-10-10'),
 CONSTRAINT ar_detail_action CHECK(action='manual_submit' AND source_event_label='提交三方中'),
 CONSTRAINT ar_detail_actor CHECK(manual_submit_actor IS NULL OR (manual_submit_actor=btrim(replace(replace(coalesce(manual_submit_actor,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') AND length(manual_submit_actor) BETWEEN 1 AND 240 AND manual_submit_actor !~ '[[:cntrl:]]' AND position('system' IN lower(btrim(replace(replace(coalesce(manual_submit_actor,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))=0)),
 CONSTRAINT ar_detail_event_time CHECK(isfinite(source_submitted_at) AND source_submitted_at>=source_applied_at AND (callback_actor IS NULL OR callback_actor='system')),
 CONSTRAINT ar_detail_provenance CHECK(evidence_path ~ '^work/ar-detail-operator-contract/evidence/[A-Za-z0-9._-]+[.]png$' AND evidence_sha256 ~ '^[a-f0-9]{64}$' AND evidence_generation ~ '^[a-f0-9]{32}$'),
 CONSTRAINT ar_detail_native_fk FOREIGN KEY(source_system,country_code,platform,order_kind,order_no) REFERENCES public.ar_collected_orders(source_system,country_code,platform,order_kind,order_no) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE private.ar_withdraw_detail_operator_evidence OWNER TO postgres;
ALTER TABLE private.ar_withdraw_detail_operator_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ar_withdraw_detail_operator_evidence FROM PUBLIC,anon,authenticated,service_role;
GRANT ALL ON private.ar_withdraw_detail_operator_evidence TO postgres;

CREATE FUNCTION private.guard_ar_withdraw_detail_evidence_write() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
BEGIN
 IF CURRENT_USER<>'postgres' OR TG_RELID<>'private.ar_withdraw_detail_operator_evidence'::regclass OR TG_WHEN<>'BEFORE' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ar_detail_evidence_owner_only';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='TRUNCATE' THEN RETURN NULL; END IF;
 RETURN NEW;
END;
$body$;
CREATE FUNCTION private.invalidate_ar_withdraw_detail_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
BEGIN
 IF TG_RELID<>'public.ar_collected_orders'::regclass OR TG_WHEN<>'AFTER' OR TG_LEVEL<>'ROW' OR TG_OP<>'UPDATE' THEN
  RAISE EXCEPTION 'ar_detail_evidence_source_context_invalid';
 END IF;
 DELETE FROM private.ar_withdraw_detail_operator_evidence e
 WHERE (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no)=
  (OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no);
 RETURN NEW;
END;
$body$;
CREATE TRIGGER ar_detail_evidence_write_guard BEFORE INSERT OR UPDATE OR DELETE ON private.ar_withdraw_detail_operator_evidence FOR EACH ROW EXECUTE FUNCTION private.guard_ar_withdraw_detail_evidence_write();
CREATE TRIGGER ar_detail_evidence_truncate_guard BEFORE TRUNCATE ON private.ar_withdraw_detail_operator_evidence FOR EACH STATEMENT EXECUTE FUNCTION private.guard_ar_withdraw_detail_evidence_write();
CREATE TRIGGER ar_detail_evidence_identity_change AFTER UPDATE ON public.ar_collected_orders FOR EACH ROW WHEN ((OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.order_no,OLD.applied_at) IS DISTINCT FROM (NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.order_no,NEW.applied_at) AND OLD.source_system='AR' AND OLD.country_code='IN' AND OLD.order_kind='withdraw') EXECUTE FUNCTION private.invalidate_ar_withdraw_detail_evidence();

CREATE FUNCTION private.record_ar_withdraw_detail_manual_evidence(p_source_system text,p_country_code text,p_platform text,p_order_kind text,p_order_no text,p_applied_at timestamp,p_source_event_label text,p_manual_submit_actor text,p_submitted_at timestamp,p_callback_actor text,p_evidence_path text,p_evidence_sha256 text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE a public.ar_collected_orders%ROWTYPE;g text;previous private.ar_withdraw_detail_operator_evidence%ROWTYPE;
BEGIN
 IF CURRENT_USER<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ar_detail_evidence_owner_only'; END IF;
 IF p_source_system IS DISTINCT FROM 'AR' OR p_country_code IS DISTINCT FROM 'IN' OR p_order_kind IS DISTINCT FROM 'withdraw'
  OR p_applied_at IS NULL OR NOT isfinite(p_applied_at) OR p_applied_at<timestamp '2026-10-10'
  OR p_source_event_label IS DISTINCT FROM '提交三方中'
  OR p_submitted_at IS NULL OR NOT isfinite(p_submitted_at) OR p_submitted_at<p_applied_at
  OR (p_manual_submit_actor IS NOT NULL AND (p_manual_submit_actor<>btrim(replace(replace(coalesce(p_manual_submit_actor,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') OR length(p_manual_submit_actor) NOT BETWEEN 1 AND 240 OR p_manual_submit_actor ~ '[[:cntrl:]]' OR position('system' IN lower(btrim(replace(replace(coalesce(p_manual_submit_actor,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0))
  OR (p_callback_actor IS NOT NULL AND p_callback_actor<>'system')
  OR p_evidence_path IS NULL OR p_evidence_path !~ '^work/ar-detail-operator-contract/evidence/[A-Za-z0-9._-]+[.]png$'
  OR p_evidence_sha256 IS NULL OR p_evidence_sha256 !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_ar_detail_manual_evidence';
 END IF;
 SELECT s.* INTO a FROM public.ar_collected_orders s
 WHERE (s.source_system,s.country_code,s.platform,s.order_kind,s.order_no)=(p_source_system,p_country_code,p_platform,p_order_kind,p_order_no) FOR SHARE;
 IF NOT FOUND OR a.applied_at IS DISTINCT FROM p_applied_at OR btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')<>'' THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='ar_detail_source_identity_or_listing_changed';
 END IF;
 g:=private.ar_withdraw_detail_evidence_generation();
 IF g IS NULL THEN RAISE EXCEPTION 'ar_detail_evidence_metadata_invalid'; END IF;
 SELECT e.* INTO previous FROM private.ar_withdraw_detail_operator_evidence e
 WHERE (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no)=(p_source_system,p_country_code,p_platform,p_order_kind,p_order_no) FOR UPDATE;
 IF FOUND THEN
  IF (previous.source_applied_at,previous.action,previous.source_event_label,previous.manual_submit_actor,previous.source_submitted_at,previous.callback_actor,previous.evidence_path,previous.evidence_sha256,previous.evidence_generation) IS DISTINCT FROM
   (p_applied_at,'manual_submit'::text,p_source_event_label,p_manual_submit_actor,p_submitted_at,p_callback_actor,p_evidence_path,p_evidence_sha256,g) THEN
   RAISE EXCEPTION 'ar_detail_evidence_conflict_requires_review';
  END IF;
  RETURN jsonb_build_object('inserted',false,'classification','manual','basis','detail_manual_submit');
 END IF;
 INSERT INTO private.ar_withdraw_detail_operator_evidence VALUES(p_source_system,p_country_code,p_platform,p_order_kind,p_order_no,p_applied_at,'manual_submit',p_source_event_label,p_manual_submit_actor,p_submitted_at,p_callback_actor,p_evidence_path,p_evidence_sha256,g,clock_timestamp());
 RETURN jsonb_build_object('inserted',true,'classification','manual','basis','detail_manual_submit');
END;
$body$;
CREATE FUNCTION private.ar_withdraw_detail_evidence_generation() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $body$
 WITH table_ok AS MATERIALIZED (
  SELECT c.oid FROM pg_class c WHERE c.oid='private.ar_withdraw_detail_operator_evidence'::regclass AND c.relkind='r' AND pg_get_userbyid(c.relowner)='postgres' AND c.relrowsecurity AND NOT c.relforcerowsecurity
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a WHERE a.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_policy x WHERE x.polrelid=c.oid)
   AND NOT EXISTS(SELECT 1 FROM pg_inherits x WHERE x.inhrelid=c.oid OR x.inhparent=c.oid)
   AND NOT EXISTS(SELECT 1 FROM pg_inherits x WHERE x.inhrelid='public.ar_collected_orders'::regclass OR x.inhparent='public.ar_collected_orders'::regclass)
   AND EXISTS(SELECT 1 FROM pg_constraint x JOIN pg_index i ON i.indexrelid=x.conindid WHERE x.conrelid='public.ar_collected_orders'::regclass AND x.contype='p' AND x.convalidated AND NOT x.condeferrable AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND pg_get_constraintdef(x.oid)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)')
   AND (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,atthasdef,attgenerated)ORDER BY attnum)FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped)='[["source_system","text",true,false,""],["country_code","text",true,false,""],["platform","text",true,false,""],["order_kind","text",true,false,""],["order_no","text",true,false,""],["source_applied_at","timestamp without time zone",true,false,""],["action","text",true,false,""],["source_event_label","text",true,false,""],["manual_submit_actor","text",false,false,""],["source_submitted_at","timestamp without time zone",true,false,""],["callback_actor","text",false,false,""],["evidence_path","text",true,false,""],["evidence_sha256","text",true,false,""],["evidence_generation","text",true,false,""],["verified_at","timestamp with time zone",true,false,""]]'::jsonb
   AND (SELECT jsonb_agg(jsonb_build_array(contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid))ORDER BY conname)FROM pg_constraint WHERE conrelid=c.oid AND contype<>'n')='[["c",true,false,false,"CHECK (((action = ''manual_submit''::text) AND (source_event_label = ''提交三方中''::text)))"],["c",true,false,false,"CHECK (((manual_submit_actor IS NULL) OR ((manual_submit_actor = btrim(replace(replace(COALESCE(manual_submit_actor, ''''::text), chr(8203), ''''::text), chr(65279), ''''::text), ''\t\n\u000b\f\r\u001c\u001d\u001e\u001f                  　''::text)) AND ((length(manual_submit_actor) >= 1) AND (length(manual_submit_actor) <= 240)) AND (manual_submit_actor !~ ''[[:cntrl:]]''::text) AND (POSITION((''system''::text) IN (lower(btrim(replace(replace(COALESCE(manual_submit_actor, ''''::text), chr(8203), ''''::text), chr(65279), ''''::text), ''\t\n\u000b\f\r\u001c\u001d\u001e\u001f                  　''::text)))) = 0))))"],["c",true,false,false,"CHECK ((isfinite(source_submitted_at) AND (source_submitted_at >= source_applied_at) AND ((callback_actor IS NULL) OR (callback_actor = ''system''::text))))"],["f",true,true,true,"FOREIGN KEY (source_system, country_code, platform, order_kind, order_no) REFERENCES public.ar_collected_orders(source_system, country_code, platform, order_kind, order_no) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED"],["c",true,false,false,"CHECK (((source_system = ''AR''::text) AND (country_code = ''IN''::text) AND (order_kind = ''withdraw''::text) AND isfinite(source_applied_at) AND (source_applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)))"],["c",true,false,false,"CHECK (((evidence_path ~ ''^work/ar-detail-operator-contract/evidence/[A-Za-z0-9._-]+[.]png$''::text) AND (evidence_sha256 ~ ''^[a-f0-9]{64}$''::text) AND (evidence_generation ~ ''^[a-f0-9]{32}$''::text)))"],["p",true,false,false,"PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)"]]'::jsonb
 ), functions_ok AS MATERIALIZED (
  SELECT p.oid FROM pg_proc p WHERE p.oid IN('private.guard_ar_withdraw_detail_evidence_write()'::regprocedure,'private.invalidate_ar_withdraw_detail_evidence()'::regprocedure,'private.record_ar_withdraw_detail_manual_evidence(text,text,text,text,text,timestamp,text,text,timestamp,text,text,text)'::regprocedure)
   AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}'
   AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proleakproof AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   AND p.prosecdef=(p.proname='invalidate_ar_withdraw_detail_evidence')
   AND md5(p.prosrc)=CASE p.proname
    WHEN 'guard_ar_withdraw_detail_evidence_write' THEN 'd85f43326d0cd521578baa31ac1fb5c5'
    WHEN 'invalidate_ar_withdraw_detail_evidence' THEN '1b78a92b8cda3dbe288e3d32bcd6e4cd'
    WHEN 'record_ar_withdraw_detail_manual_evidence' THEN '20a45a8934f8c5c42af6a778a0a5d915' END
   AND pg_get_function_arguments(p.oid)=CASE p.proname WHEN 'record_ar_withdraw_detail_manual_evidence' THEN 'p_source_system text, p_country_code text, p_platform text, p_order_kind text, p_order_no text, p_applied_at timestamp without time zone, p_source_event_label text, p_manual_submit_actor text, p_submitted_at timestamp without time zone, p_callback_actor text, p_evidence_path text, p_evidence_sha256 text' ELSE '' END
   AND pg_get_function_result(p.oid)=CASE p.proname WHEN 'record_ar_withdraw_detail_manual_evidence' THEN 'jsonb' ELSE 'trigger' END
 ), triggers_ok AS MATERIALIZED (
  SELECT t.oid,t.xmin::text epoch,pg_get_triggerdef(t.oid) definition FROM pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgenabled='O' AND t.tgnargs=0
   AND ((t.tgrelid='private.ar_withdraw_detail_operator_evidence'::regclass AND t.tgfoid='private.guard_ar_withdraw_detail_evidence_write()'::regprocedure AND t.tgqual IS NULL
     AND ((t.tgname='ar_detail_evidence_write_guard' AND t.tgtype=31) OR (t.tgname='ar_detail_evidence_truncate_guard' AND t.tgtype=34)))
    OR (t.tgrelid='public.ar_collected_orders'::regclass AND t.tgname='ar_detail_evidence_identity_change' AND t.tgfoid='private.invalidate_ar_withdraw_detail_evidence()'::regprocedure AND md5(pg_get_triggerdef(t.oid))='1a8035db989e03ae00410e6f80bd6ab7'))
 )
 SELECT CASE WHEN (SELECT count(*) FROM table_ok)=1 AND (SELECT count(*) FROM functions_ok)=3 AND (SELECT count(*) FROM triggers_ok)=3
  AND (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid='private.ar_withdraw_detail_operator_evidence'::regclass AND NOT t.tgisinternal)=2
 THEN md5('ar_verified_detail_manual_submit_v1:'||(SELECT string_agg(oid::text||':'||epoch||':'||definition,',' ORDER BY oid) FROM triggers_ok)) END;
$body$;
ALTER FUNCTION private.guard_ar_withdraw_detail_evidence_write() OWNER TO postgres; REVOKE ALL ON FUNCTION private.guard_ar_withdraw_detail_evidence_write() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.invalidate_ar_withdraw_detail_evidence() OWNER TO postgres; REVOKE ALL ON FUNCTION private.invalidate_ar_withdraw_detail_evidence() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.record_ar_withdraw_detail_manual_evidence(text,text,text,text,text,timestamp,text,text,timestamp,text,text,text) OWNER TO postgres; REVOKE ALL ON FUNCTION private.record_ar_withdraw_detail_manual_evidence(text,text,text,text,text,timestamp,text,text,timestamp,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.ar_withdraw_detail_evidence_generation() OWNER TO postgres; REVOKE ALL ON FUNCTION private.ar_withdraw_detail_evidence_generation() FROM PUBLIC,anon,authenticated,service_role;
$objects$;
  PERFORM set_config('check_function_bodies',old_check,true);
 END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.guard_ar_withdraw_detail_evidence_write()');
 IF NOT FOUND OR md5(f.prosrc)<>'d85f43326d0cd521578baa31ac1fb5c5' OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM false OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.proretset OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR pg_get_function_arguments(f.oid)<>'' OR pg_get_function_result(f.oid)<>'trigger' THEN RAISE EXCEPTION 'AR_DETAIL_OBJECT_DRIFT_guard_ar_withdraw_detail_evidence_write'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.invalidate_ar_withdraw_detail_evidence()');
 IF NOT FOUND OR md5(f.prosrc)<>'1b78a92b8cda3dbe288e3d32bcd6e4cd' OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM true OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.proretset OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR pg_get_function_arguments(f.oid)<>'' OR pg_get_function_result(f.oid)<>'trigger' THEN RAISE EXCEPTION 'AR_DETAIL_OBJECT_DRIFT_invalidate_ar_withdraw_detail_evidence'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.record_ar_withdraw_detail_manual_evidence(text,text,text,text,text,timestamp,text,text,timestamp,text,text,text)');
 IF NOT FOUND OR md5(f.prosrc)<>'20a45a8934f8c5c42af6a778a0a5d915' OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM false OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.proretset OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR pg_get_function_arguments(f.oid)<>'p_source_system text, p_country_code text, p_platform text, p_order_kind text, p_order_no text, p_applied_at timestamp without time zone, p_source_event_label text, p_manual_submit_actor text, p_submitted_at timestamp without time zone, p_callback_actor text, p_evidence_path text, p_evidence_sha256 text' OR pg_get_function_result(f.oid)<>'jsonb' THEN RAISE EXCEPTION 'AR_DETAIL_OBJECT_DRIFT_record_ar_withdraw_detail_manual_evidence'; END IF;
 SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure('private.ar_withdraw_detail_evidence_generation()');
 IF NOT FOUND OR md5(f.prosrc)<>'393978c9146ae30019a87632d4d51998' OR pg_get_userbyid(f.proowner)<>'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR f.prosecdef IS DISTINCT FROM false OR f.provolatile<>'s' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR f.proretset OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR pg_get_function_arguments(f.oid)<>'' OR pg_get_function_result(f.oid)<>'text' THEN RAISE EXCEPTION 'AR_DETAIL_OBJECT_DRIFT_ar_withdraw_detail_evidence_generation'; END IF;
 IF private.ar_withdraw_detail_evidence_generation() IS NULL THEN RAISE EXCEPTION 'AR_DETAIL_TABLE_TRIGGER_DRIFT'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure)<>'3645bf1a24efd1ae7b89897616172fa5' THEN EXECUTE $patch_dashboard_admin_ar_withdraw_days$CREATE OR REPLACE FUNCTION private.dashboard_admin_ar_withdraw_days(p_request jsonb, p_scope jsonb, p_start date, p_end date)
 RETURNS TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>61 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_ar_report_range';
 END IF;
 RETURN QUERY
 WITH supported(code,name) AS (VALUES
  ('BR','POP555'),('BR','POP678'),('BR','POP888'),('BR','POPBEM'),('BR','POPBRA'),('BR','POPCEU'),('BR','POPLUA'),('BR','POPPG'),
  ('ID','55FIVE'),
  ('IN','51GAME'),('IN','55CLUB'),('IN','6CLUB'),('IN','82LOTTERY'),('IN','91CLUB'),('IN','BIGMUMBAI'),('IN','IN999'),
  ('IN','JAICLUB'),('IN','JALWA'),('IN','LOTTERY7'),('IN','OKWIN'),('IN','RAJA'),('IN','SHREEWIN'),('IN','TPPLAY'),('IN','Veer.Game'),
  ('MM','6LOTTERY'),('MY','MZPLAY'),('NG','FB999'),
  ('PK','92.GAME'),('PK','92COCO'),('PK','92DADU'),('PK','92GLORY'),('PK','92GO'),('PK','92PKR'),('PK','92R'),('PK','92STAR'),('PK','92STRIKE'),('PK','YAYWIN'),
  ('VN','66CLUB'),('VN','82VN'),('VN','92LOTTERY'),('VN','VN168')
 ), targets AS MATERIALIZED (
  SELECT t->>'country' country,CASE WHEN jsonb_typeof(t->'platforms')='array'
    THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(x) FROM jsonb_array_elements_text(t->'platforms')x) END platforms
  FROM jsonb_array_elements(CASE WHEN p_request?'scopeTargets' THEN p_request->'scopeTargets'
    ELSE jsonb_build_array(jsonb_build_object('country',p_request->>'country','platforms',null)) END)t
 ), requested AS (
  SELECT CASE WHEN nullif(p_request->>'platform','') IS NOT NULL THEN ARRAY[private.dashboard_admin_live_withdraw_key(p_request->>'platform')]
   WHEN p_request?'platforms' AND jsonb_array_length(p_request->'platforms')>0 THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(x) FROM jsonb_array_elements_text(p_request->'platforms')x) END platforms
 ), catalog AS MATERIALIZED (
  SELECT m.*,s.name canonical_name,
   ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[m.source_name,m.name,s.name])x WHERE x IS NOT NULL) aliases,
   ARRAY(SELECT DISTINCT private.dashboard_admin_live_withdraw_key(x)
    FROM unnest(ARRAY[m.source_name,m.name,s.name])x WHERE x IS NOT NULL) alias_keys
  FROM private.dashboard_admin_live_platforms()m
  JOIN supported s ON s.code=m.scope_group AND private.dashboard_admin_live_withdraw_key(s.name)=private.dashboard_admin_live_withdraw_key(m.source_name)
  WHERE m.source='ar'
 ), scopes AS MATERIALIZED (
  -- The existing catalog already checks authentication and independent grants.
  -- Keep its source name and country identity; never infer a country from a label.
  SELECT DISTINCT ON(m.scope_group,private.dashboard_admin_live_withdraw_key(m.source_name))
   m.scope_group code,m.country,m.name platform,private.dashboard_admin_live_withdraw_key(m.source_name) platform_key,
   m.aliases,m.alias_keys
  FROM catalog m
  JOIN targets t ON t.country=m.country AND (t.platforms IS NULL OR m.alias_keys&&t.platforms)
  CROSS JOIN requested r
  WHERE (r.platforms IS NULL OR m.alias_keys&&r.platforms)
   AND private.dashboard_scope_allows(p_scope,m.country,m.name)
  ORDER BY m.scope_group,private.dashboard_admin_live_withdraw_key(m.source_name),m.name,m.source_name
 ), generation AS MATERIALIZED (
  SELECT private.ar_withdraw_fact_generation() id
 ), partitions AS MATERIALIZED (
  SELECT s.*,n.native_alias,dt.d::date data_date,
   (s.code='IN' AND g.id IS NOT NULL AND
    (EXISTS(SELECT 1 FROM private.ar_withdraw_fact_ready r WHERE r.country_code='IN' AND r.platform=n.native_alias AND r.data_date=dt.d::date AND r.generation=g.id)
     OR EXISTS(SELECT 1 FROM private.ar_withdraw_fact_future_ready r WHERE r.country_code='IN' AND r.platform=n.native_alias AND dt.d::date>=r.future_from AND r.generation=g.id))) projected
  FROM scopes s CROSS JOIN LATERAL unnest(s.aliases)n(native_alias)
   CROSS JOIN generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d) CROSS JOIN generation g
 ), detail_generation AS MATERIALIZED (
  SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure AND md5(p.prosrc)='393978c9146ae30019a87632d4d51998' AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prorettype='text'::regtype AND NOT p.proretset AND pg_get_function_arguments(p.oid)='' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')) THEN private.ar_withdraw_detail_evidence_generation() END id
 ), detail_evidence AS MATERIALIZED (
  SELECT e.* FROM private.ar_withdraw_detail_operator_evidence e CROSS JOIN detail_generation g
  WHERE e.evidence_generation=g.id AND e.source_applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp AND e.source_applied_at<(p_end+1)::timestamp
 ), raw_facts AS NOT MATERIALIZED (
  SELECT q.country,q.platform,q.platform_key,a.applied_at::date data_date,
   coalesce(a.status,'') status,
   -- Explicit Python str.strip whitespace set; POSIX space depends on DB locale.
   CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN coalesce(e.manual_submit_actor,'') ELSE btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') END account,
   CASE WHEN a.completed_at>a.applied_at THEN trunc(extract(epoch FROM a.completed_at-a.applied_at)) END seconds,
   a.observed_at,a.updated_at,(e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='') detail_manual
  FROM partitions q CROSS JOIN LATERAL (
   SELECT a.* FROM public.ar_collected_orders a
   WHERE NOT q.projected AND a.source_system='AR' AND a.country_code=q.code
    AND a.platform=q.native_alias AND a.order_kind='withdraw'
    AND a.applied_at>=TIMESTAMP '2026-10-10'
    AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp
   OFFSET 0
  ) a LEFT JOIN detail_evidence e ON (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=
   (a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at)
 ), classified AS MATERIALIZED (
  SELECT f.*,
   (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0
    OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0)
    OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) is_success,
   (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0
    OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) is_rejected,
   CASE WHEN f.detail_manual THEN 'manual' WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN
    CASE WHEN (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0 OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) AND NOT (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0 OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0) OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) THEN 'manual' ELSE 'unknown' END
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method
  FROM raw_facts f

  UNION ALL
  SELECT q.country,q.platform,q.platform_key,q.data_date,f.status,CASE WHEN f.account='' AND e.order_no IS NOT NULL THEN coalesce(e.manual_submit_actor,'') ELSE f.account END,f.seconds,f.observed_at,f.updated_at,(e.order_no IS NOT NULL AND f.account=''),f.is_success,f.is_rejected,
   CASE WHEN f.account='' AND e.order_no IS NOT NULL THEN 'manual' WHEN f.method='unknown' AND f.is_rejected AND NOT f.is_success THEN 'manual' ELSE f.method END
  FROM partitions q CROSS JOIN LATERAL (
   SELECT f.* FROM private.ar_withdraw_facts f
   WHERE q.projected AND f.country_code=q.code AND f.platform=q.native_alias
    AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
    AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
    AND f.applied_at<(p_end+1)::timestamp
   OFFSET 0
  ) f LEFT JOIN detail_evidence e ON (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=
   (f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at)
 ), days AS (
  SELECT f.data_date,f.country,f.platform,f.platform_key,count(*)::bigint total,
   count(*) FILTER(WHERE f.is_success)::bigint success,
   count(*) FILTER(WHERE NOT f.is_success AND f.is_rejected)::bigint rejected,
   count(*) FILTER(WHERE f.method='auto')::bigint auto_count,count(*) FILTER(WHERE f.method='manual')::bigint manual_count,
   sum(f.seconds) FILTER(WHERE f.seconds>0)/nullif(count(*) FILTER(WHERE f.seconds>0),0) avg_seconds,
   count(*) FILTER(WHERE f.seconds>0)::bigint duration_sample_count,
   coalesce(sum(f.seconds) FILTER(WHERE f.seconds>0),0) duration_total_seconds,
   max(f.observed_at) source_updated_at,max(f.updated_at) updated_at
  FROM classified f GROUP BY f.data_date,f.country,f.platform,f.platform_key
 ), operators AS MATERIALIZED (
  SELECT f.data_date,f.country,f.platform_key,f.account,count(*)::bigint processed,
   count(*) FILTER(WHERE f.is_rejected)::bigint rejected,
   count(*) FILTER(WHERE NOT f.is_rejected)::bigint success,
   sum(f.seconds) FILTER(WHERE f.seconds>0)/nullif(count(*) FILTER(WHERE f.seconds>0),0) avg_seconds,
   count(*) FILTER(WHERE f.seconds>0)::bigint duration_sample_count,
   coalesce(sum(f.seconds) FILTER(WHERE f.seconds>0),0) duration_total_seconds,
   max(f.observed_at) source_updated_at,max(f.updated_at) updated_at
  FROM classified f WHERE f.method='manual' AND coalesce(p_request->>'view','auto')='operators'
  GROUP BY f.data_date,f.country,f.platform_key,f.account
 ), operator_days AS MATERIALIZED (
  SELECT o.data_date,o.country,o.platform_key,
   jsonb_agg(to_jsonb(o)-ARRAY['data_date','country','platform_key'] ORDER BY o.account) operator_rows
  FROM operators o GROUP BY o.data_date,o.country,o.platform_key
 )
 SELECT dt.d::date,s.country,s.platform,s.platform_key,d.total,d.success,d.rejected,d.auto_count,d.manual_count,
  d.avg_seconds,d.duration_sample_count,d.duration_total_seconds,d.source_updated_at,d.updated_at,false,
 coalesce(op.operator_rows,'[]'::jsonb),s.alias_keys
 FROM scopes s CROSS JOIN generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d)
 LEFT JOIN days d ON d.data_date=dt.d::date AND d.country=s.country AND d.platform_key=s.platform_key
 LEFT JOIN operator_days op ON op.data_date=dt.d::date AND op.country=s.country AND op.platform_key=s.platform_key;
END;
$function$
;$patch_dashboard_admin_ar_withdraw_days$; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure)<>'100dd15063ed4560470f76418ab89c5c' THEN EXECUTE $patch_dashboard_admin_live_withdraw_reasons$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_reasons(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_country text;v_platform text;v_code text;v_date date;v_kind text;
 v_offset integer;v_limit integer;v_meta record;v_aliases text[];v_snapshot record;v_expected bigint;v_latest date;
 v_rows jsonb;v_categories jsonb;v_summary jsonb;v_total bigint;v_count bigint;v_rejected bigint;v_noted bigint;v_updated timestamptz;v_key text;
 v_category text;v_reason text;v_operator text;v_query text;v_blocking boolean;v_grouped_snapshot jsonb;v_ar_raw_only boolean;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
  or p_request-array['date','country','platform','kind','offset','limit','category','reasonKey','operatorKey','query']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
 foreach v_key in array array['date','country','platform','kind','category','reasonKey','operatorKey','query'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 if coalesce(p_request->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='invalid_time';end if;
 v_date:=(p_request->>'date')::date;v_country:=nullif(btrim(p_request->>'country'),'');v_platform:=nullif(btrim(p_request->>'platform'),'');
 v_kind:=coalesce(p_request->>'kind','blocking');v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 v_blocking:=v_kind in('blocking','blockingOrders','blockingVariants');
 v_category:=nullif(p_request->>'category','');v_reason:=nullif(p_request->>'reasonKey','');v_operator:=nullif(p_request->>'operatorKey','');v_query:=nullif(btrim(p_request->>'query'),'');
 foreach v_key in array array[v_category,v_reason,v_operator] loop
  if v_key is not null and v_key !~ '^[0-9a-f]{32}$' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if v_country is null or v_platform is null or v_kind not in('blocking','blockingOrders','blockingVariants','categories','rejection','operators','orders')
  or (v_kind='blocking' and (v_category is not null or v_reason is not null or v_operator is not null or v_query is not null))
  or (v_kind in('blockingOrders','blockingVariants') and (v_reason is null or v_category is not null or v_operator is not null))
  or (v_kind='blockingVariants' and v_query is not null)
  or v_offset>1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 if not private.dashboard_scope_allows(v_scope,v_country,v_platform) then raise exception using errcode='42501',message='scope_denied';end if;
 -- wg_existing_reasons_v1: existing request validation and scope checks ran above.
 v_rows:=private.dashboard_admin_wg_withdraw_reasons(p_request,v_scope);
 if v_rows is not null then return v_rows;end if;
 select * into v_meta from private.dashboard_admin_live_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
     or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform)) order by p.source limit 1;
 -- Report-only metadata is resolved by the existing freshly scoped directory.
 -- Keep native AR precedence and the source-country identity used by snapshots.
 if not found then
  select * into v_meta from private.dashboard_admin_live_withdraw_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
    or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform))
   and (v_country<>'胖虎巴西' or p.scope_group='BR_PANGHU')
   order by p.source,p.id limit 1;
 end if;
 v_code:=coalesce(v_meta.scope_group,(select country_code from public.dashboard_platform_team_map m where m.country_name=v_country and m.active limit 1));
 if v_code is null then raise exception using errcode='22023',message='platform_denied';end if;
 v_aliases:=array[v_platform,v_meta.name,v_meta.source_name];
 v_ar_raw_only:=v_meta.source='ar' and v_date>=DATE '2026-10-10' and exists(
  select 1 from (values
  ('BR','POP555'),('BR','POP678'),('BR','POP888'),('BR','POPBEM'),('BR','POPBRA'),('BR','POPCEU'),('BR','POPLUA'),('BR','POPPG'),
  ('ID','55FIVE'),
  ('IN','51GAME'),('IN','55CLUB'),('IN','6CLUB'),('IN','82LOTTERY'),('IN','91CLUB'),('IN','BIGMUMBAI'),('IN','IN999'),
  ('IN','JAICLUB'),('IN','JALWA'),('IN','LOTTERY7'),('IN','OKWIN'),('IN','RAJA'),('IN','SHREEWIN'),('IN','TPPLAY'),('IN','Veer.Game'),
  ('MM','6LOTTERY'),('MY','MZPLAY'),('NG','FB999'),
  ('PK','92.GAME'),('PK','92COCO'),('PK','92DADU'),('PK','92GLORY'),('PK','92GO'),('PK','92PKR'),('PK','92R'),('PK','92STAR'),('PK','92STRIKE'),('PK','YAYWIN'),
  ('VN','66CLUB'),('VN','82VN'),('VN','92LOTTERY'),('VN','VN168')
  )s(code,name) where s.code=v_code and private.dashboard_admin_live_withdraw_key(s.name)=private.dashboard_admin_live_withdraw_key(v_meta.source_name));
 if not coalesce(v_ar_raw_only,false) then
 select total into v_expected from public.auto_withdraw_daily where (country=v_country or (v_country='胖虎巴西' and upper(country) in ('巴西','BR','BR_PANGHU','PANGHU BRAZIL'))) and data_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform) order by updated_at desc limit 1;
 end if;
 -- newar_received_blocking_v1: validated request and fresh scoped native metadata.
 v_rows:=private.dashboard_admin_newar_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
 if v_rows is not null then return v_rows;end if;
 -- yash_received_source_notes_v1: validated request and fresh scoped native metadata.
 if v_meta.source='kb' then
  v_rows:=private.dashboard_admin_yash_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 -- game66_received_source_notes_v1: request, scope and native identity were checked above.
 if v_meta.source='game66' then
  v_rows:=private.dashboard_admin_game66_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 if v_meta.source='ar' then
  with detail_generation as materialized (
   select CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure AND md5(p.prosrc)='393978c9146ae30019a87632d4d51998' AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prorettype='text'::regtype AND NOT p.proretset AND pg_get_function_arguments(p.oid)='' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')) THEN private.ar_withdraw_detail_evidence_generation() END id
  ), detail_evidence as materialized (
   select e.* from private.ar_withdraw_detail_operator_evidence e cross join detail_generation g
   where e.evidence_generation=g.id AND e.source_applied_at>=v_date::timestamp AND e.source_applied_at<(v_date+1)::timestamp
  ), source_orders as materialized (
   select case when v_kind in('orders','blockingOrders') or v_query is not null then a.order_no end order_no,
    case when v_kind in('orders','blockingOrders') then private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) end amount,
    case when v_kind in('orders','blockingOrders') then a.status end status,
    CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN e.manual_submit_actor ELSE nullif(btrim(a.operator),'') END operator,
    a.operator listing_operator,CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN 'detail_manual_submit' END detail_basis,
    case when v_kind in('orders','blockingOrders') then a.applied_at end applied_at,
    case when v_kind in('orders','blockingOrders') then a.completed_at end completed_at,
    nullif(btrim(a.manual_remark),'') manual_raw,case when not v_blocking or v_kind='blockingOrders' then case when v_blocking then nullif(btrim(a.remark),'') else a.remark end end rejection_raw,
    a.updated_at,
    case when v_date>=DATE '2026-10-10' and e.order_no is not null and btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' then 'manual' when v_date<DATE '2026-10-10' then case when nullif(regexp_replace(coalesce(a.operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(a.operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end else case when lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) IN('','----','---','--','-','null','none','n/a') then
     case when (position('未通过' IN coalesce(a.status,''))>0 OR position('驳回' IN coalesce(a.status,''))>0 OR position('拒绝' IN coalesce(a.status,''))>0 OR position('reject' IN lower(coalesce(a.status,'')))>0 OR position('failed' IN lower(coalesce(a.status,'')))>0) AND NOT (position('已通过' IN coalesce(a.status,''))>0 OR position('已提交' IN coalesce(a.status,''))>0 OR (position('通过' IN coalesce(a.status,''))>0 AND position('未通过' IN coalesce(a.status,''))=0) OR position('success' IN lower(coalesce(a.status,'')))>0 OR position('submitted' IN lower(coalesce(a.status,'')))>0 OR position('成功' IN coalesce(a.status,''))>0) then 'manual' else 'unknown' end
     when position('system' IN lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0 then 'system' else 'manual' end end blocking_operator_class,
    case when a.status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (a.status in('失败','提现失败','出款失败') and coalesce(btrim(a.raw_channel),'') in ('','人工取消')) then 'rejected' when a.status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders a left join detail_evidence e ON
    (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at)
   where a.source_system='AR' and a.country_code=v_code and a.platform=any(v_aliases) and a.order_kind='withdraw'
     and a.applied_at>=v_date::timestamp and a.applied_at<(v_date+1)::timestamp
  ), note_values as materialized (
   select distinct coalesce(manual_raw,'') raw_note from source_orders
   where v_blocking and blocking_operator_class='manual'
  ), note_flags as materialized (
   select raw_note,private.dashboard_admin_live_clean_note(raw_note) normalized_note from note_values
  ), orders as materialized (
   select o.*,f.normalized_note from source_orders o left join note_flags f on f.raw_note=coalesce(o.manual_raw,'')
  ), blocking_stats as (
   select count(*)::bigint raw,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown
   from orders where manual_raw ~ '[^[:space:]]'
  ), operator_stats as (
   select count(*)::bigint total,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown,
    count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
    count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason"
   from orders
  ), candidates as materialized (
   select * from orders where (v_blocking and blocking_operator_class='manual') or (not v_blocking and status_group='rejected')
  ), distinct_reasons as materialized (
   -- Reuse the normalization already computed once per distinct manual note.
   -- Rejection-only requests never normalize successful/system manual notes.
   select distinct coalesce(case when v_blocking then manual_raw else rejection_raw end,'') raw_note,
    case when v_blocking then normalized_note end normalized_note from candidates
  ), normalized_reasons as materialized (
   select raw_note,case when v_blocking then normalized_note else private.dashboard_admin_live_rejection_exact_note(raw_note) end clean_note
   from distinct_reasons
  ), cleaned as materialized (
   select raw_note,case when v_blocking and not coalesce(clean_note ~ '[^[:space:]]',false) then null else clean_note end clean_note,
    case when v_blocking then case when clean_note ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(clean_note)
     else jsonb_build_object('reason','检测没备注') end end blocking_details
   from normalized_reasons
  ), classified as materialized (
   select raw_note,clean_note,blocking_details,case when v_blocking then blocking_details->>'reason' else clean_note end group_note,
    case when not v_blocking then coalesce(clean_note,'（源备注为空）') end category from cleaned
  ), notes as materialized (
   select o.order_no,o.amount,o.status,o.operator,o.applied_at,o.completed_at,o.listing_operator,o.detail_basis,
    case when v_kind in('orders','blockingOrders') then o.manual_raw end manual_raw,
    case when v_kind in('orders','blockingOrders') then o.rejection_raw end rejection_raw,
    case when v_kind in('orders','blockingOrders') then o.normalized_note end normalized_note,
    o.status_group,
    case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,c.blocking_details,
    case when v_blocking then md5(c.group_note) else private.dashboard_admin_live_rejection_exact_key(c.clean_note) end note_key,
    case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(c.clean_note) end category_key
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as materialized (
   select * from notes where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,note_key as "reasonKey",count(*)::bigint as count,min(source_note) as "sourceReason",count(distinct source_note)::bigint as "sourceVariantCount",
    count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note,note_key
  ), variant_groups as (
   select source_note as reason,source_note as "sourceReason",note as "canonicalReason",note_key as "reasonKey",count(*)::bigint count,
    count(*) filter(where status_group='success')::bigint success,count(*) filter(where status_group='rejected')::bigint rejected,count(*) filter(where status_group='other')::bigint other
   from selected_notes group by note,source_note,note_key
  ), category_groups as (
   select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
    count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from selected_notes group by category,category_key
  ), operator_groups as (
   select operator,md5(coalesce(operator,'')) "operatorKey",count(*)::bigint count,
    count(distinct category_key)::bigint "categoryCount",count(*) filter(where not v_blocking and rejection_note is null)::bigint "missingReasonCount"
   from selected_notes group by operator
  ), rendered as materialized (
   select to_jsonb(g) item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.reason,null::timestamp from variant_groups g where v_kind='blockingVariants'
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',case when v_blocking then normalized_note else private.dashboard_admin_live_clean_note(manual_raw) end,
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',category_key,'reasonKey',note_key,
    'blockingReason',case when v_blocking then note end,
    'blockingActualValue',case when v_blocking then blocking_details->>'actualValue' end,
    'blockingActualField',case when v_blocking then blocking_details->>'actualField' end,
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end)||CASE WHEN detail_basis IS NOT NULL THEN jsonb_build_object('listingOperator',listing_operator,'operatorClassificationBasis',detail_basis) ELSE '{}'::jsonb END,0,order_no,applied_at
   from selected_notes where v_kind in('orders','blockingOrders')
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select case when v_blocking then (select manual from operator_stats) else raw end from blocking_stats),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset v_offset limit v_limit)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
      count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from notes group by category,category_key)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where not v_blocking and rejection_note is null),
    'withOperator',(select count(*) from notes where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',(select count(*) from selected_notes))
     ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis',case when v_date>=DATE '2026-10-10' then 'ar_operator_rejected_or_verified_detail_manual_submit' else 'current_operator' end) else '{}'::jsonb end
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_blocking then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_blocking then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',case when v_ar_raw_only then null else v_expected end,'complete',case when v_ar_raw_only then false else v_count=v_expected end,'rejected',v_rejected,'withManualRemark',case when v_blocking then (v_summary->'operatorCounts'->>'manualWithReason')::bigint else v_noted end),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;end if;
  if v_ar_raw_only then
   -- Absence of received facts is not proof of zero; do not resurrect old reports.
   return jsonb_build_object('available',false,'source','AR 已采集订单','country',v_country,'platform',v_platform,
    'date',v_date,'kind',v_kind,'rows','[]'::jsonb,'total',0,'offset',v_offset,'limit',v_limit,
    'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
    'coverage',jsonb_build_object('collected',0,'expected',null,'complete',false,'state','no_received_facts'),
    'updatedAt',null,'latestSnapshotDate',null,'snapshotFallback',false,
    'message','所选日期尚无已入库提现明细；不能认定为零笔或已完整采集');
  end if;
 end if;
 select max(stat_date) into v_latest from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform);
 select * into v_snapshot from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and stat_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 -- Rejection snapshots retain the complete source reason_label. A semantic grouped
 -- view cannot prove which original text a caller selected.
 if v_blocking and v_snapshot.source_system='PANDA' then
  select snapshot into v_grouped_snapshot from public.withdraw_reasons_daily_grouped where country_code=v_snapshot.country_code and platform=v_snapshot.platform and stat_date=v_date and source_system=v_snapshot.source_system
   and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 end if;
 if v_snapshot.platform is null or v_kind in('orders','operators','blockingOrders') or v_operator is not null or v_query is not null
   or (v_snapshot.source_system='NEWAR' and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (not v_blocking and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (v_blocking and v_snapshot.snapshot->>'note_field'='remark') then
  return jsonb_build_object('available',false,'rows','[]'::jsonb,'total',0,'date',v_date,'kind',v_kind,'latestSnapshotDate',v_latest,
   'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
   'message',case when v_kind='blockingOrders' then '当前来源只有原因汇总，可查看全部原文及笔数；没有逐笔订单编号' when v_kind in('orders','operators') then '当前来源尚未采集逐笔驳回备注及对应操作人，只有原因汇总时不能还原订单详情'
    when not v_blocking then '当前来源尚未单独采集驳回订单的备注字段' else '所选日期尚无自动出款拦截原因采集记录' end);
 end if;
 with source_groups as materialized (
  -- Empty categories are included only when the snapshot explicitly records a manual group.
  -- Missing groups cannot be inferred from a source total or a different operator class.
  select g,case when v_blocking and g->>'operator_class'='manual' and g->>'classification' is distinct from 'empty'
   then case when g->>'classification'='truncated' then private.dashboard_admin_live_clean_note(g->>'reason_label')
    else private.dashboard_admin_live_blocking_category(g->>'reason_label') end end raw_category
  from jsonb_array_elements(v_snapshot.snapshot->'groups')g
 ), blocking_stats as (
  select coalesce(sum((g->>'count')::bigint),0)::bigint raw,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='manual'),0)::bigint manual,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='auto'),0)::bigint system,
   coalesce(sum((g->>'count')::bigint) filter(where coalesce(g->>'operator_class','unknown') not in('manual','auto')),0)::bigint unknown
  from source_groups where g->>'classification' is distinct from 'empty' and private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]'
 ), base_original_groups as materialized (
  select case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then null
    when not v_blocking then case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end
    else private.dashboard_admin_live_clean_note(g->>'reason_label') end source_reason,
   case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then '检测没备注'
    when v_blocking then raw_category
    else coalesce(case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end,'（源备注为空）') end reason,
   case when not v_blocking then coalesce(case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end,'（源备注为空）') end category,
   sum(case when not v_blocking then (g->>'reject')::bigint else (g->>'count')::bigint end)::bigint count,
   sum((g->>'success')::bigint)::bigint success,sum((g->>'reject')::bigint)::bigint rejected,sum((g->>'other')::bigint)::bigint other
  from source_groups
  where (not v_blocking and (g->>'reject')::bigint>0) or (v_blocking and g->>'operator_class'='manual') group by 1,2,3
 ), original_groups as materialized (
  select b.*,case when v_blocking then md5(reason) else private.dashboard_admin_live_rejection_exact_key(source_reason) end note_key,
   case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(source_reason) end category_key
  from base_original_groups b
 ), selected_groups as materialized (
  select * from original_groups where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
 ), rendered as (
  select jsonb_build_object('category',category,'categoryKey',category_key,'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint) item,sum(count) count,category label
   from selected_groups where v_kind='categories' group by category,category_key
  union all select jsonb_build_object('reason',reason,'reasonKey',note_key,'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint,
    'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint) item,sum(count),reason
   from selected_groups g where v_kind in('blocking','rejection') group by reason,note_key
  union all select jsonb_build_object('reason',source_reason,'sourceReason',source_reason,'canonicalReason',reason,'reasonKey',note_key,
    'count',sum(count)::bigint,'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint),sum(count),source_reason
   from selected_groups where v_kind='blockingVariants' group by source_reason,reason,note_key
 ) select (select count(*) from rendered),
  coalesce((select jsonb_agg(item order by count desc,label) from (select * from rendered order by count desc,label offset v_offset limit v_limit)p),'[]'::jsonb),
  (select coalesce(sum(count),0) from original_groups),
  coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
   (select category,category_key "categoryKey",sum(count)::bigint count,min(source_reason) as "sourceReason",
     count(distinct source_reason)::bigint as "sourceVariantCount" from original_groups group by category,category_key)g),'[]'::jsonb),
  jsonb_build_object('totalRejected',v_snapshot.snapshot->'totals'->'reject','selectedCount',(select coalesce(sum(count),0) from selected_groups))
   ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),
    -- Reason snapshots do not prove the complete operator universe. Never infer totals from note groups.
    'operatorCounts',jsonb_build_object('total',null,'manual',null,'system',null,'unknown',null,
      'manualWithReason',(select manual from blocking_stats),'manualWithoutReason',
       (select sum((g->>'count')::bigint) from source_groups where g->>'operator_class'='manual'
        and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)))),'operatorBasis','snapshot_classification') else '{}'::jsonb end
 into v_total,v_rows,v_noted,v_categories,v_summary;
 return jsonb_build_object('available',true,'source',v_snapshot.source_system||' 原因采集快照','basis',coalesce(v_snapshot.snapshot->>'note_field','source_note'),
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'rows',v_rows,'total',v_total,'offset',v_offset,'limit',v_limit,
  'noteCount',case when v_blocking then v_noted else coalesce((v_snapshot.snapshot->'totals'->>'reject')::bigint,v_noted) end,
  'categories',v_categories,'summary',v_summary,'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
  'coverage',v_snapshot.snapshot->'coverage','updatedAt',v_snapshot.updated_at,'latestSnapshotDate',v_latest)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;
end;
$function$
;$patch_dashboard_admin_live_withdraw_reasons$; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.ar_historical_duration_generation()'::regprocedure)<>'6ad649935379e96fae90ea7659be7b1c' THEN EXECUTE $patch_ar_historical_duration_generation$CREATE OR REPLACE FUNCTION private.ar_historical_duration_generation()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when count(*)=4 and bool_and(t.tgenabled='O' and t.tgfoid='private.invalidate_ar_historical_duration_cache()'::regprocedure)
  and bool_and(md5(pg_get_triggerdef(t.oid))=case t.tgname when 'ar_historical_duration_insert' then '7759e8593839433f70fa4db5cb685e56' when 'ar_historical_duration_delete' then '19cbae393493bbb34acc0fbc002ed9b3' when 'ar_historical_duration_update' then 'e7d54f457601aa92e955fc3b90ba5e8a' when 'ar_historical_duration_truncate' then 'e7fc978a9f501ca4eb10553c23cefad0' end)
  and bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}' and md5(p.prosrc)='d9542829c2bb82345f27d5b00080d7c0')
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration(text,date)'::regprocedure
   and md5(z.prosrc)='bc6b303925ab3eda045c3f3725220c89' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure
   and md5(z.prosrc) IN('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471','1bfc6398524bc3194b91f1d411960425','3645bf1a24efd1ae7b89897616172fa5') and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='s'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_cache'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_cache_write_guard' then 31 when 'ar_historical_duration_cache_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_cache'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.guard_ar_historical_duration_cache_write()'::regprocedure
   and md5(z.prosrc)='04489bed3f818d1c75e8d0a0c73eef64' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_hour_parts'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_hour_write_guard' then 31 when 'ar_historical_duration_hour_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_hour_parts'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure
   and md5(z.prosrc)='d8fc73594da699c74c13afddd8d9ed70' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure
   and md5(z.prosrc)='17811807bf452cd1675d7ce54487c145' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  then md5('ar_native_historical_duration_v2:d8fc73594da699c74c13afddd8d9ed70:17811807bf452cd1675d7ce54487c145:d9542829c2bb82345f27d5b00080d7c0:bc6b303925ab3eda045c3f3725220c89:04489bed3f818d1c75e8d0a0c73eef64:3e7e5666a6e7b869a02513221597da1a:'||(select string_agg(x.oid::text||':'||x.xmin::text||':'||pg_get_triggerdef(x.oid),',' order by x.tgname)
   from pg_trigger x where x.tgrelid=any(array['private.ar_historical_duration_cache'::regclass,'private.ar_historical_duration_hour_parts'::regclass]) and not x.tgisinternal)||':'||string_agg(t.oid::text||':'||t.xmin::text||':'||pg_get_triggerdef(t.oid),',' order by t.tgname)) end
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal
  and t.tgname in('ar_historical_duration_insert','ar_historical_duration_update','ar_historical_duration_delete','ar_historical_duration_truncate');
$function$
;$patch_ar_historical_duration_generation$; END IF;
 IF (SELECT jsonb_agg(to_jsonb(z)-'prosrc' ORDER BY oid) FROM pg_proc z WHERE z.oid=ANY(ARRAY['private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure,'private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.ar_historical_duration_generation()'::regprocedure,'private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp,timestamp,timestamptz,timestamptz)'::regprocedure,'private.sync_ar_withdraw_fact()'::regprocedure,'private.ar_withdraw_fact_generation()'::regprocedure,'public.publish_ar_collected_orders(text,jsonb)'::regprocedure])) IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'AR_DETAIL_METADATA_CHANGED'; END IF;
 IF private.ar_withdraw_fact_generation() IS DISTINCT FROM old_fact_generation OR private.ar_historical_duration_generation() IS DISTINCT FROM old_duration_generation THEN RAISE EXCEPTION 'AR_DETAIL_EXISTING_GENERATION_CHANGED'; END IF;
END;
$install_detail$;
COMMIT;
