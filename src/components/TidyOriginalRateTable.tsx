"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { OriginalRateGrid } from "@/lib/originalRateGridTypes";
import { tidyBodySourceCell, tidyStatusTone, type TidyColumn, type TidyModel } from "@/lib/tidyOriginalRates";
import "./TidyOriginalRateTable.css";

export type TidyOriginalRateTableProps = {
  grid: OriginalRateGrid;
  model: TidyModel;
  columns: TidyColumn[];
  rows: number[];
  view: "compact" | "full";
  onCellSelect?: (row: number, column: number, cell: { text: string }) => void;
};

type ColumnLayout = { column: TidyColumn; width: number; frozen: boolean; left: number; edge: boolean };
type HeaderPart = { group: TidyColumn["group"]; columns: ColumnLayout[]; grouped: boolean };
const ROW_INDEX_WIDTH = 44;
const HEADER_HEIGHT = 62;
const GROUP_LABELS = { identity: "", collect: "代收", payout: "代付", platform: "平台", other: "" };

function columnLetter(column: number) {
  let result = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function sourceAddress(row: number, column: number) { return `${columnLetter(column)}${row + 1}`; }

function buildColumns(columns: TidyColumn[], model: TidyModel, narrow: boolean) {
  const providerIndex = columns.findIndex(column => column.sourceColumn === model.providerColumn);
  const typeIndex = columns.findIndex(column => column.sourceColumn === model.typeColumn);
  // Freeze the adjacent type only. Full mode keeps the source column order even
  // when a workbook puts other fields before or between its identity columns.
  const frozenType = !narrow && providerIndex >= 0 && typeIndex === providerIndex + 1;
  let frozenWidth = ROW_INDEX_WIDTH;
  const layouts = columns.map((column, index): ColumnLayout => {
    const width = Number.isFinite(column.width) ? Math.max(60, Math.min(340, column.width)) : 112;
    const frozen = index === providerIndex || (frozenType && index === typeIndex);
    const left = frozenWidth;
    if (frozen) frozenWidth += width;
    return { column, width, frozen, left, edge: frozen && index === (frozenType ? typeIndex : providerIndex) };
  });
  return { layouts, frozenWidth, width: ROW_INDEX_WIDTH + layouts.reduce((total, column) => total + column.width, 0) };
}

function buildHeaders(columns: ColumnLayout[]) {
  const parts: HeaderPart[] = [];
  for (const column of columns) {
    const group = column.column.group;
    const grouped = group === "collect" || group === "payout" || group === "platform";
    const previous = parts[parts.length - 1];
    if (grouped && previous?.grouped && previous.group === group) previous.columns.push(column);
    else parts.push({ group, columns: [column], grouped });
  }
  return parts;
}

function columnClass(item: ColumnLayout) {
  return [
    `tidy-rate-${item.column.kind}`,
    `tidy-rate-group-${item.column.group}`,
    item.frozen ? "tidy-rate-frozen" : "",
    item.edge ? "tidy-rate-frozen-edge" : "",
  ].filter(Boolean).join(" ");
}

/** Presentation only: source strings and source order are never normalized. */
export default function TidyOriginalRateTable({ grid, model, columns, rows, view, onCellSelect }: TidyOriginalRateTableProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setNarrow(element.clientWidth < 600);
    measure();
    // Observe this panel, not the window: sidebar/layout changes also affect
    // the available horizontal space and every frozen-coordinate consumer.
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const layout = useMemo(() => buildColumns(columns, model, narrow), [columns, model, narrow]);
  const headers = useMemo(() => buildHeaders(layout.layouts), [layout.layouts]);
  const [selection, setSelection] = useState<{ grid: OriginalRateGrid; row: number; column: number } | null>(null);
  const selected = selection?.grid === grid && rows.includes(selection.row) && columns.some(column => column.sourceColumn === selection.column) ? selection : null;
  const focusedRow = selected?.row ?? rows[0];
  const focusedColumn = selected?.column ?? columns[0]?.sourceColumn;
  const firstPlatformColumn = columns.find(column => column.group === "platform")?.sourceColumn;

  function select(row: number, column: number, focus = false) {
    const definition = columns.find(item => item.sourceColumn === column);
    if (!definition) return;
    const source = tidyBodySourceCell(grid, row, definition, model.headerRows);
    setSelection({ grid, row, column });
    onCellSelect?.(source.sourceRow, source.sourceColumn, { text: source.text });
    if (!focus) return;
    const scroller = viewport.current;
    const element = scroller?.querySelector<HTMLElement>(`td[data-cell="${sourceAddress(row, column)}"]`);
    if (!scroller || !element) return;
    element.focus({ preventScroll: true });
    const cellRect = element.getBoundingClientRect(), bounds = scroller.getBoundingClientRect();
    const item = layout.layouts.find(item => item.column.sourceColumn === column);
    if (!item?.frozen) {
      if (cellRect.left < bounds.left + layout.frozenWidth) scroller.scrollLeft -= bounds.left + layout.frozenWidth - cellRect.left;
      else if (cellRect.right > bounds.right) scroller.scrollLeft += cellRect.right - bounds.right;
    }
    if (cellRect.top < bounds.top + HEADER_HEIGHT) scroller.scrollTop -= bounds.top + HEADER_HEIGHT - cellRect.top;
    else if (cellRect.bottom > bounds.bottom) scroller.scrollTop += cellRect.bottom - bounds.bottom;
  }

  function navigate(event: KeyboardEvent<HTMLTableCellElement>, row: number, column: number) {
    const rowIndex = rows.indexOf(row), columnIndex = columns.findIndex(item => item.sourceColumn === column);
    let nextRow = rowIndex, nextColumn = columnIndex;
    switch (event.key) {
      case "ArrowUp": nextRow--; break;
      case "ArrowDown": nextRow++; break;
      case "ArrowLeft": nextColumn--; break;
      case "ArrowRight": nextColumn++; break;
      case "Home": nextColumn = 0; if (event.ctrlKey || event.metaKey) nextRow = 0; break;
      case "End": nextColumn = columns.length - 1; if (event.ctrlKey || event.metaKey) nextRow = rows.length - 1; break;
      case "Enter": case " ": event.preventDefault(); select(row, column); return;
      default: return;
    }
    event.preventDefault();
    nextRow = Math.max(0, Math.min(rows.length - 1, nextRow));
    nextColumn = Math.max(0, Math.min(columns.length - 1, nextColumn));
    if (rows[nextRow] !== undefined && columns[nextColumn]) select(rows[nextRow], columns[nextColumn].sourceColumn, true);
  }

  function leafHeader(item: ColumnLayout, rowSpan = 1) {
    const prefix = item.column.group === "collect" ? "代收 / " : item.column.group === "payout" ? "代付 / " : "";
    const displayLabel = prefix && item.column.label.startsWith(prefix) ? item.column.label.slice(prefix.length) : item.column.label;
    return <th
      key={item.column.sourceColumn}
      scope="col"
      rowSpan={rowSpan}
      data-column={item.column.sourceColumn}
      data-source-column={item.column.sourceColumn}
      data-platform-start={item.column.sourceColumn === firstPlatformColumn ? "true" : undefined}
      className={`${columnClass(item)} ${rowSpan === 2 ? "tidy-rate-tall-header" : "tidy-rate-leaf-header"}`}
      style={item.frozen ? { left: item.left } : undefined}
      title={item.column.label}
      aria-label={item.column.label}
    ><span className="tidy-rate-header-text">{displayLabel}</span></th>;
  }

  return <div
    ref={viewport}
    className="tidy-rate-scroll"
    data-sheet-id={grid.sheet.sheetId}
    data-view={view}
    data-frozen-width={layout.frozenWidth}
    style={{ "--tidy-frozen-width": `${layout.frozenWidth}px` } as CSSProperties}
    role="region"
    aria-label={`${grid.sheet.title} · ${view === "compact" ? "精简展示" : "原表全部列"}`}
    tabIndex={rows.length && columns.length ? -1 : 0}
  >
    <table className="tidy-rate-table" style={{ width: layout.width }} aria-label={`${grid.sheet.title}费率与平台表`}>
      <colgroup><col style={{ width: ROW_INDEX_WIDTH }} />{layout.layouts.map(item => <col key={item.column.sourceColumn} style={{ width: item.width }} />)}</colgroup>
      <thead>
        <tr className="tidy-rate-group-row">
          <th className="tidy-rate-index tidy-rate-frozen tidy-rate-tall-header" rowSpan={2} scope="col" style={{ left: 0 }}>原行</th>
          {headers.map((part, index) => part.grouped
            ? <th key={`group-${index}`} className={`tidy-rate-group-${part.group}`} colSpan={part.columns.length} scope="colgroup">{GROUP_LABELS[part.group]}</th>
            : leafHeader(part.columns[0], 2))}
        </tr>
        <tr className="tidy-rate-leaf-row">{headers.filter(part => part.grouped).flatMap(part => part.columns.map(item => leafHeader(item)))}</tr>
      </thead>
      <tbody>
        {rows.length && columns.length ? rows.map(row => <tr key={row} data-source-row={row}>
          <th className="tidy-rate-index tidy-rate-frozen" scope="row" style={{ left: 0 }} title={`原表第 ${row + 1} 行`}>{row + 1}</th>
          {layout.layouts.map(item => {
            const source = tidyBodySourceCell(grid, row, item.column, model.headerRows);
            const status = item.column.kind === "status" || item.column.group === "platform";
            const tone = status ? tidyStatusTone(source.text) : "plain";
            const isSelected = selected?.row === row && selected.column === item.column.sourceColumn;
            return <td
              key={item.column.sourceColumn}
              className={`${columnClass(item)}${isSelected ? " tidy-rate-selected" : ""}`}
              style={item.frozen ? { left: item.left } : undefined}
              data-cell={sourceAddress(row, item.column.sourceColumn)}
              data-source-cell={sourceAddress(source.sourceRow, source.sourceColumn)}
              data-column={item.column.sourceColumn}
              data-source-column={item.column.sourceColumn}
              data-status-tone={status ? tone : undefined}
              tabIndex={focusedRow === row && focusedColumn === item.column.sourceColumn ? 0 : -1}
              onClick={() => select(row, item.column.sourceColumn)}
              onKeyDown={event => navigate(event, row, item.column.sourceColumn)}
              aria-label={`${item.column.label}，原表第 ${row + 1} 行${source.text ? `：${source.text}` : "：空白"}`}
            ><span className={`tidy-rate-cell-text${status && tone !== "plain" ? ` tidy-rate-tone-${tone}` : ""}`} title={source.text}>{source.text}</span></td>;
          })}
        </tr>) : <tr><td className="tidy-rate-empty" colSpan={columns.length + 1}>没有符合条件的记录</td></tr>}
      </tbody>
    </table>
  </div>;
}
