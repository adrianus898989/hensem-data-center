-- Code-only current native name resolver. No account, source facts or financial data.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_canonical(p_country text, p_platform text, p_raw text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when p_country in ('IN','印度') and p_platform in ('YASH.BET','YASHBET') and btrim(p_raw)='WinPay'
  then private.dashboard_admin_live_provider_alias(p_country,coalesce(
    (select o.canonical_provider from private.dashboard_admin_provider_overrides o
     where o.country=p_country and o.platform=p_platform and o.raw_provider=btrim(p_raw)),
    'NewWinPay')) else private.dashboard_admin_live_provider_alias(p_country,coalesce(
  (select coalesce(o.canonical_provider,a.canonical_provider)
   from private.dashboard_admin_wg_provider_aliases() a
   left join private.dashboard_admin_provider_overrides o on o.country=a.country and o.platform=a.platform and o.raw_provider=a.raw_provider
   where p_country in (a.country_code,a.country) and p_platform=a.platform and btrim(p_raw)=a.raw_provider),
  (select coalesce(o.canonical_provider,private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider),case when cardinality(n.names)=1 then n.names[1] end)
    from private.dashboard_admin_provider_registry r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    cross join lateral (select private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) names)n
    where r.country=p_country and r.platform=p_platform and r.raw_provider=case when p_raw='未识别通道' then '' else coalesce(btrim(p_raw),'') end),p_raw)) end;
$function$
;
