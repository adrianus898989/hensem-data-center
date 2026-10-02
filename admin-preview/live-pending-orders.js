/* Historical pending orders use the exact authorized immutable capture. */
(function(root){
 'use strict';
 function create(ctx){
  let serial=0,query=null,data=null,error='',busy=false,scope=null;
  const E=ctx.E,N=ctx.N,C=ctx.C;
  const cancel=()=>{serial++;query=null;data=null;busy=false;scope=null},previousClose=root.closeDrawer;
  if(typeof previousClose==='function')root.closeDrawer=function(...args){cancel();return previousClose.apply(this,args)};
  const current=()=>ctx.active()&&scope===ctx.scope();
  function time(value,zone){if(!value)return '—';try{return new Date(value).toLocaleString('sv-SE',{timeZone:zone||'UTC',hour12:false})}catch{return '—'}}
  function wait(value){if(value==null||!Number.isFinite(Number(value))||Number(value)<0)return '未知';const h=Number(value);return Math.floor(h/24)+' 天 '+(h%24).toFixed(1)+' 时'}
  function html(){
   let content=busy?'<p role="status">正在读取对应采集时刻的订单…</p>':'';
   if(error)content+='<p class="live-error" role="alert">'+E(error)+' <button type="button" class="btn" onclick="livePendingOrdersRetry()">重试</button></p>';
   if(!data)return content;
   if(!data.available)return content+'<p>该采集时刻未保留完整订单明细。统计不是 0，无法补造历史订单。</p>';
   const title=E(data.platform?.name||'')+' · '+E(data.date)+' 日终 · 实际采集 '+E(time(data.observedAt,data.timezone));
   content+='<p class="pending-orders-summary">'+title+' · '+C(data.total)+' 笔 / '+N(data.amount)+' '+E(data.currency||'币种待核实')+'</p>';
   content+='<div class="pending-orders-scroll"><table class="pending-orders-table"><thead><tr><th>原订单号</th><th>三方 / 原通道</th><th>金额</th><th>申请时间</th><th>已等待</th><th>原状态</th></tr></thead><tbody>'+(data.rows.length?data.rows.map(r=>'<tr><td>'+E(r.orderNumber)+'</td><td>'+E(r.provider)+'<small>'+E(r.rawProvider)+' · '+E(r.channelType)+'</small></td><td>'+N(r.amount)+'</td><td>'+E(String(r.appliedAt||'—').replace('T',' '))+'</td><td>'+E(wait(r.waitHours))+'</td><td>'+E(r.status)+'</td></tr>').join(''):'<tr><td colspan="6">此范围没有待付订单</td></tr>')+'</tbody></table></div>';
   content+='<div class="pending-orders-pages"><button type="button" class="btn" '+(data.offset===0||busy?'disabled':'')+' onclick="livePendingOrdersPage(-1)">上一页</button><span>'+C(data.rows.length?data.offset+1:0)+'–'+C(data.offset+data.rows.length)+' / '+C(data.total)+'</span><button type="button" class="btn" '+(!data.hasMore||busy?'disabled':'')+' onclick="livePendingOrdersPage(1)">下一页</button></div>';
   return content;
  }
  function draw(){if(current())ctx.open('代付中订单明细',html())}
  function valid(r,q){return r&&r.version===1&&typeof r.available==='boolean'&&r.date===q.date&&r.mode===q.mode&&Date.parse(r.observedAt)===Date.parse(q.observedAt)&&Array.isArray(r.rows)&&(!r.available||r.basis==='actual_capture'&&Number.isSafeInteger(r.total)&&r.total>=0&&Number.isSafeInteger(r.offset)&&r.offset===q.offset&&r.limit===q.limit&&typeof r.hasMore==='boolean'&&r.rows.length<=q.limit&&r.rows.every(x=>typeof x.orderNumber==='string'&&typeof x.provider==='string'&&x.amount!=null&&Number.isFinite(Number(x.amount))&&Number(x.amount)>=0&&(x.waitHours==null||Number.isFinite(Number(x.waitHours))&&Number(x.waitHours)>=0)));}
  async function load(){
   if(!query||!current()||!ctx.canDetail())return;
   const token=++serial,q={...query};busy=true;error='';draw();
   try{const result=await ctx.request(q);if(token!==serial||!current())return;
    if(!valid(result,q))throw Error('订单明细响应不完整，请重试');data=result;
   }catch(e){if(token===serial&&current())error=e?.message||'读取未完成，请重试'}
   finally{if(token===serial&&current()){busy=false;draw()}}
  }
  root.livePendingOrdersRetry=()=>load();
  root.livePendingOrdersPage=step=>{if(busy||!data?.available||!current()||![1,-1].includes(step)||step===1&&!data.hasMore)return;query.offset=Math.max(0,data.offset+step*data.limit);load()};
  return {open(input){if(!ctx.active()||!ctx.canDetail())return;serial++;scope=ctx.scope();data=null;error='';query={action:'pendingOrders',date:input.date||input.snapshotDate,platformIds:input.platformIds||[input.platformId],observedAt:input.observedAt,mode:input.mode,limit:50,offset:0};if(input.provider)query.provider=input.provider;return load()},cancel};
 }
 root.HensemPendingOrders={create};
})(typeof window==='undefined'?globalThis:window);
