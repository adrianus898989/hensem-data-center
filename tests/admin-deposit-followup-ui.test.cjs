// Synthetic records and transport only; no production data or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-deposit-issues.js'),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(response={rows:[],total:0,summary:{}},options={}){
 let instant=options.now||'2026-09-30T12:00:00Z';const country=options.country||'印度';
 class Clock extends Date {constructor(...args){super(...(args.length?args:[instant]))}static now(){return Date.parse(instant)}}
 const L={catalogReady:true,catalog:[{country,name:'SYNTHETIC',...(options.timezone?{timezone:options.timezone}:{})}],country,from:'2026-09-01T00:00:00',to:'2026-09-27T23:59:59',depositIssuesPage:1,depositIssuesSize:20,depositIssuesSerial:0,depositIssuesPlatform:'all',depositIssuesProvider:'',depositIssuesStatus:'all',depositIssuesQuery:''},calls=[];
 let html='',drawer='',renders=0,page,route=options.page||'deposit_tracking',handler=async()=>response;
 const root={document:options.document,setInterval:options.setInterval,clearInterval:options.clearInterval};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-workorder-operations.js'),'utf8'),{window:root,Date:Clock});vm.runInNewContext(source,{window:root,Date:Clock});
 page=root.HensemLiveDepositIssues.create({L,E:escape,C:v=>String(v??0),N:v=>Number(v).toFixed(2),R:(a,b)=>b?String(a/b*100):'—',formatTime:v=>v,
  metric:(title,value)=>'<div>'+title+':'+value+'</div>',box:(title,body)=>'<section><h2>'+title+'</h2>'+body+'</section>',pager:(total,p,size)=>'<footer data-total="'+total+'">'+p+'/'+size+'</footer>',
  table:(headers,rows,classes)=>'<div class="'+classes+'"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>',
  openDrawer:options.drawer===false?undefined:(title,body)=>{drawer=title+body},page:()=>route,render:()=>{renders++;html=page.render()},request:async q=>{calls.push({...q});return handler(q)}});
 root.setPage=value=>{route=value;void page.load(true)};
 return {L,root,page,calls,html:()=>html,drawer:()=>drawer,renders:()=>renders,setHandler:next=>{handler=next},setNow:value=>{instant=value},setRoute:value=>{route=value}};
}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))};

test('follow-up and statistics Today stage one local day, preserve filters and require explicit Query',async()=>{
 for(const page of ['deposit_tracking','deposit_statistics'])for(const [country,timezone,date]of [['印度','Asia/Kolkata','2026-10-01'],['巴西','America/Sao_Paulo','2026-09-30'],['平台时区','Pacific/Auckland','2026-10-01']]){
  const h=harness(undefined,{page,country,timezone,now:'2026-09-30T18:30:00Z'});h.page.render();h.root.depositIssuesSet('orderNumber','EXACT-ORDER');h.root.depositIssuesSet('utr','000123');h.root.depositIssuesSet('dateMode','all');
  assert.equal((h.page.render().match(/>今天<\/button>/g)||[]).length,1);h.root.depositIssuesToday();assert.equal(h.calls.length,0);assert.equal(h.L.depositIssuesDirty,true);
  assert.equal(h.L.depositIssuesDateMode,'range');assert.equal(h.L.from,date+'T00:00:00');assert.equal(h.L.to,date+'T23:59:59');
  await h.page.load(true);assert.equal(h.calls[0].startAt,date+'T00:00:00.000Z');assert.equal(h.calls[0].endAt,date+'T23:59:59.000Z');assert.equal(h.calls[0].orderNumber,'EXACT-ORDER');assert.equal(h.calls[0].utr,'000123');
 }
});
test('Today stops follow-up refresh until Query and ignores a late old-period response',async()=>{
 const h=harness();let resolve;h.setHandler(()=>new Promise(r=>{resolve=r}));const loading=h.page.load();await settle();
 h.root.depositIssuesToday();assert.equal(h.L.depositIssuesLoading,false);assert.equal(h.L.depositIssuesDirty,true);h.root.depositIssuesRefresh();assert.equal(h.calls.length,1);
 resolve({rows:[{orderNumber:'OLD-PERIOD'}],summary:{count:1},total:1});await loading;assert.equal(h.L.depositIssues,undefined);assert.doesNotMatch(h.html(),/OLD-PERIOD/);
});

