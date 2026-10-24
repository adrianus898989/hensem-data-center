-- Only derived source validity. Source transactions write at most once per
-- native/day/top-level transaction. No timestamp-only ingestion churn.
CREATE SEQUENCE private.submission_cohort_version_slots AS bigint;
CREATE TABLE private.submission_cohort_versions(
 source text NOT NULL,code text NOT NULL,platform text NOT NULL,day date NOT NULL,
 revision bigint NOT NULL CHECK(revision>=0),last_source_xid xid8,slot bigint NOT NULL,
 PRIMARY KEY(source,code,platform,day)
);
CREATE TABLE private.submission_cohort_version_state(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),installation uuid NOT NULL DEFAULT gen_random_uuid(),poisoned boolean NOT NULL DEFAULT false);
INSERT INTO private.submission_cohort_version_state(singleton)VALUES(true);
ALTER TABLE private.submission_cohort_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.submission_cohort_version_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.submission_cohort_versions,private.submission_cohort_version_state FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.submission_cohort_version_slots FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.submission_cohort_touch(s text,c text,p text,d date)RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $function$
DECLARE x xid8:=pg_current_xact_id();n bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM private.submission_cohort_version_state WHERE singleton AND poisoned)THEN RETURN;END IF;
 IF s IS NULL OR c IS NULL OR p IS NULL OR d IS NULL THEN s:='all';c:='';p:='';d:='-infinity'::date;END IF;
 SELECT revision INTO n FROM private.submission_cohort_versions WHERE(source,code,platform,day)=(s,c,p,d);
 IF FOUND THEN
  UPDATE private.submission_cohort_versions SET revision=CASE WHEN revision<9223372036854775807 THEN revision+1 ELSE revision END,last_source_xid=x
  WHERE(source,code,platform,day)=(s,c,p,d)AND last_source_xid IS DISTINCT FROM x RETURNING revision INTO n;
  IF n=9223372036854775807 THEN UPDATE private.submission_cohort_version_state SET poisoned=true WHERE singleton;END IF;
  RETURN;
 END IF;
 n:=nextval('private.submission_cohort_version_slots');
 IF n>65536 THEN UPDATE private.submission_cohort_version_state SET poisoned=true WHERE singleton;RETURN;END IF;
 INSERT INTO private.submission_cohort_versions VALUES(s,c,p,d,1,x,n)
 ON CONFLICT(source,code,platform,day)DO UPDATE SET revision=CASE WHEN private.submission_cohort_versions.revision<9223372036854775807 THEN private.submission_cohort_versions.revision+1 ELSE private.submission_cohort_versions.revision END,last_source_xid=x
 WHERE private.submission_cohort_versions.last_source_xid IS DISTINCT FROM x;
END;$function$;
CREATE FUNCTION private.submission_cohort_version(t jsonb,d date)RETURNS jsonb LANGUAGE sql STABLE SET search_path=''AS $function$
 WITH bounds AS(SELECT d::timestamp AT TIME ZONE(t->>'timezone')s,(d+1)::timestamp AT TIME ZONE(t->>'timezone')e),
 required AS(SELECT 'all'::text s,''::text c,''::text p,'-infinity'::date d UNION ALL
 SELECT t->>'source',CASE WHEN t->>'source'='ar'THEN t->>'scope_group'ELSE''END,t->>'source_name','-infinity'::date UNION ALL
 SELECT t->>'source',CASE WHEN t->>'source'='ar'THEN t->>'scope_group'ELSE''END,t->>'source_name',x::date
 FROM bounds b CROSS JOIN LATERAL generate_series(CASE WHEN t->>'source'='ar'THEN d ELSE(b.s AT TIME ZONE'UTC')::date END,
 CASE WHEN t->>'source'='ar'THEN d ELSE((b.e-interval'1microsecond')AT TIME ZONE'UTC')::date END,interval'1day')x),
 rows AS(SELECT r.*,coalesce(v.revision,0)revision,v.last_source_xid FROM required r LEFT JOIN private.submission_cohort_versions v ON(v.source,v.code,v.platform,v.day)=(r.s,r.c,r.p,r.d))
 SELECT CASE WHEN NOT vs.poisoned AND NOT EXISTS(SELECT 1 FROM rows WHERE last_source_xid=pg_current_xact_id_if_assigned())
 THEN jsonb_build_object('installation',vs.installation,'keys',(SELECT jsonb_agg(jsonb_build_array(s,c,p,d,revision)ORDER BY s COLLATE"C",c COLLATE"C",p COLLATE"C",d)FROM rows))END
 FROM private.submission_cohort_version_state vs WHERE singleton
