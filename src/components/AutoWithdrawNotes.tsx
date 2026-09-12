"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listAutoWithdrawNotes, saveAutoWithdrawNote, type AutoWithdrawNote } from "@/lib/autoWithdrawNotesClient";
import { hasDashboardPermission } from "@/lib/dashboardAuthClient";
import { useDashboardAuth } from "./DashboardAuthGate";
import { platformDisplayCountry } from "@/lib/platformDisplayCountry";

type NoteTarget = { country: string; platform: string; date: string };
type NotesContextValue = {
  notes: AutoWithdrawNote[];
  loading: boolean;
  error: string;
  singleDay: boolean;
  canWrite: boolean;
  open: (country: string, platform: string) => void;
  refresh: () => void;
  showSample: () => void;
};

const NotesContext = createContext<NotesContextValue | null>(null);
function sameDisplayPlatform(country: string, platform: string, targetCountry: string, targetPlatform: string) {
  return platform === targetPlatform
    && platformDisplayCountry(country, platform) === platformDisplayCountry(targetCountry, targetPlatform);
}

// Display aliases never rewrite stored note identities. If both historical
// country keys exist on one day, prefer the canonical key, then latest update.
export function autoWithdrawDisplayNotes(notes: readonly AutoWithdrawNote[], country: string, platform: string): AutoWithdrawNote[] {
  const canonical = platformDisplayCountry(country, platform);
  const candidates = notes.filter((note) => sameDisplayPlatform(note.country, note.platform, country, platform))
    .sort((a, b) => b.data_date.localeCompare(a.data_date)
      || Number(b.country === canonical) - Number(a.country === canonical)
      || b.updated_at.localeCompare(a.updated_at)
      || a.country.localeCompare(b.country));
  const days = new Set<string>();
  return candidates.filter((note) => {
    if (days.has(note.data_date)) return false;
    days.add(note.data_date);
    return true;
  });
}

export function findAutoWithdrawDisplayNote(notes: readonly AutoWithdrawNote[], target: NoteTarget) {
  return autoWithdrawDisplayNotes(notes, target.country, target.platform).find((note) => note.data_date === target.date);
}

export function autoWithdrawNoteSaveTarget(notes: readonly AutoWithdrawNote[], target: NoteTarget): NoteTarget {
  const existing = findAutoWithdrawDisplayNote(notes, target);
  return existing ? { ...target, country: existing.country } : target;
}

function noteTime(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "";
}

export function AutoWithdrawNotesActions() {
  const context = useContext(NotesContext);
  if (!context) return null;
  return <div className="auto-notes-toolbar-actions">
    <button className="ghost-btn small" type="button" onClick={context.refresh} disabled={context.loading}>刷新备注</button>
    <button className="ghost-btn small" type="button" onClick={context.showSample}>备注样本</button>
  </div>;
}

