/* Synthetic-only payout report checks. No database, credentials or live orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const folder=path.join(__dirname,'../admin-preview');
const moneyKeys=['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'];
const countKeys=['all_count','success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count'];
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const N=value=>value==null?'—':Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const C=value=>Number(value||0).toLocaleString('en-US');
const R=(n,d)=>d?((Number(n)/Number(d))*100).toFixed(2)+'%':'—';
function plus(rows){return Object.fromEntries([...moneyKeys,...countKeys].map(key=>[key,rows.some(r=>r[key]===null)?null:rows.reduce((sum,r)=>sum+Number(r[key]||0),0)]))}
function combine(rows,keys){const groups=new Map();for(const row of rows){const id=JSON.stringify(keys.map(key=>row[key]));if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row)}return [...groups.values()].map(items=>({...Object.fromEntries(keys.map(key=>[key,items[0][key]])),...plus(items),items}))}
function table(headers,rows,css='',footers=[]){const cells=(row,tag)=>'<tr>'+row.map(c=>'<'+tag+'>'+c+'</'+tag+'>').join('')+'</tr>';return '<div class="'+css+'"><table><thead>'+cells(headers,'th')+'</thead><tbody>'+rows.map(row=>cells(row,'td')).join('')+'</tbody><tfoot>'+footers.map(row=>cells(row,'td')).join('')+'</tfoot></table></div>'}
function fixture(orders){
 let html='',direction='withdraw',networkCalls=0;const drawers=[];const root={Intl,Date,fetch(){networkCalls++;throw Error('Expanding a report must not request data')}};root.window=root;
 vm.createContext(root);for(const name of ['live-provider-aliases.js','live-comparison.js','live-provider-summary.js'])vm.runInContext(fs.readFileSync(path.join(folder,name),'utf8'),root,{filename:name});
 const L={country:'印度',currency:'INR',from:'2026-09-25T00:00:00',to:'2026-09-25T23:59:59',queryNow:Date.parse('2026-09-26T00:00:00Z'),results:[{platform:{id:'platform-a',country:'印度',currency:'INR',timezone:'Asia/Kolkata'}}],comparisonResults:[],comparisonStatus:'idle',feeLookupRows:[],localPage:1,localSize:20,workorders:null};
 const ctx={L,E,N,C,R,plus,combine,groupRows:()=>orders,table,box:(title,body)=>'<section><h2>'+E(title)+'</h2>'+body+'</section>',pager:()=>'',providerCell:r=>E(r.provider),feeForRow:()=>'',ensureFeeLookup(){networkCalls++;throw Error('Already loaded rates should be reused')},openDrawer(title,html){drawers.push({title,html})},render(){html=root.HensemProviderSummary.render(ctx,direction)}};
 ctx.render();return {root,L,drawers,api:root.HensemProviderSummary,html:()=>html,networkCalls:()=>networkCalls,render(flow=direction){direction=flow;ctx.render()}};
}
function order(platformId,source,successAmount,successCount,other={}){return {provider:'SyntheticPay',platformId,platform:'Same displayed platform',source,currency:'INR',direction:'withdraw',all_amount:10000,all_count:20,success_amount:successAmount,success_count:successCount,created_success_count:2,pending_amount:500,pending_count:3,...other}}
const plain=html=>html.replace(/<[^>]*>/g,'').trim();
function breakdown(html){
 assert.match(html,/<div class="provider-platform-breakdown">/,'expanded platform heading is rendered');
 const main=html.match(/<div class="[^"]*\bprovider-summary-table\b[^"]*">([\s\S]*?)<\/table>/)?.[1];assert(main,'platform children remain in the main summary table');
 const headers=[...main.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(m=>plain(m[1]).replace(/\s*[↕↑↓]$/,''));
 const amountIndex=headers.findIndex(h=>/^成功金额$/.test(h)),countIndex=headers.findIndex(h=>/^成功笔数$/.test(h));
 const shareIndex=headers.findIndex(h=>/^金额占比$/.test(h));assert(amountIndex>=0&&countIndex>=0&&shareIndex>=0,'success fields retain distinct columns');
 const children=[...main.matchAll(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/g)];assert(children.length,'expanded platform child rows are rendered');
 return children.map(match=>{
  const cells=[...match[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(c=>c[1]);assert.equal(cells.length,headers.length,'platform child aligns with every parent column');
  const countCell=cells[countIndex],countShare=cells[headers.findIndex(h=>/^笔数占比$/.test(h))];assert(countShare!==undefined,'count share has its own column beside amount share');assert.doesNotMatch(countCell,/<small/);
  return {'平台':plain(cells[0]),'包网来源':plain(cells[1]),'成功金额':plain(cells[amountIndex]),'成功笔数':plain(countCell.replace(/<small\b[\s\S]*?<\/small>/g,'')),'金额占比':plain(cells[shareIndex]),'笔数占比':plain(countShare)};
 });
}

test('payout expands each platform with independent success amount/count shares and no extra reads',()=>{
 const h=fixture([order('platform-a','ar',900,3),order('platform-b','newar',100,7),order('platform-c','ar',50000,500,{direction:'charge'})]);
 assert.match(h.html(),/代付三方汇总 · 取款未到账工单/);assert.match(h.html(),/代付中金额/);assert.match(h.html(),/代付中笔数/);assert.match(h.html(),/代付创建金额/);assert.match(h.html(),/代付创建笔数/);assert.match(h.html(),/aria-expanded="false"/);
 h.root.providerSummaryToggle(0);assert.equal(h.networkCalls(),0);assert.match(h.html(),/aria-expanded="true"/);
 const rows=breakdown(h.html());assert.equal(rows.length,2,'same display name stays separated by stable platform/source identity');
 const ar=rows.find(row=>row['包网来源']==='ar'),newar=rows.find(row=>row['包网来源']==='newar');
 assert.equal(ar['成功金额'],'900.00');assert.equal(ar['金额占比'],'90.00%');assert.equal(ar['成功笔数'],'3');assert.equal(ar['笔数占比'],'30.00%');
 assert.equal(newar['成功金额'],'100.00');assert.equal(newar['金额占比'],'10.00%');assert.equal(newar['成功笔数'],'7');assert.equal(newar['笔数占比'],'70.00%');
 assert.equal(rows.reduce((sum,row)=>sum+Number(row['成功金额']),0),1000);assert.equal(rows.reduce((sum,row)=>sum+Number(row['成功笔数']),0),10);
 h.root.providerSummaryToggle(0);assert.doesNotMatch(h.html(),/provider-platform-breakdown/);assert.equal(h.networkCalls(),0);
});

test('payout expansion state and workorder facts stay separate from collection reports',()=>{
 const h=fixture([order('platform-a','ar',900,3),order('platform-a','ar',600,6,{direction:'charge'})]);
 const complete={status:'complete',complete:true,detailCount:1,missingOrderNumberCount:0,missingDetailCount:0,amountConflictCount:0,providerConflictCount:0};
 h.L.workorders={byProvider:[{provider:'SyntheticPay',direction:'withdraw',submittedAmount:111,submittedCount:3,successAmount:100,successCount:2,notReceivedAmount:11,notReceivedCount:1,uniqueOrderAmount:111,uniqueOrderCount:3,uniqueSuccessAmount:100,uniqueSuccessCount:2,uniqueNotReceivedAmount:11,uniqueNotReceivedCount:1,uniqueCoverage:complete},{provider:'SyntheticPay',direction:'charge',submittedAmount:99999,submittedCount:999,successAmount:88888,successCount:888,notReceivedAmount:11111,notReceivedCount:111,uniqueOrderAmount:99999,uniqueOrderCount:999,uniqueSuccessAmount:88888,uniqueSuccessCount:888,uniqueNotReceivedAmount:11111,uniqueNotReceivedCount:111,uniqueCoverage:complete}],coverage:{complete:true,capturedPlatformDays:1,expectedPlatformDays:1}};
 h.render();h.root.providerSummaryToggle(0);assert.match(h.html(),/>111\.00</);assert.doesNotMatch(h.html(),/>99,999\.00</);assert.equal(breakdown(h.html())[0]['成功金额'],'900.00');
 h.render('charge');assert.match(h.html(),/aria-expanded="false"/);assert.doesNotMatch(h.html(),/provider-platform-breakdown/);
 h.render('withdraw');assert.match(h.html(),/aria-expanded="true"/);assert.equal(breakdown(h.html())[0]['成功金额'],'900.00');assert.equal(h.networkCalls(),0);
});

test('confirmed UpiPay payout row supplies both percentage and per-order charge without an inactive fallback',()=>{
 const h=fixture([]),row=order('platform-a','ar',1000,10,{provider:'UpiPay'});
 const confirmed={scopeType:'country',country:'印度',provider:'UpiPay',sheetName:'印度线下',sourceRow:4,payoutFee:'2.50%',payoutSingleFee:'6'};
 const inactive={...confirmed,sourceRow:47,payoutFee:'2.80%',status:'停用'};
 const blankPlatform={...confirmed,scopeType:'platform',platform:row.platform,payoutFee:'',payoutSingleFee:''};
 assert.equal(h.api.estimate(row,[inactive,blankPlatform,confirmed],'印度'),85);
 assert.equal(h.api.feeCandidates(row,[inactive,blankPlatform,confirmed],'印度')[0],confirmed);
 assert.equal(h.api.estimate(row,[inactive,blankPlatform],'印度'),null,'missing confirmed row must stay unmatched');
});
test('typed provider aliases merge transaction/workorder totals once and retain authoritative source types',()=>{
 const h=fixture([]),orders=[order('a','ar',100,10,{provider:'RushPay唤醒'}),order('b','game66',200,20,{provider:'RushPay跑分'}),order('a','ar',50,5,{provider:'T3Pay唤醒'}),order('b','game66',75,7,{provider:'3TPay'})];
 const issues=[{provider:'RushPay唤醒',direction:'withdraw',submittedAmount:40,submittedCount:4,successAmount:30,successCount:3,notReceivedAmount:10,notReceivedCount:1},{provider:'RushPay跑分',direction:'withdraw',submittedAmount:60,submittedCount:6,successAmount:40,successCount:4,notReceivedAmount:20,notReceivedCount:2}];
 const rates=[{provider:'RushPay唤醒',country:'印度',scopeType:'country',payoutFee:'1%',sheetName:'印度线下',sourceRow:5,sourceType:'唤醒',sourceTypeProvider:'RushPay唤醒',sourceTypeCell:'B5'},{provider:'RushPay跑分',country:'印度',scopeType:'country',payoutFee:'1%',sheetName:'印度线下',sourceRow:6,sourceType:'跑分',sourceTypeProvider:'RushPay跑分',sourceTypeCell:'B6'}];
 const before=structuredClone({orders,issues,rates}),rows=h.api.buildRows({orders,issues,rates,country:'印度',direction:'withdraw',plus,combine,coverage:{complete:true,capturedPlatformDays:2}});
 assert.equal(rows.length,3);const rush=rows.find(r=>r.provider==='RushPay');assert.equal(rush.success_amount,300);assert.equal(rush.success_count,30);assert.equal(rush.issues.submittedCount,10);assert.equal(rush.issues.notReceivedCount,3);assert.equal(rush.issues.notReceivedAmount,30);
 const type=h.api.providerType(rush,rates,'印度');assert.equal(type.label,'多种类型');assert.deepEqual(new Set(type.types),new Set(['跑分','唤醒']));assert.match(type.detail,/B5/);assert.match(type.detail,/B6/);
 assert.equal(h.api.estimate(rush,rates,'印度'),3,'same fee does not charge twice after alias merge');
 assert.equal(h.api.estimate(rush,[rates[0],{...rates[1],payoutFee:'2%'}],'印度'),null,'conflicting source rates require review');
 assert.deepEqual({orders,issues,rates},before);
});

test('missing payout amounts stay unknown in platform shares while valid counts still show',()=>{
 const h=fixture([order('platform-a','ar',null,3),order('platform-b','newar',100,7)]);h.root.providerSummaryToggle(0);
 const rows=breakdown(h.html());assert(rows.every(row=>row['金额占比']==='—'));assert.deepEqual(rows.map(row=>row['笔数占比']).sort(),['30.00%','70.00%']);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});

test('partial collection and payout reports identify the returned platform coverage and every subtotal',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([order('platform-a','ar',24680.5,42,{direction})]);h.L.queryPlatforms=Array.from({length:17},(_,i)=>({id:i?'failed-'+i:'platform-a',name:'Platform '+i}));h.L.queryFailures=h.L.queryPlatforms.slice(1).map(p=>({...p,message:'Synthetic timeout'}));h.L.queryWarnings=h.L.queryFailures.map(f=>f.name+': '+f.message);h.root.liveRetryFailed=()=>{};h.render(direction);
  const html=h.html(),cards=html.split('<div class="provider-summary-kpis">')[1].split('<div class="provider-comparison-context">')[0];assert.match(html,/仅显示已返回平台的部分结果/);assert.match(html,/已返回 1 \/ 17 个平台/);assert.match(cards,/代[收付]成功金额/);assert.match(cards,/24,680\.50/);assert.match(html,/已读取合计/);assert.match(html,/金额占比/);assert.doesNotMatch(html,/已读取(?:金额|笔数|手续费)占比/);assert.match(html,/onclick="providerSummaryPlatformCoverage\(\)">订单 1 \/ 17/);assert.doesNotMatch(html,/provider-query-failures|<details[^>]*open/);assert.match(html,/只重试未完成平台/);assert.doesNotMatch(html,/<strong>合计<\/strong>|<strong>全部汇总<\/strong>/);
  h.L.queryRetrying=true;h.render(direction);assert.match(h.html(),/已返回数据保留/);assert.match(h.html(),/onclick="liveRetryFailed\(\)" disabled/);assert.match(h.html(),/24,680\.50/);
 }
});
test('all failed platforms show unavailable amounts and counts rather than false zero totals',()=>{
 const h=fixture([]);h.L.results=[];h.L.queryPlatforms=[{id:'failure',name:'Failed platform'}];h.L.queryFailures=[{id:'failure',name:'Failed platform',message:'timeout'}];h.render();const html=h.html(),cards=html.split('<div class="provider-summary-kpis">')[1].split('<div class="provider-comparison-context">')[0];assert.match(html,/本次尚无平台返回/);assert.match(html,/已返回 0 \/ 1 个平台/);assert.doesNotMatch(cards,/<strong>0(?:\.00)?<\/strong>/);assert.match(cards,/代付成功金额<\/label><strong>—<\/strong>/);const footer=html.match(/<tfoot>([\s\S]*?)<\/tfoot>/)[1];assert.doesNotMatch(footer,/>0\.00</);assert.match(footer,/已读取合计/);
});
test('an incomplete current scope cannot regain yesterday comparisons merely because returned identities match',()=>{
 const h=fixture([order('platform-a','ar',100,1)]);h.L.queryPlatforms=[{id:'platform-a'},{id:'missing'}];h.L.comparisonStatus='ready';h.L.comparisonResults=[{...h.L.results[0],groups:{provider:[]}}];h.render();assert.match(h.html(),/没有同范围的两期数据/);assert.doesNotMatch(h.html(),/新增 \/ 无基数/);
});


test('source-only workorder provider opens its loaded platform cohorts without inventing transaction orders',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([]),coverage={status:'complete',complete:true,detailCount:13,missingOrderNumberCount:0,missingDetailCount:0,amountConflictCount:0,providerConflictCount:0},facts={provider:'未标记三方',currency:'INR',direction,submittedAmount:12800,submittedCount:13,successAmount:0,successCount:0,notReceivedAmount:12800,notReceivedCount:13,uniqueOrderAmount:12800,uniqueOrderCount:13,uniqueSuccessAmount:0,uniqueSuccessCount:0,uniqueNotReceivedAmount:12800,uniqueNotReceivedCount:13,uniqueCoverage:coverage};
  h.L.workorders={byProvider:[facts],byPlatformProvider:[{...facts,platform:'Synthetic A',submittedAmount:4000,submittedCount:2,notReceivedAmount:4000,notReceivedCount:2,uniqueOrderAmount:4000,uniqueOrderCount:2,uniqueNotReceivedAmount:4000,uniqueNotReceivedCount:2,uniqueCoverage:{...coverage,detailCount:2}},{...facts,platform:'Synthetic B',submittedAmount:8800,submittedCount:11,notReceivedAmount:8800,notReceivedCount:11,uniqueOrderAmount:8800,uniqueOrderCount:11,uniqueNotReceivedAmount:8800,uniqueNotReceivedCount:11,uniqueCoverage:{...coverage,detailCount:11}}],coverage:{complete:true,capturedPlatformDays:2,expectedPlatformDays:2}};
  h.render(direction);assert.match(h.html(),/三方未填写（源工单）/);assert.match(h.html(),/仅工单汇总/);assert.doesNotMatch(h.html(),/工单号未入库|源工单仅上传日汇总/);
  assert.match(h.html(),/onclick="providerSummaryToggle\(0\)"[^>]*>三方未填写（源工单）/);
  h.root.providerSummaryToggle(0);const children=breakdown(h.html());assert.equal(children.length,2);assert.match(h.html(),/>4,000\.00</);assert.match(h.html(),/>8,800\.00</);assert.match(h.html(),/工单提交、成功、未到账六列统一按原存款订单号/);assert.doesNotMatch(h.html(),/去重列/);assert.equal(h.networkCalls(),0);
  assert(children.every(r=>r['成功金额']==='—'),'source-only cohorts must not pretend to have transaction amounts');
 }
});

test('compact provider reports budget short identity columns and align equivalent numeric columns',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([order('platform-a','ar',151093800,267877,{direction})]);h.render(direction);const html=h.html();
  const section=html.match(/<div class="[^"]*\bprovider-summary-table\b[^"]*">([\s\S]*?)<\/table>/)[1];
  const headers=[...section.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(m=>plain(m[1]).replace(/\s*[↕↑↓]$/,''));
  const widths=[...section.matchAll(/<col style="width:(\d+)px">/g)].map(m=>Number(m[1]));
  assert.equal(widths.length,headers.length);assert.equal(widths.length,direction==='charge'?26:23);
  assert(widths.slice(0,3).reduce((a,b)=>a+b,0)<=200,'identity columns balance readable labels with the numeric report');
  for(const suffix of ['金额','笔数']){const group=headers.map((header,i)=>header.endsWith(suffix)&&!header.includes('KYC')?widths[i]:null).filter(v=>v!==null);assert(group.length>=4);assert.equal(new Set(group).size,1, suffix+' columns share an aligned width budget');}
  const ratios=headers.map((header,i)=>/成功率$|占比$/.test(header)?widths[i]:null).filter(v=>v!==null);assert.equal(new Set(ratios).size,1);
  assert(widths.reduce((a,b)=>a+b,0)<=(direction==='charge'?2266:2000),'report keeps the compact column budget while narrow screens scroll inside the table');
  assert.match(section,/>151,093,800\.00</,'full-precision amount text is preserved');
  h.root.providerSummaryToggle(0);assert.equal(breakdown(h.html())[0]['成功金额'],'151,093,800.00');
 }
});

test('platform card separates returned zero-order responses from unverified intake and workorder coverage',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([order('platform-a','ar',100,1,{direction})]);
  const platforms=[{id:'platform-a',name:'Active A',source:'ar'},{id:'zero-b',name:'Zero B',source:'newar'}];
  h.L.queryPlatforms=platforms;
  h.L.results=platforms.map(platform=>({platform,groups:{provider:[]},totals:{all_count:0},capabilities:{sourceCompletenessVerified:false}}));
  h.L.workorders={byProvider:[],coverage:{complete:false,platforms:[{platformId:'platform-a',platform:'Active A',complete:false,days:0,expectedDays:1}]}};
  h.render(direction);
  const coverage=h.api.queryCoverage(h.L);assert.equal(coverage.received,2);assert.equal(coverage.requested,2);assert.equal(coverage.partial,false);
  assert.equal(h.api.intakeCoverage(h.L).complete,0);assert.match(h.html(),/<label>平台<\/label><strong>— \/ 2<\/strong>/);
  assert.doesNotMatch(h.html(),/provider-api-coverage/);h.root.providerSummaryPlatformCoverage();assert.equal((h.drawers.at(-1).html.match(/<td>已读取<\/td>/g)||[]).length,2);
  assert.doesNotMatch(h.html(),/provider-kpi-warning|缺失 \d+ 个平台/);
  h.root.providerSummaryPlatformCoverage();const drawer=h.drawers.at(-1);
  assert.equal(drawer.title,'平台采集与读取情况');assert.match(drawer.html,/Zero B/);assert.match(drawer.html,/返回零订单也计为已读取/);assert.match(drawer.html,/工单原单缺项另行核对/);
  assert.equal((drawer.html.match(/<td>已读取<\/td>/g)||[]).length,2);assert.equal(h.networkCalls(),0);
 }
});

test('platform coverage uses query identity, deduplicates responses, and ignores failures outside that query',()=>{
 const h=fixture([]),a={id:'platform-a',name:'Same name',source:'ar'},b={id:'platform-b',name:'Same name',source:'newar'};
 h.L.queryPlatforms=[a,b,a];h.L.results=[{platform:a},{platform:a},{platform:{id:'foreign',name:'Not selected'}}];
 h.L.queryFailures=[{...b,message:'timeout'},{...b,message:'timeout'},{id:'foreign-failure',name:'Outside',message:'failed'}];
 h.render();const c=h.api.queryCoverage(h.L);
 assert.equal(c.requested,2);assert.equal(c.received,1);assert.equal(c.missing.length,1);assert.equal(c.failures.length,1);assert.equal(c.failures[0].source,'newar');
 assert.match(h.html(),/>未读 /);assert.match(h.html(),/provider-kpi-warning/);
 h.root.providerSummaryPlatformCoverage();const html=h.drawers.at(-1).html;assert.match(html,/<td>newar<\/td><td>读取失败<\/td><td>timeout<\/td>/);assert.doesNotMatch(html,/Not selected|Outside/);assert.equal(h.networkCalls(),0);
});

test('missing platform details distinguish timeout, pending, paused and unread without extra requests',()=>{
 const h=fixture([]),platforms=[{id:'platform-a',name:'Read A'},{id:'failure',name:'Failed <B>'},{id:'waiting',name:'Waiting C'}];
 h.L.queryPlatforms=platforms;h.L.queryFailures=[{...platforms[1],message:'timeout <script>alert(1)</script>'}];h.L.loading=true;h.render();
 let c=h.api.queryCoverage(h.L);assert.equal(c.received,1);assert.equal(c.requested,3);assert.equal(c.pending,1);assert.equal(c.missing.find(p=>p.id==='waiting').status,'loading');
 h.root.providerSummaryPlatformCoverage();let drawer=h.drawers.at(-1);assert.match(drawer.html,/Failed &lt;B&gt;/);assert.match(drawer.html,/timeout &lt;script&gt;/);assert.doesNotMatch(drawer.html,/<script>/);assert.match(drawer.html,/<td>读取中<\/td>/);
 h.L.loading=false;h.L.queryPaused=true;h.render();h.root.providerSummaryPlatformCoverage();drawer=h.drawers.at(-1);assert.match(drawer.html,/<td>已暂停<\/td>/);assert.match(drawer.html,/切换页面后暂停/);assert.doesNotMatch(h.html(),/其余 1 个平台仍在读取/);
 h.L.queryPaused=false;h.render();h.root.providerSummaryPlatformCoverage();assert.match(h.drawers.at(-1).html,/<td>未读取<\/td>/);assert.equal(h.networkCalls(),0);
 const count=h.drawers.length;h.L.dirty=true;h.root.providerSummaryPlatformCoverage();assert.equal(h.drawers.length,count,'changed filters cannot open details labelled as the new query');
});

test('successful retry clears missing-platform warning even when old failure evidence lingers',()=>{
 const h=fixture([]),a={id:'platform-a',name:'A'},b={id:'b',name:'B'};h.L.queryPlatforms=[a,b];h.L.queryFailures=[{...b,message:'timeout'}];h.render();assert.match(h.html(),/>未读 /);
 h.L.results.push({platform:b,groups:{provider:[]}});h.render();assert.equal(h.api.queryCoverage(h.L).partial,false);assert.doesNotMatch(h.html(),/provider-api-coverage/);h.root.providerSummaryPlatformCoverage();assert.equal((h.drawers.at(-1).html.match(/<td>已读取<\/td>/g)||[]).length,2);assert.doesNotMatch(h.html(),/缺失 1 个平台|provider-kpi-warning/);
 h.root.providerSummaryPlatformCoverage();assert.doesNotMatch(h.drawers.at(-1).html,/timeout|读取失败/);assert.equal(h.networkCalls(),0);
});
