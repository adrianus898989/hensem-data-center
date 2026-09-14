import { DashboardDataAccessError, requireDashboardAllData, requireDashboardDataAccess } from "./dashboardDataAccessServer";
import type { OriginalGridCell, OriginalGridFormat, OriginalGridTextFormat, OriginalRateGrid, OriginalRateSheetMeta, OriginalRateWorkbookMeta } from "./originalRateGridTypes";

// Presentation-only database snapshot reader. No source credentials, source
// network connection, process cache, synchronization trigger or fee calculation.
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 512;
const MAX_CELLS = 250_000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_SHEET_ID = 2_147_483_647;
type ObjectValue = Record<string, unknown>;

function unavailable(code = "original_sheet_unavailable", status = 503, message = "原表快照读取暂时不可用，请稍后重试。") {
  return new DashboardDataAccessError(status, code, message);
}
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown, maximum = MAX_SHEET_ID): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}
function requireShape(condition: unknown): asserts condition {
  if (!condition) throw unavailable("original_sheet_snapshot_invalid");
}
function subset(value: ObjectValue, keys: readonly string[]): ObjectValue {
  return Object.fromEntries(keys.filter(key => Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]]));
}
function textFormat(value: unknown): OriginalGridTextFormat | undefined {
  if (value === undefined) return undefined;
  requireShape(object(value));
  const out = subset(value, ["fontFamily", "fontSize", "bold", "italic", "strikethrough", "underline"]);
  if (value.foregroundColor !== undefined) {
    requireShape(object(value.foregroundColor)); out.foregroundColor = subset(value.foregroundColor, ["red", "green", "blue", "alpha"]);
  }
  return out as OriginalGridTextFormat;
}
function format(value: unknown): OriginalGridFormat | undefined {
  if (value === undefined) return undefined;
  requireShape(object(value));
  const out = subset(value, ["horizontalAlignment", "verticalAlignment", "wrapStrategy"]);
  out.textFormat = textFormat(value.textFormat);
  for (const [key, keys] of [["backgroundColor", ["red", "green", "blue", "alpha"]], ["padding", ["top", "right", "bottom", "left"]], ["textRotation", ["angle", "vertical"]]] as const) {
    if (value[key] !== undefined) { requireShape(object(value[key])); out[key] = subset(value[key], keys); }
  }
  if (value.borders !== undefined) {
    requireShape(object(value.borders)); const borders: ObjectValue = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const source = value.borders[side]; if (source === undefined) continue;
      requireShape(object(source)); const border = subset(source, ["style", "width"]);
      if (source.color !== undefined) { requireShape(object(source.color)); border.color = subset(source.color, ["red", "green", "blue", "alpha"]); }
      borders[side] = border;
    }
    out.borders = borders;
  }
  return out as OriginalGridFormat;
}
function cell(value: unknown): OriginalGridCell {
  requireShape(object(value) && typeof value.text === "string");
  const text = value.text;
  const out: OriginalGridCell = { text, ...(value.format !== undefined ? { format: format(value.format) } : {}) };
  if (value.runs !== undefined) {
    requireShape(Array.isArray(value.runs));
    out.runs = value.runs.map(run => {
      requireShape(object(run) && integer(run.startIndex, text.length));
      return { startIndex: run.startIndex, ...(run.format !== undefined ? { format: textFormat(run.format) } : {}) };
    });
  }
  return out;
}
function sheet(value: unknown): OriginalRateSheetMeta {
  requireShape(object(value) && integer(value.sheetId) && typeof value.title === "string" && value.title.length > 0 && value.title.length <= 1000
    && integer(value.index) && integer(value.rowCount, MAX_ROWS) && value.rowCount > 0 && integer(value.columnCount, MAX_COLUMNS) && value.columnCount > 0
    && integer(value.frozenRowCount, value.rowCount) && integer(value.frozenColumnCount, value.columnCount) && value.hidden !== true);
  return { sheetId: value.sheetId, title: value.title, index: value.index, rowCount: value.rowCount, columnCount: value.columnCount,
    frozenRowCount: value.frozenRowCount, frozenColumnCount: value.frozenColumnCount, ...(value.hidden === false ? { hidden: false } : {}) };
}
function metadata(value: unknown): OriginalRateWorkbookMeta {
  requireShape(object(value) && typeof value.title === "string" && timestamp(value.fetchedAt) && Array.isArray(value.sheets) && value.sheets.length > 0 && value.sheets.length <= 64);
  const sheets = value.sheets.map(sheet);
  requireShape(new Set(sheets.map(item => item.sheetId)).size === sheets.length);
  return { title: value.title, fetchedAt: value.fetchedAt, sheets };
}
function grid(value: unknown, sheetId: number): OriginalRateGrid {
  requireShape(object(value));
  const meta = sheet(value.sheet);
  requireShape(meta.sheetId === sheetId && timestamp(value.fetchedAt)
    && integer(value.rowCount, meta.rowCount) && value.rowCount > 0 && integer(value.columnCount, meta.columnCount) && value.columnCount > 0 && value.rowCount * value.columnCount <= MAX_CELLS);
  const rowCount = value.rowCount, columnCount = value.columnCount;
  requireShape(Array.isArray(value.cells) && value.cells.length === rowCount);
  const cells = value.cells.map(row => { requireShape(Array.isArray(row) && row.length === columnCount); return row.map(cell); });
  const dimensions = (input: unknown, length: number): number[] => {
    requireShape(Array.isArray(input) && input.length === length && input.every(size => typeof size === "number" && Number.isFinite(size) && size >= 0 && size <= 10000));
    return input as number[];
  };
  const hidden = (input: unknown, length: number): number[] => {
    requireShape(Array.isArray(input) && input.every(index => integer(index, length - 1)) && new Set(input).size === input.length); return input as number[];
  };
  requireShape(Array.isArray(value.merges) && value.merges.length <= MAX_CELLS);
  const merges = value.merges.map(merge => {
    requireShape(object(merge) && integer(merge.startRowIndex, rowCount - 1) && integer(merge.endRowIndex, rowCount) && merge.endRowIndex > merge.startRowIndex
      && integer(merge.startColumnIndex, columnCount - 1) && integer(merge.endColumnIndex, columnCount) && merge.endColumnIndex > merge.startColumnIndex);
    return { startRowIndex: merge.startRowIndex, endRowIndex: merge.endRowIndex, startColumnIndex: merge.startColumnIndex, endColumnIndex: merge.endColumnIndex };
  });
  return { sheet: meta, cells, merges, rowHeights: dimensions(value.rowHeights, rowCount), columnWidths: dimensions(value.columnWidths, columnCount),
    hiddenRows: hidden(value.hiddenRows, rowCount), hiddenColumns: hidden(value.hiddenColumns, columnCount), fetchedAt: value.fetchedAt, rowCount, columnCount };
}
function databaseConfig() {
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  let url: URL; try { url = new URL(base); } catch { throw unavailable(); }
  if (!anonKey || url.protocol !== "https:" || url.origin !== base || url.username || url.password) throw unavailable();
  return { base, anonKey };
}

