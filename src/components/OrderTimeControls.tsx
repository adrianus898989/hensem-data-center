"use client";
import {useEffect,useRef,useState} from "react";
import {useDashboardAuth} from "./DashboardAuthGate";
import {dashboardAuthenticatedFetch,type DashboardSession} from "@/lib/dashboardAuthClient";
import {dashboardScopeIdentity} from "@/lib/dashboardDataScope";
import {orderTimeRequest,sourceTime,type OrderTimePayload} from "@/lib/orderTimeQuery";
import {queryOrderTimeBatches} from "@/lib/orderTimeBatch";
import {selectOrderTimePlatforms} from "@/lib/orderTimePlatforms";
import {timeOrderFilters,timeSourceRows,type TimeQuerySelection,type TimeQueryResult} from "@/lib/orderTimeVolume";
import {previousTimeSelection,comparisonScopeIssues,historicalDailyComparison,type TimeComparisonState} from "@/lib/orderTimeComparison";
import {dashboardBusinessFetch} from "@/lib/dashboardDataClient";
import type {ThirdPartyVolumeRow,WithdrawPendingSnapshot} from "@/lib/types";
import {usesMidnightPending} from "@/lib/orderTimePending";
import {dailyFallbackPlatforms,dailyVolumeRows} from "@/lib/orderTimeDaily";
import {formatOrderDetailAmount,orderDetailStatusLabel} from "@/lib/orderDetailSearch";
import "./OrderTimeDashboard.css";

export function isOrderQueryDenied(error:unknown):boolean {
  const value=error as {status?:number;code?:string};
  return [401,403].includes(Number(value?.status))||value?.code==="42501"||String(value?.code||"").startsWith("28");
}

export async function readMidnightPending(session:DashboardSession,date:string,country:string,signal:AbortSignal):Promise<WithdrawPendingSnapshot[]> {
  const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/$/,"");
  const response=await dashboardAuthenticatedFetch(`${base}/rest/v1/rpc/dashboard_withdraw_pending`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({p_start:date,p_end:date,p_country:country}),signal,cache:"no-store"
  },session);
  const payload=await response.json();
  if(!response.ok||!Array.isArray(payload?.snapshots))throw new Error("代付中零点快照暂未载入，请重新查询。");
  return payload.snapshots;
}

export function useMidnightPending(result:TimeQueryResult,paused=false) {
  const {session,profile}=useDashboardAuth();
  const identity=`${session?.user.id||""}:${dashboardScopeIdentity(profile)}`;
  const enabled=usesMidnightPending(result);
  const [stored,setStored]=useState<{result:TimeQueryResult;identity:string;snapshots:WithdrawPendingSnapshot[];error?:string}|null>(null);
  useEffect(()=>{
    if(paused||!session||!enabled)return;
    const controller=new AbortController();let disposed=false;
    const timer=setTimeout(()=>controller.abort(),15000);
    void readMidnightPending(session,result.selection.end.slice(0,10),result.selection.country,controller.signal)
      .then(snapshots=>{if(!disposed&&!controller.signal.aborted)setStored({result,identity,snapshots});})
      .catch(()=>{if(!disposed)setStored({result,identity,snapshots:[],error:"代付中零点快照暂未载入，请重新查询。"});})
      .finally(()=>clearTimeout(timer));
    return ()=>{disposed=true;controller.abort();clearTimeout(timer);};
  },[result,identity,paused,enabled]);
  return stored?.identity===identity&&stored.result===result?stored:{snapshots:[],error:"代付中零点快照载入中…"};
}

