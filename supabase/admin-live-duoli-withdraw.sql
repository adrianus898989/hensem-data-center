-- DUOLI native operational statistics and Game66 received-note capability.
-- Known fields only. No source/state/collector writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
DECLARE p record;h record;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 IF p.oid IS NULL OR md5(p.prosrc) NOT IN('564e9a0b7d4b9585d7d254b973f7c67d','58e087fc9d04dec9256899b442ad22ad')
  OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'s'
  OR p.proretset OR p.prorettype<>'jsonb'::regtype OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof
  OR p.proargnames IS DISTINCT FROM ARRAY['p_request']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 THEN RAISE EXCEPTION 'DUOLI_WITHDRAW_MAIN_DRIFT';END IF;
 SELECT * INTO h FROM pg_proc WHERE oid=to_regprocedure('private.dashboard_admin_duoli_status(text,text)');
 IF h.oid IS NULL OR md5(h.prosrc)<>'2c6e11c93ba7fc233cedc67378f1196d' OR h.prosecdef OR h.provolatile<>'i'
  OR pg_get_userbyid(h.proowner)<>'postgres' OR h.proretset OR h.prorettype<>'text'::regtype OR h.prokind<>'f' OR h.proisstrict OR h.proleakproof
  OR h.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR h.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
 THEN RAISE EXCEPTION 'DUOLI_WITHDRAW_STATUS_DRIFT';END IF;
 SELECT * INTO h FROM pg_proc WHERE oid=to_regprocedure('private.dashboard_admin_duoli_withdraw_days(jsonb,jsonb,date,date)');
 IF h.oid IS NOT NULL AND (md5(h.prosrc)<>'92829c8f54066d6a5caf350f3255dbb8' OR h.prosecdef OR h.provolatile<>'s'
  OR pg_get_userbyid(h.proowner)<>'postgres' OR NOT h.proretset OR h.prorettype<>'record'::regtype OR h.prokind<>'f' OR h.proisstrict OR h.proleakproof
  OR h.proargnames IS DISTINCT FROM ARRAY['p_request','p_scope','p_start','p_end','data_date','country','platform','platform_key','total','success','rejected','pending_count','unknown_count','avg_seconds','duration_sample_count','duration_total_seconds','source_updated_at','updated_at','operator_rows']::text[]
  OR h.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR h.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN RAISE EXCEPTION 'DUOLI_WITHDRAW_HELPER_DRIFT';END IF;
END;$guard$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_duoli_withdraw_days(p_request jsonb,p_scope jsonb,p_start date,p_end date)
RETURNS TABLE(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
 pending_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
 source_updated_at timestamptz,updated_at timestamptz,operator_rows jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $duoli_days$
 WITH targets AS MATERIALIZED (
  SELECT DISTINCT p.country,p.name AS platform,p.source_name,p.timezone
  FROM private.dashboard_admin_live_platforms() p
  WHERE p.source='duoli' AND p.scope_group='ID' AND p.timezone='Asia/Jakarta'
   AND private.dashboard_scope_allows(p_scope,'ID',p.source_name)
   AND (CASE WHEN p_request ? 'scopeTargets' THEN EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_request->'scopeTargets') t WHERE t->>'country'=p.country
     AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(t->'platforms') x
      WHERE private.dashboard_admin_live_withdraw_key(x) IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name))))
    ELSE p_request->>'country'=p.country END)
   AND (nullif(p_request->>'platform','') IS NULL OR private.dashboard_admin_live_withdraw_key(p_request->>'platform') IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name)))
   AND (NOT p_request ? 'platforms' OR jsonb_array_length(p_request->'platforms')=0 OR nullif(p_request->>'platform','') IS NOT NULL
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_request->'platforms') x
     WHERE private.dashboard_admin_live_withdraw_key(x) IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name))))
 ), facts AS MATERIALIZED (
  SELECT t.country,t.platform,(d.created_at AT TIME ZONE t.timezone)::date AS data_date,
   private.dashboard_admin_duoli_status('withdraw',d.status_code) AS status_group,
   coalesce(nullif(btrim(d.operator),''),'（未知操作人）') AS account,
   -- This is the source audit duration, never a payment success timestamp.
   CASE WHEN d.audit_duration_seconds>=0 AND d.audit_completed_at>=d.created_at
    AND d.audit_completed_at<=d.observed_at THEN d.audit_duration_seconds::numeric END AS seconds,
   d.observed_at,d.received_at
  FROM targets t CROSS JOIN LATERAL (
   SELECT d.created_at,d.status_code,d.operator,d.audit_completed_at,d.audit_duration_seconds,d.observed_at,d.received_at
   FROM private.duoli_order_details d
   WHERE d.platform=t.source_name AND d.business='withdraw' AND d.country='ID' AND d.system_name='DOLI'
    AND d.created_at>=p_start::timestamp AT TIME ZONE t.timezone
    AND d.created_at<(p_end+1)::timestamp AT TIME ZONE t.timezone OFFSET 0
  ) d
 ), operators AS (
  SELECT f.country,f.platform,f.data_date,f.account,count(*) AS processed,
   count(*) FILTER(WHERE f.status_group='success') AS success,count(*) FILTER(WHERE f.status_group='rejected') AS rejected,
   count(f.seconds) AS duration_sample_count,sum(f.seconds) AS duration_total_seconds,avg(f.seconds) AS avg_seconds,
   max(f.observed_at) AS source_updated_at,max(f.received_at) AS updated_at
  FROM facts f GROUP BY 1,2,3,4
 ), counts AS (
  SELECT f.country,f.platform,f.data_date,count(*) AS total,
   count(*) FILTER(WHERE f.status_group='success') AS success,count(*) FILTER(WHERE f.status_group='rejected') AS rejected,
   count(*) FILTER(WHERE f.status_group='pending') AS pending_count,count(*) FILTER(WHERE f.status_group='unknown') AS unknown_count,
   avg(f.seconds) AS avg_seconds,count(f.seconds) AS duration_sample_count,sum(f.seconds) AS duration_total_seconds,
   max(f.observed_at) AS source_updated_at,max(f.received_at) AS updated_at
  FROM facts f GROUP BY 1,2,3
 )
 SELECT s.day::date,t.country,t.platform,private.dashboard_admin_live_withdraw_key(t.platform),
  c.total,c.success,c.rejected,c.pending_count,c.unknown_count,c.avg_seconds,c.duration_sample_count,c.duration_total_seconds,
  c.source_updated_at,c.updated_at,
  coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.account) FROM operators o
   WHERE o.country=t.country AND o.platform=t.platform AND o.data_date=s.day::date),'[]'::jsonb)
 FROM targets t CROSS JOIN generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') s(day)
 LEFT JOIN counts c ON c.country=t.country AND c.platform=t.platform AND c.data_date=s.day::date;
