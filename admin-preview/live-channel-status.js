/* Session-local, read-only source channel browser. Order statistics are never mixed in. */
(function(root){
 'use strict';
 const PAGE='channel_status',STALE_MS=15*60*1000,REFRESH_MS=5*60*1000;
 const RATE_FIELDS=['10m','30m','1h','4h','8h','24h','today','total'];
 const RATE_LABELS=['近10分钟成功率','近30分钟成功率','近1小时成功率','近4小时成功率','近8小时成功率','近24小时成功率','今日成功率','总成功率'];
 const middleSnapshot=s=>s?.source==='ar_middle';
 const rateColumns=middle=>middle?{fields:['15m','30m','1h','24h'],labels:['近15分钟成功率','近30分钟成功率','近1小时成功率','近24小时成功率']}:{fields:RATE_FIELDS,labels:RATE_LABELS};
 const sourceRate=(r,s,k)=>k==='10m'&&middleSnapshot(s)||k==='15m'&&!middleSnapshot(s)?null:r['success_rate_'+k];
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const numeric=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
 const fmt=v=>numeric(v)===null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const rate=v=>{const n=numeric(v);return n!==null&&n>=0&&n<=100?n:null;};
 const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
 const copy=v=>JSON.parse(JSON.stringify(v));
 const supported=p=>p?.capabilities?.channelStatusAvailable===true&&!p.reportOnly;
 const system=p=>String(p?.source||'').toLowerCase()==='ar'?'AR':String(p?.source||'').toLowerCase()==='kb'?'YASH':null;
 const systemLabel=value=>value==='AR'?'AR 系统':'YASH 系统';
 const identity=p=>JSON.stringify([p.id,p.source,p.country,supported(p),p.capabilities?.channelStatusSource||'']);
 function create(c){
  const L=c.L;let serial=0,S=initial(),freshnessTimer=null,autoTimer=null,activation=null,inflight=null;
  function initial(){return {version:2,source:'',country:'',platformId:'',search:'',page:1,size:20,tab:'charge',provider:'',filterStatus:'all',category:'',includeAbsent:false,expanded:null,sourceExpanded:null,accessError:'',cache:{}};}
  const allowed=action=>c.roleAllowed?.(action)===true;
  const active=()=>c.getPage()===PAGE&&allowed('view');
  const visible=()=>root.document?.visibilityState!=='hidden';
  const ready=()=>L.catalogReady!==false;
  const directory=()=>[...new Map((c.catalog?.()||c.selected?.()||[]).filter(p=>p&&typeof p.id==='string'&&!p.reportOnly&&system(p)).map(p=>[p.id,p])).values()];
  const systems=()=>[...new Set(directory().map(system))].sort((a,b)=>a==='AR'?-1:b==='AR'?1:a.localeCompare(b));
  const countries=()=>[...new Set(directory().filter(p=>system(p)===S.source).map(p=>p.country).filter(Boolean))];
  const bucket=()=>directory().filter(p=>system(p)===S.source&&p.country===S.country);
  const platforms=()=>bucket().filter(p=>!S.search||(String(p.name)+' '+p.id+' '+String(p.sourceName||'')).toLowerCase().includes(S.search.toLowerCase()));
  const selected=()=>bucket().find(p=>p.id===S.platformId)||null;
  const entryFor=p=>p&&S.cache[p.id]?.key===identity(p)?S.cache[p.id]:null;
  const entry=()=>entryFor(selected());
  const current=()=>active()&&ready()&&!L.dirty&&!!selected();
  const paint=()=>{if(active())c.render();};
  function stopTimers(){if(freshnessTimer!==null)root.clearTimeout?.(freshnessTimer);if(autoTimer!==null)root.clearTimeout?.(autoTimer);freshnessTimer=autoTimer=null;activation=null;}
  function cancel(){stopTimers();serial++;inflight=null;root.hensemLiveCancelRequests?.(['channelStatus']);for(const hit of Object.values(S.cache))if(hit.status==='loading')hit.status=hit.response?'ready':'paused';}
  function clear(){cancel();S=initial();}
  function revoke(error){cancel();S.cache={};S.accessError=error?.message||'当前角色未获查询权限';L.pageQueried=false;paint();}
  const authFailure=error=>[401,403].includes(Number(error?.status||error?.statusCode))||/401|403|unauthoriz|forbidden|permission_denied|role_denied|没有.*权限|未获.*授权|会话.*失效|登录.*失效/i.test(String(error?.code||'')+' '+String(error?.message||''));
  function reconcile(){
   const rows=directory(),valid=new Map(rows.map(p=>[p.id,identity(p)]));for(const [id,hit]of Object.entries(S.cache))if(valid.get(id)!==hit.key)delete S.cache[id];
   const sourceList=systems();if(!sourceList.includes(S.source))S.source=sourceList[0]||'';
   const countryList=countries();if(!countryList.includes(S.country))S.country=countryList.includes(L.country)?L.country:countryList[0]||'';
   if(!selected()){S.platformId=bucket()[0]?.id||'';S.provider='';S.category='';S.expanded=null;}
   S.page=Math.min(Math.max(1,Number(S.page)||1),Math.max(1,Math.ceil(platforms().length/S.size)));if(inflight&&(!selected()||inflight.key!==identity(selected())))cancel();
  }
  function capture(){const value=copy(S),hit=entry();return {...value,status:hit?.status||'idle',response:hit?.response||null,error:hit?.error||'',receivedAt:hit?.receivedAt||0};}
  function restore(value){
   cancel();S=value?.version===2?copy(value):initial();
   if(value?.version===1&&value.scope?.platforms?.length===1&&value.response){const p=value.scope.platforms[0];S.source=system(p)||'';S.country=p.country||'';S.platformId=p.id;S.cache[p.id]={key:identity(p),status:value.status==='loading'?'paused':value.status,response:copy(value.response),receivedAt:value.receivedAt||0,lastSuccessAt:value.response.queriedAt,attemptAt:value.receivedAt||0,error:value.error||''};}
   if(!S.cache||typeof S.cache!=='object'||Array.isArray(S.cache))S.cache={};for(const hit of Object.values(S.cache))if(hit.status==='loading')hit.status=hit.response?'ready':'paused';
   S.tab=['charge','withdraw'].includes(S.tab)?S.tab:'charge';S.includeAbsent=S.includeAbsent===true;S.size=[20,30,50,100,500].includes(S.size)?S.size:20;S.filterStatus=['all','on','off','unknown'].includes(S.filterStatus)?S.filterStatus:'all';S.provider=typeof S.provider==='string'?S.provider:'';S.category=typeof S.category==='string'?S.category:'';S.search=typeof S.search==='string'?S.search:'';
  }
  function validate(response,p){
   if(!response||response.version!==1||!stamp(response.queriedAt)||!Array.isArray(response.platforms)||!Array.isArray(response.snapshots))throw Error('通道快照返回不完整，请重新查询');
   if(response.platforms.length!==1||response.platforms[0]?.id!==p.id||response.platforms[0]?.source!==p.source)throw Error('通道快照平台范围不匹配');
   const seen=new Set();for(const s of response.snapshots){
    if(s.platformId!==p.id||!['charge','withdraw'].includes(s.direction)||seen.has(s.direction)||!Array.isArray(s.channels))throw Error('通道快照方向或平台范围不匹配');
    if(middleSnapshot(s)&&String(p.source).toLowerCase()!=='ar'||p.capabilities?.channelStatusSource==='ar_middle'&&!middleSnapshot(s))throw Error('通道快照来源不匹配');
    seen.add(s.direction);const channels=new Set();if(s.observedAt!==null&&!stamp(s.observedAt)||!s.observedAt&&s.channels.length)throw Error('通道快照缺少采集时间');
    for(const row of s.channels){if(!row||typeof row.channel_id!=='string'||!row.channel_id||channels.has(row.channel_id))throw Error('通道身份缺失或重复');channels.add(row.channel_id);}
    for(const row of s.channels)if(row.channel_categories!==undefined&&row.channel_categories!==null&&(!Array.isArray(row.channel_categories)||row.channel_categories.some(x=>!x||typeof x.category_id!=='string')))throw Error('通道大类返回不完整');
   }
   return copy(response);
  }
  async function load(automatic=false){
   if(!active()||!allowed('query')||!visible()||!ready()||automatic&&S.accessError)return;S.accessError='';reconcile();const p=selected();if(!p)return;
   if(inflight&&inflight.key===identity(p))return inflight.promise;
   stopTimers();const token=++serial,platformKey=identity(p),previous=entryFor(p),hit={key:platformKey,status:supported(p)?'loading':'ready',response:previous?.response||null,receivedAt:previous?.receivedAt||0,lastSuccessAt:previous?.lastSuccessAt||null,attemptAt:Date.now(),error:''};S.cache[p.id]=hit;L.pageQueried=true;L.dirty=false;L.loading=false;
   if(!supported(p)){paint();return;}paint();
   const work=Promise.resolve().then(async()=>{try{const response=await c.request({action:'channelStatus',platformIds:[p.id],direction:'all'});if(token!==serial)return;if(!allowed('view')||!allowed('query')){revoke();return;}if(!current()||!visible()||identity(selected())!==platformKey)return;hit.response=validate(response,p);hit.receivedAt=Date.now();hit.lastSuccessAt=response.queriedAt;hit.status='ready';}
    catch(error){if(token!==serial)return;if(authFailure(error)||!allowed('view')||!allowed('query')){revoke(error);return;}if(!current()||!visible()||identity(selected())!==platformKey)return;hit.status=hit.response?'ready':'error';hit.error=error?.message||'通道状态读取失败';}
    finally{if(token===serial){inflight=null;paint();}}});inflight={key:platformKey,promise:work};return work;
  }
  function activate(){
   if(!active()||!ready()||!visible()||!allowed('query')||!supported(selected())||inflight||S.accessError)return;
   const hit=entry(),due=!hit||!hit.attemptAt||hit.status==='paused'&&!hit.response||Date.now()-hit.attemptAt>=REFRESH_MS;
   if(due){if(activation!==null)return;const token=serial;activation=token;Promise.resolve().then(()=>{if(activation!==token)return;activation=null;if(token===serial&&active()&&visible()&&allowed('query'))load(true);});}
   else if(autoTimer===null)autoTimer=root.setTimeout?.(()=>{autoTimer=null;if(active()&&visible()&&allowed('query'))load(true);},Math.max(10,REFRESH_MS-(Date.now()-hit.attemptAt)))??null;
  }
  function clock(value,p){if(!stamp(value))return '—';try{return new Intl.DateTimeFormat('zh-CN',{timeZone:p.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));}catch{return value;}}
  const now=()=>Date.parse(entry()?.response?.queriedAt||'')+Math.max(0,Date.now()-(entry()?.receivedAt||0));
  const stale=value=>!stamp(value)||now()-Date.parse(value)>STALE_MS;
  const present=row=>row.is_present!==false;
  const rowObserved=(r,s)=>stamp(r.last_seen_at)||stamp(r.observed_at)||s.observedAt;
  function scheduleFreshness(){
   if(freshnessTimer!==null)root.clearTimeout?.(freshnessTimer);freshnessTimer=null;if(!current()||!visible()||!entry()?.response)return;
   const times=entry().response.snapshots.flatMap(s=>[s.observedAt,...s.channels.map(r=>rowObserved(r,s))]).filter(stamp).map(value=>Date.parse(value)+STALE_MS+1-now()).filter(delay=>delay>0);
   if(times.length)freshnessTimer=root.setTimeout?.(()=>{freshnessTimer=null;if(current())paint();},Math.min(2147483647,Math.max(10,Math.min(...times))))??null;
  }
  const status=row=>!present(row)?'本次未出现':String(row.status_text||'').trim()||(row.enabled===true?'已启用':row.enabled===false?'已禁用':'未提供');
  const sourcePosition=row=>Number.isSafeInteger(numeric(row.source_position))&&numeric(row.source_position)>=0?numeric(row.source_position):Infinity;
  const rowKey=x=>x.s.platformId+'|'+x.s.direction+'|'+x.row.channel_id;
  function allRows(){const p=selected();return (entry()?.response?.snapshots||[]).flatMap(s=>s.channels.map((row,order)=>({row,s,p,order}))).sort((a,b)=>a.s.direction.localeCompare(b.s.direction)||Number(!present(a.row))-Number(!present(b.row))||(Number.isFinite(sourcePosition(a.row))||Number.isFinite(sourcePosition(b.row))?sourcePosition(a.row)-sourcePosition(b.row)||a.order-b.order:Number(b.row.enabled===true)-Number(a.row.enabled===true)||(numeric(a.row.priority)??Infinity)-(numeric(b.row.priority)??Infinity)||a.order-b.order));}
  function providers(){return [...new Set(allRows().filter(x=>x.s.direction===S.tab).map(x=>x.row.provider).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
  const snapshot=()=>entry()?.response?.snapshots.find(s=>s.direction===S.tab);
  const rowCategories=row=>Array.isArray(row.channel_categories)&&row.channel_categories.length?row.channel_categories:row.category_id?[{category_id:String(row.category_id),category_name:row.category_name||null,sort:null}]:[];
  const hasCategory=(row,id)=>rowCategories(row).some(x=>String(x.category_id)===id);
  function categories(){const seen=new Map();for(const {row}of allRows().filter(x=>x.s.direction===S.tab))for(const x of rowCategories(row))if(!seen.has(String(x.category_id)))seen.set(String(x.category_id),{id:String(x.category_id),name:x.category_name||x.category_id,sort:numeric(x.sort)??Infinity});return [...seen.values()].sort((a,b)=>a.sort-b.sort);}
  function filteredRows(){return allRows().map((x,index)=>({x,index})).filter(({x})=>x.s.direction===S.tab&&(S.includeAbsent||present(x.row))&&(!S.provider||x.row.provider===S.provider)&&(!S.category||hasCategory(x.row,S.category))&&(S.filterStatus==='all'||S.filterStatus==='on'&&x.row.enabled===true||S.filterStatus==='off'&&x.row.enabled===false||S.filterStatus==='unknown'&&x.row.enabled!==true&&x.row.enabled!==false));}
  function percentage(value){const n=rate(value);return n===null?'—':'<span class="channel-rate'+(n<45?' channel-rate-low':'')+'">'+n.toFixed(2)+'%</span>';}
  const sourceValue=value=>value===null||value===undefined||value===''?'—':String(value);
  function columnSpec(direction,part){
   const currencies=[...new Set(part.map(({x})=>x.row.limit_currency).filter(Boolean))],uniform=currencies.length===1&&part.every(({x})=>x.row.limit_currency===currencies[0]),currency=uniform?' ('+currencies[0]+')':'',middle=system(selected())==='AR',rates=rateColumns(middle);
   const headers=[...(middle?[direction==='charge'?'充值大类':'提现大类','通道 ID','系统通道 ID','源通道名称',direction==='charge'?'前台显示名称':'出款显示名称']:['通道名称']),'支付供应商',...(!middle?['通道类型']:[]),...(!middle&&direction==='charge'?['支付方式']:[]),'最小交易金额'+currency,'最大交易金额'+currency,...(uniform?[]:['限额币种']),...rates.labels,'余额','余额币种',...(direction==='charge'?['代收次数要求']:['余额阈值','阈值币种']),'优先级','权重','状态',...(middle?['源启用状态','通道可用状态','商户可用状态','费率（源值）','固定手续费','第三方商户 ID']:[]),'备注',...(middle?['源配置']:[])];
   const widths=headers.map(h=>['通道名称','前台显示名称','出款显示名称','源通道名称'].includes(h)?180:h==='支付供应商'?130:h==='备注'?280:h.endsWith('大类')?150:h.includes('状态')?110:h==='支付方式'?180:h.includes('成功率')?104:h.includes('币种')?75:h.includes('交易金额')||h==='余额'||h==='余额阈值'?120:h==='权重'||h==='优先级'?75:100);
   return {middle,uniform,headers,widths,rates};
  }
  function noteCell(x,index){const notes=String(x.row.notes||''),expanded=S.expanded===rowKey(x),long=notes.length>50;return '<td class="channel-notes"><div class="channel-notes-text'+(long&&!expanded?' collapsed':'')+'" title="'+E(notes)+'">'+E(notes||'—')+'</div>'+(long&&allowed('detail')?'<button class="link channel-note-toggle" type="button" aria-expanded="'+expanded+'" onclick="liveChannelToggle('+index+')">'+(expanded?'收起备注':'展开备注')+'</button>':'')+'</td>';}
  function rowHtml(x,index,spec){
   const r=x.row,unseen=!present(r),label=E(r.channel_name||r.channel_id),identityText='通道 ID：'+r.channel_id+'；最近出现：'+clock(rowObserved(r,x.s),x.p);
   const cells=spec.middle?'<td class="channel-category">'+(rowCategories(r).length?rowCategories(r).map(x=>'<div>'+E(x.category_name||x.category_id||'—')+'<small>'+E(x.category_id)+'</small></div>').join(''):'—')+'</td><td class="channel-id">'+E(r.channel_id)+'</td><td>'+E(sourceValue(r.sys_channel_id))+'</td><td class="channel-original-name">'+E(sourceValue(r.source_channel_name))+'</td><th scope="row" class="channel-name" title="'+E(identityText)+'">'+label+'</th>':'<th scope="row" class="channel-name" title="'+E(identityText)+'">'+label+'</th>';
   return '<tr class="'+(unseen?'channel-absent':'')+'">'+cells+'<td class="channel-provider">'+E(r.provider||'—')+'</td>'+(!spec.middle?'<td>'+E(r.channel_type||'—')+'</td>':'')+(!spec.middle&&x.s.direction==='charge'?'<td class="channel-payment-method">'+E(r.payment_method||'—')+'</td>':'')+'<td class="num">'+fmt(r.min_amount)+'</td><td class="num">'+fmt(r.max_amount)+'</td>'+(!spec.uniform?'<td>'+E(r.limit_currency||'—')+'</td>':'')+spec.rates.fields.map(k=>'<td class="num">'+percentage(sourceRate(r,x.s,k))+'</td>').join('')+'<td class="num">'+fmt(r.balance)+'</td><td>'+E(r.balance_currency||(numeric(r.balance)!==null?'未提供':'—'))+'</td>'+(x.s.direction==='charge'?'<td class="num">'+E(r.required_deposit_count??'—')+'</td>':'<td class="num">'+fmt(r.balance_threshold)+'</td><td>'+E(r.balance_threshold_currency||(numeric(r.balance_threshold)!==null?'未提供':'—'))+'</td>')+'<td class="num">'+E(r.priority??'—')+'</td><td class="num">'+E(r.weight??'—')+'</td><td><span class="channel-state '+(unseen?'missing':r.enabled===true?'enabled':r.enabled===false?'disabled':'')+'" title="'+E(r.status_text||'')+'">'+E(status(r))+'</span>'+(unseen?'<small class="channel-last-seen">最近 '+E(clock(rowObserved(r,x.s),x.p))+'</small>':'')+'</td>'+(spec.middle?['source_state','source_channel_state','source_merchant_state'].map(k=>'<td>'+E(sourceValue(r[k]))+'</td>').join('')+'<td class="num">'+E(sourceValue(r.fee_rate))+'</td><td class="num">'+fmt(r.fee_amount)+'</td><td>'+E(sourceValue(r.third_pay_merchant_id))+'</td>':'')+noteCell(x,index)+(spec.middle?'<td>'+ (allowed('detail')?'<button type="button" class="channel-note-toggle" aria-expanded="'+(S.sourceExpanded===rowKey(x))+'" onclick="liveChannelSourceDetail('+index+')">'+(S.sourceExpanded===rowKey(x)?'收起':'展开')+'</button>':'—')+'</td>':'')+'</tr>'+(spec.middle&&S.sourceExpanded===rowKey(x)&&allowed('detail')?sourceDetails(x,spec.headers.length):'');
  }
  function sourceDetails(x,columns){const r=x.row,fields=[['第三方商户 ID',r.third_pay_merchant_id],['费率（源值）',r.fee_rate],['费率口径',r.fee_rate_basis],['固定手续费',r.fee_amount],['源更新时间',r.source_updated_at],['源页顺序',r.source_position],['主大类 ID',r.category_id],['主大类名称',r.category_name],['全部分类',rowCategories(r).map(cat=>[cat.category_name||'—',cat.category_id,'排序 '+sourceValue(cat.sort)].join(' · ')).join(' / ')],['源启用状态',r.source_state],['通道可用状态',r.source_channel_state],['商户可用状态',r.source_merchant_state]];return '<tr class="channel-source-details"><td colspan="'+columns+'"><dl>'+fields.map(([label,value])=>'<div><dt>'+E(label)+'</dt><dd>'+E(sourceValue(value))+'</dd></div>').join('')+'</dl></td></tr>';}
  function sheet(){
   const p=selected();if(!p)return '<div class="channel-empty">请选择有权限的平台。</div>';
   const hit=entry(),s=snapshot(),rows=allRows(),directionRows=rows.filter(x=>x.s.direction===S.tab),absent=directionRows.filter(x=>!present(x.row));
   let html='<header class="channel-sheet-head"><div><h3>'+E(p.name)+'</h3><small>'+E(p.country)+' / '+systemLabel(S.source)+' · '+E(p.timezone||'UTC')+'</small></div><div class="channel-snapshot-times"><span>'+E(p.name)+' · 最新采集 '+(s?.observedAt?E(clock(s.observedAt,p))+'（'+E(p.timezone||'UTC')+'） <span class="'+(stale(s.observedAt)?'channel-stale':'')+'">'+(s.complete===true?'':'采集未完整 · ')+(stale(s.observedAt)?'超过 15 分钟未更新':'已更新')+'</span>':'— · 尚未收到快照')+'</span><span>最后成功读取 '+E(clock(hit?.lastSuccessAt,p))+'</span></div></header>';
   html+='<div class="channel-tabs" role="tablist" aria-label="充值和提现通道">'+['charge','withdraw'].map(d=>'<button type="button" role="tab" aria-selected="'+(S.tab===d)+'" class="'+(S.tab===d?'on':'')+'" onclick="liveChannelTab(\''+d+'\')">'+(d==='charge'?'充值通道':'提现通道')+'</button>').join('')+'</div>';
   if(!allowed('query'))return html+'<div class="channel-empty">当前角色未获查询权限</div>';
   if(S.accessError)return html+'<div class="channel-update-error" role="alert">'+E(S.accessError)+' · 点击查询重新验证授权。</div>';
   if(!supported(p))return html+'<div class="channel-unavailable">未接入通道快照：'+E(p.name)+'</div>';
   if(hit?.error)html+='<div class="channel-update-error" role="alert">更新失败：'+E(hit.error)+(hit.response?' · 保留上次成功读取的快照':'')+'</div>';
   if(hit?.status==='loading')html+='<div class="channel-update-status" role="status">'+(hit.response?'正在刷新，显示上次快照…':'正在读取最新通道快照…')+'</div>';
   if(!hit?.response)return html+'<div class="channel-empty">'+(hit?.status==='paused'?'查询已暂停，点击查询更新。':hit?.status==='loading'?'读取中…':hit?.error?'点击查询重试。':'点击查询查看最新通道状态；当前平台将自动读取。')+'</div>';
   if(L.dirty)return html+'<div class="channel-empty">范围已变化，点击查询更新。</div>';
   const cats=categories(),part=filteredRows(),providerList=providers();
   html+='<section class="channel-panel" role="tabpanel"><div class="channel-local-filters"><label>支付三方<select aria-label="支付三方" onchange="liveChannelProvider(this.value)"><option value="">全部三方</option>'+providerList.map(value=>'<option value="'+E(value)+'" '+(S.provider===value?'selected':'')+'>'+E(value)+'</option>').join('')+'</select></label><label>状态<select aria-label="通道状态" onchange="liveChannelStatus(this.value)">'+[['all','全部状态'],['on','已启用'],['off','已禁用'],['unknown','未提供']].map(([value,label])=>'<option value="'+value+'" '+(S.filterStatus===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+(cats.length?'<label>通道大类<select aria-label="通道大类" onchange="liveChannelCategory(this.value)"><option value="">全部大类 ('+cats.length+')</option>'+cats.map(cat=>'<option value="'+E(cat.id)+'" '+(S.category===cat.id?'selected':'')+'>'+E(cat.name)+' ('+directionRows.filter(x=>present(x.row)&&hasCategory(x.row,cat.id)).length+')</option>').join('')+'</select></label>':'')+(absent.length?'<label class="channel-history-toggle"><input type="checkbox" '+(S.includeAbsent?'checked ':'')+'onchange="liveChannelAbsent(this.checked)">显示本次未出现 ('+absent.length+')</label>':'')+'</div>';
   const hasSourceOrder=directionRows.filter(x=>present(x.row)).length>0&&directionRows.filter(x=>present(x.row)).every(x=>Number.isFinite(sourcePosition(x.row)));
   html+='<header><span>'+(s?.observedAt&&s.complete===true?part.filter(({x})=>present(x.row)).length+' 个当前通道':part.length?'已读 '+part.filter(({x})=>present(x.row)).length+' 个当前通道':'当前通道 —')+(s?.sourceCount!==null&&s?.sourceCount!==undefined?' · 源通道数 '+E(s.sourceCount):'')+'</span><span>'+(hasSourceOrder?'源页顺序':'启用优先，优先级从小到大')+'</span></header>';
   if(!part.length)html+='<div class="channel-empty">'+(S.provider||S.filterStatus!=='all'||S.category?'当前筛选没有匹配通道':s?.complete===true&&s?.observedAt?'已采集，暂无通道':'尚未收到完整通道快照')+'</div>';
   else {const spec=columnSpec(S.tab,part);html+='<div class="channel-scroll" tabindex="0" aria-label="'+(S.tab==='charge'?'充值':'提现')+'通道配置，可横向滚动"><table class="channel-table '+(spec.middle?'channel-middle-table':'')+'" style="width:'+spec.widths.reduce((a,b)=>a+b,0)+'px"><colgroup>'+spec.widths.map(w=>'<col style="width:'+w+'px">').join('')+'</colgroup><thead><tr>'+spec.headers.map(h=>'<th'+(h==='通道名称'||h==='前台显示名称'||h==='出款显示名称'?' class="channel-name"':h==='支付供应商'?' class="channel-provider"':h.endsWith('大类')?' class="channel-category"':h==='通道 ID'?' class="channel-id"':'')+' scope="col">'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+part.map(({x,index})=>rowHtml(x,index,spec)).join('')+'</tbody></table></div>';}
   return html+'</section><p class="channel-scope-note">只读展示源站配置 · 成功率按源站口径 · 低于 45% 标红 · — 表示源站未提供</p>';
  }
  function render(){
   if(!active()){if(c.getPage()===PAGE){cancel();S.cache={};L.pageQueried=false;}else stopTimers();return '';}if(!ready())return '<div class="channel-empty">正在读取账号可见的平台目录…</div>';reconcile();if(!allowed('query')){cancel();S.cache={};L.pageQueried=false;}activate();scheduleFreshness();
   const list=platforms(),pages=Math.max(1,Math.ceil(list.length/S.size)),from=(S.page-1)*S.size,items=list.slice(from,from+S.size),hit=entry();
   return '<div class="live-channel-status"><div class="channel-browser-top"><div><h2>平台通道调整</h2><span>源站通道配置 · 只读同步 · 每 5 分钟自动刷新</span></div><div><button type="button" onclick="liveQuery()" '+(!allowed('query')||!supported(selected())||hit?.status==='loading'?'disabled':'')+'>'+(hit?.status==='loading'?'读取中…':'查询 / 刷新')+'</button><button type="button" onclick="liveReset()">重置</button></div></div><div class="channel-source-tabs" role="tablist" aria-label="源系统">'+systems().map((value,i)=>'<button type="button" role="tab" aria-selected="'+(S.source===value)+'" class="'+(S.source===value?'active':'')+'" onclick="liveChannelSource('+i+')">'+systemLabel(value)+'</button>').join('')+'</div><div class="channel-country-tabs" role="tablist" aria-label="国家和盘口">'+countries().map((value,i)=>'<button type="button" role="tab" aria-selected="'+(S.country===value)+'" class="'+(S.country===value?'active':'')+'" onclick="liveChannelCountry('+i+')">'+E(value)+'</button>').join('')+'</div><div class="channel-browser"><aside><form onsubmit="liveChannelSearch(this.elements.platform.value);return false"><input name="platform" aria-label="平台名称" placeholder="搜索平台" value="'+E(S.search)+'"><button type="submit">查询</button></form><div class="channel-platforms">'+items.map(p=>{const cached=entryFor(p),time=cached?.response?.snapshots.find(x=>x.direction===S.tab)?.observedAt;return '<button type="button" class="'+(S.platformId===p.id?'active':'')+'" aria-pressed="'+(S.platformId===p.id)+'" onclick="liveChannelSelect('+list.indexOf(p)+')"><strong>'+E(p.name)+'</strong><small>'+(!supported(p)?'未接入':cached?.status==='loading'?'读取中':time?E(clock(time,p).slice(5,16)):cached?.error?'读取失败':'未采集')+'</small></button>';}).join('')+(!items.length?'<div class="channel-empty">当前范围无平台</div>':'')+'</div><div class="channel-pager"><span>共 '+list.length+' 个 · '+(list.length?from+1:0)+'–'+Math.min(from+S.size,list.length)+'</span><div><button type="button" onclick="liveChannelPage(1)" '+(S.page<=1?'disabled':'')+'>首页</button><button type="button" aria-label="上一页平台" onclick="liveChannelPage('+(S.page-1)+')" '+(S.page<=1?'disabled':'')+'>‹</button><span>'+S.page+'/'+pages+'</span><button type="button" aria-label="下一页平台" onclick="liveChannelPage('+(S.page+1)+')" '+(S.page>=pages?'disabled':'')+'>›</button><button type="button" onclick="liveChannelPage('+pages+')" '+(S.page>=pages?'disabled':'')+'>末页</button></div><select aria-label="每页平台数" onchange="liveChannelPageSize(this.value)">'+[20,30,50,100,500].map(value=>'<option value="'+value+'" '+(S.size===value?'selected':'')+'>'+value+' / 页</option>').join('')+'</select></div></aside><article>'+sheet()+'</article></div></div>';
  }
  function choose(p){if(!active()||!p)return;cancel();S.platformId=p.id;S.provider='';S.filterStatus='all';S.category='';S.expanded=null;L.dirty=false;L.pageQueried=!!entryFor(p)?.response;paint();}
  root.liveChannelSource=index=>{if(!active()||!Number.isSafeInteger(index)||!systems()[index])return;cancel();S.source=systems()[index];S.country='';S.platformId='';S.search='';S.page=1;reconcile();choose(selected());};
  root.liveChannelCountry=index=>{if(!active()||!Number.isSafeInteger(index)||!countries()[index])return;cancel();S.country=countries()[index];S.platformId='';S.search='';S.page=1;reconcile();choose(selected());};
  root.liveChannelSelect=index=>{if(!active()||!Number.isSafeInteger(index))return;choose(platforms()[index]);};
  root.liveChannelSearch=value=>{if(!active())return;S.search=String(value||'').trim().slice(0,200);S.page=1;paint();};
  root.liveChannelPage=value=>{if(!active()||!Number.isSafeInteger(value))return;S.page=Math.max(1,Math.min(value,Math.max(1,Math.ceil(platforms().length/S.size))));paint();};
  root.liveChannelPageSize=value=>{if(!active()||![20,30,50,100,500].includes(Number(value)))return;S.size=Number(value);S.page=1;paint();};
  root.liveChannelProvider=value=>{if(!current()||!entry()?.response||typeof value!=='string'||value&&!providers().includes(value))return;S.provider=value;S.expanded=null;paint();};
  root.liveChannelStatus=value=>{if(!current()||!['all','on','off','unknown'].includes(value))return;S.filterStatus=value;S.expanded=null;paint();};
  root.liveChannelCategory=value=>{if(!current()||typeof value!=='string'||value&&!categories().some(x=>x.id===value))return;S.category=value;S.expanded=null;paint();};
  root.liveChannelAbsent=value=>{if(!current()||typeof value!=='boolean')return;S.includeAbsent=value;S.expanded=null;paint();};
  root.liveChannelTab=direction=>{if(!active()||!['charge','withdraw'].includes(direction))return;S.tab=direction;S.provider='';S.category='';S.expanded=null;paint();};
  root.liveChannelSourceDetail=index=>{if(!current()||!allowed('detail')||!Number.isSafeInteger(index))return;const x=allRows()[index];if(!x||x.s.direction!==S.tab)return;S.sourceExpanded=S.sourceExpanded===rowKey(x)?null:rowKey(x);paint();};
  root.liveChannelToggle=index=>{if(!current()||!allowed('detail')||!Number.isSafeInteger(index))return;const x=allRows()[index];if(!x)return;const k=rowKey(x);S.expanded=S.expanded===k?null:k;paint();};
  function canExport(){return current()&&allowed('query')&&allowed('export')&&!!entry()?.response;}
  function exportRows(){
   if(!canExport())return [];const hit=entry(),rates=rateColumns(system(selected())==='AR'),rows=filteredRows();
   return [['统计口径','源站通道快照；成功率为源站各时间窗口原值，不等于本系统订单成功率，不合并平均。'],['查询时间',hit.response.queriedAt],['导出范围',(S.tab==='charge'?'充值通道':'提现通道')+' · '+(S.includeAbsent?'当前通道及本次未出现的历史通道':'仅当前通道')+' · 当前平台及本地筛选'],['平台','方向','通道大类 ID','通道大类','全部大类 ID','全部大类','通道 ID','系统通道 ID','源通道名称','源页顺序','通道名称','支付供应商','通道类型','支付方式','最小交易金额','最大交易金额','限额币种',...rates.labels,'余额','余额币种','代收次数要求','余额阈值','阈值币种','优先级','权重','状态','源启用状态','通道可用状态','商户可用状态','费率（源值）','费率口径','固定手续费','第三方商户 ID','源更新时间','源站状态','本次出现','备注','最近出现时间','快照采集时间','服务器接收时间','快照完整','源通道数','更新状态','最后成功读取时间','最近更新错误'],...rows.map(({x:{row:r,s,p}})=>[p.name,s.direction==='charge'?'充值':'提现',sourceValue(r.category_id),sourceValue(r.category_name),rowCategories(r).map(x=>x.category_id).join(' / ')||'—',rowCategories(r).map(x=>x.category_name||x.category_id).join(' / ')||'—',r.channel_id,sourceValue(r.sys_channel_id),sourceValue(r.source_channel_name),Number.isFinite(sourcePosition(r))?sourcePosition(r):'—',r.channel_name||r.channel_id,r.provider||'—',r.channel_type||'—',r.payment_method||'—',numeric(r.min_amount)??'—',numeric(r.max_amount)??'—',r.limit_currency||'—',...rates.fields.map(k=>{const value=sourceRate(r,s,k);return rate(value)===null?'—':rate(value).toFixed(2)+'%';}),numeric(r.balance)??'—',r.balance_currency||(numeric(r.balance)!==null?'未提供':'—'),r.required_deposit_count??'—',numeric(r.balance_threshold)??'—',r.balance_threshold_currency||(numeric(r.balance_threshold)!==null?'未提供':'—'),r.priority??'—',r.weight??'—',status(r),sourceValue(r.source_state),sourceValue(r.source_channel_state),sourceValue(r.source_merchant_state),sourceValue(r.fee_rate),sourceValue(r.fee_rate_basis),numeric(r.fee_amount)??'—',sourceValue(r.third_pay_merchant_id),sourceValue(r.source_updated_at),r.status_text||'—',present(r)?'是':'否',r.notes||'—',rowObserved(r,s)||'—',s.observedAt||'—',s.receivedAt||'—',s.complete===true?'是':'否',s.sourceCount??'—',stale(rowObserved(r,s))?'超过 15 分钟未更新':'已更新',hit.lastSuccessAt||'—',hit.error||'—'])];
  }
  root.document?.addEventListener?.('visibilitychange',()=>{if(!visible())cancel();else if(active())paint();});root.addEventListener?.('pagehide',clear);
  return {load,cancel,clear,capture,restore,render,providers,canExport,exportRows};
 }
 root.HensemLiveChannelStatus={create};
})(window);
