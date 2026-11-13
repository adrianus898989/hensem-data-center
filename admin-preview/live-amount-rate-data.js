/* Amount cohorts use the selected currency's source-side band edges for both views. */
(function(root){
 'use strict';
 const zero=()=>({successCount:0,totalCount:0});
 function readCounts(row){
  const valid=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
  return valid(row?.success_count)&&valid(row?.all_count)?{successCount:Number(row.success_count),totalCount:Number(row.all_count)}:null;
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
 function build({direction,currency,platforms=[],results=[],amountBands={},providerAmounts=new Map(),successAvailable,providerType}){
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
   if(!valid||!samePlatform(p,main)||!usable(main)||successAvailable?.(p,main,direction)===false)continue;
   const merchant=merchantBuckets(main,p,direction,currency,edges)??checkedSupplement(main,supplement,p,direction,currency,edges);
   if(!merchant)continue;
   amounts.set(p.id,merchant);merchantReady.add(p.id);
   for(const key of merchant.keys())if(!key.startsWith('band:'))special.add(key);
   const grouped=providerBuckets(supplement,p,direction,currency,merchant,edges);
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
 root.HensemAmountRateData={build};
})(typeof window==='undefined'?globalThis:window);
