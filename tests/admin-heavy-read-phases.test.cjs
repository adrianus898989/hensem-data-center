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
 const h=harness({page,platforms,submission:true,extraModules:['live-provider-intake.js','live-member-counts.js',...(extra.extraModules||[])],beforeLive(c){c.HensemLiveSyncHealth={configure(o){controls.ready=o.ready},cancel(){controls.cancels++},schedule(){},badge:()=>''};extra.beforeLive?.(c);}});await settle();h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';h.L.initialReadComplete=true;const waiting=[],history=[];let active=0,max=0;
 h.c.hensemLiveRequest=(q,options={})=>{h.calls.push(q);if(!heavy(q))return Promise.resolve(q.action==='providerOptions'?{providers:[]}:{});const d=deferred(),entry={q,d,signal:options.signal};waiting.push(entry);history.push(q);active++;max=Math.max(max,active);const abort=()=>d.reject(Object.assign(Error('查询已取消'),{name:'AbortError'}));options.signal?.addEventListener('abort',abort,{once:true});return d.promise.finally(()=>{active--;options.signal?.removeEventListener('abort',abort)});};
 return {...h,controls,waiting,history,reply:extra.reply||reply,max:()=>max,active:()=>active};
}
async function advance(h,error){assert(h.waiting.length,'there is one activated request');const e=h.waiting.shift();error?e.d.reject(error):e.d.resolve(h.reply(e.q));await settle();return e.q;}
async function advanceAction(h,action,error){const index=h.waiting.findIndex(e=>e.q.action===action);assert(index>=0,'activated '+action+' request');const [e]=h.waiting.splice(index,1);error?e.d.reject(error):e.d.resolve(h.reply(e.q));await settle();return e.q;}
async function finish(h,run){for(let n=0;n<100;n++){await settle();if(h.waiting.length)await advance(h);else if(!h.L.loading&&!h.html().includes('live-read-phase'))break;}await run;await settle();}

test('deposit orders finish on two workers before two bounded serial supplementary lanes start',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();assert.equal(h.active(),2);assert(h.history.every(q=>q.action==='aggregate'));assert.equal(h.controls.ready(),false);
 assert(!h.timers.some(t=>t.ms===30000),'queued exclusions have no execution timer');
 await advance(h);assert.equal(h.history[2].action,'aggregate');assert.equal(h.active(),2);assert.equal(h.L.loading,true);
 await advance(h);assert.equal(h.history.length,3);assert.equal(h.active(),1);assert.equal(h.L.loading,true);
 await advance(h);assert.deepEqual(h.history.slice(3).map(q=>q.action).sort(),['rates','submissionAnalysis']);assert.equal(h.active(),2);assert.equal(h.L.loading,false);assert.equal(h.L.results.length,3);assert.match(h.html(),/剔除读取中 0\/3/);
 await finish(h,run);assert.equal(h.max(),2);assert.deepEqual(h.history.slice(0,3).map(q=>q.platformId),platforms.map(p=>p.id));assert.deepEqual(h.history.filter(q=>q.action==='submissionAnalysis').map(q=>q.platformId),platforms.map(p=>p.id));
 const actions=h.history.map(q=>q.action),lastAggregate=actions.lastIndexOf('aggregate'),firstIntake=actions.indexOf('intakeCoverage'),work=actions.indexOf('workorders'),fee=actions.indexOf('rates');assert(fee<work&&work<lastAggregate&&lastAggregate<firstIntake);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.providerIntake.status,'ready');assert.equal(h.L.providerComparisonIntake.status,'ready');assert.equal(h.controls.ready(),true);assert(h.controls.cancels>0);assert(!h.html().includes('live-read-phase'));
});

test('early aggregate and exclusion failure stay terminal while later platforms and auxiliary phases still finish',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();await advance(h,Error('Synthetic source unavailable'));await advance(h);await advance(h);await advanceAction(h,'submissionAnalysis',Object.assign(Error('57014 statement timeout'),{code:'57014'}));await finish(h,run);
 assert.equal(h.max(),2);assert.equal(h.L.results.length,2);assert.equal(h.L.queryFailures.length,1);assert(h.L.workorders);assert(h.history.some(q=>q.action==='rates'));assert.equal(h.history.filter(q=>q.action==='submissionAnalysis'&&q.platformId===P.id).length,1,'no database-timeout automatic retry');assert.match(h.html(),/失败/);
});

