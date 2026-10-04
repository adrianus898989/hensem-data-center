/* Rates use only the current authorized provider aggregates and original-order cohorts. */
(function(){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const source=value=>String(value||'').toLowerCase().replaceAll('_','');
 const system=value=>({ar:'AR',newar:'新AR',wg:'WG',lg:'LG',game66:'AA'}[source(value)]||String(value||'来源未提供'));
 const count=value=>(typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
 const day=value=>{const text=String(value||'').slice(0,10),parsed=new Date(text+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===text?text:null;};
 const provider=(name,country)=>String(window.HensemProviderNames?.canonical(name,country)??name??'').trim()||'（三方未提供）';
 function fact(success,total,partial=false,note=''){
  const n=count(success),d=count(total);
  return {value:n!==null&&d!==null&&d>0?n/d*100:null,success:n,total:d,partial,note};
 }
 const unknown=note=>fact(null,null,false,note);
 function buildModel({L,scopeMatches,workordersScopeMatches}){
  const date=day(L.from),sameDay=date&&date===day(L.to);
  if(!sameDay)return {ready:false,message:'成功率分析每次只查询一个当地日，请重新选择日期。'};
  if(!L.pageQueried||L.dirty||!scopeMatches)return {ready:false,message:L.dirty?'筛选条件已修改，点击查询读取对应日期的成功率。':'请选择日期，点击查询。'};
  const seen=new Set(),columns=[],duplicateIds=new Set();
  for(const p of L.queryPlatforms||[]){if(!p?.id)continue;if(seen.has(p.id)){duplicateIds.add(p.id);continue;}seen.add(p.id);columns.push(p);}
  const payments=new Map(),tickets=new Map(),providers=new Set();let ignored=0;
  const matches=(row,p)=>p&&!duplicateIds.has(p.id)&&(!row.country||row.country===p.country)&&(!row.source||source(row.source)===source(p.source));
  for(const p of columns){
   const responses=(L.results||[]).filter(r=>r?.platform?.id===p.id);
   if(responses.length!==1||!matches(responses[0]?.platform,p))continue;
   const response=responses[0],groups=response.groups?.provider;
   if(!Array.isArray(groups))continue;
   for(const row of groups){
    if(!['charge','withdraw'].includes(row.direction))continue;
    const name=provider(row.provider,p.country),key=JSON.stringify([p.id,name,row.direction]);providers.add(name);
    const entry=payments.get(key)||{rows:[],response,platform:p};entry.rows.push(row);payments.set(key,entry);
   }
  }
  const w=L.workorders,workordersCurrent=!!workordersScopeMatches&&!L.workordersLoading&&!L.workordersError&&Array.isArray(w?.byPlatformProvider)
   &&(!w.startDate||w.startDate===date)&&(!w.endDate||w.endDate===date);
  if(workordersCurrent)for(const row of w.byPlatformProvider){
   const p=columns.find(p=>p.id===row.platformId);
   if(!row.platformId||!matches(row,p)||!['charge','withdraw'].includes(row.direction)){ignored++;continue;}
   const name=provider(row.provider,p.country),key=JSON.stringify([p.id,name,row.direction]);providers.add(name);
   const entries=tickets.get(key)||[];entries.push(row);tickets.set(key,entries);
  }
  function payment(p,name,direction){
   const entry=payments.get(JSON.stringify([p.id,name,direction]));
   if(!entry)return unknown('未返回该平台、三方与业务方向的数据；不按零处理。');
   if(direction==='withdraw'&&(source(p.source)==='wg'||entry.response.withdrawSuccessTimeAvailable===false||(entry.response.capabilities||entry.response.platform?.capabilities)?.withdrawSuccessTimeAvailable===false||p.capabilities?.withdrawSuccessTimeAvailable===false))return unknown('该来源未提供可核验的代付成功时间。');
   const totals=entry.rows.map(r=>count(r.all_count)),successes=entry.rows.map(r=>count(r.success_count));
   if(totals.includes(null)||successes.includes(null))return unknown('成功笔数或创建笔数未提供。');
   const total=totals.reduce((n,v)=>n+v,0),success=successes.reduce((n,v)=>n+v,0);
   return fact(success,total,false,'成功时间内成功笔数 ÷ 创建时间内全部笔数；含跨日成功，可能超过 100%。');
  }
  function workorder(p,name){
   if(!workordersCurrent)return unknown(L.workordersLoading?'工单读取中。':L.workordersError||'当前日期的工单汇总尚未读取。');
   let total=0,success=0,partial=false,present=0;const notes=[];
   for(const direction of ['charge','withdraw']){
    const rows=tickets.get(JSON.stringify([p.id,name,direction]))||[];
    if(!rows.length){partial=true;notes.push((direction==='charge'?'存款':'取款')+'工单未提供，未按零填补');continue;}
    if(rows.length!==1)return unknown('同平台 / 三方 / 业务方向返回多条原单汇总，不能重复相加。');
    const row=rows[0],coverage=row.uniqueCoverage,n=count(row.uniqueSuccessCount),d=count(row.uniqueOrderCount);
    if(!coverage||!['complete','partial','unavailable'].includes(coverage.status)||n===null||d===null||n>d)return unknown('原支付单去重笔数未完整提供或不一致；不使用分页工单条数代替。');
    total+=d;success+=n;present++;
    if(coverage.complete!==true||coverage.sourceCoverage?.complete===false||coverage.detailOnly===true)partial=true;
    notes.push((direction==='charge'?'存款':'取款')+'：已处理 '+n+' / 提交 '+d);
   }
   if(!present)return unknown('未返回该平台与三方的原单工单汇总。');
   return {...fact(success,total,partial,notes.join('；')+'。按平台、业务、完整原支付单号去重；有关联工单状态 4 计已处理，不代表实际到账。'+(partial?'部分来源，仅基于已采集且可去重原单。':'')),basis:'workorder'};
  }
  const rows=[...providers].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(name=>({provider:name,charge:columns.map(p=>payment(p,name,'charge')),withdraw:columns.map(p=>payment(p,name,'withdraw')),workorder:columns.map(p=>workorder(p,name))}));
  return {ready:true,date,columns,rows,ignored,workordersCurrent};
 }
 function cell(value){
  const known=value.value!==null&&Number.isFinite(value.value),label=known?value.value.toFixed(2)+'%':'—';
  const title=value.note+(known?(value.basis==='workorder'?' 合计已处理 '+value.success+' / 提交 '+value.total:' 成功 '+value.success+' / 创建 '+value.total)+' 笔。':'');
  return '<td class="success-rate-cell"><span'+(known&&value.value<40?' class="success-rate-low"':'')+' tabindex="0" title="'+escape(title)+'">'+label+(known&&value.partial?'<sup aria-label="部分来源">*</sup>':'')+'</span></td>';
 }
 function render(props){
  const {L}=props,model=buildModel(props);
  if(!model.ready)return '<div class="live-status live-query-prompt">'+escape(model.message)+'</div>';
  const notices=[];
  if(L.successDateNotice)notices.push(escape(L.successDateNotice));
  if(L.error)notices.push(escape(L.error));
  if(L.loading||L.queryRetrying)notices.push(escape(L.progress||'正在读取平台成功率；当前为部分结果。'));
  if(L.queryPaused)notices.push('查询已暂停，保留已读取结果。<button class="link" onclick="liveRetryFailed(true)">继续查询</button>');
  if(L.queryFailures?.length)notices.push('部分平台读取失败：'+escape(L.queryFailures.map(p=>p.name).join('、'))+'。<button class="link" onclick="liveRetryFailed()">重试未完成平台</button>');
  if(model.ignored)notices.push('有 '+model.ignored+' 条工单汇总无法匹配已授权平台身份，未分摊到平台。');
  const sections=[['charge','代收成功率','成功时间内成功笔数 ÷ 创建时间内全部笔数。'],['withdraw','代付成功率','成功时间内成功笔数 ÷ 创建时间内全部笔数；WG 未提供可核验成功时间时显示 —。'],['workorder','工单成功率','已处理原支付单 ÷ 全部提交原支付单；按平台、业务、完整原单号去重，状态 4 计已处理，不代表实际到账。']];
  const head='<thead><tr><th scope="col">三方</th>'+model.columns.map(p=>'<th scope="col" title="'+escape(p.name+' · '+system(p.source)+' · '+p.id)+'">'+escape(p.name)+'<small>'+escape(system(p.source))+'</small></th>').join('')+'</tr></thead>';
  return '<div class="live-success-analysis">'+(notices.length?'<div class="live-status">'+notices.join('<br>')+'</div>':'')+'<p class="success-analysis-note">'+escape(model.date)+' · 平台当地日期。低于 40% 标红；— 表示未提供或无法核验；* 为部分来源，仅基于已采集原单。跨日成功可能使代收、代付成功率超过 100%。今天截至查询时刻，手动查询更新。</p>'+sections.map(([key,title,note])=>'<section class="success-analysis-panel"><div class="success-analysis-heading"><h2>'+title+'</h2>'+(key==='workorder'&&L.workordersError?'<button type="button" class="link" onclick="liveProviderWorkordersRetry()">重试工单</button>':'')+'</div><p>'+note+'</p><div class="success-analysis-scroll" tabindex="0" role="region" aria-label="'+title+'"><table style="min-width:'+Math.max(400,112+model.columns.length*78)+'px">'+head+'<tbody>'+ (model.rows.length?model.rows.map(row=>'<tr><th scope="row">'+escape(row.provider)+'</th>'+row[key].map(cell).join('')+'</tr>').join(''):'<tr><td colspan="'+(model.columns.length+1)+'">'+(L.loading?'正在读取三方汇总…':'当前条件下未返回三方数据')+'</td></tr>')+'</tbody></table></div></section>').join('')+'</div>';
 }
 window.HensemLiveSuccessAnalysis=Object.freeze({render,buildModel,fact});
})();
