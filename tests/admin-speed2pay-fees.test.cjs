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

test('confirmed Speed2Pay payout boundaries are computed per successful order',()=>{
 for(const [amount,expected] of [[2000,66],[2001,40.02],[500,21],[1999.75,65.9925],[2001.25,40.025]]){
  const value=api.estimateFacts(row([amount]),[],'印度');close(value.amount,expected);assert.equal(value.matched,1);
 }
 const values=[500,2000,2001,9000],result=providerRows([row(values)])[0];
 close(result.estimated_fee,21+66+40.02+180);assert.equal(result.fee_matched_count,4);assert.equal(result.fee_complete,true);
 assert.notEqual(result.estimated_fee,result.success_amount*.02);assert.match(result.fee_rate_label,/≤2,000.*≥2,001/);
});
test('unconfirmed fractional boundary stays unmatched without hiding priced records',()=>{
 const r=providerRows([row([2000,2000.5,2001])])[0];close(r.estimated_fee,106.02);assert.equal(r.fee_matched_count,2);assert.equal(r.fee_eligible_count,3);assert.equal(r.fee_complete,false);assert.match(r.fee_rate_label,/待核对/);
 const gap=providerRows([row([2000.5])])[0];assert.equal(gap.estimated_fee,null);assert.equal(gap.fee_matched_count,0);assert.equal(gap.fee_complete,false);
});
test('missing or negative successful amounts remain incomplete while known bands can be priced',()=>{
 const r=providerRows([row([2000,null,-5,2001])])[0];close(r.estimated_fee,106.02);assert.equal(r.success_amount,null);assert.equal(r.fee_matched_count,2);assert.equal(r.fee_complete,false);
});
test('legacy total-only responses and malformed coverage cannot be assigned a flat rate',()=>{
 const old=row([2000,2001]);for(const key of Object.keys(old).filter(k=>k.startsWith('fee_')))delete old[key];
 const rates=[{provider:'Speed2Pay',country:'印度',scopeType:'country',payoutFee:'3%',payoutSingleFee:'6'}];
 assert.equal(api.estimate(old,rates,'印度'),null);assert.equal(providerRows([old])[0].fee_complete,false);
 for(const extra of [{fee_low_count:null},{fee_high_count:7},{fee_low_amount:9000},{fee_gap_count:1,fee_gap_amount:0},{fee_unpriced_count:-1},{fee_high_amount:-5}])assert.equal(api.estimate(row([2000,2001],extra),rates,'印度'),null);
});
test('date-split leaves and multiple platforms sum their band fees exactly once',()=>{
 const parts=[row([2000]),row([2001]),row([2000.5])],merged={...parts[0],...plus(parts),items:parts};
 for(const key of Object.keys(merged).filter(k=>k.startsWith('fee_')))delete merged[key];
 const result=providerRows([merged,row([1000,8000],{platformId:'q',platform:'Second',source:'newar'})])[0];
 close(result.estimated_fee,106.02+36+160);assert.equal(result.fee_matched_count,4);assert.equal(result.success_count,5);assert.equal(result.fee_complete,false);
 const malformed={...merged,success_count:99};assert.equal(api.estimate(malformed,[],'印度'),null);
});
test('confirmed tier applies only to India INR payout and retains other fee rules',()=>{
 for(const change of [{direction:'charge'},{currency:'USD'},{provider:'OtherPay'},{country:'菲律宾'}]){
  const r=row([2000],change);assert.equal(api.tieredFeeRule(r,r.country),null);assert.equal(api.estimate(r,[],r.country),null);
 }
 const charged=row([2000],{direction:'charge'});close(api.estimate(charged,[{provider:'Speed2Pay',country:'印度',scopeType:'country',collectFee:'4%'}],'印度'),80);
});
