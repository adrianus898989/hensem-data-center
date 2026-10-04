// Offline bridge regression tests. No production API, session or order data is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/adminLiveBridge.ts');
const sourceText = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(sourceText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const session = { user: { id: 'offline-user' }, access_token: 'offline-old-token', refresh_token: 'offline-refresh' };
const query = { action: 'query', platformId: '11111111-1111-4111-8111-111111111111', startAt: '2026-09-22T00:00:00Z', endAt: '2026-09-23T00:00:00Z', limit: 20, offset: 0 };
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject;const promise = new Promise((a,b) => {resolve=a;reject=b;});return { promise,resolve,reject }; };
function load(options = {}) {
  const module = { exports: {} }, calls = [], listeners = new Set(), timers = new Map(); let timerId=0;
  let now=options.now??Date.now();class ClockDate extends Date {static now(){return now;}}
  const target = { location:{origin:'https://dashboard.invalid'}, addEventListener: (name,fn) => {assert.equal(name,'message');listeners.add(fn);}, removeEventListener: (name,fn) => listeners.delete(fn) };
  const authCalls = [];
  vm.runInNewContext(compiled, { module,exports:module.exports,URL,AbortController,Date:ClockDate,window:target,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: options.base || 'https://offline.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key' } },
    require: name => {
      if(['./adminConfigurationRequest','./adminWorkorderRecordsRequest','./depositStatisticsRequest','./portalOperationLogsRequest'].includes(name)) {
        const helper={exports:{}};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/lib/'+name.slice(2)+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:helper,exports:helper.exports});
        return helper.exports;
      }
      assert.equal(name,'./dashboardAuthClient');return { ensureDashboardSession: async current => {authCalls.push(current);return options.ensure ? options.ensure(current) : {...current,access_token:'offline-fresh-token'};} };
    },
    fetch: async (url,init) => {calls.push({url,init});return options.fetch ? options.fetch(url,init) : {ok:true,json:async()=>({rows:[],total:0})};},
    setTimeout:(callback,ms) => {const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id)
  }, {filename});
  return {api:module.exports,calls,authCalls,listeners,timers,target,now:()=>now,advance:ms=>now+=ms,send:event=>[...listeners].forEach(fn=>fn(event))};
}
function bridge(h) {
  const replies = [], child = {postMessage:(data,origin)=>replies.push({data,origin})};let currentSource=child,currentChannel='offline-channel';
  const cleanup=h.api.installAdminLiveBridge({source:()=>currentSource,channel:()=>currentChannel,session,target:h.target});
  const event=(id='request_1',request=query)=>({source:child,origin:'null',data:{type:h.api.LIVE_REQUEST,id,channel:currentChannel,request}});
  return {replies,child,event,cleanup,replaceSource:value=>currentSource=value,replaceChannel:value=>currentChannel=value};
}

test('request validation rejects unknown methods, fields, dates, oversized filters and paging values',()=>{
  const {api}=load();assert.equal(api.validateAdminLiveRequest(query).limit,20);
  for(const input of [null,[],{}, {...query,action:'execute_sql'}, {...query,token:'ignored'}, {...query,platformId:'all'}, {...query,startAt:'2026-09-22'}, {...query,endAt:query.startAt}, {...query,endAt:'2026-11-23T00:00:00Z'}, {...query,direction:'delete'}, {...query,status:'drop'}, {...query,providers:Array(201).fill('p')}, {...query,providers:[{}]}, {...query,orderNumber:'x'.repeat(201)}, {...query,offset:-1}, {...query,offset:1.5}, {...query,limit:1000}, {...query,limit:'20'}, {...query,limit:[20]}, {...query,amountMin:100,amountMax:50}, {...query,startAt:'2026-02-30T00:00:00Z',endAt:'2026-03-05T00:00:00Z'}, {...query,amountMin:NaN}, {...query,amountMax:-1}])assert.throws(()=>api.validateAdminLiveRequest(input));
  assert.equal(JSON.stringify(api.validateAdminLiveRequest({action:'catalog',limit:20})),JSON.stringify({action:'catalog'}));
});

test('live RPC uses fresh auth and a fixed origin; user changes and malformed hosts never fetch',async()=>{
  const h=load(),controller=new AbortController();await h.api.adminLiveRequest(session,query,controller.signal);
  assert.equal(h.authCalls.length,1);assert.equal(h.calls.length,1);const {url,init}=h.calls[0];
  assert.equal(url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_query');assert.equal(init.headers.Authorization,'Bearer offline-fresh-token');assert.equal(init.headers.apikey,'offline-public-key');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.signal,controller.signal);assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{p_request:query});assert(!init.body.includes('offline-'));
  for(const options of [{base:'http://offline.invalid'},{base:'https://offline.invalid/other'},{base:'https://user:pass@offline.invalid'},{ensure:async current=>({...current,user:{id:'different-user'}})}]){const denied=load(options);await assert.rejects(denied.api.adminLiveRequest(session,query));assert.equal(denied.calls.length,0);}
});

test('pending order drilldown validates exact observation and uses its dedicated role gateway',async()=>{
 const h=load(),q={action:'pendingOrders',date:'2026-10-01',platformIds:['55555555-5555-4555-8555-555555555555'],observedAt:'2026-10-01T18:31:00Z',mode:'midnight',offset:0,limit:50};
 await h.api.adminLiveRequest(session,q);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_pending_orders');
 await h.api.adminLiveRequest(session,q,undefined,{assigned:true,page:'stuck'});assert.equal(h.calls[1].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_execute');assert.deepEqual(JSON.parse(h.calls[1].init.body),{p_page:'stuck',p_request:q});
 for(const patch of [{date:'2026-02-30'},{observedAt:'tomorrow'},{mode:'latest'},{archiveId:'anything'},{platformIds:[q.platformIds[0],q.platformIds[0]]},{provider:' Pay'},{limit:'50'},{offset:-1}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...patch}));
});

test('explicit current and midnight pending modes retain the existing overview role gateway',async()=>{
 const h=load(),platformIds=['55555555-5555-4555-8555-555555555555'];
 const current={action:'pendingSnapshot',mode:'current',platformIds},midnight={action:'pendingSnapshot',mode:'midnight',date:'2026-10-02',platformIds};
 await h.api.adminLiveRequest(session,current,undefined,{assigned:true,page:'overview'});
 assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_execute');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_page:'overview',p_request:current});
 await h.api.adminLiveRequest(session,midnight);assert.equal(h.calls[1].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_pending_snapshot');
 assert.deepEqual(JSON.parse(h.calls[1].init.body),{p_request:{mode:'midnight',date:'2026-10-02',platformIds}});
 for(const q of [{...current,date:'2026-10-02'},{...current,mode:'latest'},{...current,mode:null},{...current,mode:1},{...current,mode:{}},{...current,mode:['current']},{...midnight,date:'2026-02-30'},{...midnight,date:'2000-01-01'},{...current,startDate:'2026-10-01'}])assert.throws(()=>h.api.validateAdminLiveRequest(q));
 const failed=load({fetch:async()=>({ok:false,status:504,json:async()=>({message:'57014 private query'})})});
 for(const q of [current,midnight])await assert.rejects(failed.api.adminLiveRequest(session,q),/代付中存量读取超时/);
});

test('exclusive amount upper bounds retain numeric precision and reject unsupported or empty ranges',async()=>{
 const h=load(),q={...query,action:'aggregate',view:'full',amountMin:200,amountMax:250,amountMaxExclusive:true};
 await h.api.adminLiveRequest(session,q);assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:q});
 for(const patch of [{amountMaxExclusive:'true'},{amountMaxExclusive:1},{amountMaxExclusive:null},{amountMax:undefined},{amountMin:250},{amountMin:251},{action:'catalog',view:undefined},{action:'depositIssues',view:undefined},{action:'query',view:undefined},{action:'details',view:undefined},{view:'drilldown',kind:'hourly'},{amountMax:undefined,amountMaxExclusive:false}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...patch}));
 for(const patch of [{amountMin:250,amountMaxExclusive:false},{amountMin:250,amountMaxExclusive:undefined},{amountMin:undefined},{amountMin:0,amountMax:0.00000001}])assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...q,...patch}));
});

