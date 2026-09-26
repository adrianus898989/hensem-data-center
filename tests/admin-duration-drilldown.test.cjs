const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-duration-reference.js'),'utf8');
const limits=[300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000];
function result(id,count=10,success=6,createdSuccess=5){return {platform:{id,name:'Platform '+id,team:'M8',country:'印度',source:'ar',timezone:'Asia/Kolkata'},summary:[{direction:'charge',currency:'INR',all_count:count,all_amount:count*100,success_count:success,success_amount:success*100,created_success_count:createdSuccess,pending_count:2,pending_amount:200}],groups:{latency:Array.from({length:10},(_,bucket)=>({direction:'charge',currency:'INR',bucket,count:bucket===0?success:0,amount:bucket===0?success*100:0,valid_count:success,valid_amount:success*100})),latency_thresholds:limits.map((threshold_ms,bucket)=>({direction:'charge',currency:'INR',bucket,threshold_ms,count:0,amount:0,valid_count:success,valid_amount:success*100})),pending_age:[],pending_age_thresholds:[]},latencySummary:[{direction:'charge',currency:'INR',valid_count:success,valid_amount:success*100,mean_ms:60000,p50_ms:60000,p95_ms:120000,max_ms:150000}]}}
function setup(results=[result('A')],extra={}){const tables=[],calls=[],context=vm.createContext({});vm.runInContext('window=globalThis',context);vm.runInContext(source,context);const L={results,direction:'charge',currency:'INR',from:'2026-09-24T00:00:00',to:'2026-09-25T23:59:59',...extra};const ctx={L,table:(headers,rows,classes='',footer=[])=>{tables.push({headers,rows,footer});return '<table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table>'},box:(title,body,note,actions)=>'<section><h2>'+title+'</h2>'+String(actions||'')+body+'<p>'+String(note||'')+'</p></section>'};return {L,ctx,tables,calls,context,render:page=>context.HensemLiveDuration.create(ctx).render(page)}}
test('successful duration follows the success-day cohort while non-success quality follows created orders',()=>{const h=setup([result('A',10,16,7)]),html=h.render('latency');assert.match(html,/所选成功日期范围/);assert.match(html,/按成功时间入选/);assert.match(html,/3 笔创建订单未成功/);assert.doesNotMatch(html,/-6 笔/);const distribution=h.tables.find(x=>x.headers[0]==='成功耗时区间');assert.equal(distribution.rows[0][2],'16');assert.equal(distribution.rows[0][3],'100.00%');});
test('missing or inconsistent creation-cohort success counts are unknown, never fabricated negative counts',()=>{for(const createdSuccess of [undefined,null,20]){const r=result('A',10,16,createdSuccess);if(createdSuccess===undefined)delete r.summary[0].created_success_count;const h=setup([r]),html=h.render('latency');assert.match(html,/— 笔创建订单未成功/);assert.doesNotMatch(html,/-10 笔|NaN|Infinity/);}});
test('complete bins bound P95 across platforms or split ranges while weighted means remain valid',()=>{for(const results of [[result('A'),result('B')],[{...result('A'),_parts:[{},{}]}]]){const h=setup(results),html=h.render('latency');assert.match(html,/<span>P95 耗时<\/span><strong>≤ 5 分钟<\/strong>/);assert.match(html,/<span>平均 \/ P50 耗时<\/span><strong>1分<\/strong>/);assert.match(html,/分档区间（非精确值）/);}});
test('split-range averages are restored from source statistics by valid count without merging quantiles',()=>{
 const first=result('A',2,2,2),second=result('A',8,8,8),merged=result('A',10,10,10);
 second.latencySummary[0]={...second.latencySummary[0],mean_ms:180000,p50_ms:170000,p95_ms:240000,max_ms:300000};
 merged._parts=[first,second];merged.latencySummary=[];
 const h=setup([merged]),before=JSON.stringify(h.L.results),html=h.render('latency');
 assert.match(html,/<span>平均 \/ P50 耗时<\/span><strong>2分 36秒<\/strong>/);
 assert.match(html,/按各段有效成功笔数加权计算/);assert.match(html,/P50 ≤ 5 分钟 · 区间，非精确值/);
 assert.match(html,/<span>P95 耗时<\/span><strong>≤ 5 分钟<\/strong>/);assert.match(html,/完整 10 档计数/);
 assert.equal(h.tables.find(t=>t.headers[0]==='成功耗时区间').rows[0][2],'10');assert.equal(JSON.stringify(h.L.results),before);
});
test('nested split statistics and other platforms combine means using valid orders, not platform or shard averages',()=>{
 const first=result('A',2,2,2),second=result('A',8,8,8),merged=result('A',10,10,10),other=result('B',10,10,10);
 second.latencySummary[0].mean_ms=180000;other.latencySummary[0].mean_ms=240000;
 merged.latencySummary=[];merged._parts=[{...first,latencySummary:[],_parts:[first]},second];
 const html=setup([merged,other]).render('latency');
 assert.match(html,/<span>平均 \/ P50 耗时<\/span><strong>3分 18秒<\/strong>/);assert.match(html,/P50 ≤ 5 分钟 · 区间，非精确值/);
});
test('missing or inconsistent shard timing never produces a partial average as a complete mean',()=>{
 for(const invalid of ['missing','wrong-count','unknown-mean']){
  const first=result('A',2,2,2),second=result('A',8,8,8),merged=result('A',10,10,10);
  if(invalid==='missing')second.latencySummary=[];
  if(invalid==='wrong-count')second.latencySummary[0].valid_count=9;
  if(invalid==='unknown-mean')second.latencySummary[0].mean_ms=null;
  merged._parts=[first,second];merged.latencySummary=[];
  const html=setup([merged]).render('latency');assert.match(html,/<span>平均 \/ P50 耗时<\/span><strong>—<\/strong>/);assert.match(html,/不能推算平均值/);assert.doesNotMatch(html,/NaN|Infinity/);
 }
});
test('missing source quantiles and no valid orders have different explanations from a split range',()=>{
 const missing=result('A');missing.latencySummary[0].p50_ms=null;missing.latencySummary[0].p95_ms=null;
 missing.groups.latency.pop();
 const html=setup([missing]).render('latency');assert.match(html,/来源未提供完整分位数统计/);assert.doesNotMatch(html,/跨分段分位数不可合并/);
 assert.match(setup([result('A',10,0,0)]).render('latency'),/当前无有效成功时间订单/);
 assert.match(setup().render('latency'),/95% 有效成功单不超过此时长/);
});
function binned(counts){const total=counts.reduce((n,v)=>n+v,0),r=result('A',total,total,total);r.latencySummary[0].p50_ms=null;r.latencySummary[0].p95_ms=null;r.groups.latency.forEach((row,i)=>{row.count=counts[i]||0;row.amount=row.count*100});return r}
test('complete bin counts give useful conservative P50 and P95 intervals without claiming exact quantiles',()=>{
 const r=binned([9779,0,0,0,0,0,0,0,0,221]),h=setup([r]),before=JSON.stringify(r),html=h.render('latency');
 assert.match(html,/97.79%/);assert.match(html,/<span>P95 耗时<\/span><strong>≤ 5 分钟<\/strong>/);
 assert.match(html,/P50 ≤ 5 分钟 · 区间，非精确值/);assert.match(html,/95% 订单完成时间 · 分档区间（非精确值）/);
 assert.match(html,/全部 10,000 笔有效成功订单的完整 10 档计数/);assert.equal(JSON.stringify(r),before);
 const same=setup([binned([0,0,0,0,6,0,0,0,0,0])]).render('latency');assert.match(same,/<span>P95 耗时<\/span><strong>3～6 小时<\/strong>/);
});
test('continuous percentile interval contains both interpolation ranks rather than a nearest-rank bin',()=>{
 const interpolate=setup([binned([19,0,0,0,0,0,0,0,0,1])]).render('latency');
 // N=20: P95 rank=18.05 uses positions 18 and 19; nearest-rank would wrongly pick only the fast bin.
 assert.match(interpolate,/<span>P95 耗时<\/span><strong>0 秒以上（上限未知）<\/strong>/);
 const exactRank=setup([binned([20,0,0,0,0,0,0,0,0,1])]).render('latency');
 // N=21: rank=19 is integral; the final slow order is not an interpolation endpoint.
 assert.match(exactRank,/<span>P95 耗时<\/span><strong>≤ 5 分钟<\/strong>/);
 const two=setup([binned([0,1,0,0,1,0,0,0,0,0])]).render('latency');assert.match(two,/<span>P95 耗时<\/span><strong>5 分钟～6 小时<\/strong>/);assert.match(two,/P50 5 分钟～6 小时 · 区间/);
 const median=setup([binned([5,5,0,0,0,0,0,0,0,0])]).render('latency');assert.match(median,/P50 ≤ 30 分钟 · 区间/);
 const tail=setup([binned([0,0,0,0,0,0,0,0,0,1])]).render('latency');assert.match(tail,/<span>P95 耗时<\/span><strong>超过 3 天<\/strong>/);
 const crossTail=setup([binned([0,1,0,0,0,0,0,0,0,1])]).render('latency');assert.match(crossTail,/<span>P95 耗时<\/span><strong>超过 5 分钟（上限未知）<\/strong>/);
});
test('quantile interval requires complete, consistent nonnegative integer bins and a complete platform response',()=>{
 for(const invalid of ['missing','duplicate','fractional','negative','null','wrong-total','wrong-denominator','unsafe','partial-platform','loading']){
  const r=binned([6,0,0,0,0,0,0,0,0,0]),extra={};
  if(invalid==='missing')r.groups.latency.pop();
  if(invalid==='duplicate')r.groups.latency[9].bucket=8;
  if(invalid==='fractional')r.groups.latency[0].count=5.5;
  if(invalid==='negative'){r.groups.latency[0].count=7;r.groups.latency[1].count=-1}
  if(invalid==='null')r.groups.latency[1].count=null;
  if(invalid==='wrong-total')r.groups.latency[0].count=5;
  if(invalid==='wrong-denominator')r.groups.latency[2].valid_count=7;
  if(invalid==='unsafe')r.groups.latency[0].count=Number.MAX_SAFE_INTEGER+1;
  if(invalid==='partial-platform')extra.queryFailures=[{id:'missing'}];
  if(invalid==='loading')extra.loading=true;
  const html=setup([r],extra).render('latency');assert.match(html,/<span>P95 耗时<\/span><strong>—<\/strong>/,invalid);assert.match(html,/P50 —/,invalid);assert.doesNotMatch(html,/分档区间（非精确值）/,invalid);
 }
});
test('exact source quantiles stay preferred and interval counts use successful bins, not cumulative thresholds',()=>{
 const exact=setup().render('latency');assert.match(exact,/<span>P95 耗时<\/span><strong>2分<\/strong>/);assert.match(exact,/P50 1分<\/small>/);assert.doesNotMatch(exact,/分档区间（非精确值）/);
 const r=binned([0,0,0,0,10,0,0,0,0,0]);r.groups.latency_thresholds.forEach(row=>row.count=0);
 const html=setup([r],{durationMode:'cumulative'}).render('latency');assert.match(html,/<span>P95 耗时<\/span><strong>3～6 小时<\/strong>/);
 const a=binned([9,0,0,0,0,0,0,0,0,0]),b=binned([0,1,0,0,0,0,0,0,0,0]);
 assert.match(setup([a,b]).render('latency'),/<span>P95 耗时<\/span><strong>≤ 30 分钟<\/strong>/);
});
test('pending page keeps its creation-date stock basis and layout independent of successful duration',()=>{const r=result('A');r.summary[0].direction='withdraw';const h=setup([r],{direction:'withdraw'}),html=h.render('stuck');assert.match(html,/所选创建日期范围/);assert.doesNotMatch(html,/所选成功日期范围|平台每日明细/);assert.deepEqual(Array.from(h.tables.find(t=>t.headers[0]==='已等待时长').headers),['已等待时长','代付中金额 · INR','代付中笔数','笔数占比','金额占比']);});