/** Current totals render first; comparison never blocks or overlaps a new search. */
export function useOrderTimeComparison(result:TimeQueryResult,paused=false):TimeComparisonState {
  const {session,profile}=useDashboardAuth();
  const identity=`${session?.user.id||""}:${dashboardScopeIdentity(profile)}`;
  const [stored,setStored]=useState<{result:TimeQueryResult;identity:string;state:TimeComparisonState}|null>(null);
  const cache=useRef(new Map<string,{at:number;rows:ThirdPartyVolumeRow[]}>());
  useEffect(()=>{cache.current.clear();},[identity]);
  useEffect(()=>{
    if(paused||!session)return;
    const unsupported=comparisonScopeIssues(result);
    if(unsupported.length){setStored({result,identity,state:{status:"unavailable",issues:unsupported}});return;}
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    const previous=previousTimeSelection(result.selection);
    const key=JSON.stringify([identity,previous.country,previous.start,previous.end]);
    const hit=cache.current.get(key);
    if(hit&&Date.now()-hit.at<300000){
      clearTimeout(timer);setStored({result,identity,state:historicalDailyComparison(result,hit.rows)});return;
    }
    setStored({result,identity,state:{status:"loading"}});
    void (async()=>{
        const rows=await orderComparisonDailyRows(previous.start.slice(0,10),previous.end.slice(0,10),previous.country,controller.signal);
        if(controller.signal.aborted)return;
        if(cache.current.size>=4)cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(key,{at:Date.now(),rows});
        setStored({result,identity,state:historicalDailyComparison(result,rows)});
      })().catch(()=>{if(!disposed)setStored({result,identity,state:{status:"error"}});})
      .finally(()=>clearTimeout(timer));
    let disposed=false;
    return()=>{disposed=true;controller.abort();clearTimeout(timer);};
  // Refreshing a token does not restart a matching comparison; RPC verifies scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[result,paused,identity]);
  return stored?.identity===identity&&stored.result===result?stored.state:{status:"loading"};
}

/** Existing authorized daily endpoint, including source replacement/aliases.
 * A single small summary read replaces one raw-order query per platform.
 */
export async function orderComparisonDailyRows(start:string,end:string,country:string,signal:AbortSignal):Promise<ThirdPartyVolumeRow[]> {
  const query=new URLSearchParams({start,end,country});
  const response=await dashboardBusinessFetch(`/api/supabase-third-party-volume?${query}`,{signal,cache:"no-store"});
  const payload=await response.json();
  if(!response.ok||!Array.isArray(payload?.rows))throw new Error("历史日汇总暂未载入。");
  return payload.rows;
}

/** One background summary read fills platforms without a detail source. */
export function useOrderTimeDaily(result:TimeQueryResult,paused=false) {
  const {session,profile}=useDashboardAuth();
  const identity=`${session?.user.id||""}:${dashboardScopeIdentity(profile)}`;
  const enabled=dailyFallbackPlatforms(result).length>0;
  const [stored,setStored]=useState<{result:TimeQueryResult;identity:string;rows:ThirdPartyVolumeRow[];error?:string}|null>(null);
  useEffect(()=>{
    if(paused||!session||!enabled)return;
    const controller=new AbortController();let disposed=false;
    const timer=setTimeout(()=>controller.abort(),30000);
    const s=result.selection;
    void orderComparisonDailyRows(s.start.slice(0,10),s.end.slice(0,10),s.country,controller.signal)
      .then(rows=>{if(!disposed&&!controller.signal.aborted)setStored({result,identity,rows});})
      .catch(()=>{if(!disposed)setStored({result,identity,rows:[],error:"部分平台的日汇总暂未载入，请重新查询。"});})
      .finally(()=>clearTimeout(timer));
    return()=>{disposed=true;controller.abort();clearTimeout(timer);};
  },[result,identity,paused,enabled]);
  const current=stored?.result===result&&stored.identity===identity?stored:null;
  return {rows:enabled?current?.rows:undefined,loading:enabled&&!current,error:enabled?current?.error:undefined};
}

export async function orderTimeRpc(session:DashboardSession|null, name:string,body:unknown,signal:AbortSignal) {
  if(!session)throw new Error("请先登录。");
  const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/$/,"");
  const response=await dashboardAuthenticatedFetch(`${base}/rest/v1/rpc/${name}`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal,cache:"no-store"
  },session);
  const payload=await response.json();
  if(!response.ok)throw Object.assign(new Error([401,403].includes(response.status)?"登录失效或无此平台权限。":payload?.code==="57014"?"查询数据较多，请缩短时间范围或增加筛选后重试。":payload?.message||"读取明细失败，请重试。"),{code:payload?.code,status:response.status});
  if(!Array.isArray(payload?.rows))throw new Error("订单查询返回不完整。");
  return payload;
}

