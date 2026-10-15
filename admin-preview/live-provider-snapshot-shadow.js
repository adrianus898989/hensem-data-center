/* Explicit published-snapshot verification. No automatic load, compute or fallback. */
(function(root){
 'use strict';
 const components=['orders','submission','intake'],uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
 const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const error=(message,code)=>Object.assign(new Error(message),{code});
 const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
 const denied=e=>['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(e?.code);
 function allowed(c){const a=c?.access;return c?.enabled===true&&c.page==='providers'&&a?.canView===true&&(['owner','legacy'].includes(a.mode)||a.mode==='assigned'&&['providers.view','providers.query'].every(p=>a.permissions?.includes(p)));}
 function identity(c){
  const catalog=(c?.catalog||[]).filter(supported).map(p=>[p.id.toLowerCase(),p.source,p.scopeGroup||p.scope_group,p.sourceName||p.source_name,p.currency,p.timezone]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([c?.enabled,c?.page,c?.scope?.identity,c?.scope?.mode,c?.access?.mode,c?.access?.canView,c?.access?.roleId,c?.access?.version,c?.access?.assignmentVersion,[...(c?.access?.permissions||[])].sort(),catalog]);
 }
 function supported(p){return p&&uuid.test(p.id)&&['ar','newar','kb'].includes(p.source)&&p.currency==='INR'&&['Asia/Kolkata','Asia/Calcutta'].includes(p.timezone)&&(p.scopeGroup==='IN'||p.scope_group==='IN');}
 function closedRequest(platformIds,day,context,now){
  if(!allowed(context))throw error('当前账号没有快照核验权限','ROLE_DENIED');
  const ids=Array.isArray(platformIds)?platformIds:[platformIds];
  if(ids.length<1||ids.length>50||ids.some(id=>typeof id!=='string'||!context.catalog?.some(p=>supported(p)&&p.id.toLowerCase()===id.toLowerCase()))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw error('请选择当前可见目录中的印度平台','SNAPSHOT_INPUT');
  const today=new Date(now+19800000).toISOString().slice(0,10);
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||day>=today)throw error('核验先使用已结束的印度日期','SNAPSHOT_INPUT');
  return {action:'providerSnapshot',version:1,platformIds:ids.map(id=>id.toLowerCase()),startAt:day+'T00:00:00',endAt:day+'T23:59:59',direction:'charge',status:'all',currency:'INR',components:[...components],export:false};
 }
 function validate(result,request){
  const invalid=()=>{throw error('已发布快照响应不完整，请重新核验','SNAPSHOT_INVALID_RESPONSE');};
  if(!object(result)||result.version!==1||result.mode!=='published_snapshot'||!['ready','missing','stale','building','unsupported'].includes(result.status)||typeof result.complete!=='boolean'||!object(result.requested)||result.requested.startAt!==request.startAt||result.requested.endAt!==request.endAt||!Array.isArray(result.platforms)||!Array.isArray(result.missing)||result.rates?.status!=='not_loaded'||result.workorders?.status!=='not_loaded')invalid();
  if(result.complete!==(result.status==='ready')||result.complete&&result.missing.length||result.computedAt!==null&&!iso(result.computedAt)||result.nextDueAt!==null&&!iso(result.nextDueAt))invalid();
  const seen=new Set(),expected=request.platformIds;
  if(result.status==='unsupported'){if(result.complete||result.platforms.length||result.window!==null||result.publishedCutoff!==null||result.cutoffEpochMs!==null)invalid();return result;}
  if(result.platforms.length!==expected.length)invalid();
  if(result.window===null){if(result.publishedCutoff!==null||result.cutoffEpochMs!==null||result.complete)invalid();}
  else{
   const w=result.window;
   if(!object(w)||w.timezone!=='Asia/Kolkata'||!['startAt','endAt','previousStartAt','previousEndAt'].every(k=>iso(w[k]))||!iso(result.publishedCutoff)||w.endAt!==result.publishedCutoff||!Number.isSafeInteger(result.cutoffEpochMs)||Date.parse(w.endAt)!==result.cutoffEpochMs)invalid();
   const from=Date.parse(request.startAt+'+05:30'),to=Date.parse(request.endAt+'+05:30')+1000;
   if(Date.parse(w.startAt)!==from||Date.parse(w.endAt)<=from||Date.parse(w.endAt)>to||Date.parse(w.previousStartAt)!==from-86400000||Date.parse(w.previousEndAt)!==Date.parse(w.endAt)-86400000||w.localStartAt!==request.startAt||typeof w.localCutoff!=='string'||typeof w.previousLocalStartAt!=='string'||typeof w.previousLocalCutoff!=='string')invalid();
  }
  for(const p of result.platforms){
   const id=p?.platform?.id;if(!expected.includes(id)||seen.has(id)||!object(p.current)||!object(p.previous)||!Array.isArray(p.snapshots))invalid();seen.add(id);
   const meta=new Set();
   for(const s of p.snapshots){const key=s?.period+':'+s?.component;if(!object(s)||!uuid.test(s.snapshotId)||!components.includes(s.component)||!['current','previous'].includes(s.period)||s.period==='previous'&&s.component==='submission'||meta.has(key)||!iso(s.computedAt)||!iso(s.sourceReadStartedAt)||!iso(s.sourceReadCompletedAt)||Date.parse(s.sourceReadStartedAt)>Date.parse(s.sourceReadCompletedAt)||typeof s.upstreamComplete!=='boolean'||typeof s.stale!=='boolean'||s.nextDueAt!==null&&!iso(s.nextDueAt))invalid();meta.add(key);}
   for(const period of ['current','previous'])for(const component of components.filter(c=>period==='current'||c!=='submission')){
    const value=p[period][component];if(value!==null&&!object(value)||value!==null&&!meta.has(period+':'+component)||result.complete&&value===null)invalid();
    if(value!==null&&value.platform?.id!==id)invalid();
   }
   if(result.complete&&(p.snapshots.length!==5||p.snapshots.some(s=>s.stale)))invalid();
  }
  const missing=new Set();for(const m of result.missing){const key=m?.platformId+':'+m?.period+':'+m?.component;if(!object(m)||!expected.includes(m.platformId)||!components.includes(m.component)||!['current','previous'].includes(m.period)||m.period==='previous'&&m.component==='submission'||!['missing','building','failed','stale','unsupported'].includes(m.state)||missing.has(key))invalid();missing.add(key);}
  return result;
 }
 function create(options){
  let serial=0,controller=null,contextKey=identity(options.context()),disposed=false;
  let state={loading:false,result:null,request:null,error:'',blocked:false};
  const notify=()=>options.onChange?.({...state});
  function cancel(clear=false){++serial;controller?.abort();controller=null;state={...state,loading:false,...(clear?{result:null,request:null,error:''}:{})};notify();}
  function sync(){const context=options.context(),key=identity(context);if(key!==contextKey||!allowed(context)){contextKey=key;cancel(true);state.blocked=!allowed(context);notify();}return context;}
  async function load(platformId,day){
   if(disposed)return null;const context=sync();let request;
   try{request=closedRequest(platformId,day,context,(options.now||Date.now)());}catch(e){state={...state,error:e.message};notify();return null;}
   cancel();const mine=serial,key=contextKey;controller=new AbortController();const signal=controller.signal;
   const current=()=>!disposed&&serial===mine&&!signal.aborted&&identity(options.context())===key&&allowed(options.context());
   state={...state,loading:true,error:'',blocked:false};notify();
   try{const result=await options.request(request,{signal});if(!current()){if(serial===mine)sync();return null;}validate(result,request);state={...state,result,request};return result;}
   catch(e){if(!current()){if(serial===mine)sync();return null;}if(denied(e)){state={...state,result:null,request:null,blocked:true};}if(e?.code!=='ADMIN_LIVE_CANCELLED'&&e?.name!=='AbortError')state={...state,error:typeof e?.message==='string'?e.message:'快照核验未完成'};return null;}
   finally{if(current()){controller=null;state={...state,loading:false};notify();}}
  }
  return {load,sync,cancel:()=>cancel(),state:()=>({...state}),dispose(){disposed=true;cancel(true);}};
 }
 function mount(options){
  if(options.context().enabled!==true)return null;
  const d=options.document,box=d.createElement('section'),open=d.createElement('button'),panel=d.createElement('section');
  box.id='provider-snapshot-shadow';Object.assign(box.style,{position:'fixed',right:'20px',bottom:'18px',zIndex:'10000',fontSize:'13px',color:'#203354'});
  open.type='button';open.textContent='已发布快照核验';open.title='仅手动读取已发布结果';
  panel.hidden=true;Object.assign(panel.style,{width:'min(880px,90vw)',maxHeight:'75vh',overflow:'auto',background:'#fff',border:'1px solid #cfdaef',borderRadius:'10px',padding:'18px',boxShadow:'0 8px 28px #17274522'});
  const title=d.createElement('h3');title.textContent='已发布快照 · 核验模式';
  const hint=d.createElement('p');hint.textContent='选择平台和已结束日期。修改选择保留上次已应用结果，点击读取才切换；原实时查询继续独立使用。';
  const select=d.createElement('select');select.setAttribute('aria-label','核验平台（可多选）');select.multiple=true;select.size=6;
  const all=d.createElement('button');all.type='button';all.textContent='选择全部可见平台';
  const day=d.createElement('input');day.type='date';day.setAttribute('aria-label','核验日期（印度）');day.value=new Date(Date.now()+19800000-86400000).toISOString().slice(0,10);
  const query=d.createElement('button');query.type='button';query.textContent='读取已发布快照';
  const cancel=d.createElement('button');cancel.type='button';cancel.textContent='取消读取';
  const close=d.createElement('button');close.type='button';close.textContent='关闭';
  const status=d.createElement('p');status.setAttribute('role','status');const output=d.createElement('div');
  for(const node of [select,all,day,query,cancel,close]){node.style.marginRight='8px';node.style.marginBottom='10px';}
  panel.append(title,hint,select,all,day,query,cancel,close,status,output);box.append(open,panel);d.body.append(box);
  let catalogKey='',lastResult=null;
  const line=(label,value)=>{const p=d.createElement('p');p.textContent=label+'：'+String(value??'—');output.append(p);};
  const loader=create({...options,onChange:s=>{
   query.disabled=s.loading||s.blocked;cancel.disabled=!s.loading;
   status.textContent=s.loading?'正在读取已发布结果…':s.error||(s.result?({ready:'计算产物已齐备',stale:'快照已过期，保留上次结果',building:'快照正在生成',missing:'快照尚未发布',unsupported:'当前范围不支持已发布快照'}[s.result.status]):'选择条件后点击读取。');
   if(s.result===lastResult)return;lastResult=s.result;output.replaceChildren();if(!s.result)return;
   const r=s.result;line('已应用日期',s.request.startAt.slice(0,10));line('已应用平台',s.request.platformIds.length+' 个');line('实际已发布截止（UTC，不包含该时刻）',r.publishedCutoff);line('计算产物完整',r.complete?'是':'否');line('最早生成时间（UTC）',r.computedAt);line('下次计划时间（UTC）',r.nextDueAt);line('工单 / 当前费率','未加载');
   if(r.window){line('本期窗口（UTC，左闭右开）',r.window.startAt+' → '+r.window.endAt);line('前期窗口（UTC，左闭右开）',r.window.previousStartAt+' → '+r.window.previousEndAt);}
   for(const p of r.platforms){line('平台',p.platform.name||p.platform.id);for(const s of p.snapshots)line(s.period+' / '+s.component,(s.stale?'已过期 · ':'')+'来源读取 '+s.sourceReadStartedAt+' → '+s.sourceReadCompletedAt+'；来源完整性 '+(s.upstreamComplete?'已确认':'未确认'));}
   for(const m of r.missing){const platform=r.platforms.find(p=>p.platform.id===m.platformId)?.platform;line('未齐备',(platform?.name||m.platformId)+' ['+m.platformId+'] / '+m.component+' / '+m.period+' / '+m.state);}
   const details=d.createElement('details'),summary=d.createElement('summary'),pre=d.createElement('pre');summary.textContent='查看完整原始汇总（保留空值与原口径）';pre.style.whiteSpace='pre-wrap';pre.textContent=JSON.stringify(r,null,2);details.append(summary,pre);output.append(details);
  }});
  function sync(){const c=loader.sync();box.hidden=!allowed(c);const list=(c.catalog||[]).filter(supported),key=JSON.stringify(list.map(p=>[p.id,p.name]));if(key!==catalogKey){catalogKey=key;const selected=new Set(Array.from(select.options||select.children).filter(o=>o.selected).map(o=>o.value));select.replaceChildren();for(const [index,p]of list.entries()){const option=d.createElement('option');option.value=p.id;option.textContent=p.name||p.id;option.selected=selected.has(p.id)||!selected.size&&index===0;select.append(option);}}return c;}
  open.addEventListener('click',()=>{sync();panel.hidden=false;open.hidden=true;});
  close.addEventListener('click',()=>{loader.cancel();panel.hidden=true;open.hidden=false;});
  all.addEventListener('click',()=>{for(const option of Array.from(select.options||select.children))option.selected=true;});
  query.addEventListener('click',()=>{void loader.load(Array.from(select.options||select.children).filter(o=>o.selected).map(o=>o.value),day.value);});cancel.addEventListener('click',()=>loader.cancel());
  const stop=()=>loader.dispose();root.addEventListener?.('pagehide',stop);sync();
  return {sync,dispose(){root.removeEventListener?.('pagehide',stop);loader.dispose();box.remove();}};
 }
 const api={create,mount,closedRequest,validate};if(typeof module==='object'&&module.exports)module.exports=api;else root.HensemProviderSnapshotShadow=api;
})(typeof window==='object'?window:globalThis);
