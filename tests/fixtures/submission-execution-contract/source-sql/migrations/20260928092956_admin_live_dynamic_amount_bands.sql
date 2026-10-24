-- Optional, shared ten-band amount analysis for the current authorized engine.
-- Only amount_range / matrix_range change; exact amount / matrix stay intact.
-- Boundaries classify original orders before aggregation. No existing totals
-- are split, interpolated or estimated. Fee bands and amount filters are separate.
-- Apply after the current LG/USDT/fee-band engine; existing wrappers and ACLs
-- are preserved by replacing only checked fragments of each current raw body.
begin;

create or replace function private.dashboard_admin_validate_amount_bands(p_bands jsonb,p_direction text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare direction_key text; edge jsonb; previous_edge numeric; current_edge numeric;
begin
  if p_bands is null then return null; end if;
  if jsonb_typeof(p_bands) is distinct from 'object' then
    raise exception using errcode='22023',message='invalid_amount_bands';
  end if;
  if p_direction not in ('all','charge','withdraw') or p_direction is null
    or exists(select 1 from jsonb_object_keys(p_bands) k where k not in ('charge','withdraw'))
    or (p_direction in ('all','charge') and not p_bands ? 'charge')
    or (p_direction in ('all','withdraw') and not p_bands ? 'withdraw') then
    raise exception using errcode='22023',message='invalid_amount_bands';
  end if;
  foreach direction_key in array array['charge','withdraw'] loop
    if not p_bands ? direction_key then continue; end if;
    if jsonb_typeof(p_bands->direction_key) is distinct from 'array' then
      raise exception using errcode='22023',message='invalid_amount_bands';
    end if;
    if jsonb_array_length(p_bands->direction_key)<>11 then
      raise exception using errcode='22023',message='invalid_amount_bands';
    end if;
    previous_edge:=null;
    for edge in select value from jsonb_array_elements(p_bands->direction_key) loop
      if jsonb_typeof(edge) is distinct from 'number' then
        raise exception using errcode='22023',message='invalid_amount_bands';
      end if;
      current_edge:=(edge#>>'{}')::numeric;
      if current_edge::text in ('NaN','Infinity','-Infinity') or current_edge<0
        or current_edge>1000000000000000 or current_edge<=previous_edge then
        raise exception using errcode='22023',message='invalid_amount_bands';
      end if;
      previous_edge:=current_edge;
    end loop;
  end loop;
  return p_bands;
end;
$$;
revoke all on function private.dashboard_admin_validate_amount_bands(jsonb,text) from public,anon,authenticated;

do $patch$
declare
  engine record; definition text; updated text; old_anchor text; new_anchor text;
  change record; edges text; dynamic_range text;
  old_range text:=$range$case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end as amount_range_bucket$range$;
begin
  for engine in select * from (values
    ('private.dashboard_admin_live_query_raw(jsonb)',25,26,false),
    ('private.dashboard_admin_live_drilldown_raw(jsonb)',31,32,true)
  ) e(signature,charge_parameter,withdraw_parameter,is_drilldown) loop
    select pg_get_functiondef(to_regprocedure(engine.signature)) into definition;
    if definition is null then raise exception 'Missing amount-band baseline: %',engine.signature; end if;
    if position('dynamic_amount_bands_v1' in definition)>0 then
      if position('private.dashboard_admin_validate_amount_bands(' in definition)=0
        or position('width_bucket(amount,' in definition)=0
        or position('''amountBandsVersion'',1' in definition)=0 then
        raise exception 'Incomplete dynamic amount-band installation: %',engine.signature;
      end if;
      continue;
    end if;
    -- These positions are appended to the existing bound parameter list.
    -- Refuse a changed baseline instead of reusing a parameter for another value.
    if definition ~ ('\$'||engine.charge_parameter::text||'([^0-9]|$)')
      or definition ~ ('\$'||engine.withdraw_parameter::text||'([^0-9]|$)') then
      raise exception 'Amount-band parameter baseline changed: %',engine.signature;
    end if;
    edges:=format('(case when direction=''charge'' then $%s::numeric[] else $%s::numeric[] end)',engine.charge_parameter,engine.withdraw_parameter);
    dynamic_range:='case when '||edges||' is not null then case
        when amount is null or amount::text in (''NaN'',''Infinity'',''-Infinity'') then ''unknown''
        when amount<'||edges||'[1] then ''below''
        when amount>'||edges||'[11] then ''above''
        else ''band:''||(least(width_bucket(amount,'||edges||'),10)-1)::text end
        else '||replace(old_range,' as amount_range_bucket','')||' end as amount_range_bucket';
    updated:=definition;
    for change in select * from (values
      ($old$  v_confirmations jsonb := '{}'::jsonb;$old$,
       $new$  v_confirmations jsonb := '{}'::jsonb;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];$new$),
      ($old$'amountMin','amountMax','offset'$old$,$new$'amountMin','amountMax','amountBands','offset'$new$),
      ($old$  v_action:=coalesce(p_request->>'action','catalog');$old$,
       $new$  v_action:=coalesce(p_request->>'action','catalog');
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;$new$),
      (old_range,dynamic_range),
      (case when engine.is_drilldown then
         'v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country;'
       else 'v_platform.source_name,v_third,v_confirmations;' end,
       case when engine.is_drilldown then
         'v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country,v_charge_edges,v_withdraw_edges;'
       else 'v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges;' end),
      ($old$  return v_result||jsonb_build_object('version',1,'platform',v_meta,$old$,
       $new$  return v_result||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,$new$)
    ) anchors(old_text,new_text) loop
      if (length(updated)-length(replace(updated,change.old_text,'')))/length(change.old_text)<>1 then
        raise exception 'Amount-band anchor missing or ambiguous in %: %',engine.signature,left(change.old_text,100);
      end if;
      updated:=replace(updated,change.old_text,change.new_text);
    end loop;
    if engine.is_drilldown then
      old_anchor:=$old$or (v_kind in('amount_range','matrix_range') and v_bucket_text not in('100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown'))$old$;
      new_anchor:=$new$or (v_kind in('amount_range','matrix_range') and (
          (v_amount_bands is null and v_bucket_text not in('100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown'))
          or (v_amount_bands is not null and v_bucket_text !~ '^(band:[0-9]|below|above|unknown)$')))$new$;
      if (length(updated)-length(replace(updated,old_anchor,'')))/length(old_anchor)<>1 then
        raise exception 'Amount-band drilldown validation anchor missing or ambiguous';
      end if;
      updated:=replace(updated,old_anchor,new_anchor);
    end if;
    execute updated;
  end loop;
end;
$patch$;
notify pgrst,'reload schema';
commit;
