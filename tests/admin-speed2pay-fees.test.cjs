// Synthetic successful-order facts only; no production records or network.
const test=require('node:test'),assert=require('node:assert/strict');
require('../admin-preview/live-provider-aliases.js');
const api=require('../admin-preview/live-provider-summary.js');
const row=(amounts,extra={})=>({provider:'Speed2Pay',platformId:'p',platform:'Synthetic',source:'ar',country:'印度',currency:'INR',direction:'withdraw',
 success_count:amounts.length,success_amount:amounts.some(x=>x===null)?null:amounts.reduce((a,b)=>a+b,0),
 fee_low_count:amounts.filter(x=>x!==null&&x>=0&&x<=2000).length,fee_low_amount:String(amounts.filter(x=>x!==null&&x>=0&&x<=2000).reduce((a,b)=>a+b,0)),
 fee_high_count:amounts.filter(x=>x>=2001).length,fee_high_amount:String(amounts.filter(x=>x>=2001).reduce((a,b)=>a+b,0)),
 fee_gap_count:amounts.filter(x=>x>2000&&x<2001).length,fee_gap_amount:String(amounts.filter(x=>x>2000&&x<2001).reduce((a,b)=>a+b,0)),
 fee_unpriced_count:amounts.filter(x=>x===null||x<0).length,...extra});
const plus=rows=>({success_count:rows.reduce((n,r)=>n+r.success_count,0),success_amount:rows.some(r=>r.success_amount===null)?null:rows.reduce((n,r)=>n+Number(r.success_amount),0)});
const combine=(rows,keys)=>{const groups=new Map();for(const r of rows){const id=JSON.stringify(keys.map(k=>r[k]));if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r)}return [...groups.values()].map(items=>({...Object.fromEntries(keys.map(k=>[k,items[0][k]])),...plus(items),items}))};
const providerRows=orders=>api.buildRows({orders,issues:[],rates:[],country:'印度',direction:'withdraw',plus,combine});
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} vs ${expected}`);

const version=(r,amount,matched=r.success_count)=>({...r,fee_version_state:matched===r.success_count?'complete':matched?'partial':'unknown',fee_version_matched_count:matched,fee_version_unmatched_count:r.success_count-matched,fee_version_estimated_amount:amount});

test('Speed2Pay preserves explicitly verified backend per-order fee versions and never falls back to the current tier formula',()=>{
 for(const [amount,serverFee] of [[2000,65],[2001,41],[500,20],[1999.75,65.25],[2001.25,41.25]]){const r=version(row([amount]),serverFee),value=api.estimateFacts(r,[],'印度');close(value.amount,serverFee);assert.equal(value.matched,1);assert.equal(api.estimate(row([amount]),[],'印度'),null);}
 const r=providerRows([version(row([500,2000,2001,9000]),301.5)])[0];close(r.estimated_fee,301.5);assert.equal(r.fee_matched_count,4);assert.equal(r.fee_complete,true);assert.notEqual(r.estimated_fee,r.success_amount*.02);assert.match(r.fee_rate_label,/订单创建时间/);
});
test('partial historical pricing preserves the matched amount and labels unmatched order count',()=>{
 const r=providerRows([version(row([2000,2000.5,2001]),103.75,2)])[0];close(r.estimated_fee,103.75);assert.equal(r.fee_matched_count,2);assert.equal(r.fee_eligible_count,3);assert.equal(r.fee_complete,false);assert.match(r.fee_rate_label,/部分未匹配/);assert.equal(r.fee_issues[0].count,1);assert.equal(r.fee_issues[0].reason,'missing_fee_history');
 const gap=providerRows([version(row([2000.5]),null,0)])[0];assert.equal(gap.estimated_fee,null);assert.equal(gap.fee_matched_count,0);assert.equal(gap.fee_complete,false);
});
test('unknown current order amounts cannot change an independently verified partial historical fee',()=>{
 const r=providerRows([version(row([2000,null,-5,2001]),103.75,2)])[0];close(r.estimated_fee,103.75);assert.equal(r.success_amount,null);assert.equal(r.fee_matched_count,2);assert.equal(r.fee_complete,false);assert.equal(r.fee_issues[0].count,2);
});
test('legacy total-only or amount-band-only responses cannot be assigned a historical fee',()=>{
 const rates=[{provider:'Speed2Pay',country:'印度',scopeType:'country',payoutFee:'3%',payoutSingleFee:'6'}],old=row([2000,2001]);for(const key of Object.keys(old).filter(k=>k.startsWith('fee_')))delete old[key];
 for(const r of [old,row([2000,2001]),row([2000,2001],{fee_low_count:null}),row([2000,2001],{fee_high_amount:9999})]){assert.equal(api.estimate(r,rates,'印度'),null);assert.equal(providerRows([r])[0].fee_complete,false);}
 for(const change of [{fee_version_matched_count:3},{fee_version_unmatched_count:-1},{fee_version_estimated_amount:null},{fee_version_estimated_amount:Infinity},{fee_version_state:'partial'},{currency:null}])assert.equal(api.estimate({...version(row([2000,2001]),103.75),...change},rates,'印度'),null);
});
test('date-split leaves and multiple platforms sum server fee versions exactly once and preserve unknown leaves',()=>{
 const parts=[version(row([2000]),65),version(row([2001]),41),version(row([2000.5]),null,0)],merged={...parts[0],...plus(parts),items:parts};for(const key of Object.keys(merged).filter(k=>k.startsWith('fee_')))delete merged[key];
 const result=providerRows([merged,version(row([1000,8000],{platformId:'q',platform:'Second',source:'newar'}),191)])[0];close(result.estimated_fee,297);assert.equal(result.fee_matched_count,4);assert.equal(result.success_count,5);assert.equal(result.fee_complete,false);assert.equal(api.estimate({...merged,success_count:99},[],'印度'),null);
 const mixed={...merged,items:[parts[0],{...parts[1],currency:'USD'}],success_count:2};assert.equal(api.estimate(mixed,[],'印度'),null);
});
test('current confirmed tier remains an India INR payout reference and cannot fabricate historical pricing elsewhere',()=>{
 const rates=[{provider:'Speed2Pay',country:'印度',scopeType:'country',collectFee:'4%',payoutFee:'99%'}];assert.match(api.tieredFeeRule(row([2000]),'印度').label,/≤2,000.*≥2,001/);
 for(const change of [{direction:'charge'},{currency:'USD'},{provider:'OtherPay'},{country:'菲律宾'}]){const r=row([2000],change);assert.equal(api.tieredFeeRule(r,r.country),null);assert.equal(api.estimate(r,rates,r.country),null);}
 const charged=version(row([2000],{direction:'charge'}),78.5);close(api.estimate(charged,rates,'印度'),78.5);close(api.estimate(charged,[{...rates[0],collectFee:'50%'}],'印度'),78.5);
});