test('errors do not expose raw backend messages or credentials',async()=>{
  for(const [status,message,expected] of [[403,'sensitive detail','未获授权'],[400,'unsupported_filter','未提供'],[500,'57014: statement timeout','读取超时'],[500,'private SQL and offline-token','未完成']]){
    const h=load({fetch:async()=>({ok:false,status,json:async()=>({message})})});await assert.rejects(h.api.adminLiveRequest(session,query),error=>error.message.includes(expected)&&!error.message.includes('private SQL')&&!error.message.includes('offline-token'));
  }
  const h=load({fetch:async()=>({ok:false,status:504,json:async()=>({message:'57014 statement timeout'})})});
  await assert.rejects(h.api.adminLiveRequest(session,{action:'catalog'}),error=>/平台目录读取超时/.test(error.message)&&!/缩短日期|选择单个平台/.test(error.message));
  await assert.rejects(h.api.adminLiveRequest(session,{action:'withdrawReasons',date:'2026-09-24',country:'印度',platform:'EXAMPLE',kind:'categories'}),error=>/当日原因读取超时/.test(error.message)&&!/缩短日期|选择单个平台/.test(error.message));
});

test('only the current opaque frame and nonce can request data; payloads remain token free',async()=>{
  const h=load(),b=bridge(h),valid=b.event();
  for(const event of [{...valid,source:{}},{...valid,source:null},{...valid,origin:'https://offline.invalid'},{...valid,data:{...valid.data,channel:'old'}},{...valid,data:{...valid.data,type:'other'}},{...valid,data:{...valid.data,id:'bad/id'}},{...valid,data:null}])h.send(event);
  await flush();assert.equal(h.calls.length,0);h.send(valid);await flush();assert.equal(h.calls.length,1);assert.equal(b.replies.length,1);assert.equal(b.replies[0].origin,'*');assert.equal(b.replies[0].data.channel,'offline-channel');assert(!JSON.stringify(b.replies).includes('token'));b.cleanup();assert.equal(h.listeners.size,0);
});

test('invalid valid-channel requests are rejected before authentication or network use',async()=>{
  const h=load(),b=bridge(h);h.send(b.event('invalid',{...query,sql:'select secrets'}));await flush();assert.equal(h.calls.length,0);assert.equal(h.authCalls.length,0);assert.equal(b.replies.length,1);assert(b.replies[0].data.error);b.cleanup();
});

test('duplicate IDs and queued concurrent requests do not create duplicate work',async()=>{
  const waiting=deferred(),h=load({fetch:()=>waiting.promise}),b=bridge(h);
  h.send(b.event('a'));h.send(b.event('a'));for(const id of ['b','c','d','e'])h.send(b.event(id));await flush();assert.equal(h.calls.length,4);assert.equal(b.replies.length,0);
  waiting.resolve({ok:true,json:async()=>({total:0})});await flush();await flush();assert.equal(h.calls.length,5);assert.equal(b.replies.length,5);assert(!b.replies.some(reply=>reply.data.error));assert.equal(h.timers.size,0);b.cleanup();
});

test('cleanup aborts every active request and late success cannot reach the iframe',async()=>{
  const waiting=deferred(),h=load({fetch:()=>waiting.promise}),b=bridge(h);h.send(b.event('a'));h.send(b.event('b'));await flush();assert.equal(h.calls.length,2);b.cleanup();assert.equal(h.listeners.size,0);assert(h.calls.every(call=>call.init.signal.aborted));waiting.resolve({ok:true,json:async()=>({private:'late'})});await flush();assert.equal(b.replies.length,0);assert.equal(h.timers.size,0);
});

test('source or channel replacement suppresses outstanding replies without leaking to new frames',async()=>{
  for(const mode of ['source','channel']){const waiting=deferred(),h=load({fetch:()=>waiting.promise}),b=bridge(h);h.send(b.event());await flush();mode==='source'?b.replaceSource({}):b.replaceChannel('new');waiting.resolve({ok:true,json:async()=>({private:'late'})});await flush();assert.equal(b.replies.length,0);b.cleanup();}
});

test('host timeout aborts the transport and returns a bounded error',async()=>{
  const h=load({fetch:async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('backend transport detail'))))}),b=bridge(h);h.send(b.event());await flush();assert.equal(h.timers.size,1);const timer=[...h.timers.values()][0];assert.equal(timer.ms,90000);timer.callback();await flush();assert(h.calls[0].init.signal.aborted);assert.match(b.replies[0].data.error,/超时/);assert(!b.replies[0].data.error.includes('transport'));b.cleanup();
});

test('iframe document encodes the channel, requires matching parent replies and exposes no credentials',async()=>{
  const {api}=load(),channel='</script><script>injected=1</script>\u2028',messages=[],timers=new Map();let callback,seq=0;
  const parent={postMessage:(data,origin)=>messages.push({data,origin})},ctx=vm.createContext({parent,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>{assert.equal(name,'message');callback=fn;}});vm.runInContext('window=globalThis',ctx);
  const html=api.makeAdminLiveDocument('<!doctype html><html><head></head><body></body></html>',channel),scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];assert.equal(scripts.length,1);assert(!/access_token|refresh_token|Authorization|localStorage|sessionStorage/.test(html));vm.runInContext(scripts[0][1],ctx);assert.equal(ctx.HENSEM_PRODUCTION,true);assert.equal(ctx.injected,undefined);
  let resolved=false;const result=ctx.hensemLiveRequest(query).then(value=>{resolved=true;return value;});assert.equal(messages.length,1);assert.equal(messages[0].data.channel,channel);assert.equal(messages[0].origin,'https://dashboard.invalid');const good={source:parent,origin:'https://dashboard.invalid',data:{type:api.LIVE_RESPONSE,channel,id:messages[0].data.id,result:{total:9}}};for(const event of [{...good,source:{}},{...good,origin:'https://imposter.invalid'},{...good,origin:'null'},{...good,data:{...good.data,channel:'wrong'}},{...good,data:{...good.data,id:'unknown'}}])callback(event);await flush();assert.equal(resolved,false);callback(good);assert.equal((await result).total,9);assert.equal(timers.size,0);
  const timeout=ctx.hensemLiveRequest(query);const rejected=assert.rejects(timeout,/超时/);[...timers.values()][0].fn();await rejected;
});

test('rates is allowlisted separately and session getters are evaluated for each request',async()=>{
  const h=load(),replies=[],child={postMessage:data=>replies.push(data)};let current=session;
  const stop=h.api.installAdminLiveBridge({source:()=>child,channel:()=> 'nonce',session:()=>current,target:h.target});
  const send=id=>h.send({source:child,origin:'null',data:{type:h.api.LIVE_REQUEST,channel:'nonce',id,request:{action:'rates'}}});
  send('one');await flush();current={...session,access_token:'offline-replaced-token'};send('two');await flush();
  assert.equal(h.authCalls[1],current);assert.equal(h.calls.length,2);assert(h.calls.every(c=>c.url.endsWith('/rpc/dashboard_admin_live_rates')));assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{}});assert.equal(replies.length,2);stop();
});

