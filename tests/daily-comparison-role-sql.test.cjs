// Current production gateway and catalog with synthetic profiles/data RPCs only.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'dashboard-roles-sql.test.cjs'),req=createRequire(filename);let f,gatewayMetadata;
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
before(async()=>{
 let setup;const c={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){},beforeEach(){},afterEach(){}}:req(n),__dirname,process,console,structuredClone};
 vm.createContext(c);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get db(){return db},as,admin,scalar,manage,granted,execute,access,OWNER,ADMIN,VIEWER,LEGACY};',c,{filename});await setup();f=c.fixture;
 await f.db.exec(read('tests/fixtures/daily-comparison-gateway.sql'));
 await f.db.exec(read('tests/fixtures/daily-comparison-role-catalog-baseline.sql'));
 for(const name of ['rates','workorders','provider_options','sync_health'])await f.db.exec("create function private.dashboard_admin_live_"+name+"(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return jsonb_build_object('request',p_request,'scope',s,'context',private.dashboard_role_context_valid());end$$;");
 gatewayMetadata=await f.scalar("select to_jsonb(p) from pg_proc p where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure");
 assert.equal(gatewayMetadata.prosrc.length>1000,true);
 await f.db.exec(read('supabase/migrations/20261004140008_daily_comparison_role_catalog.sql'));
});
after(async()=>f?.db.close());
async function transaction(fn){await f.admin();await f.db.exec('begin');try{return await fn();}finally{await f.db.exec('rollback');await f.admin();}}
async function denied(fn,pattern){await f.db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await f.db.exec('rollback to savepoint denied');}}
test('another operations page cannot borrow daily comparison; saved assignments gain no new permission',async()=>transaction(async()=>{
 await f.granted(f.ADMIN,['merchants.view','merchants.query','merchants.detail','merchants.export']);
 assert.equal((await f.execute('merchants',{action:'aggregate'})).context,true);
 await denied(()=>f.execute('daily_comparison',{action:'catalog'}),/page_action_denied/);
 assert.equal((await f.access()).permissions.some(p=>p.startsWith('daily_comparison.')),false);
}));
test('daily view can read its directory while data requests need query and retain native platform scope',async()=>transaction(async()=>{
 const role=await f.granted(f.ADMIN,['daily_comparison.view']);
 for(const action of ['catalog','providerOptions'])assert.equal((await f.execute('daily_comparison',{action})).context,true);
 for(const action of ['aggregate','rates','syncHealth','workorders'])await denied(()=>f.execute('daily_comparison',{action}),/role_permission_denied/);
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['daily_comparison.view','daily_comparison.query']});await f.as(f.ADMIN);
 for(const action of ['aggregate','rates','syncHealth','workorders']){
  const r=await f.execute('daily_comparison',{action});assert.equal(r.context,true);assert.deepEqual(r.scope,{mode:'restricted',platforms:['A']});
 }
}));
test('daily detail/export grants do not enable raw orders, source writes, or unrelated actions',async()=>transaction(async()=>{
 await f.granted(f.ADMIN,['daily_comparison.view','daily_comparison.query','daily_comparison.detail','daily_comparison.export']);
 for(const action of ['details','query','analysisOrders','workorderRecords','configurationWrite','submissionStreak','ratesSheet'])
  await denied(()=>f.execute('daily_comparison',{action}),/page_action_denied/);
 await denied(()=>f.scalar("select private.dashboard_admin_live_query('{\"action\":\"aggregate\"}')"),/role_gateway_required/);
}));
test('legacy cannot use the assigned daily gateway, owner policy and current gateway code/ACL remain unchanged',async()=>transaction(async()=>{
 await f.as(f.OWNER);assert.equal((await f.access()).mode,'owner');assert((await f.access()).permissions.includes('daily_comparison.detail'));
 await f.as(f.LEGACY);assert.equal((await f.access()).mode,'legacy');await denied(()=>f.execute('daily_comparison',{action:'aggregate'}),/assigned_role_required/);
 await f.admin();assert.deepEqual(await f.scalar("select to_jsonb(p) from pg_proc p where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure"),gatewayMetadata);
}));
test('fresh role or active-profile revocation immediately rejects previously allowed daily reads',async()=>transaction(async()=>{
 const role=await f.granted(f.ADMIN,['daily_comparison.view','daily_comparison.query']);assert.equal((await f.execute('daily_comparison',{action:'aggregate'})).context,true);
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['daily_comparison.view']});await f.as(f.ADMIN);
 await denied(()=>f.execute('daily_comparison',{action:'aggregate'}),/role_permission_denied/);
 await f.admin();await f.db.query('update dashboard_profiles set active=false where auth_user_id=$1',[f.ADMIN]);await f.as(f.ADMIN);await denied(()=>f.execute('daily_comparison',{action:'catalog'}),/required|denied/);
}));
