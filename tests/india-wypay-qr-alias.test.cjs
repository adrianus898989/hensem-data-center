// Synthetic source identities only. Preserve original records and fee facts.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const patch=read('supabase/migrations/20261004113115_india_wypay_qr_provider_alias.sql');
const id='10000000-0000-0000-0000-000000000001',newid='10000000-0000-0000-0000-000000000003';
let db,metadata,original;
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const canon=(country,platform,raw)=>scalar('select private.dashboard_admin_live_provider_canonical($1,$2,$3)',[country,platform,raw]);
const meta=()=>scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') from pg_proc p where pronamespace='private'::regnamespace and proname in ('dashboard_admin_live_provider_alias','dashboard_admin_live_confirmed_usdt_provider')");
const snapshot=()=>scalar('select jsonb_agg(to_jsonb(r) order by country,platform,raw_provider) from private.dashboard_admin_provider_registry r');
before(async()=>{
 const file=path.join(__dirname,'india-atpay-qr-alias.test.cjs'),req=createRequire(file);let boot;
 const context={require:n=>n==='node:test'?{test(){},before:fn=>boot=fn,after(){}}:req(n),__dirname,console};vm.createContext(context);
 vm.runInContext(fs.readFileSync(file,'utf8')+'\nglobalThis.fixture={get db(){return db}};',context,{filename:file});await boot();db=context.fixture.db;
 await db.exec("insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values) values ('印度','SYNTHETIC','WYPay',array['WYPay']),('印度','SYNTHETIC','WYPay-QR',array['StaleQR']),('印尼','SYNTHETIC','WYPay-QR',array['OtherCountry']); insert into public.newar_detail_records values ('DhaniWin','charge','WYPay-QR','QR','failed','2026-10-03T01:00Z',null)");
 metadata=await meta();original=await snapshot();await db.exec(patch);
});
after(()=>db?.close());
test('only the confirmed India pair merges in browser TypeScript and SQL',async()=>{
 const names=require('./load-typescript.cjs').loadTs(path.join(root,'src/lib/thirdPartyNameMap.ts')),browser={};browser.window=browser;vm.runInNewContext(read('admin-preview/live-provider-aliases.js'),browser);
 for(const country of ['印度','IN','India','香港','红膏蟹'])for(const raw of ['WYPay','WYPay-QR',' wypay-qr ','WYPay — QR','WYPay-QR (唤醒)']){
  assert.equal(names.canonicalThirdPartyName(raw,country),'WYPay');assert.equal(browser.HensemProviderNames.canonical(raw,country),'WYPay');assert.equal(await scalar('select private.dashboard_admin_live_provider_alias($1,$2)',[country,raw]),'WYPay');
 }
 for(const country of ['印尼','巴西','PK','IN-other',''])for(const raw of ['WYPay-QR','WYPay-QR2','Unknown-QR']){
  assert.equal(names.confirmedIndiaThirdPartyAlias(raw,country),'');assert.equal(browser.HensemProviderNames.canonical(raw,country),raw);assert.equal(await scalar('select private.dashboard_admin_live_provider_alias($1,$2)',[country,raw]),raw);
 }
 for(const raw of ['WYPayQR','WYPay_QR','WYPay-QR2','WYPay-QR-extra','Other-QR'])assert.equal(names.confirmedIndiaThirdPartyAlias(raw,'印度'),'');
 assert.equal(await canon('印度','SYNTHETIC','WYPay-QR'),'WYPay');assert.equal(await canon('印尼','SYNTHETIC','WYPay-QR'),'OtherCountry');
});
test('AR and NEWAR provider selection reaches both exact channels without rewriting records',async()=>{
 const query={platformId:id,providers:['WYPay'],direction:'charge',action:'aggregate',status:'all',startAt:'2026-10-02T18:30:00Z',endAt:'2026-10-03T18:30:00Z'},expand=q=>scalar('select private.dashboard_admin_live_expand_provider_filter($1::jsonb)',[JSON.stringify(q)]);
 assert.deepEqual((await expand(query)).providers,['WYPay','WYPay-QR']);assert.deepEqual((await expand({...query,platformId:newid})).providers,['WYPay','WYPay-QR']);assert.deepEqual(await snapshot(),original);
 await db.query("select set_config('test.denied','yes',false)");try{await assert.rejects(expand(query),/preview_denied/);}finally{await db.query("select set_config('test.denied','no',false)");}
});
test('workorder resolution respects existing manual assignments and raw source labels',async()=>{
 const args=['印度','SYNTHETIC','WYPay-QR','QR'],batch=()=>scalar('select provider from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)',[JSON.stringify([{country:args[0],platform:args[1],raw_provider:args[2],channel_type:args[3]}])]);
 assert.equal(await scalar('select private.dashboard_admin_live_workorder_provider($1,$2,$3,$4)',args),'WYPay');assert.equal(await batch(),'WYPay');
 await db.exec("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values ('印度','SYNTHETIC','WYPay-QR','ManualReviewed')");
 try{assert.equal(await canon(...args.slice(0,3)),'ManualReviewed');assert.equal(await batch(),'ManualReviewed');await db.exec(patch);assert.equal(await canon(...args.slice(0,3)),'ManualReviewed');}finally{await db.exec("delete from private.dashboard_admin_provider_overrides where country='印度' and platform='SYNTHETIC' and raw_provider='WYPay-QR'");}
});
test('merged display groups conserve directions currencies amounts counts and historical fees',async()=>{
 const row={provider:'WYPay',currency:'INR',direction:'charge',date:'2026-10-03',all_amount:'100',all_count:2,success_amount:'80',success_count:1,pending_amount:'20',pending_count:1};
 const input=[row,{...row,provider:'WYPay-QR'},{...row,provider:'WYPay-QR',direction:'withdraw'},{...row,provider:'WYPay-QR',currency:'USDT'}],result=await scalar('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true)',[JSON.stringify(input),'印度','SYNTHETIC']);
 assert.equal(result.length,3);assert.equal(result.reduce((s,r)=>s+Number(r.all_amount),0),400);assert.equal(result.reduce((s,r)=>s+r.all_count,0),8);assert(result.every(r=>r.provider==='WYPay'));
 const browser={};browser.window=browser;for(const f of ['live-provider-aliases.js','live-provider-summary.js'])vm.runInNewContext(read('admin-preview/'+f),browser);
 const rates=[{provider:'WYPay',country:'印度',scopeType:'country',collectFee:'4%',sourceType:'跑分',sourceTypeProvider:'WYPay'}];assert.deepEqual(Array.from(browser.HensemProviderSummary.feeCandidates({...row,provider:'WYPay-QR'},rates,'印度'),r=>r.provider),['WYPay']);
 assert.equal(browser.HensemProviderSummary.estimate({...row,provider:'WYPay-QR'},rates,'印度'),null);assert.equal(browser.HensemProviderSummary.estimate({...row,provider:'WYPay-QR',success_count:2,fee_version_state:'partial',fee_version_estimated_amount:1.25,fee_version_matched_count:1,fee_version_unmatched_count:1},rates,'印度'),1.25);
});
test('patch is idempotent private and refuses unrelated dictionary or permission drift',async()=>{
 assert.deepEqual(await meta(),metadata);await db.exec(patch);assert.deepEqual(await meta(),metadata);assert.deepEqual(await snapshot(),original);
 for(const role of ['anon','authenticated','service_role'])for(const name of ['dashboard_admin_live_provider_alias','dashboard_admin_live_confirmed_usdt_provider'])assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,'private.'+name+'(text,text)']),false);
 const ddl=patch.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 for(const change of ["grant execute on function private.dashboard_admin_live_provider_alias(text,text) to anon","alter function private.dashboard_admin_live_provider_alias(text,text) reset all","create or replace function private.dashboard_admin_live_provider_alias(p_country text,p_name text) returns text language sql immutable set search_path='' as $$select p_name$$"]){await db.exec('begin;'+change);try{await assert.rejects(db.exec(ddl),/wypay_alias_(?:metadata_or_acl|baseline)_drift/);}finally{await db.exec('rollback');}}
 await db.exec(read('supabase/admin-live-provider-aliases.sql'));assert.equal(await canon('印度','SYNTHETIC','WYPay-QR'),'WYPay');assert.equal(await canon('印尼','SYNTHETIC','WYPay-QR'),'OtherCountry');assert.doesNotMatch(patch,/\b(?:insert\s+into|update\s+(?:public|private)\.|delete\s+from|drop\s+|grant\s+)\b/i);
});
