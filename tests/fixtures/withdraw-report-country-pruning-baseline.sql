CREATE OR REPLACE FUNCTION private.dashboard_admin_live_report_country(p_country text, p_platform text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
 select case when upper(btrim(p_country)) in ('南美','SA') and upper(btrim(p_platform)) in ('NPG-CHILE','NPG-COLOMBIA','NPG-MEXICO') then case upper(btrim(p_platform)) when 'NPG-CHILE' then '智利' when 'NPG-COLOMBIA' then '哥伦比亚' else '墨西哥' end when upper(btrim(p_country)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
   or (upper(btrim(p_country)) in ('巴西','BR','BRAZIL') and private.dashboard_admin_live_is_panghu_platform(p_platform))
 then '胖虎巴西' else case upper(btrim(p_country))
 when 'IN' then '印度' when 'INDIA' then '印度' when 'BR' then '巴西' when 'BRAZIL' then '巴西'
 when 'PK' then '巴基斯坦' when 'ID' then '印尼' when 'VN' then '越南' when 'PH' then '菲律宾'
 when 'MY' then '马来' when 'MM' then '缅甸' when 'NG' then '尼日利亚' when 'CO' then '哥伦比亚'
 when 'CL' then '智利' when 'MX' then '墨西哥' when 'HK_TEAM' then '香港' when 'RED_CRAB' then '红膏蟹'
 else btrim(p_country) end end
$function$