$function$;
CREATE FUNCTION private.submission_cohort_dirty()RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''AS $function$
DECLARE q text;filtered text;r record;
BEGIN
 IF TG_OP='TRUNCATE'THEN PERFORM private.submission_cohort_touch(NULL,NULL,NULL,NULL);RETURN NULL;END IF;
 -- A transition statement is compared as a multiset. Irrelevant raw JSON,
 -- batch/observation timestamps, remarks and withdrawal rows do not dirty it.
 IF TG_TABLE_NAME='ar_collected_orders'THEN
  filtered:=$q$SELECT jsonb_build_array('ar',x.country_code,x.platform,x.order_no,x.member_id,x.applied_at,x.completed_at,x.status,x.raw_channel,x.member_level,x.recharge_count,x.channel_type,x.money_format_version,x.amount_local,x.currency_local,x.money_issue_code,x.amount)v FROM %s x WHERE x.source_system='AR'AND x.country_code='IN'AND x.order_kind='recharge'$q$;
 ELSIF TG_TABLE_NAME='newar_detail_records'THEN
  filtered:=$q$SELECT jsonb_build_array('newar','',x.platform,coalesce(nullif(x.order_number,''),x.source_id),x.member_id,x.created_at,x.success_at,x.status_group,x.provider,x.channel_type,x.currency,x.amount,x.status_code,x.raw->>'rechargeLevel',x.raw->>'memberLevel',x.raw->>'rechargeCount')v FROM %s x WHERE x.dataset='charge'$q$;
 ELSIF TG_TABLE_NAME='yash_orders'THEN
  filtered:=$q$SELECT jsonb_build_array('kb','','YASH.BET',x.order_no,x.uid,x.created_at,x.completed_at,x.status,x.supplier,x.channel,x.order_type,x.currency,x.amount)v FROM %s x WHERE x.source_site='yash'AND x.order_type='deposit'$q$;
 ELSIF TG_TABLE_NAME='yash_sync_windows'THEN
  filtered:=$q$SELECT jsonb_build_array('kb','','YASH.BET',to_jsonb(x)-ARRAY['observed_at','received_at'],x.observed_at)v FROM %s x WHERE x.order_type='deposit'$q$;
 ELSE RAISE EXCEPTION'submission_cohort_source_contract';END IF;
 IF TG_OP='INSERT'THEN q:=format(filtered,'new_rows');ELSIF TG_OP='DELETE'THEN q:=format(filtered,'old_rows');ELSE
  q:='('||format(filtered,'new_rows')||' EXCEPT ALL '||format(filtered,'old_rows')||')UNION ALL('||format(filtered,'old_rows')||' EXCEPT ALL '||format(filtered,'new_rows')||')';
 END IF;
 IF TG_TABLE_NAME IN('yash_orders','yash_sync_windows')THEN q:='WITH changed AS MATERIALIZED('||q||')SELECT DISTINCT v->>0 s,v->>1 c,v->>2 p,''-infinity''::date d FROM changed';
 ELSE
 q:='WITH changed AS MATERIALIZED('||q||'),keys AS(SELECT v->>0 s,v->>1 c,v->>2 p,CASE WHEN v->>0=''ar''THEN CASE WHEN isfinite((v->>5)::timestamp)THEN(v->>5)::timestamp::date ELSE''-infinity''::date END ELSE CASE WHEN isfinite((v->>5)::timestamptz)THEN((v->>5)::timestamptz AT TIME ZONE''UTC'')::date ELSE''-infinity''::date END END d FROM changed UNION SELECT v->>0,v->>1,v->>2,CASE WHEN v->>0=''ar''THEN(v->>6)::timestamp::date ELSE((v->>6)::timestamptz AT TIME ZONE''UTC'')::date END FROM changed WHERE v->>6 IS NOT NULL)SELECT s,c,p,d FROM(SELECT DISTINCT s,c,p,d FROM keys)u ORDER BY s COLLATE"C",c COLLATE"C",p COLLATE"C",d';
 END IF;
 FOR r IN EXECUTE q LOOP PERFORM private.submission_cohort_touch(r.s,r.c,r.p,r.d);END LOOP;
 RETURN NULL;
END;$function$;
CREATE TRIGGER submission_cohort_insert AFTER INSERT ON public.ar_collected_orders REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_update AFTER UPDATE ON public.ar_collected_orders REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_delete AFTER DELETE ON public.ar_collected_orders REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_truncate AFTER TRUNCATE ON public.ar_collected_orders FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_insert AFTER INSERT ON public.newar_detail_records REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_update AFTER UPDATE ON public.newar_detail_records REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_delete AFTER DELETE ON public.newar_detail_records REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_truncate AFTER TRUNCATE ON public.newar_detail_records FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
REVOKE ALL ON FUNCTION private.submission_cohort_touch(text,text,text,date),private.submission_cohort_version(jsonb,date),private.submission_cohort_dirty()FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER submission_cohort_insert AFTER INSERT ON private.yash_orders REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_update AFTER UPDATE ON private.yash_orders REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_delete AFTER DELETE ON private.yash_orders REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_truncate AFTER TRUNCATE ON private.yash_orders FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_insert AFTER INSERT ON private.yash_sync_windows REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_update AFTER UPDATE ON private.yash_sync_windows REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_delete AFTER DELETE ON private.yash_sync_windows REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();
CREATE TRIGGER submission_cohort_truncate AFTER TRUNCATE ON private.yash_sync_windows FOR EACH STATEMENT EXECUTE FUNCTION private.submission_cohort_dirty();

CREATE FUNCTION private.submission_cohort_hooks_current()RETURNS text LANGUAGE sql STABLE SET search_path=''AS $function$
 SELECT CASE WHEN count(*)=16 AND bool_and(t.tgenabled='O'AND NOT t.tgisinternal)
 THEN md5(string_agg(t.oid::text||':'||pg_get_triggerdef(t.oid)||':'||md5(pg_get_functiondef(p.oid)),','ORDER BY t.tgrelid,t.tgname COLLATE"C"))END
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE t.tgname IN('submission_cohort_insert','submission_cohort_update','submission_cohort_delete','submission_cohort_truncate')
 AND t.tgrelid IN('public.ar_collected_orders'::regclass,'public.newar_detail_records'::regclass,'private.yash_orders'::regclass,'private.yash_sync_windows'::regclass)
 AND p.oid='private.submission_cohort_dirty()'::regprocedure
$function$;
REVOKE ALL ON FUNCTION private.submission_cohort_hooks_current()FROM PUBLIC,anon,authenticated,service_role;
