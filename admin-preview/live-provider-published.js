/* Published provider results: exact native identities, no source-read fallback. */
(function(root){
 'use strict';
 const denied=e=>['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(e?.code);
 const validDay=day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
 // Normalize timezone notation without truncating microseconds.
 const instant=value=>{const m=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);if(!m||!Number.isFinite(Date.parse(m[1]+m[3])))return null;return new Date(m[1]+m[3]).toISOString().slice(0,19)+'.'+(m[2]||'').padEnd(6,'0')+'Z';};
 const native=p=>p&&!p.reportOnly&&['ar','newar','kb'].includes(p.source)&&p.scopeGroup==='IN'&&p.currency==='INR'&&['Asia/Kolkata','Asia/Calcutta'].includes(p.timezone)&&typeof p.sourceName==='string'&&p.sourceName.length>0&&(p.source!=='kb'||p.sourceName==='YASH.BET');
 function eligible({page,L,platforms,visible,now=Date.now()}){
  const today=new Date(now+19800000).toISOString().slice(0,10),yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  // The rolling publication worker maintains today and yesterday. Older exact
  // windows use the existing prepared reader directly, without reading this
  // expired store first or falling back to raw orders.
  return page==='providers'&&L.direction==='charge'&&L.status==='all'&&platforms.length>0&&platforms.length<=50&&visible.length===platforms.length&&platforms.every(native)&&
   validDay(L.from.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(L.from)&&L.to===L.from.slice(0,10)+'T23:59:59'&&L.from.slice(0,10)>=yesterday&&L.from.slice(0,10)<=today&&
   !['orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','amountMin','amountMax','channelType'].some(k=>L[k]);
 }
 function contextKey(access,catalog){return JSON.stringify([access,catalog.map(p=>[p.id,p.source,p.sourceName,p.scopeGroup,p.country,p.team,p.name,p.currency,p.timezone]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);}
 function requestFor(platforms,day){return {action:'providerSnapshot',version:2,platformIds:platforms.map(p=>p.id),startAt:day+'T00:00:00',endAt:day+'T23:59:59',direction:'charge',status:'all',currency:'INR',components:['orders','submission','intake'],export:false};}
 // Component completeness does not mean the whole requested day was published.
 function fullDay(bundle,request){
  const day=request.startAt.slice(0,10),w=bundle.window;if(!w||!validDay(day)||request.startAt!==day+'T00:00:00'||request.endAt!==day+'T23:59:59')return false;
  const start=Date.parse(day+'T00:00:00+05:30'),at=offset=>instant(new Date(start+offset*86400000).toISOString());
  return instant(w.startAt)===at(0)&&instant(w.endAt)===at(1)&&instant(w.previousStartAt)===at(-1)&&instant(w.previousEndAt)===at(0);
 }
 function appliedWindow(bundle,request,now=Date.now()){
  const w=bundle.window,full=fullDay(bundle,request),today=new Date(now+19800000).toISOString().slice(0,10);
  if(!w||!full&&request.startAt.slice(0,10)!==today)return null;
  return {...w,localStartAt:preciseLocal(w.startAt),localCutoff:preciseLocal(w.endAt),previousLocalStartAt:preciseLocal(w.previousStartAt),previousLocalCutoff:preciseLocal(w.previousEndAt),fullDay:full,intraday:!full};
 }
 const local=value=>new Date(Date.parse(value)+19800000).toISOString().slice(0,19);
 const preciseLocal=value=>local(value)+(instant(value).slice(19,26).replace(/0+$/,'').replace(/\.$/,''));
 const previousDay=value=>{const normalized=instant(value);return new Date(Date.parse(normalized.slice(0,19)+'Z')-86400000).toISOString().slice(0,19)+normalized.slice(19);};
 const invalid=()=>{throw Error('已发布汇总的范围或结构不完整，请重新读取');};
 function validate(bundle,request,platforms){
  root.HensemProviderSnapshotShadow.validate(bundle,request);
  if(bundle.status==='unsupported')return bundle;
  if(bundle.window){const w=bundle.window;if(instant(w.startAt)!==instant(request.startAt+'+05:30')||instant(w.endAt)<=instant(w.startAt)||instant(w.endAt)>instant(new Date(Date.parse(request.endAt+'+05:30')+1000).toISOString())||instant(w.previousStartAt)!==previousDay(w.startAt)||instant(w.previousEndAt)!==previousDay(w.endAt))invalid();for(const [civil,utc]of [['localStartAt','startAt'],['localCutoff','endAt'],['previousLocalStartAt','previousStartAt'],['previousLocalCutoff','previousEndAt']])if(w[civil]!==local(w[utc]))invalid();}
  for(const entry of bundle.platforms){
   const p=platforms.find(p=>p.id===entry.platform.id);if(!p)invalid();
   for(const k of ['source','sourceName','scopeGroup','currency','timezone'])if(entry.platform[k]!==p[k])invalid();
   for(const period of ['current','previous'])for(const component of ['orders','submission','intake']){
    if(period==='previous'&&component==='submission')continue;
    const value=entry[period][component];if(value===null)continue;
    for(const k of ['id','source','sourceName','scopeGroup','currency','timezone'])if(value.platform[k]!==p[k])invalid();
    if(!bundle.window)invalid();
    const start=bundle.window[period==='current'?'startAt':'previousStartAt'],end=bundle.window[period==='current'?'endAt':'previousEndAt'];
    const window=component==='intake'?value.snapshotWindow:value;
    if(!instant(start)||instant(window?.startAt)!==instant(start)||instant(window?.endAt)!==instant(end))invalid();
    if(component==='orders'&&(value.version!==1||!Array.isArray(value.summary)||!Array.isArray(value.groups?.provider)||!Array.isArray(value.rows)||value.rows.length))invalid();
   }
  }
  return bundle;
 }
 function generation(bundle){return JSON.stringify([bundle.window,bundle.platforms.map(p=>[p.platform.id,p.snapshots.map(s=>[s.period,s.component,s.snapshotId]).sort()]).sort()]);}
 function intake(bundle,period,catalog,platforms){
  const from=(period==='current'?bundle.requested.startAt:new Date(Date.parse(bundle.requested.startAt+'Z')-86400000).toISOString()).slice(0,10),to=from;
  if(catalog?.version!==1||catalog.complete!==true||!Array.isArray(catalog.feeds)||new Set(catalog.feeds.map(f=>f.id)).size!==catalog.feeds.length)throw Error('采集目录响应不完整');
  const rows=platforms.map(p=>{
   const entry=bundle.platforms.find(e=>e.platform.id===p.id),payload=entry?.[period]?.intake;
   const matches=catalog.feeds.filter(f=>f.platformId===p.id&&f.dataset==='orders'&&f.sourceKind==='direct'&&f.provenance?.kind==='direct'&&f.direction==='charge'&&f.timezone===p.timezone&&f.system===p.source&&f.rawCountry===p.scopeGroup&&f.rawPlatform===p.sourceName);
   if(matches.length!==1)throw Error(p.name+' 的采集来源目录已变化，请重新读取');
   const feed=matches[0];
   if(!payload)return root.HensemProviderIntake.summarize(p,feed,[],from,to);
   const grouped=root.HensemProviderIntake.validate(payload,[feed],from,to);
   return root.HensemProviderIntake.summarize(p,feed,grouped.get(feed.id),from,to);
  });
  return {status:'ready',from,to,platforms:rows,error:'',published:true};
 }
 // A provider selection is a projection of the same authorized publication.
 // Keep the immutable base and its generation separate from the projected view.
 const orderCounts=['all_count','success_count','pending_count','failed_count','rejected_count','unknown_count','missing_amount_count','negative_amount_count','created_success_count'];
 const orderAmounts=['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'];
 const submissionCounts=['qualified_member_count','qualified_member_days','member_count','member_days','invalid_count','l0_members','new_members','funded_members','unknown_members'];
 const submissionThresholds=[10,15,20,30,50,100];
 const copy=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
 const canonical=(name,country,resolve)=>String((resolve||root.HensemProviderNames?.canonical)?.(name,country)??name??'').trim();
 function decimalSum(values){
  if(values.some(value=>value===null||value===undefined))return null;
  if(values.length===1)return values[0];
  let total=0n,scale=0;
  for(const value of values){
   const match=String(value).match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);if(!match)return null;
   const exponent=Number(match[4]||0),digits=match[2]+(match[3]||'');let nextScale=(match[3]||'').length-exponent;
   if(!Number.isSafeInteger(exponent)||Math.abs(nextScale)>1000)return null;
   let next=BigInt(digits)*(match[1]==='-'?-1n:1n);if(nextScale<0){next*=10n**BigInt(-nextScale);nextScale=0;}
   if(nextScale>scale){total*=10n**BigInt(nextScale-scale);scale=nextScale;}else next*=10n**BigInt(scale-nextScale);total+=next;
  }
  const sign=total<0n?'-':'';let digits=(total<0n?-total:total).toString().padStart(scale+1,'0');
  if(scale)digits=(digits.slice(0,-scale)+'.'+digits.slice(-scale)).replace(/\.?0+$/,'');
  return sign+digits;
 }
 function countSum(values){if(values.some(value=>!Number.isSafeInteger(value)||value<0))return null;const sum=values.reduce((n,value)=>n+value,0);return Number.isSafeInteger(sum)?sum:null;}
 function projectOrders(value,providers,resolve){
  if(value===null)return null;
  const country=value.platform?.country||value.platform?.scopeGroup||'IN',wanted=new Set(providers.map(name=>canonical(name,country,resolve))),rows=(value.groups?.provider||[]).filter(row=>wanted.has(canonical(row.provider,country,resolve))),groups=new Map();
  for(const row of rows){const key=JSON.stringify([row.direction,row.currency]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const summary=[...groups.values()].map(leaves=>{
   const row={direction:leaves[0].direction,currency:leaves[0].currency};
   for(const key of orderCounts)if(leaves.some(leaf=>Object.hasOwn(leaf,key))||(value.summary||[]).some(item=>Object.hasOwn(item,key)))row[key]=countSum(leaves.map(leaf=>leaf[key]));
   for(const key of orderAmounts)row[key]=decimalSum(leaves.map(leaf=>leaf[key]));
   const stamps=leaves.map(leaf=>leaf.latest_synced_at).filter(stamp=>typeof stamp==='string'&&Number.isFinite(Date.parse(stamp)));if(stamps.length)row.latest_synced_at=stamps.sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
   return row;
  });
  // Other dimensions in the base are whole-platform aggregates and cannot be
  // relabelled as provider-specific distributions or duration samples.
  return {...value,summary,total:countSum(rows.map(row=>row.all_count)),groups:Object.fromEntries(Object.keys(value.groups||{}).map(key=>[key,key==='provider'?rows:[]])),rows:[],...(Object.hasOwn(value,'latencySummary')?{latencySummary:[]}:{}),...(Object.hasOwn(value,'pendingSummary')?{pendingSummary:[]}:{})};
 }
 function project(bundle,providers=[],options={}){
  if(!Array.isArray(providers)||providers.some(name=>typeof name!=='string'||!name.trim()))throw Error('三方筛选无效');
  const selected=[...new Set(providers.map(name=>canonical(name,'印度',options.canonical)))].sort();
  if(!selected.length)return {bundle,providers:[],projectionComplete:true,unresolvedSubmissions:[]};
  const projected=copy(bundle),unresolvedSubmissions=[];
  for(const entry of projected.platforms||[]){
   for(const period of ['current','previous'])if(entry[period])entry[period].orders=projectOrders(entry[period].orders,selected,options.canonical);
   const source=entry.current?.submission;if(!source)continue;
   const country=entry.platform?.country||entry.platform?.scopeGroup||'IN',nameOf=name=>canonical(name,country,options.canonical),wanted=new Set(selected.map(nameOf)),metrics=source.metrics||[],providerMetrics=metrics.filter(metric=>metric.provider!==null),filtered=[],unavailable=[],reasons=[];
   const gaps=['missingMemberCount','unknownStatusCount','orderSequenceUncertainCount','coverageUnknownDays'],coverageIncomplete=source.coverage?.calculationComplete===false||gaps.some(key=>Number(source.coverage?.[key])>0),globalComplete=submissionThresholds.every(threshold=>metrics.filter(metric=>metric.provider===null&&metric.threshold===threshold).length===1);
   const mark=(provider,reason)=>{if(!unavailable.includes(provider)){unavailable.push(provider);reasons.push({provider,reason});}};
   for(const provider of selected){
    const matches=providerMetrics.filter(metric=>nameOf(metric.provider)===nameOf(provider)),orderCount=countSum((entry.current.orders?.groups?.provider||[]).filter(row=>nameOf(row.provider)===nameOf(provider)).map(row=>row.all_count));
    let reason=coverageIncomplete?'provider_coverage_required':!globalComplete?'publication_metrics_incomplete':null;
    if(!reason&&submissionThresholds.some(threshold=>matches.filter(metric=>metric.threshold===threshold).length>1))reason='provider_alias_union_required';
    // Every source branch publishes dimensions from all selected orders, then
    // LEFT JOINs qualified cohorts. A missing dimension with orders is not zero.
    if(!reason&&submissionThresholds.some(threshold=>!matches.some(metric=>metric.threshold===threshold))&&(orderCount!==0||entry.current.orders===null))reason='provider_metrics_missing';
    if(reason){mark(provider,reason);continue;}
    for(const threshold of submissionThresholds){const found=matches.find(metric=>metric.threshold===threshold);filtered.push(found?{...found,provider}:{provider,threshold,...Object.fromEntries(submissionCounts.map(key=>[key,0])),invalid_amount:'0'});}
   }
   // Distinct member IDs can overlap between providers. Reuse the stored union
   // only for one exact provider or when all source dimensions are selected.
   const allDimensionsSelected=providerMetrics.every(metric=>wanted.has(nameOf(metric.provider)));
   if(selected.length===1&&!unavailable.includes(selected[0]))filtered.push(...filtered.map(metric=>({...metric,provider:null})));
   else if(!coverageIncomplete&&globalComplete&&allDimensionsSelected)filtered.push(...metrics.filter(metric=>metric.provider===null).map(metric=>({...metric})));
   else mark(null,coverageIncomplete?'provider_coverage_required':!globalComplete?'publication_metrics_incomplete':'provider_member_union_required');
   const projection={version:1,providers:selected.slice(),unavailableProviders:unavailable,reasons};
   entry.current.submission={...source,metrics:filtered,dashboard:null,publishedProjection:projection,coverage:{...source.coverage,orderCount:entry.current.orders?.total,projectionBasis:'published_provider_metrics',sourceCoverage:copy(source.coverage)}};
   if(unavailable.length)unresolvedSubmissions.push({platformId:entry.platform.id,reason:reasons[0].reason,unavailableProviders:unavailable.slice()});
  }
  return {bundle:projected,providers:selected,projectionComplete:unresolvedSubmissions.length===0,unresolvedSubmissions};
 }
 const api={eligible,contextKey,requestFor,validate,fullDay,appliedWindow,generation,intake,denied,project};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.HensemProviderPublished=api;
})(typeof window==='object'?window:globalThis);
