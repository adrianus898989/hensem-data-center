/* Platform drilldowns use loaded aggregates. Provider and daily cohorts load on demand. */
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
  function dimensionButton(segment,label,dimension){const s=state(segment,label),platform=dimension==='platform',open=s.open&&(platform?s.tab==='platform':['provider','providerDaily'].includes(s.tab));return '<button class="link analysis-expand" aria-expanded="'+open+'" onclick="'+action(segment,platform?'togglePlatform':'toggleProvider')+'">'+(open?'收起':'')+(platform?'平台':'三方')+(open?'':'展开')+'</button>'}
  function button(segment,label,exclusiveGroup){const s=state(segment,label);if(exclusiveGroup)s.exclusiveGroup=exclusiveGroup;if(segment.kind==='latency')return dimensionButton(segment,label,'provider')+' '+dimensionButton(segment,label,'platform');return '<button class="link analysis-expand" aria-expanded="'+s.open+'" onclick="'+action(segment,'toggle')+'">'+(s.open?'收起':'展开')+'</button>'}
  function dates(){const start=L.from.slice(0,10),end=L.to.slice(0,10),out=[];if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return out;for(let x=Date.parse(start+'T00:00Z');x<=Date.parse(end+'T00:00Z')&&out.length<31;x+=86400000)out.push(new Date(x).toISOString().slice(0,10));return out}
  const multi=()=>L.from.slice(0,10)!==L.to.slice(0,10);
  function metricHeaders(latency){return latency?['成功金额','成功笔数']:['全部金额','全部笔数','成功金额','成功笔数','处理中金额','处理中笔数','失败金额','失败笔数','成功率'];}
  const share=(value,ratio,label)=>'<span class="analysis-metric-value">'+value+'</span><small class="analysis-metric-share">'+label+' '+ratio+'</small>';
  function metricCells(r,total,latency){const base=[share(N(r.success_amount),R(r.success_amount,total.success_amount),'金额占比'),share(C(r.success_count),R(r.success_count,total.success_count),'笔数占比')];return latency?base:[N(r.all_amount),C(r.all_count),...base,N(r.pending_amount),C(r.pending_count),N(r.failed_amount),C(r.failed_count),R(r.success_count,r.all_count)];}
  function smallTable(headers,rows){return '<div class="analysis-detail-table table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
  const providerTab=s=>s.segment.kind==='latency'&&['provider','providerDaily'].includes(s.tab);
  const providerReady=result=>Array.isArray(result?.groups?.provider)&&Array.isArray(result?.groups?.provider_daily);
  function providerEntry(s){const entry=s.daily.get('all');return {entry,complete:!!entry&&!L.queryFailures?.length&&!entry.loading&&!entry.failures.length&&entry.results.size===entry.total&&[...entry.results.values()].every(providerReady)}}
  function providerRows(s,daily=false){
   const {entry}=providerEntry(s),groups=new Map(),keys=['count','amount','valid_count','valid_amount'];
   for(const result of entry?.results.values()||[])for(const row of result.groups?.[daily?'provider_daily':'provider']||[]){
    if(!dirs(s.segment).includes(row.direction)||row.currency&&row.currency!==L.currency||daily&&row.provider!==s.provider)continue;
    const key=JSON.stringify([row.provider,row.direction,row.currency,daily?row.date:null]);if(!groups.has(key))groups.set(key,{provider:row.provider,direction:row.direction,currency:row.currency,date:row.date,parts:[]});groups.get(key).parts.push(row);
   }
   return [...groups.values()].map(row=>({...row,...Object.fromEntries(keys.map(key=>[key,sum(row.parts,key)]))}));
  }
  function providerGrid(s){
   const {entry,complete}=providerEntry(s),daily=s.tab==='providerDaily',extra=dirs(s.segment).length>1;
   const label=s.segment.cumulative?'自身超时率':'自身落档率',scopeLabel=daily?'该三方当日有效成功笔数':'该三方有效成功笔数';
   const headers=[daily?'成功日期':'三方',...(extra?['方向']:[]),'本档成功金额','档内金额占比','本档成功笔数','档内笔数占比',scopeLabel,label,...(!daily&&multi()?['每日对比']:[])];
   const progress=entry?.loading?'<p class="analysis-status">三方分档读取 '+entry.results.size+' / '+entry.total+' 个平台…</p>':'';
   const failures=entry?.failures.length?'<div class="live-status live-error">三方分档尚不完整：'+entry.failures.map(f=>E(f.name+'：'+f.message)).join('；')+' <button class="link" onclick="'+action(s.segment,'retry')+'">重试未完成平台</button></div>':'';
   const selection=daily?'<p class="analysis-status">'+E(s.provider)+' · 按成功日期对比 <button class="link" onclick="'+action(s.segment,'provider')+'">返回全部三方</button></p>':'';
   if(!entry)return {before:selection+'<p class="muted">点击三方展开，读取当前耗时档的三方汇总。</p>',headers:[],rows:[]};
   if(!entry.results.size)return {before:selection+progress+failures+(entry.loading||entry.failures.length?'':'<p class="muted">当前范围没有可读取的平台。</p>'),headers:[],rows:[]};
   if(![...entry.results.values()].every(providerReady))return {before:selection+progress+failures+'<p class="live-status live-error">来源尚未返回三方耗时分档；不能用全局成功数据推算。</p>',headers:[],rows:[]};
   const query=s.segment.placement==='duration-groups'?String(L.durationQuery||'').trim().toLowerCase():'',records=providerRows(s,daily).filter(r=>!query||String(r.provider).toLowerCase().includes(query)),bandRows=[...entry.results.values()].flatMap(r=>daily?r.groups?.daily||[]:r.summary||[]).filter(r=>dirs(s.segment).includes(r.direction)&&(!r.currency||r.currency===L.currency));
   const band=(direction,date)=>{const rows=bandRows.filter(r=>r.direction===direction&&(!daily||r.date===date));return {count:sum(rows,'count'),amount:sum(rows,'amount')}};
   const dayComplete=(direction,date)=>complete&&[...entry.results.values()].every(result=>(result.groups?.daily||[]).some(r=>r.date===date&&r.direction===direction&&(!r.currency||r.currency===L.currency)));
   if(daily)for(const date of dates())for(const direction of dirs(s.segment))if(!records.some(r=>r.date===date&&r.direction===direction)){const value=dayComplete(direction,date)?0:null;records.push({date,direction,provider:s.provider,count:value,amount:value,valid_count:value,valid_amount:value})}
   records.sort((a,b)=>daily?String(a.date).localeCompare(String(b.date))||a.direction.localeCompare(b.direction):Number(b.count||0)-Number(a.count||0)||String(a.provider).localeCompare(String(b.provider))||a.direction.localeCompare(b.direction));
   const visible=daily?records:records.filter(r=>!finite(r.count)||Number(r.count)>0),rows=visible.map(r=>{const total=band(r.direction,r.date),ready=daily?dayComplete(r.direction,r.date):complete,ratio=(a,b)=>ready?R(a,b):'—';return [E(daily?r.date:r.provider||'未识别三方')+(daily&&!ready?'<small class="analysis-metric-share">当日来源未完整返回</small>':''),...(extra?[name(r.direction)]:[]),N(r.amount),ratio(r.amount,total.amount),C(r.count),ratio(r.count,total.count),C(r.valid_count),ratio(r.count,r.valid_count),...(!daily&&multi()?['<button class="link" onclick="'+action(s.segment,'providerDaily',r.provider)+'">查看每天</button>']:[])]});
   const note='档内占比 = 该三方'+(daily?'当日':'')+'本档成功金额 / 笔数 ÷ 同方向'+(daily?'当日':'')+'本档合计；'+label+' = 该三方本档笔数 ÷ '+scopeLabel+'。'+(s.segment.cumulative?'当前档为严格超过指定时长；累计档之间不能相加。':'互斥分档；快档的落档率不表示慢单率。')+' 多天汇总先合计笔数再计算比例，不能平均每天的比例。'+(daily?' 未返回的日期显示 —，不补成 0。':'')+(!complete?' 本次分档数据未收齐，比例暂不计算。':' 按本次完整分档汇总计算；每日对比复用同次数据。');
   return {before:selection+progress+failures+(complete&&!visible.length?'<p class="muted">'+(query?'当前搜索没有命中的三方。':'当前分档没有命中的三方。')+'</p>':''),headers,rows,after:'<div class="analysis-note">'+note+'</div>'};
  }
  function providerBody(s){const grid=providerGrid(s);return grid.before+(grid.headers.length?smallTable(grid.headers,grid.rows):'')+(grid.after||'')}
  function platformGrid(s,aligned=false){
   let rows=platformRows(s.segment);const latency=s.segment.kind==='latency',by=Object.fromEntries(dirs(s.segment).map(d=>[d,totals(rows.filter(r=>r.direction===d))]));
   if(s.segment.placement==='duration-groups'&&L.durationQuery){const query=String(L.durationQuery).trim().toLowerCase();rows=rows.filter(r=>String(r.platform).toLowerCase().includes(query))}
   rows.sort((a,b)=>Number(b.success_amount||0)-Number(a.success_amount||0)||String(a.platform).localeCompare(String(b.platform))||String(a.source).localeCompare(String(b.source)));
   const extraDirection=dirs(s.segment).length>1,hasAction=multi()||aligned;
   return {headers:['平台','包网',...(extraDirection?['方向']:[]),...metricHeaders(latency),...(hasAction?['每日对比']:[])],rows:rows.map(r=>[E(r.platform),E(r.source),...(extraDirection?[name(r.direction)]:[]),...metricCells(r,by[r.direction],latency),...(hasAction?[multi()?'<button class="link" onclick="'+action(s.segment,'platformDaily',r.platformId)+'">查看每天</button>':'']:[])])};
  }
  function platformBody(s){const grid=platformGrid(s);return smallTable(grid.headers,grid.rows);}
  const localDate=(value,zone)=>{try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)),get=k=>parts.find(p=>p.type===k)?.value;return get('year')+'-'+get('month')+'-'+get('day')}catch{return ''}};
  function dailyRows(s,entry){
   const latency=s.segment.kind==='latency',days=dates(),records=[];
   for(const date of days)for(const direction of dirs(s.segment)){
    const parts=[];let present=0;for(const result of entry.results.values()){
     const zone=result.platform.timezone||L.catalog.find(p=>p.id===result.platform.id)?.timezone;
     const first=localDate(result.startAt,zone),last=localDate(Date.parse(result.endAt)-1,zone);if(!first||date<first||date>last)continue;
     const matches=result.groups.daily.filter(r=>r.date===date&&r.direction===direction&&(!r.currency||r.currency===L.currency));
     if(matches.length){present++;parts.push(...matches.map(r=>latency?{...zero(),...r,success_amount:r.amount===undefined?r.success_amount:r.amount,success_count:r.count===undefined?r.success_count:r.count}:r));}
    }
    records.push({...totals(parts),date,direction,covered:parts.length>0,present,expected:entry.total,complete:present===entry.total&&!entry.loading&&!entry.failures.length});
   }return records;
  }
  function dailyGrid(s,aligned=false){
   const entry=s.daily.get(s.platform),platforms=L.results.map(r=>r.platform).filter(Boolean),control='<label>平台 <select aria-label="每日对比平台" onchange="liveAnalysisAction(\''+enc(s.segment)+'\',\'select\',encodeURIComponent(this.value))"><option value="all">全部平台</option>'+platforms.map(p=>'<option value="'+E(p.id)+'" '+(p.id===s.platform?'selected':'')+'>'+E(p.name)+' · '+E(p.source)+'</option>').join('')+'</select></label>';
   if(!entry)return {before:control+'<p class="muted">选择每日对比后读取对应日期汇总。</p>',headers:[],rows:[]};
   const progress=entry.loading?'<p class="analysis-status">每日对比读取 '+entry.results.size+' / '+entry.total+' 个平台…</p>':'';
   const failures=entry.failures.length?'<div class="live-status live-error">每日对比尚不完整：'+entry.failures.map(f=>E(f.name+'：'+f.message)).join('；')+' <button class="link" onclick="'+action(s.segment,'retry')+'">重试未完成平台</button></div>':'';
   if(!entry.results.size)return {before:control+progress+failures,headers:[],rows:[]};
   const rows=dailyRows(s,entry),latency=s.segment.kind==='latency',by=Object.fromEntries(dirs(s.segment).map(d=>[d,totals(rows.filter(r=>r.direction===d&&r.covered))])),extra=dirs(s.segment).length>1;
   const rendered=rows.map(r=>{const previous=rows.find(p=>p.direction===r.direction&&p.date===new Date(Date.parse(r.date+'T00:00Z')-86400000).toISOString().slice(0,10)),delta=r.complete&&previous?.complete&&finite(r.success_amount)&&Number(previous.success_amount)>0?((Number(r.success_amount)-Number(previous.success_amount))/Number(previous.success_amount)*100).toFixed(2)+'%':'—',coverage=r.covered?(r.complete?'已返回':r.present+' / '+r.expected+' 平台有记录'):'未返回记录';return [E(r.date)+(aligned?'':'<small class="analysis-metric-share">'+coverage+'</small>'),...(extra?[name(r.direction)]:aligned?[coverage]:[]),...(r.covered?metricCells(r,by[r.direction],latency):metricHeaders(latency).map(()=> '—')),delta]});
   return {before:control+progress+failures,headers:['日期',...(extra?['方向']:aligned?['数据状态']:[]),...metricHeaders(latency),'成功金额较前日'],rows:rendered,after:'<div class="analysis-note">按各平台当地日期；占比以当前平台范围、当前段、同方向的已读日期合计为分母。没有返回记录的日期显示 —，不补成 0；平台记录不齐时不比较增减。首尾日期按所选起止时间，可能不足整日。</div>'};
  }
  function dailyBody(s){const grid=dailyGrid(s);return grid.before+(grid.headers.length?smallTable(grid.headers,grid.rows):'')+(grid.after||'');}
  function panelHead(s){return '<div class="analysis-drilldown-head"><strong>'+E(s.label||'区间明细')+' · '+E(L.from.slice(0,10))+' 至 '+E(L.to.slice(0,10))+'</strong><div class="tabs">'+(s.segment.kind==='latency'?'<button class="'+(providerTab(s)?'on':'')+'" onclick="'+action(s.segment,'provider')+'">各三方占比</button>':'')+'<button class="'+(s.tab==='platform'?'on':'')+'" onclick="'+action(s.segment,'platform')+'">各平台占比</button>'+(multi()?'<button class="'+(s.tab==='daily'?'on':'')+'" onclick="'+action(s.segment,'daily')+'">'+(s.segment.kind==='latency'?'平台':'')+'每日对比</button>':'')+'</div></div>'+(L.queryFailures?.length?'<div class="analysis-status">当前主表有 '+C(L.queryFailures.length)+' 个平台未读取；'+(providerTab(s)?'三方比例暂不计算。':'以下占比仅含已读平台。')+'</div>':'');}
  function panelNote(segment){return '<div class="analysis-note">'+(segment.kind==='latency'?'成功金额、笔数按成功时间；耗时为成功时间减提交／创建时间。':'全部及处理中按创建时间；成功金额、笔数按成功时间；成功率为本期成功笔数 / 本期创建笔数，含跨日成功时可能超过 100%。')+' 平台占比以此段同方向合计为分母。</div>';}
  function panel(segment,label){const s=state(segment,label);if(!s.open)return '';return '<div class="analysis-drilldown">'+panelHead(s)+(providerTab(s)?providerBody(s):s.tab==='daily'&&multi()?dailyBody(s):platformBody(s))+(providerTab(s)?'':panelNote(segment))+'</div>';}
  function alignedPanel(segment,label,columnCount){
   const s=state(segment,label);if(!s.open)return '';
   const grid=s.tab==='daily'&&multi()?dailyGrid(s,true):platformGrid(s,true),full=body=>'<tr class="analysis-expanded-row analysis-aligned-caption"><td colspan="'+columnCount+'"><div class="analysis-drilldown">'+body+'</div></td></tr>';
   return full(panelHead(s)+(grid.before||''))+(grid.headers.length?'<tr class="analysis-aligned-head">'+grid.headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr>'+grid.rows.map(row=>'<tr class="analysis-aligned-item">'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join(''):'')+full((grid.after||'')+panelNote(segment));
  }
  function table(config){
   sync();const aligned=config.headers.length===11&&config.headers[0]==='方向'&&config.headers[2]==='全部金额',columnCount=config.headers.length+1;
   return '<div class="table-wrap analysis-expand-table'+(aligned?' analysis-aligned-table':'')+'"><table><thead><tr>'+[...config.headers,config.exclusive?'整段明细':'明细'].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+config.rows.map(row=>{
    const segment=config.segment(row),label=config.label(row),selection=config.rowDetail?.(row);let selected=segment,selectedLabel=label;
    if(selection){const chosen=state(selection.segment,selection.label);if(config.exclusive)chosen.exclusiveGroup=config.exclusive;if(chosen.open){selected=selection.segment;selectedLabel=selection.label;}}
    const detail=aligned?alignedPanel(selected,selectedLabel,columnCount):panel(selected,selectedLabel);
    return '<tr'+(selection&&JSON.stringify(selected)!==JSON.stringify(segment)?' class="analysis-matrix-selected-row"':'')+'>'+[...config.cells(row),button(segment,label,config.exclusive)].map(v=>'<td>'+v+'</td>').join('')+'</tr>'+(detail?(aligned?detail:'<tr class="analysis-expanded-row"><td colspan="'+columnCount+'">'+detail+'</td></tr>'):'');
   }).join('')+'</tbody>'+(config.footerRows?.length?'<tfoot>'+config.footerRows.map(r=>'<tr>'+[...r,''].map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tfoot>':'')+'</table></div>';
  }
  async function load(s,retry=false){
   sync();if(!s.open||L.loading||L.dirty)return;
   const needsProviders=providerTab(s);let entry=s.daily.get(s.platform);if(entry&&!retry&&(!needsProviders||[...entry.results.values()].every(providerReady)))return;
   if(!entry){entry={results:new Map(),failures:[],loading:false,total:0};s.daily.set(s.platform,entry)}
   if(needsProviders)for(const [id,result]of entry.results)if(!providerReady(result))entry.results.delete(id);
   if(needsProviders)for(const other of s.daily.values())for(const [id,result]of other.results)if(providerReady(result)&&!entry.results.has(id))entry.results.set(id,result);
   const candidates=L.results.map(r=>L.catalog.find(p=>p.id===r.platform?.id)||r.platform).filter(p=>p?.id&&(s.platform==='all'||p.id===s.platform)),pending=candidates.filter(p=>!entry.results.has(p.id)),requests=pending.map(p=>{try{return {p,q:{...c.query(p,'aggregate'),view:'drilldown',kind:s.segment.kind,...(s.segment.hour===undefined?{}:{hour:s.segment.hour}),...(s.segment.bucket===undefined?{}:{bucket:s.segment.bucket}),...(s.segment.cumulative===undefined?{}:{cumulative:s.segment.cumulative}),direction:s.segment.direction,offset:0}}}catch(error){return {p,error}}});
   for(const other of states.values())for(const old of other.daily.values())if(old.loading&&old!==entry){old.loading=false;old.failures.push({name:'读取',message:'已切换查看范围，请重试继续读取'})}entry.total=candidates.length;entry.failures=[];entry.loading=true;const gen=generation,token=++active,key=scope;let index=0;c.render();
   async function worker(){while(index<requests.length&&gen===generation&&token===active){const {p,q,error}=requests[index++];try{if(error)throw error;const r=await requestSlot(q,()=>{sync();return gen===generation&&token===active&&key===scope});sync();if(gen!==generation||token!==active||key!==scope)return;if(r?.complete!==true||r?.hasMore!==false||!Array.isArray(r?.groups?.daily)||!Array.isArray(r?.summary)||(r.platform?.id&&r.platform.id!==p.id))throw Error('每日汇总未完整返回');if(needsProviders&&!providerReady(r))throw Error('三方耗时分档未完整返回');entry.results.set(p.id,{...r,platform:p,startAt:q.startAt,endAt:q.endAt});}catch(e){sync();if(gen!==generation||token!==active||key!==scope)return;entry.failures.push({id:p.id,name:p.name,message:e.message||'读取失败'})}c.render()}}
   await Promise.all(Array.from({length:Math.min(2,requests.length)},worker));if(gen!==generation||token!==active||key!==scope)return;entry.loading=false;c.render();
  }
  function pause(s){if([...s.daily.values()].some(entry=>entry.loading)){active++;for(const other of states.values())for(const entry of other.daily.values())if(entry.loading){entry.loading=false;entry.failures.push({name:'检查',message:'已收起或切换，请重试继续读取'})}}}
  root.liveAnalysisAction=function(encoded,op,value){let segment;try{segment=JSON.parse(decodeURIComponent(encoded))}catch{return}sync();const s=states.get(JSON.stringify(segment));if(!s)return;const decoded=value===undefined?'':decodeURIComponent(value);if(s.segment.kind==='latency'&&['provider','toggleProvider','providerDaily'].includes(op)){const close=op==='toggleProvider'&&s.open&&providerTab(s);s.open=!close;if(close)pause(s);else{s.tab=op==='providerDaily'?'providerDaily':'provider';s.platform='all';if(op==='providerDaily')s.provider=decoded;void load(s)}}else if(s.segment.kind==='latency'&&op==='togglePlatform'){const close=s.open&&s.tab==='platform';pause(s);s.open=!close;s.tab='platform'}else if(op==='toggle'){s.open=!s.open;if(s.open&&s.exclusiveGroup)for(const other of states.values())if(other!==s&&other.exclusiveGroup===s.exclusiveGroup)other.open=false;if(!s.open)pause(s)}else if(op==='platform'){if(s.segment.kind==='latency')pause(s);s.tab='platform'}else if(op==='daily'||op==='platformDaily'||op==='select'){s.open=true;s.tab='daily';if(op!=='daily')s.platform=decoded||'all';void load(s)}else if(op==='retry'){void load(s,true)}c.render()};
  return {table,button,dimensionButton,panel,platformRows,isOpen(segment){sync();return states.get(JSON.stringify(segment))?.open===true},snapshot:()=>({scope,states}),open(segment,label,exclusiveGroup){const s=state(segment,label);if(exclusiveGroup){s.exclusiveGroup=exclusiveGroup;for(const other of states.values())if(other!==s&&other.exclusiveGroup===exclusiveGroup)other.open=false;}s.open=true;c.render()}};
 }
 root.HensemAnalysisDrilldown={create};
})(typeof window==='object'?window:globalThis);
