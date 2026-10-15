/* Published provider results: exact native identities, no source-read fallback. */
(function(root){
 'use strict';
 const denied=e=>['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(e?.code);
 const validDay=day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
 // Normalize timezone notation without truncating microseconds.
 const instant=value=>{const m=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);if(!m||!Number.isFinite(Date.parse(m[1]+m[3])))return null;return new Date(m[1]+m[3]).toISOString().slice(0,19)+'.'+(m[2]||'').padEnd(6,'0')+'Z';};
 const native=p=>p&&!p.reportOnly&&['ar','newar','kb'].includes(p.source)&&p.scopeGroup==='IN'&&p.currency==='INR'&&['Asia/Kolkata','Asia/Calcutta'].includes(p.timezone)&&typeof p.sourceName==='string'&&p.sourceName.length>0&&(p.source!=='kb'||p.sourceName==='YASH.BET');
 function eligible({page,L,platforms,visible,providers,now=Date.now()}){
  return page==='providers'&&L.direction==='charge'&&L.status==='all'&&platforms.length>0&&platforms.length<=50&&visible.length===platforms.length&&platforms.every(native)&&
   validDay(L.from.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(L.from)&&L.to===L.from.slice(0,10)+'T23:59:59'&&L.from.slice(0,10)<new Date(now+19800000).toISOString().slice(0,10)&&
   !providers.length&&!['orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','amountMin','amountMax','channelType'].some(k=>L[k]);
 }
 function contextKey(access,catalog){return JSON.stringify([access,catalog.map(p=>[p.id,p.source,p.sourceName,p.scopeGroup,p.country,p.team,p.name,p.currency,p.timezone]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);}
 function requestFor(platforms,day){return {action:'providerSnapshot',version:1,platformIds:platforms.map(p=>p.id),startAt:day+'T00:00:00',endAt:day+'T23:59:59',direction:'charge',status:'all',currency:'INR',components:['orders','submission','intake'],export:false};}
 // Component completeness does not mean the whole requested day was published.
 function fullDay(bundle,request){
  const day=request.startAt.slice(0,10),w=bundle.window;if(!w||!validDay(day)||request.startAt!==day+'T00:00:00'||request.endAt!==day+'T23:59:59')return false;
  const start=Date.parse(day+'T00:00:00+05:30'),at=offset=>instant(new Date(start+offset*86400000).toISOString());
  return instant(w.startAt)===at(0)&&instant(w.endAt)===at(1)&&instant(w.previousStartAt)===at(-1)&&instant(w.previousEndAt)===at(0);
 }
 const invalid=()=>{throw Error('已发布汇总的范围或结构不完整，请重新读取');};
 function validate(bundle,request,platforms){
  root.HensemProviderSnapshotShadow.validate(bundle,request);
  if(bundle.status==='unsupported')return bundle;
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
 const api={eligible,contextKey,requestFor,validate,fullDay,generation,intake,denied};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.HensemProviderPublished=api;
})(typeof window==='object'?window:globalThis);
