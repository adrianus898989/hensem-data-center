-- Merge verified Pakistan channel aliases in the existing report readers.
-- Source rows, fee rules, registry overrides and all other country mappings stay intact.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $install$
declare
  raw_map constant text := $pk_names${"allpay2":"AllPay2","allpay2-jazz":"AllPay2","allpay2pkr":"AllPay2","allpay2pkr-wallet2":"AllPay2","all2pay-ep":"AllPay2","allpay2pkr-easy":"AllPay2","all2pay-jz":"AllPay2","allpay2pkr-jazz":"AllPay2","atpay":"ATPay","atpaypkr":"ATPay","atpaypkr-easy2":"ATPay","atpaypkr-jazz2":"ATPay","cowpay":"CowPay","cowpaypkr":"CowPay","cowpaypkr-easy":"CowPay","cowpaypkr-jazz":"CowPay","cpay":"CPay","cpaypkr":"CPay","cpay-ep":"CPay","cpaypkr-easy":"CPay","cpay-jazz":"CPay","cpay-jz":"CPay","cpaypkr-jazz":"CPay","deepay":"DeePay","deepaypkr":"DeePay","dee-ep":"DeePay","deep-ep":"DeePay","deepay-easy":"DeePay","deepaypkr-easy":"DeePay","deepaypkr-easy2":"DeePay","dee-jazz":"DeePay","deep-jz":"DeePay","deepay-jazz":"DeePay","deepaypkr-jazz":"DeePay","deepaypkr-jazz2":"DeePay","epay":"EPay","epay2pkr":"EPay","epay-easy":"EPay","epay-ep":"EPay","epay2pkr-easy":"EPay","epay2pkr-easy2":"EPay","epay2pkr-ep":"EPay","epay-jazz":"EPay","epay-jazz1":"EPay","epay2pkr-jazz":"EPay","epay2pkr-jazz2":"EPay","epay2pkr-jz":"EPay","ezpay":"EZPay","ezpaypkr":"EZPay","ezpaypkr-easy":"EZPay","ezpaypkr-jazz":"EZPay","fulipay":"FuliPay","fulipaypkr":"FuliPay","fulipaypkr-jazz2":"FuliPay","goldpay":"GoldPay","goldpaypkr":"GoldPay","goldpaypkr-jazzqr":"GoldPay","ipay":"iPay","ipaypkr":"iPay","ipaypkr-easy":"iPay","ipaypkr-jazz":"iPay","mcbpay":"MCBPay","mcb":"MCBPay","mcb-jz":"MCBPay","mcbpay-ep":"MCBPay","mcbpay-jazz":"MCBPay","mcbpaypkr":"MCBPay","mcb-ep":"MCBPay","mcbpaypkr-easy":"MCBPay","mcbpaypkr-ep":"MCBPay","mcb-jazz":"MCBPay","mcbpaypkr-jazz":"MCBPay","mcbpaypkr-jz":"MCBPay","megapay":"MegaPay","megapaypkr":"MegaPay","mega-ep":"MegaPay","megapaypkr-easy":"MegaPay","megapaypkr-easy2":"MegaPay","mega-jazz":"MegaPay","megapaypkr-jazz":"MegaPay","nopaywallet":"NOPayWallet","nopaywalletpkr":"NOPayWallet","nopaywalletpkr-payin":"NOPayWallet","okpay":"OkPay","okpaypkr":"OkPay","ok-ep  qr":"OkPay","ok-ep":"OkPay","okpay-easy":"OkPay","okpaypkr-easy":"OkPay","okpaypkr-easy2":"OkPay","okpaypkr-easyqr":"OkPay","okpaypkr-ep":"OkPay","ok-jazz":"OkPay","okpaypkr-jazz":"OkPay","okpaypkr-jazz2":"OkPay","okpaypkr-jz":"OkPay","omnipay":"EPay","epay-omnipay":"EPay","epay(omnipay)":"EPay","omnipaypkr":"EPay","omnipaypkr-ep":"EPay","omnipaypkr-jz":"EPay","omnipay-ep":"EPay","omnipaypkr-easy":"EPay","omnipay-jazz":"EPay","omnipaypkr-jazz":"EPay","onepay":"OnePay","onepaypkr":"OnePay","onepay-ep":"OnePay","onepaypkr-easy":"OnePay","onepaypkr-ep":"OnePay","onepay-jz":"OnePay","onepaypkr-jazz":"OnePay","onepaypkr-jz":"OnePay","openpay":"OpenPay","openpaypkr":"OpenPay","open":"OpenPay","op3pay":"OpenPay","openpay-op3pay":"OpenPay","openpay(op3pay)":"OpenPay","open-ep":"OpenPay","openpaypkr-easy":"OpenPay","openpaypkr-easy2":"OpenPay","openpaypkr-ep":"OpenPay","open-jazz":"OpenPay","openpaypkr-jazz":"OpenPay","openpaypkr-jazz2":"OpenPay","openpaypkr-jz":"OpenPay","ospay":"OsPay","ospaypkr":"OsPay","ospaypkr-easyapp":"OsPay","ospaypkr-easyqr":"OsPay","ospaypkr-easytransfe":"OsPay","ospaypkr-easytransfer":"OsPay","ospaypkr-ep":"OsPay","ospaypkr-jazzapp":"OsPay","owenpay":"OwenPay","owenpaypkr":"OwenPay","owpay":"OwenPay","owenpay-owpay":"OwenPay","owenpay(owpay)":"OwenPay","owen-ep":"OwenPay","owenpaypkr-easy":"OwenPay","owenpaypkr-easy2":"OwenPay","owenpaypkr-ep":"OwenPay","owen-jazz":"OwenPay","owenpaypkr-jazz":"OwenPay","owenpaypkr-jazz2":"OwenPay","owenpaypkr-jz":"OwenPay","p777pay":"P777Pay","p777paypkr":"P777Pay","777pay-ep":"P777Pay","p777-ep":"P777Pay","p777paypkr-easy":"P777Pay","p777paypkr-easy2":"P777Pay","777pay-jz":"P777Pay","p777-jazz":"P777Pay","p777paypkr-jazz":"P777Pay","p777paypkr-jazz2":"P777Pay","pkpaywallet":"PKPayWallet","pkpaywalletpkr":"PKPayWallet","pkpaywalletpkr-payin":"PKPayWallet","popopay":"PopoPay","popopaypkr":"PopoPay","popopaypkr-easypaisa":"PopoPay","popopaypkr-jazzcash":"PopoPay","popopaypkr-easy":"PopoPay","popopaypkr-jazz":"PopoPay","rspay":"RsPay","rspaypkr":"RsPay","rspaypkr-easy":"RsPay","rspaypkr-ep":"RsPay","rspaypkr-jazz":"RsPay","rspaypkr-jz":"RsPay","slippay":"SlipPay","slippaypkr":"SlipPay","slip-ep":"SlipPay","slippaypkr-easy":"SlipPay","slip-jz":"SlipPay","slippaypkr-jazz":"SlipPay","starpago":"StarPago","starpagopaypkr":"StarPago","starpago-ep":"StarPago","starpagopaypkr-easy":"StarPago","starpagopaypkr-easy2":"StarPago","starpagopaypkr-ep":"StarPago","starpago-jazz":"StarPago","starpagopaypkr-jazz":"StarPago","starpagopaypkr-jazz2":"StarPago","starpagopaypkr-jz":"StarPago","unispay":"UnisPay","unispaypkr":"UnisPay","unispaypkr-easy2":"UnisPay","unispaypkr-easyqr":"UnisPay","unispaypkr-jazz2":"UnisPay","unispaypkr-jazzqr":"UnisPay","usdt-bep20":"USDT-BEP20","66wallet-bep20":"USDT-BEP20","tronpay-bep20":"USDT-BEP20","usdt(bep20)-3":"USDT-BEP20","usdt(bep20)-5":"USDT-BEP20","usdt-trc20":"USDT-TRC20","66wallet-trc20":"USDT-TRC20","tronpay-trc20":"USDT-TRC20","unipay-trc20":"USDT-TRC20","usdt (trc20)-4":"USDT-TRC20","usdt(trc20)-3":"USDT-TRC20","usdt(trc20)-4":"USDT-TRC20","usdt(trc20)-5":"USDT-TRC20","v8pay":"V8Pay","v8paypkr":"V8Pay","v8pay-ep":"V8Pay","v8paypkr-easy":"V8Pay","v8pay-jz":"V8Pay","v8paypkr-jazz":"V8Pay","ycoinpay":"YcoinPay","ycoinpaypkr":"YcoinPay","ycoinpaypkr-easy":"YcoinPay","ycoinpaypkr-jazz":"YcoinPay"}$pk_names$;
  legacy_names constant jsonb := $legacy_pk${"atpay-jz":"ATPay","atpayep":"ATPay","atpayjazz":"ATPay","atpayjz":"ATPay","atpaypkr-easy":"ATPay","atpaypkr-jazz":"ATPay","atpaypkreasy":"ATPay","atpaypkreasypaisa":"ATPay","atpaypkrjazz":"ATPay","atpaypkrjazzcash":"ATPay","atpaywallet2":"ATPay","dee-jz":"DeePay","deeep":"DeePay","deejazz":"DeePay","deejz":"DeePay","deepay-ep":"DeePay","deepayablepay":"DeePay","deepayep":"DeePay","deepayjazz":"DeePay","deepaypkreasy":"DeePay","deepaypkreasypaisa":"DeePay","deepaypkrjazz":"DeePay","deepaypkrjazzcash":"DeePay","deepaywallet2":"DeePay","epay2pkr-jazzcash":"EPay","epay2pkreasy":"EPay","epay2pkrjazz":"EPay","epay2pkrjazzcash":"EPay","epay2wallet2":"EPay","epayep":"EPay","epayjazz":"EPay","epayomnipay":"EPay","gxpayep":"P777Pay","gxpayjazz":"P777Pay","gxpaypkreasy":"P777Pay","gxpaypkrjazzcash":"P777Pay","gxppay":"P777Pay","gxppay-ep":"P777Pay","gxppay-jazz":"P777Pay","gxppayep":"P777Pay","gxppayjazz":"P777Pay","mcb-jzpay":"MCBPay","mcbep":"MCBPay","mcbjazz":"MCBPay","mcbjz":"MCBPay","mcbjzpay":"MCBPay","mega":"MegaPay","mega-jz":"MegaPay","megaep":"MegaPay","megajazz":"MegaPay","megajz":"MegaPay","newepayep":"EPay","newepayjazz":"EPay","okep":"OkPay","okjazz":"OkPay","okpayep":"OkPay","okpayjazz":"OkPay","okpaypkreasypaisa":"OkPay","okpaypkrjazz":"OkPay","okpaypkrjazzcash":"OkPay","okpaywallet2":"OkPay","okpkreasy":"OkPay","okpkrjazz":"OkPay","opay-ep":"OpenPay","opay-jazz":"OpenPay","opayep":"OpenPay","opayjazz":"OpenPay","open-jz":"OpenPay","openep":"OpenPay","openjazz":"OpenPay","openjz":"OpenPay","openpay-ep":"OpenPay","openpay-jazz":"OpenPay","openpay-jz":"OpenPay","openpayep":"OpenPay","openpayjazz":"OpenPay","openpayjz":"OpenPay","openpayop3pay":"OpenPay","openpaypkreasy":"OpenPay","openpaypkrjazz":"OpenPay","openpaypkrjazzcash":"OpenPay","openpaywallet2":"OpenPay","oppayep":"OpenPay","oppayjazz":"OpenPay","oppaypkreasy":"OpenPay","oppaypkrjazz":"OpenPay","oppaypkrjazzcash":"OpenPay","oppaywallet2":"OpenPay","owenep":"OwenPay","owenjazz":"OwenPay","owenpayowpay":"OwenPay","owenpaypkreasypaisa":"OwenPay","owenpaypkrjazzcash":"OwenPay","owenpaywallet2":"OwenPay","p777ep":"P777Pay","p777jazz":"P777Pay","p777paypkr-jazzcash":"P777Pay","p777paypkreasy":"P777Pay","p777paypkrjazz":"P777Pay","p777paypkrjazzcash":"P777Pay","pay4z":"Pay4z","pay4z-ep":"Pay4z","pay4z-jazz":"Pay4z","pay4zep":"Pay4z","pay4zjazz":"Pay4z","pk-jz":"PkPay","pkep":"PkPay","pkjazz":"PkPay","pkjz":"PkPay","pkpay-ep":"PkPay","pkpay-jz":"PkPay","pkpayep":"PkPay","pkpayjazz":"PkPay","pkpayjz":"PkPay","pkpaypkreasy":"PkPay","pkpaypkreasypaisa":"PkPay","pkpaypkrjazz":"PkPay","pkpaypkrjazzcash":"PkPay","pkpaywallet2":"PkPay","shan":"ShanPay","shan-ep":"ShanPay","shan-jazz":"ShanPay","shanep":"ShanPay","shanjazz":"ShanPay","shanpay":"ShanPay","starpago-jz":"StarPago","starpagoep":"StarPago","starpagojazz":"StarPago","starpagojz":"StarPago","starpagopkr-easy":"StarPago","starpagopkr-jazzcash":"StarPago","starpagopkreasy":"StarPago","starpagopkrjazzcash":"StarPago","unipayusdtu":"UniPayUSDT"}$legacy_pk$::jsonb;
  countries constant text := $scope_names${"IN":"印度","INDIA":"印度","印度线下":"印度","印度盘口":"印度","印度线下盘口":"印度","香港":"印度","红膏蟹":"印度","紅膏蟹":"印度","HK_TEAM":"印度","HONG_KONG":"印度","GAME66_HK":"印度","RED_CRAB":"印度","GAME66_RED_CRAB":"印度","PK":"巴基斯坦","PKR":"巴基斯坦","PAKISTAN":"巴基斯坦"}$scope_names$;
  spec record;
  fn pg_proc%rowtype;
  metadata jsonb;
  aliases text;
  pakistan text;
  replacement text;
  body text;
