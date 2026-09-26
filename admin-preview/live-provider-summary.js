(function(root){
 'use strict';
 const normalized=v=>String(v??'').trim().toLowerCase().replace(/[\s._()（）-]+/g,'');
 const canonical=(value,country)=>root.HensemProviderNames?.canonical(value,country)??String(value??'');
 const providerName=value=>!value||['未识别三方','未提供'].includes(value)?'未识别通道':value;
 const feeExemptNames=new Set(['人工充值','人工确认','人工取消','无三方（驳回）','无三方(驳回)','manualrecharge','manualconfirmation']);
 const unknownProviderNames=new Set(['','未识别通道','未识别三方','未提供','未标记三方']);
 const feeExempt=value=>feeExemptNames.has(String(value??'').trim())||feeExemptNames.has(normalized(value));
 const isProviderBusiness=value=>!feeExempt(value)&&!unknownProviderNames.has(String(value??'').trim());
 const issueKeys=['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount'];
 // Owner confirmed on 2026-09-26: India UpiPay uses 印度线下 row 4 for both flows.
 // Select that source record; never substitute another tier when it is missing.
 function confirmedFeeRule(row,country){
  return ['印度','in','india'].includes(normalized(country))&&normalized(canonical(row?.provider,country))==='upipay'
   ?{sheetName:'印度线下',sourceRow:4,note:'已确认：当前统一使用《印度线下》第 4 行。具体费率读取下表的原始记录。'}:null;
 }
 // Loaded rate snapshots are replaced atomically. Reuse the country/provider
 // index across every platform leaf, fee total, type label and table render.
 const rateIndexes=new WeakMap();
 function rateRecords(row,rates,country){
  if(!Array.isArray(rates))return [];
  let snapshot=rateIndexes.get(rates);if(!snapshot||snapshot.length!==rates.length){snapshot={length:rates.length,countries:new Map()};rateIndexes.set(rates,snapshot)}
  let index=snapshot.countries.get(country);
  if(!index){index=new Map();for(const r of rates){if(normalized(r.country)!==normalized(country)&&normalized(r.scopeGroup)!==normalized(country))continue;const key=normalized(canonical(r.provider,country));if(!index.has(key))index.set(key,[]);index.get(key).push(r)}snapshot.countries.set(country,index)}
  return index.get(normalized(canonical(row.provider,country)))||[];
 }
 function feeCandidates(row,rates,country){
  if(!isProviderBusiness(row?.provider))return [];
  const payout=row.direction==='withdraw',feeKey=payout?'payoutFee':'collectFee',singleKey=payout?'payoutSingleFee':'collectSingleFee';
  let candidates=rateRecords(row,rates,country).filter(r=>String(r[feeKey]??'').trim()||String(r[singleKey]??'').trim());
  const rule=confirmedFeeRule(row,country);
  if(rule)return candidates.filter(r=>r.scopeType!=='platform'&&r.sheetName===rule.sheetName&&Number(r.sourceRow)===rule.sourceRow);
  const platforms=[...(row.platforms||[]),row.platform].filter(Boolean).map(normalized);
  const specific=candidates.filter(r=>r.scopeType==='platform'&&platforms.includes(normalized(r.platform)));
  return specific.length?specific:candidates.filter(r=>r.scopeType!=='platform');
 }
 // Business type is the original sheet field, not the normalized UPI/USDT fee category.
 function providerType(row,rates,country){
  if(!isProviderBusiness(row?.provider))return {label:'—',state:'empty',detail:'非三方业务'};
  if(rates===null)return {label:'读取中…',state:'empty',detail:'正在读取原表业务类型'};
  const leaves=row.fee_items||row.items;
  if(leaves?.length){
   const facts=leaves.map(item=>providerType({...item,provider:item.provider||row.provider},rates,item.country||country));
   const types=[...new Set(facts.flatMap(f=>f.types||[]))],review=facts.some(f=>f.state==='review');
   return {types,label:review?'待核对':types.length>1?'多种类型':types[0]||'未标注',state:review?'review':types.length>1?'mixed':types.length?'known':'empty',detail:[...new Set(facts.map(f=>f.detail))].join('；')};
  }
  let candidates=rateRecords(row,rates,country);const rule=confirmedFeeRule(row,country);
  if(rule)candidates=candidates.filter(r=>r.scopeType!=='platform'&&r.sheetName===rule.sheetName&&Number(r.sourceRow)===rule.sourceRow);
  else {const platforms=[...(row.platforms||[]),row.platform].filter(Boolean).map(normalized),specific=candidates.filter(r=>r.scopeType==='platform'&&platforms.includes(normalized(r.platform)));candidates=specific.length?specific:candidates.filter(r=>r.scopeType!=='platform')}
  const types=new Set(),details=[];let mismatch=false;
  for(const r of candidates){
   if(!String(r.sourceType??'').trim())continue;
   if(!r.sourceTypeProvider||normalized(canonical(r.sourceTypeProvider,country))!==normalized(canonical(row.provider,country))){mismatch=true;continue}
   const type=String(r.sourceType).trim();types.add(type);details.push((r.sheetName||'原表')+' '+(r.sourceTypeCell||'第'+r.sourceRow+'行')+'：'+type);
  }
  const label=mismatch?'待核对':types.size>1?'多种类型':types.size?[...types][0]:'未标注';
  return {label,types:[...types],state:mismatch?'review':types.size>1?'mixed':types.size?'known':'empty',detail:[...new Set(details)].join('；')+(mismatch?'；源表三方名称与当前三方不一致，类型待核对':'')||'原表未标注业务类型'};
 }
 function providerTypeCell(row,rates,country,E,status={}){const value=status.feeLookupError?{label:'读取失败',state:'review',detail:status.feeLookupError}:status.feeLookupLoading?{label:'读取中…',state:'empty',detail:'正在读取原表业务类型'}:providerType(row,rates,country);return '<span class="provider-business-type '+value.state+'" title="'+E(value.detail)+'">'+E(value.label)+'</span>'}
 function parseFee(percent,single){
  const rate=String(percent??'').trim(),fixed=String(single??'').trim();let p=0,f=0;
  if(!rate&&!fixed)return null;
  if(rate){if(/^\d+(?:\.\d+)?\s*%$/.test(rate))p=parseFloat(rate)/100;
   else if(/^\d+(?:\.\d+)?\s*\/\s*笔$/.test(rate))f=parseFloat(rate);else return null;}
  if(fixed){if(/^0(?:\.0+)?%?$/.test(fixed)){}else if(/^\d+(?:\.\d+)?(?:\s*\/\s*笔)?$/.test(fixed))f+=parseFloat(fixed);else return null;}
  return {percent:p,fixed:f};
 }
 function estimate(row,rates,country){
  if(!isProviderBusiness(row?.provider))return null;
  const payout=row.direction==='withdraw',feeKey=payout?'payoutFee':'collectFee',singleKey=payout?'payoutSingleFee':'collectSingleFee';
  const candidates=feeCandidates(row,rates,country);
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
   Object.assign(row,feeFacts(row.items,rates,country,Number(row.success_count||0)));
  }
  return rows;
 }
 // Resolve each original platform/provider leaf before merging across sources.
 // Applying one rate after a merge would misprice platform-specific and fixed fees.
 function feeFacts(items,rates,country,successCount){
  let matched=0,amount=0,excluded=0;const labels=new Set();
  for(const item of items){
   if(feeExempt(item.provider)){excluded+=Number(item.success_count||0);continue}
   const localCountry=item.country||country,payout=item.direction==='withdraw';
   const candidates=feeCandidates(item,rates,localCountry),values=new Map();
   for(const r of candidates){const parsed=parseFee(r[payout?'payoutFee':'collectFee'],r[payout?'payoutSingleFee':'collectSingleFee']);if(parsed)values.set(JSON.stringify(parsed),parsed);else values.set('unknown',null)}
   if(values.size===1&&!values.has('unknown')){const rule=[...values.values()][0];labels.add((rule.percent*100).toFixed(2)+'%'+(rule.fixed?' + '+Number(rule.fixed.toFixed(8))+' / 笔':''))}
   else if(values.size>1)labels.add('待核对费率');else labels.add('未匹配');
   const value=estimate(item,rates,localCountry);if(value!==null){matched+=Number(item.success_count||0);amount+=value}
  }
  const eligible=Math.max(0,successCount-excluded),hasUnattributed=items.reduce((n,r)=>n+Number(r.success_count||0),0)<successCount;
  if(hasUnattributed)labels.add('未匹配');
  const exemptOnly=items.length>0&&items.every(r=>feeExempt(r.provider))&&!hasUnattributed;
  return {estimated_fee:exemptOnly?null:matched>0?amount:successCount===0?0:null,fee_matched_count:matched,
   fee_eligible_count:eligible,fee_applicable_count:eligible,fee_excluded_count:excluded,fee_complete:matched===eligible,
   fee_rate_label:exemptOnly?'不适用':[...labels].sort().join(' / ')||'未匹配'};
 }
 function feeSummary(rows){
  const total=(rows||[]).reduce((s,r)=>{s.successCount+=Number(r.fee_eligible_count??r.success_count??0);s.excludedCount+=Number(r.fee_excluded_count||0);s.matchedCount+=Number(r.fee_matched_count||0);if(r.estimated_fee!=null)s.amount+=Number(r.estimated_fee);return s},{amount:0,matchedCount:0,successCount:0,excludedCount:0});
  total.complete=total.matchedCount===total.successCount;if(!total.matchedCount&&(total.successCount||total.excludedCount))total.amount=null;
  if(new Set((rows||[]).map(r=>r.currency).filter(Boolean)).size>1){total.amount=null;total.complete=false}
  return total;
 }
 function overviewDimensions({orders,summaries,rates,country,key,plus,combine}){
  if(!['team','country','platform','provider'].includes(key))return [];
  const identity=r=>r.platformId?'id:'+r.platformId:JSON.stringify([r.source,r.country,r.platform]);
  const metadata=new Map((summaries||[]).map(r=>[identity(r),r]));
  const leaves=(orders||[]).map(r=>{const scope=metadata.get(identity(r))||{};return {...scope,...r,country:r.country||scope.country||country,team:r.team||scope.team||'未绑定团队',provider:providerName(canonical(r.provider,r.country||scope.country||country))}});
  const enrich=r=>({...r,_platformIdentity:identity(r)}),dimensions=key==='platform'?['_platformIdentity','platform','direction','currency']:[key,'direction','currency'];
  const base=key==='provider'?leaves:(summaries||[]),groups=combine(base.map(enrich),dimensions);
  const groupKey=r=>JSON.stringify(dimensions.map(k=>r[k]??'')),feesByGroup=new Map();
  for(const leaf of leaves.map(enrich)){const id=groupKey(leaf);if(!feesByGroup.has(id))feesByGroup.set(id,[]);feesByGroup.get(id).push(leaf)}
  for(const row of groups){
   const original=feesByGroup.get(groupKey(row))||[];
   Object.assign(row,feeFacts(original,rates,country,Number(row.success_count||0)));
   row.platformIds=[...new Set(row.items.map(r=>r.platformId).filter(Boolean))];
   row.platformId=row.platformIds.length===1?row.platformIds[0]:undefined;
   row.sources=[...new Set(row.items.map(r=>r.source).filter(Boolean))];
   row.fee_items=original;
  }
  const denominators=new Map();for(const row of groups){const id=JSON.stringify([row.direction,row.currency]);if(!denominators.has(id))denominators.set(id,[]);denominators.get(id).push(row)}
  const ratio=(n,d)=>n!=null&&d!=null&&Number.isFinite(Number(n))&&Number.isFinite(Number(d))&&Number(d)>0?Number(n)/Number(d):null;
  for(const items of denominators.values()){const total=plus(items),fees=feeSummary(items);for(const row of items){row.success_amount_share=ratio(row.success_amount,total.success_amount);row.success_count_share=ratio(row.success_count,total.success_count);row.fee_share=ratio(row.estimated_fee,fees.amount);row.fee_share_complete=fees.complete}}
  return groups;
 }
 // A platform child uses the same success-time facts as its parent. Work-order
 // cohorts come only from a complete aggregate field, never the paginated rows.
 function buildPlatformRows({row,workorders,rates,country,plus,combine}){
  const identity=r=>r.platformId?'id:'+r.platformId:JSON.stringify([r.country||country,r.platform,r.source,r.currency]);
  const leaves=(row.items||[]).map(r=>({...r,_platformIdentity:identity(r)}));
  const rows=combine(leaves,['_platformIdentity','platformId','platform','source','country','currency']).map(r=>({...r,direction:row.direction,provider:row.provider,
   ...feeFacts(r.items,rates,country,Number(r.success_count||0)),issues:null,issueOnly:false}));
  const full=Array.isArray(workorders?.byPlatformProvider);
  if(!full)return rows.sort((a,b)=>Number(b.success_amount)-Number(a.success_amount));
  const entries=workorders.byPlatformProvider.filter(w=>w.direction===row.direction
   &&providerName(canonical(w.provider,w.country||country))===row.provider
   &&(!w.country||!country||w.country===country));
  const addIssue=(target,w)=>{if(!target.issues)target.issues=Object.fromEntries(issueKeys.map(k=>[k,0]));for(const k of issueKeys)target.issues[k]+=Number(w[k]||0)};
  for(const w of entries){
   // The API resolves identities against the authorized catalog. A missing ID
   // is intentionally not guessed from a shared display name across sources.
   const matches=w.platformId?rows.filter(r=>r.platformId===w.platformId):[];
   if(matches.length===1){addIssue(matches[0],w);continue}
   const id=JSON.stringify([w.country||country,w.platformId||'',w.sourcePlatform||w.platform,w.source||'']);
   let target=rows.find(r=>r.issueOnly&&r._issueIdentity===id);
   if(!target){target={...plus([]),_issueIdentity:id,platformId:w.platformId||null,platform:w.platform||w.sourcePlatform||'未匹配平台',
    source:w.source||'工单记录（包网未匹配）',country:w.country||country,currency:row.currency,direction:row.direction,provider:row.provider,
    items:[],issueOnly:true,issues:null,estimated_fee:null,fee_complete:false,fee_rate_label:'—'};rows.push(target)}
   addIssue(target,w);
  }
  // Absence is a known zero only for a platform whose work-order source was
  // actually collected. An uncovered platform is unavailable, not zero.
  for(const r of rows){if(r.issues||r.issueOnly)continue;
   const observed=(workorders.coverage?.platforms||[]).filter(p=>p.platformId&&p.platformId===r.platformId);
   if(observed.some(p=>Number(p.days)>0))r.issues=Object.fromEntries(issueKeys.map(k=>[k,0]));
  }
  return rows.sort((a,b)=>Number(a.issueOnly)-Number(b.issueOnly)||Number(b.success_amount)-Number(a.success_amount)||String(a.platform).localeCompare(String(b.platform)));
 }
 function queryCoverage(L){
  const failures=Array.isArray(L.queryFailures)&&L.queryFailures.length?L.queryFailures:(L.queryWarnings||[]).map(message=>({message}));
  const received=new Set((L.results||[]).map(r=>r.platform?.id||JSON.stringify([r.platform?.source,r.platform?.country,r.platform?.name]))).size;
  const requested=Math.max(Array.isArray(L.queryPlatforms)?L.queryPlatforms.length:0,received+failures.length);
  return {failures,received,requested,partial:failures.length>0||received<requested,empty:received===0&&requested>0,pending:Math.max(0,requested-received-failures.length)};
 }
 function readNotice(ctx){
  const {L,E,C}=ctx,c=queryCoverage(L);if(!c.partial)return '';
  const details=c.failures.length?'<details class="provider-query-failures"><summary>查看未完成平台与原因（'+C(c.failures.length)+'）</summary><ul>'+c.failures.map(f=>'<li><strong>'+E(f.name||'')+'</strong>'+(f.name?'：':'')+E(f.message||'读取失败')+'</li>').join('')+'</ul></details>':'';
  return '<section class="live-status live-error provider-query-partial" role="status"><strong>'+(c.empty?'本次尚无平台返回，数据暂不可用':'仅显示已返回平台的部分结果')+'</strong><div>平台覆盖：已返回 '+C(c.received)+' / '+C(c.requested)+' 个平台。'+(c.failures.length?'部分平台读取失败；':'')+'未返回平台不计入下方金额、笔数与占比，不代表零交易或未上传。</div>'+(L.queryRetrying?'<div>正在补读未完成平台，已返回数据保留。</div>':c.pending?'<div>其余 '+C(c.pending)+' 个平台仍在读取。</div>':'')+details+(c.failures.length&&typeof root.liveRetryFailed==='function'?'<button class="btn small" onclick="liveRetryFailed()" '+(L.queryRetrying||L.loading?'disabled':'')+'>'+(L.queryRetrying?'正在重试…':'只重试未完成平台')+'</button>':'')+'</section>';
 }
 function comparisonScope(L){
  if(queryCoverage(L).partial)return '当前平台范围未完整，暂不可比';
  if(L.comparisonStatus==='loading')return '昨日数据读取中…';
  if(L.comparisonStatus!=='ready')return L.comparisonError||'昨日数据尚未读取';
  const scope=results=>(results||[]).map(r=>[r.platform?.id,r.platform?.country,r.platform?.currency,r.platform?.timezone].join('|')).sort();
  const current=scope(L.results),previous=scope(L.comparisonResults);
  if(!current.length||current.length!==previous.length||current.some((id,i)=>id!==previous[i])
   ||L.comparisonResults.some(r=>!r.platform?.id||!Array.isArray(r.groups?.provider)))return '两日平台范围不完整，暂不可比';
  return '';
 }
 function renderMetrics(ctx,direction,currentRows){
  const {L,E,N,C,R,plus,combine}=ctx,name=direction==='charge'?'代收':'代付',readState=queryCoverage(L);
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
   if(isRate){const d=root.HensemLiveCompare.ratioDelta(current.total.success_count,current.total.all_count,previous.total.success_count,previous.total.all_count);
    return '<small>'+priorLabel+' '+(R(previous.total.success_count,previous.total.all_count))+'</small><span class="provider-kpi-change '+E(d.trend)+'">'+E(caption)+' '+E(d.value===null?'暂无可比成功率':d.display)+'</span>'}
   if(now==null||before==null||!Number.isFinite(Number(now))||!Number.isFinite(Number(before)))return '<small class="provider-kpi-unavailable">金额口径不完整，暂不可比</small>';
   const d=root.HensemLiveCompare.delta(now,before);
   return '<small>'+priorLabel+' '+format(before)+'</small><span class="provider-kpi-change '+E(d.trend)+'">'+E(caption)+' '+signed(Number(now)-Number(before),format)+' <em>'+E(d.display)+'</em></span>';
  };
  const fees=current.fees,feeReason=L.feeLookupLoading?'费率读取中…':L.feeLookupError?'费率读取失败，暂不可比':!fees.complete||!previous.fees.complete?'费率未完全匹配，暂不比较':'';
  const cards=[
   {label:'统一三方',value:C(current.providers),change:changes(current.providers,previous.providers,C),tone:'neutral'},
   {label:'平台',value:C(current.platforms),change:changes(current.platforms,previous.platforms,C),tone:'neutral'},
   {label:name+'创建金额',value:N(current.total.all_amount),change:changes(current.total.all_amount,previous.total.all_amount,N),tone:'neutral'},
   {label:name+'创建笔数',value:C(current.total.all_count),change:changes(current.total.all_count,previous.total.all_count,C),tone:'neutral'},
   {label:name+'成功金额',value:N(current.total.success_amount),change:changes(current.total.success_amount,previous.total.success_amount,N),tone:'amount'},
   {label:name+'成功笔数',value:C(current.total.success_count),change:changes(current.total.success_count,previous.total.success_count,C),tone:'amount'},
   {label:name+'成功率',value:R(current.total.success_count,current.total.all_count),change:changes(null,null,null,true),tone:'rate'},
   {label:'估算手续费',value:N(fees.amount)+(!fees.complete?'<span class="provider-partial">部分</span>':''),change:changes(fees.amount,previous.fees.amount,N,false,feeReason),tone:'fee'}
  ];
  if(readState.partial)for(const card of cards){if(card.label==='平台'){card.label='平台覆盖';card.value=C(readState.received)+' / '+C(readState.requested);card.change='<small>已返回 / 请求平台</small>'}else{card.label='已读取'+card.label;if(readState.empty)card.value='—'}}
  return '<div class="provider-summary-kpis">'+cards.map(c=>'<div class="provider-kpi provider-kpi-'+c.tone+'"><div class="provider-kpi-value"><label>'+c.label+'</label><strong>'+c.value+'</strong></div><div class="provider-kpi-comparison">'+c.change+'</div></div>').join('')+'</div>'+
   '<div class="provider-comparison-context"><span>'+(range.valid?'对比 '+E(range.previousFrom.replace('T',' '))+' 至 '+E(range.previousTo.replace('T',' ')):'对比时段不可用')+'</span><span>手续费已匹配 '+C(fees.matchedCount)+' / '+C(fees.successCount)+' 笔 · 两日均按当前费率估算</span></div>';
 }
 function render(ctx,direction){
  const {L,E,N,C,R,plus,combine,groupRows,box,table,pager,feeForRow,ensureFeeLookup,providerCell,openDrawer}=ctx,name=direction==='charge'?'代收':'代付',issueLabel=direction==='charge'?'存款未到账':'取款未到账';
  if(L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)ensureFeeLookup();
  const orderRows=groupRows('provider'),rows=buildRows({orders:orderRows,issues:L.workorders?.byProvider||null,rates:L.feeLookupRows,country:L.country,direction,plus,combine,coverage:L.workorders?.coverage});
  const total=plus(rows),fees=feeSummary(rows),knownFee=fees.amount||0,readState=queryCoverage(L);
  const sort=L.providerSort||'success_amount',asc=L.providerSortAsc?1:-1;
  rows.sort((a,b)=>asc*(Number(a[sort]??-Infinity)-Number(b[sort]??-Infinity))||String(a.provider).localeCompare(String(b.provider)));
  const max=Math.max(1,Math.ceil(rows.length/L.localSize));L.localPage=Math.min(L.localPage,max);const shown=rows.slice((L.localPage-1)*L.localSize,L.localPage*L.localSize);
  root.providerSummarySort=function(key){if(!['success_amount','success_count','pending_amount','all_count','estimated_fee'].includes(key))return;L.providerSortAsc=L.providerSort===key?!L.providerSortAsc:false;L.providerSort=key;L.localPage=1;ctx.render()};
  const expanded=L.providerExpanded||(L.providerExpanded={}),rowKey=r=>JSON.stringify([direction,r.provider,r.currency]);
  root.providerSummaryToggle=function(index){const row=shown[index];if(!row)return;expanded[rowKey(row)]=!expanded[rowKey(row)];ctx.render()};
  root.providerSummaryRate=function(index){
   const row=shown[index];if(!row)return;const rule=confirmedFeeRule(row,L.country),records=rateRecords(row,L.feeLookupRows,L.country),used=new Set(row.items.flatMap(r=>feeCandidates(r,L.feeLookupRows,L.country)));
   const relevant=records.filter(r=>r.scopeType!=='platform'||row.items.some(item=>normalized(item.platform)===normalized(r.platform)));
   openDrawer(row.provider+' · 费率依据',box('当前匹配规则','<p class="live-definition">'+E(rule?.note||'优先匹配有费率内容的平台专属记录，再匹配国家记录。存在不同费率时，保留差异供核对。')+'</p>'+table(['使用情况','来源表 / 行','范围','业务类型','通道类型','代收','代收单笔','代付','代付单笔','原状态'],relevant.map(r=>[used.has(r)?'当前匹配':'未采用',E((r.sheetName||'未提供')+' / '+(r.sourceRow??'—')),E(r.platform||r.country||r.scopeGroup),providerTypeCell(row,[r],L.country,E),E(r.category||'—'),E(r.collectFee||'—'),E(r.collectSingleFee||'—'),E(r.payoutFee||'—'),E(r.payoutSingleFee||'—'),E(r.status||r.rawStatus||'—')]))));
  };
  const header=(text,key)=>key?'<button class="link" onclick="providerSummarySort(\''+key+'\')">'+text+' '+(sort===key?(L.providerSortAsc?'↑':'↓'):'↕')+'</button>':text;
  const headers=['统一三方','平台','类型',header(name+'成功金额','success_amount'),header(name+'成功笔数','success_count'),'成功率',readState.partial?'已读取金额占比':'金额占比',readState.partial?'已读取笔数占比':'笔数占比',...(direction==='withdraw'?[header('代付中金额','pending_amount'),'代付中笔数']:[]),'匹配费率',header('估算手续费','estimated_fee'),readState.partial?'已读取手续费占比':'手续费占比',
   '工单提交金额','工单提交笔数','工单成功金额','工单成功笔数','工单未到账金额','工单未到账笔数','工单成功率','平台明细'];
  const feeCell=r=>readState.empty?'—':r.estimated_fee==null?(L.feeLookupLoading?'读取中…':'—'):N(r.estimated_fee)+(!r.fee_complete?'<span class="provider-partial" title="已匹配 '+C(r.fee_matched_count)+' / '+C(r.success_count)+' 笔">部分</span>':'');
  const issueRate=w=>!w?'—':'<span'+(Number(w.submittedCount)>0&&Number(w.successCount)/Number(w.submittedCount)<0.3?' class="workorder-rate-low"':'')+' title="工单金额成功率 '+R(w.successAmount,w.submittedAmount)+'">'+R(w.successCount,w.submittedCount)+'</span>';
  const cells=(r,label,summary=false,index=0)=>{
   const w=r.issues,rate=R(r.success_count,r.all_count);
   return [label,'<span title="'+E(summary?'去重平台数':(r.sources.join(' / ')||'仅工单记录')+' · '+r.platforms.join('、'))+'">'+C(r.platforms.length)+'</span>',summary?'—':providerTypeCell(r,L.feeLookupRows,L.country,E,L),
    readState.empty?'—':N(r.success_amount),readState.empty?'—':C(r.success_count),'<span title="按成功 / 创建：'+C(r.success_count)+' / '+C(r.all_count)+' 笔">'+(readState.empty?'—':rate)+'</span>',readState.empty?'—':R(r.success_amount,total.success_amount),readState.empty?'—':R(r.success_count,total.success_count),
    ...(direction==='withdraw'?[readState.empty?'—':N(r.pending_amount),readState.empty?'—':C(r.pending_count)]:[]),summary?'—':'<button class="link" title="查看来源费率及匹配依据" onclick="providerSummaryRate('+index+')">'+E(feeForRow(r))+'</button>',feeCell(r),r.estimated_fee==null?'—':R(r.estimated_fee,knownFee),
    ...[['submittedAmount','submittedCount'],['successAmount','successCount'],['notReceivedAmount','notReceivedCount']].flatMap(([a,n])=>!w?['—','—']:[N(w[a]),C(w[n])]),
    issueRate(w),summary?'':'<button class="link" aria-expanded="'+!!expanded[rowKey(r)]+'" onclick="providerSummaryToggle('+index+')">'+(expanded[rowKey(r)]?'收起':'展开')+'</button>'];
  };
  const sumRow=(items,label)=>{const r={...plus(items),platforms:[...new Set(items.flatMap(i=>i.platforms))],fee_matched_count:items.reduce((n,i)=>n+i.fee_matched_count,0)};
   const fees=feeSummary(items);r.estimated_fee=fees.amount;r.fee_complete=fees.complete;
   r.issues=L.workorders&&items.some(i=>i.issues)?Object.fromEntries(issueKeys.map(k=>[k,items.reduce((n,i)=>n+Number(i.issues?.[k]||0),0)])):null;return cells(r,'<strong>'+label+'</strong>',true)};
  const coverage=L.workorders?.coverage;
  const coverageNote=coverage&&!coverage.complete?' · 工单覆盖 '+C(coverage.capturedPlatformDays)+' / '+C(coverage.expectedPlatformDays)+' 平台日':'';
  const workNote=L.workordersError?'<div class="live-status live-error">工单读取未完成：'+E(L.workordersError)+' <button class="link" onclick="liveLoad()">重试</button></div>':
   L.workordersLoading?'<div class="live-status">正在读取'+issueLabel+'工单汇总…</div>':'';
  const footers=max>1?[sumRow(shown,readState.partial?'当前页已读取合计':'当前页汇总'),sumRow(rows,readState.partial?'已读取合计':'全部汇总')]:[sumRow(rows,readState.partial?'已读取合计':'合计')];
  const breakdown=row=>{
   const items=buildPlatformRows({row,workorders:L.workorders,rates:L.feeLookupRows,country:L.country,plus,combine});
   const share=(value,denominator)=>value==null||denominator==null?'—':R(value,denominator);
   const details=items.map(r=>{
    const w=r.issues,unknown=r.issueOnly,rate=R(r.success_count,r.all_count);
    const amount=key=>unknown?'—':N(r[key]),count=key=>unknown?'—':C(r[key]);
    const values=[E(r.platform)+(unknown?'<small class="cell-sub">仅有工单数据</small>':''),E(r.source||'未提供'),providerTypeCell({...r,provider:row.provider},L.feeLookupRows,L.country,E,L),
     amount('success_amount'),count('success_count'),
     '<span title="按成功 / 创建：'+C(r.success_count)+' / '+C(r.all_count)+' 笔">'+(unknown?'—':rate)+'</span>',unknown?'—':share(r.success_amount,row.success_amount),unknown?'—':share(r.success_count,row.success_count),
     ...(direction==='withdraw'?[amount('pending_amount'),count('pending_count')]:[]),E(r.fee_rate_label),unknown?'—':feeCell(r),unknown?'—':share(r.estimated_fee,row.estimated_fee),
     ...[['submittedAmount','submittedCount'],['successAmount','successCount'],['notReceivedAmount','notReceivedCount']].flatMap(([a,n])=>!w?['—','—']:[N(w[a]),C(w[n])]),
     issueRate(w),'—'];
    return '<tr class="provider-platform-row">'+values.map(value=>'<td>'+value+'</td>').join('')+'</tr>';
   }).join('');
   const issueNote=!Array.isArray(L.workorders?.byPlatformProvider)?' 工单平台明细尚未返回，显示 —；不使用分页记录推算。':items.some(r=>r.issueOnly)?' 仅有工单或包网归属不明的平台单列，不计入交易平台数，未重复分摊。':'';
   return '<tr class="provider-expanded-row"><td colspan="'+headers.length+'"><div class="provider-platform-breakdown"><strong>'+E(row.provider)+' · 平台明细</strong><span class="live-definition">第一列为平台，第二列为包网。成功金额、成功笔数按成功时间；成功率为本期成功笔数 / 本期创建笔数，含跨日成功。金额、笔数占比以'+(readState.partial?'已读取平台范围':'当前筛选范围')+'内此三方为分母；手续费占比以此三方已匹配手续费为分母。'+issueNote+'</span></div></td></tr><tr class="provider-platform-labels">'+headers.map((h,i)=>'<td>'+E(i===0?'平台':i===1?'包网':i===headers.length-1?'':h.replace(/<[^>]*>/g,'').replace(/ [↕↑↓]$/, ''))+'</td>').join('')+'</tr>'+details;
  };
  let reportTable=table(headers,shown.map((r,i)=>cells(r,providerCell(r),false,i)),'provider-summary-table provider-compact-table',footers);
  if(shown.some(r=>expanded[rowKey(r)])){
   const body=shown.map((r,i)=>'<tr>'+cells(r,providerCell(r),false,i).map(c=>'<td>'+c+'</td>').join('')+'</tr>'+(expanded[rowKey(r)]?breakdown(r):'')).join('');
   reportTable=reportTable.replace(/<tbody>[\s\S]*?<\/tbody>/,()=>'<tbody>'+body+'</tbody>');
  }
  return '<div class="provider-summary-report">'+readNotice(ctx)+'<div class="provider-summary-heading"><span class="provider-scope-note">'+E(L.country)+' · '+E(L.currency)+' · '+E(L.from.replace('T',' '))+' 至 '+E(L.to.replace('T',' '))+coverageNote+'</span></div>'+
   renderMetrics(ctx,direction,rows)+workNote+
   box(name+'三方汇总'+(readState.partial?'（部分结果）':'')+' · '+issueLabel+'工单',reportTable+pager(rows.length,L.localPage,L.localSize,'local'),
    '成功数据按成功时间；成功率为本期成功笔数 / 本期创建笔数，含跨日成功，可超过100%。昨日对比使用同平台、同币种、同一时段，成功率差额为百分点。三方及平台卡片统计有交易的范围；工单按所选整日统计，未采集显示 —。点击费率查看来源与匹配规则；手续费按当前匹配费率估算。')+'</div>';
 }
 root.HensemProviderSummary={render,buildRows,parseFee,estimate,feeSummary,feeCandidates,confirmedFeeRule,queryCoverage,overviewDimensions,isProviderBusiness,buildPlatformRows,providerType,providerTypeCell};
 if(typeof module!=='undefined')module.exports=root.HensemProviderSummary;
})(typeof window!=='undefined'?window:globalThis);
