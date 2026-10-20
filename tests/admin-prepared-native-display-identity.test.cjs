// Real shared controller and identity normalization; synthetic publications only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-aggregate-cache.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,aggregate}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,aggregate};')(require,__dirname);
const clone=x=>JSON.parse(JSON.stringify(x));
const HK={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic HK',source:'game66',sourceName:'Synthetic HK',country:'香港',scopeGroup:'HK_TEAM',team:'香港',timezone:'Asia/Kolkata',currency:'INR'};
const RED={...HK,id:'22222222-2222-4222-8222-222222222222',name:'Synthetic Red',sourceName:'Synthetic Red',country:'红膏蟹',scopeGroup:'RED_CRAB',team:'红膏蟹'};
function item(request,platform){
 const result={...aggregate(clone(platform),123),version:1,startAt:request.startAt,endAt:request.endAt,successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis,...(request.durationVersion?{durationVersion:request.durationVersion}:{})};
 if(request.amountBands)Object.assign(result.groups,{amount_range:[],matrix_range:[]});
 return {request:clone(request),status:'ready',publication:{id:'synthetic-native-'+platform.id,generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result};
}
function response(q,platforms=[HK,RED]){return {version:2,items:q.requests.map(request=>item(request,platforms.find(p=>p.id===request.platformId)))}}
function request(platform=HK){return {action:'aggregate',view:'providers',platformId:platform.id,startAt:'2026-09-21T18:30:00.000Z',endAt:'2026-09-22T00:30:00.000Z',successStartAt:'2026-09-21T18:30:00.000Z',successEndAt:'2026-09-22T00:30:00.000Z',successBasis:'success',direction:'all',status:'all',currency:'INR',offset:0,limit:20}}
async function ready(page='overview'){
 const h=harness({reports:true,platforms:[clone(HK),clone(RED)],roleAccess:{mode:'owner',canView:true,permissions:[]},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-success-analysis.js'],beforeLive:c=>{c.TextEncoder=TextEncoder;}});
 await settle();h.c.setPage(page);await settle();
 Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',successFrom:'',successTo:'',successBasis:'success'});
 h.setHandler(q=>q.action==='aggregatePrepared'?response(q):q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{});return h;
}
const preparedCalls=h=>h.calls.filter(q=>q.action==='aggregatePrepared');
const read=(h,q=request())=>h.c.__cacheTest.readAggregate(q,h.L.serial);

for(const page of ['overview','collection','payout','merchants','providers','provider_payout','success_analysis','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms'])test(page+': India display accepts exact Hong Kong and Red Crab native publications',async()=>{
 const h=await ready(page);assert.equal(h.L.country,'印度');await h.c.liveQuery();await settle();
 assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.length,2);
 assert.deepEqual(Array.from(h.L.results,r=>r.platform.country).sort(),[HK.country,RED.country].sort());
 assert(h.L.results.every(r=>r.summary[0].all_count===123&&r._preparedPublication.sourceComplete===false));
 assert(h.L.results.every(r=>h.c.HensemLiveReportData.normalizeIdentity(r.platform).country==='印度'));
 assert(preparedCalls(h).length>0);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
});

test('wrong native platform, source, raw country, source group, timezone, currency and exact windows remain rejected',async()=>{
 const edits=[r=>r.platform.id=RED.id,r=>r.platform.source='ar',r=>r.platform.sourceName='other',
  r=>r.platform.country='印度',r=>r.platform.country=RED.country,r=>r.platform.scopeGroup=RED.scopeGroup,
  r=>r.platform.timezone='Asia/Karachi',r=>r.platform.currency='PKR',r=>r.startAt='2026-09-21T18:30:00.000001Z',
  r=>r.successEndAt='2026-09-22T00:30:00.000001Z',r=>r.partial=true,r=>delete r.groups.provider];
 for(const edit of edits){const h=await ready();h.setHandler(q=>{const r=response(q);r.items.forEach(i=>edit(i.result));return r});await assert.rejects(read(h),/范围或结构不完整/);await assert.rejects(read(h),/范围或结构不完整/);assert.equal(preparedCalls(h).length,2,'invalid native publication is never cached');}
});

test('native catalog changes hidden by the India display mapping invalidate in-flight and cached results',async()=>{
 for(const patch of [{country:'红膏蟹'},{scopeGroup:'GAME66_HK'},{currency:'PKR'},{sourceName:'replacement'}]){
  const h=await ready(),wait=deferred();h.setHandler(q=>q.action==='aggregatePrepared'?wait.promise:{});const pending=read(h),rejected=assert.rejects(pending);await settle();
  const sent=preparedCalls(h)[0];h.L.catalog=h.L.catalog.map(p=>p.id===HK.id?{...p,...patch}:p);
  wait.resolve(response(sent));await rejected;assert.equal(h.L.results.length,0);
  h.setHandler(q=>response(q));await assert.rejects(read(h),/范围或结构不完整/);assert.equal(preparedCalls(h).length,2);
 }
 const h=await ready();await read(h);const before=preparedCalls(h).length;
 h.L.catalog=h.L.catalog.map(p=>p.id===HK.id?{...p,country:'红膏蟹',scopeGroup:'RED_CRAB'}:p);
 await assert.rejects(read(h),/范围或结构不完整/);assert.equal(preparedCalls(h).length,before+1,'a changed native source cannot reuse the old completed publication');
});

test('hidden teams and removed native IDs cannot use a visible display alias to replay a publication',async()=>{
 for(const change of [h=>h.L.catalog=h.L.catalog.filter(p=>p.id!==HK.id),h=>h.L.catalog=h.L.catalog.map(p=>p.id===HK.id?{...p,team:'BDG'}:p)]){
  const h=await ready();await read(h);const before=preparedCalls(h).length;change(h);
  await assert.rejects(read(h));assert.equal(preparedCalls(h).length,before,'no transport after native visibility is revoked');
 }
 const h=await ready(),wait=deferred();h.setHandler(q=>q.action==='aggregatePrepared'?wait.promise:{});const pending=read(h),rejected=assert.rejects(pending);await settle();
 const sent=preparedCalls(h)[0];h.c.hensemDataScope={identity:'different-account',mode:'all'};wait.resolve(response(sent));await rejected;assert.equal(h.L.results.length,0);
});
