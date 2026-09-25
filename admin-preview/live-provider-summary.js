(function(root){
 'use strict';
 const normalized=v=>String(v??'').trim().toLowerCase().replace(/[\s._()（）-]+/g,'');
 const canonical=(value,country)=>root.HensemProviderNames?.canonical(value,country)??String(value??'');
 const providerName=value=>!value||['未识别三方','未提供'].includes(value)?'未识别通道':value;
 const issueKeys=['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount'];
 function parseFee(percent,single){
  const rate=String(percent??'').trim(),fixed=String(single??'').trim();let p=0,f=0;
  if(!rate&&!fixed)return null;
  if(rate){if(/^\d+(?:\.\d+)?\s*%$/.test(rate))p=parseFloat(rate)/100;
   else if(/^\d+(?:\.\d+)?\s*\/\s*笔$/.test(rate))f=parseFloat(rate);else return null;}
  if(fixed){if(/^0(?:\.0+)?%?$/.test(fixed)){}else if(/^\d+(?:\.\d+)?(?:\s*\/\s*笔)?$/.test(fixed))f+=parseFloat(fixed);else return null;}
  return {percent:p,fixed:f};
 }
 function estimate(row,rates,country){
  const payout=row.direction==='withdraw',feeKey=payout?'payoutFee':'collectFee',singleKey=payout?'payoutSingleFee':'collectSingleFee';
  let candidates=(rates||[]).filter(r=>normalized(canonical(r.provider,country))===normalized(canonical(row.provider,country))
   &&(normalized(r.country)===normalized(country)||normalized(r.scopeGroup)===normalized(country)));
  const specific=candidates.filter(r=>r.scopeType==='platform'&&normalized(r.platform)===normalized(row.platform));
  candidates=specific.length?specific:candidates.filter(r=>r.scopeType!=='platform');
  const unique=new Map();for(const r of candidates){const value=parseFee(r[feeKey],r[singleKey]);if(!value)return null;unique.set(JSON.stringify(value),value)}
  if(unique.size!==1||row.success_amount==null||!Number.isFinite(Number(row.success_amount)))return null;
  const value=[...unique.values()][0];return Number(row.success_amount)*value.percent+Number(row.success_count||0)*value.fixed;
 }
 function buildRows({orders,issues,rates,country,direction,plus,combine,coverage}){
  const flow=(orders||[]).filter(r=>r.direction===direction).map(r=>({...r,provider:providerName(canonical(r.provider,country))}));
  const byIssue=new Map();for(const row of issues||[]){if(row.direction!==direction)continue;const name=providerName(canonical(row.provider,country)),item=byIssue.get(name)||Object.fromEntries(issueKeys.map(k=>[k,0]));for(const key of issueKeys)item[key]+=Number(row[key]||0);byIssue.set(name,item)}
  const rows=combine(flow,['provider','currency']).map(row=>({...row,direction,sources:[...new Set(row.items.map(r=>r.source))],platforms:[...new Set(row.items.map(r=>r.platform))]}));
  for(const [provider] of byIssue)if(!rows.some(row=>row.provider===provider))rows.push({...plus([]),provider,direction,sources:[],platforms:[],items:[],created_success_count:0});
  for(const row of rows){
   const observed=(coverage?.platforms||[]).filter(p=>row.platforms.includes(p.platform)||row.platforms.includes(p.sourcePlatform));
   row.issues=issues==null||coverage?.capturedPlatformDays===0||(!byIssue.has(row.provider)&&observed.length&&observed.every(p=>p.days===0))?null:byIssue.get(row.provider)||Object.fromEntries(issueKeys.map(k=>[k,0]));
   let known=0,fee=0;for(const item of row.items){const value=estimate(item,rates,country);if(value!==null){known+=Number(item.success_count||0);fee+=value}}
   row.estimated_fee=known>0?fee:row.success_count===0?0:null;row.fee_matched_count=known;
   row.fee_complete=known===Number(row.success_count||0);
  }
  return rows;
 }
 function feeSummary(rows){
  const total=(rows||[]).reduce((s,r)=>{s.successCount+=Number(r.success_count||0);s.matchedCount+=Number(r.fee_matched_count||0);if(r.estimated_fee!=null)s.amount+=Number(r.estimated_fee);return s},{amount:0,matchedCount:0,successCount:0});
  total.complete=total.matchedCount===total.successCount;if(!total.matchedCount&&total.successCount)total.amount=null;
  if(new Set((rows||[]).map(r=>r.currency).filter(Boolean)).size>1){total.amount=null;total.complete=false}
  return total;
 }
 function comparisonScope(L){
  if(L.comparisonStatus==='loading')return '昨日数据读取中…';
  if(L.comparisonStatus!=='ready')return L.comparisonError||'昨日数据尚未读取';
  const scope=results=>(results||[]).map(r=>[r.platform?.id,r.platform?.country,r.platform?.currency,r.platform?.timezone].join('|')).sort();
  const current=scope(L.results),previous=scope(L.comparisonResults);
  if(!current.length||current.length!==previous.length||current.some((id,i)=>id!==previous[i])
   ||L.comparisonResults.some(r=>!r.platform?.id||!Array.isArray(r.groups?.provider)))return '两日平台范围不完整，暂不可比';
  return '';
 }
 function renderMetrics(ctx,direction,currentRows){
  const {L,E,N,C,R,plus,combine}=ctx,name=direction==='charge'?'代收':'代付';
  const previousOrders=(L.comparisonResults||[]).flatMap(x=>(x.groups?.provider||[]).map(r=>({...r,platformId:x.platform?.id,platform:x.platform?.name,source:x.platform?.source})));
  const previousRows=buildRows({orders:previousOrders,issues:null,rates:L.feeLookupRows,country:L.country,direction,plus,combine});
  const snapshot=rows=>({total:plus(rows),fees:feeSummary(rows),providers:new Set(rows.filter(r=>r.items?.length&&!['未识别通道','无三方（驳回）','未标记三方','人工确认','人工充值'].includes(r.provider)).map(r=>r.provider)).size,
   platforms:new Set(rows.flatMap(r=>r.items||[]).map(r=>r.platformId).filter(Boolean)).size});
  const current=snapshot(currentRows),previous=snapshot(previousRows),unavailable=comparisonScope(L);
  const range=root.HensemLiveCompare.windowFor(L.from,L.to,L.results?.[0]?.platform?.timezone,L.queryNow);
  const caption=(L.comparisonLabel||'较前一日同一时段').replace('较前一日同一时段','较昨日同期');
  const priorLabel=range.calendarDays>1?'前期':'昨日',signed=(value,format)=>(value>0?'+':value<0?'−':'')+format(Math.abs(value));
  const changes=(now,before,format,isRate=false,reason='')=>{
   const error=reason||unavailable;if(error)return '<small class="provider-kpi-unavailable" title="'+E(error)+'">'+E(error.length>22?'对比暂不可用 · '+error.slice(0,19)+'…':error)+'</small>';
   if(isRate){const d=root.HensemLiveCompare.rateDelta(current.total.created_success_count,current.total.all_count,previous.total.created_success_count,previous.total.all_count);
    return '<small>'+priorLabel+' '+(previous.total.created_success_count==null?'—':R(previous.total.created_success_count,previous.total.all_count))+'</small><span class="provider-kpi-change '+E(d.trend)+'">'+E(caption)+' '+E(d.value===null?'暂无可比成功率':d.display)+'</span>'}
   if(now==null||before==null||!Number.isFinite(Number(now))||!Number.isFinite(Number(before)))return '<small class="provider-kpi-unavailable">金额口径不完整，暂不可比</small>';
   const d=root.HensemLiveCompare.delta(now,before);
   return '<small>'+priorLabel+' '+format(before)+'</small><span class="provider-kpi-change '+E(d.trend)+'">'+E(caption)+' '+signed(Number(now)-Number(before),format)+' <em>'+E(d.display)+'</em></span>';
  };
  const fees=current.fees,feeReason=L.feeLookupLoading?'费率读取中…':L.feeLookupError?'费率读取失败，暂不可比':!fees.complete||!previous.fees.complete?'费率未完全匹配，暂不比较':'';
  const cards=[
   {label:'统一三方',value:C(current.providers),change:changes(current.providers,previous.providers,C),tone:'neutral'},
   {label:'平台',value:C(current.platforms),change:changes(current.platforms,previous.platforms,C),tone:'neutral'},
   {label:name+'成功金额',value:N(current.total.success_amount),change:changes(current.total.success_amount,previous.total.success_amount,N),tone:'amount'},
   {label:name+'成功笔数',value:C(current.total.success_count),change:changes(current.total.success_count,previous.total.success_count,C),tone:'amount'},
   {label:name+'成功率',value:current.total.created_success_count==null?'—':R(current.total.created_success_count,current.total.all_count),change:changes(null,null,null,true),tone:'rate'},
   {label:'估算手续费',value:N(fees.amount)+(!fees.complete?'<span class="provider-partial">部分</span>':''),change:changes(fees.amount,previous.fees.amount,N,false,feeReason),tone:'fee'}
  ];
  return '<div class="provider-summary-kpis">'+cards.map(c=>'<div class="provider-kpi provider-kpi-'+c.tone+'"><div class="provider-kpi-value"><label>'+c.label+'</label><strong>'+c.value+'</strong></div><div class="provider-kpi-comparison">'+c.change+'</div></div>').join('')+'</div>'+
   '<div class="provider-comparison-context"><span>'+(range.valid?'对比 '+E(range.previousFrom.replace('T',' '))+' 至 '+E(range.previousTo.replace('T',' ')):'对比时段不可用')+'</span><span>手续费已匹配 '+C(fees.matchedCount)+' / '+C(fees.successCount)+' 笔 · 两日均按当前费率估算</span></div>';
 }
 function render(ctx,direction){
  const {L,E,N,C,R,plus,combine,groupRows,box,table,pager,feeForRow,ensureFeeLookup}=ctx,name=direction==='charge'?'代收':'代付',issueLabel=direction==='charge'?'存款未到账':'取款未到账';
  if(L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)ensureFeeLookup();
  const orderRows=groupRows('provider'),rows=buildRows({orders:orderRows,issues:L.workorders?.byProvider||null,rates:L.feeLookupRows,country:L.country,direction,plus,combine,coverage:L.workorders?.coverage});
  const total=plus(rows),fees=feeSummary(rows),knownFee=fees.amount||0;
  const sort=L.providerSort||'success_amount',asc=L.providerSortAsc?1:-1;
  rows.sort((a,b)=>asc*(Number(a[sort]??-Infinity)-Number(b[sort]??-Infinity))||String(a.provider).localeCompare(String(b.provider)));
  const max=Math.max(1,Math.ceil(rows.length/L.localSize));L.localPage=Math.min(L.localPage,max);const shown=rows.slice((L.localPage-1)*L.localSize,L.localPage*L.localSize);
  root.providerSummarySort=function(key){if(!['success_amount','success_count','pending_amount','all_count','estimated_fee'].includes(key))return;L.providerSortAsc=L.providerSort===key?!L.providerSortAsc:false;L.providerSort=key;L.localPage=1;ctx.render()};
  const header=(text,key)=>key?'<button class="link" onclick="providerSummarySort(\''+key+'\')">'+text+' '+(sort===key?(L.providerSortAsc?'↑':'↓'):'↕')+'</button>':text;
  const headers=['统一三方','平台',header(name+'成功金额','success_amount'),header(name+'成功笔数','success_count'),'成功率','金额占比',...(direction==='withdraw'?[header('代付中金额','pending_amount'),'代付中笔数']:[]),'匹配费率',header('估算手续费','estimated_fee'),'手续费占比',
   '工单提交金额','工单提交笔数','工单成功金额','工单成功笔数','工单未到账金额','工单未到账笔数','工单成功率'];
  const feeCell=r=>r.estimated_fee==null?(L.feeLookupLoading?'读取中…':'—'):N(r.estimated_fee)+(!r.fee_complete?'<span class="provider-partial" title="已匹配 '+C(r.fee_matched_count)+' / '+C(r.success_count)+' 笔">部分</span>':'');
  const cells=(r,label,summary=false)=>{
   const w=r.issues,rate=r.created_success_count==null?'—':R(r.created_success_count,r.all_count);
   return [label,'<span title="'+E(summary?'去重平台数':(r.sources.join(' / ')||'仅工单记录')+' · '+r.platforms.join('、'))+'">'+C(r.platforms.length)+'</span>',
    N(r.success_amount),C(r.success_count),'<span title="按创建订单：'+C(r.created_success_count)+' / '+C(r.all_count)+' 笔">'+rate+'</span>',R(r.success_amount,total.success_amount),
    ...(direction==='withdraw'?[N(r.pending_amount),C(r.pending_count)]:[]),summary?'—':E(feeForRow(r)),feeCell(r),r.estimated_fee==null?'—':R(r.estimated_fee,knownFee),
    ...[['submittedAmount','submittedCount'],['successAmount','successCount'],['notReceivedAmount','notReceivedCount']].flatMap(([a,n])=>!w?['—','—']:[N(w[a]),C(w[n])]),
    !w?'—':'<span title="金额成功率 '+R(w.successAmount,w.submittedAmount)+'">'+R(w.successCount,w.submittedCount)+'</span>'];
  };
  const sumRow=(items,label)=>{const r={...plus(items),platforms:[...new Set(items.flatMap(i=>i.platforms))],fee_matched_count:items.reduce((n,i)=>n+i.fee_matched_count,0)};
   const fees=feeSummary(items);r.estimated_fee=fees.amount;r.fee_complete=fees.complete;
   r.issues=L.workorders&&items.some(i=>i.issues)?Object.fromEntries(issueKeys.map(k=>[k,items.reduce((n,i)=>n+Number(i.issues?.[k]||0),0)])):null;return cells(r,'<strong>'+label+'</strong>',true)};
  const coverage=L.workorders?.coverage;
  const coverageNote=coverage&&!coverage.complete?' · 工单覆盖 '+C(coverage.capturedPlatformDays)+' / '+C(coverage.expectedPlatformDays)+' 平台日':'';
  const workNote=L.workordersError?'<div class="live-status live-error">工单读取未完成：'+E(L.workordersError)+' <button class="link" onclick="liveLoad()">重试</button></div>':
   L.workordersLoading?'<div class="live-status">正在读取'+issueLabel+'工单汇总…</div>':'';
  const footers=max>1?[sumRow(shown,'当前页汇总'),sumRow(rows,'全部汇总')]:[sumRow(rows,'合计')];
  return '<div class="provider-summary-heading"><span class="provider-scope-note">'+E(L.country)+' · '+E(L.currency)+' · '+E(L.from.replace('T',' '))+' 至 '+E(L.to.replace('T',' '))+coverageNote+'</span></div>'+
   renderMetrics(ctx,direction,rows)+workNote+
   box(name+'三方汇总 · '+issueLabel+'工单',table(headers,shown.map(r=>cells(r,E(r.provider))),'provider-summary-table provider-compact-table',footers)+pager(rows.length,L.localPage,L.localSize,'local'),
    '平台、金额、笔数分列展示。成功数据按成功时间；成功率按本期创建订单计算。昨日对比使用同平台、同币种、同一时段，成功率差额为百分点。三方及平台卡片统计有交易的范围；工单按所选整日统计，未采集显示 —。手续费按当前匹配费率估算，优先平台专属费率；复杂费率不猜算。');
 }
 root.HensemProviderSummary={render,buildRows,parseFee,estimate,feeSummary};
 if(typeof module!=='undefined')module.exports={render,buildRows,parseFee,estimate,feeSummary};
})(typeof window!=='undefined'?window:globalThis);
