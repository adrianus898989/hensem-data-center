/* Two read-only sheet views. Original input remains in the owner's Google workbook. */
(function(root){
 root.HensemLiveDepositIssues={create:function(ctx){
  const {L,E,C,N,R,metric,box,table,pager,render,request,formatTime}=ctx;
  const sourceUrl='https://docs.google.com/spreadsheets/d/1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg/edit?gid=1642433306#gid=1642433306';
  const entryUrl='https://docs.google.com/spreadsheets/d/1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE/edit?gid=2140568082#gid=2140568082';
  Object.assign(L,{depositIssuesView:'results',depositIssuesSection:'summary',depositIssuesDateMode:'all',depositIssuesMatch:'all',depositIssuesFollowupStatus:''});
  const facets={};
  const followupName=value=>({success:'成功','need to provide pdf/video':'待补 PDF / 视频','not yet received':'尚未收到','success to other platform':'成功到其他平台','success to other id':'成功到其他账号','success to other order':'成功到其他订单',refund:'退款','more than 30days/refund':'超过 30 天 / 退款','more than 15days refund':'超过 15 天 / 退款','save upi / no refund':'保存 UPI / 不退款'}[String(value||'').toLowerCase()]||value||'未填写');
  const reply=value=>value?'<div class="deposit-reply">'+E(value)+'</div>':'<span class="deposit-muted">未填写</span>';
  const status=value=>'<span class="live-badge '+(value==='已入款'?'success':value==='未入款'?'pending':'')+'">'+E(value||'待核对')+'</span>';
  const linkState=r=>'<span class="live-badge '+(r.linkStatus==='matched'?'success':'pending')+'">'+(r.linkStatus==='matched'?'已关联':r.linkStatus==='review'?'关联待核对':L.depositIssuesView==='entries'?'待生成核对结果':'未找到录入记录')+'</span>';
  const option=(value,label,selected)=>'<option value="'+E(value)+'" '+(String(value)===String(selected)?'selected':'')+'>'+E(label)+'</option>';
  function field(label,key,values,value){return '<label class="live-field"><span>'+E(label)+'</span><select onchange="depositIssuesSet(\''+key+'\',this.value)">'+values.map(([v,l])=>option(v,l,value)).join('')+'</select></label>'}
  function toolbar(){
   const f=facets[L.depositIssuesView]||{},entries=L.depositIssuesView==='entries';
   const countries=[...new Set(L.catalog.map(p=>p.country).filter(Boolean))].sort();
   const platforms=[...new Set([...(f.platforms||[]),...L.catalog.filter(p=>p.country===L.country).map(p=>p.name),L.depositIssuesPlatform==='all'?'':L.depositIssuesPlatform].filter(Boolean))].sort();
   const providers=[...new Set([...(f.providers||[]),L.depositIssuesProvider].filter(Boolean))].sort();
   const tabs='<div class="deposit-source-tabs"><div role="tablist" aria-label="存款核对来源">'+[['entries','录入 / 跟进'],['results','核对结果']].map(([v,l])=>'<button class="btn '+(L.depositIssuesView===v?'primary':'')+'" role="tab" aria-selected="'+(L.depositIssuesView===v)+'" onclick="depositIssuesSource(\''+v+'\')">'+l+'</button>').join('')+'</div><a class="btn" href="'+(entries?entryUrl:sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+(entries?'打开录入表':'打开核对原表')+' ↗</a></div>';
   return tabs+'<section class="panel deposit-issues-toolbar"><form onsubmit="event.preventDefault();depositIssuesLoad(true)"><div class="live-filters">'+
    field('日期范围','dateMode',[['all','全部日期'],['range',entries?'按跟进日期':'按核对日期']],L.depositIssuesDateMode)+
    '<label class="live-field"><span>开始日期</span><input type="date" '+(L.depositIssuesDateMode==='all'?'disabled':'')+' value="'+E(L.from.slice(0,10))+'" onchange="depositIssuesDate(\'from\',this.value)"></label><label class="live-field"><span>结束日期</span><input type="date" '+(L.depositIssuesDateMode==='all'?'disabled':'')+' value="'+E(L.to.slice(0,10))+'" onchange="depositIssuesDate(\'to\',this.value)"></label>'+
    field('国家 / 地区','country',countries.map(v=>[v,v]),L.country)+field('平台','platformName',[['all','全部平台'],...platforms.map(v=>[v,v])],L.depositIssuesPlatform)+field('三方','provider',[['','全部三方'],...providers.map(v=>[v,v])],L.depositIssuesProvider)+
    (entries?field('跟进状态','followupStatus',[['','全部状态'],...(f.followupStatuses||[]).map(v=>[v,followupName(v)])],L.depositIssuesFollowupStatus):field('入款状态','status',[['all','全部状态'],['未入款','未入款'],['已入款','已入款'],['待核对','待核对']],L.depositIssuesStatus)+field('对账','match',[['all','全部'],['matched','对得上'],['unmatched','对不上'],['unknown','待核对']],L.depositIssuesMatch))+
    '<label class="live-field deposit-search"><span>订单号 / UTR / 工单号 / 回复关键词</span><input maxlength="200" placeholder="搜索完整记录中的回复或编号" value="'+E(L.depositIssuesQuery)+'" oninput="depositIssuesSet(\'query\',this.value)"></label><div class="live-actions"><button class="btn primary" type="submit">查询</button><button class="btn" type="button" onclick="depositIssuesReset()">重置</button></div></div></form></section>';
  }
  function summaryCards(result){
   const s=result.summary||{},entries=L.depositIssuesView==='entries';
   return '<div class="live-metrics deposit-metrics">'+(entries?[
    ['录入记录',C(s.count)],['已关联核对结果',C(s.linkedCount)],['待生成结果',C(s.unlinkedCount)],['关联待核对',C(s.reviewCount)],['待补 PDF / 视频',C(s.evidenceCount)],['退款相关跟进',C(s.refundCount)]
   ]:[['核对记录',C(s.count)],['未入款金额',N(s.unreceivedAmount)],['未入款笔数',C(s.unreceivedCount)],['已入款笔数',C(s.receivedCount)],['对得上 / 对不上',C(s.matchedCount)+' / '+C(s.unmatchedCount)],['最长未入款',C(s.maxUnreceivedDays)+' 天']]).map(([label,value])=>metric(label,value)).join('')+'</div>';
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
    title=L.depositIssuesView==='entries'?'各平台录入进度':'各平台核对统计';headers=['平台','记录数','已关联','待关联 / 待核对','未入款笔数','未入款金额'];
    rows=(result.platformSummary||[]).map((r,i)=>['<button class="deposit-table-link" onclick="depositIssuesDrill(\'platforms\','+i+')">'+E(r.platform)+'</button>',C(r.count),C(r.linkedCount),C(r.unlinkedCount),C(r.unreceivedCount),N(r.unreceivedAmount)]);
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
    const url=entries&&r.sourceGid!=null&&Number.isSafeInteger(Number(r.sourceGid))?entryUrl.replace(/gid=2140568082/g,'gid='+Number(r.sourceGid)) : entries?entryUrl:sourceUrl;
    return '<a href="'+url+'&range=A'+Number(r.sourceRow||1)+':P'+Number(r.sourceRow||1)+'" target="_blank" rel="noopener noreferrer">第 '+C(r.sourceRow)+' 行 ↗</a>';
   };
   const headers=entries?['平台','工单号 / 订单号','UTR','金额','三方','跟进状态','三方回复','PDF / 视频','跟进时间','核对结果','核对日期','原表']:['原表日期','平台','三方','订单号','UTR','金额','入款状态','未入款天数','对账','UTR 匹配','KYC 正确','录入关联','原表','三方回复'];
   const rendered=rows.map(r=>entries?[
    E(r.platform),'<div class="deposit-order">'+E(r.orderNumber||'—')+'<small>工单 '+E(r.workOrderNumber||'未填写')+'</small></div>',E(r.utr||'—'),N(r.amount),E(r.provider),'<span title="'+E(r.followupStatus)+'">'+E(followupName(r.followupStatus))+'</span>',reply(r.providerReply),reply(r.evidence),E(r.followupAt||'未填写'),linkState(r)+(r.linkStatus==='matched'?'<div>'+status(r.status)+'</div>':''),E(r.resultDate||'—'),sourceLink(r)
   ]:[E(r.recordDate||'未填写日期'),E(r.platform),'<span title="原始三方：'+E(r.rawProvider||r.provider)+'">'+E(r.provider||'—')+'</span>',E(r.orderNumber||'—'),E(r.utr||'—'),N(r.amount),status(r.status),r.status==='已入款'?'—':r.unreceivedDays==null?'—':C(r.unreceivedDays),E(r.matchStatus||'待核对'),E(r.utrMatch||'—'),E(r.kycCorrect||'—'),linkState(r),sourceLink(r),reply(r.providerReply)]);
   return box(entries?'录入 / 跟进明细':'核对结果明细',table(headers,rendered,'deposit-issues-columns'+(entries?'':' deposit-result-details'))+pager(Number(result.total||0),L.depositIssuesPage,L.depositIssuesSize,'deposit-issues'));
  }
  function view(){
   const head=toolbar();
   if(L.depositIssuesDirty)return head+'<div class="live-status">筛选条件已修改，点击查询读取原表对应范围。</div>';
   if(L.depositIssuesLoading)return head+'<div class="live-status">正在读取记录和统计…</div>';
   if(L.depositIssuesError)return head+'<div class="live-status live-error">'+E(L.depositIssuesError)+' <button class="btn" onclick="depositIssuesLoad()">重试</button></div>';
   const result=L.depositIssues||{},entries=L.depositIssuesView==='entries',section=L.depositIssuesSection;
   const choices=entries?[['summary','统计总览'],['details','录入明细'],['platforms','平台统计'],['statuses','跟进状态']]:[['summary','统计总览'],['details','核对明细'],['providers','三方统计'],['daily','每日统计'],['platforms','平台统计']];
   const tabs='<div class="live-tabs deposit-section-tabs">'+choices.map(([v,l])=>'<button class="'+(section===v?'on':'')+'" onclick="depositIssuesSection(\''+v+'\')">'+l+'</button>').join('')+'</div>';
   const content=section==='summary'?'<div class="deposit-summary-grid">'+(entries?groupTable(result,'platforms',true)+groupTable(result,'statuses',true):groupTable(result,'providers',true)+groupTable(result,'daily',true))+'</div>':section==='details'?details(result):groupTable(result,section);
   const s=result.summary||{},note=entries?'录入、跟进状态保留原表原文；成功到其他平台、账号或订单，不视为当前订单已入款。':'未入款金额、笔数及最长天数只统计核对表中「未入款」记录；所有统计覆盖当前筛选的全部记录。';
   return head+summaryCards(result)+'<div class="deposit-context"><span>'+note+'</span><span>同步于 '+E(result.updatedAt?formatTime(result.updatedAt,'Asia/Kolkata'):'—')+' · 印度时间</span></div>'+tabs+'<div class="deposit-tables">'+content+'</div><p class="live-foot">'+(L.depositIssuesDateMode==='all'?'全部日期包含原表未填写日期的 '+C(s.undatedCount)+' 条记录。':'按'+(entries?'跟进日期':'核对表日期')+'筛选；未填写日期的记录可在“全部日期”查看。')+' 按同平台、订单号与 UTR 关联；重复记录或金额不一致时保留待核对。</p>';
  }
  async function load(reset=false){
   if(!L.catalogReady)return;if(reset)L.depositIssuesPage=1;const serial=++L.depositIssuesSerial;
   L.depositIssuesLoading=true;L.depositIssuesError='';L.depositIssuesDirty=false;L.dirty=false;L.depositIssues=null;render();
   try{
    const q={action:'depositIssues',view:L.depositIssuesView,dateMode:L.depositIssuesDateMode,startAt:L.from.slice(0,10)+'T00:00:00.000Z',endAt:L.to.slice(0,10)+'T23:59:59.000Z',offset:(L.depositIssuesPage-1)*L.depositIssuesSize,limit:L.depositIssuesSize};
    if(L.country!=='all')q.country=L.country;if(L.depositIssuesPlatform&&L.depositIssuesPlatform!=='all')q.platform=L.depositIssuesPlatform;
    if(L.depositIssuesProvider)q.provider=L.depositIssuesProvider;if(L.depositIssuesQuery)q.query=L.depositIssuesQuery;
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
   else if(key==='query')L.depositIssuesQuery=String(value).slice(0,200);else return;dirty(key!=='query');
  };
  root.depositIssuesDate=function(key,value){if(!['from','to'].includes(key)||!/^\d{4}-\d{2}-\d{2}$/.test(value))return;L[key]=value+(key==='from'?'T00:00:00':'T23:59:59');L.depositIssuesDateMode='range';dirty()};
  root.depositIssuesSource=function(value){if(!['results','entries'].includes(value))return;L.depositIssuesView=value;L.depositIssuesSection='summary';load(true)};
  root.depositIssuesSection=function(value){const valid=L.depositIssuesView==='entries'?['summary','details','platforms','statuses']:['summary','details','providers','daily','platforms'];if(valid.includes(value)){L.depositIssuesSection=value;render()}};
  root.depositIssuesReset=function(){Object.assign(L,{depositIssuesDateMode:'all',depositIssuesPlatform:'all',depositIssuesProvider:'',depositIssuesStatus:'all',depositIssuesMatch:'all',depositIssuesQuery:'',depositIssuesFollowupStatus:''});load(true)};
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
