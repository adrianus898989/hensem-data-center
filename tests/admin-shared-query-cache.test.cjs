// Actual shared query/navigation code with synthetic IO. No production timings.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,aggregate,detail,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,aggregate,detail,P};')(require,__dirname);
const pages=['collection','payout','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms','orders'];
const requests=(h,action)=>h.calls.filter(q=>q.action===action);
function reply(q){
 if(q.action==='aggregate')return {...aggregate(P,65),startAt:q.startAt,endAt:q.endAt};
 if(q.action==='rates')return {rows:[],total:0};
 if(q.action==='providerOptions')return {providers:[]};
 if(q.action==='details')return detail(P,65,q.offset,q.limit);
 return {};
}
async function ready(page){
 const h=harness({roleAccess:{mode:'owner',canView:true,permissions:[]},roleAllowed:()=>true});await settle();
 h.c.setPage(page);await settle();assert.equal(h.c.state.page,page);
 h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';
 if(page==='orders'){h.L.platform=P.id;h.L.multi.platform=[P.id];}
 h.setHandler(reply);return h;
}
for(const page of pages)test(page+': ordinary repeat reuses complete aggregates and fees; explicit refresh rereads; details remain live',async()=>{
 const h=await ready(page);await h.c.liveQuery();await settle();
 const count=requests(h,'aggregate').length,feeCount=requests(h,'rates').length,detailCount=requests(h,'details').length,readAt=h.L.results[0]._aggregateReadAt;
 assert.equal(count,2,'current and comparison each read once');
 assert.match(h.nodes.get('liveFilters').innerHTML,/onclick="liveRefresh\(\)"/,'explicit refresh stays available');
 h.setNow('2026-09-23T12:00:10Z');await h.c.liveQuery();await settle();
 assert.equal(requests(h,'aggregate').length,count);assert.equal(requests(h,'rates').length,feeCount);
 assert.equal(h.L.results[0]._aggregateCacheHit,true);assert.equal(h.L.results[0]._aggregateReadAt,readAt);
 assert.equal(requests(h,'details').length,detailCount+(page==='orders'?1:0));
 assert.match(h.nodes.get('liveFilters').innerHTML,/数据读取[^]*缓存/);
 await h.c.liveRefresh();await settle();assert.equal(requests(h,'aggregate').length,count*2);
 assert.equal(requests(h,'rates').length,feeCount*2);assert.equal(h.L.results[0]._aggregateCacheHit,false);
 assert.equal(requests(h,'details').length,detailCount+(page==='orders'?2:0));
});
for(const page of pages)test(page+': current window stays frozen within 30 seconds then advances on expiry or explicit refresh',async()=>{
 const h=await ready(page);h.L.from='2026-09-23T00:00:00';h.L.to='2026-09-23T23:59:59';h.L.dirty=true;
 await h.c.liveQuery();await settle();const count=requests(h,'aggregate').length,queryNow=h.L.queryNow,end=h.L.results[0].endAt;
 h.setNow('2026-09-23T12:00:29Z');await h.c.liveQuery();await settle();
 assert.equal(requests(h,'aggregate').length,count);assert.equal(h.L.queryNow,queryNow);assert.equal(h.L.results[0].endAt,end);
 h.setNow('2026-09-23T12:00:30Z');await h.c.liveQuery();await settle();
 assert(requests(h,'aggregate').length>count);assert(h.L.queryNow>queryNow);assert(Date.parse(h.L.results[0].endAt)>Date.parse(end));
 const refreshedCount=requests(h,'aggregate').length,advanced=h.L.queryNow;
 h.setNow('2026-09-23T12:00:35Z');await h.c.liveRefresh();await settle();
 assert(requests(h,'aggregate').length>refreshedCount);assert(h.L.queryNow>advanced);assert.equal(h.L.results[0]._aggregateCacheHit,false);
});
test('new shared-cache pages keep changed filters, authority and native identities isolated',async()=>{
 const h=await ready('amount');await h.c.liveQuery();await settle();let before=requests(h,'aggregate').length;
 h.c.liveSet('provider','Synthetic different provider');await h.c.liveQuery();await settle();
 assert.equal(requests(h,'aggregate').length,before+2);assert(requests(h,'aggregate').slice(before).every(q=>q.providers?.[0]==='Synthetic different provider'));
 before=requests(h,'aggregate').length;h.c.hensemDataScope={mode:'selected',identity:'SYNTHETIC-NEW-SCOPE'};await h.c.liveQuery();await settle();assert.equal(requests(h,'aggregate').length,before+2);
 before=requests(h,'aggregate').length;h.L.catalog=[{...P,sourceName:'Synthetic different native'}];await h.c.liveQuery();await settle();assert.equal(requests(h,'aggregate').length,before+2);
 before=requests(h,'aggregate').length;h.c.hensemRoleAllowed=(page,action)=>action!=='query';await h.c.liveQuery();await settle();assert.equal(requests(h,'aggregate').length,before);assert.equal(h.L.results.length,0);assert(h.L.queryFailures.length);
 h.c.hensemRoleAllowed=()=>true;await h.c.liveQuery();await settle();assert.equal(requests(h,'aggregate').length,before+2,'permission rejection cleared former cache');
});
test('navigation cancels a shared-page query and ignores its late completion instead of caching it',async()=>{
 const h=await ready('time'),wait=deferred(),signals=[];h.c.hensemLiveRequest=(q,options={})=>{h.calls.push(q);if(q.action==='aggregate'){signals.push(options.signal);return wait.promise;}return Promise.resolve(reply(q));};
 const run=h.c.liveQuery();await settle();assert.equal(signals.length,1);h.c.setPage('amount');assert(signals.every(signal=>signal.aborted));
 wait.resolve(reply(requests(h,'aggregate')[0]));await run;await settle();assert.equal(h.c.state.page,'amount');assert.equal(h.L.results.length,0);
 h.c.hensemLiveRequest=async q=>{h.calls.push(q);return reply(q);};h.c.setPage('time');await h.c.liveQuery();await settle();assert.equal(requests(h,'aggregate').length,3,'cancelled current result never populated reusable cache');assert.equal(h.L.results[0]._aggregateCacheHit,false);
});
test('incomplete shared-page responses are reread instead of becoming complete cached statistics',async()=>{
 const h=await ready('risk');h.setHandler(q=>q.action==='aggregate'?{...reply(q),complete:false}:reply(q));await h.c.liveQuery();await settle();const count=requests(h,'aggregate').length;
 await h.c.liveQuery();await settle();assert.equal(requests(h,'aggregate').length,count*2);assert.equal(h.L.results[0]._aggregateCacheHit,false);
});
