"use client";
import {useEffect,useRef,useState} from "react";
import {useDashboardAuth} from "./DashboardAuthGate";
import {dashboardAuthenticatedFetch,type DashboardSession} from "@/lib/dashboardAuthClient";
import {dashboardScopeIdentity} from "@/lib/dashboardDataScope";
import {orderTimeRequest,sourceTime,type OrderTimePayload} from "@/lib/orderTimeQuery";
import {queryOrderTimeBatches} from "@/lib/orderTimeBatch";
import {timePlatformCountry,timeOrderFilters,timeSourceRows,type TimeQuerySelection,type TimeQueryResult} from "@/lib/orderTimeVolume";
import {formatNumber} from "@/lib/format";
import "./OrderTimeDashboard.css";

export function isOrderQueryDenied(error:unknown):boolean {
  const value=error as {status?:number;code?:string};
  return [401,403].includes(Number(value?.status))||value?.code==="42501"||String(value?.code||"").startsWith("28");
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
  const identity=dashboardScopeIdentity(profile),currentIdentity=useRef(identity);currentIdentity.current=identity;
  const [mode,setMode]=useState<"daily"|"created"|"success">("daily");
  const [startClock,setStartClock]=useState("00:00:00"),[endClock,setEndClock]=useState("23:59:59");
  const [createdStart,setCreatedStart]=useState(""),[createdEnd,setCreatedEnd]=useState("");
  const [platforms,setPlatforms]=useState<OrderTimePayload["platforms"]>([]);
  const [stored,setStored]=useState<{identity:string;data:TimeQueryResult}|null>(null);
  const [active,setActive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [optionsError,setOptionsError]=useState("");
  const [optionsLoading,setOptionsLoading]=useState(false),[optionsRetry,setOptionsRetry]=useState(0);
  const [progress,setProgress]=useState({completed:0,total:0,active:0});
  const requestSerial=useRef(0),flight=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController();let disposed=false,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},30000);
    ++requestSerial.current;flight.current?.abort();
    setPlatforms([]);setStored(null);setActive(false);setBusy(false);setError("");setOptionsError("");
    setOptionsLoading(true);
    void orderTimeRpc(session,"dashboard_order_time_query",{},controller.signal).then(payload=>{
      if(!controller.signal.aborted&&Array.isArray(payload.platforms))setPlatforms(payload.platforms);
    }).catch(err=>{if(!disposed)setOptionsError(timedOut?"平台明细权限读取超时，请重试。":err.message);})
      .finally(()=>{clearTimeout(timer);if(!disposed)setOptionsLoading(false);});
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
      if(input.platforms.length!==1)throw new Error("时间段查询必须选择一个平台，不能查询全部或多个平台。");
      const selected=platforms.filter(p=>timePlatformCountry(p)===input.country&&(!input.platforms.length||input.platforms.includes(p.name)));
      if(!selected.length)throw new Error(optionsError||"当前平台尚未接入订单明细，请使用日汇总；接入采集脚本后才能按时段查询。");
      if(selected.length!==1)throw new Error("平台配置存在重名，请联系管理员确认后再查询。");
      if(input.platforms.some(name=>!selected.some(p=>p.name===name)))throw new Error("所选平台中有未接入订单明细的平台，请分开查询，不能把日汇总混进时间段结果。");
      const selection:TimeQuerySelection={...input,basis:mode,createdStart:mode==="success"?createdStart:"",createdEnd:mode==="success"?createdEnd:"",
        memberId:"",orderNumber:"",status:"all",crossDayOnly:false};
      const draft:TimeQueryResult={selection,payloads:[]};
      // One shared two-request queue; day/direction shards stay under the
      // database timeout and publish one result only when every shard succeeds.
      const payloads=await queryOrderTimeBatches(selected.map(p=>timeOrderFilters(draft,p.id)),
        (body,signal)=>orderTimeRpc(session,"dashboard_order_time_query",body,signal),
        {signal:controller.signal,onProgress:value=>{if(serial===requestSerial.current&&viewer===currentIdentity.current)setProgress(value);}});
      if(serial!==requestSerial.current||viewer!==currentIdentity.current)return false;
      setStored({identity:viewer,data:{selection,payloads}});setActive(true);return true;
    }catch(err){if(serial===requestSerial.current){
      if(isOrderQueryDenied(err)){setStored(null);setActive(false);setPlatforms([]);}
      setError(controller.signal.aborted?"查询超时，请缩短时间段。":(err as Error).message);
    }return false;}
    finally{clearTimeout(timer);if(serial===requestSerial.current)setBusy(false);}
  }
  return {mode,setMode,startClock,setStartClock,endClock,setEndClock,createdStart,setCreatedStart,createdEnd,setCreatedEnd,
    platforms,run,busy,error,progress,cancel:()=>{++requestSerial.current;flight.current?.abort();setBusy(false);setError("查询已取消，保留上次查询结果。");},optionsError,optionsLoading,reloadOptions:()=>setOptionsRetry(n=>n+1),active:active&&stored?.identity===identity,result:stored?.identity===identity?stored.data:null,
    showDaily:()=>{setActive(false);setError("");}};
}

