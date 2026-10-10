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
test('member modal shows only selected-scope invalid metrics and selected first/last times in eight columns',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'Synthetic',member_level:'L0',member_class:'funded',recharge_count:999,submitted_count:49,platform_day_amount:'12340',selected_count:1,submitted_amount:'100',platform_day_invalid_count:49,platform_day_invalid_amount:'12340',invalid_count:1,invalid_amount:'100',first_at:'2026-09-28T00:00:00Z',last_at:'2026-09-28T23:59:00Z',first_invalid_at:'2026-09-28T10:00:00Z',last_invalid_at:'2026-09-28T10:30:00Z',providers:['Pay A']}]}));
 await h.ui.members(0,'Pay A');const t=h.tables.at(-1);assert.equal(t.classes,'submission-members-table');assert.deepEqual(t.headers,['日期','会员 ID','会员 / 充值等级','无效笔数','无效金额','首笔无效订单时间','末笔无效订单时间','涉及三方']);assert.deepEqual(t.rows[0],['2026-09-28','Synthetic','L0','1','100','2026-09-28 15:30:00','2026-09-28 16:00:00','Pay A']);
 const body=h.drawers.at(-1).body;assert.doesNotMatch(body,/源充值次数|12340|999/);assert.match(body,/当前所选三方：Pay A/);assert.match(body,/2026-09-01 05:30:00（含）至 2026-09-30 05:30:00（不含）/);assert.match(body,/平台时区 Asia\/Kolkata/);assert.match(body,/金额单位 INR/);assert.match(body,/全部三方总提交超过 15 笔/);assert.match(body,/当天无成功充值不等于历史未充值/);for(const filter of ['全部会员','全部 L0','未充值 L0','有充值记录','充值情况未提供'])assert(body.includes(filter));
 h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'Synthetic',submitted_count:49,platform_day_amount:null,selected_count:1,submitted_amount:null,platform_day_invalid_count:49,platform_day_invalid_amount:null,invalid_count:1,invalid_amount:null,first_at:'2026-09-28T00:00:00Z',last_at:'2026-09-28T23:59:00Z',providers:[]}]}));await h.ui.members(0);assert.deepEqual(h.tables.at(-1).rows[0].slice(3),['1','—','—','—','']);assert.match(h.drawers.at(-1).body,/当前所选三方：Pay A \/ Pay B/);
});
test('member times use the selected platform timezone and preserve safe source text',async()=>{
 const h=harness();h.handler(q=>response(q,{platform:{...platform(),timezone:'America/New_York'}}));await h.ui.load();h.handler(q=>response(q,{total:1,members:1,rows:[{day:'2026-09-28',member_id:'<Member>',member_level:'<L0>',submitted_count:16,platform_day_amount:'1600',selected_count:1,submitted_amount:'0',platform_day_invalid_count:16,platform_day_invalid_amount:'1600',invalid_count:1,invalid_amount:'0',first_invalid_at:'2026-09-28T00:00:00.123456+00:00',last_invalid_at:'2026-09-28T01:00:00+00:00',providers:['<Pay>']}]}));
 await h.ui.members(0);assert.deepEqual(h.tables.at(-1).rows[0],['2026-09-28','&lt;Member&gt;','&lt;L0&gt;','1','0','2026-09-27 20:00:00','2026-09-27 21:00:00','&lt;Pay&gt;']);assert.match(h.drawers.at(-1).body,/平台时区 America\/New_York/);assert.doesNotMatch(h.drawers.at(-1).body,/<Member>|<L0>|<Pay>/);
});
test('missing or malformed invalid-order times render placeholders and never whole-day fallback timestamps',async()=>{
 const h=harness();await h.ui.load();const row={day:'2026-09-28',member_id:'Synthetic',submitted_count:16,platform_day_amount:'1600',selected_count:1,submitted_amount:'100',platform_day_invalid_count:16,platform_day_invalid_amount:'1600',invalid_count:1,invalid_amount:'100',first_at:'2026-09-28T00:00:00Z',last_at:'2026-09-28T23:59:00Z',providers:['Pay A']};
 for(const time of [undefined,null,'','<img src=x onerror=alert(1)>','not a timestamp','2026-09-28T10:00:00','2026-02-30T10:00:00Z','2026-09-28T24:00:00Z','2026-09-28T10:00:00+24:00']){
  h.handler(q=>response(q,{total:1,members:1,rows:[{...row,first_invalid_at:time,last_invalid_at:time}]}));await h.ui.members(0);assert.deepEqual(h.tables.at(-1).rows[0].slice(5,7),['—','—']);assert.doesNotMatch(h.drawers.at(-1).body,/<img|onerror|2026-09-28 05:30:00|2026-09-29 05:29:00/);
 }
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

const streakJobs=new Map();let streakJobSequence=0;
function streakResponse(q,{count=1,complete=true,member='<Synthetic member>',rows=true}={}){
 let jobId,progress={};
 if(q.action==='submissionStreak'){
  if(q.operation==='start'){const job=[...streakJobs.values()].find(x=>x.request.clientRequestId===q.clientRequestId)||{request:{...q,operation:'streaks'},processedDays:0,totalDays:q.lookbackDays,jobId:'10000000-0000-4000-8000-'+String(++streakJobSequence).padStart(12,'0')};streakJobs.set(job.jobId,job);return {version:1,jobId:job.jobId,status:job.processedDays===job.totalDays?'complete':'pending',processedDays:job.processedDays,totalDays:q.lookbackDays,platformId:q.platformId,lookbackDays:q.lookbackDays,clientRequestId:q.clientRequestId,startAt:q.startAt,endAt:q.endAt,expiresAt:new Date(Date.now()+3600000).toISOString()};}
  const job=streakJobs.get(q.jobId);if(!job)throw Error('job_unavailable');jobId=job.jobId;
  if(q.operation==='step'){job.processedDays=Math.min(job.processedDays+1,job.totalDays);return {version:1,jobId,status:job.processedDays===job.totalDays?'complete':'pending',processedDays:job.processedDays,totalDays:job.totalDays,platformId:job.request.platformId,lookbackDays:job.request.lookbackDays,clientRequestId:job.request.clientRequestId,startAt:job.request.startAt,endAt:job.request.endAt,expiresAt:new Date(Date.now()+3600000).toISOString()};}
  progress={status:job.processedDays===job.totalDays?'complete':'pending',processedDays:job.processedDays,totalDays:job.totalDays,platformId:job.request.platformId,clientRequestId:job.request.clientRequestId,expiresAt:new Date(Date.now()+3600000).toISOString()};q={...job.request,...q,operation:q.operation==='members'?'streakMembers':'streaks'};
 }

 const streaks=[3,5,10].map(days=>{const n=days<=3?count:0,memberDays=n*3,submitted=n*30;return {days,member_count:complete?n:null,member_days:complete?memberDays:null,submitted_count:complete?submitted:null,submitted_amount:String(submitted*100),observed_member_count:n,observed_member_days:memberDays,observed_submitted_count:submitted,observed_submitted_amount:String(submitted*100)}});
 return {...progress,version:1,jobId,basis:'platform_local_complete_days_all_providers_zero_success_consecutive',operation:q.operation,platform:platform(q.platformId),startAt:q.startAt,endAt:q.endAt,lookbackDays:q.lookbackDays,threshold:10,thresholdComparison:'gte',evaluatedStartDate:'2026-08-31',evaluatedEndDate:'2026-09-29',coverage:{orderCount:200,missingMemberCount:complete?0:1,unknownStatusCount:0,orderSequenceUncertainCount:0,missingAmountCount:0,missingSuccessTimeCount:0,coveredDayCount:3,noRecordDayCount:q.lookbackDays-3,completeDayCount:q.lookbackDays,excludedPartialDayCount:0,sourceCompletenessVerified:false,calculationComplete:complete},streaks,...(q.operation==='streakMembers'?{streakDays:q.streakDays,offset:q.offset,limit:q.limit,total:count,rows:count&&rows?[{member_id:member,max_streak_days:3,start_day:'2026-09-27',end_day:'2026-09-29',qualifying_days:3,submitted_count:30,submitted_amount:'3000',providers:['Pay A','Pay B'],days:[27,28,29].map((day,i)=>({day:'2026-09-'+day,submitted_count:10,platform_submitted_count:10,submitted_amount:'1000',platform_submitted_amount:'1000',success_count:0,qualifies:true,run_days:i+1,providers:['Pay A','Pay B']}))}]:[]}:{} )};
}
const streakTable=html=>html.split('<table aria-label="连续未充值平台统计">')[1]?.split('</table>')[0]||'';

test('streak queries are explicit, use independent complete-day lookback and whitelist payload fields',async()=>{
 const h=harness();await h.ui.load();assert.equal(h.calls.length,1);assert.match(h.ui.render(),/查询连续未充值 ID/);assert.match(h.ui.render(),/连续 ≥10 天/);
 h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(30);const q=h.calls.find(q=>q.action==='submissionStreak'&&q.operation==='start');
 assert.deepEqual(Object.keys(q).sort(),['action','clientRequestId','currency','direction','endAt','lookbackDays','operation','platformId','providers','startAt'].sort());assert.equal(q.operation,'start');assert.match(q.clientRequestId,/^[a-f0-9-]{36}$/);assert.deepEqual(Object.keys(h.calls.at(-1)).sort(),['action','jobId','operation']);assert.equal(h.calls.at(-1).operation,'summary');assert.equal(q.lookbackDays,30);assert.equal(q.startAt,h.calls[0].startAt);assert.deepEqual(q.providers,['Pay A','Pay B']);
 const html=h.ui.render();assert.match(html,/最长连续天数在回看范围内计算/);assert.match(html,/未结束的今天不计/);assert.match(streakTable(html),/>1<\/button>/);assert.match(streakTable(html),/>0<\/button>/);assert.match(html,/0 仅表示已采集范围内未发现符合 ID/);
});

test('streak platform summaries are serialized and discard pending results when parent query changes',async()=>{
 const h=harness();h.select([platform(),platform('b')]);await h.ui.load();const deferred=[];h.handler(q=>new Promise(resolve=>deferred.push(()=>resolve(streakResponse(q)))));
 const loading=global.liveSubmissionStreakLoad(15);assert.equal(deferred.length,1);deferred.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(deferred.length,1);assert.equal(h.calls.filter(q=>q.action==='submissionStreak').length,2);assert.equal(h.calls.at(-1).operation,'step');
 h.L.dirty=true;h.ui.cancel();deferred.shift()();await loading;assert.doesNotMatch(h.ui.render(),/连续未充值平台统计/);
});

test('streak counts with incomplete IDs stay unavailable while known IDs are explicitly partial',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>streakResponse(q,{complete:false,count:0}));await global.liveSubmissionStreakLoad(30);
 const html=h.ui.render();assert.match(html,/完整数量未确认/);assert.match(html,/已知符合 ≥3 天 0 个 ID/);assert.doesNotMatch(streakTable(html),/>0<\/button>/);assert.match(streakTable(html),/>—<\/button>/);
 await global.liveSubmissionStreakMembers('a',3);assert.match(h.ui.render(),/已知符合 ID 0 个；完整数量待核对/);
});

