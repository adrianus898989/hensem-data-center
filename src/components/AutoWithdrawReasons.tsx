"use client";

import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { canReadWithdrawReasons, getAutoWithdrawReasons, isReasonDate, reasonPercent, reasonNoteSnapshot, type ReasonNoteKind, type ReasonOperator, type WithdrawReasonGroup, type WithdrawReasonsDay } from "@/lib/autoWithdrawReasonsClient";
import { useDashboardAuth } from "./DashboardAuthGate";

type Platform = { country: string; platform: string };
type Target = Platform & { date: string };
const ReasonsContext = createContext<{
  open: (platform: Platform) => void; expandedKey: string; panel: ReactNode;
  query: () => void; canQuery: boolean;
} | null>(null);
const fmt = (n: number) => n.toLocaleString("zh-CN");
const operatorNames: Record<ReasonOperator, string> = { manual: "人工处理", auto: "自动出款", unknown: "方式未识别" };
const keyOf = (p: Platform) => JSON.stringify([p.country, p.platform]);

function ReasonPagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="wr-pagination" aria-label="原因分类分页">
    <span>{(page - 1) * 20 + 1}–{Math.min(page * 20, total)} / 共 {total} 类</span>
    <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一页原因">上一页</button>
    <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="下一页原因">下一页</button>
  </nav>;
}

