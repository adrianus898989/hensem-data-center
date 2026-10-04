/* Synthetic display facts only; no network or business records. */
const test=require('node:test'),assert=require('node:assert/strict');
require('../admin-preview/live-reference-layout.js');
const api=globalThis.HensemLiveLayout;
const summary={all_amount:1000,all_count:10,success_amount:400,success_count:4};
const feeCard=html=>html.split('data-metric="fee"')[1];
const current={label:'当前费率参考估算',mode:'current',amount:16,matchedCount:4,eligibleCount:4,excludedCount:0,complete:true};

test('merchant fee cards show the supplied estimate and coverage without claiming historical fees or a false comparison',()=>{
 const html=feeCard(api.totals({directions:[{key:'charge',summary,fee:current}]}));
 assert.match(html,/当前费率参考估算/);assert.match(html,/>16\.00</);assert.match(html,/已匹配 4 \/ 4 笔/);assert.match(html,/非历史实际手续费/);assert.doesNotMatch(html,/历史生效费率尚未接入|较昨日|对比 —| · 部分/);
 const partial=feeCard(api.renderMetrics(summary,{fee:{...current,amount:8,matchedCount:2,complete:false}}));
 assert.match(partial,/>8\.00</);assert.match(partial,/已匹配 2 \/ 4 笔 · 部分/);assert.match(partial,/未匹配部分不计为零手续费/);
});

test('unavailable fee values, loading and failures never show a zero price or a full matching percentage',()=>{
 for(const [fee,note]of [[{...current,amount:null,eligibleCount:null,matchedCount:null,complete:false},'匹配范围待确认'],[{...current,amount:16,status:'loading'},'费率读取中'],[{...current,amount:16,status:'error',note:'Read <failed>'},'费率读取失败']]){
  const html=feeCard(api.renderMetrics(summary,{fee}));assert.match(html,/>—</);assert(html.includes(note));assert.doesNotMatch(html,/>0\.00<|>16\.00<|100\.00%|<failed>/);
 }
});

test('historical mode uses its explicit amount and basis and other page fee cards retain the old contract',()=>{
 const html=feeCard(api.renderMetrics(summary,{fee:{...current,label:'历史生效手续费',mode:'historical',amount:null,matchedCount:0,complete:false}}));
 assert.match(html,/历史生效手续费/);assert.match(html,/按订单创建时间匹配生效版本/);assert.match(html,/>—</);assert.doesNotMatch(html,/按当前参考费率估算/);
 const untouched=feeCard(api.renderMetrics(summary));assert.match(untouched,/估算手续费/);assert.match(untouched,/历史生效费率尚未接入/);assert.match(untouched,/对比 —/);
});
