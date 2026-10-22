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
end;$function$
