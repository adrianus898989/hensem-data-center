// Real host and supplementary modules; virtual deadlines test correctness, not speed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-heavy-read-phases.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup,advance,advanceAction,finish,settle,reply,deferred,aggregate,platforms}=new Function('require','__dirname',prefix+';return {setup,advance,advanceAction,finish,settle,reply,deferred,aggregate,platforms};')(require,__dirname);
async function fixture(prepared=false,extra={}){const timers=new Map();let next=0;const h=await setup('providers',{extraModules:prepared?['live-statistic-windows.js','live-prepared-aggregates.js']:[],beforeLive(c){c.setTimeout=(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id};c.clearTimeout=id=>timers.delete(id);extra.beforeLive?.(c);}});return {...h,timerMap:timers,deadline:()=>[...timers.values()].find(t=>t.ms===60000)};}
async function main(h){const run=h.c.liveQuery();await settle();assert(!h.deadline(),'waiting main reads do not spend the supplementary budget');for(let i=0;i<3;i++)await advance(h);return {run};}
async function expire(h){h.setNow('2026-09-23T12:01:00Z');const timer=h.deadline();assert(timer,'the completed main query owns one supplementary deadline');timer.fn();await settle();}
async function finishExclusions(h){for(let n=0;n<3;n++)await advanceAction(h,'submissionAnalysis');}
test('one 60s phase releases a stalled workorder, retains main/comparison/exclusions, and never starts later intake',async()=>{
 const h=await fixture(),{run}=await main(h);await advanceAction(h,'rates');await advanceAction(h,'workorders');for(let n=0;n<3;n++)await advanceAction(h,'aggregate');
 // Reuse a fresh workorder retry as the blocking branch while excluding a finished value.
 await finishExclusions(h);await finish(h,run);
 const next=h.c.liveQuery(true);await settle();for(let n=0;n<3;n++)await advance(h);await advanceAction(h,'rates');await finishExclusions(h);
 const count=h.history.length;assert(h.L.workordersLoading);await expire(h);await next;
 assert.equal(h.L.results.length,3);assert.equal(h.L.loading,false);assert.equal(h.L.workordersLoading,false);assert.match(h.L.workordersError,/补充统计.*60/);assert(!h.html().includes('live-read-phase'));assert.equal(h.controls.ready(),true);assert.equal(h.active(),0);assert.equal(h.history.length,count);assert(!h.history.slice(count).some(q=>q.action==='intakeCoverage'));assert.equal(h.deadline(),undefined);
});
test('deadline while fees and exclusions are pending aborts that phase without rendering an automatic new round',async()=>{
 const h=await fixture(),{run}=await main(h),pending=h.waiting.splice(0);assert.deepEqual(pending.map(x=>x.q.action).sort(),['rates','submissionAnalysis']);
 await expire(h);await run;
 assert(pending.every(x=>x.signal.aborted));assert.equal(h.L.results.length,3);assert.equal(h.L.feeLookupLoading,false);assert.match(h.L.feeLookupError,/补充统计.*60/);assert.equal(h.L.workordersLoading,false);assert.match(h.L.workordersError,/补充统计.*60/);assert(!h.html().includes('live-read-phase'));assert.equal(h.controls.ready(),true);
 const before=h.history.length;for(const item of pending)item.d.resolve(reply(item.q));await settle();assert.equal(h.history.length,before);assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.workorders,null);assert.equal(h.L.results.length,3);
});
test('a late intake cannot replace paused evidence or start a previous window after the phase deadline',async()=>{
 const h=await fixture(),{run}=await main(h);await advanceAction(h,'rates');await advanceAction(h,'workorders');for(let n=0;n<3;n++)await advanceAction(h,'aggregate');await finishExclusions(h);
 await advanceAction(h,'intakeCoverage');const old=h.waiting.find(x=>x.q.action==='intakeCoverage');assert(old);const calls=h.history.length;await expire(h);await run;
 assert.equal(h.L.comparisonStatus,'ready');assert(h.L.workorders);assert.equal(h.L.providerIntake.status,'error');assert.equal(h.L.providerComparisonIntake,null);assert(old.signal.aborted);const snapshot=JSON.stringify(h.L.providerIntake);old.d.resolve(reply(old.q));await settle();assert.equal(JSON.stringify(h.L.providerIntake),snapshot);assert.equal(h.history.length,calls);assert.equal(h.controls.ready(),true);
});
test('navigation clears the timer and an old timer callback cannot cancel a new page or query',async()=>{
 const h=await fixture(),{run}=await main(h),timer=h.deadline();assert(timer);h.c.setPage('amount');await run;await settle();assert.equal(h.deadline(),undefined);h.c.setPage('providers');const next=h.c.liveQuery(true);await settle();const signals=h.waiting.filter(x=>!x.signal?.aborted).map(x=>x.signal);const count=h.history.length;timer.fn();await settle();assert.equal(h.history.length,count);assert(signals.every(s=>!s.aborted));await finish(h,next);assert.equal(h.deadline(),undefined);assert.equal(h.controls.ready(),true);
});
test('filter replacement keeps the new phase and only an explicit next query admits more reads',async()=>{
 const h=await fixture(),{run}=await main(h),timer=h.deadline();h.c.liveSet('provider','Synthetic next provider');await run;await settle();assert.equal(h.deadline(),undefined);const count=h.history.length;timer.fn();await settle();assert.equal(h.history.length,count);const next=h.c.liveQuery();await settle();const signals=h.waiting.filter(x=>!x.signal?.aborted).map(x=>x.signal);timer.fn();await settle();assert(signals.every(s=>!s.aborted));await finish(h,next);assert.equal(h.L.results.length,3);assert.equal(h.controls.ready(),true);assert.equal(h.deadline(),undefined);
});

