/* Daily member identities are deduplicated by the server over the whole provider set.
 * Never sum hourly or per-provider distinct counts into these values. */
(function(root){
 'use strict';
 const directions=['charge','withdraw'];
 const thresholds=[2,3,4,5];
 const fields=['created_member_count','success_member_count','created_order_count','success_order_count','created_missing_member_count','success_missing_member_count'];
 const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
 const native=p=>{const source=String(p.source||'').toLowerCase().replaceAll('_','');return p.capabilities?.memberDailyAvailable!==false&&!p.reportOnly&&uuid(p.id)&&(['ar','newar','lg','game66','wg'].includes(source)||['kb','duoli'].includes(source)&&p.capabilities?.memberDailyAvailable===true)};
 const duoli=p=>String(p?.source||'').toLowerCase()==='duoli';
 const duoliBasis='多利成功人数按成功状态＋订单更新时间统计，不代表实际到账；提现创建覆盖尚未核验，仅统计已采集订单。';
 const count=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
 const unavailableReason=(row,basis)=>({source_member_id_unavailable:'WG 充值明细未提供会员 ID，人数不可统计',source_success_time_unavailable:'WG 提现未提供已核实成功时间，成功人数不可统计',newar_success_time_missing:'新中台出款缺少付款成功时间，无法确认该窗口成功人数；不是 0',source_updated_member_time_unavailable:'此来源未接入按源订单更新时间统计成功人数',duoli_paid_member_time_unavailable:'多利未提供已核实成功时间，不能用订单更新时间替代',member_window_read_failed:'该时间范围人数读取失败',outside_member_window:'不在此项统计时间范围'})[row?.[basis+'_unavailable_reason']]||'此方向的人数口径不可统计';
 function localDay(value,zone){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
 function daysFor(q,p){const start=Date.parse(q.startAt),end=Date.parse(q.endAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('人数统计日期范围无效');const first=localDay(start,p.timezone),last=localDay(end-1,p.timezone),days=[];for(let d=Date.parse(first+'T00:00:00Z');d<=Date.parse(last+'T00:00:00Z');d+=86400000){days.push(new Date(d).toISOString().slice(0,10));if(days.length>31)throw Error('人数统计每次最多31个当地日');}return days;}
 // Split only at local calendar-day boundaries. A UTC +24h step is wrong on DST days.
 function dailySlices(item){
  const q=item.request,start=Date.parse(q.startAt),end=Date.parse(q.endAt),formatter=new Intl.DateTimeFormat('en-CA',{timeZone:item.platform.timezone,year:'numeric',month:'2-digit',day:'2-digit'}),at=value=>{const parts=formatter.formatToParts(new Date(value));return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');},bounds=[start];
  for(const date of item.days.slice(1)){let low=bounds.at(-1),high=end;while(low<high){const middle=low+Math.floor((high-low)/2);if(at(middle)<date)low=middle+1;else high=middle;}if(low<=bounds.at(-1)||low>=end||at(low)!==date)throw Error('人数统计当地日期边界无法拆分');bounds.push(low);}
  bounds.push(end);return item.days.map((date,i)=>({...item,days:[date],request:{...q,startAt:new Date(bounds[i]).toISOString(),endAt:new Date(bounds[i+1]).toISOString()}}));
 }
 const timedOut=error=>/超时|timeout|timed out|57014/i.test(String(error?.code||'')+' '+String(error?.message||''));
 function requestFor(p,query){
  const q=query(p,'memberDaily');
  if(q.status&&q.status!=='all'||['orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr'].some(k=>q[k]))throw Error('人数统计请使用全部状态，并清空单笔订单筛选');
  const request={action:'memberDaily',platformId:p.id,startAt:q.startAt,endAt:q.endAt,direction:q.direction||'all'};
  if(!['all',...directions].includes(request.direction))throw Error('人数统计业务方向无效');
  if(q.currency)request.currency=q.currency;
  const providers=[...new Set((q.providers||[]).map(v=>String(v).trim()).filter(Boolean))].sort();if(providers.length)request.providers=providers;
  const item={platform:p,request,days:daysFor(request,p)},clockKeys=['successStartAt','successEndAt','successBasis'];
  if(clockKeys.some(key=>Object.hasOwn(q,key))){
   if(!clockKeys.every(key=>typeof q[key]==='string'&&q[key])||!['success','source_updated'].includes(q.successBasis))throw Error('人数成功统计时间范围或口径无效');
   const successRequest={...request,startAt:q.successStartAt,endAt:q.successEndAt};
   item.successWindow={request:successRequest,days:daysFor(successRequest,p),basis:q.successBasis,
    unavailable:q.successBasis==='source_updated'&&!duoli(p)?'source_updated_member_time_unavailable':q.successBasis==='success'&&duoli(p)?'duoli_paid_member_time_unavailable':null};
  }
  return item;
 }
 const sameMemberWindow=item=>!item.successWindow||!item.successWindow.unavailable&&Date.parse(item.request.startAt)===Date.parse(item.successWindow.request.startAt)&&Date.parse(item.request.endAt)===Date.parse(item.successWindow.request.endAt);
 function validate(result,item){
  const q=item.request,p=result?.platform,caps=result?.capabilities,wg=String(item.platform.source||'').toLowerCase()==='wg';
  const identityValid=wg?caps?.memberIdentity===false&&caps.memberIdentityByDirection?.charge===false&&caps.memberIdentityByDirection?.withdraw===true&&caps.availability?.charge?.created===false&&caps.availability?.charge?.success===false&&caps.availability?.withdraw?.created===true&&caps.availability?.withdraw?.success===false:caps?.memberIdentity===true;
  if(duoli(item.platform)&&(p?.source!=='duoli'||p?.timezone!=='Asia/Jakarta'||caps?.memberDailyAvailable!==true||caps?.successTimeBasis!=='order_updated_at'||caps?.paymentSuccessTimeAvailable!==false||caps?.sourceCompletenessVerified!==false||caps?.withdrawCreatedCoverageAvailable!==false))throw Error('多利人数统计口径未确认');
  if(p?.id!==q.platformId||p?.timezone!==item.platform.timezone||Date.parse(result.startAt)!==Date.parse(q.startAt)||Date.parse(result.endAt)!==Date.parse(q.endAt)||!Array.isArray(result.rows)||!identityValid||caps.createdBasis!=='created_at'||caps.successBasis!=='success_at'||caps.dedupe!=='platform_local_date_direction_member')throw Error('人数统计响应范围或口径不一致');
  const expectedDirections=q.direction==='all'?directions:[q.direction],seen=new Set();
  for(const row of result.rows){
   const key=row.date+'|'+row.direction;if(!item.days.includes(row.date)||!expectedDirections.includes(row.direction)||seen.has(key)||!wg&&fields.some(k=>!count(row[k])))throw Error('人数统计每日明细不完整');seen.add(key);
   for(const basis of ['created','success']){
    const orders=row[basis+'_order_count'],missing=row[basis+'_missing_member_count'],members=row[basis+'_member_count'];
    if(wg){
     const available=row.direction==='withdraw'&&basis==='created',reason=available?null:row.direction==='charge'?'source_member_id_unavailable':'source_success_time_unavailable';
     if(row[basis+'_available']!==available||row[basis+'_unavailable_reason']!==reason)throw Error('人数统计可用性口径不一致');
     if(!available){if(members!==null||thresholds.some(n=>row[basis+'_members_ge'+n]!==null))throw Error('不可用人数不得返回零值');if(row.direction==='withdraw'){if(orders!==null||missing!==null)throw Error('未提供成功时间不得推算成功订单');}else if(!count(orders)||missing!==orders)throw Error('缺失会员 ID 覆盖待核对');continue;}
     if(![orders,missing,members].every(count))throw Error('人数统计每日明细不完整');
    }
    if(missing>orders||members>orders-missing||orders>missing&&members===0)throw Error('人数统计会员覆盖待核对');
   }
  }
  if(seen.size!==item.days.length*expectedDirections.length)throw Error('人数统计缺少日期或业务方向');
  return {platform:{...item.platform,...p},rows:result.rows.map(row=>({...row})),sourceCompletenessVerified:caps.sourceCompletenessVerified===true,frequencySupported:caps.frequencyBasis==='per_platform_local_day_order_count'&&JSON.stringify(caps.frequencyThresholds)===JSON.stringify(thresholds)};
 }
 function create(c){
  const {L,E,C}=c;
  const initial=()=>({status:'idle',key:'',items:[],unsupported:[],results:[],failures:[],error:''});
  let S=initial(),serial=0,pending=null,inFlight=0,nextForce=false;const waiters=[];
  // Only validated counts live here, for this document; no credentials or
  // results enter browser storage. The host still authorizes every source read.
  const cache=new Map(),now=()=>typeof c.now==='function'?c.now():Date.now();
  let cacheBytes=0,cacheContext='',cacheGeneration=0;
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  const encode=value=>JSON.stringify(stable(value));
  const copy=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
  function clearCache(){cache.clear();cacheBytes=0;cacheGeneration++;}
  function accessContext(){
   const a=root.hensemRoleAccess||{},s=root.hensemDataScope||{};
   if(a.canView===false){clearCache();throw Error('当前账号没有此范围的人数查看权限');}
   const context=typeof c.accessContext==='function'?c.accessContext():[s.mode||'document',s.identity||'document',a.mode||'document',a.roleId||'',a.version??null,a.assignmentVersion??null,a.canView??null,Array.isArray(a.permissions)?[...a.permissions].sort():[]];
   if(context===null||context===undefined||context===''){clearCache();throw Error('人数查看权限尚未确认');}
   const key=encode(context);if(key!==cacheContext){clearCache();cacheContext=key;}return key;
  }
  const identity=p=>[p.id,p.source,p.sourceName,p.name,p.country,p.timezone,p.currency,p.capabilities,p.reportOnly];
  const family=item=>{const {startAt,endAt,...request}=item.request;return encode([identity(item.platform),request]);};
  const cacheKey=(item,context)=>encode([context,identity(item.platform),item.request]);
  function removeEntry(key){const entry=cache.get(key);if(entry){cacheBytes-=entry.bytes;cache.delete(key);}}
  function cached(item,context){
   const key=cacheKey(item,context),entry=cache.get(key);if(!entry)return null;
   if(now()>=entry.expiresAt||now()<entry.result._memberReadAt){removeEntry(key);return null;}
   cache.delete(key);cache.set(key,entry);return {...copy(entry.result),_memberCacheHit:true};
  }
  function remember(item,result,policy){
   if(result._memberCacheable===false||policy.generation!==cacheGeneration||policy.context!==accessContext())return;
   const at=result._memberReadAt,expiresAt=result._memberExpiresAt;if(!Number.isFinite(at)||!Number.isFinite(expiresAt)||now()>=expiresAt)return;
   const key=cacheKey(item,policy.context),entryFamily=family(item);let value,bytes;try{value=copy(result);bytes=(JSON.stringify(value).length+key.length+entryFamily.length)*2+64;}catch{return;}
   if(bytes>1024*1024)return;removeEntry(key);cache.set(key,{result:value,bytes,expiresAt,family:entryFamily,startAt:Date.parse(item.request.startAt),endAt:Date.parse(item.request.endAt)});cacheBytes+=bytes;
   while(cache.size>128||cacheBytes>8*1024*1024)removeEntry(cache.keys().next().value);
  }
  function invalidate(items){
   cacheGeneration++;
   // An all-result may be composed from direction entries. Refreshing either
   // child invalidates its parent; refreshing all invalidates both children.
   const scopes=items.flatMap(item=>[item,...(item.successWindow&&!item.successWindow.unavailable?[{...item,...item.successWindow}]:[])]);
   const related=scopes.flatMap(item=>[item,...(item.request.direction==='all'?directions:['all']).map(direction=>({...item,request:{...item.request,direction}}))]);
   const ranges=related.map(item=>({family:family(item),start:Date.parse(item.request.startAt),end:Date.parse(item.request.endAt)}));
   for(const [key,entry]of cache)if(ranges.some(range=>entry.family===range.family&&entry.startAt<range.end&&entry.endAt>range.start))removeEntry(key);
  }
  function scope(){const context=accessContext(),selected=[...new Map((c.selected()||[]).map(p=>[p.id,p])).values()].sort((a,b)=>String(a.id).localeCompare(String(b.id))),items=[],unsupported=[];for(const p of selected){if(native(p))items.push(requestFor(p,c.query));else unsupported.push({id:p.id,name:p.name||'未提供平台名',reason:'此来源尚未接入会员明细'});}return {context,items,unsupported,key:encode([context,L.country,L.from,L.to,L.direction,L.status,L.multi,items.map(i=>[i.request,i.successWindow,identity(i.platform)]),unsupported.map(p=>[p.id,p.name])])};}
  const currentKey=()=>{try{return scope().key}catch{return ''}};
  const view=()=>{
   if(L.dirty||S.key!==currentKey())return initial();
   // Aggregate clock coverage is authoritative for this displayed query. Keep
   // cached member identities and creation counts intact, but do not turn a
   // paid-clock gap into zero successful members or a sortable known value.
   if(typeof c.successClockUnavailable!=='function')return S;
   return {...S,results:S.results.map(result=>String(result.platform?.source||'').toLowerCase().replaceAll('_','')!=='newar'||!c.successClockUnavailable(result.platform,'withdraw')?result:{...result,rows:result.rows.map(row=>row.direction!=='withdraw'?row:{...row,success_available:false,success_unavailable_reason:'newar_success_time_missing',...Object.fromEntries(fields.filter(field=>field.startsWith('success_')).map(field=>[field,null])),...Object.fromEntries(thresholds.map(n=>['success_members_ge'+n,null]))})})};
  };
  const valid=id=>id===serial&&!L.dirty&&S.key===currentKey();
  const retry=s=>s.status==='error'||s.status==='paused'||s.failures.length?' <button type="button" class="link" onclick="liveMemberCountsRetry()">重试</button>':'';
  function cancel(){serial++;pending=null;nextForce=false;waiters.splice(0).forEach(wake=>wake());if(S.status==='loading')S={...S,status:'paused',results:[],error:'人数读取已暂停'};}
  // A deliberate query reevaluates freshness. Render-time ensure never retries
  // merely because a timer expired, so slow/partial reads cannot create a loop.
  function beginQuery(force=false){cancel();nextForce=force===true;S=initial();if(nextForce){try{invalidate(scope().items);}catch{clearCache();}}}
  async function limitedRequest(request,id){while(inFlight>=readConcurrency){if(!valid(id))throw Error('人数查询已替换');await new Promise(resolve=>waiters.push(resolve));}if(!valid(id))throw Error('人数查询已替换');inFlight++;try{return await c.request(request)}finally{inFlight--;waiters.splice(0).forEach(wake=>wake());}}
  async function readExact(item,id,policy){
   if(!valid(id))throw Error('人数查询已替换');const hit=!policy.force&&cached(item,policy.context);if(hit)return hit;
   let response;try{response=await limitedRequest(item.request,id);}catch(error){if(valid(id)&&['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(error?.code))clearCache();throw error;}if(!valid(id))throw Error('人数查询已替换');
   const result=validate(response,item),at=now(),historical=localDay(Date.parse(item.request.endAt)-1,item.platform.timezone)<localDay(at,item.platform.timezone);
   const value={...result,_memberReadAt:at,_memberExpiresAt:at+(historical?300000:30000),_memberCacheHit:false,_memberCacheable:!(response.partial===true||response.complete===false||response.available===false||response.error||response.meta?.partial===true||response.coverage?.complete===false)};
   remember(item,value,policy);return value;
  }
  async function readPlatform(item,id,policy){
   try{return await readExact(item,id,policy);}
   catch(error){
    if(!valid(id)||!timedOut(error)||item.days.length<2)throw error;
    const slices=dailySlices(item),parts=[];
    for(const slice of slices){if(!valid(id))throw Error('人数查询已替换');try{parts.push(await readExact(slice,id,policy));}catch(failure){if(!valid(id))throw failure;throw Object.assign(Error(slice.days[0]+'：'+(failure?.message||'人数读取失败')+'（'+parts.length+'/'+slices.length+' 天已读取，平台未计入合计）'),{code:failure?.code,memberDailyFallbackFailed:true});}}
    // Publish only a complete platform. Distinct counts within a day are never added.
    const result={platform:parts[0].platform,rows:parts.flatMap(part=>part.rows),sourceCompletenessVerified:parts.every(part=>part.sourceCompletenessVerified),frequencySupported:parts.every(part=>part.frequencySupported),_memberReadAt:Math.min(...parts.map(part=>part._memberReadAt)),_memberExpiresAt:Math.min(...parts.map(part=>part._memberExpiresAt)),_memberCacheHit:parts.some(part=>part._memberCacheHit),_memberCacheable:parts.every(part=>part._memberCacheable!==false)};
    remember(item,result,policy);return result;
   }
  }
  async function retryTimedOut(item,id,policy){
   // A one-day all-direction scan can exceed the statement budget even though
   // either direction fits. Keep the exact full window and provider union;
   // append separately deduplicated direction rows, never hourly distincts.
   if(item.days.length!==1||item.request.direction!=='all')return readExact(item,id,policy);
   const parts=[];
   for(const direction of directions){
    if(!valid(id))throw Error('人数查询已替换');
    try{
     const part=await readExact({...item,request:{...item.request,direction}},id,policy);
     if(!valid(id))throw Error('人数查询已替换');
     if(part._memberCacheable===false)throw Error('人数统计响应未完整');
     parts.push(part);
    }catch(error){if(!valid(id))throw error;throw Object.assign(Error((direction==='charge'?'充值':'提款')+'：'+(error?.message||'人数读取失败')+'（'+parts.length+'/2 方向已读取，平台未计入合计）'),{code:error?.code});}
   }
   const rows=parts.flatMap(part=>part.rows);
   if(rows.length!==2||directions.some(direction=>rows.filter(row=>row.direction===direction&&row.date===item.days[0]).length!==1))throw Error('人数统计方向明细不完整');
   const result={platform:parts[0].platform,rows,sourceCompletenessVerified:parts.every(part=>part.sourceCompletenessVerified),frequencySupported:parts.every(part=>part.frequencySupported),_memberReadAt:Math.min(...parts.map(part=>part._memberReadAt)),_memberExpiresAt:Math.min(...parts.map(part=>part._memberExpiresAt)),_memberCacheHit:parts.some(part=>part._memberCacheHit),_memberCacheable:true};
   remember(item,result,policy);return result;
  }
  async function readWindows(item,id,policy){
   const success=item.successWindow;
   if(!success)return readPlatform(item,id,policy);
   const windows={created:{startAt:item.request.startAt,endAt:item.request.endAt},success:{startAt:success.request.startAt,endAt:success.request.endAt,basis:success.basis}};
   // An equal supported window is one native read, even when entered with a
   // different equivalent UTC spelling. The endpoint already computes each axis.
   if(sameMemberWindow(item))return {...await readPlatform(item,id,policy),_memberWindows:windows};
   const parts={},errors=[],scopes={created:item,success:{platform:item.platform,request:success.request,days:success.days}};
   for(const basis of ['created','success']){
    if(basis==='success'&&success.unavailable)continue;
    if(!valid(id))throw Error('人数查询已替换');
    try{parts[basis]=await readPlatform(scopes[basis],id,policy);}
    catch(error){
     if(!valid(id))throw error;
     if(['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED','42501'].includes(error?.code)){clearCache();throw error;}
     errors.push({basis,error:error?.message||'人数读取失败'});
    }
   }
   if(!valid(id))throw Error('人数查询已替换');
   if(!parts.created&&!parts.success)throw Object.assign(Error(errors.map(x=>(x.basis==='created'?'创建':'成功')+'：'+x.error).join('；')||'人数读取失败'),{code:'MEMBER_WINDOW_READ_FAILED'});
   // Merge by native date/direction, taking only the axis belonging to its exact
   // requested window. No union/intersection of member IDs or distinct totals.
   const rows=new Map(),expected=item.request.direction==='all'?directions:[item.request.direction];
   for(const basis of ['created','success'])for(const date of scopes[basis].days)for(const direction of expected){
    const key=date+'|'+direction;if(!rows.has(key)){const row={date,direction};for(const axis of ['created','success']){row[axis+'_in_window']=false;row[axis+'_available']=false;row[axis+'_unavailable_reason']='outside_member_window';for(const field of fields.filter(field=>field.startsWith(axis+'_')))row[field]=null;for(const n of thresholds)row[axis+'_members_ge'+n]=null;}rows.set(key,row);}
    const row=rows.get(key),source=parts[basis]?.rows.find(r=>r.date===date&&r.direction===direction);
    row[basis+'_in_window']=true;row[basis+'_frequency_supported']=parts[basis]?.frequencySupported===true;
    if(source){for(const [field,value]of Object.entries(source))if(field.startsWith(basis+'_'))row[field]=value;row[basis+'_available']=source[basis+'_available']!==false;row[basis+'_unavailable_reason']=source[basis+'_unavailable_reason']||null;}
    else row[basis+'_unavailable_reason']=basis==='success'&&success.unavailable?success.unavailable:'member_window_read_failed';
   }
   const values=Object.values(parts);
   return {platform:values[0].platform,rows:[...rows.values()],sourceCompletenessVerified:values.every(part=>part.sourceCompletenessVerified),frequencySupported:values.every(part=>part.frequencySupported),_memberReadAt:Math.min(...values.map(part=>part._memberReadAt)),_memberExpiresAt:Math.min(...values.map(part=>part._memberExpiresAt)),_memberCacheHit:values.some(part=>part._memberCacheHit),_memberCacheable:false,_memberWindows:windows,_memberAxisErrors:errors};
  }
  let readConcurrency=2;
  function ensure(force=false,concurrency=2){
   if(L.dirty)return Promise.resolve();
   let q;try{q=scope()}catch(error){S={...initial(),status:'error',error:error.message||'人数统计筛选无效'};c.render();return Promise.resolve();}
   force=force===true||nextForce;if(!force&&q.key===S.key&&S.status!=='idle')return pending||Promise.resolve();
   nextForce=false;if(force)invalidate(q.items);const policy={force,context:q.context,generation:cacheGeneration};
   readConcurrency=concurrency===1?1:2;const id=++serial;S={...initial(),status:'loading',key:q.key,items:q.items,unsupported:q.unsupported};c.render();
   const run=(async()=>{
    if(!q.items.length){S={...S,status:'ready'};c.render();return;}
    let index=0;const timedOutItems=[];
    const failure=(item,error)=>({id:item.platform.id,name:item.platform.name,error:error?.message||'人数读取失败'});
    async function worker(){while(index<q.items.length&&valid(id)){const item=q.items[index++];try{const result=await readWindows(item,id,policy);if(!valid(id))return;S.results.push(result);if(result._memberAxisErrors?.length)S.failures.push(failure(item,Error(result._memberAxisErrors.map(x=>(x.basis==='created'?'创建':'成功')+'：'+x.error).join('；'))));}catch(error){if(!valid(id))return;S.failures.push(failure(item,error));if(timedOut(error)&&!error?.memberDailyFallbackFailed&&sameMemberWindow(item))timedOutItems.push(item);}if(valid(id))c.render();}}
    await Promise.all(Array.from({length:Math.min(readConcurrency,q.items.length)},()=>worker()));if(!valid(id))return;
    // Finish the initial cohort before one serial retry of failed timeout scopes.
    // Only one-day all-direction timeouts use two exact direction reads.
    // A failed daily fallback never restarts the original wide request.
    for(const item of timedOutItems){if(!valid(id))return;try{const result=await retryTimedOut(item,id,policy);if(!valid(id))return;S.results.push(result);S.failures=S.failures.filter(row=>row.id!==item.platform.id);}catch(error){if(!valid(id))return;const message=error?.message||'人数读取失败';S.failures=S.failures.map(row=>row.id===item.platform.id?{...row,error:row.error===message?message:row.error+'；重试失败：'+message}:row);}if(valid(id))c.render();}
    if(!valid(id))return;S={...S,status:S.failures.length&&!S.results.length?'error':'ready',error:S.failures.length&&!S.results.length?'所选平台人数读取失败':''};c.render();
   })();pending=run;run.finally(()=>{if(id===serial)pending=null});return run;
  }
  function aggregate(s,direction,basis){const all=s.results.flatMap(r=>r.rows.filter(row=>row.direction===direction&&row[basis+'_in_window']!==false)),unavailable=all.filter(row=>row[basis+'_available']===false),rows=all.filter(row=>row[basis+'_available']!==false),members=rows.reduce((n,r)=>n+r[basis+'_member_count'],0),orders=rows.reduce((n,r)=>n+r[basis+'_order_count'],0),missing=rows.reduce((n,r)=>n+r[basis+'_missing_member_count'],0),received=s.results.filter(r=>r.rows.some(row=>row.direction===direction&&row[basis+'_in_window']!==false&&row[basis+'_available']!==false)).length,expected=s.items.length+s.unsupported.length,partial=received<expected||missing>0;return {members,orders,missing,received,expected,partial,unavailable:[...new Set(unavailable.map(row=>unavailableReason(row,basis)))],display:received===0||members===0&&partial?'—':C(members)};}
  const multiple=s=>s.items.some(i=>i.successWindow?.days.length>1)||new Set(s.items.flatMap(i=>i.days)).size>1||String(L.from||'').slice(0,10)!==String(L.to||'').slice(0,10);
  const status=s=>s.status==='loading'?'人数读取中':s.status==='paused'?s.error:s.status==='error'?s.error:s.status==='idle'?'查询后显示人数':!s.items.length?'所选来源尚未接入会员明细':'';
  function readNotice(s){
   const values=s.results.filter(result=>Number.isFinite(result._memberReadAt));if(!values.length)return '';
   const at=Math.min(...values.map(result=>result._memberReadAt)),zones=[...new Set(values.map(result=>result.platform?.timezone).filter(Boolean))],zone=zones.length===1?zones[0]:'UTC';
   let text;try{text=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(at));}catch{text=new Date(at).toISOString();}
   return '人数读取 '+text+' · '+zone+(values.some(result=>result._memberCacheHit)?' · 缓存':'')+(values.some(result=>now()>=result._memberExpiresAt)?' · 已过期，查询更新':'')+(values.some(result=>duoli(result.platform))?' · '+duoliBasis:'');
  }
  function windowNotice(s){
   const item=s.items.find(item=>item.successWindow);if(!item)return '';
   const f=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:item.platform.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value));
   const range=q=>f(q.startAt)+' 至 '+f(Date.parse(q.endAt)-1000);
   return '创建人数：'+range(item.request)+'；成功人数'+(item.successWindow.basis==='source_updated'?'（源订单更新时间）':'')+'：'+range(item.successWindow.request)+' · '+item.platform.timezone+' · 两个时间范围分别统计';
  }
  function metric(direction){
   if(!directions.includes(direction))return '';
   const s=view(),created=aggregate(s,direction,'created'),success=aggregate(s,direction,'success'),name=direction==='charge'?'充值':'提款',partial=created.partial||success.partial,label=multiple(s)?'每日去重人次 · '+name+' / 成功'+name:name+'人数 / 成功'+name+'人数',message=status(s)||('读取 '+C(created.received)+' / '+C(created.expected)+' 平台'+(partial?' · 部分数据':' · 已采集订单'))+([...new Set([...created.unavailable,...success.unavailable])].length?' · '+[...new Set([...created.unavailable,...success.unavailable])].join('；'):''),notice=readNotice(s);
   return '<div class="df-flow-metric df-member-counts"><span>'+label+'</span><strong><button type="button" class="link metric-link" onclick="liveMemberCountsDetails()">'+created.display+' / '+success.display+'</button></strong><small class="cell-sub">'+(partial&&(created.members||success.members)?'已知人数 · ':'')+(multiple(s)?'各日、各平台分别去重后相加':'同平台跨三方去重')+'</small><small class="df-coverage">'+E(message)+retry(s)+'</small>'+(notice?'<small class="cell-basis">'+E(notice)+'</small>':'')+(windowNotice(s)?'<small class="cell-basis">'+E(windowNotice(s))+'</small>':'')+'</div>';
  }
  // Platform ledger cells reuse the exact current member query; rendering and
  // sorting never request more data or infer identities from a display name.
  function platformLabel(direction){return '实际'+(direction==='charge'?'充值':'取款')+(multiple(view())?'人次':'人数');}
  function platformMetric(platformIds,direction){
   const s=view(),inputs=Array.isArray(platformIds)?platformIds:[platformIds],ids=[...new Set(inputs.filter(id=>typeof id==='string'&&id))],unknown=inputs.filter(id=>typeof id!=='string'||!id).length,expected=ids.length+unknown;
   const observed=directions.includes(direction)?s.results.filter(r=>ids.includes(r.platform.id)&&r.rows.some(row=>row.direction===direction)):[],unavailable=observed.flatMap(r=>r.rows.filter(row=>row.direction===direction&&row.success_in_window!==false&&row.success_available===false)),matched=observed.filter(r=>r.rows.some(row=>row.direction===direction&&row.success_in_window!==false&&row.success_available!==false));
   const rows=matched.flatMap(r=>r.rows.filter(row=>row.direction===direction&&row.success_in_window!==false&&row.success_available!==false));
   const members=rows.reduce((n,r)=>n+r.success_member_count,0),orders=rows.reduce((n,r)=>n+r.success_order_count,0),missing=rows.reduce((n,r)=>n+r.success_missing_member_count,0);
   const partial=!expected||matched.length<expected||missing>0,value=!matched.length||members===0&&partial?null:members;
   const reasons=[...unavailable.map(row=>unavailableReason(row,'success')),...ids.filter(id=>!observed.some(r=>r.platform.id===id)).map(id=>s.failures.find(p=>p.id===id)?.error||s.unsupported.find(p=>p.id===id)?.reason||status(s)||'该平台当前方向人数尚未读取')];
   const title='按成功时间统计；同平台当地日按会员 ID 去重，跨三方只计一次。'+(multiple(s)?'多日为每日去重人次之和，不是整个期间去重人数。':'同日各平台分别去重，平台之间不合并会员。')+
    '已读取 '+C(matched.length)+' / '+C(expected)+' 平台；'+(unavailable.length?'部分成功订单会员 ID 覆盖不可统计。':'成功订单会员 ID 覆盖 '+C(orders-missing)+' / '+C(orders)+' 笔。')+(missing?C(missing)+' 笔未提供会员 ID，未计入人数。':'')+
    (partial?'当前仅显示已知人数，* 表示部分数据。':'')+(reasons.length?[...new Set(reasons)].join('；')+'。':'')+'仅统计已采集订单，源系统完整性尚未核验。'+(observed.some(result=>duoli(result.platform))?duoliBasis:'');
   const display=value===null?'—':C(value),html='<span class="df-platform-member-count" tabindex="0" title="'+E(title)+'">'+display+(value!==null&&partial?'<sup aria-label="部分数据">*</sup>':'')+'</span>';
   return {value,display,html,partial,label:platformLabel(direction),title,coverage:{complete:!partial,receivedPlatforms:matched.length,expectedPlatforms:expected,successOrderCount:unavailable.length?null:orders,missingMemberOrderCount:unavailable.length?null:missing,sourceCompletenessVerified:matched.length>0&&matched.every(r=>r.sourceCompletenessVerified)}};
  }
  function platformCount(platformIds,direction){return platformMetric(platformIds,direction).html;}
  const rowValue=(r,basis)=>{if(!r)return '—';if(r[basis+'_available']===false)return '—<small class="cell-sub">'+E(unavailableReason(r,basis))+'</small>';const members=r[basis+'_member_count'],missing=r[basis+'_missing_member_count'];return (members===0&&missing?'—':C(members))+(missing?'<small class="cell-sub">'+(members?'已知人数；':'')+C(missing)+' 笔未提供会员 ID</small>':'');};
  function frequencyValues(row,basis,supported){
   if(row&&Object.hasOwn(row,basis+'_frequency_supported'))supported=row[basis+'_frequency_supported'];
   if(row?.[basis+'_available']===false)return {reason:unavailableReason(row,basis)};
   if(!row||!supported)return {reason:'尚未接入频次统计'};
   const values=thresholds.map(n=>row[basis+'_members_ge'+n]);
   if(values.every(v=>v===undefined||v===null))return {reason:'尚未接入频次统计'};
   if(values.some((v,i)=>!count(v)||v>row[basis+'_member_count']||i>0&&v>values[i-1]))return {reason:'频次数据待核对'};
   return {values};
  }
  function details(tab='members',basis='success'){
   tab=tab==='frequency'?'frequency':'members';basis=basis==='created'?'created':'success';
   const s=view(),combined=new Map();
   for(const result of s.results)for(const row of result.rows){const key=result.platform.id+'|'+row.date;if(!combined.has(key))combined.set(key,{date:row.date,platform:result.platform,frequencySupported:result.frequencySupported});combined.get(key)[row.direction]=row;}
   const sorted=[...combined.values()].sort((a,b)=>b.date.localeCompare(a.date)||String(a.platform.name).localeCompare(String(b.platform.name))||a.platform.id.localeCompare(b.platform.id));
   const platformCell=r=>E(r.platform.name)+'<small class="cell-sub">'+E(r.platform.source)+' · '+E(r.platform.timezone)+'</small>';
   const click=(target,mode=basis)=>"liveMemberCountsDetails('"+target+"','"+mode+"')";
   const tabs='<div class="live-tabs"><button type="button" class="'+(tab==='members'?'on':'')+'" onclick="'+click('members')+'">每日人数</button><button type="button" class="'+(tab==='frequency'?'on':'')+'" onclick="'+click('frequency')+'">提款频次</button></div>';
   const coverage=(tab==='frequency'?['withdraw']:directions).map(d=>{const a=aggregate(s,d,'created'),b=aggregate(s,d,'success');if(!a.received&&!a.unavailable.length&&!b.unavailable.length)return '';return '<div class="live-definition">'+(d==='charge'?'充值':'提款')+'：已读取 '+C(a.received)+' / '+C(a.expected)+' 平台；'+(a.unavailable.length?E(a.unavailable.join('；'))+'；':'创建订单会员 ID 覆盖 '+C(a.orders-a.missing)+' / '+C(a.orders)+' 笔；')+(b.unavailable.length?E(b.unavailable.join('；'))+'。':'成功订单会员 ID 覆盖 '+C(b.orders-b.missing)+' / '+C(b.orders)+' 笔。')+'</div>';}).join('');
   const problems=[...s.unsupported.map(p=>[p.name,p.reason]),...s.failures.map(p=>[p.name,'读取失败：'+p.error])].map(([name,reason])=>'<div class="live-definition">'+E(name)+'：'+E(reason)+'</div>').join('');
   let definition,table;
   if(tab==='frequency'){
    const relevant=sorted.filter(r=>r.withdraw&&r.withdraw[basis+'_in_window']!==false),basisLabel=basis==='created'?'创建提款':'成功提款';
    definition='<div class="live-tabs"><button type="button" class="'+(basis==='success'?'on':'')+'" onclick="'+click('frequency','success')+'">成功提款</button><button type="button" class="'+(basis==='created'?'on':'')+'" onclick="'+click('frequency','created')+'">创建提款</button></div><div class="live-definition">按平台当地日及会员 ID 统计所选时间内的'+basisLabel+'次数，同一会员跨三方合并。≥2、≥3、≥4、≥5 为累计门槛，互相包含，不能相加。缺失会员 ID 的订单不计；存在缺失时只展示已知人数。仅统计已采集订单，源系统完整性尚未核验。</div>';
    const rows=relevant.map(r=>{const row=r.withdraw,frequency=frequencyValues(row,basis,r.frequencySupported),missing=row[basis+'_missing_member_count'],noIds=row[basis+'_member_count']===0&&missing>0;return '<tr><td>'+E(r.date)+'</td><td>'+platformCell(r)+'</td><td>'+rowValue(row,basis)+(frequency.reason?'<small class="cell-sub">'+E(frequency.reason)+'</small>':'')+'</td>'+thresholds.map((n,i)=>'<td>'+(!frequency.values||noIds?'—':C(frequency.values[i])+(missing?'<small class="cell-sub">已知</small>':''))+'</td>').join('')+'</tr>';}).join('');
    const available=relevant.filter(r=>frequencyValues(r.withdraw,basis,r.frequencySupported).values).length;
    table='<div class="live-definition">已读取明细中，频次已提供 '+C(available)+' / '+C(relevant.length)+' 个平台日'+(available<relevant.length||relevant.some(r=>r.withdraw[basis+'_missing_member_count']>0)||s.failures.length||s.unsupported.length?' · 部分数据':'')+'</div>'+(!relevant.length?'<div class="live-status">当前范围没有可用的提款每日明细；仅选充值时请改为提款或全部方向。</div>':'')+'<div class="live-table"><table><thead><tr><th>日期</th><th>平台</th><th>'+basisLabel+'人数</th>'+thresholds.map(n=>'<th>≥'+n+'次人数</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
   }else{
    definition='<div class="live-definition">按平台当地日、方向及会员 ID 去重；同一会员使用多个三方只计一次。创建人数按创建时间，成功人数按所选成功时间或源订单更新时间；两个范围分别统计。多日合计为每日去重人次，各平台分别计算，不能视为整个期间或跨平台的去重人数。缺失会员 ID 的订单不计人数。仅统计已采集订单，源系统完整性尚未核验。</div>';
    const rows=sorted.map(r=>'<tr><td>'+E(r.date)+'</td><td>'+platformCell(r)+'</td><td>'+rowValue(r.charge,'created')+'</td><td>'+rowValue(r.charge,'success')+'</td><td>'+rowValue(r.withdraw,'created')+'</td><td>'+rowValue(r.withdraw,'success')+'</td></tr>').join('');
    table='<div class="live-table"><table><thead><tr><th>日期</th><th>平台</th><th>充值人数</th><th>成功充值人数</th><th>提款人数</th><th>成功提款人数</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
   }
   const notice=readNotice(s);c.open('每日充值 / 提款人数','<div class="live-member-counts-detail">'+tabs+definition+(windowNotice(s)?'<div class="live-definition">'+E(windowNotice(s))+'</div>':'')+coverage+(notice?'<div class="live-definition">'+E(notice)+'</div>':'')+(status(s)?'<div class="live-status">'+E(status(s))+retry(s)+'</div>':retry(s))+problems+table+'</div>');
  }
  return {ensure,beginQuery,load:(force=true)=>ensure(force),cancel,metric,platformLabel,platformMetric,platformCount,details,capture:()=>({...S,status:S.status==='loading'?'paused':S.status,results:[...S.results],failures:[...S.failures],error:S.status==='loading'?'人数读取已暂停':S.error}),restore:value=>{serial++;pending=null;nextForce=false;waiters.splice(0).forEach(wake=>wake());S=value?{...value,results:[...value.results],failures:[...value.failures]}:initial();},get state(){return S}};
 }
 root.HensemLiveMemberCounts={create};
 if(typeof module!=='undefined')module.exports={create,requestFor,validate,dailySlices};
})(typeof window!=='undefined'?window:globalThis);
