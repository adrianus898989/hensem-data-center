/* Same six-card composition as summary-density.js / comparison-density.js.
 * Plain-text formatters only; this renderer never queries or changes page state. */
(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function known(value){if(typeof value!=='number'&&(typeof value!=='string'||!value.trim()))return null;const n=Number(value);return Number.isFinite(n)?n:null}
 const defaultMoney=value=>known(value)===null?'—':known(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const defaultCount=value=>known(value)===null?'—':known(value).toLocaleString('en-US');
 const defaultRate=(success,total)=>known(success)===null||known(total)===null||known(total)<=0?'—':(known(success)/known(total)*100).toFixed(2)+'%';
 function comparison(current,previous,options,isRate=false,kind='amount'){
  const status=options.comparisonStatus||'unavailable',label=options.comparisonLabel||'较前一日',compactLabel=/周期/.test(label)?'较前期':'较昨日';
  if(status!=='ready'||!options.previous){const text=status==='loading'?'对比读取中':'对比暂不可用';return {text,title:options.comparisonError||text,tone:'neutral'}}
  const helper=isRate?(options.rateDelta||root.HensemLiveCompare?.ratioDelta):(options.delta||root.HensemLiveCompare?.delta);
  const result=typeof helper==='function'?(isRate?helper(...current,...previous):helper(current,previous)):null;
  let change=result?.display||'—';
  if(!isRate){
   const a=known(current),b=known(previous),format=kind==='count'?(options.count||defaultCount):(options.money||defaultMoney);
   if(a!==null&&b!==null&&Number.isFinite(a-b)){const raw=a-b,difference=kind==='count'?(raw||0):Math.abs(raw)<0.005?0:raw;change=(difference>0?'+':'')+format(difference)+(kind==='count'?' 笔':'')+'（'+change+'）'}else change='—';
  }
  return {text:compactLabel+' '+change,title:options.comparisonTitle||label,tone:result?.trend==='up'?'up':result?.trend==='down'?'down':'neutral'};
 }
 function compareHtml(value){return '<span class="metric-compare '+value.tone+'" title="'+esc(value.title)+'">'+esc(value.text)+'</span>'}
 function card(label,value,foot,key,icon='▥',title=''){
  return '<div class="kpi" data-metric="'+esc(key)+'"'+(title?' title="'+esc(title)+'"':'')+'><div class="kpi-label">'+esc(label)+'<span class="kpi-icon" aria-hidden="true">'+icon+'</span></div><div class="kpi-value">'+esc(value)+'</div><div class="kpi-foot">'+foot+'</div></div>';
 }
 function renderMetrics(summary,options={}){
  const current=summary||{},previous=options.previous||{},label=options.label||'订单',money=options.money||defaultMoney,count=options.count||defaultCount,rate=options.rate||defaultRate;
  const groups=[['all','全部'+label+'金额','▤'],['success','成功金额','✓'],['pending',label==='代付'?'本期代付中金额':'处理中金额','◷'],['failed','失败金额','◇']];
  const cards=groups.map(([key,name,icon])=>{
   const amountCompare=comparison(current[key+'_amount'],previous[key+'_amount'],options),countCompare=comparison(current[key+'_count'],previous[key+'_count'],options,false,'count');
   const countText=count(current[key+'_count'])+' 笔',foot='<span class="live-reference-count">'+esc(countText)+'</span><span class="metric-comparisons"><span data-change="amount">'+compareHtml(amountCompare)+'</span><span data-change="count">'+compareHtml(countCompare)+'</span></span>';
   return card(name,money(current[key+'_amount']),foot,key,icon,name+'；'+countText+'；金额'+amountCompare.text+'；笔数'+countCompare.text);
  });
  cards.push(card('成功率',rate(current.success_count,current.all_count),compareHtml(comparison([current.success_count,current.all_count],[previous.success_count,previous.all_count],options,true)),'success_rate','▥','成功笔数按成功时间；全部订单笔数按创建时间；含跨日成功，可超过100%'));
  if(options.fee){
   const fee=options.fee,label=fee.label||'估算手续费',matched=known(fee.matchedCount),eligible=known(fee.eligibleCount),excluded=known(fee.excludedCount),loading=fee.status==='loading',failed=fee.status==='error';
   const basis=fee.mode==='historical'?'按订单创建时间匹配生效版本':'按当前参考费率估算，非历史实际手续费';
   const coverage=loading?'费率读取中':failed?'费率读取失败':matched!==null&&eligible!==null?'已匹配 '+count(matched)+' / '+count(eligible)+' 笔'+(fee.complete?'':' · 部分'):'匹配范围待确认';
   const foot='<span class="live-reference-count">'+esc(coverage)+'</span><span class="metric-compare neutral">'+esc(basis)+'</span>';
   const title=basis+'；'+coverage+(excluded!==null&&excluded>0?'；不计三方手续费 '+count(excluded)+' 笔':'')+(fee.note?'；'+fee.note:'')+'；未匹配部分不计为零手续费';
   cards.push(card(label,loading||failed?'—':money(fee.amount),foot,'fee','▥',title));
  }else cards.push(card('估算手续费','—','<span class="metric-compare neutral" title="历史生效费率尚未完整匹配，不按当前费率重算旧订单">对比 —</span>','fee','▥','历史生效费率尚未接入，手续费暂不可用'));
  return '<div class="kpis dense-metrics comparison-kpis live-reference-metrics">'+cards.join('')+'</div>';
 }
 function totals(options={}){
  const directions=Array.isArray(options.directions)?options.directions:[];
  return '<div class="live-reference-totals">'+directions.map(direction=>{
   const settings={...options,...direction},label=direction.label||(direction.key==='charge'?'代收':direction.key==='withdraw'?'代付':'订单');
   return '<section class="live-reference-direction" data-direction="'+esc(direction.key||'')+'"><div class="live-reference-heading"><h3>'+esc(label)+'</h3>'+(settings.currency?'<span>'+esc(settings.currency)+'</span>':'')+(direction.coverageHtml||'')+'</div>'+renderMetrics(direction.summary,{...settings,label})+'</section>';
  }).join('')+'</div>';
 }
 root.HensemLiveLayout=Object.freeze({renderMetrics,totals,comparison});
})(typeof window==='object'?window:globalThis);
