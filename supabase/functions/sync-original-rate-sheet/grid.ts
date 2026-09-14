import type { OriginalGridBorder, OriginalGridCell, OriginalGridColor, OriginalGridFormat, OriginalGridMerge, OriginalGridTextFormat, OriginalRateGrid, OriginalRateSheetMeta, OriginalRateWorkbookMeta } from "./types.ts";

type Native = Record<string, any>;
export type OriginalWorkbook = { meta: OriginalRateWorkbookMeta; nativeSheets: Map<number, Native>; defaultFormat: Native; theme: Map<string, OriginalGridColor> };
type Workbook = OriginalWorkbook;
export type GoogleRead = (url: string) => Promise<Native>;
const MAX_SCAN_CELLS = 250_000, MAX_ROWS = 10_000, MAX_COLUMNS = 512, MAX_SHEETS = 64;
const METADATA_FIELDS = "properties(title,defaultFormat,spreadsheetTheme),sheets(properties(sheetId,title,index,hidden,sheetType,gridProperties),merges)";
const GRID_FIELDS = "sheets(properties(sheetId,title,index,hidden,sheetType,gridProperties),merges,data(startRow,startColumn,rowData(values(formattedValue,effectiveValue,effectiveFormat,textFormatRuns)),rowMetadata(pixelSize,hiddenByUser,hiddenByFilter),columnMetadata(pixelSize,hiddenByUser,hiddenByFilter)))";
export class OriginalGridReadError extends Error {
  constructor(readonly code: string, readonly status = 503, message = "原表读取暂时不可用。") { super(message); }
}
function sourceError(code = "original_sheet_unavailable", status = 503, message = "原表读取暂时不可用。") { return new OriginalGridReadError(code, status, message); }
function assertSize(rows: number, columns: number): void {
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 1 || columns < 1) throw sourceError();
  if (rows > MAX_ROWS || columns > MAX_COLUMNS || rows * columns > MAX_SCAN_CELLS) {
    throw sourceError("original_sheet_too_large", 413, "原表范围超过当前完整读取上限；未截断或省略数据，请联系管理员调整读取方式。");
  }
}
function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
function columnName(count: number): string {
  let out = "";
  for (let n = count; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out;
  return out;
}
function nativeRange(title: string, rows: number, columns: number): string {
  return `'${title.replace(/'/g, "''")}'!A1:${columnName(columns)}${rows}`;
}

function rgb(value: unknown): OriginalGridColor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const color: OriginalGridColor = {};
  for (const key of ["red", "green", "blue", "alpha"] as const) {
    const component = (value as Native)[key];
    if (typeof component === "number" && Number.isFinite(component)) color[key] = component;
  }
  return color; // {} is a valid Google RGB color: black, not missing.
}
function color(value: unknown, style: Native | undefined, theme: Map<string, OriginalGridColor>): OriginalGridColor | undefined {
  return rgb(style?.rgbColor) || (style?.themeColor ? theme.get(style.themeColor) : undefined) || rgb(value);
}
function textFormat(raw: Native | undefined, theme: Map<string, OriginalGridColor>): OriginalGridTextFormat | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: OriginalGridTextFormat = {};
  if (typeof raw.fontFamily === "string") out.fontFamily = raw.fontFamily;
  if (typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)) out.fontSize = raw.fontSize;
  for (const key of ["bold", "italic", "underline", "strikethrough"] as const) if (typeof raw[key] === "boolean") out[key] = raw[key];
  const foreground = color(raw.foregroundColor, raw.foregroundColorStyle, theme);
  if (foreground) out.foregroundColor = foreground;
  // Explicit allowlist omits hyperlink URLs and other non-presentation fields.
  return out;
}
function cellFormat(raw: Native, fallback: Native, theme: Map<string, OriginalGridColor>): OriginalGridFormat {
  const merged: Native = { ...fallback, ...raw, textFormat: { ...fallback.textFormat, ...raw.textFormat } };
  // A concrete cell color overrides a default theme ColorStyle as well as its
  // RGB fallback; keep the default style only when the cell has no color.
  if (raw.backgroundColor !== undefined && raw.backgroundColorStyle === undefined) delete merged.backgroundColorStyle;
  if (raw.textFormat?.foregroundColor !== undefined && raw.textFormat?.foregroundColorStyle === undefined) delete merged.textFormat.foregroundColorStyle;
  const out: OriginalGridFormat = {};
  const background = color(merged.backgroundColor, merged.backgroundColorStyle, theme);
  if (background) out.backgroundColor = background;
  out.textFormat = textFormat(merged.textFormat, theme);
  for (const key of ["horizontalAlignment", "verticalAlignment", "wrapStrategy"] as const) if (typeof merged[key] === "string") out[key] = merged[key];
  if (merged.padding && typeof merged.padding === "object") {
    out.padding = {};
    for (const side of ["top", "right", "bottom", "left"] as const) if (typeof merged.padding[side] === "number" && Number.isFinite(merged.padding[side])) out.padding[side] = merged.padding[side];
  }
  if (merged.textRotation && typeof merged.textRotation === "object") {
    out.textRotation = {};
    if (typeof merged.textRotation.angle === "number" && Number.isFinite(merged.textRotation.angle)) out.textRotation.angle = merged.textRotation.angle;
    if (typeof merged.textRotation.vertical === "boolean") out.textRotation.vertical = merged.textRotation.vertical;
  }
  if (merged.borders && typeof merged.borders === "object") {
    out.borders = {};
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const source = merged.borders[side];
      if (!source || typeof source !== "object") continue;
      const border: OriginalGridBorder = {};
      if (typeof source.style === "string") border.style = source.style;
      if (typeof source.width === "number" && Number.isFinite(source.width)) border.width = source.width;
      const borderColor = color(source.color, source.colorStyle, theme);
      if (borderColor) border.color = borderColor;
      out.borders[side] = border;
    }
  }
  return out;
}
function cell(raw: Native | undefined, workbook: Workbook): OriginalGridCell {
  const text = typeof raw?.formattedValue === "string" ? raw.formattedValue : "";
  const format = cellFormat(raw?.effectiveFormat || {}, workbook.defaultFormat, workbook.theme);
  // Google AUTO alignment uses the effective value's type, never a guess made
  // from a formatted string (e.g. numeric-looking platform names remain text).
  if (!format.horizontalAlignment || format.horizontalAlignment === "HORIZONTAL_ALIGN_UNSPECIFIED") {
    format.horizontalAlignment = typeof raw?.effectiveValue?.numberValue === "number" ? "RIGHT" : typeof raw?.effectiveValue?.boolValue === "boolean" ? "CENTER" : "LEFT";
  }
  const out: OriginalGridCell = { text, format };
  if (Array.isArray(raw?.textFormatRuns)) {
    out.runs = raw.textFormatRuns.filter((run: Native) => Number.isInteger(run.startIndex ?? 0) && (run.startIndex ?? 0) >= 0 && (run.startIndex ?? 0) <= text.length)
      .map((run: Native) => ({ startIndex: run.startIndex ?? 0, format: textFormat(run.format, workbook.theme) }));
  }
  return out;
}
function sheetMeta(native: Native): OriginalRateSheetMeta {
  const p = native.properties || {}, grid = p.gridProperties || {};
  if (!Number.isInteger(p.sheetId) || p.sheetId < 0 || typeof p.title !== "string" || !p.title) throw sourceError();
  return { sheetId: p.sheetId, title: p.title, index: integer(p.index), rowCount: integer(grid.rowCount), columnCount: integer(grid.columnCount), frozenRowCount: integer(grid.frozenRowCount), frozenColumnCount: integer(grid.frozenColumnCount), hidden: p.hidden === true };
}
function sourceMerges(native: Native, sheet: OriginalRateSheetMeta): OriginalGridMerge[] {
  if (!Array.isArray(native.merges)) return [];
  return native.merges.map((merge: Native) => {
    const out = { startRowIndex: integer(merge.startRowIndex), endRowIndex: integer(merge.endRowIndex), startColumnIndex: integer(merge.startColumnIndex), endColumnIndex: integer(merge.endColumnIndex) };
    if (out.endRowIndex <= out.startRowIndex || out.endColumnIndex <= out.startColumnIndex || out.endRowIndex > sheet.rowCount || out.endColumnIndex > sheet.columnCount) throw sourceError();
    return out;
  });
}

