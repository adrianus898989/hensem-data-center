/* Exact prepared aggregates. Optional completion reuse and bounded derived-base polling; no raw-order fallback. */
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
  const completedPolicy=typeof options.completedCacheTtlMs==='function'?options.completedCacheTtlMs:null;
  const completedByteCap=Number.isFinite(options.completedCacheMaxBytes)?Math.max(1024,Math.min(96*1024*1024,Math.floor(options.completedCacheMaxBytes))):16*1024*1024;
  const completedTtl=Number.isFinite(options.completedCacheTtlMs)?Math.max(0,Math.min(30000,options.completedCacheTtlMs)):0;
  const completionEnabled=!!completedPolicy||completedTtl>0;
  function completionTtl(q,native){
   if(!completedPolicy)return completedTtl;
   // A page may explicitly retain a closed historical exact result longer.
   // This changes only retention; it never projects or combines publications.
   try{const ttl=completedPolicy(copy(q),copy(native));return Number.isFinite(ttl)?Math.max(0,Math.min(300000,ttl)):0;}catch{return 0;}
  }
  const pollMaxMs=Number.isFinite(options.derivedPollMaxMs)?Math.max(0,Math.min(60000,options.derivedPollMaxMs)):0;
  const pollInterval=Number.isFinite(options.derivedPollIntervalMs)?Math.max(250,Math.min(60000,options.derivedPollIntervalMs)):1500;
  const pollMaxAttempts=Number.isFinite(options.derivedPollMaxAttempts)?Math.max(1,Math.min(40,Math.floor(options.derivedPollMaxAttempts))):40;
  const completed=new Map();let completedBytes=0,completedGeneration=0;
  const jobs=new Map(),queue=[],batches=new Set();let generation=0,context=null,scheduled=false;
  const nativeKey=platform=>encode([identity(platform),platform.capabilities??null]);
  const completedKey=(scope,native,q)=>encode([scope,native,q]);
  function completedFamily(scope,native,q){const {providers,direction,view,offset,limit,...scopeQuery}=q;return encode([scope,native,scopeQuery]);}
  function forgetCompleted(key){const entry=completed.get(key);if(entry){completedBytes-=entry.bytes;completed.delete(key);}}
  function clearCompleted(){completed.clear();completedBytes=0;completedGeneration++;}
  function invalidateCompleted(family,keepKey){
   for(const [key,entry]of completed)if(entry.family===family){entry.invalidated=true;forgetCompleted(key);}
   for(const job of [...jobs.values()])if(job.family===family&&job.key!==keepKey){job.completedInvalidated=true;if(job.polling){for(const waiter of [...job.waiters])settle(waiter,failure('cancelled'));abandon(job);}}
  }
  function cachedCompleted(key,q,native){
   if(!completionEnabled)return null;const entry=completed.get(key),stamp=now();if(!entry)return null;
   if(stamp<entry.readAt||stamp>=entry.expiresAt){forgetCompleted(key);return null;}
   try{
    // Revalidate the immutable source envelope, including current v1 expiry.
    // V2 expiry is a refresh hint; retain its original clock and refresh state.
    const result=validateResult(entry.item,q,native,stamp,publicationVersion);
    completed.delete(key);completed.set(key,entry);return {result,entry};
   }catch{forgetCompleted(key);return null;}
  }
  // Optional data is produced by the existing server financial projection.
  // The browser copies its precomputed summary and selected original leaves;
  // it never normalizes a provider name or adds a financial value.
  function reusableCompleted(scope,nativeIdentity,q,native){
   if(publicationVersion!==2||q.view!=='providers'||!['charge','withdraw'].includes(q.direction))return null;
   const wantedScope=encode((({providers,...rest})=>rest)(q));
   for(const [key,entry]of [...completed].reverse()){
    if(entry.reuseScope!==encode([scope,nativeIdentity,wantedScope]))continue;
    const cached=cachedCompleted(key,entry.item.request,native);if(!cached)continue;
    const pack=entry.item.providerReuse;
    try{
     if(!pack||pack.version!==1||encode(pack.scope)!==wantedScope||!pack.base||!Array.isArray(pack.providers)||pack.providers.length>256||!Array.isArray(pack.names)||pack.names.length>200||!Array.isArray(pack.entries)||pack.entries.length>130||!Number.isSafeInteger(pack.all)||pack.all<0||pack.all>=pack.entries.length||entry.item.publication.kind!=='daily_provider_rollup'||entry.item.publication.servedLastComplete===true)continue;
     const names=new Map();for(const pair of pack.names){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!pair[0]||names.has(pair[0])||!Number.isSafeInteger(pair[1])||pair[1]<0||pair[1]>=pack.entries.length)throw failure('invalid');names.set(pair[0],pair[1]);}
     if(q.providers!==undefined&&(!Array.isArray(q.providers)||q.providers.length>200||q.providers.some(name=>typeof name!=='string'||name.trim().length<1||name.length>200||/[\u0000-\u001f\u007f]/.test(name))))continue;
     const selected=q.providers?.length?[...new Set(q.providers.map(name=>names.get(name)))]:[pack.all];
     if(selected.length!==1||selected[0]===undefined)continue;
     const projection=pack.entries[selected[0]];if(!projection||!projection.result||Object.keys(projection.result).some(k=>!['summary','total','hasMore','latencySummary','pendingSummary'].includes(k))||!Array.isArray(projection.indices)||projection.indices.length>256||projection.indices.some((i,n)=>!Number.isSafeInteger(i)||i<0||i>=pack.providers.length||n&&i<=projection.indices[n-1]))continue;
     const result={...copy(pack.base),...copy(projection.result),groups:{provider:projection.indices.map(i=>copy(pack.providers[i]))}};
     const projected={request:copy(q),status:'ready',publication:entry.item.publication,result};
     return {result:validateResult(projected,q,native,now(),publicationVersion),entry};
    }catch{continue;}
   }
   return null;
  }
  function completedResult(key,scope,nativeIdentity,q,native){return cachedCompleted(key,q,native)||reusableCompleted(scope,nativeIdentity,q,native);}
  function rememberCompleted(job,item){
   if(!completionEnabled||job.completedInvalidated||job.generation!==generation||job.completedGeneration!==completedGeneration||job.context!==context)return;
   const ttl=completionTtl(job.q,job.native);if(!ttl)return;
   const readAt=now(),expiresAt=Math.min(readAt+ttl,publicationVersion===1?Date.parse(item.publication.expiresAt):Infinity);if(!Number.isFinite(readAt)||expiresAt<=readAt)return;
   let saved,bytes;try{saved=copy(item);bytes=(JSON.stringify(saved).length+job.completedKey.length+job.family.length)*2+64;}catch{return;}
   if(bytes>2*1024*1024&&Object.hasOwn(saved,'providerReuse')){delete saved.providerReuse;bytes=(JSON.stringify(saved).length+job.completedKey.length+job.family.length)*2+64;}
   if(bytes>2*1024*1024)return;forgetCompleted(job.completedKey);completed.set(job.completedKey,{item:saved,readAt,expiresAt,bytes,family:job.family,reuseScope:encode([job.context,job.nativeKey,encode((({providers,...rest})=>rest)(job.q))])});completedBytes+=bytes;
   while(completed.size>128||completedBytes>completedByteCap)forgetCompleted(completed.keys().next().value);
  }
  const authorityDenied=error=>['42501','ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(String(error?.code||''));
  function contextValue(){const value=options.context();if(typeof value!=='string'||!value)throw failure('cancelled');return value;}
  function settle(waiter,error,result){if(waiter.done)return;waiter.done=true;waiter.signal?.removeEventListener('abort',waiter.abort);waiter.job.waiters.delete(waiter);if(error)waiter.reject(error);else waiter.resolve(copy(result));}
  function stopTimers(job){if(job.pollTimer!==null)clearTimeout(job.pollTimer);if(job.deadlineTimer!==null)clearTimeout(job.deadlineTimer);job.pollTimer=job.deadlineTimer=null;}
  function release(job){stopTimers(job);job.phase='finished';if(jobs.get(job.key)===job)jobs.delete(job.key);}
  function cancel(){generation++;for(const job of jobs.values()){stopTimers(job);for(const waiter of [...job.waiters])settle(waiter,failure('cancelled'));}jobs.clear();queue.length=0;for(const batch of batches)batch.controller.abort();batches.clear();}
  function clear(){clearCompleted();cancel();}
  function syncContext(){let current;try{current=contextValue();}catch(error){clear();context=null;throw error;}if(context!==current){clear();context=current;}return current;}
  function active(waiter){
   if(waiter.done)return false;
   try{if(waiter.signal?.aborted||waiter.job.generation!==generation||waiter.job.context!==syncContext()||waiter.isCurrent&&!waiter.isCurrent()||nativeKey(options.platform(waiter.job.q.platformId))!==waiter.job.nativeKey)throw failure('cancelled');return true;}
   catch(error){settle(waiter,failure('cancelled'));return false;}
  }
  function prune(job){for(const waiter of [...job.waiters])active(waiter);if(!job.waiters.size)release(job);return job.waiters.size>0;}
  function abandon(job){if(job.waiters.size)return;release(job);if(job.batch&&job.batch.jobs.every(item=>!item.waiters.size)){job.batch.controller.abort();batches.delete(job.batch);}schedule();}
  function schedule(){if(scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;drain();});}
  function deliver(job,error,result){let delivered=0;for(const waiter of [...job.waiters])if(active(waiter)){settle(waiter,error,result);delivered++;}release(job);return delivered;}
  function pollable(item,job){return pollMaxMs>0&&publicationVersion===2&&job.q.view==='providers'&&item?.status==='building'&&item.reason==='daily_provider_base_preparing'&&item.result===null&&item.publication===null;}
  function endPoll(job){if(!prune(job)){abandon(job);return;}deliver(job,failure('building'));abandon(job);}
  function waitForBase(job){
   if(job.completedInvalidated){deliver(job,failure('cancelled'));abandon(job);return;}
   if(!job.polling){job.polling=true;job.deadlineAt=now()+pollMaxMs;job.deadlineTimer=setTimeout(()=>{job.deadlineTimer=null;endPoll(job);},pollMaxMs);}
   if(now()>=job.deadlineAt||job.attempts>=pollMaxAttempts){endPoll(job);return;}
   // Only the exact still-building native job waits. Its HTTP batch has ended;
   // ready peers are released and never re-read. Force is sent only initially.
   job.phase='waiting';job.batch=null;
   job.pollTimer=setTimeout(()=>{job.pollTimer=null;if(!prune(job)){abandon(job);return;}if(now()>=job.deadlineAt){endPoll(job);return;}job.phase='queued';queue.push(job);schedule();},Math.min(pollInterval,job.deadlineAt-now()));
  }
  function reuseNames(batch){
   if(publicationVersion!==2||batch.forceRefresh||batch.jobs.some(job=>job.q.view!=='providers')||typeof options.providerReuseNames!=='function')return null;
   try{const raw=options.providerReuseNames();if(!Array.isArray(raw)||raw.length>200||raw.some(name=>typeof name!=='string'||!name.trim()||name.length>200||/[\u0000-\u001f\u007f]/.test(name)))return null;
    const names=[...new Set(raw)].sort();if(!names.length||new TextEncoder().encode(JSON.stringify(names)).length>8192)return null;
    const payload={action:'aggregatePrepared',requests:batch.jobs.map(job=>job.q),publicationVersion:2,providerReuseNames:names};
    return new TextEncoder().encode(JSON.stringify(payload)).length<=128000?names:null;
   }catch{return null;}
  }
  async function run(batch){
   try{
    const names=reuseNames(batch);
    const response=await transport({action:'aggregatePrepared',requests:batch.jobs.map(job=>copy(job.q)),...(names?{providerReuseNames:names}:{}),...(publicationVersion===2?{publicationVersion:2,...(batch.forceRefresh?{forceRefresh:true}:{})}:{})},{signal:batch.controller.signal});
    if(batch.controller.signal.aborted)return;
    // Size checking precedes recursive structural validation. The transport also
    // bounds HTTP bodies; this guards unexpectedly expanded decoded payloads.
    const serialized=JSON.stringify(response);if(!serialized||serialized.length>maxResponseBytes||new TextEncoder().encode(serialized).length>maxResponseBytes||response.version!==publicationVersion||!Array.isArray(response.items)||response.items.length!==batch.jobs.length)throw failure('invalid');
    const expected=new Map(batch.jobs.map(job=>[job.requestKey,job])),matched=new Map();
    for(const item of response.items){const key=encode(item?.request);if(!expected.has(key)||matched.has(key))throw failure('invalid');matched.set(key,item);}
    for(const job of batch.jobs){if(!prune(job))continue;if(job.polling&&now()>=job.deadlineAt){endPoll(job);continue;}try{const item=matched.get(job.requestKey);if(pollable(item,job)){waitForBase(job);continue;}const result=validateResult(item,job.q,job.native,now(),publicationVersion);if(deliver(job,null,result))rememberCompleted(job,item);}catch(error){deliver(job,error);}}
   }catch(error){if(authorityDenied(error)&&!batch.controller.signal.aborted&&batch.jobs.some(job=>prune(job))){clearCompleted();if(pollMaxMs>0){for(const job of [...jobs.values()])deliver(job,error);cancel();}}for(const job of batch.jobs)deliver(job,error);}
   finally{batches.delete(batch);for(const job of batch.jobs){if(job.phase==='waiting')continue;if(job.waiters.size)deliver(job,failure('cancelled'));release(job);}schedule();}
  }
  function drain(){
   while(batches.size<maxConcurrent&&queue.length){
    const selected=[];while(queue.length&&selected.length<maxBatchSize){if(selected.length&&(queue[0].forceRefresh&&!queue[0].polling)!==(selected[0].forceRefresh&&!selected[0].polling))break;const job=queue.shift();if(jobs.get(job.key)!==job||!prune(job))continue;if(job.polling&&(now()>=job.deadlineAt||job.attempts>=pollMaxAttempts)){endPoll(job);continue;}selected.push(job);}
    if(!selected.length)continue;
    const batch={jobs:selected,forceRefresh:selected[0].forceRefresh&&!selected[0].polling,controller:new AbortController()};for(const job of selected){job.batch=batch;job.phase='active';job.attempts++;}batches.add(batch);void run(batch);
   }
  }
  function read(request,readOptions={}){
   try{
    const scope=syncContext(),requestKey=queryKey(request),q=JSON.parse(requestKey),platform=options.platform(q.platformId),native=identity(platform),nativeIdentity=nativeKey(platform);if(native.id!==q.platformId)throw failure('unsupported');
    if(readOptions.signal?.aborted||readOptions.isCurrent&&!readOptions.isCurrent())throw failure('cancelled');
    if(readOptions.forceRefresh!==undefined&&typeof readOptions.forceRefresh!=='boolean'||readOptions.forceRefresh&&publicationVersion!==2)throw failure('invalid');
    const forceRefresh=readOptions.forceRefresh===true,cacheKey=completedKey(scope,nativeIdentity,q),family=completedFamily(scope,nativeIdentity,q),key=encode([scope,nativeIdentity,q,forceRefresh]);
    if(forceRefresh)invalidateCompleted(family,key);
    else{const cached=completedResult(cacheKey,scope,nativeIdentity,q,native);if(cached){const mine=generation,cacheGeneration=completedGeneration;return Promise.resolve().then(()=>{if(mine!==generation||cacheGeneration!==completedGeneration||cached.entry.invalidated||readOptions.signal?.aborted||scope!==syncContext()||readOptions.isCurrent&&!readOptions.isCurrent()||nativeKey(options.platform(q.platformId))!==nativeIdentity)throw failure('cancelled');const current=completedResult(cacheKey,scope,nativeIdentity,q,native);return current?copy(current.result):read(q,readOptions);});}}
    let job=jobs.get(key);if(job?.completedInvalidated){for(const waiter of [...job.waiters])settle(waiter,failure('cancelled'));abandon(job);job=null;}
    if(!job&&!forceRefresh&&pollMaxMs>0)job=[...jobs.values()].find(other=>other.polling&&!other.completedInvalidated&&other.context===scope&&other.nativeKey===nativeIdentity&&other.requestKey===requestKey);
    if(!job){job={key,requestKey,q,native,nativeKey:nativeIdentity,forceRefresh,context:scope,generation,completedGeneration,completedKey:cacheKey,family,waiters:new Set(),batch:null,phase:'queued',polling:false,pollTimer:null,deadlineTimer:null,deadlineAt:null,attempts:0};jobs.set(key,job);queue.push(job);}
    const promise=new Promise((resolve,reject)=>{const waiter={job,resolve,reject,signal:readOptions.signal,isCurrent:readOptions.isCurrent,done:false,abort:null};waiter.abort=()=>{settle(waiter,failure('cancelled'));abandon(job);};job.waiters.add(waiter);waiter.signal?.addEventListener('abort',waiter.abort,{once:true});});schedule();return promise;
   }catch(error){return Promise.reject(error);}
  }
  return {read,cancel,clear};
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.HensemPreparedAggregates=api;
})(typeof window==='object'?window:globalThis);