test('rate-table filters and paging survive the RPC envelope without widening its permitted fields',async()=>{
 const h=load(),request={action:'rates',scopeType:'platform',country:'india',platform:'PLATFORM/RAW',provider:'Pay/Raw',query:'Raw',offset:30,limit:30};await h.api.adminLiveRequest(session,request);
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{scopeType:'platform',country:'india',platform:'PLATFORM/RAW',provider:'Pay/Raw',query:'Raw',offset:30,limit:30}});
 for(const value of [{...request,platformId:query.platformId},{...request,limit:'30'},{...request,query:{}},{...request,scopeType:'unrestricted'},{...request,offset:-1}])assert.throws(()=>h.api.validateAdminLiveRequest(value));
});

test('ratesSheet accepts only metadata or bounded integer sheet IDs',()=>{
 const {api}=load();
 for(const request of [{action:'ratesSheet'},{action:'ratesSheet',sheetId:0},{action:'ratesSheet',sheetId:2147483647}])assert.deepEqual(JSON.parse(JSON.stringify(api.validateAdminLiveRequest(request))),request);
 for(const request of [{action:'ratesSheet',sheetId:null},{action:'ratesSheet',sheetId:'0'},{action:'ratesSheet',sheetId:-1},{action:'ratesSheet',sheetId:1.5},{action:'ratesSheet',sheetId:2147483648},{action:'ratesSheet',sheetId:NaN},{action:'ratesSheet',sheetId:[0]},{action:'ratesSheet',sheetId:{}},{action:'ratesSheet',platform:'not-allowed'},{action:'ratesSheet',country:'IN'},{action:'ratesSheet',limit:20},{action:'ratesSheet',operation:'index'},{action:'ratesSheet',rpc:'arbitrary'},{action:'ratesSheet',url:'https://other.invalid'}])assert.throws(()=>api.validateAdminLiveRequest(request));
});

test('workorders uses the dedicated read-model RPC and keeps date/field/paging boundaries',async()=>{
 const h=load(),request={action:'workorders',startAt:'2026-09-22T00:00:00Z',endAt:'2026-09-23T00:00:00Z',country:'IN',platform:'91CLUB',provider:'Super-QR',direction:'withdraw',offset:20,limit:30};
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.validateAdminLiveRequest(request))),request);
 await h.api.adminLiveRequest(session,request);
 assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_workorders');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{startAt:request.startAt,endAt:request.endAt,country:'IN',platform:'91CLUB',provider:'Super-QR',direction:'withdraw',offset:20,limit:30}});
 for(const value of [{...request,action:'query'},{...request,platformId:query.platformId},{...request,direction:'both'},{...request,limit:25},{...request,offset:-1},{...request,provider:'x'.repeat(201)},{...request,startAt:'2026-09-22'}])assert.throws(()=>h.api.validateAdminLiveRequest(value));
});

test('depositIssues uses the Supabase synced UPI核对 read model with bounded filters',async()=>{
 const h=load(),request={action:'depositIssues',startAt:'2026-09-22T00:00:00Z',endAt:'2026-09-23T00:00:00Z',country:'印度',platform:'91CLUB',provider:'UPI-QR',status:'未入款',query:'RC2026',offset:20,limit:30};
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.validateAdminLiveRequest(request))),request);await h.api.adminLiveRequest(session,request);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_deposit_issues');assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:Object.fromEntries(Object.entries(request).filter(([key])=>key!=='action'))});
 for(const value of [{...request,source:'Google'},{...request,status:'pending'},{...request,limit:25},{...request,query:'x'.repeat(201)},{...request,offset:-1}])assert.throws(()=>h.api.validateAdminLiveRequest(value));
});

test('providerConfig reads the Supabase canonical mapping read model only',async()=>{
 const h=load(),request={action:'providerConfig',rawProvider:'Arb-BANK',canonicalProvider:'ArbPay',country:'印度',direction:'charge',offset:0,limit:20};
 await h.api.adminLiveRequest(session,request);
 assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_provider_config');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{rawProvider:'Arb-BANK',canonicalProvider:'ArbPay',country:'印度',direction:'charge',offset:0,limit:20}});
 for(const value of [{...request,source:'Google'},{...request,direction:'both'},{...request,limit:10},{...request,canonicalProvider:'x'.repeat(201)}])assert.throws(()=>h.api.validateAdminLiveRequest(value));
});

test('platformAssignments reads the Supabase team/platform mapping read model only',async()=>{
 const h=load(),request={action:'platformAssignments',team:'M8',country:'印度',system:'AR系统',platform:'91CLUB',status:'unmapped',offset:20,limit:50};
 await h.api.adminLiveRequest(session,request);
 assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_platform_assignments');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{team:'M8',country:'印度',system:'AR系统',platform:'91CLUB',status:'unmapped',offset:20,limit:50}});
 for(const value of [{...request,source:'Google'},{...request,status:'unknown'},{...request,limit:10},{...request,team:'x'.repeat(201)},{...request,offset:-1}])assert.throws(()=>h.api.validateAdminLiveRequest(value));
});

test('ratesSheet fixed RPC strips only action, retains sheetId and never sends session fields in its JSON',async()=>{
 const h=load();await h.api.adminLiveRequest(session,{action:'ratesSheet'});await h.api.adminLiveRequest(session,{action:'ratesSheet',sheetId:277747449});
 assert.equal(h.calls.length,2);assert(h.calls.every(call=>call.url==='https://offline.invalid/rest/v1/rpc/dashboard_admin_live_rate_sheet'));
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{}});assert.deepEqual(JSON.parse(h.calls[1].init.body),{p_request:{sheetId:277747449}});
 assert(h.calls.every(call=>call.init.headers.Authorization==='Bearer offline-fresh-token'&&call.init.cache==='no-store'&&call.init.redirect==='error'));
 assert(h.calls.every(call=>!call.init.body.includes('action')&&!call.init.body.includes('token')));
});

test('payoutConfig accepts six fixed systems and validates explicit index/snapshot boundaries',()=>{
 const {api}=load(),systems=['AR','NEW_AR','PANDA','WG','GAME66_HK','GAME66_RED_CRAB'];
 for(const system of systems){assert.equal(api.validateAdminLiveRequest({action:'payoutConfig',operation:'index',system}).system,system);assert.equal(api.validateAdminLiveRequest({action:'payoutConfig',operation:'snapshot',system,country:'IN',platform:'RAW / NAME'}).platform,'RAW / NAME');}
 const base={action:'payoutConfig',operation:'snapshot',system:'AR',country:'IN',platform:'EXAMPLE'};
 for(const request of [{...base,operation:'write'},{...base,operation:['snapshot']},{...base,system:['AR']},{...base,system:'CUSTOM'},{...base,system:'ar'},{...base,operation:null},{...base,system:null},{...base,country:''},{...base,platform:''},{...base,country:1},{...base,platform:{}},{...base,country:'IN\u0000'},{...base,platform:'x'.repeat(201)},{...base,provider:'not-allowed'},{...base,sheetId:1},{...base,limit:20},{...base,configuration:{}},{...base,raw_payload:{}},{...base,sql:'select private'}])assert.throws(()=>api.validateAdminLiveRequest(request),JSON.stringify(request));
});

