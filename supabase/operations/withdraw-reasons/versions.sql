-- Private derived reason-source validity. No evidence-table trigger or existing function is changed.
-- Installed atomically with the parent feature. Never delete/reset version rows or sequence.
CREATE SEQUENCE private.withdraw_reason_version_slots AS bigint MAXVALUE 9223372036854775807;
CREATE TABLE private.withdraw_reason_version_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), installation uuid NOT NULL DEFAULT gen_random_uuid(), epoch bigint NOT NULL DEFAULT 1 CHECK(epoch>0), last_source_xid xid8,
 poisoned boolean NOT NULL DEFAULT false, armed boolean NOT NULL DEFAULT false, hooks text
);
INSERT INTO private.withdraw_reason_version_state(singleton) VALUES(true);
CREATE TABLE private.withdraw_reason_day_versions (
 source text NOT NULL CHECK(source IN('ar','newar','daily')), code text NOT NULL, platform text NOT NULL,
 day date NOT NULL CHECK(isfinite(day)), revision bigint NOT NULL CHECK(revision>=0), last_source_xid xid8,
 slot bigint NOT NULL UNIQUE CHECK(slot BETWEEN 1 AND 16384),
 PRIMARY KEY(source,code,platform,day)
);
ALTER TABLE private.withdraw_reason_version_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.withdraw_reason_day_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.withdraw_reason_version_state,private.withdraw_reason_day_versions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.withdraw_reason_version_slots FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.withdraw_reason_version_epoch(p_poison boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $fn$
BEGIN
 UPDATE private.withdraw_reason_version_state SET last_source_xid=pg_current_xact_id(),poisoned=poisoned OR p_poison OR epoch=9223372036854775807,
 epoch=CASE WHEN epoch<9223372036854775807 THEN epoch+1 ELSE epoch END WHERE singleton;
END $fn$;

CREATE FUNCTION private.withdraw_reason_version_touch(p_source text,p_code text,p_platform text,p_day date,p_dirty boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $fn$
DECLARE v_slot bigint; v_rev bigint; v_last xid8; v_xid xid8:=pg_current_xact_id_if_assigned();
BEGIN
 IF p_dirty AND v_xid IS NULL THEN v_xid:=pg_current_xact_id(); END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_reason_version_state WHERE singleton AND poisoned) THEN RETURN; END IF;
 IF p_source IS NULL OR p_source NOT IN('ar','newar','daily') OR p_code IS NULL OR p_platform IS NULL OR p_day IS NULL OR NOT isfinite(p_day) THEN
  PERFORM private.withdraw_reason_version_epoch(false); RETURN;
 END IF;
 SELECT revision,last_source_xid INTO v_rev,v_last FROM private.withdraw_reason_day_versions
 WHERE (source,code,platform,day)=(p_source,p_code,p_platform,p_day);
 IF FOUND THEN
  IF p_dirty AND v_last IS DISTINCT FROM v_xid THEN
   UPDATE private.withdraw_reason_day_versions SET last_source_xid=v_xid,revision=CASE WHEN revision<9223372036854775807 THEN revision+1 ELSE revision END
   WHERE (source,code,platform,day)=(p_source,p_code,p_platform,p_day) AND last_source_xid IS DISTINCT FROM v_xid RETURNING revision INTO v_rev;
   IF v_rev=9223372036854775807 THEN PERFORM private.withdraw_reason_version_epoch(true); END IF;
  END IF;
  RETURN;
 END IF;
 -- Nontransactional allocation bounds physical rows without a central capacity lock.
 -- A concurrent ON CONFLICT may consume a slot conservatively; it never reuses a slot.
 v_slot:=nextval('private.withdraw_reason_version_slots');
 IF v_slot>16384 THEN PERFORM private.withdraw_reason_version_epoch(true); RETURN; END IF;
 INSERT INTO private.withdraw_reason_day_versions(source,code,platform,day,revision,last_source_xid,slot)
 VALUES(p_source,p_code,p_platform,p_day,CASE WHEN p_dirty THEN 1 ELSE 0 END,CASE WHEN p_dirty THEN v_xid END,v_slot)
 ON CONFLICT(source,code,platform,day) DO UPDATE SET last_source_xid=CASE WHEN p_dirty THEN v_xid ELSE private.withdraw_reason_day_versions.last_source_xid END, revision=CASE WHEN p_dirty AND private.withdraw_reason_day_versions.revision<9223372036854775807 THEN private.withdraw_reason_day_versions.revision+1 ELSE private.withdraw_reason_day_versions.revision END WHERE NOT p_dirty OR private.withdraw_reason_day_versions.last_source_xid IS DISTINCT FROM v_xid RETURNING revision INTO v_rev;
 IF v_rev=9223372036854775807 THEN PERFORM private.withdraw_reason_version_epoch(true); END IF;
END $fn$;

CREATE FUNCTION private.withdraw_reason_hooks_fingerprint() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT CASE WHEN count(*)=24 AND bool_and(t.tgenabled='O' AND NOT t.tgisinternal)
 THEN md5(string_agg(t.oid::text||':'||t.xmin::text||':'||pg_get_triggerdef(t.oid)||':'||p.oid::text||':'||p.xmin::text||':'||md5(p.prosrc)||':'||(to_jsonb(p)-'oid'-'prosrc')::text,',' ORDER BY t.tgrelid,t.tgname)) END
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE t.tgname IN('reason_versions_insert','reason_versions_update','reason_versions_delete','reason_versions_truncate')
 AND t.tgrelid IN('public.ar_collected_orders'::regclass,'public.auto_withdraw_daily'::regclass,
 'public.newar_detail_records'::regclass,'private.newar_withdraw_facts'::regclass,
 'private.newar_withdraw_reason_facts'::regclass,'private.newar_detail_coverage_runs'::regclass)
$fn$;

CREATE FUNCTION private.withdraw_reason_versions_ensure(p_native jsonb,p_day date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $fn$
DECLARE s private.withdraw_reason_version_state%rowtype; cfg jsonb; evidence jsonb; aliases text[];
 v_code text; src text:=p_native->>'source'; v_plat text; k jsonb; keys jsonb:='[]'; v_start_at timestamptz; v_end_at timestamptz; d date;
BEGIN
 IF p_native IS NULL OR jsonb_typeof(p_native)<>'object' OR p_day IS NULL OR NOT isfinite(p_day)
 OR src IS NULL OR src NOT IN('ar','newar') OR jsonb_typeof(p_native->'aliases') IS DISTINCT FROM 'array' OR jsonb_array_length(p_native->'aliases') NOT BETWEEN 1 AND 3
 OR jsonb_typeof(p_native->'rawOnly') IS DISTINCT FROM 'boolean' OR coalesce(p_native->>'country','')='' OR coalesce(p_native->>'source_name','')=''
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_native->'aliases') a WHERE jsonb_typeof(a)<>'string' OR length(a#>>'{}')>200) THEN RETURN NULL; END IF;
 SELECT * INTO s FROM private.withdraw_reason_version_state WHERE singleton;
 IF s.last_source_xid=pg_current_xact_id_if_assigned() OR NOT s.armed OR s.poisoned OR s.hooks IS DISTINCT FROM private.withdraw_reason_hooks_fingerprint() THEN RETURN NULL; END IF;
 SELECT array_agg(DISTINCT a ORDER BY a) INTO aliases FROM jsonb_array_elements_text(p_native->'aliases') a;
 IF coalesce(p_native->>'timezone','')='' OR (p_day+1)::timestamp AT TIME ZONE (p_native->>'timezone')>statement_timestamp() THEN RETURN NULL; END IF;
 IF src='ar' THEN
  v_code:=p_native->>'scope_group'; IF coalesce(v_code,'')='' THEN RETURN NULL; END IF;
  FOR v_plat IN SELECT unnest(aliases) ORDER BY 1 LOOP
   PERFORM private.withdraw_reason_version_touch('ar',v_code,v_plat,p_day,false);
   SELECT to_jsonb(v)-'slot'-'last_source_xid' INTO k FROM private.withdraw_reason_day_versions v WHERE (source,v.code,platform,day)=('ar',v_code,v_plat,p_day) AND (pg_current_xact_id_if_assigned() IS NULL OR v.last_source_xid IS DISTINCT FROM pg_current_xact_id_if_assigned());
   IF k IS NULL THEN RETURN NULL; END IF; keys:=keys||jsonb_build_array(k);
  END LOOP;
  IF NOT (p_native->>'rawOnly')::boolean THEN
   -- Parent exact country/normalized platform scope; extra Panghu country variants are preserved.
   FOR v_code IN SELECT DISTINCT c FROM unnest(CASE WHEN p_native->>'country'='胖虎巴西'
    THEN ARRAY[p_native->>'country','巴西','BR','BR_PANGHU','PANGHU BRAZIL'] ELSE ARRAY[p_native->>'country'] END)c ORDER BY c LOOP
    v_plat:=private.dashboard_admin_live_withdraw_key(aliases[1]);
    -- All original aliases must normalize identically before expected-row reuse is admitted.
    IF EXISTS(SELECT 1 FROM unnest(aliases)a WHERE private.dashboard_admin_live_withdraw_key(a) IS DISTINCT FROM v_plat) THEN RETURN NULL; END IF;
    PERFORM private.withdraw_reason_version_touch('daily',upper(v_code),v_plat,p_day,false);
    SELECT to_jsonb(v)-'slot'-'last_source_xid' INTO k FROM private.withdraw_reason_day_versions v WHERE (source,v.code,platform,day)=('daily',upper(v_code),v_plat,p_day) AND (pg_current_xact_id_if_assigned() IS NULL OR v.last_source_xid IS DISTINCT FROM pg_current_xact_id_if_assigned());
    IF k IS NULL THEN RETURN NULL; END IF;keys:=keys||jsonb_build_array(k);
   END LOOP;
  END IF;
  SELECT jsonb_build_object('generation',private.ar_withdraw_detail_evidence_generation(),
   'fingerprint',md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)::text,'[]')))
  INTO evidence FROM private.ar_withdraw_detail_operator_evidence e WHERE e.source_system='AR' AND e.country_code=p_native->>'scope_group'
   AND e.platform=ANY(aliases) AND e.order_kind='withdraw' AND e.source_applied_at>=p_day::timestamp AND e.source_applied_at<(p_day+1)::timestamp;
 ELSE
  SELECT to_jsonb(n) INTO cfg FROM public.newar_detail_platforms n WHERE n.platform=p_native->>'source_name' AND n.enabled;
  IF cfg IS NULL OR cfg->>'country' IS DISTINCT FROM p_native->>'country' OR cfg->>'timezone' IS DISTINCT FROM p_native->>'timezone' THEN RETURN NULL; END IF;
  v_start_at:=p_day::timestamp AT TIME ZONE (cfg->>'timezone');v_end_at:=(p_day+1)::timestamp AT TIME ZONE (cfg->>'timezone');
  IF v_end_at>statement_timestamp() THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM private.newar_withdraw_facts f WHERE f.platform=p_native->>'source_name' AND f.created_at>=v_start_at AND f.created_at<v_end_at
   AND ((cfg->>'launch_at')::timestamptz IS NULL OR f.created_at>=(cfg->>'launch_at')::timestamptz) AND f.captured_at>statement_timestamp())
   OR EXISTS(SELECT 1 FROM private.newar_detail_coverage_runs c WHERE c.platform=p_native->>'source_name' AND c.dataset='withdraw' AND c.invalidated_at IS NULL
    AND c.effective_start_at<v_end_at AND c.end_at>v_start_at AND c.observed_at>statement_timestamp()) THEN RETURN NULL; END IF;
  FOR d IN SELECT generate_series((v_start_at AT TIME ZONE 'UTC')::date,((v_end_at-interval '1 microsecond') AT TIME ZONE 'UTC')::date,interval '1 day')::date LOOP
   PERFORM private.withdraw_reason_version_touch('newar','',p_native->>'source_name',d,false);
   SELECT to_jsonb(v)-'slot'-'last_source_xid' INTO k FROM private.withdraw_reason_day_versions v WHERE (source,v.code,platform,day)=('newar','',p_native->>'source_name',d) AND (pg_current_xact_id_if_assigned() IS NULL OR v.last_source_xid IS DISTINCT FROM pg_current_xact_id_if_assigned());
   IF k IS NULL THEN RETURN NULL; END IF;keys:=keys||jsonb_build_array(k);
  END LOOP;
 END IF;
 -- Any poison or global change while creating/reading the bounded key vector fails closed.
 IF NOT EXISTS(SELECT 1 FROM private.withdraw_reason_version_state WHERE singleton AND armed AND NOT poisoned AND epoch=s.epoch) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',1,'native',p_native,'day',p_day,'config',cfg,'installation',s.installation,'epoch',s.epoch,'keys',keys,'evidence',evidence);
