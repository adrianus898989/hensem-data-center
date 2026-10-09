/* Source channel snapshots are independent of dashboard order success statistics. */
(function(root){
 'use strict';
 const PAGE='channel_status',STALE_MS=5*60*1000;
 const RATE_FIELDS=['10m','30m','1h','4h','8h','24h','today','total'];
 const RATE_LABELS=['10分钟','30分钟','1小时','4小时','8小时','24小时','今日','总成功率'];
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const numeric=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
 const fmt=v=>numeric(v)===null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const rate=v=>{const n=numeric(v);return n!==null&&n>=0&&n<=100?n:null;};
 const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
 const copy=v=>JSON.parse(JSON.stringify(v));
 const supported=p=>p?.capabilities?.channelStatusAvailable===true&&!p.reportOnly;
 function create(c){
  const L=c.L;let serial=0,S=initial(),freshnessTimer=null;
  function initial(){return {version:1,status:'idle',scope:null,response:null,error:'',expanded:null,receivedAt:0};}
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
  function restore(value){cancel();S=value?.version===1?copy(value):initial();if(S.status==='loading')S.status='paused';}
  function validate(response,queryScope){
   const ps=queryScope.platforms.filter(supported),ids=new Map(ps.map(p=>[p.id,p]));
   if(!response||response.version!==1||!stamp(response.queriedAt)||!Array.isArray(response.platforms)||!Array.isArray(response.snapshots))throw Error('通道快照返回不完整，请重新查询');
   if(response.platforms.length!==ids.size||new Set(response.platforms.map(p=>p.id)).size!==ids.size||response.platforms.some(p=>!ids.has(p.id)||p.source&&p.source!=='kb'))throw Error('通道快照平台范围不匹配');
   const seen=new Set();
   for(const s of response.snapshots){
    const k=s.platformId+'|'+s.direction;
    if(!ids.has(s.platformId)||!['charge','withdraw'].includes(s.direction)||queryScope.direction!=='all'&&queryScope.direction!==s.direction||seen.has(k)||!Array.isArray(s.channels))throw Error('通道快照方向或平台范围不匹配');
    seen.add(k);const channels=new Set();
    if(s.observedAt!==null&&!stamp(s.observedAt)||!s.observedAt&&s.channels.length)throw Error('通道快照缺少采集时间');
    for(const row of s.channels){if(!row||typeof row.channel_id!=='string'||!row.channel_id||channels.has(row.channel_id))throw Error('通道身份缺失或重复');channels.add(row.channel_id);if(queryScope.providers.length&&!queryScope.providers.includes(row.provider))throw Error('通道快照三方范围不匹配');}
   }
   return copy(response);
  }
  async function load(){
   if(!active()||!allowed('query'))return;cancel();const selected=copy(scope());selected.key=key(selected);S={...initial(),scope:selected,status:'loading'};L.pageQueried=true;L.dirty=false;L.loading=false;const token=++serial;
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
  const status=row=>!present(row)?'本次未出现':row.enabled===true?'已启用':row.enabled===false?'已停用':'未提供';
  function allRows(){return (S.response?.snapshots||[]).flatMap(s=>s.channels.map(row=>({row,s,p:S.scope.platforms.find(p=>p.id===s.platformId)}))).sort((a,b)=>a.s.direction.localeCompare(b.s.direction)||String(a.p.name).localeCompare(String(b.p.name))||Number(!present(a.row))-Number(!present(b.row))||Number(b.row.enabled===true)-Number(a.row.enabled===true)||(numeric(a.row.priority)??Infinity)-(numeric(b.row.priority)??Infinity)||String(a.row.channel_name||a.row.channel_id).localeCompare(String(b.row.channel_name||b.row.channel_id)));}
  const rowKey=x=>x.s.platformId+'|'+x.s.direction+'|'+x.row.channel_id;
  function percentage(value){const n=rate(value);return n===null?'—':'<span class="channel-rate'+(n<45?' channel-rate-low':'')+'">'+n.toFixed(2)+'%</span>';}
  function details(x){const r=x.row,values=[['通道 ID',r.channel_id],['通道类型',r.channel_type],['支付方式',r.payment_method],['余额阈值',numeric(r.balance_threshold)===null?null:fmt(r.balance_threshold)],['阈值币种',r.balance_threshold_currency],['要求充值次数',r.required_deposit_count],['源站状态',r.status_text],['最近出现',clock(rowObserved(r,x.s),x.p)],['备注',r.notes]];return '<tr class="channel-detail"><td colspan="20"><dl>'+values.map(([label,value])=>'<div'+(label==='备注'?' class="channel-detail-note"':'')+'><dt>'+E(label)+'</dt><dd>'+E(value===null||value===undefined||value===''?'—':value)+'</dd></div>').join('')+'</dl></td></tr>';}
  function rowHtml(x,index){const r=x.row,observed=rowObserved(r,x.s),unseen=!present(r),expanded=S.expanded===rowKey(x);return '<tr class="'+(unseen?'channel-absent':'')+'"><th scope="row" class="channel-name">'+E(r.channel_name||r.channel_id)+(S.scope.platforms.filter(supported).length>1?'<small>'+E(x.p.name)+'</small>':'')+'</th><td>'+E(r.provider||'—')+'</td><td><span class="channel-state '+(unseen?'missing':r.enabled===true?'enabled':r.enabled===false?'disabled':'')+'">'+status(r)+'</span></td><td>'+E(r.priority??'—')+'</td><td>'+E(r.weight??'—')+'</td><td class="num">'+fmt(r.balance)+'</td><td>'+E(r.balance_currency||(numeric(r.balance)!==null?'未提供':'—'))+'</td><td class="num">'+fmt(r.min_amount)+'</td><td class="num">'+fmt(r.max_amount)+'</td><td>'+E(r.limit_currency||'—')+'</td>'+RATE_FIELDS.map(k=>'<td class="num">'+percentage(r['success_rate_'+k])+'</td>').join('')+'<td class="channel-observed" title="'+E(clock(observed,x.p))+'">'+E(clock(observed,x.p).replace(/^\d{4}\//,''))+'<small class="'+(stale(observed)?'channel-stale':'')+'">'+(stale(observed)?'超过 5 分钟未更新':'已更新')+'</small></td><td>'+ (allowed('detail')?'<button class="link" type="button" aria-expanded="'+expanded+'" onclick="liveChannelToggle('+index+')">'+(expanded?'收起':'展开')+'</button>':'—')+'</td></tr>'+(expanded?details(x):'');}
  function render(){
   if(!active())return '';if(!allowed('query'))return '<div class="live-status">当前角色未获查询权限</div>';
   if(S.status==='idle'||L.dirty)return '<div class="live-status">'+(L.dirty?'筛选条件已修改，':'选择平台，')+'点击查询查看最新通道状态。</div>';
   if(S.status==='loading')return '<div class="live-status" role="status">正在读取最新通道快照…</div>';
   if(S.status==='paused')return '<div class="live-status">查询已暂停，点击查询更新。</div>';
   if(S.error)return '<div class="live-status live-error" role="alert">'+E(S.error)+'</div>';
   if(!matches())return '<div class="live-status">平台范围已变化，点击查询更新。</div>';
   scheduleFreshness();
   const ps=S.scope.platforms,unsupported=ps.filter(p=>!supported(p)),directions=S.scope.direction==='all'?['charge','withdraw']:[S.scope.direction],rows=allRows();
   let html='<div class="channel-scope-note">源站通道快照 · 成功率按源站口径 · 启用优先，优先级从小到大 · 平台当地时间</div>';
   if(unsupported.length)html+='<div class="channel-unavailable">未接入通道快照：'+E(unsupported.map(p=>p.name).join('、'))+'</div>';
   if(!ps.filter(supported).length)return html+'<div class="live-status">所选平台尚未接入通道快照。</div>';
   for(const direction of directions){const snapshots=(S.response?.snapshots||[]).filter(s=>s.direction===direction),part=rows.map((x,index)=>({x,index})).filter(({x})=>x.s.direction===direction),known=ps.filter(supported),notes=known.map(p=>{const s=snapshots.find(s=>s.platformId===p.id);return '<span>'+E(p.name)+' · '+(!s?.observedAt?'尚未收到快照':E(clock(s.observedAt,p))+(s.complete===true?'':' · 采集未完整')+(stale(s.observedAt)?' · 超过 5 分钟未更新':''))+'</span>';}).join('');
    html+='<section class="channel-panel"><header><h3>'+(direction==='charge'?'充值通道':'提现通道')+'</h3><span>'+(snapshots.length===known.length&&snapshots.every(s=>s.observedAt&&s.complete===true)?part.filter(({x})=>present(x.row)).length+' 个当前通道':part.length?'已读 '+part.filter(({x})=>present(x.row)).length+' 个当前通道':'当前通道 —')+(part.some(({x})=>!present(x.row))?' · '+part.filter(({x})=>!present(x.row)).length+' 个本次未出现':'')+'</span></header><div class="channel-snapshot-times">'+notes+'</div>';
    if(!part.length){html+='<div class="channel-empty">'+(S.scope.providers.length?'当前三方筛选没有匹配通道':snapshots.length===known.length&&snapshots.every(s=>s.complete===true&&s.observedAt)?'已采集，暂无通道':'尚未收到完整通道快照')+'</div></section>';continue;}
    html+='<div class="channel-scroll" tabindex="0" aria-label="'+(direction==='charge'?'充值':'提现')+'通道状态，可横向滚动"><table class="channel-table"><thead><tr>'+['通道 / 平台','三方','状态','优先级','权重','余额','余额币种','单笔最低','单笔最高','限额币种',...RATE_LABELS,'采集时间','详情'].map((h,i)=>'<th'+(i===0?' class="channel-name"':'')+' scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+part.map(({x,index})=>rowHtml(x,index)).join('')+'</tbody></table></div></section>';
   }return '<div class="live-channel-status">'+html+'</div>';
  }
  root.liveChannelToggle=index=>{if(!current()||!allowed('detail')||S.status!=='ready'||!Number.isSafeInteger(index))return;const x=allRows()[index];if(!x)return;const k=rowKey(x);S.expanded=S.expanded===k?null:k;paint();};
  function canExport(){return current()&&allowed('export')&&S.status==='ready'&&!!S.response;}
  function exportRows(){if(!canExport())return [];return [['统计口径','源站通道快照；成功率为源站各时间窗口原值，不等于本系统订单成功率，不合并平均。'],['查询时间',S.response.queriedAt],['平台','方向','通道 ID','通道','三方','状态','优先级','权重','余额','余额币种','单笔最低','单笔最高','限额币种',...RATE_LABELS,'采集时间','更新状态'],...allRows().map(({row:r,s,p})=>[p.name,s.direction==='charge'?'充值':'提现',r.channel_id,r.channel_name||r.channel_id,r.provider||'—',status(r),r.priority??'—',r.weight??'—',numeric(r.balance)??'—',r.balance_currency||(numeric(r.balance)!==null?'未提供':'—'),numeric(r.min_amount)??'—',numeric(r.max_amount)??'—',r.limit_currency||'—',...RATE_FIELDS.map(k=>rate(r['success_rate_'+k])===null?'—':rate(r['success_rate_'+k]).toFixed(2)+'%'),rowObserved(r,s)||'—',stale(rowObserved(r,s))?'超过 5 分钟未更新':'已更新'])];}
  return {load,cancel,clear,capture,restore,render,providers,canExport,exportRows};
 }
 root.HensemLiveChannelStatus={create};
})(window);