test('payoutConfig uses only the fixed RPC with action removed and safe explicit request fields',async()=>{
 const h=load(),requests=[{action:'payoutConfig',operation:'index',system:'WG'},{action:'payoutConfig',operation:'snapshot',system:'NEW_AR',country:'IN',platform:'RAW / NAME'}];
 for(const request of requests)await h.api.adminLiveRequest(session,request);
 assert(h.calls.every(call=>call.url==='https://offline.invalid/rest/v1/rpc/dashboard_admin_live_payout_config'));
 assert.deepEqual(h.calls.map(call=>JSON.parse(call.init.body)),[{p_request:{operation:'index',system:'WG'}},{p_request:{operation:'snapshot',system:'NEW_AR',country:'IN',platform:'RAW / NAME'}}]);
 assert(h.calls.every(call=>!call.init.body.includes('action')&&!call.init.body.includes('token')));assert.equal(h.authCalls.length,2);
});

test('invalid special requests are rejected at the opaque-frame boundary before auth or fetch',async()=>{
 const h=load(),b=bridge(h);for(const [id,request]of [['sheet',{action:'ratesSheet',table:'private'}],['config',{action:'payoutConfig',operation:'index',system:'AR',raw_payload:{secret:'ignored'}}]])h.send(b.event(id,request));
 await flush();assert.equal(h.calls.length,0);assert.equal(h.authCalls.length,0);assert.equal(b.replies.length,2);assert(b.replies.every(reply=>reply.data.error));assert(!JSON.stringify(b.replies).includes('secret'));b.cleanup();
});

test('configuration edits and options use exact RPC envelopes and cannot carry unrelated fields',async()=>{
 const h=load(),id=query.platformId;
 const requests=[['providerOptions',{platformIds:[id],direction:'withdraw'}],['configurationAccess',{}],['configurationWrite',{operation:'provider',country:'印度',platform:'EXAMPLE',rawProvider:'',canonicalProvider:'ConfirmedPay',expectedVersion:'a'.repeat(32)}],['configurationWrite',{operation:'grant',userId:id,canManage:false}]];
 const rpc={providerOptions:'provider_options',configurationAccess:'configuration_access',configurationWrite:'configuration_write'};
 for(const [action,fields] of requests){await h.api.adminLiveRequest(session,{action,...fields});assert.equal(h.calls.at(-1).url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_'+rpc[action]);assert.deepEqual(JSON.parse(h.calls.at(-1).init.body),{p_request:fields});assert.throws(()=>h.api.validateAdminLiveRequest({action,...fields,status:'all'}));}
 for(const request of [{action:'providerOptions',platformIds:['all']},{action:'providerOptions',platformIds:[{}]},{action:'configurationWrite',operation:'grant',userId:id,canManage:'true'},{action:'configurationWrite',operation:'provider',country:'印度',platform:'EXAMPLE',rawProvider:'',canonicalProvider:'',expectedVersion:'a'.repeat(32)},{action:'configurationWrite',operation:'provider',country:'印度',platform:'EXAMPLE',rawProvider:'x',canonicalProvider:'Y',expectedVersion:'stale'}])assert.throws(()=>h.api.validateAdminLiveRequest(request));
});

test('withdrawal subpages keep local calendar dates and bounded independent reasons requests',async()=>{
 const h=load(),req={action:'autoWithdraw',country:'印度',startAt:'2026-09-23T00:00:00.000Z',endAt:'2026-09-23T23:59:59.000Z',platforms:['EXAMPLE'],view:'operators',account:'operator-a',sort:'processed',ascending:false,daily:true,offset:20,limit:20};
 await h.api.adminLiveRequest(session,req);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_auto_withdraw');assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:Object.fromEntries(Object.entries(req).filter(([k])=>k!=='action'))});
 for(const bad of [{country:'all'},{country:['印度']},{view:'aggregate'},{platforms:[{}]},{ascending:'false'},{daily:1},{sort:'private'},{startAt:'2026-02-30T00:00:00Z'},{endAt:'2026-10-24T23:59:59Z'},{date:'2026-09-23'},{sql:'select private'}])assert.throws(()=>h.api.validateAdminLiveRequest({...req,...bad}));
 for(const kind of ['blocking','categories','rejection','operators','orders']){const r={action:'withdrawReasons',date:'2026-09-23',country:'印度',platform:'EXAMPLE',kind,offset:0,limit:20};await h.api.adminLiveRequest(session,r);assert.equal(h.calls.at(-1).url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_withdraw_reasons');for(const bad of [{date:'2026-02-30'},{country:'all'},{platform:''},{kind:'raw_sql'},{account:'other'},{category:'arbitrary SQL'},{operatorKey:[]},{query:{id:'123'}},{providers:['Pay']},{offset:-1}])assert.throws(()=>h.api.validateAdminLiveRequest({...r,...bad}));}
 const detail={action:'withdrawReasons',date:'2026-09-23',country:'印度',platform:'EXAMPLE',kind:'orders',category:'a'.repeat(32),operatorKey:'b'.repeat(32),reasonKey:'c'.repeat(32),query:'SYNTHETIC-ORDER'};assert.deepEqual(JSON.parse(JSON.stringify(h.api.validateAdminLiveRequest(detail))),detail);assert.throws(()=>h.api.validateAdminLiveRequest({...detail,kind:'blocking'}));
});
test('daily note writes have a fixed endpoint and cannot contain author, order status, or credential fields',async()=>{
 const h=load(),r={action:'withdrawNote',date:'2026-09-23',country:'印度',platform:'EXAMPLE',reason:'Verified synthetic note\nSecond line',expectedVersion:''};
 await h.api.adminLiveRequest(session,r);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_withdraw_note');
 for(const bad of [{date:'2026-02-30'},{country:''},{platform:[]},{reason:'x'.repeat(1001)},{reason:null},{expectedVersion:'stale'},{updated_by:'x'},{status:'success'},{access_token:'x'}])assert.throws(()=>h.api.validateAdminLiveRequest({...r,...bad}));
 for(const sort of ['platform','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange'])assert.equal(h.api.validateAdminLiveRequest({action:'autoWithdraw',country:'印度',startAt:'2026-09-23T00:00:00Z',endAt:'2026-09-23T23:59:59Z',sort}).sort,sort);
});

test('deposit sheet views allow scoped summaries and reply searches with explicit date modes',async()=>{
 const h=load(),q={action:'depositIssues',view:'entries',dateMode:'all',startAt:'2026-01-01T00:00:00Z',endAt:'2026-09-25T23:59:59Z',country:'印度',followupStatus:'need to provide pdf/video',query:'synthetic reply',limit:500};
 assert.equal(h.api.validateAdminLiveRequest(q).view,'entries');assert.throws(()=>h.api.validateAdminLiveRequest({...q,dateMode:'range'}));
 for(const change of [{view:'write'},{dateMode:'unbounded'},{match:'bogus'},{followupStatus:{text:'bad'}}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...change}));
});

test('collected data has a bounded source-only action, fresh auth and no arbitrary database table parameter',async()=>{
 const h=load(),request={action:'collectedData',operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'FUTURE-PH',startAt:'2026-09-24',endAt:'2026-09-24',limit:50,offset:0};
 await h.api.adminLiveRequest(session,request);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_collected_data');assert.equal(h.calls[0].init.headers.Authorization,'Bearer offline-fresh-token');assert.equal(JSON.parse(h.calls[0].init.body).p_request.platform,'FUTURE-PH');
 for(const bad of [{...request,table:'dashboard_profiles'},{...request,startAt:'2026-08-01'},{...request,endAt:'2026-02-30'},{...request,offset:-1},{...request,limit:'50'},{action:'collectedData',operation:'catalog',platform:'FUTURE-PH'}])assert.throws(()=>h.api.validateAdminLiveRequest(bad));
});

test('intake directions and transport stay bounded to the selected report source',()=>{
 const h=load(),q={action:'collectedData',operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'TEST',startAt:'2026-09-24',endAt:'2026-09-24',direction:'charge',sourceKind:'google_sheets'};
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.validateAdminLiveRequest(q))),q);
 for(const bad of [{...q,direction:'all'},{...q,sourceKind:'mixed'},{...q,dataset:'panda_success'},{action:'catalog',sourceKind:'direct'},{action:'collectedData',operation:'catalog',direction:'charge'}])assert.throws(()=>h.api.validateAdminLiveRequest(bad));
});


