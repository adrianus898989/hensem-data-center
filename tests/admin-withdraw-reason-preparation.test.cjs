// Synthetic behavior only; no production rows or measured network timings.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fixtureFile=path.join(__dirname,'admin-withdraw-reason-lifecycle.test.cjs'),moduleScope={exports:{}};
vm.runInNewContext(fs.readFileSync(fixtureFile,'utf8').split('\ntest(')[0]+'\nmodule.exports={fixture,response,settle};',{module:moduleScope,require:require('node:module').createRequire(fixtureFile),__dirname,setImmediate,AbortController,URL},{filename:fixtureFile});
const {fixture,response,settle}=moduleScope.exports;
const preparing=(patch={})=>({available:false,rows:null,total:null,summary:null,prepared:{contract:'withdraw-reasons-blocking-v1',status:'building',reason:'withdraw_reasons_preparing'},...patch});
function load(){
 const timers=new Map();let id=0;
 const h=fixture({prepare:ctx=>Object.assign(ctx,{setTimeout:(fn,ms)=>{const token=++id;timers.set(token,{fn,ms});return token;},clearTimeout:token=>timers.delete(token)})});
 return Object.assign(h,{timers,tick:async ms=>{h.advance(ms);for(const [token,t]of [...timers]){t.ms-=ms;if(t.ms<=0){timers.delete(token);t.fn();}}await settle();}});
}
test('only explicit preparation polls serially and stores the eventual original result with source uncertainty',async()=>{
 const h=load();h.open();h.reply(0,preparing());await settle();assert.equal(h.calls.length,1);assert.equal(h.api.state.reasonData,null);assert.equal(h.api.state.reasonBusy,true);
 h.open();assert.equal(h.calls.length,1);await h.tick(1500);assert.equal(h.calls.length,2);assert.equal(h.calls[0].options.signal,h.calls[1].options.signal);
 h.reply(1,response('prepared'));await settle();assert.equal(h.api.state.reasonData.rows[0].reason,'prepared');assert.equal(h.api.state.reasonData.coverage.complete,false);assert.equal(h.timers.size,0);
 h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,2);
});
test('close and date/platform/navigation changes cancel polling and cannot install a late old result',async()=>{
 for(const stop of [h=>h.ctx.withdrawReasonClose(),h=>h.ctx.withdrawReasonDate('2026-10-10'),h=>h.ctx.withdrawReasons(1),h=>h.api.pause(),h=>h.api.restore(null),h=>h.events.get('pagehide')?.()]){
  const h=load();h.open();h.reply(0,preparing());await settle();await h.tick(1500);assert.equal(h.calls.length,2);stop(h);assert.equal(h.calls[0].options.signal.aborted,true);h.reply(1,response('obsolete'));await settle();assert.notEqual(h.api.state.reasonData?.rows?.[0]?.reason,'obsolete');assert.equal(h.timers.size,0);
 }
});
test('actor, permission and independent-window drift stop a pending preparation before another transport',async()=>{
 for(const drift of [h=>h.ctx.hensemDataScope={identity:'different'},h=>h.ctx.hensemRoleAllowed=()=>false,h=>h.L.successFrom='2026-10-10T00:00:00']){
  const h=load();h.open();h.reply(0,preparing());await settle();drift(h);await h.tick(1500);assert.equal(h.calls.length,1);assert.equal(h.api.state.reasonData,null);assert.equal(h.api.state.reasonBusy,false);assert.equal(h.timers.size,0);
 }
});
test('failed or malformed preparation is visible as an error and is never retried or cached as empty statistics',async()=>{
 for(const data of [preparing({prepared:{contract:'withdraw-reasons-blocking-v1',status:'failed'}}),preparing({rows:[]}),preparing({total:0}),preparing({available:true}),preparing({prepared:{contract:'withdraw-reasons-blocking-v1',status:'building',reason:'unknown'}})]){
  const h=load();h.open();h.reply(0,data);await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);assert.equal(h.api.state.reasonData,null);assert.match(h.api.state.reasonError,/原因统计/);h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,2);
 }
});
test('preparation deadline aborts an active poll and ignores its late result',async()=>{
 const h=load();h.open();h.reply(0,preparing());await settle();await h.tick(1500);assert.equal(h.calls.length,2);await h.tick(58500);assert.equal(h.calls[1].options.signal.aborted,true);assert.equal(h.timers.size,0);assert.equal(h.api.state.reasonBusy,false);assert.equal(h.api.state.reasonData,null);assert.match(h.api.state.reasonError,/仍在后台更新/);h.reply(1,response('too late'));await settle();assert.equal(h.api.state.reasonData,null);
});
test('forced retry replaces a preparation and authority denial on its poll clears prior data',async()=>{
 const h=load();h.open();h.reply(0,preparing());await settle();const forced=h.ctx.withdrawReasonRetry();assert.equal(h.calls.length,2);assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.timers.size,0);h.ctx.withdrawReasonRetry();assert.equal(h.calls.length,2);
 h.reply(1,preparing());await settle();await h.tick(1500);assert.equal(h.calls.length,3);h.calls[2].reject(Object.assign(Error('role_permission_denied'),{code:'42501'}));await forced;assert.equal(h.api.state.data,null);assert.equal(h.api.state.reasonData,null);assert.equal(h.timers.size,0);assert.equal(h.calls[2].options.signal.aborted,true);
});
test('forty requests is a hard limit even if clocks do not advance',async()=>{
 const h=load();h.open();for(let n=0;n<40;n++){assert.equal(h.calls.length,n+1);h.reply(n,preparing());await settle();if(n<39){const entry=[...h.timers].find(([,t])=>t.ms===1500);assert(entry);h.timers.delete(entry[0]);entry[1].fn();await settle();}}
 assert.equal(h.calls.length,40);assert.equal(h.timers.size,0);assert.equal(h.api.state.reasonData,null);assert.match(h.api.state.reasonError,/仍在后台更新/);
});

