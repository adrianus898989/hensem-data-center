// Real shared page controller, synthetic server publications; no timing claims.
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
for(const page of ['overview','success_analysis','providers','provider_payout','merchants','collection','payout','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms'])test(page+': shared query reads published exact dual windows, without raw queries or clock intersection',async()=>{
 const h=await ready(page);await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert(h.calls.some(q=>q.action==='aggregatePrepared'));
 const q=h.calls.find(q=>q.action==='aggregatePrepared').requests[0];assert.equal(q.startAt,'2026-09-21T18:30:00.000Z');assert.equal(q.endAt,'2026-09-22T00:30:00.000Z');assert.equal(q.successStartAt,'2026-09-20T00:30:00.000Z');assert.equal(q.successEndAt,'2026-09-21T00:30:01.000Z');assert.equal(q.successBasis,'source_updated');
 assert.equal(h.L.results.length,1);assert.equal(h.L.results[0].summary[0].all_count,123);assert.equal(h.L.results[0]._preparedPublication.sourceComplete,false);
 assert.equal((h.nodes.get('liveFilters').innerHTML.match(/type="datetime-local"/g)||[]).length,4);
});
test('editing a clock preserves the last rendered result and sends nothing until Query; restoring a tab retains all four fields',async()=>{
 const h=await ready('time');await h.c.liveQuery();await settle();const old=h.html(),n=h.calls.length;
 h.c.liveMetricTimeSet('successFrom','2026-09-19T06:00:00');assert.equal(h.calls.length,n);assert(h.html().includes(old));assert.match(h.html(),/inert aria-label="上次查询结果"/);assert.equal(h.L.from,'2026-09-22T00:00:00');
 h.c.setPage('amount');h.c.setPage('time');assert.equal(h.L.successFrom,'2026-09-19T06:00:00');assert.equal(h.L.successBasis,'source_updated');
 await h.c.liveQuery();await settle();assert(h.calls.slice(n).some(q=>q.action==='aggregatePrepared'&&q.requests.some(x=>x.successStartAt==='2026-09-19T00:30:00.000Z')));
});
test('missing prepared data does not fall back to per-platform raw scans or become zero complete statistics',async()=>{
 const h=await ready();h.setHandler(q=>q.action==='aggregatePrepared'?response(q,'building'):{});await h.c.liveQuery();await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,1);assert.match(h.L.queryFailures[0].message,/正在准备/);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
});
test('navigation aborts prepared transport and a late publication cannot replace the new page',async()=>{
 const h=await ready('time'),wait=deferred();let signal,request;
 h.c.hensemLiveRequest=(q,options={})=>{h.calls.push(q);if(q.action==='aggregatePrepared'){signal=options.signal;request=q;return wait.promise;}return Promise.resolve({});};
 const run=h.c.liveQuery();await settle();assert(signal);h.c.setPage('amount');assert.equal(signal.aborted,true);wait.resolve(response(request));await run;await settle();assert.equal(h.L.results.length,0);assert.equal(h.c.state.page,'amount');
});
test('a changed native authorization catalog cannot reveal retained result markup',async()=>{
 const h=await ready('time');await h.c.liveQuery();await settle();assert(h.L.retainedContent);h.c.liveMetricTimeSet('to','2026-09-22T04:00:00');h.L.catalog=[];h.c.render();assert.doesNotMatch(h.html(),/inert aria-label="上次查询结果"/);
});

test('expired v2 statistics keep their real timestamp and explicit refresh is distinct from Query',async()=>{
 const h=await ready('time');h.setHandler(q=>{if(q.action!=='aggregatePrepared')return {};const r=response(q);r.items.forEach(x=>Object.assign(x.publication,{expiresAt:'2026-09-23T11:59:30Z',freshness:'refresh_due',refreshState:'running'}));return r;});
 await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.equal(h.L.results[0]._preparedPublication.computedAt,'2026-09-23T11:59:00Z');assert(h.calls.filter(q=>q.action==='aggregatePrepared').every(q=>q.publicationVersion===2&&!q.forceRefresh));assert.match(h.nodes.get('liveFilters').innerHTML,/更新于.*更新中/);
 const n=h.calls.length;await h.c.liveRefresh();await settle();assert(h.calls.slice(n).some(q=>q.action==='aggregatePrepared'&&q.forceRefresh===true));assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
});
test('loading and transient failure retain inert previous-scope content; semantic drift and access denial clear it',async()=>{
 const h=await ready('time');await h.c.liveQuery();await settle();assert(h.L.retainedContent);const old=h.L.retainedContent.html,wait=deferred();h.setHandler(q=>q.action==='aggregatePrepared'?wait.promise:{});
 h.c.liveMetricTimeSet('from','2026-09-21T00:00:00');const run=h.c.liveQuery();await settle();assert.match(h.html(),/正在读取所选范围/);assert(h.html().includes(old));assert.match(h.html(),/2026-09-22T00:00:00/);wait.reject(Error('network temporary'));await run;await settle();assert.match(h.html(),/本次读取未完成/);assert(h.html().includes(old));
 h.setHandler(q=>q.action==='aggregatePrepared'?response(q,'stale'):{});await h.c.liveQuery();await settle();assert.equal(h.L.retainedContent,null);assert.doesNotMatch(h.html(),/live-retained-result/);
 h.setHandler(q=>q.action==='aggregatePrepared'?response(q):{});await h.c.liveQuery();await settle();assert(h.L.retainedContent);h.setHandler(q=>{if(q.action==='aggregatePrepared')throw Object.assign(Error('denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});return {};});await h.c.liveRefresh();await settle();assert.equal(h.L.retainedContent,null);assert.equal(h.L.results.length,0);assert.doesNotMatch(h.html(),/live-retained-result/);
});

test('an expired artifact before its scheduled refresh has a planned label without changing freshness or validation',async()=>{
 for(const [nextRefreshAt,refreshState,label]of [['2026-09-23T14:30:00Z','idle','按计划更新'],['2026-09-23T11:30:00Z','idle','待更新'],[null,'idle','待更新'],['2026-09-23T14:30:00Z','queued','更新中'],['2026-09-23T14:30:00Z','running','更新中'],['2026-09-23T14:30:00Z','failed','更新未完成']]){
  const h=await ready('time');h.setHandler(q=>{if(q.action!=='aggregatePrepared')return {};const r=response(q);r.items.forEach(x=>Object.assign(x.publication,{expiresAt:'2026-09-23T11:59:30Z',freshness:'fresh',refreshState,nextRefreshAt}));return r;});
  await h.c.liveQuery();await settle();const p=h.L.results[0]._preparedPublication,html=h.nodes.get('liveFilters').innerHTML;assert.equal(p.freshness,'refresh_due');assert.equal(p.expiresAt,'2026-09-23T11:59:30Z');assert.equal(p.nextRefreshAt,nextRefreshAt);assert.match(html,new RegExp('定时汇总.*更新于.* · '+label));if(label==='按计划更新')assert.doesNotMatch(html,/ · 待更新/);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
 }
});
