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
  const payments=new Map(),tickets=new Map(),platformResponses=new Map(),platformTickets=new Map(),platformProviderRows=new Map(),providers=new Set();let ignored=0;
  const matches=(row,p)=>p&&!duplicateIds.has(p.id)&&(!row.country||row.country===p.country)&&(!row.source||source(row.source)===source(p.source));
  for(const p of columns){
   const responses=(L.results||[]).filter(r=>r?.platform?.id===p.id);
   if(responses.length!==1||!matches(responses[0]?.platform,p))continue;
   const response=responses[0],groups=response.groups?.provider;platformResponses.set(p.id,response);
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
   const nativeRows=platformProviderRows.get(p.id)||[];nativeRows.push(row);platformProviderRows.set(p.id,nativeRows);
  }
  if(workordersCurrent&&Array.isArray(w.byPlatformDirection))for(const row of w.byPlatformDirection){
   const p=columns.find(p=>p.id===row.platformId);
   if(!p||!row.country||!row.source||!matches(row,p)||!['charge','withdraw'].includes(row.direction)){ignored++;continue;}
   const key=JSON.stringify([p.id,row.direction]),entries=platformTickets.get(key)||[];entries.push(row);platformTickets.set(key,entries);
  }
  const safeSum=values=>{if(!values.length||values.includes(null))return null;const sum=values.reduce((n,v)=>n+v,0);return Number.isSafeInteger(sum)?sum:null;};
  const successTimeUnavailable=(p,response)=>source(p.source)==='wg'||response?.withdrawSuccessTimeAvailable===false||(response?.capabilities||response?.platform?.capabilities)?.withdrawSuccessTimeAvailable===false||p.capabilities?.withdrawSuccessTimeAvailable===false;
  function paymentPlatform(p,direction){
   const response=platformResponses.get(p.id);if(!response)return {...unknown('该平台尚未返回当前日期的汇总。'),volume:null};
   const native=Array.isArray(response.summary)?response.summary.filter(row=>row?.direction===direction):[],groups=Array.isArray(response.groups?.provider)?response.groups.provider:[],rows=native.length?native:groups.filter(row=>row?.direction===direction),partial=!native.length;
   if(!Array.isArray(rows)||!rows.length)return {...unknown('该业务方向未返回平台汇总；不按零处理。'),volume:null};
   if(native.length&&new Set(native.map(row=>String(row.currency??''))).size!==native.length)return {...unknown('平台方向汇总存在重复币种，不能重复相加。'),volume:null};
   const totals=rows.map(row=>count(row.all_count)),successes=rows.map(row=>count(row.success_count)),knownTotals=totals.filter(n=>n!==null),volume=safeSum(partial?knownTotals:totals);
   if(direction==='withdraw'&&successTimeUnavailable(p,response))return {...fact(null,volume,partial,'该来源未提供可核验的代付成功时间；提交笔数仅用于平台列排序。'),volume,authoritativeTotal:!!native.length};
   if(native.length)return {...fact(safeSum(successes),safeSum(totals),false,'按平台原生方向汇总：总成功笔数 ÷ 总创建笔数；不平均三方百分比，含跨日成功。'),volume,authoritativeTotal:true};
   const known=rows.filter((row,i)=>totals[i]!==null&&successes[i]!==null),total=safeSum(known.map(row=>count(row.all_count))),success=safeSum(known.map(row=>count(row.success_count)));
   return {...fact(success,total,true,'未返回平台原生方向汇总；仅按同时提供成功、创建笔数的三方分组计算已读小计；列排序使用已知创建笔数，未提供的分组不按零填补。'),volume};
  }
  function workorderPlatform(p){
   if(!workordersCurrent)return {...unknown(L.workordersLoading?'工单读取中。':L.workordersError||'当前日期的工单汇总尚未读取。'),volume:null,basis:'workorder'};
   if(!Array.isArray(w.byPlatformDirection))return {...unknown('未返回平台级跨三方去重原单汇总；不能将三方原单笔数相加代替。'),volume:null,basis:'workorder'};
   let total=0,success=0,present=0,partial=false;const notes=[];
   for(const direction of ['charge','withdraw']){
    const rows=platformTickets.get(JSON.stringify([p.id,direction]))||[];
    if(!rows.length){partial=true;notes.push((direction==='charge'?'存款':'取款')+'平台原单汇总未提供');continue;}
    if(rows.length!==1)return {...unknown('同平台与业务方向返回多条去重汇总，不能重复相加。'),volume:null,basis:'workorder'};
    const row=rows[0],coverage=row.uniqueCoverage,n=count(row.uniqueSuccessCount),d=count(row.uniqueOrderCount);
    if(!coverage||!['complete','partial'].includes(coverage.status)||n===null||d===null||n>d)return {...unknown('平台级原单去重笔数或覆盖依据未完整提供。'),volume:null,basis:'workorder'};
    total+=d;success+=n;present++;
    if(coverage.status!=='complete'||coverage.complete!==true||coverage.sourceCoverage?.complete===false||coverage.detailOnly===true)partial=true;
    notes.push((direction==='charge'?'存款':'取款')+'：已处理 '+n+' / 提交 '+d);
   }
   if(!present||!Number.isSafeInteger(total)||!Number.isSafeInteger(success))return {...unknown('未返回可核验的平台级原单汇总。'),volume:null,basis:'workorder'};
   return {...fact(success,total,partial,notes.join('；')+'。平台内跨三方按业务与完整原支付单号去重；已处理原单 ÷ 提交原单，不代表实际到账。'+(partial?'仅为已提供业务方向和来源的小计。':'')),volume:total,basis:'workorder',authoritativeTotal:true};
  }
  function providerActivity(p,key,footer){
   const response=platformResponses.get(p.id),work=key==='workorder',groupRows=work?platformProviderRows.get(p.id)||[]:Array.isArray(response?.groups?.provider)?response.groups.provider.filter(row=>row?.direction===key):[];
   if(footer.authoritativeTotal&&footer.volume===0&&(!work||!footer.partial))return {providerCount:0,providerCountPartial:false,providerCountNote:'平台原生汇总已确认该业务没有提交订单，运行三方数为 0。'};
   const names=new Set(),counts=[],unknownNames=new Set(['（三方未提供）','未识别通道','未识别三方','未提供','未标记三方','USDT']),excludedNames=new Set(['人工充值','人工确认','人工取消','无三方（驳回）','无三方(驳回)','提现转充值','无三方','manual','manualrecharge','manualconfirmation']);let unknownCount=false,unknownProvider=false;
   for(const row of groupRows){
    const n=count(work?row.uniqueOrderCount:row.all_count);if(n===null||work&&!['complete','partial'].includes(row.uniqueCoverage?.status)){unknownCount=true;continue;}counts.push(n);if(!n)continue;
    const name=provider(row.provider,p.country);if(unknownNames.has(name)){unknownProvider=true;continue;}if(excludedNames.has(name)||excludedNames.has(name.toLowerCase()))continue;names.add(name);
   }
   const unresolved=work&&['charge','withdraw'].some(direction=>(platformTickets.get(JSON.stringify([p.id,direction]))||[]).some(row=>['providerConflictCount','unresolvedProviderOrderCount'].some(key=>count(row.uniqueCoverage?.[key])>0)));
   const knownTotal=safeSum(counts),partial=footer.partial||!footer.authoritativeTotal||unknownCount||unknownProvider||unresolved||knownTotal===null||footer.volume===null||knownTotal!==footer.volume;
   return {providerCount:names.size?names.size:!partial&&groupRows.length?0:null,providerCountPartial:partial,providerCountNote:'仅计本矩阵当天有提交记录的支付三方，按统一三方名去重；人工充值、人工确认、提现转充值和无三方不计入。'+(partial?'未完整返回三方分组或存在未归属原单；有数字时为已识别小计，不代表全部运行三方。':'')};
  }
  function payment(p,name,direction){
   const entry=payments.get(JSON.stringify([p.id,name,direction]));
   if(!entry)return unknown('未返回该平台、三方与业务方向的数据；不按零处理。');
   if(direction==='withdraw'&&successTimeUnavailable(p,entry.response))return unknown('该来源未提供可核验的代付成功时间。');
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
  const paymentVolume=(name,direction)=>{
   const values=columns.flatMap(p=>(payments.get(JSON.stringify([p.id,name,direction]))?.rows||[]).map(row=>count(row.all_count))).filter(value=>value!==null);
   const total=values.reduce((sum,value)=>sum+value,0);return values.length&&Number.isSafeInteger(total)?total:null;
  };
  // Keep native scope with each original leaf so platform-specific source
  // types cannot be selected from a shared platform display name alone.
  const typeItems=(name,direction)=>columns.flatMap(p=>(payments.get(JSON.stringify([p.id,name,direction]))?.rows||[]).map(row=>({...row,provider:name,platform:p.name,platformId:p.id,country:p.country,source:p.source,scopeGroup:p.scopeGroup})));
  const rows=[...providers].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(name=>{
   const cohort=columns.map(p=>workorder(p,name)),totals=cohort.map(value=>value.total).filter(value=>value!==null),workorderTotal=totals.reduce((sum,value)=>sum+value,0);
   return {provider:name,charge:columns.map(p=>payment(p,name,'charge')),withdraw:columns.map(p=>payment(p,name,'withdraw')),workorder:cohort,typeItems:{charge:typeItems(name,'charge'),withdraw:typeItems(name,'withdraw')},volumes:{charge:paymentVolume(name,'charge'),withdraw:paymentVolume(name,'withdraw'),workorder:totals.length&&Number.isSafeInteger(workorderTotal)?workorderTotal:null}};
  });
  const footers={charge:columns.map(p=>paymentPlatform(p,'charge')),withdraw:columns.map(p=>paymentPlatform(p,'withdraw')),workorder:columns.map(workorderPlatform)};
  for(const key of ['charge','withdraw','workorder'])footers[key]=footers[key].map((footer,index)=>({...footer,...providerActivity(columns[index],key,footer)}));
  return {ready:true,date,columns,rows,footers,ignored,workordersCurrent};
 }
 function rankedColumnIndexes(model,key){
  return model.columns.map((p,index)=>({index,id:String(p.id),volume:model.footers[key][index].volume})).sort((a,b)=>a.volume===null?(b.volume===null?a.id.localeCompare(b.id):1):b.volume===null?-1:b.volume-a.volume||a.id.localeCompare(b.id)).map(item=>item.index);
 }
 function rankedRows(model,key){
  return model.rows.slice().sort((a,b)=>{
   const left=a.volumes[key],right=b.volumes[key];
   if(left===null)return right===null?a.provider.localeCompare(b.provider,'zh-CN'):1;
   if(right===null)return -1;
   return right-left||a.provider.localeCompare(b.provider,'zh-CN');
  });
 }
 function cell(value,footer=false){
  const known=value.value!==null&&Number.isFinite(value.value),label=known?value.value.toFixed(2)+'%':'—';
  const title=value.note+(known?(value.basis==='workorder'?' 合计已处理 '+value.success+' / 提交 '+value.total:' 成功 '+value.success+' / 创建 '+value.total)+' 笔。':'');
  const providers=footer?'<small class="success-analysis-provider-count" title="'+escape(value.providerCountNote)+'">'+(value.providerCount===null?'三方数未提供':value.providerCount+' 三方')+(value.providerCount!==null&&value.providerCountPartial?'<sup aria-label="已识别三方小计">*</sup>':'')+'</small>':'';
  return '<td class="success-rate-cell"><span'+(known&&value.value<40?' class="success-rate-low"':'')+' tabindex="0" title="'+escape(title)+'">'+label+(known&&value.partial?'<sup aria-label="部分来源">*</sup>':'')+'</span>'+providers+'</td>';
 }
 function typeCell(row,key,L){
  const items=row.typeItems[key];let value;
  if(!items.length)value={label:'—',state:'empty',detail:'本业务方向未返回该三方的支付分组，不推断业务类型。'};
  else if(L.feeLookupError)value={label:'读取失败',state:'review',detail:L.feeLookupError};
  else if(L.feeLookupLoading||L.feeLookupRows===null)value={label:'读取中…',state:'empty',detail:'正在读取原表业务类型'};
  else if(!window.HensemProviderSummary?.providerType)value={label:'—',state:'empty',detail:'业务类型配置尚未提供'};
  else {
   const lookup=window.HensemProviderSummary.providerType;
   value=lookup({provider:row.provider,items},L.feeLookupRows,L.country);
   // A known type in one platform cannot conceal another leaf without type
   // evidence. The underlying helper retains source-name conflict guards.
   if(value.state==='known'&&items.some(item=>lookup(item,L.feeLookupRows,item.country).state==='empty'))value={...value,label:'类型未齐',state:'review',detail:value.detail+'；部分已读取平台原表未标注业务类型'};
  }
  return '<td class="success-provider-type"><span class="provider-business-type '+escape(value.state)+'" title="'+escape(value.detail)+'">'+escape(value.label)+'</span></td>';
 }
 function render(props){
  const {L}=props,model=buildModel(props);
  if(!model.ready)return '<div class="live-status live-query-prompt">'+escape(model.message)+'</div>';
  if(!L.loading&&!L.restoredPage&&L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)props.ensureFeeLookup?.();
  const notices=[];
  if(L.successDateNotice)notices.push(escape(L.successDateNotice));
  if(L.error)notices.push(escape(L.error));
  if(L.loading||L.queryRetrying)notices.push(escape(L.progress||'正在读取平台成功率；当前为部分结果。'));
  if(L.queryPaused)notices.push('查询已暂停，保留已读取结果。<button class="link" onclick="liveRetryFailed(true)">继续查询</button>');
  if(L.queryFailures?.length)notices.push('部分平台读取失败：'+escape(L.queryFailures.map(p=>p.name).join('、'))+'。<button class="link" onclick="liveRetryFailed()">重试未完成平台</button>');
  if(model.ignored)notices.push('有 '+model.ignored+' 条工单汇总无法匹配已授权平台身份，未分摊到平台。');
  const sections=[['charge','代收成功率','成功时间内成功笔数 ÷ 创建时间内全部笔数。'],['withdraw','代付成功率','成功时间内成功笔数 ÷ 创建时间内全部笔数；WG 未提供可核验成功时间时显示 —。'],['workorder','工单成功率','已处理原支付单 ÷ 全部提交原支付单；按平台、业务、完整原单号去重，状态 4 计已处理，不代表实际到账。']];
  return '<div class="live-success-analysis">'+(notices.length?'<div class="live-status">'+notices.join('<br>')+'</div>':'')+'<p class="success-analysis-note">'+escape(model.date)+' · 平台当地日期。各区三方行与平台列分别按已读取提交笔数从多到少排列，空数据置后；低于 40% 标红；— 表示未提供或无法核验；* 为部分汇总，仅基于已提供的分组、业务或来源。底部汇总按总成功笔数 ÷ 总提交笔数计算，不平均百分比。跨日成功可能使代收、代付成功率超过 100%。今天截至查询时刻，手动查询更新。</p>'+sections.map(([key,title,note])=>{
   const withType=key!=='workorder',indexes=rankedColumnIndexes(model,key),head='<thead><tr><th scope="col">三方</th>'+(withType?'<th scope="col" class="success-provider-type">类型</th>':'')+indexes.map(index=>{const p=model.columns[index],volume=model.footers[key][index].volume;return '<th scope="col" title="'+escape(p.name+' · '+system(p.source)+' · '+p.id+' · 已读取提交笔数 '+(volume===null?'未提供':volume)+(model.footers[key][index].partial?'（部分）':''))+'">'+escape(p.name)+'<small>'+escape(system(p.source))+'</small></th>';}).join('')+'</tr></thead>';
   return '<section class="success-analysis-panel"><div class="success-analysis-heading"><h2>'+title+'</h2>'+(key==='workorder'&&L.workordersError?'<button type="button" class="link" onclick="liveProviderWorkordersRetry()">重试工单</button>':'')+'</div><p>'+note+'</p><div class="success-analysis-scroll" tabindex="0" role="region" aria-label="'+title+'"><table style="min-width:'+Math.max(400,112+(withType?60:0)+model.columns.length*78)+'px">'+head+'<tbody>'+ (model.rows.length?rankedRows(model,key).map(row=>'<tr><th scope="row">'+escape(row.provider)+'</th>'+(withType?typeCell(row,key,L):'')+indexes.map(index=>cell(row[key][index])).join('')+'</tr>').join(''):'<tr><td colspan="'+(model.columns.length+1+(withType?1:0))+'">'+(L.loading?'正在读取三方汇总…':'当前条件下未返回三方数据')+'</td></tr>')+'</tbody><tfoot class="success-analysis-footer"><tr><th scope="row">汇总成功率</th>'+(withType?'<td class="success-provider-type">—</td>':'')+indexes.map(index=>cell(model.footers[key][index],true)).join('')+'</tr></tfoot></table></div></section>';
  }).join('')+'</div>';
 }
 window.HensemLiveSuccessAnalysis=Object.freeze({render,buildModel,fact,rankedRows,rankedColumnIndexes});
})();
