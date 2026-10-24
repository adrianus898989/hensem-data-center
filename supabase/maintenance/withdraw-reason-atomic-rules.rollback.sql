-- Atomic rule grouping only. No source, report amount/date, queue, scheduler or collector writes.
BEGIN;
SET LOCAL lock_timeout='500ms';SET LOCAL statement_timeout='20s';
DO $repair$
DECLARE specs jsonb:='[{"name": "dashboard_admin_live_blocking_core", "signature": "private.dashboard_admin_live_blocking_core(text)", "old_hash": null, "new_hash": "d686cc6046014e8ba1bf45ba7607e922", "metadata": null, "language": null, "helper_metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "dashboard_admin_live_blocking_core", "prorows": 0, "pronargs": 1, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_note"], "proargtypes": ["25"], "proisstrict": false, "proparallel": "s", "protrftypes": null, "provariadic": "0", "provolatile": "i", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "helper_language": "plpgsql"}, {"name": "dashboard_admin_live_blocking_details_cleaned", "signature": "private.dashboard_admin_live_blocking_details_cleaned(text)", "old_hash": "0e02e32b895ce132c5f8815ad917369a", "new_hash": "67b7101e737b88e903e871bc4dd01637", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "dashboard_admin_live_blocking_details_cleaned", "prorows": 0, "pronargs": 1, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_note"], "proargtypes": ["25"], "proisstrict": false, "proparallel": "s", "protrftypes": null, "provariadic": "0", "provolatile": "i", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "dashboard_admin_live_blocking_members", "signature": "private.dashboard_admin_live_blocking_members(jsonb,text,text)", "old_hash": null, "new_hash": "5e595c96331e61da4bbb64813f37b938", "metadata": null, "language": null, "helper_metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "dashboard_admin_live_blocking_members", "prorows": 0, "pronargs": 3, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_details", "p_source", "p_state"], "proargtypes": ["3802", "25", "25"], "proisstrict": false, "proparallel": "s", "protrftypes": null, "provariadic": "0", "provolatile": "i", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "helper_language": "sql"}, {"name": "dashboard_admin_live_withdraw_reasons", "signature": "private.dashboard_admin_live_withdraw_reasons(jsonb)", "old_hash": "ca80e97796cd780b93e77f6e5dcb02dd", "new_hash": "7aebd2364163db75318c3fe60744ca70", "metadata": {"proacl": ["postgres=X/postgres", "authenticated=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "dashboard_admin_live_withdraw_reasons", "prorows": 0, "pronargs": 1, "proconfig": ["search_path=\"\"", "plan_cache_mode=force_custom_plan"], "proretset": false, "prosecdef": true, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_request"], "proargtypes": ["3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "v", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "dashboard_admin_newar_withdraw_reasons", "signature": "private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)", "old_hash": "7c63b8220cd8be35423a1f3d93039447", "new_hash": "ded53abc509a3deed7b1ade7b893adec", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "dashboard_admin_newar_withdraw_reasons", "prorows": 0, "pronargs": 3, "proconfig": ["search_path=\"\"", "plan_cache_mode=force_custom_plan"], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_request", "p_scope", "p_meta"], "proargtypes": ["3802", "3802", "3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_prepared_reason_last_complete", "signature": "private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)", "old_hash": "711fa5703bc8b69f0f18da34c6666efb", "new_hash": "d4edd8182f06f6c1c73394bff0c2d8a6", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_prepared_reason_last_complete", "prorows": 0, "pronargs": 6, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_request", "p_scope", "p_native", "p_aliases", "p_raw_only", "p_preparing"], "proargtypes": ["3802", "3802", "3802", "3802", "16", "3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "v", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_reason_ar_all", "signature": "private.withdraw_reason_ar_all(jsonb,jsonb)", "old_hash": "fbc638a0d836ab02267f944caed197dd", "new_hash": "4686135f702a8ed4477b3999eb33840d", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_ar_all", "prorows": 0, "pronargs": 2, "proconfig": ["search_path=\"\"", "plan_cache_mode=force_custom_plan"], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_request", "p_context"], "proargtypes": ["3802", "3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_reason_complete", "signature": "private.withdraw_reason_complete(jsonb,jsonb)", "old_hash": "116def73d0ac7244c389a4522f968978", "new_hash": "97758a599cd8d6fcba939a195e4aabcd", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_complete", "prorows": 0, "pronargs": 2, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["claim", "payload"], "proargtypes": ["3802", "3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "v", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_reason_compute", "signature": "private.withdraw_reason_compute(jsonb,jsonb,jsonb,text)", "old_hash": "f4d4fe47db11f18b97ad7f0cd2e8a296", "new_hash": "461069d04a9c0c45a9d0a8862814b519", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_compute", "prorows": 0, "pronargs": 4, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["q", "c", "v", "d"], "proargtypes": ["3802", "3802", "3802", "25"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "v", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_reason_newar_all", "signature": "private.withdraw_reason_newar_all(jsonb,jsonb,jsonb)", "old_hash": "64b26dbba1a211668f44812c6114cac6", "new_hash": "212b2ec52d707ebe6931c821e9006c08", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_newar_all", "prorows": 0, "pronargs": 3, "proconfig": ["search_path=\"\"", "plan_cache_mode=force_custom_plan"], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_request", "p_scope", "p_meta"], "proargtypes": ["3802", "3802", "3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_reason_newar_detail_page", "signature": "private.withdraw_reason_newar_detail_page(jsonb,jsonb,jsonb,jsonb)", "old_hash": "9be672793cc8466ebf00bf79da4f9097", "new_hash": "944a507c9197822da7720425a72230e7", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_newar_detail_page", "prorows": 0, "pronargs": 4, "proconfig": ["search_path=\"\"", "plan_cache_mode=force_custom_plan"], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["payload", "q", "p_scope", "p_native"], "proargtypes": ["3802", "3802", "3802", "3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_reason_newar_index_valid", "signature": "private.withdraw_reason_newar_index_valid(jsonb)", "old_hash": "1f10c7349d0cb8bea78f3325fcc6676c", "new_hash": "0b144e19012114e91bd07ed149ecd9b5", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_newar_index_valid", "prorows": 0, "pronargs": 1, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "16", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["payload"], "proargtypes": ["3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "i", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_reason_read", "signature": "private.withdraw_reason_read(jsonb,jsonb,jsonb,jsonb,boolean)", "old_hash": "c839399bbf998c8cffa8abe9887fff36", "new_hash": "5c225d4bba4c77311a0e272c85aa1849", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_read", "prorows": 0, "pronargs": 5, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_request", "p_scope", "p_native", "p_aliases", "p_raw_only"], "proargtypes": ["3802", "3802", "3802", "3802", "16"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "v", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}, {"name": "withdraw_reason_wg_atomic", "signature": "private.withdraw_reason_wg_atomic(jsonb,jsonb)", "old_hash": null, "new_hash": "1ed5c62aab4fbf6c04e7c6f1b63a9564", "metadata": null, "language": null, "helper_metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_wg_atomic", "prorows": 0, "pronargs": 2, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_request", "p_scope"], "proargtypes": ["3802", "3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "helper_language": "plpgsql"}, {"name": "withdraw_reason_parent_current", "signature": "private.withdraw_reason_parent_current()", "old_hash": "e14416a8be1955d4c6ef143aec73ab64", "new_hash": "81bf799268f67dfbc7fc352729432739", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "withdraw_reason_parent_current", "prorows": 0, "pronargs": 0, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": false, "prorettype": "16", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": null, "proargtypes": [], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "sql"}]'::jsonb;spec jsonb;p pg_proc%rowtype;before_meta jsonb:='{}';finance_before jsonb;reason_before text;guard jsonb;all_before boolean:=true;all_after boolean:=true;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION 'atomic_rules_owner_only';END IF;
 FOR guard IN SELECT value FROM jsonb_array_elements('[{"signature": "private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)", "body_md5": "bcd4383775c2d02894bcfa64d3a31a3b", "metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "procost": 100, "prokind": "f", "proname": "dashboard_admin_wg_withdraw_reasons", "prorows": 0, "pronargs": 2, "proconfig": ["search_path=\"\""], "proretset": false, "prosecdef": true, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_request", "p_scope"], "proargtypes": ["3802", "3802"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "language": "plpgsql"}]'::jsonb)LOOP
  SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(guard->>'signature');
  IF p.oid IS NULL OR md5(p.prosrc)IS DISTINCT FROM guard->>'body_md5'OR p.proowner<>'postgres'::regrole OR to_jsonb(p)-ARRAY['oid','pronamespace','proowner','prosrc','prolang']IS DISTINCT FROM guard->'metadata'OR p.prolang IS DISTINCT FROM(SELECT oid FROM pg_language WHERE lanname=guard->>'language')THEN RAISE EXCEPTION 'atomic_rules_protected_drift: %',guard->>'signature';END IF;
 END LOOP;
 FOR spec IN SELECT value FROM jsonb_array_elements(specs)LOOP
  SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(spec->>'signature');
  IF spec->'metadata'<>'null'::jsonb THEN
   IF p.oid IS NULL OR p.proowner<>'postgres'::regrole OR to_jsonb(p)-ARRAY['oid','pronamespace','proowner','prosrc','prolang']IS DISTINCT FROM spec->'metadata'OR p.prolang IS DISTINCT FROM(SELECT oid FROM pg_language WHERE lanname=spec->>'language')THEN RAISE EXCEPTION 'atomic_rules_metadata_drift: %',spec->>'signature';END IF;
   all_before:=all_before AND md5(p.prosrc)=spec->>'new_hash';all_after:=all_after AND md5(p.prosrc)=spec->>'old_hash';
   before_meta:=before_meta||jsonb_build_object(spec->>'signature',to_jsonb(p)-'prosrc');
  ELSE
   IF p.oid IS NOT NULL AND (md5(p.prosrc)IS DISTINCT FROM spec->>'new_hash'OR NOT(p.proowner='postgres'::regrole AND (to_jsonb(p)-ARRAY['oid','pronamespace','proowner','prosrc','prolang'])=spec->'helper_metadata'AND p.prolang=(SELECT oid FROM pg_language WHERE lanname=spec->>'helper_language')))THEN RAISE EXCEPTION 'atomic_rules_helper_drift: %',spec->>'signature';END IF;
   all_before:=all_before AND p.oid IS NOT NULL;all_after:=all_after AND p.oid IS NULL;
  END IF;
 END LOOP;
 IF all_after THEN RETURN;END IF;
 IF NOT all_before THEN RAISE EXCEPTION 'atomic_rules_definition_drift';END IF;
 finance_before:=jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),
 'providerIN',(select md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(n),private.provider_snapshot_dependency_token(to_jsonb(n)))order by n.id),'[]')::text)
 from private.prepared_aggregate_native_catalog()n where n.country='印度'and n.source in('ar','newar')));reason_before:=private.withdraw_reason_dependency();
 IF reason_before IS NULL THEN RAISE EXCEPTION 'atomic_rules_dependency_missing';END IF;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_blocking_details_cleaned(p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
declare
 note text:=p_note;
 compact text;parts text[];label text;actual text;field text;threshold text;numeric_part text;fields text[];head text[];suffix text;
 amount text:='([0-9]{1,18}(?:[.][0-9]{1,8})?)';
 diagnostic_amount text:='([+-]?[0-9]+(?:[.][0-9]+)?)';
 numeric_threshold text:='([0-9]{1,18}(?:[.][0-9]{1,8})?)';
 tax_note text;tax_tail text;tax_piece text;tax_rest text;tax_head text;tax_labels text[]:=array[]::text[];tax_rec record;tax_hit boolean:=false;
 source_date text:='(?:[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}(?:[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:AM|PM)?)?|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T?[0-9]{2}:[0-9]{2}:[0-9]{2})?)';
begin
 -- Input has already had exactly one source-note decoding pass.
 note:=nullif(btrim(regexp_replace(coalesce(note,''),'[[:space:]]+',' ','g')),'');
 compact:=regexp_replace(translate(note,'：，',':,'),'[[:space:]]+','','g');

 -- These complete templates carry per-order measurements after a fixed rule.
 -- Keep configured thresholds and distinct outcomes; do not strip arbitrary
 -- numbers, user-written notes, extra conditions or unrecognized source text.
 if length(compact)>4096 then
  return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
 end if;
 -- Observed NEWAR rule combinations stay one group per source order.
 -- Match whole clauses only. Numbers/redaction tokens are accepted solely in
 -- observed numeric positions; original sanitized text stays in sourceReason.
 declare
  nr_piece text;nr_match text;nr_parts text[];nr_pieces text[];nr_labels text[]:=array[]::text[];
  nr_rule record;nr_i integer;nr_label text;nr_actual text;nr_field text;nr_threshold text;nr_hit boolean:=false;
  nr_value text:='(?:[0-9]{1,24}(?:[.][0-9]{1,40})?|\[已移除号码\]|\{标识\}[.][0-9]{1,40})';
  nr_count text:='[0-9]{1,18}';
  nr_cmp text:='(小于等于|大于等于|小于|大于)';
 begin
  nr_pieces:=regexp_split_to_array(note,'[;；]');
  if cardinality(nr_pieces)>0 then
   for nr_i in 1..cardinality(nr_pieces) loop
    nr_piece:=btrim(nr_pieces[nr_i]);
    if regexp_replace(nr_piece,'[[:space:]]+','','g') ~
     ('^[0-9]{1,3}[.、][0-9]{1,3}日内彩金充值'||nr_value||nr_cmp||'配置'||nr_value||'[。.!！]?$') then
     nr_piece:=regexp_replace(nr_piece,'^[0-9]{1,3}[.、][[:space:]]*','');
    else
     nr_piece:=regexp_replace(nr_piece,'^[0-9]{1,3}[.、](?![0-9.])[[:space:]]*','');
    end if;
    nr_pieces[nr_i]:=nr_piece;
    nr_match:=regexp_replace(translate(nr_piece,'（）','()'),'[[:space:]]+','','g');
    nr_label:=null;
    -- Keep the existing AR/game path cheap: none of these exact NEWAR families
    -- can match without its source prefix.
    if nr_match ~ '^(累计提款次数[0-9]|总打码倍数(?:[0-9]|\[|\{)|同浏览器指纹人数[0-9]|提款金额(?:[0-9]|\[|\{)|未完成充值,当前充值次数|会员备注不为空,请检查备注|从未充值,本次为第|上次充值后提款|总充值(?:[0-9]|\[|\{)|配置不允许非法定货币自动出款,本单U数量|没有可用提现通道,本单出款金额|首存金额(?:[0-9]|\[|\{)|今日未通过自动出款|同银行账户关联|总提现/总充值|账户余额(?:[0-9]|\[|\{)|总盈利(?:[0-9]|\[|\{)|[0-9]{1,3}日内彩金充值)' then
    -- Capture 1 = measured value, 2 = direction, 3 = configured threshold.
    -- Empty captures deliberately mean this observed rule has no such value.
    for nr_rule in select * from(values
     ('累计提款次数('||nr_count||')'||nr_cmp||'配置('||nr_count||')次','累计提款次数{op}配置次数','累计提款次数'),
     ('总打码倍数('||nr_value||')\(有效投注'||nr_value||'/总充值'||nr_value||'\)'||nr_cmp||'配置('||nr_value||')(?:倍)?','总打码倍数{op}配置倍数','总打码倍数'),
     ('总打码倍数('||nr_value||')\(总充值为0(?:[.]0+)?\)'||nr_cmp||'配置('||nr_value||')(?:倍)?','总打码倍数（总充值为零）{op}配置倍数','总打码倍数'),
     ('同浏览器指纹人数('||nr_count||')'||nr_cmp||'配置('||nr_count||')(?:人)?','同浏览器指纹人数{op}配置人数','同浏览器指纹人数'),
     ('提款金额('||nr_value||')'||nr_cmp||'自动出款最大金额('||nr_value||')','提款金额{op}自动出款最大金额','提款金额'),
     ('未完成充值,当前充值次数('||nr_count||')()()','未完成充值','当前充值次数'),
     ('会员备注不为空,请检查备注()()()','会员备注不为空，请检查备注',null),
     ('从未充值,本次为第('||nr_count||')次提款,'||nr_cmp||'无充值连续提款配置('||nr_count||')次','从未充值，连续提款次数{op}配置次数','本次提款次数'),
     ('上次充值后提款('||nr_count||')次\(成功'||nr_count||'\+处理中'||nr_count||'\),'||nr_cmp||'无充值连续提款配置('||nr_count||')次','上次充值后连续提款次数{op}配置次数','上次充值后提款次数'),
     ('总充值('||nr_value||')'||nr_cmp||'配置下限('||nr_value||')','总充值{op}配置下限','总充值'),
     ('配置不允许非法定货币自动出款,本单U数量('||nr_value||')()()','配置不允许非法定货币自动出款','本单U数量'),
     ('没有可用提现通道,本单出款金额('||nr_value||')U()()','没有可用提现通道','本单出款金额（U）'),
     ('首存金额('||nr_value||')'||nr_cmp||'配置('||nr_value||')','首存金额{op}配置金额','首存金额'),
     ('今日未通过自动出款('||nr_count||')次,'||nr_cmp||'配置('||nr_count||')次','今日未通过自动出款次数{op}配置次数','今日未通过自动出款次数'),
     ('同银行账户关联('||nr_count||')次,'||nr_cmp||'配置('||nr_count||')次','同银行账户关联次数{op}配置次数','同银行账户关联次数'),
     ('总提现/总充值('||nr_value||')\(\(总提现'||nr_value||'\+处理中'||nr_value||'\)/总充值'||nr_value||'\)'||nr_cmp||'配置('||nr_value||')','总提现／总充值比例{op}配置比例','总提现／总充值比例'),
     ('账户余额('||nr_value||')'||nr_cmp||'配置('||nr_value||')','账户余额{op}配置金额','账户余额'),
     ('总盈利('||nr_value||')'||nr_cmp||'配置('||nr_value||')','总盈利{op}配置金额','总盈利')
    )as known(pattern,reason,actual_field) loop
     nr_parts:=regexp_match(nr_match,'^'||nr_rule.pattern||'[。.!！]?$');
     if nr_parts is not null then
      nr_label:=replace(nr_rule.reason,'{op}',coalesce(nr_parts[2],''));
      nr_actual:=case when nr_parts[1] ~ '^[0-9]+(?:[.][0-9]+)?$' then nr_parts[1] end;
      nr_threshold:=case when nr_parts[3] ~ '^[0-9]+(?:[.][0-9]+)?$' then nr_parts[3] end;
      nr_field:=nr_rule.actual_field;
      exit;
     end if;
    end loop;
    if nr_label is null then
     nr_parts:=regexp_match(nr_match,'^([0-9]{1,3})日内彩金充值('||nr_value||')'||nr_cmp||'配置('||nr_value||')[。.!！]?$');
     if nr_parts is not null then
      -- The observation window is a distinct rule, not a per-order amount.
      nr_label:=nr_parts[1]||'日内彩金充值'||nr_parts[3]||'配置金额';
      nr_actual:=case when nr_parts[2] ~ '^[0-9]+(?:[.][0-9]+)?$' then nr_parts[2] end;
      nr_threshold:=case when nr_parts[4] ~ '^[0-9]+(?:[.][0-9]+)?$' then nr_parts[4] end;
      nr_field:=nr_parts[1]||'日内彩金充值';
     end if;
    end if;
    end if; -- exact NEWAR prefix guard
    nr_hit:=nr_hit or nr_label is not null;
    nr_labels:=array_append(nr_labels,nr_label);
   end loop;
   if nr_hit then
    for nr_i in 1..cardinality(nr_pieces) loop
     if nr_labels[nr_i] is null and nr_pieces[nr_i]<>'' then
      -- Every child is a single separator-free atom. Reuse the previous shared
      -- classifier for known AR/game/failure clauses; unknown text is retained.
      -- This path cannot recurse again: a single unrecognized atom falls through.
      nr_labels[nr_i]:=private.dashboard_admin_live_blocking_details_cleaned(nr_pieces[nr_i])->>'reason';
     end if;
    end loop;
    select array_agg(x.v order by x.v collate pg_catalog."C") into nr_labels
     from (select distinct unnest(nr_labels) v) x where x.v is not null and x.v<>'';
    return jsonb_build_object('reason',array_to_string(nr_labels,'；'),
     'actualValue',case when cardinality(nr_pieces)=1 then nr_actual end,
     'actualField',case when cardinality(nr_pieces)=1 then nr_field end,
     'threshold',case when cardinality(nr_pieces)=1 then nr_threshold end);
   end if;
  end if;
 end;
 -- These three observed game families differ only in measured amounts.
 -- Group by game; actual amounts and thresholds remain in source/order details.
 -- Require the whole source template, including the strict greater-than sign.
 parts:=regexp_match(compact,'^(棋牌|真人视讯|体育)有效投注:?((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:[.][0-9]+)?)>阈值:?((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:[.][0-9]+)?)[。;；!！?？]?$');
 if parts is not null then
  actual:=replace(parts[2],',','');threshold:=replace(parts[3],',','');
  if length(split_part(actual,'.',1))<=24 and length(split_part(actual,'.',2))<=40
   and length(split_part(threshold,'.',1))<=24 and length(split_part(threshold,'.',2))<=40 then
   return jsonb_build_object('reason',parts[1]||'有效投注超限','actualValue',actual,
    'actualField',parts[1]||'有效投注','threshold',trim_scale(threshold::numeric)::text);
  end if;
  return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
 end if;
 -- Only complete observed business/failure templates lose dynamic observations.
 -- Each source row still has exactly one canonical reason (compound causes stay together).
 -- Keep unknown clauses intact; source notes are never modified by this classifier.
 -- Necessary-only prefilter: no taxonomy match can be created by removing a
 -- terminal provider/status field or a failure-label prefix. The English guard
 -- uses the original case-insensitive regex semantics, including locale rules.
 if position('充提差额不满足自动提现要求' in note)>0
  or position('用户等级不在自动提现等级范围内' in note)>0
  or position('用户未完成首充会员' in note)>0
  or position('用户不满足第一次提现流水要求' in note)>0
  or position('领取助力' in note)>0
  or position('余额不足' in note)>0
  or note ~* '(available[[:space:]]+channels|amount[[:space:]]+is[[:space:]]+not|insufficient[[:space:]]+balance)' then
 tax_note:=translate(note,'：，；',':,;');
 tax_note:=regexp_replace(tax_note,'[[:space:]]*(?:【代付成功】|\[代付成功\])[[:space:]]*[。.!！;]*$','','g');
 -- This is a terminal provider field, not the preceding risk/failure message.
 tax_note:=regexp_replace(tax_note,'[,;][[:space:]]*渠道(?:名字)?[[:space:]]*:[[:space:]]*[[:alnum:]_.%+()（） /-]{1,120}[[:space:]]*$','','g');
 tax_tail:=tax_note;
 if left(tax_note,1) in ('免','用','充','领') then
 for tax_rec in select * from (values
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?(?:用户)?充提差额不满足自动提现要求(?:[[:space:]]*:[[:space:]]*([+-]?[0-9]+(?:[.][0-9]+)?))?', '充提差额未达免审要求', '充提差额'),
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?用户等级不在自动提现等级范围内,([0-9]+),autoWithdrawalLimitLevel:(\[[0-9]+(?:,[0-9]+)*\])', '会员层级不在免审范围', '会员等级'),
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?用户未完成首充会员:[0-9]+,null', '会员未完成首充', null),
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?用户不满足第一次提现流水要求:isFirstWithdrawal:true,userFlow:[0-9]+(?:[.][0-9]+)?,historicalValidBetting:[0-9]+(?:[.][0-9]+)?', '首次提现流水未达要求', null),
  ('(?:免审(?:未通过|条件不过)[[:space:]]*[:,][[:space:]]*)?(?:用户)?(?:领取助力领现金或者代理宝箱活动奖励|领取助力现金或代理宝箱奖励)[(（]多次[)）]', '领取助力现金或代理宝箱奖励（多次）', null)
 ) as known(pattern,reason,actual_field) loop
  parts:=regexp_match(tax_note,'^('||tax_rec.pattern||')(?=$|[,;]|代付异常:)');
  if parts is not null then
   if tax_rec.actual_field is not null and parts[2] is not null and
    (length(split_part(ltrim(parts[2],'+-'),'.',1))>24 or length(split_part(parts[2],'.',2))>40) then
    return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
   end if;
   if tax_rec.actual_field='会员等级' then threshold:=parts[3];tax_labels:=array[tax_rec.reason||'（允许等级：'||threshold||'）'];
   else tax_labels:=array[tax_rec.reason];end if;tax_hit:=true;tax_head:=parts[1];tax_tail:=substr(tax_note,length(tax_head)+1);
   if tax_rec.actual_field is not null then actual:=parts[2];field:=case when actual is not null then tax_rec.actual_field end;end if;
   exit;
  end if;
 end loop;
 end if; -- necessary-only taxonomy head first-character guard
 -- Unknown clauses keep their values/codes. Only the allowlisted provider metadata
 -- and terminal success status are omitted from an otherwise recognized reason.
 foreach tax_piece in array regexp_split_to_array(coalesce(tax_tail,''),'[,;]') loop
  tax_piece:=btrim(tax_piece);
  if tax_piece='' then continue;end if;
  if cardinality(tax_labels)>0 and tax_piece ~ '^渠道(?:名字)?[[:space:]]*:[[:space:]]*[[:alnum:]_.%+()（） /-]{1,120}$' then continue;end if;
  tax_rest:=regexp_replace(tax_piece,'^(?:(?:失败信息|代付异常)[[:space:]]*:[[:space:]]*)+','','g');
  label:=null;
  if tax_rest ~* '^(?:No[[:space:]]+Available[[:space:]]+Channels|"No[[:space:]]+Available[[:space:]]+Channels")[.]?$' then
   label:='无可用代付通道';
  elsif tax_rest ~* '^The[[:space:]]+amount[[:space:]]+is[[:space:]]+not[[:space:]]+within[[:space:]]+the[[:space:]]+range[[:space:]]+of[[:space:]]+[+-]?[0-9]+(?:[.][0-9]+)?[[:space:]]*-[[:space:]]*[+-]?[0-9]+(?:[.][0-9]+)?[.]?$' then
   label:='提现金额超出通道范围';
  elsif tax_rest ~* '^"?Insufficient[[:space:]]+balance"?(?=$|[^[:alnum:]_])' then
   parts:=regexp_match(tax_rest,'^("?Insufficient[[:space:]]+balance"?)(.*)$','i');
   label:='代付余额不足';tax_rest:=btrim(parts[2]);
  elsif tax_rest in('余额不足','代付余额不足','通道余额不足','商户余额不足') then
   label:='代付余额不足';tax_rest:='';
  end if;
  if label is not null then
   tax_hit:=true;if not label=any(tax_labels) then tax_labels:=array_append(tax_labels,label);end if;
   if label='代付余额不足' and tax_rest<>'' then tax_labels:=array_append(tax_labels,tax_rest);end if;
  else
   tax_labels:=array_append(tax_labels,tax_piece);
  end if;
 end loop;
 if tax_hit then
  return jsonb_build_object('reason',array_to_string(tax_labels,'；'),'actualValue',actual,'actualField',field,'threshold',threshold);
 end if;
 end if; -- necessary-only taxonomy prefilter
 label:=null;actual:=null;field:=null;
 if starts_with(compact,'充提差负盈利金额') then
  -- A fixed seven-field diagnostic is cheaper and clearer to validate by
  -- delimiters than one long Unicode regex with repeated decimal captures.
  fields:=string_to_array(compact,',');
  if cardinality(fields)=7 then
   head:=regexp_match(fields[1],'^充提差负盈利金额(小于|小于等于|大于|大于等于)([0-9]+(?:[.][0-9]+)?)$');
   suffix:=fields[7];
   if right(suffix,1)=any(array['。',';','；','!','！','?','？']) then suffix:=left(suffix,length(suffix)-1);end if;
   if head is not null and length(split_part(head[2],'.',1))<=18 and length(split_part(head[2],'.',2))<=8
    and starts_with(fields[2],'当前充提差负盈利金额:') and fields[3]='不能自动出款'
    and starts_with(fields[4],'(用户充值总额:') and starts_with(fields[5],'历史提现总额:')
    and starts_with(fields[6],'待处理金额:') and starts_with(suffix,'用户余额:') and right(suffix,1)=')' then
    parts:=array[substr(fields[2],length('当前充提差负盈利金额:')+1),substr(fields[4],length('(用户充值总额:')+1),substr(fields[5],length('历史提现总额:')+1),substr(fields[6],length('待处理金额:')+1),substr(suffix,length('用户余额:')+1,length(suffix)-length('用户余额:')-1)];
    if not exists (select 1 from unnest(parts) value where value !~ '^[+-]?[0-9]+(?:[.][0-9]+)?$'
      or length(split_part(ltrim(value,'+-'),'.',1))>24 or length(split_part(value,'.',2))>40) then
     threshold:=trim_scale(head[2]::numeric)::text;label:='充提差负盈利金额'||head[1]||threshold||'，不能自动出款';
     actual:=parts[1];field:='当前充提差负盈利金额';
    end if;
   end if;
  end if;
 elsif starts_with(compact,'打码倍数小于') then
  parts:=regexp_match(compact,'^打码倍数小于'||numeric_threshold||',不能自动出款,上次提现后的有效投注\(sumLotteryAmount\):'||diagnostic_amount||',上次提现后的成功充值总额:'||diagnostic_amount||',当前用户打码倍数\(userBetTurnoverMultiple\):'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null then
   threshold:=trim_scale(parts[1]::numeric)::text;label:='上次提现后打码倍数小于'||threshold||'，不能自动出款';
   actual:=parts[4];field:='当前用户打码倍数';
  else
   parts:=regexp_match(compact,'^打码倍数小于'||numeric_threshold||',不能自动出款,最后投注统计\(sumLotteryAmount\):'||diagnostic_amount||',最后一笔实际支付金额:('||substr(diagnostic_amount,2,length(diagnostic_amount)-2)||'|\{金额\}),当前用户打码倍数\(userBetTurnoverMultiple\):'||diagnostic_amount||',不能自动出款[。;；!！?？]?$');
   if parts is not null then
    threshold:=trim_scale(parts[1]::numeric)::text;label:='最后一笔充值打码倍数小于'||threshold||'，不能自动出款';
    actual:=parts[4];field:='当前用户打码倍数';
   end if;
  end if;
 elsif compact ~ '^[0-9]{1,3}日内人工充值' then
  parts:=regexp_match(compact,'^([0-9]{1,3})日内人工充值(彩金)?金额(大于|小于|大于等于|小于等于)'||numeric_threshold||',([0-9]{1,3})日内人工充值(彩金)?金额:'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null and parts[1]=parts[5] and coalesce(parts[2],'')=coalesce(parts[6],'') then
   threshold:=trim_scale(parts[4]::numeric)::text;label:=parts[1]||'日内人工充值'||coalesce(parts[2],'')||'金额'||parts[3]||threshold;
   actual:=parts[7];field:=parts[1]||'日内人工充值'||coalesce(parts[2],'')||'金额';
  end if;
 elsif starts_with(compact,'打码倍数校验通过@') then
  parts:=regexp_match(compact,'^打码倍数校验通过@[0-9]{4}-[0-9]{2}-[0-9]{2}[T]?[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?\(倍数'||diagnostic_amount||'(≥|>)'||numeric_threshold||',有效投注'||diagnostic_amount||',充值'||diagnostic_amount||'\)[。;；!！?？]?$');
  if parts is not null then
   threshold:=trim_scale(parts[3]::numeric)::text;label:='打码倍数校验通过（倍数'||parts[2]||threshold||'）';actual:=parts[1];field:='打码倍数';
  end if;
 elsif starts_with(compact,'打码倍数') then
  parts:=regexp_match(compact,'^打码倍数'||diagnostic_amount||'(小于|小于等于)'||numeric_threshold||',充提差负盈利金额'||diagnostic_amount||'(大于|大于等于)'||numeric_threshold||',按充提差负盈利放行[。;；!！?？]?$');
  if parts is not null then
   threshold:='打码'||parts[2]||trim_scale(parts[3]::numeric)::text||'；充提差'||parts[5]||trim_scale(parts[6]::numeric)::text;
   label:='打码倍数'||parts[2]||trim_scale(parts[3]::numeric)::text||'，充提差负盈利金额'||parts[5]||trim_scale(parts[6]::numeric)::text||'，按充提差负盈利放行';
   actual:=parts[1]||' / '||parts[4];field:='打码倍数 / 充提差负盈利金额';
  else
   parts:=regexp_match(compact,'^打码倍数'||diagnostic_amount||'(大于|大于等于)'||numeric_threshold||'\(累计打码量'||diagnostic_amount||'/需要打码量'||diagnostic_amount||'\)[。;；!！?？]?$');
   if parts is not null then
    threshold:=trim_scale(parts[3]::numeric)::text;label:='打码倍数'||parts[2]||threshold||'（累计打码量 / 需要打码量）';actual:=parts[1];field:='打码倍数';
   end if;
  end if;
 elsif starts_with(compact,'存在单号为空、缺少完成时间或实付金额、备份表重复或主备表不一致的成功充值单') then
  parts:=regexp_match(compact,'^(存在单号为空、缺少完成时间或实付金额、备份表重复或主备表不一致的成功充值单,无法核对打码倍数,不能自动出款),单号:([0-9]{1,30}(?:,[0-9]{1,30}){0,99})(?:等[0-9]{1,9}笔)?[。;；!！?？]?$');
  if parts is not null then label:=parts[1];actual:=parts[2];field:='相关充值单号';end if;
 elsif starts_with(compact,'打码统计源无法覆盖上次提现后的完整周期') then
  parts:=regexp_match(compact,'^(打码统计源无法覆盖上次提现后的完整周期,无法核对打码倍数,不能自动出款),上次提现后的成功充值总额:'||diagnostic_amount||'[。;；!！?？]?$');
  if parts is not null then label:=parts[1];actual:=parts[2];field:='上次提现后的成功充值总额';end if;
 end if;
 if label is not null then
  -- Keep numeric bounds outside the matching expression: repeated bounded
  -- decimal ranges multiply the regex automaton for long source diagnostics.
  foreach numeric_part in array parts loop
   if field<>'相关充值单号' and numeric_part ~ '^[+-]?[0-9]+(?:[.][0-9]+)?$' and
    (length(split_part(ltrim(numeric_part,'+-'),'.',1))>24 or length(split_part(numeric_part,'.',2))>40) then
    return jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null);
   end if;
  end loop;
  return jsonb_build_object('reason',label,'actualValue',actual,'actualField',field,'threshold',threshold);
 end if;
 -- A separator and matching actual-value field are mandatory; arbitrary numbers
 -- in bank errors, user IDs, balances or an additional condition are never stripped.
 parts:=case when starts_with(compact,'首存金额') or starts_with(compact,'用户余额') then regexp_match(compact,'^(首存金额|用户余额)(大于|小于|大于等于|小于等于|不大于|不小于)'||amount||',(首存金额|用户余额):'||amount||'[。;；!！?？]?$') end;
 if parts is not null and parts[1]=parts[4] then
  threshold:=trim_scale(parts[3]::numeric)::text;label:=parts[1]||parts[2]||threshold;actual:=parts[5];field:=parts[1];
 else
  parts:=case when starts_with(compact,'用户历史总领取的红包大于或者等于配置值不能自动出款') then regexp_match(compact,'^(用户历史总领取的红包大于或者等于配置值不能自动出款),用户历史红包领取总额\(userRedPacketTotalAmount\):'||amount||',当前配置的历史红包领取总额限制是\(ReceiveRedSumAmount\):'||amount||'[。;；!！?？]*$') end;
  if parts is not null then
   label:=parts[1];actual:=parts[2];field:='userRedPacketTotalAmount';threshold:=trim_scale(parts[3]::numeric)::text;
  else
   parts:=case when starts_with(compact,'用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款') then regexp_match(compact,'^(用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款),用户最后一次充值之后领取的红包总额\(userLastRechgRecvReadSumAmount\):'||amount||',当前配置的最后一次充值之后领取的红包总额限制是\(LastRechgRecvReadSumAmount\):'||amount||'[。;；!！?？]*$') end;
   if parts is not null then
    label:=parts[1];actual:=parts[2];field:='userLastRechgRecvReadSumAmount';threshold:=trim_scale(parts[3]::numeric)::text;
   else
  parts:=case when starts_with(compact,'当日盈利金额') then regexp_match(compact,'^当日盈利金额(大于|小于|大于等于|小于等于|不大于|不小于)('||substr(amount,2,length(amount)-2)||'|\{金额\}),当日盈利:'||amount||'[。;；!！?？]?$') end;
  if parts is not null then
   threshold:=case when parts[2]='{金额}' then parts[2] else trim_scale(parts[2]::numeric)::text end;
   label:='当日盈利金额'||parts[1]||threshold;actual:=parts[3];field:='当日盈利';
  else
   parts:=case when starts_with(compact,'累计提款次数不能小于') then regexp_match(compact,'^累计提款次数不能小于([0-9]{1,18})次,当前累计提现次数:([0-9]{1,18})次[。;；!！?？]?$') end;
   if parts is not null then threshold:=(parts[1]::numeric)::text;label:='累计提款次数不能小于'||threshold||'次';actual:=parts[2];field:='当前累计提现次数';
   else
    parts:=case when starts_with(compact,'最后充值日限额超过当前配置的最后充值日限制:') then regexp_match(compact,'^最后充值日限额超过当前配置的最后充值日限制:([0-9]{1,18})天[,;；]+最后充值时间:'||source_date||'[,;；]当前时间:'||source_date||'[,;；]间隔:([0-9]{1,18})天[.。,;；!！?？]*$') end;
    if parts is not null then threshold:=(parts[1]::numeric)::text;label:='最后充值日限额超过（限制'||threshold||'天）';actual:=parts[2];field:='间隔天数';
    else
     parts:=case when starts_with(compact,'会员在限制的游戏类型中总的投注数:') then regexp_match(compact,'^会员在限制的游戏类型中总的投注数:([0-9]{1,18})$') end;
     if parts is not null then label:='会员在限制的游戏类型中总的投注数';actual:=parts[1];field:='实际投注数';end if;
    end if;
   end if;
  end if;
 end if;
  end if;
 end if;
 return jsonb_build_object('reason',coalesce(label,note),'actualValue',actual,'actualField',field,'threshold',threshold);
end;
$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_reasons(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_country text;v_platform text;v_code text;v_date date;v_kind text;
 v_offset integer;v_limit integer;v_meta record;v_aliases text[];v_snapshot record;v_expected bigint;v_latest date;
 v_rows jsonb;v_categories jsonb;v_summary jsonb;v_total bigint;v_count bigint;v_rejected bigint;v_noted bigint;v_updated timestamptz;v_key text;
 v_category text;v_reason text;v_operator text;v_query text;v_blocking boolean;v_grouped_snapshot jsonb;v_ar_raw_only boolean;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
  or p_request-array['date','country','platform','kind','offset','limit','category','reasonKey','operatorKey','query']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
 foreach v_key in array array['date','country','platform','kind','category','reasonKey','operatorKey','query'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 if coalesce(p_request->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='invalid_time';end if;
 v_date:=(p_request->>'date')::date;v_country:=nullif(btrim(p_request->>'country'),'');v_platform:=nullif(btrim(p_request->>'platform'),'');
 v_kind:=coalesce(p_request->>'kind','blocking');v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 v_blocking:=v_kind in('blocking','blockingOrders','blockingVariants');
 v_category:=nullif(p_request->>'category','');v_reason:=nullif(p_request->>'reasonKey','');v_operator:=nullif(p_request->>'operatorKey','');v_query:=nullif(btrim(p_request->>'query'),'');
 foreach v_key in array array[v_category,v_reason,v_operator] loop
  if v_key is not null and v_key !~ '^[0-9a-f]{32}$' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if v_country is null or v_platform is null or v_kind not in('blocking','blockingOrders','blockingVariants','categories','rejection','operators','orders')
  or (v_kind='blocking' and (v_category is not null or v_reason is not null or v_operator is not null or v_query is not null))
  or (v_kind in('blockingOrders','blockingVariants') and (v_reason is null or v_category is not null or v_operator is not null))
  or (v_kind='blockingVariants' and v_query is not null)
  or v_offset>1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 if not private.dashboard_scope_allows(v_scope,v_country,v_platform) then raise exception using errcode='42501',message='scope_denied';end if;
 -- wg_existing_reasons_v1: existing request validation and scope checks ran above.
 v_rows:=private.dashboard_admin_wg_withdraw_reasons(p_request,v_scope);
 if v_rows is not null then return v_rows;end if;
 select * into v_meta from private.dashboard_admin_live_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
     or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform)) order by p.source limit 1;
 -- Report-only metadata is resolved by the existing freshly scoped directory.
 -- Keep native AR precedence and the source-country identity used by snapshots.
 if not found then
  select * into v_meta from private.dashboard_admin_live_withdraw_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
    or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform))
   and (v_country<>'胖虎巴西' or p.scope_group='BR_PANGHU')
   order by p.source,p.id limit 1;
 end if;
 v_code:=coalesce(v_meta.scope_group,(select country_code from public.dashboard_platform_team_map m where m.country_name=v_country and m.active limit 1));
 if v_code is null then raise exception using errcode='22023',message='platform_denied';end if;
 v_aliases:=array[v_platform,v_meta.name,v_meta.source_name];
 v_ar_raw_only:=v_meta.source='ar' and v_date>=DATE '2026-10-10' and exists(
  select 1 from (values
  ('BR','POP555'),('BR','POP678'),('BR','POP888'),('BR','POPBEM'),('BR','POPBRA'),('BR','POPCEU'),('BR','POPLUA'),('BR','POPPG'),
  ('ID','55FIVE'),
  ('IN','51GAME'),('IN','55CLUB'),('IN','6CLUB'),('IN','82LOTTERY'),('IN','91CLUB'),('IN','BIGMUMBAI'),('IN','IN999'),
  ('IN','JAICLUB'),('IN','JALWA'),('IN','LOTTERY7'),('IN','OKWIN'),('IN','RAJA'),('IN','SHREEWIN'),('IN','TPPLAY'),('IN','Veer.Game'),
  ('MM','6LOTTERY'),('MY','MZPLAY'),('NG','FB999'),
  ('PK','92.GAME'),('PK','92COCO'),('PK','92DADU'),('PK','92GLORY'),('PK','92GO'),('PK','92PKR'),('PK','92R'),('PK','92STAR'),('PK','92STRIKE'),('PK','YAYWIN'),
  ('VN','66CLUB'),('VN','82VN'),('VN','92LOTTERY'),('VN','VN168')
  )s(code,name) where s.code=v_code and private.dashboard_admin_live_withdraw_key(s.name)=private.dashboard_admin_live_withdraw_key(v_meta.source_name));
 if not coalesce(v_ar_raw_only,false) then
 select total into v_expected from public.auto_withdraw_daily where (country=v_country or (v_country='胖虎巴西' and upper(country) in ('巴西','BR','BR_PANGHU','PANGHU BRAZIL'))) and data_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform) order by updated_at desc limit 1;
 end if;
 -- Default blocking lookup is entered only after the original fresh authorization/native prefix.
 v_rows:=private.withdraw_reason_read(p_request,v_scope,to_jsonb(v_meta),to_jsonb(v_aliases),v_ar_raw_only);
 if v_rows is not null then
  if v_rows->'prepared'->>'contract'='withdraw-reasons-blocking-v1'and v_rows->'prepared'->>'status'in('building','failed')then
   v_rows:=coalesce(private.withdraw_prepared_reason_last_complete(p_request,v_scope,to_jsonb(v_meta),to_jsonb(v_aliases),v_ar_raw_only,v_rows),v_rows);
  end if;
  return v_rows;
 end if;
 -- newar_received_blocking_v1: validated request and fresh scoped native metadata.
 v_rows:=private.dashboard_admin_newar_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
 if v_rows is not null then return v_rows;end if;
 -- yash_received_source_notes_v1: validated request and fresh scoped native metadata.
 if v_meta.source='kb' then
  v_rows:=private.dashboard_admin_yash_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 -- game66_received_source_notes_v1: request, scope and native identity were checked above.
 if v_meta.source='game66' then
  v_rows:=private.dashboard_admin_game66_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 -- lg_business_notes_v1: original request, authorization and native catalog checks ran above.
 if v_meta.source='lg' then
  v_rows:=private.dashboard_admin_lg_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 -- duoli_source_notes_v1: validated request, live authorization and native directory above.
 if v_meta.source='duoli' then
  v_rows:=private.duoli_withdraw_source_notes(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 if v_meta.source='ar' then
  with detail_generation as materialized (
   select CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure AND md5(p.prosrc)='393978c9146ae30019a87632d4d51998' AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prorettype='text'::regtype AND NOT p.proretset AND pg_get_function_arguments(p.oid)='' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')) THEN private.ar_withdraw_detail_evidence_generation() END id
  ), detail_evidence as materialized (
   select e.* from private.ar_withdraw_detail_operator_evidence e cross join detail_generation g
   where e.evidence_generation=g.id AND e.source_applied_at>=v_date::timestamp AND e.source_applied_at<(v_date+1)::timestamp
  ), source_orders as materialized (
   select case when v_kind in('orders','blockingOrders') or v_query is not null then a.order_no end order_no,
    case when v_kind in('orders','blockingOrders') then private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) end amount,
    case when v_kind in('orders','blockingOrders') then a.status end status,
    CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN e.manual_submit_actor ELSE nullif(btrim(a.operator),'') END operator,
    a.operator listing_operator,CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN 'detail_manual_submit' END detail_basis,
    case when v_kind in('orders','blockingOrders') then a.applied_at end applied_at,
    case when v_kind in('orders','blockingOrders') then a.completed_at end completed_at,
    nullif(btrim(a.manual_remark),'') manual_raw,case when not v_blocking or v_kind='blockingOrders' then case when v_blocking then nullif(btrim(a.remark),'') else a.remark end end rejection_raw,
    a.updated_at,
    case when v_date>=DATE '2026-10-10' and e.order_no is not null and btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' then 'manual' when v_date<DATE '2026-10-10' then case when nullif(regexp_replace(coalesce(a.operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(a.operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end else case when lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) IN('','----','---','--','-','null','none','n/a') then
     case when (position('未通过' IN coalesce(a.status,''))>0 OR position('驳回' IN coalesce(a.status,''))>0 OR position('拒绝' IN coalesce(a.status,''))>0 OR position('reject' IN lower(coalesce(a.status,'')))>0 OR position('failed' IN lower(coalesce(a.status,'')))>0) AND NOT (position('已通过' IN coalesce(a.status,''))>0 OR position('已提交' IN coalesce(a.status,''))>0 OR (position('通过' IN coalesce(a.status,''))>0 AND position('未通过' IN coalesce(a.status,''))=0) OR position('success' IN lower(coalesce(a.status,'')))>0 OR position('submitted' IN lower(coalesce(a.status,'')))>0 OR position('成功' IN coalesce(a.status,''))>0) then 'manual' else 'unknown' end
     when position('system' IN lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0 then 'system' else 'manual' end end blocking_operator_class,
    case when a.status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (a.status in('失败','提现失败','出款失败') and coalesce(btrim(a.raw_channel),'') in ('','人工取消')) then 'rejected' when a.status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders a left join detail_evidence e ON
    (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at)
   where a.source_system='AR' and a.country_code=v_code and a.platform=any(v_aliases) and a.order_kind='withdraw'
     and a.applied_at>=v_date::timestamp and a.applied_at<(v_date+1)::timestamp
  ), note_values as materialized (
   select distinct coalesce(manual_raw,'') raw_note from source_orders
   where v_blocking and blocking_operator_class='manual'
  ), note_flags as materialized (
   select raw_note,private.dashboard_admin_live_clean_note(raw_note) normalized_note from note_values
  ), orders as materialized (
   select o.*,f.normalized_note from source_orders o left join note_flags f on f.raw_note=coalesce(o.manual_raw,'')
  ), blocking_stats as (
   select count(*)::bigint raw,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown
   from orders where manual_raw ~ '[^[:space:]]'
  ), operator_stats as (
   select count(*)::bigint total,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown,
    count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
    count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason"
   from orders
  ), candidates as materialized (
   select * from orders where (v_blocking and blocking_operator_class='manual') or (not v_blocking and status_group='rejected')
  ), distinct_reasons as materialized (
   -- Reuse the normalization already computed once per distinct manual note.
   -- Rejection-only requests never normalize successful/system manual notes.
   select distinct coalesce(case when v_blocking then manual_raw else rejection_raw end,'') raw_note,
    case when v_blocking then normalized_note end normalized_note from candidates
  ), normalized_reasons as materialized (
   select raw_note,case when v_blocking then normalized_note else private.dashboard_admin_live_rejection_exact_note(raw_note) end clean_note
   from distinct_reasons
  ), cleaned as materialized (
   select raw_note,case when v_blocking and not coalesce(clean_note ~ '[^[:space:]]',false) then null else clean_note end clean_note,
    case when v_blocking then case when clean_note ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(clean_note)
     else jsonb_build_object('reason','检测没备注') end end blocking_details
   from normalized_reasons
  ), classified as materialized (
   select raw_note,clean_note,blocking_details,case when v_blocking then blocking_details->>'reason' else clean_note end group_note,
    case when not v_blocking then coalesce(clean_note,'（源备注为空）') end category from cleaned
  ), notes as materialized (
   select o.order_no,o.amount,o.status,o.operator,o.applied_at,o.completed_at,o.listing_operator,o.detail_basis,
    case when v_kind in('orders','blockingOrders') then o.manual_raw end manual_raw,
    case when v_kind in('orders','blockingOrders') then o.rejection_raw end rejection_raw,
    case when v_kind in('orders','blockingOrders') then o.normalized_note end normalized_note,
    o.status_group,
    case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,case when v_kind in('orders','blockingOrders') then c.blocking_details end blocking_details,
    case when v_blocking then md5(c.group_note) else private.dashboard_admin_live_rejection_exact_key(c.clean_note) end note_key,
    case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(c.clean_note) end category_key
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as not materialized (
   select * from notes where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,note_key as "reasonKey",count(*)::bigint as count,min(source_note) as "sourceReason",count(distinct source_note)::bigint as "sourceVariantCount",
    count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note,note_key
  ), variant_groups as (
   select source_note as reason,source_note as "sourceReason",note as "canonicalReason",note_key as "reasonKey",count(*)::bigint count,
    count(*) filter(where status_group='success')::bigint success,count(*) filter(where status_group='rejected')::bigint rejected,count(*) filter(where status_group='other')::bigint other
   from selected_notes group by note,source_note,note_key
  ), category_groups as (
   select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
    count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from selected_notes group by category,category_key
  ), operator_groups as (
   select operator,md5(coalesce(operator,'')) "operatorKey",count(*)::bigint count,
    count(distinct category_key)::bigint "categoryCount",count(*) filter(where not v_blocking and rejection_note is null)::bigint "missingReasonCount"
   from selected_notes group by operator
  ), rendered as materialized (
   select to_jsonb(g) item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.reason,null::timestamp from variant_groups g where v_kind='blockingVariants'
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',case when v_blocking then normalized_note else private.dashboard_admin_live_clean_note(manual_raw) end,
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',category_key,'reasonKey',note_key,
    'blockingReason',case when v_blocking then note end,
    'blockingActualValue',case when v_blocking then blocking_details->>'actualValue' end,
    'blockingActualField',case when v_blocking then blocking_details->>'actualField' end,
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end)||CASE WHEN detail_basis IS NOT NULL THEN jsonb_build_object('listingOperator',listing_operator,'operatorClassificationBasis',detail_basis) ELSE '{}'::jsonb END,0,order_no,applied_at
   from selected_notes where v_kind in('orders','blockingOrders')
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select case when v_blocking then (select manual from operator_stats) else raw end from blocking_stats),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset v_offset limit v_limit)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
      count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from notes group by category,category_key)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where not v_blocking and rejection_note is null),
    'withOperator',(select count(*) from notes where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',(select count(*) from selected_notes))
     ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis',case when v_date>=DATE '2026-10-10' then 'ar_operator_rejected_or_verified_detail_manual_submit' else 'current_operator' end) else '{}'::jsonb end
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_blocking then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_blocking then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',case when v_ar_raw_only then null else v_expected end,'complete',case when v_ar_raw_only then false else v_count=v_expected end,'rejected',v_rejected,'withManualRemark',case when v_blocking then (v_summary->'operatorCounts'->>'manualWithReason')::bigint else v_noted end),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;end if;
  if v_ar_raw_only then
   -- Absence of received facts is not proof of zero; do not resurrect old reports.
   return jsonb_build_object('available',false,'source','AR 已采集订单','country',v_country,'platform',v_platform,
    'date',v_date,'kind',v_kind,'rows','[]'::jsonb,'total',0,'offset',v_offset,'limit',v_limit,
    'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
    'coverage',jsonb_build_object('collected',0,'expected',null,'complete',false,'state','no_received_facts'),
    'updatedAt',null,'latestSnapshotDate',null,'snapshotFallback',false,
    'message','所选日期尚无已入库提现明细；不能认定为零笔或已完整采集');
  end if;
 end if;
 select max(stat_date) into v_latest from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform);
 select * into v_snapshot from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and stat_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 -- Rejection snapshots retain the complete source reason_label. A semantic grouped
 -- view cannot prove which original text a caller selected.
 if v_blocking and v_snapshot.source_system='PANDA' then
  select snapshot into v_grouped_snapshot from public.withdraw_reasons_daily_grouped where country_code=v_snapshot.country_code and platform=v_snapshot.platform and stat_date=v_date and source_system=v_snapshot.source_system
   and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 end if;
 if v_snapshot.platform is null or v_kind in('orders','operators','blockingOrders') or v_operator is not null or v_query is not null
   or (v_snapshot.source_system='NEWAR' and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (not v_blocking and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (v_blocking and v_snapshot.snapshot->>'note_field'='remark') then
  return jsonb_build_object('available',false,'rows','[]'::jsonb,'total',0,'date',v_date,'kind',v_kind,'latestSnapshotDate',v_latest,
   'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
   'message',case when v_kind='blockingOrders' then '当前来源只有原因汇总，可查看全部原文及笔数；没有逐笔订单编号' when v_kind in('orders','operators') then '当前来源尚未采集逐笔驳回备注及对应操作人，只有原因汇总时不能还原订单详情'
    when not v_blocking then '当前来源尚未单独采集驳回订单的备注字段' else '所选日期尚无自动出款拦截原因采集记录' end);
 end if;
 with source_groups as materialized (
  -- Empty categories are included only when the snapshot explicitly records a manual group.
  -- Missing groups cannot be inferred from a source total or a different operator class.
  select g,case when v_blocking and g->>'operator_class'='manual' and g->>'classification' is distinct from 'empty'
   then case when g->>'classification'='truncated' then private.dashboard_admin_live_clean_note(g->>'reason_label')
    else private.dashboard_admin_live_blocking_category(g->>'reason_label') end end raw_category
  from jsonb_array_elements(v_snapshot.snapshot->'groups')g
 ), blocking_stats as (
  select coalesce(sum((g->>'count')::bigint),0)::bigint raw,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='manual'),0)::bigint manual,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='auto'),0)::bigint system,
   coalesce(sum((g->>'count')::bigint) filter(where coalesce(g->>'operator_class','unknown') not in('manual','auto')),0)::bigint unknown
  from source_groups where g->>'classification' is distinct from 'empty' and private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]'
 ), base_original_groups as materialized (
  select case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then null
    when not v_blocking then case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end
    else private.dashboard_admin_live_clean_note(g->>'reason_label') end source_reason,
   case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then '检测没备注'
    when v_blocking then raw_category
    else coalesce(case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end,'（源备注为空）') end reason,
   case when not v_blocking then coalesce(case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end,'（源备注为空）') end category,
   sum(case when not v_blocking then (g->>'reject')::bigint else (g->>'count')::bigint end)::bigint count,
   sum((g->>'success')::bigint)::bigint success,sum((g->>'reject')::bigint)::bigint rejected,sum((g->>'other')::bigint)::bigint other
  from source_groups
  where (not v_blocking and (g->>'reject')::bigint>0) or (v_blocking and g->>'operator_class'='manual') group by 1,2,3
 ), original_groups as materialized (
  select b.*,case when v_blocking then md5(reason) else private.dashboard_admin_live_rejection_exact_key(source_reason) end note_key,
   case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(source_reason) end category_key
  from base_original_groups b
 ), selected_groups as materialized (
  select * from original_groups where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
 ), rendered as (
  select jsonb_build_object('category',category,'categoryKey',category_key,'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint) item,sum(count) count,category label
   from selected_groups where v_kind='categories' group by category,category_key
  union all select jsonb_build_object('reason',reason,'reasonKey',note_key,'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint,
    'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint) item,sum(count),reason
   from selected_groups g where v_kind in('blocking','rejection') group by reason,note_key
  union all select jsonb_build_object('reason',source_reason,'sourceReason',source_reason,'canonicalReason',reason,'reasonKey',note_key,
    'count',sum(count)::bigint,'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint),sum(count),source_reason
   from selected_groups where v_kind='blockingVariants' group by source_reason,reason,note_key
 ) select (select count(*) from rendered),
  coalesce((select jsonb_agg(item order by count desc,label) from (select * from rendered order by count desc,label offset v_offset limit v_limit)p),'[]'::jsonb),
  (select coalesce(sum(count),0) from original_groups),
  coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
   (select category,category_key "categoryKey",sum(count)::bigint count,min(source_reason) as "sourceReason",
     count(distinct source_reason)::bigint as "sourceVariantCount" from original_groups group by category,category_key)g),'[]'::jsonb),
  jsonb_build_object('totalRejected',v_snapshot.snapshot->'totals'->'reject','selectedCount',(select coalesce(sum(count),0) from selected_groups))
   ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),
    -- Reason snapshots do not prove the complete operator universe. Never infer totals from note groups.
    'operatorCounts',jsonb_build_object('total',null,'manual',null,'system',null,'unknown',null,
      'manualWithReason',(select manual from blocking_stats),'manualWithoutReason',
       (select sum((g->>'count')::bigint) from source_groups where g->>'operator_class'='manual'
        and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)))),'operatorBasis','snapshot_classification') else '{}'::jsonb end
 into v_total,v_rows,v_noted,v_categories,v_summary;
 return jsonb_build_object('available',true,'source',v_snapshot.source_system||' 原因采集快照','basis',coalesce(v_snapshot.snapshot->>'note_field','source_note'),
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'rows',v_rows,'total',v_total,'offset',v_offset,'limit',v_limit,
  'noteCount',case when v_blocking then v_noted else coalesce((v_snapshot.snapshot->'totals'->>'reject')::bigint,v_noted) end,
  'categories',v_categories,'summary',v_summary,'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
  'coverage',v_snapshot.snapshot->'coverage','updatedAt',v_snapshot.updated_at,'latestSnapshotDate',v_latest)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;
