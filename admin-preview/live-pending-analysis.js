/* Daily pending snapshots are stocks: never sum their overlapping order windows. */
(function(root){
 'use strict';
 const DAY=86400000;
 const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const numeric=v=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<0?null:Number(v);
 const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 function dates(from,to){if(!validDay(from)||!validDay(to))return null;const count=(Date.parse(to)-Date.parse(from))/DAY+1;if(count<1||count>31)return null;return Array.from({length:count},(_,i)=>new Date(Date.parse(from)+i*DAY).toISOString().slice(0,10));}
 const groups=rows=>{const map=new Map();for(const row of rows||[])for(const g of row.state==='complete'?row.groups||[]:[]){const name=String(g.provider||'未识别三方'),previous=map.get(name)||{provider:name,count:0,amount:0};for(const field of ['count','amount']){const n=numeric(g[field]);previous[field]=n===null||previous[field]===null?null:previous[field]+n;}map.set(name,previous);}return [...map.values()];};
 function project(data,range,unsupported=[]){
  const map=new Map((data?.daily||[]).map(day=>[day.snapshotDate||day.date,day]));
  return range.map(date=>{const value=map.get(date);if(!value)return {date,complete:false,missing:true,rows:[],groups:[],amount:null,count:null,expected:unsupported.length,received:0};const rows=value.rows||[],complete=value.complete===true&&!unsupported.length,received=Number(value.receivedPlatformCount)||0;return {date,complete,missing:received===0,rows,groups:groups(rows),amount:received?numeric(value.amount):null,count:received?numeric(value.count):null,expected:(Number(value.expectedPlatformCount)||0)+unsupported.length,received,source:value};});
 }
 function leaders(day,metric){if(!day?.complete||!day.groups.length||day.groups.some(g=>numeric(g[metric])===null))return [];const top=Math.max(...day.groups.map(g=>g[metric]));return top>0?day.groups.filter(g=>g[metric]===top).map(g=>g.provider):[];}
 function standings(days,metric){
  const names=new Set(days.flatMap(d=>d.groups.map(g=>g.provider))),winners=days.map(day=>leaders(day,metric));
  return [...names].map(provider=>{let run=0,max=0,wins=0,maxBound=false;for(let i=0;i<days.length;i++){if(winners[i].includes(provider)){wins++;run++;const boundary=i-run+1===0;if(run>max){max=run;maxBound=boundary;}else if(run===max)maxBound=maxBound||boundary;}else run=0;}return {provider,current:run,currentBound:run>0&&run===days.length,longest:max,longestBound:maxBound,wins,tied:winners.at(-1)?.length>1&&winners.at(-1).includes(provider)};});
 }
 function create(c){
  const L=c.L,E=c.E||esc,C=v=>numeric(v)===null?'—':c.C?c.C(v):Number(v).toLocaleString('en-US'),N=v=>numeric(v)===null?'—':c.N?c.N(v):Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  let serial=0,S={status:'idle',key:'',data:null,error:'',unsupported:[],metric:'amount',expanded:[]};
  const resolver=()=>root.HensemLivePendingSnapshot?.resolvePlatforms||(typeof require==='function'?require('./live-pending-snapshot.js').resolvePlatforms:null);
  function scope(){const resolve=resolver(),mapped=resolve?resolve(c.selected(),L.withdrawCatalog||[]):{platformIds:[],unsupported:(c.selected()||[]).map(p=>({id:p.id,name:p.name,reason:'快照目录尚未就绪'}))},providers=[...new Set((c.providers()||[]).filter(Boolean))].sort();return {...mapped,request:{action:'pendingAnalysis',startDate:String(L.from||'').slice(0,10),endDate:String(L.to||'').slice(0,10),platformIds:mapped.platformIds,...(providers.length?{providers}:{})},country:L.country};}
  const key=q=>JSON.stringify([q.country,q.request,q.unsupported.map(p=>[p.id,p.name])]);
  const view=()=>!L.dirty&&S.key===key(scope())?S:{...S,status:'idle',data:null,error:''};
  const ratio=(a,b)=>numeric(a)!==null&&numeric(b)>0?(Number(a)/Number(b)*100).toFixed(2)+'%':'—';
  const value=(v,metric=S.metric)=>metric==='count'?C(v):N(v);
  const button=(text,call,extra='')=>'<button type="button" class="link" onclick="'+E(call)+'" '+extra+'>'+text+'</button>';
  const table=(headers,rows,extra='')=>'<div class="pa-table-wrap"><table '+extra+'><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
  const cells=(row,cls='')=>'<tr'+(cls?' class="'+cls+'"':'')+'>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>';
  const panel=(title,body,controls='')=>'<section class="pa-panel"><div class="pa-panel-head"><h2>'+title+'</h2>'+controls+'</div>'+body+'</section>';
  function validate(response,q){
   if(response?.version!==1||response.basis!=='seven_day_pending_snapshot'||response.startDate!==q.request.startDate||response.endDate!==q.request.endDate||!Array.isArray(response.daily))throw Error('代付中分析响应不完整，请重试');
   const allowed=new Set(dates(response.startDate,response.endDate)),seen=new Set(),currencies=new Set();
   for(const d of response.daily){const date=d.snapshotDate||d.date;if(!allowed.has(date)||seen.has(date)||d.basis!=='seven_day_pending_snapshot'||!Array.isArray(d.rows)||typeof d.complete!=='boolean'||!Number.isInteger(d.expectedPlatformCount)||d.expectedPlatformCount<1||!Number.isInteger(d.receivedPlatformCount)||d.receivedPlatformCount<0||d.receivedPlatformCount>d.expectedPlatformCount)throw Error('每日快照日期或覆盖范围待核对');seen.add(date);if(d.currency)currencies.add(d.currency);if(d.complete&&(d.expectedPlatformCount!==d.receivedPlatformCount||numeric(d.amount)===null||numeric(d.count)===null||d.rows.some(row=>row.state!=='complete')))throw Error('每日快照合计待核对');}
   if(currencies.size>1)throw Error('请选择同一币种的平台查看代付中分析');
  }
  async function load(force=true){
   let q=scope();const id=++serial,range=dates(q.request.startDate,q.request.endDate);S={...S,status:'loading',key:key(q),data:null,error:'',unsupported:q.unsupported,expanded:[]};c.render();
   try{if(!range)throw Error('请选择 1 至 31 天的日期范围');await c.prepare?.();if(id!==serial||L.dirty)return;q=scope();S={...S,key:key(q),unsupported:q.unsupported};if(!q.request.platformIds.length)throw Error('当前范围没有可查询的代付中快照平台');if(q.request.platformIds.length>250)throw Error('平台超过 250 个，请缩小筛选范围');const response=await c.request(q.request);if(id!==serial||L.dirty||key(q)!==key(scope()))return;validate(response,q);S={...S,status:'ready',data:response,error:''};}
   catch(error){if(id!==serial||L.dirty||key(q)!==key(scope()))return;S={...S,status:'error',data:null,error:error?.message||'读取失败，请重试'};}
   if(id===serial)c.render();
  }
  const cancel=()=>{serial++;if(S.status==='loading')S={...S,status:'paused',error:'读取已暂停，点击查询继续'};};
  const hours=v=>numeric(v)===null?'—':Number(v)<1?Math.round(Number(v)*60)+' 分钟':Number(v).toFixed(1)+' 小时';
  const capturedAt=day=>{const source=day?.source,at=source?.observedAt,zone=day?.rows?.find(r=>r.timezone)?.timezone;if(!at||!Number.isFinite(Date.parse(at)))return '';try{return new Date(at).toLocaleString('zh-CN',{timeZone:zone||'UTC',hour12:false});}catch{return '';}};
  function ageGroups(aging){const map=new Map();for(const platform of aging?.platforms||[])for(const g of platform.groups||[]){const previous=map.get(g.provider)||{provider:g.provider,count:0,amount:0,over24Count:0,over24Amount:0,maxHours:null,partial:!aging.complete};for(const field of ['count','amount','over24Count','over24Amount']){const n=numeric(g[field]);previous[field]=n===null||previous[field]===null?null:previous[field]+n;}if(numeric(g.maxHours)!==null)previous.maxHours=Math.max(previous.maxHours||0,Number(g.maxHours));previous.partial=previous.partial||platform.state==='metadata_incomplete'||numeric(g.unknownCount)>0;map.set(g.provider,previous);}return map;}
  const ageCell=(text,partial)=>text!=='—'&&partial?'<span class="pa-age-partial" title="仅有效申请时间订单；未齐部分不推算">'+text+'<sup>*</sup></span>':text;
  function metrics(latest,aging){
   const has=latest&&!latest.missing,positiveRows=(latest?.rows||[]).filter(r=>r.state==='complete'&&numeric(r.count)>0),providerCount=(latest?.groups||[]).filter(g=>numeric(g.count)>0).length;
   const items=[['代付中金额',has?N(latest.amount):'—'],['代付中笔数',has?C(latest.count):'—'],['涉及平台',has?C(positiveRows.length):'—'],['涉及三方',has?C(providerCount):'—'],['≥24 小时'+(aging?.available&&!aging.complete?' · 已核实部分':''),aging?.available&&numeric(aging.over24Count)!==null?C(aging.over24Count)+' 笔':'—']];
   return '<div class="pa-metrics">'+items.map(([label,v],i)=>'<div class="pa-metric'+(i===4?' pa-warning':'')+'"><span>'+label+'</span><strong>'+v+'</strong></div>').join('')+'</div>';
  }
  function trend(days){
   const metric=S.metric,max=Math.max(0,...days.map(d=>numeric(d[metric])||0));
   const rows=days.map(d=>{const available=!d.missing&&numeric(d[metric])!==null,n=available?d[metric]:null,top=leaders(d,metric),note=d.complete?'完整':d.missing?'未采到':'部分采集';return '<div class="pa-trend-row'+(!d.complete?' pa-incomplete':'')+'"><span>'+E(d.date.slice(5))+'</span><div class="pa-track"><i style="width:'+(n!==null&&max>0?Math.max(0,Math.min(100,n/max*100)):0)+'%"></i></div><strong>'+value(n)+'</strong><span class="pa-trend-leader" title="'+E(top.join(' / '))+'">'+E(top.length?(top.length>1?'并列：':'')+top.join(' / '):d.complete?'—':note)+'</span></div>';});
   return panel('每日代付中趋势','<div class="pa-trend-caption"><span>日期</span><span>'+ (metric==='amount'?'金额':'笔数')+'</span><span>当日最多三方</span></div><div class="pa-trend">'+rows.join('')+'</div>');
  }
  const delta=(now,before)=>{if(numeric(now)===null||numeric(before)===null)return '—';const diff=now-before,format=S.metric==='amount'?N:C,absolute=(diff>0?'+':diff<0?'−':'')+format(Math.abs(diff))+(S.metric==='count'?' 笔':'');return absolute+'（'+(before===0?(now===0?'持平':'无基数'):(diff>0?'+':'')+(diff/Math.abs(before)*100).toFixed(2)+'%')+'）'};
  function platformTable(latest,previous,aging){
   if(!latest||latest.missing)return panel('平台与三方分布','<div class="pa-empty">结束日没有可用快照</div>');
   const sorted=[...latest.rows,...S.unsupported.map(p=>({...p,state:'unsupported'}))].sort((a,b)=>(numeric(b[S.metric])??-1)-(numeric(a[S.metric])??-1)||String(a.name).localeCompare(String(b.name))),rows=[];
   for(const r of sorted){const id=String(r.id),valid=r.state==='complete',children=groups([r]).sort((a,b)=>(numeric(b[S.metric])??-1)-(numeric(a[S.metric])??-1)),open=S.expanded.includes(id),prior=previous?.complete&&latest.complete?previous.rows.find(x=>x.id===r.id&&x.state==='complete'):null,age=aging?.platforms?.find(p=>String(p.id)===id&&['complete','metadata_incomplete'].includes(p.state));
    rows.push(cells([E(r.name||r.sourceName||'—'),valid?N(r.amount):'—',valid?ratio(r.amount,latest.amount):'—',valid?C(r.count):'—',valid?ratio(r.count,latest.count):'—',ageCell(age?C(age.over24Count):'—',age?.state==='metadata_incomplete'),ageCell(age&&numeric(age.count)>0?hours(age.maxHours):'—',age?.state==='metadata_incomplete'),prior?delta(numeric(r[S.metric]),numeric(prior[S.metric])):'—',valid?button(open?'收起':'展开','livePendingAnalysisExpand('+JSON.stringify(id)+')','aria-expanded="'+open+'"'):'<span class="pa-muted">未采齐</span>'],'pa-platform'));
    if(open)for(const g of children){const a=age?.groups?.find(x=>x.provider===g.provider),partial=age?.state==='metadata_incomplete'||numeric(a?.unknownCount)>0;rows.push(cells([E(g.provider),N(g.amount),ratio(g.amount,latest.amount),C(g.count),ratio(g.count,latest.count),ageCell(a?C(a.over24Count):'—',partial),ageCell(a&&numeric(a.count)>0?hours(a.maxHours):'—',partial),'—',''],'pa-provider'));}
   }
   return panel('平台与三方分布',table(['平台 / 三方','代付中金额','金额占比','代付中笔数','笔数占比','≥24h 笔数','最长等待','较前一日','展开'],rows,'aria-label="代付中平台与三方分布"'),'<small>'+E(latest.complete?'当日全部已选平台':'已采集小计')+'</small>');
  }
  function providerTable(days,aging){
   const latest=days.at(-1),last=new Map((latest?.groups||[]).map(g=>[g.provider,g])),ranking=standings(days,S.metric),completeDays=days.filter(d=>d.complete).length,ages=ageGroups(aging);
   ranking.sort((a,b)=>(numeric(last.get(b.provider)?.[S.metric])??-1)-(numeric(last.get(a.provider)?.[S.metric])??-1)||b.wins-a.wins||a.provider.localeCompare(b.provider));
   const streak=(n,bound)=>n?(bound?'≥':'')+n+' 天':'—';
   const rows=ranking.map(r=>{const g=last.get(r.provider),count=g?g.count:latest?.complete?0:null,amount=g?g.amount:latest?.complete?0:null,a=ages.get(r.provider);return cells([E(r.provider)+(r.tied?'<small class="pa-tied">并列最多</small>':''),N(amount),ratio(amount,latest?.amount),C(count),ratio(count,latest?.count),ageCell(a?C(a.over24Count):'—',a?.partial),ageCell(a&&numeric(a.count)>0?hours(a.maxHours):'—',a?.partial),streak(r.current,r.currentBound),streak(r.longest,r.longestBound),r.wins?' '+r.wins+' / '+completeDays+' 天':'—']);});
   return panel('三方占比与连续最多'+(!latest?.complete?' · 已采集部分':''),rows.length?table(['三方','代付中金额','金额占比','代付中笔数','笔数占比','≥24h 笔数','最长等待','当前连续最多','期间最长连续','最多天数'],rows,'aria-label="三方占比与连续最多"'):'<div class="pa-empty">所选期间没有可用三方数据</div>','<small title="连续最多按自然日计算；缺失、部分采集和全零日期均中断，并列最多各自计入；≥ 表示已达到查询起日，之前未知。">按'+(S.metric==='amount'?'金额':'笔数')+'排名 · <span class="pa-hint">口径 ⓘ</span></small>');
  }
  function agingPanel(aging){
   const missing=(aging?.missingPlatforms||[]).map(p=>p.name||p.id).filter(Boolean),coverage='<div class="pa-age-coverage">'+(aging?.available?'有效等待时间 '+C(aging.count)+' 笔 · 时间未知 '+C(aging.unknownCount)+' 笔':'该日明细未保留 / 未齐')+(missing.length?' · <span title="'+E(missing.join(' / '))+'">'+missing.length+' 个平台明细待齐</span>':'')+'</div>';
   if(!aging?.available)return panel('卡单等待时长',coverage);
   const rows=(aging.buckets||[]).map(b=>cells([E(b.label||b.key),C(b.count),N(b.amount),ratio(b.count,aging.count)]));
   return panel('卡单等待时长',coverage+table(['等待时长','笔数','金额','有效时间笔数占比'],rows,'aria-label="卡单等待时长分布"'),'<small title="等待时长 = 当日实际采集时间 − 订单创建时间；只统计与当日快照核对一致的明细。">平均 '+hours(aging.avgHours)+' · 最长 '+hours(aging.maxHours)+(aging.complete?'':' · 已核实部分')+'</small>');
  }
  function priorities(days,aging){
   const notes=[],ranked=[...ageGroups(aging).values()].filter(g=>numeric(g.over24Count)>0).sort((a,b)=>b.over24Count-a.over24Count),peak=ranked[0]?.over24Count,tops=ranked.filter(g=>g.over24Count===peak);
   if(aging?.available&&tops.length)notes.push('<strong>优先跟进</strong> '+E(tops.map(g=>g.provider).join(' / '))+'：'+(tops.length>1?'并列':'')+'≥24 小时 '+C(peak)+' 笔'+(tops.length===1?'，金额 '+N(tops[0].over24Amount):'')+(aging.complete?'':'（已核实部分）'));
   const current=standings(days,S.metric).filter(r=>r.current>1);if(current.length)notes.push('按'+(S.metric==='amount'?'金额':'笔数')+'连续最多：'+current.map(r=>E(r.provider)+' '+(r.currentBound?'≥':'')+C(r.current)+' 天').join('；'));
   return notes.length?'<div class="pa-priority">'+notes.map(n=>'<span>'+n+'</span>').join('')+'</div>':'';
  }
  function page(){
   const s=view();if(s.status==='idle')return '<div class="live-status">请选择筛选条件，点击查询。</div>';if(s.status==='loading')return '<div class="live-status" role="status">正在读取每日代付中快照…</div>';if(s.status==='error'||s.status==='paused')return '<div class="live-status'+(s.status==='error'?' live-error':'')+'" role="status">'+E(s.error)+'</div>';if(!s.data)return '';
   const q=scope(),days=project(s.data,dates(q.request.startDate,q.request.endDate),s.unsupported),latest=days.at(-1),previous=days.at(-2),count=days.filter(d=>d.complete).length,rawAge=s.data.aging?.basis==='source_snapshot_age'&&s.data.aging.snapshotDate===q.request.endDate?s.data.aging:null,aging=rawAge?{...rawAge,complete:rawAge.complete&&!s.unsupported.length,coverageComplete:rawAge.coverageComplete&&!s.unsupported.length,missingPlatforms:[...(rawAge.missingPlatforms||[]),...s.unsupported.map(p=>({...p,state:'unsupported'}))]}:null,missing=[...latest.rows.filter(p=>p.state!=='complete'),...s.unsupported].map(p=>p.name||p.id).filter(Boolean).join(' / ');
   const state=latest.complete?'采集完整':latest.missing?'结束日未采到快照':'部分采集 '+latest.received+' / '+latest.expected+' 平台';
   const controls='<div class="pa-controls" role="group" aria-label="排名依据">'+['amount','count'].map(metric=>'<button type="button" class="'+(s.metric===metric?'on':'')+'" aria-pressed="'+(s.metric===metric)+'" onclick="livePendingAnalysisMetric(\''+metric+'\')">按'+(metric==='amount'?'金额':'笔数')+'</button>').join('')+'</div>';
   return '<div class="live-pending-analysis" data-pending-analysis="ready"><div class="pa-toolbar"><div><strong>快照日期 '+E(q.request.endDate)+'</strong><span'+(missing?' title="快照待齐：'+E(missing)+'"':'')+'>'+(capturedAt(latest)?'最近采集于 '+E(capturedAt(latest))+' · ':'')+E(state)+' · 完整日期 '+count+' / '+days.length+' 天'+(q.request.providers?.length?' · 所选三方范围':'')+'</span></div>'+controls+'</div>'+metrics(latest,aging)+priorities(days,aging)+'<div class="pa-charts">'+trend(days)+agingPanel(aging)+'</div>'+providerTable(days,aging)+platformTable(latest,previous,aging)+'<details class="pa-basis"><summary>统计口径</summary><p>每天使用当天采集的近 7 天待付存量，不包含更早创建的订单；跨日存量不相加。占比以结束日所选范围的已采集金额、笔数为分母。连续最多仅在采集完整的自然日之间判断，缺失日中断；并列分别计入，≥ 表示查询起日前仍未知。等待时长按当日采集时间计算，缺失明细不推算。</p></details></div>';
  }
  root.livePendingAnalysisMetric=metric=>{if(view().status!=='ready'||!['amount','count'].includes(metric))return;S={...S,metric};c.render();};
  root.livePendingAnalysisExpand=id=>{if(view().status!=='ready')return;id=String(id);const end=S.data.daily.find(d=>(d.snapshotDate||d.date)===scope().request.endDate);if(!end?.rows.some(r=>String(r.id)===id&&r.state==='complete'))return;S={...S,expanded:S.expanded.includes(id)?S.expanded.filter(x=>x!==id):[...S.expanded,id]};c.render();};
  return {load,page,cancel,capture:()=>({...S,status:S.status==='loading'?'paused':S.status,error:S.status==='loading'?'读取已暂停，点击查询继续':S.error,expanded:[...S.expanded]}),restore:value=>{serial++;S=value?{...value,expanded:[...(value.expanded||[])]}:{status:'idle',key:'',data:null,error:'',unsupported:[],metric:'amount',expanded:[]};}};
 }
 root.HensemLivePendingAnalysis={create,project,standings};
 if(typeof module!=='undefined')module.exports={create,project,standings};
})(typeof window!=='undefined'?window:globalThis);
