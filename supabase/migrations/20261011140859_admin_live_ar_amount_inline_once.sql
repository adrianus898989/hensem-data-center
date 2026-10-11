-- Inline one fingerprinted native AR amount rule in the scoped query source.
-- Date clocks, fees, status, source scopes, output and native monetary precision
-- remain unchanged. Future helper drift uses the original call at runtime.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $patch$
declare target regprocedure:=to_regprocedure('private.dashboard_admin_live_query_raw(jsonb)');
 p pg_proc%rowtype;m pg_proc%rowtype;before_metadata jsonb;d text;
 anchor text:=$anchor$    -- custom_ar_date_union_v1: index each clock, retain each source row once.$anchor$;
 replacement text:=$replacement$    -- ar_local_amount_known_inline_v1: only the fingerprinted native rule is
    -- expanded. A future amount-helper change retains the original call.
    if exists(select 1 from pg_catalog.pg_proc m
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
    -- custom_ar_date_union_v1: index each clock, retain each source row once.$replacement$;
begin
 if target is null then raise exception 'AR_AMOUNT_INLINE_TARGET_MISSING';end if;
 select * into strict p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u' or p.proisstrict or p.proleakproof
  or p.proconfig is distinct from array['search_path=""','jit=off']
  or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prorettype<>'jsonb'::regtype or p.proretset or p.pronargs<>1 or p.pronargdefaults<>1
  or pg_get_function_identity_arguments(target)<>'p_request jsonb' then
  raise exception 'AR_AMOUNT_INLINE_METADATA_MISMATCH';end if;
 select * into m from pg_proc where oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)');
 if not found or md5(m.prosrc)<>'dc8b95205e35b7366f4f9dbf052d307d'
  or m.proowner<>'postgres'::regrole or m.prolang<>(select oid from pg_language where lanname='sql')
  or m.provolatile<>'i' or m.proparallel<>'s' or m.prosecdef or m.proisstrict or m.proleakproof
  or m.proconfig is distinct from array['search_path=""']
  or m.proacl::text is distinct from '{postgres=X/postgres}' or m.pronargdefaults<>0
  or m.prorettype<>'numeric'::regtype or m.proretset or m.pronargs<>8 then
  raise exception 'AR_AMOUNT_INLINE_HELPER_MISMATCH';end if;
 if md5(p.prosrc)='18be6ff6349345d21da91592231567bd' then return;end if;
 if md5(p.prosrc)<>'26b4cf0c448c9f001576d1a933aea8d9' then
  raise exception 'AR_AMOUNT_INLINE_BODY_MISMATCH';end if;
 before_metadata:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(target);
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then
  raise exception 'AR_AMOUNT_INLINE_ANCHOR_MISMATCH';end if;
 execute replace(d,anchor,replacement);
 select * into strict p from pg_proc where oid=target;
 if md5(p.prosrc)<>'18be6ff6349345d21da91592231567bd'
  or (to_jsonb(p)-'prosrc') is distinct from before_metadata then
  raise exception 'AR_AMOUNT_INLINE_POSTCHECK_MISMATCH';end if;
end $patch$;
commit;
