-- Restore the existing DUOLI collector's operator rule. No source, status or coverage writes.
-- Unknown placeholders stay unknown; reasons are explicitly not ingested.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='3s';
DO $duoli_operator_classification$
DECLARE m record;h record;s record;d text;r record;main_meta jsonb;helper_meta jsonb;
BEGIN
 SELECT * INTO m FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 IF m.oid IS NULL OR md5(m.prosrc) NOT IN('94cdc64949dff5d1a14ac680ee6c956b','0763d3ce7945b65e958615480fb46c2e')
  OR pg_get_userbyid(m.proowner)<>'postgres' OR NOT m.prosecdef OR m.provolatile<>'s'
  OR m.proretset OR m.prorettype<>'jsonb'::regtype OR m.prokind<>'f' OR m.proisstrict OR m.proleakproof
  OR m.proparallel<>'u' OR m.pronargs<>1 OR m.pronargdefaults<>1
  OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=m.prolang)<>'plpgsql'
  OR m.proargnames IS DISTINCT FROM ARRAY['p_request']::text[]
  OR pg_get_function_arguments(m.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb'
  OR m.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR m.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 THEN RAISE EXCEPTION 'DUOLI_OPERATOR_MAIN_DRIFT';END IF;
 SELECT * INTO h FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('private.dashboard_admin_duoli_withdraw_days(jsonb,jsonb,date,date)');
 IF h.oid IS NULL OR md5(h.prosrc) NOT IN('92829c8f54066d6a5caf350f3255dbb8','53ecaffec7eae57a4bec29334e43eda8')
  OR pg_get_userbyid(h.proowner)<>'postgres' OR h.prosecdef OR h.provolatile<>'s'
  OR NOT h.proretset OR h.prorettype<>'record'::regtype OR h.prokind<>'f' OR h.proisstrict OR h.proleakproof
  OR h.proparallel<>'u' OR h.pronargs<>4 OR h.pronargdefaults<>0
  OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=h.prolang)<>'sql'
  OR h.proargnames IS DISTINCT FROM ARRAY['p_request','p_scope','p_start','p_end','data_date','country','platform','platform_key','total','success','rejected','pending_count','unknown_count','avg_seconds','duration_sample_count','duration_total_seconds','source_updated_at','updated_at','operator_rows']::text[]
  OR pg_get_function_result(h.oid)<>'TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, pending_count bigint, unknown_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, operator_rows jsonb)'
  OR h.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR h.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
 THEN RAISE EXCEPTION 'DUOLI_OPERATOR_HELPER_DRIFT';END IF;
 SELECT * INTO s FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('private.dashboard_admin_duoli_status(text,text)');
 IF s.oid IS NULL OR md5(s.prosrc)<>'2c6e11c93ba7fc233cedc67378f1196d'
  OR pg_get_userbyid(s.proowner)<>'postgres' OR s.prosecdef OR s.provolatile<>'i'
  OR s.proretset OR s.prorettype<>'text'::regtype OR s.prokind<>'f' OR s.proisstrict OR s.proleakproof
  OR s.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR s.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
 THEN RAISE EXCEPTION 'DUOLI_OPERATOR_STATUS_DRIFT';END IF;
 IF (md5(m.prosrc)='0763d3ce7945b65e958615480fb46c2e') IS DISTINCT FROM (md5(h.prosrc)='53ecaffec7eae57a4bec29334e43eda8')
 THEN RAISE EXCEPTION 'DUOLI_OPERATOR_PAIR_DRIFT';END IF;
 IF md5(m.prosrc)='0763d3ce7945b65e958615480fb46c2e' THEN RETURN;END IF;
 main_meta:=to_jsonb(m)-'prosrc';helper_meta:=to_jsonb(h)-'prosrc';
 d:=pg_get_functiondef(h.oid);
 FOR r IN SELECT * FROM (VALUES
 ($oldh0$   coalesce(nullif(btrim(d.operator),''),'（未知操作人）') AS account,$oldh0$,$newh0$   coalesce(nullif(btrim(d.operator),''),'（未知操作人）') AS account,
   CASE WHEN lower(btrim(replace(replace(coalesce(d.operator,''),U&'\200B',''),U&'\FEFF',''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) IN('','----','---','--','-','null','none','n/a','0') THEN 'unknown'
    WHEN lower(btrim(replace(replace(coalesce(d.operator,''),U&'\200B',''),U&'\FEFF',''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'))='root' OR position('system' in lower(btrim(replace(replace(coalesce(d.operator,''),U&'\200B',''),U&'\FEFF',''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0 THEN 'auto' ELSE 'manual' END AS operator_class,$newh0$),
 ($oldh1$  SELECT f.country,f.platform,f.data_date,f.account,count(*) AS processed,$oldh1$,$newh1$  SELECT f.country,f.platform,f.data_date,f.account,count(*) AS processed,
   count(*) FILTER(WHERE f.operator_class='auto') AS auto_count,
   count(*) FILTER(WHERE f.operator_class='manual') AS manual_count,
   count(*) FILTER(WHERE f.operator_class='unknown') AS unclassified_count,
   CASE WHEN count(DISTINCT f.operator_class)=1 THEN min(f.operator_class) ELSE 'unknown' END AS operator_class,$newh1$)
 ) x(old_text,new_text) LOOP
  IF (length(d)-length(replace(d,r.old_text,'')))/length(r.old_text)<>1 THEN RAISE EXCEPTION 'DUOLI_OPERATOR_ANCHOR_DRIFT';END IF;
  d:=replace(d,r.old_text,r.new_text);
 END LOOP;
 EXECUTE d;
 SELECT * INTO h FROM pg_catalog.pg_proc WHERE oid='private.dashboard_admin_duoli_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 IF md5(h.prosrc)<>'53ecaffec7eae57a4bec29334e43eda8' OR to_jsonb(h)-'prosrc' IS DISTINCT FROM helper_meta
 THEN RAISE EXCEPTION 'DUOLI_OPERATOR_RESULT_DRIFT';END IF;
 d:=pg_get_functiondef(m.oid);
 FOR r IN SELECT * FROM (VALUES
 ($oldm0$ ), duoli_days as materialized (
  select * from jsonb_to_recordset(v_duoli_days)d(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,operator_rows jsonb)
 ), ar_days as materialized ($oldm0$,$newm0$ ), duoli_operator_classes as materialized (
  select d.data_date,d.country,d.platform_key,r->>'account' account,
   (r->>'auto_count')::bigint auto_count,(r->>'manual_count')::bigint manual_count,
   (r->>'unclassified_count')::bigint unclassified_count
  from jsonb_to_recordset(v_duoli_days)d(data_date date,country text,platform_key text,operator_rows jsonb)
   cross join lateral jsonb_array_elements(d.operator_rows)r
 ), duoli_days as materialized (
  select d.*,c.auto_count,c.manual_count
  from jsonb_to_recordset(v_duoli_days)d(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,operator_rows jsonb)
  left join (select data_date,country,platform_key,sum(auto_count)::bigint auto_count,sum(manual_count)::bigint manual_count
   from duoli_operator_classes group by 1,2,3)c using(data_date,country,platform_key)
 ), duoli_operator_class_group as materialized (
  select country,platform_key,account,case when v_daily then data_date else v_start end group_date,
   (data_date>=v_start) current_period,sum(auto_count)::bigint auto_count,sum(manual_count)::bigint manual_count,
   sum(unclassified_count)::bigint unclassified_count
  from duoli_operator_classes group by 1,2,3,4,5
 ), ar_days as materialized ($newm0$),
 ($oldm1$  union all select data_date,country,platform,platform_key,total,success,rejected,null::bigint,null::bigint,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_reported_audit_duration'::text from duoli_days where total is not null$oldm1$,$newm1$  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_reported_audit_duration'::text from duoli_days where total is not null$newm1$),
 ($oldm2$   'durationTotalSeconds',p.duration_total_seconds,'durationBasis',p.duration_basis,'coveredDays',p.covered_days) end)
  from operator_group d left join operator_group p on p.country=d.country and p.platform_key=d.platform_key and p.account=d.account
    and (case when v_daily then p.group_date=d.group_date-1 else not p.current_period end)
  where d.current_period and v_view='operators'$oldm2$,$newm2$   'durationTotalSeconds',p.duration_total_seconds,'durationBasis',p.duration_basis,'coveredDays',p.covered_days)
    ||case when pc.platform_key is not null then jsonb_build_object('autoCount',pc.auto_count,'manualCount',pc.manual_count,
      'unclassifiedCount',pc.unclassified_count,'operatorClass',case when pc.auto_count>0 and pc.manual_count=0 and pc.unclassified_count=0 then 'auto'
       when pc.manual_count>0 and pc.auto_count=0 and pc.unclassified_count=0 then 'manual' else 'unknown' end) else '{}'::jsonb end end)
   ||case when c.platform_key is not null then jsonb_build_object('autoCount',c.auto_count,'manualCount',c.manual_count,
     'unclassifiedCount',c.unclassified_count,'operatorClass',case when c.auto_count>0 and c.manual_count=0 and c.unclassified_count=0 then 'auto'
      when c.manual_count>0 and c.auto_count=0 and c.unclassified_count=0 then 'manual' else 'unknown' end) else '{}'::jsonb end
  from operator_group d left join operator_group p on p.country=d.country and p.platform_key=d.platform_key and p.account=d.account
    and (case when v_daily then p.group_date=d.group_date-1 else not p.current_period end)
  left join duoli_operator_class_group c on c.country=d.country and c.platform_key=d.platform_key and c.account=d.account
    and c.group_date=d.group_date and c.current_period=d.current_period
  left join duoli_operator_class_group pc on pc.country=p.country and pc.platform_key=p.platform_key and pc.account=p.account
    and pc.group_date=p.group_date and pc.current_period=p.current_period
  where d.current_period and v_view='operators'$newm2$),
 ($oldm3$ -- duoli_native_withdraw_v1: known source fields only; no auto/manual inference.
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
$oldm3$,$newm3$ -- duoli_native_operator_classification_v2: original collector rule, no status-based inference.
 if jsonb_array_length(v_duoli_days)>0 then
  v_duoli_meta:=jsonb_build_object('source','DUOLI','statisticBasis','created_at_current_status',
   'operatorBasis','source_operator','classificationAvailable',true,'classificationComparable',false,
   'reasonAvailable',false,'reasonAvailabilityBasis','not_ingested','reasonUnavailableMessage','原因字段未入库','complete',false,
   'sourceCompletenessVerified',false,'coverageBasis','unverified_source_continuity',
   'durationBasis','source_reported_audit_duration','comparisonComparable',false,'comparisonBasis','unverified_source_continuity');
  v_result:=v_result||jsonb_build_object('source',v_result->>'source'||' + DUOLI native orders',
   'duoliCoverage',(select jsonb_build_object('source','DUOLI','timeBasis','created_at','operatorBasis','source_operator',
    'classificationAvailable',true,'complete',false,'currentComplete',false,'previousComplete',false,
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
    v_duoli_item:=v_duoli_item||v_duoli_meta||jsonb_build_object('classificationPartial',coalesce((v_duoli_item->>'unclassifiedCount')::bigint>0,false));
    if jsonb_typeof(v_duoli_item->'previous')='object' then
     v_duoli_item:=jsonb_set(v_duoli_item,'{previous}',(v_duoli_item->'previous')||v_duoli_meta
      ||jsonb_build_object('classificationPartial',coalesce((v_duoli_item#>>'{previous,unclassifiedCount}')::bigint>0,
       coalesce((v_duoli_item#>>'{previous,total}')::bigint,0)-(v_duoli_item#>>'{previous,autoCount}')::bigint-(v_duoli_item#>>'{previous,manualCount}')::bigint>0,false),
       'unclassifiedCount',coalesce((v_duoli_item#>>'{previous,unclassifiedCount}')::bigint,
        greatest((v_duoli_item#>>'{previous,total}')::bigint-(v_duoli_item#>>'{previous,autoCount}')::bigint-(v_duoli_item#>>'{previous,manualCount}')::bigint,0))));
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
      v_duoli_item:=v_duoli_item||jsonb_build_object('classificationAvailable',true,'classificationComparable',false,
       'classificationPartial',greatest(coalesce((v_duoli_item->>'total')::bigint,0)-coalesce((v_duoli_item->>'autoCount')::bigint,0)-coalesce((v_duoli_item->>'manualCount')::bigint,0),0)>0,
       'unclassifiedCount',greatest(coalesce((v_duoli_item->>'total')::bigint,0)-coalesce((v_duoli_item->>'autoCount')::bigint,0)-coalesce((v_duoli_item->>'manualCount')::bigint,0),0));
     end if;
    else
     select jsonb_build_object('autoCount',sum((r->>'auto_count')::bigint),'manualCount',sum((r->>'manual_count')::bigint),
      'unclassifiedCount',sum((r->>'unclassified_count')::bigint)) into v_duoli_rows
     from jsonb_to_recordset(v_duoli_days)d(data_date date,operator_rows jsonb)
      cross join lateral jsonb_array_elements(d.operator_rows)r
     where case when v_duoli_period='totals' then d.data_date>=v_start else d.data_date<v_start end
      and (v_account is null or position(lower(v_account) in lower(r->>'account'))>0);
     if v_duoli_rows->>'autoCount' is not null then
      v_duoli_item:=v_duoli_item||v_duoli_rows||jsonb_build_object('classificationAvailable',true,'classificationComparable',false,
       'classificationPartial',(v_duoli_item->>'processed')::bigint>(v_duoli_rows->>'autoCount')::bigint+(v_duoli_rows->>'manualCount')::bigint,
       'unclassifiedCount',greatest((v_duoli_item->>'processed')::bigint-(v_duoli_rows->>'autoCount')::bigint-(v_duoli_rows->>'manualCount')::bigint,0));
     end if;
    end if;
    v_result:=jsonb_set(v_result,array[v_duoli_period],v_duoli_item);
   end if;
  end loop;
 end if;
$newm3$)
 ) x(old_text,new_text) LOOP
  IF (length(d)-length(replace(d,r.old_text,'')))/length(r.old_text)<>1 THEN RAISE EXCEPTION 'DUOLI_OPERATOR_ANCHOR_DRIFT';END IF;
  d:=replace(d,r.old_text,r.new_text);
 END LOOP;
 EXECUTE d;
 SELECT * INTO m FROM pg_catalog.pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(m.prosrc)<>'0763d3ce7945b65e958615480fb46c2e' OR to_jsonb(m)-'prosrc' IS DISTINCT FROM main_meta
 THEN RAISE EXCEPTION 'DUOLI_OPERATOR_RESULT_DRIFT';END IF;
END;$duoli_operator_classification$;
COMMIT;
