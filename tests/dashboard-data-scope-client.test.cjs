const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const ts=require('typescript');
const {loadTs,root}=require('./load-typescript.cjs');
const scope=loadTs(path.join(root,'src/lib/dashboardDataScope.ts'));
const auth=loadTs(path.join(root,'src/lib/dashboardAuthClient.ts'));
const client=loadTs(path.join(root,'src/lib/dashboardDataClient.ts'));
const plain=value=>JSON.parse(JSON.stringify(value));
const panghu={mode:'selected',countries:['BR_PANGHU']};
const owner={auth_user_id:'owner-fixture',role:'owner',active:true,updated_at:'a',data_scope:{mode:'all',countries:[]}};
const viewer={auth_user_id:'viewer-fixture',role:'viewer',active:true,updated_at:'b',data_scope:panghu};
function browser(){
  const storage={};Object.defineProperties(storage,{getItem:{value:k=>storage[k]??null},setItem:{value:(k,v)=>storage[k]=v},removeItem:{value:k=>delete storage[k]}});
  const win=new EventTarget();win.localStorage=storage;win.location={origin:'https://dashboard.test'};
  global.window=win;process.env.NEXT_PUBLIC_SUPABASE_URL='https://business-api.fixture.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-publishable';
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
test('platform whitelists retain exact country/name isolation, AND country bounds, and explicit empty denial',()=>{
  const only={mode:'selected',countries:[],platforms:[{country:'IN',platform:' VEER.Game '}]};
  const normalized=scope.normalizeDashboardDataScope(only);
  assert.deepEqual(normalized,{mode:'selected',countries:[],platforms:[{country:'IN',platform:'VEER.GAME'}]});
  assert.equal(scope.dashboardScopeAllows(normalized,'印度','veer.game'),true);
  for(const [country,platform] of [['PK','VEER.GAME'],['IN','OTHER'],['IN',''],['IN',null],['','VEER.GAME']])assert.equal(scope.dashboardScopeAllows(normalized,country,platform),false);
  assert.equal(scope.dashboardScopeAllows({mode:'selected',countries:['IN']},'IN','OTHER'),true,'omitted whitelist preserves country-only access');
  assert.equal(scope.dashboardScopeAllows({mode:'selected',countries:['IN'],platforms:[]},'IN','VEER.GAME'),false);
  assert.equal(scope.dashboardScopeAllows({mode:'selected',countries:['IN'],platforms:[{country:'IN',platform:'VEER.GAME'}]},'IN','OTHER'),false);
  assert.deepEqual(scope.normalizeDashboardDataScope({mode:'selected',countries:['IN'],platforms:[{country:'PK',platform:'VEER.GAME'}]}),{mode:'selected',countries:[]});
  assert.match(scope.dashboardScopeLabel(normalized),/指定平台：印度 · VEER\.GAME/);
  assert.equal(scope.dashboardScopeLabel({mode:'selected',countries:['IN'],platforms:[]}),'无可见数据');
});
test('platform normalization deduplicates safe labels, enforces codepoint bounds and never drops malformed restrictions',()=>{
  const source={mode:'selected',countries:['IN','IN'],platforms:[{country:'IN',platform:'\u00a0beta\ufeff'},{country:'IN',platform:'alpha'},{country:'IN',platform:' BETA '}]};
  assert.deepEqual(scope.normalizeDashboardDataScope(source),{mode:'selected',countries:['IN'],platforms:[{country:'IN',platform:'ALPHA'},{country:'IN',platform:'BETA'}]});
  assert.equal(scope.isDashboardDataScopeValid({mode:'selected',countries:[],platforms:[{country:'IN',platform:'😀'.repeat(200)}]}),true);
  for(const data of [
    {mode:'all',countries:[],platforms:[]},{mode:'selected',countries:['IN'],unknown:true},
    ...[null,false,{},'IN'].map(platforms=>({mode:'selected',countries:['IN'],platforms})),
    ...[{country:'unknown',platform:'A'},{country:'IN',platform:''},{country:'IN',platform:'A\u0085B'},{country:'IN',platform:'A\u0001B'},{country:'IN',platform:'😀'.repeat(201)},{country:'IN',platform:'ß'.repeat(200)},{country:'IN',platform:'A',extra:true}].map(pair=>({mode:'selected',countries:['IN'],platforms:[pair]})),
    {mode:'selected',countries:[],platforms:Array.from({length:501},(_,i)=>({country:'IN',platform:'A'+i}))},
  ]){assert.equal(scope.isDashboardDataScopeValid(data),false);assert.deepEqual(scope.normalizeDashboardDataScope(data),{mode:'selected',countries:[]});assert.equal(scope.dashboardScopeAllows(data,'IN','A'),false);}
  const edge=fs.readFileSync(path.join(root,'supabase/functions/dashboard-api/lib/dashboardDataScope.ts'),'utf8');
  assert.equal(edge.replace('from "./platformDisplayCountry.ts"','from "./platformDisplayCountry"'),fs.readFileSync(path.join(root,'src/lib/dashboardDataScope.ts'),'utf8'),'Edge and browser must use identical scope logic');
});
test('delegation cannot turn a platform whitelist into country-wide or same-name foreign access',()=>{
  const parent={mode:'selected',countries:[],platforms:[{country:'IN',platform:'A'},{country:'IN',platform:'B'}]};
  assert.equal(scope.isDashboardDataScopeSubset({mode:'selected',countries:[],platforms:[{country:'IN',platform:'A'}]},parent),true);
  for(const child of [{mode:'all',countries:[]},{mode:'selected',countries:['IN']},{mode:'selected',countries:[],platforms:[{country:'PK',platform:'A'}]},{mode:'selected',countries:[],platforms:[{country:'IN',platform:'C'}]}])assert.equal(scope.isDashboardDataScopeSubset(child,parent),false);
  assert.equal(scope.isDashboardDataScopeSubset({mode:'selected',countries:[],platforms:[{country:'IN',platform:'A'}]},{mode:'selected',countries:['IN']}),true);
  assert.equal(scope.isDashboardDataScopeSubset({mode:'selected',countries:[],platforms:[]},parent),true);
  assert.equal(scope.isDashboardDataScopeSubset(parent,{mode:'selected',countries:['IN'],platforms:[]}),false);
  for(const invalid of [{mode:'selected',countries:[]},{mode:'all',countries:[],platforms:null},{mode:'selected',countries:['IN'],unknown:true}])assert.equal(scope.isDashboardDataScopeSubset(parent,invalid),false);
});
test('country navigation and routing allow existing platform groups without authorizing country-only totals',()=>{
  const selected={mode:'selected',countries:[],platforms:[{country:'IN',platform:'A'}]};
  assert.equal(scope.dashboardScopeMayReadCountry(selected,'印度'),true);assert.equal(scope.dashboardScopeMayReadCountry(selected,'巴基斯坦'),false);
  assert.equal(scope.dashboardScopeAllows(selected,'印度'),false);assert.equal(scope.dashboardScopeMayReadCountry({...selected,platforms:[]},'印度'),false);
  const callback=(file,name,context)=>{
    const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
    function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='useMemo')found=node.initializer.arguments[0];ts.forEachChild(node,walk);}walk(source);assert(found,'production navigation callback exists');
    const compiled=ts.transpileModule('const selector='+found.getText(source)+';', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    return Function(...Object.keys(context),compiled+'return selector();')(...Object.values(context));
  };
  const actor={role:'viewer',active:true,data_scope:selected},navigation={...scope,profile:actor,payload:null,uniq:values=>[...new Set(values)],sortAutoPanes:values=>values,countryPaneLabelFor:value=>value,DEFAULT_AUTO_COUNTRY_PANES:['印度','巴基斯坦','NPG'],NPG_PANE_LABEL:'NPG'};
  for(const name of ['autoCountryPanes','operatorCountryPanes'])assert.deepEqual(callback('src/components/Dashboard.tsx',name,navigation),['印度']);
  assert.deepEqual(callback('src/components/Dashboard.tsx','autoCountryPanes',{...navigation,profile:{...actor,data_scope:{mode:'selected',countries:[],platforms:[{country:'CO',platform:'A'}]}}}),['NPG']);
  assert.deepEqual(callback('src/components/ThirdPartyVolumeDashboard.tsx','countryTabs',{...scope,profile:actor,countries:[],COUNTRY_NAV_TABS:['印度','巴基斯坦'],sortCountries:values=>values,isHiddenCountry:()=>false}),['印度']);
});
test('platform scope changes affect cache identity even without profile timestamp changes and clear old payloads on verified advance',()=>{
  const win=browser(),current={...viewer,updated_at:'2026-10-10T00:00:00Z',data_scope:{mode:'selected',countries:[],platforms:[{country:'IN',platform:'A'}]}},other={...current,data_scope:{mode:'selected',countries:[],platforms:[{country:'IN',platform:'B'}]}};
  assert.notEqual(scope.dashboardScopeIdentity(current),scope.dashboardScopeIdentity(other));
  client.setDashboardDataViewer(current);client.writeDashboardDataCache('work',{rows:['only-A']},current);
  assert.equal(client.dashboardProfileCanAdvance(other),false,'same-version scope contradictions remain denied');
  assert.equal(client.readDashboardDataCache('work',other),null);
  assert.equal(client.setDashboardDataViewer({...other,updated_at:'2026-10-10T00:01:00Z'}),true);
  assert.equal(client.readDashboardDataCache('work',current),null);assert.equal(Object.keys(win.localStorage).filter(key=>key.startsWith('hensem:scoped-data:')).length,0);
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
test('business fetch validates fresh profile, sends only dedicated Edge Bearer and uses no-store',async()=>{
  const win=browser();client.setDashboardDataViewer(viewer);
  const session={user:{id:viewer.auth_user_id},access_token:'synthetic-token'};
  auth.readSavedDashboardSession=()=>session;auth.ensureDashboardSession=async()=>session;auth.fetchDashboardProfile=async()=>viewer;
  let called=0;global.fetch=async(url,init)=>{called++;const target=new URL(url);assert.equal(target.origin,'https://business-api.fixture.supabase.co');assert.equal(target.pathname,'/functions/v1/dashboard-api');assert.equal(target.searchParams.get('_route'),'/api/work-orders');assert.equal(init.headers.get('apikey'),'fixture-publishable');assert.equal(init.cache,'no-store');assert.equal(init.headers.get('Authorization'),'Bearer synthetic-token');return new Response('{}');};
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
  assert.match(read('ThirdPartyVolumeDashboard.tsx'),/filter\(name=>dashboardScopeMayReadCountry\(scope,name\)\)/);
});
