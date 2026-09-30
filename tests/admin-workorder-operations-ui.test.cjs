// Synthetic fixtures only. Verify manual query boundaries and independent data sources.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-workorder-operations.js'),'utf8');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const record={platform:'SYNTHETIC',country:'印度',currency:'INR',workorderId:'ID-1',workorderNo:'WORK-1',orderNo:'RC20260901SYNTHETIC',amount:'1234567890123456.12345678',statusCode:4,issueKind:'deposit',attachmentTypes:['pdf'],fieldGaps:['payment_order_no_missing'],provider:'<script>bad</script>',providers:['<script>bad</script>'],operatorAccount:'source-operator',lastUpdatedBy:'source-updater',submittedAt:'2026-09-27T01:00:00Z',operatedAt:'2026-09-27T02:00:00Z',sourceUpdatedAt:'2026-09-27T02:00:00Z',kycConnected:true,utrMatched:false,utr:'UTR-123456789',utrValues:['UTR-123456789'],statusCounts:{'4':1},kycCounts:{yes:1,no:0,unknown:0},utrCounts:{yes:0,no:1,unknown:0},ticketCount:1,processedTicketCount:1,rejectedTicketCount:0,latestSubmittedAt:'2026-09-27T01:00:00Z',latestOperatedAt:'2026-09-27T02:00:00Z'};
function harness(){let active='workorders',html='',drawer='',renders=0,response={sourceStatus:'ready',rows:[record],total:1,platforms:['SYNTHETIC']};const calls=[],root={},L={catalogReady:true,country:'印度',catalog:[{name:'SYNTHETIC',country:'印度',timezone:'Asia/Kolkata'}],from:'2026-09-01T00:00:00',to:'2026-09-27T23:59:59'};vm.runInNewContext(source,{window:root});let module;
 module=root.HensemLiveWorkorderOperations.create({L,E:escape,C:v=>String(v??0),formatTime:v=>v,box:(title,body)=>'<h2>'+title+'</h2>'+body,table:(headers,rows)=>'<table>'+headers.join('|')+rows.map(r=>r.join('|')).join('\n')+'</table>',request:async q=>{calls.push(q);return typeof response==='function'?response(q):response},render:()=>{renders++;html=module.render()},page:()=>active,openDrawer:(title,body)=>{drawer=title+body},renderDaily:()=>'OLD_DAILY_ONLY',loadDaily:async()=>{calls.push({action:'workorders'})}});
 return {root,module,L,calls,html:()=>html,drawer:()=>drawer,renders:()=>renders,setPage:p=>{active=p},respond:r=>{response=r}};
}
test('workorder page keeps compact sortable status/linkage columns without a redundant status column',async()=>{const h=harness();await h.module.load();assert.equal(h.calls[0].action,'workorderRecords');assert.equal(h.calls[0].view,'orders');assert.equal(h.calls[0].operation,'list');assert.equal(h.calls[0].country,'印度');assert.match(h.html(),/原支付订单号/);assert.match(h.html(),/已处理/);assert.match(h.html(),/已驳回/);assert.match(h.html(),/KYC连接/);assert.match(h.html(),/UTR匹配/);assert.match(h.html(),/workorderOperationsSort\('rejectedTicketCount'\)/);assert.match(h.html(),/workorderOperationsSort\('utr'\)/);assert.match(h.html(),/1,234,567,890,123,456\.12345678/);assert.match(h.html(),/UTR-123456789/);assert.match(h.html(),/title="UTR-123456789"/);assert.match(h.html(),/>是</);assert.match(h.html(),/>否</);assert.doesNotMatch(h.html(),/是 1|否 1|不匹配 1/);assert.match(h.html(),/&lt;script&gt;bad/);assert.doesNotMatch(h.html(),/工单状态\|/);assert.doesNotMatch(h.html(),/已连接|未连接|未核验|逐笔采集工单|旧工单日报|不代表支付订单已到账|<script>|编辑|保存/);});
test('sorting updates the display and keeps the clicked original-order row aligned',async()=>{const h=harness();const high={...record,orderNo:'RC-HIGH',ticketCount:3,processedTicketCount:2,rejectedTicketCount:1};h.respond(q=>q.operation==='orderDetail'?{rows:[record],total:1}:{sourceStatus:'ready',rows:[record,high],total:2,platforms:['SYNTHETIC']});await h.module.load();h.root.workorderOperationsSort('ticketCount');assert.match(h.html(),/RC-HIGH/);await h.root.workorderOperationsOriginal(0);assert.equal(h.calls.at(-1).filters.orderNo,'RC-HIGH');});
test('all supplied UTRs remain available on hover and click even when unmatched, after sorting',async()=>{
 const h=harness(),utrs=['CUSTOMER-UTR-12345678901234567890','UNMATCHED-<UTR>','CUSTOMER-UTR-12345678901234567890'];
 h.respond({sourceStatus:'ready',rows:[record,{...record,orderNo:'RC-ALL-UTRS',ticketCount:9,utrValues:utrs,utrCounts:{yes:0,no:9}}],total:2});
 await h.module.load();h.root.workorderOperationsSort('ticketCount');
 const before=h.calls.length;h.root.workorderOperationsUtrs(0);
 assert.match(h.html(),/title="CUSTOMER-UTR-12345678901234567890 \/ UNMATCHED-&lt;UTR&gt;"/);
 assert.match(h.drawer(),/RC-ALL-UTRS/);assert.match(h.drawer(),/UNMATCHED-&lt;UTR&gt;/);
 assert.equal((h.drawer().match(/CUSTOMER-UTR-12345678901234567890/g)||[]).length,1);
 assert.equal(h.calls.length,before);assert.doesNotMatch(h.html(),/width:max-content/);
});
test('typing stays local until query and querying a complete identifier permits cleared dates',async()=>{const h=harness();await h.module.load();const calls=h.calls.length,renders=h.renders();h.root.workorderOperationsSet('orderNo','ORDER-EXACT',false);assert.equal(h.calls.length,calls);assert.equal(h.renders(),renders);h.root.workorderOperationsClearDates();await h.module.load(true);assert.equal(h.calls.at(-1).filters.orderNo,'ORDER-EXACT');assert.equal(h.calls.at(-1).filters.from,'');assert.equal(h.calls.at(-1).filters.to,'');});
test('original-order detail shows source operator, processing time and linkage fields',async()=>{const h=harness();await h.module.load();h.respond({rows:[record],total:1});await h.root.workorderOperationsOriginal(0);const q=h.calls.at(-1);assert.equal(q.operation,'orderDetail');assert.equal(q.view,'orders');assert.equal(q.filters.platform,'SYNTHETIC');assert.equal(q.filters.issueKind,'deposit');assert.equal(q.filters.orderNo,record.orderNo);assert.match(h.drawer(),/source-operator/);assert.match(h.drawer(),/2026-09-27T02:00:00Z/);assert.match(h.drawer(),/KYC连接/);assert.match(h.drawer(),/UTR/);assert.match(h.drawer(),/已处理/);assert.doesNotMatch(h.drawer(),/payment_order_no_missing|https?:/);});
test('missing and workload keep separate query state and explicit source limitations',async()=>{const h=harness();h.setPage('workorder_reconciliation');h.respond({sourceStatus:'ready',rows:[],total:0,summary:{unknownOperationCount:4}});await h.module.load();assert.equal(h.calls.at(-1).view,'missing');assert.equal(h.calls.at(-1).filters.dateBasis,'operation');assert.match(h.html(),/当前授权范围内另有 4 条操作时间未确认/);h.root.workorderOperationsSet('registrationStatus','review');h.setPage('workorder_workload');await h.module.load();assert.equal(h.calls.at(-1).view,'workload');assert.equal(h.calls.at(-1).filters.registrationStatus,undefined);assert.match(h.html(),/不代表员工完整操作事件流水/);assert.doesNotMatch(h.html(),/onchange="workorderOperationsSet\('statusCode'/);});
test('operation logs have their own action and only supported filters; detail does not issue a new read',async()=>{const h=harness();h.setPage('workorder_operation_logs');h.respond({sourceStatus:'ready',rows:[{id:'event',createdAt:'2026-09-27T01:00:00Z',actorName:'synthetic',action:'follow',platform:'SYNTHETIC',workorders:['WORK-1'],orderNo:'ORDER-1',note:'<note>',before:{outcome:'pending'},after:{outcome:'success',untrusted:'should not show'}}],total:1});await h.module.load();assert.equal(h.calls[0].action,'portalOperationLogs');assert.deepEqual(Object.keys(h.calls[0].filters).sort(),['from','to','platform','operator','action','orderNo','workorderNo','utr'].sort());const n=h.calls.length;await h.root.workorderOperationsDetail(0);assert.equal(h.calls.length,n);assert.match(h.drawer(),/变更前.*变更后/);assert.match(h.drawer(),/&lt;note&gt;/);assert.doesNotMatch(h.drawer(),/untrusted|should not show/);});
test('pagination uses bounded size and an empty last page resets safely',async()=>{const h=harness();h.respond({sourceStatus:'ready',rows:[record],total:137});await h.module.load();h.module.state().current=7;h.respond({sourceStatus:'ready',rows:[],total:0});await h.module.load();assert.equal(h.module.state().current,1);assert.match(h.html(),/0–0/);h.root.workorderOperationsSize('500');assert.equal(h.module.state().size,20);assert.match(h.html(),/20 条 \/ 页/);assert.match(h.html(),/50 条 \/ 页/);assert.match(h.html(),/100 条 \/ 页/);});


test('business-month defaults respect local month boundaries, leap years and year rollover',()=>{
 const h=harness(),month=h.root.HensemWorkorderUI.currentMonth;
 for(const [country,instant,from,to] of [
  ['印度','2026-09-30T18:29:59Z','2026-09-01','2026-09-30'],
  ['印度','2026-09-30T18:30:00Z','2026-10-01','2026-10-31'],
  ['印度','2026-12-31T18:30:00Z','2027-01-01','2027-01-31'],
  ['印度','2028-02-20T00:00:00Z','2028-02-01','2028-02-29'],
  ['巴西','2026-10-01T01:00:00Z','2026-09-01','2026-09-30'],
  ['巴基斯坦','2026-09-30T19:00:00Z','2026-10-01','2026-10-31']]){const r=month(country,[],new Date(instant));assert.equal(r.from,from);assert.equal(r.to,to);}
});

test('workorder defaults and reset use seven days; daily mode preserves a manual range',async()=>{
 const h=harness(),range=h.root.HensemWorkorderUI.recentSevenDays('印度',h.L.catalog);
 assert.equal(h.module.state().draft.from,range.from);assert.equal(h.module.state().draft.to,range.to);
 h.root.workorderOperationsSet('from','2026-08-01');h.root.workorderOperationsReset();
 assert.equal(h.module.state().draft.from,range.from);assert.equal(h.module.state().draft.to,range.to);assert.equal(h.calls.length,0);
 await h.module.load();h.root.workorderOperationsMode('daily');
 assert.equal(h.L.from,range.from+'T00:00:00');assert.equal(h.L.to,range.to+'T23:59:59');
 h.L.from='2026-08-01T00:00:00';h.L.to='2026-08-31T23:59:59';h.root.workorderOperationsMode('records');h.root.workorderOperationsMode('daily');
 assert.equal(h.L.from,'2026-08-01T00:00:00');assert.equal(h.L.to,'2026-08-31T23:59:59');
});
