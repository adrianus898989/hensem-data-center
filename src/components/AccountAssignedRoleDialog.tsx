"use client";
import {useEffect,useRef,useState} from "react";
import type {DashboardSession} from "@/lib/dashboardAuthClient";
import {dashboardRoleAllows,type DashboardRoleAccess} from "@/lib/dashboardRoleAccess";
import {dashboardRoleRequest,type DashboardCustomRole,type DashboardRoleAccount} from "@/lib/dashboardRoleClient";
import { dashboardRoleDisplayPages } from "@/lib/dashboardRoleDisplay";
import AccountEditorDialog from "./AccountEditorDialog";

export default function AccountAssignedRoleDialog({session,account,roles,roleAccess,isOwner,editable,onSaved,onDenied,onUnconfirmed,onMutationStart,onClose}:{
 session:DashboardSession;account:DashboardRoleAccount;roles:DashboardCustomRole[];roleAccess?:DashboardRoleAccess|null;isOwner:boolean;editable:boolean;onSaved:(account:DashboardRoleAccount)=>void;onDenied?:(error:unknown)=>void;onUnconfirmed?:(confirmed?:boolean)=>void;onMutationStart?:()=> (()=>void) | null;onClose:()=>void;
}){
 const [roleId,setRoleId]=useState(account.role_id||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const identity=JSON.stringify([session.user.id,account.auth_user_id,account.assignment_version,roleAccess||null,isOwner]);
 const operation=useRef({identity,mounted:true,busy:false,controller:null as AbortController|null});
 if(operation.current.identity!==identity){operation.current={identity,mounted:true,busy:false,controller:null};}
 const lifecycle=operation.current;
 // A sent write must settle once; hiding the dialog drops its UI ACK but does not replay or cancel it.
 useEffect(()=>{lifecycle.mounted=true;return()=>{lifecycle.mounted=false;};},[identity]);
 const current=roles.find(role=>role.id===account.role_id),candidate=roles.find(role=>role.id===roleId);
 const grantable=(role:DashboardCustomRole)=>isOwner||roleAccess?.mode==="assigned"&&role.permissions.every(code=>roleAccess.permissions.includes(code));
 const choices=roles.filter(role=>role.active&&grantable(role));
 const mutable=editable&&account.role!=="owner"&&(isOwner||account.auth_user_id!==session.user.id&&dashboardRoleAllows(roleAccess,"access","edit"));
 async function save(event:React.FormEvent){
  event.preventDefault();if(lifecycle.busy||!lifecycle.mounted||operation.current!==lifecycle||busy||!mutable||!candidate||!candidate.active||!grantable(candidate)||candidate.id===account.role_id)return;
  const release=onMutationStart?.();if(onMutationStart&&!release)return;
  lifecycle.busy=true;const controller=new AbortController();lifecycle.controller=controller;
  const current=()=>lifecycle.mounted&&operation.current===lifecycle&&!controller.signal.aborted;
  let confirmed=false;
  setBusy(true);setError("");
  try{
   const result=await dashboardRoleRequest(session,{operation:"assign",accountId:account.auth_user_id,roleId:candidate.id,expectedVersion:account.assignment_version},controller.signal);
   if(!result.account)throw new Error("角色分配结果待核对，请刷新角色目录确认。");
   confirmed=true;if(!current())return;
   onSaved(result.account);onClose();
  } catch(cause){
   const detail=cause as {status?:number;code?:string};
   if([401,403].includes(detail?.status||0)||["unauthorized","forbidden","actor_changed","session_changed"].includes(detail?.code||""))onDenied?.(cause);
   else if(current())setError(cause instanceof Error?cause.message:"角色分配失败，请刷新核对");
  } finally {release?.();if(current()){lifecycle.busy=false;lifecycle.controller=null;setBusy(false);}else onUnconfirmed?.(confirmed);}
 }
 return <AccountEditorDialog title={"目录权限 · "+account.username} busy={busy} onClose={onClose}>
  <p>当前角色：<b>{current?.name||"未分配角色"}</b>。此页面显示实际生效的页面与操作权限。</p>
  {current&&<div className="admin-module-permission-grid">{Array.from(new Set(dashboardRoleDisplayPages.map(page=>page.moduleId))).map(moduleId=>{
   const pages=dashboardRoleDisplayPages.filter(page=>page.moduleId===moduleId),codes=pages.flatMap(page=>page.actions.map(action=>page.id+"."+action.id));
   return <span className="admin-module-permission-chip" key={moduleId}><span>{pages[0].moduleLabel}</span><b>{current.active?codes.filter(code=>current.permissions.includes(code)).length:0}/{codes.length}</b></span>;
  })}</div>}
  {error&&<p role="alert" className="admin-account-feedback error">{error}</p>}
  {(mutable||busy)&&<form onSubmit={save}><label>分配角色<select aria-label="分配角色" value={roleId} disabled={busy} onChange={event=>setRoleId(event.target.value)}><option value="">请选择角色</option>{choices.map(role=><option value={role.id} key={role.id}>{role.name}</option>)}</select></label><p>数据范围保持账号设置；只能分配自身已拥有权限的角色。共享角色的权限由总管理员在「角色管理」维护。</p><button type="submit" disabled={busy||!candidate||!choices.some(role=>role.id===roleId)||roleId===account.role_id}>{busy?"保存中…":"保存角色分配"}</button></form>}
 </AccountEditorDialog>;
}
