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
 // Preserve only already-proven provider-array aliases across the existing JSON
 // clone boundary. Ordinary equal-looking arrays retain independent identities.
 const copy=value=>{const cloned=JSON.parse(JSON.stringify(value));for(const [source,target]of [[value,cloned],[value?.result,cloned?.result]]){
  const rows=source?.groups?.provider,out=target?.groups?.provider;if(!Array.isArray(rows)||!Array.isArray(out)||rows.length!==out.length)continue;
  rows.forEach((row,i)=>{if(Array.isArray(row?.items)&&row.items===row.fee_items&&Array.isArray(out[i]?.fee_items))out[i].items=out[i].fee_items;});
 }return cloned;};
 function restoreLeafAliases(item,enabled,q){
  if(!Object.hasOwn(item||{},'providerLeafAliasTransport'))return item;
  const marker=item.providerLeafAliasTransport,rows=item.result?.groups?.provider;
  if(!enabled||item.status!=='ready'||q.view!=='providers'||!marker||Object.prototype.toString.call(marker)!=='[object Object]'||Object.keys(marker).sort().join(',')!=='contract,providerItemsFromFeeItems'||marker.contract!=='provider-leaf-alias-v1'||!Array.isArray(marker.providerItemsFromFeeItems)||!marker.providerItemsFromFeeItems.length||!Array.isArray(rows)||marker.providerItemsFromFeeItems.length>rows.length)throw failure('invalid');
  const indices=marker.providerItemsFromFeeItems;let previous=-1;const selected=new Set();
  for(const index of indices){if(!Number.isSafeInteger(index)||index<=previous||index<0||index>=rows.length)throw failure('invalid');previous=index;const row=rows[index];if(!row||typeof row!=='object'||Array.isArray(row)||Object.hasOwn(row,'items')||!Array.isArray(row.fee_items))throw failure('invalid');selected.add(index);}
  const {providerLeafAliasTransport,...rest}=item;return {...rest,result:{...item.result,groups:{...item.result.groups,provider:rows.map((row,i)=>selected.has(i)?{...row,items:row.fee_items}:row)}}};
 }

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
  if(q.successBasis==='created'){if(Object.hasOwn(q,'successStartAt')||Object.hasOwn(q,'successEndAt'))throw failure('invalid');}
  else if(['successStartAt','successEndAt','successBasis'].some(key=>Object.hasOwn(q,key))){const successStart=instant(q.successStartAt),successEnd=instant(q.successEndAt);if(!successStart||!successEnd||successStart>=successEnd||!['success','source_updated'].includes(q.successBasis))throw failure('invalid');}
  const key=encode(q);if(key.length>32768)throw failure('invalid');return key;
 }
 // Transport profiles never alter the server's exact native query identity.
 function profileGroups(profile,q){
  if(profile===undefined)return null;
  if((q.view||'full')!=='full'||Object.hasOwn(q,'durationRange'))throw failure('invalid');
  if(profile==='time-v1')return ['hourly','provider'];
  if(profile==='amount-v1')return Object.hasOwn(q,'amountBands')?['amount','amount_range','provider']:['amount','provider'];
  if(profile==='latency-v1'&&q.durationVersion===2)return ['latency','latency_thresholds'];
  throw failure('invalid');
 }
 function validateResult(item,q,expected,now,publicationVersion,responseProfile){
  if(!item||!statuses.has(item.status))throw failure('invalid');
  if(item.status!=='ready'){if(item.result!==null||Object.hasOwn(item,'resultGroups'))throw failure('invalid');throw failure(item.status);}
  const p=item.publication,r=item.result;
  if(!p||typeof p.id!=='string'||!p.id||!['string','number'].includes(typeof p.generation)||String(p.generation)===''||typeof p.generation==='number'&&!Number.isSafeInteger(p.generation)||p.calculationComplete!==true||typeof p.sourceComplete!=='boolean'||!instant(p.computedAt)||!instant(p.expiresAt)||!instant(p.cutoff)||Date.parse(p.expiresAt)<=Date.parse(p.computedAt))throw failure('invalid');
  if(publicationVersion===2){
   if(!['fresh','refresh_due'].includes(p.freshness)||!['idle','queued','running','failed'].includes(p.refreshState)||p.nextRefreshAt!=null&&!instant(p.nextRefreshAt))throw failure('invalid');
  }else if(Date.parse(p.expiresAt)<=now)throw failure('stale');
  if(Object.hasOwn(p,'semanticTransition')&&(p.semanticTransition!=='manual_previous_dependency'||publicationVersion!==2||!['success','source_updated'].includes(q.successBasis)||!Object.hasOwn(q,'successStartAt')||p.freshness!=='refresh_due'||!instant(p.transitionExpiresAt)||Date.parse(p.transitionExpiresAt)<=now))throw failure('invalid');
  if(!r||r.version!==1||!r.platform||Object.keys(expected).some(key=>r.platform[key]!==expected[key])||instant(r.startAt)!==instant(q.startAt)||instant(r.endAt)!==instant(q.endAt)||!Array.isArray(r.summary)||!Array.isArray(r.rows)||r.rows.length||!r.groups||r.partial===true||r.complete===false||r.available===false||r.error||r.meta?.partial===true||r.coverage?.calculationComplete===false||Object.hasOwn(r,'_parts')||Object.hasOwn(r,'_preparedPublication')||Object.hasOwn(r,'_preparedResultGroups'))throw failure('invalid');
  if(q.successBasis==='created'&&(r.successBasis!=='created'||Object.hasOwn(r,'successStartAt')||Object.hasOwn(r,'successEndAt')||r.capabilities?.successCohort!=='created_at_current_stored_status'||r.capabilities?.independentSuccessWindow!==false))throw failure('invalid');
  if(Object.hasOwn(q,'successStartAt')&&(instant(r.successStartAt)!==instant(q.successStartAt)||instant(r.successEndAt)!==instant(q.successEndAt)||r.successBasis!==q.successBasis))throw failure('invalid');
  let resultGroups=null;
  if(Object.hasOwn(item,'resultGroups')){
   const marker=item.resultGroups,groups=profileGroups(responseProfile,q);
   if(publicationVersion!==2||!groups||!marker||Object.prototype.toString.call(marker)!=='[object Object]'||Object.keys(marker).sort().join(',')!=='contract,groups,profile'||marker.contract!=='prepared-result-groups-v1'||marker.profile!==responseProfile||encode(marker.groups)!==encode(groups)||encode(Object.keys(r.groups).sort())!==encode(groups))throw failure('invalid');
   resultGroups={contract:marker.contract,profile:responseProfile,groups};
  }
  // A server without profile support must still return its full legacy DTO.
  const view=q.view||'full',dimensions=resultGroups?resultGroups.groups:view==='providers'?['provider']:view==='drilldown'?['daily',...(q.kind==='latency'||q.durationRange?['provider','provider_daily']:[])]:['provider','daily','hourly','amount','matrix','latency','pending_age',...(q.amountBands?['amount_range','matrix_range']:[])];
  if(dimensions.some(key=>!Array.isArray(r.groups[key]))||Object.values(r.groups).some(rows=>!Array.isArray(rows))||view==='drilldown'&&(r.complete!==true||r.hasMore!==false)||q.durationVersion===2&&r.durationVersion!==2)throw failure('invalid');
  return {...r,...(resultGroups?{_preparedResultGroups:copy(resultGroups)}:{}),_preparedPublication:{...p,status:'ready',...(publicationVersion===2?{publicationVersion:2,freshness:Date.parse(p.expiresAt)<=now?'refresh_due':p.freshness}:{})}};
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
  const jobs=new Map(),queue=[],batches=new Set();let generation=0,context=null,completedContext=null,scheduled=false,probedGeneration=-1;
  const nativeKey=platform=>encode([identity(platform),platform.capabilities??null]);
  const completedKey=(scope,native,q,profile)=>encode([scope,native,q,profile??null]);
  function completedFamily(scope,native,q){const {providers,direction,view,offset,limit,...scopeQuery}=q;return encode([scope,native,scopeQuery]);}
  function forgetCompleted(key){const entry=completed.get(key);if(entry){completedBytes-=entry.bytes;completed.delete(key);}}
  function clearCompleted(){completed.clear();completedBytes=0;completedGeneration++;}
  function invalidateCompleted(family,keepKey){
   for(const [key,entry]of completed)if(entry.family===family){entry.invalidated=true;forgetCompleted(key);}
   for(const job of [...jobs.values()])if(job.family===family&&job.key!==keepKey){job.completedInvalidated=true;if(job.polling||job.refreshOnly){for(const waiter of [...job.waiters])settle(waiter,failure('cancelled'));abandon(job);}}
  }
  function cachedCompleted(key,q,native){
   if(!completionEnabled)return null;const entry=completed.get(key),stamp=now();if(!entry)return null;
   if(stamp<entry.readAt||stamp>=entry.expiresAt){forgetCompleted(key);return null;}
   try{
    // Revalidate the immutable source envelope, including current v1 expiry.
    // V2 expiry is a refresh hint; retain its original clock and refresh state.
    const result=validateResult(entry.item,q,native,stamp,publicationVersion,entry.responseProfile);
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
  const publicationIdentity=item=>encode(['id','generation','computedAt','expiresAt','cutoff'].map(key=>item.publication[key]));
  function rememberCompleted(job,item){
   if(!completionEnabled||job.completedInvalidated||job.generation!==generation||job.completedGeneration!==completedGeneration||job.context!==context||job.completedContext!==completedContext)return;
   const ttl=completionTtl(job.q,job.native);if(!ttl)return;
   let readAt=now(),expiresAt=Math.min(readAt+ttl,publicationVersion===1?Date.parse(item.publication.expiresAt):Infinity,item.publication.semanticTransition==='manual_previous_dependency'?Date.parse(item.publication.transitionExpiresAt):Infinity);const identity=publicationIdentity(item);
   // A same-head background read retains its original clock even if LRU
   // eviction removed the completed entry while the request was in flight.
   if(job.refreshOnly&&job.refreshClock?.identity===identity){readAt=job.refreshClock.readAt;expiresAt=job.refreshClock.expiresAt;}if(!Number.isFinite(readAt)||expiresAt<=now())return;
   let saved,bytes;try{saved=copy(item);bytes=(JSON.stringify(saved).length+job.completedKey.length+job.family.length)*2+64;}catch{return;}
   if(bytes>2*1024*1024&&Object.hasOwn(saved,'providerReuse')){delete saved.providerReuse;bytes=(JSON.stringify(saved).length+job.completedKey.length+job.family.length)*2+64;}
   if(bytes>2*1024*1024)return;forgetCompleted(job.completedKey);completed.set(job.completedKey,{item:saved,readAt,expiresAt,bytes,responseProfile:job.responseProfile,family:job.family,reuseScope:encode([job.completedContext,job.nativeKey,encode((({providers,...rest})=>rest)(job.q))])});completedBytes+=bytes;
   while(completed.size>128||completedBytes>completedByteCap)forgetCompleted(completed.keys().next().value);
   return {identity,readAt,expiresAt};
  }
  const authorityDenied=error=>['42501','ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(String(error?.code||''));
  function contextValue(){const value=options.context();if(typeof value!=='string'||!value)throw failure('cancelled');return value;}
  function settle(waiter,error,result){if(waiter.done)return;waiter.done=true;waiter.signal?.removeEventListener('abort',waiter.abort);waiter.job.waiters.delete(waiter);if(error)waiter.reject(error);else waiter.resolve(copy(result));}
  function stopTimers(job){if(job.pollTimer!==null)clearTimeout(job.pollTimer);if(job.deadlineTimer!==null)clearTimeout(job.deadlineTimer);job.pollTimer=job.deadlineTimer=null;}
  function release(job){stopTimers(job);job.phase='finished';if(jobs.get(job.key)===job)jobs.delete(job.key);}
  function cancel(error=failure('cancelled')){generation++;for(const job of jobs.values()){stopTimers(job);for(const waiter of [...job.waiters])settle(waiter,error);}jobs.clear();queue.length=0;for(const batch of batches)batch.controller.abort();batches.clear();}
  function clear(){clearCompleted();cancel();}
  function syncContext(){
   let current,reuse;try{current=contextValue();reuse=typeof options.completedReuseContext==='function'?options.completedReuseContext():current;if(typeof reuse!=='string'||!reuse)throw failure('cancelled');}
   catch(error){clear();context=completedContext=null;throw error;}
   // Only completed, exact DTOs may share an explicitly supplied authority
   // scope across pages. Active work remains page-owned and is cancelled.
   // Existing callers without this option retain context-wide invalidation.
   if(completedContext!==reuse){clear();completedContext=reuse;}
   else if(context!==current)cancel();
   context=current;return current;
  }
  function active(waiter){
   if(waiter.done)return false;
   try{if(waiter.signal?.aborted||waiter.job.generation!==generation||waiter.job.context!==syncContext()||waiter.isCurrent&&!waiter.isCurrent()||nativeKey(options.platform(waiter.job.q.platformId))!==waiter.job.nativeKey)throw failure('cancelled');return true;}
   catch(error){settle(waiter,failure('cancelled'));return false;}
  }
  function prune(job){for(const waiter of [...job.waiters])active(waiter);if(!job.waiters.size)release(job);return job.waiters.size>0;}
  function abandon(job){if(job.waiters.size)return;release(job);if(job.batch&&job.batch.jobs.every(item=>!item.waiters.size)){job.batch.controller.abort();batches.delete(job.batch);}schedule();}
  function schedule(){if(scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;drain();});}
  function deliver(job,error,result){let delivered=0;for(const waiter of [...job.waiters])if(active(waiter)){settle(waiter,error,result);delivered++;}release(job);return delivered;}
  // Ready-only delivery owns the same query as its deferred, one-shot refresh.
  // Refresh waiters never re-deliver page results and are released only after
  // the caller's foreground/comparison phase. No separate worker or timer.
  function queueRefresh(job,owners,refreshClock){
   if(!owners.length||job.completedInvalidated||job.generation!==generation||job.context!==context||jobs.has(job.key))return;
   const refresh={...job,waiters:new Set(),batch:null,phase:'queued',refreshOnly:true,refreshClock,refreshReleased:false,readyOnlyProbe:false,polling:false,pollTimer:null,deadlineTimer:null,deadlineAt:null,attempts:0};
   for(const owner of owners){
    const waiter={job:refresh,signal:owner.signal,isCurrent:owner.isCurrent,done:false,abort:null,resolve(){},reject(error){
     if(!authorityDenied(error)&&error?.code!=='ADMIN_LIVE_CANCELLED'||owner.signal?.aborted||typeof owner.onRefreshError!=='function')return;
     try{if(options.context()!==refresh.context||typeof options.completedReuseContext==='function'&&options.completedReuseContext()!==refresh.completedContext||nativeKey(options.platform(refresh.q.platformId))!==refresh.nativeKey||owner.isCurrent&&!owner.isCurrent())return;owner.onRefreshError(error);}catch{}
    }};
    waiter.abort=()=>{settle(waiter,failure('cancelled'));abandon(refresh);};refresh.waiters.add(waiter);waiter.signal?.addEventListener('abort',waiter.abort,{once:true});
   }
   jobs.set(refresh.key,refresh);queue.push(refresh);
  }
  function releaseRefresh(){for(const job of jobs.values())if(job.refreshOnly&&job.generation===generation)job.refreshReleased=true;schedule();}
  function readyMiss(item){return item?.status==='miss'&&item.result===null&&item.publication===null&&['ready_head_missing','ready_query_not_supported'].includes(item.reason)&&Object.keys(item).sort().join(',')==='publication,reason,request,result,status';}
  function pollable(item,job){
   if(!pollMaxMs||publicationVersion!==2||item?.result!==null||item.publication!==null||Object.hasOwn(item,'resultGroups'))return false;
   // A pending status alone does not prove a worker accepted this exact query.
   // The reader supplies bounded, current job evidence after successful admit.
   if(Object.hasOwn(item,'preparation')){
    const p=item.preparation;
    return ['providers','full'].includes(job.q.view||'full')&&['missing','stale','building'].includes(item.status)&&p&&Object.prototype.toString.call(p)==='[object Object]'&&Object.keys(p).sort().join(',')==='retryable,state'&&p.retryable===true&&['queued','running'].includes(p.state);
   }
   return job.q.view==='providers'&&item.status==='building'&&item.reason==='daily_provider_base_preparing';
  }
  function endPoll(job){if(!prune(job)){abandon(job);return;}deliver(job,failure('building'));abandon(job);}
  function waitForBase(job){
   if(job.completedInvalidated){deliver(job,failure('cancelled'));abandon(job);return;}
   if(!job.polling){job.polling=true;job.deadlineAt=now()+pollMaxMs;job.deadlineTimer=setTimeout(()=>{job.deadlineTimer=null;endPoll(job);},pollMaxMs);}
   if(now()>=job.deadlineAt||job.attempts>=pollMaxAttempts){endPoll(job);return;}
   // Only the exact admitted native job waits. Its HTTP batch has ended;
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
    const names=batch.readyOnlyProbe?null:reuseNames(batch);
    const leafAliases=!batch.readyOnlyProbe&&publicationVersion===2&&options.providerLeafAliases===true&&batch.jobs.every(job=>job.q.view==='providers');
    const response=await transport({action:'aggregatePrepared',requests:batch.jobs.map(job=>copy(job.q)),...(batch.readyOnlyProbe?{readMode:'ready-only-v1'}:{}),...(batch.responseProfile?{responseProfile:batch.responseProfile}:{}),...(names?{providerReuseNames:names}:{}),...(leafAliases?{providerLeafAliases:'items-fee-items-v1'}:{}),...(publicationVersion===2?{publicationVersion:2,...(batch.forceRefresh?{forceRefresh:true}:{})}:{})},{signal:batch.controller.signal});
    if(batch.controller.signal.aborted)return;
    // Size checking precedes recursive structural validation. The transport also
    // bounds HTTP bodies; this guards unexpectedly expanded decoded payloads.
    const serialized=JSON.stringify(response);if(!serialized||serialized.length>maxResponseBytes||new TextEncoder().encode(serialized).length>maxResponseBytes||response.version!==publicationVersion||!Array.isArray(response.items)||response.items.length!==batch.jobs.length||(batch.readyOnlyProbe?response.readMode!=='ready-only-v1':Object.hasOwn(response,'readMode')))throw failure('invalid');
    const expected=new Map(batch.jobs.map(job=>[job.requestKey,job])),matched=new Map();
    for(const item of response.items){const key=encode(item?.request);if(!expected.has(key)||matched.has(key))throw failure('invalid');matched.set(key,restoreLeafAliases(item,leafAliases,expected.get(key).q));}
    // Expanded originals obey the same old complete-response bound. A compact
    // body cannot admit a larger unvalidated or oversized financial result.
    if(leafAliases){const expanded=JSON.stringify({...response,items:[...matched.values()]});if(expanded.length>maxResponseBytes||new TextEncoder().encode(expanded).length>maxResponseBytes)throw failure('invalid');}
    for(const job of batch.jobs){if(!prune(job))continue;if(job.polling&&now()>=job.deadlineAt){endPoll(job);continue;}try{
     const item=matched.get(job.requestKey);
     if(batch.readyOnlyProbe){
      if(item?.status==='miss'){if(!readyMiss(item))throw failure('invalid');job.readyOnlyProbe=false;job.attempts=0;job.batch=null;job.phase='queued';queue.push(job);continue;}
      if(item?.status!=='ready')throw failure('invalid');
     }
     if(!job.refreshOnly&&pollable(item,job)){waitForBase(job);continue;}
     const result=validateResult(item,job.q,job.native,now(),publicationVersion,job.responseProfile),owners=batch.readyOnlyProbe&&result._preparedPublication.freshness==='refresh_due'?[...job.waiters].map(({signal,isCurrent,refreshIsCurrent,onRefreshError})=>({signal,isCurrent:refreshIsCurrent||isCurrent,onRefreshError})):[];
     if(deliver(job,null,result)){const clock=rememberCompleted(job,item);if(owners.length)queueRefresh(job,owners,clock);}
    }catch(error){deliver(job,error);}}
   }catch(error){
    // A retained frame's host may temporarily close its bridge during access
    // verification. Stop this entire queue before finally can dispatch another
    // batch to the absent listener. A late cancellation from an old batch must
    // never interrupt the new query, and completed receipts remain reusable.
    if(error?.code==='ADMIN_LIVE_CANCELLED'&&!batch.controller.signal.aborted&&batch.jobs.some(job=>prune(job)))cancel(error);
    if(authorityDenied(error)&&!batch.controller.signal.aborted&&batch.jobs.some(job=>prune(job))){clearCompleted();if(pollMaxMs>0){for(const job of [...jobs.values()])deliver(job,error);cancel();}}for(const job of batch.jobs)deliver(job,error);
   }
   finally{batches.delete(batch);for(const job of batch.jobs){if(job.phase==='waiting'||job.phase==='queued'&&jobs.get(job.key)===job)continue;if(job.waiters.size)deliver(job,failure('cancelled'));release(job);}schedule();}
  }
  function drain(){
   while(batches.size<maxConcurrent&&queue.length){
    queue.sort((a,b)=>Number(!!a.refreshOnly)-Number(!!b.refreshOnly));
    const selected=[];let readyOnlyProbe=false;
    while(queue.length){
     const index=queue.findIndex(job=>!job.refreshOnly||job.refreshReleased);if(index<0)break;
     const job=queue[index];if(job.refreshOnly&&[...batches].some(batch=>batch.jobs.some(item=>!item.refreshOnly)))break;if(jobs.get(job.key)!==job||!prune(job)){queue.splice(index,1);continue;}
     const probe=!!job.readyOnlyProbe&&probedGeneration!==generation;
     if(selected.length&&(selected.length>=(readyOnlyProbe?50:maxBatchSize)||probe!==readyOnlyProbe||!!job.refreshOnly!==!!selected[0].refreshOnly||(job.forceRefresh&&!job.polling)!==(selected[0].forceRefresh&&!selected[0].polling)||job.responseProfile!==selected[0].responseProfile||selected[0].responseProfile&&selected.length>=3))break;
     queue.splice(index,1);if(job.polling&&(now()>=job.deadlineAt||job.attempts>=pollMaxAttempts)){endPoll(job);continue;}if(!selected.length)readyOnlyProbe=probe;selected.push(job);
    }
    if(!selected.length)break;
    if(readyOnlyProbe)probedGeneration=generation;
    const batch={jobs:selected,readyOnlyProbe,responseProfile:selected[0].responseProfile,forceRefresh:selected[0].forceRefresh&&!selected[0].polling,controller:new AbortController()};for(const job of selected){job.batch=batch;job.phase='active';job.attempts++;}batches.add(batch);void run(batch);
   }
  }
  function read(request,readOptions={}){
   try{
    const scope=syncContext(),requestKey=queryKey(request),q=JSON.parse(requestKey),platform=options.platform(q.platformId),native=identity(platform),nativeIdentity=nativeKey(platform);if(native.id!==q.platformId)throw failure('unsupported');
    if(readOptions.signal?.aborted||readOptions.isCurrent&&!readOptions.isCurrent())throw failure('cancelled');
    if(readOptions.forceRefresh!==undefined&&typeof readOptions.forceRefresh!=='boolean'||readOptions.forceRefresh&&publicationVersion!==2)throw failure('invalid');
    const responseProfile=readOptions.responseProfile;
    if(responseProfile!==undefined){if(publicationVersion!==2)throw failure('invalid');profileGroups(responseProfile,q);}
    if(readOptions.readyOnlyProbe!==undefined&&typeof readOptions.readyOnlyProbe!=='boolean'||readOptions.readyOnlyProbe&&(publicationVersion!==2||q.view!=='providers'||readOptions.forceRefresh||responseProfile!==undefined))throw failure('invalid');
    const forceRefresh=readOptions.forceRefresh===true,reuseScope=completedContext,cacheKey=completedKey(reuseScope,nativeIdentity,q,responseProfile),family=completedFamily(reuseScope,nativeIdentity,q),key=encode([scope,nativeIdentity,q,forceRefresh,responseProfile??null]);
    if(forceRefresh)invalidateCompleted(family,key);
    else{const cached=completedResult(cacheKey,reuseScope,nativeIdentity,q,native);if(cached){const mine=generation,cacheGeneration=completedGeneration;return Promise.resolve().then(()=>{if(mine!==generation||cacheGeneration!==completedGeneration||cached.entry.invalidated||readOptions.signal?.aborted||scope!==syncContext()||readOptions.isCurrent&&!readOptions.isCurrent()||nativeKey(options.platform(q.platformId))!==nativeIdentity)throw failure('cancelled');const current=completedResult(cacheKey,reuseScope,nativeIdentity,q,native);return current?copy(current.result):read(q,readOptions);});}}
    let job=jobs.get(key);if(job?.completedInvalidated){for(const waiter of [...job.waiters])settle(waiter,failure('cancelled'));abandon(job);job=null;}
    if(!job&&!forceRefresh&&pollMaxMs>0)job=[...jobs.values()].find(other=>other.polling&&!other.completedInvalidated&&other.context===scope&&other.nativeKey===nativeIdentity&&other.requestKey===requestKey&&other.responseProfile===responseProfile);
    // An explicit reader must not wait for a deferred refresh-release hook.
    if(job?.refreshOnly){job.refreshOnly=false;job.refreshReleased=true;}
    if(!job){job={key,requestKey,q,responseProfile,readyOnlyProbe:readOptions.readyOnlyProbe===true,native,nativeKey:nativeIdentity,forceRefresh,context:scope,completedContext:reuseScope,generation,completedGeneration,completedKey:cacheKey,family,waiters:new Set(),batch:null,phase:'queued',polling:false,pollTimer:null,deadlineTimer:null,deadlineAt:null,attempts:0};jobs.set(key,job);queue.push(job);}
    const promise=new Promise((resolve,reject)=>{const waiter={job,resolve,reject,signal:readOptions.signal,isCurrent:readOptions.isCurrent,refreshIsCurrent:readOptions.refreshIsCurrent,onRefreshError:readOptions.onRefreshError,done:false,abort:null};waiter.abort=()=>{settle(waiter,failure('cancelled'));abandon(job);};job.waiters.add(waiter);waiter.signal?.addEventListener('abort',waiter.abort,{once:true});});schedule();return promise;
   }catch(error){return Promise.reject(error);}
  }
  return {read,cancel,clear,releaseRefresh};
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.HensemPreparedAggregates=api;
})(typeof window==='object'?window:globalThis);
