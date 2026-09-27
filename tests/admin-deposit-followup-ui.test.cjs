// Synthetic records and transport only; no production data or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-deposit-issues.js'),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(response={rows:[],total:0,summary:{}}){
 const L={catalogReady:true,catalog:[{country:'印度',name:'SYNTHETIC'}],country:'印度',from:'2026-09-01T00:00:00',to:'2026-09-27T23:59:59',depositIssuesPage:1,depositIssuesSize:20,depositIssuesSerial:0,depositIssuesPlatform:'all',depositIssuesProvider:'',depositIssuesStatus:'all',depositIssuesQuery:''},calls=[];
 let html='',renders=0,page,handler=async()=>response;
 const root={};vm.runInNewContext(source,{window:root});
 page=root.HensemLiveDepositIssues.create({L,E:escape,C:v=>String(v??0),N:v=>Number(v).toFixed(2),R:(a,b)=>b?String(a/b*100):'—',formatTime:v=>v,
  metric:(title,value)=>'<div>'+title+':'+value+'</div>',box:(title,body)=>'<section><h2>'+title+'</h2>'+body+'</section>',pager:(total,p,size)=>'<footer data-total="'+total+'">'+p+'/'+size+'</footer>',
  table:(headers,rows,classes)=>'<div class="'+classes+'"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>',
  render:()=>{renders++;html=page.render()},request:async q=>{calls.push({...q});return handler(q)}});
 return {L,root,page,calls,html:()=>html,renders:()=>renders,setHandler:next=>{handler=next}};
}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))};

test('default opens employee details with all stored business fields and distinct provenance',async()=>{
 const h=harness({total:2,summary:{count:2},rows:[{platform:'SYNTHETIC',orderNumber:'ORDER-A',workOrderNumber:'TICKET-A',utr:'00001234',upiId:'synthetic@upi.invalid',kycUpiId:'***@bank.invalid',orderDate:'2026-09-25',daysSinceOrder:2,amount:0,provider:'UnifiedPay',rawProvider:'RawPay',followupStatus:'success to other platform',providerReply:'line one\n<script>private</script>',utrMatch:'YES',kycCorrect:'NO',evidence:'Need video',followupAt:'25/9/2026 13:00',sourceDateText:'23/9',receiptText:'29',staffCode:'007',sourceKind:'sheet',sourceGid:42,sourceRow:5,linkStatus:'matched',status:'已入款'},
 {platform:'SYNTHETIC',orderNumber:'ORDER-B',amount:null,sourceKind:'portal',firstActor:'Synthetic creator',lastActor:'Synthetic follower',portalCaseId:'synthetic-case',linkStatus:'independent'}]});
 await h.page.load();assert.equal(h.calls[0].view,'entries');assert.equal(h.L.depositIssuesSection,'details');
 for(const label of ['员工跟进记录','表格核对结果','Receipt date','距今天数','UPI ID','KYC-UPI ID','原表员工编号','首次录入员工','最后跟进员工','UTR 核验','KYC 核验','员工跟进明细'])assert(h.html().includes(label),label);
 for(const value of ['00001234','007','2026-09-25','synthetic@upi.invalid','***@bank.invalid','Synthetic creator','Synthetic follower','独立前端记录','0.00'])assert(h.html().includes(value),value);
 assert.match(h.html(),/gid=42/);assert.doesNotMatch(h.html(),/href="[^"]*synthetic-case/);assert.match(h.html(),/&lt;script&gt;private&lt;\/script&gt;/);assert.doesNotMatch(h.html(),/<script>/);
 assert.match(h.html(),/表格：已入款/);assert.match(h.html(),/不代表当前订单已入款/);assert.doesNotMatch(h.html(),/三方未入款统计/);
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
 h.root.depositIssuesReset();await settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].view,'entries');for(const k of ['orderNumber','workOrderNumber','utr','upiId','kycUpiId','reply','staffCode','utrMatch','kycCorrect','sourceKind','amountMin','amountMax'])assert.equal(h.calls[0][k],undefined,k);
});

test('derived sheet results are labelled formula markers and never use portal-only filters',async()=>{
 const h=harness({rows:[],total:0,summary:{},providerSummary:[],dailySummary:[]});h.root.depositIssuesSet('staffCode','007');h.root.depositIssuesSet('sourceKind','portal');h.root.depositIssuesSource('results');await settle();
 assert.equal(h.calls.at(-1).view,'results');assert.equal(h.calls.at(-1).sourceKind,undefined);assert.equal(h.calls.at(-1).staffCode,undefined);assert.equal(h.L.depositIssuesSection,'summary');
 assert.match(h.html(),/来自「UPI核对」表的公式或标记，不代表已核实实际到账/);assert.match(h.html(),/统计概览/);assert.match(h.html(),/核对明细/);assert.match(h.html(),/三方统计/);assert.match(h.html(),/每日统计/);
 h.root.depositIssuesSource('entries');await settle();assert.equal(h.L.depositIssuesSection,'details');assert.equal(h.calls.at(-1).staffCode,'007');
});

test('late responses from the previous source cannot replace current entries',async()=>{
 const h=harness();let resolveFirst;h.setHandler(q=>q.view==='results'?new Promise(resolve=>{resolveFirst=resolve}):Promise.resolve({rows:[],total:5,summary:{count:5}}));
 h.root.depositIssuesSource('results');h.root.depositIssuesSource('entries');await settle();assert.equal(h.L.depositIssues.total,5);
 resolveFirst({rows:[{platform:'STALE'}],total:99,summary:{count:99}});await settle();assert.equal(h.L.depositIssues.total,5);assert.doesNotMatch(h.html(),/STALE/);
});
