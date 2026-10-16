(function(root){
 'use strict';
 const addDay=(day,n)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 const isPanghuCountry=country=>['胖虎巴西','BR_PANGHU','PANGHU BRAZIL'].includes(String(country??'').trim().toUpperCase());
 const duration=value=>{if(value==null||!Number.isFinite(Number(value)))return '—';const n=Math.max(0,Math.round(Number(value)));return (n>=3600?Math.floor(n/3600)+'时':'')+(n>=60?Math.floor(n%3600/60)+'分':'')+(n%60)+'秒'};
 function decodeNote(value){
  let text=String(value??'');const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',lpar:'(',rpar:')',lbrack:'[',rbrack:']'};
  for(let pass=0;pass<3;pass++){const before=text;text=text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp|lpar|rpar|lbrack|rbrack);/gi,(entity,key)=>{const name=key.toLowerCase();if(named[name]!=null)return named[name];const code=name.startsWith('#x')?parseInt(name.slice(2),16):parseInt(name.slice(1),10);return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):entity});if(text===before)break}
  return text;
 }
 function cleanNote(value){
  const lines=decodeNote(value).replace(/<br\s*\/?>/gi,'\n').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const comparable=line=>line.replace(/[\[\]()【】（）]/g,'');
  return lines.filter((line,i)=>!lines.slice(i+1).some(later=>later===line||(/[.]{3}$|…+$/.test(line)&&comparable(line).replace(/([.]{3}|…+)$/,'').length>0&&comparable(later).startsWith(comparable(line).replace(/([.]{3}|…+)$/,''))))).join('\n');
 }
 root.HensemLiveWithdrawPages={create(ctx){
  const {L,E,C,R,N,box,table,request,render}=ctx;
  const S={localSnapshot:false,serverPaging:false,applied:null,data:null,dataKey:'',loadingKey:'',error:'',loading:false,dirty:false,serial:0,view:'auto',platforms:[],rowCountry:'',account:'',sort:'total',asc:false,daily:false,historical:false,page:1,size:20,open:false,search:'',reason:null,reasonData:null,reasonError:'',reasonBusy:false,reasonSerial:0,reasonPage:1,reasonSize:20,reasonLabel:'',reasonQuery:'',reasonTrigger:null,originalNote:'',originalNoteTitle:'驳回原文',note:null,noteDraft:'',noteError:'',noteSaving:false,noteSample:false};
  const initialState={...S,platforms:[]};
  let readController=null,pendingRead=null;
  const setLoading=value=>{S.loading=value;ctx.onLoading?.(value)};
  function stopRead(){readController?.abort();readController=null;pendingRead=null;}
  const jsArgument=value=>JSON.stringify(String(value??'')).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sourceNote=(value,empty='（源备注为空）',title='驳回原文',label='',exact=false)=>{const sanitized=S.reasonData?.reasonTextSanitized===true&&S.reasonData?.reasonTextFormat==='sanitized_label_v1';if(sanitized&&title!=='备注来源状态')title='采集说明（已脱敏）';const raw=String(value??''),full=exact?(raw.trim()?raw:empty):cleanNote(value)||empty,preview=label||(full.length>96?full.slice(0,96)+'…':full);return '<button type="button" class="withdraw-source-note" title="'+(title==='备注来源状态'?'点击查看备注来源状态':sanitized?'点击查看采集说明（已脱敏）':'点击查看完整原文')+'" onclick="withdrawReasonOriginal('+jsArgument(full)+','+jsArgument(title)+(exact?',true':'')+')">'+E(preview)+'</button>'};
  const rejectionSourceNote=(value,row={})=>{if(row.rejectionNoteState==='withheld'){const labels={remark:'主备注',front:'前台备注',back:'后台备注'},sources=(row.hiddenNoteSources||[]).map(key=>labels[key]).filter(Boolean);return sourceNote(null,'（'+(sources.length?sources.join('、'):'源业务备注')+'已隐藏，驳回备注待核对）','备注来源状态','',true)}if(row.rejectionNoteState==='missing')return sourceNote(null,'（未采集到明确驳回备注）','备注来源状态','',true);if(row.rejectionNoteState==='empty')return sourceNote(null,'（源备注为空）','备注来源状态','',true);return sourceNote(value,'（源备注为空）','驳回原文','',true)};
  const sourceNoteStates=row=>{if(!row.sourceNoteStates)return '';const labels={remark:'主备注',front:'前台备注',back:'后台备注'},hidden=new Set(row.hiddenNoteSources||[]);return '<small class="cell-sub">'+Object.entries(labels).map(([key,label])=>{const state=row.sourceNoteStates[key],text=key==='front'&&row.verifiedRejectionNote?.sourceField==='frontRemark'&&row.verifiedRejectionNote?.verificationMethod==='manual_source_ui'?'已在源站核实':state==='empty'?'为空':hidden.has(key)?state==='redacted'?'部分已隐藏':'已隐藏':state==='template'?'已采集业务模板':'未取得可用文本';return E(label+'：'+text)}).join(' · ')+'</small>'};
  const reasonCache=new Map();
  let reasonSnapshot=null;
  const view=()=>ctx.page()==='withdraw_operators'?'operators':'auto';
  const sumKey=()=>view()==='operators'?'processed':'total';
  const dates=()=>({startAt:L.from.slice(0,10)+'T00:00:00.000Z',endAt:L.to.slice(0,10)+'T23:59:59.000Z'});
  const resultDates=()=>({from:(S.applied?.query.startAt||S.data?.startDate||L.from).slice(0,10),to:(S.applied?.query.endAt||S.data?.endDate||L.to).slice(0,10)});
  const resultDaily=()=>S.applied?.query.daily??S.daily;
  const accessKey=()=>{const a=root.hensemRoleAccess||{},s=root.hensemDataScope||{},entries=[...(L.catalog||[]),...(L.withdrawCatalog||[])].map(p=>JSON.stringify([p.id||'',p.source||p.system||'',p.identityCountry??p.country,p.sourceName||p.source_name||p.name,p.team||'',p.scopeGroup||p.scope_group||''])).sort();return JSON.stringify([s.mode||'document',s.identity||'document',a.mode||'document',a.roleId||'',a.version??null,a.assignmentVersion??null,a.canView??null,Array.isArray(a.permissions)?a.permissions.slice().sort():[],entries]);};
  function clearResult(){reasonSnapshot=null;reasonCache.clear();S.serial++;stopRead();S.reasonSerial++;setLoading(false);Object.assign(S,{applied:null,data:null,dataKey:'',loadingKey:'',localSnapshot:false,serverPaging:false,reason:null,reasonData:null,reasonBusy:false,reasonError:'',reasonLabel:'',reasonQuery:'',originalNote:'',note:null,noteDraft:'',noteError:'',noteSaving:false,noteSample:false,error:'',dirty:true});}
  function resultAllowed(){if(root.hensemRoleAccess?.canView===false||S.applied&&(S.applied.accessKey!==accessKey()||S.applied.query.view!==view())){clearResult();return false;}return true;}
  const filterKey=(scope,q)=>JSON.stringify([scope,q.country,q.startAt,q.endAt,q.platforms,q.scopeTargets||null,q.view,q.daily,q.account||'']);
  function draftChanged(){if(!S.applied||!S.data)return S.dirty;try{return filterKey(selectionKey(),query())!==filterKey(S.applied.scopeKey,S.applied.query);}catch{return true;}}
  const identity=p=>{const row=root.HensemLiveReportData?.normalizeIdentity(p)||{...p,identityCountry:p.identityCountry??p.country,country:isPanghuCountry(p.country)?'巴西':['香港','红膏蟹'].includes(p.country)?'国家待核对':p.country,team:isPanghuCountry(p.country)?'胖虎':p.team||(['香港','红膏蟹'].includes(p.country)?p.country:'__unassigned__')};return row.team==='__unassigned__'&&!p.team?{...row,team:'__team_pending__'}:row};
  const rawTarget=p=>{const raw=p.identityCountry??p.country,group=p.scopeGroup??p.scope_group;if(isPanghuCountry(raw)||isPanghuCountry(group))return '胖虎巴西';const special={HK_TEAM:'香港',HONG_KONG:'香港',GAME66_HK:'香港','香港':'香港',RED_CRAB:'红膏蟹',GAME66_RED_CRAB:'红膏蟹','紅膏蟹':'红膏蟹','红膏蟹':'红膏蟹',LG:'LG'};return special[String(raw??'').toUpperCase()]||special[String(group??'').toUpperCase()]||identity({country:raw}).country;};
  // WG directory names are display aliases; its readers require the raw site key.
  const isWg=p=>String(p.source||p.system||'').toLowerCase()==='wg';
  const requestPlatform=p=>isWg(p)?p.sourceName||p.source_name||p.name:p.name;
  const wgPlatform=row=>{const matches=(L.catalog||[]).map(identity).filter(p=>isWg(p)&&rawTarget(p)===rawTarget(row)&&[p.name,requestPlatform(p)].includes(row.platform));return matches.length===1?matches[0]:null;};
  const rowPlatform=row=>{const p=wgPlatform(row);return p?requestPlatform(p):row.platform;};
  const platformLabel=row=>wgPlatform(row)?.name||row.platform;
  const activeTeams=()=>Array.isArray(L.multi?.team)&&L.multi.team.length?L.multi.team:L.team&&L.team!=='all'?[L.team]:[];
  const displayCountry=()=>identity({country:L.country}).country;
  const selectionKey=()=>JSON.stringify([displayCountry(),activeTeams().slice().sort(),S.historical]);
  const baseScopeCatalog=()=>catalog().filter(p=>p.country===displayCountry()&&(!activeTeams().length||activeTeams().includes(p.team))&&(!isPanghuCountry(L.country)||rawTarget(p)==='胖虎巴西'));
  const historicalRow=p=>!!p.historicalSource&&rawTarget(p)==='LG'&&String(p.name).toUpperCase()==='SUPERLG';
  const scopeCatalog=()=>baseScopeCatalog().filter(p=>S.historical?historicalRow(p):!historicalRow(p));
  function query(){
   const list=scopeCatalog().filter(p=>!S.rowCountry||rawTarget(p)===S.rowCountry),countries=[...new Set(list.map(rawTarget).filter(Boolean))];
   if(!countries.length)throw Error('当前团队和国家没有可读取的出款平台，请核对筛选条件。');
   const allowed=new Set(list.map(p=>p.name));if(S.platforms.some(name=>!allowed.has(name)))throw Error('已选平台不属于当前团队和国家，请重新选择平台。');
   const chosen=S.platforms.length?list.filter(p=>S.platforms.includes(p.name)):list;
   const platforms=S.platforms.length||S.historical||activeTeams().length?[...new Set(chosen.map(requestPlatform))]:[];
   if(platforms.length>200)throw Error('当前团队平台较多，请选择不超过 200 个平台。');
   const snapshotQuery=view()==='auto'&&!S.daily&&(!S.serverPaging||S.dirty);
   const base={action:'autoWithdraw',...dates(),country:countries.length===1?countries[0]:displayCountry(),platforms,view:view(),sort:S.sort,ascending:S.asc,daily:S.daily,...(view()==='operators'&&S.account?{account:S.account}:{}),offset:snapshotQuery?0:(S.page-1)*S.size,limit:snapshotQuery?500:S.size};
   if(snapshotQuery){base.sort='total';base.ascending=false;}
   if(countries.length>1){
    base.scopeTargets=countries.map(country=>({country,platforms:[...new Set(chosen.filter(p=>rawTarget(p)===country).map(requestPlatform))]})).filter(t=>t.platforms.length);
    if(base.scopeTargets.some(t=>t.platforms.length>200))throw Error('当前团队平台较多，请选择不超过 200 个平台。');
   }
   return base;
  }
  function invalidate(){reasonSnapshot=null;S.serial++;stopRead();setLoading(false);S.loadingKey='';S.error='';S.dirty=true;S.reasonSerial++;S.reason=null;S.reasonData=null;S.originalNote='';S.note=null;}
  async function load(reset=false,override=null){
   resultAllowed();
   if(!L.catalogReady)return;if(reset){S.page=1;reasonCache.clear();reasonSnapshot=null}
   if(root.hensemRoleAccess?.canView===false)return;
   const scope=override?.applied.scopeKey||selectionKey();if(!override)S.scopeKey=scope;
   const target=view();if(S.view!==target){clearResult();S.view=target;S.page=1;S.sort=target==='operators'?'processed':'total';S.asc=false;S.daily=false;S.reason=null}
   let targetQuery,key;try{targetQuery=override?.query||query();key=JSON.stringify([scope,targetQuery])}catch(e){S.serial++;stopRead();setLoading(false);S.loadingKey='';S.error=e.message||'读取失败';S.dirty=true;render();return}
   const applied=override?{...override.applied,query:targetQuery,accessKey:accessKey()}:{query:targetQuery,scopeKey:scope,country:displayCountry(),teams:activeTeams().slice(),catalog:scopeCatalog().map(p=>({...p})),platforms:S.platforms.slice(),rowCountry:S.rowCountry,historical:S.historical,accessKey:accessKey()};
   if(S.loading&&S.loadingKey===key)return pendingRead;
   const serial=++S.serial;stopRead();const controller=typeof root.AbortController==='function'?new root.AbortController():null;readController=controller;S.loadingKey=key;setLoading(true);S.error='';render();
   const run=(async()=>{
    try{const data=await request(targetQuery,controller?{signal:controller.signal}:undefined);if(serial!==S.serial)return;if(applied.accessKey!==accessKey()||root.hensemRoleAccess?.canView===false){clearResult();render();return;}S.applied=applied;S.data={...data,country:applied.country,rawCountry:targetQuery.country,scopeTargets:targetQuery.scopeTargets||null,scopeKey:scope};S.dataKey=key;S.dirty=false;S.localSnapshot=target==='auto'&&!targetQuery.daily&&targetQuery.offset===0&&targetQuery.limit===500&&Array.isArray(data.rows)&&data.total!==null&&data.total!==undefined&&data.total!==''&&typeof data.total!=='boolean'&&Number.isSafeInteger(Number(data.total))&&Number(data.total)>=0&&Number(data.total)<=500&&data.rows.length===Number(data.total);S.serverPaging=target==='auto'&&!targetQuery.daily&&!S.localSnapshot;if(S.serverPaging){if(targetQuery.limit===500){S.sort=targetQuery.sort;S.asc=targetQuery.ascending;S.page=1;}if(Array.isArray(S.data.rows)&&S.data.rows.length>S.size)S.data.rows=S.data.rows.slice(0,S.size);}S.page=Math.min(S.page,Math.max(1,Math.ceil(Number(data.total||0)/S.size)));setLoading(false);S.loadingKey='';render()}
    catch(e){if(serial!==S.serial)return;setLoading(false);S.loadingKey='';S.error=e.message||'读取失败';render()}
    finally{if(serial===S.serial){readController=null;pendingRead=null;}}
   })();pendingRead=run;return run;
  }
  const singleDay=()=>resultDates().from===resultDates().to;
  const platformKey=name=>String(name||'').toUpperCase().replace(/^(DHANI|VEER|SHREE|MAAN)[.]/,'$1');
  const noteMatches=(note,row)=>(note.sourceCountry||(!S.data?.scopeTargets?S.data?.rawCountry:rawTarget(note)))===rawTarget(row)&&platformKey(note.platform)===platformKey(row.platform);
  const countryLabel=row=>{const country=identity({country:row.country,name:row.platform}).country;if(!S.data?.scopeTargets)return country;const teams=[...new Set(catalog().filter(p=>rawTarget(p)===rawTarget(row)&&platformKey(p.name)===platformKey(platformLabel(row))).map(p=>p.team).filter(t=>!['__unassigned__','__team_pending__','__team_conflict__'].includes(t)))];return country+(teams.length===1?' · '+teams[0]:'');};
  const identityCell=row=>'<span class="withdraw-platform-identity"><strong title="'+E(platformLabel(row))+'">'+E(platformLabel(row))+'</strong>'+(row.country?'<span>'+E(countryLabel(row))+'</span>':'')+'</span>';
  function coveragePanel(value){
   if(!value||value.basis!=='registered_game66_selected_scope'||!Array.isArray(value.platforms)||!value.platforms.length)return '';
   const rows=value.platforms,names=new Set(),valid=rows.every(r=>r&&r.source==='game66'&&typeof r.country==='string'&&typeof r.platform==='string'&&['recorded','no_selected_period_record'].includes(r.state)&&Number.isSafeInteger(r.coveredDays)&&r.coveredDays>=0&&Number.isSafeInteger(r.expectedDays)&&r.expectedDays>0&&r.coveredDays<=r.expectedDays&&(r.state==='recorded')===(r.coveredDays>0)&&!names.has(JSON.stringify([r.country,r.platform]))&&names.add(JSON.stringify([r.country,r.platform])));
   const missing=rows.filter(r=>r?.state==='no_selected_period_record');
   if(!valid||value.expectedCount!==rows.length||value.missingCount!==missing.length||value.recordedCount!==rows.length-missing.length)return '<div class="live-status live-error">平台覆盖响应不完整，请重新查询；未提供的统计保持未知。</div>';
   const note='<div class="live-panel-note" data-withdraw-coverage="registered">目录 '+C(value.expectedCount)+' · 有记录 '+C(value.recordedCount)+' · 未收到数据 '+C(value.missingCount)+'</div>';
   return note+(missing.length?box('未收到当期数据',table(['盘口 / 平台 · 国家','笔数 / 金额','状态'],missing.map(r=>[identityCell(r),'— / —','等待采集上传']),'withdraw-coverage-table'),'未收到数据不代表 0，未计入合计。'):'' );
  }
  const noteFor=(row,date)=>(S.data?.notes||[]).find(n=>noteMatches(n,row)&&n.date===date);
  const delta=(value,unit,betterUp=true)=>'<span class="withdraw-delta '+(value===0?'flat':(value>0)===betterUp?'good':'bad')+'">'+(value>0?'+':'')+value.toFixed(2)+unit+'</span>';
  const known=value=>value!==null&&value!==undefined&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value));
  const countKnown=(row,key)=>known(row?.[key])&&(!['autoCount','manualCount'].includes(key)||Number(row[key])>=0&&(row.classificationAvailable!==false||row.classificationPartial===true));
  const shareKnown=(row,key,denominator)=>countKnown(row,key)&&[row[key],row[denominator]].every(value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value)))&&Number(row[key])>=0&&Number(row[denominator])>0&&Number(row[key])<=Number(row[denominator]);
  const countCell=(row,key)=>countKnown(row,key)?C(row[key]):'—';
  const processingBases={created_to_operated:'创建至操作处理',created_to_completed:'创建至源订单完成',applied_to_completed:'申请至完成',created_to_submitted:'创建至提交三方',source_submitted_to_handled:'源提交至处理完成',source_reported_processing:'源日报处理用时',source_reported_audit_duration:'源订单审核用时'};
  const processingValueKnown=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0;
  function durationCell(row){
   if(!row)return '—';if(!processingValueKnown(row.avgSeconds))return row.durationBasis==='created_to_submitted'?'<span title="缺少有效创建或提交三方时间，暂不能计算">—</span>':row.source==='NEWAR'?'<span title="缺少有效处理完成时间，暂不能计算">—</span>':'—';
   const samples=processingValueKnown(row.durationSampleCount)?Number(row.durationSampleCount):null,reported=row.durationSource==='historical_source_report'&&row.durationBasis==='source_reported_processing',total=reported?NaN:Number(row.total??row.processed);
   const basis=row.durationBasis==='created_to_operated'?'创建至操作处理的用时，不是支付到账时长。':row.durationBasis==='created_to_completed'?'创建至源订单完成的处理用时，不代表银行到账时长。':row.durationBasis==='applied_to_completed'?'申请至完成的用时。':row.durationBasis==='created_to_submitted'?'创建至提交三方的用时，不代表支付到账。':row.durationBasis==='source_submitted_to_handled'?'源提交至处理完成的用时，不代表银行到账时长。':row.durationBasis==='source_reported_audit_duration'?'源订单提供的审核用时，不代表支付到账时长。':row.durationBasis==='source_reported_processing'?'原日报提供的处理用时。':row.durationBasis==='mixed_source_processing'?'按各来源处理用时及有效样本数加权。':'按来源提供的处理用时统计。';
   const partial=samples!==null&&Number.isFinite(total)&&samples<total;
   return '<span title="'+E(basis+(samples!==null?(reported?'日报':'')+'有效时间样本 '+C(samples)+' 笔'+(Number.isFinite(total)?' / '+C(total)+' 笔':'')+'。':'')+(reported?'不与订单笔数换算覆盖率。':''))+'">'+duration(row.avgSeconds)+(partial?'<sup aria-label="部分时间样本">*</sup>':'')+'</span>'+(reported?'<small class="cell-sub">源日报用时</small>':'');
  }
  function absoluteComparison(current,previous,key,unit=' 笔',format=C,betterUp=true){
   if(key==='avgSeconds'){
    const valid=row=>row&&processingValueKnown(row.avgSeconds);
    if(!valid(current)||!valid(previous))return '—';
    if(!processingBases[current.durationBasis]||!processingBases[previous.durationBasis]||current.durationBasis!==previous.durationBasis)return '<span title="两期处理用时口径不同或未提供，保留原值，不计算涨跌">口径不同</span>';
   }else if(current.comparisonComparable===false)return '<span title="两期统计口径或覆盖未对齐，保留原值，不计算涨跌">—</span>';
   if(!previous||!known(current[key])||!known(previous[key]))return '—';
   const a=Number(current[key]),b=Number(previous[key]),diff=a-b,percent=b===0?(a===0?'持平':'无基数'):(diff>0?'+':'')+(diff/Math.abs(b)*100).toFixed(2)+'%',tone=diff===0?'flat':(diff>0)===betterUp?'good':'bad';
   const observed=key==='avgSeconds'&&(current.comparisonComparable===false||previous.comparisonComparable===false);
   return '<span class="withdraw-delta '+tone+'" title="'+(observed?'已观察用时差；仅比较同口径有效时间样本，两期完整性尚未核验。':'')+'前一日 '+E(format(b)+unit)+'">'+(diff>0?'+':diff<0?'−':'')+E(format(Math.abs(diff))+unit)+'（'+percent+'）'+(observed?'<sup aria-label="已观察用时差，完整性未核验">*</sup>':'')+'</span>';
  }
  function observedCount(value){
   if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?BigInt(value):null;
   if(typeof value==='string'&&/^[0-9]+$/.test(value.trim()))return BigInt(value.trim());
   return null;
  }
  function matchedSummary(data){
   if(!localReady()||!singleDay()||resultDaily()||view()!=='auto')return null;
   const current=data.startDate,previous=data.previousStartDate;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(current||'')||current!==resultDates().from||data.endDate!==current||data.previousEndDate!==previous)return null;
   const parsed=new Date(current+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==current||previous!==addDay(current,-1))return null;
   const keys=new Set(),pairs=[];
   for(const row of data.rows){
    if(!row||typeof row.country!=='string'||!row.country.trim()||typeof row.platform!=='string'||!row.platform.trim())return null;
    const key=JSON.stringify([row.country,row.platform]);if(keys.has(key))return null;keys.add(key);
    const prior=row.previous;if(!prior||typeof prior!=='object'||Array.isArray(prior))continue;
    if(prior.country!==undefined&&prior.country!==row.country||prior.platform!==undefined&&prior.platform!==row.platform)continue;
    if(observedCount(row.total)!==null&&observedCount(prior.total)!==null)pairs.push({current:row,previous:prior});
   }
   return pairs.length?{pairs,platforms:pairs.length}:null;
  }
  function summaryCountComparison(matched,key){
   if(!matched||!['total','autoCount','manualCount','success','rejected'].includes(key))return null;
   let current=0n,previous=0n;
   for(const pair of matched.pairs){
    for(const side of ['current','previous']){
     const row=pair[side],value=observedCount(row[key]),total=observedCount(row.total);
     if(!countKnown(row,key)||value===null||total===null||value>total)return '<small class="cell-sub" title="同 '+matched.platforms+' 平台有未提供的对比值；缺值不按零计算。">昨日对比值未齐</small>';
     if(['autoCount','manualCount'].includes(key)){const auto=observedCount(row.autoCount),manual=observedCount(row.manualCount);if(auto!==null&&manual!==null&&auto+manual>total)return '<small class="cell-sub">昨日分类值待核对</small>';}
     if(side==='current')current+=value;else previous+=value;
    }
   }
   const basis='同 '+matched.platforms+' 平台已入库数据；当期 '+C(current.toString())+' 笔，昨日 '+C(previous.toString())+' 笔。两期完整性尚未核验。';
   if(key==='manualCount'&&matched.pairs.some(pair=>manualClassificationBasisChanged(pair.current)))return '<small class="cell-sub" title="'+E(basis+'人工分类口径不同，保留原值，不计算涨跌。')+'">昨日 '+C(previous.toString())+' · 分类口径不同</small>';
   const diff=current-previous,absolute=diff<0n?-diff:diff,rounded=previous===0n?0n:(absolute*10000n+previous/2n)/previous;
   const percent=previous===0n?(current===0n?'持平':'无基数'):(diff>0n?'+':diff<0n?'-':'')+(rounded/100n).toString()+'.'+(rounded%100n).toString().padStart(2,'0')+'%';
   const tone=diff===0n?'flat':(diff>0n)===!['manualCount','rejected'].includes(key)?'good':'bad';
   return '<small class="cell-sub withdraw-observed-comparison" data-comparison-baseline="matched-platforms" title="'+E(basis)+'">较昨日 <span class="withdraw-delta '+tone+'">'+percent+'</span><span class="withdraw-comparison-scope"> · 同 '+matched.platforms+' 平台</span></small>';
  }
  function summaryComparisonIssue(data){
   if(data.comparison?.complete!==false)return '';
   const currentPlatforms=data.totals?.platforms,previousPlatforms=data.previousTotals?.platforms;
   if(Number.isSafeInteger(currentPlatforms)&&Number.isSafeInteger(previousPlatforms)&&currentPlatforms>=0&&previousPlatforms>=0&&currentPlatforms!==previousPlatforms)return '两期平台范围不一致（当期'+C(currentPlatforms)+'/前期'+C(previousPlatforms)+'），汇总暂不比较';
   if(data.arCoverage?.coverageBasis==='unverified_source_continuity'&&(data.arCoverage.currentComplete===false||data.arCoverage.previousComplete===false))return 'AR 两期完整性尚未核验，汇总暂不比较';
   const coverage=[data.wgCoverage,data.yashCoverage,data.newarCoverage,data.arCoverage,data.duoliCoverage].filter(Boolean),current=coverage.some(value=>value.currentComplete===false),previous=coverage.some(value=>value.previousComplete===false);
   return current&&previous?'两期覆盖不完整，汇总暂不比较':current?'当期覆盖不完整，汇总暂不比较':previous?'前期覆盖不完整，汇总暂不比较':'两期范围或覆盖未对齐，汇总暂不比较';
  }
  function manualClassificationBasisChanged(row){
   // The Oct10 rule changes unknown rejected orders to manual; system auto is unchanged.
   if(row.source!=='AR'||row.statisticBasis!=='applied_at_current_status')return false;
   const day=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?value:null;};
   const current=day(resultDaily()?row.dataDate:S.data?.startDate);
   if(!current)return false;
   const previous=resultDaily()?addDay(current,-1):day(S.data?.previousStartDate);
   if(!resultDaily()&&(day(S.data?.endDate)!==current||day(S.data?.previousEndDate)!==previous||previous!==addDay(current,-1)))return false;
   return current>='2026-10-10'&&previous<'2026-10-10';
  }
  function comparison(current,previous,numerator,denominator,issue=''){
   if(!singleDay()&&!resultDaily())return '';
   if(issue){
    // Incomplete comparison coverage forbids a growth claim, not displaying
    // the previous period's actual stored value. Never fill missing values as 0.
    const valid=previous&&processingValueKnown(previous[numerator])&&(numerator==='avgSeconds'||countKnown(previous,numerator));
    const value=valid?(numerator==='avgSeconds'?duration(previous.avgSeconds):denominator?(shareKnown(previous,numerator,denominator)?R(previous[numerator],previous[denominator]):'—'):C(previous[numerator])):'—';
    return '<small class="cell-sub" data-comparison-baseline="observed" title="仅展示前一日已入库值；两期范围或完整性未核验，不计算汇总涨跌。">昨日已入库 '+value+(valid&&!denominator&&numerator!=='avgSeconds'?(numerator==='operators'?' 人':' 笔'):'')+' · 暂不计算涨跌</small>';
   }
   if(current.comparisonComparable===false&&!(denominator&&previous)){
    const prior=previous&&countKnown(previous,numerator)&&(denominator?known(previous[denominator])&&Number(previous[denominator])>0:true)?denominator?R(previous[numerator],previous[denominator]):C(previous[numerator]):'—';
    return '<small class="cell-sub" title="两期统计口径或覆盖未对齐；昨日原值保留，不计算涨跌">昨日 '+prior+'</small>';
   }
   if(!previous)return '<small class="cell-sub">对比日期暂无数据</small>';
   const partialClassification=['autoCount','manualCount'].includes(numerator)&&(current.classificationPartial===true||previous.classificationPartial===true)&&!(current.classificationComparable===true&&previous.classificationComparable===true);
   if(partialClassification&&!denominator)return '<small class="cell-sub">分类未完整，暂不比较</small>';
   if(!countKnown(current,numerator)||!countKnown(previous,numerator))return '<small class="cell-sub">对比值未提供</small>';
   if(denominator){
    if(!shareKnown(current,numerator,denominator)||!shareKnown(previous,numerator,denominator))return '<small class="cell-sub">对比样本不足</small>';
    if(numerator==='manualCount'&&manualClassificationBasisChanged(current))return '<small class="cell-sub" title="当期将无明确操作人的驳回计入人工，昨日沿用旧日报分类；保留原值，不计算百分点差。">昨日 '+R(previous[numerator],previous[denominator])+' · 分类口径不同</small>';
    const before=Number(previous[denominator]),now=Number(current[denominator]),change=100*(Number(current[numerator])/now-Number(previous[numerator])/before);
    const unverified=current.comparisonComparable===false||previous.comparisonComparable===false||partialClassification;
    return '<small class="cell-sub"'+(unverified?' title="按已入库数据计算；两期完整性尚未核验"':'')+'>昨日 '+R(previous[numerator],previous[denominator])+' '+delta(change,' pp',!['rejected','manualCount'].includes(numerator))+'</small>';
   }
   return '<small class="cell-sub">较前一日 '+absoluteComparison(current,previous,numerator,numerator==='operators'?' 人':numerator==='avgSeconds'?' 秒':' 笔',numerator==='avgSeconds'?v=>Number(v).toFixed(2):C,!['rejected','manualCount','avgSeconds'].includes(numerator))+'</small>';
  }
  function pagebar(total,page,size,reason=false){if(reason&&root.HensemWorkorderUI)return root.HensemWorkorderUI.pager(total,page,size,'withdrawReason',S.reasonBusy);const max=Math.max(1,Math.ceil(total/size)),fn=reason?'withdrawReasonPage':'withdrawPage';return '<div class="withdraw-pager"><span>共 '+C(total)+' 条'+(total?' · '+C((page-1)*size+1)+'–'+C(Math.min(page*size,total)):'')+'</span>'+(reason?'':'<select aria-label="每页行数" onchange="withdrawSize(this.value)">'+[20,30,50,100,500].map(n=>'<option value="'+n+'" '+(n===size?'selected':'')+'>'+n+' 条 / 页</option>').join('')+'</select>')+'<button class="btn small" '+(page<=1?'disabled':'')+' onclick="'+fn+'('+(page-1)+')">上一页</button><span>'+page+' / '+max+'</span><button class="btn small" '+(page>=max?'disabled':'')+' onclick="'+fn+'('+(page+1)+')">下一页</button></div>'}
  const catalog=()=>{const native=(L.catalog||[]).filter(p=>!(String(p.source||'').toLowerCase()==='panda')).map(identity);return [...native,...(L.withdrawCatalog||[]).map(p=>{const row=identity(p),matches=isWg(row)?native.filter(n=>isWg(n)&&rawTarget(n)===rawTarget(row)&&requestPlatform(n)===requestPlatform(row)):[];if(matches.length===1){row.name=matches[0].name;row.sourceName=requestPlatform(matches[0]);if(['__unassigned__','__team_pending__'].includes(row.team))row.team=matches[0].team;}if(!['__unassigned__','__team_pending__'].includes(row.team))return row;const teams=[...new Set(native.filter(n=>rawTarget(n)===rawTarget(row)&&n.name===row.name).map(n=>n.team).filter(t=>!['__unassigned__','__team_pending__','__team_conflict__','归属待核对'].includes(t)))];return teams.length===1?{...row,team:teams[0]}:row})]};
  function toolbar(){const all=catalog(),teams=[...new Set(all.map(p=>p.team))].filter(t=>!['__team_pending__','__team_conflict__','归属待核对'].includes(t)).sort(),chosen=activeTeams(),countries=[...new Set(all.filter(p=>!chosen.length||chosen.includes(p.team)).map(p=>p.country).filter(Boolean))].sort();const list=scopeCatalog(),catalogPlatforms=list.map(p=>p.name),platforms=[...new Set([...(S.data?.scopeKey===selectionKey()?(S.data.platforms||[]).map(name=>{const names=[...new Set(list.filter(p=>isWg(p)&&requestPlatform(p)===name||!isWg(p)&&rawTarget(p)==='印度'&&platformKey(name)==='MAANWIN'&&platformKey(p.name)==='MAANWIN').map(p=>p.name))];return names.length===1?names[0]:name;}):[]),...catalogPlatforms,...S.platforms])].sort();
   const multi=root.HensemLiveFilters.multi({key:'withdrawPlatform',label:'盘口 / 平台',values:S.platforms,items:platforms.map(p=>[p,p]),open:S.open,search:S.search}).replaceAll('liveMulti','withdrawMulti').replaceAll('liveSetMultiOption','withdrawSetMultiOption');
   return '<section class="panel withdraw-toolbar"><form onsubmit="event.preventDefault();withdrawQueryForm(this)" onkeydown="withdrawFilterKey(event)"><div class="live-filters"><div class="live-field"><label>开始日期</label><input name="from" required type="date" value="'+E(L.from.slice(0,10))+'" onchange="withdrawDate(\'from\',this.value)"></div><div class="live-field"><label>结束日期</label><input name="to" required type="date" value="'+E(L.to.slice(0,10))+'" onchange="withdrawDate(\'to\',this.value)"></div><div class="live-field"><label>所属团队</label><select onchange="withdrawTeam(this.value)"><option value="all" '+(!chosen.length?'selected':'')+'>全部</option>'+(chosen.length>1?'<option disabled selected>多个团队</option>':'')+teams.map(t=>'<option value="'+E(t)+'" '+(chosen.length===1&&chosen[0]===t?'selected':'')+'>'+E(t==='__unassigned__'?'待归类':t)+'</option>').join('')+'</select></div><div class="live-field"><label>国家 / 地区（必选）</label><select required onchange="withdrawCountry(this.value)">'+countries.map(c=>'<option '+(c===displayCountry()?'selected':'')+'>'+E(c)+'</option>').join('')+'</select></div>'+(baseScopeCatalog().some(historicalRow)?'<div class="live-field"><label>记录来源</label><select onchange="withdrawHistorical(this.value)"><option value="current" '+(!S.historical?'selected':'')+'>当前记录</option><option value="historical" '+(S.historical?'selected':'')+'>历史记录（2026-07-30）</option></select></div>':'')+multi+
   (view()==='operators'?'<div class="live-field wide"><label>操作人账号</label><input value="'+E(S.account)+'" maxlength="200" placeholder="搜索操作人" oninput="withdrawAccount(this.value)"></div>':'')+'<div class="live-actions"><button type="button" class="btn primary" '+(S.loading?'disabled aria-disabled="true" ':'')+'onclick="withdrawQueryForm(this.form)">'+(S.loading?'正在读取…':'查询')+'</button><button type="button" class="btn" onclick="withdrawReset()">重置</button><button type="button" class="btn" onclick="withdrawShift(-1)">上一日</button><button type="button" class="btn" onclick="withdrawShift(1)">下一日</button><button type="button" class="btn" onclick="liveExport()">导出当前表</button></div></div></form><div class="withdraw-shortcuts">'+[['today','今天'],['yesterday','昨日'],['before','前日'],['week','本周'],['lastweek','上周'],['month','本月'],['lastmonth','上月']].map(([key,label])=>'<button class="btn small" onclick="withdrawPeriod(\''+key+'\')">'+label+'</button>').join('')+'</div></section>';
  }
  const blockingKinds=['blocking','blockingVariants','blockingOrders'];
  const blockingReasonLabel=(value,row={})=>cleanNote(value)==='检测没备注'?(row.noteState==='unknown'?'未采集到说明':row.noteState==='present'?cleanNote(value):'未记录拦截说明'):cleanNote(value);
  const missingBlockingHelp='已计入人工处理，但当前采集记录没有可用拦截说明；具体转人工原因待核对，不代表提现失败。';
  const blockingSourceNote=(value,row={})=>row.noteState==='unknown'?sourceNote(null,'（未采集到说明，源字段是否为空尚未核验）','备注来源状态','',true):row.blockingNoteState==='withheld'?sourceNote(null,'（拦截说明已隐藏，具体原因待核对）','备注来源状态','',true):row.blockingNoteState==='empty'?sourceNote(null,'（采集字段为空，具体转人工原因待核对）','备注来源状态','',true):row.blockingNoteState==='missing'?sourceNote(null,'（未采集到明确拦截说明）','备注来源状态','',true):sourceNote(value,'（当前采集记录未提供拦截说明）','自动出款拦截原文');
  function yashNotesBody(d,r){
   const blocking=blockingKinds.includes(r.kind),rows=d.rows||[],states=d.summary?.sourceNoteStates||{},count=d.noteCount,field=blocking?'风控备注':'订单备注';
   const note=(value,state)=>state==='missing'?'<span class="muted">未采集'+field+'（含超长未保留）</span>':state==='empty'?'<span class="muted">源'+field+'为空</span>':sourceNote(value,'（说明未提供）','采集说明（已脱敏）','',true);
   let body='<div class="withdraw-reason-summary">'+[['已入库'+(blocking?'提现':'驳回')+'订单',count],['已采集说明',states.present],['源备注为空',states.empty],['未采集说明',states.missing]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+(known(value)?C(value):'—')+'</strong></div>').join('')+'</div><p class="withdraw-denominator">'+(blocking?'按全部已入库提现订单展示源风控备注；不据此判断自动或人工处理。':'只展示已入库驳回订单的源订单备注；不使用风控备注补作驳回原因。')+' 未采集不表示源字段为空；旧订单需备注补采后更新。</p><div class="config-help">采集说明已脱敏 · 按印度当地申请日期 · '+(d.coverage?.complete===true?'订单范围已完整核验':'订单范围尚未完整核验，以下为已入库记录')+' · 更新时间 '+E(d.updatedAt||'—')+'</div>';
   if(['orders','blockingOrders'].includes(r.kind)){
    body+='<form class="withdraw-order-search" onsubmit="event.preventDefault();withdrawReasonSearch()" onkeydown="withdrawReasonQueryKey(event)"><input aria-label="搜索订单号" type="search" maxlength="200" placeholder="搜索订单号" value="'+E(S.reasonQuery)+'" oninput="withdrawReasonQuery(this.value)"><button class="btn" type="button" onclick="withdrawReasonSearch()">搜索订单</button></form>';
    if(r.kind==='blockingOrders')body+='<div class="withdraw-filter-chip">当前说明：'+E(S.reasonLabel||'所选说明')+' <button class="link" onclick="withdrawReasonKind(\'blocking\')">返回风控备注</button></div>';
    body+=table(['订单号 / 金额','订单状态','订单备注（已脱敏）','风控备注（已脱敏）','最后操作人','申请 / 完成时间'],rows.map(x=>['<strong>'+E(x.orderNumber||'—')+'</strong><small class="cell-sub">'+E(x.amount??'—')+' '+E(x.currency||'')+'</small>',E(x.status||'—'),x.orderNoteState==='missing'?'<span class="muted">未采集订单备注（含超长未保留）</span>':x.orderNoteState==='empty'?'<span class="muted">源订单备注为空</span>':sourceNote(x.orderNote,'（说明未提供）','采集说明（已脱敏）','',true),x.riskNoteState==='missing'?'<span class="muted">未采集风控备注（含超长未保留）</span>':x.riskNoteState==='empty'?'<span class="muted">源风控备注为空</span>':sourceNote(x.riskNote,'（说明未提供）','采集说明（已脱敏）','',true),E(x.operator||'—'),E(x.createdAt||'—')+'<small class="cell-sub">'+E(x.completedAt||'—')+'</small>']),'withdraw-reason-table withdraw-order-table');
   }else if(r.kind==='operators')body+=table(['最后操作人','驳回笔数','未采集或源空备注','详情'],rows.map((x,i)=>[E(x.operator||'—'),C(x.count),C(x.missingReasonCount),'<button class="btn small" onclick="withdrawReasonDrill('+i+',\'operator\')">查看订单</button>']),'withdraw-reason-table');
   else body+=table([field+'（已脱敏）','笔数',blocking?'占已入库提现订单':'占已入库驳回订单','详情'],rows.map((x,i)=>[note(x.sourceReason,x.noteState),C(x.count),known(count)&&Number(count)>0?R(x.count,count):'—','<button class="btn small" onclick="'+(blocking?'withdrawBlockingDrill('+i+',\'blockingOrders\')':'withdrawReasonDrill('+i+',\'category\')')+'">查看订单</button>']),'withdraw-reason-table withdraw-distribution-table');
   if(!rows.length)body+='<div class="live-empty">'+(d.coverage?.complete===true?'当前筛选无记录。':'当前条件下没有已入库记录；不能据此推定源站没有数据。')+'</div>';
   return body+pagebar(Number(d.total||0),S.reasonPage,S.reasonSize,true);
  }
  function game66NotesBody(d,r){
   const blocking=blockingKinds.includes(r.kind),rows=d.rows||[],states=d.summary?.sourceNoteStates||{},count=d.noteCount;
   const fields=blocking?[['auto_reason','自动出款备注']]:[['audit_remark','审核备注'],['reason','原因字段备注'],['withdraw_remark','提现备注']];
   const note=value=>value==null?'<span class="muted">未取得备注（含不宜展示的内容）</span>':value===''?'<span class="muted">源字段为空</span>':sourceNote(value,'（未取得备注）','业务备注（已脱敏）','',true);
   const labels=(value,list=fields)=>list.map(([key,label])=>'<div><small>'+E(label)+'</small> '+note(value?.[key])+'</div>').join('');
   let body='<div class="withdraw-reason-summary">'+[['已入库'+(blocking?'提现':'驳回')+'订单',count],['有业务备注',states.present],['源字段为空',states.empty],['未取得备注',states.missing]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+(known(value)?C(value):'—')+'</strong></div>').join('')+'</div><p class="withdraw-denominator">'+(blocking?'展示源自动出款备注，可能记录审核拦截说明；不据此判断订单最终驳回或自动／人工处理。':'只按源状态码 -1 选择已入库驳回订单，分别展示审核、原因字段和提现备注；业务备注不等同已确认驳回原因。')+' 只统计已入库记录，范围完整性尚未确认。</p><div class="config-help">GAME66 业务备注已脱敏 · 按印度当地创建日期 · 更新时间 '+E(d.updatedAt||'—')+'</div>';
   if(['orders','blockingOrders'].includes(r.kind)){
    body+='<form class="withdraw-order-search" onsubmit="event.preventDefault();withdrawReasonSearch()" onkeydown="withdrawReasonQueryKey(event)"><input aria-label="搜索订单号" type="search" maxlength="200" placeholder="搜索订单号" value="'+E(S.reasonQuery)+'" oninput="withdrawReasonQuery(this.value)"><button class="btn" type="button" onclick="withdrawReasonSearch()">搜索订单</button></form>';
    body+=table(['订单号 / 金额','源订单状态','源业务备注（已脱敏）','操作人','创建 / 更新时间'],rows.map(x=>['<strong>'+E(x.orderNumber||'—')+'</strong><small class="cell-sub">'+E(x.amount??'—')+' '+E(x.currency||'')+'</small>',E(x.status||'—'),labels(x.sourceNotes,[['auto_reason','自动出款备注'],['audit_remark','审核备注'],['reason','原因字段备注'],['withdraw_remark','提现备注']]),E(x.operator||'—'),E(x.createdAt||'—')+'<small class="cell-sub">更新：'+E(x.updatedAt||'—')+'</small>']),'withdraw-reason-table withdraw-order-table');
   }else if(r.kind==='operators')body+=table(['操作人','已入库驳回笔数','未取得或源空备注','详情'],rows.map((x,i)=>[E(x.operator||'—'),C(x.count),C(x.missingReasonCount),'<button class="btn small" onclick="withdrawReasonDrill('+i+',\'operator\')">查看订单</button>']),'withdraw-reason-table');
   else body+=table(['源业务备注（已脱敏）','笔数',blocking?'占已入库提现订单':'占已入库驳回订单','详情'],rows.map((x,i)=>[labels(x.sourceNotes),C(x.count),known(count)&&Number(count)>0?R(x.count,count):'—','<button class="btn small" onclick="'+(blocking?'withdrawBlockingDrill('+i+',\'blockingOrders\')':'withdrawReasonDrill('+i+',\'category\')')+'">查看订单</button>']),'withdraw-reason-table withdraw-distribution-table');
   if(!rows.length)body+='<div class="live-empty">当前条件下没有已入库记录；不能据此推定源站没有数据。</div>';
   return body+pagebar(Number(d.total||0),S.reasonPage,S.reasonSize,true);
  }
  const duoliNotesRow=row=>String(row?.source||'').toUpperCase()==='DUOLI'||row?.sourceNoteFormat==='duoli_withdraw_source_notes_v1';
  function duoliNotesBody(d,r){
   const all=blockingKinds.includes(r.kind),rows=d.rows||[],states=d.summary?.sourceNoteStates||{},count=d.noteCount;
   const field=(x,key)=>{const state=x.sourceNoteStates?.[key],flags=x.sourceNoteFlags?.[key]||{},label={missing:'未采集',empty:'源字段为空',invalid:'字段格式异常，未展示',withheld:'隐私内容已隐藏',stale:'旧备注待更新'}[state];return state==='present'?sourceNote(x.sourceNotes?.[key],'（未采集）','来源备注（已脱敏）','',true)+((flags.redacted||flags.truncated)?'<small class="cell-sub">'+[flags.redacted?'部分内容已隐藏':'',flags.truncated?'文本已截断':''].filter(Boolean).join(' · ')+'</small>':''):'<span class="muted">'+E(label||'未采集')+'</span>'};
   const labels=x=>'<div><small>来源字段 condition</small> '+field(x,'condition')+'</div><div><small>来源字段 remark</small> '+field(x,'remark')+'</div>';
   let body='<div class="withdraw-reason-summary">'+[['已入库'+(all?'提现':'驳回')+'订单',count],['含文本',states.present],['源字段为空',states.empty],['已隐藏',states.withheld],['未采集',states.missing],...(Number(states.stale)>0?[['旧备注待更新',states.stale]]:[]),...(Number(states.invalid)>0?[['格式异常',states.invalid]]:[])].map(([label,value])=>'<div><span>'+label+'</span><strong>'+(known(value)?C(value):'—')+'</strong></div>').join('')+'</div><p class="withdraw-denominator">'+(all?'按已入库提现订单展示来源字段。':'按源状态码 4、7 展示已入库驳回订单的来源字段。')+' condition / remark 尚未核实为自动拦截或驳回原因，不据此归类。</p><div class="config-help">按印尼当地创建日期 · 已脱敏 · 订单范围尚未完整核验 · 备注更新 '+E(d.updatedAt||'—')+'</div>';
   if(['orders','blockingOrders'].includes(r.kind)){
    body+='<form class="withdraw-order-search" onsubmit="event.preventDefault();withdrawReasonSearch()" onkeydown="withdrawReasonQueryKey(event)"><input aria-label="搜索订单号" type="search" maxlength="200" placeholder="搜索订单号" value="'+E(S.reasonQuery)+'" oninput="withdrawReasonQuery(this.value)"><button class="btn" type="button" onclick="withdrawReasonSearch()">搜索订单</button></form>';
    body+=table(['订单号 / 金额','源订单状态','来源备注（已脱敏）','操作人','创建 / 更新时间'],rows.map(x=>['<strong>'+E(x.orderNumber||'—')+'</strong><small class="cell-sub">'+E(x.amount??'—')+' '+E(x.currency||'')+'</small>',E(x.status||x.statusCode||'—'),labels(x),E(x.operator||'—'),E(x.createdAt||'—')+'<small class="cell-sub">'+E(x.updatedAt||'—')+'</small>']),'withdraw-reason-table withdraw-order-table');
   }else if(r.kind==='operators')body+=table(['操作人','已入库驳回笔数','无可展示文本','详情'],rows.map((x,i)=>[E(x.operator||'—'),C(x.count),C(x.missingReasonCount),'<button class="btn small" onclick="withdrawReasonDrill('+i+',\'operator\')">查看订单</button>']),'withdraw-reason-table');
   else body+=table(['来源备注（已脱敏）','笔数',all?'占已入库提现订单':'占已入库驳回订单','详情'],rows.map((x,i)=>[labels(x),C(x.count),known(count)&&Number(count)>0?R(x.count,count):'—','<button class="btn small" onclick="'+(all?'withdrawBlockingDrill('+i+',\'blockingOrders\')':'withdrawReasonDrill('+i+',\'category\')')+'">查看订单</button>']),'withdraw-reason-table withdraw-distribution-table');
   if(!rows.length)body+='<div class="live-empty">当前条件下没有已入库记录；未采集不代表源字段为空。</div>';
   return body+pagebar(Number(d.total||0),S.reasonPage,S.reasonSize,true);
  }
  function lgNotesBody(d,r){
   const rows=d.rows||[],states=d.summary?.sourceNoteStates||{},count=d.noteCount;
   const labels=x=>[['remark','源备注 remark'],['appRemark','应用备注 appRemark']].map(([key,label])=>{const state=x.sourceNoteStates?.[key],value=state==='empty'?'<span class="muted">源字段为空</span>':state==='redacted'?'<span class="muted">隐私内容已隐藏</span>':state==='present'?sourceNote(x.sourceNotes?.[key],'（未采集）','LG 业务备注（已脱敏）','',true):'<span class="muted">未采集</span>';return '<div><small>'+E(label)+'</small> '+value+'</div>'}).join('');
   let body='<div class="withdraw-reason-summary">'+[['已入库驳回订单',count],['有业务备注',states.present],['源字段为空',states.empty],['隐私内容已隐藏',states.redacted],['未采集',states.missing]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+(known(value)?C(value):'—')+'</strong></div>').join('')+'</div><p class="withdraw-denominator">只按源状态 rejected 选择已入库驳回订单，分别展示源备注 remark 和应用备注 appRemark；业务备注不等同已确认驳回原因。旧采集未提供备注时显示未采集，源字段确实为空时单独显示为空。只统计已入库记录，范围完整性尚未确认。</p><div class="config-help">LG 业务备注已脱敏 · 按平台当地创建日期 '+E(d.timezone||'')+' · 更新时间 '+E(d.updatedAt||'—')+'</div>';
   if(r.kind==='orders'){
    body+='<form class="withdraw-order-search" onsubmit="event.preventDefault();withdrawReasonSearch()" onkeydown="withdrawReasonQueryKey(event)"><input aria-label="搜索订单号" type="search" maxlength="200" placeholder="搜索订单号" value="'+E(S.reasonQuery)+'" oninput="withdrawReasonQuery(this.value)"><button class="btn" type="button" onclick="withdrawReasonSearch()">搜索订单</button></form>';
    body+=table(['订单号 / 金额','源订单状态','源业务备注（已脱敏）','操作人','创建 / 更新时间'],rows.map(x=>['<strong>'+E(x.orderNumber||'—')+'</strong><small class="cell-sub">'+E(x.amount??'—')+' '+E(x.currency||'')+'</small>',E(x.status||'—'),labels(x),E(x.operator||'—'),E(x.createdAt||'—')+'<small class="cell-sub">更新：'+E(x.updatedAt||'—')+'</small>']),'withdraw-reason-table withdraw-order-table');
   }else if(r.kind==='operators')body+=table(['操作人','已入库驳回笔数','未取得或源空备注','详情'],rows.map((x,i)=>[E(x.operator||'—'),C(x.count),C(x.missingReasonCount),'<button class="btn small" onclick="withdrawReasonDrill('+i+',\'operator\')">查看订单</button>']),'withdraw-reason-table');
   else body+=table(['源业务备注（已脱敏）','笔数','占已入库驳回订单','详情'],rows.map((x,i)=>[labels(x),C(x.count),known(count)&&Number(count)>0?R(x.count,count):'—','<button class="btn small" onclick="withdrawReasonDrill('+i+',\'category\')">查看订单</button>']),'withdraw-reason-table withdraw-distribution-table');
   if(!rows.length)body+='<div class="live-empty">当前条件下没有已入库记录；不能据此推定源站没有数据。</div>';
   return body+pagebar(Number(d.total||0),S.reasonPage,S.reasonSize,true);
  }
  const blockingStateSummary=row=>{const states=row.blockingNoteStates||{},parts=[['empty','采集字段为空'],['missing','未取得说明']].filter(([key])=>Number(states[key])>0).map(([key,label])=>label+' '+E(C(Number(states[key])))+' 笔');return parts.length?'<small class="cell-sub" data-blocking-provenance>'+parts.join(' · ')+'</small>':''};
  function reasonPanel(){if(!S.reason)return '';const d=S.reasonData||{},r=S.reason,cov=d.coverage||{},summary=d.summary||{},blocking=blockingKinds.includes(r.kind),noteStates=!blocking&&d.rejectionNoteStateVersion==='wg_source_note_state_v1',count=Number(d.noteCount??summary.totalRejected??cov.rejected??0);
   const duoli=d.sourceNoteFormat==='duoli_withdraw_source_notes_v1'||(S.data?.rows||[]).some(x=>duoliNotesRow(x)&&x.country===r.country&&rowPlatform(x)===r.platform),sanitized=d.reasonTextSanitized===true&&d.reasonTextFormat==='sanitized_label_v1',lg=d.sourceNoteFormat==='lg_business_notes_v1'||(S.data?.rows||[]).some(x=>x.sourceNoteFormat==='lg_business_notes_v1'&&x.country===r.country&&rowPlatform(x)===r.platform),game66=d.sourceNoteFormat==='game66_withdraw_notes_v1'||(S.data?.rows||[]).some(x=>x.sourceNoteFormat==='game66_withdraw_notes_v1'&&x.country===r.country&&rowPlatform(x)===r.platform),yash=!duoli&&!lg&&!game66&&(d.sourceNoteFormat==='yash_withdraw_notes_v1'||(S.data?.rows||[]).some(x=>x.sourceNotesAvailable===true&&x.country===r.country&&rowPlatform(x)===r.platform)),fullTextLabel=sanitized?'采集说明（已脱敏）':'完整原文',variantsLabel=sanitized?'采集说明分布':'全部原文';
   const tabs=duoli?[['blocking','提现来源备注'],['categories','驳回订单来源备注'],['operators','驳回操作人'],['orders','驳回订单']]:[...(!lg?[['blocking',game66?'自动出款备注':yash?'风控备注':'自动出款原因']]:[]),['categories',lg||game66?'驳回订单业务备注':yash?'驳回订单备注':'驳回原因占比'],['rejection',sanitized||yash||game66||lg?'采集说明分布':'原备注分布'],['operators','驳回操作人'],['orders','驳回订单']];
   const nav='<div class="withdraw-reason-tabs" role="tablist" aria-label="原因详情视图">'+tabs.map(([key,label])=>'<button role="tab" aria-selected="'+(r.kind===key||key==='blocking'&&blocking)+'" class="btn '+(r.kind===key||key==='blocking'&&blocking?'primary':'')+'" onclick="withdrawReasonKind(\''+key+'\')" '+((key==='orders'&&d.canViewOrders===false||key==='operators'&&d.canViewOperators===false)?'disabled':'')+'>'+label+'</button>').join('')+'</div>';
   let body=S.reasonBusy?'<div class="live-status">正在读取 '+E(platformLabel(r))+(duoli?' 的来源备注…</div>':' 的原因…</div>'):S.reasonError?'<div class="live-status live-error">'+E(S.reasonError)+' <button class="link" onclick="withdrawReasonRetry()">重试</button></div>':!d.available?'<div class="live-empty">'+E(d.message||'暂无采集记录')+(d.latestSnapshotDate?'；最近原因快照：'+E(d.latestSnapshotDate):'')+'</div>':'';
   if(!body&&duoli)body=duoliNotesBody(d,r);
   if(!body&&lg)body=lgNotesBody(d,r);
   if(!body&&game66)body=game66NotesBody(d,r);
   if(!body&&yash)body=yashNotesBody(d,r);
   if(!body){
    const rows=d.rows||[],share=x=>{const pct=count?Math.max(0,Math.min(100,100*Number(x)/count)):0;return '<div class="withdraw-share"><span>'+R(x,count)+'</span><span class="withdraw-share-track"><i style="width:'+pct.toFixed(2)+'%"></i></span></div>'};
    const oc=summary.operatorCounts||{};
    const blockingMetrics=[['人工总数',oc.manual],['已采集到说明',oc.manualWithReason],[sanitized?'未采到说明':'未记录拦截说明',oc.manualWithoutReason],...(Number(oc.manualWithheldReason)>0?[['说明已隐藏',oc.manualWithheldReason]]:[]),['已采集提现订单',oc.total]];
    body='<div class="withdraw-reason-summary">'+(blocking?blockingMetrics:noteStates?[['当日驳回订单',count],['已知原备注种类',summary.knownReasonCount],['源业务备注已隐藏',summary.withheldReason],['未采集明确驳回备注',summary.missingReason],['源备注为空',summary.emptyReason],['涉及操作人',summary.operators]]:[['当日驳回订单',count],['不同原备注',(d.categories||[]).length],['备注为空',summary.missingReason],['涉及操作人',summary.operators]]).map(([label,value])=>'<div><span>'+label+'</span><strong>'+(value==null?'—':C(value))+'</strong></div>').join('')+'</div>';
    body+='<div class="config-help">来源：'+E(d.source)+' · 更新时间：'+E(String(d.updatedAt||'—').replace('T',' '))+(cov.collected!=null?' · 已采集 '+C(cov.collected)+' 笔'+(cov.expected!=null?' / 日报 '+C(cov.expected)+' 笔':''):'')+(cov.complete===false?' <strong>采集时点或覆盖量不同，请以当前原因明细覆盖范围核对。</strong>':'')+'</div>';
    if(blocking){
     const bc=summary.blockingCounts||{};
     body+='<p class="withdraw-denominator">原因占比按 '+C(count)+' 笔人工处理记录计算，含未记录拦截说明的记录。'+(Number(oc.system)>0?' 系统订单 '+C(oc.system)+' 笔已排除。':oc.system==null&&Number(bc.system)>0?' 系统说明已排除 '+C(bc.system)+' 笔。':'')+(Number(oc.unknown??bc.unknown)>0?' 操作人未明 '+C(oc.unknown??bc.unknown)+' 笔未计入。':'')+(oc.manual==null?' 当前来源只提供已记录分类，完整人工总数未提供。':'')+'</p>';
     if(Number(oc.manualWithoutReason)>0||rows.some(x=>sanitized?x.noteState==='unknown':x.noteState!=='present'&&(x.reason==='检测没备注'||x.canonicalReason==='检测没备注'||x.blockingReason==='检测没备注')))body+='<div class="config-help" data-blocking-note-state="unavailable">'+(sanitized?'未采到说明：已计入人工处理，源字段是否为空尚未核验；具体原因待核对。':'未记录拦截说明：'+missingBlockingHelp)+'</div>';
     if(Number(oc.manualWithheldReason)>0)body+='<div class="config-help" data-blocking-note-state="withheld">说明已隐藏：当前来源未提供可查看的原文，不能判断具体转人工原因。</div>';
     if(r.kind!=='blocking')body+='<div class="withdraw-filter-chip">当前规则：'+E(S.reasonLabel||blockingReasonLabel(rows[0]?.canonicalReason||rows[0]?.blockingReason||'所选规则',rows[0]))+' <button class="link" onclick="withdrawReasonKind(\'blocking\')">返回规则分类</button> <button class="btn small" onclick="withdrawBlockingView(\'blockingVariants\')">'+variantsLabel+'</button> <button class="btn small" '+(d.canViewBlockingOrders===true?'':'disabled ')+'onclick="withdrawBlockingView(\'blockingOrders\')">查看该规则订单</button></div>';
     if(d.canViewBlockingOrders!==true)body+='<div class="config-help">当前来源仅保留'+(sanitized?'已脱敏采集说明':'原文')+'与笔数，无法还原逐笔订单；可查看'+variantsLabel+'。</div>';
    }else{
     body+='<p class="withdraw-denominator">占比统一按该平台、该日期的全部 '+C(count)+' 笔驳回订单计算，筛选和翻页不改变分母。'+(noteStates?'已知备注按完整文本分别统计。隐藏和未采集记录的原文种类待核对；来源状态合桶不表示同一驳回原因。':'按完整原备注分别统计；不同文本不合并，空备注单列。')+'</p>';
     if(d.canViewOrders===false)body+='<div class="live-status">当前来源只有原因汇总，暂未采集对应订单号和操作人明细。</div>';
     if(S.reasonLabel||r.query)body+='<div class="withdraw-filter-chip">当前筛选：'+E([S.reasonLabel,r.query?'订单号含 '+r.query:''].filter(Boolean).join(' · '))+'<button class="link" onclick="withdrawReasonClear()">清除筛选</button></div>';
    }
    if(['orders','blockingOrders'].includes(r.kind))body+='<form class="withdraw-order-search" onsubmit="event.preventDefault();withdrawReasonSearch()" onkeydown="withdrawReasonQueryKey(event)"><input aria-label="搜索'+(blocking?'拦截':'驳回')+'订单号" type="search" maxlength="200" placeholder="搜索订单号" value="'+E(S.reasonQuery)+'" oninput="withdrawReasonQuery(this.value)"><button class="btn" type="button" onclick="withdrawReasonSearch()">搜索订单</button></form>';
    const detailButton=(index,key,label='查看订单')=>'<button class="btn small" '+(d.canViewOrders===false?'disabled':'')+' onclick="withdrawReasonDrill('+index+',\''+key+'\')">'+label+'</button>';
    if(r.kind==='blockingOrders')body+=table(['订单号 / 金额','规则分类','规则阈值','实际值',fullTextLabel,'订单状态','操作人账号','申请 / 完成时间'],rows.map(x=>[
     '<strong class="withdraw-order-number">'+E(x.orderNumber||'—')+'</strong><small class="cell-sub">'+N(x.amount)+'</small>',E(blockingReasonLabel(x.blockingReason||S.reasonLabel||'未归类',x)),E(x.blockingThreshold??'—'),x.blockingActualValue==null?'—':E((x.blockingActualField?x.blockingActualField+'：':'')+x.blockingActualValue),blockingSourceNote(x.rawManualRemark||x.manualRemark,x),E(x.status||'—'),E(x.operator||'（源账号为空）'),E(String(x.createdAt||'—').replace('T',' '))+'<small class="cell-sub">'+E(String(x.completedAt||'—').replace('T',' '))+'</small>']),'withdraw-reason-table withdraw-blocking-orders');
    else if(r.kind==='blockingVariants')body+=table([fullTextLabel,'笔数','成功','驳回','其他状态','占人工处理记录'],rows.map(x=>[blockingSourceNote(x.canonicalReason==='检测没备注'?x.sourceReason:x.sourceReason||x.reason,x)+blockingStateSummary(x),C(x.count),C(x.success),C(x.rejected),C(x.other),share(x.count)]),'withdraw-reason-table withdraw-distribution-table');
    else if(r.kind==='orders')body+=table(['订单号 / 金额',noteStates?'驳回备注 / 来源状态':'驳回原因 / 完整原备注','操作人账号','申请 / 完成时间','自动出款拦截 / 转人工说明'],rows.map(x=>[
     '<strong class="withdraw-order-number" title="'+E(x.orderNumber)+'">'+E(x.orderNumber)+'</strong><small class="cell-sub">'+N(x.amount)+' · '+E(x.status)+'</small>',
     rejectionSourceNote(x.rawRejectionReason??x.rejectionReason,x)+sourceNoteStates(x),'<span class="withdraw-operator-name" title="'+E(x.operator||'（源账号为空）')+'">'+E(x.operator||'（源账号为空）')+'</span>','<span class="withdraw-order-time">'+E(String(x.createdAt||'—').replace('T',' '))+'</span><small class="cell-sub">'+E(String(x.completedAt||'—').replace('T',' '))+'</small>',sourceNote(x.manualRemark,'（源字段为空）','自动出款拦截原文')]),'withdraw-reason-table withdraw-order-table');
    else if(r.kind==='categories')body+=table([noteStates?'驳回备注 / 来源状态':'驳回原文','笔数','占全部驳回订单','详情'],rows.map((x,i)=>[rejectionSourceNote(x.sourceReason??x.rawReason??x.reason??(d.rejectionGrouping==='exact_source_text_v1'?x.category:null),x),C(x.count),share(x.count),detailButton(i,'category')+' <button class="link" onclick="withdrawReasonVariants('+i+')">原备注分布</button>']),'withdraw-reason-table withdraw-distribution-table');
    else if(r.kind==='operators')body+=table(['操作人账号','驳回笔数','占全部驳回订单',noteStates?'已知原备注种类':'不同原备注',noteStates?'无可用驳回备注':'备注为空','详情'],rows.map((x,i)=>[E(x.operator||'（源账号为空）'),C(x.count),share(x.count),C(x.categoryCount),C(x.missingReasonCount),detailButton(i,'operator')]),'withdraw-reason-table withdraw-distribution-table');
    else if(r.kind==='blocking')body+=table(['自动出款拦截分类','笔数','占人工处理记录','详情'],rows.map((x,i)=>['<button class="withdraw-source-note" onclick="withdrawBlockingDrill('+i+',\'blockingVariants\')">'+E(blockingReasonLabel(x.reason,x))+'</button>'+blockingStateSummary(x)+(Number(x.sourceVariantCount)>1?'<small class="cell-sub">已合并 '+C(x.sourceVariantCount)+' 种'+(sanitized?'采集说明':'原文')+'</small>':''),C(x.count),share(x.count),'<button class="btn small" onclick="withdrawBlockingDrill('+i+',\'blockingVariants\')">'+variantsLabel+'</button> <button class="btn small" '+(d.canViewBlockingOrders===true?'':'disabled ')+'onclick="withdrawBlockingDrill('+i+',\'blockingOrders\')">查看订单</button>']),'withdraw-reason-table withdraw-distribution-table');
    else body+=table([noteStates?'驳回备注 / 来源状态':'驳回原文','笔数','占全部驳回订单','详情'],rows.map((x,i)=>[rejectionSourceNote(x.sourceReason??x.reason,x),C(x.count),share(x.count),detailButton(i,'reason')]),'withdraw-reason-table withdraw-distribution-table');
    if(!rows.length)body+='<div class="live-empty">'+(blocking?'当前条件下没有人工处理记录。':'当前条件下没有驳回记录。')+'</div>';
    body+=pagebar(Number(d.total||0),S.reasonPage,S.reasonSize,true);
   }
   return '<div class="withdraw-drawer-backdrop" onclick="if(event.target===this)withdrawReasonClose()" onkeydown="withdrawReasonKey(event)"><section id="withdraw-reasons" class="withdraw-drawer" role="dialog" aria-modal="true" aria-label="平台原因详情" tabindex="-1"><header class="withdraw-drawer-head"><div><span>'+E(identity({country:r.country,name:r.platform}).country)+' · '+E(platformLabel(r))+'</span><h2>'+(duoli?'来源备注':game66?(blocking?'自动出款备注':'驳回订单业务备注'):yash?(blocking?'风控备注':'驳回订单备注'):blocking?'自动出款原因':'驳回原因分析')+'</h2></div><label>当地日期<input aria-label="原因日期" type="date" value="'+E(r.date)+'" onchange="withdrawReasonDate(this.value)"></label><button class="btn" aria-label="关闭原因详情" onclick="withdrawReasonClose()">关闭 ✕</button></header>'+nav+'<div class="withdraw-drawer-body">'+body+'</div><footer class="withdraw-drawer-foot">'+(duoli?'仅展示已采集的 condition / remark；空、隐藏、未采集及旧版本分别保留，具体原因待核实。':game66?'展示 GAME66 源业务备注（已脱敏），不将业务备注归为确定驳回原因；完整性尚未确认。':yash?'展示源站订单备注与风控备注（已脱敏）；未采集、源空与已有内容分别保留，不据此判断自动或人工。':d.reasonAvailable===false?'当前采集数据未提供自动／人工标识及原因，不能推定为无原因。':blocking?'按已采集的转人工说明归类；未记录说明的单列。排除 system 和操作人未明，不限最终状态。':sanitized?'按当地申请日期展示已脱敏采集说明；未采到说明不代表源字段为空，具体原因待核对。':noteStates?'按申请日期归入当地日，与日报范围一致。显示已采集的脱敏业务文本；隐藏原文需在源平台核对，拦截说明不代作驳回备注。':'按申请日期归入当地日，与日报范围一致。保留完整原备注，由你核对驳回是否恰当。')+'</footer></section></div>'+(S.originalNote?originalNoteDialog():'');
  }
  function originalNoteDialog(){return '<div class="withdraw-original-backdrop" onclick="if(event.target===this)withdrawReasonOriginalClose()"><section class="withdraw-original-dialog" role="dialog" aria-modal="true" aria-label="'+E(S.originalNoteTitle)+'"><header><h2>'+E(S.originalNoteTitle)+'</h2><button class="btn" onclick="withdrawReasonOriginalClose()">关闭 ✕</button></header><pre>'+E(S.originalNote)+'</pre><div class="config-actions"><button class="btn primary" onclick="withdrawReasonOriginalClose()">知道了</button></div></section></div>'}
  function yashCoveragePanel(data,operators){
   const coverage=data.yashCoverage;if(!coverage)return '';
   const start=data.startDate||resultDates().from,end=data.endDate||resultDates().to,days=Array.isArray(coverage.days)?coverage.days.filter(day=>day&&day.date>=start&&day.date<=end):[];
   const expected=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000+1;
   const complete=coverage.currentComplete===true&&days.length===expected&&new Set(days.map(day=>day.date)).size===expected&&days.every(day=>day.complete===true);
   const seen=Date.parse(coverage.latestCollectedAt),latest=Number.isFinite(seen)?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kolkata',dateStyle:'short',timeStyle:'medium'}).format(new Date(seen))+'（印度时间）':'尚未取得';
   return '<div class="live-panel-note" data-yash-coverage="'+(complete?'complete':'partial')+'"><strong>YASH.BET 提现明细：</strong>'+(complete?'所选创建日已完整采集。':'<strong>所选创建日尚未完整采集，显示已入库部分，不能作为完整总计。</strong>')+' 最新采集：'+E(latest)+'。按印度当地创建日期统计，订单状态为当前已采集状态。'+(coverage.previousComplete===false?' 前期覆盖不完整，暂不比较涨跌。':'')+(operators?' 操作人按订单记录的当前操作人汇总，不代表历史操作次数。':'')+'</div>';
  }
  function newarCoveragePanel(data,operators){
   const coverage=data.newarCoverage;if(!coverage)return '';
   const start=data.startDate||resultDates().from,end=data.endDate||resultDates().to,all=Array.isArray(coverage.days)?coverage.days:[],days=all.filter(day=>day&&day.date>=start&&day.date<=end);
   const expected=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000+1,key=day=>JSON.stringify([day.country,day.platform]),platforms=new Set(all.filter(day=>day&&typeof day.country==='string'&&typeof day.platform==='string').map(key));
   const complete=coverage.currentComplete===true&&platforms.size>0&&days.length===expected*platforms.size&&new Set(days.map(day=>JSON.stringify([day.country,day.platform,day.date]))).size===days.length&&days.every(day=>day.complete===true&&typeof day.country==='string'&&typeof day.platform==='string');
   return '<div class="live-panel-note" data-newar-coverage="'+(complete?'complete':'partial')+'"><strong>新 AR 提现明细：</strong>'+(complete?'所选创建日已完整采集。':'<strong>所选创建日尚未完整采集，显示已入库部分，不能作为完整总计。</strong>')+' 按各平台当地创建日期统计，订单状态为当前已采集状态；复用每 10 分钟入库明细，不与旧日报重复累加。'+(coverage.previousComplete===false?' 前期覆盖不完整，暂不比较涨跌。':'')+(operators?' 操作人按订单记录的当前操作人汇总，不代表历史操作次数。':'')+'</div>';
  }
  function decimalSort(value){
   if(value===null||value===undefined||typeof value==='boolean'||typeof value==='string'&&!value.trim()||!Number.isFinite(Number(value)))return null;
   const m=String(value).trim().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);if(!m)return null;
   const scale=(m[3]||'').length-Number(m[4]||0);if(Math.abs(scale)>400)return null;
   let n=BigInt(m[2]+(m[3]||''))*(m[1]==='-'?-1n:1n),d=1n;if(scale>0)d=10n**BigInt(scale);else n*=10n**BigInt(-scale);return {n,d};
  }
  function numericOrder(a,b){const left=a.n*b.d,right=b.n*a.d;return left<right?-1:left>right?1:0;}
  function textOrder(a,b){const left=Array.from(String(a)),right=Array.from(String(b));for(let i=0;i<Math.min(left.length,right.length);i++){const delta=left[i].codePointAt(0)-right[i].codePointAt(0);if(delta)return delta<0?-1:1;}return left.length-right.length;}
  function nullableOrder(a,b,compare){return a==null?b==null?0:1:b==null?-1:compare(a,b);}
  function sortValue(row,key){
   if(['country','platform','account'].includes(key))return row[key]??null;
   if(key==='previousAvgSeconds')return processingValueKnown(row.previous?.avgSeconds)?decimalSort(row.previous.avgSeconds):null;
   if(key==='avgSeconds')return processingValueKnown(row.avgSeconds)?decimalSort(row.avgSeconds):null;
   if(key==='durationChange'){
    const a=decimalSort(row.avgSeconds),b=decimalSort(row.previous?.avgSeconds);if(!processingBases[row.durationBasis]||row.durationBasis!==row.previous?.durationBasis||!a||!b||a.n<0n||b.n<0n)return null;
    if(b.n===0n)return a.n===0n?{n:0n,d:1n}:null;return {n:a.n*b.d-b.n*a.d,d:a.d*b.n};
   }
   const ratios={successRate:'success',rejectRate:'rejected',autoRate:'autoCount',manualRate:'manualCount'};
   if(ratios[key]){if(!shareKnown(row,ratios[key],['successRate','rejectRate'].includes(key)?row.total!==null&&row.total!==undefined?'total':'processed':'total'))return null;const a=decimalSort(row[ratios[key]]),b=decimalSort(['successRate','rejectRate'].includes(key)?row.total??row.processed:row.total);if(!a||!b||b.n===0n)return null;const n=a.n*b.d,d=a.d*b.n;return d<0n?{n:-n,d:-d}:{n,d};}
   return ['autoCount','manualCount'].includes(key)&&!countKnown(row,key)?null:decimalSort(row[key]);
  }
  function localReady(){return resultAllowed()&&S.localSnapshot&&!!S.data&&view()==='auto'&&!resultDaily()&&L.catalogReady&&(!S.applied||S.applied.query.view===view());}
  function renderLocal(){
   const x=root.scrollX,y=root.scrollY,previous=document.querySelector?.('.withdraw-stat-table'),left=previous?.scrollLeft,top=previous?.scrollTop;render();const next=document.querySelector?.('.withdraw-stat-table');if(next&&Number.isFinite(left)){next.scrollLeft=left;if(Number.isFinite(top))next.scrollTop=top;}if(Number.isFinite(x)&&Number.isFinite(y)&&(root.scrollX!==x||root.scrollY!==y))root.scrollTo?.(x,y);
  }
  function displayedRows(){
   const rows=S.data?.rows||[];if(!localReady())return rows;
   const text=['country','platform','account'].includes(S.sort),ordered=rows.map((row,index)=>({row,index,value:sortValue(row,S.sort)})).sort((a,b)=>{
    let primary=nullableOrder(a.value,b.value,text?textOrder:numericOrder);if(a.value!=null&&b.value!=null&&S.asc===false)primary=-primary;if(primary)return primary;
    for(const key of ['country','platform','dataDate','account']){const tie=nullableOrder(a.row[key]??null,b.row[key]??null,textOrder);if(tie)return tie;}return a.index-b.index;
   });const max=Math.max(1,Math.ceil(ordered.length/S.size));S.page=Math.min(S.page,max);return ordered.slice((S.page-1)*S.size,S.page*S.size).map(item=>item.row);
  }
  function draw(){resultAllowed();const operators=view()==='operators',d=S.data||{},t=d.totals||{},prior=d.previousTotals,comparisonIssue=summaryComparisonIssue(d),matched=matchedSummary(d),den=operators?'processed':'total',rows=displayedRows(),daily=resultDaily(),changed=draftChanged();
   const ratio=(r,key)=>{const count=r[key],total=r[den];if(!shareKnown(r,key,den))return '—';const value=R(count,total);return key==='autoCount'&&Number(count)/Number(total)<0.45?'<span class="red">'+value+'</span>':value};
   const controls=toolbar();let body='';if(changed)body+='<div class="live-status withdraw-draft-notice" role="status">筛选条件已修改，点击查询更新。'+(S.data?'以下仍为上次成功查询结果。':'')+'</div>';
   if(S.loading){body+='<div class="live-status" role="status">正在读取'+(operators?'操作人统计':'自动出款统计')+'…'+(S.data?(changed?'上次成功结果仍显示，尚未刷新。':'同一筛选的上次成功结果仍显示，尚未刷新。'):'')+'</div>';if(!S.data)return controls+body}
   if(S.error){body+='<div class="live-status live-error" role="alert">'+(S.data?(changed?'查询失败，上次成功结果已保留。':'刷新失败，同一筛选的上次成功结果已保留。'):'')+E(S.error)+' <button class="link" onclick="withdrawLoad()">重试</button></div>';if(!S.data)return controls+body}
   if(!S.data)return controls+'<div class="live-status">请选择筛选条件，点击查询。</div>';
   const coverage=d.wgCoverage;let coverageNotes='';
   const selectedWg=(S.applied?.catalog||scopeCatalog()).some(p=>isWg(p)&&(!(S.applied?.rowCountry??S.rowCountry)||rawTarget(p)===(S.applied?.rowCountry??S.rowCountry))&&(!(S.applied?.platforms||S.platforms).length||(S.applied?.platforms||S.platforms).includes(p.name)));
   if(selectedWg&&(!Array.isArray(coverage?.days)||!coverage.days.length))coverageNotes+='<div class="live-panel-note" data-wg-coverage="historical">WG 新明细尚未接入所选日期，当前沿用历史日报；不是本次实时采集结果。</div>';
   if(coverage&&Array.isArray(coverage.days)&&coverage.days.length){const currentDays=coverage.days.filter(day=>day.date>=(d.startDate||resultDates().from)&&day.date<=(d.endDate||resultDates().to)),complete=(typeof coverage.currentComplete==='boolean'?coverage.currentComplete:coverage.complete)===true&&currentDays.length>0&&currentDays.every(day=>day.complete===true);coverageNotes+='<div class="live-panel-note" data-wg-coverage="'+(complete?'complete':'partial')+'">WG 实时提现明细：'+(complete?'当期所选创建日已完整采集。':'<strong>当期所选创建日尚未完整采集，以下为已入库部分，不是完整总计。</strong>')+(coverage.previousComplete===false?' 前期覆盖不完整，跨期汇总暂不可比。':'')+(coverage.timeBasis==='created_at'?' 按各平台当地创建日期统计。':'')+(coverage.operatorBasis==='current_latest_operator'?' 操作人按订单当前最后操作者统计，不代表历史操作次数。':'')+' 不与旧 WG 日报重复累加。</div>'}
   coverageNotes+=yashCoveragePanel(d,operators)+newarCoveragePanel(d,operators)+(d.duoliCoverage?'<div class="live-panel-note" data-duoli-coverage="partial">多利按已入库创建日明细统计，完整性尚未确认；用时为源订单审核用时，不代表支付到账时长。</div>':'');
   if(coverageNotes)body+='<details class="withdraw-coverage-details"><summary>采集说明 <span>已入库数据</span></summary><div class="withdraw-coverage-content">'+coverageNotes+'</div></details>';
   if(!operators&&(t.classificationPartial===true||t.classificationAvailable===false||rows.some(row=>row.classificationAvailable===false)))body+='<div class="live-panel-note" data-withdraw-classification="'+(t.classificationPartial===true?'partial':'unavailable')+'">'+(t.classificationPartial===true?'自动／人工显示已确认笔数，占比按已入库总笔数计算；未分类单独列出。':'自动／人工未提供时显示「—」；未分类单独列出，不推定为人工。')+'</div>';
   const metrics=operators?[['processed','处理笔数'],['success','成功笔数'],['rejected','驳回笔数'],['operators','操作人数量'],['avgSeconds','平均处理用时']]:[['total','总笔数'],['autoCount','自动出款'],['manualCount','人工处理'],['success','成功'],['rejected','驳回']];
   body+='<section class="panel"><div class="panel-head"><h2>'+(operators?'操作人统计':'自动出款日报')+'</h2><span>'+E([...(S.applied?.teams||[]),S.applied?.country||d.country||''].filter(Boolean).join(' · '))+' · '+E(d.startDate||'')+' 至 '+E(d.endDate||'')+' · 对比 '+E(d.previousStartDate||'—')+' 至 '+E(d.previousEndDate||'—')+'</span>'+(!operators?'<div class="withdraw-header-actions"><button class="btn small" '+(S.loading||changed?'disabled aria-disabled="true" ':'')+'onclick="withdrawLoad()">刷新备注</button><button class="btn small" onclick="withdrawNoteSample()">备注样本</button></div>':'')+'</div><div class="withdraw-kpis">'+metrics.map(([key,label])=>'<div class="withdraw-kpi"><label>'+label+'</label><strong>'+ (key==='avgSeconds'?durationCell(t):countCell(t,key))+'</strong>'+(key===den&&!operators?'<small>日均 '+(known(t.total)?C(Number(t.total)/Math.max(1,Number(t.coveredDays||1))):'—')+'</small>':'')+(key!==den&&['autoCount','manualCount','success','rejected'].includes(key)?'<span class="withdraw-ratio">'+ratio(t,key)+'</span>':'')+(t.classificationPartial===true&&['autoCount','manualCount'].includes(key)?'<small>已确认笔数 · 占已入库总笔数</small>':'')+(key==='avgSeconds'?'<small>按有效时间样本加权</small>':'')+(summaryCountComparison(matched,key)??comparison(t,prior,key,undefined,comparisonIssue))+'</div>').join('')+'</div>'+
    (!operators?'<details class="withdraw-scope-details"><summary>统计口径</summary><div class="live-panel-note">未分处理方式 '+(observedCount(t.unclassifiedCount)!==null?C(t.unclassifiedCount):'—')+' 笔 · '+ratio(t,'unclassifiedCount')+' · 当前 '+(observedCount(t.platforms)!==null?C(t.platforms):'—')+' 平台'+(matched?' · 同平台对比 '+matched.platforms:'')+'。 '+(singleDay()&&Number.isSafeInteger(d.comparison?.matchedRows)&&Number.isSafeInteger(d.comparison?.totalRows)&&d.comparison.matchedRows>=0&&d.comparison.totalRows>=d.comparison.matchedRows?'前期有记录 '+C(d.comparison.matchedRows)+' / '+C(d.comparison.totalRows)+' 平台。':'')+(singleDay()&&comparisonIssue?E(comparisonIssue)+'。':'')+'汇总主值保留当前所选范围；较昨日仅按两期都有记录的同平台已入库笔数计算，采集完整性尚未核验。未分处理方式保留原值，不按零补齐。</div></details>':comparisonIssue?'<div class="live-panel-note">'+E(comparisonIssue)+'</div>':'')+'</section>';
   const sort=(label,key)=>'<button class="link" onclick="withdrawSort(\''+key+'\')">'+label+' '+(S.sort===key?(S.asc?'↑':'↓'):'↕')+'</button>';
   const comparisonRow=r=>r.source==='AR'&&d.arCoverage?.coverageBasis==='unverified_source_continuity'&&(d.arCoverage.currentComplete===false||d.arCoverage.previousComplete===false)?{...r,comparisonComparable:false}:r;
   const rate=(r,key)=>ratio(r,key)+(r.country?comparison(comparisonRow(r),r.previous,key,den):'');
   const headers=[...(daily?['日期']:[]),'<span class="withdraw-platform-heading">'+sort('盘口 / 平台','platform')+sort('国家','country')+'</span>',...(operators?['操作人',sort('处理笔数','processed'),sort('成功','success'),sort('驳回','rejected'),sort('成功占比','successRate'),sort('驳回占比','rejectRate')]:[sort('总提现笔数','total'),sort('成功','success'),sort('驳回','rejected'),sort('成功占比','successRate'),sort('驳回占比','rejectRate'),sort('自动出款','autoCount'),sort('人工处理','manualCount'),sort('自动占比','autoRate'),sort('人工占比','manualRate')]),sort('平均处理用时','avgSeconds'),sort('昨日处理用时','previousAvgSeconds'),sort('用时增减 / %','durationChange'),...(!operators?['原因 / 每日备注','详情']:[])];
   const totalCell=r=>countCell(r,'total')+(r.country&&r.classificationAvailable!==false&&known(r.unclassifiedCount)&&Number(r.unclassifiedCount)>0&&Number(r.unclassifiedCount)<=Number(r.total)?'<small class="cell-sub" title="自动、人工及未分类相加为总笔数；占比均按总笔数计算">未分类 '+C(r.unclassifiedCount)+' 笔</small>':'');
   const cells=(r,i)=>[...(daily?[E(r.dataDate)]:[]),identityCell(r),...(operators?[E(r.account),countCell(r,'processed'),countCell(r,'success'),countCell(r,'rejected'),rate(r,'success'),rate(r,'rejected')]:[totalCell(r),countCell(r,'success'),countCell(r,'rejected'),rate(r,'success'),rate(r,'rejected'),countCell(r,'autoCount'),countCell(r,'manualCount'),rate(r,'autoCount'),rate(r,'manualCount')]),
    durationCell(r),singleDay()||daily?durationCell(r.previous):'仅单日对比',(singleDay()||daily)?absoluteComparison(comparisonRow(r),r.previous,'avgSeconds',' 秒',v=>Number(v).toFixed(2),false):'—',
    ...(!operators?[(d.canWriteNotes?'<button class="link" onclick="withdrawNoteOpen('+i+')">'+(noteFor(r,daily?r.dataDate:resultDates().to)? '编辑备注':'+ 添加原因')+'</button>':'')+'<span class="withdraw-note">'+E((d.notes||[]).filter(n=>noteMatches(n,r)&&(!daily||n.date===r.dataDate)).map(n=>n.date+' '+n.reason).join('\n')||'暂无每日备注')+'</span>',
    '<div class="withdraw-row-actions">'+(r.sourceNoteFormat==='lg_business_notes_v1'?'<button class="btn small withdraw-reject-button" data-withdraw-reason="'+i+'-rejection" onclick="withdrawReasons('+i+',\'rejection\')">驳回订单业务备注</button>':duoliNotesRow(r)?'<button type="button" class="btn small" data-withdraw-reason="'+i+'-blocking" onclick="withdrawReasons('+i+',\'blocking\')">源备注</button>':r.reasonAvailable===false?'<span class="muted" data-withdraw-reasons="unavailable" title="当前采集数据未提供自动／人工标识及原因">当前采集未提供原因</span>':'<button class="btn small" data-withdraw-reason="'+i+'-blocking" onclick="withdrawReasons('+i+',\'blocking\')">'+(r.sourceNoteFormat==='game66_withdraw_notes_v1'?'自动出款备注':r.sourceNotesAvailable===true?'风控备注':'自动出款原因')+'</button><button class="btn small withdraw-reject-button" data-withdraw-reason="'+i+'-rejection" onclick="withdrawReasons('+i+',\'rejection\')">'+(r.sourceNoteFormat==='game66_withdraw_notes_v1'?'驳回订单业务备注':r.sourceNotesAvailable===true?'驳回订单备注':'驳回原因')+'</button>')+'<button class="btn small" onclick="withdrawDaily('+i+')">'+(daily?'平台汇总':'日明细')+'</button></div>']:[])];
   const countKeys=operators?['processed','success','rejected']:['total','success','rejected','autoCount','manualCount'];
   const footer=(items,label,totals)=>{
    const a=totals?{...totals}:Object.fromEntries(countKeys.map(k=>{const knownItems=items.filter(r=>countKnown(r,k)),partialKey=['autoCount','manualCount'].includes(k);return [k,knownItems.length&&(partialKey||knownItems.length===items.length)?knownItems.reduce((n,r)=>n+Number(r[k]),0):null]}));
    if(!totals){
     a.classificationAvailable=items.every(r=>r.classificationAvailable!==false);
     a.classificationPartial=items.some(r=>r.classificationPartial===true||!countKnown(r,'autoCount')||!countKnown(r,'manualCount'))&&['autoCount','manualCount'].some(k=>known(a[k]));
     a.unclassifiedCount=items.length&&items.every(r=>known(r.unclassifiedCount))?items.reduce((n,r)=>n+Number(r.unclassifiedCount),0):null;
     const weight=items.filter(r=>known(r.avgSeconds)).map(r=>({row:r,count:known(r.durationSampleCount)?Number(r.durationSampleCount):Number(r[den])})).filter(r=>Number.isFinite(r.count)&&r.count>0);a.durationSampleCount=weight.reduce((n,r)=>n+r.count,0);a.durationTotalSeconds=weight.reduce((n,r)=>n+(known(r.row.durationTotalSeconds)?Number(r.row.durationTotalSeconds):Number(r.row.avgSeconds)*r.count),0);a.avgSeconds=a.durationSampleCount?a.durationTotalSeconds/a.durationSampleCount:null;const bases=new Set(weight.map(r=>r.row.durationBasis||'source_report'));a.durationBasis=bases.size===1?[...bases][0]:'mixed_source_processing';
    }
    a.country='';a.platform=label+(a.classificationPartial===true?'（分类笔数仅已确认）':'');a.account='';const row=cells(a,0);if(!operators){row[row.length-1]='';row[row.length-2]=''}return row;
   };
   body+=box(operators?'操作人表现':'平台出款表现',table(headers,rows.map((row,index)=>cells(row,localReady()?(d.rows||[]).indexOf(row):index)),'withdraw-stat-table'+(daily?' withdraw-daily-table':'')+(operators?' withdraw-operators-table':''),Number(d.total||0)>S.size?[footer(rows,'当前页汇总'),footer([],'全部汇总',t)]:[footer([],'合计',t)])+pagebar(Number(d.total||0),S.page,S.size),
    '按来源当地日期读取，与现有后台使用相同日统计。新AR直传覆盖同平台同日副本；昨日对比不计入当日总计。平均处理用时按有效时间样本加权；WG 使用创建至操作处理时间，缺少或异常时间不计入，不代表支付到账时长。缺少前期记录时不显示涨跌。');
   if(!operators)body+=coveragePanel(d.platformCoverage);
   return controls+'<div id="withdraw-content">'+body+'</div><div id="withdraw-reason-overlay">'+reasonPanel()+'</div>'+noteDialog();
  }
  function noteDialog(){
   if(!S.note&&!S.noteSample)return '';
   if(S.noteSample)return '<div class="live-config-modal-backdrop"><section class="live-config-modal" role="dialog" aria-modal="true" aria-label="每日备注样本"><h2>每日备注样本</h2><p class="config-help">填写当日人工处理占比变化的运营说明。示例：某通道维护，部分自动出款转人工；已与当班负责人核对。请填写已核实的情况。</p><p class="config-help">这里的备注由人员填写；自动出款拦截原因、订单驳回备注分别通过列表中的按钮查看。</p><div class="config-actions"><button class="btn" onclick="withdrawNoteClose()">关闭</button></div></section></div>';
   const n=S.note;
   return '<div class="live-config-modal-backdrop"><section class="live-config-modal" role="dialog" aria-modal="true" aria-label="每日备注"><h2>每日备注</h2><div class="config-context">'+E(identity({country:n.country,name:n.platform}).country)+' · '+E(platformLabel(n))+'</div><form onsubmit="event.preventDefault();withdrawNoteSave()"><label for="withdrawNoteDate">备注日期</label><input id="withdrawNoteDate" type="date" min="'+E(resultDates().from)+'" max="'+E(resultDates().to)+'" value="'+E(n.date)+'" onchange="withdrawNoteDate(this.value)" '+(S.noteSaving?'disabled':'')+'><label for="withdrawNoteText">当日原因 / 运营说明</label><textarea id="withdrawNoteText" rows="6" maxlength="1000" oninput="withdrawNoteInput(this.value)" '+(S.noteSaving?'disabled':'')+'>'+E(S.noteDraft)+'</textarea><p class="config-help">最多 1000 字。只保存该平台、该日期的人工备注；留空保存可清除备注。</p>'+(S.noteError?'<div class="config-message" role="alert">'+E(S.noteError)+'</div>':'')+'<div class="config-actions"><button type="button" class="btn" onclick="withdrawNoteClose()" '+(S.noteSaving?'disabled':'')+'>取消</button><button class="btn primary" '+(S.noteSaving?'disabled':'')+'>'+(S.noteSaving?'保存中…':'保存备注')+'</button></div></form></section></div>';
  }
  const reasonFocus=()=>document.getElementById('withdraw-reasons')?.focus?.({preventScroll:true});
  // Detail interactions must leave the platform table (and its scroll container)
  // mounted. A full-page paint resets its horizontal scroll and scroll anchor.
  function renderReason(preserveBody=false){
   const host=document.getElementById('withdraw-reason-overlay');
   if(!host){render();return}
   const body=preserveBody?host.querySelector?.('.withdraw-drawer-body'):null,position=body?{left:body.scrollLeft,top:body.scrollTop}:null;
   const x=root.scrollX,y=root.scrollY;
   host.innerHTML=reasonPanel();
   const next=position?host.querySelector?.('.withdraw-drawer-body'):null;
   if(next){next.scrollLeft=position.left;next.scrollTop=position.top}
   if(Number.isFinite(x)&&Number.isFinite(y)&&(root.scrollX!==x||root.scrollY!==y))root.scrollTo?.(x,y);
  }
  function rememberReasonSnapshot(scope,query,data){
   // Only a proven complete result may be sliced locally. Source coverage is a
   // separate fact: this does not claim that every upstream order was collected.
   const total=data?.total;
   if(data?.available===true&&!data.error&&data.hasMore!==true&&data.partial!==true&&data.complete!==false&&query.offset===0&&total!==null&&total!==undefined&&total!==''&&typeof total!=='boolean'&&Number.isSafeInteger(Number(total))&&Number(total)>=0&&Array.isArray(data.rows)&&data.rows.length===Number(total))reasonSnapshot={scope,data};
  }
  async function reasonsLoad(force=false,presentationOnly=false){
   if(!resultAllowed()||!S.reason)return;const base={action:'withdrawReasons',...S.reason,platform:rowPlatform(S.reason)},scope=JSON.stringify(base),query={...base,offset:(S.reasonPage-1)*S.reasonSize,limit:S.reasonSize},key=JSON.stringify(query),cached=reasonCache.get(key),serial=++S.reasonSerial;
   S.reasonError='';
   // Changing page size is a presentation change, not a refresh. Keep the
   // displayed snapshot even past its request-cache TTL; explicit retry still
   // fetches fresh data, and every date/platform/filter has a different scope.
   if(!force&&presentationOnly&&reasonSnapshot?.scope===scope){const data=reasonSnapshot.data;S.reasonPage=Math.min(S.reasonPage,Math.max(1,Math.ceil(Number(data.total)/S.reasonSize)));const offset=(S.reasonPage-1)*S.reasonSize;S.reasonData={...data,rows:data.rows.slice(offset,offset+S.reasonSize),offset,limit:S.reasonSize};S.reasonBusy=false;renderReason(true);reasonFocus();return}
   reasonSnapshot=null;
   if(force)for(const [cacheKey,value] of reasonCache)if(value.scope===scope)reasonCache.delete(cacheKey);
   if(!force&&cached&&Date.now()-cached.time<60000){S.reasonData=cached.data;rememberReasonSnapshot(scope,query,cached.data);S.reasonBusy=false;renderReason();reasonFocus();return}
   S.reasonBusy=true;renderReason();reasonFocus();
   try{const data=await request(query);if(serial!==S.reasonSerial||!resultAllowed())return;const max=Math.max(1,Math.ceil(Number(data.total||0)/S.reasonSize));if(S.reasonPage>max){S.reasonPage=max;return reasonsLoad(force)}reasonCache.set(key,{data,scope,time:Date.now()});if(reasonCache.size>30)reasonCache.delete(reasonCache.keys().next().value);rememberReasonSnapshot(scope,query,data);S.reasonData=data;S.reasonBusy=false;renderReason();reasonFocus()}
   catch(e){if(serial!==S.reasonSerial)return;S.reasonError=e.message;S.reasonBusy=false;S.reasonData=null;renderReason();reasonFocus()}
  }
  // The host iframe intentionally omits allow-forms. Direct actions must not
  // depend on native submit; Enter in text/date inputs follows the same path.
  const queryEnter=event=>event.key==='Enter'&&!event.repeat&&!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229&&event.target?.tagName==='INPUT'&&!['checkbox','radio','button','submit'].includes(event.target.type);
  root.withdrawQueryForm=form=>{if(form?.reportValidity?.()===false)return;if(form?.elements?.from&&form?.elements?.to){L.from=form.elements.from.value+'T00:00:00';L.to=form.elements.to.value+'T23:59:59'}return load(true)};
  root.withdrawFilterKey=event=>{if(!queryEnter(event))return;event.preventDefault();return root.withdrawQueryForm(event.target.form)};
  root.withdrawReasonQueryKey=event=>{if(!queryEnter(event))return;event.preventDefault();return root.withdrawReasonSearch()};
  root.withdrawLoad=load;root.autoWithdrawLoad=load;
  root.withdrawHistorical=value=>{if(!['current','historical'].includes(value)||value==='historical'&&!baseScopeCatalog().some(historicalRow))return;S.historical=value==='historical';S.platforms=[];S.rowCountry='';S.search='';S.error='';invalidate();render()};
  function selectionChanged(){S.historical=false;L.multi=L.multi||{};L.multi.platform=[];L.platform='all';L.multi.source=[];L.source='all';L.multi.provider=[];L.provider='';L.dirty=true;S.platforms=[];S.rowCountry='';S.search='';invalidate();render()}
  root.withdrawTeam=team=>{if(['__team_pending__','__team_conflict__','归属待核对'].includes(team))return;if(team!=='all'&&!catalog().some(p=>p.team===team))return;L.multi=L.multi||{};L.multi.team=team==='all'?[]:[team];L.team=team;const countries=[...new Set(catalog().filter(p=>team==='all'||p.team===team).map(p=>p.country))];L.country=countries.includes(displayCountry())?displayCountry():countries[0]||'';selectionChanged()};
  root.withdrawCountry=c=>{const selected=identity({country:c}),legacy=isPanghuCountry(c)||['香港','红膏蟹'].includes(c);if(!catalog().some(p=>p.country===selected.country&&(!activeTeams().length||activeTeams().includes(p.team)||legacy)))return;L.country=selected.country;if(legacy){L.multi=L.multi||{};L.multi.team=[selected.team];L.team=selected.team}selectionChanged()};
  root.withdrawDate=(key,value)=>{if(!['from','to'].includes(key)||!/^\d{4}-\d{2}-\d{2}$/.test(value))return;L[key]=value+(key==='from'?'T00:00:00':'T23:59:59');invalidate();render()};
  root.withdrawAccount=value=>{S.account=String(value).slice(0,200);invalidate();render()};
  root.withdrawMultiOpen=(_key,open)=>{S.open=!!open};
  root.withdrawMultiToggle=element=>{S.open=element.open};
  root.withdrawSetMultiOption=(_key,input)=>{S.rowCountry='';S.platforms=input.checked?[...new Set([...S.platforms,input.value])]:S.platforms.filter(v=>v!==input.value);invalidate();render()};
  root.withdrawMultiClear=()=>{S.platforms=[];S.rowCountry='';S.open=false;S.search='';invalidate();render()};
  root.withdrawMultiAll=(_key,checked)=>{S.rowCountry='';S.platforms=checked?[...document.querySelectorAll('[data-multi="withdrawPlatform"] .live-multi-option')].filter(n=>!n.hidden).map(n=>n.querySelector('input').value):[];invalidate();render()};
  root.withdrawMultiSearch=(_key,value)=>{S.search=String(value??'').slice(0,200);const query=S.search.trim().toLocaleLowerCase();const rootNode=document.querySelector('[data-multi="withdrawPlatform"]');if(!rootNode)return;let visible=0;rootNode.querySelectorAll('.live-multi-option').forEach(n=>{const hay=String(n.dataset.search||n.textContent||'').toLocaleLowerCase();const show=!query||hay.includes(query);n.hidden=!show;if(show)visible++});const empty=rootNode.querySelector('.live-multi-empty');if(empty){empty.hidden=visible>0;empty.textContent=visible?'':'没有匹配选项'}};
  root.withdrawMultiClose=()=>{S.open=false;render()};
  root.withdrawReset=()=>{S.historical=false;S.platforms=[];S.rowCountry='';S.account='';S.daily=false;root.withdrawPeriod('yesterday')};
  root.withdrawShift=n=>{L.from=addDay(L.from.slice(0,10),n)+'T00:00:00';L.to=addDay(L.to.slice(0,10),n)+'T23:59:59';invalidate();render()};
  root.withdrawPeriod=key=>{const zone=scopeCatalog().find(p=>p.timezone)?.timezone||(displayCountry()==='巴西'?'America/Sao_Paulo':'Asia/Kolkata'),today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());let start=today,end=today;if(key==='yesterday')start=end=addDay(today,-1);if(key==='before')start=end=addDay(today,-2);if(key==='week'||key==='lastweek'){const day=new Date(today+'T00:00:00Z').getUTCDay();start=addDay(today,-((day+6)%7));if(key==='lastweek'){end=addDay(start,-1);start=addDay(start,-7)}}if(key==='month')start=today.slice(0,8)+'01';if(key==='lastmonth'){end=addDay(today.slice(0,8)+'01',-1);start=end.slice(0,8)+'01'}L.from=start+'T00:00:00';L.to=end+'T23:59:59';invalidate();render()};
  function readApplied(reset=false){if(!resultAllowed()||!S.applied)return load(reset);const query={...S.applied.query,sort:S.sort,ascending:S.asc,offset:reset?0:(S.page-1)*S.size,limit:S.size};return load(reset,{query,applied:S.applied});}
  root.withdrawPage=page=>{if(!Number.isInteger(page)||page<1)return;if(!localReady()&&S.data&&draftChanged()){render();return;}S.page=page;if(localReady()){S.page=Math.min(page,Math.max(1,Math.ceil(S.data.rows.length/S.size)));renderLocal();}else if(!draftChanged()&&S.data&&!S.loading)readApplied();else render()};
  root.withdrawSize=size=>{if(![20,30,50,100,500].includes(Number(size)))return;if(!localReady()&&S.data&&draftChanged()){render();return;}S.size=Number(size);S.page=1;if(localReady()||S.loading&&view()==='auto'&&!S.daily&&!S.serverPaging)renderLocal();else if(!draftChanged()&&S.data)readApplied(true);else render()};
  root.withdrawSort=key=>{if(!['country','platform','account','total','processed','success','rejected','autoCount','manualCount','avgSeconds','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange'].includes(key))return;if(!localReady()&&S.data&&draftChanged()){render();return;}S.asc=S.sort===key?!S.asc:false;S.sort=key;S.page=1;if(localReady()||S.loading&&view()==='auto'&&!S.daily&&!S.serverPaging)renderLocal();else if(!draftChanged()&&S.data)readApplied(true);else render()};
  root.withdrawDaily=index=>{if(!resultAllowed())return;const row=S.data?.rows?.[index];if(!row)return;if(S.applied){const daily=!resultDaily(),query={...S.applied.query,country:rawTarget(row),platforms:[rowPlatform(row)],daily,sort:'total',ascending:false,offset:0,limit:daily?S.size:500};delete query.scopeTargets;load(true,{query,applied:{...S.applied,platforms:[platformLabel(row)],rowCountry:rawTarget(row)}});return;}S.platforms=[platformLabel(row)];S.rowCountry=rawTarget(row);S.daily=!S.daily;S.localSnapshot=false;S.serverPaging=false;load(true)};
  function clearReasonFilters(){if(!S.reason)return;for(const key of ['category','reasonKey','operatorKey','query'])delete S.reason[key];S.reasonLabel='';S.reasonQuery='';S.reasonPage=1}
  root.withdrawReasons=(index,kind='blocking')=>{if(!resultAllowed())return;const row=S.data?.rows?.[index];if(!row||row.reasonAvailable===false&&!duoliNotesRow(row)||!['blocking','rejection'].includes(kind))return;S.reason={country:row.country,platform:rowPlatform(row),date:resultDaily()?row.dataDate:resultDates().from,kind:kind==='rejection'?'categories':kind};S.reasonTrigger={index,kind};S.reasonData=null;clearReasonFilters();reasonsLoad()};
  root.withdrawReasonKind=kind=>{if(!S.reason||!['blocking','categories','rejection','operators','orders'].includes(kind))return;if(kind==='blocking'||kind==='categories'||blockingKinds.includes(S.reason.kind))clearReasonFilters();S.reason.kind=kind;S.reasonPage=1;reasonsLoad()};
  root.withdrawReasonDate=date=>{if(!S.reason||!/^\d{4}-\d{2}-\d{2}$/.test(date))return;S.reason.date=date;if(blockingKinds.includes(S.reason.kind))S.reason.kind='blocking';clearReasonFilters();S.reasonData=null;reasonsLoad()};
  root.withdrawReasonClear=()=>{if(blockingKinds.includes(S.reason?.kind))S.reason.kind='blocking';clearReasonFilters();reasonsLoad()};
  root.withdrawReasonDrill=(index,key)=>{const row=S.reasonData?.rows?.[index];if(!S.reason||!row||S.reasonData.canViewOrders===false||!['category','reason','operator'].includes(key))return;const field={category:'category',reason:'reasonKey',operator:'operatorKey'}[key],value=row[{category:'categoryKey',reason:'reasonKey',operator:'operatorKey'}[key]];if(!/^[a-f0-9]{32}$/.test(value||''))return;S.reason[field]=value;S.reasonLabel=[S.reasonLabel,key==='operator'?row.operator||'源账号为空':row.sourceReason??row.rawReason??row[{category:'category',reason:'reason'}[key]]??'（源备注为空）'].filter(Boolean).join(' · ');S.reason.kind='orders';S.reasonPage=1;reasonsLoad()};
  root.withdrawBlockingDrill=(index,kind)=>{const row=S.reasonData?.rows?.[index];if(!row||!S.reason||!['blockingVariants','blockingOrders'].includes(kind)||!/^[a-f0-9]{32}$/.test(row.reasonKey||'')||kind==='blockingOrders'&&S.reasonData.canViewBlockingOrders!==true)return;clearReasonFilters();S.reason.reasonKey=row.reasonKey;S.reasonLabel=blockingReasonLabel(row.reason,row);S.reason.kind=kind;reasonsLoad()};
  root.withdrawBlockingView=kind=>{if(!S.reason||!['blockingVariants','blockingOrders'].includes(kind)||!/^[a-f0-9]{32}$/.test(S.reason.reasonKey||'')||kind==='blockingOrders'&&S.reasonData?.canViewBlockingOrders!==true)return;S.reason.kind=kind;delete S.reason.query;S.reasonQuery='';S.reasonPage=1;reasonsLoad()};
  root.withdrawReasonVariants=index=>{const row=S.reasonData?.rows?.[index];if(!S.reason||!row||!/^[a-f0-9]{32}$/.test(row.categoryKey||''))return;S.reason.category=row.categoryKey;S.reasonLabel=row.sourceReason??row.reason??row.category??'（源备注为空）';S.reason.kind='rejection';S.reasonPage=1;reasonsLoad()};
  root.withdrawReasonQuery=value=>{S.reasonQuery=String(value).slice(0,200)};
  root.withdrawReasonSearch=()=>{if(!S.reason)return;S.reason.query=S.reasonQuery.trim();S.reasonPage=1;reasonsLoad()};
  root.withdrawReasonPage=page=>{if(S.reasonBusy||!Number.isInteger(page)||page<1)return;const max=Math.max(1,Math.ceil(Number(S.reasonData?.total||0)/S.reasonSize)),next=Math.min(max,page);if(next===S.reasonPage)return;S.reasonPage=next;reasonsLoad(false,true)};
  root.withdrawReasonSize=size=>{if(S.reasonBusy||![20,50,100].includes(Number(size))||S.reasonSize===Number(size))return;S.reasonSize=Number(size);S.reasonPage=1;reasonsLoad(false,true)};
  root.withdrawReasonJump=value=>{if(/^\d+$/.test(String(value)))root.withdrawReasonPage(Number(value))};
  root.withdrawReasonOriginal=(value,title='驳回原文',exact=false)=>{S.originalNote=exact?String(value??''):cleanNote(value);S.originalNoteTitle=String(title||'驳回原文');renderReason(true);document.querySelector?.('.withdraw-original-dialog')?.querySelector('button')?.focus?.({preventScroll:true})};
  root.withdrawReasonOriginalClose=()=>{S.originalNote='';renderReason(true);reasonFocus()};
  root.withdrawReasonClose=()=>{const trigger=S.reasonTrigger;reasonSnapshot=null;S.reasonSerial++;S.reason=null;S.reasonData=null;S.originalNote='';renderReason();if(trigger)document.querySelector?.('[data-withdraw-reason="'+trigger.index+'-'+trigger.kind+'"]')?.focus?.({preventScroll:true})};root.withdrawReasonRetry=()=>reasonsLoad(true);
  root.withdrawReasonKey=event=>{if(event.key==='Escape'){event.preventDefault();root.withdrawReasonClose();return}if(event.key!=='Tab')return;const panel=document.getElementById('withdraw-reasons'),items=[...(panel?.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')||[])].filter(e=>e.getClientRects().length);const first=items[0],last=items[items.length-1];if(!first)return;if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel)){event.preventDefault();first.focus()}};
  function setNote(row,date){const previous=noteFor(row,date);S.note={country:row.country,platform:row.platform,date,storageCountry:previous?.country||row.country,storagePlatform:previous?.platform||row.platform,expectedVersion:previous?.version||'',original:previous?.reason||''};S.noteDraft=S.note.original;S.noteError='';S.noteSaving=false;render()}
  root.withdrawNoteOpen=index=>{if(!resultAllowed())return;const row=S.data?.rows?.[index];if(row&&S.data?.canWriteNotes)setNote(row,resultDaily()?row.dataDate:resultDates().to)};
  root.withdrawNoteInput=value=>{S.noteDraft=String(value).slice(0,1000)};
  root.withdrawNoteDate=date=>{if(!resultAllowed()||!S.note||S.noteSaving||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<resultDates().from||date>resultDates().to)return;if(S.noteDraft!==S.note.original){S.noteError='当前输入未保存，请先保存或取消后再更换日期。';render();return}setNote(S.note,date)};
  root.withdrawNoteSample=()=>{S.noteSample=true;render()};
  root.withdrawNoteClose=()=>{if(S.noteSaving)return;S.note=null;S.noteSample=false;S.noteError='';render()};
  root.withdrawNoteSave=async()=>{if(!resultAllowed()||!S.note||S.noteSaving||!S.data?.canWriteNotes)return;const target=S.note;S.noteSaving=true;S.noteError='';render();try{const saved=await request({action:'withdrawNote',date:target.date,country:target.storageCountry||target.country,platform:target.storagePlatform,reason:S.noteDraft,expectedVersion:target.expectedVersion});if(!resultAllowed()||S.note!==target)return;S.data.notes=[...(S.data.notes||[]).filter(n=>!(n.date===saved.date&&n.country===saved.country&&n.platform===saved.platform)),{...saved,sourceCountry:target.country}];S.noteSaving=false;S.note=null;render()}catch(e){if(!resultAllowed()||S.note!==target)return;S.noteSaving=false;S.noteError=e.message||'备注保存失败，输入已保留';render()}};
  function capture(){return {...S,platforms:S.platforms.slice(),reasonTrigger:null,loading:false,reasonBusy:false,error:S.loading?'读取已暂停，点击查询继续':S.error,reasonError:S.reasonBusy?'明细读取已暂停，点击重试继续':S.reasonError};}
  function pause(){reasonSnapshot=null;S.serial++;stopRead();S.reasonSerial++;setLoading(false);S.reasonBusy=false;reasonCache.clear();}
  function restore(saved){pause();const serial=S.serial,reasonSerial=S.reasonSerial;for(const key of Object.keys(S))delete S[key];Object.assign(S,saved||initialState,{serial,reasonSerial,platforms:(saved?.platforms||[]).slice(),reasonTrigger:null,loading:false,reasonBusy:false});}
  return {capture,pause,restore,render:draw,load,state:S,query,cancel:clearResult};
 }};
 if(typeof module!=='undefined')module.exports={addDay,duration,cleanNote,decodeNote};
})(typeof window!=='undefined'?window:globalThis);