test('fully calculated observed empty results display zero, while failed reads are never zero',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>streakResponse(q,{count:0}));await global.liveSubmissionStreakLoad(30);assert.match(streakTable(h.ui.render()),/>0<\/button>/);
 h.handler(()=>{throw Error('network unavailable')});await global.liveSubmissionStreakLoad(30);assert.match(h.ui.render(),/暂不能判断为 0/);assert.match(h.ui.render(),/重试未完成/);assert.equal(streakTable(h.ui.render()),'');
});

test('streak summaries reject malformed zero coercion, scope, cohort and currency values',async()=>{
 const h=harness();await h.ui.load();for(const mutate of [r=>r.threshold=15,r=>r.thresholdComparison='gt',r=>r.lookbackDays=7,r=>r.platform.id='outside',r=>r.coverage.calculationComplete=false,r=>r.streaks[0].observed_submitted_count=-1,r=>r.streaks[0].submitted_amount='not-money',r=>r.streaks[0].member_count=0,r=>r.streaks[0].observed_member_days=2]){
  h.handler(q=>{const r=streakResponse(q);if(q.operation==='summary'||q.operation==='members')mutate(r);return r});await global.liveSubmissionStreakLoad(30);assert.equal(streakTable(h.ui.render()),'');assert.match(h.ui.render(),/响应范围或数据不完整|计算进度无效/);
 }
});

