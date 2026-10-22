CREATE OR REPLACE FUNCTION private.prepared_aggregate_newar_withdraw_clock_guard(p_result jsonb, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
 r jsonb:=p_result; q jsonb:=coalesce(p_request,'{}'::jsonb); item jsonb; items jsonb:='[]';
 caps jsonb; pcaps jsonb; dcaps jsonb; c jsonb; groups jsonb; rows jsonb; k text; d text;
 platform_name text; direction text; basis text; end_at timestamptz;
 missing_clock boolean; known_clock boolean; evidence jsonb; reason text:='payment_success_time_missing';
BEGIN
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN r; END IF;
 -- A ready/last-complete publication is guarded after all native projections
 -- and daily-provider folds. Non-ready publications retain the original DTO.
 IF jsonb_typeof(r->'items')='array' AND r->>'version'='2' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(r->'items') LOOP
   IF item->>'status'='ready' AND jsonb_typeof(item->'result')='object' THEN
    item:=jsonb_set(item,'{result}',private.prepared_aggregate_newar_withdraw_clock_guard(item->'result',item->'request'));
   END IF;
   items:=items||jsonb_build_array(item);
  END LOOP;
  RETURN jsonb_set(r,'{items}',items);
 END IF;
 direction:=coalesce(q->>'direction','all');
 IF r#>>'{platform,source}' IS DISTINCT FROM 'newar' OR direction='charge'
  OR direction NOT IN ('all','withdraw') THEN RETURN r; END IF;
 -- Only successful-window aggregates are changed. Detail rows retain the
 -- observed successful state and their true nullable success_at value.
 IF jsonb_typeof(r->'summary') IS DISTINCT FROM 'array'
  OR jsonb_typeof(r->'groups') IS DISTINCT FROM 'object' THEN RETURN r; END IF;
 platform_name:=coalesce(r#>>'{platform,sourceName}',r#>>'{platform,source_name}',r#>>'{platform,name}');
 IF platform_name IS NULL OR NOT EXISTS(SELECT 1 FROM public.newar_detail_platforms p WHERE p.platform=platform_name) THEN
  RAISE EXCEPTION USING errcode='55000',message='newar_withdraw_clock_platform_unavailable';
 END IF;
 if q->>'successBasis'is distinct from'created'then r:=private.prepared_aggregate_newar_withdraw_created_cohort(r,q);end if;
 basis:=coalesce(r->>'successBasis','success');
 IF basis NOT IN ('success','source_updated','created') THEN RETURN r; END IF;
 BEGIN
  end_at:=coalesce(nullif(r->>'successEndAt',''),nullif(q->>'successEndAt',''),nullif(r->>'endAt',''),nullif(q->>'endAt',''))::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION USING errcode='22023',message='newar_withdraw_clock_invalid_end';
 END;
 IF end_at IS NULL OR NOT isfinite(end_at) THEN
  RAISE EXCEPTION USING errcode='22023',message='newar_withdraw_clock_invalid_end';
 END IF;
 -- A missing success clock cannot belong to a window before order creation.
 -- No lower date bound is guessed: the schema does not guarantee that a
 -- client capture timestamp is an upper bound on payment success.
 SELECT EXISTS(SELECT 1 FROM public.newar_detail_records n
  WHERE n.platform=platform_name AND n.dataset='withdraw' AND n.status_group='success'
   AND n.success_at IS NULL AND n.created_at<end_at AND(basis<>'created'or n.created_at>=(q->>'startAt')::timestamptz)) INTO missing_clock;
 SELECT EXISTS(SELECT 1 FROM public.newar_detail_records n
  WHERE n.platform=platform_name AND n.dataset='withdraw' AND n.status_group='success'
   AND n.success_at IS NOT NULL AND n.created_at<end_at AND(basis<>'created'or n.created_at>=(q->>'startAt')::timestamptz)) INTO known_clock;
 evidence:=jsonb_build_object('status',CASE WHEN missing_clock AND known_clock THEN 'partial' WHEN missing_clock THEN 'missing' ELSE 'no_missing_observed' END,
  'scope',case when basis='created'then'selected_created_successful_withdrawals'else'stored_successful_withdrawals_created_before_secondary_end'end,
  'hasMissing',missing_clock,'hasKnown',known_clock,'secondaryEndAt',end_at,
  'lowerBoundApplied',basis='created','countsAvailable',false,'sourceUpdatedIsPaymentTime',false);
 caps:=coalesce(r->'capabilities','{}'::jsonb)||jsonb_build_object('withdrawSuccessClockCoverage',evidence);
 r:=jsonb_set(r,'{capabilities}',caps);
 IF missing_clock THEN
  IF basis='success' THEN
   r:=private.prepared_aggregate_mask_secondary(r,reason,'withdraw');
   IF direction='withdraw' THEN
    r:=jsonb_set(r,'{capabilities}',(r->'capabilities')||jsonb_build_object(
     'successTimeAvailable',false,'secondaryTimeAvailable',false,'secondaryTimeUnavailableReason',reason,'latencyAvailable',false));
   END IF;
   IF q->>'status'='success' THEN r:=r||jsonb_build_object('total',null,'hasMore',null); END IF;
  ELSE
   -- Source-update cohorts remain valid as update cohorts. Their elapsed time
   -- is not payment latency, so remove only the affected latency rows.
   groups:=r->'groups';
   FOREACH k IN ARRAY ARRAY['latency','latency_thresholds','latency_custom'] LOOP
    IF groups?k THEN
     SELECT coalesce(jsonb_agg(x ORDER BY n),'[]'::jsonb) INTO rows
      FROM jsonb_array_elements(groups->k) WITH ORDINALITY t(x,n) WHERE x->>'direction' IS DISTINCT FROM 'withdraw';
     groups:=jsonb_set(groups,ARRAY[k],rows);
    END IF;
   END LOOP;
   r:=jsonb_set(r,'{groups}',groups);
   IF jsonb_typeof(r->'latencySummary')='array' THEN
    SELECT coalesce(jsonb_agg(x ORDER BY n),'[]'::jsonb) INTO rows
     FROM jsonb_array_elements(r->'latencySummary') WITH ORDINALITY t(x,n) WHERE x->>'direction' IS DISTINCT FROM 'withdraw';
    r:=jsonb_set(r,'{latencySummary}',rows);
   END IF;
   r:=jsonb_set(r,'{capabilities}',(r->'capabilities')||jsonb_build_object(
    'withdrawSuccessTimeAvailable',false,'withdrawLatencyAvailable',false,'withdrawLatencyUnavailableReason',reason));
   IF direction='withdraw' THEN r:=jsonb_set(r,'{capabilities}',(r->'capabilities')||jsonb_build_object('successTimeAvailable',false,'latencyAvailable',false)); END IF;
  END IF;
 END IF;
 -- Keep projected directional capability metadata consistent without ever
 -- copying a withdrawal restriction onto the charge-only projection.
 dcaps:=r->'_preparedDirectionCapabilities';
 IF jsonb_typeof(dcaps)='object' THEN
  FOREACH d IN ARRAY ARRAY['all','withdraw'] LOOP
   IF jsonb_typeof(dcaps->d)='object' THEN
    c:=(dcaps->d)||jsonb_build_object('withdrawSuccessClockCoverage',evidence,
     'withdrawCreatedSuccessAvailable',r#>'{capabilities,withdrawCreatedSuccessAvailable}',
     'withdrawCreatedSuccessCohort',r#>'{capabilities,withdrawCreatedSuccessCohort}');
    IF missing_clock THEN
     c:=c||jsonb_build_object('withdrawSuccessTimeAvailable',false,'withdrawLatencyAvailable',false);
     IF basis='success' THEN c:=c||jsonb_build_object('withdrawSecondaryTimeAvailable',false,'withdrawSecondaryTimeUnavailableReason',reason); END IF;
     IF d='withdraw' THEN
      c:=c||jsonb_build_object('successTimeAvailable',false,'latencyAvailable',false);
      IF basis='success' THEN c:=c||jsonb_build_object('secondaryTimeAvailable',false,'secondaryTimeUnavailableReason',reason); END IF;
     END IF;
    END IF;
    dcaps:=jsonb_set(dcaps,ARRAY[d],c);
   END IF;
  END LOOP;
  r:=jsonb_set(r,'{_preparedDirectionCapabilities}',dcaps);
 END IF;
 pcaps:=coalesce(r#>'{platform,capabilities}','{}'::jsonb)||(r->'capabilities');
 RETURN jsonb_set(r,'{platform,capabilities}',pcaps);
END;
$function$
