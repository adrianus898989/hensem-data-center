-- Exact captured fee column contracts; empty synthetic data only.
create table private.fee_rate_versions("id" uuid not null,"rule_key" text not null,"source_key" text not null,"sheet_id" bigint not null,"sheet_name" text not null,"country" text not null,"provider" text not null,"category" text not null,"direction" text not null,"currency" text,"effective_from" timestamp with time zone not null,"percent_rate" numeric,"fixed_fee" numeric,"pricing_state" text not null,"semantic_rule" jsonb not null,"provenance" jsonb not null,"generation_id" uuid not null);
alter table private.fee_rate_versions enable row level security;
create table private.fee_rate_current_evidence("source_id" text not null,"direction" text not null,"rule_key" text not null,"state" text not null,"version_id" uuid,"effective_from" timestamp with time zone,"provenance" jsonb not null,"generation_id" uuid not null);
alter table private.fee_rate_current_evidence enable row level security;
create table private.fee_rate_generations("id" uuid not null,"source_key" text not null,"observed_at" timestamp with time zone not null,"published_at" timestamp with time zone not null,"payload_hash" text not null,"receipt" jsonb not null);
alter table private.fee_rate_generations enable row level security;
create table public.third_party_rates("id" text not null,"sheet_name" text not null,"country" text not null,"category" text not null,"third_party" text not null,"collect_fee" text not null,"payout_fee" text not null,"total_fee" text not null,"collect_single_fee" text not null,"payout_single_fee" text not null,"collect_limit" text not null,"payout_limit" text not null,"channel_info" text not null,"leak" text not null,"whitelist" text not null,"status" text not null,"source_row" integer not null,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null);
alter table public.third_party_rates enable row level security;
CREATE OR REPLACE FUNCTION private.dashboard_data_group(p_country text, p_platform text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_trim text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_country text := upper(btrim(regexp_replace(btrim(coalesce(p_country,''),v_trim), '盘口$', ''),v_trim));
  v_platform text := upper(btrim(coalesce(p_platform,''),v_trim));
  v_group text;
begin
  v_group := case
    when v_country = any(array['BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT','HK_TEAM','RED_CRAB']) then v_country
    when v_country = any(array['香港','HONG KONG','HONG_KONG']) then 'HK_TEAM'
    when v_country = any(array['红膏蟹','紅膏蟹','RED CRAB']) then 'RED_CRAB'
    when v_country = any(array['巴西','BRAZIL']) then 'BR'
    when v_country = any(array['胖虎巴西','PANGHU BRAZIL']) then 'BR_PANGHU'
    when v_country = any(array['印度','印度线下','INDIA']) then 'IN'
    when v_country = any(array['巴基斯坦','PAKISTAN']) then 'PK'
    when v_country = any(array['印尼','印度尼西亚','INDONESIA']) then 'ID'
    when v_country = any(array['越南','VIETNAM']) then 'VN'
    when v_country = any(array['菲律宾','PHILIPPINES']) then 'PH'
    when v_country = any(array['马来','马来西亚','MALAYSIA']) then 'MY'
    when v_country = any(array['缅甸','MYANMAR']) then 'MM'
    when v_country = any(array['尼日利亚','NIGERIA']) then 'NG'
    when v_country = any(array['哥伦比亚','COLOMBIA']) then 'CO'
    when v_country = any(array['墨西哥','MEXICO']) then 'MX'
    when v_country = any(array['智利','CHILE']) then 'CL'
    when v_country = any(array['南美','SOUTH AMERICA']) then 'SA'
    when v_country = '巴西原生' then 'BR_NATIVE'
    when v_country = any(array['USDT通道','USDT 通道']) then 'USDT'
    else '' end;
  if v_group = 'SA' then
    v_group := case v_platform when 'NPG-CHILE' then 'CL' when 'NPG-COLOMBIA' then 'CO'
      when 'NPG-MEXICO' then 'MX' else v_group end;
  end if;
  if v_group in ('BR','BR_PANGHU') then
    v_platform := case v_platform when 'FF55' then 'FF555' when '222VIP.COM' then '222VIP'
      when '222-VIP' then '222VIP' when '67-VIP' then '67VIP' else v_platform end;
    if v_platform = any(array[
      'VIP345','KKVIP','KK345','FF555','TPTP','AA45','F75','25RR','8599BET','9596BET','8566BET',
      '5V555','58EE','27FF','222O','32QQ','67VIP','222VIP','345F','234T','888HH','BET5697',
      '96F','45FF','76PP','56L','559K','2V222','776F','5C555'
    ]) then return 'BR_PANGHU'; end if;
    if v_platform = any(array['POPNOV','POPFEZ','POPCRA']) then return 'BR'; end if;
  end if;
  return v_group;
end;
$function$
;
revoke all on function private.dashboard_data_group(text,text)from public,anon,authenticated,service_role;
grant execute on function private.dashboard_data_group(text,text)to authenticated,service_role;
