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
const issueSlice=row=>row.slice(-8,-2);

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
 const shown=rows(h.html())[0];assert.deepEqual(issueSlice(shown).map(plain),['—','—','—','—','200.00','2']);assert.match(issueSlice(shown)[0],/20条缺原订单号/);assert.match(h.html(),/工单原单覆盖未齐/);assert.doesNotMatch(h.html(),/<sup/);assert.doesNotMatch(issueSlice(shown).join(''),/2,000\.00|1,200\.00/);
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
 assert.equal(body[0].length,24);assert.deepEqual(issueSlice(body[0]).map(plain),['200.00','2','100.00','1','200.00','2']);assert.equal(plain(footer[0].at(-8)),'200.00');assert.doesNotMatch(body[0].at(-8),/9000|9,000/);assert.doesNotMatch(html,/去重订单金额|去重订单笔数/);
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
