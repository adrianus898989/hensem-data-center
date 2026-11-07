BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='45s'; SET LOCAL jit=off;
DO $check$ BEGIN IF EXISTS(SELECT FROM (VALUES ('private.prepared_aggregate_raw_kernel(jsonb,jsonb)','54ea6c92ab13cc7266493a1d95beee9e'),('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)','235104f0586a8f6df1b6bfbd3b60b8e0'),('private.prepared_aggregate_dependency_common(text)','2e03b869dc13e2a05ca46a9baefe1365'),('private.provider_snapshot_dependency_token(jsonb)','8b2255b7575fff3700eddb7271605cca'),('private.prepared_aggregate_dependency(jsonb,text)','8f26449b45d6b46d8841a68ae760fba2'))d(sig,hash) WHERE md5(pg_get_functiondef(to_regprocedure(sig))) IS DISTINCT FROM hash) THEN RAISE EXCEPTION 'doli method definition CAS'; END IF; END $check$;
CREATE TEMP TABLE doli_method_targets ON COMMIT DROP AS
SELECT to_jsonb(c) t FROM private.prepared_aggregate_native_catalog() c
UNION SELECT DISTINCT j.target FROM private.prepared_aggregate_jobs j JOIN private.prepared_aggregate_heads h ON h.job_id=j.id;
CREATE TEMP VIEW doli_method_contract AS
WITH targets AS MATERIALIZED (SELECT t,CASE WHEN t->>'source'='game66' THEN 'IN' ELSE t->>'scope_group' END scope,
  coalesce(t->>'source'='duoli' AND t->>'team'='M8' AND t->>'scope_group'='ID' AND t->>'currency'='IDR' AND t->>'timezone'='Asia/Jakarta'
     AND (t->>'id',t->>'source_name') IN (('b82bdd0d-59fe-361d-bbb7-2982231e5d0e','FB168'),('45785d2c-9a68-cd4a-6420-72b7a3004df5','FB333'),('f5c0d911-9277-ddad-58d3-a0fbe086ebcf','HOT985'),('c0c3d321-c0b1-b115-cf15-0f336a793257','IND666')),false) affected FROM doli_method_targets),
scopes AS MATERIALIZED (SELECT scope,private.prepared_aggregate_dependency_common(scope) dep FROM (SELECT DISTINCT scope FROM targets) t)
SELECT 'scope' k,scope id,dep v,false affected FROM scopes
UNION ALL SELECT 'target',t::text,private.prepared_aggregate_dependency(t,dep),affected FROM targets JOIN scopes USING(scope)
UNION ALL SELECT 'head',h.job_id::text,jsonb_build_array(h.artifact_id,a.dependency,a.cutoff,a.bytes,a.source_complete)::text,false
FROM private.prepared_aggregate_heads h JOIN private.prepared_aggregate_artifacts a ON a.id=h.artifact_id
UNION ALL SELECT 'snapshot',t::text,private.provider_snapshot_dependency_token(t),false FROM targets WHERE affected OR t->>'id' IN ('53f346a3-846d-361e-a18b-9ba7965f0c2a','acdeebb2-fb0a-e01b-e00d-c18506ecbe19');
CREATE TEMP TABLE doli_method_before ON COMMIT DROP AS TABLE doli_method_contract;

