"use client";
import {useEffect,useMemo,useState} from "react";
import {useDashboardAuth} from "./DashboardAuthGate";
import {fetchGame66PlatformStatus,type Game66PlatformStatus} from "@/lib/game66PlatformClient";
import {fetchGame66Config,type Game66ConfigTarget,type Game66ReviewRule} from "@/lib/game66ConfigClient";

// These brands belong to the Hong Kong reporting catalogue, but do not expose
// an automatic-withdrawal configuration. Keep this exclusion local to the
// configuration browser so the dashboard platform catalogue remains intact.
const GAME66_CONFIG_EXCLUDED_PLATFORMS=new Set(["GEM7","MAX7","EK7"]);
function showsGame66Config(platform:string){return !GAME66_CONFIG_EXCLUDED_PLATFORMS.has(platform.trim().toUpperCase());}

function stamp(value:string|null,timezone="Asia/Kolkata") {
  return value?new Date(value).toLocaleString("zh-CN",{timeZone:timezone,hour12:false}):"尚无";
}
function shown(value:string|null|undefined){return String(value??"").trim()||"—";}
function fallbackStatus(target:Game66ConfigTarget):Game66PlatformStatus{return {
  team_code:target.team_code,team_name:target.team_name,platform_name:target.platform_name,
  enabled:false,has_base_url:false,has_auth_secret:false,request_configured:false,
  charge_rows:0,withdraw_rows:0,latest_charge_at:null,latest_withdraw_at:null,latest_dictionary_at:null,
  latest_sync_status:null,latest_sync_at:null,latest_sync_error_count:0,
};}

function RuleTable({rules}:{rules:Game66ReviewRule[]}){
  if(!rules.length)return <div className="g66-rule-empty"><strong>自动审核规则尚未采集</strong><p>新版采集器会在同一次任务中抓订单、规则配置和订单拦截原因。规则抓取失败时订单仍保留，页面不会把“未采集”误显示成关闭。</p></div>;
  return <div className="g66-rule-section"><div className="awc-sheet-intro"><strong>自动审核规则</strong><span>{rules.filter(rule=>rule.enabled).length} 条启用 · {rules.length} 条已采集</span></div>
    <div className="g66-rule-table-wrap"><table className="g66-rule-table"><thead><tr><th>规则 ID</th><th>规则名称</th><th>条件</th><th>当前值</th><th>生效范围</th><th>状态</th><th>说明 / 原始配置</th></tr></thead>
      <tbody>{rules.map(rule=><tr key={`${rule.platform_id}:${rule.rule_id}`}><td>{rule.rule_id}</td><td><strong>{shown(rule.title)}</strong><small>{shown(rule.rule_type)}</small></td><td>{shown(rule.operator)}</td><td>{shown(rule.value)}</td><td>{shown(rule.effective_type_text||rule.effective_type||rule.effective_channel)}</td><td><span className={rule.enabled?"g66-rule-enabled":"g66-rule-disabled"}>{rule.enabled?"启用":"停用"}</span></td><td><span>{shown(rule.description||rule.remark)}</span><details><summary>查看原始配置</summary><pre>{JSON.stringify(rule.raw_payload,null,2)}</pre></details></td></tr>)}</tbody></table></div>
    <p className="awc-footnote">只读展示 Supabase 已收到的后台真实规则；不会修改 66GAME 后台配置。</p></div>;
}

