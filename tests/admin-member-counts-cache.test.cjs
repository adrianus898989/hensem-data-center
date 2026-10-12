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
 const h=harness();await h.query();h.L.multi.provider=['Other provider'];h.handler(()=>{throw Object.assign(Error('permission_denied'),{code:'403'});});await h.query();assert.equal(h.ui.state.status,'error');h.L.multi.provider=[];h.handler(q=>response(q));await h.query();assert.equal(h.calls.length,3);
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
