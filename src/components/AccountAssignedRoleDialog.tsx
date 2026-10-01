"use client";
import {useState} from "react";
import type {DashboardSession} from "@/lib/dashboardAuthClient";
import {dashboardRoleAllows,type DashboardRoleAccess} from "@/lib/dashboardRoleAccess";
import {dashboardRolePages,dashboardRoleRequest,type DashboardCustomRole,type DashboardRoleAccount} from "@/lib/dashboardRoleClient";
import AccountEditorDialog from "./AccountEditorDialog";

export default function AccountAssignedRoleDialog({session,account,roles,roleAccess,isOwner,editable,onSaved,onClose}:{
 session:DashboardSession;account:DashboardRoleAccount;roles:DashboardCustomRole[];roleAccess?:DashboardRoleAccess|null;isOwner:boolean;editable:boolean;onSaved:()=>Promise<void>;onClose:()=>void;
}){
 const [roleId,setRoleId]=useState(account.role_id||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const current=roles.find(role=>role.id===account.role_id),candidate=roles.find(role=>role.id===roleId);
 const grantable=(role:DashboardCustomRole)=>isOwner||roleAccess?.mode==="assigned"&&role.permissions.every(code=>roleAccess.permissions.includes(code));
 const choices=roles.filter(role=>role.active&&grantable(role));
 const mutable=editable&&account.role!=="owner"&&(isOwner||account.auth_user_id!==session.user.id&&dashboardRoleAllows(roleAccess,"access","edit"));
 async function save(event:React.FormEvent){
  event.preventDefault();if(busy||!mutable||!candidate||!candidate.active||!grantable(candidate)||candidate.id===account.role_id)return;
  setBusy(true);setError("");
  try{await dashboardRoleRequest(session,{operation:"assign",accountId:account.auth_user_id,roleId:candidate.id,expectedVersion:account.assignment_version});await onSaved();onClose();}
  catch(cause){setError(cause instanceof Error?cause.message:"角色分配失败，请刷新核对");}finally{setBusy(false);}
 }
 return <AccountEditorDialog title={"目录权限 · "+account.username} busy={busy} onClose={onClose}>
  <p>当前角色：<b>{current?.name||"未分配角色"}</b>。此页面显示实际生效的新版目录权限。</p>
  {current&&<div className="admin-module-permission-grid">{Array.from(new Set(dashboardRolePages.map(page=>page.moduleId))).map(moduleId=>{
   const pages=dashboardRolePages.filter(page=>page.moduleId===moduleId),codes=pages.flatMap(page=>page.actions.map(action=>page.id+"."+action.id));
   return <span className="admin-module-permission-chip" key={moduleId}><span>{pages[0].moduleLabel}</span><b>{current.active?codes.filter(code=>current.permissions.includes(code)).length:0}/{codes.length}</b></span>;
  })}</div>}
  {error&&<p role="alert" className="admin-account-feedback error">{error}</p>}
  {mutable&&<form onSubmit={save}><label>分配新版角色<select aria-label="分配新版角色" value={roleId} disabled={busy} onChange={event=>setRoleId(event.target.value)}><option value="">请选择角色</option>{choices.map(role=><option value={role.id} key={role.id}>{role.name}</option>)}</select></label><p>数据范围保持账号设置；只能分配自身已拥有权限的角色。共享角色的权限由总管理员在「角色与目录权限」维护。</p><button type="submit" disabled={busy||!candidate||!choices.some(role=>role.id===roleId)||roleId===account.role_id}>{busy?"保存中…":"保存角色分配"}</button></form>}
 </AccountEditorDialog>;
}