test('navigation cancels both active order signals and prevents queued phases from starting or committing late data',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();const first=h.waiting.splice(0);assert.equal(first.length,2);h.c.setPage('amount');assert(first.every(e=>e.signal.aborted));await run;await settle();assert.equal(h.active(),0);assert.equal(h.history.length,2);assert(!h.html().includes('live-read-phase'));for(const e of first)e.d.resolve(reply(e.q));await settle();assert.equal(h.c.state.page,'amount');assert(!h.L.results.length);
 h.c.setPage('providers');const next=h.c.liveQuery();await settle();assert.equal(h.active(),2);await finish(h,next);assert.equal(h.L.results.length,3);
});

test('provider ordinary query reuses the exact complete aggregate windows; explicit refresh reactivates them',async()=>{
 const h=await setup(),first=h.c.liveQuery();await finish(h,first);const count=h.history.filter(q=>q.action==='aggregate').length;assert.equal(count,6);const repeat=h.c.liveQuery();await finish(h,repeat);assert.equal(h.history.filter(q=>q.action==='aggregate').length,count);assert(h.L.results.every(r=>r._aggregateCacheHit));assert.match(h.nodes.get('liveFilters').innerHTML,/liveQuery\(true\)/);const refresh=h.c.liveQuery(true);await finish(h,refresh);assert.equal(h.history.filter(q=>q.action==='aggregate').length,count+6);assert.equal(h.max(),2);
});

test('manual workorder, fee and exclusion retries cannot bypass the active page phase',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();const count=h.history.length;await h.c.liveProviderWorkordersRetry();await h.c.liveRetryFeeLookup();await h.c.liveSubmissionRetry();await h.c.liveRetryFailed();await settle();assert.equal(h.history.length,count);await finish(h,run);assert.equal(h.max(),2);
});

test('merchant trend click defers until current phases finish, then owns one lane with no repeat on failure',async()=>{
 const h=await setup('merchants'),run=h.c.liveQuery();await settle();await h.c.liveView('trend');assert.equal(h.history.length,1);assert.equal(h.L.merchantTrend,null);await finish(h,run);assert.equal(h.max(),1);assert.equal(h.L.loadedView,'full');assert.equal(h.L.merchantTrend.status,'ready');const people=h.history.map(q=>q.action).indexOf('memberDaily'),fees=h.history.map(q=>q.action).indexOf('rates');assert(fees>=0&&fees<people,'fees render before merchant member reads while preserving the one lane');assert.equal(h.history.filter(q=>q.action==='memberDaily').length,3);
});


test('a changed-scope query releases both old workers and late completion cannot clear the new owner',async()=>{
 const h=await setup(),old=h.c.liveQuery();await settle();const previous=h.waiting.splice(0);h.c.liveSet('provider','Synthetic changed provider');assert(previous.every(e=>e.signal.aborted));const fresh=h.c.liveQuery();await settle();assert.equal(h.active(),2);assert.match(h.html(),/live-read-phase/);for(const e of previous)e.d.resolve({...reply(e.q),total:999999});await old;await settle();assert.equal(h.active(),2);assert.match(h.html(),/live-read-phase/);await finish(h,fresh);assert(h.L.results.every(r=>r.total===65));assert(h.history.slice(2).filter(q=>q.action==='aggregate').every(q=>q.providers?.[0]==='Synthetic changed provider'));assert(!h.html().includes('live-read-phase'));
});

test('retry of several failed platforms owns one lane and keeps already completed platform data',async()=>{
 const h=await setup(),first=h.c.liveQuery();await settle();await advance(h,Error('Synthetic first failure'));await advance(h,Error('Synthetic second failure'));await advance(h);await finish(h,first);assert.equal(h.L.queryFailures.length,2);const retained=h.L.results[0],start=h.history.length,retry=h.c.liveRetryFailed();await settle();assert.equal(h.active(),1);await finish(h,retry);assert.equal(h.max(),2);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.find(r=>r.platform.id===R.id),retained);assert.deepEqual(h.history.slice(start).filter(q=>q.action==='aggregate').map(q=>q.platformId),[P.id,Q.id]);
});


async function failedMerchantMembers(){
 const h=await setup('merchants'),run=h.c.liveQuery();for(let n=0;n<100;n++){await settle();if(h.waiting.length){const q=h.waiting[0].q;await advance(h,q.action==='memberDaily'?Error('Synthetic member read failed'):null);}else if(!h.L.loading&&!h.html().includes('live-read-phase'))break;}await run;await settle();h.c.liveMemberCountsDetails();assert.match(h.drawers.at(-1).html,/liveMemberCountsRetry/);assert.equal(h.history.filter(q=>q.action==='memberDaily').length,3);return h;
}

