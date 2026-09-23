"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DashboardProfile, type DashboardSession } from "@/lib/dashboardAuthClient";
import { makeOwnerPreviewDocument, OWNER_PREVIEW_DRAFT_KEYS, ownerPreviewDraftAllowed } from "@/lib/ownerPreviewDocument";

import { adminPreviewRequest } from "@/lib/adminPreviewClient";
import AdminPreviewGrants from "./AdminPreviewGrants";
import { installAdminLiveBridge, makeAdminLiveDocument } from "@/lib/adminLiveBridge";
import { OWNER_PREVIEW_HOST_CSS, isOwnerPreviewReturnMessage, makeOwnerPreviewShellDocument, mountOwnerPreviewHostShell } from "@/lib/ownerPreviewShell";

type Props = { canView:boolean; session: DashboardSession; profile: DashboardProfile; onClose: () => void };
export default function OwnerAdminPreview({session,profile,onClose,canView}: Props) {
  const frame=useRef<HTMLIFrameElement>(null),channel=useRef("");
  const sessionRef=useRef(session);sessionRef.current=session;
  const accountId=profile.auth_user_id;
  const [documentHtml,setDocumentHtml]=useState(""),[error,setError]=useState(""),[reload,setReload]=useState(0);
  const allowed=profile.active===true&&canView,owner=profile.active===true&&profile.role==="owner";
  const [showGrants,setShowGrants]=useState(false);
  useEffect(()=>mountOwnerPreviewHostShell(),[]);
  const storagePrefix=`hensem:owner-preview:${profile.auth_user_id}:`;
  const readDrafts=useCallback(()=>{const values:Record<string,string>={};for(const key of OWNER_PREVIEW_DRAFT_KEYS){try{const value=localStorage.getItem(storagePrefix+key);if(value!==null&&ownerPreviewDraftAllowed(key,value))values[key]=value}catch{}}return values},[storagePrefix]);
  useEffect(()=>{
    setDocumentHtml("");setError("");if(!allowed)return;
    let cancelled=false,checking=false;const controller=new AbortController();
    channel.current=crypto.randomUUID();
    const request=async(check=false)=>{
      const response=await adminPreviewRequest(sessionRef.current,check?"?check=1":"",{signal:controller.signal});
      if(!check){const html=await response.text();if(!cancelled)setDocumentHtml(makeOwnerPreviewDocument(makeOwnerPreviewShellDocument(makeAdminLiveDocument(html,channel.current),channel.current,owner),readDrafts(),channel.current));}
    };
    const fail=(e:unknown)=>{if(cancelled)return;cancelled=true;controller.abort();setDocumentHtml("");setError(e instanceof Error?e.message:"后台预览加载失败")};
    request().catch(fail);
    const verify=()=>{if(checking||cancelled)return;checking=true;request(true).catch(fail).finally(()=>{checking=false})};
    const timer=window.setInterval(verify,60000);
    const focused=()=>{if(document.visibilityState==="visible")verify()};document.addEventListener("visibilitychange",focused);
    return()=>{cancelled=true;controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",focused)};
  },[allowed,accountId,reload,readDrafts,owner]);
  useEffect(()=>{if(!allowed)return;const receive=(event:MessageEvent)=>{const data=event.data;if(isOwnerPreviewReturnMessage(event,frame.current?.contentWindow,channel.current)){onClose();return}if(event.source!==frame.current?.contentWindow||event.origin!=="null"||data?.type!=="hensem-owner-preview-draft"||data.channel!==channel.current||!ownerPreviewDraftAllowed(data.key,data.value))return;try{if(data.value===null)localStorage.removeItem(storagePrefix+data.key);else localStorage.setItem(storagePrefix+data.key,data.value)}catch{setError("当前浏览器无法保存草稿；页面内可继续查看，请导出后备份。")}};window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive)},[allowed,storagePrefix,onClose]);
  const hasDocument=Boolean(documentHtml);
  useEffect(()=>{if(!allowed||!hasDocument)return;return installAdminLiveBridge({source:()=>frame.current?.contentWindow,channel:()=>channel.current,session:()=>sessionRef.current})},[allowed,hasDocument,accountId]);
  return <section className="owner-preview-shell" aria-label="新版详细后台">
    <style>{OWNER_PREVIEW_HOST_CSS}</style>
    {owner&&<button type="button" className="owner-preview-shell-grants" aria-label="管理新版后台查看授权" onClick={()=>setShowGrants(true)}>查看授权</button>}
    {allowed&&documentHtml?<iframe ref={frame} title="新版详细后台授权预览" sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" srcDoc={documentHtml} className="owner-preview-shell-frame"/>:<div role={error?"alert":"status"} className="owner-preview-shell-status">{!allowed?"当前账号没有新版后台查看权限":error||"正在验证查看权限并加载新版后台…"}<div className="owner-preview-shell-status-actions"><button type="button" className="owner-preview-shell-return" onClick={onClose}>← 返回现有后台</button>{error&&<button type="button" className="owner-preview-shell-return" onClick={()=>setReload(x=>x+1)}>重新加载</button>}</div></div>}
    {owner&&showGrants&&<AdminPreviewGrants session={session} onClose={()=>setShowGrants(false)}/>}
    {error&&documentHtml&&<div role="status" className="owner-preview-shell-warning">{error}</div>}
  </section>;
}