test('streak members use inline evidence, escape IDs and maintain amount and count shares separately',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(30);await global.liveSubmissionStreakMembers('a',3);
 const q=h.calls.at(-1);assert.equal(q.operation,'members');assert.deepEqual(Object.keys(q).sort(),['action','operation','jobId','streakDays','offset','limit'].sort());assert.equal(q.streakDays,3);assert.equal(q.limit,20);assert.equal(q.offset,0);assert.equal(h.drawers.length,0);let html=h.ui.render();assert.match(html,/&lt;Synthetic member&gt;/);assert.doesNotMatch(html,/<Synthetic member>/);assert.match(html,/<th>笔数占比<\/th><th>金额占比<\/th>/);
 assert.doesNotMatch(html,/逐日提交证据/);global.liveSubmissionStreakExpand(0);html=h.ui.render();assert.match(html,/逐日提交证据/);assert.match(html,/<td>2026-09-27<\/td><td>10<\/td><td>1000<\/td><td>10<\/td><td>1000<\/td><td>0<\/td><td>1<\/td>/);global.liveSubmissionStreakExpand(0);assert.doesNotMatch(h.ui.render(),/逐日提交证据/);
});

test('streak members reject success, sub-threshold and inconsistent daily evidence',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(30);
 for(const mutate of [r=>r.rows[0].days[0].success_count=1,r=>r.rows[0].days[0].platform_submitted_count=9,r=>r.rows[0].submitted_count=31,r=>r.rows[0].qualifying_days=4,r=>r.rows[0].days[0].day='2026-10-01',r=>r.streakDays=5,r=>r.rows[0].max_streak_days=2]){
  h.handler(q=>{const r=streakResponse(q);if(q.operation==='summary'||q.operation==='members')mutate(r);return r});await global.liveSubmissionStreakMembers('a',3);assert.match(h.ui.render(),/响应范围或数据不完整/);assert.doesNotMatch(h.ui.render(),/逐日提交证据/);
 }
});