test('follow-up and statistics initialize seven local business days without querying, including date boundaries',async()=>{
 for(const page of ['deposit_tracking','deposit_statistics'])for(const [country,timezone,now,from,to] of [
  ['印度','Asia/Kolkata','2026-09-30T18:30:00Z','2026-09-25','2026-10-01'],
  ['巴西','America/Sao_Paulo','2026-09-30T18:30:00Z','2026-09-24','2026-09-30'],
  ['印度','Asia/Kolkata','2026-12-31T18:30:00Z','2026-12-26','2027-01-01'],
  ['印度','Asia/Kolkata','2024-03-01T00:00:00Z','2024-02-24','2024-03-01'],
  ['平台时区','Pacific/Auckland','2026-09-30T18:30:00Z','2026-09-25','2026-10-01']]){
  const h=harness(undefined,{page,country,timezone,now});h.page.render();assert.equal(h.calls.length,0);
  assert.equal(h.L.from,from+'T00:00:00');assert.equal(h.L.to,to+'T23:59:59');
  await h.page.load();assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,page==='deposit_statistics'?'depositStatistics':'depositIssues');
  assert.equal(h.calls[0].startAt,from+'T00:00:00.000Z');assert.equal(h.calls[0].endAt,to+'T23:59:59.000Z');
 }
});

test('manual dates and the month shortcut persist until reset restores the current local seven days',async()=>{
 for(const page of ['deposit_tracking','deposit_statistics']){
  const h=harness(undefined,{page,now:'2026-09-30T18:29:59Z'});h.page.render();
  h.root.depositIssuesDate('from','2026-08-02');h.root.depositIssuesDate('to','2026-08-05');
  h.setNow('2026-09-30T18:30:00Z');h.page.render();assert.equal(h.L.from,'2026-08-02T00:00:00');assert.equal(h.L.to,'2026-08-05T23:59:59');
  h.root.depositIssuesMonth();assert.equal(h.L.from,'2026-10-01T00:00:00');assert.equal(h.L.to,'2026-10-31T23:59:59');assert.equal(h.calls.length,0);
  h.root.depositIssuesSet('dateMode','all');h.root.depositIssuesReset();assert.equal(h.calls.length,0);assert.equal(h.L.depositIssuesDateMode,'range');
  assert.equal(h.L.from,'2026-09-25T00:00:00');assert.equal(h.L.to,'2026-10-01T23:59:59');
  await h.page.load();assert.equal(h.calls[0].startAt,'2026-09-25T00:00:00.000Z');assert.equal(h.calls[0].endAt,'2026-10-01T23:59:59.000Z');
 }
});

