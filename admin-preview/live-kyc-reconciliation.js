/* Read-only KYC reconciliation presentation. No transport or matching rules.
 * create({id,onQuery,onDetail,onExplain,onRender,onError}) -> render(snapshot).
 * restoreFilters(filters) validates/replaces draft filters atomically without
 * reading; call query() once afterward for a drill-down or return navigation.
 * onQuery receives {kycStatus,dimension,query,platform,provider,from,to,
 *   processing,matchStatus,offset,limit}; it may return a snapshot/Promise.
 * snapshot: {summary,kycSummary,rows,total,offset,limit,currency,scopeLabel,
 *   updatedAt,coverage:{complete,label},options:{platforms,providers}}.
 * Summary/group rows: exportRows,uniqueWorkorders,uniquePaymentOrders,
 *   uniquePaymentAmount,duplicateExportRows,multipleWorkorderPayments,
 *   processed:{count,amount},rejected:{count,amount},unprocessed:{count,amount},
 *   unknownProcessing:{count},
 *   matchCounts:{exact_unique,exact_duplicate,amount_conflict,ambiguous_online,
 *   online_amount_missing,unmatched,platform_not_in_online_snapshot,missing_rc,source_conflict}.
 * kycSummary counts are unique workorders partitioned by the source KYC field.
 * Order rows keep source KYC, manual KYC/UTR, online match and receipt evidence
 * separate. sourceUtrPresent/onlineUtrPresent are boolean|null presence flags;
 * raw/opaque UTR values are never displayed. Only received_verified/
 * unreceived_verified mean verified receipt.
 * Unknown/null aggregates stay unknown. Currency-free sums are not displayed.
 */
