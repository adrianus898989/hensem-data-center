CREATE OR REPLACE FUNCTION private.dashboard_health_feed_timezone(p_feed jsonb)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
 select coalesce(nullif(p_feed->>'timezone',''),case p_feed->>'country'
   when '印度' then 'Asia/Kolkata' when '红膏蟹' then 'Asia/Kolkata' when '香港' then 'Asia/Kolkata'
   when '胖虎巴西' then 'America/Sao_Paulo' when '巴西' then 'America/Sao_Paulo' when '巴基斯坦' then 'Asia/Karachi'
   when '菲律宾' then 'Asia/Manila' when '印尼' then 'Asia/Jakarta' when '越南' then 'Asia/Ho_Chi_Minh'
   when '马来' then 'Asia/Kuala_Lumpur' when '缅甸' then 'Asia/Yangon' when '尼日利亚' then 'Africa/Lagos'
   when '智利' then 'America/Santiago' when '哥伦比亚' then 'America/Bogota' when '墨西哥' then 'America/Mexico_City' end);
$function$;
