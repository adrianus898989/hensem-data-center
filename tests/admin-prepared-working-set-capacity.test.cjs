// Capacity behavior, never a simulated production latency or heap measurement.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-prepared-aggregates.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,q,envelope,NOW}=new Function('require',prefix+';return{harness,q,envelope,NOW};')(require);
const native=id=>({id,source:'ar',sourceName:'SYNTHETIC-'+id,country:'印度',scopeGroup:'IN',timezone:'Asia/Kolkata',currency:'INR'});
function query(i,prior=false){const request=q({platformId:'native-'+i,direction:'charge',...(prior?{startAt:'2026-10-12T18:30:00.000001Z',endAt:'2026-10-13T18:30:00.000001Z'}:{})});delete request.providers;return request;}
function packed(payload,padding=350000,include=true,make=p=>envelope(p.requests),replaceNative=true){const out=make(payload);out.version=2;for(const item of out.items){if(replaceNative)item.result.platform=native(item.request.platformId);Object.assign(item.publication,{kind:'daily_provider_rollup',freshness:'refresh_due',refreshState:'idle'});item.result.provenance='x'.repeat(padding);const first=item.result.groups.provider[0],other={...first,provider:'TukPay',all_amount:'0.000000000000000000019',success_amount:null},scope={...item.request};delete scope.providers;
 const base={...item.result};delete base.groups;delete base.summary;delete base.total;
 if(include)item.providerReuse={version:1,scope,base,providers:[first,other],names:[['3TPay',0],['TukPay',1]],entries:[{indices:[0],result:{summary:[first],total:2}},{indices:[1],result:{summary:[other],total:2}},{indices:[0,1],result:{summary:[first],total:2}}],all:2};
 }return out;}
const cached=(options={})=>harness({publicationVersion:2,platform:native,maxBatchSize:3,maxConcurrent:2,completedCacheTtlMs:()=>300000,handler:p=>packed(p),...options});
async function loadTwoWindows(h,count=18){for(const previous of[false,true])await Promise.all(Array.from({length:count},(_,i)=>h.adapter.read(query(i,previous))));}
test('one configured Map retains18 current plus18 comparison admitted envelopes and first unseen provider needs no RPC',async()=>{
 const h=cached({completedCacheMaxBytes:96*1024*1024});await loadTwoWindows(h);assert.equal(h.calls.length,12);const first=h.calls.length;
 for(const previous of[false,true]){const result=await Promise.all(Array.from({length:18},(_,i)=>h.adapter.read({...query(i,previous),providers:['TukPay']})));assert(result.every(r=>r.summary[0].all_amount==='0.000000000000000000019'&&r.summary[0].success_amount===null&&r._preparedPublication.sourceComplete===false));}assert.equal(h.calls.length,first);
});
test('default callers retain the original16MiB policy and evict an older window normally',async()=>{
 const h=cached();await loadTwoWindows(h);const before=h.calls.length;await h.adapter.read({...query(0),providers:['TukPay']});assert.equal(h.calls.length,before+1);
});
test('oversized configured capacity is clamped to96MiB and still evicts before the128-item limit',async()=>{
 const h=cached({completedCacheMaxBytes:1024*1024*1024});await Promise.all(Array.from({length:80},(_,i)=>h.adapter.read(query(i))));const before=h.calls.length;await h.adapter.read(query(79));assert.equal(h.calls.length,before);await h.adapter.read(query(0));assert.equal(h.calls.length,before+1);
});
test('the2MiB per-entry optional stripping rule and absent or unknown provider fallbacks remain unchanged',async()=>{
 for(const mode of['large','absent','unknown']){const h=cached({completedCacheMaxBytes:96*1024*1024,handler:p=>packed(p,mode==='large'?600000:1000,mode!=='absent')});await h.adapter.read(query(0));const before=h.calls.length;await h.adapter.read(query(0));assert.equal(h.calls.length,before);await h.adapter.read({...query(0),providers:[mode==='unknown'?'UnresolvedPay':'TukPay']});assert.equal(h.calls.length,before+1);}
});

// The host must opt in; changing only the default manager would hide a wiring bug.
test('actual host explicitly retains its18+18 large envelopes for the first unseen provider',async()=>{
 const uiPrefix=fs.readFileSync(path.join(__dirname,'admin-provider-historical-routing.test.cjs'),'utf8').split(/\ntest\(/)[0];
 const {fixture,prepared}=new Function('require','__dirname',uiPrefix+';return{fixture,prepared};')(require,__dirname);
 const h=await fixture({handler:p=>p.action==='aggregatePrepared'?packed(p,350000,true,prepared,false):undefined});h.setNow('2026-10-18T12:00:00Z');
 for(const[k,v]of Object.entries({from:'2026-10-11T00:00:00',to:'2026-10-17T23:59:59',successFrom:'2026-10-11T00:00:00',successTo:'2026-10-17T23:59:59'}))h.c.liveMetricTimeSet(k,v);
 h.c.liveProvider('');await h.c.liveQuery();const count=()=>h.calls.filter(p=>p.action==='aggregatePrepared').length;assert.equal(count(),12);assert.equal(h.L.results.length,18);assert.equal(h.L.comparisonResults.length,18);
 h.c.liveProvider('TukPay');await h.c.liveQuery();assert.equal(count(),12);assert.equal(h.L.results.length,18);assert.equal(h.L.comparisonResults.length,18);assert(h.L.results.every(r=>r.summary[0].all_amount==='0.000000000000000000019'&&r.summary[0].success_amount===null));
});
