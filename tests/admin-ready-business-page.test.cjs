// Shared real page controller, prepared manager and render modules. Synthetic read counts, not real timings.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,completeAggregate,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,completeAggregate,P};')(require,__dirname);
const platforms=Array.from({length:43},(_,i)=>({...P,id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),name:'Synthetic '+i,sourceName:'Native '+i}));
const mainStart='2026-09-21T18:30:00.000Z',priorStart='2026-09-20T18:30:00.000Z';
const reads=h=>h.calls.filter(q=>q.action==='aggregatePrepared');
function result(p,natives=platforms){return {version:2,...(p.readMode?{readMode:p.readMode}:{}),items:p.requests.map(request=>{
 const r={...completeAggregate(natives.find(n=>n.id===request.platformId),100,40),version:1,startAt:request.startAt,endAt:request.endAt,...(request.successBasis==='created'?{successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false}}:{successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis})};
 if(request.amountBands){Object.assign(r,{amountBands:request.amountBands,amountBandsVersion:1});Object.assign(r.groups,{amount_range:[],matrix_range:[]});}
 const v={request,status:'ready',publication:{id:'synthetic-'+request.platformId+'-'+request.startAt,generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:00:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:r};
 if(p.responseProfile){
  assert(['time-v1','amount-v1'].includes(p.responseProfile));
  const groups=p.responseProfile==='time-v1'?['hourly','provider']:request.amountBands?['amount','amount_range','provider']:['amount','provider'];
  r.groups=Object.fromEntries(groups.map(name=>[name,r.groups[name]]));
  v.resultGroups={contract:'prepared-result-groups-v1',profile:p.responseProfile,groups};
 }
 return v;
 })};}
const other=q=>q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{};
function dates(h){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',successFrom:'',successTo:''});}
async function setup(page,count=43,natives=platforms.slice(0,count),extraModules=[]){
 const h=harness({page,platforms:natives,roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,
  extraModules:['live-statistic-windows.js','live-prepared-aggregates.js',...(page==='amount'?['live-matrix-custom-range.js']:[]),...extraModules],beforeLive:c=>{c.HENSEM_PREPARED_READY_ONLY=true;c.HENSEM_AMOUNT_READY_ONLY=true;}});
 await settle();dates(h);h.setHandler(q=>q.action==='aggregatePrepared'?result(q,natives):other(q));return h;
}
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


test('amount history reads the submitted India business day and its exact previous provider day in bounded batches',async()=>{
 const h=await setup('amount',43);
 await h.c.liveQuery();await settle();
 assert.equal(h.L.results.length,43);assert.equal(h.L.comparisonResults.length,43);assert.equal(h.L.comparisonStatus,'ready');
 const requests=reads(h);
 for(const [start,end,view,profile] of [[mainStart,'2026-09-22T18:30:00.000Z','full','amount-v1'],[priorStart,mainStart,'providers',undefined]]){
  const phase=requests.filter(p=>p.requests[0].startAt===start);
  assert.deepEqual(phase.map(p=>p.requests.length),[20,20,3]);
  assert.equal(new Set(phase.flatMap(p=>p.requests.map(q=>q.platformId))).size,43);
  for(const p of phase){
   assert.equal(p.readMode,'ready-only-v1');assert.equal(p.responseProfile,profile);
   assert(!Object.hasOwn(p,'forceRefresh'));
   for(const q of p.requests){
    assert.equal(q.view||'full',view);assert.equal(q.startAt,start);assert.equal(q.endAt,end);
    assert.equal(q.currency,'INR');assert.equal(q.successBasis,'created');assert(!Object.hasOwn(q,'successStartAt'));assert(!Object.hasOwn(q,'successEndAt'));
   }
  }
 }
 assert.equal(requests.length,6);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
 assert.deepEqual(Object.keys(h.L.results[0].groups).sort(),['amount','provider']);
 assert.equal(h.L.results[0]._preparedPublication.sourceComplete,false);
 assert.match(h.html(),/金额分布与订单状态/);
});

test('18 ready amount platforms per period keep their receipts while exactly the two misses use their original requests',async()=>{
 const h=await setup('amount',20),missing=new Set(platforms.slice(5,7).map(p=>p.id));
 h.setHandler(p=>{
  if(p.action!=='aggregatePrepared')return other(p);
  const out=result(p);
  if(p.readMode)out.items=out.items.map(item=>missing.has(item.request.platformId)
   ?{request:item.request,status:'miss',reason:'ready_head_missing',publication:null,result:null}
   :item);
  return out;
 });
 await h.c.liveQuery();await settle();
 for(const [start,profile] of [[mainStart,'amount-v1'],[priorStart,undefined]]){
  const phase=reads(h).filter(p=>p.requests[0].startAt===start);
  const probes=phase.filter(p=>p.readMode);assert.equal(probes.length,1);assert.equal(probes[0].requests.length,20);
  const fallback=phase.filter(p=>!p.readMode);assert.equal(fallback.length,1);assert.equal(fallback[0].responseProfile,profile);
  assert.deepEqual(fallback[0].requests,probes[0].requests.filter(q=>missing.has(q.platformId)));
 }
 assert.equal(reads(h).length,4);assert.equal(h.L.results.length,20);assert.equal(h.L.comparisonResults.length,20);
 assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.comparisonStatus,'ready');
});

