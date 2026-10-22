/* Real shared controller/renderers; synthetic prepared facts, no live timing claim. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,completeAggregate,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,completeAggregate,P};')(require,__dirname);
const native={...P,sourceName:'Synthetic native'};
const currentStart='2026-09-21T18:30:00.000Z',previousStart='2026-09-20T18:30:00.000Z';
function response(q){return {version:2,items:q.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-'+request.startAt,generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:{...completeAggregate(native,100,40),version:1,startAt:request.startAt,endAt:request.endAt,...(request.successBasis==='created'?{successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false}}:{successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis}),...(request.durationVersion?{durationVersion:request.durationVersion}:{})}}))};}
const prepared=h=>h.calls.filter(q=>q.action==='aggregatePrepared');
const requests=h=>prepared(h).flatMap(q=>q.requests);
const main=h=>requests(h).filter(q=>q.startAt===currentStart);
const previous=h=>requests(h).filter(q=>q.startAt===previousStart);
function ancillary(q){return q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{};}
function setDates(h){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',successFrom:'',successTo:''});}
async function setup(page,options={}){
 const h=harness({page,platforms:[native],roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js'],...options});await settle();setDates(h);
 h.setHandler(q=>q.action==='aggregatePrepared'?response(q):ancillary(q));return h;
}
for(const page of ['risk','latency'])test(page+': formal renderer never requests unused previous-period aggregates, retaining current facts and expected fee reads',async()=>{
 const h=await setup(page);await h.c.liveQuery();await settle();
 assert.equal(main(h).length,1);assert.equal(previous(h).length,0);assert.equal(requests(h).length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
 assert.equal(h.L.results.length,1);assert.equal(h.L.results[0].summary[0].all_count,100);assert.equal(h.L.comparisonStatus,'idle');assert.equal(h.L.comparisonResults.length,0);
 assert.equal(h.calls.filter(q=>q.action==='rates').length,page==='risk'?1:0,'only the existing risk fee consumer reads rates');
 assert.match(h.html(),page==='risk'?/三方风险矩阵/:/data-duration-page="latency"/);
 const html=h.html();h.L.comparisonResults=[completeAggregate(native,999,888)];h.L.comparisonStatus='ready';h.c.render();await settle();assert.equal(h.html(),html,'formal content has no previous-period consumer');
 const count=prepared(h).length;await h.c.liveQuery();await settle();assert.equal(prepared(h).length,count,'repeat query reuses exact current facts');
 await h.c.liveRefresh();await settle();assert.equal(main(h).length,2);assert.equal(previous(h).length,0,'refresh still does not launch the unused wave');
});
for(const page of ['overview','providers','provider_payout','merchants','collection','payout','time','amount','matrix','provider_daily','teamops','teamcountries','teamplatforms'])test(page+': an actual comparison consumer still reads current and previous periods',async()=>{
 const h=await setup(page);await h.c.liveQuery();await settle();assert.equal(main(h).length,1);assert.equal(previous(h).length,1);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.comparisonResults.length,1);
});
for(const page of ['risk','latency'])test(page+': older renderer without an explicit consumer declaration preserves comparison compatibility',async()=>{
 const h=await setup(page,{beforeLive:c=>{const key=page==='risk'?'HensemLivePages':'HensemLiveDuration';c[key]={create:c[key].create};}});await h.c.liveQuery();await settle();assert.equal(main(h).length,1);assert.equal(previous(h).length,1);assert.equal(h.L.comparisonStatus,'ready');
});
for(const page of ['risk','latency'])test(page+': active totals fallback keeps its previous-period read',async()=>{
 const h=await setup(page,{beforeLive:c=>{if(page==='latency')c.HensemLiveDuration=undefined;else c.HensemLivePages={create:()=>({render:()=>null})};}});await h.c.liveQuery();await settle();assert.equal(main(h).length,1);assert.equal(previous(h).length,1);assert.equal(h.L.comparisonStatus,'ready');assert.match(h.html(),/kpi-value/);
});
for(const page of ['risk','latency'])test('navigating from an unfinished comparison to '+page+' cannot leak the old wave or overwrite current facts',async()=>{
 const h=await setup('time'),late=deferred();let oldComparison;
 h.setHandler(q=>{if(q.action!=='aggregatePrepared')return ancillary(q);if(q.requests.some(r=>r.startAt===previousStart)){oldComparison=q;return late.promise;}return response(q);});
 const oldRun=h.c.liveQuery();await settle();assert(oldComparison);assert.equal(h.L.comparisonStatus,'loading');
 h.c.setPage(page);setDates(h);h.setHandler(q=>q.action==='aggregatePrepared'?response(q):ancillary(q));const first=prepared(h).length;await h.c.liveQuery();await oldRun;await settle();
 assert.equal(h.c.state.page,page);assert.equal(h.L.comparisonStatus,'idle');assert.equal(h.L.comparisonResults.length,0);assert(prepared(h).slice(first).every(q=>q.requests.every(r=>r.startAt===currentStart)));
 const html=h.html(),count=prepared(h).length;late.resolve(response(oldComparison));await settle();assert.equal(h.html(),html);assert.equal(prepared(h).length,count);assert.equal(h.L.results[0].summary[0].all_count,100);
});
for(const page of ['risk','latency'])test('leaving pending '+page+' before it completes still lets the destination read its own comparison',async()=>{
 const h=await setup(page),late=deferred();let oldRequest;
 h.setHandler(q=>{if(q.action==='aggregatePrepared'){oldRequest=q;return late.promise;}return ancillary(q);});const oldRun=h.c.liveQuery();await settle();assert(oldRequest);assert.equal(h.L.loading,true);
 h.c.setPage('amount');setDates(h);h.setHandler(q=>q.action==='aggregatePrepared'?response(q):ancillary(q));const first=prepared(h).length;await h.c.liveQuery();await oldRun;await settle();
 assert.equal(h.c.state.page,'amount');assert.equal(h.L.comparisonStatus,'ready');assert.equal(prepared(h).slice(first).flatMap(q=>q.requests).filter(q=>q.startAt===previousStart).length,1);
 const html=h.html(),count=prepared(h).length;late.resolve(response(oldRequest));await settle();assert.equal(h.html(),html);assert.equal(prepared(h).length,count);
});
