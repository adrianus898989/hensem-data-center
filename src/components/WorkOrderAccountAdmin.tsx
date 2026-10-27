"use client";
import { useEffect, useRef, useState } from "react";
import type { DashboardSession } from "@/lib/dashboardAuthClient";
import { workOrderAccountRequest, type WorkOrderAccount, type WorkOrderAccountCatalog, type WorkOrderAccountFields, type WorkOrderRole, type WorkOrderPermissionRole } from "@/lib/workOrderAccountClient";
import "./WorkOrderAccountAdmin.css";
import AccountEditorDialog from "./AccountEditorDialog";
import WorkOrderRoleManager from "./WorkOrderRoleManager";
import AccountLoginPolicy, {type AccountLoginSnapshot} from "./AccountLoginPolicy";

const roles:Record<WorkOrderRole,string>={supervisor:"主管",agent:"员工",auditor:"审计员"};
type Draft=WorkOrderAccountFields & {username:string;password:string};
const fresh=():Draft=>({username:"",password:"",display_name:"",role:"agent",team:"",platforms:[],active:true});

export default function WorkOrderAccountAdmin({session,manualQuery=false,active=true,refreshVersion=0,onDirectoryChanged,onAccessDenied}:{session:DashboardSession;manualQuery?:boolean;active?:boolean;refreshVersion?:number;onDirectoryChanged?:()=>void;onAccessDenied?:()=>void}) {
  const sessionRef=useRef(session);sessionRef.current=session;
  const actor=useRef({id:session.user.id,epoch:0}),busyRef=useRef(false);
  if(actor.current.id!==session.user.id)actor.current={id:session.user.id,epoch:actor.current.epoch+1};
  const activeRef=useRef(active);activeRef.current=active;
  const mounted=useRef(true),pendingWrite=useRef(0),writeSerial=useRef(0),needsRefresh=useRef(false),lastRead=useRef("");
  const dataActor=useRef(session.user.id);
  const sameActor=(who:{id:string;epoch:number})=>mounted.current&&activeRef.current&&actor.current.id===who.id&&actor.current.epoch===who.epoch;
  const [rolesVisited,setRolesVisited]=useState(false),[readReady,setReadReady]=useState(false);
  const [view,setView]=useState<"accounts"|"roles">("accounts"),[permissionRoles,setPermissionRoles]=useState<WorkOrderPermissionRole[]>([]);
  const [rows,setRows]=useState<WorkOrderAccount[]>([]),[catalog,setCatalog]=useState<WorkOrderAccountCatalog|null>(null);
  const [loading,setLoading]=useState(!manualQuery),[loaded,setLoaded]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[query,setQuery]=useState("");
  const [nameFilter,setNameFilter]=useState(""),[roleFilter,setRoleFilter]=useState(""),[teamFilter,setTeamFilter]=useState(""),[platformFilter,setPlatformFilter]=useState(""),[statusFilter,setStatusFilter]=useState("");
  const [editing,setEditing]=useState<WorkOrderAccount|null>(null),[creating,setCreating]=useState(false),[draft,setDraft]=useState<Draft>(fresh);
  const [resetTarget,setResetTarget]=useState<WorkOrderAccount|null>(null),[password,setPassword]=useState("");
  const [securityTarget,setSecurityTarget]=useState<WorkOrderAccount|null>(null),[loginSnapshot,setLoginSnapshot]=useState<AccountLoginSnapshot>({status:"loading",states:{},failureLimit:null});
  const [scopeTargetId,setScopeTargetId]=useState<string|null>(null);
  const scopeTarget=loaded&&!loading?rows.find(row=>row.auth_user_id===scopeTargetId):undefined;
  const [revision,setRevision]=useState(0);
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(20);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;actor.current.epoch++;};},[]);
  useEffect(()=>{
    dataActor.current=session.user.id;lastRead.current="";needsRefresh.current=false;pendingWrite.current=0;busyRef.current=false;
    setRows([]);setCatalog(null);setPermissionRoles([]);setLoaded(false);setReadReady(false);setLoading(false);setBusy(false);setError("");setMessage("");closeEditor();setResetTarget(null);setPassword("");setScopeTargetId(null);setSecurityTarget(null);
  },[session.user.id]);
  useEffect(()=>{
    if(active)return;
    actor.current.epoch++;
    if(pendingWrite.current)needsRefresh.current=true;
    closeEditor();setResetTarget(null);setPassword("");setScopeTargetId(null);setSecurityTarget(null);setLoading(false);setError("");setMessage("");
  },[active]);
  useEffect(()=>{
    if(!active||view!=="accounts"||pendingWrite.current)return;
    const key=session.user.id+":"+revision+":"+refreshVersion;
    if(lastRead.current===key&&!needsRefresh.current)return;
    if(manualQuery&&revision===0&&!loaded&&!needsRefresh.current&&refreshVersion===0)return;
    const controller=new AbortController();let completed=false;lastRead.current=key;needsRefresh.current=false;
    setLoading(true);setReadReady(false);setError("");setScopeTargetId(null);setSecurityTarget(null);closeEditor();setResetTarget(null);setPassword("");
    workOrderAccountRequest(sessionRef.current,{action:"list-accounts"},controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      if(!Array.isArray(result.accounts)||!result.catalog||!Array.isArray(result.catalog.teams)||!Array.isArray(result.catalog.platforms)||!result.catalog.platformTeams)throw Error("工单账号目录返回不完整，请重试");
      setRows(result.accounts);setCatalog(result.catalog);setPermissionRoles(result.roles||[]);setLoaded(true);setReadReady(true);
    }).catch(e=>{if(!controller.signal.aborted){
      reportFailure(e,"读取工单账号失败");
    }}).finally(()=>{completed=true;if(!controller.signal.aborted)setLoading(false)});
    return()=>{if(!completed)needsRefresh.current=true;controller.abort();};
  },[session.user.id,revision,refreshVersion,manualQuery,active,view]);
  function beginWrite(){const token=++writeSerial.current;pendingWrite.current=token;busyRef.current=true;setBusy(true);setError("");setMessage("");return token;}
  function finishWrite(token:number,who:{id:string;epoch:number}){
    if(!mounted.current||actor.current.id!==who.id||pendingWrite.current!==token)return;
    pendingWrite.current=0;busyRef.current=false;setBusy(false);
    if(needsRefresh.current&&activeRef.current)setRevision(x=>x+1);
  }
  function closeEditor(){setCreating(false);setEditing(null);setDraft(fresh())}
  function startEdit(row:WorkOrderAccount){setSecurityTarget(null);setScopeTargetId(null);closeEditor();setEditing(row);setDraft({...row,password:""});setResetTarget(null);setPassword("");setError("");setMessage("")}
  function reportFailure(cause:unknown,fallback:string){
    const note=cause instanceof Error?cause.message:fallback;
    if(/无权|仅总管理员|权限|会话已失效|登录账号已改变/.test(note)){setRows([]);setCatalog(null);setPermissionRoles([]);setLoaded(false);setReadReady(false);setRolesVisited(false);setView("accounts");setLoginSnapshot({status:"error",states:{},failureLimit:null});setScopeTargetId(null);setSecurityTarget(null);closeEditor();setResetTarget(null);setPassword("");onAccessDenied?.();}
    setError(note);
  }
  function receive(row:WorkOrderAccount|undefined){if(!row)throw Error("操作返回不完整，请刷新账号列表确认结果");setRows(old=>old.some(x=>x.auth_user_id===row.auth_user_id)?old.map(x=>x.auth_user_id===row.auth_user_id?row:x):[...old,row].sort((a,b)=>a.username.localeCompare(b.username)));}
  async function save(event:React.FormEvent){
    event.preventDefault();if(!activeRef.current||busyRef.current||loading||!readReady||!catalog||(!creating&&!editing))return;
    if(!draft.platforms.length||draft.platforms.some(p=>catalog.platformTeams[p]!==draft.team)){setError("请选择所属团队和该团队的平台");return}
    const who={...actor.current},token=beginWrite();
    try{
      const {username,password,display_name,role,team,platforms,active,custom_role_id}=draft;
      const roleSelection=custom_role_id===undefined||!creating&&custom_role_id===editing?.custom_role_id?{}:{custom_role_id};
      const result=await workOrderAccountRequest(sessionRef.current,creating?{action:"create-account",username:username.trim().toLowerCase(),password,display_name:display_name.trim(),role,team,platforms,...roleSelection}:{action:"update-account",auth_user_id:editing!.auth_user_id,expected_updated_at:editing!.updated_at,patch:{display_name:display_name.trim(),role,team,platforms,active,...roleSelection}});
      if(!sameActor(who))return;receive(result.account);closeEditor();setMessage(result.message||"工单账号已保存");onDirectoryChanged?.();
    }catch(e){if(sameActor(who))reportFailure(e,"保存失败")}finally{finishWrite(token,who)}
  }
  async function toggle(row:WorkOrderAccount){
    if(!activeRef.current||busyRef.current||loading||!readReady)return;const who={...actor.current},token=beginWrite();
    try{const result=await workOrderAccountRequest(sessionRef.current,{action:"update-account",auth_user_id:row.auth_user_id,expected_updated_at:row.updated_at,patch:{active:!row.active}});if(!sameActor(who))return;receive(result.account);if(editing?.auth_user_id===row.auth_user_id)closeEditor();setMessage(row.active?"工单账号已停用":"工单账号已启用");onDirectoryChanged?.()}catch(e){if(sameActor(who))reportFailure(e,"操作失败")}finally{finishWrite(token,who)}
  }
  async function reset(event:React.FormEvent){
    event.preventDefault();if(!activeRef.current||busyRef.current||loading||!readReady||!resetTarget)return;const who={...actor.current},token=beginWrite();
    try{const result=await workOrderAccountRequest(sessionRef.current,{action:"reset-password",auth_user_id:resetTarget.auth_user_id,password});if(!sameActor(who))return;receive(result.account);setPassword("");setResetTarget(null);setMessage("工单密码已重设，请使用新密码重新登录工单系统")}catch(e){if(sameActor(who))reportFailure(e,"重设密码失败")}finally{finishWrite(token,who)}
  }
  const selectedPermissionRole=permissionRoles.find(role=>role.id===draft.custom_role_id);
  function choosePermissionRole(id:string){
    if(!id){setDraft({...draft,custom_role_id:null});return;}
    const role=permissionRoles.find(role=>role.id===id&&role.active);if(role)setDraft({...draft,role:role.base_role,custom_role_id:role.id});
  }
  function switchView(next:"accounts"|"roles"){
    if(!active||busyRef.current||loading)return;if(next==="roles")setRolesVisited(true);closeEditor();closeReset();setScopeTargetId(null);setSecurityTarget(null);setError("");setMessage("");setView(next);
  }
  const platforms=(catalog?.platforms||[]).filter(p=>catalog?.platformTeams[p]===draft.team);
  const filterTeams=Array.from(new Set([...(catalog?.teams||[]),...rows.map(row=>row.team)])).sort();
  const filterPlatforms=Array.from(new Set([...(catalog?.platforms||[]).filter(p=>!teamFilter||catalog?.platformTeams[p]===teamFilter),...rows.filter(row=>!teamFilter||row.team===teamFilter).flatMap(row=>row.platforms)])).sort();
  const visible=rows.filter(row=>row.username.toLowerCase().includes(query.trim().toLowerCase())&&row.display_name.toLowerCase().includes(nameFilter.trim().toLowerCase())&&(!roleFilter||row.role===roleFilter)&&(!teamFilter||row.team===teamFilter)&&(!platformFilter||row.platforms.includes(platformFilter))&&(!statusFilter||statusFilter==="active"&&row.active||statusFilter==="disabled"&&!row.active||statusFilter==="locked"&&loginSnapshot.status==="ready"&&loginSnapshot.states[row.auth_user_id]?.locked===true));
  function updateFilter(setter:(value:string)=>void,value:string){setPage(1);setter(value)}
  function resetFilters(){setPage(1);setQuery("");setNameFilter("");setRoleFilter("");setTeamFilter("");setPlatformFilter("");setStatusFilter("")}
  function closeReset(){setResetTarget(null);setPassword("");setError("")}
  const pageCount=Math.max(1,Math.ceil(visible.length/pageSize)),currentPage=Math.min(page,pageCount);
  const pageRows=visible.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const listState=loading&&!loaded?"loading":!loaded?error?"error":"idle":!visible.length?"empty":null;

  if(dataActor.current!==session.user.id)return null;
  return <div className="workorder-account-admin">
    <nav className="wo-account-sections" aria-label="前端工单账号管理"><button type="button" aria-pressed={view==="accounts"} disabled={!active||busy||loading} onClick={()=>switchView("accounts")}>员工账号</button><button type="button" aria-pressed={view==="roles"} disabled={!active||busy||loading} onClick={()=>switchView("roles")}>工单权限角色</button></nav>
    {rolesVisited&&<div style={view==="roles"?undefined:{display:"none"}}><WorkOrderRoleManager session={session} active={active&&view==="roles"} onRolesLoaded={setPermissionRoles} onAccessDenied={cause=>reportFailure(cause,"工单账号访问权限已失效")} onRoleSaved={role=>{setPermissionRoles(old=>old.some(r=>r.id===role.id)?old.map(r=>r.id===role.id?role:r):[...old,role]);onDirectoryChanged?.();}}/></div>}<section style={view==="accounts"?undefined:{display:"none"}} className="wo-account-card" aria-label="工单账号列表" aria-busy={loading}>
    <div className="wo-account-toolbar"><div><h3>工单账号</h3><p className="wo-account-subtitle">管理账号角色、团队与可操作平台</p></div><div className="wo-account-actions"><button type="button" disabled={!active||busy||loading} onClick={()=>{closeEditor();closeReset();setRevision(x=>x+1)}}>{loading?"读取中…":manualQuery&&!loaded?"查询账号":"刷新列表"}</button><button type="button" className="primary" aria-haspopup="dialog" disabled={!active||busy||loading||!readReady||!catalog} onClick={()=>{setSecurityTarget(null);setScopeTargetId(null);closeEditor();setCreating(true);closeReset();setMessage("")}}>新建工单账号</button></div></div>
    <div className="wo-account-filters" role="search" aria-label="筛选工单账号">
      <label>账号<input aria-label="搜索工单账号" placeholder="输入账号" value={query} onChange={e=>updateFilter(setQuery,e.target.value)}/></label>
      <label>姓名<input placeholder="输入姓名 / 显示名称" value={nameFilter} onChange={e=>updateFilter(setNameFilter,e.target.value)}/></label>
      <label>角色<select value={roleFilter} onChange={e=>updateFilter(setRoleFilter,e.target.value)}><option value="">全部角色</option>{Object.entries(roles).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>团队<select value={teamFilter} onChange={e=>{updateFilter(setTeamFilter,e.target.value);setPlatformFilter("")}}><option value="">全部团队</option>{filterTeams.map(team=><option key={team}>{team}</option>)}</select></label>
      <label>平台<select value={platformFilter} onChange={e=>updateFilter(setPlatformFilter,e.target.value)}><option value="">全部平台</option>{filterPlatforms.map(p=><option key={p}>{p}</option>)}</select></label>
      <label>状态<select value={statusFilter} onChange={e=>updateFilter(setStatusFilter,e.target.value)}><option value="">全部状态</option><option value="active">启用</option><option value="disabled">停用</option><option value="locked" disabled={loginSnapshot.status!=="ready"}>自动锁定</option></select></label>
      <button type="button" onClick={resetFilters}>重置筛选</button>
    </div>
    {error&&loaded&&!creating&&!editing&&!resetTarget&&<p role="alert" className="wo-account-error">{error}</p>}{message&&<p role="status" className="wo-account-success">{message}</p>}
    {active&&view==="accounts"&&(creating||editing)&&<AccountEditorDialog title={creating?"新建工单账号":"编辑工单账号 · "+editing?.username} busy={busy} onClose={()=>{closeEditor();setError("")}} bodyClassName="workorder-account-admin"><form className="wo-account-editor" onSubmit={save}>{error&&<p role="alert" className="wo-account-error">{error}</p>}<fieldset disabled={!active||busy||loading||!readReady}>
      <div className="wo-account-fields">{creating&&<><label>账号<input required minLength={3} maxLength={32} pattern="[a-zA-Z0-9._-]{3,32}" autoComplete="off" value={draft.username} onChange={e=>setDraft({...draft,username:e.target.value})}/></label><label>初始密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={draft.password} onChange={e=>setDraft({...draft,password:e.target.value})}/></label></>}
        <label>显示名称<input required maxLength={100} value={draft.display_name} onChange={e=>setDraft({...draft,display_name:e.target.value})}/></label><label>角色<select value={draft.role} disabled={!!draft.custom_role_id} onChange={e=>setDraft({...draft,role:e.target.value as WorkOrderRole})}>{Object.entries(roles).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>团队<select required value={draft.team} onChange={e=>setDraft({...draft,team:e.target.value,platforms:[]})}><option value="">请选择团队</option>{catalog?.teams.map(team=><option key={team}>{team}</option>)}</select></label>
      </div>
      <div className="wo-account-permission-choice"><label>工单权限角色<select aria-label="工单权限角色" value={draft.custom_role_id||""} onChange={e=>choosePermissionRole(e.target.value)}><option value="">使用原系统角色权限</option>{permissionRoles.filter(role=>role.active||role.id===draft.custom_role_id).map(role=><option key={role.id} value={role.id} disabled={!role.active}>{role.name} · {roles[role.base_role]}{role.active?"":"（已停用）"}</option>)}{!!draft.custom_role_id&&!selectedPermissionRole&&<option value={draft.custom_role_id} disabled>当前角色待读取</option>}</select></label><p>{selectedPermissionRole?"已选「"+selectedPermissionRole.name+"」，系统身份为"+roles[selectedPermissionRole.base_role]+"。账号原有独立权限裁减仍保留；角色权限与账号裁减取交集。":"未选择自建角色时，继续使用原来的系统身份权限。可在「工单权限角色」创建 UPI 查看、新增权限组合。"}</p>{selectedPermissionRole&&<div className="wo-account-permission-summary"><span>UPI 查看：{selectedPermissionRole.active&&selectedPermissionRole.permissions["provider_upis.view"]===true?"角色允许":"角色未开放"}</span><span>UPI 新增：{selectedPermissionRole.active&&selectedPermissionRole.permissions["provider_upis.add"]===true?"角色允许":"角色未开放"}</span></div>}</div>
      <div className="wo-account-platform-head"><b>可操作平台</b><button type="button" disabled={!platforms.length} onClick={()=>setDraft({...draft,platforms:[...platforms]})}>全选当前团队</button><button type="button" onClick={()=>setDraft({...draft,platforms:[]})}>清空</button><span>已选 {draft.platforms.length} 个</span></div><div className="wo-account-platforms">{platforms.map(p=><label key={p}><input type="checkbox" checked={draft.platforms.includes(p)} onChange={e=>setDraft({...draft,platforms:e.target.checked?[...draft.platforms,p]:draft.platforms.filter(x=>x!==p)})}/>{p}</label>)}{!draft.team&&<span>先选择团队，再选择平台。</span>}</div>
      <div className="wo-account-actions"><button className="primary" type="submit" disabled={!draft.platforms.length}>{busy?"保存中…":"保存账号"}</button><button type="button" onClick={closeEditor}>取消</button></div>
    </fieldset></form></AccountEditorDialog>}
    {active&&view==="accounts"&&resetTarget&&<AccountEditorDialog title={"重设工单密码 · "+resetTarget.username} busy={busy} onClose={closeReset} bodyClassName="workorder-account-admin"><form className="wo-account-editor" onSubmit={reset}>{error&&<p role="alert" className="wo-account-error">{error}</p>}<fieldset disabled={busy}><label>新密码<input aria-label="新工单密码" required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><div className="wo-account-actions"><button type="submit" className="primary">{busy?"保存中…":"保存新密码"}</button><button type="button" onClick={closeReset}>取消</button></div></fieldset></form></AccountEditorDialog>}
    {active&&view==="accounts"&&scopeTarget&&<AccountEditorDialog title={scopeTarget.username+" · 平台范围"} onClose={()=>setScopeTargetId(null)} bodyClassName="workorder-account-admin"><p className="wo-account-scope-heading">{scopeTarget.team} · 共 {scopeTarget.platforms.length} 个平台</p><ul className="wo-account-scope-list">{scopeTarget.platforms.map(platform=><li key={platform}>{platform}</li>)}</ul></AccountEditorDialog>}
    {listState&&<div className="wo-account-list-state" data-state={listState} role={listState==="error"?"alert":"status"}>
      <span className="wo-account-state-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></span>
      <h4>{listState==="loading"?"正在读取工单账号…":listState==="error"?"工单账号读取失败":listState==="idle"?"尚未查询工单账号":rows.length?"没有符合搜索条件的工单账号。":"还没有工单账号"}</h4>
      <p>{listState==="loading"?"请稍候，正在核对当前可管理的账号。":listState==="error"?error:listState==="idle"?"点击右上方“查询账号”读取账号列表。":rows.length?"调整筛选条件或点击“重置筛选”。":"查询已完成，可点击“新建工单账号”建立账号。"}</p>
    </div>}
    {loaded&&<AccountLoginPolicy active={active&&view==="accounts"&&!loading} refreshVersion={revision} onAccessDenied={()=>reportFailure(new Error("工单账号访问权限已失效"),"工单账号访问权限已失效")} session={session} surface="workorder" target={securityTarget?{id:securityTarget.auth_user_id,username:securityTarget.username,active:securityTarget.active}:null} onClose={()=>setSecurityTarget(null)} onSnapshot={setLoginSnapshot}/>}
    {loaded&&<><p className="wo-account-count">共 {rows.length} 个工单账号 · 当前显示 {pageRows.length} 个{visible.length>pageRows.length&&<span> · 筛选匹配 {visible.length} 个</span>}</p>{visible.length>0&&<div className="wo-account-table"><table><colgroup><col className="wo-col-account"/><col className="wo-col-name"/><col className="wo-col-role"/><col className="wo-col-team"/><col className="wo-col-platforms"/><col className="wo-col-status"/><col className="wo-col-actions"/></colgroup><thead><tr><th>账号</th><th>显示名称</th><th>角色</th><th>团队</th><th>平台范围</th><th>状态</th><th>操作</th></tr></thead><tbody>{pageRows.map(row=><tr key={row.auth_user_id}><td>{row.username}</td><td>{row.display_name}</td><td>{roles[row.role]||row.role}{row.custom_role_id&&<small className="wo-account-custom-role">{permissionRoles.find(role=>role.id===row.custom_role_id)?.name||"自建角色待读取"}</small>}</td><td>{row.team}</td><td className="wo-account-scope-cell"><div className="wo-account-scope-preview" title={row.platforms.join("、")}>{row.platforms.slice(0,2).join("、")||"未配置平台"}</div>{row.platforms.length>2?<button type="button" className="wo-account-scope-open" aria-haspopup="dialog" aria-label={"查看 "+row.username+" 的全部 "+row.platforms.length+" 个平台"} onClick={()=>{setSecurityTarget(null);closeEditor();closeReset();setScopeTargetId(row.auth_user_id)}}>共 {row.platforms.length} 个平台 · 查看全部</button>:<small className="wo-account-scope-count">共 {row.platforms.length} 个平台</small>}</td><td><span className={row.active?"active":"inactive"}>{row.active?"启用":"停用"}</span><small className="wo-account-login-state">{loginSnapshot.status==="ready"&&loginSnapshot.states[row.auth_user_id]?`${loginSnapshot.states[row.auth_user_id].locked?"自动锁定 · ":""}失败 ${loginSnapshot.states[row.auth_user_id].failed_count} / ${loginSnapshot.states[row.auth_user_id].failure_limit??loginSnapshot.failureLimit??"—"}`:"登录状态待读取"}</small></td><td><div className="wo-account-actions"><button disabled={!active||busy||loading||!readReady} onClick={()=>startEdit(row)}>编辑范围 / 角色</button><button disabled={!active||busy||loading||!readReady} onClick={()=>void toggle(row)}>{row.active?"停用":"启用"}</button><button disabled={!active||busy||loading||!readReady} onClick={()=>{setSecurityTarget(null);setScopeTargetId(null);closeEditor();setResetTarget(row);setPassword("");setError("");setMessage("")}}>重设密码</button><button disabled={!active||busy||loading||!readReady} aria-haspopup="dialog" onClick={()=>{setScopeTargetId(null);closeEditor();closeReset();setSecurityTarget(row)}}>登录安全</button></div></td></tr>)}</tbody></table></div>}
      {visible.length>0&&<nav className="wo-account-pagination" aria-label="工单账号分页"><span>第 {(currentPage-1)*pageSize+1}–{Math.min(currentPage*pageSize,visible.length)} 项，共 {visible.length} 项</span><div><label>每页显示 <select aria-label="每页工单账号数" value={pageSize} disabled={busy} onChange={e=>{const next=Number(e.target.value);if([20,50,100].includes(next)){setPageSize(next);setPage(1)}}}>{[20,50,100].map(size=><option key={size} value={size}>{size}</option>)}</select></label><button type="button" aria-label="工单账号上一页" disabled={busy||currentPage<=1} onClick={()=>setPage(Math.max(1,currentPage-1))}>上一页</button><span>{currentPage} / {pageCount}</span><button type="button" aria-label="工单账号下一页" disabled={busy||currentPage>=pageCount} onClick={()=>setPage(Math.min(pageCount,currentPage+1))}>下一页</button></div></nav>}
    </>}
    </section>
  </div>;
}
