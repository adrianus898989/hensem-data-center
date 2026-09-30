/* Synthetic identities/counts only. No source-member identifiers are fetched by this UI. */
const test=require('node:test'),assert=require('node:assert/strict');
const {create,requestFor,validate,dailySlices}=require('../admin-preview/live-member-counts.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const p=(id=A,more={})=>({id,name:id===A?'Synthetic A':'Synthetic B',source:'AR',country:'印度',timezone:'Asia/Kolkata',currency:'INR',...more});
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const row=(date,direction='charge',values={})=>({date,direction,created_member_count:12,success_member_count:9,created_order_count:20,success_order_count:15,created_missing_member_count:0,success_missing_member_count:0,...values});
const zero=()=>({created_member_count:0,success_member_count:0,created_order_count:0,success_order_count:0,created_missing_member_count:0,success_missing_member_count:0});
function response(q,rows=[row('2026-09-26'),row('2026-09-26','withdraw')],extra={}){return {version:1,platform:p(q.platformId),startAt:q.startAt,endAt:q.endAt,rows,capabilities:{memberIdentity:true,createdBasis:'created_at',successBasis:'success_at',dedupe:'platform_local_date_direction_member',sourceCompletenessVerified:false,periodTotal:'sum_daily_unique_member_visits'},...extra};}
function harness(){const L={country:'印度',from:'2026-09-26T00:00:00',to:'2026-09-26T23:59:59',direction:'all',status:'all',dirty:false,multi:{team:[],provider:[]}},calls=[],drawers=[];let selected=[p()],handler=q=>response(q),extraQuery={};const ui=create({L,E:escape,C:v=>Number(v).toLocaleString('en-US'),N:v=>String(v),selected:()=>selected,query:(platform,action)=>({action,platformId:platform.id,startAt:'2026-09-25T18:30:00Z',endAt:'2026-09-26T18:30:00Z',direction:L.direction,status:L.status,currency:platform.currency,providers:L.multi.provider,offset:200,limit:50,view:'providers',...extraQuery}),request:q=>{calls.push(q);return Promise.resolve(handler(q))},render(){},open:(title,body)=>drawers.push({title,body})});return {L,ui,calls,drawers,select:v=>selected=v,handler:v=>handler=v,query:v=>extraQuery=v};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function wgResponse(q){
 const caps={memberIdentity:false,memberIdentityByDirection:{charge:false,withdraw:true},availability:{charge:{created:false,success:false},withdraw:{created:true,success:false}},createdBasis:'created_at',successBasis:'success_at',dedupe:'platform_local_date_direction_member',frequencyBasis:'per_platform_local_day_order_count',frequencyThresholds:[2,3,4,5],sourceCompletenessVerified:false};
 const charge=row('2026-09-26','charge',{created_available:false,success_available:false,created_unavailable_reason:'source_member_id_unavailable',success_unavailable_reason:'source_member_id_unavailable',created_member_count:null,success_member_count:null,created_missing_member_count:20,success_missing_member_count:15});
 const withdraw=row('2026-09-26','withdraw',{created_available:true,success_available:false,created_unavailable_reason:null,success_unavailable_reason:'source_success_time_unavailable',created_missing_member_count:2,success_member_count:null,success_order_count:null,success_missing_member_count:null});
 for(const [i,n]of [2,3,4,5].entries()){charge['created_members_ge'+n]=charge['success_members_ge'+n]=withdraw['success_members_ge'+n]=null;withdraw['created_members_ge'+n]=[8,6,4,2][i];}
 return response(q,[charge,withdraw].filter(r=>q.direction==='all'||r.direction===q.direction),{platform:p(q.platformId,{source:'wg'}),capabilities:caps});
}

test('WG member axes preserve unavailable recharge and paid-time people, but count real created withdrawal IDs',async()=>{
 const h=harness();h.select([p(A,{source:'wg'})]);h.handler(wgResponse);await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.state.status,'ready');
 assert.match(h.ui.metric('charge'),/— \/ —/);assert.match(h.ui.metric('charge'),/充值明细未提供会员 ID/);assert.match(h.ui.metric('withdraw'),/12 \/ —/);assert.match(h.ui.metric('withdraw'),/未提供已核实成功时间/);
 for(const direction of ['charge','withdraw']){const m=h.ui.platformMetric(A,direction);assert.equal(m.value,null);assert.equal(m.coverage.successOrderCount,null);assert.equal(m.partial,true);assert.match(m.html,/>—<\/span>/);assert.doesNotMatch(m.title,/成功订单会员 ID 覆盖 0 \/ 0/);}
 h.ui.details();let html=h.drawers.at(-1).body;assert.match(html,/12<small class="cell-sub">已知人数；2 笔未提供会员 ID/);assert.match(html,/成功人数不可统计/);assert.doesNotMatch(html,/成功订单会员 ID 覆盖 0 \/ 0/);
 h.ui.details('frequency','success');html=h.drawers.at(-1).body;assert.match(html,/成功人数不可统计/);assert.doesNotMatch(html,/<td>0<\/td>/);
 h.ui.details('frequency','created');html=h.drawers.at(-1).body;assert.match(html,/8<small class="cell-sub">已知/);assert.match(html,/频次已提供 1 \/ 1/);
});

test('mixed WG member axes mark known other-platform totals partial rather than coerce missing WG people to zero',async()=>{
 const h=harness();h.select([p(A,{source:'wg'}),p(B)]);h.handler(q=>q.platformId===A?wgResponse(q):response(q));await h.ui.ensure();assert.match(h.ui.metric('withdraw'),/24 \/ 9/);assert.match(h.ui.metric('withdraw'),/已知人数/);assert.match(h.ui.metric('withdraw'),/成功人数不可统计/);
 const m=h.ui.platformMetric([A,B],'withdraw');assert.equal(m.value,9);assert.equal(m.partial,true);assert.equal(m.coverage.successOrderCount,null);assert.match(m.html,/>9<sup.*部分数据/);
});

test('WG missing capabilities, invented zeros and wrong available axes fail closed without weakening old member validation',async()=>{
 const h=harness();h.select([p(A,{source:'wg'})]);
 for(const alter of [r=>delete r.capabilities.availability,r=>r.rows[0].created_member_count=0,r=>r.rows[0].created_missing_member_count=0,r=>r.rows[1].success_order_count=0,r=>r.rows[1].created_available=false,r=>r.rows[1].success_unavailable_reason='unknown']){
  h.handler(q=>{const r=wgResponse(q);alter(r);return r});await h.ui.load();assert.equal(h.ui.state.status,'error');assert.match(h.ui.metric('withdraw'),/— \/ —/);
 }
 h.select([p()]);h.handler(wgResponse);await h.ui.load();assert.equal(h.ui.state.status,'error');
});

test('one whole-period request per platform preserves provider union and strips aggregate/pagination fields',async()=>{
 const h=harness();h.L.multi.provider=['Synthetic B Pay','Synthetic A Pay','Synthetic B Pay'];await h.ui.ensure();assert.deepEqual(h.calls,[{action:'memberDaily',platformId:A,startAt:'2026-09-25T18:30:00Z',endAt:'2026-09-26T18:30:00Z',direction:'all',currency:'INR',providers:['Synthetic A Pay','Synthetic B Pay']}]);assert.match(h.ui.metric('charge'),/12 \/ 9/);assert.match(h.ui.metric('charge'),/充值人数 \/ 成功充值人数/);assert.doesNotMatch(h.ui.metric('charge'),/20 \/ 15/);await h.ui.ensure();assert.equal(h.calls.length,1,'same scope ready data is reused');await h.ui.load();assert.equal(h.calls.length,2,'explicit retry bypasses ready data');
});

test('multiple days sum only platform/day unique counts and are labelled daily visits, never period unique people',async()=>{
 const h=harness();h.L.to='2026-09-27T23:59:59';h.query({endAt:'2026-09-27T18:30:00Z'});h.handler(q=>response(q,[row('2026-09-26'),row('2026-09-26','withdraw'),row('2026-09-27'),row('2026-09-27','withdraw')]));await h.ui.ensure();assert.equal(h.calls.length,1);assert.match(h.ui.metric('charge'),/每日去重人次/);assert.match(h.ui.metric('charge'),/24 \/ 18/);h.ui.details();assert.match(h.drawers[0].body,/不能视为整个期间或跨平台的去重人数/);assert.match(h.drawers[0].body,/同一会员使用多个三方只计一次/);assert.match(h.drawers[0].body,/2026-09-26/);assert.match(h.drawers[0].body,/2026-09-27/);
});

test('missing member IDs never become a false zero and both created/success coverage remain explicit',async()=>{
 const h=harness();h.handler(q=>response(q,[row('2026-09-26','charge',{created_member_count:0,created_missing_member_count:20,success_member_count:0,success_missing_member_count:15}),row('2026-09-26','withdraw',zero())]));await h.ui.ensure();assert.match(h.ui.metric('charge'),/— \/ —/);assert.match(h.ui.metric('charge'),/部分数据/);assert.match(h.ui.metric('withdraw'),/0 \/ 0/);h.ui.details();const body=h.drawers[0].body;assert.match(body,/20 笔未提供会员 ID/);assert.match(body,/成功订单会员 ID 覆盖 0 \/ 15 笔/);assert.match(body,/缺失会员 ID 的订单不计人数/);
 h.handler(q=>response(q,[row('2026-09-26','charge',{created_missing_member_count:4}),row('2026-09-26','withdraw')]));await h.ui.load();assert.match(h.ui.metric('charge'),/12 \/ 9/);assert.match(h.ui.metric('charge'),/已知人数/);
});

test('report-only and unsupported KP sources show a coverage gap without broadening requests',async()=>{
 const h=harness();h.select([p(),p(A),p(B,{source:'KP',name:'Synthetic KP'}),p('report:c',{source:'reports',name:'Synthetic Report',reportOnly:true})]);await h.ui.ensure();assert.equal(h.calls.length,1);assert.match(h.ui.metric('charge'),/读取 1 \/ 3 平台/);assert.match(h.ui.metric('charge'),/部分数据/);h.ui.details();assert.match(h.drawers[0].body,/Synthetic KP/);assert.match(h.drawers[0].body,/尚未接入会员明细/);
 h.select([p(B,{source:'KP'})]);await h.ui.ensure();assert.equal(h.calls.length,1);assert.match(h.ui.metric('charge'),/— \/ —/);assert.match(h.ui.metric('charge'),/尚未接入会员明细/);
});

test('platform/date/direction must agree; duplicate dates, missing days, false coverage and wrong basis fail closed',async()=>{
 const h=harness();const invalid=[q=>response(q,undefined,{platform:p(B)}),q=>response(q,undefined,{endAt:'2026-09-25T18:29:59Z'}),q=>response(q,[row('2026-09-25'),row('2026-09-26','withdraw')]),q=>response(q,[row('2026-09-26'),row('2026-09-26')]),q=>response(q,[row('2026-09-26')]),q=>response(q,[row('2026-09-26','charge',{created_missing_member_count:21}),row('2026-09-26','withdraw')]),q=>response(q,[row('2026-09-26','charge',{created_member_count:0}),row('2026-09-26','withdraw')]),q=>response(q,undefined,{capabilities:{memberIdentity:true,dedupe:'hour_member'}})];for(const handler of invalid){h.handler(handler);await h.ui.load();assert.equal(h.ui.state.status,'error');assert.match(h.ui.metric('charge'),/— \/ —/);assert.doesNotMatch(h.ui.metric('charge'),/12 \/ 9/);}
});

test('same-day success cohorts may exceed created cohorts because their time bases are independent',async()=>{
 const h=harness();h.handler(q=>response(q,[row('2026-09-26','charge',{created_member_count:1,created_order_count:1,success_member_count:9,success_order_count:9}),row('2026-09-26','withdraw')]));await h.ui.ensure();assert.equal(h.ui.state.status,'ready');assert.match(h.ui.metric('charge'),/1 \/ 9/);
});

test('partial transport failure retains only labeled known counts and does not turn all failed data into zero',async()=>{
 const h=harness();h.select([p(),p(B)]);h.handler(q=>{if(q.platformId===B)throw Error('<synthetic failure>');return response(q)});await h.ui.ensure();assert.match(h.ui.metric('charge'),/12 \/ 9/);assert.match(h.ui.metric('charge'),/部分数据/);assert.match(h.ui.metric('charge'),/重试/);h.ui.details();assert.match(h.drawers[0].body,/&lt;synthetic failure&gt;/);assert.doesNotMatch(h.drawers[0].body,/<synthetic failure>/);
 h.handler(()=>{throw Error('Synthetic timeout')});await h.ui.load();assert.match(h.ui.metric('charge'),/— \/ —/);assert.match(h.ui.metric('charge'),/读取失败/);
});

test('in-flight scopes are reused; stale responses cannot overwrite provider changes, cancellations or restored tabs',async()=>{
 const h=harness(),old=deferred();h.handler(()=>old.promise);const first=h.ui.ensure();h.ui.ensure();assert.equal(h.calls.length,1);h.L.multi.provider=['New Pay'];h.handler(q=>response(q,[row('2026-09-26','charge',{created_member_count:5}),row('2026-09-26','withdraw')]));await h.ui.ensure();old.resolve(response(h.calls[0]));await first;assert.match(h.ui.metric('charge'),/5 \/ 9/);
 const late=deferred();h.handler(()=>late.promise);const loading=h.ui.load();h.ui.cancel();late.resolve(response(h.calls.at(-1)));await loading;assert.equal(h.ui.state.status,'paused');assert.match(h.ui.metric('charge'),/— \/ —/);
 h.handler(q=>response(q));await h.ui.load();const saved=h.ui.capture();h.ui.restore(null);assert.match(h.ui.metric('charge'),/— \/ —/);h.ui.restore(saved);assert.match(h.ui.metric('charge'),/12 \/ 9/);h.L.dirty=true;assert.match(h.ui.metric('charge'),/— \/ —/);
});

test('direction filter is preserved and hidden directions do not masquerade as zero',async()=>{
 const h=harness();h.L.direction='withdraw';h.handler(q=>response(q,[row('2026-09-26','withdraw')]));await h.ui.ensure();assert.equal(h.calls[0].direction,'withdraw');assert.match(h.ui.metric('withdraw'),/提款人数 \/ 成功提款人数/);assert.match(h.ui.metric('charge'),/— \/ —/);h.ui.details();assert.match(h.drawers[0].body,/<td>—<\/td><td>—<\/td><td>12<\/td><td>9<\/td>/);
});

test('partial-day requests are not widened; impossible ranges or unhandled single-order filters make no query',async()=>{
 const h=harness();h.query({startAt:'2026-09-26T03:00:00Z',endAt:'2026-09-26T04:00:00Z'});await h.ui.ensure();assert.equal(h.calls[0].startAt,'2026-09-26T03:00:00Z');assert.equal(h.calls[0].endAt,'2026-09-26T04:00:00Z');
 for(const query of [{startAt:'2026-09-27T00:00:00Z'},{startAt:'2026-07-01T00:00:00Z'},{memberId:'synthetic'}]){h.query(query);const count=h.calls.length;await h.ui.load();assert.equal(h.calls.length,count);assert.equal(h.ui.state.status,'error');}
});


test('half-open local-midnight end excludes the next day and accepts a complete full-day response',async()=>{
 const h=harness();await h.ui.ensure();assert.equal(h.ui.state.status,'ready');assert.deepEqual(h.ui.state.items[0].days,['2026-09-26']);assert.match(h.ui.metric('charge'),/12 \/ 9/);
 const item=requestFor(p(),()=>({startAt:'2026-09-26T18:29:59.999Z',endAt:'2026-09-26T18:30:00.000Z',direction:'all'}));assert.deepEqual(item.days,['2026-09-26']);
 assert.throws(()=>requestFor(p(),()=>({startAt:'2026-09-26T18:30:00Z',endAt:'2026-09-26T18:30:00Z'})),/范围无效/);
});

test('31 full local days and cross-month ranges match server date rows without an extra midnight day',()=>{
 const item=requestFor(p(),()=>({startAt:'2026-08-31T18:30:00Z',endAt:'2026-10-01T18:30:00Z',direction:'all'}));assert.equal(item.days.length,31);assert.equal(item.days[0],'2026-09-01');assert.equal(item.days.at(-1),'2026-10-01');
 const rows=item.days.flatMap(date=>['charge','withdraw'].map(direction=>row(date,direction,zero())));assert.equal(validate(response(item.request,rows),item).rows.length,62);
 const cross=requestFor(p(),()=>({startAt:'2026-09-29T18:30:00Z',endAt:'2026-10-01T18:30:00Z',direction:'all'}));assert.deepEqual(cross.days,['2026-09-30','2026-10-01']);
 assert.throws(()=>requestFor(p(),()=>({startAt:'2026-08-31T18:30:00Z',endAt:'2026-10-02T18:30:00Z'})),/最多31/);
});

test('DST 23-hour and 25-hour local days each consume one daily row, and a DST-spanning range counts calendar days',()=>{
 const platform=p(A,{timezone:'America/New_York'});
 for(const [startAt,endAt,date]of [['2026-03-08T05:00:00Z','2026-03-09T04:00:00Z','2026-03-08'],['2026-11-01T04:00:00Z','2026-11-02T05:00:00Z','2026-11-01']]){const item=requestFor(platform,()=>({startAt,endAt,direction:'all'}));assert.deepEqual(item.days,[date]);assert.equal(validate(response(item.request,[row(date),row(date,'withdraw')],{platform}),item).rows.length,2);}
 const span=requestFor(platform,()=>({startAt:'2026-03-07T05:00:00Z',endAt:'2026-03-10T04:00:00Z'}));assert.deepEqual(span.days,['2026-03-07','2026-03-08','2026-03-09']);
});

test('ensure does not restart a paused same-scope query until an explicit retry',async()=>{
 const h=harness(),late=deferred();h.handler(()=>late.promise);const loading=h.ui.ensure();h.ui.cancel();const calls=h.calls.length;await h.ui.ensure();assert.equal(h.calls.length,calls);assert.equal(h.ui.state.status,'paused');late.resolve(response(h.calls[0]));await loading;h.handler(q=>response(q));await h.ui.load();assert.equal(h.calls.length,calls+1);assert.equal(h.ui.state.status,'ready');
});


const dailyResponse=(q,platform=p(q.platformId))=>response(q,requestFor(platform,()=>q).days.flatMap(date=>(q.direction==='all'?['charge','withdraw']:[q.direction]).map(direction=>row(date,direction))),{platform});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('multi-day timeout retries whole local days exactly once, preserving first/last partial days and provider union',async()=>{
 const h=harness();h.L.from='2026-09-26T05:00:00';h.L.to='2026-09-28T11:00:00';h.L.multi.provider=['Synthetic A Pay','Synthetic B Pay'];h.query({startAt:'2026-09-25T23:30:00Z',endAt:'2026-09-28T05:30:01Z'});
 h.handler(q=>{if(Date.parse(q.endAt)-Date.parse(q.startAt)>86400000)throw Object.assign(Error('Synthetic database timeout'),{code:'57014'});return dailyResponse(q)});
 await h.ui.ensure();assert.equal(h.ui.state.status,'ready');assert.equal(h.ui.state.results.length,1);assert.equal(h.calls.length,4);assert.deepEqual(h.calls.slice(1).map(q=>[q.startAt,q.endAt]),[['2026-09-25T23:30:00.000Z','2026-09-26T18:30:00.000Z'],['2026-09-26T18:30:00.000Z','2026-09-27T18:30:00.000Z'],['2026-09-27T18:30:00.000Z','2026-09-28T05:30:01.000Z']]);assert(h.calls.every(q=>q.providers.length===2));assert.match(h.ui.metric('charge'),/36 \/ 27/);assert.equal(h.ui.state.results[0].rows.length,6);assert.equal(new Set(h.ui.state.results[0].rows.map(r=>r.date+'|'+r.direction)).size,6);
});

test('daily fallback boundaries use calendar days across DST, with no UTC 24-hour drift',()=>{
 const platform=p(A,{timezone:'America/New_York'});
 for(const [startAt,endAt,lengths]of [['2026-03-07T05:00:00Z','2026-03-10T04:00:00Z',[24,23,24]],['2026-10-31T04:00:00Z','2026-11-03T05:00:00Z',[24,25,24]]]){
  const item=requestFor(platform,()=>({startAt,endAt,direction:'all'})),parts=dailySlices(item);assert.deepEqual(parts.map(p=>(Date.parse(p.request.endAt)-Date.parse(p.request.startAt))/3600000),lengths);assert.equal(Date.parse(parts[0].request.startAt),Date.parse(startAt));assert.equal(Date.parse(parts.at(-1).request.endAt),Date.parse(endAt));
  parts.forEach((part,i)=>{assert.deepEqual(requestFor(platform,()=>part.request).days,part.days);if(i)assert.equal(parts[i-1].request.endAt,part.request.startAt);});
 }
});

test('a failed fallback day excludes that entire platform, keeps other complete platforms as partial, and never splits into hours',async()=>{
 const h=harness();h.select([p(),p(B)]);h.L.to='2026-09-28T23:59:59';h.query({endAt:'2026-09-28T18:30:00Z'});
 h.handler(q=>{if(q.platformId===A&&Date.parse(q.endAt)-Date.parse(q.startAt)>86400000)throw Error('读取超时');if(q.platformId===A&&q.startAt==='2026-09-26T18:30:00.000Z')throw Error('Synthetic day timeout');return dailyResponse(q)});
 await h.ui.ensure();assert.equal(h.ui.state.status,'ready');assert.equal(h.ui.state.results.length,1);assert.equal(h.ui.state.results[0].platform.id,B);assert.equal(h.calls.filter(q=>q.platformId===A).length,3);assert.match(h.ui.metric('charge'),/36 \/ 27/);assert.match(h.ui.metric('charge'),/读取 1 \/ 2 平台.*部分数据/);h.ui.details();assert.match(h.drawers[0].body,/1\/3 天已读取，平台未计入合计/);
});

test('fallback retries only timeout errors over multiple days, never a single day or invalid response',async()=>{
 for(const [multiple,message]of [[false,'Synthetic timeout'],[true,'permission denied']]){const h=harness();if(multiple){h.L.to='2026-09-27T23:59:59';h.query({endAt:'2026-09-27T18:30:00Z'});}h.handler(()=>{throw Error(message)});await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.state.status,'error');}
 const h=harness();h.L.to='2026-09-27T23:59:59';h.query({endAt:'2026-09-27T18:30:00Z'});h.handler(q=>response(q));await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.state.status,'error');
});

