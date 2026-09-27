"use client";
import { useEffect, useRef, useState } from "react";
import type { DashboardSession } from "@/lib/dashboardAuthClient";
import { workOrderAccountRequest, type WorkOrderAccount, type WorkOrderAccountCatalog, type WorkOrderAccountFields, type WorkOrderRole } from "@/lib/workOrderAccountClient";
import "./WorkOrderAccountAdmin.css";
import AccountEditorDialog from "./AccountEditorDialog";

const roles:Record<WorkOrderRole,string>={supervisor:"主管",agent:"员工",auditor:"审计员"};
type Draft=WorkOrderAccountFields & {username:string;password:string};
const fresh=():Draft=>({username:"",password:"",display_name:"",role:"agent",team:"",platforms:[],active:true});

export default function WorkOrderAccountAdmin({session}:{session:DashboardSession}) {
  const sessionRef=useRef(session);sessionRef.current=session;
  const [rows,setRows]=useState<WorkOrderAccount[]>([]),[catalog,setCatalog]=useState<WorkOrderAccountCatalog|null>(null);
  const [loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[query,setQuery]=useState("");
  const [nameFilter,setNameFilter]=useState(""),[roleFilter,setRoleFilter]=useState(""),[teamFilter,setTeamFilter]=useState(""),[platformFilter,setPlatformFilter]=useState(""),[statusFilter,setStatusFilter]=useState("");
  const [editing,setEditing]=useState<WorkOrderAccount|null>(null),[creating,setCreating]=useState(false),[draft,setDraft]=useState<Draft>(fresh);
  const [resetTarget,setResetTarget]=useState<WorkOrderAccount|null>(null),[password,setPassword]=useState("");
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");
    workOrderAccountRequest(sessionRef.current,{action:"list-accounts"},controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      if(!Array.isArray(result.accounts)||!result.catalog||!Array.isArray(result.catalog.teams)||!Array.isArray(result.catalog.platforms)||!result.catalog.platformTeams)throw Error("工单账号目录返回不完整，请重试");
      setRows(result.accounts);setCatalog(result.catalog);setLoaded(true);
    }).catch(e=>{if(!controller.signal.aborted){setRows([]);setCatalog(null);setLoaded(false);setError(e instanceof Error?e.message:"读取工单账号失败")}}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[session.user.id,revision]);
  function closeEditor(){setCreating(false);setEditing(null);setDraft(fresh())}
  function startEdit(row:WorkOrderAccount){closeEditor();setEditing(row);setDraft({...row,password:""});setResetTarget(null);setPassword("");setError("");setMessage("")}
  function receive(row:WorkOrderAccount|undefined){if(!row)throw Error("操作返回不完整，请刷新账号列表确认结果");setRows(old=>old.some(x=>x.auth_user_id===row.auth_user_id)?old.map(x=>x.auth_user_id===row.auth_user_id?row:x):[...old,row].sort((a,b)=>a.username.localeCompare(b.username)));}
  async function save(event:React.FormEvent){
    event.preventDefault();if(busy||loading||!catalog||(!creating&&!editing))return;
    if(!draft.platforms.length||draft.platforms.some(p=>catalog.platformTeams[p]!==draft.team)){setError("请选择所属团队和该团队的平台");return}
    setBusy(true);setError("");setMessage("");
    try{
      const {username,password,display_name,role,team,platforms,active}=draft;
      const result=await workOrderAccountRequest(sessionRef.current,creating?{action:"create-account",username:username.trim().toLowerCase(),password,display_name:display_name.trim(),role,team,platforms}:{action:"update-account",auth_user_id:editing!.auth_user_id,expected_updated_at:editing!.updated_at,patch:{display_name:display_name.trim(),role,team,platforms,active}});
      receive(result.account);closeEditor();setMessage(result.message||"工单账号已保存");
    }catch(e){setError(e instanceof Error?e.message:"保存失败")}finally{setBusy(false)}
  }
  async function toggle(row:WorkOrderAccount){
    if(busy||loading)return;setBusy(true);setError("");setMessage("");
    try{const result=await workOrderAccountRequest(sessionRef.current,{action:"update-account",auth_user_id:row.auth_user_id,expected_updated_at:row.updated_at,patch:{active:!row.active}});receive(result.account);if(editing?.auth_user_id===row.auth_user_id)closeEditor();setMessage(row.active?"工单账号已停用":"工单账号已启用")}catch(e){setError(e instanceof Error?e.message:"操作失败")}finally{setBusy(false)}
  }
  async function reset(event:React.FormEvent){
    event.preventDefault();if(busy||!resetTarget)return;setBusy(true);setError("");setMessage("");
    try{const result=await workOrderAccountRequest(sessionRef.current,{action:"reset-password",auth_user_id:resetTarget.auth_user_id,password});receive(result.account);setPassword("");setResetTarget(null);setMessage("工单密码已重设，请使用新密码重新登录工单系统")}catch(e){setError(e instanceof Error?e.message:"重设密码失败")}finally{setBusy(false)}
  }
  const platforms=(catalog?.platforms||[]).filter(p=>catalog?.platformTeams[p]===draft.team);
  const filterTeams=Array.from(new Set([...(catalog?.teams||[]),...rows.map(row=>row.team)])).sort();
  const filterPlatforms=Array.from(new Set([...(catalog?.platforms||[]).filter(p=>!teamFilter||catalog?.platformTeams[p]===teamFilter),...rows.filter(row=>!teamFilter||row.team===teamFilter).flatMap(row=>row.platforms)])).sort();
  const visible=rows.filter(row=>row.username.toLowerCase().includes(query.trim().toLowerCase())&&row.display_name.toLowerCase().includes(nameFilter.trim().toLowerCase())&&(!roleFilter||row.role===roleFilter)&&(!teamFilter||row.team===teamFilter)&&(!platformFilter||row.platforms.includes(platformFilter))&&(!statusFilter||row.active===(statusFilter==="active")));
  function resetFilters(){setQuery("");setNameFilter("");setRoleFilter("");setTeamFilter("");setPlatformFilter("");setStatusFilter("")}
  function closeReset(){setResetTarget(null);setPassword("");setError("")}

  return <div className="workorder-account-admin">
    <div className="wo-account-toolbar"><h3>工单账号</h3><div className="wo-account-actions"><button type="button" disabled={busy||loading} onClick={()=>{closeEditor();closeReset();setRevision(x=>x+1)}}>刷新列表</button><button type="button" className="primary" aria-haspopup="dialog" disabled={busy||loading||!catalog} onClick={()=>{closeEditor();setCreating(true);closeReset();setMessage("")}}>新建工单账号</button></div></div>
    <div className="wo-account-filters">
      <label>账号<input aria-label="搜索工单账号" placeholder="输入账号" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label>姓名<input placeholder="输入姓名 / 显示名称" value={nameFilter} onChange={e=>setNameFilter(e.target.value)}/></label>
      <label>角色<select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="">全部角色</option>{Object.entries(roles).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>团队<select value={teamFilter} onChange={e=>{setTeamFilter(e.target.value);setPlatformFilter("")}}><option value="">全部团队</option>{filterTeams.map(team=><option key={team}>{team}</option>)}</select></label>
      <label>平台<select value={platformFilter} onChange={e=>setPlatformFilter(e.target.value)}><option value="">全部平台</option>{filterPlatforms.map(p=><option key={p}>{p}</option>)}</select></label>
      <label>状态<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select></label>
      <button type="button" onClick={resetFilters}>重置筛选</button>
    </div>
    {error&&!creating&&!editing&&!resetTarget&&<p role="alert" className="wo-account-error">{error}</p>}{message&&<p role="status" className="wo-account-success">{message}</p>}
    {(creating||editing)&&<AccountEditorDialog title={creating?"新建工单账号":"编辑工单账号 · "+editing?.username} busy={busy} onClose={()=>{closeEditor();setError("")}} bodyClassName="workorder-account-admin"><form className="wo-account-editor" onSubmit={save}>{error&&<p role="alert" className="wo-account-error">{error}</p>}<fieldset disabled={busy||loading}>
      <div className="wo-account-fields">{creating&&<><label>账号<input required minLength={3} maxLength={32} pattern="[a-zA-Z0-9._-]{3,32}" autoComplete="off" value={draft.username} onChange={e=>setDraft({...draft,username:e.target.value})}/></label><label>初始密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={draft.password} onChange={e=>setDraft({...draft,password:e.target.value})}/></label></>}
        <label>显示名称<input required maxLength={100} value={draft.display_name} onChange={e=>setDraft({...draft,display_name:e.target.value})}/></label><label>角色<select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as WorkOrderRole})}>{Object.entries(roles).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>团队<select required value={draft.team} onChange={e=>setDraft({...draft,team:e.target.value,platforms:[]})}><option value="">请选择团队</option>{catalog?.teams.map(team=><option key={team}>{team}</option>)}</select></label>
      </div>
      <div className="wo-account-platform-head"><b>可操作平台</b><button type="button" disabled={!platforms.length} onClick={()=>setDraft({...draft,platforms:[...platforms]})}>全选当前团队</button><button type="button" onClick={()=>setDraft({...draft,platforms:[]})}>清空</button><span>已选 {draft.platforms.length} 个</span></div><div className="wo-account-platforms">{platforms.map(p=><label key={p}><input type="checkbox" checked={draft.platforms.includes(p)} onChange={e=>setDraft({...draft,platforms:e.target.checked?[...draft.platforms,p]:draft.platforms.filter(x=>x!==p)})}/>{p}</label>)}{!draft.team&&<span>先选择团队，再选择平台。</span>}</div>
      <div className="wo-account-actions"><button className="primary" type="submit" disabled={!draft.platforms.length}>{busy?"保存中…":"保存账号"}</button><button type="button" onClick={closeEditor}>取消</button></div>
    </fieldset></form></AccountEditorDialog>}
    {resetTarget&&<AccountEditorDialog title={"重设工单密码 · "+resetTarget.username} busy={busy} onClose={closeReset} bodyClassName="workorder-account-admin"><form className="wo-account-editor" onSubmit={reset}>{error&&<p role="alert" className="wo-account-error">{error}</p>}<fieldset disabled={busy}><label>新密码<input aria-label="新工单密码" required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><div className="wo-account-actions"><button type="submit" className="primary">{busy?"保存中…":"保存新密码"}</button><button type="button" onClick={closeReset}>取消</button></div></fieldset></form></AccountEditorDialog>}
    {loading&&<p role="status">正在读取工单账号…</p>}
    {loaded&&<><p className="wo-account-count">共 {rows.length} 个工单账号 · 当前显示 {visible.length} 个</p><div className="wo-account-table"><table><thead><tr><th>账号</th><th>显示名称</th><th>角色</th><th>团队</th><th>平台范围</th><th>状态</th><th>操作</th></tr></thead><tbody>{visible.map(row=><tr key={row.auth_user_id}><td>{row.username}</td><td>{row.display_name}</td><td>{roles[row.role]||row.role}</td><td>{row.team}</td><td>{row.platforms.join("、")}</td><td><span className={row.active?"active":"inactive"}>{row.active?"启用":"停用"}</span></td><td><div className="wo-account-actions"><button disabled={busy||loading} onClick={()=>startEdit(row)}>编辑范围 / 角色</button><button disabled={busy||loading} onClick={()=>void toggle(row)}>{row.active?"停用":"启用"}</button><button disabled={busy||loading} onClick={()=>{closeEditor();setResetTarget(row);setPassword("");setError("");setMessage("")}}>重设密码</button></div></td></tr>)}</tbody></table>{!visible.length&&!loading&&!error&&<p className="wo-account-empty">{rows.length?"没有符合搜索条件的工单账号。":"还没有工单账号，可点击“新建工单账号”。"}</p>}</div></>}
  </div>;
}
