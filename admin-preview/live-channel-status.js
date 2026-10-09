/* Source channel snapshots are independent of dashboard order success statistics. */
(function(root){
 'use strict';
 const PAGE='channel_status',STALE_MS=15*60*1000;
 const RATE_FIELDS=['10m','30m','1h','4h','8h','24h','today','total'];
 const RATE_LABELS=['近10分钟成功率','近30分钟成功率','近1小时成功率','近4小时成功率','近8小时成功率','近24小时成功率','今日成功率','总成功率'];
 const middleSnapshot=s=>s?.source==='ar_middle';
 const rateColumns=middle=>({fields:middle?['10m','15m',...RATE_FIELDS.slice(1)]:RATE_FIELDS,labels:middle?[RATE_LABELS[0],'近15分钟成功率（源字段）',...RATE_LABELS.slice(1)]:RATE_LABELS});
 const sourceRate=(r,s,k)=>k==='10m'&&middleSnapshot(s)||k==='15m'&&!middleSnapshot(s)?null:r['success_rate_'+k];
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const numeric=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
 const fmt=v=>numeric(v)===null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const rate=v=>{const n=numeric(v);return n!==null&&n>=0&&n<=100?n:null;};
 const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
 const copy=v=>JSON.parse(JSON.stringify(v));
 const supported=p=>p?.capabilities?.channelStatusAvailable===true&&!p.reportOnly;
 function create(c){
  const L=c.L;let serial=0,S=initial(),freshnessTimer=null;
  function initial(){return {version:1,status:'idle',scope:null,response:null,error:'',expanded:null,tab:'charge',includeAbsent:false,receivedAt:0};}
  const allowed=action=>c.roleAllowed?.(action)===true;
  const active=()=>c.getPage()===PAGE&&allowed('view');
  const scope=()=>({platforms:[...new Map(c.selected().map(p=>[p.id,p])).values()],direction:['charge','withdraw'].includes(L.direction)?L.direction:'all',providers:[...new Set(c.activeValues('provider',''))].sort(),country:L.country,team:L.team,source:L.source,multi:L.multi});
  const key=s=>JSON.stringify([s.platforms.map(p=>[p.id,p.source,p.country,supported(p)]).sort(),s.direction,s.providers,s.country,s.team,s.source,s.multi]);
  const matches=()=>!!S.scope&&!L.dirty&&S.scope.key===key(scope());
  const current=()=>active()&&matches();
  const paint=()=>{if(active())c.render();};
  function cancel(){if(freshnessTimer!==null)root.clearTimeout?.(freshnessTimer);freshnessTimer=null;serial++;if(S.status==='loading')S.status='paused';}
  function clear(){cancel();S=initial();}
  function capture(){return copy(S);}
  function restore(value){cancel();S=value?.version===1?copy(value):initial();if(S.status==='loading')S.status='paused';if(!['charge','withdraw'].includes(S.tab))S.tab='charge';S.includeAbsent=S.includeAbsent===true;}
  function validate(response,queryScope){
   const ps=queryScope.platforms.filter(supported),ids=new Map(ps.map(p=>[p.id,p]));
   if(!response||response.version!==1||!stamp(response.queriedAt)||!Array.isArray(response.platforms)||!Array.isArray(response.snapshots))throw Error('通道快照返回不完整，请重新查询');
   if(response.platforms.length!==ids.size||new Set(response.platforms.map(p=>p.id)).size!==ids.size||response.platforms.some(p=>!ids.has(p.id)||p.source!==ids.get(p.id).source))throw Error('通道快照平台范围不匹配');
   const seen=new Set();
   for(const s of response.snapshots){
    const k=s.platformId+'|'+s.direction;
    if(!ids.has(s.platformId)||!['charge','withdraw'].includes(s.direction)||queryScope.direction!=='all'&&queryScope.direction!==s.direction||seen.has(k)||!Array.isArray(s.channels))throw Error('通道快照方向或平台范围不匹配');
    if(middleSnapshot(s)&&ids.get(s.platformId).source!=='ar'||ids.get(s.platformId).capabilities?.channelStatusSource==='ar_middle'&&!middleSnapshot(s))throw Error('通道快照来源不匹配');
    seen.add(k);const channels=new Set();
    if(s.observedAt!==null&&!stamp(s.observedAt)||!s.observedAt&&s.channels.length)throw Error('通道快照缺少采集时间');
    for(const row of s.channels){if(!row||typeof row.channel_id!=='string'||!row.channel_id||channels.has(row.channel_id))throw Error('通道身份缺失或重复');channels.add(row.channel_id);if(queryScope.providers.length&&!queryScope.providers.includes(row.provider))throw Error('通道快照三方范围不匹配');}
   }
   return copy(response);
  }
  async function load(){
   if(!active()||!allowed('query'))return;cancel();const selected=copy(scope());selected.key=key(selected);S={...initial(),tab:['charge','withdraw'].includes(S.tab)?S.tab:'charge',includeAbsent:S.includeAbsent===true,scope:selected,status:'loading'};L.pageQueried=true;L.dirty=false;L.loading=false;const token=++serial;
   const ps=selected.platforms.filter(supported);if(!ps.length){S.status='ready';paint();return;}if(ps.length>20){S.status='error';S.error='每次最多查询 20 个平台';paint();return;}
   paint();try{const response=await c.request({action:'channelStatus',platformIds:ps.map(p=>p.id),direction:selected.direction,...(selected.providers.length?{providers:selected.providers}: {})});if(token!==serial||!current())return;S.response=validate(response,selected);S.receivedAt=Date.now();S.status='ready';}
   catch(error){if(token!==serial||!current())return;S.status='error';S.error=error?.message||'通道状态读取失败';}paint();
  }
  function providers(){return [...new Set((S.response?.snapshots||[]).flatMap(s=>s.channels.map(r=>r.provider)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
  function clock(value,p){if(!stamp(value))return '—';try{return new Intl.DateTimeFormat('zh-CN',{timeZone:p.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));}catch{return value;}}
  const now=()=>Date.parse(S.response?.queriedAt||'')+Math.max(0,Date.now()-S.receivedAt);
  const stale=value=>!stamp(value)||now()-Date.parse(value)>STALE_MS;
  function scheduleFreshness(){
   if(freshnessTimer!==null)root.clearTimeout?.(freshnessTimer);freshnessTimer=null;
   if(!current()||S.status!=='ready'||!S.response)return;
   const times=S.response.snapshots.flatMap(s=>[s.observedAt,...s.channels.map(r=>rowObserved(r,s))]).filter(stamp).map(value=>Date.parse(value)+STALE_MS+1-now()).filter(delay=>delay>0);
   if(times.length)freshnessTimer=root.setTimeout?.(()=>{freshnessTimer=null;if(current()&&S.status==='ready')paint();},Math.min(2147483647,Math.max(10,Math.min(...times))))??null;
  }
  const present=row=>row.is_present!==false;
  const rowObserved=(r,s)=>stamp(r.last_seen_at)||stamp(r.observed_at)||s.observedAt;
  const status=row=>!present(row)?'本次未出现':String(row.status_text||'').trim()||(row.enabled===true?'已启用':row.enabled===false?'已禁用':'未提供');
  const sourcePosition=row=>Number.isSafeInteger(numeric(row.source_position))&&numeric(row.source_position)>=0?numeric(row.source_position):Infinity;
  function allRows(){return (S.response?.snapshots||[]).flatMap(s=>s.channels.map(row=>({row,s,p:S.scope.platforms.find(p=>p.id===s.platformId)}))).sort((a,b)=>a.s.direction.localeCompare(b.s.direction)||String(a.p.name).localeCompare(String(b.p.name))||Number(!present(a.row))-Number(!present(b.row))||sourcePosition(a.row)-sourcePosition(b.row)||Number(b.row.enabled===true)-Number(a.row.enabled===true)||(numeric(a.row.priority)??Infinity)-(numeric(b.row.priority)??Infinity)||String(a.row.channel_name||a.row.channel_id).localeCompare(String(b.row.channel_name||b.row.channel_id)));}
  const rowKey=x=>x.s.platformId+'|'+x.s.direction+'|'+x.row.channel_id;
  function percentage(value){const n=rate(value);return n===null?'—':'<span class="channel-rate'+(n<45?' channel-rate-low':'')+'">'+n.toFixed(2)+'%</span>';}
  const selectedDirection=()=>S.scope?.direction==='all'?S.tab:S.scope?.direction||'charge';
  function columnSpec(direction,part){
   const currencies=[...new Set(part.map(({x})=>x.row.limit_currency).filter(Boolean))],uniform=currencies.length===1&&part.every(({x})=>x.row.limit_currency===currencies[0]),currency=uniform?' ('+currencies[0]+')':'';
   const rates=rateColumns(part.some(({x})=>middleSnapshot(x.s)));
   const headers=['通道名称','支付供应商','通道类型',...(direction==='charge'?['支付方式']:[]),'最小交易金额'+currency,'最大交易金额'+currency,...(uniform?[]:['限额币种']),...rates.labels,'余额','余额币种',...(direction==='charge'?['代收次数要求']:['余额阈值','阈值币种']),'优先级','权重','状态','备注'];
   const widths=headers.map(h=>h==='通道名称'?180:h==='支付供应商'?130:h==='备注'?280:h==='状态'?130:h==='支付方式'?180:h==='代收次数要求'?100:h.includes('源字段')?180:h.includes('成功率')?104:h.includes('币种')?75:h.includes('交易金额')||h==='余额'||h==='余额阈值'?120:h==='权重'||h==='优先级'?75:90);
   return {uniform,headers,widths,rates};
  }
  function noteCell(x,index){const notes=String(x.row.notes||''),expanded=S.expanded===rowKey(x),long=notes.length>50;return '<td class="channel-notes"><div class="channel-notes-text'+(long&&!expanded?' collapsed':'')+'" title="'+E(notes)+'">'+E(notes||'—')+'</div>'+(long&&allowed('detail')?'<button class="link channel-note-toggle" type="button" aria-expanded="'+expanded+'" onclick="liveChannelToggle('+index+')">'+(expanded?'收起备注':'展开备注')+'</button>':'')+'</td>';}
  function rowHtml(x,index,spec){const r=x.row,unseen=!present(r),label=E(r.channel_name||r.channel_id),identity='通道 ID：'+r.channel_id+'；最近出现：'+clock(rowObserved(r,x.s),x.p);return '<tr class="'+(unseen?'channel-absent':'')+'"><th scope="row" class="channel-name" title="'+E(identity)+'">'+label+(S.scope.platforms.filter(supported).length>1?'<small>'+E(x.p.name)+'</small>':'')+'</th><td class="channel-provider">'+E(r.provider||'—')+'</td><td>'+E(r.channel_type||'—')+'</td>'+(x.s.direction==='charge'?'<td class="channel-payment-method">'+E(r.payment_method||'—')+'</td>':'')+'<td class="num">'+fmt(r.min_amount)+'</td><td class="num">'+fmt(r.max_amount)+'</td>'+(!spec.uniform?'<td>'+E(r.limit_currency||'—')+'</td>':'')+spec.rates.fields.map(k=>'<td class="num">'+percentage(sourceRate(r,x.s,k))+'</td>').join('')+'<td class="num">'+fmt(r.balance)+'</td><td>'+E(r.balance_currency||(numeric(r.balance)!==null?'未提供':'—'))+'</td>'+(x.s.direction==='charge'?'<td class="num">'+E(r.required_deposit_count??'—')+'</td>':'<td class="num">'+fmt(r.balance_threshold)+'</td><td>'+E(r.balance_threshold_currency||(numeric(r.balance_threshold)!==null?'未提供':'—'))+'</td>')+'<td class="num">'+E(r.priority??'—')+'</td><td class="num">'+E(r.weight??'—')+'</td><td><span class="channel-state '+(unseen?'missing':r.enabled===true?'enabled':r.enabled===false?'disabled':'')+'" title="'+E(r.status_text||'')+'">'+E(status(r))+'</span>'+(unseen?'<small class="channel-last-seen">最近 '+E(clock(rowObserved(r,x.s),x.p))+'</small>':'')+'</td>'+noteCell(x,index)+'</tr>';}
  function render(){
   if(!active())return '';if(!allowed('query'))return '<div class="live-status">当前角色未获查询权限</div>';
   if(S.status==='idle'||L.dirty)return '<div class="live-status">'+(L.dirty?'筛选条件已修改，':'选择平台，')+'点击查询查看最新通道状态。</div>';
   if(S.status==='loading')return '<div class="live-status" role="status">正在读取最新通道快照…</div>';
   if(S.status==='paused')return '<div class="live-status">查询已暂停，点击查询更新。</div>';
   if(S.error)return '<div class="live-status live-error" role="alert">'+E(S.error)+'</div>';
   if(!matches())return '<div class="live-status">平台范围已变化，点击查询更新。</div>';
   scheduleFreshness();
   const ps=S.scope.platforms,unsupported=ps.filter(p=>!supported(p)),directions=S.scope.direction==='all'?['charge','withdraw']:[S.scope.direction],rows=allRows(),direction=selectedDirection(),hasSourceOrder=rows.filter(x=>present(x.row)).length>0&&rows.filter(x=>present(x.row)).every(x=>Number.isFinite(sourcePosition(x.row)));
   let html='<div class="channel-scope-note">只读展示源站配置 · 成功率按源站口径 · '+(hasSourceOrder?'源页顺序':'启用优先，优先级从小到大')+'</div>';
   if(unsupported.length){const names=E(unsupported.map(p=>p.name).join('、'));html+=unsupported.length>3?'<details class="channel-unavailable channel-unsupported-list"><summary>未接入通道快照：'+unsupported.length+' 个平台</summary><div>'+names+'</div></details>':'<div class="channel-unavailable">未接入通道快照：'+names+'</div>';}
   if(!ps.filter(supported).length)return html+'<div class="live-status">所选平台尚未接入通道快照。</div>';
   html+='<div class="channel-tabs" role="tablist" aria-label="充值和提现通道">'+directions.map(d=>'<button type="button" role="tab" aria-selected="'+(direction===d)+'" class="'+(direction===d?'on':'')+'" onclick="liveChannelTab(\''+d+'\')">'+(d==='charge'?'充值通道':'提现通道')+'</button>').join('')+'</div>';
   const snapshots=(S.response?.snapshots||[]).filter(s=>s.direction===direction),directionRows=rows.map((x,index)=>({x,index})).filter(({x})=>x.s.direction===direction),absent=directionRows.filter(({x})=>!present(x.row)),part=directionRows.filter(({x})=>S.includeAbsent||present(x.row)),known=ps.filter(supported),notes=known.map(p=>{const s=snapshots.find(s=>s.platformId===p.id);return '<span>'+E(p.name)+' · 最新采集 '+(!s?.observedAt?'— · 尚未收到快照':E(clock(s.observedAt,p))+'（'+E(p.timezone||'UTC')+'） <span class="'+(stale(s.observedAt)?'channel-stale':'')+'">'+(s.complete===true?'':'采集未完整 · ')+(stale(s.observedAt)?'超过 15 分钟未更新':'已更新')+'</span>')+'</span>';}).join('');
   html+='<section class="channel-panel" role="tabpanel"><header><div class="channel-snapshot-times">'+notes+'</div><span>'+(snapshots.length===known.length&&snapshots.every(s=>s.observedAt&&s.complete===true)?part.filter(({x})=>present(x.row)).length+' 个当前通道':part.length?'已读 '+part.filter(({x})=>present(x.row)).length+' 个当前通道':'当前通道 —')+(absent.length?' <label class="channel-history-toggle"><input type="checkbox" '+(S.includeAbsent?'checked ':'')+'onchange="liveChannelAbsent(this.checked)">显示本次未出现 ('+absent.length+')</label>':'')+'</span></header>';
   if(!part.length)html+='<div class="channel-empty">'+(S.scope.providers.length?'当前三方筛选没有匹配通道':snapshots.length===known.length&&snapshots.every(s=>s.complete===true&&s.observedAt)?'已采集，暂无通道':'尚未收到完整通道快照')+'</div>';
   else {const spec=columnSpec(direction,part);html+='<div class="channel-scroll" tabindex="0" aria-label="'+(direction==='charge'?'充值':'提现')+'通道配置，可横向滚动"><table class="channel-table" style="width:'+spec.widths.reduce((a,b)=>a+b,0)+'px"><colgroup>'+spec.widths.map(w=>'<col style="width:'+w+'px">').join('')+'</colgroup><thead><tr>'+spec.headers.map((h,i)=>'<th'+(i===0?' class="channel-name"':i===1?' class="channel-provider"':'')+' scope="col">'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+part.map(({x,index})=>rowHtml(x,index,spec)).join('')+'</tbody></table></div>';}
   return '<div class="live-channel-status">'+html+'</section></div>';
  }
  root.liveChannelAbsent=value=>{if(!current()||S.status!=='ready'||typeof value!=='boolean')return;S.includeAbsent=value;S.expanded=null;paint();};
  root.liveChannelTab=direction=>{if(!current()||S.status!=='ready'||!['charge','withdraw'].includes(direction)||S.scope.direction!=='all'&&S.scope.direction!==direction)return;S.tab=direction;S.expanded=null;paint();};
  root.liveChannelToggle=index=>{if(!current()||!allowed('detail')||S.status!=='ready'||!Number.isSafeInteger(index))return;const x=allRows()[index];if(!x)return;const k=rowKey(x);S.expanded=S.expanded===k?null:k;paint();};
  function canExport(){return current()&&allowed('export')&&S.status==='ready'&&!!S.response;}
  function exportRows(){
   if(!canExport())return [];
   const rows=allRows().filter(x=>x.s.direction===selectedDirection()&&(S.includeAbsent||present(x.row))),rates=rateColumns((S.response?.snapshots||[]).some(s=>s.direction===selectedDirection()&&middleSnapshot(s)));
   return [['统计口径','源站通道快照；成功率为源站各时间窗口原值，不等于本系统订单成功率，不合并平均。'],['查询时间',S.response.queriedAt],['导出范围',(selectedDirection()==='charge'?'充值通道':'提现通道')+' · '+(S.includeAbsent?'当前通道及本次未出现的历史通道':'仅当前通道')],['平台','方向','通道 ID','源页顺序','通道名称','支付供应商','通道类型','支付方式','最小交易金额','最大交易金额','限额币种',...rates.labels,'余额','余额币种','代收次数要求','余额阈值','阈值币种','优先级','权重','状态','源站状态','本次出现','备注','最近出现时间','快照采集时间','服务器接收时间','快照完整','源通道数','更新状态'],...rows.map(({row:r,s,p})=>[p.name,s.direction==='charge'?'充值':'提现',r.channel_id,Number.isFinite(sourcePosition(r))?sourcePosition(r):'—',r.channel_name||r.channel_id,r.provider||'—',r.channel_type||'—',r.payment_method||'—',numeric(r.min_amount)??'—',numeric(r.max_amount)??'—',r.limit_currency||'—',...rates.fields.map(k=>{const value=sourceRate(r,s,k);return rate(value)===null?'—':rate(value).toFixed(2)+'%';}),numeric(r.balance)??'—',r.balance_currency||(numeric(r.balance)!==null?'未提供':'—'),r.required_deposit_count??'—',numeric(r.balance_threshold)??'—',r.balance_threshold_currency||(numeric(r.balance_threshold)!==null?'未提供':'—'),r.priority??'—',r.weight??'—',status(r),r.status_text||'—',present(r)?'是':'否',r.notes||'—',rowObserved(r,s)||'—',s.observedAt||'—',s.receivedAt||'—',s.complete===true?'是':'否',s.sourceCount??'—',stale(rowObserved(r,s))?'超过 15 分钟未更新':'已更新'])];
  }
  return {load,cancel,clear,capture,restore,render,providers,canExport,exportRows};
 }
 root.HensemLiveChannelStatus={create};
})(window);