END $fn$;

CREATE FUNCTION private.withdraw_reason_versions_match(p_vector jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path='' AS $fn$
DECLARE current_vector jsonb; state_epoch bigint; bad boolean;
BEGIN
 IF p_vector IS NULL OR p_vector->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(p_vector->'keys')<>'array' THEN RETURN false; END IF;
 current_vector:=private.withdraw_reason_versions_ensure(p_vector->'native',(p_vector->>'day')::date);
 IF current_vector IS NULL OR current_vector IS DISTINCT FROM p_vector THEN RETURN false; END IF;
 -- Optimistic verification only: no input/version row locks or source locks.
 -- A later source commit changes the immutable vector and makes the next hit miss.
 SELECT epoch,poisoned OR NOT armed OR coalesce(last_source_xid=pg_current_xact_id_if_assigned(),false) INTO state_epoch,bad FROM private.withdraw_reason_version_state WHERE singleton;
 RETURN NOT coalesce(bad,true) AND state_epoch::text IS NOT DISTINCT FROM p_vector->>'epoch';
END $fn$;

-- No existing trigger/function is replaced; evidence retains its exact two triggers.
CREATE FUNCTION private.withdraw_reason_dirty_ar_collected_orders() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q text; k record;
BEGIN
 IF TG_OP='TRUNCATE' THEN PERFORM private.withdraw_reason_version_epoch(false); RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.source_system,x.country_code,x.platform,x.order_kind,x.order_no,x.applied_at,x.status,x.operator,x.manual_remark,x.raw_channel,x.updated_at) v FROM new_rows x WHERE x.source_system='AR' AND x.order_kind='withdraw'), keys AS (SELECT 'ar'::text source,v->>1 code,v->>2 platform,CASE WHEN isfinite((v->>5)::timestamp) THEN (v->>5)::timestamp::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='DELETE' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.source_system,x.country_code,x.platform,x.order_kind,x.order_no,x.applied_at,x.status,x.operator,x.manual_remark,x.raw_channel,x.updated_at) v FROM old_rows x WHERE x.source_system='AR' AND x.order_kind='withdraw'), keys AS (SELECT 'ar'::text source,v->>1 code,v->>2 platform,CASE WHEN isfinite((v->>5)::timestamp) THEN (v->>5)::timestamp::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='UPDATE' THEN q:=$q$WITH changed AS MATERIALIZED ((SELECT jsonb_build_array(x.source_system,x.country_code,x.platform,x.order_kind,x.order_no,x.applied_at,x.status,x.operator,x.manual_remark,x.raw_channel,x.updated_at) v FROM old_rows x WHERE x.source_system='AR' AND x.order_kind='withdraw' EXCEPT ALL SELECT jsonb_build_array(x.source_system,x.country_code,x.platform,x.order_kind,x.order_no,x.applied_at,x.status,x.operator,x.manual_remark,x.raw_channel,x.updated_at) v FROM new_rows x WHERE x.source_system='AR' AND x.order_kind='withdraw') UNION ALL (SELECT jsonb_build_array(x.source_system,x.country_code,x.platform,x.order_kind,x.order_no,x.applied_at,x.status,x.operator,x.manual_remark,x.raw_channel,x.updated_at) v FROM new_rows x WHERE x.source_system='AR' AND x.order_kind='withdraw' EXCEPT ALL SELECT jsonb_build_array(x.source_system,x.country_code,x.platform,x.order_kind,x.order_no,x.applied_at,x.status,x.operator,x.manual_remark,x.raw_channel,x.updated_at) v FROM old_rows x WHERE x.source_system='AR' AND x.order_kind='withdraw')), keys AS (SELECT 'ar'::text source,v->>1 code,v->>2 platform,CASE WHEN isfinite((v->>5)::timestamp) THEN (v->>5)::timestamp::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 FOR k IN EXECUTE q LOOP
  PERFORM private.withdraw_reason_version_touch(k.source,k.code,k.platform,k.day,true);
 END LOOP; RETURN NULL;
END $fn$;
CREATE TRIGGER reason_versions_insert AFTER INSERT ON public.ar_collected_orders REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_ar_collected_orders();
CREATE TRIGGER reason_versions_update AFTER UPDATE ON public.ar_collected_orders REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_ar_collected_orders();
CREATE TRIGGER reason_versions_delete AFTER DELETE ON public.ar_collected_orders REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_ar_collected_orders();
CREATE TRIGGER reason_versions_truncate AFTER TRUNCATE ON public.ar_collected_orders  FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_ar_collected_orders();
CREATE FUNCTION private.withdraw_reason_dirty_auto_withdraw_daily() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q text; k record;
BEGIN
 IF TG_OP='TRUNCATE' THEN PERFORM private.withdraw_reason_version_epoch(false); RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.country,x.platform,x.data_date,x.total,x.updated_at,x.id) v FROM new_rows x WHERE true), keys AS (SELECT 'daily'::text source,upper(v->>0) code,private.dashboard_admin_live_withdraw_key(v->>1) platform,(v->>2)::date AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='DELETE' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.country,x.platform,x.data_date,x.total,x.updated_at,x.id) v FROM old_rows x WHERE true), keys AS (SELECT 'daily'::text source,upper(v->>0) code,private.dashboard_admin_live_withdraw_key(v->>1) platform,(v->>2)::date AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='UPDATE' THEN q:=$q$WITH changed AS MATERIALIZED ((SELECT jsonb_build_array(x.country,x.platform,x.data_date,x.total,x.updated_at,x.id) v FROM old_rows x WHERE true EXCEPT ALL SELECT jsonb_build_array(x.country,x.platform,x.data_date,x.total,x.updated_at,x.id) v FROM new_rows x WHERE true) UNION ALL (SELECT jsonb_build_array(x.country,x.platform,x.data_date,x.total,x.updated_at,x.id) v FROM new_rows x WHERE true EXCEPT ALL SELECT jsonb_build_array(x.country,x.platform,x.data_date,x.total,x.updated_at,x.id) v FROM old_rows x WHERE true)), keys AS (SELECT 'daily'::text source,upper(v->>0) code,private.dashboard_admin_live_withdraw_key(v->>1) platform,(v->>2)::date AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 FOR k IN EXECUTE q LOOP
  PERFORM private.withdraw_reason_version_touch(k.source,k.code,k.platform,k.day,true);
 END LOOP; RETURN NULL;
END $fn$;
CREATE TRIGGER reason_versions_insert AFTER INSERT ON public.auto_withdraw_daily REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_auto_withdraw_daily();
CREATE TRIGGER reason_versions_update AFTER UPDATE ON public.auto_withdraw_daily REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_auto_withdraw_daily();
CREATE TRIGGER reason_versions_delete AFTER DELETE ON public.auto_withdraw_daily REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_auto_withdraw_daily();
CREATE TRIGGER reason_versions_truncate AFTER TRUNCATE ON public.auto_withdraw_daily  FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_auto_withdraw_daily();
CREATE FUNCTION private.withdraw_reason_dirty_newar_detail_records() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q text; k record;
BEGIN
 IF TG_OP='TRUNCATE' THEN PERFORM private.withdraw_reason_version_epoch(false); RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.id,x.platform,x.dataset,x.created_at,x.raw->>'businessSchemaVersion',x.raw->>'automaticReasonSource',x.raw->'automaticReasonLabel') v FROM new_rows x WHERE x.dataset='withdraw'), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>3)::timestamptz) THEN ((v->>3)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='DELETE' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.id,x.platform,x.dataset,x.created_at,x.raw->>'businessSchemaVersion',x.raw->>'automaticReasonSource',x.raw->'automaticReasonLabel') v FROM old_rows x WHERE x.dataset='withdraw'), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>3)::timestamptz) THEN ((v->>3)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='UPDATE' THEN q:=$q$WITH changed AS MATERIALIZED ((SELECT jsonb_build_array(x.id,x.platform,x.dataset,x.created_at,x.raw->>'businessSchemaVersion',x.raw->>'automaticReasonSource',x.raw->'automaticReasonLabel') v FROM old_rows x WHERE x.dataset='withdraw' EXCEPT ALL SELECT jsonb_build_array(x.id,x.platform,x.dataset,x.created_at,x.raw->>'businessSchemaVersion',x.raw->>'automaticReasonSource',x.raw->'automaticReasonLabel') v FROM new_rows x WHERE x.dataset='withdraw') UNION ALL (SELECT jsonb_build_array(x.id,x.platform,x.dataset,x.created_at,x.raw->>'businessSchemaVersion',x.raw->>'automaticReasonSource',x.raw->'automaticReasonLabel') v FROM new_rows x WHERE x.dataset='withdraw' EXCEPT ALL SELECT jsonb_build_array(x.id,x.platform,x.dataset,x.created_at,x.raw->>'businessSchemaVersion',x.raw->>'automaticReasonSource',x.raw->'automaticReasonLabel') v FROM old_rows x WHERE x.dataset='withdraw')), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>3)::timestamptz) THEN ((v->>3)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 FOR k IN EXECUTE q LOOP
  PERFORM private.withdraw_reason_version_touch(k.source,k.code,k.platform,k.day,true);
 END LOOP; RETURN NULL;
END $fn$;
CREATE TRIGGER reason_versions_insert AFTER INSERT ON public.newar_detail_records REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_detail_records();
CREATE TRIGGER reason_versions_update AFTER UPDATE ON public.newar_detail_records REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_detail_records();
CREATE TRIGGER reason_versions_delete AFTER DELETE ON public.newar_detail_records REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_detail_records();
CREATE TRIGGER reason_versions_truncate AFTER TRUNCATE ON public.newar_detail_records  FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_detail_records();
CREATE FUNCTION private.withdraw_reason_dirty_newar_withdraw_facts() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q text; k record;
BEGIN
 IF TG_OP='TRUNCATE' THEN PERFORM private.withdraw_reason_version_epoch(false); RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.status_group,x.method,x.captured_at,x.received_at) v FROM new_rows x WHERE true), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>2)::timestamptz) THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='DELETE' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.status_group,x.method,x.captured_at,x.received_at) v FROM old_rows x WHERE true), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>2)::timestamptz) THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='UPDATE' THEN q:=$q$WITH changed AS MATERIALIZED ((SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.status_group,x.method,x.captured_at,x.received_at) v FROM old_rows x WHERE true EXCEPT ALL SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.status_group,x.method,x.captured_at,x.received_at) v FROM new_rows x WHERE true) UNION ALL (SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.status_group,x.method,x.captured_at,x.received_at) v FROM new_rows x WHERE true EXCEPT ALL SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.status_group,x.method,x.captured_at,x.received_at) v FROM old_rows x WHERE true)), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>2)::timestamptz) THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 FOR k IN EXECUTE q LOOP
  PERFORM private.withdraw_reason_version_touch(k.source,k.code,k.platform,k.day,true);
 END LOOP; RETURN NULL;
