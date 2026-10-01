// Real response wrapper against the existing role engine, no business records.
const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),patch=fs.readFileSync(path.join(root,'supabase/migrations/20261001151531_dashboard_role_read_projection_compatibility.sql'),'utf8');
let f,beforeState;
const metadata=()=>f.scalar("select jsonb_object_agg(oid::regprocedure::text,jsonb_build_object('owner',proowner,'acl',proacl::text,'definer',prosecdef,'volatile',provolatile,'config',proconfig,'body',case when pronamespace='private'::regnamespace then md5(prosrc) end)) from pg_proc where oid in ('private.dashboard_role_access()'::regprocedure,'public.dashboard_role_access()'::regprocedure,'public.dashboard_admin_execute(text,jsonb)'::regprocedure)");
before(async()=>{
 const file=path.join(__dirname,'dashboard-delegated-roles-sql.test.cjs'),req=createRequire(file);let setup;
 const ctx={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){},beforeEach(){},afterEach(){}}:req(n),__dirname,process,console};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(file,'utf8')+'\nglobalThis.fixture={get db(){return db},scalar,as,admin,create,assign,manage,access,OWNER,ADMIN,VIEWER,LEGACY};',ctx,{filename:file});await setup();f=ctx.fixture;
 beforeState=await metadata();await f.db.exec(patch);
});
after(async()=>f?.db.close());beforeEach(async()=>{await f.db.exec('begin');await f.as(f.OWNER)});afterEach(async()=>{await f.db.exec('rollback');await f.admin()});
test('owner and legacy public reads remain valid for older frontend catalogs without changing private authority',async()=>{
 for(const id of [f.OWNER,f.LEGACY]){await f.as(id);const result=await f.access();assert.deepEqual(result.permissions,[]);assert.equal(result.canView,true);assert.equal(result.mode,id===f.OWNER?'owner':'legacy');}
 await f.admin();assert((await f.scalar('select private.dashboard_role_access()')).permissions.includes('ip.edit'));
 assert.deepEqual(await metadata(),beforeState);
});
test('assigned response and gateway permissions remain unchanged while unknown catalog read keys cannot authorize SQL',async()=>{
 const role=await f.create(['providers.view','providers.query']);await f.assign(f.VIEWER,role);await f.as(f.VIEWER);
 const result=await f.access();assert.deepEqual(result.permissions,['providers.query','providers.view']);assert.equal(result.mode,'assigned');assert.equal(result.canView,true);
 await f.db.exec('savepoint denied');try{await assert.rejects(f.scalar('select public.dashboard_admin_execute($1,$2::jsonb)',['providers',JSON.stringify({action:'details'})]),/role_permission_denied/);}finally{await f.db.exec('rollback to savepoint denied')}
 await f.admin();assert.deepEqual(await f.scalar('select public.dashboard_role_access()'),await f.scalar('select private.dashboard_role_access()'));
});
test('inactive profiles and private ACL remain denied; public authenticated wrapper is unchanged',async()=>{
 await f.admin();await f.db.query('update dashboard_profiles set active=false where auth_user_id=$1',[f.LEGACY]);await f.as(f.LEGACY);
 await f.db.exec('savepoint denied');try{await assert.rejects(f.access(),/profile_denied/)}finally{await f.db.exec('rollback to savepoint denied')}
 await f.admin();assert.equal(await f.scalar("select has_function_privilege('anon','public.dashboard_role_access()','execute')"),false);assert.equal(await f.scalar("select has_function_privilege('authenticated','public.dashboard_role_access()','execute')"),true);assert.equal(await f.scalar("select has_function_privilege('authenticated','private.dashboard_role_access()','execute')"),false);
});
