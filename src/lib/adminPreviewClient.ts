"use client";
import { ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";
export type PreviewAccess = {canView:boolean;canManage:boolean};
export type PreviewGrant = {auth_user_id:string;username:string;role:string;active:boolean;can_view:boolean};
export async function adminPreviewRequest(session:DashboardSession,query="",init:RequestInit={}):Promise<Response>{
  const current=await ensureDashboardSession(session);
  if(current.user.id!==session.user.id)throw new Error("当前登录账号已改变");
  const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,"");
  const url=new URL(base);if(url.protocol!=="https:"||url.origin!==base)throw new Error("后台地址配置无效");
  const response=await fetch(base+"/functions/v1/owner-admin-preview"+query,{...init,cache:"no-store",redirect:"error",headers:{Authorization:`Bearer ${current.access_token}`,apikey:String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""),...(init.body?{"Content-Type":"application/json"}:{})}});
  if(!response.ok)throw new Error([401,403].includes(response.status)?"当前账号没有新版后台查看权限，或会话已失效":"后台服务暂时不可用，请重试");
  return response;
}
export async function readAdminPreviewAccess(session:DashboardSession):Promise<PreviewAccess>{return (await adminPreviewRequest(session,"?action=access")).json()}