END $fn$;
CREATE TRIGGER reason_versions_insert AFTER INSERT ON private.newar_withdraw_facts REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_withdraw_facts();
CREATE TRIGGER reason_versions_update AFTER UPDATE ON private.newar_withdraw_facts REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_withdraw_facts();
CREATE TRIGGER reason_versions_delete AFTER DELETE ON private.newar_withdraw_facts REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_withdraw_facts();
CREATE TRIGGER reason_versions_truncate AFTER TRUNCATE ON private.newar_withdraw_facts  FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_withdraw_facts();
CREATE FUNCTION private.withdraw_reason_dirty_newar_withdraw_reason_facts() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q text; k record;
BEGIN
 IF TG_OP='TRUNCATE' THEN PERFORM private.withdraw_reason_version_epoch(false); RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.received_at,x.source_label) v FROM new_rows x WHERE true), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>2)::timestamptz) THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='DELETE' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.received_at,x.source_label) v FROM old_rows x WHERE true), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>2)::timestamptz) THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='UPDATE' THEN q:=$q$WITH changed AS MATERIALIZED ((SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.received_at,x.source_label) v FROM old_rows x WHERE true EXCEPT ALL SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.received_at,x.source_label) v FROM new_rows x WHERE true) UNION ALL (SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.received_at,x.source_label) v FROM new_rows x WHERE true EXCEPT ALL SELECT jsonb_build_array(x.record_id,x.platform,x.created_at,x.received_at,x.source_label) v FROM old_rows x WHERE true)), keys AS (SELECT 'newar'::text source,''::text code,v->>1 platform,CASE WHEN isfinite((v->>2)::timestamptz) THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END AS day FROM changed) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 FOR k IN EXECUTE q LOOP
  PERFORM private.withdraw_reason_version_touch(k.source,k.code,k.platform,k.day,true);
 END LOOP; RETURN NULL;
