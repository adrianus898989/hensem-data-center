"use client";
import { ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";
import { validateConfigurationRequest } from "./adminConfigurationRequest";
export const LIVE_REQUEST = "hensem-admin-live-request";
export const LIVE_RESPONSE = "hensem-admin-live-response";
const actions = ["catalog","query","aggregate","details","rates","ratesSheet","payoutConfig","autoWithdraw","depositIssues","workorders","providerConfig","platformAssignments","providerOptions","configurationAccess","configurationWrite","withdrawReasons","withdrawNote"];
const keys = new Set(["action","platformId","startAt","endAt","direction","status","orderNumber","thirdPartyOrderNumber","memberId","systemOrderId","utr","providers","channelTypes","currency","amountMin","amountMax","offset","limit","scopeType","country","platform","provider","rawProvider","canonicalProvider","query","sheetId","operation","system","team","view","platforms","platformIds","expectedVersion","mappingId","sourceSystem","countryCode","sourceCountry","sourcePlatform","platformName","userId","canManage","account","date","kind","sort","ascending","daily","reason","category","reasonKey","operatorKey","dateMode","match","followupStatus"]);
export function validateAdminLiveRequest(input:unknown):Record<string,unknown> {
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("查询参数无效");
  const p=input as Record<string,unknown>;
  if(Object.keys(p).some(k=>!keys.has(k))||!actions.includes(String(p.action)))throw Error("查询方法无效");
  if(p.action!=="depositIssues"&&["dateMode","match","followupStatus"].some(k=>p[k]!==undefined))throw Error("核对筛选仅用于存款未到账页面");
  if(p.action!=="withdrawReasons"&&["category","reasonKey","operatorKey"].some(k=>p[k]!==undefined))throw Error("原因筛选仅用于驳回分析");
  if(["providerOptions","configurationAccess","configurationWrite"].includes(String(p.action)))return validateConfigurationRequest(p);
  if(p.view!==undefined&&(!["aggregate","autoWithdraw","depositIssues"].includes(String(p.action))||(p.action==="aggregate"&&!["full","providers"].includes(String(p.view)))))throw Error("统计页面类型无效");
  if(p.action==="catalog")return {action:"catalog"};
  if(p.action==="ratesSheet"){
    if(Object.keys(p).some(k=>!["action","sheetId"].includes(k)))throw Error("原表查询参数无效");
    if(p.sheetId!==undefined&&(!Number.isInteger(p.sheetId)||Number(p.sheetId)<0||Number(p.sheetId)>2147483647))throw Error("原表页签无效");
    return {...p};
  }
  if(p.action==="payoutConfig"){
    if(Object.keys(p).some(k=>!["action","operation","system","country","platform"].includes(k)))throw Error("配置查询参数无效");
    if(typeof p.operation!=="string"||!["index","snapshot"].includes(p.operation))throw Error("配置查询操作无效");
    if(typeof p.system!=="string"||!["AR","NEW_AR","PANDA","WG","GAME66_HK","GAME66_RED_CRAB"].includes(p.system))throw Error("配置系统无效");
    for(const key of ["country","platform"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("配置范围无效");
    if(p.operation==="snapshot"&&(!p.country||!p.platform))throw Error("请选择配置平台");
    return {...p};
  }
  if(p.action==="rates"){
    const allowed=new Set(["action","scopeType","country","platform","provider","query","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("费率查询参数无效");
    if(p.scopeType!==undefined&&!["all","country","platform"].includes(String(p.scopeType)))throw Error("费率范围无效");
    for(const key of ["country","platform","provider","query"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200))throw Error("费率检索值无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>100000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="workorders"){
    const allowed=new Set(["action","startAt","endAt","country","platform","provider","direction","offset","limit","platforms","providers"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("工单查询参数无效");
    for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期及秒");
    const span=Date.parse(String(p.endAt))-Date.parse(String(p.startAt));
    if(span<=0||span>32*86400000)throw Error("查询范围最多31个当地日");
    for(const key of ["country","platform","provider"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("工单检索值无效");
    for(const key of ["platforms","providers"])if(p[key]!==undefined&&(!Array.isArray(p[key])||(p[key] as unknown[]).length>200||(p[key] as unknown[]).some(v=>typeof v!=="string"||!v||v.length>200||/[\u0000-\u001f]/.test(v))))throw Error("工单范围无效");
    if(p.direction!==undefined&&!['all','charge','withdraw'].includes(String(p.direction)))throw Error("工单方向无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="withdrawNote"){
    if(Object.keys(p).some(k=>!["action","date","country","platform","reason","expectedVersion"].includes(k)))throw Error("每日备注参数无效");
    if(typeof p.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date)throw Error("请选择备注日期");
    for(const k of ["country","platform"])if(typeof p[k]!=="string"||!String(p[k]).trim()||String(p[k]).length>100||/[\u0000-\u001f\u007f]/.test(String(p[k])))throw Error("请选择备注平台");
    if(typeof p.reason!=="string"||p.reason.length>1000||p.reason.includes("\u0000")||typeof p.expectedVersion!=="string"||!/^([0-9a-f]{32})?$/.test(p.expectedVersion))throw Error("每日备注内容无效");
    return {...p};
  }
  if(p.action==="autoWithdraw"||p.action==="withdrawReasons"){
    const reasons=p.action==="withdrawReasons";
    const allowed=new Set(reasons?["action","date","country","platform","kind","category","reasonKey","operatorKey","query","offset","limit"]:["action","startAt","endAt","country","platform","platforms","account","view","sort","ascending","daily","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("出款查询参数无效");
    if(typeof p.country!=="string"||!p.country.trim()||p.country==='all')throw Error("请选择一个国家");
    const validDay=(value:unknown)=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
    if(reasons){
      if(!validDay(p.date)||typeof p.platform!=="string"||!p.platform.trim()||p.kind!==undefined&&!["blocking","categories","rejection","operators","orders"].includes(String(p.kind)))throw Error("原因查询范围无效");
      for(const key of ["category","reasonKey","operatorKey"])if(p[key]!==undefined&&(typeof p[key]!=="string"||!/^([a-f0-9]{32})?$/.test(String(p[key]))))throw Error("原因筛选无效");
      if(p.query!==undefined&&(typeof p.query!=="string"||p.query.length>200||/[\u0000-\u001f\u007f]/.test(p.query)))throw Error("订单号无效");
      if((p.kind===undefined||p.kind==='blocking')&&["category","reasonKey","operatorKey","query"].some(k=>p[k]))throw Error("原因筛选无效");
    }else{
      for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(p[key]))||!validDay(String(p[key]).slice(0,10))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期");
      const days=(Date.parse(String(p.endAt).slice(0,10))-Date.parse(String(p.startAt).slice(0,10)))/86400000+1;
      if(days<1||days>31)throw Error("查询范围最多31个当地日");
      if(p.view!==undefined&&!["auto","operators"].includes(String(p.view)))throw Error("出款页面无效");
      if(p.sort!==undefined&&!["country","platform","account","total","processed","success","rejected","autoCount","manualCount","avgSeconds","successRate","rejectRate","autoRate","manualRate","previousAvgSeconds","durationChange"].includes(String(p.sort)))throw Error("排序无效");
      for(const key of ["ascending","daily"])if(p[key]!==undefined&&typeof p[key]!=="boolean")throw Error("出款查询值无效");
      if(p.platforms!==undefined&&(!Array.isArray(p.platforms)||p.platforms.length>200||p.platforms.some(v=>typeof v!=="string"||!v||v.length>200||/[\u0000-\u001f]/.test(v))))throw Error("平台范围无效");
    }
    for(const key of ["country","platform","account"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("出款检索值无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="depositIssues"){
    const allowed=new Set(["action","startAt","endAt","country","platform","provider","status","query","offset","limit","view","dateMode","match","followupStatus"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("存款未到账查询参数无效");
    for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期及秒");
    const span=Date.parse(String(p.endAt))-Date.parse(String(p.startAt));
    if(span<=0||(p.dateMode!=="all"&&span>32*86400000))throw Error("查询范围最多31个当地日");
    for(const key of ["country","platform","provider","status","query","followupStatus"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("存款未到账检索值无效");
    if(p.view!==undefined&&!['results','entries'].includes(String(p.view)))throw Error("存款核对来源无效");
    if(p.dateMode!==undefined&&!['all','range'].includes(String(p.dateMode)))throw Error("日期范围无效");
    if(p.match!==undefined&&!['all','matched','unmatched','unknown'].includes(String(p.match)))throw Error("对账筛选无效");
    if(p.status!==undefined&&!['all','未入款','已入款','待核对'].includes(String(p.status)))throw Error("存款未到账状态无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="providerConfig"){
    const allowed=new Set(["action","rawProvider","canonicalProvider","country","platform","direction","status","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("三方归类查询参数无效");
    for(const key of ["rawProvider","canonicalProvider","country","platform"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("三方归类检索值无效");
    if(p.direction!==undefined&&!['all','charge','withdraw'].includes(String(p.direction)))throw Error("三方归类方向无效");
    if(p.status!==undefined&&!['all','assigned','unassigned','conflict'].includes(String(p.status)))throw Error("三方归类状态无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="platformAssignments"){
    const allowed=new Set(["action","team","country","system","platform","status","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("团队平台查询参数无效");
    for(const key of ["team","country","system","platform"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("团队平台检索值无效");
    if(p.status!==undefined&&!['all','mapped','unmapped','no_data'].includes(String(p.status)))throw Error("团队平台状态无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(typeof p.platformId!=="string"||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(p.platformId))throw Error("请选择真实平台");
  for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期及秒");
  const span=Date.parse(String(p.endAt))-Date.parse(String(p.startAt));
  if(span<=0||span>32*86400000)throw Error("查询范围最多31个当地日");
  if(p.direction!==undefined&&!["all","charge","withdraw"].includes(String(p.direction)))throw Error("方向无效");
  if(p.status!==undefined&&!["all","success","pending","failed","rejected","unknown"].includes(String(p.status)))throw Error("状态无效");
  for(const key of ["orderNumber","thirdPartyOrderNumber","memberId","systemOrderId","utr","currency"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200))throw Error("精确检索值过长");
  for(const key of ["providers","channelTypes"])if(p[key]!==undefined&&(!Array.isArray(p[key])||(p[key] as unknown[]).length>200||(p[key] as unknown[]).some(v=>typeof v!=="string"||v.length>200)))throw Error("三方或通道参数无效");
  if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
  if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>100000000))throw Error("页码无效");
  for(const key of ["amountMin","amountMax"])if(p[key]!==undefined&&(typeof p[key]!=="number"||!Number.isFinite(p[key])||Number(p[key])<0))throw Error("金额范围无效");
  if(p.amountMin!==undefined&&p.amountMax!==undefined&&Number(p.amountMin)>Number(p.amountMax))throw Error("金额范围无效");
  for(const key of ["startAt","endAt"]){const value=String(p[key]);if(new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw Error("日期或时间无效");}
  return {...p};
}
export function isAdminLiveMessage(event:MessageEvent,source:Window|null|undefined,channel:string):boolean {
 const d=event.data;return !!source&&!!channel&&event.source===source&&event.origin==="null"&&d?.type===LIVE_REQUEST&&d.channel===channel&&typeof d.id==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(d.id);
}
function adminLiveTimeoutMessage(action:unknown):string {
 return action==='withdrawReasons'?'该平台当日原因读取超时，请点击重试':'读取超时，请缩短日期或选择单个平台后重试';
}
export async function adminLiveRequest(session:DashboardSession,input:unknown,signal?:AbortSignal):Promise<unknown>{
 const request=validateAdminLiveRequest(input),current=await ensureDashboardSession(session);
 if(current.user.id!==session.user.id)throw Error("当前登录账号已改变");
 const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,""),url=new URL(base);
 if(url.protocol!=="https:"||url.origin!==base)throw Error("后台地址配置无效");
 const specialRpc:Record<string,string>={rates:"dashboard_admin_live_rates",ratesSheet:"dashboard_admin_live_rate_sheet",payoutConfig:"dashboard_admin_live_payout_config",autoWithdraw:"dashboard_admin_live_auto_withdraw",withdrawReasons:"dashboard_admin_live_withdraw_reasons",withdrawNote:"dashboard_admin_live_withdraw_note",depositIssues:"dashboard_admin_live_deposit_issues",workorders:"dashboard_admin_live_workorders",providerConfig:"dashboard_admin_live_provider_config",platformAssignments:"dashboard_admin_live_platform_assignments",providerOptions:"dashboard_admin_live_provider_options",configurationAccess:"dashboard_admin_live_configuration_access",configurationWrite:"dashboard_admin_live_configuration_write"};
 const rpc=specialRpc[String(request.action)]||"dashboard_admin_live_query";
 const response=await fetch(base+"/rest/v1/rpc/"+rpc,{method:"POST",body:JSON.stringify({p_request:specialRpc[String(request.action)]?Object.fromEntries(Object.entries(request).filter(([key])=>key!=="action")):request}),headers:{Authorization:`Bearer ${current.access_token}`,apikey:String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""),"Content-Type":"application/json"},signal,cache:"no-store",redirect:"error"});
 if(!response.ok){let code="";try{const body=await response.json();code=String(body.message||"")}catch{}
 if(/note_conflict/.test(code))throw Error("该日备注已被修改，请取消后重新打开核对；当前输入已保留");
 if(/note_denied/.test(code))throw Error("当前账号没有自动出款备注编辑权限");
 if(/note_date_unavailable/.test(code))throw Error("所选日期没有该平台的出款记录，请选择有数据的日期");
 if(/configuration_conflict/.test(code))throw Error("归类已被其他人修改，请刷新后再保存");
 if(/configuration_denied|scope_denied/.test(code))throw Error("当前账号没有此范围的归类权限");
 if(/mapping_not_found|invalid_classification/.test(code))throw Error("归类来源或国家配置已改变，请刷新后重试");
 if([401,403].includes(response.status))throw Error("正式数据读取未获授权，或会话已失效");
 if(/unsupported_filter/.test(code))throw Error("此来源未提供该检索字段，请清空该字段后查询");
 if(/timeout|57014/i.test(code)||response.status===504)throw Error(adminLiveTimeoutMessage(request.action));
 throw Error("正式数据查询未完成，请重试；未显示部分总数");}
 return response.json();
}
export function installAdminLiveBridge(options:{source:()=>Window|null|undefined;channel:()=>string;session:DashboardSession|(()=>DashboardSession);target?:Window}):()=>void{
 type Pending={id:string;request:unknown;source:Window;channel:string};
 const target=options.target||window,active=new Map<string,AbortController>(),queued=new Map<string,Pending>();let closed=false;
 const post=(item:Pending,payload:Record<string,unknown>)=>{if(!closed&&item.source===options.source()&&item.channel===options.channel())item.source.postMessage({type:LIVE_RESPONSE,id:item.id,channel:item.channel,...payload},"*")};
 const run=async(item:Pending)=>{
   if(closed||item.source!==options.source()||item.channel!==options.channel())return;
   const controller=new AbortController();active.set(item.id,controller);const timer=setTimeout(()=>controller.abort(),90000);
   try{post(item,{result:await adminLiveRequest(typeof options.session==="function"?options.session():options.session,item.request,controller.signal)})}catch(e){post(item,{error:controller.signal.aborted?adminLiveTimeoutMessage((item.request as {action?:unknown})?.action):e instanceof Error?e.message:"读取失败"})}finally{clearTimeout(timer);active.delete(item.id);drain()};
 };
 const drain=()=>{while(!closed&&active.size<4&&queued.size){const next=queued.values().next();if(next.done||!next.value)break;const item=next.value as Pending;queued.delete(item.id);if(item.source!==options.source()||item.channel!==options.channel())continue;void run(item)}};
 const receive=(event:MessageEvent)=>{
   if(closed||!isAdminLiveMessage(event,options.source(),options.channel()))return;
   const {id,request}=event.data,source=event.source as Window,channel=options.channel(),item:Pending={id,request,source,channel};
   if(active.has(id)||queued.has(id))return;
   if(active.size>=4){if(queued.size>=8){post(item,{error:"同时查询过多，请等待当前查询完成"});return}queued.set(id,item);return;}
   void run(item);
 };
 target.addEventListener("message",receive);
 return ()=>{closed=true;target.removeEventListener("message",receive);for(const controller of active.values())controller.abort();active.clear();queued.clear()};
}
export function makeAdminLiveDocument(html:string,channel:string):string{
 const encoded=JSON.stringify(channel).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 const script=`<script>(function(){const channel=${encoded},requests=new Map();let seq=0;window.HENSEM_PRODUCTION=true;window.hensemLiveRequest=function(request){return new Promise((resolve,reject)=>{const id='live_'+(++seq);const timer=setTimeout(()=>{requests.delete(id);reject(Error('正式数据读取超时，请重试'))},95000);requests.set(id,{resolve,reject,timer});parent.postMessage({type:'${LIVE_REQUEST}',channel,id,request},'*')})};addEventListener('message',event=>{const data=event.data;if(event.source!==parent||!data||data.type!=='${LIVE_RESPONSE}'||data.channel!==channel||!requests.has(data.id))return;const q=requests.get(data.id);requests.delete(data.id);clearTimeout(q.timer);data.error?q.reject(Error(data.error)):q.resolve(data.result)});})();</script>`;
 return html.replace(/(<!doctype html>)/i,"$1"+script);
}
