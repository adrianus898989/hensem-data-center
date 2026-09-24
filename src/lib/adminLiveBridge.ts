"use client";
import { ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";
export const LIVE_REQUEST = "hensem-admin-live-request";
export const LIVE_RESPONSE = "hensem-admin-live-response";
const actions = ["catalog","query","aggregate","details","rates","ratesSheet","payoutConfig","workorders","providerConfig","platformAssignments"];
const keys = new Set(["action","platformId","startAt","endAt","direction","status","orderNumber","thirdPartyOrderNumber","memberId","systemOrderId","utr","providers","channelTypes","currency","amountMin","amountMax","offset","limit","scopeType","country","platform","provider","rawProvider","canonicalProvider","query","sheetId","operation","system","team"]);
export function validateAdminLiveRequest(input:unknown):Record<string,unknown> {
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("查询参数无效");
  const p=input as Record<string,unknown>;
  if(Object.keys(p).some(k=>!keys.has(k))||!actions.includes(String(p.action)))throw Error("查询方法无效");
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
    const allowed=new Set(["action","startAt","endAt","country","platform","provider","direction","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("工单查询参数无效");
    for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期及秒");
    const span=Date.parse(String(p.endAt))-Date.parse(String(p.startAt));
    if(span<=0||span>32*86400000)throw Error("查询范围最多31个当地日");
    for(const key of ["country","platform","provider"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("工单检索值无效");
    if(p.direction!==undefined&&!['all','charge','withdraw'].includes(String(p.direction)))throw Error("工单方向无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="providerConfig"){
    const allowed=new Set(["action","rawProvider","canonicalProvider","country","direction","status","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("三方归类查询参数无效");
    for(const key of ["rawProvider","canonicalProvider","country"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("三方归类检索值无效");
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
export async function adminLiveRequest(session:DashboardSession,input:unknown,signal?:AbortSignal):Promise<unknown>{
 const request=validateAdminLiveRequest(input),current=await ensureDashboardSession(session);
 if(current.user.id!==session.user.id)throw Error("当前登录账号已改变");
 const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,""),url=new URL(base);
 if(url.protocol!=="https:"||url.origin!==base)throw Error("后台地址配置无效");
 const specialRpc:Record<string,string>={rates:"dashboard_admin_live_rates",ratesSheet:"dashboard_admin_live_rate_sheet",payoutConfig:"dashboard_admin_live_payout_config",workorders:"dashboard_admin_live_workorders",providerConfig:"dashboard_admin_live_provider_config",platformAssignments:"dashboard_admin_live_platform_assignments"};
 const rpc=specialRpc[String(request.action)]||"dashboard_admin_live_query";
 const response=await fetch(base+"/rest/v1/rpc/"+rpc,{method:"POST",body:JSON.stringify({p_request:specialRpc[String(request.action)]?Object.fromEntries(Object.entries(request).filter(([key])=>key!=="action")):request}),headers:{Authorization:`Bearer ${current.access_token}`,apikey:String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""),"Content-Type":"application/json"},signal,cache:"no-store",redirect:"error"});
 if(!response.ok){let code="";try{const body=await response.json();code=String(body.message||"")}catch{}
 if([401,403].includes(response.status))throw Error("正式数据读取未获授权，或会话已失效");
 if(/unsupported_filter/.test(code))throw Error("此来源未提供该检索字段，请清空该字段后查询");
 if(/timeout|57014/i.test(code)||response.status===504)throw Error("读取超时，请缩短日期或选择单个平台后重试");
 throw Error("正式数据查询未完成，请重试；未显示部分总数");}
 return response.json();
}
export function installAdminLiveBridge(options:{source:()=>Window|null|undefined;channel:()=>string;session:DashboardSession|(()=>DashboardSession);target?:Window}):()=>void{
 const target=options.target||window,active=new Map<string,AbortController>();let closed=false;
 const receive=async(event:MessageEvent)=>{
   if(closed||!isAdminLiveMessage(event,options.source(),options.channel()))return;
   const {id,request}=event.data,source=event.source as Window,channel=options.channel();
   if(active.has(id))return;
   const reply=(payload:Record<string,unknown>)=>{if(!closed&&source===options.source()&&channel===options.channel())source.postMessage({type:LIVE_RESPONSE,id,channel,...payload},"*")};
   if(active.size>=4){reply({error:"同时查询过多，请等待当前查询完成"});return;}
   const controller=new AbortController();active.set(id,controller);const timer=setTimeout(()=>controller.abort(),90000);
   try{reply({result:await adminLiveRequest(typeof options.session==="function"?options.session():options.session,request,controller.signal)})}catch(e){reply({error:controller.signal.aborted?"读取超时，请缩短日期重试":e instanceof Error?e.message:"读取失败"})}finally{clearTimeout(timer);active.delete(id)};
 };
 target.addEventListener("message",receive);
 return ()=>{closed=true;target.removeEventListener("message",receive);for(const controller of active.values())controller.abort();active.clear()};
}
export function makeAdminLiveDocument(html:string,channel:string):string{
 const encoded=JSON.stringify(channel).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 const script=`<script>(function(){const channel=${encoded},requests=new Map();let seq=0;window.HENSEM_PRODUCTION=true;window.hensemLiveRequest=function(request){return new Promise((resolve,reject)=>{const id='live_'+(++seq);const timer=setTimeout(()=>{requests.delete(id);reject(Error('正式数据读取超时，请重试'))},95000);requests.set(id,{resolve,reject,timer});parent.postMessage({type:'${LIVE_REQUEST}',channel,id,request},'*')})};addEventListener('message',event=>{const data=event.data;if(event.source!==parent||!data||data.type!=='${LIVE_RESPONSE}'||data.channel!==channel||!requests.has(data.id))return;const q=requests.get(data.id);requests.delete(data.id);clearTimeout(q.timer);data.error?q.reject(Error(data.error)):q.resolve(data.result)});})();</script>`;
 return html.replace(/(<!doctype html>)/i,"$1"+script);
}
