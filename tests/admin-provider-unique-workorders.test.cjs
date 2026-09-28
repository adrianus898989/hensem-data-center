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
const unique=row=>row.slice(19,25);

test('raw and source-order-deduplicated workorder fields are shown together and sortable',()=>{
 const h=setup(),html=h.html(),body=rows(html),footer=rows(html,'tfoot');
 for(const label of ['工单提交金额','工单提交笔数','工单成功金额','工单成功笔数','工单未到账金额','工单未到账笔数','去重订单金额','去重订单笔数','去重成功金额','去重成功笔数','去重未到账金额','去重未到账笔数'])assert.match(html,new RegExp(label));
 for(const field of ['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount','uniqueOrderAmount','uniqueOrderCount','uniqueSuccessAmount','uniqueSuccessCount','uniqueNotReceivedAmount','uniqueNotReceivedCount'])assert.match(html,new RegExp("providerSummarySort\\('issue_"+field+"'\\)"));
 assert.equal(body[0].length,27);assert.deepEqual(body[0].slice(13,19).map(plain),['2,000.00','20','1,200.00','12','800.00','8']);assert.deepEqual(unique(body[0]).map(plain),['500.00','5','300.00','3','200.00','2']);
 assert.deepEqual(footer[0].slice(13,19).map(plain),['4,000.00','40','2,400.00','24','1,600.00','16']);assert.deepEqual(unique(footer[0]).map(plain),['1,100.00','11','600.00','6','200.00','2']);
 assert.equal(h.networkCalls(),0);
 h.L.localSize=1;h.render();const paged=rows(h.html(),'tfoot');assert.deepEqual(paged[0].slice(13,19).map(plain),['2,000.00','20','1,200.00','12','800.00','8']);assert.deepEqual(paged[1].slice(13,19).map(plain),['4,000.00','40','2,400.00','24','1,600.00','16']);assert.deepEqual(paged[0].slice(19,25),['—','—','—','—','—','—']);assert.deepEqual(paged[1].slice(19,25).map(plain),['1,100.00','11','600.00','6','200.00','2']);
});

test('platform expansion keeps raw and exact platform source-order-deduplicated fields aligned',()=>{
 const h=setup();h.root.providerSummaryToggle(0);const html=h.html(),child=cells(html.match(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/)[1]);
 assert.equal(child.length,27);assert.deepEqual(child.slice(13,19).map(plain),['2,000.00','20','1,200.00','12','800.00','8']);assert.deepEqual(unique(child).map(plain),['500.00','5','300.00','3','200.00','2']);
});

test('missing original order numbers keep raw totals and mark only deduplicated fields as partial',()=>{
 const h=setup();h.L.workorders.byProvider[0]=fact('AlphaPay',{uniqueOrderAmount:null,uniqueOrderCount:null,uniqueSuccessAmount:null,uniqueSuccessCount:null,uniqueCoverage:{status:'unavailable',complete:false,missingOrderNumberCount:20}});h.render();
 const shown=rows(h.html())[0];assert.deepEqual(shown.slice(13,19).map(plain),['2,000.00','20','1,200.00','12','800.00','8']);const dedup=shown.slice(19,25);assert(dedup.every(cell=>/is-partial/.test(cell)));assert.match(dedup[0],/20条缺原订单号/);assert.deepEqual(dedup.map(plain),['—*','—*','—*','—*','200.00*','2*']);
});

test('duplicate source aggregates are never added as distinct deduplicated orders',()=>{
 const h=setup();h.L.workorders.byProvider.push(fact('AlphaPay'));h.L.workorders.byPlatformProvider.push({...h.L.workorders.byPlatformProvider[0]});h.render();
 assert.deepEqual(unique(rows(h.html())[0]),['—','—','—','—','—','—']);assert.equal(plain(rows(h.html())[0][14]),'40','raw workorder counts remain additive');
 h.root.providerSummaryToggle(0);const child=cells(h.html().match(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/)[1]);assert.deepEqual(unique(child),['—','—','—','—','—','—']);
});

test('all raw and deduplicated workorder amount/count fields sort independently',()=>{
 const h=setup(),beta=h.L.workorders.byProvider[1];Object.assign(beta,{submittedAmount:3000,submittedCount:30,successAmount:1800,successCount:18,notReceivedAmount:1200,notReceivedCount:12,uniqueOrderAmount:900,uniqueOrderCount:9,uniqueSuccessAmount:700,uniqueSuccessCount:7,uniqueNotReceivedAmount:400,uniqueNotReceivedCount:4});h.render();
 for(const [field,expected] of [['submittedAmount','BetaPay'],['submittedCount','BetaPay'],['successAmount','BetaPay'],['successCount','BetaPay'],['notReceivedAmount','BetaPay'],['notReceivedCount','BetaPay'],['uniqueOrderAmount','BetaPay'],['uniqueOrderCount','BetaPay'],['uniqueSuccessAmount','BetaPay'],['uniqueSuccessCount','BetaPay'],['uniqueNotReceivedAmount','BetaPay'],['uniqueNotReceivedCount','BetaPay']]){h.root.providerSummarySort('issue_'+field);assert.equal(plain(rows(h.html())[0][0]),expected);h.root.providerSummarySort('issue_'+field);assert.equal(plain(rows(h.html())[0][0]),'AlphaPay')}
 assert.equal(h.networkCalls(),0);
});

test('charge table keeps raw and deduplicated order totals separate from member counts',()=>{
 const h=fixture([order('a','ar',200,2,{direction:'charge',provider:'AlphaPay',platform:'Alpha'})]);
 const charge=fact('AlphaPay',{direction:'charge',submittedAmount:300,submittedCount:3,successAmount:100,successCount:1,notReceivedAmount:200,notReceivedCount:2,uniqueOrderAmount:200,uniqueOrderCount:2,uniqueSuccessAmount:100,uniqueSuccessCount:1,uniqueNotReceivedAmount:200,uniqueNotReceivedCount:2});
 h.L.workorders={byProvider:[fact('AlphaPay'),charge],byDirection:{charge:charge,withdraw:fact('')},byPlatformProvider:[]};h.L.memberCounts={rows:[{created_member_count:9000}]};h.render('charge');const html=h.html(),body=rows(html),footer=rows(html,'tfoot');
 assert.equal(body[0].length,25);assert.deepEqual(body[0].slice(11,17).map(plain),['300.00','3','100.00','1','200.00','2']);assert.deepEqual(body[0].slice(17,23).map(plain),['200.00','2','100.00','1','200.00','2']);assert.equal(plain(footer[0][11]),'300.00');assert.equal(plain(footer[0][17]),'200.00');assert.doesNotMatch(body[0][11],/9000|9,000/);
});
