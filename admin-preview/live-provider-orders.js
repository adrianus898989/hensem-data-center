/* Provider drill-down uses the same authorized, paged order RPC as order details. */
(function(root){
 'use strict';
 root.HensemProviderOrders={create:function({L,E,N,C,table,box,formatTime,query,request,openDrawer}){
  let current=null,serial=0;
  const cancel=()=>{serial++;current=null},previousClose=root.closeDrawer;
  if(typeof previousClose==='function')root.closeDrawer=function(...args){cancel();return previousClose.apply(this,args)};
  const missing=value=>value==null||String(value).trim()===''||['未识别通道','未识别三方','未提供'].includes(String(value).trim());
  function reason(row){
   if(row.provider==='人工充值'&&row.channel_type==='ManualRecharge')return '原始类型为 ManualRecharge，归为人工充值';
   if(row.raw_provider==='人工确认')return '原始记录明确标记人工确认';
   if(row.provider==='人工确认')return missing(row.raw_provider)?'经核对归类为人工确认，原始三方字段仍保留为空':'已按归类规则匹配为人工确认';
   if(!Object.prototype.hasOwnProperty.call(row,'raw_provider'))return '当前接口未提供原始三方字段，请更新数据库查询后核查';
   if(missing(row.raw_provider))return row.provider==='无三方（驳回）'?'驳回订单未分配三方':'原始三方字段为空或未提供，需核对来源后台';
   if(missing(row.provider))return '原始三方尚未匹配归类';
   return row.provider===row.raw_provider?'按原始三方展示':'已按三方归类规则匹配';
  }
  function counts(mode){return (current?.targets||[]).reduce((n,t)=>n+t[mode],0)}
  function show(){
   if(!current)return;
   const s=current,total=counts(s.mode),max=Math.max(1,Math.ceil(total/20));
   const tabs='<div class="tabs">'+(s.status==='success'?[['success','成功时间']]:[['success','成功时间'],['created','创建时间']]).map(([mode,label])=>'<button class="'+(s.mode===mode?'on':'')+'" onclick="liveProviderOrderBasis(\''+mode+'\')">'+label+' · '+C(counts(mode))+' 笔</button>').join('')+'</div>';
   const note='<div class="live-definition">'+E(s.from.replace('T',' ')+' 至 '+s.to.replace('T',' '))+' · '+E(s.currency)+' · '+(s.mode==='success'?'按成功时间读取，包含此前创建、本期成功的订单。':'按创建时间读取本期全部订单。')+' 各平台当地时间。</div>';
   const rows=s.rows.map((r,i)=>[E(r.platform.name),E(r.platform.source),'<button class="link mono" onclick="liveProviderOrder('+i+')">'+E(r.order_number||r.order_no||'—')+'</button>',N(r.amount),E(r.raw_provider===undefined?'接口未提供':r.raw_provider==null||r.raw_provider===''?'（空）':r.raw_provider),E(r.channel_type||'—'),E(r.status||r.status_group||'—'),E(formatTime(r.created_at,r.platform.timezone)),E(formatTime(r.success_at,r.platform.timezone)),E(reason(r))]);
   const nav='<div class="live-pager"><span>'+C(total)+' 笔 · 按平台分页</span><div class="right"><button '+(s.loading||s.page===1?'disabled':'')+' onclick="liveProviderOrderPage('+(s.page-1)+')">上一页</button><span>'+s.page+' / '+max+'</span><button '+(s.loading||s.page>=max?'disabled':'')+' onclick="liveProviderOrderPage('+(s.page+1)+')">下一页</button></div></div>';
   const status=s.loading?'<div class="live-status">正在读取订单明细…</div>':s.error?'<div class="live-status live-error">'+E(s.error)+'</div>':'';
   openDrawer(s.provider+' · '+(s.direction==='charge'?'代收':'代付')+'订单',tabs+note+status+box('订单号与归类依据',table(['平台','包网来源','订单号','金额','原始三方','原始类型','原始状态','创建时间','成功时间','归类依据'],rows,'live-provider-orders')+nav));
  }
  async function load(){
   if(!current)return;const s=current,token=++serial;s.loading=true;s.error='';s.rows=[];show();
   let offset=(s.page-1)*20,remaining=20;
   try{
    for(const target of s.targets){
     if(offset>=target[s.mode]){offset-=target[s.mode];continue}
     const result=await request({...target.request,status:s.mode==='success'?'success':target.request.status,offset,limit:20});
     if(token!==serial||s!==current||s.querySerial!==L.serial)return;
     if(Number(result.total)!==target[s.mode])throw Error('来源订单已更新，请重新查询汇总后打开明细，避免笔数不一致');
     const take=Math.min(remaining,target[s.mode]-offset),rows=(result.rows||[]).slice(0,take);
     if(rows.length!==take)throw Error('订单页未完整返回，请重试');
     s.rows.push(...rows.map(r=>({...r,platform:target.platform})));remaining-=rows.length;offset=0;
     if(!remaining)break;
    }
   }catch(e){if(token!==serial||s!==current||s.querySerial!==L.serial)return;s.rows=[];s.error=e.message||'订单读取失败'}
   if(token!==serial||s!==current||s.querySerial!==L.serial)return;s.loading=false;show();
  }
  async function open(provider,source,direction){
   if(L.loading||L.dirty)return;
   const targets=L.results.filter(r=>!source||r.platform?.source===source).map(result=>{
    const rows=(result.groups?.provider||[]).filter(r=>r.provider===provider&&r.direction===direction);
    return {platform:result.platform,created:rows.reduce((n,r)=>n+Number(r.all_count||0),0),success:rows.reduce((n,r)=>n+Number(r.success_count||0),0),request:{...query(result.platform,'details'),providers:[provider],direction,offset:0,limit:20}};
   }).filter(t=>t.created||t.success).sort((a,b)=>String(a.platform.name).localeCompare(String(b.platform.name))||String(a.platform.id).localeCompare(String(b.platform.id)));
   current={provider,source,direction,targets,status:L.status,mode:L.status==='success'||targets.some(t=>t.success)?'success':'created',page:1,rows:[],error:'',loading:false,querySerial:L.serial,from:L.from,to:L.to,currency:L.currency};
   await load();
  }
  root.liveProviderOrders=open;
  root.liveProviderOrderBasis=async mode=>{if(!current||!['created','success'].includes(mode)||current.status==='success'&&mode==='created')return;current.mode=mode;current.page=1;await load()};
  root.liveProviderOrderPage=async page=>{if(!current||current.loading||!Number.isInteger(page)||page<1||page>Math.max(1,Math.ceil(counts(current.mode)/20)))return;current.page=page;await load()};
  root.liveProviderOrder=index=>{
   const r=current?.rows[index];if(!r)return;
   openDrawer('订单详情 · '+(r.order_number||r.order_no||''),'<button class="btn small" onclick="liveProviderOrdersBack()">← 返回三方订单</button>'+box('订单与归类依据',table(['字段','内容'],[
    ['订单号',E(r.order_number||r.order_no||'—')],['系统订单号',E(r.system_order_id||r.id||'—')],['三方订单号',E(r.third_party_order_number||'—')],['平台 / 包网',E(r.platform.name+' / '+r.platform.source)],['金额',N(r.amount)+' '+E(r.currency||current.currency)],['原始三方',E(r.raw_provider===undefined?'接口未提供':r.raw_provider==null||r.raw_provider===''?'（空）':r.raw_provider)],['归类三方',E(r.provider||'未识别通道')],['原始类型',E(r.channel_type||'—')],['原始状态',E(r.status||r.status_group||'—')],['归类依据',E(reason(r))],['创建时间',E(formatTime(r.created_at,r.platform.timezone))],['成功时间',E(formatTime(r.success_at,r.platform.timezone))],['同步时间',E(formatTime(r.synced_at,r.platform.timezone))],['时区',E(r.platform.timezone)]
   ])));
  };
  root.liveProviderOrdersBack=show;
  return {open,cancel,reason};
 }};
})(window);