test('duration distribution uses the shared expansion contract without additional reads',()=>{const r=result('A'),h=setup([r]);const original=JSON.stringify(h.L.results);let spec;h.ctx.analysis={table:value=>{spec=value;return '<table data-shared="expanded"></table>'}};const html=h.render('latency');assert.match(html,/data-shared="expanded"/);assert.equal(spec.id,'latency-distribution');assert.equal(spec.rows.length,10);assert.equal(spec.headers.length,5);assert.deepEqual(JSON.parse(JSON.stringify(spec.segment(spec.rows[0]))),{kind:'latency',direction:'charge',bucket:0,cumulative:false});assert.equal(spec.label(spec.rows[0]),'≤ 5 分钟');assert.equal(spec.cells(spec.rows[0])[1],'600.00');assert.equal(spec.footerRows[0][1],'600.00');assert.equal(JSON.stringify(h.L.results),original);
 h.L.durationMode='cumulative';h.L.direction='all';h.render('latency');assert.equal(spec.rows.length,9);assert.equal(spec.headers.length,9);assert.equal(spec.label(spec.rows[8]),'超过 3 天');assert.deepEqual(JSON.parse(JSON.stringify(spec.segment(spec.rows[8]))),{kind:'latency',direction:'all',bucket:8,cumulative:true});assert.equal(JSON.stringify(h.L.results),original);});
