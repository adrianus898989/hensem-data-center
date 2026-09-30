const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
const sources = ['src/lib/dashboardDataAccessServer.ts','supabase/functions/dashboard-api/lib/dashboardDataAccessServer.ts'];
const assigned = {mode:'assigned',roleId:'synthetic-role',roleName:'Support',version:2,assignmentVersion:1,canView:true,permissions:['overview.view','overview.query','workorders.view','workorders.query']};
function harness(source, role='viewer') {
  const state={calls:[],runs:0,authStatus:200,roleStatus:200,roleFailure:false,malformed:false,
    profile:{auth_user_id:'synthetic-user',username:'synthetic',role,active:true,permissions:{work_orders:true},data_scope:{mode:'selected',countries:['BR_PANGHU']}},
    roleAccess:{mode:role==='owner'?'owner':'legacy',canView:true,permissions:[]}};
  const env={SUPABASE_URL:'https://role-test.invalid',SUPABASE_ANON_KEY:'synthetic-public-key'};
  const fetch=async(input,init)=>{
    const url=new URL(String(input));state.calls.push({url,init});
    assert.equal(url.origin,env.SUPABASE_URL);
    assert.equal(init.headers.apikey,'synthetic-public-key');assert.equal(init.headers.Authorization,'Bearer synthetic-token');
    assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    if(url.pathname==='/auth/v1/user')return Response.json({id:'synthetic-user',user_metadata:{role:'owner'}},{status:state.authStatus});
    if(url.pathname==='/rest/v1/dashboard_profiles')return Response.json([state.profile]);
    assert.equal(url.pathname,'/rest/v1/rpc/dashboard_role_access');assert.equal(init.method,'POST');assert.equal(init.body,'{}');
    if(state.roleFailure)throw Error('SENSITIVE_UPSTREAM_FAILURE');
    if(state.malformed)return new Response('{',{status:200});
    return Response.json(state.roleAccess,{status:state.roleStatus});
  };
  const cache=new Map();
  function load(filename){
    filename=path.resolve(root,filename);if(cache.has(filename))return cache.get(filename).exports;
    const module={exports:{}};cache.set(filename,module);
    const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const require=specifier=>{
      assert(specifier.startsWith('.'),'only local production dependencies allowed');
      let target=path.resolve(path.dirname(filename),specifier);if(!target.endsWith('.ts'))target+='.ts';return load(target);
    };
    vm.runInNewContext(compiled,{module,exports:module.exports,require,fetch,Deno:{env:{get:key=>env[key]}},process:{env},Request,Response,Headers,URL,URLSearchParams,console},{filename});
    return module.exports;
  }
  const api=load(source);
  const request=()=>new Request('https://app.invalid/api/work-orders',{headers:{Authorization:'Bearer synthetic-token'}});
  const run=()=>api.withDashboardDataAccess(request(),'work_orders',async access=>{state.runs++;return Response.json({scope:access.scope});});
  return {state,api,request,run};
}
for(const source of sources){
  test(source+': owner and unassigned legacy retain existing module and country limits',async()=>{
    for(const role of ['owner','admin','viewer']){
      const h=harness(source,role);let res=await h.run();assert.equal(res.status,200);
      const scope=(await res.json()).scope;assert.equal(scope.mode,role==='owner'?'all':'selected');
      if(role!=='owner')assert.deepEqual(scope.countries,['BR_PANGHU']);
      h.state.profile.permissions.work_orders=false;res=await h.run();assert.equal(res.status,role==='owner'?200:403);
    }
  });
  test(source+': assigned role cannot call old coarse endpoints even with matching role permissions',async()=>{
    for(const canView of [true,false]){
      const h=harness(source);h.state.roleAccess={...assigned,canView};const res=await h.run();
      assert.equal(res.status,403);assert.equal((await res.json()).code,'role_gateway_required');assert.equal(h.state.runs,0);
      assert.match(res.headers.get('cache-control'),/private.*no-store/);assert.equal(h.state.calls.length,3);
    }
  });
  test(source+': role assignments are fresh per request and cannot reuse a previous legacy authorization',async()=>{
    const h=harness(source),request=h.request();
    await Promise.all([h.api.requireDashboardDataAccess(request,'work_orders'),h.api.requireDashboardDataAccess(request)]);
    assert.equal(h.state.calls.length,3);
    h.state.roleAccess=assigned;const res=await h.run();assert.equal(res.status,403);assert.equal(h.state.calls.length,6);assert.equal(h.state.runs,0);
  });
  test(source+': unavailable or malformed role RPC cannot fall back to legacy',async()=>{
    for(const patch of [{roleStatus:404},{roleStatus:403},{roleFailure:true},{malformed:true},{roleAccess:{}},{roleAccess:[]},
      {roleAccess:{mode:'owner',canView:true,permissions:[]}},{roleAccess:{mode:'legacy',canView:'true',permissions:[]}},
      {roleAccess:{mode:'legacy',canView:true,permissions:[false]}}]){
      const h=harness(source);Object.assign(h.state,patch);const res=await h.run();assert.equal(res.status,503);assert.equal(h.state.runs,0);
      const text=await res.text();assert.match(text,/role_access_unavailable/);assert.doesNotMatch(text,/SENSITIVE_UPSTREAM_FAILURE|synthetic-token/);
    }
  });
  test(source+': fresh Auth and profile checks remain ahead of roles',async()=>{
    for(const patch of [{authStatus:401},{profile:{auth_user_id:'synthetic-user',active:false,role:'owner'}},{profile:{auth_user_id:'different-user',active:true,role:'owner'}}]){
      const h=harness(source);Object.assign(h.state,patch);const res=await h.run();assert([401,403].includes(res.status));assert.equal(h.state.runs,0);
      assert(!h.state.calls.some(call=>call.url.pathname.endsWith('dashboard_role_access')));
    }
  });
}
