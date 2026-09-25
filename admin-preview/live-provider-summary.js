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
  const pair=(amount,count)=>N(amount)+'<span class="provider-count"> / '+C(count)+' 笔</span>';
  const headers=['统一三方',header(name+'成功金额 / 笔数','success_amount'),'成功率','金额占比',...(direction==='withdraw'?[header('代付中金额 / 笔数','pending_amount')]:[]),'匹配费率',header('估算手续费','estimated_fee'),'手续费占比',
   '工单提交金额 / 笔数','工单成功金额 / 笔数','工单未到账金额 / 笔数','工单成功率'];
  const feeCell=r=>r.estimated_fee==null?(L.feeLookupLoading?'读取中…':'—'):N(r.estimated_fee)+(!r.fee_complete?'<span class="provider-partial" title="已匹配 '+C(r.fee_matched_count)+' / '+C(r.success_count)+' 笔">部分</span>':'');
  const cells=(r,label,summary=false)=>{
   const w=r.issues,rate=r.created_success_count==null?'—':R(r.created_success_count,r.all_count);
   return [label+(summary?'':'<span class="provider-platform-count" title="'+E((r.sources.join(' / ')||'仅工单记录')+' · '+r.platforms.join('、'))+'">'+C(r.platforms.length)+' 平台</span>'),
    pair(r.success_amount,r.success_count),'<span title="按创建订单：'+C(r.created_success_count)+' / '+C(r.all_count)+' 笔">'+rate+'</span>',R(r.success_amount,total.success_amount),
    ...(direction==='withdraw'?[pair(r.pending_amount,r.pending_count)]:[]),summary?'—':E(feeForRow(r)),feeCell(r),r.estimated_fee==null?'—':R(r.estimated_fee,knownFee),
    ...[['submittedAmount','submittedCount'],['successAmount','successCount'],['notReceivedAmount','notReceivedCount']].map(([a,n])=>!w?'—':pair(w[a],w[n])),
    !w?'—':'<span title="金额成功率 '+R(w.successAmount,w.submittedAmount)+'">'+R(w.successCount,w.submittedCount)+'</span>'];
  };
  const sumRow=(items,label)=>{const r={...plus(items),fee_matched_count:items.reduce((n,i)=>n+i.fee_matched_count,0)};
   const fees=feeSummary(items);r.estimated_fee=fees.amount;r.fee_complete=fees.complete;
   r.issues=L.workorders&&items.some(i=>i.issues)?Object.fromEntries(issueKeys.map(k=>[k,items.reduce((n,i)=>n+Number(i.issues?.[k]||0),0)])):null;return cells(r,'<strong>'+label+'</strong>',true)};
  const providerCount=rows.filter(r=>!['未识别通道','无三方（驳回）','未标记三方'].includes(r.provider)).length;
  const kpis=[['统一三方',C(providerCount)],['平台',C(new Set(orderRows.map(r=>r.platformId)).size)],[name+'成功金额',N(total.success_amount)],[name+'成功笔数',C(total.success_count)],['估算手续费',fees.amount==null?'—':N(fees.amount)],['费用匹配笔数',C(fees.matchedCount)+' / '+C(fees.successCount)]];
  const coverage=L.workorders?.coverage;
  const coverageNote=coverage&&!coverage.complete?' · 工单覆盖 '+C(coverage.capturedPlatformDays)+' / '+C(coverage.expectedPlatformDays)+' 平台日':'';
  const workNote=L.workordersError?'<div class="live-status live-error">工单读取未完成：'+E(L.workordersError)+' <button class="link" onclick="liveLoad()">重试</button></div>':
   L.workordersLoading?'<div class="live-status">正在读取'+issueLabel+'工单汇总…</div>':'';
  const footers=max>1?[sumRow(shown,'当前页汇总'),sumRow(rows,'全部汇总')]:[sumRow(rows,'合计')];
  return '<div class="provider-summary-heading"><nav class="provider-direction-tabs"><button class="btn '+(direction==='charge'?'primary':'')+'" onclick="setPage(\'providers\')">代收汇总</button><button class="btn '+(direction==='withdraw'?'primary':'')+'" onclick="setPage(\'provider_payout\')">代付汇总</button></nav><span class="provider-scope-note">'+E(L.country)+' · '+E(L.currency)+' · '+E(L.from.replace('T',' '))+' 至 '+E(L.to.replace('T',' '))+coverageNote+'</span></div>'+
   '<div class="provider-summary-kpis">'+kpis.map(([label,value])=>'<div class="live-metric"><label>'+label+'</label><strong>'+value+'</strong></div>').join('')+'</div>'+workNote+
   box(name+'三方汇总 · '+issueLabel+'工单',table(headers,shown.map(r=>cells(r,E(r.provider))),'provider-summary-table provider-compact-table',footers)+pager(rows.length,L.localPage,L.localSize,'local'),
    '金额 / 笔数并列展示。成功数据按成功时间；成功率按本期创建订单计算。工单按所选整日统计，未采集显示 —。手续费按当前匹配费率估算，优先平台专属费率；复杂费率不猜算。');
 }
 root.HensemProviderSummary={render,buildRows,parseFee,estimate,feeSummary};
 if(typeof module!=='undefined')module.exports={render,buildRows,parseFee,estimate,feeSummary};
})(typeof window!=='undefined'?window:globalThis);
