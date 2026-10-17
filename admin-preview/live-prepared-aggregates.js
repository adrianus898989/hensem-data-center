/* Exact prepared aggregates. No result cache, raw-order fallback, or implicit retries. */
(function(root){
 'use strict';
 const statuses=new Set(['ready','missing','stale','unsupported','building']);
 const labels={missing:'该筛选的统计尚未准备',stale:'该筛选的统计已过期',unsupported:'该筛选暂不支持已准备统计',building:'该筛选的统计正在准备',invalid:'已准备统计的范围或结构不完整',cancelled:'统计读取已取消'};
 function failure(status){const error=new Error(labels[status]||labels.invalid);error.code='PREPARED_AGGREGATE_'+status.toUpperCase();error.status=status;if(status==='cancelled')error.name='AbortError';return error;}
 // Sort object keys only. Array order, decimal strings, nulls and all query
 // fields remain exact, including the independent creation/success clocks.
 function encode(value){
  const seen=new Set();
  function visit(v,depth){
   if(depth>40)throw failure('invalid');
   if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
   if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
   if(!v||typeof v!=='object'||seen.has(v)||(!Array.isArray(v)&&Object.prototype.toString.call(v)!=='[object Object]'))throw failure('invalid');
   seen.add(v);let result;
   if(Array.isArray(v)){if(Object.keys(v).length!==v.length)throw failure('invalid');result='['+v.map(x=>visit(x,depth+1)).join(',')+']';}
   else result='{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+visit(v[k],depth+1)).join(',')+'}';
   seen.delete(v);return result;
  }
  return visit(value,0);
 }
 const copy=value=>JSON.parse(JSON.stringify(value));
 const identityKeys=['id','source','sourceName','country','timezone','currency'];
 function identity(platform){
  if(!platform||platform.reportOnly||identityKeys.some(key=>typeof platform[key]!=='string'||!platform[key]))throw failure('unsupported');
  return Object.fromEntries([...identityKeys,...(platform.scopeGroup===undefined?[]:['scopeGroup'])].map(key=>[key,platform[key]]));
 }
 // Compare instants without Date.parse's millisecond truncation.
 function instant(value){
  const m=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);
  if(!m||!Number.isFinite(Date.parse(m[1]+m[3]))||!Number.isFinite(Date.parse(m[1]+'Z'))||new Date(m[1]+'Z').toISOString().slice(0,19)!==m[1])return null;
  return new Date(m[1]+m[3]).toISOString().slice(0,19)+'.'+(m[2]||'').padEnd(6,'0')+'Z';
 }
 function queryKey(q){
  if(!q||q.action!=='aggregate'||!['providers','full','drilldown'].includes(q.view||'full')||typeof q.platformId!=='string')throw failure('unsupported');
  if(['orderNumber','thirdPartyOrderNumber','systemOrderId','memberId','utr'].some(key=>q[key]))throw failure('unsupported');
  const start=instant(q.startAt),end=instant(q.endAt);if(!start||!end||start>=end)throw failure('invalid');
  if(['successStartAt','successEndAt','successBasis'].some(key=>Object.hasOwn(q,key))){const successStart=instant(q.successStartAt),successEnd=instant(q.successEndAt);if(!successStart||!successEnd||successStart>=successEnd||!['success','source_updated'].includes(q.successBasis))throw failure('invalid');}
  const key=encode(q);if(key.length>32768)throw failure('invalid');return key;
 }
 function validateResult(item,q,expected,now,publicationVersion){
  if(!item||!statuses.has(item.status))throw failure('invalid');
  if(item.status!=='ready'){if(item.result!==null)throw failure('invalid');throw failure(item.status);}
  const p=item.publication,r=item.result;
  if(!p||typeof p.id!=='string'||!p.id||!['string','number'].includes(typeof p.generation)||String(p.generation)===''||typeof p.generation==='number'&&!Number.isSafeInteger(p.generation)||p.calculationComplete!==true||typeof p.sourceComplete!=='boolean'||!instant(p.computedAt)||!instant(p.expiresAt)||!instant(p.cutoff)||Date.parse(p.expiresAt)<=Date.parse(p.computedAt))throw failure('invalid');
  if(publicationVersion===2){
   if(!['fresh','refresh_due'].includes(p.freshness)||!['idle','queued','running','failed'].includes(p.refreshState)||p.nextRefreshAt!=null&&!instant(p.nextRefreshAt))throw failure('invalid');
  }else if(Date.parse(p.expiresAt)<=now)throw failure('stale');
  if(!r||r.version!==1||!r.platform||Object.keys(expected).some(key=>r.platform[key]!==expected[key])||instant(r.startAt)!==instant(q.startAt)||instant(r.endAt)!==instant(q.endAt)||!Array.isArray(r.summary)||!Array.isArray(r.rows)||r.rows.length||!r.groups||r.partial===true||r.complete===false||r.available===false||r.error||r.meta?.partial===true||r.coverage?.calculationComplete===false||Object.hasOwn(r,'_parts')||Object.hasOwn(r,'_preparedPublication'))throw failure('invalid');
  if(Object.hasOwn(q,'successStartAt')&&(instant(r.successStartAt)!==instant(q.successStartAt)||instant(r.successEndAt)!==instant(q.successEndAt)||r.successBasis!==q.successBasis))throw failure('invalid');
  const view=q.view||'full',dimensions=view==='providers'?['provider']:view==='drilldown'?['daily',...(q.kind==='latency'||q.durationRange?['provider','provider_daily']:[])]:['provider','daily','hourly','amount','matrix','latency','pending_age',...(q.amountBands?['amount_range','matrix_range']:[])];
  if(dimensions.some(key=>!Array.isArray(r.groups[key]))||Object.values(r.groups).some(rows=>!Array.isArray(rows))||view==='drilldown'&&(r.complete!==true||r.hasMore!==false)||q.durationVersion===2&&r.durationVersion!==2)throw failure('invalid');
  return {...r,_preparedPublication:{...p,status:'ready',...(publicationVersion===2?{publicationVersion:2,freshness:Date.parse(p.expiresAt)<=now?'refresh_due':p.freshness}:{})}};
 }
 function create(options){
  if(typeof options?.request!=='function'||typeof options.context!=='function'||typeof options.platform!=='function')throw TypeError('Prepared aggregates require request, context and platform callbacks');
  const publicationVersion=options.publicationVersion===2?2:1;
  const transport=options.request,now=options.now||Date.now,maxBatchSize=Math.max(1,Math.min(50,Math.floor(options.maxBatchSize||50))),maxConcurrent=Math.max(1,Math.min(4,Math.floor(options.maxConcurrent||2))),maxResponseBytes=Math.max(1024,Math.min(32*1024*1024,options.maxResponseBytes||16*1024*1024));
  const jobs=new Map(),queue=[],batches=new Set();let generation=0,context=null,scheduled=false;
  function contextValue(){const value=options.context();if(typeof value!=='string'||!value)throw failure('cancelled');return value;}
  function settle(waiter,error,result){if(waiter.done)return;waiter.done=true;waiter.signal?.removeEventListener('abort',waiter.abort);waiter.job.waiters.delete(waiter);if(error)waiter.reject(error);else waiter.resolve(copy(result));}
  function release(job){if(jobs.get(job.key)===job)jobs.delete(job.key);}
  function clear(){generation++;for(const job of jobs.values())for(const waiter of [...job.waiters])settle(waiter,failure('cancelled'));jobs.clear();queue.length=0;for(const batch of batches)batch.controller.abort();batches.clear();}
  function syncContext(){let current;try{current=contextValue();}catch(error){clear();context=null;throw error;}if(context!==current){clear();context=current;}return current;}
  function active(waiter){
   if(waiter.done)return false;
   try{if(waiter.signal?.aborted||waiter.job.generation!==generation||waiter.job.context!==syncContext()||waiter.isCurrent&&!waiter.isCurrent()||encode(identity(options.platform(waiter.job.q.platformId)))!==encode(waiter.job.native))throw failure('cancelled');return true;}
   catch(error){settle(waiter,failure('cancelled'));return false;}
  }
  function prune(job){for(const waiter of [...job.waiters])active(waiter);if(!job.waiters.size)release(job);return job.waiters.size>0;}
  function abandon(job){if(job.waiters.size)return;release(job);if(job.batch&&job.batch.jobs.every(item=>!item.waiters.size)){job.batch.controller.abort();batches.delete(job.batch);}schedule();}
  function schedule(){if(scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;drain();});}
  function deliver(job,error,result){for(const waiter of [...job.waiters])if(active(waiter))settle(waiter,error,result);release(job);}
  async function run(batch){
   try{
    const response=await transport({action:'aggregatePrepared',requests:batch.jobs.map(job=>copy(job.q)),...(publicationVersion===2?{publicationVersion:2,...(batch.jobs[0].forceRefresh?{forceRefresh:true}:{})}:{})},{signal:batch.controller.signal});
    if(batch.controller.signal.aborted)return;
    // Size checking precedes recursive structural validation. The transport also
    // bounds HTTP bodies; this guards unexpectedly expanded decoded payloads.
    const serialized=JSON.stringify(response);if(!serialized||serialized.length>maxResponseBytes||new TextEncoder().encode(serialized).length>maxResponseBytes||response.version!==publicationVersion||!Array.isArray(response.items)||response.items.length!==batch.jobs.length)throw failure('invalid');
    const expected=new Map(batch.jobs.map(job=>[job.requestKey,job])),matched=new Map();
    for(const item of response.items){const key=encode(item?.request);if(!expected.has(key)||matched.has(key))throw failure('invalid');matched.set(key,item);}
    for(const job of batch.jobs){if(!prune(job))continue;try{deliver(job,null,validateResult(matched.get(job.requestKey),job.q,job.native,now(),publicationVersion));}catch(error){deliver(job,error);}}
   }catch(error){for(const job of batch.jobs)deliver(job,error);}
   finally{batches.delete(batch);for(const job of batch.jobs){if(job.waiters.size)deliver(job,failure('cancelled'));release(job);}schedule();}
  }
  function drain(){
   while(batches.size<maxConcurrent&&queue.length){
    const selected=[];while(queue.length&&selected.length<maxBatchSize){if(selected.length&&queue[0].forceRefresh!==selected[0].forceRefresh)break;const job=queue.shift();if(jobs.get(job.key)===job&&prune(job))selected.push(job);}
    if(!selected.length)continue;
    const batch={jobs:selected,controller:new AbortController()};for(const job of selected)job.batch=batch;batches.add(batch);void run(batch);
   }
  }
  function read(request,readOptions={}){
   try{
    const scope=syncContext(),requestKey=queryKey(request),q=JSON.parse(requestKey),native=identity(options.platform(q.platformId));if(native.id!==q.platformId)throw failure('unsupported');
    if(readOptions.signal?.aborted||readOptions.isCurrent&&!readOptions.isCurrent())throw failure('cancelled');
    if(readOptions.forceRefresh!==undefined&&typeof readOptions.forceRefresh!=='boolean'||readOptions.forceRefresh&&publicationVersion!==2)throw failure('invalid');
    const forceRefresh=readOptions.forceRefresh===true,key=encode([scope,native,q,forceRefresh]);let job=jobs.get(key);
    if(!job){job={key,requestKey,q,native,forceRefresh,context:scope,generation,waiters:new Set(),batch:null};jobs.set(key,job);queue.push(job);}
    const promise=new Promise((resolve,reject)=>{const waiter={job,resolve,reject,signal:readOptions.signal,isCurrent:readOptions.isCurrent,done:false,abort:null};waiter.abort=()=>{settle(waiter,failure('cancelled'));abandon(job);};job.waiters.add(waiter);waiter.signal?.addEventListener('abort',waiter.abort,{once:true});});schedule();return promise;
   }catch(error){return Promise.reject(error);}
  }
  return {read,clear};
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.HensemPreparedAggregates=api;
})(typeof window==='object'?window:globalThis);
