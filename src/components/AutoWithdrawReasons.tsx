"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { canReadWithdrawReasons, getAutoWithdrawReasons, isReasonDate, reasonPercent, type ReasonOperator, type WithdrawReasonsDay } from "@/lib/autoWithdrawReasonsClient";
import { useDashboardAuth } from "./DashboardAuthGate";

type Platform = { country: string; platform: string };
type Target = Platform & { date: string };
const ReasonsContext = createContext<{ open: (platform: Platform) => void; expandedKey: string; panel: ReactNode } | null>(null);
const fmt = (n: number) => n.toLocaleString("zh-CN");
const operatorNames: Record<ReasonOperator, string> = { manual: "人工处理", auto: "自动出款", unknown: "操作方式待确认" };
const classificationNames = { template: "自动归类", empty: "无备注", unclassified: "原文归组", truncated: "待补全文" };
const keyOf = (p: Platform) => JSON.stringify([p.country, p.platform]);

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
  const [result, setResult] = useState<{ key: string; day: WithdrawReasonsDay | null } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [operator, setOperator] = useState<ReasonOperator>("manual");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const modalRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestVersion = useRef(0);
  const platforms = useMemo(() => Array.from(new Map(availableRows.map(row => [keyOf(row), { country: row.country, platform: row.platform }])).values())
    .sort((a, b) => `${a.country}/${a.platform}`.localeCompare(`${b.country}/${b.platform}`)), [availableRows]);
  const targetKey = target ? JSON.stringify(target) : "";
  const visibleResult = result?.key === targetKey ? result : null;
  const day = visibleResult?.day;
  const openModal = Boolean(target && !inline);
  const opened = Boolean(target);

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
    if (!target) return;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setResult(null); setError("");
    if (!allowed || !session) { setLoading(false); setError("请使用有自动出款查看权限的账号登录。"); return; }
    if (!isReasonDate(target.date) || target.date < startDate || target.date > endDate) {
      setLoading(false); setError("请选择当前查询区间内的有效日期。"); return;
    }
    setLoading(true);
    void getAutoWithdrawReasons(session, target, controller.signal)
      .then(day => { if (version === requestVersion.current) setResult({ key: targetKey, day }); })
      .catch((cause: unknown) => {
        if (version === requestVersion.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "原因统计读取失败。");
      })
      .finally(() => { if (version === requestVersion.current) setLoading(false); });
    return () => { controller.abort(); requestVersion.current += 1; };
  }, [target, targetKey, session, allowed, reload, startDate, endDate]);

  useEffect(() => {
    if (!opened) return;
    const refresh = () => { if (document.visibilityState === "visible") setReload(n => n + 1); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const previous = document.body.style.overflow;
    if (openModal) {
      document.body.style.overflow = "hidden";
      modalRef.current?.querySelector<HTMLElement>("button")?.focus();
    }
    return () => {
      window.clearInterval(timer); window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh); document.body.style.overflow = previous;
    };
  }, [opened, openModal]);

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
        <header className="wr-header"><div><h2 id="wr-title">自动出款 · 原因统计</h2><p>{target.country} / {target.platform} · {target.date}</p></div>
          <button type="button" className="detail-view-btn" onClick={close} aria-label="关闭原因统计">关闭</button></header>
        <div className="wr-body">
          <div className="wr-filters">
            <label>统计日期<input type="date" value={target.date} min={startDate} max={endDate} onChange={e => setTarget({ ...target, date: e.target.value })} /></label>
            {!inline && <label>国家 / 平台<select value={keyOf(target)} onChange={e => { const p = platforms.find(p => keyOf(p) === e.target.value); if (p) setTarget({ ...p, date: target.date }); }}>
              {platforms.map(p => <option key={keyOf(p)} value={keyOf(p)}>{p.country} / {p.platform}</option>)}
            </select></label>}
            <button type="button" className="detail-view-btn" disabled={loading} onClick={() => setReload(n => n + 1)}>{loading ? "读取中…" : "刷新原因"}</button>
            <span>直接读取 Supabase · 打开时每分钟刷新</span>
          </div>
          {loading && <div className="wr-state" role="status">正在读取当天的原因统计…</div>}
          {error && <div className="wr-alert" role="alert">{error}</div>}
          {!loading && !error && visibleResult && !day && <div className="wr-state"><strong>该平台当天尚未同步原因数据</strong>
            <p>这不代表 0 笔，也不影响原自动出款日表。请运行带原因采集的脚本补齐该日期，再点“刷新原因”。</p></div>}
          {!loading && !error && day && totals && <>
            <div className="wr-stats">
              {[
                ["已采集提款", totals.total, "当天去重订单"],
                ["自动出款", totals.auto, reasonPercent(totals.auto, totals.total)],
                ["人工处理", totals.manual, reasonPercent(totals.manual, totals.total)],
                ["成功", totals.success, reasonPercent(totals.success, totals.total)],
                ["驳回", totals.reject, reasonPercent(totals.reject, totals.total)],
              ].map(([label, count, sub]) => <div key={label}><span>{label}</span><strong>{fmt(Number(count))}</strong><small>{sub}</small></div>)}
            </div>
            <p className="wr-meta">操作方式待确认 {fmt(totals.unknown)} 笔（{reasonPercent(totals.unknown, totals.total)}） · 其他状态 {fmt(totals.other)} 笔（{reasonPercent(totals.other, totals.total)}）。上述占比均以已采集提款总笔数为分母。<br />沿用原统计口径：“已提交”也计入成功；自动 / 人工是操作方式笔数，并非各自成功笔数。</p>
            {differs && <div className="wr-alert">原因采集 {fmt(totals.total)} 笔，当前日表 {fmt(reportTotal)} 笔，两次数据尚未对齐。以下占比仅按原因采集数据计算，不修改原日表。</div>}
            {day.snapshot.coverage.incomplete_note_count > 0 && <div className="wr-alert">有 {fmt(day.snapshot.coverage.incomplete_note_count)} 笔备注待补全文，已计入“待补全文”项。订单笔数已采集完整，不代表备注全文完整；请用修正版脚本重新采集当天。</div>}
            {day.snapshot.classifier_version === "note-template-v1" && <p className="wr-meta">当前数据来自旧版采集器；已读完整的备注自动归类，缺失的全文仍需修正版采集器补充。</p>}
            <p className="wr-grouping-info">系统已自动合并同原因的实际数值与日期差异，配置门槛不同的规则仍分开。点“合并明细”可核对原备注及各自笔数。</p>
            <div className="wr-reason-controls">
              <div className="wr-tabs" role="group" aria-label="操作方式">
                {(["manual", "auto", "unknown"] as const).map(type => <button type="button" key={type} aria-pressed={operator === type}
                  className={operator === type ? "active" : ""} onClick={() => setOperator(type)}>{operatorNames[type]} {fmt(totals[type])}</button>)}
              </div>
              <input aria-label="搜索原因或备注样本" placeholder="搜索原因 / 备注样本" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <p className="wr-meta">原因占比 = 该原因笔数 ÷ {operatorNames[operator]} {fmt(denominator)} 笔。空备注、待补全文均保留在分母内；每笔订单归入一个备注组，不把多条拦截信息重复计数。</p>
            <div className="wr-table-wrap"><table className="wr-table"><thead><tr>
              <th>备注原因</th><th>笔数</th><th>占{operatorNames[operator]}</th><th>成功</th><th>驳回</th><th>其他</th><th>原备注 / 样本</th>
            </tr></thead><tbody>{groups.slice((actualPage - 1) * 20, actualPage * 20).map(g => <tr key={`${operator}:${g.reason_key}`}>
              <td><span className={`wr-badge wr-${g.classification}`}>{classificationNames[g.classification]}</span><div className="wr-reason-text">{g.reason_label}</div></td>
              <td>{fmt(g.count)}</td><td><strong>{reasonPercent(g.count, denominator)}</strong></td><td>{fmt(g.success)}</td><td>{fmt(g.reject)}</td><td>{fmt(g.other)}</td>
              <td>{g.variants && g.variants.length > 1 && <details className="wr-variants"><summary>合并明细 · {g.variants.length} 组</summary><ul>{g.variants.map(v => <li key={v.reason_label}><strong>{fmt(v.count)} 笔</strong> · {v.reason_label}</li>)}</ul></details>}
                {g.samples.length > 0 ? <details><summary>查看样本</summary><ul>{g.samples.map((sample, i) => <li key={i}>{sample}</li>)}</ul><small>脱敏样本，仅作解释，不是全部订单明细。</small></details> : !(g.variants && g.variants.length > 1) && <span>—</span>}</td>
            </tr>)}</tbody></table>
            {!groups.length && <div className="wr-state">{search ? "没有匹配的原因；搜索不会改变占比分母。" : `当天没有${operatorNames[operator]}记录。`}</div>}</div>
            <div className="wr-footer"><span>共 {groups.length} 类 · 系统归类 {day.grouping_version || "—"} · 采集 {day.snapshot.classifier_version}</span><div>
              <button type="button" disabled={actualPage <= 1} onClick={() => setPage(actualPage - 1)}>上一页</button><span>{actualPage} / {pages}</span>
              <button type="button" disabled={actualPage >= pages} onClick={() => setPage(actualPage + 1)}>下一页</button></div></div>
            <p className="wr-meta">采集时间 {new Date(day.snapshot.snapshot_at).toLocaleString("zh-CN")} · 入库时间 {new Date(day.updated_at).toLocaleString("zh-CN")}（时间按当前浏览器时区显示）<br />统计日按源平台时区 {day.snapshot.timezone}；来源 AR 后台人工备注，不能仅凭备注断定最终转人工的全部原因。</p>
          </>}
        </div>
      </div>;

  return <ReasonsContext.Provider value={allowed ? { open: p => open(p), expandedKey: inline && target ? keyOf(target) : "", panel } : null}>
    <div className="wr-toolbar">
      <div><strong>自动采集原因</strong><span>点击平台“展开原因”查看分类、笔数和占比，再展开核对原备注。</span></div>
      <button type="button" className="detail-view-btn wr-open" disabled={!allowed || !platforms.length}
        onClick={() => platforms[0] && open(platforms[0], false)}>查询原因统计</button>
    </div>
    {children}
    {target && !inline && <div className="wr-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}>{panel}</div>}
  </ReasonsContext.Provider>;
}
