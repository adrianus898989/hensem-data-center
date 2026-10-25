/* Synthetic returned query metadata; no browser, network or live data. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-reference-layout.js'),'utf8'),root);const api=root.HensemLiveLayout;
const current={all_count:10,all_amount:1000,success_count:5,success_amount:500};
test('returned creation basis overrides unsubmitted success-date edits without changing the ratio',()=>{
 const queryState={results:[{successBasis:'created'}],successFrom:'2026-10-01T00:00:00',successTo:'2026-10-02T23:59:59',successBasis:'source_updated',dirty:true},before=JSON.stringify(queryState),d=api.successBasisDescription(queryState),html=api.renderMetrics(current,{queryState});
 assert.equal(d.created,true);assert.match(d.title,/创建区间订单当前成功笔数/);assert.doesNotMatch(d.title,/跨日|更新时间/);assert.match(html,/data-metric="success_rate" title="创建区间订单当前成功笔数/);assert.match(html,/50.00%/);assert.equal(JSON.stringify(queryState),before);
});
test('explicit returned success and source-update windows retain their separate date descriptions',()=>{
 for(const [successBasis,label]of [['success','成功时间'],['source_updated','源订单更新时间']]){
  const queryState={results:[{successBasis,successStartAt:'2026-10-01T00:00:00Z',successEndAt:'2026-10-02T00:00:00Z'}],successFrom:'',successTo:'',dirty:true},d=api.successBasisDescription(queryState),html=api.renderMetrics({...current,success_count:12},{queryState});
  assert.equal(d.created,false);assert(d.title.includes('独立'+label+'区间'));assert.match(d.title,/可超过100%/);assert.match(html,/120.00%/);if(successBasis==='source_updated')assert.match(d.title,/不代表实际到账时间/);
 }
});
test('missing, conflicting and mixed returned metadata never borrow the current draft date basis',()=>{
 for(const results of [[],[{}],[{successBasis:'created'},{}],[{successBasis:'created'},{successBasis:'success'}],[{successBasis:'created',_parts:[{successBasis:'success'},{}]}]]){
  const d=api.successBasisDescription({results,successFrom:'',successTo:''});assert.equal(d.created,null);assert.match(d.title,/日期依据以已返回统计口径为准/);assert.doesNotMatch(d.title,/可超过100%|创建区间订单当前/);
 }
 assert.equal(api.successBasisDescription({results:[{successBasis:'created',_parts:[{},{}]}]}).created,true);
});
const prefix=fs.readFileSync(path.join(__dirname,'admin-comparison-consumers.test.cjs'),'utf8').split(/\nfor\(const page/)[0];
const {setup,settle}=new Function('require','__dirname',prefix+';return {setup,settle};')(require,__dirname);
for(const page of ['overview','collection','payout','merchants','teamops','teamcountries','teamplatforms','provider_daily'])test(page+' uses the returned creation or explicit success basis in existing rendered explanations',async()=>{
 const h=await setup(page);await h.c.liveQuery();await settle();const count=h.calls.length,values=JSON.stringify(h.L.results),html=h.html();
 assert.match(html,/创建区间订单当前成功笔数|按创建日期选取已入库订单/);assert.doesNotMatch(html,/成功时间内成功笔数 ÷ 创建时间内全部笔数|成功金额、笔数按成功时间|笔；含跨日成功/);assert.equal(h.calls.length,count);assert.equal(JSON.stringify(h.L.results),values);
 h.L.successFrom='2026-09-22T00:00:00';h.L.successTo='2026-09-22T23:59:59';await h.c.liveQuery();await settle();assert.match(h.html(),/独立成功时间区间成功笔数|成功时间 · 2026/);assert.match(h.html(),/跨日成功|成功时间 · 2026/);
});

test('source completion-time metadata keeps its own clock description',()=>{const d=api.successBasisDescription({results:[{successBasis:'success',capabilities:{successTimeBasis:'source_completed_at'}}]});assert.equal(d.metricLabel,'源订单完成时间');assert.match(d.title,/独立源订单完成时间区间/);});

test('mixed applied update clocks retain exact source-specific labels regardless of draft selection',()=>{
 for(const [source,expected,forbidden]of [['NEW_AR','新中台按源订单更新时间','多利按更新时间'],['duoli','多利按更新时间','新中台按源订单更新时间']]){
  const queryState={results:[{successBasis:'source_updated',platform:{source}},{successBasis:'success',platform:{source:'ar'}}],successBasis:'success',successFrom:'',successTo:'',dirty:true},d=api.successBasisDescription(queryState);assert(d.metricLabel.includes(expected));assert(!d.metricLabel.includes(forbidden));assert(d.title.includes(expected));assert.match(d.title,/不代表实际到账时间/);
 }
});
