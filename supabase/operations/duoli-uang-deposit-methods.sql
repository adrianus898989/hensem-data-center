BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='45s'; SET LOCAL jit=off;
DO $check$ BEGIN IF EXISTS(SELECT FROM (VALUES ('private.prepared_aggregate_raw_kernel(jsonb,jsonb)','da3594f83b749af4e41a91a444b1f5b5'),('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)','e4986bd18e2c81801c0ddfaffdf05c7e'),('private.prepared_aggregate_dependency_common(text)','678dea2b51a51ce96a301a6f249af617'),('private.provider_snapshot_dependency_token(jsonb)','5313f9643451b6b34066d66c89d81a88'),('private.prepared_aggregate_dependency(jsonb,text)','ccf24ec57a46a3d19a05b3051b2be1a8'))d(sig,hash) WHERE md5(pg_get_functiondef(to_regprocedure(sig))) IS DISTINCT FROM hash) THEN RAISE EXCEPTION 'doli method definition CAS'; END IF; END $check$;
CREATE TEMP TABLE doli_method_targets ON COMMIT DROP AS
SELECT to_jsonb(c) t FROM private.prepared_aggregate_native_catalog() c
UNION SELECT DISTINCT j.target FROM private.prepared_aggregate_jobs j JOIN private.prepared_aggregate_heads h ON h.job_id=j.id;
CREATE TEMP VIEW doli_method_contract AS
WITH targets AS MATERIALIZED (SELECT t,CASE WHEN t->>'source'='game66' THEN 'IN' ELSE t->>'scope_group' END scope,
  coalesce(t->>'source'='duoli' AND t->>'team'='M8' AND t->>'scope_group'='ID' AND t->>'currency'='IDR' AND t->>'timezone'='Asia/Jakarta'
     AND (t->>'id',t->>'source_name') IN (('143b5aa9-2f27-2405-ab40-99ffc25c56f2','UANG')),false) affected FROM doli_method_targets),
scopes AS MATERIALIZED (SELECT scope,private.prepared_aggregate_dependency_common(scope) dep FROM (SELECT DISTINCT scope FROM targets) t)
SELECT 'scope' k,scope id,dep v,false affected FROM scopes
UNION ALL SELECT 'target',t::text,private.prepared_aggregate_dependency(t,dep),affected FROM targets JOIN scopes USING(scope)
UNION ALL SELECT 'head',h.job_id::text,jsonb_build_array(h.artifact_id,a.dependency,a.cutoff,a.bytes,a.source_complete)::text,false
FROM private.prepared_aggregate_heads h JOIN private.prepared_aggregate_artifacts a ON a.id=h.artifact_id
UNION ALL SELECT 'snapshot',t::text,private.provider_snapshot_dependency_token(t),false FROM targets WHERE affected OR t->>'id' IN ('53f346a3-846d-361e-a18b-9ba7965f0c2a','acdeebb2-fb0a-e01b-e00d-c18506ecbe19');
CREATE TEMP TABLE doli_method_before ON COMMIT DROP AS TABLE doli_method_contract;

