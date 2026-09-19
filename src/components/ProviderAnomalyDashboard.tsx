"use client";
import {useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {useDashboardAuth} from "./DashboardAuthGate";
import {dashboardScopeIdentity} from "@/lib/dashboardDataScope";
import {isDashboardDataDenied} from "@/lib/dashboardDataClient";
import {DEFAULT_RISK_THRESHOLDS,RISK_LABELS,readRiskSettings,riskSettingsKey,scoreProviders,validateRiskThresholds,type RiskThresholds,type RiskSource,type ProviderRisk} from "@/lib/providerAnomaly";
import {fetchAnomalyReport,type AnomalyReport,type AnomalyDates} from "@/lib/providerAnomalyClient";
import "./ProviderAnomalyDashboard.css";

function defaultDates():AnomalyDates {
  const today=new Date();today.setUTCDate(today.getUTCDate()-1);
  const endDate=today.toISOString().slice(0,10);today.setUTCDate(today.getUTCDate()-6);
  return {startDate:today.toISOString().slice(0,10),endDate};
}
const fields:Array<[Exclude<keyof RiskThresholds,"version">,string,string]>=[
  ["minSample","最低样本数","每项 / 每日"],["minCoveragePercent","最低采集覆盖","%"],["maxAgeHours","同步最大间隔","小时"],
  ["delayWarningMinutes","耗时预警","分钟"],["delayCriticalMinutes","耗时严重","分钟"],
  ["rateWarningPercent","低成功率","% 以下（含）"],["rateCriticalPercent","极低成功率","% 以下（含）"],
  ["rateWarningDays","低成功率出现","天"],["rateCriticalDays","极低成功率出现","天"],
  ["shareWarningPercent","占比预警","%"],["shareCriticalPercent","占比严重","%"],
  ["pendingWarningCount","零点未完成预警","笔"],["pendingCriticalCount","零点未完成严重","笔"],
  ["pendingWarningAgeDays","预警最低账龄","天"],["pendingCriticalAgeDays","严重最低账龄","天"],
];
const showNumber=(v:number|null|undefined)=>v==null?"—":v.toLocaleString("zh-CN",{maximumFractionDigits:2});
function SourceEvidence({source}:{source:RiskSource}) {
  const total=source.successDays.some(d=>d.total!=null)?source.successDays.reduce((n,d)=>n+(d.total??0),0):null,success=source.successDays.some(d=>d.success!=null)?source.successDays.reduce((n,d)=>n+(d.success??0),0):null;
  const coverage=source.delay?.coverage;
  return <div className="pa-source"><strong>{source.country} · {source.platform}</strong><span>{source.provider} · {source.currency} · {source.timezone}</span>
    <dl><div><dt>成功耗时样本</dt><dd>{showNumber(source.delay?.sample)}</dd></div><div><dt>已读取成功 / 总笔数</dt><dd>{showNumber(success)} / {showNumber(total)}</dd></div><div><dt>耗时采集覆盖</dt><dd>{coverage==null?"未核验":`${(coverage*100).toFixed(1)}%`}</dd></div><div><dt>最新同步</dt><dd>{source.delay?.latestAt?.replace("T"," ")||"—"}</dd></div><div><dt>结束日零点未完成</dt><dd>{showNumber(source.midnight?.count)} 笔 · {showNumber(source.midnight?.amount)} {source.currency}</dd></div><div><dt>快照核验</dt><dd>{source.midnight?.verified?"已核验":"未核验 / 未接入"}</dd></div></dl>
    <details><summary>逐日成功率与零点档案</summary><div className="pa-daily-evidence">{source.successDays.map(day=>{
      const midnight=source.midnightDays?.find(m=>m.date===day.date);
      return <div key={day.date}><b>{day.date}</b><span>代收 {showNumber(day.success)} / {showNumber(day.total)} 笔 · {day.coverage===1?"完整":"未核验"}</span><span>当地 00点附近采集窗口（00:00—00:05）：{showNumber(midnight?.count)} 笔 · {showNumber(midnight?.amount)} {source.currency}{!midnight?.verified?" · 未核验":""}</span>{midnight?.ageBuckets?.map((b,index)=><span key={index}>创建至零点账龄 {b.minDays}—{b.maxDays??"∞"} 天：{showNumber(b.count)} 笔 · {showNumber(b.amount)} {source.currency}</span>)}{midnight?.verified&&!midnight.continuityVerified&&<span>未核验同一订单连续多日未完成，创建账龄不等于代付中持续时长。</span>}</div>;
    })}</div></details>
  </div>;
}
export function ProviderRiskEvidence({row}:{row:ProviderRisk}) {
  return <div className="pa-evidence"><h4>{row.provider} · {row.currency}</h4>{row.metrics.map(m=><p key={m.key}><b>{m.label}：</b>{m.detail}</p>)}<p>创建至成功耗时，支付时间未接入。处理中订单不等于掉单；掉单需支付和回调证据。</p><div className="pa-evidence-sources">{row.sources.map(s=><SourceEvidence key={s.key} source={s}/>)}</div></div>;
}
export function ProviderRiskRow({row}:{row:ProviderRisk}) {
  const [expanded,setExpanded]=useState(false);
  return <><tr><td><strong>{row.provider}</strong><small>{row.currency} · {new Set(row.sources.map(s=>s.platform)).size} 个平台</small><button className="pa-expand" type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?"收起来源与依据":"来源与判定依据"}</button></td>
    <td><span className={`pa-state pa-${row.state}`}>{RISK_LABELS[row.state]}</span><small>规则风险分：{row.score==null?"—":row.score}{row.incomplete?" · 数据不完整":""}</small></td>
    {row.metrics.map(m=><td key={m.key}><strong>{m.value}</strong><small className={`pa-metric-state pa-${m.state}`}>{m.state==="normal"?"正常":m.state==="warning"?"预警":m.state==="critical"?"严重":m.state==="exempt"?"仅此项豁免":"无法判断"}</small>{m.state==="unknown"&&<small>{m.detail}</small>}</td>)}
  </tr>{expanded&&<tr><td colSpan={6}><ProviderRiskEvidence row={row}/></td></tr>}</>;
}
export default function ProviderAnomalyDashboard() {
  const {session,profile}=useDashboardAuth();
  const identity=`${session?.user.id||"anonymous"}:${dashboardScopeIdentity(profile)}`,ownerRef=useRef(identity);ownerRef.current=identity;
  const [dates,setDates]=useState(defaultDates),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [stored,setStored]=useState<{owner:string;report:AnomalyReport;range:AnomalyDates}|null>(null);
  const result=stored?.owner===identity?stored:null;
  const [thresholdState,setThresholdState]=useState({owner:identity,value:{...DEFAULT_RISK_THRESHOLDS}});
  const thresholds=thresholdState.owner===identity?thresholdState.value:DEFAULT_RISK_THRESHOLDS;
  const [thresholdDraft,setThresholdDraft]=useState<RiskThresholds>({...DEFAULT_RISK_THRESHOLDS}),[settingsMessage,setSettingsMessage]=useState("");
  const [status,setStatus]=useState("all"),[provider,setProvider]=useState(""),[page,setPage]=useState(1),[now,setNow]=useState(Date.now);
  const sequence=useRef(0),flight=useRef<AbortController|null>(null),busyRef=useRef(false);
  useEffect(()=>{
    ++sequence.current;flight.current?.abort();busyRef.current=false;setBusy(false);setStored(null);setError("");setPage(1);setProvider("");setStatus("all");
    let settings={...DEFAULT_RISK_THRESHOLDS};
    try {settings=readRiskSettings(window.localStorage.getItem(riskSettingsKey(session?.user.id||"anonymous")));}catch{/* Optional local settings must never prevent a read. */}
    setThresholdState({owner:identity,value:settings});setThresholdDraft(settings);setSettingsMessage("");
    return()=>{++sequence.current;flight.current?.abort();busyRef.current=false;};
  },[identity,session?.user.id]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
  const scored=useMemo(()=>result?scoreProviders(result.report.sources,thresholds,now):[],[result,thresholds,now]);
  const filtered=scored.filter(row=>(status==="all"||row.state===status)&&(!provider.trim()||row.provider.toLowerCase().includes(provider.trim().toLowerCase())));
  const pages=Math.max(1,Math.ceil(filtered.length/20)),currentPage=Math.min(page,pages),rows=filtered.slice((currentPage-1)*20,currentPage*20);
  const dirty=Boolean(result&&(result.range.startDate!==dates.startDate||result.range.endDate!==dates.endDate));
  async function query(event:FormEvent) {
    event.preventDefault();if(busyRef.current)return;
    const id=++sequence.current,owner=identity,controller=new AbortController(),range={...dates};
    flight.current?.abort();flight.current=controller;busyRef.current=true;setBusy(true);setError("");
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},45000);
    try {
      const report=await fetchAnomalyReport(range,controller.signal);
      if(id!==sequence.current||owner!==ownerRef.current||controller.signal.aborted)return;
      // Validate merged inputs before publishing; an invalid response never replaces good evidence.
      scoreProviders(report.sources,thresholds,Date.now());
      setStored({owner,report,range});setPage(1);setNow(Date.now());
    } catch(err) {
      if(id===sequence.current&&owner===ownerRef.current){
        if(isDashboardDataDenied(err)||[401,403,409].includes(Number((err as {status?:number})?.status)))setStored(null);
        setError(timedOut?"异常分析读取超时，请缩短日期区间重试。":(err as Error).message);
      }
    } finally {clearTimeout(timer);if(id===sequence.current){busyRef.current=false;setBusy(false);}}
  }
  function cancel(){++sequence.current;flight.current?.abort();busyRef.current=false;setBusy(false);setError("查询已取消。");}
  function saveSettings(event:FormEvent){
    event.preventDefault();
    try {
      const value=validateRiskThresholds(thresholdDraft);setThresholdState({owner:identity,value});
      try {window.localStorage.setItem(riskSettingsKey(session?.user.id||"anonymous"),JSON.stringify(value));setSettingsMessage("已应用并保存到本机，仅影响当前账号在此浏览器的提示。");}
      catch{setSettingsMessage("已应用；浏览器禁止本机保存，关闭后将恢复参考值。");}
    }catch(err){setSettingsMessage((err as Error).message);}
  }
  return <section className="provider-anomaly" aria-label="三方异常分析">
    <header className="pa-header"><div><h2>三方异常</h2><p>跨来源合并相同三方，币种分开。只提供提示，不会自动调量。</p></div><span>本机规则 · v1</span></header>
    <form className="pa-search" onSubmit={query}><label>开始日期<input type="date" required value={dates.startDate} onChange={e=>setDates(v=>({...v,startDate:e.target.value}))}/></label><label>结束日期<input type="date" required value={dates.endDate} onChange={e=>setDates(v=>({...v,endDate:e.target.value}))}/></label><p>各平台当地日期 · 最多 31 天<br/>仅返回当前账号有权查看的统计</p><div>{busy&&<button type="button" onClick={cancel}>取消</button>}<button className="pa-primary" disabled={busy} type="submit">{busy?"正在读取…":"查询异常"}</button></div></form>
    <details className="pa-settings"><summary>设置判定阈值 <span>仅本机保存，不修改全员配置</span></summary><form onSubmit={saveSettings}><p>以下为可调整的参考规则，不是系统已确认的业务标准。风险分取最高已知项：正常 0、预警 50、严重 100；未知项不计作 0。存在未知项时不会给出整体正常。</p><div className="pa-threshold-grid">{fields.map(([key,label,unit])=><label key={key}>{label}<div><input type="number" min="0.01" step="any" required value={thresholdDraft[key]} onChange={e=>setThresholdDraft(v=>({...v,[key]:Number(e.target.value)}))}/><span>{unit}</span></div></label>)}</div><div className="pa-settings-actions"><button type="button" onClick={()=>{setThresholdDraft({...DEFAULT_RISK_THRESHOLDS});setSettingsMessage("已填入参考值，点击保存后生效。");}}>恢复参考值</button><button type="submit" className="pa-primary">保存本机阈值</button></div>{settingsMessage&&<p role="status">{settingsMessage}</p>}</form></details>
    <p className="pa-method">创建至成功耗时，支付时间未接入；不能将未成功订单直接判作掉单。UPI-QR 只豁免占比检查。零点档案为当地 00点附近采集窗口，创建账龄不等于连续代付时长，不倒推历史。</p>
    {error&&<p className="pa-error" role="alert">{error}{result?" 下方保留上次查询结果。":""}</p>}
    {!result?<div className="pa-empty" role="status">{busy?"正在读取真实统计…":"请选择日期，查询三方异常。"}<small>没有数据、覆盖不足或服务未接入时，显示“无法判断”，不会显示正常。</small></div>:<>
      <div className="pa-result-bar"><span>已查询 {result.range.startDate} — {result.range.endDate} · {scored.length} 个三方 / 币种组合</span><span>生成于 {result.report.generatedAt.replace("T"," ")}</span></div>
      {dirty&&<p className="pa-dirty">日期已修改，点击查询后生效。</p>}
      {!!result.report.notices.length&&<details className="pa-notices"><summary>数据覆盖说明</summary>{result.report.notices.map((notice,index)=><p key={index} className="pa-method">{notice}</p>)}</details>}
      <div className="pa-status-strip">{(["critical","warning","unknown","normal"] as const).map(state=><button type="button" key={state} className={status===state?"selected":""} onClick={()=>{setStatus(status===state?"all":state);setPage(1);}}>{RISK_LABELS[state]} <b>{scored.filter(r=>r.state===state).length}</b></button>)}</div>
      <div className="pa-filter"><label>三方名称<input type="search" value={provider} placeholder="筛选已读取的三方" onChange={e=>{setProvider(e.target.value);setPage(1);}}/></label><label>状态<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">全部状态</option>{(["critical","warning","unknown","normal"] as const).map(state=><option value={state} key={state}>{RISK_LABELS[state]}</option>)}</select></label><span>金额不跨币种相加 · 展开三方查看来源</span></div>
      <div className="pa-table-wrap"><table><thead><tr><th>统一三方 / 币种</th><th>综合提示</th><th>创建至成功耗时</th><th>持续低代收成功率</th><th>代收金额占比</th><th>零点未完成代付</th></tr></thead><tbody>{rows.map(row=><ProviderRiskRow key={row.key} row={row}/>)}{!rows.length&&<tr><td colSpan={6} className="pa-no-rows">{scored.length?"没有符合当前筛选的三方。":"当前范围未返回可分析数据；不代表三方正常。"}</td></tr>}</tbody></table></div>
      <footer className="pa-pagination"><span>{filtered.length} 组 · 每页 20 组</span><button type="button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>下一页</button></footer>
    </>}
  </section>;
}
