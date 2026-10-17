// Actual production modules with synthetic server publications, never online timing.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-provider-published-navigation.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,aggregate,envelope,platform,feed}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,aggregate,envelope,platform,feed};')(require,__dirname);
const copy=x=>JSON.parse(JSON.stringify(x));
const platforms=Array.from({length:18},(_,i)=>({...platform,id:(i+1).toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111',sourceName:'Audit native '+i,name:'Audit platform '+i}));
function prepared(q,status='ready'){
 return {version:2,items:q.requests.map(request=>({request,status,publication:{id:'audit:'+request.platformId+':'+request.startAt,generation:1,computedAt:'2026-10-17T11:00:00Z',expiresAt:'2026-10-17T11:30:00Z',cutoff:'2026-10-17T11:00:00Z',calculationComplete:true,sourceComplete:false,freshness:'refresh_due',refreshState:'idle'},result:status==='ready'?{...aggregate(platforms.find(p=>p.id===request.platformId),14),version:1,startAt:request.startAt,endAt:request.endAt,successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis}:null}))};
}
async function fixture(options={}){
 let custom=options.handler,h;
 const handler=q=>{const changed=custom?.(q);if(changed!==undefined)return changed;
  if(q.action==='catalog')return {platforms};
  if(q.action==='providerOptions')return {providers:['Synthetic provider']};
  if(q.action==='providerSnapshot')return envelope(q,platforms.filter(p=>q.platformIds.includes(p.id)));
  if(q.action==='aggregatePrepared')return prepared(q);
  if(q.action==='rates')return {rows:[],total:0};
  if(q.action==='workorders')return {rows:[],byProvider:[],total:0,summary:{},byDirection:{},auditMarker:'workorders:'+h.L.from.slice(0,10)};
  if(q.action==='submissionAnalysis')return {...envelope({startAt:h.L.from,endAt:h.L.to},[platforms.find(p=>p.id===q.platformId)]).platforms[0].current.submission,startAt:q.startAt,endAt:q.endAt};
  if(q.action==='intakeCoverage'){
   if(['orderCatalog','catalog'].includes(q.operation))return {version:1,complete:true,feeds:platforms.map(feed)};
   const rows=[];for(let day=Date.parse(q.startAt);day<=Date.parse(q.endAt);day+=86400000)for(const feedId of q.feedIds)rows.push({feedId,date:new Date(day).toISOString().slice(0,10),status:'received',received:true,complete:false,zeroConfirmed:false,expected:true,evidence:'records_received_completeness_unverified'});
   return {version:1,complete:true,feedIds:q.feedIds,startAt:q.startAt,endAt:q.endAt,checkedAt:'2026-10-17T12:00:00Z',rows};
  }
  throw Error('Unexpected audit request: '+q.action);
 };
 h=harness({page:'providers',platforms,submission:true,ancillaryHandler:true,roleAccess:{mode:'owner',canView:true,permissions:[]},roleAllowed:options.roleAllowed||(()=>true),extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-provider-intake.js','live-provider-snapshot-shadow.js','live-provider-published.js'],beforeLive:c=>{c.hensemDataScope={identity:'audit-owner',mode:'all'};},handler});
 await settle();h.setNow('2026-10-17T12:00:00Z');
 h.setDay=day=>{for(const [key,value]of Object.entries({from:day+'T00:00:00',to:day+'T23:59:59',successFrom:day+'T00:00:00',successTo:day+'T23:59:59'}))h.c.liveMetricTimeSet(key,value);};
 h.setDay('2026-10-16');h.override=fn=>custom=fn;return h;
}
test('16th uses its rolling store; 14th bypasses stale rolling slots and reads all18 exact heads plus original attachments',async()=>{
 const h=await fixture();await h.c.liveQuery();assert.equal(h.L.providerReadMode,'published');assert.equal(h.calls.filter(q=>q.action==='providerSnapshot').length,1);assert.equal(h.L.results.length,18);
 const before=h.calls.length;h.setDay('2026-10-14');await h.c.liveQuery();await settle();const calls=h.calls.slice(before);
 assert.equal(calls.filter(q=>q.action==='providerSnapshot').length,0);assert.equal(calls.filter(q=>q.action==='aggregate').length,0);assert.equal(h.L.providerReadMode,'live');assert.equal(h.L.providerPublished,null);assert.equal(h.L.results.length,18);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.comparisonResults.length,18);
 for(const q of calls.filter(q=>q.action==='aggregatePrepared'))for(const r of q.requests){assert.equal(r.direction,'charge');assert.equal(r.successBasis,'success');assert.equal(r.successStartAt,r.startAt);assert.equal(r.successEndAt,r.endAt);assert.equal(r.currency,'INR');assert(['2026-10-13T18:30:00.000Z','2026-10-12T18:30:00.000Z'].includes(r.startAt));}
 assert(h.L.results.every(r=>r.startAt==='2026-10-13T18:30:00.000Z'&&r.endAt==='2026-10-14T18:30:00.000Z'&&r._preparedPublication.calculationComplete===true&&r._preparedPublication.sourceComplete===false));
 assert.equal(h.L.workorders.auditMarker,'workorders:2026-10-14');assert(Array.isArray(h.L.feeLookupRows));assert.equal(h.L.providerIntake.status,'ready');assert.equal(h.L.providerComparisonIntake.status,'ready');assert.equal(h.L.providerIntake.from,'2026-10-14');assert.equal(h.L.providerComparisonIntake.from,'2026-10-13');assert.equal(calls.filter(q=>q.action==='submissionAnalysis').length,18);
});
test('unprepared historical heads remain explicit unknown with no old-store or raw-order retry',async()=>{
 const h=await fixture({handler:q=>q.action==='aggregatePrepared'?prepared(q,'missing'):undefined});h.setDay('2026-10-14');await h.c.liveQuery();await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,18);assert(h.L.queryFailures.every(f=>/尚未准备/.test(f.message)));assert.equal(h.calls.filter(q=>['providerSnapshot','aggregate'].includes(q.action)).length,0);
});
test('India midnight changes the rolling horizon using India date, including month and year boundaries',async()=>{
 const h=await fixture(),api=h.c.HensemProviderPublished;
 for(const [now,allowed,blocked]of [['2026-10-16T18:29:59Z','2026-10-15','2026-10-14'],['2026-10-16T18:30:00Z','2026-10-16','2026-10-15'],['2026-10-31T18:30:00Z','2026-10-31','2026-10-30'],['2026-12-31T18:30:00Z','2026-12-31','2026-12-30']]){
  const input=day=>({page:'providers',L:{direction:'charge',status:'all',from:day+'T00:00:00',to:day+'T23:59:59'},platforms,visible:platforms,now:Date.parse(now)});assert.equal(api.eligible(input(allowed)),true);assert.equal(api.eligible(input(blocked)),false);
 }
});
test('cancelling a historical exact read prevents its late publication from replacing a restored recent tab',async()=>{
 const wait=deferred();let held;
 const h=await fixture({handler:q=>{if(q.action==='aggregatePrepared'&&!held){held=copy(q);return wait.promise;}}});h.setDay('2026-10-14');const run=h.c.liveQuery();await settle();assert(held);h.c.setPage('amount');await settle();wait.resolve(prepared(held));await run;await settle();assert.equal(h.c.state.page,'amount');assert.equal(h.L.results.length,0);assert.equal(h.calls.filter(q=>['providerSnapshot','aggregate'].includes(q.action)).length,0);
});
test('historical permission denial clears former data and cannot switch stores',async()=>{
 const h=await fixture();await h.c.liveQuery();h.override(q=>{if(q.action==='aggregatePrepared')throw Object.assign(Error('safe denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});});h.setDay('2026-10-14');const before=h.calls.length;await h.c.liveQuery();await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.providerPublished,null);assert.match(h.L.error,/权限/);assert.equal(h.calls.slice(before).filter(q=>['providerSnapshot','aggregate'].includes(q.action)).length,0);
});
