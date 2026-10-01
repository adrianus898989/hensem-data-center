// Real assigned-role HMAC gateway, scope and detail-capability checks.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'dashboard-roles-sql.test.cjs'),req=createRequire(filename);let f;
before(async()=>{let setup;const c={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){},beforeEach(){},afterEach(){}}:req(n),__dirname,process,console,structuredClone};vm.createContext(c);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get db(){return db},as,admin,scalar,manage,granted,execute,OWNER,ADMIN};',c,{filename});await setup();f=c.fixture;
 const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001144547_admin_analysis_segment_orders.sql'),'utf8'),roles=migration.slice(migration.indexOf('do $roles$'),migration.indexOf('end;$roles$;')+'end;$roles$;'.length);
 await f.db.exec(`create function private.dashboard_admin_live_analysis_orders(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$declare v_scope jsonb:=private.dashboard_admin_live_scope();begin return jsonb_build_object('request',p_request,'scope',v_scope,'context',private.dashboard_role_context_valid());end$$;create function public.dashboard_admin_live_analysis_orders(p_request jsonb) returns jsonb language sql stable as $$select private.dashboard_admin_live_analysis_orders(p_request)$$;revoke all on function private.dashboard_admin_live_analysis_orders(jsonb),public.dashboard_admin_live_analysis_orders(jsonb) from public,anon;grant execute on function private.dashboard_admin_live_analysis_orders(jsonb),public.dashboard_admin_live_analysis_orders(jsonb) to authenticated;`);
 // Preserve another additive catalog update instead of replacing a stale copy.
 const cat=await f.scalar('select private.dashboard_role_catalog()');cat.pages.find(x=>x.id==='ip').actions.push({id:'edit',label:'配置白名单与登录安全',dependsOn:['view']});cat.permissions.push({key:'ip.edit'});await f.db.query("create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='' as $$select '"+JSON.stringify(cat).replace(/'/g,"''")+"'::jsonb$$");
 await f.db.exec(roles);await f.db.exec(roles);
});
after(async()=>f?.db.close());
async function transaction(fn){await f.admin();await f.db.exec('begin');try{return await fn();}finally{await f.db.exec('rollback');await f.admin();}}
async function denied(fn,pattern){await f.db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await f.db.exec('rollback to savepoint denied');}}
test('catalog expansion preserves delegated IP permissions and only adds analysisOrders to already detailed aggregate pages',async()=>transaction(async()=>{
 const c=await f.scalar('select private.dashboard_role_catalog()');assert(c.pages.find(p=>p.id==='ip').actions.some(a=>a.id==='edit'));assert(c.permissions.some(p=>p.key==='ip.edit'));
 for(const p of c.pages){const allowed=p.requests.includes('aggregate')&&p.actions.some(a=>a.id==='detail');assert.equal(p.requests.includes('analysisOrders'),allowed,p.id);}
}));
test('assigned analysis orders require view plus query plus detail and preserve the original constrained account scope',async()=>transaction(async()=>{
 const role=await f.granted(f.ADMIN,['matrix.view','matrix.query']);await denied(()=>f.execute('matrix',{action:'analysisOrders',kind:'custom',basis:'created'}),/role_permission_denied/);
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['matrix.view','matrix.query','matrix.detail']});await f.as(f.ADMIN);const q={action:'analysisOrders',kind:'matrix_range',basis:'success',hour:8,bucket:'band:1',offset:20,limit:20},r=await f.execute('matrix',q);assert.equal(r.context,true);assert.deepEqual(r.scope,{mode:'restricted',platforms:['A']});const expected={...q};delete expected.action;assert.deepEqual(r.request,expected);
 await denied(()=>f.execute('access',q),/page_action_denied/);await denied(()=>f.scalar("select public.dashboard_admin_live_analysis_orders('{}')"),/role_gateway_required/);
}));
test('a detail-only role cannot query, another page cannot borrow permission, and disabling the profile revokes immediately',async()=>transaction(async()=>{
 const role=await f.granted(f.ADMIN,['matrix.view','matrix.detail']);await denied(()=>f.execute('matrix',{action:'analysisOrders'}),/role_permission_denied/);
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['matrix.view','matrix.query','matrix.detail']});await f.as(f.ADMIN);await denied(()=>f.execute('amount',{action:'analysisOrders'}),/page_action_denied/);
 await f.admin();await f.db.query('update dashboard_profiles set active=false where auth_user_id=$1',[f.ADMIN]);await f.as(f.ADMIN);await denied(()=>f.execute('matrix',{action:'analysisOrders'}),/required|denied/);
}));