function ReasonRow({ group: g, denominator, operator, showOther, member = false }: { group: WithdrawReasonGroup; denominator: number; operator: ReasonOperator; showOther: boolean; member?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const variants = g.variants || [{ reason_label: g.reason_label, count: g.count }];
  return <Fragment><tr>
    <td><div className="wr-reason-text">{g.reason_label}
      {variants.length > 1 && <span className="wr-merged-count">合并 {variants.length} 项</span>}
      {g.classification === "truncated" && <span className="wr-badge wr-truncated">待补全文</span>}</div></td>
    <td className="wr-count">{fmt(g.count)}</td>
    <td className="wr-reason-share" title={`${fmt(g.count)} ÷ ${operatorNames[operator]}有${member ? "ID备注" : "原因"}订单 ${fmt(denominator)} 笔`}><strong>{reasonPercent(g.count, denominator)}</strong></td>
    <td><span className="wr-success">{fmt(g.success)}</span><span className="wr-divider"> / </span><span className="wr-rejected">{fmt(g.reject)}</span></td>
    {showOther && <td>{fmt(g.other)}</td>}
    <td><button className="wr-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? "收起明细" : "展开明细"}</button></td>
  </tr>{expanded && <tr className="wr-variant-row"><td colSpan={showOther ? 6 : 5}>
    <div className="wr-variant-heading"><strong>原备注</strong><span>笔数</span><span title={`原备注笔数 ÷ 该原因 ${fmt(g.count)} 笔`}>占该原因</span><span title={`原备注笔数 ÷ ${operatorNames[operator]}有原因订单 ${fmt(denominator)} 笔`}>占当前原因总笔数</span></div>
    {variants.map(v => <div className="wr-variant-item" key={v.reason_label}><span>{v.reason_label}</span><strong>{fmt(v.count)}</strong>
      <strong className="wr-variant-share" title={`${fmt(v.count)} ÷ 该原因 ${fmt(g.count)} 笔`}>{reasonPercent(v.count, g.count)}</strong>
      <span className="wr-variant-operator-share" title={`${fmt(v.count)} ÷ ${operatorNames[operator]}有原因订单 ${fmt(denominator)} 笔`}>{reasonPercent(v.count, denominator)}</span></div>)}
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

export function AutoWithdrawReasonsQueryButton() {
  const context = useContext(ReasonsContext);
  return <button type="button" className="detail-view-btn wr-open" disabled={!context?.canQuery}
    onClick={() => context?.query()}>查询原因</button>;
}

export function AutoWithdrawReasonsProvider({ startDate, endDate, availableRows, children, showToolbar = true }: {
  startDate: string; endDate: string;
  availableRows: Array<Platform & { date: string; total: number; manualCount: number }>;
  children: ReactNode;
  showToolbar?: boolean;
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
  const [noteKind, setNoteKind] = useState<ReasonNoteKind>("reasons");
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
  const memberView = day?.source_system === "NEWAR" && noteKind === "member";
  const selectedSnapshot = reasonNoteSnapshot(day, memberView ? "member" : "reasons");
  const abnormalOnly = day?.source_system === "PANDA" || day?.source_system === "BAIFU";
  const statusBasis = day?.source_system === "PANDA"
    ? "沿用原已审核日表口径：已完成计成功，其余计驳回；不代表实时待处理订单状态"
    : day?.source_system === "BAIFU"
      ? "按创建日期归属；沿用百富日表成功/驳回状态，待处理等状态归其他"
      : "沿用日表状态口径（含已提交）";
  const openModal = Boolean(target && !inline);

  function open(platform: Platform, inRow = true) {
    if (inRow && inline && target && keyOf(target) === keyOf(platform)) { close(); return; }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInline(inRow);
    setTarget({ ...platform, date: endDate });
    setOperator("manual"); setNoteKind("reasons"); setSearch(""); setPage(1); setError("");
  }
  function close() { setTarget(null); openerRef.current?.focus(); }

  useEffect(() => { setTarget(null); }, [startDate, endDate]);
  useEffect(() => { setPage(1); setSearch(""); }, [targetKey, operator, noteKind]);
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
    // Keep an already loaded view stable; only recover a failed read after renewal.
    if (error) setReload(value => value + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  useEffect(() => {
    if (!openModal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLElement>(".wr-close")?.focus();
    return () => { document.body.style.overflow = previous; };
  }, [openModal]);

  // Reason percentages exclude missing remarks, not real but unclassified or
  // truncated notes. Source snapshots and the main daily report stay intact.
  const reasonedGroups = (selectedSnapshot?.groups || []).filter(g => g.classification !== "empty");
  const totals = selectedSnapshot ? reasonedGroups.reduce((sum, g) => {
    sum.total += g.count; sum[g.operator_class] += g.count;
    sum.success += g.success; sum.reject += g.reject; sum.other += g.other;
    return sum;
  }, { total: 0, manual: 0, auto: 0, unknown: 0, success: 0, reject: 0, other: 0 }) : undefined;
  const omittedCount = selectedSnapshot && totals ? selectedSnapshot.totals.total - totals.total : 0;
  const denominator = totals?.[operator] || 0;
  const groups = reasonedGroups.filter(g => g.operator_class === operator)
    .filter(g => !search.trim() || `${g.reason_label} ${(g.variants || []).map(v => v.reason_label).join(" ")} ${g.samples.join(" ")}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => b.count - a.count || a.reason_key.localeCompare(b.reason_key));
  const pages = Math.max(1, Math.ceil(groups.length / 20));
  const actualPage = Math.min(page, pages);
  const matchedCount = groups.reduce((sum, group) => sum + group.count, 0);
  const reportRows = target ? availableRows.filter(row => row.date === target.date && row.country === target.country && row.platform === target.platform) : [];
  const reportTotal = reportRows.reduce((sum, row) => sum + row.total, 0);
  const differs = Boolean(selectedSnapshot && reportRows.length && reportTotal !== selectedSnapshot.totals.total);
  const showOther = Boolean(totals?.other);

  const panel = target && <div className={inline ? "wr-inline-panel wr-review" : "wr-modal wr-review"} role={inline ? "region" : "dialog"}
        aria-modal={inline ? undefined : true} aria-labelledby="wr-title" ref={modalRef}
        onKeyDown={e => {
          if (e.key === "Escape") { e.stopPropagation(); close(); }
          if (inline || e.key !== "Tab") return;
          const nodes = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, summary, a[href], [tabindex='0']") || []);
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}>
        <header className="wr-header"><div className="wr-identity"><h2 id="wr-title">{target.platform} · 原因明细</h2><span className="wr-country">{target.country}</span></div>
          <div className="wr-filters">
            <label><span className="wr-field-label">统计日期</span><input type="date" value={target.date} min={startDate} max={endDate} onChange={e => setTarget({ ...target, date: e.target.value })} /></label>
            {!inline && <label><span className="wr-field-label">国家 / 平台</span><select value={keyOf(target)} onChange={e => { const p = platforms.find(p => keyOf(p) === e.target.value); if (p) setTarget({ ...p, date: target.date }); }}>
              {platforms.map(p => <option key={keyOf(p)} value={keyOf(p)}>{p.country} / {p.platform}</option>)}
            </select></label>}
            <button type="button" className="wr-refresh" disabled={loading} onClick={() => setReload(n => n + 1)}>{loading ? "读取中…" : "刷新"}</button>
          </div>
          <button type="button" className="wr-close" onClick={close} aria-label="关闭原因统计">{inline ? "收起" : "关闭"}<span aria-hidden="true">×</span></button>
        </header>
        <div className="wr-body">
          {loading && !day && <div className="wr-state" role="status">正在读取…</div>}
          {error && <div className="wr-alert" role="alert">{error}</div>}
          {!loading && !error && visibleResult && !day && <div className="wr-state"><strong>该平台当天尚未同步原因数据</strong>
            <p>补采该日期后点击刷新。</p></div>}
          {!error && day?.source_system === "NEWAR" && <div className="wr-note-kinds">
            <div className="wr-tabs" role="group" aria-label="备注类型">
              <button type="button" className={!memberView ? "active" : ""} aria-pressed={!memberView} onClick={() => setNoteKind("reasons")}>自动出款原因</button>
              <button type="button" className={memberView ? "active" : ""} aria-pressed={memberView} onClick={() => setNoteKind("member")}>会员 / ID 备注</button>
            </div>
            {memberView && <small>会员备注统计，不计入自动出款原因；展开查看脱敏原文。</small>}
            {memberView && day.snapshot.note_field === "remark" && !day.snapshot.member_notes && day.member_notes_snapshot
              && <small>保留上次完整采集的会员备注</small>}
          </div>}
          {!error && day && !selectedSnapshot && <div className="wr-state"><strong>{memberView ? "当天尚未采集会员备注" : "当天的自动出款原因尚未采集"}</strong>
            <p>{memberView ? "本次未返回完整会员备注，未将缺失数据显示为零。" : "旧数据来自会员备注，请切换查看；更新采集代码并补采当天后，这里才会显示自动出款原因。"}</p></div>}
          {!error && day && selectedSnapshot && totals && <>
            <dl className="wr-overview" aria-label={abnormalOnly ? "异常原因订单及结果，不含正常、空白或未识别的备注" : "有原因订单及结果，不含未填写备注的订单"}>
              <div><dt>{memberView ? "有ID备注订单" : abnormalOnly ? "异常原因订单" : "有原因订单"}</dt><dd><strong>{fmt(totals.total)}</strong></dd></div>
              <div className="wr-success"><dt>成功</dt><dd><strong>{fmt(totals.success)}</strong><small title={`有原因的成功笔数 / 有原因订单数；${statusBasis}`}>{reasonPercent(totals.success, totals.total)}</small></dd></div>
              <div className="wr-rejected"><dt>驳回</dt><dd><strong>{fmt(totals.reject)}</strong><small title="有原因的驳回笔数 / 有原因订单数">{reasonPercent(totals.reject, totals.total)}</small></dd></div>
              {totals.other > 0 && <div><dt>其他状态</dt><dd><strong>{fmt(totals.other)}</strong><small>{reasonPercent(totals.other, totals.total)}</small></dd></div>}
            </dl>
            {differs && <div className="wr-alert">采集 {fmt(selectedSnapshot.totals.total)} 笔 / 日表 {fmt(reportTotal)} 笔，尚未对齐；{memberView ? "备注" : "原因"}占比按{abnormalOnly ? "已采集的异常原因订单" : "已采集且有备注的订单"}计算。</div>}
            {selectedSnapshot.coverage.incomplete_note_count > 0 && <div className="wr-alert">{fmt(selectedSnapshot.coverage.incomplete_note_count)} 笔备注待补全文，请重新采集当天。</div>}
            <div className="wr-reason-controls">
              <div className="wr-tabs" role="group" aria-label="操作方式">
                {(["manual", "auto", "unknown"] as const).map(type => <button type="button" key={type} aria-pressed={operator === type}
                  title={type === "unknown" ? "原因已归类；原记录未识别自动或人工，不并入人工笔数。" : undefined}
                  className={operator === type ? "active" : ""} onClick={() => setOperator(type)}>
                  <span>{operatorNames[type]}</span><strong>{fmt(totals[type])}</strong><small title="占全部有原因订单">{reasonPercent(totals[type], totals.total)}</small>
                </button>)}
              </div>
              <div className="wr-reason-tools">
                <span className="wr-note-scope">{abnormalOnly ? "仅统计已识别异常" : "仅含已填备注"}{omittedCount > 0 && (abnormalOnly ? ` · 其余 ${fmt(omittedCount)} 笔不计` : ` · 全部方式未填 ${fmt(omittedCount)} 笔不计`)}</span>
                <input aria-label="搜索原因或备注样本" placeholder={memberView ? "搜索会员备注" : "搜索原因 / 原备注"} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
                <ReasonPagination page={actualPage} pages={pages} total={groups.length} onPage={setPage} />
              </div>
            </div>
            <div className="wr-table-wrap"><table className="wr-table"><colgroup><col className="wr-col-reason" /><col className="wr-col-count" /><col className="wr-col-percent" /><col className="wr-col-status" />{showOther && <col className="wr-col-other" />}<col className="wr-col-detail" /></colgroup><thead><tr>
              <th>{memberView ? "会员 / ID 备注" : "原因"}</th><th>笔数</th><th title={`该${memberView ? "备注" : "原因"}笔数 ÷ ${operatorNames[operator]}有${memberView ? "备注" : "原因"}订单 ${fmt(denominator)} 笔（${abnormalOnly ? "仅含已识别异常" : "不含未填写备注"}）`}>{memberView ? "备注占比" : "原因占比"}</th><th title={statusBasis}>成功 / 驳回</th>{showOther && <th>其他</th>}<th>明细</th>
            </tr></thead><tbody>{groups.slice((actualPage - 1) * 20, actualPage * 20).map(g => <ReasonRow key={`${memberView}:${operator}:${g.reason_key}`} group={g} denominator={denominator} operator={operator} showOther={showOther} member={memberView} />)}</tbody></table>
            {!groups.length && <div className="wr-state">{search ? "没有匹配的原因" : `当天没有${operatorNames[operator]}的${abnormalOnly ? "已识别异常原因" : "已填写原因"}`}</div>}</div>
            <div className="wr-footer"><span>{search.trim() ? "匹配" : "共"} {groups.length} 类 · {fmt(matchedCount)} 笔</span>
              <ReasonPagination page={actualPage} pages={pages} total={groups.length} onPage={setPage} /></div>
          </>}
        </div>
      </div>;

  return <ReasonsContext.Provider value={allowed ? { open: p => open(p), expandedKey: inline && target ? keyOf(target) : "", panel,
    query: () => platforms[0] && open(platforms[0], false), canQuery: platforms.length > 0 } : null}>
    {showToolbar && <div className="wr-toolbar">
      <div><strong>原因统计</strong></div>
      <AutoWithdrawReasonsQueryButton />
    </div>}
    {children}
    {target && !inline && <div className="wr-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}>{panel}</div>}
  </ReasonsContext.Provider>;
}
