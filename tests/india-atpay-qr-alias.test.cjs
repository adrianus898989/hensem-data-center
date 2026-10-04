// Synthetic alias/filter/workorder fixtures; no production data or credentials.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const patch=read('supabase/migrations/20261004091542_india_atpay_qr_provider_alias.sql');
const id='10000000-0000-0000-0000-000000000001',newid='10000000-0000-0000-0000-000000000003';
let db,metadata,sourceBefore;
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const canon=(country,platform,raw)=>scalar('select private.dashboard_admin_live_provider_canonical($1,$2,$3)',[country,platform,raw]);
const meta=()=>scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') from pg_proc p where pronamespace='private'::regnamespace and proname in ('dashboard_admin_live_provider_alias','dashboard_admin_live_confirmed_usdt_provider')");
const snapshot=()=>scalar('select jsonb_agg(to_jsonb(r) order by country,platform,raw_provider) from private.dashboard_admin_provider_registry r');
before(async()=>{
 // Reuse the complete configuration/grouping harness and actual SQL callers.
 const file=path.join(__dirname,'admin-confirmed-provider-aliases.test.cjs'),req=createRequire(file);let boot;
 const ctx={require:n=>n==='node:test'?{test(){},before:fn=>boot=fn,after(){}}:req(n),__dirname,console};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(file,'utf8')+'\nglobalThis.fixture={get db(){return db}};',ctx,{filename:file});await boot();db=ctx.fixture.db;
 await db.exec(`create role service_role;
 create function private.dashboard_admin_wg_provider_aliases() returns table(country_code text,country text,platform text,raw_provider text,canonical_provider text) language sql stable as $$select null::text,null::text,null::text,null::text,null::text where false$$;
 create or replace function private.dashboard_admin_live_platforms() returns table(id uuid,country text,name text,source_name text,source text,scope_group text) language plpgsql stable as $$begin perform private.dashboard_admin_live_scope();return query values ('${id}'::uuid,'印度','SYNTHETIC','SYNTHETIC','ar','IN'),('${newid}'::uuid,'印度','DHANIWIN','DhaniWin','newar','IN');end$$;
 create table public.newar_detail_platforms(platform text primary key,launch_at timestamptz);
 insert into public.newar_detail_platforms values ('DhaniWin',null);
 create table public.newar_detail_records(platform text,dataset text,provider text,channel_type text,status_group text,created_at timestamptz,success_at timestamptz);
 insert into public.newar_detail_records values ('DhaniWin','charge','ATPay-QR','ATPayINR','failed','2026-10-03T01:00Z',null),('DhaniWin','charge','Unconfirmed-QR','QR','failed','2026-10-03T01:00Z',null);
 insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values) values ('印度','SYNTHETIC','ATPay-QR',array['StaleAuto']),('印度','SYNTHETIC','LegacyATP',array['ATPay-QR']),('印度','DHANIWIN','ATPay',array['ATPay']),('印尼','SYNTHETIC','ATPay-QR',array['OtherCountry']);`);
 await db.exec(read('tests/fixtures/atpay-provider-alias-baseline.sql')+read('tests/fixtures/atpay-provider-alias-callers.sql'));
 await db.exec(read('tests/fixtures/newar-provider-filter-baseline.sql')+';revoke all on function private.dashboard_admin_live_expand_provider_filter(jsonb) from public,anon,service_role;grant execute on function private.dashboard_admin_live_expand_provider_filter(jsonb) to authenticated;');
 await db.exec(read('supabase/migrations/20261004084826_newar_native_provider_filter.sql'));
 assert.equal(await canon('印度','SYNTHETIC','ATPay-QR'),'StaleAuto');
 metadata=await meta();sourceBefore=await snapshot();await db.exec(patch);
});
after(()=>db?.close());
test('only the owner-confirmed full India alias agrees across TypeScript browser and installed SQL',async()=>{
 const names=require('./load-typescript.cjs').loadTs(path.join(root,'src/lib/thirdPartyNameMap.ts')),browser={};browser.window=browser;
 vm.runInNewContext(read('admin-preview/live-provider-aliases.js'),browser);
 for(const country of ['印度','IN','India','香港','红膏蟹'])for(const raw of ['ATPay-QR',' atpay-qr ','ATPay — QR','ATPay-QR (唤醒)']){
  assert.equal(names.canonicalThirdPartyName(raw,country),'ATPay');assert.equal(browser.HensemProviderNames.canonical(raw,country),'ATPay');
  assert.equal(await scalar('select private.dashboard_admin_live_provider_alias($1,$2)',[country,raw]),'ATPay');
 }
 for(const country of ['印尼','巴西','PK','IN-other',''])for(const raw of ['ATPay-QR','ATPay-QR2','Unknown-QR']){
  assert.equal(names.confirmedIndiaThirdPartyAlias(raw,country),'');assert.equal(browser.HensemProviderNames.canonical(raw,country),raw);assert.equal(await scalar('select private.dashboard_admin_live_provider_alias($1,$2)',[country,raw]),raw);
 }
 for(const raw of ['ATPayQR','ATPay_QR','ATPay-QR2','ATPay-QR-extra','Other-QR'])assert.equal(names.confirmedIndiaThirdPartyAlias(raw,'印度'),'');
 assert.equal(await canon('印度','SYNTHETIC','ATPay-QR'),'ATPay');assert.equal(await canon('印度','SYNTHETIC','LegacyATP'),'ATPay');assert.equal(await canon('印尼','SYNTHETIC','ATPay-QR'),'OtherCountry');
});
test('AR registry and NEWAR native inverse selection reach exact raw channels without changing raw source rows',async()=>{
 const expand=q=>scalar('select private.dashboard_admin_live_expand_provider_filter($1::jsonb)',[JSON.stringify(q)]);
 const base={platformId:id,providers:['ATPay'],direction:'charge',action:'aggregate',status:'all',startAt:'2026-10-02T18:30:00Z',endAt:'2026-10-03T18:30:00Z'};
 assert.deepEqual((await expand(base)).providers,['ATPay','ATPay-QR','LegacyATP']);
 assert.deepEqual((await expand({...base,platformId:newid})).providers,['ATPay','ATPay-QR']);
 assert.deepEqual((await expand({...base,platformId:newid,providers:['Unconfirmed']})).providers,['Unconfirmed']);
 assert.deepEqual(await snapshot(),sourceBefore);
 await db.query("select set_config('test.denied','yes',false)");try{await assert.rejects(expand(base),/preview_denied/);}finally{await db.query("select set_config('test.denied','no',false)");}
});
test('workorder scalar and batch merge the exact same provider while manual assignments remain authoritative',async()=>{
 const args=['印度','SYNTHETIC','ATPay-QR','ATPayINR'],batch=()=>scalar('select provider from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)',[JSON.stringify([{country:args[0],platform:args[1],raw_provider:args[2],channel_type:args[3]}])]);
 assert.equal(await scalar('select private.dashboard_admin_live_workorder_provider($1,$2,$3,$4)',args),'ATPay');assert.equal(await batch(),'ATPay');
 await db.exec("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values('印度','SYNTHETIC','ATPay-QR','ManualReviewed')");
 try{assert.equal(await canon(...args.slice(0,3)),'ManualReviewed');assert.equal(await batch(),'ManualReviewed');await db.exec(patch);assert.equal(await canon(...args.slice(0,3)),'ManualReviewed');}
 finally{await db.exec("delete from private.dashboard_admin_provider_overrides where country='印度' and platform='SYNTHETIC' and raw_provider='ATPay-QR'");}
});
test('canonical group merge conserves amounts counts directions currencies and authoritative historical fee facts',async()=>{
 const row={provider:'ATPay',currency:'INR',direction:'charge',date:'2026-10-03',all_amount:'100',all_count:2,success_amount:'80',success_count:1,pending_amount:'20',pending_count:1};
 const input=[row,{...row,provider:'ATPay-QR'}, {...row,provider:'ATPay-QR',direction:'withdraw'},{...row,provider:'ATPay-QR',currency:'USDT'}];
 const result=await scalar('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true)',[JSON.stringify(input),'印度','SYNTHETIC']);
 assert.equal(result.length,3);assert.equal(result.reduce((s,r)=>s+Number(r.all_amount),0),400);assert.equal(result.reduce((s,r)=>s+r.all_count,0),8);assert(result.every(r=>r.provider==='ATPay'));
 const source=require('node:vm'),browser={};browser.window=browser;for(const f of ['live-provider-aliases.js','live-provider-summary.js'])source.runInNewContext(read('admin-preview/'+f),browser);
 const rates=[{provider:'ATPay',country:'印度',scopeType:'country',collectFee:'4%',sourceType:'跑分',sourceTypeProvider:'ATPay'}];
 assert.deepEqual(Array.from(browser.HensemProviderSummary.feeCandidates({...row,provider:'ATPay-QR'},rates,'印度'),r=>r.provider),['ATPay']);
 assert.equal(browser.HensemProviderSummary.estimate({...row,provider:'ATPay-QR'},rates,'印度'),null,'today reference never becomes historical money');
 assert.equal(browser.HensemProviderSummary.estimate({...row,provider:'ATPay-QR',success_count:2,fee_version_state:'partial',fee_version_estimated_amount:1.25,fee_version_matched_count:1,fee_version_unmatched_count:1},rates,'印度'),1.25);
});
test('idempotence preserves OID metadata and private privileges while drift cannot overwrite another deployment',async()=>{
 assert.deepEqual(await meta(),metadata);await db.exec(patch);assert.deepEqual(await meta(),metadata);assert.deepEqual(await snapshot(),sourceBefore);
 for(const role of ['anon','authenticated','service_role'])for(const name of ['dashboard_admin_live_provider_alias','dashboard_admin_live_confirmed_usdt_provider'])assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,'private.'+name+'(text,text)']),false);
 const ddl=patch.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 for(const change of ["grant execute on function private.dashboard_admin_live_provider_alias(text,text) to anon","alter function private.dashboard_admin_live_provider_alias(text,text) reset all","create or replace function private.dashboard_admin_live_provider_alias(p_country text,p_name text) returns text language sql immutable set search_path='' as $$select p_name$$"]){
  await db.exec('begin;'+change);try{await assert.rejects(db.exec(ddl),/atpay_alias_(?:metadata_or_acl|baseline)_drift/);}finally{await db.exec('rollback');}
 }
 // Generated dictionary reinstall must preserve exactly the reviewed semantics.
 await db.exec(read('supabase/admin-live-provider-aliases.sql'));assert.equal(await canon('印度','SYNTHETIC','ATPay-QR'),'ATPay');assert.equal(await canon('印尼','SYNTHETIC','ATPay-QR'),'OtherCountry');
 assert.doesNotMatch(patch,/\b(?:insert\s+into|update\s+(?:public|private)\.|delete\s+from|drop\s+|grant\s+)\b/i);
});