test('cancellation authenticates frame origin, channel, source and id before touching active or queued reads',async()=>{
 const h=load({fetch:async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))))}),b=bridge(h);
 for(const id of ['a','b','c','d','queued'])h.send(b.event(id));await flush();assert.equal(h.calls.length,4);
 const cancel={...b.event('a'),data:{type:h.api.LIVE_CANCEL,id:'a',channel:'offline-channel'}};
 for(const bad of [{...cancel,source:{}},{...cancel,origin:'https://dashboard.invalid'},{...cancel,data:{...cancel.data,channel:'other'}},{...cancel,data:{...cancel.data,id:'bad/id'}},{...cancel,data:{...cancel.data,request:query}},{...cancel,data:{...cancel.data,reason:'arbitrary'}}])h.send(bad);
 assert(h.calls.every(c=>!c.init.signal.aborted));assert.equal(b.replies.length,0);
 h.send({...cancel,data:{...cancel.data,id:'queued'}});assert.equal(b.replies[0].data.code,'ADMIN_LIVE_CANCELLED');assert.doesNotMatch(b.replies[0].data.error,/超时|timeout/);
 h.send(cancel);await flush();assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.calls.length,4);assert.equal(b.replies.length,2);
 h.send(cancel);assert.equal(b.replies.length,2);b.cleanup();await flush();assert.equal(h.timers.size,0);
});

test('queued reads expire on their original deadline and never enter auth or fetch',async()=>{
 const waits=[],h=load({now:1000000,fetch:()=>{const wait=deferred();waits.push(wait);return wait.promise}}),b=bridge(h);
 for(const id of ['a','b','c','d'])h.send(b.event(id));
 h.send({...b.event('queued'),data:{...b.event('queued').data,deadline:h.now()+1000}});await flush();assert.equal(h.calls.length,4);
 h.advance(1000);const timer=[...h.timers.values()].find(t=>t.ms===1000);assert(timer);timer.callback();assert.equal(b.replies[0].data.id,'queued');assert.equal(b.replies[0].data.code,'ADMIN_LIVE_TIMEOUT');
 waits[0].resolve({ok:true,json:async()=>({total:0})});await flush();assert.equal(h.calls.length,4);assert.equal(h.authCalls.length,4);b.cleanup();for(const w of waits)w.resolve({ok:true,json:async()=>({total:0})});await flush();assert.equal(h.timers.size,0);
});

test('dequeue keeps elapsed queue time inside the same deadline, with no fresh execution timer',async()=>{
 const waits=[],h=load({now:1000000,fetch:()=>{const wait=deferred();waits.push(wait);return wait.promise}}),b=bridge(h);
 for(const id of ['a','b','c','d'])h.send(b.event(id));h.send({...b.event('queued'),data:{...b.event('queued').data,deadline:h.now()+20000}});await flush();
 const deadlineTimer=[...h.timers.values()].find(t=>t.ms===20000);assert(deadlineTimer);h.advance(19000);waits[0].resolve({ok:true,json:async()=>({total:0})});await flush();assert.equal(h.calls.length,5);assert.equal(h.timers.size,4);assert([...h.timers.values()].includes(deadlineTimer));
 h.advance(1000);deadlineTimer.callback();assert(h.calls[4].init.signal.aborted);assert.equal(b.replies.find(r=>r.data.id==='queued').data.code,'ADMIN_LIVE_TIMEOUT');
 waits[4].resolve({ok:true,json:async()=>({private:'late'})});await flush();assert.equal(b.replies.filter(r=>r.data.id==='queued').length,1);b.cleanup();for(const w of waits)w.resolve({ok:true,json:async()=>({})});await flush();assert.equal(h.timers.size,0);
});

test('invalid or expired deadlines never query and a supplied deadline cannot prolong the host cap',async()=>{
 const h=load({now:1000000,fetch:()=>deferred().promise}),b=bridge(h);
 for(const [i,deadline]of [NaN,Infinity,0,-1,'1000010',{},1000000].entries())h.send({...b.event('bad_'+i),data:{...b.event('bad_'+i).data,deadline}});
 await flush();assert.equal(h.calls.length,0);assert.equal(h.authCalls.length,0);assert.equal(b.replies.length,7);
 h.send({...b.event('long'),data:{...b.event('long').data,deadline:h.now()+900000}});await flush();assert.equal([...h.timers.values()][0].ms,h.api.LIVE_REQUEST_TIMEOUT_MS);b.cleanup();assert.equal(h.timers.size,0);
});

test('cancelling during auth refresh cannot start a later fetch and cleanup is idempotent',async()=>{
 const refresh=deferred(),h=load({ensure:()=>refresh.promise}),b=bridge(h);h.send(b.event('a'));await flush();assert.equal(h.authCalls.length,1);
 h.send({...b.event('a'),data:{type:h.api.LIVE_CANCEL,id:'a',channel:'offline-channel'}});refresh.resolve({...session,access_token:'fresh'});await flush();assert.equal(h.calls.length,0);assert.equal(b.replies.length,1);assert.equal(b.replies[0].data.code,'ADMIN_LIVE_CANCELLED');b.cleanup();b.cleanup();assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
});

function iframeHarness(){
 const h=load(),messages=[],timers=new Map(),listeners=new Set();let seq=0;
 const parent={postMessage:(data,origin)=>messages.push({data,origin})};
 const ctx=vm.createContext({parent,AbortController,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>{assert.equal(name,'message');listeners.add(fn);}});vm.runInContext('window=globalThis',ctx);
 const html=h.api.makeAdminLiveDocument('<!doctype html><html></html>','test-channel');vm.runInContext([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][0][1],ctx);
 return {h,ctx,messages,timers,reply:(request,payload)=>[...listeners].forEach(fn=>fn({source:parent,origin:'https://dashboard.invalid',data:{type:h.api.LIVE_RESPONSE,channel:'test-channel',id:request.id,...payload}}))};
}

