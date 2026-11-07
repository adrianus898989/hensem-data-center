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
function table(headers,rows,css='',footers=[]){const cells=(row,tag)=>'<tr>'+row.map(c=>'<'+tag+'>'+c+'</'+tag+'>').join('')+'</tr>';return '<div class="'+css+'"><table><thead>'+cells(headers,'th')+'</thead><tbody>'+rows.map(row=>cells(row,'td')).join('')+'</tbody><tfoot>'+footers.map(row=>cells(row,'td')).join('')+'</tfoot></table>'+(rows.length?'':'<div class="live-empty">当前筛选范围没有已入库记录</div>')+'</div>'}
function fixture(orders){
 let html='',direction='withdraw',networkCalls=0;const drawers=[];const root={Intl,Date,fetch(){networkCalls++;throw Error('Expanding a report must not request data')}};root.window=root;
 vm.createContext(root);for(const name of ['live-provider-aliases.js','live-comparison.js','live-provider-summary.js'])vm.runInContext(fs.readFileSync(path.join(folder,name),'utf8'),root,{filename:name});
 const L={feeEstimateMode:'historical',country:'印度',currency:'INR',from:'2026-09-25T00:00:00',to:'2026-09-25T23:59:59',queryNow:Date.parse('2026-09-26T00:00:00Z'),results:[{platform:{id:'platform-a',country:'印度',currency:'INR',timezone:'Asia/Kolkata'}}],comparisonResults:[],comparisonStatus:'idle',feeLookupRows:[],localPage:1,localSize:20,workorders:null};
 const ctx={L,E,N,C,R,plus,combine,groupRows:()=>orders,table,box:(title,body)=>'<section><h2>'+E(title)+'</h2>'+body+'</section>',pager:()=>'',providerCell:r=>E(r.provider),feeForRow:()=>'',ensureFeeLookup(){networkCalls++;throw Error('Already loaded rates should be reused')},openDrawer(title,html){drawers.push({title,html})},render(){html=root.HensemProviderSummary.render(ctx,direction)}};
 ctx.render();return {root,L,drawers,api:root.HensemProviderSummary,html:()=>html,networkCalls:()=>networkCalls,render(flow=direction){direction=flow;ctx.render()}};
}
function order(platformId,source,successAmount,successCount,other={}){return {provider:'SyntheticPay',platformId,platform:'Same displayed platform',source,currency:'INR',direction:'withdraw',all_amount:10000,all_count:20,success_amount:successAmount,success_count:successCount,created_success_count:2,pending_amount:500,pending_count:3,...other}}
const verifiedFee=(row,amount)=>({...row,fee_version_state:'complete',fee_version_matched_count:row.success_count,fee_version_unmatched_count:0,fee_version_estimated_amount:amount});
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
 assert.equal(h.api.estimate(verifiedFee(row,83.25),[inactive,blankPlatform,confirmed],'印度'),83.25,'only the explicit backend historical fee supplies the amount');
 assert.equal(h.api.feeCandidates(row,[inactive,blankPlatform,confirmed],'印度')[0],confirmed);
 assert.equal(h.api.estimate(row,[inactive,blankPlatform],'印度'),null,'missing confirmed row must stay unmatched');
});
test('typed provider aliases merge transaction/workorder totals once and retain authoritative source types',()=>{
 const h=fixture([]),orders=[order('a','ar',100,10,{provider:'RushPay唤醒'}),order('b','game66',200,20,{provider:'RushPay跑分'}),order('a','ar',50,5,{provider:'T3Pay唤醒'}),order('b','game66',75,7,{provider:'3TPay'})];
 const issues=[{provider:'RushPay唤醒',direction:'withdraw',submittedAmount:40,submittedCount:4,successAmount:30,successCount:3,notReceivedAmount:10,notReceivedCount:1},{provider:'RushPay跑分',direction:'withdraw',submittedAmount:60,submittedCount:6,successAmount:40,successCount:4,notReceivedAmount:20,notReceivedCount:2}];
 const rates=[{provider:'RushPay唤醒',country:'印度',scopeType:'country',payoutFee:'1%',sheetName:'印度线下',sourceRow:5,sourceType:'唤醒',sourceTypeProvider:'RushPay唤醒',sourceTypeCell:'B5'},{provider:'RushPay跑分',country:'印度',scopeType:'country',payoutFee:'1%',sheetName:'印度线下',sourceRow:6,sourceType:'跑分',sourceTypeProvider:'RushPay跑分',sourceTypeCell:'B6'}];
 orders[0]=verifiedFee(orders[0],0.75);orders[1]=verifiedFee(orders[1],2.25);const before=structuredClone({orders,issues,rates}),rows=h.api.buildRows({orders,issues,rates,country:'印度',direction:'withdraw',plus,combine,coverage:{complete:true,capturedPlatformDays:2}});
 assert.equal(rows.length,3);const rush=rows.find(r=>r.provider==='RushPay');assert.equal(rush.success_amount,300);assert.equal(rush.success_count,30);assert.equal(rush.issues.submittedCount,10);assert.equal(rush.issues.notReceivedCount,3);assert.equal(rush.issues.notReceivedAmount,30);
 const type=h.api.providerType(rush,rates,'印度');assert.equal(type.label,'多种类型');assert.deepEqual(new Set(type.types),new Set(['跑分','唤醒']));assert.match(type.detail,/B5/);assert.match(type.detail,/B6/);
 assert.equal(h.api.estimate(rush,rates,'印度'),3,'same fee does not charge twice after alias merge');
 assert.equal(h.api.estimate(rush,[rates[0],{...rates[1],payoutFee:'2%'}],'印度'),3,'today source-rate conflict cannot replace verified historical prices');
 assert.deepEqual({orders,issues,rates},before);
});

