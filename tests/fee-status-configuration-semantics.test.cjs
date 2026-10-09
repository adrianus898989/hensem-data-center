// Offline synthetic fixtures; no production orders, identity data or network.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
require('../admin-preview/live-provider-aliases.js');require('../admin-preview/live-report-data.js');
const {currentReferenceFeeFacts:facts}=require('../admin-preview/live-provider-summary.js');
let db,beforeMeta,beforeRows;
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const rpc=async request=>scalar('select private.dashboard_admin_live_rates($1)',[request||{limit:500}]);
const canonical=(country,platform,name)=>scalar('select private.dashboard_admin_live_provider_canonical($1,$2,$3)',[country,platform,name]);
const leaf=(extra={})=>({platformId:'kb-synthetic',platform:'YASH.BET',source:'kb',country:'印度',provider:'BussPay',direction:'charge',currency:'INR',channel_type:'BussPay-QR',success_count:10,success_amount:1000,...extra});
const countryFee=(id,provider,extra={})=>({id,country:'印度',third_party:provider,category:'UPI',collect_fee:'4%',payout_fee:'3%',payout_single_fee:'6',sheet_name:'印度线下',source_row:14,...extra});
const addFee=r=>db.query('insert into public.third_party_rates select (jsonb_populate_record(null::public.third_party_rates,$1::jsonb)).*',[JSON.stringify(r)]);
const metadata=()=>scalar("select jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid) from pg_proc p where p.oid in ('private.dashboard_admin_live_rates(jsonb)'::regprocedure,'private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure)");
before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema private;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.scope',true),''),'{}')::jsonb$$;
 create function private.dashboard_data_group(text,text) returns text language sql immutable as $$select case $1 when '印度' then 'IN' else $1 end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'denied','false')<>'true'$$;
 create table public.third_party_rates(id text primary key,country text,third_party text,category text,
  collect_fee text,payout_fee text,total_fee text,collect_single_fee text,payout_single_fee text,
  collect_limit text,payout_limit text,status text,sheet_name text,source_row integer,updated_at timestamptz);
 create table public.third_party_platform_status(id text primary key,country text,platform text,third_party text,
  category text,collect_fee text,payout_fee text,total_fee text,collect_single_fee text,payout_single_fee text,
  collect_limit text,payout_limit text,status text,raw_status text,sheet_name text,source_row integer,
  source_column integer,updated_at timestamptz);
 create table private.fee_rate_current_evidence(source_id text,direction text,state text,effective_from timestamptz,version_id uuid,provenance jsonb);
 create function private.dashboard_admin_rate_type_sources(text,integer[]) returns table(source_row integer,source_type text,source_type_provider text,source_type_cell text,source_type_header text,source_type_sheet_id bigint,source_type_collected_at timestamptz) language sql stable as $$select unnest($2),null::text,null::text,null::text,null::text,null::bigint,null::timestamptz$$;
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values jsonb);
 create function private.dashboard_admin_wg_provider_aliases() returns table(country_code text,country text,platform text,raw_provider text,canonical_provider text) language sql stable as $$select null::text,null::text,null::text,null::text,null::text where false$$;
 create function private.dashboard_admin_live_provider_alias(text,text) returns text language sql immutable as $$select $2$$;
 create function private.dashboard_admin_live_confirmed_provider(text,text,text) returns text language sql immutable as $$select null::text$$;
 create function private.dashboard_admin_live_provider_alias_values(text,jsonb) returns text[] language sql immutable as $$select array[]::text[]$$;
 `);
 await db.exec(read('tests/fixtures/fee-status-configuration-baseline.sql'));
 await db.exec('revoke all on function private.dashboard_admin_live_rates(jsonb),private.dashboard_admin_live_provider_canonical(text,text,text) from public,anon,authenticated,service_role;grant execute on function private.dashboard_admin_live_rates(jsonb) to authenticated;');
 await addFee(countryFee('buss','BussPay'));
 await addFee(countryFee('arb','ArbPay',{collect_fee:'1.50%',payout_fee:'0.00%',payout_single_fee:'',source_row:3}));
 await addFee(countryFee('win','NewWinPay',{source_row:10}));
 await db.exec("insert into public.third_party_platform_status(id,country,platform,third_party,collect_fee,payout_fee,collect_single_fee,payout_single_fee,raw_status,sheet_name,source_row,source_column) values('buss-status','印度','YASHBET','BussPay','','','','','开启 🟢','印度线下',14,56)");
 beforeMeta=await metadata();beforeRows=await scalar('select jsonb_agg(to_jsonb(r) order by id) from public.third_party_rates r');
 await db.exec(read('supabase/migrations/20261009112608_fee_status_configuration_semantics.sql'));
});
after(()=>db?.close());
test('reader marks source connection matrix explicitly and prices country rate without turning statuses into contracts',async()=>{
 const rows=(await rpc()).rows,status=rows.find(r=>r.scopeType==='platform'),rate=rows.find(r=>r.sourceId==='buss');
 assert.equal(status.configurationRole,'connection_status');assert.equal(rate.configurationRole,'rate');
 assert.equal(status.collectFee,'');assert.equal(status.rawStatus,'开启 🟢');
 assert.equal(facts(leaf(),rows,'印度').amount,40);
 assert.deepEqual(await metadata(),beforeMeta,'permissions, security definer, owner and function metadata unchanged');
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(r) order by id) from public.third_party_rates r'),beforeRows,'source prices untouched');
});
test('current source marker prices 3% plus 6 INR while historical evidence is left absent',async()=>{
 const rows=(await rpc()).rows,rate=rows.find(r=>r.sourceId==='buss'),proof=rate.currentFeeCurrencyEvidence.withdraw;
 assert.equal(proof.currency,'INR');assert.equal(proof.fixedFee,6);assert.equal(proof.basis,'owner_confirmation');assert.equal(proof.sourceId,'buss');
 assert.equal(proof.sourceSheet,'印度线下');assert.equal(proof.confirmedAt,'2026-10-09');assert.equal(proof.currencyCell,undefined);assert.deepEqual(rate.feeEffective,{});
 const out=facts(leaf({direction:'withdraw'}),rows,'印度');assert.equal(out.amount,90);assert.equal(out.complete,true);
 const zero=facts(leaf({provider:'ArbPay',direction:'withdraw'}),rows,'印度');assert.equal(zero.amount,0);assert.equal(zero.complete,true);
 assert.equal(facts(leaf({direction:'withdraw',currency:'USDT'}),rows,'印度').amount,null);
});
test('monetary confirmation is limited to exact India country source, selected providers and source fixed value 6',async()=>{
 await db.exec('begin');try{
 const rows=[
 countryFee('foreign-country','BussPay',{country:'巴西'}),countryFee('foreign-sheet','BussPay',{sheet_name:'USDT'}),
 countryFee('unknown-provider','OtherPay'),countryFee('changed-fixed','RushPay',{payout_single_fee:'7'}),
 countryFee('blank-fixed','CedarPay',{payout_single_fee:''}),countryFee('zero-fixed','MovPay',{payout_single_fee:'0'}),
 countryFee('formatted-fixed','WPay',{payout_single_fee:'6.00 / 笔'})];
 for(const row of rows)await addFee(row);
 const actual=(await rpc()).rows;for(const r of rows.slice(0,-1))assert.deepEqual(actual.find(a=>a.sourceId===r.id).currentFeeCurrencyEvidence,{},r.id);
 assert.equal(actual.find(a=>a.sourceId==='formatted-fixed').currentFeeCurrencyEvidence.withdraw.currency,'INR');
 assert.deepEqual(actual.find(a=>a.scopeType==='platform').currentFeeCurrencyEvidence,{});
 }finally{await db.exec('rollback');}
});
test('WinPay is canonicalized only for exact YASH India source and all other identities remain unchanged',async()=>{
 for(const country of ['印度','IN'])for(const platform of ['YASH.BET','YASHBET'])assert.equal(await canonical(country,platform,'WinPay'),'NewWinPay');
 for(const args of [['印度','OTHER','WinPay'],['马来','YASH.BET','WinPay'],['USDT','YASHBET','WinPay'],['印度','YASH.BET','WinPay2'],['印度','YASH.BET','NewWinPay']])assert.equal(await canonical(...args),args[2]);
 const provider=await canonical('印度','YASH.BET','WinPay'),out=facts(leaf({provider,channel_type:'NewWin-QR'}),(await rpc()).rows,'印度');assert.equal(out.amount,40);
});
test('reader honors scope exclusion, exact filter and row pagination after semantic metadata addition',async()=>{
 await db.query("select set_config('test.scope','{\"denied\":true}',false)");try{const denied=await rpc();assert.equal(denied.total,0);assert.deepEqual(denied.rows,[]);}finally{await db.query("select set_config('test.scope','{}',false)");}
 const one=await rpc({scopeType:'country',country:'IN',provider:'BussPay'});assert.equal(one.total,1);assert.equal(one.rows[0].sourceId,'buss');
 assert.deepEqual((await rpc({offset:20,limit:20})).rows,[]);
});
test('an explicit YASH operator mapping takes precedence over the confirmed NewWinPay default',async()=>{
 await db.exec('begin');try{
  await db.exec("insert into private.dashboard_admin_provider_overrides values('印度','YASH.BET','WinPay','ExplicitContractPay')");
  assert.equal(await canonical('印度','YASH.BET','WinPay'),'ExplicitContractPay');
  assert.equal(await canonical('印度','YASHBET','WinPay'),'NewWinPay','a different exact platform has no borrowed override');
  await db.exec("update private.dashboard_admin_provider_overrides set canonical_provider=null");
  assert.equal(await canonical('印度','YASH.BET','WinPay'),'NewWinPay','cleared override restores confirmed source default');
 }finally{await db.exec('rollback');}
});
