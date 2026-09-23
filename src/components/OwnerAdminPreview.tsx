"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DashboardProfile, type DashboardSession } from "@/lib/dashboardAuthClient";
import { makeOwnerPreviewDocument, OWNER_PREVIEW_DRAFT_KEYS, ownerPreviewDraftAllowed } from "@/lib/ownerPreviewDocument";

import { adminPreviewRequest } from "@/lib/adminPreviewClient";
import AdminPreviewGrants from "./AdminPreviewGrants";

type Props = { canView:boolean; session: DashboardSession; profile: DashboardProfile; onClose: () => void };
export default function OwnerAdminPreview({session,profile,onClose,canView}: Props) {
  const frame=useRef<HTMLIFrameElement>(null),channel=useRef("");
  const [documentHtml,setDocumentHtml]=useState(""),[error,setError]=useState(""),[reload,setReload]=useState(0);
  const allowed=profile.active===true&&canView,owner=profile.active===true&&profile.role==="owner";
  const [showGrants,setShowGrants]=useState(false);
  const storagePrefix=`hensem:owner-preview:${profile.auth_user_id}:`;
  const readDrafts=useCallback(()=>{const values:Record<string,string>={};for(const key of OWNER_PREVIEW_DRAFT_KEYS){try{const value=localStorage.getItem(storagePrefix+key);if(value!==null&&ownerPreviewDraftAllowed(key,value))values[key]=value}catch{}}return values},[storagePrefix]);
  useEffect(()=>{
    setDocumentHtml("");setError("");if(!allowed)return;
    let cancelled=false,checking=false;const controller=new AbortController();
    channel.current=crypto.randomUUID();
    const request=async(check=false)=>{
      const response=await adminPreviewRequest(session,check?"?check=1":"",{signal:controller.signal});
      if(!check){const html=await response.text();if(!cancelled)setDocumentHtml(makeOwnerPreviewDocument(html,readDrafts(),channel.current));}
    };
    const fail=(e:unknown)=>{if(cancelled)return;cancelled=true;controller.abort();setDocumentHtml("");setError(e instanceof Error?e.message:"后台预览加载失败")};
    request().catch(fail);
    const verify=()=>{if(checking||cancelled)return;checking=true;request(true).catch(fail).finally(()=>{checking=false})};
    const timer=window.setInterval(verify,60000);
    const focused=()=>{if(document.visibilityState==="visible")verify()};document.addEventListener("visibilitychange",focused);
    return()=>{cancelled=true;controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",focused)};
  },[allowed,session,profile.auth_user_id,reload,readDrafts]);
  useEffect(()=>{if(!allowed)return;const receive=(event:MessageEvent)=>{const data=event.data;if(event.source!==frame.current?.contentWindow||event.origin!=="null"||data?.type!=="hensem-owner-preview-draft"||data.channel!==channel.current||!ownerPreviewDraftAllowed(data.key,data.value))return;try{if(data.value===null)localStorage.removeItem(storagePrefix+data.key);else localStorage.setItem(storagePrefix+data.key,data.value)}catch{setError("当前浏览器无法保存草稿；页面内可继续查看，请导出后备份。")}};window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive)},[allowed,storagePrefix]);
  return <section style={{position:"fixed",inset:0,zIndex:1000,background:"#f3f6fb",display:"flex",flexDirection:"column"}}>
    <header style={{height:38,flexShrink:0,display:"flex",alignItems:"center",gap:14,padding:"0 16px",background:"#fff",borderBottom:"1px solid #dfe6f1",fontSize:12}}>
      <button type="button" className="ghost-btn" onClick={onClose}>← 返回现有后台</button><strong>新版详细后台 · 授权内测</strong><span style={{color:"#728099"}}>业务样本与只读存款快照 · 配置保存在本机</span>{owner&&<button type="button" className="ghost-btn" style={{marginLeft:"auto"}} onClick={()=>setShowGrants(true)}>查看授权</button>}
    </header>
    {allowed&&documentHtml?<iframe ref={frame} title="新版详细后台授权预览" sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" srcDoc={documentHtml} style={{border:0,width:"100%",flex:1,minHeight:0}}/>:<div role={error?"alert":"status"} style={{margin:"48px auto",padding:24,background:"#fff",borderRadius:8}}>{!allowed?"当前账号没有新版后台查看权限":error||"正在验证查看权限并加载新版后台…"}{error&&<button className="ghost-btn" onClick={()=>setReload(x=>x+1)}>重新加载</button>}</div>}
    {owner&&showGrants&&<AdminPreviewGrants session={session} onClose={()=>setShowGrants(false)}/>}
    {error&&documentHtml&&<div role="status" style={{padding:8,color:"#a15c00"}}>{error}</div>}
  </section>;
}