test('all platforms and fallback days share a maximum of two active requests',async()=>{
 const h=harness(),C='33333333-3333-4333-8333-333333333333';h.select([p(),p(B),p(C)]);h.L.to='2026-09-28T23:59:59';h.query({endAt:'2026-09-28T18:30:00Z'});let active=0,maximum=0;
 h.handler(async q=>{active++;maximum=Math.max(maximum,active);try{await tick();if(Date.parse(q.endAt)-Date.parse(q.startAt)>86400000)throw Error('Synthetic timeout');return dailyResponse(q)}finally{active--;}});
 await h.ui.ensure();assert.equal(maximum,2);assert.equal(h.calls.length,12);assert.equal(h.ui.state.results.length,3);assert.match(h.ui.metric('charge'),/108 \/ 81/);
});

test('cancelled old requests cannot trigger fallback, and new scopes also honor the same two-request limit',async()=>{
 const h=harness(),oldA=deferred(),oldB=deferred();h.select([p(),p(B)]);h.L.to='2026-09-27T23:59:59';h.query({endAt:'2026-09-27T18:30:00Z'});h.handler(q=>q.platformId===A?oldA.promise:oldB.promise);const first=h.ui.ensure();assert.equal(h.calls.length,2);h.ui.cancel();h.L.multi.provider=['New Scope'];h.handler(q=>dailyResponse(q));const next=h.ui.ensure();await tick();assert.equal(h.calls.length,2,'new scope waits for outstanding old transport slots');oldA.resolve(dailyResponse(h.calls[0]));oldB.resolve(dailyResponse(h.calls[1]));await Promise.all([first,next]);assert.equal(h.calls.length,4);assert.equal(h.ui.state.results.length,2);assert.match(h.ui.metric('charge'),/48 \/ 36/);assert(h.calls.slice(2).every(q=>q.providers[0]==='New Scope'));
});