-- The deployed UANG revision, expressed as changes to the pre-existing function definitions.
-- Run only on the exact preceding revision. The original transaction checks scope, dependencies and published heads.
DO $doli_changes$
DECLARE definition text;
BEGIN
  -- private.prepared_aggregate_raw_kernel(jsonb,jsonb)
  definition:=pg_get_functiondef('private.prepared_aggregate_raw_kernel(jsonb,jsonb)'::regprocedure);
  definition:=replace(definition,
$old$  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
$old$,
$new$  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_doli_map jsonb; v_doli_column text; v_doli_filter_anchor text;
$new$);
  definition:=replace(definition,
$old$  v_source:=private.prepared_aggregate_source_clocks(v_source,v_platform.source,case when v_secondary_available then v_basis else 'legacy' end);
$old$,
$new$  v_source:=private.prepared_aggregate_source_clocks(v_source,v_platform.source,case when v_secondary_available then v_basis else 'legacy' end);
  -- Keep channel_type intact for fees, filters and details. Decode only the charge breakdown.
  if v_action='aggregate' and v_direction in ('all','charge') and v_platform.source='duoli'
    and v_platform.scope_group='ID' and v_platform.team='M8' and v_platform.currency='IDR' and v_platform.timezone='Asia/Jakarta'
    and (v_platform.id::text,v_platform.source_name) in (('143b5aa9-2f27-2405-ab40-99ffc25c56f2','UANG'))
    and coalesce(p_request->>'view','full') in ('full','providers') and (v_basis='created' or v_secondary_available) then
    v_doli_map:='{"UANG":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"}}'::jsonb -> v_platform.source_name;
    v_doli_column:=format($doli$case when d.business='recharge' then coalesce(
       %L::jsonb ->> nullif(btrim(d.raw_projection->>'pay_type'),''),
       case when nullif(btrim(d.raw_projection->>'pay_type'),'') is not null
            then '类型代码 '||btrim(d.raw_projection->>'pay_type') end) end as doli_method$doli$,v_doli_map::text);
    if (length(v_source)-length(replace(v_source,' as raw_provider','')))<>length(' as raw_provider') then
      raise exception using errcode='55000',message='doli_method_source_contract_drift';
    end if;
    v_source:=replace(v_source,' as raw_provider',' as raw_provider, '||v_doli_column);
  end if;
$new$);
  definition:=replace(definition,
$old$  -- LG111 charge method rows use this query's original materialized orders and both time windows.
$old$,
$new$  -- Expose the supplementary source value in the same filtered set in each query shape.
  if v_doli_map is not null then
    v_doli_filter_anchor:=case when p_request->>'view'='providers'
        then 'select direction,currency,provider,channel_type,status_group,created_at,success_at,'
        else 'case when $19<>''aggregate'' then raw_provider end as raw_provider,' end;
    if (length(v_sql)-length(replace(v_sql,v_doli_filter_anchor,'')))<>length(v_doli_filter_anchor) then
      raise exception using errcode='55000',message='doli_method_filtered_contract_drift';
    end if;
    v_sql:=replace(v_sql,v_doli_filter_anchor,v_doli_filter_anchor||'doli_method,');
  end if;
  -- IDR provider subtotals reuse this filtered set and both original time windows.
$new$);
  definition:=replace(definition,
$old$    or (v_platform.id='acdeebb2-fb0a-e01b-e00d-c18506ecbe19'::uuid and v_platform.source='ar' and v_platform.source_name='55FIVE'))
$old$,
$new$    or (v_platform.id='acdeebb2-fb0a-e01b-e00d-c18506ecbe19'::uuid and v_platform.source='ar' and v_platform.source_name='55FIVE') or v_doli_map is not null)
$new$);
  definition:=replace(definition,
$old$      select provider,currency,channel_type,status_group,case when $22='55FIVE' then null::numeric else amount end amount,created_in_range,success_in_range
$old$,
$new$      select provider,currency,$lg_methods$||case when v_doli_map is not null then 'doli_method as channel_type' else 'channel_type' end||$lg_methods$,status_group,case when $22='55FIVE' then null::numeric else amount end amount,created_in_range,success_in_range
$new$);
  IF md5(definition) IS DISTINCT FROM '54ea6c92ab13cc7266493a1d95beee9e' THEN RAISE EXCEPTION 'kernel edit mismatch'; END IF;
  EXECUTE definition;
  -- private.prepared_aggregate_dependency(jsonb,text)
  definition:=pg_get_functiondef('private.prepared_aggregate_dependency(jsonb,text)'::regprocedure);
  definition:=replace(definition,
$old$    from pg_proc p where p.oid='panda_private.prepared_window(text,text,timestamptz,timestamptz)'::regprocedure))::text)
$old$,
$new$    from pg_proc p where p.oid='panda_private.prepared_window(text,text,timestamptz,timestamptz)'::regprocedure))::text)

 when p_target->>'source'='duoli' and p_target->>'team'='M8' and p_target->>'scope_group'='ID' and p_target->>'currency'='IDR' and p_target->>'timezone'='Asia/Jakarta' and (p_target->>'id',p_target->>'source_name') in (('143b5aa9-2f27-2405-ab40-99ffc25c56f2','UANG')) then md5(jsonb_build_array(previous.token,'doli-charge-methods-v1','{"UANG":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"}}'::jsonb -> (p_target->>'source_name'))::text)
