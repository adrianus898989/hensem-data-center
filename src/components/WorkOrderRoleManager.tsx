"use client";
import {useEffect,useRef,useState} from "react";
import type {DashboardSession} from "@/lib/dashboardAuthClient";
import {workOrderAccountRequest,type WorkOrderPermissionRole,type WorkOrderRoleRequest,type WorkOrderPermissionDefinition,type WorkOrderRole} from "@/lib/workOrderAccountClient";
import {workOrderPermissionCatalog,emptyWorkOrderPermissions,workOrderPermissionsForBase,changeWorkOrderPermission,workOrderRoleLabels,type WorkOrderPermissionMap} from "@/lib/workOrderPermissionCatalog";
import AccountEditorDialog from "./AccountEditorDialog";
import "./WorkOrderAccountAdmin.css";

type Draft={name:string;base_role:WorkOrderRole;permissions:WorkOrderPermissionMap};
type Editor={role:WorkOrderPermissionRole|null;draft:Draft};
const fresh=():Draft=>({name:"",base_role:"agent",permissions:emptyWorkOrderPermissions()});
export default function WorkOrderRoleManager({session}:{session:DashboardSession}){
 const sessionRef=useRef(session);sessionRef.current=session;
 const identity=session.user.id,actor=useRef({identity,epoch:0});
 if(actor.current.identity!==identity)actor.current={identity,epoch:actor.current.epoch+1};
 const controllers=useRef(new Set<AbortController>()),busyRef=useRef(false);
 const [dataIdentity,setDataIdentity]=useState(identity),[roles,setRoles]=useState<WorkOrderPermissionRole[]>([]),[catalog,setCatalog]=useState<WorkOrderPermissionDefinition[]>([]);
 const [loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [editor,setEditor]=useState<Editor|null>(null),[query,setQuery]=useState(""),[status,setStatus]=useState("all");
 useEffect(()=>{
  setDataIdentity(identity);setRoles([]);setCatalog([]);setLoaded(false);setLoading(false);setBusy(false);setError("");setMessage("");setEditor(null);setQuery("");setStatus("all");busyRef.current=false;
  return()=>{actor.current.epoch++;for(const controller of controllers.current)controller.abort();controllers.current.clear();};
 },[identity]);
 async function request(input:WorkOrderRoleRequest){
  const who=identity,epoch=actor.current.epoch,controller=new AbortController();controllers.current.add(controller);
  try{const value=await workOrderAccountRequest(sessionRef.current,input,controller.signal);return !controller.signal.aborted&&actor.current.identity===who&&actor.current.epoch===epoch?value:null;}
  catch(cause){if(!controller.signal.aborted&&actor.current.identity===who&&actor.current.epoch===epoch)setError(cause instanceof Error?cause.message:"工单角色操作未完成");return null;}
  finally{controllers.current.delete(controller);}
 }
 async function load(){
  if(busyRef.current||actor.current.identity!==identity)return;
  const epoch=actor.current.epoch;busyRef.current=true;setLoading(true);setError("");setMessage("");setEditor(null);
  const result=await request({action:"list-roles"});if(actor.current.epoch!==epoch)return;
  if(result&&Array.isArray(result.roles)&&Array.isArray(result.permission_catalog)){setRoles(result.roles);setCatalog(result.permission_catalog.filter(item=>item.key.startsWith("provider_upis.")).map(item=>{const display=workOrderPermissionCatalog.find(p=>p.key===item.key)!;return {...item,label:display.label,group:display.group};}));setDataIdentity(identity);setLoaded(true);}
  else{setRoles([]);setCatalog([]);setLoaded(false);}
  busyRef.current=false;setLoading(false);
 }
 async function mutate(input:WorkOrderRoleRequest){
  if(busyRef.current||!loaded||dataIdentity!==identity||actor.current.identity!==identity)return null;
  const epoch=actor.current.epoch;busyRef.current=true;setBusy(true);setError("");setMessage("");
  const result=await request(input);if(actor.current.epoch!==epoch)return null;
  if(result?.role){setRoles(old=>old.some(role=>role.id===result.role!.id)?old.map(role=>role.id===result.role!.id?result.role!:role):[...old,result.role!].sort((a,b)=>a.name.localeCompare(b.name)));}
  busyRef.current=false;setBusy(false);return result;
 }
 function open(role:WorkOrderPermissionRole|null){if(!loaded||busyRef.current)return;setError("");setMessage("");setEditor({role,draft:role?{name:role.name,base_role:role.base_role,permissions:workOrderPermissionsForBase(role.permissions,role.base_role)}:fresh()});}
 function close(){if(busyRef.current)return;setEditor(null);setError("");}
 async function save(event:React.FormEvent){
  event.preventDefault();if(!editor)return;
  const {role,draft}=editor,permissions=workOrderPermissionsForBase(draft.permissions,draft.base_role);
  const result=await mutate(role?{action:"update-role",id:role.id,expected_version:role.version,patch:{name:draft.name.trim(),permissions}}:{action:"create-role",name:draft.name.trim(),base_role:draft.base_role,permissions});
  if(result){setEditor(null);setMessage(role?"工单角色已保存，已分配员工将使用更新后的权限":"工单角色已创建；返回员工账号后可明确选择并保存分配");}
 }
 const locked=busy||loading,filtered=roles.filter(role=>(status==="all"||role.active===(status==="active"))&&role.name.toLowerCase().includes(query.trim().toLowerCase()));
 const groups=[...new Set(catalog.map(item=>item.group))],selected=editor?.draft.permissions||{};
 if(dataIdentity!==identity)return <p role="status">账号已切换，请重新查询工单角色。</p>;
 return <section className="wo-account-card wo-role-manager" aria-label="工单权限角色" aria-busy={loading}>
  <div className="wo-account-toolbar"><div><h3>工单权限角色</h3><p className="wo-account-subtitle">配置员工的 UPI 查看、新增权限；与后台页面角色分别管理</p></div><div className="wo-account-actions"><button type="button" disabled={locked} onClick={()=>void load()}>{loading?"读取角色中…":loaded?"刷新角色":"查询工单角色"}</button><button type="button" className="primary" disabled={locked||!loaded} onClick={()=>open(null)}>新建工单角色</button></div></div>
  {!editor&&error&&<p role="alert" className="wo-account-error">{error}</p>}{message&&<p role="status" className="wo-account-success">{message}</p>}
  {!loaded&&!loading&&!error&&<p className="wo-account-note">先查询工单角色，再创建或配置权限。现有员工账号继续使用原配置。</p>}
  {loading&&<p role="status" className="wo-account-note">正在读取工单角色与权限目录…</p>}
  {loaded&&<><div className="wo-role-filters" role="search" aria-label="筛选工单角色"><label>角色名称<input aria-label="搜索工单角色" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入角色名称"/></label><label>状态<select aria-label="工单角色状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部</option><option value="active">启用</option><option value="inactive">停用</option></select></label><span>显示 {filtered.length} / {roles.length} 个角色</span></div><div className="wo-role-table"><table aria-label="工单角色权限列表"><thead><tr><th>角色</th><th>系统身份</th><th>UPI 权限</th><th>UPI 查看</th><th>UPI 新增</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map(role=><tr key={role.id}><td><b>{role.name}</b></td><td>{workOrderRoleLabels[role.base_role]}</td><td>{catalog.filter(item=>role.permissions[item.key]===true).length} 项</td><td>{!role.active?"已停用":role.permissions["provider_upis.view"]===true?"允许":"未开放"}</td><td>{!role.active?"已停用":role.permissions["provider_upis.add"]===true?"允许":"未开放"}</td><td>{role.active?"启用":"停用"}</td><td><div className="wo-account-actions"><button type="button" disabled={locked} onClick={()=>open(role)}>配置权限</button><button type="button" disabled={locked} onClick={async()=>{const result=await mutate({action:"update-role",id:role.id,expected_version:role.version,patch:{active:!role.active}});if(result)setMessage(role.active?"工单角色已停用，仅收回该角色的 UPI 权限；员工账号和原工单操作保持原系统身份":"工单角色已启用，UPI 权限按角色配置和账号裁减生效");}}>{role.active?"停用工单角色":"启用工单角色"}</button></div></td></tr>)}{!filtered.length&&<tr><td colSpan={7}>没有符合条件的工单角色。</td></tr>}</tbody></table></div><p className="wo-account-note wo-role-help">分配角色不会更改员工所属团队和平台。UPI 权限与账号已有裁减取交集。停用工单角色仅收回该角色的 UPI 权限，不停用员工账号；原工单操作继续按系统身份及已有配置执行。</p></>}
  {editor&&<AccountEditorDialog title={editor.role?"配置工单角色 · "+editor.role.name:"新建工单权限角色"} busy={locked} onClose={close} bodyClassName="workorder-account-admin"><form className="wo-account-editor wo-role-editor" onSubmit={save}>{error&&<p role="alert" className="wo-account-error">{error}</p>}<fieldset disabled={locked}><div className="wo-account-fields"><label>角色名称<input aria-label="工单角色名称" required maxLength={100} value={editor.draft.name} onChange={e=>setEditor({...editor,draft:{...editor.draft,name:e.target.value}})}/></label><label>系统身份<select aria-label="工单角色系统身份" disabled={!!editor.role} value={editor.draft.base_role} onChange={e=>{const base=e.target.value as WorkOrderRole;if(base in workOrderRoleLabels)setEditor({...editor,draft:{...editor.draft,base_role:base,permissions:workOrderPermissionsForBase(editor.draft.permissions,base)}});}}>{Object.entries(workOrderRoleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div><p className="wo-role-help">本页配置 UPI 权限，工单处理沿用原系统身份和已有权限设置。新增 UPI 同时需要查看权限；未勾选的 UPI 操作不会授权。已创建角色的系统身份保持不变。</p><div className="wo-role-permission-grid">{groups.map(group=><section key={group} className="wo-role-permission-group"><h4>{group}</h4>{catalog.filter(item=>item.group===group).map(item=>{const permitted=item.roles.includes(editor.draft.base_role);return <label key={item.key} className={!permitted?"wo-role-unavailable":""}><input type="checkbox" aria-label={item.label} checked={selected[item.key]===true} disabled={!permitted} onChange={e=>setEditor({...editor,draft:{...editor.draft,permissions:changeWorkOrderPermission(editor.draft.permissions,editor.draft.base_role,item.key,e.target.checked)}})}/><span>{item.label}{!permitted&&<small>此系统身份不开放</small>}</span></label>;})}</section>)}</div><div className="wo-role-footer"><span>已选 {catalog.filter(item=>selected[item.key]===true).length} 项权限</span><div className="wo-account-actions"><button type="button" onClick={close}>取消</button><button type="submit" className="primary" disabled={!editor.draft.name.trim()}>{busy?"保存角色中…":"保存工单角色"}</button></div></div></fieldset></form></AccountEditorDialog>}
 </section>;
}