const frequencyRow=(date='2026-09-26',values={})=>row(date,'withdraw',{created_members_ge2:7,created_members_ge3:5,created_members_ge4:4,created_members_ge5:1,success_members_ge2:6,success_members_ge3:4,success_members_ge4:2,success_members_ge5:1,...values});
function frequencyResponse(q,rows){const result=response(q,rows);result.capabilities.frequencyBasis='per_platform_local_day_order_count';result.capabilities.frequencyThresholds=[2,3,4,5];return result;}

test('withdraw frequency uses a separate tab, defaults to successful withdrawals, and never adds cumulative thresholds',async()=>{
 const h=harness();h.handler(q=>frequencyResponse(q,[row('2026-09-26'),frequencyRow()]));await h.ui.ensure();h.ui.details();let body=h.drawers.at(-1).body;assert.match(body,/提款频次/);assert.equal((body.match(/<th>/g)||[]).length,6,'original member table keeps six columns');
 h.ui.details('frequency');body=h.drawers.at(-1).body;assert.match(body,/<th>成功提款人数<\/th>/);assert.match(body,/<td>6<\/td><td>4<\/td><td>2<\/td><td>1<\/td>/);assert.match(body,/互相包含，不能相加/);assert.equal((body.match(/<th>/g)||[]).length,7);assert.match(body,/liveMemberCountsDetails\('frequency','created'\)/);
 h.ui.details('frequency','created');body=h.drawers.at(-1).body;assert.match(body,/<th>创建提款人数<\/th>/);assert.match(body,/<td>7<\/td><td>5<\/td><td>4<\/td><td>1<\/td>/);assert.match(body,/按平台当地日及会员 ID 统计所选时间内的创建提款次数/);
});