export function AutoWithdrawNotesProvider({ startDate, endDate, availableRows, children, showToolbar = true }: {
  startDate: string;
  endDate: string;
  availableRows: Array<{ date: string; country: string; platform: string }>;
  children: ReactNode;
  showToolbar?: boolean;
}) {
  const { session, profile } = useDashboardAuth();
  const canRead = Boolean(session && hasDashboardPermission(profile, "auto_withdraw"));
  const canWrite = canRead && (profile?.role === "owner" || profile?.role === "admin");
  const singleDay = Boolean(startDate && startDate === endDate);
  const [notes, setNotes] = useState<AutoWithdrawNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [target, setTarget] = useState<NoteTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<{ date?: string } | null>(null);
  const [showSample, setShowSample] = useState(false);
  const requestVersion = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dirty = Boolean(target && draft !== original);
  const modalOpen = target !== null;

  useEffect(() => {
    const version = ++requestVersion.current;
    setNotes([]);
    setError("");
    if (!session || !canRead || !startDate || !endDate) {
      setLoading(false);
      setError("请登录后查询完整日期范围，查看每日备注。");
      return;
    }
    setLoading(true);
    void listAutoWithdrawNotes(session, startDate, endDate)
      .then((rows) => { if (requestVersion.current === version) setNotes(rows); })
      .catch((cause: unknown) => {
        if (requestVersion.current === version) setError(cause instanceof Error ? cause.message : "备注读取失败，请重试。");
      })
      .finally(() => { if (requestVersion.current === version) setLoading(false); });
    return () => { if (requestVersion.current === version) requestVersion.current += 1; };
  }, [session, canRead, startDate, endDate, reload]);

  useEffect(() => {
    if (!savedMessage) return;
    const timer = window.setTimeout(() => setSavedMessage(""), 7000);
    return () => window.clearTimeout(timer);
  }, [savedMessage]);

  function availableDates(country: string, platform: string) {
    return Array.from(new Set(availableRows.filter((row) => sameDisplayPlatform(row.country, row.platform, country, platform) && row.date >= startDate && row.date <= endDate).map((row) => row.date))).sort((a, b) => b.localeCompare(a));
  }

  function closeEditor() {
    setTarget(null);
    setPendingAction(null);
    setSaveError("");
    openerRef.current?.focus();
  }

  function requestClose() {
    if (saving) return;
    if (dirty) setPendingAction({});
    else closeEditor();
  }

  function selectDate(date: string) {
    if (!target || !date || date < startDate || date > endDate) return;
    const next = { ...target, date };
    const reason = findAutoWithdrawDisplayNote(notes, next)?.reason || "";
    setTarget(next);
    setDraft(reason);
    setOriginal(reason);
    setSaveError("");
    setPendingAction(null);
  }

  function requestDate(date: string) {
    if (!target || date === target.date) return;
    if (dirty) setPendingAction({ date });
    else selectDate(date);
  }

  function openEditor(country: string, platform: string) {
    if (loading || error) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const latest = autoWithdrawDisplayNotes(notes, country, platform).find((note) => note.reason.trim());
    const next = { country, platform, date: singleDay ? startDate : latest?.data_date || availableDates(country, platform)[0] || endDate };
    const reason = findAutoWithdrawDisplayNote(notes, next)?.reason || "";
    setTarget(next);
    setOriginal(reason);
    setDraft(reason);
    setSaveError("");
    setPendingAction(null);
  }

  useEffect(() => {
    if (!modalOpen) return;
    const focusable = modalRef.current?.querySelector<HTMLElement>("select, textarea, button");
    focusable?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [modalOpen]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    if (!target || !session || !canWrite || saving) return;
    if (!availableDates(target.country, target.platform).includes(target.date)) {
      setSaveError("请选择当前查询范围内有自动出款数据的日期。");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const storageTarget = autoWithdrawNoteSaveTarget(notes, target);
      const result = await saveAutoWithdrawNote(session, { ...storageTarget, reason: draft.trim() });
      requestVersion.current += 1;
      setLoading(false);
      setError("");
      // Replace only the saved database key, not other legacy alias records.
      setNotes((previous) => [...previous.filter((note) => !(note.data_date === result.data_date
        && note.country === result.country && note.platform === result.platform)), result]);
      setSavedMessage(`${target.date} · ${target.platform} 的备注已${result.reason.trim() ? "保存" : "清空"}`);
      setOriginal(result.reason);
      setDraft(result.reason);
      closeEditor();
      // Re-read the full range: a concurrent session refresh may have cleared the old list.
      setReload((value) => value + 1);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "保存失败，输入内容已保留，请重试。");
    } finally {
      setSaving(false);
    }
  }

  const platformNotes = target ? autoWithdrawDisplayNotes(notes, target.country, target.platform).filter((note) => note.reason.trim()) : [];
  const activeNote = target ? findAutoWithdrawDisplayNote(notes, target) : undefined;
  const dateOptions = target ? Array.from(new Set([...availableDates(target.country, target.platform), ...platformNotes.map((note) => note.data_date), target.date])).sort((a, b) => b.localeCompare(a)) : [];

  return (
    <NotesContext.Provider value={{ notes, loading, error, singleDay, canWrite, open: openEditor,
      refresh: () => setReload(value => value + 1), showSample: () => setShowSample(true) }}>
      {showToolbar && <div className="auto-notes-toolbar">
        <div>
          <strong>每日原因备注</strong>
          <span>{singleDay ? `${startDate} · 记录各盘口人工处理偏高的原因` : "按日期分别记录；区间汇总展示最新原因"}</span>
          {!canWrite && !loading && !error && <span>当前账号可查看，管理员可编辑</span>}
        </div>
        <AutoWithdrawNotesActions />
      </div>}
      {loading && <p className="auto-notes-status" role="status">正在读取每日备注…</p>}
      {error && <p className="auto-notes-status is-error" role="alert">备注暂时未能读取：{error} <button type="button" onClick={() => setReload((value) => value + 1)}>重试</button></p>}
      {savedMessage && <p className="auto-notes-status is-success" role="status">{savedMessage}</p>}
      {children}
      {target && (
        <div className="modal-backdrop auto-note-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
          <div className="auto-note-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="auto-note-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestClose(); }
              if (event.key === "Tab") {
                const elements = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']") || []);
                const first = elements[0];
                const last = elements[elements.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
            }}>
            <div className="auto-note-header">
              <div><span className="auto-note-eyebrow">每日原因备注</span><h3 id="auto-note-title">{target.country} / {target.platform}</h3></div>
              <button className="ghost-btn small" type="button" disabled={saving} onClick={requestClose} aria-label="关闭备注">关闭</button>
            </div>
            <div className="auto-note-body">
              <label className="auto-note-date-label" htmlFor="auto-note-date">备注日期</label>
              <div className="auto-note-date-row">
                <select id="auto-note-date" className="input" value={target.date} disabled={singleDay || saving} onChange={(event) => requestDate(event.target.value)}>{dateOptions.map((date) => <option value={date} key={date}>{date}</option>)}</select>
                <span>仅保存到 {target.date}，该盘口当天的记录</span>
              </div>
              {!singleDay && platformNotes.length > 0 && <div className="auto-note-history" aria-label="已有备注日期">
                <span>已有备注</span>{platformNotes.map((note) => <button type="button" key={note.data_date} disabled={saving} className={note.data_date === target.date ? "selected" : ""} onClick={() => requestDate(note.data_date)}>{note.data_date}</button>)}
              </div>}
              <label className="auto-note-reason-label" htmlFor="auto-note-reason">人工占比偏高 / 自动占比偏低的原因</label>
              {canWrite ? <textarea id="auto-note-reason" value={draft} maxLength={1000} rows={6} disabled={saving} onChange={(event) => { setDraft(event.target.value); setSaveError(""); }} placeholder="填写已核实的原因、影响时段和处理进展。保存后会直接显示在表格中。" />
                : <div className="auto-note-readonly" id="auto-note-reason">{draft || "当天尚未填写原因"}</div>}
              <div className="auto-note-editor-meta"><span>{canWrite ? "清空内容后保存，可清除当天备注" : "仅管理员可以编辑备注"}</span><span>{draft.length} / 1000</span></div>
              {activeNote && <p className="auto-note-audit">最近更新：{activeNote.updated_by_name || "未提供记录人"} · {noteTime(activeNote.updated_at)}</p>}
              {saveError && <p className="auto-notes-status is-error" role="alert">{saveError}</p>}
              {pendingAction && <div className="auto-note-unsaved" role="alert">
                <strong>有未保存的修改</strong><p>先保存当前内容，或放弃修改后{pendingAction.date ? "切换日期" : "关闭"}。</p>
                <div><button type="button" className="ghost-btn small" onClick={() => setPendingAction(null)}>继续编辑</button><button type="button" className="ghost-btn small" onClick={() => { if (pendingAction.date) selectDate(pendingAction.date); else closeEditor(); }}>放弃修改</button></div>
              </div>}
            </div>
            <div className="auto-note-footer">
              <span>备注按「日期 + 国家 + 盘口」保存</span>
              <div><button className="ghost-btn" type="button" disabled={saving} onClick={requestClose}>{canWrite ? "取消" : "关闭"}</button>{canWrite && <button className="primary-btn" type="button" disabled={saving || !dirty || draft.length > 1000} onClick={() => void save()}>{saving ? "保存中…" : "保存备注"}</button>}</div>
            </div>
          </div>
        </div>
      )}
      {showSample && <AutoWithdrawNotesSample onClose={() => setShowSample(false)} />}
    </NotesContext.Provider>
  );
}