test('changing streak window or selected cohort invalidates old member evidence and detail responses',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(30);let finish;h.handler(q=>new Promise(resolve=>finish=()=>resolve(streakResponse(q))));const pending=global.liveSubmissionStreakMembers('a',3);
 global.liveSubmissionStreakDays(5);finish();await pending;assert.doesNotMatch(h.ui.render(),/连续未充值会员明细/);
 h.handler(q=>streakResponse(q));await global.liveSubmissionStreakMembers('a',3);assert.match(h.ui.render(),/连续未充值会员明细/);await global.liveSubmissionStreakLoad(15);assert.doesNotMatch(h.ui.render(),/连续未充值会员明细/);
});

test('a same-scope requery prevents stale streak summaries contaminating refreshed statistics',async()=>{
 const h=harness();await h.ui.load();let finish;h.handler(q=>new Promise(resolve=>finish=()=>resolve(streakResponse(q))));const pending=global.liveSubmissionStreakLoad(30);
 h.handler(q=>response(q));await h.ui.load();finish();await pending;assert.equal(streakTable(h.ui.render()),'');assert.match(h.ui.render(),/点击查询，单独读取/);
});

test('monitoring separates amount and count shares, sorts platforms by volume, and weights total success',async()=>{
 const h=harness();h.select([platform(),platform('b')]);h.handler(q=>{const r=chartResponse(q);if(q.platformId==='b'){r.dashboard.monitoring.forEach(x=>{x.invalid_count=60;x.invalid_amount='2000';x.success_count=20});r.dashboard.hourly[0].count=60;r.dashboard.daily[0].invalid_count=60;r.dashboard.amounts[0].count=60;r.metrics.forEach(x=>{if(x.threshold<30)x.invalid_count=60})}return r});await h.ui.load();const table=monitoringTable(h.ui.render());
 for(const label of ['无效笔数占比','无效金额占比','占总无效笔数','占总无效金额'])assert(table.includes('<th>'+label+'</th>'));assert(table.indexOf('Synthetic b')<table.indexOf('Synthetic a'));assert.match(table,/<tfoot>/);assert.match(table,/已读取汇总/);assert.match(table,/<td>35.00%<\/td>/);assert.match(table,/<td>63.64%<\/td>/);assert.doesNotMatch(table,/<th>会员明细<\/th>/);
});

test('query-only roles see aggregate streak counts without active member detail controls or requests',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(30);const saved=global.hensemRoleAllowed;global.hensemRoleAllowed=(page,action)=>page==='events'&&action!=='detail';
 try{const html=h.ui.render();assert.doesNotMatch(streakTable(html),/liveSubmissionStreakMembers/);assert.match(streakTable(html),/<td>1<\/td>/);const count=h.calls.length;await global.liveSubmissionStreakMembers('a',3);assert.equal(h.calls.length,count)}finally{if(saved===undefined)delete global.hensemRoleAllowed;else global.hensemRoleAllowed=saved}
});

