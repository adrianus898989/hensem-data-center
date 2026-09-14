import type { OriginalGridMerge, OriginalRateGrid } from './originalRateGridTypes';

// A read-only projection of source coordinates, not a fee parser or a rate map.
export type TidyColumn = {
  sourceColumn: number;
  label: string;
  group: 'identity' | 'collect' | 'payout' | 'platform' | 'other';
  kind: 'provider' | 'type' | 'fee' | 'status' | 'note' | 'other';
  compact: boolean;
  width: number;
  /** Last source anchor used by this column's header (parallel tables can differ). */
  headerSourceRow: number;
};
export type TidyModel = {
  columns: TidyColumn[];
  rows: number[];
  headerRows: number;
  providerColumn: number | null;
  typeColumn: number | null;
  platformColumns: number[];
};
export type TidySourceCell = { text: string; sourceRow: number; sourceColumn: number };

type SourceIndex = { rows: number; columns: number; anchors: Map<number, number>; merges: OriginalGridMerge[]; inputMerges: OriginalGridMerge[]; inputLength: number };
const sourceIndexes = new WeakMap<OriginalRateGrid, SourceIndex>();
const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const providerHeader = (value: string) => /^(?:三方(?:名称)?|代收三方|代付三方|支付三方|三方支付名称)$/.test(clean(value));
const typeHeader = (value: string) => /^(?:类型(?:\s*[/／]\s*钱包)?|钱包(?:类型)?|通道类型|收款类型|代收类型|业务类型)$/.test(clean(value));
const broadHeader = (value: string) => /^(?:使用盘口|接入平台|接入盘口|平台状态|平台|盘口|.{1,8}三方)$/.test(clean(value)) && !providerHeader(value);
const childHeader = (value: string) => /^(?:代收|代付|费率|手续费|单笔|范围|状态|最低|最高|最低限制|最高限制)$/.test(clean(value));
const noteHeader = (value: string) => /备注|原因|漏洞|白名单|授信|时间|群组|账号|账户|核对|升级|UTR|IFSC|结算|限额最高|公户|个人|非整数|转移资金/.test(value);
const statusHeader = (value: string) => /^(?:状态|整体状态|通道情况(?:状态)?|使用情况|使用状态|代收情况|代付情况|支持|不支持)$/.test(clean(value));

function sourceIndex(grid: OriginalRateGrid): SourceIndex {
  const cached = sourceIndexes.get(grid);
  if (cached && cached.rows === grid.rowCount && cached.columns === grid.columnCount && cached.inputMerges === grid.merges && cached.inputLength === grid.merges.length) return cached;
  const validSize = Number.isSafeInteger(grid.rowCount) && Number.isSafeInteger(grid.columnCount)
    && grid.rowCount > 0 && grid.rowCount <= 10_000 && grid.columnCount > 0 && grid.columnCount <= 512 && grid.rowCount * grid.columnCount <= 250_000;
  const rows = validSize ? grid.rowCount : 0, columns = validSize ? grid.columnCount : 0;
  const anchors = new Map<number, number>(), merges: OriginalGridMerge[] = [];
  for (const merge of (Array.isArray(grid.merges) ? grid.merges : []).slice(0, 10_000)) {
    const { startRowIndex: r, endRowIndex: re, startColumnIndex: c, endColumnIndex: ce } = merge;
    if (![r, re, c, ce].every(Number.isSafeInteger) || r < 0 || c < 0 || re <= r || ce <= c || re > rows || ce > columns) continue;
    if (merges.some(prior => r < prior.endRowIndex && re > prior.startRowIndex && c < prior.endColumnIndex && ce > prior.startColumnIndex)) continue;
    merges.push(merge);
    const anchor = r * columns + c;
    for (let row = r; row < re; row++) for (let column = c; column < ce; column++) anchors.set(row * columns + column, anchor);
  }
  const index = { rows, columns, anchors, merges, inputMerges: grid.merges, inputLength: grid.merges.length };
  sourceIndexes.set(grid, index);
  return index;
}

/** Returns the exact source text, including a hidden merged origin. Never fills blanks. */
export function tidySourceCell(grid: OriginalRateGrid, row: number, column: number): TidySourceCell {
  const index = sourceIndex(grid);
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || column < 0 || row >= index.rows || column >= index.columns) return { text: '', sourceRow: row, sourceColumn: column };
  const anchor = index.anchors.get(row * index.columns + column) ?? row * index.columns + column;
  const sourceRow = Math.floor(anchor / index.columns), sourceColumn = anchor % index.columns;
  const rawText = grid.cells[sourceRow]?.[sourceColumn]?.text;
  return { text: typeof rawText === 'string' ? rawText : '', sourceRow, sourceColumn };
}

