// Offline synthetic count responses only; no credentials or production reads.
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../admin-preview/live-member-counts.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const platform=(id=A,more={})=>({id,name:id===A?'Synthetic A':'Synthetic B',source:'AR',sourceName:id,country:'印度',timezone:'Asia/Kolkata',currency:'INR',...more});
const row=(date,direction,more={})=>({date,direction,created_member_count:12,success_member_count:9,created_order_count:20,success_order_count:15,created_missing_member_count:0,success_missing_member_count:0,...more});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function response(q,p=platform(q.platformId),more={}){
 const date=new Date(Date.parse(q.startAt)+5.5*3600000).toISOString().slice(0,10);
 return {platform:p,startAt:q.startAt,endAt:q.endAt,rows:['charge','withdraw'].filter(d=>q.direction==='all'||d===q.direction).map(d=>row(date,d)),capabilities:{memberIdentity:true,createdBasis:'created_at',successBasis:'success_at',dedupe:'platform_local_date_direction_member',sourceCompletenessVerified:false},...more};
}
function harness(options={}){
 const L={country:'印度',from:'2026-10-08T00:00:00',to:'2026-10-08T23:59:59',direction:'all',status:'all',dirty:false,multi:{team:[],provider:[]}},calls=[],drawers=[];
 let clock=Date.parse('2026-10-12T08:00:00Z'),selected=[platform()],context={user:'synthetic-user',scope:'all',version:1},extra={},handler=q=>response(q,selected.find(p=>p.id===q.platformId));
 const ui=create({L,E:escape,C:v=>String(v),selected:()=>selected,query:(p,action)=>({action,platformId:p.id,startAt:new Date(Date.parse(L.from+'+05:30')).toISOString(),endAt:new Date(Date.parse(L.to+'+05:30')+1000).toISOString(),direction:L.direction,status:L.status,currency:p.currency,providers:L.multi.provider,...extra}),request:q=>{calls.push(q);return Promise.resolve().then(()=>handler(q));},render(){},open:(title,body)=>drawers.push({title,body}),now:()=>clock,...(options.defaultContext?{}:{accessContext:()=>context})});
 return {L,ui,calls,drawers,select:p=>selected=p,context:v=>context=v,handler:f=>handler=f,extra:v=>extra=v,now:v=>clock=typeof v==='string'?Date.parse(v):v,advance:ms=>clock+=ms,query:async force=>{ui.beginQuery(force);await ui.ensure();}};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('historical query reuses validated counts for five minutes without changing source completeness',async()=>{
 const h=harness();await h.query();const at=h.ui.state.results[0]._memberReadAt;h.advance(299999);await h.query();assert.equal(h.calls.length,1);assert.equal(h.ui.state.results[0]._memberCacheHit,true);assert.equal(h.ui.state.results[0]._memberReadAt,at);assert.equal(h.ui.state.results[0].sourceCompletenessVerified,false);assert.match(h.ui.metric('charge'),/缓存/);
 h.advance(1);await h.query();assert.equal(h.calls.length,2);assert.equal(h.ui.state.results[0]._memberCacheHit,false);
});

test('today query expires after thirty seconds, while render ensure never triggers automatic expiry refresh',async()=>{
 const h=harness();h.L.from='2026-10-12T00:00:00';h.L.to='2026-10-12T23:59:59';await h.query();h.advance(29999);await h.query();assert.equal(h.calls.length,1);
 h.advance(1);for(let i=0;i<5;i++){h.ui.metric('charge');await h.ui.ensure();}assert.equal(h.calls.length,1,'render-time ensure does not launch a refresh loop');assert.match(h.ui.metric('charge'),/已过期，查询更新/);
 await h.query();assert.equal(h.calls.length,2);assert.doesNotMatch(h.ui.metric('charge'),/已过期/);
});

test('platform cache is shared across exact query selections but never merges member identities',async()=>{
 const h=harness();await h.query();h.select([platform(),platform(B)]);await h.query();assert.equal(h.calls.length,2);assert.equal(h.calls[1].platformId,B);assert.equal(h.ui.state.results.length,2);assert.match(h.ui.metric('charge'),/24 \/ 18/);
 h.select([platform()]);await h.query();assert.equal(h.calls.length,2);assert.match(h.ui.metric('charge'),/12 \/ 9/);
});

test('normalized provider union hits; exact currency, request and native platform identity remain separate',async()=>{
 const h=harness();h.L.multi.provider=['B Pay','A Pay','B Pay'];await h.query();h.L.multi.provider=['A Pay','B Pay'];await h.query();assert.equal(h.calls.length,1);
 h.L.direction='withdraw';await h.query();assert.equal(h.calls.length,2);h.extra({currency:'USD'});await h.query();assert.equal(h.calls.length,3);
 h.select([platform(A,{source:'NEW_AR',sourceName:'Different native source'})]);await h.query();assert.equal(h.calls.length,4);
 h.extra({startAt:'2026-10-08T01:00:00.000Z'});await h.query();assert.equal(h.calls.length,5);
});

test('cached results are isolated copies and preserve missing-ID partial labels',async()=>{
 const h=harness();h.handler(q=>response(q,platform(),{rows:[row('2026-10-08','charge',{created_member_count:0,created_missing_member_count:20}),row('2026-10-08','withdraw')]}));await h.query();assert.match(h.ui.metric('charge'),/部分数据/);
 h.ui.state.results[0].rows[1].created_member_count=999;await h.query();assert.equal(h.calls.length,1);assert.equal(h.ui.state.results[0].rows[1].created_member_count,12);assert.match(h.ui.metric('charge'),/— \/ 9/);assert.match(h.ui.metric('charge'),/部分数据/);assert.equal(h.ui.state.results[0].sourceCompletenessVerified,false);
});

test('failed platforms retry on explicit query while complete platform cache remains reusable',async()=>{
 const h=harness();h.select([platform(),platform(B)]);let failed=true;h.handler(q=>{if(q.platformId===B&&failed)throw Error('Synthetic offline');return response(q);});await h.query();assert.equal(h.ui.state.failures.length,1);assert.match(h.ui.metric('charge'),/部分数据/);
 failed=false;await h.query();assert.equal(h.calls.filter(q=>q.platformId===A).length,1);assert.equal(h.calls.filter(q=>q.platformId===B).length,2);assert.equal(h.ui.state.failures.length,0);
});

test('malformed ranges, incomplete days and explicit partial/error responses are never cached',async()=>{
 for(const alter of [r=>({...r,endAt:r.startAt}),r=>({...r,rows:r.rows.slice(0,1)}),r=>({...r,partial:true}),r=>({...r,complete:false}),r=>({...r,error:'Synthetic incomplete response'}),r=>({...r,meta:{partial:true}})]){
  const h=harness();h.handler(q=>alter(response(q)));await h.query();await h.query();assert.equal(h.calls.length,2);
 }
});

test('explicit force and legacy load bypass cache and refresh the read timestamp',async()=>{
 const h=harness();await h.query();const at=h.ui.state.results[0]._memberReadAt;h.advance(1000);await h.query(true);assert.equal(h.calls.length,2);assert(h.ui.state.results[0]._memberReadAt>at);h.advance(1000);await h.ui.load();assert.equal(h.calls.length,3);await h.query();assert.equal(h.calls.length,3);
});

test('force refresh rejects a late old response and cannot refill cache with the old counts',async()=>{
 const h=harness(),old=deferred();let attempt=0;h.handler(q=>++attempt===1?old.promise:response(q,platform(),{rows:[row('2026-10-08','charge',{created_member_count:5}),row('2026-10-08','withdraw')]}));
 const first=h.query();await settle();await h.query(true);old.resolve(response(h.calls[0]));await first;assert.equal(h.ui.state.results[0].rows[0].created_member_count,5);await h.query();assert.equal(h.calls.length,2);assert.equal(h.ui.state.results[0].rows[0].created_member_count,5);
});

test('cancelled response cannot seed the cache even when the next query has identical filters',async()=>{
 const h=harness(),old=deferred();h.handler(()=>old.promise);const first=h.query();await settle();h.ui.cancel();old.resolve(response(h.calls[0]));await first;h.handler(q=>response(q));await h.query();assert.equal(h.calls.length,2);
});

test('authority changes invalidate ready data and reject earlier in-flight responses',async()=>{
 const h=harness();await h.query();h.context({user:'different-user',scope:'selected',version:1});assert.match(h.ui.metric('charge'),/查询后显示人数/);await h.query();assert.equal(h.calls.length,2);
 const old=deferred();h.handler(()=>old.promise);const first=h.query(true);await settle();h.context({user:'different-user',scope:'selected',version:2});h.handler(q=>response(q));await h.query();old.resolve(response(h.calls[2],platform(),{rows:[row('2026-10-08','charge',{created_member_count:19}),row('2026-10-08','withdraw')]}));await first;await h.query();assert.equal(h.calls.length,4);assert.equal(h.ui.state.results[0].rows[0].created_member_count,12);
});

test('an unverified authority callback denies both cache and transport',async()=>{
 const h=harness();await h.query();h.context('');h.ui.beginQuery();await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.state.status,'error');assert.match(h.ui.state.error,/权限尚未确认/);assert.doesNotMatch(h.ui.metric('charge'),/12 \/ 9/);
});

