// Real shared controller and prepared/publication modules; synthetic responses only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const{harness,settle,deferred,aggregate,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,aggregate,P};')(require,__dirname);
const clone=value=>JSON.parse(JSON.stringify(value)),platform={...P,sourceName:'Synthetic native'};
const workorders=()=>({rows:[],total:0,byProvider:[{provider:'SyntheticPay',direction:'charge',uniqueOrderAmount:'9007199254740993.00000001',uniqueSuccessAmount:null,uniqueOrderCount:null,uniqueCoverage:{status:'unavailable',complete:false}}],byDirection:{charge:{uniqueOrderCount:null}},coverage:{complete:false,capturedPlatformDays:5,expectedPlatformDays:7},sourceUpdatedAt:'2026-10-18T01:23:45.123456Z'});
function prepared(q){return{version:q.publicationVersion||1,items:q.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-prepared',generation:1,computedAt:'2026-10-18T01:00:00Z',expiresAt:'2026-10-18T13:00:00Z',cutoff:request.endAt,calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:{...aggregate(platform,123),version:1,startAt:request.startAt,endAt:request.endAt,successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis,...(request.durationVersion?{durationVersion:request.durationVersion}:{})}}))};}
async function ready(page='providers'){
 const h=harness({ancillaryHandler:true,platforms:[platform],roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js'],beforeLive:c=>{c.TextEncoder=TextEncoder;}});await settle();h.setNow('2026-10-18T12:00:00Z');h.c.setPage(page);await settle();Object.assign(h.L,{country:'印度',from:'2026-10-11T00:00:00',to:'2026-10-17T23:59:59',successFrom:'2026-10-11T00:00:00',successTo:'2026-10-17T23:59:59',successBasis:'success'});let handler=()=>workorders();h.setHandler(q=>q.action==='workorders'?handler(q):q.action==='aggregatePrepared'?prepared(q):q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{});return{...h,workHandler:fn=>handler=fn};
}
const count=h=>h.calls.filter(q=>q.action==='workorders').length;
for(const page of ['providers','provider_payout'])test(page+': repeated live query reuses exact raw workorders and explicit refresh bypasses it',async()=>{
 const h=await ready(page);await h.c.liveQuery();await settle();assert.equal(count(h),1);const expected=clone(h.L.workorders);await h.c.liveQuery();await settle();assert.equal(count(h),1);assert.deepEqual(clone(h.L.workorders),expected);assert.equal(h.L.workorders.byProvider[0].uniqueOrderAmount,'9007199254740993.00000001');assert.equal(h.L.workorders.byProvider[0].uniqueSuccessAmount,null);assert.equal(h.L.workorders.coverage.complete,false);assert.equal(h.L.workorders.sourceUpdatedAt,'2026-10-18T01:23:45.123456Z');await h.c.liveRefresh();await settle();assert.equal(count(h),2);
});
test('provider unions stay independent; returning to an exact union within the TTL reuses its JSON',async()=>{
 const h=await ready();await h.c.liveQuery();h.c.liveSet('provider','SyntheticPay');await h.c.liveQuery();assert.equal(count(h),2);assert.deepEqual(h.calls.filter(q=>q.action==='workorders').map(q=>q.providers||[]),[[],['SyntheticPay']]);h.c.liveSet('provider','');await h.c.liveQuery();assert.equal(count(h),2,'all-provider unique counts are never rebuilt from a selected provider');
});
test('independent success-window edits do not change the whole-day workorder RPC, while creation dates do',async()=>{
 const h=await ready();await h.c.liveQuery();h.c.liveMetricTimeSet('successFrom','2026-10-10T00:00:00');await h.c.liveQuery();assert.equal(count(h),1);h.c.liveMetricTimeSet('from','2026-10-12T00:00:00');await h.c.liveQuery();assert.equal(count(h),2);assert.equal(h.calls.filter(q=>q.action==='workorders').at(-1).startAt,'2026-10-12T00:00:00.000Z');
});
test('single-attachment retry bypasses the exact cache without rereading payment aggregates',async()=>{
 const h=await ready();await h.c.liveQuery();const n=h.calls.length;await h.c.liveProviderWorkordersRetry();await settle();assert.deepEqual(h.calls.slice(n).map(q=>q.action),['workorders']);assert.equal(count(h),2);
});
test('overlapping same-page exact pagination reads share one whole-scope RPC and current waiter owns the paint',async()=>{
 const h=await ready();await h.c.liveQuery();const wait=deferred();h.workHandler(()=>wait.promise);h.c.livePage(2,'workorders');h.c.livePage(2,'workorders');await settle();assert.equal(count(h),2);wait.resolve(workorders());await settle();assert.equal(h.L.workordersPage,2);assert.equal(h.L.workordersLoading,false);assert.equal(h.L.workorders.sourceUpdatedAt,workorders().sourceUpdatedAt);
});
test('filter/navigation cancellation rejects late workorders and cannot seed a later exact cache',async()=>{
 const h=await ready(),wait=deferred();h.workHandler(()=>wait.promise);const old=h.c.liveQuery();await settle();assert.equal(count(h),1);h.c.liveSet('provider','SyntheticPay');wait.resolve(workorders());await old;await settle();assert.equal(h.L.workorders,null);h.workHandler(()=>workorders());h.c.liveSet('provider','');await h.c.liveQuery();assert.equal(count(h),2);h.c.setPage('provider_payout');await settle();await h.c.liveQuery();assert.equal(count(h),3,'a different page/permission context cannot reuse the provider page entry');
});
test('partial calculation is an attachment error and never becomes a cached successful result',async()=>{
 const h=await ready();h.workHandler(()=>workorders()&&{...workorders(),partial:true});await h.c.liveQuery();assert.equal(h.L.workorders,null);assert.match(h.L.workordersError,/返回未完成/);await h.c.liveQuery();assert.equal(count(h),2);h.workHandler(()=>workorders());await h.c.liveProviderWorkordersRetry();assert.equal(count(h),3);assert(h.L.workorders);
});
test('a workorder permission failure clears completed peers before another exact provider scope can reuse them',async()=>{
 const h=await ready();await h.c.liveQuery();h.c.liveSet('provider','SyntheticPay');h.workHandler(()=>{throw Object.assign(Error('denied'),{code:'42501'});});await h.c.liveQuery();assert.equal(h.L.workorders,null);h.c.liveSet('provider','');h.workHandler(()=>workorders());await h.c.liveQuery();assert.equal(count(h),3);
});
test('published and live paths use the same controller cache rather than two attachment stores',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');assert.doesNotMatch(source,/function publishedAttachment\(|function rememberPublishedAttachment\(|attachments:reuse\?/);assert.match(source,/await workordersLoad\(false,true,force\)/);assert.match(source,/return workordersLoad\(true,inPhase,retry\)/);
});
