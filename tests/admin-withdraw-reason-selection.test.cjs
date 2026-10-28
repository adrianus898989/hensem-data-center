// Offline synthetic data only. No network or production identities.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const base=path.resolve(__dirname,'..');
function fixtureLoader(name,split,exports,extra=''){
 const filename=path.join(base,'tests/'+name+'.test.cjs'),module={exports:{}};
 const text=fs.readFileSync(filename,'utf8'),prefix=text.split(split)[0];
 vm.runInNewContext(prefix+'\n'+extra+'\nmodule.exports={'+exports+'};',{module,require:require('node:module').createRequire(filename),__dirname:path.dirname(filename),setImmediate,AbortController,URL},{filename});
 return module.exports;
}
const drawer=fixtureLoader('admin-withdraw-reason-lifecycle',"\ntest('same exact",'fixture,response,settle');
const bridgeText=fs.readFileSync(path.join(base,'tests/admin-live-bridge.test.cjs'),'utf8');
const iframeFn=bridgeText.slice(bridgeText.indexOf('function iframeHarness(){'),bridgeText.indexOf("\ntest('iframe cancellation"));
const host=fixtureLoader('admin-live-bridge',"\ntest('request validation",'load,session,query,bridge,flush,iframeHarness',iframeFn);
const key='a'.repeat(32),marker='WITHDRAW_REASON_SELECTION_CHANGED';
const atomic=()=>drawer.response('无可用提现通道',{reasonGrouping:'atomic_rules_v1',summary:{ruleMembership:{unit:'distinct_order_per_rule',overlapping:true,hitCount:1}},canViewBlockingOrders:true,noteCount:1,rows:[{reason:'无可用提现通道',reasonKey:key,count:1}]});
const changed=()=>Object.assign(Error('SAFE-STANDARD-MESSAGE'),{code:marker});
async function openDrill(h,kind='blockingVariants'){h.open();h.reply(h.calls.length-1,atomic());await drawer.settle();h.ctx.withdrawBlockingDrill(0,kind);return h.calls.length-1;}
const selectionQuery={action:'withdrawReasons',date:'2026-10-27',country:'印度',platform:'EXAMPLE',kind:'blockingVariants',reasonKey:key};

