CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_day_evidence(p_site text, p_business text, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s record; lo timestamptz; hi timestamptz; n bigint; seen timestamptz; covered boolean; has_window boolean;
begin
 select * into s from private.dashboard_admin_wg_sites() where site_code=p_site;
 if not found or p_business not in('recharge','withdraw') then raise exception 'invalid_wg_scope';end if;
 lo:=p_date::timestamp at time zone s.timezone;hi:=(p_date+1)::timestamp at time zone s.timezone;
 if p_business='recharge' then
  select count(*),max(stored_at) into n,seen from public.wg_recharge_details where site_code=p_site and created_at>=lo and created_at<hi;
 else
  select count(*),max(stored_at) into n,seen from public.wg_withdraw_details where site_code=p_site and created_at>=lo and created_at<hi;
 end if;
 select coalesce(bool_or(complete),false),count(*)>0 into covered,has_window from public.wg_detail_coverage
  where site_code=p_site and business=p_business and basis='created' and business_date=p_date;
 -- Only fully acknowledged creation windows certify a complete day, even zero.
 covered:=covered and hi<=statement_timestamp();
 return jsonb_build_object('received',n>0 or covered,'count',n,'complete',covered,'hasWindow',has_window,
  'zeroConfirmed',covered and n=0,'seen',seen,
  'status',case when covered and n=0 then 'zero_complete' when covered then 'complete' when n>0 or has_window then 'partial' else 'not_received' end,
  'evidence',case when covered and n=0 then 'source_completed_zero_rows' when covered then 'source_day_task_completed'
   when n>0 or has_window then 'source_full_day_not_published' else 'no_created_orders_received' end);
end;$function$
