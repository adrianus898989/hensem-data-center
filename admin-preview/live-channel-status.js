/* Session-local, read-only source channel browser. Order statistics are never mixed in. */
(function(root){
 'use strict';
 const PAGE='channel_status',STALE_MS=15*60*1000,REFRESH_MS=5*60*1000;
 const RATE_FIELDS=['10m','30m','1h','4h','8h','24h','today','total'];
 const RATE_LABELS=['近10分钟成功率','近30分钟成功率','近1小时成功率','近4小时成功率','近8小时成功率','近24小时成功率','今日成功率','总成功率'];
 const middleSnapshot=s=>s?.source==='ar_middle';
 const rateColumns=(middle,direction='charge')=>middle&&direction==='withdraw'?{fields:[],labels:[]}:middle?{fields:['15m','30m','1h','24h'],labels:['近10分钟成功率','近30分钟成功率','近1小时成功率','近24小时成功率']}:{fields:RATE_FIELDS,labels:RATE_LABELS};
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
  function initial(){return {version:2,source:'',country:'',platformId:'',search:'',page:1,size:20,tab:'charge',provider:'',filterStatus:'all',category:'',currency:'',channelQuery:'',merchantQuery:'',channelDraft:'',merchantDraft:'',includeAbsent:false,expanded:null,accessError:'',cache:{}};}
  const allowed=action=>c.roleAllowed?.(action)===true;
  const active=()=>c.getPage()===PAGE&&allowed('view');
  const visible=()=>root.document?.visibilityState!=='hidden';
  const ready=()=>L.catalogReady!==false;
  const directory=()=>[...new Map((c.catalog?.()||c.selected?.()||[]).filter(p=>p&&typeof p.id==='string'&&!p.reportOnly&&system(p)).map(p=>[p.id,p])).values()];
  const systems=()=>[...new Set(directory().map(system))].sort((a,b)=>a==='AR'?-1:b==='AR'?1:a.localeCompare(b));
  const countries=()=>[...new Set(directory().filter(p=>system(p)===S.source).map(p=>p.country).filter(Boolean))];
  const bucket=()=>directory().filter(p=>system(p)===S.source&&p.country===S.country);
  const platforms=()=>bucket().filter(p=>!S.search.trim()||(String(p.name)+' '+p.id+' '+String(p.sourceName||'')).toLowerCase().includes(S.search.trim().toLowerCase()));
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
   if(!selected()){S.platformId=bucket()[0]?.id||'';resetLocalFilters();}
   S.page=Math.min(Math.max(1,Number(S.page)||1),Math.max(1,Math.ceil(platforms().length/S.size)));if(inflight&&(!selected()||inflight.key!==identity(selected())))cancel();
  }
  function capture(){const value=copy(S),hit=entry();return {...value,status:hit?.status||'idle',response:hit?.response||null,error:hit?.error||'',receivedAt:hit?.receivedAt||0};}
  function restore(value){
   cancel();S=value?.version===2?copy(value):initial();
   if(value?.version===1&&value.scope?.platforms?.length===1&&value.response){const p=value.scope.platforms[0];S.source=system(p)||'';S.country=p.country||'';S.platformId=p.id;S.cache[p.id]={key:identity(p),status:value.status==='loading'?'paused':value.status,response:copy(value.response),receivedAt:value.receivedAt||0,lastSuccessAt:value.response.queriedAt,attemptAt:value.receivedAt||0,error:value.error||''};}
   if(!S.cache||typeof S.cache!=='object'||Array.isArray(S.cache))S.cache={};for(const hit of Object.values(S.cache))if(hit.status==='loading')hit.status=hit.response?'ready':'paused';
   S.tab=['charge','withdraw'].includes(S.tab)?S.tab:'charge';S.includeAbsent=S.includeAbsent===true;S.size=[20,30,50,100,500].includes(S.size)?S.size:20;S.filterStatus=['all','on','off','unknown'].includes(S.filterStatus)?S.filterStatus:'all';S.provider=typeof S.provider==='string'?S.provider:'';S.category=typeof S.category==='string'?S.category:'';S.search=typeof S.search==='string'?S.search:'';for(const key of ['currency','channelQuery','merchantQuery','channelDraft','merchantDraft'])S[key]=typeof S[key]==='string'?S[key].slice(0,200):'';
  }
  function validate(response,p){
   if(!response||response.version!==1||!stamp(response.queriedAt)||!Array.isArray(response.platforms)||!Array.isArray(response.snapshots))throw Error('通道快照返回不完整，请点击上方平台重新读取');
   if(response.platforms.length!==1||response.platforms[0]?.id!==p.id||response.platforms[0]?.source!==p.source)throw Error('通道快照平台范围不匹配');
   const seen=new Set();for(const s of response.snapshots){
    if(s.platformId!==p.id||!['charge','withdraw'].includes(s.direction)||seen.has(s.direction)||!Array.isArray(s.channels))throw Error('通道快照方向或平台范围不匹配');
    if(middleSnapshot(s)&&String(p.source).toLowerCase()!=='ar'||p.capabilities?.channelStatusSource==='ar_middle'&&!middleSnapshot(s))throw Error('通道快照来源不匹配');
    seen.add(s.direction);const channels=new Set();if(s.observedAt!==null&&!stamp(s.observedAt)||!s.observedAt&&s.channels.length)throw Error('通道快照缺少采集时间');
    for(const row of s.channels){if(!row||typeof row.channel_id!=='string'||!row.channel_id||channels.has(row.channel_id))throw Error('通道身份缺失或重复');channels.add(row.channel_id);}
    for(const row of s.channels){if(row.channel_categories!==undefined&&row.channel_categories!==null&&(!Array.isArray(row.channel_categories)||row.channel_categories.some(x=>!x||typeof x.category_id!=='string')))throw Error('通道大类返回不完整');if(row.withdrawal_details!==undefined&&row.withdrawal_details!==null&&(typeof row.withdrawal_details!=='object'||Array.isArray(row.withdrawal_details)))throw Error('提现通道配置返回不完整');}
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
  function currencies(){return [...new Set(allRows().filter(x=>x.s.direction===S.tab).map(x=>x.row.limit_currency).filter(value=>typeof value==='string'&&value))].sort((a,b)=>a.localeCompare(b));}
  function resetLocalFilters(){S.provider='';S.filterStatus='all';S.category='';S.currency='';S.channelQuery='';S.merchantQuery='';S.channelDraft='';S.merchantDraft='';S.expanded=null;}
  const searchText=value=>String(value??'').trim().toLowerCase();
  function filteredRows(){
   const query=searchText(S.channelQuery),merchant=allowed('detail')?searchText(S.merchantQuery):'';
   return allRows().map((x,index)=>({x,index})).filter(({x})=>{const r=x.row,code=middleSnapshot(x.s)?knownCode(r.source_state):null,enabled=middleSnapshot(x.s)?code===1?true:code===0?false:null:r.enabled,names=[r.channel_id,r.sys_channel_id,r.channel_name,...(allowed('detail')?[r.source_channel_name]:[])],merchants=[r.third_pay_merchant_id,...(allowed('detail')&&middleSnapshot(x.s)&&x.s.direction==='withdraw'?[withdrawalDetails(r).merchant_name,withdrawalDetails(r).merchant_code]:[])];return x.s.direction===S.tab&&(S.includeAbsent||present(r))&&(!S.provider||r.provider===S.provider)&&(!S.category||hasCategory(r,S.category))&&(!S.currency||r.limit_currency===S.currency)&&(!query||names.some(value=>searchText(value).includes(query)))&&(!merchant||merchants.some(value=>searchText(value).includes(merchant)))&&(S.filterStatus==='all'||S.filterStatus==='on'&&enabled===true||S.filterStatus==='off'&&enabled===false||S.filterStatus==='unknown'&&enabled!==true&&enabled!==false);});
  }
  function percentage(value){const n=rate(value);return n===null?'—':'<span class="channel-rate'+(n<45?' channel-rate-low':'')+'">'+n.toFixed(2)+'%</span>';}
  const sourceValue=value=>value===null||value===undefined||value===''?'—':String(value);
  const sourceChannelName=value=>value===null||value===undefined||value===''?'源接口未提供':String(value);
  function columnSpec(direction,part){
   const middle=system(selected())==='AR',rates=rateColumns(middle,direction);
   if(middle){const withdrawal=direction==='withdraw',columns=withdrawal?middleWithdrawColumns():middleColumns(direction,rates);return {middle:true,withdrawal,rates,columns,headers:columns.map(x=>x.label),widths:columns.map(x=>x.width)};}
   const currencies=[...new Set(part.map(({x})=>x.row.limit_currency).filter(Boolean))],uniform=currencies.length===1&&part.every(({x})=>x.row.limit_currency===currencies[0]),currency=uniform?' ('+currencies[0]+')':'';
   const headers=['通道名称','支付供应商','通道类型',...(direction==='charge'?['支付方式']:[]),'最小交易金额'+currency,'最大交易金额'+currency,...(uniform?[]:['限额币种']),...rates.labels,'余额','余额币种',...(direction==='charge'?['代收次数要求']:['余额阈值','阈值币种']),'优先级','权重','状态','备注'];
   const widths=headers.map(h=>h==='通道名称'?180:h==='支付供应商'?130:h==='备注'?280:h.includes('状态')?110:h==='支付方式'?180:h.includes('成功率')?104:h.includes('币种')?75:h.includes('交易金额')||h==='余额'||h==='余额阈值'?120:h==='权重'||h==='优先级'?75:100);
   return {middle:false,uniform,headers,widths,rates};
  }
  function noteCell(x,index){const notes=String(x.row.notes||''),expanded=S.expanded===rowKey(x),long=notes.length>50;return '<td class="channel-notes"><div class="channel-notes-text'+(long&&!expanded?' collapsed':'')+'" title="'+E(notes)+'">'+E(notes||'—')+'</div>'+(long&&allowed('detail')?'<button class="link channel-note-toggle" type="button" aria-expanded="'+expanded+'" onclick="liveChannelToggle('+index+')">'+(expanded?'收起备注':'展开备注')+'</button>':'')+'</td>';}
  const knownCode=value=>(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^(?:0|-?[1-9]\d*)$/.test(value))?Number(value):null;
  function availability(r){const channel=knownCode(r.source_channel_state),merchant=knownCode(r.source_merchant_state);return channel===0?{label:'总控通道关闭',type:'closed'}:merchant===0?{label:'三方商户关闭',type:'closed'}:channel===1?{label:'可用',type:'available'}:{label:'—',type:'unknown'};}
  function readonlyState(r){
   if(!present(r))return '<span class="channel-state missing">本次未出现</span>';
   const state=knownCode(r.source_state),enabled=state===1?true:state===0?false:null,value=enabled===true?'true':'false',label=enabled===true?'开启':enabled===false?'关闭':'状态未提供',usable=availability(r);
   const indicator=enabled===null?'<span class="channel-status-unknown" aria-label="启用状态未提供">—</span>':'<button type="button" disabled class="channel-readonly-switch '+(enabled?'on':'off')+'" role="switch" aria-checked="'+value+'" aria-readonly="true" aria-label="启用状态：'+label+'，源站配置只读" title="源站配置只读"><i aria-hidden="true"></i></button>';
   return '<div class="channel-switch-line"><span class="channel-state-label">通道状态</span>'+indicator+'<span>'+label+'</span></div><small class="channel-availability '+usable.type+'"><span class="channel-state-label">可用状态</span>'+usable.label+'</small>';
  }
  function middleColumns(direction,rates){
   const text=key=>x=>E(sourceValue(x.row[key])),number=key=>x=>fmt(x.row[key]),column=(label,width,value,className='',heading=false)=>({label,width,value,className,heading});
   const categoriesCell=x=>{const r=x.row,cats=rowCategories(r),names=cats.length?cats.map(cat=>cat.category_name||cat.category_id):[r.category_name||r.category_id||'—'];return names.map(name=>'<div>'+E(name)+'</div>').join('');};
   const limits=x=>'<div>'+fmt(x.row.min_amount)+'<span> – </span>'+fmt(x.row.max_amount)+'</div><small>'+E(x.row.limit_currency||'币种未提供')+'</small>';
   const balance=x=>fmt(x.row.balance)+'<small>'+E(x.row.balance_currency||(numeric(x.row.balance)!==null?'币种未提供':'—'))+'</small>';
   const detail=allowed('detail');
   return [column(direction==='charge'?'充值大类':'提现大类',115,categoriesCell,'channel-category'),column('状态',140,x=>readonlyState(x.row),'channel-compact-state'),column('通道 ID',100,text('channel_id'),'channel-id'),column('支付供应商',130,text('provider'),'channel-provider'),...(detail?[column('源通道名称',160,x=>E(sourceChannelName(x.row.source_channel_name)),'channel-source-name')]:[]),column(direction==='charge'?'前台显示名称':'出款显示名称',180,text('channel_name'),'channel-display-name',true),column('系统通道 ID',110,text('sys_channel_id')),...rates.fields.map((field,i)=>column(rates.labels[i],104,x=>percentage(sourceRate(x.row,x.s,field)),'channel-rate-cell num')),column('限额',140,limits,'channel-limits'),column('轮询权重',160,x=>nativeGrid([['预设权重',E(sourceValue(x.row.weight))],['实时权重',E(sourceValue(x.row.real_time_weight))]]),'channel-polling-weight'),...(direction==='withdraw'?[column('余额',140,balance,'channel-compact-balance num')]:[]),...(detail?[
    column('第三方商户 ID',160,text('third_pay_merchant_id')),column('费率（源值）',110,text('fee_rate'),'num'),column('费率口径',110,text('fee_rate_basis')),column('固定手续费',115,number('fee_amount'),'num'),column('优先级',85,text('priority'),'num'),column('代收次数要求',110,text('required_deposit_count'),'num'),column('余额阈值',115,number('balance_threshold'),'num'),column('阈值币种',90,text('balance_threshold_currency')),column('主大类 ID',100,text('category_id')),column('主大类名称',140,text('category_name')),column('全部大类 / ID / 排序',250,x=>rowCategories(x.row).map(cat=>'<div>'+E(sourceValue(cat.category_name))+' · '+E(cat.category_id)+' · 排序 '+E(sourceValue(cat.sort))+'</div>').join('')||'—','channel-all-categories'),column('通道类型',130,text('channel_type')),column('支付方式',130,text('payment_method')),column('源启用状态原码',110,text('source_state')),column('通道可用状态原码',125,text('source_channel_state')),column('商户可用状态原码',125,text('source_merchant_state')),column('源站状态原文',190,text('status_text')),column('源更新时间',195,text('source_updated_at')),column('源页顺序',90,text('source_position'),'num'),column('备注',300,x=>'<div class="channel-notes-text">'+E(sourceValue(x.row.notes))+'</div>','channel-notes')
   ]:[])];
  }
  const withdrawalDetails=row=>row.withdrawal_details&&typeof row.withdrawal_details==='object'&&!Array.isArray(row.withdrawal_details)?row.withdrawal_details:{};
  const countValue=value=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647?String(value):'—';
  const nativeTitle=value=>String(value).replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[entity]));
  const nativeGrid=rows=>'<div class="channel-native-grid">'+rows.map(([label,value])=>'<span class="channel-native-label">'+E(label)+'：</span><div class="channel-native-value" title="'+E(nativeTitle(value))+'">'+value+'</div>').join('')+'</div>';
  const nativeTime=(value,p)=>stamp(value)?clock(value,p).replaceAll('/','-').replace('T',' ').slice(0,16):'—';
  const missingDictionary=label=>'<span class="channel-dictionary-pending">'+E(label)+'字典待采集</span>';
  const noDetail=()=>'<span class="channel-detail-denied">未获明细权限</span>';
  function timezoneOffset(p){try{return new Intl.DateTimeFormat('en-US',{timeZone:p.timezone||'UTC',timeZoneName:'shortOffset'}).formatToParts(new Date(snapshot()?.observedAt||entry()?.response?.queriedAt||Date.now())).find(part=>part.type==='timeZoneName')?.value.replace('GMT','UTC')||p.timezone||'UTC';}catch{return p.timezone||'UTC';}}
  function withdrawalCode(d){
   const mode=d.is_use_channel_code===false?'不使用':d.is_use_channel_code===true&&d.is_fixed_channel_code===true?'固定':d.is_use_channel_code===true&&d.is_fixed_channel_code===false?'动态':null,code=String(d.third_channel_code??'').trim(),rows=[['类型',mode?E(mode):'—']];
   if(code||mode==='动态')rows.push(['编码',E(code||'—')]);return nativeGrid(rows);
  }
  function middleWithdrawColumns(){
   const column=(label,width,value,className='',heading=false)=>({label,width,value,className,heading}),detail=allowed('detail'),privateCell=fn=>x=>detail?fn(x,withdrawalDetails(x.row)):noDetail(),offset=' ('+timezoneOffset(selected())+')';
   const merchant=x=>{const name=detail?withdrawalDetails(x.row).source_tenant_name:null,id=x.s.sourceTenantId,label=(id!==undefined&&id!==null&&id!==''?'('+id+')':'')+(name||x.p.name||'—');return '<span class="channel-tenant-label" title="'+E(label)+'">'+E(label)+'</span>';};
   const balance=x=>nativeGrid([['通道余额',E(sourceValue(x.row.balance))],['更新时间',detail?'<span class="channel-native-muted">'+E(nativeTime(withdrawalDetails(x.row).balance_updated_at,x.p))+'</span>':noDetail()]]);
   const identity=x=>nativeGrid([['通道 ID','<span>'+E(x.row.channel_id)+'</span>'+(x.row.provider?'<span class="channel-pay-code">'+E(x.row.provider)+'</span>':'')]]);
   const name=x=>{const id=sourceValue(x.row.sys_channel_id),original=detail?(x.row.source_channel_name?E(x.row.source_channel_name):missingDictionary('源通道名称')):noDetail();return nativeGrid([['通道名称',(id!=='—'?'['+E(id)+'] ':'')+original],['出款显示名称',E(sourceValue(x.row.channel_name))]]);};
   const counters=privateCell((x,d)=>nativeGrid([['今日已提交笔数',E(countValue(d.today_submit_count))],['近1小时成功笔数',E(countValue(d.recent_1h_success_count))]]));
   const thirdMerchant=privateCell((x,d)=>nativeGrid([['昵称',d.merchant_name?E(d.merchant_name):missingDictionary('三方商户昵称')],['商户号',E(sourceValue(d.merchant_code))]]));
   const gateway=privateCell((x,d)=>nativeGrid([['网关地址',E(sourceValue(d.third_pay_api_url))],['回调白名单 IP',E(Array.isArray(d.notify_white_ips)?d.notify_white_ips.join('|')||'—':'—')]]));
   const builtin=privateCell((x,d)=>d.system_category_name?'<span class="channel-builtin-category">'+E(d.system_category_name)+'</span>':(d.system_category_id!==null&&d.system_category_id!==undefined?'['+E(d.system_category_id)+'] ':'')+missingDictionary('内置提现大类'));
   const updated=privateCell((x,d)=>'<div>'+E(sourceValue(d.last_update_by))+'</div><div class="channel-native-muted">'+E(nativeTime(Object.prototype.hasOwnProperty.call(d,'last_updated_at')?d.last_updated_at:x.row.source_updated_at,x.p))+'</div>');
   const operations=()=>'<div class="channel-readonly-actions" aria-label="源站操作仅作只读展示">'+['代付测试','编辑','删除'].map(label=>'<button type="button" disabled class="channel-readonly-action" title="源站写操作未接入">'+label+'</button>').join('')+'</div><small class="channel-native-muted">源站操作未接入</small>';
   return [column('商户',140,merchant,'channel-tenant'),column('状态',168,x=>readonlyState(x.row),'channel-compact-state'),column('通道余额'+offset,198,balance,'channel-withdraw-balance'),column('通道 ID',246,identity,'channel-withdraw-id'),column('通道名称',260,name,'channel-withdraw-name',true),column('成功率统计',240,counters,'channel-withdraw-counts'),column('三方商户昵称 / 商户号',224,thirdMerchant,'channel-withdraw-merchant'),column('自动出款权重',110,x=>E(sourceValue(x.row.weight)),'num'),column('提现金额区间',104,x=>E(sourceValue(x.row.min_amount))+'~'+E(sourceValue(x.row.max_amount)),'channel-withdraw-range'),column('自动关闭阈值',122,privateCell(x=>E(sourceValue(x.row.balance_threshold))),'num'),column('三方通道编码',168,privateCell((x,d)=>withdrawalCode(d)),'channel-withdraw-code'),column('通道币种',100,x=>E(sourceValue(x.row.limit_currency))),column('提现大类',160,x=>E(sourceValue(x.row.category_name)),'channel-withdraw-category'),column('网关信息',300,gateway,'channel-withdraw-gateway'),column('内置提现大类',140,builtin,'channel-withdraw-builtin'),column('备注',160,privateCell(x=>'<div class="channel-notes-text">'+E(sourceValue(x.row.notes))+'</div>'),'channel-notes'),column('最后修改人 / 时间'+offset,260,updated,'channel-withdraw-update'),column('操作',160,operations,'channel-withdraw-actions')];
  }
  function middleRow(x,index,spec){
   return '<tr class="'+(!present(x.row)?'channel-absent':'')+'">'+spec.columns.map(column=>{const tag=column.heading?'th':'td';return '<'+tag+(column.heading?' scope="row"':'')+(column.className?' class="'+column.className+'"':'')+'>'+column.value(x)+'</'+tag+'>';}).join('')+'</tr>';
  }
  function rowHtml(x,index,spec){
   if(spec.middle)return middleRow(x,index,spec);
   const r=x.row,unseen=!present(r),label=E(r.channel_name||r.channel_id),identityText='通道 ID：'+r.channel_id+'；最近出现：'+clock(rowObserved(r,x.s),x.p);
   return '<tr class="'+(unseen?'channel-absent':'')+'"><th scope="row" class="channel-name" title="'+E(identityText)+'">'+label+'</th><td class="channel-provider">'+E(r.provider||'—')+'</td><td>'+E(r.channel_type||'—')+'</td>'+(x.s.direction==='charge'?'<td class="channel-payment-method">'+E(r.payment_method||'—')+'</td>':'')+'<td class="num">'+fmt(r.min_amount)+'</td><td class="num">'+fmt(r.max_amount)+'</td>'+(!spec.uniform?'<td>'+E(r.limit_currency||'—')+'</td>':'')+spec.rates.fields.map(k=>'<td class="num">'+percentage(sourceRate(r,x.s,k))+'</td>').join('')+'<td class="num">'+fmt(r.balance)+'</td><td>'+E(r.balance_currency||(numeric(r.balance)!==null?'未提供':'—'))+'</td>'+(x.s.direction==='charge'?'<td class="num">'+E(r.required_deposit_count??'—')+'</td>':'<td class="num">'+fmt(r.balance_threshold)+'</td><td>'+E(r.balance_threshold_currency||(numeric(r.balance_threshold)!==null?'未提供':'—'))+'</td>')+'<td class="num">'+E(r.priority??'—')+'</td><td class="num">'+E(r.weight??'—')+'</td><td><span class="channel-state '+(unseen?'missing':r.enabled===true?'enabled':r.enabled===false?'disabled':'')+'" title="'+E(r.status_text||'')+'">'+E(status(r))+'</span>'+(unseen?'<small class="channel-last-seen">最近 '+E(clock(rowObserved(r,x.s),x.p))+'</small>':'')+'</td>'+noteCell(x,index)+'</tr>';
  }
  function sheet(){
   const p=selected();if(!p)return '<div class="channel-empty">请选择有权限的平台。</div>';
   const hit=entry(),s=snapshot(),rows=allRows(),directionRows=rows.filter(x=>x.s.direction===S.tab),absent=directionRows.filter(x=>!present(x.row));
   let html='<header class="channel-sheet-head"><div class="channel-sheet-identity"><h3>'+E(p.name)+'</h3><small>'+E(p.country)+' / '+systemLabel(S.source)+' · '+E(p.timezone||'UTC')+'</small></div><div class="channel-snapshot-times"><span>'+E(p.name)+' · 最新采集 '+(s?.observedAt?E(clock(s.observedAt,p))+'（'+E(p.timezone||'UTC')+'） <span class="'+(stale(s.observedAt)?'channel-stale':'')+'">'+(s.complete===true?'':'采集未完整 · ')+(stale(s.observedAt)?'超过 15 分钟未更新':'已更新')+'</span>':'— · 尚未收到快照')+'</span><span>最后成功读取 '+E(clock(hit?.lastSuccessAt,p))+'</span></div></header>';
   const cats=categories(),part=filteredRows(),providerList=providers(),currencyList=currencies(),merchantLabel=S.tab==='withdraw'?'三方商户昵称 / 商户号 / ID':'第三方商户 ID';
   const directionTabs='<div class="channel-tabs" role="tablist" aria-label="充值和提现通道">'+['charge','withdraw'].map(d=>'<button type="button" role="tab" aria-selected="'+(S.tab===d)+'" class="'+(S.tab===d?'on':'')+'" onclick="liveChannelTab(\''+d+'\')">'+(d==='charge'?'充值通道':'提现通道')+'</button>').join('')+'</div>';
   const localFilters=allowed('query')&&supported(p)&&hit?.response&&!L.dirty?'<form class="channel-local-filters" aria-label="当前平台通道筛选" onsubmit="liveChannelQuery(this.elements.channel.value,this.elements.merchant?this.elements.merchant.value:\'\');return false"><label>通道 ID / 名称<input type="search" name="channel" aria-label="通道 ID 或名称" placeholder="通道 ID / 系统 ID / 名称" value="'+E(S.channelDraft)+'" oninput="liveChannelQueryDraft(this.name,this.value)"></label>'+(system(p)==='AR'&&allowed('detail')?'<label>'+E(merchantLabel)+'<input type="search" name="merchant" aria-label="'+E(merchantLabel)+'" placeholder="'+E(S.tab==='withdraw'?'昵称 / 商户号 / 第三方商户 ID':'第三方商户 ID')+'" value="'+E(S.merchantDraft)+'" oninput="liveChannelQueryDraft(this.name,this.value)"></label>':'')+'<label>支付三方<select aria-label="支付三方" onchange="liveChannelProvider(this.value)"><option value="">全部三方</option>'+providerList.map(value=>'<option value="'+E(value)+'" '+(S.provider===value?'selected':'')+'>'+E(value)+'</option>').join('')+'</select></label><label>状态<select aria-label="通道状态" onchange="liveChannelStatus(this.value)">'+[['all','全部状态'],['on','已启用'],['off','已禁用'],['unknown','未提供']].map(([value,label])=>'<option value="'+value+'" '+(S.filterStatus===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+(cats.length?'<label>通道大类<select aria-label="通道大类" onchange="liveChannelCategory(this.value)"><option value="">全部大类 ('+cats.length+')</option>'+cats.map(cat=>'<option value="'+E(cat.id)+'" '+(S.category===cat.id?'selected':'')+'>'+E(cat.name)+' ('+directionRows.filter(x=>present(x.row)&&hasCategory(x.row,cat.id)).length+')</option>').join('')+'</select></label>':'')+'<label>限额币种<select aria-label="限额币种" onchange="liveChannelCurrency(this.value)"><option value="">全部币种</option>'+currencyList.map(value=>'<option value="'+E(value)+'" '+(S.currency===value?'selected':'')+'>'+E(value)+'</option>').join('')+'</select></label><button type="submit">搜索通道</button><button type="button" onclick="liveChannelClearFilters()">清空</button>'+(absent.length?'<label class="channel-history-toggle"><input type="checkbox" '+(S.includeAbsent?'checked ':'')+'onchange="liveChannelAbsent(this.checked)">显示本次未出现 ('+absent.length+')</label>':'')+'</form>':'';
   html+='<div class="channel-table-toolbar">'+directionTabs+localFilters+'</div>';
   if(!allowed('query'))return html+'<div class="channel-empty">当前角色未获查询权限</div>';
   if(S.accessError)return html+'<div class="channel-update-error" role="alert">'+E(S.accessError)+' · 点击上方平台重新验证授权。</div>';
   if(!supported(p))return html+'<div class="channel-unavailable">未接入通道快照：'+E(p.name)+'</div>';
   if(hit?.error)html+='<div class="channel-update-error" role="alert">更新失败：'+E(hit.error)+(hit.response?' · 保留上次成功读取的快照':'')+'</div>';
   if(hit?.status==='loading')html+='<div class="channel-update-status" role="status">'+(hit.response?'正在刷新，显示上次快照…':'正在读取最新通道快照…')+'</div>';
   if(!hit?.response)return html+'<div class="channel-empty">'+(hit?.status==='paused'?'读取已暂停，点击上方平台重新读取。':hit?.status==='loading'?'读取中…':hit?.error?'点击上方平台重试。':'当前平台将自动读取；点击上方平台可重新读取。')+'</div>';
   if(L.dirty)return html+'<div class="channel-empty">范围已变化，点击上方平台重新读取。</div>';
   html+='<section class="channel-panel" role="tabpanel">';
   const hasSourceOrder=directionRows.filter(x=>present(x.row)).length>0&&directionRows.filter(x=>present(x.row)).every(x=>Number.isFinite(sourcePosition(x.row)));
   html+='<header><span>'+(s?.observedAt&&s.complete===true?part.filter(({x})=>present(x.row)).length+' 个当前通道':part.length?'已读 '+part.filter(({x})=>present(x.row)).length+' 个当前通道':'当前通道 —')+(s?.sourceCount!==null&&s?.sourceCount!==undefined?' · 源通道数 '+E(s.sourceCount):'')+'</span><span>'+(hasSourceOrder?'源页顺序':'启用优先，优先级从小到大')+'</span></header>';
   if(!part.length)html+='<div class="channel-empty">'+(S.provider||S.filterStatus!=='all'||S.category||S.currency||S.channelQuery||allowed('detail')&&S.merchantQuery?'当前筛选没有匹配通道':s?.complete===true&&s?.observedAt?'已采集，暂无通道':'尚未收到完整通道快照')+'</div>';
   else {const spec=columnSpec(S.tab,part);html+='<div class="channel-scroll" tabindex="0" aria-label="'+(S.tab==='charge'?'充值':'提现')+'通道配置，可横向滚动"><table class="channel-table '+(spec.middle?'channel-ar-source-table'+(spec.withdrawal?' channel-ar-withdraw-table':''):'')+'" style="width:'+spec.widths.reduce((a,b)=>a+b,0)+'px;min-width:100%"><colgroup>'+spec.widths.map(w=>'<col style="width:'+w+'px">').join('')+'</colgroup><thead><tr>'+spec.headers.map((h,i)=>'<th'+(spec.middle?(spec.columns[i].className?' class="'+spec.columns[i].className+'"':''):(h==='通道名称'?' class="channel-name"':h==='支付供应商'?' class="channel-provider"':''))+' scope="col">'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+part.map(({x,index})=>rowHtml(x,index,spec)).join('')+'</tbody></table></div>';}
   return html+'</section><p class="channel-scope-note">'+(system(p)==='AR'&&S.tab==='withdraw'?'只读展示源站提现配置 · 成功率统计为今日已提交笔数 / 近1小时成功笔数 · 字典待采集表示尚未收到源字典 · 源站写操作未接入':'只读展示源站配置 · 成功率按源站口径 · 低于 45% 标红')+' · — 表示源站未提供</p>';
  }
  function render(){
   if(!active()){if(c.getPage()===PAGE){cancel();S.cache={};L.pageQueried=false;}else stopTimers();return '';}if(!ready())return '<div class="channel-empty">正在读取账号可见的平台目录…</div>';reconcile();if(!allowed('query')){cancel();S.cache={};L.pageQueried=false;}activate();scheduleFreshness();
   const list=platforms(),pages=Math.max(1,Math.ceil(list.length/S.size)),from=(S.page-1)*S.size,items=list.slice(from,from+S.size);
   const sourceTabs='<div class="channel-source-tabs" role="tablist" aria-label="源系统">'+systems().map((value,i)=>'<button type="button" role="tab" aria-selected="'+(S.source===value)+'" class="'+(S.source===value?'active':'')+'" onclick="liveChannelSource('+i+')">'+systemLabel(value)+'</button>').join('')+'</div>';
   const countryTabs='<div class="channel-country-tabs" role="tablist" aria-label="国家和盘口">'+countries().map((value,i)=>'<button type="button" role="tab" aria-selected="'+(S.country===value)+'" class="'+(S.country===value?'active':'')+'" onclick="liveChannelCountry('+i+')">'+E(value)+'</button>').join('')+'</div>';
   const platformButtons=items.map(p=>{const cached=entryFor(p),time=cached?.response?.snapshots.find(x=>x.direction===S.tab)?.observedAt;return '<button type="button" class="'+(S.platformId===p.id?'active':'')+'" aria-pressed="'+(S.platformId===p.id)+'" onclick="liveChannelSelect('+list.indexOf(p)+')"><strong>'+E(p.name)+'</strong><small>'+(!supported(p)?'未接入':cached?.status==='loading'?'读取中':time?E(clock(time,p).slice(5,16)):cached?.error?'读取失败':cached?.response?'尚未收到快照':'待读取')+'</small></button>';}).join('');
   const pager='<div class="channel-pager"><span>共 '+list.length+' 个 · '+(list.length?from+1:0)+'–'+Math.min(from+S.size,list.length)+'</span><div><button type="button" onclick="liveChannelPage(1)" '+(S.page<=1?'disabled':'')+'>首页</button><button type="button" aria-label="上一页平台" onclick="liveChannelPage('+(S.page-1)+')" '+(S.page<=1?'disabled':'')+'>‹</button><span>'+S.page+'/'+pages+'</span><button type="button" aria-label="下一页平台" onclick="liveChannelPage('+(S.page+1)+')" '+(S.page>=pages?'disabled':'')+'>›</button><button type="button" onclick="liveChannelPage('+pages+')" '+(S.page>=pages?'disabled':'')+'>末页</button></div><select aria-label="每页平台数" onchange="liveChannelPageSize(this.value)">'+[20,30,50,100,500].map(value=>'<option value="'+value+'" '+(S.size===value?'selected':'')+'>'+value+' / 页</option>').join('')+'</select></div>';
   return '<div class="live-channel-status"><div class="channel-scope-tabs">'+sourceTabs+countryTabs+'<span class="channel-refresh-note">只读同步 · 每 5 分钟自动刷新</span></div><div class="channel-browser"><section class="channel-platform-directory" aria-label="选择平台"><div class="channel-directory-toolbar"><form onsubmit="liveChannelSearch(this.elements.platform.value);return false"><input type="search" name="platform" aria-label="平台名称" placeholder="搜索平台" oninput="liveChannelSearch(this.value,true,event.isComposing)" oncompositionend="liveChannelSearch(this.value,true)" value="'+E(S.search)+'"><button type="submit">搜索</button></form>'+pager+'</div><div class="channel-platforms">'+platformButtons+(!items.length?'<div class="channel-empty">当前范围无平台</div>':'')+'</div></section><article>'+sheet()+'</article></div></div>';
  }
  function choose(p){if(!active()||!p)return;if(inflight?.key===identity(p))return;cancel();S.platformId=p.id;resetLocalFilters();L.dirty=false;L.pageQueried=!!entryFor(p)?.response;if(allowed('query')&&supported(p)&&visible())load();else paint();}
  root.liveChannelSource=index=>{if(!active()||!Number.isSafeInteger(index)||!systems()[index])return;cancel();S.source=systems()[index];S.country='';S.platformId='';S.search='';S.page=1;reconcile();choose(selected());};
  root.liveChannelCountry=index=>{if(!active()||!Number.isSafeInteger(index)||!countries()[index])return;cancel();S.country=countries()[index];S.platformId='';S.search='';S.page=1;reconcile();choose(selected());};
  root.liveChannelSelect=index=>{if(!active()||!Number.isSafeInteger(index))return;choose(platforms()[index]);};
  root.liveChannelSearch=(value,keepFocus=false,composing=false)=>{if(!active())return;if(composing){S.search=String(value??'').slice(0,200);return;}const field=keepFocus?root.document?.activeElement:null,start=field?.selectionStart,end=field?.selectionEnd;S.search=(keepFocus?String(value??''):String(value??'').trim()).slice(0,200);S.page=1;paint();if(keepFocus){const input=root.document?.querySelector?.('.live-channel-status input[name="platform"]');input?.focus?.();if(Number.isInteger(start)&&Number.isInteger(end))input?.setSelectionRange?.(start,end);}};
  root.liveChannelQueryDraft=(name,value)=>{if(!current()||!entry()?.response||!['channel','merchant'].includes(name)||name==='merchant'&&!allowed('detail'))return;S[name==='channel'?'channelDraft':'merchantDraft']=String(value??'').slice(0,200);};
  root.liveChannelQuery=(channel,merchant='')=>{if(!current()||!entry()?.response)return;S.channelQuery=String(channel??'').trim().slice(0,200);S.merchantQuery=allowed('detail')?String(merchant??'').trim().slice(0,200):'';S.channelDraft=S.channelQuery;S.merchantDraft=S.merchantQuery;S.expanded=null;paint();};
  root.liveChannelClearFilters=()=>{if(!current()||!entry()?.response)return;resetLocalFilters();S.includeAbsent=false;paint();};
  root.liveChannelCurrency=value=>{if(!current()||!entry()?.response||typeof value!=='string'||value&&!currencies().includes(value))return;S.currency=value;S.expanded=null;paint();};
  root.liveChannelPage=value=>{if(!active()||!Number.isSafeInteger(value))return;S.page=Math.max(1,Math.min(value,Math.max(1,Math.ceil(platforms().length/S.size))));paint();};
  root.liveChannelPageSize=value=>{if(!active()||![20,30,50,100,500].includes(Number(value)))return;S.size=Number(value);S.page=1;paint();};
  root.liveChannelProvider=value=>{if(!current()||!entry()?.response||typeof value!=='string'||value&&!providers().includes(value))return;S.provider=value;S.expanded=null;paint();};
  root.liveChannelStatus=value=>{if(!current()||!['all','on','off','unknown'].includes(value))return;S.filterStatus=value;S.expanded=null;paint();};
  root.liveChannelCategory=value=>{if(!current()||typeof value!=='string'||value&&!categories().some(x=>x.id===value))return;S.category=value;S.expanded=null;paint();};
  root.liveChannelAbsent=value=>{if(!current()||typeof value!=='boolean')return;S.includeAbsent=value;S.expanded=null;paint();};
  root.liveChannelTab=direction=>{if(!active()||!['charge','withdraw'].includes(direction))return;const filterStatus=S.filterStatus;S.tab=direction;resetLocalFilters();S.filterStatus=filterStatus;paint();};
  root.liveChannelToggle=index=>{if(!current()||!allowed('detail')||!Number.isSafeInteger(index))return;const x=allRows()[index];if(!x)return;const k=rowKey(x);S.expanded=S.expanded===k?null:k;paint();};
  function canExport(){return current()&&allowed('query')&&allowed('export')&&!!entry()?.response;}
  function exportRows(){
   if(!canExport())return [];const hit=entry(),middle=system(selected())==='AR',withdrawal=middle&&S.tab==='withdraw',rates=rateColumns(middle,S.tab),rows=filteredRows(),detail=allowed('detail'),countLabels=withdrawal?['今日已提交笔数','近1小时成功笔数']:[],realWeightLabels=middle&&S.tab==='charge'?['实时权重']:[],withdrawalLabels=withdrawal?['源租户 ID','源租户名称','余额更新时间','三方商户昵称','三方商户号','三方通道编码','使用通道编码','固定通道编码','内置提现大类 ID','内置提现大类','网关地址','回调白名单 IP','最后修改人','源最后修改时间']:[];
   const counts=r=>withdrawal?[countValue(detail?withdrawalDetails(r).today_submit_count:null),countValue(detail?withdrawalDetails(r).recent_1h_success_count:null)]:[];
   const withdrawalValues=(r,s)=>{if(!withdrawal)return [];const d=detail?withdrawalDetails(r):{};return [s.sourceTenantId||'—',sourceValue(d.source_tenant_name),sourceValue(d.balance_updated_at),sourceValue(d.merchant_name),sourceValue(d.merchant_code),sourceValue(d.third_channel_code),d.is_use_channel_code===true?'是':d.is_use_channel_code===false?'否':'—',d.is_fixed_channel_code===true?'是':d.is_fixed_channel_code===false?'否':'—',sourceValue(d.system_category_id),sourceValue(d.system_category_name),sourceValue(d.third_pay_api_url),Array.isArray(d.notify_white_ips)?d.notify_white_ips.join('|')||'—':'—',sourceValue(d.last_update_by),sourceValue(d.last_updated_at)];};
   return [['统计口径',withdrawal?'源站提现通道快照；成功率统计列为今日已提交笔数 / 近1小时成功笔数，均为源站笔数，不是百分率。':'源站通道快照；成功率为源站各时间窗口原值，不等于本系统订单成功率，不合并平均。'],['查询时间',hit.response.queriedAt],['导出范围',(S.tab==='charge'?'充值通道':'提现通道')+' · '+(S.includeAbsent?'当前通道及本次未出现的历史通道':'仅当前通道')+' · 当前平台及本地筛选'],['平台','方向','通道大类 ID','通道大类','全部大类 ID','全部大类','通道 ID','系统通道 ID','源通道名称','源页顺序','通道名称','支付供应商','通道类型','支付方式','最小交易金额','最大交易金额','限额币种',...rates.labels,...countLabels,'余额','余额币种','代收次数要求','余额阈值','阈值币种','优先级','权重',...realWeightLabels,'状态','源启用状态','通道可用状态','商户可用状态','费率（源值）','费率口径','固定手续费','第三方商户 ID','源更新时间','源站状态','本次出现','备注','最近出现时间','快照采集时间','服务器接收时间','快照完整','源通道数','更新状态','最后成功读取时间','最近更新错误',...withdrawalLabels],...rows.map(({x:{row:r,s,p}})=>[p.name,s.direction==='charge'?'充值':'提现',sourceValue(r.category_id),sourceValue(r.category_name),rowCategories(r).map(x=>x.category_id).join(' / ')||'—',rowCategories(r).map(x=>x.category_name||x.category_id).join(' / ')||'—',r.channel_id,sourceValue(r.sys_channel_id),sourceValue(r.source_channel_name),Number.isFinite(sourcePosition(r))?sourcePosition(r):'—',r.channel_name||r.channel_id,r.provider||'—',r.channel_type||'—',r.payment_method||'—',withdrawal?sourceValue(r.min_amount):numeric(r.min_amount)??'—',withdrawal?sourceValue(r.max_amount):numeric(r.max_amount)??'—',r.limit_currency||'—',...rates.fields.map(k=>{const value=sourceRate(r,s,k);return rate(value)===null?'—':rate(value).toFixed(2)+'%';}),...counts(r),withdrawal?sourceValue(r.balance):numeric(r.balance)??'—',r.balance_currency||(numeric(r.balance)!==null?'未提供':'—'),r.required_deposit_count??'—',withdrawal?sourceValue(detail?r.balance_threshold:null):numeric(r.balance_threshold)??'—',r.balance_threshold_currency||(numeric(r.balance_threshold)!==null?'未提供':'—'),r.priority??'—',r.weight??'—',...(realWeightLabels.length?[sourceValue(r.real_time_weight)]:[]),status(r),sourceValue(r.source_state),sourceValue(r.source_channel_state),sourceValue(r.source_merchant_state),sourceValue(r.fee_rate),sourceValue(r.fee_rate_basis),numeric(r.fee_amount)??'—',sourceValue(r.third_pay_merchant_id),sourceValue(r.source_updated_at),r.status_text||'—',present(r)?'是':'否',r.notes||'—',rowObserved(r,s)||'—',s.observedAt||'—',s.receivedAt||'—',s.complete===true?'是':'否',s.sourceCount??'—',stale(rowObserved(r,s))?'超过 15 分钟未更新':'已更新',hit.lastSuccessAt||'—',hit.error||'—',...withdrawalValues(r,s)])];
  }
  root.document?.addEventListener?.('visibilitychange',()=>{if(!visible())cancel();else if(active())paint();});root.addEventListener?.('pagehide',clear);
  return {load,cancel,clear,capture,restore,render,providers,canExport,exportRows};
 }
 root.HensemLiveChannelStatus={create};
})(window);
