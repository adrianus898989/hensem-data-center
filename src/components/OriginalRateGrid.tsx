"use client";

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { OriginalGridBorder, OriginalGridCell, OriginalGridColor, OriginalGridFormat, OriginalGridTextFormat, OriginalRateGrid as Grid } from "@/lib/originalRateGridTypes";
import "./OriginalRateGrid.css";

export type OriginalRateGridProps = {
  grid: Grid;
  zoom?: number;
  onCellSelect?: (row: number, column: number, cell: OriginalGridCell) => void;
};

type Dimension = { index: number; size: number; offset: number; frozen: boolean };
export type OriginalGridLayoutCell = {
  row: number; column: number; sourceRow: number; sourceColumn: number;
  endRow: number; endColumn: number;
  rowSpan: number; columnSpan: number; width: number; height: number;
  top: number; left: number; frozenRow: boolean; frozenColumn: boolean;
};
export type OriginalGridLayout = {
  rows: Dimension[]; columns: Dimension[]; cells: OriginalGridLayoutCell[][];
  byCoordinate: Map<string, OriginalGridLayoutCell>;
  width: number; height: number; frozenWidth: number; frozenHeight: number; error?: string;
};

const EMPTY_CELL: OriginalGridCell = { text: "" };
const ROW_GUTTER = 42;
const COLUMN_GUTTER = 24;
const keyFor = (row: number, column: number) => `${row}:${column}`;
const bounded = (value: unknown, fallback: number, minimum: number, maximum: number) => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
const count = (value: unknown, maximum: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;

export function originalGridColumnLabel(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 18277) return "";
  let label = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
  return label;
}

/** The layout contains only original coordinates. Hidden dimensions do not renumber the source. */
export function buildOriginalGridLayout(grid: Grid): OriginalGridLayout {
  const empty: OriginalGridLayout = { rows: [], columns: [], cells: [], byCoordinate: new Map(), width: 0, height: 0, frozenWidth: 0, frozenHeight: 0 };
  const rowCount = count(grid.rowCount, 10000), columnCount = count(grid.columnCount, 18278);
  if (rowCount === null || columnCount === null || rowCount * columnCount > 500000) return { ...empty, error: "原表范围过大或无效，无法完整展示" };
  const hiddenRows = new Set(grid.hiddenRows), hiddenColumns = new Set(grid.hiddenColumns);
  let height = 0, width = 0;
  const rows: Dimension[] = [], columns: Dimension[] = [];
  for (let index = 0; index < rowCount; index++) {
    if (hiddenRows.has(index)) continue;
    const size = bounded(grid.rowHeights[index], 21, 1, 10000);
    rows.push({ index, size, offset: height, frozen: index < grid.sheet.frozenRowCount }); height += size;
  }
  for (let index = 0; index < columnCount; index++) {
    if (hiddenColumns.has(index)) continue;
    const size = bounded(grid.columnWidths[index], 100, 1, 10000);
    columns.push({ index, size, offset: width, frozen: index < grid.sheet.frozenColumnCount }); width += size;
  }
  const occupied = new Map<string, OriginalGridLayoutCell>();
  for (const merge of grid.merges) {
    const { startRowIndex: sr, endRowIndex: er, startColumnIndex: sc, endColumnIndex: ec } = merge;
    if (![sr, er, sc, ec].every(Number.isSafeInteger) || sr < 0 || sc < 0 || sr >= er || sc >= ec || er > rowCount || ec > columnCount) continue;
    const mergeRows = rows.filter(row => row.index >= sr && row.index < er), mergeColumns = columns.filter(column => column.index >= sc && column.index < ec);
    if (!mergeRows.length || !mergeColumns.length) continue;
    // Malformed overlapping ranges never suppress unrelated cells.
    if (mergeRows.some(row => mergeColumns.some(column => occupied.has(keyFor(row.index, column.index))))) continue;
    const firstRow = mergeRows[0], firstColumn = mergeColumns[0];
    const cell: OriginalGridLayoutCell = {
      row: firstRow.index, column: firstColumn.index, sourceRow: sr, sourceColumn: sc,
      endRow: er, endColumn: ec,
      rowSpan: mergeRows.length, columnSpan: mergeColumns.length,
      width: mergeColumns.reduce((total, column) => total + column.size, 0), height: mergeRows.reduce((total, row) => total + row.size, 0),
      top: firstRow.offset, left: firstColumn.offset, frozenRow: firstRow.frozen, frozenColumn: firstColumn.frozen,
    };
    for (const row of mergeRows) for (const column of mergeColumns) occupied.set(keyFor(row.index, column.index), cell);
  }
  const cells: OriginalGridLayoutCell[][] = [];
  const byCoordinate = new Map<string, OriginalGridLayoutCell>();
  for (const row of rows) {
    const rendered: OriginalGridLayoutCell[] = [];
    for (const column of columns) {
      const merged = occupied.get(keyFor(row.index, column.index));
      const cell: OriginalGridLayoutCell = merged || {
        row: row.index, column: column.index, sourceRow: row.index, sourceColumn: column.index,
        endRow: row.index + 1, endColumn: column.index + 1,
        rowSpan: 1, columnSpan: 1, width: column.size, height: row.size, top: row.offset, left: column.offset,
        frozenRow: row.frozen, frozenColumn: column.frozen,
      };
      byCoordinate.set(keyFor(row.index, column.index), cell);
      if (!merged || (merged.row === row.index && merged.column === column.index)) rendered.push(cell);
    }
    cells.push(rendered);
  }
  return { rows, columns, cells, byCoordinate, width, height, frozenWidth: columns.filter(column => column.frozen).reduce((total, column) => total + column.size, 0), frozenHeight: rows.filter(row => row.frozen).reduce((total, row) => total + row.size, 0) };
}

