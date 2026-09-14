import { google } from "googleapis";
import { DashboardDataAccessError, requireDashboardAllData, requireDashboardDataAccess } from "./dashboardDataAccessServer";
import type { OriginalGridBorder, OriginalGridCell, OriginalGridColor, OriginalGridFormat, OriginalGridMerge, OriginalGridTextFormat, OriginalRateGrid, OriginalRateSheetMeta, OriginalRateWorkbookMeta } from "./originalRateGridTypes";

// Read-only presentation source, deliberately independent of the normalized
// rate parser, volume fee matching, and Supabase business snapshots.
const DEFAULT_SPREADSHEET_ID = "15vq88fo9AU0EXzheSkuIgN03RPsQLDT-5XzXkBf-cyA";
const CACHE_MS = 5 * 60 * 1000;
const MAX_SCAN_CELLS = 250_000;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 512;
const MAX_SHEETS = 64;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 12;
const MAX_IN_FLIGHT = 4;
const REQUEST_OPTIONS = { timeout: 15_000, retry: false };
const METADATA_FIELDS = "properties(title,defaultFormat,spreadsheetTheme),sheets(properties(sheetId,title,index,hidden,sheetType,gridProperties),merges)";
const GRID_FIELDS = "sheets(properties(sheetId,title,index,hidden,sheetType,gridProperties),merges,data(startRow,startColumn,rowData(values(formattedValue,effectiveValue,effectiveFormat,textFormatRuns)),rowMetadata(pixelSize,hiddenByUser,hiddenByFilter),columnMetadata(pixelSize,hiddenByUser,hiddenByFilter)))";

type Native = Record<string, any>;
type Workbook = { meta: OriginalRateWorkbookMeta; nativeSheets: Map<number, Native>; defaultFormat: Native; theme: Map<string, OriginalGridColor> };
type CacheEntry = { value: Workbook | OriginalRateGrid; expiresAt: number; bytes: number };
const sourceCache = new Map<string, CacheEntry>();
const sourceFlights = new Map<string, Promise<Workbook | OriginalRateGrid>>();

