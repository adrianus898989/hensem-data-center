/* Existing local collectors register allowlisted tasks. No paths or secrets are accepted here. */
(function(root){
 'use strict';
 const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
 const taskId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
 const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=80&&!/[\u0000-\u001f\u007f]/.test(value);
 const date=value=>value===null||typeof value==='string'&&Number.isFinite(Date.parse(value));
 const states={stopped:'已停止',starting:'启动中',running:'进程运行中',stopping:'正在请求停止',failed:'启动或运行失败',blocked:'需要处理',external_running:'已有外部进程',unavailable:'本机未注册'};
 const detailLabels={ok:'',starting:'等待进程启动',stopped:'已停止',stop_requested:'正在请求停止',spawn_failed:'启动失败，请检查本机配置',exited:'进程已退出',restart_backoff:'等待重试',restart_limit:'重复失败，已暂停重启',stop_timeout:'进程尚未退出，未强制结束',local_lock:'本机任务锁被占用，请核对旧进程',external_running:'请先核对手动启动的旧进程',unavailable:'本机暂无法确认任务，请检查配置与进程权限',config_invalid:'请检查本机任务配置',manager_restarted:'管理器已重启，正在核对进程',orphaned_process:'进程归属需在本机核对',auth_unavailable:'管理器连接凭据不可用',network_unavailable:'管理器连接异常'};
 function validateOverview(value){
  if(!value||value.ok!==true||typeof value.canEdit!=='boolean'||!Array.isArray(value.devices)||value.devices.length>1000)throw Error('电脑状态响应不完整，请刷新');
  const seen=new Set();
  for(const device of value.devices){
   if(!device||!uuid(device.id)||seen.has(device.id)||!label(device.name)||!date(device.lastSeenAt)||!date(device.revokedAt)||typeof device.agentVersion!=='string'||device.agentVersion.length>80||!Array.isArray(device.tasks)||device.tasks.length>200)throw Error('电脑状态响应不完整，请刷新');
   seen.add(device.id);const tasks=new Set();
   for(const task of device.tasks){
    if(!task||!taskId(task.id)||tasks.has(task.id)||!label(task.label)||!['running','stopped'].includes(task.desiredState)||!Number.isSafeInteger(task.revision)||task.revision<0||!Object.prototype.hasOwnProperty.call(states,task.observedState)||!(task.pid===null||Number.isSafeInteger(task.pid)&&task.pid>0)||!date(task.updatedAt)||typeof task.detailCode!=='string'||task.detailCode.length>80)throw Error('任务状态响应不完整，请刷新');
    tasks.add(task.id);
   }
  }
  return value;
 }
 function create(options){
  const s={data:null,busy:false,mutating:false,error:'',notice:'',name:'',pairing:null,confirmRevoke:'',fetchedAt:null};let timer=null,started=false,disposed=false;
  const active=()=>!disposed&&options.active()&&root.document?.visibilityState!=='hidden';
  const changed=()=>{if(active())options.onChange()};
  const online=device=>!device.revokedAt&&device.lastSeenAt!==null&&Date.now()-Date.parse(device.lastSeenAt)<=90000&&Date.parse(device.lastSeenAt)<=Date.now()+60000;
  const canEdit=()=>s.data?.canEdit===true&&options.canEdit()&&!s.error;
  const request=(operation,fields={})=>options.request({action:'collectorControl',operation,...fields});
  function arm(){if(timer!==null)root.clearTimeout(timer);timer=root.setTimeout(()=>{timer=null;if(active())void refresh();else if(!disposed)arm()},15000)}
  async function refresh(){
   if(disposed)return;if(s.busy||s.mutating){arm();return;}s.busy=true;s.error='';changed();
   try{const result=validateOverview(await request('overview'));if(disposed)return;s.data=result;s.fetchedAt=new Date(Date.now()).toISOString();}
   catch(error){if(!disposed)s.error=error instanceof Error?error.message:String(error?.message||'状态读取失败，请刷新');}
   finally{if(!disposed){s.busy=false;changed();arm();}}
  }
  async function mutate(operation,fields,onSuccess){
   if(!canEdit()||s.busy||s.mutating)return false;s.mutating=true;s.error='';s.notice='';changed();
   try{const result=await request(operation,fields);if(disposed)return false;if(!result||result.ok!==true)throw Error('操作结果尚未确认，请刷新状态后核对');onSuccess(result);return true;}
   catch(error){if(!disposed)s.error=error instanceof Error?error.message:String(error?.message||'操作未确认，请刷新状态后核对');return false;}
   finally{if(!disposed){s.mutating=false;changed();}}
  }
  async function pair(){
   const name=s.name.trim();if(!label(name)){s.notice='请填写1至80字的电脑名称';changed();return false;}
   return mutate('createPairing',{name},result=>{
    if(typeof result.code!=='string'||result.code.length<6||result.code.length>100||!/^[a-zA-Z0-9_-]+$/.test(result.code)||typeof result.expiresAt!=='string'||!Number.isFinite(Date.parse(result.expiresAt)))throw Error('配对码响应不完整，请重新生成');
    s.pairing={code:result.code,expiresAt:result.expiresAt,name};s.notice='在对应电脑的运行管理器中输入此配对码。配对成功后会显示该电脑。';
   });
  }
  async function desired(deviceId,id,desiredState){
   const device=s.data?.devices.find(d=>d.id===deviceId),task=device?.tasks.find(t=>t.id===id);
   if(!device||device.revokedAt||!task||['external_running','unavailable'].includes(task.observedState)||task.detailCode==='unavailable'||!['running','stopped'].includes(desiredState)||task.desiredState===desiredState)return false;
   const success=await mutate('setDesired',{deviceId,taskId:id,desiredState,expectedRevision:task.revision},result=>{
    if(!Number.isSafeInteger(result.revision)||result.revision<task.revision)throw Error('任务版本尚未确认，请刷新状态后核对');
    task.desiredState=desiredState;task.revision=result.revision;
    s.notice=desiredState==='running'?'已请求运行；以电脑回报的实际状态为准。':'已请求停止；按脚本原有退出方式处理，当前批次保护需逐份接入验证。';
   });
   if(success)await refresh();return success;
  }
  async function revoke(id){
   const device=s.data?.devices.find(d=>d.id===id);if(!device||device.revokedAt||!canEdit())return false;
   if(s.confirmRevoke!==id){s.confirmRevoke=id;changed();return false;}
   const success=await mutate('revokeDevice',{deviceId:id},()=>{s.confirmRevoke='';s.notice='连接已撤销。电脑上已经运行的进程不会因此自动停止；如需停止，请在本机处理。';});
   if(success)await refresh();return success;
  }
  const stamp=value=>value?escape(new Date(value).toLocaleString('zh-CN',{hour12:false})):'尚未回报';
  function render(){
   const disabled=s.busy||s.mutating,editable=canEdit(),last=s.fetchedAt?'<span>本页刷新：'+stamp(s.fetchedAt)+'</span>':'';
   let html='<section class="collector-control" aria-label="采集管理"><div class="collector-intro"><div><h2>本机采集任务</h2><p>每台电脑连接一个运行管理器。任务在原电脑执行，后台显示电脑回报的进程状态。</p></div><button class="btn" type="button" onclick="collectorRefresh()"'+(disabled?' disabled':'')+'>'+(s.busy?'读取中…':'刷新状态')+'</button></div>';
   html+='<div class="collector-message">本版支持连接电脑、运行和请求停止。登录状态、最后采集时间、最后入库时间尚未接入；“进程运行中”不代表订单已成功入库。停止按脚本原有退出方式处理，当前批次保护需逐份接入验证。</div>';
   if(s.error)html+='<div class="collector-error" role="alert">'+escape(s.error)+(s.data?'<p>以下为上次回报，当前状态未确认；刷新成功后才能操作。</p>':'<p>首次使用需要部署采集管理服务，再连接电脑上的运行管理器。</p>')+'</div>';
   if(s.notice)html+='<div class="collector-notice" role="status">'+escape(s.notice)+'</div>';
   if(s.data&&options.canEdit())html+='<form class="collector-pair" onsubmit="event.preventDefault();collectorPair()"><label>新电脑名称<input id="collectorComputerName" maxlength="80" autocomplete="off" value="'+escape(s.name)+'" oninput="collectorName(this.value)" placeholder="例如：采集电脑 A"'+(!editable||s.mutating?' disabled':'')+'></label><button class="btn primary" type="submit"'+(!editable||disabled?' disabled':'')+'>生成配对码</button><span>任务的PY路径和启动参数在该电脑本地登记。</span></form>';
   if(s.pairing){const expired=Date.parse(s.pairing.expiresAt)<=Date.now();html+='<div class="collector-pair-code" role="status"><span>'+escape(s.pairing.name)+' · '+(expired?'配对码已过期，请重新生成':'仅用于这一次连接')+'</span>'+(expired?'':'<code>'+escape(s.pairing.code)+'</code>')+'<span>有效期至 '+stamp(s.pairing.expiresAt)+'。请在对应电脑输入，勿发到群里。</span></div>';}
   if(!s.data&&!s.error)html+='<p class="collector-empty" role="status">正在读取电脑与任务…</p>';
   if(s.data&&!s.data.devices.length)html+='<div class="collector-empty"><h3>还没有连接电脑</h3><p>'+(editable?'生成配对码，在第一台电脑运行管理器并完成配对。先使用演示任务验证启停，再登记正式PY。':'请由有管理权限的账号连接第一台电脑。')+'</p></div>';
   for(const device of s.data?.devices||[]){
    const connected=online(device),status=device.revokedAt?'已撤销':s.error?'状态未确认':connected?'在线':'离线 / 等待连接';
    html+='<article class="collector-device"><div class="collector-device-heading"><div><h3>'+escape(device.name)+'</h3><span class="collector-badge '+(connected&&!s.error?'is-online':'')+'">'+status+'</span><span>最后联系：'+stamp(device.lastSeenAt)+'</span></div>';
    if(editable&&!device.revokedAt)html+='<button class="btn" type="button" onclick="collectorRevoke(\''+device.id+'\')"'+(disabled?' disabled':'')+'>'+(s.confirmRevoke===device.id?'确认撤销连接':'撤销连接')+'</button>';
    html+='</div>';
    if(s.confirmRevoke===device.id)html+='<p class="collector-message">撤销后停止接收指令，已运行的进程不会被自动关闭。<button class="link" onclick="collectorCancelRevoke()">取消</button></p>';
    if(!connected&&!device.revokedAt)html+='<p class="collector-message">电脑离线、休眠或管理器未运行时，指令需等待恢复连接；下方实际状态仅为最后一次回报。</p>';
    if(!device.tasks.length)html+='<p class="collector-empty">电脑尚未上报任务。请在该电脑的管理器中登记任务。</p>';
    else{
     html+='<div class="collector-table-wrap"><table><thead><tr><th>任务</th><th>希望状态</th><th>电脑实际回报</th><th>数据状态</th><th>操作</th></tr></thead><tbody>';
     for(const task of device.tasks){
      const unavailable=['external_running','unavailable'].includes(task.observedState)||task.detailCode==='unavailable',blocked=disabled||!editable||!!device.revokedAt||unavailable;
      const pending=task.desiredState==='running'?!['running','external_running'].includes(task.observedState):task.observedState!=='stopped';
      html+='<tr><td><strong>'+escape(task.label)+'</strong><small>'+escape(task.id)+'</small></td><td>'+(task.desiredState==='running'?'运行':'停止')+(pending?'<small>等待电脑执行 / 核对</small>':'')+'</td><td>'+states[task.observedState]+'<small>'+(task.pid?'PID '+task.pid+' · ':'')+stamp(task.updatedAt)+'</small>'+(task.detailCode?'<small>'+escape(detailLabels[task.detailCode]??'请在本机管理器核对任务状态')+'</small>':'')+'</td><td>尚未接入<small>登录 / 采集 / 入库</small></td><td><div class="collector-task-actions"><button class="btn primary" type="button" onclick="collectorDesired(\''+device.id+'\',\''+task.id+'\',\'running\')"'+(blocked||task.desiredState==='running'?' disabled':'')+'>运行</button><button class="btn" type="button" onclick="collectorDesired(\''+device.id+'\',\''+task.id+'\',\'stopped\')"'+(blocked||task.desiredState==='stopped'?' disabled':'')+'>停止任务</button></div></td></tr>';
     }
     html+='</tbody></table></div>';
    }
    html+='</article>';
   }
   return html+'<p class="collector-footnote">'+last+'<span>页面停留时每15秒刷新。时间按当前浏览器时区显示。</span></p></section>';
  }
  return {render,refresh,pair,desired,revoke,setName:value=>{s.name=String(value).slice(0,80)},cancelRevoke:()=>{s.confirmRevoke='';changed()},activate(){if(!started){started=true;void refresh()}},dispose(){disposed=true;root.clearTimeout(timer);s.pairing=null},snapshot:()=>({...s,pairing:s.pairing?{expiresAt:s.pairing.expiresAt}:null})};
 }
 root.HensemCollectorControl={create,validateOverview};
})(typeof window==='undefined'?globalThis:window);
