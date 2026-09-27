/* Independent seven-day backlog snapshots. No values are inferred from order aggregates. */
(function(root){
 'use strict';
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
 const token=value=>String(value||'').trim().toUpperCase();
 const names=p=>new Set([p.name,p.sourceName,p.rawPlatform,...(p.feeds||[]).map(f=>f.rawPlatform||f.name)].map(token).filter(Boolean));
 function resolvePlatforms(selected,seeds){
  const ids=new Set(),unsupported=[];
  for(const p of selected||[]){
   if(uuid(p.id)){ids.add(p.id.toLowerCase());continue;}
   const candidates=(seeds||[]).filter(s=>uuid(s.id)&&s.country===p.country&&String(s.team||'__unassigned__')===String(p.team||'__unassigned__')&&[...names(s)].some(n=>names(p).has(n))),matches=[...new Set(candidates.map(s=>s.id.toLowerCase()))];
   if(matches.length===1)ids.add(matches[0]);else unsupported.push({id:p.id||'',name:p.name||'未提供平台名',state:'unsupported',reason:matches.length?'目录身份待核对':'尚无可查询的快照目录'});
  }
  return {platformIds:[...ids].sort(),unsupported};
 }
 function create(c){
  const {L,E,N,C}=c;
  let serial=0,S={status:'idle',key:'',data:null,unsupported:[],error:''};
  const scope=()=>{const mapped=resolvePlatforms(c.selected(),L.withdrawCatalog),providers=[...new Set(c.providers().filter(Boolean))].sort();return {...mapped,request:{action:'pendingSnapshot',date:String(L.to||'').slice(0,10),platformIds:mapped.platformIds,...(providers.length?{providers}:{})},country:L.country};};
  const key=q=>JSON.stringify([q.country,q.request,q.unsupported.map(p=>[p.id,p.name])]);
  const cancel=()=>{serial++;if(S.status==='loading')S={...S,status:'paused',data:null,error:'读取已暂停，点击重试'};};
  const view=()=>L.dirty||S.key!==key(scope())?{status:'idle',data:null,unsupported:[],error:''}:S;
  const day=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value))?value:'—';
  const time=(value,timezone)=>{if(!value||!Number.isFinite(Date.parse(value)))return '—';try{return new Date(value).toLocaleString('zh-CN',{timeZone:timezone||'UTC',hour12:false})}catch{return String(value)}};
  const known=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0;
  const complete=s=>s.status==='ready'&&s.data?.complete===true&&!s.unsupported.length;
  const canShow=s=>s.data&&(complete(s)||Number(s.data.receivedPlatformCount)>0)&&known(s.data.count)&&known(s.data.amount)&&(complete(s)||Number(s.data.count)>0||Number(s.data.amount)>0);
  const totals=s=>({amount:canShow(s)?N(s.data.amount):'—',count:canShow(s)?C(s.data.count):'—'});
  const status=s=>s.status==='loading'?'正在读取结束日快照…':s.status==='error'?('快照读取失败：'+s.error):s.status==='paused'?s.error:!s.data?'请查询所选结束日快照':complete(s)?'快照完整':'快照不完整 · '+(canShow(s)?'仅含已采集小计':'尚无可用合计');
  const coverage=s=>s.data?'已采集 '+C(s.data.receivedPlatformCount)+' / '+C(Number(s.data.expectedPlatformCount||0)+s.unsupported.length)+' 平台':s.unsupported.length?'另有 '+C(s.unsupported.length)+' 平台尚无可查询快照目录':'';
  const windowText=s=>s.data?day(s.data.windowStart)+' 至 '+day(s.data.windowEnd):'截至 '+day(scope().request.date)+' 的近7天';
  const retry=s=>['error','paused'].includes(s.status)||s.status==='ready'&&!complete(s)?' <button type="button" class="link" onclick="livePendingSnapshotRetry()">重试</button>':'';
  async function load(){
   let q=scope();const id=++serial;S={status:'loading',key:key(q),data:null,unsupported:q.unsupported,error:''};
   c.render();
   try{
    await c.prepare?.();if(id!==serial||L.dirty)return;q=scope();S={...S,key:key(q),unsupported:q.unsupported};
   if(!q.request.platformIds.length){S={...S,status:'error',error:q.unsupported.length?'所选平台尚无可查询的快照目录':'当前范围没有可查询平台'};c.render();return;}
   if(q.request.platformIds.length>250){S={...S,status:'error',error:'平台超过250个，请缩小筛选范围'};c.render();return;}
    const r=await c.request(q.request);if(id!==serial||key(q)!==key(scope())||L.dirty)return;
    if(r?.basis!=='seven_day_pending_snapshot'||r.snapshotDate!==q.request.date||!Array.isArray(r.rows)||typeof r.complete!=='boolean'||!Number.isInteger(r.expectedPlatformCount)||r.expectedPlatformCount<1||!Number.isInteger(r.receivedPlatformCount)||r.receivedPlatformCount<0||r.receivedPlatformCount>r.expectedPlatformCount)throw Error('快照响应不完整，请重试');
    if(r.complete&&(!known(r.count)||!known(r.amount)||r.receivedPlatformCount!==r.expectedPlatformCount))throw Error('快照合计待核对，请重试');
    S={...S,status:'ready',data:r,error:''};
   }catch(error){if(id!==serial||key(q)!==key(scope())||L.dirty)return;S={...S,status:'error',data:null,error:error?.message||'暂时无法读取'};}
   if(id===serial)c.render();
  }
  function metric(){const s=view(),values=totals(s);return '<div class="df-flow-metric df-pending-snapshot"><span>近7天代付中金额 / 笔数</span><strong class="metric-link">'+values.amount+'</strong><small class="cell-sub">'+values.count+' 笔'+(canShow(s)&&!complete(s)?' · 已采集小计':'')+'</small><small class="cell-basis">'+E(windowText(s))+'</small><small class="df-coverage">'+E(status(s))+retry(s)+'</small></div>';}
  function summary(){const s=view(),values=totals(s),zone=s.data?.rows?.find(r=>r.timezone)?.timezone;return '<div class="pending-dash-grid">'+[['代付中金额',values.amount],['代付中笔数',values.count]].map(([label,value])=>'<div class="pending-metric"><span>'+label+'</span><strong>'+value+'</strong></div>').join('')+'</div><div class="live-definition">'+E(windowText(s))+' · '+E(status(s))+retry(s)+(coverage(s)?'<br>'+E(coverage(s)):'')+(s.data?'<br>快照日期 '+E(day(s.data.snapshotDate))+' · 最近采集 '+E(time(s.data.observedAt,zone)): '')+'</div>';}
  const stateLabel=r=>({complete:'已采集',missing:'未采到当日快照',invalid:'快照内容待核对',ambiguous:'来源重复待核对',unsupported:'尚未接入快照'}[r.state]||'待核对');
  const openDetails=(title,html)=>c.open(title,'<div class="live-pending-snapshot-detail">'+html+'</div>');
  function details(){
   const s=view();if(!s.data){openDetails('近7天代付中快照','<div class="live-status">'+E(status(s))+retry(s)+'</div>'+s.unsupported.map(p=>'<div class="live-definition">'+E(p.name)+'：'+E(p.reason)+'</div>').join(''));return;}
   const data=s.data,rows=[...data.rows,...s.unsupported];
   const groups=r=>(r.groups||[]).length?'<details><summary>三方明细（'+C(r.groups.length)+'）</summary><div class="live-table"><table><thead><tr><th>三方</th><th>原通道</th><th>通道类型</th><th>笔数</th><th>金额</th></tr></thead><tbody>'+r.groups.map(g=>'<tr><td>'+E(g.provider||'未识别通道')+'</td><td>'+E(g.rawChannel||'—')+'</td><td>'+E(g.channelType||'—')+'</td><td>'+C(g.count)+'</td><td>'+N(g.amount)+'</td></tr>').join('')+'</tbody></table></div></details>':'';
   const body='<div class="live-definition">'+E(windowText(s))+' · 快照日期 '+E(day(data.snapshotDate))+'<br>'+E(status(s))+' · '+E(coverage(s))+'<br>近7天待付存量快照，与上方订单创建范围独立；不作当日订单状态加总或昨日对比。</div><div class="live-table"><table><thead><tr><th>平台</th><th>采集状态</th><th>统计窗口</th><th>笔数</th><th>金额</th><th>币种</th><th>采集时间</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+E(r.name||r.sourceName||'—')+'</td><td>'+E(stateLabel(r))+(r.reason?'<small>'+E(r.reason)+'</small>':'')+'</td><td>'+E(day(r.windowStart))+' 至 '+E(day(r.windowEnd))+'</td><td>'+(r.state==='complete'&&known(r.count)?C(r.count):'—')+'</td><td>'+(r.state==='complete'&&known(r.amount)?N(r.amount):'—')+'</td><td>'+E(r.currency||'—')+'</td><td>'+E(time(r.snapshotAt,r.timezone))+'</td></tr>'+(r.groups?.length?'<tr><td colspan="7">'+groups(r)+'</td></tr>':'')).join('')+'</tbody></table></div>';
   openDetails('近7天代付中 · '+E(day(data.snapshotDate)),body);
  }
  return {load,cancel,metric,summary,details,capture:()=>({...S,status:S.status==='loading'?'paused':S.status,error:S.status==='loading'?'读取已暂停，点击重试':S.error}),restore:value=>{serial++;S=value?{...value}: {status:'idle',key:'',data:null,unsupported:[],error:''};},get state(){return S}};
 }
 root.HensemLivePendingSnapshot={create,resolvePlatforms};
 if(typeof module!=='undefined')module.exports={create,resolvePlatforms};
})(typeof window!=='undefined'?window:globalThis);
