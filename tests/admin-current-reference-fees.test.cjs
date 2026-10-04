// Synthetic authorized aggregate facts; no network, production data or writes.
const test=require('node:test'),assert=require('node:assert/strict');
require('../admin-preview/live-provider-aliases.js');
require('../admin-preview/live-report-data.js');
const api=require('../admin-preview/live-provider-summary.js');
const leaf=(extra={})=>({platformId:'ar-alpha',platform:'Alpha',source:'ar',country:'印度',provider:'ExamplePay',direction:'charge',currency:'INR',success_amount:1000,success_count:10,all_amount:9000,all_count:90,created_success_count:8,...extra});
const rate=(extra={})=>({country:'印度',provider:'ExamplePay',scopeType:'country',collectFee:'4%',payoutFee:'2.5%',...extra});
const facts=(r=leaf(),rates=[rate()],country='印度')=>api.currentReferenceFeeFacts(r,rates,country);
const grouped=(rows,extra={})=>({fee_items:rows,currency:'INR',success_count:rows.every(r=>Number.isSafeInteger(r.success_count))?rows.reduce((n,r)=>n+r.success_count,0):null,...extra});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} !== ${expected}`);
const hasReason=(r,key)=>assert.ok(r.reasons.some(reason=>reason.reason===key),JSON.stringify(r.reasons));
const version=(r,amount)=>({...r,fee_version_state:'complete',fee_version_matched_count:r.success_count,fee_version_unmatched_count:0,fee_version_estimated_amount:amount});
function tier(amounts,extra={}){
 const known=amounts.filter(n=>n!==null&&n>=0),low=known.filter(n=>n<=2000),high=known.filter(n=>n>=2001),gap=known.filter(n=>n>2000&&n<2001),sum=rows=>rows.reduce((n,x)=>n+x,0);
 return leaf({provider:'Speed2Pay',direction:'withdraw',success_count:amounts.length,success_amount:amounts.includes(null)?null:sum(amounts),fee_low_count:low.length,fee_low_amount:sum(low),fee_high_count:high.length,fee_high_amount:sum(high),fee_gap_count:gap.length,fee_gap_amount:sum(gap),fee_unpriced_count:amounts.length-known.length,...extra});
}

test('current reference prices successful-time amounts independently of created/all facts and immutable historical fees',()=>{
 const r=version(leaf(),37.25),before=structuredClone(r),reference=facts(r);
 assert.equal(reference.amount,40);assert.equal(reference.matchedCount,10);assert.equal(reference.eligibleCount,10);assert.equal(reference.complete,true);assert.equal(reference.label,'按当前费率参考估算');assert.equal(api.estimateFacts(r,[rate()],'印度').amount,37.25);
 assert.equal(facts(r,[rate({collectFee:'5%'})]).amount,50);assert.equal(api.estimateFacts(r,[rate({collectFee:'5%'})],'印度').amount,37.25);assert.deepEqual(r,before);
 assert.equal(facts(leaf()).amount,40);assert.equal(api.estimateFacts(leaf(),[rate()],'印度').amount,null);
});
test('each platform uses its own current rule before merging and never applies one rate to a mixed provider aggregate',()=>{
 const rows=[leaf(),leaf({platformId:'ar-beta',platform:'Beta',source:'newar',success_amount:2000,success_count:20})],rates=[rate({collectFee:'2%'}),rate({scopeType:'platform',platform:'Beta',collectFee:'5%'})],result=facts(grouped(rows),rates);
 assert.equal(result.amount,120);assert.equal(result.matchedCount,30);assert.equal(result.complete,true);assert.equal(result.unknownCount,0);
 const byDirection=facts(grouped([leaf(),leaf({direction:'withdraw'})]),[rate()]);assert.equal(byDirection.amount,65);
});
test('blank, invalid or conflicting platform exceptions cannot borrow the country fee',()=>{
 for(const collectFee of ['', 'contact us', '101%']){const result=facts(leaf(),[rate(),rate({scopeType:'platform',platform:'Alpha',collectFee})]);assert.equal(result.amount,null);assert.equal(result.complete,false);hasReason(result,'unsupported_rate');}
 const conflict=facts(leaf(),[rate(),rate({scopeType:'platform',platform:'Alpha',collectFee:'2%'}),rate({scopeType:'platform',platform:'Alpha',collectFee:'3%'})]);hasReason(conflict,'conflicting_rates');assert.equal(conflict.amount,null);
 assert.equal(facts(leaf(),[rate(),rate({scopeType:'platform',platform:'Other',collectFee:'3%'})]).amount,40);
});
test('owner-confirmed UpiPay and YayaPay source identities still take precedence over unrelated source rows',()=>{
 const upi=leaf({provider:'UpiPay'}),confirmed=rate({provider:'UpiPay',sheetName:'印度线下',sourceRow:4}),other={...confirmed,sourceRow:48,collectFee:'9%'};
 assert.equal(facts(upi,[other,confirmed]).amount,40);assert.equal(facts(upi,[other]).amount,null);assert.equal(facts(upi,[other,{...confirmed,collectFee:''}]).amount,null);
 const yaya=leaf({provider:'YayaPay'}),active=rate({provider:'YayaPay',sheetName:'印度线下',sourceTypeProvider:'YAYAPAY-924',collectFee:'5.2%'}),old={...active,sourceTypeProvider:'YAYAPAY-923',collectFee:'9%'};
 near(facts(yaya,[old,active]).amount,52);assert.equal(facts(yaya,[old]).amount,null);
});
test('native AR aliases do not give the same display name in another source a platform exception',()=>{
 const rates=[rate(),rate({scopeType:'platform',platform:'RAJA',collectFee:'3%'})];
 assert.equal(facts(leaf({platform:'RAJALOTTERY'}),rates).amount,30);assert.equal(facts(leaf({platform:'RAJALOTTERY',source:'newar'}),rates).amount,40);
});
test('a successful-count gap preserves the priced subtotal and declares every absent provider success unpriced',()=>{
 const result=facts(grouped([leaf()],{success_count:13}));assert.equal(result.amount,40);assert.equal(result.matchedCount,10);assert.equal(result.eligibleCount,13);assert.equal(result.unknownCount,3);assert.equal(result.complete,false);assert.equal(result.reasons.find(r=>r.reason==='missing_provider_breakdown').count,3);
 const empty=facts({fee_items:[],items:[leaf()],currency:'INR',success_count:13});assert.equal(empty.amount,null);assert.equal(empty.matchedCount,0);assert.equal(empty.unknownCount,13);hasReason(empty,'missing_provider_breakdown');
 for(const fee_items of [null,undefined,true,{}]){const invalid=facts({...leaf(),fee_items,items:[leaf()]});assert.equal(invalid.amount,null);hasReason(invalid,'missing_provider_breakdown');}
 const duplicate=facts(grouped([leaf(),leaf()],{success_count:10}));assert.equal(duplicate.amount,null);assert.equal(duplicate.matchedCount,0);hasReason(duplicate,'inconsistent_provider_breakdown');
 const wrongAmount=facts(grouped([leaf()],{success_amount:1800}));assert.equal(wrongAmount.amount,null);assert.equal(wrongAmount.complete,false);hasReason(wrongAmount,'inconsistent_provider_breakdown');
});
test('nested date parts use original leaves and a parent count mismatch cannot be marked complete',()=>{
 const nested={...leaf(),success_count:20,success_amount:2000,items:[leaf(),leaf()]},result=facts(grouped([nested]));assert.equal(result.amount,80);assert.equal(result.complete,true);
 const missing=facts(grouped([{...nested,success_count:23}],{success_count:23}));assert.equal(missing.amount,80);assert.equal(missing.unknownCount,3);assert.equal(missing.complete,false);
 const extra=facts(grouped([{...nested,success_count:10}],{success_count:10}));assert.equal(extra.amount,null);assert.equal(extra.complete,false);
});
test('unknown success counts and invalid amounts never become zero or a complete denominator',()=>{
 for(const success_count of [null,undefined,true,'',NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]){const result=facts(leaf({success_count}));assert.equal(result.amount,null);assert.equal(result.eligibleCount,null);assert.equal(result.unknownCount,null);assert.equal(result.complete,false);hasReason(result,'missing_success_count');}
 for(const success_amount of [null,undefined,true,'',NaN,Infinity,-1]){const result=facts(leaf({success_amount}));assert.equal(result.amount,null);assert.equal(result.unknownCount,10);hasReason(result,'invalid_success_amount');}
 const partial=facts(grouped([leaf(),leaf({success_count:null})]));assert.equal(partial.amount,40);assert.equal(partial.eligibleCount,null);assert.equal(partial.unknownCount,null);assert.equal(partial.complete,false);
 const knownParent=facts(grouped([leaf(),leaf({success_count:null})],{success_count:10}));assert.equal(knownParent.amount,40);assert.equal(knownParent.matchedCount,10);assert.equal(knownParent.eligibleCount,null);assert.equal(knownParent.unknownCount,null);assert.equal(knownParent.complete,false);
 const impossibleParent=facts(grouped([leaf(),leaf({success_count:null})],{success_count:5}));assert.equal(impossibleParent.amount,null);assert.equal(impossibleParent.matchedCount,0);assert.equal(impossibleParent.complete,false);hasReason(impossibleParent,'inconsistent_provider_breakdown');
 const zero=facts(leaf({success_count:0,success_amount:0}),[]);assert.equal(zero.amount,0);assert.equal(zero.complete,true);assert.equal(facts(leaf({success_count:0,success_amount:100})).amount,null);
});
test('explicit country, direction, platform identity and native currency are required, with no country currency fallback',()=>{
 for(const extra of [{country:'巴西'},{country:null},{platformId:null},{platformId:true},{platform:''},{source:''},{direction:'all'},{currency:null},{currency:'inr'},{currency:true}]){const result=facts(leaf(extra));assert.equal(result.amount,null);assert.equal(result.complete,false);}
 assert.equal(facts(leaf({country:'IN'})).amount,40);
 const mixed=facts(grouped([leaf(),leaf({currency:'USD'})]));assert.equal(mixed.amount,null);assert.equal(mixed.matchedCount,0);hasReason(mixed,'mixed_currency');
});
test('unsupported and nonfinite rates fail closed while explicitly zero and percentage rates remain known',()=>{
 for(const collectFee of ['-4%','101%','1e400%','1%+6','3%/2%','999999999999999999999999999999999999999999%']){const result=facts(leaf(),[rate({collectFee})]);assert.equal(result.amount,null);hasReason(result,'unsupported_rate');}
 assert.equal(facts(leaf(),[rate({collectFee:'0%'})]).amount,0);assert.equal(facts(leaf(),[rate({collectFee:'100%'})]).amount,1000);
 assert.equal(facts(leaf(),[rate({country:'巴西'})]).amount,null);assert.equal(facts(leaf(),null).amount,null);
});
test('generic fixed fees require explicit source currency proof and never infer it from country or USDT category',()=>{
 const payout=leaf({direction:'withdraw'}),fixed=rate({payoutSingleFee:'6',category:'USDT'});
 for(const r of [fixed,{...fixed,currency:'INR'},{...fixed,feeEffective:{withdraw:{source:{currencyCell:'BD4'}}}}]){const result=facts(payout,[r]);assert.equal(result.amount,null);hasReason(result,'fixed_fee_currency_unconfirmed');}
 const proof={withdraw:{currency:'INR',source:{currencyCell:'BD4'}}};assert.equal(facts(payout,[{...fixed,feeEffective:proof}]).amount,85);
 const mismatch=facts(payout,[{...fixed,feeEffective:{withdraw:{currency:'USD',source:{currencyCell:'BD4'}}}}]);assert.equal(mismatch.amount,null);hasReason(mismatch,'fee_currency_mismatch');
 assert.equal(facts(leaf(),[rate({feeEffective:{charge:{currency:'USD',source:{currencyCell:'BD4'}}}})]).amount,null);
 assert.equal(facts(payout,[{...fixed,payoutSingleFee:'0'}]).amount,25);
});
test('different channel categories stay ambiguous unless the original leaf explicitly carries that category',()=>{
 const rates=[rate({category:'UPI'}),rate({category:'USDT',collectFee:'1%'})];const aggregate=facts(leaf(),rates);assert.equal(aggregate.amount,null);hasReason(aggregate,'conflicting_rates');
 assert.equal(facts(leaf({fee_category:'UPI'}),rates).amount,40);assert.equal(facts(leaf({currency:'USDT'}),rates).amount,null);
 for(const extra of [{fee_category:'USDT'},{channel_type:'USDT'}]){const missing=facts(leaf(extra),[rate({category:'UPI'})]);assert.equal(missing.amount,null);hasReason(missing,'missing_category_rate');}
 assert.equal(facts(leaf(),[rate({category:'UPI'}),rate({category:'USDT'})]).amount,40,'one identical linear rule is independent of category');
});
test('manual and unidentified providers retain distinct excluded and unpriced success counts',()=>{
 const result=facts(grouped([leaf(),leaf({provider:'人工充值',success_count:5,success_amount:500}),leaf({provider:'未识别通道',success_count:2,success_amount:200})]));assert.equal(result.amount,40);assert.equal(result.successCount,17);assert.equal(result.excludedCount,5);assert.equal(result.eligibleCount,12);assert.equal(result.matchedCount,10);assert.equal(result.unknownCount,2);assert.equal(result.complete,false);
 const excluded=facts(leaf({provider:'人工确认'}));assert.equal(excluded.amount,null);assert.equal(excluded.excludedCount,10);assert.equal(excluded.eligibleCount,0);assert.equal(excluded.complete,true);
});
test('WG native exemption must have consistent source zero-fee proof and does not apply to AR or the display name alone',()=>{
 const wg=version(leaf({source:'wg',provider:'提现转充值',fee_exempt_count:10}),0),exempt=facts(wg,[]);assert.equal(exempt.amount,0);assert.equal(exempt.matchedCount,10);assert.equal(exempt.complete,true);assert.equal(exempt.exemptOnly,true);
 for(const extra of [{source:'ar'},{fee_exempt_count:9},{fee_exempt_count:null},{fee_version_estimated_amount:3},{fee_version_unmatched_count:1}]){const result=facts({...wg,...extra},[]);assert.equal(result.amount,null);assert.equal(result.complete,false);}
});
test('WG partially exempt successes merged under a display alias cannot all be charged at the generic rate',()=>{
 const mixed=leaf({source:'wg',provider:'ExamplePay',success_count:14,success_amount:1400,fee_exempt_count:13,fee_version_state:'partial',fee_version_matched_count:13,fee_version_unmatched_count:1,fee_version_estimated_amount:0}),before=structuredClone(mixed),result=facts(mixed,[rate()]);
 assert.equal(result.amount,null);assert.equal(result.matchedCount,0);assert.equal(result.eligibleCount,14);assert.equal(result.unknownCount,14);assert.equal(result.complete,false);hasReason(result,'mixed_fee_exemption');assert.deepEqual(mixed,before);assert.equal(api.estimateFacts(mixed,[rate()],'印度').amount,0);
 for(const fee_exempt_count of [14,15,0.5,-1,true,'',NaN,Infinity,'unknown']){const invalid=facts({...mixed,fee_exempt_count},[rate()]);assert.equal(invalid.amount,null);assert.equal(invalid.complete,false);hasReason(invalid,'mixed_fee_exemption');}
 assert.equal(facts({...mixed,fee_exempt_count:0},[rate()]).amount,56);
 assert.equal(facts({...mixed,source:'ar'},[rate()]).amount,56,'the native exemption field applies only to WG recharge semantics');
});
test('confirmed INR Speed2Pay tier uses each amount band rather than an average rate and stays independent of history',()=>{
 const r=version(tier([500,2000,2001,9000]),301.5),result=facts(r,[]);near(result.amount,307.02);assert.equal(result.matchedCount,4);assert.equal(result.complete,true);assert.equal(api.estimateFacts(r,[],'印度').amount,301.5);
 for(const [value,expected] of [[2000,66],[2001,40.02],[1999.75,65.9925],[2001.25,40.025]])near(facts(tier([value]),[]).amount,expected);
});
test('Speed2Pay gaps and unpriced amounts preserve only the verified band subtotal and explicit unknown counts',()=>{
 const gap=facts(tier([2000,2000.5,2001]),[]);near(gap.amount,106.02);assert.equal(gap.matchedCount,2);assert.equal(gap.unknownCount,1);assert.equal(gap.complete,false);hasReason(gap,'unconfirmed_amount_band');
 const unknown=facts(tier([500,null,2001]),[]);near(unknown.amount,61.02);assert.equal(unknown.matchedCount,2);assert.equal(unknown.unknownCount,1);assert.equal(unknown.complete,false);hasReason(unknown,'invalid_success_amount');
 assert.equal(facts(tier([2000.5]),[]).amount,null);
});
test('tier bands require exact count coverage, valid bounds and amount consistency; missing bands or other currencies cannot borrow the tier',()=>{
 for(const extra of [{fee_low_count:null},{fee_low_count:2},{fee_high_amount:9999},{fee_low_count:0,fee_high_count:2,fee_high_amount:5000},{success_amount:9000},{fee_gap_count:1,fee_high_count:0,fee_gap_amount:2001}]){const result=facts(tier([2000,2001],extra),[]);assert.equal(result.amount,null);assert.equal(result.complete,false);}
 const old=leaf({provider:'Speed2Pay',direction:'withdraw'});assert.equal(facts(old,[]).amount,null);assert.equal(facts(tier([2000],{currency:'USD'}),[]).amount,null);assert.equal(facts(tier([2000],{direction:'charge'}),[]).amount,null);
 const split={...tier([2000,2001]),items:[tier([2000]),tier([2001])]};near(facts(split,[]).amount,106.02);
});