export function TimeQueryExtra({query}:{query:ReturnType<typeof useOrderTimeQuery>}) {
  if(query.mode==="daily")return null;
  return <div className="integrated-time-extra">
    <div className="order-query-help"><span>印度后台时间 UTC+05:30 · 单次最多 31 天</span><span>{query.mode==="created"?"统计时段内创建的订单，包括尚未成功的订单。":"统计时段内成功的订单，包括以前创建的订单。"}</span></div>
    {query.busy&&<p role="status" className="order-query-progress">正在分段读取：{query.progress.completed} / {query.progress.total}，全部完成后统一展示。 <button type="button" className="mini-btn" onClick={query.cancel}>取消查询</button></p>}
    {query.optionsLoading&&<p role="status">正在读取可查询的平台…</p>}
    {query.optionsError&&<p role="alert" className="business-query-error">{query.optionsError} <button type="button" className="mini-btn" onClick={query.reloadOptions}>重新读取平台</button></p>}
    {query.mode==="success"&&<details className="order-advanced"><summary>更多筛选：限制创建时间（可选）{query.createdStart||query.createdEnd?" · 已设置":""}</summary><div className="time-secondary-fields">
      <label className="field">创建开始<input className="input" type="datetime-local" step="1" value={query.createdStart} onChange={e=>query.setCreatedStart(e.target.value)}/></label>
      <label className="field">创建结束<input className="input" type="datetime-local" step="1" value={query.createdEnd} onChange={e=>query.setCreatedEnd(e.target.value)}/></label>
      <button className="mini-btn" type="button" onClick={()=>{query.setCreatedStart("");query.setCreatedEnd("");}}>清除创建时间限制</button>
    </div><small>默认不限制创建日期，包含之前月份创建、本次时段成功的订单。</small></details>}
  </div>;
}

type DetailRow={id:string;order_number:string;member_id:string|null;third_party_order_number:string|null;direction:string;provider:string;channel_type:string;status:string;status_group:string;succeeded:boolean;
  created_at:string|null;success_at:string|null;amount:number;actual_amount:number|null;withdraw_fee:number|null;synced_at:string;cross_day:boolean};
type DetailPage={rows:DetailRow[];hasMore:boolean;nextCursor:unknown};

export function OrderRecordModal({result,channel,onClose}:{result:TimeQueryResult;channel:string;onClose:()=>void}) {
  const {session,profile}=useDashboardAuth(),identity=dashboardScopeIdentity(profile);
  const source=timeSourceRows(result).filter(r=>r.channel===channel);
  const choices=result.payloads.filter(p=>source.some(r=>r.platformId===p.id));
  const [platform,setPlatform]=useState(choices[0]?.id||"");
  const [cursors,setCursors]=useState<unknown[]>([null]),[page,setPage]=useState(0);
  const [data,setData]=useState<DetailPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
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
    <div className="detail-modal-header"><div><h3>{channel} · 订单明细</h3><p>{result.selection.basis==="created"?"创建时间":"成功时间"}：{result.selection.start.replace("T"," ")} — {result.selection.end.replace("T"," ")} · 印度时间</p></div><button className="modal-close-btn" type="button" onClick={onClose}>关闭</button></div>
    <div className="record-toolbar"><label className="field">平台<select className="input" value={platform} onChange={e=>{setPlatform(e.target.value);setCursors([null]);setPage(0);}}>{choices.map(p=><option value={p.id} key={p.id}>{p.payload.platform}</option>)}</select></label><span>每页 50 笔 · 仅展示有权限的业务记录</span><button type="button" className="mini-btn" disabled={!page||busy} onClick={()=>setPage(n=>n-1)}>上一页</button><span>第 {page+1} 页</span><button type="button" className="mini-btn" disabled={!data?.hasMore||busy} onClick={()=>{setCursors(old=>[...old.slice(0,page+1),data!.nextCursor]);setPage(n=>n+1);}}>下一页</button></div>
    {error&&<p role="alert" className="business-query-error">{error} <button type="button" className="mini-btn" onClick={()=>setReload(n=>n+1)}>重试</button></p>}
    <div className="table-wrap"><table><thead><tr><th>会员 ID</th><th>订单号</th><th>三方订单号</th><th>业务</th><th>三方通道</th><th>状态</th><th>订单金额</th><th>实际到账</th><th>提现手续费</th><th>创建时间</th><th>成功时间</th><th>最近同步</th></tr></thead><tbody>
      {data?.rows.map(r=><tr key={`${r.direction}:${r.id}`}><td>{r.member_id||"—"}</td><td>{r.order_number||"—"}</td><td>{r.third_party_order_number||"—"}</td><td>{r.direction==="charge"?"代收":"代付"}</td><td>{r.provider}<small>{r.channel_type}</small></td><td>{r.status}{r.cross_day&&<small className="cross-day-tag">跨日成功</small>}</td><td>{formatNumber(r.amount)}</td><td>{r.actual_amount==null?"—":formatNumber(r.actual_amount)}</td><td>{r.withdraw_fee==null?"—":formatNumber(r.withdraw_fee)}</td><td>{sourceTime(r.created_at)}</td><td>{sourceTime(r.success_at)}</td><td>{sourceTime(r.synced_at)}</td></tr>)}
      {!data?.rows.length&&<tr><td colSpan={12} className="empty">{busy?"正在读取订单明细…":error?"读取失败，未显示旧明细":"当前条件没有已入库订单"}</td></tr>}
    </tbody></table></div>
  </div></div>;
}
