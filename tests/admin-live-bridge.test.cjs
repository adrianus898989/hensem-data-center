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
  const target = { addEventListener: (name,fn) => {assert.equal(name,'message');listeners.add(fn);}, removeEventListener: (name,fn) => listeners.delete(fn) };
  const authCalls = [];
  vm.runInNewContext(compiled, { module,exports:module.exports,URL,AbortController,window:target,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: options.base || 'https://offline.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key' } },
    require: name => {
      if(name==='./adminConfigurationRequest') {
        const helper={exports:{}};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/lib/adminConfigurationRequest.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:helper,exports:helper.exports});
        return helper.exports;
      }
      assert.equal(name,'./dashboardAuthClient');return { ensureDashboardSession: async current => {authCalls.push(current);return options.ensure ? options.ensure(current) : {...current,access_token:'offline-fresh-token'};} };
    },
    fetch: async (url,init) => {calls.push({url,init});return options.fetch ? options.fetch(url,init) : {ok:true,json:async()=>({rows:[],total:0})};},
    setTimeout:(callback,ms) => {const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id)
  }, {filename});
  return {api:module.exports,calls,authCalls,listeners,timers,target,send:event=>[...listeners].forEach(fn=>fn(event))};
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

test('errors do not expose raw backend messages or credentials',async()=>{
  for(const [status,message,expected] of [[403,'sensitive detail','未获授权'],[400,'unsupported_filter','未提供'],[500,'57014: statement timeout','读取超时'],[500,'private SQL and offline-token','未完成']]){
    const h=load({fetch:async()=>({ok:false,status,json:async()=>({message})})});await assert.rejects(h.api.adminLiveRequest(session,query),error=>error.message.includes(expected)&&!error.message.includes('private SQL')&&!error.message.includes('offline-token'));
  }
  const h=load({fetch:async()=>({ok:false,status:504,json:async()=>({message:'57014 statement timeout'})})});
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
  let resolved=false;const result=ctx.hensemLiveRequest(query).then(value=>{resolved=true;return value;});assert.equal(messages.length,1);assert.equal(messages[0].data.channel,channel);assert.equal(messages[0].origin,'*');const good={source:parent,data:{type:api.LIVE_RESPONSE,channel,id:messages[0].data.id,result:{total:9}}};for(const event of [{...good,source:{}},{...good,data:{...good.data,channel:'wrong'}},{...good,data:{...good.data,id:'unknown'}}])callback(event);await flush();assert.equal(resolved,false);callback(good);assert.equal((await result).total,9);assert.equal(timers.size,0);
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
