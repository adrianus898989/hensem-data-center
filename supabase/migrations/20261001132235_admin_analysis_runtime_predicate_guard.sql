-- Detect later changes to the AR source predicate before assembling the two
-- disjoint indexed branches. A missed replacement must fail rather than double
-- source rows. No permissions, account, data, schema or collector changes.
begin;
set local statement_timeout='30s';
do $patch$
declare p record;d text;v_name text;old_time text;anchor text;guard_text text;
begin
  foreach v_name in array array['dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw'] loop
    select * into strict p from pg_proc where oid=to_regprocedure('private.'||v_name||'(jsonb)');
    if not p.prosecdef or p.provolatile<>'s' or p.prorettype<>'jsonb'::regtype
      or p.prolang<>(select oid from pg_language where lanname='plpgsql')
      or p.proconfig is distinct from array['search_path=""','jit=off'] then
      raise exception 'analytical_guard_engine_contract_drift: %',v_name;
    end if;
    d:=pg_get_functiondef(p.oid);
    if position('custom_ar_date_union_v1' in d)=0 then raise exception 'analytical_guard_union_required: %',v_name;end if;
    anchor:='v_source:=replace(v_source,$ar_old$';
    if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then
      raise exception 'analytical_guard_anchor_drift: %',v_name;
    end if;
    old_time:=split_part(split_part(d,anchor,2),'$ar_old$',1);
    if old_time='' or position('$ar_guard$' in old_time)>0 then raise exception 'analytical_guard_predicate_drift: %',v_name;end if;
    guard_text:='if position($ar_guard$'||old_time||'$ar_guard$ in v_source)=0 then raise exception using errcode=''55000'',message=''analytical_query_contract_drift'';end if;';
    if position('analytical_query_contract_drift' in d)>0 then
      if position(guard_text in d)=0 then raise exception 'analytical_guard_installation_incomplete: %',v_name;end if;
      continue;
    end if;
    d:=replace(d,anchor,guard_text||E'\n      '||anchor);
    execute d;
    if exists(select 1 from pg_proc q where q.oid=p.oid and
      (q.proacl is distinct from p.proacl or q.proowner<>p.proowner or q.proconfig is distinct from p.proconfig)) then
      raise exception 'analytical_guard_acl_changed';
    end if;
  end loop;
end;
$patch$;
notify pgrst,'reload schema';
commit;