test('iframe cancellation releases listeners/timers, rejects with AbortError and preserves in-flight edits',async()=>{
 const x=iframeHarness(),controller=new AbortController(),read=x.ctx.hensemLiveRequest(query,{signal:controller.signal}),cancelled=assert.rejects(read,e=>e.name==='AbortError'&&e.code==='ADMIN_LIVE_CANCELLED'&&!/超时/.test(e.message));
 controller.abort();await cancelled;assert.equal(x.messages[1].data.type,x.h.api.LIVE_CANCEL);assert.equal(x.messages[1].data.id,x.messages[0].data.id);assert.equal(x.messages[1].origin,'https://dashboard.invalid');assert.equal(x.timers.size,0);x.reply(x.messages[0].data,{result:{private:'late'}});
 const first=x.ctx.hensemLiveRequest(query),second=x.ctx.hensemLiveRequest({action:'rates'}),write=x.ctx.hensemLiveRequest({action:'configurationWrite'}),note=x.ctx.hensemLiveRequest({action:'withdrawNote'});
 const firstRejected=assert.rejects(first,e=>e.code==='ADMIN_LIVE_CANCELLED');assert.equal(x.ctx.hensemLiveCancelRequests(['query']),1);await firstRejected;
 const secondRejected=assert.rejects(second,e=>e.name==='AbortError');assert.equal(x.ctx.hensemLiveCancelRequests(),1);await secondRejected;assert.equal(x.timers.size,2);assert.equal(x.ctx.hensemLiveCancelRequests(['configurationWrite','withdrawNote']),0);
 for(const msg of x.messages.filter(m=>m.data.type===x.h.api.LIVE_REQUEST&&['configurationWrite','withdrawNote'].includes(m.data.request.action)))x.reply(msg.data,{result:{saved:true}});
 assert.equal((await write).saved,true);assert.equal((await note).saved,true);assert.equal(x.timers.size,0);
 const already=new AbortController();already.abort();const before=x.messages.length;await assert.rejects(x.ctx.hensemLiveRequest(query,{signal:already.signal}),e=>e.name==='AbortError');assert.equal(x.messages.length,before);
});

test('iframe expiry sends host cancellation with the same total deadline and ignores late replies',async()=>{
 const x=iframeHarness(),start=Date.now(),pending=x.ctx.hensemLiveRequest(query),rejected=assert.rejects(pending,e=>e.code==='ADMIN_LIVE_TIMEOUT'&&/超时/.test(e.message));
 const request=x.messages[0].data;assert(request.deadline>=start+x.h.api.LIVE_REQUEST_TIMEOUT_MS);assert(request.deadline<=Date.now()+x.h.api.LIVE_REQUEST_TIMEOUT_MS);const timer=[...x.timers.values()][0];assert.equal(timer.ms,x.h.api.LIVE_REQUEST_TIMEOUT_MS);timer.fn();await rejected;
 assert.equal(x.messages[1].data.type,x.h.api.LIVE_CANCEL);assert.equal(x.messages[1].data.reason,'timeout');assert.equal(x.messages[1].data.id,request.id);assert.equal(x.timers.size,0);x.reply(request,{result:{private:'late'}});
});


test('a late completion cannot outrun the deadline timer and publish a success',async()=>{
 const waiting=deferred(),h=load({now:1000000,fetch:()=>waiting.promise}),b=bridge(h);h.send(b.event('late'));await flush();h.advance(90001);
 waiting.resolve({ok:true,json:async()=>({private:'late success'})});await flush();assert.equal(b.replies.length,1);assert.equal(b.replies[0].data.code,'ADMIN_LIVE_TIMEOUT');assert(!JSON.stringify(b.replies).includes('late success'));assert.equal(h.timers.size,0);b.cleanup();
});

test('lost iframe transport cannot prevent host cancellation cleanup or queue advancement',async()=>{
 const waits=[],h=load({fetch:async(_url,init)=>new Promise((resolve,reject)=>{waits.push({resolve,init});init.signal.addEventListener('abort',()=>reject(Error('aborted')));})}),b=bridge(h);
 for(const id of ['a','b','c','d','queued'])h.send(b.event(id));await flush();b.child.postMessage=()=>{throw Error('closed frame')};
 h.send({...b.event('a'),data:{type:h.api.LIVE_CANCEL,id:'a',channel:'offline-channel'}});await flush();assert.equal(waits[0].init.signal.aborted,true);assert.equal(h.calls.length,5);b.cleanup();await flush();assert.equal(h.timers.size,0);
});

 test('follow-up field filters remain independent, bounded and read-only',()=>{
 const h=load(),q={action:'depositIssues',view:'entries',dateMode:'all',startAt:'2026-09-01T00:00:00Z',endAt:'2026-09-27T23:59:59Z',orderNumber:'ORDER',workOrderNumber:'TICKET',utr:'0001',reply:'received',staffCode:'EMP',upiId:'synthetic',kycUpiId:'***@bank',utrMatch:'YES',kycCorrect:'YES',sourceKind:'sheet',amountMin:1,amountMax:100};
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.validateAdminLiveRequest(q))),q);
 for(const change of [{upiId:{}},{kycUpiId:'x'.repeat(201)},{sourceKind:'raw'},{staffCode:{}},{reply:'x'.repeat(201)},{amountMin:-1},{amountMax:0},{workOrderNumber:[]},{action:'catalog'}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...change}));
 });

test('collected workorders have a distinct guarded read action with fresh authorization',async()=>{
 const h=load(),q={action:'workorderRecords',view:'missing',operation:'list',country:'IN',filters:{from:'2026-09-26',to:'2026-09-26',registrationStatus:'missing',workorderNo:'WO'},offset:0,limit:100};
 await h.api.adminLiveRequest(session,q);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_workorder_records');assert.equal(h.authCalls.length,1);assert.equal(JSON.parse(h.calls[0].init.body).p_request.filters.workorderNo,'WO');
 for(const q2 of [{...q,account:{}},{...q,operation:'delete'},{...q,country:'all'},{...q,filters:{phone:'private'}},{...q,view:'workload',filters:{statusCode:'3'}},{...q,filters:{from:'2026-02-30',to:'2026-03-01'}},{...q,limit:500},{...q,view:'records',filters:{registrationStatus:'missing'}}])assert.throws(()=>h.api.validateAdminLiveRequest(q2));
 assert.throws(()=>h.api.validateAdminLiveRequest({...query,filters:{}}));
});

test('reconciliation statistics keeps a dedicated scoped RPC and precise column filters',async()=>{
 const h=load();await h.api.adminLiveRequest(session,{action:'depositStatistics',section:'details',dateMode:'all',platform:'RAJALOTTERY',upiId:'synthetic@invalid',amountMin:1,limit:20});
 assert(h.calls[0].url.endsWith('/rpc/dashboard_admin_deposit_statistics'));const p=JSON.parse(h.calls[0].init.body).p_request;assert.equal(p.upiId,'synthetic@invalid');assert.equal(p.action,undefined);
 for(const patch of [{section:'raw'},{country:'菲律宾'},{amountMin:-1},{amountMin:3,amountMax:1},{sourceKind:'portal'},{offset:-1},{limit:500},{dateMode:'range',startAt:'2026-02-30T00:00:00Z',endAt:'2026-03-01T00:00:00Z'}])assert.throws(()=>h.api.validateAdminLiveRequest({action:'depositStatistics',...patch}));
 assert.throws(()=>h.api.validateAdminLiveRequest({action:'depositStatistics',limit:'20'}));
});

test('portal operation logs use refreshed backend auth with a fixed portal destination and no cookies',async()=>{
 const q={action:'portalOperationLogs',country:'印度',filters:{from:'2026-09-01',to:'2026-09-27',operator:'synthetic',action:'follow'},limit:20,offset:0};
 const h=load(),controller=new AbortController();await h.api.adminLiveRequest(session,q,controller.signal);
 assert.equal(h.calls.length,1);assert.equal(h.authCalls.length,1);const {url,init}=h.calls[0];
 assert.equal(url,'https://hensem-india-workorder.workdesk-hub.workers.dev/api/owner-operation-logs');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer offline-fresh-token');assert.equal(init.headers.apikey,undefined);assert.equal(init.signal,controller.signal);assert.equal(JSON.parse(init.body).action,undefined);assert.equal(JSON.parse(init.body).filters.action,'follow');
 for(const patch of [{country:'菲律宾'},{url:'https://other.invalid'},{filters:{sql:'select'}},{filters:{from:'2026-02-30',to:'2026-03-01'}},{filters:{from:'2026-01-01',to:'2026-09-27'}},{filters:{action:'delete'}},{limit:'20'},{offset:-1}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...patch}));
 const changed=load({ensure:async s=>({...s,user:{id:'changed'}})});await assert.rejects(changed.api.adminLiveRequest(session,q));assert.equal(changed.calls.length,0);
 for(const status of [401,403,500]){const denied=load({fetch:async()=>({ok:false,status,json:async()=>({error:'private token'})})});await assert.rejects(denied.api.adminLiveRequest(session,q),e=>!/private token/.test(e.message)&&/登录|权限|未完成/.test(e.message));}
});

