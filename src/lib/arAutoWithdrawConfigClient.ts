"use client";
import type { DashboardSession } from "./dashboardAuthClient";
export type ConfigField = {key:string;kind:"number"|"boolean";value:string|boolean|null;label:string;description:string;available:boolean;read_only:boolean};
export type Configuration = {fields:ConfigField[];groups:Array<{key:string;options:Array<{value:string;label:string;selected:boolean}>}>};
export type ConfigTarget = {country_code:string;country_name:string;platform:string;timezone:string;currency:string|null};
export type ConfigSnapshot = {country_code:string;platform:string;timezone:string;observed_at:string;observed_local_date:string;received_at:string;configuration:Configuration};
export type ConfigSummary = Pick<ConfigSnapshot,"country_code"|"platform"|"timezone"|"observed_at"|"observed_local_date">;
export function configLocalDay(timezone:string, now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  return ["year","month","day"].map(k=>parts.find(p=>p.type===k)?.value).join("-");
}
async function readConfig<T>(table:string,query:Record<string,string>,session:DashboardSession,signal:AbortSignal):Promise<T[]> {
  const url=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/$/,"");
  const key=String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||"");
  if(!url||!key||!session.access_token)throw new Error("配置读取尚未就绪，请重新登录后重试。");
  const res=await fetch(url+"/rest/v1/"+table+"?"+new URLSearchParams(query),{headers:{apikey:key,Authorization:`Bearer ${session.access_token}`},cache:"no-store",signal});
  if(!res.ok)throw new Error(res.status===401||res.status===403?"登录已失效或没有自动出款查看权限。":"配置读取失败，请重试。");
  const data=await res.json();if(!Array.isArray(data))throw new Error("配置响应不完整，请重试。");return data;
}
export async function fetchConfigIndex(session:DashboardSession,signal:AbortSignal) {
  const [targets,summaries]=await Promise.all([
    readConfig<ConfigTarget>("ar_config_targets",{select:"*",order:"country_code,platform",limit:"1000"},session,signal),
    readConfig<ConfigSummary>("ar_config_latest",{select:"country_code,platform,timezone,observed_at,observed_local_date",limit:"1000"},session,signal)
  ]);return {targets,summaries};
}
export async function fetchConfigSnapshot(target:ConfigTarget,session:DashboardSession,signal:AbortSignal) {
  const rows=await readConfig<ConfigSnapshot>("ar_config_latest",{select:"*",country_code:"eq."+target.country_code,platform:"eq."+target.platform,limit:"1"},session,signal);
  const row=rows[0]||null;
  if(row && (!Array.isArray(row.configuration?.fields)||!Array.isArray(row.configuration?.groups)))throw new Error("配置格式不完整，请重新采集。");
  return row;
}
