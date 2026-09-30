const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../admin-preview/live-submission-analysis.js');
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const platform=(id='a',source='ar')=>({id,name:'Synthetic '+id,source,currency:'INR',timezone:'Asia/Kolkata'});
const metric=(provider,t=30,n=2,count=70)=>({provider,threshold:t,qualified_member_count:n,qualified_member_days:n+1,member_count:n,member_days:n+1,invalid_count:count,l0_members:1,new_members:1,funded_members:1,unknown_members:0});
function response(q,more={}){return {platform:platform(q.platformId),startAt:q.startAt,endAt:q.endAt,version:3,basis:'platform_local_day_all_providers_zero_success_whole_day_over_threshold',exemptCount:0,thresholdComparison:'gt',metrics:[10,15,20,30,50,100].flatMap(t=>[metric(null,t),metric('Pay A',t),metric('Pay B',t)]),coverage:{orderCount:200,missingMemberCount:0,missingLevelCount:0},...more};}
function harness(){const L={country:'印度',from:'2026-09-01T00:00:00',to:'2026-09-30T23:59:59',dirty:false},calls=[],drawers=[],tables=[];let platforms=[platform()],providers=['Pay A','Pay B'],handler=q=>response(q);const ui=create({L,E,C:n=>String(n),N:n=>String(n),selected:()=>platforms,query:p=>({startAt:'2026-09-01T00:00:00Z',endAt:'2026-09-30T00:00:00Z',status:'all',providers}),request:q=>{calls.push(q);return Promise.resolve(handler(q))},render(){},box:(title,body)=>'<h2>'+title+'</h2>'+body,table:(headers,rows,classes)=>{tables.push({headers,rows,classes});return rows.map(row=>row.join(' ')).join('\n')},open:(title,body)=>drawers.push({title,body})});return {L,ui,calls,drawers,tables,select:x=>platforms=x,setProviders:x=>providers=x,handler:x=>handler=x};}
test('WG never enters submission calculations without recharge member IDs and exposes the concrete gap',async()=>{
 const h=harness();h.select([platform('wg-only','wg')]);await h.ui.ensure();assert.equal(h.calls.length,0);assert.equal(h.ui.metric().available,false);
 for(const compact of [false,true])assert.match(h.ui.note(compact),/WG充值明细未提供会员ID，刷单分析不可用/);
 assert.match(h.ui.providerCell(null,['wg-only'],'rate',5,10),/WG充值明细未提供会员ID，刷单分析不可用/);global.liveSubmissionCoverage();assert.match(h.drawers.at(-1).body,/WG充值明细未提供会员ID，刷单分析不可用/);
 h.select([platform(),platform('wg-only','wg')]);await h.ui.load();assert.deepEqual(h.calls.map(q=>q.platformId),['a']);assert.equal(h.ui.metric().complete,false);assert.match(h.ui.providerCell(null,null,'rate',5,10),/>—</);
});
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
 const h=harness();await h.ui.ensure();h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'<Synthetic ID>',member_level:'L0',submitted_count:40,selected_count:20,submitted_amount:'2000',platform_day_amount:'4000',invalid_count:20,invalid_amount:'2000',platform_day_invalid_count:40,platform_day_invalid_amount:'4000',providers:['Pay A']}]}));await h.ui.members(0,'Pay A',30,'new');const q=h.calls.at(-1);assert.equal(q.operation,'members');assert.equal(q.platformId,'a');assert.deepEqual(q.providers,['Pay A']);assert.equal(q.threshold,30);assert.equal(q.level,'new');assert.match(h.drawers.at(-1).body,/&lt;Synthetic ID&gt;/);assert.doesNotMatch(h.drawers.at(-1).body,/<Synthetic ID>/);
});
test('late responses after filter changes are discarded',async()=>{
 const h=harness();let resolve;h.handler(q=>new Promise(r=>resolve=()=>r(response(q))));const loading=h.ui.ensure();h.L.dirty=true;h.ui.cancel();resolve();await loading;assert.equal(h.ui.metric().available,false);assert.doesNotMatch(h.ui.render(),/Synthetic a/);
});
test('shared order lanes read each platform once and retry only failed platforms',async()=>{
 const h=harness();h.select([platform(),platform('b')]);let fail=true;h.handler(q=>{if(q.platformId==='b'&&fail)throw Error('timed out');return response(q)});
 const batch=h.ui.startWithOrders();assert.equal(h.calls.length,0);await batch.read('a');await batch.read('a');await batch.read('b');await batch.finish();assert.equal(h.calls.length,3);assert.equal(h.ui.metric().complete,false);assert.match(h.ui.note(true),/重试未完成/);assert.doesNotMatch(h.ui.note(true),/等级未提供/);
 fail=false;await h.ui.ensure(true,true);assert.deepEqual(h.calls.map(x=>x.platformId),['a','b','b','b']);assert.equal(h.ui.metric().complete,true);assert.equal(h.ui.note(true),'');
});
function chartResponse(q){const metrics=[10,15,20,30,50,100].flatMap(t=>[null,'Pay A'].map(provider=>({...metric(provider,t,t<30?1:0,t<30?30:0),member_days:t<30?1:0,qualified_member_days:t<30?1:0})));return response(q,{metrics,coverage:{orderCount:100,missingMemberCount:0},dashboard:{version:3,threshold:15,exemptCount:0,thresholdComparison:'gt',amountBands:q.amountBands,monitoring:[null,'Pay A'].map(provider=>({provider,order_count:100,success_count:50,invalid_count:30,order_amount:'10000',invalid_amount:'3000'})),hourly:[{provider:'Pay A',hour:10,count:30}],daily:[{day:'2026-09-28',order_count:100,invalid_count:30}],amounts:[{bucket:'band:1',count:30}],frequency:[{band:'30–49',count:1}]}})}
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
 await h.ui.ensure();assert.equal(h.calls[0].threshold,15);assert.equal(h.ui.metric().invalid_count,80);assert.equal(h.ui.metric().member_count,4);assert.match(h.ui.providerCell('Pay A',['a'],'rate',60,200),/>50.00%/);assert.match(h.ui.render(),/无效笔数（符合条件整日）/);assert.match(h.ui.render(),/>30 笔人数/);
 h.handler(q=>response(q,{total:0,members:0,rows:[]}));await h.ui.members(0);assert.equal(h.calls.at(-1).threshold,15);assert.match(h.drawers.at(-1).title,/超过 15 笔的无效提交会员/);
 h.handler(chartResponse);await h.ui.load();assert.match(h.ui.render(),/同平台同 ID 当日超过 15 笔且无成功，整日计无效/);assert.doesNotMatch(h.ui.render(),/≥30 笔且无成功充值/);
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
 const h=harness();await h.ui.load();h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'Synthetic',submitted_count:49,platform_day_amount:'12340',selected_count:1,submitted_amount:'100',platform_day_invalid_count:49,platform_day_invalid_amount:'12340',invalid_count:1,invalid_amount:'100',providers:['Pay A']}]}));
 await h.ui.members(0,'Pay A');const t=h.tables.at(-1);assert.equal(t.classes,'submission-members-table');assert.deepEqual(t.headers.slice(5,13),['平台当日总笔数','平台当日总金额','平台当日无效笔数','平台当日无效金额','所选三方总笔数','所选三方总金额','所选三方无效笔数','所选三方无效金额']);assert.deepEqual(t.rows[0].slice(5,13),['49','12340','49','12340','1','100','1','100']);
 h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'Synthetic',submitted_count:49,platform_day_amount:null,selected_count:1,submitted_amount:null,platform_day_invalid_count:49,platform_day_invalid_amount:null,invalid_count:1,invalid_amount:null,providers:[]}]}));await h.ui.members(0);assert.deepEqual(h.tables.at(-1).rows[0].slice(5,13),['49','—','49','—','1','—','1','—']);
});
test('closing the member modal discards in-flight results and clears pagination',async()=>{
 const h=harness();await h.ui.load();let finish;h.handler(q=>new Promise(resolve=>finish=()=>resolve(response(q,{rows:[],members:0,total:0}))));const pending=h.ui.members(0);assert.equal(h.drawers.length,1);
 global.liveSubmissionMembersClose();finish();await pending;assert.equal(h.drawers.length,1);const count=h.calls.length;global.liveSubmissionMemberPage(1);assert.equal(h.calls.length,count);
});

