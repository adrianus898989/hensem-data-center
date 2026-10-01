/* Independent amount interval: never re-bucket or replace the main aggregates. */
(function(root){
 'use strict';
 const fields=['all_count','all_amount','success_count','success_amount'];
 const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
 const zero=()=>Object.fromEntries(fields.map(key=>[key,0]));
 function create(c){
  const {L,E,N,C,R}=c;let generation=0,inflight=0;const waiters=[];
  const blank=()=>({min:'',max:'',applied:null,results:new Map(),targets:[],failures:[],loading:false,error:'',scope:''});let S=blank();
  const signature=()=>JSON.stringify([L.serial,L.queryScope,L.queryNow,L.country,L.currency,L.from,L.to,L.direction,L.status,(L.queryPlatforms||[]).map(p=>[p.id,p.currency])]);
  function sync(){const key=signature();if(S.scope!==key){generation++;S={...blank(),min:S.min,max:S.max,scope:key}}return key}
  function cancel(){generation++;if(S.loading){S.loading=false;S.error='区间读取已暂停，请重新查询区间。'}}
  function capture(){sync();cancel();return {...S,results:new Map(S.results),targets:S.targets.slice(),failures:S.failures.slice()}}
  function restore(saved){generation++;S=saved?{...saved,loading:false,scope:signature(),results:new Map(saved.results),targets:saved.targets.slice(),failures:saved.failures.slice()}:{...blank(),scope:signature()}}
  const currencyIssue=()=>{const currencies=new Set((c.selected()||[]).map(p=>p.currency).filter(Boolean));return currencies.size>1||currencies.size===1&&!currencies.has(L.currency)};
  const blocked=()=>c.page()!=='matrix'||!L.pageQueried||L.loading||L.queryRetrying||L.dirty;
  function parse(){
   const result={};for(const [key,value]of [['amountMin',S.min],['amountMax',S.max]]){if(!String(value).trim())continue;const n=Number(value);if(!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER)throw Error('金额须为大于或等于 0 的有效数字。');result[key]=n}
   if(!Object.keys(result).length)throw Error('请填写最低金额或最高金额。');if(result.amountMin!==undefined&&result.amountMax!==undefined&&result.amountMin>result.amountMax)throw Error('最低金额不能大于最高金额。');return result;
  }
  const label=range=>!range?'待查询':range.amountMin===undefined?'金额 ≤ '+N(range.amountMax):range.amountMax===undefined?'金额 ≥ '+N(range.amountMin):N(range.amountMin)+' ≤ 金额 ≤ '+N(range.amountMax);
  async function slot(q,serial,current){while(inflight>=2){await new Promise(resolve=>waiters.push(resolve));if(!current())return null}if(!current())return null;inflight++;try{return await c.request(q,serial)}finally{inflight--;for(const wake of waiters.splice(0))wake()}}
  function validate(result,p){
   if(!result||result.complete===false||result.platform?.id&&result.platform.id!==p.id)throw Error('平台返回不匹配');
   if(result._parts!==undefined&&(!Array.isArray(result._parts)||!result._parts.length))throw Error('小时汇总未完整返回');
   for(const part of result._parts||[result]){if(part.complete===false||!Array.isArray(part.summary)||!Array.isArray(part.groups?.hourly)||part.groups.hourly.some(row=>!finite(row.hour)||!Number.isInteger(Number(row.hour))||Number(row.hour)<0||Number(row.hour)>23))throw Error('小时汇总未完整返回');}
   return result;
  }
  root.liveMatrixAmountSet=function(key,value){if(!['min','max'].includes(key)||c.page()!=='matrix')return;sync();S[key]=String(value).slice(0,60)};
  root.liveMatrixAmountClear=function(){if(c.page()!=='matrix')return;generation++;S={...blank(),scope:signature()};c.render()};
  root.liveMatrixAmountQuery=async function(form,event){
   if(event){if(event.key!=='Enter'||event.isComposing||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.target?.tagName!=='INPUT')return;event.preventDefault()}
   if(blocked()||S.loading||c.allowed&&!c.allowed())return;sync();let range;try{if(form?.reportValidity&&!form.reportValidity())return;if(currencyIssue())throw Error('请先选择同一币种的平台，再查询自定义金额。');range=parse()}catch(error){S.error=error.message;c.render();return}
   const scope=S.scope,serial=L.serial,token=++generation,targets=(c.selected()||[]).filter(p=>!p.currency||p.currency===L.currency);
   S={...S,applied:range,results:new Map(),targets,failures:[],loading:true,error:''};const entry=S,current=()=>generation===token&&entry===S&&signature()===scope&&c.page()==='matrix';
   const requests=targets.map(p=>{try{return {p,q:{...c.query(p,'aggregate'),view:'full',offset:0,...range}}}catch(error){return {p,error}}});let index=0;c.render();
   async function worker(){while(index<requests.length&&current()){const {p,q,error}=requests[index++];try{if(error)throw error;const result=await slot(q,serial,current);if(!current())return;entry.results.set(p.id,{...validate(result,p),platform:p})}catch(error){if(!current())return;entry.failures.push({name:p.name||p.id,message:error.message||'读取失败'})}c.render()}}
   await Promise.all(Array.from({length:Math.min(2,requests.length)},worker));if(!current())return;entry.loading=false;if(!targets.length)entry.error='当前范围没有可查询的订单平台。';c.render();
  };
  function controls(){
   sync();return '<form class="matrix-custom-controls" aria-label="自定义金额区间" onsubmit="return false" onkeydown="liveMatrixAmountQuery(this,event)"><strong>自定义金额</strong><label>最低金额<input type="number" min="0" step="any" aria-label="自定义最低金额" placeholder="不限" value="'+E(S.min)+'" oninput="liveMatrixAmountSet(\'min\',this.value)"></label><span>至</span><label>最高金额<input type="number" min="0" step="any" aria-label="自定义最高金额" placeholder="不限" value="'+E(S.max)+'" oninput="liveMatrixAmountSet(\'max\',this.value)"></label><button type="button" class="btn small" onclick="liveMatrixAmountQuery(this.form)" '+(blocked()||S.loading||currencyIssue()?'disabled':'')+'>'+(S.loading?'读取区间…':'查询区间')+'</button><button type="button" class="btn small" onclick="liveMatrixAmountClear()">清空区间</button><small>'+(currencyIssue()?'请先选择同一币种的平台':'含上下限 · 独立统计，不计入固定分档合计')+'</small></form>'+(S.error?'<div role="alert" class="matrix-custom-status live-error">'+E(S.error)+'</div>':'')+(S.failures.length?'<div role="alert" class="matrix-custom-status live-error">'+S.failures.map(f=>E(f.name+'：'+f.message)).join('；')+'；重新查询区间可重试。</div>':'');
  }
  function metric(direction,hour){
   const values=[...S.results.values()],ready=S.applied&&values.length>0,complete=ready&&!S.loading&&!S.error&&!S.failures.length&&values.length===S.targets.length;
   if(!ready)return {data:Object.fromEntries(fields.map(key=>[key,null])),complete:false};
   // Use original parts: merged groups can otherwise conceal a missing metric.
   const rows=values.flatMap(result=>(result._parts||[result]).flatMap(part=>part.groups.hourly)).filter(row=>row.direction===direction&&(!row.currency||row.currency===L.currency)&&finite(row.hour)&&Number.isInteger(Number(row.hour))&&Number(row.hour)>=0&&Number(row.hour)<24&&(hour===undefined||Number(row.hour)===hour));
   const data=zero();for(const key of fields)data[key]=rows.some(row=>!finite(row[key]))?null:rows.reduce((n,row)=>n+Number(row[key]),0);
   if(c.successUnavailable(direction)||values.some(r=>direction==='withdraw'&&(r.withdrawSuccessTimeAvailable===false||(r.capabilities||r.platform?.capabilities)?.withdrawSuccessTimeAvailable===false))){data.success_count=null;data.success_amount=null}
   return {data,complete};
  }
  function row(direction){
   sync();const suffix=S.loading?'读取 '+S.results.size+'/'+S.targets.length+' 平台':S.applied&&S.results.size<S.targets.length?'已读 '+S.results.size+'/'+S.targets.length+' 平台':'独立统计';
   const first='<span class="matrix-custom-label">自定义金额</span><span class="matrix-custom-label">'+E(label(S.applied))+'</span><small class="matrix-custom-label">'+E(suffix)+'</small>';
   const cells=Array.from({length:24},(_,hour)=>{const {data:r,complete}=metric(direction,hour);return '<div class="matrix-cell"><b>'+C(r.all_count)+'笔</b><span>'+N(r.all_amount).replace(/\.00$/,'')+'</span><span>'+(complete?R(r.success_count,r.all_count):'—')+'</span></div>'});
   const {data:r}=metric(direction);return [first,...cells,'<div class="matrix-row-total">'+[['全部笔数',C(r.all_count)+' 笔'],['全部金额',N(r.all_amount)],['成功笔数',C(r.success_count)+' 笔'],['成功金额',N(r.success_amount)]].map(([label,value])=>'<span><small>'+label+'</small><b>'+value+'</b></span>').join('')+'</div>'];
  }
  return {controls,row,cancel,capture,restore};
 }
 root.HensemMatrixCustomRange={create};
})(typeof window==='object'?window:globalThis);
