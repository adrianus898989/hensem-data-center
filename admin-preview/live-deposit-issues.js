/* Employee follow-up records and derived sheet results stay separate. */
(function(root){
  // Query buttons must work in the read-only iframe without native form submission.
  function readQuery(form,event,run){
   if(event){const input=event.target;if(event.defaultPrevented||event.key!=='Enter'||event.isComposing||event.keyCode===229||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||input?.tagName!=='INPUT'||input.isContentEditable||!['text','search','number','date','datetime-local','time','email','url','tel'].includes(input.type||'text'))return false;event.preventDefault();}
   if(!form||typeof form.reportValidity!=='function'||!form.reportValidity())return false;
   return run();
  }
 root.HensemLiveDepositIssues={create:function(ctx){
  const {L,E,C,N,R,metric,box,table,pager,render,request,formatTime}=ctx;
  const sourceUrl='https://docs.google.com/spreadsheets/d/1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg/edit?gid=1642433306#gid=1642433306';
  const entryUrl='https://docs.google.com/spreadsheets/d/1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE/edit?gid=2140568082#gid=2140568082';
  Object.assign(L,{depositIssuesView:'entries',depositIssuesSection:'details',depositIssuesWorkspace:'sheet',depositIssuesDateMode:'range',depositIssuesDateInitialized:false,depositIssuesMatch:'all',depositIssuesFollowupState:'all',depositIssuesFollowupStatus:'',depositIssuesOrderNumber:'',depositIssuesWorkOrderNumber:'',depositIssuesUtr:'',depositIssuesUpiId:'',depositIssuesKycUpiId:'',depositIssuesReply:'',depositIssuesUtrMatch:'',depositIssuesKycCorrect:'',depositIssuesStaffCode:'',depositIssuesSourceKind:'all',depositIssuesAmountMin:'',depositIssuesAmountMax:''});
  const facets={};
  const kycWorkspace=root.HensemLiveDepositWorkspace?.create(ctx);
  const money=v=>v==null?'—':N(v);
  const known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const share=(value,total)=>known(value)&&known(total)&&Number(total)>0?(Number(value)/Number(total)*100).toFixed(2)+'%':'—';
  function sourceHref(r,fallback=''){
   const sheet=String(r.sourceSheet||''),match=sheet.match(/(?:^|\/d\/)([A-Za-z0-9_-]{20,})(?:\/|$)/),id=match?.[1];
   const rawGid=r.sourceGid,gid=rawGid!==null&&rawGid!==undefined&&/^\d+$/.test(String(rawGid))?String(rawGid):'';
   const row=Number.isSafeInteger(Number(r.sourceRow))&&Number(r.sourceRow)>0?Number(r.sourceRow):null;
   const base=id?'https://docs.google.com/spreadsheets/d/'+id+'/edit':fallback.split(/[?#]/)[0];
   if(!base)return '';const inherited=fallback.match(/[?#&]gid=(\d+)/)?.[1]||'';
   const target=gid||inherited,range=row?(r.sourceTab&&!target?"'"+String(r.sourceTab).replace(/'/g,"''")+"'!":'')+'A'+row+':AZ'+row:'';return base+(target?'?gid='+target:'')+(target||range?'#'+(target?'gid='+target:'')+(range?(target?'&':'')+'range='+encodeURIComponent(range):''):'');
  }
  function sourceAnchor(r,fallback=''){
   if(r.sourceKind==='portal')return '<span>工单工作台</span>';
   const href=sourceHref(r,fallback),label=(r.sourceTab?String(r.sourceTab)+' · ':'')+(r.sourceRow?('第 '+C(r.sourceRow)+' 行'):'原始表格');
   return href?'<a href="'+E(href)+'" target="_blank" rel="noopener noreferrer">'+E(label)+' ↗</a>':'来源未提供';
  }
  function workspaceNav(){return isStatistics()?'<nav class="deposit-workspace-nav" aria-label="未到账数据视图"><button class="'+(L.depositIssuesSection==='kyc'?'':'on')+'" onclick="depositIssuesSection(\'summary\')">核对统计</button><button class="'+(L.depositIssuesSection==='kyc'?'on':'')+'" onclick="depositIssuesSection(\'kyc\')">KYC / NON-KYC 原单匹配</button></nav>':'';}
  let lastReadAt=0,refreshTimer=null;
  function ensureDateRange(){if(L.depositIssuesDateInitialized||!L.catalogReady)return;const range=root.HensemWorkorderUI.recentSevenDays(L.country,L.catalog);L.from=range.from+'T00:00:00';L.to=range.to+'T23:59:59';L.depositIssuesDateMode='range';L.depositIssuesDateInitialized=true;}

  const isStatistics=()=>ctx.page?.()==='deposit_statistics';
  function syncView(){if(ctx.page){const view=isStatistics()?'results':'entries';if(L.depositIssuesView!==view){L.depositIssuesView=view;L.depositIssuesSection=view==='entries'?'details':'summary';L.depositIssues=null;L.depositIssuesError='';L.depositIssuesLoading=false;}}}
  const classification=v=>({received:'本订单入款',unreceived:'本订单未入款',other_order:'入其他订单',other_provider:'转其他三方',unclassified:'未分类',conflict:'来源冲突'}[v]||'未分类');
  root.depositIssuesMethod=()=>{const entries=L.depositIssuesView==='entries';ctx.openDrawer?.('统计口径','<p>'+E(entries?'跟进记录与核对结果分别统计；成功到其他平台、账号或订单，不计为本订单入款。原表按同平台、完整订单号及 UTR 关联，重复或金额不一致时保留待核对。':'汇总、三方和每日视图来自同一份核对明细，不重复累计。入其他订单、转其他三方单独统计；未分类保留待核对。表格标记不代表已核实实际到账。')+'</p><p>'+E(entries?'日期按跟进日期筛选；未填写日期的记录可选“全部日期”查看。':'日期按完整 RC 订单号中的凭证日期筛选；无有效日期的记录可选“全部日期”查看。')+'</p>');};
  const currentPager=(total,page,size)=>root.HensemWorkorderUI?root.HensemWorkorderUI.pager(total,page,size,'depositIssues',L.depositIssuesLoading):pager(total,page,size,'deposit-issues');
  const followupName=value=>({success:'成功',pending:'尚未到账',other_id:'成功到其他账号',other_platform:'成功到其他平台',other_order:'成功到其他订单',over30:'超过 30 天 / 退款',over15:'超过 15 天 / 退款',need_evidence:'待补材料',no_refund:'不退款',appeal:'申诉跟进',unknown:'未填写（前端记录）','need to provide pdf/video':'待补 PDF / 视频','not yet received':'尚未收到','success to other platform':'成功到其他平台','success to other id':'成功到其他账号','success to other order':'成功到其他订单',refund:'退款','more than 30days/refund':'超过 30 天 / 退款','more than 15days refund':'超过 15 天 / 退款','save upi / no refund':'保存 UPI / 不退款'}[String(value||'').toLowerCase()]||value||'未填写');
  const reply=value=>value?'<div class="deposit-reply">'+E(value)+'</div>':'<span class="deposit-muted">未填写</span>';
  const status=(value,prefix='')=>'<span class="live-badge '+(value==='已入款'?'success':value==='未入款'?'pending':'')+'" title="原表公式或标记，不代表已核实实际到账">'+E(prefix)+E(value||'待核对')+'</span>';
  const linkState=r=>r.sourceKind==='portal'?'<span class="deposit-muted" title="前端记录独立保存，不参与旧表自动关联">独立前端记录</span>':'<span class="live-badge '+(r.linkStatus==='matched'?'success':'pending')+'">'+(r.linkStatus==='matched'?'已关联':r.linkStatus==='review'?'关联待核对':L.depositIssuesView==='entries'?'未关联表格':'未找到录入记录')+'</span>';
  const option=(value,label,selected)=>'<option value="'+E(value)+'" '+(String(value)===String(selected)?'selected':'')+'>'+E(label)+'</option>';
  function field(label,key,values,value){return '<label class="live-field"><span>'+E(label)+'</span><select onchange="depositIssuesSet(\''+key+'\',this.value)">'+values.map(([v,l])=>option(v,l,value)).join('')+'</select></label>'}
  function input(label,key,value,numeric=false){const hint={orderNumber:'按订单号',workOrderNumber:'按工单号',utr:'按 UTR',upiId:'按 UPI ID',kycUpiId:'按 KYC-UPI ID',reply:'按回复关键词',staffCode:'按员工编号',amountMin:'不限',amountMax:'不限'}[key]||'';return '<label class="live-field"><span>'+E(label)+'</span><input '+(numeric?'type="number" min="0" step="0.01"':'type="search" maxlength="200"')+' placeholder="'+E(hint)+'" value="'+E(value)+'" oninput="depositIssuesSet(\''+key+'\',this.value)"></label>'}
  function toolbar(){
   ensureDateRange();const f=facets[L.depositIssuesView]||{},entries=L.depositIssuesView==='entries';
   const countries=[...new Set(L.catalog.map(p=>p.country).filter(Boolean))].sort(),platforms=[...new Set([...(f.platforms||[]),...L.catalog.filter(p=>p.country===L.country).map(p=>p.name),L.depositIssuesPlatform==='all'?'':L.depositIssuesPlatform].filter(Boolean))].sort();
   const date=key=>'<label class="live-field"><span>'+(key==='from'?'开始日期':'结束日期')+'</span><input aria-label="'+(key==='from'?'开始日期':'结束日期')+'" type="date" value="'+E(L.depositIssuesDateMode==='all'?'':L[key].slice(0,10))+'" onchange="depositIssuesDate(\''+key+'\',this.value)"></label>';
   const common=field('国家 / 地区','country',countries.map(v=>[v,v]),L.country)+field('平台','platformName',[['all','全部平台'],...platforms.map(v=>[v,v])],L.depositIssuesPlatform)+input('支付订单号','orderNumber',L.depositIssuesOrderNumber)+input('UTR','utr',L.depositIssuesUtr)+date('from')+date('to')+(entries?field('跟进状态','followupStatus',[['','全部状态'],...(f.followupStatuses||[]).map(v=>[v,followupName(v)])],L.depositIssuesFollowupStatus)+field('数据来源','sourceKind',[['all','全部来源'],['sheet','员工原表'],['portal','工单前端']],L.depositIssuesSourceKind):field('表格入款标记','status',[['all','全部标记'],['未入款','未入款'],['已入款','已入款'],['待核对','待核对']],L.depositIssuesStatus)+field('表格对账','match',[['all','全部'],['matched','对得上'],['unmatched','对不上'],['unknown','待核对']],L.depositIssuesMatch));
   const extra=(entries?input('工单号','workOrderNumber',L.depositIssuesWorkOrderNumber):'')+input('三方','provider',L.depositIssuesProvider)+input('UPI ID','upiId',L.depositIssuesUpiId)+input('KYC-UPI ID','kycUpiId',L.depositIssuesKycUpiId)+input('三方回复','reply',L.depositIssuesReply)+(entries?input('原表员工编号','staffCode',L.depositIssuesStaffCode):field('原表确认','confirmation',[['','全部确认'],...(f.confirmations||[]).map(v=>[v,v])],L.depositIssuesConfirmation||''))+field('UTR 核验','utrMatch',[['','全部'],...[...new Set([...(f.utrMatches||[]),L.depositIssuesUtrMatch].filter(Boolean))].map(v=>[v,v])],L.depositIssuesUtrMatch)+field('KYC 核验','kycCorrect',[['','全部'],...[...new Set([...(f.kycCorrectValues||[]),L.depositIssuesKycCorrect].filter(Boolean))].map(v=>[v,v])],L.depositIssuesKycCorrect)+input('最低金额','amountMin',L.depositIssuesAmountMin,true)+input('最高金额','amountMax',L.depositIssuesAmountMax,true);
   return '<section class="panel wo-filter-panel"><form onsubmit="return false" onkeydown="depositIssuesQuery(this,event)"><div class="wo-filter-grid">'+common+'</div><div class="wo-filter-grid wo-more" '+(L.depositIssuesMore?'':'hidden')+'>'+extra+'</div><div class="wo-filter-actions"><div><button type="button" class="btn" aria-expanded="'+!!L.depositIssuesMore+'" onclick="depositIssuesMore()">'+(L.depositIssuesMore?'收起筛选':'更多筛选')+'</button><button type="button" class="btn" title="按所选国家当地日期查看当前已入库记录" onclick="depositIssuesToday()">今天</button><button type="button" class="btn" onclick="depositIssuesMonth()">本月</button><button type="button" class="btn" onclick="depositIssuesSet(\'dateMode\',\'all\')">全部日期</button></div><div><button type="button" class="btn primary" onclick="depositIssuesQuery(this.form)" '+(L.depositIssuesLoading?'disabled':'')+'>查询</button><button class="btn" type="button" onclick="depositIssuesReset()">重置</button></div></div></form></section>';
  }
  function summaryCards(result){
   const s=result.summary||{},entries=L.depositIssuesView==='entries';
   if(entries)return '<div class="live-metrics deposit-metrics">'+[['跟进记录',C(s.count)],['工单前端记录',C(s.portalCount)],['已关联表格',C(s.linkedCount)],['未关联表格',C(s.unlinkedCount)],['关联待核对',C(s.reviewCount)],['待补 PDF / 视频',C(s.evidenceCount)],['退款相关跟进',C(s.refundCount)]].map(([label,value])=>metric(label,value)).join('')+'</div>';
   const rows=[['本订单入款标记','receivedCount','receivedAmount','received'],['本订单未入款标记','unreceivedCount','unreceivedAmount','unreceived'],['入其他订单','otherOrderCount','otherOrderAmount','other'],['转其他三方','otherProviderCount','otherProviderAmount','other'],['未分类 / 来源冲突','unclassifiedCount','unclassifiedAmount','unknown']];
   const count=s.count,amount=s.amount,unit=typeof result.currency==='string'&&/^[A-Z]{3,6}$/.test(result.currency)?' '+E(result.currency):'';
   const overview='<div class="deposit-overview-cards deposit-overview-three"><article class="deposit-overview-card"><span>原支付订单</span><strong>'+C(count)+'<small> 笔</small></strong></article><article class="deposit-overview-card"><span>原单金额'+unit+'</span><strong>'+money(amount)+'</strong></article><article class="deposit-overview-card deposit-tone-unreceived"><span>未成功订单 · 按本订单入款标记</span><strong>'+ (known(s.unresolvedCount)?C(s.unresolvedCount):'—')+'<small> 笔</small></strong><button type="button" class="deposit-table-link" onclick="depositIssuesPending()">查看订单 →</button></article></div>';
   const distribution=table(['核对分类','笔数','笔数占比','金额'+unit,'金额占比'],rows.map(([label,countKey,amountKey])=>[E(label),C(s[countKey]),share(s[countKey],count),money(s[amountKey]),share(s[amountKey],amount)]),'deposit-status-distribution deposit-readable-table');
   const quality='<details class="deposit-quality-details"><summary>数据核对说明</summary><div class="deposit-quality-strip">'+[['原表行',s.rawRowCount],['重复来源行',s.duplicateRows],['来源冲突',s.conflictCount],['原表已确认',s.confirmedCount],['待核实',s.pendingVerificationCount],['对不上',s.unmatchedCount],['无有效日期',s.undatedCount]].filter(([,v])=>v!=null).map(([label,v])=>'<span>'+E(label)+' <b>'+C(v)+'</b></span>').join('')+'</div><p>入其他订单、转其他三方不计为本订单入款；缺金额和来源冲突保留待核对。</p></details>';
   return overview+box('核对结果分布',distribution)+quality;
  }
  function groupTable(result,kind,preview=false){
   let headers,rows,title;
   const grouped=(kind==='providers'?(isStatistics()&&L.depositIssuesSection==='providers'?result.rows||[]:result.providerSummary||[]):(isStatistics()&&L.depositIssuesSection==='daily'?result.rows||[]:result.dailySummary||[]));
   if(kind==='providers'||kind==='daily'){
    const provider=kind==='providers';title=provider?'三方核对分布':'每日核对分布';
    headers=[provider?'统一三方':'凭证日期',...(provider?['对账','原表分类']:[]),'原订单笔数','原订单金额','笔数占比','金额占比','入款笔数','入款金额','未入款笔数','未入款金额','入其他订单笔数','入其他订单金额','转其他三方笔数','转其他三方金额','未分类笔数','未分类金额'];
    rows=grouped.map((r,i)=>[(provider||r.date)?'<button class="deposit-table-link" onclick="depositIssuesDrill(\''+kind+'\','+i+')">'+E(provider?r.provider:r.date)+'</button>':'无有效日期',...(provider?[E(r.matchStatus||'待核对'),E(r.confirmation||'未分类')]:[]),C(r.count),money(r.amount),share(r.count,result.summary?.count),share(r.amount,result.summary?.amount),C(r.receivedCount),money(r.receivedAmount),C(r.unreceivedCount),money(r.unreceivedAmount),C(r.otherOrderCount),money(r.otherOrderAmount),C(r.otherProviderCount),money(r.otherProviderAmount),C(r.unclassifiedCount),money(r.unclassifiedAmount)]);
   }else if(kind==='platforms'){
    title=L.depositIssuesView==='entries'?'各平台录入进度':'各平台核对统计';headers=['平台','记录数','前端记录','已关联表格','待关联 / 待核对','表格未入款笔数','表格未入款金额'];
    rows=(result.platformSummary||[]).map((r,i)=>['<button class="deposit-table-link" onclick="depositIssuesDrill(\'platforms\','+i+')">'+E(r.platform)+'</button>',C(r.count),C(r.portalCount),C(r.linkedCount),C(r.unlinkedCount),C(r.unreceivedCount),N(r.unreceivedAmount)]);
   }else{
    title='跟进状态分布';headers=['原表跟进状态','记录数','占录入记录','金额'];
    rows=(result.statusSummary||[]).map((r,i)=>['<button class="deposit-table-link" onclick="depositIssuesDrill(\'statuses\','+i+')">'+E(followupName(r.status))+'</button>',C(r.count),R(r.count,result.summary?.count),N(r.amount)]);
   }
   const id='deposit-'+kind,size=Number(L.tableSizes?.[id]||20),page=Math.min(Number(L.tablePages?.[id]||1),Math.max(1,Math.ceil(rows.length/size)));
   if(preview&&['providers','daily'].includes(kind)){
    headers=[kind==='providers'?'三方 / 核对分类':'凭证日期','原单笔数','原单金额','笔数占比','金额占比','未入款笔数','未入款金额'];
    rows=grouped.map((r,i)=>['<button class="deposit-table-link" onclick="depositIssuesDrill(\''+kind+'\','+i+')">'+E(kind==='providers'?r.provider:r.date||'无有效日期')+'</button>'+(kind==='providers'?'<small>'+E(r.matchStatus||'待核对')+' · '+E(r.confirmation||'未分类')+'</small>':''),C(r.count),money(r.amount),share(r.count,result.summary?.count),share(r.amount,result.summary?.amount),C(r.unreceivedCount),money(r.unreceivedAmount)]);
   }
   const part=preview?rows.slice(0,8):isStatistics()?rows:rows.slice((page-1)*size,page*size);
   const tail=preview?'<div class="deposit-group-more"><button class="btn" onclick="depositIssuesSection(\''+kind+'\')">查看全部 →</button></div>':isStatistics()?currentPager(Number(result.total||0),L.depositIssuesPage,L.depositIssuesSize):pager(rows.length,page,size,'ref-'+id);
   return box(title,table(headers,part,'deposit-statistics deposit-group-compact deposit-readable-table'+(preview?' deposit-summary-preview':''))+tail);
  }
  let detailRows=[];
  root.depositIssuesDetail=index=>{const row=detailRows[index];if(!row)return;if(isStatistics()){L.depositIssuesExpanded=L.depositIssuesExpanded===index?null:index;render();return;}ctx.openDrawer?.((L.depositIssuesView==='entries'?'跟进详情':'核对详情')+' · '+(row.platform||''),table(['字段','完整内容'],row.fields,'deposit-entry-full-detail'));};
  function details(result){
   const entries=L.depositIssuesView==='entries',rows=result.rows||[];
   const sourceLink=r=>{
    if(r.sourceKind==='portal')return '<span title="记录 ID：'+E(r.portalCaseId||'未提供')+'">工单工作台</span>';
    if(r.sourceRow==null)return '<span>'+C(r.sourceCount||r.sourceRowCount||r.sources?.length)+' 个来源行 · 展开查看</span>';
    return sourceAnchor(r,r.sourceSheet?'':entries?entryUrl:sourceUrl);
   };
   const headers=entries?['平台','订单号','工单号','UTR','UPI ID','KYC-UPI ID','金额','三方','跟进状态','三方回复','UTR 核验','KYC 核验','PDF / 视频','跟进时间','凭证日期','距今天数','原表员工编号','首次录入员工','最后跟进员工','表格关联','核对表日期','数据来源']:['凭证日期','平台','三方','订单号','UTR','UPI ID','KYC-UPI ID','金额','表格入款标记','距今天数','表格对账','原表分类','统计归类','UTR 匹配','KYC 正确','原表','三方回复'];
   const rendered=rows.map(r=>entries?[
    E(r.platform),E(r.orderNumber||'—'),E(r.workOrderNumber||'未填写'),E(r.utr||'—'),E(r.upiId||'—'),E(r.kycUpiId||'—'),r.amount==null?'—':N(r.amount),'<span title="原表三方：'+E(r.rawProvider||r.provider||'未填写')+'">'+E(r.provider||'未填写')+'</span>','<span title="'+E(r.followupStatus)+'">'+E(followupName(r.followupStatus))+'</span>',reply(r.providerReply),E(r.utrMatch||'未填写'),E(r.kycCorrect||'未填写'),reply(r.evidence),E(r.followupAt||'未填写'),'<span title="从 RC 开头订单号提取；原表文本仅保留为参考">'+E(r.orderDate||'—')+'</span>',r.daysSinceOrder==null?'—':C(r.daysSinceOrder),E(r.staffCode||'未提供'),E(r.firstActor||'未提供'),E(r.lastActor||'未提供'),linkState(r)+(r.linkStatus==='matched'?'<div>'+status(r.status,'表格：')+'</div>':''),E(r.resultDate||'—'),sourceLink(r)
   ]:[E(r.orderDate||'未填写日期'),E(r.platform),'<span title="原始三方：'+E(r.rawProvider||r.provider)+'">'+E(r.provider||'—')+'</span>',E(r.orderNumber||'—'),E(r.utr||'—'),E(r.upiId||'—'),E(r.kycUpiId||'—'),money(r.amount),status(r.status),r.daysSinceOrder==null?'—':C(r.daysSinceOrder),E(r.matchStatus||'待核对'),E(r.confirmation||'未分类'),E(classification(r.statisticsStatus)),E(r.utrMatch||'—'),E(r.kycCorrect||'—'),sourceLink(r),reply(r.providerReply)]);
   const fullText=html=>String(html).replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
   detailRows=rendered.map((cells,i)=>({platform:rows[i].platform,fields:headers.map((label,n)=>[label,cells[n]])}));
   if(!entries){
    rows.forEach((r,i)=>{if(Array.isArray(r.sources)&&r.sources.length)detailRows[i].fields.push(['来源行证据',table(['页 / 行','原金额','三方','状态 / 分类','人工 KYC / UTR'],r.sources.map(source=>[sourceAnchor(source),money(source.amount),E(source.provider||'未提供'),E(source.status||'未提供')+' / '+E(source.confirmation||'未提供'),E(source.manualKyc||'未提供')+' / '+E(source.manualUtr||'未提供')]),'deposit-entry-full-detail')+(r.sourcesTruncated?'<p>共 '+C(r.sourceCount)+' 个来源行，当前展示部分。</p>':'')]);});
    const compact=rows.map((r,i)=>[E(r.platform||'—'),'<span class="deposit-order-id">'+E(r.orderNumber||'缺原单号')+'</span>',E(r.provider||'未填写'),money(r.amount),E(classification(r.statisticsStatus)),E(r.matchStatus||'待核对'),E(r.confirmation||'未分类'),E(r.orderDate||'无有效日期'),r.daysSinceOrder==null?'—':C(r.daysSinceOrder),sourceLink(r),'<button type="button" class="deposit-table-link" aria-expanded="'+(L.depositIssuesExpanded===i)+'" onclick="depositIssuesDetail('+i+')">'+(L.depositIssuesExpanded===i?'收起':'展开')+'</button>']);
    let grid=table(['平台','原支付订单','统一三方','金额','核对分类','对账结果','原表确认','凭证日期','天数','来源','操作'],compact,'deposit-compact-details deposit-readable-table');
    if(Number.isInteger(L.depositIssuesExpanded)&&detailRows[L.depositIssuesExpanded]){let n=-1;grid=grid.replace(/<tbody>([\s\S]*?)<\/tbody>/,(_,body)=>'<tbody>'+body.replace(/<tr>[\s\S]*?<\/tr>/g,row=>++n===L.depositIssuesExpanded?row+'<tr class="deposit-inline-detail"><td colspan="11">'+table(['字段','完整内容'],detailRows[n].fields,'deposit-entry-full-detail')+'</td></tr>':row)+'</tbody>');}
    return box(L.depositIssuesFollowupState==='unresolved'?'未成功订单明细':'原订单核对明细',(!rows.length?'<div class="live-empty">'+(L.depositIssuesFollowupState==='unresolved'?'当前条件下没有未成功记录；未读取到的数据不计为成功。':'当前条件下没有核对记录。')+'</div>':grid)+currentPager(Number(result.total||0),L.depositIssuesPage,L.depositIssuesSize));
   }
   if(entries){detailRows=rendered.map((cells,i)=>({platform:rows[i].platform,fields:headers.map((label,n)=>[label,cells[n]])}));rendered.forEach((cells,i)=>{for(let n=0;n<cells.length;n++)cells[n]='<span class="wo-cell-value" title="'+E(fullText(cells[n]))+'">'+cells[n]+'</span>';cells.push('<button type="button" class="link" title="查看完整跟进记录" aria-label="查看完整跟进记录" onclick="depositIssuesDetail('+i+')">详情</button>');});headers.push('操作');}
   return box(entries?'员工跟进明细':'表格核对明细',table(entries?headers.map(label=>'<span title="'+E(label)+'">'+E(label==='距今天数'?'天数':label)+'</span>'):headers,rendered,'deposit-issues-columns'+(entries?' deposit-entry-details':' deposit-result-details'))+currentPager(Number(result.total||0),L.depositIssuesPage,L.depositIssuesSize));
  }
  function view(){
   syncView();startRefresh();const nav=workspaceNav();
   if(isStatistics()&&L.depositIssuesSection==='kyc')return nav+(kycWorkspace?kycWorkspace.render():'<div class="live-status live-error">原单匹配模块尚未加载，请刷新页面。</div>');
   const head=nav+toolbar();

   if(L.depositIssuesLoading&&!L.depositIssues)return head+'<div class="live-status">正在读取记录…</div>';
   if(L.depositIssuesError&&!L.depositIssues)return head+'<div class="live-status live-error">'+E(L.depositIssuesError)+' <button class="btn" onclick="depositIssuesLoad()">重试</button></div>';
   const result=L.depositIssues||{},entries=L.depositIssuesView==='entries',section=L.depositIssuesSection;
   const choices=entries?[]:[['summary','汇总'],['details','UPI核对'],['providers','三方查看'],['daily','每日汇总']];
   const tabs='<div class="live-tabs deposit-section-tabs">'+(!entries?'<button type="button" class="'+(section==='details'&&L.depositIssuesFollowupState==='unresolved'?'on':'')+'" onclick="depositIssuesPending()">未成功订单</button>':'')+choices.map(([v,l])=>'<button class="'+(section===v&&!(v==='details'&&L.depositIssuesFollowupState==='unresolved')?'on':'')+'" onclick="depositIssuesSection(\''+v+'\')">'+l+'</button>').join('')+'</div>';
   const content=!L.depositIssues?'<div class="live-status">选择条件后点击查询。</div>':section==='summary'?'<div class="deposit-summary-grid">'+(entries?groupTable(result,'platforms',true)+groupTable(result,'statuses',true):groupTable(result,'providers',true)+groupTable(result,'daily',true))+'</div>':section==='details'?details(result):groupTable(result,section);
   return head+(L.depositIssuesError?'<div class="live-status live-error">'+E(L.depositIssuesError)+' · 保留上次结果</div>':'')+(L.depositIssuesLoading?'<div class="wo-loading">读取中…</div>':'')+(section==='summary'&&L.depositIssues?summaryCards(result):'')+'<div class="deposit-context"><button type="button" class="deposit-table-link" onclick="depositIssuesMethod()">统计口径</button>'+(entries&&L.depositIssues?'<button type="button" class="deposit-table-link" onclick="depositIssuesRefresh()" '+(L.depositIssuesLoading||L.depositIssuesDirty?'disabled':'')+'>刷新</button><span>每 30 秒更新</span>':'')+'<span>同步于 '+E(result.updatedAt?formatTime(result.updatedAt,'Asia/Kolkata'):'—')+' · 印度时间</span></div>'+tabs+'<div class="deposit-tables">'+content+'</div>';
  }
  async function load(reset=false,background=false){
   if(!L.catalogReady)return;syncView();if(isStatistics()&&L.depositIssuesSection==='kyc')return kycWorkspace?.load();ensureDateRange();if(reset)L.depositIssuesPage=1;const serial=++L.depositIssuesSerial;
   L.depositIssuesLoading=true;L.depositIssuesError='';L.depositIssuesDirty=false;L.dirty=false;if(!background)render();
   try{
    const q={action:isStatistics()?'depositStatistics':'depositIssues',...(isStatistics()?{section:L.depositIssuesSection}:{view:'entries'}),dateMode:L.depositIssuesDateMode,startAt:L.from.slice(0,10)+'T00:00:00.000Z',endAt:L.to.slice(0,10)+'T23:59:59.000Z',offset:(L.depositIssuesPage-1)*L.depositIssuesSize,limit:L.depositIssuesSize};
    if(L.country!=='all')q.country=L.country;if(L.depositIssuesPlatform&&L.depositIssuesPlatform!=='all')q.platform=L.depositIssuesPlatform;
    if(L.depositIssuesProvider)q.provider=L.depositIssuesProvider;if(!isStatistics()&&L.depositIssuesQuery)q.query=L.depositIssuesQuery;
    for(const [key,field] of Object.entries({orderNumber:'depositIssuesOrderNumber',utr:'depositIssuesUtr',upiId:'depositIssuesUpiId',kycUpiId:'depositIssuesKycUpiId',reply:'depositIssuesReply',utrMatch:'depositIssuesUtrMatch',kycCorrect:'depositIssuesKycCorrect'}))if(L[field])q[key]=L[field];
    if(L.depositIssuesView==='entries'){if(L.depositIssuesWorkOrderNumber)q.workOrderNumber=L.depositIssuesWorkOrderNumber;if(L.depositIssuesStaffCode)q.staffCode=L.depositIssuesStaffCode;if(L.depositIssuesSourceKind!=='all')q.sourceKind=L.depositIssuesSourceKind}
    for(const [key,field] of [['amountMin','depositIssuesAmountMin'],['amountMax','depositIssuesAmountMax']])if(L[field]!==''){const n=Number(L[field]);if(!Number.isFinite(n)||n<0)throw Error('金额必须是大于或等于 0 的数字');q[key]=n}
    if(q.amountMin!==undefined&&q.amountMax!==undefined&&q.amountMin>q.amountMax)throw Error('最低金额不能大于最高金额');
    if(L.depositIssuesView==='entries'){if(L.depositIssuesFollowupStatus)q.followupStatus=L.depositIssuesFollowupStatus}else{if(L.depositIssuesStatus!=='all')q.status=L.depositIssuesStatus;if(L.depositIssuesMatch!=='all')q.match=L.depositIssuesMatch}
    if(isStatistics()&&L.depositIssuesConfirmation)q.confirmation=L.depositIssuesConfirmation;
    if(isStatistics()&&L.depositIssuesFollowupState!=='all')q.followupState=L.depositIssuesFollowupState;
    const data=await request(q);if(serial!==L.depositIssuesSerial)return;const max=Math.max(1,Math.ceil(Number(data.total||0)/L.depositIssuesSize));if(L.depositIssuesPage>max){L.depositIssuesPage=max;L.depositIssuesLoading=false;return load();}L.depositIssues=data;L.depositIssuesExpanded=null;facets[L.depositIssuesView]=data.facets||{};L.depositIssuesLoading=false;lastReadAt=Date.now();render();
   }catch(e){if(serial!==L.depositIssuesSerial)return;L.depositIssuesLoading=false;L.depositIssuesError=e.message||'存款核对记录读取失败';render()}
  }
  function refresh(force=false){
   if(ctx.page?.()!=='deposit_tracking'||!L.depositIssues||!L.catalogReady||L.depositIssuesLoading||L.depositIssuesDirty)return;
   if(root.document?.visibilityState==='hidden'||root.document?.activeElement?.closest?.('form')||root.document?.querySelector?.('.drawer-backdrop,.withdraw-drawer-backdrop'))return;
   if(!force&&Date.now()-lastReadAt<30000)return;
   return load(false,true);
  }
  root.depositIssuesRefresh=()=>refresh(true);
  const onFocus=()=>refresh(),onVisibility=()=>{if(root.document?.visibilityState==='visible')refresh()};
  function startRefresh(){if(refreshTimer!==null||ctx.page?.()!=='deposit_tracking'||!L.depositIssues||L.depositIssuesDirty||!root.document||!root.setInterval)return;refreshTimer=root.setInterval(()=>refresh(),30000);root.addEventListener?.('focus',onFocus);root.document.addEventListener?.('visibilitychange',onVisibility);}
  function destroy(){kycWorkspace?.destroy();if(refreshTimer!==null)root.clearInterval?.(refreshTimer);refreshTimer=null;root.removeEventListener?.('focus',onFocus);root.document?.removeEventListener?.('visibilitychange',onVisibility);}
  root.depositIssuesQuery=(form,event)=>readQuery(form,event,()=>{if(!L.depositIssuesLoading)return load(true)});
  function dirty(doRender=true){L.depositIssuesPage=1;L.depositIssuesSerial++;L.depositIssuesDirty=true;L.depositIssuesLoading=false;if(doRender)render()}
  root.depositIssuesSet=function(key,value){
   ensureDateRange();
   if(key==='country'){if(!L.catalog.some(p=>p.country===value))return;L.country=value;L.depositIssuesPlatform='all';L.depositIssuesProvider='';delete facets[L.depositIssuesView]}
   else if(key==='platformName')L.depositIssuesPlatform=String(value).slice(0,200);
   else if(key==='provider')L.depositIssuesProvider=String(value).slice(0,200);
   else if(key==='status'){if(!['all','未入款','已入款','待核对'].includes(value))return;L.depositIssuesStatus=value}
   else if(key==='match'){if(!['all','matched','unmatched','unknown'].includes(value))return;L.depositIssuesMatch=value}
   else if(key==='dateMode'){if(!['all','range'].includes(value))return;L.depositIssuesDateMode=value}
   else if(key==='followupState'){if(!['all','unresolved','received'].includes(value))return;L.depositIssuesFollowupState=value}
   else if(key==='confirmation')L.depositIssuesConfirmation=String(value).slice(0,200);
   else if(key==='followupStatus')L.depositIssuesFollowupStatus=String(value).slice(0,200);
   else if(key==='sourceKind'){if(!['all','sheet','portal'].includes(value))return;L.depositIssuesSourceKind=value}
   else if(['orderNumber','workOrderNumber','utr','upiId','kycUpiId','reply','utrMatch','kycCorrect','staffCode','amountMin','amountMax'].includes(key))L['depositIssues'+key[0].toUpperCase()+key.slice(1)]=String(value).slice(0,200);
   else if(key==='query')L.depositIssuesQuery=String(value).slice(0,200);else return;dirty(!['query','orderNumber','workOrderNumber','utr','upiId','kycUpiId','reply','staffCode','amountMin','amountMax','provider'].includes(key));
  };
  root.depositIssuesDate=function(key,value){ensureDateRange();if(!['from','to'].includes(key)||!/^\d{4}-\d{2}-\d{2}$/.test(value))return;L[key]=value+(key==='from'?'T00:00:00':'T23:59:59');L.depositIssuesDateMode='range';dirty()};
  root.depositIssuesSource=function(value){if(!['results','entries'].includes(value))return;if(ctx.page&&root.setPage){root.setPage(value==='entries'?'deposit_tracking':'deposit_statistics');return;}L.depositIssuesView=value;L.depositIssuesSection=value==='entries'?'details':'summary';L.depositIssues=null;dirty()};
  root.depositIssuesSection=function(value){const valid=isStatistics()?['summary','details','providers','daily','kyc']:['details'];if(valid.includes(value)){const hadResult=!!L.depositIssues||L.depositIssuesSection==='kyc';if(L.depositIssuesSection==='kyc')kycWorkspace?.pause();L.depositIssuesSection=value;L.depositIssuesFollowupState='all';L.depositIssuesExpanded=null;L.depositIssues=null;dirty();if(value==='kyc')return kycWorkspace?.load();if(hadResult)return load(true)}};
  root.depositIssuesPending=()=>{if(!isStatistics())return;kycWorkspace?.pause();L.depositIssuesSection='details';L.depositIssuesFollowupState='unresolved';L.depositIssuesExpanded=null;L.depositIssuesStatus='all';L.depositIssuesConfirmation='';L.depositIssues=null;dirty();return load(true);};
  root.depositIssuesMonth=()=>{if(!L.catalogReady)return;const range=root.HensemWorkorderUI.currentMonth(L.country,L.catalog);L.from=range.from+'T00:00:00';L.to=range.to+'T23:59:59';L.depositIssuesDateMode='range';L.depositIssuesDateInitialized=true;dirty();};
  root.depositIssuesToday=()=>{if(!L.catalogReady)return;const range=root.HensemWorkorderUI.today(L.country,L.catalog.filter(p=>!L.depositIssuesPlatform||L.depositIssuesPlatform==='all'||p.name===L.depositIssuesPlatform));L.from=range.from+'T00:00:00';L.to=range.to+'T23:59:59';L.depositIssuesDateMode='range';L.depositIssuesDateInitialized=true;dirty();};
  root.depositIssuesMore=()=>{L.depositIssuesMore=!L.depositIssuesMore;render()};
  root.depositIssuesPage=value=>{const max=Math.max(1,Math.ceil(Number(L.depositIssues?.total||0)/L.depositIssuesSize));if(Number.isInteger(value)){L.depositIssuesPage=Math.max(1,Math.min(max,value));if(L.depositIssues&&!L.depositIssuesDirty)load();else render()}};
  root.depositIssuesSize=value=>{if([20,50,100].includes(Number(value))){L.depositIssuesSize=Number(value);if(L.depositIssues&&!L.depositIssuesDirty)load(true);else render()}};
  root.depositIssuesJump=value=>{if(/^\d+$/.test(String(value)))root.depositIssuesPage(Number(value))};
  root.depositIssuesReset=function(){Object.assign(L,{depositIssuesDateMode:'range',depositIssuesDateInitialized:false,depositIssuesPlatform:'all',depositIssuesProvider:'',depositIssuesStatus:'all',depositIssuesMatch:'all',depositIssuesQuery:'',depositIssuesFollowupStatus:'',depositIssuesOrderNumber:'',depositIssuesWorkOrderNumber:'',depositIssuesUtr:'',depositIssuesUpiId:'',depositIssuesKycUpiId:'',depositIssuesReply:'',depositIssuesUtrMatch:'',depositIssuesKycCorrect:'',depositIssuesStaffCode:'',depositIssuesSourceKind:'all',depositIssuesAmountMin:'',depositIssuesAmountMax:'',depositIssuesConfirmation:'',depositIssuesFollowupState:'all',depositIssuesExpanded:null});ensureDateRange();L.depositIssues=null;L.depositIssuesError='';dirty()};
  root.depositIssuesDrill=function(kind,index){
   ensureDateRange();
   const key={providers:'providerSummary',daily:'dailySummary',platforms:'platformSummary',statuses:'statusSummary'}[kind],row=(isStatistics()&&L.depositIssuesSection===kind?L.depositIssues?.rows:L.depositIssues?.[key])?.[index];if(!row)return;
   if(kind==='providers'){L.depositIssuesProvider=row.provider;if(isStatistics())L.depositIssuesConfirmation=row.confirmation||'';L.depositIssuesMatch=row.matchStatus==='对得上'?'matched':row.matchStatus==='对不上'?'unmatched':'unknown'}
   else if(kind==='daily'&&row.date){L.from=row.date+'T00:00:00';L.to=row.date+'T23:59:59';L.depositIssuesDateMode='range'}
   else if(kind==='platforms')L.depositIssuesPlatform=row.platform;
   else if(kind==='statuses')L.depositIssuesFollowupStatus=row.status;
   L.depositIssuesSection='details';load(true);
  };
  return {render:view,load,refresh,destroy,pause:()=>{L.depositIssuesSerial++;L.depositIssuesLoading=false;kycWorkspace?.pause();},capture:()=>kycWorkspace?.capture(),restore:value=>kycWorkspace?.restore(value),clear:key=>{if(key==='deposit_statistics')kycWorkspace?.clear();}};
 }};
})(window);
