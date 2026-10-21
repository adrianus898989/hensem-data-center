// Real host and supplementary modules; virtual deadlines test correctness, not speed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-heavy-read-phases.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup,advance,advanceAction,finish,settle,reply,deferred,aggregate,platforms}=new Function('require','__dirname',prefix+';return {setup,advance,advanceAction,finish,settle,reply,deferred,aggregate,platforms};')(require,__dirname);
async function fixture(prepared=false,extra={}){const timers=new Map();let next=0;const h=await setup('providers',{reply:extra.reply,extraModules:prepared?['live-statistic-windows.js','live-prepared-aggregates.js']:[],beforeLive(c){c.setTimeout=(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id};c.clearTimeout=id=>timers.delete(id);extra.beforeLive?.(c);}});return {...h,timerMap:timers,deadline:()=>[...timers.values()].find(t=>t.ms===60000)};}
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

async function supplementaryStage(action){
 let submission;
 const h=await fixture(false,{beforeLive(c){const create=c.HensemSubmissionAnalysis.create;c.HensemSubmissionAnalysis.create=o=>(submission=create(o));},reply(q){const result=reply(q);if(q.action==='submissionAnalysis')result.coverage={orderCount:65,missingMemberCount:0,unknownStatusCount:0,orderSequenceUncertainCount:0,sourceCompletenessVerified:false};return result;}}),{run}=await main(h);
 await advanceAction(h,'submissionAnalysis');
 if(['workorders','intakeCoverage'].includes(action))await advanceAction(h,'rates');
 if(action==='intakeCoverage'){await advanceAction(h,'workorders');for(let n=0;n<3;n++)await advanceAction(h,'aggregate');}
 assert(h.waiting.some(e=>e.q.action===action));
 return {...h,run,submission};
}
for(const action of ['submissionAnalysis','rates','workorders','intakeCoverage'])test(action+': host suspension immediately releases the supplementary owner and stops the other lane',async()=>{
 const h=await supplementaryStage(action),mainFacts=JSON.stringify(h.L.results),priorSubmission=h.submission.capture().results.length,calls=h.history.length,serial=h.L.serial;
 await advanceAction(h,action,Object.assign(Error('Synthetic current host suspension'),{code:'ADMIN_LIVE_CANCELLED'}));await h.run;await settle();
 assert.equal(h.L.serial,serial+1);assert.equal(JSON.stringify(h.L.results),mainFacts);assert.equal(h.L.results.length,3);assert.equal(h.L.queryPaused,false);assert.equal(h.L.loading,false);assert.equal(h.L.queryRetrying,false);assert.equal(h.L.restoredPage,true);
 assert.equal(h.submission.capture().results.length,priorSubmission);assert.equal(h.submission.capture().status,'paused');assert.equal(h.submission.capture().preparedBudgetEnded,true);
 assert.equal(h.L.feeLookupLoading,false);assert.equal(h.L.workordersLoading,false);assert.equal(h.active(),0);assert.equal(h.deadline(),undefined);assert.doesNotMatch(h.html(),/live-read-phase|剔除读取中/);
 assert.equal(h.history.length,calls,'no next native, fee page, comparison, or intake dispatch after host suspension');
 h.c.render();h.c.render();await settle();assert.equal(h.history.length,calls,'render cannot restart paused supplementary work');
 h.waiting.splice(0);const retry=h.c.liveQuery();await finish(h,retry);
 assert.equal(h.L.results.length,3);assert.equal(h.submission.capture().results.length,3);assert.equal(h.submission.capture().status,'ready');assert.equal(h.L.workordersLoading,false);assert.equal(h.controls.ready(),true);
 assert.equal(h.history.slice(calls).filter(q=>q.action==='aggregate'&&q.startAt===h.history[0].startAt).length,0,'explicit query reuses completed main facts');
 assert(!h.history.slice(calls).some(q=>q.action==='submissionAnalysis'&&q.platformId===platforms[0].id),'completed exclusion stays cached');
});
for(const action of ['submissionAnalysis','rates','workorders','intakeCoverage'])test(action+': a current permission denial clears main and supplementary facts and leaves no active owner',async()=>{
 const h=await supplementaryStage(action),calls=h.history.length;
 await advanceAction(h,action,Object.assign(Error('Synthetic current role denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await h.run;await settle();
 assert.equal(h.L.results.length,0);assert.equal(h.L.comparisonResults.length,0);assert.equal(h.L.workorders,null);assert.equal(h.L.providerIntake,null);assert.equal(h.L.providerComparisonIntake,null);assert.equal(h.L.feeLookupRows,null);assert.equal(h.submission.capture().results.length,0);
 assert.equal(h.L.loading,false);assert.equal(h.L.queryRetrying,false);assert.equal(h.L.queryPaused,false);assert.equal(h.active(),0);assert.equal(h.deadline(),undefined);assert.match(h.L.error,/权限/);assert.doesNotMatch(h.html(),/live-read-phase/);
 h.c.render();await h.c.liveRetryFailed(true);await settle();assert.equal(h.history.length,calls,'denial does not become a resumable retained query');
 h.waiting.splice(0);await finish(h,h.c.liveQuery());const retried=h.history.slice(calls);
 for(const kind of ['aggregate','submissionAnalysis','rates','workorders','intakeCoverage'])assert(retried.some(q=>q.action===kind),'a later explicit query rereads '+kind+' after authority denial');
 assert(retried.some(q=>q.action==='submissionAnalysis'&&q.platformId===platforms[0].id),'even previously completed exclusion is no longer cached');
 assert(retried.some(q=>q.action==='intakeCoverage'&&q.operation==='orderCatalog'),'denial clears the supplementary directory cache too');
});
test('an explicit same-scope query replaces only supplementary work while in-flight main reads stay deduplicated',async()=>{
 const h=await fixture(),first=h.c.liveQuery();await settle();const pendingMain=h.history.length;
 await h.c.liveQuery();assert.equal(h.history.length,pendingMain,'main query is still one owner');
 for(let n=0;n<3;n++)await advance(h);const old=h.waiting.splice(0),before=h.history.length;
 assert.equal(h.L.loading,false);assert(h.deadline());const repeated=h.c.liveQuery();await settle();await first;
 assert(old.every(e=>e.signal.aborted));assert(h.history.length>before,'the enabled Query click starts a new actual query owner');
 assert(!h.history.slice(before).some(q=>q.action==='aggregate'),'same-scope main rows come from the existing exact cache');
 await finish(h,repeated);assert.equal(h.L.results.length,3);assert.equal(h.controls.ready(),true);assert.equal(h.max(),2);
});
test('a late host cancellation from an abort-ignoring old supplemental request cannot pause its replacement query',async()=>{
 const h=await fixture(),normal=h.c.hensemLiveRequest,held=deferred();let oldSignal;
 h.c.hensemLiveRequest=(q,o)=>{if(q.action==='rates'&&!oldSignal){oldSignal=o.signal;return held.promise;}return normal(q,o);};
 const {run:first}=await main(h);h.waiting.splice(0);const repeated=h.c.liveQuery();await settle();await first;
 assert(oldSignal.aborted);const serial=h.L.serial,calls=h.history.length;
 held.reject(Object.assign(Error('Synthetic old host cancellation'),{code:'ADMIN_LIVE_CANCELLED'}));await settle();
 assert.equal(h.L.serial,serial);assert.equal(h.history.length,calls);assert.equal(h.L.restoredPage,false);assert.match(h.html(),/live-read-phase/);
 await finish(h,repeated);assert.equal(h.L.results.length,3);assert.equal(h.controls.ready(),true);
});
for(const action of ['submissionAnalysis','rates','workorders','intakeCoverage'])test('prepared main + '+action+': host cancellation settles both real supplementary lanes without invalidating ready main heads',async()=>{
 const h=await fixture(true),normal=h.c.hensemLiveRequest,prepared=[];for(const p of h.L.catalog)p.sourceName=p.name;
 h.c.hensemLiveRequest=(q,o)=>{if(q.action==='aggregatePrepared'){prepared.push(q);return Promise.resolve(readyPrepared(h,q));}return normal(q,o);};
 const run=h.c.liveQuery();await settle();assert.equal(h.L.results.length,3);const mainFacts=JSON.stringify(h.L.results);
 if(['workorders','intakeCoverage'].includes(action))await advanceAction(h,'rates');
 if(action==='intakeCoverage')await advanceAction(h,'workorders');
 const prior=h.history.length,priorPrepared=prepared.length;
 await advanceAction(h,action,Object.assign(Error('Synthetic prepared-page host suspension'),{code:'ADMIN_LIVE_CANCELLED'}));await run;await settle();
 assert.equal(JSON.stringify(h.L.results),mainFacts);assert.equal(h.L.results.length,3);assert.equal(h.L.loading,false);assert.equal(h.L.workordersLoading,false);assert.equal(h.L.feeLookupLoading,false);assert.equal(h.L.restoredPage,true);assert.equal(h.active(),0);assert.equal(h.deadline(),undefined);
 h.c.render();await settle();assert.equal(h.history.length,prior);assert.equal(prepared.length,priorPrepared);assert.doesNotMatch(h.html(),/live-read-phase|剔除读取中/);
 h.waiting.splice(0);await finish(h,h.c.liveQuery());assert.equal(h.L.results.length,3);assert.equal(h.controls.ready(),true);
 const currentStart=prepared[0].requests[0].startAt;assert(!prepared.slice(priorPrepared).some(q=>q.requests.some(request=>request.startAt===currentStart)),'normal explicit Query reuses ready current-window prepared heads');
});
test('prepared read owners keep new identity/native facts and exact completed heads after obsolete cancellation or denial',async()=>{
 const cachePrefix=fs.readFileSync(path.join(__dirname,'admin-aggregate-cache.test.cjs'),'utf8').split(/\ntest\(/)[0];
 const {harness}=new Function('require','__dirname',cachePrefix+';return {harness};')(require,__dirname);
 for(const code of ['ADMIN_LIVE_CANCELLED','ADMIN_LIVE_PERMISSION_DENIED'])for(const change of ['identity','assignment','native']){
  const h=harness({platforms:[{...platforms[0],sourceName:'Synthetic original native'}],roleAccess:{mode:'owner',canView:true,assignmentVersion:1},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js']});await settle();h.c.setPage('provider_payout');await settle();
  h.c.hensemDataScope={mode:'all',identity:'SYNTHETIC-OLD'};
  const q={action:'aggregate',view:'providers',platformId:platforms[0].id,startAt:'2026-09-21T18:30:00.000Z',endAt:'2026-09-22T00:30:00.000Z',successStartAt:'2026-09-21T18:30:00.000Z',successEndAt:'2026-09-22T00:30:00.000Z',successBasis:'success',direction:'withdraw',status:'all',currency:'INR',offset:0,limit:20};
  const pending=deferred();let requests=0;h.setHandler(payload=>{if(payload.action==='aggregatePrepared'){requests++;return requests===1?pending.promise:readyPrepared(h,payload);}return {};});
  const read=()=>h.c.__cacheTest.readAggregate(q,h.L.serial,true),old=read(),oldRejected=assert.rejects(old);await settle();
  if(change==='identity')h.c.hensemDataScope.identity='SYNTHETIC-NEW';
  if(change==='assignment')h.c.hensemRoleAccess.assignmentVersion++;
  if(change==='native')h.L.catalog=h.L.catalog.map(p=>({...p,sourceName:'Synthetic replacement native'}));
  const fresh=await read();h.L.results=[fresh];const serial=h.L.serial;
  pending.reject(Object.assign(Error('Synthetic obsolete authority response'),{code}));await oldRejected;await settle();
  assert.equal(h.L.serial,serial);assert.equal(h.L.results[0],fresh);assert.equal((await read())._preparedPublication.id,fresh._preparedPublication.id);assert.equal(requests,2,'old response cannot evict a different current native/identity head');
 }
});
