/* Synthetic DTO and renderer checks; no requests or production records. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order}=new Function('require','__dirname',shared+';return {fixture,order};')(require,__dirname);
const dto=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/workorder-diagnostics/ui-v5-synthetic.json'),'utf8'));
function fact(kind,platform='SYNTHETIC PLATFORM',provider='SYNTHETIC PAY'){
 const coverage=structuredClone(dto[kind]);coverage.sourceCoverage={complete:true,platforms:[]};
 for(const day of coverage.diagnosticDays){day.platform=platform;day.sourcePlatform=platform;day.provider=provider;}
 return {platform,sourcePlatform:platform,platformId:platform,source:kind==='excludedType'?'newar':'ar',country:'印度',provider,direction:'charge',
  submittedCount:coverage.diagnosticDays[0]?.expectedCount??1,submittedAmount:coverage.diagnosticDays[0]?.rawAmountComparison.expectedAmount??100,
  uniqueOrderCount:1,uniqueOrderAmount:100,uniqueSuccessCount:0,uniqueSuccessAmount:0,uniqueNotReceivedCount:1,uniqueNotReceivedAmount:100,uniqueCoverage:coverage};
}
function setup(facts){
 const h=fixture(facts.map((r,i)=>order(r.platformId,r.source,100,1,{direction:'charge',provider:r.provider,platform:r.platform})));
 h.L.from='2026-09-29T00:00:00';h.L.to='2026-09-29T23:59:59';
 h.L.queryPlatforms=[...new Map(facts.map(r=>[r.platformId,{id:r.platformId,name:r.platform,country:r.country,source:r.source}])).values()];
 h.L.results=h.L.queryPlatforms.map(platform=>({platform,groups:{provider:[]}}));
 h.L.workorders={coverage:{complete:true,platforms:[],capturedPlatformDays:h.L.queryPlatforms.length,expectedPlatformDays:h.L.queryPlatforms.length},byProvider:facts,byPlatformProvider:facts};h.render('charge');return h;
}
const diagnostic=h=>{h.root.providerSummaryWorkorderPlatforms();return h.drawers.at(-1).html;};
test('v5 explained pending scope shows exact raw money without labelling it an unresolved or deduplicated amount',()=>{
 const r=fact('pending'),h=setup([r]),before=JSON.stringify(h.L.workorders),html=diagnostic(h);
 assert.match(html,/1 个仅有已知范围差异，0 个含待确认项/);assert.match(h.html(),/待确认 0 \/ 原因已说明 1/);assert.doesNotMatch(h.html(),/原单待核对 1 三方/);
 assert.match(html,/日报 450\.00 INR/);assert.match(html,/明细 200\.00 INR/);assert.match(html,/净差 \+250\.00 INR/);
 assert.match(html,/范围净差 250\.00 INR/);assert.match(html,/金额尚待逐笔核对/);
 assert.match(html,/不是去重原支付订单金额/);assert.match(h.html(),/>100\.00</);assert.equal(r.uniqueCoverage.complete,false);
 assert.equal(JSON.stringify(h.L.workorders),before);assert.equal(h.networkCalls(),0);
});
test('excluded USDT raw money retains its unknown currency and remains outside fiat totals',()=>{
 const r=fact('excludedType','SYNTHETIC USDT PLATFORM','SYNTHETIC USDT'),h=setup([r]),html=diagnostic(h);
 assert.match(html,/1 个仅有已知范围差异，0 个含待确认项/);assert.match(html,/日报 987\.00 （币种未提供）/);
 assert.match(html,/净差 \+987\.00 （币种未提供）/);assert.match(html,/已采集 USDT 类型记录金额 987\.00 （币种未提供）/);
 assert.match(html,/以上数值仅作本项来源记录对比，不计入当前页面币种合计/);assert.doesNotMatch(html,/987\.00 INR|987\.00 USDT/);
 assert.equal(h.networkCalls(),0);
});
test('equal counts with an unexplained monetary difference still require review',()=>{
 const r=fact('actualConflict','SYNTHETIC CONFLICT'),d=r.uniqueCoverage.diagnosticDays[0];
 r.uniqueCoverage.complete=true;r.uniqueCoverage.status='complete';r.uniqueCoverage.needsReview=true;r.uniqueCoverage.diagnosisStatus='review_required';
 r.uniqueCoverage.providerConflictCount=0;d.providerConflictCount=0;d.rawAmountComparison={...d.rawAmountComparison,expectedAmount:250,detailAmount:200,differenceAmount:50,unexplainedDifferenceAmount:50};
 const h=setup([r]),html=diagnostic(h);assert.match(html,/0 个仅有已知范围差异，1 个含待确认项/);assert.match(html,/0 · 数量一致/);
 assert.match(html,/待确认：未解释金额净差 \+50\.00 INR/);assert.match(html,/即使条数相同也要核对原始金额/);assert.match(h.html(),/原单待核对 1 三方/);
 h.root.providerSummaryCoverage();assert.match(h.drawers.at(-1).html,/未解释金额净差 \+50\.00 INR/);assert.equal(h.networkCalls(),0);
});
test('real provider conflict remains review-required even when raw amount and count agree',()=>{
 const h=setup([fact('actualConflict')]),html=diagnostic(h);assert.match(html,/1 个含待确认项/);assert.match(html,/1组三方冲突/);assert.match(html,/净差 0\.00 INR/);
 assert.match(h.html(),/原单待核对 1 三方/);assert.equal(h.networkCalls(),0);
});
test('v4 remains compatible and does not borrow v5 monetary fields or invent its currency',()=>{
 const r=fact('pending');r.uniqueCoverage.diagnosticVersion=4;delete r.uniqueCoverage.diagnosisStatus;delete r.uniqueCoverage.needsReview;
 const h=setup([r]),html=diagnostic(h);assert.match(html,/未接入金额诊断/);assert.match(html,/接口尚未提供原始工单金额差异/);
 assert.doesNotMatch(html,/450\.00 INR|250\.00 INR/);assert.match(h.html(),/原单待核对 1 三方/);assert.equal(h.networkCalls(),0);
});
test('missing report, nonfinite values and inconsistent amount DTOs remain unknown',()=>{
 const h=setup([fact('actualConflict')]);
 for(const bad of [null,'NaN','Infinity','-Infinity',[],{},true,'']){
  const r=fact('actualConflict'),d=r.uniqueCoverage.diagnosticDays[0];d.rawAmountComparison.expectedAmount=bad;
  const parsed=h.api.rawWorkorderAmountComparison(d,r.uniqueCoverage);assert.equal(parsed.expectedAmount,null);assert.equal(parsed.differenceAmount,null);assert.equal(parsed.unexplainedDifferenceAmount,null);
 }
 const r=fact('actualConflict'),d=r.uniqueCoverage.diagnosticDays[0];d.expectedAvailable=false;
 const missing=h.api.rawWorkorderAmountComparison(d,r.uniqueCoverage);assert.equal(missing.expectedAmount,null);assert.equal(missing.detailAmount,200);assert.equal(missing.differenceAmount,null);
 d.expectedAvailable=true;d.rawAmountComparison.differenceAmount=123;assert.equal(h.api.rawWorkorderAmountComparison(d,r.uniqueCoverage).differenceAmount,null);
 h.L.workorders.byProvider=[r];h.L.workorders.byPlatformProvider=[r];h.render('charge');const html=diagnostic(h);assert.match(html,/净差 无法比较/);assert.match(html,/金额证据未齐/);assert.equal(h.networkCalls(),0);
});
test('raw diagnostic currency and source text are escaped without using page currency as fallback',()=>{
 const r=fact('pending','<UnsafePlatform>','<UnsafeProvider>'),d=r.uniqueCoverage.diagnosticDays[0];d.rawAmountComparison.currency='<img src=x onerror=1>';
 const h=setup([r]),html=diagnostic(h);assert.match(html,/&lt;UnsafePlatform&gt;/);assert.match(html,/&lt;UnsafeProvider&gt;/);assert.match(html,/250\.00 （币种未提供）/);
 assert.doesNotMatch(html,/<UnsafePlatform>|<UnsafeProvider>|<img|onerror|250\.00 INR/);assert.equal(h.networkCalls(),0);
});
test('strict attributed source label is informational and adds no second original-money fact',()=>{
 const attributed=fact('attributedElsewhere','SYNTHETIC ATTRIBUTED','未标记三方');
 Object.assign(attributed,{uniqueOrderCount:999,uniqueOrderAmount:999999,uniqueNotReceivedCount:999,uniqueNotReceivedAmount:999999});
 const known=fact('pending','SYNTHETIC ATTRIBUTED','SYNTHETIC KNOWN');Object.assign(known.uniqueCoverage,{status:'complete',complete:true,diagnosisStatus:'complete',needsReview:false,diagnosticDays:[],pendingExcludedDetailCount:0});
 const h=setup([attributed,known]),before=JSON.stringify(h.L.workorders);assert.match(h.html(),/已归并来源标签/);assert.match(h.html(),/此标签不重复增加原单笔数和金额/);
 assert.doesNotMatch(h.html(),/>999,999\.00</);assert.doesNotMatch(h.html(),/原单待核对|日报\/明细差异/);assert.equal(h.api.workorderPlatformGaps(h.L,'charge').length,0);
 const built=h.api.buildRows({orders:[order(attributed.platformId,'ar',100,1,{direction:'charge',provider:'未标记三方',platform:attributed.platform})],issues:[attributed],rates:[],country:'印度',direction:'charge',plus:rows=>Object.fromEntries(['all_amount','all_count','success_amount','success_count'].map(k=>[k,rows.reduce((n,r)=>n+Number(r[k]||0),0)])),combine:(rows)=>rows.map(r=>({...r,items:[r]})),coverage:{complete:true}});
 assert.equal(built[0].uniqueOrders.uniqueOrderCount,null);assert.equal(built[0].uniqueOrders.uniqueOrderAmount,null);
 assert.equal(JSON.stringify(h.L.workorders),before);assert.equal(h.networkCalls(),0);
});
test('explicit flags cannot hide source gaps or conflicts in malformed v5 diagnosis',()=>{
 const r=fact('actualConflict');r.uniqueCoverage.needsReview=false;r.uniqueCoverage.diagnosisStatus='explained_range_difference';
 const h=setup([r]);assert.equal(h.api.workorderPlatformNeedsReview(h.api.workorderPlatformGaps(h.L,'charge')[0]),true);
 const missing=fact('pending');missing.uniqueCoverage.sourceCoverage.complete=false;const other=setup([missing]);assert.match(diagnostic(other),/1 个含待确认项/);assert.equal(other.networkCalls(),0);
 const money=fact('pending');money.uniqueCoverage.diagnosticDays[0].rawAmountComparison.unexplainedDifferenceAmount=250;
 const financial=setup([money]);assert.match(diagnostic(financial),/1 个含待确认项/);assert.match(financial.html(),/原单待核对 1 三方/);
});
test('negative unexplained raw gap remains signed and is not called omitted pending',()=>{
 const r=fact('actualConflict'),d=r.uniqueCoverage.diagnosticDays[0];d.rawAmountComparison={...d.rawAmountComparison,expectedAmount:100,detailAmount:200,differenceAmount:-100,unexplainedDifferenceAmount:-100};
 const h=setup([r]),html=diagnostic(h);assert.match(html,/净差 -100\.00 INR/);assert.match(html,/未解释金额净差 -100\.00 INR/);assert.doesNotMatch(html,/范围净差/);assert.equal(h.networkCalls(),0);
});