test('strict thresholds use the whole eligible day while any successful recharge excludes it',async()=>{
 const h=harness();for(const [submitted,success] of [[14,0],[15,0],[16,0],[20,1],[49,0],[101,0]]){
  h.handler(q=>response(q,{metrics:[10,15,20,30,50,100].flatMap(t=>[null,'Pay A'].map(provider=>{const n=submitted>t&&success===0?1:0;return {...metric(provider,t,n,n?submitted:0),member_days:n,qualified_member_count:n,qualified_member_days:n}}))}));await h.ui.load();
  for(const threshold of [10,15,20,30,50,100])assert.equal(h.ui.metric(null,null,threshold).invalid_count,submitted>threshold&&success===0?submitted:0);
  const invalid=submitted>15&&success===0?submitted:0;assert.equal(h.ui.metric().member_count,invalid?1:0);assert.match(h.ui.providerCell('Pay A',['a'],'count',success,submitted),new RegExp('>'+invalid+'<'));
 }
 const html=h.ui.render(),definition=h.ui.providerCell('Pay A',['a'],'count',0,101);assert.match(definition,/所有三方的总提交严格超过 15 笔/);assert.match(definition,/该日全部提交计无效/);assert.doesNotMatch(definition,/合并排序|第.?16笔|前 15 笔/);
 for(const threshold of [10,15,20,30,50,100]){assert(html.includes('累计提交 >'+threshold+' 笔'));assert(html.includes('累计 >'+threshold+' 笔人数'))}
});

