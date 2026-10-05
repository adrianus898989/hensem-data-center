// Synthetic source identities only; no production data or credentials.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const patch=read('supabase/migrations/20261005110752_india_wypay_inr_channel_aliases.sql');
const id='10000000-0000-0000-0000-000000000001',newid='10000000-0000-0000-0000-000000000003';
const aliases=['WYPayINR-PaytmQR','WYPayINR-Bank'];
let db,metadata,original;
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const canon=(country,platform,raw)=>scalar('select private.dashboard_admin_live_provider_canonical($1,$2,$3)',[country,platform,raw]);
const meta=()=>scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') from pg_proc p where pronamespace='private'::regnamespace and proname in ('dashboard_admin_live_provider_alias','dashboard_admin_live_confirmed_usdt_provider')");
const snapshot=()=>scalar("select jsonb_build_object('registry',(select jsonb_agg(to_jsonb(r) order by country,platform,raw_provider) from private.dashboard_admin_provider_registry r),'records',(select jsonb_agg(to_jsonb(r) order by platform,provider) from public.newar_detail_records r))");
before(async()=>{
 const file=path.join(__dirname,'india-wypay-qr-alias.test.cjs'),req=createRequire(file);let boot;
 const context={require:n=>n==='node:test'?{test(){},before:fn=>boot=fn,after(){}}:req(n),__dirname,console};vm.createContext(context);
 vm.runInContext(fs.readFileSync(file,'utf8')+'\nglobalThis.fixture={get db(){return db}};',context,{filename:file});await boot();db=context.fixture.db;
 for(const raw of aliases){
  await db.query("insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values) values ('印度','SYNTHETIC',$1,array['StaleAuto']),('印尼','SYNTHETIC',$1,array['OtherCountry']),('印度','HIDDEN',$1,array['HiddenAlias'])",[raw]);
  await db.query("insert into public.newar_detail_records values ('DhaniWin','charge',$1,'QR','failed','2026-10-03T01:00Z',null)",[raw]);
 }
 metadata=await meta();original=await snapshot();await db.exec(patch);
});
after(()=>db?.close());
test('the exact confirmed INR labels unify across TypeScript browser and SQL without merging WPay or foreign names',async()=>{
 const names=require('./load-typescript.cjs').loadTs(path.join(root,'src/lib/thirdPartyNameMap.ts')),browser={};browser.window=browser;vm.runInNewContext(read('admin-preview/live-provider-aliases.js'),browser);
 for(const country of ['印度','IN','India','香港','红膏蟹'])for(const raw of ['WYPay','WYPay-QR',...aliases])for(const label of [raw,' '+raw.toLowerCase()+' ',raw.replace('-',' — '),raw+' (唤醒)']){
  assert.equal(names.canonicalThirdPartyName(label,country),'WYPay');assert.equal(browser.HensemProviderNames.canonical(label,country),'WYPay');assert.equal(await scalar('select private.dashboard_admin_live_provider_alias($1,$2)',[country,label]),'WYPay');
 }
 for(const country of ['印尼','巴西','PK','IN-other',''])for(const raw of aliases){assert.equal(names.confirmedIndiaThirdPartyAlias(raw,country),'');assert.equal(browser.HensemProviderNames.canonical(raw,country),raw);assert.equal(await scalar('select private.dashboard_admin_live_provider_alias($1,$2)',[country,raw]),raw);}
 for(const raw of ['WYPayINR_Bank','WYPayINR-Bank2','WYPayINR-PaytmQR-extra','WYPayUSDT-Bank','WPayINR-Bank','WPayINR-PaytmQR','WPay','WPayINR']){
  assert.notEqual(names.canonicalThirdPartyName(raw,'印度'),'WYPay');assert.notEqual(browser.HensemProviderNames.canonical(raw,'印度'),'WYPay');assert.notEqual(await scalar('select private.dashboard_admin_live_provider_alias($1,$2)',['印度',raw]),'WYPay');
 }
 assert.equal(names.confirmedIndiaThirdPartyAlias('WYPayINR','印度'),'');assert.equal(browser.HensemProviderNames.canonical('WYPayINR','印度'),'WYPayINR');assert.equal(await scalar('select private.dashboard_admin_live_provider_alias($1,$2)',['印度','WYPayINR']),'WYPayINR');
 for(const raw of aliases){assert.equal(await canon('印度','SYNTHETIC',raw),'WYPay');assert.equal(await canon('印尼','SYNTHETIC',raw),'OtherCountry');}
});
test('AR and NEWAR WYPay selection reaches all four channels and still enforces platform scope',async()=>{
 const expand=q=>scalar('select private.dashboard_admin_live_expand_provider_filter($1::jsonb)',[JSON.stringify(q)]),base={platformId:id,providers:['WYPay'],direction:'charge',action:'aggregate',status:'all',startAt:'2026-10-02T18:30:00Z',endAt:'2026-10-03T18:30:00Z'};
 for(const platformId of [id,newid])assert.deepEqual((await expand({...base,platformId})).providers,['WYPay','WYPay-QR','WYPayINR-Bank','WYPayINR-PaytmQR']);
 const hidden={...base,platformId:'10000000-0000-0000-0000-000000000002'};assert.deepEqual(await expand(hidden),hidden);
 await db.query("select set_config('test.denied','yes',false)");try{await assert.rejects(expand(base),/preview_denied/);}finally{await db.query("select set_config('test.denied','no',false)");}
 assert.deepEqual(await snapshot(),original);
});
test('workorder batch and scalar use the same labels and preserve explicit manual assignments',async()=>{
 for(const raw of aliases){
  const args=['印度','SYNTHETIC',raw,'QR'],batch=()=>scalar('select provider from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)',[JSON.stringify([{country:args[0],platform:args[1],raw_provider:args[2],channel_type:args[3]}])]);
  assert.equal(await scalar('select private.dashboard_admin_live_workorder_provider($1,$2,$3,$4)',args),'WYPay');assert.equal(await batch(),'WYPay');
  await db.query("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values ('印度','SYNTHETIC',$1,'ManualReviewed')",[raw]);
  try{assert.equal(await canon(...args.slice(0,3)),'ManualReviewed');assert.equal(await batch(),'ManualReviewed');await db.exec(patch);assert.equal(await canon(...args.slice(0,3)),'ManualReviewed');}finally{await db.query("delete from private.dashboard_admin_provider_overrides where country='印度' and platform='SYNTHETIC' and raw_provider=$1",[raw]);}
 }
});
test('provider merge sums underlying amounts and counts once without crossing currency direction or fee history',async()=>{
 const row={provider:'WYPay',currency:'INR',direction:'charge',date:'2026-10-04',all_amount:'100',all_count:2,success_amount:'80',success_count:1,pending_amount:'20',pending_count:1};
 const input=[row,...aliases.map(provider=>({...row,provider})),{...row,provider:aliases[0],direction:'withdraw'},{...row,provider:aliases[1],currency:'USDT'}],result=await scalar('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true)',[JSON.stringify(input),'印度','SYNTHETIC']);
 assert.equal(result.length,3);assert.equal(result.reduce((s,r)=>s+Number(r.all_amount),0),500);assert.equal(result.reduce((s,r)=>s+r.all_count,0),10);assert(result.every(r=>r.provider==='WYPay'));
 const charge=result.find(r=>r.direction==='charge'&&r.currency==='INR');assert.equal(charge.all_count,6);assert.equal(charge.success_count,3);assert.equal(Number(charge.success_amount),240);
 const browser={};browser.window=browser;for(const f of ['live-provider-aliases.js','live-provider-summary.js'])vm.runInNewContext(read('admin-preview/'+f),browser);
 const rates=[{provider:'WYPay',country:'印度',scopeType:'country',collectFee:'4%',sourceType:'跑分',sourceTypeProvider:'WYPay'}];
 for(const provider of aliases){assert.deepEqual(Array.from(browser.HensemProviderSummary.feeCandidates({...row,provider},rates,'印度'),r=>r.provider),['WYPay']);assert.equal(browser.HensemProviderSummary.estimate({...row,provider},rates,'印度'),null);assert.equal(browser.HensemProviderSummary.estimate({...row,provider,success_count:2,fee_version_state:'partial',fee_version_estimated_amount:1.25,fee_version_matched_count:1,fee_version_unmatched_count:1},rates,'印度'),1.25);}
});
test('idempotent dictionary migration preserves OID metadata ACL and source records, refusing baseline drift',async()=>{
 assert.deepEqual(await meta(),metadata);await db.exec(patch);assert.deepEqual(await meta(),metadata);assert.deepEqual(await snapshot(),original);
 for(const role of ['anon','authenticated','service_role'])for(const name of ['dashboard_admin_live_provider_alias','dashboard_admin_live_confirmed_usdt_provider'])assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,'private.'+name+'(text,text)']),false);
 const ddl=patch.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 for(const change of ["grant execute on function private.dashboard_admin_live_provider_alias(text,text) to anon","alter function private.dashboard_admin_live_provider_alias(text,text) reset all","create or replace function private.dashboard_admin_live_provider_alias(p_country text,p_name text) returns text language sql immutable set search_path='' as $$select p_name$$"]){await db.exec('begin;'+change);try{await assert.rejects(db.exec(ddl),/wypay_inr_alias_(?:metadata_or_acl|baseline)_drift/);}finally{await db.exec('rollback');}}
 await db.exec(read('supabase/admin-live-provider-aliases.sql'));for(const raw of aliases){assert.equal(await canon('印度','SYNTHETIC',raw),'WYPay');assert.equal(await canon('印尼','SYNTHETIC',raw),'OtherCountry');}
 assert.doesNotMatch(patch,/\b(?:insert\s+into|update\s+(?:public|private)\.|delete\s+from|drop\s+|grant\s+)\b/i);
});
test('existing workorder daily and detail readers canonicalize before deduplicating one original across WYPay channels',async()=>{
 const file=path.join(__dirname,'admin-newar-workorder-detail-cohorts.test.cjs'),req=createRequire(file);let boot;
 const context={require:n=>n==='node:test'?{test(){},before:fn=>boot=fn,after(){},beforeEach(){},afterEach(){}}:req(n),__dirname,console};vm.createContext(context);
 vm.runInContext(fs.readFileSync(file,'utf8')+'\nglobalThis.fixture={get db(){return db},call,ticket};',context,{filename:file});await boot();const api=context.fixture,reader=api.db;
 try{
  for(const [index,provider] of ['WYPay',...aliases].entries())await api.ticket('SAME-'+index,'ONE-ORIGINAL',{provider,status:index===1?'4':'3'});
  await api.ticket('SECOND','SECOND-ORIGINAL',{provider:aliases[1],status:'3'});
  await reader.exec(`insert into ar_workorder_issue_details values
    ('AR','IN','印度','Alpha','A','A','ONE-ORIGINAL',null,100,'deposit','WYPay','QR',3,'2026-10-03',false),
    ('AR','IN','印度','Alpha','B','B','ONE-ORIGINAL',null,100,'deposit','WYPayINR-PaytmQR','QR',4,'2026-10-03',false),
    ('AR','IN','印度','Alpha','C','C','ONE-ORIGINAL',null,100,'deposit','WYPayINR-Bank','BANK',3,'2026-10-03',false),
    ('AR','IN','印度','Alpha','D','D','SECOND-ORIGINAL',null,100,'deposit','WYPayINR-Bank','BANK',3,'2026-10-03',false);
   insert into workorder_deposit_daily select submitted_date,country_code,country,platform,third_party,channel_type,'AR_WORKORDER',count(*),sum(amount),count(*) filter(where status_code=4),coalesce(sum(amount) filter(where status_code=4),0),0,0,0,0,'2026-10-04T06:00Z','2026-10-04T06:01Z',jsonb_build_object('存款/已处理',count(*) filter(where status_code=4),'存款/已驳回',count(*) filter(where status_code<>4)) from ar_workorder_issue_details group by 1,2,3,4,5,6;`);
  const raw=async()=>(await reader.query("select jsonb_build_object('details',(select jsonb_agg(to_jsonb(r)) from newar_detail_records r),'daily',(select jsonb_agg(to_jsonb(r)) from workorder_deposit_daily r)) data")).rows[0].data,before=await raw();
  assert((await api.call()).byPlatformProvider.length>1);
  await reader.exec(read('supabase/admin-live-provider-aliases.sql'));
  for(const signature of ['private.dashboard_admin_wg_provider_aliases()','private.dashboard_admin_live_confirmed_provider(text,text,text)','private.dashboard_admin_live_provider_alias_values(text,text[])','private.dashboard_admin_live_provider_canonical(text,text,text)','private.dashboard_admin_live_workorder_provider(text,text,text,text)','private.dashboard_admin_live_workorder_provider_batch(jsonb)'])await reader.exec(await scalar('select pg_get_functiondef($1::regprocedure)',[signature]));
  for(const platforms of [['DHANIWIN','DhaniWin'],['Alpha']]){
   const result=await api.call({platforms,providers:['WYPay']});assert.equal(result.byPlatformProvider.length,1);const row=result.byPlatformProvider[0];
   assert.equal(row.provider,'WYPay');assert.equal(row.submittedCount,4);assert.equal(row.uniqueOrderCount,2,JSON.stringify({platforms,row}));assert.equal(row.uniqueSuccessCount,1);assert.equal(row.uniqueCoverage.providerConflictCount,0);
  }
  assert.deepEqual(await raw(),before);
 }finally{await reader.close();}
});
