/* Synthetic loaded summaries only; sorting must not issue any requests. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order}=new Function('require','__dirname',shared+';return {fixture,order};')(require,__dirname);
const plain=s=>s.replace(/<[^>]*>/g,'').trim();
const body=html=>html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
const names=h=>[...body(h.html()).matchAll(/<tr><td>([\s\S]*?)<\/td>/g)].map(m=>plain(m[1]));
const children=h=>[...body(h.html()).matchAll(/<tr class="provider-platform-row"><td>([\s\S]*?)<\/td>/g)].map(m=>plain(m[1]));
const named=(name,amount,count,more={})=>order(name,'ar',amount,count,{provider:name,platform:name+' platform',...more});
const rate=(name,percent,fixed='')=>({country:'印度',scopeType:'country',provider:name,collectFee:percent,payoutFee:percent,collectSingleFee:fixed,payoutSingleFee:fixed});
function sort(h,key,ascending){h.L.providerSort=key;h.L.providerSortAsc=!ascending;h.render();h.root.providerSummarySort(key);return names(h)}

test('both summary flows expose sorting on every data header, including type and workorder fields',()=>{
 for(const flow of ['charge','withdraw']){
  const h=fixture([named('AlphaPay',10,2,{direction:flow})]);h.render(flow);
  const headers=[...h.html().match(/<thead>([\s\S]*?)<\/thead>/)[1].matchAll(/<th>([\s\S]*?)<\/th>/g)].map(m=>m[1]);
  assert.equal(headers.at(-1),'平台明细');assert(headers.slice(0,-1).every(h=>h.includes('providerSummarySort(')));
  assert(headers.some(h=>h.includes("providerSummarySort('type')")));assert(headers.some(h=>h.includes("providerSummarySort('issue_success_rate')")));
  if(flow==='withdraw')assert(headers.some(h=>h.includes("providerSummarySort('pending_count')")));
  h.root.providerSummaryToggle(0);assert.match(h.html(),/providerSummaryPlatformSort\(0,'platform'\)/);assert.match(h.html(),/providerSummaryPlatformSort\(0,'type'\)/);
  assert.equal(h.networkCalls(),0);
 }
});

test('amount and count sorts use numbers before pagination, with missing values last in both directions',()=>{
 const h=fixture([named('HugePay',10000,1000),named('SmallPay',20,2),named('MiddlePay',900,30),named('UnknownPay',null,5)]);
 assert.deepEqual(sort(h,'success_amount',false),['HugePay','MiddlePay','SmallPay','UnknownPay']);
 assert.deepEqual(sort(h,'success_amount',true),['SmallPay','MiddlePay','HugePay','UnknownPay']);
 assert.deepEqual(sort(h,'success_count',true),['SmallPay','UnknownPay','MiddlePay','HugePay']);
 h.L.localSize=2;h.L.localPage=2;h.render();h.root.providerSummarySort('success_amount');
 assert.equal(h.L.localPage,1);assert.deepEqual(names(h),['HugePay','MiddlePay']);assert.match(h.html(),/<tfoot>[\s\S]*全部汇总/);assert.equal(h.networkCalls(),0);
});

test('success rates and amount/count/fee shares compare raw fractions and keep unknown denominators blank',()=>{
 const h=fixture([named('HigherPay',10,2,{all_count:3}),named('LowerPay',20,9,{all_count:100}),named('NoBasePay',0,0,{all_count:0})]);
 assert.deepEqual(sort(h,'success_rate',true),['LowerPay','HigherPay','NoBasePay']);
 assert.deepEqual(sort(h,'success_rate',false),['HigherPay','LowerPay','NoBasePay']);
 assert.deepEqual(sort(h,'amount_share',false),['LowerPay','HigherPay','NoBasePay']);
 assert.deepEqual(sort(h,'count_share',false),['LowerPay','HigherPay','NoBasePay']);
 h.L.feeLookupRows=[rate('HigherPay','10%'),rate('LowerPay','2%')];h.render();
 assert.deepEqual(sort(h,'estimated_fee',false),['HigherPay','LowerPay','NoBasePay']);
 assert.deepEqual(sort(h,'fee_share',true),['NoBasePay','LowerPay','HigherPay']);
 assert.equal(h.networkCalls(),0);
});

test('fee sort compares percentage then per-order fee; ambiguous or unmatched rates stay last',()=>{
 const h=fixture(['LowPay','FixedPay','HighPay','UnknownPay','MixedPay'].map(name=>named(name,100,1)));
 h.L.feeLookupRows=[rate('LowPay','2%','6'),rate('FixedPay','2%','10'),rate('HighPay','10%'),rate('MixedPay','2%'),rate('MixedPay','4%')];h.render();
 assert.deepEqual(sort(h,'fee_rate',true),['LowPay','FixedPay','HighPay','UnknownPay','MixedPay']);
 assert.deepEqual(sort(h,'fee_rate',false),['HighPay','FixedPay','LowPay','UnknownPay','MixedPay']);
 assert.match(h.html(),/按百分比、单笔费依次排序/);assert.equal(h.networkCalls(),0);
});

test('workorder amounts, counts and rates sort complete nested aggregates without manufacturing uncovered zeros',()=>{
 const h=fixture(['KnownPay','ZeroPay','MissingPay'].map(name=>named(name,10,1)));
 h.L.workorders={byProvider:[{provider:'KnownPay',direction:'withdraw',submittedAmount:10000,submittedCount:10,successAmount:2000,successCount:2,notReceivedAmount:8000,notReceivedCount:8},{provider:'ZeroPay',direction:'withdraw',submittedAmount:0,submittedCount:0,successAmount:0,successCount:0,notReceivedAmount:0,notReceivedCount:0}],coverage:{capturedPlatformDays:2,platforms:[{platform:'MissingPay platform',days:0}]},rows:[{provider:'KnownPay',submittedAmount:999999999}]};
 for(const key of ['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount']){
  assert.deepEqual(sort(h,'issue_'+key,true),['ZeroPay','KnownPay','MissingPay']);
  assert.deepEqual(sort(h,'issue_'+key,false),['KnownPay','ZeroPay','MissingPay']);
 }
 assert.deepEqual(sort(h,'issue_success_rate',true),['KnownPay','ZeroPay','MissingPay']);assert.equal(h.networkCalls(),0);
});

test('name, platform count and original business type are independently sortable',()=>{
 const h=fixture([named('Pay10',1,1),named('Pay2',1,1),named('Pay10',1,1,{platformId:'extra',platform:'Extra'}),named('BlankPay',1,1)]);
 h.L.feeLookupRows=[{...rate('Pay10','2%'),sourceTypeProvider:'Pay10',sourceType:'USDT'},{...rate('Pay2','2%'),sourceTypeProvider:'Pay2',sourceType:'BANK'}];h.render();
 assert.deepEqual(sort(h,'provider',true),['BlankPay','Pay2','Pay10']);
 assert.equal(sort(h,'platform_count',false)[0],'Pay10');
 assert.deepEqual(sort(h,'type',true),['Pay2','Pay10','BlankPay']);
 assert.deepEqual(sort(h,'type',false),['Pay10','Pay2','BlankPay']);assert.equal(h.networkCalls(),0);
});

test('expanded platform groups follow their parent, keep local sorting, and leave totals and source facts unchanged',()=>{
 const original=[named('ParentPay',90,9,{platformId:'a',platform:'Platform10'}),named('ParentPay',10,1,{platformId:'b',platform:'Platform2'}),named('OtherPay',500,2)],snapshot=JSON.stringify(original),h=fixture(original);
 h.render();h.root.providerSummaryToggle(1);const footer=h.html().match(/<tfoot>[\s\S]*?<\/tfoot>/)[0];
 h.root.providerSummaryPlatformSort(1,'platform');assert.deepEqual(children(h),['Platform2','Platform10']);
 sort(h,'provider',false);assert.equal(names(h)[0],'ParentPay');assert.deepEqual(children(h),['Platform2','Platform10']);
 h.root.providerSummaryPlatformSort(0,'success_amount');assert.deepEqual(children(h),['Platform10','Platform2']);
 h.root.providerSummaryPlatformSort(0,'success_amount');assert.deepEqual(children(h),['Platform2','Platform10']);
 assert.equal(h.html().match(/<tfoot>[\s\S]*?<\/tfoot>/)[0],footer);assert.equal(JSON.stringify(original),snapshot);
 h.root.providerSummarySort('__proto__');h.root.providerSummaryPlatformSort(0,'constructor');assert.equal(JSON.stringify(original),snapshot);assert.equal(h.networkCalls(),0);
});

test('shared comparator is stable, nonmutating and evaluates each raw key once',()=>{
 const h=fixture([]),rows=[{id:'missing',v:null},{id:'zero',v:0},{id:'first',v:2},{id:'second',v:2}];let calls=0;
 const output=h.api.sortedRows(rows,row=>{calls++;return row.v},false);
 assert.deepEqual(Array.from(output,row=>row.id),['first','second','zero','missing']);assert.equal(calls,rows.length);assert.equal(rows[0].id,'missing');
});