const lastComplete=(patch={},publication={})=>response('previous complete',{
 updatedAt:'2026-10-17T12:00:00.123456+05:30',summary:{operatorCounts:{manual:1,manualWithReason:1}},
 publication:{contract:'withdraw-reasons-last-complete-v1',status:'ready',servedLastComplete:true,freshness:'refresh_due',computedAt:'2026-10-17T06:31:00.123456Z',updatedAt:'2026-10-17T12:00:00.123456+05:30',refreshState:'queued',...publication},...patch
});
test('last-complete immediately shows original statistics and timestamps without preparation polling',async()=>{
 for(const refreshState of ['queued','running','failed']){
  const h=load(),data=lastComplete({}, {refreshState,...(refreshState==='failed'?{refreshError:'compute_failed'}:{})});
  h.open();h.reply(0,data);await settle();
  assert.equal(h.api.state.reasonBusy,false);assert.equal(h.api.state.reasonData,data);assert.equal(h.api.state.reasonData.coverage.complete,false);
  assert.equal(h.timers.size,0);assert.equal(h.calls.length,1);assert.match(h.html(),/data-withdraw-reason-publication="last-complete"/);
  assert.match(h.html(),refreshState==='failed'?/更新失败/:/更新中/);assert.match(h.html(),/上次完整统计/);
  assert(h.html().includes(data.updatedAt.replace('T',' ')));assert.equal(h.api.state.reasonData.publication.computedAt,data.publication.computedAt);
 }
 const h=load();h.open();h.reply(0,lastComplete({updatedAt:null},{updatedAt:null}));await settle();assert.match(h.html(),/统计时间 2026-10-17 06:31:00.123456Z/);assert.doesNotMatch(h.html(),/数据时间/);assert.equal(h.api.state.reasonData.updatedAt,null);
});
test('last-complete never populates the exact reason cache or the complete local pagination snapshot',async()=>{
 const h=load();h.open();h.reply(0,lastComplete());await settle();
 h.ctx.withdrawReasonSize(50);assert.equal(h.calls.length,2);assert.equal(h.calls[1].q.limit,50);h.reply(1,lastComplete());await settle();
 h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,3);h.reply(2,response('current'));await settle();
 h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,3);assert.equal(h.api.state.reasonData.rows[0].reason,'current');assert.doesNotMatch(h.html(),/data-withdraw-reason-publication/);
});
test('invalid last-complete envelopes fail closed without caching, polling or replacing source uncertainty',async()=>{
 const invalid=[
  lastComplete({}, {contract:'unknown'}),lastComplete({}, {status:'building'}),lastComplete({}, {servedLastComplete:false}),
  lastComplete({}, {freshness:'fresh'}),lastComplete({}, {computedAt:'2026-02-30T00:00:00Z'}),lastComplete({}, {computedAt:'not-a-date'}),
  lastComplete({}, {updatedAt:'2026-10-18T00:00:00Z'}),lastComplete({}, {refreshState:'idle'}),lastComplete({}, {refreshError:'unsafe error text'}),
  lastComplete({}, {unknown:true}),lastComplete({prepared:preparing().prepared}),lastComplete({available:false}),lastComplete({summary:null}),
  lastComplete({coverage:null}),lastComplete({rows:[null]}),lastComplete({total:'1'}),lastComplete({partial:true}),lastComplete({complete:false}),
  lastComplete({error:'source failure'}),lastComplete({publication:null})
 ];
 for(const data of invalid){
  const h=load();h.open();h.reply(0,data);await settle();assert.equal(h.api.state.reasonData,null);assert.equal(h.timers.size,0);assert.match(h.api.state.reasonError,/旧结果信息无效/);
  assert.doesNotMatch(h.html(),/data-withdraw-reason-publication/);h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,2);
 }
});
test('cancelled or obsolete actor, native and window reads cannot display or cache last-complete results',async()=>{
 for(const stop of [h=>h.ctx.withdrawReasonClose(),h=>h.api.pause(),h=>h.ctx.hensemDataScope={identity:'other'},h=>h.L.catalog[0].source='newar',h=>h.L.successTo='2026-10-12T23:59:59']){
  const h=load();h.open();stop(h);h.reply(0,lastComplete());await settle();assert.equal(h.api.state.reasonData,null);assert.doesNotMatch(h.html(),/data-withdraw-reason-publication/);
  h.ctx.withdrawReasonClose();if(h.api.state.data){h.open();assert.equal(h.calls.length,2);}else assert.equal(h.calls.length,1); // Scope drift requires a fresh main query before reopening.
 }
});
test('a preparation can finish with a last-complete result, stop polling and retain the original time',async()=>{
 const h=load();h.open();h.reply(0,preparing());await settle();await h.tick(1500);assert.equal(h.calls.length,2);
 const data=lastComplete();h.reply(1,data);await settle();assert.equal(h.api.state.reasonData,data);assert.equal(h.timers.size,0);assert.equal(h.api.state.reasonBusy,false);
 h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,3);
});
test('restored invalid publication cannot render ordinary complete counts',async()=>{
 const h=load();h.open();h.reply(0,lastComplete());await settle();const saved=h.api.capture();
 saved.reasonData={...saved.reasonData,publication:{...saved.reasonData.publication,computedAt:'invalid'}};h.api.restore(saved);h.ctx.withdrawReasonOriginalClose();
 assert.match(h.html(),/旧结果信息无效/);assert.doesNotMatch(h.html(),/withdraw-reason-summary|data-withdraw-reason-publication/);
});
