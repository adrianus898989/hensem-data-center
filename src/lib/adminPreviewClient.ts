"use client";
import { ownerPreviewRefreshable, ownerPreviewTransportRead } from "./ownerPreviewVerification";
import { dashboardBootstrapReadUrl, dashboardResponseError, ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";
export type PreviewAccess = {canView:boolean;canManage:boolean};
export type PreviewGrant = {auth_user_id:string;username:string;role:string;active:boolean;can_view:boolean};
export async function adminPreviewRequest(session:DashboardSession,query="",init:RequestInit={},observeSession?:(current:DashboardSession)=>void):Promise<Response>{
  init.signal?.throwIfAborted();
  let current=await ensureDashboardSession(session);
  const observe=()=>{
    init.signal?.throwIfAborted();
    if(current.user.id!==session.user.id)throw new Error("当前登录账号已改变");
    observeSession?.(current);
  };
  observe();
  const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,"");
  const url=new URL(base);if(url.protocol!=="https:"||url.origin!==base)throw new Error("后台地址配置无效");
  const readOnly=String(init.method||"GET").toUpperCase()==="GET" && init.body==null && ["","?action=access","?check=1"].includes(query);
  const previewProxy=readOnly ? dashboardBootstrapReadUrl("preview") : null;
  const target=previewProxy ? previewProxy+query : base+"/functions/v1/owner-admin-preview"+query;
  for(let attempt=0;;attempt++){
    observe();
    const response=await ownerPreviewTransportRead(()=>fetch(target,{...init,cache:"no-store",redirect:"error",headers:{Authorization:`Bearer ${current.access_token}`,apikey:String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""),...(init.body?{"Content-Type":"application/json"}:{})}}),init.signal||undefined);
    init.signal?.throwIfAborted();
    if(response.ok)return response;
    let payload:unknown;try{payload=await ownerPreviewTransportRead(()=>response.json(),init.signal||undefined);}catch(cause){
      if(init.signal?.aborted)throw cause;payload=null;
    }
    init.signal?.throwIfAborted();
    const fallback=[401,403].includes(response.status)?"当前账号没有后台查看权限，请重新登录或联系管理员。":"后台服务暂时不可用，请重试";
    const error=dashboardResponseError(response.status,payload&&typeof payload==="object"?{code:(payload as Record<string,unknown>).code,error_code:(payload as Record<string,unknown>).error_code,message:fallback}:null,fallback);
    if(readOnly&&attempt===0&&ownerPreviewRefreshable(error)){
      current=await ensureDashboardSession(current,true);
      observe();
      continue;
    }
    throw error;
  }
}
export async function readAdminPreviewAccess(session:DashboardSession,signal?:AbortSignal):Promise<PreviewAccess>{const response=await adminPreviewRequest(session,"?action=access",{signal});return ownerPreviewTransportRead(()=>response.json(),signal)}
