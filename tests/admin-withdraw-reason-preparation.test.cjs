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
