/* Time and amount matrices share one bounded aggregate reader per native platform. */
(function(root){
 'use strict';
 const range={minHour:0,maxHour:24};
 const directions=['charge','withdraw'];
 const sameInstant=(a,b)=>typeof a==='string'&&typeof b==='string'&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
 function matrixRequest(request){
  const q={...request,action:'aggregate',view:'drilldown',kind:'custom',hourRange:{...range},offset:0};
  if(q.providerAmountMatrix===true){
   const directions=q.direction==='all'?['charge','withdraw']:[q.direction];
   if(!directions.every(d=>root.HensemAmountBands?.valid(q.amountBands?.[d])))throw Error('当前查询未提供完整金额档边界。');
  }else{
   q.providerHourMatrix=true;
   delete q.amountBands;
  }
  if(q.status!=='all')throw Error('成功率比较需要全部订单状态作为分母。');
  if(q.successBasis==='created'){
   if(q.successStartAt!==undefined||q.successEndAt!==undefined)throw Error('创建口径与独立成功时间不一致。');
  }else if(['successBasis','successStartAt','successEndAt'].some(key=>q[key]!==undefined)){
   if(q.successBasis!=='success'||!sameInstant(q.startAt,q.successStartAt)||!sameInstant(q.endAt,q.successEndAt))throw Error('当前交叉分组尚不支持独立成功时间或源更新时间。');
   delete q.successBasis;delete q.successStartAt;delete q.successEndAt;
  }
  return q;
 }
 function verified(r,q){
  const seg=r?.segment,amount=q.providerAmountMatrix===true;
  const supported=amount?r?.providerAmountMatrix===true&&root.HensemHourlyRateWindows.sameBands(r.amountBands,q.amountBands)&&
    Array.isArray(r.groups?.provider_amount_range)&&Array.isArray(r.groups?.amount_range):
    r?.providerHourMatrix===true&&Array.isArray(r.groups?.provider_hour)&&Array.isArray(r.groups?.hourly);
  if(!supported||r.platform?.id!==q.platformId||r.complete!==true||r.hasMore!==false||
    !sameInstant(r.startAt,q.startAt)||!sameInstant(r.endAt,q.endAt)||
    (r.successBasis||null)!==(q.successBasis||null)||seg?.kind!=='custom'||seg.hourRange?.minHour!==0||seg.hourRange?.maxHour!==24||
    !Array.isArray(r.summary)||
    r.pandaCoverage?.reason==='verified_created_prefix_only')throw Error('来源尚未提供本范围已核验的'+(amount?'金额分档':'逐小时')+'三方统计。');
  return r;
 }
 function create(c){
  const {L,E}=c;let current=null,paint=null;
  const isAmount=()=>c.page()==='amount';
  function kind(){
   const prefix=isAmount()?'amount':c.page()==='time'?'hourly':null;
   if(!prefix)return null;
   return L.view===prefix+'-provider'?'provider':L.view===prefix+'-merchant'?'merchant':null;
  }
  const bands=()=>Object.fromEntries(Object.entries(L.amountBandProfiles||{}).map(([direction,profile])=>[direction,profile.edges]));
  const enabled=()=>['time','amount'].includes(c.page())&&kind()&&L.pageQueried&&!L.dirty&&!L.error&&c.allowed();
  const scope=()=>JSON.stringify([c.page(),c.access(),c.canDrill(),L.serial,L.queryScope,L.queryNow,L.direction,L.status,L.currency,L.from,L.to,L.successFrom,L.successTo,L.successBasis,isAmount()?bands():null,c.platforms().map(p=>[p.id,p.source,p.sourceName,p.country,p.currency,p.timezone]),(L.results||[]).map(r=>[r.platform?.id,r._preparedPublication?.id,r._preparedPublication?.generation,r._aggregateReadAt])]);
  function pause(){
   if(paint!==null){clearTimeout(paint);paint=null;}
   if(!current)return;
   current.queued=false;current.controller?.abort();current.controller=null;
  }
  function cancel(){pause();current=null;}
  function active(s){return !!s&&s===current&&enabled()&&scope()===s.key;}
  function state(){if(!enabled()){cancel();return null;}const key=scope();if(!current||current.key!==key){cancel();current={key,values:new Map(),failures:new Map()};}return current;}
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
  function modelsFor(s){
   const platforms=c.platforms(),main=new Map((L.results||[]).map(r=>[r.platform?.id,r]));
   const options={platforms,currency:L.currency,
    successAvailable:(p,r,d)=>(!r?._matrixDirections||r._matrixDirections.includes(d))&&c.successAvailable?.(p,r,d)!==false&&c.successAvailable?.(p,main.get(p.id),d)!==false};
   const provider=kind()==='provider',amount=isAmount();
   const data=amount?{results:L.results,amountBands:bands(),providerAmounts:s.values}:{
    results:platforms.map(p=>s.values.get(p.id)||main.get(p.id)).filter(Boolean),
    providerHours:provider?new Map([...s.values].map(([id,r])=>[id,{complete:true,rows:r.groups.provider_hour}])):new Map()
   };
   const builder=amount?root.HensemAmountRateData:root.HensemHourlyRateData;
   return directions.map(direction=>builder.build({...options,...data,direction,providerType:provider?c.providerTypes?.(direction):undefined}));
  }
  function targets(s,models=[]){
   const main=new Map((L.results||[]).map(r=>[r.platform?.id,r])),selected=kind();
   const ready=new Map(models.map(model=>[model.direction,model[selected].ready]));
   return c.platforms().filter(p=>{
    const result=main.get(p.id);
    return result&&result.pandaCoverage?.reason!=='verified_created_prefix_only'&&!s.values.has(p.id)&&
     directions.some(d=>c.successAvailable?.(p,result,d)!==false&&!ready.get(d)?.has(p.id));
   });
  }
  async function load(retry=false){
   if(!kind())return;
   const s=state();if(!s||s.denied||!c.canDrill()||s.controller||L.loading||L.queryRetrying||L.status!=='all'||L.direction!=='all')return;
   const list=targets(s,kind()==='merchant'?modelsFor(s):[]).filter(p=>retry||!s.failures.has(p.id)).map(platform=>({platform}));
   if(!list.length)return;
   const controller=new AbortController();s.controller=controller;
   let idx=0;const work=async()=>{while(idx<list.length&&active(s)&&!controller.signal.aborted){
    const {platform,slices}=list[idx++],windows=root.HensemHourlyRateWindows;
    const main=(L.results||[]).find(r=>r.platform?.id===platform.id);
    let result,base,requests;
    try{
     base=c.query(platform);
     if(base.direction!=='all')throw Error('请重新查询代收和代付数据。');
     if(isAmount())base={...base,providerAmountMatrix:true};
     requests=slices||(windows?windows.plan(base,matrixRequest):[matrixRequest(base)]);
     const parts=[];
     for(const q of requests){
      if(!active(s)||controller.signal.aborted)return;
      parts.push(verified(await c.request(q,{signal:controller.signal}),q));
     }
     const inputs=base.providerAmountMatrix===true
      ?windows.availableAmountDirections(base,main,parts,(r,d)=>c.successAvailable?.(platform,r,d))
      :{query:base,main,parts};
     const q=inputs.query,reads=inputs.parts;
     result=slices?windows.combineCreatedDay(q,inputs.main,reads):reads.length===1?reads[0]:windows.combine(q,inputs.main,reads[0],reads[1]);
     if(base.providerAmountMatrix===true){
      windows.verifyAmount(q,inputs.main,result);
      result={...result,_matrixDirections:inputs.directions};
      // Equal explicit windows share one default-clock RPC. Restore the original
      // window metadata after its counts have reconciled with the main query.
      if(base.successBasis==='success'&&result.successBasis!==base.successBasis)
       result={...result,successBasis:base.successBasis,successStartAt:base.successStartAt,successEndAt:base.successEndAt};
     }
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
  function html(){
   const s=state();if(!s)return '';
   const grouping=isAmount()?'金额分档':'分时';
   if(s.denied)return '<div data-hourly-rate-region class="live-status" role="status">当前会话未获'+grouping+'统计读取权限，请重新查询。</div>';
   if(L.status!=='all')return '<div data-hourly-rate-region class="live-status" role="status">'+grouping+'成功率需要全部订单状态作为分母，请调整筛选后查询。</div>';
   if(L.direction!=='all')return '<div data-hourly-rate-region class="live-status" role="status">请重新查询代收和代付数据。</div>';
   const models=modelsFor(s),selected=kind(),platforms=c.platforms(),remaining=targets(s,models);
   const failed=remaining.map(p=>s.failures.get(p.id)).filter(Boolean);
   const progress=models.map(model=>(model.direction==='charge'?'代收':'代付')+' '+model[selected].ready.size+' / '+platforms.length+' 个商户').join('，');
   const retry='<button class="link" type="button" onclick="HensemHourlyMatrixActions.load(true)">重试未完成商户</button>';
   let status='';
   if(models.some(model=>model[selected].ready.size<platforms.length)){
    if(!c.canDrill())status='当前角色未获'+grouping+'明细权限。';
    else if(L.loading||L.queryRetrying)status='主表正在读取 · '+progress;
    else if(s.controller||remaining.some(p=>!s.failures.has(p.id)))status='正在读取'+grouping+'统计 · '+progress;
    else if(failed.length)status='部分商户未读取 · '+progress+' '+retry;
    else status=grouping+'来源未齐 · '+progress;
   }
   const detail=failed.length?'<details><summary>查看未完成原因</summary>'+failed.map(f=>'<div>'+E(f.name)+'：'+E(f.message)+'</div>').join('')+'</details>':'';
   if(c.canDrill()&&!s.controller&&!L.loading&&!L.queryRetrying&&remaining.length>failed.length)schedule(s);
   const tables=models.map(model=>root.HensemBandSuccessMatricesUI.render(model,c.page(),selected)).join('');
   return '<div data-hourly-rate-region><p class="analysis-note">沿用页顶查询范围，'+(isAmount()?'按'+E(L.currency)+'金额档分组':'按各商户当地时间分组')+'；总成功率按总笔数加权。</p>'+(status?'<div class="analysis-status" role="status">'+status+detail+'</div>':'')+tables+'</div>';
  }
  root.HensemHourlyMatrixActions={load};
  return {html,pause,cancel,kind};
 }
 root.HensemHourlyRateController={create,matrixRequest,verified};
})(typeof window==='undefined'?globalThis:window);
