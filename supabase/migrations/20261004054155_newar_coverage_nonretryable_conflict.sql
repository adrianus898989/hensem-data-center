-- Preserve all proof, launch, credential and scope checks. Only the two
-- application-level pending exceptions become non-retryable HTTP conflicts.
-- PostgREST 14 automatically retries 40001 transactions indefinitely.
-- Existing in-flight looping backends require separate targeted recovery.
DO $repair$
DECLARE
 target oid := to_regprocedure('private.ingest_newar_detail_coverage(text,jsonb)');
 baseline constant text := '4632a0889b11e68defaa1473ca4541ed';
 repaired constant text := 'b74b197a2b326fddc8eef613d038c370';
 old_anchor constant text := 'ERRCODE=''40001'',MESSAGE=''NEWAR_COVERAGE_PENDING''';
 new_anchor constant text := 'ERRCODE=''PT409'',MESSAGE=''NEWAR_COVERAGE_PENDING''';
 original_source text; original_definition text; patched_definition text; replacement_count integer;
 original_owner oid; original_acl aclitem[]; original_security_definer boolean; original_config text[];
 after_source text; after_owner oid; after_acl aclitem[]; after_security_definer boolean; after_config text[];
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 PERFORM set_config('statement_timeout','15s',true);
 IF target IS NULL THEN RAISE EXCEPTION 'NEWAR_COVERAGE_FUNCTION_MISSING'; END IF;
 SELECT prosrc,pg_get_functiondef(oid),proowner,proacl,prosecdef,proconfig
 INTO original_source,original_definition,original_owner,original_acl,original_security_definer,original_config
 FROM pg_proc WHERE oid=target;
 IF md5(original_source)=repaired THEN
  IF strpos(original_source,old_anchor)>0 OR (length(original_source)-length(replace(original_source,new_anchor,'')))/length(new_anchor)<>2
  THEN RAISE EXCEPTION 'NEWAR_COVERAGE_REPAIRED_BODY_INVALID'; END IF;
  RETURN;
 END IF;
 IF md5(original_source)<>baseline THEN RAISE EXCEPTION 'NEWAR_COVERAGE_BASELINE_CHANGED'; END IF;
 replacement_count := (length(original_source)-length(replace(original_source,old_anchor,'')))/length(old_anchor);
 IF replacement_count<>2 THEN RAISE EXCEPTION 'NEWAR_COVERAGE_PENDING_ANCHOR_CHANGED'; END IF;
 patched_definition := replace(original_definition,old_anchor,new_anchor);
 IF patched_definition=original_definition THEN RAISE EXCEPTION 'NEWAR_COVERAGE_PATCH_EMPTY'; END IF;
 EXECUTE patched_definition;
 SELECT prosrc,proowner,proacl,prosecdef,proconfig
 INTO after_source,after_owner,after_acl,after_security_definer,after_config FROM pg_proc WHERE oid=target;
 IF md5(after_source)<>repaired OR after_source<>replace(original_source,old_anchor,new_anchor)
 THEN RAISE EXCEPTION 'NEWAR_COVERAGE_PATCH_NOT_EXACT'; END IF;
 IF after_owner IS DISTINCT FROM original_owner OR after_acl IS DISTINCT FROM original_acl
  OR after_security_definer IS DISTINCT FROM original_security_definer OR after_config IS DISTINCT FROM original_config
 THEN RAISE EXCEPTION 'NEWAR_COVERAGE_EXECUTION_METADATA_CHANGED'; END IF;
END $repair$;
