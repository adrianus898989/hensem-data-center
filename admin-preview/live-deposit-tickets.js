/* Source ticket rows for the deposit-not-received view. */
(function(root){
 'use strict';
 root.HensemDepositTickets={create({E,box,table,request,render,state,isActive,scope,accessMessage,checkDisplayScope,openDrawer,formatTime}){
  let flight=null,seenScope,detailsOpen=false;
  const text=value=>value==null||value===''?'—':String(value);
  const bool=value=>value===true?'是':value===false?'否':'—';
  const sourceName=value=>({AR:'AR',NEW_AR:'新 AR',newar:'新 AR'}[value]||text(value));
  function amount(value){
   const [whole,fraction='']=root.HensemWorkorderUI.money(value).split('.');
   const digits=fraction.replace(/0+$/,'');
   return digits?whole+'.'+digits:whole;
  }
  const ticketNumber=row=>row.workorderNo||row.workorderId;
  const timestamp=(r,key)=>r[key]&&r.timezone?formatTime(r[key],r.timezone):'—';
  const isIndia=country=>['印度','IN','INDIA'].includes(String(country||'').toUpperCase());
  const status=r=>r.statusLabel||root.HensemWorkorderUI.statusNames[r.statusCode]||(r.statusCode==null?'—':String(r.statusCode));
  const receipt=value=>({Payed:'已支付（Payed）',Cancel:'已取消（Cancel）',Wait:'等待（Wait）'}[value]||text(value));
  const linkedOrder=row=>row.rechargeOrder?.match==='matched'?row.rechargeOrder:null;
  const ticketEvidence={snapshot_only:'仅状态快照',detail:'工单明细'};
  const matchLabels={matched:'已匹配',not_found:'未找到相同支付订单号',no_reference:'工单缺支付订单号',ambiguous:'匹配到多张充值单'};
  function sourceField(row,ticketKey,orderKey,includeOrder){
   const ticketValue=row[ticketKey];
   if(ticketValue!=null&&ticketValue!=='')return {value:ticketValue,source:'工单'};
   const value=includeOrder?linkedOrder(row)?.[orderKey]:null;
   return value!=null&&value!==''?{value,source:'充值单'}:{value:null,source:''};
  }
  function rechargeStatus(row,includeOrder){
   const order=includeOrder?linkedOrder(row):null;
   if(order?.status!=null&&order.status!=='')return {value:receipt(order.status),source:'充值单'};
   return {value:receipt(row.receiptStatus),source:row.receiptStatus?'工单':''};
  }
  function callbackRemark(row,includeOrder){
   const order=includeOrder?linkedOrder(row):null;
   if(order?.status==='已支付'&&order.callbackOutcome==='confirmed')return '已回调';
   if(order?.status==='已取消'&&order.callbackOutcome==='cancelled')return '已回调（取消）';
   return '';
  }
  const signature=draft=>JSON.stringify(draft);
  const orderAccess=()=>['orders','collection'].some(page=>['view','query','detail'].every(action=>root.hensemRoleAllowed?.(page,action)===true));
  function context(){
   const actor=scope();
   return actor&&signature([actor,root.hensemRoleAllowed?.('workorders','detail')===true,orderAccess()]);
  }
  function historyEntry(row,includeDetail){
   if(row.operatedAt)return [timestamp(row,'operatedAt'),row.source==='AR'?'操作时间':'处理时间'];
   if(!includeDetail||!row.sourceOperatedAt)return [null,''];
   const labels={operationTime:'操作时间',operateTime:'操作时间',lastOperateTime:'最近操作',lastUpdateTime:'最后更新'};
   const label=labels[row.operationTimeSource];
   return label?[timestamp(row,'sourceOperatedAt'),label]:[null,''];
  }
  function operatorEntry(row,includeDetail){
   if(row.operatorAccount){
    const updated=includeDetail&&['lastUpdateMan','lastUpdateName'].includes(row.operatorSourceField);
    return [row.operatorAccount,updated?'最后更新人':'工单'];
   }
   return includeDetail&&row.lastUpdatedBy?[row.lastUpdatedBy,'最后更新人']:[null,''];
  }
  function dismiss(){
   if(detailsOpen)root.closeDrawer?.();
   detailsOpen=false;
  }
  function clear(s){
   flight?.controller?.abort();flight=null;dismiss();
   if(s){s.result=null;s.filters=null;s.busy=false;s.error='';s.current=1;s.depositPageStarts=[null];}
  }
  function synchronize(s){
   const now=context();
   if(now!==seenScope){clear(s);s.depositAttempted=false;seenScope=now;}
   return now;
  }
  function validDates(from,to){
   const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
   return day(from)&&day(to)&&from<=to&&Date.parse(to)-Date.parse(from)<=92*86400000;
  }
  async function load(reset=true){
   if(!isActive())return;
   const s=state(),actor=synchronize(s);if(!actor)return;
   const draft={...s.draft},size=s.size,pageNo=reset?1:s.current;
   if(reset||!s.depositPageStarts)s.depositPageStarts=[null];
   const cursor=s.depositPageStarts[pageNo-1];
   const stamp=signature([actor,draft,pageNo,size,cursor]);
   if(flight?.stamp===stamp)return flight.promise;
   flight?.controller?.abort();dismiss();
   s.depositAttempted=true;s.current=pageNo;s.result=null;s.error='';s.filters=null;s.busy=true;
   const task={stamp,controller:typeof root.AbortController==='function'?new root.AbortController():null};
   flight=task;
   const owns=()=>isActive()&&flight===task&&context()===actor&&state()===s&&signature(s.draft)===signature(draft);
   render();
   task.promise=(async()=>{
    try{
     if(!draft.country||draft.country==='all'||root.HensemLiveReportData?.countrySelectable?.(draft.country)===false)throw Error('请选择具体国家 / 地区。');
     if(!validDates(draft.from,draft.to))throw Error('请选择完整的提交日期范围，最长 93 天。');
     const filters={from:draft.from,to:draft.to};
     for(const key of ['team','platform','statusCode','workorderNo','orderNo',...(isIndia(draft.country)?['utr']:[])]){
      const value=String(draft[key]??'').trim();if(value)filters[key]=value;
     }
     checkDisplayScope(filters,draft.country,true);
     const offset=(pageNo-1)*size;
     if(pageNo>1&&!cursor)throw Error('分页位置已失效，请重新查询。');
     const result=await request({action:'workorderRecords',view:'depositTickets',operation:'list',country:draft.country,filters,offset,limit:size,...(cursor?{cursor}:{})},{signal:task.controller?.signal});
     if(!owns())return;
     if(!result||result.view!=='depositTickets'||!Array.isArray(result.rows)||result.rows.length>size||typeof result.hasMore!=='boolean'||
        result.offset!==offset||result.limit!==size||(result.hasMore&&(!result.nextCursor||typeof result.nextCursor!=='object'))||result.rows.some(r=>r.issueKind!=='deposit')){
      throw Error('读取到的工单与当前查询不一致，请重新查询。');
     }
     s.depositPageStarts.splice(pageNo);
     if(result.hasMore)s.depositPageStarts.push(result.nextCursor);
     s.result=result;s.filters=draft;
    }catch(error){
     if(owns()){s.result=null;s.error=error.message||'读取存款工单失败';}
    }finally{
     if(flight===task){flight=null;s.busy=false;if(isActive())render();}
    }
   })();
   return task.promise;
  }
  function scheduleInitial(s,actor){
   if(!actor||s.depositAttempted||flight)return;
   s.depositAttempted=true;
   const initialDraft=signature(s.draft);
   Promise.resolve().then(()=>{if(isActive()&&state()===s&&actor===context()&&initialDraft===signature(s.draft)&&!s.filters&&!s.error&&!flight&&s.depositAttempted)return load(true);});
  }
  function columns(country,includeDetail,includeOrder){
   function sourced(label,ticketKey,orderKey){
    return [label,row=>sourceField(row,ticketKey,orderKey,includeOrder).value,
     row=>sourceField(row,ticketKey,orderKey,includeOrder).source];
   }
   const cols=[['平台',r=>r.platform],['工单号',ticketNumber],['支付订单号',r=>r.orderNo],
    ['工单类型',r=>r.workorderType],['工单状态',status],
    ['充值状态',r=>rechargeStatus(r,includeOrder).value,r=>rechargeStatus(r,includeOrder).source],
    ['工单金额',r=>amount(r.amount)]];
   cols.push(sourced('三方','provider','provider'));
   if(isIndia(country))cols.push(sourced('UTR','utr','utr'));
   cols.push(['提交时间',r=>timestamp(r,'submittedAt')],['工单处理 / 更新',r=>historyEntry(r,includeDetail)[0],r=>historyEntry(r,includeDetail)[1]],['工单操作 / 更新人',r=>operatorEntry(r,includeDetail)[0],r=>operatorEntry(r,includeDetail)[1]],['来源系统',r=>sourceName(r.source)]);
   return cols;
  }
  function paging(s){
   const result=s.result;if(!result)return '';
   const begin=(s.current-1)*s.size,end=begin+result.rows.length;
   return '<div class="live-pager wo-pager"><span>'+ (end>begin?'第 '+(begin+1)+'–'+end+' 条':'本页 0 条')+'</span><div class="right"><select aria-label="每页条数" onchange="workorderDepositSize(this.value)">'+[20,50,100].map(n=>'<option value="'+n+'" '+(n===s.size?'selected':'')+'>'+n+' 条 / 页</option>').join('')+'</select><button type="button" '+(s.current===1?'disabled':'')+' onclick="workorderDepositPage(-1)">上一页</button><span>第 '+s.current+' 页</span><button type="button" '+(!result.hasMore?'disabled':'')+' onclick="workorderDepositPage(1)">下一页</button></div></div>';
  }
  function content(s){
   const actor=synchronize(s);scheduleInitial(s,actor);
   const r=s.result,includeDetail=mayOpen(s),includeOrder=canReadOrders(s),cols=columns(s.draft.country,includeDetail,includeOrder),heads=cols.map(c=>c[0]);
   if(detailsOpen&&!includeDetail)dismiss();
   const rows=(r?.rows||[]).map((row,i)=>cols.map(([label,read,source])=>{
    const value=E(text(read(row)));
    if(label==='工单号'&&read(row)&&includeDetail)return '<button type="button" class="link" title="查看工单详情" onclick="workorderDepositDetail('+i+')">'+value+'</button>';
    if(label==='工单状态'&&row.ticketEvidence==='snapshot_only')return value+' <small class="wo-field-source" title="已采集工单状态，原工单明细尚未入库">仅状态快照</small>';
    if(label==='充值状态'&&includeOrder&&value==='—'&&row.rechargeOrder?.match&&row.rechargeOrder.match!=='matched')return value+' <small class="wo-field-source">'+E(text(matchLabels[row.rechargeOrder.match]))+'</small>';
    const basis=source?.(row);
    const remark=label==='充值状态'?callbackRemark(row,includeOrder):'';
    const note=[remark,basis!=='工单'?basis:''].filter(Boolean).join(' · ');
    return note?value+' <small class="wo-field-source">'+E(note)+'</small>':value;
   }));
   let message='';
   if(!actor)message=accessMessage();
   else if(s.busy)message='正在读取存款工单…';
   else if(s.error)message=s.error;
   else if(!r)message='选择条件后，点击查询。';
   else if(r.sourceStatus==='not_connected')message='所选范围没有接入存款工单明细。';
   else if(!rows.length)message='当前条件下没有已采集的存款未到账工单。';
   const grid=rows.length?table(heads,rows,'wo-deposit-ticket-table'):
    '<div class="live-table table-wrap wo-deposit-ticket-table"><table><thead><tr>'+heads.map(k=>'<th>'+k+'</th>').join('')+'</tr></thead></table></div>';
   const note=message?'<div class="live-status'+(s.error?' live-error':'')+'" role="'+(s.error?'alert':'status')+'">'+E(message)+(s.error?' <button type="button" class="btn" onclick="workorderOperationsLoad()">重试</button>':'')+'</div>':'';
   return box('存款未到账工单',grid+note+paging(s),'显示 AR 和新 AR 的已采集存款工单，每张一行。'+(includeDetail?'点工单号查看详情。':'')+(includeOrder?'标有“充值单”的值来自同平台匹配的支付订单。':''));
  }
  function mayOpen(s){
   return !!s.result?.canDetail&&root.hensemRoleAllowed?.('workorders','detail')===true;
  }
  function canReadOrders(s){return mayOpen(s)&&orderAccess()&&s.result.rows.some(row=>row.rechargeOrder);}
  function changePage(step){
   if(!isActive()||![-1,1].includes(step))return;
   const s=state();synchronize(s);if(!s.result||s.busy||step===1&&!s.result.hasMore||step===-1&&s.current===1)return;
   s.current+=step;return load(false);
  }
  function changeSize(n){
   if(!isActive()||![20,50,100].includes(Number(n)))return;
   const s=state();s.size=Number(n);return load(true);
  }
  const section=(title,entries)=>'<section class="wo-ticket-section"><h3>'+title+'</h3><dl>'+entries.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+E(text(value))+'</dd></div>').join('')+'</dl></section>';
  function rechargeDetail(row,country){
   const link=row.rechargeOrder;
   if(!link)return '';
   const fields=[['匹配结果',matchLabels[link.match]]],callback=callbackRemark(row,true);
   if(linkedOrder(row))fields.push(
    ['支付订单号',row.orderNo],['充值状态',receipt(link.status)],...(callback?[['回调状态',callback]]:[]),
    ['充值订单金额',amount(link.amount)],['充值订单币种',link.currency],
    ['充值三方',link.provider],['充值渠道',link.channelType],...(isIndia(country)?[['充值单 UTR',link.utr]]:[]),
    ['充值完成时间',timestamp({...link,timezone:row.timezone},'completedAt')]);
   return section('关联充值单',fields);
  }
  function detail(i){
   if(!isActive()||!Number.isInteger(i))return;
   const s=state();synchronize(s);
   const r=s.result?.rows?.[i];if(!r||!mayOpen(s)||!s.filters||s.busy||signature(s.draft)!==signature(s.filters))return;
   const payment=[['支付订单号',r.orderNo],['来源订单号',r.sourceOrderNo],...(r.source==='NEW_AR'?[['源存款订单号',r.depositOrderNo],['源充值编号',r.rechargeNumber],['表单订单号',r.formOrderReference],['关联号来源',r.orderReferenceSource==='DHANIWIN:type4:jsonData.490'?'DhaniWin 工单表单（字段 490）':r.orderReferenceSource]]:[]),['工单金额',amount(r.amount)],['工单币种',r.currency],['申请金额',amount(r.requestedAmount)],['申请币种',r.requestedCurrency],['采集币种',r.collectedCurrency],['实付金额',amount(r.paidAmount)],['实付币种',r.paidCurrency],['工单内充值状态',receipt(r.receiptStatus)],['来源支付时间',timestamp(r,'paidAt')],['支付三方',r.provider],['支付渠道',r.channelType],...(r.source==='AR'?[['支付类型编号',r.sourcePayTypeId]]:[])];
   if(isIndia(s.filters.country))payment.push(['UTR',r.utr],['UTR 匹配',bool(r.utrMatched)],['KYC 连接',bool(r.kycConnected)]);
   const history=[['提交时间',timestamp(r,'submittedAt')],[r.source==='AR'?'操作时间':'处理时间',timestamp(r,'operatedAt')],
    ['工单操作账号',r.operatorAccount],['账号来源字段',r.operatorSourceField],['最后更新人',r.lastUpdatedBy],['催单次数',r.reminderCount]];
   if(r.sourceOperatedAt&&r.operationTimeSource==='lastUpdateTime'){
    history.push(['来源最后更新时间',timestamp(r,'sourceOperatedAt')]);
   }else if(r.sourceOperatedAt&&['operationTime','operateTime','lastOperateTime'].includes(r.operationTimeSource)&&
            (r.source!=='AR'||r.sourceOperatedAt!==r.operatedAt)){
    history.push(['来源操作时间',timestamp(r,'sourceOperatedAt')]);
   }
   if(!r.sourceOperatedAt||r.operationTimeSource!=='lastUpdateTime'||r.sourceUpdatedAt!==r.sourceOperatedAt)history.push(['来源更新时间',timestamp(r,'sourceUpdatedAt')]);
   history.push(['采集时间',timestamp(r,'collectedAt')],['时区',r.timezone]);
   detailsOpen=true;
   openDrawer('存款工单 · '+text(ticketNumber(r)),
    section('工单信息',[['团队',r.team],['国家 / 地区',r.country],['平台',r.platform],['来源系统',sourceName(r.source)],['来源平台',r.sourcePlatform],['工单采集记录',ticketEvidence[r.ticketEvidence]],['工单号',ticketNumber(r)],...(r.workorderId&&r.workorderNo&&r.workorderId!==r.workorderNo?[['来源工单 ID',r.workorderId]]:[]),['工单类型',r.workorderType],...(r.source==='AR'?[['工单名称',r.workorderName],['工单类型编号',r.workorderTypeId],['附件类型',Array.isArray(r.attachmentTypes)?r.attachmentTypes.map(t=>({image:'图片',pdf:'PDF',video:'视频'}[t])).filter(Boolean).join(' / '):null]]:[]),['工单状态',status(r)],['来源状态码',r.statusCode]])+
    section('工单内支付信息',payment)+(canReadOrders(s)?rechargeDetail(r,s.filters.country):'')+section('处理记录',history));
  }
  root.workorderDepositPage=changePage;root.workorderDepositSize=changeSize;root.workorderDepositDetail=detail;
  function canExport(s){synchronize(s);return !!s.result?.rows?.length&&!s.busy&&signature(s.filters)===signature(s.draft);}
  function exportRows(s){
   if(!canExport(s))return [];
   const includeOrder=canReadOrders(s),cols=columns(s.filters.country,mayOpen(s),includeOrder);
   cols.push(['工单采集记录',r=>ticketEvidence[r.ticketEvidence]]);
   if(canReadOrders(s))cols.push(['充值单匹配结果',r=>matchLabels[r.rechargeOrder?.match]]);
   const headers=cols.flatMap(([label,,source])=>source?[label,label+'来源']:[label]);
   const data=s.result.rows.map(row=>cols.flatMap(([label,read,source])=>{
    const value=text(read(row)),remark=label==='充值状态'?callbackRemark(row,includeOrder):'';
    const display=remark?value+' · '+remark:value;
    return source?[display,source(row)]:[display];
   }));
   return [headers,...data];
  }
  return {content,load,clear,changed(s){clear(s);s.depositAttempted=true;},canExport,exportRows};
 }};
})(window);
