/* Real host/navigation/submission modules. Synthetic deferred responses only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,P};')(require,__dirname);
const Q={...P,id:'22222222-2222-4222-8222-222222222222',name:'Synthetic second'},R={...P,id:'33333333-3333-4333-8333-333333333333',name:'Synthetic third'},platforms=[P,Q,R];
function response(q,more={}){
 const metrics=[10,15,20,30,50,100].flatMap(t=>[null,'Pay A'].map(provider=>({provider,threshold:t,qualified_member_count:t<30?1:0,qualified_member_days:t<30?1:0,member_count:t<30?1:0,member_days:t<30?1:0,invalid_count:t<30?30:0,l0_members:0,new_members:0,funded_members:0,unknown_members:0})));
 return {platform:platforms.find(p=>p.id===q.platformId)||P,startAt:q.startAt,endAt:q.endAt,version:3,basis:'platform_local_day_all_providers_zero_success_whole_day_over_threshold',exemptCount:0,thresholdComparison:'gt',metrics,coverage:{orderCount:100,calculationComplete:true,coverageUnknownDays:0,missingMemberCount:0,unknownStatusCount:0,orderSequenceUncertainCount:0},dashboard:{version:3,threshold:15,exemptCount:0,thresholdComparison:'gt',amountBands:q.amountBands,monitoring:[null,'Pay A'].map(provider=>({provider,order_count:100,success_count:50,invalid_count:30,order_amount:'10000',invalid_amount:'3000'})),hourly:[{provider:'Pay A',hour:10,count:30}],daily:[{day:'2026-09-22',order_count:100,invalid_count:30}],amounts:[{bucket:'band:1',count:30}],frequency:[{band:'30–49',count:1}]},...more};
}
async function setup(){const controls={ready:null,cancels:0,hostCancel:[]};let api;
 const h=harness({page:'events',platforms,submission:true,roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,beforeLive(c){c.hensemDataScope={mode:'all',identity:'synthetic-account-scope-v1'};c.HensemLiveSyncHealth={configure(o){controls.ready=o.ready},cancel(){controls.cancels++},schedule(){},badge:()=>''};c.hensemLiveCancelRequests=actions=>controls.hostCancel.push(actions);const create=c.HensemSubmissionAnalysis.create;c.HensemSubmissionAnalysis.create=config=>api=create(config);}});await settle();h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';h.L.initialReadComplete=true;
 const waiting=[],history=[];let active=0,max=0;
 h.c.hensemLiveRequest=(q,options={})=>{if(q.action!=='submissionAnalysis')return Promise.resolve({providers:[]});const d=deferred(),entry={q,d,signal:options.signal};waiting.push(entry);history.push(q);active++;max=Math.max(max,active);let counted=true;const release=()=>{if(counted){counted=false;active--;}},abort=()=>{release();d.reject(Object.assign(Error('查询已取消'),{name:'AbortError'}));};options.signal?.addEventListener('abort',abort,{once:true});return d.promise.finally(()=>{release();options.signal?.removeEventListener('abort',abort)});};
 return {...h,api,waiting,history,controls,active:()=>active,max:()=>max};
}
async function advance(h,error,patch){const r=h.waiting.shift();assert(r,'an active platform exists');error?r.d.reject(error):r.d.resolve(response(r.q,patch));await settle();return r;}
async function finish(h,run,handler){for(let i=0;i<40;i++){await settle();if(h.waiting.length){const item=h.waiting[0],value=handler?.(item.q);await advance(h,value instanceof Error?value:null,value instanceof Error?undefined:value);}else if(!h.html().includes('live-read-phase'))break;}await run;await settle();}

test('events owns one lane, cancels health, disables health readiness and keeps charts true throughout retries',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();assert.equal(h.active(),1);assert.equal(h.controls.ready(),false);assert(h.controls.cancels>0);assert(h.controls.hostCancel.some(a=>a.includes('syncHealth')));assert.equal(h.L.loading,false,'host loading may end, but phase remains');assert.match(h.html(),/读取刷单风控统计/);
 await advance(h,Error('读取超时'));assert.equal(h.active(),1);assert.equal(h.controls.ready(),false);await finish(h,run);assert.equal(h.max(),1);assert.deepEqual(h.history.map(q=>q.platformId),[P.id,Q.id,R.id,P.id]);assert(h.history.every(q=>q.charts===true));assert.equal(h.controls.ready(),true);assert.equal(h.api.metric().complete,true);assert(!h.html().includes('live-read-phase'));
});
test('identical in-flight query joins existing work and queued platforms have no active deadline',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();const count=h.history.length,timers=h.timers.length;await h.c.liveQuery();await settle();assert.equal(h.history.length,count);assert.equal(h.timers.length,timers);assert.equal(h.history.length,1);await finish(h,run);assert.equal(h.max(),1);
});
test('a repeated same-scope query reuses verified results with zero RPC; explicit refresh rereads all',async()=>{
 const h=await setup();await finish(h,h.c.liveQuery());const n=h.history.length,stamp=h.api.capture().results[0]._submissionReadAt;
 await h.c.liveQuery();assert.equal(h.history.length,n);assert(h.api.capture().results.every(r=>r._submissionCacheHit));assert.equal(h.api.capture().results[0]._submissionReadAt,stamp);assert.match(h.html(),/数据读取[^<]*缓存/);assert(h.writes.some(w=>/onclick="liveQuery\(true\)"/.test(w.html)),'the rendered filters provide explicit refresh');
 await finish(h,h.c.liveQuery(true));assert.equal(h.history.length,n+3);assert(h.api.capture().results.every(r=>!r._submissionCacheHit));assert.equal(h.max(),1);
});
test('successful cached platforms are retained while failed platforms still retry exactly once and remain visible',async()=>{
 const h=await setup();await finish(h,h.c.liveQuery(),q=>q.platformId===Q.id?Error('读取超时'):undefined);assert.equal(h.api.metric().received,2);assert.equal(h.api.metric().complete,false);assert.equal(h.api.capture().failures[0].attempts,2);assert.match(h.html(),/部分统计待核对/);const n=h.history.length;
 await finish(h,h.c.liveQuery(),q=>q.platformId===Q.id?Error('读取超时'):undefined);assert.deepEqual(h.history.slice(n).map(q=>q.platformId),[Q.id,Q.id]);assert.equal(h.api.metric().received,2);assert.equal(h.api.metric().complete,false);assert.match(h.html(),/重试未完成/);
 const start=h.history.length;await finish(h,h.c.liveSubmissionRetryPlatform(Q.id));assert.deepEqual(h.history.slice(start).map(q=>q.platformId),[Q.id]);assert.equal(h.api.metric().complete,true);
});
test('cache expiration, scope and native identity changes require new reads rather than broadening stored results',async()=>{
 const h=await setup();await finish(h,h.c.liveQuery());let n=h.history.length;h.setNow('2026-09-23T12:05:00Z');await finish(h,h.c.liveQuery());assert.equal(h.history.length,n+3,'historical TTL ends at 5 minutes');
 n=h.history.length;h.c.liveSet('provider','Pay A');await finish(h,h.c.liveQuery());assert.equal(h.history.length,n+3);assert(h.history.slice(n).every(q=>q.providers?.[0]==='Pay A'));
 n=h.history.length;h.L.catalog.find(p=>p.id===P.id).sourceName='Synthetic changed native binding';await finish(h,h.c.liveQuery());assert.equal(h.history.length,n+3);
});
test('actor and permission identity cannot reuse cache or publish an old response after withdrawal',async()=>{
 const h=await setup();await finish(h,h.c.liveQuery());let n=h.history.length;h.c.hensemDataScope.identity='synthetic-account-scope-v2';await finish(h,h.c.liveQuery());assert.equal(h.history.length,n+3);
 const run=h.c.liveQuery(true);await settle();const old=h.waiting.shift();h.c.hensemRoleAllowed=()=>false;old.d.resolve(response(old.q));await run;await settle();assert.equal(h.api.metric().available,false);assert.equal(h.history.length,n+4,'no later platform after query permission is removed');
});
test('incomplete coverage, missing dashboard and invalid responses never receive successful cache reuse',async()=>{
 for(const patch of [{coverage:{orderCount:100,calculationComplete:false}},{dashboard:null},{version:2},{coverage:{orderCount:100,calculationComplete:true,missingSuccessTimeCount:1}}]){const h=await setup();await finish(h,h.c.liveQuery(),()=>patch);const n=h.history.length;await finish(h,h.c.liveQuery(),()=>patch);assert.equal(h.history.length,n+3);assert(h.api.capture().results.every(r=>!r._submissionCacheHit));}
});
test('navigation aborts the platform and the old finally cannot clear a newer query phase',async()=>{
 const h=await setup(),old=h.c.liveQuery();await settle();const entry=h.waiting.shift();h.c.liveSet('provider','Pay A');assert.equal(entry.signal.aborted,true);const current=h.c.liveQuery();await settle();assert.match(h.html(),/live-read-phase/);entry.d.resolve(response(entry.q));await old;assert.match(h.html(),/live-read-phase/);assert.equal(h.active(),1);await finish(h,current);assert.equal(h.max(),1);assert(h.history.slice(1).every(q=>q.providers?.[0]==='Pay A'));
 const next=h.c.liveQuery(true);await settle();const pending=h.waiting.shift();h.c.setPage('amount');assert.equal(pending.signal.aborted,true);await next;assert.equal(h.active(),0);assert(!h.html().includes('live-read-phase'));
});
test('missing recharge history is retained as source evidence and opening its explanation performs no history query',async()=>{
 const h=await setup();await finish(h,h.c.liveQuery(),q=>{if(q.platformId!==Q.id)return;const r=response(q);r.coverage.missingRechargeCount=100;r.metrics.forEach(x=>x.unknown_members=7);return r;});assert.match(h.html(),/7 个 ID 充值历史待补/);assert.equal(h.api.metric().complete,true);const n=h.history.length;h.c.liveSubmissionCoverage();assert.equal(h.history.length,n);assert.match(h.drawers.at(-1).html,/缺失字段需由采集端补传并补采对应日期/);
});

test('current-day reuse keeps the exact original window for 30 seconds and then reads a fresh window',async()=>{
 const h=await setup();h.c.liveSet('from','2026-09-23T00:00:00');h.c.liveSet('to','2026-09-23T23:59:59');await finish(h,h.c.liveQuery());const n=h.history.length,end=h.history[0].endAt;
 h.setNow('2026-09-23T12:00:29Z');await h.c.liveQuery();assert.equal(h.history.length,n);assert.equal(h.api.capture().results[0].endAt,end);
 h.setNow('2026-09-23T12:00:30Z');await finish(h,h.c.liveQuery());assert.equal(h.history.length,n+3);assert.notEqual(h.history.at(-1).endAt,end);assert.equal(h.max(),1);
});
test('an explicit single-platform retry also pauses health and cannot reread a cached ready platform',async()=>{
 const h=await setup();await finish(h,h.c.liveQuery(),q=>q.platformId===Q.id?Error('读取超时'):undefined);const n=h.history.length,cancels=h.controls.cancels;
 await h.c.liveSubmissionRetryPlatform(P.id);assert.equal(h.history.length,n);const run=h.c.liveSubmissionRetryPlatform(Q.id);await settle();assert.equal(h.controls.ready(),false);assert(h.controls.cancels>cancels);assert.equal(h.history.length,n+1);await finish(h,run);assert.equal(h.controls.ready(),true);assert.equal(h.api.metric().complete,true);
});

test('a three-minute today batch may reuse its exact window after completion, without extending old platform TTL or renewing the anchor',async()=>{
 const h=await setup();h.c.liveSet('from','2026-09-23T00:00:00');h.c.liveSet('to','2026-09-23T23:59:59');const run=h.c.liveQuery();await settle();const end=h.history[0].endAt;
 h.setNow('2026-09-23T12:01:00Z');await advance(h);h.setNow('2026-09-23T12:02:00Z');await advance(h);h.setNow('2026-09-23T12:03:00Z');await advance(h);await run;const n=h.history.length,completion=h.api.capture().windowCompletedAt;
 await finish(h,h.c.liveQuery());assert.deepEqual(h.history.slice(n).map(q=>q.platformId),[P.id,Q.id],'old early-platform cache entries still expire');assert(h.history.slice(n).every(q=>q.endAt===end));assert.equal(h.api.capture().results.find(r=>r.platform.id===R.id)._submissionCacheHit,true);assert.equal(h.api.capture().windowCompletedAt,completion,'cache hits and same-window retries do not extend the window anchor');
 const m=h.history.length;h.setNow('2026-09-23T12:03:31Z');await finish(h,h.c.liveQuery());assert.equal(h.history.length,m+3);assert.notEqual(h.history.at(-1).endAt,end);assert(h.api.capture().results.every(r=>!r._submissionCacheHit));
});

// The fingerprinted AR/NEWAR version3 summary emits explicit gap counters but
// has no calculationComplete/coverageUnknownDays/missingSuccessTimeCount fields.
function legacySummary(q,h,change){
 const r=response(q);r.platform={...h.L.catalog.find(p=>p.id===q.platformId)};
 r.coverage={orderCount:100,missingMemberCount:0,missingLevelCount:0,missingRechargeCount:0,unknownStatusCount:0,orderSequenceUncertainCount:0,sourceCompletenessVerified:false};
 change?.(r);return r;
}
function legacySources(h){Object.assign(h.L.catalog.find(p=>p.id===P.id),{source:'ar',scopeGroup:'IN',sourceName:'91CLUB',name:'91CLUB'});Object.assign(h.L.catalog.find(p=>p.id===Q.id),{source:'newar',scopeGroup:'IN',sourceName:'MAANWIN',name:'MAAN.WIN'});}

test('actual AR/NEWAR summary wire without calculationComplete reuses the exact successful snapshot and refresh remains explicit',async()=>{
 const h=await setup();legacySources(h);const wire=q=>legacySummary(q,h);await finish(h,h.c.liveQuery(),wire);const n=h.history.length,prior=h.api.capture().results.map(r=>[r.platform.id,r._submissionReadAt,r.startAt,r.endAt]);
 assert.equal(h.api.metric().complete,true);assert(h.api.capture().results.every(r=>!Object.hasOwn(r.coverage,'calculationComplete')));
 await finish(h,h.c.liveQuery(),wire);assert.equal(h.history.length,n,'same actor/native/query/window within TTL issues zero RPCs');assert(h.api.capture().results.every(r=>r._submissionCacheHit));assert.deepEqual(h.api.capture().results.map(r=>[r.platform.id,r._submissionReadAt,r.startAt,r.endAt]),prior);
 assert(h.api.capture().results.every(r=>r.coverage.sourceCompletenessVerified===false&&!Object.hasOwn(r.coverage,'calculationComplete')),'a cache hit never manufactures source or calculation proof');
 await finish(h,h.c.liveQuery(true),wire);assert.equal(h.history.length,n+3);assert(h.api.capture().results.every(r=>!r._submissionCacheHit));assert.equal(h.max(),1);
});

test('legacy caching never coerces missing or malformed mandatory gap counters to zero',async()=>{
 for(const key of ['orderCount','missingMemberCount','unknownStatusCount','orderSequenceUncertainCount'])for(const value of [undefined,null,false,'0',-1,0.5]){
  const h=await setup();legacySources(h);const wire=q=>legacySummary(q,h,r=>{if(q.platformId===Q.id){if(value===undefined)delete r.coverage[key];else r.coverage[key]=value;}});
  await finish(h,h.c.liveQuery(),wire);const n=h.history.length;await finish(h,h.c.liveQuery(),wire);assert.deepEqual(h.history.slice(n).map(q=>q.platformId),[Q.id],key+' '+String(value));assert(h.api.capture().results.filter(r=>r.platform.id!==Q.id).every(r=>r._submissionCacheHit));
 }
});

test('explicit calculation failure and unknown legacy source-completeness contracts refuse reuse',async()=>{
 for(const change of [r=>r.coverage.calculationComplete=false,r=>r.coverage.calculationComplete=null,r=>delete r.coverage.sourceCompletenessVerified,r=>r.coverage.sourceCompletenessVerified=true]){
  const h=await setup();legacySources(h);const wire=q=>legacySummary(q,h,r=>{if(q.platformId===Q.id)change(r);});await finish(h,h.c.liveQuery(),wire);const n=h.history.length;await finish(h,h.c.liveQuery(),wire);assert.deepEqual(h.history.slice(n).map(q=>q.platformId),[Q.id]);
 }
});

test('present optional gap fields must be exact zero integers and positive gaps stay uncached',async()=>{
 for(const key of ['coverageUnknownDays','missingSuccessTimeCount'])for(const value of [null,false,'0',-1,0.5,1]){
  const h=await setup();legacySources(h);const wire=q=>legacySummary(q,h,r=>{if(q.platformId===Q.id)r.coverage[key]=value;});await finish(h,h.c.liveQuery(),wire);const n=h.history.length;await finish(h,h.c.liveQuery(),wire);assert.deepEqual(h.history.slice(n).map(q=>q.platformId),[Q.id],key+' '+String(value));
 }
});

test('missing native recharge history remains unknown in a reused legacy result',async()=>{
 const h=await setup();legacySources(h);const wire=q=>legacySummary(q,h,r=>{if(q.platformId===Q.id){r.coverage.missingRechargeCount=100;r.coverage.missingLevelCount=20;r.metrics.forEach(x=>x.unknown_members=7);}});await finish(h,h.c.liveQuery(),wire);const n=h.history.length;assert.match(h.html(),/7 个 ID 充值历史待补/);await finish(h,h.c.liveQuery(),wire);assert.equal(h.history.length,n);assert.match(h.html(),/7 个 ID 充值历史待补/);const cached=h.api.capture().results.find(r=>r.platform.id===Q.id);assert.equal(cached.coverage.missingRechargeCount,100);assert.equal(cached.coverage.sourceCompletenessVerified,false);
});

test('YASH cache requires explicit complete calculation and source/day/success-time coverage',async()=>{
 const good=r=>{r.coverage={...r.coverage,calculationComplete:true,sourceCompletenessVerified:true,coverageUnknownDays:0,missingSuccessTimeCount:0};};
 for(const change of [null,r=>delete r.coverage.calculationComplete,r=>r.coverage.calculationComplete=false,r=>delete r.coverage.sourceCompletenessVerified,r=>r.coverage.sourceCompletenessVerified=false,r=>delete r.coverage.coverageUnknownDays,r=>r.coverage.coverageUnknownDays=1,r=>delete r.coverage.missingSuccessTimeCount,r=>r.coverage.missingSuccessTimeCount=1]){
  const h=await setup();legacySources(h);Object.assign(h.L.catalog.find(p=>p.id===Q.id),{source:'kb',scopeGroup:'IN',sourceName:'YASH.BET',name:'YASH.BET'});const wire=q=>legacySummary(q,h,r=>{if(q.platformId===Q.id){good(r);change?.(r);}});await finish(h,h.c.liveQuery(),wire);const n=h.history.length;await finish(h,h.c.liveQuery(),wire);assert.deepEqual(h.history.slice(n).map(q=>q.platformId),change?[Q.id]:[]);
 }
});

test('calculationComplete omission is supported only for the known AR/NEWAR legacy summaries',async()=>{
 for(const source of ['lg','game66']){const h=await setup();legacySources(h);h.L.catalog.find(p=>p.id===Q.id).source=source;const wire=q=>legacySummary(q,h);await finish(h,h.c.liveQuery(),wire);const n=h.history.length;await finish(h,h.c.liveQuery(),wire);assert.deepEqual(h.history.slice(n).map(q=>q.platformId),[Q.id]);}
});

test('real legacy-wire reuse still expires and cannot cross native scope, account identity or revoked permission',async()=>{
 const h=await setup();legacySources(h);const wire=q=>legacySummary(q,h);await finish(h,h.c.liveQuery(),wire);let n=h.history.length;
 h.setNow('2026-09-23T12:05:00Z');await finish(h,h.c.liveQuery(),wire);assert.equal(h.history.length,n+3,'historical TTL is unchanged');
 n=h.history.length;h.c.hensemDataScope.identity='synthetic-account-scope-v2';await finish(h,h.c.liveQuery(),wire);assert.equal(h.history.length,n+3);
 n=h.history.length;h.c.liveSet('provider','Pay A');await finish(h,h.c.liveQuery(),wire);assert.equal(h.history.length,n+3);assert(h.history.slice(n).every(q=>q.providers?.[0]==='Pay A'));
 n=h.history.length;h.L.catalog.find(p=>p.id===Q.id).sourceName='Synthetic new binding';await finish(h,h.c.liveQuery(),wire);assert.equal(h.history.length,n+3);
 n=h.history.length;h.c.hensemRoleAllowed=()=>false;await h.c.liveQuery();assert.equal(h.history.length,n);assert.equal(h.api.metric().available,false);
});

test('the actual today legacy wire keeps its original window without extending the result TTL',async()=>{
 const h=await setup();legacySources(h);h.c.liveSet('from','2026-09-23T00:00:00');h.c.liveSet('to','2026-09-23T23:59:59');const wire=q=>legacySummary(q,h);await finish(h,h.c.liveQuery(),wire);const n=h.history.length,end=h.history[0].endAt,stamp=h.api.capture().results[0]._submissionReadAt;
 h.setNow('2026-09-23T12:00:29Z');await h.c.liveQuery();assert.equal(h.history.length,n);assert(h.api.capture().results.every(r=>r.endAt===end));assert.equal(h.api.capture().results[0]._submissionReadAt,stamp);
 h.setNow('2026-09-23T12:00:30Z');await finish(h,h.c.liveQuery(),wire);assert.equal(h.history.length,n+3);assert.notEqual(h.history.at(-1).endAt,end);
});
