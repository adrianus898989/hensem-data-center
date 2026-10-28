const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),fixture=path.join(root,'tests/dashboard-session-renewal.test.cjs'),req=createRequire(fixture),ts=req('typescript');
const site='https://data-center.workdesk-hub.workers.dev';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function runtime(){
 let text=fs.readFileSync(fixture,'utf8');text=text.slice(0,text.lastIndexOf('(async()=>{'));
 const box={require:req,__dirname:path.join(root,'tests'),console,Buffer,structuredClone,Response,Request,Headers,Event,EventTarget,URL,URLSearchParams,AbortController,AbortSignal,DOMException,atob,btoa,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,process};
 vm.createContext(box);vm.runInContext(text+'\nglobalThis.api={harness,session,tick,json,deferred,A,B,gatewayAction};',box,{filename:fixture});return box.api;
}
function client(name,h){
 const file=path.join(root,'src/lib/'+name+'.ts'),m={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  module:m,exports:m.exports,window:h.window,URL,URLSearchParams,AbortController,AbortSignal,Response,Request,Headers,TextEncoder,TextDecoder,setTimeout,clearTimeout,
  process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://supabase.offline.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'offline-public-key'}},
  require:id=>id==='./dashboardAuthClient'?h.api:id==='./dashboardRoleCatalog.json'?{default:JSON.parse(fs.readFileSync(path.join(root,'src/lib/dashboardRoleCatalog.json'),'utf8'))}:id==='./ownerPreviewVerification'?require('./load-typescript.cjs').loadTs(path.join(root,'src/lib/ownerPreviewVerification.ts')):assert.fail(id),
  fetch:async(url,init={})=>{h.calls.push({url:String(url),method:init.method||'GET',headers:new Headers(init.headers),body:init.body,signal:init.signal});return h.respond(String(url),init);},
 },{filename:file});return m.exports;
}
function setup(origin=site){const r=runtime(),h=r.harness(),s=r.session();h.window.location.origin=origin;h.api.saveDashboardSession(s);return{r,h,s};}
const role={mode:'owner',canView:true,permissions:[],roleId:null,roleName:null,version:0};
test('only the exact production HTTPS origin selects the four fixed read paths',()=>{
 const {h}=setup();for(const [kind,name]of Object.entries({profile:'dashboard-profile','role-access':'dashboard-role-access',preview:'dashboard-preview','access-check':'dashboard-access-check'}))assert.equal(h.api.dashboardBootstrapReadUrl(kind),site+'/hensem-data-center/api/'+name);
 assert.equal(h.api.dashboardBootstrapReadUrl('constructor'),null);
 for(const origin of ['https://adrianus898989.github.io','http://data-center.workdesk-hub.workers.dev','https://data-center.workdesk-hub.workers.dev.attacker.invalid','http://localhost:3000']){
  h.window.location.origin=origin;assert.equal(h.api.dashboardBootstrapReadUrl('profile'),null);
 }
});
test('production profile keeps response identity validation and sends no user ID/query',async()=>{
 const {h,s}=setup();h.setFetch(()=>json([{auth_user_id:s.user.id,username:'fixture',role:'viewer',active:true}]));
 assert.equal((await h.api.fetchDashboardProfile(s)).auth_user_id,s.user.id);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,site+'/hensem-data-center/api/dashboard-profile');
 assert.equal(h.calls[0].headers.get('authorization'),'Bearer '+s.access_token);
 h.setFetch(()=>json([{auth_user_id:'other',username:'fixture',role:'viewer',active:true}]));
 await assert.rejects(h.api.fetchDashboardProfile(s),e=>e.code==='profile_response_invalid');
});
test('production access check sends only {} while original administrative writes remain direct',async()=>{
 const {h,s}=setup();h.setFetch(()=>json({ok:true,allowed:true}));await h.api.verifyDashboardAccess(s);
 assert.equal(h.calls[0].url,site+'/hensem-data-center/api/dashboard-access-check');assert.equal(h.calls[0].body,'{}');
 h.setFetch(()=>json({code:'denied'},403));await assert.rejects(h.api.updateDashboardAccount(s,'fixture',{active:false}));
 assert.equal(h.calls[1].url,'https://supabase.offline.invalid/functions/v1/dashboard-user-admin');
 assert.notEqual(JSON.parse(h.calls[1].body).action,'check-access');assert.equal(h.calls.length,2);
});
test('production role and preview reads use same-origin transport with unchanged fresh credentials and cancellation',async()=>{
 const {h,s}=setup(),signal=new AbortController().signal;
 h.respond=async url=>json(url.endsWith('dashboard-role-access')?role:{ok:true,canView:true});
 const roles=client('dashboardRoleAccess',h),preview=client('adminPreviewClient',h);
 await roles.readDashboardRoleAccess(s,signal);
 for(const query of ['','?action=access','?check=1'])await preview.adminPreviewRequest(s,query,{signal});
 assert.equal(h.calls[0].url,site+'/hensem-data-center/api/dashboard-role-access');assert.equal(h.calls[0].body,'{}');
 assert.deepEqual(Array.from(h.calls.slice(1),c=>c.url),['','?action=access','?check=1'].map(q=>site+'/hensem-data-center/api/dashboard-preview'+q));
 for(const call of h.calls){assert.equal(call.signal,signal);assert.equal(call.headers.get('authorization'),'Bearer '+s.access_token)}
});
test('preview management, POST and unregistered query forms never migrate to bootstrap',async()=>{
 const {h,s}=setup();h.respond=async()=>json({ok:true});const api=client('adminPreviewClient',h);
 for(const [query,init]of [['?action=grants',{}],['?action=grants',{method:'POST',body:'{}'}],['?action=access',{method:'POST',body:'{}'}],['?check=1&extra=1',{}]])await api.adminPreviewRequest(s,query,init);
 assert(h.calls.every(c=>c.url.startsWith('https://supabase.offline.invalid/functions/v1/owner-admin-preview')));
});
test('nonproduction deployments preserve all existing direct endpoints and access-check body',async()=>{
 const {h,s}=setup('https://adrianus898989.github.io');
 h.setFetch(c=>c.url.includes('/dashboard_profiles?')?json([{auth_user_id:s.user.id,username:'fixture',role:'viewer',active:true}]):json({ok:true,allowed:true}));
 await h.api.fetchDashboardProfile(s);await h.api.verifyDashboardAccess(s);
 h.respond=async url=>json(url.endsWith('/dashboard_role_access')?role:{ok:true});
 await client('dashboardRoleAccess',h).readDashboardRoleAccess(s);await client('adminPreviewClient',h).adminPreviewRequest(s);
 assert(h.calls.every(c=>c.url.startsWith('https://supabase.offline.invalid/')));
 assert.equal(JSON.parse(h.calls[1].body).action,'check-access');
});
test('HTTP denials and temporary errors never fail over to direct endpoints',async()=>{
 for(const status of [403,503]){
  const {h,s}=setup();h.setFetch(()=>json({code:'application_session_denied'},status));h.respond=async()=>json({code:'application_session_denied'},status);
  await assert.rejects(h.api.fetchDashboardProfile(s));await assert.rejects(h.api.verifyDashboardAccess(s));
  await assert.rejects(client('dashboardRoleAccess',h).readDashboardRoleAccess(s));await assert.rejects(client('adminPreviewClient',h).adminPreviewRequest(s));
  assert.equal(h.calls.length,4);assert(h.calls.every(c=>c.url.startsWith(site+'/hensem-data-center/api/')));assert.equal(h.refreshCalls().length,0);
 }
});
test('existing profile transport retry stays on the same proxy; all other reads never add fallback requests',async()=>{
 const {h,s}=setup();const failed=()=>{throw new TypeError('synthetic disconnect')};h.setFetch(failed);h.respond=failed;
 await assert.rejects(h.api.fetchDashboardProfile(s));assert.equal(h.calls.length,2);
 await assert.rejects(h.api.verifyDashboardAccess(s));await assert.rejects(client('dashboardRoleAccess',h).readDashboardRoleAccess(s));await assert.rejects(client('adminPreviewClient',h).adminPreviewRequest(s));
 assert.equal(h.calls.length,5);assert(h.calls.every(c=>c.url.startsWith(site+'/hensem-data-center/api/')));
});
test('access401 retains one shared refresh and replays only the same fixed access route',async()=>{
 const {h,s,r}=setup();let reads=0;
 h.setFetch(c=>r.gatewayAction(c)==='refresh'?r.json(r.session('renewed')):++reads===1?json({code:'auth_token_invalid'},401):json({ok:true,allowed:true}));
 await h.api.verifyDashboardAccess(s);assert.equal(h.refreshCalls().length,1);
 assert.deepEqual(Array.from(h.dataCalls(),c=>c.url),[site+'/hensem-data-center/api/dashboard-access-check',site+'/hensem-data-center/api/dashboard-access-check']);
 assert(h.dataCalls().every(c=>c.body==='{}'));assert.equal(h.saved().access_token,'offline-access-renewed');
});
test('role/preview cancellation and account switch guards run before sending a request',async()=>{
 for(const which of ['role','preview']){
  const {h,s,r}=setup();h.respond=async()=>json(role);const api=client(which==='role'?'dashboardRoleAccess':'adminPreviewClient',h);
  const abort=new AbortController();abort.abort();
  await assert.rejects(which==='role'?api.readDashboardRoleAccess(s,abort.signal):api.adminPreviewRequest(s,'',{signal:abort.signal}));
  assert.equal(h.calls.length,0);h.api.saveDashboardSession(r.session('other',3600,r.B));
  await assert.rejects(which==='role'?api.readDashboardRoleAccess(s):api.adminPreviewRequest(s));assert.equal(h.calls.length,0);
 }
});