test('prepared comparison survives an abort-ignoring workorder and a response after the deadline cannot be cached',async()=>{
 const h=await fixture(true),normal=h.c.hensemLiveRequest,held=[];for(const p of h.L.catalog)p.sourceName=p.name;
 h.c.hensemLiveRequest=(q,o)=>{if(q.action==='aggregatePrepared')return Promise.resolve({version:2,items:q.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-prepared',generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:{...aggregate(h.L.catalog.find(p=>p.id===request.platformId),65),version:1,startAt:request.startAt,endAt:request.endAt,successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis}}))});if(q.action==='workorders'){const d=deferred();held.push({d,signal:o.signal});return d.promise;}return normal(q,o);};
 const run=h.c.liveQuery();await settle();assert.equal(h.L.results.length,3);await advanceAction(h,'rates');await settle();assert.equal(h.L.comparisonStatus,'ready');assert.equal(held.length,1);await finishExclusions(h);
 const main=JSON.stringify(h.L.results),comparison=JSON.stringify(h.L.comparisonResults);h.setNow('2026-09-23T12:01:00Z');held[0].d.resolve(reply({action:'workorders'}));await settle();assert.equal(h.L.workorders,null,'a microtask arriving after the deadline cannot become completed evidence');
 await run;assert.equal(JSON.stringify(h.L.results),main);assert.equal(JSON.stringify(h.L.comparisonResults),comparison);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.workordersLoading,false);assert.equal(h.L.feeLookupError,'');assert.equal(h.controls.ready(),true);assert(!h.history.some(q=>q.action==='intakeCoverage'));
 const retry=h.c.liveProviderWorkordersRetry();await settle();assert.equal(held.length,2,'explicit retry cannot hit an expired response cache');held[1].d.resolve(reply({action:'workorders'}));await retry;assert(h.L.workorders);assert.equal(h.L.results.length,3);assert.equal(h.deadline(),undefined);
});

test('an active workorder transport that ignores abort cannot keep the phase or overwrite its terminal state',async()=>{
 const h=await fixture(),normal=h.c.hensemLiveRequest,held=deferred();let signal;h.c.hensemLiveRequest=(q,o)=>q.action==='workorders'?(signal=o.signal,held.promise):normal(q,o);
 const {run}=await main(h);await advanceAction(h,'rates');await finishExclusions(h);assert(signal&&!signal.aborted);await expire(h);await run;assert(signal.aborted);assert.equal(h.L.workordersLoading,false);assert.equal(h.L.results.length,3);assert.equal(h.controls.ready(),true);const error=h.L.workordersError,calls=h.history.length;held.resolve(reply({action:'workorders'}));await settle();assert.equal(h.L.workorders,null);assert.equal(h.L.workordersError,error);assert.equal(h.history.length,calls);
});

const readyPrepared=(h,q)=>({version:2,items:q.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-microtask',generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:{...aggregate(h.L.catalog.find(p=>p.id===request.platformId),65),version:1,startAt:request.startAt,endAt:request.endAt,successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis}}))});
test('timer-precedes: a comparison ready microtask after deadline cannot enter the real manager completed cache',async()=>{
 let manager;const h=await fixture(true,{beforeLive(c){const create=c.HensemPreparedAggregates.create;c.HensemPreparedAggregates.create=options=>(manager=create(options));}});for(const p of h.L.catalog)p.sourceName=p.name;
 const normal=h.c.hensemLiveRequest,held=deferred(),sent=[];h.c.hensemLiveRequest=(q,o)=>{if(q.action!=='aggregatePrepared')return normal(q,o);sent.push(q);return sent.length===2?held.promise:Promise.resolve(readyPrepared(h,q));};
 const run=h.c.liveQuery();await settle();await advanceAction(h,'rates');await finishExclusions(h);assert.equal(sent.length,2);const request=sent[1].requests[0];h.setNow('2026-09-23T12:01:00Z');held.resolve(readyPrepared(h,sent[1]));await settle();await run;
 assert.equal(h.L.comparisonStatus,'error');assert.equal(h.L.comparisonResults.length,0);await manager.read(request,{isCurrent:()=>true});assert.equal(sent.length,3,'the expired comparison must require a new real transport');assert.equal(h.deadline(),undefined);
});
test('timer-precedes: an intake ready microtask after deadline cannot populate its real native fragment cache',async()=>{
 let intake;const h=await fixture(false,{beforeLive(c){const create=c.HensemProviderIntake.create;c.HensemProviderIntake.create=options=>(intake=create(options));}});const {run}=await main(h);await advanceAction(h,'rates');await advanceAction(h,'workorders');for(let n=0;n<3;n++)await advanceAction(h,'aggregate');await finishExclusions(h);await advanceAction(h,'intakeCoverage');
 const i=h.waiting.findIndex(x=>x.q.action==='intakeCoverage'),old=h.waiting.splice(i,1)[0],timer=h.deadline();assert(old);h.setNow('2026-09-23T12:01:00Z');old.d.resolve(reply(old.q));await settle();timer.fn();await run;await settle();
 let rows=0;h.c.hensemLiveRequest=q=>{if(q.action==='intakeCoverage'&&q.operation==='rows')rows++;return Promise.resolve(reply(q));};await intake.load({platforms:platforms.slice(0,2),direction:'charge',from:'2026-09-22',to:'2026-09-22',concurrency:1});assert.equal(rows,1,'expired evidence cannot be retained as an exact native fragment');assert.equal(h.deadline(),undefined);
});