-- Extend the deployed UANG revision to the four remaining DOLI sites.
-- Run only on the exact UANG revision. The transaction checks scope, dependencies and published heads.
DO $doli_changes$
DECLARE definition text;
BEGIN
  -- private.prepared_aggregate_raw_kernel(jsonb,jsonb)
  definition:=pg_get_functiondef('private.prepared_aggregate_raw_kernel(jsonb,jsonb)'::regprocedure);
  definition:=replace(definition,
$old$    and (v_platform.id::text,v_platform.source_name) in (('143b5aa9-2f27-2405-ab40-99ffc25c56f2','UANG'))
$old$,
$new$    and (v_platform.id::text,v_platform.source_name) in (('b82bdd0d-59fe-361d-bbb7-2982231e5d0e','FB168'),('45785d2c-9a68-cd4a-6420-72b7a3004df5','FB333'),('f5c0d911-9277-ddad-58d3-a0fbe086ebcf','HOT985'),('c0c3d321-c0b1-b115-cf15-0f336a793257','IND666'),('143b5aa9-2f27-2405-ab40-99ffc25c56f2','UANG'))
$new$);
  definition:=replace(definition,
$old$    v_doli_map:='{"UANG":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"}}'::jsonb -> v_platform.source_name;
$old$,
$new$    v_doli_map:='{"FB168":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"},"FB333":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"},"HOT985":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"},"IND666":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"},"UANG":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"}}'::jsonb -> v_platform.source_name;
$new$);
  IF md5(definition) IS DISTINCT FROM '7651e1bbb47acbde9229e5ca264d2f87' THEN RAISE EXCEPTION 'kernel edit mismatch'; END IF;
  EXECUTE definition;
  -- private.prepared_aggregate_dependency(jsonb,text)
  definition:=pg_get_functiondef('private.prepared_aggregate_dependency(jsonb,text)'::regprocedure);
  definition:=replace(definition,
$old$ when p_target->>'source'='duoli' and p_target->>'team'='M8' and p_target->>'scope_group'='ID' and p_target->>'currency'='IDR' and p_target->>'timezone'='Asia/Jakarta' and (p_target->>'id',p_target->>'source_name') in (('143b5aa9-2f27-2405-ab40-99ffc25c56f2','UANG')) then md5(jsonb_build_array(previous.token,'doli-charge-methods-v1','{"UANG":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"}}'::jsonb -> (p_target->>'source_name'))::text)
$old$,
$new$ when p_target->>'source'='duoli' and p_target->>'team'='M8' and p_target->>'scope_group'='ID' and p_target->>'currency'='IDR' and p_target->>'timezone'='Asia/Jakarta' and (p_target->>'id',p_target->>'source_name') in (('b82bdd0d-59fe-361d-bbb7-2982231e5d0e','FB168'),('45785d2c-9a68-cd4a-6420-72b7a3004df5','FB333'),('f5c0d911-9277-ddad-58d3-a0fbe086ebcf','HOT985'),('c0c3d321-c0b1-b115-cf15-0f336a793257','IND666'),('143b5aa9-2f27-2405-ab40-99ffc25c56f2','UANG')) then md5(jsonb_build_array(previous.token,'doli-charge-methods-v1','{"FB168":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"},"FB333":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"},"HOT985":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"},"IND666":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"},"UANG":{"12":"VA","14":"OVO","16":"QRIS","18":"LinkAja"}}'::jsonb -> (p_target->>'source_name'))::text)
$new$);
  IF md5(definition) IS DISTINCT FROM '74152dd631db1ac5fbd2fba6d98747e1' THEN RAISE EXCEPTION 'dependency edit mismatch'; END IF;
  EXECUTE definition;
  -- private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)
  definition:=pg_get_functiondef('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)'::regprocedure);
  definition:=replace(definition,
$old$  IF md5(p.prosrc)='6dc5632b236c55bfabd22ab54bf44ab0' AND pg_get_userbyid(p.proowner)='postgres'
$old$,
$new$  IF md5(p.prosrc)='6aff981bebaecb757c7266f2a0921c7c' AND pg_get_userbyid(p.proowner)='postgres'
$new$);
  definition:=replace(definition,
$old$  IF md5(p.prosrc)='b6acb0728e0a0891e89057399334e85e' AND pg_get_userbyid(p.proowner)='postgres'
$old$,
$new$  IF md5(p.prosrc)='c7791080b66afb43efea1558170ec6d2' AND pg_get_userbyid(p.proowner)='postgres'
$new$);
  IF md5(definition) IS DISTINCT FROM '0d3af8be2d861420505388157dabca3d' THEN RAISE EXCEPTION 'helper edit mismatch'; END IF;
  EXECUTE definition;
  -- private.prepared_aggregate_dependency_common(text)
  definition:=pg_get_functiondef('private.prepared_aggregate_dependency_common(text)'::regprocedure);
  definition:=replace(definition,
$old$5e12e838217f9dd6e9d026bee5557708$old$,
$new$b7bbc8b77c7e0ff2c6605ffe2be13277$new$);
  IF md5(definition) IS DISTINCT FROM '917d3b38c89a7e97b0da7e333e41fe59' THEN RAISE EXCEPTION 'common edit mismatch'; END IF;
  EXECUTE definition;
  -- private.provider_snapshot_dependency_token(jsonb)
  definition:=pg_get_functiondef('private.provider_snapshot_dependency_token(jsonb)'::regprocedure);
  definition:=replace(definition,
$old$5e12e838217f9dd6e9d026bee5557708$old$,
$new$b7bbc8b77c7e0ff2c6605ffe2be13277$new$);
  IF md5(definition) IS DISTINCT FROM '4c8d22463b7e0f8c96776ba6bfe16fa5' THEN RAISE EXCEPTION 'snapshot edit mismatch'; END IF;
  EXECUTE definition;
END $doli_changes$;

DO $check$ BEGIN IF EXISTS(SELECT FROM (VALUES ('private.prepared_aggregate_raw_kernel(jsonb,jsonb)','7651e1bbb47acbde9229e5ca264d2f87'),('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)','0d3af8be2d861420505388157dabca3d'),('private.prepared_aggregate_dependency_common(text)','917d3b38c89a7e97b0da7e333e41fe59'),('private.provider_snapshot_dependency_token(jsonb)','4c8d22463b7e0f8c96776ba6bfe16fa5'),('private.prepared_aggregate_dependency(jsonb,text)','74152dd631db1ac5fbd2fba6d98747e1'))d(sig,hash) WHERE md5(pg_get_functiondef(to_regprocedure(sig))) IS DISTINCT FROM hash) THEN RAISE EXCEPTION 'doli method definition CAS'; END IF; END $check$;
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