test('merchant member dialog retries real failed reads in one owned lane without duplicating clicks or rerunning aggregates',async()=>{
 const h=await failedMerchantMembers(),start=h.history.length,cancels=h.controls.cancels,run=h.c.liveMemberCountsRetry();await settle();assert.equal(h.active(),1);assert.equal(h.history.at(-1).action,'memberDaily');assert.match(h.html(),/重新读取会员人数/);assert.equal(h.controls.ready(),false);assert(h.controls.cancels>cancels);const count=h.history.length;await h.c.liveMemberCountsRetry();await h.c.liveRetryFeeLookup();await settle();assert.equal(h.history.length,count);await finish(h,run);assert.equal(h.max(),1);assert.deepEqual(h.history.slice(start).map(q=>q.action),['memberDaily','memberDaily','memberDaily']);assert.equal(h.controls.ready(),true);h.c.liveMemberCountsDetails();assert.doesNotMatch(h.drawers.at(-1).html,/所选平台人数读取失败/);assert(!h.html().includes('live-read-phase'));
});

test('merchant member retry rejects missing view/query permission, changed scopes and another active page read',async()=>{
 const h=await failedMerchantMembers(),count=h.history.length;
 for(const mutate of [()=>h.c.hensemRoleAllowed=(page,action)=>action!=='view',()=>h.c.hensemRoleAllowed=(page,action)=>action!=='query',()=>h.L.dirty=true,()=>h.L.from='2026-09-20T00:00:00',()=>h.L.queryScope='',()=>h.L.pageQueried=false,()=>h.L.catalogReady=false,()=>h.L.loading=true,()=>h.L.queryRetrying=true]){
  const saved={allowed:h.c.hensemRoleAllowed,dirty:h.L.dirty,from:h.L.from,queryScope:h.L.queryScope,pageQueried:h.L.pageQueried,catalogReady:h.L.catalogReady,loading:h.L.loading,queryRetrying:h.L.queryRetrying};mutate();await h.c.liveMemberCountsRetry();assert.equal(h.history.length,count);h.c.hensemRoleAllowed=saved.allowed;delete saved.allowed;Object.assign(h.L,saved);
 }
 const query=h.c.liveQuery(true);await settle();const n=h.history.length;await h.c.liveMemberCountsRetry();await settle();assert.equal(h.history.length,n,'the active report phase has exclusive ownership');await finish(h,query);assert.equal(h.max(),1);
});

test('navigation during merchant member retry stops remaining platforms and ignores late success without reclaiming the phase',async()=>{
 const h=await failedMerchantMembers(),count=h.history.length,run=h.c.liveMemberCountsRetry();await settle();const old=h.waiting.shift();h.c.setPage('providers');await settle();old.d.resolve(reply(old.q));await run;await settle();assert.equal(h.history.length,count+1);assert.equal(h.c.state.page,'providers');assert(!h.html().includes('live-read-phase'));assert.equal(h.active(),0);
});