export default function Game66ConfigBrowser({team}:{team:"hong_kong"|"red_crab"}) {
  const {session,profile}=useDashboardAuth();
  const allowed=Boolean(profile?.active&&(profile.role==="owner"||profile.permissions?.auto_withdraw===true));
  const [rows,setRows]=useState<Game66PlatformStatus[]>([]),[targets,setTargets]=useState<Game66ConfigTarget[]>([]),[rules,setRules]=useState<Game66ReviewRule[]>([]);
  const [selectedName,setSelectedName]=useState(""),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [statusWarning,setStatusWarning]=useState(""),[statusAvailable,setStatusAvailable]=useState(true);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError("");setStatusWarning("");setStatusAvailable(true);setRows([]);setTargets([]);setRules([]);
    if(!session||!allowed){setLoading(false);return()=>controller.abort();}
    Promise.allSettled([fetchGame66PlatformStatus(session,controller.signal),fetchGame66Config(session,controller.signal)])
      .then(([statusResult,configResult])=>{if(controller.signal.aborted)return;
        if(statusResult.status==="rejected"&&configResult.status==="rejected")throw configResult.reason||statusResult.reason;
        const config=configResult.status==="fulfilled"?configResult.value:null;
        const teamTargets=(config?.targets||[]).filter(row=>row.team_code===team&&showsGame66Config(row.platform_name));
        const statusRows=statusResult.status==="fulfilled"?statusResult.value.filter(row=>row.team_code===team&&showsGame66Config(row.platform_name)):[];
        setStatusAvailable(statusResult.status==="fulfilled");
        setRows(statusRows.length?statusRows:teamTargets.map(fallbackStatus));
        setTargets(teamTargets);setRules(config?.rules||[]);
        if(statusResult.status==="rejected")setStatusWarning("订单库存状态暂时读取较慢；已先展示平台和规则配置，订单统计修复发布后可刷新查看。");
        else if(configResult.status==="rejected")setStatusWarning("规则配置暂时读取失败；平台连接与订单库存状态仍可查看。");
      })
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"团队平台配置读取失败，请重试。");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[session?.access_token,allowed,revision,team]);
  const selected=useMemo(()=>rows.find(row=>row.platform_name===selectedName)||rows[0],[rows,selectedName]);
  const target=selected?targets.find(item=>item.platform_name.toUpperCase()===selected.platform_name.toUpperCase()):undefined;
  const selectedRules=target?rules.filter(rule=>rule.platform_id===target.platform_id):[];
  const ready=statusAvailable?rows.filter(row=>row.has_base_url).length:rows.length;
  const synced=targets.filter(row=>row.rule_count>0).length;
  if(!allowed)return <section className="awc-empty">没有自动出款配置查看权限，请联系管理员。</section>;
  return <section className="awc-page g66-browser" aria-label={`${team==="hong_kong"?"香港":"红膏蟹"}团队平台配置`}>
    <div className="awc-toolbar"><div><h2>{team==="hong_kong"?"香港":"红膏蟹"}团队平台</h2><span>连接状态、订单入库与自动审核规则统一查看</span></div>
      <button type="button" className="awc-refresh" disabled={loading} onClick={()=>setRevision(value=>value+1)}>{loading?"读取中…":"刷新已同步配置"}</button></div>
    {statusWarning&&<div className="awc-empty" role="status">{statusWarning}</div>}
    {loading?<div className="awc-empty" role="status">正在读取平台与规则配置…</div>:error?<div className="awc-empty" role="alert">{error}</div>:rows.length===0?<div className="awc-empty">当前权限下没有该团队的平台</div>:
      <div className="awc-workspace"><aside className="awc-platforms"><div className="awc-list-title"><strong>平台配置</strong><span>可同步 {ready}/{rows.length} · 规则 {synced}/{rows.length}</span></div>
        <div className="awc-platform-list">{rows.map(row=>{const config=targets.find(item=>item.platform_name.toUpperCase()===row.platform_name.toUpperCase());return <button type="button" key={row.platform_name} className={selected?.platform_name===row.platform_name?"active":""} onClick={()=>setSelectedName(row.platform_name)}>
          <span>{row.platform_name}</span><small className={config?.rule_count?"fresh":""}>{config?.rule_count?`${config.rule_count} 条规则`:!statusAvailable?"状态待刷新":row.enabled?"待采规则":row.request_configured?"未启用":"待配置"}</small></button>;})}</div></aside>
        {selected&&<section className="awc-detail"><header className="awc-detail-head"><div><span className="awc-eyebrow">66GAME / 只读配置</span><h2>{selected.platform_name}<span>{selected.team_name}</span></h2></div>
          <span className={selectedRules.length?"awc-status good":"awc-status pending"}>{selectedRules.length?`规则已同步 ${selectedRules.length} 条`:"规则待采集"}</span></header>
          <div className="g66-status-grid"><div><span>连接地址</span><strong>{statusAvailable?(selected.has_base_url?"已登记":"未登记"):"状态待刷新"}</strong></div><div><span>采集方式</span><strong>{statusAvailable?(selected.has_base_url?"浏览器会话":"待配置"):"状态待刷新"}</strong></div><div><span>同步规则</span><strong>{statusAvailable?(selected.request_configured?"已配置":"本机模板"):"状态待刷新"}</strong></div><div><span>最近同步</span><strong>{statusAvailable?(selected.latest_sync_status||"尚无记录"):"状态待刷新"}</strong></div><div><span>代收订单</span><strong>{statusAvailable?selected.charge_rows.toLocaleString("en-US"):"—"}</strong></div><div><span>提现订单</span><strong>{statusAvailable?selected.withdraw_rows.toLocaleString("en-US"):"—"}</strong></div></div>
          <div className="awc-capture-time">{statusAvailable?<>代收更新：{stamp(selected.latest_charge_at)}<span>提现更新：{stamp(selected.latest_withdraw_at)}</span></>:<>订单库存状态待刷新</>}<span>规则更新：{stamp(target?.updated_at||null,target?.timezone)}</span></div>
          <RuleTable rules={selectedRules}/>
        </section>}</div>}
  </section>;
}
