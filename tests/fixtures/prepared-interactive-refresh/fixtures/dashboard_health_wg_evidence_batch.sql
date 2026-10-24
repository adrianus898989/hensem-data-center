CREATE OR REPLACE FUNCTION private.dashboard_health_wg_evidence_batch(p_site text, p_business text, p_from date, p_to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare s record;lo timestamptz;hi timestamptz;result jsonb;
begin
 -- Internal, bounded acquisition for the already-authorized health feed.
 select * into s from private.dashboard_admin_wg_sites()where site_code=p_site;
 if not found or p_business is null or p_business not in('recharge','withdraw')or p_from is null or p_to is null
  or not isfinite(p_from)or not isfinite(p_to)or p_to<p_from or p_to-p_from>6 then raise exception'invalid_wg_batch_scope';end if;
 lo:=p_from::timestamp at time zone s.timezone;hi:=(p_to+1)::timestamp at time zone s.timezone;
 if p_business='recharge'then
 with facts as materialized(
   select (w.created_at at time zone s.timezone)::date d,count(*) n,max(w.stored_at) seen
   from public.wg_recharge_details w where w.site_code=p_site and w.created_at>=lo and w.created_at<hi
   group by (w.created_at at time zone s.timezone)::date
  ),coverage as materialized(
   select business_date d,coalesce(bool_or(complete),false) covered,count(*)>0 has_window
   from public.wg_detail_coverage where site_code=p_site and business=p_business and basis='created'
    and business_date>=p_from and business_date<=p_to group by business_date
  ),days as(select p_from+i d from generate_series(0,p_to-p_from)i)
  select jsonb_object_agg(d.d::text,private.dashboard_health_wg_evidence_format(coalesce(f.n,0),f.seen,
    coalesce(c.covered,false),coalesce(c.has_window,false),(d.d+1)::timestamp at time zone s.timezone,statement_timestamp())order by d.d)
   into result from days d left join facts f on f.d=d.d left join coverage c on c.d=d.d;
 else
 with facts as materialized(
   select (w.created_at at time zone s.timezone)::date d,count(*) n,max(w.stored_at) seen
   from public.wg_withdraw_details w where w.site_code=p_site and w.created_at>=lo and w.created_at<hi
   group by (w.created_at at time zone s.timezone)::date
  ),coverage as materialized(
   select business_date d,coalesce(bool_or(complete),false) covered,count(*)>0 has_window
   from public.wg_detail_coverage where site_code=p_site and business=p_business and basis='created'
    and business_date>=p_from and business_date<=p_to group by business_date
  ),days as(select p_from+i d from generate_series(0,p_to-p_from)i)
  select jsonb_object_agg(d.d::text,private.dashboard_health_wg_evidence_format(coalesce(f.n,0),f.seen,
    coalesce(c.covered,false),coalesce(c.has_window,false),(d.d+1)::timestamp at time zone s.timezone,statement_timestamp())order by d.d)
   into result from days d left join facts f on f.d=d.d left join coverage c on c.d=d.d;
 end if;
 return result;
end;$function$;
