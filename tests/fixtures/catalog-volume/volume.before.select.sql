with feed_metadata as (
   select 'volume'::text dataset,
    case when sheet_name like 'AR_DIRECT%' then 'AR' when sheet_name like 'LG_DIRECT%' then 'LG' else 'REPORT' end::text source_system,
    coalesce(country,'') raw_country,platform raw_platform,data_date,updated_at,
    case when lower(btrim(direction)) in('charge','recharge','collect','deposit','代收') then 'charge' when lower(btrim(direction)) in('withdraw','payout','代付') then 'withdraw' end::text direction,
    case when (sheet_name like 'AR_DIRECT%' or sheet_name like 'LG_DIRECT%') then 'direct'
      when sheet_name like '[三方量表%]%' then 'google_sheets' else 'unknown' end::text provenance
   from public.third_party_volume where quarantined_at is null
), actual as (
   select dataset,source_system,raw_country,raw_platform,direction,provenance,
    min(data_date) filter(where data_date between date '2000-01-01' and current_date+1) first_date,
    max(data_date) filter(where data_date between date '2000-01-01' and current_date+1) last_date,
    count(*) filter(where data_date is null or data_date<date '2000-01-01' or data_date>current_date+1) date_issues,
    max(updated_at) updated_at,count(*) rows
   from feed_metadata
   where nullif(btrim(raw_platform),'') is not null
    and upper(btrim(raw_platform)) not in('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
   group by dataset,source_system,raw_country,raw_platform,direction,provenance
) select * from actual;