end;
$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_newar_withdraw_reasons(p_request jsonb, p_scope jsonb, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
 v_country text:=btrim(p_request->>'country');v_platform text:=btrim(p_request->>'platform');
 v_kind text:=coalesce(p_request->>'kind','blocking');v_date date:=(p_request->>'date')::date;
 v_offset integer:=coalesce((p_request->>'offset')::integer,0);v_limit integer:=coalesce((p_request->>'limit')::integer,20);
 v_reason text:=nullif(p_request->>'reasonKey','');v_query text:=nullif(btrim(p_request->>'query'),'');
 v_cfg record;v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
 -- Called only after the parent reader validates its request and obtains fresh scope.
 -- The helper itself has no external EXECUTE grant and never handles other sources.
 if p_meta->>'source' is distinct from 'newar' or v_kind not in('blocking','blockingVariants','blockingOrders') then return null;end if;
 if p_meta->>'country' is distinct from v_country
  or not private.dashboard_scope_allows(p_scope,v_country,v_platform)
  or not (private.dashboard_admin_live_withdraw_key(v_platform)=private.dashboard_admin_live_withdraw_key(p_meta->>'name')
   or private.dashboard_admin_live_withdraw_key(v_platform)=private.dashboard_admin_live_withdraw_key(p_meta->>'source_name'))
  then raise exception using errcode='42501',message='scope_denied';end if;
 select n.* into v_cfg from public.newar_detail_platforms n
  where n.platform=p_meta->>'source_name' and n.enabled
   and private.dashboard_scope_allows(p_scope,n.country_code,n.platform);
 if not found or v_cfg.country is distinct from v_country or v_cfg.timezone is distinct from p_meta->>'timezone'
  then raise exception using errcode='22023',message='platform_denied';end if;
 v_start:=v_date::timestamp at time zone v_cfg.timezone;v_end:=(v_date+1)::timestamp at time zone v_cfg.timezone;
 with scope_facts as materialized (
  -- The existing narrow indexed projection locates one platform/day. Automatic
  -- and unverified orders are counted without reading their wide source JSON.
  select f.* from private.newar_withdraw_facts f
  where f.platform=v_cfg.platform and f.created_at>=v_start and f.created_at<v_end
   and (v_cfg.launch_at is null or f.created_at>=v_cfg.launch_at)
 ), totals as (
  select count(*)::bigint collected,count(*) filter(where method='auto')::bigint system,
   count(*) filter(where method='manual')::bigint manual,count(*) filter(where method is null)::bigint unknown,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   max(captured_at) captured,max(received_at) received from scope_facts
 ), coverage as (
  select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) ranges,max(c.observed_at) seen
  from private.newar_detail_coverage_runs c where c.platform=v_cfg.platform and c.dataset='withdraw'
   and c.invalidated_at is null and c.observed_at<=statement_timestamp()
   and c.effective_start_at<v_end and c.end_at>v_start
 ), evidence as (
  select t.*,greatest(t.received,c.seen) updated,
   v_end<=statement_timestamp() and (v_cfg.launch_at is null or v_start>=v_cfg.launch_at)
    and coalesce(c.ranges @> tstzrange(v_start,v_end,'[)'),false)
    and coalesce(t.captured<=statement_timestamp(),true) complete from totals t cross join coverage c
 ), source_orders as materialized (
  select f.record_id,f.status_group,f.account,f.created_at,
   case when isfinite(f.submitted_at) and isfinite(f.handled_at) and f.handled_at>=f.submitted_at
    and f.handled_at<=f.captured_at and f.handled_at<=statement_timestamp() then f.handled_at end handled_at,
   case when v_kind='blockingOrders' or v_query is not null then case when z.record_id is not null then z.order_number else n.order_number end end order_no,
   case when v_kind='blockingOrders' then case when z.record_id is not null then z.amount else n.amount end end amount,
   case when v_kind='blockingOrders' then coalesce(case when z.record_id is not null then z.display_state
    else case when jsonb_typeof(n.raw->'withdrawDisplayState') in('string','number')
     and length(n.raw->>'withdrawDisplayState') between 1 and 200 and n.raw->>'withdrawDisplayState' !~ '[[:cntrl:]]'
     then n.raw->>'withdrawDisplayState' end end,f.status_group) end status,
   -- newar_reason_projection_v1: source updates maintain this narrow sidecar in the same transaction.
   -- Missing projection rows retain the existing source fallback; null labels do not borrow member notes.
   case when z.record_id is not null then z.source_label else
    case when n.raw->>'businessSchemaVersion'='2' and n.raw->>'automaticReasonSource'='remark'
     and jsonb_typeof(n.raw->'automaticReasonLabel')='string'
     and length(n.raw->>'automaticReasonLabel')<=256 and n.raw->>'automaticReasonLabel' !~ '[[:cntrl:]]'
     then nullif(btrim(n.raw->>'automaticReasonLabel'),'') end end source_label
  from scope_facts f left join private.newar_withdraw_reason_facts z on z.record_id=f.record_id
   and z.platform=v_cfg.platform and z.created_at=f.created_at and z.received_at=f.received_at
  left join lateral (
   select source_record.order_number,source_record.amount,source_record.raw
   from public.newar_detail_records source_record
   where z.record_id is null and source_record.id=f.record_id
    and source_record.platform=v_cfg.platform and source_record.dataset='withdraw'
   limit 1
  ) n on true
  where f.method='manual'
 ), distinct_labels as materialized (
  select distinct coalesce(source_label,'') label from source_orders
 ), normalized_labels as materialized (
  select label,private.dashboard_admin_live_clean_note(label) source_reason from distinct_labels
 ), classified_labels as materialized (
  select label,nullif(source_reason,'') source_reason,
   case when source_reason ~ '[^[:space:]]' then 'present' else 'unknown' end note_state,
   case when source_reason ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(source_reason)
    else jsonb_build_object('reason','检测没备注') end details from normalized_labels
 ), reason_labels as materialized (
  select c.*,coalesce(details->>'reason',source_reason,'检测没备注') reason,
   md5(jsonb_build_array('newar_blocking_sanitized_v1',note_state,coalesce(details->>'reason',source_reason,'检测没备注'))::text) reason_key
  from classified_labels c
 ), notes as materialized (
  select o.*,r.source_reason,r.note_state,r.reason,r.reason_key,r.details
  from source_orders o join reason_labels r on r.label=coalesce(o.source_label,'')
 ), note_stats as (
  select count(*) filter(where note_state='present')::bigint present,
   count(*) filter(where note_state='unknown')::bigint unknown from notes
 ), selected_notes as materialized (
  select * from notes where (v_reason is null or reason_key=v_reason)
   and (v_query is null or position(lower(v_query) in lower(coalesce(order_no,'')))>0)
 ), groups as (
  select reason,reason_key "reasonKey",note_state "noteState",count(*)::bigint count,
   min(source_reason) as "sourceReason",count(distinct source_reason)::bigint "sourceVariantCount",
   count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from selected_notes group by reason,reason_key,note_state
 ), variants as (
  select reason,reason_key "reasonKey",note_state "noteState",source_reason "sourceReason",reason "canonicalReason",
   count(*)::bigint count,count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from selected_notes group by reason,reason_key,note_state,source_reason
 ), rendered as materialized (
  select to_jsonb(g) item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time,null::uuid sort_id
  from groups g where v_kind='blocking'
  union all select to_jsonb(g),g.count,coalesce(g."sourceReason",''),null::timestamptz,null::uuid
  from variants g where v_kind='blockingVariants'
  union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',account,
   'operatorKey',md5(account),'createdAt',created_at,'completedAt',handled_at,
   'manualRemark',source_reason,'reasonKey',reason_key,'blockingReason',reason,'noteState',note_state,
   'blockingActualValue',details->>'actualValue','blockingActualField',details->>'actualField','blockingThreshold',details->>'threshold',
   'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true),0,coalesce(order_no,''),created_at,record_id
  from selected_notes where v_kind='blockingOrders'
 ), page as (
  select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text,sort_id
  offset v_offset limit v_limit
 )
 select jsonb_build_object('available',e.collected>0 or e.complete,'source','NEWAR 已采集订单','basis','automaticReasonLabel',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'offset',v_offset,'limit',v_limit,
  'total',(select count(*) from rendered),'rows',coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text,sort_id) from page),'[]'::jsonb),
  'noteCount',case when e.collected>0 or e.complete then e.manual end,'categories','[]'::jsonb,
  'summary',case when e.collected>0 or e.complete then jsonb_build_object(
   'totalRejected',e.rejected,'selectedCount',(select count(*) from selected_notes),
   'operatorBasis','verified_business_schema_v2','operatorCounts',jsonb_build_object('total',e.collected,'manual',e.manual,'system',e.system,'unknown',e.unknown,
    'manualWithReason',ns.present,'manualWithoutReason',ns.unknown),
   'blockingCounts',jsonb_build_object('raw',ns.present,'manual',ns.present,'system',0,'unknown',0)) else '{}'::jsonb end,
  'canViewBlockingOrders',true,'canViewOrders',false,'canViewOperators',false,'timeBasis','created_at',
  'coverage',jsonb_build_object('collected',e.collected,'expected',null,'complete',e.complete,'rejected',case when e.collected>0 or e.complete then e.rejected end,
   'withManualRemark',case when e.collected>0 or e.complete then ns.present end,'state',case when e.complete then 'complete' when e.collected>0 then 'received_partial' else 'no_received_facts' end),
  'updatedAt',e.updated,'latestSnapshotDate',null,'snapshotFallback',false,
  'message',case when e.collected=0 and not e.complete then '所选日期尚无已入库提现明细；不能认定为零笔或已完整采集' end)
 into v_result from evidence e cross join note_stats ns;
 return v_result;
