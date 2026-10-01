// Synthetic fixtures only. Verify manual query boundaries and independent data sources.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-workorder-operations.js'),'utf8');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const record={platform:'SYNTHETIC',country:'印度',currency:'INR',workorderId:'ID-1',workorderNo:'WORK-1',orderNo:'RC20260901SYNTHETIC',amount:'1234567890123456.12345678',statusCode:4,issueKind:'deposit',attachmentTypes:['pdf'],fieldGaps:['payment_order_no_missing'],provider:'<script>bad</script>'};
function harness(){let active='workorders',html='',drawer='',renders=0,response={sourceStatus:'ready',rows:[record],total:1,platforms:['SYNTHETIC']};const calls=[],root={closeDrawer:()=>{drawer=''}},L={catalogReady:true,country:'印度',catalog:[{name:'SYNTHETIC',country:'印度',timezone:'Asia/Kolkata'}],from:'2026-09-01T00:00:00',to:'2026-09-27T23:59:59'};vm.runInNewContext(source,{window:root});let module;
 module=root.HensemLiveWorkorderOperations.create({L,E:escape,C:v=>String(v??0),formatTime:v=>v,box:(title,body)=>'<h2>'+title+'</h2>'+body,table:(headers,rows)=>'<table>'+headers.join('|')+rows.map(r=>r.join('|')).join('\n')+'</table>',request:async q=>{calls.push(q);return typeof response==='function'?response(q):response},render:()=>{renders++;html=module.render()},page:()=>active,openDrawer:(title,body)=>{drawer=title+body},renderDaily:()=>'OLD_DAILY_ONLY',loadDaily:async()=>{calls.push({action:'workorders'})}});
 return {root,module,L,calls,html:()=>html,drawer:()=>drawer,renders:()=>renders,setPage:p=>{active=p},respond:r=>{response=r}};
}
const metricKeys=['ticketCount','ticketAmount','processedTicketCount','processedTicketAmount','unprocessedTicketCount','unprocessedTicketAmount','uniqueOrderCount','uniqueOrderAmount','uniqueProcessedCount','uniqueProcessedAmount','uniqueUnprocessedCount','uniqueUnprocessedAmount','kycYesCount','kycNoCount','kycUnknownCount','utrYesCount','utrNoCount','utrUnknownCount'];
const changes=(current,previous)=>Object.fromEntries(metricKeys.map(k=>[k,{delta:current[k]==null||previous[k]==null?null:String(Number(current[k])-Number(previous[k])),percent:current[k]==null||!Number(previous[k])?null:((Number(current[k])-Number(previous[k]))/Number(previous[k])*100).toFixed(2),previous:previous[k]}]));
const summary=(overrides={})=>{
 const current={ticketCount:20,ticketAmount:'1000.00000000',processedTicketCount:8,processedTicketAmount:'400.00000000',unprocessedTicketCount:12,unprocessedTicketAmount:'600.00000000',rejectedTicketCount:3,kycYesCount:11,kycNoCount:6,kycUnknownCount:3,utrYesCount:9,utrNoCount:8,utrUnknownCount:3,uniqueOrderCount:12,uniqueOrderAmount:'600.00000000',uniqueProcessedCount:5,uniqueProcessedAmount:'250.00000000',uniqueUnprocessedCount:7,uniqueUnprocessedAmount:'350.00000000',coverage:{status:'complete',missingOrderNumberCount:0,amountConflictCount:0,missingAmountCount:0,missingTicketAmountCount:0}},previous={...current,ticketCount:10,ticketAmount:'500.00000000',processedTicketCount:4,processedTicketAmount:'200.00000000',unprocessedTicketCount:6,unprocessedTicketAmount:'300.00000000',uniqueOrderCount:8,uniqueOrderAmount:'400.00000000',uniqueProcessedCount:3,uniqueProcessedAmount:'150.00000000',uniqueUnprocessedCount:5,uniqueUnprocessedAmount:'250.00000000',kycYesCount:4,kycNoCount:3,kycUnknownCount:3,utrYesCount:2,utrNoCount:5,utrUnknownCount:3};
 return {source:'AR',currency:'INR',sourceStatus:'ready',current,previous,startDate:'2026-09-27',endDate:'2026-09-27',comparison:{label:'昨日',startDate:'2026-09-26',endDate:'2026-09-26'},changes:changes(current,previous),...overrides};
};
const card=(html,key)=>html.match(new RegExp('data-stat="'+key+'"[\\s\\S]*?</section>'))?.[0]||'';
const linkageMetric=(html,key)=>html.match(new RegExp('data-stat="'+key+'"[\\s\\S]*?</div>'))?.[0]||'';
const plain=html=>html.replace(/<[^>]*>/g,'');
const response=(h,s=summary())=>h.respond(q=>q.operation==='summary'?s:{sourceStatus:'ready',rows:[record],total:137,platforms:['SYNTHETIC'],summary:{unknownOperationCount:999}});
const flush=()=>new Promise(r=>setImmediate(r));
test('summary is separate full-range request after list, cached across paging, default rolling seven days preserved',async()=>{const h=harness();response(h);await h.module.load();assert.equal(h.calls.length,2);assert.equal(h.calls[0].operation,'list');assert.equal(h.calls[1].operation,'summary');assert.equal(h.calls[1].limit,undefined);assert.equal(h.calls[1].offset,undefined);assert.deepEqual(h.calls[1].filters,h.calls[0].filters);const week=h.root.HensemWorkorderUI.recentSevenDays('印度',h.L.catalog);assert.equal(h.calls[0].filters.from,week.from);assert.equal(h.calls[0].filters.to,week.to);assert.match(h.html(),/已采集原始工单（不去重）/);assert.match(h.html(),/KYC连接/);assert.match(linkageMetric(h.html(),'kycYesCount'),/>是<\/span><strong>11<\/strong>/);assert.match(linkageMetric(h.html(),'kycNoCount'),/>否<\/span><strong>6<\/strong>/);assert.match(h.html(),/UTR匹配/);assert.match(linkageMetric(h.html(),'utrYesCount'),/>是<\/span><strong>9<\/strong>/);assert.match(linkageMetric(h.html(),'utrNoCount'),/>否<\/span><strong>8<\/strong>/);assert.match(plain(card(h.html(),'ticketCount')),/昨日：10 笔 · 500\.00 INR笔数增减 \+10（\+100\.00%）/);assert.match(plain(card(h.html(),'ticketCount')),/金额增减 \+500\.00（\+100\.00%）/);assert.doesNotMatch(h.html(),/999 条操作时间未确认/);h.module.state().current=2;await h.module.load();assert.equal(h.calls.filter(q=>q.operation==='summary').length,1);assert.equal(h.calls.at(-1).offset,20);});
test('missing original IDs affect unique comparisons without hiding accurate raw ticket comparisons',async()=>{const h=harness(),s=summary();s.current.coverage={...s.current.coverage,status:'partial',missingOrderNumberCount:2};response(h,s);await h.module.load();assert.match(plain(card(h.html(),'ticketCount')),/昨日：10 笔 · 500\.00 INR笔数增减 \+10（\+100\.00%）/);assert.match(plain(card(h.html(),'ticketCount')),/金额增减 \+500\.00（\+100\.00%）/);assert.match(card(h.html(),'uniqueOrderCount'),/未提供可比值或覆盖不完整/);assert.match(h.html(),/2 张缺原单号，未去重/);assert.doesNotMatch(h.html(),/NEWAR 明细尚未纳入/);assert.doesNotMatch(h.html(),/已到账原单/);});
test('unavailable originals display dashes and zero prior preserves actual delta without a fabricated percentage',async()=>{
 const h=harness(),s=summary();
 for(const k of metricKeys){s.previous[k]=0;if(k.startsWith('unique'))s.current[k]=null;}
 s.current.coverage={status:'unavailable',missingOrderNumberCount:20};s.changes=changes(s.current,s.previous);
 response(h,s);await h.module.load();
 assert.match(card(h.html(),'uniqueOrderCount'),/<strong>—<\/strong><span>笔 · — INR/);
 assert.match(plain(card(h.html(),'ticketCount')),/昨日：0 笔 · 0\.00 INR笔数增减 \+20（前期为 0，增幅不适用）/);
 assert.match(plain(card(h.html(),'ticketCount')),/金额增减 \+1,000\.00（前期为 0，增幅不适用）/);
 assert.doesNotMatch(h.html(),/Infinity|NaN|100\.00%/);
});
test('summary failure preserves record list and explicit retry recovers',async()=>{const h=harness();h.respond(q=>{if(q.operation==='summary')throw Error('统计暂时超时');return {sourceStatus:'ready',rows:[record],total:1}});await h.module.load();assert.match(h.html(),/RC20260901SYNTHETIC/);assert.match(h.html(),/统计读取失败/);response(h);await h.root.workorderOperationsSummaryRetry();assert.match(h.html(),/总工单/);assert.doesNotMatch(h.html(),/统计读取失败/);});
test('new filters isolate late summary responses and query does not reuse stale totals',async()=>{const h=harness();let complete;h.respond(q=>q.operation==='summary'?new Promise(r=>{complete=r}):{sourceStatus:'ready',rows:[record],total:1});const old=h.module.load();await flush();assert(complete);const late=complete;h.root.workorderOperationsSet('platform','NEW',false);const newer=summary();newer.current.ticketCount=77;response(h,newer);await h.module.load(true);late(summary());await old;assert.equal(h.module.state().analysis.current.ticketCount,77);assert.equal(h.calls.at(-1).filters.platform,'NEW');});
 test('grouped original orders open scoped all-history drawer with stable full pagination',async()=>{const h=harness();h.respond(q=>q.operation==='summary'?summary():q.operation==='orderDetail'?{rows:Array.from({length:q.offset===100?5:20},(_,i)=>({...record,workorderId:'ASSOCIATED-'+(q.offset+i),submittedAt:'2026-08-01T00:00:00Z',operatedAt:'2026-08-01T01:00:00Z',sourcePlatform:'SYNTHETIC',operatorAccount:'source-operator'})),total:105}:{sourceStatus:'ready',rows:[{...record,ticketCount:2,processedTicketCount:1,processed:true,providers:['<untrusted>'],operators:['operator'],amountStatus:'known'}],total:1});await h.root.workorderOperationsMode('orders');assert.equal(h.calls.length,0);await h.module.load(true);assert.equal(h.calls[0].view,'orders');assert.match(h.html(),/原支付订单号/);assert.match(h.html(),/&lt;untrusted&gt;/);await h.root.workorderOperationsOriginal(0);let q=h.calls.at(-1);assert.deepEqual(JSON.parse(JSON.stringify(q.filters)),{platform:'SYNTHETIC',issueKind:'deposit',orderNo:record.orderNo});assert.equal(q.operation,'orderDetail');assert.equal(q.filters.from,undefined);assert.doesNotMatch(h.drawer(),/包含列表日期之外的记录/);assert.match(h.drawer(),/source-operator/);assert.match(h.drawer(),/KYC连接/);assert.match(h.drawer(),/UTR/);assert.match(h.drawer(),/共 <b>105<\/b>/);await h.root.workorderOriginalPage(6);q=h.calls.at(-1);assert.equal(q.offset,100);assert.match(h.drawer(),/101–105/);assert.match(h.drawer(),/ASSOCIATED-104/);});