test('old server responses keep normal member counts available while frequency alone reports not connected',async()=>{
 const h=harness();await h.ui.ensure();assert.equal(h.ui.state.status,'ready');assert.match(h.ui.metric('withdraw'),/12 \/ 9/);h.ui.details('frequency');const body=h.drawers.at(-1).body;assert.match(body,/尚未接入频次统计/);assert.match(body,/频次已提供 0 \/ 1 个平台日.*部分数据/);assert.match(body,/<td>—<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/);
});

test('frequency validates integer cumulative gates against known member counts without hiding valid general counts',async()=>{
 const h=harness();for(const values of [{success_members_ge2:-1},{success_members_ge2:1.5},{success_members_ge2:10},{success_members_ge3:7},{success_members_ge4:undefined},{success_members_ge5:null}]){h.handler(q=>frequencyResponse(q,[row('2026-09-26'),frequencyRow('2026-09-26',values)]));await h.ui.load();assert.equal(h.ui.state.status,'ready');assert.match(h.ui.metric('withdraw'),/12 \/ 9/);h.ui.details('frequency');assert.match(h.drawers.at(-1).body,/频次数据待核对/);assert.match(h.drawers.at(-1).body,/频次已提供 0 \/ 1/);}
});

test('frequency coverage excludes missing IDs and never treats all-unidentified withdrawals as zero people',async()=>{
 const h=harness();h.handler(q=>frequencyResponse(q,[row('2026-09-26'),frequencyRow('2026-09-26',{success_member_count:0,success_missing_member_count:15,success_members_ge2:0,success_members_ge3:0,success_members_ge4:0,success_members_ge5:0})]));await h.ui.ensure();h.ui.details('frequency');let body=h.drawers.at(-1).body;assert.match(body,/15 笔未提供会员 ID/);assert.match(body,/部分数据/);assert.match(body,/<td>—<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/);
 h.handler(q=>frequencyResponse(q,[row('2026-09-26'),frequencyRow('2026-09-26',{success_missing_member_count:3})]));await h.ui.load();h.ui.details('frequency');body=h.drawers.at(-1).body;assert.match(body,/已知人数；3 笔未提供会员 ID/);assert.match(body,/<td>6<small class="cell-sub">已知<\/small><\/td>/);
});

