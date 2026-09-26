/* The approved v3 page structure, populated only from authorized aggregate results. */
(function(){
 'use strict';
 window.HensemLivePages={create:function(c){
 const {L,E,N,C,R,plus,combine,groupRows,empty,table,box,pager,totals,comparisonRows,compareMetric,chart,matrixBody,latencyView,detailsView,providersView,platformsView,pagedTable,feeForRow,ensureFeeLookup,providerCell}=c;
 const dirs=()=>L.direction==='all'?['charge','withdraw']:[L.direction];
 const name=d=>d==='charge'?'代收':'代付';
 const raw=()=>L.results.flatMap(x=>(x.summary||[]).map(r=>({...r,platform:x.platform?.name,platformId:x.platform?.id,source:x.platform?.source,country:x.platform?.country,team:x.platform?.team||'未绑定团队'})));
 const stat=d=>plus(raw().filter(r=>r.direction===d));
 const unavailable='<span class="muted" title="正式数据尚未提供此项">—</span>';
 const tab=(items,key='view')=>'<div class="section-switcher"><div class="tabs">'+items.map(([v,l])=>'<button class="'+(L[key]===v?'on':'')+'" onclick="liveReferenceSet(\''+key+'\',\''+v+'\')">'+l+'</button>').join('')+'</div></div>';
 const choose=(items,def='business')=>{if(!items.some(x=>x[0]===L.view))L.view=def;return tab(items)};
 const note=text=>'<div class="live-definition">'+text+'</div>';
 const dblock=(id,title,body,subtitle='',action='')=>'<section class="df-card" id="'+id+'"><header class="df-head"><div><h2>'+title+'</h2>'+(subtitle?'<small>'+subtitle+'</small>':'')+'</div>'+action+'</header>'+body+'</section>';
 const refTable=(headers,rows,footerRows=[])=>table(headers,rows,'table-wrap business-columns-v3',footerRows);
 function pageTable(id,headers,rows,footerRows=[],renderTable=refTable){L.tablePages=L.tablePages||{};L.tableSizes=L.tableSizes||{};const size=L.tableSizes[id]||20,page=Math.min(L.tablePages[id]||1,Math.max(1,Math.ceil(rows.length/size)));L.tablePages[id]=page;return renderTable(headers,rows.slice((page-1)*size,page*size),footerRows)+pager(rows.length,page,size,'ref-'+id)}
 const typeCell=r=>window.HensemProviderSummary.providerTypeCell(r,L.feeLookupRows,L.country,E,L);
 const ensureTypes=()=>{if(L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)ensureFeeLookup()};
 const share=ratio=>ratio==null?'—':R(ratio,1);
 const providerSummaryTable=(headers,rows,footerRows=[])=>{
  const columns=['provider','business-type','total-amount','total-count','success-amount','amount-share','success-count','count-share','success-rate','fee-rate','fee-amount','fee-share'];
  const renderRows=list=>list.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('');
  return '<div class="df-provider-table-scroll" tabindex="0" role="region" aria-label="三方经营明细，可横向滚动"><table class="df-provider-business-table"><colgroup>'+columns.map(key=>'<col class="'+key+'">').join('')+'</colgroup><thead><tr>'+headers.map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+renderRows(rows)+'</tbody>'+(footerRows.length?'<tfoot>'+renderRows(footerRows)+'</tfoot>':'')+'</table>'+(rows.length?'':'<div class="live-empty">当前方向没有已入库记录</div>')+'</div>';
 };
 function feeCell(r){
  if(r.fee_rate_label==='不适用')return '<span class="muted" title="人工及未分配三方记录不估算三方手续费">不适用</span>';
  if(L.feeLookupLoading)return '<span class="muted">匹配中…</span>';
  if(L.feeLookupError)return '<span class="muted" title="'+E(L.feeLookupError)+'">费率读取失败</span>';
  const label='已匹配 '+C(r.fee_matched_count)+' / '+C(r.fee_eligible_count)+' 笔';
  return '<span title="'+E(label)+'">'+N(r.estimated_fee)+(!r.fee_complete?'<small class="provider-partial">部分</small>':'')+'</span>';
 }
 function emptyPlatformCells(direction,columnCount){
  if(L.dirty)return [];
  const failed=new Set((L.queryFailures||[]).map(p=>p.id)),received=new Map((L.results||[]).map(r=>[r.platform?.id,r])),seen=new Set(),cells=[];
  for(const platform of L.queryPlatforms||[]){
   if(!platform.id||platform.reportOnly||failed.has(platform.id)||seen.has(platform.id))continue;seen.add(platform.id);
   const result=received.get(platform.id);if(!result||!Array.isArray(result.summary)||result.summary.some(row=>row.direction===direction))continue;
   if(!result.summary.length&&(result.total==null||!Number.isFinite(Number(result.total))||Number(result.total)!==0))continue;
   if(Object.values(result.groups||{}).some(rows=>Array.isArray(rows)&&rows.some(row=>row.direction===direction)))continue;
   const reason='本期未收到订单数据';cells.push([E(platform.name||result.platform?.name||'未提供')+'<small class="muted">'+reason+'</small>',...Array.from({length:columnCount-1},()=>'<span class="muted" title="'+reason+'">—</span>')]);
  }
  return cells;
 }
 function dimensions(key,title,id){
  const rows=window.HensemProviderSummary.overviewDimensions({orders:groupRows('provider'),summaries:raw(),rates:L.feeLookupRows,country:L.country,key,plus,combine}).sort((a,b)=>b.all_count-a.all_count),isProvider=key==='provider';
  const head=isProvider?['三方','类型','全部金额','全部笔数','成功金额','金额占比','成功笔数','笔数占比','成功率','手续费率','估算手续费','手续费占比']:[key==='team'?'团队':key==='country'?'国家':'平台','全部金额','全部笔数','成功金额','成功笔数','成功率','估算手续费'];
  const renderDirection=d=>{
   const subset=rows.filter(r=>r.direction===d),fees=window.HensemProviderSummary.feeSummary(subset),total={...plus(subset),direction:d,estimated_fee:fees.amount,fee_matched_count:fees.matchedCount,fee_eligible_count:fees.successCount,fee_complete:fees.complete};
   const rateCell=r=>{const value=r.fee_rate_label==='不适用'?'不适用':L.feeLookupLoading?'匹配中…':L.feeLookupError?'读取失败':r.fee_rate_label;return '<span class="df-fee-rate" title="'+E(value)+'">'+E(value)+'</span>'};
   const cells=(r,summary=false)=>[N(r.all_amount),C(r.all_count),N(r.success_amount),...(isProvider?[summary?(Number(total.success_amount)>0?'100.00%':'—'):share(r.success_amount_share)]:[]),C(r.success_count),...(isProvider?[summary?(Number(total.success_count)>0?'100.00%':'—'):share(r.success_count_share)]:[]),
    isProvider&&!summary&&!window.HensemProviderSummary.isProviderBusiness(r.provider)?'不适用':'<span title="成功时间内成功笔数 ÷ 创建时间内全部笔数；含跨日成功，可超过100%">'+R(r.success_count,r.all_count)+'</span>',
    ...(isProvider?[summary?'—':rateCell(r)]:[]),feeCell(r),...(isProvider?[L.feeLookupLoading||L.feeLookupError?'—':summary?(fees.amount>0?'100.00%':'—'):share(r.fee_share)]:[])];
   // Empty platform rows are display-only; totals and fee coverage use actual summaries above.
   const displayRows=subset.map(r=>[isProvider?providerCell({...r,source:''}):E(r[key]||'未提供'),...(isProvider?[typeCell(r)]:[]),...cells(r)]);
   if(key==='platform')displayRows.push(...emptyPlatformCells(d,head.length));
   const body=pageTable(id+'-'+d,head,displayRows,[['<strong>'+E(name(d)+'汇总')+'</strong>',...(isProvider?['—']:[]),...cells(total,true)]],isProvider?providerSummaryTable:refTable);
   const feeStatus=L.feeLookupLoading?'手续费匹配中…':L.feeLookupError?'费率读取失败':'手续费已匹配 '+C(fees.matchedCount)+' / '+C(fees.successCount)+' 笔'+(fees.complete?'':' · 部分费率未匹配');
   return dblock(id+'-'+d,title+' · '+name(d),'<div class="df-business-summary'+(isProvider?' df-provider-business-summary':'')+'">'+body+'</div>',E(L.currency)+' · '+(subset.length?feeStatus:'当前方向无数据'));

  };
  return dblock(id,title,'<div class="df-grid df-two">'+dirs().map(renderDirection).join('')+'</div>',(isProvider?'同名三方合并；占比按本方向成功数据；手续费占比按已匹配费用。人工不参与三方成功率比较。':'手续费逐平台、逐三方匹配后汇总。')+' 成功率＝成功时间内成功笔数 ÷ 创建时间内全部笔数，含跨日成功。');
 }
 function feeRows(direction){return window.HensemProviderSummary.buildRows({orders:groupRows('provider'),issues:[],rates:L.feeLookupRows,country:L.country,direction,plus,combine})}
 function providerExtremes(direction){
  // A zero-success ordinary withdrawal is not a provider comparison candidate; keep its ledger row.
  const zeroOrdinaryPayout=r=>direction==='withdraw'&&String(r.provider).trim()==='普通提现'&&r.success_amount!=null&&r.success_count!=null&&Number(r.success_amount)===0&&Number(r.success_count)===0;
  const list=combine(groupRows('provider').filter(r=>r.direction===direction),['provider','currency']).filter(r=>window.HensemProviderSummary.isProviderBusiness(r.provider)&&Number(r.all_count)>=1000&&!zeroOrdinaryPayout(r))
   .map(r=>({...r,rate:Number(r.success_count)/Number(r.all_count)})),byVolume=(a,b)=>b.all_count-a.all_count||b.success_count-a.success_count||String(a.provider).localeCompare(String(b.provider)),byRate=(a,b)=>b.rate-a.rate||b.success_count-a.success_count||byVolume(a,b);
  // Only the collection high-rate shortlist excludes ArbPay; ledger totals and payout keep it.
  const high=list.filter(r=>direction!=='charge'||String(r.provider).trim().toLowerCase()!=='arbpay').sort(byVolume).slice(0,10).sort(byRate).slice(0,3),chosen=new Set(high.map(r=>r.provider));
  const low=list.slice().sort(byVolume).slice(0,10).filter(r=>!chosen.has(r.provider)).sort((a,b)=>a.rate-b.rate||byVolume(a,b)).slice(0,3);
  const renderList=(rows,label,tone)=>'<div class="df-provider-rank '+tone+'"><b>主要三方 · '+label+'</b>'+(!rows.length?'<span class="muted">暂无符合笔数条件的三方</span>':'<div class="df-provider-rank-labels"><span>三方</span><span>成功金额</span><span>成功率</span><span>成功笔数</span></div>'+rows.map(r=>'<span class="df-provider-rank-item" title="成功金额、笔数按成功时间；成功率＝成功 '+C(r.success_count)+' / 创建 '+C(r.all_count)+' 笔，含跨日成功"><span>'+E(r.provider)+'</span><span class="df-rank-amount">'+N(r.success_amount)+'</span><strong>'+R(r.success_count,r.all_count)+'</strong><small>'+C(r.success_count)+'</small></span>').join(''))+'</div>';
  return '<div class="df-flow-provider-extremes" aria-label="'+name(direction)+'三方成功率比较">'+renderList(high,'成功率较高','high')+renderList(low,'成功率较低','low')+'</div>';
 }
 function flow(d){
  if(!L.loading&&L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)ensureFeeLookup();
  const a=stat(d),tone=d==='charge'?'collect':'payout',fees=window.HensemProviderSummary.feeSummary(feeRows(d));
  const metrics=[['all','全部','创建时间'],['success','成功','成功时间'],['pending','处理中','创建时间'],['failed','失败','创建时间']].map(([k,l,basis])=>'<div class="df-flow-metric"><span>'+l+'金额 / 笔数</span><strong class="metric-link">'+N(a[k+'_amount'])+'</strong><small class="cell-sub">'+C(a[k+'_count'])+' 笔</small><small class="cell-basis">按'+basis+'</small>'+compareMetric(k+'_amount',a,false,d)+'</div>').join('');
  const success='<div class="df-flow-metric df-flow-rate"><span>'+name(d)+'成功率 · 成功 / 创建</span><strong class="metric-link">'+R(a.success_count,a.all_count)+'</strong><small class="cell-sub" title="成功时间内成功笔数 ÷ 创建时间内全部笔数；两者日期口径不同，跨日成功可能使比值超过100%">本期成功 '+C(a.success_count)+' / 本期创建 '+C(a.all_count)+' 笔；含跨日成功</small>'+compareMetric('',a,true,d,'success')+'</div>';
  const feeNote=L.feeLookupError?'费率读取失败':L.feeLookupLoading?'正在匹配费率':fees.successCount?'已匹配 '+C(fees.matchedCount)+' / '+C(fees.successCount)+' 笔'+(fees.complete?'':' · 部分匹配'):fees.excludedCount?'人工业务不计三方手续费':'本期无成功订单';
  const states='<div class="df-state-tail">'+[['rejected','驳回'],['unknown','未知状态']].map(([k,l])=>'<span>'+l+'金额 <b>'+N(a[k+'_amount'])+'</b></span><span>'+l+'笔数 <b>'+C(a[k+'_count'])+'</b></span>').join('')+'</div>';
  return dblock('df-'+tone,name(d)+'经营总数据','<div class="df-flow-grid">'+metrics+success+providerExtremes(d)+'</div><div class="df-flow-foot"><div class="df-flow-fee"><span>估算手续费</span><strong>'+N(fees.amount)+'</strong><small class="df-coverage">'+E(feeNote)+' · 按当前费率估算</small>'+states+'</div>'+workorderRanks(d)+'</div>','', '<span class="df-direction '+tone+'">'+(d==='charge'?'↙ 代收':'↗ 代付')+'</span>');
 }
 function workorderRanks(direction){
  const label=direction==='charge'?'存款':'取款',wrapper=body=>'<div class="df-workorder-ranks" data-live-overview-workorders aria-label="'+label+'工单三方排名">'+body+'</div>';
  if(!L.workorders){const message=L.workordersError?'工单读取未完成':L.workordersLoading?'正在读取工单排名…':'工单排名将在经营数据后读取';return wrapper('<div class="df-workorder-rank-status">'+E(message)+(L.workordersError?' <button class="link" onclick="liveOverviewWorkorders()">重试</button>':'')+'</div>')}
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
 function waiting(){const p=stat('withdraw'),g=L.results.flatMap(x=>x.groups?.pending_age_thresholds||[]).filter(r=>r.direction==='withdraw'&&Number(r.threshold_ms)===86400000);const lateAmount=g.some(r=>r.amount===null)?null:g.reduce((n,r)=>n+Number(r.amount||0),0),lateCount=g.reduce((n,r)=>n+Number(r.count||0),0);return dblock('df-backlog','当前代付中与等待','<div class="pending-dash-grid">'+[['代付中金额',N(p.pending_amount)],['代付中笔数',C(p.pending_count)],['超过 1 天金额',L.loadedView==='providers'?'打开等待分析查看':N(lateAmount)],['超过 1 天笔数',L.loadedView==='providers'?'—':C(lateCount)]].map(([l,v])=>'<div class="pending-metric"><span>'+l+'</span><strong>'+v+'</strong></div>').join('')+'</div>','所选创建日期内仍待付 · 不含窗口外历史积压','<button class="link" onclick="setPage(\'stuck\')">等待分析 →</button>')}
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
  const workorderStatus=L.workordersLoading?'正在读取工单汇总…':L.workordersError?'工单读取失败：'+E(L.workordersError):'滚动到这里会自动读取并展示工单汇总。';
  const workorders='<div data-live-overview-workorders>'+(L.workorders?cases():dblock('df-workorders','工单未到账','<div class="df-analysis-status"><span>'+workorderStatus+'</span><button class="btn small" '+(L.loading||L.workordersLoading?'disabled':'')+' onclick="liveOverviewWorkorders()">'+(L.workordersLoading?'读取中…':L.workordersError?'重试工单读取':'加载工单汇总')+'</button></div>'))+'</div>';
  const amounts=full?'<div data-live-overview-analysis>'+analysisStatus()+renderAnalysis(()=>'<div id="df-amounts">'+c.overviewAmounts()+'</div>'+dirs().map(d=>dblock('df-hour-'+d,'24 小时 × 金额区间 · '+name(d),matrixBody(d),'00–23 时 · 全部笔数、全部金额与成功率','<button class="link" onclick="setPage(\'matrix\')">完整交叉分析 →</button>')).join(''))+'</div>':deferred('df-amounts','金额档位与交叉');
  const duration=full?'<div id="df-duration" data-live-overview-analysis>'+analysisStatus()+renderAnalysis(()=>latencyView(false)+latencyView(true))+'</div>':deferred('df-duration','到账时效');
  return '<div class="dashboard-full-v3"><div class="df-grid df-two">'+dirs().map(flow).join('')+'</div><div class="df-grid df-three">'+waiting()+risk()+exceptions()+'</div>'+trends+dimensions('team','团队经营汇总','df-teams')+dimensions('country','国家经营汇总','df-countries')+dimensions('platform','平台经营汇总','df-platforms')+dimensions('provider','三方经营汇总','df-providers')+amounts+workorders+duration+'</div>';
 }
 function groupedData(kind){
  const field=kind==='hourly'?'hour':'bucket',normalized=groupRows(kind).map(row=>({...row,[field]:field==='hour'&&row.hour!==null&&String(row.hour).trim()!==''&&Number.isInteger(Number(row.hour))?Number(row.hour):String(row[field]??'unknown')}));
  const rows=combine(normalized,['direction',field]),keys=kind==='hourly'?Array.from({length:24},(_,h)=>h):kind==='amount_range'?['100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001']:['100','200','300','400','500','750','1000','1500','2000','5000'];
  return dirs().flatMap(direction=>[...keys,...[...new Set(rows.filter(r=>r.direction===direction).map(r=>r[field]))].filter(k=>!keys.includes(k))].map(k=>({...empty(),direction,[field]:k,...rows.find(r=>r.direction===direction&&r[field]===k)})));
 }
 function analytical(kind){
  const time=kind==='hourly',groupKind=time?'hourly':L.matrixMode==='range'?'amount_range':'amount',first=time?'时段':'金额档位 · '+E(L.currency),items=time?[['business','时段金额与状态'],['checks','时段费用与核对'],['trend','24 小时订单趋势']]:[['business','金额分布与订单状态'],['checks','金额档位费用与核对'],['trend','全部订单金额结构']],nav=choose(items),rows=groupedData(groupKind),label=r=>time?String(r.hour).padStart(2,'0')+':00–'+String(r.hour).padStart(2,'0')+':59:59':r.bucket==='other'?'其他金额':r.bucket==='unknown'?'金额缺失':String(r.bucket);
  let body='';const tools=time?'':'<div class="tabs"><button class="'+(L.matrixMode!=='range'?'on':'')+'" onclick="liveMatrixMode(\'exact\')">精确金额</button><button class="'+(L.matrixMode==='range'?'on':'')+'" onclick="liveMatrixMode(\'range\')">金额区间</button></div>';
  if(L.view==='business'){
   const id='analysis-state',headers=['方向',first,...c.businessHeaders],cells=r=>[name(r.direction),E(label(r)),...c.businessCells(r)];
   let bodyTable;
   if(c.analysis?.table){
    L.tablePages=L.tablePages||{};L.tableSizes=L.tableSizes||{};const size=L.tableSizes[id]||20,page=Math.min(L.tablePages[id]||1,Math.max(1,Math.ceil(rows.length/size)));L.tablePages[id]=page;
    bodyTable=c.analysis.table({id,headers,rows:rows.slice((page-1)*size,page*size),cells,segment:r=>({kind:groupKind,direction:r.direction,...(time?{hour:Number(r.hour)}:{bucket:String(r.bucket)})}),label})+pager(rows.length,page,size,'ref-'+id);
   }else bodyTable=pageTable(id,headers,rows.map(cells));
   body=box(items[0][1],bodyTable,(time?'每小时 · 各平台当地时间':'金额 '+E(L.currency))+'；全部按创建时间，成功按成功时间；展开查看各平台占比'+(String(L.from||'').slice(0,10)!==String(L.to||'').slice(0,10)?'与每日对比':''),tools);
  }
  if(L.view==='checks')body=box(items[1][1],pageTable('analysis-checks',['方向',first,'估算手续费','掉单金额','掉单笔数','掉单占比','异常金额','异常笔数','异常占比'],rows.map(r=>[name(r.direction),E(label(r)),...Array(7).fill(unavailable)])),'掉单、异常独立统计 · 正式核对标记未接入');
  if(L.view==='trend')body=dirs().map(d=>box(name(d)+' · '+items[2][1],time?chart(rows.filter(r=>r.direction===d)):bars(rows.filter(r=>r.direction===d).map(r=>({name:E(label(r)),value:r.all_amount}))))).join('');
  return '<div class="analysis-compact">'+totals()+nav+body+'</div>';
 }
 function bars(rows){const max=Math.max(1,...rows.map(r=>Number(r.value)||0));return '<div class="panel-body">'+rows.map(r=>'<div class="live-reference-bar"><span>'+r.name+'</span><div><i style="width:'+Math.max(0,(Number(r.value)||0)/max*100)+'%"></i></div><b>'+N(r.value)+'</b></div>').join('')+'</div>'}
 function business(page){const team=['teamops','teamcountries','teamplatforms'].includes(page),merchant=page==='merchants',dimension=page==='teamcountries'?'country':'platform';let items=team?[['business',page==='teamcountries'?'国家表现':'平台经营'],['trend',page==='teamops'?'团队订单趋势 / 国家分布':'全部订单金额 / 国家 × 商户关联'],['providers','团队三方使用情况']]:merchant?[['business','商户经营清单'],['trend','商户订单趋势 / 商户状态分布'],['providers','该商户的三方经营表现']]:[['business','平台内三方表现'],['fees','平台内三方成本']];const nav=choose(items);const context='<div class="workspace-context"><div><strong>'+E(team?(L.team==='all'?'全部团队经营范围':L.team):L.platform==='all'?'全部商户（平台）':L.catalog.find(x=>x.id===L.platform)?.name||'商户')+'</strong><small>'+(team?'团队 → 国家 → 平台':'商户 = 平台；归属团队 → 国家 → 平台 → 三方订单')+'</small></div><button class="btn soft" onclick="setPage(\''+(team?'teams':'teamops')+'\')">'+(team?'团队平台配置':'所属团队')+' →</button></div>';
 let body=L.view==='providers'?providersView():L.view==='fees'?providerFees():L.view==='trend'?'<div class="grid equal">'+dirs().map(d=>box(name(d)+'订单趋势',chart(groupRows('hourly').filter(r=>r.direction===d)))).join('')+dimensions('country','国家分布','team-country')+'</div>':page==='merchantproviders'?providersView():dimensions(dimension,items[0][1],'business-dimension');return context+totals()+nav+body}
 function providerFees(){ensureTypes();const rows=combine(groupRows('provider'),['provider','source','direction']);if(L.feeLookupRows===null&&!L.feeLookupLoading)ensureFeeLookup();return pagedTable(['三方','类型','包网来源','方向','成功金额','成功笔数','估算手续费','有效费率','实际手续费'],rows.map(r=>[E(r.provider),typeCell(r),E(r.source||'—'),name(r.direction),N(r.success_amount),C(r.success_count),feeForRow(r),feeForRow(r),unavailable]),'三方手续费汇总','按当前国家与平台专属费率优先匹配；复杂阶梯或无对应记录显示“多档费率 / 未匹配”，不把费率误算成订单费用')+box('费率变更历史',refTable(['三方','方向','版本','生效时间','失效时间','百分比费率','固定费'],[]),'历史生效版本尚未接入')}
 function providers(){const nav=choose([['business','经营总览'],['fees','费用与历史版本'],['cases','工单未到账'],['decision','加量评估']]);return totals()+nav+(L.view==='fees'?providerFees():L.view==='cases'?cases():L.view==='decision'?riskPage():providersView())}
 function flowPage(d){const nav=choose([['business','三方经营明细'],['trend',name(d)+'时段表现 / 订单状态分布'],['contribution','平台贡献 / 主力金额'],['checks','独立掉单与异常']]);let body=L.view==='trend'?box(name(d)+'时段表现',chart(groupRows('hourly').filter(r=>r.direction===d)))+box('订单状态分布',refTable(['状态','金额','笔数'],['success','pending','failed','rejected','unknown'].map(k=>[({success:'成功',pending:'处理中',failed:'失败',rejected:'拒绝',unknown:'未知'})[k],N(stat(d)[k+'_amount']),C(stat(d)[k+'_count'])]))):L.view==='contribution'?dimensions('platform','平台'+name(d)+'贡献','flow-platform')+c.overviewAmounts():L.view==='checks'?exceptions():providersView();return totals()+nav+body+latencyView(false)+(d==='withdraw'?latencyView(true):'')}
 function quality(){ensureTypes();const nav=choose([['business','三方稳定性与处理表现'],['distribution','三方全部订单分布 / 已知与待接入']]);const rows=combine(groupRows('provider'),['provider','source','direction']);return totals()+nav+(L.view==='distribution'?dirs().map(d=>box(name(d)+' · 三方全部订单分布',bars(rows.filter(r=>r.direction===d).map(r=>({name:E(r.provider)+' · '+E(r.source),value:r.all_count}))))).join(''):pagedTable(['三方','类型','包网来源','方向','全部金额','全部笔数','成功率','成功完成 P95','掉单金额','掉单笔数','异常金额','异常笔数','笔数份额','估算手续费'],rows.map(r=>[E(r.provider),typeCell(r),E(r.source||'—'),name(r.direction),N(r.all_amount),C(r.all_count),(R(r.success_count,r.all_count)),...Array(5).fill(unavailable),R(r.all_count,stat(r.direction).all_count),feeForRow(r)]),'三方稳定性与处理表现','P95 与核对标记未接入，保留独立列'))}
 function riskPage(){ensureTypes();const rows=combine(groupRows('provider'),['provider','source','direction']);return '<div class="risk-summary">'+[['高风险','需要减量或暂停'],['关注','建议调整分量'],['正常','可结合容量加量'],['数据不足','规则事实未接入']].map(([l,s])=>'<div class="risk-tile"><div>'+l+'<small>'+s+'</small></div><b>—</b></div>').join('')+'</div>'+pagedTable(['三方','类型','包网来源','方向','建议','成功率','掉单率','待付金额','待付笔数','笔数份额','异常笔数','超期金额','超期笔数','估算手续费','触发依据'],rows.map(r=>[E(r.provider),typeCell(r),E(r.source||'—'),name(r.direction),'待评估',(R(r.success_count,r.all_count)),unavailable,N(r.pending_amount),C(r.pending_count),R(r.all_count,stat(r.direction).all_count),unavailable,unavailable,unavailable,feeForRow(r),'正式风险规则未接入']),'三方风险矩阵','待付为所选创建范围内仍待付；风险与核对指标保留待接入状态')}
 function orders(){const nav=choose([['business','业务明细'],['orderFees','费用依据'],['orderRates','费率版本']]);return totals()+nav+detailsView()}
 function daily(){
  ensureTypes();
  const direction=L.direction==='withdraw'?'withdraw':'charge',inScope=row=>row.direction===direction&&(!row.currency||row.currency===L.currency),all=combine(groupRows('daily').filter(inScope),['provider','source','date','direction','currency']),end=L.to.slice(0,10);
  if(!end)return totals();
  const days=Array.from({length:31},(_,i)=>new Date(Date.parse(end+'T00:00:00Z')-(30-i)*86400000).toISOString().slice(0,10)),metric=L.dailyMetric||'rate',labels={rate:'成功率',all_amount:'全部金额',all_count:'全部笔数',success_amount:'成功金额',success_count:'成功笔数'},entities=combine(groupRows('provider').filter(inScope),['provider','direction','source']);
  const pg=Math.max(1,Math.ceil(entities.length/L.localSize));L.localPage=Math.min(L.localPage,pg);
  const headers=['三方','类型','包网来源','方向',...days.map(day=>day.slice(5))],segment=(entity,day)=>({kind:'provider_daily',provider:entity.provider,source:entity.source||'',direction:entity.direction,date:day,currency:L.currency}),label=(entity,day)=>day+' · '+entity.provider+' · '+name(entity.direction);
  const visible=entities.slice((L.localPage-1)*L.localSize,L.localPage*L.localSize),body=visible.map(entity=>{
   let expanded='';
   const cells=[E(entity.provider),typeCell(entity),E(entity.source),name(entity.direction),...days.map(day=>{
    const row=all.find(row=>row.provider===entity.provider&&row.source===entity.source&&row.direction===entity.direction&&row.date===day);
    if(!row)return '—';
    const current=segment(entity,day),value=metric==='rate'?R(row.success_count,row.all_count):metric.endsWith('count')?C(row[metric]):N(row[metric]);
    const title=label(entity,day)+'；全部金额 '+N(row.all_amount)+'；创建 '+C(row.all_count)+' 笔；按成功时间成功 '+C(row.success_count)+' 笔；点击展开各平台'+(metric==='rate'?'成功率':'明细');
    if(c.analysis?.valueButton){const button=c.analysis.valueButton(current,label(entity,day),value,title,'provider-daily');if(c.analysis.isOpen(current))expanded=c.analysis.panel(current,label(entity,day));return button;}
    return '<button class="link" title="'+E(title)+'" onclick="liveReferenceDay(\''+day+'\')">'+value+'</button>';
   })];
   return '<tr>'+cells.map(value=>'<td>'+value+'</td>').join('')+'</tr>'+(expanded?'<tr class="analysis-expanded-row provider-daily-detail-row"><td colspan="'+headers.length+'">'+expanded+'</td></tr>':'');
  }).join('');
  const grid='<div class="live-table table-wrap pd-matrix-wrap live-daily-matrix"><table><thead><tr>'+headers.map(value=>'<th>'+value+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>'+(visible.length?'':'<div class="live-empty">当前筛选范围没有已入库记录</div>')+'</div>';
  const control='<select class="btn small" aria-label="每日矩阵指标" onchange="liveReferenceSet(\'dailyMetric\',this.value)">'+Object.entries(labels).map(([key,value])=>'<option value="'+key+'" '+(key===metric?'selected':'')+'>'+value+'</option>').join('')+'</select>';
  const selected=L.dailyDay||end,details=all.filter(row=>L.dailyView==='all'||row.date===selected);
  return '<div class="provider-daily-v3"><div class="pd-toolbar">'+tab([['charge','代收'],['withdraw','代付']],'direction')+'<div class="pd-window"><label>31 天截至 <input type="date" value="'+end+'" onchange="liveReferenceEnd(this.value)"></label><button class="btn small" onclick="liveReferenceEnd(\''+end+'\')">最近 31 天</button></div></div>'+note('全部 / 处理中按各平台当地创建日期；成功按各平台当地成功日期 · '+L.from.slice(0,10)+' 至 '+end)+totals()+box('31 天 · 各三方'+labels[metric],grid+pager(entities.length,L.localPage,L.localSize,'local'),'点击日期单格，在该三方行下直接查看各平台成功率与金额、笔数；— 表示没有记录或没有创建笔数分母',control)+box((L.dailyView==='all'?'每日经营明细':selected+' · 当天经营明细'),pageTable('daily-details',['日期','三方','类型','包网来源','方向','全部金额','全部笔数','成功金额','成功笔数','成功率'],details.map(row=>[E(row.date),E(row.provider),typeCell(row),E(row.source),name(row.direction),N(row.all_amount),C(row.all_count),N(row.success_amount),C(row.success_count),R(row.success_count,row.all_count)])),'金额 '+E(L.currency),'<div class="tabs"><button class="'+(L.dailyView!=='all'?'on':'')+'" onclick="liveReferenceSet(\'dailyView\',\'selected\')">当天经营明细</button><button class="'+(L.dailyView==='all'?'on':'')+'" onclick="liveReferenceSet(\'dailyView\',\'all\')">每日明细</button></div>')+'</div>';
 }

 return {render(page){if(page==='overview')return dashboard();if(page==='time')return analytical('hourly');if(page==='amount')return analytical('amount');if(['teamops','teamcountries','teamplatforms','merchants','merchantproviders'].includes(page))return business(page);if(page==='providers')return providers();if(page==='collection'||page==='payout')return flowPage(page==='collection'?'charge':'withdraw');if(page==='channelquality')return quality();if(page==='risk')return riskPage();if(page==='orders')return orders();if(page==='provider_daily')return daily();return null}};
 }};
})();
