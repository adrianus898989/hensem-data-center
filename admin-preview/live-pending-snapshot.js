/* Today's latest pending orders share the queried creation range; historical dates retain local-midnight snapshots. */
(function(root){
 'use strict';
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
 const token=value=>String(value||'').trim().toUpperCase();
 const names=p=>new Set([p.name,p.sourceName,p.rawPlatform,...(p.feeds||[]).map(f=>f.rawPlatform||f.name)].map(token).filter(Boolean));
 const known=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0;
 const countKnown=value=>known(value)&&Number.isSafeInteger(Number(value));
 const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 const previousDay=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 function localDay(now,timezone){
  try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)),part=k=>parts.find(p=>p.type===k)?.value;return part('year')+'-'+part('month')+'-'+part('day');}catch{throw Error('所选国家时区待核对');}
 }
 function requestPeriod(endDay,timezone,now){
  if(!dateValid(endDay))throw Error('请选择有效结束日期');
  const today=localDay(now,timezone);
  if(endDay>today)throw Error('结束日期不能晚于当地今天');
  return endDay===today?{mode:'current'}:{mode:'midnight',date:endDay};
 }
 function resolvePlatforms(selected,seeds){
  const ids=new Set(),unsupported=[];
  for(const p of selected||[]){
   if(p.capabilities?.pendingSnapshotAvailable===false){unsupported.push({id:p.id||'',name:p.name||'未提供平台名',state:'unsupported',reason:'此来源未接入代付中存量'});continue;}
   if(uuid(p.id)){ids.add(p.id.toLowerCase());continue;}
   const candidates=(seeds||[]).filter(s=>uuid(s.id)&&s.country===p.country&&String(s.team||'__unassigned__')===String(p.team||'__unassigned__')&&[...names(s)].some(n=>names(p).has(n))),matches=[...new Set(candidates.map(s=>s.id.toLowerCase()))];
   if(matches.length===1)ids.add(matches[0]);else unsupported.push({id:p.id||'',name:p.name||'未提供平台名',state:'unsupported',reason:matches.length?'目录身份待核对':'尚无可查询的待付目录'});
  }
  return {platformIds:[...ids].sort(),unsupported};
 }
 function validateResponse(r,q){
  const mode=q.request.mode,basis=mode==='current'?'current_all_pending_stock':'local_midnight_pending_snapshot';
  if(r?.version!==2||r.mode!==mode||r.basis!==basis||r.date!==(mode==='current'?null:q.request.date)||r.sourceDate!==(mode==='current'?null:previousDay(q.request.date))||!Array.isArray(r.rows)||typeof r.complete!=='boolean'||!Number.isInteger(r.expectedPlatformCount)||r.expectedPlatformCount<1||r.expectedPlatformCount>q.request.platformIds.length||!Number.isInteger(r.receivedPlatformCount)||r.receivedPlatformCount<0||r.receivedPlatformCount>r.expectedPlatformCount||!Number.isFinite(Date.parse(r.queriedAt)))throw Error('待付响应不完整，请重试');
  const rowIds=new Set(),wanted=new Set(q.request.platformIds),currencies=new Set(),states=new Set(['complete','partial','missing','stale','invalid','ambiguous','unsupported']);
  for(const row of r.rows){
   if(!row||!states.has(row.state)||typeof row.wholeStockComplete!=='boolean'||!Array.isArray(row.selectedIds)||!row.selectedIds.length||!Array.isArray(row.groups)||!Array.isArray(row.settlementAmounts))throw Error('平台待付响应不完整，请重试');
   for(const id of row.selectedIds){if(!wanted.has(id)||rowIds.has(id))throw Error('待付平台范围待核对');rowIds.add(id);}
   if(row.currency)currencies.add(row.currency);
   if(row.wholeStockComplete&&(row.state!=='complete'||!countKnown(row.count)||!known(row.amount)))throw Error('平台待付合计待核对');
   if(!row.wholeStockComplete&&(row.count!==null||row.amount!==null))throw Error('平台待付完整性待核对');
   if(row.knownCount!==null&&!countKnown(row.knownCount)||row.knownAmount!==null&&!known(row.knownAmount))throw Error('平台待付小计待核对');
   for(const group of row.groups){if(!group||group.knownCount!==null&&!countKnown(group.knownCount)||group.knownAmount!==null&&!known(group.knownAmount)||group.count!==null&&!countKnown(group.count)||group.amount!==null&&!known(group.amount)||!Array.isArray(group.settlementAmounts))throw Error('原通道待付小计待核对');}
   for(const value of [...row.settlementAmounts,...row.groups.flatMap(g=>g.settlementAmounts)]){if(!value||!known(value.amount)||!countKnown(value.count)||!countKnown(value.missingCount)||!['complete','partial'].includes(value.state))throw Error('原生结算金额待核对');}
  }
  if(rowIds.size!==wanted.size||r.rows.length!==r.expectedPlatformCount||typeof r.currency!=='string'||!r.currency||currencies.size>1||[...currencies].some(v=>v!==r.currency))throw Error('待付币种或平台范围待核对');
  if(r.knownCount!==null&&!countKnown(r.knownCount)||r.knownAmount!==null&&!known(r.knownAmount))throw Error('待付小计待核对');
  if(r.complete&&(!countKnown(r.count)||!known(r.amount)||r.receivedPlatformCount!==r.expectedPlatformCount||r.rows.some(row=>!row.wholeStockComplete)||Number(r.count)!==r.rows.reduce((n,row)=>n+Number(row.count),0)))throw Error('待付合计待核对，请重试');
  if(!r.complete&&(r.count!==null||r.amount!==null))throw Error('待付完整性待核对，请重试');
  return r;
 }
 function create(c){
  const {L,E,N,C}=c;
  let serial=0,task=null,active=null,queued=null,S={status:'idle',key:'',data:null,unsupported:[],error:''};
  // Successful historical reads only, scoped to this document and authorization
  // context. No local/session storage, error caching, or current-order snapshots.
  const cache=new Map(),cacheTTL=300000,cacheEntries=32,cacheBytes=4*1024*1024,cacheItemBytes=1024*1024;
  let cacheSize=0,cacheAccess='';
  const encode=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  const bytes=value=>{let size=0;for(const char of value){const code=char.codePointAt(0);size+=code<=127?1:code<=2047?2:code<=65535?3:4;}return size;};
  const clock=()=>{const value=c.cacheNow?.()??Date.now();return Number.isFinite(value)?value:Date.now();};
  const forget=key=>{const entry=cache.get(key);if(entry){cacheSize-=entry.bytes;cache.delete(key);}};
  const clearCache=()=>{cache.clear();cacheSize=0;};
  const access=()=>{let value='';try{const context=c.accessContext?.();if(typeof context==='string'&&context.trim()||context&&typeof context==='object'&&!Array.isArray(context)&&Object.keys(context).length)value=encode(context)||'';}catch{}if(value!==cacheAccess){clearCache();cacheAccess=value;}return value;};
  const zone=()=>c.scopeZone?.()||c.selected().find(p=>p.timezone)?.timezone||'UTC';
  const scope=()=>{const selected=c.selected(),mapped=resolvePlatforms(selected,L.withdrawCatalog),providers=[...new Set(c.providers().filter(Boolean))].sort(),timezone=zone(),period=requestPeriod(String(L.to||'').slice(0,10),timezone,L.queryNow||Date.now()),filters=Object.fromEntries(['from','to','country','currency','team','source','platform','provider','direction','status','multi','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr'].map(field=>[field,L[field]??null]));return {...mapped,request:{action:'pendingSnapshot',...period,platformIds:mapped.platformIds,...(providers.length?{providers}:{})},country:L.country,timezone,access:access(),selection:encode(selected),filters:encode(filters)};};
  const key=q=>encode([q.access,q.country,q.timezone,q.request,q.unsupported,q.selection,q.filters]);
  const sameScope=q=>{try{return key(q)===key(scope())}catch{return false}};
  const completeForCache=(q,r)=>q.access&&q.request.mode==='midnight'&&!q.unsupported.length&&c.catalogComplete?.()!==false&&r.complete===true&&r.receivedPlatformCount===r.expectedPlatformCount&&(r.missingPlatforms===undefined||Array.isArray(r.missingPlatforms)&&!r.missingPlatforms.length)&&r.rows.every(row=>row.state==='complete'&&row.wholeStockComplete===true&&row.groupsLimited!==true&&[row,...row.groups].every(group=>(group.state===undefined||group.state==='complete')&&group.wholeStockComplete!==false&&countKnown(group.count)&&known(group.amount)&&group.settlementAmounts.every(value=>value.state==='complete'&&Number(value.missingCount)===0)));
  function cached(q){
   if(!q.access||q.request.mode!=='midnight'||q.unsupported.length||c.catalogComplete?.()===false)return null;
   const now=clock();for(const [id,entry]of cache)if(now<entry.savedAt||now>=entry.savedAt+cacheTTL)forget(id);
   const id=key(q),entry=cache.get(id);if(!entry)return null;
   try{const data=validateResponse(JSON.parse(entry.json),q);if(!completeForCache(q,data)){forget(id);return null;}cache.delete(id);cache.set(id,entry);return {data,cachedAt:entry.savedAt};}catch{forget(id);return null;}
  }
  function remember(q,r){
   if(!completeForCache(q,r))return;
   try{const id=key(q),json=JSON.stringify(r),size=bytes(id)+bytes(json);if(size>cacheItemBytes)return;forget(id);while(cache.size>=cacheEntries||cacheSize+size>cacheBytes)forget(cache.keys().next().value);cache.set(id,{json,bytes:size,savedAt:clock()});cacheSize+=size;}catch{}
  }
  // Invalidate publication, not the transport lock. The bridge cancels/bounds
  // its request; a replacement must still wait until that promise settles.
  const cancel=()=>{serial++;queued=null;if(S.status==='loading')S={...S,status:'paused',data:null,error:'读取已暂停，点击重试'};};
  const canLoad=()=>!L.dirty&&c.canLoad?.()!==false;
  const idle=()=>({status:'idle',data:null,unsupported:[],error:''});
  // Read through the same query results on every render. A successful empty
  // native response proves zero; an absent, failed or report-only response does not.
  function currentOrdersView(){
   const context=c.currentOrders?.();
   if(L.dirty||!context?.scopeMatches)return idle();
   if(L.direction==='charge')return {status:'error',data:null,unsupported:[],error:'请选择全部业务或代付，当前仅代收查询不包含代付中订单'};
   if(context.status&&!['all','pending'].includes(context.status))return {status:'error',data:null,unsupported:[],error:'请选择全部状态或代付中，当前状态筛选不包含全部代付中订单'};
   const selected=c.selected(),platforms=context.platforms||[],results=context.results||[],failures=context.failures||[],native=new Set(platforms.map(p=>p.id)),currencies=new Set();
   if(!selected.length)return {status:'error',data:null,unsupported:[],error:'当前范围没有可查询平台'};
   const field=(rows,name,isCount=false)=>{if(!rows.every(r=>(isCount?countKnown:known)(r[name])))return null;const sum=rows.reduce((sum,r)=>sum+Number(r[name]),0);return (isCount?countKnown:known)(sum)?sum:null;};
   // Generic aggregate merging treats absent numeric fields as zero. Pending
   // completeness must instead inspect the original response for every window.
   const sourceParts=(result,seen=new Set())=>{if(!result||seen.has(result))return null;if(!Object.prototype.hasOwnProperty.call(result,'_parts'))return [result];if(!Array.isArray(result._parts)||!result._parts.length)return null;seen.add(result);const parts=result._parts.map(part=>sourceParts(part,seen));seen.delete(result);return parts.every(Boolean)?parts.flat():null;};
   const validRows=rows=>Array.isArray(rows)&&rows.every(r=>r&&typeof r==='object'&&['charge','withdraw'].includes(r.direction));
   const validCurrency=value=>typeof value==='string'&&value.trim()!=='';
   const rows=selected.map(p=>{
    const found=results.filter(r=>r.platform?.id===p.id),failure=failures.find(f=>f.id===p.id),base={...p,selectedIds:[p.id],coverageScope:'queried_creation_range',count:null,amount:null,knownCount:null,knownAmount:null,wholeStockComplete:false,settlementAmounts:[],groups:[],observedAt:null};
    if(p.reportOnly||p.capabilities?.pendingSnapshotAvailable===false)return {...base,state:'unsupported',reason:'orders_not_available'};
    if(!native.has(p.id)||!found.length||failure)return {...base,state:'missing',reason:failure?'orders_query_failed':'orders_not_read',error:failure?.message||''};
    if(found.length!==1||!Array.isArray(found[0].summary))return {...base,state:'invalid',reason:'orders_response_invalid'};
    const result=found[0],parts=sourceParts(result);
    if(!parts||!parts.every(part=>validRows(part.summary)))return {...base,state:'invalid',reason:'orders_response_invalid'};
    const summary=parts.flatMap(part=>part.summary.filter(r=>r.direction==='withdraw')),rowCurrencies=new Set(summary.map(r=>r.currency).filter(validCurrency)),currency=summary.length?rowCurrencies.size===1&&summary.every(r=>validCurrency(r.currency))?[...rowCurrencies][0]:null:validCurrency(p.currency)?p.currency:null;
    for(const r of summary)if(validCurrency(r.currency))currencies.add(r.currency);
    const count=field(summary,'pending_count',true),amount=currency?field(summary,'pending_amount'):null;
    const providerPartsValid=parts.every(part=>validRows(part.groups?.provider)),providerRows=new Map();
    for(const part of parts)for(const g of Array.isArray(part.groups?.provider)?part.groups.provider:[]){if(!g||g.direction!=='withdraw')continue;const key=JSON.stringify([g.provider??null,g.currency??null]);if(!providerRows.has(key))providerRows.set(key,[]);providerRows.get(key).push(g);}
    const groups=[...providerRows.values()].map(items=>{const g=items[0],currency=validCurrency(g.currency)?g.currency:null,count=providerPartsValid?field(items,'pending_count',true):null,amount=providerPartsValid&&currency?field(items,'pending_amount'):null;return {provider:g.provider,currency,count,amount,knownCount:count,knownAmount:amount,countComplete:count!==null,amountComplete:amount!==null,wholeStockComplete:count!==null&&amount!==null,settlementAmounts:[]};});
    if(!summary.length&&currency)currencies.add(currency);
    const valid=count!==null&&amount!==null;
    return {...base,currency,count,amount,knownCount:count,knownAmount:amount,countComplete:count!==null,amountComplete:amount!==null,wholeStockComplete:valid,state:valid?'complete':'partial',reason:!currency?'orders_currency_unknown':count===null?'orders_count_unknown':amount===null?'orders_amount_unknown':'',groups,read:true};
   });
   const read=rows.filter(r=>r.read).length,countComplete=rows.every(r=>r.countComplete),singleCurrency=currencies.size===1&&rows.filter(r=>r.read).every(r=>r.currency),amountComplete=singleCurrency&&rows.every(r=>r.amountComplete),knownCount=rows.some(r=>countKnown(r.count))?rows.reduce((n,r)=>n+(countKnown(r.count)?Number(r.count):0),0):null,knownAmount=singleCurrency&&rows.some(r=>known(r.amount))?rows.reduce((n,r)=>n+(known(r.amount)?Number(r.amount):0),0):null;
   const data={mode:'current',basis:'created_range_latest_pending_orders',queriedAt:context.queriedAt,currency:singleCurrency?[...currencies][0]:null,multiCurrency:currencies.size>1,complete:countComplete&&amountComplete,countComplete,amountComplete,expectedPlatformCount:rows.length,receivedPlatformCount:read,count:countComplete?knownCount:null,amount:amountComplete?knownAmount:null,knownCount,knownAmount,rows};
   return {status:context.loading||context.retrying?'loading':context.paused?'paused':'ready',data,unsupported:[],error:context.paused?'订单读取已暂停，请继续读取未完成平台':''};
  }
  const view=()=>{try{const q=scope();return q.request.mode==='current'?currentOrdersView():L.dirty||S.key!==key(q)?idle():S}catch{return S.status==='error'?S:idle()}};
  const time=(value,timezone)=>{if(!value||!Number.isFinite(Date.parse(value)))return '—';try{return new Intl.DateTimeFormat('sv-SE',{timeZone:timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value))}catch{return '—'}};
  const current=()=>{try{return scope().request.mode==='current'}catch{return S.data?.mode==='current'}};
  const title=()=>current()?(String(L.from||'').slice(0,10)===String(L.to||'').slice(0,10)?'今日实时代付中':'本期实时代付中'):'00:00代付中';
  const catalogComplete=()=>c.catalogComplete?.()!==false;
  const complete=s=>s.status==='ready'&&s.data?.complete===true&&!s.unsupported.length&&catalogComplete();
  const positive=s=>s.data&&(Number(s.data.knownCount)>0||Number(s.data.knownAmount)>0);
  const value=(s,field,format)=>{if(s.data?.basis==='created_range_latest_pending_orders'&&s.data[field+'Complete']&&known(s.data[field])||complete(s)&&known(s.data[field]))return format(s.data[field]);const subtotal=s.data?.['known'+field[0].toUpperCase()+field.slice(1)];return known(subtotal)&&Number(subtotal)>0?format(subtotal):'—'};
  const totals=s=>({amount:value(s,'amount',N),count:value(s,'count',C)});
  const coverageCounts=s=>({expected:(s.data?.expectedPlatformCount||0)+s.unsupported.length,full:(s.data?.rows||[]).filter(r=>r.wholeStockComplete).length,stored:(s.data?.rows||[]).filter(r=>r.wholeStockComplete||Number(r.knownCount)>0||Number(r.knownAmount)>0||['partial','stale'].includes(r.state)&&r.captureId&&Number.isFinite(Date.parse(r.observedAt))).length});
  const missing=s=>{const n=coverageCounts(s);return Math.max(0,n.expected-n.full)};
  const cacheHint=s=>{if(!s.cacheHit)return '';const now=clock(),expired=!Number.isFinite(s.cachedAt)||now<s.cachedAt||now>=s.cachedAt+cacheTTL;return ' · 缓存读取于 '+time(s.data?.queriedAt,zone())+(expired?' · 缓存已过期，查询更新':'');};
  const status=s=>s.data?.basis==='created_range_latest_pending_orders'?(s.status==='loading'?'正在读取订单 · ':s.status==='paused'?'订单读取已暂停 · ':s.data.complete?'已读取 ':'已读取小计 · ')+C(s.data.receivedPlatformCount)+'/'+C(s.data.expectedPlatformCount)+' 平台'+(s.data.receivedPlatformCount<s.data.expectedPlatformCount?' · '+C(s.data.expectedPlatformCount-s.data.receivedPlatformCount)+' 未读取':'')+(s.data.multiCurrency?' · 多币种金额不相加':s.data.rows.some(r=>r.read&&!r.amountComplete)?' · 金额待补齐':'')+(s.data.rows.some(r=>r.read&&!r.countComplete)?' · 笔数待补齐':''):s.status==='loading'?'正在读取待付存量…':s.status==='error'?('待付读取失败：'+s.error):s.status==='paused'?s.error:!s.data?(current()?'点击查询读取代付订单':'点击查询读取待付存量'):complete(s)?'已核实 '+C(s.data.expectedPlatformCount)+' 平台'+cacheHint(s):(positive(s)?'已入库小计':'暂无已核实合计')+' · 入库 '+C(coverageCounts(s).stored)+'/'+C(coverageCounts(s).expected)+(catalogComplete()?' · '+C(missing(s))+' 未完整':' · 平台目录待确认（仅已知平台）');
  const subtitle=()=>{const s=view();if(current()){const from=String(L.from||'').slice(0,10),to=String(L.to||'').slice(0,10);return (from===to?to:from+' 至 '+to)+' · '+zone()+(s.data?' · 查询 '+time(s.data.queriedAt,zone()).slice(11):'');}return String(L.to||'').slice(0,10)+' 00:00 · '+zone()};
  const retry=s=>current()?(s.status==='paused'||s.data?.rows.some(r=>r.reason==='orders_query_failed')?' <button type="button" class="link" onclick="livePendingSnapshotRetry()">'+(s.status==='paused'?'继续读取':'重试未完成平台')+'</button>':''):['error','paused'].includes(s.status)||s.status==='ready'&&!complete(s)?' <button type="button" class="link" onclick="livePendingSnapshotRetry()">重试</button>':'';
  async function read(job){
   const {id}=job;let q=job.q;
   try{
    await c.prepare?.();if(id!==serial||!canLoad())return;q=scope();job.key=key(q);S={...S,key:job.key,unsupported:q.unsupported};
    if(q.request.mode==='current'){S={status:'idle',key:key(q),data:null,unsupported:[],error:''};c.render();return;}
    if(!q.request.platformIds.length)throw Error(q.unsupported.length?'所选平台尚无可查询的待付目录':'当前范围没有可查询平台');
    if(q.request.platformIds.length>250)throw Error('平台超过250个，请缩小筛选范围');
    if(job.force)forget(job.key);
    const hit=job.force?null:cached(q);
    if(hit){S={...S,status:'ready',data:hit.data,error:'',cacheHit:true,cachedAt:hit.cachedAt};c.render();return;}
    // hensemLiveRequest owns the finite 90-second transport deadline. Do not
    // race it with a timer that could unlock while the old request is live.
    const r=await c.request(q.request);if(id!==serial||!sameScope(q)||!canLoad())return;
    const data=validateResponse(r,q);remember(q,data);
    S={...S,status:'ready',data,error:'',cacheHit:false,cachedAt:null};
   }catch(error){if(id!==serial||!sameScope(q)||!canLoad())return;if(['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(error?.code))clearCache();S={...S,status:'error',data:null,error:error?.message||'暂时无法读取'};}
   if(id===serial)c.render();
  }
  async function drain(){
   while(queued){
    const job=queued;queued=null;
    if(job.id!==serial||!canLoad())continue;
    active=job;try{await read(job);}finally{active=null;}
   }
  }
  const startTask=()=>task=Promise.resolve().then(drain).finally(()=>{task=null;if(queued&&canLoad())return startTask();});
  function load(force=false){
   // The overview opens this gate only after its primary aggregate workers.
   // A click during those workers cannot start a competing snapshot request.
   if(!canLoad())return task||Promise.resolve();
   let q;try{q=scope()}catch(error){cancel();S={status:'error',key:'',data:null,unsupported:[],error:error.message};c.render();return task||Promise.resolve();}
   if(q.request.mode==='current'){cancel();S={status:'idle',key:key(q),data:null,unsupported:[],error:''};c.render();return Promise.resolve();}
   const nextKey=key(q),latest=queued||active;
   if(!force&&latest?.id===serial&&latest.key===nextKey)return task;
   if(force)forget(nextKey);
   queued={id:++serial,q,key:nextKey,force:force===true};S={status:'loading',key:nextKey,data:null,unsupported:q.unsupported,error:'',cacheHit:false,cachedAt:null};
   // One latest-only queue serves explicit retries and late catalog refreshes.
   // All callers await its drain, including a refresh queued during the read.
   if(!task)startTask();
   c.render();return task;
  }
  function refreshScope(){
   if(L.dirty||!['loading','ready','error'].includes(S.status))return;
   try{if(!current()&&S.key!==key(scope()))return load();}catch{return;}
   c.render();
  }
  function metric(){const s=view(),values=totals(s);return '<div class="df-flow-metric df-pending-snapshot"><span>'+title()+'金额 / 笔数</span><strong class="metric-link">'+values.amount+'</strong><small class="cell-sub">'+values.count+' 笔</small><small class="cell-basis">'+E(subtitle())+'</small><small class="df-coverage">'+E(status(s))+retry(s)+'</small></div>';}
  function summary(){const s=view(),values=totals(s);return '<div class="pending-dash-grid">'+[['金额',values.amount],['笔数',values.count]].map(([label,value])=>'<div class="pending-metric"><span>'+title()+label+'</span><strong>'+value+'</strong></div>').join('')+'</div><div class="live-definition">'+E(status(s))+retry(s)+'</div>';}
  const stateLabel=r=>({complete:'全量已核实',partial:'已入库小计',missing:'未采到记录',stale:'数据待刷新',invalid:'内容待核对',ambiguous:'来源待核对',unsupported:'尚未接入'}[r.state]||'待核对');
  const reasons={stored_status_not_source_complete:'入库状态未核实来源完整性',last_7_created_days_only:'仅最近7日创建窗口',capture_not_verified:'采集记录待核实',outside_midnight_window:'采集时间超出零点窗口',metadata_missing:'采集信息待补齐',target_ambiguous:'来源重复待核对',query_budget_exhausted:'读取未完成',receipt_inconsistent:'采集回执不一致',latest_capture_stale:'来源需刷新',full_capture_missing:'缺少全量采集回执',safe_current_layer_unavailable:'实时来源尚未接入',source_currency_mismatch:'来源币种待核对',orders_not_available:'未接入逐笔订单',orders_query_failed:'订单查询失败',orders_not_read:'订单尚未读取',orders_response_invalid:'订单响应待核对',orders_currency_unknown:'订单币种待核对',orders_count_unknown:'代付中笔数待补齐',orders_amount_unknown:'代付中金额待补齐'};
  const coverage=r=>r.coverageScope==='last_7_created_days'?'最近7日创建窗口'+(dateValid(r.windowStart)&&dateValid(r.windowEnd)?'（'+r.windowStart+' 至 '+r.windowEnd+'）':''):r.coverageScope==='all_current_pending'?'全部创建日期':r.coverageScope==='received_latest_order_rows'?'已入库待付，来源完整性未核实':'—';
  const rowValue=(r,field,format)=>r.wholeStockComplete&&known(r[field])?format(r[field]):known(r['known'+field[0].toUpperCase()+field.slice(1)])&&Number(r['known'+field[0].toUpperCase()+field.slice(1)])>0?format(r['known'+field[0].toUpperCase()+field.slice(1)]):'—';
  const settlements=values=>(values||[]).map(v=>'<span>'+E(v.currency||'—')+' '+(known(v.amount)?N(v.amount):'—')+' · '+(known(v.count)?C(v.count):'—')+' 笔'+(v.state==='partial'||Number(v.missingCount)>0?'（部分）':'')+'</span>').join('<br>')||'—';
  const openDetails=(heading,html)=>c.open(heading,'<div class="live-pending-snapshot-detail">'+html+'</div>');
  function currentDetails(s){
   const data=s.data,cell=(r,field,format)=>r[field+'Complete']&&known(r[field])?format(r[field]):'—',state=r=>r.read?r.wholeStockComplete?'订单已读取':'字段待补齐':r.state==='unsupported'?'未接入逐笔订单':r.state==='invalid'?'响应待核对':'未读取';
   const groups=r=>r.groups.length?'<details><summary>三方明细（'+C(r.groups.length)+'）</summary><div class="live-table"><table><thead><tr><th>三方</th><th>代付中笔数</th><th>代付中金额</th><th>币种</th></tr></thead><tbody>'+r.groups.map(g=>'<tr><td>'+E(g.provider||'未识别通道')+'</td><td>'+cell(g,'count',C)+'</td><td>'+cell(g,'amount',N)+'</td><td>'+E(g.currency||'—')+'</td></tr>').join('')+'</tbody></table></div></details>':'';
   const range='创建范围 '+String(L.from||'').replace('T',' ')+' 至 '+String(L.to||'').replace('T',' ')+' · '+zone();
   const body='<div class="live-definition">'+E(range)+' · 查询于 '+E(time(data.queriedAt,zone()))+' · '+E(status(s))+retry(s)+'</div><div class="live-definition">按所选创建范围统计状态仍为代付中的订单，以本次查询读到的最新采集状态为准。未读取的平台不计为零。</div><div class="live-table"><table><thead><tr><th>平台</th><th>系统</th><th>读取状态</th><th>代付中笔数</th><th>代付中金额</th><th>币种</th></tr></thead><tbody>'+data.rows.map(r=>'<tr><td>'+E(r.name||'—')+'</td><td>'+E(r.source||'—')+'</td><td>'+E(state(r))+(r.reason?'<small>'+E(reasons[r.reason]||r.reason)+'</small>':'')+(r.error?'<small>'+E(r.error)+'</small>':'')+'</td><td>'+cell(r,'count',C)+'</td><td>'+cell(r,'amount',N)+'</td><td>'+E(r.currency||'—')+'</td></tr>'+(r.groups.length?'<tr><td colspan="6">'+groups(r)+'</td></tr>':'')).join('')+'</tbody></table></div>';
   openDetails(title()+' · 平台明细',body);
  }
  function details(){
   const s=view();if(!s.data){openDetails(title(),'<div class="live-status">'+E(status(s))+retry(s)+'</div>'+s.unsupported.map(p=>'<div class="live-definition">'+E(p.name)+'：'+E(p.reason)+'</div>').join(''));return;}
   if(s.data.basis==='created_range_latest_pending_orders'){currentDetails(s);return;}
   const data=s.data,rows=[...data.rows,...s.unsupported];
   const groups=r=>(r.groups||[]).length?'<details><summary>原通道明细（'+C(r.groups.length)+'）'+(r.groupsLimited===true?' · 仅显示前200组，仍有未展示':'')+'</summary><div class="live-table"><table><thead><tr><th>三方</th><th>原通道</th><th>通道类型</th><th>笔数</th><th>金额</th><th>法币</th><th>原生结算金额</th></tr></thead><tbody>'+r.groups.map(g=>'<tr><td>'+E(g.provider||'未识别通道')+'</td><td>'+E(g.rawChannel||'—')+'</td><td>'+E(g.channelType||'—')+'</td><td>'+rowValue({...g,wholeStockComplete:r.wholeStockComplete},'count',C)+'</td><td>'+rowValue({...g,wholeStockComplete:r.wholeStockComplete},'amount',N)+'</td><td>'+E(g.currency||r.currency||'—')+'</td><td>'+settlements(g.settlementAmounts)+'</td></tr>').join('')+'</tbody></table></div></details>':'';
   const n=coverageCounts(s),coverageDetails='<details><summary>平台覆盖：已入库 '+C(n.stored)+'/'+C(n.expected)+' · 完整 '+C(n.full)+'/'+C(n.expected)+'</summary>'+rows.filter(r=>!r.wholeStockComplete).map(r=>'<div>'+E(r.name||'—')+' · '+E(stateLabel(r))+' · '+E(coverage(r))+'</div>').join('')+'</details>';
   const body='<div class="live-definition">'+E(subtitle())+' · '+E(status(s))+'</div>'+coverageDetails+'<div class="live-table"><table><thead><tr><th>平台</th><th>来源 / 状态</th><th>覆盖范围</th><th>笔数</th><th>金额</th><th>法币</th><th>原生结算金额</th><th>源刷新时间</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+E(r.name||'—')+'</td><td>'+E(r.source||'—')+' · '+E(stateLabel(r))+(r.reason?'<small>'+E(reasons[r.reason]||r.reason)+'</small>':'')+'</td><td>'+E(coverage(r))+'</td><td>'+rowValue(r,'count',C)+'</td><td>'+rowValue(r,'amount',N)+'</td><td>'+E(r.currency||'—')+'</td><td>'+settlements(r.settlementAmounts)+'</td><td>'+E(time(r.observedAt,r.timezone))+(r.lastRecordAt?'<small>入库 '+E(time(r.lastRecordAt,r.timezone))+'</small>':'')+'</td></tr>'+(r.groups?.length?'<tr><td colspan="8">'+groups(r)+'</td></tr>':'')).join('')+'</tbody></table></div>';
   openDetails(title()+' · 平台明细',body);
  }
  return {load,cancel,refreshScope,metric,summary,details,title,subtitle,detailLabel:()=> '平台明细 →',capture:()=>{const s=view();return {...s,status:s.status==='loading'?'paused':s.status,error:s.status==='loading'?'读取已暂停，点击重试':s.error};},restore:value=>{cancel();S=value?{...value}: {status:'idle',key:'',data:null,unsupported:[],error:''};},get state(){return view()}};
 }
 root.HensemLivePendingSnapshot={create,resolvePlatforms,requestPeriod};
 if(typeof module!=='undefined')module.exports={create,resolvePlatforms,requestPeriod};
})(typeof window!=='undefined'?window:globalThis);