test('portal workload forwards only supported read filters under the same owner authentication boundary',async()=>{
 const h=load(),q={action:'portalOperationLogs',view:'workload',country:'印度',filters:{from:'2026-10-03',to:'2026-10-04',platform:'SYNTHETIC',operator:'员工',orderNo:'RC',workorderNo:'WO',utr:'000123'},offset:20,limit:20};
 await h.api.adminLiveRequest(session,q);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://hensem-india-workorder.workdesk-hub.workers.dev/api/owner-operation-logs');assert.equal(h.calls[0].init.credentials,'omit');assert.equal(h.calls[0].init.redirect,'error');assert.equal(h.calls[0].init.headers.Authorization,'Bearer offline-fresh-token');assert.deepEqual(JSON.parse(h.calls[0].init.body),{view:q.view,country:q.country,filters:q.filters,offset:q.offset,limit:q.limit});
 for(const patch of [{view:'raw'},{view:null},{view:['workload']},{team:'M8'},{filters:{team:'M8'}},{filters:{action:'follow'}},{filters:{status:'success'}},{filters:{operator:null}},{filters:{platform:'SYNTHETIC\u0000'}},{limit:500}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...patch}));
 const denied=load();await assert.rejects(denied.api.adminLiveRequest(session,q,undefined,{assigned:true,page:'workorder_employees'}),/仅总管理员/);assert.equal(denied.calls.length,0);
});

test('blocking drilldowns require a rule key and cannot reuse rejected-order filters',async()=>{
 const h=load(),base={action:'withdrawReasons',date:'2026-09-26',country:'巴基斯坦',platform:'SYNTHETIC',reasonKey:'a'.repeat(32)};
 for(const kind of ['blockingOrders','blockingVariants']){
  const q={...base,kind,limit:50};await h.api.adminLiveRequest(session,q);assert.equal(JSON.parse(h.calls.at(-1).init.body).p_request.kind,kind);
  for(const patch of [{reasonKey:''},{reasonKey:'bad'},{category:'b'.repeat(32)},{operatorKey:'b'.repeat(32)}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...patch}));
 }
 assert.equal(h.api.validateAdminLiveRequest({...base,kind:'blockingOrders',query:'SYNTHETIC-ORDER'}).query,'SYNTHETIC-ORDER');
 assert.throws(()=>h.api.validateAdminLiveRequest({...base,kind:'blockingVariants',query:'ORDER'}));
});

test('pending balance accepts one closing day and exact platform/provider scope, never an order cohort or alternate endpoint',async()=>{
 const h=load(),request={action:'pendingSnapshot',date:'2026-09-26',platformIds:[query.platformId],providers:['ExamplePay']};
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.validateAdminLiveRequest(request))),request);
 for(const patch of [{date:'2026-02-30'},{date:'1999-12-31'},{date:'2026-09-26T23:59:59Z'},{date:null},{platformIds:[]},{platformIds:[query.platformId,query.platformId]},{platformIds:['report:untrusted']},{platformIds:['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA']},{platformIds:Array(251).fill(query.platformId)},{providers:[null]},{providers:['']},{providers:[' ExamplePay']},{providers:['X\nY']},{providers:['X'.repeat(201)]},{providers:['ExamplePay','ExamplePay']},{providers:Array(251).fill('ExamplePay')},{startAt:query.startAt},{endAt:query.endAt},{country:'IN'},{scope:'all'},{sql:'select 1'},{rpc:'another_endpoint'}])assert.throws(()=>h.api.validateAdminLiveRequest({...request,...patch}),JSON.stringify(patch));
 assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...request,providers:[]}));
 const signal=new AbortController().signal;await h.api.adminLiveRequest(session,request,signal);
 assert.equal(h.calls.length,1);assert.equal(h.authCalls.length,1);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_pending_snapshot');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{date:request.date,platformIds:request.platformIds,providers:request.providers}});
 assert.equal(h.calls[0].init.signal,signal);assert.equal(h.calls[0].init.headers.Authorization,'Bearer offline-fresh-token');assert.equal(h.calls[0].init.cache,'no-store');
});

test('pending snapshot errors identify a failed closing balance without suggesting a narrower date or leaking source errors',async()=>{
 const request={action:'pendingSnapshot',date:'2026-09-26',platformIds:[query.platformId]};
 for(const [status,message,expected] of [[504,'57014 private statement','近7天代付中快照读取超时'],[403,'scope_denied','代付中查看权限'],[403,'platform_denied','代付中查看权限'],[400,'mixed_currency','同一币种'],[500,'private snapshot row and token','正式数据查询未完成']]){
  const h=load({fetch:async()=>({ok:false,status,json:async()=>({message})})});
  await assert.rejects(h.api.adminLiveRequest(session,request),error=>error.message.includes(expected)&&!/private|token|缩短日期/.test(error.message));
 }
});


test('auto withdrawal multi-team requests are explicit bounded source scopes within one displayed country',async()=>{
 const h=load(),r={action:'autoWithdraw',country:'巴西',startAt:'2026-09-27T00:00:00Z',endAt:'2026-09-27T23:59:59Z',scopeTargets:[{country:'巴西',platforms:['M8-A']},{country:'胖虎巴西',platforms:['PH-A']}]};
 await h.api.adminLiveRequest(session,r);assert.deepEqual(JSON.parse(h.calls[0].init.body).p_request.scopeTargets,r.scopeTargets);
 for(const scopeTargets of [null,{},[],Array(9).fill(r.scopeTargets[0]),[null],[{}],[{country:'巴西',platforms:[]}],[{country:'巴西',platforms:null}],[{country:'巴西',platforms:['']}],[{country:'巴西',platforms:[' A']}],[{country:'巴西',platforms:[1]}],[{country:'巴西',platforms:Array(201).fill('A')}],[{country:'印度',platforms:['A']}],[r.scopeTargets[0],r.scopeTargets[0]],[{...r.scopeTargets[0],sql:'private'}]])assert.throws(()=>h.api.validateAdminLiveRequest({...r,scopeTargets}));
 for(const action of ['catalog','workorders','withdrawReasons','query'])assert.throws(()=>h.api.validateAdminLiveRequest({...r,action}));
 assert.equal(h.calls.length,1);
});

test('daily submission analysis retains narrow authenticated scope and rejects unintended filters',async()=>{
 const h=load(),q={action:'submissionAnalysis',platformId:query.platformId,startAt:query.startAt,endAt:query.endAt,direction:'charge',operation:'members',threshold:30,level:'l0',providers:['Synthetic Pay'],limit:50,offset:0};
 assert.equal(h.api.validateAdminLiveRequest(q).threshold,30);
 for(const bad of [{platformId:'bad'},{direction:'withdraw'},{status:'success'},{threshold:'30'},{threshold:29},{level:'VIP'},{offset:-1},{limit:500},{providers:['']},{memberId:'\n'},{startAt:'not a date'},{operation:'delete'},{country:'hidden'}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...bad}));
 await h.api.adminLiveRequest(session,q);assert.match(h.calls[0].url,/\/rpc\/dashboard_admin_live_submission_analysis$/);const payload=JSON.parse(h.calls[0].init.body).p_request;assert.equal(payload.platformId,q.platformId);assert.equal(payload.action,undefined);assert.equal(payload.threshold,30);
});