(function(root){
 'use strict';
 const instances=new Map();let serial=0;
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const n=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
 const C=v=>n(v)===null?'—':n(v).toLocaleString('en-US');
 const currency=v=>typeof v==='string'&&/^[A-Z]{3,6}$/.test(v)?v:null;
 function decimal(v){if(typeof v!=='number'&&typeof v!=='string')return null;const s=String(v),m=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);return m?m[1]+m[2].replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(m[3]||'').padEnd(2,'0'):null}
 const M=(v,unit)=>decimal(v)!==null&&currency(unit)?decimal(v)+' '+unit:'—';
 const ratio=(a,b)=>n(a)!==null&&n(b)>0?(n(a)/n(b)*100).toFixed(2)+'%':'—';
 const matchLabels={exact_unique:'精确匹配',exact_duplicate:'重复来源一致',amount_conflict:'金额冲突',ambiguous_online:'线上多条冲突',online_amount_missing:'线上缺金额',unmatched:'未找到',platform_not_in_online_snapshot:'当前快照无此平台',missing_rc:'缺原订单号',source_conflict:'源数据冲突'};
 const matchKind=v=>v==='platform_missing_online'?'platform_not_in_online_snapshot':v;
 const utrLabels={match:'一致',source_missing:'原 UTR 缺失',online_missing:'在线 UTR 缺失',both_missing:'双方缺失',conflict:'不一致',source_conflict:'原 UTR 多值',online_conflict:'在线 UTR 多值',not_compared:'未比较'};
 const utrPresence=(explicit,legacy)=>typeof explicit==='boolean'?(explicit?'有':'无'):(explicit!==null&&typeof legacy==='string'&&legacy.trim()&&!/^(?:未提供|未知|待核实|无|已提供|查看|仅比对)/.test(legacy.trim())?'有':'待核实');
 const kycLabels={connected:'已连接 KYC',disconnected:'未连接 KYC',unknown:'待核实'};
 const dimensions={platform:'平台',provider:'原三方',date:'日期',orders:'具体订单'};
 const defaultFilters=()=>({kycStatus:'all',dimension:'platform',query:'',platform:'',provider:'',from:'',to:'',processing:'all',matchStatus:'all',offset:0,limit:20});
 function create(ctx={}){
  const id=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(ctx.id||'')?ctx.id:'kyc-'+(++serial);let filters=defaultFilters(),snapshot=null,snapshotFilters=null,resultDimension='platform',loading=false,error='',requestSerial=0,more=false;
  const emit=()=>ctx.onRender?.();
  const action=(method,args=[],event='click',value=false)=>'data-kr-id="'+E(id)+'" data-kr-action="'+E(method)+'" data-kr-args="'+E(JSON.stringify(args))+'" data-kr-event="'+event+'"'+(value?' data-kr-value="true"':'');
  const button=(label,method,args=[],attrs='')=>'<button type="button" '+attrs+' '+action(method,args)+'>'+E(label)+'</button>';
  const badge=(label,tone='neutral')=>'<span class="kr-badge kr-'+tone+'">'+E(label)+'</span>';
  function select(key,label,values){const items=[...values];if(filters[key]&&!items.some(([v])=>v===filters[key]))items.push([filters[key],filters[key]]);return '<label><span>'+E(label)+'</span><select aria-label="'+E(label)+'" '+action('filter',[key],'change',true)+'>'+items.map(([v,l])=>'<option value="'+E(v)+'" '+(v===filters[key]?'selected':'')+'>'+E(l)+'</option>').join('')+'</select></label>'}
  const input=(key,label,type='search')=>'<label><span>'+E(label)+'</span><input type="'+type+'" aria-label="'+E(label)+'" '+(type==='search'?'maxlength="200"':'')+' value="'+E(filters[key])+'" '+action('filter',[key],'input',true)+'></label>';
  const options=(list)=>[['','全部'],...(list||[]).map(v=>typeof v==='string'?[v,v]:[String(v.value??''),String(v.label??v.value??'')])];
  function filtersView(){return '<form class="kr-filter" '+action('query',[],'submit')+'><div class="kr-filter-main">'+select('platform','平台',options(snapshot?.options?.platforms))+select('provider','原三方',options(snapshot?.options?.providers))+input('query',ctx.queryLabel||'工单 / 原单号')+input('from','开始日期','date')+input('to','结束日期','date')+'<div class="kr-filter-actions">'+button('更多筛选','more',[],'aria-expanded="'+more+'"')+button('查询','query',[],'class="kr-primary" '+(loading||typeof ctx.onQuery!=='function'?'disabled':''))+button('重置','reset')+'</div></div><div class="kr-filter-more" '+(more?'':'hidden')+'>'+select('processing','工单处理状态',[['all','全部'],['processed','已处理'],['rejected','已驳回'],['unprocessed','未处理'],['unknown','待核实']])+select('matchStatus','在线匹配',[['all','全部'],...Object.entries(matchLabels)])+'</div></form>'}
  function tabs(){const groups=snapshot?.kycSummary||{},values=Object.values(kycLabels).map((_,i)=>n(groups[Object.keys(kycLabels)[i]]?.count)),total=values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;return '<nav class="kr-kyc-tabs" aria-label="原导出 KYC 连接分类" title="'+E(snapshot?.kycBasisLabel||'按唯一工单分类')+'">'+button('全部','category',['all'],'aria-pressed="'+(filters.kycStatus==='all')+'"')+Object.entries(kycLabels).map(([key,label])=>'<button type="button" aria-pressed="'+(filters.kycStatus===key)+'" '+action('category',[key])+'><span>'+E(label)+'</span><b>'+C(groups[key]?.count)+'</b><small>'+ratio(groups[key]?.count,total)+'</small></button>').join('')+'</nav>'}
  function metric(label,count,amount,unit,sub='',title=''){return '<div class="kr-metric"'+(title?' title="'+E(title)+'"':'')+'><span>'+E(label)+'</span><strong>'+C(count)+'</strong>'+(amount!==undefined?'<small>'+M(amount,unit)+'</small>':'')+(sub?'<small>'+E(sub)+'</small>':'')+'</div>'}
  function metrics(){const s=snapshot?.summary||{},unit=snapshot?.currency;return '<div class="kr-metrics">'+metric('原始导出行',s.exportRows)+metric('唯一工单',s.uniqueWorkorders)+metric('原支付订单（去重）',s.uniquePaymentOrders,s.uniquePaymentAmount??null,unit)+metric('重复导出行',s.duplicateExportRows,undefined,unit,'同工单重复快照')+metric('同付款多工单',s.multipleWorkorderPayments,undefined,unit,'按原支付订单计')+metric('已处理工单',s.processed?.count,s.processed?.amount??null,unit,ratio(s.processed?.count,s.uniqueWorkorders),'工单处理状态，不代表本订单入款')+metric('已驳回工单',s.rejected?.count,s.rejected?.amount??null,unit,ratio(s.rejected?.count,s.uniqueWorkorders),'已驳回单独统计，不并入待处理')+metric('未处理工单',s.unprocessed?.count,s.unprocessed?.amount??null,unit,ratio(s.unprocessed?.count,s.uniqueWorkorders),'工单处理状态，不代表本订单未入款')+'</div>'}
  const pair=(count,amount,unit,denominator)=>'<strong>'+C(count)+'</strong><small>'+M(amount,unit)+'</small>'+(denominator!==undefined?'<small class="kr-rate">'+ratio(count,denominator)+'</small>':'');
  const two=(a,b,la,lb)=>'<strong>'+C(a)+' <small>'+E(la)+'</small></strong><small>'+C(b)+' '+E(lb)+'</small>';
  function open(index,label){return typeof ctx.onDetail==='function'?button(label,'detail',[index],'class="kr-link"'):E(label)}
  function groupTable(){const rows=snapshot?.rows||[],heads=[dimensions[resultDimension],'导出 / 唯一工单','原支付订单','重复 / 多工单','已处理','已驳回','未处理','精确 / 重复一致','待核对 / 未找到','操作'];return table(heads,rows.map((r,i)=>{
   const unit=r.currency||snapshot?.currency,raw=r.matchCounts||{},m={...raw,platform_not_in_online_snapshot:Object.hasOwn(raw,'platform_not_in_online_snapshot')?raw.platform_not_in_online_snapshot:raw.platform_missing_online};
   return ['<span title="'+E(r.label??r.key)+'">'+open(i,String(r.label??r.key??'未提供'))+'</span>',two(r.exportRows,r.uniqueWorkorders,'导出行','唯一工单'),pair(r.uniquePaymentOrders,r.uniquePaymentAmount,unit),two(r.duplicateExportRows,r.multipleWorkorderPayments,'重复行','多工单RC'),pair(r.processed?.count,r.processed?.amount,unit,r.uniqueWorkorders),pair(r.rejected?.count,r.rejected?.amount,unit,r.uniqueWorkorders),pair(r.unprocessed?.count,r.unprocessed?.amount,unit,r.uniqueWorkorders),two(m.exact_unique,m.exact_duplicate,'精确匹配','重复一致'),'<strong>'+C(m.unmatched)+' <small>未找到</small></strong><small>'+C(m.amount_conflict)+' 金额冲突 · '+C(m.ambiguous_online)+' 多条冲突</small><small>'+C(m.online_amount_missing)+' 缺金额 · '+C(m.platform_not_in_online_snapshot)+' 快照无平台</small><small>'+C(m.missing_rc)+' 缺RC · '+C(m.source_conflict)+' 源冲突</small>'+(n(r.unknownProcessing?.count)>0?'<small>'+badge('状态待核对 '+C(r.unknownProcessing.count),'warn')+'</small>':''),typeof ctx.onDetail==='function'?button('查看订单','detail',[i],'class="kr-link"'):'—'];
  }))}
  function orderTable(){return table(['平台 / 原支付订单','源 KYC / 人工核验','原金额','工单处理状态','在线登记 / 匹配','到账核实','UTR / 人工核验','操作'],(snapshot?.rows||[]).map((r,i)=>{
   const rawAmount=decimal(r.amount),unit=r.currency||snapshot?.currency;
   const receipt=r.receiptState==='received_verified'?badge('已核实入款','good'):r.receiptState==='unreceived_verified'?badge('已核实未入款','warn'):badge('到账待核实');
   return ['<strong>'+E(r.platform||'未提供')+'</strong><small title="'+E(r.paymentOrderId||'')+'">'+E(r.paymentOrderId||'缺原单号')+'</small><small title="'+E(r.workOrderId||'')+'">'+E(r.workOrderId||'工单号未提供')+'</small>',badge(kycLabels[r.kycStatus]||kycLabels.unknown)+(!['connected','disconnected'].includes(r.kycStatus)&&r.declaredFileKyc?'<small>文件标签 '+E(r.declaredFileKyc)+'</small>':'')+(r.hasKycCategoryChange?'<small>同原单 KYC 分类有变化</small>':'')+'<small>人工 KYC：'+E(r.manualKyc||'未提供')+'</small>',rawAmount===null?'—':currency(unit)?E(rawAmount+' '+unit):E(rawAmount)+'<small>币种未提供</small>',E(r.sourceWorkorderState||'未提供'),'<span title="'+E(r.onlineState||'')+'">'+E(r.onlineState||'未提供')+'</span><small>'+E(matchLabels[matchKind(r.matchStatus)]||'待核实')+'</small>',receipt+'<small>'+(r.sourceDepositState?'原状态：'+E(r.sourceDepositState):'原单证据待核实')+'</small>','<span class="kr-utr-presence">原：'+utrPresence(r.sourceUtrPresent,r.sourceUtr)+' · 在线：'+utrPresence(r.onlineUtrPresent,r.onlineUtr)+'</span><small>匹配：'+E(utrLabels[r.utrState]||'未比较')+'</small><small>人工：'+E(r.manualUtr||'未提供')+'</small>',typeof ctx.onDetail==='function'?button('证据 / 工单','detail',[i],'class="kr-link"'):'—'];
  }))}
  function table(heads,rows){return '<div class="kr-table-wrap"><table class="'+(resultDimension==='orders'?'kr-orders-table':'kr-group-table')+'"><thead><tr>'+heads.map(h=>'<th>'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+(rows.length?'':'<div class="kr-empty">'+(snapshot?(snapshot.coverage?.complete===true?'该已读取范围无记录':'当前范围尚未取得明细'):'选择条件后点击查询')+'</div>')+'</div>'}
  function pager(){const total=n(snapshot?.total),size=filters.limit,page=Math.floor(filters.offset/size)+1,last=total===null?null:Math.max(1,Math.ceil(total/size));return '<div class="kr-pager"><span>共 '+C(total)+' '+(resultDimension==='orders'?'条记录':'组')+'</span><label>每页 <select aria-label="每页条数" '+action('size',[],'change',true)+'>'+[20,50,100].map(v=>'<option '+(v===size?'selected':'')+'>'+v+'</option>').join('')+'</select></label>'+button('上一页','page',[page-1],loading||page<=1?'disabled':'')+'<span>'+C(page)+' / '+C(last)+'</span>'+button('下一页','page',[page+1],loading||last===null||page>=last?'disabled':'')+'</div>'}
  function render(data,readFilters){if(arguments.length){snapshot=data??null;snapshotFilters={...(readFilters||filters)};resultDimension=Object.hasOwn(dimensions,snapshot?.dimension)?snapshot.dimension:snapshotFilters.dimension;if(n(snapshot?.offset)!==null)filters.offset=n(snapshot.offset);if([20,50,100].includes(n(snapshot?.limit)))filters.limit=n(snapshot.limit)}const cov=snapshot?.coverage,changed=snapshotFilters&&Object.keys(snapshotFilters).some(key=>snapshotFilters[key]!==filters[key]);return '<section class="kr-panel" data-kyc-reconciliation="'+E(id)+'"><header><h2>KYC · 原订单核对</h2><div>'+button('统计口径','explain',[],'class="kr-link"')+'<span>'+E(snapshot?.updatedAt?'更新于 '+snapshot.updatedAt:'尚未读取')+'</span></div></header>'+tabs()+filtersView()+(error?'<div class="kr-error" role="alert">'+E(error)+'</div>':'')+(loading?'<div class="kr-progress" role="status">读取中…</div>':'')+(snapshot?metrics():'')+'<div class="kr-toolbar"><nav aria-label="统计分组">'+Object.entries(dimensions).map(([key,label])=>button(label,'dimension',[key],'aria-pressed="'+(filters.dimension===key)+'"')).join('')+'</nav><span class="kr-statuses">'+(ctx.privatePreview===true?badge('本机私有'):'')+(snapshot&&!currency(snapshot.currency)?badge('币种待核实'):'')+(cov?.complete===false?badge('范围未完整','warn'):'')+(n(snapshot?.summary?.unknownProcessing?.count)>0?badge('状态待核对 '+C(snapshot.summary.unknownProcessing.count),'warn'):'')+(snapshot&&changed?badge('条件已修改，查询后更新'):'')+'</span></div>'+(resultDimension==='orders'?orderTable():groupTable())+pager()+'</section>'}
  function filter(key,value){if(!['query','platform','provider','from','to','processing','matchStatus'].includes(key))return;const allowed=key==='processing'?['all','processed','rejected','unprocessed','unknown']:key==='matchStatus'?['all',...Object.keys(matchLabels)]:null;if(key==='matchStatus')value=matchKind(value);if(allowed&&!allowed.includes(value))return;if(['from','to'].includes(key)&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))return;filters[key]=String(value).slice(0,200);filters.offset=0;}
  function restoreFilters(value,notify=true){
   if(!value||typeof value!=='object'||Array.isArray(value))return false;
   const next={...defaultFilters(),...value};if(Object.keys(value).some(key=>!Object.hasOwn(filters,key)))return false;
   next.matchStatus=matchKind(next.matchStatus);
   if(!['all',...Object.keys(kycLabels)].includes(next.kycStatus)||!Object.hasOwn(dimensions,next.dimension)||!['all','processed','rejected','unprocessed','unknown'].includes(next.processing)||!['all',...Object.keys(matchLabels)].includes(next.matchStatus))return false;
   if(['query','platform','provider','from','to'].some(key=>typeof next[key]!=='string'||next[key].length>200))return false;
   if(['from','to'].some(key=>{const date=next[key];if(!date)return false;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return true;const parsed=new Date(date+'T00:00:00Z');return !Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date}))return false;
   if(next.from&&next.to&&next.from>next.to)return false;
   if(n(next.offset)===null||![20,50,100].includes(n(next.limit)))return false;
   next.offset=n(next.offset);next.limit=n(next.limit);requestSerial++;loading=false;error='';filters=next;if(notify)emit();return true;
  }
  async function query(){if(typeof ctx.onQuery!=='function')return;if(filters.from&&filters.to&&filters.from>filters.to){error='开始日期不能晚于结束日期';emit();return}const own=++requestSerial,requested={...filters};loading=true;error='';emit();try{const result=await ctx.onQuery(requested);if(own!==requestSerial)return;if(result!==undefined)render(result,requested)}catch(e){if(own!==requestSerial)return;error=e?.message||'核对数据读取失败';ctx.onError?.(e)}finally{if(own===requestSerial){loading=false;emit()}}}
  function pause(){requestSerial++;if(loading)error='读取已暂停，点击查询更新';loading=false;}
  function capture(){return {filters:{...filters},snapshot,snapshotFilters:snapshotFilters?{...snapshotFilters}:null,resultDimension,error:loading?'读取已暂停，点击查询更新':error,more};}
  function restore(value){pause();if(!value){filters=defaultFilters();snapshot=null;snapshotFilters=null;resultDimension='platform';error='';more=false;return true;}if(!restoreFilters(value.filters,false))return false;snapshot=value.snapshot??null;snapshotFilters=value.snapshotFilters?{...value.snapshotFilters}:null;resultDimension=Object.hasOwn(dimensions,value.resultDimension)?value.resultDimension:'platform';error=String(value.error||'');more=!!value.more;return true;}
  const api={render,query,filter,restoreFilters,pause,capture,restore,clear:()=>restore(null),getState:()=>({...filters}),getSnapshot:()=>snapshot,dispose:()=>{pause();instances.delete(id)},dispatch(method,...args){
   if(method==='filter'){filter(...args);return}
   if(method==='query')return query();
   if(method==='reset'){requestSerial++;loading=false;filters=defaultFilters();snapshot=null;snapshotFilters=null;resultDimension='platform';error='';emit();return}
   if(method==='more'){more=!more;emit();return}
   if(method==='category'&&['all',...Object.keys(kycLabels)].includes(args[0])){filters.kycStatus=args[0];filters.offset=0;return query()}
   if(method==='dimension'&&Object.hasOwn(dimensions,args[0])){filters.dimension=args[0];filters.offset=0;return query()}
   if(method==='size'&&[20,50,100].includes(Number(args[0]))){filters.limit=Number(args[0]);filters.offset=0;return query()}
   if(method==='page'){const page=Number(args[0]),total=n(snapshot?.total);if(Number.isSafeInteger(page)&&page>=1&&total!==null&&page<=Math.max(1,Math.ceil(total/filters.limit))){filters.offset=(page-1)*filters.limit;return query()}return}
   if(method==='detail'){const row=snapshot?.rows?.[args[0]];if(row&&typeof ctx.onDetail==='function')return ctx.onDetail({dimension:resultDimension,key:row.key??row.id,label:row.label,filters:{...(snapshotFilters||filters)},row});return}
   if(method==='explain')return ctx.onExplain?.({title:'KYC 与订单核对口径',text:'KYC 分类按原导出连接字段，源字段缺失保留待核实。唯一工单、原支付订单与重复导出分别统计；工单已处理及在线唯一匹配均不代表实际到账。人工 KYC、UTR 核验独立保留；无明确币种不合计金额。'+(snapshot?.scopeLabel?'\n范围：'+snapshot.scopeLabel:'')+(snapshot?.coverage?.label?'\n读取情况：'+snapshot.coverage.label:'')+(snapshot?.coverage?.complete===false?'\n当前结果仅包含已读取范围，缺失来源不按零计。':'')+(n(snapshot?.summary?.unknownProcessing?.count)>0?'\n状态待核对：'+C(snapshot.summary.unknownProcessing.count)+' 个工单存在状态冲突或缺失，单独保留，不并入已处理、已驳回或未处理。':'')});
  }};
  instances.set(id,api);return api;
 }
 function handleEvent(event){
  const control=event.target?.closest?.('[data-kr-action]');if(!control||control.dataset.krEvent!==event.type||!instances.has(control.dataset.krId))return;
  let args;try{args=JSON.parse(control.dataset.krArgs||'[]')}catch{return}if(!Array.isArray(args)||args.length>3)return;
  if(control.disabled)return;if(event.type==='submit'||event.type==='click')event.preventDefault?.();if(control.dataset.krValue==='true')args.push(control.value);
  return instances.get(control.dataset.krId).dispatch(control.dataset.krAction,...args);
 }
 root.HensemLiveKycReconciliation={create,dispatch:(id,method,...args)=>instances.get(id)?.dispatch(method,...args),handleEvent};
 if(typeof document!=='undefined'&&typeof document.addEventListener==='function')for(const type of ['click','input','change','submit'])document.addEventListener(type,handleEvent);
})(window);
