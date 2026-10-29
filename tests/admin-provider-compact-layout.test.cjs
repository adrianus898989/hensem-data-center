const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-comparison-consumers.test.cjs'),'utf8').split(/\nfor\(const page/)[0];
const {setup,settle,response,ancillary}=new Function('require','__dirname',prefix+';return {setup,settle,response,ancillary};')(require,__dirname);
const fixturePrefix=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order}=new Function('require','__dirname',fixturePrefix+';return {fixture,order};')(require,__dirname);
async function ready(page='providers'){const h=await setup(page);h.setHandler(q=>{if(q.action!=='aggregatePrepared')return ancillary(q);const out=response(q);for(const item of out.items){const direction=item.request.direction==='withdraw'?'withdraw':'charge';for(const row of item.result.summary)row.direction=direction;for(const rows of Object.values(item.result.groups))for(const row of rows)row.direction=direction;}return out;});await h.c.liveQuery();await settle();return h;}

const collapsed=html=>html.match(/<details class="live-scope-description provider-scope-details">[\s\S]*?<\/details>/)?.[0];
test('provider directory and timestamps collapse beside Query while other shared pages keep their existing scope',async()=>{
 for(const page of ['providers','provider_payout']){const h=await ready(page),before=h.calls.length,scope=h.nodes.get('liveFilters').innerHTML,details=collapsed(scope);assert(details);assert.match(details,/<summary>数据说明<\/summary>/);assert.doesNotMatch(details,/\bopen(?:[ =>])/);assert.match(details,/所选日期有订单数据/);assert.match(scope,/<div class="live-actions live-query-actions">[\s\S]*<div class="live-scope provider-filter-scope">/);assert.equal((scope.match(/class="live-scope(?: |")/g)||[]).length,1);assert.doesNotMatch(scope.replace(details,''),/所选日期有订单数据|可选目录|数据读取/);h.c.render();assert.equal(h.calls.length,before);}
 const h=await ready('time'),scope=h.nodes.get('liveFilters').innerHTML;assert.match(scope,/<details class="live-scope-description"><summary>数据范围/);assert.doesNotMatch(scope,/provider-filter-scope/);assert.match(scope,/所选日期有订单数据/);
});
test('collapsed details never conceal failed refresh, missing directory or missing provider read',async()=>{
 const h=await ready();h.L.results[0]._preparedPublication={computedAt:'2026-09-23T11:00:00Z',freshness:'refresh_due',refreshState:'failed'};h.c.render();let scope=h.nodes.get('liveFilters').innerHTML;assert.match(scope.replace(collapsed(scope),''),/role="status">更新未完成/);assert.match(collapsed(scope),/更新于/);
 h.L.providerOptionsError='synthetic unavailable';h.c.render();scope=h.nodes.get('liveFilters').innerHTML;assert.match(scope.replace(collapsed(scope),''),/role="status">三方目录未读取/);
 h.L.catalogReady=false;h.L.catalogLoading=false;h.c.render();scope=h.nodes.get('liveFilters').innerHTML;assert.match(scope.replace(collapsed(scope),''),/role="status">目录未读取/);
});
test('fee and status controls share table panel; changing fee or opening platform retains local data without reads',()=>{
 const h=fixture([order('platform-a','ar',900,3)]),before=h.networkCalls(),facts=JSON.stringify(h.L.results);assert.doesNotMatch(h.html(),/provider-summary-heading|provider-scope-note/);assert.match(h.html(),/<div class="provider-report-panel"><section><h2>[\s\S]*<div class="provider-status-actions provider-toolbar">/);h.root.providerSummaryToggle(0);h.root.providerSummaryFeeMode('current');assert.equal(h.L.feeEstimateMode,'current');assert.match(h.html(),/aria-expanded="true"/);assert.equal(JSON.stringify(h.L.results),facts);assert.equal(h.networkCalls(),before);
});
test('creation-basis help and platform details do not claim success-date totals',async()=>{
 const h=await ready(),before=h.calls.length,facts=JSON.stringify(h.L.results);h.c.providerSummaryBasis();assert.match(h.drawers.at(-1).html,/按创建日期选取已入库订单/);assert.doesNotMatch(h.drawers.at(-1).html,/按来源提供的成功统计时间|含跨日成功/);h.c.providerSummaryToggle(0);assert.match(h.html(),/按创建日期选取已入库订单/);assert.doesNotMatch(h.html(),/成功金额、成功笔数按成功时间|含跨日成功/);assert.equal(h.calls.length,before);assert.equal(JSON.stringify(h.L.results),facts);
});
test('legacy source explanation and incomplete unknown values remain explicit',()=>{
 const h=fixture([order('platform-a','ar',null,3)]);h.L.queryPlatforms=[{id:'platform-a'},{id:'missing'}];h.L.queryFailures=[{id:'missing',message:'timeout'}];h.render();assert.match(h.html(),/订单 1 \/ 2/);assert.match(h.html(),/未返回平台不计入/);h.root.providerSummaryBasis();assert.match(h.drawers.at(-1).html,/成功率 = 成功笔数 ÷ 创建笔数/);assert.match(h.drawers.at(-1).html,/按来源提供的成功统计时间/);assert.match(h.html(),/<strong>—<\/strong>/);
});

