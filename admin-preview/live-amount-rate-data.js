/* Amount cohorts use the selected currency's source-side band edges for both views. */
(function(root){
 'use strict';
 const zero=()=>({successCount:0,totalCount:0});
 const validCount=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
 function readCounts(row){
  return validCount(row?.success_count)&&validCount(row?.all_count)?{successCount:Number(row.success_count),totalCount:Number(row.all_count)}:null;
 }
 function add(a,b){
  if(!a||!b)return null;
  const successCount=a.successCount+b.successCount,totalCount=a.totalCount+b.totalCount;
  return Number.isSafeInteger(successCount)&&Number.isSafeInteger(totalCount)?{successCount,totalCount}:null;
 }
 const sum=values=>Array.from(values).reduce(add,zero());
 const equal=(a,b)=>a&&b&&a.successCount===b.successCount&&a.totalCount===b.totalCount;
 const validBucket=key=>typeof key==='string'&&/^(band:[0-9]|below|above|unknown)$/.test(key);
 function accumulate(map,key,counts){
  const updated=add(map.has(key)?map.get(key):zero(),counts);
  map.set(key,updated);
  return updated!==null;
 }
 const samePlatform=(p,r)=>p.id===r?.platform?.id&&['source','country','currency','timezone'].every(key=>!p[key]||!r.platform[key]||p[key]===r.platform[key]);
 const usable=r=>r&&!r.error&&r.available!==false&&r.partial!==true&&r.complete!==false&&r.hasMore!==true&&r.pandaCoverage?.reason!=='verified_created_prefix_only';
 const parts=r=>Array.isArray(r?._parts)?r._parts:r?[r]:[];
 // An exact one-provider filter makes that provider's band counts identical to
 // the verified merchant counts. Accept only one immutable prepared publication
 // for the original native request; ordinary aggregate marginals are not a crossing.
 function singleProviderBands(platform,main,request,selected){
  const canonical=value=>typeof value==='string'&&value.trim()&&(root.HensemProviderNames?.canonical(value,platform.country)??value).trim();
  const name=canonical(selected),segments=parts(main),r=segments[0],pub=r?._preparedPublication,marker=r?._preparedResultGroups;
  if(!name||['all','全部'].includes(name)||root.HensemLiveSuccessAnalysis?.providerKind(name)!=='provider'||segments.length!==1)return null;
  if(!request||request.action!=='aggregate'||(request.view||'full')!=='full'||request.platformId!==platform.id||
     request.status!=='all'||request.direction!=='all'||request.currency!==platform.currency||
     !Array.isArray(request.providers)||!request.providers.length||!request.providers.every(v=>canonical(v)===name)||
     request.successBasis!=='created'||request.successStartAt!==undefined||request.successEndAt!==undefined)return null;
  if(!pub||pub.status!=='ready'||pub.calculationComplete!==true||typeof pub.id!=='string'||!pub.id||
     !(Number.isSafeInteger(pub.generation)||typeof pub.generation==='string'&&pub.generation.trim())||
     marker?.contract!=='prepared-result-groups-v1'||marker.profile!=='amount-v1'||
     !['amount','amount_range','provider'].every(g=>marker.groups?.includes(g)&&Array.isArray(r.groups?.[g]))||
     !['id','source','sourceName','country','currency','timezone'].every(k=>platform[k]&&platform[k]===r.platform?.[k]))return null;
  if(r.error||r.partial===true||r.available===false||r.complete===false||r.rows?.length!==0||
     r.coverage?.calculationComplete===false||r.coverage?.requestedComplete===false||
     r.pandaCoverage?.requestedComplete===false||r.pandaCoverage?.reason==='verified_created_prefix_only'||
     r.successBasis!=='created'||r.capabilities?.successCohort!=='created_at_current_stored_status'||
     r.capabilities?.independentSuccessWindow!==false||r.successStartAt!==undefined||r.successEndAt!==undefined||
     !['startAt','endAt'].every(k=>Number.isFinite(Date.parse(request[k]))&&Date.parse(request[k])===Date.parse(r[k]))||
     r.amountBandsVersion!==1||!['charge','withdraw'].every(d=>root.HensemAmountBands.valid(request.amountBands?.[d])&&sameEdges(r,d,request.amountBands[d]))||
     !Array.isArray(r.summary)||!Number.isSafeInteger(r.total)||r.total<0)return null;
  const rows=[r.summary,r.groups.provider,r.groups.amount_range];
  if(!rows.every(group=>group.every(row=>{
   const counts=readCounts(row);
   return counts&&['charge','withdraw'].includes(row.direction)&&row.currency===platform.currency&&
    counts.successCount<=counts.totalCount&&validCount(row.created_success_count)&&Number(row.created_success_count)===counts.successCount;
  }))||!r.groups.provider.every(row=>canonical(row.provider)===name))return null;
  const totals=sum(r.summary.map(readCounts));
  if(!totals||totals.totalCount!==r.total)return null;
  const byDirection={};
  for(const d of ['charge','withdraw']){
   const [summary,providers,bands]=rows.map(group=>group.filter(row=>row.direction===d));
   const counts=sum(summary.map(readCounts)),buckets=new Map();
   if(summary.length>1||!equal(counts,sum(providers.map(readCounts)))||!equal(counts,sum(bands.map(readCounts))))return null;
   for(const row of bands){
    if(!validBucket(row.bucket)||buckets.has(row.bucket))return null;
    buckets.set(row.bucket,readCounts(row));
   }
   byDirection[d]=buckets;
  }
  return {name,amountBands:r.amountBands,byDirection};
 }
 function sameEdges(r,d,edges){
  const actual=r?.amountBands?.[d];
  return Array.isArray(actual)&&actual.length===edges.length&&actual.every((v,i)=>v===edges[i]);
 }
 function merchantBuckets(result,platform,direction,currency,edges){
  if(!samePlatform(platform,result)||!usable(result)||!parts(result).length)return null;
  const scoped=row=>row?.direction===direction&&row.currency===currency;
  const buckets=new Map();
  for(const part of parts(result)){
   if(!samePlatform(platform,part)||!usable(part)||!sameEdges(part,direction,edges)||!Array.isArray(part.groups?.amount_range)||!Array.isArray(part.summary))return null;
   const local=new Map();
   for(const row of part.groups.amount_range.filter(scoped)){
    if(!validBucket(row.bucket)||local.has(row.bucket)||!readCounts(row))return null;
    local.set(row.bucket,readCounts(row));
   }
   const controls=part.summary.filter(scoped);
   if(!controls.length&&!(part.complete===true&&(part.summary.length>0||part.total===0)))return null;
   if(!equal(sum(local.values()),sum(controls.map(readCounts))))return null;
   for(const [key,value] of local)if(!accumulate(buckets,key,value))return null;
  }
  return buckets;
 }
 // A compact main result can omit the amount groups entirely. Accept its
 // checked drilldown only when the range and independent main counts agree.
 function checkedSupplement(main,result,platform,direction,currency,edges){
  if(!result||result.providerAmountMatrix!==true||result.complete!==true||result.hasMore!==false||
    !['startAt','endAt'].every(k=>Number.isFinite(Date.parse(main[k]))&&Date.parse(main[k])===Date.parse(result[k])))return null;
  const segments=parts(main);
  if(!segments.length||!segments.every(p=>usable(p)&&samePlatform(platform,p)&&p.groups&&
    !Object.hasOwn(p.groups,'amount_range')&&(!p.amountBands||sameEdges(p,direction,edges))&&Array.isArray(p.summary)))return null;
  const actual=merchantBuckets(result,platform,direction,currency,edges);
  if(!actual)return null;
  const controls=[];
  for(const part of segments){
   const rows=part.summary.filter(r=>r.direction===direction&&r.currency===currency);
   if(!rows.length&&!(part.complete===true&&(part.summary.length>0||part.total===0)))return null;
   controls.push(...rows.map(readCounts));
  }
  return equal(sum(actual.values()),sum(controls))?actual:null;
 }
 const equalBuckets=(a,b)=>a&&b&&[...new Set([...a.keys(),...b.keys()])].every(k=>equal(a.get(k)??zero(),b.get(k)??zero()));
 function providerBuckets(result,platform,direction,currency,merchant,edges){
  if(!samePlatform(platform,result)||result.providerAmountMatrix!==true||result.complete!==true||result.hasMore!==false||!Array.isArray(result.groups?.provider_amount_range))return null;
  const byProvider=new Map(),totals=new Map(),rows=result.groups.provider_amount_range;
  for(const row of rows){
   if(row.direction!==direction||row.currency!==currency)continue;
   const value=readCounts(row);
   if(!validBucket(row.bucket)||!value||row.provider!=null&&typeof row.provider!=='string')return null;
   const name=String(root.HensemProviderNames?.canonical(row.provider,platform.country)??row.provider??'').trim()||'（三方未提供）';
   if(!byProvider.has(name))byProvider.set(name,new Map());
   if(!accumulate(byProvider.get(name),row.bucket,value)||!accumulate(totals,row.bucket,value))return null;
  }
  return equalBuckets(totals,merchant)&&equalBuckets(totals,merchantBuckets(result,platform,direction,currency,edges))?byProvider:null;
 }
 function rowModel(key,name,data,keys,partial){
  const cells=Object.create(null);
  for(const k of keys){
   const counts=data?(data.get(k)??zero()):null;
   cells[k]=counts&&partial?{...counts,partial:true}:counts;
  }
  const total=data?sum(data.values()):null;
  return {key,name,cells,total:total&&partial?{...total,partial:true}:total,partial:partial||!total};
 }
 function build({direction,currency,platforms=[],results=[],amountBands={},providerAmounts=new Map(),singleProviders,successAvailable,providerType}){
  const edges=amountBands?.[direction],valid=root.HensemAmountBands.valid(edges);
  const bases=new Map(),merchantReady=new Set(),providerReady=new Set(),amounts=new Map(),providers=new Map(),special=new Set();
  const expected=new Map(platforms.filter(p=>p?.id).map(p=>[p.id,p]));
  for(const result of results){
   const id=result?.platform?.id;
   if(id)bases.set(id,bases.has(id)?null:result);
  }
  for(const p of expected.values()){
   const main=bases.get(p.id),candidate=providerAmounts.get(p.id);
   const supplement=candidate&&successAvailable?.(p,candidate,direction)!==false?candidate:null;
   const single=singleProviders?.get(p.id);
   const projection=valid&&p.currency===currency&&single&&!supplement&&sameEdges(single,direction,edges)?single.byDirection[direction]:null;
   if(!valid||!samePlatform(p,main)||(!projection&&!usable(main))||successAvailable?.(p,main,direction)===false)continue;
   const merchant=Number.isFinite(supplement?._matrixReadAt)
    ?merchantBuckets(supplement,p,direction,currency,edges)
    :projection??merchantBuckets(main,p,direction,currency,edges)??checkedSupplement(main,supplement,p,direction,currency,edges);
   if(!merchant)continue;
   amounts.set(p.id,merchant);merchantReady.add(p.id);
   for(const key of merchant.keys())if(!key.startsWith('band:'))special.add(key);
   const grouped=projection?(projection.size?new Map([[single.name,projection]]):new Map()):providerBuckets(supplement,p,direction,currency,merchant,edges);
   if(!grouped)continue;
   providerReady.add(p.id);
   for(const [name,local] of grouped){
    if(!providers.has(name))providers.set(name,new Map());
    for(const [key,value] of local)accumulate(providers.get(name),key,value);
   }
  }
  const keys=valid?[...(special.has('below')?['below']:[]),...root.HensemAmountBands.keys(),...['above','unknown'].filter(key=>special.has(key))]:[];
  const columns=keys.map(key=>({key,label:root.HensemAmountBands.label(key,edges)}));
  const merchants=Array.from(expected.values(),p=>rowModel(p.id,p.name||p.id,amounts.get(p.id),keys,!merchantReady.has(p.id)));
  const excluded={manual:[],unidentified:[]},providerRows=[],partial=providerReady.size!==expected.size;
  for(const [name,cells] of providers){
   const kind=root.HensemLiveSuccessAnalysis?.providerKind(name)??'provider';
   if(Object.hasOwn(excluded,kind)){excluded[kind].push(name);continue;}
   const row=rowModel(name,name,cells,keys,partial);
   if(providerType)row.type=providerType(name);
   providerRows.push(row);
  }
  return {dimension:'amount',direction,merchant:{columns,rows:merchants,ready:merchantReady,partial:merchantReady.size!==expected.size},
   provider:{columns,rows:providerRows,ready:providerReady,partial,excluded}};
 }
 root.HensemAmountRateData={build,singleProviderBands};
})(typeof window==='undefined'?globalThis:window);
