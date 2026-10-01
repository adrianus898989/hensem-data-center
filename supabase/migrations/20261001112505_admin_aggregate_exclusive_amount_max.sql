-- Optional exclusive upper bound for independently queried amount intervals.
-- Existing callers retain their inclusive amountMax semantics. All native
-- sources share the full/provider aggregate predicates patched below.
begin;
do $patch$
declare
  p record; d text; old_acl aclitem[]; old_owner oid; r record; n integer;
begin
  select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_query_raw(jsonb)');
  if not p.prosecdef or p.provolatile<>'s' or p.prorettype<>'jsonb'::regtype
    or p.prolang<>(select oid from pg_language where lanname='plpgsql')
    or p.proconfig is distinct from array['search_path=""','jit=off'] then
    raise exception 'exclusive_amount_engine_contract_drift';
  end if;
  d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
  if position('-- aggregate_exclusive_amount_max_v1' in d)>0 then
    if position('v_duration_custom,v_max_exclusive;' in d)=0
      or position('jsonb_typeof(p_request->''amountMaxExclusive'') is distinct from ''boolean''' in d)=0
      or (length(d)-length(replace(d,'($16 is null or case when $31 then amount<$16 else amount<=$16 end)','')))
        /length('($16 is null or case when $31 then amount<$16 else amount<=$16 end)')<>2 then
      raise exception 'exclusive_amount_installation_incomplete';
    end if;
    return;
  end if;
  if position('dynamic_amount_bands_v1' in d)=0 or position('duration_precision_ranges_v2' in d)=0
    or d~'\$31([^0-9]|$)' then raise exception 'exclusive_amount_parameter_baseline_drift';end if;
  for r in select * from (values
    ($old$  v_confirmations jsonb := '{}'::jsonb;$old$,
     $new$  v_confirmations jsonb := '{}'::jsonb;
  -- aggregate_exclusive_amount_max_v1: one parsed boolean, never epsilon math.
  v_max_exclusive boolean := false;$new$,1),
    ($old$'amountMin','amountMax','amountBands'$old$,
     $new$'amountMin','amountMax','amountMaxExclusive','amountBands'$new$,1),
    ($old$  select * into v_platform from jsonb_to_recordset(v_options)$old$,
     $new$  if p_request?'amountMaxExclusive' then
    if v_action<>'aggregate' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then
      raise exception using errcode='22023',message='invalid_range';
    end if;
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)$new$,1),
    ($old$($16 is null or amount<=$16)$old$,
     $new$($16 is null or case when $31 then amount<$16 else amount<=$16 end)$new$,2),
    ($old$v_duration_version,v_duration_min,v_duration_max,v_duration_custom;$old$,
     $new$v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive;$new$,1)
  ) a(old_text,new_text,expected_count) loop
    n:=(length(d)-length(replace(d,r.old_text,'')))/length(r.old_text);
    if n<>r.expected_count then raise exception 'exclusive_amount_anchor_drift: %',left(r.old_text,100);end if;
    d:=replace(d,r.old_text,r.new_text);
  end loop;
  execute d;
  if exists(select 1 from pg_proc q where q.oid=p.oid
    and(q.proacl is distinct from old_acl or q.proowner<>old_owner or q.proconfig is distinct from p.proconfig)) then
    raise exception 'exclusive_amount_acl_changed';
  end if;
end;
$patch$;
notify pgrst,'reload schema';
commit;
