"use client";
import {dashboardAuthenticatedFetch,type DashboardSession} from "./dashboardAuthClient";

export type Game66PlatformStatus = {
  team_code:"hong_kong"|"red_crab";
  team_name:string;
  platform_name:string;
  enabled:boolean;
  has_base_url:boolean;
  has_auth_secret:boolean;
  request_configured:boolean;
  charge_rows:number;
  withdraw_rows:number;
  latest_charge_at:string|null;
  latest_withdraw_at:string|null;
  latest_dictionary_at:string|null;
  latest_sync_status:string|null;
  latest_sync_at:string|null;
  latest_sync_error_count:number;
};

const text=(value:unknown):value is string=>typeof value==="string"&&value.trim().length>0;
const time=(value:unknown)=>value==null||(typeof value==="string"&&Number.isFinite(Date.parse(value)));

function valid(value:Game66PlatformStatus):boolean {
  return Boolean(value&&["hong_kong","red_crab"].includes(value.team_code)&&text(value.team_name)&&text(value.platform_name)
    &&typeof value.enabled==="boolean"&&typeof value.has_base_url==="boolean"&&typeof value.has_auth_secret==="boolean"
    &&typeof value.request_configured==="boolean"&&Number.isFinite(Number(value.charge_rows))&&Number.isFinite(Number(value.withdraw_rows))
    &&time(value.latest_charge_at)&&time(value.latest_withdraw_at)&&time(value.latest_dictionary_at)&&time(value.latest_sync_at));
}

export async function fetchGame66PlatformStatus(session:DashboardSession,signal:AbortSignal):Promise<Game66PlatformStatus[]> {
  const url=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/$/,"");
  const key=String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||"");
  if(!url||!key||!session.access_token)throw new Error("团队平台状态读取尚未就绪，请重新登录后重试。");
  const response=await dashboardAuthenticatedFetch(`${url}/rest/v1/rpc/dashboard_game66_platform_status`,{
    method:"POST",headers:{apikey:key,Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:"{}",cache:"no-store",signal,
  },session);
  if(!response.ok)throw new Error(response.status===401||response.status===403?"登录已失效或没有自动出款查看权限。":"团队平台状态读取失败，请重试。");
  const payload=await response.json();
  if(!payload||!Array.isArray(payload.rows)||!payload.rows.every(valid))throw new Error("团队平台状态响应不完整，请重试。");
  return payload.rows.map((row:Game66PlatformStatus)=>({...row,charge_rows:Number(row.charge_rows),withdraw_rows:Number(row.withdraw_rows),latest_sync_error_count:Number(row.latest_sync_error_count||0)}));
}