test('streak requests wait for ordinary platform queries instead of adding another database lane',async()=>{
 const h=harness();let finish;h.handler(q=>new Promise(resolve=>finish=()=>resolve(response(q))));const loading=h.ui.load();const count=h.calls.length;await global.liveSubmissionStreakLoad(30);assert.equal(h.calls.length,count);assert.match(h.ui.render(),/aria-label="连续未充值回看天数" disabled/);finish();await loading;
});

test('selected-provider zero days still show qualifying platform evidence without coercing the threshold',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>{const r=streakResponse(q);if(!r.streaks)return r;r.streaks[0].submitted_count=r.streaks[0].observed_submitted_count=2;r.streaks[0].submitted_amount=r.streaks[0].observed_submitted_amount='200';if(q.operation==='members'){r.rows[0].submitted_count=2;r.rows[0].submitted_amount='200';r.rows[0].days.forEach((d,i)=>{d.submitted_count=i===0?2:0;d.submitted_amount=i===0?'200':'0';d.providers=i===0?['Pay A']:[]})}return r});await global.liveSubmissionStreakLoad(30);assert.match(streakTable(h.ui.render()),/>1<\/button>/);await global.liveSubmissionStreakMembers('a',3);global.liveSubmissionStreakExpand(0);const html=h.ui.render();assert.doesNotMatch(html,/响应范围或数据不完整/);assert.match(html,/<th>平台提交笔数<\/th><th>平台提交金额<\/th><th>所选三方笔数<\/th>/);assert.match(html,/<td>2026-09-28<\/td><td>10<\/td><td>1000<\/td><td>0<\/td><td>0<\/td><td>0<\/td>/);
});

test('daily streak jobs show progress, never expose interim zero, and summarize only after completion',async()=>{
 const h=harness();await h.ui.load();let release,step=0;h.handler(q=>{const r=streakResponse(q);if(q.operation==='step'&&++step===2)return new Promise(resolve=>release=()=>resolve(r));return r});
 const loading=global.liveSubmissionStreakLoad(7);await new Promise(resolve=>setImmediate(resolve));assert.match(h.ui.render(),/Synthetic a · 1 \/ 7 日/);assert.equal(streakTable(h.ui.render()),'');assert.equal(h.calls.filter(q=>q.operation==='summary').length,1,'only ordinary existing summary before job completes');release();await loading;
 assert.equal(h.calls.filter(q=>q.action==='submissionStreak'&&q.operation==='step').length,7);assert.equal(h.calls.filter(q=>q.action==='submissionStreak'&&q.operation==='summary').length,1);assert.match(streakTable(h.ui.render()),/>1<\/button>/);
});

test('failed daily steps stop without retry and resume the same job without rereading finished days',async()=>{
 const h=harness();await h.ui.load();let failed=false,steps=0;h.handler(q=>{if(q.operation==='step'&&++steps===3&&!failed){failed=true;throw Error('timeout')}return streakResponse(q)});await global.liveSubmissionStreakLoad(7);
 assert.equal(steps,3);assert.equal(streakTable(h.ui.render()),'');const old=h.ui.capture().streak.jobs.a;assert.equal(old.processedDays,2);assert.match(h.ui.render(),/重试未完成/);
 h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(7,true);assert.equal(h.calls.filter(q=>q.action==='submissionStreak'&&q.operation==='start').length,2);assert.equal(h.ui.capture().streak.jobs.a.jobId,old.jobId);assert.equal(h.calls.filter(q=>q.action==='submissionStreak'&&q.operation==='step').length,8);assert.match(streakTable(h.ui.render()),/>1<\/button>/);
});

test('unknown start outcome retains idempotency nonce for the explicit retry',async()=>{
 const h=harness();await h.ui.load();let first=true;h.handler(q=>{if(q.operation==='start'&&first){first=false;throw Error('network unavailable')}return streakResponse(q)});await global.liveSubmissionStreakLoad(7);const firstRequest=h.calls.at(-1);assert.equal(firstRequest.operation,'start');await global.liveSubmissionStreakLoad(7,true);const starts=h.calls.filter(q=>q.action==='submissionStreak'&&q.operation==='start');assert.equal(starts.length,2);assert.equal(starts[0].clientRequestId,starts[1].clientRequestId);
});

test('stalled, wrong-job and malformed progress cannot spin the daily job loop',async()=>{
 for(const bad of ['stalled','wrong-job','complete-too-soon','wrong-days']){
  const h=harness();await h.ui.load();h.handler(q=>{const r=streakResponse(q);if(q.operation==='step'){if(bad==='stalled')r.processedDays=0;if(bad==='wrong-job')r.jobId='20000000-0000-4000-8000-000000000001';if(bad==='complete-too-soon')r.status='complete';if(bad==='wrong-days')r.totalDays=30}return r});await global.liveSubmissionStreakLoad(7);assert.equal(h.calls.filter(q=>q.operation==='step').length,1);assert.equal(streakTable(h.ui.render()),'');assert.match(h.ui.render(),/计算进度/);
 }
});