test('slow exclusion cannot block paginated fees, workorders or comparison, and total heavy concurrency stays at two',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();for(let n=0;n<3;n++)await advance(h);
 assert.equal(h.L.results.length,3);assert.equal(h.L.loading,false);assert.equal(h.L.feeLookupLoading,true);assert.equal(h.active(),2);assert.equal(h.controls.ready(),false);assert.match(h.html(),/主表已完成，正在补充统计/);
 const take=action=>{const i=h.waiting.findIndex(e=>e.q.action===action);assert(i>=0);return h.waiting.splice(i,1)[0]};
 const fee=take('rates');fee.d.resolve({total:501,rows:Array.from({length:500},(_,i)=>({id:'synthetic-rate-'+i,provider:'Synthetic provider',collectFee:'4%',scopeType:'all'}))});await settle();
 assert.equal(h.history.at(-1).action,'rates');assert.equal(h.history.at(-1).offset,500);assert.equal(h.active(),2);assert(!h.history.some(q=>q.action==='workorders'||q.action==='intakeCoverage'));
 const page=take('rates');page.d.resolve({total:501,rows:[{id:'synthetic-rate-last',provider:'Synthetic provider',collectFee:'4%',scopeType:'all'}]});await settle();
 assert.equal(h.L.feeLookupLoading,false);assert.equal(h.L.feeLookupRows.length,501);assert.equal(h.history.at(-1).action,'workorders');await advanceAction(h,'workorders');assert(h.L.workorders);assert.equal(h.history.at(-1).action,'aggregate');
 for(let n=0;n<3;n++)await advanceAction(h,'aggregate');assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.history.at(-1).action,'intakeCoverage');assert.equal(h.history.filter(q=>q.action==='submissionAnalysis').length,1,'first exclusion can still be pending after every main order, fee and workorder has returned');assert.equal(h.active(),2);assert.match(h.html(),/剔除读取中 0\/3/);
 await finish(h,run);assert.equal(h.max(),2);const initial=h.history.length,repeated=h.c.liveQuery();await finish(h,repeated);assert(!h.history.slice(initial).some(q=>q.action==='rates'));assert(!h.history.slice(initial).some(q=>q.action==='aggregate'));assert.equal(h.max(),2);
});
test('fee failure is terminal and does not stop workorders, comparison, reconciliation or the exclusion lane',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();for(let n=0;n<3;n++)await advance(h);await advanceAction(h,'rates',Error('Synthetic fee read failure'));assert.equal(h.L.feeLookupLoading,false);assert.match(h.L.feeLookupError,/Synthetic fee read failure/);assert.equal(h.history.at(-1).action,'workorders');
 await finish(h,run);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.providerIntake.status,'ready');assert.equal(h.L.providerComparisonIntake.status,'ready');assert(h.L.workorders);assert.equal(h.history.filter(q=>q.action==='submissionAnalysis').length,3);assert.equal(h.history.filter(q=>q.action==='rates').length,1);assert.equal(h.max(),2);
});
test('navigation during supplementary reads aborts both lanes and cannot restore late fees or exclusions',async()=>{
 const h=await setup(),old=h.c.liveQuery();await settle();for(let n=0;n<3;n++)await advance(h);const prior=h.waiting.splice(0);assert.deepEqual(prior.map(e=>e.q.action).sort(),['rates','submissionAnalysis']);h.c.setPage('amount');assert(prior.every(e=>e.signal.aborted));await old;await settle();assert.equal(h.active(),0);assert.equal(h.history.length,5);assert.equal(h.L.feeLookupLoading,false);assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.feeLookupError,'');
 for(const e of prior)e.d.resolve(e.q.action==='rates'?{total:1,rows:[{id:'STALE-FEE'}]}:reply(e.q));await settle();assert.equal(h.L.feeLookupRows,null);h.c.setPage('providers');const fresh=h.c.liveQuery();await finish(h,fresh);assert.equal(h.max(),2);assert.deepEqual(Array.from(h.L.feeLookupRows),[]);assert.equal(h.L.results.length,3);
 const next=h.c.liveQuery(true);await finish(h,next);assert.equal(h.history.filter(q=>q.action==='rates').length,3,'explicit force refresh rereads the complete fee directory');assert.equal(h.max(),2);
});
test('changed scope aborts both supplementary lanes and old finally cannot release the fresh query phase',async()=>{
 const h=await setup(),old=h.c.liveQuery();await settle();for(let n=0;n<3;n++)await advance(h);const prior=h.waiting.splice(0),count=h.history.length;
 h.c.liveSet('provider','Synthetic next provider');const next=h.c.liveQuery();await settle();assert(prior.every(e=>e.signal.aborted));assert.equal(h.active(),2);assert.equal(h.history.at(-1).action,'aggregate');assert.match(h.html(),/live-read-phase/);
 for(const e of prior)e.d.resolve(e.q.action==='rates'?{total:1,rows:[{id:'STALE-FEE'}]}:reply(e.q));await old;await settle();assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.feeLookupError,'');assert.equal(h.active(),2);assert.match(h.html(),/live-read-phase/);await finish(h,next);
 assert.equal(h.max(),2);assert.deepEqual(Array.from(h.L.feeLookupRows),[]);assert(h.history.slice(count).filter(q=>q.action==='aggregate').every(q=>q.providers?.[0]==='Synthetic next provider'));assert(!h.html().includes('live-read-phase'));
});


