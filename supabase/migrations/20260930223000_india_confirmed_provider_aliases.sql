-- Owner-confirmed India identities, 2026-09-30:
-- Wallet66 / Wallet66-BSC; RushPay / Rushpay-Bank; BasePay-QR / FFPay.
-- Patch only the installed exact-name dictionaries. Preserve query logic,
-- manual overrides, source rows, fee rates, scopes and function privileges.
-- The historical confirmed_usdt helper is also used for raw bank/QR identities
-- so every existing canonical/config/options/filter/workorder caller agrees.
begin;
do $patch$
declare
  item record;
  definition text;
  original text;
  mapping jsonb;
  scoped jsonb;
  pair record;
  additions constant jsonb := '{"wallet66":"Wallet66","wallet66-bsc":"Wallet66","rushpay":"RushPay","rushpay-bank":"RushPay","basepay-qr":"FFPay","ffpay":"FFPay"}'::jsonb;
begin
  for item in select * from (values
    ('private.dashboard_admin_live_provider_alias(text,text)', '$aliases$', true),
    ('private.dashboard_admin_live_confirmed_usdt_provider(text,text)', '$confirmed$', false)
  ) helpers(signature,marker,country_scoped) loop
    select pg_get_functiondef(to_regprocedure(item.signature)) into definition;
    if definition is null or
      (length(definition)-length(replace(definition,item.marker,'')))/length(item.marker)<>2 then
      raise exception 'Provider alias dictionary baseline changed: %',item.signature;
    end if;
    original:=split_part(definition,item.marker,2);
    mapping:=original::jsonb;
    scoped:=case when item.country_scoped then mapping->'印度' else mapping end;
    if jsonb_typeof(scoped) is distinct from 'object' then
      raise exception 'Provider alias dictionary missing India scope: %',item.signature;
    end if;
    for pair in select * from jsonb_each_text(additions) loop
      if scoped ? pair.key and scoped->>pair.key is distinct from pair.value then
        raise exception 'Provider alias already has a different assignment: % / %',item.signature,pair.key;
      end if;
    end loop;
    scoped:=scoped||additions;
    mapping:=case when item.country_scoped then jsonb_set(mapping,array['印度'],scoped) else scoped end;
    execute replace(definition,item.marker||original||item.marker,item.marker||mapping::text||item.marker);
  end loop;
end;
$patch$;
notify pgrst,'reload schema';
commit;
