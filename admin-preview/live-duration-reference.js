/* Approved latency / pending page composition. Authorized RPC aggregates only.
 * No raw-order reconstruction, provider timing inference, or merged exact quantiles.
 * Controls call the host's local-only liveDurationSet(key, value). */
(function (root) {
 'use strict';
 const LIMITS=[300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000];
 const SHORT=['5 分钟','30 分钟','1 小时','3 小时','6 小时','12 小时','1 天','2 天','3 天'];
 const BANDS=['≤ 5 分钟','5～30 分钟','30 分钟～1 小时','1～3 小时','3～6 小时','6～12 小时','12 小时～1 天','1～2 天','2～3 天','超过 3 天'];
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>value===null||value===undefined||value===''||typeof value==='boolean'||!Number.isFinite(Number(value))?null:Number(value);
 const sum=(rows,key)=>rows.length&&rows.every(r=>number(r[key])!==null)?rows.reduce((n,r)=>n+Number(r[key]),0):rows.length?null:0;
 const percentage=(a,b)=>number(a)!==null&&number(b)>0?(Number(a)/Number(b)*100).toFixed(2)+'%':'—';
 function duration(value){const ms=number(value);if(ms===null||ms<0)return '—';const seconds=Math.round(ms/1000);return [[Math.floor(seconds/86400),'天'],[Math.floor(seconds%86400/3600),'小时'],[Math.floor(seconds%3600/60),'分'],[seconds%60,'秒']].filter(x=>x[0]).map(x=>x.join('')).join(' ')||'0 秒'}
 function create(ctx){
  const L=ctx.L,E=ctx.E||escape,N=ctx.N||(n=>number(n)===null?'—':Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})),C=n=>number(n)===null?'—':ctx.C?ctx.C(n):Number(n).toLocaleString('en-US');
  const table=ctx.table,box=ctx.box;
  const directions=()=>L.direction==='all'?['charge','withdraw']:[L.direction==='withdraw'?'withdraw':'charge'];
  const title=d=>d==='charge'?'充值 / 代收':'提款 / 代付';
  const short=d=>d==='charge'?'充值':'提款';
  const mode=()=>L.durationMode==='cumulative'?'cumulative':'bins';
  const group=()=>['provider','platform','team','country'].includes(L.durationGroup)?L.durationGroup:'provider';
  const detail=()=>L.durationDetail==='orders'?'orders':'groups';
  const selectedRows=(rows,d)=>(Array.isArray(rows)?rows:[]).filter(r=>r.direction===d&&(!r.currency||!L.currency||r.currency===L.currency));
  const sourceRows=(result,d)=>selectedRows(result.summary,d);
  function timingParts(result,d,pending){
   const direct=selectedRows(result[pending?'pendingSummary':'latencySummary'],d);
   if(direct.length===1)return {rows:direct,complete:true,split:result._parts?.length>1};
   const shards=Array.isArray(result._parts)?result._parts.filter(p=>p&&p!==result):[];
   if(shards.length){const parts=shards.map(p=>timingParts(p,d,pending));return {rows:parts.flatMap(p=>p.rows),complete:parts.every(p=>p.complete),split:shards.length>1||parts.some(p=>p.split)}}
   const count=sum(sourceRows(result,d),(pending?'pending':'success')+'_count'),bins=selectedRows(result.groups?.[pending?'pending_age':'latency'],d);
   return {rows:[],complete:count===0||!!bins.length&&number(bins[0].valid_count)===0,split:false};
  }
  function timingSummary(result,d,pending){
   const parts=timingParts(result,d,pending);if(!parts.complete)return null;
   const validCount=sum(parts.rows,'valid_count'),active=parts.rows.filter(p=>number(p.valid_count)>0);
   if(validCount===null)return null;
   const known=key=>active.length&&active.every(p=>number(p[key])!==null&&number(p[key])>=0);
   return {valid_count:validCount,mean_ms:validCount>0&&known('mean_ms')?active.reduce((n,p)=>n+Number(p.mean_ms)*Number(p.valid_count),0)/validCount:null,
    max_ms:known('max_ms')?Math.max(...active.map(p=>Number(p.max_ms))):null,
    p50_ms:!parts.split&&active.length===1?number(active[0].p50_ms):null,p95_ms:!parts.split&&active.length===1?number(active[0].p95_ms):null};
  }
  function stat(d,pending=false){
   const name=pending?'pending_age':'latency',candidateKey=pending?'pending':'success',results=Array.isArray(L.results)?L.results:[];
   const parts=results.map(result=>{const summary=sourceRows(result,d),candidateCount=sum(summary,candidateKey+'_count'),candidateAmount=sum(summary,candidateKey+'_amount'),bins=selectedRows(result.groups?.[name],d),thresholds=selectedRows(result.groups?.[name+'_thresholds'],d),timing=selectedRows(result[pending?'pendingSummary':'latencySummary'],d);const first=bins[0]||thresholds[0],s=timingSummary(result,d,pending),direct=timing.length===1?timing[0]:null;return {result,candidateCount,candidateAmount,bins,thresholds,timing:s,available:candidateCount===0||!!first||!!direct,validCount:first?number(first.valid_count):direct?number(direct.valid_count):candidateCount===0?0:null,validAmount:first?number(first.valid_amount):direct?number(direct.valid_amount):candidateCount===0?0:null}});
   const candidateCount=sum(parts,'candidateCount'),candidateAmount=sum(parts,'candidateAmount'),available=parts.every(p=>p.available),validCount=sum(parts,'validCount'),validAmount=sum(parts,'validAmount');
   const active=parts.filter(p=>Number(p.validCount)>0),complete=available&&active.every(p=>p.timing&&number(p.timing.valid_count)===p.validCount);
   const mean=complete&&validCount>0&&active.every(p=>number(p.timing.mean_ms)!==null)?active.reduce((n,p)=>n+Number(p.timing.mean_ms)*p.validCount,0)/validCount:null;
   // A quantile is not additive. Even one platform can contain several merged shards.
   const quantile=key=>complete&&active.length===1&&!(active[0].result._parts?.length>1)&&number(active[0].timing[key])!==null?number(active[0].timing[key]):null;
   const max=complete&&active.length&&active.every(p=>number(p.timing.max_ms)!==null)?Math.max(...active.map(p=>Number(p.timing.max_ms))):null;
   const excludedCount=candidateCount!==null&&validCount!==null&&candidateCount>=validCount?candidateCount-validCount:null;
   const excludedAmount=candidateAmount!==null&&validAmount!==null&&candidateAmount>=validAmount?candidateAmount-validAmount:null;
   function bucket(index,cumulative=false){const field=cumulative?'thresholds':'bins';if(!available)return {count:null,amount:null};const matches=parts.map(p=>{const row=p[field].find(r=>cumulative?number(r.threshold_ms)===LIMITS[index]:number(r.bucket)===index);return row||((p.candidateCount===0||p[field].length)?{count:0,amount:0}:{count:null,amount:null})});return {count:sum(matches,'count'),amount:sum(matches,'amount')}}
   function quantileRange(q){
    if(pending||!available||L.loading||L.queryFailures?.length||!Number.isSafeInteger(validCount)||validCount<=0)return null;
    const counts=Array(10).fill(0);
    for(const p of parts){
     if(!Number.isSafeInteger(p.validCount)||p.validCount<0||p.bins.length!==10)return null;
     const seen=new Set();let total=0;
     for(const row of p.bins){const index=number(row.bucket),n=number(row.count);if(!Number.isInteger(index)||index<0||index>9||seen.has(index)||!Number.isSafeInteger(n)||n<0||number(row.valid_count)!==p.validCount)return null;seen.add(index);total+=n;counts[index]+=n}
     if(total!==p.validCount)return null;
    }
    if(counts.reduce((n,v)=>n+v,0)!==validCount)return null;
    // percentile_cont interpolates the two order statistics around (N - 1) * q.
    // Bins bound both positions, not a nearest-rank point estimate or averaged percentile.
    const rank=(validCount-1)*q,locate=position=>{let seen=0;for(let i=0;i<counts.length;i++){seen+=counts[i];if(position<seen)return i}return -1},lo=locate(Math.floor(rank)),hi=locate(Math.ceil(rank));
    if(lo<0||hi<0)return null;
    const label=lo===hi?BANDS[lo]:hi===9?(lo===0?'0 秒以上':'超过 '+SHORT[lo-1])+'（上限未知）':lo===0?'≤ '+SHORT[hi]:SHORT[lo-1]+'～'+SHORT[hi];
    return {label,note:'分档区间，非精确值；依据全部 '+C(validCount)+' 笔有效成功订单的完整 10 档计数，覆盖 (N−1)×'+Math.round(q*100)+'% 两侧排序位置的耗时范围'};
   }
   return {parts,candidateCount,candidateAmount,available,validCount,validAmount,excludedCount,excludedAmount,mean,p50:quantile('p50_ms'),p95:quantile('p95_ms'),p50Range:quantileRange(.5),p95Range:quantileRange(.95),max,bucket,partitioned:active.length>1||active.some(p=>p.result._parts?.length>1)};
  }
  function tabs(items,key,current){return '<div class="tabs">'+items.map(([value,label])=>'<button type="button" class="'+(current===value?'on':'')+'" onclick="liveDurationSet(\''+key+'\',\''+value+'\')">'+label+'</button>').join('')+'</div>'}
  const modeTabs=pending=>tabs([['bins',pending?'逐笔等待分档':'逐笔耗时分档'],['cumulative','超过指定时长']],'durationMode',mode())+'<button class="btn small" onclick="liveExport()">导出统计</button>';
  const money=n=>N(n),count=n=>C(n);
  const emptyTable=(headers,note)=>table(headers,[],'table-wrap')+'<div class="live-empty">'+E(note)+'</div>';
  function rangeNote(pending){return pending?'所选创建日期范围 '+E(L.from||'—')+' 至 '+E(L.to||'—')+' 内仍待付订单；不含窗口外历史积压。等待时长按各分段查询时点计算，非同一冻结快照。':'所选成功日期范围 '+E(L.from||'—')+' 至 '+E(L.to||'—')+'；按成功时间入选，耗时 = 成功时间 − 来源提交／创建时间；各平台当地时间；币种 '+E(L.currency||'—')+'。GAME66 提款成功时间可能为源更新时间代理。'}
  function summaryCard(d){
   const s=stat(d),fast=s.bucket(0),a=sourceRows({summary:(L.results||[]).flatMap(r=>r.summary||[])},d),all=sum(a,'all_count'),missingQuantile=s.validCount===0?'当前无有效成功时间订单':s.partitioned?'跨分段分位数不可合并；不能相加或平均':'来源未提供完整分位数统计',meanNote=s.mean===null?'有效耗时统计未完整返回，不能推算平均值':s.partitioned?'按各段有效成功笔数加权计算':'来源完整成功耗时平均值';
   const p50=s.p50===null?s.p50Range:null,p95=s.p95===null?s.p95Range:null,p50Note=p50?p50.note:s.p50===null?missingQuantile:'来源精确 P50',p95Note=p95?'95% 订单完成时间 · 分档区间（非精确值）':s.p95===null?missingQuantile:'95% 有效成功单不超过此时长';
   return '<section class="panel latency-summary" data-duration-direction="'+E(d)+'"><div class="panel-head"><h2>'+title(d)+'到账时效<span>提交 '+count(all)+' 笔 · 成功 '+count(s.candidateCount)+' 笔</span></h2><span class="badge '+(d==='charge'?'blue':'green')+'">'+percentage(s.validCount,s.candidateCount)+' 时间覆盖</span></div><div class="latency-summary-grid"><div><span>有效成功订单</span><strong>'+count(s.validCount)+' 笔</strong><small class="cell-sub">'+money(s.validAmount)+' '+E(L.currency)+'</small></div><div><span>5 分钟内成功</span><strong>'+percentage(fast.count,s.validCount)+'</strong><small class="cell-sub">'+count(fast.count)+' 笔 · '+money(fast.amount)+'</small></div><div title="'+E(meanNote)+'"><span>平均 / P50 耗时</span><strong>'+duration(s.mean)+'</strong><small class="cell-sub" title="'+E(p50Note)+'">P50 '+E(p50?p50.label:duration(s.p50))+(p50?' · 区间，非精确值':'')+'</small></div><div title="'+E(p95?p95.note:p95Note)+'"><span>P95 耗时</span><strong>'+E(p95?p95.label:duration(s.p95))+'</strong><small class="cell-sub">'+E(p95Note)+'</small></div></div></section>';
  }
  function latencyDistribution(){const ds=directions().map(d=>({direction:d,s:stat(d)})),cumulative=mode()==='cumulative',headers=['成功耗时'+(cumulative?'阈值':'区间'),...ds.flatMap(x=>[short(x.direction)+'成功金额',short(x.direction)+'成功笔数',short(x.direction)+'笔数占比',short(x.direction)+'金额占比'])],rows=Array.from({length:cumulative?9:10},(_,i)=>[(cumulative?'超过 '+SHORT[i]:BANDS[i]),...ds.flatMap(({s})=>{const b=s.bucket(i,cumulative);return [money(b.amount),count(b.count),percentage(b.count,s.validCount),percentage(b.amount,s.validAmount)]})]),footer=[['<strong>成功订单耗时合计</strong>',...ds.flatMap(({s})=>{const has=Number(s.validCount)>0;return [money(s.validAmount),count(s.validCount),has?'100.00%':'—',has&&s.validAmount!==null?'100.00%':'—']})]];const grid=ctx.analysis?ctx.analysis.table({id:'latency-distribution',headers,rows:rows.map((cells,index)=>({index,cells})),cells:row=>row.cells,segment:row=>({kind:'latency',direction:L.direction==='all'?'all':L.direction,bucket:row.index,cumulative}),label:row=>cumulative?'超过 '+SHORT[row.index]:BANDS[row.index],footerRows:footer}):table(headers,rows,'',footer);return box('成功到账耗时分布','<div class="latency-grid-table">'+grid+'</div>',(cumulative?'严格超过阈值 · 同一笔可命中多行，行间不相加':'每笔只入一档 · 区间含右端点')+' · 同方向有效成功订单为占比分母 · '+E(L.currency),modeTabs(false))}
  function quality(){const ds=directions(),records=ds.map(d=>({d,s:stat(d)})),notSuccess=ds.map(d=>{const rows=(L.results||[]).flatMap(r=>sourceRows(r,d));const all=sum(rows,'all_count'),createdSuccess=sum(rows,'created_success_count');return {count:all!==null&&createdSuccess!==null&&all>=createdSuccess?all-createdSuccess:null}});return '<div class="latency-quality"><span>同方向有效成功订单为分母 · 精确至秒 · '+E(L.currency)+'</span><span>'+count(sum(notSuccess,'count'))+' 笔创建订单未成功 · '+records.map(({d,s})=>short(d)+' '+count(s.excludedCount)+' 笔成功时间待核对').join(' · ')+' · 缺提交时间未提供</span></div>'}
  function groupControls(pending){const labels={provider:'三方',platform:'平台',team:'团队',country:'国家'},key=group(),threshold=LIMITS.includes(Number(L.durationThreshold))?Number(L.durationThreshold):LIMITS[0];return '<div class="latency-group-controls"><select aria-label="'+(pending?'待付':'时效')+'分组维度" onchange="liveDurationSet(\'durationGroup\',this.value)">'+Object.entries(labels).map(([value,label])=>'<option value="'+value+'" '+(key===value?'selected':'')+'>'+label+'</option>').join('')+'</select><select aria-label="'+(pending?'待付':'时效')+'超时时长" onchange="liveDurationSet(\'durationThreshold\',Number(this.value))">'+LIMITS.map((value,i)=>'<option value="'+value+'" '+(threshold===value?'selected':'')+'>超过 '+SHORT[i]+'</option>').join('')+'</select><input aria-label="搜索'+(pending?'待付':'时效')+'分组" placeholder="搜索'+labels[key]+'名称" value="'+E(L.durationQuery||'')+'" onchange="liveDurationSet(\'durationQuery\',this.value)"></div>'}
  function groups(pending){
   const dimension=group(),label={provider:'三方',platform:'平台',team:'团队',country:'国家'}[dimension],ds=directions();
   if(!pending&&['provider','platform'].includes(dimension)&&ctx.analysis?.dimensionButton&&ctx.analysis?.panel){
    const threshold=LIMITS.includes(Number(L.durationThreshold))?Number(L.durationThreshold):LIMITS[0],bucket=LIMITS.indexOf(threshold),segment={kind:'latency',direction:L.direction==='all'?'all':L.direction,bucket,cumulative:true,placement:'duration-groups',dimension},caption='超过 '+SHORT[bucket];
    const button=ctx.analysis.dimensionButton(segment,caption,dimension),body=ctx.analysis.panel(segment,caption)||'<div class="live-empty">点击“'+label+'展开”查看'+caption+'的分档汇总。'+(dimension==='provider'?'档内占比和该三方自身超时率分开展示。':'使用当前已读取的平台耗时数据。')+'</div>';
    return box('哪些三方 / 平台到账较慢',body,'所选成功日期范围；超时按严格超过指定时长计算。',groupControls(false)+button);
   }
   const headers=pending?[label,'代付中金额','代付中笔数','超时金额','超时笔数','超时笔数占比','超时金额占比','最长等待']:[label,...ds.flatMap(d=>[short(d)+'超时金额',short(d)+'超时笔数',short(d)+'笔数占比',short(d)+'金额占比']),...ds.map(d=>short(d)+' P95')];
   return box(pending?label+'代付中与超时分布':'哪些三方 / 平台到账较慢',emptyTable(headers,(pending?'':'上方每档可分别展开三方和平台。')+'此处独立'+label+'分组汇总尚未接入；不以全局分档推算各'+label+'数据。'),'各行应以该'+label+'内同方向有效时间订单为分母',groupControls(pending));
  }
  function orders(pending){const headers=pending?['订单号','系统 ID','平台','团队','三方','代付中金额 · '+E(L.currency),'创建时间','已等待时长','操作']:['订单号','系统 ID','平台','三方','方向','成功金额 · '+E(L.currency),'提交时间','成功时间','成功耗时','操作'];return box(pending?'逐笔代付中订单':'逐笔提交 → 成功时间',emptyTable(headers,'当前时效查询仅返回完整汇总，尚未提供对应时长条件的逐笔接口；不将已加载订单页冒充完整明细。'),pending?'按等待从长到短排序 · 尚未接入逐笔等待查询':'按成功时间 − 提交时间核对 · 尚未接入时效明细查询','<div class="latency-group-controls"><input aria-label="搜索'+(pending?'代付中':'成功时效')+'订单" placeholder="订单号 / ID / 平台 / 三方" value="'+E(L.durationOrderQuery||'')+'" onchange="liveDurationSet(\'durationOrderQuery\',this.value)"></div>')}
  function detailSection(pending){return '<div class="section-switcher" id="'+(pending?'pending-detail':'latency-detail')+'">'+tabs([['groups','三方 / 平台 / 团队 / 国家'],['orders',pending?'逐笔代付中订单':'逐笔成功订单']],'durationDetail',detail())+'</div>'+(detail()==='orders'?orders(pending):groups(pending))}
  function pendingStock(s){return '<div class="pending-stock">'+[['本期仍代付中金额',money(s.candidateAmount),''],['本期仍代付中笔数',count(s.candidateCount),''],['待付涉及平台','—','分组未提供'],['待付涉及三方','—','分组未提供'],['最长等待',duration(s.max),'分段统计时点 − 创建时间']].map(([label,value,note],i)=>'<div class="pending-metric '+(i===4?'pending-longest':'')+'"><span>'+label+'</span><strong>'+value+'</strong><small>'+note+'</small></div>').join('')+'<div class="pending-stock-action"><small>所选创建范围 · 非历史全部存量</small><button class="btn soft" onclick="liveDurationSet(\'durationDetail\',\'orders\')">逐笔订单 →</button></div></div>'}
  function pendingDistribution(s){const cumulative=mode()==='cumulative',rows=Array.from({length:cumulative?9:10},(_,i)=>{const b=s.bucket(i,cumulative);return [cumulative?'超过 '+SHORT[i]:BANDS[i],money(b.amount),count(b.count),percentage(b.count,s.validCount),percentage(b.amount,s.validAmount)]});rows.push(['等待时间待核对',money(s.excludedAmount),count(s.excludedCount),'—','—']);rows.push(['<strong>本期仍代付中合计</strong>',money(s.candidateAmount),count(s.candidateCount),'—','—']);return '<div class="pending-v3 latency-flow-persist" id="pending-waiting">'+box('代付中 · 等待时长分布','<div class="pending-table">'+table(['已等待时长','代付中金额 · '+E(L.currency),'代付中笔数','笔数占比','金额占比'],rows)+'</div>',(cumulative?'严格超过指定时长 · 同一订单可出现在多行，不能逐行相加':'每笔只入一档 · 含右端点')+' · 占比分母为有效等待时间订单；待核对及合计不参与分档占比',modeTabs(true))+'<div class="pending-basis">'+rangeNote(true)+'</div></div>'}
  function render(page){if(page==='latency')return '<div class="latency-v3 live-duration-reference" data-duration-page="latency"><div class="grid equal">'+directions().map(summaryCard).join('')+'</div>'+latencyDistribution()+quality()+'<div class="pending-basis">'+rangeNote(false)+'</div>'+detailSection(false)+'</div>';if(page==='stuck'){const s=stat('withdraw',true),late=s.bucket(6,true);return '<div class="pending-v3 live-duration-reference" data-duration-page="stuck">'+pendingStock(s)+'<div class="pending-secondary"><span>超过 1 天：'+money(late.amount)+' '+E(L.currency)+'　'+count(late.count)+' 笔</span><span>平均等待 '+duration(s.mean)+'　·　P95 '+duration(s.p95)+'</span><span>时间待核对 '+count(s.excludedCount)+' 笔</span></div>'+pendingDistribution(s)+detailSection(true)+'</div>'}return null}
  return Object.freeze({render});
 }
 root.HensemLiveDuration=Object.freeze({create});
})(typeof window==='object'?window:globalThis);
