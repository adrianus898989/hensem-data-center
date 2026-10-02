"use client";
import { getDashboardPresenceSnapshot, getDashboardPresenceViewerId, refreshDashboardPresence, subscribeDashboardPresence, type DashboardPresenceSnapshot } from "./dashboardPresenceClient";

export const PRESENCE_REQUEST = "hensem-dashboard-presence-request";
export const PRESENCE_UPDATE = "hensem-dashboard-presence-update";
type Options = {
  source: () => Window | null | undefined;
  channel: () => string;
  accountId: () => string;
  canViewAccounts?: () => boolean;
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
  subscribe?: (listener: (snapshot: DashboardPresenceSnapshot) => void) => () => void;
  snapshot?: () => DashboardPresenceSnapshot;
  viewer?: () => string | null;
  refresh?: () => unknown;
};

// Presence does not enter the business-query queue and cannot send credentials,
// choose a user, choose a scope or write a leave/heartbeat operation from a frame.
export function installDashboardPresenceBridge(options: Options): () => void {
  const target = options.target || window, read = options.snapshot || getDashboardPresenceSnapshot;
  const viewer = options.viewer || getDashboardPresenceViewerId, refresh = options.refresh || refreshDashboardPresence;
  let closed = false;
  const send = (snapshot: DashboardPresenceSnapshot) => {
    const source = options.source(), channel = options.channel();
    if (closed || !source || !channel) return;
    const same = viewer() === options.accountId();
    const safe = {
      onlineCount: same ? snapshot.onlineCount : null, observedAt: same ? snapshot.observedAt : null,
      windowSeconds: snapshot.windowSeconds, heartbeatSeconds: snapshot.heartbeatSeconds, scope: same ? snapshot.scope : null,
      accounts: same && options.canViewAccounts?.() !== false ? snapshot.accounts?.map(row => ({ username: row.username, lastSeenAt: row.lastSeenAt })) ?? null : null,
      loading: same && snapshot.loading, reason: same ? snapshot.reason : "stopped",
    };
    try { source.postMessage({ type: PRESENCE_UPDATE, channel, snapshot: safe }, "*"); } catch { /* The old frame may already have closed. */ }
  };
  const receive = (event: MessageEvent) => {
    const data = event.data;
    if (closed || event.source !== options.source() || !event.source || event.origin !== "null" || !data || typeof data !== "object" || Array.isArray(data) || data.type !== PRESENCE_REQUEST || data.channel !== options.channel()
      || Object.keys(data).some(key => !["type", "channel", "command"].includes(key)) || !["ready", "refresh"].includes(data.command)) return;
    send(read());
    if (data.command === "refresh" && viewer() === options.accountId()) void refresh();
  };
  target.addEventListener("message", receive);
  const unsubscribe = (options.subscribe || subscribeDashboardPresence)(send);
  return () => { if (closed) return; closed = true; target.removeEventListener("message", receive); unsubscribe(); };
}

export function makeDashboardPresenceDocument(html: string, channel: string, hostOrigin: string): string {
  const url = new URL(hostOrigin);
  if (!/^https?:$/.test(url.protocol) || url.origin !== hostOrigin || !channel || channel.length > 200 || !/<!doctype html>/i.test(html)) throw Error("在线状态来源配置无效");
  const encode = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const bootstrap = `<script>(function(){
const channel=${encode(channel)},hostOrigin=${encode(hostOrigin)},listeners=new Set();let snapshot=null;
const copy=()=>snapshot?{...snapshot,accounts:snapshot.accounts?.map(row=>({...row}))??null}:null;
const post=command=>parent.postMessage({type:'${PRESENCE_REQUEST}',channel,command},hostOrigin);
window.hensemPresenceSubscribe=listener=>{if(typeof listener!=='function')return ()=>{};listeners.add(listener);listener(copy());return ()=>listeners.delete(listener)};
window.hensemPresenceRefresh=()=>post('refresh');
addEventListener('message',event=>{const data=event.data;if(event.source!==parent||event.origin!==hostOrigin||!data||data.type!=='${PRESENCE_UPDATE}'||data.channel!==channel)return;const s=data.snapshot;
 if(!s||typeof s!=='object'||Array.isArray(s)||typeof s.loading!=='boolean'||s.windowSeconds!==120||s.heartbeatSeconds!==30||s.onlineCount!==null&&(!Number.isSafeInteger(s.onlineCount)||s.onlineCount<0||s.onlineCount>500||s.scope!=='authorized'||typeof s.observedAt!=='string'||!Number.isFinite(Date.parse(s.observedAt)))||s.onlineCount===null&&(s.accounts!==null||s.observedAt!==null)||s.accounts!==null&&(!Array.isArray(s.accounts)||s.accounts.length!==s.onlineCount||s.accounts.some(row=>!row||typeof row.username!=='string'||!/^[a-z0-9._-]{3,32}$/.test(row.username)||typeof row.lastSeenAt!=='string'||!Number.isFinite(Date.parse(row.lastSeenAt)))||new Set(s.accounts.map(row=>row.username)).size!==s.accounts.length))return;
 snapshot={onlineCount:s.onlineCount,observedAt:s.observedAt,windowSeconds:120,heartbeatSeconds:30,scope:s.onlineCount===null?null:'authorized',accounts:s.accounts?.map(row=>({username:row.username,lastSeenAt:row.lastSeenAt}))??null,loading:s.loading,reason:['initial','stopped','offline','timeout','unavailable','stale'].includes(s.reason)?s.reason:null};
 for(const listener of listeners)try{listener(copy())}catch{}
});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>post('ready'),{once:true});else post('ready');
})();</script>`;
  return html.replace(/(<!doctype html>)/i, "$1" + bootstrap);
}
