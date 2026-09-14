"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dashboardBusinessFetch, isDashboardDataDenied } from "@/lib/dashboardDataClient";
import type { OriginalRateGrid, OriginalRateWorkbookMeta } from "@/lib/originalRateGridTypes";
import { buildTidyModel, tidyBodySourceCell, tidyStatusTone } from "@/lib/tidyOriginalRates";
import TidyOriginalRateTable from "./TidyOriginalRateTable";
import "./OriginalRatesWorkspace.css";

function cellName(row: number, col: number) {
  let letters = "";
  for (let n = col + 1; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  return `${letters}${row + 1}`;
}

export default function OriginalRatesWorkspace({ onAnomalies, onUnavailable }: { onAnomalies: () => void; onUnavailable?: () => void }) {
  const [meta, setMeta] = useState<OriginalRateWorkbookMeta | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [grid, setGrid] = useState<OriginalRateGrid | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [readyRevision, setReadyRevision] = useState<number | null>(null);
  const [view, setView] = useState<"compact" | "full">("compact");
  const [selectedCell, setSelectedCell] = useState<{ address: string; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setGrid(null); setSelectedCell(null);
    void (async () => {
      try {
        const res = await dashboardBusinessFetch("/api/original-rate-sheet", { signal: controller.signal });
        const value = await res.json();
        if (!res.ok) throw new Error(value?.message || "原表暂时无法读取");
        if (controller.signal.aborted) return;
        setMeta(value);
        setSheetId(current => value.sheets.some((sheet: { sheetId: number }) => sheet.sheetId === current) ? current : value.sheets.some((sheet: { sheetId: number }) => sheet.sheetId === 277747449) ? 277747449 : value.sheets[0]?.sheetId ?? null);
        setReadyRevision(revision);
        if (!value.sheets.length) setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setMeta(null); setGrid(null); setReadyRevision(null); setLoading(false);
        setError(isDashboardDataDenied(err) ? "登录或数据权限已变化，请重新进入此页面。" : err instanceof Error ? err.message : "原表暂时无法读取");
      }
    })();
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (sheetId === null || readyRevision !== revision) return;
    const controller = new AbortController();
    setGrid(null); setLoading(true); setError(""); setSelectedCell(null);
    void (async () => {
      try {
        const res = await dashboardBusinessFetch(`/api/original-rate-sheet?sheetId=${sheetId}`, { signal: controller.signal });
        const value = await res.json();
        if (!res.ok) throw new Error(value?.message || "原表暂时无法读取");
        if (controller.signal.aborted) return;
        setGrid(value);
      } catch (err) {
        if (controller.signal.aborted) return;
        setGrid(null);
        setError(isDashboardDataDenied(err) ? "登录或数据权限已变化，请重新进入此页面。" : err instanceof Error ? err.message : "原表暂时无法读取");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [sheetId, revision, readyRevision]);

  useEffect(() => { setQuery(""); setTypeFilter(""); setPlatformFilter(""); setStatusFilter(""); }, [sheetId]);
  useEffect(() => { setSelectedCell(null); }, [view, query, typeFilter, platformFilter, statusFilter]);
  const model = useMemo(() => grid ? buildTidyModel(grid) : null, [grid]);
  const typeOptions = useMemo(() => {
    if (!grid || !model) return [];
    const column = model.columns.find(item => item.sourceColumn === model.typeColumn);
    return column ? [...new Set(model.rows.map(row => tidyBodySourceCell(grid, row, column, model.headerRows).text).filter(Boolean))] : [];
  }, [grid, model]);
  const platformOptions = model?.columns.filter(column => column.group === "platform") || [];
  const columns = useMemo(() => model?.columns.filter(column => (view === "full" || column.compact) && (!platformFilter || column.group !== "platform" || String(column.sourceColumn) === platformFilter)) || [], [model, view, platformFilter]);
  const rows = useMemo(() => {
    if (!grid || !model) return [];
    const term = query.trim().toLocaleLowerCase();
    const statusColumns = model.columns.filter(column => platformFilter ? String(column.sourceColumn) === platformFilter : model.platformColumns.length ? column.group === "platform" : column.kind === "status");
    return model.rows.filter(row => {
      const text = (column: (typeof model.columns)[number]) => tidyBodySourceCell(grid, row, column, model.headerRows).text;
      if (view === "compact" && !columns.some(column => text(column) !== "")) return false;
      const searchColumns = model.providerColumn === null ? model.columns : model.columns.filter(column => column.sourceColumn === model.providerColumn);
      if (term && !searchColumns.some(column => text(column).toLocaleLowerCase().includes(term))) return false;
      const typeColumn = model.columns.find(column => column.sourceColumn === model.typeColumn);
      if (typeFilter && (!typeColumn || text(typeColumn) !== typeFilter)) return false;
      if (statusFilter && !statusColumns.some(column => {
        const value = text(column);
        if (tidyStatusTone(value) === "plain") return false;
        if (statusFilter === "good") return tidyStatusTone(value) === "good";
        if (statusFilter === "paused") return /暂停|停用|关闭|禁用|停运|暂关/.test(value);
        if (statusFilter === "unconnected") return /未接入|未接通|未开通|不支持/.test(value);
        return tidyStatusTone(value) === "attention" && !/暂停|停用|关闭|禁用|停运|暂关/.test(value);
      })) return false;
      return true;
    });
  }, [grid, model, view, query, typeFilter, platformFilter, statusFilter, columns]);

  function locate(platforms: boolean) {
    const scroller = host.current?.querySelector<HTMLElement>(".tidy-rate-scroll");
    if (!scroller) return;
    const target = platforms ? scroller.querySelector<HTMLElement>("[data-platform-start]") : null;
    if (!target) { scroller.scrollLeft = 0; return; }
    scroller.scrollLeft = Math.max(0, target.offsetLeft - (Number(scroller.dataset.frozenWidth) || 180));
  }
  function resetFilters() { setQuery(""); setTypeFilter(""); setPlatformFilter(""); setStatusFilter(""); }

  return <section className="original-rates-workspace" aria-label="各国家费率原表">
    <div className="original-rates-heading">
      <h2>{grid?.sheet.title || meta?.sheets.find(sheet => sheet.sheetId === sheetId)?.title || "各国家费率"}<span>三方费率</span></h2>
      <div className="original-rates-heading-actions">
        {grid && <time className="original-rates-time" dateTime={grid.fetchedAt} title="Supabase 原表同步时间">Supabase · {new Date(grid.fetchedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time>}
        <button type="button" onClick={onAnomalies}>异常提醒</button><button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading}>刷新</button>
      </div>
    </div>
    <div className="original-rates-filters">
      <label><span>三方名称</span><input aria-label="三方名称" type="search" placeholder="搜索三方" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label><span>类型 / 钱包</span><select aria-label="类型 / 钱包" value={typeFilter} disabled={!typeOptions.length} onChange={event => setTypeFilter(event.target.value)}><option value="">全部类型</option>{typeOptions.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <label><span>平台</span><select aria-label="平台" value={platformFilter} disabled={!platformOptions.length} onChange={event => setPlatformFilter(event.target.value)}><option value="">全部平台</option>{platformOptions.map(column => <option key={column.sourceColumn} value={column.sourceColumn}>{column.label}</option>)}</select></label>
      <label><span>平台状态</span><select aria-label="平台状态" title="按原表配置 / 接入状态筛选，不代表实际订单跑量" value={statusFilter} disabled={!model?.columns.some(column => column.group === "platform" || column.kind === "status")} onChange={event => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="good">开启</option><option value="paused">暂停 / 停用</option><option value="unconnected">未接入 / 不支持</option><option value="attention">备用 / 维护</option></select></label>
    </div>
    <div className="original-rates-tablebox">
      <div className="original-rates-viewbar">
        <div className="original-rates-modes" role="group" aria-label="费率列显示方式">{(["compact", "full"] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => { setView(mode); locate(false); }}>{mode === "compact" ? "精简展示" : "原表全部列"}</button>)}</div>
        <span className="original-rates-count" aria-live="polite">{model ? `${rows.length} / ${model.rows.length} 行 · ${columns.length} 列` : ""}</span>
        {(query || typeFilter || platformFilter || statusFilter) && <button type="button" className="original-rates-reset" onClick={resetFilters}>清除筛选</button>}
        <div className="original-rates-locate"><button type="button" aria-label="定位费率区" onClick={() => locate(false)}>费率区</button><button type="button" aria-label="定位平台区" disabled={!platformOptions.length} onClick={() => locate(true)}>平台区 →</button></div>
      </div>
      <div className="original-rates-content" ref={host}>
        {loading ? <div className="original-rates-notice" role="status">读取原表中…</div> : error ? <div className="original-rates-notice" role="alert">{error}<button type="button" onClick={() => setRevision(value => value + 1)}>重试</button>{onUnavailable && <button type="button" onClick={onUnavailable}>查看现有费率</button>}</div> : grid && model ? <TidyOriginalRateTable key={`${sheetId}-${view}`} grid={grid} model={model} columns={columns} rows={rows} view={view} onCellSelect={(row, col, cell) => setSelectedCell({ address: cellName(row, col), text: cell.text })} /> : <div className="original-rates-notice">暂无原表</div>}
      </div>
      {selectedCell && <div className="original-rates-cellbar"><span>{selectedCell.address}</span><textarea aria-label="原单元格完整内容" rows={2} value={selectedCell.text} readOnly /><button type="button" aria-label="收起单元格内容" onClick={() => setSelectedCell(null)}>收起</button></div>}
      <div className="original-rates-caption"><span>{view === "full" ? "原字段 · 原顺序" : "关键费率 · 平台横向对照"}</span><span title="配置状态来自原表，不等同于当日实际订单或金额">平台栏为原表接入状态</span></div>
    </div>
    <nav className="original-rates-tabs" aria-label="Google 原表页签">{meta?.sheets.map(sheet => <button key={sheet.sheetId} type="button" aria-current={sheetId === sheet.sheetId ? "page" : undefined} onClick={() => setSheetId(sheet.sheetId)}>{sheet.title}</button>)}</nav>
  </section>;
}