END $fn$;
CREATE TRIGGER reason_versions_insert AFTER INSERT ON private.newar_withdraw_reason_facts REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_withdraw_reason_facts();
CREATE TRIGGER reason_versions_update AFTER UPDATE ON private.newar_withdraw_reason_facts REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_withdraw_reason_facts();
CREATE TRIGGER reason_versions_delete AFTER DELETE ON private.newar_withdraw_reason_facts REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_withdraw_reason_facts();
CREATE TRIGGER reason_versions_truncate AFTER TRUNCATE ON private.newar_withdraw_reason_facts  FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_withdraw_reason_facts();
CREATE FUNCTION private.withdraw_reason_dirty_newar_detail_coverage_runs() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q text; k record;
BEGIN
 IF TG_OP='TRUNCATE' THEN PERFORM private.withdraw_reason_version_epoch(false); RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.platform,x.dataset,x.effective_start_at,x.end_at,x.observed_at,x.invalidated_at) v FROM new_rows x WHERE x.dataset='withdraw'), keys AS (SELECT 'newar'::text source,''::text code,v->>0 platform,g.day::date AS day FROM changed LEFT JOIN LATERAL generate_series(CASE WHEN isfinite((v->>2)::timestamptz) AND isfinite((v->>3)::timestamptz) AND (v->>3)::timestamptz>(v->>2)::timestamptz AND (v->>3)::timestamptz-(v->>2)::timestamptz<=interval '366 days' THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END, CASE WHEN isfinite((v->>2)::timestamptz) AND isfinite((v->>3)::timestamptz) AND (v->>3)::timestamptz>(v->>2)::timestamptz AND (v->>3)::timestamptz-(v->>2)::timestamptz<=interval '366 days' THEN (((v->>3)::timestamptz-interval '1 microsecond') AT TIME ZONE 'UTC')::date END,interval '1 day') g(day) ON true) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='DELETE' THEN q:=$q$WITH changed AS MATERIALIZED (SELECT jsonb_build_array(x.platform,x.dataset,x.effective_start_at,x.end_at,x.observed_at,x.invalidated_at) v FROM old_rows x WHERE x.dataset='withdraw'), keys AS (SELECT 'newar'::text source,''::text code,v->>0 platform,g.day::date AS day FROM changed LEFT JOIN LATERAL generate_series(CASE WHEN isfinite((v->>2)::timestamptz) AND isfinite((v->>3)::timestamptz) AND (v->>3)::timestamptz>(v->>2)::timestamptz AND (v->>3)::timestamptz-(v->>2)::timestamptz<=interval '366 days' THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END, CASE WHEN isfinite((v->>2)::timestamptz) AND isfinite((v->>3)::timestamptz) AND (v->>3)::timestamptz>(v->>2)::timestamptz AND (v->>3)::timestamptz-(v->>2)::timestamptz<=interval '366 days' THEN (((v->>3)::timestamptz-interval '1 microsecond') AT TIME ZONE 'UTC')::date END,interval '1 day') g(day) ON true) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 IF TG_OP='UPDATE' THEN q:=$q$WITH changed AS MATERIALIZED ((SELECT jsonb_build_array(x.platform,x.dataset,x.effective_start_at,x.end_at,x.observed_at,x.invalidated_at) v FROM old_rows x WHERE x.dataset='withdraw' EXCEPT ALL SELECT jsonb_build_array(x.platform,x.dataset,x.effective_start_at,x.end_at,x.observed_at,x.invalidated_at) v FROM new_rows x WHERE x.dataset='withdraw') UNION ALL (SELECT jsonb_build_array(x.platform,x.dataset,x.effective_start_at,x.end_at,x.observed_at,x.invalidated_at) v FROM new_rows x WHERE x.dataset='withdraw' EXCEPT ALL SELECT jsonb_build_array(x.platform,x.dataset,x.effective_start_at,x.end_at,x.observed_at,x.invalidated_at) v FROM old_rows x WHERE x.dataset='withdraw')), keys AS (SELECT 'newar'::text source,''::text code,v->>0 platform,g.day::date AS day FROM changed LEFT JOIN LATERAL generate_series(CASE WHEN isfinite((v->>2)::timestamptz) AND isfinite((v->>3)::timestamptz) AND (v->>3)::timestamptz>(v->>2)::timestamptz AND (v->>3)::timestamptz-(v->>2)::timestamptz<=interval '366 days' THEN ((v->>2)::timestamptz AT TIME ZONE 'UTC')::date END, CASE WHEN isfinite((v->>2)::timestamptz) AND isfinite((v->>3)::timestamptz) AND (v->>3)::timestamptz>(v->>2)::timestamptz AND (v->>3)::timestamptz-(v->>2)::timestamptz<=interval '366 days' THEN (((v->>3)::timestamptz-interval '1 microsecond') AT TIME ZONE 'UTC')::date END,interval '1 day') g(day) ON true) SELECT DISTINCT source,code,platform,day FROM keys ORDER BY source,code,platform,day$q$; END IF;
 FOR k IN EXECUTE q LOOP
  PERFORM private.withdraw_reason_version_touch(k.source,k.code,k.platform,k.day,true);
 END LOOP; RETURN NULL;
