/* Synthetic per-cohort workorder diagnostics, with no request or member identity. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,order}=new Function('require','__dirname',shared+';return {fixture,order};')(require,__dirname);
function setup(){
 const h=fixture([order('a','newar',100,1,{provider:'TukPay',platform:'DHANIWIN'}),order('b','ar',200,2,{provider:'ArbPay',platform:'51GAME'})]);
 const fact=(provider,complete)=>({provider,direction:'withdraw',submittedCount:10,uniqueOrderCount:complete?10:3,uniqueOrderAmount:1000,uniqueSuccessCount:2,uniqueSuccessAmount:200,uniqueNotReceivedCount:1,uniqueNotReceivedAmount:100,uniqueCoverage:{diagnosticVersion:1,status:complete?'complete':'partial',complete,sourceCoverage:{complete:true,platforms:[]},diagnosticDays:[],missingOrderNumberCount:complete?0:7}});
 const tuk=fact('TukPay',false),arb=fact('ArbPay',true);h.L.workorders={coverage:{complete:false,capturedPlatformDays:1,expectedPlatformDays:2,platforms:[{platform:'51GAME',source:'ar',complete:false,days:0,expectedDays:1,missingDates:['2026-09-25']}]},byProvider:[tuk,arb],byPlatformProvider:[{...tuk,platform:'DHANIWIN',platformId:'a',source:'newar',country:'印度'}]};h.render();return {h,tuk,arb};
}
test('a global missing source does not add missing-date reasons to an unrelated complete cohort',()=>{
 const {h}=setup();const row=h.html().match(/<tr>(<td>[\s\S]*?ArbPay[\s\S]*?)<\/tr>/)?.[1];assert(row);assert.doesNotMatch(row,/所选平台的工单日期未收齐|该统计范围的工单日期未收齐/);
 h.root.providerSummaryCoverage();const html=h.drawers.at(-1).html;assert.match(html,/51GAME/);assert.match(html,/2026-09-25/);assert.doesNotMatch(html,/<td>ArbPay<\/td>/,'complete provider is not included among problem cohorts');assert.equal(h.networkCalls(),0);
});
test('named cohort source gaps retain their own dates instead of using global unrelated platforms',()=>{
 const {h,tuk}=setup();tuk.uniqueCoverage.sourceCoverage={complete:false,platforms:[{platform:'DHANIWIN',source:'newar',complete:false,missingDates:['2026-09-24']}]};h.render();h.root.providerSummaryCoverage();const html=h.drawers.at(-1).html;
 assert.match(html,/该统计范围的工单日期未收齐：DHANIWIN（2026-09-24）/);assert.doesNotMatch(html,/该统计范围的工单日期未收齐：51GAME/);assert.equal(h.networkCalls(),0);
});
test('daily diagnostics explain source fields and counts without inventing order IDs or losing known values',()=>{
 const {h,tuk}=setup();const diagnostic={platform:'DHANIWIN',sourcePlatform:'DHANIWIN',source:'newar',countryCode:'IN',provider:'TukPay',direction:'withdraw',date:'2026-09-25',expectedCount:10,detailCount:8,missingDetailCount:2,missingOrderNumberCount:5,newarExplicitReferenceMissingCount:4,unsupportedReferenceTypeCount:1,sourceOrderOnlyCount:3};
 tuk.uniqueCoverage.diagnosticDays=[diagnostic];h.L.workorders.byPlatformProvider[0].uniqueCoverage.diagnosticDays=[diagnostic];h.render();h.root.providerSummaryCoverage();const html=h.drawers.at(-1).html;
 assert.match(html,/问题日期与采集字段/);assert.match(html,/<td>DHANIWIN<\/td><td>newar<\/td><td>2026-09-25<\/td><td>TukPay<\/td><td>10<\/td><td>8<\/td>/);assert.equal((html.match(/4条 NEWAR 原订单引用字段缺失/g)||[]).length,1,'provider and platform copies of a diagnostic are deduplicated');
 assert.match(html,/1条原订单引用字段类型不支持/);assert.match(html,/不代表会员未提交工单或没有原订单/);assert.match(h.html(),/>1,000.00</);assert.equal(h.networkCalls(),0);
});
test('diagnostic notes escape source text, reject opposite flow, and keep absent counts unknown',()=>{
 const {h,tuk}=setup();tuk.uniqueCoverage.diagnosticDays=[{platform:'<Platform>',source:'<Source>',provider:'TukPay',date:'2026-09-25',direction:'withdraw',missingDetailCount:1},{platform:'Opposite',source:'ar',direction:'charge',date:'2026-09-25',missingDetailCount:20}];h.render();h.root.providerSummaryCoverage();const html=h.drawers.at(-1).html;
 assert.match(html,/&lt;Platform&gt;/);assert.match(html,/&lt;Source&gt;/);assert.doesNotMatch(html,/<Platform>|<Source>|Opposite/);assert.match(html,/<td>未提供<\/td><td>未提供<\/td><td>1条汇总与明细差异待核对/);assert.equal(h.networkCalls(),0);
});
test('missing daily source report is not displayed as zero even when detail records exist',()=>{
 const {h,tuk}=setup();tuk.uniqueCoverage.diagnosticDays=[{platform:'DHANIWIN',source:'newar',provider:'TukPay',direction:'withdraw',date:'2026-09-25',expectedAvailable:false,expectedCount:null,detailCount:8,missingDetailCount:null,detailMismatchCount:null}];h.render();h.root.providerSummaryCoverage();const html=h.drawers.at(-1).html;
 assert.match(html,/<td>DHANIWIN<\/td><td>newar<\/td><td>2026-09-25<\/td><td>TukPay<\/td><td>未收到<\/td><td>8<\/td>/);assert.doesNotMatch(html,/日汇总与明细数量相差 0 条/);
});
test('unknown provider references are explained separately from real provider conflicts',()=>{
 const {h,tuk}=setup();Object.assign(tuk.uniqueCoverage,{missingOrderNumberCount:0,unresolvedProviderOrderCount:1,resolvedProviderOrderCount:2,unknownProviderRecordCount:3,providerConflictCount:0});h.render();h.root.providerSummaryCoverage();const html=h.drawers.at(-1).html;
 assert.match(html,/1组原单三方未确认/);assert.match(html,/2组原单按唯一已知三方归并/);assert.match(html,/3条来源三方未填写/);assert.doesNotMatch(html,/组三方冲突/);
});
test('resolved unknown labels do not make a complete original-order cohort a conflict',()=>{
 const {h,tuk}=setup();Object.assign(tuk.uniqueCoverage,{status:'complete',complete:true,missingOrderNumberCount:0,unresolvedProviderOrderCount:0,resolvedProviderOrderCount:2,unknownProviderRecordCount:2,providerConflictCount:0});h.render();h.root.providerSummaryCoverage();assert.doesNotMatch(h.drawers.at(-1).html,/<td>TukPay<\/td>/);assert.doesNotMatch(h.html(),/工单原单待核对/);
});

function platformDiagnosis(facts,coverage={complete:true,platforms:[]}){
 const h=fixture([]);h.L.queryPlatforms=[...new Map(facts.map(r=>[r.platformId,{id:r.platformId,name:r.platform,country:'印度',source:r.source}])).values()];
 h.L.results=h.L.queryPlatforms.map(platform=>({platform,groups:{provider:[]}}));h.L.workorders={coverage,byProvider:[],byPlatformProvider:facts};h.render();return h;
}
function diagnosticFact(platform,provider,expected,detail,extra={}){
 const day={date:'2026-09-25',direction:'withdraw',provider,expectedAvailable:expected!==null,expectedCount:expected,detailCount:detail,diagnosticVersion:2,pendingExcludedDetailCount:0,unexplainedDetailMismatchCount:0,...extra};
 return {platform,platformId:platform,source:'ar',country:'印度',provider,direction:'withdraw',submittedCount:expected,uniqueCoverage:{...day,complete:false,status:'partial',diagnosticDays:[day]}};
}
test('platform cards distinguish explained collection scope from issues needing confirmation and retain daily numbers',()=>{
 const a=diagnosticFact('51GAME','ArbPay',14,13,{pendingExcludedDetailCount:1}),b=diagnosticFact('DHANIWIN','UniPayUSDT',3,0,{excludedWorkorderTypeCount:3,excludedTypeExplainedMismatchCount:3});
 const h=platformDiagnosis([a,b]),before=JSON.stringify(h.L.workorders);h.root.providerSummaryWorkorderPlatforms();const drawer=h.drawers.at(-1),html=drawer.html;
 assert.equal(drawer.title,'工单统计差异说明');assert.match(html,/印度 · 代付 · 工单提交日期 2026-09-25 至 2026-09-25/);assert.match(html,/2 个仅有已知范围差异，0 个含待确认项/);assert.match(html,/所列差异三方小计 · 非全平台/);assert.match(html,/汇总 <b>14<\/b> \/ 明细 <b>13<\/b>/);
 assert.match(html,/<td>14<\/td><td>13<\/td><td>\+1 · 汇总多 1<\/td><td>1<\/td><td>0<\/td>/);assert.match(html,/数量差额中有 1 条与待处理数一致，采集器跳过待处理/);assert.match(html,/这是数量解释，不代表已逐笔匹配/);assert.match(html,/USDT 记录已采集/);assert.match(html,/AR 来源可在工单运营中心/);assert.match(html,/当前“工单未到账”入口尚未提供这些 NEWAR 明细/);assert.match(html,/3条USDT工单类型未纳入原单统计/);
 assert.match(html,/源后台 ar → 51GAME → 取款未到账工单；提交日期 2026-09-25；三方 ArbPay；先选全部状态对比，再筛待处理/);assert.match(html,/这里只影响工单提交、成功、未到账及工单成功率/);assert.match(html,/汇总无逐笔号，不能指定缺失哪张工单/);assert.match(html,/不能直接用列表行数与日报原始工单条数比较/);
 assert.equal(JSON.stringify(h.L.workorders),before);assert.equal(h.networkCalls(),0);assert.doesNotMatch(html,/需核对 2 平台|源后台缺少 1|已确认缺少/);
});
test('platform daily diagnostics distinguish negative differences, unavailable reports and unknown breakdowns without fabricated zeros',()=>{
 const a=diagnosticFact('Negative','<UnsafePay>',10,12,{unexplainedDetailMismatchCount:2}),b=diagnosticFact('NoReport','BetaPay',null,8,{pendingExcludedDetailCount:null,unexplainedDetailMismatchCount:null});
 a.uniqueCoverage.diagnosticDays.push({...a.uniqueCoverage.diagnosticDays[0],direction:'charge',provider:'Opposite',detailCount:999});
 const h=platformDiagnosis([a,b]);h.L.to='2026-09-26T23:59:59';h.root.providerSummaryWorkorderPlatforms();const html=h.drawers.at(-1).html;
 assert.match(html,/2026-09-25 至 2026-09-26/);assert.match(html,/<td>10<\/td><td>12<\/td><td>-2 · 明细多 2<\/td><td>0<\/td><td>2<\/td>/);assert.match(html,/还有 2 条差异未被现有原因解释/);assert.match(html,/尚不能认定为源后台漏单/);
 assert.match(html,/<td>未收到<\/td><td>8<\/td><td>无法比较<\/td><td>未提供<\/td><td>未提供<\/td>/);assert.match(html,/未收到该日日报，不能把汇总当作 0/);assert.match(html,/接口尚未提供未解释差异的拆分/);assert.match(html,/&lt;UnsafePay&gt;/);assert.doesNotMatch(html,/<UnsafePay>|Opposite|999/);assert.equal(h.networkCalls(),0);
});
test('platform-only date coverage keeps named missing dates and missing quantities explicit',()=>{
 const row=diagnosticFact('OnlyDates','SyntheticPay',null,null);const h=platformDiagnosis([row],{complete:false,platforms:[{platform:'OnlyDates',source:'ar',country:'印度',days:1,expectedDays:2,complete:false,missingDates:['2026-09-26']}]});h.L.workorders.byPlatformProvider=[];
 h.root.providerSummaryWorkorderPlatforms();const html=h.drawers.at(-1).html;
 assert.match(html,/未收齐 2026-09-26/);assert.match(html,/尚无三方逐日诊断/);assert.match(html,/汇总 <b>未提供<\/b> \/ 明细 <b>未提供<\/b>/);assert.match(html,/1 个含待确认项/);assert.equal(h.networkCalls(),0);
});
test('known exclusions without an unexplained-difference result cannot label the entire platform explained',()=>{
 const row=diagnosticFact('Unclassified','AlphaPay',20,18,{pendingExcludedDetailCount:1,unexplainedDetailMismatchCount:null});const h=platformDiagnosis([row]);h.root.providerSummaryWorkorderPlatforms();const html=h.drawers.at(-1).html;
 assert.match(html,/0 个仅有已知范围差异，1 个含待确认项/);assert.match(html,/接口尚未提供未解释差异的拆分/);assert.doesNotMatch(html,/1 个仅有已知范围差异/);assert.equal(h.networkCalls(),0);
});
