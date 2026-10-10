(function(root){
 'use strict';
  // Query buttons must work in the read-only iframe without native form submission.
  function readQuery(form,event,run){
   if(event){const input=event.target;if(event.defaultPrevented||event.key!=='Enter'||event.isComposing||event.keyCode===229||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||input?.tagName!=='INPUT'||input.isContentEditable||!['text','search','number','date','datetime-local','time','email','url','tel'].includes(input.type||'text'))return false;event.preventDefault();}
   if(!form||typeof form.reportValidity!=='function'||!form.reportValidity())return false;
   return run();
  }
 root.HensemLiveConfiguration={create(ctx){
  const {L,E,C,metric,box,table,pager,request,render,changed}=ctx;
  let dialog=null,saving=false,generation=0,permissionPending=null,disposed=false;
  const active=()=>!disposed&&(!ctx.page||['provider_config','teams','platform_systems'].includes(ctx.page()));
  const current=(token,page)=>token===generation&&active()&&(!ctx.page||ctx.page()===page);
  function dismiss(){dialog=null;document.getElementById('liveConfigDialog')?.remove()}
  function pause(){if(saving)return false;generation++;permissionPending=null;dismiss();return true}
  function dispose(){disposed=true;generation++;permissionPending=null;dismiss();root.removeEventListener?.('pagehide',onPageHide)}
  function onPageHide(event){if(event.persisted!==true)dispose();else pause()}
  root.addEventListener?.('pagehide',onPageHide);
  root.configQuery=(form,event,kind)=>{if(!['provider','platform'].includes(kind))return false;return readQuery(form,event,()=>{if(kind==='provider'){if(!L.providerConfigLoading)return root.providerConfigLoad(true);}else if(!L.platformAssignmentsLoading)return root.platformAssignmentsLoad(true);});};
  const field=(key,label,value,placeholder='')=>'<div class="live-field"><label for="'+key+'">'+label+'</label><input id="'+key+'" value="'+E(value)+'" placeholder="'+E(placeholder)+'" maxlength="200" oninput="'+(key.startsWith('providerConfig')?'providerConfigSet':'platformAssignmentsSet')+'(\''+key+'\',this.value)"></div>';
  const select=(key,label,value,items)=>'<div class="live-field"><label for="'+key+'">'+label+'</label><select id="'+key+'" onchange="'+(key.startsWith('providerConfig')?'providerConfigSet':'platformAssignmentsSet')+'(\''+key+'\',this.value)">'+items.map(([id,text])=>'<option value="'+E(id)+'" '+(id===value?'selected':'')+'>'+E(text)+'</option>').join('')+'</select></div>';
  const notice=(loading,error)=>loading?'<div class="live-status">正在刷新归类目录…</div>':error?'<div class="live-status live-error">'+E(error)+'</div>':'';
  const permission=result=>'<div class="config-help">'+(result.canManage?'可编辑当前授权范围的归类。':'当前账号可查看归类；编辑需由总管理员授权。')+(result.canGrant?' <button class="link" onclick="configPermissions()">管理归类权限</button>':'')+'</div>';
  const sourceCount=n=>n==null||n===''||typeof n==='boolean'||!Number.isSafeInteger(Number(n))||Number(n)<0?'—':C(n);
  function providerView(){
   const result=L.providerConfig||{},rows=result.rows||[],opts=result.options||{},sum=result.summary||{};
   const countries=[...new Set([L.country,...(opts.countries||[])].filter(Boolean))];
   const form='<section class="panel"><form class="live-filters" onsubmit="return false" onkeydown="configQuery(this,event,\'provider\')">'+
    select('providerConfigCountry','国家 / 地区',L.providerConfigCountry,countries.map(c=>[c,c]))+
    select('providerConfigPlatform','平台',L.providerConfigPlatform,[['all','全部平台'],...(opts.platforms||[]).map(p=>[p,p])])+
    field('providerConfigRaw','原始三方',L.providerConfigRaw,'搜索原始通道名称')+field('providerConfigCanonical','统一三方',L.providerConfigCanonical,'搜索已归类名称')+
    select('providerConfigStatus','归类状态',L.providerConfigStatus,[['all','全部状态'],['assigned','已归类'],['unassigned','未归类'],['conflict','归类冲突']])+
    '<div class="live-actions"><button type="button" class="btn primary" onclick="configQuery(this.form,null,\'provider\')">查询</button><button class="btn" type="button" onclick="providerConfigReset()">重置</button></div></form></section>';
   return form+notice(L.providerConfigLoading,L.providerConfigError)+permission(result)+'<div class="live-metrics">'+
    metric('原始通道',C(sum.rawProviders))+metric('已归类',C(sum.assigned))+metric('未归类',C(sum.unassigned))+metric('归类冲突',C(sum.conflict))+'</div>'+
    box('三方归类',table(['原始通道','统一三方','历史归类','国家','平台','代收笔数','代付笔数','合计笔数','状态','最后数据日','操作'],rows.map((r,i)=>[
     E(r.rawProvider||'（原始通道为空）'),E(r.canonicalProvider||'未归类'),E((r.canonicalProviders||[]).join(' / ')||'—'),E(r.country),E(r.platform),
     sourceCount(r.chargeCount),sourceCount(r.withdrawCount),sourceCount(r.matchedCount),E(r.manual?'手动归类':({assigned:'已归类',unassigned:'未归类',conflict:'归类冲突'})[r.status]||'未归类'),E(r.lastDataDate||'—'),
     result.canManage?'<button class="btn small" onclick="configEditProvider('+i+')">归类</button>':'<span class="muted">只读</span>'
    ]))+pager(Number(result.total||0),L.providerConfigPage,L.providerConfigSize,'provider-config'),
    '沿用已有历史归类；手动归类优先并即时生效。历史目录每 5 分钟更新，笔数为历史覆盖量。原始通道为空的记录保留待确认。');
  }
  const platformScope=request=>['team','country','system','platform','status'].map(key=>{const value=request?.[key];return value==null||value==='all'?'':String(value)});
  const platformDraft=()=>({team:L.teamPlatformTeam,country:L.teamPlatformCountry,system:L.teamPlatformSystem,platform:L.teamPlatformQuery,status:L.teamPlatformStatus});
  const platformScopeLabel=request=>{const [team,country,system,platform,status]=platformScope(request);return [country||'全部国家 / 地区',team||'全部团队',system||'全部系统',platform?'平台：'+platform:'',({mapped:'已配置有数据',no_data:'配置暂无数据',unmapped:'待归类平台'})[status]||''].filter(Boolean).map(E).join(' · ')};
  function platformResults(){
   const result=L.platformAssignments,scope=platformDraft(),applied=L.platformAssignmentsAppliedRequest;
   const dirty=L.platformAssignmentsDirty||!applied||JSON.stringify(platformScope(scope))!==JSON.stringify(platformScope(applied));
   const queryButton='<button type="button" class="btn primary" onclick="platformAssignmentsLoad(true)">查询</button>';
   if(L.platformAssignmentsLoading)return '<div class="live-status" role="status">正在查询：'+platformScopeLabel(scope)+'…</div>';
   if(L.platformAssignmentsError)return '<div class="live-status live-error" role="status">'+E(L.platformAssignmentsError)+' <button type="button" class="btn" onclick="platformAssignmentsLoad(true)">重试</button></div>';
   if(dirty||!result)return '<div class="live-status config-query-prompt" role="status"><span>筛选条件已修改，请查询对应归属。</span>'+queryButton+'</div>';
   const rows=result.rows||[],sum=result.summary||{};
   return '<div class="config-query-scope">已查询：'+platformScopeLabel(applied)+'</div>'+permission(result)+'<div class="live-metrics">'+
    metric('配置平台',C(sum.mappings))+metric('已配置有数据',C(sum.mapped))+metric('配置暂无数据',C(sum.noData))+metric('待归类平台',C(sum.unmapped))+'</div>'+
    box('团队 / 平台 / 包网系统归属',table(['团队','包网系统','国家','平台','来源系统','代收笔数','代付笔数','合计笔数','状态','最后数据日','操作'],rows.map((r,i)=>[
     E(r.team||'待配置'),E(r.system||'待配置'),E(r.country||r.sourceCountry),E(r.platform||r.sourcePlatform),E(r.sourceSystem),C(r.chargeCount),C(r.withdrawCount),C(r.matchedCount),
     E(({mapped:'已配置 · 有数据',no_data:'已配置 · 暂无数据',unmapped:'待归类'})[r.status]),E(r.lastDataDate||'—'),
     result.canManage?'<button class="btn small" onclick="configEditPlatform('+i+')">'+(r.mapped?'修改归属':'归类')+'</button>':'<span class="muted">只读</span>'
    ]))+pager(Number(result.total||0),L.platformAssignmentsPage,L.platformAssignmentsSize,'platform-assignments'),
    '归属修改保存到正式配置，并同步更新筛选目录；原始平台标识保留。');
  }
  function platformChanged(){const host=document.getElementById('platformAssignmentResults');if(host)host.innerHTML=platformResults()}
  function platformView(){
   const result=L.platformAssignments||{},opts=result.options||{};
   const choices=(current,empty,items)=>[['all',empty],...[...new Set([current,...(items||[])].filter(v=>v&&v!=='all'))].map(v=>[v,v])];
   const form='<section class="panel"><form class="live-filters config-platform-filters" onsubmit="return false" onkeydown="configQuery(this,event,\'platform\')">'+
    select('teamPlatformTeam','所属团队',L.teamPlatformTeam,choices(L.teamPlatformTeam,'全部团队',opts.teams))+
    select('teamPlatformCountry','国家 / 地区',L.teamPlatformCountry,choices(L.teamPlatformCountry,'全部国家 / 地区',opts.countries))+
    select('teamPlatformSystem','包网系统',L.teamPlatformSystem,choices(L.teamPlatformSystem,'全部系统',opts.systems))+
    field('teamPlatformQuery','平台',L.teamPlatformQuery,'搜索平台名称')+
    select('teamPlatformStatus','配置状态',L.teamPlatformStatus,[['all','全部状态'],['mapped','已配置有数据'],['no_data','配置暂无数据'],['unmapped','待归类平台']])+
    '<div class="live-actions"><button class="btn primary" type="button" onclick="configQuery(this.form,null,\'platform\')">查询</button><button class="btn" type="button" onclick="platformAssignmentsReset()">重置</button></div></form></section>';
   return form+'<div id="platformAssignmentResults" aria-live="polite">'+platformResults()+'</div>';
  }
  function modal(title,body){
   document.getElementById('liveConfigDialog')?.remove();
   const div=document.createElement('div');div.id='liveConfigDialog';div.className='live-config-modal-backdrop';
   div.innerHTML='<section class="live-config-modal" role="dialog" aria-modal="true" aria-label="'+E(title)+'"><h2>'+E(title)+'</h2><form onsubmit="event.preventDefault();configSave()">'+body+
    '<div class="config-message" role="status"></div><div class="config-actions"><button type="button" class="btn" onclick="configClose()">取消</button><button class="btn primary" type="submit">保存</button></div></form></section>';
   document.body.appendChild(div);div.querySelector('input,select,button')?.focus();
  }
  const editInput=(key,label,value,list)=>'<label for="config-'+key+'">'+label+'</label><input id="config-'+key+'" name="'+key+'" value="'+E(value||'')+'" maxlength="200" required '+(list?'list="config-list-'+key+'"':'')+'>'+(list?'<datalist id="config-list-'+key+'">'+list.map(v=>'<option value="'+E(v)+'">').join('')+'</datalist>':'');
  root.configEditProvider=function(index){
   const row=L.providerConfig?.rows?.[index];if(!active()||ctx.page&&ctx.page()!=='provider_config'||saving||!row||!L.providerConfig.canManage)return;
   generation++;permissionPending=null;
   dialog={type:'provider',row};
   modal('三方归类','<div class="config-context">国家：'+E(row.country)+'<br>平台：'+E(row.platform)+'<br>原始通道：'+E(row.rawProvider||'（为空）')+
    '<br>覆盖历史记录：'+sourceCount(row.matchedCount)+' 笔</div>'+editInput('canonicalProvider','归类到统一三方',row.canonicalProvider,L.providerConfig.options?.canonicalProviders||[])+
    '<p class="config-help">同一国家、平台、原始通道共用归类。'+(!row.rawProvider?'此处原始通道为空，请先确认这些订单确实属于同一三方。':'')+'</p>');
  };
  root.configEditPlatform=function(index){
   const row=L.platformAssignments?.rows?.[index],opts=L.platformAssignments?.options||{};if(!active()||ctx.page&&!['teams','platform_systems'].includes(ctx.page())||saving||!row||!L.platformAssignments.canManage)return;
   generation++;permissionPending=null;
   const countries=opts.countryChoices||[];dialog={type:'platform',row,countries};
   modal('团队 / 平台归属','<div class="config-context">原始国家：'+E(row.sourceCountry)+'<br>原始平台：'+E(row.sourcePlatform)+'</div>'+
    editInput('team','所属团队',row.team,opts.teams)+editInput('system','包网系统名称',row.system,opts.systems)+editInput('platformName','平台显示名称',row.platform||row.sourcePlatform)+
    '<label for="config-country">国家 / 地区</label><select id="config-country" required '+(row.mapped?'disabled':'')+'><option value="">请选择国家</option>'+countries.map((c,i)=>'<option value="'+i+'" '+(c.code===row.countryCode||c.country===row.sourceCountry?'selected':'')+'>'+E(c.country)+' · '+E(c.code)+'</option>').join('')+'</select>'+
    '<label for="config-sourceSystem">来源系统</label><select id="config-sourceSystem" '+(row.mapped?'disabled':'required')+'>'+(!row.mapped?'<option value="">请选择已核实的来源系统</option>':'')+(opts.sourceSystems||[]).map(v=>'<option value="'+E(v)+'" '+(v===row.sourceSystem?'selected':'')+'>'+E(v)+'</option>').join('')+'</select>');
  };
  root.configPermissions=function(){
   if(!active()||saving)return Promise.resolve();if(permissionPending)return permissionPending;
   const token=++generation,page=ctx.page?.();
   permissionPending=Promise.resolve().then(async()=>{
    try{const result=await request({action:'configurationAccess'});if(!current(token,page))return;dialog={type:'grant',rows:result.rows||[]};
     modal('管理员归类权限','<p class="config-help">仅控制三方和团队／平台归类。管理员还需拥有新版后台访问权限，且只能修改其数据授权范围。</p>'+dialog.rows.map((r,i)=>
      '<div class="config-grant-row"><label for="config-grant-'+i+'">'+E(r.username)+(r.canView?'':'（尚未获新版访问权限）')+'</label><input id="config-grant-'+i+'" type="checkbox" '+(r.canManage?'checked':'')+'></div>').join(''));
    }catch(e){if(!current(token,page))return;L[page==='teams'||page==='platform_systems'?'platformAssignmentsError':'providerConfigError']=e.message;render()}
    finally{if(token===generation)permissionPending=null}
   });return permissionPending;
  };
  root.configClose=pause;
  root.configSave=async function(){
   if(!active()||saving||!dialog)return;const host=document.getElementById('liveConfigDialog'),d=dialog;if(!host){pause();return}
   const token=++generation,page=ctx.page?.();permissionPending=null;let written=false;
   const value=id=>host.querySelector('#config-'+id)?.value.trim()||'';
   saving=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);host.querySelector('.config-message').textContent='正在保存…';
   try{
    if(d.type==='grant'){
     for(let i=0;i<d.rows.length;i++){const enabled=host.querySelector('#config-grant-'+i).checked;if(enabled!==d.rows[i].canManage){await request({action:'configurationWrite',operation:'grant',userId:d.rows[i].userId,canManage:enabled});if(!current(token,page))return;d.rows[i].canManage=enabled}}
    }else if(d.type==='provider')await request({action:'configurationWrite',operation:'provider',country:d.row.country,platform:d.row.platform,rawProvider:d.row.rawProvider||'',canonicalProvider:value('canonicalProvider'),expectedVersion:d.row.version});
    else{
     const selectedCountry=value('country'),country=selectedCountry===''?null:d.countries[Number(selectedCountry)];if(!country)throw Error('请选择国家');
     await request({action:'configurationWrite',operation:'platform',...(d.row.mapped?{mappingId:d.row.id}:{}),team:value('team'),system:value('system'),platformName:value('platformName'),country:country.country,countryCode:country.code,
      sourceSystem:d.row.mapped?d.row.sourceSystem:value('sourceSystem'),sourceCountry:d.row.sourceCountry,sourcePlatform:d.row.sourcePlatform,expectedVersion:d.row.version});
    }
    if(!current(token,page))return;written=true;dismiss();await changed(d.type);
   }catch(e){if(!current(token,page))return;if(written){L[page==='teams'||page==='platform_systems'?'platformAssignmentsError':'providerConfigError']='已保存，目录刷新未完成，请查询更新：'+(e.message||'读取失败');render()}else if(document.getElementById('liveConfigDialog')===host&&dialog===d){host.querySelector('.config-message').textContent=e.message||'保存未完成';host.querySelectorAll('button').forEach(b=>b.disabled=false)}}
   finally{saving=false}
  };
  return {providerView,platformView,platformChanged,pause,isSaving:()=>saving,dispose};
 }};
})(typeof window!=='undefined'?window:globalThis);