test('threshold member counts remain distinct from the whole-day order counts and natural frequency buckets',async()=>{
 const h=harness();h.handler(chartResponse);await h.ui.load();
 assert.equal(h.ui.metric().member_count,1);assert.equal(h.ui.metric().qualified_member_count,1);assert.equal(h.ui.metric().invalid_count,30);assert.equal(h.ui.metric(null,null,30).invalid_count,0);const html=h.ui.render(),table=thresholdTable(html);
 assert.match(html,/超过门槛的会员人数，符合条件当日全部提交计无效/);assert.match(html,/统计当天超过 10 笔且无成功的会员日；按全部提交次数分档/);assert.match(html,/共 1 个会员日/);
 assert.match(table,/<td>Synthetic a<\/td><td>1<\/td><td>1<\/td><td>1<\/td><td>0<\/td>/);assert.doesNotMatch(table,/liveSubmissionMembers\(0,null,10/);
});

test('old response basis, version, exempt count and non-strict thresholds cannot populate the new exclusion metrics',async()=>{
 for(const patch of [{version:1},{version:2},{basis:'platform_local_day_all_providers_zero_success_after_first_15'},{exemptCount:15},{thresholdComparison:'gte'},{thresholdComparison:undefined}]){
  const h=harness();h.handler(q=>response(q,patch));await h.ui.load();assert.equal(h.ui.metric().available,false);global.liveSubmissionCoverage();assert.match(h.drawers.at(-1).body,/响应范围不一致/);
 }
});

test('restoring v2 or incompatible cached metrics resets to manual query without making a request',async()=>{
 const h=harness();await h.ui.load();const good=h.ui.capture(),calls=h.calls.length;
 for(const patch of [{version:2},{basis:'platform_local_day_all_providers_zero_success_after_first_15'},{exemptCount:15},{thresholdComparison:'gte'}]){
  const old=JSON.parse(JSON.stringify(good));Object.assign(old.results[0],patch);if(patch.version)old.version=patch.version;h.ui.restore(old);
  assert.equal(h.calls.length,calls);assert.equal(h.ui.metric().available,false);assert.match(h.ui.render(),/点击查询/);
 }
 h.ui.restore(good);assert.equal(h.ui.metric().invalid_count,70);
});

test('uncertain ordering identifies affected platforms and suppresses exclusion rates',async()=>{
 const h=harness();h.handler(q=>{const r=chartResponse(q);r.coverage.orderSequenceUncertainCount=16;return r});await h.ui.load();
 assert.equal(h.ui.metric().complete,false);assert.match(h.ui.note(true),/Synthetic a：16 笔提交顺序待核对/);assert.match(h.ui.providerCell('Pay A',['a'],'rate',50,100),/>—</);assert.doesNotMatch(monitoringTable(h.ui.render()),/71.43%/);
 global.liveSubmissionCoverage();assert.match(h.drawers.at(-1).body,/提交顺序待核对/);assert.match(h.drawers.at(-1).body,/计算该日全部无效提交/);
});

test('member details reject legacy contracts, partial-day counts, exact thresholds and unequal amounts',async()=>{
 const h=harness();await h.ui.load();
 for(const patch of [{version:2},{thresholdComparison:'gte'},{exemptCount:15}]){h.handler(q=>response(q,{...patch,total:0,members:0,rows:[]}));await h.ui.members(0);assert.match(h.drawers.at(-1).body,/响应范围无效/)}
 const row={submitted_count:49,selected_count:20,platform_day_invalid_count:49,invalid_count:20,platform_day_amount:'4900',platform_day_invalid_amount:'4900',submitted_amount:'2000',invalid_amount:'2000'};
 for(const patch of [{platform_day_invalid_count:34},{invalid_count:5},{submitted_count:15,selected_count:15,platform_day_invalid_count:15,invalid_count:15},{selected_count:50,invalid_count:50},{platform_day_invalid_amount:'4899'},{invalid_amount:'1999'},{platform_day_invalid_amount:null},{invalid_amount:null},{invalid_amount:''},{submitted_amount:'9007199254740992',invalid_amount:'9007199254740993'}]){
  h.handler(q=>response(q,{total:1,members:1,rows:[{...row,...patch}]}));await h.ui.members(0);assert.match(h.drawers.at(-1).body,/无效笔数明细不完整/);
 }
 for(const threshold of [10,15,20,30,50,100]){
  const count=threshold,exact={...row,submitted_count:count,selected_count:count,platform_day_invalid_count:count,invalid_count:count};
  h.handler(q=>response(q,{total:1,members:1,rows:[exact]}));await h.ui.members(0,null,threshold);assert.match(h.drawers.at(-1).body,/无效笔数明细不完整/);
  h.handler(q=>response(q,{total:1,members:1,rows:[{...exact,submitted_count:count+1,selected_count:count+1,platform_day_invalid_count:count+1,invalid_count:count+1,platform_day_invalid_amount:'04900.00',invalid_amount:'2000.000'}]}));await h.ui.members(0,null,threshold);
  assert.doesNotMatch(h.drawers.at(-1).body,/无效笔数明细不完整/);assert(h.drawers.at(-1).body.includes('总提交超过 '+threshold+' 笔'));assert(h.drawers.at(-1).title.includes('超过 '+threshold+' 笔'));
 }
});
test('a final platform timeout is retried once after the other fifteen complete',async()=>{
 const h=harness(),platforms=Array.from({length:16},(_,i)=>platform('p'+String(i).padStart(2,'0')));h.select(platforms);let failed=false;h.handler(q=>{if(q.platformId==='p15'&&!failed){failed=true;throw Error('57014 statement timeout')}return response(q)});await h.ui.ensure();
 assert.equal(h.calls.length,17);assert.equal(h.calls.at(-1).platformId,'p15');assert.equal(h.calls.filter(q=>q.platformId==='p15').length,2);assert.equal(h.ui.metric().complete,true);assert.equal(h.ui.metric().received,16);assert.equal(h.ui.note(true),'');assert(h.calls.every(q=>q.startAt==='2026-09-01T00:00:00Z'&&q.endAt==='2026-09-30T00:00:00Z'));
});
test('persistent failure retains fifteen platform counts while withholding the full adjusted rate',async()=>{
 const h=harness(),platforms=Array.from({length:16},(_,i)=>platform('p'+String(i).padStart(2,'0')));h.select(platforms);h.handler(q=>{if(q.platformId==='p15')throw Error('读取超时');return response(q)});await h.ui.ensure();
 assert.equal(h.calls.length,17);assert.equal(h.ui.metric().received,15);assert.match(h.ui.providerCell('Pay A',null,'count',975,3200),/>1050\*</);assert.match(h.ui.providerCell('Pay A',null,'members',975,3200),/>30\*</);assert.match(h.ui.providerCell('Pay A',null,'rate',975,3200),/>—</);assert.match(h.ui.providerCell('Pay A',['p00'],'rate',65,200),/>50.00%/);assert.match(h.ui.note(true),/>剔除 15\/16 · 未完成 Synthetic p15<\/button>/);assert.doesNotMatch(h.ui.note(true),/缺少.*平台/);
 await h.ui.ensure();h.ui.render();h.ui.note(true);assert.equal(h.calls.length,17,'renders and completed scope reads do not restart retries');h.handler(response);await global.liveSubmissionRetry();assert.equal(h.calls.length,18);assert.equal(h.calls.at(-1).platformId,'p15');assert.equal(h.ui.metric().complete,true);assert.match(h.ui.providerCell('Pay A',null,'count',1040,3200),/>1120</);
});
test('authentication and malformed metric failures do not trigger automatic retries',async()=>{
 for(const bad of [()=>{throw Error('没有访问权限')},q=>response(q,{version:1})]){const h=harness();h.handler(bad);await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.metric().available,false);}
});
test('cancelling before the last failure arrives prevents the automatic retry and stale merge',async()=>{
 const h=harness();h.select([platform(),platform('b')]);let release;h.handler(q=>q.platformId==='b'?new Promise((_,reject)=>{release=()=>reject(Error('timeout'))}):response(q));const run=h.ui.ensure();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.ui.metric().received,1);assert.equal(h.ui.ensure(),run);assert.equal(h.calls.length,2);
 h.ui.cancel();h.L.from='2026-08-01T00:00:00';release();await run;assert.equal(h.calls.length,2);assert.equal(h.ui.metric().available,false);
});
test('compact coverage keeps long errors and partial-count explanation out of the report body',async()=>{
 const h=harness();h.select([platform(),{...platform('b'),name:'DHANIWIN'},{...platform('c'),name:'51GAME'}]);h.handler(q=>{if(q.platformId!=='a')throw Error('读取超时，请缩短日期范围后再次查询，失败原因详情');return response(q)});await h.ui.ensure();const html=h.ui.note(true),visible=html.replace(/<[^>]*>/g,'');
 assert.equal(visible,'剔除 1/3 · 未完成 DHANIWIN 等 2 平台 重试');assert.match(html,/submission-coverage-compact/);assert.match(html,/title="[^"]*DHANIWIN：读取超时[^"]*51GAME：读取超时[^"]*\* 为已读取平台合计/);assert.match(html,/onclick="liveSubmissionCoverage\(\)"/);assert.doesNotMatch(visible,/失败原因详情|完整剔除率|51GAME/);
 const calls=h.calls.length;global.liveSubmissionCoverage();assert.equal(h.calls.length,calls);assert.match(h.drawers.at(-1).body,/DHANIWIN：读取超时/);assert.match(h.drawers.at(-1).body,/51GAME：读取超时/);assert.match(h.drawers.at(-1).body,/\* 为已读取平台合计，完整剔除率待核对/);
});
test('one synchronous table paint validates the sixteen-platform scope once for sixty metric cells',()=>{
 const platforms=Array.from({length:16},(_,i)=>platform('p'+i)),L={country:'印度',from:'2026-09-29T00:00:00',to:'2026-09-29T23:59:59',dirty:false};let calls=0;
 const ui=create({L,E,C:String,N:String,selected:()=>platforms,query:()=>{calls++;return {status:'all',startAt:'2026-09-28T18:30:00Z',endAt:'2026-09-29T18:30:00Z'}},request:()=>{throw Error('unexpected request')},render(){}});
 const paint=()=>Array.from({length:20},(_,i)=>['rate','members','count'].map(kind=>ui.providerCell('Provider '+i,platforms.map(p=>p.id),kind,50,100)));
 const before=paint();assert.equal(calls,1920,'regression reproduces per-cell scope work');calls=0;
 assert.deepEqual(ui.withSnapshot(paint),before);assert.equal(calls,16,'the table shares one synchronous scope validation');
 calls=0;ui.withSnapshot(paint);assert.equal(calls,16,'each new paint still validates fresh scope');
 calls=0;assert.throws(()=>ui.withSnapshot(()=>{throw Error('synthetic paint failure')}));ui.metric();assert.equal(calls,32,'a failed paint releases its snapshot');
});
test('render snapshots expire before date, platform or filter changes and async results',async()=>{
 const h=harness();await h.ui.load();const paint=()=>h.ui.withSnapshot(()=>h.ui.metric('Pay A'));
 assert.equal(paint().available,true);
 h.L.from='2026-08-01T00:00:00';assert.equal(paint().available,false);h.L.from='2026-09-01T00:00:00';assert.equal(paint().available,true);
 h.select([platform('different')]);assert.equal(paint().available,false);h.select([platform()]);assert.equal(paint().available,true);
 h.setProviders(['Pay A']);assert.equal(paint().available,false);h.setProviders(['Pay A','Pay B']);assert.equal(paint().available,true);
 h.L.dirty=true;assert.equal(paint().available,false);h.L.dirty=false;assert.equal(paint().available,true);
 let done;h.handler(q=>new Promise(resolve=>{done=()=>resolve(response(q))}));const pending=h.ui.load();assert.equal(paint().available,false);done();await pending;assert.equal(paint().available,true,'the next paint includes completed async work');
});
