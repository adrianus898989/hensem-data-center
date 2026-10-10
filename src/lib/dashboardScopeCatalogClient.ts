"use client";

import { ensureDashboardSession, readSavedDashboardSession, type DashboardSession } from "./dashboardAuthClient";
import { DASHBOARD_DATA_GROUPS, type DashboardDataGroup } from "./dashboardDataScope";

export type DashboardScopePlatform = {country:DashboardDataGroup;platform:string;label:string;source?:string};

export function validateDashboardScopeCatalog(value:unknown):DashboardScopePlatform[] {
  const payload=value as {version?:unknown;platforms?:unknown};
  if(!payload||payload.version!==1||!Array.isArray(payload.platforms)||payload.platforms.length>10000)throw Error("平台目录返回不完整，请重新读取。");
  const keys=new Set<string>(),groups=new Set<string>(DASHBOARD_DATA_GROUPS.map(x=>x.key));
  return payload.platforms.map(row=>{
    if(!row||typeof row!=="object"||!groups.has(row.country)||typeof row.platform!=="string"||!row.platform||Array.from(row.platform).length>200||/[\u0000-\u001f\u007f-\u009f]/.test(row.platform)||row.platform!==row.platform.trim().toUpperCase()||typeof row.label!=="string"||!row.label.trim()||row.label.length>300||row.source!==undefined&&typeof row.source!=="string")throw Error("平台目录返回不完整，请重新读取。");
    const key=JSON.stringify([row.country,row.platform]);if(keys.has(key))throw Error("平台目录存在重复标识，请重新读取。");keys.add(key);
    return {country:row.country,platform:row.platform,label:row.label,...(row.source?{source:row.source}:{})};
  });
}

export async function readDashboardScopeCatalog(session:DashboardSession,signal?:AbortSignal):Promise<DashboardScopePlatform[]> {
  const actor=session.user.id,started=readSavedDashboardSession(),controller=new AbortController();let timedOut=false;
  const guard=()=>{signal?.throwIfAborted();controller.signal.throwIfAborted();const saved=readSavedDashboardSession();if(saved&&saved.user.id!==actor||started&&!saved)throw Error("登录账号已改变，请重新打开账号设置。");};
  const abort=()=>controller.abort(signal?.reason);signal?.addEventListener("abort",abort,{once:true});
  let rejectCancelled:(reason:unknown)=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{rejectCancelled=reject});
  const rejectAbort=()=>rejectCancelled(controller.signal.reason||new DOMException("已取消读取平台目录","AbortError"));
  controller.signal.addEventListener("abort",rejectAbort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},15000);
  try {
    return await Promise.race([(async()=>{
    guard();const current=await ensureDashboardSession(session);guard();if(current.user.id!==actor)throw Error("登录账号已改变，请重新打开账号设置。");
    const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,""),url=new URL(base);if(url.protocol!=="https:"||url.origin!==base)throw Error("后台地址配置无效。");
    const response=await fetch(base+"/rest/v1/rpc/dashboard_account_data_scope_catalog",{method:"POST",body:"{}",cache:"no-store",credentials:"omit",redirect:"error",signal:controller.signal,headers:{Authorization:`Bearer ${current.access_token}`,apikey:String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""),"Content-Type":"application/json"}});
    const data:unknown=await response.json();guard();
    if(!response.ok)throw Error(response.status===401||response.status===403?"当前账号没有平台授权管理权限，请重新验证权限。":"平台目录读取失败，请重试。");
    return validateDashboardScopeCatalog(data);
    })(),cancelled]);
  } catch(error) {
    if(signal?.aborted)throw error;
    if(timedOut)throw Error("平台目录读取超时，请重试。");
    throw error instanceof Error?error:Error("平台目录读取失败，请重试。");
  } finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);controller.signal.removeEventListener("abort",rejectAbort);controller.abort();}
}
