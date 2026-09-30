"use client";
import { ensureDashboardSession, readSavedDashboardSession, type DashboardSession } from "./dashboardAuthClient";
import catalog from "./dashboardRoleCatalog.json";

export type DashboardRolePage = { id:string; moduleId:string; moduleLabel:string; label:string; actions:{id:string;label:string;sensitive?:boolean}[]; requests:string[] };
export const dashboardRolePages: DashboardRolePage[] = (Array.isArray(catalog) ? catalog : (catalog as {pages:DashboardRolePage[]}).pages) as DashboardRolePage[];
export const dashboardRolePermissionCodes = new Set(dashboardRolePages.flatMap(page => page.actions.map(action => page.id+"."+action.id)));
const retiredPermissionCodes = new Set(["channelquality.view", "channelquality.query", "channelquality.detail", "channelquality.export"]);
export type DashboardCustomRole = { id:string; name:string; description:string; permissions:string[]; active:boolean; version:number };
export type DashboardRoleAccount = { auth_user_id:string; username:string; role:"owner"|"admin"|"viewer"; active:boolean; data_scope:unknown; role_id:string|null; assignment_version:number };
export type DashboardRoleRequest = {operation:"list"}
 | {operation:"create";name:string;description:string;permissions:string[]}
 | {operation:"update";roleId:string;name:string;description:string;permissions:string[];expectedVersion:number}
 | {operation:"archive";roleId:string;expectedVersion:number}
 | {operation:"assign";accountId:string;roleId:string;expectedVersion:number};
export type DashboardRoleResponse = {roles?:DashboardCustomRole[];accounts?:DashboardRoleAccount[];role?:DashboardCustomRole;account?:DashboardRoleAccount};
export class DashboardRoleError extends Error {
 constructor(message:string,public code:string){super(message);this.name="DashboardRoleError";}
}
const record=(value:unknown):value is Record<string,unknown> => !!value&&typeof value==="object"&&!Array.isArray(value);
const uuid=(value:unknown):value is string => typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const version=(value:unknown,min=0):value is number => Number.isSafeInteger(value)&&Number(value)>=min;
function permissionsValid(value:unknown):value is string[] {
 return Array.isArray(value)&&value.every(code=>typeof code==="string"&&dashboardRolePermissionCodes.has(code))&&new Set(value).size===value.length
  &&value.every(code=>code.endsWith(".view")||value.includes(code.slice(0,code.lastIndexOf("."))+".view"));
}
function roleValid(value:unknown):value is DashboardCustomRole {
 return record(value)&&uuid(value.id)&&typeof value.name==="string"&&value.name.trim().length>0&&value.name.length<=80
  &&typeof value.description==="string"&&value.description.length<=500&&permissionsValid(value.permissions)&&typeof value.active==="boolean"&&version(value.version,1);
}
// Existing saved roles can contain retired directory keys during a rolling update.
// Drop only those four keys on reads; never accept new unknown permissions or send
// retired keys back when creating/updating a role.
function readableRole(value:unknown):unknown {
 if(!record(value)||!Array.isArray(value.permissions))return value;
 return {...value,permissions:value.permissions.filter(code=>!retiredPermissionCodes.has(code))};
}
function scopeValid(value:unknown):boolean {
 return record(value)&&Array.isArray(value.countries)&&value.countries.every(country=>typeof country==="string"&&country.length>0)&&((value.mode==="all"&&value.countries.length===0)||value.mode==="selected");
}
function cleanRole(value:DashboardCustomRole):DashboardCustomRole {return {id:value.id,name:value.name,description:value.description,permissions:[...value.permissions],active:value.active,version:value.version};}
function cleanAccount(value:DashboardRoleAccount):DashboardRoleAccount {const scope=value.data_scope as {mode:string;countries:string[]};return {auth_user_id:value.auth_user_id,username:value.username,role:value.role,active:value.active,data_scope:{mode:scope.mode,countries:[...scope.countries]},role_id:value.role_id,assignment_version:value.assignment_version};}
function accountValid(value:unknown):value is DashboardRoleAccount {
 return record(value)&&uuid(value.auth_user_id)&&typeof value.username==="string"&&!!value.username&&["owner","admin","viewer"].includes(String(value.role))
  &&typeof value.active==="boolean"&&scopeValid(value.data_scope)&&(value.role_id===null||uuid(value.role_id))&&version(value.assignment_version)
  &&(value.role!=="owner"||value.role_id===null);
}
export function validateDashboardRoleRequest(input:unknown):DashboardRoleRequest {
 if(!record(input))throw new DashboardRoleError("角色操作参数无效","invalid_request");
 const keys:Record<string,string[]>={list:["operation"],create:["operation","name","description","permissions"],update:["operation","roleId","name","description","permissions","expectedVersion"],archive:["operation","roleId","expectedVersion"],assign:["operation","accountId","roleId","expectedVersion"]};
 const allowed=keys[String(input.operation)];
 if(!allowed||Object.keys(input).some(key=>!allowed.includes(key))||allowed.some(key=>!(key in input)))throw new DashboardRoleError("角色操作参数无效","invalid_request");
 if(["create","update"].includes(String(input.operation))&&(typeof input.name!=="string"||!input.name.trim()||input.name.length>80||typeof input.description!=="string"||input.description.length>500||!permissionsValid(input.permissions)))throw new DashboardRoleError("请填写角色名称，并检查目录与操作权限","invalid_request");
 if(input.operation!=="list"&&input.operation!=="create"&&(!uuid(input.roleId)||!version(input.expectedVersion,input.operation==="assign"?0:1)))throw new DashboardRoleError("角色版本或标识无效，请重新查询","invalid_request");
 if(input.operation==="assign"&&!uuid(input.accountId))throw new DashboardRoleError("账号标识无效","invalid_request");
 return input as DashboardRoleRequest;
}
export function validateDashboardRoleResponse(input:unknown,request:DashboardRoleRequest):DashboardRoleResponse {
 const invalid=()=>{throw new DashboardRoleError(request.operation==="list"?"角色与账号响应不完整，请重新查询":"操作响应不完整，结果尚未确认；请查询角色与账号核对后再操作","invalid_response")};
 if(!record(input)||input.ok===false)return invalid();
 if(request.operation==="list"){
  if(!Array.isArray(input.roles)||!Array.isArray(input.accounts)||!input.accounts.every(accountValid))return invalid();
  const roles=input.roles.map(readableRole);
  if(!roles.every(roleValid))return invalid();
  if(new Set(roles.map(r=>r.id)).size!==roles.length||new Set(input.accounts.map(a=>a.auth_user_id)).size!==input.accounts.length)return invalid();
  const knownRoleIds=new Set(roles.map(role=>role.id));
  if(input.accounts.some(account=>account.role_id&&!knownRoleIds.has(account.role_id)))return invalid();
  return {roles:roles.map(cleanRole),accounts:input.accounts.map(cleanAccount)};
 }
 if(request.operation==="assign"){
  if(!accountValid(input.account)||input.account.auth_user_id!==request.accountId||input.account.role==="owner"||input.account.role_id!==request.roleId||input.account.assignment_version<=request.expectedVersion)return invalid();
  return {account:cleanAccount(input.account)};
 }
 const role=request.operation==="archive"?readableRole(input.role):input.role;
 if(!roleValid(role))return invalid();
 if(request.operation!=="create"&&(role.id!==request.roleId||role.version<=request.expectedVersion))return invalid();
 if(request.operation==="archive"?role.active:!role.active)return invalid();
 if(request.operation!=="archive"&&(role.name!==request.name.trim()||role.description!==request.description.trim()||[...role.permissions].sort().join("|")!==[...request.permissions].sort().join("|")))return invalid();
 return {role:cleanRole(role)};
}

