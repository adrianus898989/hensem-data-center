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
 return private.dashboard_health_wg_evidence_format(n,seen,covered,has_window,hi,statement_timestamp());
end;$function$
