"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizedManagementPermissions, type DashboardProfile, type DashboardSession } from "@/lib/dashboardAuthClient";
import { makeOwnerPreviewDocument, OWNER_PREVIEW_DRAFT_KEYS, ownerPreviewDraftAllowed } from "@/lib/ownerPreviewDocument";

import { restoreApprovedAdmin } from "@/lib/adminPreviewRestore";
import { ownerPreviewTransportRead, retryOwnerPreviewVerification } from "@/lib/ownerPreviewVerification";
import { adminPreviewRequest } from "@/lib/adminPreviewClient";
import AdminPreviewGrants from "./AdminPreviewGrants";
import AdminControlCenter from "./AdminControlCenter";
import WorkOrderAccountAdmin from "./WorkOrderAccountAdmin";
import AccountIpAdmin from "./AccountIpAdmin";
import DashboardRoleManager from "./DashboardRoleManager";
import { readDashboardRoleAccess, dashboardRoleAllows, type DashboardRoleAccess } from "@/lib/dashboardRoleAccess";
import { installAdminLiveBridge, makeAdminLiveDocument } from "@/lib/adminLiveBridge";
import { installDashboardPresenceBridge, makeDashboardPresenceDocument } from "@/lib/dashboardPresenceBridge";
import { OWNER_PREVIEW_HOST_CSS, ownerPreviewActivityTime, ownerPreviewAccountCommand, ownerPreviewAccountPage, ownerPreviewSecurityPage, makeOwnerPreviewShellDocument, mountOwnerPreviewHostShell } from "@/lib/ownerPreviewShell";

import { recordDashboardActivity } from "@/lib/dashboardIdle";
import { dashboardScopeIdentity, effectiveDashboardDataScope } from "@/lib/dashboardDataScope";