test('query click and Enter, including page jump, avoid native form submission in sandbox',async()=>{const h=harness();response(h);await h.module.load();assert.match(h.html(),/<button type="button" onclick="workorderOperationsLoad\(true\)"/);assert.match(h.html(),/onkeydown="if\(event.key==='Enter'/);assert.match(h.html(),/workorderOperationsJump\(this.form.elements.page.value\)/);assert.doesNotMatch(h.html(),/type="submit"/);h.root.workorderOperationsSet('dateBasis','operation');await h.module.load(true);assert.doesNotMatch(h.html(),/999 条操作时间未确认/);});
test('Enter handlers ignore IME, key repeat and unrelated controls but retain valid query and page jumps',async()=>{const h=harness();response(h);await h.module.load();const handlers=[...h.html().matchAll(/onkeydown="([^"]+)"/g)].map(m=>m[1]);const query=handlers.find(x=>x.includes('workorderOperationsLoad')),jump=handlers.find(x=>x.includes('workorderOperationsJump'));let loads=0,jumps=0,prevented=0;const run=(code,extra={})=>vm.runInNewContext('(function(){'+code+'}).call(form)',{event:{key:'Enter',isComposing:false,repeat:false,keyCode:13,target:{tagName:'INPUT',name:'page'},preventDefault:()=>prevented++,...extra},form:{elements:{page:{value:'6'}}},workorderOperationsLoad:()=>loads++,workorderOperationsJump:()=>jumps++});for(const code of [query,jump]){run(code,{isComposing:true});run(code,{repeat:true});run(code,{keyCode:229});run(code,{key:'Escape'});}assert.equal(loads+jumps,0);run(query,{target:{tagName:'BUTTON'}});run(jump,{target:{tagName:'INPUT',name:'other'}});assert.equal(loads+jumps,0);run(query);run(jump);assert.equal(loads,1);assert.equal(jumps,1);assert.equal(prevented,2);});

test('closing original or ticket drawer prevents late reads from reopening it',async()=>{for(const original of [true,false]){const h=harness();response(h);await h.module.load();let finish;h.respond(()=>new Promise(r=>{finish=r}));const pending=original?h.root.workorderOperationsOriginal(0):h.root.workorderOperationsDetail(0);assert(h.drawer());h.root.closeDrawer();assert.equal(h.drawer(),'');finish(original?{rows:[record],total:1}:{row:record});await pending;assert.equal(h.drawer(),'');}});

test('country-specific columns, complete remaining statuses and action header keep rows aligned',async()=>{
 const h=harness();h.L.country='马来';h.L.catalog.push({name:'MY-TEST',country:'马来',timezone:'Asia/Kuala_Lumpur'});
 h.respond(q=>q.operation==='summary'?summary({currency:'MYR'}):{rows:[{...record,platform:'MY-TEST',country:'马来',ticketCount:3,processedTicketCount:0,rejectedTicketCount:2,statusCounts:{1:0,2:1,3:2,4:0,5:0},providers:['FPay']}],total:1});
 await h.module.load();assert.match(h.html(),/处理中 1/);assert.match(h.html(),/其他状态/);assert.match(h.html(),/最后处理时间.*操作/);assert.doesNotMatch(h.html(),/KYC连接|UTR匹配|>UTR</);
 h.root.workorderOperationsSet('utr','INDIA-ONLY',false);h.root.workorderOperationsSet('kyc','yes',false);h.root.workorderOperationsSet('country','马来');assert.equal(h.module.state().draft.utr,'');assert.equal(h.module.state().draft.kyc,'');
});
test('provider shares use full-range direction totals and all aliases remain server-classified',async()=>{
 const h=harness(),s=summary();s.byProvider=[{issueKind:'deposit',provider:'FPay',ticketCount:9,ticketAmount:'900',uniqueOrderCount:5,uniqueOrderAmount:'500',processedTicketCount:4,rejectedTicketCount:3,statusCounts:{2:2}},{issueKind:'deposit',provider:'TruePay',ticketCount:3,ticketAmount:'300',uniqueOrderCount:3,uniqueOrderAmount:'300',processedTicketCount:2,rejectedTicketCount:1},{issueKind:'withdraw',provider:'FPay',ticketCount:20,ticketAmount:'2000',uniqueOrderCount:10,uniqueOrderAmount:'1000'}];
 response(h,s);await h.module.load();assert.match(h.html(),/存款 · 三方工单分布/);assert.match(h.html(),/取款 · 三方工单分布/);assert.match(h.html(),/75.00%/);assert.match(h.html(),/62.50%/);assert.match(h.html(),/原始金额/);assert.match(h.html(),/去重金额/);assert.match(h.html(),/处理中 2/);const calls=h.calls.length;h.root.workorderProviderSort('uniqueOrderCount');assert.equal(h.calls.length,calls);assert.equal(h.module.state().providerSort.key,'uniqueOrderCount');
});

test('withdrawals missing every original order number retain raw totals and never show deduplicated zero',async()=>{
 const h=harness(),s=summary();s.byProvider=[{issueKind:'withdraw',provider:'KnownPay',ticketCount:1100,ticketAmount:'220000',uniqueOrderCount:0,uniqueOrderAmount:'0',processedTicketCount:700,rejectedTicketCount:400,coverage:{missingOrderNumberCount:1100}}];response(h,s);await h.module.load();
 const distribution=h.html().match(/<details class="wo-provider-analysis"[^>]*>([\s\S]*?)<\/details>/)[1];assert.match(distribution,/原始 1100 笔 \/ 1100 条缺原单号，去重暂不可计算/);assert.doesNotMatch(distribution,/去重 0 笔/);assert.match(distribution,/KnownPay<\/span>\|1100\|220,000\.00\|100\.00%\|—\|—\|—\|700\|400/);
});

test('raw and unique handling statistics retain independent amounts and explicitly label collected scope',async()=>{
 const h=harness();response(h);await h.module.load();const html=h.html();
 assert.match(html,/已采集原始工单（不去重）/);assert.match(html,/已采集原支付订单（去重）/);
 assert.match(plain(card(html,'ticketCount')),/总工单20笔 · 1,000\.00 INR/);
 assert.match(plain(card(html,'processedTicketCount')),/已处理工单8笔 · 400\.00 INR/);
 assert.match(plain(card(html,'unprocessedTicketCount')),/未处理 \/ 驳回工单12笔 · 600\.00 INR.*昨日：6 笔 · 300\.00 INR.*金额增减 \+300\.00（\+100\.00%）/);
 assert.match(plain(card(html,'uniqueOrderCount')),/原支付订单总数12笔 · 600\.00 INR/);
 assert.match(plain(card(html,'uniqueProcessedCount')),/已有已处理记录5笔 · 250\.00 INR/);
 assert.match(plain(card(html,'uniqueUnprocessedCount')),/尚无已处理记录7笔 · 350\.00 INR.*昨日：5 笔 · 250\.00 INR.*笔数增减 \+2（\+40\.00%）/);
 assert.match(card(html,'uniqueUnprocessedCount'),/title="当前筛选范围内，该原单没有状态为 4 的已采集工单，包含已驳回，不等同于仍待处理"/);
 assert.match(html,/源后台待处理（状态 1）当前被采集器跳过/);assert.match(html,/已处理也不代表原支付订单到账/);
});
test('zero, missing and unknown linkage values remain distinct and use returned comparisons',async()=>{
 const h=harness(),s=summary();Object.assign(s.current,{kycYesCount:0,kycNoCount:20,kycUnknownCount:0,utrYesCount:null,utrNoCount:undefined,utrUnknownCount:0});
 Object.assign(s.previous,{kycYesCount:4,kycNoCount:3,kycUnknownCount:3,utrUnknownCount:0});s.changes=changes(s.current,s.previous);response(h,s);await h.module.load();const html=h.html();
 assert.match(plain(linkageMetric(html,'kycYesCount')),/是0(?:0\.00%)昨日 4 笔 · 占比 40\.00%增减 -4（-100\.00%）/);
 assert.match(plain(linkageMetric(html,'kycUnknownCount')),/未提供0(?:0\.00%)昨日 3 笔 · 占比 30\.00%增减 -3（-100\.00%）/);
 assert.match(plain(linkageMetric(html,'utrYesCount')),/是——昨日 2 笔 · 占比 20\.00%未提供可比值或覆盖不完整/);
 assert.match(plain(linkageMetric(html,'utrNoCount')),/否—/);
 assert.match(plain(linkageMetric(html,'utrUnknownCount')),/未提供0(?:0\.00%)昨日 0 笔 · 占比 0\.00%增减 0（前期为 0，增幅不适用）/);
 assert.doesNotMatch(html,/NaN|Infinity/);
});
test('missing amounts or server deltas never become client-subtracted estimates',async()=>{
 const h=harness(),s=summary();s.current.unprocessedTicketAmount=null;s.current.uniqueUnprocessedAmount=null;
 s.current.coverage.missingTicketAmountCount=1;s.current.coverage.amountConflictCount=1;
 delete s.changes.unprocessedTicketCount;delete s.changes.kycYesCount;response(h,s);await h.module.load();
 assert.match(plain(card(h.html(),'unprocessedTicketCount')),/12笔 · — INR.*笔数未返回增减值.*金额未提供可比值或覆盖不完整/);
 assert.match(plain(card(h.html(),'uniqueUnprocessedCount')),/7笔 · — INR.*笔数增减 \+2.*金额未提供可比值或覆盖不完整/);
 assert.match(plain(linkageMetric(h.html(),'kycYesCount')),/未返回增减值/);
 assert.match(h.html(),/1 个原单金额不一致；1 张工单缺金额/);
});
test('summary scope and comparison calendar remain committed while query controls are edited',async()=>{
 const h=harness(),s=summary({startDate:'2026-09-20',endDate:'2026-09-24',comparison:{label:'前5天',startDate:'2026-09-15',endDate:'2026-09-19'}});
 h.root.workorderOperationsSet('from','2026-09-20',false);h.root.workorderOperationsSet('to','2026-09-24',false);h.root.workorderOperationsSet('platform','SYNTHETIC',false);response(h,s);await h.module.load(true);
 const before=h.calls.length;h.root.workorderOperationsSet('country','马来');h.root.workorderOperationsSet('from','2026-10-01');h.root.workorderOperationsSet('issueKind','withdraw');
 const scope=h.html().match(/<div class="wo-analysis-scope">[\s\S]*?<\/div>/)[0];
 assert.match(scope,/印度 · 全部团队 · SYNTHETIC · 全部业务 · 全部状态 · 提交日期 2026-09-20 至 2026-09-24/);
 assert.match(scope,/对比 前5天：2026-09-15 至 2026-09-19/);assert.doesNotMatch(scope,/马来|2026-10-01|提款/);
 assert.match(h.html(),/data-stat="kycYesCount"/);assert.match(plain(card(h.html(),'ticketCount')),/前5天：10 笔/);assert.equal(h.calls.length,before);
});
test('history identifier queries do not invent yesterday or growth',async()=>{
 const h=harness(),s=summary({previous:null,comparison:null,startDate:null,endDate:null,changes:{}});
 h.root.workorderOperationsClearDates();h.root.workorderOperationsSet('workorderNo','WORK-1',false);response(h,s);await h.module.load(true);
 assert.match(h.html(),/完整编号历史范围/);assert.match(h.html(),/完整编号历史查询，不作日期对比/);
 assert.doesNotMatch(h.html(),/昨日|NaN|Infinity/);assert.match(plain(card(h.html(),'ticketCount')),/前期：— 笔 · — INR/);
});
test('compact primary filters expose business status and both order searches, with India-only unknown filters supported',async()=>{
 const h=harness();response(h);await h.module.load();
 const primary=h.html().split('<div class="wo-filter-grid wo-records-primary">')[1].split('<div class="wo-filter-grid wo-more"')[0];
 for(const label of ['工单业务','工单状态','工单号','支付订单号','提交开始日期','提交结束日期'])assert.match(primary,new RegExp('aria-label="'+label+'"'));
 assert.match(primary,/class="wo-filter-dates"/);assert.match(h.html(),/class="wo-filter-grid wo-more" hidden/);
 const calls=h.calls.length;h.root.workorderOperationsMore();h.root.workorderOperationsSet('kyc','unknown',false);h.root.workorderOperationsSet('utrMatch','unknown',false);assert.equal(h.calls.length,calls);
 await h.module.load(true);assert.equal(h.calls.at(-1).filters.kyc,'unknown');assert.equal(h.calls.at(-1).filters.utrMatch,'unknown');
 for(const page of ['workorder_reconciliation','workorder_workload','workorder_operation_logs']){h.setPage(page);h.respond({rows:[],total:0});await h.module.load();assert.match(h.html(),/aria-label="支付订单号"/);assert.equal((h.html().match(/aria-label="UTR"/g)||[]).length,1);}
});

test('missing original numbers label only visible unique metrics partial beside cards, with coverage before statistics',async()=>{
 const h=harness(),s=summary();s.current.coverage={...s.current.coverage,status:'partial',missingOrderNumberCount:1100};s.byProvider=[{provider:'FPay',issueKind:'deposit',ticketCount:20}];response(h,s);await h.module.load();const html=h.html();
 for(const key of ['uniqueOrderCount','uniqueProcessedCount','uniqueUnprocessedCount']){
  assert.match(card(html,key),new RegExp('data-coverage-for="'+key+'"[^>]*>部分</em>'));
  assert.match(card(html,key),new RegExp('data-coverage-for="'+key.replace('Count','Amount')+'"[^>]*>部分</em>'));
 }
 for(const key of ['ticketCount','processedTicketCount','unprocessedTicketCount'])assert.doesNotMatch(card(html,key),/wo-stat-partial/);
 assert.match(html,/title="1100 张工单缺原单号，未计入去重"/);
 assert(html.indexOf('数据覆盖：')<html.indexOf('<div class="wo-analysis-groups">'));
 assert.equal((html.match(/数据覆盖：/g)||[]).length,1);
});
test('amount gaps label unique amounts without marking complete counts or raw data partial',async()=>{
 const h=harness(),s=summary();s.current.coverage={...s.current.coverage,status:'partial',amountConflictCount:2,missingAmountCount:1};response(h,s);await h.module.load();
 for(const key of ['uniqueOrderCount','uniqueProcessedCount','uniqueUnprocessedCount']){
  assert.doesNotMatch(card(h.html(),key),new RegExp('data-coverage-for="'+key+'"'));
  assert.match(card(h.html(),key),new RegExp('data-coverage-for="'+key.replace('Count','Amount')+'"[^>]*>部分</em>'));
 }
 assert.match(h.html(),/title="2 个原单金额不一致；1 个原单缺金额"/);
 assert.doesNotMatch(card(h.html(),'ticketCount'),/wo-stat-partial/);
 s.current.uniqueOrderAmount=null;response(h,s);await h.module.load(true);
 assert.doesNotMatch(card(h.html(),'uniqueOrderCount'),/data-coverage-for="uniqueOrderAmount"/);
 assert.match(plain(card(h.html(),'uniqueOrderCount')),/笔 · — INR/);
});
test('complete statistics and previous-only gaps never mark current values partial',async()=>{
 const h=harness(),s=summary();s.previous.coverage={...s.previous.coverage,missingOrderNumberCount:2};response(h,s);await h.module.load();
 assert.doesNotMatch(h.html(),/class="wo-stat-partial"/);assert.doesNotMatch(h.html(),/数据覆盖：/);
 assert.match(card(h.html(),'uniqueOrderCount'),/未提供可比值或覆盖不完整/);
 s.previous.coverage={...s.previous.coverage,missingOrderNumberCount:0};response(h,s);await h.module.load(true);
 assert.doesNotMatch(h.html(),/class="wo-stat-partial"/);assert.match(plain(card(h.html(),'uniqueOrderCount')),/笔数增减 \+4（\+50\.00%）/);
});


test('KYC and UTR shares include unknown tickets, use each period denominator and show percentage points separately',async()=>{
 const h=harness();response(h);await h.module.load();const html=h.html(),yes=plain(linkageMetric(html,'kycYesCount')),unknown=plain(linkageMetric(html,'kycUnknownCount'));
 assert.match(html,/占已采集原始工单 20 笔 · 含未提供/);
 assert.match(yes,/是1155\.00%昨日 4 笔 · 占比 40\.00%增减 \+7（\+175\.00%）占比增减 \+15\.00 个百分点/);
 assert.match(plain(linkageMetric(html,'kycNoCount')),/否630\.00%.*占比增减 0\.00 个百分点/);
 assert.match(unknown,/未提供315\.00%昨日 3 笔 · 占比 30\.00%.*占比增减 -15\.00 个百分点/);
 assert.match(plain(linkageMetric(html,'utrYesCount')),/是945\.00%昨日 2 笔 · 占比 20\.00%.*占比增减 \+25\.00 个百分点/);
});
test('linkage shares never turn missing or zero denominators into 0 percent and retain known counts',async()=>{
 for(const total of [0,null,undefined]){
  const h=harness(),s=summary();s.current.ticketCount=total;s.previous.ticketCount=total;response(h,s);await h.module.load();
  const yes=plain(linkageMetric(h.html(),'kycYesCount'));assert.match(yes,/是11—昨日 4 笔 · 占比 —/);assert.match(yes,/占比增减 —/);assert.doesNotMatch(yes,/NaN|Infinity|个百分点/);
 }
 const h=harness(),s=summary();s.current.kycYesCount=null;response(h,s);await h.module.load();
 assert.match(plain(linkageMetric(h.html(),'kycYesCount')),/是——.*占比增减 —/);
 assert.match(plain(linkageMetric(h.html(),'kycNoCount')),/否630\.00%/);
});
test('linkage comparison uses the committed multi-day label and never invents history comparisons',async()=>{
 const h=harness(),s=summary({comparison:{label:'前5天',startDate:'2026-09-15',endDate:'2026-09-19'}});response(h,s);await h.module.load();
 assert.match(plain(linkageMetric(h.html(),'kycYesCount')),/前5天 4 笔 · 占比 40\.00%/);
 assert.doesNotMatch(linkageMetric(h.html(),'kycYesCount'),/昨日/);
 s.comparison=null;s.previous=null;s.changes={};response(h,s);await h.module.load(true);
 assert.match(plain(linkageMetric(h.html(),'kycYesCount')),/55\.00%.*无日期对比/);assert.doesNotMatch(linkageMetric(h.html(),'kycYesCount'),/个百分点/);
});

test('both provider distributions follow the original-order table while all six overview metrics and linkage shares stay above it',async()=>{
 const h=harness(),s=summary();s.byProvider=[{issueKind:'deposit',provider:'PayOne',ticketCount:10,ticketAmount:'500',uniqueOrderCount:8,uniqueOrderAmount:'400'},{issueKind:'withdraw',provider:'PayTwo',ticketCount:10,ticketAmount:'500',uniqueOrderCount:4,uniqueOrderAmount:'200'}];response(h,s);await h.module.load();
 const html=h.html(),tableAt=html.indexOf('<h2>原支付订单（按平台、完整原单号去重）</h2>'),first=html.indexOf('<details class="wo-provider-analysis"');
 assert(tableAt>0&&first>tableAt);assert(html.indexOf('存款 · 三方工单分布')>tableAt);assert(html.indexOf('取款 · 三方工单分布')>tableAt);
 for(const key of ['ticketCount','processedTicketCount','unprocessedTicketCount','uniqueOrderCount','uniqueProcessedCount','uniqueUnprocessedCount'])assert(html.indexOf('data-stat="'+key+'"')<tableAt);
 for(const key of ['kycYesCount','kycNoCount','kycUnknownCount','utrYesCount','utrNoCount','utrUnknownCount'])assert(html.indexOf('data-stat="'+key+'"')<tableAt);
 assert.equal((html.match(/<details class="wo-provider-analysis"/g)||[]).length,2);
});
