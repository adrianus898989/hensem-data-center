-- Category-specific immutable fee lookup. Existing 5/7-argument APIs remain unchanged.
-- Only explicit source channel types are used; unknown types retain legacy ambiguity.
begin;
do $fee_category_baseline$
declare expected record;p pg_proc%rowtype;
begin
 for expected in select * from (values
  ('private.dashboard_admin_fee_intervals(text,text,text,text,text)','cdb33dd98475b05bae412fb01e20d296'),
  ('private.dashboard_admin_fee_quote(text,text,text,text,text,timestamptz,numeric)','4092a402362a32f85d9fdd24e3e6204c')
 ) x(signature,body_hash) loop
  select * into p from pg_proc where oid=expected.signature::regprocedure;
  if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}' or not p.prosecdef
   or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""'] then raise exception 'fee_category_metadata_drift';end if;
  if md5(p.prosrc)<>expected.body_hash then raise exception 'fee_category_baseline_drift: %',expected.signature;end if;
 end loop;
end $fee_category_baseline$;

-- Country-specific confirmed mappings. No provider-name default, substring match,
-- or unconfirmed VT/CK abbreviation expansion. Other exact category names may
-- match only an observed category in this country; absence returns NULL.
create function private.dashboard_admin_fee_category(p_country text,p_channel_type text)
 returns text language sql stable security definer set search_path='' as $function$
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
$function$;
revoke all on function private.dashboard_admin_fee_category(text,text) from public,anon,authenticated,service_role;

create function private.dashboard_admin_fee_intervals(p_country text,p_platform text,p_provider text,p_direction text,p_currency text,p_category text)
 returns table(effective_from timestamptz,effective_until timestamptz,percent_rate numeric,fixed_fee numeric,version_ids jsonb)
 language sql stable security definer set search_path='' as $function$
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
$function$;
revoke all on function private.dashboard_admin_fee_intervals(text,text,text,text,text,text) from public,anon,authenticated,service_role;

create function private.dashboard_admin_fee_quote(p_country text,p_platform text,p_provider text,p_direction text,p_currency text,p_created_at timestamptz,p_amount numeric,p_category text)
 returns jsonb language sql stable security definer set search_path='' as $function$
 select coalesce((select jsonb_build_object('fee_version_state','complete','fee_version_ids',v.version_ids,
 'fee_version_percent_rate',v.percent_rate::text,'fee_version_fixed_fee',v.fixed_fee::text,
 'fee_version_category',nullif(upper(btrim(p_category)),''),'fee_version_effective_from',v.effective_from,'fee_version_effective_until',v.effective_until,
 'fee_version_estimated_amount',(p_amount*v.percent_rate+v.fixed_fee)::text,'fee_version_basis','order_created_at')
 from private.dashboard_admin_fee_intervals(p_country,p_platform,p_provider,p_direction,p_currency,p_category) v
 where isfinite(p_created_at) and p_created_at>=v.effective_from and (v.effective_until is null or p_created_at<v.effective_until)
 and p_amount>=0 and p_amount::text not in ('NaN','Infinity','-Infinity')),
 jsonb_build_object('fee_version_state','unknown','fee_version_ids','[]'::jsonb,'fee_version_effective_from',null,
 'fee_version_effective_until',null,'fee_version_estimated_amount',null,'fee_version_basis','order_created_at'));
$function$;
revoke all on function private.dashboard_admin_fee_quote(text,text,text,text,text,timestamptz,numeric,text) from public,anon,authenticated,service_role;

commit;
