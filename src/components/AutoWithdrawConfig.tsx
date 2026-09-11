"use client";
import { useEffect, useMemo, useState } from "react";
import catalog from "@/lib/arAutoWithdrawConfigCatalog.json";
import {configLocalDay,fetchConfigIndex,fetchConfigSnapshot,type ConfigTarget,type ConfigSummary,type ConfigSnapshot,type Configuration} from "@/lib/arAutoWithdrawConfigClient";
import {useDashboardAuth} from "./DashboardAuthGate";
import "./AutoWithdrawConfig.css";

export function ConfigSheet({configuration}:{configuration:Configuration}) {
  const fields=new Map(configuration.fields.map(f=>[f.key,f]));
  const meta=new Map(catalog.fields.map(f=>[f.key,f]));
  const groups=new Map(configuration.groups.map(g=>[g.key,g]));
  const inactive=(gates:string[])=>gates.some(k=>fields.get(k)?.value!==true);
  return <div className="awc-sheet" aria-label="AR 原配置完整只读展示">
    <div className="awc-sheet-intro"><strong>自动出款</strong><span>{configuration.fields.filter(f=>f.available).length} 项已采集 · 2 组条件 · 按原页面顺序</span></div>
    <p className="awc-source-intro">满足以下全部条件的订单可以进行自动出款</p>
    <div className="awc-columns"><span>配置条件</span><span>当前保存值</span><span>原页面说明</span></div>
    {[...catalog.layout,...(fields.get("isGameNegativeProfitLimit")?.available?[{kind:"field",key:"isGameNegativeProfitLimit"}]:[])].map(item=>{
      if(item.kind==="group") {
        const m=catalog.groups.find(g=>g.key===item.key)!;const g=groups.get(item.key);
        return <div className={"awc-row awc-group "+(inactive(m.enabledBy)?"awc-inactive":"")} key={item.key}>
          <div className="awc-label">{m.label}</div>
          <div className="awc-group-content"><div className="awc-options">{g?.options.map(o=><span className={o.selected?"awc-choice selected":"awc-choice"} key={o.value}><span aria-hidden="true">{o.selected?"✓":"□"}</span>{o.label}</span>)||"页面未提供"}</div>
          <span className="awc-description">{m.description}{inactive(m.enabledBy)?" · 上级开关关闭，当前不生效":""}</span></div>
        </div>;
      }
      const m=meta.get(item.key);const f=fields.get(item.key);if(!m)return null;
      const muted=inactive(m.enabledBy);
      return <div className={"awc-row "+(muted?"awc-inactive ":"")+(m.section==="agent_red_limits"?"awc-subrow ":"")+(m.section==="revisit_poor_profit"?"awc-profit ":"")} key={item.key}>
        <div className="awc-label">{f?.label||m.label}</div>
        <div className="awc-value">{!f?.available?<span className="awc-unavailable">页面未提供</span>:f.kind==="boolean"
          ?<span className="awc-switch-value"><span role="img" aria-label={f.value?"是，已启用":"否，未启用"} className={f.value?"awc-switch on":"awc-switch"}><i/>{f.value?"是":"否"}</span>{f.read_only&&<small>来源锁定</small>}</span>
          :<span className="awc-number">{String(f.value)}</span>}</div>
        <div className="awc-description">{(f?f.description:m.description)||"—"}{muted&&<span className="awc-gated">上级开关关闭 · 保留保存值</span>}</div>
      </div>;
    })}
    <div className="awc-footnote">只读镜像，不修改 AR 后台。原页面未提供的字段不推断为“关闭”；阈值和说明按来源保留。</div>
  </div>;
}
function stamp(value:string,timezone:string) {
  return new Date(value).toLocaleString("zh-CN",{timeZone:timezone,hour12:false});
}
function PlatformConfig({target,revision}:{target:ConfigTarget;revision:number}) {
  const {session}=useDashboardAuth();
  const [row,setRow]=useState<ConfigSnapshot|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{const c=new AbortController();setLoading(true);setError("");setRow(null);
    if(!session){setLoading(false);return ()=>c.abort();}
    fetchConfigSnapshot(target,session,c.signal).then(r=>{if(!c.signal.aborted)setRow(r);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return ()=>c.abort();
  },[target.country_code,target.platform,session?.access_token,revision]);
  const fresh=row&&row.observed_local_date===configLocalDay(target.timezone);
  return <section className="awc-detail">
    <header className="awc-detail-head"><div><span className="awc-eyebrow">AR SYSTEM / 只读配置</span><h2>{target.platform}<span>{target.country_name}</span></h2></div>
      {row&&<span className={fresh?"awc-status good":"awc-status pending"}>{fresh?"今日已采集":"历史配置 · 待更新"}</span>}</header>
    {loading?<div className="awc-empty" role="status">正在读取配置…</div>:error?<div className="awc-empty" role="alert">{error}</div>:!row?
      <div className="awc-empty"><strong>该平台尚未同步配置</strong><p>新版采集程序运行后，这里会显示真实配置。</p><code>--mode config-sync --only {target.platform}</code></div>:
      <><div className="awc-capture-time">采集时间：{stamp(row.observed_at,target.timezone)} <span>{target.timezone}</span><span>每天读取一次 · 非实时配置</span></div><ConfigSheet configuration={row.configuration}/></>}
  </section>;
}
export default function AutoWithdrawConfig() {
  const {session,profile}=useDashboardAuth();
  const [targets,setTargets]=useState<ConfigTarget[]>([]),[summaries,setSummaries]=useState<ConfigSummary[]>([]);
  const [country,setCountry]=useState("IN"),[platform,setPlatform]=useState("Shree.Win"),[keyword,setKeyword]=useState("");
  const [revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const allowed=Boolean(profile?.active&&(profile.role==="owner"||profile.permissions?.auto_withdraw===true));
  useEffect(()=>{const c=new AbortController();setError("");setLoading(true);setTargets([]);setSummaries([]);
    if(!session||!allowed){setLoading(false);return ()=>c.abort();}
    fetchConfigIndex(session,c.signal).then(data=>{if(c.signal.aborted)return;setTargets(data.targets);setSummaries(data.summaries);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return ()=>c.abort();
  },[session?.access_token,allowed,revision]);
  const countries=useMemo(()=>Array.from(new Map(targets.map(t=>[t.country_code,t.country_name]))),[targets]);
  const chosenCountry=countries.some(([code])=>code===country)?country:countries[0]?.[0];
  const visible=targets.filter(t=>t.country_code===chosenCountry&&t.platform.toLowerCase().includes(keyword.toLowerCase().trim()));
  const selected=visible.find(t=>t.platform===platform)||visible[0];
  const countryTargets=targets.filter(t=>t.country_code===chosenCountry);
  const summaryFor=(t:ConfigTarget)=>summaries.find(s=>s.country_code===t.country_code&&s.platform===t.platform);
  const freshCount=countryTargets.filter(t=>summaryFor(t)?.observed_local_date===configLocalDay(t.timezone)).length;
  if(!allowed)return <section className="awc-empty">没有自动出款配置查看权限，请联系管理员。</section>;
  return <section className="awc-page" aria-label="自动出款配置">
    <div className="awc-toolbar"><div><h2>自动出款配置</h2><span>按国家查看各平台原始配置</span></div><button type="button" className="awc-refresh" onClick={()=>setRevision(v=>v+1)} disabled={loading} title="仅重新读取 Supabase 已收到的配置，不触发 AR 采集">{loading?"读取中…":"刷新已同步配置"}</button></div>
    {error?<div className="awc-empty" role="alert">{error}</div>:loading?<div className="awc-empty" role="status">正在读取平台列表…</div>:targets.length===0?<div className="awc-empty">暂未配置 AR 采集平台</div>:<>
      <nav className="awc-countries" aria-label="配置国家">{countries.map(([code,name])=><button className={chosenCountry===code?"active":""} key={code} aria-pressed={chosenCountry===code} onClick={()=>{setCountry(code);setKeyword("");setPlatform("");}}>{name}<small>{targets.filter(t=>t.country_code===code).length}</small></button>)}</nav>
      <div className="awc-workspace"><aside className="awc-platforms"><div className="awc-list-title"><strong>平台配置</strong><span>今日 {freshCount}/{countryTargets.length}</span></div>
        <input className="awc-search" aria-label="搜索配置平台" placeholder="搜索平台" value={keyword} onChange={e=>setKeyword(e.target.value)}/>
        <div className="awc-platform-list">{visible.map(t=>{const s=summaryFor(t);const fresh=s?.observed_local_date===configLocalDay(t.timezone);return <button className={selected?.platform===t.platform?"active":""} key={t.platform} onClick={()=>setPlatform(t.platform)}><span>{t.platform}</span><small className={fresh?"fresh":""}>{fresh?"今日已同步":s?"待更新":"未采集"}</small></button>;})}</div>
      </aside>{selected?<PlatformConfig key={selected.country_code+":"+selected.platform} target={selected} revision={revision}/>:<div className="awc-empty">没有匹配的平台</div>}</div>
    </>}
  </section>;
}