test('default document role/scope context invalidates on role versions and explicitly denied roles',async()=>{
 const priorRole=globalThis.hensemRoleAccess,priorScope=globalThis.hensemDataScope;
 try{
  globalThis.hensemRoleAccess={mode:'assigned',canView:true,roleId:'synthetic',version:1,permissions:['overview.query']};globalThis.hensemDataScope={mode:'selected',identity:'synthetic-scope'};
  const h=harness({defaultContext:true});await h.query();globalThis.hensemRoleAccess.version++;await h.query();assert.equal(h.calls.length,2);globalThis.hensemRoleAccess.canView=false;await h.query();assert.equal(h.calls.length,2);assert.equal(h.ui.state.status,'error');
 }finally{if(priorRole===undefined)delete globalThis.hensemRoleAccess;else globalThis.hensemRoleAccess=priorRole;if(priorScope===undefined)delete globalThis.hensemDataScope;else globalThis.hensemDataScope=priorScope;}
});

test('transport permission errors discard previous cached scopes and never become cached failures',async()=>{
 const h=harness();await h.query();h.L.multi.provider=['Other provider'];h.handler(()=>{throw Object.assign(Error('permission_denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});});await h.query();assert.equal(h.ui.state.status,'error');h.L.multi.provider=[];h.handler(q=>response(q));await h.query();assert.equal(h.calls.length,3);
});

test('clock regression cannot extend a cached result beyond its original TTL',async()=>{
 const h=harness();await h.query();h.advance(-1);await h.query();assert.equal(h.calls.length,2);
});

test('capture/restore keeps its original read time and labels an expired restored view without fetching',async()=>{
 const h=harness();await h.query();const saved=h.ui.capture(),at=saved.results[0]._memberReadAt;h.advance(300000);h.ui.restore(null);h.ui.restore(saved);await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.state.results[0]._memberReadAt,at);assert.match(h.ui.metric('charge'),/人数读取 .*已过期，查询更新/);h.ui.details();assert.match(h.drawers.at(-1).body,/人数读取/);await h.query();assert.equal(h.calls.length,2);
});

test('LRU has at most 128 exact result entries and preserves recently used entries',async()=>{
 const h=harness();for(let i=0;i<129;i++){h.L.multi.provider=['Synthetic '+i];await h.query();}assert.equal(h.calls.length,129);h.L.multi.provider=['Synthetic 128'];await h.query();assert.equal(h.calls.length,129);h.L.multi.provider=['Synthetic 0'];await h.query();assert.equal(h.calls.length,130);
});

test('individual results above one MiB are not retained, and total retention is bounded at eight MiB',async()=>{
 const h=harness();h.handler(q=>response(q,platform(),{rows:[row('2026-10-08','charge',{syntheticPadding:'x'.repeat(530000)}),row('2026-10-08','withdraw')]}));await h.query();await h.query();assert.equal(h.calls.length,2,'oversized result does not enter cache');
 const bounded=harness();bounded.handler(q=>response(q,platform(),{rows:[row('2026-10-08','charge',{syntheticPadding:'x'.repeat(290000)}),row('2026-10-08','withdraw')]}));for(let i=0;i<16;i++){bounded.L.multi.provider=['Synthetic '+i];await bounded.query();}bounded.L.multi.provider=['Synthetic 15'];await bounded.query();assert.equal(bounded.calls.length,16);bounded.L.multi.provider=['Synthetic 0'];await bounded.query();assert.equal(bounded.calls.length,17,'oldest result was evicted by byte limit long before entry limit');
});

const timeout=()=>Object.assign(Error('Synthetic statement timeout'),{code:'57014'});
test('single-day all timeout reads serial exact directions, then caches a whole result with oldest time and TTL',async()=>{
 const h=harness(),base=Date.parse('2026-10-12T08:00:00Z');h.L.multi.provider=['B Pay','A Pay','B Pay'];let active=0,maximum=0;
 h.handler(async q=>{active++;maximum=Math.max(maximum,active);try{await settle();if(q.direction==='all')throw timeout();h.advance(1000);return response(q);}finally{active--;}});
 await h.query();assert.equal(maximum,1);assert.deepEqual(h.calls.map(q=>q.direction),['all','charge','withdraw']);assert.deepEqual(h.calls.slice(1),['charge','withdraw'].map(direction=>({...h.calls[0],direction})));assert.deepEqual(h.calls[0].providers,['A Pay','B Pay']);assert.equal(Date.parse(h.calls[0].endAt)-Date.parse(h.calls[0].startAt),86400000);
 const result=h.ui.state.results[0];assert.equal(h.ui.state.status,'ready');assert.equal(h.ui.state.failures.length,0);assert.deepEqual(result.rows.map(r=>r.direction),['charge','withdraw']);assert.equal(result._memberReadAt,base+1000);assert.equal(result._memberExpiresAt,base+301000);assert.equal(result.sourceCompletenessVerified,false);
 await h.query();assert.equal(h.calls.length,3);assert.equal(h.ui.state.results[0]._memberCacheHit,true);assert.equal(h.ui.state.results[0]._memberReadAt,base+1000);h.now(base+300999);await h.query();assert.equal(h.calls.length,3);h.advance(1);await h.query();assert.equal(h.calls.length,6,'combined cache expires at the older direction deadline');
});

test('direction retry preserves missing identities and ANDs source and frequency capabilities',async()=>{
 for(const unverified of ['charge','withdraw',null]){
  const h=harness();h.handler(q=>{if(q.direction==='all')throw timeout();const r=response(q);r.capabilities.sourceCompletenessVerified=q.direction!==unverified;if(q.direction!==unverified){r.capabilities.frequencyBasis='per_platform_local_day_order_count';r.capabilities.frequencyThresholds=[2,3,4,5];}if(q.direction==='charge')r.rows[0].created_missing_member_count=3;return r;});
  await h.query();assert.equal(h.ui.state.results.length,1);assert.equal(h.ui.state.results[0].sourceCompletenessVerified,unverified===null);assert.equal(h.ui.state.results[0].frequencySupported,unverified===null);assert.equal(h.ui.state.results[0].rows[0].created_missing_member_count,3);assert.match(h.ui.metric('charge'),/已知人数.*部分数据/);await h.query();assert.equal(h.calls.length,3);assert.match(h.ui.metric('charge'),/部分数据/);
 }
});

test('one failed direction excludes the whole platform, retains successful peers and has no recursive retries',async()=>{
 for(const failedDirection of ['charge','withdraw']){
  const h=harness();h.select([platform(),platform(B)]);h.handler(q=>{if(q.platformId===A&&(q.direction==='all'||q.direction===failedDirection))throw timeout();return response(q);});await h.query();
  assert.deepEqual(h.calls.filter(q=>q.platformId===A).map(q=>q.direction),failedDirection==='charge'?['all','charge']:['all','charge','withdraw']);assert.equal(h.ui.state.results.length,1);assert.equal(h.ui.state.results[0].platform.id,B);assert.equal(h.ui.state.failures.length,1);assert.match(h.ui.state.failures[0].error,new RegExp((failedDirection==='charge'?'0':'1')+'/2 方向已读取，平台未计入合计'));assert.match(h.ui.metric('charge'),/12 \/ 9/);assert.match(h.ui.metric('charge'),/读取 1 \/ 2 平台.*部分数据/);const n=h.calls.length;await h.ui.ensure();assert.equal(h.calls.length,n);
 }
});

test('partial or invalid direction payload never creates a complete all result or caches that result',async()=>{
 for(const alter of [r=>({...r,partial:true}),r=>({...r,complete:false}),r=>({...r,available:false}),r=>({...r,error:'incomplete'}),r=>({...r,meta:{partial:true}}),r=>({...r,coverage:{complete:false}}),r=>({...r,rows:[]}),r=>({...r,rows:[{...r.rows[0],direction:'charge'}]}),r=>({...r,endAt:r.startAt}),r=>({...r,platform:{...r.platform,timezone:'UTC'}})]){
  const h=harness();h.handler(q=>{if(q.direction==='all')throw timeout();const r=response(q);return q.direction==='withdraw'?alter(r):r;});await h.query();assert.equal(h.ui.state.status,'error');assert.equal(h.ui.state.results.length,0);assert.equal(h.ui.state.failures.length,1);assert.match(h.ui.metric('withdraw'),/— \/ —/);await h.query();assert.equal(h.calls.filter(q=>q.direction==='all').length,2,'failed parent is not cached');assert.equal(h.calls.filter(q=>q.direction==='withdraw').length,2,'invalid child is not cached');assert.equal(h.calls.filter(q=>q.direction==='charge').length,1,'validated child cache may be reused without publishing a partial parent');
 }
});

test('force all bypasses both direction caches and invalidates them even when the parent fails before fallback',async()=>{
 const h=harness();h.L.direction='charge';await h.query();h.L.direction='withdraw';await h.query();h.L.direction='all';h.handler(q=>{if(q.direction==='all')throw timeout();return response(q);});await h.query(true);assert.deepEqual(h.calls.map(q=>q.direction),['charge','withdraw','all','charge','withdraw']);await h.query();assert.equal(h.calls.length,5);
 h.handler(()=>{throw Error('Synthetic network error');});await h.query(true);assert.equal(h.ui.state.status,'error');h.L.direction='charge';h.handler(q=>response(q));await h.query();h.L.direction='withdraw';await h.query();assert.deepEqual(h.calls.slice(-3).map(q=>q.direction),['all','charge','withdraw']);
});

test('force one direction invalidates a composed all cache but retains the other exact direction cache',async()=>{
 const h=harness();let chargeCount=12;h.handler(q=>{if(q.direction==='all')throw timeout();const r=response(q);if(q.direction==='charge')r.rows[0].created_member_count=chargeCount;return r;});await h.query();assert.equal(h.calls.length,3);
 h.L.direction='charge';chargeCount=5;await h.query(true);assert.equal(h.calls.length,4);h.L.direction='all';await h.query();assert.equal(h.calls.length,5,'all parent is read again, then both still-valid child caches may satisfy its fallback');assert.equal(h.calls.at(-1).direction,'all');assert.equal(h.ui.state.results[0].rows.find(r=>r.direction==='charge').created_member_count,5);assert.equal(h.ui.state.results[0].rows.find(r=>r.direction==='withdraw').created_member_count,12);await h.query();assert.equal(h.calls.length,5);
});

test('cancel during either direction discards late results and prevents the next direction or parent cache fill',async()=>{
 for(const waiting of ['charge','withdraw']){
  const h=harness(),late=deferred();h.handler(q=>{if(q.direction==='all')throw timeout();return q.direction===waiting?late.promise:response(q);});const first=h.query();await settle();const old=h.calls.at(-1);assert.equal(old.direction,waiting);h.ui.cancel();late.resolve(response(old));await first;assert.equal(h.ui.state.status,'paused');assert.equal(h.ui.state.results.length,0);assert.equal(h.calls.length,waiting==='charge'?2:3);
  h.handler(q=>{if(q.direction==='all')throw timeout();return response(q);});await h.query();assert.equal(h.ui.state.results.length,1);assert.equal(h.calls.filter(q=>q.direction==='all').length,2);assert.equal(h.calls.filter(q=>q.direction===waiting).length,2,'cancelled child cannot refill its cache');
 }
});

test('authority revocation or context changes during direction fallback prevent late publication and old-cache reuse',async()=>{
 for(const context of ['',{user:'different-user',scope:'selected',version:2}]){
  const h=harness(),late=deferred();h.handler(q=>{if(q.direction==='all')throw timeout();return q.direction==='withdraw'?late.promise:response(q);});const first=h.query();await settle();assert.equal(h.calls.length,3);const old=h.calls.at(-1);h.context(context);late.resolve(response(old));await first;assert.equal(h.ui.state.results.length,0);assert.doesNotMatch(h.ui.metric('charge'),/12 \/ 9/);
  if(context===''){await h.query();assert.equal(h.calls.length,3);assert.equal(h.ui.state.status,'error');h.context({user:'synthetic-user',scope:'all',version:3});}
  h.handler(q=>{if(q.direction==='all')throw timeout();return response(q);});await h.query();assert.deepEqual(h.calls.slice(-3).map(q=>q.direction),['all','charge','withdraw']);assert.equal(h.calls.length,6);assert.equal(h.ui.state.results.length,1);
 }
});

test('direction permission error clears successful child cache and is never retried recursively',async()=>{
 const h=harness();h.handler(q=>{if(q.direction==='all')throw timeout();if(q.direction==='withdraw')throw Object.assign(Error('permission denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});return response(q);});await h.query();assert.equal(h.calls.length,3);assert.equal(h.ui.state.results.length,0);assert.match(h.ui.state.failures[0].error,/permission denied/);h.L.direction='charge';h.handler(q=>response(q));await h.query();assert.equal(h.calls.length,4,'the earlier successful direction was evicted on permission failure');
});

test('force during a direction read cannot compose late old counts into the refreshed result',async()=>{
 const h=harness(),old=deferred();h.handler(q=>{if(q.direction==='all')throw timeout();return q.direction==='withdraw'?old.promise:response(q);});const first=h.query();await settle();assert.equal(h.calls.length,3);const oldRequest=h.calls.at(-1);
 h.handler(q=>{if(q.direction==='all')throw timeout();const r=response(q);r.rows[0].created_member_count=5;return r;});await h.query(true);assert.equal(h.calls.length,6);old.resolve(response(oldRequest));await first;assert.equal(h.ui.state.results.length,1);assert.deepEqual(h.ui.state.results[0].rows.map(r=>r.created_member_count),[5,5]);await h.query();assert.equal(h.calls.length,6);assert.deepEqual(h.ui.state.results[0].rows.map(r=>r.created_member_count),[5,5]);
});

test('a slow second direction cannot renew the first direction realtime TTL',async()=>{
 const h=harness(),base=Date.parse('2026-10-12T08:00:00Z');h.L.from='2026-10-12T00:00:00';h.L.to='2026-10-12T23:59:59';h.handler(q=>{if(q.direction==='all')throw timeout();if(q.direction==='withdraw')h.advance(30000);return response(q);});await h.query();assert.equal(h.ui.state.results[0]._memberReadAt,base);assert.equal(h.ui.state.results[0]._memberExpiresAt,base+30000);assert.match(h.ui.metric('charge'),/已过期，查询更新/);
 h.handler(q=>{if(q.direction==='all')throw timeout();return response(q);});await h.query();assert.equal(h.calls.filter(q=>q.direction==='all').length,2);assert.equal(h.calls.filter(q=>q.direction==='charge').length,2);assert.equal(h.calls.filter(q=>q.direction==='withdraw').length,1);assert.equal(h.ui.state.results[0]._memberExpiresAt,base+60000);assert.doesNotMatch(h.ui.metric('charge'),/已过期/);
});

test('single-direction timeouts retain one identical original retry and partial-day all requests are never widened',async()=>{
 for(const direction of ['charge','withdraw']){const h=harness();h.L.direction=direction;h.handler(q=>{if(h.calls.length===1)throw timeout();return response(q);});await h.query();assert.equal(h.calls.length,2);assert.strictEqual(h.calls[1],h.calls[0]);assert.equal(h.ui.state.results.length,1);}
 const h=harness();h.extra({startAt:'2026-10-08T04:00:00.000Z',endAt:'2026-10-08T05:00:00.000Z'});h.handler(q=>{if(q.direction==='all')throw timeout();return response(q);});await h.query();assert.equal(h.calls.length,3);assert(h.calls.every(q=>q.startAt==='2026-10-08T04:00:00.000Z'&&q.endAt==='2026-10-08T05:00:00.000Z'));assert.equal(h.ui.state.results.length,1);
});
