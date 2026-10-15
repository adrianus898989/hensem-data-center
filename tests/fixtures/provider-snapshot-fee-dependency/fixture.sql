-- Synthetic rows only; exact captured column contracts and fee helper definitions.
create role anon;create role authenticated;create role service_role;create schema private;
create table private.fee_rate_versions("id" uuid not null,"rule_key" text not null,"source_key" text not null,"sheet_id" bigint not null,"sheet_name" text not null,"country" text not null,"provider" text not null,"category" text not null,"direction" text not null,"currency" text,"effective_from" timestamp with time zone not null,"percent_rate" numeric,"fixed_fee" numeric,"pricing_state" text not null,"semantic_rule" jsonb not null,"provenance" jsonb not null,"generation_id" uuid not null);
alter table private.fee_rate_versions enable row level security;
create table private.fee_rate_current_evidence("source_id" text not null,"direction" text not null,"rule_key" text not null,"state" text not null,"version_id" uuid,"effective_from" timestamp with time zone,"provenance" jsonb not null,"generation_id" uuid not null);
alter table private.fee_rate_current_evidence enable row level security;
create table private.fee_rate_generations("id" uuid not null,"source_key" text not null,"observed_at" timestamp with time zone not null,"published_at" timestamp with time zone not null,"payload_hash" text not null,"receipt" jsonb not null);
alter table private.fee_rate_generations enable row level security;
create table public.third_party_rates("id" text not null,"sheet_name" text not null,"country" text not null,"category" text not null,"third_party" text not null,"collect_fee" text not null,"payout_fee" text not null,"total_fee" text not null,"collect_single_fee" text not null,"payout_single_fee" text not null,"collect_limit" text not null,"payout_limit" text not null,"channel_info" text not null,"leak" text not null,"whitelist" text not null,"status" text not null,"source_row" integer not null,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null);
alter table public.third_party_rates enable row level security;
create table private.fee_rate_head(source_key text,generation_id uuid,observed_at timestamptz,semantic_hash text,projection_hash text,evidence_hash text);
create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,version bigint);
create table private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,order_kind text,order_no text,confirmed_provider text,active boolean);
create table public.ar_config_targets(source_system text,country_code text,platform text,currency text);
-- Explicit synthetic contract primitive; this migration does not change the real guard.
create function private.provider_snapshot_kernel_contract_current()returns boolean language sql stable as $$select true$$;
create function private.dashboard_admin_live_provider_canonical(text,text,text)returns text language sql immutable as $$select case when $3='AliasPay'then 'SelectedPay'else $3 end$$;

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
revoke all on function private.dashboard_data_group(text,text) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_data_group(text,text) to authenticated,service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_fee_category(p_country text, p_channel_type text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with channel as (select nullif(upper(btrim(p_channel_type)),'') value)
 select case
  when p_country='VN' and value ~ '^MOMO[0-9]*$' then 'MOMO'
  when p_country='VN' and value ~ '^CARD[0-9]*$' then 'THẺ CÀO'
  when p_country='VN' and value ~ '^(QR|BANKQR)[0-9]*$' then 'BANKQR'
  when p_country='VN' and value ~ '^ZALO[0-9]*$' then 'ZALO'
  when exists(select 1 from private.fee_rate_versions v where v.country=p_country and upper(btrim(v.category))=value)
    or exists(select 1 from public.third_party_rates r where private.dashboard_data_group(r.country,'')=p_country and upper(btrim(r.category))=value)
   then value
  else null end from channel;
$function$
;
revoke all on function private.dashboard_admin_fee_category(text,text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_fee_intervals(p_country text, p_platform text, p_provider text, p_direction text, p_currency text, p_category text)
 RETURNS TABLE(effective_from timestamp with time zone, effective_until timestamp with time zone, percent_rate numeric, fixed_fee numeric, version_ids jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with versions as materialized (
   select v.*,lead(v.effective_from) over(partition by v.rule_key order by v.effective_from) until_at
   from private.fee_rate_versions v where v.country=p_country and v.direction=p_direction
   and (nullif(btrim(p_category),'') is null or upper(btrim(v.category))=upper(btrim(p_category)))
   and private.dashboard_admin_live_provider_canonical(p_country,p_platform,v.provider)=private.dashboard_admin_live_provider_canonical(p_country,p_platform,p_provider)
 ), eligible as materialized (
   select v.* from versions v where nullif(p_currency,'') is not null and v.pricing_state='ready'
   and (v.currency=p_currency or (v.currency is null and v.fixed_fee=0))
   -- An invalid/removed current source cannot extend the last open interval.
   and (v.until_at is not null or exists(select 1 from private.fee_rate_current_evidence e join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready' and r.updated_at=g.published_at))
   and (v.until_at is not null or not exists(
     select 1 from private.fee_rate_current_evidence bad join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where bad.direction=p_direction and (bad.version_id is null or bad.state<>'ready' or r.updated_at is distinct from generation.published_at)
     and private.dashboard_data_group(r.country,'')=p_country
     and (nullif(btrim(p_category),'') is null or upper(btrim(r.category))=upper(btrim(p_category)))
     and private.dashboard_admin_live_provider_canonical(p_country,p_platform,r.third_party)=private.dashboard_admin_live_provider_canonical(p_country,p_platform,p_provider)))
 ), boundaries as (select effective_from t from versions union select until_at from versions where until_at is not null),
 segments as (select t,lead(t) over(order by t) until_at from boundaries), priced as (
   select s.t,s.until_at,count(distinct jsonb_build_array(e.percent_rate,e.fixed_fee)) rule_count,
    min(e.percent_rate) percent,min(e.fixed_fee) fixed,jsonb_agg(e.id order by e.id) ids
   from segments s join eligible e on e.effective_from<=s.t and (e.until_at is null or s.t<e.until_at)
   -- An overlapping unpriceable category makes this provider ambiguous too.
   where not exists(select 1 from versions b where b.effective_from<=s.t and (b.until_at is null or s.t<b.until_at)
     and (b.currency is null or b.currency=p_currency)
     and not exists(select 1 from eligible good where good.id=b.id))
   group by s.t,s.until_at
 ) select t,until_at,percent,fixed,ids from priced where rule_count=1;
$function$
;
revoke all on function private.dashboard_admin_fee_intervals(text,text,text,text,text,text) from public,anon,authenticated,service_role;
create or replace function private.provider_snapshot_dependency_token(p_target jsonb)
returns text language sql stable security invoker set search_path='' as $fn$
 select md5(jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(p.prosrc),p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  'feeHead',(select coalesce(jsonb_agg(jsonb_build_array(source_key,semantic_hash,projection_hash,evidence_hash)order by source_key),'[]'::jsonb)from private.fee_rate_head),
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text);
$fn$;

revoke all on function private.provider_snapshot_dependency_token(jsonb)from public,anon,authenticated,service_role;