export function useOrderTimeQuery() {
  const {session,profile}=useDashboardAuth();
  const identity=`${session?.user.id||""}:${dashboardScopeIdentity(profile)}`,currentIdentity=useRef(identity);currentIdentity.current=identity;
  const [mode,setMode]=useState<"daily"|"created"|"success">("created");
  const [startClock,setStartClock]=useState("00:00:00"),[endClock,setEndClock]=useState("23:59:59");
  const [createdStart,setCreatedStart]=useState(""),[createdEnd,setCreatedEnd]=useState("");
  const [platforms,setPlatforms]=useState<OrderTimePayload["platforms"]>([]);
  const [stored,setStored]=useState<{identity:string;data:TimeQueryResult}|null>(null);
  const [active,setActive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [optionsError,setOptionsError]=useState("");
  const [optionsLoading,setOptionsLoading]=useState(false),[optionsRetry,setOptionsRetry]=useState(0);
  const [progress,setProgress]=useState({completed:0,total:0,active:0});
  const requestSerial=useRef(0),flight=useRef<AbortController|null>(null);
  function clearResult() {
    ++requestSerial.current;flight.current?.abort();
    setStored(null);setActive(false);setBusy(false);setError("");setProgress({completed:0,total:0,active:0});
  }
  useEffect(()=>{
    const controller=new AbortController();let disposed=false,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},30000);
    ++requestSerial.current;flight.current?.abort();
    setPlatforms([]);setStored(null);setActive(false);setBusy(false);setError("");setOptionsError("");
    setOptionsLoading(true);
    void orderTimeRpc(session,"dashboard_order_time_query",{},controller.signal).then(payload=>{
      if(!disposed&&identity===currentIdentity.current&&!controller.signal.aborted&&Array.isArray(payload.platforms))setPlatforms(payload.platforms);
    }).catch(err=>{if(!disposed&&identity===currentIdentity.current)setOptionsError(timedOut?"平台明细权限读取超时，请重试。":err.message);})
      .finally(()=>{clearTimeout(timer);if(!disposed&&identity===currentIdentity.current)setOptionsLoading(false);});
    return()=>{disposed=true;clearTimeout(timer);controller.abort();flight.current?.abort();++requestSerial.current;};
  // Token refresh must not erase a query. RPC always verifies server-side scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[identity,session?.user.id,optionsRetry]);
  async function run(input:Omit<TimeQuerySelection,"basis"|"createdStart"|"createdEnd"|"memberId"|"orderNumber"|"status"|"crossDayOnly">) {
    if(mode==="daily")return false;
    const viewer=identity,serial=++requestSerial.current,controller=new AbortController();
    flight.current?.abort();flight.current=controller;
    const timer=setTimeout(()=>controller.abort(),600000);
    setBusy(true);setError("");setProgress({completed:0,total:0,active:0});
    try {
      if(optionsLoading)throw new Error("正在读取可查询的平台，请稍后查询。");
      if(optionsError)throw new Error(optionsError);
      const selected=selectOrderTimePlatforms(platforms,input.country,input.platforms,input.availablePlatforms);
      const selection:TimeQuerySelection={...input,platforms:[...new Set(input.platforms)],availablePlatforms:input.availablePlatforms?[...new Set(input.availablePlatforms)]:undefined,basis:mode,createdStart:mode==="success"?createdStart:"",createdEnd:mode==="success"?createdEnd:"",
        memberId:"",orderNumber:"",status:"all",crossDayOnly:false};
      const draft:TimeQueryResult={selection,payloads:[]};
      // One shared four-request queue; day/direction shards stay under the
      // database timeout and publish one result only when every shard succeeds.
      const payloads=await queryOrderTimeBatches(selected.map(p=>timeOrderFilters(draft,p.id,p.timezone)),
        (body,signal)=>orderTimeRpc(session,"dashboard_order_time_query",body,signal),
        {signal:controller.signal,concurrency:4,onProgress:value=>{if(serial===requestSerial.current&&viewer===currentIdentity.current)setProgress(value);}});
      if(controller.signal.aborted||serial!==requestSerial.current||viewer!==currentIdentity.current)return false;
      setStored({identity:viewer,data:{selection,payloads}});setActive(true);return true;
    }catch(err){if(serial===requestSerial.current&&viewer===currentIdentity.current){
      if(isOrderQueryDenied(err)){setStored(null);setActive(false);setPlatforms([]);}
      setError(controller.signal.aborted?"查询超时，请缩短时间段。":(err as Error).message);
    }return false;}
    finally{clearTimeout(timer);if(serial===requestSerial.current&&viewer===currentIdentity.current)setBusy(false);}
  }
  return {mode,setMode,startClock,setStartClock,endClock,setEndClock,createdStart,setCreatedStart,createdEnd,setCreatedEnd,
    platforms,run,busy,error,progress,clearResult,cancel:()=>{++requestSerial.current;flight.current?.abort();setBusy(false);setError("查询已取消，保留上次查询结果。");},optionsError,optionsLoading,reloadOptions:()=>setOptionsRetry(n=>n+1),active:active&&stored?.identity===identity,result:stored?.identity===identity?stored.data:null,
    showDaily:()=>{setActive(false);setError("");}};
}

export function TimeQueryExtra({query,showTimeHelp=true,hideExplanation=false}:{query:ReturnType<typeof useOrderTimeQuery>;showTimeHelp?:boolean;hideExplanation?:boolean}) {
  if(query.mode==="daily")return null;
  if(hideExplanation&&!query.busy&&!query.optionsLoading&&!query.optionsError&&!(showTimeHelp&&query.mode==="success"))return null;
  return <div className="integrated-time-extra">
    {showTimeHelp&&!hideExplanation&&<div className="order-query-help"><span>印度后台时间 UTC+05:30 · 单次最多 31 天</span><span>{query.mode==="created"?"统计时段内创建的订单，包括尚未成功的订单。":"统计时段内成功的订单，包括以前创建的订单。"}</span></div>}
    {query.busy&&<p role="status" className="order-query-progress">正在分段读取：{query.progress.completed} / {query.progress.total}，全部完成后统一展示。 <button type="button" className="mini-btn" onClick={query.cancel}>取消查询</button></p>}
    {query.optionsLoading&&<p role="status">正在读取可查询的平台…</p>}
    {query.optionsError&&<p role="alert" className="business-query-error">{query.optionsError} <button type="button" className="mini-btn" onClick={query.reloadOptions}>重新读取平台</button></p>}
    {showTimeHelp&&query.mode==="success"&&<details className="order-advanced"><summary>更多筛选：限制创建时间（可选）{query.createdStart||query.createdEnd?" · 已设置":""}</summary><div className="time-secondary-fields">
      <label className="field">创建开始<input className="input" type="datetime-local" step="1" value={query.createdStart} onChange={e=>query.setCreatedStart(e.target.value)}/></label>
      <label className="field">创建结束<input className="input" type="datetime-local" step="1" value={query.createdEnd} onChange={e=>query.setCreatedEnd(e.target.value)}/></label>
      <button className="mini-btn" type="button" onClick={()=>{query.setCreatedStart("");query.setCreatedEnd("");}}>清除创建时间限制</button>
    </div><small>默认不限制创建日期，包含之前月份创建、本次时段成功的订单。</small></details>}
  </div>;
}

type DetailRow={id:string;order_number:string;member_id:string|null;third_party_order_number:string|null;direction:string;provider:string;channel_type:string;status:string;status_group:string;succeeded:boolean;currency?:string|null;
  created_at:string|null;success_at:string|null;amount:number|string|null;actual_amount:number|string|null;withdraw_fee:number|string|null;synced_at:string;cross_day:boolean};
type DetailPage={rows:DetailRow[];hasMore:boolean;nextCursor:unknown;timezone?:string};

export function OrderRecordModal({result,channel,onClose}:{result:TimeQueryResult;channel:string;onClose:()=>void}) {
  const {session,profile}=useDashboardAuth(),identity=dashboardScopeIdentity(profile);
  const source=timeSourceRows(result).filter(r=>r.channel===channel);
  const choices=result.payloads.filter(p=>source.some(r=>r.platformId===p.id));
  const dailyPlatforms=[...new Set(dailyVolumeRows(result).filter(row=>row.channel===channel).map(row=>row.platform))];
  const [platform,setPlatform]=useState(choices[0]?.id||"");
  const [cursors,setCursors]=useState<unknown[]>([null]),[page,setPage]=useState(0);
  const [data,setData]=useState<DetailPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const timezone=data?.timezone||choices.find(choice=>choice.id===platform)?.payload.timezone||"Asia/Kolkata";
  const [reload,setReload]=useState(0);
  const [owner]=useState(identity);
  useEffect(()=>{
    if(owner!==identity||!platform)return;
    const controller=new AbortController();let disposed=false,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},60000);
    setBusy(true);setError("");setData(null);
    const providers=[...new Set(source.filter(r=>r.platformId===platform).map(r=>r.provider))];
    void orderTimeRpc(session,"dashboard_order_time_details",{...orderTimeRequest(timeOrderFilters(result,platform)),
      p_providers:providers,p_types:result.selection.types.length?result.selection.types:null,p_cursor:cursors[page],p_limit:50},controller.signal)
      .then(value=>{if(!controller.signal.aborted)setData(value);})
      .catch(err=>{if(!disposed)setError(timedOut?"明细查询超时，请重试。":err.message);})
      .finally(()=>{clearTimeout(timer);if(!disposed)setBusy(false);});
    return()=>{disposed=true;controller.abort();clearTimeout(timer);};
  // result and channel are immutable while this modal is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[platform,page,identity,reload]);
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};document.addEventListener("keydown",handler);return()=>document.removeEventListener("keydown",handler);},[onClose]);
  if(owner!==identity)return null;
  return <div className="modal-backdrop" onClick={onClose}><div className="detail-modal volume-detail-modal order-record-modal" role="dialog" aria-modal="true" aria-label={`${channel}订单明细`} onClick={e=>e.stopPropagation()}>
    <div className="detail-modal-header"><div><h3>{channel} · 订单明细</h3><p>{result.selection.basis==="created"?"创建时间":"成功时间"}：{result.selection.start.replace("T"," ")} — {result.selection.end.replace("T"," ")} · {timezone}</p></div><button className="modal-close-btn" type="button" onClick={onClose}>关闭</button></div>
    {dailyPlatforms.length>0&&<p role="status">{dailyPlatforms.join("、")} 已显示日汇总金额与笔数，订单明细尚未接入。</p>}
    <div className="record-toolbar"><label className="field">平台<select className="input" value={platform} onChange={e=>{setPlatform(e.target.value);setData(null);setCursors([null]);setPage(0);}}>{choices.map(p=><option value={p.id} key={p.id}>{p.payload.platform}</option>)}</select></label><span>每页 50 笔 · 仅展示有权限的业务记录</span><button type="button" className="mini-btn" disabled={!page||busy} onClick={()=>setPage(n=>n-1)}>上一页</button><span>第 {page+1} 页</span><button type="button" className="mini-btn" disabled={!data?.hasMore||busy} onClick={()=>{setCursors(old=>[...old.slice(0,page+1),data!.nextCursor]);setPage(n=>n+1);}}>下一页</button></div>
    {error&&<p role="alert" className="business-query-error">{error} <button type="button" className="mini-btn" onClick={()=>setReload(n=>n+1)}>重试</button></p>}
    <div className="table-wrap"><table><thead><tr><th>会员 ID</th><th>订单号</th><th>三方订单号</th><th>业务</th><th>三方通道</th><th>状态</th><th>订单金额</th><th>实际到账</th><th>提现手续费</th><th>创建时间</th><th>成功时间</th><th>最近同步</th></tr></thead><tbody>
      {data?.rows.map(r=><tr key={`${r.direction}:${r.id}`}><td>{r.member_id||"—"}</td><td>{r.order_number||"—"}</td><td>{r.third_party_order_number||"—"}</td><td>{r.direction==="charge"?"代收":"代付"}</td><td>{r.provider}<small>{r.channel_type}</small></td><td>{orderDetailStatusLabel(r.status,r.status_group)}{r.cross_day&&<small className="cross-day-tag">跨日成功</small>}</td><td>{formatOrderDetailAmount(r.amount)}{r.currency&&<small>{r.currency}</small>}</td><td>{formatOrderDetailAmount(r.actual_amount)}</td><td>{formatOrderDetailAmount(r.withdraw_fee)}</td><td>{sourceTime(r.created_at,timezone)}</td><td>{sourceTime(r.success_at,timezone)}</td><td>{sourceTime(r.synced_at,timezone)}</td></tr>)}
      {!data?.rows.length&&<tr><td colSpan={12} className="empty">{busy?"正在读取订单明细…":error?"读取失败，未显示旧明细":"当前条件没有已入库订单"}</td></tr>}
    </tbody></table></div>
  </div></div>;
}
