// Real host/member/prepared modules; virtual timers verify ownership, not speed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-heavy-read-phases.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup,advance,advanceAction,finish,settle,reply,deferred,aggregate,platforms}=new Function('require','__dirname',prefix+';return {setup,advance,advanceAction,finish,settle,reply,deferred,aggregate,platforms};')(require,__dirname);
function memberReply(q){const result=reply(q);if(q.action==='memberDaily'&&q.successBasis==='created'){result.successBasis='created';Object.assign(result.capabilities,{successBasis:'created_at_current_stored_status',successCohort:'created_at_current_stored_status',independentSuccessWindow:false});}return result;}
async function fixture(prepared=false){const timers=new Map();let next=0,members;const h=await setup('merchants',{reply:memberReply,extraModules:prepared?['live-statistic-windows.js','live-prepared-aggregates.js']:[],beforeLive(c){c.setTimeout=(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id};c.clearTimeout=id=>timers.delete(id);const create=c.HensemLiveMemberCounts.create;c.HensemLiveMemberCounts.create=options=>(members=create(options));}});return {...h,members,timerMap:timers,deadline:()=>[...timers.values()].find(t=>t.ms===60000)};}
async function main(h){const run=h.c.liveQuery();await settle();assert(!h.deadline(),'main query does not spend supplementary budget');for(let n=0;n<3;n++)await advance(h);assert(h.deadline());return {run};}
async function expire(h){h.setNow('2026-09-23T12:01:00Z');assert(h.deadline());h.deadline().fn();await settle();}
const readyPrepared=(h,q)=>({version:2,items:q.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-merchant',generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:{...aggregate(h.L.catalog.find(p=>p.id===request.platformId),65),version:1,startAt:request.startAt,endAt:request.endAt,...(request.successBasis==='created'?{successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false}}:{successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis})}}))});

test('merchant comparison starts with members and fees; deadline retains complete peers and main facts',async()=>{
 const h=await fixture(),{run}=await main(h);assert.deepEqual(h.history.slice(3).map(q=>q.action).sort(),['aggregate','memberDaily','rates']);assert.equal(h.max(),3);
 await advanceAction(h,'memberDaily');const pending=h.waiting.find(e=>e.q.action==='memberDaily');assert(pending);await advanceAction(h,'rates');for(let n=0;n<3;n++)await advanceAction(h,'aggregate');
 assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.members.state.results.length,1);const mainFacts=JSON.stringify(h.L.results),comparison=JSON.stringify(h.L.comparisonResults),before=h.history.length;
 await expire(h);await run;assert.equal(h.L.results.length,3);assert.equal(JSON.stringify(h.L.results),mainFacts);assert.equal(JSON.stringify(h.L.comparisonResults),comparison);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.members.state.status,'paused');assert.equal(h.members.state.results.length,1);assert(pending.signal.aborted);assert.equal(h.active(),0);assert.equal(h.L.feeLookupError,'');assert.equal(h.L.workordersError,'');assert.equal(h.controls.ready(),true);assert(!h.html().includes('live-read-phase'));assert.equal(h.deadline(),undefined);
 h.c.render();h.c.render();await settle();assert.equal(h.history.length,before);h.c.liveMemberCountsDetails();assert.match(h.drawers.at(-1).html,/liveMemberCountsRetry/);assert.match(h.members.metric('charge'),/已知人数/);assert.equal(h.members.state.items.length,3);assert.equal(h.members.state.results.length,1);
 h.waiting.splice(0);await finish(h,h.c.liveQuery());const fresh=h.history.slice(before);assert.deepEqual(fresh.map(q=>q.action),['memberDaily','memberDaily']);assert(fresh.every(q=>q.platformId!==platforms[0].id),'completed native member window stays cached');assert.equal(h.members.state.results.length,3);assert.equal(h.members.state.status,'ready');
});

test('uncompleted member and fee work ends at one budget without inventing data or postponing comparison',async()=>{
 const h=await fixture(),{run}=await main(h),pending=h.waiting.slice();for(let n=0;n<3;n++)await advanceAction(h,'aggregate');await expire(h);await run;
 assert.equal(h.members.state.status,'paused');assert.equal(h.members.state.results.length,0);assert.match(h.members.metric('charge'),/—/);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.feeLookupRows,null);assert.match(h.L.feeLookupError,/60/);assert(pending.filter(e=>e.q.action!=='aggregate').every(e=>e.signal.aborted));assert.equal(h.controls.ready(),true);
});

test('abort-ignoring member response cannot overwrite paused results or enter native completed cache',async()=>{
 const h=await fixture(),normal=h.c.hensemLiveRequest,held=[];h.c.hensemLiveRequest=(q,o)=>{if(q.action==='memberDaily'){const d=deferred();held.push({q,d,signal:o.signal});return d.promise;}return normal(q,o);};
 const {run}=await main(h);await advanceAction(h,'rates');for(let n=0;n<3;n++)await advanceAction(h,'aggregate');assert.equal(held.length,1);await expire(h);await run;assert(held[0].signal.aborted);const paused=JSON.stringify(h.members.state),calls=h.history.length;
 held[0].d.resolve(memberReply(held[0].q));await settle();assert.equal(JSON.stringify(h.members.state),paused);assert.equal(h.history.length,calls);assert.equal(held.length,1);
 const retry=h.c.liveQuery();await settle();assert.equal(held.length,2,'paused late response cannot be reused');assert.equal(held[1].q.platformId,held[0].q.platformId);for(let n=1;n<4;n++){assert(held[n]);held[n].d.resolve(memberReply(held[n].q));await settle();}await retry;assert.equal(h.members.state.results.length,3);assert.equal(h.controls.ready(),true);
});