test('missing payout amounts stay unknown in platform shares while valid counts still show',()=>{
 const h=fixture([order('platform-a','ar',null,3),order('platform-b','newar',100,7)]);h.root.providerSummaryToggle(0);
 const rows=breakdown(h.html());assert(rows.every(row=>row['金额占比']==='—'));assert.deepEqual(rows.map(row=>row['笔数占比']).sort(),['30.00%','70.00%']);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});

test('partial collection and payout reports identify the returned platform coverage and every subtotal',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([order('platform-a','ar',24680.5,42,{direction})]);h.L.queryPlatforms=Array.from({length:17},(_,i)=>({id:i?'failed-'+i:'platform-a',name:'Platform '+i}));h.L.queryFailures=h.L.queryPlatforms.slice(1).map(p=>({...p,message:'Synthetic timeout'}));h.L.queryWarnings=h.L.queryFailures.map(f=>f.name+': '+f.message);h.root.liveRetryFailed=()=>{};h.render(direction);
  const html=h.html(),cards=html.split('<div class="provider-summary-kpis">')[1].split('<div class="provider-status-actions provider-toolbar">')[0];assert.match(html,/仅显示已返回平台的部分结果/);assert.match(html,/已返回 1 \/ 17 个平台/);assert.match(cards,/代[收付]成功金额/);assert.match(cards,/24,680\.50/);assert.match(html,/已读取合计/);assert.match(html,/金额占比/);assert.doesNotMatch(html,/已读取(?:金额|笔数|手续费)占比/);assert.match(html,/onclick="providerSummaryPlatformCoverage\(\)">订单 1 \/ 17/);assert.doesNotMatch(html,/provider-query-failures|<details[^>]*open/);assert.match(html,/只重试未完成平台/);assert.doesNotMatch(html,/<strong>合计<\/strong>|<strong>全部汇总<\/strong>/);
  h.L.queryRetrying=true;h.render(direction);assert.match(h.html(),/已返回数据保留/);assert.match(h.html(),/onclick="liveRetryFailed\(\)" disabled/);assert.match(h.html(),/24,680\.50/);
 }
});
test('all failed platforms show unavailable amounts and counts rather than false zero totals',()=>{
 const h=fixture([]);h.L.results=[];h.L.queryPlatforms=[{id:'failure',name:'Failed platform'}];h.L.queryFailures=[{id:'failure',name:'Failed platform',message:'timeout'}];h.render();const html=h.html(),cards=html.split('<div class="provider-summary-kpis">')[1].split('<div class="provider-status-actions provider-toolbar">')[0];assert.match(html,/本次尚无平台返回/);assert.match(html,/已返回 0 \/ 1 个平台/);assert.doesNotMatch(cards,/<strong>0(?:\.00)?<\/strong>/);assert.match(cards,/代付成功金额<\/label><strong>—<\/strong>/);const footer=html.match(/<tfoot>([\s\S]*?)<\/tfoot>/)[1];assert.doesNotMatch(footer,/>0\.00</);assert.match(footer,/已读取合计/);
});
test('empty collection and payout tables remain loading until selected platform reads finish',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([]);h.L.queryPlatforms=Array.from({length:16},(_,i)=>({id:'read-'+i,name:'Read platform '+i}));h.L.results=[];h.L.loading=true;h.render(direction);
  assert.match(h.html(),/订单 0 \/ 16 · 读取中/);assert.match(h.html(),/role="status" data-query-read-state="loading">正在读取订单…尚无平台返回，不能判断是否有记录。/);assert.doesNotMatch(h.html(),/当前筛选范围没有已入库记录/);
  assert.match(h.html(),new RegExp('代'+(direction==='charge'?'收':'付')+'成功金额<\\/label><strong>—<\\/strong>'));
  assert.match(h.html(),/<tbody><\/tbody>/);assert.match(h.html(),/<tfoot>/);assert.equal(h.networkCalls(),0);
 }
});
test('failed paused and retrying empty reports cannot claim a completed empty query',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([]);h.L.queryPlatforms=[{id:'waiting',name:'Waiting platform'}];h.L.results=[];h.L.queryFailures=[{id:'waiting',name:'Waiting platform',message:'Synthetic timeout'}];h.render(direction);
  assert.match(h.html(),/data-query-read-state="incomplete">订单读取未完成，请重试。/);assert.doesNotMatch(h.html(),/当前筛选范围没有已入库记录/);
  h.L.queryPaused=true;h.render(direction);assert.match(h.html(),/data-query-read-state="paused">订单查询已暂停，请继续查询。/);assert.doesNotMatch(h.html(),/当前筛选范围没有已入库记录/);
  h.L.queryPaused=false;h.L.queryRetrying=true;h.render(direction);assert.match(h.html(),/data-query-read-state="retrying">正在重试订单读取…/);assert.doesNotMatch(h.html(),/当前筛选范围没有已入库记录/);assert.equal(h.networkCalls(),0);
 }
});
test('a returned zero platform does not make the missing platform an empty result',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([]),platforms=[{id:'read-zero',name:'Returned zero platform'},{id:'missing',name:'Missing platform'}];h.L.queryPlatforms=platforms;h.L.results=[{platform:platforms[0],groups:{provider:[]}}];h.L.queryFailures=[{...platforms[1],message:'Synthetic timeout'}];h.render(direction);
  assert.match(h.html(),/已返回 1 \/ 2 个平台；当前已读范围暂无记录，未返回平台不按 0 计算。/);assert.match(h.html(),/已读取合计/);assert.doesNotMatch(h.html(),/当前筛选范围没有已入库记录/);assert.equal(h.api.queryCoverage(h.L).partial,true);
  h.L.queryFailures=[];h.L.results.push({platform:platforms[1],groups:{provider:[]}});h.render(direction);assert.equal(h.api.queryCoverage(h.L).partial,false);assert.match(h.html(),/<div class="live-empty">当前筛选范围没有已入库记录<\/div>/);assert.doesNotMatch(h.html(),/provider-query-empty/);assert.equal(h.networkCalls(),0);
 }
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
  h.root.providerSummaryToggle(0);const children=breakdown(h.html());assert.equal(children.length,2);assert.match(h.html(),/>4,000\.00</);assert.match(h.html(),/>8,800\.00</);assert.match(h.html(),/工单提交、已处理、未处理六列按原支付订单号/);assert.doesNotMatch(h.html(),/去重列/);assert.equal(h.networkCalls(),0);
  assert(children.every(r=>r['成功金额']==='—'),'source-only cohorts must not pretend to have transaction amounts');
 }
});

