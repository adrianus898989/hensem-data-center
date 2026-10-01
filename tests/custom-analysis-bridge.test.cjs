// Verify real bridge validation/routing with synthetic sessions, never the network.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'admin-live-bridge.test.cjs'),req=createRequire(filename);
const context={require:req,__dirname,console,process,URL,AbortController,structuredClone};vm.createContext(context);
vm.runInContext(fs.readFileSync(filename,'utf8').split('\ntest(')[0]+'\nglobalThis.fixture={load,query,session};',context,{filename});
const {load,query,session}=context.fixture;
const base={...query,action:'aggregate',view:'drilldown',direction:'charge',status:'all',kind:'custom'};
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
