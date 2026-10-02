/* Synthetic data only. Snapshot stocks, ranking continuity and navigation ownership. */
const test=require('node:test'),assert=require('node:assert/strict');
const {create,project,standings,frequency,threshold,ageText}=require('../admin-preview/live-pending-analysis.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const platform=(id=A)=>({id,name:id===A?'Synthetic Alpha':'Synthetic Beta',sourceName:id===A?'Synthetic Alpha':'Synthetic Beta',country:'印度',team:'Synthetic Team',currency:'INR',timezone:'Asia/Kolkata'});
const group=(provider,amount,count=1)=>({provider,amount:String(amount),count});
function day(date='2026-09-29',groups=[group('Pay A',100,2),group('Pay B',200,1)],extra={}){return {basis:'seven_day_pending_snapshot',date,snapshotDate:date,currency:'INR',complete:true,expectedPlatformCount:1,receivedPlatformCount:1,amount:String(groups.reduce((n,g)=>n+Number(g.amount),0)),count:groups.reduce((n,g)=>n+g.count,0),observedAt:'2026-09-30T00:00:00Z',rows:[{...platform(),state:'complete',timingState:'on_time',businessDate:date,observationDate:new Date(Date.parse(date)+86400000).toISOString().slice(0,10),observedAt:date+'T18:32:00Z',targetAt:date+'T18:30:00Z',delaySeconds:120,toleranceSeconds:300,amount:String(groups.reduce((n,g)=>n+Number(g.amount),0)),count:groups.reduce((n,g)=>n+g.count,0),groups}],...extra};}
const response=(daily=[day('2026-09-28'),day()],extra={})=>({version:1,basis:'seven_day_pending_snapshot',startDate:'2026-09-28',endDate:'2026-09-29',daily,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(options={}){const L={from:'2026-09-28T00:00:00',to:'2026-09-29T23:59:59',country:'印度',dirty:false,withdrawCatalog:[]},calls=[];let selected=[platform()],providers=[],handler=async()=>response(),renders=0;const ui=create({L,selected:()=>selected,providers:()=>providers,request:q=>{calls.push(q);return handler(q);},prepare:options.prepare,render:()=>renders++});return {L,ui,calls,setSelected:x=>selected=x,setProviders:x=>providers=x,handler:x=>handler=x,get renders(){return renders;}};}
const range=['2026-09-28','2026-09-29'];
test('pending snapshot comparison shows amount and count differences without inventing missing or zero baselines',async()=>{
 const h=setup();h.handler(async()=>response([day('2026-09-28',[group('Pay A',100,2)]),day('2026-09-29',[group('Pay A',150,5)])]));await h.ui.load();
 assert.match(h.ui.page(),/\+50\.00（\+50\.00%）/);
 globalThis.livePendingAnalysisMetric('count');assert.match(h.ui.page(),/\+3 笔（\+150\.00%）/);
 h.handler(async()=>response([day('2026-09-28',[group('Pay A',0,0)]),day('2026-09-29',[group('Pay A',150,5)])]));await h.ui.load();
 globalThis.livePendingAnalysisMetric('amount');assert.match(h.ui.page(),/\+150\.00（无基数）/);assert.doesNotMatch(h.ui.page(),/NaN|Infinity/);
 h.handler(async()=>response([day('2026-09-28',[group('Pay A',100,2)],{complete:false,rows:[{...platform(),state:'missing',groups:[]}]}),day('2026-09-29',[group('Pay A',150,5)])]));await h.ui.load();
 assert.doesNotMatch(h.ui.page(),/\+50\.00（\+50\.00%）/);
});

test('no request on construction or display; manual load uses selected days and authorized scope',async()=>{const h=setup();assert.equal(h.calls.length,0);assert.match(h.ui.page(),/点击查询/);assert.equal(h.calls.length,0);h.setProviders(['Pay A','Pay A']);await h.ui.load();assert.deepEqual(h.calls,[{action:'pendingAnalysis',startDate:'2026-09-28',endDate:'2026-09-29',platformIds:[A],providers:['Pay A']}]);assert.match(h.ui.page(),/所选三方范围/);assert.match(h.ui.page(),/采集于 2026\/9\/30/);});

test('ending-day amounts are stocks, not sums across days; providers merge original channels',async()=>{const h=setup(),today=day('2026-09-29',[group('Pay A',120,2),group('Pay A',80,1),group('Pay B',100,2)]);h.handler(async()=>response([day('2026-09-28',[group('Pay A',900,9)]),today]));await h.ui.load();const html=h.ui.page();assert.match(html,/代付中金额<\/span><strong>300\.00/);assert.doesNotMatch(html,/1,200\.00/);const days=project(response([today]),range);assert.deepEqual(days[1].groups,[{provider:'Pay A',amount:200,count:3},{provider:'Pay B',amount:100,count:2}]);assert.match(html,/66\.67%/);});

test('money and count rankings are independent, ties retain each winner, zero has no winner',()=>{const days=project(response([day('2026-09-28',[group('Pay A',100,8),group('Pay B',500,1)]),day('2026-09-29',[group('Pay A',100,2),group('Pay B',100,2)])]),range);const money=standings(days,'amount'),count=standings(days,'count');assert.equal(money.find(x=>x.provider==='Pay B').current,2);assert.equal(count.find(x=>x.provider==='Pay A').current,2);assert.equal(money.find(x=>x.provider==='Pay A').tied,true);assert.equal(count.find(x=>x.provider==='Pay B').tied,true);const zero=project(response([day('2026-09-28'),day('2026-09-29',[])]),range);assert(standings(zero,'amount').every(x=>x.current===0));});

test('missing/partial calendar days interrupt streaks; leading window boundary is a lower bound',()=>{const dates=['2026-09-26','2026-09-27','2026-09-28','2026-09-29'],complete=d=>day(d,[group('Pay A',300,3)]);let days=project({daily:dates.map(complete)},dates),rank=standings(days,'amount')[0];assert.deepEqual([rank.current,rank.currentBound,rank.longest,rank.longestBound,rank.wins],[4,true,4,true,4]);days=project({daily:[complete(dates[0]),complete(dates[2]),complete(dates[3])]},dates);rank=standings(days,'amount')[0];assert.deepEqual([rank.current,rank.currentBound,rank.longest,rank.longestBound,rank.wins],[2,false,2,false,3]);days=project({daily:[complete(dates[0]),{...complete(dates[1]),complete:false},complete(dates[2]),complete(dates[3])]},dates);assert.equal(standings(days,'amount')[0].current,2);const unsupported=project({daily:dates.map(complete)},dates,[{name:'not connected'}]);assert(standings(unsupported,'amount').every(x=>x.wins===0));});

test('missing ending snapshot stays unknown instead of falling back to earlier successful day',async()=>{const h=setup();h.handler(async()=>response([day('2026-09-28')]));await h.ui.load();const html=h.ui.page();assert.match(html,/该日未核实零点快照/);assert.match(html,/代付中金额<\/span><strong>—/);assert.match(html,/最长连续第一/);assert.doesNotMatch(html,/class="pa-tied"/);});

test('partial snapshot keeps known subtotals and never declares a daily leader',async()=>{const h=setup();h.handler(async()=>response([day('2026-09-28'),day('2026-09-29',undefined,{complete:false,expectedPlatformCount:2})]));await h.ui.load();const html=h.ui.page();assert.match(html,/已核实 1 \/ 2 平台/);assert.match(html,/代付中金额<\/span><strong>300\.00/);assert.match(html,/三方高存量频次/);assert.equal(standings(project(response([day('2026-09-28'),day('2026-09-29',undefined,{complete:false})]),range),'amount').find(x=>x.provider==='Pay B').current,0);});

test('local controls change display without reading; dirty controls refuse stale changes',async()=>{const h=setup();await h.ui.load();assert.doesNotMatch(h.ui.page(),/class="pa-provider"/);global.livePendingAnalysisExpand(A);assert.match(h.ui.page(),/class="pa-provider"/);global.livePendingAnalysisMetric('count');assert.match(h.ui.page(),/按笔数排名/);assert.equal(h.calls.length,1);h.L.dirty=true;const n=h.renders;global.livePendingAnalysisMetric('amount');global.livePendingAnalysisExpand(A);assert.equal(h.renders,n);assert.match(h.ui.page(),/点击查询/);});

test('cancel, scope change and restoration reject late response without restarting queries',async()=>{const h=setup();await h.ui.load();const saved=h.ui.capture(),slow=deferred();h.handler(()=>slow.promise);const loading=h.ui.load();h.ui.cancel();slow.resolve(response());await loading;assert.match(h.ui.page(),/读取已暂停/);h.ui.restore(saved);assert.match(h.ui.page(),/300\.00/);const count=h.calls.length;h.ui.restore(null);assert.match(h.ui.page(),/点击查询/);h.ui.restore(saved);assert.equal(h.calls.length,count);const late=deferred();h.handler(()=>late.promise);const next=h.ui.load();await Promise.resolve();h.L.to='2026-09-30T23:59:59';late.resolve(response());await next;assert.match(h.ui.page(),/点击查询/);});

test('preparation resolves report-only platform and navigation cancellation prevents request',async()=>{const p=deferred(),h=setup({prepare:()=>p.promise});h.setSelected([{...platform(),id:'report:synthetic'}]);const pending=h.ui.load();assert.equal(h.calls.length,0);h.L.withdrawCatalog=[platform()];p.resolve();await pending;assert.deepEqual(h.calls[0].platformIds,[A]);const wait=deferred(),other=setup({prepare:()=>wait.promise});const loading=other.ui.load();other.ui.cancel();wait.resolve();await loading;assert.equal(other.calls.length,0);});

test('invalid ranges and invalid server dates/completeness fail closed',async()=>{for(const [from,to]of[['2026-09-30','2026-09-29'],['2026-08-01','2026-09-29'],['2026-02-30','2026-03-01']]){const h=setup();h.L.from=from;h.L.to=to;await h.ui.load();assert.equal(h.calls.length,0);assert.match(h.ui.page(),/1 至 31 天/);}for(const bad of [response([day(),day()]),response([day('2026-09-30')]),response([day('2026-09-28'),day('2026-09-29',undefined,{amount:null})]),response([],{basis:'current_orders'})]){const h=setup();h.handler(async()=>bad);await h.ui.load();assert.match(h.ui.page(),/待核对|不完整/);assert.doesNotMatch(h.ui.page(),/data-pending-analysis="ready"/);}});

test('verified snapshot-time aging supplies actionable priority and partial coverage remains explicit',async()=>{const h=setup(),g={provider:'Pay A',count:2,amount:'100',over24Count:1,over24Amount:'70',maxHours:25,avgHours:13};const aging={basis:'source_snapshot_age',snapshotDate:'2026-09-29',available:true,complete:false,count:2,amount:'100',expectedCount:3,matchedCount:2,unknownCount:1,over24Count:1,over24Amount:'70',maxHours:25,avgHours:13,buckets:[{key:'24-48',label:'24～48 小时',count:1,amount:'70'}],platforms:[{...platform(),state:'complete',...g,groups:[g]}],missingPlatforms:[platform(B)]};h.handler(async()=>response(undefined,{aging}));await h.ui.load();const html=h.ui.page();assert.match(html,/优先跟进/);assert.match(html,/Pay A：≥1天 1 笔，金额 70\.00（已核实部分）/);assert.match(html,/1天1小时/);assert.match(html,/时间未知 1 笔/);assert.match(html,/Synthetic Beta/);assert.match(html,/已核实部分/);assert(html.indexOf('卡单申请年龄')<html.indexOf('三方高存量频次'));});

test('absent historical order details never produce longest zero or an invented priority',async()=>{const h=setup();h.handler(async()=>response(undefined,{aging:{available:false,complete:false,maxHours:null,count:null,missingPlatforms:[platform()]}}));await h.ui.load();const html=h.ui.page();assert.match(html,/该日明细未保留 \/ 未齐/);assert.doesNotMatch(html,/优先跟进|最长 0|0\.0 小时/);});

test('untrusted names are escaped even in folded table handlers and priority hints',async()=>{const h=setup(),bad='<img src=x onerror=alert(1)>';h.handler(async()=>response([day('2026-09-28',[group(bad,2,1)]),day('2026-09-29',[group(bad,2,1)])]));await h.ui.load();global.livePendingAnalysisExpand(A);const html=h.ui.page();assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/livePendingAnalysisExpand\(&quot;/);});


test('unsupported selected platforms downgrade otherwise complete aging without mutating cached response',async()=>{
 const h=setup(),g={provider:'Pay A',matchedCount:2,unknownCount:0,count:2,amount:'100',over24Count:1,over24Amount:'70',maxHours:25,avgHours:13};
 const aging={basis:'source_snapshot_age',snapshotDate:'2026-09-29',available:true,complete:true,coverageComplete:true,count:2,unknownCount:0,over24Count:1,over24Amount:'70',maxHours:25,avgHours:13,buckets:[],platforms:[{...platform(),state:'complete',...g,groups:[g]}],missingPlatforms:[]};
 const data=response(undefined,{aging});h.setSelected([platform(),{...platform(B),id:'report:unsupported'}]);h.handler(async()=>data);await h.ui.load();
 const html=h.ui.page();assert.match(html,/已核实部分/);assert.match(html,/≥1天 · 已核实部分/);assert.match(html,/金额 70\.00（已核实部分）/);assert.match(html,/Synthetic Beta/);assert.match(html,/pa-age-partial/);
 assert.equal(data.aging.complete,true);assert.deepEqual(data.aging.missingPlatforms,[]);
});

test('metadata-incomplete age rows identify verified subsets and wrong-day aging is ignored',async()=>{
 const h=setup(),g={provider:'Pay A',matchedCount:2,unknownCount:1,count:1,amount:'100',over24Count:1,over24Amount:'100',maxHours:25};
 const aging={basis:'source_snapshot_age',snapshotDate:'2026-09-29',available:true,complete:false,count:1,unknownCount:1,over24Count:1,maxHours:25,platforms:[{...platform(),state:'metadata_incomplete',...g,groups:[g]}],buckets:[]};
 h.handler(async()=>response(undefined,{aging}));await h.ui.load();global.livePendingAnalysisExpand(A);assert.match(h.ui.page(),/title="仅有效申请时间订单；未齐部分不推算"/);
 h.handler(async()=>response(undefined,{aging:{...aging,snapshotDate:'2026-09-28'}}));await h.ui.load();assert.doesNotMatch(h.ui.page(),/优先跟进|1天1小时/);
});

// Producer-shaped fixtures: business day D observes D+1 local midnight;
// timing and end-day exact aging are independent from collection completeness.
const withPlatforms=(date,rows,extra={})=>day(date,[],{rows,expectedPlatformCount:rows.length,receivedPlatformCount:rows.filter(r=>r.state==='complete').length,complete:rows.every(r=>r.state==='complete'),amount:String(rows.reduce((n,r)=>n+(Number(r.amount)||0),0)),count:rows.reduce((n,r)=>n+(Number(r.count)||0),0),...extra});
const row=(id,date,channels,extra={})=>({...platform(id),state:'complete',source:'ar',businessDate:date,observationDate:new Date(Date.parse(date)+86400000).toISOString().slice(0,10),targetAt:date+'T18:30:00Z',snapshotAt:date+'T18:32:00Z',observedAt:date+'T18:32:00Z',delaySeconds:120,toleranceSeconds:300,timingState:'on_time',amount:String(channels.reduce((n,g)=>n+Number(g.amount),0)),count:channels.reduce((n,g)=>n+g.count,0),groups:channels,...extra});
const bodyTable=(html,name)=>html.split('aria-label="'+name+'"')[1]?.split('</table>')[0]||'';

test('late and unknown captures never enter midnight stocks, comparisons or daily rankings',async()=>{
 const h=setup(),raw=response([day('2026-09-28'),withPlatforms('2026-09-29',[row(A,'2026-09-29',[group('Pay Late',999999,20)],{timingState:'late',delaySeconds:4800,observedAt:'2026-09-29T19:50:00Z'})])]);h.handler(async()=>raw);await h.ui.load();
 assert.match(h.ui.page(),/2026-09-30 00:00（2026-09-29日结束）/);assert.match(h.ui.page(),/00:00后5分内采集/);assert.match(h.ui.page(),/迟采 1小时/);assert.match(h.ui.page(),/代付中金额<\/span><strong>—/);assert.doesNotMatch(h.ui.page(),/999,999\.00/);
 global.livePendingAnalysisMode('captured');assert.match(h.ui.page(),/代付中金额<\/span><strong>999,999\.00/);assert.match(h.ui.page(),/不能视为真实00:00库存/);assert.equal(h.calls.length,1);assert.equal(raw.daily[1].rows[0].amount,'999999');
 const p=project({daily:[withPlatforms('2026-09-29',[row(A,'2026-09-29',[],{timingState:'unknown'})])]},['2026-09-29'],[],'midnight')[0];assert.equal(p.count,null);assert.equal(p.complete,false);
});

test('one on-time platform remains a verified subtotal while late platforms and global shares are explicit',async()=>{
 const h=setup();h.setSelected([platform(),platform(B)]);h.handler(async()=>response([withPlatforms('2026-09-28',[row(A,'2026-09-28',[group('Pay A',100,2)]),row(B,'2026-09-28',[group('Pay B',900,8)])]),withPlatforms('2026-09-29',[row(A,'2026-09-29',[group('Pay A',150,5)]),row(B,'2026-09-29',[group('Pay B',500000,8)],{timingState:'late',delaySeconds:600})])]));await h.ui.load();
 assert.match(h.ui.page(),/已核实 1 \/ 2 平台/);assert.match(h.ui.page(),/代付中金额<\/span><strong>150\.00/);assert.doesNotMatch(h.ui.page(),/500,000\.00/);assert.match(bodyTable(h.ui.page(),'代付中平台与三方分布'),/\+50\.00（\+50\.00%）/);
 assert.equal(standings(project(h.ui.capture().data,range,[],'midnight'),'amount').find(x=>x.provider==='Pay A').wins,0);
});

test('platform-local provider shares differ from scope shares and local controls do not request again',async()=>{
 const h=setup();h.setSelected([platform(),platform(B)]);h.handler(async()=>response([withPlatforms('2026-09-28',[row(A,'2026-09-28',[group('Pay A',10,1),group('Pay B',30,3)]),row(B,'2026-09-28',[group('Pay C',60,6)])]),withPlatforms('2026-09-29',[row(A,'2026-09-29',[group('Pay A',10,1),group('Pay B',30,3)]),row(B,'2026-09-29',[group('Pay C',60,6)])])]));await h.ui.load();global.livePendingAnalysisExpand(A);
 let html=bodyTable(h.ui.page(),'每日平台三方占比');assert.match(html,/金额 25\.00%/);assert.match(html,/笔数 25\.00%/);global.livePendingAnalysisShare('scope');html=bodyTable(h.ui.page(),'每日平台三方占比');assert.match(html,/金额 10\.00%/);assert.doesNotMatch(html,/金额 25\.00%/);
 global.livePendingAnalysisDimension('provider');assert.match(h.ui.page(),/每日三方 \/ 平台占比/);global.livePendingAnalysisExpandProvider('Pay A');assert.match(bodyTable(h.ui.page(),'每日三方平台占比'),/Synthetic Alpha/);assert.equal(h.calls.length,1);
 const saved=h.ui.capture();global.livePendingAnalysisDimension('platform');h.ui.restore(saved);assert.match(h.ui.page(),/每日三方 \/ 平台占比/);
});

test('provider yesterday deltas show absolute money and count together; true new providers have zero baseline',async()=>{
 const h=setup();h.handler(async()=>response([day('2026-09-28',[group('Pay A',100,2)]),day('2026-09-29',[group('Pay A',150,5),group('Pay New',20,1)])]));await h.ui.load();global.livePendingAnalysisExpand(A);const table=bodyTable(h.ui.page(),'代付中平台与三方分布');assert.match(table,/\+50\.00（\+50\.00%）/);assert.match(table,/\+3 笔（\+150\.00%）/);assert.match(table,/\+20\.00（无基数）/);assert.match(table,/\+1 笔（无基数）/);assert.doesNotMatch(table,/Infinity|NaN/);
});

test('independent day-before baseline supports single-day comparison but never increases period frequency',async()=>{
 const h=setup();h.L.from='2026-09-29';h.handler(async()=>({...response([day('2026-09-29',[group('Pay A',150,5)])]),startDate:'2026-09-29',baseline:day('2026-09-28',[group('Pay A',100,2)])}));await h.ui.load();assert.match(h.ui.page(),/\+50\.00（\+50\.00%）/);assert.match(h.ui.page(),/完整日期 1 \/ 1 天/);assert.match(bodyTable(h.ui.page(),'三方高存量频次'),/1 \/ 1 天/);assert.doesNotMatch(bodyTable(h.ui.page(),'三方高存量频次'),/2 天|2 \/ 2/);
 const bad=setup();bad.handler(async()=>response(undefined,{baseline:day('2026-09-26')}));await bad.ui.load();assert.match(bad.ui.page(),/前一日快照日期待核对/);
});

test('selecting an earlier day restores that stock without reusing ending-day age details or network reads',async()=>{
 const h=setup(),aging={basis:'source_snapshot_age',snapshotDate:'2026-09-29',available:true,complete:true,count:1,amount:'10',unknownCount:0,maxHours:999,over24Count:1,over24Amount:'10',thresholds:[{minHours:168,count:1,amount:'10'}],platforms:[]};h.handler(async()=>response([day('2026-09-28',[group('Pay A',20,1)]),day('2026-09-29',[group('Pay A',50,2)])],{aging}));await h.ui.load();assert.match(h.ui.page(),/41天15小时/);global.livePendingAnalysisDate('2026-09-28');assert.match(h.ui.page(),/代付中金额<\/span><strong>20\.00/);assert.match(h.ui.page(),/该日等待明细未加载/);assert.doesNotMatch(h.ui.page(),/41天15小时/);const saved=h.ui.capture();global.livePendingAnalysisDate('2026-09-29');h.ui.restore(saved);assert.match(h.ui.page(),/2026-09-29 00:00（2026-09-28日结束）/);assert.equal(h.calls.length,1);const n=h.renders;global.livePendingAnalysisDate('2026-02-30');assert.equal(h.renders,n);
});

test('same-scope failed refresh retains successful stocks and retry; changing scope discards them',async()=>{
 const h=setup();await h.ui.load();h.handler(async()=>{throw Error('Synthetic timeout');});await h.ui.load();assert.match(h.ui.page(),/Synthetic timeout.*保留上次成功结果/);assert.match(h.ui.page(),/300\.00/);assert.match(h.ui.page(),/livePendingAnalysisRetry/);h.handler(async()=>response());await global.livePendingAnalysisRetry();assert.doesNotMatch(h.ui.page(),/Synthetic timeout/);h.setSelected([platform(B)]);assert.match(h.ui.page(),/点击查询/);h.handler(async()=>{throw Error('Synthetic scope failure');});await h.ui.load();assert.match(h.ui.page(),/Synthetic scope failure/);assert.doesNotMatch(h.ui.page(),/300\.00/);
});

test('exact age thresholds preserve unknown WG higher thresholds and never split >=72h into >=7 days',()=>{
 const legacy={over24Count:7,over24Amount:'70',buckets:Array.from({length:8},(_,key)=>({key:String(key),count:1,amount:'10'}))};assert.deepEqual(threshold(legacy,48),{count:2,amount:20});assert.deepEqual(threshold(legacy,72),{count:1,amount:10});assert.deepEqual(threshold(legacy,168),{count:null,amount:null});
 const real={...legacy,thresholds:[{minHours:168,count:1,amount:'12.34'},{minHours:48,count:null,amount:null}]};assert.deepEqual(threshold(real,168),{count:1,amount:12.34});assert.deepEqual(threshold(real,48),{count:null,amount:null});assert.equal(ageText(50.9),'2天2小时');assert.equal(ageText(null),'—');
});

test('frequency uses only complete dates, includes true zeros, excludes zero-denominator shares and baseline',()=>{
 const d=project({daily:[day('2026-09-27',[]),day('2026-09-28',[group('Pay A',10,2),group('Pay B',30,6)]),day('2026-09-29',[group('Pay A',900,99)],{complete:false})]},['2026-09-27',...range]);assert.deepEqual(frequency(d,'Pay A'),{observedDays:2,pendingDays:1,peakAmount:10,peakCount:2,meanAmountShare:25,meanCountShare:25});assert.equal(standings(d,'amount').find(r=>r.provider==='Pay A').current,0);
});

test('order callbacks require detail permission and retain exact observation scope, never current-order fallback',async()=>{
 const L={from:'2026-09-29',to:'2026-09-29',country:'印度',dirty:false,withdrawCatalog:[]},opened=[];let allowed=false;const ui=create({L,selected:()=>[platform()],providers:()=>[],request:async()=>({...response([day()]),startDate:'2026-09-29'}),render:()=>{},canDetail:()=>allowed,openDetail:q=>opened.push(q)});await ui.load();assert.doesNotMatch(ui.page(),/>订单明细<\/button>/);global.livePendingAnalysisDetail('2026-09-29',A,'Pay A');assert.equal(opened.length,0);allowed=true;assert.match(ui.page(),/>订单明细<\/button>/);global.livePendingAnalysisDetail('2026-09-29',A,'Pay A');assert.equal(opened.length,1);assert.equal(opened[0].date,'2026-09-29');assert.deepEqual(opened[0].platformIds,[A]);assert.equal(opened[0].observedAt,'2026-09-29T18:32:00Z');assert.equal(opened[0].mode,'midnight');global.livePendingAnalysisMode('captured');global.livePendingAnalysisDetail('2026-09-29',A,'Pay A');assert.equal(opened[1].mode,'observed');global.livePendingAnalysisDetail('2026-09-28',A,'Pay A');global.livePendingAnalysisDetail('2026-09-29',B,'Pay A');global.livePendingAnalysisDetail('2026-09-29',A,'Synthetic unknown');assert.equal(opened.length,2);
});
