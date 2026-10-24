-- Private SQL projection of complete local-day cohorts. Member identifiers never
-- leave this module. Counts are recomputed with DISTINCT over the actual sets;
-- daily distinct counts and percentages are never added.
CREATE FUNCTION private.submission_cohort_project(p_days jsonb,p_request jsonb,p_target jsonb,p_asof timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=''AS $function$
DECLARE result jsonb;q jsonb:=p_request;qualities jsonb;quality jsonb;k text;unknown_days bigint;
BEGIN
 IF jsonb_typeof(p_days)is distinct from'array'or jsonb_array_length(p_days)not between 1 and 31
 OR exists(select 1 from jsonb_array_elements(p_days)d where d->>'contract'is distinct from'submission-local-day-cohort-v1'or d->'target'is distinct from p_target
  or jsonb_typeof(d->'qualified')is distinct from'array'or jsonb_typeof(d->'providers')is distinct from'array'or jsonb_typeof(d->'unknownMembers')is distinct from'array')
 THEN RAISE EXCEPTION'submission_cohort_projection_mismatch';END IF;
 WITH requested AS MATERIALIZED(
  SELECT CASE WHEN jsonb_array_length(coalesce(nullif(q->'providers','null'::jsonb),'[]'::jsonb))=0 THEN NULL::text[]
   ELSE ARRAY(SELECT jsonb_array_elements_text(q->'providers'))END providers
 ),dayrows AS MATERIALIZED(SELECT d FROM jsonb_array_elements(p_days)d),
 qualified_members AS MATERIALIZED(
  SELECT x.* FROM dayrows d CROSS JOIN LATERAL jsonb_to_recordset(d.d->'qualified')x(day date,member_id text,provider text,submitted_count bigint,member_class text,has_l0 boolean,invalid_count bigint,missing_amount bigint,invalid_amount numeric)
  CROSS JOIN requested r WHERE r.providers IS NULL OR x.provider=ANY(r.providers)
 ),provider_stats AS MATERIALIZED(
  SELECT x.* FROM dayrows d CROSS JOIN LATERAL jsonb_to_recordset(d.d->'providers')x(provider text,order_count bigint,missing_member_count bigint,missing_level_count bigint,missing_recharge_count bigint,missing_member_unknown_count bigint,sequence_uncertain_count bigint)
  CROSS JOIN requested r WHERE r.providers IS NULL OR x.provider=ANY(r.providers)
 ),unknown_members AS MATERIALIZED(
  SELECT x.day,x.member_id,x.unknown_status_count FROM dayrows d CROSS JOIN LATERAL jsonb_to_recordset(d.d->'unknownMembers')x(day date,member_id text,unknown_status_count bigint,providers jsonb)
  CROSS JOIN requested r WHERE r.providers IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(x.providers)p WHERE p=ANY(r.providers))
 ),metric_values AS(
  SELECT x.provider,t.threshold,count(DISTINCT x.member_id)FILTER(WHERE x.invalid_count>0)member_count,
   count(DISTINCT(x.day,x.member_id))FILTER(WHERE x.invalid_count>0)member_days,
   count(DISTINCT x.member_id)qualified_member_count,count(DISTINCT(x.day,x.member_id))qualified_member_days,
   sum(x.invalid_count)invalid_count,CASE WHEN sum(x.missing_amount)>0 THEN NULL ELSE sum(x.invalid_amount)::text END invalid_amount,
   count(DISTINCT x.member_id)FILTER(WHERE x.invalid_count>0 AND x.has_l0)l0_members,
   count(DISTINCT x.member_id)FILTER(WHERE x.invalid_count>0 AND x.member_class='new')new_members,
   count(DISTINCT x.member_id)FILTER(WHERE x.invalid_count>0 AND x.member_class='funded')funded_members,
   count(DISTINCT x.member_id)FILTER(WHERE x.invalid_count>0 AND x.member_class='unknown')unknown_members
  FROM qualified_members x CROSS JOIN unnest(ARRAY[10,15,20,30,50,100])t(threshold)WHERE x.submitted_count>t.threshold
  GROUP BY GROUPING SETS((x.provider,t.threshold),(t.threshold))
 ),dimensions AS(SELECT NULL::text provider UNION ALL SELECT DISTINCT provider FROM provider_stats),metrics AS(
  SELECT d.provider,t.threshold,coalesce(m.member_count,0)member_count,coalesce(m.member_days,0)member_days,
   coalesce(m.qualified_member_count,0)qualified_member_count,coalesce(m.qualified_member_days,0)qualified_member_days,
   coalesce(m.invalid_count,0)invalid_count,CASE WHEN m.threshold IS NULL THEN '0' ELSE m.invalid_amount END invalid_amount,
   coalesce(m.l0_members,0)l0_members,coalesce(m.new_members,0)new_members,coalesce(m.funded_members,0)funded_members,coalesce(m.unknown_members,0)unknown_members
  FROM dimensions d CROSS JOIN unnest(ARRAY[10,15,20,30,50,100])t(threshold)
  LEFT JOIN metric_values m ON m.provider IS NOT DISTINCT FROM d.provider AND m.threshold=t.threshold
 )
 SELECT jsonb_build_object('dashboard',NULL,'metrics',(SELECT coalesce(jsonb_agg(to_jsonb(m)ORDER BY provider NULLS FIRST,threshold),'[]'::jsonb)FROM metrics m),
 'coverage',jsonb_build_object('orderCount',coalesce(sum(s.order_count),0),'missingMemberCount',coalesce(sum(s.missing_member_count),0),
  'missingLevelCount',coalesce(sum(s.missing_level_count),0),'missingRechargeCount',coalesce(sum(s.missing_recharge_count),0),
  'unknownStatusCount',coalesce((SELECT sum(unknown_status_count)FROM unknown_members),0)+coalesce(sum(s.missing_member_unknown_count),0),
  'orderSequenceUncertainCount',coalesce(sum(s.sequence_uncertain_count),0),'sourceCompletenessVerified',false),
 'total',NULL,'members',NULL,'rows',NULL,
 'version',3,'exemptCount',0,'thresholdComparison','gt','asOf',p_asof,'startAt',(q->>'startAt')::timestamptz,'endAt',(q->>'endAt')::timestamptz,
 'dayStart',date_trunc('day',(q->>'startAt')::timestamptz AT TIME ZONE(p_target->>'timezone'))AT TIME ZONE(p_target->>'timezone'),
 'dayEnd',(date_trunc('day',((q->>'endAt')::timestamptz-interval'1 microsecond')AT TIME ZONE(p_target->>'timezone'))+interval'1day')AT TIME ZONE(p_target->>'timezone'),
 'platform',jsonb_build_object('id',p_target->'id','name',p_target->'name','source',p_target->'source','country',p_target->'country','currency',p_target->'currency','timezone',p_target->'timezone'),
 'basis','platform_local_day_all_providers_zero_success_whole_day_over_threshold','thresholds',to_jsonb(ARRAY[10,15,20,30,50,100]),'operation','summary')
 INTO result FROM provider_stats s;
 -- Keep the original YASH quality overlay, including max against selected
 -- coverage and the original whole-day evidence. No generic-source certainty.
 SELECT jsonb_object_agg(e.key,e.value)INTO qualities FROM jsonb_array_elements(p_days)d CROSS JOIN LATERAL jsonb_each(nullif(d->'qualityEvidence','null'::jsonb))e;
 IF qualities IS NOT NULL THEN
  SELECT count(*)FILTER(WHERE NOT coalesce((e.value->>'complete')::boolean,false)),
   jsonb_build_object('missingMemberCount',coalesce(sum((e.value->>'missingMemberCount')::bigint),0),
   'unknownStatusCount',coalesce(sum((e.value->>'unknownStatusCount')::bigint),0),
   'orderSequenceUncertainCount',coalesce(sum((e.value->>'orderSequenceUncertainCount')::bigint),0),
   'missingSuccessTimeCount',coalesce(sum((e.value->>'missingSuccessTimeCount')::bigint),0))
  INTO unknown_days,quality FROM jsonb_each(qualities)e;
  FOREACH k IN ARRAY ARRAY['missingMemberCount','unknownStatusCount','orderSequenceUncertainCount','missingSuccessTimeCount']LOOP
   quality:=jsonb_set(quality,ARRAY[k],to_jsonb(greatest(coalesce((result->'coverage'->>k)::bigint,0),(quality->>k)::bigint)));
  END LOOP;
  result:=jsonb_set(result,'{coverage}',result->'coverage'||quality||jsonb_build_object('coverageUnknownDays',unknown_days,'sourceCompletenessVerified',unknown_days=0,
   'calculationComplete',unknown_days=0 AND NOT EXISTS(SELECT 1 FROM jsonb_each(quality)e WHERE(e.value#>>'{}')::bigint>0),'dayEvidence',qualities));
 END IF;
 RETURN result;
END;$function$;
REVOKE ALL ON FUNCTION private.submission_cohort_day_compute(jsonb,jsonb),private.submission_cohort_project(jsonb,jsonb,jsonb,timestamptz)FROM PUBLIC,anon,authenticated,service_role;
