/* Restored formal rate-grid presentation. Source-only projection compiled from
 * src/lib/tidyOriginalRates.ts; CSS reused from the formal rate workspace.
 * No workbook values, credentials, URLs, or fee calculations are embedded.
 */
(function(root){
'use strict';
const sourceTools=(function(){const exports={};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tidySourceCell = tidySourceCell;
exports.tidyBodySourceCell = tidyBodySourceCell;
exports.tidyStatusTone = tidyStatusTone;
exports.buildTidyModel = buildTidyModel;
const sourceIndexes = new WeakMap();
const clean = (value) => value.trim().replace(/\s+/g, ' ');
const providerHeader = (value) => /^(?:三方(?:名称)?|代收三方|代付三方|支付三方|三方支付名称)$/.test(clean(value));
const typeHeader = (value) => /^(?:类型(?:\s*[/／]\s*钱包)?|钱包(?:类型)?|通道类型|收款类型|代收类型|业务类型)$/.test(clean(value));
const broadHeader = (value) => /^(?:使用盘口|接入平台|接入盘口|平台状态|平台|盘口|.{1,8}三方)$/.test(clean(value)) && !providerHeader(value);
const childHeader = (value) => /^(?:代收|代付|费率|手续费|单笔|范围|状态|最低|最高|最低限制|最高限制)$/.test(clean(value));
const noteHeader = (value) => /备注|原因|漏洞|白名单|授信|时间|群组|账号|账户|核对|升级|UTR|IFSC|结算|限额最高|公户|个人|非整数|转移资金/.test(value);
const statusHeader = (value) => /^(?:状态|整体状态|通道情况(?:状态)?|使用情况|使用状态|代收情况|代付情况|支持|不支持)$/.test(clean(value));
function sourceIndex(grid) {
    const cached = sourceIndexes.get(grid);
    if (cached && cached.rows === grid.rowCount && cached.columns === grid.columnCount && cached.inputMerges === grid.merges && cached.inputLength === grid.merges.length)
        return cached;
    const validSize = Number.isSafeInteger(grid.rowCount) && Number.isSafeInteger(grid.columnCount)
        && grid.rowCount > 0 && grid.rowCount <= 10_000 && grid.columnCount > 0 && grid.columnCount <= 512 && grid.rowCount * grid.columnCount <= 250_000;
    const rows = validSize ? grid.rowCount : 0, columns = validSize ? grid.columnCount : 0;
    const anchors = new Map(), merges = [];
    for (const merge of (Array.isArray(grid.merges) ? grid.merges : []).slice(0, 10_000)) {
        const { startRowIndex: r, endRowIndex: re, startColumnIndex: c, endColumnIndex: ce } = merge;
        if (![r, re, c, ce].every(Number.isSafeInteger) || r < 0 || c < 0 || re <= r || ce <= c || re > rows || ce > columns)
            continue;
        if (merges.some(prior => r < prior.endRowIndex && re > prior.startRowIndex && c < prior.endColumnIndex && ce > prior.startColumnIndex))
            continue;
        merges.push(merge);
        const anchor = r * columns + c;
        for (let row = r; row < re; row++)
            for (let column = c; column < ce; column++)
                anchors.set(row * columns + column, anchor);
    }
    const index = { rows, columns, anchors, merges, inputMerges: grid.merges, inputLength: grid.merges.length };
    sourceIndexes.set(grid, index);
    return index;
}
/** Returns the exact source text, including a hidden merged origin. Never fills blanks. */
function tidySourceCell(grid, row, column) {
    const index = sourceIndex(grid);
    if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || column < 0 || row >= index.rows || column >= index.columns)
        return { text: '', sourceRow: row, sourceColumn: column };
    const anchor = index.anchors.get(row * index.columns + column) ?? row * index.columns + column;
    const sourceRow = Math.floor(anchor / index.columns), sourceColumn = anchor % index.columns;
    const rawText = grid.cells[sourceRow]?.[sourceColumn]?.text;
    return { text: typeof rawText === 'string' ? rawText : '', sourceRow, sourceColumn };
}
/** Keep parallel-table data while masking cells that still belong to a header. */
function tidyBodySourceCell(grid, row, column, headerRows) {
    const cell = tidySourceCell(grid, row, column.sourceColumn);
    return row < headerRows && cell.sourceRow <= column.headerSourceRow
        ? { text: '', sourceRow: row, sourceColumn: column.sourceColumn }
        : cell;
}
/** Styling only: a source switch is not evidence that any transaction has run. */
function tidyStatusTone(text) {
    const status = clean(text).replace(/\s*(?:🟢|🔴|🟡|⭕|⛔|⚠️?|🛠️?|✅|❌|✔️?|✖️?)\s*$/, '').trim();
    if (/^(?:开启|已开启|开放|已接入|启用|正常|运行中|支持)$/.test(status) || /^(?:✅|🟢|✔️?)$/.test(clean(text)))
        return 'good';
    if (/^(?:关闭|已关闭|停用|停用中|暂停|未接入|未开启|不支持|禁用|跑路)$/.test(status) || /^(?:❌|⛔|🔴|✖️?)$/.test(clean(text)))
        return 'bad';
    if (/^(?:备用|维护|维护中|暂时停|暂时停用|待接入|待确认)$/.test(status) || /^(?:🟡|⚠️?|🛠️?)$/.test(clean(text)))
        return 'attention';
    return 'plain';
}
function strongPlatformStatus(value) {
    return /^(?:开启|已开启|已接入|未接入|停用|停用中|暂停|关闭|已关闭|未开启|备用|维护|维护中|暂时停|暂时停用)(?:\s*(?:🟢|🔴|🟡|⭕|⛔|⚠️?|🛠️?|✅|❌))?$/.test(clean(value));
}
function possiblePlatformName(value) {
    const label = clean(value);
    if (providerHeader(label) || typeHeader(label) || noteHeader(label) || statusHeader(label) || /代收|代付|费率|手续费|合计|单笔|状态|范围|类型|限制/.test(label))
        return false;
    return /^[A-Za-z0-9][A-Za-z0-9 ._()（）/\-新]{0,63}$/.test(label)
        || /^[^\n]{1,48}[（(](?:AR|WG|熊猫|胖虎)[）)]$/i.test(label);
}
function headerDepth(grid, index) {
    if (!index.rows)
        return 0;
    let depth = 1;
    const firstHasIdentity = (grid.cells[0] ?? []).some(cell => providerHeader(cell.text) || typeHeader(cell.text));
    if (!firstHasIdentity)
        for (let row = 1; row < Math.min(index.rows, 4); row++) {
            const values = (grid.cells[row] ?? []).map(cell => cell.text);
            if (values.some(providerHeader) && values.some(value => typeHeader(value) || /代收|代付|费率/.test(value))) {
                depth = row + 1;
                break;
            }
        }
    for (const merge of index.merges) {
        if (merge.startRowIndex !== 0 || merge.endRowIndex > 4)
            continue;
        const value = tidySourceCell(grid, 0, merge.startColumnIndex).text;
        if (providerHeader(value) || typeHeader(value) || /费率|手续费|代收|代付|状态|情况|限制|限额|单笔|国家/.test(value))
            depth = Math.max(depth, merge.endRowIndex);
        if (merge.endRowIndex === 1 && merge.endColumnIndex - merge.startColumnIndex > 1) {
            for (let column = merge.startColumnIndex; column < merge.endColumnIndex; column++) {
                if (index.rows > 1 && childHeader(tidySourceCell(grid, 1, column).text))
                    depth = Math.max(depth, 2);
            }
        }
    }
    return Math.min(depth, index.rows);
}
function columnHeading(grid, column, depth) {
    const parts = [], anchors = new Set();
    let headerSourceRow = -1;
    for (let row = 0; row < depth; row++) {
        const cell = tidySourceCell(grid, row, column), value = cell.text;
        if (!clean(value) || anchors.has(`${cell.sourceRow}:${cell.sourceColumn}`))
            continue;
        const parent = parts[0] ?? '';
        // A parallel table may already have data below its one-row header.
        if (row > 0 && parent && !broadHeader(parent) && !(childHeader(value) && (/^(?:代收|代付)$/.test(clean(parent)) || (!providerHeader(parent) && !typeHeader(parent) && !noteHeader(parent) && !statusHeader(parent) && !/费率|手续费|单笔|合计|总计|最低|最高|国家/.test(parent)))))
            continue;
        if (row > 0 && tidyStatusTone(value) !== 'plain')
            continue;
        parts.push(value);
        anchors.add(`${cell.sourceRow}:${cell.sourceColumn}`);
        headerSourceRow = Math.max(headerSourceRow, cell.sourceRow);
    }
    return { parts, label: parts.join(' / '), headerSourceRow };
}
/** All columns/rows stay in source order; compact is a column-visibility hint only. */
function buildTidyModel(grid) {
    const index = sourceIndex(grid), headerRows = headerDepth(grid, index);
    const hiddenColumns = new Set(grid.hiddenColumns), hiddenRows = new Set(grid.hiddenRows);
    const headings = Array.from({ length: index.columns }, (_, column) => columnHeading(grid, column, headerRows));
    const samples = (column) => {
        const values = [];
        for (let row = headerRows; row < index.rows && values.length < 40; row++) {
            if (hiddenRows.has(row))
                continue;
            const value = tidySourceCell(grid, row, column).text;
            if (clean(value))
                values.push(value);
        }
        return values;
    };
    const platform = new Set();
    for (let column = 0; column < index.columns; column++) {
        const { parts, label } = headings[column], leaf = parts.at(-1) ?? '';
        const platformParent = parts.length > 1 && (/^(?:使用盘口|接入平台|接入盘口|平台状态|平台|盘口)$/.test(clean(parts[0])) || childHeader(leaf) && !/^(?:代收|代付)$/.test(clean(parts[0])) && !broadHeader(parts[0]));
        const possibleName = parts.length === 1 && possiblePlatformName(label);
        const values = possibleName ? samples(column) : [];
        // New/unknown status text must not remove an otherwise evidenced platform.
        if (platformParent || possibleName && values.some(strongPlatformStatus))
            platform.add(column);
    }
    // Newly added, still-blank names inside a proven platform band remain visible.
    for (let column = 0; column < index.columns; column++) {
        const { parts, label } = headings[column];
        if (platform.has(column) || parts.length !== 1 || !possiblePlatformName(label))
            continue;
        if (samples(column).length === 0 && (platform.has(column - 1) || platform.has(column + 1)))
            platform.add(column);
    }
    const columns = [];
    let providerColumn = null, typeColumn = null;
    for (let sourceColumn = 0; sourceColumn < index.columns; sourceColumn++) {
        if (hiddenColumns.has(sourceColumn))
            continue;
        const { label, parts, headerSourceRow } = headings[sourceColumn], leaf = parts.at(-1) ?? '';
        let group = 'other', kind = 'other', compact = false;
        if (platform.has(sourceColumn)) {
            group = 'platform';
            kind = 'status';
            compact = true;
        }
        else if (providerHeader(leaf)) {
            group = 'identity';
            kind = 'provider';
            compact = providerColumn === null;
            providerColumn ??= sourceColumn;
        }
        else if (typeHeader(leaf)) {
            group = 'identity';
            kind = 'type';
            compact = true;
            typeColumn ??= sourceColumn;
        }
        else if (/^(?:国家|银行|序号)$/.test(clean(leaf))) {
            group = 'identity';
            compact = true;
        }
        else if (noteHeader(leaf)) {
            kind = 'note';
        }
        else {
            const collect = /代收/.test(label), payout = /代付/.test(label);
            if (collect && !payout)
                group = 'collect';
            if (payout && !collect)
                group = 'payout';
            const range = /最低|最高|限制|限额|区间|范围/.test(leaf);
            if (!range && /费率|手续费|单笔|合计|总计/.test(leaf)) {
                kind = 'fee';
                compact = group === 'collect' || group === 'payout';
            }
            else if (statusHeader(leaf)) {
                kind = 'status';
                compact = true;
            }
            else if (/代收|代付/.test(leaf) && !range && !/通道/.test(leaf)) {
                const values = samples(sourceColumn);
                kind = values.some(value => /[%％]/.test(value)) ? 'fee' : 'status';
                compact = true;
            }
        }
        const width = kind === 'provider' ? 148 : kind === 'type' ? 100 : kind === 'note' ? 208 : group === 'platform' ? 112 : kind === 'fee' ? 118 : kind === 'status' ? 92 : 128;
        columns.push({ sourceColumn, label, group, kind, compact, width, headerSourceRow });
    }
    for (const group of ['collect', 'payout']) {
        const summaries = columns.filter(column => column.group === group && /合计|总计/.test(column.label));
        if (summaries.length)
            for (const column of columns) {
                if (column.group === group && column.kind === 'fee' && !summaries.includes(column))
                    column.compact = false;
            }
    }
    // Capability/reference sheets have no rate summary; their small source table is
    // already the compact view, including otherwise unclassified source fields.
    if (!columns.some(column => column.kind === 'fee') && platform.size === 0)
        for (const column of columns)
            column.compact = true;
    const rows = [];
    for (let row = 1; row < index.rows; row++) {
        if (hiddenRows.has(row))
            continue;
        if (row >= headerRows || columns.some(column => {
            const cell = tidySourceCell(grid, row, column.sourceColumn);
            return cell.sourceRow > column.headerSourceRow && clean(cell.text) !== '';
        }))
            rows.push(row);
    }
    return { columns, rows, headerRows, providerColumn, typeColumn, platformColumns: columns.filter(column => column.group === 'platform').map(column => column.sourceColumn) };
}

return exports;})();
const rateCss=".original-rates-workspace { --original-rates-line:#dce5f1; display:flex; flex-direction:column; min-width:0; overflow:hidden; color:#273b58; font:12px/1.4 -apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",sans-serif; }\n.original-rates-workspace * { box-sizing:border-box; }\n.original-rates-workspace button,.original-rates-workspace input,.original-rates-workspace select,.original-rates-workspace textarea { font:inherit; }\n.original-rates-workspace button { padding:4px 9px; min-height:28px; border:1px solid var(--original-rates-line); border-radius:5px; background:#fff; color:#4f6280; cursor:pointer; box-shadow:none; }\n.original-rates-workspace button:hover:not(:disabled) { color:#295dd7; border-color:#a9c0f0; background:#f2f6ff; }\n.original-rates-workspace button:disabled { opacity:.45; cursor:default; }\n.original-rates-workspace .original-rates-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:37px; padding:2px 1px 8px; }\n.original-rates-workspace .original-rates-heading h2 { margin:0; color:#263b58; font-size:16px; line-height:1.4; font-weight:650; }\n.original-rates-workspace .original-rates-heading h2 span { margin-left:9px; color:#71819b; font-size:12px; font-weight:400; }\n.original-rates-workspace .original-rates-heading-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:6px; }\n.original-rates-workspace .original-rates-time { margin-right:4px; color:#7c8ba3; font-size:11px; white-space:nowrap; }\n.original-rates-workspace .original-rates-heading-actions button { min-height:25px; padding:2px 7px; font-size:11px; }\n.original-rates-workspace .original-rates-filters { display:grid; grid-template-columns:minmax(160px,1.25fr) minmax(115px,.8fr) minmax(160px,1fr) minmax(145px,.9fr); gap:9px; padding:0 0 10px; }\n.original-rates-workspace .original-rates-filters label { min-width:0; }\n.original-rates-workspace .original-rates-filters label>span { display:block; margin:0 0 4px 1px; color:#73829b; font-size:11px; }\n.original-rates-workspace .original-rates-filters input,.original-rates-workspace .original-rates-filters select { width:100%; min-width:0; height:31px; margin:0; padding:0 9px; border:1px solid var(--original-rates-line); border-radius:5px; background:#fff; color:#344b6b; box-shadow:none; }\n.original-rates-workspace .original-rates-filters input::placeholder { color:#94a0b3; }\n.original-rates-workspace .original-rates-filters select:disabled { background:#f6f8fb; color:#97a3b5; }\n.original-rates-workspace .original-rates-tablebox { min-width:0; overflow:hidden; border:1px solid var(--original-rates-line); border-radius:6px; background:#fff; }\n.original-rates-workspace .original-rates-viewbar { display:flex; align-items:center; flex-wrap:wrap; gap:9px; min-height:42px; padding:6px 9px; }\n.original-rates-workspace .original-rates-modes { display:flex; gap:4px; }\n.original-rates-workspace .original-rates-modes button { min-height:28px; padding:4px 10px; font-size:11px; }\n.original-rates-workspace .original-rates-modes button[aria-pressed=\"true\"] { color:#2c5edf; border-color:#91aff0; background:#ebf2ff; }\n.original-rates-workspace .original-rates-count { color:#7888a1; font-size:11px; white-space:nowrap; }\n.original-rates-workspace .original-rates-reset { min-height:24px; padding:2px 5px; font-size:11px; border-color:transparent; color:#5171a7; }\n.original-rates-workspace .original-rates-locate { display:flex; gap:3px; margin-left:auto; }\n.original-rates-workspace .original-rates-locate button { padding:3px 5px; min-height:24px; border-color:transparent; background:transparent; color:#4c70c8; font-size:11px; }\n.original-rates-workspace .original-rates-content { min-width:0; }\n.original-rates-workspace .original-rates-cellbar { display:flex; align-items:flex-start; gap:8px; padding:6px 9px; border-top:1px solid var(--original-rates-line); min-width:0; background:#f7faff; }\n.original-rates-workspace .original-rates-cellbar>span { padding-top:4px; min-width:35px; color:#587399; font-size:11px; font-variant-numeric:tabular-nums; }\n.original-rates-workspace .original-rates-cellbar textarea { flex:1; resize:vertical; min-width:0; min-height:36px; max-height:160px; padding:3px 6px; border:1px solid #e0e8f3; border-radius:4px; background:#fff; color:#34465f; white-space:pre-wrap; overflow-wrap:anywhere; }\n.original-rates-workspace .original-rates-cellbar button { min-height:25px; padding:3px 6px; font-size:11px; }\n.original-rates-workspace .original-rates-caption { display:flex; justify-content:space-between; gap:8px; padding:4px 10px; color:#8190a7; font-size:10px; min-height:23px; }\n.original-rates-workspace .original-rates-tabs { display:flex; overflow-x:auto; gap:1px; min-height:34px; margin-top:7px; background:#eef3f9; border:1px solid var(--original-rates-line); border-radius:5px; scrollbar-width:thin; }\n.original-rates-workspace .original-rates-tabs button { flex-shrink:0; padding:6px 12px; min-height:32px; border:0; border-right:1px solid #e0e7f0; border-radius:0; background:transparent; color:#647590; cursor:pointer; white-space:nowrap; font-size:11px; }\n.original-rates-workspace .original-rates-tabs button[aria-current] { color:#285cce; background:#fff; border-bottom:2px solid #4679e6; font-weight:600; }\n.original-rates-workspace .original-rates-notice { min-height:55vh; display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:12px; color:#74849d; }\n.original-rates-workspace input:focus-visible,.original-rates-workspace textarea:focus-visible,.original-rates-workspace button:focus-visible,.original-rates-workspace select:focus-visible { outline:2px solid #6590ed; outline-offset:1px; }\n@media(max-width:850px) { .original-rates-workspace .original-rates-filters { grid-template-columns:1.15fr .85fr 1fr 1fr; gap:6px; } .original-rates-workspace .original-rates-time { font-size:10px; } }\n@media(max-width:620px) { .original-rates-workspace .original-rates-filters { grid-template-columns:1fr 1fr; } .original-rates-workspace .original-rates-heading { align-items:flex-start; } .original-rates-workspace .original-rates-heading h2 { font-size:14px; } .original-rates-workspace .original-rates-heading h2 span { display:none; } .original-rates-workspace .original-rates-heading-actions { gap:4px; } .original-rates-workspace .original-rates-time { width:100%; text-align:right; margin:0; } .original-rates-workspace .original-rates-viewbar { gap:6px; } .original-rates-workspace .original-rates-count { order:3; width:100%; } }\n\n.tidy-rate-scroll {\n  --tidy-line: #dce5f1;\n  --tidy-paper: #ffffff;\n  --tidy-alternate: #f6f8fc;\n  --tidy-ink: #263a56;\n  --tidy-muted: #6b80a0;\n  --tidy-header: #eaf0f8;\n  --tidy-blue: #245fd0;\n  --tidy-blue-soft: #e8f1ff;\n  --tidy-green: #177560;\n  --tidy-green-soft: #e7f4ef;\n  position: relative;\n  isolation: isolate;\n  width: 100%;\n  max-height: min(68vh, 760px);\n  min-height: 160px;\n  overflow: auto;\n  overscroll-behavior: contain;\n  scroll-padding-top: 62px;\n  scroll-padding-left: var(--tidy-frozen-width, 44px);\n  border-top: 1px solid var(--tidy-line);\n  border-bottom: 1px solid var(--tidy-line);\n  background: var(--tidy-paper);\n  color: var(--tidy-ink);\n  scrollbar-width: thin;\n  scrollbar-color: #afbed3 #f4f7fb;\n}\n\n.tidy-rate-scroll *, .tidy-rate-scroll *::before, .tidy-rate-scroll *::after { box-sizing: border-box; }\n.tidy-rate-scroll::-webkit-scrollbar { width: 10px; height: 10px; }\n.tidy-rate-scroll::-webkit-scrollbar-thumb { background: #afbed3; border: 2px solid #f4f7fb; border-radius: 8px; }\n.tidy-rate-scroll::-webkit-scrollbar-track { background: #f4f7fb; }\n.tidy-rate-scroll .tidy-rate-table {\n  /* Do not stretch columns: frozen offsets must match these fixed widths. */\n  min-width: 0;\n  border-collapse: separate;\n  border-spacing: 0;\n  table-layout: fixed;\n  margin: 0;\n  font: 12px/15px -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif;\n  color: var(--tidy-ink);\n}\n.tidy-rate-scroll .tidy-rate-table th,\n.tidy-rate-scroll .tidy-rate-table td {\n  border: 0;\n  border-right: 1px solid var(--tidy-line);\n  border-bottom: 1px solid var(--tidy-line);\n  border-radius: 0;\n  background: var(--tidy-paper);\n  padding: 3px 8px;\n  vertical-align: middle;\n  text-align: left;\n}\n.tidy-rate-scroll .tidy-rate-table th:last-child,\n.tidy-rate-scroll .tidy-rate-table td:last-child { border-right: 0; }\n.tidy-rate-scroll .tidy-rate-table thead th {\n  position: sticky;\n  top: 0;\n  z-index: 4;\n  height: 26px;\n  padding: 3px 7px;\n  background: var(--tidy-header);\n  color: var(--tidy-muted);\n  text-align: center;\n  font-size: 11px;\n  font-weight: 500;\n  line-height: 14px;\n}\n.tidy-rate-scroll .tidy-rate-table thead .tidy-rate-leaf-header { top: 26px; height: 36px; }\n.tidy-rate-scroll .tidy-rate-table thead .tidy-rate-tall-header { height: 62px; }\n.tidy-rate-scroll .tidy-rate-table thead .tidy-rate-group-collect { background: var(--tidy-blue-soft); color: var(--tidy-blue); }\n.tidy-rate-scroll .tidy-rate-table thead .tidy-rate-group-payout { background: var(--tidy-green-soft); color: var(--tidy-green); }\n.tidy-rate-scroll .tidy-rate-table thead .tidy-rate-group-platform { background: #edf2f9; color: #3f5778; }\n.tidy-rate-scroll .tidy-rate-header-text {\n  display: -webkit-box;\n  overflow: hidden;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n  max-height: 28px;\n  overflow-wrap: anywhere;\n  white-space: pre-line;\n}\n.tidy-rate-scroll .tidy-rate-table tbody tr { height: 36px; }\n.tidy-rate-scroll .tidy-rate-table tbody th,\n.tidy-rate-scroll .tidy-rate-table tbody td { height: 36px; font-weight: 400; }\n.tidy-rate-scroll .tidy-rate-table tbody tr:nth-child(even) > * { background: var(--tidy-alternate); }\n.tidy-rate-scroll .tidy-rate-table tbody tr:hover > * { background: #eef4ff; }\n.tidy-rate-scroll .tidy-rate-table .tidy-rate-frozen { position: sticky; z-index: 2; }\n.tidy-rate-scroll .tidy-rate-table thead .tidy-rate-frozen { z-index: 6; }\n.tidy-rate-scroll .tidy-rate-table .tidy-rate-frozen-edge { border-right: 1px solid #ccd9eb; box-shadow: 3px 0 5px #263c5810; }\n.tidy-rate-scroll .tidy-rate-table .tidy-rate-index { text-align: center; color: var(--tidy-muted); padding-left: 3px; padding-right: 3px; font-size: 10px; font-weight: 400; }\n.tidy-rate-scroll .tidy-rate-cell-text {\n  display: -webkit-box;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n  overflow: hidden;\n  max-height: 30px;\n  line-height: 15px;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  text-overflow: ellipsis;\n}\n.tidy-rate-scroll .tidy-rate-table tbody .tidy-rate-provider { font-weight: 600; color: #26384f; }\n.tidy-rate-scroll .tidy-rate-table .tidy-rate-type { color: var(--tidy-muted); font-size: 11px; }\n.tidy-rate-scroll .tidy-rate-table tbody .tidy-rate-fee { font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }\n.tidy-rate-scroll .tidy-rate-table tbody .tidy-rate-note { color: #617692; font-size: 11px; }\n.tidy-rate-scroll .tidy-rate-table tbody .tidy-rate-status,\n.tidy-rate-scroll .tidy-rate-table tbody .tidy-rate-group-platform { text-align: center; font-size: 11px; }\n.tidy-rate-scroll .tidy-rate-table tbody .tidy-rate-tone-good { color: #187c5a; font-weight: 500; }\n.tidy-rate-scroll .tidy-rate-table tbody .tidy-rate-tone-bad { color: #bd4653; font-weight: 500; }\n.tidy-rate-scroll .tidy-rate-table tbody .tidy-rate-tone-attention { color: #95670e; font-weight: 500; }\n.tidy-rate-scroll .tidy-rate-table td { cursor: cell; }\n.tidy-rate-scroll .tidy-rate-table td.tidy-rate-selected,\n.tidy-rate-scroll .tidy-rate-table td:focus-visible { outline: 2px solid #487cef; outline-offset: -2px; background: #eef4ff; }\n.tidy-rate-scroll .tidy-rate-table .tidy-rate-empty { height: 120px; text-align: center; color: var(--tidy-muted); cursor: default; }\n\n@media (max-width: 600px) {\n  .tidy-rate-scroll { max-height: 68vh; }\n}\n";
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const {buildTidyModel,tidyBodySourceCell,tidyStatusTone}=sourceTools;
let options={},serial=0;
let state={meta:null,grid:null,sheetId:null,loading:false,error:'',view:'compact',query:'',type:'',platform:'',status:'',page:1,limit:20,cell:null};
const limits=[20,30,50,100,500];
const GROUP_LABELS={identity:'',collect:'代收',payout:'代付',platform:'平台',other:''};
function validSheet(value){return value&&Number.isInteger(value.sheetId)&&value.sheetId>=0&&value.sheetId<=2147483647&&typeof value.title==='string'&&value.title.length<=1000&&Number.isInteger(value.index)&&value.index>=0;}
function validateMeta(value){
 if(!value||typeof value.title!=='string'||!Array.isArray(value.sheets)||value.sheets.length>64||!value.sheets.every(validSheet)||new Set(value.sheets.map(s=>s.sheetId)).size!==value.sheets.length)throw Error('原表目录格式无效');
 return {...value,sheets:value.sheets.slice().sort((a,b)=>a.index-b.index)};
}
function validateGrid(value,id){
 if(!value||!validSheet(value.sheet)||value.sheet.sheetId!==id||!Number.isSafeInteger(value.rowCount)||!Number.isSafeInteger(value.columnCount)||value.rowCount<1||value.columnCount<1||value.rowCount>10000||value.columnCount>512||value.rowCount*value.columnCount>250000)throw Error('原表页签或范围无效');
 if(!Array.isArray(value.cells)||value.cells.length!==value.rowCount||!value.cells.every(row=>Array.isArray(row)&&row.length===value.columnCount&&row.every(cell=>cell&&typeof cell.text==='string'))||!['merges','hiddenRows','hiddenColumns'].every(k=>Array.isArray(value[k])))throw Error('原表内容格式无效');
 return value;
}
function coordinate(row,column){let letters='';for(let n=column+1;n;n=Math.floor((n-1)/26))letters=String.fromCharCode(65+(n-1)%26)+letters;return letters+(row+1);}
function model(){
 if(!state.grid)return {model:null,columns:[],rows:[],types:[],platforms:[]};
 const grid=state.grid,m=buildTidyModel(grid),columns=m.columns.filter(column=>(state.view==='full'||column.compact)&&(!state.platform||column.group!=='platform'||String(column.sourceColumn)===state.platform));
 const type=m.columns.find(column=>column.sourceColumn===m.typeColumn),types=type?[...new Set(m.rows.map(row=>tidyBodySourceCell(grid,row,type,m.headerRows).text).filter(Boolean))]:[];
 const platforms=m.columns.filter(column=>column.group==='platform'),statusColumns=m.columns.filter(column=>state.platform?String(column.sourceColumn)===state.platform:m.platformColumns.length?column.group==='platform':column.kind==='status');
 const query=state.query.trim().toLocaleLowerCase();
 const rows=m.rows.filter(row=>{
  const text=column=>tidyBodySourceCell(grid,row,column,m.headerRows).text;
  if(state.view==='compact'&&!columns.some(column=>text(column)!==''))return false;
  const names=m.providerColumn===null?m.columns:m.columns.filter(column=>column.sourceColumn===m.providerColumn);
  if(query&&!names.some(column=>text(column).toLocaleLowerCase().includes(query)))return false;
  if(state.type&&(!type||text(type)!==state.type))return false;
  if(state.status&&!statusColumns.some(column=>{const value=text(column),tone=tidyStatusTone(value);if(tone==='plain')return false;
   if(state.status==='good')return tone==='good';
   if(state.status==='paused')return /暂停|停用|关闭|禁用|停运|暂关/.test(value);
   if(state.status==='unconnected')return /未接入|未接通|未开通|不支持/.test(value);
   return tone==='attention'&&!/暂停|停用|关闭|禁用|停运|暂关/.test(value);
  }))return false;
  return true;
 });
 return {model:m,columns,rows,types,platforms};
}
function input(key,label){return '<label><span>'+label+'</span><input aria-label="'+label+'" data-rates-filter="'+key+'" type="search" value="'+E(state[key])+'" placeholder="搜索三方" oninput="HensemLiveRatesRestored.set(\''+key+'\',this.value)"></label>';}
function select(key,label,items,disabled=false){return '<label><span>'+label+'</span><select aria-label="'+label+'"'+(disabled?' disabled':'')+' onchange="HensemLiveRatesRestored.set(\''+key+'\',this.value)">'+items.map(([value,name])=>'<option value="'+E(value)+'"'+(String(value)===state[key]?' selected':'')+'>'+E(name)+'</option>').join('')+'</select></label>';}
function layout(columns,m){
 const provider=columns.findIndex(c=>c.sourceColumn===m.providerColumn),type=columns.findIndex(c=>c.sourceColumn===m.typeColumn);
 const narrow=(root.document?.getElementById('live-rates-restored')?.clientWidth||1000)<600,freezeType=!narrow&&provider>=0&&type===provider+1;
 let left=44;const items=columns.map((column,index)=>{const width=Number.isFinite(column.width)?Math.max(60,Math.min(340,column.width)):112,frozen=index===provider||freezeType&&index===type;
  const item={column,width,frozen,left,edge:frozen&&index===(freezeType?type:provider)};if(frozen)left+=width;return item;});
 return {items,frozenWidth:left,width:44+items.reduce((n,item)=>n+item.width,0)};
}
function cls(item){return 'tidy-rate-'+item.column.kind+' tidy-rate-group-'+item.column.group+(item.frozen?' tidy-rate-frozen':'')+(item.edge?' tidy-rate-frozen-edge':'');}
function gridTable(value){
 if(!value.model){const message=state.loading?'正在读取原表…':state.error||'原表数据尚未读取';return '<div class="live-table tidy-rate-scroll"><table class="tidy-rate-table" style="width:100%"><thead><tr>'+['原行','三方名称','类型 / 钱包','代收收费合计','代付收费合计','平台状态'].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody><tr><td colspan="6" class="tidy-rate-empty">'+E(message)+'</td></tr></tbody></table></div>';}
 const m=value.model,l=layout(value.columns,m),parts=[];
 for(const item of l.items){const group=item.column.group,grouped=['collect','payout','platform'].includes(group),prior=parts.at(-1);if(grouped&&prior?.grouped&&prior.group===group)prior.items.push(item);else parts.push({group,grouped,items:[item]});}
 const firstPlatform=value.columns.find(column=>column.group==='platform')?.sourceColumn;
 const head=(item,span=1)=>{const column=item.column,prefix=column.group==='collect'?'代收 / ':column.group==='payout'?'代付 / ':'';
  return '<th scope="col" rowspan="'+span+'" data-source-column="'+column.sourceColumn+'"'+(column.sourceColumn===firstPlatform?' data-platform-start="true"':'')+' class="'+cls(item)+' '+(span===2?'tidy-rate-tall-header':'tidy-rate-leaf-header')+'"'+(item.frozen?' style="left:'+item.left+'px"':'')+' title="'+E(column.label)+'"><span class="tidy-rate-header-text">'+E(prefix&&column.label.startsWith(prefix)?column.label.slice(prefix.length):column.label)+'</span></th>';};
 const max=Math.max(1,Math.ceil(value.rows.length/state.limit)),page=Math.min(max,state.page),shown=value.rows.slice((page-1)*state.limit,page*state.limit);
 let html='<div class="tidy-rate-scroll" data-view="'+state.view+'" data-frozen-width="'+l.frozenWidth+'" style="--tidy-frozen-width:'+l.frozenWidth+'px" role="region" aria-label="'+E(state.grid.sheet.title)+'费率原表"><table class="tidy-rate-table" style="width:'+l.width+'px"><colgroup><col style="width:44px">'+l.items.map(item=>'<col style="width:'+item.width+'px">').join('')+'</colgroup><thead><tr class="tidy-rate-group-row"><th scope="col" class="tidy-rate-index tidy-rate-frozen tidy-rate-tall-header" rowspan="2" style="left:0">原行</th>'+parts.map(part=>part.grouped?'<th scope="colgroup" class="tidy-rate-group-'+part.group+'" colspan="'+part.items.length+'">'+GROUP_LABELS[part.group]+'</th>':head(part.items[0],2)).join('')+'</tr><tr class="tidy-rate-leaf-row">'+parts.filter(part=>part.grouped).flatMap(part=>part.items.map(item=>head(item))).join('')+'</tr></thead><tbody>';
 html+=shown.length&&value.columns.length?shown.map(row=>'<tr data-source-row="'+row+'"><th class="tidy-rate-index tidy-rate-frozen" scope="row" style="left:0">'+(row+1)+'</th>'+l.items.map(item=>{const c=item.column,source=tidyBodySourceCell(state.grid,row,c,m.headerRows),status=c.kind==='status'||c.group==='platform',tone=status?tidyStatusTone(source.text):'plain',selected=state.cell?.row===row&&state.cell?.column===c.sourceColumn;
  return '<td class="'+cls(item)+(selected?' tidy-rate-selected':'')+'"'+(item.frozen?' style="left:'+item.left+'px"':'')+' tabindex="0" data-cell="'+coordinate(row,c.sourceColumn)+'" data-source-cell="'+coordinate(source.sourceRow,source.sourceColumn)+'" data-status-tone="'+tone+'" aria-label="'+E(c.label+'，原表第 '+(row+1)+' 行：'+(source.text||'空白'))+'" onclick="HensemLiveRatesRestored.cell('+row+','+c.sourceColumn+')" onkeydown="HensemLiveRatesRestored.key(event,'+row+','+c.sourceColumn+')"><span class="tidy-rate-cell-text'+(status&&tone!=='plain'?' tidy-rate-tone-'+tone:'')+'" title="'+E(source.text)+'">'+E(source.text)+'</span></td>';}).join('')+'</tr>').join(''):'<tr><td class="tidy-rate-empty" colspan="'+(value.columns.length+1)+'">没有符合条件的记录</td></tr>';
 return html+'</tbody></table></div>';
}
function content(){
 const value=model(),title=state.grid?.sheet.title||state.meta?.sheets.find(s=>s.sheetId===state.sheetId)?.title||'各国家费率',max=Math.max(1,Math.ceil(value.rows.length/state.limit));
 const status=state.error?'<span role="alert">'+E(state.error)+'</span>':state.loading?'<span role="status">读取原表中…</span>':'';
 const timestamp=state.grid?.fetchedAt?'<time class="original-rates-time" datetime="'+E(state.grid.fetchedAt)+'" title="Supabase 原表同步时间">Supabase · '+E(state.grid.fetchedAt.replace('T',' ').replace('Z',' UTC'))+'</time>':'';
 let html='<div class="original-rates-heading"><h2>'+E(title)+'<span>三方费率</span></h2><div class="original-rates-heading-actions">'+timestamp+'<button type="button" onclick="HensemLiveRatesRestored.unavailable()"'+(typeof options.onUnavailable==='function'?'':' disabled')+'>授权范围费率</button><button type="button" onclick="HensemLiveRatesRestored.load()"'+(state.loading?' disabled':'')+'>刷新</button></div></div>';
 html+='<div class="original-rates-filters">'+input('query','三方名称')+select('type','类型 / 钱包',[['','全部类型'],...value.types.map(type=>[type,type])],!value.types.length)+select('platform','平台',[['','全部平台'],...value.platforms.map(column=>[String(column.sourceColumn),column.label])],!value.platforms.length)+select('status','平台状态',[['','全部状态'],['good','开启'],['paused','暂停 / 停用'],['unconnected','未接入 / 不支持'],['attention','备用 / 维护']],!value.model?.columns.some(column=>column.group==='platform'||column.kind==='status'))+'</div>';
 html+='<div class="original-rates-tablebox"><div class="original-rates-viewbar"><div class="original-rates-modes" role="group" aria-label="费率列显示方式">'+[['compact','精简展示'],['full','原表全部列']].map(([key,label])=>'<button type="button" aria-pressed="'+(state.view===key)+'" onclick="HensemLiveRatesRestored.set(\'view\',\''+key+'\')">'+label+'</button>').join('')+'</div><span class="original-rates-count">'+(value.model?value.rows.length+' / '+value.model.rows.length+' 行 · '+value.columns.length+' 列':'记录 —')+'</span>'+status+'<button type="button" class="original-rates-reset" onclick="HensemLiveRatesRestored.reset()">清除筛选</button><div class="original-rates-locate"><button type="button" onclick="HensemLiveRatesRestored.locate(false)">费率区</button><button type="button" onclick="HensemLiveRatesRestored.locate(true)"'+(value.platforms.length?'':' disabled')+'>平台区 →</button></div></div><div class="original-rates-content">'+gridTable(value)+'</div>';
 if(state.cell&&state.grid){const c=value.columns.find(c=>c.sourceColumn===state.cell.column);if(c&&value.rows.includes(state.cell.row)){const source=tidyBodySourceCell(state.grid,state.cell.row,c,value.model.headerRows);html+='<div class="original-rates-cellbar"><span>'+coordinate(source.sourceRow,source.sourceColumn)+'</span><textarea aria-label="原单元格完整内容" rows="2" readonly>'+E(source.text)+'</textarea><button type="button" onclick="HensemLiveRatesRestored.cell()">收起</button></div>';}}
 html+='<div class="original-rates-caption"><span>'+(state.view==='full'?'原字段 · 原顺序':'关键费率 · 平台横向对照')+'</span><span>平台栏为原表接入状态</span></div></div>';
 html+='<div class="original-rates-viewbar"><span>'+ (value.model?'共 '+value.rows.length+' 行':'总记录 —')+'</span><label>每页 <select aria-label="费率每页条数" onchange="HensemLiveRatesRestored.page(1,this.value)">'+limits.map(n=>'<option'+(state.limit===n?' selected':'')+'>'+n+'</option>').join('')+'</select></label><button type="button" onclick="HensemLiveRatesRestored.page('+(state.page-1)+')"'+(!value.model||state.page<=1?' disabled':'')+'>上一页</button><span>'+(value.model?Math.min(max,state.page)+' / '+max:'页码 —')+'</span><button type="button" onclick="HensemLiveRatesRestored.page('+(state.page+1)+')"'+(!value.model||state.page>=max?' disabled':'')+'>下一页</button></div>';
 html+='<nav class="original-rates-tabs" aria-label="Google 原表页签">'+(state.meta?.sheets.length?state.meta.sheets.map(sheet=>'<button type="button"'+(state.sheetId===sheet.sheetId?' aria-current="page"':'')+' onclick="HensemLiveRatesRestored.selectSheet('+sheet.sheetId+')">'+E(sheet.title)+'</button>').join(''):'<button type="button" disabled>国家 / 页签 —</button>')+'</nav>';
 return html;
}
function render(){return '<section id="live-rates-restored" class="original-rates-workspace" aria-label="各国家费率原表"><style>'+rateCss+'</style>'+content()+'</section>';}
function paint(){const host=root.document?.getElementById('live-rates-restored');if(host)host.innerHTML='<style>'+rateCss+'</style>'+content();if(typeof options.onChange==='function')options.onChange();return render();}
function clear(){serial++;state={...state,meta:null,grid:null,sheetId:null,loading:false,error:'',query:'',type:'',platform:'',status:'',page:1,cell:null};return paint();}
function configure(next={}){serial++;options={...next};state={...state,meta:null,grid:null,sheetId:null,loading:false,error:'',query:'',type:'',platform:'',status:'',page:1,cell:null};return render();}
async function load(sheetId){
 const current=++serial,request=options.request;
 state.loading=true;state.error='';state.grid=null;state.cell=null;state.page=1;paint();
 try{
  if(typeof request!=='function')throw Error('原表读取服务未接入');
  if(sheetId===undefined||!state.meta){const meta=validateMeta(await request({action:'ratesSheet'}));if(current!==serial)return;state.meta=meta;
   sheetId=meta.sheets.some(s=>s.sheetId===state.sheetId)?state.sheetId:meta.sheets.some(s=>s.sheetId===277747449)?277747449:meta.sheets[0]?.sheetId;}
  if(!Number.isInteger(sheetId)||!state.meta.sheets.some(s=>s.sheetId===sheetId))throw Error('暂无可读取的原表页签');
  state.sheetId=sheetId;paint();
  const grid=validateGrid(await request({action:'ratesSheet',sheetId}),sheetId);if(current!==serial)return;
  state.grid=grid;
 }catch(error){if(current!==serial)return;state.grid=null;state.meta=null;state.sheetId=null;state.error=error?.message||'原表暂时无法读取';}
 finally{if(current===serial){state.loading=false;paint();}}
}
function reset(){state.query='';state.type='';state.platform='';state.status='';state.page=1;state.cell=null;return paint();}
function set(key,value){
 if(!['view','query','type','platform','status'].includes(key))return render();
 if(key==='view'&&!['compact','full'].includes(value)||key==='status'&&!['','good','paused','unconnected','attention'].includes(value))return render();
 const active=root.document?.activeElement,focused=active?.getAttribute?.('data-rates-filter')===key,start=active?.selectionStart,end=active?.selectionEnd;
 state[key]=String(value).slice(0,1000);state.page=1;state.cell=null;const result=paint();
 if(focused){const input=root.document?.querySelector('#live-rates-restored [data-rates-filter="'+key+'"]');input?.focus();if(start!=null)input?.setSelectionRange?.(start,end);}
 return result;
}
function page(number,limit){if(limits.includes(Number(limit))){state.limit=Number(limit);number=1;}if(Number.isInteger(number))state.page=Math.max(1,Math.min(number,Math.max(1,Math.ceil(model().rows.length/state.limit))));state.cell=null;return paint();}
function selectSheet(id){if(!state.meta?.sheets.some(sheet=>sheet.sheetId===id))return Promise.resolve();state.query='';state.type='';state.platform='';state.status='';return load(id);}
function cell(row,column){const current=model();state.cell=Number.isInteger(row)&&current.rows.includes(row)&&current.columns.some(c=>c.sourceColumn===column)?{row,column}:null;return paint();}
function key(event,row,column){
 const current=model(),cols=current.columns,rows=current.rows.slice((state.page-1)*state.limit,state.page*state.limit);let r=rows.indexOf(row),c=cols.findIndex(item=>item.sourceColumn===column);
 if(event.key==='ArrowUp')r--;else if(event.key==='ArrowDown')r++;else if(event.key==='ArrowLeft')c--;else if(event.key==='ArrowRight')c++;else if(event.key==='Home'){c=0;if(event.ctrlKey||event.metaKey)r=0;}else if(event.key==='End'){c=cols.length-1;if(event.ctrlKey||event.metaKey)r=rows.length-1;}else if(event.key!=='Enter'&&event.key!==' ')return;
 event.preventDefault();r=Math.max(0,Math.min(rows.length-1,r));c=Math.max(0,Math.min(cols.length-1,c));if(rows[r]===undefined||!cols[c])return;
 cell(rows[r],cols[c].sourceColumn);const target=root.document?.querySelector('#live-rates-restored [data-cell="'+coordinate(rows[r],cols[c].sourceColumn)+'"]');target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function locate(platform){const scroller=root.document?.querySelector('#live-rates-restored .tidy-rate-scroll');if(!scroller)return;const target=platform?scroller.querySelector('[data-platform-start]'):null;scroller.scrollLeft=target?Math.max(0,target.offsetLeft-Number(scroller.dataset.frozenWidth||44)):0;}
root.HensemLiveRatesRestored={render,configure,load,selectSheet,clear,reset,set,page,cell,key,locate,unavailable:()=>options.onUnavailable?.(),model,sourceTools,snapshot:()=>({sheetId:state.sheetId,loading:state.loading,error:state.error,view:state.view,query:state.query,type:state.type,platform:state.platform,status:state.status,page:state.page,limit:state.limit,hasGrid:!!state.grid})};
if(typeof module!=='undefined'&&module.exports)module.exports=root.HensemLiveRatesRestored;
})(typeof window!=='undefined'?window:globalThis);
