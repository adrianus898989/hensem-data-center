"use client";
import { DashboardHttpError, ensureDashboardSession, fetchDashboardProfile, readSavedDashboardSession, type DashboardProfile } from "./dashboardAuthClient";
import { dashboardScopeIdentity } from "./dashboardDataScope";

export const DASHBOARD_PROFILE_EVENT="hensem:dashboard:profile-verified";
let currentViewer:DashboardProfile|null=null;
let viewerEpoch=0;
const profileFlights=new Map<string,Promise<DashboardProfile>>();

export function clearDashboardDataCaches() {
  if(typeof window==="undefined")return;
  try {
    const targets=Object.keys(window.localStorage).filter(key=>key.startsWith("hensem:last-good:")||key.startsWith("hensem:scoped-data:v1:"));
    for(const key of targets)window.localStorage.removeItem(key);
  } catch { /* Storage is optional; never clear login or unrelated app data. */ }
}
export function dashboardProfileCanAdvance(profile:DashboardProfile|null):boolean {
  if(!profile||!currentViewer||profile.auth_user_id!==currentViewer.auth_user_id)return true;
  const currentTime=Date.parse(currentViewer.updated_at||""),nextTime=Date.parse(profile.updated_at||"");
  if(Number.isFinite(currentTime)&&(!Number.isFinite(nextTime)||nextTime<currentTime))return false;
  if(Number.isFinite(currentTime)&&nextTime===currentTime&&dashboardScopeIdentity(profile)!==dashboardScopeIdentity(currentViewer))return false;
  return true;
}
export function setDashboardDataViewer(profile:DashboardProfile|null):boolean {
  if(!dashboardProfileCanAdvance(profile))return false;
  if(dashboardScopeIdentity(currentViewer)!==dashboardScopeIdentity(profile)){clearDashboardDataCaches();viewerEpoch++;}
  currentViewer=profile;
  return true;
}
function cacheKey(base:string,profile:DashboardProfile|null|undefined) {
  return profile?.active ? `hensem:scoped-data:v1:${encodeURIComponent(dashboardScopeIdentity(profile))}:${base}` : "";
}
export function readDashboardDataCache<T>(base:string,profile:DashboardProfile|null|undefined):T|null {
  const key=cacheKey(base,profile);
  if(!key||typeof window==="undefined"||dashboardScopeIdentity(profile)!==dashboardScopeIdentity(currentViewer))return null;
  try {const raw=window.localStorage.getItem(key);return raw?JSON.parse(raw) as T:null;}catch{return null;}
}
export function writeDashboardDataCache(base:string,data:unknown,profile:DashboardProfile|null|undefined) {
  const key=cacheKey(base,profile);
  if(!key||typeof window==="undefined"||dashboardScopeIdentity(profile)!==dashboardScopeIdentity(currentViewer))return;
  try {window.localStorage.setItem(key,JSON.stringify(data));}catch{ /* Cache is optional. */ }
}
export function isDashboardDataDenied(error:unknown) {
  return error instanceof DashboardHttpError && ([401,403,409].includes(error.status)||error.code==="data_scope_changed");
}

// Same-origin website APIs only. Database authorization still uses the caller's
// token and current database profile; this check also invalidates stale UI/cache.
export async function dashboardBusinessFetch(input:string,init:RequestInit={}):Promise<Response> {
  if(typeof window==="undefined")throw new DashboardHttpError("业务请求仅能从已登录页面发起",401,"profile_denied");
  const target=new URL(input,window.location.origin);
  if(target.origin!==window.location.origin||!target.pathname.startsWith("/api/"))throw new DashboardHttpError("拒绝向其他地址发送业务登录凭据",403,"auth_target_not_allowed");
  const saved=readSavedDashboardSession();
  if(!saved)throw new DashboardHttpError("请先登录",401,"profile_denied");
  const active=await ensureDashboardSession(saved);
  let flight=profileFlights.get(active.access_token);
  if(!flight){flight=fetchDashboardProfile(active);profileFlights.set(active.access_token,flight);void flight.finally(()=>profileFlights.delete(active.access_token)).catch(()=>undefined);}
  const profile=await flight;
  const sessionNow=readSavedDashboardSession();
  if(sessionNow?.user.id!==profile.auth_user_id)throw new DashboardHttpError("账号已切换，请重新查询",409,"data_scope_changed");
  if(!dashboardProfileCanAdvance(profile))throw new DashboardHttpError("已忽略过期的账号权限，请重新查询",409,"data_scope_changed");
  const changed=dashboardScopeIdentity(profile)!==dashboardScopeIdentity(currentViewer);
  window.dispatchEvent(new CustomEvent(DASHBOARD_PROFILE_EVENT,{detail:{profile,session:active}}));
  if(changed)throw new DashboardHttpError("数据权限已更新，请按当前范围重新查询",409,"data_scope_changed");
  const epoch=viewerEpoch;
  const headers=new Headers(init.headers);headers.set("Authorization",`Bearer ${active.access_token}`);
  const response=await fetch(target.href,{...init,headers,cache:"no-store",redirect:"error"});
  if([401,403,409].includes(response.status))throw new DashboardHttpError("没有当前数据的查看权限，或登录已失效",response.status,"data_scope_denied");
  // Ignore a response from an earlier scope/account even if it won an HTTP race.
  if(epoch!==viewerEpoch||dashboardScopeIdentity(profile)!==dashboardScopeIdentity(currentViewer)||readSavedDashboardSession()?.user.id!==profile.auth_user_id)throw new DashboardHttpError("数据权限已更新，请重新查询",409,"data_scope_changed");
  return response;
}
