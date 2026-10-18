// Offline behavior only. Every identity, response and account is synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const response=(label='current',patch={})=>({available:true,source:'SYNTHETIC',total:1,rows:[{reason:label,count:1}],coverage:{complete:false},...patch});
function fixture(options={}){
 let now=1000,pageName='auto_withdraw',html='';const calls=[],events=new Map(),host={querySelector:()=>null};Object.defineProperty(host,'innerHTML',{get:()=>html,set:value=>html=value});
 const ctx={AbortController,Intl,Date:class extends Date{static now(){return now;}},document:{getElementById:id=>id==='withdraw-reason-overlay'?host:null,querySelector:()=>null},HensemLiveFilters:{multi:()=>''},addEventListener:(name,fn)=>events.set(name,fn)};ctx.window=ctx;vm.createContext(ctx);options.prepare?.(ctx,events);vm.runInContext(source,ctx);
 const L={catalogReady:true,catalog:[{id:'synthetic-native',source:'ar',country:'巴西',name:'SYNTHETIC'}],country:'巴西',from:'2026-10-11T00:00:00',to:'2026-10-11T23:59:59',successFrom:'2026-10-11T00:00:00',successTo:'2026-10-11T23:59:59',successBasis:'success'};
 const api=ctx.HensemLiveWithdrawPages.create({L,E:String,C:String,N:String,R:String,box:(_t,x)=>x,table:()=>'',page:()=>pageName,render:()=>{},request:(q,o)=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({q,options:o,resolve,reject});return options.request?options.request(q,o):promise;}});
 api.state.data={rows:[{country:'巴西',platform:'SYNTHETIC'},{country:'巴西',platform:'OTHER'}],totals:{},notes:[]};
 return {ctx,L,api,calls,events,html:()=>html,setPage:p=>pageName=p,advance:ms=>now+=ms,open:()=>ctx.withdrawReasons(0),reply:(index=0,data=response())=>calls[index].resolve(data)};
}
test('same exact open and pending force retry share one transport, while normal→force aborts the old read',async()=>{
 const h=fixture();h.open();h.open();assert.equal(h.calls.length,1);assert(h.calls[0].options?.signal);
 const retry=h.ctx.withdrawReasonRetry();assert.equal(h.calls.length,2);assert.equal(h.calls[0].options.signal.aborted,true);const joined=h.ctx.withdrawReasonRetry();assert.equal(h.calls.length,2);
 h.reply(1);await Promise.all([retry,joined]);assert.equal(h.api.state.reasonData.rows[0].reason,'current');h.reply(0,response('obsolete'));await settle();assert.equal(h.api.state.reasonData.rows[0].reason,'current');
});
test('closing aborts transport immediately and a reopened identical drawer never joins the cancelled job',async()=>{
 const h=fixture();h.open();h.ctx.withdrawReasonClose();assert.equal(h.calls[0].options?.signal?.aborted,true);assert.equal(h.api.state.reasonBusy,false);h.open();assert.equal(h.calls.length,2);
 h.reply(1);await settle();h.reply(0,response('late'));await settle();assert.equal(h.api.state.reasonData.rows[0].reason,'current');
});
test('platform, reason date, kind, search and main filters abort superseded reason reads',async()=>{
 for(const change of [h=>h.ctx.withdrawReasons(1),h=>h.ctx.withdrawReasonDate('2026-10-10'),h=>h.ctx.withdrawReasonKind('orders'),h=>{h.ctx.withdrawReasonQuery('ORDER');h.ctx.withdrawReasonSearch();},h=>h.ctx.withdrawMetricTimeSet('successFrom','2026-10-10T00:00:00'),h=>h.ctx.withdrawDate('from','2026-10-10')]){
  const h=fixture();h.open();change(h);assert.equal(h.calls[0].options?.signal?.aborted,true);h.reply(0,response('late'));await settle();assert.notEqual(h.api.state.reasonData?.rows?.[0]?.reason,'late');
 }
});
test('pause, cancel, restore, document exit and explicit main query release the reason transport',async()=>{
 for(const stop of [h=>h.api.pause(),h=>h.api.cancel(),h=>h.api.restore(null),h=>h.events.get('pagehide')?.(),h=>h.api.load(true)]){
  const h=fixture();h.open();stop(h);assert.equal(h.calls[0].options?.signal?.aborted,true);h.reply(0,response('late'));await settle();assert.notEqual(h.api.state.reasonData?.rows?.[0]?.reason,'late');
 }
});
test('actor, permission, native, page and independent-window drift cannot deliver or cache an old response',async()=>{
 for(const drift of [h=>h.ctx.hensemDataScope={identity:'other-actor'},h=>h.ctx.hensemRoleAccess={canView:false},h=>h.ctx.hensemRoleAllowed=()=>false,h=>h.L.catalog[0].source='newar',h=>h.setPage('withdraw_operators'),h=>h.L.successTo='2026-10-12T23:59:59']){
  const h=fixture();h.open();drift(h);h.reply();await settle();assert.equal(h.api.state.reasonData,null);assert.equal(h.api.state.reasonBusy,false);
 }
});
test('actual iframe → host queue → HTTP bridge aborts active and queued drawer reads, without raising concurrency',async()=>{
 const filename=path.join(__dirname,'admin-live-bridge.test.cjs'),module={exports:{}};
 const prefix=fs.readFileSync(filename,'utf8').split("\ntest('request validation")[0];
 vm.runInNewContext(prefix+'\nmodule.exports={load,session,query};',{module,require:require('node:module').createRequire(filename),__dirname,setImmediate,AbortController,URL},{filename});
 for(const queued of [false,true]){
  const h=module.exports.load({fetch:()=>new Promise(()=>{})}),timers=new Map();let timer=0,frame,events;
  const child={postMessage:(data,origin)=>events.get('message')?.({source:parent,origin,data})};
  const parent={postMessage:data=>h.send({source:child,origin:'null',data})};
  const cleanup=h.api.installAdminLiveBridge({source:()=>child,channel:()=> 'drawer-channel',session:module.exports.session,target:h.target});
  if(queued)for(let i=0;i<4;i++)h.send({source:child,origin:'null',data:{type:h.api.LIVE_REQUEST,id:'occupied_'+i,channel:'drawer-channel',page:'overview',request:module.exports.query}});
  const f=fixture({prepare:(ctx,handlers)=>{frame=ctx;events=handlers;Object.assign(ctx,{parent,Date,setTimeout:(fn,ms)=>{const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});const html=h.api.makeAdminLiveDocument('<!doctype html><html></html>','drawer-channel');vm.runInContext([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][0][1],ctx);ctx.hensemCurrentAdminPage=()=> 'auto_withdraw';},request:(q,o)=>frame.hensemLiveRequest(q,o)});
  f.open();await settle();assert.equal(h.calls.length,queued?4:1);assert.equal(timers.size,1);f.ctx.withdrawReasonClose();await settle();assert.equal(timers.size,0);assert.equal(f.api.state.reasonBusy,false);
  if(!queued)assert.equal(h.calls[0].init.signal.aborted,true);else{assert.equal(h.calls.length,4);assert(h.calls.every(c=>!c.init.signal.aborted));}
  cleanup();await settle();assert(h.calls.every(c=>c.init.signal.aborted));assert.equal(h.timers.size,0);
 }
});
test('current authority denial clears successful caches; obsolete denial cannot clear a replacement',async()=>{
 const h=fixture();h.open();h.reply();await settle();const denied=h.ctx.withdrawReasonRetry();h.calls[1].reject(Object.assign(Error('role_permission_denied'),{code:'42501'}));await denied;assert.equal(h.api.state.reasonData,null);assert.equal(h.api.state.data,null);
 const other=fixture();other.open();const retry=other.ctx.withdrawReasonRetry();other.reply(1);await retry;other.calls[0].reject(Object.assign(Error('role_permission_denied'),{code:'42501'}));await settle();assert.equal(other.api.state.reasonData.rows[0].reason,'current');
});
test('successful exact cache preserves source uncertainty, expires, and never stores failures or partial results as complete snapshots',async()=>{
 const h=fixture();h.open();h.reply();await settle();h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,1);assert.equal(h.api.state.reasonData.coverage.complete,false);h.ctx.withdrawReasonClose();h.advance(60000);h.open();assert.equal(h.calls.length,2);h.reply(1);await settle();
 for(const patch of [{error:'source failure'},{available:false},{partial:true},{complete:false}]){const x=fixture();x.open();x.reply(0,response('partial',patch));await settle();x.ctx.withdrawReasonClose();x.open();assert.equal(x.calls.length,2);}
});
test('cached reads are isolated by actor, native identity, page and both independent windows',async()=>{
 for(const drift of [h=>h.ctx.hensemDataScope={identity:'other-actor'},h=>h.L.catalog[0].id='other-native',h=>h.setPage('withdraw_operators'),h=>h.L.successFrom='2026-10-10T00:00:00',h=>h.L.from='2026-10-10T00:00:00']){
  const h=fixture();h.open();h.reply();await settle();h.ctx.withdrawReasonClose();drift(h);h.open();assert.equal(h.calls.length,2);assert.equal(h.api.state.reasonData,null);
 }
});
