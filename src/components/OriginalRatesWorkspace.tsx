"use client";

import { useEffect, useRef, useState } from "react";
import { dashboardBusinessFetch, isDashboardDataDenied } from "@/lib/dashboardDataClient";
import type { OriginalGridCell, OriginalRateGrid, OriginalRateWorkbookMeta } from "@/lib/originalRateGridTypes";
import OriginalRateGridView from "./OriginalRateGrid";
import "./OriginalRatesWorkspace.css";

function cellName(row: number, col: number): string {
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
  const [zoom, setZoom] = useState(1);
  const [address, setAddress] = useState("A1");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(-1);
  const [findMessage, setFindMessage] = useState("");
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setGrid(null); setText("");
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
    setGrid(null); setLoading(true); setError(""); setText(""); setAddress("A1"); setSearchIndex(-1); setFindMessage("");
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

  function select(row: number, col: number, cell: OriginalGridCell) {
    setAddress(cellName(row, col)); setText(cell.text);
  }
  function locate(row: number, col: number) {
    if (!grid || row < 0 || col < 0 || row >= grid.rowCount || col >= grid.columnCount) return;
    const merge = grid.merges.find(m => row >= m.startRowIndex && row < m.endRowIndex && col >= m.startColumnIndex && col < m.endColumnIndex);
    if (merge) { row = merge.startRowIndex; col = merge.startColumnIndex; }
    const name = cellName(row, col);
    select(row, col, grid.cells[row]?.[col] || { text: "" });
    const node = host.current?.querySelector<HTMLElement>(`[data-cell="${name}"]`);
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
    node?.focus({ preventScroll: true });
  }
  function goToAddress() {
    const match = /^([A-Z]{1,4})([1-9]\d{0,5})$/.exec(address.trim().toUpperCase());
    if (!match) return;
    const col = [...match[1]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
    locate(Number(match[2]) - 1, col);
  }
  function findNext() {
    if (!grid || !query.trim()) { setFindMessage(""); return; }
    const term = query.trim().toLocaleLowerCase();
    const matches: [number, number][] = [];
    // A merged cell can remain visible even when its original anchor row or
    // column is hidden. Search exactly the source anchors the grid renders.
    const visible = new Set(Array.from(host.current?.querySelectorAll<HTMLElement>("[data-cell]") || []).map(node => node.dataset.cell));
    grid.cells.forEach((row, r) => row.forEach((cell, c) => {
      if (cell.text.toLocaleLowerCase().includes(term) && visible.has(cellName(r, c))) matches.push([r, c]);
    }));
    if (!matches.length) { setFindMessage("未找到"); return; }
    const next = (searchIndex + 1) % matches.length;
    setSearchIndex(next); setFindMessage(`${next + 1}/${matches.length}`); locate(...matches[next]);
  }

  return <section className="original-rates-workspace" aria-label="各国家费率原表">
    <div className="original-rates-toolbar">
      <strong>各国家费率</strong>
      <button type="button" onClick={onAnomalies}>异常提醒</button>
      <span className="original-rates-divider" />
      <form onSubmit={event => { event.preventDefault(); findNext(); }} className="original-rates-search">
        <input aria-label="在原表中查找" placeholder="查找三方 / 平台" value={query} onChange={event => { setQuery(event.target.value); setSearchIndex(-1); setFindMessage(""); }} />
        <button type="submit" disabled={!grid}>查找</button><span aria-live="polite">{findMessage}</span>
      </form>
      <label className="original-rates-zoom"><span className="sr-only">表格缩放</span><select aria-label="表格缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[0.7, 0.85, 1, 1.15].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></label>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading}>刷新</button>
      {grid && <time className="original-rates-time" dateTime={grid.fetchedAt} title="原表读取时间">{new Date(grid.fetchedAt).toLocaleString("zh-CN", { hour12: false })}</time>}
    </div>
    <div className="original-rates-cellbar">
      <input aria-label="单元格位置" value={address} onChange={event => setAddress(event.target.value)} onKeyDown={event => { if (event.key === "Enter") goToAddress(); }} />
      <span>fx</span><textarea aria-label="原单元格完整内容" rows={1} value={text} readOnly />
    </div>
    <div className="original-rates-content" ref={host}>
      {loading ? <div className="original-rates-notice" role="status">读取原表中…</div> : error ? <div className="original-rates-notice" role="alert">{error}<button type="button" onClick={() => setRevision(value => value + 1)}>重试</button>{onUnavailable && <button type="button" onClick={onUnavailable}>查看现有费率</button>}</div> : grid ? <OriginalRateGridView key={sheetId} grid={grid} zoom={zoom} onCellSelect={select} /> : <div className="original-rates-notice">暂无原表</div>}
    </div>
    <nav className="original-rates-tabs" aria-label="Google 原表页签">{meta?.sheets.map(sheet => <button key={sheet.sheetId} type="button" aria-current={sheetId === sheet.sheetId ? "page" : undefined} onClick={() => { setSheetId(sheet.sheetId); setQuery(""); }}>{sheet.title}</button>)}</nav>
  </section>;
}
