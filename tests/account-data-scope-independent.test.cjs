const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const ts=require('typescript');
const {root,loadTs}=require('./load-typescript.cjs');
const scope=loadTs(path.join(root,'src/lib/dashboardDataScope.ts'));
const ALL={mode:'all',countries:[]},PANGHU={mode:'selected',countries:['BR_PANGHU']};
const makeProfile=(id='user-a',data_scope=ALL,updated_at='2026-09-12T10:00:00.000Z')=>({auth_user_id:id,username:'fixture',role:'viewer',active:true,data_scope,updated_at});
const makeSession=id=>({access_token:`fixture-${id}`,refresh_token:`fixture-refresh-${id}`,user:{id}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const pause=()=>new Promise(resolve=>setImmediate(resolve));
const readComponent=name=>ts.createSourceFile(name,fs.readFileSync(path.join(root,'src/components',name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function harness(initial=makeProfile()){
  const storage={};Object.defineProperties(storage,{getItem:{value:key=>storage[key]??null},setItem:{value:(key,value)=>storage[key]=String(value)},removeItem:{value:key=>delete storage[key]}});
  const window=new EventTarget();Object.assign(window,{localStorage:storage,location:{origin:'https://dashboard.fixture'}});
  const CustomEvent=class extends Event{constructor(type,options){super(type);this.detail=options.detail;}};
  let session=makeSession(initial.auth_user_id),profileHandler=async()=>initial,httpHandler=async()=>new Response('{}');
  const httpCalls=[],profileCalls=[],applied=[];
  class DashboardHttpError extends Error{constructor(message,status=0,code='http_error'){super(message);this.status=status;this.code=code;}}
  const auth={DashboardHttpError,readSavedDashboardSession:()=>session,ensureDashboardSession:async value=>value,fetchDashboardProfile:async active=>{profileCalls.push(active);return profileHandler(active);}};
  const module={exports:{}};
  const compiled=ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/dashboardDataClient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(compiled,{module,exports:module.exports,require:key=>key.endsWith('dashboardAuthClient')?auth:scope,window,CustomEvent,URL,Headers,Response,Date,console,
    fetch:async(url,init)=>{httpCalls.push({url,init});return httpHandler(url,init);}});
  const client=module.exports;
  // Exercise the real Gate apply function, not a permissive test-only substitute.
  const source=readComponent('DashboardAuthGate.tsx');
  const gate=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='DashboardAuthGate');
  const apply=gate.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='applyAuthenticated');
  const applyCode=ts.transpileModule(apply.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const context={...scope,...client,readSavedDashboardSession:()=>session,saveDashboardSession:value=>{session=value;},sessionRef:{current:session},setSession:()=>{},setProfile:value=>applied.push(value),setRestorePending:()=>{},setAuthWarning:()=>{},setReady:()=>{}};
  const applyAuthenticated=Function(...Object.keys(context),applyCode+'\nreturn applyAuthenticated;')(...Object.values(context));
  const effect=gate.body.statements.find(node=>node.getText(source).includes('const verified=')&&node.getText(source).includes('DASHBOARD_PROFILE_EVENT'));
  assert(effect,'verified-profile listener must remain present');
  const effectCode=ts.transpileModule(effect.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  Function('useEffect','window','DASHBOARD_PROFILE_EVENT','readSavedDashboardSession','applyAuthenticated',effectCode)(callback=>callback(),window,client.DASHBOARD_PROFILE_EVENT,()=>session,applyAuthenticated);
  client.setDashboardDataViewer(initial);
  return {client,window,storage,auth,httpCalls,profileCalls,applied,applyAuthenticated,
    setSession:value=>{session=value;},getSession:()=>session,
    profile:value=>{profileHandler=typeof value==='function'?value:async()=>value;},http:handler=>{httpHandler=handler;},
    event:profile=>window.dispatchEvent(new CustomEvent(client.DASHBOARD_PROFILE_EVENT,{detail:{profile,session}})),
  };
}

test('late old all profile cannot roll back a newer selected Gate state or its cache',async()=>{
  const old=makeProfile(),next=makeProfile('user-a',PANGHU,'2026-09-12T10:01:00.000Z');
  const h=harness(old),wait=deferred();h.profile(()=>wait.promise);
  const request=h.client.dashboardBusinessFetch('/api/work-orders');await pause();
  h.event(next);h.client.writeDashboardDataCache('work',{only:'Panghu'},next);
  wait.resolve(old);
  await assert.rejects(request,error=>h.client.isDashboardDataDenied(error));
  assert.equal(h.applied.length,1);assert.deepEqual(h.applied[0],next);assert.equal(h.httpCalls.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.client.readDashboardDataCache('work',next))),{only:'Panghu'});
  assert.equal(h.client.readDashboardDataCache('work',old),null);
});
test('real Gate rejects a profile version downgrade, missing version and same-version scope contradiction',()=>{
  const current=makeProfile('user-a',PANGHU,'2026-09-12T10:01:00.000Z'),h=harness(current);
  for(const profile of [makeProfile(),{...current,data_scope:ALL},{...current,updated_at:undefined,data_scope:ALL}])h.applyAuthenticated(h.getSession(),profile);
  assert.deepEqual(h.applied,[]);assert.equal(h.client.dashboardProfileCanAdvance(current),true);
  const next={...current,updated_at:'2026-09-12T10:02:00.000Z'};h.applyAuthenticated(h.getSession(),next);assert.deepEqual(h.applied,[next]);
});
test('A→B→A identity sequence still rejects old in-flight HTTP by generation',async()=>{
  const a=makeProfile(),h=harness(a),response=deferred();h.http(()=>response.promise);
  const request=h.client.dashboardBusinessFetch('/api/work-orders');await pause();assert.equal(h.httpCalls.length,1);
  h.client.setDashboardDataViewer(makeProfile('user-b',PANGHU));h.client.setDashboardDataViewer(a);
  response.resolve(new Response('{"rows":["old-scope"]}'));
  await assert.rejects(request,error=>h.client.isDashboardDataDenied(error));
});
test('switching account or logging out while profile verification runs does not dispatch data HTTP',async()=>{
  for(const replacement of [null,makeSession('user-b')]){
    const h=harness(),pending=deferred();h.profile(()=>pending.promise);
    const request=h.client.dashboardBusinessFetch('/api/work-orders');await pause();h.setSession(replacement);pending.resolve(makeProfile());
    await assert.rejects(request,error=>h.client.isDashboardDataDenied(error));assert.equal(h.httpCalls.length,0);assert.deepEqual(h.applied,[]);
  }
});
test('parallel module requests share profile verification and keep no-store plus no redirects',async()=>{
  const profile=makeProfile('user-a',PANGHU),h=harness(profile),pending=deferred();h.profile(()=>pending.promise);
  const calls=['work-orders','auto-withdraw','customer-service'].map(name=>h.client.dashboardBusinessFetch(`/api/${name}`,{headers:{Authorization:'must-be-replaced'}}));
  await pause();assert.equal(h.profileCalls.length,1);pending.resolve(profile);await Promise.all(calls);
  assert.equal(h.httpCalls.length,3);
  for(const {url,init} of h.httpCalls){assert.equal(new URL(url).origin,h.window.location.origin);assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.headers.get('Authorization'),`Bearer ${h.getSession().access_token}`);}
});
test('external/non API requests never see session or profile calls; permission denial stays typed',async()=>{
  const h=harness();
  for(const url of ['https://elsewhere.fixture/api/work-orders','//elsewhere.fixture/api/work-orders','/not-an-api'])await assert.rejects(h.client.dashboardBusinessFetch(url),error=>h.client.isDashboardDataDenied(error));
  assert.equal(h.profileCalls.length,0);assert.equal(h.httpCalls.length,0);
  for(const status of [401,403]){h.http(async()=>new Response('{}',{status}));await assert.rejects(h.client.dashboardBusinessFetch('/api/work-orders'),error=>h.client.isDashboardDataDenied(error)&&error.status===status);}
});
test('cache is account/scope/version isolated, clears legacy data only, and permits authoritative empty results',()=>{
  const a=makeProfile(),b=makeProfile('user-b',PANGHU),h=harness(a);
  h.storage.setItem('hensem:last-good:any-v1','old-global');h.storage.setItem('hensem:dashboard:auth-session:v2','login-preserved');h.storage.setItem('unrelated-preference','preserved');
  h.client.writeDashboardDataCache('work',{rows:['A']},a);
  h.client.setDashboardDataViewer(b);
  assert.equal(h.storage.getItem('hensem:last-good:any-v1'),null);assert.equal(h.client.readDashboardDataCache('work',a),null);
  h.client.writeDashboardDataCache('work',{rows:['late-A']},a);assert.equal(h.client.readDashboardDataCache('work',b),null);
  h.client.writeDashboardDataCache('work',{rows:[]},b);assert.deepEqual(JSON.parse(JSON.stringify(h.client.readDashboardDataCache('work',b))),{rows:[]});
  h.client.setDashboardDataViewer(null);assert.equal(h.client.readDashboardDataCache('work',b),null);
  assert.equal(h.storage.getItem('hensem:dashboard:auth-session:v2'),'login-preserved');assert.equal(h.storage.getItem('unrelated-preference'),'preserved');
});

function componentLoader(name,dependencies){
  const source=readComponent(name),component=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name.replace('.tsx',''));
  const fn=component.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='loadData');assert(fn);
  const code=ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  return Function(...Object.keys(dependencies),code+'\nreturn loadData;')(...Object.values(dependencies));
}
test('five actual component loadData denial branches clear results without touching fallback caches',async()=>{
  for(const name of ['Dashboard.tsx','WorkOrderDashboard.tsx','CustomerServiceDashboard.tsx','ThirdPartyVolumeDashboard.tsx','ThirdPartyRatesDashboard.tsx']){
    const h=harness(),error=new h.auth.DashboardHttpError('fixture denied',403,'data_scope_denied'),set=[],refs={current:{rows:['old-data']}};
    const forbidden=()=>{throw Error('Denied request must not read/write cache or fallback');};
    const dependencies={...scope,profile:makeProfile('user-a',PANGHU),payload:{rows:['old-data']},ratePayload:{rates:[]},payloadRef:refs,
      setState:()=>{},setError:()=>{},setPayload:value=>set.push(value),setRatePayload:()=>{},setVolumeSyncStatus:()=>{},setDataNotice:()=>{},
      monthlyApiUrl:()=>'/api/work-orders',thirdPartyVolumeApiUrl:()=>'/api/supabase-third-party-volume',thirdPartySyncStatusApiUrl:()=>'/api/status',
      ratePayloadFresh:()=>true,THIRD_PARTY_RATES_CACHE_KEY:'rate',THIRD_PARTY_VOLUME_CACHE_KEY:'volume',dashboardBusinessFetch:async()=>{throw error;},
      isDashboardDataDenied:h.client.isDashboardDataDenied,readWorkLocalCache:forbidden,readAutoLocalCache:forbidden,readLocalCache:forbidden,
      writeWorkLocalCache:forbidden,writeAutoLocalCache:forbidden,writeLocalCache:forbidden,attachClientFallbackMessage:forbidden};
    await componentLoader(name,dependencies)(false,'2026-09-10','2026-09-10');assert.deepEqual(set,[null],name);
    if(name!=='CustomerServiceDashboard.tsx'&&name!=='ThirdPartyRatesDashboard.tsx')assert.equal(refs.current,null,name);
  }
});
function variableInitializer(source,name){let found;function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)found=node.initializer;ts.forEachChild(node,visit);}visit(source);assert(found,name);return found.getText(source);}
test('actual automatic/operator/volume fixed tabs show only Panghu for selected scope, including before first query',()=>{
  const profile=makeProfile('user-a',PANGHU),auto=readComponent('Dashboard.tsx');
  const context={...scope,useMemo:callback=>callback(),profile,payload:null,uniq:values=>[...new Set(values)],sortAutoPanes:values=>values,countryPaneLabelFor:value=>value,
    PANGHU_BRAZIL_PANE_LABEL:'胖虎巴西盘口',NPG_PANE_LABEL:'NPG盘口'};
  context.DEFAULT_AUTO_COUNTRY_PANES=Function(...Object.keys(context),`return ${variableInitializer(auto,'DEFAULT_AUTO_COUNTRY_PANES')}`)(...Object.values(context));
  for(const name of ['autoCountryPanes','operatorCountryPanes']){
    const expression=ts.transpileModule(`const value=${variableInitializer(auto,name)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    assert.deepEqual(Function(...Object.keys(context),expression+'return value;')(...Object.values(context)),['胖虎巴西盘口']);
  }
  const volume=readComponent('ThirdPartyVolumeDashboard.tsx'),vcontext={...scope,useMemo:callback=>callback(),profile,countries:['巴西','胖虎巴西','越南'],isHiddenCountry:()=>false,sortCountries:values=>values,ALL_USDT_COUNTRY_PAGE:'所有国家USDT'};
  vcontext.COUNTRY_NAV_TABS=Function(...Object.keys(vcontext),`return ${variableInitializer(volume,'COUNTRY_NAV_TABS')}`)(...Object.values(vcontext));
  const expression=ts.transpileModule(`const value=${variableInitializer(volume,'countryTabs')};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  assert.deepEqual(Function(...Object.keys(vcontext),expression+'return value;')(...Object.values(vcontext)),['胖虎巴西']);
});
test('Gate subtree key is the full account/scope/version identity, not just a shared module key',()=>{
  const source=readComponent('DashboardAuthGate.tsx');let fragment;
  function visit(node){if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(source)==='Fragment')fragment=node;ts.forEachChild(node,visit);}visit(source);
  const key=fragment?.openingElement.attributes.properties.find(prop=>prop.name?.text==='key');assert.equal(key?.initializer?.expression?.getText(source),'dashboardScopeIdentity(profile)');
  const a=makeProfile(),b=makeProfile('user-b'),narrow=makeProfile('user-a',PANGHU,'2026-09-12T10:01:00.000Z');
  assert.equal(new Set([a,b,narrow].map(scope.dashboardScopeIdentity)).size,3);
});

function actualFees(){
  const source=readComponent('ThirdPartyVolumeDashboard.tsx');
  const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text!=='ThirdPartyVolumeDashboard');
  const dependencies={exports:{},SOUTH_AMERICA_RATE_COUNTRIES:['墨西哥','哥伦比亚','智利'],ALL_USDT_COUNTRY_PAGE:'所有国家USDT',
    ...loadTs(path.join(root,'src/lib/thirdPartyNameMap.ts')),...loadTs(path.join(root,'src/lib/thirdPartyPlatform.ts')),...loadTs(path.join(root,'src/lib/platformDisplayCountry.ts')),...loadTs(path.join(root,'src/lib/format.ts'))};
  const compiled=ts.transpileModule(functions.map(fn=>fn.getText(source)).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  return Function('require',...Object.keys(dependencies),compiled+'\nreturn {buildRateMap,findMatchedRate,mergeRateLike,rateFor,singleFeeFor,rateHasSideFee,estimateSideFee};')(require,...Object.values(dependencies));
}
const feeFixture=(platform='776F',extra={})=>({id:`fixture-${platform}`,country:'胖虎巴西',platform,thirdParty:'JYPay',category:'PIX',collectFee:'1.25%',payoutFee:'0.50%',totalFee:'1.75%',collectSingleFee:'0.10',payoutSingleFee:'0.20',collectLimit:'',payoutLimit:'',sheetName:'fixture',status:'开启',...extra});
test('restricted actual fee map preserves only visible platform fees and does not create generic keys',()=>{
  const api=actualFees(),record=feeFixture(),before=structuredClone(record),map=api.buildRateMap([], [record],true);
  const result=api.findMatchedRate(map,'胖虎巴西','776F','JYPay','PIX','collect');
  assert(result);assert.equal(result.scopePlatformOnly,true);assert.equal(result.collectFee,'1.25%');assert.equal(result.payoutFee,'0.50%');
  assert.equal(api.rateFor(result,'collect'),0.0125);assert.equal(api.singleFeeFor(result,'collect'),0.10);assert.equal(api.estimateSideFee(1000,20,api.rateFor(result,'collect'),api.singleFeeFor(result,'collect')),14.5);
  for(const platform of ['VIP345','776F2','other-platform',''])assert.equal(api.findMatchedRate(map,'胖虎巴西',platform,'JYPay','PIX','collect'),undefined,platform);
  for(const key of map.keys())assert(key.split('|||')[1],'scope-only map must not contain blank-platform keys');
  assert.deepEqual(record,before);
});
test('restricted fee merges keep platform-only marker and missing side fee never borrows from another platform',()=>{
  const api=actualFees();
  const incomplete=feeFixture('776F',{collectFee:'',collectSingleFee:'',totalFee:''});
  const other=feeFixture('VIP345',{collectFee:'8.5%',collectSingleFee:'99'});
  const duplicate=feeFixture('776F',{collectFee:'',collectSingleFee:'',totalFee:''});
  const map=api.buildRateMap([], [incomplete,duplicate,other],true);
  const result=api.findMatchedRate(map,'胖虎巴西','776F','JYPay','PIX','collect');
  assert(result);assert.equal(result.scopePlatformOnly,true);assert.equal(api.rateHasSideFee(result,'collect'),false);assert.equal(result.collectFee,'');assert.equal(result.collectSingleFee,'');
  for(const value of map.values())assert.equal(value.scopePlatformOnly,true);
});
test('legacy all-account country-wide fee behavior remains intact',()=>{
  const api=actualFees(),row=feeFixture('',{country:'巴西'}),map=api.buildRateMap([row],[]);
  const result=api.findMatchedRate(map,'胖虎巴西','776F','JYPay','PIX','collect');assert(result);assert.equal(result.collectFee,'1.25%');assert.equal(result.scopePlatformOnly,undefined);
});
test('explicit scoped zero fees stay configured zero and are not replaced by another platform fee',()=>{
  const api=actualFees(),zero=feeFixture('776F',{collectFee:'0%',collectSingleFee:'0',payoutFee:'0%',payoutSingleFee:'0',totalFee:'0%'});
  const map=api.buildRateMap([], [zero,feeFixture('VIP345',{collectFee:'8.5%'})],true);
  const result=api.findMatchedRate(map,'胖虎巴西','776F','JYPay','PIX','collect');
  assert(result);assert.equal(api.rateHasSideFee(result,'collect'),true);assert.equal(api.rateFor(result,'collect'),0);assert.equal(api.singleFeeFor(result,'collect'),0);assert.equal(result.collectFee,'0%');
});
test('scope-only matching does not treat unregistered platform punctuation variants as the same platform',()=>{
  const api=actualFees(),map=api.buildRateMap([], [feeFixture()],true);
  for(const platform of ['776-F','776F-BRL'])assert.equal(api.findMatchedRate(map,'胖虎巴西',platform,'JYPay','PIX','collect'),undefined,platform);
});
