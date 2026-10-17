-- Per-row creation availability is explicit for report-only sources on a
-- sub-day query. Never present their old whole-day totals as exact time totals.
CREATE FUNCTION private.withdraw_window_result(q jsonb,v jsonb,b jsonb)RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=''AS $$
DECLARE row jsonb;outrows jsonb:='[]';p record;unsupported boolean:=false;availability jsonb:='[]';ok boolean;mask jsonb:=jsonb_build_object('total',null,'processed',null,'success',null,'rejected',null,'autoCount',null,'manualCount',null,'unclassifiedCount',null,'avgSeconds',null,'durationSampleCount',null,'durationTotalSeconds',null,'complete',false,'comparisonComparable',false,'creationTimeAvailable',false,'creationTimeReason','source_daily_report_only');
BEGIN
 FOR p IN SELECT *FROM private.withdraw_window_targets(q,b->'scope',b->'catalog')LOOP
  ok:=private.withdraw_window_whole_days(q)OR(p.source IN('wg','kb','newar','ar','duoli','game66')AND NOT(p.source='ar'AND left(q->>'startAt',10)::date<date'2026-10-10'));
  availability:=availability||jsonb_build_array(jsonb_build_object('platform',p.name,'country',p.country,'available',ok,'reason',CASE WHEN NOT ok THEN'source_daily_report_only'END));
  IF NOT ok THEN unsupported:=true;END IF;
 END LOOP;
 IF NOT private.withdraw_window_whole_days(q)THEN
  FOR row IN SELECT value FROM jsonb_array_elements(coalesce(v->'rows','[]'))LOOP
   SELECT x.*INTO p FROM private.withdraw_prepared_platforms(b->'catalog')x WHERE x.country=row->>'country'AND private.dashboard_admin_live_withdraw_key(row->>'platform')IN(private.dashboard_admin_live_withdraw_key(x.name),private.dashboard_admin_live_withdraw_key(x.source_name))LIMIT 1;
   ok:=FOUND AND p.source IN('wg','kb','newar','ar','duoli','game66')AND NOT(p.source='ar'AND left(q->>'startAt',10)::date<date'2026-10-10');
   IF NOT ok THEN unsupported:=true;row:=row||mask;IF row?'previous'THEN row:=jsonb_set(row,'{previous}',coalesce(row->'previous','{}')||mask);END IF;END IF;
   outrows:=outrows||jsonb_build_array(row);
  END LOOP;
  v:=jsonb_set(v,'{rows}',outrows);
  IF unsupported THEN v:=jsonb_set(v,'{totals}',coalesce(v->'totals','{}')||mask);v:=jsonb_set(v,'{previousTotals}',coalesce(v->'previousTotals','{}')||mask);v:=jsonb_set(v,'{comparison}',coalesce(v->'comparison','{}')||jsonb_build_object('complete',false));END IF;
 END IF;
 RETURN v||jsonb_build_object('creationAvailability',availability,'windows',jsonb_build_object('version',2,'creationStartAt',q->>'startAt','creationEndAt',q->>'endAt','successStartAt',q->>'successStartAt','successEndAt',q->>'successEndAt','successBasis',q->>'successBasis','creationMetricBasis','created_orders_current_status','successMetricBasis','independent_successful_source_orders'),'secondary',b->'secondary');
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_window_result(jsonb,jsonb,jsonb)FROM public,anon,authenticated,service_role;
