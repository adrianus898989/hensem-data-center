-- Business rule confirmed by the source operator: rejected AR withdrawals require manual handling.
-- Only unknown AR methods change; explicit system markers remain automatic. No NEWAR/YASH/source/fact DML.
-- Stored facts and projection readiness retain their exact native provenance; classification is derived on read.
-- Duration expressions are unchanged, so the historical duration generation keeps its original value while
-- admitting only the exact new AR reader fingerprint. Existing verified day/hour receipts stay usable.
begin;
set local lock_timeout='2s';set local statement_timeout='15s';
do $ar_rejected_manual$
declare p record;d text;before_meta jsonb;fact_generation text;duration_generation text;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if not (p.proretset and p.prorettype='record'::regtype and p.pronargs=4 and pg_get_function_result(p.oid)=$out$TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])$out$) or md5(p.prosrc) not in('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471') or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from false or p.provolatile<>'s' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'AR_REJECTED_MANUAL_METADATA_OR_BODY_DRIFT_0';end if;
 select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if not (not p.proretset and p.prorettype='jsonb'::regtype and p.pronargs=1) or md5(p.prosrc) not in('b1b3aa50ae5c05ab9c98acf446c601ab','e5d7ffe578bf503374334b8097e8095f') or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from true or p.provolatile<>'s' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'AR_REJECTED_MANUAL_METADATA_OR_BODY_DRIFT_1';end if;
 select * into p from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure;
 if not (not p.proretset and p.prorettype='text'::regtype and p.pronargs=0) or md5(p.prosrc) not in('a6f3c885ea14511edb6fcf48ee32113c','7782a45c2346c6b5cecffab74801a324') or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from false or p.provolatile<>'s' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='sql') or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'AR_REJECTED_MANUAL_METADATA_OR_BODY_DRIFT_2';end if;
 select * into p from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if p.proretset or p.prorettype<>'jsonb'::regtype or p.pronargs<>1 or p.prolang<>(select oid from pg_language where lanname='plpgsql') or md5(p.prosrc)<>'cb33854922fdb014a665fba646ace941' or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'AR_REJECTED_MANUAL_MAIN_DRIFT';end if;
 fact_generation:=private.ar_withdraw_fact_generation();duration_generation:=private.ar_historical_duration_generation();
 if fact_generation is null or duration_generation is null then raise exception 'AR_REJECTED_MANUAL_GENERATION_INVALID';end if;
 select * into p from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if md5(p.prosrc)='3e7e5666a6e7b869a02513221597da1a' then
  before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
  if (length(d)-length(replace(d,$old_0_0$CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN 'unknown'
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method$old_0_0$,'')))/length($old_0_0$CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN 'unknown'
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method$old_0_0$)<>1 then raise exception 'AR_REJECTED_MANUAL_ANCHOR_DRIFT_0_0';end if;
  d:=replace(d,$old_0_0$CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN 'unknown'
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method$old_0_0$,$new_0_0$CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN
    CASE WHEN (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0 OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) AND NOT (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0 OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0) OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) THEN 'manual' ELSE 'unknown' END
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method$new_0_0$);
  if (length(d)-length(replace(d,$old_0_1$f.updated_at,f.is_success,f.is_rejected,f.method
  FROM partitions$old_0_1$,'')))/length($old_0_1$f.updated_at,f.is_success,f.is_rejected,f.method
  FROM partitions$old_0_1$)<>1 then raise exception 'AR_REJECTED_MANUAL_ANCHOR_DRIFT_0_1';end if;
  d:=replace(d,$old_0_1$f.updated_at,f.is_success,f.is_rejected,f.method
  FROM partitions$old_0_1$,$new_0_1$f.updated_at,f.is_success,f.is_rejected,
   CASE WHEN f.method='unknown' AND f.is_rejected AND NOT f.is_success THEN 'manual' ELSE f.method END
  FROM partitions$new_0_1$);
  execute d;select * into p from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
  if md5(p.prosrc)<>'b8b971e82282e984bcdfc90c17c9a471' or (to_jsonb(p)-'prosrc') is distinct from before_meta then raise exception 'AR_REJECTED_MANUAL_PATCH_POSTCHECK_0';end if;
 end if;

 select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc)='b1b3aa50ae5c05ab9c98acf446c601ab' then
  before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
  if (length(d)-length(replace(d,$old_1_0$case when nullif(regexp_replace(coalesce(operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end blocking_operator_class$old_1_0$,'')))/length($old_1_0$case when nullif(regexp_replace(coalesce(operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end blocking_operator_class$old_1_0$)<>1 then raise exception 'AR_REJECTED_MANUAL_ANCHOR_DRIFT_1_0';end if;
  d:=replace(d,$old_1_0$case when nullif(regexp_replace(coalesce(operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end blocking_operator_class$old_1_0$,$new_1_0$case when v_date<DATE '2026-10-10' then case when nullif(regexp_replace(coalesce(operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end else case when lower(btrim(replace(replace(coalesce(operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) IN('','----','---','--','-','null','none','n/a') then
     case when (position('未通过' IN coalesce(status,''))>0 OR position('驳回' IN coalesce(status,''))>0 OR position('拒绝' IN coalesce(status,''))>0 OR position('reject' IN lower(coalesce(status,'')))>0 OR position('failed' IN lower(coalesce(status,'')))>0) AND NOT (position('已通过' IN coalesce(status,''))>0 OR position('已提交' IN coalesce(status,''))>0 OR (position('通过' IN coalesce(status,''))>0 AND position('未通过' IN coalesce(status,''))=0) OR position('success' IN lower(coalesce(status,'')))>0 OR position('submitted' IN lower(coalesce(status,'')))>0 OR position('成功' IN coalesce(status,''))>0) then 'manual' else 'unknown' end
     when position('system' IN lower(btrim(replace(replace(coalesce(operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0 then 'system' else 'manual' end end blocking_operator_class$new_1_0$);
  if (length(d)-length(replace(d,$old_1_1$'operatorBasis','current_operator'$old_1_1$,'')))/length($old_1_1$'operatorBasis','current_operator'$old_1_1$)<>1 then raise exception 'AR_REJECTED_MANUAL_ANCHOR_DRIFT_1_1';end if;
  d:=replace(d,$old_1_1$'operatorBasis','current_operator'$old_1_1$,$new_1_1$'operatorBasis',case when v_date>=DATE '2026-10-10' then 'ar_operator_or_rejected_business_rule' else 'current_operator' end$new_1_1$);
  execute d;select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
  if md5(p.prosrc)<>'e5d7ffe578bf503374334b8097e8095f' or (to_jsonb(p)-'prosrc') is distinct from before_meta then raise exception 'AR_REJECTED_MANUAL_PATCH_POSTCHECK_1';end if;
 end if;

 select * into p from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure;
 if md5(p.prosrc)='a6f3c885ea14511edb6fcf48ee32113c' then
  before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
  if (length(d)-length(replace(d,$old_2_0$md5(z.prosrc)='3e7e5666a6e7b869a02513221597da1a'$old_2_0$,'')))/length($old_2_0$md5(z.prosrc)='3e7e5666a6e7b869a02513221597da1a'$old_2_0$)<>1 then raise exception 'AR_REJECTED_MANUAL_ANCHOR_DRIFT_2_0';end if;
  d:=replace(d,$old_2_0$md5(z.prosrc)='3e7e5666a6e7b869a02513221597da1a'$old_2_0$,$new_2_0$md5(z.prosrc) IN('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471')$new_2_0$);
  execute d;select * into p from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure;
  if md5(p.prosrc)<>'7782a45c2346c6b5cecffab74801a324' or (to_jsonb(p)-'prosrc') is distinct from before_meta then raise exception 'AR_REJECTED_MANUAL_PATCH_POSTCHECK_2';end if;
 end if;

 if private.ar_withdraw_fact_generation() is distinct from fact_generation or private.ar_historical_duration_generation() is distinct from duration_generation then raise exception 'AR_REJECTED_MANUAL_GENERATION_CHANGED';end if;
end;$ar_rejected_manual$;
commit;
