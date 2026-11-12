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
  const {L,E}=c;let current=null,observer=null,watchToken=0,observed=null,paint=null;
  const enabled=()=>['time','amount'].includes(c.page())&&L.view==='business'&&L.pageQueried&&!L.dirty&&!L.error&&c.allowed();
  const scope=()=>JSON.stringify([c.page(),c.access(),c.canDrill(),L.serial,L.queryScope,L.queryNow,L.direction,L.status,L.currency,L.from,L.to,L.successFrom,L.successTo,L.successBasis,c.platforms().map(p=>[p.id,p.source,p.sourceName,p.currency,p.timezone]),(L.results||[]).map(r=>[r.platform?.id,r._preparedPublication?.id,r._preparedPublication?.generation,r._aggregateReadAt])]);
  const stopWatching=()=>{watchToken++;observer?.disconnect();observer=null;observed=null;};
  function cancel(){stopWatching();if(paint!==null){clearTimeout(paint);paint=null;}const old=current;current=null;old?.controller?.abort();}
  function active(s){return !!s&&s===current&&enabled()&&scope()===s.key;}
  function state(){if(!enabled()){cancel();return null;}const key=scope();if(!current||current.key!==key){cancel();current={key,values:new Map(),failures:new Map(),started:false,running:false,direction:L.direction==='withdraw'?'withdraw':'charge'};}return current;}
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
  const targets=()=>c.platforms().filter(p=>(L.results||[]).some(r=>r.platform?.id===p.id&&r.pandaCoverage?.reason!=='verified_created_prefix_only'));
  async function load(retry=false){
   const s=state();if(!s||s.denied||!c.canDrill()||s.running||s.started&&!retry||L.loading||L.queryRetrying)return;
   s.started=true;s.running=true;stopWatching();const list=targets().filter(p=>!s.values.has(p.id)),controller=new AbortController();s.controller=controller;
   let idx=0;const work=async()=>{while(idx<list.length&&active(s)&&!controller.signal.aborted){
    const platform=list[idx++];let result;
    try{
     const base=c.query(platform),windows=root.HensemHourlyRateWindows,requests=windows?windows.plan(base,matrixRequest):[matrixRequest(base)],parts=[];
     for(const q of requests){
      if(!active(s)||controller.signal.aborted)return;
      parts.push(verified(await c.request(q,{signal:controller.signal}),q));
     }
     result=parts.length===1?parts[0]:windows.combine(base,(L.results||[]).find(r=>r.platform?.id===platform.id),parts[0],parts[1]);
     if(active(s)&&!controller.signal.aborted){s.values.set(platform.id,{...result,platform:{...platform,...result.platform}});s.failures.delete(platform.id);}
    }catch(err){
     if(!active(s)||controller.signal.aborted)return;
     if(c.denied?.(err)){s.values.clear();s.denied=true;s.failures.clear();controller.abort();c.onDenied?.(err);break;}
     s.failures.set(platform.id,{name:platform.name||platform.id,message:err?.message||'读取未完成'});
    }
    repaint(s);
   }};
   repaint(s);await Promise.all(Array.from({length:Math.min(2,list.length)},work));if(active(s)){s.running=false;repaint(s);}
  }
  function watch(s){
   if(!c.canDrill()||s.started||s.running||L.loading||L.queryRetrying||typeof root.IntersectionObserver!=='function')return;
   const token=++watchToken;queueMicrotask(()=>{if(token!==watchToken||!active(s)||s.started)return;
    const node=root.document?.querySelector('[data-hourly-rate-region]');if(!node||observed===node)return;
    observer?.disconnect();observed=node;observer=new root.IntersectionObserver(entries=>{if(active(s)&&!s.started&&entries.some(e=>e.target===node&&e.isIntersecting))void load();},{rootMargin:'160px'});
    observer.observe(node);
   });
  }
  function direction(d){const s=state();if(!s||L.direction!=='all'||!['charge','withdraw'].includes(d))return;s.direction=d;updatePanel(s);}
  function html(){
   const s=state();if(!s)return '';
   if(s.denied)return '<div data-hourly-rate-region class="live-status" role="status">当前会话未获分时统计读取权限，请重新查询。</div>';
   const platforms=c.platforms(),action=()=>'<button class="link" type="button" onclick="HensemHourlyMatrixActions.load('+s.started+')">'+(s.started?'重试未完成商户':'读取分时成功率')+'</button>';
   const results=platforms.map(p=>s.values.get(p.id)||(L.results||[]).find(r=>r.platform?.id===p.id)).filter(Boolean);
   const providerHours=new Map([...s.values].map(([id,r])=>[id,{complete:true,rows:r.groups.provider_hour}]));
   const model=root.HensemHourlyRateData.build({platforms,results,providerHours,direction:s.direction,currency:L.currency,successAvailable:(platform,r,d)=>c.successAvailable?.(platform,r,d)!==false&&c.successAvailable?.(platform,(L.results||[]).find(main=>main.platform?.id===platform.id),d)!==false,providerType:c.providerTypes?.(s.direction)});
   const header='<div class="section-switcher"><strong>按小时看成功率</strong> '+(L.direction==='all'?'<span class="tabs">'+['charge','withdraw'].map(d=>'<button type="button" class="'+(s.direction===d?'on':'')+'" aria-pressed="'+(s.direction===d)+'" onclick="HensemHourlyMatrixActions.direction(\''+d+'\')">'+(d==='charge'?'代收':'代付')+'</button>').join('')+'</span>':'')+'</div>';
   const status=!c.canDrill()?'当前角色未获分时明细权限。':s.running?'正在读取分时统计 · '+s.values.size+' / '+platforms.length+' 个商户':s.failures.size?'部分商户未读取 · '+s.values.size+' / '+platforms.length+' '+action():!s.started?(L.loading||L.queryRetrying?'主表正在读取':action()):s.values.size<platforms.length?'分时来源未齐 · '+s.values.size+' / '+platforms.length+' 个商户':'';
   const detail=s.failures.size?'<details><summary>查看未完成原因</summary>'+[...s.failures.values()].map(f=>'<div>'+E(f.name)+'：'+E(f.message)+'</div>').join('')+'</details>':'';
   watch(s);
   return '<div data-hourly-rate-region>'+header+'<p class="analysis-note">沿用页顶查询范围，按各商户当地时间分组；总成功率按总笔数加权。</p>'+(status?'<div class="analysis-status" role="status">'+status+detail+'</div>':'')+root.HensemBandSuccessMatricesUI.render(model,c.page())+'</div>';
  }
  root.HensemHourlyMatrixActions={load,direction};
  return {html,cancel};
 }
 root.HensemHourlyRateController={create,matrixRequest,verified};
})(typeof window==='undefined'?globalThis:window);