test('default opens employee details with all stored business fields and distinct provenance',async()=>{
 const h=harness({total:2,summary:{count:2},rows:[{platform:'SYNTHETIC',orderNumber:'ORDER-A',workOrderNumber:'TICKET-A',utr:'00001234',upiId:'synthetic@upi.invalid',kycUpiId:'***@bank.invalid',orderDate:'2026-09-25',daysSinceOrder:2,amount:0,provider:'UnifiedPay',rawProvider:'RawPay',followupStatus:'success to other platform',providerReply:'line one\n<script>private</script>',utrMatch:'YES',kycCorrect:'NO',evidence:'Need video',followupAt:'25/9/2026 13:00',sourceDateText:'23/9',receiptText:'29',staffCode:'007',sourceKind:'sheet',sourceGid:42,sourceRow:5,linkStatus:'matched',status:'已入款'},
 {platform:'SYNTHETIC',orderNumber:'ORDER-B',amount:null,sourceKind:'portal',firstActor:'Synthetic creator',lastActor:'Synthetic follower',portalCaseId:'synthetic-case',linkStatus:'independent'}]});
 await h.page.load();assert.equal(h.calls[0].view,'entries');assert.equal(h.L.depositIssuesSection,'details');
 for(const label of ['员工跟进明细','凭证日期','距今天数','UPI ID','KYC-UPI ID','原表员工编号','首次录入员工','最后跟进员工','UTR 核验','KYC 核验','员工跟进明细'])assert(h.html().includes(label),label);
 for(const value of ['00001234','007','2026-09-25','synthetic@upi.invalid','***@bank.invalid','Synthetic creator','Synthetic follower','独立前端记录','0.00'])assert(h.html().includes(value),value);
 assert.match(h.html(),/gid=42/);assert.doesNotMatch(h.html(),/href="[^"]*synthetic-case/);assert.match(h.html(),/&lt;script&gt;private&lt;\/script&gt;/);assert.doesNotMatch(h.html(),/<script>/);
 assert.match(h.html(),/表格：已入款/);assert.doesNotMatch(h.html(),/成功到其他平台、账号或订单/);h.root.depositIssuesMethod();assert.match(h.drawer(),/成功到其他平台、账号或订单，不计为本订单入款/);assert.doesNotMatch(h.html(),/三方未入款统计/);
});

test('column filters combine in one bounded request, preserve zero and clear independently',async()=>{
 const h=harness();await h.page.load();const initial=h.calls.length,renders=h.renders();
 for(const [key,value] of Object.entries({orderNumber:'ORDER',workOrderNumber:'TICKET',utr:'0000',upiId:'synthetic',kycUpiId:'bank',reply:'Need PDF',staffCode:'007',amountMin:'0',amountMax:'125.50'}))h.root.depositIssuesSet(key,value);
 assert.equal(h.calls.length,initial);assert.equal(h.renders(),renders,'typing must not replace the focused input');
 h.root.depositIssuesSet('utrMatch','YES');h.root.depositIssuesSet('kycCorrect','NO');h.root.depositIssuesSet('sourceKind','portal');await h.page.load(true);
 const q=h.calls.at(-1);for(const [k,v] of Object.entries({orderNumber:'ORDER',workOrderNumber:'TICKET',utr:'0000',upiId:'synthetic',kycUpiId:'bank',reply:'Need PDF',staffCode:'007',utrMatch:'YES',kycCorrect:'NO',sourceKind:'portal',amountMin:0,amountMax:125.5,offset:0,limit:20}))assert.equal(q[k],v,k);
 h.root.depositIssuesSet('reply','');await h.page.load();assert.equal(h.calls.at(-1).reply,undefined);assert.equal(h.calls.at(-1).utr,'0000');assert.equal(h.calls.at(-1).staffCode,'007');
});

test('invalid amount ranges do not contact transport; reset clears every column without changing view',async()=>{
 const h=harness();h.root.depositIssuesSet('amountMin','11');h.root.depositIssuesSet('amountMax','10');await h.page.load();assert.equal(h.calls.length,0);assert.match(h.html(),/最低金额不能大于最高金额/);
 h.root.depositIssuesSet('amountMin','-1');await h.page.load();assert.equal(h.calls.length,0);
 h.root.depositIssuesReset();await settle();assert.equal(h.calls.length,0);await h.page.load(true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].view,'entries');for(const k of ['orderNumber','workOrderNumber','utr','upiId','kycUpiId','reply','staffCode','utrMatch','kycCorrect','sourceKind','amountMin','amountMax'])assert.equal(h.calls[0][k],undefined,k);
});

