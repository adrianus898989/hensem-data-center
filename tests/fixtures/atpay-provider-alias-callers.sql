CREATE OR REPLACE FUNCTION private.dashboard_admin_live_confirmed_provider(p_country text, p_platform text, p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case when p_country in ('VN','越南') and p_platform in ('66CLUB','82VN','92LOTTERY','VN168')
   and btrim(p_raw)='Tron-USDT' then 'TronPayUSDT'
   else private.dashboard_admin_live_confirmed_usdt_provider(p_country,p_raw) end;
$function$;
revoke all on function private.dashboard_admin_live_confirmed_provider(text,text,text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_canonical(p_country text, p_platform text, p_raw text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.dashboard_admin_live_provider_alias(p_country,coalesce(
  (select coalesce(o.canonical_provider,a.canonical_provider)
   from private.dashboard_admin_wg_provider_aliases() a
   left join private.dashboard_admin_provider_overrides o on o.country=a.country and o.platform=a.platform and o.raw_provider=a.raw_provider
   where p_country in (a.country_code,a.country) and p_platform=a.platform and btrim(p_raw)=a.raw_provider),
  (select coalesce(o.canonical_provider,private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider),case when cardinality(n.names)=1 then n.names[1] end)
    from private.dashboard_admin_provider_registry r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    cross join lateral (select private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) names)n
    where r.country=p_country and r.platform=p_platform and r.raw_provider=case when p_raw='未识别通道' then '' else coalesce(btrim(p_raw),'') end),p_raw));
$function$;
revoke all on function private.dashboard_admin_live_provider_canonical(text,text,text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_workorder_provider(p_country text, p_platform text, p_raw text, p_channel text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_raw text:=btrim(coalesce(p_raw,''));v_channel text:=btrim(coalesce(p_channel,''));
  v_r text:=regexp_replace(lower(v_raw),'[^a-z0-9一-龥]+','','g');
  v_c text:=regexp_replace(lower(v_channel),'[^a-z0-9一-龥]+','','g');
  v_name text;v_generic boolean:=false;
begin
  -- The exact work-order source code wins over legacy generic rail labels.
  -- Do not match ArbPay2INR, whose confirmed UPI-QR identity is unchanged.
  if p_country='印度' and (v_r='arbpayinr' or v_c='arbpayinr') then return 'ArbPay';end if;
  select canonical_provider into v_name from private.dashboard_admin_provider_overrides
    where country=p_country and platform=p_platform and raw_provider=v_raw;
  if v_name is not null then return v_name;end if;
  if p_country='印度' then
    if v_r='paytm' then
      v_generic:=true;
      v_name:=case v_c when 'haoxpayinr' then 'WPay' when 'wpayinr' then 'WPay'
        when 'ic2payinr' then 'ICPay' when 'ninepayinr' then 'NinePay' when 'ox2payinr' then 'OXPay'
        when 'rapayinr' then 'RAPay' when 'umoneypayinr' then 'UmoneyPay' when 'wepay2inr' then 'WePay' end;
    elsif v_r='qr' then
      v_generic:=true;v_name:=case v_c when 'umoneypayinr' then 'UmoneyPay' when 'wepay2inr' then 'WePay' end;
    end if;
  elsif p_country='缅甸' and v_r in('kbzpay','wavepay') then
    v_generic:=true;v_name:=case v_c when 'kingpaymmk' then 'KingPay' when 'ytpaymmk' then 'YTPay' end;
  elsif p_country='马来' then
    if v_r='duitnow' then v_generic:=true;if v_c='fpaymyr' then v_name:='FPay';end if;
    elsif v_r='touchngo' then v_generic:=true;if v_c='truepaymyr' then v_name:='TruePay';end if;end if;
  end if;
  if v_name is null and v_generic and v_c<>'' and v_c<>v_r then
    return private.dashboard_admin_live_provider_canonical(p_country,p_platform,v_raw||' / '||v_channel);
  end if;
  return private.dashboard_admin_live_provider_canonical(p_country,p_platform,coalesce(v_name,v_raw));
end;
$function$;
revoke all on function private.dashboard_admin_live_workorder_provider(text,text,text,text) from public,anon,authenticated,service_role;
