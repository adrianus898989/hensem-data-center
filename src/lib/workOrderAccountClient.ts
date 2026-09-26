"use client";
import { ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";

export type WorkOrderRole = "supervisor" | "agent" | "auditor";
export type WorkOrderAccount = {
  auth_user_id: string; username: string; display_name: string; role: WorkOrderRole;
  team: string; platforms: string[]; active: boolean; updated_at: string;
};
export type WorkOrderAccountCatalog = { teams: string[]; platforms: string[]; platformTeams: Record<string,string> };
export type WorkOrderAccountFields = Pick<WorkOrderAccount,"display_name"|"role"|"team"|"platforms"|"active">;
type Request = { action:"list-accounts" }
  | { action:"create-account"; username:string; password:string; display_name:string; role:WorkOrderRole; team:string; platforms:string[] }
  | { action:"update-account"; auth_user_id:string; expected_updated_at:string; patch:Partial<WorkOrderAccountFields> }
  | { action:"reset-password"; auth_user_id:string; password:string };
export type WorkOrderAccountResponse = { ok:true; accounts?:WorkOrderAccount[]; account?:WorkOrderAccount; catalog?:WorkOrderAccountCatalog; message?:string };

export async function workOrderAccountRequest(session:DashboardSession, request:Request, signal?:AbortSignal):Promise<WorkOrderAccountResponse> {
  if (!["list-accounts","create-account","update-account","reset-password"].includes(request.action)) throw Error("不支持的工单账号操作");
  signal?.throwIfAborted();
  const current=await ensureDashboardSession(session);
  if(current.user.id!==session.user.id)throw Error("当前登录账号已改变，请重新打开账号管理");
  signal?.throwIfAborted();
  const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,"");
  const url=new URL(base);if(url.protocol!=="https:"||url.origin!==base)throw Error("后台地址配置无效");
  const controller=new AbortController();
  let timedOut=false;
  const cancel=()=>controller.abort(signal?.reason);
  signal?.addEventListener("abort",cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},15000);
  try {
    const response=await fetch(base+"/functions/v1/workorder-account-admin",{method:"POST",cache:"no-store",redirect:"error",signal:controller.signal,
      headers:{Authorization:`Bearer ${current.access_token}`,apikey:String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""),"Content-Type":"application/json"},body:JSON.stringify(request)});
    let data:WorkOrderAccountResponse & {code?:string};
    try{data=await response.json()}catch(error){if(controller.signal.aborted)throw error;throw Error("工单账号服务返回异常，请重试")}
    if(!response.ok||data.ok!==true)throw Error(response.status===401?"会话已失效，请重新登录":response.status===403?"仅总管理员可管理工单账号":data.message||"工单账号服务暂时不可用，请重试");
    return data;
  } catch(error) {
    if(timedOut)throw Error(request.action==="list-accounts"?"读取工单账号超时，请刷新列表重试":request.action==="reset-password"?"重设密码请求超时，结果尚未确认；请先用新密码登录核对，勿重复提交":"工单账号操作超时，结果尚未确认；请刷新列表核对后再操作");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort",cancel);
  }
}
