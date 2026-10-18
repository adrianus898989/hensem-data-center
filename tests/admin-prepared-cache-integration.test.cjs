// Shared prepared-cache integration; synthetic publications, no latency claims.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,aggregate,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,aggregate,P};')(require,__dirname);
const platform={...P,sourceName:'Synthetic native'};
function result(q){return {...aggregate(platform,123),version:1,startAt:q.startAt,endAt:q.endAt,successStartAt:q.successStartAt,successEndAt:q.successEndAt,successBasis:q.successBasis,...(q.durationVersion?{durationVersion:q.durationVersion}:{})};}
function response(q,status='ready'){return {version:q.publicationVersion||1,items:q.requests.map(request=>({request,status,publication:{id:'synthetic-publication',generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,...(q.publicationVersion===2?{freshness:'fresh',refreshState:'idle'}:{})},result:status==='ready'?result(request):null}))};}
async function ready(page='overview'){
 const h=harness({platforms:[platform],roleAccess:{mode:'owner',canView:true,permissions:[]},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-success-analysis.js'],beforeLive:c=>{c.TextEncoder=TextEncoder;}});await settle();h.c.setPage(page);await settle();
 Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',successFrom:'2026-09-20T06:00:00',successTo:'2026-09-21T06:00:00',successBasis:'source_updated'});
 h.setHandler(q=>q.action==='aggregatePrepared'?response(q):q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{});return h;
}

for(const page of ['overview','success_analysis','providers','provider_payout','merchants','collection','payout','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms'])test(page+': repeating an exact query reuses a validated publication and explicit refresh reads again',async()=>{
 const h=await ready(page);await h.c.liveQuery();await settle();const reads=h.calls.filter(q=>q.action==='aggregatePrepared').length;assert(reads>0);const publication=JSON.stringify(h.L.results[0]._preparedPublication);
 await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,reads);assert.equal(JSON.stringify(h.L.results[0]._preparedPublication),publication);assert.equal(h.L.results.length,1);
 await h.c.liveRefresh();await settle();assert(h.calls.filter(q=>q.action==='aggregatePrepared').length>reads);assert(h.calls.some(q=>q.action==='aggregatePrepared'&&q.forceRefresh));
});
test('query cancellation preserves complete exact results but changed clocks cannot reuse them',async()=>{
 const h=await ready('time');await h.c.liveQuery();await settle();const n=h.calls.filter(q=>q.action==='aggregatePrepared').length;
 h.c.liveMetricTimeSet('to','2026-09-22T04:00:00');h.c.liveMetricTimeSet('to','2026-09-22T05:59:59');await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,n);
 h.c.liveMetricTimeSet('successFrom','2026-09-19T06:00:00');await h.c.liveQuery();await settle();assert(h.calls.filter(q=>q.action==='aggregatePrepared').length>n);assert(h.calls.filter(q=>q.action==='aggregatePrepared').slice(n).some(q=>q.requests.some(x=>x.successStartAt==='2026-09-19T00:30:00.000Z')));
});
test('denied prepared reads invalidate earlier completed exact results',async()=>{
 const h=await ready('time');await h.c.liveQuery();await settle();const original=JSON.stringify(h.calls.find(q=>q.action==='aggregatePrepared').requests[0]),count=()=>h.calls.filter(q=>q.action==='aggregatePrepared').flatMap(q=>q.requests).filter(q=>JSON.stringify(q)===original).length;assert.equal(count(),1);
 h.c.liveMetricTimeSet('to','2026-09-22T04:00:00');h.setHandler(q=>{if(q.action==='aggregatePrepared')throw Object.assign(Error('denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});return {};});await h.c.liveQuery();await settle();assert.equal(h.L.results.length,0);
 h.setHandler(q=>q.action==='aggregatePrepared'?response(q):{});h.c.liveMetricTimeSet('to','2026-09-22T05:59:59');await h.c.liveQuery();await settle();assert.equal(count(),2);
});
test('routine directory details collapse, while coverage and real timestamps remain visible',async()=>{
 const h=await ready('time');let filters=h.nodes.get('liveFilters').innerHTML;const details=filters.match(/<details class="live-scope-description">[\s\S]*?<\/details>/);assert(details);assert.doesNotMatch(details[0],/\bopen(?:[ =>])/);assert.match(details[0],/可选目录/);assert.doesNotMatch(filters.replace(details[0],''),/手动查询更新|订单目录/);
 await h.c.liveQuery();await settle();filters=h.nodes.get('liveFilters').innerHTML.replace(/<details class="live-scope-description">[\s\S]*?<\/details>/,'');assert.match(filters,/所选日期有订单数据 1 平台/);assert.match(filters,/更新于/);
});

test('provider-only reads discard unused amount-band profiles retained by other pages, while full analysis preserves them',async()=>{
 const profiles={charge:{edges:[100,200,300,400,500,1000,2000,5000,10000,20000,50000]},withdraw:{edges:[100,200,300,400,500,1000,2000,5000,10000,20000,50000]}};
 for(const page of ['providers','provider_payout','overview','amount']){const h=await ready(page);h.L.amountBandProfiles=profiles;await h.c.liveQuery();await settle();const requests=h.calls.filter(q=>q.action==='aggregatePrepared').flatMap(q=>q.requests);assert(requests.length>0);for(const q of requests){if(q.view==='providers')assert.equal(Object.hasOwn(q,'amountBands'),false,'provider-only ABI is independent of prior analysis profiles');else assert.deepEqual(JSON.parse(JSON.stringify(q.amountBands)),{charge:profiles.charge.edges,withdraw:profiles.withdraw.edges});}}
});