test('strict HTTP SQLSTATE selection identity crosses owner/assigned host and iframe; no automatic retry',async()=>{
 for(const assigned of [false,true])for(const kind of ['blockingVariants','blockingOrders']){
  const h=host.load({fetch:async()=>({ok:false,status:400,json:async()=>({code:'22023',message:'withdraw_reason_selection_changed',details:'PRIVATE_SENTINEL'})})});
  const b=host.bridge(h,assigned?{roleAccess:()=>({mode:'assigned',canView:true,permissions:['auto_withdraw.view','auto_withdraw.query']})}:{});
  const request={...selectionQuery,kind},event=b.event('selection',request);event.data.page='auto_withdraw';h.send(event);await host.flush();
  assert.equal(b.replies.length,1);const reply=b.replies[0].data;assert.equal(reply.code,marker);assert.equal(reply.error,'原因分类已更新，请返回原因列表重新选择。');assert.equal(h.calls.length,1);assert.doesNotMatch(JSON.stringify(reply),/PRIVATE_|details|22023/);
  const frame=host.iframeHarness(),pending=frame.ctx.hensemLiveRequest(request),rejected=assert.rejects(pending,e=>e.code===marker);
  frame.reply(frame.messages[0].data,{error:reply.error,code:reply.code});await rejected;assert.equal(frame.timers.size,0);b.cleanup();
 }
});
test('near matches and non-detail reads stay errors; authorization always takes precedence',async()=>{
 for(const spec of [
  {status:500,code:'22023',message:'withdraw_reason_selection_changed'},
  {status:400,code:'XX000',message:'withdraw_reason_selection_changed'},
  {status:400,code:'22023',message:'withdraw_reason_selection_changed PRIVATE_SENTINEL'},
  {status:400,code:'22023',message:'withdraw_reason_selection_changed',request:{...selectionQuery,kind:'blocking',reasonKey:undefined}},
  {status:400,code:'22023',message:'withdraw_reason_selection_changed',request:host.query},
  {status:403,code:'22023',message:'withdraw_reason_selection_changed'},
  {status:401,code:'22023',message:'withdraw_reason_selection_changed'}]){
   const h=host.load({fetch:async()=>({ok:false,status:spec.status,json:async()=>({code:spec.code,message:spec.message,details:'PRIVATE_SENTINEL'})})});
   await assert.rejects(h.api.adminLiveRequest(host.session,spec.request||selectionQuery),e=>e.code!==marker&&!/PRIVATE_|withdraw_reason_selection_changed/.test(e.message));
 }
});
test('retired key shows actionable neutral status and returns to exact platform/day without replacing main table',async()=>{
 for(const page of ['auto_withdraw','withdraw_operators'])for(const kind of ['blockingVariants','blockingOrders']){
  const h=drawer.fixture();h.setPage(page);const main=h.api.state.data,window=JSON.stringify(h.L),idx=await openDrill(h,kind);const original={...h.calls[idx].q};
  h.calls[idx].reject(changed());await drawer.settle();assert.equal(h.calls.length,2);assert.equal(h.api.state.reasonSelectionChanged,true);
  assert.match(h.html(),/原因分类已更新/);assert.match(h.html(),/withdrawReasonReturnToList/);assert.doesNotMatch(h.html(),/live-status live-error/);assert.equal(h.api.state.data,main);assert.equal(JSON.stringify(h.L),window);
  const pending=h.ctx.withdrawReasonReturnToList();h.ctx.withdrawReasonReturnToList();assert.equal(h.calls.length,3);const q=h.calls[2].q;
  assert.equal(q.kind,'blocking');for(const field of ['country','platform','date'])assert.equal(q[field],original[field]);assert.equal(q.reasonKey,undefined);assert.equal(q.query,undefined);assert.equal(q.offset,0);assert.equal(h.api.state.reasonSelectionChanged,false);
  h.reply(2,atomic());await pending;assert.equal(h.api.state.data,main);assert.equal(JSON.stringify(h.L),window);assert.equal(h.api.state.reasonData.coverage.complete,false);
 }
});
test('retry uses recoverable list instead of looping old key; ordinary failure remains retryable and never becomes zero',async()=>{
 const h=drawer.fixture(),idx=await openDrill(h);h.calls[idx].reject(changed());await drawer.settle();const pending=h.ctx.withdrawReasonRetry();assert.equal(h.calls.at(-1).q.kind,'blocking');assert.equal(h.calls.at(-1).q.reasonKey,undefined);h.reply(2,atomic());await pending;
 const other=drawer.fixture(),j=await openDrill(other);other.calls[j].reject(Object.assign(Error('网络读取失败'),{code:'ADMIN_LIVE_NETWORK'}));await drawer.settle();
 assert.equal(other.api.state.reasonSelectionChanged,false);assert.equal(other.api.state.reasonData,null);assert.match(other.html(),/live-status live-error/);assert.match(other.html(),/withdrawReasonRetry/);assert.doesNotMatch(other.html(),/返回原因列表/);
});
test('late selection failures after cancellation, changed identity/native/date/page/window never affect replacement',async()=>{
 for(const drift of [
  h=>h.ctx.withdrawReasonClose(),h=>h.api.pause(),h=>h.ctx.withdrawReasons(1),h=>h.ctx.withdrawReasonDate('2026-10-10'),
  h=>h.ctx.hensemDataScope={identity:'other'},h=>h.L.catalog[0].id='other-native',h=>h.setPage('withdraw_operators'),h=>h.L.successTo='2026-10-12T23:59:59',
  h=>h.ctx.hensemRoleAllowed=()=>false]){
  const h=drawer.fixture(),idx=await openDrill(h);drift(h);h.calls[idx].reject(changed());await drawer.settle();assert.notEqual(h.api.state.reasonSelectionChanged,true);assert.doesNotMatch(h.html(),/原因分类已更新/);
 }
});
test('selection cache eviction keeps another platform and its source uncertainty',async()=>{
 const h=drawer.fixture();h.ctx.withdrawReasons(1);h.reply(0,atomic());await drawer.settle();h.ctx.withdrawReasonClose();
 const idx=await openDrill(h);h.calls[idx].reject(changed());await drawer.settle();const calls=h.calls.length;h.ctx.withdrawReasonClose();h.ctx.withdrawReasons(1);assert.equal(h.calls.length,calls);assert.equal(h.api.state.reasonData.coverage.complete,false);
 h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,calls+1,'same-platform old list was retired, not reused');
});
test('current authority denial still clears all data instead of offering selection recovery',async()=>{
 const h=drawer.fixture(),idx=await openDrill(h);h.calls[idx].reject(Object.assign(Error('role_permission_denied'),{code:'42501'}));await drawer.settle();assert.equal(h.api.state.data,null);assert.equal(h.api.state.reasonSelectionChanged,false);
});
