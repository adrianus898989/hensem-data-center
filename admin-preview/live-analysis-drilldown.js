/* Segment drilldowns use loaded platform aggregates. Daily cohorts are fetched only on demand. */
(function(root){
 'use strict';
 const counts=['all_count','success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count'];
 const amounts=['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'];
 const fields=[...counts,...amounts],limits=[300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000];
 const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
 const sum=(rows,key)=>rows.some(r=>!finite(r[key]))?null:rows.reduce((n,r)=>n+Number(r[key]),0);
 const totals=rows=>Object.fromEntries(fields.map(k=>[k,sum(rows,k)]));
 const zero=()=>Object.fromEntries(fields.map(k=>[k,0]));
 const enc=v=>encodeURIComponent(JSON.stringify(v)).replace(/'/g,'%27');
 function create(c){
  const {L,E,N}=c,C=v=>finite(v)?c.C(v):'—',R=(n,d)=>finite(n)&&finite(d)?c.R(n,d):'—',states=new Map();let scope='',generation=0,active=0,inflight=0;const waiters=[];
  async function requestSlot(q,current){while(inflight>=2){if(!current())throw Error('查看范围已改变');await new Promise(resolve=>waiters.push(resolve))}if(!current())throw Error('查看范围已改变');inflight++;try{return await c.request(q)}finally{inflight--;for(const wake of waiters.splice(0))wake()}}
  const name=d=>d==='withdraw'?'代付':'代收';
  const signature=()=>JSON.stringify([L.serial,L.queryScope,L.from,L.to,L.currency,L.status,L.direction,L.results.map(r=>r.platform?.id)]);
  function sync(){const next=signature();if(next!==scope){scope=next;generation++;active++;states.clear()}return scope}
  function state(segment,label){sync();const key=JSON.stringify(segment);if(!states.has(key)){states.set(key,{segment,label,open:false,tab:'platform',platform:'all',daily:new Map()})}const s=states.get(key);if(label)s.label=label;return s}
  const dirs=segment=>segment.direction==='all'?['charge','withdraw']:[segment.direction];
  function platformRows(segment){
   return L.results.flatMap(result=>dirs(segment).map(direction=>{
    const group=segment.kind==='latency'?(segment.cumulative?'latency_thresholds':'latency'):segment.kind;
    const source=result.groups?.[group],rows=(source||[]).filter(r=>r.direction===direction&&(!r.currency||r.currency===L.currency)&&
     (segment.hour===undefined||Number(r.hour)===Number(segment.hour))&&
     (segment.kind==='latency'?(segment.cumulative?Number(r.threshold_ms)===limits[segment.bucket]:Number(r.bucket)===Number(segment.bucket)):segment.bucket===undefined||String(r.bucket)===String(segment.bucket)));
    let metric;
    if(segment.kind==='latency'){
     const summary=(result.summary||[]).find(r=>r.direction===direction&&(!r.currency||r.currency===L.currency));
     const available=Array.isArray(source)&&source.some(r=>r.direction===direction&&(!r.currency||r.currency===L.currency))||summary?.success_count!==null&&summary?.success_count!==undefined&&Number(summary.success_count)===0;
     metric={...zero(),success_amount:available?sum(rows,'amount'):null,success_count:available?sum(rows,'count'):null};
    }else metric=Array.isArray(source)?totals(rows):Object.fromEntries(fields.map(k=>[k,null]));
    return {...metric,platformId:result.platform?.id,platform:result.platform?.name||'未提供平台',source:result.platform?.source||'—',direction,currency:result.platform?.currency||L.currency};
   }));
  }
  const action=(segment,op,value)=>'liveAnalysisAction(\''+enc(segment)+'\',\''+op+'\''+(value===undefined?'':',\''+encodeURIComponent(String(value)).replace(/'/g,'%27')+'\'')+')';
  function button(segment,label){const s=state(segment,label);return '<button class="link analysis-expand" aria-expanded="'+s.open+'" onclick="'+action(segment,'toggle')+'">'+(s.open?'收起':'展开')+'</button>'}
  function dates(){const start=L.from.slice(0,10),end=L.to.slice(0,10),out=[];if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return out;for(let x=Date.parse(start+'T00:00Z');x<=Date.parse(end+'T00:00Z')&&out.length<31;x+=86400000)out.push(new Date(x).toISOString().slice(0,10));return out}
  const multi=()=>L.from.slice(0,10)!==L.to.slice(0,10);
  function metricHeaders(latency){return latency?['成功金额','金额占比','成功笔数','笔数占比']:['全部金额','全部笔数','成功金额','金额占比','成功笔数','笔数占比','处理中金额','处理中笔数','失败金额','失败笔数','成功率'];}
  function metricCells(r,total,latency){const base=[N(r.success_amount),R(r.success_amount,total.success_amount),C(r.success_count),R(r.success_count,total.success_count)];return latency?base:[N(r.all_amount),C(r.all_count),...base,N(r.pending_amount),C(r.pending_count),N(r.failed_amount),C(r.failed_count),r.created_success_count==null?'—':R(r.created_success_count,r.all_count)];}
  function smallTable(headers,rows){return '<div class="analysis-detail-table table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
  function platformBody(s){
   const rows=platformRows(s.segment),latency=s.segment.kind==='latency',by=Object.fromEntries(dirs(s.segment).map(d=>[d,totals(rows.filter(r=>r.direction===d))]));
   rows.sort((a,b)=>Number(b.success_amount||0)-Number(a.success_amount||0)||String(a.platform).localeCompare(String(b.platform)));
   return smallTable(['平台','包网',...(dirs(s.segment).length>1?['方向']:[]),...metricHeaders(latency),...(multi()?['每日对比']:[])],rows.map(r=>[E(r.platform),E(r.source),...(dirs(s.segment).length>1?[name(r.direction)]:[]),...metricCells(r,by[r.direction],latency),...(multi()?['<button class="link" onclick="'+action(s.segment,'platformDaily',r.platformId)+'">查看每天</button>']:[])]));
  }
  const localDate=(value,zone)=>{try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)),get=k=>parts.find(p=>p.type===k)?.value;return get('year')+'-'+get('month')+'-'+get('day')}catch{return ''}};
  function dailyRows(s,entry){
   const latency=s.segment.kind==='latency',days=dates(),records=[];
   for(const date of days)for(const direction of dirs(s.segment)){
    const parts=[];for(const result of entry.results.values()){
     const zone=result.platform.timezone||L.catalog.find(p=>p.id===result.platform.id)?.timezone;
     const first=localDate(result.startAt,zone),last=localDate(Date.parse(result.endAt)-1,zone);if(!first||date<first||date>last)continue;
     const matches=result.groups.daily.filter(r=>r.date===date&&r.direction===direction&&(!r.currency||r.currency===L.currency));
     parts.push(...(matches.length?matches.map(r=>latency?{...zero(),...r,success_amount:r.amount===undefined?r.success_amount:r.amount,success_count:r.count===undefined?r.success_count:r.count}:r):[zero()]));
    }
    records.push({...totals(parts),date,direction,covered:parts.length>0});
   }return records;
  }
  function dailyBody(s){
   const entry=s.daily.get(s.platform),platforms=L.results.map(r=>r.platform).filter(Boolean),control='<label>平台 <select aria-label="每日对比平台" onchange="liveAnalysisAction(\''+enc(s.segment)+'\',\'select\',encodeURIComponent(this.value))"><option value="all">全部平台</option>'+platforms.map(p=>'<option value="'+E(p.id)+'" '+(p.id===s.platform?'selected':'')+'>'+E(p.name)+' · '+E(p.source)+'</option>').join('')+'</select></label>';
   if(!entry)return control+'<p class="muted">选择每日对比后读取对应日期汇总。</p>';
   const progress=entry.loading?'<p class="analysis-status">每日对比读取 '+entry.results.size+' / '+entry.total+' 个平台…</p>':'';
   const failures=entry.failures.length?'<div class="live-status live-error">每日对比尚不完整：'+entry.failures.map(f=>E(f.name+'：'+f.message)).join('；')+' <button class="link" onclick="'+action(s.segment,'retry')+'">重试未完成平台</button></div>':'';
   if(!entry.results.size)return control+progress+failures;
   const rows=dailyRows(s,entry),latency=s.segment.kind==='latency',by=Object.fromEntries(dirs(s.segment).map(d=>[d,totals(rows.filter(r=>r.direction===d&&r.covered))]));
   const rendered=rows.map((r,index)=>{const previous=rows.find(p=>p.direction===r.direction&&p.date===new Date(Date.parse(r.date+'T00:00Z')-86400000).toISOString().slice(0,10)),delta=!entry.loading&&!entry.failures.length&&r.covered&&previous?.covered&&finite(r.success_amount)&&Number(previous.success_amount)>0?((Number(r.success_amount)-Number(previous.success_amount))/Number(previous.success_amount)*100).toFixed(2)+'%':'—';return [E(r.date),...(dirs(s.segment).length>1?[name(r.direction)]:[]),...(r.covered?metricCells(r,by[r.direction],latency):metricHeaders(latency).map(()=> '—')),delta]});
   return control+progress+failures+smallTable(['日期',...(dirs(s.segment).length>1?['方向']:[]),...metricHeaders(latency),'成功金额较前日'],rendered)+'<div class="analysis-note">按各平台当地日期；占比以当前平台范围、当前段、同方向的已读日期合计为分母。首尾日期按所选起止时间，可能不足整日；首日或前日为零不计算增减。</div>';
  }
  function panel(segment,label){const s=state(segment,label);if(!s.open)return '';return '<div class="analysis-drilldown"><div class="analysis-drilldown-head"><strong>'+E(s.label||'区间明细')+' · '+E(L.from.slice(0,10))+' 至 '+E(L.to.slice(0,10))+'</strong><div class="tabs"><button class="'+(s.tab==='platform'?'on':'')+'" onclick="'+action(segment,'platform')+'">各平台占比</button>'+(multi()?'<button class="'+(s.tab==='daily'?'on':'')+'" onclick="'+action(segment,'daily')+'">每日对比</button>':'')+'</div></div>'+(L.queryFailures?.length?'<div class="analysis-status">当前主表有 '+C(L.queryFailures.length)+' 个平台未读取；以下占比仅含已读平台。</div>':'')+(s.tab==='daily'&&multi()?dailyBody(s):platformBody(s))+'<div class="analysis-note">'+(segment.kind==='latency'?'成功金额、笔数按成功时间；耗时为成功时间减提交／创建时间。':'全部及处理中按创建时间；成功金额、笔数按成功时间；成功率按本期创建订单。')+' 平台占比以此段同方向合计为分母，包网来源保留供核对。</div></div>'}
  function table(config){sync();return '<div class="table-wrap analysis-expand-table"><table><thead><tr>'+[...config.headers,'明细'].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+config.rows.map(row=>{const segment=config.segment(row),label=config.label(row),detail=panel(segment,label);return '<tr>'+[...config.cells(row),button(segment,label)].map(v=>'<td>'+v+'</td>').join('')+'</tr>'+(detail?'<tr class="analysis-expanded-row"><td colspan="'+(config.headers.length+1)+'">'+detail+'</td></tr>':'')}).join('')+'</tbody>'+(config.footerRows?.length?'<tfoot>'+config.footerRows.map(r=>'<tr>'+[...r,''].map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tfoot>':'')+'</table></div>'}
  async function load(s,retry=false){
   sync();if(!s.open||L.loading||L.dirty)return;
   let entry=s.daily.get(s.platform);if(entry&&!retry)return;
   if(!entry){entry={results:new Map(),failures:[],loading:false,total:0};s.daily.set(s.platform,entry)}
   const candidates=L.results.map(r=>L.catalog.find(p=>p.id===r.platform?.id)||r.platform).filter(p=>p?.id&&(s.platform==='all'||p.id===s.platform)),pending=candidates.filter(p=>!entry.results.has(p.id)),requests=pending.map(p=>{try{return {p,q:{...c.query(p,'aggregate'),view:'drilldown',kind:s.segment.kind,...(s.segment.hour===undefined?{}:{hour:s.segment.hour}),...(s.segment.bucket===undefined?{}:{bucket:s.segment.bucket}),...(s.segment.cumulative===undefined?{}:{cumulative:s.segment.cumulative}),direction:s.segment.direction,offset:0}}}catch(error){return {p,error}}});
   for(const other of states.values())for(const old of other.daily.values())if(old.loading&&old!==entry){old.loading=false;old.failures.push({name:'读取',message:'已切换查看范围，请重试继续读取'})}entry.total=candidates.length;entry.failures=[];entry.loading=true;const gen=generation,token=++active,key=scope;let index=0;c.render();
   async function worker(){while(index<requests.length&&gen===generation&&token===active){const {p,q,error}=requests[index++];try{if(error)throw error;const r=await requestSlot(q,()=>{sync();return gen===generation&&token===active&&key===scope});sync();if(gen!==generation||token!==active||key!==scope)return;if(r?.complete!==true||r?.hasMore!==false||!Array.isArray(r?.groups?.daily)||!Array.isArray(r?.summary)||(r.platform?.id&&r.platform.id!==p.id))throw Error('每日汇总未完整返回');entry.results.set(p.id,{...r,platform:p,startAt:q.startAt,endAt:q.endAt});}catch(e){sync();if(gen!==generation||token!==active||key!==scope)return;entry.failures.push({id:p.id,name:p.name,message:e.message||'读取失败'})}c.render()}}
   await Promise.all(Array.from({length:Math.min(2,requests.length)},worker));if(gen!==generation||token!==active||key!==scope)return;entry.loading=false;c.render();
  }
  root.liveAnalysisAction=function(encoded,op,value){let segment;try{segment=JSON.parse(decodeURIComponent(encoded))}catch{return}sync();const s=states.get(JSON.stringify(segment));if(!s)return;const decoded=value===undefined?'':decodeURIComponent(value);if(op==='toggle'){s.open=!s.open;if(!s.open&&[...s.daily.values()].some(entry=>entry.loading)){active++;for(const other of states.values())for(const entry of other.daily.values())if(entry.loading){entry.loading=false;entry.failures.push({name:'检查',message:'已收起，请重试继续读取'})}}}else if(op==='platform'){s.tab='platform'}else if(op==='daily'||op==='platformDaily'||op==='select'){s.open=true;s.tab='daily';if(op!=='daily')s.platform=decoded||'all';void load(s)}else if(op==='retry'){void load(s,true)}c.render()};
  return {table,button,panel,platformRows,snapshot:()=>({scope,states}),open(segment,label){const s=state(segment,label);s.open=true;c.render()}};
 }
 root.HensemAnalysisDrilldown={create};
})(typeof window==='object'?window:globalThis);
