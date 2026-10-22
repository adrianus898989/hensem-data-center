// Actual production modules with synthetic server publications, never online timing.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-provider-published-navigation.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,aggregate,envelope,platform,feed}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,aggregate,envelope,platform,feed};')(require,__dirname);
const copy=x=>JSON.parse(JSON.stringify(x));
const platforms=Array.from({length:18},(_,i)=>({...platform,id:(i+1).toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111',sourceName:'Audit native '+i,name:'Audit platform '+i}));
function prepared(q,status='ready'){
 return {version:2,items:q.requests.map(request=>({request,status,publication:{id:'audit:'+request.platformId+':'+request.startAt,generation:1,computedAt:'2026-10-17T11:00:00Z',expiresAt:'2026-10-17T11:30:00Z',cutoff:'2026-10-17T11:00:00Z',calculationComplete:true,sourceComplete:false,freshness:'refresh_due',refreshState:'idle'},result:status==='ready'?{...aggregate(platforms.find(p=>p.id===request.platformId),14),version:1,startAt:request.startAt,endAt:request.endAt,...(request.successBasis==='created'?{successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false}}:{successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis})}:null}))};
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
function unsupported(q){return {...copy(envelope(q,[])),status:'unsupported',complete:false,freshness:null,window:null,publishedCutoff:null,cutoffEpochMs:null,computedAt:null,platforms:[],missing:[]};}
test('normal Query continues a valid unsupported recent publication into one shared prepared query without another click',async()=>{
 const h=await fixture({handler:q=>q.action==='providerSnapshot'?unsupported(q):undefined});await h.c.liveQuery();await settle();
 assert.equal(h.calls.filter(q=>q.action==='providerSnapshot').length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert.equal(h.L.providerReadMode,'live');assert.equal(h.L.providerPublished,null);assert.equal(h.L.publishedWindow,null);assert.equal(h.L.results.length,18);assert.equal(h.L.queryFailures.length,0);assert(h.L.results.every(r=>r.startAt==='2026-10-15T18:30:00.000Z'&&r.endAt==='2026-10-16T18:30:00.000Z'&&r.successStartAt===r.startAt&&r.successEndAt===r.endAt));assert.equal(h.L.successFrom,'2026-10-16T00:00:00');assert.equal(h.L.successTo,'2026-10-16T23:59:59');assert.doesNotMatch(h.html(),/当前范围尚未发布汇总|读取统一汇总/);
 const perRequest=new Map();for(const c of h.calls.filter(q=>q.action==='aggregatePrepared'))for(const q of c.requests){const key=JSON.stringify(q);perRequest.set(key,(perRequest.get(key)||0)+1);}assert([...perRequest.values()].every(n=>n===1),'each current/previous native query sent once');assert(h.calls.filter(q=>q.action==='aggregatePrepared').every(q=>q.requests.length<=3));
});
test('unsupported continuation clears older published data and repeated Query cannot overlap pending prepared transport',async()=>{
 const h=await fixture();await h.c.liveQuery();assert.equal(h.L.results.length,18);const wait=deferred();let held;
 h.override(q=>{if(q.action==='providerSnapshot')return unsupported(q);if(q.action==='aggregatePrepared'){held??=copy(q);return wait.promise;}});h.setDay('2026-10-17');const run=h.c.liveQuery();await settle();assert(held);assert.equal(h.L.providerPublished,null);assert.equal(h.L.retainedContent,null);assert.equal(h.L.results.length,0);assert.equal(h.L.comparisonResults.length,0);const snapshots=h.calls.filter(q=>q.action==='providerSnapshot').length,preparedReads=h.calls.filter(q=>q.action==='aggregatePrepared').length;await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='providerSnapshot').length,snapshots);assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,preparedReads);
 h.c.setPage('amount');wait.resolve(prepared(held));await run;await settle();assert.equal(h.c.state.page,'amount');assert.equal(h.L.results.length,0);assert.equal(h.L.providerPublished,null);
});
test('navigation, filter edits and authority changes before unsupported arrives prevent continuation',async()=>{
 for(const change of ['page','filter','permission','account','catalog']){const wait=deferred();let allowed=true,held;const h=await fixture({roleAllowed:()=>allowed,handler:q=>{if(q.action==='providerSnapshot'){held=copy(q);return wait.promise;}}});const run=h.c.liveQuery();await settle();if(change==='page')h.c.setPage('amount');if(change==='filter')h.c.liveMetricTimeSet('from','2026-10-15T00:00:00');if(change==='permission')allowed=false;if(change==='account')h.c.hensemDataScope={identity:'other',mode:'all'};if(change==='catalog')h.L.catalog=[];wait.resolve(unsupported(held));await run;await settle();assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,0,change);assert.equal(h.L.results.length,0,change);}
});
test('HTTP errors, authorization denial and malformed unsupported responses cannot trigger another data path',async()=>{
 for(const response of ['network','denied','malformed']){const h=await fixture({handler:q=>{if(q.action!=='providerSnapshot')return;if(response==='network')throw Error('safe network failure');if(response==='denied')throw Object.assign(Error('safe denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});return {...unsupported(q),complete:true};}});await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,0,response);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0,response);assert.equal(h.L.results.length,0,response);}
});
test('unsupported recent scope with unprepared exact heads stays unknown without recursive fallback',async()=>{
 const h=await fixture({handler:q=>q.action==='providerSnapshot'?unsupported(q):q.action==='aggregatePrepared'?prepared(q,'missing'):undefined});await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='providerSnapshot').length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert.equal(h.L.providerPublished,null);assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,18);assert(h.L.queryFailures.every(r=>/尚未准备/.test(r.message)));
});
test('explicit refresh preserves force intent through unsupported published routing; normal repeats reuse exact prepared results',async()=>{
 const h=await fixture({handler:q=>q.action==='providerSnapshot'?unsupported(q):undefined});await h.c.liveQuery();await settle();const count=()=>h.calls.filter(q=>q.action==='aggregatePrepared').length,n=count();await h.c.liveQuery();await settle();assert.equal(count(),n);await h.c.liveRefresh();await settle();assert(count()>n);assert(h.calls.filter(q=>q.action==='aggregatePrepared').slice(n).some(q=>q.forceRefresh===true));assert.equal(h.L.providerReadMode,'live');assert.equal(h.L.queryFailures.length,0);
});

// V2 stale means a semantic/revision/publication mismatch. TTL-only heads are
// still status ready + freshness refresh_due and must keep their existing path.
function stalePublication(q,{payload=true}={}){
 const b=copy(envelope(q,platforms.filter(p=>q.platformIds.includes(p.id))));
 Object.assign(b,{status:'stale',complete:false,freshness:null,missing:[]});
 for(const entry of b.platforms)for(const s of entry.snapshots){
  if(payload&&!(s.period==='current'&&s.component==='orders'))continue;
  entry[s.period][s.component]=null;Object.assign(s,{stale:true,freshness:null});
  b.missing.push({platformId:entry.platform.id,period:s.period,component:s.component,state:'stale',errorCode:null});
 }
 return b;
}
function assertManualReads(h){
 const counts=new Map();for(const call of h.calls.filter(q=>q.action==='aggregatePrepared'))for(const q of call.requests){
  assert.equal(q.view,'providers');assert.equal(q.direction,'charge');assert.equal(q.currency,'INR');assert.equal(q.successBasis,'success');assert.equal(q.successStartAt,q.startAt);assert.equal(q.successEndAt,q.endAt);
  assert(['2026-10-15T18:30:00.000Z','2026-10-14T18:30:00.000Z'].includes(q.startAt));const key=JSON.stringify(q);counts.set(key,(counts.get(key)||0)+1);
 }
 assert.equal(counts.size,36);assert([...counts.values()].every(n=>n===1));assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
}
test('semantic stale publications with remaining payload or all null automatically use exact manual prepared data once',async()=>{
 for(const payload of [true,false]){
  const h=await fixture({handler:q=>q.action==='providerSnapshot'?stalePublication(q,{payload}):undefined});await h.c.liveQuery();await settle();
  assert.equal(h.calls.filter(q=>q.action==='providerSnapshot').length,1);assert.equal(h.L.providerReadMode,'live');assert.equal(h.L.providerPublished,null);assert.equal(h.L.publishedWindow,null);assert.equal(h.L.results.length,18);assert.equal(h.L.comparisonResults.length,18);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.comparisonStatus,'ready');assertManualReads(h);
  assert(h.L.results.every(r=>r.startAt==='2026-10-15T18:30:00.000Z'&&r.successStartAt===r.startAt&&r._preparedPublication.sourceComplete===false&&r._preparedPublication.freshness==='refresh_due'));assert.doesNotMatch(h.html(),/发布版本需更新|读取统一汇总/);
 }
});
test('semantic stale continuation clears former publication and deduplicates Query while prepared transport is pending',async()=>{
 const h=await fixture();await h.c.liveQuery();assert.equal(h.L.results.length,18);const waits=[],held=[];
 h.override(q=>{if(q.action==='providerSnapshot')return stalePublication(q);if(q.action==='aggregatePrepared'){const wait=deferred();waits.push(wait);held.push(copy(q));return wait.promise;}});
 const run=h.c.liveQuery(true);await settle();assert(held.length);assert.equal(h.L.providerPublished,null);assert.equal(h.L.retainedContent,null);assert.equal(h.L.results.length,0);assert.equal(h.L.comparisonResults.length,0);const before=h.calls.length;await h.c.liveQuery();await settle();assert.equal(h.calls.length,before);
 h.c.setPage('amount');for(let i=0;i<waits.length;i++)waits[i].resolve(prepared(held[i]));await run;await settle();assert.equal(h.c.state.page,'amount');assert.equal(h.L.results.length,0);assert.equal(h.L.providerPublished,null);
});
test('semantic stale late responses cannot continue after page, filter, cancellation, authority or native changes',async()=>{
 for(const change of ['page','filter','cancel','permission','account','catalog']){
  const wait=deferred();let allowed=true,held;const h=await fixture({roleAllowed:()=>allowed,handler:q=>{if(q.action==='providerSnapshot'){held=copy(q);return wait.promise;}}});const run=h.c.liveQuery();await settle();
  if(change==='page')h.c.setPage('amount');if(change==='filter')h.c.liveMetricTimeSet('from','2026-10-15T00:00:00');if(change==='cancel')h.c.liveReset();if(change==='permission')allowed=false;if(change==='account')h.c.hensemDataScope={identity:'other',mode:'all'};if(change==='catalog')h.L.catalog=[];
  wait.resolve(stalePublication(held));await run;await settle();assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,0,change);assert.equal(h.L.results.length,0,change);
 }
});
test('semantic stale prepared failures remain explicit and never recurse or restore stale publication',async()=>{
 for(const failure of ['missing','network','denied']){
  const h=await fixture({handler:q=>{if(q.action==='providerSnapshot')return stalePublication(q);if(q.action!=='aggregatePrepared')return;if(failure==='missing')return prepared(q,'missing');throw Object.assign(Error(failure==='denied'?'safe denied':'safe network failure'),failure==='denied'?{code:'ADMIN_LIVE_PERMISSION_DENIED'}:{});}});await h.c.liveQuery();await settle();
  assert.equal(h.calls.filter(q=>q.action==='providerSnapshot').length,1,failure);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0,failure);assert.equal(h.L.providerPublished,null,failure);assert.equal(h.L.results.length,0,failure);assert.equal(h.L.comparisonResults.length,0,failure);if(failure==='denied')assert.match(h.L.error,/权限/);else assert.equal(h.L.queryFailures.length,18,failure);
 }
});
test('semantic stale must pass native and payload validation before routing; published denial is never a route',async()=>{
 for(const failure of ['denied','malformed','native']){
  const h=await fixture({handler:q=>{if(q.action!=='providerSnapshot')return;if(failure==='denied')throw Object.assign(Error('safe denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});const b=stalePublication(q);if(failure==='malformed')b.complete=true;else b.platforms[0].platform.sourceName='DIFFERENT_NATIVE';return b;}});await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,0,failure);assert.equal(h.L.results.length,0,failure);
 }
});
test('semantic stale routing preserves force and completed-cache reuse while TTL-only last complete stays published',async()=>{
 const h=await fixture({handler:q=>q.action==='providerSnapshot'?stalePublication(q):undefined});await h.c.liveQuery();await settle();const n=h.calls.filter(q=>q.action==='aggregatePrepared').length;await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,n);await h.c.liveRefresh();await settle();assert(h.calls.filter(q=>q.action==='aggregatePrepared').slice(n).some(q=>q.forceRefresh===true));
 const ttl=await fixture({handler:q=>{if(q.action!=='providerSnapshot')return;const b=copy(envelope(q,platforms));b.freshness='refresh_due';b.refreshState='failed';for(const p of b.platforms)for(const s of p.snapshots)Object.assign(s,{freshness:'refresh_due',refreshState:'failed'});return b;}});await ttl.c.liveQuery();await settle();assert.equal(ttl.L.providerReadMode,'published');assert.equal(ttl.L.results.length,18);assert.equal(ttl.calls.filter(q=>q.action==='aggregatePrepared').length,0);assert.equal(ttl.L.providerPublished.bundle.freshness,'refresh_due');assert.match(ttl.html(),/更新未完成/);
});
