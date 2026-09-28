/* Whole-range source-order aggregates; no member IDs or production data. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order}=new Function('require','__dirname',shared+';return {fixture,order};')(require,__dirname);
const plain=s=>s.replace(/<[^>]*>/g,'').trim();
const cells=row=>[...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m=>m[1]);
const rows=(html,part='tbody')=>[...html.match(new RegExp('<'+part+'>([\\s\\S]*?)</'+part+'>'))[1].matchAll(/<tr(?: class="[^"]*")?>([\s\S]*?)<\/tr>/g)].map(m=>cells(m[1]));
const fact=(provider,extra={})=>({provider,direction:'withdraw',submittedAmount:2000,submittedCount:20,successAmount:1200,successCount:12,notReceivedAmount:800,notReceivedCount:8,uniqueOrderAmount:500,uniqueOrderCount:5,uniqueSuccessAmount:300,uniqueSuccessCount:3,uniqueCoverage:{status:'complete',complete:true,detailCount:20,missingOrderNumberCount:0,missingDetailCount:0,amountConflictCount:0,missingAmountCount:0,providerConflictCount:0},...extra});
const coverage=(extra={})=>({status:'partial',complete:false,detailCount:20,missingOrderNumberCount:2,missingDetailCount:0,amountConflictCount:0,missingAmountCount:0,providerConflictCount:0,...extra});
function setup(){
 const h=fixture([order('a','ar',1000,10,{provider:'AlphaPay',platform:'Alpha'}),order('b','ar',500,5,{provider:'BetaPay',platform:'Beta'})]);
 h.L.workorders={byProvider:[fact('AlphaPay'),fact('BetaPay',{uniqueOrderAmount:800,uniqueOrderCount:8,uniqueSuccessAmount:400,uniqueSuccessCount:4})],byDirection:{withdraw:fact('',{uniqueOrderAmount:1100,uniqueOrderCount:11,uniqueSuccessAmount:600,uniqueSuccessCount:6})},byPlatformProvider:[fact('AlphaPay',{country:'印度',platformId:'a',platform:'Alpha',source:'ar'})]};h.render();return h;
}
const unique=row=>row.slice(-6,-2);

test('four separate sortable columns preserve raw workorder fields and use backend whole-range totals without summing providers',()=>{
 const h=setup(),body=rows(h.html()),footer=rows(h.html(),'tfoot');
 for(const label of ['去重订单金额','去重订单笔数','去重成功金额','去重成功笔数'])assert(h.html().includes(label));
 for(const field of ['uniqueOrderAmount','uniqueOrderCount','uniqueSuccessAmount','uniqueSuccessCount'])assert(h.html().includes("providerSummarySort('issue_"+field+"')"));
 assert.doesNotMatch(h.html(),/provider-dedup-cell|金额 \/ 笔数/);
 assert.equal(body[0].length,25);assert.equal(plain(body[0][13]),'2,000.00');assert.equal(plain(body[0][14]),'20');
 assert.deepEqual(unique(body[0]).map(plain),['500.00','5','300.00','3']);
 assert.deepEqual(unique(footer[0]).map(plain),['1,100.00','11','600.00','6']);
 assert.doesNotMatch(unique(footer[0])[0],/1,300/);assert.equal(h.networkCalls(),0);
 h.L.localSize=1;h.render();const paged=rows(h.html(),'tfoot');assert.deepEqual(unique(paged[0]),['—','—','—','—']);assert.equal(plain(unique(paged[1])[0]),'1,100.00');
});

test('platform expansion reads the exact stable platform aggregate and never reuses provider-wide distinct values',()=>{
 const h=setup();h.root.providerSummaryToggle(0);const child=cells(h.html().match(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/)[1]);
 assert.equal(child.length,25);assert.deepEqual(unique(child).map(plain),['500.00','5','300.00','3']);
 h.L.workorders.byPlatformProvider[0].platformId='unknown';h.render();const children=[...h.html().matchAll(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/g)].map(m=>cells(m[1]));
 assert.equal(children.length,2);assert.deepEqual(unique(children[0]),['—','—','—','—']);assert.equal(plain(unique(children[1])[0]),'500.00');
});

test('missing original order numbers remain unavailable; conflicts suppress amounts but keep known counts with coverage',()=>{
 const h=setup();h.L.workorders.byProvider[0]=fact('AlphaPay',{uniqueOrderAmount:null,uniqueOrderCount:null,uniqueSuccessAmount:null,uniqueSuccessCount:null,uniqueCoverage:coverage({status:'unavailable',missingOrderNumberCount:20})});h.render();
 let shown=unique(rows(h.html())[0]);assert.match(shown[0],/is-partial/);assert.match(shown[0],/20条缺原订单号/);assert.deepEqual(shown.map(plain),['—*','—*','—*','—*']);assert.doesNotMatch(shown[0],/>0\.00/);
 h.L.workorders.byProvider[0]=fact('AlphaPay',{uniqueOrderAmount:null,uniqueOrderCount:5,uniqueCoverage:coverage({amountConflictCount:1})});h.render();shown=unique(rows(h.html())[0]);assert.match(shown[0],/is-partial/);assert.match(shown[0],/1组金额冲突/);assert.equal(plain(shown[1]),'5*');assert.doesNotMatch(shown[0],/>0\.00/);
 h.L.workorders.byProvider[0]=fact('AlphaPay',{uniqueOrderAmount:0,uniqueOrderCount:0,uniqueSuccessAmount:0,uniqueSuccessCount:0});h.render();assert.deepEqual(unique(rows(h.html())[0]).map(plain),['0.00','0','0.00','0']);
});

test('duplicate source aliases and multiple platform aggregates are not added as if distinct counts were additive',()=>{
 const h=setup();h.L.workorders.byProvider.push(fact('AlphaPay'));h.L.workorders.byPlatformProvider.push({...h.L.workorders.byPlatformProvider[0]});h.render();
 assert.deepEqual(unique(rows(h.html())[0]),['—','—','—','—']);assert.equal(plain(rows(h.html())[0][14]),'40','original additive workorder counts remain unchanged');
 h.root.providerSummaryToggle(0);const child=cells(h.html().match(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/)[1]);assert.deepEqual(unique(child),['—','—','—','—']);
});

test('four source-order columns sort independently by their numeric values and leave unavailable fields last',()=>{
 const h=setup();h.root.providerSummarySort('issue_uniqueOrderAmount');let body=rows(h.html());assert.equal(plain(body[0][0]),'BetaPay');assert.equal(plain(body[1][0]),'AlphaPay');
 h.root.providerSummarySort('issue_uniqueOrderAmount');body=rows(h.html());assert.equal(plain(body[0][0]),'AlphaPay');
 h.L.workorders.byProvider[0].uniqueOrderCount=12;h.L.workorders.byProvider[0].uniqueSuccessCount=9;h.render();h.root.providerSummarySort('issue_uniqueOrderCount');assert.equal(plain(rows(h.html())[0][0]),'AlphaPay');
 h.root.providerSummarySort('issue_uniqueSuccessAmount');assert.equal(plain(rows(h.html())[0][0]),'BetaPay');h.root.providerSummarySort('issue_uniqueSuccessCount');assert.equal(plain(rows(h.html())[0][0]),'AlphaPay');
 delete h.L.workorders.byProvider[0].uniqueCoverage;h.render();body=rows(h.html());assert.equal(plain(body[0][0]),'BetaPay');assert.equal(plain(body[1][0]),'AlphaPay');assert.equal(h.networkCalls(),0);
});

test('deposit unique orders stay separate from withdrawal and member counts',()=>{
 const h=fixture([order('a','ar',200,2,{direction:'charge',provider:'AlphaPay',platform:'Alpha'})]);
 h.L.workorders={byProvider:[fact('AlphaPay'),fact('AlphaPay',{direction:'charge',uniqueOrderAmount:200,uniqueOrderCount:2,uniqueSuccessAmount:100,uniqueSuccessCount:1})],byDirection:{charge:fact('',{direction:'charge',uniqueOrderAmount:200,uniqueOrderCount:2}),withdraw:fact('')},byPlatformProvider:[]};
 h.L.memberCounts={rows:[{created_member_count:9000}]};h.render('charge');const body=rows(h.html()),footer=rows(h.html(),'tfoot');
 assert.equal(body[0].length,23);assert.deepEqual(unique(body[0]).map(plain),['200.00','2','100.00','1']);assert.equal(plain(unique(footer[0])[0]),'200.00');assert.doesNotMatch(unique(body[0])[0],/9000|9,000/);
});
