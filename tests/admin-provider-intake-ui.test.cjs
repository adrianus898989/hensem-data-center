/* Synthetic source-day coverage; no live accounts, credentials or orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const folder=path.join(__dirname,'../admin-preview');
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const C=v=>Number(v||0).toLocaleString('en-US'),N=v=>v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2}),R=(n,d)=>d?(100*n/d).toFixed(2)+'%':'—';
const keys=['all_amount','all_count','success_amount','success_count','created_success_count','pending_amount','pending_count'];
const plus=rows=>Object.fromEntries(keys.map(k=>[k,rows.reduce((n,r)=>n+Number(r[k]||0),0)]));
function combine(rows,keys){const groups=new Map();for(const r of rows){const k=JSON.stringify(keys.map(k=>r[k]));if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}return [...groups.values()].map(items=>({...items[0],...plus(items),items}))}
const table=(headers,rows,css='',foot=[])=>'<div class="'+css+'"><table><thead><tr>'+headers.map(v=>'<th>'+v+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody><tfoot>'+foot.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tfoot></table></div>';
function fixture(count=16){
 const drawers=[],root={Intl,Date,fetch(){throw Error('No network during render or details')}};root.window=root;vm.createContext(root);
 for(const file of ['live-provider-aliases.js','live-comparison.js','live-provider-summary.js'])vm.runInContext(fs.readFileSync(path.join(folder,file),'utf8'),root,{filename:file});
 const queryPlatforms=Array.from({length:count},(_,i)=>({id:'platform-'+i,name:i?'Platform '+i:'51GAME',source:'ar',country:'印度',currency:'INR',timezone:'Asia/Kolkata'}));
 const orders=queryPlatforms.map(p=>({platformId:p.id,platform:p.name,source:p.source,provider:'SyntheticPay',currency:'INR',direction:'charge',all_amount:1000,all_count:10,success_amount:700,success_count:7}));
 const L={country:'印度',currency:'INR',from:'2026-09-26T00:00:00',to:'2026-09-26T23:59:59',queryNow:Date.parse('2026-09-28T00:00:00Z'),queryPlatforms,results:queryPlatforms.map((platform,i)=>({platform,groups:{provider:[orders[i]]},capabilities:{sourceCompletenessVerified:false}})),comparisonStatus:'ready',comparisonResults:queryPlatforms.map(platform=>({platform,groups:{provider:[]}})),feeLookupRows:[],localPage:1,localSize:20};
 let html='';const ctx={L,E,N,C,R,plus,combine,groupRows:()=>orders,table,box:(name,body)=>'<section><h2>'+E(name)+'</h2>'+body+'</section>',pager:()=>'',providerCell:r=>E(r.provider),feeForRow:()=>'',ensureFeeLookup(){throw Error('No rate fetch')},openDrawer(title,html){drawers.push({title,html})},render(){html=root.HensemProviderSummary.render(ctx,'charge')}};
 const intake=(day='2026-09-26')=>({status:'ready',from:day,to:day,platforms:queryPlatforms.map(p=>({...p,status:'complete',complete:true,received:true,missingDates:[],days:[{date:day,dataset:'orders',direction:'charge',status:'complete',complete:true,received:true,expected:true}]}))});
 L.providerIntake=intake();L.providerComparisonIntake=intake('2026-09-25');ctx.render();return {root,L,intake,drawers,api:root.HensemProviderSummary,html:()=>html,render:ctx.render,orders};
}
test('16 returned platforms with one missing creation day show 15 creation sources and preserve known success',()=>{
 const h=fixture(),p=h.L.providerIntake.platforms[0];p.status='missing';p.received=false;p.complete=false;p.missingDates=['2026-09-26'];p.days=[{date:'2026-09-26',dataset:'orders',direction:'charge',status:'not_received',received:false,complete:false,evidence:'only_success_day_records_received'}];h.render();
 assert.equal(h.api.queryCoverage(h.L).received,16);assert.equal(h.api.intakeCoverage(h.L).received,15);
 assert.match(h.html(),/>创建数据<\/small> 15 \/ 16/);assert.match(h.html(),/接口 <small[^>]*>已读取<\/small> 16 \/ 16/);
 assert.match(h.html(),/创建数据未收齐/);assert.match(h.html(),/代收三方汇总（部分结果）/);assert.match(h.html(),/完整性已核验 15 \/ 16/);assert.match(h.html(),/11,200.00/,'success data is retained');assert.match(h.html(),/创建数据完整性待核验，暂不可比/);
 h.root.providerSummaryPlatformCoverage();const d=h.drawers.at(-1);assert.equal(d.title,'平台采集与读取情况');assert.match(d.html,/<td>51GAME<\/td><td>ar<\/td><td>2026-09-26<\/td><td>代收 · 创建订单<\/td><td>缺少创建数据<\/td><td>仅有该日成功记录，未见该创建日订单/);
});
test('received rows are counted as creation data without claiming full-day completeness',()=>{
 const h=fixture(2);for(const p of h.L.providerIntake.platforms){p.status='received';p.complete=false;p.days[0].complete=false;p.days[0].status='received'}h.render();
 assert.match(h.html(),/>创建数据<\/small> 2 \/ 2/);assert.match(h.html(),/完整性已核验 0 \/ 2 · 待核验 2/);assert.doesNotMatch(h.html(),/创建数据未收齐/);assert.match(h.html(),/创建数据完整性待核验，暂不可比/);
});
test('only verified zero is complete; an empty aggregate never proves a creation-day zero',()=>{
 const h=fixture(2),p=h.L.providerIntake.platforms[0];p.status='zero_complete';p.days[0].status='zero_complete';p.days[0].zeroConfirmed=true;
 h.L.results=h.L.queryPlatforms.map(platform=>({platform,groups:{provider:[]},totals:{all_count:0},capabilities:{sourceCompletenessVerified:false}}));
 h.L.providerIntake.platforms[1]={...h.L.providerIntake.platforms[1],status:'unverified',received:false,complete:false,days:[]};h.render();
 const c=h.api.intakeCoverage(h.L);assert.equal(c.received,1);assert.equal(c.complete,1);assert.equal(c.missing.length,0,'unknown zero is not evidence of missing collection');h.root.providerSummaryPlatformCoverage();assert.match(h.drawers.at(-1).html,/零笔已确认/);assert.match(h.drawers.at(-1).html,/待核验/);
});
test('missing evidence overrides success-only presence and cannot be hidden by partial date coverage',()=>{
 const h=fixture(1);h.L.from='2026-09-20T00:00:00';h.L.providerIntake.from='2026-09-20';const p=h.L.providerIntake.platforms[0];p.days.unshift({date:'2026-09-20',dataset:'orders',status:'received',received:true,complete:false,evidence:'only_success_day_records_received'});h.render();
 assert.equal(h.api.intakeCoverage(h.L).received,0);assert.equal(h.api.intakeCoverage(h.L).missing[0].missingDates[0],'2026-09-20');h.root.providerSummaryPlatformCoverage();assert.match(h.drawers.at(-1).html,/2026-09-20/);assert.match(h.drawers.at(-1).html,/仅有该日成功记录/);
});
test('stale ranges, foreign identities and duplicated intake identities cannot complete selected sources',()=>{
 const h=fixture(2);h.L.providerIntake.from='2026-09-25';h.render();assert.equal(h.api.intakeCoverage(h.L).ready,false);assert.equal(h.api.intakeCoverage(h.L).complete,0);
 h.L.providerIntake=h.intake();h.L.providerIntake.platforms=[h.L.providerIntake.platforms[0],h.L.providerIntake.platforms[0],{id:'foreign',name:'Other',received:true,complete:true,status:'complete'}];h.render();const c=h.api.intakeCoverage(h.L);assert.equal(c.requested,2);assert.equal(c.received,0);h.root.providerSummaryPlatformCoverage();assert.doesNotMatch(h.drawers.at(-1).html,/>Other</);
});
test('current proof alone does not enable comparisons when the comparison period is unverified',()=>{
 const h=fixture(1);h.L.providerComparisonIntake.platforms[0].complete=false;h.render();assert.match(h.html(),/对比期创建数据完整性待核验/);
 h.L.providerComparisonIntake=h.intake('2026-09-25');h.render();assert.doesNotMatch(h.html(),/对比期创建数据完整性待核验|创建数据完整性待核验，暂不可比/);
});
test('details use loaded source evidence, escape strings, and refuse dirty filters without a request',()=>{
 const h=fixture(1);h.L.providerIntake.platforms[0].days[0].notes='<script>synthetic</script>';h.render();h.root.providerSummaryPlatformCoverage();assert.match(h.drawers.at(-1).html,/&lt;script&gt;synthetic&lt;\/script&gt;/);assert.doesNotMatch(h.drawers.at(-1).html,/<script>/);
 const before=h.drawers.length;h.L.dirty=true;h.root.providerSummaryPlatformCoverage();assert.equal(h.drawers.length,before);
});
test('retrying a failed aggregate cannot remove an existing source-day gap',()=>{
 const h=fixture(2),p=h.L.providerIntake.platforms[1];p.status='missing';p.complete=false;p.received=false;p.missingDates=['2026-09-26'];h.L.results=h.L.results.slice(0,1);h.L.queryFailures=[{...h.L.queryPlatforms[1],message:'timeout'}];h.render();
 h.L.results.push({platform:h.L.queryPlatforms[1],groups:{provider:[]}});h.render();assert.equal(h.api.queryCoverage(h.L).partial,false);assert.equal(h.api.intakeCoverage(h.L).missing.length,1);assert.match(h.html(),/代收三方汇总（部分结果）/);
});
test('source evidence uses readable notes and does not leak internal codes or duplicate translations',()=>{
 const h=fixture(1),day=h.L.providerIntake.platforms[0].days[0];day.evidence='source_created_counts_reconciled';day.notes='创建总数与渠道分组已核对';h.render();h.root.providerSummaryPlatformCoverage();let html=h.drawers.at(-1).html;assert.match(html,/创建总数与渠道分组已核对/);assert.doesNotMatch(html,/source_created_counts_reconciled/);assert.equal((html.match(/创建总数与渠道分组已核对/g)||[]).length,1);
 delete day.notes;day.evidence='future_internal_code';h.render();h.root.providerSummaryPlatformCoverage();html=h.drawers.at(-1).html;assert.match(html,/采集依据待核验/);assert.doesNotMatch(html,/future_internal_code/);
});
