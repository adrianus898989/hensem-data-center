"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {useDashboardAuth} from "./DashboardAuthGate";
import {dashboardAuthenticatedFetch,DashboardHttpError} from "@/lib/dashboardAuthClient";
import {dashboardScopeIdentity} from "@/lib/dashboardDataScope";
import {newarDay,newarLocalTime,newarDetailRequest,validateNewarPlatforms,validateNewarPage,
  type NewarDraft,type NewarPlatform,type NewarPage,type NewarCursor,type NewarDataset,type NewarBasis} from "@/lib/newarDetailSearch";
import "./OrderDetailSearch.css";

const labels:Record<string,string>={charge:"充值",withdraw:"提现",workorder:"工单",success:"成功 / 已处理",pending:"待处理 / 处理中",failed:"失败",rejected:"已拒绝",unknown:"其他状态"};
function initial():NewarDraft {const day=newarDay("Asia/Karachi");return {platform:"",dataset:"charge",basis:"created",start:day+"T00:00:00",end:day+"T23:59:59",member:"",order:"",status:"all"};}
export default function NewarDetailSearch(){
  const {session,profile}=useDashboardAuth();
  const owner=`${session?.user.id||""}:${dashboardScopeIdentity(profile)}`;
  const [draft,setDraft]=useState(initial),[options,setOptions]=useState<NewarPlatform[]>([]),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
  const [result,setResult]=useState<{owner:string;draft:NewarDraft;platform:NewarPlatform;page:number;cursors:(NewarCursor|null)[];data:NewarPage}|null>(null);
  const requestId=useRef(0),flight=useRef<AbortController|null>(null),currentOwner=useRef(owner);currentOwner.current=owner;
  const selected=options.find(p=>p.platform===draft.platform);
  const visible=result?.owner===owner?result:null;
  async function rpc(name:string,body:unknown,signal:AbortSignal){
    if(!session)throw new Error("请先登录。");
    const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/$/,"");
    const response=await dashboardAuthenticatedFetch(`${base}/rest/v1/rpc/${name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal,cache:"no-store"},session);
    const payload=await response.json();
    if(!response.ok)throw new DashboardHttpError([401,403].includes(response.status)?"登录失效或无权查询此平台。":payload?.message||"读取失败，请重试。",response.status);
    return payload;
  }
  useEffect(()=>{
    ++requestId.current;flight.current?.abort();setBusy(false);setResult(null);setDraft(initial());setOptions([]);setLoading(true);setError("");
    const controller=new AbortController();let disposed=false;const timeout=setTimeout(()=>controller.abort(),30000);
    void rpc("dashboard_newar_detail_platforms",{},controller.signal).then(value=>{
      const list=validateNewarPlatforms(value);if(!disposed&&currentOwner.current===owner)setOptions(list);
    }).catch(e=>{if(!disposed)setError(controller.signal.aborted?"平台读取超时，请重试。":e.message);})
      .finally(()=>{clearTimeout(timeout);if(!disposed)setLoading(false);});
    return()=>{disposed=true;clearTimeout(timeout);controller.abort();flight.current?.abort();++requestId.current;};
  // Refreshing tokens does not erase user's search.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[owner,retry]);
  function patch(value:Partial<NewarDraft>){setDraft(d=>({...d,...value}));}
  function selectPlatform(name:string){
    const platform=options.find(p=>p.platform===name);
    const oldDay=newarDay(selected?.timezone||"Asia/Karachi"),nextDay=newarDay(platform?.timezone||"Asia/Karachi");
    const pristine=draft.start===oldDay+"T00:00:00"&&draft.end===oldDay+"T23:59:59";
    patch({platform:name,dataset:platform?.datasets[0]||"charge",basis:"created",
      ...(pristine?{start:nextDay+"T00:00:00",end:nextDay+"T23:59:59"}:{})});
  }
  async function query(snapshot:NewarDraft,page=0,cursors:(NewarCursor|null)[]=[null]){
    const platform=options.find(p=>p.platform===snapshot.platform);
    let body:ReturnType<typeof newarDetailRequest>;
    try{if(!platform)throw new Error("请选择一个平台。");body=newarDetailRequest(snapshot,platform,cursors[page]);}catch(e){setError((e as Error).message);return;}
    const id=++requestId.current;flight.current?.abort();const controller=new AbortController();flight.current=controller;
    const timeout=setTimeout(()=>controller.abort(),45000);setBusy(true);setError("");
    try{
      const value=await rpc("dashboard_newar_detail_search",body,controller.signal);
      const data=validateNewarPage(value,body,platform!);
      if(id===requestId.current&&currentOwner.current===owner&&!controller.signal.aborted)setResult({owner,draft:snapshot,platform:platform!,page,cursors,data});
    }catch(e){if(id===requestId.current&&currentOwner.current===owner){
      if(e instanceof DashboardHttpError&&[401,403].includes(e.status)){setResult(null);setOptions([]);}
      setError(controller.signal.aborted?"查询已取消或超时。":(e as Error).message);
    }}finally{clearTimeout(timeout);if(id===requestId.current)setBusy(false);}
  }
  const zone=selected?.timezone||"Asia/Karachi";
  return <section className="order-detail-search" aria-label="NEWAR订单与工单明细">
    <header className="ods-title"><div><h2>NEWAR 订单 / 工单明细</h2><p>充值、提现和工单独立查询；只读取已同步记录，不重新采集。</p></div><span>{zone==="Asia/Karachi"?"巴基斯坦时间 · UTC+05:00":"印度时间 · UTC+05:30"}</span></header>
    <form className="ods-search-card" onSubmit={(e:FormEvent)=>{e.preventDefault();void query({...draft});}}>
      <div className="ods-primary-fields">
        <label className="ods-field"><span>平台 *</span><select required disabled={loading} value={draft.platform} onChange={e=>selectPlatform(e.target.value)}><option value="">{loading?"读取中…":"请选择一个平台"}</option>{options.map(p=><option key={p.platform} value={p.platform}>{p.platform} · {p.country}</option>)}</select></label>
        <label className="ods-field"><span>业务</span><select value={draft.dataset} onChange={e=>patch({dataset:e.target.value as NewarDataset,basis:"created"})}>{(selected?.datasets||["charge","withdraw"]).map(d=><option key={d} value={d}>{labels[d]}</option>)}</select></label>
        <label className="ods-field"><span>时间口径</span><select value={draft.basis} onChange={e=>patch({basis:e.target.value as NewarBasis,status:"all"})}><option value="created">{draft.dataset==="workorder"?"提交时间":"创建时间"}</option><option value={draft.dataset==="workorder"?"processed":"success"}>{draft.dataset==="workorder"?"真实处理时间（尚未采集）":"成功时间"}</option></select></label>
        <label className="ods-field"><span>状态</span><select value={draft.status} onChange={e=>patch({status:e.target.value})}><option value="all">全部状态</option>{["success","pending","failed","rejected","unknown"].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>
        <label className="ods-field"><span>开始时间 *</span><input required type="datetime-local" step="1" value={draft.start} onChange={e=>patch({start:e.target.value})}/></label>
        <label className="ods-field"><span>结束时间 *</span><input required type="datetime-local" step="1" value={draft.end} onChange={e=>patch({end:e.target.value})}/></label>
        <label className="ods-field"><span>会员 ID</span><input maxLength={200} value={draft.member} onChange={e=>patch({member:e.target.value})}/></label>
        <label className="ods-field"><span>订单号 / 工单号 / 三方订单号</span><input maxLength={200} value={draft.order} onChange={e=>patch({order:e.target.value})}/></label>
      </div>
      <div className="ods-action-row"><div>{[0,-1].map(offset=><button className="ods-secondary" key={offset} type="button" onClick={()=>{const day=newarDay(zone,offset);patch({start:day+"T00:00:00",end:day+"T23:59:59"});}}>{offset===0?"今天":"昨日"}</button>)}</div><button className="ods-primary" disabled={busy||loading||!selected}>{busy?"查询中…":"查询"}</button></div>
      <p className="ods-footnote">每次单平台、单业务，最多 31 天 / 每页 50 笔。92BLAZE 从巴基斯坦时间 2026-09-22 开始，开站前不补采。金额逐笔显示币种，不换汇相加。</p>
      {draft.dataset==="workorder"&&<p className="ods-footnote">工单最后更新时间不冒充处理时间；源接口没有真实处理时间的记录，该列显示“—”。</p>}
    </form>
    {error&&<p className="ods-error" role="alert">{error} <button type="button" onClick={()=>setRetry(r=>r+1)}>重新读取平台</button></p>}
    {visible&&<section className="ods-results">
      <div className="ods-result-heading"><h3>{visible.platform.platform} · {labels[visible.draft.dataset]}</h3><span>{visible.draft.start.replace("T"," ")} — {visible.draft.end.replace("T"," ")} · {visible.platform.timezone}</span></div>
      {JSON.stringify(draft)!==JSON.stringify(visible.draft)&&<p className="ods-draft-note">筛选已修改，点击查询后生效；翻页仍用上次查询条件。</p>}
      <div className="ods-pagination"><span>第 {visible.page+1} 页 · {visible.data.rows.length} 笔</span><button disabled={busy||visible.page===0} onClick={()=>void query(visible.draft,visible.page-1,visible.cursors)}>上一页</button><button disabled={busy||!visible.data.hasMore} onClick={()=>void query(visible.draft,visible.page+1,[...visible.cursors.slice(0,visible.page+1),visible.data.nextCursor])}>下一页</button></div>
      <div className="ods-table-wrap"><table><thead><tr>{["会员ID","订单/工单号","三方订单号","三方","状态","金额 / 币种","源实际金额","手续费","创建/提交时间","成功时间","处理时间","最后更新"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.data.rows.map(row=><tr key={row.id}><td>{row.member_id||"—"}</td><td>{row.order_number||row.source_id}</td><td>{row.third_party_order_number||"—"}</td><td>{row.provider||"—"}<small>{row.channel_type}</small></td><td>{labels[row.status_group]}<small>源状态 {row.status_code||"未提供"}{row.cross_day?" · 跨日成功":""}</small></td><td>{row.amount} {row.currency||"币种未确认"}</td><td>{row.actual_amount??"—"}</td><td>{row.fee??"—"}</td><td>{newarLocalTime(row.created_at,visible.platform.timezone)}</td><td>{newarLocalTime(row.success_at,visible.platform.timezone)}</td><td>{newarLocalTime(row.processed_at,visible.platform.timezone)}</td><td>{newarLocalTime(row.source_updated_at,visible.platform.timezone)}</td></tr>)}{!visible.data.rows.length&&<tr><td colSpan={12}>当前条件没有已同步记录；不代表源后台没有订单。</td></tr>}</tbody></table></div>
    </section>}
  </section>;
}