test('provider payout reads its existing fee phase immediately after current native orders without starting deposit exclusion',async()=>{
 const h=await setup('provider_payout'),run=h.c.liveQuery();await settle();
 for(let n=0;n<3;n++){assert.equal(h.waiting[0].q.action,'aggregate');assert.equal(h.waiting[0].q.direction,'withdraw');await advance(h)}
 assert.equal(h.L.loading,false);assert.equal(h.L.results.length,3);assert.equal(h.history.at(-1).action,'rates');assert.equal(h.history.filter(q=>q.action==='submissionAnalysis').length,0);assert.equal(h.history.filter(q=>q.action==='aggregate').length,3);assert.equal(h.active(),1);assert.equal(h.controls.ready(),false);
 await advance(h);assert.equal(h.history.at(-1).action,'aggregate','payout comparison starts only after the fee phase settles');await finish(h,run);assert.equal(h.max(),1);assert.equal(h.L.feeLookupLoading,false);assert.equal(h.L.feeLookupError,'');assert.equal(h.controls.ready(),true);
});


test('same-scope normal query reuses exclusion and intake caches, while refresh, close-all and pagehide invalidate them',async()=>{
 const listeners={},h=await setup('providers',{beforeLive(c){c.addEventListener=(name,callback)=>(listeners[name]??=[]).push(callback)},reply(q){const value=reply(q);if(q.action==='submissionAnalysis')value.coverage={orderCount:65,missingMemberCount:0,unknownStatusCount:0,orderSequenceUncertainCount:0,sourceCompletenessVerified:false};return value}});
 await finish(h,h.c.liveQuery());const count=()=>({submission:h.history.filter(q=>q.action==='submissionAnalysis').length,intake:h.history.filter(q=>q.action==='intakeCoverage').length});const initial=count();assert.equal(initial.submission,3);assert(initial.intake>0);
 await finish(h,h.c.liveQuery());assert.deepEqual(count(),initial);
 await finish(h,h.c.liveQuery(true));assert.deepEqual(count(),{submission:6,intake:initial.intake*2});
 const beforeHide=count();for(const callback of listeners.pagehide||[])callback({persisted:false});await finish(h,h.c.liveQuery());assert.equal(count().intake,beforeHide.intake+initial.intake,'pagehide clears coverage catalog and fragments');
 const beforeClose=count();h.c.liveCloseAllPages();h.c.setPage('providers');h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';await finish(h,h.c.liveQuery());assert.equal(count().intake,beforeClose.intake+initial.intake,'close-all clears coverage catalog and fragments');assert.equal(h.max(),2);
});


test('non-provider tail still loads current overview empty-source coverage and requested workorders without a previous-intake no-op',async()=>{
 const h=await setup('overview',{reply(q){const r=reply(q);return q.action==='aggregate'?{...r,total:0,summary:[],groups:{provider:[],daily:[],hourly:[],amount:[],matrix:[]}}:r}});h.L.overviewAnalysis=true;h.L.direction='charge';h.L.multi.direction=['charge'];await finish(h,h.c.liveQuery());
 assert.equal(h.L.results.length,3);assert.equal(h.L.loading,false);assert.equal(h.L.overviewIntake.charge.status,'ready');assert(h.L.workorders);assert.equal(h.history.filter(q=>q.action==='workorders').length,1);const coverage=h.history.filter(q=>q.action==='intakeCoverage'&&q.operation==='rows');assert(coverage.length>0);assert(coverage.every(q=>q.startAt==='2026-09-22'&&q.endAt==='2026-09-22'),'overview evidence uses only the current query dates');assert.equal(h.history.filter(q=>q.action==='submissionAnalysis').length,0);
});

test('selected-provider bands and fee display share one complete directory on cold, ordinary and forced queries',async()=>{
 const row={id:'synthetic-band-rate',provider:'Synthetic provider',country:'印度',scopeType:'country',category:'UPI',collectFee:'4%',collectLimit:'250-25000',payoutFee:'2%',payoutLimit:'500-100000'};
 const h=await setup('providers',{extraModules:['live-amount-bands.js'],reply:q=>q.action==='rates'?{rows:[row],total:1}:reply(q)});
 h.c.liveSet('provider','Synthetic provider');const run=h.c.liveQuery(false);await settle();
 assert.deepEqual(h.history.map(q=>q.action),['rates']);assert.equal(h.active(),1);assert.equal(h.L.loading,true);assert.equal(h.L.feeLookupLoading,true);
 await advance(h);assert.equal(h.L.feeLookupRows[0].id,row.id);assert.equal(h.L.amountBandProfiles.charge.edges[0],250);assert.equal(h.L.amountBandProfiles.charge.edges[10],25000);assert.equal(h.active(),2);
 await finish(h,run);const band=h.L.amountBandProfiles.charge.edges;
 assert.equal(h.history.filter(q=>q.action==='rates').length,1,'the later fee phase reuses the exact completed directory');
 for(const q of h.history.filter(q=>['aggregate','submissionAnalysis'].includes(q.action))){assert.deepEqual(Array.from(q.amountBands.charge),Array.from(band));assert.deepEqual(Array.from(q.providers),['Synthetic provider']);}
 const before=h.history.filter(q=>['rates','aggregate'].includes(q.action)).length;await finish(h,h.c.liveQuery(false));assert.equal(h.history.filter(q=>['rates','aggregate'].includes(q.action)).length,before,'same scope reuses both the fee snapshot and aggregate windows');
 await finish(h,h.c.liveQuery(true));assert.equal(h.history.filter(q=>q.action==='rates').length,2,'force replaces the complete directory once, not once per consumer');assert.equal(h.max(),2);
});

