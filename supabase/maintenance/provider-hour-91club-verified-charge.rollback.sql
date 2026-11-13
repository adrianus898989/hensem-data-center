-- Amend the approved 91CLUB source selection in the existing matrix RPC only.
set local lock_timeout = '2s';
do $install$
declare
  target regprocedure := 'private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  fingerprint text;
begin
  select md5(prosrc) into fingerprint from pg_proc where oid=target;
  if fingerprint='eccdf823c61341254a60396ab87735b3' then return; end if;
  if fingerprint<>'92c9cdc9cc04dd7ca9ba2d7fc2f6c156' then raise exception 'provider_hour_verified_charge_baseline_changed'; end if;
  definition:=replace(definition,$old$      if v_ar_full_hour then
        -- Validated identity constraints in the recharge proof establish its
        -- single order kind. Avoid fetching a heap row just for that constant.
        v_source := replace(v_source, $f$and $7::text='charge'$f$, $f$and $7::text='all'$f$);
        v_source := replace(v_source,'a.order_kind',$literal$'recharge'::text$literal$)
          || ' union all ' || v_ar_withdraw_source;
      else
        v_capabilities:=v_capabilities||jsonb_build_object('detailInput','verified_native_projection','syncTimestampAvailable',false);
      end if;$old$,$new$      v_capabilities:=v_capabilities||jsonb_build_object('detailInput','verified_native_projection','syncTimestampAvailable',false);$new$);
  definition:=replace(definition,$old$      if v_ar_full_hour then
        -- Save the ordinary native withdrawal slice before substituting the
        -- certified charge source. Its platform, date and order filters stay.
        v_ar_withdraw_source := replace(v_source,
          $kind$a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)$kind$,
          $kind$a.order_kind='withdraw' and $7::text='all'$kind$);
      end if;
      v_source:=replace(v_source,'from public.ar_collected_orders a',format($adapter$from ($old$,$new$      v_source:=replace(v_source,'from public.ar_collected_orders a',format($adapter$from ($new$);
  definition:=replace(definition,$old$and v_platform.timezone='Asia/Kolkata' and (v_direction='charge' or v_ar_full_hour)$old$,$new$and v_platform.timezone='Asia/Kolkata' and v_direction='charge'$new$);
  definition:=replace(definition,$old$  -- The certified 91CLUB projection contains recharge only. For an unfiltered
  -- two-direction creation matrix its exact rows may replace that branch alone.
  v_ar_full_hour := v_platform.source_name='91CLUB' and v_direction='all'
    and p_request ? 'providerHourMatrix' and v_min is null and v_max is null
    and v_types is null and v_providers is null and v_member is null and v_order is null;
  -- Reuse only existing maintained native projections and their full proofs.$old$,$new$  -- Reuse only existing maintained native projections and their full proofs.$new$);
  definition:=replace(definition,$old$  v_ar_fact_table text:=null;
  v_ar_withdraw_source text;
  v_ar_full_hour boolean;$old$,$new$  v_ar_fact_table text:=null;$new$);
  execute definition;
  if (select md5(prosrc) from pg_proc where oid=target) is distinct from 'eccdf823c61341254a60396ab87735b3' then
    raise exception 'provider_hour_verified_charge_installation_incomplete';
  end if;
end
$install$;
