"use client";
import { ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";
import {workOrderPermissionCatalog,type WorkOrderPermissionMap} from "./workOrderPermissionCatalog";

export type WorkOrderRole = "supervisor" | "agent" | "auditor";
export type WorkOrderAccount = {
  auth_user_id: string; username: string; display_name: string; role: WorkOrderRole;
  team: string; platforms: string[]; active: boolean; updated_at: string; custom_role_id?: string|null; permissions?:WorkOrderPermissionMap|null;
};
export type WorkOrderAccountCatalog = { teams: string[]; platforms: string[]; platformTeams: Record<string,string> };
export type WorkOrderAccountFields = Pick<WorkOrderAccount,"display_name"|"role"|"team"|"platforms"|"active"|"custom_role_id">;
export type WorkOrderPermissionRole={id:string;name:string;base_role:WorkOrderRole;permissions:WorkOrderPermissionMap;active:boolean;version:number;created_at?:string;updated_at?:string};
export type WorkOrderPermissionDefinition={key:string;label:string;group:string;roles:WorkOrderRole[]};
export type WorkOrderRoleRequest={action:"list-roles"}|{action:"create-role";name:string;base_role:WorkOrderRole;permissions:WorkOrderPermissionMap;active?:boolean}|{action:"update-role";id:string;expected_version:number;patch:{name?:string;permissions?:WorkOrderPermissionMap;active?:boolean}};
export type Request = { action:"list-accounts" }
  | { action:"create-account"; username:string; password:string; display_name:string; role:WorkOrderRole; team:string; platforms:string[]; custom_role_id?:string|null }
  | { action:"update-account"; auth_user_id:string; expected_updated_at:string; patch:Partial<WorkOrderAccountFields> }
  | { action:"reset-password"; auth_user_id:string; password:string } | WorkOrderRoleRequest;
export type WorkOrderAccountResponse = { ok:true; accounts?:WorkOrderAccount[]; account?:WorkOrderAccount; catalog?:WorkOrderAccountCatalog; message?:string; roles?:WorkOrderPermissionRole[]; role?:WorkOrderPermissionRole; permission_catalog?:WorkOrderPermissionDefinition[]; system_roles?:{role:WorkOrderRole;permissions:WorkOrderPermissionMap}[] };

const uid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const baseRole=(v:unknown):v is WorkOrderRole=>v==="agent"||v==="supervisor"||v==="auditor";
function validPermissions(value:unknown,role?:WorkOrderRole):value is WorkOrderPermissionMap {
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 return Object.entries(value).every(([key,value])=>{const item=workOrderPermissionCatalog.find(item=>item.key===key);return !!item&&typeof value==="boolean"&&(!role||value===false||item.roles.includes(role));});
}
export function isWorkOrderPermissionRole(value:unknown):value is WorkOrderPermissionRole {
 if(!value||typeof value!=="object"||Array.isArray(value))return false;const r=value as WorkOrderPermissionRole;
 return uid(r.id)&&typeof r.name==="string"&&!!r.name.trim()&&r.name.length<=100&&baseRole(r.base_role)&&validPermissions(r.permissions,r.base_role)&&typeof r.active==="boolean"&&Number.isSafeInteger(r.version)&&r.version>0;
}
function validateRoleRequest(request:WorkOrderRoleRequest){
 const label=(v:unknown)=>typeof v==="string"&&!!v.trim()&&v.trim().length<=100&&!/[\u0000-\u001f\u007f]/.test(v);
 if(request.action==="create-role"){
  if(!label(request.name)||!baseRole(request.base_role)||!validPermissions(request.permissions,request.base_role)||request.active!==undefined&&typeof request.active!=="boolean")throw Error("请核对工单角色名称和权限");
 }else if(request.action==="update-role"){
  if(!uid(request.id)||!Number.isSafeInteger(request.expected_version)||request.expected_version<1||!request.patch||typeof request.patch!=="object"||Array.isArray(request.patch)||!Object.keys(request.patch).length||Object.keys(request.patch).some(k=>!["name","permissions","active"].includes(k))||"name" in request.patch&&!label(request.patch.name)||"permissions" in request.patch&&!validPermissions(request.patch.permissions)||"active" in request.patch&&typeof request.patch.active!=="boolean")throw Error("请核对工单角色修改内容");
 }
}
function validateRoleResponse(request:WorkOrderRoleRequest,data:WorkOrderAccountResponse){
 if(request.action==="list-roles"){
  if(!Array.isArray(data.roles)||data.roles.some(role=>!isWorkOrderPermissionRole(role))||new Set(data.roles.map(role=>role.id)).size!==data.roles.length||!Array.isArray(data.permission_catalog)||data.permission_catalog.length!==workOrderPermissionCatalog.length||new Set(data.permission_catalog.map(item=>item.key)).size!==workOrderPermissionCatalog.length||data.permission_catalog.some(item=>{if(!item||typeof item!=="object"||Array.isArray(item))return true;const expected=workOrderPermissionCatalog.find(x=>x.key===item.key);return !expected||typeof item.label!=="string"||!item.label||typeof item.group!=="string"||!item.group||!Array.isArray(item.roles)||[...item.roles].sort().join(",")!==[...expected.roles].sort().join(",");}))throw Error("工单角色目录返回不完整，请刷新重试");
 }else if(!isWorkOrderPermissionRole(data.role))throw Error("角色保存结果不完整，请刷新列表确认结果");
}

export async function workOrderAccountRequest(session:DashboardSession, request:Request, signal?:AbortSignal):Promise<WorkOrderAccountResponse> {
  if (!["list-accounts","create-account","update-account","reset-password","list-roles","create-role","update-role"].includes(request.action)) throw Error("不支持的工单账号操作");
  if(["list-roles","create-role","update-role"].includes(request.action))validateRoleRequest(request as WorkOrderRoleRequest);
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
    if(request.action==="list-accounts"&&data.roles!==undefined&&(!Array.isArray(data.roles)||data.roles.some(role=>!isWorkOrderPermissionRole(role))||new Set(data.roles.map(role=>role.id)).size!==data.roles.length))throw Error("工单角色目录返回不完整，请刷新重试");
    if(["list-roles","create-role","update-role"].includes(request.action))validateRoleResponse(request as WorkOrderRoleRequest,data);
    return data;
  } catch(error) {
    if(timedOut&&request.action==="list-roles")throw Error("读取工单角色超时，请刷新角色列表重试");
    if(timedOut&&["create-role","update-role"].includes(request.action))throw Error("角色操作超时，结果尚未确认；请刷新角色列表核对后再操作");
    if(timedOut)throw Error(request.action==="list-accounts"?"读取工单账号超时，请刷新列表重试":request.action==="reset-password"?"重设密码请求超时，结果尚未确认；请先用新密码登录核对，勿重复提交":"工单账号操作超时，结果尚未确认；请刷新列表核对后再操作");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort",cancel);
  }
}
