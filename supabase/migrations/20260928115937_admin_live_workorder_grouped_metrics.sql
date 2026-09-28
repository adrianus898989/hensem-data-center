-- Aggregate typed columns before formatting JSON keys. Preserve full-range identity,
-- selected-cohort success/amount semantics, conflicts, authorization and partial coverage.
begin;
do $patch$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure) into definition;
 if position('original_provider_groups as materialized' in definition)>0 then return;end if;
 original:=$old0$  ), detail_metrics as (
    select k.key,count(*) as detail_count,
      count(*) filter(where d.original_order_no is null) as missing_order_number_count,
      count(*) filter(where d.original_order_no is null and d.source_order_no is not null) as source_order_only_count
    from details d cross join lateral (values ('summary'::text),
      (jsonb_build_array('direction',d.direction)::text),
      (jsonb_build_array('provider',d.provider,d.direction)::text),
      (jsonb_build_array('platform',d.country_code,d.platform_key,d.provider,d.direction)::text)) k(key)
    group by k.key
  ), original_scope_rows as (
    select o.*,k.key,true as eligible from originals o cross join lateral (values ('summary'::text),
      (jsonb_build_array('direction',o.direction)::text)) k(key)
    union all
    select o.*,k.key,cardinality(o.providers)=1 as eligible
    from originals o cross join lateral unnest(o.providers) p(provider)
    cross join lateral (values (jsonb_build_array('provider',p.provider,o.direction)::text),
      (jsonb_build_array('platform',o.country_code,o.platform_key,p.provider,o.direction)::text)) k(key)
  ), original_metrics as (
    select key,count(*) filter(where eligible) as order_count,
      count(*) filter(where eligible and successful) as success_count,
      case when count(*) filter(where eligible and amount is null)=0 then coalesce(sum(amount) filter(where eligible),0) end as order_amount,
      case when count(*) filter(where eligible and successful and amount is null)=0 then coalesce(sum(amount) filter(where eligible and successful),0) end as success_amount,
      count(*) filter(where eligible and amount_variants>1) as amount_conflict_count,
      count(*) filter(where eligible and amount_variants=0) as missing_amount_count,
      count(*) filter(where cardinality(providers)>1) as provider_conflict_count
    from original_scope_rows group by key
$old0$;
 replacement:=$new0$  ), detail_metrics as (
    select case grouping(d.country_code,d.platform_key,d.provider,d.direction)
      when 15 then 'summary'
      when 14 then jsonb_build_array('direction',d.direction)::text
      when 12 then jsonb_build_array('provider',d.provider,d.direction)::text
      else jsonb_build_array('platform',d.country_code,d.platform_key,d.provider,d.direction)::text end as key,
      count(*) as detail_count,
      count(*) filter(where d.original_order_no is null) as missing_order_number_count,
      count(*) filter(where d.original_order_no is null and d.source_order_no is not null) as source_order_only_count
    from details d group by grouping sets ((),(d.direction),(d.provider,d.direction),(d.country_code,d.platform_key,d.provider,d.direction))
  ), original_metrics as (
    select case grouping(direction) when 1 then 'summary' else jsonb_build_array('direction',direction)::text end as key,
      count(*) as order_count,count(*) filter(where successful) as success_count,
      case when count(*) filter(where amount is null)=0 then coalesce(sum(amount),0) end as order_amount,
      case when count(*) filter(where successful and amount is null)=0 then coalesce(sum(amount) filter(where successful),0) end as success_amount,
      count(*) filter(where amount_variants>1) as amount_conflict_count,
      count(*) filter(where amount_variants=0) as missing_amount_count,
      count(*) filter(where cardinality(providers)>1) as provider_conflict_count
    from originals group by grouping sets ((),(direction))
    union all
    select case grouping(country_code,platform_key)
      when 3 then jsonb_build_array('provider',p.provider,direction)::text
      else jsonb_build_array('platform',country_code,platform_key,p.provider,direction)::text end as key,
      count(*) filter(where cardinality(providers)=1) as order_count,
      count(*) filter(where cardinality(providers)=1 and successful) as success_count,
      case when count(*) filter(where cardinality(providers)=1 and amount is null)=0 then coalesce(sum(amount) filter(where cardinality(providers)=1),0) end as order_amount,
      case when count(*) filter(where cardinality(providers)=1 and successful and amount is null)=0 then coalesce(sum(amount) filter(where cardinality(providers)=1 and successful),0) end as success_amount,
      count(*) filter(where cardinality(providers)=1 and amount_variants>1) as amount_conflict_count,
      count(*) filter(where cardinality(providers)=1 and amount_variants=0) as missing_amount_count,
      count(*) filter(where cardinality(providers)>1) as provider_conflict_count
    from originals cross join lateral unnest(providers) p(provider)
    group by grouping sets ((p.provider,direction),(country_code,platform_key,p.provider,direction))
$new0$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Workorder grouped metrics baseline 1 changed';end if;
 definition:=replace(definition,original,replacement);
 original:=$old1$  ), originals as materialized (
    -- One grouped pass across authorized source rows detects provider conflicts
    -- before selection while metrics use only the selected submitted cohort.
    -- Do not rejoin two original-order aggregates: JSON-input row estimates can
    -- turn that join into quadratic nested loops on real multi-platform ranges.
    select country_code,platform_key,direction,original_order_no,array_agg(distinct provider) as providers,
      bool_or(successful) filter(where selected_cohort) as successful,
      count(distinct amount) filter(where selected_cohort) as amount_variants,
      case when count(distinct amount) filter(where selected_cohort)=1
        then min(amount) filter(where selected_cohort) end as amount
    from mapped_details where original_order_no is not null
    group by country_code,platform_key,direction,original_order_no
    having bool_or(selected_cohort)
$old1$;
 replacement:=$new1$  ), original_provider_groups as materialized (
    select country_code,platform_key,direction,original_order_no,provider,
      bool_or(selected_cohort) as selected_cohort,
      bool_or(successful) filter(where selected_cohort) as successful,
      min(amount) filter(where selected_cohort) as amount_min,
      max(amount) filter(where selected_cohort) as amount_max
    from mapped_details where original_order_no is not null
    group by country_code,platform_key,direction,original_order_no,provider
  ), originals as materialized (
    select country_code,platform_key,direction,original_order_no,array_agg(provider) as providers,
      bool_or(successful) as successful,
      case when min(amount_min) is null then 0 when min(amount_min)=max(amount_max) then 1 else 2 end as amount_variants,
      case when min(amount_min)=max(amount_max) then min(amount_min) end as amount
    from original_provider_groups
    group by country_code,platform_key,direction,original_order_no
    having bool_or(selected_cohort)
$new1$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Workorder grouped metrics baseline 2 changed';end if;
 definition:=replace(definition,original,replacement);
 original:=$old2$select d.*,p.provider,d.payment_order_no as original_order_no,$old2$;
 replacement:=$new2$select d.country_code,d.platform_key,d.direction,d.source_order_no,d.amount,d.successful,p.provider,d.payment_order_no as original_order_no,$new2$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Workorder grouped metrics baseline 3 changed';end if;
 definition:=replace(definition,original,replacement);
 original:=$old3$and p.raw_provider=d.raw_provider and p.channel_type is not distinct from d.channel_type$old3$;
 replacement:=$new3$and p.raw_provider=d.raw_provider and coalesce(p.channel_type,'')=coalesce(d.channel_type,'')$new3$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Workorder grouped metrics baseline 4 changed';end if;
 definition:=replace(definition,original,replacement);
 execute definition;
end;
$patch$;
notify pgrst,'reload schema';
commit;
