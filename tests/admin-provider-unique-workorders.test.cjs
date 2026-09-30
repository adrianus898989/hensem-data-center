/* Whole-range source-order aggregates; no member IDs or production data. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order}=new Function('require','__dirname',shared+';return {fixture,order};')(require,__dirname);
const plain=s=>s.replace(/<[^>]*>/g,'').trim();
const cells=row=>[...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m=>m[1]);
const rows=(html,part='tbody')=>[...html.match(new RegExp('<'+part+'>([\\s\\S]*?)</'+part+'>'))[1].matchAll(/<tr(?: class="[^"]*")?>([\s\S]*?)<\/tr>/g)].map(m=>cells(m[1]));
const fact=(provider,extra={})=>({provider,direction:'withdraw',submittedAmount:2000,submittedCount:20,successAmount:1200,successCount:12,notReceivedAmount:800,notReceivedCount:8,uniqueOrderAmount:500,uniqueOrderCount:5,uniqueSuccessAmount:300,uniqueSuccessCount:3,uniqueNotReceivedAmount:200,uniqueNotReceivedCount:2,uniqueCoverage:{status:'complete',complete:true,detailCount:20,missingOrderNumberCount:0,amountConflictCount:0,missingDetailCount:0,providerConflictCount:0},...extra});
function setup(){
 const h=fixture([order('a','ar',1000,10,{provider:'AlphaPay',platform:'Alpha'}),order('b','ar',500,5,{provider:'BetaPay',platform:'Beta'})]);
 h.L.workorders={byProvider:[fact('AlphaPay'),fact('BetaPay',{uniqueOrderAmount:800,uniqueOrderCount:8,uniqueSuccessAmount:400,uniqueSuccessCount:4})],byDirection:{withdraw:fact('',{uniqueOrderAmount:1100,uniqueOrderCount:11,uniqueSuccessAmount:600,uniqueSuccessCount:6})},byPlatformProvider:[fact('AlphaPay',{country:'印度',platformId:'a',platform:'Alpha',source:'ar'})]};h.render();return h;
}
const issueSlice=row=>row.length===26?row.slice(-10,-4):row.slice(-8,-2);

test('the original six workorder columns now show deduplicated values and no duplicate column group',()=>{
 const h=setup(),html=h.html(),body=rows(html),footer=rows(html,'tfoot');
 for(const label of ['工单提交金额','工单提交笔数','工单成功金额','工单成功笔数','工单未到账金额','工单未到账笔数'])assert.match(html,new RegExp(label));
 for(const label of ['去重订单金额','去重订单笔数','去重成功金额','去重成功笔数','去重未到账金额','去重未到账笔数'])assert.doesNotMatch(html,new RegExp(label));
 for(const field of ['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount'])assert.match(html,new RegExp("providerSummarySort\\('issue_"+field+"'\\)"));
 assert.equal(body[0].length,23);assert.deepEqual(issueSlice(body[0]).map(plain),['500.00','5','300.00','3','200.00','2']);
 assert.deepEqual(issueSlice(footer[0]).map(plain),['1,100.00','11','600.00','6','200.00','2']);
 assert.doesNotMatch(html,/>2,000\.00<|>1,200\.00</,'raw complete totals are no longer displayed in the workorder columns');
 assert.equal(h.networkCalls(),0);
});

test('platform expansion keeps the same six deduplicated workorder fields aligned',()=>{
 const h=setup();h.root.providerSummaryToggle(0);const html=h.html(),child=cells(html.match(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/)[1]);
 assert.equal(child.length,23);assert.deepEqual(issueSlice(child).map(plain),['500.00','5','300.00','3','200.00','2']);assert.doesNotMatch(html,/去重订单金额/);
});

test('incomplete source-order coverage marks the displayed deduplicated fields while keeping no raw fallback',()=>{
 const h=setup();h.L.workorders.byProvider[0]=fact('AlphaPay',{uniqueOrderAmount:null,uniqueOrderCount:null,uniqueSuccessAmount:null,uniqueSuccessCount:null,uniqueCoverage:{status:'unavailable',complete:false,missingOrderNumberCount:20}});h.render();
 const shown=rows(h.html())[0];assert.deepEqual(issueSlice(shown).map(plain),['—','—','—','—','200.00','2']);assert.match(issueSlice(shown)[0],/20条采集字段未提供原订单号/);assert.match(h.html(),/工单原单待核对/);assert.doesNotMatch(h.html(),/<sup/);assert.doesNotMatch(issueSlice(shown).join(''),/2,000\.00|1,200\.00/);
});

test('multiple source aggregates do not get added as distinct deduplicated orders',()=>{
 const h=setup();h.L.workorders.byProvider.push(fact('AlphaPay'));h.L.workorders.byPlatformProvider.push({...h.L.workorders.byPlatformProvider[0]});h.render();
 assert.deepEqual(issueSlice(rows(h.html())[0]).map(plain),['—','—','—','—','—','—']);
 h.root.providerSummaryToggle(0);const child=cells(h.html().match(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/)[1]);assert.deepEqual(issueSlice(child).map(plain),['—','—','—','—','—','—']);
});

test('the six original workorder sort controls sort by their deduplicated values',()=>{
 const h=setup(),beta=h.L.workorders.byProvider[1];Object.assign(beta,{uniqueOrderAmount:900,uniqueOrderCount:9,uniqueSuccessAmount:700,uniqueSuccessCount:7,uniqueNotReceivedAmount:400,uniqueNotReceivedCount:4});
 for(const field of ['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount']){h.L.providerSort='success_amount';h.L.providerSortAsc=false;h.render();h.root.providerSummarySort('issue_'+field);assert.equal(plain(rows(h.html())[0][0]),'BetaPay');}
 assert.equal(h.networkCalls(),0);
});

test('collection reports use deduplicated order totals in the same six columns and never member counts',()=>{
 const h=fixture([order('a','ar',200,2,{direction:'charge',provider:'AlphaPay',platform:'Alpha'})]);
 const charge=fact('AlphaPay',{direction:'charge',uniqueOrderAmount:200,uniqueOrderCount:2,uniqueSuccessAmount:100,uniqueSuccessCount:1,uniqueNotReceivedAmount:200,uniqueNotReceivedCount:2});
 h.L.workorders={byProvider:[charge],byDirection:{charge:charge,withdraw:fact('')},byPlatformProvider:[]};h.L.memberCounts={rows:[{created_member_count:9000}]};h.render('charge');const html=h.html(),body=rows(html),footer=rows(html,'tfoot');
 assert.equal(body[0].length,26);assert.deepEqual(issueSlice(body[0]).map(plain),['200.00','2','100.00','1','200.00','2']);assert.equal(plain(footer[0].at(-10)),'200.00');assert.doesNotMatch(body[0].at(-10),/9000|9,000/);assert.doesNotMatch(html,/去重订单金额|去重订单笔数/);
});

test('workorder success rate, sorting, expansion and total all use unique order counts',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([order('a','ar',1000,10,{direction,provider:'AlphaPay',platform:'Alpha'}),order('b','ar',500,5,{direction,provider:'BetaPay',platform:'Beta'})]);
  const alpha=fact('AlphaPay',{direction,submittedCount:20,successCount:18,uniqueOrderCount:5,uniqueSuccessCount:1});
  const beta=fact('BetaPay',{direction,submittedCount:20,successCount:2,uniqueOrderCount:5,uniqueSuccessCount:4});
  h.L.workorders={byProvider:[alpha,beta],byPlatformProvider:[{...alpha,country:'印度',platformId:'a',platform:'Alpha',source:'ar'}],byDirection:{[direction]:fact('',{direction,submittedCount:40,successCount:30,uniqueOrderCount:10,uniqueSuccessCount:5})}};
  h.render(direction);
  assert.deepEqual(rows(h.html()).map(row=>plain(row.at(-2))),['20.00%','80.00%']);
  assert.equal(plain(rows(h.html(),'tfoot')[0].at(-2)),'50.00%');
  h.root.providerSummaryToggle(0);
  const child=cells(h.html().match(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/)[1]);
  assert.equal(plain(child.at(-2)),'20.00%');
  h.root.providerSummarySort('issue_success_rate');
  assert.equal(plain(rows(h.html())[0][0]),'BetaPay');
  assert.equal(h.networkCalls(),0);
 }
});

test('source date gaps and row-specific gaps have separate, escaped reasons without another request',()=>{
 const h=setup();h.L.workorders.coverage={complete:false,capturedPlatformDays:2,expectedPlatformDays:4,platforms:[{platform:'<Missing>',days:0,expectedDays:2,complete:false},{platform:'Complete',days:2,expectedDays:2,complete:true}]};
 h.L.workorders.byProvider=h.L.workorders.byProvider.map(r=>({...r,uniqueCoverage:{...r.uniqueCoverage,complete:false,status:'partial'}}));h.render();assert.match(h.html(),/2 个三方/);assert.match(h.html(),/查看原因/);
 h.root.providerSummaryCoverage();let html=h.drawers.at(-1).html;assert.match(html,/2 \/ 4 平台日/);assert.match(html,/不代表每家三方都单独缺订单/);assert.match(html,/&lt;Missing&gt;/);assert.doesNotMatch(html,/<Missing>/);assert.match(html,/代收／代付订单统计和刷单剔除另行计算/);assert.equal(h.networkCalls(),0);
 h.L.workorders.coverage.complete=true;h.L.workorders.byProvider[0].uniqueCoverage.detailMismatchCount=7;h.render();h.root.providerSummaryCoverage();html=h.drawers.at(-1).html;assert.match(html,/日汇总与原始明细数量相差 7 条/);assert.doesNotMatch(html,/日期未收齐/);assert.equal(h.networkCalls(),0);
});

test('fully read collection and payout cards separately identify named workorder gap platforms',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture([]),platforms=[{id:'ar-82',name:'82LOTTERY',sourceName:'INDIA82',country:'印度',source:'ar',aliasPlatformIds:['old-82']},{id:'new-dhani',name:'DHANIWIN',country:'印度',source:'NEW_AR'}];
  h.L.queryPlatforms=platforms;h.L.results=platforms.map(platform=>({platform,groups:{provider:[]},capabilities:{sourceCompletenessVerified:false}}));
  const incomplete={complete:false,missingOrderNumberCount:2};
  h.L.workorders={byProvider:[],coverage:{complete:false,platforms:[{platform:'INDIA82',days:0,expectedDays:1},{platform:'82LOTTERY',days:0,expectedDays:1},{platform:'Outside scope',days:0,expectedDays:1}]},byPlatformProvider:[
   fact('TukPay',{direction,platformId:'new-dhani',platform:'DHANIWIN',source:'NEW_AR',uniqueCoverage:incomplete}),
   fact('RushPay',{direction,platformId:'new-dhani',platform:'DHANIWIN',source:'NEW_AR',uniqueCoverage:{complete:false,missingDetailCount:3}}),
   fact('AliasPay',{direction,platformId:'old-82',platform:'INDIA82',source:'ar',uniqueCoverage:incomplete})
  ]};
  h.render(direction);assert.equal(h.api.queryCoverage(h.L).received,2);assert.doesNotMatch(h.html(),/provider-api-coverage/);assert.match(h.html(),/工单缺项 2 平台/);assert.doesNotMatch(h.html(),/缺失 \d+ 个平台|provider-kpi-warning/);
  const gaps=h.api.workorderPlatformGaps(h.L,direction);assert.equal(gaps.length,2);assert.equal(gaps.find(p=>p.id==='new-dhani').providers.length,2);
  h.root.providerSummaryWorkorderPlatforms();const drawer=h.drawers.at(-1);assert.equal(drawer.title,'工单缺项平台');assert.match(drawer.html,/82LOTTERY/);assert.match(drawer.html,/DHANIWIN/);assert.match(drawer.html,/TukPay、RushPay/);assert.match(drawer.html,/工单日期已收 0 \/ 1 天/);assert.match(drawer.html,/2条采集字段未提供原订单号/);assert.match(drawer.html,/3条缺原始明细/);assert.doesNotMatch(drawer.html,/Outside scope/);assert.equal(h.networkCalls(),0);
 }
});

test('workorder gap card does not guess unsupported sources, ambiguous names, opposite directions or missing facts',()=>{
 const h=fixture([]),platforms=[{id:'ar-a',name:'Shared',country:'印度',source:'ar'},{id:'new-a',name:'Shared',country:'印度',source:'newar'},{id:'known',name:'Complete',country:'印度',source:'newar'}];
 h.L.queryPlatforms=platforms;h.L.results=platforms.map(platform=>({platform,groups:{provider:[]},capabilities:{sourceCompletenessVerified:false}}));
 h.L.workorders={byProvider:[],coverage:{complete:false,platforms:[{platform:'Shared',complete:false,days:0,expectedDays:1},{platform:'Complete',days:0,expectedDays:0,complete:true}]},byPlatformProvider:[
  fact('Opposite',{direction:'charge',platformId:'known',uniqueCoverage:{complete:false}}),
  fact('Unknown',{platformId:'known',uniqueCoverage:undefined}),
  fact('Other country',{country:'巴西',platformId:'known',uniqueCoverage:{complete:false}}),
  fact('Foreign id',{platformId:'outside',platform:'Complete',uniqueCoverage:{complete:false}})
 ]};
 h.render();assert.equal(h.api.workorderPlatformGaps(h.L,'withdraw').length,0);assert.doesNotMatch(h.html(),/工单缺项 \d+ 平台|缺失 \d+ 个平台/);
 h.L.workorders.byPlatformProvider.push(fact('<Unsafe>',{platform:'Shared',country:'印度',source:'NEW_AR',uniqueCoverage:{complete:false,missingAmountCount:1}}));h.render();assert.match(h.html(),/工单缺项 1 平台/);assert.equal(h.api.workorderPlatformGaps(h.L,'withdraw')[0].id,'new-a');
 h.root.providerSummaryWorkorderPlatforms();const html=h.drawers.at(-1).html;assert.match(html,/&lt;Unsafe&gt;/);assert.doesNotMatch(html,/<Unsafe>/);assert.match(html,/1条金额缺失/);assert.equal(h.networkCalls(),0);
 const count=h.drawers.length;h.L.dirty=true;h.root.providerSummaryWorkorderPlatforms();assert.equal(h.drawers.length,count);
});

test('collection KYC count and amount are separate deduplicated backend columns including platform and full-scope totals',()=>{
 const h=fixture([order('a','ar',200,2,{direction:'charge',provider:'AlphaPay',platform:'Alpha'}),order('b','ar',100,1,{direction:'charge',provider:'BetaPay',platform:'Beta'})]);
 const alpha=fact('AlphaPay',{direction:'charge',uniqueNotReceivedKycCount:1,uniqueNotReceivedKycAmount:120}),beta=fact('BetaPay',{direction:'charge',uniqueNotReceivedKycCount:2,uniqueNotReceivedKycAmount:450});
 for(const row of [alpha,beta])row.uniqueCoverage={...row.uniqueCoverage,kycUnknownOrderCount:0};
 h.L.workorders={byProvider:[alpha,beta],byDirection:{charge:{...alpha,uniqueNotReceivedKycCount:4,uniqueNotReceivedKycAmount:600}},byPlatformProvider:[{...alpha,country:'印度',platformId:'a',platform:'Alpha',source:'ar'}]};
 h.render('charge');let html=h.html();assert.match(html,/未到账KYC匹配<span class="provider-heading-unit">笔数/);assert.match(html,/未到账KYC匹配<span class="provider-heading-unit">金额/);
 assert.deepEqual(rows(html)[0].slice(-4,-2).map(plain),['1','120.00']);assert.deepEqual(rows(html,'tfoot')[0].slice(-4,-2).map(plain),['4','600.00'],'whole-scope metrics come from server originals, not provider-row sums');
 assert.match(rows(html)[0].at(-4),/同一原单只计一笔/);assert.match(rows(html)[0].at(-4),/源KYC连接明确为是/);
 h.root.providerSummaryToggle(0);const child=cells(h.html().match(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/)[1]);assert.equal(child.length,26);assert.deepEqual(child.slice(-4,-2).map(plain),['1','120.00']);
 for(const key of ['uniqueNotReceivedKycCount','uniqueNotReceivedKycAmount']){h.L.providerSort='success_amount';h.render('charge');h.root.providerSummarySort('issue_'+key);assert.equal(plain(rows(h.html())[0][0]),'BetaPay');}
 assert.equal(h.networkCalls(),0);h.render('withdraw');assert.doesNotMatch(h.html(),/未到账KYC匹配/);
});

test('KYC unknown status, original gaps and missing matching amounts stay distinct from confirmed zero',()=>{
 const h=fixture([order('a','ar',200,2,{direction:'charge',provider:'AlphaPay',platform:'Alpha'})]);
 const row=fact('AlphaPay',{direction:'charge',uniqueNotReceivedKycCount:0,uniqueNotReceivedKycAmount:0});row.uniqueCoverage={...row.uniqueCoverage,kycUnknownOrderCount:0};
 h.L.workorders={byProvider:[row],byDirection:{charge:row},byPlatformProvider:[]};h.render('charge');assert.deepEqual(rows(h.html())[0].slice(-4,-2).map(plain),['0','0.00']);
 row.uniqueCoverage.complete=false;h.render();assert.deepEqual(rows(h.html())[0].slice(-4,-2).map(plain),['—','—'],'incomplete original coverage cannot establish zero KYC matches');row.uniqueCoverage.complete=true;
 row.uniqueCoverage.kycUnknownOrderCount=2;h.render();assert.deepEqual(rows(h.html())[0].slice(-4,-2).map(plain),['—','—']);assert.match(rows(h.html())[0].at(-4),/2个去重未到账原单的KYC状态未确认/);
 row.uniqueNotReceivedKycCount=1;row.uniqueNotReceivedKycAmount=150;h.render();assert.deepEqual(rows(h.html())[0].slice(-4,-2).map(plain),['1部分','150.00部分']);assert.equal(plain(issueSlice(rows(h.html())[0]).at(-1)),'2','KYC unknown does not alter total outstanding orders');
 row.uniqueNotReceivedKycAmount=null;h.render();assert.equal(plain(rows(h.html())[0].at(-4)),'1部分');assert.equal(plain(rows(h.html())[0].at(-3)),'—');assert.match(rows(h.html())[0].at(-3),/金额缺失或冲突/);
 delete row.uniqueNotReceivedKycCount;delete row.uniqueNotReceivedKycAmount;delete row.uniqueCoverage.kycUnknownOrderCount;h.render();assert.deepEqual(rows(h.html())[0].slice(-4,-2).map(plain),['—','—']);assert.match(rows(h.html())[0].at(-4),/KYC核验结果尚未返回/);
 assert.equal(h.networkCalls(),0);
});

test('KYC sorts keep rendered unknown values last in both directions for parent and platform rows',()=>{
 const h=fixture([order('a','ar',300,3,{direction:'charge',provider:'UnknownPay',platform:'Unknown'}),order('b','ar',200,2,{direction:'charge',provider:'KnownPay',platform:'Known'}),order('c','ar',100,1,{direction:'charge',provider:'KnownPay',platform:'KnownUnknown'})]);
 const unknown=fact('UnknownPay',{direction:'charge',uniqueNotReceivedKycCount:0,uniqueNotReceivedKycAmount:0}),known=fact('KnownPay',{direction:'charge',uniqueNotReceivedKycCount:1,uniqueNotReceivedKycAmount:100});
 unknown.uniqueCoverage={...unknown.uniqueCoverage,kycUnknownOrderCount:2};known.uniqueCoverage={...known.uniqueCoverage,kycUnknownOrderCount:0};
 h.L.workorders={byProvider:[unknown,known],byDirection:{charge:known},byPlatformProvider:[{...known,country:'印度',platformId:'b',platform:'Known',source:'ar'},{...unknown,provider:'KnownPay',country:'印度',platformId:'c',platform:'KnownUnknown',source:'ar'}]};h.render('charge');
 for(const field of ['uniqueNotReceivedKycCount','uniqueNotReceivedKycAmount']){
  h.L.providerSort='success_amount';h.render('charge');
  for(let n=0;n<2;n++){h.root.providerSummarySort('issue_'+field);assert.equal(plain(rows(h.html())[0][0]),'KnownPay');assert.equal(plain(rows(h.html())[1].at(-4)),'—');}
 }
 h.root.providerSummaryToggle(0);
 for(const field of ['uniqueNotReceivedKycCount','uniqueNotReceivedKycAmount'])for(let n=0;n<2;n++){
  h.root.providerSummaryPlatformSort(0,'issue_'+field);
  const children=[...h.html().matchAll(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/g)].map(m=>cells(m[1]));
  assert.deepEqual(children.map(r=>plain(r[0])),['Known','KnownUnknown']);assert.equal(plain(children[1].at(-4)),'—');
 }
 assert.equal(h.networkCalls(),0);
});
