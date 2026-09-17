"use client";
import { dashboardAuthenticatedFetch, type DashboardSession } from "./dashboardAuthClient";
export type ConfigField = {key:string;kind:"number"|"boolean";value:string|boolean|null;label:string;description:string;available:boolean;read_only:boolean};
export type Configuration = {fields:ConfigField[];groups:Array<{key:string;options:Array<{value:string;label:string;selected:boolean}>}>};
export type ConfigTarget = {country_code:string;country_name:string;platform:string;timezone:string;currency:string|null;source_system?:"AR"|"NEW_AR"};
export type ConfigSnapshot = {country_code:string;platform:string;timezone:string;observed_at:string;observed_local_date:string;received_at:string;parser_version?:string;configuration:Configuration};
export type NewARConfigField = {key:string;label:string;kind:"number"|"boolean"|"text";value:string|boolean|null;available:boolean;description:string};
export type NewARConfiguration = {
  fields:NewARConfigField[];
  channels:Array<{id:string;channelName:string;channelUrl:string;channelType:string}>;
  channelRules:Array<Record<string,string|number|boolean|null>>;
};
export type NewARConfigSnapshot = Omit<ConfigSnapshot,"configuration"> & {configuration:NewARConfiguration};
export type ConfigSummary = Pick<ConfigSnapshot,"country_code"|"platform"|"timezone"|"observed_at"|"observed_local_date">;
export function configLocalDay(timezone:string, now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  return ["year","month","day"].map(k=>parts.find(p=>p.type===k)?.value).join("-");
}
export async function readConfig<T>(table:string,query:Record<string,string>,session:DashboardSession,signal:AbortSignal):Promise<T[]> {
  const url=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/$/,"");
  const key=String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||"");
  if(!url||!key||!session.access_token)throw new Error("配置读取尚未就绪，请重新登录后重试。");
  const res=await dashboardAuthenticatedFetch(url+"/rest/v1/"+table+"?"+new URLSearchParams(query),{headers:{apikey:key,Authorization:`Bearer ${session.access_token}`},cache:"no-store",signal},session);
  if(!res.ok)throw new Error(res.status===401||res.status===403?"登录已失效或没有自动出款查看权限。":"配置读取失败，请重试。");
  const data=await res.json();if(!Array.isArray(data))throw new Error("配置响应不完整，请重试。");return data;
}
export async function fetchConfigIndex(session:DashboardSession,signal:AbortSignal) {
  const [targets,summaries]=await Promise.all([
    readConfig<ConfigTarget>("ar_config_targets",{select:"*",source_system:"eq.AR",order:"country_code,platform",limit:"1000"},session,signal),
    readConfig<ConfigSummary>("ar_config_latest",{select:"country_code,platform,timezone,observed_at,observed_local_date",limit:"1000"},session,signal)
  ]);return {targets,summaries};
}
export async function fetchConfigSnapshot(target:ConfigTarget,session:DashboardSession,signal:AbortSignal) {
  const rows=await readConfig<ConfigSnapshot>("ar_config_latest",{select:"*",country_code:"eq."+target.country_code,platform:"eq."+target.platform,limit:"1"},session,signal);
  const row=rows[0]||null;
  if(row && (!Array.isArray(row.configuration?.fields)||!Array.isArray(row.configuration?.groups)))throw new Error("配置格式不完整，请重新采集。");
  return row;
}
export async function fetchNewARConfigIndex(session:DashboardSession,signal:AbortSignal) {
  const targets=await readConfig<ConfigTarget>("ar_config_targets",{select:"*",source_system:"eq.NEW_AR",order:"country_code,platform",limit:"100"},session,signal);
  const summaries=await readConfig<ConfigSummary>("ar_config_latest",{select:"country_code,platform,timezone,observed_at,observed_local_date",limit:"1000"},session,signal);
  const keys=new Set(targets.map(t=>`${t.country_code}\u001f${t.platform}`));
  return {targets,summaries:summaries.filter(s=>keys.has(`${s.country_code}\u001f${s.platform}`))};
}
export async function fetchNewARConfigSnapshot(target:ConfigTarget,session:DashboardSession,signal:AbortSignal) {
  const rows=await readConfig<NewARConfigSnapshot>("ar_config_latest",{select:"*",country_code:"eq."+target.country_code,platform:"eq."+target.platform,limit:"1"},session,signal);
  const row=rows[0]||null;
  if(row && (!Array.isArray(row.configuration?.fields)||!Array.isArray(row.configuration?.channels)||!Array.isArray(row.configuration?.channelRules)))throw new Error("新AR配置格式不完整，请重新采集。");
  return row;
}
