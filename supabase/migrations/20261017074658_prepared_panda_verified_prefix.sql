-- Source definitions only. Existing immutable results require the separately reviewed
-- semantic-equivalence publication before this dependency version is activated.
-- Source order kernels and strict receipt/member coverage verifiers are unchanged.

-- BEGIN PANDA PREFIX FUNCTION helpers
-- No change to the existing Panda coverage verifier or generic raw kernel.
-- A current request may read only a strictly verified, contiguous prefix.
CREATE OR REPLACE FUNCTION panda_private.prepared_window(p_label text,p_direction text,p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $window$
DECLARE native_platform text;d text;kind text;piece tstzrange;candidate timestamptz;cutoff timestamptz:=p_end;evidence jsonb;
BEGIN
 IF p_direction NOT IN('all','charge','withdraw')OR p_start IS NULL OR p_end IS NULL
 OR NOT isfinite(p_start)OR NOT isfinite(p_end)OR p_start>=p_end THEN
  RAISE EXCEPTION USING errcode='22023',message='invalid_panda_coverage_scope';
 END IF;
 -- Closed ranges retain the exact existing kernel and coverage semantics.
 IF p_end<=statement_timestamp() THEN RETURN jsonb_build_object('clipped',false);END IF;
 IF p_start>=statement_timestamp()THEN RAISE EXCEPTION USING errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';END IF;
 SELECT platform INTO STRICT native_platform FROM panda_private.order_scopes
 WHERE platform_label=p_label AND country_code='BR'AND region_id=1 AND currency='BRL';
 FOREACH d IN ARRAY CASE p_direction WHEN'all'THEN ARRAY['charge','withdraw']ELSE ARRAY[p_direction]END LOOP
  kind:=CASE d WHEN'charge'THEN'deposit'ELSE'reviewed_withdrawal'END;
  candidate:=NULL;
  -- This metadata pass proposes a bounded endpoint; it is not evidence of
  -- completeness until the unchanged row/member verifier below accepts it.
  WITH received AS MATERIALIZED(
   SELECT r.window_start,r.window_end FROM public.panda_order_coverage_receipts r
   JOIN panda_private.order_scans s ON s.scan_id=r.scan_id AND s.platform=r.platform AND s.direction=r.direction
    AND s.window_axis=r.window_axis AND s.window_start=r.window_start AND s.window_end=r.window_end AND s.observed_at=r.observed_at
   WHERE r.platform=native_platform AND r.direction=kind AND r.window_axis='created_at'
    AND r.row_axis_bounds_verified AND r.coverage_kind='row_axis_verified'AND s.finalized_at IS NOT NULL
    AND r.expected_count>=0 AND r.window_start<r.window_end AND r.window_start<p_end AND r.window_end>p_start
    AND isfinite(r.window_start)AND isfinite(r.window_end)AND r.window_end<=r.observed_at
    AND r.observed_at<=statement_timestamp()AND r.received_at<=statement_timestamp()
  ), merged AS(SELECT range_agg(tstzrange(greatest(window_start,p_start),least(window_end,p_end),'[)'))ranges FROM received)
  SELECT upper(x)INTO candidate FROM merged CROSS JOIN LATERAL unnest(ranges)x WHERE x@>p_start;
  IF candidate IS NULL OR NOT isfinite(candidate)OR candidate<=p_start OR candidate>statement_timestamp()THEN
   RAISE EXCEPTION USING errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';
  END IF;
  cutoff:=least(cutoff,candidate);
 END LOOP;
 evidence:=private.dashboard_admin_panda_query_coverage(p_label,p_direction,p_start,cutoff);
 IF(evidence->>'complete')::boolean IS NOT TRUE THEN
  RAISE EXCEPTION USING errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';
 END IF;
 RETURN jsonb_build_object('clipped',true,'requestedStartAt',p_start,'requestedEndAt',p_end,
  'effectiveStartAt',p_start,'effectiveEndAt',cutoff,'dataCutoff',cutoff,
  'requestedComplete',false,'effectiveComplete',true,'sourceComplete',false,
  'effectiveCoverage',evidence,'reason','verified_created_prefix_only');
END;$window$;
REVOKE ALL ON FUNCTION panda_private.prepared_window(text,text,timestamptz,timestamptz) FROM public,anon,authenticated,service_role;
-- END PANDA PREFIX FUNCTION helpers

-- BEGIN PANDA PREFIX FUNCTION compute
CREATE OR REPLACE FUNCTION private.prepared_aggregate_compute(q jsonb, t jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare request jsonb;result jsonb;reason text;secondary text;missing_direction text;direction_caps jsonb:='{}';d text;c jsonb;native_old jsonb;native_new jsonb;k text;panda_window jsonb;
begin
 reason:=private.prepared_aggregate_request_reason(q,t);if reason is not null then raise exception using errcode='22023',message=reason;end if;
 request:=private.prepared_aggregate_expand_provider_filter(q,t);
 if t->>'source'='panda'then
  panda_window:=panda_private.prepared_window(t->>'source_name',coalesce(q->>'direction','all'),(q->>'startAt')::timestamptz,(q->>'endAt')::timestamptz);
  if(panda_window->>'clipped')::boolean then
   request:=request||jsonb_build_object('endAt',panda_window->'effectiveEndAt');
  end if;
 end if;
 result:=private.prepared_aggregate_raw_kernel(request,jsonb_build_array(t));
 result:=private.provider_snapshot_orders_result_kernel(result,request);
 -- Preserve the exact native directional capability contract inside the
 -- immutable master. Readers can then narrow an all-direction population
 -- without consulting source tables or guessing missing-clock metadata.
 if q->>'view'='full'and q->>'durationVersion'='2'then
  foreach d in array array['all','charge','withdraw']loop
   c:=coalesce(result->'capabilities','{}'::jsonb);native_old:='{}';native_new:='{}';
   if t->>'source'='wg'then native_old:=private.dashboard_admin_wg_capabilities(coalesce(q->>'direction','all'));native_new:=private.dashboard_admin_wg_capabilities(d);
   elsif t->>'source'='panda'then native_old:=private.dashboard_admin_panda_capabilities(coalesce(q->>'direction','all'));native_new:=private.dashboard_admin_panda_capabilities(d);end if;
   c:=(c-coalesce((select array_agg(key)from jsonb_object_keys(native_old)key),array[]::text[]))||native_new;
   foreach k in array array['successTimeBasis','successCohort','independentSuccessWindow']loop if result->'capabilities'?k then c:=jsonb_set(c,array[k],result->'capabilities'->k);end if;end loop;
   secondary:=private.prepared_aggregate_secondary_reason(q||jsonb_build_object('direction',d),t);
   if secondary is not null then
    missing_direction:=case when t->>'source'='wg'and d='all'then'withdraw'when t->>'source'='game66'and q->>'successBasis'='source_updated'and d='all'then'charge'else'all'end;
    c:=private.prepared_aggregate_mask_secondary(jsonb_build_object('summary','[]'::jsonb,'groups','{}'::jsonb,'capabilities',c),secondary,missing_direction)->'capabilities';
   end if;
   direction_caps:=direction_caps||jsonb_build_object(d,c);
  end loop;
  result:=result||jsonb_build_object('_preparedDirectionCapabilities',direction_caps);
 end if;
 secondary:=private.prepared_aggregate_secondary_reason(q,t);
 if secondary is not null then
  missing_direction:=case when t->>'source'='wg'and coalesce(q->>'direction','all')='all'then'withdraw'when t->>'source'='game66'and q->>'successBasis'='source_updated'and coalesce(q->>'direction','all')='all'then'charge'else'all'end;
  result:=private.prepared_aggregate_mask_secondary(result,secondary,missing_direction);
  if q->>'status'='success'then result:=result||jsonb_build_object('total',null,'hasMore',null);end if;
 end if;
 if(panda_window->>'clipped')::boolean then
  -- The compute is complete for the verified prefix. The requested source
  -- window remains explicitly incomplete; original filters are never lost.
  result:=result||jsonb_build_object('startAt',q->'startAt','endAt',q->'endAt',
   'pandaCoverage',(panda_window->'effectiveCoverage')||(panda_window-array['clipped','effectiveCoverage'])||jsonb_build_object('complete',false));
 end if;
 return result;
end;$function$;
-- END PANDA PREFIX FUNCTION compute

-- BEGIN PANDA PREFIX FUNCTION dependency
CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency(p_target jsonb, p_common text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when p_target->>'source'='panda'then
  md5(jsonb_build_object('base',previous.token,'pandaPrefixContract',1,
   'prefixFunction',(select jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text)
    from pg_proc p where p.oid='panda_private.prepared_window(text,text,timestamptz,timestamptz)'::regprocedure))::text)
 else previous.token end
 from(select md5(jsonb_build_object('common',p_common,
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in(p_target->>'scope_group',p_target->>'country')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in(p_target->>'scope_group',p_target->>'country')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text))previous(token);
$function$;
-- END PANDA PREFIX FUNCTION dependency

-- BEGIN PANDA PREFIX FUNCTION projection
CREATE OR REPLACE FUNCTION private.prepared_aggregate_master_projection(p_payload jsonb, p_base jsonb, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r jsonb:=p_payload;b jsonb:=p_base;q jsonb:=p_request;rows jsonb;thresholds jsonb;providers jsonb;summaries jsonb;profile text:=q->>'view';caps jsonb;coverage jsonb;selected_summary jsonb;
begin
 if b->>'view'is distinct from'full'or b->>'durationVersion'is distinct from'2'
 or b?'durationRange'or q?'durationRange'or b->>'direction'is distinct from'all'
 or profile not in('full','providers')or coalesce(q->>'durationVersion','1')not in('1','2')
 or r->>'durationVersion'is distinct from'2'
 then raise exception using errcode='22023',message='prepared_master_projection_contract';end if;
 caps:=r#>array['_preparedDirectionCapabilities',q->>'direction'];
 if r?'_preparedDirectionCapabilities'and jsonb_typeof(caps)is distinct from'object'then raise exception using errcode='22023',message='prepared_master_direction_capabilities';end if;
 if caps is not null then r:=jsonb_set(r||jsonb_build_object('capabilities',caps),'{platform,capabilities}',caps);end if;
 r:=r-'_preparedDirectionCapabilities';
 if r?'pandaCoverage'and q->>'direction'<>'all'then
  select jsonb_build_object('directions',coalesce(jsonb_agg(x order by x->>'direction'),'[]'::jsonb),'complete',coalesce(bool_and((x->>'complete')::boolean),false),'latestCollectedAt',max((x->>'latestCollectedAt')::timestamptz))into coverage
   from jsonb_array_elements(r#>'{pandaCoverage,directions}')x where x->>'direction'=q->>'direction';
  r:=jsonb_set(r,'{pandaCoverage}',r->'pandaCoverage'||coverage);
  if r#>>'{platform,source}'='panda'and r#>'{pandaCoverage,requestedComplete}'='false'::jsonb
  and r#>'{pandaCoverage,effectiveComplete}'='true'::jsonb then
   r:=jsonb_set(r,'{pandaCoverage,complete}','false'::jsonb);
  end if;
 end if;
 if profile='providers'then
  if coalesce(b->>'status','all')<>'all'or coalesce(b->'providers','[]'::jsonb)<>'[]'::jsonb
  or(b-array['view','durationVersion','amountBands','direction','providers'])is distinct from(q-array['view','durationVersion','amountBands','direction','providers'])
  then raise exception using errcode='22023',message='prepared_master_projection_scope';end if;
  -- Full chart grouping columns are not present in the original providers DTO.
  select coalesce(jsonb_agg(x-array['date','hour','bucket']order by x->>'provider',x->>'direction',x->>'currency'),'[]'::jsonb)into providers from jsonb_array_elements(r#>'{groups,provider}')x;
  select coalesce(jsonb_agg(x-array['date','hour','bucket']order by x->>'direction',x->>'currency'),'[]'::jsonb)into summaries from jsonb_array_elements(r->'summary')x;
  r:=(r-array['durationVersion','durationRange','amountBands','amountBandsVersion','latencySummary','pendingSummary'])||jsonb_build_object('groups',jsonb_build_object('provider',providers),'summary',summaries);
  b:=(b-array['amountBands','durationVersion'])||jsonb_build_object('view','providers');
  q:=q-array['amountBands','durationVersion'];
  selected_summary:=r->'summary';r:=private.dashboard_prepared_provider_projection(r,b,q);
  if coalesce(q->'providers','[]'::jsonb)='[]'::jsonb then
   -- Direction-only narrowing has exact existing native summaries. Keep their
   -- creation-success amount and capability/evidence fields verbatim.
   select coalesce(jsonb_agg(x order by x->>'direction',x->>'currency'),'[]'::jsonb)into selected_summary from jsonb_array_elements(selected_summary)x where q->>'direction'='all'or x->>'direction'=q->>'direction';
   r:=jsonb_set(r,'{summary}',selected_summary);
  end if;
  return r||case when p_request->>'durationVersion'='2'then jsonb_build_object('durationVersion',2)else'{}'::jsonb end;
 end if;
 if(b-array['durationVersion','direction'])is distinct from(q-array['durationVersion','direction'])then raise exception using errcode='22023',message='prepared_master_projection_scope';end if;
 -- Validate native identity and both exact windows before manipulating bins.
 perform private.dashboard_prepared_direction_projection(r,b,b);
 if coalesce(q->>'durationVersion','1')='1'then
  if jsonb_typeof(r#>'{groups,latency}')is distinct from'array'or jsonb_typeof(r#>'{groups,latency_thresholds}')is distinct from'array'then raise exception using errcode='22023',message='prepared_master_latency_contract';end if;
  -- The first three v2 bins partition the original <=5 minute bin exactly.
  -- Any unknown amount remains unknown. All summaries/percentiles are retained
  -- from the same population, same asOf and same immutable publication.
  with bins as(select x,case when(x->>'bucket')::integer<3 then 0 else(x->>'bucket')::integer-2 end bucket from jsonb_array_elements(r#>'{groups,latency}')x),
  merged as(select x->>'direction'direction,x->'currency'currency,bucket,
   (array_agg(x order by(x->>'bucket')::integer))[1]sample,
   sum((x->>'count')::numeric)n,case when bool_or(x->>'amount'is null)then null else sum((x->>'amount')::numeric)end amount,
   max((x->>'max_ms')::numeric)max_ms
   from bins group by 1,2,3)
  select coalesce(jsonb_agg(sample||jsonb_build_object('bucket',bucket,'count',n,'amount',amount::text,
    'min_ms',case when bucket=0 then null else(sample->>'min_ms')::numeric end,
    'max_ms',case when bucket=0 then 300000 else(sample->>'max_ms')::numeric end,
    'count_share',n/nullif((sample->>'valid_count')::numeric,0),
    'amount_share',case when(sample->>'valid_amount')::numeric>0 then amount/(sample->>'valid_amount')::numeric end)
    order by direction,currency,bucket),'[]'::jsonb)into rows from merged;
  select coalesce(jsonb_agg(x||jsonb_build_object('bucket',(x->>'bucket')::integer-2)order by x->>'direction',x->>'currency',(x->>'bucket')::integer),'[]'::jsonb)into thresholds
   from jsonb_array_elements(r#>'{groups,latency_thresholds}')x where(x->>'threshold_ms')::numeric>=300000;
  r:=jsonb_set(jsonb_set(r-array['durationVersion','durationRange'],'{groups,latency}',rows),'{groups,latency_thresholds}',thresholds);
 end if;
 b:=(b-'durationVersion')||case when q?'durationVersion'then jsonb_build_object('durationVersion',q->'durationVersion')else'{}'::jsonb end;
 return private.dashboard_prepared_direction_projection(r,b,q);
end;$function$;
-- END PANDA PREFIX FUNCTION projection