for(const kind of ['force','two days','partial day','today','independent success','explicit matching success','another country','filtered status','flag off','old shell']){
 test('amount '+kind+' uses the ordinary read path for both periods',async()=>{
  const natives=kind==='another country'?platforms.slice(0,4).map(p=>({...p,country:'巴西',scopeGroup:'brazil',currency:'BRL',timezone:'America/Sao_Paulo'})):platforms.slice(0,4);
  const h=await setup('amount',4,natives);
  if(kind==='two days')h.L.from='2026-09-21T00:00:00';
  if(kind==='partial day')h.L.from='2026-09-22T00:00:01';
  if(kind==='today'){h.L.from='2026-09-23T00:00:00';h.L.to='2026-09-23T23:59:59';}
  if(kind==='independent success'){h.L.successFrom='2026-09-19T09:30:00';h.L.successTo='2026-09-19T19:00:00';}
  if(kind==='explicit matching success'){h.L.successFrom=h.L.from;h.L.successTo=h.L.to;}
  if(kind==='filtered status')h.L.status='success';
  if(kind==='old shell')delete h.c.HENSEM_AMOUNT_READY_ONLY;
  if(kind==='flag off')h.c.HENSEM_AMOUNT_READY_ONLY=false;
  await (kind==='force'?h.c.liveRefresh():h.c.liveQuery());await settle();
  const requests=reads(h);assert(requests.length>0);
  assert(requests.every(p=>!p.readMode&&p.requests.length<=3));
  assert.equal(h.L.queryFailures.length,0);
  if(kind==='today')assert.match(h.L.comparisonError,/当前时间段尚未结束/);
  else assert.equal(h.L.comparisonStatus,'ready');
 });
}

test('editing a custom amount interval keeps its original full hourly result',async()=>{
 const h=await setup('amount',1);await h.c.liveQuery();await settle();const n=reads(h).length;
 h.c.liveMatrixAmountSet('min','200');h.c.liveMatrixAmountSet('max','300');
 await h.c.liveMatrixAmountQuery();await settle();
 const interval=reads(h).slice(n);assert.equal(interval.length,1);assert.equal(interval[0].readMode,undefined);
 assert.equal(interval[0].responseProfile,undefined);assert.equal(interval[0].requests[0].view,'full');
 assert.equal(interval[0].requests[0].amountMin,200);assert.equal(interval[0].requests[0].amountMax,300);
 assert.equal(interval[0].requests[0].amountMaxExclusive,true);assert.doesNotMatch(h.html(),/小时汇总未完整返回/);
});


