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
   foreach k in array array['successTimeBasis','successCohort','successMetricBasis','independentSuccessWindow']loop if result->'capabilities'?k then c:=jsonb_set(c,array[k],result->'capabilities'->k);end if;end loop;
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
 return private.prepared_aggregate_newar_withdraw_clock_guard(result,q);
end;$function$
