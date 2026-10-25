// Shared real page controller, prepared manager and render modules. Synthetic read counts, not real timings.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,completeAggregate,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,completeAggregate,P};')(require,__dirname);
const platforms=Array.from({length:43},(_,i)=>({...P,id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),name:'Synthetic '+i,sourceName:'Native '+i}));
const mainStart='2026-09-21T18:30:00.000Z',priorStart='2026-09-20T18:30:00.000Z';
const reads=h=>h.calls.filter(q=>q.action==='aggregatePrepared');
function result(p){return {version:2,...(p.readMode?{readMode:p.readMode}:{}),items:p.requests.map(request=>{
 const r={...completeAggregate(platforms.find(n=>n.id===request.platformId),100,40),version:1,startAt:request.startAt,endAt:request.endAt,...(request.successBasis==='created'?{successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false}}:{successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis})};
 if(request.amountBands)Object.assign(r.groups,{amount_range:[],matrix_range:[]});
 const v={request,status:'ready',publication:{id:'synthetic-'+request.platformId+'-'+request.startAt,generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:00:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:r};
 if(p.responseProfile){assert.equal(p.responseProfile,'time-v1');r.groups={hourly:r.groups.hourly,provider:r.groups.provider};v.resultGroups={contract:'prepared-result-groups-v1',profile:'time-v1',groups:['hourly','provider']};}return v;
 })};}
const other=q=>q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{};
function dates(h){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',successFrom:'',successTo:''});}
async function setup(page,count=43){const h=harness({page,platforms:platforms.slice(0,count),roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js'],beforeLive:c=>{c.HENSEM_PREPARED_READY_ONLY=true;}});await settle();dates(h);h.setHandler(q=>q.action==='aggregatePrepared'?result(q):other(q));return h;}
for(const page of ['teamops','teamcountries','teamplatforms'])test(page+' full current and provider comparison use two exact probes for 43 platforms',async()=>{
 const h=await setup(page);await h.c.liveQuery();await settle();assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.length,43);assert.equal(h.L.comparisonResults.length,43);assert.equal(h.L.comparisonStatus,'ready');assert.equal(reads(h).length,2);assert.deepEqual(reads(h).map(q=>q.requests.length),[43,43]);assert(reads(h).every(q=>q.readMode==='ready-only-v1'));
 assert.equal(reads(h)[0].responseProfile,'time-v1');assert.equal(reads(h)[1].responseProfile,undefined);assert.equal(reads(h)[0].requests[0].startAt,mainStart);assert.equal(reads(h)[1].requests[0].startAt,priorStart);assert.equal(h.L.results[0]._preparedPublication.sourceComplete,false);assert.deepEqual(Object.keys(h.L.results[0].groups).sort(),['hourly','provider']);assert.match(h.html(),/Synthetic/);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
 const n=reads(h).length;h.c.render();h.c.liveReferenceSet('view','trend');await settle();assert.equal(reads(h).length,n,'team trend uses existing hourly projection');assert.match(h.html(),/趋势|国家/);
});
for(const page of ['merchants','overview','provider_payout'])test(page+' provider DTO retains semantics and batches main and prior',async()=>{
 const h=await setup(page);await h.c.liveQuery();await settle();assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.length,43);assert.equal(h.L.comparisonStatus,'ready');const r=reads(h);assert.equal(r.length,2);assert(r.every(q=>q.readMode==='ready-only-v1'&&!q.responseProfile&&q.requests.length===43&&q.requests.every(x=>x.view==='providers')));assert.equal(h.L.results[0]._preparedPublication.sourceComplete,false);
});
test('time full projection probes only the main query; provider comparison retains old bounded chain',async()=>{
 const h=await setup('time',7);await h.c.liveQuery();await settle();assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.length,7);assert.equal(reads(h).filter(q=>q.readMode).length,1);assert.equal(reads(h)[0].responseProfile,'time-v1');assert(reads(h).filter(q=>!q.readMode).every(q=>q.requests.length<=3));assert(Array.isArray(h.L.results[0].groups.hourly));
});
test('mixed compact probe preserves ready peers and retries only exact missing requests in bounded original queue',async()=>{
 const h=await setup('teamops',7);h.setHandler(q=>{if(q.action!=='aggregatePrepared')return other(q);const e=result(q);if(q.readMode&&q.responseProfile)e.items=e.items.map((v,i)=>i<3?{request:v.request,status:'miss',reason:'ready_head_missing',result:null,publication:null}:v);return e;});await h.c.liveQuery();await settle();assert.equal(h.L.results.length,7);assert.equal(h.L.comparisonResults.length,7);const ordinary=reads(h).filter(q=>!q.readMode);assert.equal(ordinary.length,1);assert.equal(ordinary[0].requests.length,3);assert.equal(ordinary[0].responseProfile,'time-v1');assert(ordinary[0].requests.every(q=>platforms.slice(0,3).some(p=>p.id===q.platformId)));
});
for(const kind of ['force','two-days','partial-day','independent-success','today'])test('teamops '+kind+' never probes unsupported scopes',async()=>{
 const h=await setup('teamops',2);if(kind==='two-days')h.L.from='2026-09-21T00:00:00';if(kind==='partial-day')h.L.to='2026-09-22T05:59:59';if(kind==='independent-success'){h.L.successFrom='2026-09-20T00:00:00';h.L.successTo='2026-09-20T23:59:59';}if(kind==='today'){h.L.from='2026-09-23T00:00:00';h.L.to='2026-09-23T23:59:59';}await (kind==='force'?h.c.liveRefresh():h.c.liveQuery());await settle();assert.equal(reads(h).filter(q=>q.readMode).length,0);assert(reads(h).length>0);
});
test('merchants trend and overview analysis keep full DTO and original chain',async()=>{
 const m=await setup('merchants',2);await m.c.liveQuery();await settle();const start=reads(m).length;await m.c.liveReferenceSet('view','trend');await settle();const trend=reads(m).slice(start);assert(trend.length>0);assert(trend.every(q=>!q.readMode&&!q.responseProfile&&q.requests.every(r=>(r.view||'full')==='full')));assert(m.L.merchantTrend.results.every(r=>Array.isArray(r.groups.matrix)));
 const o=await setup('overview',2);o.L.overviewAnalysis=true;await o.c.liveQuery();await settle();const full=reads(o).filter(q=>q.requests.some(r=>(r.view||'full')==='full'));assert(full.length>0);assert(full.every(q=>!q.readMode&&!q.responseProfile));
});
for(const transition of ['page','filter','authority'])test('late compact primary after '+transition+' cannot overwrite next page scope',async()=>{
 const h=await setup('teamops',1),late=deferred();h.setHandler(q=>q.action==='aggregatePrepared'?late.promise:other(q));const old=h.c.liveQuery();await settle();const oldq=reads(h)[0];
 if(transition==='page'){h.c.setPage('time');dates(h);}else if(transition==='filter'){h.c.liveMetricTimeSet('from','2026-09-21T00:00:00');h.c.liveMetricTimeSet('to','2026-09-21T23:59:59');}else h.c.hensemDataScope={mode:'selected',identity:'new-authority'};
 h.setHandler(q=>q.action==='aggregatePrepared'?result(q):other(q));await h.c.liveQuery();await settle();const serial=h.L.serial,snapshot=JSON.stringify(h.L.results),html=h.html();late.resolve(result(oldq));await old;await settle();assert.equal(h.L.serial,serial);assert.equal(JSON.stringify(h.L.results),snapshot);if(transition==='authority'){assert.equal(h.L.results.length,0,'obsolete authority never publishes');await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);}else assert.equal(h.html(),html);
});
