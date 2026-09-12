"use client";
import {useEffect,useState} from "react";
import {useDashboardAuth} from "./DashboardAuthGate";
import {configLocalDay} from "@/lib/arAutoWithdrawConfigClient";
import {fetchWGConfigIndex,fetchWGConfigSnapshot,type WGConfigTarget,type WGConfigSummary,type WGStoredConfigSnapshot} from "@/lib/wgAutoWithdrawConfigClient";
import WGConfigSheet from "./WGConfigSheet";
import "./WGConfigSheet.css";

function WGGroupDetail({target,revision}:{target:WGConfigTarget;revision:number}) {
  const {session}=useDashboardAuth();
  const [row,setRow]=useState<WGStoredConfigSnapshot|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");setRow(null);
    if(!session){setLoading(false);return ()=>controller.abort();}
    fetchWGConfigSnapshot(target,session,controller.signal)
      .then(value=>{if(!controller.signal.aborted)setRow(value);})
      .catch(()=>{if(!controller.signal.aborted)setError("WG 配置读取失败或没有查看权限，请重试。");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[target.country_code,target.platform,target.timezone,revision,session?.access_token]);
  const fresh=row?.observed_local_date===configLocalDay(target.timezone);
  return <section className="awc-detail wgc-detail" aria-label={target.platform+" WG 配置"}>
    <header className="awc-detail-head"><div><span className="awc-eyebrow">WG SYSTEM / 只读配置</span><h2>{target.platform}<span>{target.country_name}</span></h2></div>
      {row&&<span className={fresh?"awc-status good":"awc-status pending"}>{fresh?(row.configuration.completeness.unavailable.length?"配置已同步，部分选项未齐":"今日已同步"):"历史配置 · 待更新"}</span>}</header>
    {loading?<div className="awc-empty" role="status">正在读取 WG 配置…</div>:error?<div className="awc-empty" role="alert">{error}</div>:!row?
      <div className="awc-empty"><strong>该登录组尚未同步配置</strong><p>新版 WG 采集程序同步后，会按默认设置和各品牌展示真实配置。</p><small>刷新仅查看已入库内容，不会访问或修改源后台。</small></div>:
      <><div className="awc-capture-time">采集时间：{new Date(row.observed_at).toLocaleString("zh-CN",{timeZone:target.timezone,hour12:false})}<span>{target.timezone}</span><span>每天读取一次 · 非实时配置</span></div>
      <WGConfigSheet configuration={row.configuration} members={target.members}/></>}
  </section>;
}

export default function WGConfigBrowser() {
  const {session,profile}=useDashboardAuth();
  const allowed=Boolean(profile?.active&&(profile.role==="owner"||profile.permissions?.auto_withdraw===true));
  const [targets,setTargets]=useState<WGConfigTarget[]>([]),[summaries,setSummaries]=useState<WGConfigSummary[]>([]);
  const [selectedKey,setSelectedKey]=useState(""),[revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");setTargets([]);setSummaries([]);
    if(!session||!allowed){setLoading(false);return ()=>controller.abort();}
    fetchWGConfigIndex(session,controller.signal)
      .then(value=>{if(!controller.signal.aborted){setTargets(value.targets);setSummaries(value.summaries);}})
      .catch(()=>{if(!controller.signal.aborted)setError("WG 配置列表读取失败，请重试。");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[session?.access_token,allowed,revision]);
  const keyFor=(target:WGConfigTarget)=>target.country_code+":"+target.platform;
  const selected=targets.find(target=>keyFor(target)===selectedKey)||targets[0];
  if(!allowed)return <section className="awc-empty">没有自动出款配置查看权限，请联系管理员。</section>;
  return <section className="awc-page wgc-browser" aria-label="WG 自动出款配置">
    <div className="awc-toolbar"><div><h2>WG 自动出款配置</h2><span>按登录组查看默认设置与全部品牌，选中值不可修改</span></div>
      <button type="button" className="awc-refresh" disabled={loading} title="仅重新读取 Supabase 已收到的配置，不触发源后台采集" onClick={()=>setRevision(value=>value+1)}>{loading?"读取中…":"刷新已同步配置"}</button></div>
    {loading?<div className="awc-empty" role="status">正在读取登录组…</div>:error?<div className="awc-empty" role="alert">{error}</div>:targets.length===0?<div className="awc-empty">暂未配置 WG 采集登录组</div>:
      <div className="awc-workspace"><aside className="awc-platforms"><div className="awc-list-title"><strong>WG 登录组</strong><span>{targets.length} 组</span></div>
        <div className="awc-platform-list">{targets.map(target=>{
          const summary=summaries.find(item=>item.country_code===target.country_code&&item.platform===target.platform);
          const fresh=summary?.observed_local_date===configLocalDay(target.timezone);
          return <button type="button" key={keyFor(target)} className={selected&&keyFor(selected)===keyFor(target)?"active":""} aria-pressed={Boolean(selected&&keyFor(selected)===keyFor(target))} onClick={()=>setSelectedKey(keyFor(target))}>
            <span>{target.platform}<small className="wgc-group-country">{target.country_name} · {target.members.length} 个品牌</small></span><small className={fresh?"fresh":""}>{fresh?"今日已同步":summary?"待更新":"未采集"}</small></button>;
        })}</div></aside>{selected&&<WGGroupDetail key={keyFor(selected)} target={selected} revision={revision}/>}</div>}
  </section>;
}
