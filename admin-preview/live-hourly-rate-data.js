/* Counts behind the hourly merchant and provider matrices. */
(function(root){
 'use strict';
 const hours=Array.from({length:24},(_,hour)=>hour);
 const columns=hours.map(hour=>({key:String(hour),label:String(hour).padStart(2,'0')+':00–'+String(hour).padStart(2,'0')+':59'}));
 const zero=()=>({successCount:0,totalCount:0});
 const integer=value=>(typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
 const metric=row=>integer(row?.success_count)&&integer(row?.all_count)?{successCount:Number(row.success_count),totalCount:Number(row.all_count)}:null;
 function add(a,b){
  if(!a||!b)return null;
  const successCount=a.successCount+b.successCount,totalCount=a.totalCount+b.totalCount;
  return Number.isSafeInteger(successCount)&&Number.isSafeInteger(totalCount)?{successCount,totalCount}:null;
 }
 const sum=values=>values.reduce(add,zero());
 const equal=(a,b)=>a&&b&&a.successCount===b.successCount&&a.totalCount===b.totalCount;
 const validHour=value=>integer(value)&&Number(value)<24;
 const rowModel=(key,name)=>({key,name,cells:Object.create(null),total:null,partial:false});
 function subtotal(row,verified=true){
  const facts=Object.values(row.cells).filter(Boolean);
  row.partial=!verified||facts.length!==24||facts.some(value=>value.partial);
  const total=facts.length?sum(facts):null;
  row.total=total&&row.partial?{...total,partial:true}:total;
  return row;
 }
 function resultIndex(results){
  const byPlatform=new Map();
  for(const result of results){
   const id=result?.platform?.id;
   if(id)byPlatform.set(id,byPlatform.has(id)?null:result);
  }
  return byPlatform;
 }
 const samePlatform=(p,r)=>r&&['source','country','currency','timezone'].every(key=>!p[key]||!r.platform[key]||p[key]===r.platform[key]);
 const parts=result=>Array.isArray(result?._parts)?result._parts:result?[result]:[];
 function merchantHours(result,direction,currency){
  const buckets=new Map(),segments=parts(result);let verified=segments.length>0;
  for(const part of segments){
   if(part.complete===false||part.pandaCoverage?.reason==='verified_created_prefix_only'||!Array.isArray(part.groups?.hourly))return {buckets:new Map(),verified:false};
   const scoped=rows=>rows.filter(row=>row.direction===direction&&row.currency===currency);
   const read=new Map();
   for(const row of scoped(part.groups.hourly)){
    if(!validHour(row.hour))return {buckets:new Map(),verified:false};
    const hour=Number(row.hour);
    read.set(hour,read.has(hour)?add(read.get(hour),metric(row)):metric(row));
   }
   // Sparse SQL groups omit hours without contributions. Only a reconciled
   // summary proves that the omitted hours across this source contain zero.
   const summaries=Array.isArray(part.summary)?scoped(part.summary):null;
   const control=summaries?.length?sum(summaries.map(metric)):
    summaries&&part.complete===true&&(!part.summary.length?integer(part.total)&&Number(part.total)===0:true)?zero():null;
   const knownSum=sum([...read.values()]);
   if(control&&knownSum&&!equal(knownSum,control))return {buckets:new Map(),verified:false};
   const reconciled=equal(knownSum,control);
   if(!reconciled)verified=false;
   for(const hour of hours){
    const value=read.has(hour)?read.get(hour):reconciled?zero():null;
    buckets.set(hour,buckets.has(hour)?add(buckets.get(hour),value):value);
   }
  }
  return {buckets,verified};
 }
 function providerGroups(entry,direction,currency,canonical){
  if(!Array.isArray(entry?.rows))return null;
  const ready=new Set(entry.complete===true?hours:(entry.completeHours||[]).filter(validHour).map(Number));
  const byHour=new Map();
  for(const row of entry.rows){
   if(row.direction!==direction||row.currency!==currency)continue;
   if(!validHour(row.hour))return null;
   const hour=Number(row.hour);
   if(!ready.has(hour))continue;
   const name=canonical(row.provider);
   if(!byHour.has(hour))byHour.set(hour,new Map());
   const group=byHour.get(hour);
   group.set(name,group.has(name)?add(group.get(name),metric(row)):metric(row));
  }
  return {ready,byHour};
 }
 function build({direction,currency,platforms=[],results=[],providerHours=new Map(),providerType,successAvailable}){
  const source=resultIndex(results),merchants=[],providerCells=new Map(),expected=new Map(platforms.filter(p=>p?.id).map(p=>[p.id,p]));
  const covered=Array(24).fill(0),ready=new Set(),providerReady=new Set();
  for(const platform of expected.values()){
   const result=source.get(platform.id);
   const merchant=rowModel(platform.id,platform.name||platform.id);
   merchants.push(merchant);
   if(!samePlatform(platform,result)||parts(result).some(part=>part.pandaCoverage?.reason==='verified_created_prefix_only')||successAvailable?.(platform,result,direction)===false){subtotal(merchant);continue;}
   const {buckets:hourly,verified}=merchantHours(result,direction,currency);
   if(verified)ready.add(platform.id);
   for(const hour of hours)merchant.cells[hour]=hourly.get(hour)||null;
   subtotal(merchant,verified);
   const canonical=value=>String(root.HensemProviderNames?.canonical(value,platform.country)??value??'').trim()||'（三方未提供）';
   const providers=providerGroups(providerHours.get(platform.id),direction,currency,canonical);
   if(!providers)continue;
   let verifiedHours=0;
   for(const hour of providers.ready){
    const group=providers.byHour.get(hour)||new Map();
    const total=sum([...group.values()]);
    if(!total||hourly.get(hour)&&!equal(total,hourly.get(hour)))continue;
    covered[hour]++;
    verifiedHours++;
    for(const [name,value] of group){
     if(!providerCells.has(name))providerCells.set(name,rowModel(name,name));
     const cells=providerCells.get(name).cells;
     cells[hour]=Object.hasOwn(cells,hour)?add(cells[hour],value):value;
    }
   }
   if(verified&&verifiedHours===hours.length)providerReady.add(platform.id);
  }
  // Reconcile all contributions above, including manual payments. Apply the
  // success-analysis page's display categories only after that reconciliation.
  const excluded={manual:[],unidentified:[]};
  const providers=[...providerCells.values()].filter(row=>{
   const kind=root.HensemLiveSuccessAnalysis?.providerKind(row.name)??'provider';
   if(!Object.hasOwn(excluded,kind))return true;
   excluded[kind].push(row.name);
   return false;
  });
  for(const row of providers){
   if(providerType)row.type=providerType(row.name);
   for(const hour of hours){
    const cell=Object.hasOwn(row.cells,hour)?row.cells[hour]:covered[hour]?zero():null;
    row.cells[hour]=cell&&covered[hour]<expected.size?{...cell,partial:true}:cell;
   }
   subtotal(row);
  }
  const ordered=rows=>rows.sort((a,b)=>(b.total?.totalCount||0)-(a.total?.totalCount||0)||a.name.localeCompare(b.name)||String(a.key).localeCompare(String(b.key)));
  return {dimension:'time',direction,
   merchant:{columns,ready,rows:ordered(merchants),partial:merchants.some(row=>row.partial)},
   provider:{columns,ready:providerReady,rows:ordered(providers),excluded,partial:providerReady.size!==expected.size||covered.some(n=>n<expected.size)||providers.some(row=>row.partial)}};
 }
 root.HensemHourlyRateData={build};
})(typeof window==='undefined'?globalThis:window);
