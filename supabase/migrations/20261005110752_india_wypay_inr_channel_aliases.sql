-- Owner-confirmed exact India identities WYPayINR-PaytmQR / WYPayINR-Bank = WYPay, 2026-10-05.
-- Do not strip generic QR suffixes, rewrite source labels, replace manual
-- overrides, or alter transaction/fee history/query engines.
begin;
set local lock_timeout='3s';set local statement_timeout='20s';
do $patch$
declare item record;p pg_proc%rowtype;metadata jsonb;definition text;
 original text;mapping jsonb;scoped jsonb;
begin
 for item in select * from (values
  ('private.dashboard_admin_live_provider_alias(text,text)','$aliases$',true,'aaa2749eefc1ad665cf69b3af6e0f301','016e7206225e117f316e289c55c083e3'),
  ('private.dashboard_admin_live_confirmed_usdt_provider(text,text)','$confirmed$',false,'024e86e4fc8efe9a71db4d07a9ac283c','1f7ef2b8fa4b2beab20e10cc385c1f9f')
 ) helpers(signature,marker,country_scoped,baseline_hash,desired_hash) loop
  select * into p from pg_proc where oid=to_regprocedure(item.signature);
  if not found or p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
   or p.prosecdef or p.provolatile<>'i' or p.proconfig is distinct from array['search_path=""']::text[] then
   raise exception 'wypay_inr_alias_metadata_or_acl_drift: %',item.signature;end if;
  if md5(p.prosrc)=item.desired_hash then continue;end if;
  if md5(p.prosrc)<>item.baseline_hash then raise exception 'wypay_inr_alias_baseline_drift: %',item.signature;end if;
  metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,item.marker,'')))/length(item.marker)<>2 then
   raise exception 'wypay_inr_alias_dictionary_drift: %',item.signature;end if;
  original:=split_part(definition,item.marker,2);mapping:=original::jsonb;
  scoped:=case when item.country_scoped then mapping->'印度' else mapping end;
  if jsonb_typeof(scoped) is distinct from 'object' or
    (scoped ? 'wypayinr-paytmqr' and scoped->>'wypayinr-paytmqr' is distinct from 'WYPay') or
    (scoped ? 'wypayinr-bank' and scoped->>'wypayinr-bank' is distinct from 'WYPay') then
   raise exception 'wypay_inr_alias_assignment_drift: %',item.signature;end if;
  scoped:=scoped||'{"wypayinr-paytmqr":"WYPay","wypayinr-bank":"WYPay"}'::jsonb;
  mapping:=case when item.country_scoped then jsonb_set(mapping,array['印度'],scoped) else scoped end;
  execute replace(definition,item.marker||original||item.marker,item.marker||mapping::text||item.marker);
  select * into p from pg_proc where oid=to_regprocedure(item.signature);
  if (to_jsonb(p)-'prosrc') is distinct from metadata or md5(p.prosrc)<>item.desired_hash then
   raise exception 'wypay_inr_alias_installation_drift: %',item.signature;end if;
 end loop;
end;
$patch$;
notify pgrst,'reload schema';
commit;
