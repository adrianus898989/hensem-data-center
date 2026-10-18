// Synthetic member counts only; exercise the real module and existing cache harness.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-member-counts-cache.test.cjs'),'utf8').split(/\ntest\(/)[0];
const{harness,platform,response,row,deferred,settle,A,B}=new Function('require',prefix+';return {harness,platform,response,row,deferred,settle,A,B};')(require);
const{requestFor}=require('../admin-preview/live-member-counts.js');
const timeout=()=>Object.assign(Error('Synthetic statement timeout'),{code:'57014'});
const days=q=>requestFor(platform(q.platformId),()=>q).days;
const dailyResponse=q=>response(q,platform(q.platformId),{rows:days(q).flatMap(date=>(q.direction==='all'?['charge','withdraw']:[q.direction]).map(direction=>row(date,direction)))});
function multi(){const h=harness();h.L.to='2026-10-10T23:59:59';h.L.multi.provider=['Synthetic B Pay','Synthetic A Pay'];return h;}
const middle='2026-10-08T18:30:00.000Z';
test('a failed daily fallback ends this platform without repeating the original window or publishing partial counts',async()=>{
 const h=multi();h.handler(q=>{if(days(q).length>1||q.startAt===middle)throw timeout();return dailyResponse(q);});await h.query();
 assert.equal(h.calls.length,3);assert.equal(h.calls.filter(q=>days(q).length>1).length,1);assert.equal(h.ui.state.results.length,0);assert.equal(h.ui.state.failures.length,1);assert.match(h.ui.state.failures[0].error,/1\/3 天已读取，平台未计入合计/);assert.match(h.ui.metric('charge'),/— \/ —/);assert(h.calls.every(q=>JSON.stringify(q.providers)===JSON.stringify(['Synthetic A Pay','Synthetic B Pay'])));
 await h.ui.ensure();assert.equal(h.calls.length,3,'render does not restart a failed fallback');
});
test('explicit query reuses verified days while explicit force invalidates them and preserves one-wide-read bound',async()=>{
 const h=multi();let failed=true;h.handler(q=>{if(days(q).length>1||failed&&q.startAt===middle)throw timeout();return dailyResponse(q);});await h.query();failed=false;
 let start=h.calls.length;await h.query();assert.equal(h.calls.length-start,3);assert.equal(h.calls.slice(start).filter(q=>days(q).length>1).length,1);assert(!h.calls.slice(start).some(q=>days(q).length===1&&q.startAt==='2026-10-07T18:30:00.000Z'),'the verified first day is reused');assert.equal(h.ui.state.results.length,1);assert.match(h.ui.metric('charge'),/36 \/ 27/);
 start=h.calls.length;await h.query(true);assert.equal(h.calls.length-start,4);assert.equal(h.calls.slice(start).filter(q=>days(q).length>1).length,1);assert.equal(h.ui.state.results[0]._memberCacheHit,false);assert.match(h.ui.metric('charge'),/36 \/ 27/);
});
test('equivalent creation and success clocks share the failed fallback instead of retrying it as a second axis',async()=>{
 const h=multi();h.extra({successStartAt:'2026-10-08T00:00:00+05:30',successEndAt:'2026-10-11T00:00:00+05:30',successBasis:'success'});h.handler(q=>{if(days(q).length>1||q.startAt===middle)throw timeout();return dailyResponse(q);});await h.query();assert.equal(h.calls.length,3);assert.equal(h.calls.filter(q=>days(q).length>1).length,1);assert.equal(h.ui.state.results.length,0);assert.match(h.ui.metric('charge'),/— \/ —/);
});
test('a failed multi-day creation axis preserves an independently successful exact success axis',async()=>{
 const h=multi(),success='2026-10-10T18:30:00.000Z';h.extra({successStartAt:success,successEndAt:'2026-10-11T18:30:00.000Z',successBasis:'success'});h.handler(q=>{if(days(q).length>1||q.startAt===middle)throw timeout();return dailyResponse(q);});await h.query();assert.equal(h.calls.length,4);assert.equal(h.calls.filter(q=>days(q).length>1).length,1);assert.equal(h.calls.filter(q=>q.startAt===success).length,1);assert.equal(h.ui.state.results.length,1);assert.equal(h.ui.state.failures.length,1);assert.match(h.ui.metric('charge'),/— \/ 9/);assert.equal(h.ui.state.results[0].rows.find(r=>r.date==='2026-10-11').created_in_window,false);
 const start=h.calls.length;await h.query();assert.equal(h.calls.length-start,2,'only the original failed axis and failed day reread; ready success and first day remain cached');assert.equal(h.calls.slice(start).filter(q=>q.startAt===success).length,0);assert.match(h.ui.metric('charge'),/— \/ 9/);
});
test('cancel during a fallback day rejects its late response and never queues a later day or original-window retry',async()=>{
 const h=multi(),late=deferred();h.handler(q=>{if(days(q).length>1)throw timeout();return q.startAt===middle?late.promise:dailyResponse(q);});const run=h.query();await settle();assert.equal(h.calls.length,3);const request=h.calls.at(-1);h.ui.cancel();late.resolve(dailyResponse(request));await run;assert.equal(h.calls.length,3);assert.equal(h.ui.state.status,'paused');assert.equal(h.ui.state.results.length,0);
 h.handler(q=>{if(days(q).length>1)throw timeout();return dailyResponse(q);});const start=h.calls.length;await h.query();assert.equal(h.calls.length-start,3);assert(h.calls.slice(start).some(q=>q.startAt===middle),'the cancelled day never fills its cache');assert.equal(h.ui.state.results.length,1);
});
test('fallback permission denial clears existing exact caches and is never followed by an automatic wide retry',async()=>{
 const h=multi();h.select([platform(B)]);h.handler(dailyResponse);await h.query();assert.equal(h.calls.length,1);h.select([platform()]);h.handler(q=>{if(days(q).length>1)throw timeout();if(q.startAt===middle)throw Object.assign(Error('Synthetic permission denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});return dailyResponse(q);});const start=h.calls.length;await h.query();assert.equal(h.calls.length-start,3);assert.equal(h.ui.state.results.length,0);h.select([platform(B)]);h.handler(dailyResponse);const n=h.calls.length;await h.query();assert.equal(h.calls.length,n+1,'a permission denial removes prior completed scopes');
});
