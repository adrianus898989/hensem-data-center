"use client";

import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { canReadWithdrawReasons, getAutoWithdrawReasons, isReasonDate, reasonPercent, type ReasonOperator, type WithdrawReasonGroup, type WithdrawReasonsDay } from "@/lib/autoWithdrawReasonsClient";
import { useDashboardAuth } from "./DashboardAuthGate";

type Platform = { country: string; platform: string };
type Target = Platform & { date: string };
const ReasonsContext = createContext<{ open: (platform: Platform) => void; expandedKey: string; panel: ReactNode } | null>(null);
const fmt = (n: number) => n.toLocaleString("zh-CN");
const operatorNames: Record<ReasonOperator, string> = { manual: "人工处理", auto: "自动出款", unknown: "方式未识别" };
const keyOf = (p: Platform) => JSON.stringify([p.country, p.platform]);

function ReasonRow({ group: g, denominator, showOther }: { group: WithdrawReasonGroup; denominator: number; showOther: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const variants = g.variants || [{ reason_label: g.reason_label, count: g.count }];
  return <Fragment><tr>
    <td><div className="wr-reason-text">{g.reason_label}
      {variants.length > 1 && <span className="wr-merged-count">合并 {variants.length} 项</span>}
      {g.classification === "truncated" && <span className="wr-badge wr-truncated">待补全文</span>}</div></td>
    <td className="wr-count">{fmt(g.count)}</td><td><strong>{reasonPercent(g.count, denominator)}</strong></td>
    <td><span className="wr-success">{fmt(g.success)}</span><span className="wr-divider"> / </span><span className="wr-rejected">{fmt(g.reject)}</span></td>
    {showOther && <td>{fmt(g.other)}</td>}
    <td><button className="wr-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? "收起明细" : "展开明细"}</button></td>
  </tr>{expanded && <tr className="wr-variant-row"><td colSpan={showOther ? 6 : 5}>
    <div className="wr-variant-heading"><strong>原备注</strong><span>笔数</span></div>
    {variants.map(v => <div className="wr-variant-item" key={v.reason_label}><span>{v.reason_label}</span><strong>{fmt(v.count)}</strong></div>)}
    {g.samples.length > 0 && <details className="wr-samples"><summary>备注样本</summary><ul>{g.samples.map((sample, i) => <li key={i}>{sample}</li>)}</ul><small>脱敏示例，非全部订单明细。</small></details>}
  </td></tr>}</Fragment>;
}

export function AutoWithdrawReasonsButton({ country, platform }: Platform) {
  const context = useContext(ReasonsContext);
  const expanded = context?.expandedKey === keyOf({ country, platform });
  return context ? <button type="button" className="detail-view-btn wr-open" aria-expanded={expanded}
    onClick={() => context.open({ country, platform })}>{expanded ? "收起原因" : "展开原因"}</button> : null;
}

export function AutoWithdrawReasonsInlineRow({ country, platform }: Platform) {
  const context = useContext(ReasonsContext);
  return context?.expandedKey === keyOf({ country, platform })
    ? <tr className="wr-expanded-row"><td colSpan={16}>{context.panel}</td></tr> : null;
}

export function AutoWithdrawReasonsProvider({ startDate, endDate, availableRows, children }: {
  startDate: string; endDate: string;
  availableRows: Array<Platform & { date: string; total: number; manualCount: number }>;
  children: ReactNode;
}) {
  const { session, profile } = useDashboardAuth();
  const allowed = Boolean(session && canReadWithdrawReasons(profile));
  const [target, setTarget] = useState<Target | null>(null);
  const [inline, setInline] = useState(false);
  const [result, setResult] = useState<{ key: string; viewerKey: string; day: WithdrawReasonsDay | null } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [operator, setOperator] = useState<ReasonOperator>("manual");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const modalRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestVersion = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const viewerKey = session?.user?.id || profile?.auth_user_id || "";
  const platforms = useMemo(() => Array.from(new Map(availableRows.map(row => [keyOf(row), { country: row.country, platform: row.platform }])).values())
    .sort((a, b) => `${a.country}/${a.platform}`.localeCompare(`${b.country}/${b.platform}`)), [availableRows]);
  const targetKey = target ? JSON.stringify(target) : "";
  const visibleResult = allowed && result?.key === targetKey && result.viewerKey === viewerKey ? result : null;
  const day = visibleResult?.day;
  const openModal = Boolean(target && !inline);

  function open(platform: Platform, inRow = true) {
    if (inRow && inline && target && keyOf(target) === keyOf(platform)) { close(); return; }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInline(inRow);
    setTarget({ ...platform, date: endDate });
    setOperator("manual"); setSearch(""); setPage(1); setError("");
  }
  function close() { setTarget(null); openerRef.current?.focus(); }

  useEffect(() => { setTarget(null); }, [startDate, endDate]);
  useEffect(() => { setPage(1); setSearch(""); }, [targetKey, operator]);
  useEffect(() => {
    if (!targetKey) return;
    const queryTarget = JSON.parse(targetKey) as Target;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setError("");
    const currentSession = sessionRef.current;
    if (!allowed || !currentSession) { setResult(null); setLoading(false); setError("请使用有自动出款查看权限的账号登录。"); return; }
    if (!isReasonDate(queryTarget.date) || queryTarget.date < startDate || queryTarget.date > endDate) {
      setLoading(false); setError("请选择当前查询区间内的有效日期。"); return;
    }
    setLoading(true);
    void getAutoWithdrawReasons(currentSession, queryTarget, controller.signal)
      .then(day => { if (version === requestVersion.current) setResult({ key: targetKey, viewerKey, day }); })
      .catch((cause: unknown) => {
        if (version === requestVersion.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "原因统计读取失败。");
      })
      .finally(() => { if (version === requestVersion.current) setLoading(false); });
    return () => { controller.abort(); requestVersion.current += 1; };
  }, [targetKey, viewerKey, allowed, reload, startDate, endDate]);

  useEffect(() => {
    if (!openModal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { document.body.style.overflow = previous; };
  }, [openModal]);

  const totals = day?.snapshot.totals;
  const denominator = totals?.[operator] || 0;
  const groups = (day?.snapshot.groups || []).filter(g => g.operator_class === operator)
    .filter(g => !search.trim() || `${g.reason_label} ${(g.variants || []).map(v => v.reason_label).join(" ")} ${g.samples.join(" ")}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => b.count - a.count || a.reason_key.localeCompare(b.reason_key));
  const pages = Math.max(1, Math.ceil(groups.length / 20));
  const actualPage = Math.min(page, pages);
  const reportRows = target ? availableRows.filter(row => row.date === target.date && row.country === target.country && row.platform === target.platform) : [];
  const reportTotal = reportRows.reduce((sum, row) => sum + row.total, 0);
  const differs = Boolean(totals && reportRows.length && reportTotal !== totals.total);
  const showOther = Boolean(totals?.other);

  const panel = target && <div className={inline ? "wr-inline-panel" : "wr-modal"} role={inline ? "region" : "dialog"}
        aria-modal={inline ? undefined : true} aria-labelledby="wr-title" ref={modalRef}
        onKeyDown={e => {
          if (e.key === "Escape") { e.stopPropagation(); close(); }
          if (inline || e.key !== "Tab") return;
          const nodes = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, summary, a[href], [tabindex='0']") || []);
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}>
        <header className="wr-header"><div><h2 id="wr-title">{target.platform} · 原因明细</h2><span className="wr-country">{target.country}</span></div>
          <button type="button" className="detail-view-btn" onClick={close} aria-label="关闭原因统计">关闭</button></header>
        <div className="wr-body">
          <div className="wr-filters">
            <label>统计日期<input type="date" value={target.date} min={startDate} max={endDate} onChange={e => setTarget({ ...target, date: e.target.value })} /></label>
            {!inline && <label>国家 / 平台<select value={keyOf(target)} onChange={e => { const p = platforms.find(p => keyOf(p) === e.target.value); if (p) setTarget({ ...p, date: target.date }); }}>
              {platforms.map(p => <option key={keyOf(p)} value={keyOf(p)}>{p.country} / {p.platform}</option>)}
            </select></label>}
            <button type="button" className="wr-refresh" disabled={loading} onClick={() => setReload(n => n + 1)}>{loading ? "读取中…" : "刷新"}</button>
          </div>
          {loading && !day && <div className="wr-state" role="status">正在读取…</div>}
          {error && <div className="wr-alert" role="alert">{error}</div>}
          {!loading && !error && visibleResult && !day && <div className="wr-state"><strong>该平台当天尚未同步原因数据</strong>
            <p>补采该日期后点击刷新。</p></div>}
          {!error && day && totals && <>
            <div className="wr-stats">
              {[
                ["总笔数", totals.total, ""],
                ["自动出款", totals.auto, reasonPercent(totals.auto, totals.total)],
                ["人工处理", totals.manual, reasonPercent(totals.manual, totals.total)],
                ["成功", totals.success, reasonPercent(totals.success, totals.total)],
                ["驳回", totals.reject, reasonPercent(totals.reject, totals.total)],
              ].map(([label, count, sub]) => <div key={label}><span>{label}</span><strong>{fmt(Number(count))}</strong>{sub && <small>{sub}</small>}</div>)}
            </div>
            {differs && <div className="wr-alert">采集 {fmt(totals.total)} 笔 / 日表 {fmt(reportTotal)} 笔，尚未对齐；占比按采集数据计算。</div>}
            {day.snapshot.coverage.incomplete_note_count > 0 && <div className="wr-alert">{fmt(day.snapshot.coverage.incomplete_note_count)} 笔备注待补全文，请重新采集当天。</div>}
            <div className="wr-reason-controls">
              <div className="wr-tabs" role="group" aria-label="操作方式">
                {(["manual", "auto", "unknown"] as const).map(type => <button type="button" key={type} aria-pressed={operator === type}
                  title={type === "unknown" ? "原因已归类；原记录未识别自动或人工，不并入人工笔数。" : undefined}
                  className={operator === type ? "active" : ""} onClick={() => setOperator(type)}>{operatorNames[type]} {fmt(totals[type])}</button>)}
              </div>
              <input aria-label="搜索原因或备注样本" placeholder="搜索原因" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div className="wr-table-wrap"><table className="wr-table"><colgroup><col className="wr-col-reason" /><col className="wr-col-count" /><col className="wr-col-percent" /><col className="wr-col-status" />{showOther && <col className="wr-col-other" />}<col className="wr-col-detail" /></colgroup><thead><tr>
              <th>原因</th><th>笔数</th><th title={`该原因笔数 ÷ ${operatorNames[operator]} ${fmt(denominator)} 笔`}>占{operatorNames[operator]}</th><th title="沿用日表口径，已提交计入成功">成功 / 驳回</th>{showOther && <th>其他</th>}<th>明细</th>
            </tr></thead><tbody>{groups.slice((actualPage - 1) * 20, actualPage * 20).map(g => <ReasonRow key={`${operator}:${g.reason_key}`} group={g} denominator={denominator} showOther={showOther} />)}</tbody></table>
            {!groups.length && <div className="wr-state">{search ? "没有匹配的原因" : `当天没有${operatorNames[operator]}记录`}</div>}</div>
            <div className="wr-footer"><span>{groups.length} 类 · {fmt(denominator)} 笔</span>{pages > 1 && <div>
              <button type="button" disabled={actualPage <= 1} onClick={() => setPage(actualPage - 1)}>上一页</button><span>{actualPage} / {pages}</span>
              <button type="button" disabled={actualPage >= pages} onClick={() => setPage(actualPage + 1)}>下一页</button></div>}</div>
          </>}
        </div>
      </div>;

  return <ReasonsContext.Provider value={allowed ? { open: p => open(p), expandedKey: inline && target ? keyOf(target) : "", panel } : null}>
    <div className="wr-toolbar">
      <div><strong>原因统计</strong></div>
      <button type="button" className="detail-view-btn wr-open" disabled={!allowed || !platforms.length}
        onClick={() => platforms[0] && open(platforms[0], false)}>查询原因统计</button>
    </div>
    {children}
    {target && !inline && <div className="wr-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}>{panel}</div>}
  </ReasonsContext.Provider>;
}
