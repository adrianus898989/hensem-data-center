(function(root){
 'use strict';
 const normalized=v=>String(v??'').trim().toLowerCase().replace(/[\s._()（）-]+/g,'');
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
  let candidates=(rates||[]).filter(r=>normalized(r.provider)===normalized(row.provider)
   &&(normalized(r.country)===normalized(country)||normalized(r.scopeGroup)===normalized(country)));
  const specific=candidates.filter(r=>r.scopeType==='platform'&&normalized(r.platform)===normalized(row.platform));
  candidates=specific.length?specific:candidates.filter(r=>r.scopeType!=='platform');
  const unique=new Map();for(const r of candidates){const value=parseFee(r[feeKey],r[singleKey]);if(!value)return null;unique.set(JSON.stringify(value),value)}
  if(unique.size!==1||row.success_amount==null||!Number.isFinite(Number(row.success_amount)))return null;
  const value=[...unique.values()][0];return Number(row.success_amount)*value.percent+Number(row.success_count||0)*value.fixed;
 }
 function buildRows({orders,issues,rates,country,direction,plus,combine,coverage}){
  const flow=(orders||[]).filter(r=>r.direction===direction).map(r=>({...r,provider:providerName(r.provider)}));
  const byIssue=new Map();for(const row of issues||[]){if(row.direction!==direction)continue;const name=providerName(row.provider),item=byIssue.get(name)||Object.fromEntries(issueKeys.map(k=>[k,0]));for(const key of issueKeys)item[key]+=Number(row[key]||0);byIssue.set(name,item)}
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
 function render(ctx,direction){
  const {L,E,N,C,R,plus,combine,groupRows,box,table,pager,feeForRow,ensureFeeLookup}=ctx,name=direction==='charge'?'代收':'代付',issueLabel=direction==='charge'?'存款未到账':'取款未到账';
  if(L.feeLookupRows===null&&!L.feeLookupLoading)ensureFeeLookup();
  const orderRows=groupRows('provider'),rows=buildRows({orders:orderRows,issues:L.workorders?.byProvider||null,rates:L.feeLookupRows,country:L.country,direction,plus,combine,coverage:L.workorders?.coverage});
  const total=plus(rows),knownFee=rows.reduce((n,r)=>n+(r.estimated_fee||0),0),feeCount=rows.reduce((n,r)=>n+r.fee_matched_count,0);
  const sort=L.providerSort||'success_amount',asc=L.providerSortAsc?1:-1;
  rows.sort((a,b)=>asc*(Number(a[sort]??-Infinity)-Number(b[sort]??-Infinity))||String(a.provider).localeCompare(String(b.provider)));
  const max=Math.max(1,Math.ceil(rows.length/L.localSize));L.localPage=Math.min(L.localPage,max);const shown=rows.slice((L.localPage-1)*L.localSize,L.localPage*L.localSize);
  root.providerSummarySort=function(key){if(!['success_amount','success_count','pending_amount','all_count','estimated_fee'].includes(key))return;L.providerSortAsc=L.providerSort===key?!L.providerSortAsc:false;L.providerSort=key;L.localPage=1;ctx.render()};
  const header=(text,key)=>key?'<button class="link" onclick="providerSummarySort(\''+key+'\')">'+text+' '+(sort===key?(L.providerSortAsc?'↑':'↓'):'↕')+'</button>':text;
  const headers=[header('统一三方'),header(name+'成功金额','success_amount'),header(name+'成功笔数','success_count'),'创建订单成功率','成功金额占比',
   '全部创建金额',header('全部创建笔数','all_count'),header('处理中金额','pending_amount'),'处理中笔数','匹配费率',header('估算手续费','estimated_fee'),'手续费占比（已匹配）',
   issueLabel+'提交金额',issueLabel+'提交笔数',issueLabel+'成功金额',issueLabel+'成功笔数',issueLabel+'尚未成功金额',issueLabel+'尚未成功笔数','工单成功笔数占比','工单成功金额占比'];
  const feeCell=r=>r.estimated_fee==null?(L.feeLookupLoading?'读取中…':'—'):N(r.estimated_fee)+(!r.fee_complete?'<small class="cell-sub">部分匹配 '+C(r.fee_matched_count)+' / '+C(r.success_count)+' 笔</small>':'');
  const cells=(r,label,summary=false)=>{
   const w=r.issues,rate=r.created_success_count==null?'—':R(r.created_success_count,r.all_count);
   return [label+(summary?'':'<small class="cell-sub">'+E(r.sources.map(s=>({ar:'AR',newar:'新AR',game66:'AA'})[s]||s).join(' / ')||'仅工单记录')+' · '+C(r.platforms.length)+' 平台</small>'),
    N(r.success_amount),C(r.success_count),rate+'<small class="cell-sub">'+(r.created_success_count==null?'未取得创建订单成功笔数':C(r.created_success_count)+' / '+C(r.all_count)+' 笔')+'</small>',R(r.success_amount,total.success_amount),
    N(r.all_amount),C(r.all_count),N(r.pending_amount),C(r.pending_count),summary?'—':E(feeForRow(r)),feeCell(r),r.estimated_fee==null?'—':R(r.estimated_fee,knownFee),
    ...issueKeys.map(key=>!w?'—':key.endsWith('Count')?C(w[key]):N(w[key])),!w?'—':R(w.successCount,w.submittedCount),!w?'—':R(w.successAmount,w.submittedAmount)];
  };
  const sumRow=(items,label)=>{const r={...plus(items),created_success_count:items.reduce((n,i)=>n+Number(i.created_success_count||0),0),fee_matched_count:items.reduce((n,i)=>n+i.fee_matched_count,0)};
   r.estimated_fee=r.fee_matched_count||!r.success_count?items.reduce((n,i)=>n+(i.estimated_fee||0),0):null;r.fee_complete=r.fee_matched_count===r.success_count;
   r.issues=L.workorders&&items.some(i=>i.issues)?Object.fromEntries(issueKeys.map(k=>[k,items.reduce((n,i)=>n+Number(i.issues?.[k]||0),0)])):null;return cells(r,'<strong>'+label+'</strong>',true)};
  const kpis=[['统一三方',C(rows.length)],['平台',C(new Set(orderRows.map(r=>r.platformId)).size)],[name+'成功金额',N(total.success_amount)],[name+'成功笔数',C(total.success_count)],['处理中金额',N(total.pending_amount)],['估算手续费',feeCount?N(knownFee):'—']];
  const coverage=L.workorders?.coverage;
  const coverageNote=coverage&&!coverage.complete?'<div class="live-status">工单已采集 '+C(coverage.capturedPlatformDays)+' / '+C(coverage.expectedPlatformDays)+' 个平台日；下方仅汇总已采集范围，未采集项显示 —。</div>':'';
  const workNote=L.workordersError?'<div class="live-status live-error">工单读取未完成：'+E(L.workordersError)+' <button class="link" onclick="liveLoad()">重试</button></div>':
   L.workordersLoading?'<div class="live-status">正在读取'+issueLabel+'工单汇总…</div>':'';
  return '<nav class="provider-direction-tabs"><button class="btn '+(direction==='charge'?'primary':'')+'" onclick="setPage(\'providers\')">代收汇总</button><button class="btn '+(direction==='withdraw'?'primary':'')+'" onclick="setPage(\'provider_payout\')">代付汇总</button></nav>'+
   '<p class="provider-scope-note">'+E(L.country)+' · '+E(L.currency)+' · '+E(L.from.replace('T',' '))+' 至 '+E(L.to.replace('T',' '))+'<br>成功金额、笔数按成功时间；全部、处理中按创建时间。成功率 = 本范围创建且已成功笔数 ÷ 本范围创建笔数。工单按所选日期整日统计。</p>'+
   '<div class="provider-summary-kpis">'+kpis.map(([label,value])=>'<div class="live-metric"><label>'+label+'</label><strong>'+value+'</strong></div>').join('')+'</div>'+workNote+coverageNote+
   box(name+'三方汇总',table(headers,shown.map(r=>cells(r,E(r.provider))),'provider-summary-table',[sumRow(shown,'当前页汇总'),sumRow(rows,'全部汇总')])+pager(rows.length,L.localPage,L.localSize,'local'),
    '估算手续费按当前匹配的三方费率计算，优先平台专属费率；阶梯、复杂费率及未匹配项保留 —。历史生效版本未接入。工单使用原后台已采集的三方归属日统计'+(L.workorders?.unsupportedPlatforms?.length?'；部分所选平台尚无工单来源。':'。'));
 }
 root.HensemProviderSummary={render,buildRows,parseFee,estimate};
 if(typeof module!=='undefined')module.exports={render,buildRows,parseFee,estimate};
})(typeof window!=='undefined'?window:globalThis);
