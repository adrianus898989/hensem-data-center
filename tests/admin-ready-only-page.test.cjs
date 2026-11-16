/* Real providers controller and prepared manager. Synthetic complete DTOs and deferred IO. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,completeAggregate,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,completeAggregate,P};')(require,__dirname);
const platforms=Array.from({length:19},(_,i)=>({...P,id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),name:'Synthetic '+i,sourceName:'Native '+i}));
const mainStart='2026-09-21T18:30:00.000Z',priorStart='2026-09-20T18:30:00.000Z';
const reads=h=>h.calls.filter(q=>q.action==='aggregatePrepared');
function result(p,expired=false){return {version:2,...(p.readMode?{readMode:p.readMode}:{}),items:p.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-'+request.platformId+'-'+request.startAt,generation:1,computedAt:expired?'2026-09-23T11:00:00Z':'2026-09-23T11:59:00Z',expiresAt:expired?'2026-09-23T11:10:00Z':'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:00:00Z',calculationComplete:true,sourceComplete:false,freshness:expired?'refresh_due':'fresh',refreshState:expired?'failed':'idle'},result:{...completeAggregate(platforms.find(n=>n.id===request.platformId),100,40),version:1,startAt:request.startAt,endAt:request.endAt,...(request.successBasis==='created'?{successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false}}:{successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis})}}))};}
const other=q=>q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{};
function dates(h){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',successFrom:'',successTo:''});}
async function setup({enabled=true,count=19,manual=false}={}){const h=harness({page:'providers',platforms:platforms.slice(0,count),roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js'],beforeLive:c=>{if(enabled)c.HENSEM_PREPARED_READY_ONLY=true;}});await settle();dates(h);if(manual){h.L.successFrom=h.L.from;h.L.successTo=h.L.to;}h.setHandler(q=>q.action==='aggregatePrepared'?result(q,!!q.readMode):other(q));return h;}

test('19 same-window manual success primaries render from one probe, while comparison/fees complete before same-queue refresh is released',async()=>{
 const h=await setup({manual:true}),rates=deferred();h.setHandler(q=>q.action==='aggregatePrepared'?result(q,!!q.readMode):q.action==='rates'?rates.promise:other(q));const run=h.c.liveQuery();await settle();
 assert.equal(h.L.results.length,19);assert.equal(h.L.loading,false);assert.equal(h.L.comparisonStatus,'ready');assert.equal(reads(h).length,8);assert.equal(reads(h).filter(q=>!q.readMode&&q.requests[0].startAt===mainStart).length,0,'held fees still prevent background refresh dispatch');assert.equal(reads(h)[0].readMode,'ready-only-v1');assert.equal(reads(h)[0].requests.length,19);assert.match(h.html(),/三方汇总/);assert.equal(h.L.results[0]._preparedPublication.sourceComplete,false);assert.equal(h.L.results[0]._preparedPublication.expiresAt,'2026-09-23T11:10:00Z');
 rates.resolve({rows:[],total:0});await run;await settle();const all=reads(h),comparison=all.filter(q=>q.requests[0].startAt===priorStart),refresh=all.filter(q=>!q.readMode&&q.requests[0].startAt===mainStart);assert.equal(comparison.length,7);assert.equal(refresh.length,7);assert(comparison.every(q=>!q.readMode&&q.requests.length<=3));assert(refresh.every(q=>!q.forceRefresh&&q.requests.length<=3));assert(all.indexOf(refresh[0])>all.indexOf(comparison.at(-1)));assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.results.length,19);assert.equal(h.L.results[0]._preparedPublication.expiresAt,'2026-09-23T11:10:00Z','background never rewrites visible publication metadata');
});
test('all-miss manual probe falls back once, and no other phase probes again',async()=>{
 const h=await setup({manual:true});h.setHandler(q=>q.action!=='aggregatePrepared'?other(q):q.readMode?{version:2,readMode:q.readMode,items:q.requests.map(request=>({request,status:'miss',reason:'ready_head_missing',result:null,publication:null}))}:result(q));await h.c.liveQuery();await settle();assert.equal(h.L.results.length,19);assert.equal(reads(h).filter(q=>q.readMode).length,1);assert.equal(reads(h).filter(q=>!q.readMode&&q.requests[0].startAt===mainStart).length,7);assert.equal(reads(h).filter(q=>q.requests[0].startAt===priorStart).length,7);
});
for(const code of ['ADMIN_LIVE_PERMISSION_DENIED','ADMIN_LIVE_CANCELLED'])test('background '+code+' reaches existing page-owner cleanup after the main promise completed',async()=>{
 const h=await setup({count:1}),late=deferred();h.setHandler(q=>q.action!=='aggregatePrepared'?other(q):q.readMode?result(q,true):q.requests[0].startAt===mainStart?late.promise:result(q));await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);const serial=h.L.serial;late.reject(Object.assign(Error('Synthetic late refresh rejection'),{code}));await settle();assert(h.L.serial>serial);assert.equal(h.L.loading,false);assert.equal(h.L.queryRetrying,false);if(code==='ADMIN_LIVE_PERMISSION_DENIED'){assert.equal(h.L.results.length,0);assert.match(h.L.error,/权限/);}else assert.equal(h.L.results.length,1);const n=reads(h).length;h.c.render();await settle();assert.equal(reads(h).length,n);
 if(code==='ADMIN_LIVE_PERMISSION_DENIED'){h.setHandler(q=>q.action==='aggregatePrepared'?result(q):other(q));await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.equal(reads(h).filter(q=>q.readMode).length,2,'denied authority must not retain its completed main cache');assert.equal(reads(h).filter(q=>q.requests[0].startAt===priorStart).length,2,'completed comparison cache is also cleared');}
});
for(const transition of ['page','filter','authority'])test('old background denial after '+transition+' cannot clear the newer query',async()=>{
 const h=await setup({count:1}),late=deferred();h.setHandler(q=>q.action!=='aggregatePrepared'?other(q):q.readMode?result(q,true):q.requests[0].startAt===mainStart?late.promise:result(q));await h.c.liveQuery();await settle();
 if(transition==='page'){h.c.setPage('time');dates(h);}else if(transition==='filter'){h.c.liveMetricTimeSet('from','2026-09-21T00:00:00');h.c.liveMetricTimeSet('to','2026-09-21T23:59:59');}else h.c.hensemDataScope={mode:'selected',identity:'new-authority'};
 h.setHandler(q=>q.action==='aggregatePrepared'?result(q):other(q));await h.c.liveQuery();await settle();const serial=h.L.serial,html=h.html(),snapshot=JSON.stringify(h.L.results);late.reject(Object.assign(Error('Old refresh denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await settle();assert.equal(h.L.serial,serial);assert.equal(JSON.stringify(h.L.results),snapshot);assert.equal(h.html(),html);
});
for(const kind of ['absent-capability','force','two-days','partial-day','independent-success','today','another-page'])test(kind+' retains the ordinary request chain without probing',async()=>{
 const h=await setup({enabled:kind!=='absent-capability',count:1});if(kind==='two-days')h.L.from='2026-09-21T00:00:00';if(kind==='partial-day')h.L.to='2026-09-22T05:59:59';if(kind==='independent-success'){h.L.successFrom='2026-09-20T00:00:00';h.L.successTo='2026-09-20T23:59:59';}if(kind==='today'){h.L.from='2026-09-23T00:00:00';h.L.to='2026-09-23T23:59:59';}if(kind==='another-page'){h.c.setPage('collection');dates(h);}await (kind==='force'?h.c.liveRefresh():h.c.liveQuery());await settle();assert.equal(reads(h).filter(q=>q.readMode).length,0);assert(reads(h).length>0);
});

test('a manual probe transport timeout releases the real page without falling back or dispatching supplemental work',async()=>{
 const h=await setup({manual:true}),pending=deferred();h.setHandler(q=>q.action==='aggregatePrepared'?pending.promise:other(q));const run=h.c.liveQuery();await settle();assert.equal(h.L.loading,true);assert.equal(reads(h).length,1);assert.equal(reads(h)[0].requests.length,19);pending.reject(Object.assign(Error('Synthetic host deadline'),{code:'ADMIN_LIVE_TIMEOUT'}));await run;await settle();assert.equal(h.L.loading,false);assert.equal(h.L.queryRetrying,false);assert.equal(h.L.results.length,0);assert.equal(reads(h).length,1);assert.equal(h.L.queryFailures.length,19);h.c.render();await settle();assert.equal(reads(h).length,1);
});


test('created-day collection returns a verified native subtotal before the remaining platforms settle',async()=>{
 const h=await setup(),flights=[];
 h.setHandler(q=>{
  if(!q.readMode)return q.action==='aggregatePrepared'?result(q):other(q);
  const gate=deferred();flights.push({q,gate});return gate.promise;
 });
 const run=h.c.liveQuery();await settle();
 assert.deepEqual(flights.map(f=>f.q.requests.length),[1,18]);
 const first=flights[0];first.gate.resolve(result(first.q));await settle();
 assert.equal(h.L.loading,true);
 assert.deepEqual(Array.from(h.L.results,r=>r.platform.id),[first.q.requests[0].platformId]);
 assert.equal(h.L.results[0].successBasis,'created');
 assert.equal(h.L.results[0]._preparedPublication.sourceComplete,false);
 await h.c.liveQuery();await settle();
 assert.equal(flights.length,2,'duplicate click reuses the active country query');
 for(let i=1;i<flights.length;i++){flights[i].gate.resolve(result(flights[i].q));await settle();}
 await run;
 assert.equal(h.L.results.length,19);
 const nativeIds=flights.flatMap(f=>Array.from(f.q.requests,q=>q.platformId));
 assert.deepEqual(nativeIds,platforms.map(p=>p.id));assert.equal(h.L.queryFailures.length,0);
 assert.equal(reads(h).filter(q=>!q.readMode&&q.requests[0].startAt===mainStart).length,0);
});

test('a created-day ready miss retries only that native through the ordinary reader',async()=>{
 const h=await setup(),absent=platforms[1].id;
 h.setHandler(q=>{
  if(q.action!=='aggregatePrepared')return other(q);
  const out=result(q);
  if(q.readMode)out.items=out.items.map(i=>i.request.platformId===absent?{request:i.request,status:'miss',reason:'ready_head_missing',publication:null,result:null}:i);
  return out;
 });
 await h.c.liveQuery();
 const main=reads(h).filter(q=>q.requests[0].startAt===mainStart);
 assert.deepEqual(main.filter(q=>!q.readMode).flatMap(q=>Array.from(q.requests,r=>r.platformId)),[absent]);
 assert.equal(h.L.results.length,19);
});

test('created-day exact heads can serve a repeated query beyond 30 seconds and expire on their original five-minute clock',async()=>{
 const h=await setup({count:1});
 h.setHandler(q=>q.action==='aggregatePrepared'?result(q):other(q));
 await h.c.liveQuery();
 const mainCount=()=>reads(h).filter(q=>q.requests[0].startAt===mainStart).length;
 assert.equal(mainCount(),1);h.setNow('2026-09-23T12:00:45Z');await h.c.liveQuery();
 assert.equal(mainCount(),1);assert.equal(h.L.results[0]._preparedPublication.computedAt,'2026-09-23T11:59:00Z');
 h.setNow('2026-09-23T12:05:00Z');await h.c.liveQuery();assert.equal(mainCount(),2);
});

for(const count of [1,2,3])test('small created cohort of '+count+' stays a single ready lookup',async()=>{
 const h=await setup({count});
 h.setHandler(q=>q.action==='aggregatePrepared'?result(q):other(q));await h.c.liveQuery();
 assert.deepEqual(reads(h).filter(q=>q.requests[0].startAt===mainStart).map(q=>q.requests.length),[count]);
});

test('a country-wide created cohort miss retries every native once with the ordinary bounded reader',async()=>{
 const h=await setup();
 h.setHandler(q=>{
  if(q.action!=='aggregatePrepared')return other(q);
  if(q.readMode)return {version:2,readMode:q.readMode,items:q.requests.map(request=>({request,status:'miss',reason:'ready_head_missing',publication:null,result:null}))};
  return result(q);
 });
 await h.c.liveQuery();
 const main=reads(h).filter(q=>q.requests[0].startAt===mainStart);
 assert.deepEqual(main.filter(q=>q.readMode).map(q=>q.requests.length),[1,18]);
 const ordinary=main.filter(q=>!q.readMode);
 assert(ordinary.every(q=>q.requests.length<=3));
 assert.deepEqual(ordinary.flatMap(q=>Array.from(q.requests,r=>r.platformId)).sort(),platforms.map(p=>p.id).sort());
 assert.equal(h.L.results.length,19);
});
