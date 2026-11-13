/* Hourly success matrices: one bounded aggregate per native platform, never one request per cell. */
(function(root){
 'use strict';
 const range={minHour:0,maxHour:24};
 const sameInstant=(a,b)=>typeof a==='string'&&typeof b==='string'&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
 function matrixRequest(request){
  const q={...request,action:'aggregate',view:'drilldown',kind:'custom',hourRange:{...range},providerHourMatrix:true,offset:0};
  delete q.amountBands; // The existing amount table's display buckets do not filter these hourly matrices.
  if(q.status!=='all')throw Error('分时比较需要全部订单状态作为分母。');
  if(q.successBasis==='created'){
   if(q.successStartAt!==undefined||q.successEndAt!==undefined)throw Error('创建口径与独立成功时间不一致。');
  }else if(['successBasis','successStartAt','successEndAt'].some(key=>q[key]!==undefined)){
   if(q.successBasis!=='success'||!sameInstant(q.startAt,q.successStartAt)||!sameInstant(q.endAt,q.successEndAt))throw Error('当前交叉分组尚不支持独立成功时间或源更新时间。');
   delete q.successBasis;delete q.successStartAt;delete q.successEndAt;
  }
  return q;
 }
 function verified(r,q){
  const seg=r?.segment;
  if(!r||r.providerHourMatrix!==true||r.platform?.id!==q.platformId||r.complete!==true||r.hasMore!==false||
    !sameInstant(r.startAt,q.startAt)||!sameInstant(r.endAt,q.endAt)||
    (r.successBasis||null)!==(q.successBasis||null)||seg?.kind!=='custom'||seg.hourRange?.minHour!==0||seg.hourRange?.maxHour!==24||
    !Array.isArray(r.summary)||!Array.isArray(r.groups?.provider_hour)||!Array.isArray(r.groups?.hourly)||
    r.pandaCoverage?.reason==='verified_created_prefix_only')throw Error('来源尚未提供本范围已核验的逐小时三方统计。');
  return r;
 }
 function create(c){
  const {L,E}=c;let current=null,paint=null;
  const kind=()=>L.view==='hourly-provider'?'provider':L.view==='hourly-merchant'?'merchant':null;
  const enabled=()=>['time','amount'].includes(c.page())&&kind()&&L.pageQueried&&!L.dirty&&!L.error&&c.allowed();
  const scope=()=>JSON.stringify([c.page(),c.access(),c.canDrill(),L.serial,L.queryScope,L.queryNow,L.direction,L.status,L.currency,L.from,L.to,L.successFrom,L.successTo,L.successBasis,c.platforms().map(p=>[p.id,p.source,p.sourceName,p.country,p.currency,p.timezone]),(L.results||[]).map(r=>[r.platform?.id,r._preparedPublication?.id,r._preparedPublication?.generation,r._aggregateReadAt])]);
  function pause(){
   if(paint!==null){clearTimeout(paint);paint=null;}
   if(!current)return;
   current.queued=false;current.controller?.abort();current.controller=null;
  }
  function cancel(){pause();current=null;}
  function active(s){return !!s&&s===current&&enabled()&&scope()===s.key;}
  function state(){if(!enabled()){cancel();return null;}const key=scope();if(!current||current.key!==key){cancel();current={key,values:new Map(),failures:new Map(),direction:L.direction==='withdraw'?'withdraw':'charge'};}return current;}
  function updatePanel(s){
   if(!active(s))return;
   const node=root.document?.querySelector('[data-hourly-rate-region]');if(!node){c.render();return;}
   const scrolls=[...node.querySelectorAll('.band-success-scroll')].map(el=>el.scrollLeft);
   const activeElement=root.document.activeElement,sortFocus=[...node.querySelectorAll('.band-success-sort')].indexOf(activeElement);
   const holder=root.document.createElement('template');holder.innerHTML=html();const next=holder.content.firstElementChild;
   if(!next)return;node.replaceWith(next);
   [...next.querySelectorAll('.band-success-scroll')].forEach((el,i)=>{el.scrollLeft=scrolls[i]||0;});
   if(sortFocus>=0)next.querySelectorAll('.band-success-sort')[sortFocus]?.focus({preventScroll:true});
  }
  function repaint(s){if(paint===null)paint=setTimeout(()=>{paint=null;updatePanel(s);},100);}
  function modelFor(s){
   const platforms=c.platforms(),main=new Map((L.results||[]).map(r=>[r.platform?.id,r]));
   const results=platforms.map(p=>s.values.get(p.id)||main.get(p.id)).filter(Boolean);
   const providerHours=kind()==='provider'?new Map([...s.values].map(([id,r])=>[id,{complete:true,rows:r.groups.provider_hour}])):new Map();
   return root.HensemHourlyRateData.build({platforms,results,providerHours,direction:s.direction,currency:L.currency,successAvailable:(platform,r,d)=>c.successAvailable?.(platform,r,d)!==false&&c.successAvailable?.(platform,main.get(platform.id),d)!==false,providerType:kind()==='provider'?c.providerTypes?.(s.direction):undefined});
  }
  function targets(s,model){
   const main=new Map((L.results||[]).map(r=>[r.platform?.id,r]));
   const merchantReady=kind()==='merchant'?model.merchant?.ready:null;
   return c.platforms().filter(p=>main.has(p.id)&&main.get(p.id).pandaCoverage?.reason!=='verified_created_prefix_only'&&!s.values.has(p.id)&&!merchantReady?.has(p.id));
  }
  async function load(retry=false){
   if(!kind())return;
   const s=state();if(!s||s.denied||!c.canDrill()||s.controller||L.loading||L.queryRetrying||L.status!=='all')return;
   const list=targets(s,kind()==='merchant'?modelFor(s):{}).filter(p=>retry||!s.failures.has(p.id)).map(platform=>({platform}));
   if(!list.length)return;
   const controller=new AbortController();s.controller=controller;
   let idx=0;const work=async()=>{while(idx<list.length&&active(s)&&!controller.signal.aborted){
    const {platform,slices}=list[idx++],windows=root.HensemHourlyRateWindows;
    const main=(L.results||[]).find(r=>r.platform?.id===platform.id);
    let result,base,requests;
    try{
     base=c.query(platform);requests=slices||(windows?windows.plan(base,matrixRequest):[matrixRequest(base)]);
     const parts=[];
     for(const q of requests){
      if(!active(s)||controller.signal.aborted)return;
      parts.push(verified(await c.request(q,{signal:controller.signal}),q));
     }
     result=slices?windows.combineCreatedDay(base,main,parts):parts.length===1?parts[0]:windows.combine(base,main,parts[0],parts[1]);
     if(active(s)&&!controller.signal.aborted){s.values.set(platform.id,{...result,platform:{...platform,...result.platform}});s.failures.delete(platform.id);}
    }catch(err){
     if(!active(s)||controller.signal.aborted)return;
     if(c.denied?.(err)){s.values.clear();s.denied=true;s.failures.clear();controller.abort();c.onDenied?.(err);break;}
     // Do not hold up the other platforms. Only one server-confirmed whole-day
     // timeout may append a recovery pass; its four calls share this worker slot.
     if(!slices&&requests?.length===1&&err?.code==='57014'){
      const recovery=windows?.closedIndiaDay(requests[0],main,platform);
      if(recovery){list.push({platform,slices:recovery});continue;}
     }
     s.failures.set(platform.id,{name:platform.name||platform.id,message:err?.message||'读取未完成'});
    }
    repaint(s);
   }};
   repaint(s);await Promise.all(Array.from({length:Math.min(2,list.length)},work));
   if(s.controller===controller){s.controller=null;if(active(s))repaint(s);}
  }
  function schedule(s){
   if(s.queued)return;
   s.queued=true;queueMicrotask(()=>{if(!s.queued)return;s.queued=false;if(active(s))void load();});
  }
  function direction(d){if(!kind())return;const s=state();if(!s||L.direction!=='all'||!['charge','withdraw'].includes(d))return;s.direction=d;updatePanel(s);}
  function html(){
   const s=state();if(!s)return '';
   if(s.denied)return '<div data-hourly-rate-region class="live-status" role="status">当前会话未获分时统计读取权限，请重新查询。</div>';
   if(L.status!=='all')return '<div data-hourly-rate-region class="live-status" role="status">分时成功率需要全部订单状态作为分母，请调整筛选后查询。</div>';
   const model=modelFor(s),platforms=c.platforms(),remaining=targets(s,model);
   const failed=remaining.map(p=>s.failures.get(p.id)).filter(Boolean);
   const ready=kind()==='merchant'?model.merchant?.ready?.size||0:s.values.size;
   const header='<div class="section-switcher"><strong>按小时看成功率</strong> '+(L.direction==='all'?'<span class="tabs">'+['charge','withdraw'].map(d=>'<button type="button" class="'+(s.direction===d?'on':'')+'" aria-pressed="'+(s.direction===d)+'" onclick="HensemHourlyMatrixActions.direction(\''+d+'\')">'+(d==='charge'?'代收':'代付')+'</button>').join('')+'</span>':'')+'</div>';
   const retry='<button class="link" type="button" onclick="HensemHourlyMatrixActions.load(true)">重试未完成商户</button>';
   const progress=ready+' / '+platforms.length+' 个商户';
   let status='';
   if(ready<platforms.length){
    if(!c.canDrill())status='当前角色未获分时明细权限。';
    else if(L.loading||L.queryRetrying)status='主表正在读取 · '+progress;
    else if(s.controller||remaining.some(p=>!s.failures.has(p.id)))status='正在读取分时统计 · '+progress;
    else if(failed.length)status='部分商户未读取 · '+progress+' '+retry;
    else status='分时来源未齐 · '+progress;
   }
   const detail=failed.length?'<details><summary>查看未完成原因</summary>'+failed.map(f=>'<div>'+E(f.name)+'：'+E(f.message)+'</div>').join('')+'</details>':'';
   if(c.canDrill()&&!s.controller&&!L.loading&&!L.queryRetrying&&remaining.length>failed.length)schedule(s);
   return '<div data-hourly-rate-region>'+header+'<p class="analysis-note">沿用页顶查询范围，按各商户当地时间分组；总成功率按总笔数加权。</p>'+(status?'<div class="analysis-status" role="status">'+status+detail+'</div>':'')+root.HensemBandSuccessMatricesUI.render(model,c.page(),kind())+'</div>';
  }
  root.HensemHourlyMatrixActions={load,direction};
  return {html,pause,cancel};
 }
 root.HensemHourlyRateController={create,matrixRequest,verified};
})(typeof window==='undefined'?globalThis:window);