/** Keep parallel-table data while masking cells that still belong to a header. */
export function tidyBodySourceCell(grid: OriginalRateGrid, row: number, column: TidyColumn, headerRows: number): TidySourceCell {
  const cell = tidySourceCell(grid, row, column.sourceColumn);
  return row < headerRows && cell.sourceRow <= column.headerSourceRow
    ? { text: '', sourceRow: row, sourceColumn: column.sourceColumn }
    : cell;
}

/** Styling only: a source switch is not evidence that any transaction has run. */
export function tidyStatusTone(text: string): 'good' | 'bad' | 'attention' | 'plain' {
  const status = clean(text).replace(/\s*(?:🟢|🔴|🟡|⭕|⛔|⚠️?|🛠️?|✅|❌|✔️?|✖️?)\s*$/, '').trim();
  if (/^(?:开启|已开启|开放|已接入|启用|正常|运行中|支持)$/.test(status) || /^(?:✅|🟢|✔️?)$/.test(clean(text))) return 'good';
  if (/^(?:关闭|已关闭|停用|停用中|暂停|未接入|未开启|不支持|禁用|跑路)$/.test(status) || /^(?:❌|⛔|🔴|✖️?)$/.test(clean(text))) return 'bad';
  if (/^(?:备用|维护|维护中|暂时停|暂时停用|待接入|待确认)$/.test(status) || /^(?:🟡|⚠️?|🛠️?)$/.test(clean(text))) return 'attention';
  return 'plain';
}

function strongPlatformStatus(value: string): boolean {
  return /^(?:开启|已开启|已接入|未接入|停用|停用中|暂停|关闭|已关闭|未开启|备用|维护|维护中|暂时停|暂时停用)(?:\s*(?:🟢|🔴|🟡|⭕|⛔|⚠️?|🛠️?|✅|❌))?$/.test(clean(value));
}

function possiblePlatformName(value: string): boolean {
  const label = clean(value);
  if (providerHeader(label) || typeHeader(label) || noteHeader(label) || statusHeader(label) || /代收|代付|费率|手续费|合计|单笔|状态|范围|类型|限制/.test(label)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9 ._()（）/\-新]{0,63}$/.test(label)
    || /^[^\n]{1,48}[（(](?:AR|WG|熊猫|胖虎)[）)]$/i.test(label);
}

function headerDepth(grid: OriginalRateGrid, index: SourceIndex): number {
  if (!index.rows) return 0;
  let depth = 1;
  const firstHasIdentity = (grid.cells[0] ?? []).some(cell => providerHeader(cell.text) || typeHeader(cell.text));
  if (!firstHasIdentity) for (let row = 1; row < Math.min(index.rows, 4); row++) {
    const values = (grid.cells[row] ?? []).map(cell => cell.text);
    if (values.some(providerHeader) && values.some(value => typeHeader(value) || /代收|代付|费率/.test(value))) { depth = row + 1; break; }
  }
  for (const merge of index.merges) {
    if (merge.startRowIndex !== 0 || merge.endRowIndex > 4) continue;
    const value = tidySourceCell(grid, 0, merge.startColumnIndex).text;
    if (providerHeader(value) || typeHeader(value) || /费率|手续费|代收|代付|状态|情况|限制|限额|单笔|国家/.test(value)) depth = Math.max(depth, merge.endRowIndex);
    if (merge.endRowIndex === 1 && merge.endColumnIndex - merge.startColumnIndex > 1) {
      for (let column = merge.startColumnIndex; column < merge.endColumnIndex; column++) {
        if (index.rows > 1 && childHeader(tidySourceCell(grid, 1, column).text)) depth = Math.max(depth, 2);
      }
    }
  }
  return Math.min(depth, index.rows);
}

function columnHeading(grid: OriginalRateGrid, column: number, depth: number) {
  const parts: string[] = [], anchors = new Set<string>();
  let headerSourceRow = -1;
  for (let row = 0; row < depth; row++) {
    const cell = tidySourceCell(grid, row, column), value = cell.text;
    if (!clean(value) || anchors.has(`${cell.sourceRow}:${cell.sourceColumn}`)) continue;
    const parent = parts[0] ?? '';
    // A parallel table may already have data below its one-row header.
    if (row > 0 && parent && !broadHeader(parent) && !(childHeader(value) && (/^(?:代收|代付)$/.test(clean(parent)) || (!providerHeader(parent) && !typeHeader(parent) && !noteHeader(parent) && !statusHeader(parent) && !/费率|手续费|单笔|合计|总计|最低|最高|国家/.test(parent))))) continue;
    if (row > 0 && tidyStatusTone(value) !== 'plain') continue;
    parts.push(value); anchors.add(`${cell.sourceRow}:${cell.sourceColumn}`); headerSourceRow = Math.max(headerSourceRow, cell.sourceRow);
  }
  return { parts, label: parts.join(' / '), headerSourceRow };
}