test('derived sheet results are labelled formula markers and never use portal-only filters',async()=>{
 const h=harness({rows:[],total:0,summary:{},providerSummary:[],dailySummary:[]});h.root.depositIssuesSet('staffCode','007');h.root.depositIssuesSet('sourceKind','portal');h.root.depositIssuesSource('results');await settle();
 assert.equal(h.calls.at(-1).action,'depositStatistics');assert.equal(h.calls.at(-1).sourceKind,undefined);assert.equal(h.calls.at(-1).staffCode,undefined);assert.equal(h.L.depositIssuesSection,'summary');
 assert.doesNotMatch(h.html(),/表格标记不代表已核实实际到账/);h.root.depositIssuesMethod();assert.match(h.drawer(),/表格标记不代表已核实实际到账/);assert.match(h.html(),/汇总/);assert.match(h.html(),/UPI核对/);assert.match(h.html(),/三方查看/);assert.match(h.html(),/每日汇总/);
 h.root.depositIssuesSource('entries');await settle();assert.equal(h.L.depositIssuesSection,'details');assert.equal(h.calls.at(-1).staffCode,'007');
});

test('late responses from the previous source cannot replace current entries',async()=>{
 const h=harness();let resolveFirst;h.setHandler(q=>q.action==='depositStatistics'?new Promise(resolve=>{resolveFirst=resolve}):Promise.resolve({rows:[],total:5,summary:{count:5}}));
 h.root.depositIssuesSource('results');h.root.depositIssuesSource('entries');await settle();assert.equal(h.L.depositIssues.total,5);
 resolveFirst({rows:[{platform:'STALE'}],total:99,summary:{count:99}});await settle();assert.equal(h.L.depositIssues.total,5);assert.doesNotMatch(h.html(),/STALE/);
});

test('statistics keep other-order and other-provider classifications independent from the raw sheet mark',async()=>{
 const h=harness({rows:[{platform:'SYNTHETIC',orderNumber:'RC20260926SYNTHETIC',amount:100,status:'已入款',confirmation:'入其他订单',statisticsStatus:'other_order'}],total:1,summary:{count:1,otherOrderCount:1,otherOrderAmount:100,receivedCount:0,unreceivedCount:0}});h.root.depositIssuesSource('results');await settle();assert.match(h.html(),/入其他订单<\/td><td>1<\/td>/);assert.match(h.html(),/本订单入款标记<\/td><td>0<\/td>/);h.root.depositIssuesMethod();assert.match(h.drawer(),/入其他订单、转其他三方单独统计/);h.root.depositIssuesSection('details');await h.page.load(true);await settle();assert.match(h.html(),/核对分类/);assert.match(h.html(),/入其他订单/);h.root.depositIssuesDetail(0);assert.match(h.html(),/deposit-inline-detail/);assert.match(h.html(),/统计归类/);assert.match(h.html(),/已入款/);
});

test('method explanation is opened on demand without a read and remains compatible with contexts lacking a drawer',async()=>{
 const h=harness({rows:[],total:0,updatedAt:'2026-10-01T00:00:00Z',summary:{}},{page:'deposit_statistics'});await h.page.load();
 assert.match(h.html(),/>统计口径<\/button>/);assert.match(h.html(),/同步于 2026-10-01T00:00:00Z/);assert.doesNotMatch(h.html(),/汇总、三方和每日视图来自/);
 const reads=h.calls.length;h.root.depositIssuesMethod();assert.equal(h.calls.length,reads);assert.match(h.drawer(),/汇总、三方和每日视图来自/);
 const old=harness(undefined,{drawer:false});old.page.render();assert.doesNotThrow(()=>old.root.depositIssuesMethod());assert.equal(old.calls.length,0);
});


test('compact rows retain complete escaped values in titles and a complete read-only detail view',async()=>{
 const full='long-upi-0000000000@example',reply='first line\nsecond line <img src=x onerror=alert(1)>';
 const h=harness({rows:[{platform:'SYNTHETIC',orderNumber:'000ORDER',upiId:full,providerReply:reply,amount:0,sourceKind:'portal',firstActor:'staff'}],total:1});await h.page.load();assert.match(h.html(),/wo-cell-value/);assert(h.html().includes('title="'+full+'"'));assert.match(h.html(),/depositIssuesDetail\(0\)/);const n=h.calls.length;h.root.depositIssuesDetail(0);assert.equal(h.calls.length,n);assert(h.drawer().includes(full));assert.match(h.drawer(),/000ORDER/);assert.match(h.drawer(),/second line &lt;img/);assert.doesNotMatch(h.drawer(),/<img/);assert.match(h.drawer(),/0.00/);
});


