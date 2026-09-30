"use client";
import { useEffect, useRef, useState } from "react";
import type { DashboardProfile, DashboardSession } from "@/lib/dashboardAuthClient";
import { dashboardScopeLabel } from "@/lib/dashboardDataScope";
import { dashboardRolePages, dashboardRoleRequest, type DashboardCustomRole, type DashboardRoleAccount, type DashboardRoleRequest, type DashboardRoleResponse } from "@/lib/dashboardRoleClient";
import AccountEditorDialog from "./AccountEditorDialog";
import "./DashboardRoleManager.css";

const modules=Array.from(new Map(dashboardRolePages.map(page=>[page.moduleId,{id:page.moduleId,label:page.moduleLabel}])).values());
const moduleCodes=(moduleId:string)=>dashboardRolePages.filter(page=>page.moduleId===moduleId).flatMap(page=>page.actions.map(action=>page.id+"."+action.id));
type Draft={name:string;description:string;permissions:string[]};
type Editor={role:DashboardCustomRole|null;draft:Draft};
const draftOf=(role:DashboardCustomRole|null):Draft=>({name:role?.name||"",description:role?.description||"",permissions:[...(role?.permissions||[])]});
const systemRoles={owner:"总管理员",admin:"管理员",viewer:"查看账号"};
export function changeRolePermission(current:string[],code:string,checked:boolean):string[]{
 const next=new Set(current),page=code.slice(0,code.lastIndexOf("."));
 if(checked){next.add(code);next.add(page+".view");}else{next.delete(code);if(code.endsWith(".view"))for(const entry of next)if(entry.startsWith(page+"."))next.delete(entry);}
 return [...next].sort();
}
export default function DashboardRoleManager({session,profile,manualQuery=true}:{session:DashboardSession;profile:DashboardProfile;manualQuery?:boolean}){
 const allowed=profile.active===true&&profile.role==="owner"&&profile.auth_user_id===session.user.id;
 const identity=session.user.id+":"+profile.auth_user_id+":"+profile.role+":"+profile.active;
 const sessionRef=useRef(session);sessionRef.current=session;
 const actor=useRef({identity,epoch:0});if(actor.current.identity!==identity)actor.current={identity,epoch:actor.current.epoch+1};
 const controllers=useRef(new Set<AbortController>()),busyRef=useRef(false);
 const [roles,setRoles]=useState<DashboardCustomRole[]>([]),[accounts,setAccounts]=useState<DashboardRoleAccount[]>([]);
 const [dataIdentity,setDataIdentity]=useState(identity);
 const [loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [editor,setEditor]=useState<Editor|null>(null),[moduleId,setModuleId]=useState(modules[0]?.id||""),[search,setSearch]=useState("");
 const [assignment,setAssignment]=useState<{accountId:string;roleId:string}|null>(null),[archive,setArchive]=useState<DashboardCustomRole|null>(null),[accountSearch,setAccountSearch]=useState("");
 useEffect(()=>{
  setDataIdentity(identity);setRoles([]);setAccounts([]);setLoaded(false);setError("");setMessage("");setEditor(null);setAssignment(null);setArchive(null);setLoading(false);setBusy(false);busyRef.current=false;
  if(allowed&&!manualQuery)void load();
  return()=>{actor.current.epoch++;for(const controller of controllers.current)controller.abort();controllers.current.clear();};
 // The actor key invalidates every result even if the new account later switches back.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[identity,allowed,manualQuery]);
 async function request(input:DashboardRoleRequest):Promise<DashboardRoleResponse|null>{
  if(!allowed||actor.current.identity!==identity)return null;
  const epoch=actor.current.epoch,who=identity,controller=new AbortController();controllers.current.add(controller);
  try{const result=await dashboardRoleRequest(sessionRef.current,input,controller.signal);return !controller.signal.aborted&&actor.current.identity===who&&actor.current.epoch===epoch?result:null;}
  catch(cause){if(!controller.signal.aborted&&actor.current.identity===who&&actor.current.epoch===epoch)setError(cause instanceof Error?cause.message:"角色操作失败");return null;}
  finally{controllers.current.delete(controller);}
 }
 async function load(){
  if(!allowed||actor.current.identity!==identity||busyRef.current)return;
  const epoch=actor.current.epoch;busyRef.current=true;setLoading(true);setError("");setMessage("");
  const result=await request({operation:"list"});
  if(actor.current.epoch!==epoch)return;
  if(result){setDataIdentity(identity);setRoles(result.roles!);setAccounts(result.accounts!);setLoaded(true);}else{setRoles([]);setAccounts([]);setLoaded(false);}
  busyRef.current=false;setLoading(false);
 }
 async function mutate(input:DashboardRoleRequest):Promise<DashboardRoleResponse|null>{
  if(!allowed||actor.current.identity!==identity||busyRef.current)return null;
  const epoch=actor.current.epoch;busyRef.current=true;setBusy(true);setError("");setMessage("");
  const result=await request(input);
  if(actor.current.epoch!==epoch)return null;
  if(result?.role)setRoles(previous=>previous.some(role=>role.id===result.role!.id)?previous.map(role=>role.id===result.role!.id?result.role!:role):[...previous,result.role!]);
  if(result?.account)setAccounts(previous=>previous.map(account=>account.auth_user_id===result.account!.auth_user_id?result.account!:account));
  busyRef.current=false;setBusy(false);return result;
 }
 function edit(role:DashboardCustomRole|null){setError("");setMessage("");setSearch("");setModuleId(modules[0]?.id||"");setEditor({role,draft:draftOf(role)});}
 function closeEditor(){
  if(busyRef.current)return;
  if(editor&&JSON.stringify(editor.draft)!==JSON.stringify(draftOf(editor.role))&&!window.confirm("角色权限尚未保存，确定放弃这些修改吗？"))return;
  setEditor(null);setError("");
 }
 async function save(event:React.FormEvent){
  event.preventDefault();if(!editor)return;
  const {role,draft}=editor,fields={name:draft.name.trim(),description:draft.description.trim(),permissions:[...draft.permissions].sort()};
  const result=await mutate(role?{operation:"update",roleId:role.id,expectedVersion:role.version,...fields}:{operation:"create",...fields});
  if(result){setEditor(null);setMessage(role?"角色已保存，分配此角色的账号将按新权限生效":"角色已创建，可分配给现有账号");}
 }
 const visiblePages=dashboardRolePages.filter(page=>page.moduleId===moduleId&&(!search.trim()||[page.label,page.moduleLabel,page.id,...page.actions.map(action=>action.label)].join(" ").toLowerCase().includes(search.trim().toLowerCase())));
 const selectedPermissions=editor?.draft.permissions||[],selectedAccount=accounts.find(account=>account.auth_user_id===assignment?.accountId);
 const editableAccounts=accounts.filter(account=>account.role!=="owner"),activeRoles=roles.filter(role=>role.active);
 const roleName=(id:string|null)=>id?roles.find(role=>role.id===id)?.name||"角色待核对":"未分配";
 const filteredAccounts=accounts.filter(account=>[account.username,roleName(account.role_id),systemRoles[account.role]].join(" ").toLowerCase().includes(accountSearch.toLowerCase().trim()));
 function toggle(code:string,checked:boolean){setEditor(previous=>previous?{...previous,draft:{...previous.draft,permissions:changeRolePermission(previous.draft.permissions,code,checked)}}:null);}
 function selectVisible(checked:boolean){setEditor(previous=>{if(!previous)return null;let next=[...previous.draft.permissions];for(const page of visiblePages){if(checked){for(const action of page.actions)next=changeRolePermission(next,page.id+"."+action.id,true);}else next=changeRolePermission(next,page.id+".view",false);}return {...previous,draft:{...previous.draft,permissions:next}};});}
 function assign(accountId="",roleId=""){setError("");setMessage("");setAssignment({accountId,roleId});}
 async function saveAssignment(event:React.FormEvent){
  event.preventDefault();if(!assignment||!selectedAccount||selectedAccount.role==="owner"||!activeRoles.some(role=>role.id===assignment.roleId))return;
  const result=await mutate({operation:"assign",accountId:selectedAccount.auth_user_id,roleId:assignment.roleId,expectedVersion:selectedAccount.assignment_version});
  if(result){setAssignment(null);setMessage("角色已分配，账号和登录密码继续使用原来的");}
 }
 if(!allowed)return <p role="alert" className="dashboard-role-manager">仅总管理员可管理角色与分配账号。</p>;
 if(dataIdentity!==identity)return <p role="status" className="dashboard-role-manager">账号已切换，请重新查询角色与账号。</p>;
 const locked=busy||loading;
 return <div className="dashboard-role-manager">
  <div className="drm-toolbar"><div><h3>角色与账号分配</h3><p>继续使用原来的账号和密码。先配置角色，再分配给账号。</p><p className="drm-help">前端工单账号、工单操作日志、配置授权和 IP 白名单修改仍由总管理员管理。</p></div><div className="drm-actions"><button type="button" disabled={locked} onClick={()=>void load()}>查询角色与账号</button><button type="button" className="primary" disabled={locked||!loaded} onClick={()=>edit(null)}>新建角色</button></div></div>
  {!editor&&!assignment&&!archive&&error&&<p role="alert" className="drm-error">{error}</p>}{message&&<p role="status" className="drm-success">{message}</p>}
  {loading&&<p role="status">正在读取角色与账号…</p>}{!loaded&&!loading&&!error&&<p className="drm-empty">点击「查询角色与账号」查看现有配置。</p>}
  {loaded&&<><div className="drm-table"><table aria-label="角色目录权限矩阵"><thead><tr><th>角色</th>{modules.map(module=><th key={module.id}>{module.label}<small>启用 / 全部权限</small></th>)}<th>账号数</th><th>状态</th><th>操作</th></tr></thead><tbody>
   <tr className="drm-owner"><td><b>总管理员（Owner）</b><small>固定全部权限</small></td>{modules.map(module=><td key={module.id}>{moduleCodes(module.id).length} / {moduleCodes(module.id).length}</td>)}<td>{accounts.filter(account=>account.role==="owner").length}</td><td>固定</td><td>无需分配</td></tr>
   {roles.map(role=><tr key={role.id}><td><b>{role.name}</b><small>{role.description||"—"}</small></td>{modules.map(module=>{const codes=moduleCodes(module.id);return <td key={module.id}>{codes.filter(code=>role.permissions.includes(code)).length} / {codes.length}</td>;})}<td>{accounts.filter(account=>account.role_id===role.id).length}</td><td>{role.active?"启用":"已停用"}</td><td><div className="drm-actions"><button type="button" disabled={locked||!role.active} onClick={()=>edit(role)}>配置权限</button><button type="button" disabled={locked||!role.active||!editableAccounts.length} onClick={()=>assign("",role.id)}>分配账号</button><button type="button" disabled={locked||!role.active||accounts.some(account=>account.role_id===role.id)} title={accounts.some(account=>account.role_id===role.id)?"请先将使用此角色的账号分配到其他角色":undefined} onClick={()=>{setError("");setArchive(role)}}>停用角色</button></div></td></tr>)}
  </tbody></table></div>{!roles.length&&<p className="drm-empty">尚未创建自定义角色。</p>}
  <div className="drm-account-head"><h4>现有后台账号</h4><input aria-label="搜索现有账号" placeholder="搜索账号或角色" value={accountSearch} onChange={event=>setAccountSearch(event.target.value)}/></div>
  <div className="drm-table"><table aria-label="现有账号角色分配"><thead><tr><th>账号</th><th>系统身份</th><th>状态</th><th>数据范围</th><th>自定义角色</th><th>操作</th></tr></thead><tbody>{filteredAccounts.map(account=><tr key={account.auth_user_id}><td>{account.username}</td><td>{systemRoles[account.role]}</td><td>{account.active?"启用":"停用"}</td><td>{account.role==="owner"?"全部数据":dashboardScopeLabel(account.data_scope)}</td><td>{account.role==="owner"?"固定全部权限":roleName(account.role_id)}</td><td>{account.role==="owner"?<span>固定，不可修改</span>:<button type="button" disabled={locked||!activeRoles.length} onClick={()=>assign(account.auth_user_id,activeRoles.some(role=>role.id===account.role_id)?account.role_id!:"")}>分配角色</button>}</td></tr>)}</tbody></table></div></>}
  {editor&&<AccountEditorDialog title={editor.role?"配置角色 · "+editor.role.name:"新建角色"} busy={locked} onClose={closeEditor} bodyClassName="dashboard-role-editor"><form onSubmit={save}>
   <div className="drm-role-fields"><label>角色名称<input aria-label="角色名称" required maxLength={80} disabled={locked} value={editor.draft.name} onChange={event=>setEditor({...editor,draft:{...editor.draft,name:event.target.value}})}/></label><label>角色说明<input aria-label="角色说明" maxLength={500} disabled={locked} value={editor.draft.description} onChange={event=>setEditor({...editor,draft:{...editor.draft,description:event.target.value}})}/></label></div>
   {error&&<p role="alert" className="drm-error">{error}</p>}
   <div className="drm-permission-layout"><nav aria-label="角色权限模块" className="drm-modules">{modules.map(module=>{const codes=moduleCodes(module.id);return <button type="button" key={module.id} aria-pressed={moduleId===module.id} onClick={()=>setModuleId(module.id)}>{module.label}<small>{selectedPermissions.filter(code=>codes.includes(code)).length} / {codes.length}</small></button>;})}</nav>
    <div className="drm-permission-main"><div className="drm-permission-toolbar"><input aria-label="搜索目录或操作权限" placeholder="搜索当前模块的目录、操作" value={search} onChange={event=>setSearch(event.target.value)}/><button type="button" disabled={locked||!visiblePages.length} onClick={()=>selectVisible(true)}>全选当前结果</button><button type="button" disabled={locked||!visiblePages.length} onClick={()=>selectVisible(false)}>取消当前结果</button></div>
    <p className="drm-help">勾选「查看」后开放对应目录；导出、编辑等操作单独授权。数据范围沿用账号设置，敏感操作还需账号原有管理授权。</p>
    <div className="drm-permission-pages">{visiblePages.map(page=><section key={page.id} className="drm-permission-page"><h4>{page.label}</h4><div>{page.actions.map(action=>{const code=page.id+"."+action.id;return <label key={code} className={action.sensitive?"drm-sensitive":""}><input type="checkbox" aria-label={page.label+" · "+action.label} disabled={locked} checked={selectedPermissions.includes(code)} onChange={event=>toggle(code,event.target.checked)}/>{action.label}{action.sensitive&&<small>敏感操作</small>}</label>;})}</div></section>)}{!visiblePages.length&&<p className="drm-empty">当前模块没有匹配的目录。</p>}</div>
    </div></div>
   <footer className="drm-editor-footer"><span>已启用 {selectedPermissions.length} 项权限 · {dashboardRolePages.filter(page=>selectedPermissions.includes(page.id+".view")).length} 个目录</span><div className="drm-actions"><button type="button" disabled={locked} onClick={closeEditor}>取消</button><button type="submit" className="primary" disabled={locked||!editor.draft.name.trim()}>{busy?"保存中…":"保存角色"}</button></div></footer>
  </form></AccountEditorDialog>}
  {assignment&&<AccountEditorDialog title="分配角色给现有账号" busy={locked} onClose={()=>{setAssignment(null);setError("")}} bodyClassName="dashboard-role-assignment"><form onSubmit={saveAssignment}>
   {error&&<p role="alert" className="drm-error">{error}</p>}<label>现有账号<select aria-label="选择现有账号" required disabled={locked} value={assignment.accountId} onChange={event=>setAssignment({...assignment,accountId:event.target.value})}><option value="">请选择账号</option>{editableAccounts.map(account=><option key={account.auth_user_id} value={account.auth_user_id}>{account.username}{account.active?"":"（已停用）"}</option>)}</select></label>
   <label>分配角色<select aria-label="选择自定义角色" required disabled={locked} value={assignment.roleId} onChange={event=>setAssignment({...assignment,roleId:event.target.value})}><option value="">请选择角色</option>{activeRoles.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
   {selectedAccount&&<p className="drm-help">当前角色：{roleName(selectedAccount.role_id)} · 数据范围：{dashboardScopeLabel(selectedAccount.data_scope)}<br/>账号状态：{selectedAccount.active?"启用":"停用"}。分配角色后继续使用原来的账号和密码，数据范围沿用账号设置；敏感操作还需账号原有管理授权。</p>}
   <footer className="drm-editor-footer"><span>总管理员固定拥有全部权限。</span><div className="drm-actions"><button type="button" disabled={locked} onClick={()=>{setAssignment(null);setError("")}}>取消</button><button type="submit" className="primary" disabled={locked||!selectedAccount||!assignment.roleId||selectedAccount.role_id===assignment.roleId}>{busy?"保存中…":"确认分配"}</button></div></footer>
  </form></AccountEditorDialog>}
  {archive&&<AccountEditorDialog title="停用角色" busy={locked} onClose={()=>{setArchive(null);setError("")}} bodyClassName="dashboard-role-assignment">{error&&<p role="alert" className="drm-error">{error}</p>}<p>停用「{archive.name}」后，将不能再分配此角色。现有账号和密码不受影响。</p><div className="drm-actions"><button type="button" disabled={locked} onClick={()=>{setArchive(null);setError("")}}>取消</button><button type="button" disabled={locked} onClick={async()=>{const result=await mutate({operation:"archive",roleId:archive.id,expectedVersion:archive.version});if(result){setArchive(null);setMessage("角色已停用")}}}>{busy?"保存中…":"确认停用角色"}</button></div></AccountEditorDialog>}
 </div>;
}