test('prepared comparison stays ready while deadline-before-timer microtask cannot cache a member result',async()=>{
 const h=await fixture(true),normal=h.c.hensemLiveRequest,held=[],prepared=[];for(const p of h.L.catalog)p.sourceName=p.name;
 h.c.hensemLiveRequest=(q,o)=>{if(q.action==='aggregatePrepared'){prepared.push(q);return Promise.resolve(readyPrepared(h,q));}if(q.action==='memberDaily'){const d=deferred();held.push({q,d,signal:o.signal});return d.promise;}return normal(q,o);};
 const run=h.c.liveQuery();await settle();await advanceAction(h,'rates');assert.equal(h.L.results.length,3);assert.equal(h.L.comparisonStatus,'ready');const ready=JSON.stringify(h.L.comparisonResults),timer=h.deadline();assert(timer);h.setNow('2026-09-23T12:01:00Z');held[0].d.resolve(memberReply(held[0].q));await settle();assert.equal(h.members.state.results.length,0);assert.equal(held.length,1);timer.fn();await run;
 assert.equal(JSON.stringify(h.L.comparisonResults),ready);assert.equal(h.members.state.status,'paused');assert.equal(h.controls.ready(),true);const before=prepared.length,retry=h.c.liveQuery();await settle();assert.equal(held.length,2,'explicit query retries exact member scope');assert.equal(prepared.length,before+2,'the existing 30-second prepared freshness policy still revalidates both windows');for(let n=1;n<4;n++){held[n].d.resolve(memberReply(held[n].q));await settle();}await retry;assert.equal(h.members.state.results.length,3);
});

for(const change of ['filter','navigation'])test(change+': obsolete member owner and timer cannot affect replacement query',async()=>{
 const h=await fixture(),{run}=await main(h),timer=h.deadline(),old=h.waiting.splice(0);
 if(change==='filter')h.c.liveSet('provider','Synthetic next provider');else{h.c.setPage('amount');h.c.setPage('merchants');}
 await run;await settle();assert(old.every(e=>e.signal.aborted));assert.equal(h.deadline(),undefined);const next=h.c.liveQuery();await settle();const serial=h.L.serial,signals=h.waiting.filter(e=>!e.signal?.aborted).map(e=>e.signal),before=h.history.length;timer.fn();for(const e of old)e.d.resolve(memberReply(e.q));await settle();assert.equal(h.L.serial,serial);assert.equal(h.history.length,before);assert(signals.every(s=>!s.aborted));await finish(h,next);assert.equal(h.members.state.results.length,3);assert.equal(h.controls.ready(),true);
});

for(const change of ['identity','native'])test(change+': changed ownership rejects in-flight member evidence and stops remaining windows',async()=>{
 const h=await fixture(),{run}=await main(h),old=h.waiting.find(e=>e.q.action==='memberDaily');if(change==='identity')h.c.hensemDataScope={mode:'all',identity:'Synthetic replacement'};else h.L.catalog=h.L.catalog.map(p=>({...p,sourceName:'Synthetic replacement native'}));
 await advanceAction(h,'memberDaily');for(const e of h.waiting.splice(0))e.d.resolve(memberReply(e.q));await settle();await run;
 assert.equal(h.members.state.results.length,0);assert.equal(h.L.dirty,true);assert.equal(h.L.restoredPage,true);assert.equal(h.deadline(),undefined);assert.equal(h.history.filter(q=>q.action==='memberDaily').length,1);assert.equal(h.controls.ready(),true);
});

for(const code of ['ADMIN_LIVE_CANCELLED','ADMIN_LIVE_PERMISSION_DENIED'])test(code+': current member authority interruption ends sibling owners and leaves no auto-retry',async()=>{
 const h=await fixture(),{run}=await main(h);await advanceAction(h,'memberDaily');assert.equal(h.members.state.results.length,1);const pending=h.waiting.slice(),before=h.history.length;
 await advanceAction(h,'memberDaily',Object.assign(Error('Synthetic current authority interruption'),{code}));await run;await settle();
 assert.equal(h.deadline(),undefined);assert.equal(h.active(),0);assert.equal(h.controls.ready(),true);assert.equal(h.L.loading,false);assert.equal(h.L.feeLookupLoading,false);assert(!h.html().includes('live-read-phase'));assert(pending.every(e=>e.signal.aborted));
 if(code==='ADMIN_LIVE_PERMISSION_DENIED'){assert.equal(h.L.results.length,0);assert.equal(h.members.state.results.length,0);assert.match(h.L.error,/权限/);}else{assert.equal(h.L.results.length,3);assert.equal(h.L.restoredPage,true);}
 h.c.render();await settle();assert.equal(h.history.length,before);
});
