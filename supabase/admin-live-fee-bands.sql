-- Add successful per-order amount-band facts to the existing authorized engine.
-- No ledger changes, new data access path or rate applied to aggregate totals.
-- Current owner-confirmed Speed2Pay estimate: <=2000: 3%+6; >=2001: 2%.
-- The (2000,2001) gap, negative and missing amounts remain explicitly unpriced.
-- Install after the current admin-live-lg-native.sql engine. Reapplying is safe.
begin;
do $patch$
declare definition text; updated text; old_anchor text; new_anchor text;
begin
  select pg_get_functiondef('private.dashboard_admin_live_query_raw(jsonb)'::regprocedure) into definition;
  updated:=definition;
  if position('fee_bands_v1' in definition)=0 then
    if position('public.lg_orders' in definition)=0 or position('created_metrics' in definition)=0 then
      raise exception 'Unsupported live-query baseline; install the current LG native engine first';
    end if;
    old_anchor:=$old0$  ), created_metrics as ($old0$;
    new_anchor:=$new0$  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), created_metrics as ($new0$;
    if (length(updated)-length(replace(updated,old_anchor,'')))/length(old_anchor)<>1 then
      raise exception 'Fee-band query anchor 1 missing or ambiguous; no changes applied';
    end if;
    updated:=replace(updated,old_anchor,new_anchor);
    old_anchor:=$old1$    ), metric as ($old1$;
    new_anchor:=$new1$    ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), metric as ($new1$;
    if (length(updated)-length(replace(updated,old_anchor,'')))/length(old_anchor)<>1 then
      raise exception 'Fee-band query anchor 2 missing or ambiguous; no changes applied';
    end if;
    updated:=replace(updated,old_anchor,new_anchor);
    old_anchor:=$old2$'unknown_amount',unknown_amount::text) as value
    from metrics m$old2$;
    new_anchor:=$new2$'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) as value
    from metrics m left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$new2$;
    if (length(updated)-length(replace(updated,old_anchor,'')))/length(old_anchor)<>1 then
      raise exception 'Fee-band query anchor 3 missing or ambiguous; no changes applied';
    end if;
    updated:=replace(updated,old_anchor,new_anchor);
    old_anchor:=$old3$'unknown_amount',unknown_amount::text) as value from metric m$old3$;
    new_anchor:=$new3$'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) as value from metric m
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$new3$;
    if (length(updated)-length(replace(updated,old_anchor,'')))/length(old_anchor)<>1 then
      raise exception 'Fee-band query anchor 4 missing or ambiguous; no changes applied';
    end if;
    updated:=replace(updated,old_anchor,new_anchor);
    execute updated;
  elsif (length(definition)-length(replace(definition,'fee_bands_v1','')))/length('fee_bands_v1')<>2 then
    raise exception 'Incomplete fee-band query installation';
  end if;

  -- Canonical aliases must add the same band facts, exactly as ledger totals.
  select pg_get_functiondef('private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure) into definition;
  updated:=definition;
  if position('fee_low_count' in definition)=0 then
    old_anchor:=$old$'rejected_count','unknown_count'];$old$;
    new_anchor:=$new$'rejected_count','unknown_count','fee_low_count','fee_high_count','fee_gap_count','fee_unpriced_count'];$new$;
    if (length(updated)-length(replace(updated,old_anchor,'')))/length(old_anchor)<>1 then
      raise exception 'Fee-band count merge anchor missing or ambiguous';
    end if;
    updated:=replace(updated,old_anchor,new_anchor);
    old_anchor:=$old$'rejected_amount','unknown_amount'];$old$;
    new_anchor:=$new$'rejected_amount','unknown_amount','fee_low_amount','fee_high_amount','fee_gap_amount'];$new$;
    if (length(updated)-length(replace(updated,old_anchor,'')))/length(old_anchor)<>1 then
      raise exception 'Fee-band amount merge anchor missing or ambiguous';
    end if;
    execute replace(updated,old_anchor,new_anchor);
  elsif position('fee_gap_amount' in definition)=0 or position('fee_unpriced_count' in definition)=0 then
    raise exception 'Incomplete fee-band canonical merge installation';
  end if;
end;
$patch$;
-- CREATE OR REPLACE preserves existing function grants. Do not widen access.
commit;