test('queried employee followups refresh the same bounded filters and page; drafts and other pages never auto-read',async()=>{
 const document={visibilityState:'visible',activeElement:{closest:()=>null},querySelector:()=>null};
 const h=harness({rows:[],total:60,summary:{}},{document});
 assert.equal(h.page.refresh(),undefined);assert.equal(h.calls.length,0);
 h.L.depositIssuesPage=2;await h.page.load();const query={...h.calls[0]};
 h.setNow('2026-09-30T12:00:29Z');assert.equal(h.page.refresh(),undefined);assert.equal(h.calls.length,1);
 h.setNow('2026-09-30T12:00:30Z');await h.page.refresh();assert.deepEqual(h.calls.at(-1),query);assert.equal(h.L.depositIssuesPage,2);
 assert.match(h.html(),/每 30 秒更新/);
 h.setNow('2026-09-30T12:01:10Z');document.visibilityState='hidden';await h.page.refresh();assert.equal(h.calls.length,2);
 document.visibilityState='visible';document.activeElement.closest=()=>({});await h.page.refresh();assert.equal(h.calls.length,2);
 document.activeElement.closest=()=>null;document.querySelector=()=>({});await h.page.refresh();assert.equal(h.calls.length,2);
 document.querySelector=()=>null;h.setRoute('overview');await h.page.refresh();assert.equal(h.calls.length,2);
 h.setRoute('deposit_statistics');await h.page.refresh();assert.equal(h.calls.length,2);
 h.setRoute('deposit_tracking');h.root.depositIssuesSet('orderNumber','unqueried-draft');await h.page.refresh();assert.equal(h.calls.length,2);
});

test('automatic followup refresh is single-flight, preserves failed reads and rejects superseded responses',async()=>{
 const h=harness({rows:[{platform:'old'}],total:1,summary:{}});await h.page.load();h.setNow('2026-09-30T12:01:00Z');
 let finish;h.setHandler(()=>new Promise(resolve=>{finish=resolve}));const next=h.page.refresh();
 assert.equal(h.calls.length,2);assert.equal(h.L.depositIssuesLoading,true);await h.page.refresh();assert.equal(h.calls.length,2);
 h.root.depositIssuesSet('platformName','SYNTHETIC');finish({rows:[{platform:'stale'}],total:1});await next;assert.equal(h.L.depositIssues.rows[0].platform,'old');
 h.setHandler(async()=>{throw Error('temporary failure')});await h.page.load();assert.equal(h.L.depositIssues.rows[0].platform,'old');assert.match(h.L.depositIssuesError,/temporary failure/);
});


test('refresh scheduling starts only after a tracking query and stops on destroy',async()=>{
 const timers=[],cleared=[];const h=harness({rows:[],total:0,summary:{}},{document:{visibilityState:'visible'},setInterval:(run,delay)=>{timers.push({run,delay});return timers.length},clearInterval:id=>cleared.push(id)});
 h.page.render();assert.equal(timers.length,0);await h.page.load();assert.equal(timers.length,1);assert.equal(timers[0].delay,30000);
 h.page.render();assert.equal(timers.length,1);h.setNow('2026-09-30T12:00:31Z');await timers[0].run();assert.equal(h.calls.length,2);
 h.setRoute('overview');h.setNow('2026-09-30T12:01:31Z');await timers[0].run();assert.equal(h.calls.length,2);h.page.destroy();assert.deepEqual(cleared,[1]);
});

