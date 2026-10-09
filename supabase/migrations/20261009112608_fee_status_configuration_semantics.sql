-- The synchronized platform-status table contains connection matrix cells, not
-- platform fee contracts: the publisher clears their fee fields intentionally.
-- Preserve current rates, immutable historical pricing, permissions and raw names.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$
declare r record;p pg_proc%rowtype;
begin
 for r in select * from(values
  ('private.dashboard_admin_live_rates(jsonb)','0174c5be44fcd4a1b64e974faf535d50','{postgres=X/postgres,authenticated=X/postgres}'),
  ('private.dashboard_admin_live_provider_canonical(text,text,text)','e9aad6a950b5488b9dce903bf99dacc6','{postgres=X/postgres}')
 ) v(signature,body_hash,acl) loop
  select * into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(p.prosrc) is distinct from r.body_hash then raise exception 'fee_status_baseline_drift: %',r.signature;end if;
  if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from r.acl or not p.prosecdef
   or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""'] then
   raise exception 'fee_status_metadata_drift: %',r.signature;end if;
 end loop;
end $guard$;
do $rates$
declare target regprocedure:='private.dashboard_admin_live_rates(jsonb)'::regprocedure;
 p pg_proc%rowtype;metadata jsonb;definition text;
 old_fragment text:=$old$'id',p.id,'sourceId',p.source_id,'scopeType',p.scope_type,$old$;
 new_fragment text:=$new$'id',p.id,'sourceId',p.source_id,'scopeType',p.scope_type,
      -- Source semantics, not a guess from blank fee values. Current synchronized
      -- third_party_platform_status rows are emitted by clearStatusFeeFields.
      -- Consumers must still retain any nonempty fee rule on a marked row.
      'configurationRole',case when p.scope_type='platform' then 'connection_status' else 'rate' end,
      -- Owner explicitly confirmed on 2026-10-09 that the named India-sheet
      -- payout single fee 6 is INR. This is current estimation evidence only;
      -- it neither creates a historical effective date nor invents a sheet cell.
      'currentFeeCurrencyEvidence',case when p.scope_type='country' and p.country in ('印度','IN')
        and p.sheet_name='印度线下' and btrim(p.payout_single_fee) ~ '^6([.]0+)?([[:space:]]*/[[:space:]]*笔)?$'
        and p.provider in ('UpiPay','UmoneyPay','MovPay','NewWinPay','RushPay','BussPay','3TPay','GaayPay','CedarPay','WPay','ATPay','VstarPay','YayaPay')
        then jsonb_build_object('withdraw',jsonb_build_object('currency','INR','fixedFee',6,'basis','owner_confirmation',
          'confirmedAt','2026-10-09','sourceSheet',p.sheet_name,'sourceId',p.source_id,'provider',p.provider,'country',p.country))
        else '{}'::jsonb end,$new$;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'fee_status_reader_anchor_drift';end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(q)-'prosrc' from pg_proc q where oid=target) is distinct from metadata then raise exception 'fee_status_reader_metadata_changed';end if;
end $rates$;
do $alias$
declare target regprocedure:='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure;
 p pg_proc%rowtype;metadata jsonb;definition text;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,'select private.dashboard_admin_live_provider_alias(p_country,coalesce(','')))/length('select private.dashboard_admin_live_provider_alias(p_country,coalesce(')<>1
 or (length(definition)-length(replace(definition,'),p_raw));','')))/length('),p_raw));')<>1 then raise exception 'yash_fee_alias_anchor_drift';end if;
 -- Exact source evidence: KB supplier WinPay uses NewWin-QR / NewWinPay.
 -- No global alias: WinPay on other platforms or countries remains unchanged.
 definition:=replace(definition,'select private.dashboard_admin_live_provider_alias(p_country,coalesce(',
  $new$select case when p_country in ('IN','印度') and p_platform in ('YASH.BET','YASHBET') and btrim(p_raw)='WinPay'
  then private.dashboard_admin_live_provider_alias(p_country,coalesce(
    (select o.canonical_provider from private.dashboard_admin_provider_overrides o
     where o.country=p_country and o.platform=p_platform and o.raw_provider=btrim(p_raw)),
    'NewWinPay')) else private.dashboard_admin_live_provider_alias(p_country,coalesce($new$);
 definition:=replace(definition,'),p_raw));','),p_raw)) end;');
 execute definition;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where oid=target) is distinct from metadata then raise exception 'yash_fee_alias_metadata_changed';end if;
end $alias$;
commit;