function googleUrl(spreadsheetId: string, suffix = "", params: Record<string, string> = {}): string {
  const url = new URL("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(spreadsheetId) + suffix);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
export async function readOriginalWorkbook(read: GoogleRead, spreadsheetId: string, now: () => number = Date.now): Promise<OriginalWorkbook> {
  const native = await read(googleUrl(spreadsheetId, "", { fields: METADATA_FIELDS }));
  if (!Array.isArray(native.sheets) || native.sheets.length > MAX_SHEETS) throw sourceError("original_sheet_too_large", 413);
  const visible = native.sheets.filter((sheet: Native) => sheet.properties?.hidden !== true && (!sheet.properties?.sheetType || sheet.properties.sheetType === "GRID"));
  const sheets = visible.map(sheetMeta).sort((a: OriginalRateSheetMeta, b: OriginalRateSheetMeta) => a.index - b.index);
  if (!sheets.length || new Set(sheets.map((sheet: OriginalRateSheetMeta) => sheet.sheetId)).size !== sheets.length) throw sourceError();
  for (const sheet of sheets) assertSize(sheet.rowCount, sheet.columnCount);
  const theme = new Map<string, OriginalGridColor>();
  for (const item of native.properties?.spreadsheetTheme?.themeColors || []) {
    const resolved = rgb(item.color?.rgbColor);
    if (typeof item.colorType === "string" && resolved) theme.set(item.colorType, resolved);
  }
  return { meta: { title: String(native.properties?.title || ""), sheets, fetchedAt: new Date(now()).toISOString() }, nativeSheets: new Map(visible.map((sheet: Native) => [sheet.properties.sheetId, sheet])), defaultFormat: native.properties?.defaultFormat || {}, theme };
}
export async function readOriginalGrid(read: GoogleRead, spreadsheetId: string, sheetId: number, workbook: OriginalWorkbook, now: () => number = Date.now): Promise<OriginalRateGrid> {
  const sheet = workbook.meta.sheets.find(item => item.sheetId === sheetId);
  const native = workbook.nativeSheets.get(sheetId);
  if (!sheet || !native) throw sourceError("original_sheet_not_found", 404);
  assertSize(sheet.rowCount, sheet.columnCount);
  const valuesResponse = await read(googleUrl(spreadsheetId, "/values/" + encodeURIComponent(nativeRange(sheet.title, sheet.rowCount, sheet.columnCount)), { valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" }));
  const values = valuesResponse.values || [];
  let rows = Math.max(1, sheet.frozenRowCount), columns = Math.max(1, sheet.frozenColumnCount);
  values.forEach((row: unknown[], rowIndex: number) => row.forEach((value, columnIndex) => {
    if (value !== "" && value !== null && value !== undefined) { rows = Math.max(rows, rowIndex + 1); columns = Math.max(columns, columnIndex + 1); }
  }));
  for (const merge of sourceMerges(native, sheet)) { rows = Math.max(rows, merge.endRowIndex); columns = Math.max(columns, merge.endColumnIndex); }
  assertSize(rows, columns);
  const response = await read(googleUrl(spreadsheetId, "", { ranges: nativeRange(sheet.title, rows, columns), fields: GRID_FIELDS }));
  const responseSheet = response.sheets?.find((item: Native) => item.properties?.sheetId === sheetId) as Native | undefined;
  if (!responseSheet || responseSheet.properties?.hidden === true) throw sourceError("original_sheet_not_found", 404);
  const currentSheet = sheetMeta(responseSheet);
  const merges = sourceMerges(responseSheet, currentSheet);
  if (merges.some(merge => merge.endRowIndex > rows || merge.endColumnIndex > columns) || currentSheet.title !== sheet.title || currentSheet.rowCount < rows || currentSheet.columnCount < columns || currentSheet.frozenRowCount > rows || currentSheet.frozenColumnCount > columns) throw sourceError("original_sheet_changed");
  const cells = Array.from({ length: rows }, () => Array.from({ length: columns }, () => cell(undefined, workbook)));
  const rowHeights = Array(rows).fill(21) as number[], columnWidths = Array(columns).fill(100) as number[];
  const hiddenRows = new Set<number>(), hiddenColumns = new Set<number>();
  for (const block of responseSheet.data || []) {
    const startRow = integer(block.startRow), startColumn = integer(block.startColumn);
    for (const [offset, row] of (block.rowData || []).entries()) {
      if (startRow + offset >= rows) throw sourceError();
      for (const [columnOffset, raw] of (row.values || []).entries()) {
        if (startColumn + columnOffset >= columns) throw sourceError();
        cells[startRow + offset][startColumn + columnOffset] = cell(raw, workbook);
      }
    }
    for (const [offset, dimension] of (block.rowMetadata || []).entries()) {
      const index = startRow + offset; if (index >= rows) break;
      if (typeof dimension.pixelSize === "number" && Number.isFinite(dimension.pixelSize) && dimension.pixelSize >= 0) rowHeights[index] = dimension.pixelSize;
      if (dimension.hiddenByUser === true || dimension.hiddenByFilter === true) hiddenRows.add(index);
    }
    for (const [offset, dimension] of (block.columnMetadata || []).entries()) {
      const index = startColumn + offset; if (index >= columns) break;
      if (typeof dimension.pixelSize === "number" && Number.isFinite(dimension.pixelSize) && dimension.pixelSize >= 0) columnWidths[index] = dimension.pixelSize;
      if (dimension.hiddenByUser === true || dimension.hiddenByFilter === true) hiddenColumns.add(index);
    }
  }
  return { sheet: currentSheet, cells, merges, rowHeights, columnWidths, hiddenRows: [...hiddenRows].sort((a, b) => a - b), hiddenColumns: [...hiddenColumns].sort((a, b) => a - b), fetchedAt: new Date(now()).toISOString(), rowCount: rows, columnCount: columns };
}
