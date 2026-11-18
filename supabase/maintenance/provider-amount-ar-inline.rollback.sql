-- Restore the exact preceding raw reader, only from this installed amount-matrix patch.
-- No orders, publication state, ACLs, schedules or helper definitions are modified.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $patch$
declare target regprocedure:=to_regprocedure('private.dashboard_admin_live_drilldown_raw(jsonb)');
 p pg_proc%rowtype;before_metadata jsonb;d text;
 anchor text:=$anchor$    -- custom_ar_date_union_v1: latency already reads only its successful clock.$anchor$;
 replacement text:=$replacement$    -- provider_amount_ar_known_inline_v1: only amount matrices expand the
    -- fingerprinted rule; ordinary/hour/detail reads retain their source.
    -- A future amount-helper change retains the original call at runtime.
    if p_request->'providerAmountMatrix'='true'::jsonb and exists(select 1 from pg_catalog.pg_proc m
      where m.oid=pg_catalog.to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
        and pg_catalog.md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
        and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
        and m.provolatile='i' and m.proparallel='s' and not m.prosecdef and not m.proisstrict and not m.proleakproof
        and m.proconfig is not distinct from array['search_path=""']
        and m.proacl::text is not distinct from '{postgres=X/postgres}' and m.pronargdefaults=0
        and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8) then
      v_source:=replace(v_source,$ar_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))$ar_amount_call$,$ar_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
 END$ar_amount_case$);
    end if;
    -- custom_ar_date_union_v1: latency already reads only its successful clock.$replacement$;
begin
 if target is null then raise exception 'PROVIDER_AMOUNT_AR_ROLLBACK_TARGET_MISSING';end if;
 select * into strict p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u' or p.proisstrict or p.proleakproof
  or p.proconfig is distinct from array['search_path=""','jit=off']
  or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prorettype<>'jsonb'::regtype or p.proretset or p.pronargs<>1 or p.pronargdefaults<>0
  or pg_get_function_identity_arguments(target)<>'p_request jsonb' then
  raise exception 'PROVIDER_AMOUNT_AR_ROLLBACK_METADATA_MISMATCH';end if;
 if md5(p.prosrc)='d5c6f989646068bc8ae44e8f9cf7e204' then return;end if;
 if md5(p.prosrc)<>'c3f1089d451d269f385dab8193ca30ae' then
  raise exception 'PROVIDER_AMOUNT_AR_ROLLBACK_BODY_MISMATCH';end if;
 before_metadata:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(target);
 if (length(d)-length(replace(d,replacement,'')))/length(replacement)<>1 then
  raise exception 'PROVIDER_AMOUNT_AR_ROLLBACK_ANCHOR_MISMATCH';end if;
 execute replace(d,replacement,anchor);
 select * into strict p from pg_proc where oid=target;
 if md5(p.prosrc)<>'d5c6f989646068bc8ae44e8f9cf7e204'
  or (to_jsonb(p)-'prosrc') is distinct from before_metadata then
  raise exception 'PROVIDER_AMOUNT_AR_ROLLBACK_POSTCHECK_MISMATCH';end if;
end $patch$;
commit;
