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
const dimensions=(orders,key='provider',rates=[rate()],summaries=orders.map(r=>({...r,team:'Example Team'})),feeMode='historical')=>api.overviewDimensions({orders,summaries,rates,country:'印度',key,plus,combine,feeMode});
const summaryOf=(orders,scope)=>({...plus(orders),currency:'INR',direction:'charge',...scope});

const version=(row,amount,matched=row.success_count)=>({...row,fee_version_state:matched===row.success_count?'complete':matched?'partial':'unknown',fee_version_matched_count:matched,fee_version_unmatched_count:row.success_count-matched,fee_version_estimated_amount:amount});

test('current mode uses native platform fees consistently in all overview dimensions while the default remains historical',()=>{
 const orders=[version(order(),9),version(order({platformId:'b',platform:'Beta',source:'newar',success_amount:2000,success_count:20}),8)],rates=[rate(),rate({scopeType:'platform',platform:'Beta',collectFee:'5%'})],before=JSON.stringify(orders);
 for(const key of ['team','country','platform','provider']){
  const rows=dimensions(orders,key,rates,undefined,'current'),fees=api.feeSummary(rows);
  assert.equal(fees.amount,140,key);assert.equal(fees.successCount,30);assert.equal(fees.matchedCount,30);assert.equal(fees.complete,true);assert.equal(fees.fee_mode,'current');
  assert.match(api.feeCoverageText(fees),/按当前费率估算/);assert.doesNotMatch(api.feeCoverageText(fees),/订单创建时间/);
  assert.equal(rows.reduce((n,row)=>n+row.fee_share,0),1);
 }
 assert.equal(api.feeSummary(dimensions(orders,'provider',rates)).amount,17);assert.equal(JSON.stringify(orders),before);
});

test('current platform and team coverage retain success orders missing from the provider breakdown',()=>{
 const orders=[order()],summaries=[summaryOf(orders,{platformId:'a',platform:'Alpha',source:'ar',country:'印度',team:'Example Team',success_count:13,success_amount:1300})];
 for(const key of ['platform','team','country']){
  const rows=dimensions(orders,key,[rate()],summaries,'current'),fees=api.feeSummary(rows);
  assert.equal(fees.amount,40);assert.equal(fees.matchedCount,10);assert.equal(fees.successCount,13);assert.equal(fees.complete,false);assert.match(api.feeCoverageText(fees),/三方分组未完整提供/);
 }
});

