/* Synthetic provider/platform reconciliation: no network or production facts. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order,plus,combine}=new Function('require','__dirname',shared+';return {fixture,order,plus,combine};')(require,__dirname);
const keys=['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount'];
const issue=(platformId,platform,direction='withdraw',more={})=>({country:'印度',platformId,platform,sourcePlatform:platform,source:platformId==='b'?'newar':'ar',provider:'SyntheticPay',direction,submittedAmount:100,submittedCount:4,successAmount:60,successCount:2,notReceivedAmount:40,notReceivedCount:2,...more});
const source=(id,amount,count,more={})=>order(id,id==='b'?'newar':'ar',amount,count,{platform:id==='b'?'Beta':'Alpha',country:'印度',...more});
const rates=[{country:'印度',scopeType:'country',provider:'SyntheticPay',collectFee:'4%',payoutFee:'2.5%',payoutSingleFee:'6'},{country:'印度',scopeType:'platform',platform:'Beta',provider:'SyntheticPay',collectFee:'5%',payoutFee:'3%',payoutSingleFee:'2'}];
const children=html=>[...html.matchAll(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(c=>c[1]));
const plain=s=>s.replace(/<[^>]*>/g,'');
function setup(direction='withdraw'){
 const orders=[source('a',900,3,{direction}),source('b',100,7,{direction})];
 const h=fixture(orders);h.L.feeLookupRows=rates;
 h.L.workorders={byProvider:[issue(null,null,direction,{submittedAmount:200,submittedCount:8,successAmount:120,successCount:4,notReceivedAmount:80,notReceivedCount:4})],byPlatformProvider:[issue('a','Alpha',direction),issue('b','Beta',direction)],coverage:{capturedPlatformDays:2,expectedPlatformDays:2,complete:true,platforms:[{platformId:'a',platform:'Alpha',days:1},{platformId:'b',platform:'Beta',days:1}]}};
 h.render(direction);return {h,orders};
}

test('both flows expand with identical parent column count/order, successful time fields and no extra requests',()=>{
 for(const direction of ['charge','withdraw']){
  const {h}=setup(direction),before=h.networkCalls();h.root.providerSummaryToggle(0);
  const html=h.html(),rows=children(html),headers=[...html.match(/<thead>([\s\S]*?)<\/thead>/)[1].matchAll(/<th>([\s\S]*?)<\/th>/g)].map(m=>plain(m[1]));
  assert.equal(rows.length,2);for(const row of rows)assert.equal(row.length,headers.length);
  assert.equal(plain(rows[0][0]),'Alpha');assert.equal(plain(rows[0][1]),'ar');assert.equal(plain(rows[0][2]),'900.00');assert.equal(plain(rows[1][2]),'100.00');
  assert.match(rows[0][3],/^3<small.*笔数占比 30.00%/);assert.match(rows[1][3],/^7<small.*笔数占比 70.00%/);
  assert.match(rows[0][4],/按创建订单：2 \/ 20 笔/);assert.match(rows[0][4],/>10.00%/);assert.equal(plain(rows[0][5]),'90.00%');
  const feeIndex=direction==='withdraw'?8:6;assert.equal(plain(rows[0][feeIndex]),direction==='withdraw'?'2.50% + 6 / 笔':'4.00%');
  assert.equal(plain(rows[1][feeIndex]),direction==='withdraw'?'3.00% + 2 / 笔':'5.00%');
  assert.equal(plain(rows[0][feeIndex+1]),direction==='withdraw'?'40.50':'36.00');assert.equal(plain(rows[1][feeIndex+1]),direction==='withdraw'?'17.00':'5.00');
  assert.equal(plain(rows[0][feeIndex+3]),'100.00');assert.equal(plain(rows[0][feeIndex+4]),'4');assert.equal(plain(rows[0].at(-2)),'50.00%');assert.equal(plain(rows[0].at(-1)),'—');
  assert.match(html,/成功金额、成功笔数按成功时间/);assert.equal(h.networkCalls(),before);assert.doesNotMatch(html,/provider-platform-table/);
 }
});

test('full platform workorder aggregates are independent of paginated records and reconcile with the parent',()=>{
 const {h,orders}=setup();h.L.workorders.rows=[issue('a','Alpha','withdraw',{submittedAmount:999999,submittedCount:9999})];
 const parent=h.api.buildRows({orders,issues:h.L.workorders.byProvider,rates,country:'印度',direction:'withdraw',plus,combine})[0];
 const rows=h.api.buildPlatformRows({row:parent,workorders:h.L.workorders,rates,country:'印度',plus,combine});
 for(const key of keys)assert.equal(rows.reduce((n,r)=>n+r.issues[key],0),parent.issues[key],key);
 assert.equal(rows.reduce((n,r)=>n+r.estimated_fee,0),parent.estimated_fee);assert.equal(rows.reduce((n,r)=>n+r.success_amount,0),parent.success_amount);
 assert.equal(rows.length,2);assert(rows.every(r=>!r.issueOnly));
});

test('legacy paged workorder rows never become fabricated platform totals; unavailable fields stay blank',()=>{
 const {h}=setup();delete h.L.workorders.byPlatformProvider;h.L.workorders.rows=[issue('a','Alpha')];h.render();h.root.providerSummaryToggle(0);
 const rows=children(h.html());for(const row of rows)assert(row.slice(11,18).every(cell=>cell==='—'));assert.match(h.html(),/不使用分页记录推算/);
});

test('same display name with ambiguous source keeps one unallocated workorder row rather than repeating it',()=>{
 const orders=[source('a',900,3,{platform:'Same'}),source('b',100,7,{platform:'Same'})],h=fixture(orders);
 const w={byPlatformProvider:[issue(null,'Same','withdraw',{source:null})],coverage:{platforms:[{platform:'Same',days:1,platformId:null}]}};
 const parent=h.api.buildRows({orders,issues:null,rates,country:'印度',direction:'withdraw',plus,combine})[0];
 const rows=h.api.buildPlatformRows({row:parent,workorders:w,rates,country:'印度',plus,combine});
 assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.issueOnly).length,1);assert(rows.filter(r=>!r.issueOnly).every(r=>r.issues===null));assert.equal(rows.reduce((n,r)=>n+(r.issues?.submittedAmount||0),0),100);
});

test('known covered zero and uncovered data differ; provider/direction/country filters remain respected',()=>{
 const {h,orders}=setup();h.L.workorders.byPlatformProvider=[issue('a','Alpha','charge'),issue('a','Alpha','withdraw',{provider:'Other'}),issue('a','Alpha','withdraw',{country:'马来'})];h.L.workorders.coverage.platforms=[{platformId:'a',platform:'Alpha',days:1},{platformId:'b',platform:'Beta',days:0}];
 const parent=h.api.buildRows({orders,issues:null,rates,country:'印度',direction:'withdraw',plus,combine})[0],rows=h.api.buildPlatformRows({row:parent,workorders:h.L.workorders,rates,country:'印度',plus,combine});
 assert.deepEqual(keys.map(k=>rows[0].issues[k]),[0,0,0,0,0,0]);assert.equal(rows[1].issues,null);
});

test('missing amounts stay unknown while manual and unmatched fees stay honest',()=>{
 const h=fixture([source('a',null,3),source('b',100,7)]);h.L.feeLookupRows=[];h.render();h.root.providerSummaryToggle(0);const rows=children(h.html());assert(rows.every(r=>plain(r[5])==='—'));assert(rows.every(r=>plain(r[9])==='—'));assert.doesNotMatch(h.html(),/NaN|Infinity/);
});