/** All columns/rows stay in source order; compact is a column-visibility hint only. */
export function buildTidyModel(grid: OriginalRateGrid): TidyModel {
  const index = sourceIndex(grid), headerRows = headerDepth(grid, index);
  const hiddenColumns = new Set(grid.hiddenColumns), hiddenRows = new Set(grid.hiddenRows);
  const headings = Array.from({ length: index.columns }, (_, column) => columnHeading(grid, column, headerRows));
  const samples = (column: number) => {
    const values: string[] = [];
    for (let row = headerRows; row < index.rows && values.length < 40; row++) {
      if (hiddenRows.has(row)) continue;
      const value = tidySourceCell(grid, row, column).text;
      if (clean(value)) values.push(value);
    }
    return values;
  };
  const platform = new Set<number>();
  for (let column = 0; column < index.columns; column++) {
    const { parts, label } = headings[column], leaf = parts.at(-1) ?? '';
    const platformParent = parts.length > 1 && (/^(?:使用盘口|接入平台|接入盘口|平台状态|平台|盘口)$/.test(clean(parts[0])) || childHeader(leaf) && !/^(?:代收|代付)$/.test(clean(parts[0])) && !broadHeader(parts[0]));
    const possibleName = parts.length === 1 && possiblePlatformName(label);
    const values = possibleName ? samples(column) : [];
    // New/unknown status text must not remove an otherwise evidenced platform.
    if (platformParent || possibleName && values.some(strongPlatformStatus)) platform.add(column);
  }
  // Newly added, still-blank names inside a proven platform band remain visible.
  for (let column = 0; column < index.columns; column++) {
    const { parts, label } = headings[column];
    if (platform.has(column) || parts.length !== 1 || !possiblePlatformName(label)) continue;
    if (samples(column).length === 0 && (platform.has(column - 1) || platform.has(column + 1))) platform.add(column);
  }
  const columns: TidyColumn[] = [];
  let providerColumn: number | null = null, typeColumn: number | null = null;
  for (let sourceColumn = 0; sourceColumn < index.columns; sourceColumn++) {
    if (hiddenColumns.has(sourceColumn)) continue;
    const { label, parts, headerSourceRow } = headings[sourceColumn], leaf = parts.at(-1) ?? '';
    let group: TidyColumn['group'] = 'other', kind: TidyColumn['kind'] = 'other', compact = false;
    if (platform.has(sourceColumn)) { group = 'platform'; kind = 'status'; compact = true; }
    else if (providerHeader(leaf)) { group = 'identity'; kind = 'provider'; compact = providerColumn === null; providerColumn ??= sourceColumn; }
    else if (typeHeader(leaf)) { group = 'identity'; kind = 'type'; compact = true; typeColumn ??= sourceColumn; }
    else if (/^(?:国家|银行|序号)$/.test(clean(leaf))) { group = 'identity'; compact = true; }
    else if (noteHeader(leaf)) { kind = 'note'; }
    else {
      const collect = /代收/.test(label), payout = /代付/.test(label);
      if (collect && !payout) group = 'collect';
      if (payout && !collect) group = 'payout';
      const range = /最低|最高|限制|限额|区间|范围/.test(leaf);
      if (!range && /费率|手续费|单笔|合计|总计/.test(leaf)) { kind = 'fee'; compact = group === 'collect' || group === 'payout'; }
      else if (statusHeader(leaf)) { kind = 'status'; compact = true; }
      else if (/代收|代付/.test(leaf) && !range && !/通道/.test(leaf)) {
        const values = samples(sourceColumn);
        kind = values.some(value => /[%％]/.test(value)) ? 'fee' : 'status';
        compact = true;
      }
    }
    const width = kind === 'provider' ? 148 : kind === 'type' ? 100 : kind === 'note' ? 208 : group === 'platform' ? 112 : kind === 'fee' ? 118 : kind === 'status' ? 92 : 128;
    columns.push({ sourceColumn, label, group, kind, compact, width, headerSourceRow });
  }
  for (const group of ['collect', 'payout'] as const) {
    const summaries = columns.filter(column => column.group === group && /合计|总计/.test(column.label));
    if (summaries.length) for (const column of columns) {
      if (column.group === group && column.kind === 'fee' && !summaries.includes(column)) column.compact = false;
    }
  }
  // Capability/reference sheets have no rate summary; their small source table is
  // already the compact view, including otherwise unclassified source fields.
  if (!columns.some(column => column.kind === 'fee') && platform.size === 0) for (const column of columns) column.compact = true;
  const rows: number[] = [];
  for (let row = 1; row < index.rows; row++) {
    if (hiddenRows.has(row)) continue;
    if (row >= headerRows || columns.some(column => {
      const cell = tidySourceCell(grid, row, column.sourceColumn);
      return cell.sourceRow > column.headerSourceRow && clean(cell.text) !== '';
    })) rows.push(row);
  }
  return { columns, rows, headerRows, providerColumn, typeColumn, platformColumns: columns.filter(column => column.group === 'platform').map(column => column.sourceColumn) };
}