test('a genuine empty amount projection is usable while a failed platform cannot appear as zero',async()=>{
 const h=await setup('amount',3);
 const [empty,,missing]=platforms;
 h.setHandler(p=>{
  if(p.action!=='aggregatePrepared')return other(p);
  if(p.requests[0].startAt===mainStart&&!p.readMode)throw Error('Synthetic missing publication');
  const out=result(p);
  if(p.readMode&&p.requests[0].startAt===mainStart){
   out.items=out.items.map(item=>{
    if(item.request.platformId===missing.id)return {request:item.request,status:'miss',reason:'ready_head_missing',publication:null,result:null};
    if(item.request.platformId===empty.id){item.result.total=0;item.result.summary=[];item.result.groups={amount:[],provider:[]};}
    return item;
   });
  }
  return out;
 });
 await h.c.liveQuery();await settle();
 assert.equal(h.L.results.find(r=>r.platform.id===empty.id)?.total,0);
 assert.deepEqual(Array.from(h.L.results.find(r=>r.platform.id===empty.id).groups.amount),[]);
 assert(!h.L.results.some(r=>r.platform.id===missing.id));
 assert(h.L.queryFailures.some(r=>r.id===missing.id));
 assert.deepEqual(reads(h).filter(p=>!p.readMode&&p.requests[0].startAt===mainStart).flatMap(p=>p.requests.map(q=>q.platformId)),[missing.id]);
});

// One real selected-provider range, deliberately placed on the last page.
const feeDirectory=Array.from({length:1001},(_,id)=>({
 id,scopeType:'country',country:'印度',provider:id===1000?'Synthetic provider':'Other '+id,
 collectFee:'4%',collectLimit:'250-25000',payoutFee:'2%',payoutLimit:'500-100000'
}));
function feePage(offset,count=500,total=feeDirectory.length){
 return {rows:feeDirectory.slice(offset,offset+count),total,offset,limit:500};
}
async function pendingFeeQuery(page='amount',configure=()=>{},refresh=false){
 const h=await setup(page,1,undefined,['live-amount-bands.js']);
 h.L.provider='Synthetic provider';h.L.multi.provider=[h.L.provider];configure(h);
 const pending=[],original=h.c.hensemLiveRequest;
 h.c.hensemLiveRequest=(request,options)=>{
  if(request.action!=='rates')return original(request,options);
  const gate=deferred();pending.push({...gate,request,signal:options.signal});return gate.promise;
 };
 const run=refresh?h.c.liveRefresh():h.c.liveQuery();await settle();
 const offsets=()=>pending.map(p=>p.request.offset);
 assert.deepEqual(offsets(),[0]);
 return {h,pending,offsets,run};
}

test('historical India amount preflight waits for exact total then merges the two remaining fee pages in offset order',async()=>{
 const {h,pending,offsets,run}=await pendingFeeQuery();
 pending[0].resolve(feePage(0));await settle();assert.deepEqual(offsets(),[0,500,1000]);
 assert(pending.every(({request})=>request.country==='IN'&&request.scopeType==='all'&&request.limit===500));
 pending[2].resolve(feePage(1000));await settle();
 assert.equal(h.L.feeLookupRows,null);assert.equal(reads(h).length,0);
 pending[1].resolve(feePage(500));await run;await settle();
 assert.deepEqual(Array.from(h.L.feeLookupRows,r=>r.id),feeDirectory.map(r=>r.id));
 assert.deepEqual(offsets(),[0,500,1000]);assert.equal(h.L.results.length,1);
 const current=reads(h).find(q=>q.requests[0].startAt===mainStart).requests[0];
 assert.equal(current.amountBands.charge[0],250);assert.equal(current.amountBands.withdraw.at(-1),100000);
});

test('a short middle fee page resumes from the actual next offset and discards the speculative tail',async()=>{
 const {h,pending,offsets,run}=await pendingFeeQuery();
 pending[0].resolve(feePage(0));await settle();assert.deepEqual(offsets(),[0,500,1000]);
 pending[2].resolve({...feePage(1000),rows:[{id:'unused speculative row'}]});
 pending[1].resolve(feePage(500,318));await settle();assert.deepEqual(offsets(),[0,500,1000,818]);
 assert.equal(h.L.feeLookupRows,null);assert.equal(reads(h).length,0);
 pending[3].resolve(feePage(818));await run;await settle();
 assert.equal(h.L.feeLookupError,'');
 assert.deepEqual(Array.from(h.L.feeLookupRows,r=>r.id),feeDirectory.map(r=>r.id));
});