test('whole-day timeout fallback preserves frequency fields but never sums different days into a daily row',async()=>{
 const h=harness();h.L.to='2026-09-27T23:59:59';h.query({endAt:'2026-09-27T18:30:00Z'});h.handler(q=>{if(Date.parse(q.endAt)-Date.parse(q.startAt)>86400000)throw Error('Synthetic timeout');const date=requestFor(p(),()=>q).days[0];return frequencyResponse(q,[row(date),frequencyRow(date)])});await h.ui.ensure();assert.equal(h.ui.state.results[0].frequencySupported,true);h.ui.details('frequency');const body=h.drawers.at(-1).body;assert.match(body,/频次已提供 2 \/ 2 个平台日/);assert.equal((body.match(/<td>6<\/td><td>4<\/td><td>2<\/td><td>1<\/td>/g)||[]).length,2);assert.doesNotMatch(body,/<td>12<\/td><td>8<\/td><td>4<\/td><td>2<\/td>/);
});


test('platform metrics expose successful daily members by exact ID without any extra requests',async()=>{
 const h=harness();h.select([p(A,{name:'Same Name'}),p(B,{name:'Same Name'})]);h.handler(q=>response(q,[row('2026-09-26','charge',{success_member_count:q.platformId===A?9:2}),row('2026-09-26','withdraw',{success_member_count:q.platformId===A?4:1})]));await h.ui.ensure();const calls=h.calls.length;
 assert.equal(h.ui.platformMetric(A,'charge').value,9);assert.equal(h.ui.platformMetric(B,'charge').value,2);assert.equal(h.ui.platformMetric(A,'withdraw').value,4);assert.equal(h.ui.platformMetric('Same Name','charge').value,null);
 assert.equal(h.ui.platformMetric([A,B,A],'charge').value,11);assert.equal(h.ui.platformMetric([A,B,A],'charge').coverage.expectedPlatforms,2);assert.match(h.ui.platformCount(A,'charge'),/>9<\/span>/);assert.equal(h.ui.platformLabel('charge'),'实际充值人数');assert.equal(h.ui.platformLabel('withdraw'),'实际取款人数');assert.match(h.ui.platformMetric(A,'charge').title,/按成功时间.*当地日.*跨三方只计一次/);assert.equal(h.calls.length,calls);
});