function color(value: OriginalGridColor | undefined): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const channel = (number: unknown) => Math.round(bounded(number, 0, 0, 1) * 255);
  return `rgba(${channel(value.red)}, ${channel(value.green)}, ${channel(value.blue)}, ${bounded(value.alpha, 1, 0, 1)})`;
}

function border(value: OriginalGridBorder | undefined, zoom: number): string | undefined {
  if (!value) return undefined;
  if (value.style === "NONE") return "0px solid transparent";
  const styles: Record<string, [string, number]> = { DOTTED: ["dotted", 1], DASHED: ["dashed", 1], SOLID: ["solid", 1], SOLID_MEDIUM: ["solid", 2], SOLID_THICK: ["solid", 3], DOUBLE: ["double", 3] };
  const style = styles[value.style || ""];
  if (!style) return undefined;
  return `${bounded(value.width, style[1], 0, 10) * zoom}px ${style[0]} ${color(value.color) || "#000"}`;
}

function textFormat(format: OriginalGridTextFormat | undefined, zoom: number): CSSProperties {
  if (!format) return {};
  const decoration = [format.underline ? "underline" : "", format.strikethrough ? "line-through" : ""].filter(Boolean).join(" ");
  return {
    // Google Sheets font sizes are points, not CSS pixels. No external font is loaded.
    fontFamily: typeof format.fontFamily === "string" && format.fontFamily.length <= 150 ? format.fontFamily : undefined,
    fontSize: format.fontSize === undefined ? undefined : `${bounded(format.fontSize, 10, 1, 400) * zoom}pt`,
    fontWeight: format.bold === undefined ? undefined : format.bold ? 700 : 400,
    fontStyle: format.italic === undefined ? undefined : format.italic ? "italic" : "normal",
    textDecoration: decoration || (format.underline === false || format.strikethrough === false ? "none" : undefined),
    color: color(format.foregroundColor),
  };
}

export function originalGridFormatStyle(format: OriginalGridFormat | undefined, zoom = 1): CSSProperties {
  return {
    backgroundColor: color(format?.backgroundColor) || "#fff",
    borderTop: border(format?.borders?.top, zoom), borderRight: border(format?.borders?.right, zoom),
    borderBottom: border(format?.borders?.bottom, zoom), borderLeft: border(format?.borders?.left, zoom),
  };
}