export function AutoWithdrawReasonCell({ country, platform }: { country: string; platform: string }) {
  const context = useContext(NotesContext);
  if (!context) return null;
  const { notes, singleDay, loading, error, canWrite, open } = context;
  const matching = autoWithdrawDisplayNotes(notes, country, platform).filter((note) => note.reason.trim());
  const latest = matching[0];
  if (loading) return <span className="auto-note-placeholder">读取中…</span>;
  if (error) return <span className="auto-note-placeholder">备注读取失败</span>;
  return <button className={`auto-note-cell-button${latest ? " has-note" : ""}`} type="button" onClick={() => open(country, platform)} aria-label={`${platform} ${latest ? "查看或编辑原因备注" : canWrite ? "添加原因备注" : "查看原因备注"}`}>
    {latest ? <><span className="auto-note-preview" title={latest.reason}>{latest.reason}</span><span className="auto-note-cell-meta">{!singleDay ? `${matching.length} 天有备注 · 最新 ${latest.data_date}` : `${latest.updated_by_name || "备注"} · ${noteTime(latest.updated_at)}`}<b>{canWrite ? "编辑" : "查看"}</b></span></>
      : <><span className="auto-note-empty">{canWrite ? "+ 添加原因" : "暂无备注"}</span><span className="auto-note-cell-meta">{singleDay ? "当天尚未记录" : "选择具体日期查看或填写"}</span></>}
  </button>;
}

