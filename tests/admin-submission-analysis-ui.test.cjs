const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../admin-preview/live-submission-analysis.js');
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const platform=(id='a',source='ar')=>({id,name:'Synthetic '+id,source,currency:'INR',timezone:'Asia/Kolkata'});
const metric=(provider,t=30,n=2,count=70)=>({provider,threshold:t,member_count:n,member_days:n+1,invalid_count:count,l0_members:1,new_members:1,funded_members:1,unknown_members:0});
function response(q,more={}){return {platform:platform(q.platformId),startAt:q.startAt,endAt:q.endAt,basis:'platform_local_day_all_providers_zero_success',metrics:[10,20,30,50,100].flatMap(t=>[metric(null,t),metric('Pay A',t),metric('Pay B',t)]),coverage:{orderCount:200,missingMemberCount:0,missingLevelCount:0},...more};}
function harness(){const L={country:'印度',from:'2026-09-01T00:00:00',to:'2026-09-30T23:59:59',dirty:false},calls=[],drawers=[];let platforms=[platform()],handler=q=>response(q);const ui=create({L,E,C:n=>String(n),N:n=>String(n),selected:()=>platforms,query:p=>({startAt:'2026-09-01T00:00:00Z',endAt:'2026-09-30T00:00:00Z',status:'all',providers:['Pay A','Pay B']}),request:q=>{calls.push(q);return Promise.resolve(handler(q))},render(){},box:(title,body)=>'<h2>'+title+'</h2>'+body,table:(headers,rows)=>rows.map(row=>row.join(' ')).join('\n'),open:(title,body)=>drawers.push({title,body})});return {L,ui,calls,drawers,select:x=>platforms=x,handler:x=>handler=x};}
test('whole period platform totals use independently deduplicated IDs, never sum provider member counts',async()=>{
 const h=harness();await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.metric().member_count,2);assert.equal(h.ui.metric('Pay A').member_count,2);assert.equal(h.ui.metric('Pay B').member_count,2);assert.match(h.ui.render(),/同平台 ID 在所选期间去重/);await h.ui.ensure();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].providers,['Pay A','Pay B']);
});
test('adjusted rate preserves original numerator and subtracts invalid submissions exactly once',async()=>{
 const h=harness();await h.ui.ensure();assert.match(h.ui.providerCell('Pay A',['a'],'rate',65,200),/>50.00%/);assert.match(h.ui.providerCell('Pay A',['a'],'members',65,200),/>2</);assert.match(h.ui.providerCell('Pay A',['a'],'count',65,200),/>70</);assert.equal(h.ui.providerCell('Pay A',['a'],'rate',0,70),'—');
});
test('missing platform/member coverage cannot silently improve success rate',async()=>{
 const h=harness();h.select([platform(),platform('b','kp')]);await h.ui.ensure();assert.equal(h.ui.metric().complete,false);assert.match(h.ui.providerCell(null,null,'rate',65,200),/>—</);assert.match(h.ui.note(),/暂无此统计/);
 h.select([platform()]);h.handler(q=>response(q,{coverage:{missingMemberCount:3,missingLevelCount:100}}));await h.ui.load();assert.equal(h.ui.metric().complete,false);assert.match(h.ui.note(),/等级未提供/);
});
test('member detail request retains authorized scope and threshold and renders precise IDs safely',async()=>{
 const h=harness();await h.ui.ensure();h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'<Synthetic ID>',member_level:'L0',submitted_count:40,selected_count:20,submitted_amount:'2000',providers:['Pay A']}]}));await h.ui.members(0,'Pay A',30,'new');const q=h.calls.at(-1);assert.equal(q.operation,'members');assert.equal(q.platformId,'a');assert.deepEqual(q.providers,['Pay A']);assert.equal(q.threshold,30);assert.equal(q.level,'new');assert.match(h.drawers.at(-1).body,/&lt;Synthetic ID&gt;/);assert.doesNotMatch(h.drawers.at(-1).body,/<Synthetic ID>/);
});
test('late responses after filter changes are discarded',async()=>{
 const h=harness();let resolve;h.handler(q=>new Promise(r=>resolve=()=>r(response(q))));const loading=h.ui.ensure();h.L.dirty=true;h.ui.cancel();resolve();await loading;assert.equal(h.ui.metric().available,false);assert.doesNotMatch(h.ui.render(),/Synthetic a/);
});
test('shared order lanes read each platform once and retry only failed platforms',async()=>{
 const h=harness();h.select([platform(),platform('b')]);let fail=true;h.handler(q=>{if(q.platformId==='b'&&fail)throw Error('timed out');return response(q)});
 const batch=h.ui.startWithOrders();assert.equal(h.calls.length,0);await batch.read('a');await batch.read('a');await batch.read('b');batch.finish();assert.equal(h.calls.length,2);assert.equal(h.ui.metric().complete,false);assert.match(h.ui.note(true),/重试未完成/);assert.doesNotMatch(h.ui.note(true),/等级未提供/);
 fail=false;await h.ui.ensure(true,true);assert.deepEqual(h.calls.map(x=>x.platformId),['a','b','b']);assert.equal(h.ui.metric().complete,true);assert.equal(h.ui.note(true),'');
});
function chartResponse(q){const metrics=[10,20,30,50,100].flatMap(t=>[null,'Pay A'].map(provider=>({...metric(provider,t,t<=30?1:0,t<=30?30:0),member_days:t<=30?1:0})));return response(q,{metrics,coverage:{orderCount:100,missingMemberCount:0},dashboard:{version:1,threshold:30,amountBands:q.amountBands,monitoring:[null,'Pay A'].map(provider=>({provider,order_count:100,success_count:50,invalid_count:30,order_amount:'10000',invalid_amount:'3000'})),hourly:[{provider:'Pay A',hour:10,count:30}],daily:[{day:'2026-09-28',order_count:100,invalid_count:30}],amounts:[{bucket:'band:1',count:30}],frequency:[{band:'30–49',count:1}]}})}
test('dashboard renders real aggregates, distinct frequency and drilldown without invented risk scores',async()=>{
 const h=harness();h.handler(chartResponse);await h.ui.load();const html=h.ui.render();for(const title of ['平台 × 三方刷单监控','提交次数分布','24 小时提交热力图','金额段分布','每日疑似无效提交','查看 ID'])assert(html.includes(title));assert.match(html,/71.43%/);assert.match(html,/综合评分：数据或规则未接入/);
});
test('malformed chart totals are rejected rather than improving displayed rates',async()=>{
 const h=harness();h.handler(q=>{const r=chartResponse(q);r.dashboard.hourly[0].count=29;return r});await h.ui.load();assert.equal(h.ui.metric().available,false);assert.match(h.ui.note(),/图表响应不完整/);
});
test('unknown order status suppresses adjusted dashboard rate',async()=>{
 const h=harness();h.handler(q=>{const r=chartResponse(q);r.coverage.unknownStatusCount=1;return r});await h.ui.load();assert.doesNotMatch(h.ui.render(),/71.43%/);
});