test('submission dashboard validates increasing numeric amount boundaries',()=>{
 const h=load(),base={action:'submissionAnalysis',platformId:query.platformId,startAt:query.startAt,endAt:query.endAt,direction:'charge',operation:'summary'};
 const bands={charge:[10,20,30,50,100,200,500,1000,5000,10000,100000]};
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.validateAdminLiveRequest({...base,amountBands:bands}))).amountBands,bands);
 for(const amountBands of [null,{}, {charge:[1,2]}, {...bands,withdraw:bands.charge}, {charge:[10,20,20,50,100,200,500,1000,5000,10000,100000]}])assert.throws(()=>h.api.validateAdminLiveRequest({...base,amountBands}));
});
test('submission charts can only be requested using a boolean flag',()=>{
 const h=load(),q={action:'submissionAnalysis',platformId:query.platformId,startAt:query.startAt,endAt:query.endAt,direction:'charge',operation:'summary'};assert.equal(h.api.validateAdminLiveRequest({...q,charts:false}).charts,false);for(const charts of [null,0,'false',{}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,charts}));
});

test('daily exclusion bridge accepts 15 for summaries and member details without relaxing numeric validation',()=>{
 const h=load(),q={action:'submissionAnalysis',platformId:query.platformId,startAt:query.startAt,endAt:query.endAt,direction:'charge',threshold:15};
 for(const operation of ['summary','members'])assert.equal(h.api.validateAdminLiveRequest({...q,operation}).threshold,15);
 for(const threshold of [14,16,'15',15.5,null])assert.throws(()=>h.api.validateAdminLiveRequest({...q,threshold}));
});


test('pending analysis validates inclusive daily ranges and uses only the authenticated snapshot-analysis RPC',async()=>{
 const request={action:'pendingAnalysis',startDate:'2026-09-01',endDate:'2026-09-30',platformIds:[query.platformId],providers:['ExamplePay']},h=load();
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.validateAdminLiveRequest(request))),request);
 for(const patch of [{startDate:'2026-02-30'},{endDate:'2026-02-30'},{startDate:'1999-12-31'},{startDate:'2026-09-01T00:00:00Z'},{endDate:null},{startDate:'2026-10-01'},{endDate:'2026-10-02'},{platformIds:[]},{platformIds:[query.platformId,query.platformId]},{platformIds:['report:untrusted']},{platformIds:['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA']},{platformIds:Array(251).fill(query.platformId)},{providers:[null]},{providers:['']},{providers:[' ExamplePay']},{providers:['X\nY']},{providers:['X'.repeat(201)]},{providers:['ExamplePay','ExamplePay']},{providers:Array(251).fill('ExamplePay')},{date:'2026-09-30'},{startAt:query.startAt},{endAt:query.endAt},{country:'IN'},{direction:'withdraw'},{scope:'all'},{sql:'select 1'},{rpc:'another_endpoint'}])assert.throws(()=>h.api.validateAdminLiveRequest({...request,...patch}),JSON.stringify(patch));
 assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...request,endDate:'2026-10-01',providers:[]}),'31 inclusive days accepted');
 assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...request,startDate:request.endDate}),'one day accepted');
 assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...request,startDate:'2024-02-29',endDate:'2024-02-29'}),'actual leap day accepted');
 const signal=new AbortController().signal;await h.api.adminLiveRequest(session,request,signal);
 assert.equal(h.calls.length,1);assert.equal(h.authCalls.length,1);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_pending_analysis');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{startDate:request.startDate,endDate:request.endDate,platformIds:request.platformIds,providers:request.providers}});
 assert.equal(h.calls[0].init.signal,signal);assert.equal(h.calls[0].init.headers.Authorization,'Bearer offline-fresh-token');assert.equal(h.calls[0].init.cache,'no-store');
});

test('pending analysis failures preserve missing-data and permission distinctions without exposing source errors',async()=>{
 const request={action:'pendingAnalysis',startDate:'2026-09-20',endDate:'2026-09-26',platformIds:[query.platformId]};
 for(const [status,message,expected]of[[504,'57014 private statement','代付中分析读取超时'],[403,'scope_denied','代付中查看权限'],[403,'platform_denied','代付中查看权限'],[400,'mixed_currency','同一币种'],[500,'private snapshot row and token','正式数据查询未完成']]){
  const h=load({fetch:async()=>({ok:false,status,json:async()=>({message})})});
  await assert.rejects(h.api.adminLiveRequest(session,request),error=>error.message.includes(expected)&&!/private|token/.test(error.message));
 }
});


test('rate source mode uses only minimal verified scope metadata; missing metadata fails closed',()=>{
 const h=load();const run=scope=>{const html=h.api.makeAdminLiveDocument('<!doctype html><html><head></head><body></body></html>','scope-channel',undefined,scope),ctx={window:null,parent:{postMessage(){}},Map,Error,URL,setTimeout,clearTimeout,addEventListener(){},document:{}};ctx.window=ctx;vm.runInNewContext([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][0][1],ctx);return {html,scope:JSON.parse(JSON.stringify(ctx.hensemDataScope))};};
 assert.deepEqual(run().scope,{mode:'selected',identity:'unverified'});
 const verified=run({mode:'all',identity:'synthetic:all',access_token:'forbidden-token',password:'forbidden-password'});assert.deepEqual(verified.scope,{mode:'all',identity:'synthetic:all'});assert.doesNotMatch(verified.html,/forbidden-token|forbidden-password/);
 const escaped=run({mode:'selected',identity:'<script>\u2028test'});assert.equal(escaped.scope.identity,'<script>\u2028test');assert.equal((escaped.html.match(/<script>/g)||[]).length,1);
});

test('KYC imported-candidate filters retain existing authenticated RPC and strict ISO contract',async()=>{
 const h=load(),q={action:'depositStatistics',section:'kyc',dimension:'platform',country:'IN',dateMode:'range',startAt:'2026-09-01T00:00:00Z',endAt:'2026-09-30T23:59:59Z',kycStatus:'unknown',processing:'rejected',matchStatus:'exact_unique',query:'SYNTHETIC',platform:'RAJALOTTERY',provider:'Pay',offset:0,limit:20};
 await h.api.adminLiveRequest(session,q);assert(h.calls[0].url.endsWith('/rpc/dashboard_admin_deposit_statistics'));const p=JSON.parse(h.calls[0].init.body).p_request;assert.equal(p.section,'kyc');assert.equal(p.dimension,'platform');assert.equal(p.action,undefined);assert.equal(h.authCalls.length,1);
 for(const change of [{dimension:null},{dimension:{}},{dimension:[]},{kycStatus:'YES'},{processing:0},{matchStatus:'paid'},{query:[]},{from:'2026-09-01'},{sourceKind:'portal'},{raw:true},{dateMode:null},{startAt:'2026-02-30T00:00:00Z'},{section:{toString:()=> 'kyc'}}])assert.throws(()=>h.api.validateAdminLiveRequest({...q,...change}));
 for(const section of [null,{},[],0])assert.throws(()=>h.api.validateAdminLiveRequest({action:'depositStatistics',section}));
});
