/* Provider drill-down uses the same authorized, paged order RPC as order details. */
(function(root){
 'use strict';
 const knownMoney=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>=0;
 const settlement=(r,{E})=>knownMoney(r.settlement_amount)&&/^[A-Z]{3,6}$/.test(r.settlement_currency||'')
  ?E(new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(Number(r.settlement_amount)))+' '+E(r.settlement_currency):'—';
 function moneyCell(r,tools){const {E,N}=tools,currency=r.member_currency||r.currency,base=N(r.amount)+(currency?' '+E(currency):'');
  return base+(r.settlement_currency&&r.settlement_currency!==currency?'<small class="analysis-metric-share">结算 '+settlement(r,tools)+'</small>':'');}
 function moneyRows(r,tools){const {E,N}=tools,currency=r.member_currency||r.currency,rows=[[r.member_currency?'法币金额':'订单金额',N(r.amount)+(currency?' '+E(currency):'')]];
  if(Object.hasOwn(r,'settlement_currency')){rows.push(['结算金额',settlement(r,tools)]);if(knownMoney(r.settlement_fee))rows.push(['结算手续费',N(r.settlement_fee)+(r.settlement_currency?' '+E(r.settlement_currency):'')]);if(knownMoney(r.exchange_rate)&&Number(r.exchange_rate)>0)rows.push(['来源汇率',E(r.exchange_rate)]);}
  if(r.platform?.source==='wg'&&r.direction==='charge'&&r.channel_type==='提现转充值'&&r.fee_exempt===true)rows.push(['手续费','0（提现转充值）']);
  return rows;}
 root.HensemProviderOrders={moneyCell,moneyRows,create:function({L,E,N,C,table,box,formatTime,successTimeLabel=p=>p?.capabilities?.successTimeBasis==='order_updated_at'?'成功统计时间（订单更新时间）':p?.capabilities?.successTimeBasis==='source_completed_at'?'成功时间（源订单完成时间）':'成功时间',query,orderFieldValue=(p,key,value)=>value,request,openDrawer}){
  let current=null,serial=0;
  const cancel=()=>{serial++;current=null},previousClose=root.closeDrawer;
  if(typeof previousClose==='function')root.closeDrawer=function(...args){cancel();return previousClose.apply(this,args)};
  const missing=value=>value==null||String(value).trim()===''||['未识别通道','未识别三方','未提供'].includes(String(value).trim());
  function reason(row){
   if(row.platform?.source==='wg'&&row.direction==='charge'&&row.channel_type==='提现转充值')return 'WG 原始类型为提现转充值；内部转账'+(row.fee_exempt===true?'，手续费 0':'');
   if(String(row.provider||'').trim().toUpperCase()==='USDT')return missing(row.raw_provider)?'仅有 USDT 汇总分类，原始通道未提供，支付商待核对':'USDT 是汇总分类；保留原始通道编号，支付商待核对';
   if(row.provider==='人工充值'&&row.channel_type==='ManualRecharge')return '原始类型为 ManualRecharge，归为人工充值';
   if(row.raw_provider==='人工确认')return '原始记录明确标记人工确认';
   if(row.provider==='人工确认')return missing(row.raw_provider)?'经核对归类为人工确认，原始三方字段仍保留为空':'已按归类规则匹配为人工确认';
   if(!Object.prototype.hasOwnProperty.call(row,'raw_provider'))return '当前接口未提供原始三方字段，请更新数据库查询后核查';
   if(missing(row.raw_provider))return row.provider==='无三方（驳回）'?'驳回订单未分配三方':'原始三方字段为空或未提供，需核对来源后台';
   if(missing(row.provider))return '原始三方尚未匹配归类';
   return row.provider===row.raw_provider?'按原始三方展示':'已按三方归类规则匹配';
  }
  function targets(s=current){return (s?.targets||[]).filter(t=>!s.platformId||t.platform.id===s.platformId)}
  function counts(mode){return targets().reduce((n,t)=>n+t[mode],0)}
  function show(){
   if(!current)return;
   const s=current,total=counts(s.mode),max=Math.max(1,Math.ceil(total/20)),successLabels=[...new Set(targets().map(t=>successTimeLabel(t.platform)))],successLabel=successLabels.length===1?(successLabels[0]==='成功统计时间（订单更新时间）'?'成功统计时间（多利按更新时间）':successLabels[0]):'成功统计时间（'+[successLabels.some(x=>x.includes('更新时间'))?'多利按更新时间':'',successLabels.some(x=>x.includes('完成时间'))?'KB按完成时间':''].filter(Boolean).join('；')+'）';
   const tabs='<div class="tabs">'+(s.status==='success'?[['success',successLabel]]:[['success',successLabel],['created','创建时间']]).map(([mode,label])=>'<button class="'+(s.mode===mode?'on':'')+'" onclick="liveProviderOrderBasis(\''+mode+'\')">'+label+' · '+C(counts(mode))+' 笔</button>').join('')+'</div>';
   const note='<div class="live-definition">'+E(s.from.replace('T',' ')+' 至 '+s.to.replace('T',' '))+' · '+E(s.currency)+' · '+(s.mode==='success'?'按'+successLabel+'读取，包含此前创建、本期成功的订单。':'按创建时间读取本期全部订单。')+' 各平台当地时间。</div>';
   const platformFilter='<div class="live-filters"><label>平台<select aria-label="三方订单平台" onchange="liveProviderOrderPlatform(this.value)"><option value="">全部已查询平台</option>'+s.targets.map(t=>'<option value="'+E(t.platform.id)+'" '+(s.platformId===t.platform.id?'selected':'')+'>'+E(t.platform.name+' · '+t.platform.source)+' · '+C(t[s.mode])+' 笔</option>').join('')+'</select></label></div>';
   const usdt=String(s.provider).trim().toUpperCase()==='USDT'?'<div class="live-definition">USDT 是汇总分类，支付商尚未确认。请按原始通道和订单核对。</div>':'';
   const rows=s.rows.map((r,i)=>[E(r.platform.name),E(r.platform.source),'<button class="link mono" onclick="liveProviderOrder('+i+')">'+E(r.order_number||r.order_no||'—')+'</button>',moneyCell(r,{E,N}),E(r.raw_provider===undefined?'接口未提供':r.raw_provider==null||r.raw_provider===''?'（空）':r.raw_provider),E(r.channel_type||'—'),E(r.status||r.status_group||'—'),E(formatTime(r.created_at,r.platform.timezone)),E(formatTime(r.success_at,r.platform.timezone)),E(reason(r))]);
   const nav='<div class="live-pager"><span>'+C(total)+' 笔 · 按平台分页</span><div class="right"><button '+(s.loading||s.error||s.page===1?'disabled':'')+' onclick="liveProviderOrderPage('+(s.page-1)+')">上一页</button><span>'+s.page+' / '+max+'</span><button '+(s.loading||s.error||s.page>=max?'disabled':'')+' onclick="liveProviderOrderPage('+(s.page+1)+')">下一页</button></div></div>';
   const status=s.loading?'<div class="live-status">正在读取订单明细…</div>':s.error?'<div class="live-status live-error">'+E(s.error)+' <button class="btn small" onclick="liveProviderOrderPage('+s.page+')">重试</button></div>':'';
   const orderTable=s.loading||s.error?'':table(['平台','包网来源','订单号','金额','原始三方 / 通道','原始类型','原始状态','创建时间',successLabel,'归类依据'],rows,'live-provider-orders');
   const orderPanel=s.loading||s.error?nav:box('订单号与归类依据',orderTable+nav);
   openDrawer(s.provider+' · '+(s.direction==='charge'?'代收':'代付')+'订单',tabs+platformFilter+note+usdt+status+orderPanel);
  }
  async function load(){
   if(!current)return;const s=current,token=++serial;s.loading=true;s.error='';s.rows=[];show();
   let offset=(s.page-1)*20,remaining=20;
   try{
    for(const target of targets(s)){
     if(offset>=target[s.mode]){offset-=target[s.mode];continue}
     const result=await request({...target.request,status:s.mode==='success'?'success':target.request.status,offset,limit:20});
     if(token!==serial||s!==current||s.querySerial!==L.serial)return;
     if(Number(result.total)!==target[s.mode])throw Error('来源订单已更新，请重新查询汇总后打开明细，避免笔数不一致');
     const take=Math.min(remaining,target[s.mode]-offset),rows=(result.rows||[]).slice(0,take);
     if(rows.length!==take)throw Error('订单页未完整返回，请重试');
     if(s.currencyScoped&&rows.some(row=>row.currency!==s.currency))throw Error('订单币种与汇总行不一致，请重新查询后查看明细');
     s.rows.push(...rows.map(r=>({...r,platform:target.platform})));remaining-=rows.length;offset=0;
     if(!remaining)break;
    }
   }catch(e){if(token!==serial||s!==current||s.querySerial!==L.serial)return;s.rows=[];s.error=e.message||'订单读取失败'}
   if(token!==serial||s!==current||s.querySerial!==L.serial)return;s.loading=false;show();
  }
  async function open(provider,source,direction,platformId='',currency){
   if(L.loading||L.dirty)return;
   const currencyScoped=currency!==undefined;
   if(currencyScoped&&(typeof currency!=='string'||!/^[A-Z]{3,6}$/.test(currency))){cancel();openDrawer('订单明细','<div class="live-status live-error">该行币种未确认，暂不能读取订单明细</div>');return;}
   const targets=L.results.filter(r=>!source||r.platform?.source===source).map(result=>{
    const canonical=value=>root.HensemProviderNames?.canonical(value,result.platform?.country)??String(value??'');
    const rows=(result.groups?.provider||[]).filter(r=>canonical(r.provider)===canonical(provider)&&r.direction===direction&&(!currencyScoped||r.currency===currency));
    const created=rows.reduce((n,r)=>n+Number(r.all_count||0),0),success=rows.reduce((n,r)=>n+Number(r.success_count||0),0);
    if(!(created||success))return null;
    return {platform:result.platform,created,success,request:{...query(result.platform,'details'),...(currencyScoped?{currency}:{}),providers:[provider],direction,offset:0,limit:20}};
   }).filter(Boolean).sort((a,b)=>String(a.platform.name).localeCompare(String(b.platform.name))||String(a.platform.id).localeCompare(String(b.platform.id)));
   if(platformId&&!targets.some(t=>t.platform.id===platformId))return;
   if(currencyScoped&&!targets.length){cancel();openDrawer('订单明细','<div class="live-status live-error">当前已查询结果没有该三方与币种的订单明细</div>');return;}
   current={provider,source,direction,targets,platformId,status:L.status,mode:L.status==='success'||targets.some(t=>(!platformId||t.platform.id===platformId)&&t.success)?'success':'created',page:1,rows:[],error:'',loading:true,querySerial:L.serial,from:L.from,to:L.to,currency:currencyScoped?currency:L.currency,currencyScoped};
   await load();
  }
  root.liveProviderOrders=open;
  root.liveProviderOrderPlatform=async platformId=>{if(!current||platformId&&!current.targets.some(t=>t.platform.id===platformId))return;current.platformId=platformId;current.page=1;await load()};
  root.liveProviderOrderBasis=async mode=>{if(!current||!['created','success'].includes(mode)||current.status==='success'&&mode==='created')return;current.mode=mode;current.page=1;await load()};
  root.liveProviderOrderPage=async page=>{if(!current||current.loading||!Number.isInteger(page)||page<1||page>Math.max(1,Math.ceil(counts(current.mode)/20)))return;current.page=page;await load()};
  root.liveProviderOrder=index=>{
   const r=current?.rows[index];if(!r)return;
   openDrawer('订单详情 · '+(r.order_number||r.order_no||''),'<button class="btn small" onclick="liveProviderOrdersBack()">← 返回三方订单</button>'+box('订单与归类依据',table(['字段','内容'],[
    ['订单号',E(r.order_number||r.order_no||'—')],['系统订单号',E(orderFieldValue(r.platform,'systemOrderId',r.system_order_id||r.id)||'—')],['三方订单号',E(orderFieldValue(r.platform,'thirdPartyOrderNumber',r.third_party_order_number)||'—')],['平台 / 包网',E(r.platform.name+' / '+r.platform.source)],...moneyRows(r,{E,N}),['原始三方 / 通道',E(r.raw_provider===undefined?'接口未提供':r.raw_provider==null||r.raw_provider===''?'（空）':r.raw_provider)],['归类三方',E(r.provider||'未识别通道')],['原始类型',E(r.channel_type||'—')],['原始状态',E(r.status||r.status_group||'—')],['归类依据',E(reason(r))],['创建时间',E(formatTime(r.created_at,r.platform.timezone))],[successTimeLabel(r.platform),E(formatTime(r.success_at,r.platform.timezone))],['同步时间',E(formatTime(r.synced_at,r.platform.timezone))],['时区',E(r.platform.timezone)]
   ],'live-provider-order-detail')));
  };
  root.liveProviderOrdersBack=show;
  return {open,cancel,reason};
 }};
})(window);
