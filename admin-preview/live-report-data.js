/* Source-native daily reports stay separate from order aggregates and from other report grains. */
(function(root){
 'use strict';
 const datasets=new Set(['volume','panda_success','lg_success','collection_success','newar_third_party_volume','auto']);
 const configs=new Set(['ar_config','panda_config','wg_config','newar_config','game66_config']);
 const labels={volume:'三方金额 / 笔数日报',panda_success:'成功率日报',lg_success:'经营日报',collection_success:'成功数据快照',newar_third_party_volume:'三方日报',auto:'自动出款日报'};
 const metricLabels={amount:'金额',count:'笔数',successAmount:'成功金额',successCount:'成功笔数',failedCount:'失败笔数',pendingCount:'处理中笔数',unknownCount:'未知状态笔数',rejectedCount:'驳回笔数',autoCount:'自动出款笔数',manualCount:'人工笔数'};
 const summaryMetrics=['amount','count','successAmount','successCount'];
 const pages=new Set(['overview','providers','provider_payout','collection','payout','merchants','merchantproviders','teamops','teamcountries','teamplatforms']);
 const detailPages=new Set(['orders','time','amount','matrix','latency','stuck','provider_daily']);
 const direction=value=>({recharge:'charge',deposit:'charge',collect:'charge','代收':'charge',payout:'withdraw','代付':'withdraw'})[value]||value;
 const legacyPanghu=new Set(['胖虎巴西','BR_PANGHU','PANGHU BRAZIL','PANDA PANGHU']);
 const legacyTeams={'香港':'香港',HK_TEAM:'香港',HONG_KONG:'香港',GAME66_HK:'香港','红膏蟹':'红膏蟹','紅膏蟹':'红膏蟹',RED_CRAB:'红膏蟹',GAME66_RED_CRAB:'红膏蟹'};
 const token=value=>String(value??'').trim().toUpperCase();
 const countryNames={IN:'印度',INDIA:'印度',BR:'巴西',BRAZIL:'巴西',PK:'巴基斯坦',ID:'印尼',VN:'越南',PH:'菲律宾',MY:'马来',MM:'缅甸',NG:'尼日利亚',CO:'哥伦比亚',MX:'墨西哥',CL:'智利'};
 // Owner-confirmed assignments, also persisted in dashboard_platform_team_map.
 // These fill authorized report seeds before the mapped feed directory arrives.
 const confirmedM8={墨西哥:new Set(['NPG-MEXICO']),智利:new Set(['NPG-CHILE']),哥伦比亚:new Set(['NPG-COLOMBIA']),印尼:new Set(['HOT985','IND666','UANG']),巴西:new Set(['SSSGAME','TGJOGO'])};
 const legacyGroup=value=>legacyPanghu.has(token(value))?'胖虎巴西':legacyTeams[token(value)];
 function sourceIdentity(row){
  const original=row.identityCountry??row.country??row.rawCountry??'',group=legacyGroup(original)||legacyGroup(row.scopeGroup??row.scope_group)||legacyGroup(row.rawCountry);
  // A geographically labelled report may still carry a team-specific raw
  // scope. Match that scope, never another team's identically named platform.
  const identityCountry=row.identityCountry??(legacyGroup(row.country)?row.country:legacyGroup(row.rawCountry)?row.rawCountry:group||original);
  return {identityCountry,group:group||countryNames[token(original)]||original};
 }
 // A display country must never replace the source group used for access and queries.
 function normalizeIdentity(row={}){
  const {identityCountry,group}=sourceIdentity(row),legacy=group==='胖虎巴西';
  const explicit=[row.geographicCountry,row.geographic_country,row.countryName,row.country_name,row.countryCode,row.country_code,row.country!==identityCountry?row.country:null].find(value=>value&&!legacyGroup(value));
  // Current Hong Kong and Red Crab platforms operate in India (owner confirmed).
  const country=legacy?'巴西':legacyTeams[token(group)]?(explicit?countryNames[token(explicit)]||String(explicit):'印度'):countryNames[token(identityCountry)]||identityCountry||'国家待核对';
  const assigned=row.team&&!['待归类','未绑定团队','__unassigned__'].includes(row.team)?legacyTeams[token(row.team)]||row.team:null;
  const team=legacy||legacyPanghu.has(token(row.team))?'胖虎':assigned||legacyTeams[token(group)]||(confirmedM8[country]?.has(token(row.name))?'M8':'__unassigned__');
  return {...row,identityCountry,rawCountry:row.rawCountry??identityCountry,country,team};
 }
 const keyFor=row=>JSON.stringify([sourceIdentity(row).group,row.name||'']);
 const sourceKey=row=>JSON.stringify([row.dataset,row.system||'',row.rawCountry??row.country,row.rawPlatform??row.name,row.direction,row.sourceKind]);
 const values=value=>Array.isArray(value)?value.filter(x=>x!==''&&x!=='all'):value&&value!=='all'?[value]:[];
 const sameSource=(a,b)=>String(a||'').toLowerCase().replaceAll('_','')===String(b||'').toLowerCase().replaceAll('_','');
 const feedSource=feed=>['GAME66_HK','GAME66_RED_CRAB'].includes(token(feed.system))&&legacyTeams[token(feed.system)]===sourceIdentity(feed).group?'game66':feed.system;
 const feedMatchesSources=(feed,sources)=>!values(sources).length||!feed.system||['REPORT','SHEET','RECHARGE_REVIEW','WITHDRAW_REVIEW'].includes(String(feed.system).toUpperCase())||values(sources).some(value=>sameSource(value,feedSource(feed)));
 const sourceLabel=kind=>({direct:'直接写入 Supabase',google_sheets:'Google 表格 → Supabase',google_sheets_live:'Google 表格',mixed:'混合来源，待核对',unknown:'来源链路待核对'})[kind]||'来源链路待核对';
 root.HensemLiveReportData={normalizeIdentity,identityKey:keyFor,create({L,E,N,C,R,request,render}){
  const S={catalogRows:[],catalogLoaded:false,catalogBusy:false,catalogError:'',catalogSerial:0,catalogAt:0,loading:false,error:'',result:null,serial:0,scope:null,scopeKey:'',expanded:new Set(),tabs:new Map()};let catalogPending=null,loadPending=null,completed=null;
  const notify=()=>{if(typeof render==='function')render()};
  let catalogMemo=null;
  function catalog(){
   // Directory fetches replace arrays. Reuse normalized identities across the
   // many scope/filter lookups in one render, not across refreshed directories.
   const inputs=[L.catalog,L.withdrawCatalog,S.catalogRows];
   if(catalogMemo&&inputs.every((rows,index)=>rows===catalogMemo.inputs[index]&&(rows?.length||0)===catalogMemo.lengths[index]))return catalogMemo.rows;
   // Link report names only to an already-authorized native identity. Keep
   // raw feed keys for reads; ambiguous aliases and other countries stay apart.
   const aliases=new Map(),nativeSources=new Map(),aliasKey=row=>{
    const country=sourceIdentity(row).group,name=String(row.name||'').trim();
    const normalized=['IN','INDIA','印度'].includes(token(country))?token(name).replace(/^(DHANI|VEER|SHREE)[.]/,'$1'):name;
    return keyFor({...row,name:normalized});
   };
   for(const p of L.catalog||[])for(const name of [p.name,p.sourceName].filter(Boolean)){
    const alias=aliasKey({...p,name}),key=keyFor(p);if(!aliases.has(alias))aliases.set(alias,new Set());aliases.get(alias).add(key);
    if(!nativeSources.has(key))nativeSources.set(key,new Set());nativeSources.get(key).add(p.source);
   }
   const directoryKey=row=>{
    const candidates=aliases.get(aliasKey(row)),explicit=row.system&&!['REPORT','SHEET','RECHARGE_REVIEW','WITHDRAW_REVIEW'].includes(token(row.system));
    const matches=[...(candidates||[])].filter(key=>!explicit||[...nativeSources.get(key)].some(source=>sameSource(source,feedSource(row))));
    if(matches.length===1)return matches[0];
    // A different explicit backend remains separately selectable, even when
    // its display name is exactly the same as the authorized native platform.
    if(explicit&&candidates?.size&&!matches.length)return JSON.stringify(['report-source',keyFor(row),token(row.system)]);
    return keyFor(row);
   };
   const groups=new Map(),seeds=new Map();for(const seed of L.withdrawCatalog||[]){if(!seed.name||legacyPanghu.has(token(seed.name)))continue;const key=directoryKey(seed);if(!seeds.has(key))seeds.set(key,seed);if(!groups.has(key))groups.set(key,[])}for(const f of S.catalogRows){const key=directoryKey(f);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f)}
   const orderGroups=new Map();for(const p of L.catalog||[]){const key=keyFor(p);if(!orderGroups.has(key))orderGroups.set(key,[]);orderGroups.get(key).push(p)}
   const reportTeams=feeds=>[...new Set(feeds.map(f=>normalizeIdentity(f).team).filter(t=>t!=='__unassigned__'))];
   const native=(L.catalog||[]).map(p=>{const feeds=groups.get(keyFor(p))||[],teams=reportTeams(feeds),identity=normalizeIdentity(p),team=identity.team;return {...identity,team:team==='__unassigned__'?(teams.length===1?teams[0]:teams.length>1?'归属待核对':team):team,feeds,reportOnly:false,orderPlatformIds:(orderGroups.get(keyFor(p))||[]).map(x=>x.id)}});
   for(const [key,feeds]of groups){if(orderGroups.has(key))continue;const seed=seeds.get(key),first=feeds[0]||seed,teams=reportTeams(feeds.length?feeds:[seed]),currencies=[...new Set(feeds.map(f=>f.currency).filter(Boolean))],zones=[...new Set(feeds.map(f=>f.timezone).filter(Boolean))],systems=[...new Set(feeds.map(f=>f.system).filter(Boolean))];native.push({...normalizeIdentity(first),id:'report:'+encodeURIComponent(key),name:first.name,team:teams.length===1?teams[0]:teams.length>1?'归属待核对':'__unassigned__',source:systems.length===1?systems[0]:'reports',currency:currencies.length===1?currencies[0]:seed?.currency||'—',timezone:zones.length===1?zones[0]:seed?.timezone||null,feeds,reportOnly:true,orderPlatformIds:[]})}
   catalogMemo={inputs,lengths:inputs.map(rows=>rows?.length||0),rows:native};return native;
  }
  function selected(scope={}){const teams=values(scope.teams),platforms=values(scope.platforms),sources=values(scope.sources),country=normalizeIdentity({country:scope.country}).country,legacyScope=legacyPanghu.has(token(scope.country))||legacyTeams[token(scope.country)];return catalog().filter(p=>(!scope.country||scope.country==='all'||p.country===country&&(!legacyScope||keyFor({...p,name:''})===keyFor({country:scope.country,name:''})))&&(!teams.length||teams.includes(p.team))&&(!platforms.length||platforms.includes(p.id))&&(!sources.length||sources.some(s=>sameSource(s,p.source))))}
  function scopeFeeds(scope={}){
   const feeds=new Map();for(const p of selected(scope))for(const f of p.feeds||[]){if(!feedMatchesSources(f,scope.sources))continue;if(!datasets.has(f.dataset)||f.available===false||Number(f.records)===0)continue;const directions=[...new Set((Array.isArray(f.directions)?f.directions:Array.isArray(f.capabilities)?f.capabilities:f.direction?[f.direction]:f.dataset==='auto'?['withdraw']:[]).map(direction).filter(d=>['charge','withdraw'].includes(d)))];for(const d of directions){if(scope.direction&&scope.direction!=='all'&&scope.direction!==d)continue;const item={dataset:f.dataset,system:f.system||'',country:f.rawCountry??f.country,platform:f.rawPlatform??f.name,direction:d,sourceKind:f.provenance?.kind||'unknown'},key=sourceKey({...item,rawCountry:item.country,rawPlatform:item.platform});if(!feeds.has(key))feeds.set(key,{request:item,feed:f,platformIds:[]});feeds.get(key).platformIds.push(p.id)}}return [...feeds.values()];
  }
  async function loadCatalog(force=false){
   if(catalogPending)return catalogPending;if(S.catalogLoaded&&!S.catalogError&&!force&&Date.now()-S.catalogAt<60000)return catalog();if(force){completed=null;S.result=null;if(!S.loading)S.scopeKey=''}const serial=++S.catalogSerial;S.catalogBusy=true;S.catalogError='';notify();
   const task=(async()=>{try{const result=await request({action:'collectedData',operation:'catalog'});if(serial!==S.catalogSerial)return catalog();if(!Array.isArray(result?.rows))throw Error('日报目录返回不完整');S.catalogRows=result.rows;catalogMemo=null;S.catalogLoaded=true;S.catalogAt=Date.now();return catalog()}catch(e){if(serial===S.catalogSerial){S.catalogError=e.message||'日报目录读取失败';completed=null;S.result=null}return catalog()}finally{if(serial===S.catalogSerial){S.catalogBusy=false;catalogPending=null;notify()}}})();catalogPending=task;return task;
  }
  function cancel(){S.serial++;S.loading=false;S.error='';if(completed){S.result=completed.result;S.scopeKey=completed.key;S.scope=completed.scope}else{S.result=null;S.scopeKey='';S.scope=null}loadPending=null}
  async function load(scope={},force=false){
   const q={country:scope.country||L.country,teams:values(scope.teams),platforms:values(scope.platforms),sources:values(scope.sources),providers:values(scope.providers),direction:scope.direction||L.direction||'all',from:String(scope.from||L.from||'').slice(0,10),to:String(scope.to||L.to||'').slice(0,10)},key=JSON.stringify(q);
   if(!force&&S.scopeKey===key&&(S.loading||S.result&&completed&&Date.now()-completed.at<60000))return loadPending||S.result;
   const serial=++S.serial;S.scope=q;S.scopeKey=key;S.loading=true;S.error='';S.result=null;S.expanded.clear();S.tabs.clear();notify();
   const task=(async()=>{try{await loadCatalog();if(serial!==S.serial)return;if(S.catalogError)throw Error(S.catalogError);const all=scopeFeeds(q),supported=all.filter(x=>['direct','google_sheets','unknown'].includes(x.request.sourceKind));if(!supported.length){S.result={feeds:[],unsupported:all.length};completed={result:S.result,key,scope:q,at:Date.now()};return S.result}const requested=supported.map(x=>x.request),feeds=[];for(let index=0;index<requested.length;index+=250){const result=await request({action:'reportSummary',startAt:q.from,endAt:q.to,feeds:requested.slice(index,index+250)});if(serial!==S.serial)return;if(!Array.isArray(result?.feeds))throw Error('日报汇总返回不完整');const expected=requested.slice(index,index+250).map(f=>sourceKey({...f,rawCountry:f.country,rawPlatform:f.platform})),actual=result.feeds.map(sourceKey);if(actual.length!==expected.length||new Set(actual).size!==actual.length||expected.some(id=>!actual.includes(id)))throw Error('日报汇总来源返回不完整，请重试');feeds.push(...result.feeds)}if(serial!==S.serial)return;S.result={feeds,unsupported:all.length-supported.length};completed={result:S.result,key,scope:q,at:Date.now()};return S.result}catch(e){if(serial===S.serial)S.error=e.message||'日报读取失败';return null}finally{if(serial===S.serial){S.loading=false;if(S.result)S.scopeKey=key;loadPending=null;notify()}}})();loadPending=task;return task;
  }
  const providerName=(name,country)=>root.HensemProviderNames?.canonical(name,country)||name||'未提供';
  function providerAllowed(row){const wanted=S.scope?.providers||[];return !wanted.length||wanted.some(name=>providerName(name,S.scope?.country)===providerName(row.provider,S.scope?.country))}
  function metricSum(rows){const output={};for(const key of Object.keys(metricLabels)){output[key]=!rows.length||rows.some(r=>r.metrics?.[key]==null)?null:rows.reduce((sum,r)=>sum+Number(r.metrics[key]),0)}return output}
  function filteredGroup(group){if(!S.scope?.providers?.length)return group;if(group.grain!=='provider')return {...group,providerFilterUnsupported:true};const providers=(group.providers||[]).filter(providerAllowed),daily=(group.daily||[]).map(day=>{const rows=(day.providers||[]).filter(providerAllowed);return {...day,providers:rows,metrics:metricSum(rows),records:rows.reduce((sum,r)=>sum+Number(r.records||0),0)}}).filter(day=>day.records>0);return {...group,providers,daily,metrics:metricSum(providers),records:providers.reduce((sum,r)=>sum+Number(r.records||0),0),metricCoverage:undefined}}
  function providers(){return [...new Set((S.result?.feeds||[]).flatMap(feed=>(feed.groups||[]).filter(g=>g.grain==='provider').flatMap(g=>(g.providers||[]).map(p=>providerName(p.provider,feed.country)))))]}
  function platformFor(feed){const matches=catalog().filter(p=>(p.feeds||[]).some(f=>f.dataset===feed.dataset&&(f.system||'')===(feed.system||'')&&(f.rawCountry??f.country)===feed.rawCountry&&(f.rawPlatform??f.name)===feed.rawPlatform));return matches[0]||{name:feed.rawPlatform,country:feed.country||feed.rawCountry,team:'__unassigned__',orderPlatformIds:[]}}
  const metric=(row,key)=>{const v=row.metrics?.[key],known=row.metricCoverage?.[key],partial=known!=null&&Number(known)>0&&Number(known)<Number(row.records||0);if(v==null||!Number.isFinite(Number(v)))return '<span class="muted"'+(partial?' title="部分源记录未提供此项，未作完整合计"':'')+'>—</span>'+(partial?'<small class="report-partial">未完整</small>':'');return (key.endsWith('Count')||key==='count'?C(v):N(v))+(partial?'<small class="report-partial" title="部分源记录未提供此项">部分</small>':'')};
  const share=(row,total,key)=>{const v=row.metrics?.[key],den=total.metrics?.[key];return v!=null&&den!=null&&Number(den)>0?' <small class="report-share">'+R(v,den)+'</small>':''};
  function table(headers,rows,cls=''){return '<div class="report-table-wrap '+cls+'"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
  function providerTable(group){const list=group.providers||[];if(!list.length)return '<div class="report-note">源日报未提供三方明细。</div>';const metrics=Object.keys(metricLabels).filter(k=>summaryMetrics.includes(k)||list.some(r=>r.metrics?.[k]!=null));return table(['三方',...metrics.map(k=>E(metricLabels[k])+' / 占比')],list.map(row=>[E(providerName(row.provider,S.scope?.country)),...metrics.map(k=>metric(row,k)+share(row,group,k))]));}
  function dayTable(group){const days=group.daily||[];if(!days.length)return '<div class="report-note">源日报未提供每日明细。</div>';const metrics=Object.keys(metricLabels).filter(k=>summaryMetrics.includes(k)||days.some(r=>r.metrics?.[k]!=null));return table(['源日期',...metrics.map(k=>E(metricLabels[k])),'当日三方'],days.map(day=>[E(day.date),...metrics.map(k=>metric(day,k)),day.providers?.length?'<details class="report-day-providers"><summary>查看 '+C(day.providers.length)+' 个三方</summary>'+providerTable(day)+'</details>':'—']));}
  const action=(method,id)=>method+'('+E(JSON.stringify(id))+')';
  function capabilityView(selection,scope){
   const feeds=new Map();for(const p of selection)for(const f of p.feeds||[]){if(!feedMatchesSources(f,scope.sources)||!configs.has(f.dataset)||f.available===false||Number(f.records)===0)continue;const id=JSON.stringify([f.dataset,f.system,f.rawCountry??f.country,f.rawPlatform??f.name]);if(!feeds.has(id))feeds.set(id,{id,f,p})}
   const configRows=[...feeds.values()];if(!configRows.length){const unsupported=selection.filter(p=>p.reportOnly&&p.feeds?.length&&!p.feeds.some(f=>datasets.has(f.dataset)||configs.has(f.dataset)));return unsupported.length?'<section class="live-report-data"><div class="report-note">'+unsupported.map(p=>E(p.name)).join('、')+' 已收到其他来源记录，尚无可用于当前页面的日报汇总。<button class="report-link" onclick="setPage(\'collected_data\')">查看平台数据接入</button></div></section>':'';}
   return '<section class="live-report-data report-config-capabilities"><header><div><h2>自动出款配置接入</h2><p>配置与代收、代付数据独立核对。</p></div></header>'+table(['平台','来源','已收到数据','源日期','查看'],configRows.map(({id,f,p})=>[E(p.name),E(f.system||'')+' · '+E(sourceLabel(f.provenance?.kind)),'自动出款配置',E(f.lastDate||'未提供'),typeof root.HensemLivePayoutConfig?.openTarget==='function'?'<button class="report-link" onclick="'+action('liveReportConfig',id)+'">查看配置</button>':'<span class="muted">已收到配置</span>']))+'</section>';
  }
  function renderReport({page='overview'}={}){
   if(!pages.has(page)&&!detailPages.has(page))return '';const scope=S.scope||{country:L.country,teams:values(L.multi?.team?.length?L.multi.team:L.team),platforms:values(L.multi?.platform?.length?L.multi.platform:L.platform),sources:values(L.multi?.source?.length?L.multi.source:L.source),direction:L.direction},pageDirection=['providers','collection'].includes(page)?'charge':['provider_payout','payout'].includes(page)?'withdraw':L.direction||'all',feedScope=scopeFeeds({...scope,direction:pageDirection}),selection=selected(scope),onlyReports=selection.some(p=>p.reportOnly&&p.feeds?.some(f=>datasets.has(f.dataset)));
   if(detailPages.has(page))return onlyReports?'<section class="live-report-data"><div class="report-note">所选平台包含源日报数据；日报未提供逐笔订单、小时、金额档或到账时效，不能生成这些订单分析。请在总览、代收汇总或代付汇总查看源日报。</div></section>':'';
   const capability=capabilityView(selection,scope);if(!S.catalogBusy&&!S.loading&&!S.error&&!S.catalogError&&!feedScope.length&&!S.result?.feeds?.length)return capability;
   const prefix=capability+'<section class="live-report-data"><header><div><h2>源日报数据</h2><p>日报按所选起止日期整日展示，不按小时截取；与订单统计分别列示，不重复累加。不同来源和统计粒度也分别核对。</p></div><span>'+E(scope.from||'')+' 至 '+E(scope.to||'')+'</span></header>';
   if(S.catalogBusy||S.loading)return prefix+'<div class="report-status">正在读取源日报…</div></section>';
   if(S.error||S.catalogError)return prefix+'<div class="report-status report-error">日报读取未完成，不能据此判断没有数据。'+E(S.error||S.catalogError)+'</div></section>';
   if(!S.result)return prefix+'<div class="report-status">点击查询读取所选范围的源日报。</div></section>';
   const currencies=new Map();for(const feed of S.result.feeds){if(pageDirection!=='all'&&feed.direction!==pageDirection)continue;const currency=feed.currency||'原报表金额（币种未提供）';if(!currencies.has(currency))currencies.set(currency,[]);currencies.get(currency).push(feed)}
   let body='';for(const [currency,feeds]of currencies){const rows=[];for(const feed of feeds){const platform=platformFor(feed),base=[E(platform.name||feed.rawPlatform),'<strong>'+E(labels[feed.dataset]||feed.dataset)+'</strong><small>'+E(feed.system||'')+' · '+E(sourceLabel(feed.sourceKind))+'</small>',feed.direction==='withdraw'?'代付':'代收'];if(feed.status!=='received'||!feed.groups?.length){rows.push([...base,'源日报',...summaryMetrics.map(()=>'<span class="muted">—</span>'),'<span class="muted">所选日期未收到日报</span>','—']);continue}for(const original of feed.groups){const group=filteredGroup(original),id=JSON.stringify([sourceKey(feed),group.grain]),expanded=S.expanded.has(id),tab=S.tabs.get(id)||'providers',grain={platform:'平台汇总',provider:'三方明细汇总',channel:'通道汇总'}[group.grain]||group.grain;if(group.providerFilterUnsupported){rows.push([...base,E(grain),...summaryMetrics.map(()=>'<span class="muted">—</span>'),'<span class="muted">此来源粒度无法按三方筛选</span>','—']);continue}const identity=E(platform.name||feed.rawPlatform)+(platform.orderPlatformIds?.length?'<small class="report-order-reference">另有订单数据，独立核对</small>':'');rows.push([identity,...base.slice(1),E(grain),...summaryMetrics.map(k=>metric(group,k)),E(feed.updatedAt||'未提供'),'<button class="report-link" aria-expanded="'+expanded+'" onclick="'+action('liveReportToggle',id)+'">'+(expanded?'收起':'展开')+'</button>']);if(expanded){const tabButton=(key,label)=>'<button class="'+(tab===key?'on':'')+'" onclick="liveReportTab('+E(JSON.stringify(id))+','+E(JSON.stringify(key))+')">'+label+'</button>';rows.push(['<div class="report-detail" data-report-detail><div class="report-detail-head"><strong>'+E(platform.name)+' · '+E(grain)+'</strong><div class="report-tabs">'+tabButton('providers','各三方占比')+tabButton('daily','每日对比')+'</div></div>'+(tab==='daily'?dayTable(group):providerTable(group))+'</div>'])}}}
    const rendered=table(['平台','数据来源','业务','来源口径',...summaryMetrics.map(k=>metricLabels[k]),'最近同步','详情'],rows).replaceAll('<tr><td><div class="report-detail"','<tr class="report-expanded"><td colspan="10"><div class="report-detail"');body+='<div class="report-currency"><h3>'+E(currency)+'</h3>'+rendered+'</div>'}
   if(!body)body='<div class="report-status">所选范围没有可读取的日报来源。</div>';if(S.result.unsupported)body+='<div class="report-note">另有 '+C(S.result.unsupported)+' 个来源链路尚未明确，暂不并入日报统计；可到平台数据接入核对原始来源。</div>';return prefix+body+'</section>';
  }
  root.liveReportConfig=id=>{const [dataset,system,country,platform]=JSON.parse(id),match=S.catalogRows.find(f=>f.dataset===dataset&&f.system===system&&(f.rawCountry??f.country)===country&&(f.rawPlatform??f.name)===platform&&f.available!==false&&Number(f.records)!==0);if(!match||!configs.has(dataset)||typeof root.HensemLivePayoutConfig?.openTarget!=='function')return;root.HensemLivePayoutConfig.openTarget({system,country,platform});root.setPage?.('payout_config')};
  root.liveReportToggle=id=>{if(S.expanded.has(id))S.expanded.delete(id);else S.expanded.add(id);notify()};root.liveReportTab=(id,tab)=>{if(!['providers','daily'].includes(tab))return;S.tabs.set(id,tab);notify()};
  return {loadCatalog,catalog,selected,load,cancel,providers,render:renderReport,state:S};
 }};
})(typeof window!=='undefined'?window:globalThis);
