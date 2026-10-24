const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,completeAggregate,deferred,P}=new Function('require','__dirname',prefix+';return {harness,settle,completeAggregate,deferred,P};')(require,__dirname);
const M={...P,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'MAAN.WIN',source:'newar',sourceName:'MAANWIN',scopeGroup:'IN',team:'M8'};
const A={...P,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Active platform',source:'ar',sourceName:'ACTIVE',scopeGroup:'IN',team:'M8'};
const evidence={targetId:M.id,platform:M.name,source:M.source,sourceName:M.sourceName,scopeGroup:M.scopeGroup,country:M.country,currency:M.currency,timezone:M.timezone,evidenceKind:'user_confirmed_not_operating',confirmedFrom:'2026-10-01',confirmedThrough:'2026-10-05',operatingFrom:'2026-10-06',confirmation:'Synthetic user confirmation'};
const catalog=platforms=>({platforms,platformLifecycle:{version:1,revision:'a'.repeat(32),items:[evidence]}});
const dates=(h,from='2026-10-02',to=from)=>Object.assign(h.L,{from:from+'T00:00:00',to:to+'T23:59:59',successFrom:'',successTo:'',dirty:true});
function response(q,platforms){return {version:q.publicationVersion||1,...(q.readMode?{readMode:q.readMode}:{}),items:q.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-'+request.platformId,generation:1,computedAt:'2026-10-22T10:00:00Z',expiresAt:'2026-10-22T10:10:00Z',cutoff:'2026-10-22T10:00:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:{version:1,...(request.durationVersion?{durationVersion:request.durationVersion}:{}),...completeAggregate(platforms.find(p=>p.id===request.platformId),10,5),startAt:request.startAt,endAt:request.endAt,...(request.successBasis==='created'?{successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false}}:{successBasis:request.successBasis,successStartAt:request.successStartAt,successEndAt:request.successEndAt})}}))};}
async function setup(page='providers',platforms=[M,A]){
 const handler=q=>q.action==='catalog'?catalog(platforms):q.action==='aggregatePrepared'?response(q,platforms):q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{};
 const h=harness({page,platforms,handler,roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-platform-lifecycle.js','live-statistic-windows.js','live-prepared-aggregates.js','live-success-analysis.js']});
 await settle();h.setNow('2026-10-22T10:01:00Z');dates(h);return h;
}
const paymentRequests=h=>h.calls.filter(q=>q.action==='aggregatePrepared').flatMap(q=>q.requests);
test('metadata helper is authority/native-bound, ignores malformed clocks and does not extrapolate',()=>{
 const c={Intl,Date};c.window=c;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-platform-lifecycle.js'),'utf8'),c);
 let authority='A';const model=c.HensemPlatformLifecycle.create({authority:()=>authority});model.replace(catalog([M,A]));
 assert(model.range(M,'2026-10-01','2026-10-05').notOperating);assert.equal(model.range(M,'2026-09-30','2026-10-05').notOperating,false);
 assert.equal(model.range({...M,sourceName:'wrong'},'2026-10-01','2026-10-05'),null);
 const q={platformId:M.id,startAt:'2026-09-30T18:30:00Z',endAt:'2026-10-05T18:30:00Z',successBasis:'success',successStartAt:'2026-10-01T18:30:00Z',successEndAt:'bad'};
 assert.equal(model.request(M,q),null);authority='B';assert.equal(model.range(M,'2026-10-01','2026-10-05'),null);assert.equal(model.revision(),'');
});
for(const page of ['overview','providers','provider_payout','time','amount','matrix','provider_daily','latency','risk','merchants','teamops','teamcountries','teamplatforms','collection','payout','success_analysis'])test(page+' queries only operating platforms and never leaves inactive platform in missing/paused queue',async()=>{
 const h=await setup(page);await h.c.liveQuery();await settle();
 assert(paymentRequests(h).length>0);assert(paymentRequests(h).every(q=>q.platformId===A.id));assert.equal(h.L.queryPlatforms.length,2);assert.equal(h.L.results.length,1);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.loading,false);assert.match(h.html(),/未营业/);assert.doesNotMatch(h.html(),/MAAN\.WIN：尚未完成|MAAN\.WIN：统计尚未准备|未读取：MAAN/);
 const before=paymentRequests(h).length;await h.c.liveRetryFailed(true);await settle();assert.equal(paymentRequests(h).length,before,'resume never retries an inactive platform');assert.equal(h.L.queryPaused,false);
});
test('all inactive avoids unavailable retry prompt and fabricated zero totals',async()=>{
 for(const page of ['providers','overview','time']){const h=await setup(page,[M]);await h.c.liveQuery();await settle();assert.equal(paymentRequests(h).length,0);assert.equal(h.L.results.length,0);assert.match(h.html(),/没有应查询订单，金额与笔数不填零/);assert.doesNotMatch(h.html(),/重试未完成平台|当前范围暂无可用统计/);}
});
test('cross opening boundary and an independent successful window are still real reads',async()=>{
 const h=await setup();dates(h,'2026-10-05','2026-10-06');await h.c.liveQuery();await settle();assert(paymentRequests(h).some(q=>q.platformId===M.id));
 const h2=await setup();dates(h2);h2.L.successFrom='2026-10-06T00:00:00';h2.L.successTo='2026-10-06T23:59:59';await h2.c.liveQuery();await settle();assert(paymentRequests(h2).some(q=>q.platformId===M.id));
});
test('authority drift and catalog replacement do not retain lifecycle from old identity',async()=>{
 const h=await setup();await h.c.liveQuery();await settle();h.c.hensemDataScope={mode:'selected',identity:'another'};dates(h);const before=paymentRequests(h).length;await h.c.liveQuery();await settle();assert(paymentRequests(h).slice(before).some(q=>q.platformId===M.id),'no lifecycle proof survives authority change');
});
test('catalog reread removes retired lifecycle evidence and makes the next query read the native target',async()=>{
 const h=await setup();await h.c.liveQuery();await settle();
 h.setHandler(q=>q.action==='catalog'?{platforms:[M,A]}:q.action==='aggregatePrepared'?response(q,[M,A]):q.action==='rates'?{rows:[],total:0}:{});
 h.L.catalogReady=false;await h.c.liveRetryCatalog();await settle();dates(h);const before=paymentRequests(h).length;await h.c.liveQuery();await settle();
 assert(paymentRequests(h).slice(before).some(q=>q.platformId===M.id));assert.equal(h.L.platformLifecycleFor(M),null);
});
for(const code of ['ADMIN_LIVE_CANCELLED','ADMIN_LIVE_PERMISSION_DENIED'])test('supplementary '+code+' does not classify confirmed inactive platforms as unfinished',async()=>{
 const h=await setup();h.setHandler(q=>{if(q.action==='aggregatePrepared')return response(q,[M,A]);if(q.action==='rates')throw Object.assign(Error('Synthetic host interruption'),{code});return {};});
 await h.c.liveQuery();await settle();assert.equal(h.L.queryPaused,false);assert.equal(h.L.loading,false);assert.equal(h.L.queryRetrying,false);
 assert.equal(h.L.results.length,code==='ADMIN_LIVE_CANCELLED'?1:0);const before=paymentRequests(h).length;await h.c.liveRetryFailed(true);await settle();assert.equal(paymentRequests(h).length,before);
 if(code==='ADMIN_LIVE_PERMISSION_DENIED')assert.match(h.L.error,/权限/);else assert(paymentRequests(h).every(q=>q.platformId===A.id));
});
test('completed mixed-active view is retained and an old page response cannot overwrite a new date selection',async()=>{
 const h=await setup();await h.c.liveQuery();await settle();assert(h.L.retainedContent,'one operating result satisfies the retained-view denominator');
 const held=deferred();let oldRequest;h.setHandler(q=>{if(q.action==='aggregatePrepared'){if(!oldRequest){oldRequest=q;return held.promise;}return response(q,[M,A]);}return q.action==='rates'?{rows:[],total:0}:{};});
 dates(h,'2026-10-03');const old=h.c.liveQuery(true);await settle();assert(oldRequest);h.c.setPage('time');dates(h,'2026-10-06');await h.c.liveQuery();await settle();
 const serial=h.L.serial,snapshot=JSON.stringify(h.L.results);held.resolve(response(oldRequest,[M,A]));await old;await settle();
 assert.equal(h.L.serial,serial);assert.equal(JSON.stringify(h.L.results),snapshot);assert.equal(h.c.state.page,'time');assert.equal(h.L.results.length,2);assert(paymentRequests(h).some(q=>q.platformId===M.id));
});
test('real success-rate matrix labels inactive cells and retains unknown null rather than zero',async()=>{
 const h=await setup('success_analysis');await h.c.liveQuery();await settle();assert.match(h.html(),/未营业/);assert.doesNotMatch(h.html(),/MAAN\.WIN[^<]*0\.00%/);
 const model=h.c.HensemLiveSuccessAnalysis.buildModel({L:h.L,scopeMatches:true,workordersScopeMatches:false,lifecycle:p=>h.L.platformLifecycleFor(p)});
 const idx=model.columns.findIndex(p=>p.id===M.id);assert.equal(model.footers.charge[idx].notOperating,true);assert.equal(model.footers.charge[idx].value,null);assert.equal(model.footers.charge[idx].total,null);
});
test('automatic withdrawal renders independent operating-day evidence without changing source completeness or amounts',()=>{
 const src=fs.readFileSync(path.join(__dirname,'admin-newar-withdraw-ui.test.cjs'),'utf8').split(/\ntest\(/)[0];
 const {fixture}=new Function('require','__dirname',src+';return {fixture};')(require,__dirname);
 const base={startDate:'2026-10-01',endDate:'2026-10-07',prepared:{sourceComplete:false},newarCoverage:{currentComplete:false,previousComplete:false,days:[{country:'印度',platform:'MAANWIN',date:'2026-10-06',complete:true},{country:'印度',platform:'MAANWIN',date:'2026-10-07',complete:true}]},operatingCoverage:{version:1,basis:'user_confirmed_lifecycle_and_original_daily_coverage',items:[{...evidence,platform:'MAANWIN',periods:{current:{startDate:'2026-10-01',endDate:'2026-10-07',notOperatingDates:['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05'],operatingExpectedDays:2,operatingCoveredDays:2,state:'complete'}}}]}};
 for(const operators of [false,true]){const f=fixture(JSON.parse(JSON.stringify(base)),operators),before=JSON.stringify(f.page.state.data),html=f.render();if(operators){assert.match(html,/营业日覆盖 2 \/ 2/);assert.match(html,/已确认未营业/);assert.match(html,/data-newar-coverage="partial"/);assert.match(html,/不能作为完整总计/);}else{assert.match(html,/data-withdraw-publication="subtotal"/);assert.doesNotMatch(html,/<summary>数据说明/);}assert.equal(JSON.stringify(f.page.state.data),before);}
 const bad=JSON.parse(JSON.stringify(base));bad.operatingCoverage.items[0].periods.current.startDate='2026-10-02';assert.doesNotMatch(fixture(bad).render(),/data-operating-coverage/);
});
