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
 assert.match(h.html(),/<label>平台<\/label><strong>15 \/ 16<\/strong>/);assert.match(h.html(),/>缺 51GAME<\/button>/);
 assert.doesNotMatch(h.html(),/provider-intake-coverage/);assert.match(h.html(),/代收三方汇总（部分结果）/);assert.doesNotMatch(h.html(),/provider-intake-summary|provider-api-coverage/);assert.match(h.html(),/11,200.00/,'success data is retained');assert.match(h.html(),/较昨日 · 同范围 15 平台/);
 h.root.providerSummaryPlatformCoverage();const d=h.drawers.at(-1);assert.equal(d.title,'平台采集与读取情况');assert.match(d.html,/<td>51GAME<\/td><td>ar<\/td><td>2026-09-26<\/td><td>代收 · 创建订单<\/td><td>缺少创建数据<\/td><td>仅有该日成功记录，未见该创建日订单/);
});
test('received rows are counted as creation data without claiming full-day completeness',()=>{
 const h=fixture(2);for(const p of h.L.providerIntake.platforms){p.status='received';p.complete=false;p.days[0].complete=false;p.days[0].status='received'}h.render();
 assert.match(h.html(),/<label>平台<\/label><strong>2 \/ 2<\/strong>/);assert.match(h.html(),/>完整性待核验<\/button>/);assert.doesNotMatch(h.html(),/创建数据未收齐/);assert.match(h.html(),/较昨日 · 按已读 2 平台/);h.root.providerSummaryPlatformCoverage();assert.match(h.drawers.at(-1).html,/完整性已核验 0 个 · 待核验 2 个/);
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
 h.L.providerIntake=h.intake();h.L.providerIntake.platforms=[h.L.providerIntake.platforms[0],h.L.providerIntake.platforms[0],{id:'foreign',name:'Other',received:true,complete:true,status:'complete'}];h.render();const c=h.api.intakeCoverage(h.L);assert.equal(c.requested,2);assert.equal(c.received,2,'known nonzero creation rows remain observed despite unusable intake metadata');assert.equal(c.complete,0);h.root.providerSummaryPlatformCoverage();assert.doesNotMatch(h.drawers.at(-1).html,/>Other</);
});
test('comparison uses explicitly labelled read scope when only intake completeness is unverified',()=>{
 const h=fixture(1);h.L.providerComparisonIntake.platforms[0].complete=false;h.render();assert.match(h.html(),/较昨日 · 按已读 1 平台/);assert.match(h.html(),/（无基数）</);
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

function metric(html,label){const match=html.match(new RegExp('<div class="provider-kpi provider-kpi-[^"]+" title="([^"]*)"><div class="provider-kpi-value"><label>'+label+'(?:<span[^>]*>[^<]*</span>)?</label><strong>([^<]*)</strong></div><div class="provider-kpi-comparison">(?:<span class="provider-kpi-change ([^"]*)">([^<]*)</span>)?</div></div>'));assert(match,label+' metric exists');return {detail:match[1],value:match[2],trend:match[3],change:match[4]}}
function previousRows(h,overrides={}){h.L.comparisonResults=h.L.results.map(result=>({...result,groups:{provider:result.groups.provider.map(row=>({...row,...overrides}))}}))}
test('provider amount and count cards show absolute differences while rate remains percentage points',()=>{
 const h=fixture(1);previousRows(h,{all_amount:800,all_count:8,success_amount:500,success_count:5});h.render();
 assert.equal(metric(h.html(),'代收创建金额').change,'+200.00（+25.00%）');
 assert.equal(metric(h.html(),'代收创建笔数').change,'+2 笔（+25.00%）');
 assert.equal(metric(h.html(),'代收成功金额').change,'+200.00（+40.00%）');
 assert.equal(metric(h.html(),'代收成功笔数').change,'+2 笔（+40.00%）');
 assert.equal(metric(h.html(),'代收成功率').change,'+7.50个百分点');
});
test('an intake timeout preserves observed 15 creation sources, names the one unobserved platform, and restores read-scope deltas',()=>{
 const h=fixture(),missing=h.orders[0];missing.all_count=0;missing.all_amount=0;
 previousRows(h,{all_count:20,all_amount:2000,success_count:5,success_amount:500});
 h.L.providerIntake={status:'error',from:'2026-09-26',to:'2026-09-26',error:'同步检查超时'};
 h.L.providerComparisonIntake={status:'error',from:'2026-09-25',to:'2026-09-25',error:'同步检查超时'};h.render();
 assert.match(h.html(),/<label>平台<\/label><strong>15 \/ 16<\/strong>/);assert.match(h.html(),/>未见创建 51GAME<\/button>/);
 assert.doesNotMatch(h.html(),/provider-intake-coverage|provider-intake-summary|provider-api-coverage|>缺 51GAME</);assert.equal(h.api.intakeCoverage(h.L).complete,0);assert.equal(h.api.intakeCoverage(h.L).missing.length,0);
 assert.match(h.html(),/较昨日 · 按已读 16 平台/);assert.equal(metric(h.html(),'代收创建金额').change,'−17,000.00（-53.13%）');assert.equal(metric(h.html(),'代收成功金额').change,'+3,200.00（+40.00%）');
 h.root.providerSummaryPlatformCoverage();assert.match(h.drawers.at(-1).html,/同步检查超时/);
});
test('confirmed missing source is excluded from both periods, while cards retain all known success values',()=>{
 const h=fixture(2);h.orders[0].success_amount=900000;h.orders[0].success_count=900;const p=h.L.providerIntake.platforms[0];p.status='missing';p.received=false;p.complete=false;p.missingDates=['2026-09-26'];
 previousRows(h,{all_amount:800,all_count:8,success_amount:400,success_count:4});h.L.comparisonResults[0].groups.provider[0].success_amount=800000;h.render();
 assert.match(h.html(),/较昨日 · 同范围 1 平台/);assert.equal(metric(h.html(),'代收成功金额').value,'900,700.00');assert.equal(metric(h.html(),'代收成功金额').change,'+300.00（+75.00%）');assert.equal(metric(h.html(),'代收创建金额').change,'+200.00（+25.00%）');assert.equal(metric(h.html(),'代收成功率').change,'+20.00个百分点');assert.match(metric(h.html(),'代收成功金额').detail,/昨日 400.00/);
});
test('loading and failed intake retain completed named evidence rather than resetting every platform to unknown',()=>{
 const h=fixture(2),p=h.L.providerIntake.platforms[0];p.status='missing';p.received=false;p.complete=false;p.missingDates=['2026-09-26'];
 for(const status of ['loading','error']){h.L.providerIntake.status=status;h.render();assert.match(h.html(),/<label>平台<\/label><strong>1 \/ 2<\/strong>/);assert.match(h.html(),/>缺 51GAME<\/button>/);assert.equal(h.api.intakeCoverage(h.L).missing.length,1);assert.equal(h.api.intakeCoverage(h.L).complete,1)}
});
test('empty success-only aggregate does not become a confirmed missing source or a confirmed zero',()=>{
 const h=fixture(1);h.orders[0].all_amount=0;h.orders[0].all_count=0;h.L.providerIntake={status:'error',from:'2026-09-26',to:'2026-09-26',error:'timeout'};h.render();
 const coverage=h.api.intakeCoverage(h.L);assert.equal(coverage.received,0);assert.equal(coverage.complete,0);assert.equal(coverage.missing.length,0);assert.match(h.html(),/<label>平台<\/label><strong>— \/ 1<\/strong>/);assert.doesNotMatch(h.html(),/>缺 51GAME</);
});
test('comparison never combines different identities, currencies, zones, source systems, or duplicate platform responses',()=>{
 for(const key of ['id','currency','timezone','country','source','duplicate']){const h=fixture(1);previousRows(h,{all_amount:500});if(key==='duplicate')h.L.comparisonResults.push(h.L.comparisonResults[0]);else h.L.comparisonResults[0]={...h.L.comparisonResults[0],platform:{...h.L.comparisonResults[0].platform,[key]:'different'}};h.render();assert.equal(metric(h.html(),'代收创建金额').change,undefined,key);assert.match(h.html(),/没有同范围的两期数据，暂不可比/)}
});
test('confirmed gaps from either period are excluded symmetrically and missing prior data keeps its reason',()=>{
 const h=fixture(2);previousRows(h,{all_amount:500,all_count:5});const p=h.L.providerComparisonIntake.platforms[0];p.status='missing';p.received=false;p.complete=false;p.missingDates=['2026-09-25'];h.render();assert.match(h.html(),/同范围 1 平台/);assert.equal(metric(h.html(),'代收创建金额').change,'+500.00（+100.00%）');
 h.L.comparisonStatus='error';h.L.comparisonError='前期数据读取未完成：timeout';h.render();assert.equal(metric(h.html(),'代收创建金额').change,undefined);assert.match(h.html(),/前期数据读取未完成：timeout/);
});
test('zero comparison denominator shows no-baseline rather than infinity or a fake percentage',()=>{
 const h=fixture(1);previousRows(h,{all_amount:0,all_count:0,success_amount:0,success_count:0});h.render();assert.equal(metric(h.html(),'代收创建金额').change,'+1,000.00（无基数）');assert.equal(metric(h.html(),'代收成功率').change,'暂无对比');assert.doesNotMatch(h.html(),/NaN|Infinity/);
 h.orders[0].all_amount=0;h.orders[0].all_count=0;h.render();assert.equal(metric(h.html(),'代收创建金额').change,'0.00（持平）');
});
test('observed creation evidence is restricted to the displayed direction and never claims completeness',()=>{
 const h=fixture(1);h.L.providerIntake=null;h.orders[0].direction='withdraw';assert.equal(h.api.intakeCoverage(h.L,'charge').received,0);assert.equal(h.api.intakeCoverage(h.L,'withdraw').received,1);assert.equal(h.api.intakeCoverage(h.L,'withdraw').complete,0);
});

test('received channel mismatches remain 15 of 16 platforms and do not shrink comparison to only verified platforms',()=>{
 const h=fixture();h.orders[0].all_count=0;h.orders[0].all_amount=0;previousRows(h,{all_count:20,all_amount:2000,success_count:5,success_amount:500});
 const missing=h.L.providerIntake.platforms[0];Object.assign(missing,{status:'missing',received:false,complete:false,missingDates:['2026-09-26'],days:[{date:'2026-09-26',dataset:'orders',direction:'charge',status:'not_received',received:false,complete:false,evidence:'only_success_day_records_received'}]});
 for(const p of h.L.providerIntake.platforms.slice(1,14)){p.status='missing';p.complete=false;p.received=true;p.missingDates=['2026-09-26'];p.days=[{date:'2026-09-26',dataset:'orders',direction:'charge',status:'partial',received:true,complete:false,expected:true,evidence:'source_created_channel_mismatch'}];}
 h.render();let c=h.api.intakeCoverage(h.L);assert.equal(c.received,15);assert.equal(c.complete,2);assert.equal(c.missing.length,1);assert.equal(c.platforms.filter(p=>p.difference).length,13);assert.equal(c.partial,true);assert.match(h.html(),/<label>平台<\/label><strong>15 \/ 16<\/strong>/);assert.match(h.html(),/>缺 51GAME<\/button>/);assert.match(h.html(),/较昨日 · 同范围 15 平台/);assert.equal(metric(h.html(),'代收创建金额').change,'−15,000.00（-50.00%）');assert.match(h.html(),/代收三方汇总（部分结果）/);
 h.root.providerSummaryPlatformCoverage();assert.match(h.drawers.at(-1).html,/已收到 · 核验有差异/);assert.match(h.drawers.at(-1).html,/创建订单与渠道分组不一致/);
 for(const p of h.L.providerIntake.platforms.slice(1,14)){p.status='received';p.missingDates=[];}h.render();c=h.api.intakeCoverage(h.L);assert.equal(c.received,15);assert.equal(c.partial,true);assert.equal(c.missing.length,1);assert.match(h.html(),/较昨日 · 同范围 15 平台/);
});
test('receipt evidence with a real missing adjacent date still identifies the missing day',()=>{
 const h=fixture(1);h.L.from='2026-09-25T00:00:00';h.L.providerIntake.from='2026-09-25';const p=h.L.providerIntake.platforms[0];p.status='missing';p.complete=false;p.received=false;p.missingDates=['2026-09-25','2026-09-26'];p.days=[{date:'2026-09-25',status:'not_received',received:false,complete:false,expected:true},{date:'2026-09-26',status:'partial',received:true,complete:false,expected:true,evidence:'source_created_channel_mismatch'}];h.render();const c=h.api.intakeCoverage(h.L);assert.equal(c.received,0);assert.deepEqual(Array.from(c.missing[0].missingDates),['2026-09-25']);assert.equal(c.partial,true);
});
