CREATE OR REPLACE FUNCTION private.dashboard_admin_yash_day_evidence(p_country text, p_platform text, p_kind text, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_start timestamptz;v_end timestamptz;v_count bigint;v_seen timestamptz;v_covered boolean;v_complete boolean;v_progress jsonb;v_type text;
begin
 if p_country is distinct from 'IN' or p_platform is distinct from 'YASH.BET' or p_kind not in('recharge','withdraw') or p_day is null then
  raise exception using errcode='22023',message='invalid_yash_coverage_identity';end if;
 v_type:=case p_kind when 'recharge' then 'deposit' else 'withdrawal' end;
 v_start:=p_day::timestamp at time zone 'Asia/Kolkata';v_end:=(p_day+1)::timestamp at time zone 'Asia/Kolkata';
 select count(*),max(received_at) into v_count,v_seen from private.yash_orders
  where source_site='yash' and order_type=v_type and created_at>=v_start and created_at<v_end;
 select coalesce(range_agg(tstzrange(start_at,end_exclusive,'[)')) @> tstzrange(v_start,v_end,'[)'),false)
 into v_covered from private.yash_sync_windows w
  where order_type=v_type and stream='createTime' and complete
   and source_count=uploaded_count and uploaded_count=stored_count
   and start_at<end_exclusive and isfinite(start_at) and isfinite(end_exclusive)
   and start_at<v_end and end_exclusive>v_start
   and stored_count=(select count(*) from private.yash_orders y where y.source_site='yash' and y.order_type=v_type and y.created_at>=w.start_at and y.created_at<w.end_exclusive);
 select coalesce(jsonb_agg(jsonb_build_object('stream',stream,'startAt',start_at,'endExclusive',end_exclusive,
  'complete',complete,'sourceCount',source_count,'uploadedCount',uploaded_count,'storedCount',stored_count,
  'receivedAt',received_at) order by start_at,stream),'[]'),greatest(v_seen,max(received_at)) into v_progress,v_seen
 from private.yash_sync_windows where order_type=v_type and start_at<v_end and end_exclusive>v_start;
 v_complete:=v_covered and v_end<=date_trunc('day',statement_timestamp() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
 return jsonb_build_object('received',v_count>0 or v_complete,'seen',v_seen,'count',v_count,
  'status',case when v_complete then 'complete' when v_count>0 then 'received' else 'unverified' end,
  'evidence',case when v_complete and v_count=0 then 'yash_created_windows_zero_confirmed'
   when v_complete then 'yash_created_windows_complete' when v_count>0 then 'yash_created_windows_incomplete'
   else 'no_created_orders_received' end,
  'complete',v_complete,'zeroConfirmed',v_complete and v_count=0,'progress',v_progress,'createdCoverageAvailable',true,
  'creationDayWindowCovered',v_covered);
end;
$function$