test('same provider merges verified fee amounts across exact platform identities without repricing from current percentages',()=>{
 const orders=[version(order(),39.25),version(order({platformId:'b',platform:'Beta',source:'newar',success_amount:2000,success_count:20}),73.50)];
 const rows=dimensions(orders,'provider',[rate(),rate({scopeType:'platform',platform:'Beta',collectFee:'99%'})]);
 assert.equal(rows.length,1);assert.equal(rows[0].success_amount,3000);assert.equal(rows[0].success_count,30);assert.equal(rows[0].estimated_fee,112.75);assert.equal(rows[0].fee_matched_count,30);assert.equal(rows[0].fee_complete,true);assert.match(rows[0].fee_rate_label,/订单创建时间/);assert.deepEqual(rows[0].platformIds,['a','b']);assert.equal(rows[0].success_amount_share,1);
 assert.equal(dimensions(orders,'provider',[rate({collectFee:'1%'})])[0].estimated_fee,112.75);
});
test('payout fee versions preserve backend amounts and matched counts rather than applying current fixed fees',()=>{
 const rows=dimensions([version(order({direction:'withdraw'}),73.25),version(order({direction:'withdraw',platformId:'b',platform:'Beta',source:'newar',success_amount:2000,success_count:20}),175)]);
 assert.equal(rows[0].estimated_fee,248.25);assert.match(rows[0].fee_rate_label,/订单创建时间/);assert.equal(rows[0].fee_matched_count,30);assert.equal(rows[0].fee_share,1);
});
test('country and team fees sum verified provider leaves while business totals preserve missing provider evidence',()=>{
 const orders=[version(order(),39.25),version(order({provider:'OtherPay',success_amount:500,success_count:5}),8.75)],summaries=[summaryOf(orders,{platformId:'a',platform:'Alpha',country:'印度',source:'ar',team:'Group A',success_amount:1800,success_count:18})];
 for(const key of ['country','team']){const rows=dimensions(orders,key,[rate(),rate({provider:'OtherPay',collectFee:'2%'})],summaries);assert.equal(rows.length,1);assert.equal(rows[0].success_amount,1800);assert.equal(rows[0].success_count,18);assert.equal(rows[0].estimated_fee,48);assert.equal(rows[0].fee_matched_count,15);assert.equal(rows[0].fee_eligible_count,18);assert.equal(rows[0].fee_complete,false);assert.match(rows[0].fee_rate_label,/未匹配/);}
});
test('same display platform from different stable identities never merges historical fee facts',()=>{
 const rows=dimensions([version(order(),41),version(order({platformId:'b',source:'newar',success_amount:2000}),89)],'platform');assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.platformId),['a','b']);assert.deepEqual(rows.map(r=>r.estimated_fee),[41,89]);
});
test('manual recharge and confirmation retain ledger amounts and are excluded even if presented with fee-version fields',()=>{
 const orders=[version(order(),40),version(order({provider:'人工充值',success_amount:500,success_count:5}),495),version(order({provider:'人工确认',direction:'withdraw',success_amount:800,success_count:8}),792),order({provider:'无三方（驳回）',direction:'withdraw',all_amount:200,all_count:2,success_amount:0,success_count:0})];
 const rows=dimensions(orders,'provider',[rate(),...orders.slice(1).map(r=>rate({provider:r.provider,collectFee:'99%',payoutFee:'99%'}))]);
 for(const row of rows.filter(r=>r.provider!=='ExamplePay')){assert.equal(api.isProviderBusiness(row.provider),false);assert.equal(row.estimated_fee,null);assert.equal(row.fee_rate_label,'不适用');assert.equal(row.fee_eligible_count,0);assert.equal(row.fee_complete,true)}
 const charge=rows.filter(r=>r.direction==='charge'),real=charge.find(r=>r.provider==='ExamplePay'),manual=charge.find(r=>r.provider==='人工充值');assert.equal(real.success_amount_share,2/3);assert.equal(manual.success_amount_share,1/3);assert.equal(manual.success_amount,500);
 const fees=api.feeSummary(charge);assert.equal(fees.amount,40);assert.equal(fees.successCount,10);assert.equal(fees.excludedCount,5);assert.equal(fees.complete,true);assert.equal(api.estimate(orders[1],[rate({provider:'人工充值'})],'印度'),null);
});
test('unidentified successful orders stay unmatched and cannot claim verified provider fee totals',()=>{
 const rows=dimensions([version(order(),40),version(order({provider:'未识别通道',success_amount:500,success_count:5}),20)]),unknown=rows.find(r=>r.provider==='未识别通道');assert.equal(unknown.estimated_fee,null);assert.equal(unknown.fee_eligible_count,5);assert.equal(unknown.fee_complete,false);assert.equal(api.isProviderBusiness(unknown.provider),false);
 const fees=api.feeSummary(rows);assert.equal(fees.amount,40);assert.equal(fees.matchedCount,10);assert.equal(fees.successCount,15);assert.equal(fees.complete,false);
});
test('zero verified fees are known, while current rate conflicts cannot create or invalidate historical evidence',()=>{
 const free=dimensions([version(order(),0)],'provider',[rate({collectFee:'40%'})])[0];assert.equal(free.estimated_fee,0);assert.equal(free.fee_complete,true);assert.match(free.fee_rate_label,/订单创建时间/);assert.equal(free.fee_share,null);
 const conflictRates=[rate(),rate({collectFee:'5%'})],unknown=dimensions([order()],'provider',conflictRates)[0];assert.equal(unknown.estimated_fee,null);assert.equal(unknown.fee_complete,false);assert.equal(unknown.fee_issues[0].reason,'missing_fee_history');assert.equal(dimensions([version(order(),36)],'provider',conflictRates)[0].estimated_fee,36);
});
test('confirmed UpiPay source identity controls current references while fee versions independently preserve both direction amounts',()=>{
 const orders=[version(order({provider:'UpiPay'}),37.5),version(order({provider:'UpiPay',direction:'withdraw'}),82.5)],rates=[rate({provider:'UpiPay',sheetName:'印度线下',sourceRow:4,collectFee:'4.00%'}),rate({provider:'UpiPay',sheetName:'印度线下',sourceRow:47,collectFee:'4.30%',payoutFee:'2.80%'})];
 const rows=dimensions(orders,'provider',rates);assert.equal(rows[0].estimated_fee,37.5);assert.equal(rows[1].estimated_fee,82.5);assert.equal(api.feeCandidates(orders[0],rates,'印度')[0].sourceRow,4);assert.equal(api.feeCandidates(orders[1],rates,'印度')[0].sourceRow,4);assert(rows.every(r=>/订单创建时间/.test(r.fee_rate_label)));
});
test('fees and shares isolate direction and currency and do not combine cross-currency money',()=>{
 const rows=dimensions([version(order(),40),order({provider:'OtherPay',success_amount:null,success_count:5}),version(order({direction:'withdraw'}),83),version(order({currency:'USD',success_amount:30,success_count:3}),2)],'provider',[rate(),rate({provider:'OtherPay'})]),charge=rows.filter(r=>r.direction==='charge'&&r.currency==='INR');assert(charge.every(r=>r.success_amount_share===null));assert.equal(charge[0].success_count_share,2/3);assert.equal(rows.find(r=>r.currency==='USD').success_amount_share,1);assert.equal(rows.find(r=>r.direction==='withdraw').estimated_fee,83);assert.equal(api.feeSummary(rows).amount,null);
});
test('provider summary excludes manual records without removing ledger rows',()=>{
 const orders=[version(order(),40),order({provider:'人工充值',success_amount:500,success_count:5})],rows=api.buildRows({orders,issues:[],rates:[rate()],country:'印度',direction:'charge',plus,combine});assert.equal(rows.length,2);assert.equal(plus(rows).success_amount,1500);assert.equal(rows.find(r=>r.provider==='人工充值').estimated_fee,null);assert.equal(api.feeSummary(rows).amount,40);assert.equal(api.feeSummary(rows).complete,true);
});
test('business types come only from identity-checked original source fields, independently of fees',()=>{
 const r=order({provider:'ICPay'}),source=rate({provider:'ICPay',category:'UPI',sourceType:'跑分',sourceTypeProvider:'IC2Pay',sheetName:'印度线下',sourceTypeCell:'B6'});
 assert.equal(api.providerType(r,[source],'印度').label,'跑分');
 assert.match(api.providerType(r,[source],'印度').detail,/B6/);
 assert.equal(api.providerType(r,[{...source,sourceType:null}],'印度').label,'未标注');
 assert.equal(api.providerType(r,[{...source,sourceTypeProvider:'UnrelatedPay'}],'印度').label,'待核对');
 assert.equal(api.providerType(r,[{...source,country:'巴西'}],'印度').label,'未标注');
 assert.equal(api.providerType(r,[source,{...source,sourceType:'钱包'}],'印度').label,'多种类型');
 assert.equal(api.providerType(order({provider:'人工充值'}),[source],'印度').label,'—');
 assert.equal(api.providerType(r,null,'印度').label,'读取中…');
 assert.equal(api.estimate(version(r,37.25),[source],'印度'),37.25,'business type cannot change a verified historical fee');
});
test('source business types keep the confirmed UpiPay row and platform-specific scope',()=>{
 const base=rate({provider:'UpiPay',sourceTypeProvider:'UPIPAY',sheetName:'印度线下',sourceRow:4,sourceType:'唤醒/跑分'}),r=order({provider:'UpiPay'});
 assert.equal(api.providerType(r,[base,{...base,sourceRow:48,sourceTypeProvider:'HAP',sourceType:'其他'}],'印度').label,'唤醒/跑分');
 assert.equal(api.providerType(r,[{...base,sourceRow:48}],'印度').label,'未标注');
 const general=rate({sourceTypeProvider:'ExamplePay',sourceType:'跑分'}),specific={...general,scopeType:'platform',platform:'Alpha',sourceType:'钱包'};
 assert.equal(api.providerType(order(),[general,specific],'印度').label,'钱包');
 assert.equal(api.providerType(order({platform:'Beta'}),[general,specific],'印度').label,'跑分');
 const escape=s=>String(s).replace(/[<>"]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 assert.doesNotMatch(api.providerTypeCell(order(),[{...general,sourceType:'<img onerror=bad>'}],'印度',escape),/<img/);
});

test('merged provider types reconcile all platform leaves in both summary and overview',()=>{
 const general=rate({sourceTypeProvider:'ExamplePay',sourceType:'跑分'}),specific={...general,scopeType:'platform',platform:'Alpha',sourceType:'钱包'},rates=[general,specific];
 const orders=[order(),order({platformId:'b',platform:'Beta'})];
 const summary=api.buildRows({orders,issues:[],rates,country:'印度',direction:'charge',plus,combine})[0],overview=dimensions(orders,'provider',rates)[0];
 for(const row of [summary,overview]){const type=api.providerType(row,rates,'印度');assert.equal(type.label,'多种类型');assert.deepEqual(type.types.sort(),['跑分','钱包'].sort());}
 const E=s=>String(s).replaceAll('<','&lt;');
 assert.match(api.providerTypeCell(order(),[],'印度',E,{feeLookupError:'Synthetic failure'}),/>读取失败</);
 assert.match(api.providerTypeCell(order(),rates,'印度',E,{feeLookupLoading:true}),/>读取中…</);
 assert.doesNotMatch(api.providerTypeCell(order(),[],'印度',E,{feeLookupError:'Synthetic failure'}),/未标注/);
});


test('current source lookup retains its cache and identity boundaries independently of historical fee amounts',()=>{
 let reads=0;const rates=Array.from({length:200},(_,i)=>({...rate(),get provider(){reads++;return 'Pay'+i;}})),r=order({provider:'Pay0'});
 assert.equal(api.feeCandidates(r,rates,'印度')[0].collectFee,'4%');const first=reads;for(let i=0;i<40;i++)api.feeCandidates(r,rates,'印度');assert.equal(reads,first);assert.equal(api.feeCandidates(r,[rate({provider:'Pay0',collectFee:'5%'})],'印度')[0].collectFee,'5%');rates.push(rate({provider:'Pay0',collectFee:'6%'}));assert.equal(api.feeCandidates(r,rates,'印度').length,2);assert.equal(api.feeCandidates(r,rates,'巴西').length,0);
 const verified=version(r,37);assert.equal(api.estimate(verified,rates,'印度'),37);assert.equal(api.estimate(verified,[rate({provider:'Pay0',collectFee:'99%'})],'印度'),37);
});
test('fee coverage explains excluded successes and genuinely missing history without inventing zero money',()=>{
 const orders=[version(order({success_count:403420}),40),order({provider:'人工充值',success_count:23}),order({provider:'NoHistoryPay',success_count:1800}),order({provider:'未识别通道',success_count:7})],rows=dimensions(orders),fees=api.feeSummary(rows),text=api.feeCoverageText(fees);
 assert.equal(plus(rows).success_count,405250);assert.equal(fees.successCount,405227);assert.equal(fees.matchedCount,403420);assert.equal(fees.excludedCount,23);assert.equal(fees.amount,40);assert.match(text,/成功总笔数 405,250/);assert.match(text,/不计三方手续费 23/);assert.match(text,/应匹配 405,227/);assert.match(text,/未匹配 1,807/);assert.match(text,/人工充值 23 笔/);assert.match(text,/NoHistoryPay 1,800 笔（订单创建时的费率版本或币种未确认）/);assert.match(text,/未识别通道 7 笔（未识别三方/);assert.equal(fees.issues.reduce((n,r)=>n+r.count,0),1807);assert.equal(rows.find(r=>r.provider==='NoHistoryPay').estimated_fee,null);
});
test('partial, malformed and absent historical version facts remain explicit instead of borrowing current source rates',()=>{
 const current=[rate()];for(const raw of [order(),version(order(),null),{...version(order(),10,5),fee_version_state:'complete'},{...version(order(),40),fee_version_unmatched_count:5},version(order(),Infinity),version(order(),-1)]){const r=dimensions([raw],'provider',current)[0];assert.equal(r.fee_complete,false);assert.equal(r.fee_issues[0].reason,'missing_fee_history');}
 const partial=dimensions([version(order(),17.25,4)],'provider',current)[0];assert.equal(partial.estimated_fee,17.25);assert.equal(partial.fee_matched_count,4);assert.equal(partial.fee_issues[0].count,6);assert.match(partial.fee_rate_label,/部分未匹配/);
 const raw=version(order(),40),missing=dimensions([raw],'platform',current,[{...raw,success_count:13}])[0];assert.equal(missing.fee_issues[0].reason,'missing_provider_breakdown');assert.equal(missing.fee_issues[0].count,3);assert.equal(missing.fee_matched_count,10);
});
test('confirmed RAJA alias selects its own current source without repricing verified old orders',()=>{
 require('../admin-preview/live-report-data.js');const rates=[rate({collectFee:'4%'}),rate({scopeType:'platform',platform:'RAJA',collectFee:'3%'})],ar=version(order({platform:'RAJALOTTERY',team:'M8'}),29.25),newar=version(order({platform:'RAJALOTTERY',source:'newar'}),39.25);
 assert.equal(api.feeCandidates(ar,rates,'印度')[0].collectFee,'3%');assert.equal(api.feeCandidates(newar,rates,'印度')[0].collectFee,'4%');assert.equal(api.estimate(ar,rates,'印度'),29.25);assert.equal(api.estimate(newar,rates,'印度'),39.25);
});
test('YayaPay 924 current reference retains original identity and does not replace verified historical fees',()=>{
 const active=rate({provider:'YayaPay',sheetName:'印度线下',sourceRow:22,sourceTypeProvider:'YAYAPAY-924',sourceType:'混合四方',collectFee:'5.20%',payoutFee:'3.10%',payoutSingleFee:'7'}),other={...active,sourceRow:30,sourceTypeProvider:'YAYAPAY-923',sourceType:'跑分',collectFee:'6.30%',payoutFee:'4.20%'},rates=[other,active],orders=[version(order({provider:'YayaPay'}),51.25),version(order({provider:'YAYAPAY-924',direction:'withdraw'}),99.25)],rows=dimensions(orders,'provider',rates);
 assert.equal(rows[0].estimated_fee,51.25);assert.equal(rows[1].estimated_fee,99.25);for(const r of rows){assert.equal(r.fee_complete,true);assert.equal(api.providerType(r,rates,'印度').label,'混合四方')}
 assert.equal(api.feeCandidates(orders[0],[{...active,sourceRow:40}],'印度').length,1);for(const invalid of [[other],[{...active,sourceTypeProvider:'UnrelatedPay'}],[{...active,sourceTypeProvider:''}],[{...active,country:'巴西'}]])assert.equal(api.feeCandidates(orders[0],invalid,'印度').length,0);
 assert.equal(api.estimate(orders[0],[{...active,collectFee:'99%'}],'印度'),51.25);const summary=api.buildRows({orders,issues:[],rates,country:'印度',direction:'charge',plus,combine})[0];assert.equal(summary.estimated_fee,51.25);
});