test('a short first fee page advances by its real length before any read-ahead',async()=>{
 const {h,pending,offsets,run}=await pendingFeeQuery();
 pending[0].resolve(feePage(0,275));await settle();assert.deepEqual(offsets(),[0,275]);
 pending[1].resolve(feePage(275));await settle();assert.deepEqual(offsets(),[0,275,775]);
 pending[2].resolve(feePage(775));await run;await settle();
 assert.deepEqual(Array.from(h.L.feeLookupRows,r=>r.id),feeDirectory.map(r=>r.id));
});

for(const changedOffset of [500,1000])test('changed fee total at offset '+changedOffset+' never publishes a partial directory',async()=>{
 const {h,pending,offsets,run}=await pendingFeeQuery();
 pending[0].resolve(feePage(0));await settle();assert.deepEqual(offsets(),[0,500,1000]);
 for(const p of pending.slice(1))p.resolve(feePage(p.request.offset,500,p.request.offset===changedOffset?1002:1001));
 await run;await settle();
 assert.equal(h.L.feeLookupRows,null);assert.match(h.L.feeLookupError,/目录不完整/);
 assert.deepEqual(offsets(),[0,500,1000]);
});

for(const transition of ['navigate','permission denial'])test('late fee pages cannot publish after '+transition,async()=>{
 const {h,pending,offsets,run}=await pendingFeeQuery();
 pending[0].resolve(feePage(0));await settle();assert.deepEqual(offsets(),[0,500,1000]);
 if(transition==='navigate'){
  h.c.setPage('time');assert(pending.slice(1).every(p=>p.signal.aborted));
 }else{
  h.c.hensemRoleAllowed=(page,action)=>page!=='amount'||action!=='query';
  pending[2].reject(Object.assign(Error('Synthetic grant revoked'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));
  await settle();assert(pending[1].signal.aborted,'the still-pending sibling is cancelled');
 }
 for(const p of pending.slice(1))p.resolve(feePage(p.request.offset));
 await run;await settle();assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.results.length,0);
 assert.deepEqual(offsets(),[0,500,1000]);
});

for(const replacement of ['role','account'])test('successful late fee pages still recheck '+replacement+' authority',async()=>{
 const {h,pending,offsets,run}=await pendingFeeQuery();
 pending[0].resolve(feePage(0));await settle();assert.deepEqual(offsets(),[0,500,1000]);
 pending[2].resolve(feePage(1000));await settle();
 if(replacement==='role')h.c.hensemRoleAllowed=(page,action)=>page!=='amount'||action!=='query';
 else h.c.hensemDataScope={mode:'selected',identity:'new synthetic account'};
 pending[1].resolve(feePage(500));await run;await settle();
 assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.results.length,0);
});

for(const name of ['time','matrix','unfinished amount','last half-second in India','explicit refresh','flag disabled'])test(name+' keeps sequential fee pagination',async()=>{
 const page=['time','matrix'].includes(name)?name:'amount';
 const {h,pending,offsets,run}=await pendingFeeQuery(page,h=>{
  if(name==='unfinished amount'){h.L.from='2026-09-23T00:00:00';h.L.to='2026-09-23T23:59:59';}
  if(name==='last half-second in India')h.setNow('2026-09-22T18:29:59.500Z');
  if(name==='flag disabled')h.c.HENSEM_AMOUNT_READY_ONLY=false;
 },name==='explicit refresh');
 pending[0].resolve(feePage(0));await settle();assert.deepEqual(offsets(),[0,500]);
 pending[1].resolve(feePage(500));await settle();assert.deepEqual(offsets(),[0,500,1000]);
 pending[2].resolve(feePage(1000));await run;await settle();
 assert.deepEqual(Array.from(h.L.feeLookupRows,r=>r.id),feeDirectory.map(r=>r.id));
});