/** A merged range's far edges may be stored on its last source row/column. */
export function originalGridMergedFormat(grid: Grid, item: OriginalGridLayoutCell): OriginalGridFormat | undefined {
  const format = grid.cells[item.sourceRow]?.[item.sourceColumn]?.format;
  if (item.endRow === item.sourceRow + 1 && item.endColumn === item.sourceColumn + 1) return format;
  return { ...format, borders: {
    ...format?.borders,
    right: grid.cells[item.sourceRow]?.[item.endColumn - 1]?.format?.borders?.right || format?.borders?.right,
    bottom: grid.cells[item.endRow - 1]?.[item.sourceColumn]?.format?.borders?.bottom || format?.borders?.bottom,
  } };
}

function SourceText({ cell, zoom }: { cell: OriginalGridCell; zoom: number }) {
  const text = typeof cell.text === "string" ? cell.text : "";
  const runs = (cell.runs || []).filter(run => Number.isSafeInteger(run.startIndex) && run.startIndex >= 0 && run.startIndex < text.length).slice().sort((a, b) => a.startIndex - b.startIndex);
  if (!runs.length) return <>{text}</>;
  return <>{runs[0].startIndex > 0 && text.slice(0, runs[0].startIndex)}{runs.map((run, index) => <span key={`${run.startIndex}-${index}`} style={textFormat(run.format, zoom)}>{text.slice(run.startIndex, runs[index + 1]?.startIndex ?? text.length)}</span>)}</>;
}

function contentStyle(format: OriginalGridFormat | undefined, zoom: number): CSSProperties {
  const alignment: Record<string, CSSProperties["textAlign"]> = { LEFT: "left", CENTER: "center", RIGHT: "right" };
  const vertical: Record<string, CSSProperties["justifyContent"]> = { TOP: "flex-start", MIDDLE: "center", BOTTOM: "flex-end" };
  return {
    ...textFormat(format?.textFormat, zoom), fontSize: textFormat(format?.textFormat, zoom).fontSize || `${10 * zoom}pt`,
    paddingTop: bounded(format?.padding?.top, 2, 0, 100) * zoom, paddingRight: bounded(format?.padding?.right, 3, 0, 100) * zoom,
    paddingBottom: bounded(format?.padding?.bottom, 2, 0, 100) * zoom, paddingLeft: bounded(format?.padding?.left, 3, 0, 100) * zoom,
    textAlign: alignment[format?.horizontalAlignment || ""] || "left", justifyContent: vertical[format?.verticalAlignment || ""] || "flex-end",
    whiteSpace: format?.wrapStrategy === "WRAP" ? "pre-wrap" : "pre",
    overflowWrap: format?.wrapStrategy === "WRAP" ? "anywhere" : "normal",
  };
}

