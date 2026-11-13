// Verify real bridge validation/routing with synthetic sessions, never the network.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'admin-live-bridge.test.cjs'),req=createRequire(filename);
const context={require:req,__dirname,console,process,URL,AbortController,structuredClone};vm.createContext(context);
vm.runInContext(fs.readFileSync(filename,'utf8').split('\ntest(')[0]+'\nglobalThis.fixture={load,query,session,bridge};',context,{filename});
const {load,query,session,bridge}=context.fixture;
const base={...query,action:'aggregate',view:'drilldown',direction:'charge',status:'all',kind:'custom'};
const fullDay={minHour:0,maxHour:24};
const edges=[100,200,300,400,500,1000,2000,5000,10000,20000,50000];
const matrixFixtures=[
 {page:'time', flag:'providerHourMatrix', groups:{hourly:[{hour:1,all_count:10,success_count:3}],provider_hour:[{hour:1,provider:'Pay',all_count:10,success_count:3}]}},
 {page:'amount', flag:'providerAmountMatrix', groups:{amount_range:[{bucket:'band:0',all_count:10,success_count:3}],provider_amount_range:[{bucket:'band:0',provider:'Pay',all_count:10,success_count:3}]}}
];
for(const {page,flag,groups} of matrixFixtures){
 const other=page==='time'?'amount':'time';
 const request={...base,hourRange:fullDay,[flag]:true,successBasis:'created',...(page==='amount'?{amountBands:{charge:edges}}:{})};
 test(page+' matrix uses the authorized page and source RPC for owner and assigned roles',async()=>{
  const h=load({fetch:async()=>({ok:true,json:async()=>({[flag]:true,groups})})});
  for(const assigned of [false,true]){
   const result=await h.api.adminLiveRequest(session,request,undefined,{assigned,page});
   assert.deepEqual(result.groups,groups);
   const call=h.calls.at(-1);
   assert.equal(call.url,'https://offline.invalid/rest/v1/rpc/'+(assigned?'dashboard_admin_execute':'dashboard_admin_live_drilldown'));
   assert.deepEqual(JSON.parse(call.init.body),assigned?{p_page:page,p_request:request}:{p_request:request});
  }
  const denied=load();
  for(const change of [{[flag]:false},{[flag]:'true'},{kind:'hourly'},{view:'full'},{action:'analysisOrders'},{hourRange:{minHour:0,maxHour:23}},{successStartAt:request.startAt,successEndAt:request.endAt},{successBasis:'source_updated'},
   ...(page==='amount'?[{amountBands:undefined},{amountBands:{charge:[100,100,...edges.slice(2)]}},{providerHourMatrix:true}]:[])]){
   await assert.rejects(denied.api.adminLiveRequest(session,{...request,...change},undefined,{assigned:false,page}));
  }
  assert.throws(()=>denied.api.validateAdminLiveRequest({action:'aggregatePrepared',requests:[request]}));
  for(const wrongPage of ['overview',other])for(const assigned of [false,true])
   await assert.rejects(denied.api.adminLiveRequest(session,request,undefined,{assigned,page:wrongPage}));
  assert.equal(denied.authCalls.length,0);assert.equal(denied.calls.length,0);
 });
 test(page+' frame sends only its active authorized matrix and cancels its pending read on navigation',async()=>{
  const h=load(),messages=[];
  const html=h.api.makeAdminLiveDocument('<!doctype html><html></html>','matrix-channel');
  const frame={parent:{postMessage:message=>messages.push(message)},setTimeout,clearTimeout,addEventListener(){}};
  frame.window=frame;vm.runInNewContext(html.match(/<script[^>]*>([\s\S]*?)<\/script>/i)[1],frame);
  let activePage=other;
  frame.hensemCurrentAdminPage=()=>activePage;
  frame.hensemRoleAccess={canView:true,mode:'assigned',permissions:['view','query','detail'].map(key=>page+'.'+key)};
  await assert.rejects(frame.hensemLiveRequest(request),error=>error.code==='ROLE_DENIED');
  activePage=page;
  frame.hensemRoleAccess.permissions.pop();
  await assert.rejects(frame.hensemLiveRequest(request),error=>error.code==='ROLE_DENIED');
  assert.equal(messages.length,0);
  frame.hensemRoleAccess.permissions.push(page+'.detail');
  const pending=frame.hensemLiveRequest(request);
  assert.equal(messages.length,1);assert.equal(messages[0].page,page);assert.deepEqual(messages[0].request,request);
  const stopped=assert.rejects(pending,error=>error.code==='ADMIN_LIVE_CANCELLED');
  activePage=other;frame.hensemLiveCancelRequests(['aggregate']);await stopped;
  assert.equal(messages.length,2);assert.equal(messages[1].id,messages[0].id);
 });
 test(page+' matrix message checks the current page view, query and detail permissions before reading',async()=>{
  for(const missing of ['view','query','detail',null]){
   const permissions=['view','query','detail'].filter(action=>action!==missing).map(action=>page+'.'+action);
   const h=load(),b=bridge(h,{roleAccess:()=>({mode:'assigned',canView:true,permissions})});
   const event=b.event('matrix',request);event.data.page=page;h.send(event);
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(h.calls.length,missing?0:1,missing||'allowed');assert.equal(b.replies.length,1);
   if(missing)assert.match(b.replies[0].data.error,/权限/);
   b.cleanup();
  }
 });
}
test('custom hour and amount request forwards exact half-open bounds to the dedicated drilldown RPC',async()=>{
 const h=load(),q={...base,hourRange:{minHour:1,maxHour:3},amountMin:200,amountMax:250,amountMaxExclusive:true};
 const value=h.api.validateAdminLiveRequest(q);assert.equal(JSON.stringify(value),JSON.stringify(q));
 await h.api.adminLiveRequest(session,q);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_drilldown');assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:q});
});
test('hour-only and amount-only intervals, full local day, one-sided amounts and exact inclusive values remain usable',()=>{
 const h=load();for(const extra of [{hourRange:{minHour:0,maxHour:24}},{hourRange:{minHour:23,maxHour:24}},{amountMin:200},{amountMax:250,amountMaxExclusive:true},{amountMin:200,amountMax:200,amountMaxExclusive:false},{amountMin:200,amountMax:250,amountMaxExclusive:true}])assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...base,...extra}));
});
test('malformed hour/amount bounds, forged authority and unsupported segment combinations fail before auth/network',async()=>{
 const h=load();for(const extra of [
  {},{hourRange:null},{hourRange:{}},{hourRange:[]},{hourRange:{minHour:1}},{hourRange:{minHour:'1',maxHour:3}},
  {hourRange:{minHour:1.5,maxHour:3}},{hourRange:{minHour:-1,maxHour:3}},{hourRange:{minHour:3,maxHour:3}},{hourRange:{minHour:24,maxHour:25}},{hourRange:{minHour:1,maxHour:3,authority:true}},
  {amountMin:250,amountMax:250,amountMaxExclusive:true},{amountMin:251,amountMax:250},{amountMax:Infinity},{amountMin:-1},{amountMin:100,amountMaxExclusive:true},{amountMin:100,amountMax:250,amountMaxExclusive:'true'},
  {hourRange:{minHour:1,maxHour:3},hour:2},{hourRange:{minHour:1,maxHour:3},bucket:'100'},{hourRange:{minHour:1,maxHour:3},cumulative:false},
  {hourRange:{minHour:1,maxHour:3},status:'success'},{hourRange:{minHour:1,maxHour:3},offset:20},{hourRange:{minHour:1,maxHour:3},durationVersion:2},{hourRange:{minHour:1,maxHour:3},token:'authority'}
 ])await assert.rejects(h.api.adminLiveRequest(session,{...base,...extra}));
 assert.equal(h.authCalls.length,0);assert.equal(h.calls.length,0);
});
test('new fields remain isolated from standard chart, catalog, details and latency requests',()=>{
 const h=load();for(const extra of [
  {...base,kind:'hourly',hour:1,hourRange:{minHour:1,maxHour:2}},
  {...base,kind:'hourly',hour:1,amountMax:250,amountMaxExclusive:true},
  {...base,kind:'latency',bucket:0,hourRange:{minHour:1,maxHour:2}},
  {...query,hourRange:{minHour:1,maxHour:2}},
  {...base,view:'full',hourRange:{minHour:1,maxHour:2}},
  {action:'catalog',hourRange:{minHour:1,maxHour:2}}
 ])assert.throws(()=>h.api.validateAdminLiveRequest(extra));
 for(const extra of [{kind:'hourly',hour:1},{kind:'amount',bucket:'100'},{kind:'amount_range',bucket:'100–200'},{kind:'matrix',hour:1,bucket:'100'},{kind:'latency',bucket:0}])assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...base,...extra}));
});