export async function readOriginalRateSheet(request: Request): Promise<OriginalRateWorkbookMeta | OriginalRateGrid> {
  // Read a fresh authenticated profile/module/all-data grant on every Request.
  // The database RPC separately enforces RLS against the same current user JWT.
  const access = await requireDashboardDataAccess(request, "third_party");
  requireDashboardAllData(access);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== "sheetId") || params.getAll("sheetId").length > 1) throw unavailable("invalid_original_sheet_request", 400, "原表请求参数无效。");
  const input = params.get("sheetId");
  if (input !== null && (!/^(0|[1-9]\d{0,9})$/.test(input) || Number(input) > MAX_SHEET_ID)) throw unavailable("invalid_original_sheet_request", 400, "原表页签参数无效。");
  const sheetId = input === null ? null : Number(input);
  try {
    const { base, anonKey } = databaseConfig();
    request.signal.throwIfAborted();
    const response = await fetch(`${base}/rest/v1/rpc/dashboard_original_rate_sheet`, {
      method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${access.token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ p_sheet_id: sheetId }), cache: "no-store", redirect: "error", credentials: "omit", signal: request.signal,
    });
    if (response.status === 401) throw unavailable("login_required", 401, "登录已失效，请重新登录。");
    if (response.status === 403) throw unavailable("data_denied", 403, "当前账号没有此数据查看权限。");
    if (!response.ok) throw unavailable();
    const size = Number(response.headers.get("content-length"));
    if (size > MAX_BYTES) throw unavailable("original_sheet_too_large", 413, "原表快照超过完整读取上限；未省略数据。");
    const body = await response.text();
    request.signal.throwIfAborted();
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) throw unavailable("original_sheet_too_large", 413, "原表快照超过完整读取上限；未省略数据。");
    const value: unknown = JSON.parse(body);
    if (value === null) throw sheetId === null
      ? unavailable("original_sheet_snapshot_not_synced", 503, "原表快照尚未同步，请稍后重试。")
      : unavailable("original_sheet_not_found", 404, "此原表页签不存在或快照尚未同步。");
    return sheetId === null ? metadata(value) : grid(value, sheetId);
  } catch (error) {
    if (error instanceof DashboardDataAccessError) throw error;
    // Never expose upstream response bodies, request credentials or URLs.
    throw unavailable();
  }
}