$new$);
  IF md5(definition) IS DISTINCT FROM '8f26449b45d6b46d8841a68ae760fba2' THEN RAISE EXCEPTION 'dependency edit mismatch'; END IF;
  EXECUTE definition;
  -- private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)
  definition:=pg_get_functiondef('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)'::regprocedure);
  definition:=replace(definition,
$old$  IF md5(p.prosrc)='d7b37bc65863c46df07766fb72bd91c6' AND pg_get_userbyid(p.proowner)='postgres'
$old$,
$new$  IF md5(p.prosrc)='6dc5632b236c55bfabd22ab54bf44ab0' AND pg_get_userbyid(p.proowner)='postgres'
$new$);
  definition:=replace(definition,
$old$  THEN RETURN '7a63e2a1ff52054f87247926772758e1'; END IF;
$old$,
$new$  THEN RETURN '7a63e2a1ff52054f87247926772758e1'; END IF;
  RETURN md5(p.prosrc);
 END IF;

 IF p.oid=to_regprocedure('private.prepared_aggregate_dependency(jsonb,text)') THEN
  IF md5(p.prosrc)='b6acb0728e0a0891e89057399334e85e' AND pg_get_userbyid(p.proowner)='postgres'
    AND p.proacl::text='{postgres=X/postgres}' AND p.proconfig=ARRAY['search_path=""']
    AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND NOT p.prosecdef
    AND p.provolatile='s' AND NOT p.proisstrict AND p.proparallel='u' AND NOT p.proleakproof
    AND p.procost=100 AND p.prorows=0 AND NOT p.proretset AND p.pronargdefaults=0
    AND pg_get_function_arguments(p.oid)='p_target jsonb, p_common text'
    AND pg_get_function_result(p.oid)='text'
  THEN RETURN '8abe872feeb5ab4b2a7f2ee662e39dba'; END IF;
$new$);
  IF md5(definition) IS DISTINCT FROM '235104f0586a8f6df1b6bfbd3b60b8e0' THEN RAISE EXCEPTION 'helper edit mismatch'; END IF;
  EXECUTE definition;
  -- private.prepared_aggregate_dependency_common(text)
  definition:=pg_get_functiondef('private.prepared_aggregate_dependency_common(text)'::regprocedure);
  definition:=replace(definition,
$old$77fa4965309a7defa4c7efd094375b96$old$,
$new$5e12e838217f9dd6e9d026bee5557708$new$);
  IF md5(definition) IS DISTINCT FROM '2e03b869dc13e2a05ca46a9baefe1365' THEN RAISE EXCEPTION 'common edit mismatch'; END IF;
  EXECUTE definition;
  -- private.provider_snapshot_dependency_token(jsonb)
  definition:=pg_get_functiondef('private.provider_snapshot_dependency_token(jsonb)'::regprocedure);
  definition:=replace(definition,
$old$77fa4965309a7defa4c7efd094375b96$old$,
$new$5e12e838217f9dd6e9d026bee5557708$new$);
  IF md5(definition) IS DISTINCT FROM '8b2255b7575fff3700eddb7271605cca' THEN RAISE EXCEPTION 'snapshot edit mismatch'; END IF;
  EXECUTE definition;
END $doli_changes$;

DO $check$ BEGIN IF EXISTS(SELECT FROM (VALUES ('private.prepared_aggregate_raw_kernel(jsonb,jsonb)','54ea6c92ab13cc7266493a1d95beee9e'),('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)','235104f0586a8f6df1b6bfbd3b60b8e0'),('private.prepared_aggregate_dependency_common(text)','2e03b869dc13e2a05ca46a9baefe1365'),('private.provider_snapshot_dependency_token(jsonb)','8b2255b7575fff3700eddb7271605cca'),('private.prepared_aggregate_dependency(jsonb,text)','8f26449b45d6b46d8841a68ae760fba2'))d(sig,hash) WHERE md5(pg_get_functiondef(to_regprocedure(sig))) IS DISTINCT FROM hash) THEN RAISE EXCEPTION 'doli method definition CAS'; END IF; END $check$;
CREATE TEMP TABLE doli_method_after ON COMMIT DROP AS TABLE doli_method_contract;
DO $verify$
BEGIN
 IF NOT EXISTS (SELECT FROM doli_method_before WHERE affected)
    OR EXISTS (SELECT FROM doli_method_before b FULL JOIN doli_method_after a USING(k,id)
      WHERE b.k IS NULL OR a.k IS NULL OR b.affected IS DISTINCT FROM a.affected
      OR (b.affected AND b.v IS NOT DISTINCT FROM a.v) OR (NOT b.affected AND b.v IS DISTINCT FROM a.v)) THEN
   RAISE EXCEPTION 'unexpected change to prepared or snapshot dependency or published heads';
 END IF;
END $verify$;
SELECT k,affected,count(*) verified FROM doli_method_after GROUP BY k,affected ORDER BY k,affected;
DROP VIEW doli_method_contract;

COMMIT;