test('shared expanded rows preserve unknown timing cells and the valid-time denominator',()=>{const r=result('A',10,8,4);r.groups.latency[0].count=2;r.groups.latency[0].amount=200;r.groups.latency.forEach(row=>{row.valid_count=4;row.valid_amount=400});const h=setup([r]);let spec;h.ctx.analysis={table:value=>{spec=value;return ''}};h.render('latency');const cells=spec.cells(spec.rows[0]);assert.equal(cells[2],'2');assert.equal(cells[3],'50.00%');assert.equal(cells[4],'50.00%');r.groups.latency=[];r.groups.latency_thresholds=[];r.latencySummary=[];h.render('latency');assert(spec.rows.every(row=>spec.cells(row).slice(1).every(cell=>cell==='—')));});
test('waiting page never asks the success-distribution expansion to render',()=>{const h=setup();h.ctx.analysis={table:()=>{throw Error('success drilldown must not alter pending layout')}};assert.match(h.render('stuck'),/data-duration-page="stuck"/);});
test('slow-provider section opens the selected threshold using the shared provider API without changing the main range',()=>{
 const h=setup(),seen=[];h.L.durationThreshold=3600000;
 h.ctx.analysis={table:()=>'',dimensionButton:(segment,label,dimension)=>{seen.push({segment,label,dimension});return '<button>'+dimension+'展开</button>'},panel:()=>''};
 const before=JSON.stringify(h.L.results),html=h.render('latency');
 assert.match(html,/档内占比和该三方自身超时率分开展示/);assert.doesNotMatch(html,/此处独立三方分组汇总尚未接入/);
 assert.deepEqual(JSON.parse(JSON.stringify(seen[0])),{segment:{kind:'latency',direction:'charge',bucket:2,cumulative:true,placement:'duration-groups',dimension:'provider'},label:'超过 1 小时',dimension:'provider'});
 h.L.durationGroup='platform';h.render('latency');assert.equal(seen[1].dimension,'platform');assert.equal(seen[1].segment.dimension,'platform');assert.equal(JSON.stringify(h.L.results),before);
});
