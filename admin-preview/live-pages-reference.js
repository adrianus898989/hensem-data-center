/* The approved v3 page structure, populated only from authorized aggregate results. */
(function(){
 'use strict';
 const merchantProviderExpansions=new WeakMap();let merchantInlineSerial=0;
 window.HensemLivePages={create:function(c){
 const {L,E,N,C,R,plus,combine,groupRows,empty,table,box,pager,totals,comparisonRows,compareMetric,chart,matrixBody,latencyView,detailsView,providersView,platformsView,pagedTable,feeForRow,ensureFeeLookup,providerCell}=c;
 if(window.hensemCurrentAdminPage?.()!=='merchants'||L.view!=='business')merchantProviderExpansions.delete(L);
 const dirs=()=>L.direction==='all'?['charge','withdraw']:[L.direction];
 const successBasisLabel=c.successBasisLabel||(()=>((L.results||[]).some(r=>(r.capabilities||r.platform?.capabilities)?.successTimeBasis==='order_updated_at')?'成功统计时间（多利按更新时间）':'成功时间'));
 const name=d=>d==='charge'?'代收':'代付';
 const feeMode=()=>L.feeEstimateMode==='historical'?'historical':'current';
 const feeBasis=()=>feeMode()==='current'?'按当前费率估算':'按订单创建时生效费率';
 const displayPlatform=p=>window.HensemLiveReportData?.normalizeIdentity(p||{})||p||{};
 const aliasKey=p=>window.HensemLiveReportData?.confirmedAliasKey?.(p||{})||null;
 const raw=()=>L.results.flatMap(x=>{const p=displayPlatform(x.platform);return (x.summary||[]).map(r=>({...r,platform:p.name,platformId:p.id,source:p.source,country:p.country,team:p.team||'未绑定团队'}))});
 const successTotal=(rows,d)=>c.successTimeSummary?c.successTimeSummary(rows,d):plus(rows);
 const scopedFeeSummary=(rows,d)=>{const fees=window.HensemProviderSummary.feeSummary(rows);return c.successTimeUnavailable?.(d)?{...fees,amount:null,successCount:null,fee_unknown:true,complete:false}:fees;};
 const stat=d=>successTotal(raw().filter(r=>r.direction===d),d);
 const unavailable='<span class="muted" title="正式数据尚未提供此项">—</span>';
 const tab=(items,key='view')=>'<div class="section-switcher"><div class="tabs">'+items.map(([v,l])=>'<button class="'+(L[key]===v?'on':'')+'" onclick="liveReferenceSet(\''+key+'\',\''+v+'\')">'+l+'</button>').join('')+'</div></div>';
 const choose=(items,def='business')=>{if(!items.some(x=>x[0]===L.view))L.view=def;return tab(items)};
 const note=text=>'<div class="live-definition">'+text+'</div>';
 const dblock=(id,title,body,subtitle='',action='')=>'<section class="df-card" id="'+id+'"><header class="df-head"><div><h2>'+title+'</h2>'+(subtitle?'<small>'+subtitle+'</small>':'')+'</div>'+action+'</header>'+body+'</section>';
 const refTable=(headers,rows,footerRows=[])=>table(headers,rows,'table-wrap business-columns-v3',footerRows);
 function pageTable(id,headers,rows,footerRows=[],renderTable=refTable){L.tablePages=L.tablePages||{};L.tableSizes=L.tableSizes||{};const size=L.tableSizes[id]||20,page=Math.min(L.tablePages[id]||1,Math.max(1,Math.ceil(rows.length/size)));L.tablePages[id]=page;return renderTable(headers,rows.slice((page-1)*size,page*size),footerRows)+pager(rows.length,page,size,'ref-'+id)}
 const sortRegistry=new Map(),sorting=window.HensemProviderSummary,numeric=key=>({value:r=>sorting.knownNumber(r[key])}),textual=key=>({value:r=>r[key]||null,ascending:true}),ratio=(a,b)=>({value:r=>sorting.fraction(r[a],r[b])}),businessSortColumns=()=>c.businessHeaders.map(label=>label==='成功率'?ratio('success_count','all_count'):numeric(({'全部金额':'all_amount','全部笔数':'all_count','成功金额':'success_amount','成功笔数':'success_count','处理中金额':'pending_amount','处理中笔数':'pending_count','失败金额':'failed_amount','失败笔数':'failed_count'})[label]));
 function sortTable(id,headers,rows,columns){
  L.tablePages=L.tablePages||{};sortRegistry.set(id,columns);
  if(!sorting?.sortableTable)return {headers,rows};
  return sorting.sortableTable({rows,headers,columns,sort:L.tablePages['sort:'+id],onSort:index=>'liveReferenceTableSort(\''+encodeURIComponent(id)+'\','+index+')'});
 }
 window.liveReferenceTableSort=function(encoded,index){let id;try{id=decodeURIComponent(encoded)}catch{return}const columns=sortRegistry.get(id),column=columns?.[index];if(!Number.isInteger(index)||!column||typeof column.value!=='function')return;const old=L.tablePages['sort:'+id];L.tablePages['sort:'+id]={column:index,ascending:old?.column===index?!old.ascending:!!column.ascending};L.tablePages[id]=1;if(id==='daily-matrix')L.localPage=1;(c.render||window.render)();};
 function sortedPageTable(id,headers,rows,columns,cells,footerRows=[],renderTable=refTable){const sorted=sortTable(id,headers,rows,columns);return pageTable(id,sorted.headers,sorted.rows.map(cells),footerRows,renderTable)}
 const typeSort={value:r=>{if(L.feeLookupLoading||L.feeLookupError)return null;const fact=sorting.providerType(r,L.feeLookupRows,L.country);return fact.state==='empty'||fact.state==='review'?null:fact.label},ascending:true};
 const feeSort={value:r=>c.loadedFeeValue?.(r)??null},directionSort={value:r=>name(r.direction),ascending:true},providerSortPrefix=()=>[textual('provider'),typeSort,textual('source'),directionSort];
 const typeCell=r=>window.HensemProviderSummary.providerTypeCell(r,L.feeLookupRows,L.country,E,L);
 const ensureTypes=()=>{if(L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)ensureFeeLookup()};
 const share=ratio=>ratio==null?'—':R(ratio,1);
 const providerSummaryTable=(headers,rows,footerRows=[])=>{
  const columns=['provider','business-type','total-amount','total-count','success-amount','amount-share','success-count','count-share','success-rate','fee-rate','fee-amount','fee-share'];
  const renderRows=list=>list.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('');
  return '<div class="df-provider-table-scroll" tabindex="0" role="region" aria-label="三方经营明细，可横向滚动"><table class="df-provider-business-table"><colgroup>'+columns.map(key=>'<col class="'+key+'">').join('')+'</colgroup><thead><tr>'+headers.map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+renderRows(rows)+'</tbody>'+(footerRows.length?'<tfoot>'+renderRows(footerRows)+'</tfoot>':'')+'</table>'+(rows.length?'':'<div class="live-empty">当前方向没有已入库记录</div>')+'</div>';
 };
 const platformSummaryTable=(headers,rows,footerRows=[])=>{
  const widths=[70,122,64,122,64,58,112,90],total=widths.reduce((a,b)=>a+b,0),renderRows=list=>list.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('');
  return '<div class="df-platform-table-scroll"><table class="df-platform-business-table"><colgroup>'+widths.map(width=>'<col style="width:'+(width/total*100).toFixed(4)+'%">').join('')+'</colgroup><thead><tr>'+headers.map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+renderRows(rows)+'</tbody>'+(footerRows.length?'<tfoot>'+renderRows(footerRows)+'</tfoot>':'')+'</table>'+(rows.length?'':'<div class="live-empty">当前方向没有已入库记录</div>')+'</div>';
 };
 function feeCell(r){
  if(r.fee_rate_label==='不适用')return '<span class="muted" title="人工及未分配三方记录不估算三方手续费">不适用</span>';
  if(L.feeLookupLoading)return '<span class="muted">匹配中…</span>';
  if(L.feeLookupError)return '<span class="muted" title="'+E(L.feeLookupError)+'">费率读取失败</span>';
  const label=window.HensemProviderSummary.feeCoverageText(r);
  return '<span tabindex="0" title="'+E(label)+'">'+N(r.estimated_fee)+(!r.fee_complete?'<small class="provider-partial">部分</small>':'')+'</span>';
 }
 function overviewIntakeCoverage(direction){
  const data=L.overviewIntake?.[direction];
  return window.hensemCurrentAdminPage?.()==='overview'&&data?.direction===direction?sorting.intakeCoverage({...L,providerIntake:data},direction):null;
 }
 function recentOrderDate(platformId,direction){
  const rows=(c.reportCatalogRows||[]).filter(row=>row.dataset==='orders'&&row.platformId===platformId&&Array.isArray(row.directions)&&row.directions.length===1&&row.directions[0]===direction);
  const date=rows.length===1?rows[0].lastDate:null;
  return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date?date:null;
 }
 function emptyPlatformCells(direction,columnCount){
  if(L.dirty)return [];
  const failed=new Set((L.queryFailures||[]).map(p=>p.id)),received=new Map((L.results||[]).map(r=>[r.platform?.id,r])),seen=new Set(),cells=[],intake=overviewIntakeCoverage(direction);
  // A retained tab can still contain the old mapped-only alias response.
  // Suppress only confirmed aliases whose sibling returned this direction.
  const populatedAliases=new Set((L.results||[]).filter(r=>!failed.has(r.platform?.id)&&((r.summary||[]).some(s=>s.direction===direction)||Object.values(r.groups||{}).some(rows=>Array.isArray(rows)&&rows.some(s=>s.direction===direction)))).map(r=>aliasKey(r.platform)).filter(Boolean));
  for(const platform of L.queryPlatforms||[]){
   const key=aliasKey(platform),identity=key||platform.id;
   if(!platform.id||platform.reportOnly||failed.has(platform.id)||seen.has(identity)||key&&populatedAliases.has(key))continue;
   const result=received.get(platform.id);if(!result||!Array.isArray(result.summary)||result.summary.some(row=>row.direction===direction))continue;
   if(!result.summary.length&&(result.total==null||!Number.isFinite(Number(result.total))||Number(result.total)!==0))continue;
   if(Object.values(result.groups||{}).some(rows=>Array.isArray(rows)&&rows.some(row=>row.direction===direction)))continue;
   seen.add(identity);const name=displayPlatform(platform).name||result.platform?.name||'未提供';
   const prelaunch=intake?.platforms.find(item=>item.id===platform.id)?.expected===false,latest=prelaunch?null:recentOrderDate(platform.id,direction);
   const reason=prelaunch?'所选日期尚未上线':'本期未收到订单数据',detail=prelaunch?'所选日期 '+String(L.from||'').slice(0,10)+(String(L.from||'').slice(0,10)!==String(L.to||'').slice(0,10)?' 至 '+String(L.to||'').slice(0,10):'')+'；不计应采缺口':latest?'最近订单日期 '+latest:'';
   cells.push({platform:name,platformId:platform.id,_emptyCells:[E(name)+'<small class="muted" title="'+E(reason+(detail?'；'+detail:''))+'">'+(prelaunch?'尚未上线':'本期未收到')+'</small>'+(latest?'<small class="muted" title="'+E(detail)+'">最近 '+E(latest.slice(5))+'</small>':''),...Array.from({length:columnCount-1},()=>'<span class="muted" title="'+E(reason)+'">—</span>')]});
  }
  return cells;
 }
 function dimensions(key,title,id){
  const rows=window.HensemProviderSummary.overviewDimensions({orders:groupRows('provider'),summaries:raw(),rates:L.feeLookupRows,country:L.country,key,plus,combine,feeMode:feeMode()}).sort((a,b)=>b.all_count-a.all_count),isProvider=key==='provider',isPlatform=key==='platform';
  const head=isProvider?['三方','类型','全部金额','全部笔数','成功金额','金额占比','成功笔数','笔数占比','成功率','手续费率','估算手续费','手续费占比']:[key==='team'?'团队':key==='country'?'国家':'平台','全部金额','全部笔数','成功金额','成功笔数','成功率','估算手续费'];
  const renderDirection=d=>{
   const memberTitle='按成功时间；同平台当地日按会员 ID 去重，跨三方只计一次。多日显示每日去重人次之和，不是整个期间去重人数；* 表示缺少部分会员 ID 或平台资料。';
   const headers=isPlatform?[...head,'<span title="'+E(memberTitle)+'">'+E(c.memberCounts?.platformLabel?.(d)||('实际'+(d==='charge'?'充值':'取款')+(String(L.from||'').slice(0,10)!==String(L.to||'').slice(0,10)?'人次':'人数')))+'</span>']:head;
   const memberFacts=new Map(),memberFact=ids=>{const key=JSON.stringify(ids??null);if(!memberFacts.has(key))memberFacts.set(key,c.memberCounts?.platformMetric?.(ids,d));return memberFacts.get(key)};
   const memberCell=ids=>memberFact(ids)?.html||'<span class="muted" title="人数统计尚未读取">—</span>';
   const subset=rows.filter(r=>r.direction===d),fees=scopedFeeSummary(subset,d),total={...successTotal(subset,d),direction:d,estimated_fee:fees.amount,fee_matched_count:fees.matchedCount,fee_eligible_count:fees.successCount,fee_excluded_count:fees.excludedCount,fee_issues:fees.issues,fee_exclusions:fees.exclusions,fee_complete:fees.complete,fee_unknown:fees.fee_unknown,fee_mode:fees.fee_mode};
   const rateCell=r=>{const value=r.fee_rate_label==='不适用'?'不适用':L.feeLookupLoading?'匹配中…':L.feeLookupError?'读取失败':feeMode()==='current'?r.fee_reference_label:r.fee_rate_label;return '<span class="df-fee-rate" title="'+E(value)+'">'+E(value)+'</span>'};
   const successRateCell=r=>{const value=R(r.success_count,r.all_count),low=isPlatform&&d==='charge'&&Number.parseFloat(value)<=49.99;return '<span'+(low?' class="df-collection-rate-low"':'')+' title="成功时间内成功笔数 ÷ 创建时间内全部笔数；含跨日成功，可超过100%">'+value+'</span>'};
   const cells=(r,summary=false)=>[N(r.all_amount),C(r.all_count),N(r.success_amount),...(isProvider?[summary?(Number(total.success_amount)>0?'100.00%':'—'):share(r.success_amount_share)]:[]),C(r.success_count),...(isProvider?[summary?(Number(total.success_count)>0?'100.00%':'—'):share(r.success_count_share)]:[]),
    isProvider&&!summary&&!window.HensemProviderSummary.isProviderBusiness(r.provider)?'不适用':successRateCell(r),
    ...(isProvider?[summary?'—':rateCell(r)]:[]),feeCell(r),...(isProvider?[L.feeLookupLoading||L.feeLookupError?'—':summary?(fees.amount>0?'100.00%':'—'):share(r.fee_share)]:[])];
   // Empty platform rows are display-only; totals and fee coverage use actual summaries above.
   const displayRows=key==='platform'?[...subset,...emptyPlatformCells(d,headers.length)]:subset;
   const columns=[textual(key),...(isProvider?[typeSort]:[]),numeric('all_amount'),numeric('all_count'),numeric('success_amount'),...(isProvider?[numeric('success_amount_share')]:[]),numeric('success_count'),...(isProvider?[numeric('success_count_share')]:[]),{value:r=>isProvider&&!sorting.isProviderBusiness(r.provider)?null:sorting.fraction(r.success_count,r.all_count)},...(isProvider?[{value:r=>L.feeLookupLoading||L.feeLookupError?null:sorting.feeSortValue(r)}]:[]),{value:r=>L.feeLookupLoading||L.feeLookupError?null:sorting.knownNumber(r.estimated_fee)},...(isProvider?[{value:r=>L.feeLookupLoading||L.feeLookupError?null:sorting.knownNumber(r.fee_share)}]:[])];
   if(isPlatform)columns.push({value:r=>memberFact(r.platformId)?.value??null});
   const rowCells=r=>{if(r._emptyCells)return r._emptyCells;return [isProvider?providerCell({...r,source:''}):E(r[key]||'未提供'),...(isProvider?[typeCell(r)]:[]),...cells(r),...(isPlatform?[memberCell(r.platformId)]:[])];};
   const body=sortedPageTable(id+'-'+d,headers,displayRows,columns,rowCells,[['<strong>'+E(name(d)+'汇总')+'</strong>',...(isProvider?['—']:[]),...cells(total,true),...(isPlatform?[memberCell([...new Set(displayRows.map(r=>r.platformId))])]:[])]],isProvider?providerSummaryTable:isPlatform?platformSummaryTable:refTable);
   const feeStatus=L.feeLookupLoading?'手续费匹配中…':L.feeLookupError?'费率读取失败':'手续费已匹配 '+C(fees.matchedCount)+' / '+C(fees.successCount)+' 笔'+(fees.complete?'':' · 部分费率未匹配');
   const intake=isPlatform?overviewIntakeCoverage(d):null,coverage=intake?.notExpected.length?' · 应采 '+C(intake.requested)+' 平台 · 所选日期尚未上线 '+C(intake.notExpected.length)+' 平台（不计缺口）':'';
   return dblock(id+'-'+d,title+' · '+name(d),'<div class="df-business-summary'+(isProvider?' df-provider-business-summary':isPlatform?' df-platform-business-summary':'')+'">'+body+'</div>',E(L.currency)+' · <span tabindex="0" title="'+E(L.feeLookupLoading?'正在读取费率':L.feeLookupError?'费率读取失败':window.HensemProviderSummary.feeCoverageText(fees))+'">'+(subset.length?feeStatus:'当前方向无数据')+'</span>'+coverage);

  };
  return dblock(id,title,'<div class="df-grid df-two">'+dirs().map(renderDirection).join('')+'</div>',(isProvider?'同名三方合并；占比按本方向成功数据；手续费占比按已匹配费用。人工不参与三方成功率比较。':'手续费逐平台、逐三方匹配后汇总。')+' '+feeBasis()+'。成功率＝成功时间内成功笔数 ÷ 创建时间内全部笔数，含跨日成功。');
 }
 function feeRows(direction){return window.HensemProviderSummary.overviewDimensions({orders:groupRows('provider'),summaries:raw(),rates:L.feeLookupRows,country:L.country,key:'platform',plus,combine,feeMode:feeMode()}).filter(row=>row.direction===direction)}
 function providerExtremes(direction){
  // A zero-success ordinary withdrawal is not a provider comparison candidate; keep its ledger row.
  const zeroOrdinaryPayout=r=>direction==='withdraw'&&String(r.provider).trim()==='普通提现'&&r.success_amount!=null&&r.success_count!=null&&Number(r.success_amount)===0&&Number(r.success_count)===0;
  const list=combine(groupRows('provider').filter(r=>r.direction===direction),['provider','currency']).filter(r=>window.HensemProviderSummary.isProviderBusiness(r.provider)&&r.success_count!=null&&Number(r.all_count)>=1000&&!zeroOrdinaryPayout(r))
   .map(r=>({...r,rate:Number(r.success_count)/Number(r.all_count)})),byVolume=(a,b)=>b.all_count-a.all_count||b.success_count-a.success_count||String(a.provider).localeCompare(String(b.provider)),byRate=(a,b)=>b.rate-a.rate||b.success_count-a.success_count||byVolume(a,b);
  // Only the collection high-rate shortlist excludes ArbPay; ledger totals and payout keep it.
  const high=list.filter(r=>direction!=='charge'||String(r.provider).trim().toLowerCase()!=='arbpay').sort(byVolume).slice(0,10).sort(byRate).slice(0,3),chosen=new Set(high.map(r=>r.provider));
  const low=list.slice().sort(byVolume).slice(0,10).filter(r=>!chosen.has(r.provider)).sort((a,b)=>a.rate-b.rate||byVolume(a,b)).slice(0,3);
  const renderList=(rows,label,tone)=>'<div class="df-provider-rank '+tone+'"><b>主要三方 · '+label+'</b>'+(!rows.length?'<span class="muted">暂无符合笔数条件的三方</span>':'<div class="df-provider-rank-labels"><span>三方</span><span>成功金额</span><span>成功率</span><span>成功笔数</span></div>'+rows.map(r=>'<span class="df-provider-rank-item" title="成功金额、笔数按成功时间；成功率＝成功 '+C(r.success_count)+' / 创建 '+C(r.all_count)+' 笔，含跨日成功"><span>'+E(r.provider)+'</span><span class="df-rank-amount">'+N(r.success_amount)+'</span><strong>'+R(r.success_count,r.all_count)+'</strong><small>'+C(r.success_count)+'</small></span>').join(''))+'</div>';
  return '<div class="df-flow-provider-extremes" aria-label="'+name(direction)+'三方成功率比较">'+renderList(high,'成功率较高','high')+renderList(low,'成功率较低','low')+'</div>';
 }
 function flow(d){
  if(!L.loading&&L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)ensureFeeLookup();
  const a=stat(d),tone=d==='charge'?'collect':'payout',fees=scopedFeeSummary(feeRows(d),d);
  const directionRows=raw().filter(r=>r.direction===d),currencies=new Set(directionRows.map(r=>r.currency).filter(Boolean)),multiCurrency=currencies.size>1;
  const amountCaveat=(key)=>{if(a[key+'_amount']!==null||Number(a[key+'_count']||0)<=0)return '';if(multiCurrency)return '<small class="cell-warning" title="当前方向包含多个币种，系统不把不同币种相加">多币种 · 请按币种查看</small>';const missing=Number(a.missing_amount_count||0);return '<small class="cell-warning" title="金额不完整时不猜测总额">金额待补齐'+(missing?' · '+C(missing)+'笔缺少金额':'')+'</small>';};
  const metrics=[['all','全部','创建时间'],['success','成功',successBasisLabel()],['pending','处理中','创建时间'],['failed','失败','创建时间']].map(([k,l,basis])=>d==='withdraw'&&k==='pending'?(c.pendingSnapshot?.metric()||'<div class="df-flow-metric"><span>代付中金额 / 笔数</span><strong>—</strong><small>快照模块尚未加载</small></div>'):'<div class="df-flow-metric"><span>'+l+'金额 / 笔数</span><strong class="metric-link">'+N(a[k+'_amount'])+'</strong><small class="cell-sub">'+C(a[k+'_count'])+' 笔</small><small class="cell-basis">按'+basis+'</small>'+amountCaveat(k)+compareMetric(k+'_amount',a,false,d)+'</div>').join('');
  const success='<div class="df-flow-metric df-flow-rate"><span>'+name(d)+'成功率 · 成功 / 创建</span><strong class="metric-link">'+R(a.success_count,a.all_count)+'</strong><small class="cell-sub" title="成功时间内成功笔数 ÷ 创建时间内全部笔数；两者日期口径不同，跨日成功可能使比值超过100%">本期成功 '+C(a.success_count)+' / 本期创建 '+C(a.all_count)+' 笔；含跨日成功</small>'+compareMetric('',a,true,d,'success')+'</div>';
  const feeNote=L.feeLookupError?'费率读取失败':L.feeLookupLoading?'正在匹配费率':fees.fee_unknown?'成功时间口径未提供，手续费暂不可统计':fees.successCount?'已匹配 '+C(fees.matchedCount)+' / '+C(fees.successCount)+' 笔'+(fees.complete?'':' · 部分匹配'):fees.excludedCount?'人工业务不计三方手续费':'本期无成功订单';
  const states='<div class="df-state-tail">'+[['rejected','驳回'],['unknown','未知状态']].map(([k,l])=>'<span>'+l+'金额 <b>'+N(a[k+'_amount'])+'</b></span><span>'+l+'笔数 <b>'+C(a[k+'_count'])+'</b></span>').join('')+'</div>';
  return dblock('df-'+tone,name(d)+'经营总数据','<div class="df-flow-grid">'+metrics+success+providerExtremes(d)+'</div>'+(c.memberCounts?.metric(d)||'')+'<div class="df-flow-foot"><div class="df-flow-fee"><span>估算手续费</span><strong>'+N(L.feeLookupLoading||L.feeLookupError?null:fees.amount)+'</strong><small class="df-coverage" tabindex="0" title="'+E(L.feeLookupLoading?'正在读取费率':L.feeLookupError?'费率读取失败':window.HensemProviderSummary.feeCoverageText(fees))+'">'+E(feeNote)+' · '+feeBasis()+'</small>'+states+'</div>'+workorderRanks(d)+'</div>','', '<span class="df-direction '+tone+'">'+(d==='charge'?'↙ 代收':'↗ 代付')+'</span>');
 }
 function workorderRanks(direction){
  const label=direction==='charge'?'存款':'取款',wrapper=body=>'<div class="df-workorder-ranks" data-live-overview-workorders aria-label="'+label+'工单三方排名">'+body+'</div>';
  if(!L.workorders){const message=L.workordersUnsupported?'所选平台来源尚未接入工单数据':L.workordersError?'工单读取未完成':L.workordersLoading?'正在读取工单排名…':'工单排名将在经营数据后读取';return wrapper('<div class="df-workorder-rank-status">'+E(message)+(L.workordersError&&!L.workordersUnsupported?' <button class="link" onclick="liveOverviewWorkorders()">重试</button>':'')+'</div>')}
  const merged=new Map(),keys=['submittedCount','successCount','successAmount','notReceivedCount','notReceivedAmount'];
  for(const item of L.workorders.byProvider||[]){if(item.direction!==direction)continue;const provider=window.HensemProviderNames?.canonical(item.provider,L.country)||item.provider;if(!window.HensemProviderSummary.isProviderBusiness(provider))continue;const row=merged.get(provider)||{provider,...Object.fromEntries(keys.map(k=>[k,0]))};for(const key of keys)row[key]+=Number(item[key]||0);merged.set(provider,row)}
  const rows=[...merged.values()].filter(r=>r.submittedCount>0),coverage=L.workorders.coverage,unsupported=L.workorders.unsupportedPlatforms||[];
  const covered=coverage?.capturedPlatformDays,expected=coverage?.expectedPlatformDays,known=Number.isFinite(covered)&&Number.isFinite(expected)&&expected>0;
  const coverageLabel=known?'工单覆盖 '+C(covered)+' / '+C(expected)+' 平台日':coverage?.complete?'工单覆盖完整':'工单覆盖待核对';
  const missing=(coverage?.platforms||[]).filter(p=>p.complete!==true&&Number(p.days)<Number(p.expectedDays));
  const coverageDetail=coverageLabel+(missing.length?'；未读到记录：'+missing.map(p=>p.platform+'（'+p.days+'/'+p.expectedDays+'天）').join('、'):'')+(unsupported.length?'；未接入：'+unsupported.join('、'):'')+'；按工单提交日期统计';
  if(!rows.length)return wrapper('<div class="df-workorder-rank-status" title="'+E(coverageDetail)+'">暂无已采集的'+label+'三方工单</div>');
  const more=rows.filter(r=>r.notReceivedCount>0).sort((a,b)=>b.notReceivedCount-a.notReceivedCount||b.notReceivedAmount-a.notReceivedAmount||a.provider.localeCompare(b.provider)).slice(0,3);
  const better=rows.filter(r=>r.submittedCount>=30&&r.successCount>0&&r.successCount<=r.submittedCount).sort((a,b)=>b.successCount/b.submittedCount-a.successCount/a.submittedCount||b.submittedCount-a.submittedCount||a.provider.localeCompare(b.provider)).slice(0,3);
  const amount=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
  const group=(items,good)=>'<section class="df-workorder-rank '+(good?'good':'pending')+'"><b title="'+E(coverageDetail+'；'+(good?'提交≥30笔；按到账率降序':'按未到账笔数、金额降序'))+'">'+label+' · '+(good?'工单到账率较高':'未到账最多')+'</b><div class="df-workorder-rank-labels '+(good?'good':'pending')+'"><span>三方</span>'+(good?'<span>到账率</span><span>到账 / 提交</span><span>到账金额</span>':'<span>未到账笔数</span><span>未到账金额</span>')+'</div>'+(items.length?items.map(r=>'<div class="df-workorder-rank-row '+(good?'good':'pending')+'" title="'+E(r.provider+'；提交 '+C(r.submittedCount)+' 笔；到账 '+C(r.successCount)+' 笔，'+N(r.successAmount)+' '+L.currency+'；未到账 '+C(r.notReceivedCount)+' 笔，'+N(r.notReceivedAmount)+' '+L.currency)+'"><span>'+E(r.provider)+'</span>'+(good?'<strong>'+R(r.successCount,r.submittedCount)+'</strong><small>'+C(r.successCount)+'/'+C(r.submittedCount)+'</small><span>'+E(amount(r.successAmount))+'</span>':'<strong>'+C(r.notReceivedCount)+' 笔</strong><span>'+E(amount(r.notReceivedAmount))+'</span>')+'</div>').join(''):'<span class="df-workorder-rank-empty">'+(good?'暂无达到30笔的已到账工单三方':'已采集工单暂无未到账')+'</span>')+'</section>';
  return wrapper(group(more,false)+group(better,true));
 }
 function waiting(){return dblock('df-backlog',E(c.pendingSnapshot?.title()||'代付中'),c.pendingSnapshot?.summary()||'<div class="live-empty">待付模块尚未加载</div>',E(c.pendingSnapshot?.subtitle()||''),'<button type="button" class="link" onclick="livePendingSnapshotDetails()">'+E(c.pendingSnapshot?.detailLabel()||'平台明细 →')+'</button>')}
 function risk(){return dblock('df-risk','三方风险分布','<div class="df-risk-grid">'+[['减量 / 暂停','red'],['控量 / 调整','amber'],['正常','green'],['样本不足','gray']].map(([l,k])=>'<div class="df-risk-item '+k+'"><b>—</b><small>家三方</small><span>'+l+'</span></div>').join('')+'</div>'+note('风险事件与规则评估尚未接入'),'风险规则评估')}
 function exceptions(){return dblock('df-exceptions','独立掉单与异常','<div class="df-exception-metrics">'+['已核对掉单关联金额','异常关联金额'].map(l=>'<div><span>'+l+'</span><strong class="metric-link">—</strong><small class="cell-sub">— 笔</small><small class="df-coverage">核对标记未接入</small></div>').join('')+'</div>','按订单去重 · 与业务状态可重叠')}
 function cases(){const by=L.workorders?.byDirection||{},loading=L.workordersLoading,row=(label,key)=>{const v=by[key]||{};return [label,N(v.submittedAmount),C(v.submittedCount),N(v.successAmount),C(v.successCount),N(v.notReceivedAmount),C(v.notReceivedCount),R(v.successCount,v.submittedCount),R(v.successAmount,v.submittedAmount)]};const rows=[row('存款未到账','charge'),row('提款未到账','withdraw')];return dblock('df-workorders','工单未到账',refTable(['工单类型','提交金额','提交笔数','到账成功金额','到账成功笔数','尚未成功金额','尚未成功笔数','成功笔数占比','成功金额占比'],rows),'按已采集的存款 / 取款未到账事实汇总 · '+(loading?'正在读取 Supabase 正式工单日汇总':'Supabase 正式 AR 工单日汇总；无数据方向仍保留为 0'),' <button class="link" onclick="setPage(\'workorders\')">完整工单未到账分析 →</button>')}
 function trend(d,money=false){return c.overviewChart(money,d)}
 function dashboard(){
  const section=L.overviewSections||{},full=L.loadedView==='full'||Number(section.done)>0,ready=L.loadedView==='full'||section.status==='ready';
  const renderAnalysis=body=>c.overviewAnalysisRender?c.overviewAnalysisRender(body):body();
  const analysisStatus=()=>{
   if(ready)return '';
   const loading=section.status==='loading',message=loading?'正在读取本页分析：已返回 '+C(section.done||0)+' / '+C(section.total||0)+' 个平台。':section.status==='partial'?'分析仅含已读取的 '+C(section.done)+' / '+C(section.total)+' 个平台。':section.status==='error'?'分析读取失败，尚无可展示结果。':'滚动到这里会自动读取并展示，无需离开总览。';
   return '<div class="df-analysis-status"><span>'+message+'</span><button class="btn small" '+(L.loading||loading?'disabled':'')+' onclick="liveOverviewAnalysis()">'+(loading?'读取中…':section.failures?.length?'重试未完成平台':'加载本页分析')+'</button>'+(section.failures?.length?'<details><summary>查看未完成平台（'+C(section.failures.length)+'）</summary>'+section.failures.map(f=>'<div>'+E(f.name||f.id)+'：'+E(f.message)+'</div>').join('')+'</details>':'')+'</div>';
  };
  const deferred=(id,title)=>'<div data-live-overview-analysis>'+dblock(id,title,analysisStatus())+'</div>';
  const trends=full?'<div data-live-overview-analysis>'+analysisStatus()+renderAnalysis(()=>'<div class="df-grid df-two" id="df-order-trend">'+dirs().map(d=>dblock('df-'+d+'-trend','24 小时 · '+name(d)+'全部 / 成功订单',trend(d),'全部 / 处理中按创建小时；成功按成功小时 · 各平台当地时间')+dblock('df-'+d+'-money','24 小时 · '+name(d)+'订单金额',trend(d,true),'全部 / 处理中按创建小时；成功按成功小时 · '+E(L.currency))).join('')+'</div>')+'</div>':deferred('df-order-trend','24 小时趋势');
  const workorderStatus=L.workordersUnsupported?'所选平台来源尚未接入工单数据':L.workordersLoading?'正在读取工单汇总…':L.workordersError?'工单读取失败：'+E(L.workordersError):'滚动到这里会自动读取并展示工单汇总。';
  const workorders='<div data-live-overview-workorders>'+(L.workorders?cases():dblock('df-workorders','工单未到账','<div class="df-analysis-status"><span>'+workorderStatus+'</span>'+(L.workordersUnsupported?'':'<button class="btn small" '+(L.loading||L.workordersLoading?'disabled':'')+' onclick="liveOverviewWorkorders()">'+(L.workordersLoading?'读取中…':L.workordersError?'重试工单读取':'加载工单汇总')+'</button>')+'</div>'))+'</div>';
  const amounts=full?'<div data-live-overview-analysis>'+analysisStatus()+renderAnalysis(()=>'<div id="df-amounts">'+c.overviewAmounts()+'</div>'+dirs().map(d=>dblock('df-hour-'+d,'24 小时 × 金额区间 · '+name(d),matrixBody(d),'00–23 时 · 全部笔数、全部金额与成功率','<button class="link" onclick="setPage(\'matrix\')">完整交叉分析 →</button>')).join(''))+'</div>':deferred('df-amounts','金额档位与交叉');
  const duration=full?'<div id="df-duration" data-live-overview-analysis>'+analysisStatus()+renderAnalysis(()=>latencyView(false)+latencyView(true))+'</div>':deferred('df-duration','到账时效');
  return '<div class="dashboard-full-v3"><div class="df-grid df-two">'+dirs().map(flow).join('')+'</div><div class="df-grid df-three">'+waiting()+risk()+exceptions()+'</div>'+trends+dimensions('team','团队经营汇总','df-teams')+dimensions('country','国家经营汇总','df-countries')+dimensions('platform','平台经营汇总','df-platforms')+dimensions('provider','三方经营汇总','df-providers')+amounts+workorders+duration+'</div>';
 }
 function groupedData(kind){
  const field=kind==='hourly'?'hour':'bucket',normalized=groupRows(kind).map(row=>({...row,[field]:field==='hour'&&row.hour!==null&&String(row.hour).trim()!==''&&Number.isInteger(Number(row.hour))?Number(row.hour):String(row[field]??'unknown')}));
  const rows=combine(normalized,['direction',field]),keys=direction=>kind==='hourly'?Array.from({length:24},(_,h)=>h):kind==='amount_range'?(c.amountBandKeys?.(direction)||['100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001']):['100','200','300','400','500','750','1000','1500','2000','5000'];
  return dirs().flatMap(direction=>[...keys(direction),...[...new Set(rows.filter(r=>r.direction===direction).map(r=>r[field]))].filter(k=>!keys(direction).includes(k))].map(k=>({...empty(),direction,[field]:k,...rows.find(r=>r.direction===direction&&r[field]===k)})));
 }
 function analytical(kind){
  const time=kind==='hourly',groupKind=time?'hourly':L.matrixMode==='range'?'amount_range':'amount',first=time?'时段':'金额档位 · '+E(L.currency),items=time?[['business','时段金额与状态'],['checks','时段费用与核对'],['trend','24 小时订单趋势']]:[['business','金额分布与订单状态'],['checks','金额档位费用与核对'],['trend','全部订单金额结构']],nav=choose(items),rows=groupedData(groupKind),label=r=>time?String(r.hour).padStart(2,'0')+':00–'+String(r.hour).padStart(2,'0')+':59:59':c.amountLabel?c.amountLabel(r.bucket,r.direction):r.bucket==='other'?'其他金额':r.bucket==='unknown'?'金额缺失':String(r.bucket);
  let body='';const tools=time?'':'<div class="tabs"><button class="'+(L.matrixMode!=='range'?'on':'')+'" onclick="liveMatrixMode(\'exact\')">精确金额</button><button class="'+(L.matrixMode==='range'?'on':'')+'" onclick="liveMatrixMode(\'range\')">金额区间</button></div>';
  if(L.view==='business'){
   const id='analysis-state',columns=[textual('direction'),{value:r=>time?sorting.knownNumber(r.hour):/^(?:other|unknown)$/.test(String(r.bucket))?null:sorting.knownNumber(String(r.bucket).replaceAll(',','').match(/\d+(?:\.\d+)?/)?.[0]),ascending:true},...businessSortColumns()],sorted=sortTable(id,['方向',first,...c.businessHeaders],rows,columns),headers=sorted.headers,cells=r=>[name(r.direction),E(label(r)),...c.businessCells(r)];
   let bodyTable;
   if(c.analysis?.table){
    L.tablePages=L.tablePages||{};L.tableSizes=L.tableSizes||{};const size=L.tableSizes[id]||20,page=Math.min(L.tablePages[id]||1,Math.max(1,Math.ceil(rows.length/size)));L.tablePages[id]=page;
    bodyTable=c.analysis.table({id,headers,aligned:false,rows:sorted.rows.slice((page-1)*size,page*size),cells,segment:r=>({kind:groupKind,direction:r.direction,...(time?{hour:Number(r.hour)}:{bucket:String(r.bucket)})}),label})+pager(rows.length,page,size,'ref-'+id);
   }else bodyTable=pageTable(id,headers,sorted.rows.map(cells));
   body=box(items[0][1],bodyTable,(time?'每小时 · 各平台当地时间':'金额 '+E(L.currency)+(L.matrixMode==='range'?' · 10档；下限含、上限不含，最后一档含上限':' · 精确金额'))+'；全部按创建时间，成功按成功时间；展开查看各平台占比'+(String(L.from||'').slice(0,10)!==String(L.to||'').slice(0,10)?'与每日对比':''),tools);
  }
  if(L.view==='checks')body=box(items[1][1],pageTable('analysis-checks',['方向',first,'估算手续费','掉单金额','掉单笔数','掉单占比','异常金额','异常笔数','异常占比'],rows.map(r=>[name(r.direction),E(label(r)),...Array(7).fill(unavailable)])),'掉单、异常独立统计 · 正式核对标记未接入');
  if(L.view==='trend')body=dirs().map(d=>box(name(d)+' · '+items[2][1],time?chart(rows.filter(r=>r.direction===d)):bars(rows.filter(r=>r.direction===d).map(r=>({name:E(label(r)),value:r.all_amount}))))).join('');
  return '<div class="analysis-compact">'+totals()+nav+(c.matrixCustom?.pageControls(time?'time':'amount')||'')+body+'</div>';
 }
 function bars(rows){const max=Math.max(1,...rows.map(r=>Number(r.value)||0));return '<div class="panel-body">'+rows.map(r=>'<div class="live-reference-bar"><span>'+r.name+'</span><div><i style="width:'+Math.max(0,(Number(r.value)||0)/max*100)+'%"></i></div><b>'+N(r.value)+'</b></div>').join('')+'</div>'}
 const merchantDirections=['charge','withdraw'];
 const merchantFeeMode=feeMode;
 const merchantFeeNote=()=>merchantFeeMode()==='current'?'当前费率参考估算：按所选成功时间内的成功金额、笔数，逐平台、逐三方匹配当前参考费率；不是历史实际手续费。仅汇总已匹配部分；币种、固定费币种或阶梯依据不足的部分保留待确认。':'历史生效费率：按订单创建时间匹配已发布的生效版本；缺少生效日期或未匹配的订单不会按当前参考价补算，也不会算成 0。';
 const currentFeeReasons={missing_rate:'未找到当前费率',missing_category_rate:'未找到该原始类型的费率',rates_unavailable:'当前费率未读取',conflicting_rates:'适用费率冲突',unsupported_rate:'复杂规则待确认',unknown_currency:'订单币种未确认',unknown_leaf_identity:'原平台计费依据未确认',fixed_fee_currency_unconfirmed:'固定费币种未确认',fee_currency_mismatch:'费用币种不符',mixed_fee_exemption:'免手续费金额未拆分',missing_success_count:'成功笔数未提供',missing_fee_bands:'金额分档未完整提供',invalid_fee_bands:'金额分档待核对',unconfirmed_amount_band:'金额区间费率待确认',missing_provider_breakdown:'三方分组未完整提供',inconsistent_provider_breakdown:'三方分组计数待核对',missing_provider:'三方未识别',invalid_success_amount:'成功金额待确认',mixed_currency:'币种不能合计'};
 function merchantModeFeeRow(row){
  return sorting.feeModeRow(row,L.feeLookupRows,L.country,merchantFeeMode());
 }
 const merchantFeeCoverage=row=>{
  if(merchantFeeMode()==='historical')return sorting.feeCoverageText(row);
  const fact=row.fee_current_facts||{},eligible=sorting.knownNumber(fact.eligibleCount),matched=sorting.knownNumber(fact.matchedCount),unknown=sorting.knownNumber(fact.unknownCount),rate=eligible>0&&matched!==null?R(matched,eligible):'—';
  return '按当前费率参考估算，非历史实际手续费。成功总笔数 '+C(fact.successCount)+'；不计三方手续费 '+C(fact.excludedCount)+'；已匹配 '+C(matched)+' / '+C(eligible)+' 笔（'+rate+'）；待确认 '+C(unknown)+' 笔。'+(fact.reasons||[]).map(x=>(x.platform?x.platform+' / ':'')+(x.provider||'未识别三方')+' '+C(x.count)+' 笔（'+(currentFeeReasons[x.reason]||'计费依据待确认')+'）').join('；')+(eligible===null?'成功时间口径或计数未完整提供，不能确认完整估算。':'仅汇总已匹配部分，未匹配不计为零手续费。');
 };
 function merchantFeeControls(){
  return '<div class="merchant-fee-mode"><label>手续费口径 <select class="btn small" aria-label="商户手续费估算口径" onchange="liveMerchantFeeMode(this.value)"><option value="current" '+(merchantFeeMode()==='current'?'selected':'')+'>当前费率参考估算</option><option value="historical" '+(merchantFeeMode()==='historical'?'selected':'')+'>历史生效费率</option></select></label><span class="merchant-fee-mode-note" role="note">'+E(merchantFeeNote())+'</span></div>';
 }
 window.liveMerchantFeeMode=function(value){
  if(!['current','historical'].includes(value)||window.hensemCurrentAdminPage?.()!=='merchants'||typeof window.hensemRoleAllowed==='function'&&!window.hensemRoleAllowed('merchants','view'))return;
  L.feeEstimateMode=value;(c.render||window.render)();
 };
 function merchantRows(provider=false){
  const rows=sorting.overviewDimensions({orders:groupRows('provider'),summaries:raw(),rates:L.feeLookupRows,country:L.country,key:provider?'provider':'platform',plus,combine}).map(merchantModeFeeRow);
  const pairs=new Map(),id=r=>JSON.stringify(provider?[r.provider,r.currency||'']:[(r._platformIdentity||r.platformId||JSON.stringify([r.source,r.country,r.platform])),r.currency||'']);
  for(const row of rows){
   if(!merchantDirections.includes(row.direction))continue;const key=id(row);
   if(!pairs.has(key))pairs.set(key,{...row,directions:{},sources:[],platformIds:[]});
   const pair=pairs.get(key);pair.directions[row.direction]=row;
   pair.sources=[...new Set([...pair.sources,...(row.sources||[row.source]).filter(Boolean)])].sort();
   pair.platformIds=[...new Set([...pair.platformIds,...(row.platformIds||[row.platformId]).filter(Boolean)])];
   if(provider)pair.source=pair.sources.join(' / ');
  }
  if(!provider){
   const populated=new Set(rows.map(r=>r.platformId).filter(Boolean)),seen=new Set();
   for(const emptyRow of [...emptyPlatformCells('charge',1),...emptyPlatformCells('withdraw',1)]){
    if(populated.has(emptyRow.platformId)||seen.has(emptyRow.platformId))continue;seen.add(emptyRow.platformId);
    const p=(L.queryPlatforms||[]).find(p=>p.id===emptyRow.platformId)||{};
    const row={...emptyRow,source:p.source||'',currency:p.currency||L.currency||'',directions:{}};pairs.set(id(row),row);
   }
  }
  return [...pairs.values()].sort((a,b)=>String(provider?a.provider:a.platform).localeCompare(String(provider?b.provider:b.platform))||String(a.source||'').localeCompare(String(b.source||''))||String(a.currency||'').localeCompare(String(b.currency||'')));
 }
 function merchantBusiness(provider=false){
  if(!L.loading&&!L.restoredPage)ensureTypes();
  const id=provider?'merchant-providers-unified':'merchant-platforms-unified',rows=merchantRows(provider),currencies=[...new Set(rows.map(r=>r.currency||''))],mixedCurrencies=currencies.length>1;
  const sourceLabel=value=>({ar:'AR',newar:'新AR',new_ar:'新AR',wg:'WG',lg:'LG',duoli:'多利',doli:'多利',kb:'KB',game66:'GAME66','66game':'GAME66'}[String(value||'').toLowerCase()]||String(value||'—'));
  const sources=r=>[...new Set((r.sources||[r.source]).filter(Boolean).map(sourceLabel))].join(' / ')||'—';
  const metrics=[...['all','success','pending','failed'].flatMap(key=>[{key:key+'_amount',label:({all:'全部',success:'成功',pending:'处理中',failed:'失败'})[key]+'金额',width:94},{key:key+'_count',label:({all:'全部',success:'成功',pending:'处理中',failed:'失败'})[key]+'笔数',width:60}]),{key:'success_rate',label:'成功率',width:60},{key:'fee',label:'手续费',width:90},{key:'fee_coverage',label:'匹配占比',width:68},...(!provider?[{key:'members',label:String(L.from||'').slice(0,10)===String(L.to||'').slice(0,10)?'实际人数':'实际人次',width:64}]:[])];
  const rowFor=(r,d)=>r.directions[d]?{...r.directions[d],...successTotal([r.directions[d]],d)}:null;
  const memberFact=(r,d)=>c.memberCounts?.platformMetric?.(r.platformIds||[r.platformId],d);
  const providerLeaves=groupRows('provider'),summaries=raw(),usageCache=new Map();
  function providerUsage(r){
   if(usageCache.has(r))return usageCache.get(r);
   const ids=new Set(r.platformIds||(r.platformId?[r.platformId]:Object.values(r.directions).flatMap(row=>row.platformIds||[row.platformId]).filter(Boolean))),sameCurrency=row=>(row.currency||'')===(r.currency||''),leaves=providerLeaves.filter(row=>ids.has(row.platformId)&&sameCurrency(row)&&merchantDirections.includes(row.direction)),facts=summaries.filter(row=>ids.has(row.platformId)&&sameCurrency(row)&&merchantDirections.includes(row.direction)),names=new Set();let unidentified=false,incomplete=!leaves.length;
   for(const leaf of leaves){
    const created=sorting.knownNumber(leaf.all_count),success=sorting.knownNumber(leaf.success_count);if(!(created>0||success>0))continue;
    const name=String(window.HensemProviderNames?.canonical(leaf.provider,leaf.country||L.country)??leaf.provider??'').trim();
    if(!name||['未识别通道','未识别三方','未提供','未标记三方','USDT'].includes(name)){unidentified=true;continue;}
    if(!sorting.isProviderBusiness(name)||['提现转充值','无三方','manual','manualrecharge','manualconfirmation'].includes(name.toLowerCase()))continue;
    names.add(name);
   }
   for(const fact of facts){const scope=leaves.filter(row=>row.platformId===fact.platformId&&row.direction===fact.direction);for(const key of ['all_count','success_count']){const expected=sorting.knownNumber(fact[key]),counts=scope.map(row=>sorting.knownNumber(row[key]));if(expected===null||counts.some(n=>n===null)||expected>counts.reduce((sum,n)=>sum+(n||0),0))incomplete=true;}}
   const unknown=unidentified||incomplete;
   const value=names.size?names.size:unknown||!leaves.length?null:0,title='当前筛选范围内，代收与代付按统一三方去重；只计有创建或成功笔数的支付商。人工充值、人工确认、无三方、提现转充值等不计入。'+(!leaves.length?'尚未返回三方原始分组事实。':unknown?'另有未识别支付商或未完整返回三方分组，显示已识别小计。':'');
   const result={value,leaves,facts,names,unidentified,incomplete,unknown,title};usageCache.set(r,result);return result;
  }
  const prefix=[{label:provider?'三方':'平台',width:112,value:r=>provider?r.provider:r.platform},{label:provider?'来源':'系统',width:provider?72:56,value:sources,ascending:true},...(!provider?[{label:'使用三方',width:64,value:r=>providerUsage(r).value}]:[]),...(mixedCurrencies?[{label:'币种',width:64,value:r=>r.currency||null,ascending:true}]:[])];
  const getter=(r,d,key)=>{const row=rowFor(r,d);if(!row)return null;if(key==='success_rate')return sorting.fraction(row.success_count,row.all_count);if(key==='fee')return c.successTimeUnavailable?.(d)?null:sorting.knownNumber(row.estimated_fee);if(key==='fee_coverage')return c.successTimeUnavailable?.(d)?null:sorting.fraction(row.fee_matched_count,row.fee_eligible_count);if(key==='members')return r._providerDetail?null:memberFact(row,d)?.value??null;return sorting.knownNumber(row[key]);};
  const headings=[...prefix.map(column=>column.label),...merchantDirections.flatMap(d=>metrics.map(metric=>E(name(d)+metric.label))),...(provider?['订单明细']:[])],columns=[...prefix,...merchantDirections.flatMap(d=>metrics.map(metric=>({value:r=>getter(r,d,metric.key)}))),...(provider?[null]:[])];
  const totalsByCurrency=currencies.map(currency=>{
   const subset=rows.filter(r=>(r.currency||'')===currency),total={currency,directions:{},platform:'已读汇总',provider:'已读汇总',sources:[],platformIds:[...new Set(subset.flatMap(r=>r.platformIds||[r.platformId]).filter(Boolean))],_total:true};
   for(const d of merchantDirections){const facts=subset.map(r=>r.directions[d]).filter(Boolean);if(!facts.length)continue;const fees=scopedFeeSummary(facts,d),base={...successTotal(facts,d),direction:d,currency,estimated_fee:fees.amount,fee_complete:fees.complete,fee_eligible_count:fees.successCount,fee_matched_count:fees.matchedCount,fee_excluded_count:fees.excludedCount,fee_issues:fees.issues,fee_exclusions:fees.exclusions,fee_history_diagnostics:fees.historyDiagnostics,platformIds:total.platformIds};total.directions[d]=merchantFeeMode()==='current'?merchantModeFeeRow({...base,fee_items:facts}):base;}
   return total;
  });
  function merchantFeeCell(row){
   if(row.fee_rate_label==='不适用'||L.feeLookupLoading||L.feeLookupError)return feeCell(row);
   if(merchantFeeMode()==='current'){
    return '<span class="merchant-fee-value" tabindex="0" title="'+E(merchantFeeCoverage(row)+(row._referenceFeeLabel?' 当前参考费率：'+row._referenceFeeLabel:'') )+'">'+N(row.estimated_fee)+(row.estimated_fee!==null&&!row.fee_complete?'<span class="merchant-fee-status">部分</span>':'')+'</span>';
   }
   const label=sorting.feeHistoryLabel?.(row)||'历史费率未匹配',status=label==='部分'?'已匹配部分':['缺少生效时间','缺少生效时间列','继承费率缺少生效凭证'].includes(label)?'生效日期待确认（'+label+'）':label;
   return '<span class="merchant-fee-value" tabindex="0" title="'+E(sorting.feeCoverageText(row)+' '+status+(row._referenceFeeLabel?' 当前参考费率仅供核对：'+row._referenceFeeLabel:''))+'">'+N(row.estimated_fee)+(row.estimated_fee!==null&&!row.fee_complete&&Number(row.fee_eligible_count)>0?'<span class="merchant-fee-status">部分</span>':'')+'</span>';
  }
  function merchantFeeMatchCell(row){
   if(L.feeLookupLoading)return '<span class="muted">匹配中…</span>';
   if(L.feeLookupError)return '<span class="muted" title="'+E(L.feeLookupError)+'">读取失败</span>';
   const eligible=sorting.knownNumber(row.fee_eligible_count),matched=sorting.knownNumber(row.fee_matched_count),label=eligible>0&&matched!==null?R(matched,eligible):eligible===0&&row.fee_complete?'无需计费':'—';
   return '<span class="merchant-fee-match" tabindex="0" title="'+E(merchantFeeCoverage(row))+'" aria-label="'+E('应计费成功笔数的匹配占比 '+label)+'">'+E(label)+'</span>';
  }
  const canUsageDetail=()=>typeof window.hensemRoleAllowed!=='function'||window.hensemRoleAllowed('merchants','view')&&window.hensemRoleAllowed('merchants','detail');
  const detailRows=[...rows,...totalsByCurrency],queriedResults=L.results,scope=()=>JSON.stringify([L.from,L.to,L.country,L.currency,L.team,L.platform,L.source,L.provider,L.direction,L.status,L.multi]),queriedScope=scope(),queriedSerial=L.serial,queriedMode=merchantFeeMode();
  const nativeIdentity=r=>JSON.stringify([!!r._total,r.currency||'',r.platform||'',[...(r.platformIds||[])].sort()]);
  const currentDetailScope=()=>canUsageDetail()&&!L.dirty&&!L.loading&&L.results===queriedResults&&L.serial===queriedSerial&&scope()===queriedScope&&window.hensemCurrentAdminPage?.()==='merchants'&&L.view==='business';
  let expansion=merchantProviderExpansions.get(L);
  if(!currentDetailScope()||expansion&&(expansion.results!==queriedResults||expansion.serial!==queriedSerial||expansion.scope!==queriedScope)){merchantProviderExpansions.delete(L);expansion=null;}
  const inlineDetails=new Map(),cellRows=new WeakMap();
  if(!provider)window.liveMerchantFeeRefresh=function(){
   const active=merchantProviderExpansions.get(L);if(!active?.open.size)return;
   if(!currentDetailScope()||active.results!==queriedResults||active.serial!==queriedSerial||active.scope!==queriedScope||!document.querySelector('[data-merchant-provider-inline="'+active.marker+'"]')?.isConnected){merchantProviderExpansions.delete(L);return;}
   if(active.rates===L.feeLookupRows&&active.feeLoading===L.feeLookupLoading&&active.feeError===L.feeLookupError&&active.mode===merchantFeeMode())return;
   (c.render||window.render)();
  };
  if(!provider)window.liveMerchantProviderUsage=function(index){
   if(!currentDetailScope()||!Number.isInteger(index)||!detailRows[index]||merchantFeeMode()!==queriedMode)return;
   const active=merchantProviderExpansions.get(L)||{results:queriedResults,serial:queriedSerial,scope:queriedScope,open:new Set()},key=nativeIdentity(detailRows[index]);
   if(active.open.has(key))active.open.delete(key);else active.open.add(key);
   merchantProviderExpansions.set(L,active);(c.render||window.render)();
  };
  function providerInline(r){
   if(inlineDetails.has(r))return inlineDetails.get(r);
   const usage=providerUsage(r),pairs=new Map();
   const scopedRows=sorting.overviewDimensions({orders:usage.leaves,summaries:usage.facts,rates:L.feeLookupRows,country:L.country,key:'provider',plus,combine}).map(merchantModeFeeRow);
   for(const row of scopedRows){if(!usage.names.has(row.provider))continue;if(!pairs.has(row.provider))pairs.set(row.provider,{provider:row.provider,sources:[],directions:{}});const pair=pairs.get(row.provider);pair.directions[row.direction]=row;pair.sources=[...new Set([...pair.sources,...(row.sources||[row.source]).filter(Boolean)])];}
   // Current references remain readable when success-time facts are unknown.
   // Do not present a country fallback as the applied current reference when
   // the strict estimator rejects the native platform/category rule.
   const referenceFeeLabel=row=>{
    if(merchantFeeMode()==='current'){
     const reasons=new Set((row.fee_current_facts?.reasons||[]).map(x=>x.reason));
     if(reasons.has('unsupported_rate')||reasons.has('conflicting_rates'))return '费率待核对';
     if(reasons.has('missing_category_rate'))return '原始类型费率未匹配';
     if(reasons.has('missing_rate'))return '未匹配';
    }
    if(row.fee_reference_label)return row.fee_reference_label;
    const labels=new Set();
    for(const item of row.fee_items||row.items||[row]){
     const country=item.country||L.country,tier=sorting.tieredFeeRule(item,country),fact=sorting.estimateFacts(item,L.feeLookupRows,country),values=new Map(),payout=item.direction==='withdraw';
     if(fact.exemptOnly){labels.add('免手续费');continue;}
     if(tier){labels.add(tier.label);continue;}
     for(const record of sorting.feeCandidates(item,L.feeLookupRows,country)){const rule=sorting.parseFee(record[payout?'payoutFee':'collectFee'],record[payout?'payoutSingleFee':'collectSingleFee']);values.set(rule?JSON.stringify(rule):'unknown',rule);}
     if(values.size===1&&!values.has('unknown')){const rule=[...values.values()][0];labels.add((rule.percent*100).toFixed(2)+'%'+(rule.fixed?' + '+Number(rule.fixed.toFixed(8))+' / 笔':''));}
     else labels.add(values.size>1?'待核对费率':'未匹配');
    }
    return [...labels].sort().join(' / ')||'未匹配';
   };
   const volume=pair=>{const values=Object.values(pair.directions).map(row=>sorting.knownNumber(row.all_count));return values.some(value=>value===null)?null:values.reduce((sum,value)=>sum+value,0);};
   const details=[...pairs.values()].sort((a,b)=>{const av=volume(a),bv=volume(b);return av===null&&bv!==null?1:bv===null&&av!==null?-1:av!==null&&bv!==null&&av!==bv?bv-av:a.provider.localeCompare(b.provider);}).map(pair=>({...pair,platform:pair.provider,currency:r.currency,platformIds:r.platformIds,_providerDetail:true,directions:Object.fromEntries(Object.entries(pair.directions).map(([d,row])=>[d,{...row,_referenceFeeLabel:L.feeLookupLoading?'读取中…':L.feeLookupError?'读取失败':referenceFeeLabel(row)}]))}));
   const missingNotes=[usage.unidentified?'存在未识别支付商；未计入已识别三方数量。':'',usage.incomplete?'未完整返回三方分组事实；三方金额、笔数可能小于平台汇总。':''].filter(Boolean);
   const context=(r._total?'当前已读平台':r.platform)+' · '+C(usage.value)+(usage.unknown&&usage.value!==null?'*':'')+' 个已识别三方 · '+(r.currency||'币种未提供')+' · 按代收、代付全部提交笔数合计排序；金额、笔数分列。手续费：'+(merchantFeeMode()==='current'?'当前费率参考估算（不是历史实际手续费）':'历史生效费率；当前参考费率只供核对')+'。';
   const emptyNote=!details.length?(!usage.leaves.length?'尚未返回三方原始分组事实，暂不能列出支付商。':usage.unidentified?'当前只有未识别支付商，暂不能确认使用了哪些三方。':'当前已返回分组没有实际使用的支付商。'):'';
   const result={details,context,warning:missingNotes.length?(usage.value!==null?'* 表示已识别小计。':'三方数量待确认。')+missingNotes.join(' '):'',emptyNote};inlineDetails.set(r,result);return result;
  }
  if(!provider&&expansion?.open.size){for(const r of detailRows)if(expansion.open.has(nativeIdentity(r)))providerInline(r);Object.assign(expansion,{marker:++merchantInlineSerial,rates:L.feeLookupRows,feeLoading:L.feeLookupLoading,feeError:L.feeLookupError,mode:merchantFeeMode()});}
  function usageCell(r){const usage=providerUsage(r),label=C(usage.value)+(usage.unknown&&usage.value!==null?'*':'');if(!canUsageDetail())return '<span title="'+E(usage.title+'当前角色没有明细权限。')+'">'+label+'</span>';const index=detailRows.indexOf(r),expanded=!!expansion?.open.has(nativeIdentity(r));return '<button type="button" class="link merchant-provider-usage" title="'+E(usage.title+'点击展开或收起本平台三方的代收、代付金额、笔数与手续费。')+'" aria-label="'+E((r._total?'已读汇总':r.platform)+'使用三方明细')+'" aria-expanded="'+expanded+'" onclick="liveMerchantProviderUsage('+index+')">'+label+'</button>';}
  function metricCell(r,d,key){
   const row=rowFor(r,d);if(!row)return unavailable;
   if(key==='success_rate')return '<span title="成功时间内成功笔数 ÷ 创建时间内全部笔数；含跨日成功，可超过100%">'+R(row.success_count,row.all_count)+'</span>';
   if(key==='members')return r._providerDetail?'<span class="muted" title="平台会员按原会员去重，不按三方拆分">—</span>':memberFact(row,d)?.html||unavailable;
   if(key==='fee')return c.successTimeUnavailable?.(d)?unavailable:merchantFeeCell(row);
   if(key==='fee_coverage')return c.successTimeUnavailable?.(d)?unavailable:merchantFeeMatchCell(row);
   const value=key.endsWith('_count')?C(row[key]):N(row[key]),title=key.startsWith('failed_')?'失败独立统计；驳回金额 '+N(row.rejected_amount)+' / '+C(row.rejected_count)+' 笔；未知状态金额 '+N(row.unknown_amount)+' / '+C(row.unknown_count)+' 笔':'';
   return '<span data-business-direction="'+d+'" data-business-metric="'+key+'"'+(title?' title="'+E(title)+'"':'')+'>'+value+'</span>';
  }
  function providerDetail(r,d){if(!r.directions[d])return '';if(!/^[A-Z]{3,6}$/.test(r.currency||''))return '<span class="muted" title="币种未确认，暂不能读取对应订单">'+name(d)+'待确认</span>';return '<button class="link" title="'+E(r.provider)+' · '+name(d)+'订单号与归类依据" onclick="liveProviderOrders('+E(JSON.stringify(r.provider))+',&quot;&quot;,'+E(JSON.stringify(d))+',&quot;&quot;,'+E(JSON.stringify(r.currency))+')">'+name(d)+'</button>';}
  function cells(r){
   const referenceTitle=r._providerDetail?merchantDirections.map(d=>r.directions[d]?name(d)+'当前参考费率：'+r.directions[d]._referenceFeeLabel:'').filter(Boolean).join('；'):'';
   const first=r._total?'<strong title="'+E(r.currency||'币种未提供')+'">已读汇总'+(!mixedCurrencies&&r.currency?' · '+E(r.currency):'')+'</strong>':'<strong title="'+E((provider?r.provider:r.platform)+(referenceTitle?'；'+referenceTitle:''))+'">'+(r._providerDetail?'<span class="merchant-provider-indent" aria-hidden="true">↳</span>':'')+E(provider?r.provider:r.platform)+'</strong>';
   const result=[first,r._total?'—':'<span title="'+E(sources(r))+'">'+E(sources(r))+'</span>',...(!provider?[r._providerDetail?'<span class="muted">三方</span>':usageCell(r)]:[]),...(mixedCurrencies?[E(r.currency||'币种未提供')]:[]),...merchantDirections.flatMap(d=>metrics.map(metric=>metricCell(r,d,metric.key))),...(provider?[r._total?'—':merchantDirections.map(d=>providerDetail(r,d)).filter(Boolean).join(' / ')]:[])];cellRows.set(result,r);return result;
  }
  function renderTable(headers,body,footer){
   // Size numerical columns from every loaded row and its currency subtotal,
   // so compact cells retain the entire value even on a different table page.
   const widthRows=[...detailRows,...[...inlineDetails.values()].flatMap(value=>value.details)];
   const metricWidth=(d,metric)=>Math.max(metric.width,(name(d)+metric.label).length*8+12,...widthRows.map(r=>{const value=getter(r,d,metric.key),row=rowFor(r,d),partial=metric.key==='fee'&&row&&value!==null&&!row.fee_complete;if(value===null&&!partial)return metric.width;const label=metric.key.endsWith('_amount')||metric.key==='fee'?N(value):['success_rate','fee_coverage'].includes(metric.key)?R(value,1):C(value);return Math.ceil(String(label).length*6.2+(partial?26:0)+12);}));
   const widths=[...prefix.map(column=>column.width),...merchantDirections.flatMap(d=>metrics.map(metric=>metricWidth(d,metric))),...(provider?[88]:[])],width=widths.reduce((sum,value)=>sum+value,0),firstWidth=prefix[0].width,fixedCount=2;
   const fixed=(index,header=false)=>index<fixedCount?'position:sticky;left:'+(index===0?0:firstWidth)+'px;z-index:'+(header?4:2)+';background:'+(header?'#f5f7fd':'#fff')+';text-align:left;overflow:hidden;text-overflow:ellipsis;':'';
   const style=(index,header=false)=>fixed(index,header)+'vertical-align:middle;white-space:nowrap;'+(index>=fixedCount?'overflow:visible;text-overflow:clip;':'')+(header?'font-size:9px;padding:5px 4px;':'font-size:10px;padding:5px 4px;')+(index===prefix.length||index===prefix.length+metrics.length?'border-left:2px solid #d5def2;':'')+(header&&index>=prefix.length&&index<prefix.length+metrics.length*2?'background:'+(index<prefix.length+metrics.length?'#eff4ff':'#eef9f7')+';':'');
   const plainRow=(row,attributes='')=>'<tr'+attributes+'>'+row.map((cell,index)=>'<td style="'+style(index)+'">'+cell+'</td>').join('')+'</tr>';
   const htmlRows=list=>list.map(row=>{const native=cellRows.get(row),inline=!provider&&native&&!native._providerDetail&&expansion?.open.has(nativeIdentity(native))?providerInline(native):null;
    return plainRow(row)+(inline?'<tr class="merchant-provider-inline-note" data-merchant-provider-inline="'+expansion.marker+'"><td colspan="'+headers.length+'"><span>'+E(inline.context)+'</span>'+(inline.warning?'<span class="merchant-provider-warning">'+E(inline.warning)+'</span>':'')+(inline.emptyNote?'<span>'+E(inline.emptyNote)+'</span>':'')+'</td></tr>'+inline.details.map(child=>plainRow(cells(child),' class="merchant-provider-inline-row" data-merchant-provider-parent="'+E(nativeIdentity(native))+'"')).join(''):'');}).join('');
   return '<div class="table-wrap merchant-unified-table" style="overflow:auto" tabindex="0" role="region" aria-label="'+(provider?'三方':'平台')+'代收代付经营明细"><table style="table-layout:fixed;min-width:'+width+'px;width:'+width+'px;font-size:10px"><colgroup>'+widths.map(value=>'<col style="width:'+value+'px">').join('')+'</colgroup><thead><tr>'+headers.map((label,index)=>'<th scope="col" style="'+style(index,true)+'">'+label+'</th>').join('')+'</tr></thead><tbody>'+htmlRows(body)+'</tbody>'+(footer.length?'<tfoot>'+htmlRows(footer)+'</tfoot>':'')+'</table>'+(body.length?'':'<div class="live-empty">当前范围没有已入库经营记录</div>')+'</div>';
  }
  const currencyNote=mixedCurrencies?'按币种分别统计':currencies[0]?'币种 '+E(currencies[0]):'币种未提供';
  return merchantFeeControls()+box(provider?'该商户的三方经营表现':'商户经营清单',sortedPageTable(id,headings,rows,columns,cells,totalsByCurrency.map(cells),renderTable),currencyNote+' · 全部、处理中按创建时间，成功按成功时间；手续费口径：'+(merchantFeeMode()==='current'?'当前费率参考估算（非历史实际）':'历史生效费率'));
 }

 function business(page){const team=['teamops','teamcountries','teamplatforms'].includes(page),merchant=page==='merchants',legacy=page==='merchantproviders',dimension=page==='teamcountries'?'country':'platform';let items=team?[['business',page==='teamcountries'?'国家表现':page==='teamplatforms'?'平台经营':'经营明细'],['trend',page==='teamops'?'团队订单趋势 / 国家分布':'全部订单金额 / 国家 × 商户关联'],['providers','团队三方使用情况']]:merchant?[['business','商户经营清单'],['trend','商户订单趋势'],['providers','该商户的三方经营表现']]:legacy?[['business','该商户的三方经营表现']]:[['business','平台内三方表现'],['fees','平台内三方成本']];const nav=choose(items);const context='<div class="workspace-context"><div><strong>'+E(team?(L.team==='all'?'全部团队经营范围':L.team):L.platform==='all'?'全部商户（平台）':L.catalog.find(x=>x.id===L.platform)?.name||'商户')+'</strong><small>'+(team?'团队 → 国家 → 平台':'商户 = 平台；归属团队 → 国家 → 平台 → 三方订单')+'</small></div><button class="btn soft" onclick="setPage(\''+(team?'teams':'teamops')+'\')">'+(team?'团队平台配置':'团队经营')+' →</button></div>';
 let body=legacy?merchantBusiness(true):L.view==='providers'?(merchant?merchantBusiness(true):providersView()):L.view==='fees'?providerFees():L.view==='trend'?'<div class="grid equal">'+(merchant?merchantDirections:dirs()).map(d=>box(name(d)+'订单趋势',chart(groupRows('hourly').filter(r=>r.direction===d)))).join('')+(merchant?'':dimensions('country','国家分布','team-country'))+'</div>':merchant?merchantBusiness():dimensions(dimension,items[0][1],'business-dimension');return context+totals()+nav+body}
 function providerFees(){
  ensureTypes();const orders=groupRows('provider'),sources=[...new Set(orders.map(row=>row.source))];
  const rows=sources.flatMap(source=>dirs().flatMap(direction=>sorting.buildRows({orders:orders.filter(row=>row.source===source),issues:[],rates:L.feeLookupRows,country:L.country,direction,plus,combine,feeMode:feeMode()}).map(row=>({...row,source}))));
  const rateCell=row=>L.feeLookupLoading?'匹配中…':L.feeLookupError?'读取失败':E(feeMode()==='current'?row.fee_reference_label:row.fee_rate_label);
  const feeAmountSort={value:row=>L.feeLookupLoading||L.feeLookupError?null:sorting.knownNumber(row.estimated_fee)};
  return box('三方手续费汇总',sortedPageTable('provider-fees',['三方','类型','包网来源','方向','成功金额','成功笔数','估算手续费',feeMode()==='current'?'当前参考费率':'历史计费依据','实际手续费'],rows,[...providerSortPrefix(),numeric('success_amount'),numeric('success_count'),feeAmountSort,feeSort,null],row=>[E(row.provider),typeCell(row),E(row.source||'—'),name(row.direction),N(row.success_amount),C(row.success_count),feeCell(row),rateCell(row),unavailable]),feeBasis()+'；逐平台匹配后汇总，仅包含已匹配部分。实际手续费未提供时显示 —。')+box('费率变更历史',refTable(['三方','方向','版本','生效时间','失效时间','百分比费率','固定费'],[]),'历史生效版本尚未接入');
 }
 function providers(){const nav=choose([['business','经营总览'],['fees','费用与历史版本'],['cases','工单未到账'],['decision','加量评估']]);return totals()+nav+(L.view==='fees'?providerFees():L.view==='cases'?cases():L.view==='decision'?riskPage():providersView())}
 function flowPage(d){const nav=choose([['business','三方经营明细'],['trend',name(d)+'时段表现 / 订单状态分布'],['contribution','平台贡献 / 主力金额'],['checks','独立掉单与异常']]);let body=L.view==='trend'?box(name(d)+'时段表现',chart(groupRows('hourly').filter(r=>r.direction===d)))+box('订单状态分布',refTable(['状态','金额','笔数'],['success','pending','failed','rejected','unknown'].map(k=>[({success:'成功',pending:'处理中',failed:'失败',rejected:'拒绝',unknown:'未知'})[k],N(stat(d)[k+'_amount']),C(stat(d)[k+'_count'])]))):L.view==='contribution'?dimensions('platform','平台'+name(d)+'贡献','flow-platform')+c.overviewAmounts():L.view==='checks'?exceptions():providersView();return totals()+nav+body+latencyView(false)+(d==='withdraw'?latencyView(true):'')}
 function riskPage(){ensureTypes();const rows=combine(groupRows('provider'),['provider','source','direction']);return '<div class="risk-summary">'+[['高风险','需要减量或暂停'],['关注','建议调整分量'],['正常','可结合容量加量'],['数据不足','规则事实未接入']].map(([l,s])=>'<div class="risk-tile"><div>'+l+'<small>'+s+'</small></div><b>—</b></div>').join('')+'</div>'+box('三方风险矩阵',sortedPageTable('provider-risk',['三方','类型','包网来源','方向','建议','成功率','掉单率','待付金额','待付笔数','笔数份额','异常笔数','超期金额','超期笔数','当前参考费率','触发依据'],rows,[...providerSortPrefix(),null,ratio('success_count','all_count'),null,numeric('pending_amount'),numeric('pending_count'),{value:r=>sorting.fraction(r.all_count,stat(r.direction).all_count)},null,null,null,feeSort,null],r=>[E(r.provider),typeCell(r),E(r.source||'—'),name(r.direction),'待评估',(R(r.success_count,r.all_count)),unavailable,N(r.pending_amount),C(r.pending_count),R(r.all_count,stat(r.direction).all_count),unavailable,unavailable,unavailable,feeForRow(r),'正式风险规则未接入']),'待付为所选创建范围内仍待付；风险与核对指标保留待接入状态')}
 function orders(){const nav=choose([['business','业务明细'],['orderFees','费用依据'],['orderRates','费率版本']]);return totals()+nav+detailsView()}
 function daily(){
  ensureTypes();
  const direction=L.direction==='withdraw'?'withdraw':'charge',inScope=row=>row.direction===direction&&(!row.currency||row.currency===L.currency),all=combine(groupRows('daily').filter(inScope),['provider','source','date','direction','currency']),end=L.to.slice(0,10);
  if(!end)return totals();
  const days=Array.from({length:31},(_,i)=>new Date(Date.parse(end+'T00:00:00Z')-(30-i)*86400000).toISOString().slice(0,10)),metric=L.dailyMetric||'rate',labels={rate:'成功率',all_amount:'全部金额',all_count:'全部笔数',success_amount:'成功金额',success_count:'成功笔数'},entities=combine(groupRows('provider').filter(inScope),['provider','direction','source']);
  const rateMarkup=(row,value)=>{const success=row.success_count,total=row.all_count,valid=[success,total].every(value=>(typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value))),low=valid&&Number(total)>0&&Number(success)>=0&&Number(success)/Number(total)<.45;return '<span class="provider-daily-rate'+(low?' provider-daily-rate-low':'')+'">'+value+'</span>';};
  const pg=Math.max(1,Math.ceil(entities.length/L.localSize));L.localPage=Math.min(L.localPage,pg);
  const headers=['三方','类型','包网来源','方向',...days.map(day=>day.slice(5))],segment=(entity,day)=>({kind:'provider_daily',provider:entity.provider,source:entity.source||'',direction:entity.direction,date:day,currency:L.currency}),label=(entity,day)=>day+' · '+entity.provider+' · '+name(entity.direction);
  const sorted=sortTable('daily-matrix',headers,entities,[...providerSortPrefix(),...days.map(day=>({value:entity=>{const row=all.find(row=>row.provider===entity.provider&&row.source===entity.source&&row.direction===entity.direction&&row.date===day);return !row?null:metric==='rate'?sorting.fraction(row.success_count,row.all_count):sorting.knownNumber(row[metric])}}))]);
  const visible=sorted.rows.slice((L.localPage-1)*L.localSize,L.localPage*L.localSize),body=visible.map(entity=>{
   let expanded='';
   const cells=[E(entity.provider),typeCell(entity),E(entity.source),name(entity.direction),...days.map(day=>{
    const row=all.find(row=>row.provider===entity.provider&&row.source===entity.source&&row.direction===entity.direction&&row.date===day);
    if(!row)return '—';
    const current=segment(entity,day),value=metric==='rate'?R(row.success_count,row.all_count):metric.endsWith('count')?C(row[metric]):N(row[metric]);
    const title=label(entity,day)+'；全部金额 '+N(row.all_amount)+'；创建 '+C(row.all_count)+' 笔；按成功时间成功 '+C(row.success_count)+' 笔；点击展开各平台'+(metric==='rate'?'成功率':'明细');
    if(c.analysis?.valueButton){const button=c.analysis.valueButton(current,label(entity,day),value,title,'provider-daily');if(c.analysis.isOpen(current))expanded=c.analysis.panel(current,label(entity,day),rateMarkup);return metric==='rate'?rateMarkup(row,button):button;}
    const button='<button class="link" title="'+E(title)+'" onclick="liveReferenceDay(\''+day+'\')">'+value+'</button>';return metric==='rate'?rateMarkup(row,button):button;
   })];
   return '<tr>'+cells.map(value=>'<td>'+value+'</td>').join('')+'</tr>'+(expanded?'<tr class="analysis-expanded-row provider-daily-detail-row"><td colspan="'+headers.length+'">'+expanded+'</td></tr>':'');
  }).join('');
  const dayWidth=metric==='rate'?64:metric.endsWith('count')?78:124,matrixColumns=[['provider',100],['type',90],['source',72],['direction',46],...days.map(()=>['day',dayWidth])],matrixWidth=matrixColumns.reduce((sum,column)=>sum+column[1],0);
  const grid='<div class="live-table table-wrap pd-matrix-wrap live-daily-matrix"><table class="provider-daily-matrix-table" style="--provider-daily-table-width:'+matrixWidth+'px"><colgroup>'+matrixColumns.map(([key,width])=>'<col class="pd-col-'+key+'" style="width:'+width+'px">').join('')+'</colgroup><thead><tr>'+sorted.headers.map(value=>'<th>'+value+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>'+(visible.length?'':'<div class="live-empty">当前筛选范围没有已入库记录</div>')+'</div>';
  const control='<select class="btn small" aria-label="每日矩阵指标" onchange="liveReferenceSet(\'dailyMetric\',this.value)">'+Object.entries(labels).map(([key,value])=>'<option value="'+key+'" '+(key===metric?'selected':'')+'>'+value+'</option>').join('')+'</select>';
  const selected=L.dailyDay||end,details=all.filter(row=>L.dailyView==='all'||row.date===selected);
  return '<div class="provider-daily-v3"><div class="pd-toolbar">'+tab([['charge','代收'],['withdraw','代付']],'direction')+'<div class="pd-window"><label>31 天截至 <input type="date" value="'+end+'" onchange="liveReferenceEnd(this.value)"></label><button class="btn small" onclick="liveReferenceEnd(\''+end+'\')">最近 31 天</button></div></div>'+note('全部 / 处理中按各平台当地创建日期；成功按各平台当地成功日期 · '+L.from.slice(0,10)+' 至 '+end)+totals()+box('31 天 · 各三方'+labels[metric],grid+pager(entities.length,L.localPage,L.localSize,'local'),'点击日期单格，在该三方行下直接查看各平台成功率与金额、笔数；— 表示没有记录或没有创建笔数分母',control)+box((L.dailyView==='all'?'每日经营明细':selected+' · 当天经营明细'),sortedPageTable('daily-details',['日期','三方','类型','包网来源','方向','全部金额','全部笔数','成功金额','成功笔数','成功率'],details,[textual('date'),...providerSortPrefix(),...['all_amount','all_count','success_amount','success_count'].map(numeric),ratio('success_count','all_count')],row=>[E(row.date),E(row.provider),typeCell(row),E(row.source),name(row.direction),N(row.all_amount),C(row.all_count),N(row.success_amount),C(row.success_count),rateMarkup(row,R(row.success_count,row.all_count))]),'金额 '+E(L.currency),'<div class="tabs"><button class="'+(L.dailyView!=='all'?'on':'')+'" onclick="liveReferenceSet(\'dailyView\',\'selected\')">当天经营明细</button><button class="'+(L.dailyView==='all'?'on':'')+'" onclick="liveReferenceSet(\'dailyView\',\'all\')">每日明细</button></div>')+'</div>';
 }

 return {render(page){if(page==='overview')return dashboard();if(page==='time')return analytical('hourly');if(page==='amount')return analytical('amount');if(['teamops','teamcountries','teamplatforms','merchants','merchantproviders'].includes(page))return business(page);if(page==='providers')return providers();if(page==='collection'||page==='payout')return flowPage(page==='collection'?'charge':'withdraw');if(page==='risk')return riskPage();if(page==='orders')return orders();if(page==='provider_daily')return daily();return null}};
 }};
})();
