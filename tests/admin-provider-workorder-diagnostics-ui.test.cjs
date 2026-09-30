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
 assert.match(html,/&lt;Platform&gt;/);assert.match(html,/&lt;Source&gt;/);assert.doesNotMatch(html,/<Platform>|<Source>|Opposite/);assert.match(html,/<td>未提供<\/td><td>未提供<\/td><td>1条未收到原始明细/);assert.equal(h.networkCalls(),0);
});
test('missing daily source report is not displayed as zero even when detail records exist',()=>{
 const {h,tuk}=setup();tuk.uniqueCoverage.diagnosticDays=[{platform:'DHANIWIN',source:'newar',provider:'TukPay',direction:'withdraw',date:'2026-09-25',expectedAvailable:false,expectedCount:null,detailCount:8,missingDetailCount:null,detailMismatchCount:null}];h.render();h.root.providerSummaryCoverage();const html=h.drawers.at(-1).html;
 assert.match(html,/<td>DHANIWIN<\/td><td>newar<\/td><td>2026-09-25<\/td><td>TukPay<\/td><td>未收到<\/td><td>8<\/td>/);assert.doesNotMatch(html,/日汇总与明细数量相差 0 条/);
});
