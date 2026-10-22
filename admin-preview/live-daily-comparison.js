/* Daily comparison consumes only authorized native-platform RPC responses.
 * Dates, coverage and nullable metrics remain attached to each returned day. */
(function(root){
 'use strict';
 const PAGE='daily_comparison',fields=['all_amount','all_count','success_amount','success_count'];
 const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=x=>(typeof x==='number'||typeof x==='string')&&String(x).trim()!==''&&Number.isFinite(Number(x))?Number(x):null;
 const count=x=>{const n=number(x);return n!==null&&Number.isSafeInteger(n)&&n>=0?n:null;};
 const date=x=>{const s=String(x||'').slice(0,10),n=new Date(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(+n)&&n.toISOString().slice(0,10)===s?s:null;};
 const shift=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const money=x=>number(x)===null?'—':Number(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const integer=x=>count(x)===null?'—':Number(x).toLocaleString('en-US');
 const fraction=(n,d)=>number(n)!==null&&number(d)>0?Number(n)/Number(d)*100:null;
 const percent=x=>number(x)===null?'—':Number(x).toFixed(2)+'%';
 const src=x=>String(x||'').toLowerCase().replaceAll('_','');
 const system=x=>({ar:'AR',newar:'新AR',wg:'WG',lg:'LG',game66:'AA',duoli:'多利',doli:'多利',kb:'KB',panda:'熊猫'}[src(x)]||x||'—');
 const copy=x=>JSON.parse(JSON.stringify(x));
 const zero=()=>({all_amount:0,all_count:0,success_amount:0,success_count:0});
 const unknown=note=>({...Object.fromEntries(fields.map(k=>[k,null])),ready:false,partial:true,note,leaves:[]});
 const total=(rows)=>Object.fromEntries(fields.map(k=>{const values=rows.map(r=>k.endsWith('_count')?count(r[k]):number(r[k]));const n=values.reduce((a,v)=>a+(v??0),0);return [k,!values.length||values.includes(null)||!Number.isFinite(n)||k.endsWith('_count')&&!Number.isSafeInteger(n)?null:n];}));
 const uniqPlatforms=list=>[...new Map((list||[]).filter(p=>typeof p?.id==='string'&&p.id).map(p=>[p.id,p])).values()];
 function create(c){
  const L=c.L;let serial=0,S=initial(),retained=null;
  function initial(){return {version:2,status:'idle',scope:null,payments:{},comparePayments:{},workorders:{},workStatus:'idle',trendStatus:'idle',workTrendStatus:'idle',direction:'charge',dimension:'platform',sort:'all_count',compareDate:'',trendDays:7,expanded:null,trend:null,error:''};}
  const allowed=action=>!c.roleAllowed||c.roleAllowed(action);
  const active=()=>c.getPage()===PAGE&&allowed('view');
  const authority=()=>String(c.accessContext?.()??'local-document');
  const nativeKey=p=>JSON.stringify([p.id,p.source,p.sourceName,p.country,p.identityCountry,p.rawCountry,p.timezone,p.currency,p.capabilities]);
  const nativeAuthorized=()=>!S.scope||S.scope.platforms.every(p=>(c.authorizedPlatforms?.()||c.selected()).some(current=>nativeKey(current)===nativeKey(p)));
  const authorized=()=>nativeAuthorized()&&active()&&allowed('query')&&!!authority()&&(!S.scope||S.scope.access===authority());
  const canonical=(v,country)=>String(root.HensemProviderNames?.canonical(v,country)??v??'').trim()||'未识别通道';
  const queryProviders=(providers,country)=>root.HensemProviderNames?.queryNames?.(providers,country)??providers.slice();
  function snapshots(){root.HensemStatisticWindows?.ensure(L);return {country:L.country,currency:L.currency,team:L.team,source:L.source,access:authority(),platforms:uniqPlatforms(c.selected()).map(p=>({...p})),native:uniqPlatforms(c.nativePlatforms()).map(p=>p.id),providers:(c.activeValues('provider','')||[]).slice().sort(),queryProviders:queryProviders(c.activeValues('provider','')||[],L.country).slice().sort(),date:date(L.from),from:L.from,to:L.to,successFrom:L.successFrom,successTo:L.successTo,successBasis:L.successBasis};}
  function scopeKey(v){return JSON.stringify([v.country,v.currency,v.team,v.source,v.access,v.platforms.map(p=>[p.id,p.source,p.currency,p.timezone,p.sourceName,p.identityCountry,p.rawCountry]).sort(),v.native.slice().sort(),v.queryProviders||v.providers,v.from,v.to,v.successFrom,v.successTo,v.successBasis,S.compareDate]);}
  function matches(){return !!S.scope&&!L.dirty&&S.scope.key===scopeKey(snapshots());}
  const current=()=>authorized()&&matches();
  const paint=()=>{if(active())c.render();};
  function cancel(){serial++;if(active())c.cancelReads?.();for(const key of ['status','workStatus','trendStatus','workTrendStatus'])if(S[key]==='loading')S[key]='paused';}
  function clear(){cancel();S=initial();retained=null;}
  function capture(){return copy(S);}
  function restore(value){cancel();retained=null;S=value?.version===2&&[7,15,30].includes(value.trendDays)&&['charge','withdraw','workorder'].includes(value.direction)&&value.scope?.access===authority()?copy(value):initial();for(const key of ['status','workStatus','trendStatus','workTrendStatus'])if(S[key]==='loading')S[key]='paused';}
  function dates(scope,trend=false){return trend?Array.from({length:S.trendDays+1},(_,i)=>shift(scope.date,-i)):[scope.date,S.scope?.compareDate||S.compareDate];}
  function period(day,p,scope){
   const delta=(Date.parse(day+'T00:00:00Z')-Date.parse(scope.date+'T00:00:00Z'))/86400000,window={successBasis:scope.successBasis};
   for(const key of ['from','to','successFrom','successTo'])window[key]=scope[key]?shift(scope[key].slice(0,10),delta)+scope[key].slice(10):'';
   const today=c.localClock(scope.now,p.timezone).slice(0,10);
   if(window.to.slice(0,10)>today||window.successTo&&window.successTo.slice(0,10)>today)throw Error('结束日期晚于平台当地今天');
   return {...root.HensemStatisticWindows.request(window,p,c.instant),local:window};
  }
  const published=p=>!!p&&p.calculationComplete===true&&Number.isFinite(Date.parse(p.expiresAt))&&(p.publicationVersion===2?['fresh','refresh_due'].includes(p.freshness)&&['idle','queued','running','failed'].includes(p.refreshState):Date.parse(p.expiresAt)>Date.now());
  const readable=entry=>entry?.status==='ready'&&published(entry.response?._preparedPublication);
  const fresh=entry=>readable(entry)&&Date.parse(entry.response._preparedPublication.expiresAt)>Date.now()&&entry.response._preparedPublication.freshness!=='refresh_due';
  function platformResponse(response,p,q){
   function verify(part){const actual=part?.platform,expectedCountry=part===response?p.country:p.identityCountry??p.rawCountry??p.country;
    if(!actual||actual.id!==p.id||actual.source&&src(actual.source)!==src(p.source)||actual.country&&actual.country!==expectedCountry||actual.currency&&actual.currency!==p.currency)throw Error('平台身份或币种响应不匹配');
    if(!Array.isArray(part.summary)||!Array.isArray(part.groups?.provider))throw Error('平台汇总或三方分组未完整返回');
   }
   verify(response);const publication=response._preparedPublication;
   if(!published(publication))throw Error('已准备统计已过期或计算未完成');
   for(const key of ['startAt','endAt',...(q.successStartAt?['successStartAt','successEndAt']:[])])if(Date.parse(response[key])!==Date.parse(q[key]))throw Error('已准备统计时间范围不匹配');
   if(q.successBasis==='created'&&(Object.hasOwn(response,'successStartAt')||Object.hasOwn(response,'successEndAt')||response.capabilities?.successCohort!=='created_at_current_stored_status'||response.capabilities?.independentSuccessWindow!==false))throw Error('创建订单状态统计口径不匹配');
   if(q.successBasis&&response.successBasis!==q.successBasis)throw Error('已准备统计时间依据不匹配');
   if(response._parts!==undefined){if(!Array.isArray(response._parts)||response._parts.length!==1)throw Error('已准备统计不接受现场分段查询');verify(response._parts[0]);}
   return {platform:response.platform,summary:response.summary,groups:{provider:response.groups.provider},capabilities:response.capabilities,withdrawSuccessTimeAvailable:response.withdrawSuccessTimeAvailable,chargeSuccessTimeAvailable:response.chargeSuccessTimeAvailable,successTimeAvailable:response.successTimeAvailable,_preparedPublication:publication,startAt:q.startAt,endAt:q.endAt,successStartAt:response.successStartAt,successEndAt:response.successEndAt,successBasis:response.successBasis};
  }
  async function runQueue(tasks,token,limit=6){let next=0;await Promise.all(Array.from({length:Math.min(limit,tasks.length)},async()=>{while(next<tasks.length&&token===serial&&current()){await tasks[next++]();}}));}
  function rejectAuthority(error){if(!['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(error?.code))return false;clear();S.status='error';S.error='查询权限或登录状态已变化，请重新验证';paint();return true;}
  function initializeDays(dayList,work=false){const target=work?S.workorders:S.payments,native=new Set(S.scope.native);for(const day of dayList){target[day]??={};for(const p of S.scope.platforms)target[day][p.id]??={status:(work?['ar','newar'].includes(src(p.source)):native.has(p.id))?'pending':'unsupported',note:work?'该来源尚未接入工单':native.has(p.id)?'统计尚未读取':'仅目录，未接入订单'};}}
  async function readPaymentDays(dayList,token,querySerial,forceRefresh=false){
   const scope=S.scope,native=new Set(scope.native);initializeDays(dayList);
   await runQueue(dayList.flatMap(day=>scope.platforms.filter(p=>native.has(p.id)).map(p=>async()=>{
    const entry=S.payments[day][p.id];if(day===scope.compareDate)S.comparePayments[p.id]=entry;if(fresh(entry))return;entry.status='loading';paint();
    try{const bounds=period(day,p,scope),q={action:'aggregate',view:'providers',platformId:p.id,startAt:bounds.startAt,endAt:bounds.endAt,successBasis:bounds.successBasis,...(bounds.successStartAt?{successStartAt:bounds.successStartAt,successEndAt:bounds.successEndAt}:{}),direction:'all',status:'all',currency:p.currency,offset:0,limit:20};if(scope.providers.length)q.providers=queryProviders(scope.providers,p.country||scope.country);
     const response=await c.readAggregate(q,querySerial,forceRefresh);if(token!==serial||!current())return;
     Object.assign(entry,{status:'ready',response:platformResponse(response,p,q),note:'已读取后台统计',local:bounds.local});
    }catch(error){if(token!==serial||!current())return;if(rejectAuthority(error))return;if(['stale','invalid'].includes(error?.status))retained=null;Object.assign(entry,{status:['missing','stale','building','unsupported'].includes(error?.status)?error.status:'error',note:error?.message||'读取失败'});}paint();
   })),token);
  }
  function paymentStatus(days){return days.some(day=>S.scope.platforms.some(p=>S.scope.native.includes(p.id)&&!readable(S.payments[day]?.[p.id])))?'partial':'ready';}
  async function load(force=false,forceRefresh=false){
   if(!active()||!allowed('query'))return;cancel();let scope;
   try{if(!root.HensemStatisticWindows)throw Error('统计时间组件未载入');root.HensemStatisticWindows.validate(L);scope=snapshots();if(!scope.country||scope.country==='all')throw Error('请选择一个国家。');
    if(!S.compareDate||S.compareDate>=scope.date)S.compareDate=shift(scope.date,-((Date.parse(scope.to.slice(0,10)+'T00:00:00Z')-Date.parse(scope.date+'T00:00:00Z'))/86400000+1));
    if(!date(S.compareDate))throw Error('对比开始日期无效。');
    const currencies=[...new Set(scope.platforms.map(p=>p.currency).filter(Boolean))];if(currencies.length!==1||currencies[0]!==scope.currency)throw Error('请选择同一原始币种的平台，金额不能跨币种相加。');
   }catch(error){S.error=error.message;S.status='error';paint();return;}
   scope.key=scopeKey(scope);const resume=!force&&S.scope?.key===scope.key&&['paused','partial'].includes(S.direction==='workorder'?S.workStatus:S.status);scope.now=Date.now();scope.compareDate=S.compareDate;
   const token=++serial,querySerial=++L.serial;S.scope=scope;S.status='loading';S.error='';if(!resume){S.payments={};S.comparePayments={};S.workorders={};S.workStatus='idle';S.trendStatus='idle';S.workTrendStatus='idle';S.expanded=null;S.trend=null;}L.pageQueried=true;L.dirty=false;L.loading=false;c.prepareFeeLookupQuery?.(force);
   if(S.direction==='workorder'){S.status='idle';await loadWorkorders(!resume);return;}
   paint();Promise.resolve(c.ensureFeeLookup()).catch(()=>{});await readPaymentDays(dates(scope),token,querySerial,forceRefresh);
   if(token!==serial||!current())return;S.status=paymentStatus(dates(scope));paint();
  }
  const workorderWindow=()=>S.scope&&S.scope.from===S.scope.date+'T00:00:00'&&S.scope.to===S.scope.date+'T23:59:59'&&(!S.scope.successFrom&&!S.scope.successTo||S.scope.successFrom===S.scope.from&&S.scope.successTo===S.scope.to)&&S.scope.successBasis==='success';
  async function loadWorkorders(force=false,trend=false){
   if(!current()||S.status==='loading'||S.workStatus==='loading'||S.workTrendStatus==='loading')return;
   if(!workorderWindow()){S.workStatus='unsupported';paint();return;}
   const token=++serial,scope=S.scope,key=trend?'workTrendStatus':'workStatus';S[key]='loading';if(force&&!trend)S.workorders={};const dayList=dates(scope,trend);initializeDays(dayList,true);
   paint();await runQueue(dayList.flatMap(day=>scope.platforms.filter(p=>['ar','newar'].includes(src(p.source))).map(p=>async()=>{
    const entry=S.workorders[day][p.id];if(entry.status==='ready'&&!force)return;entry.status='loading';paint();
    try{const q={action:'workorders',startAt:day+'T00:00:00.000Z',endAt:day+'T23:59:59.000Z',country:scope.country,platforms:[...new Set([p.name,p.sourceName].filter(Boolean))],direction:'all',offset:0,limit:20};if(scope.providers.length)q.providers=queryProviders(scope.providers,p.country||scope.country);
     const response=await c.request(q);if(token!==serial||!current())return;
     if(response?.startDate!==day||response?.endDate!==day||!response.summary||!Array.isArray(response.byPlatformProvider))throw Error('工单日期或全量平台三方汇总未完整返回');
     if(response.byPlatformProvider.some(row=>row.platformId!==p.id||row.source&&src(row.source)!==src(p.source)||row.country&&row.country!==p.country))throw Error('工单返回了不同原生平台，不能混入本平台');
     Object.assign(entry,{status:'ready',response,note:'已读取原始工单'});
    }catch(error){if(token!==serial||!current())return;if(rejectAuthority(error))return;Object.assign(entry,{status:'error',note:error?.message||'工单读取失败'});}paint();
   })),token,2);
   if(token!==serial||!current())return;S[key]=dayList.some(day=>Object.values(S.workorders[day]).some(v=>v.status==='error'))?'partial':'ready';paint();
  }
  async function loadTrend(){
   if(!current()||S.status==='loading'||S.trendStatus==='loading'||S.workStatus==='loading'||S.workTrendStatus==='loading')return;
   if(S.direction==='workorder')return loadWorkorders(false,true);
   if(!['ready','partial'].includes(S.status))return;const token=++serial,querySerial=++L.serial;S.trendStatus='loading';paint();const dayList=dates(S.scope,true);await readPaymentDays(dayList,token,querySerial);if(token!==serial||!current())return;S.trendStatus=paymentStatus(dayList);paint();
  }
  function enrich(row,p){
   const identity={platformId:p.id,platform:p.name,source:p.source,country:p.country,scopeGroup:p.scopeGroup};
   const out={...row,...identity,provider:canonical(row.provider,p.country)};
   for(const key of ['items','fee_items'])if(Array.isArray(row[key]))out[key]=row[key].map(child=>enrich(child,p));
   if(row.platformId&&row.platformId!==p.id||row.source&&src(row.source)!==src(p.source)||row.country&&![p.country,p.identityCountry??p.rawCountry??p.country].includes(row.country))out.nativeFeeIdentityVerified=false;
   return out;
  }
  function payment(day,p,providerName,comparison=false){
   const entry=comparison?S.comparePayments[p.id]:S.payments[day]?.[p.id];if(!readable(entry))return unknown(entry?.status==='ready'?'已准备统计已过期，请重新读取':entry?.note||'统计尚未读取');
   const response=entry.response,d=S.direction,raw=response.summary.filter(row=>row.direction===d),allLeaves=response.groups.provider.filter(row=>row.direction===d);
   if([...raw,...allLeaves].some(row=>row.currency!==p.currency))return unknown('返回币种缺失或不一致，未合并');
   if(new Set(raw.map(r=>r.currency)).size!==raw.length)return unknown('平台汇总重复，待核对');
   const leaves=allLeaves.map(r=>enrich(r,p)),subset=providerName?leaves.filter(r=>r.provider===providerName):leaves,sourceTotal=raw.length?total(raw):zero(),groupTotal=leaves.length?total(leaves):zero();
   const complete=fields.every(k=>number(sourceTotal[k])!==null&&number(groupTotal[k])!==null&&Math.abs(sourceTotal[k]-groupTotal[k])<=Math.max(1e-6,Math.abs(sourceTotal[k])*1e-10));
   let metrics;if(providerName){
    if(!subset.length&&!complete)return unknown('三方分组未完整，缺失分组不能视为零');
    metrics=subset.length?total(subset):zero();
   }else metrics=raw.length?total(raw):allLeaves.length?total(allLeaves):zero();
   const timeKey=d+'SuccessTimeAvailable',caps=response.capabilities||response.platform?.capabilities||p.capabilities||{},unavailable=response.successBasis!=='created'&&(caps[d+'SecondaryTimeAvailable']===false||caps.secondaryTimeAvailable===false||response.successTimeAvailable===false||caps.successTimeAvailable===false||response[timeKey]===false||caps[timeKey]===false);
   if(unavailable){metrics.success_count=null;metrics.success_amount=null;}
   return {...metrics,ready:true,finished:Math.max(Date.parse(response.endAt),Date.parse(response.successEndAt||response.endAt))<=S.scope.now,partial:!complete||fields.some(k=>metrics[k]===null)||!raw.length&&allLeaves.length>0,note:unavailable?'该来源未提供可核验'+(d==='charge'?'代收':'代付')+(S.scope.successBasis==='source_updated'?'源订单更新时间':'成功时间'):!raw.length&&allLeaves.length?'仅返回三方分组小计':!complete?'平台汇总已返回；三方分组未完整':'已读取订单记录',leaves:subset};
  }
  function tickets(day,p,providerName){
   const entry=S.workorders[day]?.[p.id];if(entry?.status!=='ready')return unknown(entry?.note||'工单尚未查询');
   const response=entry.response,rows=response.byPlatformProvider.filter(row=>!providerName||canonical(row.provider,p.country)===providerName),coverage=(response.coverage?.platforms||[]).filter(row=>row.platformId===p.id),nativeCoverage=coverage.length===1?coverage[0]:null,covered=nativeCoverage?.complete===true&&count(nativeCoverage.days)===1&&count(nativeCoverage.expectedDays)===1&&!(count(nativeCoverage.detailOnlyDays)>0);
   if(!nativeCoverage)return unknown('工单平台采集覆盖未提供或身份未确认');
   const metric=row=>({all_count:count(row.submittedCount),all_amount:number(row.submittedAmount),success_count:count(row.successCount),success_amount:number(row.successAmount)});
   const summary=metric(response.summary),leaves=response.byPlatformProvider.map(metric),sum=leaves.length?total(leaves):zero();
   const complete=fields.every(k=>summary[k]!==null&&sum[k]!==null&&Math.abs(summary[k]-sum[k])<=Math.max(1e-6,Math.abs(summary[k])*1e-10));
   if(providerName&&!rows.length&&!complete)return unknown('工单三方分组未完整，不能确认零');
   const facts=providerName?(rows.length?total(rows.map(metric)):zero()):summary;
   if(!covered&&!(facts.all_count>0||facts.success_count>0))return unknown('尚未收到该日完整工单，不能确认零');
   if(facts.success_count!==null&&facts.all_count!==null&&facts.success_count>facts.all_count)return unknown('已处理工单大于提交工单，待核对');
   return {...facts,ready:true,partial:!covered||!!providerName&&!complete||fields.some(k=>facts[k]===null),note:(!covered?'仅已采集部分；':'')+(providerName&&!complete?'三方分组未完整；':'')+'原始工单不去重；源状态4计已处理，不代表实际到账',leaves:[]};
  }
  function facts(day,p,name,comparison=false){return S.direction==='workorder'?tickets(day,p,name):payment(day,p,name,comparison);}
  function fee(fact){
   if(S.direction==='workorder'||fact.success_count===null)return {amount:null,matchedCount:null,eligibleCount:null,complete:false};
   const leaves=fact.leaves||[],row={...fact,direction:S.direction,currency:S.scope.currency,fee_items:leaves};
   return root.HensemProviderSummary?.currentReferenceFeeFacts(row,L.feeLookupRows,S.scope.country)||{amount:null,matchedCount:null,eligibleCount:null,complete:false};
  }
  function join(parts){const rows=parts.map(p=>p.fact),ready=rows.filter(r=>r.ready);return {...total(ready),ready:ready.length>0,partial:ready.length!==rows.length||ready.some(r=>r.partial),leaves:ready.flatMap(r=>r.leaves||[]),parts};}
  function entity(day,key,dimension=S.dimension,platformScope,comparison=false){
   const platforms=platformScope||S.scope.platforms,chosen=dimension==='platform'?platforms.filter(p=>p.id===key):platforms;
   return join(chosen.map(p=>({id:p.id,fact:facts(day,p,dimension==='provider'?key:null,comparison)})));
  }
  function comparable(a,b,suppressToday=true){
   if(suppressToday&&S.direction==='workorder'&&S.scope.platforms.some(p=>c.localClock(S.scope.now,p.timezone).slice(0,10)===S.scope.date))return {current:join([]),previous:join([]),count:0,partial:true};
   const eligible=p=>p.fact.ready&&p.fact.finished!==false&&(S.direction!=='workorder'||!p.fact.partial),keys=new Set(a.parts.filter(eligible).map(p=>p.id)),prior=new Map(b.parts.filter(eligible).map(p=>[p.id,p.fact]));
   const ids=[...keys].filter(id=>prior.has(id)),current=join(a.parts.filter(p=>ids.includes(p.id))),previous=join(ids.map(id=>({id,fact:prior.get(id)})));
   return {current,previous,count:ids.length,partial:ids.length!==S.scope.platforms.length};
  }
  function providerNames(){const values=[];for(const group of Object.values(S.direction==='workorder'?S.workorders:S.payments))for(const item of Object.values(group)){if(item.status!=='ready')continue;const rows=S.direction==='workorder'?item.response.byPlatformProvider:item.response.groups.provider.filter(row=>row.direction===S.direction);for(const row of rows)values.push(canonical(row.provider,S.scope.country));}return [...new Set(values)];}
  function model(applied=false){
   if(!S.scope||!authorized()||!applied&&!matches())return null;
   const ids=S.dimension==='platform'?S.scope.platforms.map(p=>p.id):providerNames();
   const rows=ids.map(key=>{const p=S.scope.platforms.find(p=>p.id===key),now=entity(S.scope.date,key),prior=entity(S.scope.compareDate,key,S.dimension,undefined,true);return {key,name:S.dimension==='platform'?p.name:key,kind:S.dimension==='platform'?system(p.source):root.HensemProviderSummary?.providerType({provider:key,fee_items:now.leaves},L.feeLookupRows,S.scope.country)?.label||'未标注',now,prior,comparison:comparable(now,prior)};});
   rows.sort((a,b)=>{const x=number(a.now[S.sort]),y=number(b.now[S.sort]);return x===null?(y===null?a.name.localeCompare(b.name):1):y===null?-1:y-x||a.name.localeCompare(b.name);});
   const all=(day,comparison=false)=>join(S.scope.platforms.map(p=>({id:p.id,fact:facts(day,p,null,comparison)}))),now=all(S.scope.date),prior=all(S.scope.compareDate,true),comparison=comparable(now,prior);
   return {rows,now,prior,comparison,all};
  }
  function filterDateExtras(){const selected=date(L.from),compare=S.compareDate||selected&&shift(selected,-1)||'';return '<label class="daily-date-extra">对比创建开始日期 <input type="date" value="'+E(compare)+'"'+(selected?' max="'+shift(selected,-1)+'"':'')+' onchange="liveDailyCompareDate(this.value)"></label><label class="daily-date-extra">趋势区间 <select onchange="liveDailyTrendDays(this.value)">'+[7,15,30].map(n=>'<option value="'+n+'" '+(S.trendDays===n?'selected':'')+'>'+n+' 天</option>').join('')+'</select></label>';}
  function changed(){cancel();L.dirty=true;S.expanded=null;paint();}
  root.liveDailyCompareDate=value=>{if(!active()||!date(value)||date(L.from)&&value>=date(L.from))return;S.compareDate=value;changed();};
  root.liveDailyTrendDays=value=>{if(!active()||![7,15,30].includes(Number(value)))return;if(S.trendStatus==='loading'||S.workTrendStatus==='loading')cancel();S.trendDays=Number(value);S.trendStatus='idle';S.workTrendStatus='idle';paint();};
  root.liveDailyDirection=value=>{if(!active()||!['charge','withdraw','workorder'].includes(value))return;if(S.direction!==value&&(S.direction==='workorder'||value==='workorder'))cancel();S.direction=value;S.expanded=null;S.trend=null;if(value!=='workorder'&&current())Promise.resolve(c.ensureFeeLookup()).catch(()=>{});paint();};
  root.liveDailyDimension=value=>{if(!current()||!['platform','provider'].includes(value))return;S.dimension=value;S.expanded=null;S.trend=null;paint();};
  root.liveDailySort=value=>{if(!current()||!['all_count','all_amount'].includes(value))return;S.sort=value;paint();};
  root.liveDailyExpand=index=>{if(!current()||!allowed('detail'))return;const row=model()?.rows[Number(index)];if(!row)return;S.expanded=S.expanded===row.key?null:row.key;S.trend=row.key;paint();};
  root.liveDailyTrend=index=>{if(!current())return;if(Number(index)===-1){S.trend='__all__';paint();return;}const row=model()?.rows[Number(index)];if(!row)return;S.trend=row.key;paint();};
  root.liveDailyLoadTrend=()=>loadTrend();
  root.liveDailyWorkorderQuery=()=>current()?loadWorkorders():load(true);root.liveDailyQuery=()=>load(true);root.liveDailyContinue=()=>S.direction==='workorder'?loadWorkorders():load(false);
  const successful=()=>S.direction==='workorder'?'已处理':'成功';
  function delta(a,b,key){const r=root.HensemLiveCompare?.delta(a[key],b[key]);return '<span class="daily-'+E(r?.trend||'unknown')+'">'+E(r?.display||'—')+'</span>';}
  function rate(r){const value=fraction(r.success_count,r.all_count);return '<span class="'+(value!==null&&value<40?'daily-low':'')+'">'+percent(value)+'</span>';}
  function rateChange(a,b){const fn=S.direction==='workorder'?'rateDelta':'ratioDelta',r=root.HensemLiveCompare?.[fn](a.success_count,a.all_count,b.success_count,b.all_count);return '<span class="daily-'+E(r?.trend||'unknown')+'">'+E(r?.display||'—')+'</span>';}
  const table=(heads,rows,footer,kind='')=>'<div class="daily-table-wrap"><table class="daily-table '+kind+'"><thead><tr>'+heads.map(h=>'<th>'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody>'+(footer?'<tfoot>'+footer+'</tfoot>':'')+'</table></div>';
  const cells=(values,heads)=>values.map((v,i)=>'<td data-label="'+E(heads[i])+'">'+v+'</td>').join('');
  // One schema drives headers, fixed widths, body cells and CSV columns.
  function detailColumns(history=false,child=false){
   const column=(label,kind,group='',short=label)=>({label,kind,group,short});
   const cols=history?[column(S.scope&&(S.scope.from.slice(0,10)!==S.scope.to.slice(0,10)||S.scope.successFrom.slice(0,10)!==S.scope.successTo.slice(0,10))?'创建开始日':'日期','identity')]:[column((S.dimension==='platform')!==child?'平台':'三方','identity'),column((S.dimension==='platform')!==child?'系统':'类型','kind')];
   for(const [prefix,group] of [['全部','全部'],[successful(),successful()]]){
    cols.push(column(prefix+'金额','amount',group,'金额'),column(prefix+'金额占比','percent',group,'金额占比'),column(prefix+'金额'+(history?'较前日':'涨跌'),'change',group,history?'金额较前日':'金额涨跌'),column(prefix+'笔数','count',group,'笔数'),column(prefix+'笔数占比','percent',group,'笔数占比'),column(prefix+'笔数'+(history?'较前日':'涨跌'),'change',group,history?'笔数较前日':'笔数涨跌'));
   }
   cols.push(column(S.direction==='workorder'?'处理率':'成功率','percent'),column('变化（百分点）','change'),column('参考手续费','fee'),column('费率匹配占比','percent'));
   return cols;
  }
  function detailTable(cols,rows,footer,kind=''){
   const width=col=>({identity:kind==='daily-history'?100:132,kind:68,amount:124,count:78,percent:74,change:84,fee:124}[col.kind]);
   let header='',sub='';for(let i=0;i<cols.length;){const col=cols[i];if(!col.group){header+='<th scope="col" rowspan="2" class="daily-col-'+col.kind+'">'+E(col.label)+'</th>';i++;continue;}let end=i;while(end<cols.length&&cols[end].group===col.group)end++;header+='<th scope="colgroup" colspan="'+(end-i)+'" class="daily-group-heading">'+E(col.group)+'</th>';for(;i<end;i++)sub+='<th scope="col" class="daily-col-'+cols[i].kind+'" title="'+E(cols[i].label)+'">'+E(cols[i].short)+'</th>';}
   return '<div class="daily-table-wrap daily-detail-wrap" tabindex="0" aria-label="每日对比明细，可横向滚动"><table class="daily-table daily-detail-table daily-grouped-table '+kind+'" style="--daily-table-width:'+cols.reduce((n,col)=>n+width(col),0)+'px"><colgroup>'+cols.map(col=>'<col class="daily-col-'+col.kind+'" style="width:'+width(col)+'px">').join('')+'</colgroup><thead><tr>'+header+'</tr><tr>'+sub+'</tr></thead><tbody>'+rows.join('')+'</tbody><tfoot>'+footer+'</tfoot></table></div>';
  }
  const detailCells=(values,cols)=>values.map((v,i)=>'<td class="daily-col-'+cols[i].kind+'" data-label="'+E(cols[i].label)+'">'+v+'</td>').join('');
  function detailValues(fact,denominator,pair,first,kind){
   const values=kind===undefined?[first]:[first,E(kind)],empty='<span class="daily-unknown">—</span>';
   for(const prefix of ['all','success'])for(const suffix of ['amount','count']){const key=prefix+'_'+suffix;values.push((suffix==='amount'?money:integer)(fact[key]),percent(fraction(fact[key],denominator[key])),pair?'<span title="'+pair.count+' 个相同原生平台可比较">'+delta(pair.current,pair.previous,key)+'</span>':empty);}
   const f=fee(fact);values.push(rate(fact),pair?rateChange(pair.current,pair.previous):empty,'<span title="按当前费率估算；'+(f.complete?'匹配完整':'仅已匹配部分，未匹配不计零')+'">'+money(f.amount)+(f.amount!==null&&!f.complete?'<em>*</em>':'')+'</span>',percent(fraction(f.matchedCount,f.eligibleCount)));
   return values;
  }
  const entityCells=(row,denominator,first,child=false)=>detailCells(detailValues(row.now,denominator,row.comparison,first,row.kind),detailColumns(false,child));
  function inlineRows(row){
   let children;if(S.dimension==='platform'){children=providerNames().map(name=>{const p=S.scope.platforms.find(p=>p.id===row.key),now=entity(S.scope.date,name,'provider',[p]),prior=entity(S.scope.compareDate,name,'provider',[p],true);return {key:name,name,kind:root.HensemProviderSummary?.providerType({provider:name,fee_items:now.leaves},L.feeLookupRows,S.scope.country)?.label||'未标注',now,prior,comparison:comparable(now,prior)};}).filter(r=>r.now.all_count>0||r.now.success_count>0||r.prior.all_count>0||r.prior.success_count>0);}else children=S.scope.platforms.map(p=>{const now=entity(S.scope.date,row.key,'provider',[p]),prior=entity(S.scope.compareDate,row.key,'provider',[p],true);return {key:p.id,name:p.name,kind:system(p.source),now,prior,comparison:comparable(now,prior)};});
   children.sort((a,b)=>(number(b.now[S.sort])??-Infinity)-(number(a.now[S.sort])??-Infinity)||a.name.localeCompare(b.name));
   return children;
  }
  function inline(row){const children=inlineRows(row),cols=detailColumns(false,true);
   return '<tr class="daily-inline"><td colspan="'+detailColumns().length+'"><div><div class="daily-inline-title"><strong>'+E(row.name)+' · '+children.length+' 个分项</strong><span>四项占比分别以当前父行对应指标为分母 · 按全部'+(S.sort==='all_count'?'笔数':'金额')+'降序</span></div>'+detailTable(cols,children.map(r=>'<tr>'+entityCells(r,row.now,'<strong>'+E(r.name)+'</strong>',true)+'</tr>'),'<tr>'+entityCells({...row,kind:'—'},row.now,'分项汇总',true)+'</tr>')+'</div></td></tr>';
  }
  function chart(values,key,title){const points=values.map(v=>number(v[key])),other=key==='all_amount'?'success_amount':'success_count',success=values.map(v=>number(v[other])),max=Math.max(1,...points.filter(n=>n!==null),...success.filter(n=>n!==null))*1.08,x=i=>54+i*390/Math.max(1,values.length-1),y=n=>136-n/max*115,short=n=>n>=1e6?(n/1e6).toFixed(1)+'m':n>=1e3?(n/1e3).toFixed(0)+'k':integer(Math.round(n));
   const line=(list,color)=>{let started=false;return '<path stroke="'+color+'" fill="none" d="'+list.map((n,i)=>{if(n===null){started=false;return '';}const p=(started?'L':'M')+x(i).toFixed(1)+' '+y(n).toFixed(1);started=true;return p;}).join(' ')+'"/>';};
   return '<div class="daily-chart"><div>'+E(title)+' <small>'+(key==='all_amount'?E(S.scope.currency):'笔')+'</small></div><svg viewBox="0 0 460 165" role="img" aria-label="'+E(title)+'趋势">'+[0,.5,1].map(r=>'<path class="daily-grid" d="M54 '+y(max*r)+'H444"/><text x="47" y="'+(y(max*r)+4)+'" text-anchor="end">'+short(max*r)+'</text>').join('')+line(points,'#4264ec')+line(success,'#18a38b')+values.map((r,i)=>i%Math.ceil(values.length/7)===0||i===values.length-1?'<text x="'+x(i)+'" y="158" text-anchor="middle">'+r.date.slice(5)+'</text>':'').join('')+'</svg></div>';
  }
  function trendData(m){
   const selected=S.trend==='__all__'?{key:'__all__',name:'全部所选平台'}:m.rows.find(r=>r.key===S.trend)||m.rows[0];if(!selected)return null;
   const get=day=>selected.key==='__all__'?m.all(day):entity(day,selected.key),days=Array.from({length:S.trendDays},(_,i)=>shift(S.scope.date,i-S.trendDays+1));
   return {selected,get,values:days.map(day=>({...get(day),date:day})),days};
  }
  function historyRows(m){if((S.direction==='workorder'?S.workTrendStatus:S.trendStatus)==='idle')return null;const data=trendData(m);if(!data)return null;const {get,values,days}=data,cols=detailColumns(true),summary=join(values.flatMap(v=>v.parts)),denominator=join(days.flatMap(day=>m.all(day).parts));
   const rows=values.slice().reverse().map(r=>{const today=S.scope.platforms.some(p=>c.localClock(S.scope.now,p.timezone).slice(0,10)===r.date),pair=today?null:comparable(r,get(shift(r.date,-1)),false),label=today?'<span title="今日尚未结束，逐日表暂不与昨日全天比较">'+E(r.date)+'</span>':E(r.date);return detailValues(r,m.all(r.date),pair,label);});
   const overlap=S.direction!=='workorder'&&(S.scope.from.slice(0,10)!==S.scope.to.slice(0,10)||S.scope.successFrom.slice(0,10)!==S.scope.successTo.slice(0,10));
   return {...data,cols,rows,footer:detailValues(overlap?unknown('重叠区间不累加'):summary,denominator,null,overlap?'重叠区间不累加':S.trendDays+'天汇总')};
  }
  function trend(m){const status=S.direction==='workorder'?S.workTrendStatus:S.trendStatus,button='<button type="button" class="btn" onclick="liveDailyLoadTrend()" '+(status==='loading'||S.status==='loading'?'disabled':'')+'>'+(status==='idle'?'读取 '+S.trendDays+' 天趋势':'重试 / 更新趋势')+'</button>',note='<div class="daily-note">'+(S.direction==='workorder'?'工单趋势按需读取原始记录。':'后台按需准备；每个点将创建和第二时间区间同时平移相同天数，主结果不等待趋势。')+button+'</div>';const data=historyRows(m);if(!data)return '<section class="daily-panel"><h2>趋势</h2>'+note+'</section>';const {selected,values,cols,rows,footer}=data;
   return '<section class="daily-panel"><div class="daily-panel-title"><h2>'+E(selected.name)+' · '+S.trendDays+(S.scope.from.slice(0,10)!==S.scope.to.slice(0,10)||S.scope.successFrom.slice(0,10)!==S.scope.successTo.slice(0,10)?' 天区间趋势':' 天趋势')+'</h2><span><i class="daily-legend-submit"></i>全部　<i class="daily-legend-success"></i>'+successful()+'</span></div><div class="daily-trend-buttons"><button class="'+(selected.key==='__all__'?'on':'')+'" onclick="liveDailyTrend(-1)">全部所选平台</button>'+m.rows.map((r,i)=>'<button type="button" class="'+(r.key===selected.key?'on':'')+'" onclick="liveDailyTrend('+i+')">'+E(r.name)+'</button>').join('')+'</div><div class="daily-charts">'+chart(values,'all_amount','金额')+chart(values,'all_count','笔数')+'</div>'+note+(status==='loading'?'<div class="daily-progress">正在读取已准备趋势；缺失点保留 —</div>':'')+detailTable(cols,rows.map(values=>'<tr>'+detailCells(values,cols)+'</tr>'),'<tr>'+detailCells(footer,cols)+'</tr>','daily-history')+'</section>';
  }
  function coverage(m){const data=m.now.parts.filter(p=>p.fact.ready&&(p.fact.all_count>0||p.fact.success_count>0)),empty=m.now.parts.filter(p=>p.fact.ready&&p.fact.all_count===0&&p.fact.success_count===0),status=p=>!p.fact.ready?p.fact.note:p.fact.all_count===0&&p.fact.success_count===0?'已读取无订单记录':p.fact.partial?'已返回，含待确认指标':'有数据';return '<details class="daily-coverage"><summary>有数据平台 <strong>'+data.length+' / '+S.scope.platforms.length+'</strong>　已读取 '+m.now.parts.filter(p=>p.fact.ready).length+'　无订单记录 '+empty.length+'　<span>展开平台</span></summary>'+table(['平台','系统','读取状态','全部笔数',successful()+'笔数'],m.now.parts.map(v=>{const p=S.scope.platforms.find(p=>p.id===v.id);return '<tr>'+cells([E(p.name),E(system(p.source)),E(status(v)),integer(v.fact.all_count),integer(v.fact.success_count)],['平台','系统','读取状态','全部笔数',successful()+'笔数'])+'</tr>';}),'','daily-coverage-table')+'</details>';}
  function draw(){
   const controls='<div class="daily-toolbar"><div>'+[['charge','代收'],['withdraw','代付'],['workorder','工单']].map(([k,label])=>'<button class="'+(S.direction===k?'on':'')+'" onclick="liveDailyDirection(\''+k+'\')">'+label+'</button>').join('')+'</div><div>'+[['platform','平台'],['provider','三方']].map(([k,label])=>'<button class="'+(S.dimension===k?'on':'')+'" onclick="liveDailyDimension(\''+k+'\')">'+label+'</button>').join('')+'<select aria-label="每日对比排序" onchange="liveDailySort(this.value)"><option value="all_count" '+(S.sort==='all_count'?'selected':'')+'>全部笔数 ↓</option><option value="all_amount" '+(S.sort==='all_amount'?'selected':'')+'>全部金额 ↓</option></select></div></div>';
   if(S.error)return '<div class="daily-comparison">'+controls+'<div class="live-status live-error">'+E(S.error)+'</div></div>';
   if(!S.scope||!authorized())return '<div class="daily-comparison">'+controls+'<div class="live-status">'+(L.dirty?'筛选条件已修改，请点击查询读取对应范围。':'选择国家、平台和统计日期后点击查询。')+'</div></div>';
   const m=model(true),draft=!matches(),waiting=S.direction==='workorder'&&S.workStatus==='idle',state=S.direction==='workorder'?S.workStatus:S.status;
   if(S.direction!=='workorder'&&S.status==='idle')return '<div class="daily-comparison">'+controls+'<div class="live-status">支付数据尚未查询。<button onclick="liveDailyQuery()">查询每日支付对比</button></div></div>';
   if(S.direction==='workorder'&&S.workStatus==='unsupported')return '<div class="daily-comparison">'+controls+'<div class="live-status">工单目前仅支持创建和第二时间相同的完整单日，按原始提交日统计；未读取工单。</div></div>';
   if(waiting)return '<div class="daily-comparison">'+controls+'<div class="live-status">工单按原始提交记录计算，源状态 4 计已处理。<button class="btn primary" onclick="liveDailyWorkorderQuery()">查询工单每日对比</button></div></div>';
   const status=['loading','paused','partial'].includes(state)?'<div class="daily-progress" role="status">'+({loading:'正在读取后台统计；当前为已读小计',paused:'查询已暂停，保留已读数据',partial:'部分统计尚未准备或未读取成功，当前为已读小计'}[state])+(state!=='loading'?'<button onclick="liveDailyContinue()">继续 / 重试未完成</button>':'')+'</div>':'';
   const pair=m.comparison,metric=[['全部金额','all_amount',money],['全部笔数','all_count',integer],[successful()+'金额','success_amount',money],[successful()+'笔数','success_count',integer]];
   const top='<div class="daily-metrics">'+metric.map(([label,key,format])=>'<div><span>'+label+'</span><strong>'+format(m.now[key])+'</strong><small>'+delta(pair.current,pair.previous,key)+'</small></div>').join('')+'<div><span>'+ (S.direction==='workorder'?'处理率':'成功率')+'</span><strong>'+rate(m.now)+'</strong><small>'+rateChange(pair.current,pair.previous)+'</small></div><div><span>参考手续费</span><strong>'+money(fee(m.now).amount)+'</strong><small>'+(S.direction==='workorder'?'工单不重复计费':'按当前费率估算')+'</small></div></div>';
   const footer={name:'已读汇总',kind:'—',now:m.now,prior:m.prior,comparison:pair};
   const name=(r,i,click)=>'<span title="'+(r.now.partial?'含未读取平台或待确认指标，仅已读小计':'已读范围')+'">'+(r.now.partial?'<em>*</em>':'')+'</span><span class="daily-rank">'+(i+1)+'</span>'+(click&&allowed('detail')?'<button class="daily-name" onclick="liveDailyExpand('+i+')" aria-expanded="'+(S.expanded===r.key)+'">'+E(r.name)+(S.expanded===r.key?' −':' +')+'</button>':E(r.name));
   const tables='<section class="daily-panel"><div class="daily-panel-title"><h2>'+(S.dimension==='platform'?'平台':'三方')+'每日明细</h2><span>按全部'+(S.sort==='all_count'?'笔数':'金额')+'从多到少 · 点击原位展开</span></div>'+detailTable(detailColumns(),m.rows.map((r,i)=>'<tr>'+entityCells(r,m.now,name(r,i,true))+'</tr>'+(S.expanded===r.key&&allowed('detail')?inline(r):'')),'<tr>'+entityCells(footer,m.now,'已读汇总')+'</tr>')+'</section>';
   const secondLabel=S.scope.successBasis==='source_updated'?'源订单更新时间':'成功时间',windowNote='创建 '+S.scope.from.replace('T',' ')+' 至 '+S.scope.to.replace('T',' ')+(S.scope.successFrom?' · 独立'+secondLabel+' '+S.scope.successFrom.replace('T',' ')+' 至 '+S.scope.successTo.replace('T',' '):' · 创建订单当前成功状态'),comparisonNote='对比创建开始 '+S.scope.compareDate+'，两组时间区间平移相同天数';
   const publications=Object.values(S.payments[S.scope.date]||{}).filter(readable).map(entry=>entry.response._preparedPublication),updated=publications.length?Math.min(...publications.map(p=>Date.parse(p.computedAt))):null,updatedNote=S.direction!=='workorder'&&Number.isFinite(updated)?' · 汇总更新 '+c.localClock(updated,S.scope.platforms[0].timezone)+(publications.some(p=>['queued','running'].includes(p.refreshState))?' · 更新中':publications.some(p=>p.refreshState==='failed')?' · 更新未完成':publications.some(p=>p.freshness==='refresh_due')?' · 待更新':''):'';
   const unfinished=S.scope.platforms.some(p=>{try{const w=period(S.scope.date,p,S.scope);return Math.max(Date.parse(w.endAt),Date.parse(w.successEndAt||w.endAt))>S.scope.now;}catch{return true;}});
   return '<div class="daily-comparison">'+controls+(draft?'<div class="live-status">筛选条件已修改，当前保留上次查询结果；点击查询后更新。</div>':'')+'<div class="daily-note">'+E(S.scope.country)+' · '+E(S.scope.currency)+' · '+E(windowNote)+' · '+E(comparisonNote)+E(updatedNote)+' · 可比 '+pair.count+' 个相同原生平台'+(unfinished?' · 所选时间尚未结束，暂不计算与历史完整区间的涨跌':'')+'。占比以当前已读范围为分母；缺失保留 —。</div>'+status+coverage(m)+top+tables+trend(m)+'<div class="daily-note">'+(S.direction==='workorder'?'原始工单不去重：已处理工单（源状态4）÷全部提交工单；不代表已核实到账。':(S.scope.successFrom?'全部按创建区间，成功按独立'+secondLabel+'区间；跨日成功可能使成功率超过100%。':'按创建日期选单，成功金额和笔数按当前成功状态统计。')+'参考手续费按当前费率估算，非历史实际费用。')+' '+updatedBasisNote()+' 已准备统计不代表来源采集完整；未知日期在图中留空。</div></div>';
  }

  function render(){
   const html=draw(),catalog=c.authorizedPlatforms?.()||c.selected(),canRetain=retained&&active()&&allowed('query')&&retained.access===authority()&&retained.direction===S.direction&&retained.platforms.every(p=>catalog.some(current=>nativeKey(current)===nativeKey(p)));
   if(canRetain&&S.direction!=='workorder'&&['loading','partial','error'].includes(S.status))return '<div class="live-panel-note" role="status">'+(S.status==='loading'?'正在读取所选范围':'本次读取未完成')+'，以下保留上次查询结果。</div><section class="live-retained-result" inert aria-label="上次查询结果">'+retained.html+'</section>';
   if(authorized()&&matches()&&S.direction!=='workorder'&&S.status==='ready'&&html.length<2000000)retained={access:authority(),direction:S.direction,platforms:S.scope.platforms.map(p=>({...p})),html};
   return html;
  }

  const updatedBasisNote=()=>S.direction==='workorder'?'':[!S.scope?.successFrom?'按创建日期选单，成功金额与笔数按已入库订单的当前成功状态统计，不代表期间实际到账。':S.scope?.successBasis==='source_updated'?'成功按成功状态＋源订单更新时间统计；未提供该时钟的来源保留 —。':'成功按源成功时间统计；没有可核验成功时钟的来源保留 —。',S.scope?.successBasis==='success'&&S.scope.platforms.some(p=>src(p.source)==='kb'&&p.capabilities?.successTimeBasis==='source_completed_at')?'KB成功按成功状态＋源订单完成时间统计，不代表银行到账时间。':'',S.direction==='withdraw'&&S.scope?.platforms.some(p=>src(p.source)==='panda'||p.capabilities?.reviewedWithdrawalsOnly===true)?'熊猫提现仅已审核范围，创建指标也仅覆盖该范围。':''].filter(Boolean).join(' ');
  const canExport=()=>current()&&allowed('export')&&['ready','partial'].includes(S.direction==='workorder'?S.workStatus:S.status);
  function exportRows(){
   if(!canExport())return [];const m=model(),strip=x=>String(x).replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"),plainCells=html=>[...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(x=>strip(x[1])),footer={kind:'—',now:m.now,prior:m.prior,comparison:m.comparison};
   const rows=[[S.scope.country,S.scope.currency,S.direction,S.scope.from,S.scope.to,S.scope.successFrom,S.scope.successTo,S.scope.successBasis,S.scope.compareDate,'两组窗口等距平移；按当前费率估算',...(updatedBasisNote()?[updatedBasisNote()]:[]),...Object.entries(S.payments[S.scope.date]||{}).filter(([,entry])=>readable(entry)).map(([id,entry])=>'平台 '+id+' · 汇总生成 '+entry.response._preparedPublication.computedAt+' · 截至 '+entry.response._preparedPublication.cutoff+' · '+(entry.response._preparedPublication.sourceComplete===true?'来源完整性已确认':'来源完整性尚未确认'))],detailColumns().map(col=>col.label)];
   for(const r of m.rows){rows.push(plainCells(entityCells(r,m.now,E(r.name))));if(S.expanded===r.key&&allowed('detail')){rows.push([r.name+' · 分项'],detailColumns(false,true).map(col=>col.label));for(const child of inlineRows(r))rows.push(plainCells(entityCells(child,r.now,'↳ '+E(child.name),true)));rows.push(detailColumns().map(col=>col.label));}}
   rows.push(plainCells(entityCells(footer,m.now,'已读汇总')));const history=historyRows(m);
   if(history){rows.push([],[history.selected.name,S.trendDays+'天趋势'],history.cols.map(col=>col.label));for(const values of [...history.rows,history.footer])rows.push(values.map(strip));}

   return rows;
  }

  return {load,loadTrend,cancel,clear,capture,restore,render,filterDateExtras,loadWorkorders,model,canExport,exportRows,currentReady:()=>current()&&!!S.scope};
 }
 root.HensemLiveDailyComparison={create};
})(typeof window==='object'?window:globalThis);
