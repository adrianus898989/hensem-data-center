CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_current_feeds(p_feeds jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(f order by ord),'[]') from jsonb_array_elements(p_feeds) with ordinality a(f,ord)
 where not(coalesce(f->>'dataset','') in('volume','auto','auto_report','operators','reasons')
  and upper(coalesce(f->>'system','')) in('WG','REPORT','SHEET') and exists(
   select 1 from private.dashboard_admin_wg_sites()s
   where upper(coalesce(f->>'rawCountry','')) in(upper(s.country_code),upper(s.country))
    and upper(regexp_replace(coalesce(f->>'rawPlatform',''),'[^a-zA-Z0-9]','','g'))=upper(s.platform)));
$function$