function sourceError(code = "original_sheet_unavailable", status = 503, message = "原表读取暂时不可用，请稍后重试。") {
  return new DashboardDataAccessError(status, code, message);
}
function assertSize(rows: number, columns: number): void {
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 1 || columns < 1) throw sourceError();
  if (rows > MAX_ROWS || columns > MAX_COLUMNS || rows * columns > MAX_SCAN_CELLS) {
    throw sourceError("original_sheet_too_large", 413, "原表范围超过当前完整读取上限；未截断或省略数据，请联系管理员调整读取方式。");
  }
}
function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
function sourceId(): string {
  // Match the existing rate reader's server-only alias precedence. A URL is
  // accepted solely as an official Google Sheets file reference; it is never
  // fetched directly and clients cannot select a spreadsheet or range.
  const configured = String(process.env.THIRD_PARTY_RATE_SHEET_ID || process.env.THIRD_PARTY_RATE_SPREADSHEET_ID || process.env.THIRD_PARTY_RATE_SHEET_URL || DEFAULT_SPREADSHEET_ID).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (/^[a-zA-Z0-9_-]{10,200}$/.test(configured)) return configured;
  try {
    const url = new URL(configured);
    const match = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,200})(?:\/(?:edit|view|preview|htmlview|copy))?\/?$/.exec(url.pathname);
    if (url.protocol === "https:" && url.hostname === "docs.google.com" && !url.port && !url.username && !url.password && match) return match[1];
  } catch { /* Return only the fixed configuration error below. */ }
  throw sourceError("original_sheet_not_configured", 503, "原表读取尚未配置，请联系管理员。");
}
function sheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKey) throw sourceError("original_sheet_not_configured", 503, "原表读取尚未配置，请联系管理员。");
  const auth = new google.auth.JWT({ email, key: privateKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n"), scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  return google.sheets({ version: "v4", auth });
}
function columnName(count: number): string {
  let out = "";
  for (let n = count; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out;
  return out;
}
function nativeRange(title: string, rows: number, columns: number): string {
  return `'${title.replace(/'/g, "''")}'!A1:${columnName(columns)}${rows}`;
}

async function cached<T extends Workbook | OriginalRateGrid>(key: string, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [entryKey, entry] of sourceCache) if (entry.expiresAt <= now) sourceCache.delete(entryKey);
  const hit = sourceCache.get(key);
  if (hit) {
    sourceCache.delete(key); sourceCache.set(key, hit);
    return hit.value as T;
  }
  const pending = sourceFlights.get(key);
  if (pending) return pending as Promise<T>;
  if (sourceFlights.size >= MAX_IN_FLIGHT) throw sourceError("original_sheet_busy", 503, "原表正在读取，请稍后重试。");
  const flight = (async () => {
    const value = await read();
    // Workbook metadata has a Map of native merges not included by JSON.stringify.
    const bytes = Buffer.byteLength(JSON.stringify(value instanceof Object && "nativeSheets" in value ? { ...value, nativeSheets: [...value.nativeSheets] } : value), "utf8");
    if (bytes > MAX_RESPONSE_BYTES) throw sourceError("original_sheet_too_large", 413, "原表内容超过当前完整读取上限；未截断或省略数据，请联系管理员调整读取方式。");
    let used = [...sourceCache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (sourceCache.size >= MAX_CACHE_ENTRIES || used + bytes > MAX_CACHE_BYTES) {
      const oldest = sourceCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      used -= sourceCache.get(oldest)!.bytes; sourceCache.delete(oldest);
    }
    sourceCache.set(key, { value, expiresAt: Date.now() + CACHE_MS, bytes });
    return value;
  })();
  sourceFlights.set(key, flight);
  try { return await flight; } finally { sourceFlights.delete(key); }
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
async function workbookSource(spreadsheetId: string): Promise<Workbook> {
  return cached(`${spreadsheetId}:metadata`, async () => {
    const response = await sheetsClient().spreadsheets.get({ spreadsheetId, fields: METADATA_FIELDS }, REQUEST_OPTIONS);
    const native = response.data as Native;
    if (!Array.isArray(native.sheets) || native.sheets.length > MAX_SHEETS) throw sourceError("original_sheet_too_large", 413, "原表页签数量超过当前完整读取上限；未省略页签。");
    const visible = native.sheets.filter((sheet: Native) => sheet.properties?.hidden !== true && (!sheet.properties?.sheetType || sheet.properties.sheetType === "GRID"));
    const sheets = visible.map(sheetMeta).sort((a: OriginalRateSheetMeta, b: OriginalRateSheetMeta) => a.index - b.index);
    if (!sheets.length || new Set(sheets.map((sheet: OriginalRateSheetMeta) => sheet.sheetId)).size !== sheets.length) throw sourceError();
    const theme = new Map<string, OriginalGridColor>();
    for (const item of native.properties?.spreadsheetTheme?.themeColors || []) {
      const resolved = rgb(item.color?.rgbColor);
      if (typeof item.colorType === "string" && resolved) theme.set(item.colorType, resolved);
    }
    return { meta: { title: String(native.properties?.title || ""), sheets, fetchedAt: new Date().toISOString() }, nativeSheets: new Map(visible.map((sheet: Native) => [sheet.properties.sheetId, sheet])), defaultFormat: native.properties?.defaultFormat || {}, theme };
  });
}

async function gridSource(spreadsheetId: string, sheetId: number, workbook: Workbook): Promise<OriginalRateGrid> {
  const sheet = workbook.meta.sheets.find(item => item.sheetId === sheetId);
  const native = workbook.nativeSheets.get(sheetId);
  if (!sheet || !native) throw sourceError("original_sheet_not_found", 404, "此原表页签不存在或不可查看。");
  // Include metadata revision so a renamed/reordered/resized tab cannot reuse
  // a grid cached under its previous structure after metadata refresh.
  return cached(`${spreadsheetId}:grid:${sheetId}:${workbook.meta.fetchedAt}`, async () => {
    assertSize(sheet.rowCount, sheet.columnCount);
    const client = sheetsClient();
    const valuesResponse = await client.spreadsheets.values.get({ spreadsheetId, range: nativeRange(sheet.title, sheet.rowCount, sheet.columnCount), valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" }, REQUEST_OPTIONS);
    const values = valuesResponse.data.values || [];
    let rows = Math.max(1, sheet.frozenRowCount), columns = Math.max(1, sheet.frozenColumnCount);
    values.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      // Do not collapse a true zero, spaces, internal blanks, or empty rows.
      if (value !== "" && value !== null && value !== undefined) { rows = Math.max(rows, rowIndex + 1); columns = Math.max(columns, columnIndex + 1); }
    }));
    for (const merge of sourceMerges(native, sheet)) { rows = Math.max(rows, merge.endRowIndex); columns = Math.max(columns, merge.endColumnIndex); }
    assertSize(rows, columns);
    const response = await client.spreadsheets.get({ spreadsheetId, ranges: [nativeRange(sheet.title, rows, columns)], fields: GRID_FIELDS }, REQUEST_OPTIONS);
    const responseSheet = response.data.sheets?.find(item => item.properties?.sheetId === sheetId) as Native | undefined;
    if (!responseSheet || responseSheet.properties?.hidden === true) throw sourceError("original_sheet_not_found", 404, "此原表页签不存在或不可查看。");
    const currentSheet = sheetMeta(responseSheet);
    const merges = sourceMerges(responseSheet, currentSheet);
    if (merges.some(merge => merge.endRowIndex > rows || merge.endColumnIndex > columns) || currentSheet.title !== sheet.title || currentSheet.rowCount < rows || currentSheet.columnCount < columns) {
      throw sourceError("original_sheet_changed", 503, "原表结构刚刚发生变化，请稍后重新读取。");
    }
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
    return { sheet: currentSheet, cells, merges, rowHeights, columnWidths, hiddenRows: [...hiddenRows].sort((a, b) => a - b), hiddenColumns: [...hiddenColumns].sort((a, b) => a - b), fetchedAt: new Date().toISOString(), rowCount: rows, columnCount: columns };
  });
}

export async function readOriginalRateSheet(request: Request): Promise<OriginalRateWorkbookMeta | OriginalRateGrid> {
  // Critical: verify a fresh user/profile/module/scope on EVERY request, before
  // reading metadata, service-account configuration, or any process cache.
  const access = await requireDashboardDataAccess(request, "third_party");
  requireDashboardAllData(access);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== "sheetId") || params.getAll("sheetId").length > 1) throw sourceError("invalid_original_sheet_request", 400, "原表请求参数无效。");
  const input = params.get("sheetId");
  if (input !== null && (!/^(0|[1-9]\d{0,9})$/.test(input) || Number(input) > 2_147_483_647)) throw sourceError("invalid_original_sheet_request", 400, "原表页签参数无效。");
  try {
    const spreadsheetId = sourceId();
    const workbook = await workbookSource(spreadsheetId);
    return input === null ? workbook.meta : await gridSource(spreadsheetId, Number(input), workbook);
  } catch (error) {
    // Never send Google response bodies, credential errors, source IDs, or
    // request configuration to the browser. No stale-success fallback.
    if (error instanceof DashboardDataAccessError) throw error;
    throw sourceError();
  }
}
