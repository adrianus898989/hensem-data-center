const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {setup,options,names,ids,migration,baseline}=require('./fixtures/wg-provider-options-harness.cjs');
let db,beforeMetadata,expected;
before(async()=>{db=await setup();expected=[];
 for(const direction of ['all','charge','withdraw'])for(const selected of [Object.values(ids),[ids.wg],[ids.other],[ids.br],[ids.ar,ids.lg],[]])
  expected.push({direction,selected,result:await options(db,selected,direction)});
 beforeMetadata=(await db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure")).rows[0].metadata;
 await db.exec(migration);
});
after(()=>db?.close());
test('full authorized directory matches the actual baseline for each source, site and direction',async()=>{
 for(const c of expected)assert.deepEqual(await options(db,c.selected,c.direction),c.result);
 const result=await options(db,[ids.wg],'charge');
 assert(result.providers.includes('ManualOverride'));assert(result.providers.includes('未识别通道'));
 assert(result.providers.includes('LegacyFieldMismatch'),'preserve existing site identity despite historical row country/platform mismatch');
 assert.equal(result.providers.filter(x=>x==='YesPay').length,1);
 assert(!result.providers.includes('SecondSiteOnly'));assert(!result.providers.includes('Unauthorized'));
});
test('index walker retains unknown names, Unicode, blank/null and exact registered site identity',async()=>{
 const got=await names(db,'VN','98VV','charge');
 const direct=(await db.query("select distinct coalesce(nullif(btrim(provider),''),'未识别通道') provider from public.wg_recharge_details where site_code='3257' order by provider")).rows.map(x=>x.provider);
 assert.deepEqual(got,direct);assert(got.includes('Unregistered-Z'));assert(got.includes('\u00a0'));assert(got.includes('😀Pay'));
 for(const [c,p,d]of [['BR','98VV','all'],['VN','26BET','all'],['VN','missing','all'],['VN','98VV','invalid'],['VN','98VV',null]])
  assert.deepEqual(await names(db,c,p,d),[]);
});
test('authenticated scope and denied-profile behavior stay at the original caller boundary',async()=>{
 await db.query("select set_config('test.platform','98VV',false)");
 try{const r=await options(db,Object.values(ids));assert.equal(r.platformCount,1);assert(!r.providers.includes('BrazilOnly'));assert(!r.providers.includes('SecondSiteOnly'));}
 finally{await db.query("select set_config('test.platform','',false)");}
 await db.query("select set_config('test.denied','yes',false)");
 try{await assert.rejects(options(db),/access_denied/);}finally{await db.query("select set_config('test.denied','',false)");}
});
test('request validation and empty selection preserve fail-closed behavior',async()=>{
 for(const r of [{platformIds:[ids.wg],direction:'invalid'},{platformIds:[ids.wg],country:'VN'},{platformIds:['bad']},{platformIds:Array(201).fill(ids.wg)}])
  await assert.rejects(db.query('select private.dashboard_admin_live_provider_options($1::jsonb)',[JSON.stringify(r)]),/invalid_(request|filter)/);
 assert.deepEqual(await options(db,[]),{providers:[],platformCount:0,basis:'existing_classification'});
});
test('old metadata is byte-preserved; reusable helper is invoker, stable, empty path and owner-only',async()=>{
 const now=(await db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure")).rows[0].metadata;
 assert.deepEqual(now,beforeMetadata);
 const h=(await db.query("select prosecdef,provolatile,proconfig,proacl::text acl from pg_proc where oid='private.dashboard_admin_wg_provider_names(text,text,text)'::regprocedure")).rows[0];
 assert.deepEqual(h,{prosecdef:false,provolatile:'s',proconfig:['search_path=""'],acl:'{postgres=X/postgres}'});
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{await assert.rejects(names(db,'VN','98VV','all'),/permission denied/);}finally{await db.exec('reset role');}
 }
});
test('many duplicate historical records neither cap nor change the distinct directory',async()=>{
 const prior=await names(db,'VN','98VV','all');
 await db.exec("insert into public.wg_recharge_details select '3257','YesPay(VND)',null,null from generate_series(1,4000)");
 assert.deepEqual(await names(db,'VN','98VV','all'),prior);
 await db.exec("insert into public.wg_recharge_details values('3257','ZZ-new-provider',null,null)");
 assert((await names(db,'VN','98VV','charge')).includes('ZZ-new-provider'));
});
test('dependency, body and ACL drift abort atomically without leaving a helper',async()=>{
 const x=await setup();try{
  for(const [mutation,reason]of [
   ["drop index public.wg_recharge_site_provider",/index_contract/],
   ["alter table public.wg_recharge_details disable row level security",/relation_contract/],
   ["alter table public.wg_recharge_details rename column provider to provider_old",/column_contract/],
   ["drop index public.wg_recharge_site_provider;create index wrong_collation on public.wg_recharge_details(site_code,provider collate \"C\")",/index_contract/],
   ["grant execute on function private.dashboard_admin_live_provider_options(jsonb) to anon",/metadata_drift/],
   ["create or replace function private.dashboard_admin_live_provider_options(p_request jsonb default '{}'::jsonb) returns jsonb language sql as $$select '{}'::jsonb$$",/baseline_drift/]
  ]){
   await x.exec('begin;'+mutation);
   await assert.rejects(x.exec(migration),reason);
   await x.exec('rollback');
   assert.equal((await x.query("select to_regprocedure('private.dashboard_admin_wg_provider_names(text,text,text)') value")).rows[0].value,null);
  }
  await x.exec(migration);
  assert.equal((await options(x,[ids.wg])).platformCount,1);
 }finally{await x.close();}
});