begin
  for spec in select * from (values
    ('private.dashboard_admin_live_provider_alias(text,text)', '47e9cab883701f04ca8e7991b7e6ad67', '864510706c200eb7d7a1dbf7e24bcf22'),
    ('private.dashboard_admin_live_confirmed_usdt_provider(text,text)', '4b43c4c4600679064a98fa381ed0ce36', '51796f8b2aa2c69e24cafcbab8abe7f3')
  ) as versions(signature, previous, installed) loop
    select * into strict fn from pg_proc where oid=spec.signature::regprocedure;
    if fn.proowner <> 'postgres'::regrole or fn.prosecdef or fn.provolatile <> 'i'
       or fn.proconfig is distinct from array['search_path=""']::text[]
       or fn.proacl::text is distinct from '{postgres=X/postgres}' then
      raise exception 'Pakistan provider function privileges or settings changed: %', spec.signature;
    end if;
    if md5(fn.prosrc)=spec.installed then continue; end if;
    if md5(fn.prosrc)<>spec.previous then
      raise exception 'Pakistan provider baseline changed: %', spec.signature;
    end if;
    metadata := to_jsonb(fn)-'prosrc';

    if fn.proname='dashboard_admin_live_provider_alias' then
      aliases := split_part(fn.prosrc, '$aliases$', 2);
      pakistan := substring(aliases from '"巴基斯坦":\{[^{}]*\}');
      if pakistan is null then raise exception 'missing Pakistan dictionary'; end if;
      replacement := replace(aliases, pakistan, '"巴基斯坦":' ||
                              ((aliases::jsonb->'巴基斯坦') || raw_map::jsonb || legacy_names)::text);
      if replacement::jsonb-'巴基斯坦' is distinct from aliases::jsonb-'巴基斯坦' then
        raise exception 'unrelated provider dictionary changed';
      end if;
      body := replace(replace(fn.prosrc, '$aliases$'||aliases||'$aliases$',
                              '$aliases$'||replacement||'$aliases$'),
                      '$countries$'||split_part(fn.prosrc, '$countries$', 2)||'$countries$',
                      '$countries$'||countries||'$countries$');
    else
      body := replace($helper_body$
 select (case coalesce($countries${"IN":"印度","INDIA":"印度","印度线下":"印度","印度盘口":"印度","印度线下盘口":"印度","香港":"印度","红膏蟹":"印度","紅膏蟹":"印度","HK_TEAM":"印度","HONG_KONG":"印度","GAME66_HK":"印度","RED_CRAB":"印度","GAME66_RED_CRAB":"印度","PK":"巴基斯坦","PKR":"巴基斯坦","PAKISTAN":"巴基斯坦"}$countries$::jsonb->>upper(btrim(p_country)),p_country)
   when '印度' then $confirmed${"usdt(trc20)-3":"TronPayUSDT","usdt(trc20)-4":"UniPayUSDT","usdt(trc20)-5":"Wallet66","usdt(bep20)-5":"Wallet66","wallet66-usdt":"Wallet66","wallet66":"Wallet66","wallet66-bsc":"Wallet66","rushpay":"RushPay","rushpay-bank":"RushPay","basepay-qr":"FFPay","ffpay":"FFPay","atpay-qr":"ATPay","wypay":"WYPay","wypay-qr":"WYPay","wypayinr-paytmqr":"WYPay","wypayinr-bank":"WYPay","moneypay":"MoneyPay","moneypay-qr":"MoneyPay","rapay2inr":"RAPay","rapay":"RAPay"}$confirmed$::jsonb
   when '巴基斯坦' then $pakistan$@pakistan_channels@$pakistan$::jsonb
 end)->>regexp_replace(lower(btrim(regexp_replace(btrim(p_raw),$suffix$(?:\s*[-_‐‑‒–—﹘﹣－]?\s*(?:跑分|唤醒)|\s*[-_‐‑‒–—﹘﹣－]?\s*[（(【\[]\s*(?:跑分|唤醒)\s*[）)】\]])+$$suffix$,''))),'[[:space:]]*[-‐‑‒–—﹘﹣－][[:space:]]*','-','g');
$helper_body$, '@pakistan_channels@', raw_map);
    end if;
    if md5(body)<>spec.installed then raise exception 'unexpected Pakistan provider result'; end if;
    execute replace(pg_get_functiondef(fn.oid), '$function$'||fn.prosrc||'$function$',
                    '$function$'||body||'$function$');
    select * into strict fn from pg_proc where oid=spec.signature::regprocedure;
    if md5(fn.prosrc)<>spec.installed or (to_jsonb(fn)-'prosrc') is distinct from metadata then
      raise exception 'Pakistan provider installation mismatch: %', spec.signature;
    end if;
  end loop;
end;
$install$;
commit;
