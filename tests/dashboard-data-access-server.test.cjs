const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const nativeRequire = createRequire(path.join(root, 'package.json'));
const other = 'SYNTHETIC_UNAUTHORIZED_DATA';
const routes = ['auto-withdraw','work-orders','customer-service','monthly-status','third-party-monthly-status','debug-snapshots','debug-auto-withdraw','debug-third-party','snapshot-refresh','supabase-third-party-volume','supabase-third-party-rates','supabase-third-party-sync-status','supabase-status'];
function profile(overrides = {}) {
  return {auth_user_id:'synthetic-user', username:'synthetic', role:'viewer', active:true,
    permissions:{auto_withdraw:true,work_orders:true,customer_service:true,third_party:true},
    data_scope:{mode:'selected',countries:['BR_PANGHU']},updated_at:'2026-09-12T00:00:00Z',...overrides};
}
const meta = {year:'2026',month:'7',updatedAt:'2026-09-10T00:00:00Z',source:'google-sheet',message:other,sheets:[other],rawSourceId:other,monthlySnapshots:[{rows:999,checksum:other}]};
function fixtures() {
  const scopes = [['巴西','776F'],['胖虎巴西','POPNOV'],['越南','FOREIGN']];
  const autoRows = scopes.map(([country,platform], i) => ({country,platform,date:'2026-07-11',total:10+i,success:8,rejected:2+i,autoCount:3,manualCount:7+i,successRate:.8,rejectRate:.2,autoRate:.3,manualRate:.7,avgTime:'3秒',yesterdayAvgTime:'2秒',comparePercent:'50%',sourceSheet:i ? other : 'authorized-sheet',unknown:other,previousDay:{date:'2026-07-10',total:9,success:7,rejected:2,autoCount:2,manualCount:7,secret:other}}));
  const workRows = scopes.map(([country,platform], i) => ({id:'work-'+i,country,platform,date:'2026-07-11',total:10+i,success:8,failed:1,pending:1,amount:12.75+i,workType:'synthetic-type',workName:'synthetic-name',operator:'synthetic-operator',sourceSheet:i ? other:'authorized-sheet',status:'自动 3 · 人工 7',sourceRow:i+1,kind:'daily',unknown:other}));
  const customerRows = scopes.map(([country,platform],i) => ({id:'customer-'+i,country,platform,date:'2026-07-11',sheetName:i ? other:'authorized-sheet',sourceRow:i+1,staff:'staff',team:'team',metricName:'metric',metricValue:4.25+i,rawText:String(4.25+i),fields:{foreign:other},unknown:other}));
  return {
    'auto-withdraw':{meta:structuredClone(meta),dailyRows:autoRows,monthlyRows:autoRows,operatorRows:scopes.map(([country,platform],i)=>({country,platform,date:'2026-07-11',account:'synthetic-operator',processed:10+i,rejected:2,avgTime:'3秒',unknown:other}))},
    'work-orders':{meta:structuredClone(meta),rows:workRows,summary:{amount:99999},anomalies:[other]},
    'customer-service':{meta:structuredClone(meta),rows:customerRows,summary:{metricTotal:99999}},
  };
}
function harness(initialProfile = profile(), env = {}) {
  const state = {profile:initialProfile,authStatus:200,profileStatus:200,authUser:{id:'synthetic-user',user_metadata:{role:'owner',data_scope:{mode:'all',countries:[]}}},dataReads:0,jobs:0,requests:[],payloads:fixtures(),db:{},rpc:{rows:[]}};
  const environment = {NEXT_PUBLIC_SUPABASE_URL:'https://scope-preview.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-synthetic',...env};
  const mocks = {
    '@/lib/monthlySnapshotStore':{
      currentMonthKey:()=> '2026_09',previousMonthKey:()=> '2026_08',isSettlementMonth:()=>false,
      requestedMonthsFromUrl:url=>[(url.searchParams.get('month')||'2026_07').replace('-','_')],
      readCombinedMonthlyPayload:async key=>{state.dataReads++;return structuredClone(state.payloads[key]??null);},
      writeMonthlySnapshot:async()=>{state.jobs++;},missingMonthlySnapshotMonths:async()=>[],
      readMonthlyCheckStatus:async()=>{state.dataReads++;return {rows:999,message:other};},
      defaultDashboardMonths:()=>['2026_07'],MONTHLY_MODULE_KEYS:[],
    },
    '@/lib/snapshotStore':{countSnapshotPayloadRows:()=>1,isSnapshotPayloadUsable:()=>true,readSnapshotCursor:async()=>{state.dataReads++;return {message:other};},SNAPSHOT_KEYS:[]},
    '@/lib/thirdPartyMonthlySync':{readLatestThirdPartyMonthlyJobStatus:async()=>{state.dataReads++;return {message:other};},queueThirdPartyMonthlyJob:async()=>{state.jobs++;return {ok:true};}},
    '@/lib/netlifyFunctionQueue':{queueNetlifyBackgroundFunction:async()=>{state.jobs++;return {ok:true};}},
    '@/lib/snapshotSync':{getSnapshotModuleKeys:()=>['auto-withdraw','work-orders','third-party-volume','customer-service'],refreshSnapshotModule:async()=>{state.jobs++;return {ok:true};}},
    '@/lib/googleSheets':{getAutoWithdrawPayload:async()=>{state.dataReads++;return state.payloads['auto-withdraw'];},getThirdPartyVolumePayload:async()=>{state.dataReads++;return {rows:[],meta:{},summary:{}};},getThirdPartyRatePayload:async()=>{state.dataReads++;return {rates:[],platformStatuses:[],meta:{}};},getCustomerServicePayload:async()=>{state.dataReads++;return state.payloads['customer-service'];}},
  };
  const modules = new Map();
  const fetch = async (input, init={}) => {
    const url = new URL(String(input));state.requests.push({path:url.pathname,query:url.searchParams,init});
    assert.equal(url.origin,'https://scope-preview.invalid','no real network request permitted');
    if(url.pathname==='/auth/v1/user')return Response.json(state.authUser,{status:state.authStatus});
    if(url.pathname==='/rest/v1/dashboard_profiles')return Response.json([state.profile],{status:state.profileStatus});
    state.dataReads++;
    if(url.pathname.startsWith('/rest/v1/rpc/'))return Response.json(state.rpc);
    const name=url.pathname.split('/').pop();
    if(Object.hasOwn(state.db,name))return Response.json(state.db[name]);
    throw new Error('unexpected synthetic network request');
  };
  function load(file) {
    file=path.resolve(root,file);if(modules.has(file))return modules.get(file).exports;
    const module={exports:{}};modules.set(file,module);
    const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const require = specifier => {
      if(Object.hasOwn(mocks,specifier))return mocks[specifier];
      const resolved=specifier.startsWith('@/')?path.join(root,'src',specifier.slice(2)):specifier.startsWith('.')?path.resolve(path.dirname(file),specifier):null;
      const absoluteMock=resolved&&'@/'+path.relative(path.join(root,'src'),resolved);
      if(absoluteMock&&Object.hasOwn(mocks,absoluteMock))return mocks[absoluteMock];
      if(resolved&&fs.existsSync(resolved+'.ts'))return load(resolved+'.ts');
      return nativeRequire(specifier);
    };
    new Function('require','module','exports','fetch','process',compiled)(require,module,module.exports,fetch,{...process,env:environment});
    return module.exports;
  }
  return {state,load,request:(route,params='',headers={Authorization:'Bearer synthetic-session'},method='GET')=>new Request('https://website-preview.invalid/api/'+route+params,{headers,method}),route:name=>load('src/app/api/'+name+'/route.ts'),api:()=>load('src/lib/dashboardDataAccessServer.ts')};
}
function privateResponse(response) {
  assert.match(response.headers.get('cache-control'),/private.*no-store/);
  assert.match(response.headers.get('netlify-cdn-cache-control'),/no-store/);
  assert.match(response.headers.get('cdn-cache-control'),/no-store/);
  assert.match(response.headers.get('vary'),/Authorization/);
  assert.equal(response.headers.get('etag'),null);
}
for(const route of routes)test('anonymous cannot read or queue '+route,async()=>{
  const h=harness();const res=await h.route(route).GET(h.request(route,'?month=2026-07&module=auto-withdraw',{}));
  assert.equal(res.status,401);privateResponse(res);assert.equal(h.state.dataReads,0);assert.equal(h.state.jobs,0);assert.equal(h.state.requests.length,0);
});
for(const route of ['auto-withdraw','work-orders','customer-service'])test('historical '+route+' filters exact group and removes global metadata',async()=>{
  const h=harness(), before=structuredClone(h.state.payloads);const res=await h.route(route).GET(h.request(route,'?month=2026-07',{'Authorization':'Bearer synthetic-session','if-none-match':'old-shared-etag'}));
  assert.equal(res.status,200);privateResponse(res);const data=await res.json();
  const rows=data.dailyRows||data.rows;assert.equal(rows.length,1);assert.equal(rows[0].platform,'776F');assert.equal(rows[0].country,'胖虎巴西');
  assert.doesNotMatch(JSON.stringify(data),new RegExp(other));assert.deepEqual(h.state.payloads,before);
  if(route==='auto-withdraw'){assert.equal(data.operatorRows.length,1);assert.equal(data.monthlyRows.length,1);assert.equal(data.dailyRows[0].total,10);assert.equal(data.dailyRows[0].previousDay.total,9);}
  if(route==='work-orders'){assert.equal(data.summary.amount,12.75);assert.equal(data.summary.total,10);assert.equal(data.summary.success,8);}
  if(route==='customer-service'){assert.equal(data.summary.metricTotal,4.25);assert.equal(data.summary.platforms,1);}
});
test('all legacy accounts keep unchanged full historical business payloads',async()=>{
  for(const role of ['owner','admin','viewer'])for(const route of ['auto-withdraw','work-orders','customer-service']){
    const h=harness(profile({role,data_scope:null}));const res=await h.route(route).GET(h.request(route));
    assert.equal(res.status,200);assert.deepEqual(await res.json(),h.state.payloads[route]);privateResponse(res);
  }
});
test('malformed explicit scope is empty, but owner remains all and disabled owner is denied',async()=>{
  for(const value of ['BR_PANGHU',{mode:'all',countries:['BR']},{mode:'selected',countries:['UNKNOWN']}]){
    const h=harness(profile({data_scope:value}));const res=await h.route('work-orders').GET(h.request('work-orders'));
    assert.equal(res.status,200);assert.deepEqual((await res.json()).rows,[]);
  }
  const h=harness(profile({role:'owner',active:false}));assert.equal((await h.route('work-orders').GET(h.request('work-orders'))).status,403);
});
test('fresh profile applies scope shrink across requests and client claims cannot grant owner',async()=>{
  const h=harness(profile({data_scope:null}));let res=await h.route('work-orders').GET(h.request('work-orders'));assert.equal((await res.json()).rows.length,3);
  h.state.profile.data_scope={mode:'selected',countries:['BR_PANGHU']};
  res=await h.route('work-orders').GET(h.request('work-orders','?scope=all&role=owner'));assert.equal((await res.json()).rows.length,1);
  assert.equal(h.state.requests.filter(r=>r.path==='/auth/v1/user').length,2);
  const requests=h.state.requests.filter(r=>r.path==='/rest/v1/dashboard_profiles');assert.equal(requests.length,2);
  for(const request of requests){assert.match(request.query.get('select'),/data_scope,updated_at/);assert.equal(request.query.get('auth_user_id'),'eq.synthetic-user');assert.equal(request.init.cache,'no-store');}
});
test('one Request shares verification without caching across requests',async()=>{
  const h=harness(),request=h.request('work-orders'),api=h.api();
  await Promise.all([api.requireDashboardDataAccess(request,'work_orders'),api.requireDashboardDataAccess(request,'auto_withdraw')]);
  assert.equal(h.state.requests.length,2);await api.requireDashboardDataAccess(h.request('work-orders'));assert.equal(h.state.requests.length,4);
});
for(const [route,module]of [['work-orders','work_orders'],['customer-service','customer_service'],['auto-withdraw','auto_withdraw'],['supabase-third-party-volume','third_party'],['supabase-status','third_party']])test('module revocation blocks '+route+' for viewer and admin',async()=>{
  for(const role of ['viewer','admin']){
    const h=harness(profile({role,permissions:{[module]:false},data_scope:null}));const res=await h.route(route).GET(h.request(route));assert.equal(res.status,403);privateResponse(res);assert.equal(h.state.dataReads,0);
  }
});
test('missing or malformed non-owner module grants never inherit client defaults',async()=>{
  for(const role of ['viewer','admin'])for(const permissions of [undefined,null,{},'true',{third_party:'true'},{third_party:1}]){
    const h=harness(profile({role,permissions,data_scope:null}));const res=await h.route('supabase-third-party-volume').GET(h.request('supabase-third-party-volume'));
    assert.equal(res.status,403);assert.equal(h.state.dataReads,0);privateResponse(res);
  }
  const h=harness(profile({role:'owner',permissions:null,data_scope:null}));
  assert.equal(h.api().dashboardModuleAllowed(h.state.profile,'third_party'),true);
});
test('restricted auto projection preserves every declared business field and previous-day count',()=>{
  const h=harness(),api=h.api(),original=h.state.payloads['auto-withdraw'];
  const projected=api.scopeAutoWithdrawPayload({profile:h.state.profile,scope:h.state.profile.data_scope,token:'synthetic'},original);
  const expected=structuredClone(original.dailyRows[0]);delete expected.unknown;delete expected.previousDay.secret;expected.country='胖虎巴西';
  assert.deepEqual(projected.dailyRows[0],expected);assert.deepEqual(projected.monthlyRows[0],expected);
  // Keep the property allowlist aligned with the actual type declarations.
  const source=ts.createSourceFile('types.ts',fs.readFileSync(path.join(root,'src/lib/types.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  const declared=name=>source.statements.find(s=>ts.isTypeAliasDeclaration(s)&&s.name.text===name).type.members.map(m=>m.name.text);
  for(const key of declared('AutoWithdrawCounts'))assert.ok(Object.hasOwn(projected.dailyRows[0].previousDay,key),key);
  for(const key of declared('AutoWithdrawRow'))assert.ok(Object.hasOwn(projected.dailyRows[0],key),key);
});
test('scoped customer metric never returns legacy whole-row rawText through either field',()=>{
  const h=harness(),api=h.api(),payload=h.state.payloads['customer-service'];
  payload.rows[0].rawText='776F 4.25 '+other+' another-platform 999999';
  payload.rows[0].fields={metric:'4.25',another_platform:other};
  const before=structuredClone(payload);
  const scoped=api.scopeCustomerServicePayload({profile:h.state.profile,scope:h.state.profile.data_scope,token:'synthetic'},payload);
  assert.equal(scoped.rows.length,1);assert.equal(scoped.rows[0].rawText,'4.25');assert.equal(scoped.rows[0].fields.metric,'4.25');
  assert.equal(scoped.rows[0].metricValue,4.25);assert.equal(scoped.summary.metricTotal,4.25);assert.doesNotMatch(JSON.stringify(scoped),new RegExp(other));
  assert.deepEqual(payload,before);
  assert.equal(api.scopeCustomerServicePayload({profile:h.state.profile,scope:{mode:'all',countries:[]},token:'synthetic'},payload),payload);
});
for(const route of ['monthly-status','third-party-monthly-status','supabase-third-party-sync-status','supabase-status'])test('restricted accounts never receive global '+route,async()=>{
  const h=harness();const res=await h.route(route).GET(h.request(route,'?module=work-orders'));assert.equal(res.status,403);privateResponse(res);assert.equal(h.state.dataReads,0);assert.doesNotMatch(await res.text(),new RegExp(other));
});
for(const route of ['debug-snapshots','debug-auto-withdraw','debug-third-party'])test('diagnostic '+route+' is owner-only even for all-data admins',async()=>{
  const h=harness(profile({role:'admin',data_scope:null}));const res=await h.route(route).GET(h.request(route));assert.equal(res.status,403);assert.equal(h.state.dataReads,0);privateResponse(res);
});
test('refresh denies same-origin anonymous and preserves the dedicated scheduler credential',async()=>{
  let h=harness();let res=await h.route('snapshot-refresh').POST(h.request('snapshot-refresh','?module=auto-withdraw',{Origin:'https://website-preview.invalid','sec-fetch-site':'same-origin'},'POST'));
  assert.equal(res.status,401);assert.equal(h.state.jobs,0);
  h=harness(profile(),{SNAPSHOT_REFRESH_TOKEN:'synthetic-internal-only'});
  res=await h.route('snapshot-refresh').POST(h.request('snapshot-refresh','?module=auto-withdraw',{'x-refresh-token':'synthetic-internal-only'},'POST'));
  assert.equal(res.status,200);assert.equal(h.state.jobs,1);assert.equal(h.state.requests.length,0);privateResponse(res);
});
test('web refresh requires global scope and refresh capability, not same origin',async()=>{
  for(const p of [profile(),profile({role:'admin'}),profile({role:'admin',data_scope:null,management_permissions:{refresh_data:false}})]){
    const h=harness(p);const res=await h.route('snapshot-refresh').POST(h.request('snapshot-refresh','?module=auto-withdraw',undefined,'POST'));assert.equal(res.status,403);assert.equal(h.state.jobs,0);
  }
  const h=harness(profile({role:'admin',data_scope:null,management_permissions:{refresh_data:true}}));const res=await h.route('snapshot-refresh').POST(h.request('snapshot-refresh','?module=auto-withdraw',undefined,'POST'));assert.equal(res.status,200);assert.equal(h.state.jobs,1);
});
test('web refresh cannot expose a module whose read permission is absent',async()=>{
  for(const params of ['?module=auto-withdraw','']){
    const h=harness(profile({role:'admin',data_scope:null,permissions:{third_party:true},management_permissions:{refresh_data:true}}));
    const res=await h.route('snapshot-refresh').POST(h.request('snapshot-refresh',params,undefined,'POST'));
    assert.equal(res.status,403);assert.equal(h.state.jobs,0);assert.equal(h.state.dataReads,0);privateResponse(res);
  }
  const h=harness(profile({role:'admin',data_scope:null,permissions:{third_party:true},management_permissions:{refresh_data:true}}));
  const res=await h.route('snapshot-refresh').POST(h.request('snapshot-refresh','?module=third-party-volume',undefined,'POST'));
  assert.equal(res.status,202);assert.equal(h.state.jobs,1);
});
test('work-order refresh flag cannot queue a global source read for a restricted user',async()=>{
  const h=harness();const res=await h.route('work-orders').GET(h.request('work-orders','?month=2026-09&refresh=1'));assert.equal(res.status,403);assert.equal(h.state.jobs,0);assert.equal(h.state.dataReads,0);
});
test('database rows are scope-filtered defensively even if upstream RLS returns all',async()=>{
  const h=harness();h.state.db.auto_withdraw_daily=[{id:'a',data_date:'2026-09-10',country:'巴西',platform:'776F',total:10,success:8,rejected:2,auto_count:3,manual_count:7,avg_seconds:3},{id:'b',data_date:'2026-09-10',country:'巴西',platform:'POPNOV',total:1000000}];h.state.db.withdraw_operator_daily=[];
  const res=await h.route('auto-withdraw').GET(h.request('auto-withdraw','?month=2026-09&start=2026-09-10&end=2026-09-10'));assert.equal(res.status,200);const data=await res.json();assert.equal(data.dailyRows.length,1);assert.equal(data.dailyRows[0].total,10);assert.equal(data.monthlyRows[0].total,10);
});
test('volume RPC null-country results and raw fields cannot bypass scope',async()=>{
  const h=harness();h.state.rpc={latestWriteAt:other,rows:[{id:'a',country:'巴西',platform:'776F',data_date:'2026-09-10',amount:12.75,count:4,raw:{secret:other}},{id:'b',country:'巴西',platform:'POPNOV',amount:1000000,raw:{secret:other}}]};
  const res=await h.route('supabase-third-party-volume').GET(h.request('supabase-third-party-volume'));assert.equal(res.status,200);const data=await res.json();assert.equal(data.rows.length,1);assert.equal(data.summary.amount,12.75);assert.equal(data.summary.count,4);assert.doesNotMatch(JSON.stringify(data),new RegExp(other));
  const denied=await h.route('supabase-third-party-volume').GET(h.request('supabase-third-party-volume','?country='+encodeURIComponent('巴西')));assert.equal(denied.status,403);
});
test('rates filter platform statuses and never lend ordinary-Brazil rows to Panghu',async()=>{
  const h=harness();h.state.db.third_party_rates=[{id:'r',country:'巴西',third_party:other}];h.state.db.third_party_platform_status=[{id:'a',country:'巴西',platform:'776F',third_party:'synthetic-pay',collect_fee:'1%'},{id:'b',country:'胖虎巴西',platform:'POPNOV',third_party:other}];
  const res=await h.route('supabase-third-party-rates').GET(h.request('supabase-third-party-rates'));assert.equal(res.status,200);const data=await res.json();assert.equal(data.rates.length,0);assert.equal(data.platformStatuses.length,1);assert.equal(data.platformStatuses[0].collectFee,'1%');assert.equal(data.summary.totalPlatforms,1);assert.doesNotMatch(JSON.stringify(data),new RegExp(other));
});
test('auth outages and disabled profiles fail closed with fixed private errors',async()=>{
  for(const [field,value,status]of [['authStatus',401,401],['authStatus',500,503],['profileStatus',403,403]]){
    const h=harness();h.state[field]=value;const res=await h.route('work-orders').GET(h.request('work-orders'));assert.equal(res.status,status);privateResponse(res);assert.equal(h.state.dataReads,0);assert.doesNotMatch(await res.text(),new RegExp(other));
  }
  const h=harness(profile({active:'true'}));assert.equal((await h.route('work-orders').GET(h.request('work-orders'))).status,403);
});
test('all monthly response variants are private with no shared ETag',()=>{
  const h=harness(),api=h.load('src/lib/monthlyApiResponse.ts');
  for(const months of [['2026_04'],['2026_09'],[]])for(const archived of [true,false]){
    const headers=api.monthlyResponseHeaders(months,'old-etag',archived);assert.match(headers['Cache-Control'],/private.*no-store/);assert.equal(headers.ETag,undefined);
  }
});
