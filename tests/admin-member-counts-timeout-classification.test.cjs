// Synthetic count responses only: an uncertain transport outcome is not a
// database statement-limit response and must not fan out into more reads.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-member-counts-cache.test.cjs'),'utf8').split(/\ntest\(/)[0];
const{harness,platform,response,row,A,B}=new Function('require',prefix+';return {harness,platform,response,row,A,B};')(require);
const unknowns=[
 ['host deadline',()=>Object.assign(Error('读取超时，请重试'),{code:'ADMIN_LIVE_TIMEOUT'})],
 ['HTTP 504 / timeout text',()=>Object.assign(Error('57014 statement timeout'),{code:'ADMIN_LIVE_TIMEOUT'})],
 ['uncoded timeout',()=>Error('Synthetic timed out')],
 ['uncoded Chinese timeout',()=>Error('读取超时')],
 ['SQLSTATE in text only',()=>Error('57014 query timeout')],
 ['numeric SQLSTATE',()=>Object.assign(Error('query timeout'),{code:57014})],
 ['SQLSTATE prefix',()=>Object.assign(Error('query timeout'),{code:'57014_suffix'})],
 ['denied with timeout-like text',()=>Object.assign(Error('57014 timeout'),{code:'ADMIN_LIVE_PERMISSION_DENIED'})],
];
for(const [label,error]of unknowns)for(const shape of ['one-day all','one-day charge','multi-day all'])test(label+' / '+shape+': exact failed platform is not automatically replayed or split',async()=>{
 const h=harness();if(shape==='one-day charge')h.L.direction='charge';if(shape==='multi-day all')h.L.to='2026-10-10T23:59:59';h.handler(()=>{throw error()});await h.query();
 assert.equal(h.calls.length,1);assert.equal(h.ui.state.results.length,0);assert.equal(h.ui.state.status,'error');assert.equal(h.ui.state.failures.length,1);assert.match(h.ui.metric('charge'),/— \/ —/);assert.doesNotMatch(h.ui.state.failures[0].error,/重试失败/);
 await h.ui.ensure();assert.equal(h.calls.length,1,'render cannot retry an uncertain timeout');
});

test('43-platform cohort keeps 42 complete results when one transport deadline expires; explicit query retries only that gap',async()=>{
 const h=harness(),peers=Array.from({length:42},(_,i)=>platform((0x30000000+i).toString(16)+'-0000-4000-8000-'+String(i).padStart(12,'0')));h.select([platform(),...peers]);let failing=true;
 h.handler(q=>{if(q.platformId===A&&failing)throw Object.assign(Error('读取超时'),{code:'ADMIN_LIVE_TIMEOUT'});return response(q)});await h.query();
 assert.equal(h.calls.length,43);assert.equal(h.calls.filter(q=>q.platformId===A).length,1);assert.equal(h.ui.state.results.length,42);assert.equal(h.ui.state.failures.length,1);assert.equal(h.ui.state.status,'ready');assert.match(h.ui.metric('charge'),/读取 42 \/ 43 平台.*部分数据/);assert.match(h.ui.metric('charge'),/已知人数/);assert(h.ui.state.results.every(r=>r.sourceCompletenessVerified===false));
 await h.ui.ensure();assert.equal(h.calls.length,43);failing=false;await h.query();assert.equal(h.calls.length,44);assert.equal(h.calls.at(-1).platformId,A);assert.equal(h.ui.state.results.length,43);assert.equal(h.ui.state.failures.length,0);
});

test('trusted 57014 retains serial exact directions and the creation-state basis, provider union and native currency',async()=>{
 const h=harness();h.extra({successBasis:'created'});h.L.multi.provider=['B Pay','A Pay','B Pay'];h.handler(q=>{if(q.direction==='all')throw Object.assign(Error('database statement limit'),{code:'57014'});const r=response(q);r.successBasis='created';r.capabilities.successBasis='created_at_current_stored_status';r.capabilities.successCohort='created_at_current_stored_status';r.capabilities.independentSuccessWindow=false;return r;});await h.query();
 assert.deepEqual(h.calls.map(q=>q.direction),['all','charge','withdraw']);assert(h.calls.every(q=>q.successBasis==='created'&&q.startAt===h.calls[0].startAt&&q.endAt===h.calls[0].endAt&&q.currency==='INR'));assert(h.calls.every(q=>JSON.stringify(q.providers)===JSON.stringify(['A Pay','B Pay'])));assert.equal(h.ui.state.results.length,1);assert.equal(h.ui.state.failures.length,0);assert.equal(h.ui.state.results[0].sourceCompletenessVerified,false);await h.query();assert.equal(h.calls.length,3,'complete exact direction result remains cached');
});

test('a transport failure during trusted direction fallback ends that platform, retains peers and is not recursively retried',async()=>{
 const h=harness();h.select([platform(),platform(B)]);h.handler(q=>{if(q.platformId===A){if(q.direction==='all')throw Object.assign(Error('database statement limit'),{code:'57014'});throw Object.assign(Error('读取超时'),{code:'ADMIN_LIVE_TIMEOUT'});}return response(q)});await h.query();
 assert.deepEqual(h.calls.filter(q=>q.platformId===A).map(q=>q.direction),['all','charge']);assert.equal(h.ui.state.results.length,1);assert.equal(h.ui.state.results[0].platform.id,B);assert.match(h.ui.state.failures[0].error,/0\/2 方向已读取/);assert.match(h.ui.metric('charge'),/部分数据/);await h.ui.ensure();assert.equal(h.calls.length,3);
});