export function AutoWithdrawNotesSample({ onClose }: { onClose: () => void }) {
  const sampleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sampleRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop auto-note-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="auto-note-modal auto-note-sample" ref={sampleRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="auto-note-sample-title" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } if (event.key === "Tab") { event.preventDefault(); sampleRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }}>
      <div className="auto-note-header"><div><span className="auto-note-eyebrow">排版预览</span><h3 id="auto-note-sample-title">每日原因备注 · 展示样本</h3></div><button className="ghost-btn small" type="button" onClick={onClose}>关闭</button></div>
      <div className="auto-note-body">
        <p className="auto-note-demo-banner">以下平台、比例和原因均为演示内容，不代表实际异常，也不会写入业务数据。</p>
        <div className="auto-note-sample-table-wrap"><table className="auto-note-sample-table"><thead><tr><th>盘口</th><th>自动占比</th><th>人工占比</th><th>原因 / 每日备注</th></tr></thead><tbody>
          <tr><td>示例平台 A</td><td><span className="auto-note-demo-ratio">38.00%<i><b style={{ width: "38%" }} /></i></span></td><td><span className="auto-note-demo-ratio manual">62.00%<i><b style={{ width: "62%" }} /></i></span></td><td><strong>10:00—11:20 自动通道维护，期间转人工处理；现已恢复。</strong><span className="auto-note-cell-meta">示例日期 · 管理员<span>编辑</span></span></td></tr>
          <tr><td>示例平台 B</td><td><span className="auto-note-demo-ratio">74.00%<i><b style={{ width: "74%" }} /></i></span></td><td><span className="auto-note-demo-ratio manual">26.00%<i><b style={{ width: "26%" }} /></i></span></td><td><strong>部分订单触发风控复核，需人工确认后出款。</strong><span className="auto-note-cell-meta">示例日期 · 管理员<span>编辑</span></span></td></tr>
          <tr><td>示例平台 C</td><td>91.00%</td><td>9.00%</td><td><span className="auto-note-empty">+ 添加原因</span><span className="auto-note-cell-meta">当天尚未记录</span></td></tr>
        </tbody></table></div>
        <p className="auto-note-sample-help">单日：保存后直接展示原因全文摘要。多日：显示备注天数和最新原因，点开后按具体日期查看、编辑。</p>
      </div>
    </div>
  </div>;
}