export async function dashboardRoleRequest(session:DashboardSession,input:DashboardRoleRequest,signal?:AbortSignal):Promise<DashboardRoleResponse>{
 const request=validateDashboardRoleRequest(input),actor=session.user.id,started=readSavedDashboardSession();
 const guard=()=>{const saved=readSavedDashboardSession();if(saved&&saved.user.id!==actor||started&&!saved)throw new DashboardRoleError("当前登录账号已改变，请重新打开角色管理","actor_changed");signal?.throwIfAborted();};
 guard();const current=await ensureDashboardSession(session);guard();
 if(current.user.id!==actor)throw new DashboardRoleError("当前登录账号已改变，请重新打开角色管理","actor_changed");
 const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,""),url=new URL(base);
 if(url.protocol!=="https:"||url.origin!==base)throw new DashboardRoleError("后台地址配置无效","invalid_config");
 const controller=new AbortController();let timedOut=false;
 const cancel=()=>controller.abort(signal?.reason);signal?.addEventListener("abort",cancel,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},15000);
 try{
  const response=await fetch(base+"/rest/v1/rpc/dashboard_role_manage",{method:"POST",cache:"no-store",redirect:"error",credentials:"omit",signal:controller.signal,headers:{Authorization:`Bearer ${current.access_token}`,apikey:String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""),"Content-Type":"application/json"},body:JSON.stringify({p_request:request})});
  const data:unknown=await response.json();guard();
  if(!response.ok||record(data)&&data.ok===false){
   const code=record(data)?String(data.code||data.error||""):"",message=record(data)?String(data.message||""):"";
   if(response.status===409||/conflict|version|stale/i.test(code+" "+message))throw new DashboardRoleError("已被其他管理员修改，草稿已保留；请重新查询后核对再保存","conflict");
   if(response.status===401)throw new DashboardRoleError("会话已失效，请重新登录","unauthorized");
   if(response.status===403||/owner|denied|forbidden/i.test(code+" "+message))throw new DashboardRoleError("仅总管理员可管理角色与分配账号","forbidden");
   if(/assigned|in_use/i.test(code+" "+message))throw new DashboardRoleError("此角色仍有账号使用，请先为这些账号分配其他角色","role_in_use");
   if(/duplicate|name_exists|23505/i.test(code+" "+message))throw new DashboardRoleError("角色名称已存在，请使用其他名称","duplicate");
   if(response.status>=500||/^42[0-9A-Z]{3}$/.test(code))throw new DashboardRoleError("角色服务处理失败，请稍后重试","backend_error");
   throw new DashboardRoleError("角色操作未完成，请检查内容后重试","request_failed");
  }
  return validateDashboardRoleResponse(data,request);
 }catch(error){
  guard();
  if(timedOut)throw new DashboardRoleError(request.operation==="list"?"读取角色与账号超时，请重新查询":"操作超时，结果尚未确认；请查询角色与账号核对后再操作","timeout");
  if(error instanceof DashboardRoleError)throw error;
  throw new DashboardRoleError(request.operation==="list"?"读取角色与账号失败，请重新查询":"连接中断，操作结果尚未确认；请查询角色与账号核对后再操作","network_error");
 }finally{clearTimeout(timer);signal?.removeEventListener("abort",cancel);}
}
