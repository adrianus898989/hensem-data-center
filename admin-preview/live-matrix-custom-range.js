/* Independent amount interval: never re-bucket or replace the main aggregates. */
(function(root){
 'use strict';
 const fields=['all_count','all_amount','success_count','success_amount'];
 const detailFields=[...fields,'created_success_count','pending_count','pending_amount','failed_count','failed_amount','rejected_count','rejected_amount','unknown_count','unknown_amount'];
 const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
 const zero=()=>Object.fromEntries(fields.map(key=>[key,0]));
 function create(c){
  const {L,E,N,C,R}=c;let generation=0,inflight=0;const waiters=[];
  const blank=()=>({min:'',max:'',hourMin:'0',hourMax:'24',hourApplied:null,editing:null,applied:null,results:new Map(),targets:[],failures:[],loading:false,error:'',scope:''});let S=blank();
  const signature=()=>JSON.stringify([L.serial,L.queryScope,L.queryNow,L.country,L.currency,L.from,L.to,L.direction,L.status,(L.queryPlatforms||[]).map(p=>[p.id,p.currency])]);
  function sync(){const key=signature();if(S.scope!==key){generation++;S={...blank(),min:S.min,max:S.max,scope:key}}return key}
  function cancel(){generation++;if(S.loading){S.loading=false;S.error='区间读取已暂停，请重新查询区间。'}}
  function capture(){sync();cancel();return {...S,editing:null,results:new Map(S.results),targets:S.targets.slice(),failures:S.failures.slice()}}
  function restore(saved){generation++;S=saved?{...saved,loading:false,scope:signature(),results:new Map(saved.results),targets:saved.targets.slice(),failures:saved.failures.slice()}:{...blank(),scope:signature()}}
  const currencyIssue=()=>{const currencies=new Set((c.selected()||[]).map(p=>p.currency).filter(Boolean));return currencies.size>1||currencies.size===1&&!currencies.has(L.currency)};
  const amountPage=()=>['matrix','amount'].includes(c.page());
  const blocked=()=>!['matrix','amount','time'].includes(c.page())||!L.pageQueried||L.loading||L.queryRetrying||L.dirty;
  function parse(){
   const result={};for(const [key,value]of [['amountMin',S.min],['amountMax',S.max]]){if(!String(value).trim())continue;const n=Number(value);if(!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER)throw Error('金额须为大于或等于 0 的有效数字。');result[key]=n}
   if(!Object.keys(result).length)throw Error('请填写最低金额或最高金额。');if(result.amountMin!==undefined&&result.amountMax!==undefined&&result.amountMin>=result.amountMax)throw Error('最低金额必须小于最高金额。');if(result.amountMax!==undefined)result.amountMaxExclusive=true;return result;
  }
  const label=range=>!range?'点击设置区间':range.amountMin===undefined?'金额 < '+N(range.amountMax):range.amountMax===undefined?'金额 ≥ '+N(range.amountMin):N(range.amountMin)+' ≤ 金额 < '+N(range.amountMax);
  async function slot(q,serial,current){while(inflight>=2){await new Promise(resolve=>waiters.push(resolve));if(!current())return null}if(!current())return null;inflight++;try{return await c.request(q,serial)}finally{inflight--;for(const wake of waiters.splice(0))wake()}}
  function validate(result,p){
   if(!result||result.complete===false||result.platform?.id&&result.platform.id!==p.id)throw Error('平台返回不匹配');
   if(result._parts!==undefined&&(!Array.isArray(result._parts)||!result._parts.length))throw Error('小时汇总未完整返回');
   for(const part of result._parts||[result]){if(part.complete===false||!Array.isArray(part.summary)||!Array.isArray(part.groups?.hourly)||part.groups.hourly.some(row=>!finite(row.hour)||!Number.isInteger(Number(row.hour))||Number(row.hour)<0||Number(row.hour)>23))throw Error('小时汇总未完整返回');}
   return result;
  }
  root.liveMatrixAmountSet=function(key,value){if(!['min','max'].includes(key)||!amountPage())return;sync();S[key]=String(value).slice(0,60)};
  root.liveMatrixAmountEdit=function(direction){if(!['charge','withdraw'].includes(direction)||c.page()!=='matrix'||c.allowed&&!c.allowed())return;sync();S.editing=S.editing===direction?null:direction;c.render();root.document?.querySelector('.matrix-custom-dialog input')?.focus()};
  root.liveMatrixAmountClose=function(){sync();const direction=S.editing;S.editing=null;c.render();if(direction)root.document?.querySelector('[data-matrix-custom-direction="'+direction+'"]')?.focus()};
  root.liveMatrixAmountDialogKey=function(event){if(event.key==='Escape'){event.preventDefault();root.liveMatrixAmountClose();return}if(event.key!=='Tab')return;const controls=[...(root.document?.querySelector('.matrix-custom-dialog')?.querySelectorAll('input:not(:disabled),button:not(:disabled),select:not(:disabled)')||[])],first=controls[0],last=controls.at(-1);if(event.shiftKey&&root.document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&root.document.activeElement===last){event.preventDefault();first?.focus()}};
  root.liveMatrixAmountClear=function(){if(!amountPage())return;generation++;S={...blank(),scope:signature()};c.render()};
  root.liveMatrixAmountQuery=async function(form,event){
   if(event){if(event.key!=='Enter'||event.isComposing||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.target?.tagName!=='INPUT')return;event.preventDefault()}
   if(!amountPage()||blocked()||S.loading||c.allowed&&!c.allowed())return;sync();let range;try{if(form?.reportValidity&&!form.reportValidity())return;for(const key of ['min','max']){const input=form?.elements?.namedItem('matrix-'+key);if(input)S[key]=String(input.value).slice(0,60)}if(currencyIssue())throw Error('请先选择同一币种的平台，再查询自定义金额。');range=parse()}catch(error){S.error=error.message;c.render();return}
   const scope=S.scope,serial=L.serial,token=++generation,targets=(c.selected()||[]).filter(p=>!p.currency||p.currency===L.currency);
   const page=c.page();S={...S,applied:range,results:new Map(),targets,failures:[],loading:true,error:''};const entry=S,current=()=>generation===token&&entry===S&&signature()===scope&&c.page()===page;
   const requests=targets.map(p=>{try{return {p,q:{...c.query(p,'aggregate'),view:'full',offset:0,...range}}}catch(error){return {p,error}}});let index=0;c.render();
   async function worker(){while(index<requests.length&&current()){const {p,q,error}=requests[index++];try{if(error)throw error;const result=await slot(q,serial,current);if(!current())return;entry.results.set(p.id,{...validate(result,p),platform:p})}catch(error){if(!current())return;entry.failures.push({name:p.name||p.id,message:error.message||'读取失败'})}c.render()}}
   await Promise.all(Array.from({length:Math.min(2,requests.length)},worker));if(!current())return;entry.loading=false;if(!targets.length)entry.error='当前范围没有可查询的订单平台。';else if(!entry.failures.length)entry.editing=null;c.render();
  };
  function editor(direction){
   const disabled=blocked()||S.loading||currencyIssue()||c.allowed&&!c.allowed();
   return '<form class="matrix-custom-controls" aria-label="自定义金额区间" onsubmit="return false" onkeydown="liveMatrixAmountQuery(this,event)"><strong>自定义金额</strong>'+['min','max'].map(key=>'<label>'+(key==='min'?'最低金额（含）':'最高金额（不含）')+'<input type="number" name="matrix-'+key+'" min="0" step="any" aria-label="自定义'+(key==='min'?'最低':'最高')+'金额" placeholder="不限" value="'+E(S[key])+'" '+(S.loading?'disabled ':'')+'oninput="liveMatrixAmountSet(\''+key+'\',this.value)"></label>').join('')+'<button type="button" class="btn small" onclick="liveMatrixAmountQuery(this.form)" '+(disabled?'disabled':'')+'>'+(S.loading?'读取区间…':S.failures.length||S.error?'重试区间':'查询区间')+'</button><button type="button" class="btn small" onclick="liveMatrixAmountClear()">清空区间</button><small>'+(currencyIssue()?'请先选择同一币种的平台':'下限含，上限不含 · 独立统计')+'</small></form>';
  }
  function status(){return (S.error?'<div role="alert" class="matrix-custom-status live-error">'+E(S.error)+'</div>':'')+(S.failures.length?'<div role="alert" class="matrix-custom-status live-error">'+S.failures.map(f=>E(f.name+'：'+f.message)).join('；')+'；重新查询区间可重试。</div>':'')}
  function controls(){
   sync();return editor()+status();
  }
  function dialog(){sync();if(!S.editing)return '';return '<div class="matrix-custom-dialog-backdrop" onclick="if(event.target===this)liveMatrixAmountClose()" onkeydown="liveMatrixAmountDialogKey(event)"><section class="matrix-custom-dialog" role="dialog" aria-modal="true" aria-label="编辑自定义金额区间"><div class="matrix-custom-dialog-title"><strong>编辑自定义金额</strong><button type="button" class="btn small" onclick="liveMatrixAmountClose()">关闭</button></div>'+editor()+status()+'</section></div>';}
  root.liveAnalysisHourSet=function(key,value){if(c.page()!=='time'||!['hourMin','hourMax'].includes(key))return;sync();S[key]=String(value)};
  root.liveAnalysisHourQuery=function(){if(c.page()!=='time'||blocked()||c.allowed&&!c.allowed())return;sync();const min=Number(S.hourMin),max=Number(S.hourMax);if(!String(S.hourMin).trim()||!String(S.hourMax).trim()||!Number.isInteger(min)||!Number.isInteger(max)||min<0||max>24||min>=max){S.error='请选择有效时段：起始小时须小于结束小时（0–24）。';c.render();return}S.hourApplied={minHour:min,maxHour:max};S.error='';c.render()};
  root.liveAnalysisHourClear=function(){if(c.page()!=='time')return;sync();S.hourApplied=null;S.error='';c.render()};
  function hourControls(){sync();const disabled=blocked()||c.allowed&&!c.allowed(),options=(key)=>Array.from({length:25},(_,hour)=>'<option value="'+hour+'" '+(Number(S[key])===hour?'selected':'')+'>'+String(hour).padStart(2,'0')+':00</option>').join('');return '<section class="analysis-custom-query"><div class="matrix-custom-controls"><strong>自定义时段</strong><label>起始小时（含）<select aria-label="自定义起始小时" onchange="liveAnalysisHourSet(\'hourMin\',this.value)">'+options('hourMin')+'</select></label><label>结束小时（不含）<select aria-label="自定义结束小时" onchange="liveAnalysisHourSet(\'hourMax\',this.value)">'+options('hourMax')+'</select></label><button type="button" class="btn small" onclick="liveAnalysisHourQuery()" '+(disabled?'disabled':'')+'>查询区间</button><button type="button" class="btn small" onclick="liveAnalysisHourClear()">清空区间</button><small>平台当地时间 · 下限含，上限不含 · 主统计不变</small></div>'+status()+summary('time')+'</section>';}
  function segment(direction){return {kind:'custom',direction,...(c.page()==='time'?{hourRange:S.hourApplied}:S.applied),placement:'analysis-custom-'+c.page()};}
  function customResults(selectedSegment){
   sync();const time=!!selectedSegment.hourRange,range=time?S.hourApplied:S.applied;
   if(!range||JSON.stringify(range)!==JSON.stringify(time?selectedSegment.hourRange:Object.fromEntries(Object.entries(selectedSegment).filter(([key])=>['amountMin','amountMax','amountMaxExclusive'].includes(key)))))return null;
   const results=time?L.results:[...S.results.values()],complete=time?!L.queryFailures?.length&&!L.queryWarnings?.length&&!L.queryPaused&&!L.loading&&results.length===(c.selected()||[]).length:!S.loading&&!S.error&&!S.failures.length&&results.length===S.targets.length;
   return {results,complete};
  }
  function detailRows(selectedSegment){
   const entry=customResults(selectedSegment);if(!entry)return [];
   const directions=selectedSegment.direction==='all'?['charge','withdraw']:[selectedSegment.direction];
   return entry.results.flatMap(result=>directions.map(direction=>{const parts=result._parts||[result],valid=parts.every(part=>part.complete!==false&&Array.isArray(part.groups?.hourly)),rows=parts.flatMap(part=>part.groups?.hourly||[]).filter(row=>row.direction===direction&&(!row.currency||row.currency===L.currency)&&finite(row.hour)&&Number.isInteger(Number(row.hour))&&Number(row.hour)>=0&&Number(row.hour)<24&&(!selectedSegment.hourRange||Number(row.hour)>=selectedSegment.hourRange.minHour&&Number(row.hour)<selectedSegment.hourRange.maxHour)),metric=Object.fromEntries(detailFields.map(key=>[key,!valid||rows.some(row=>!finite(row[key]))?null:rows.reduce((n,row)=>n+Number(row[key]),0)]));if(c.successUnavailable(direction)||direction==='withdraw'&&result.withdrawSuccessTimeAvailable===false){metric.success_count=null;metric.success_amount=null}return {...metric,_ready:entry.complete&&valid,platformId:result.platform?.id,platform:result.platform?.name||'未提供平台',source:result.platform?.source||'—',direction,currency:result.platform?.currency||L.currency};}));
  }
  function summary(page){
   sync();if(!(page==='time'?S.hourApplied:S.applied))return '';const directions=L.direction==='all'?['charge','withdraw']:[L.direction],rows=directions.map(direction=>{const selectedSegment=segment(direction),parts=detailRows(selectedSegment),values=Object.fromEntries(detailFields.map(key=>[key,!parts.length||parts.some(row=>!finite(row[key]))?null:parts.reduce((n,row)=>n+Number(row[key]),0)]));return {...values,direction,segment:selectedSegment};}),heading=page==='time'?String(S.hourApplied.minHour).padStart(2,'0')+':00 ≤ 时段 < '+String(S.hourApplied.maxHour).padStart(2,'0')+':00':label(S.applied),headers=['方向','自定义区间','全部金额','全部笔数','成功金额','成功笔数','处理中金额','处理中笔数','失败金额','失败笔数','成功率'],cells=row=>[row.direction==='withdraw'?'代付':'代收',E(heading),N(row.all_amount),C(row.all_count),N(row.success_amount),C(row.success_count),N(row.pending_amount),C(row.pending_count),N(row.failed_amount),C(row.failed_count),customResults(row.segment)?.complete?R(row.success_count,row.all_count):'—'];
   return c.analysis?.table?c.analysis.table({id:'custom-'+page,headers,rows,cells,segment:row=>row.segment,label:()=>heading}):'';
  }
  function footerDetail(direction){sync();return S.applied?{segment:segment(direction),label:label(S.applied)+' · 24小时合计'}:null;}
  function pageControls(page){return page==='time'?hourControls():'<section class="analysis-custom-query">'+controls()+summary('amount')+'</section>';}
  function metric(direction,hour){
   const values=[...S.results.values()],ready=S.applied&&values.length>0,complete=ready&&!S.loading&&!S.error&&!S.failures.length&&values.length===S.targets.length;
   if(!ready)return {data:Object.fromEntries(fields.map(key=>[key,null])),complete:false};
   // Use original parts: merged groups can otherwise conceal a missing metric.
   const rows=values.flatMap(result=>(result._parts||[result]).flatMap(part=>part.groups.hourly)).filter(row=>row.direction===direction&&(!row.currency||row.currency===L.currency)&&finite(row.hour)&&finite(row.hour)&&Number.isInteger(Number(row.hour))&&Number(row.hour)>=0&&Number(row.hour)<24&&(hour===undefined||Number(row.hour)===hour));
   const data=zero();for(const key of fields)data[key]=rows.some(row=>!finite(row[key]))?null:rows.reduce((n,row)=>n+Number(row[key]),0);
   if(c.successUnavailable(direction)||values.some(r=>direction==='withdraw'&&(r.withdrawSuccessTimeAvailable===false||(r.capabilities||r.platform?.capabilities)?.withdrawSuccessTimeAvailable===false))){data.success_count=null;data.success_amount=null}
   return {data,complete};
  }
  function row(direction){
   sync();const suffix=S.loading?'读取 '+S.results.size+'/'+S.targets.length+' 平台':S.applied&&S.results.size<S.targets.length?'已读 '+S.results.size+'/'+S.targets.length+' 平台':'独立统计';
   const first='<button type="button" class="matrix-custom-edit" data-matrix-custom-direction="'+direction+'" aria-haspopup="dialog" aria-expanded="'+(S.editing===direction)+'" onclick="liveMatrixAmountEdit(\''+direction+'\')" '+(c.allowed&&!c.allowed()?'disabled':'')+'><span class="matrix-custom-label">自定义金额 · 编辑</span><span class="matrix-custom-label">'+E(label(S.applied))+'</span></button><small class="matrix-custom-label" role="status">'+E(suffix)+'</small>'+(S.error||S.failures.length?'<button type="button" class="link" onclick="liveMatrixAmountEdit(\''+direction+'\')">查看错误 / 重试</button>':'');
   const cells=Array.from({length:24},(_,hour)=>{const {data:r,complete}=metric(direction,hour);return '<div class="matrix-cell"><b>'+C(r.all_count)+'笔</b><span>'+N(r.all_amount).replace(/\.00$/,'')+'</span><span>'+(complete?R(r.success_count,r.all_count):'—')+'</span></div>'});
   const {data:r,complete}=metric(direction);return [first,...cells,'<div class="matrix-row-total">'+[['全部笔数',C(r.all_count)+' 笔'],['全部金额',N(r.all_amount)],['成功笔数',C(r.success_count)+' 笔'],['成功金额',N(r.success_amount)],['成功率',complete?R(r.success_count,r.all_count):'—']].map(([label,value])=>'<span><small>'+label+'</small><b>'+value+'</b></span>').join('')+'</div>'];
  }
  return {controls,row,dialog,pageControls,footerDetail,customResults,detailRows,cancel,capture,restore};
 }
 root.HensemMatrixCustomRange={create};
})(typeof window==='object'?window:globalThis);
