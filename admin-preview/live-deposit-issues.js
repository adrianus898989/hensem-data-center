/* Employee follow-up records and derived sheet results stay separate. */
(function(root){
 root.HensemLiveDepositIssues={create:function(ctx){
  const {L,E,C,N,R,metric,box,table,pager,render,request,formatTime}=ctx;
  const sourceUrl='https://docs.google.com/spreadsheets/d/1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg/edit?gid=1642433306#gid=1642433306';
  const entryUrl='https://docs.google.com/spreadsheets/d/1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE/edit?gid=2140568082#gid=2140568082';
  Object.assign(L,{depositIssuesView:'entries',depositIssuesSection:'details',depositIssuesDateMode:'all',depositIssuesMatch:'all',depositIssuesFollowupStatus:'',depositIssuesOrderNumber:'',depositIssuesWorkOrderNumber:'',depositIssuesUtr:'',depositIssuesUpiId:'',depositIssuesKycUpiId:'',depositIssuesReply:'',depositIssuesUtrMatch:'',depositIssuesKycCorrect:'',depositIssuesStaffCode:'',depositIssuesSourceKind:'all',depositIssuesAmountMin:'',depositIssuesAmountMax:''});
  const facets={};
  const followupName=value=>({success:'成功',pending:'尚未到账',other_id:'成功到其他账号',other_platform:'成功到其他平台',other_order:'成功到其他订单',over30:'超过 30 天 / 退款',over15:'超过 15 天 / 退款',need_evidence:'待补材料',no_refund:'不退款',appeal:'申诉跟进',unknown:'未填写（前端记录）','need to provide pdf/video':'待补 PDF / 视频','not yet received':'尚未收到','success to other platform':'成功到其他平台','success to other id':'成功到其他账号','success to other order':'成功到其他订单',refund:'退款','more than 30days/refund':'超过 30 天 / 退款','more than 15days refund':'超过 15 天 / 退款','save upi / no refund':'保存 UPI / 不退款'}[String(value||'').toLowerCase()]||value||'未填写');
  const reply=value=>value?'<div class="deposit-reply">'+E(value)+'</div>':'<span class="deposit-muted">未填写</span>';
  const status=(value,prefix='')=>'<span class="live-badge '+(value==='已入款'?'success':value==='未入款'?'pending':'')+'" title="原表公式或标记，不代表已核实实际到账">'+E(prefix)+E(value||'待核对')+'</span>';
  const linkState=r=>r.sourceKind==='portal'?'<span class="deposit-muted" title="前端记录独立保存，不参与旧表自动关联">独立前端记录</span>':'<span class="live-badge '+(r.linkStatus==='matched'?'success':'pending')+'">'+(r.linkStatus==='matched'?'已关联':r.linkStatus==='review'?'关联待核对':L.depositIssuesView==='entries'?'未关联表格':'未找到录入记录')+'</span>';
  const option=(value,label,selected)=>'<option value="'+E(value)+'" '+(String(value)===String(selected)?'selected':'')+'>'+E(label)+'</option>';
  function field(label,key,values,value){return '<label class="live-field"><span>'+E(label)+'</span><select onchange="depositIssuesSet(\''+key+'\',this.value)">'+values.map(([v,l])=>option(v,l,value)).join('')+'</select></label>'}
  function input(label,key,value,numeric=false){const hint={orderNumber:'按订单号',workOrderNumber:'按工单号',utr:'按 UTR',upiId:'按 UPI ID',kycUpiId:'按 KYC-UPI ID',reply:'按回复关键词',staffCode:'按员工编号',amountMin:'不限',amountMax:'不限'}[key]||'';return '<label class="live-field"><span>'+E(label)+'</span><input '+(numeric?'type="number" min="0" step="0.01"':'type="search" maxlength="200"')+' placeholder="'+E(hint)+'" value="'+E(value)+'" oninput="depositIssuesSet(\''+key+'\',this.value)"></label>'}
  function toolbar(){
   const f=facets[L.depositIssuesView]||{},entries=L.depositIssuesView==='entries';
   const countries=[...new Set(L.catalog.map(p=>p.country).filter(Boolean))].sort();
   const platforms=[...new Set([...(f.platforms||[]),...L.catalog.filter(p=>p.country===L.country).map(p=>p.name),L.depositIssuesPlatform==='all'?'':L.depositIssuesPlatform].filter(Boolean))].sort();
   const providers=[...new Set([...(f.providers||[]),L.depositIssuesProvider].filter(Boolean))].sort();
   const tabs='<div class="deposit-source-tabs"><div role="tablist" aria-label="存款跟进记录来源">'+[['entries','员工跟进记录'],['results','表格核对结果']].map(([v,l])=>'<button class="btn '+(L.depositIssuesView===v?'primary':'')+'" role="tab" aria-selected="'+(L.depositIssuesView===v)+'" onclick="depositIssuesSource(\''+v+'\')">'+l+'</button>').join('')+'</div><a class="btn" href="'+(entries?entryUrl:sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+(entries?'打开员工原表':'打开核对原表')+' ↗</a></div>';
   return tabs+'<section class="panel deposit-issues-toolbar"><form onsubmit="event.preventDefault();depositIssuesLoad(true)"><div class="live-filters">'+
    field('日期范围','dateMode',[['all','全部日期'],['range',entries?'按跟进日期':'按核对日期']],L.depositIssuesDateMode)+
    '<label class="live-field"><span>开始日期</span><input type="date" '+(L.depositIssuesDateMode==='all'?'disabled':'')+' value="'+E(L.from.slice(0,10))+'" onchange="depositIssuesDate(\'from\',this.value)"></label><label class="live-field"><span>结束日期</span><input type="date" '+(L.depositIssuesDateMode==='all'?'disabled':'')+' value="'+E(L.to.slice(0,10))+'" onchange="depositIssuesDate(\'to\',this.value)"></label>'+
    field('国家 / 地区','country',countries.map(v=>[v,v]),L.country)+field('平台','platformName',[['all','全部平台'],...platforms.map(v=>[v,v])],L.depositIssuesPlatform)+field('三方','provider',[['','全部三方'],...providers.map(v=>[v,v])],L.depositIssuesProvider)+
    (entries?field('跟进状态','followupStatus',[['','全部状态'],...(f.followupStatuses||[]).map(v=>[v,followupName(v)])],L.depositIssuesFollowupStatus)+field('数据来源','sourceKind',[['all','全部来源'],['sheet','员工原表'],['portal','工单前端']],L.depositIssuesSourceKind):field('表格入款标记','status',[['all','全部标记'],['未入款','未入款'],['已入款','已入款'],['待核对','待核对']],L.depositIssuesStatus)+field('表格对账','match',[['all','全部'],['matched','对得上'],['unmatched','对不上'],['unknown','待核对']],L.depositIssuesMatch))+
    input('订单号','orderNumber',L.depositIssuesOrderNumber)+input('工单号','workOrderNumber',L.depositIssuesWorkOrderNumber)+input('UTR','utr',L.depositIssuesUtr)+input('UPI ID','upiId',L.depositIssuesUpiId)+input('KYC-UPI ID','kycUpiId',L.depositIssuesKycUpiId)+input('三方回复','reply',L.depositIssuesReply)+(entries?input('原表员工编号','staffCode',L.depositIssuesStaffCode):'')+
    field('UTR 核验','utrMatch',[['','全部'],...[...new Set([...(f.utrMatches||[]),L.depositIssuesUtrMatch].filter(Boolean))].map(v=>[v,v])],L.depositIssuesUtrMatch)+field('KYC 核验','kycCorrect',[['','全部'],...[...new Set([...(f.kycCorrectValues||[]),L.depositIssuesKycCorrect].filter(Boolean))].map(v=>[v,v])],L.depositIssuesKycCorrect)+input('最低金额','amountMin',L.depositIssuesAmountMin,true)+input('最高金额','amountMax',L.depositIssuesAmountMax,true)+
    '<div class="live-actions"><button class="btn primary" type="submit">查询</button><button class="btn" type="button" onclick="depositIssuesReset()">重置</button></div></div></form></section>';
  }
  function summaryCards(result){
   const s=result.summary||{},entries=L.depositIssuesView==='entries';
   return '<div class="live-metrics deposit-metrics">'+(entries?[
    ['跟进记录',C(s.count)],['工单前端记录',C(s.portalCount)],['已关联表格',C(s.linkedCount)],['未关联表格',C(s.unlinkedCount)],['关联待核对',C(s.reviewCount)],['待补 PDF / 视频',C(s.evidenceCount)],['退款相关跟进',C(s.refundCount)]
   ]:[['核对表记录',C(s.count)],['表格未入款金额',N(s.unreceivedAmount)],['表格未入款笔数',C(s.unreceivedCount)],['表格已入款笔数',C(s.receivedCount)],['对得上 / 对不上',C(s.matchedCount)+' / '+C(s.unmatchedCount)],['表格最长未入款',C(s.maxUnreceivedDays)+' 天']]).map(([label,value])=>metric(label,value)).join('')+'</div>';
  }
  function groupTable(result,kind,preview=false){
   let headers,rows,title;
   if(kind==='providers'){
    title='三方未入款统计';headers=['统一三方','对账','未入款笔数','未入款金额','最长天数','已入款笔数'];
    rows=(result.providerSummary||[]).map((r,i)=>['<button class="deposit-table-link" onclick="depositIssuesDrill(\'providers\','+i+')">'+E(r.provider)+'</button>',E(r.matchStatus),C(r.unreceivedCount),N(r.unreceivedAmount),C(r.maxDays),C(r.receivedCount)]);
   }else if(kind==='daily'){
    title='每日核对统计';headers=['原表日期','对得上','对不上','已入款','未入款','待核对','合计','未入款金额'];
    rows=(result.dailySummary||[]).map((r,i)=>[r.date?'<button class="deposit-table-link" onclick="depositIssuesDrill(\'daily\','+i+')">'+E(r.date)+'</button>':'未填写日期',C(r.matchedCount),C(r.unmatchedCount),C(r.receivedCount),C(r.unreceivedCount),C(r.unresolvedCount),C(r.count),N(r.unreceivedAmount)]);
   }else if(kind==='platforms'){
    title=L.depositIssuesView==='entries'?'各平台录入进度':'各平台核对统计';headers=['平台','记录数','前端记录','已关联表格','待关联 / 待核对','表格未入款笔数','表格未入款金额'];
    rows=(result.platformSummary||[]).map((r,i)=>['<button class="deposit-table-link" onclick="depositIssuesDrill(\'platforms\','+i+')">'+E(r.platform)+'</button>',C(r.count),C(r.portalCount),C(r.linkedCount),C(r.unlinkedCount),C(r.unreceivedCount),N(r.unreceivedAmount)]);
   }else{
    title='跟进状态分布';headers=['原表跟进状态','记录数','占录入记录','金额'];
    rows=(result.statusSummary||[]).map((r,i)=>['<button class="deposit-table-link" onclick="depositIssuesDrill(\'statuses\','+i+')">'+E(followupName(r.status))+'</button>',C(r.count),R(r.count,result.summary?.count),N(r.amount)]);
   }
   const id='deposit-'+kind,size=Number(L.tableSizes?.[id]||20),page=Math.min(Number(L.tablePages?.[id]||1),Math.max(1,Math.ceil(rows.length/size)));
   const part=preview?rows.slice(0,8):rows.slice((page-1)*size,page*size);
   const tail=preview?'<div class="deposit-group-more"><button class="btn" onclick="depositIssuesSection(\''+kind+'\')">查看全部 '+C(rows.length)+' 项 →</button></div>':pager(rows.length,page,size,'ref-'+id);
   return box(title,table(headers,part,'deposit-statistics')+tail);
  }
  function details(result){
   const entries=L.depositIssuesView==='entries',rows=result.rows||[];
   const sourceLink=(r)=>{
    if(r.sourceKind==='portal')return '<span title="记录 ID：'+E(r.portalCaseId||'未提供')+'">工单前端</span>';
    const url=entries&&r.sourceGid!=null&&Number.isSafeInteger(Number(r.sourceGid))?entryUrl.replace(/gid=2140568082/g,'gid='+Number(r.sourceGid)) : entries?entryUrl:sourceUrl;
    return '<a href="'+url+'&range=A'+Number(r.sourceRow||1)+':P'+Number(r.sourceRow||1)+'" target="_blank" rel="noopener noreferrer">第 '+C(r.sourceRow)+' 行 ↗</a>';
   };
   const headers=entries?['平台','订单号','工单号','UTR','UPI ID','KYC-UPI ID','金额','三方','跟进状态','三方回复','UTR 核验','KYC 核验','PDF / 视频','跟进时间','Receipt date','距今天数','原表员工编号','首次录入员工','最后跟进员工','表格关联','核对表日期','数据来源']:['原表日期','平台','三方','订单号','UTR','UPI ID','KYC-UPI ID','金额','表格入款标记','未入款天数','表格对账','UTR 匹配','KYC 正确','录入关联','原表','三方回复'];
   const rendered=rows.map(r=>entries?[
    E(r.platform),E(r.orderNumber||'—'),E(r.workOrderNumber||'未填写'),E(r.utr||'—'),E(r.upiId||'—'),E(r.kycUpiId||'—'),r.amount==null?'—':N(r.amount),'<span title="原表三方：'+E(r.rawProvider||r.provider||'未填写')+'">'+E(r.provider||'未填写')+'</span>','<span title="'+E(r.followupStatus)+'">'+E(followupName(r.followupStatus))+'</span>',reply(r.providerReply),E(r.utrMatch||'未填写'),E(r.kycCorrect||'未填写'),reply(r.evidence),E(r.followupAt||'未填写'),'<span title="从 RC 开头订单号提取；原表文本仅保留为参考">'+E(r.orderDate||'—')+'</span>',r.daysSinceOrder==null?'—':C(r.daysSinceOrder),E(r.staffCode||'未提供'),E(r.firstActor||'未提供'),E(r.lastActor||'未提供'),linkState(r)+(r.linkStatus==='matched'?'<div>'+status(r.status,'表格：')+'</div>':''),E(r.resultDate||'—'),sourceLink(r)
   ]:[E(r.recordDate||'未填写日期'),E(r.platform),'<span title="原始三方：'+E(r.rawProvider||r.provider)+'">'+E(r.provider||'—')+'</span>',E(r.orderNumber||'—'),E(r.utr||'—'),E(r.upiId||'—'),E(r.kycUpiId||'—'),N(r.amount),status(r.status),r.status==='已入款'?'—':r.unreceivedDays==null?'—':C(r.unreceivedDays),E(r.matchStatus||'待核对'),E(r.utrMatch||'—'),E(r.kycCorrect||'—'),linkState(r),sourceLink(r),reply(r.providerReply)]);
   return box(entries?'员工跟进明细':'表格核对明细',table(headers,rendered,'deposit-issues-columns'+(entries?' deposit-entry-details':' deposit-result-details'))+pager(Number(result.total||0),L.depositIssuesPage,L.depositIssuesSize,'deposit-issues'));
  }
  function view(){
   const head=toolbar();
   if(L.depositIssuesDirty)return head+'<div class="live-status">筛选条件已修改，点击查询读取原表对应范围。</div>';
   if(L.depositIssuesLoading)return head+'<div class="live-status">正在读取记录和统计…</div>';
   if(L.depositIssuesError)return head+'<div class="live-status live-error">'+E(L.depositIssuesError)+' <button class="btn" onclick="depositIssuesLoad()">重试</button></div>';
   const result=L.depositIssues||{},entries=L.depositIssuesView==='entries',section=L.depositIssuesSection;
   const choices=entries?[['details','跟进明细'],['summary','统计概览'],['platforms','平台统计'],['statuses','跟进状态']]:[['summary','统计概览'],['details','核对明细'],['providers','三方统计'],['daily','每日统计']];
   const tabs='<div class="live-tabs deposit-section-tabs">'+choices.map(([v,l])=>'<button class="'+(section===v?'on':'')+'" onclick="depositIssuesSection(\''+v+'\')">'+l+'</button>').join('')+'</div>';
   const content=section==='summary'?'<div class="deposit-summary-grid">'+(entries?groupTable(result,'platforms',true)+groupTable(result,'statuses',true):groupTable(result,'providers',true)+groupTable(result,'daily',true))+'</div>':section==='details'?details(result):groupTable(result,section);
   const s=result.summary||{},note=entries?'员工填写与跟进状态；成功到其他平台、账号或订单，不代表当前订单已入款。':'来自「UPI核对」表的公式或标记，不代表已核实实际到账；统计按当前筛选重新汇总。';
   return head+(section==='summary'?summaryCards(result):'')+'<div class="deposit-context"><span>'+note+'</span><span>同步于 '+E(result.updatedAt?formatTime(result.updatedAt,'Asia/Kolkata'):'—')+' · 印度时间</span></div>'+tabs+'<div class="deposit-tables">'+content+'</div><p class="live-foot">'+(L.depositIssuesDateMode==='all'?'全部日期包含未填写日期的 '+C(s.undatedCount)+' 条记录。':'按'+(entries?'跟进日期':'核对表日期')+'筛选；未填写日期的记录可在“全部日期”查看。')+' 原表按同平台、订单号与 UTR 关联；重复或金额不一致时保留待核对。工单前端记录独立保留。</p>';
  }
  async function load(reset=false){
   if(!L.catalogReady)return;if(reset)L.depositIssuesPage=1;const serial=++L.depositIssuesSerial;
   L.depositIssuesLoading=true;L.depositIssuesError='';L.depositIssuesDirty=false;L.dirty=false;L.depositIssues=null;render();
   try{
    const q={action:'depositIssues',view:L.depositIssuesView,dateMode:L.depositIssuesDateMode,startAt:L.from.slice(0,10)+'T00:00:00.000Z',endAt:L.to.slice(0,10)+'T23:59:59.000Z',offset:(L.depositIssuesPage-1)*L.depositIssuesSize,limit:L.depositIssuesSize};
    if(L.country!=='all')q.country=L.country;if(L.depositIssuesPlatform&&L.depositIssuesPlatform!=='all')q.platform=L.depositIssuesPlatform;
    if(L.depositIssuesProvider)q.provider=L.depositIssuesProvider;if(L.depositIssuesQuery)q.query=L.depositIssuesQuery;
    for(const [key,field] of Object.entries({orderNumber:'depositIssuesOrderNumber',workOrderNumber:'depositIssuesWorkOrderNumber',utr:'depositIssuesUtr',upiId:'depositIssuesUpiId',kycUpiId:'depositIssuesKycUpiId',reply:'depositIssuesReply',utrMatch:'depositIssuesUtrMatch',kycCorrect:'depositIssuesKycCorrect'}))if(L[field])q[key]=L[field];
    if(L.depositIssuesView==='entries'){if(L.depositIssuesStaffCode)q.staffCode=L.depositIssuesStaffCode;if(L.depositIssuesSourceKind!=='all')q.sourceKind=L.depositIssuesSourceKind}
    for(const [key,field] of [['amountMin','depositIssuesAmountMin'],['amountMax','depositIssuesAmountMax']])if(L[field]!==''){const n=Number(L[field]);if(!Number.isFinite(n)||n<0)throw Error('金额必须是大于或等于 0 的数字');q[key]=n}
    if(q.amountMin!==undefined&&q.amountMax!==undefined&&q.amountMin>q.amountMax)throw Error('最低金额不能大于最高金额');
    if(L.depositIssuesView==='entries'){if(L.depositIssuesFollowupStatus)q.followupStatus=L.depositIssuesFollowupStatus}else{if(L.depositIssuesStatus!=='all')q.status=L.depositIssuesStatus;if(L.depositIssuesMatch!=='all')q.match=L.depositIssuesMatch}
    const data=await request(q);if(serial!==L.depositIssuesSerial)return;L.depositIssues=data;facets[q.view]=data.facets||{};L.depositIssuesLoading=false;render();
   }catch(e){if(serial!==L.depositIssuesSerial)return;L.depositIssuesLoading=false;L.depositIssuesError=e.message||'存款核对记录读取失败';render()}
  }
  function dirty(doRender=true){L.depositIssuesPage=1;L.depositIssuesSerial++;L.depositIssuesDirty=true;L.depositIssuesLoading=false;if(doRender)render()}
  root.depositIssuesSet=function(key,value){
   if(key==='country'){if(!L.catalog.some(p=>p.country===value))return;L.country=value;L.depositIssuesPlatform='all';L.depositIssuesProvider='';delete facets[L.depositIssuesView]}
   else if(key==='platformName')L.depositIssuesPlatform=String(value).slice(0,200);
   else if(key==='provider')L.depositIssuesProvider=String(value).slice(0,200);
   else if(key==='status'){if(!['all','未入款','已入款','待核对'].includes(value))return;L.depositIssuesStatus=value}
   else if(key==='match'){if(!['all','matched','unmatched','unknown'].includes(value))return;L.depositIssuesMatch=value}
   else if(key==='dateMode'){if(!['all','range'].includes(value))return;L.depositIssuesDateMode=value}
   else if(key==='followupStatus')L.depositIssuesFollowupStatus=String(value).slice(0,200);
   else if(key==='sourceKind'){if(!['all','sheet','portal'].includes(value))return;L.depositIssuesSourceKind=value}
   else if(['orderNumber','workOrderNumber','utr','upiId','kycUpiId','reply','utrMatch','kycCorrect','staffCode','amountMin','amountMax'].includes(key))L['depositIssues'+key[0].toUpperCase()+key.slice(1)]=String(value).slice(0,200);
   else if(key==='query')L.depositIssuesQuery=String(value).slice(0,200);else return;dirty(!['query','orderNumber','workOrderNumber','utr','upiId','kycUpiId','reply','staffCode','amountMin','amountMax'].includes(key));
  };
  root.depositIssuesDate=function(key,value){if(!['from','to'].includes(key)||!/^\d{4}-\d{2}-\d{2}$/.test(value))return;L[key]=value+(key==='from'?'T00:00:00':'T23:59:59');L.depositIssuesDateMode='range';dirty()};
  root.depositIssuesSource=function(value){if(!['results','entries'].includes(value))return;L.depositIssuesView=value;L.depositIssuesSection=value==='entries'?'details':'summary';load(true)};
  root.depositIssuesSection=function(value){const valid=L.depositIssuesView==='entries'?['summary','details','platforms','statuses']:['summary','details','providers','daily'];if(valid.includes(value)){L.depositIssuesSection=value;render()}};
  root.depositIssuesReset=function(){Object.assign(L,{depositIssuesDateMode:'all',depositIssuesPlatform:'all',depositIssuesProvider:'',depositIssuesStatus:'all',depositIssuesMatch:'all',depositIssuesQuery:'',depositIssuesFollowupStatus:'',depositIssuesOrderNumber:'',depositIssuesWorkOrderNumber:'',depositIssuesUtr:'',depositIssuesUpiId:'',depositIssuesKycUpiId:'',depositIssuesReply:'',depositIssuesUtrMatch:'',depositIssuesKycCorrect:'',depositIssuesStaffCode:'',depositIssuesSourceKind:'all',depositIssuesAmountMin:'',depositIssuesAmountMax:''});load(true)};
  root.depositIssuesDrill=function(kind,index){
   const key={providers:'providerSummary',daily:'dailySummary',platforms:'platformSummary',statuses:'statusSummary'}[kind],row=L.depositIssues?.[key]?.[index];if(!row)return;
   if(kind==='providers'){L.depositIssuesProvider=row.provider;L.depositIssuesMatch=row.matchStatus==='对得上'?'matched':row.matchStatus==='对不上'?'unmatched':'unknown'}
   else if(kind==='daily'&&row.date){L.from=row.date+'T00:00:00';L.to=row.date+'T23:59:59';L.depositIssuesDateMode='range'}
   else if(kind==='platforms')L.depositIssuesPlatform=row.platform;
   else if(kind==='statuses')L.depositIssuesFollowupStatus=row.status;
   L.depositIssuesSection='details';load(true);
  };
  return {render:view,load};
 }};
})(window);