type Props = { canView:boolean; session: DashboardSession; profile: DashboardProfile; onLogout: () => void };
export default function OwnerAdminPreview({session,profile,onLogout,canView}: Props) {
  const frame=useRef<HTMLIFrameElement>(null),channel=useRef("");
  const sessionRef=useRef(session);sessionRef.current=session;
  const accountId=profile.auth_user_id;
  const scopeIdentity=dashboardScopeIdentity(profile),dataScope=effectiveDashboardDataScope(profile);
  const roleAccessRef=useRef<DashboardRoleAccess|null>(null);
  const liveStopRef=useRef<(()=>void)|null>(null),presenceStopRef=useRef<(()=>void)|null>(null);
  const [roleAccess,setRoleAccess]=useState<DashboardRoleAccess|null>(null);
  const [documentHtml,setDocumentHtml]=useState(""),[error,setError]=useState(""),[reload,setReload]=useState(0);
  const allowed=profile.active===true&&canView&&session.user.id===accountId,owner=profile.active===true&&profile.role==="owner";
  const [showGrants,setShowGrants]=useState(false);
  const [accountView,setAccountView]=useState<"accounts"|"workorder"|"roles"|null>(null);
  const [securityBounds,setSecurityBounds]=useState<{top:number;left:number;width:number}|null>(null);
  const [accountBounds,setAccountBounds]=useState<{top:number;left:number;width:number}|null>(null);
  const canManageAccounts=profile.active===true&&(owner||(roleAccess?.mode==="assigned"?dashboardRoleAllows(roleAccess,"access"):profile.role==="admin"&&normalizedManagementPermissions(profile).manage_viewers));
  const canViewRoles=owner||roleAccess?.mode==="assigned"&&dashboardRoleAllows(roleAccess,"access");
  const activeAccountView=accountView||(owner?"workorder":"accounts");
  const [verificationStatus,setVerificationStatus]=useState("");

  useEffect(()=>mountOwnerPreviewHostShell(),[]);
  const storagePrefix=`hensem:owner-preview:${profile.auth_user_id}:`;
  const readDrafts=useCallback(()=>{const values:Record<string,string>={};for(const key of OWNER_PREVIEW_DRAFT_KEYS){try{const value=localStorage.getItem(storagePrefix+key);if(value!==null&&ownerPreviewDraftAllowed(key,value))values[key]=value}catch{}}return values},[storagePrefix]);
  useEffect(()=>{
    const clearPreview=()=>{liveStopRef.current?.();liveStopRef.current=null;presenceStopRef.current?.();presenceStopRef.current=null;
      setDocumentHtml("");roleAccessRef.current=null;setRoleAccess(null);setAccountBounds(null);setSecurityBounds(null);setAccountView(null);setShowGrants(false)};
    clearPreview();setError("");setVerificationStatus("");if(!allowed)return;
    let cancelled=false,checking=false,retrying=false,revision=0,published=false;const controller=new AbortController();
    channel.current=crypto.randomUUID();
    const obsolete=(mine:number)=>cancelled||controller.signal.aborted||mine!==revision||sessionRef.current.user.id!==accountId;
    const abandon=()=>{const error=new Error("后台验证已取消");error.name="AbortError";return error};
    const fail=(e:unknown)=>{if(cancelled)return;cancelled=true;controller.abort();clearPreview();setVerificationStatus("");setError(e instanceof Error?e.message:"后台加载失败")};
    const request=async(check=false)=>{
      const mine=++revision;let recovering=false;
      try {
        const result=await retryOwnerPreviewVerification(async()=>{
          if(obsolete(mine))throw abandon();
          const policy=await readDashboardRoleAccess(sessionRef.current,controller.signal);
          if(obsolete(mine))throw abandon();
          if(!policy.canView)throw Error("当前角色没有可用目录，请联系管理员分配角色。");
          const changed=check&&published&&JSON.stringify(policy)!==JSON.stringify(roleAccessRef.current);
          if(changed){published=false;clearPreview();setVerificationStatus("角色权限已更新，正在重新验证后台…")}
          const quick=check&&!recovering;
          let response=await adminPreviewRequest(sessionRef.current,quick?"?check=1":"",{signal:controller.signal});
          if(obsolete(mine))throw abandon();
          if(quick){const access=await ownerPreviewTransportRead(()=>response.json(),controller.signal);
            if(!access||typeof access!=="object"||Array.isArray(access)||access.ok!==true||access.canView!==true||typeof access.canManage!=="boolean")throw Error("后台查看权限响应不完整，请重新验证。");
            if(obsolete(mine))throw abandon();}
          // After a temporary failure, or a changed policy, read fresh protected
          // HTML and rebuild its permissions; an old document is never restored.
          if(quick&&(!published||changed))response=await adminPreviewRequest(sessionRef.current,"",{signal:controller.signal});
          const html=quick&&published&&!changed?null:await ownerPreviewTransportRead(()=>response.text(),controller.signal);
          if(obsolete(mine))throw abandon();
          return {policy,html};
        },controller.signal,nextAttempt=>{
          if(obsolete(mine))throw abandon();recovering=true;retrying=true;published=false;clearPreview();
          setVerificationStatus(`连接暂时不可用，正在重新验证查看权限（${nextAttempt}/3）…`);
        });
        if(obsolete(mine))return;
        // Format checks and source transformations are deliberately outside retry.
        const html=result.html===null?null:makeOwnerPreviewDocument(makeOwnerPreviewShellDocument(makeDashboardPresenceDocument(makeAdminLiveDocument(restoreApprovedAdmin(result.html),channel.current,result.policy,{mode:dataScope.mode,identity:scopeIdentity}),channel.current,window.location.origin),channel.current,owner),readDrafts(),channel.current);
        if(obsolete(mine))return;
        retrying=false;roleAccessRef.current=result.policy;setRoleAccess(result.policy);setVerificationStatus("");setError("");
        if(html!==null){published=true;setDocumentHtml(html)}
      } catch(e) {if(!obsolete(mine))fail(e)}
    };
    void request();
    const verify=()=>{if(checking||cancelled||retrying)return;checking=true;void request(true).finally(()=>{checking=false})};
    const timer=window.setInterval(verify,60000);
    const focused=()=>{if(document.visibilityState==="visible")verify()};document.addEventListener("visibilitychange",focused);
    return()=>{cancelled=true;controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",focused)};
  },[allowed,accountId,reload,readDrafts,owner,scopeIdentity]);
  useEffect(()=>{if(!allowed)return;const receive=(event:MessageEvent)=>{const data=event.data;const activity=ownerPreviewActivityTime(event,frame.current?.contentWindow,channel.current);if(activity!==null){recordDashboardActivity(activity);return}const accountCommand=ownerPreviewAccountCommand(event,frame.current?.contentWindow,channel.current);if(accountCommand){setAccountView(accountCommand==="open-accounts"?"accounts":"workorder");return}const accountPage=ownerPreviewAccountPage(event,frame.current?.contentWindow,channel.current);if(accountPage){setAccountBounds(accountPage.active?accountPage.bounds:null);return}const securityPage=ownerPreviewSecurityPage(event,frame.current?.contentWindow,channel.current);if(securityPage){setSecurityBounds(securityPage.active?securityPage.bounds:null);return}if(event.source!==frame.current?.contentWindow||event.origin!=="null"||data?.type!=="hensem-owner-preview-draft"||data.channel!==channel.current||!ownerPreviewDraftAllowed(data.key,data.value))return;try{if(data.value===null)localStorage.removeItem(storagePrefix+data.key);else localStorage.setItem(storagePrefix+data.key,data.value)}catch{setError("当前浏览器无法保存草稿；页面内可继续查看，请导出后备份。")}};window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive)},[allowed,storagePrefix,canManageAccounts,owner]);
  const hasDocument=Boolean(documentHtml);
  useEffect(()=>{if(!allowed||!hasDocument)return;const stop=installAdminLiveBridge({source:()=>frame.current?.contentWindow,channel:()=>channel.current,session:()=>sessionRef.current,roleAccess:()=>roleAccessRef.current});liveStopRef.current=stop;return()=>{if(liveStopRef.current===stop)liveStopRef.current=null;stop()}},[allowed,hasDocument,accountId]);
  useEffect(()=>{if(!allowed||!hasDocument)return;const stop=installDashboardPresenceBridge({source:()=>frame.current?.contentWindow,channel:()=>channel.current,accountId:()=>sessionRef.current.user.id,canViewAccounts:()=>!!roleAccessRef.current&&(roleAccessRef.current.mode!=="assigned"||dashboardRoleAllows(roleAccessRef.current,"access"))});presenceStopRef.current=stop;return()=>{if(presenceStopRef.current===stop)presenceStopRef.current=null;stop()}},[allowed,hasDocument,accountId]);
  return <section className="owner-preview-shell" aria-label="数据中控后台">
    <style>{OWNER_PREVIEW_HOST_CSS}</style>
    {owner&&<button type="button" className="owner-preview-shell-grants" aria-label="管理后台查看授权" disabled={!allowed||!hasDocument} onClick={()=>setShowGrants(true)}>查看授权</button>}
    {allowed&&documentHtml?<iframe ref={frame} title="数据中控后台" sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" srcDoc={documentHtml} className="owner-preview-shell-frame"/>:<div role={error?"alert":"status"} className="owner-preview-shell-status">{!allowed?"当前账号没有后台查看权限":error||verificationStatus||"正在验证查看权限并加载后台…"}<div className="owner-preview-shell-status-actions"><button type="button" className="owner-preview-shell-return" onClick={onLogout}>退出登录</button>{error&&<button type="button" className="owner-preview-shell-return" onClick={()=>setReload(x=>x+1)}>重新加载</button>}</div></div>}
    {owner&&allowed&&hasDocument&&showGrants&&<AdminPreviewGrants session={session} onClose={()=>setShowGrants(false)}/>}
    {allowed&&hasDocument&&accountBounds&&dashboardRoleAllows(roleAccess,"access")&&<section aria-label="账号与角色权限" className="owner-preview-account-page" style={{top:Math.max(48,accountBounds.top),left:accountBounds.left,width:accountBounds.width}}>
      <div role="tablist" aria-label="账号类型" className="owner-preview-account-tabs">
        <button type="button" role="tab" id="owner-workorder-tab" aria-controls="owner-workorder-panel" aria-selected={activeAccountView==="workorder"} disabled={!owner} title={owner?undefined:"仅总管理员可管理前端工单账号"} onClick={()=>setAccountView("workorder")}>前端工单账号</button>
        <button type="button" role="tab" id="owner-backend-tab" aria-controls="owner-backend-panel" aria-selected={activeAccountView==="accounts"} disabled={!canManageAccounts} onClick={()=>setAccountView("accounts")}>后台账号</button>
        {canViewRoles&&<button type="button" role="tab" id="owner-roles-tab" aria-controls="owner-roles-panel" aria-selected={activeAccountView==="roles"} onClick={()=>setAccountView("roles")}>角色与目录权限</button>}
      </div>
      <div role="tabpanel" id={activeAccountView==="workorder"?"owner-workorder-panel":activeAccountView==="roles"?"owner-roles-panel":"owner-backend-panel"} aria-labelledby={activeAccountView==="workorder"?"owner-workorder-tab":activeAccountView==="roles"?"owner-roles-tab":"owner-backend-tab"} className="owner-preview-account-body">
        {activeAccountView==="roles"&&canViewRoles?<DashboardRoleManager key={accountId} session={session} profile={profile} roleAccess={roleAccess}/>:activeAccountView==="accounts"&&canManageAccounts?<AdminControlCenter key={accountId} open session={session} profile={profile} roleAccess={roleAccess} section="accounts" embedded accountsOnlyLoading manualQuery onClose={()=>{}}/>:activeAccountView==="workorder"&&owner?<WorkOrderAccountAdmin key={accountId} session={session} manualQuery/>:<p role="alert" className="owner-preview-account-denied">当前账号没有此项账号管理权限。</p>}
      </div>
    </section>}

    {allowed&&hasDocument&&securityBounds&&dashboardRoleAllows(roleAccess,"ip")&&<section aria-label="IP 白名单" className="owner-preview-account-page" style={{top:Math.max(48,securityBounds.top),left:securityBounds.left,width:securityBounds.width}}><div className="owner-preview-account-body"><AccountIpAdmin key={accountId} session={session}/></div></section>}
    {error&&documentHtml&&<div role="status" className="owner-preview-shell-warning">{error}</div>}
  </section>;
}
