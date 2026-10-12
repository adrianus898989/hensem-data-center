/* Real host/submission/intake modules; synthetic delayed IO only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,P,aggregate}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,P,aggregate};')(require,__dirname);
const Q={...P,id:'22222222-2222-4222-8222-222222222222',name:'Synthetic second'},R={...P,id:'33333333-3333-4333-8333-333333333333',name:'Synthetic third'},platforms=[P,Q,R];
const metric=t=>({provider:null,threshold:t,qualified_member_count:1,qualified_member_days:1,member_count:1,member_days:1,invalid_count:20,l0_members:0,new_members:0,funded_members:0,unknown_members:1});
function reply(q){const p=platforms.find(p=>p.id===q.platformId)||P;
 if(q.action==='aggregate')return {...aggregate(p,65),startAt:q.startAt,endAt:q.endAt};
 if(q.action==='submissionAnalysis')return {version:3,platform:p,basis:'platform_local_day_all_providers_zero_success_whole_day_over_threshold',startAt:q.startAt,endAt:q.endAt,exemptCount:0,thresholdComparison:'gt',metrics:[10,15,20,30,50,100].map(metric),coverage:{missingMemberCount:0,unknownStatusCount:0,orderSequenceUncertainCount:0}};
 if(q.action==='intakeCoverage')return q.operation==='rows'?{version:1,complete:true,startAt:q.startAt,endAt:q.endAt,feedIds:q.feedIds,checkedAt:'2026-09-23T12:00:00Z',rows:q.feedIds.map(id=>({feedId:id,date:q.startAt,status:'complete',received:true,complete:true,expected:true,zeroConfirmed:false}))}:{version:1,complete:true,feeds:platforms.map(p=>({id:'feed-'+p.id,platformId:p.id,dataset:'orders',direction:'charge',timezone:p.timezone}))};
 if(q.action==='memberDaily')return {version:1,platform:p,startAt:q.startAt,endAt:q.endAt,capabilities:{memberIdentity:true,createdBasis:'created_at',successBasis:'success_at',dedupe:'platform_local_date_direction_member'},rows:['charge','withdraw'].map(direction=>({date:'2026-09-22',direction,created_member_count:1,success_member_count:1,created_order_count:2,success_order_count:1,created_missing_member_count:0,success_missing_member_count:0}))};
 if(q.action==='workorders')return {rows:[],total:0,byProvider:[],byDirection:{charge:{submittedCount:0}}};
 if(q.action==='rates')return {rows:[],total:0};return {};
}
const heavy=q=>['aggregate','submissionAnalysis','intakeCoverage','workorders','rates','memberDaily'].includes(q.action);
async function setup(page='providers',extra={}){const controls={ready:null,cancels:0};
 const h=harness({page,platforms,submission:true,extraModules:['live-provider-intake.js','live-member-counts.js'],beforeLive(c){c.HensemLiveSyncHealth={configure(o){controls.ready=o.ready},cancel(){controls.cancels++},schedule(){},badge:()=>''};extra.beforeLive?.(c);}});await settle();h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';h.L.initialReadComplete=true;const waiting=[],history=[];let active=0,max=0;
 h.c.hensemLiveRequest=(q,options={})=>{h.calls.push(q);if(!heavy(q))return Promise.resolve(q.action==='providerOptions'?{providers:[]}:{});const d=deferred(),entry={q,d,signal:options.signal};waiting.push(entry);history.push(q);active++;max=Math.max(max,active);const abort=()=>d.reject(Object.assign(Error('查询已取消'),{name:'AbortError'}));options.signal?.addEventListener('abort',abort,{once:true});return d.promise.finally(()=>{active--;options.signal?.removeEventListener('abort',abort)});};
 return {...h,controls,waiting,history,max:()=>max,active:()=>active};
}
async function advance(h,error){assert(h.waiting.length,'there is one activated request');const e=h.waiting.shift();error?e.d.reject(error):e.d.resolve(reply(e.q));await settle();return e.q;}
async function finish(h,run){for(let n=0;n<100;n++){await settle();if(h.waiting.length)await advance(h);else if(!h.L.loading&&!h.html().includes('live-read-phase'))break;}await run;await settle();}

test('three-platform query activates aggregate then exclusion per platform and serializes every later heavy phase',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();assert.equal(h.active(),1);assert.equal(h.history[0].action,'aggregate');assert.equal(h.controls.ready(),false);const timerCount=h.timers.length;
 h.setNow('2026-09-23T12:01:00Z');await settle();assert.equal(h.timers.length,timerCount,'waiting exclusion has no 30s execution timer');
 await advance(h);assert.equal(h.history[1].action,'submissionAnalysis');assert.equal(h.active(),1);assert(h.timers.length>timerCount);await finish(h,run);
 assert.equal(h.max(),1);assert.deepEqual(h.history.slice(0,6).map(q=>[q.action,q.platformId]),platforms.flatMap(p=>[['aggregate',p.id],['submissionAnalysis',p.id]]));
 const actions=h.history.map(q=>q.action),lastAggregate=actions.lastIndexOf('aggregate'),firstIntake=actions.indexOf('intakeCoverage'),work=actions.indexOf('workorders'),fee=actions.indexOf('rates');assert(lastAggregate<firstIntake&&firstIntake<work&&work<fee);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.providerIntake.status,'ready');assert.equal(h.L.providerComparisonIntake.status,'ready');assert.equal(h.controls.ready(),true);assert(h.controls.cancels>0);assert(!h.html().includes('live-read-phase'));
});

test('early aggregate and exclusion failure stay terminal while later platforms and auxiliary phases still finish',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();await advance(h,Error('Synthetic source unavailable'));await advance(h,Object.assign(Error('57014 statement timeout'),{code:'57014'}));await finish(h,run);
 assert.equal(h.max(),1);assert.equal(h.L.results.length,2);assert.equal(h.L.queryFailures.length,1);assert(h.L.workorders);assert(h.history.some(q=>q.action==='rates'));assert.equal(h.history.filter(q=>q.action==='submissionAnalysis'&&q.platformId===P.id).length,1,'no database-timeout automatic retry');assert.match(h.html(),/失败/);
});

test('navigation cancels the active native signal and prevents queued phases from starting or committing late data',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();const first=h.waiting.shift();h.c.setPage('amount');assert.equal(first.signal.aborted,true);await run;await settle();assert.equal(h.active(),0);assert.equal(h.history.length,1);assert(!h.html().includes('live-read-phase'));first.d.resolve(reply(first.q));await settle();assert.equal(h.c.state.page,'amount');assert(!h.L.results.length);
 h.c.setPage('providers');const next=h.c.liveQuery();await settle();assert.equal(h.active(),1);await finish(h,next);assert.equal(h.L.results.length,3);
});

test('provider ordinary query reuses the exact complete aggregate windows; explicit refresh reactivates them',async()=>{
 const h=await setup(),first=h.c.liveQuery();await finish(h,first);const count=h.history.filter(q=>q.action==='aggregate').length;assert.equal(count,6);const repeat=h.c.liveQuery();await finish(h,repeat);assert.equal(h.history.filter(q=>q.action==='aggregate').length,count);assert(h.L.results.every(r=>r._aggregateCacheHit));assert.match(h.nodes.get('liveFilters').innerHTML,/liveQuery\(true\)/);const refresh=h.c.liveQuery(true);await finish(h,refresh);assert.equal(h.history.filter(q=>q.action==='aggregate').length,count+6);assert.equal(h.max(),1);
});

test('manual workorder, fee and exclusion retries cannot bypass the active page phase',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();const count=h.history.length;await h.c.liveProviderWorkordersRetry();await h.c.liveRetryFeeLookup();await h.c.liveSubmissionRetry();await h.c.liveRetryFailed();await settle();assert.equal(h.history.length,count);await finish(h,run);assert.equal(h.max(),1);
});

test('merchant trend click defers until current phases finish, then owns one lane with no repeat on failure',async()=>{
 const h=await setup('merchants'),run=h.c.liveQuery();await settle();await h.c.liveView('trend');assert.equal(h.history.length,1);assert.equal(h.L.merchantTrend,null);await finish(h,run);assert.equal(h.max(),1);assert.equal(h.L.loadedView,'full');assert.equal(h.L.merchantTrend.status,'ready');const people=h.history.map(q=>q.action).indexOf('memberDaily'),fees=h.history.map(q=>q.action).indexOf('rates');assert(people>=0&&people<fees,'merchant member reads finish one at a time before fees');assert.equal(h.history.filter(q=>q.action==='memberDaily').length,3);
});


test('a changed-scope query releases the old phase and late completion cannot clear the new owner',async()=>{
 const h=await setup(),old=h.c.liveQuery();await settle();const previous=h.waiting.shift();h.c.liveSet('provider','Synthetic changed provider');assert.equal(previous.signal.aborted,true);const fresh=h.c.liveQuery();await settle();assert.equal(h.active(),1);assert.match(h.html(),/live-read-phase/);previous.d.resolve({...reply(previous.q),total:999999});await old;await settle();assert.equal(h.active(),1);assert.match(h.html(),/live-read-phase/);await finish(h,fresh);assert(h.L.results.every(r=>r.total===65));assert(h.history.slice(1).filter(q=>q.action==='aggregate').every(q=>q.providers?.[0]==='Synthetic changed provider'));assert(!h.html().includes('live-read-phase'));
});

test('retry of several failed platforms owns one lane and keeps already completed platform data',async()=>{
 const h=await setup(),first=h.c.liveQuery();await settle();await advance(h,Error('Synthetic first failure'));await advance(h);await advance(h,Error('Synthetic second failure'));await finish(h,first);assert.equal(h.L.queryFailures.length,2);const retained=h.L.results[0],start=h.history.length,retry=h.c.liveRetryFailed();await settle();assert.equal(h.active(),1);await finish(h,retry);assert.equal(h.max(),1);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.find(r=>r.platform.id===R.id),retained);assert.deepEqual(h.history.slice(start).filter(q=>q.action==='aggregate').map(q=>q.platformId),[P.id,Q.id]);
});