/** A read-only original-cell renderer: no aliases, parsing, status inference, formula execution or I/O. */
export default function OriginalRateGrid({ grid, zoom: requestedZoom = 1, onCellSelect }: OriginalRateGridProps) {
  const zoom = bounded(requestedZoom, 1, .5, 2);
  const layout = useMemo(() => buildOriginalGridLayout(grid), [grid]);
  const viewport = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ sheetId: number; key: string } | null>(null);
  const selected = selection?.sheetId === grid.sheet.sheetId && layout.byCoordinate.has(selection.key) ? selection.key : "";
  const firstCell = layout.cells.find(row => row.length)?.[0];
  const selectedOrFirst = selected || (firstCell ? keyFor(firstCell.row, firstCell.column) : "");
  const gutterWidth = ROW_GUTTER * zoom, gutterHeight = COLUMN_GUTTER * zoom;
  const getCell = (item: OriginalGridLayoutCell) => grid.cells[item.sourceRow]?.[item.sourceColumn] || EMPTY_CELL;

  function overflowSpace(item: OriginalGridLayoutCell, cell: OriginalGridCell) {
    if (["WRAP", "CLIP"].includes(cell.format?.wrapStrategy || "") || item.rowSpan !== 1 || item.columnSpan !== 1 || !cell.text || cell.format?.textRotation) return { left: 0, right: 0 };
    const columnIndex = layout.columns.findIndex(column => column.index === item.column);
    const alignment = cell.format?.horizontalAlignment || "LEFT";
    const space = (step: -1 | 1) => {
      let total = 0;
      for (let index = columnIndex + step; index >= 0 && index < layout.columns.length; index += step) {
        const column = layout.columns[index], next = layout.byCoordinate.get(keyFor(item.row, column.index));
        // Overflow may enter empty cells, but not a merged cell or the frozen pane.
        if (!next || next.rowSpan !== 1 || next.columnSpan !== 1 || next.frozenColumn !== item.frozenColumn || getCell(next).text !== "") break;
        total += column.size;
      }
      return total;
    };
    return { left: alignment === "RIGHT" || alignment === "CENTER" ? space(-1) : 0, right: alignment === "LEFT" || alignment === "CENTER" ? space(1) : 0 };
  }

  function select(item: OriginalGridLayoutCell, focus = false) {
    setSelection({ sheetId: grid.sheet.sheetId, key: keyFor(item.row, item.column) });
    onCellSelect?.(item.sourceRow, item.sourceColumn, getCell(item));
    if (focus) {
      const scroller = viewport.current;
      if (!scroller) return;
      scroller.querySelector<HTMLElement>(`[data-grid-coordinate="${keyFor(item.row, item.column)}"]`)?.focus({ preventScroll: true });
      if (!item.frozenColumn) {
        const left = (item.left - layout.frozenWidth) * zoom;
        const right = gutterWidth + (item.left + item.width) * zoom - scroller.clientWidth;
        if (scroller.scrollLeft > left) scroller.scrollLeft = left;
        else if (scroller.scrollLeft < right) scroller.scrollLeft = Math.min(right, left);
      }
      if (!item.frozenRow) {
        const top = (item.top - layout.frozenHeight) * zoom;
        const bottom = gutterHeight + (item.top + item.height) * zoom - scroller.clientHeight;
        if (scroller.scrollTop > top) scroller.scrollTop = top;
        else if (scroller.scrollTop < bottom) scroller.scrollTop = Math.min(bottom, top);
      }
    }
  }

  function navigate(event: KeyboardEvent<HTMLTableCellElement>, item: OriginalGridLayoutCell) {
    if (event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    let rowIndex = layout.rows.findIndex(row => row.index === item.row), columnIndex = layout.columns.findIndex(column => column.index === item.column);
    if (event.key === "ArrowUp") rowIndex--;
    if (event.key === "ArrowDown") rowIndex += item.rowSpan;
    if (event.key === "ArrowLeft") columnIndex--;
    if (event.key === "ArrowRight") columnIndex += item.columnSpan;
    if (event.key === "Home") { columnIndex = 0; if (event.ctrlKey || event.metaKey) rowIndex = 0; }
    if (event.key === "End") { columnIndex = layout.columns.length - 1; if (event.ctrlKey || event.metaKey) rowIndex = layout.rows.length - 1; }
    event.preventDefault();
    const row = layout.rows[Math.max(0, Math.min(layout.rows.length - 1, rowIndex))], column = layout.columns[Math.max(0, Math.min(layout.columns.length - 1, columnIndex))];
    const target = row && column ? layout.byCoordinate.get(keyFor(row.index, column.index)) : undefined;
    if (target) select(target, true);
  }

  if (layout.error) return <div className="original-rate-grid original-rate-grid-empty" role="alert">{layout.error}</div>;
  if (!layout.rows.length || !layout.columns.length) return <div className="original-rate-grid original-rate-grid-empty">此页没有可见单元格</div>;

  return <div className="original-rate-grid" data-sheet-id={grid.sheet.sheetId} data-zoom={zoom}>
    <div className="original-rate-grid-viewport" ref={viewport} tabIndex={0} role="region" aria-label={`${grid.sheet.title} 原始表格，可横向及纵向滚动`}
      style={{ scrollPaddingLeft: gutterWidth + layout.frozenWidth * zoom, scrollPaddingTop: gutterHeight + layout.frozenHeight * zoom }}>
      <table className="original-rate-grid-table" aria-label={`${grid.sheet.title} 原表`} style={{ width: (layout.width + ROW_GUTTER) * zoom }}>
        <colgroup><col style={{ width: gutterWidth }} />{layout.columns.map(column => <col key={column.index} style={{ width: column.size * zoom }} />)}</colgroup>
        <thead><tr style={{ height: gutterHeight }}>
          <th className="original-rate-grid-corner" aria-label="原表行列坐标" style={{ width: gutterWidth, height: gutterHeight }} />
          {layout.columns.map(column => <th key={column.index} scope="col" className="original-rate-grid-column" data-source-column={column.index}
            style={{ width: column.size * zoom, height: gutterHeight, fontSize: 11 * zoom, ...(column.frozen ? { left: gutterWidth + column.offset * zoom, zIndex: 7 } : {}) }}>{originalGridColumnLabel(column.index)}</th>)}
        </tr></thead>
        <tbody>{layout.rows.map((row, rowIndex) => <tr key={row.index} data-source-row={row.index} style={{ height: row.size * zoom }}>
          <th scope="row" className="original-rate-grid-row" style={{ width: gutterWidth, height: row.size * zoom, fontSize: 11 * zoom, ...(row.frozen ? { top: gutterHeight + row.offset * zoom, zIndex: 7 } : {}) }}>{row.index + 1}</th>
          {layout.cells[rowIndex].map(item => {
            const cell = getCell(item), coordinate = keyFor(item.row, item.column), address = `${originalGridColumnLabel(item.sourceColumn)}${item.sourceRow + 1}`;
            const rotation = cell.format?.textRotation;
            const overflow = overflowSpace(item, cell);
            // Centered text must retain its center at the original cell, not the enlarged spill area.
            const spillLeft = cell.format?.horizontalAlignment === "CENTER" ? Math.min(overflow.left, overflow.right) : overflow.left;
            const spillRight = cell.format?.horizontalAlignment === "CENTER" ? Math.min(overflow.left, overflow.right) : overflow.right;
            const rotated: CSSProperties = rotation?.vertical ? { writingMode: "vertical-rl", textOrientation: "upright" } : rotation?.angle ? { transform: `rotate(${-bounded(rotation.angle, 0, -90, 90)}deg)` } : {};
            return <td key={coordinate} rowSpan={item.rowSpan > 1 ? item.rowSpan : undefined} colSpan={item.columnSpan > 1 ? item.columnSpan : undefined}
              data-cell={address} data-grid-coordinate={coordinate} data-selected={selected === coordinate || undefined}
              data-frozen-row={item.frozenRow || undefined} data-frozen-column={item.frozenColumn || undefined}
              tabIndex={coordinate === selectedOrFirst ? 0 : -1} aria-label={address}
              onClick={() => select(item)} onFocus={() => { if (selected !== coordinate) select(item); }} onKeyDown={event => navigate(event, item)}
              style={{ ...originalGridFormatStyle(originalGridMergedFormat(grid, item), zoom), width: item.width * zoom, height: item.height * zoom,
                ...(item.frozenRow || item.frozenColumn ? { position: "sticky", zIndex: item.frozenRow && item.frozenColumn ? 6 : item.frozenRow ? 4 : 2 } : {}),
                ...(item.frozenRow ? { top: gutterHeight + item.top * zoom } : {}), ...(item.frozenColumn ? { left: gutterWidth + item.left * zoom } : {}) }}>
              <div className="original-rate-grid-cell-content" style={{ ...contentStyle(cell.format, zoom), left: -spillLeft * zoom, right: -spillRight * zoom }}><div className="original-rate-grid-cell-text" style={rotated}><SourceText cell={cell} zoom={zoom} /></div></div>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
