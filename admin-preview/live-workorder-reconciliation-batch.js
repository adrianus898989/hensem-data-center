/* Bounded, authorized per-platform reconciliation. Each RPC retains server scope and cross-day matching. */
(function(root){
 'use strict';
 const countKeys=['candidateCount','pendingCount','excludedSuccessCount','missingCount','matchedCount','reviewCount','unknownAmountCount'];
 const amountKeys=['missingAmount','matchedAmount','reviewAmount'];
 const compare=(a,b)=>a<b?-1:a>b?1:0;
 const count=x=>Number.isSafeInteger(x)&&x>=0;
 const cancelled=()=>Object.assign(Error('查询已取消'),{name:'AbortError',code:'ADMIN_LIVE_CANCELLED'});
 const invalid=message=>{throw Error(message||'平台核对响应不完整，请重新查询');};
 function decimal(value){
  if(typeof value!=='string'||!/^-?\d+(?:\.\d{1,8})?$/.test(value))return null;
  const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.');return (BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0')))*(negative?-1n:1n);
 }
 function decimalText(value){const negative=value<0n,n=negative?-value:value,whole=n/100000000n,fraction=String(n%100000000n).padStart(8,'0').replace(/0+$/,'');return (negative?'-':'')+String(whole)+(fraction?'.'+fraction:'');}
 function sumAmount(entries,key){let sum=0n;for(const e of entries){const exact=e.value.summary[key+'Exact'];if(exact===null)return null;const n=decimal(exact);if(n===null)invalid('原单金额精度字段缺失，请重新查询');sum+=n;}return decimalText(sum);}
 function validateDirectory(value){
  if(value?.ok!==true||value.version!==2||value.operation!=='reconciliationPlatforms'||value.countryCode!=='IN'||value.currency!=='INR'||!Array.isArray(value.platforms)||value.platforms.length>250||value.platforms.some(p=>typeof p!=='string'||!p.trim()||p.trim()!==p||p.length>200||/[\u0000-\u001f\u007f]/.test(p))||new Set(value.platforms).size!==value.platforms.length)invalid('授权工单平台目录不完整，请重新查询');
  return value.platforms;
 }
 function validateResult(value,platform,query){
  const s=value?.summary,c=value?.coverage;
  if(value?.ok!==true||value.version!==2||value.countryCode!=='IN'||!Array.isArray(value.platforms)||value.platforms.length!==1||value.platforms[0]!==platform||value.sourceStatus!=='ready'||value.currency!=='INR'||value.successBasis!==query.filters.successBasis||!count(value.total)||!s||!countKeys.every(k=>count(s[k]))||s.pendingCount!==s.missingCount+s.matchedCount+s.reviewCount||s.candidateCount!==s.pendingCount+s.excludedSuccessCount||!Array.isArray(value.rows)||value.rows.length!==Math.min(query.limit,Math.max(0,value.total-query.offset))||value.rows.some(r=>!r||r.platform!==platform||typeof r.id!=='string'||!r.id)||new Set(value.rows.map(r=>r.id)).size!==value.rows.length||!c||c.expectedPlatforms!==1||!count(c.platformsWithRecords)||c.platformsWithRecords>1||!Array.isArray(c.platforms)||c.platforms.length!==1||c.platforms[0]?.platform!==platform)invalid();
  const totalKey={missing:'missingCount',matched:'matchedCount',review:'reviewCount'}[query.filters.registrationStatus];
  if(value.total!==(totalKey?s[totalKey]:s.pendingCount))invalid();
  for(const key of amountKeys)if(s[key+'Exact']!==null&&decimal(s[key+'Exact'])===null)invalid('原单金额精度字段缺失，请重新查询');
  return value;
 }
 function fingerprint(value){const s=value.summary;return JSON.stringify([value.total,...countKeys.map(k=>s[k]),...amountKeys.map(k=>s[k+'Exact']),s.latestCollectedAt,value.coverage.platforms]);}
 root.HensemWorkorderReconciliationBatch={create:function({request,scopeIdentity=()=>root.hensemDataScope?.identity||'unverified',now=()=>new Date().toISOString()}){
  let cache=null,generation=0;const controllers=new Set();
  function cancel(clear=false){generation++;for(const controller of controllers)controller.abort();controllers.clear();if(clear||cache&&!cache.finished)cache=null;}
  async function load(query,{refresh=false,onProgress=()=>{},isCurrent=()=>true}={}){
   cancel();const serial=generation,check=()=>{if(serial!==generation||!isCurrent())throw cancelled();};
   const key=JSON.stringify([scopeIdentity(),query.country,Object.entries(query.filters).sort(([a],[b])=>compare(a,b))]);
   if(refresh||cache?.key!==key)cache=null;
   const read=async q=>{check();const controller=new AbortController();controllers.add(controller);try{const value=await request(q,{signal:controller.signal});check();return value;}finally{controllers.delete(controller);}};
   async function bounded(tasks,run){let cursor=0;async function worker(){while(cursor<tasks.length){check();await run(tasks[cursor++]);}}await Promise.all(Array.from({length:Math.min(2,tasks.length)},worker));check();}
   let index=cache;
   if(!index){
    onProgress({phase:'directory',done:0,total:null,failed:0});
    const platforms=validateDirectory(await read({action:'workorderRecords',view:'missing',operation:'reconciliationPlatforms',country:query.country,filters:{dateBasis:'submission',issueKind:'deposit'}}));
    check();index={key,platforms,entries:[],failures:[],startedAt:now(),finished:false};cache=index;
    onProgress({phase:'platforms',done:0,total:platforms.length,failed:0});
    await bounded(platforms,async platform=>{
     try{const q={...query,filters:{...query.filters,platform},offset:0,limit:20},value=validateResult(await read(q),platform,q);index.entries.push({platform,value,signature:fingerprint(value),first:value.rows});}
     catch(error){check();index.failures.push({platform,message:error.message||'读取失败'});}
     check();onProgress({phase:'platforms',done:index.entries.length+index.failures.length,total:platforms.length,failed:index.failures.length});
    });
    index.entries.sort((a,b)=>b.value.total-a.value.total||compare(a.platform,b.platform));index.completedAt=now();index.finished=true;
   }
   check();const entries=index.entries,known=entries.length>0||index.platforms.length===0,summary={};
   for(const key of countKeys){summary[key]=known?entries.reduce((n,e)=>n+e.value.summary[key],0):null;if(summary[key]!==null&&!count(summary[key]))invalid('汇总笔数超出可核验范围');}
   for(const key of amountKeys)summary[key]=summary[key+'Exact']=known?sumAmount(entries,key):null;
   summary.latestCollectedAt=entries.map(e=>e.value.summary.latestCollectedAt).filter(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
   const total=entries.reduce((n,e)=>n+e.value.total,0);if(!count(total))invalid('汇总笔数超出可核验范围');
   const tasks=[];let start=0;
   for(const entry of entries){const end=start+entry.value.total,left=Math.max(start,query.offset),right=Math.min(end,query.offset+query.limit);if(right>left)tasks.push({entry,offset:left-start,length:right-left});start=end;}
   const pages=new Map(),pageFailures=[];onProgress({phase:'page',done:index.platforms.length,total:index.platforms.length,failed:index.failures.length});
   await bounded(tasks,async task=>{
    const {entry,offset,length}=task;
    if(offset+length<=entry.first.length){pages.set(entry.platform,entry.first.slice(offset,offset+length));return;}
    try{const q={...query,filters:{...query.filters,platform:entry.platform},offset,limit:[20,50,100].find(n=>n>=length)},value=validateResult(await read(q),entry.platform,q);
     if(fingerprint(value)!==entry.signature){cache=null;throw Error('数据已更新，请点击查询刷新汇总与分页');}
     pages.set(entry.platform,value.rows.slice(0,length));
    }catch(error){check();pageFailures.push({platform:entry.platform,message:error.message||'当前页读取失败'});}
   });
   check();return {ok:true,version:2,view:'missing',sourceStatus:index.failures.length||pageFailures.length?'partial':'ready',source:'collected-registration-reconciliation',country:'印度',countryCode:'IN',currency:'INR',timezone:'Asia/Kolkata',successBasis:query.filters.successBasis,dateBasis:'submission',offset:query.offset,limit:query.limit,total,platforms:index.platforms.slice(),summary,
    coverage:{complete:false,registrationSnapshotComplete:false,expectedPlatforms:index.platforms.length,platformsWithRecords:known?entries.reduce((n,e)=>n+e.value.coverage.platformsWithRecords,0):null,platforms:entries.flatMap(e=>e.value.coverage.platforms),label:'仅核对已采集存款工单；表格与工作台镜像未匹配不代表来源完整。分平台读取，各平台返回时刻可能不同；点击查询刷新全部平台。'},
    rows:tasks.flatMap(task=>pages.get(task.entry.platform)||[]),batch:{partial:index.failures.length>0||pageFailures.length>0,successfulPlatforms:entries.length,expectedPlatforms:index.platforms.length,failures:index.failures.slice(),pageFailures,startedAt:index.startedAt,completedAt:index.completedAt,pageReadAt:now(),order:'platform-total-desc'}};
  }
  return {load,cancel,clear:()=>cancel(true)};
 }};
})(window);