test('compact provider reports keep complete single-line headings and give longer labels enough width',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([order('platform-a','ar',151093800,267877,{direction})]);h.render(direction);const html=h.html();
  const section=html.match(/<div class="[^"]*\bprovider-summary-table\b[^"]*">([\s\S]*?)<\/table>/)[1];
  const headers=[...section.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(m=>plain(m[1]).replace(/\s*[↕↑↓]$/,''));
  const widths=[...section.matchAll(/<col style="width:(\d+)px">/g)].map(m=>Number(m[1]));
  assert.equal(widths.length,headers.length);assert.equal(widths.length,direction==='charge'?26:23);
  assert(widths.slice(0,3).reduce((a,b)=>a+b,0)<=200,'identity columns balance readable labels with the numeric report');
  assert.doesNotMatch(section,/provider-heading-unit|<br\s*\/?\s*>/,'labels are not split into separate lines');
  headers.forEach((label,i)=>{const textWidth=Array.from(label).reduce((sum,char)=>sum+(/[^\x00-\x7f]/.test(char)?10:6),0);assert(widths[i]>=textWidth+12,label+' retains its complete text and spacing');});
  assert(widths[headers.indexOf('工单提交笔数')]>widths[headers.indexOf('全部笔数')],'long workorder headings get space without widening every count column');
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

function methodChild(channel_type,count,amount,success_count,success_amount){return {channel_type,all_count:count,all_amount:amount,created_success_count:success_count,created_success_amount:success_amount,success_count,success_amount};}
const lgMethods=[methodChild('QRIS-QR',120,120000,90,85000),methodChild('DANA',12,12000,2,1600),methodChild('OVO',6,6000,0,0),methodChild('LinkAja',3,3000,1,700)];
const lgPlatform={id:'local-lg',name:'LG111',country:'印尼',source:'lg',currency:'IDR',timezone:'Asia/Jakarta'};
function lgData(extra={}){return {provider:'ExamplePay',platformId:'local-lg',platform:'LG111',currency:'IDR',country:'印尼',direction:'charge',source:'lg',all_count:141,all_amount:141000,success_count:93,success_amount:87300,payment_method_rows:lgMethods,...extra}}
function lgResults(basis='created'){return new Map([['local-lg',{platform:lgPlatform,successBasis:basis}]]);}
test('LG111 uses actual source methods without additional reads or double counting',()=>{
 const leaf=lgData(),h=fixture([leaf]);Object.assign(h.L,{country:'印尼',currency:'IDR',results:[...lgResults().values()]});
 h.render('charge');assert.match(h.html(),/QRIS \/ DANA \/ OVO \/ LinkAja/);assert.doesNotMatch(h.html(),/provider-method-breakdown/);
 h.root.providerSummaryToggle(0);const html=h.html(),section=html.slice(html.indexOf('provider-method-breakdown'));
 assert.match(section,/85,000\.00/);assert.match(section,/120/);assert.match(section,/LinkAja/);assert.equal(h.networkCalls(),0);
 assert.equal((html.match(/class="provider-platform-row"/g)||[]).length,1);
 assert.equal(h.api.buildRows({orders:[leaf],issues:null,rates:[],country:'印尼',direction:'charge',plus,combine}).length,1);
 h.root.providerSummaryToggle(0);assert.doesNotMatch(h.html(),/provider-method-breakdown/);
});
test('method details respect existing query and distinguish missing rows, unknown amounts and other native platforms',()=>{
 const api=fixture([]).api,map=lgResults(),r=lgData();
 assert.equal(api.lg111Methods(r,map).rows.length,4);
 const bad=lgData({payment_method_rows:lgMethods.slice(1)});assert.equal(api.lg111Methods(bad,map).complete,false);
 const {payment_method_rows,...old}=r;assert.equal(api.lg111Methods(old,map).complete,false);
 assert.equal(api.lg111Methods({...r,platformId:'other'},map),null);
 assert.equal(api.lg111Methods({...r,direction:'withdraw'},map),null);
 assert.equal(api.lg111Methods({...r,currency:'INR'},map),null);
 assert.equal(api.lg111Methods({...r,nativeFeeIdentityVerified:false},map).complete,false);
 const nullRows=[methodChild('Bank',2,null,1,null)];const n=api.lg111Methods(lgData({all_count:2,all_amount:null,success_count:1,success_amount:null,payment_method_rows:nullRows}),map);
 assert.equal(n.complete,true);assert.equal(n.rows[0].method,'Bank');assert.equal(n.rows[0].success_amount,null);
 const nested={...r,items:[r,old]};delete nested.payment_method_rows;assert.equal(api.lg111Methods(nested,map).complete,false);
});
test('method groups reconcile independent success-window fields including zero separately from the creation cohort',()=>{
 const api=fixture([]).api;const rows=[{...methodChild('DANA',2,1000,1,300),success_count:3,success_amount:1200}];
 const row=lgData({all_count:2,all_amount:1000,success_count:3,success_amount:1200,payment_method_rows:rows});
 assert.equal(api.lg111Methods(row,lgResults('success')).rows[0].success_count,3);
 assert.equal(api.lg111Methods(row,lgResults('created')).complete,false);
});

const fiveId='acdeebb2-fb0a-e01b-e00d-c18506ecbe19';
const fivePlatform={id:fiveId,name:'55FIVE',country:'印尼',source:'ar',currency:'IDR',timezone:'Asia/Jakarta'};
const fiveMap=(basis='created')=>new Map([[fiveId,{platform:fivePlatform,successBasis:basis}]]);
const fiveMethod=(label,n,success)=>methodChild(label,n,null,success,null);
function fiveLeaf(extra={}){return {provider:'CoverPay',platformId:fiveId,platform:'55FIVE',currency:'IDR',country:'印尼',direction:'charge',source:'ar',
 nativeFeeIdentityVerified:true,payment_method_amount_basis:'unverified_source_currency',
 all_count:1395,all_amount:1200000,success_count:998,success_amount:950000,
 payment_method_rows:[fiveMethod('QRIS',1354,998),fiveMethod('OVO',41,0)],...extra};}
test('55FIVE uses verified IDR method counts without distributing the provider amount',()=>{
 const leaf=fiveLeaf(),h=fixture([leaf]);Object.assign(h.L,{country:'印尼',currency:'IDR',results:[...fiveMap().values()]});
 h.render('charge');assert.match(h.html(),/QRIS \/ OVO/);h.root.providerSummaryToggle(0);
 const html=h.html(),section=html.slice(html.indexOf('provider-method-breakdown')).split('</table>')[0];
 assert.match(section,/<td>QRIS<\/td><td>—<\/td><td>1,354<\/td><td>—<\/td><td>998<\/td>/);
 assert.match(section,/<td>OVO<\/td><td>—<\/td><td>41<\/td><td>—<\/td><td>0<\/td>/);
 assert.match(html,/1,200,000\.00/);assert.match(html,/950,000\.00/);assert.doesNotMatch(section,/1,200,000|950,000/);
 assert.equal(h.networkCalls(),0);assert.equal((html.match(/class="provider-platform-row"/g)||[]).length,1);
});
test('55FIVE requires exact registration, count-only proof, currency, counts and unknown amounts',()=>{
 const api=fixture([]).api,r=fiveLeaf(),map=fiveMap(),split=(x,m=map)=>api.indonesiaMethods(x,m);
 for(const change of [{payment_method_amount_basis:null},{payment_method_rows:undefined},{payment_method_rows:r.payment_method_rows.slice(1)},{nativeFeeIdentityVerified:false},{source:'lg'},{platform:'Other'},{success_count:997},{all_count:1394}])assert.equal(split({...r,...change}).complete,false);
 for(const change of [{all_count:null},{all_count:1354.1},{all_count:false},{all_count:[1354]},{all_amount:10},{success_amount:10},{created_success_amount:10},{platformId:'other'}])assert.equal(split({...r,payment_method_rows:[{...r.payment_method_rows[0],...change},r.payment_method_rows[1]]}).complete,false);
 for(const change of [{name:'OTHER'},{source:'newar'},{country:'印度'},{currency:'INR'},{id:'other'}])assert.equal(split(r,new Map([[fiveId,{platform:{...fivePlatform,...change},successBasis:'created'}]])),null);
 for(const change of [{platformId:'x'},{currency:'INR'},{direction:'withdraw'}])assert.equal(split({...r,...change}),null);
 assert.equal(split({...r,items:[r],payment_method_rows:undefined}).complete,false);
 const combined={...r,items:[r],all_count:0};delete combined.payment_method_rows;assert.equal(split(combined).complete,false);
});
test('55FIVE preserves unlabeled methods, multiple parts and the independent success basis',()=>{
 const h=fixture([]),r=fiveLeaf({provider:'BRI (PayIng)',all_count:131,success_count:115,payment_method_rows:[fiveMethod(null,131,115)]});
 const split=(x,map=fiveMap())=>h.api.indonesiaMethods(x,map);assert.equal(split(r).rows[0].method,'未标注');
 assert.equal(split({...r,provider:'未识别通道'}).rows[0].all_count,131);
 const independent={...r,success_count:137,payment_method_rows:[{...fiveMethod(null,131,115),success_count:137}]};assert.equal(split(independent,fiveMap('created')).complete,false);assert.equal(split(independent,fiveMap('success')).rows[0].success_count,137);
 const parts={...r,items:[r,r],all_count:262,success_count:230};delete parts.payment_method_rows;assert.equal(split(parts).rows[0].all_count,262);assert.equal(split(parts).rows[0].success_amount,null);
 const mixed={...parts,items:[r,lgData()],all_count:272,success_count:208};const scope=new Map([...fiveMap(),...lgResults()]);assert.equal(split(mixed,scope).complete,true);assert.equal(split({...mixed,items:[r,lgData({all_amount:1})]},scope).complete,false);
});

const duoliPlatforms=[
 ['FB168','b82bdd0d-59fe-361d-bbb7-2982231e5d0e'],['FB333','45785d2c-9a68-cd4a-6420-72b7a3004df5'],
 ['HOT985','f5c0d911-9277-ddad-58d3-a0fbe086ebcf'],['IND666','c0c3d321-c0b1-b115-cf15-0f336a793257'],
 ['UANG','143b5aa9-2f27-2405-ab40-99ffc25c56f2']
].map(([name,id])=>({id,name,source:'duoli',country:'印尼',currency:'IDR',timezone:'Asia/Jakarta'}));
function duoliLeaf(platform){
 return {provider:'NativePay',platformId:platform.id,platform:platform.name,source:platform.source,country:platform.country,
  direction:'charge',currency:platform.currency,all_count:5,all_amount:1200,success_count:2,success_amount:480,
  payment_method_rows:[methodChild('QRIS',3,700,2,480),methodChild('DANA',1,300,0,0),methodChild(null,1,200,0,0)]};
}
test('five native DOLI sites display the selected platform totals and expand received methods without requests',()=>{
 const groups=duoliPlatforms.map(duoliLeaf),h=fixture(groups);
 Object.assign(h.L,{country:'印尼',currency:'IDR',results:duoliPlatforms.map(platform=>({platform,successBasis:'created'}))});
 h.render('charge');assert.ok(h.html().includes('QRIS / DANA / 未标注'));
 h.root.providerSummaryToggle(0);const html=h.html();
 assert.equal((html.match(/class="provider-platform-row"/g)||[]).length,5);
 assert.equal((html.match(/<td>QRIS<\/td><td>700\.00<\/td><td>3<\/td><td>480\.00<\/td><td>2<\/td>/g)||[]).length,5);
 assert.equal(h.networkCalls(),0);
 const rows=h.api.indonesiaMethods({provider:'NativePay',direction:'charge',currency:'IDR',
   all_count:25,all_amount:6000,success_count:10,success_amount:2400,items:groups},
   new Map(h.L.results.map(result=>[result.platform.id,result]))).rows;
 assert.equal(rows.find(r=>r.method==='QRIS').all_amount,3500);
});
test('DOLI rejects wrong identities, incomplete old artifacts and leaked filter results; success uses the selected time basis',()=>{
 const platform=duoliPlatforms[0],leaf=duoliLeaf(platform),h=fixture([leaf]);
 const split=(row=leaf,p=platform,basis='created')=>h.api.indonesiaMethods(row,new Map([[p.id,{platform:p,successBasis:basis}]]));
 const {payment_method_rows,...old}=leaf;assert.equal(split(old).complete,false);
 assert.equal(split({...leaf,payment_method_rows:payment_method_rows.slice(1)}).complete,false);
 assert.equal(split(leaf,{...platform,name:'FB333'}),null);
 assert.equal(split(leaf,{...platform,source:'ar'}),null);
 assert.equal(split({...leaf,direction:'withdraw'}),null);
 assert.equal(split({...leaf,platform:'FB333'}).complete,false);
 assert.equal(split({...leaf,payment_method_rows:payment_method_rows.map(row=>({...row,platformId:duoliPlatforms[1].id}))}).complete,false);
 const independent={...leaf,success_count:6,success_amount:970,payment_method_rows:payment_method_rows.map((row,i)=>i?row:{...row,success_count:6,success_amount:970})};
 assert.equal(split(independent).complete,false);
 assert.equal(split(independent,platform,'success').rows[0].success_amount,970);
 const unknown={...leaf,all_amount:null,payment_method_rows:payment_method_rows.map((row,i)=>i?row:{...row,all_amount:null})};
 assert.equal(split(unknown).rows[0].all_amount,null);
});