test('unresolved shortcut requests the complete server result, resets paging and retains scope',async()=>{
 const h=harness({rows:[],total:0,summary:{}},{page:'deposit_statistics'});h.page.render();h.root.depositIssuesSet('platformName','SYNTHETIC');h.root.depositIssuesSet('provider','Pay');h.root.depositIssuesSet('utr','000123');h.L.depositIssuesPage=4;
 h.setHandler(q=>({section:q.section,rows:[{platform:'SYNTHETIC',orderNumber:'OTHER-ORDER',status:'已入款',confirmation:'入其他订单',statisticsStatus:'other_order',amount:0}],total:65,summary:{count:65,unresolvedCount:65}}));
 await h.root.depositIssuesPending();const q=h.calls.at(-1);assert.equal(q.action,'depositStatistics');assert.equal(q.section,'details');assert.equal(q.followupState,'unresolved');assert.equal(q.offset,0);assert.equal(q.limit,20);assert.equal(q.platform,'SYNTHETIC');assert.equal(q.provider,'Pay');assert.equal(q.utr,'000123');assert.match(h.html(),/未成功订单明细/);assert.match(h.html(),/OTHER-ORDER/);assert.match(h.html(),/共 <b>65<\/b> 条/);
 h.root.depositIssuesPage(2);await settle();assert.equal(h.calls.at(-1).offset,20);assert.equal(h.calls.at(-1).followupState,'unresolved');
 h.root.depositIssuesSection('details');await settle();assert.equal(h.calls.at(-1).followupState,undefined);assert.equal(h.calls.at(-1).offset,0);
});

test('summary separates counts, money and denominator shares; absent money is never rendered as zero',async()=>{
 const h=harness({rows:[],total:0,currency:'INR',summary:{count:10,amount:100,receivedCount:4,receivedAmount:80,unreceivedCount:6,unreceivedAmount:20,unresolvedCount:6,unresolvedAmount:20,otherOrderCount:0,otherOrderAmount:0,otherProviderCount:0,otherProviderAmount:0,unclassifiedCount:0,unclassifiedAmount:0}},{page:'deposit_statistics'});
 await h.page.load();assert.match(h.html(),/<th>笔数<\/th><th>笔数占比<\/th><th>金额 INR<\/th><th>金额占比<\/th>/);assert.match(h.html(),/本订单入款标记<\/td><td>4<\/td><td>40.00%<\/td><td>80.00<\/td><td>80.00%/);assert.match(h.html(),/本订单未入款标记<\/td><td>6<\/td><td>60.00%<\/td><td>20.00<\/td><td>20.00%/);
 h.setHandler(()=>({rows:[],total:0,summary:{count:1,amount:null,receivedCount:0,receivedAmount:0,unreceivedCount:1,unreceivedAmount:null,unresolvedCount:1}}));await h.page.load();assert.match(h.html(),/本订单未入款标记<\/td><td>1<\/td><td>100.00%<\/td><td>—<\/td><td>—/);
});

test('statistics inline evidence links to its actual source workbook/tab and preserves conflicts',async()=>{
 const sourceSheet='actual-workbook-id-0000000000000001',tab="July ' source",row={platform:'SYNTHETIC',orderNumber:'00000000000123456789',amount:null,statisticsStatus:'conflict',status:'来源冲突',matchStatus:'待核对',sourceCount:2,sources:[{sourceSheet,sourceTab:tab,sourceRow:7,amount:10,provider:'<Pay>',status:'已入款'},{sourceSheet:'another-workbook-id-000000000000002',sourceGid:42,sourceTab:'Other',sourceRow:8,amount:11,status:'未入款'}]};
 const h=harness({rows:[row],total:1,summary:{}},{page:'deposit_statistics'});h.page.render();h.root.depositIssuesSection('details');await h.page.load();const before=h.calls.length;h.root.depositIssuesDetail(0);assert.equal(h.calls.length,before);assert.equal(h.drawer(),'');assert.match(h.html(),/deposit-inline-detail/);assert.match(h.html(),/来源冲突/);assert.match(h.html(),/00000000000123456789/);assert.match(h.html(),/actual-workbook-id-0000000000000001\/edit#range=/);assert.match(h.html(),/another-workbook-id-000000000000002\/edit\?gid=42#gid=42&amp;range=A8%3AAZ8/);assert.match(h.html(),/&lt;Pay&gt;/);assert.doesNotMatch(h.html(),/href="javascript:|<Pay>/);h.root.depositIssuesDetail(0);assert.doesNotMatch(h.html(),/deposit-inline-detail/);
});