test('summary and member results must match the actor-bound job before any values render',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>{const r=streakResponse(q);if(q.operation==='summary')r.jobId='20000000-0000-4000-8000-000000000001';return r});await global.liveSubmissionStreakLoad(7);assert.match(h.ui.render(),/统计任务不一致/);assert.equal(streakTable(h.ui.render()),'');
 h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(7,true);h.handler(q=>{const r=streakResponse(q);r.jobId='20000000-0000-4000-8000-000000000001';return r});await global.liveSubmissionStreakMembers('a',3);assert.match(h.ui.render(),/统计任务不一致/);assert.doesNotMatch(h.ui.render(),/连续未充值会员明细/);
});

test('daily job progress is bound to native platform, range, nonce and lookback before starting work',async()=>{
 for(const patch of [{platformId:'outside'},{startAt:'2026-08-01T00:00:00Z'},{clientRequestId:'20000000-0000-4000-8000-000000000001'},{lookbackDays:30},{expiresAt:'bad'}]){
  const h=harness();await h.ui.load();h.handler(q=>({...streakResponse(q),...patch}));await global.liveSubmissionStreakLoad(7);assert.equal(h.calls.filter(q=>q.operation==='step').length,0);assert.equal(streakTable(h.ui.render()),'');assert.match(h.ui.render(),/计算进度无效/);
 }
});

test('explicit pause stops further days and resume synchronizes a step that finished without a response',async()=>{
 const h=harness();await h.ui.load();let finish,steps=0;h.handler(q=>{const r=streakResponse(q);if(q.operation==='step'&&++steps===2)return new Promise(resolve=>finish=()=>resolve(r));return r});const loading=global.liveSubmissionStreakLoad(7);await new Promise(resolve=>setImmediate(resolve));assert.match(h.ui.render(),/>暂停<\/button>/);global.liveSubmissionStreakPause();assert.match(h.ui.render(),/>继续读取<\/button>/);finish();await loading;assert.equal(h.calls.filter(q=>q.operation==='step').length,2);assert.equal(streakTable(h.ui.render()),'');const nonce=h.ui.capture().streak.jobs.a.clientRequestId;
 h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(7,true);assert.equal(h.calls.filter(q=>q.operation==='step').length,7);assert.equal(h.ui.capture().streak.jobs.a.clientRequestId,nonce);assert.match(streakTable(h.ui.render()),/>1<\/button>/);
});

test('expired analysis clears its saved job and explicit retry creates a fresh nonce',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>{if(q.operation==='step')throw Error('连续提交分析已过期，请重新查询');return streakResponse(q)});await global.liveSubmissionStreakLoad(7);const oldNonce=h.calls.find(q=>q.operation==='start').clientRequestId;assert.equal(h.ui.capture().streak.jobs.a,undefined);assert.match(h.ui.render(),/已过期/);
 h.handler(q=>streakResponse(q));await global.liveSubmissionStreakLoad(7,true);assert.notEqual(h.ui.capture().streak.jobs.a.clientRequestId,oldNonce);assert.match(streakTable(h.ui.render()),/>1<\/button>/);
});

test('a valid-looking cohort cannot render before the daily job is complete',async()=>{
 const h=harness();await h.ui.load();h.handler(q=>{const r=streakResponse(q);if(q.operation==='summary'){r.status='pending';r.processedDays=6}return r});await global.liveSubmissionStreakLoad(7);assert.equal(streakTable(h.ui.render()),'');assert.match(h.ui.render(),/任务尚未完成/);
});

test('missing secure random support leaves a retryable error instead of an unhandled loading state',async()=>{
 const h=harness();await h.ui.load();const property=Object.getOwnPropertyDescriptor(global,'crypto');Object.defineProperty(global,'crypto',{configurable:true,value:{}});
 try{await global.liveSubmissionStreakLoad(7);assert.match(h.ui.render(),/安全随机数不可用/);assert.equal(h.ui.capture().streak.status,'error');assert.equal(h.calls.filter(q=>q.action==='submissionStreak').length,0)}finally{Object.defineProperty(global,'crypto',property)}
});
