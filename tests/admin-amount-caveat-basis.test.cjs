/* Actual overview rendering with synthetic aggregate facts only. No network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harnessSource=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P}=new Function('require','__dirname',harnessSource+';return {ready,completeAggregate,P};')(require,__dirname);
const keys=['all','success','pending','failed','rejected','unknown'];
async function overview(summaries,{successBasis='created'}={}){
 const platforms=summaries.map((_,i)=>({...P,id:String(i+1).repeat(8)+'-1111-4111-8111-111111111111',name:'Synthetic '+i})),h=await ready({platforms});
 h.L.results=platforms.map((p,i)=>{const r=completeAggregate(p,1500,20);r.successBasis=successBasis;r.summary=[{...r.summary[0],...summaries[i]}];r.groups.provider=[{...r.summary[0],provider:'SyntheticPay'}];return r});
 Object.assign(h.L,{country:'印度',currency:'INR',direction:'charge',queryPlatforms:platforms,dirty:false,loading:false,catalogReady:true,pageQueried:true,overviewQueried:true,feeLookupRows:[],feeLookupLoading:false,comparisonStatus:'idle'});
 const original=JSON.stringify(h.L.results);h.c.render();assert.equal(JSON.stringify(h.L.results),original,'display caveats never rewrite source financial facts');return h;
}
function card(h,label){const found=h.html().match(new RegExp('<div class="df-flow-metric"><span>'+label+'金额 / 笔数[^<]*</span>[\\s\\S]*?</div>'));assert(found,label+' amount card exists');return found[0]}
function tail(h,label){const found=h.html().match(new RegExp('<span>'+label+'金额[^<]* <b>[^<]*</b>[\\s\\S]*?</span>'));assert(found,label+' amount tail exists');return found[0]}
const unknownFields=Object.fromEntries(keys.flatMap(k=>[[k+'_amount',null],[k+'_count',5]]));

test('creation missing count is never relabelled as the successful cohort missing count',async()=>{
 const h=await overview([{all_amount:null,success_amount:null,success_count:2,missing_amount_count:1195}],{successBasis:'success'});
 assert.match(card(h,'全部'),/>—</);assert.match(card(h,'全部'),/创建订单 1,195 笔缺少金额/);
 assert.match(card(h,'成功'),/>—</);assert.match(card(h,'成功'),/2 笔/);assert.match(card(h,'成功'),/按成功时间/);assert.match(card(h,'成功'),/该指标金额未确认/);
 assert.doesNotMatch(card(h,'成功'),/1,195|1195|笔缺少金额/);
});

test('known successful money is retained even when creation money and its 1195 records are missing',async()=>{
 const h=await overview([{all_amount:null,success_amount:'3700.25',success_count:4,missing_amount_count:1195}]);
 assert.match(card(h,'全部'),/创建订单 1,195 笔缺少金额/);assert.match(card(h,'成功'),/>3,700\.25</);
 assert.doesNotMatch(card(h,'成功'),/cell-warning|未确认|缺少金额/);
});

test('success and each status get an unknown amount caveat without borrowing a creation count',async()=>{
 const h=await overview([{...unknownFields,all_amount:'100.25',missing_amount_count:1195}]);
 assert.match(card(h,'全部'),/>100\.25</);assert.doesNotMatch(card(h,'全部'),/cell-warning|缺少金额/);
 for(const html of [card(h,'成功'),card(h,'处理中'),card(h,'失败'),tail(h,'驳回'),tail(h,'未知状态')]){
  assert.match(html,/>—</);assert.match(html,/该指标金额未确认/);assert.doesNotMatch(html,/1,195|1195|笔缺少金额/);
 }
});

test('numeric and string zero amounts are legitimate known values, including zero-count groups',async()=>{
 for(const zero of [0,'0.00']){
  const h=await overview([{...Object.fromEntries(keys.flatMap(k=>[[k+'_amount',zero],[k+'_count',0]])),missing_amount_count:1195}]);
  for(const html of [card(h,'全部'),card(h,'成功'),card(h,'处理中'),card(h,'失败'),tail(h,'驳回'),tail(h,'未知状态')]){
   assert.match(html,/>0\.00</);assert.doesNotMatch(html,/cell-warning|未确认|缺少金额/);
  }
 }
});

test('null remains unknown even when the corresponding count is zero or unknown',async()=>{
 for(const count of [0,null]){
  const h=await overview([{...Object.fromEntries(keys.flatMap(k=>[[k+'_amount',null],[k+'_count',count]])),missing_amount_count:null}]);
  for(const html of [card(h,'全部'),card(h,'成功'),card(h,'处理中'),card(h,'失败'),tail(h,'驳回'),tail(h,'未知状态')]){
   assert.match(html,/>—</);assert.match(html,/该指标金额未确认/);assert.doesNotMatch(html,/>0\.00<|笔缺少金额/);
  }
 }
});

test('one unknown leaf keeps a same-currency total unknown without copying its missing count to other metrics',async()=>{
 const h=await overview([{all_amount:'750.00',success_amount:'3700.00',missing_amount_count:0},{all_amount:null,success_amount:null,missing_amount_count:7}]);
 assert.match(card(h,'全部'),/>—</);assert.match(card(h,'全部'),/创建订单 7 笔缺少金额/);
 assert.match(card(h,'成功'),/>—</);assert.match(card(h,'成功'),/该指标金额未确认/);assert.doesNotMatch(card(h,'成功'),/笔缺少金额/);
 assert.equal(h.L.results[0].summary[0].success_amount,'3700.00');assert.equal(h.L.results[1].summary[0].success_amount,null);
});

test('mixed currencies remain unadded with a currency caveat rather than any missing-order count',async()=>{
 const h=await overview([{currency:'INR',all_amount:'100.00',success_amount:'80.00',missing_amount_count:1195},{currency:'BRL',all_amount:'20.00',success_amount:'10.00',missing_amount_count:0}]);
 for(const html of [card(h,'全部'),card(h,'成功'),card(h,'处理中'),card(h,'失败'),tail(h,'驳回'),tail(h,'未知状态')]){
  assert.match(html,/>—</);assert.match(html,/多币种 · 请按币种查看/);assert.doesNotMatch(html,/1,195|1195|笔缺少金额/);
 }
 assert.equal(h.L.results[0].summary[0].currency,'INR');assert.equal(h.L.results[1].summary[0].currency,'BRL');
});

test('creation-cohort amount caveat retains its explicit returned basis and original missing-count separation',async()=>{const h=await overview([{all_amount:null,success_amount:null,success_count:2,missing_amount_count:1195}]);assert.match(card(h,'成功'),/按创建时间（当前成功状态）/);assert.match(card(h,'成功'),/2 笔|该指标金额未确认/);assert.doesNotMatch(card(h,'成功'),/1,195|1195|笔缺少金额|按成功时间/);});
