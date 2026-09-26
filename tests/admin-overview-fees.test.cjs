/* Synthetic ledger amounts only. No network or production data. */
const test=require('node:test'),assert=require('node:assert/strict');
require('../admin-preview/live-provider-aliases.js');
const api=require('../admin-preview/live-provider-summary.js');
const amountKeys=['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'];
const countKeys=['all_count','success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count'];
function plus(rows){const mixed=new Set(rows.map(r=>r.currency).filter(Boolean)).size>1;return Object.fromEntries([...amountKeys,...countKeys].map(key=>[key,(amountKeys.includes(key)&&mixed)||rows.some(r=>r[key]===null)?null:rows.reduce((n,r)=>n+Number(r[key]||0),0)]))}
function combine(rows,keys){const map=new Map();for(const row of rows){const id=JSON.stringify(keys.map(k=>row[k]??''));if(!map.has(id))map.set(id,[]);map.get(id).push(row)}return [...map.values()].map(items=>({...Object.fromEntries(keys.map(k=>[k,items[0][k]])),...plus(items),items}))}
const order=(other={})=>({provider:'ExamplePay',platformId:'a',platform:'Alpha',source:'ar',country:'印度',currency:'INR',direction:'charge',all_amount:1200,all_count:12,success_amount:1000,success_count:10,created_success_count:8,...other});
const rate=(other={})=>({provider:'ExamplePay',country:'印度',scopeType:'country',collectFee:'4%',payoutFee:'2.5%',payoutSingleFee:'6',...other});
const dimensions=(orders,key='provider',rates=[rate()],summaries=orders.map(r=>({...r,team:'Example Team'})))=>api.overviewDimensions({orders,summaries,rates,country:'印度',key,plus,combine});
const summaryOf=(orders,scope)=>({...plus(orders),currency:'INR',direction:'charge',...scope});

test('same provider merges across sources after each platform percentage is priced independently',()=>{
 const orders=[order(),order({platformId:'b',platform:'Beta',source:'newar',success_amount:2000,success_count:20})];
 const rows=dimensions(orders,'provider',[rate(),rate({scopeType:'platform',platform:'Beta',collectFee:'5%'})]);
 assert.equal(rows.length,1);assert.equal(rows[0].success_amount,3000);assert.equal(rows[0].success_count,30);assert.equal(rows[0].estimated_fee,140);
 assert.equal(rows[0].fee_matched_count,30);assert.equal(rows[0].fee_complete,true);assert.equal(rows[0].fee_rate_label,'4.00% / 5.00%');
 assert.deepEqual(rows[0].platformIds,['a','b']);assert.equal(rows[0].success_amount_share,1);
});

test('payout percentages and per-success-order fees both survive merging',()=>{
 const rows=dimensions([order({direction:'withdraw'}),order({direction:'withdraw',platformId:'b',platform:'Beta',source:'newar',success_amount:2000,success_count:20})]);
 assert.equal(rows[0].estimated_fee,255);assert.equal(rows[0].fee_rate_label,'2.50% + 6 / 笔');
 assert.equal(rows[0].fee_matched_count,30);assert.equal(rows[0].fee_share,1);
});

test('country and team fees use provider leaves while business totals remain the summary totals',()=>{
 const orders=[order(),order({provider:'OtherPay',success_amount:500,success_count:5})],summaries=[summaryOf(orders,{platformId:'a',platform:'Alpha',country:'印度',source:'ar',team:'Group A',success_amount:1800,success_count:18})];
 for(const key of ['country','team']){const rows=dimensions(orders,key,[rate(),rate({provider:'OtherPay',collectFee:'2%'})],summaries);
  assert.equal(rows.length,1);assert.equal(rows[0].success_amount,1800);assert.equal(rows[0].success_count,18);assert.equal(rows[0].estimated_fee,50);
  assert.equal(rows[0].fee_matched_count,15);assert.equal(rows[0].fee_eligible_count,18);assert.equal(rows[0].fee_complete,false);assert.match(rows[0].fee_rate_label,/未匹配/);
 }
});

test('same display platform from different stable identities never merges',()=>{
 const orders=[order(),order({platformId:'b',source:'newar',success_amount:2000})];const rows=dimensions(orders,'platform');
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.platformId),['a','b']);assert.deepEqual(rows.map(r=>r.estimated_fee),[40,80]);
});

