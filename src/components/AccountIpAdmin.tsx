"use client";
import { useEffect, useRef, useState } from "react";
import type { DashboardSession } from "@/lib/dashboardAuthClient";
import { securityRequest, type AccountSurface, type IpRule, type SecurityPolicy } from "@/lib/accountSecurityClient";
import AccountEditorDialog from "./AccountEditorDialog";
import "./AccountIpAdmin.css";

export default function AccountIpAdmin({session}:{session:DashboardSession}) {
 const sessionRef=useRef(session);sessionRef.current=session;
 const [surface,setSurface]=useState<AccountSurface>("workorder"),[rows,setRows]=useState<IpRule[]>([]),[policy,setPolicy]=useState<SecurityPolicy|null>(null),[currentIp,setCurrentIp]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[revision,setRevision]=useState(0);
 const [query,setQuery]=useState(""),[status,setStatus]=useState("all"),[editor,setEditor]=useState<IpRule|"new"|null>(null),[network,setNetwork]=useState(""),[note,setNote]=useState("");
 const [confirm,setConfirm]=useState<{kind:"mode"}|{kind:"delete";rule:IpRule}|null>(null);
 const label=surface==="workorder"?"前端工单":"后台";
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setPolicy(null);setRows([]);setCurrentIp("");setError("");
  securityRequest(sessionRef.current,{action:"list-rules",surface},controller.signal).then(result=>{
   if(controller.signal.aborted)return;
   if(!result.policy||!Array.isArray(result.rules))throw Error("白名单返回不完整，请刷新重试");
   setPolicy(result.policy);setRows(result.rules);setCurrentIp(result.currentIp||"");
  }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"读取白名单失败")}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[surface,revision,session.user.id]);
 function switchSurface(next:AccountSurface){if(busy||next===surface)return;setLoading(true);setPolicy(null);setRows([]);setCurrentIp("");setError("");setSurface(next);setEditor(null);setConfirm(null);setQuery("");setStatus("all");setMessage("")}
 function edit(row:IpRule|"new"){setEditor(row);setNetwork(row==="new"?"":row.network);setNote(row==="new"?"":row.note);setError("")}
 async function mutate(body:Record<string,unknown>&{action:string},done:string){
  if(busy||loading)return;setBusy(true);setError("");setMessage("");
  try{await securityRequest(sessionRef.current,{...body,surface});setEditor(null);setConfirm(null);setMessage(done);setRevision(n=>n+1)}catch(e){setError(e instanceof Error?e.message:"操作失败")}finally{setBusy(false)}
 }
 function save(e:React.FormEvent){e.preventDefault();if(!editor)return;void mutate({action:"upsert-rule",network:network.trim(),note:note.trim(),...(editor==="new"?{}:{id:editor.id,expected_version:editor.version})},"IP 规则已保存")}
 const visible=rows.filter(row=>(status==="all"||(status==="active")===row.active)&&[row.network,row.note].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
 return <div className="account-ip-admin">
  <div role="tablist" aria-label="IP 白名单入口" className="owner-preview-account-tabs">{(["workorder","dashboard"] as const).map(value=><button key={value} type="button" role="tab" aria-selected={surface===value} disabled={busy} onClick={()=>switchSurface(value)}>{value==="workorder"?"前端工单白名单":"后台白名单"}</button>)}</div>
  <section className="account-ip-policy"><div><h3>{label}登录限制</h3><p>当前 IP：<b>{loading?"读取中":currentIp||"未取得"}</b></p></div><div><span className={policy?.ip_enabled?"ip-enabled":"ip-off"}>{policy?(policy.ip_enabled?"已开启白名单":"未开启白名单"):"待读取"}</span><button type="button" disabled={busy||loading||!policy} onClick={()=>{setError("");setConfirm({kind:"mode"})}}>{policy?.ip_enabled?"关闭限制":"开启限制"}</button></div></section>
  <div className="account-ip-toolbar"><label>IP / 备注<input aria-label="搜索 IP 或备注" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入 IP、网段或备注"/></label><label>规则状态<select aria-label="IP 规则状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="active">启用</option><option value="inactive">停用</option></select></label><button type="button" disabled={busy||loading} onClick={()=>setRevision(n=>n+1)}>刷新</button><button className="primary" type="button" disabled={busy||loading||!policy} onClick={()=>edit("new")}>新增 IP</button></div>
  {error&&!editor&&!confirm&&<p role="alert" className="ip-error">{error}</p>}{message&&<p role="status" className="ip-success">{message}</p>}
  <div className="account-ip-table"><table><thead><tr><th>IP / 网段</th><th>备注</th><th>状态</th><th>操作</th></tr></thead><tbody>{visible.map(row=><tr key={row.id}><td>{row.network}</td><td>{row.note||"—"}</td><td><span className={row.active?"ip-enabled":"ip-off"}>{row.active?"启用":"停用"}</span></td><td><button type="button" disabled={busy||loading} onClick={()=>edit(row)}>编辑</button><button type="button" disabled={busy||loading} onClick={()=>void mutate({action:"set-rule-active",id:row.id,active:!row.active,expected_version:row.version},row.active?"IP 规则已停用":"IP 规则已启用")}>{row.active?"停用":"启用"}</button><button className="danger" type="button" disabled={busy||loading} onClick={()=>{setError("");setConfirm({kind:"delete",rule:row})}}>移除</button></td></tr>)}</tbody></table>{!visible.length&&<div className="ip-empty">{loading?"正在读取白名单…":!policy?"未取得白名单，请刷新重试":rows.length?"没有符合条件的规则":"尚未添加 IP 规则"}</div>}</div>
  <p className="ip-footnote">前端与后台的登录 IP 白名单独立设置。支持 IPv4、IPv6 及 CIDR 网段。</p>
  {editor&&<AccountEditorDialog title={(editor==="new"?"新增":"编辑")+label+" IP"} busy={busy} onClose={()=>setEditor(null)} bodyClassName="account-ip-admin"><form onSubmit={save}><fieldset disabled={busy}><label>IP / 网段<input required maxLength={64} autoComplete="off" value={network} onChange={e=>setNetwork(e.target.value)} placeholder="例如 203.0.113.8 或 203.0.113.0/24"/></label>{currentIp&&<button type="button" onClick={()=>setNetwork(currentIp)}>填入当前 IP</button>}<label>备注<input maxLength={120} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如办公室"/></label>{error&&<p role="alert" className="ip-error">{error}</p>}<footer><button type="button" onClick={()=>setEditor(null)}>取消</button><button type="submit" className="primary">保存</button></footer></fieldset></form></AccountEditorDialog>}
  {confirm&&<AccountEditorDialog title={confirm.kind==="delete"?"移除 IP 规则":`${policy?.ip_enabled?"关闭":"开启"}${label}白名单`} busy={busy} onClose={()=>setConfirm(null)} bodyClassName="account-ip-admin"><p>{confirm.kind==="delete"?`移除 ${confirm.rule.network}？此 IP 将不再通过该规则获得访问。`:policy?.ip_enabled?`${label}登录将不再限制来源 IP，账号与密码验证仍然生效。`:`仅允许启用规则内的 IP 登录${label}。`}</p>{error&&<p role="alert" className="ip-error">{error}</p>}<footer><button type="button" disabled={busy} onClick={()=>setConfirm(null)}>取消</button><button className="primary" type="button" disabled={busy||!policy} onClick={()=>void(confirm.kind==="delete"?mutate({action:"delete-rule",id:confirm.rule.id,expected_version:confirm.rule.version},"IP 规则已移除"):mutate({action:"policy",patch:{ip_enabled:!policy!.ip_enabled},expected_version:policy!.version},"登录限制已更新"))}>确认</button></footer></AccountEditorDialog>}
 </div>;
}
