// The native assigned-role gateway must require detail as well as view and query.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'dashboard-roles-sql.test.cjs'),req=createRequire(filename),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');let f,metadata;
before(async()=>{let setup;const c={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){},beforeEach(){},afterEach(){}}:req(n),__dirname,process,console,structuredClone};vm.createContext(c);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get db(){return db},as,admin,scalar,manage,granted,execute,OWNER,ADMIN,LEGACY};',c,{filename});await setup();f=c.fixture;
 await f.db.exec(read('tests/fixtures/submission-member-orders-gateway.sql'));
 metadata=await f.scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure");
 const m=read('supabase/migrations/20261010071932_submission_member_order_details.sql');await f.db.exec(m.slice(m.indexOf('do $member_orders_gateway$'),m.indexOf('end;$member_orders_gateway$;')+'end;$member_orders_gateway$;'.length));
});
after(async()=>f?.db.close());
async function transaction(fn){await f.admin();await f.db.exec('begin');try{return await fn();}finally{await f.db.exec('rollback');await f.admin();}}
async function denied(fn,pattern){await f.db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await f.db.exec('rollback to savepoint denied');}}
const q={action:'submissionAnalysis',operation:'memberOrders',memberId:'Synthetic',day:'2026-10-05'};
test('events query without detail cannot read amounts or order IDs; adding detail allows the same scoped request',async()=>transaction(async()=>{
 const role=await f.granted(f.ADMIN,['events.view','events.query']);await denied(()=>f.execute('events',q),/role_permission_denied/);
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['events.view','events.query','events.detail']});await f.as(f.ADMIN);
 assert.equal((await f.execute('events',q)).request.operation,'memberOrders');await denied(()=>f.scalar("select private.dashboard_admin_live_submission_analysis('{}')"),/role_gateway_required/);
}));
test('detail without query and unrelated pages remain denied; existing summary stays permitted',async()=>transaction(async()=>{
 await f.granted(f.ADMIN,['events.view','events.detail','providers.view','providers.query']);await denied(()=>f.execute('events',q),/role_permission_denied/);
 await denied(()=>f.execute('providers',q),/role_permission_denied/);assert.equal((await f.execute('providers',{action:'submissionAnalysis',operation:'summary'})).request.operation,'summary');await denied(()=>f.execute('rules',q),/page_action_denied/);
}));
test('gateway metadata, ACL and scope controls remain unchanged',async()=>transaction(async()=>{
 assert.deepEqual(await f.scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure"),metadata);
 await f.granted(f.ADMIN,['events.view','events.query','events.detail']);await f.admin();await f.db.query('update dashboard_profiles set active=false where auth_user_id=$1',[f.ADMIN]);await f.as(f.ADMIN);await denied(()=>f.execute('events',q),/required|denied/);
}));
