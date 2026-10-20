/* Real renderers, synthetic query states only. No live requests or timing claims. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P,settle}=new Function('require','__dirname',prefix+';return {ready,completeAggregate,P,settle};')(require,__dirname);
const Q={...P,id:'22222222-2222-4222-8222-222222222222',name:'Unread <native>'};
const pages=['provider_daily','time','amount','matrix','latency','collection','payout','merchants','teamops','teamcountries','teamplatforms','risk','overview','providers','provider_payout'];
async function state(page,extra={}){
 const h=await ready({platforms:[P,Q],extraModules:['live-statistic-windows.js','live-prepared-aggregates.js']});
 h.c.setPage(page);Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',successFrom:'',successTo:'',pageQueried:true,overviewQueried:true,dirty:false,loading:false,queryRetrying:false,queryPaused:false,retainedContent:null,queryPlatforms:[P,Q],results:[],queryFailures:[{id:P.id,name:P.name,status:'missing',message:'该筛选的统计尚未准备'},{id:Q.id,name:Q.name,status:'stale',message:'该筛选的统计已过期'}],queryWarnings:['Synthetic platform：该筛选的统计尚未准备','Unread <native>：该筛选的统计已过期'],loadedView:'full',feeLookupRows:[],feeLookupLoading:false,feeLookupError:'',...extra});return h;
}
test('every shared statistics page keeps failed zero-return queries distinct from confirmed empty data',async()=>{
 for(const page of pages){
  const h=await state(page);h.c.render();const html=h.html();
  assert.match(html,/aggregate-query-unavailable/,page);
  assert.match(html,/已读 0 \/ 2 平台/,page);
  assert.match(html,/未完成数据不按 0 计算/,page);
  assert.doesNotMatch(html,/kpi-value|当前筛选范围没有已入库记录|>0\.00</,page);
  assert.match(html,/<details><summary>查看未完成平台（2）<\/summary>/,page);
  assert.match(html,/Unread &lt;native&gt;/,page);
 }
});
test('partly returned provider daily is a subtotal, and missing direction metrics stay unknown',async()=>{
 const h=await state('provider_daily',{results:[completeAggregate(P,10,4)],queryFailures:[{id:Q.id,name:Q.name,status:'stale',message:'该筛选的统计已过期'}],queryWarnings:['Unread <native>：该筛选的统计已过期']});
 h.c.render();const html=h.html();assert.match(html,/已读 1 \/ 2 平台/);assert.match(html,/live-subtotal-label">已读小计/);
 assert.doesNotMatch(html,/部分平台读取失败，以下仅为已读取结果：/);
 h.L.direction='withdraw';h.c.render();const payout=h.html();
 assert.match(payout,/当前已读平台暂无记录，其他平台尚未读取完成/);
 assert.match(payout,/<div class="kpi-value">—<\/div>/);assert.doesNotMatch(payout,/<div class="kpi-value">0\.00<\/div>/);
});
test('complete empty results continue showing a true zero and current empty-state message',async()=>{
 const result=completeAggregate(P,0,0);result.summary=[];for(const k of Object.keys(result.groups))result.groups[k]=[];
 const h=await state('provider_daily',{queryPlatforms:[P],results:[result],queryFailures:[],queryWarnings:[]});h.c.render();
 assert.doesNotMatch(h.html(),/aggregate-query-unavailable|data-aggregate-read-status|已读小计/);
 assert.match(h.html(),/<div class="kpi-value">0\.00<\/div>/);assert.match(h.html(),/当前筛选范围没有已入库记录/);
});
test('availability rendering never starts aggregate retries and failed details are escaped',async()=>{
 const h=await state('provider_daily');const before=h.calls.filter(q=>q.action==='aggregatePrepared'||q.action==='aggregate').length;
 for(let i=0;i<5;i++)h.c.render();await settle();
 assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared'||q.action==='aggregate').length,before);
 assert.doesNotMatch(h.html(),/<native>/);assert.match(h.html(),/onclick="liveRetryFailed\(false\)"/);
});