$duoli_days$;
REVOKE ALL ON FUNCTION private.dashboard_admin_duoli_withdraw_days(jsonb,jsonb,date,date) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.dashboard_admin_duoli_withdraw_days(jsonb,jsonb,date,date) OWNER TO postgres;
DO $patch$
DECLARE p record;d text;before_meta jsonb;r record;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 IF md5(p.prosrc)='58e087fc9d04dec9256899b442ad22ad' THEN RETURN;END IF;
 FOR r IN SELECT * FROM (VALUES
 ($old0$v_ar_meta jsonb;$old0$,$new0$v_ar_meta jsonb;v_duoli_days jsonb;v_duoli_rows jsonb;v_duoli_item jsonb;v_duoli_meta jsonb;v_duoli_total bigint;v_duoli_period text;v_game_rows jsonb;v_game_item jsonb;$new0$,1),
 ($old1$ from private.dashboard_admin_ar_withdraw_days(p_request,v_scope,v_before,v_end) a;$old1$,$new1$ from private.dashboard_admin_ar_withdraw_days(p_request,v_scope,v_before,v_end) a;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into v_duoli_days
 from private.dashboard_admin_duoli_withdraw_days(p_request,v_scope,v_before,v_end) d;$new1$,1),
 ($old2$ ), ar_days as materialized ($old2$,$new2$ ), duoli_days as materialized (
  select * from jsonb_to_recordset(v_duoli_days)d(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,operator_rows jsonb)
 ), ar_days as materialized ($new2$,1),
 ($old3$and not exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)$old3$,$new3$and not exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)
   and not exists(select 1 from duoli_days d where d.country=p.country and d.platform_key=p.platform_key)$new3$,2),
 ($old4$ ), operator_source as not materialized ($old4$,$new4$  union all select data_date,country,platform,platform_key,total,success,rejected,null::bigint,null::bigint,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_reported_audit_duration'::text from duoli_days where total is not null
 ), operator_source as not materialized ($new4$,1),
 ($old5$ ), daily as materialized ($old5$,$new5$  union all select d.data_date,d.country,d.platform,d.platform_key,r->>'account',(r->>'processed')::bigint,(r->>'rejected')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   (r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'source_reported_audit_duration'::text,(r->>'success')::bigint
  from duoli_days d cross join lateral jsonb_array_elements(d.operator_rows) r
 ), daily as materialized ($new5$,1),
 ($old6$   case when exists(select 1 from ar_days a where a.country=p.country and a.platform_key=p.platform_key$old6$,$new6$   case when exists(select 1 from duoli_days d where d.country=p.country and d.platform_key=p.platform_key)
    then p.item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','unverified_source_continuity')
   when exists(select 1 from ar_days a where a.country=p.country and a.platform_key=p.platform_key$new6$,1),
 ($old7$ return v_result;
end;
$function$$old7$,$new7$ -- duoli_native_withdraw_v1: known source fields only; no auto/manual inference.
 if jsonb_array_length(v_duoli_days)>0 then
  v_duoli_meta:=jsonb_build_object('source','DUOLI','statisticBasis','created_at_current_status',
   'operatorBasis','source_operator','classificationAvailable',false,'classificationComparable',false,
   'reasonAvailable',false,'autoCount',null,'manualCount',null,'complete',false,
   'sourceCompletenessVerified',false,'coverageBasis','unverified_source_continuity',
   'durationBasis','source_reported_audit_duration','comparisonComparable',false,'comparisonBasis','unverified_source_continuity');
  v_result:=v_result||jsonb_build_object('source',v_result->>'source'||' + DUOLI native orders',
   'duoliCoverage',(select jsonb_build_object('source','DUOLI','timeBasis','created_at','operatorBasis','source_operator',
    'classificationAvailable',false,'complete',false,'currentComplete',false,'previousComplete',false,
    'coverageBasis','unverified_source_continuity','days',jsonb_agg(jsonb_build_object('date',d.data_date,
     'country',d.country,'platform',d.platform,'collected',d.total,'complete',false,
     'state',case when d.total is null then 'no_received_facts' else 'received_facts_unverified' end,
     'latestCollectedAt',d.updated_at) order by d.country,d.platform,d.data_date))
    from jsonb_to_recordset(v_duoli_days)d(data_date date,country text,platform text,total bigint,updated_at timestamptz)));
  v_result:=jsonb_set(v_result,'{comparison,complete}','false'::jsonb);
  v_duoli_rows:='[]'::jsonb;
  for v_duoli_item in select value from jsonb_array_elements(v_result->'rows') loop
   if exists(select 1 from jsonb_to_recordset(v_duoli_days)d(country text,platform_key text)
    where d.country=v_duoli_item->>'country' and d.platform_key=private.dashboard_admin_live_withdraw_key(v_duoli_item->>'platform')) then
    v_duoli_item:=v_duoli_item||v_duoli_meta||jsonb_build_object('unclassifiedCount',coalesce(v_duoli_item->'total',v_duoli_item->'processed'));
    if jsonb_typeof(v_duoli_item->'previous')='object' then
     v_duoli_item:=jsonb_set(v_duoli_item,'{previous}',(v_duoli_item->'previous')||v_duoli_meta||jsonb_build_object('unclassifiedCount',coalesce(v_duoli_item#>'{previous,total}',v_duoli_item#>'{previous,processed}')));
    end if;
   end if;
   v_duoli_rows:=v_duoli_rows||jsonb_build_array(v_duoli_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_duoli_rows);
  foreach v_duoli_period in array array['totals','previousTotals'] loop
   if jsonb_typeof(v_result->v_duoli_period)='object' then
    v_duoli_item:=(v_result->v_duoli_period)||jsonb_build_object('comparisonComparable',false,'comparisonBasis','unverified_source_continuity');
    if v_view='auto' then
     select sum(d.total)::bigint into v_duoli_total from jsonb_to_recordset(v_duoli_days)d(data_date date,total bigint)
      where case when v_duoli_period='totals' then d.data_date>=v_start else d.data_date<v_start end;
     if v_duoli_total is not null then
      v_duoli_item:=v_duoli_item||jsonb_build_object('classificationAvailable',false,'classificationComparable',false,
       'classificationPartial',coalesce((v_duoli_item->>'total')::bigint,0)>v_duoli_total,
       'unclassifiedCount',coalesce((v_duoli_item->>'unclassifiedCount')::bigint,0)+v_duoli_total);
     end if;
    end if;
    v_result:=jsonb_set(v_result,array[v_duoli_period],v_duoli_item);
   end if;
  end loop;
 end if;
 -- Game66 notes are separate received fields; capability does not claim notes exist.
 if jsonb_array_length(coalesce(v_game->'rows','[]'::jsonb))>0 then
  v_game_rows:='[]'::jsonb;
  for v_game_item in select value from jsonb_array_elements(v_result->'rows') loop
   if exists(select 1 from jsonb_array_elements(v_game->'rows') g
    where g->>'country'=v_game_item->>'country'
     and private.dashboard_admin_live_withdraw_key(g->>'platform')=private.dashboard_admin_live_withdraw_key(v_game_item->>'platform')) then
    v_game_item:=v_game_item||jsonb_build_object('reasonAvailable',true,'sourceNotesAvailable',true,'sourceNoteFormat','game66_withdraw_notes_v1');
   end if;
   v_game_rows:=v_game_rows||jsonb_build_array(v_game_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_game_rows);
 end if;
 return v_result;
end;
$function$$new7$,1)
 )x(old_text,new_text,n) LOOP
  IF (length(d)-length(replace(d,r.old_text,'')))/length(r.old_text)<>r.n THEN RAISE EXCEPTION 'DUOLI_WITHDRAW_ANCHOR_DRIFT';END IF;
  d:=replace(d,r.old_text,r.new_text);
 END LOOP;
 EXECUTE d;
 SELECT * INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(p.prosrc)<>'58e087fc9d04dec9256899b442ad22ad' OR to_jsonb(p)-'prosrc' IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'DUOLI_WITHDRAW_RESULT_DRIFT';END IF;
END;$patch$;
COMMIT;
