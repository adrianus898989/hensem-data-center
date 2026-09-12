const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {loadTs,root}=require('./load-typescript.cjs');
const scope=loadTs(path.join(root,'src/lib/dashboardDataScope.ts'));
const auth=loadTs(path.join(root,'src/lib/dashboardAuthClient.ts'));
const client=loadTs(path.join(root,'src/lib/dashboardDataClient.ts'));
const panghu={mode:'selected',countries:['BR_PANGHU']};
const owner={auth_user_id:'owner-fixture',role:'owner',active:true,updated_at:'a',data_scope:{mode:'all',countries:[]}};
const viewer={auth_user_id:'viewer-fixture',role:'viewer',active:true,updated_at:'b',data_scope:panghu};
function browser(){
  const storage={};Object.defineProperties(storage,{getItem:{value:k=>storage[k]??null},setItem:{value:(k,v)=>storage[k]=v},removeItem:{value:k=>delete storage[k]}});
  const win=new EventTarget();win.localStorage=storage;win.location={origin:'https://dashboard.test'};
  global.window=win;
  global.CustomEvent=class extends Event {constructor(type,options){super(type);this.detail=options.detail;}};
  client.setDashboardDataViewer(null);return win;
}
test('scope only permits confirmed Panghu Brazil and preserves legacy all/owner',()=>{
  for(const country of ['BR','br','巴西','BRAZIL','胖虎巴西'])assert.equal(scope.dashboardScopeAllows(panghu,country,'776F'),true);
  for(const name of ['POPNOV','POPFEZ','POPCRA','SSS55'])assert.equal(scope.dashboardScopeAllows(panghu,'BR',name),false);
  for(const name of ['POPNOV','POPFEZ','POPCRA'])assert.equal(scope.dashboardScopeAllows(panghu,'胖虎巴西',name),false);
  for(const country of ['VN','越南','印度','','BR-extra'])assert.equal(scope.dashboardScopeAllows(panghu,country,'776F'),false);
  assert.equal(scope.effectiveDashboardDataScope({...viewer,data_scope:undefined}).mode,'all');
  assert.equal(scope.effectiveDashboardDataScope({...owner,data_scope:panghu}).mode,'all');
  assert.equal(scope.dashboardScopeAllows(scope.effectiveDashboardDataScope({...viewer,active:false}),'BR','776F'),false);
});
test('malformed explicit scopes never expand; names/codes and NPG mapping are stable',()=>{
  for(const data of [false,{},[],{mode:'all',countries:['BR']},{mode:'selected',countries:['unknown']}])assert.deepEqual(scope.normalizeDashboardDataScope(data),{mode:'selected',countries:[]});
  assert.equal(scope.dashboardDataGroup('南美','NPG-CHILE'),'CL');assert.equal(scope.dashboardDataGroup('南美','VG'),'SA');
  assert.equal(scope.dashboardDataGroup('胖虎巴西盘口'),'BR_PANGHU');
  assert.equal(scope.dashboardDataGroup('巴西盘口'),'BR');
  assert.equal(scope.dashboardScopeLabel(panghu),'胖虎巴西');
});
test('changing user or scope removes old business cache without clearing login/preferences',()=>{
  const win=browser();win.localStorage.setItem('hensem:last-good:third-party-volume:v251-fast','legacy-secret');win.localStorage.setItem('login-preference','preserve');
  client.setDashboardDataViewer(owner);assert.equal(win.localStorage.getItem('hensem:last-good:third-party-volume:v251-fast'),null);
  client.writeDashboardDataCache('volume',{rows:['owner-fixture']},owner);
  assert.deepEqual(client.readDashboardDataCache('volume',owner),{rows:['owner-fixture']});
  client.setDashboardDataViewer(viewer);assert.equal(client.readDashboardDataCache('volume',owner),null);assert.equal(client.readDashboardDataCache('volume',viewer),null);
  client.writeDashboardDataCache('volume',{rows:['old-response']},owner);assert.equal(client.readDashboardDataCache('volume',viewer),null);
  client.writeDashboardDataCache('volume',{rows:[]},viewer);assert.deepEqual(client.readDashboardDataCache('volume',viewer),{rows:[]});
  client.setDashboardDataViewer({...viewer,updated_at:'c',data_scope:{mode:'selected',countries:['VN']}});
  assert.equal(client.readDashboardDataCache('volume',viewer),null);assert.equal(win.localStorage.getItem('login-preference'),'preserve');
});
test('business fetch validates fresh profile, sends only same-origin Bearer and uses no-store',async()=>{
  const win=browser();client.setDashboardDataViewer(viewer);
  const session={user:{id:viewer.auth_user_id},access_token:'synthetic-token'};
  auth.readSavedDashboardSession=()=>session;auth.ensureDashboardSession=async()=>session;auth.fetchDashboardProfile=async()=>viewer;
  let called=0;global.fetch=async(url,init)=>{called++;assert.equal(url,'https://dashboard.test/api/work-orders');assert.equal(init.cache,'no-store');assert.equal(init.headers.get('Authorization'),'Bearer synthetic-token');return new Response('{}');};
  await client.dashboardBusinessFetch('/api/work-orders');assert.equal(called,1);
  await assert.rejects(client.dashboardBusinessFetch('https://other.test/api/work-orders'),e=>client.isDashboardDataDenied(e));assert.equal(called,1);
  for(const status of [401,403]){global.fetch=async()=>new Response('{}',{status});await assert.rejects(client.dashboardBusinessFetch('/api/work-orders'),e=>client.isDashboardDataDenied(e));}
  auth.fetchDashboardProfile=async()=>({...viewer,updated_at:'scope-changed'});
  win.addEventListener(client.DASHBOARD_PROFILE_EVENT,e=>client.setDashboardDataViewer(e.detail.profile));
  called=0;global.fetch=async()=>{called++;return new Response('{}');};
  await assert.rejects(client.dashboardBusinessFetch('/api/work-orders'),e=>e.code==='data_scope_changed');assert.equal(called,0);
});
test('inflight response cannot populate a different current scope',async()=>{
  browser();client.setDashboardDataViewer(viewer);const session={user:{id:viewer.auth_user_id},access_token:'synthetic-token'};
  auth.readSavedDashboardSession=()=>session;auth.ensureDashboardSession=async()=>session;auth.fetchDashboardProfile=async()=>viewer;
  global.fetch=async()=>{client.setDashboardDataViewer({...viewer,updated_at:'changed'});return new Response('{}');};
  await assert.rejects(client.dashboardBusinessFetch('/api/work-orders'),e=>e.code==='data_scope_changed');
});
test('actual UI clears denied payloads, remounts scope and never revives authorized empty rows',()=>{
  const read=name=>fs.readFileSync(path.join(root,'src/components',name),'utf8');
  for(const name of ['Dashboard.tsx','WorkOrderDashboard.tsx','CustomerServiceDashboard.tsx','ThirdPartyVolumeDashboard.tsx','ThirdPartyRatesDashboard.tsx']){
    const code=read(name);assert.match(code,/dashboardBusinessFetch\(/);assert.match(code,/isDashboardDataDenied\(err\)/);
  }
  assert.match(read('DashboardAuthGate.tsx'),/<Fragment key=\{dashboardScopeIdentity\(profile\)\}>/);
  assert.doesNotMatch(read('ThirdPartyVolumeDashboard.tsx'),/if \(!volumeRows.length &&/);
  assert.doesNotMatch(read('WorkOrderDashboard.tsx'),/if \(!\(json.rows \|\| \[\]\).length &&/);
  assert.match(read('Dashboard.tsx'),/\.filter\(pane=>pane===NPG_PANE_LABEL/);
  assert.match(read('ThirdPartyVolumeDashboard.tsx'),/filter\(name=>dashboardScopeAllows\(scope,name\)\)/);
});