test('platform cell and totals preserve missing, failed, unsupported and zero coverage independently',async()=>{
 const h=harness();h.select([p(),p(B),p('report:C',{reportOnly:true})]);h.handler(q=>{if(q.platformId===B)throw Error('<missing platform>');return response(q,[row('2026-09-26','charge',{success_missing_member_count:2}),row('2026-09-26','withdraw',zero())])});await h.ui.ensure();
 assert.equal(h.ui.platformMetric(A,'charge').value,9);assert.equal(h.ui.platformMetric(A,'charge').coverage.missingMemberOrderCount,2);assert.match(h.ui.platformCount(A,'charge'),/9<sup.*部分数据/);assert.match(h.ui.platformCount(B,'charge'),/>—<\/span>/);assert.match(h.ui.platformCount('report:C','charge'),/尚未接入/);assert.match(h.ui.platformCount(B,'charge'),/&lt;missing platform&gt;/);assert.equal(h.ui.platformMetric(A,'withdraw').value,0);
 const total=h.ui.platformMetric([A,B,'report:C',undefined],'charge');assert.equal(total.value,9);assert.equal(total.coverage.expectedPlatforms,4);assert.equal(total.partial,true);assert.equal(h.ui.platformMetric([A,B],'withdraw').value,null,'a failed platform prevents false total zero');
 h.handler(q=>response(q,[row('2026-09-26','charge',{success_member_count:0,success_missing_member_count:15}),row('2026-09-26','withdraw',zero())]));h.select([p()]);await h.ui.load();assert.equal(h.ui.platformMetric(A,'charge').value,null);assert.match(h.ui.platformCount(A,'charge'),/>—<\/span>/);
});

test('platform people become daily visits over multiple days; stale and hidden directions never reuse counts',async()=>{
 const h=harness();h.L.to='2026-09-27T23:59:59';h.query({endAt:'2026-09-27T18:30:00Z'});h.handler(q=>response(q,[row('2026-09-26'),row('2026-09-26','withdraw'),row('2026-09-27'),row('2026-09-27','withdraw')]));await h.ui.ensure();assert.equal(h.ui.platformMetric(A,'charge').value,18);assert.equal(h.ui.platformLabel('charge'),'实际充值人次');assert.match(h.ui.platformMetric(A,'charge').title,/每日去重人次之和，不是整个期间去重人数/);
 h.L.dirty=true;assert.equal(h.ui.platformMetric(A,'charge').value,null);h.L.dirty=false;h.L.multi.provider=['Changed'];assert.equal(h.ui.platformMetric(A,'charge').value,null);
 h.L.direction='withdraw';h.handler(q=>response(q,[row('2026-09-26','withdraw'),row('2026-09-27','withdraw')]));await h.ui.ensure();assert.equal(h.ui.platformMetric(A,'withdraw').value,18);assert.equal(h.ui.platformMetric(A,'charge').value,null);
});
