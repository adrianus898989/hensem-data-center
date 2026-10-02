(function(root){
 'use strict';
 const normalized=v=>String(v??'').trim().toLowerCase().replace(/[\s._()（）-]+/g,'');
 const canonical=(value,country)=>root.HensemProviderNames?.canonical(value,country)??String(value??'');
 const platformKey=(name,row,country)=>normalized(root.HensemLiveReportData?.normalizeIdentity({...row,country:row.country||country,name})?.name||name);
 const providerName=value=>!value||['未识别三方','未提供'].includes(value)?'未识别通道':value;
 const feeExemptNames=new Set(['人工充值','人工确认','人工取消','无三方（驳回）','无三方(驳回)','manualrecharge','manualconfirmation']);
 const unknownProviderNames=new Set(['','未识别通道','未识别三方','未提供','未标记三方']);
 const feeExempt=value=>feeExemptNames.has(String(value??'').trim())||feeExemptNames.has(normalized(value));
 const isProviderBusiness=value=>!feeExempt(value)&&!unknownProviderNames.has(String(value??'').trim());
 const issueKeys=['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount'];
 const kycIssueKeys=['uniqueNotReceivedKycCount','uniqueNotReceivedKycAmount'];
 const uniqueIssueKeys=['uniqueOrderAmount','uniqueOrderCount','uniqueSuccessAmount','uniqueSuccessCount','uniqueNotReceivedAmount','uniqueNotReceivedCount',...kycIssueKeys];
 const displayedIssueKeys={submittedAmount:'uniqueOrderAmount',submittedCount:'uniqueOrderCount',successAmount:'uniqueSuccessAmount',successCount:'uniqueSuccessCount',notReceivedAmount:'uniqueNotReceivedAmount',notReceivedCount:'uniqueNotReceivedCount'};
 const knownNumber=value=>value==null||typeof value==='string'&&!value.trim()||typeof value==='boolean'||!Number.isFinite(Number(value))?null:Number(value);
 const fraction=(value,total)=>knownNumber(value)===null||knownNumber(total)===null||Number(total)<=0?null:Number(value)/Number(total);
 const sortText=value=>{const text=String(value??'').trim();return !text||['—','未提供','未标注','读取中…','读取失败','待核对'].includes(text)?null:text};
 // Compare the underlying values once per row, never formatted HTML/percent text.
 // Unknown values remain last in either direction; equal rows retain their order.
 function sortedRows(rows,value,ascending=false){
  const compare=(a,b)=>Array.isArray(a)&&Array.isArray(b)?a.reduce((result,item,i)=>result||compare(item,b[i]),0):typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  return rows.map((row,index)=>{const raw=value(row);return {row,index,value:typeof raw==='number'&&!Number.isFinite(raw)||typeof raw==='string'&&!raw.trim()?null:raw}}).sort((a,b)=>a.value==null?(b.value==null?a.index-b.index:1):b.value==null?-1:(ascending?1:-1)*compare(a.value,b.value)||a.index-b.index).map(item=>item.row);
 }
 function feeSortValue(row){
  // Different platform tiers cannot be represented by a single comparable rate.
  const match=String(row.fee_reference_label??row.fee_rate_label??'').match(/^(\d+(?:\.\d+)?)%(?: \+ (\d+(?:\.\d+)?) \/ 笔)?$/);
  return match?[Number(match[1]),Number(match[2]||0)]:null;
 }
 // Reused by already-loaded tables. Callers supply raw getters, a local state,
 // and an event expression; pagination and fixed footer rows stay outside.
 function sortableTable({rows,headers,columns,sort,onSort}){
  const column=Number.isInteger(sort?.column)?columns[sort.column]:null,active=column&&typeof column.value==='function'?sort.column:-1;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return {rows:active<0?rows:sortedRows(rows,columns[active].value,!!sort.ascending),headers:headers.map((label,index)=>{
   const col=columns[index];if(!col||typeof col.value!=='function')return label;
   const ascending=active===index?!sort.ascending:!!col.ascending;
   return '<button class="link live-sort-heading" title="点击'+(ascending?'升序':'降序')+'排列；空值置后" onclick="'+esc(onSort(index))+'">'+label+' <span aria-hidden="true">'+(active===index?(sort.ascending?'↑':'↓'):'↕')+'</span></button>';
  })};
 }
 // Owner confirmed on 2026-09-26: India UpiPay uses 印度线下 row 4 for both flows.
 // Select that source record; never substitute another tier when it is missing.
 function confirmedFeeRule(row,country){
  if(!['印度','in','india'].includes(normalized(country)))return null;
  const provider=normalized(canonical(row?.provider,country));
  if(provider==='upipay')return {sheetName:'印度线下',sourceRow:4,note:'已确认：当前统一使用《印度线下》第 4 行。具体费率读取下表的原始记录。'};
  // Confirmed current YayaPay route is YAYAPAY-924. The current source sheet
  // names 923 separately; never mix the two rows or hardcode their prices.
  if(provider==='yayapay')return {sheetName:'印度线下',sourceProvider:'YAYAPAY-924',note:'当前 YayaPay / YAYAPAY-924 使用《印度线下》原名 YAYAPAY-924 的费率。YAYAPAY-923 是另一条源记录，不混入当前估算；具体费率随源表更新。'};
  return null;
 }
 function matchesFeeRule(record,rule){
  return record.scopeType!=='platform'&&record.sheetName===rule.sheetName&&(rule.sourceProvider
   ?normalized(record.sourceTypeProvider||record.provider)===normalized(rule.sourceProvider)
   :Number(record.sourceRow)===rule.sourceRow);
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
  if(rule)return candidates.filter(r=>matchesFeeRule(r,rule));
  const platforms=[...(row.platforms||[]),row.platform].filter(Boolean).map(name=>platformKey(name,row,country));
  const specific=candidates.filter(r=>r.scopeType==='platform'&&platforms.includes(platformKey(r.platform,row,country)));
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
  if(rule)candidates=candidates.filter(r=>matchesFeeRule(r,rule));
  else {const platforms=[...(row.platforms||[]),row.platform].filter(Boolean).map(name=>platformKey(name,row,country)),specific=candidates.filter(r=>r.scopeType==='platform'&&platforms.includes(platformKey(r.platform,row,country)));candidates=specific.length?specific:candidates.filter(r=>r.scopeType!=='platform')}
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
 // Owner confirmed current reference rule, 2026-09-27. Historical estimates
 // require backend effective-version facts; this label cannot price old orders.
 function tieredFeeRule(row,country){
  return ['印度','in','india'].includes(normalized(country))&&row.direction==='withdraw'
   &&row.currency==='INR'&&normalized(canonical(row.provider,country))==='speed2pay'
   ?{label:'≤2,000：3% + 6 / 笔；≥2,001：2%',lowPercent:0.03,lowFixed:6,highPercent:0.02}:null;
 }
 const feeBandKeys=['fee_low_count','fee_low_amount','fee_high_count','fee_high_amount','fee_gap_count','fee_gap_amount','fee_unpriced_count'];
 function feeBands(row){
  // Date-split requests keep their original provider leaves in items. The
  // generic chart merger intentionally does not invent or average fee bands.
  if(!feeBandKeys.some(k=>Object.hasOwn(row,k))&&row.items?.length){
   const parts=row.items.map(feeBands);if(parts.some(p=>!p))return null;
   const sum=Object.fromEntries(feeBandKeys.map(k=>[k,parts.reduce((n,p)=>n+p[k],0)]));
   return validFeeBands(sum,row.success_count)?sum:null;
  }
  const facts=Object.fromEntries(feeBandKeys.map(k=>[k,knownNumber(row[k])]));
  return validFeeBands(facts,row.success_count)?facts:null;
 }
 function validFeeBands(facts,count){
  const total=knownNumber(count);if(!Number.isSafeInteger(total)||total<0||feeBandKeys.some(k=>facts[k]===null||facts[k]<0))return false;
  for(const k of ['fee_low_count','fee_high_count','fee_gap_count','fee_unpriced_count'])if(!Number.isSafeInteger(facts[k]))return false;
  if(facts.fee_low_count+facts.fee_high_count+facts.fee_gap_count+facts.fee_unpriced_count!==total)return false;
  if(facts.fee_low_amount>facts.fee_low_count*2000)return false;
  if(facts.fee_high_count===0?facts.fee_high_amount!==0:facts.fee_high_amount<facts.fee_high_count*2001)return false;
  if(facts.fee_gap_count===0?facts.fee_gap_amount!==0:!(facts.fee_gap_amount>facts.fee_gap_count*2000&&facts.fee_gap_amount<facts.fee_gap_count*2001))return false;
  return true;
 }
 function versionFeeFacts(row){
  const total=knownNumber(row?.success_count),currency=typeof row?.currency==='string'&&row.currency.trim()?row.currency:null;
  if(!Number.isSafeInteger(total)||total<0||!currency)return null;
  if(row.items?.length){
   if(row.items.some(item=>item.currency!==currency))return null;
   const parts=row.items.map(versionFeeFacts);if(parts.some(part=>!part))return null;
   const combined=parts.reduce((sum,part)=>({matched:sum.matched+part.matched,unmatched:sum.unmatched+part.unmatched,amount:sum.amount+(part.amount??0)}),{matched:0,unmatched:0,amount:0});
   return combined.matched+combined.unmatched===total&&Number.isSafeInteger(combined.matched)&&Number.isSafeInteger(combined.unmatched)&&Number.isFinite(combined.amount)?{...combined,amount:combined.matched?combined.amount:null}:null;
  }
  const matched=knownNumber(row.fee_version_matched_count),unmatched=knownNumber(row.fee_version_unmatched_count),amount=knownNumber(row.fee_version_estimated_amount),state=row.fee_version_state;
  if(!Number.isSafeInteger(matched)||!Number.isSafeInteger(unmatched)||matched<0||unmatched<0||matched+unmatched!==total||!['complete','partial','unknown'].includes(state))return null;
  if(state==='complete'&&unmatched!==0||state==='partial'&&!(matched>0&&unmatched>0)||state==='unknown'&&matched!==0)return null;
  if(matched>0&&(amount===null||amount<0)||matched===0&&amount!==null&&amount!==0)return null;
  return {matched,unmatched,amount:matched?amount:null};
 }
 function estimateFacts(row,rates,country){
  if(!isProviderBusiness(row?.provider))return {amount:null,matched:0,reason:feeExempt(row?.provider)?null:'missing_provider'};
  const facts=versionFeeFacts(row);
  if(!facts)return {amount:null,matched:0,label:'历史费率待接入',reason:'missing_fee_history'};
  const exemptOnly=row.source==='wg'&&row.direction==='charge'&&Number(row.success_count)>0&&knownNumber(row.fee_exempt_count)===Number(row.success_count)&&facts.unmatched===0&&facts.amount===0;
  if(exemptOnly)return {amount:0,matched:facts.matched,label:'免手续费',exemptOnly:true,issues:[]};
  return {amount:facts.amount,matched:facts.matched,label:'按订单创建时间匹配费率'+(facts.unmatched?'（部分未匹配）':''),issues:facts.unmatched?[{reason:'missing_fee_history',count:facts.unmatched}]:[]};
 }

 function estimate(row,rates,country){return estimateFacts(row,rates,country).amount}
 // Each value must come from one backend aggregate over the full requested
 // range. Distinct order counts cannot be added across days or provider aliases.
 function uniqueWorkorderFacts(records){
  if(!Array.isArray(records)||records.length!==1)return null;
  const row=records[0],coverage=row?.uniqueCoverage;
  if(!coverage||!['complete','partial','unavailable'].includes(coverage.status)&&!workorderAttributedElsewhere(coverage))return null;
  // An attributed source label is context, not another set of original money.
  if(workorderAttributedElsewhere(coverage))return {...Object.fromEntries(uniqueIssueKeys.map(key=>[key,null])),coverage};
  return {...Object.fromEntries(uniqueIssueKeys.map(key=>{const value=knownNumber(row[key]);return [key,value!==null&&(!key.endsWith('Count')||value>=0&&Number.isSafeInteger(value))?value:null]})),coverage};
 }
 function workorderAttributedElsewhere(c){return Number(c?.diagnosticVersion)===5&&c.status==='attributed_elsewhere'&&c.diagnosisStatus==='attributed_elsewhere'&&c.attributedElsewhere===true&&c.complete===true&&c.needsReview===false;}
 function workorderNeedsReview(c){
  // Complete original-order coverage is not proof that raw report money agrees.
  if(Number(c?.diagnosticVersion)===5&&(c.needsReview===true||c.diagnosisStatus==='review_required'||(c.diagnosticDays||[]).some(day=>{const money=rawWorkorderAmountComparison(day,c);return money?.unexplainedDifferenceAmount!=null&&money.unexplainedDifferenceAmount!==0;})))return true;
  if(c?.complete===true)return false;
  // Only the explicit v5 diagnosis separates known collection policy from an
  // unresolved discrepancy. v4 absence is not an implied zero or confirmation.
  if(Number(c?.diagnosticVersion)===5&&c.needsReview===false&&c.diagnosisStatus==='explained_range_difference'&&c.sourceCoverage?.complete===true
    &&!['missingOrderNumberCount','missingAmountCount','amountConflictCount','providerConflictCount','unresolvedProviderOrderCount','unexplainedDetailMismatchCount'].some(k=>knownNumber(c[k])>0)
    &&!(c.diagnosticDays||[]).some(day=>day.expectedAvailable===false||['missingOrderNumberCount','missingAmountCount','amountConflictCount','providerConflictCount','unresolvedProviderOrderCount','unexplainedDetailMismatchCount'].some(k=>knownNumber(day[k])>0)
      ||rawWorkorderAmountComparison(day,c)?.unexplainedDifferenceAmount!=null&&rawWorkorderAmountComparison(day,c).unexplainedDifferenceAmount!==0))return false;
  return true;
 }
 function rawWorkorderAmountComparison(day,coverage){
  const r=day?.rawAmountComparison;
  if(Number(coverage?.diagnosticVersion??day?.diagnosticVersion)!==5||r?.basis!=='source_workorder_records')return null;
  const number=v=>typeof v==='number'||typeof v==='string'?knownNumber(v):null,nonnegative=v=>{const n=number(v);return n!==null&&n>=0?n:null},currency=v=>typeof v==='string'&&/^[A-Z0-9]{3,8}$/.test(v)?v:null;
  const expected=day.expectedAvailable===false?null:nonnegative(r.expectedAmount),detail=nonnegative(r.detailAmount),supplied=number(r.differenceAmount);
  const comparable=expected!==null&&detail!==null&&supplied!==null&&Math.abs((expected-detail)-supplied)<=1e-6;
  return {basis:r.basis,expectedAmount:expected,detailAmount:detail,differenceAmount:comparable?supplied:null,currency:currency(r.currency),
   pendingExcludedDifferenceAmount:comparable?nonnegative(r.pendingExcludedDifferenceAmount):null,
   pendingRangeNetDifferenceAmount:comparable?number(r.pendingRangeNetDifferenceAmount):null,amountComparisonStatus:r.amountComparisonStatus,
   excludedTypeDifferenceAmount:comparable?nonnegative(r.excludedTypeDifferenceAmount):null,
   excludedTypeAmount:nonnegative(r.excludedTypeAmount),excludedTypeCurrency:currency(r.excludedTypeCurrency),
   unexplainedDifferenceAmount:comparable?number(r.unexplainedDifferenceAmount):null};
 }
 function uniqueKycValue(facts,key){
  if(!facts)return null;
  const coverage=facts.coverage||{},unknown=knownNumber(coverage.kycUnknownOrderCount),matched=knownNumber(facts.uniqueNotReceivedKycCount);
  return (unknown!==0||coverage.complete!==true)&&!(matched>0)?null:knownNumber(facts[key]);
 }
 function buildRows({orders,issues,rates,country,direction,plus,combine,coverage}){
  const flow=(orders||[]).filter(r=>r.direction===direction).map(r=>({...r,provider:providerName(canonical(r.provider,country))}));
  const byIssue=new Map(),uniqueByIssue=new Map();for(const row of issues||[]){if(row.direction!==direction)continue;const name=providerName(canonical(row.provider,country)),item=byIssue.get(name)||Object.fromEntries(issueKeys.map(k=>[k,0]));for(const key of issueKeys)item[key]+=Number(row[key]||0);byIssue.set(name,item);if(!uniqueByIssue.has(name))uniqueByIssue.set(name,[]);uniqueByIssue.get(name).push(row)}
  const rows=combine(flow,['provider','currency']).map(row=>({...row,direction,sources:[...new Set(row.items.map(r=>r.source))],platforms:[...new Set(row.items.map(r=>r.platform))]}));
  for(const [provider] of byIssue)if(!rows.some(row=>row.provider===provider))rows.push({...plus([]),provider,direction,sources:[],platforms:[],items:[],created_success_count:0});
  for(const row of rows){
   const observed=(coverage?.platforms||[]).filter(p=>row.platforms.includes(p.platform)||row.platforms.includes(p.sourcePlatform));
   row.issues=issues==null||coverage?.capturedPlatformDays===0||(!byIssue.has(row.provider)&&observed.length&&observed.every(p=>p.days===0))?null:byIssue.get(row.provider)||Object.fromEntries(issueKeys.map(k=>[k,0]));
   row.uniqueOrders=uniqueWorkorderFacts(uniqueByIssue.get(row.provider));
   Object.assign(row,feeFacts(row.items,rates,country,Number(row.success_count||0)));
  }
  return rows;
 }
 // Resolve each original platform/provider leaf before merging across sources.
 // Applying one rate after a merge would misprice platform-specific and fixed fees.
 function feeFacts(items,rates,country,successCount){
  if(items.some(item=>item.success_count===null))return {estimated_fee:null,fee_matched_count:0,fee_issues:[],fee_exclusions:[],fee_eligible_count:null,fee_applicable_count:null,fee_excluded_count:0,fee_complete:false,fee_unknown:true,fee_rate_label:'成功时间口径未提供'};
  let matched=0,amount=0,excluded=0;const labels=new Set(),references=new Set(),issues=[],exclusions=[];
  for(const item of items){
   if(feeExempt(item.provider)){excluded+=Number(item.success_count||0);exclusions.push({provider:item.provider,count:Number(item.success_count||0)});continue}
   const localCountry=item.country||country,payout=item.direction==='withdraw';
   const fact=estimateFacts(item,rates,localCountry),unmatched=Math.max(0,Number(item.success_count||0)-fact.matched);
   if(unmatched)for(const gap of fact.issues||[{reason:fact.reason||'missing_rate',count:unmatched}])issues.push({provider:item.provider,platform:item.platform||'未提供平台',reason:gap.reason,count:gap.count});
   const candidates=fact.exemptOnly?[]:feeCandidates(item,rates,localCountry),values=new Map();
   for(const r of candidates){const parsed=parseFee(r[payout?'payoutFee':'collectFee'],r[payout?'payoutSingleFee':'collectSingleFee']);if(parsed)values.set(JSON.stringify(parsed),parsed);else values.set('unknown',null)}
   if(fact.label)labels.add(fact.label);
   const tier=tieredFeeRule(item,localCountry);
   if(fact.exemptOnly)references.add('免手续费');
   else if(tier)references.add(tier.label);
   else if(values.size===1&&!values.has('unknown')){const rule=[...values.values()][0];references.add((rule.percent*100).toFixed(2)+'%'+(rule.fixed?' + '+Number(rule.fixed.toFixed(8))+' / 笔':''))}
   else if(values.size>1)references.add('待核对费率');else references.add('未匹配');
   if(fact.amount!==null){matched+=fact.matched;amount+=fact.amount}
  }
  const eligible=Math.max(0,successCount-excluded),hasUnattributed=items.reduce((n,r)=>n+Number(r.success_count||0),0)<successCount;
  if(hasUnattributed){labels.add('未匹配');issues.push({provider:'未分配三方',platform:'未提供平台',reason:'missing_provider_breakdown',count:successCount-items.reduce((n,r)=>n+Number(r.success_count||0),0)})}
  const exemptOnly=items.length>0&&items.every(r=>feeExempt(r.provider))&&!hasUnattributed;
  return {estimated_fee:exemptOnly?null:matched>0?amount:successCount===0?0:null,fee_matched_count:matched,
   fee_issues:mergeFeeIssues(issues),fee_exclusions:mergeFeeIssues(exclusions),fee_eligible_count:eligible,fee_applicable_count:eligible,fee_excluded_count:excluded,fee_complete:matched===eligible,
   fee_rate_label:exemptOnly?'不适用':[...labels].sort().join(' / ')||'未匹配',
   fee_reference_label:exemptOnly?'不适用':[...references].sort().join(' / ')||'未匹配'};
 }
 function feeSummary(rows){
  const total=(rows||[]).reduce((s,r)=>{s.successCount+=Number(r.fee_eligible_count??r.success_count??0);s.excludedCount+=Number(r.fee_excluded_count||0);s.matchedCount+=Number(r.fee_matched_count||0);if(r.estimated_fee!=null)s.amount+=Number(r.estimated_fee);return s},{amount:0,matchedCount:0,successCount:0,excludedCount:0});
  total.issues=mergeFeeIssues((rows||[]).flatMap(r=>r.fee_issues||[]));total.exclusions=mergeFeeIssues((rows||[]).flatMap(r=>r.fee_exclusions||[]));
  total.complete=total.matchedCount===total.successCount;if(!total.matchedCount&&(total.successCount||total.excludedCount))total.amount=null;
  if((rows||[]).some(row=>row.fee_unknown||row.success_count===null)){total.amount=null;total.successCount=null;total.complete=false;total.fee_unknown=true}
  if(new Set((rows||[]).map(r=>r.currency).filter(Boolean)).size>1){total.amount=null;total.complete=false}
  return total;
 }
 const feeReasons={missing_fee_history:'订单创建时的费率版本或币种未确认',missing_provider:'未识别三方，无法匹配费率',missing_rate:'当前方向未找到可用费率',conflicting_rates:'同一适用范围存在不同费率',unsupported_rate:'原表费率为未支持的复杂规则',missing_success_amount:'成功金额未完整提供',missing_fee_bands:'逐笔金额分档未完整读取',unconfirmed_amount_band:'金额落在尚未确认费率的区间',invalid_success_amount:'成功金额缺失或不符合计费要求',missing_provider_breakdown:'成功订单缺少三方分组明细'};
 function mergeFeeIssues(rows){const map=new Map();for(const row of rows){if(!(Number(row.count)>0))continue;const key=JSON.stringify([row.provider,row.platform,row.reason]);if(!map.has(key))map.set(key,{...row,count:0});map.get(key).count+=Number(row.count)}return [...map.values()].sort((a,b)=>b.count-a.count)}
 function feeCoverageText(row){
  if(row.fee_unknown)return '成功时间口径未提供，不能计算手续费或完整匹配率';
  const eligible=Number(row.fee_eligible_count??row.successCount??row.success_count??0),excluded=Number(row.fee_excluded_count??row.excludedCount??0),matched=Number(row.fee_matched_count??row.matchedCount??0),issues=row.fee_issues||row.issues||[],exclusions=row.fee_exclusions||row.exclusions||[],count=n=>Number(n||0).toLocaleString('en-US');
  return '成功总笔数 '+count(eligible+excluded)+'；不计三方手续费 '+count(excluded)+'；应匹配 '+count(eligible)+'；已匹配 '+count(matched)+'；未匹配 '+count(Math.max(0,eligible-matched))+' 笔。'+
   (exclusions.length?'不计费：'+exclusions.map(x=>x.provider+' '+count(x.count)+' 笔').join('、')+'。':'')+
   (issues.length?'未匹配：'+issues.map(x=>(x.platform&&x.platform!=='未提供平台'?x.platform+' / ':'')+x.provider+' '+count(x.count)+' 笔（'+(feeReasons[x.reason]||'费率待核对')+'）').join('；')+'。':'')+'按订单创建时间匹配费率版本；未匹配部分不按零手续费计算。';
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
  const addIssue=(target,w)=>{if(!target.issues)target.issues=Object.fromEntries(issueKeys.map(k=>[k,0]));for(const k of issueKeys)target.issues[k]+=Number(w[k]||0);target._uniqueIssueRecords=(target._uniqueIssueRecords||[]).concat(w);target.uniqueOrders=uniqueWorkorderFacts(target._uniqueIssueRecords)};
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
  // A returned zero-order platform is still read. Provider rows and work-order
  // coverage are independent facts and must not define this query's scope.
  const key=p=>p?.id?'id:'+String(p.id).trim().toLowerCase():p?.name?JSON.stringify([p.source||'',p.country||'',p.name]):'';
  const expected=new Map(),returned=new Map(),failed=new Map();
  for(const p of L.queryPlatforms||[]){const id=key(p);if(id&&!expected.has(id))expected.set(id,p)}
  for(const result of L.results||[]){const id=key(result.platform);if(id)returned.set(id,result)}
  const failures=Array.isArray(L.queryFailures)&&L.queryFailures.length?L.queryFailures:(L.queryWarnings||[]).map(message=>({message}));
  const scoped=expected.size>0;
  if(!scoped)for(const [id,result] of returned)expected.set(id,result.platform);
  for(const [index,f] of failures.entries()){
   let id=key(f);
   if(scoped&&!f.id&&f.name){const matches=[...expected].filter(([,p])=>p.name===f.name&&(!f.source||p.source===f.source));if(matches.length===1)id=matches[0][0]}
   if(!scoped){id=id||'unknown-failure:'+index;if(!expected.has(id))expected.set(id,f)}
   if(expected.has(id)&&!returned.has(id))failed.set(id,f);
  }
  const platforms=[...expected].map(([id,p])=>{
   const result=returned.get(id),failure=failed.get(id),status=result?'received':failure?'failed':L.queryPaused?'paused':L.loading||L.queryRetrying?'loading':'not_read';
   const label={received:'已读取',failed:'读取失败',paused:'已暂停',loading:'读取中',not_read:'未读取'}[status];
   const message=result?'本次查询已返回':failure?(failure.message||'读取失败'):L.queryPaused?'切换页面后暂停，尚未完成读取':L.loading||L.queryRetrying?'正在读取，尚未返回':'本次查询尚未返回该平台';
   return {id:p.id||'',name:p.name||result?.platform?.name||p.id||'平台名称未提供',source:p.source||result?.platform?.source||'',status,label,message};
  });
  const missing=platforms.filter(p=>p.status!=='received'),received=platforms.length-missing.length;
  return {platforms,missing,failures:missing.filter(p=>p.status==='failed'),received,requested:platforms.length,
   partial:missing.length>0,empty:received===0&&platforms.length>0,pending:missing.filter(p=>p.status!=='failed').length};
 }
 const intakeStatusLabels={complete:'已核验完整',zero_complete:'零笔已确认',received:'已收到 · 完整性待核验',difference:'已收到 · 核验有差异',missing:'缺少创建数据',unverified:'待核验'};
 const intakeDifference=day=>day.expected!==false&&day.evidence!=='only_success_day_records_received'&&day.received===true&&day.complete!==true&&(['partial','failed'].includes(day.status)||['source_count_mismatch','source_created_count_mismatch','source_created_channel_mismatch','source_snapshot_invalid','completed_zero_conflicts_with_records'].includes(day.evidence));
 const intakeDatasetLabels={orders:'创建订单',collection_success:'成功数据快照',volume:'三方金额 / 笔数日报'};
 const intakeReasonLabels={only_success_day_records_received:'仅有该日成功记录，未见该创建日订单',records_received_completeness_unverified:'已收到创建记录，尚无整日收齐证明',no_order_records_received:'未收到该创建日订单',no_created_orders_received:'未收到该创建日订单',no_collection_run_evidence:'未见该日采集任务或创建记录',source_collection_failed:'采集任务失败',source_task_not_finished:'采集任务尚未完成',source_counts_not_verified:'来源总数尚未核对，不能确认收齐',no_daily_report_received:'未收到该日三方金额 / 笔数日报',source_count_mismatch:'采集笔数与源数据笔数不一致',source_created_counts_reconciled:'创建总数与渠道分组已核对',source_created_count_mismatch:'创建笔数与源总数不一致',source_created_channel_mismatch:'创建订单与渠道分组不一致',source_snapshot_invalid:'来源核对快照无效'};
 const intakeReason=row=>{
  const notes=row?.message?[row.message]:Array.isArray(row?.notes)?row.notes:row?.notes?[row.notes]:[];
  return [...new Set(notes.filter(Boolean).map(note=>intakeReasonLabels[note]||(/^[a-z]+(?:_[a-z]+)+$/.test(String(note))?'采集依据待核验':note)))].join('；')||(row?.evidence?intakeReasonLabels[row.evidence]||'采集依据待核验':'');
 };
 function intakeCoverage(L,direction){
  const query=queryCoverage(L),data=L.providerIntake,from=String(L.from||'').slice(0,10),to=String(L.to||'').slice(0,10);
  const scoped=!!data&&data.from===from&&data.to===to,ready=scoped&&data.status==='ready',index=new Map();
  if(scoped&&['ready','loading','error'].includes(data.status))for(const p of data.platforms||[]){const id=String(p.id||'').trim().toLowerCase();if(id)index.set(id,index.has(id)?null:p)}
  // Never infer intake from successful RPCs, nonzero success counts, or an
  // empty result. The source-day facts must belong to this submitted scope.
  const returned=new Map((L.results||[]).map(result=>[String(result.platform?.id||'').trim().toLowerCase(),result]));
  const platforms=query.platforms.map(platform=>{
   const result=returned.get(String(platform.id).trim().toLowerCase());
   const observedRows=(result?.groups?.provider||[]).filter(row=>!direction||row.direction===direction);
   const observedCreated=observedRows.some(row=>knownNumber(row.all_count)>0);
   const raw=scoped?index.get(String(platform.id).trim().toLowerCase()):null;
   const declaredMissing=raw&&Array.isArray(raw.missingDates)?[...new Set(raw.missingDates.filter(date=>typeof date==='string'&&date>=from&&date<=to))].sort():[];
   const days=raw&&Array.isArray(raw.days)?raw.days.filter(day=>day&&typeof day==='object'&&typeof day.date==='string'&&day.date>=from&&day.date<=to):[];
   const differenceDays=days.filter(intakeDifference),dates=declaredMissing.filter(date=>!differenceDays.some(day=>day.date===date));
   const sourceMissing=days.filter(day=>day.expected!==false&&(['not_received','not_started','missing'].includes(day.status)||day.evidence==='only_success_day_records_received'));
   for(const day of sourceMissing)if(!dates.includes(day.date))dates.push(day.date);dates.sort();
   const difference=differenceDays.length>0;
   const hasMissing=dates.length>0||raw?.status==='missing'&&!(difference&&declaredMissing.every(date=>differenceDays.some(day=>day.date===date)));
   const received=!hasMissing&&(!!raw&&raw.received===true&&['received','complete','zero_complete'].includes(raw.status)||difference&&days.filter(day=>day.expected!==false).every(day=>day.received===true||day.zeroConfirmed===true)||observedCreated);
   const observedOnly=received&&!difference&&(!raw||raw.received!==true);
   const complete=received&&raw?.complete===true&&['complete','zero_complete'].includes(raw.status)&&days.every(day=>day.expected===false||day.complete===true);
   const status=hasMissing?'missing':complete?raw.status:received?'received':'unverified';
   const message=observedOnly?'已读取到创建订单；整日完整性尚未核验':raw?intakeReason(raw)||(status==='missing'?'所选日期缺少创建数据':complete?'创建日数据已核验':received?'已收到创建数据，尚无整日收齐证明':'创建数据采集情况待核验'):
    !scoped?'当前查询的创建数据采集情况尚未核验':data.status==='loading'?'正在核对创建数据采集情况':data.status==='error'?data.error||'创建数据采集核验失败':'该平台的创建数据采集情况尚未核验';
   return {...platform,readStatus:platform.status,readLabel:platform.label,readMessage:platform.message,status,label:difference&&!hasMissing?intakeStatusLabels.difference:intakeStatusLabels[status],received,complete,difference,observedOnly,observedCreated,days,missingDates:dates,message};
  });
  const missing=platforms.filter(p=>p.status==='missing'),unverified=platforms.filter(p=>!p.complete),received=platforms.filter(p=>p.received).length,complete=platforms.filter(p=>p.complete).length;
  return {platforms,missing,unverified,received,complete,requested:query.requested,ready,active:!!data,partial:missing.length>0||platforms.some(p=>p.difference)||!!data&&(!ready||platforms.some(p=>!p.received)),from,to,error:scoped&&data.status==='error'?data.error||'采集核验失败':''};
 }
 // Intake status belongs in the compact platform card; detailed reasons open on demand.
 function intakeNotice(){return ''}
 function workorderGapReasons(coverage){
  const c=coverage||{},items=[];
  const add=(key,label,unit='条',distinct=false,informational=false)=>{const count=knownNumber(c[key]);if(count>0)items.push({key,count,label,unit,distinct,informational,text:count+unit+label})};
  add('missingOrderNumberCount','采集字段未提供原订单号');
  add('excludedWorkorderTypeCount','USDT工单类型未纳入原单统计');
  if(Number(c.diagnosticVersion)>=2||Object.hasOwn(c,'pendingExcludedDetailCount')){
   add('pendingExcludedDetailCount','待处理未纳入明细');
   add('unexplainedDetailMismatchCount','汇总与明细差异待核对');
  }else{
   const count=Math.max(Number(c.missingDetailCount)||0,Number(c.detailMismatchCount)||0);
   if(count>0)items.push({key:'unexplainedDetailMismatchCount',count,label:'汇总与明细差异待核对',unit:'条',text:count+'条汇总与明细差异待核对'});
  }
  add('missingAmountCount','金额缺失','条',true);add('amountConflictCount','金额冲突','组',true);
  add('providerConflictCount','三方冲突','组',true);add('unresolvedProviderOrderCount','原单三方未确认','组',true);
  add('resolvedProviderOrderCount','原单按唯一已知三方归并','组',true,true);add('unknownProviderRecordCount','来源三方未填写','条',true,true);
  return items;
 }
 function workorderPlatformGaps(L,direction){
  if(!L.workorders)return [];
  const scope=Array.isArray(L.queryPlatforms)&&L.queryPlatforms.length?L.queryPlatforms:(L.results||[]).map(r=>r.platform).filter(Boolean);
  const platforms=[...new Map(scope.map(p=>[p.id||JSON.stringify([p.country,p.source,p.name]),p])).values()],gaps=new Map();
  const names=p=>[p.name,p.platform,p.sourceName,p.source_name,p.sourcePlatform].filter(Boolean).map(name=>platformKey(name,p,L.country));
  const country=p=>normalized(root.HensemLiveReportData?.normalizeIdentity(p)?.country||p.country||L.country);
  const match=row=>{
   if(row.direction&&row.direction!==direction)return null;
   const rowNames=names(row),candidates=platforms.filter(p=>country(row)===country(p)&&
    (row.platformId?[p.id,...(p.aliasPlatformIds||[])].includes(row.platformId):
     (!row.source||normalized(row.source)===normalized(p.source))&&names(p).some(name=>rowNames.includes(name))));
   return candidates.length===1?candidates[0]:null;
  };
  const add=(row,reasons,coverage=null)=>{
   const platform=match(row);if(!platform)return;
   const id=platform.id||JSON.stringify([platform.country,platform.source,platform.name]);
   if(!gaps.has(id))gaps.set(id,{id:platform.id||'',name:platform.name||platform.sourceName||'未提供平台',source:platform.source||'',reasons:new Set(),providers:new Set(),reasonGroups:new Map(),details:[],sourceDays:[]});
   const gap=gaps.get(id);for(const reason of reasons)gap.reasons.add(reason);
   if(row.provider)gap.providers.add(providerName(canonical(row.provider,L.country)));
   if(coverage){
    const provider=providerName(canonical(row.provider,L.country)),items=workorderGapReasons(coverage);
    for(const item of items){const group=gap.reasonGroups.get(item.key)||{...item,count:0,providers:new Set()};group.count+=item.count;group.providers.add(provider);gap.reasonGroups.set(item.key,group)}
    gap.details.push({provider,sourceProvider:row.provider||provider,sourcePlatform:row.sourcePlatform||row.platform||gap.name,expected:knownNumber(row.submittedCount),received:knownNumber(coverage.detailCount),reasons:items.map(i=>i.text),coverage,days:(coverage.diagnosticDays||[]).filter(day=>!day.direction||day.direction===direction)});
   }else gap.sourceDays.push({days:knownNumber(row.days),expectedDays:knownNumber(row.expectedDays),missingDates:row.missingDates||[]});
  };
  for(const row of L.workorders.coverage?.platforms||[]){
   const days=knownNumber(row.days),expected=knownNumber(row.expectedDays);
   if(row.complete===false||days!==null&&expected!==null&&days<expected)add(row,[days!==null&&expected!==null?'工单日期已收 '+days+' / '+expected+' 天':'工单日期未收齐']);
  }
  for(const row of L.workorders.byPlatformProvider||[]){
   const coverage=row.uniqueCoverage;
   // A missing platform row alone is not proof of missing collection. Only
   // named date gaps or an explicit incomplete original-order fact qualify.
   if(row.direction!==direction||!coverage||coverage.complete===true&&!workorderNeedsReview(coverage))continue;
   const reasons=workorderGapReasons(coverage).filter(i=>!i.informational).map(i=>i.text),unknownLabel=unknownProviderNames.has(String(row.provider??'').trim()),hasDays=(coverage.diagnosticDays||[]).some(day=>!day.direction||day.direction===direction);
   add(row,unknownLabel&&!hasDays?['源标签为未标记三方；本标签原单归属明细未返回']:reasons.length?[]:['完整性待核验'],coverage);
  }
  // Include declared attribution facts from the same authorized platform even
  // when the resolved provider's own cohort is complete. These are separate
  // facts, never an inferred mapping from an unmarked source-label row.
  for(const row of L.workorders.byPlatformProvider||[]){
   const c=row.uniqueCoverage,platform=match(row);if(!c||!platform||!(Number(c.resolvedProviderOrderCount)>0||Number(c.unknownProviderRecordCount)>0))continue;
   const gap=gaps.get(platform.id||JSON.stringify([platform.country,platform.source,platform.name]));if(!gap)continue;
   (gap.attributionFacts||(gap.attributionFacts=[])).push({provider:providerName(canonical(row.provider,L.country)),resolved:knownNumber(c.resolvedProviderOrderCount),unknown:knownNumber(c.unknownProviderRecordCount),unresolved:knownNumber(c.unresolvedProviderOrderCount)});
  }
  return [...gaps.values()].map(gap=>({...gap,reasons:[...gap.reasons],providers:[...gap.providers],reasonGroups:[...gap.reasonGroups.values()].map(g=>({...g,providers:[...g.providers]}))}));
 }
 function workorderPlatformNeedsReview(p){
  if(p.sourceDays.length||!p.details.length)return true;
  if(p.details.some(d=>Number(d.coverage.diagnosticVersion)===5&&workorderNeedsReview(d.coverage)))return true;
  if(p.details.every(d=>Number(d.coverage.diagnosticVersion)===5))return false;
  const knownScope=new Set(['pendingExcludedDetailCount','excludedWorkorderTypeCount']);
  return p.reasons.length>0||!p.reasonGroups.length||p.reasonGroups.some(g=>!g.informational&&!knownScope.has(g.key))||p.details.some(d=>d.coverage.sourceCoverage?.complete===false||d.coverage.expectedAvailable===false||knownNumber(d.coverage.unexplainedDetailMismatchCount)===null&&(d.expected===null||d.received===null||d.expected!==d.received));
 }
 function readNotice(ctx){
  const {L,E,C}=ctx,c=queryCoverage(L);if(!c.partial)return '';
  const state=L.queryRetrying?'正在重试':L.loading?'读取中':L.queryPaused?'已暂停':'读取未完成';
  const detail=(c.empty?'本次尚无平台返回，数据暂不可用。':'仅显示已返回平台的部分结果。')+'已返回 '+c.received+' / '+c.requested+' 个平台；未返回平台不计入下方金额、笔数与占比，不代表零交易或未上传。'+(L.queryRetrying?'正在补读未完成平台，已返回数据保留。':'');
  return '<div class="provider-query-partial provider-status-actions" role="status" title="'+E(detail)+'"><button type="button" class="link" onclick="providerSummaryPlatformCoverage()">订单 '+C(c.received)+' / '+C(c.requested)+' · '+state+'</button>'+(c.failures.length&&typeof root.liveRetryFailed==='function'?'<button class="link" onclick="liveRetryFailed()" '+(L.queryRetrying||L.loading?'disabled':'')+'>'+(L.queryRetrying?'正在重试…':'只重试未完成平台')+'</button>':'')+'</div>';
 }
 function comparisonScope(L,direction){
  const empty=reason=>({reason,current:[],previous:[],count:0,label:'',detail:reason});
  if(L.comparisonStatus==='loading')return empty('昨日数据读取中…');
  if(L.comparisonStatus!=='ready')return empty(L.comparisonError||'昨日数据尚未读取');
  const period=root.HensemLiveCompare.windowFor(L.from,L.to,L.results?.[0]?.platform?.timezone,L.queryNow);
  if(!period.valid)return empty(period.error||'对比时段不可用');
  const query=queryCoverage(L),intake=intakeCoverage(L,direction);
  const priorIntake=intakeCoverage({...L,results:L.comparisonResults,from:period.previousFrom,to:period.previousTo,providerIntake:L.providerComparisonIntake},direction);
  const blocked=new Set([...intake.missing,...priorIntake.missing].map(p=>String(p.id).trim().toLowerCase()));
  const expected=new Set(query.platforms.map(p=>String(p.id).trim().toLowerCase()));
  const index=results=>{const map=new Map();for(const r of results||[]){const p=r.platform,id=String(p?.id||'').trim().toLowerCase();if(!id||!expected.has(id)||blocked.has(id)||!Array.isArray(r.groups?.provider))continue;map.set(id,map.has(id)?null:r)}return map};
  const a=index(L.results),b=index(L.comparisonResults),current=[],previous=[];
  for(const [id,r] of a){const prior=b.get(id);if(!r||!prior)continue;const p=r.platform,q=prior.platform;if(!p.currency||!p.timezone||!p.country||p.currency!==L.currency||p.country!==L.country||['country','currency','timezone','source'].some(k=>p[k]!==q[k]))continue;current.push(r);previous.push(prior)}
  if(!current.length)return empty('没有同范围的两期数据，暂不可比');
  const full=current.length===query.requested&&!query.partial&&intake.complete===intake.requested&&priorIntake.complete===priorIntake.requested;
  const names=current.map(r=>r.platform.name||r.platform.id).join('、');
  const label=full?'':(current.length<query.requested?'同范围 ':'按已读 ')+current.length+' 平台';
  return {reason:'',current,previous,count:current.length,label,detail:(full?'全部所选平台':'仅比较两期共同已读取的平台；完整性未确认的记录按已读结果计算')+'：'+names+(blocked.size?'；两期均剔除已确认缺少创建数据的平台':'')};
 }
 const scopedTotal=(ctx,rows,direction)=>ctx.successTimeSummary?ctx.successTimeSummary(rows,direction):ctx.plus(rows);
 const scopedFees=(ctx,rows,direction)=>{const fees=feeSummary(rows);return ctx.successTimeUnavailable?.(direction)?{...fees,amount:null,successCount:null,complete:false,fee_unknown:true}:fees;};
 function renderMetrics(ctx,direction,currentRows){
  const {L,E,N,C,R,plus,combine}=ctx,name=direction==='charge'?'代收':'代付',readState=queryCoverage(L),intake=intakeCoverage(L,direction),partial=readState.partial||intake.partial;
  const comparison=comparisonScope(L,direction),unavailable=comparison.reason;
  const previousOrders=comparison.previous.flatMap(x=>(x.groups?.provider||[]).map(r=>({...r,platformId:x.platform?.id,platform:x.platform?.name,source:x.platform?.source})));
  const previousRows=buildRows({orders:previousOrders,issues:null,rates:L.feeLookupRows,country:L.country,direction,plus,combine});
  const snapshot=rows=>({total:scopedTotal(ctx,rows,direction),fees:scopedFees(ctx,rows,direction),providers:new Set(rows.filter(r=>r.items?.length&&!['未识别通道','无三方（驳回）','未标记三方','人工确认','人工充值'].includes(r.provider)).map(r=>r.provider)).size,
   platforms:new Set(rows.flatMap(r=>r.items||[]).map(r=>r.platformId).filter(Boolean)).size});
  const comparableOrders=comparison.current.flatMap(x=>(x.groups?.provider||[]).map(r=>({...r,platformId:x.platform.id,platform:x.platform.name,source:x.platform.source})));
  const comparableRows=buildRows({orders:comparableOrders,issues:null,rates:L.feeLookupRows,country:L.country,direction,plus,combine});
  const current=snapshot(currentRows),compared=snapshot(comparableRows),previous=snapshot(previousRows);
  const range=root.HensemLiveCompare.windowFor(L.from,L.to,L.results?.[0]?.platform?.timezone,L.queryNow);
  const caption=(L.comparisonLabel||'较前一日同一时段').replace('较前一日同一时段','较昨日同期');
  const priorLabel=range.calendarDays>1?'前期':'昨日',signed=(value,format)=>(value>0?'+':value<0?'−':'')+format(Math.abs(value));
  const changes=(now,before,format,isRate=false,reason='',unit='')=>{
   const error=reason||unavailable;if(error)return {detail:error,text:reason?(L.feeLookupLoading?'费率读取中':L.feeLookupError?'费率读取失败':'费率未齐'):'',trend:'unknown'};
   if(isRate){const d=root.HensemLiveCompare.ratioDelta(compared.total.success_count,compared.total.all_count,previous.total.success_count,previous.total.all_count);
    return {detail:comparison.detail+'。'+priorLabel+' '+R(previous.total.success_count,previous.total.all_count)+' · '+caption+' '+(d.value===null?'暂无可比成功率':d.display),text:d.value===null?'暂无对比':d.display.replace(' 个百分点','个百分点'),trend:d.trend}}
   if(now==null||before==null||!Number.isFinite(Number(now))||!Number.isFinite(Number(before)))return {detail:'金额口径不完整，暂不可比',text:'暂无对比',trend:'unknown'};
   const d=root.HensemLiveCompare.delta(now,before);
   const absolute=signed(Number(now)-Number(before),format)+unit;
   return {detail:comparison.detail+'。'+priorLabel+' '+format(before)+unit+' · '+caption+' '+absolute+' · '+d.display,text:absolute+'（'+(d.display==='新增 / 无基数'?'无基数':d.display)+'）',trend:d.trend};
  };
  const fees=current.fees,feeReason=L.feeLookupLoading?'费率读取中…':L.feeLookupError?'费率读取失败，暂不可比':!compared.fees.complete||!previous.fees.complete?'费率未完全匹配，暂不比较':'';
  const cards=[
   {label:'统一三方',value:C(current.providers),change:changes(compared.providers,previous.providers,C,false,'',' 个'),tone:'neutral'},
   {label:'平台',platformCoverage:true,value:(intake.received||intake.requested>0&&intake.missing.length===intake.requested?C(intake.received):'—')+' / '+C(intake.requested),change:{detail:intake.platforms.map(p=>p.name+'：'+p.label+'，'+p.message).join('；'),text:'',trend:'unknown'},tone:partial?'warning':'neutral'},
   {label:name+'创建金额',value:N(current.total.all_amount),change:changes(compared.total.all_amount,previous.total.all_amount,N),tone:'neutral'},
   {label:name+'创建笔数',value:C(current.total.all_count),change:changes(compared.total.all_count,previous.total.all_count,C,false,'',' 笔'),tone:'neutral'},
   {label:name+'成功金额',value:N(current.total.success_amount),change:changes(compared.total.success_amount,previous.total.success_amount,N),tone:'amount'},
   {label:name+'成功笔数',value:C(current.total.success_count),change:changes(compared.total.success_count,previous.total.success_count,C,false,'',' 笔'),tone:'amount'},
   {label:name+'成功率',value:R(current.total.success_count,current.total.all_count),change:changes(null,null,null,true),tone:'rate'},
   {label:'估算手续费',value:N(fees.amount),badge:!fees.complete?'部分':'',change:changes(compared.fees.amount,previous.fees.amount,N,false,feeReason),tone:'fee'}
  ];
  if(partial)for(const card of cards){if(!card.platformCoverage){if(readState.empty)card.value='—'}}
  const unseen=intake.platforms.filter(p=>p.readStatus==='received'&&!p.received&&!p.complete&&!intake.missing.includes(p));
  const names=items=>items.map(p=>p.name).join('、');
  const platformText=intake.missing.length?'缺 '+names(intake.missing):readState.partial?'未读 '+names(readState.missing):unseen.length?'未见创建 '+names(unseen):intake.complete!==intake.requested?'完整性待核验':'查看平台';
  return '<div class="provider-summary-kpis">'+cards.map(c=>'<div class="provider-kpi provider-kpi-'+c.tone+'" title="'+E(c.change.detail)+'"><div class="provider-kpi-value"><label>'+c.label+(c.badge?'<span class="provider-partial">'+c.badge+'</span>':'')+'</label><strong>'+c.value+'</strong></div><div class="provider-kpi-comparison">'+(c.platformCoverage?'<button type="button" class="link provider-platform-coverage-button" onclick="providerSummaryPlatformCoverage()" title="'+E(platformText+(intake.error?'；'+intake.error:'')+'；点击查看采集与接口读取明细')+'">'+E(platformText)+'</button>':'')+(c.change.text?'<span class="provider-kpi-change '+E(c.change.trend)+'">'+E(c.change.text)+'</span>':'')+'</div></div>').join('')+'</div>'+
   '<div class="provider-comparison-context"><span title="'+E(unavailable||comparison.detail+'；悬停卡片查看原值与差额')+'">'+(unavailable?E(L.comparisonStatus==='loading'?'对比读取中':'对比暂不可用'):E((range.calendarDays>1?'较前期':'较昨日')+(comparison.label?' · '+comparison.label:'')))+'</span><span tabindex="0" title="'+E(L.feeLookupLoading?'正在读取费率':L.feeLookupError?'费率读取失败':feeCoverageText(fees))+'">手续费已匹配 '+C(fees.matchedCount)+' / '+C(fees.successCount)+' 笔</span></div>';
 }
 function render(ctx,direction){
  const {L,E,N,C,R,plus,combine,groupRows,box,table,pager,submissionAnalysis,feeForRow,ensureFeeLookup,providerCell,openDrawer}=ctx,name=direction==='charge'?'代收':'代付',issueLabel=direction==='charge'?'存款未到账':'取款未到账';
  if(L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)ensureFeeLookup();
  const orderRows=groupRows('provider');let rows=buildRows({orders:orderRows,issues:L.workorders?.byProvider||null,rates:L.feeLookupRows,country:L.country,direction,plus,combine,coverage:L.workorders?.coverage});
  const total=scopedTotal(ctx,rows,direction),fees=scopedFees(ctx,rows,direction),knownFee=fees.amount||0,readState=queryCoverage(L),intake=intakeCoverage(L,direction),partial=readState.partial||intake.partial;
  const submissionIds=r=>r._submissionIds||[...new Set((r.items||[]).map(x=>x.platformId).filter(Boolean))];
  const submissionFact=r=>{const m=submissionAnalysis?.metric(r._submissionTotal?null:r.provider,submissionIds(r));return m?.complete?m:null};
  const submissionCells=r=>['rate','members','count'].map(kind=>r._submissionUnavailable?'—':submissionAnalysis?.providerCell(r._submissionTotal?null:r.provider,submissionIds(r),kind,r.success_count,r.all_count)||'—');
  const sortValues={provider:r=>sortText(r.provider),platform_count:r=>r.platforms?.length??null,platform:r=>sortText(r.platform),source:r=>sortText(r.source),
   type:r=>{const type=providerType(r,L.feeLookupRows,L.country);return L.feeLookupLoading||L.feeLookupError||type.state==='review'?null:sortText(type.label)},
   all_amount:r=>knownNumber(r.all_amount),invalid_members:r=>submissionFact(r)?.member_count??null,invalid_count:r=>submissionFact(r)?.invalid_count??null,adjusted_rate:r=>{const fact=submissionFact(r);return fact?fraction(r.success_count,Number(r.all_count)-fact.invalid_count):null},success_amount:r=>knownNumber(r.success_amount),success_count:r=>knownNumber(r.success_count),all_count:r=>knownNumber(r.all_count),
   success_rate:r=>fraction(r.success_count,r.all_count),amount_share:r=>fraction(r.success_amount,total.success_amount),count_share:r=>fraction(r.success_count,total.success_count),
   pending_amount:r=>knownNumber(r.pending_amount),pending_count:r=>knownNumber(r.pending_count),fee_rate:feeSortValue,estimated_fee:r=>knownNumber(r.estimated_fee),fee_share:r=>fraction(r.estimated_fee,knownFee),
   ...Object.fromEntries(issueKeys.map(key=>['issue_'+key,r=>knownNumber(r.uniqueOrders?.[displayedIssueKeys[key]])])),...Object.fromEntries(kycIssueKeys.map(key=>['issue_'+key,r=>uniqueKycValue(r.uniqueOrders,key)])),issue_success_rate:r=>fraction(r.uniqueOrders?.uniqueSuccessCount,r.uniqueOrders?.uniqueOrderCount)};
  const parentKeys=new Set(['provider','platform_count','type','all_amount','invalid_members','invalid_count','adjusted_rate','success_amount','success_count','all_count','success_rate','amount_share','count_share','pending_amount','pending_count','fee_rate','estimated_fee','fee_share',...issueKeys.map(key=>'issue_'+key),...(direction==='charge'?kycIssueKeys.map(key=>'issue_'+key):[]),'issue_success_rate']);
  const sort=parentKeys.has(L.providerSort)?L.providerSort:'success_amount';
  rows=sortedRows(rows,sortValues[sort],!!L.providerSortAsc);
  const max=Math.max(1,Math.ceil(rows.length/L.localSize));L.localPage=Math.min(L.localPage,max);const shown=rows.slice((L.localPage-1)*L.localSize,L.localPage*L.localSize);
  const textSortKeys=new Set(['provider','platform','source','type']);
  root.providerSummaryPlatformCoverage=function(){
   if(L.dirty)return;
   const query=queryCoverage(L),coverage=intakeCoverage(L,direction),platforms=coverage.platforms.slice().sort((a,b)=>Number(a.complete)-Number(b.complete)||Number(a.received)-Number(b.received)||a.name.localeCompare(b.name));
   const detailRows=platforms.flatMap(p=>{
    let days=p.days;
    if(!days.length)days=(p.missingDates.length?p.missingDates:[coverage.from===coverage.to?coverage.from:coverage.from+' 至 '+coverage.to]).map(date=>({date,dataset:'orders',status:p.status,message:p.message}));
    return days.map(day=>{
     const status=day.evidence==='only_success_day_records_received'?'缺少创建数据':day.status==='not_expected'?'接入前 · 不计缺失':day.complete===true?(day.zeroConfirmed===true?'零笔已确认':'已核验完整'):['not_received','not_started','missing'].includes(day.status)?'缺少创建数据':intakeDifference(day)?'已收到 · 核验有差异':day.status==='failed'?'采集失败':day.status==='pending'?'采集中':day.received===true||day.status==='received'?'已收到 · 完整性待核验':intakeStatusLabels[day.status]||'待核验';
     const type=intakeDatasetLabels[day.dataset||day.dataType]||day.dataset||day.dataType||'创建订单';
     return [E(p.name),E(p.source||'—'),E(day.date),E((day.direction?({charge:'代收',withdraw:'代付'}[day.direction]||day.direction)+' · ':'')+type),E(status),E(intakeReason(day)||p.message)];
    });
   });
   openDrawer('平台采集与读取情况',(coverage.error?'<p>'+E(coverage.error)+'</p>':'')+'<p>创建数据 '+(coverage.ready||coverage.received?C(coverage.received):'待核验')+' / '+C(coverage.requested)+' 个平台 · 完整性已核验 '+C(coverage.complete)+' 个 · 待核验 '+C(coverage.unverified.length)+' 个'+(coverage.missing.length?' · 缺少创建数据 '+C(coverage.missing.length)+' 平台':'')+'</p>'+table(['平台','包网','日期','数据类型','采集状态','原因'],detailRows)+box('接口读取状态',table(['平台','包网','读取状态','原因'],query.platforms.map(p=>[E(p.name),E(p.source||'—'),E(p.label),E(p.message)])))+'<p class="live-definition">按本次查询所选平台及创建日期逐日核对。返回零订单也计为已读取，但只有源数据明确确认零笔才算零笔已确认；仅有成功日记录不能补齐创建日订单。完整性仍待核验的平台不标记为已齐；工单原单缺项另行核对。</p>');
  };
  root.providerSummaryWorkorderPlatforms=function(){
   if(L.dirty)return;
   const gaps=workorderPlatformGaps(L,direction);
   const count=value=>knownNumber(value)===null?'未提供':C(value),period=String(L.from||'').slice(0,10)+' 至 '+String(L.to||'').slice(0,10),business=direction==='charge'?'存款':'取款';
   const sum=(items,key)=>!items.length||items.some(d=>knownNumber(d[key])===null)?null:items.reduce((n,d)=>n+Number(d[key]),0);
   const difference=(expected,received)=>expected===null||received===null?null:expected-received;
   const differenceText=value=>value===null?'无法比较':(value>0?'+':'')+C(value)+(value>0?' · 汇总多 '+C(value):value<0?' · 明细多 '+C(-value):' · 数量一致');
   const money=(value,currency)=>value===null?'未提供':N(value)+' '+(currency||'（币种未提供）');
   const amountCell=(day,coverage)=>{const a=rawWorkorderAmountComparison(day,coverage);return a?'<div>日报 '+E(money(a.expectedAmount,a.currency))+'</div><div>明细 '+E(money(a.detailAmount,a.currency))+'</div><small class="cell-sub">净差 '+E(a.differenceAmount===null?'无法比较':(a.differenceAmount>0?'+':'')+money(a.differenceAmount,a.currency))+'</small>':'<span>未提供</span><small class="cell-sub">未接入金额诊断</small>';};
   const needsConfirmation=workorderPlatformNeedsReview;
   const isUnmarkedDetail=d=>unknownProviderNames.has(String(d.sourceProvider??d.provider??'').trim())&&!d.days.length;
   const explanation=(day,d)=>{
    const notes=[],pending=knownNumber(day.pendingExcludedDetailCount),unexplained=knownNumber(day.unexplainedDetailMismatchCount),excluded=knownNumber(day.excludedWorkorderTypeCount);
    if(pending>0)notes.push('已知范围差异：数量差额中有 '+C(pending)+' 条与待处理数一致，采集器跳过待处理；这是数量解释，不代表已逐笔匹配。');
    if(excluded>0)notes.push('已知范围差异：'+C(excluded)+'条USDT工单类型未纳入原单统计，记录已采集；请单独核对 USDT 类型，不要重复补采。');
    if(unexplained>0)notes.push('待确认：还有 '+C(unexplained)+' 条差异未被现有原因解释，可能涉及范围或同步时点；尚不能认定为源后台漏单。');
    const amount=rawWorkorderAmountComparison(day,d.coverage);
    if(amount){
     notes.push('金额口径：日报与明细的原始工单记录金额，可含同一原单重复提交；不是去重原支付订单金额。');
     if(amount.pendingRangeNetDifferenceAmount!==null&&pending>0)notes.push('范围净差 '+money(amount.pendingRangeNetDifferenceAmount,amount.currency)+'；待处理笔数已对上，金额尚待逐笔核对。');
     else if(amount.pendingExcludedDifferenceAmount!==null&&pending>0)notes.push('待处理范围金额净差 '+money(amount.pendingExcludedDifferenceAmount,amount.currency)+'；尚未逐笔核对。');
     if(amount.excludedTypeDifferenceAmount!==null&&excluded>0)notes.push('USDT 类型范围解释的金额差额 '+money(amount.excludedTypeDifferenceAmount,amount.currency)+'；此类型与原单统计分开。');
     if(amount.excludedTypeAmount!==null&&excluded>0)notes.push('已采集 USDT 类型记录金额 '+money(amount.excludedTypeAmount,amount.excludedTypeCurrency)+'；币种不明确时不得并入其他币种金额。');
     if(amount.unexplainedDifferenceAmount!==null&&amount.unexplainedDifferenceAmount!==0)notes.push('待确认：未解释金额净差 '+(amount.unexplainedDifferenceAmount>0?'+':'')+money(amount.unexplainedDifferenceAmount,amount.currency)+'，即使条数相同也要核对原始金额。');
     if(amount.differenceAmount===null)notes.push('金额证据未齐，净差无法比较；缺失金额或币种不以 0 或当前页面币种代替。');
     else if(!amount.currency)notes.push('金额币种未提供，以上数值仅作本项来源记录对比，不计入当前页面币种合计。');
    }else notes.push('接口尚未提供原始工单金额差异，金额保持未提供，不用去重原单金额代算。');
    if(day.expectedAvailable===false)notes.push('未收到该日日报，不能把汇总当作 0；先核对这天的日报采集。');
    if(Number(day.missingOrderNumberCount)>0)notes.push('待确认：'+C(day.missingOrderNumberCount)+'条采集字段未提供原订单号，影响按原支付订单去重。请查看源记录的原订单引用字段。');
    if(Number(day.missingAmountCount)>0||Number(day.amountConflictCount)>0)notes.push('待确认：'+workorderGapReasons(day).filter(i=>['missingAmountCount','amountConflictCount'].includes(i.key)).map(i=>C(i.count)+i.unit+i.label).join('；')+'。请按原支付订单号核对记录金额，不能以 0 代替。');
    if(Number(day.providerConflictCount)>0||Number(day.unresolvedProviderOrderCount)>0)notes.push('待确认：'+workorderGapReasons(day).filter(i=>['providerConflictCount','unresolvedProviderOrderCount'].includes(i.key)).map(i=>C(i.count)+i.unit+i.label).join('；')+'。请核对同一原支付订单的三方字段。');
    if(Number(day.resolvedProviderOrderCount)>0)notes.push('已归并：'+C(day.resolvedProviderOrderCount)+'组原单的其他已采集工单提供了唯一已知三方，已按该三方归并；这不是三方冲突，也不表示每条源工单都填写了三方。');
    if(Number(day.unknownProviderRecordCount)>0)notes.push('源字段未填写：'+C(day.unknownProviderRecordCount)+'条已采集记录的来源三方为空或未标记；记录可能已随同一原单归并，也可能仍待确认，不能仅凭此字段判断漏采或未入库。');
    if(isUnmarkedDetail(d))notes.push('源标签为未标记三方；本标签原单归属明细未返回。源标签汇总不等于原单归属；数量相符不能确定最终归属，已归并原单请查看本平台已知三方分项。');
    if(unexplained===null&&difference(knownNumber(day.expectedCount),knownNumber(day.detailCount))!==0)notes.push('接口尚未提供未解释差异的拆分，不能将总差额全部归为缺单。');
    return notes.length?notes:['数量差额不能说明所有字段已齐；原单去重完整性仍以已返回诊断为准。'];
   };
   const rowsFor=p=>p.details.flatMap(d=>(d.days.length?d.days:[{...d.coverage,expectedCount:d.expected,detailCount:d.received}]).map(day=>({d,day})));
   const sourceInstructions=(p,d,day)=>'源后台 '+p.source+' → '+(d.sourcePlatform||p.name)+' → '+business+'未到账工单；提交日期 '+(day.date||period)+(isUnmarkedDetail(d)?'；先选全部三方、全部状态，从逐笔工单取得完整原支付订单号，再按完整原单号查看同单工单的三方字段。不要仅筛选未标记三方，以免隐藏同单的已知三方记录。此汇总不返回原单号，不能指定是哪张原单。':'；三方 '+(day.provider||d.sourceProvider||d.provider)+'；先选全部状态对比，再筛待处理。');
   const platformCards=gaps.map(p=>{
    const expected=sum(p.details,'expected'),received=sum(p.details,'received'),confirm=needsConfirmation(p),reasons=[...p.reasons,...p.reasonGroups.map(g=>g.distinct?g.label+' · 涉及 '+C(g.providers.length)+' 个三方（分项见明细）':C(g.count)+g.unit+g.label)];
    const dates=[...new Set(p.sourceDays.flatMap(row=>row.missingDates))].sort();
    const daily=rowsFor(p).sort((a,b)=>String(a.day.date||'').localeCompare(String(b.day.date||''))||a.d.provider.localeCompare(b.d.provider)).map(({d,day})=>{
     const expected=day.expectedAvailable===false?null:knownNumber(day.expectedCount),received=knownNumber(day.detailCount),date=day.date||'期间汇总（未提供每日拆分）',diff=difference(expected,received);
     return [E(d.provider)+'<small class="cell-sub">'+E(date)+'</small>',day.expectedAvailable===false?'未收到':count(expected),count(received),E(differenceText(diff)),count(day.pendingExcludedDetailCount),count(day.unexplainedDetailMismatchCount),amountCell(day,d.coverage),'<div class="provider-workorder-day-context">'+E('汇总 '+count(expected)+' / 明细 '+count(received))+'</div>'+explanation(day,d).map(text=>'<p>'+E(text)+'</p>').join('')+'<p class="provider-workorder-next"><strong>下一步：</strong>'+E(sourceInstructions(p,d,day))+'</p>'];
    });
    const attribution=(p.attributionFacts||[]).length?'<div class="provider-workorder-attribution"><p><strong>本平台已返回的原单归属诊断：</strong>以下为各三方分项，不能据此把“未标记三方”汇总行直接归给某一家；源标签汇总与按原单归并后的分项范围不同。同一条来源未标记记录可能关联多个冲突三方分项，各分项数量不能直接相加。</p>'+table(['原单三方分项','已按唯一已知三方归并（原单组）','来源三方未填写（记录条）','原单三方仍未确认（组）'],p.attributionFacts.map(f=>[E(f.provider),count(f.resolved),count(f.unknown),count(f.unresolved)]),'provider-workorder-attribution-table')+'</div>':'';
    return '<details class="provider-workorder-details"><summary><span class="provider-workorder-platform"><strong>'+E(p.name)+'</strong><small>'+E(p.source||'包网未提供')+'</small><em class="'+(confirm?'needs-confirmation':'known-scope')+'">'+(confirm?'含待确认项':'已知范围差异')+'</em></span><span class="provider-workorder-counts"><small>所列差异三方小计 · 非全平台</small><span>汇总 <b>'+count(expected)+'</b> / 明细 <b>'+count(received)+'</b></span><span>净差（汇总 − 明细）<b>'+E(differenceText(difference(expected,received)))+'</b></span></span><span class="provider-workorder-reasons">'+reasons.map(text=>'<span>'+E(text)+'</span>').join('')+'</span><span class="provider-workorder-expand">展开每日核对</span></summary><div class="provider-workorder-platform-body"><p class="provider-workorder-providers">涉及三方：'+E(p.providers.join('、')||'未提供')+'</p>'+(p.reasonGroups.some(g=>g.key==='excludedWorkorderTypeCount')?'<p>USDT 记录已采集，但此类型当前未纳入原单统计；无需将已采集记录重复补采。</p>':'')+(p.sourceDays.length?'<p>'+E('日期覆盖：'+(dates.length?'未收齐 '+dates.join('、'):'尚未提供具体缺少日期；不能指定缺少哪一天。'))+'</p>':'')+(daily.length?table(['三方 / 提交日期','日报汇总','已采集明细','差额（汇总 − 明细）','已知待处理跳过','未解释差异（条）','原始工单金额对比','原因含义与下一步'],daily,'provider-workorder-day-table'):'<p>尚无三方逐日诊断。请在源后台按 '+E(p.name+' · '+business+' · '+(dates.join('、')||period))+' 检查日报及对应日期的同步结果，不能将未知数量当作 0。</p>')+attribution+'</div></details>';
   }).join('');
   const confirms=gaps.filter(needsConfirmation).length;
   openDrawer('工单统计差异说明','<div class="provider-workorder-gap-intro"><p><strong>'+E(L.country+' · '+name+' · 工单提交日期 '+period)+'</strong></p><p>'+C(gaps.length)+' 个平台存在统计差异：'+C(gaps.length-confirms)+' 个仅有已知范围差异，'+C(confirms)+' 个含待确认项。已知原因不等于统计已完整。</p><p>这里只影响工单提交、成功、未到账及工单成功率；代收／代付订单金额、笔数和刷单剔除另行计算。</p><p>差额 = 日报汇总 − 已采集明细。正数表示汇总较多，负数表示明细较多；未解释差异是扣除已知原因后的差异条数，不表示已确认缺单。不同三方、日期的正负差额可能抵消。</p></div><div class="provider-workorder-gap-table">'+platformCards+'</div><div class="provider-workorder-gap-help"><p><strong>如何查已采集记录：</strong>AR 来源可在工单运营中心 → 工单未到账，选择上述国家、平台、提交日期、'+business+'业务和全部状态，查看原支付订单及其工单明细。此页按原订单去重，不能直接用列表行数与日报原始工单条数比较；三方和待处理仍需在源后台同条件核对。NEWAR（含 DHANIWIN 的 USDT 类型）请到对应源后台核对；当前“工单未到账”入口尚未提供这些 NEWAR 明细，不能用该入口的空结果认定未采集。</p><p><strong>定位限制：</strong>汇总无逐笔号，不能指定缺失哪张工单。当前诊断只能定位到平台、三方、日期与字段原因；未确认差异不能自动补单，已有统计不会因此改为完整。</p></div>');
  };
  root.providerSummarySort=function(key){if(!parentKeys.has(key))return;L.providerSortAsc=sort===key?!L.providerSortAsc:textSortKeys.has(key);L.providerSort=key;L.localPage=1;ctx.render()};
  const expanded=L.providerExpanded||(L.providerExpanded={}),rowKey=r=>JSON.stringify([direction,r.provider,r.currency]);
  root.providerSummaryToggle=function(index){const row=shown[index];if(!row)return;expanded[rowKey(row)]=!expanded[rowKey(row)];ctx.render()};
  root.providerSummaryPlatformSort=function(index,key){const row=shown[index];if(!row||!Object.hasOwn(sortValues,key))return;const id='sort:'+rowKey(row),before=expanded[id];expanded[id]={key,ascending:before?.key===key?!before.ascending:textSortKeys.has(key)};ctx.render()};
  // Source work-order aggregates have no order IDs. Reuse the loaded platform
  // cohorts instead of sending these rows to the transaction-order explorer.
  const issueOnly=row=>!row.items?.length&&row.issues!=null;
  const issueLabelFor=row=>unknownProviderNames.has(String(row.provider??'').trim())?'三方未填写（源工单）':row.provider+'（源工单）';
  root.providerSummaryOrders=function(index,platformId=''){const row=shown[index];if(!row||issueOnly(row)||platformId&&!row.items.some(r=>r.platformId===platformId))return;root.liveProviderOrders?.(row.provider,'',direction,platformId)};
  const providerLabel=(row,index)=>(issueOnly(row)?'<button class="link" aria-expanded="'+!!expanded[rowKey(row)]+'" title="展开已读取的平台工单汇总；此汇总接口不提供工单号" onclick="providerSummaryToggle('+index+')">'+E(issueLabelFor(row))+'</button><small class="cell-sub">仅工单汇总</small>':providerCell(row)+(String(row.provider).trim().toUpperCase()==='USDT'?'<small class="cell-sub"><button class="link" title="查看原始通道、类型与逐笔订单；USDT不代表已确认支付商" onclick="providerSummaryOrders('+index+')">原始通道 / 订单</button></small>':''))+(workorderAttributedElsewhere(row.uniqueOrders?.coverage)?'<small class="cell-sub" title="'+E('该来源标签的 '+(knownNumber(row.uniqueOrders.coverage.attributedElsewhereDetailCount)===null?'已采集':C(row.uniqueOrders.coverage.attributedElsewhereDetailCount))+' 条记录已按唯一已知三方归并；此标签不重复增加原单笔数和金额。')+'">已归并来源标签</small>':'');
  const workorderBasis='工单提交、成功、未到账六列统一按原存款订单号在所选期间去重，同一原订单只保留1条；取款未到账同样适用。工单未到账为去重提交减去重成功，不等于仍在等待到账。原订单号缺失时显示 —；覆盖不完整统一提示，缺失部分不按0计算。';
  const tierExplanation=tier=>'已确认：按每笔成功金额分档估算。'+tier.label+'。2,000 < 金额 < 2,001 的记录待核对，不计入已匹配笔数。';
  const displayedRate=(row,original)=>{if(row.fee_reference_label==='免手续费')return '免手续费';const tier=tieredFeeRule(row,L.country);return tier?tierExplanation(tier):original};
  root.providerSummaryRate=function(index){
   const row=shown[index];if(!row)return;const tier=tieredFeeRule(row,L.country),rule=confirmedFeeRule(row,L.country),records=rateRecords(row,L.feeLookupRows,L.country),used=new Set(row.items.flatMap(r=>feeCandidates(r,L.feeLookupRows,L.country)));
   const relevant=records.filter(r=>r.scopeType!=='platform'||row.items.some(item=>platformKey(item.platform,item,L.country)===platformKey(r.platform,item,L.country)));
   const coverageNote='<p class="live-definition">'+E(feeCoverageText(row))+'</p>';
   const sourceTable=table(['使用情况','来源表 / 行','原表三方','范围','业务类型','通道类型','代收','代收单笔','代付','代付单笔','原状态'],relevant.map(r=>[tier?'原表参考':used.has(r)?'当前匹配':'未采用',E((r.sheetName||'未提供')+' / '+(r.sourceRow??'—')),E(r.sourceTypeProvider||r.provider||'—'),E(r.platform||r.country||r.scopeGroup),providerTypeCell(row,[r],L.country,E),E(r.category||'—'),E(r.collectFee||'—'),E(r.collectSingleFee||'—'),E(r.payoutFee||'—'),E(r.payoutSingleFee||'—'),E(r.status||r.rawStatus||'—')]),'provider-rate-details');
   openDrawer(row.provider+' · 费率依据',coverageNote+(tier
    ?box('当前确认规则','<p class="live-definition">'+E(tierExplanation(tier))+'</p>')+box('原表费率记录',sourceTable)
    :box('当前匹配规则','<p class="live-definition">'+E(rule?.note||'优先匹配有费率内容的平台专属记录，再匹配国家记录。存在不同费率时，保留差异供核对。')+'</p>'+sourceTable)));
  };
  const columns=[['统一三方','provider'],['平台','platform_count'],['类型','type'],['全部金额','all_amount'],['全部笔数','all_count'],['成功金额','success_amount'],['成功笔数','success_count'],['金额占比','amount_share'],['笔数占比','count_share'],['成功率','success_rate'],...(direction==='charge'?[['剔除后成功率','adjusted_rate'],['无充值人数','invalid_members'],['无效笔数','invalid_count']]:[]),...(direction==='withdraw'?[['代付中金额','pending_amount'],['代付中笔数','pending_count']]:[]),['当前参考费率','fee_rate'],['估算手续费','estimated_fee'],['手续费占比','fee_share'],
   ['工单提交金额','issue_submittedAmount'],['工单提交笔数','issue_submittedCount'],['工单成功金额','issue_successAmount'],['工单成功笔数','issue_successCount'],['工单未到账金额','issue_notReceivedAmount'],['工单未到账笔数','issue_notReceivedCount'],...(direction==='charge'?[['未到账KYC匹配笔数','issue_uniqueNotReceivedKycCount'],['未到账KYC匹配金额','issue_uniqueNotReceivedKycAmount']]:[]),['工单成功率','issue_success_rate'],['平台明细',null]];
  const header=(text,key,active=sort,ascending=!!L.providerSortAsc,index=null)=>{if(!key)return E(text);const next=active===key?!ascending:textSortKeys.has(key),basis=key==='fee_rate'?'按百分比、单笔费依次排序；多档或未匹配置后。':key.startsWith('issue_')?'按原订单号去重后的工单数据排序。':'';return '<button class="link provider-sort-heading" title="'+E(basis+'点击按'+text+(next?'升序':'降序')+'排列；空值置后')+'" onclick="'+(index===null?'providerSummarySort(\''+key+'\')':'providerSummaryPlatformSort('+index+',\''+key+'\')')+'">'+E(text).replace(/(金额|笔数)$/, '<span class="provider-heading-unit">$1</span>')+' <span class="provider-sort-arrow" aria-hidden="true">'+(active===key?(ascending?'↑':'↓'):'↕')+'</span></button>'};
  const headers=columns.map(([text,key])=>header(text,key));
  // Short identity columns leave the same readable width for every amount,
  // count and ratio. Fee totals reserve space for their coverage badge.
  const columnWidth=key=>key==='provider'?94:key==='platform_count'?40:key==='type'?62:key==='fee_rate'?88:key===null?54:key==='estimated_fee'?108:kycIssueKeys.some(k=>key==='issue_'+k)?108:key.endsWith('_amount')||key.endsWith('Amount')?98:key.endsWith('_count')||key.endsWith('Count')?70:70;
  const widths=columns.map(([,key])=>columnWidth(key)),tableWidth=widths.reduce((sum,width)=>sum+width,0);
  const rateButton=(value,index)=>{const full=String(value||'未匹配'),long=full.length>24||/[\r\n]/.test(full),label=long?(/以上|以下|分档|阶梯|[≥≤<>]/.test(full)?'分档费率 · 查看':'费率详情 · 查看'):full;return '<button class="link provider-fee-preview" title="'+E(full+' · 点击查看来源及匹配依据')+'" aria-label="'+E('费率：'+full+'，查看来源及匹配依据')+'" onclick="providerSummaryRate('+index+')">'+E(label)+'</button>'};
  const feeCell=r=>readState.empty?'—':L.feeLookupLoading?'读取中…':L.feeLookupError?'读取失败':'<span tabindex="0" title="'+E(feeCoverageText(r))+'">'+N(r.estimated_fee)+(!r.fee_complete&&Number(r.fee_eligible_count)>0?'<span class="provider-partial">'+(Number(r.fee_matched_count)>0?'部分':'未匹配')+'</span>':'')+'</span>';
  const issueRate=w=>!w?'—':'<span'+(Number(w.uniqueOrderCount)>0&&Number(w.uniqueSuccessCount)/Number(w.uniqueOrderCount)<0.3?' class="workorder-rate-low"':'')+' title="去重工单金额成功率 '+R(w.uniqueSuccessAmount,w.uniqueOrderAmount)+'">'+R(w.uniqueSuccessCount,w.uniqueOrderCount)+'</span>';
  const uniqueGaps=coverage=>{
   const gaps=workorderGapReasons(coverage).map(i=>C(i.count)+i.unit+i.label);
   const localSource=coverage?.sourceCoverage;
   if(localSource?.complete===false){
    const missing=(localSource.platforms||[]).filter(p=>p.complete===false||(p.missingDates||[]).length);
    gaps.push(missing.length?'该统计范围的工单日期未收齐：'+missing.map(p=>(p.platform||p.sourcePlatform||'未提供平台')+((p.missingDates||[]).length?'（'+p.missingDates.join('、')+'）':'')).join('；'):'该统计范围的工单日期未收齐');
   }
   if(!gaps.length&&coverage?.complete!==true)gaps.push('完整性待核验');
   return gaps;
  };
  const uniqueCell=(facts,key)=>{
   if(!facts)return '—';
   const coverage=facts.coverage||{},value=facts[key];
   if(workorderAttributedElsewhere(coverage))return '<span class="provider-unique-value" tabindex="0" title="已归并来源标签：原单已计入唯一已知三方，此标签不重复增加笔数和金额。">—</span>';
   const gaps=uniqueGaps(coverage);
   const note='工单关联的原订单，在整个所选日期范围内按平台及业务方向去重；同一原订单重复提交只计一次。'+(gaps.length?gaps.join('；')+'。':'')+(coverage.complete===true?'当前已读工单原单完整。':'当前仅为已知原单，覆盖不完整；缺失部分不按零计算。');
   const partial=coverage.complete!==true,label=value===null?'—':key.endsWith('Count')?C(value):N(value);
   return '<span class="provider-unique-value'+(partial?' is-partial':'')+'" tabindex="0" title="'+E(note)+'">'+label+'</span>';
  };
  const kycCell=(facts,key)=>{
   if(!facts)return '—';
   const coverage=facts.coverage||{},unknown=knownNumber(coverage.kycUnknownOrderCount),matched=knownNumber(facts.uniqueNotReceivedKycCount);
   const value=uniqueKycValue(facts,key);
   const partial=coverage.complete!==true||unknown===null||unknown>0;
   const gaps=uniqueGaps(coverage);
   if(unknown===null)gaps.push('KYC核验结果尚未返回');
   else if(unknown>0)gaps.push(C(unknown)+'个去重未到账原单的KYC状态未确认');
   if(key.endsWith('Amount')&&value===null&&matched>0)gaps.push('已匹配原单金额缺失或冲突，金额待核对');
   const note='在去重未到账原单中，至少一张关联工单的源KYC连接明确为是才计入；同一原单只计一笔、金额只累计一次。KYC连接与UTR匹配分别核验。'+gaps.join('；')+(partial?'；这里只展示已确认部分，缺失信息不按0计算。':'');
   return '<span class="provider-unique-value'+(partial?' is-partial':'')+'" tabindex="0" title="'+E(note)+'">'+(value===null?'—':key.endsWith('Count')?C(value):N(value))+(partial&&value!==null?'<span class="provider-partial">部分</span>':'')+'</span>';
  };
  const cells=(r,label,summary=false,index=0)=>{
   const w=r.uniqueOrders,rate=R(r.success_count,r.all_count);
   return [label,'<span title="'+E(summary?'去重平台数':(r.sources.join(' / ')||'仅工单记录')+' · '+r.platforms.join('、'))+'">'+C(r.platforms.length)+'</span>',summary?'—':providerTypeCell(r,L.feeLookupRows,L.country,E,L),
    readState.empty?'—':N(r.all_amount),readState.empty?'—':C(r.all_count),readState.empty?'—':N(r.success_amount),readState.empty?'—':C(r.success_count),readState.empty?'—':R(r.success_amount,total.success_amount),readState.empty?'—':R(r.success_count,total.success_count),'<span title="按成功 / 创建：'+C(r.success_count)+' / '+C(r.all_count)+' 笔">'+(readState.empty?'—':rate)+'</span>',...(direction==='charge'?submissionCells(r):[]),
    ...(direction==='withdraw'?[readState.empty?'—':N(r.pending_amount),readState.empty?'—':C(r.pending_count)]:[]),summary?'—':rateButton(displayedRate(r,feeForRow(r)),index),feeCell(r),r.estimated_fee==null?'—':R(r.estimated_fee,knownFee),
    ...issueKeys.map(key=>uniqueCell(r.uniqueOrders,displayedIssueKeys[key])),...(direction==='charge'?kycIssueKeys.map(key=>kycCell(r.uniqueOrders,key)):[]),
    issueRate(w),summary?'':'<button class="link" aria-expanded="'+!!expanded[rowKey(r)]+'" onclick="providerSummaryToggle('+index+')">'+(expanded[rowKey(r)]?'收起':'展开')+'</button>'];
  };
  const sumRow=(items,label,fullScope=false)=>{const r={...scopedTotal(ctx,items,direction),_submissionIds:[...new Set(items.flatMap(i=>(i.items||[]).map(x=>x.platformId)).filter(Boolean))],_submissionTotal:fullScope,_submissionUnavailable:!fullScope,platforms:[...new Set(items.flatMap(i=>i.platforms))],fee_matched_count:items.reduce((n,i)=>n+i.fee_matched_count,0)};
   const fees=scopedFees(ctx,items,direction);r.estimated_fee=fees.amount;r.fee_complete=fees.complete;r.fee_eligible_count=fees.successCount;r.fee_excluded_count=fees.excludedCount;r.fee_issues=fees.issues;r.fee_exclusions=fees.exclusions;
   r.issues=L.workorders&&items.some(i=>i.issues)?Object.fromEntries(issueKeys.map(k=>[k,items.reduce((n,i)=>n+Number(i.issues?.[k]||0),0)])):null;r.uniqueOrders=fullScope?uniqueWorkorderFacts([L.workorders?.byDirection?.[direction]]):null;return cells(r,'<strong>'+label+'</strong>',true)};
  const coverage=L.workorders?.coverage;
  const partialOrderRows=rows.filter(r=>r.uniqueOrders&&workorderNeedsReview(r.uniqueOrders.coverage));
  root.providerSummaryCoverage=function(){
   const selectedProviders=new Set(partialOrderRows.map(r=>r.provider));
   const missingPlatforms=(coverage?.platforms||[]).filter(p=>p.complete===false||Number.isFinite(Number(p.expectedDays))&&Number(p.days)<Number(p.expectedDays));
   const count=value=>value==null?'未提供':C(value);
   const sourceNote=coverage?.complete===false?'<p>工单日期已收 '+count(coverage.capturedPlatformDays)+' / '+count(coverage.expectedPlatformDays)+' 平台日。来源未收齐会使相关三方一起标记为待核对，不代表每家三方都单独缺订单。</p>':'';
   const platforms=missingPlatforms.length?box('未收齐的平台',table(['平台','包网','缺少日期','已收天数','应收天数'],missingPlatforms.map(p=>[E(p.platform||p.sourcePlatform||'未提供'),E(p.source||'—'),E((p.missingDates||[]).join('、')||'日期未提供'),count(p.days),count(p.expectedDays)]))):'';
   const reasons=box('三方核对原因',table(['三方','当前原因'],partialOrderRows.map(r=>[E(r.provider),E(uniqueGaps(r.uniqueOrders.coverage).join('；'))])));
   const details=(L.workorders?.byPlatformProvider||[]).filter(r=>r.direction===direction&&selectedProviders.has(providerName(canonical(r.provider,L.country)))&&r.uniqueCoverage&&r.uniqueCoverage.complete!==true);
   const byPlatform=details.length?box('平台明细',table(['平台','三方','工单汇总笔数','原始明细条数','当前原因'],details.map(r=>[E(r.platform||r.sourcePlatform||'未提供'),E(providerName(canonical(r.provider,L.country))),count(r.submittedCount),count(r.uniqueCoverage.detailCount),E(uniqueGaps(r.uniqueCoverage).join('；'))]))):'';
   const daily=new Map();
   for(const row of [...partialOrderRows.map(r=>({provider:r.provider,uniqueCoverage:r.uniqueOrders.coverage})),...details])for(const day of row.uniqueCoverage?.diagnosticDays||[]){
    if(day.direction&&day.direction!==direction)continue;
    const provider=providerName(canonical(day.provider||row.provider,L.country)),key=JSON.stringify([day.countryCode,day.source,day.platform,day.sourcePlatform,provider,day.direction||direction,day.date]);
    if(!daily.has(key))daily.set(key,{...day,provider,diagnosticVersion:row.uniqueCoverage.diagnosticVersion});
   }
   const dayReasons=day=>{
    const reasons=workorderGapReasons(day).map(i=>C(i.count)+i.unit+i.label);
    reasons.push(...[['newarExplicitReferenceMissingCount','条 NEWAR 原订单引用字段缺失'],['arPaymentOrderMissingCount','条 AR 充值原订单号缺失'],['unsupportedReferenceTypeCount','条原订单引用字段类型不支持']].filter(([key])=>Number(day[key])>0).map(([key,label])=>C(day[key])+label));
    if(Number(day.sourceOrderOnlyCount)>0)reasons.push(C(day.sourceOrderOnlyCount)+'条仅采集到来源订单号');
    const amount=rawWorkorderAmountComparison(day);if(amount?.unexplainedDifferenceAmount!==null&&amount?.unexplainedDifferenceAmount!==undefined&&amount.unexplainedDifferenceAmount!==0)reasons.push('未解释金额净差 '+(amount.unexplainedDifferenceAmount>0?'+':'')+N(amount.unexplainedDifferenceAmount)+' '+(amount.currency||'（币种未提供）'));
    return reasons.join('；')||'来源数据待核对';
   };
   const dailyDetails=daily.size?box('问题日期与采集字段',table(['平台','包网','日期','三方','日汇总笔数','原始明细条数','需核对内容'],[...daily.values()].sort((a,b)=>String(a.platform).localeCompare(String(b.platform))||String(a.date).localeCompare(String(b.date))).map(day=>[E(day.platform||day.sourcePlatform||'未提供'),E(day.source||'—'),E(day.date||'日期未提供'),E(day.provider),day.expectedAvailable===false?'未收到':count(day.expectedCount),count(day.detailCount),E(dayReasons(day))]))):'';
   openDrawer('工单原单核对原因','<p>这里只影响工单提交、成功、未到账的金额和笔数，以及工单成功率。代收／代付订单统计和刷单剔除另行计算。</p>'+sourceNote+platforms+reasons+byPlatform+dailyDetails+'<p>原订单号用于整段日期去重。采集字段未提供或引用格式不支持，不代表会员未提交工单或没有原订单。未收齐的明细、缺少的原订单号或冲突金额不能按 0 补齐；现有数字保留已确认部分。</p>');
  };
  const workorderGaps=workorderPlatformGaps(L,direction);
  const uniqueCoverageNote=partialOrderRows.length?'<button type="button" class="link provider-order-coverage" onclick="providerSummaryCoverage()" title="工单原单待核对 · '+C(partialOrderRows.length)+' 个三方，点击查看原因">工单待核对 '+C(partialOrderRows.length)+' 三方</button>':'';
  const workorderReviewCount=workorderGaps.filter(workorderPlatformNeedsReview).length;
  const workorderGapNote=workorderGaps.length?'<button type="button" class="link provider-workorder-coverage-button" onclick="providerSummaryWorkorderPlatforms()">工单统计差异 '+C(workorderGaps.length)+' 平台 · 待确认 '+C(workorderReviewCount)+' / 已解释 '+C(workorderGaps.length-workorderReviewCount)+'</button>':'';
  const coverageNote='';
  const workNote=L.workordersUnsupported?'<span class="provider-inline-status">工单未接入</span>':L.workordersError?'<span class="provider-inline-status" title="'+E(L.workordersError)+'">工单读取未完成 <button type="button" class="link" onclick="liveProviderWorkordersRetry()">只重试工单</button></span>':
   L.workordersLoading?'<span class="provider-inline-status">工单读取中…</span>':!L.workorders?'<span class="provider-inline-status">'+(L.dirty?'筛选已更改，请查询':L.loading?'工单待载入':'工单未读取 <button type="button" class="link" onclick="liveProviderWorkordersRetry()">加载工单</button>')+'</span>':'';
  const footers=max>1?[sumRow(shown,partial?'当前页已读取合计':'当前页汇总'),sumRow(rows,partial?'已读取合计':'全部汇总',true)]:[sumRow(rows,partial?'已读取合计':'合计',true)];
  const breakdown=(row,index)=>{
   let items=buildPlatformRows({row,workorders:L.workorders,rates:L.feeLookupRows,country:L.country,plus,combine});
   const childSort=expanded['sort:'+rowKey(row)];
   if(childSort&&Object.hasOwn(sortValues,childSort.key))items=sortedRows(items,r=>r.issueOnly&&!['platform','source'].includes(childSort.key)&&!childSort.key.startsWith('issue_')?null:childSort.key==='amount_share'?fraction(r.success_amount,row.success_amount):childSort.key==='count_share'?fraction(r.success_count,row.success_count):childSort.key==='fee_share'?fraction(r.estimated_fee,row.estimated_fee):sortValues[childSort.key](r),childSort.ascending);
   const share=(value,denominator)=>value==null||denominator==null?'—':R(value,denominator);
   const details=items.map(r=>{
    const w=r.uniqueOrders,unknown=r.issueOnly,rate=R(r.success_count,r.all_count);
    const amount=key=>unknown?'—':N(r[key]),count=key=>unknown?'—':C(r[key]);
    const values=[E(r.platform)+(unknown?'<small class="cell-sub">仅有工单数据</small>':''),E(r.source||'未提供'),providerTypeCell({...r,provider:row.provider},L.feeLookupRows,L.country,E,L),
     amount('all_amount'),count('all_count'),amount('success_amount'),count('success_count'),unknown?'—':share(r.success_amount,row.success_amount),unknown?'—':share(r.success_count,row.success_count),
     '<span title="按成功 / 创建：'+C(r.success_count)+' / '+C(r.all_count)+' 笔">'+(unknown?'—':rate)+'</span>',...(direction==='charge'?(unknown?['—','—','—']:submissionCells(r)):[]),
     ...(direction==='withdraw'?[amount('pending_amount'),count('pending_count')]:[]),rateButton(displayedRate(r,r.fee_reference_label||'—'),index),unknown?'—':feeCell(r),unknown?'—':share(r.estimated_fee,row.estimated_fee),
     ...issueKeys.map(key=>uniqueCell(r.uniqueOrders,displayedIssueKeys[key])),...(direction==='charge'?kycIssueKeys.map(key=>kycCell(r.uniqueOrders,key)):[]),
     issueRate(w),!unknown&&r.platformId&&(Number(r.success_count)>0||Number(r.all_count)>0)?'<button class="link" title="'+E(r.platform+' · 查看'+row.provider+'原始通道与订单')+'" onclick="providerSummaryOrders('+index+','+E(JSON.stringify(r.platformId))+')">查看订单</button>':'—'];
    return '<tr class="provider-platform-row">'+values.map(value=>'<td>'+value+'</td>').join('')+'</tr>';
   }).join('');
   const issueNote=!Array.isArray(L.workorders?.byPlatformProvider)?' 工单平台明细尚未返回，显示 —；不使用分页记录推算。':items.some(r=>r.issueOnly)?' 仅有工单或包网归属不明的平台单列，不计入交易平台数，未重复分摊。':'';
   const definition=issueOnly(row)?'此处为已读取的平台工单汇总；该汇总接口不提供工单号，不能据此判断逐笔记录是否已入库。'+workorderBasis:'第一列为平台，第二列为包网。成功金额、成功笔数按成功时间；成功率为本期成功笔数 / 本期创建笔数，含跨日成功。金额、笔数占比以'+(partial?'已读取平台范围':'当前筛选范围')+'内此三方为分母；手续费占比以此三方已匹配手续费为分母。'+issueNote;
   return '<tr class="provider-expanded-row"><td colspan="'+headers.length+'"><div class="provider-platform-breakdown"><strong>'+E(issueOnly(row)?issueLabelFor(row):row.provider)+' · 平台明细</strong><span class="live-definition">'+definition+'</span></div></td></tr><tr class="provider-platform-labels">'+columns.map(([text,key],i)=>'<td>'+header(i===0?'平台':i===1?'包网':key?text:'',i===0?'platform':i===1?'source':key,childSort?.key||'',!!childSort?.ascending,index)+'</td>').join('')+'</tr>'+details;
  };
  let reportTable=table(headers,shown.map((r,i)=>cells(r,providerLabel(r,i),false,i)),'provider-summary-table provider-compact-table',footers).replace('<table>','<table style="min-width:'+tableWidth+'px"><colgroup>'+widths.map(width=>'<col style="width:'+width+'px">').join('')+'</colgroup>');
  // An empty provider row set cannot establish an empty query while platforms
  // are still pending, failed or paused. Keep the same table and known totals.
  if(!shown.length&&(readState.partial||L.loading||L.queryRetrying||L.queryPaused)){
   const status=L.queryRetrying?'retrying':L.loading?'loading':L.queryPaused?'paused':'incomplete';
   const message={retrying:'正在重试订单读取…',loading:'正在读取订单…',paused:'订单查询已暂停，请继续查询。',incomplete:'订单读取未完成，请重试。'}[status];
   const coverage=readState.received?'已返回 '+C(readState.received)+' / '+C(readState.requested)+' 个平台；当前已读范围暂无记录，未返回平台不按 0 计算。':'尚无平台返回，不能判断是否有记录。';
   reportTable=reportTable.replace(/<div class="live-empty">[^<]*<\/div>/,'<div class="live-empty provider-query-empty" role="status" data-query-read-state="'+status+'">'+E(message+coverage)+'</div>');
  }
  if(shown.some(r=>expanded[rowKey(r)])){
   const body=shown.map((r,i)=>'<tr>'+cells(r,providerLabel(r,i),false,i).map(c=>'<td>'+c+'</td>').join('')+'</tr>'+(expanded[rowKey(r)]?breakdown(r,i):'')).join('');
   reportTable=reportTable.replace(/<tbody>[\s\S]*?<\/tbody>/,()=>'<tbody>'+body+'</tbody>');
  }
  return '<div class="provider-summary-report">'+readNotice(ctx)+intakeNotice(ctx)+'<div class="provider-summary-heading"><span class="provider-scope-note">'+E(L.country)+' · '+E(L.currency)+' · '+E(L.from.replace('T',' '))+' 至 '+E(L.to.replace('T',' '))+coverageNote+'</span></div>'+
   renderMetrics(ctx,direction,rows)+'<div class="provider-status-actions">'+workNote+(direction==='charge'?(submissionAnalysis?.note(true)||''):'')+'</div>'+
   box(name+'三方汇总'+(partial?'（部分结果）':'')+' · '+issueLabel+'工单',(uniqueCoverageNote||workorderGapNote?'<div class="provider-workorder-notices">'+uniqueCoverageNote+workorderGapNote+'</div>':'')+reportTable+pager(rows.length,L.localPage,L.localSize,'local'),
    '')+'</div>';
 }
 root.HensemProviderSummary={render,buildRows,parseFee,estimate,estimateFacts,tieredFeeRule,feeSummary,feeCoverageText,feeCandidates,confirmedFeeRule,queryCoverage,intakeCoverage,workorderPlatformGaps,workorderPlatformNeedsReview,rawWorkorderAmountComparison,overviewDimensions,isProviderBusiness,buildPlatformRows,providerType,providerTypeCell,sortedRows,sortableTable,knownNumber,fraction,feeSortValue};
 if(typeof module!=='undefined')module.exports=root.HensemProviderSummary;
})(typeof window!=='undefined'?window:globalThis);
