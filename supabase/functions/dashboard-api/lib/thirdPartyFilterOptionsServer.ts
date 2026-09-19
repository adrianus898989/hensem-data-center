import { dashboardScopeAllows } from "./dashboardDataScope.ts";
import { canonicalThirdPartyPlatform } from "./thirdPartyPlatform.ts";
import { platformDisplayCountry } from "./platformDisplayCountry.ts";
import { DashboardDataAccessError, requireDashboardDataAccess } from "./dashboardDataAccessServer.ts";

export type ThirdPartyFilterOptions = {platforms:Array<{country:string;platform:string}>};

function unavailable(): never {
  throw new DashboardDataAccessError(503,"filter_options_unavailable","平台目录读取暂时不可用，请重试。");
}
function descriptor(value:unknown):value is string {
  return typeof value==="string" && value===value.trim() && value.length>0 && value.length<=120
    && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Independent metadata request: never delegates to volume/time/order queries. */
export async function readSupabaseThirdPartyFilterOptions(request:Request):Promise<ThirdPartyFilterOptions> {
  const access=await requireDashboardDataAccess(request,"third_party");
  const env=(name:string):string=>String((globalThis as any).Deno?.env?.get?.(name)
    || (typeof process!=="undefined"?process.env[name]:"") || "").trim();
  const url=(env("SUPABASE_URL")||env("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/$/,"");
  const key=env("SUPABASE_ANON_KEY")||env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const response=await fetch(url+"/rest/v1/rpc/dashboard_third_party_filter_options",{
    method:"POST",headers:{apikey:key,Authorization:`Bearer ${access.token}`,
      Accept:"application/json","Content-Type":"application/json"},
    body:"{}",cache:"no-store",redirect:"error",
    signal:AbortSignal.any([request.signal,AbortSignal.timeout(8000)]),
  });
  if(response.status===401)throw new DashboardDataAccessError(401,"login_required","登录已失效，请重新登录。");
  if(response.status===403)throw new DashboardDataAccessError(403,"data_denied","当前账号没有此数据查看权限。");
  if(!response.ok)unavailable();
  let payload:any;
  try{payload=await response.json();}catch{unavailable();}
  if(!payload || !Array.isArray(payload.platforms) || payload.platforms.length>10000
    || !payload.platforms.every((row:any)=>row && descriptor(row.country) && descriptor(row.platform)))unavailable();
  // Recheck current scope and project only the contract fields, even if a
  // database rollout accidentally returns unrelated metadata.
  const byKey=new Map<string,{country:string;platform:string}>();
  for(const row of payload.platforms) {
    if(!dashboardScopeAllows(access.scope,row.country,row.platform))continue;
    const platform=canonicalThirdPartyPlatform(row.country,row.platform);
    const country=platformDisplayCountry(row.country,platform);
    if(!dashboardScopeAllows(access.scope,country,platform))continue;
    byKey.set(JSON.stringify([country,platform]),{country,platform});
  }
  return {platforms:[...byKey.values()].sort((a,b)=>a.country.localeCompare(b.country,"zh-CN")
    || a.platform.localeCompare(b.platform,"zh-CN",{numeric:true}))};
}
