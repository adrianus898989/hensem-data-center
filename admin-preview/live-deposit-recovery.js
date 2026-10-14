/* One authorized reconciliation snapshot drives the table and the workbook. */
(function(root){
 'use strict';
 const columns=[['登记原单','registeredOrders'],['登记已到账','receivedCount'],['登记未到账','unreceivedCount'],['三方已补笔数','thirdPartyRecoveredCount'],['三方已补金额','thirdPartyRecoveredAmount'],['人工补单笔数','manualRecoveredCount'],['人工补单金额','manualRecoveredAmount'],['剩余未补笔数','remainingUnreceivedCount'],['剩余未补金额','remainingUnreceivedAmount'],['差额笔数','differenceCount'],['差额金额','differenceAmount'],['方式待核对笔数','receivedUnknownCount'],['方式待核对原金额','receivedUnknownAmount']];
 const states={all:'全部核对状态',third_party:'三方补单',manual:'人工补单',received_unknown:'已到账 · 补单方式待核对',unreceived:'登记未到账',conflict:'来源冲突'};
 const kindName={third_party:'三方补单',manual:'人工补单',unknown:'方式待核对'};
 function create(ctx){
  const {L,E,C,N,table,box,render,request}=ctx;
  let filters={dateMode:'all',from:'',to:'',platform:'all',provider:'',orderNumber:'',recoveryState:'all'},view='daily',snapshot=null,applied=null,loading=false,exporting=false,error='',dirty=false,serial=0,page=1,limit=50,expanded=null,exportSerial=0;
  function syncBusy(start=false){L.depositRecoveryLoading=loading||exporting;if(start){root.HensemLiveSyncHealth?.cancel?.();root.hensemLiveCancelRequests?.(['syncHealth']);}}
  const amount=v=>v==null?'—':N(v),count=v=>v==null?'—':C(v);
  const esc=v=>E(String(v??''));
  const can=action=>typeof root.hensemRoleAllowed==='function'&&root.hensemRoleAllowed('deposit_statistics',action);
  const ready=()=>L.catalogReady&&can('query');
  const accessIdentity=()=>JSON.stringify([root.hensemDataScope?.identity||null,root.hensemRoleAccess?.mode||null]);
  function options(values,current){return values.map(([v,label])=>'<option value="'+esc(v)+'" '+(v===current?'selected':'')+'>'+esc(label)+'</option>').join('');}
  function query(extra={}){
   if(!ready())throw Error('平台目录尚未读取，或当前账号没有查询权限');
   const q={action:'depositStatistics',section:'recovery',view:view==='details'?'details':'summary',country:'印度',dateMode:filters.dateMode,offset:(page-1)*limit,limit};
   if(filters.dateMode==='range'){
    if(!filters.from||!filters.to)throw Error('请同时填写开始和结束日期');
    q.startAt=filters.from+'T00:00:00.000Z';q.endAt=filters.to+'T23:59:59.000Z';
   }
   if(filters.platform!=='all')q.platform=filters.platform;
   for(const k of ['provider','orderNumber'])if(filters[k].trim())q[k]=filters[k].trim();
   if(filters.recoveryState!=='all')q.recoveryState=filters.recoveryState;
   return Object.assign(q,extra);
  }
  function change(key,value){
   if(!Object.hasOwn(filters,key))return;
   if(key==='dateMode'&&!['all','range'].includes(value)||key==='recoveryState'&&!Object.hasOwn(states,value))return;
   filters[key]=String(value).slice(0,200);if(key==='from'||key==='to')filters.dateMode='range';
   serial++;loading=false;syncBusy();dirty=true;page=1;expanded=null;error='';
   if(!['provider','orderNumber'].includes(key))render();
  }
  function datePreset(which){
   const today=root.HensemWorkorderUI?.today('印度',L.catalog)?.to||new Date().toISOString().slice(0,10);
   if(which==='all'){filters.dateMode='all';filters.from='';filters.to='';}
   else{const d=new Date(today+'T00:00:00Z');if(which==='previous')d.setUTCMonth(d.getUTCMonth()-1,1);else d.setUTCDate(1);filters.from=d.toISOString().slice(0,10);filters.to=which==='previous'?new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10):today;filters.dateMode='range';}
   dirty=true;serial++;loading=false;syncBusy();page=1;render();
  }
  async function load(reset=true){
   if(reset)page=1;let q;try{q=query();}catch(e){error=e.message;render();return;}
   const id=++serial,identity=accessIdentity();loading=true;syncBusy(true);error='';expanded=null;render();
   try{const data=await request(q);if(id!==serial)return;if(identity!==accessIdentity()||!can('view')||!can('query')||q.view==='details'&&!can('detail'))throw Error('账号或数据权限已变化，请重新查询');if(!data||data.section!=='recovery'||!data.summary)throw Error('补单统计返回内容不完整，请重试');snapshot=data;applied=JSON.parse(JSON.stringify(q));dirty=false;loading=false;syncBusy();render();}
   catch(e){if(id!==serial)return;loading=false;syncBusy();page=snapshot?.view==='details'?Math.floor(Number(snapshot.offset||0)/limit)+1:1;error=e.message||'补单核对读取失败';render();}
  }
  function mode(value){if(!['daily','providers','details'].includes(value))return;if(value==='details'&&!can('detail'))return;view=value;expanded=null;if(value==='details'&&snapshot&&!dirty)return load();render();}
  function sourceLink(source){
   if(source.sourceKind==='portal')return '<span>工单工作台</span>';
   const id=String(source.sourceSheet||'').match(/^[a-zA-Z0-9_-]{20,}$/)?.[0],row=Number(source.sourceRow),gid=String(source.sourceGid??'');
   const label=(source.sourceTab||'Google 表格')+(Number.isSafeInteger(row)&&row>0?' · 第 '+row+' 行':'');
   if(!id)return esc(label);
   const hash=/^\d+$/.test(gid)?'gid='+gid+'&':'';
   const range=Number.isSafeInteger(row)&&row>0?'range='+encodeURIComponent((hash?'':"'"+String(source.sourceTab||'').replace(/'/g,"''")+"'!")+'A'+row+':AZ'+row):'';
   return '<a href="https://docs.google.com/spreadsheets/d/'+id+'/edit#'+hash+range+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>';
  }
  function metricValue(row,key){return key.endsWith('Amount')?amount(row[key]):count(row[key]);}
  function sourceName(source){return source.sourceKind==='portal'?'工单工作台':({'1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE':'历史跟进记录（含九月）','1o0nhJfztjVX9gNwH43uPWg5BUuhBxDMZ-_WUWdRd588':'十月跟进记录','1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg':'KYC / UPI 核对表'})[source.sourceSheet]||'已同步来源表';}
  function sourceCoverage(){const rows=snapshot.coverage?.sources||[];return rows.length?table(['数据来源','当前筛选来源行','最近同步'],rows.map(s=>[sourceLink({...s,sourceTab:sourceName(s)}),count(s.rawRows),esc(s.lastObservedAt?ctx.formatTime(s.lastObservedAt,'Asia/Kolkata'):'—')]),'recovery-source-table'):'';}
  function collectedWorkorders(row){
   const coverage=row.workorderCoverage,items=Array.isArray(row.collectedWorkorders)?row.collectedWorkorders:[];
   const note=coverage==='complete'?'已核对该原单的入库工单':coverage==='partial'?'关联结果待核对，暂不汇总工单笔数':'该原单的采集工单尚未关联';
   return box('关联采集工单','<p class="recovery-table-note">'+note+' · 工单已处理不代表到账</p>'+(items.length?table(['来源系统','平台','工单号 / ID','提交日期','源工单状态','金额','同步时间'],items.map(w=>[esc(w.sourceSystem),esc((w.nativePlatforms||[]).join(' / ')),esc(w.workOrderNo||w.workOrderId||'—'),esc(w.submittedDate||'—'),esc(w.sourceWorkorderState||'待核实'),amount(w.amount)+' '+esc(w.currency||''),esc(w.observedAt?ctx.formatTime(w.observedAt,'Asia/Kolkata'):'—')]),'recovery-source-table'):'<p class="recovery-table-note">'+(coverage==='complete'?'未匹配到已入库工单':'暂无可展示的关联记录')+'</p>')+(row.workordersTruncated?'<p class="recovery-table-note">关联候选超过展示范围，当前结果不作为完整笔数。</p>':'')+'<p class="recovery-table-note">按完整充值订单号、平台、币种与金额核对；源采集完整性尚未确认。</p>');
  }
  function summary(){const s=snapshot.summary;return '<div class="recovery-cards">'+[
   ['登记原单',count(s.registeredOrders),'按平台和完整订单号核对'],['登记已到账',count(s.receivedCount),'Google / 工作台登记结果'],['剩余未补',count(s.remainingUnreceivedCount),'金额 '+amount(s.remainingUnreceivedAmount)+' INR'],['三方已补',count(s.thirdPartyRecoveredCount),'已明确补单方式'],['人工补单',count(s.manualRecoveredCount),'已明确补单方式'],['方式待核对',count(s.receivedUnknownCount),'历史成功记录不推测补单方式']
  ].map(([label,value,note])=>'<article><span>'+label+'</span><strong>'+value+'</strong><small>'+note+'</small></article>').join('')+'</div>';}
  function grouped(){const provider=view==='providers',rows=provider?snapshot.providers||[]:snapshot.daily||[];const data=rows.map(r=>[esc(provider?r.provider:r.date||'无有效凭证日期'),...columns.map(([,k])=>metricValue(r,k))]);data.push(['<strong>合计</strong>',...columns.map(([,k])=>'<strong>'+metricValue(snapshot.summary,k)+'</strong>')]);return box(provider?'按三方补单对比':'每日补单对比',table([provider?'三方':'凭证日期',...columns.map(([l])=>l)],data,'recovery-comparison-table')+'<p class="recovery-table-note">共 '+count(rows.length)+' '+(provider?'个三方':'个日期')+' · 已展示全部汇总行 · 金额 INR</p>');}
  function detail(){if(!can('detail'))return '<div class="live-status">当前账号没有核对明细权限。</div>';if(snapshot.view!=='details')return '<div class="live-status">'+(loading?'正在读取核对明细…':'核对明细尚未读取，请点击查询。')+'</div>';const rows=snapshot.rows||[];let html=table(['平台','充值订单','凭证日期','三方','原金额 INR','登记结果','补单方式','补单金额 INR','补单日期','来源数','关联工单','其中已处理','核对'],rows.map((r,i)=>[esc(r.platform),esc(r.orderNumber),esc(r.date||r.orderDate||'—'),esc(r.provider||'未填写'),amount(r.originalAmount),esc(states[r.recoveryState]||'待核对'),esc(kindName[r.recoveryKind]||'方式待核对'),amount(r.recoveryAmount),esc(r.completedAt||'—'),count(r.rawSourceRows),count(r.collectedWorkorderCount),count(r.processedWorkorderCount),'<button class="deposit-table-link" onclick="depositRecoveryDetail('+i+')">'+(expanded===i?'收起':'来源详情')+'</button>']),'recovery-detail-table');
   if(Number.isInteger(expanded)&&rows[expanded]){const r=rows[expanded];html+=box('来源核对 · '+esc(r.orderNumber),table(['来源','登记状态','原金额 INR','补单方式','补单金额 INR','补单日期','同步时间'],(r.sources||[]).map(s=>[sourceLink(s),esc(({received:'登记已到账',unreceived:'登记未到账',other:'其他订单 / 三方',unknown:'待核对'})[s.receiptState]||s.receiptState||'—'),amount(s.originalAmount),esc(kindName[s.recoveryKind]||'未登记'),amount(s.recoveryAmount),esc(s.completedAt||'—'),esc(s.observedAt?ctx.formatTime(s.observedAt,'Asia/Kolkata'):'—')]),'recovery-source-table')+(r.sourcesTruncated?'<p>当前展示前 20 个来源，原单共 '+count(r.rawSourceRows)+' 个来源行。</p>':'')+'<p>'+esc(r.evidenceBasis||'各来源按同平台、完整订单号及金额核对。')+'</p>')+collectedWorkorders(r);}
   const total=Number(snapshot.total||0),max=Math.max(1,Math.ceil(total/limit));return box('原单核对明细',html+'<div class="recovery-pagination"><span>共 '+count(total)+' 笔 · 每页 '+limit+' 笔</span><button class="btn" onclick="depositRecoveryPage(-1)" '+(loading||dirty||page<=1?'disabled':'')+'>上一页</button><span>'+page+' / '+max+'</span><button class="btn" onclick="depositRecoveryPage(1)" '+(loading||dirty||page>=max?'disabled':'')+'>下一页</button></div>');
  }
  function renderView(){
   const platforms=[...new Set(L.catalog.filter(p=>p.country==='印度').map(p=>p.sourceName||p.name).filter(Boolean))].sort();
   if(filters.platform!=='all'&&!platforms.includes(filters.platform))platforms.push(filters.platform);
   const field=(label,body)=>'<label class="live-field"><span>'+label+'</span>'+body+'</label>';
   const input=(key,label,type='search')=>field(label,'<input aria-label="'+label+'" type="'+type+'" maxlength="200" value="'+esc(filters[key])+'" '+(type==='date'?'onchange':'oninput')+'="depositRecoverySet(\''+key+'\',this.value)">');
   const head='<div class="recovery-intro"><div><h2>补单对比</h2><p>按日期和三方核对补单结果，持续汇总历史与工作台记录。</p></div><button class="btn primary" onclick="depositRecoveryExport()" '+(!snapshot||dirty||loading||exporting||(!can('export')||!can('detail'))?'disabled':'')+'>'+(exporting?'正在生成…':'导出补单对比 Excel')+'</button></div>';
   const controls='<section class="panel wo-filter-panel"><form onsubmit="return false" onkeydown="if(event.key===\'Enter\'&&!event.isComposing){event.preventDefault();depositRecoveryQuery()}"><div class="recovery-filter-grid">'+field('平台','<select aria-label="平台" onchange="depositRecoverySet(\'platform\',this.value)">'+options([['all','全部授权平台'],...platforms.map(p=>[p,p])],filters.platform)+'</select>')+input('provider','三方')+input('orderNumber','充值订单号')+input('from','凭证开始日期','date')+input('to','凭证结束日期','date')+field('核对状态','<select aria-label="核对状态" onchange="depositRecoverySet(\'recoveryState\',this.value)">'+options(Object.entries(states),filters.recoveryState)+'</select>')+'</div><div class="wo-filter-actions"><div><button type="button" class="btn" onclick="depositRecoveryDates(\'previous\')">上月</button><button type="button" class="btn" onclick="depositRecoveryDates(\'month\')">本月</button><button type="button" class="btn '+(filters.dateMode==='all'?'on':'')+'" onclick="depositRecoveryDates(\'all\')">全部日期</button><span>按充值凭证日期归组</span></div><button type="button" class="btn primary" onclick="depositRecoveryQuery()" '+(loading||!ready()?'disabled':'')+'>'+(loading?'读取中…':'查询')+'</button></div></form></section>';
   const notices=(error?'<div class="live-status live-error">'+esc(error)+(snapshot?' · 保留上次结果':'')+'</div>':'')+(dirty&&snapshot?'<div class="live-status">筛选已修改，请查询后导出。</div>':'');
   if(!snapshot)return head+controls+notices+'<div class="live-status">'+(loading?'正在核对历史表格与工作台记录…':'选择条件后查询。全部日期包含已同步的历史记录；新增工作台记录进入同一套汇总。')+'</div>';
   const coverage=snapshot.coverage||{},tabs='<div class="live-tabs">'+[['daily','每日对比'],['providers','按三方汇总'],...(can('detail')?[['details','核对明细']]:[])].map(([k,v])=>'<button class="'+(view===k?'on':'')+'" onclick="depositRecoveryView(\''+k+'\')">'+v+'</button>').join('')+'</div>';
   return head+controls+notices+summary()+'<div class="recovery-source-strip"><span>'+esc(coverage.label||'已同步记录；源表完整性以采集状态为准')+'</span><span>来源行 '+count(snapshot.summary.rawSourceRows)+' · 冲突 '+count(snapshot.summary.conflictCount)+'</span><span>更新于 '+esc(snapshot.updatedAt?ctx.formatTime(snapshot.updatedAt,'Asia/Kolkata'):'—')+'</span></div>'+tabs+'<div class="recovery-tables">'+(view==='details'?detail():grouped())+'</div><details class="recovery-method"><summary>统计口径与数据来源</summary>'+sourceCoverage()+'<p>登记原单按国家、平台、完整充值订单号和金额核对；同订单的跟进记录保留来源，不重复计为新订单。工单处理状态与到账登记分别统计。核对明细可查看本页原单关联的采集工单，汇总和导出不把分页工单数量当作全部工单数。</p><p>差额 = 三方已补 − 人工补单。补单方式尚未核对完整时，差额显示“—”。剩余未补单独展示；成功到其他订单或平台不计入本订单到账。</p><p>历史记录未填写补单方式的，保留为“方式待核对”；后续工作台录入的明确补单方式、金额和日期进入对应汇总。Google 表格中的成功标记不等于系统已经核实资金到账。</p><p>此页按 RC 凭证日期统计；采集工单的提交日期与处理状态可在“核对明细”展开查看。Excel 样本按平台、会员、整数金额去重，口径不同，数字不能直接相等。</p></details>';
  }
  function exportSheets(data){
   const numeric=v=>{if(typeof v!=='string'||!/^[-]?\d+(?:\.\d{1,2})?$/.test(v))return v??null;const n=Number(v),parts=v.replace(/^-/, '').split('.'),canonical=(v.startsWith('-')?'-':'')+BigInt(parts[0]).toString()+'.'+(parts[1]||'').padEnd(2,'0');return Number.isFinite(n)&&Math.abs(n)<1e13&&n.toFixed(2)===canonical?n:v;};
   const values=r=>columns.map(([,k])=>k.endsWith('Amount')?numeric(r[k]):r[k]??null),headers=['凭证日期',...columns.map(([l])=>l)];
   return [{name:'补单对比',headers,rows:(data.daily||[]).map(r=>[r.date||'无有效凭证日期',...values(r)]),totalRow:['合计',...values(data.summary)],widths:[20,...columns.map(()=>18)],amountColumns:columns.flatMap(([,k],i)=>k.endsWith('Amount')?[i+1]:[])},{name:'按三方',headers:['三方',...columns.map(([l])=>l)],rows:(data.providers||[]).map(r=>[r.provider||'未填写',...values(r)]),totalRow:['合计',...values(data.summary)],widths:[26,...columns.map(()=>18)],amountColumns:columns.flatMap(([,k],i)=>k.endsWith('Amount')?[i+1]:[])},{name:'核对明细',headers:['平台','充值订单号','凭证日期','三方','原金额 INR','登记状态','补单方式','补单金额 INR','补单日期','来源数'],rows:(data.rows||[]).map(r=>[r.platform,r.orderNumber,r.date||r.orderDate||null,r.provider,numeric(r.originalAmount),states[r.recoveryState]||'待核对',kindName[r.recoveryKind]||'方式待核对',numeric(r.recoveryAmount),r.completedAt??null,r.rawSourceRows].map(v=>v??null))},{name:'口径说明',headers:['项目','说明'],rows:[['日期口径','RC 充值凭证日期；不是跟进日或工单提交日'],['去重口径','同国家、平台、完整订单号核对；缺金额或冲突保留待核对'],['差额','三方已补 - 人工补单；方式不完整时不计算'],['剩余未补','独立统计，不使用差额替代'],['历史来源','Google 历史与十月跟进记录、UPI 核对表'],['后续来源','工单工作台新增和跟进记录'],['到账状态','登记状态，不代表已独立核实实际资金到账'],['范围',JSON.stringify(applied)],['来源覆盖',data.coverage?.label||'来源完整性未确认'],['更新于',data.updatedAt||'未提供'],...(data.coverage?.sources||[]).map(s=>[sourceName(s),'筛选内 '+count(s.rawRows)+' 行；最近同步 '+(s.lastObservedAt||'未提供')])]}];
  }
  async function exportData(){
   if(!snapshot||!applied||loading||exporting)return;
   if(dirty){error='筛选已修改，请先查询后再导出';render();return;}
   if(!can('export')||!can('detail')||!can('query')){error='当前账号没有完整明细导出权限';render();return;}
   exporting=true;syncBusy(true);error='';const id=serial,exportId=++exportSerial,scope=JSON.stringify(filters),identity=accessIdentity();render();
   try{const data=await request({...applied,view:'details',offset:0,export:true});if(serial!==id||scope!==JSON.stringify(filters)||dirty||identity!==accessIdentity()||!ready()||!['view','query','export','detail'].every(can))return;
    if(!data||data.section!=='recovery'||data.exportComplete!==true||!Array.isArray(data.rows)||data.rows.length!==Number(data.total))throw Error('导出未读取完整结果，未生成文件，请缩小范围后重试');
    if(!root.HensemXlsx?.encodeWorkbook)throw Error('Excel 导出模块未加载，请刷新页面');
    const bytes=root.HensemXlsx.encodeWorkbook(exportSheets(data)),blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=root.document.createElement('a');a.href=url;a.download='补单对比-'+(applied.dateMode==='all'?'全部日期':applied.startAt.slice(0,10)+'至'+applied.endAt.slice(0,10))+'.xlsx';root.document.body.appendChild(a);a.click();a.remove();root.setTimeout(()=>URL.revokeObjectURL(url),1000);snapshot={...data,rows:data.rows.slice(0,limit)};page=1;
   }catch(e){if(exportId===exportSerial&&serial===id)error=e.message||'补单对比导出失败';}finally{if(exportId===exportSerial){exporting=false;syncBusy();render();}}
  }
  root.depositRecoverySet=change;root.depositRecoveryDates=datePreset;root.depositRecoveryQuery=()=>!loading&&load();root.depositRecoveryView=mode;root.depositRecoveryExport=exportData;root.depositRecoveryDetail=i=>{if(can('detail')&&Number.isInteger(i)&&i>=0&&i<(snapshot?.rows||[]).length){expanded=expanded===i?null:i;render();}};root.depositRecoveryPage=direction=>{if(loading||dirty||!snapshot)return;page=Math.max(1,Math.min(Math.max(1,Math.ceil(Number(snapshot.total||0)/limit)),page+direction));load(false);};
  return {render:renderView,load,export:exportData,pause:()=>{serial++;exportSerial++;loading=false;exporting=false;syncBusy();},clear:()=>{serial++;exportSerial++;snapshot=null;applied=null;error='';loading=false;exporting=false;dirty=false;syncBusy();},capture:()=>({filters:{...filters},view,snapshot,applied,dirty,page}),restore:s=>{if(s){filters={...s.filters};view=s.view;snapshot=s.snapshot;applied=s.applied;dirty=s.dirty;page=s.page;}},exportSheets};
 }
 root.HensemDepositRecovery={create,columns};
})(window);