test('selected-provider limit pagination is aborted on a filter edit and cannot start stale orders',async()=>{
 const h=await setup('providers',{extraModules:['live-amount-bands.js']});h.c.liveSet('provider','Synthetic provider');const run=h.c.liveQuery(true);await settle();
 const first=h.waiting.shift();first.d.resolve({rows:[{id:'partial',provider:'Synthetic provider',collectLimit:'250-25000'}],total:2});await settle();
 const pending=h.waiting.shift();assert.equal(pending.q.action,'rates');assert.equal(pending.q.offset,1);h.c.liveSet('provider','Synthetic next provider');await run;await settle();assert.equal(pending.signal.aborted,true);assert.equal(h.L.feeLookupRows,null);assert.equal(h.history.length,2);assert(!h.history.some(q=>q.action==='aggregate'));assert.equal(h.active(),0);
 pending.d.resolve({rows:[{id:'late'}],total:2});await settle();h.c.render();h.c.providerSummarySort('all_count');h.c.livePage(1,'local');assert.equal(h.history.length,2);assert.equal(h.L.feeLookupRows,null);
 await finish(h,h.c.liveQuery(false));assert.equal(h.history.filter(q=>q.action==='rates').length,3);assert(h.history.filter(q=>q.action==='aggregate').every(q=>q.providers?.[0]==='Synthetic next provider'));assert.equal(h.max(),2);
});

test('legacy date and provider edits release owned loading after cancelling selected-provider bands',async()=>{
 for(const page of ['provider_daily','providers']){
  const h=await setup(page,{extraModules:['live-amount-bands.js']});h.c.liveSet('provider','Synthetic provider');const run=h.c.liveQuery(true);await settle();const serial=h.L.serial,pending=h.waiting.shift();assert.equal(pending.q.action,'rates');
  if(page==='provider_daily')h.c.liveReferenceEnd('2026-09-21');else h.c.liveProvider('Synthetic next provider');
  assert.equal(h.L.serial,serial+(page==='providers'?1:0),'provider links cancel the owned query; legacy date controls are fenced by dirty scope');await run;await settle();assert.equal(pending.signal.aborted,true);assert.equal(h.L.loading,false);assert.equal(h.L.feeLookupLoading,false);assert.equal(h.L.dirty,true);assert.equal(h.history.length,1);assert(!h.html().includes('live-read-phase'));assert.equal(h.active(),0);
  pending.d.resolve({rows:[{id:'late'}],total:1});await settle();h.c.render();assert.equal(h.L.feeLookupRows,null);assert.equal(h.history.length,1);
 }
});

test('cancelled legacy band preparation cannot clear the replacement query loading owner',async()=>{
 const h=await setup('providers',{extraModules:['live-amount-bands.js']});h.c.liveSet('provider','Synthetic provider');const old=h.c.liveQuery(true);await settle();const prior=h.waiting.shift(),serial=h.L.serial;
 h.c.liveProvider('Synthetic next provider');const replacement=h.c.liveQuery(false);await old;await settle();assert(h.L.serial>serial);assert.equal(prior.signal.aborted,true);assert.equal(h.L.loading,true);assert.equal(h.L.feeLookupLoading,true);assert.equal(h.waiting[0].q.action,'rates');
 prior.d.resolve({rows:[{id:'late'}],total:1});await settle();assert.equal(h.L.loading,true);assert.equal(h.L.feeLookupRows,null);await finish(h,replacement);assert.equal(h.L.loading,false);assert(h.history.filter(q=>q.action==='aggregate').every(q=>q.providers?.[0]==='Synthetic next provider'));assert.equal(h.max(),2);
});
