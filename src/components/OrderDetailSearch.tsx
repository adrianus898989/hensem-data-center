"use client";
import {useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {useDashboardAuth} from "./DashboardAuthGate";
import {orderTimeRpc} from "./OrderTimeControls";
import {dashboardScopeIdentity} from "@/lib/dashboardDataScope";
import {sourceDay,sourceTime,type OrderTimePayload} from "@/lib/orderTimeQuery";
import {initialOrderDetailSearch,orderDetailSearchRequest,validateOrderDetailPage,formatOrderDetailAmount,orderDetailStatusLabel,orderDetailAccessDenied,
  type OrderDetailSearchDraft,type OrderDetailCursor,type OrderDetailPage} from "@/lib/orderDetailSearch";
import "./OrderDetailSearch.css";

type AppliedSearch={draft:OrderDetailSearchDraft;platformName:string};
type SearchResult={owner:string;applied:AppliedSearch;page:number;cursors:Array<OrderDetailCursor|null>;data:OrderDetailPage};

export default function OrderDetailSearch() {
  const {session,profile}=useDashboardAuth();
  const identity=`${session?.user.id||"anonymous"}:${dashboardScopeIdentity(profile)}`;
  const ownerRef=useRef(identity);ownerRef.current=identity;
  const [draftState,setDraftState]=useState(()=>({owner:identity,draft:initialOrderDetailSearch()}));
  const draft=draftState.owner===identity?draftState.draft:initialOrderDetailSearch();
  const [optionsState,setOptionsState]=useState<{owner:string;rows:OrderTimePayload["platforms"]}>({owner:identity,rows:[]});
  const options=optionsState.owner===identity?optionsState.rows:[];
  const [optionsLoading,setOptionsLoading]=useState(false),[optionsError,setOptionsError]=useState("");
  const [optionsRetry,setOptionsRetry]=useState(0);
  const [resultState,setResultState]=useState<SearchResult|null>(null);
  const result=resultState?.owner===identity?resultState:null;
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const serial=useRef(0),busyRef=useRef(false),flight=useRef<AbortController|null>(null);
  const groups=useMemo(()=>[...new Set(options.map(p=>p.country||p.team||"其他团队"))].map(team=>({team,items:options.filter(p=>(p.country||p.team||"其他团队")===team)})),[options]);
  const draftTimezone=options.find(p=>p.id===draft.platform)?.timezone||"Asia/Kolkata";
  const dirty=Boolean(result&&JSON.stringify(draft)!==JSON.stringify(result.applied.draft));

  function updateDraft(patch:Partial<OrderDetailSearchDraft>) {
    setDraftState(old=>({owner:identity,draft:{...(old.owner===identity?old.draft:initialOrderDetailSearch()),...patch}}));
  }
  function clearDeniedResults() {
    ++serial.current;flight.current?.abort();busyRef.current=false;setBusy(false);
    setResultState(null);setOptionsState({owner:identity,rows:[]});
    setDraftState({owner:identity,draft:initialOrderDetailSearch()});
  }
  useEffect(()=>{
    ++serial.current;flight.current?.abort();busyRef.current=false;
    setBusy(false);setError("");setResultState(null);setDraftState({owner:identity,draft:initialOrderDetailSearch()});
    return()=>{++serial.current;flight.current?.abort();busyRef.current=false;};
  },[identity]);
  useEffect(()=>{
    const controller=new AbortController();let disposed=false,timedOut=false;
    setOptionsState({owner:identity,rows:[]});setOptionsError("");setOptionsLoading(true);
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},30000);
    // Metadata only. No order query is issued until the user clicks Query.
    void orderTimeRpc(session,"dashboard_order_time_query",{},controller.signal).then(payload=>{
      if(!disposed&&!controller.signal.aborted&&ownerRef.current===identity){
        if(!Array.isArray(payload.platforms))throw new Error("平台资料返回不完整。");
        setOptionsState({owner:identity,rows:payload.platforms});
      }
    }).catch(err=>{if(!disposed&&ownerRef.current===identity){
      if(orderDetailAccessDenied(err))clearDeniedResults();
      setOptionsError(timedOut?"读取平台超时，请重试。":(err as Error).message);
    }})
      .finally(()=>{clearTimeout(timer);if(!disposed&&ownerRef.current===identity)setOptionsLoading(false);});
    return()=>{disposed=true;clearTimeout(timer);controller.abort();};
  // Refreshing a token must not reset the user's draft or rerun a query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[identity,optionsRetry]);

  async function loadPage(applied:AppliedSearch,page:number,cursors:Array<OrderDetailCursor|null>) {
    if(busyRef.current)return;
    let body:ReturnType<typeof orderDetailSearchRequest>;
    try {
      body=orderDetailSearchRequest(applied.draft,cursors[page]);
      if(!options.some(p=>p.id===applied.draft.platform))throw new Error("此平台不在当前可查询范围，请重新选择。");
    }catch(err){setError((err as Error).message);return;}
    busyRef.current=true;setBusy(true);setError("");
    const sequence=++serial.current,owner=identity,controller=new AbortController();flight.current?.abort();flight.current=controller;
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},45000);
    try {
      const value=await orderTimeRpc(session,"dashboard_order_detail_search",body,controller.signal);
      const data=validateOrderDetailPage(value);
      if(sequence!==serial.current||owner!==ownerRef.current||controller.signal.aborted)return;
      setResultState({owner,applied,page,cursors,data});
    }catch(err){
      if(sequence===serial.current&&owner===ownerRef.current){
        if(orderDetailAccessDenied(err)){clearDeniedResults();setOptionsError("平台访问权限已变化，请重新读取平台或重新登录。");}
        setError(timedOut?"查询超时，请缩短时间范围或填写会员／订单号后重试。":(err as Error).message);
      }
    }finally{
      clearTimeout(timer);if(sequence===serial.current){busyRef.current=false;setBusy(false);}
    }
  }
  function query(event:FormEvent) {
    event.preventDefault();
    const snapshot={...draft};
    const selected=options.find(p=>p.id===snapshot.platform);
    if(selected?.timezone)snapshot.timezone=selected.timezone;
    void loadPage({draft:snapshot,platformName:selected?.name||""},0,[null]);
  }
  function cancel() {
    ++serial.current;flight.current?.abort();busyRef.current=false;setBusy(false);
    setError("查询已取消；如有上次结果，仍按下方已应用条件展示。");
  }
  function reset() {
    if(busyRef.current)cancel();
    setDraftState({owner:identity,draft:initialOrderDetailSearch()});setResultState(null);setError("");
  }
  function selectPlatform(platform:string) {
    const timezone=options.find(p=>p.id===platform)?.timezone;
    const oldDay=sourceDay(draftTimezone,-1),newDay=sourceDay(timezone,-1);
    const pristine=draft.start===`${oldDay}T00:00:00`&&draft.end===`${oldDay}T23:59:59`;
    updateDraft({platform,provider:"",timezone,...(pristine?{start:`${newDay}T00:00:00`,end:`${newDay}T23:59:59`}:{})});
  }
  function shortcut(offset:number) {const day=sourceDay(draftTimezone,offset);updateDraft({start:`${day}T00:00:00`,end:`${day}T23:59:59`});}
  const applied=result?.applied.draft;
  const resultTimezone=result?.data.timezone||applied?.timezone||"Asia/Kolkata";
  return <section className="order-detail-search" aria-label="订单明细查询">
    <header className="ods-title"><div><h2>订单明细查询</h2><p>按平台直接查订单，每次最多读取 50 笔，不加载全平台汇总。</p></div><span>{draftTimezone}</span></header>
    <form className="ods-search-card" onSubmit={query}>
      <div className="ods-primary-fields">
        <label className="ods-field"><span>平台 <b>*</b></span><select required value={draft.platform} onChange={e=>selectPlatform(e.target.value)} disabled={optionsLoading}><option value="">{optionsLoading?"正在读取可用平台…":"请选择一个平台"}</option>{groups.map(g=><optgroup label={g.team} key={g.team}>{g.items.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</optgroup>)}</select></label>
        <label className="ods-field"><span>时间口径</span><select value={draft.basis} onChange={e=>updateDraft({basis:e.target.value as "created"|"success",status:"all",createdStart:"",createdEnd:""})}><option value="created">创建时间</option><option value="success">成功时间</option></select></label>
        <label className="ods-field"><span>开始时间 <b>*</b></span><input type="datetime-local" required step="1" value={draft.start} onChange={e=>updateDraft({start:e.target.value})}/></label>
        <label className="ods-field"><span>结束时间 <b>*</b></span><input type="datetime-local" required step="1" value={draft.end} onChange={e=>updateDraft({end:e.target.value})}/></label>
      </div>
      <div className="ods-time-note"><div className="ods-shortcuts"><button type="button" onClick={()=>shortcut(0)}>今天</button><button type="button" onClick={()=>shortcut(-1)}>昨日</button><button type="button" onClick={()=>shortcut(-2)}>前日</button></div><span>{draft.basis==="created"?"按创建时间找订单，可查询所有状态。":"按成功时间找订单，包含之前创建、本时段成功的订单。"} 单次最多 31 天。</span></div>
      <div className="ods-optional-fields">
        <label className="ods-field"><span>会员 ID</span><input type="text" autoComplete="off" maxLength={200} value={draft.memberId||""} onChange={e=>updateDraft({memberId:e.target.value})} placeholder="精确查询，保留前导 0"/></label>
        <label className="ods-field"><span>订单号 / 三方订单号</span><input type="text" autoComplete="off" maxLength={200} value={draft.orderNumber||""} onChange={e=>updateDraft({orderNumber:e.target.value})} placeholder="输入完整订单号"/></label>
        <label className="ods-field"><span>业务方向</span><select value={draft.direction} onChange={e=>updateDraft({direction:e.target.value as OrderDetailSearchDraft["direction"]})}><option value="all">代收和代付</option><option value="charge">代收</option><option value="withdraw">代付</option></select></label>
        <label className="ods-field"><span>最低订单金额</span><input type="text" inputMode="decimal" autoComplete="off" value={draft.amountMin} onChange={e=>updateDraft({amountMin:e.target.value})} placeholder="不限"/></label>
        <label className="ods-field"><span>最高订单金额</span><input type="text" inputMode="decimal" autoComplete="off" value={draft.amountMax} onChange={e=>updateDraft({amountMax:e.target.value})} placeholder="不限"/></label>
        <label className="ods-field"><span>订单状态</span><select value={draft.basis==="success"?"success":draft.status} disabled={draft.basis==="success"} onChange={e=>updateDraft({status:e.target.value as OrderDetailSearchDraft["status"]})}><option value="all">全部状态</option><option value="success">成功</option><option value="pending">处理中 / 已提交</option><option value="failed">失败</option><option value="rejected">已拒绝</option><option value="unknown">其他状态</option></select></label>
      </div>
      <details className="ods-advanced"><summary>高级筛选{draft.provider||draft.createdStart||draft.createdEnd?" · 已设置":""}</summary><div className="ods-advanced-fields">
        <label className="ods-field"><span>三方通道</span><input type="text" maxLength={200} value={draft.provider} onChange={e=>updateDraft({provider:e.target.value})} placeholder="源后台完整通道名称（精确匹配）"/></label>
        {draft.basis==="success"&&<><label className="ods-field"><span>创建开始时间（可选）</span><input type="datetime-local" step="1" value={draft.createdStart} onChange={e=>updateDraft({createdStart:e.target.value})}/></label><label className="ods-field"><span>创建结束时间（可选）</span><input type="datetime-local" step="1" value={draft.createdEnd} onChange={e=>updateDraft({createdEnd:e.target.value})}/></label></>}
      </div>{draft.basis==="success"&&<small>不填写创建范围时，包含更早月份创建、本时段成功的订单。</small>}</details>
      <div className="ods-action-row"><label className="ods-checkbox"><input type="checkbox" checked={!!draft.crossDayOnly} onChange={e=>updateDraft({crossDayOnly:e.target.checked})}/>只看跨日成功订单</label><div><button className="ods-secondary" type="button" onClick={reset}>重置</button>{busy&&<button className="ods-secondary" type="button" onClick={cancel}>取消查询</button>}<button className="ods-primary" type="submit" disabled={busy||optionsLoading}>{busy?"查询中…":"查询订单"}</button></div></div>
      <p className="ods-footnote">金额为源订单金额，筛选包含上下限；不是实际到账金额或手续费。结束时间包含所选秒。未接入订单明细的平台暂不可查。</p>
      {optionsError&&<p className="ods-error" role="alert">{optionsError} <button type="button" onClick={()=>setOptionsRetry(n=>n+1)}>重新读取平台</button></p>}
      {!optionsLoading&&!optionsError&&!options.length&&<p className="ods-footnote">当前账号没有已接入的可查询平台。</p>}
    </form>
    {error&&<p className="ods-error" role="alert">{error}{result&&" 下方仍为上次成功查询结果。"}</p>}
    {!result?<div className="ods-empty" role="status"><strong>{busy?"正在读取订单明细…":"先选择平台，再点击“查询订单”"}</strong><span>仅查询已同步到数据库的明细；不会自动读取全部订单。</span></div>:<section className="ods-results" aria-label="订单查询结果">
      <div className="ods-result-heading"><div><h3>{result.applied.platformName} · 订单记录</h3><p>{applied!.basis==="created"?"创建时间":"成功时间"}：{applied!.start.replace("T"," ")} 至 {applied!.end.replace("T"," ")} · {resultTimezone}</p></div><span>本页 {result.data.rows.length} 笔 · 每页最多 50 笔</span></div>
      <div className="ods-applied-tags"><span>{applied!.direction==="charge"?"代收":applied!.direction==="withdraw"?"代付":"代收和代付"}</span><span>状态：{applied!.basis==="success"?"成功":({all:"全部状态",success:"成功",pending:"处理中 / 已提交",failed:"失败",rejected:"已拒绝",unknown:"其他状态"} as const)[applied!.status||"all"]}</span>{applied!.memberId&&<span>会员 {applied!.memberId}</span>}{applied!.orderNumber&&<span>订单 {applied!.orderNumber}</span>}{(applied!.amountMin||applied!.amountMax)&&<span>订单金额 {applied!.amountMin||"不限"} — {applied!.amountMax||"不限"}（含）</span>}{applied!.provider&&<span>通道 {applied!.provider}</span>}{applied!.crossDayOnly&&<span>仅跨日成功</span>}{(applied!.createdStart||applied!.createdEnd)&&<span>创建限制 {applied!.createdStart.replace("T"," ")||"不限"} — {applied!.createdEnd.replace("T"," ")||"不限"}</span>}</div>
      {dirty&&<p className="ods-draft-note">筛选已修改，点击“查询订单”后生效；翻页仍使用上方已应用条件。</p>}
      <div className="ods-pagination"><span>第 {result.page+1} 页{busy?" · 正在读取…":""}</span><button className="ods-secondary" type="button" disabled={busy||result.page===0} onClick={()=>void loadPage(result.applied,result.page-1,result.cursors)}>上一页</button><button className="ods-secondary" type="button" disabled={busy||!result.data.hasMore} onClick={()=>void loadPage(result.applied,result.page+1,[...result.cursors.slice(0,result.page+1),result.data.nextCursor])}>下一页</button></div>
      <div className="ods-table-wrap"><table><thead><tr><th>会员 ID</th><th>订单号</th><th>三方订单号</th><th>业务</th><th>三方通道</th><th>状态</th><th className="ods-number">订单金额</th><th className="ods-number">实际到账</th><th className="ods-number">提现手续费</th><th>创建时间</th><th>成功时间</th><th>最近同步</th></tr></thead><tbody>{result.data.rows.map(row=><tr key={`${row.direction}:${row.id}`}><td className="ods-identifier">{row.member_id||"—"}</td><td className="ods-identifier">{row.order_number||"—"}</td><td className="ods-identifier">{row.third_party_order_number||"—"}</td><td>{row.direction==="charge"?"代收":"代付"}</td><td>{row.provider}<small>{row.channel_type}</small></td><td><span className={`ods-status ods-status-${["success","pending","failed","rejected"].includes(row.status_group)?row.status_group:"unknown"}`}>{orderDetailStatusLabel(row.status,row.status_group)}</span>{row.cross_day&&<small className="ods-cross-day">跨日成功</small>}</td><td className="ods-number">{formatOrderDetailAmount(row.amount)}{row.currency&&<small>{row.currency}</small>}</td><td className="ods-number">{formatOrderDetailAmount(row.actual_amount)}</td><td className="ods-number">{formatOrderDetailAmount(row.withdraw_fee)}</td><td>{sourceTime(row.created_at,resultTimezone)}</td><td>{sourceTime(row.success_at,resultTimezone)}</td><td>{sourceTime(row.synced_at,resultTimezone)}</td></tr>)}{!result.data.rows.length&&<tr><td colSpan={12} className="ods-no-rows">当前条件没有已入库订单。历史缺失的明细需要采集脚本补录后才可搜索。</td></tr>}</tbody></table></div>
      <p className="ods-footnote ods-results-note">只显示已同步记录；分页不代表完整采集，也不计算全量订单数。正在补录时，新写入订单可能需要重新查询。</p>
    </section>}
  </section>;
}