END $fn$;
CREATE TRIGGER reason_versions_insert AFTER INSERT ON private.newar_detail_coverage_runs REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_detail_coverage_runs();
CREATE TRIGGER reason_versions_update AFTER UPDATE ON private.newar_detail_coverage_runs REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_detail_coverage_runs();
CREATE TRIGGER reason_versions_delete AFTER DELETE ON private.newar_detail_coverage_runs REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_detail_coverage_runs();
CREATE TRIGGER reason_versions_truncate AFTER TRUNCATE ON private.newar_detail_coverage_runs  FOR EACH STATEMENT EXECUTE FUNCTION private.withdraw_reason_dirty_newar_detail_coverage_runs();

ALTER TABLE private.withdraw_reason_version_state OWNER TO postgres;
ALTER TABLE private.withdraw_reason_day_versions OWNER TO postgres;
ALTER SEQUENCE private.withdraw_reason_version_slots OWNER TO postgres;
-- Only after all twenty-four hooks exist and are enabled may any vector be current.
UPDATE private.withdraw_reason_version_state SET hooks=private.withdraw_reason_hooks_fingerprint(),armed=true WHERE singleton;
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.withdraw_reason_version_state WHERE singleton AND hooks IS NOT NULL)
 THEN RAISE EXCEPTION 'reason_version_hooks_incomplete'; END IF;
END $guard$;
ALTER FUNCTION private.withdraw_reason_version_epoch(boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_version_epoch(boolean) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_version_touch(text,text,text,date,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_version_touch(text,text,text,date,boolean) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_hooks_fingerprint() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_hooks_fingerprint() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_versions_ensure(jsonb,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_versions_ensure(jsonb,date) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_versions_match(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_versions_match(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_dirty_ar_collected_orders() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_dirty_ar_collected_orders() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_dirty_auto_withdraw_daily() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_dirty_auto_withdraw_daily() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_dirty_newar_detail_records() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_dirty_newar_detail_records() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_dirty_newar_withdraw_facts() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_dirty_newar_withdraw_facts() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_dirty_newar_withdraw_reason_facts() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_dirty_newar_withdraw_reason_facts() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.withdraw_reason_dirty_newar_detail_coverage_runs() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_reason_dirty_newar_detail_coverage_runs() FROM PUBLIC,anon,authenticated,service_role;
UPDATE private.withdraw_reason_version_state SET hooks=private.withdraw_reason_hooks_fingerprint() WHERE singleton;
