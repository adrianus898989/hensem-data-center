const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../admin-preview/live-submission-analysis.js');
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const platform=(id='a',source='ar')=>({id,name:'Synthetic '+id,source,currency:'INR',timezone:'Asia/Kolkata'});
const metric=(provider,t=30,n=2,count=70)=>({provider,threshold:t,member_count:n,member_days:n+1,invalid_count:count,l0_members:1,new_members:1,funded_members:1,unknown_members:0});
function response(q,more={}){return {platform:platform(q.platformId),startAt:q.startAt,endAt:q.endAt,basis:'platform_local_day_all_providers_zero_success',metrics:[10,15,20,30,50,100].flatMap(t=>[metric(null,t),metric('Pay A',t),metric('Pay B',t)]),coverage:{orderCount:200,missingMemberCount:0,missingLevelCount:0},...more};}
function harness(){const L={country:'印度',from:'2026-09-01T00:00:00',to:'2026-09-30T23:59:59',dirty:false},calls=[],drawers=[],tables=[];let platforms=[platform()],handler=q=>response(q);const ui=create({L,E,C:n=>String(n),N:n=>String(n),selected:()=>platforms,query:p=>({startAt:'2026-09-01T00:00:00Z',endAt:'2026-09-30T00:00:00Z',status:'all',providers:['Pay A','Pay B']}),request:q=>{calls.push(q);return Promise.resolve(handler(q))},render(){},box:(title,body)=>'<h2>'+title+'</h2>'+body,table:(headers,rows,classes)=>{tables.push({headers,rows,classes});return rows.map(row=>row.join(' ')).join('\n')},open:(title,body)=>drawers.push({title,body})});return {L,ui,calls,drawers,tables,select:x=>platforms=x,handler:x=>handler=x};}
test('whole period platform totals use independently deduplicated IDs, never sum provider member counts',async()=>{
 const h=harness();await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.metric().member_count,2);assert.equal(h.ui.metric('Pay A').member_count,2);assert.equal(h.ui.metric('Pay B').member_count,2);assert.match(h.ui.providerCell('Pay A',['a'],'members',65,200),/同平台 ID 在所选期间去重/);await h.ui.ensure();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].providers,['Pay A','Pay B']);
});
test('adjusted rate preserves original numerator and subtracts invalid submissions exactly once',async()=>{
 const h=harness();await h.ui.ensure();assert.match(h.ui.providerCell('Pay A',['a'],'rate',65,200),/>50.00%/);assert.match(h.ui.providerCell('Pay A',['a'],'members',65,200),/>2</);assert.match(h.ui.providerCell('Pay A',['a'],'count',65,200),/>70</);assert.equal(h.ui.providerCell('Pay A',['a'],'rate',0,70),'—');
});
test('missing platform/member coverage cannot silently improve success rate',async()=>{
 const h=harness();h.select([platform(),platform('b','kp')]);await h.ui.ensure();assert.equal(h.ui.metric().complete,false);assert.match(h.ui.providerCell(null,null,'rate',65,200),/>—</);global.liveSubmissionCoverage();assert.match(h.drawers.at(-1).body,/暂无此统计/);
 h.select([platform()]);h.handler(q=>response(q,{coverage:{missingMemberCount:3,missingLevelCount:100}}));await h.ui.load();assert.equal(h.ui.metric().complete,false);assert.match(h.ui.note(),/查看原因/);global.liveSubmissionCoverage();assert.match(h.drawers.at(-1).body,/Synthetic a 0|Synthetic a — 100/);
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
function chartResponse(q){const metrics=[10,15,20,30,50,100].flatMap(t=>[null,'Pay A'].map(provider=>({...metric(provider,t,t<=30?1:0,t<=30?30:0),member_days:t<=30?1:0})));return response(q,{metrics,coverage:{orderCount:100,missingMemberCount:0},dashboard:{version:1,threshold:15,amountBands:q.amountBands,monitoring:[null,'Pay A'].map(provider=>({provider,order_count:100,success_count:50,invalid_count:30,order_amount:'10000',invalid_amount:'3000'})),hourly:[{provider:'Pay A',hour:10,count:30}],daily:[{day:'2026-09-28',order_count:100,invalid_count:30}],amounts:[{bucket:'band:1',count:30}],frequency:[{band:'30–49',count:1}]}})}
test('dashboard renders real aggregates, distinct frequency and drilldown without invented risk scores',async()=>{
 const h=harness();h.handler(chartResponse);await h.ui.load();const html=h.ui.render();for(const title of ['平台 × 三方刷单监控','提交次数分布','24 小时提交热力图','金额段分布','每日疑似无效提交','查看 ID'])assert(html.includes(title));assert.match(html,/71.43%/);assert.match(html,/综合评分：数据或规则未接入/);
});
test('malformed chart totals are rejected rather than improving displayed rates',async()=>{
 const h=harness();h.handler(q=>{const r=chartResponse(q);r.dashboard.hourly[0].count=29;return r});await h.ui.load();assert.equal(h.ui.metric().available,false);global.liveSubmissionCoverage();assert.match(h.drawers.at(-1).body,/图表响应不完整/);
});
test('unknown order status suppresses adjusted dashboard rate',async()=>{
 const h=harness();h.handler(q=>{const r=chartResponse(q);r.coverage.unknownStatusCount=1;return r});await h.ui.load();assert.doesNotMatch(h.ui.render(),/71.43%/);
});
test('coverage messages identify the blocking platform, field and count; recovery restores all cells',async()=>{
 const h=harness();h.select([platform(),platform('b')]);h.handler(q=>response(q,{coverage:{missingMemberCount:q.platformId==='b'?2:0,unknownStatusCount:q.platformId==='b'?467:0}}));await h.ui.load();
 const note=h.ui.note(true);assert.match(note,/Synthetic b：2 笔缺会员 ID、467 笔状态未识别/);assert.doesNotMatch(note,/部分订单缺少 ID 或状态/);
 assert.match(h.ui.providerCell('Pay A',['a','b'],'rate',130,400),/Synthetic b：2 笔缺会员 ID、467 笔状态未识别/);assert.match(h.ui.providerCell('Pay A',['a'],'rate',65,200),/>50.00%/);
 h.handler(q=>response(q));await h.ui.load();assert.equal(h.ui.note(true),'');assert.match(h.ui.providerCell('Pay A',['a','b'],'count',130,400),/>140</);assert.match(h.ui.providerCell('Pay A',['a','b'],'rate',130,400),/>50.00%/);
});
test('coverage diagnostics escape platform names',async()=>{
 const h=harness();h.handler(q=>response(q,{platform:{...platform(q.platformId),name:'<img src=x>'},coverage:{unknownStatusCount:1}}));await h.ui.load();assert.match(h.ui.note(true),/&lt;img src=x&gt;/);assert.doesNotMatch(h.ui.note(true),/<img/);
});

test('summary, default drilldown, dashboard and adjusted rate all use the 15 cohort',async()=>{
 const h=harness();h.handler(q=>response(q,{metrics:[10,15,20,30,50,100].flatMap(t=>[metric(null,t,t<=15?4:2,t<=15?80:70),metric('Pay A',t,t<=15?4:2,t<=15?80:70)])}));
 await h.ui.ensure();assert.equal(h.calls[0].threshold,15);assert.equal(h.ui.metric().invalid_count,80);assert.equal(h.ui.metric().member_count,4);assert.match(h.ui.providerCell('Pay A',['a'],'rate',60,200),/>50.00%/);assert.match(h.ui.render(),/无效笔数（≥15）/);assert.match(h.ui.render(),/≥30 笔人数/);
 h.handler(q=>response(q,{total:0,members:0,rows:[]}));await h.ui.members(0);assert.equal(h.calls.at(-1).threshold,15);assert.match(h.drawers.at(-1).title,/≥15 笔会员/);
 h.handler(chartResponse);await h.ui.load();assert.match(h.ui.render(),/单日 ≥15 笔且无成功充值/);assert.doesNotMatch(h.ui.render(),/≥30 笔且无成功充值/);
});

test('resuming paused submission statistics retains completed platforms',async()=>{
 const h=harness();h.select([platform(),platform('b')]);const batch=h.ui.startWithOrders();await batch.read('a');const saved=h.ui.capture();h.ui.cancel();h.ui.restore(saved);await h.ui.ensure();
 assert.deepEqual(h.calls.map(x=>x.platformId),['a','b']);assert.equal(h.ui.metric().complete,true);
});

const thresholdTable=html=>html.split('<table aria-label="各平台刷单门槛统计">')[1].split('</table>')[0];
const monitoringTable=html=>html.split('<table aria-label="平台与三方刷单监控">')[1].split('</table>')[0];
test('platforms start collapsed; opening one group is local and does not sum provider member counts',async()=>{
 const h=harness();h.select([platform(),platform('b')]);await h.ui.load();const calls=h.calls.length;
 let table=thresholdTable(h.ui.render());assert.doesNotMatch(table,/Pay A|Pay B/);assert.equal((table.match(/class="submission-platform"/g)||[]).length,2);
 global.liveSubmissionToggle(0,'thresholds');table=thresholdTable(h.ui.render());assert.equal((table.match(/class="submission-provider"/g)||[]).length,2);assert.match(table,/aria-expanded="true"/);assert.equal(h.ui.metric().member_count,4);assert.equal(h.calls.length,calls);
 const saved=h.ui.capture();h.ui.restore(saved);assert.match(thresholdTable(h.ui.render()),/Pay A/);
 global.liveSubmissionToggle(0,'thresholds');assert.doesNotMatch(thresholdTable(h.ui.render()),/Pay A/);
 global.liveSubmissionToggle(99,'thresholds');global.liveSubmissionToggle(0,'invalid');assert.equal(h.calls.length,calls);
});
test('monitor and threshold expansion are independent and preserve platform aggregate success rates',async()=>{
 const h=harness();h.handler(chartResponse);await h.ui.load();let html=h.ui.render();assert.doesNotMatch(monitoringTable(html),/Pay A/);assert.match(monitoringTable(html),/71.43%/);
 const calls=h.calls.length;global.liveSubmissionToggle(0,'monitoring');html=h.ui.render();assert.match(monitoringTable(html),/Pay A/);assert.doesNotMatch(thresholdTable(html),/Pay A/);assert.equal(h.calls.length,calls);
 await h.ui.load();assert.doesNotMatch(monitoringTable(h.ui.render()),/Pay A/);assert.doesNotMatch(h.ui.render(),/汇总按单日 ≥15 笔判断/);
});
test('missing recharge history is distinct from failed order statistics; diagnostics do not query again',async()=>{
 const h=harness();h.handler(q=>response(q,{coverage:{orderCount:200,missingRechargeCount:200},metrics:[10,15,20,30,50,100].map(t=>({...metric(null,t),new_members:0,funded_members:0,unknown_members:2}))}));await h.ui.load();
 assert.equal(h.ui.metric().complete,true);assert.match(h.ui.note(),/2 个 ID 充值历史待补/);assert.doesNotMatch(h.ui.note(),/200 笔充值次数未提供/);assert.match(h.ui.providerCell(null,['a'],'rate',65,200),/>50.00%/);
 const calls=h.calls.length;global.liveSubmissionCoverage();assert.equal(h.calls.length,calls);assert.match(h.drawers.at(-1).body,/Synthetic a 200 0 200 2 已计算/);
});
test('explicit requery refreshes completed platforms after backfill instead of silently retaining old coverage',async()=>{
 const h=harness();let fixed=false;h.handler(q=>response(q,{coverage:{orderCount:200,missingRechargeCount:fixed?0:200}}));await h.ui.load();assert.match(h.ui.note(),/查看原因/);
 fixed=true;await global.liveSubmissionRetry();assert.equal(h.calls.length,2);assert.doesNotMatch(h.ui.note(),/查看原因/);
});

test('monitoring separates platform and provider, with compact amounts and the same fold scope',async()=>{
 const h=harness();h.handler(chartResponse);await h.ui.load();global.liveSubmissionToggle(0,'monitoring');const table=monitoringTable(h.ui.render());
 assert.match(table,/<th>平台<\/th><th>三方<\/th>/);assert.match(table,/<td>Synthetic a<\/td><td>所选三方合计<\/td>/);assert.match(table,/<td>Synthetic a<\/td><td>Pay A<\/td>/);assert.doesNotMatch(table,/INR|<small>/);
 assert.match(table,/<td class="risk-invalid-count">30<\/td>/);assert.match(table,/<td class="risk-invalid-share">30.00%<\/td>/);
});
test('member amounts distinguish the whole platform day from the selected provider',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'Synthetic',submitted_count:49,platform_day_amount:'12340',selected_count:1,submitted_amount:'100',providers:['Pay A']}]}));
 await h.ui.members(0,'Pay A');const t=h.tables.at(-1);assert.equal(t.classes,'submission-members-table');assert.deepEqual(t.headers.slice(5,9),['该平台当日提交','平台当日总金额','所选三方提交','所选三方金额']);assert.deepEqual(t.rows[0].slice(5,9),['49','12340','1','100']);
 h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'Synthetic',submitted_count:49,selected_count:1,submitted_amount:null,providers:[]}]}));await h.ui.members(0);assert.deepEqual(h.tables.at(-1).rows[0].slice(5,9),['49','—','1','—']);
});
test('closing the member modal discards in-flight results and clears pagination',async()=>{
 const h=harness();await h.ui.load();let finish;h.handler(q=>new Promise(resolve=>finish=()=>resolve(response(q,{rows:[],members:0,total:0}))));const pending=h.ui.members(0);assert.equal(h.drawers.length,1);
 global.liveSubmissionMembersClose();finish();await pending;assert.equal(h.drawers.length,1);const count=h.calls.length;global.liveSubmissionMemberPage(1);assert.equal(h.calls.length,count);
});