end;
$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_prepared_reason_last_complete(p_request jsonb, p_scope jsonb, p_native jsonb, p_aliases jsonb, p_raw_only boolean, p_preparing jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE q jsonb;c jsonb;v jsonb;old_v jsonb;token text;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;
 compat private.withdraw_prepared_reason_compat%rowtype;publication jsonb;error_code text;key jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_last_complete_owner_only';END IF;
 SELECT *INTO compat FROM private.withdraw_prepared_reason_compat WHERE singleton;
 IF NOT FOUND OR NOT compat.enabled OR compat.new_token IS NULL THEN RETURN NULL;END IF;
 -- This is reached only after the unchanged ordinary read authorized the exact
 -- native and attempted admission. Do not reinterpret unknown/future states.
 IF p_preparing->'prepared'->>'contract'IS DISTINCT FROM'withdraw-reasons-blocking-v1'
 OR coalesce(p_preparing->'prepared'->>'status','')NOT IN('building','failed')OR p_preparing->'available'IS DISTINCT FROM'false'::jsonb
 OR p_preparing->'rows'IS DISTINCT FROM'null'::jsonb OR p_preparing->'total'IS DISTINCT FROM'null'::jsonb OR p_preparing->'summary'IS DISTINCT FROM'null'::jsonb
 OR coalesce(p_request->>'kind','blocking')<>'blocking'OR nullif(p_request->>'category','')IS NOT NULL OR nullif(p_request->>'reasonKey','')IS NOT NULL
 OR nullif(p_request->>'operatorKey','')IS NOT NULL OR nullif(btrim(p_request->>'query'),'')IS NOT NULL
 OR coalesce(p_native->>'source','')NOT IN('ar','newar')OR(p_native->>'source'='ar'AND NOT coalesce(p_raw_only,false))THEN RETURN NULL;END IF;
 IF private.dashboard_scope_allows(p_scope,btrim(p_request->>'country'),btrim(p_request->>'platform'))IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied';END IF;
 q:=jsonb_build_object('country',btrim(p_request->>'country'),'platform',btrim(p_request->>'platform'),'date',(p_request->>'date')::date,'kind','blocking','offset',0,'limit',500);
 IF p_preparing->'country'IS DISTINCT FROM q->'country'OR p_preparing->'platform'IS DISTINCT FROM q->'platform'OR p_preparing->'date'IS DISTINCT FROM q->'date'OR p_preparing->>'kind'IS DISTINCT FROM'blocking'THEN RETURN NULL;END IF;
 c:=jsonb_build_object('native',p_native,'aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false));key:=jsonb_build_array('withdraw-reasons-blocking-v1',q,c);
 IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(key::text)AND request_key=key AND request=q;
 IF j.id IS NULL OR j.status NOT IN('queued','running','failed')OR j.scope->'context'IS DISTINCT FROM c OR j.catalog IS DISTINCT FROM jsonb_build_array(p_native)THEN RETURN NULL;END IF;
 -- Reuse the vector created by the ordinary read; match invokes the original
 -- ensure once and rejects poison, broken hooks, future gates or source races.
 v:=j.scope->'version';token:=private.withdraw_reason_dependency();
 IF v->'native'IS DISTINCT FROM(p_native||jsonb_build_object('aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false)))
 OR v->'day'IS DISTINCT FROM q->'date'OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR j.dependency IS DISTINCT FROM md5(jsonb_build_array(token,c,v)::text)THEN RETURN NULL;END IF;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id AND x.job_id=j.id;
 IF a.id IS NULL OR a.revision>j.revision OR a.fence>j.fence OR a.bytes>4194304 OR a.computed_at>statement_timestamp()
 OR a.payload->>'contract'IS DISTINCT FROM'withdraw-reasons-blocking-v1'OR a.payload->'request'IS DISTINCT FROM q OR a.payload->'context'IS DISTINCT FROM c
 OR jsonb_typeof(a.payload->'version')IS DISTINCT FROM'object'OR jsonb_typeof(a.payload->'version'->'keys')IS DISTINCT FROM'array'OR jsonb_typeof(a.payload->'result'->'rows')IS DISTINCT FROM'array'
 OR jsonb_typeof(a.payload->'result'->'total')IS DISTINCT FROM'number'OR coalesce(a.payload->'result'->>'total','')!~'^[0-9]+$'
 OR(a.payload->'result'->>'total')::numeric<>jsonb_array_length(a.payload->'result'->'rows')
 OR jsonb_typeof(a.payload->'result'->'summary')IS DISTINCT FROM'object'OR jsonb_typeof(a.payload->'result'->'coverage')IS DISTINCT FROM'object'
 OR a.payload->'result'->'available'IS DISTINCT FROM'true'::jsonb THEN RETURN NULL;END IF;
 old_v:=a.payload->'version';
 -- Only source revisions/fingerprints may be older. Native, local date, schema,
 -- install identity, configuration and evidence semantics must still agree.
 IF old_v->'version'IS DISTINCT FROM v->'version'OR old_v->'native'IS DISTINCT FROM v->'native'OR old_v->'day'IS DISTINCT FROM v->'day'
 OR old_v->'installation'IS DISTINCT FROM v->'installation'OR old_v->'config'IS DISTINCT FROM v->'config'
 OR old_v->'evidence'->'generation'IS DISTINCT FROM v->'evidence'->'generation'
 OR(SELECT jsonb_agg(x-'revision'ORDER BY n)FROM jsonb_array_elements(old_v->'keys')WITH ORDINALITY e(x,n))
 IS DISTINCT FROM(SELECT jsonb_agg(x-'revision'ORDER BY n)FROM jsonb_array_elements(v->'keys')WITH ORDINALITY e(x,n))THEN RETURN NULL;END IF;
 IF a.dependency IS DISTINCT FROM md5(jsonb_build_array(token,c,old_v)::text)THEN
  -- Exact sealed compatibility is for this audited guard-only routing release.
  -- ANY later module code/metadata change invalidates the legacy allowance.
  IF compat.new_token IS NULL OR token IS DISTINCT FROM compat.new_token
  OR a.dependency IS DISTINCT FROM md5(jsonb_build_array(compat.old_token,c,old_v)::text)THEN RETURN NULL;END IF;
 END IF;
 IF private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_dependency()IS DISTINCT FROM token THEN RETURN NULL;END IF;
 publication:=jsonb_build_object('contract','withdraw-reasons-last-complete-v1','status','ready','servedLastComplete',true,'freshness','refresh_due',
  'computedAt',a.computed_at,'updatedAt',a.payload->'result'->'updatedAt','refreshState',j.status);
 error_code:=j.last_error;IF error_code~'^[a-z][a-z0-9_]{0,79}$'THEN publication:=publication||jsonb_build_object('refreshError',error_code);END IF;
 RETURN private.withdraw_reason_page(a.payload->'result',p_request)||jsonb_build_object('publication',publication);
END;$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_ar_all(p_request jsonb, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
 v_country text:=p_request->>'country';v_platform text:=p_request->>'platform';v_code text:=p_context->'native'->>'scope_group';
 v_date date:=(p_request->>'date')::date;v_kind text:='blocking';v_offset integer:=0;v_limit integer:=500;
 v_aliases text[]:=ARRAY(SELECT jsonb_array_elements_text(p_context->'aliases'));v_expected bigint;
 v_blocking boolean:=true;v_ar_raw_only boolean:=true;v_category text;v_reason text;v_operator text;v_query text;
 v_count bigint;v_rejected bigint;v_noted bigint;v_updated timestamptz;v_total bigint;v_rows jsonb;v_categories jsonb;v_summary jsonb;
BEGIN
 IF current_user<>'postgres' OR p_context->'native'->>'source'IS DISTINCT FROM'ar' OR NOT coalesce((p_context->>'rawOnly')::boolean,false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_compute_denied';END IF;
  with detail_generation as materialized (
   select CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure AND md5(p.prosrc)='393978c9146ae30019a87632d4d51998' AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prorettype='text'::regtype AND NOT p.proretset AND pg_get_function_arguments(p.oid)='' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')) THEN private.ar_withdraw_detail_evidence_generation() END id
  ), detail_evidence as materialized (
   select e.* from private.ar_withdraw_detail_operator_evidence e cross join detail_generation g
   where e.evidence_generation=g.id AND e.source_applied_at>=v_date::timestamp AND e.source_applied_at<(v_date+1)::timestamp
  ), source_orders as materialized (
   select case when v_kind in('orders','blockingOrders') or v_query is not null then a.order_no end order_no,
    case when v_kind in('orders','blockingOrders') then private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) end amount,
    case when v_kind in('orders','blockingOrders') then a.status end status,
    CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN e.manual_submit_actor ELSE nullif(btrim(a.operator),'') END operator,
    a.operator listing_operator,CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN 'detail_manual_submit' END detail_basis,
    case when v_kind in('orders','blockingOrders') then a.applied_at end applied_at,
    case when v_kind in('orders','blockingOrders') then a.completed_at end completed_at,
    nullif(btrim(a.manual_remark),'') manual_raw,case when not v_blocking or v_kind='blockingOrders' then case when v_blocking then nullif(btrim(a.remark),'') else a.remark end end rejection_raw,
    a.updated_at,
    case when v_date>=DATE '2026-10-10' and e.order_no is not null and btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' then 'manual' when v_date<DATE '2026-10-10' then case when nullif(regexp_replace(coalesce(a.operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(a.operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end else case when lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) IN('','----','---','--','-','null','none','n/a') then
     case when (position('未通过' IN coalesce(a.status,''))>0 OR position('驳回' IN coalesce(a.status,''))>0 OR position('拒绝' IN coalesce(a.status,''))>0 OR position('reject' IN lower(coalesce(a.status,'')))>0 OR position('failed' IN lower(coalesce(a.status,'')))>0) AND NOT (position('已通过' IN coalesce(a.status,''))>0 OR position('已提交' IN coalesce(a.status,''))>0 OR (position('通过' IN coalesce(a.status,''))>0 AND position('未通过' IN coalesce(a.status,''))=0) OR position('success' IN lower(coalesce(a.status,'')))>0 OR position('submitted' IN lower(coalesce(a.status,'')))>0 OR position('成功' IN coalesce(a.status,''))>0) then 'manual' else 'unknown' end
     when position('system' IN lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0 then 'system' else 'manual' end end blocking_operator_class,
    case when a.status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (a.status in('失败','提现失败','出款失败') and coalesce(btrim(a.raw_channel),'') in ('','人工取消')) then 'rejected' when a.status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders a left join detail_evidence e ON
    (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at)
   where a.source_system='AR' and a.country_code=v_code and a.platform=any(v_aliases) and a.order_kind='withdraw'
     and a.applied_at>=v_date::timestamp and a.applied_at<(v_date+1)::timestamp
  ), note_values as materialized (
   select distinct coalesce(manual_raw,'') raw_note from source_orders
   where v_blocking and blocking_operator_class='manual'
  ), note_flags as materialized (
   select raw_note,private.dashboard_admin_live_clean_note(raw_note) normalized_note from note_values
  ), orders as materialized (
   select o.*,f.normalized_note from source_orders o left join note_flags f on f.raw_note=coalesce(o.manual_raw,'')
  ), blocking_stats as (
   select count(*)::bigint raw,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown
   from orders where manual_raw ~ '[^[:space:]]'
  ), operator_stats as (
   select count(*)::bigint total,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown,
    count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
    count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason"
   from orders
  ), candidates as materialized (
   select * from orders where (v_blocking and blocking_operator_class='manual') or (not v_blocking and status_group='rejected')
  ), distinct_reasons as materialized (
   -- Reuse the normalization already computed once per distinct manual note.
   -- Rejection-only requests never normalize successful/system manual notes.
   select distinct coalesce(case when v_blocking then manual_raw else rejection_raw end,'') raw_note,
    case when v_blocking then normalized_note end normalized_note from candidates
  ), normalized_reasons as materialized (
   select raw_note,case when v_blocking then normalized_note else private.dashboard_admin_live_rejection_exact_note(raw_note) end clean_note
   from distinct_reasons
  ), cleaned as materialized (
   select raw_note,case when v_blocking and not coalesce(clean_note ~ '[^[:space:]]',false) then null else clean_note end clean_note,
    case when v_blocking then case when clean_note ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(clean_note)
     else jsonb_build_object('reason','检测没备注') end end blocking_details
   from normalized_reasons
  ), classified as materialized (
   select raw_note,clean_note,blocking_details,case when v_blocking then blocking_details->>'reason' else clean_note end group_note,
    case when not v_blocking then coalesce(clean_note,'（源备注为空）') end category from cleaned
  ), notes as materialized (
   select o.order_no,o.amount,o.status,o.operator,o.applied_at,o.completed_at,o.listing_operator,o.detail_basis,
    case when v_kind in('orders','blockingOrders') then o.manual_raw end manual_raw,
    case when v_kind in('orders','blockingOrders') then o.rejection_raw end rejection_raw,
    case when v_kind in('orders','blockingOrders') then o.normalized_note end normalized_note,
    o.status_group,
    case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,case when v_kind in('orders','blockingOrders') then c.blocking_details end blocking_details,
    case when v_blocking then md5(c.group_note) else private.dashboard_admin_live_rejection_exact_key(c.clean_note) end note_key,
    case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(c.clean_note) end category_key
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as not materialized (
   select * from notes where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,note_key as "reasonKey",count(*)::bigint as count,min(source_note) as "sourceReason",count(distinct source_note)::bigint as "sourceVariantCount",
    count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note,note_key
  ), variant_groups as (
   select source_note as reason,source_note as "sourceReason",note as "canonicalReason",note_key as "reasonKey",count(*)::bigint count,
    count(*) filter(where status_group='success')::bigint success,count(*) filter(where status_group='rejected')::bigint rejected,count(*) filter(where status_group='other')::bigint other
   from selected_notes group by note,source_note,note_key
  ), category_groups as (
   select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
    count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from selected_notes group by category,category_key
  ), operator_groups as (
   select operator,md5(coalesce(operator,'')) "operatorKey",count(*)::bigint count,
    count(distinct category_key)::bigint "categoryCount",count(*) filter(where not v_blocking and rejection_note is null)::bigint "missingReasonCount"
   from selected_notes group by operator
  ), rendered as materialized (
   select to_jsonb(g) item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.reason,null::timestamp from variant_groups g where v_kind='blockingVariants'
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',case when v_blocking then normalized_note else private.dashboard_admin_live_clean_note(manual_raw) end,
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',category_key,'reasonKey',note_key,
    'blockingReason',case when v_blocking then note end,
    'blockingActualValue',case when v_blocking then blocking_details->>'actualValue' end,
    'blockingActualField',case when v_blocking then blocking_details->>'actualField' end,
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end)||CASE WHEN detail_basis IS NOT NULL THEN jsonb_build_object('listingOperator',listing_operator,'operatorClassificationBasis',detail_basis) ELSE '{}'::jsonb END,0,order_no,applied_at
   from selected_notes where v_kind in('orders','blockingOrders')
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select case when v_blocking then (select manual from operator_stats) else raw end from blocking_stats),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
      count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from notes group by category,category_key)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where not v_blocking and rejection_note is null),
    'withOperator',(select count(*) from notes where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',(select count(*) from selected_notes))
     ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis',case when v_date>=DATE '2026-10-10' then 'ar_operator_rejected_or_verified_detail_manual_submit' else 'current_operator' end) else '{}'::jsonb end
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_blocking then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_blocking then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',case when v_ar_raw_only then null else v_expected end,'complete',case when v_ar_raw_only then false else v_count=v_expected end,'rejected',v_rejected,'withManualRemark',case when v_blocking then (v_summary->'operatorCounts'->>'manualWithReason')::bigint else v_noted end),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;end if;
  if v_ar_raw_only then
   -- Absence of received facts is not proof of zero; do not resurrect old reports.
   return jsonb_build_object('available',false,'source','AR 已采集订单','country',v_country,'platform',v_platform,
    'date',v_date,'kind',v_kind,'rows','[]'::jsonb,'total',0,'offset',v_offset,'limit',v_limit,
    'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
    'coverage',jsonb_build_object('collected',0,'expected',null,'complete',false,'state','no_received_facts'),
    'updatedAt',null,'latestSnapshotDate',null,'snapshotFallback',false,
    'message','所选日期尚无已入库提现明细；不能认定为零笔或已完整采集');
  end if;

 RETURN NULL;
END;$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_complete(claim jsonb, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE j private.withdraw_prepared_jobs%rowtype;aid uuid;at timestamptz:=clock_timestamp();bytes integer;v jsonb;c jsonb;dep text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_compute_denied';END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('published',false,'reason','obsolete_claim');END IF;
 c:=j.scope->'context';v:=j.scope->'version';dep:=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text);
 IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN
  UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,attempts=3,last_error='obsolete_native'WHERE id=j.id AND status='running'AND run_id=(claim->>'runId')::uuid AND fence=(claim->>'fence')::bigint;
  RETURN jsonb_build_object('published',false,'reason','obsolete_native');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid FOR UPDATE;
 IF NOT FOUND OR j.request_key->>0<>'withdraw-reasons-blocking-v1'OR j.claim_pid IS DISTINCT FROM pg_backend_pid()
 OR j.claim_backend_start IS DISTINCT FROM(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())
 OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=at THEN RETURN jsonb_build_object('published',false,'reason','obsolete_claim');END IF;
 IF j.scope->'context'IS DISTINCT FROM c OR j.scope->'version'IS DISTINCT FROM v THEN
  UPDATE private.withdraw_prepared_jobs SET status='queued',lease_until=null,attempts=0,not_before=at,last_error='source_changed'WHERE id=j.id;
  RETURN jsonb_build_object('published',false,'reason','obsolete_manifest');END IF;
 IF payload IS NULL OR private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR j.dependency IS DISTINCT FROM dep OR payload->'version'IS DISTINCT FROM v OR payload->'context'IS DISTINCT FROM c THEN
  IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN
   UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,attempts=3,last_error='obsolete_native'WHERE id=j.id;
  ELSE
   v:=private.withdraw_reason_versions_ensure((c->'native')||jsonb_build_object('aliases',c->'aliases','rawOnly',c->'rawOnly'),(j.request->>'date')::date);
   IF v IS NULL THEN UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,attempts=3,last_error='source_unverifiable'WHERE id=j.id;
   ELSE UPDATE private.withdraw_prepared_jobs SET status='queued',lease_until=null,attempts=0,not_before=at+interval'1second',last_error='source_changed',
    scope=jsonb_build_object('context',c,'version',v)||(j.scope-ARRAY['context','version']),revision=revision+1,dependency=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text)WHERE id=j.id;END IF;
  END IF;
  RETURN jsonb_build_object('published',false,'reason','source_changed');END IF;
 bytes:=octet_length(payload::text);
 IF payload->>'contract'IS DISTINCT FROM'withdraw-reasons-blocking-v1'OR payload->'request'IS DISTINCT FROM j.request OR bytes>4194304
 OR jsonb_typeof(payload->'result'->'rows')IS DISTINCT FROM'array'OR jsonb_typeof(payload->'result'->'total')IS DISTINCT FROM'number'OR coalesce(payload->'result'->>'total','')!~'^[0-9]+$'OR(payload->'result'->>'total')::bigint IS DISTINCT FROM jsonb_array_length(payload->'result'->'rows')
 OR nullif(payload->>'computedAt','')IS NULL OR(payload->>'computedAt')::timestamptz>at OR(payload->>'computedAt')::timestamptz<at-interval'2minutes'THEN RAISE EXCEPTION 'withdraw_reason_payload_mismatch';END IF;
 IF(SELECT coalesce(sum(a.bytes),0)FROM private.withdraw_prepared_artifacts a)+bytes>134217728 THEN RAISE EXCEPTION 'withdraw_prepared_capacity';END IF;
 IF private.withdraw_reason_versions_match(v)IS NOT TRUE THEN UPDATE private.withdraw_prepared_jobs SET status='queued',lease_until=null,attempts=0,not_before=at+interval'1second',last_error='source_changed'WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','source_changed');END IF;
 INSERT INTO private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)
 VALUES(j.id,j.revision,j.fence,j.run_id,dep,payload,at,'infinity',bytes)RETURNING id INTO aid;
 INSERT INTO private.withdraw_prepared_heads VALUES(j.id,aid)ON CONFLICT(job_id)DO UPDATE SET artifact_id=excluded.artifact_id;
 UPDATE private.withdraw_prepared_jobs SET status='ready',attempts=0,lease_until=null,next_due_at=at+interval'1minute',last_error=null WHERE id=j.id;
 RETURN jsonb_build_object('published',true,'id',aid);
END;$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_compute(q jsonb, c jsonb, v jsonb, d text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_compute_denied';END IF;
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'withdraw_reason_read_committed_required';END IF;
 IF private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR d IS DISTINCT FROM md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text)THEN RETURN NULL;END IF;
 IF c->'native'->>'source'='ar'THEN result:=private.withdraw_reason_ar_all(q,c);
 ELSIF c->'native'->>'source'='newar'THEN
  -- Owner-only worker uses a server-resolved single native; this is an argument
  -- to the pure original SQL, never a JWT/session or a public-RPC impersonation.
  result:=private.withdraw_reason_newar_all(q,'{"mode":"all","countries":[]}'::jsonb,c->'native');
 ELSE RETURN NULL;END IF;
 IF private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR d IS DISTINCT FROM md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text)THEN RETURN NULL;END IF;
 IF result IS NULL OR result->>'kind'IS DISTINCT FROM'blocking'OR jsonb_typeof(result->'rows')IS DISTINCT FROM'array'OR jsonb_typeof(result->'total')IS DISTINCT FROM'number'OR coalesce(result->>'total','')!~'^[0-9]+$'
 OR(result->>'total')::bigint<>jsonb_array_length(result->'rows')THEN RAISE EXCEPTION 'withdraw_reason_incomplete';END IF;
 IF c->'native'->>'source'='newar'AND private.withdraw_reason_newar_index_valid(result)IS NOT TRUE THEN RAISE EXCEPTION 'withdraw_reason_label_index_incomplete';END IF;
 IF octet_length(result::text)>4000000 THEN RAISE EXCEPTION 'withdraw_reason_payload_too_large';END IF;
 RETURN jsonb_build_object('contract','withdraw-reasons-blocking-v1','request',q,'context',c,'version',v,'result',result,'computedAt',clock_timestamp());
END;$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_newar_all(p_request jsonb, p_scope jsonb, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
 v_country text:=btrim(p_request->>'country');v_platform text:=btrim(p_request->>'platform');
 v_kind text:=coalesce(p_request->>'kind','blocking');v_date date:=(p_request->>'date')::date;
 v_offset integer:=coalesce((p_request->>'offset')::integer,0);v_limit integer:=coalesce((p_request->>'limit')::integer,20);
 
 v_cfg record;v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
 -- Called only after the parent reader validates its request and obtains fresh scope.
 -- The helper itself has no external EXECUTE grant and never handles other sources.
 if p_meta->>'source' is distinct from 'newar' or v_kind<>'blocking' or nullif(p_request->>'reasonKey','')is not null or nullif(btrim(p_request->>'query'),'')is not null then return null;end if;
 if p_meta->>'country' is distinct from v_country
  or not private.dashboard_scope_allows(p_scope,v_country,v_platform)
  or not (private.dashboard_admin_live_withdraw_key(v_platform)=private.dashboard_admin_live_withdraw_key(p_meta->>'name')
   or private.dashboard_admin_live_withdraw_key(v_platform)=private.dashboard_admin_live_withdraw_key(p_meta->>'source_name'))
  then raise exception using errcode='42501',message='scope_denied';end if;
 select n.* into v_cfg from public.newar_detail_platforms n
  where n.platform=p_meta->>'source_name' and n.enabled
   and private.dashboard_scope_allows(p_scope,n.country_code,n.platform);
 if not found or v_cfg.country is distinct from v_country or v_cfg.timezone is distinct from p_meta->>'timezone'
  then raise exception using errcode='22023',message='platform_denied';end if;
 v_start:=v_date::timestamp at time zone v_cfg.timezone;v_end:=(v_date+1)::timestamp at time zone v_cfg.timezone;
 with scope_facts as materialized (
  -- The existing narrow indexed projection locates one platform/day. Automatic
  -- and unverified orders are counted without reading their wide source JSON.
  select f.* from private.newar_withdraw_facts f
  where f.platform=v_cfg.platform and f.created_at>=v_start and f.created_at<v_end
   and (v_cfg.launch_at is null or f.created_at>=v_cfg.launch_at)
 ), totals as (
  select count(*)::bigint collected,count(*) filter(where method='auto')::bigint system,
   count(*) filter(where method='manual')::bigint manual,count(*) filter(where method is null)::bigint unknown,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   max(captured_at) captured,max(received_at) received from scope_facts
 ), coverage as (
  select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) ranges,max(c.observed_at) seen
  from private.newar_detail_coverage_runs c where c.platform=v_cfg.platform and c.dataset='withdraw'
   and c.invalidated_at is null and c.observed_at<=statement_timestamp()
   and c.effective_start_at<v_end and c.end_at>v_start
 ), evidence as (
  select t.*,greatest(t.received,c.seen) updated,
   v_end<=statement_timestamp() and (v_cfg.launch_at is null or v_start>=v_cfg.launch_at)
    and coalesce(c.ranges @> tstzrange(v_start,v_end,'[)'),false)
    and coalesce(t.captured<=statement_timestamp(),true) complete from totals t cross join coverage c
 ), source_orders as materialized (
  select f.status_group,
   -- newar_reason_projection_v1: source updates maintain this narrow sidecar in the same transaction.
   -- Missing projection rows retain the existing source fallback; null labels do not borrow member notes.
   case when z.record_id is not null then z.source_label else
    case when n.raw->>'businessSchemaVersion'='2' and n.raw->>'automaticReasonSource'='remark'
     and jsonb_typeof(n.raw->'automaticReasonLabel')='string'
     and length(n.raw->>'automaticReasonLabel')<=256 and n.raw->>'automaticReasonLabel' !~ '[[:cntrl:]]'
     then nullif(btrim(n.raw->>'automaticReasonLabel'),'') end end source_label
  from scope_facts f left join private.newar_withdraw_reason_facts z on z.record_id=f.record_id
   and z.platform=v_cfg.platform and z.created_at=f.created_at and z.received_at=f.received_at
  left join lateral (
   select source_record.raw
   from public.newar_detail_records source_record
   where z.record_id is null and source_record.id=f.record_id
    and source_record.platform=v_cfg.platform and source_record.dataset='withdraw'
   limit 1
  ) n on true
  where f.method='manual'
 ), distinct_labels as materialized (
  select distinct coalesce(source_label,'') label from source_orders
 ), normalized_labels as materialized (
  select label,private.dashboard_admin_live_clean_note(label) source_reason from distinct_labels
 ), classified_labels as materialized (
  select label,nullif(source_reason,'') source_reason,
   case when source_reason ~ '[^[:space:]]' then 'present' else 'unknown' end note_state,
   case when source_reason ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(source_reason)
    else jsonb_build_object('reason','检测没备注') end details from normalized_labels
 ), reason_labels as materialized (
  select c.*,coalesce(details->>'reason',source_reason,'检测没备注') reason,
   md5(jsonb_build_array('newar_blocking_sanitized_v1',note_state,coalesce(details->>'reason',source_reason,'检测没备注'))::text) reason_key
  from classified_labels c
 ), notes as materialized (
  select o.*,r.source_reason,r.note_state,r.reason,r.reason_key,r.details
  from source_orders o join reason_labels r on r.label=coalesce(o.source_label,'')
 ), note_stats as (
  select count(*) filter(where note_state='present')::bigint present,
   count(*) filter(where note_state='unknown')::bigint unknown from notes
 ), groups as (
  select reason,reason_key "reasonKey",note_state "noteState",count(*)::bigint count,
   min(source_reason) as "sourceReason",count(distinct source_reason)::bigint "sourceVariantCount",
   count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from notes group by reason,reason_key,note_state
 ), label_counts as materialized (
  -- One classified label is stored once; no order/member identifiers enter the artifact.
  select coalesce(source_label,'') label,source_reason,note_state,reason_key,details-'reason' details,
   count(*)::bigint count,count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from notes group by coalesce(source_label,''),source_reason,note_state,reason_key,details
 ), rendered as materialized (
  select to_jsonb(g)item,g.count sort_count,g.reason sort_text from groups g
 ), page as (
  select * from rendered order by sort_count desc,sort_text
 )
 select jsonb_build_object('available',e.collected>0 or e.complete,'source','NEWAR 已采集订单','basis','automaticReasonLabel',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'offset',v_offset,'limit',v_limit,
  'total',(select count(*) from rendered),'rows',coalesce((select jsonb_agg(item order by sort_count desc,sort_text) from page),'[]'::jsonb),
  '_newarLabelIndex',jsonb_build_object('format','newar-label-index-v1','rows',
   coalesce((select jsonb_agg(jsonb_build_array(label,source_reason,note_state,reason_key,details,count,success,rejected,other)order by label)from label_counts),'[]'::jsonb)),
  'noteCount',case when e.collected>0 or e.complete then e.manual end,'categories','[]'::jsonb,
  'summary',case when e.collected>0 or e.complete then jsonb_build_object(
   'totalRejected',e.rejected,'selectedCount',(select count(*) from notes),
   'operatorBasis','verified_business_schema_v2','operatorCounts',jsonb_build_object('total',e.collected,'manual',e.manual,'system',e.system,'unknown',e.unknown,
    'manualWithReason',ns.present,'manualWithoutReason',ns.unknown),
   'blockingCounts',jsonb_build_object('raw',ns.present,'manual',ns.present,'system',0,'unknown',0)) else '{}'::jsonb end,
  'canViewBlockingOrders',true,'canViewOrders',false,'canViewOperators',false,'timeBasis','created_at',
  'coverage',jsonb_build_object('collected',e.collected,'expected',null,'complete',e.complete,'rejected',case when e.collected>0 or e.complete then e.rejected end,
   'withManualRemark',case when e.collected>0 or e.complete then ns.present end,'state',case when e.complete then 'complete' when e.collected>0 then 'received_partial' else 'no_received_facts' end),
  'updatedAt',e.updated,'latestSnapshotDate',null,'snapshotFallback',false,
  'message',case when e.collected=0 and not e.complete then '所选日期尚无已入库提现明细；不能认定为零笔或已完整采集' end)
 into v_result from evidence e cross join note_stats ns;
 return v_result;
end;
$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_newar_detail_page(payload jsonb, q jsonb, p_scope jsonb, p_native jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE kind text:=q->>'kind';reason_key text:=q->>'reasonKey';cfg record;
 v_start timestamptz;v_end timestamptz;result jsonb;v_query text:=nullif(btrim(q->>'query'),'');
 v_offset integer:=coalesce((q->>'offset')::integer,0);v_limit integer:=coalesce((q->>'limit')::integer,20);
BEGIN
 IF current_user<>'postgres'OR p_native->>'source'IS DISTINCT FROM'newar'
 OR NOT private.dashboard_scope_allows(p_scope,q->>'country',q->>'platform')
 OR p_native->>'country'IS DISTINCT FROM q->>'country'
 OR payload->>'country'IS DISTINCT FROM q->>'country'OR payload->>'platform'IS DISTINCT FROM q->>'platform'
 OR payload->>'date'IS DISTINCT FROM q->>'date'
 OR NOT(private.dashboard_admin_live_withdraw_key(q->>'platform')=private.dashboard_admin_live_withdraw_key(p_native->>'name')
  OR private.dashboard_admin_live_withdraw_key(q->>'platform')=private.dashboard_admin_live_withdraw_key(p_native->>'source_name'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied';END IF;
 IF kind NOT IN('blockingVariants','blockingOrders')OR coalesce(reason_key,'')!~'^[a-f0-9]{32}$'
 OR v_offset<0 OR v_limit NOT BETWEEN 1 AND 500 OR private.withdraw_reason_newar_index_valid(payload)IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='withdraw_reason_label_index_invalid';END IF;
 IF kind='blockingVariants'THEN
  IF v_query IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';END IF;
  WITH labels AS(SELECT x,x->>1 source_reason,x->>2 note_state FROM jsonb_array_elements(payload->'_newarLabelIndex'->'rows')r(x)WHERE x->>3=reason_key),
  grp AS(SELECT x FROM jsonb_array_elements(payload->'rows')r(x)WHERE x->>'reasonKey'=reason_key),
  variants AS(SELECT jsonb_build_object('reason',g.x->>'reason','reasonKey',reason_key,'noteState',l.note_state,
    'sourceReason',l.source_reason,'canonicalReason',g.x->>'reason','count',sum((l.x->>5)::bigint),
    'success',sum((l.x->>6)::bigint),'rejected',sum((l.x->>7)::bigint),'other',sum((l.x->>8)::bigint))item,
    sum((l.x->>5)::bigint)n,coalesce(l.source_reason,'')txt
   FROM labels l CROSS JOIN grp g GROUP BY g.x,l.note_state,l.source_reason),
  page AS(SELECT *FROM variants ORDER BY n DESC,txt OFFSET v_offset LIMIT v_limit)
  SELECT(payload-ARRAY['rows','total','kind','offset','limit','_newarLabelIndex','summary'])||
   jsonb_build_object('kind',kind,'offset',v_offset,'limit',v_limit,'total',(SELECT count(*)FROM variants),
    'rows',coalesce((SELECT jsonb_agg(item ORDER BY n DESC,txt)FROM page),'[]'::jsonb),
    'summary',(payload->'summary')||jsonb_build_object('selectedCount',coalesce((SELECT sum(n)FROM variants),0)))INTO result;
  RETURN result;
 END IF;
 -- Same native/day projection and source fallback as the original reader. The
 -- sealed index replaces classification only; order fields stay live and paged.
 SELECT n.*INTO cfg FROM public.newar_detail_platforms n WHERE n.platform=p_native->>'source_name'AND n.enabled
  AND private.dashboard_scope_allows(p_scope,n.country_code,n.platform);
 IF NOT FOUND OR cfg.country IS DISTINCT FROM q->>'country'OR cfg.timezone IS DISTINCT FROM p_native->>'timezone'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='platform_denied';END IF;
 v_start:=(q->>'date')::date::timestamp AT TIME ZONE cfg.timezone;
 v_end:=((q->>'date')::date+1)::timestamp AT TIME ZONE cfg.timezone;
 WITH labels AS MATERIALIZED(SELECT x FROM jsonb_array_elements(payload->'_newarLabelIndex'->'rows')r(x)WHERE x->>3=reason_key),
 grp AS(SELECT x FROM jsonb_array_elements(payload->'rows')r(x)WHERE x->>'reasonKey'=reason_key),
 source_orders AS MATERIALIZED(
  SELECT f.record_id,f.status_group,f.account,f.created_at,
   CASE WHEN isfinite(f.submitted_at)AND isfinite(f.handled_at)AND f.handled_at>=f.submitted_at
    AND f.handled_at<=f.captured_at AND f.handled_at<=statement_timestamp()THEN f.handled_at END handled_at,
   CASE WHEN z.record_id IS NOT NULL THEN z.order_number ELSE n.order_number END order_no,
   CASE WHEN z.record_id IS NOT NULL THEN z.amount ELSE n.amount END amount,
   coalesce(CASE WHEN z.record_id IS NOT NULL THEN z.display_state
    ELSE CASE WHEN jsonb_typeof(n.raw->'withdrawDisplayState')IN('string','number')
     AND length(n.raw->>'withdrawDisplayState')BETWEEN 1 AND 200 AND n.raw->>'withdrawDisplayState'!~'[[:cntrl:]]'
     THEN n.raw->>'withdrawDisplayState'END END,f.status_group)status,
   CASE WHEN z.record_id IS NOT NULL THEN z.source_label ELSE
    CASE WHEN n.raw->>'businessSchemaVersion'='2'AND n.raw->>'automaticReasonSource'='remark'
     AND jsonb_typeof(n.raw->'automaticReasonLabel')='string'AND length(n.raw->>'automaticReasonLabel')<=256
     AND n.raw->>'automaticReasonLabel'!~'[[:cntrl:]]'THEN nullif(btrim(n.raw->>'automaticReasonLabel'),'')END END source_label
  FROM private.newar_withdraw_facts f LEFT JOIN private.newar_withdraw_reason_facts z ON z.record_id=f.record_id
   AND z.platform=cfg.platform AND z.created_at=f.created_at AND z.received_at=f.received_at
  LEFT JOIN LATERAL(SELECT source_record.order_number,source_record.amount,source_record.raw FROM public.newar_detail_records source_record
   WHERE z.record_id IS NULL AND source_record.id=f.record_id AND source_record.platform=cfg.platform AND source_record.dataset='withdraw'LIMIT 1)n ON true
  WHERE f.platform=cfg.platform AND f.method='manual'AND f.created_at>=v_start AND f.created_at<v_end
   AND(cfg.launch_at IS NULL OR f.created_at>=cfg.launch_at)
 ), selected AS MATERIALIZED(
  SELECT o.*,l.x idx,g.x group_row FROM source_orders o JOIN labels l ON l.x->>0=coalesce(o.source_label,'')CROSS JOIN grp g
  WHERE v_query IS NULL OR position(lower(v_query)IN lower(coalesce(o.order_no,'')))>0
 ), page AS(SELECT *FROM selected ORDER BY created_at DESC,coalesce(order_no,''),record_id OFFSET v_offset LIMIT v_limit),
 rendered AS(SELECT jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',account,
  'operatorKey',md5(account),'createdAt',created_at,'completedAt',handled_at,'manualRemark',idx->1,
  'reasonKey',reason_key,'blockingReason',group_row->>'reason','noteState',idx->>2,
  'blockingActualValue',idx->4->>'actualValue','blockingActualField',idx->4->>'actualField','blockingThreshold',idx->4->>'threshold',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true)item,created_at,order_no,record_id FROM page)
 SELECT(payload-ARRAY['rows','total','kind','offset','limit','_newarLabelIndex','summary'])||
  jsonb_build_object('kind',kind,'offset',v_offset,'limit',v_limit,'total',(SELECT count(*)FROM selected),
   'rows',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,coalesce(order_no,''),record_id)FROM rendered),'[]'::jsonb),
   'summary',(payload->'summary')||jsonb_build_object('selectedCount',(SELECT count(*)FROM selected)))INTO result;
 RETURN result;
END;$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_newar_index_valid(payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE idx jsonb:=payload->'_newarLabelIndex';bad boolean;
BEGIN
 IF idx->>'format'IS DISTINCT FROM'newar-label-index-v1'OR jsonb_typeof(idx->'rows')IS DISTINCT FROM'array'
 OR jsonb_typeof(payload->'rows')IS DISTINCT FROM'array'THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(idx->'rows')r(x)WHERE jsonb_typeof(x)<>'array'OR jsonb_array_length(x)<>9
  OR jsonb_typeof(x->0)<>'string'OR jsonb_typeof(x->1)NOT IN('string','null')OR coalesce(x->>2,'') NOT IN('present','unknown')
  OR coalesce(x->>3,'')!~'^[a-f0-9]{32}$'OR jsonb_typeof(x->4)<>'object'
  OR coalesce(x->>5,'')!~'^[0-9]+$'OR coalesce(x->>6,'')!~'^[0-9]+$'OR coalesce(x->>7,'')!~'^[0-9]+$'OR coalesce(x->>8,'')!~'^[0-9]+$')THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'rows')r(x)WHERE jsonb_typeof(x)IS DISTINCT FROM'object'
  OR coalesce(x->>'reasonKey','')!~'^[a-f0-9]{32}$'OR jsonb_typeof(x->'reason')IS DISTINCT FROM'string'
  OR coalesce(x->>'noteState','')NOT IN('present','unknown')
  OR coalesce(x->>'count','')!~'^[0-9]+$'OR coalesce(x->>'success','')!~'^[0-9]+$'
  OR coalesce(x->>'rejected','')!~'^[0-9]+$'OR coalesce(x->>'other','')!~'^[0-9]+$')THEN RETURN false;END IF;
 WITH i AS MATERIALIZED(SELECT x FROM jsonb_array_elements(idx->'rows')r(x)),
 grouped AS(SELECT x->>3 key,sum((x->>5)::bigint)n,sum((x->>6)::bigint)s,sum((x->>7)::bigint)r,sum((x->>8)::bigint)o FROM i GROUP BY x->>3),
 g AS(SELECT x FROM jsonb_array_elements(payload->'rows')r(x))
 SELECT coalesce((SELECT sum((x->>5)::bigint)FROM i),0)<>coalesce((payload->>'noteCount')::bigint,0)
 OR(SELECT count(*)FROM i)<>(SELECT count(DISTINCT x->>0)FROM i)
 OR(SELECT count(*)FROM g)<>(SELECT count(DISTINCT x->>'reasonKey')FROM g)
 OR EXISTS(SELECT 1 FROM i WHERE(x->>5)::bigint<>(x->>6)::bigint+(x->>7)::bigint+(x->>8)::bigint)
 OR EXISTS(SELECT 1 FROM grouped a FULL JOIN g ON g.x->>'reasonKey'=a.key
   WHERE a.key IS NULL OR g.x IS NULL OR a.n<>(g.x->>'count')::bigint OR a.s<>(g.x->>'success')::bigint
    OR a.r<>(g.x->>'rejected')::bigint OR a.o<>(g.x->>'other')::bigint) INTO bad;
 RETURN NOT bad;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END;$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_read(p_request jsonb, p_scope jsonb, p_native jsonb, p_aliases jsonb, p_raw_only boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE q jsonb;c jsonb;v jsonb;d text;k jsonb;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;sid uuid;day date;at timestamptz:=clock_timestamp();detail_result jsonb;detail boolean:=coalesce(p_native->>'source'='newar'AND p_request->>'kind'IN('blockingVariants','blockingOrders'),false);
BEGIN
 -- The original parent performed request validation, live session/page/data-scope
 -- admission and fresh native resolution. Keep an independent native scope check.
 IF current_user<>'postgres'OR NOT private.dashboard_scope_allows(p_scope,btrim(p_request->>'country'),btrim(p_request->>'platform'))THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied';END IF;
 IF jsonb_typeof(p_native)IS DISTINCT FROM'object'OR (coalesce(p_request->>'kind','blocking')<>'blocking'AND NOT detail)OR coalesce(p_native->>'source','')NOT IN('ar','newar')
 OR(p_native->>'source'='ar'AND NOT coalesce(p_raw_only,false))
 OR nullif(p_request->>'category','')IS NOT NULL
 OR(NOT detail AND nullif(p_request->>'reasonKey','')IS NOT NULL)
 OR(detail AND coalesce(p_request->>'reasonKey','')!~'^[a-f0-9]{32}$')
 OR nullif(p_request->>'operatorKey','')IS NOT NULL
 OR(p_request->>'kind'IS DISTINCT FROM'blockingOrders'AND nullif(btrim(p_request->>'query'),'')IS NOT NULL) THEN RETURN NULL;END IF;
 day:=(p_request->>'date')::date;
 IF nullif(p_native->>'timezone','')IS NULL OR(day+1)::timestamp AT TIME ZONE(p_native->>'timezone')>statement_timestamp()THEN RETURN NULL;END IF;
 q:=jsonb_build_object('country',btrim(p_request->>'country'),'platform',btrim(p_request->>'platform'),'date',day,'kind','blocking','offset',0,'limit',500);
 c:=jsonb_build_object('native',p_native,'aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false));
 IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN RETURN NULL;END IF;
 v:=private.withdraw_reason_versions_ensure(p_native||jsonb_build_object('aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false)),day);
 IF v IS NULL THEN RETURN jsonb_build_object('available',false,'country',q->'country','platform',q->'platform','date',day,'kind',coalesce(p_request->>'kind','blocking'),'rows',null,'total',null,'summary',null,'prepared',jsonb_build_object('contract','withdraw-reasons-blocking-v1','status','failed','reason','withdraw_reasons_source_unverifiable'));END IF;
 d:=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text);k:=jsonb_build_array('withdraw-reasons-blocking-v1',q,c);
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id;
 IF a.id IS NOT NULL AND a.revision=j.revision AND a.dependency=d AND j.dependency=d
 AND a.payload->>'contract'='withdraw-reasons-blocking-v1'AND a.payload->'request'=q AND a.payload->'context'=c AND a.payload->'version'=v
 AND jsonb_typeof(a.payload->'result'->'rows')='array'AND(a.payload->'result'->>'total')::bigint=jsonb_array_length(a.payload->'result'->'rows')
 AND(p_native->>'source'<>'newar'OR private.withdraw_reason_newar_index_valid(a.payload->'result'))
 AND private.withdraw_reason_context_current(c)AND private.withdraw_reason_versions_match(v)THEN
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=at,scope=scope||jsonb_build_object('humanRequestedAt',at) WHERE id=j.id AND last_requested_at<at-interval'5minutes';
  IF NOT detail THEN RETURN private.withdraw_reason_page(a.payload->'result',p_request);END IF;
  detail_result:=private.withdraw_reason_newar_detail_page(a.payload->'result',p_request,p_scope,p_native);
  -- An order-page source read cannot outlive the sealed source/config generation.
  IF private.withdraw_reason_context_current(c)AND private.withdraw_reason_versions_match(v)
   AND d=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text)THEN RETURN detail_result;END IF;
 END IF;
 sid:=private.withdraw_reason_enqueue(q,c,v,d,false);
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=sid;
 RETURN jsonb_build_object('available',false,'country',q->'country','platform',q->'platform','date',day,'kind',coalesce(p_request->>'kind','blocking'),'rows',null,'total',null,'summary',null,
  'prepared',jsonb_build_object('contract','withdraw-reasons-blocking-v1',
   'status',CASE WHEN j.id IS NULL OR j.status='failed'AND j.attempts>=3 THEN'failed'ELSE'building'END,
   'reason',CASE WHEN j.id IS NULL THEN'withdraw_reasons_admission_limited'WHEN j.status='failed'AND j.attempts>=3 THEN coalesce(j.last_error,'withdraw_reasons_compute_failed')ELSE'withdraw_reasons_preparing'END));
END;$function$;$definition$;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION private.withdraw_reason_parent_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(md5(p.prosrc)IN('4dcc9f7eb3d7b7501122cb39458dcc92','dc1a598304d20fff2d8db32b47709a29','ca80e97796cd780b93e77f6e5dcb02dd')
 AND pg_get_userbyid(p.proowner)='postgres'AND p.prosecdef AND p.proparallel='u'AND NOT p.proisstrict AND NOT p.proleakproof
 AND p.provolatile=CASE WHEN md5(p.prosrc)='4dcc9f7eb3d7b7501122cb39458dcc92'THEN's'::"char"ELSE'v'::"char"END
 AND p.proconfig=ARRAY['search_path=""','plan_cache_mode=force_custom_plan']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
 AND pg_get_function_arguments(p.oid)='p_request jsonb'AND pg_get_function_result(p.oid)='jsonb'
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql'),false)
 FROM pg_proc p WHERE p.oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
$function$;$definition$;
 DROP FUNCTION private.withdraw_reason_wg_atomic(jsonb,jsonb);
 DROP FUNCTION private.dashboard_admin_live_blocking_members(jsonb,text,text);
 DROP FUNCTION private.dashboard_admin_live_blocking_core(text);
 FOR spec IN SELECT value FROM jsonb_array_elements(specs)LOOP
  SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(spec->>'signature');
  IF spec->'metadata'<>'null'::jsonb THEN
   IF md5(p.prosrc)IS DISTINCT FROM spec->>'old_hash'OR(to_jsonb(p)-'prosrc')IS DISTINCT FROM before_meta->(spec->>'signature')THEN RAISE EXCEPTION 'atomic_rules_postflight_mismatch: %',spec->>'signature';END IF;
  ELSE
   IF p.oid IS NOT NULL THEN RAISE EXCEPTION 'atomic_rules_rollback_helper_exists';END IF;
  END IF;
 END LOOP;
 IF finance_before IS DISTINCT FROM jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),
 'providerIN',(select md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(n),private.provider_snapshot_dependency_token(to_jsonb(n)))order by n.id),'[]')::text)
 from private.prepared_aggregate_native_catalog()n where n.country='印度'and n.source in('ar','newar')))THEN RAISE EXCEPTION 'atomic_rules_financial_dependency_changed';END IF;
 IF private.withdraw_reason_dependency()IS NOT DISTINCT FROM reason_before THEN RAISE EXCEPTION 'atomic_rules_reason_dependency_unchanged';END IF;
 IF private.withdraw_reason_parent_current()IS NOT TRUE THEN RAISE EXCEPTION 'atomic_rules_parent_guard_mismatch';END IF;
END;$repair$;
COMMIT;