test('manual recharge and confirmation retain ledger amounts but cannot become provider fee or ranking',()=>{
 const orders=[order(),order({provider:'人工充值',success_amount:500,success_count:5}),order({provider:'人工确认',direction:'withdraw',success_amount:800,success_count:8}),order({provider:'无三方（驳回）',direction:'withdraw',all_amount:200,all_count:2,success_amount:0,success_count:0})];
 const rows=dimensions(orders,'provider',[rate(),...orders.slice(1).map(r=>rate({provider:r.provider,collectFee:'99%',payoutFee:'99%'}))]);
 for(const row of rows.filter(r=>r.provider!=='ExamplePay')){assert.equal(api.isProviderBusiness(row.provider),false);assert.equal(row.estimated_fee,null);assert.equal(row.fee_rate_label,'不适用');assert.equal(row.fee_eligible_count,0);assert.equal(row.fee_complete,true)}
 const charge=rows.filter(r=>r.direction==='charge'),real=charge.find(r=>r.provider==='ExamplePay'),manual=charge.find(r=>r.provider==='人工充值');
 assert.equal(real.success_amount_share,2/3);assert.equal(manual.success_amount_share,1/3);assert.equal(manual.success_amount,500);
 const fees=api.feeSummary(charge);assert.equal(fees.amount,40);assert.equal(fees.successCount,10);assert.equal(fees.excludedCount,5);assert.equal(fees.complete,true);
 assert.equal(api.estimate(orders[1],[rate({provider:'人工充值'})],'印度'),null);
});

test('unidentified successful orders remain unmatched rather than fabricated zero fee',()=>{
 const rows=dimensions([order(),order({provider:'未识别通道',success_amount:500,success_count:5})]);
 const unknown=rows.find(r=>r.provider==='未识别通道');assert.equal(unknown.estimated_fee,null);assert.equal(unknown.fee_rate_label,'未匹配');assert.equal(unknown.fee_eligible_count,5);assert.equal(unknown.fee_complete,false);assert.equal(api.isProviderBusiness(unknown.provider),false);
 const fees=api.feeSummary(rows);assert.equal(fees.amount,40);assert.equal(fees.matchedCount,10);assert.equal(fees.successCount,15);assert.equal(fees.complete,false);
});

test('zero fees are valid known fees, while conflicting rates cannot be estimated',()=>{
 const free=dimensions([order()],'provider',[rate({collectFee:'0%'})])[0];assert.equal(free.estimated_fee,0);assert.equal(free.fee_complete,true);assert.equal(free.fee_rate_label,'0.00%');assert.equal(free.fee_share,null);
 const ambiguous=dimensions([order()],'provider',[rate(),rate({collectFee:'5%'})])[0];assert.equal(ambiguous.estimated_fee,null);assert.equal(ambiguous.fee_complete,false);assert.equal(ambiguous.fee_rate_label,'待核对费率');
});

test('confirmed UpiPay row 4 is shared by overview labels and both direction fee estimates',()=>{
 const orders=[order({provider:'UpiPay'}),order({provider:'UpiPay',direction:'withdraw'})],rates=[rate({provider:'UpiPay',sheetName:'印度线下',sourceRow:4,collectFee:'4.00%'}),rate({provider:'UpiPay',sheetName:'印度线下',sourceRow:47,collectFee:'4.30%',payoutFee:'2.80%'})];
 const rows=dimensions(orders,'provider',rates);assert.equal(rows[0].estimated_fee,40);assert.equal(rows[0].fee_rate_label,'4.00%');assert.equal(rows[1].estimated_fee,85);assert.equal(rows[1].fee_rate_label,'2.50% + 6 / 笔');
});

test('fees and shares are isolated by direction and currency; unknown amount propagates',()=>{
 const orders=[order(),order({provider:'OtherPay',success_amount:null,success_count:5}),order({provider:'ExamplePay',direction:'withdraw'}),order({provider:'ExamplePay',currency:'USD',success_amount:30,success_count:3})];
 const rows=dimensions(orders,'provider',[rate(),rate({provider:'OtherPay'})]),charge=rows.filter(r=>r.direction==='charge'&&r.currency==='INR');
 assert(charge.every(r=>r.success_amount_share===null));assert.equal(charge[0].success_count_share,2/3);assert.equal(rows.find(r=>r.currency==='USD').success_amount_share,1);
 assert.equal(rows.find(r=>r.direction==='withdraw').estimated_fee,85);assert.equal(api.feeSummary(rows).amount,null);
});

test('existing provider summary also excludes manual fee records without removing ledger rows',()=>{
 const orders=[order(),order({provider:'人工充值',success_amount:500,success_count:5})],rows=api.buildRows({orders,issues:[],rates:[rate(),rate({provider:'人工充值',collectFee:'99%'})],country:'印度',direction:'charge',plus,combine});
 assert.equal(rows.length,2);assert.equal(plus(rows).success_amount,1500);assert.equal(rows.find(r=>r.provider==='人工充值').estimated_fee,null);assert.equal(api.feeSummary(rows).amount,40);assert.equal(api.feeSummary(rows).complete,true);
});
