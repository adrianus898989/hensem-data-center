import type { WorkOrderPayload, WorkOrderRow } from "./types";

// V91_WORKORDER_FULL_SCAN: 工单员工/类型明细扫描全表，不再只扫前260行；标准RAW和展示表同时保留，用于日表查看弹窗显示子工单类型。
import { normalizeCell, toNumber } from "./format";

type Values = string[][];

type WorkKind = NonNullable<WorkOrderRow["kind"]>;

type HeaderMap = Record<string, number>;

function get(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return "";
  return normalizeCell(row[index]);
}

function norm(value: string): string {
  return normalizeCell(value).replace(/[\s　:：_\-\/\\（）()【】\[\]]/g, "").toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function cleanText(value: string): string {
  return normalizeCell(value)
    .replace(/^[\s\-—–]+|[\s\-—–]+$/g, "")
    .replace(/^#+/, "")
    .trim();
}


function normalizeWorkNameDisplay(value: string): string {
  const raw = cleanText(value || "");
  const x = norm(raw);
  if (!raw) return "";

  // 统一“提款/取款问题”工单名称：Withdraw Problem / Withdrawal problem / 大小写差异全部合并。
  if (
    x.includes("withdrawproblem") ||
    x.includes("withdrawalproblem") ||
    x.includes("取款问题") ||
    x.includes("提款问题") ||
    x.includes("出款问题")
  ) {
    return "Withdraw Problem";
  }

  // 只统一真正的连赢 / WinStreak 类工单，不能把 Bonus 20% Spin 这类普通奖励工单并进去。
  if (
    x.includes("连赢") ||
    x.includes("winstreak") ||
    x.includes("winningstreak") ||
    x.includes("wingowinstreak") ||
    (x.includes("win") && x.includes("streak"))
  ) {
    return "WinStreak Bonus";
  }

  if (x.includes("depositnotreceive") || x.includes("depositnotreceived") || x.includes("存款未到账") || x.includes("充值未到账")) {
    return "Deposit Not Receive";
  }

  if (x.includes("gameproblem") || x.includes("gameproblems") || x.includes("游戏问题")) {
    return "Game Problem";
  }

  return raw;
}

function parseDate(value: string): string {
  const raw = normalizeCell(value);
  if (!raw) return "";

  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 30000 && serial < 80000) {
    const base = Date.UTC(1899, 11, 30);
    const d = new Date(base + serial * 86400000);
    return d.toISOString().slice(0, 10);
  }

  let match = raw.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})\s*(?:日)?/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  match = raw.match(/(20\d{2})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return "";
}

function parseMonthStart(value: string): string {
  const raw = normalizeCell(value);
  const match = raw.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/);
  if (!match) return "";
  const [, y, m] = match;
  return `${y}-${m.padStart(2, "0")}-01`;
}

function countryFromText(text: string): string {
  const value = normalizeCell(text);
  if (!value) return "";
  if (value.includes("胖虎巴西")) return "胖虎巴西";
  if (value.includes("巴基斯坦")) return "巴基斯坦";
  if (value.includes("菲律宾")) return "菲律宾";
  if (value.includes("印度")) return "印度";
  if (value.includes("南美")) return "南美";
  if (value.includes("巴西")) return "巴西";
  if (value.includes("越南")) return "越南";
  if (value.includes("印尼")) return "印尼";
  if (value.includes("缅甸")) return "缅甸";
  if (value.includes("马来")) return "马来";
  if (value.includes("尼日利亚")) return "尼日利亚";
  return "";
}

function sourceCountryFromSheet(sheetName: string): string {
  return countryFromText(sheetName);
}

function isAutoOperator(value: string): boolean {
  const x = norm(value);
  return !!x && ["admin", "system", "auto", "robot", "机器人", "自动"].some((item) => x === item || x.includes(item));
}

function isAutoOperatorName(value: string): boolean {
  return isAutoOperator(value);
}

function isTotalLike(value: string): boolean {
  const x = norm(value);
  return x === "总数" || x === "总计" || x === "合计" || x === "total";
}

function isMeaninglessLabel(value: string): boolean {
  const x = norm(value);
  if (!x) return true;
  return [
    "年份", "月份", "国家", "平台", "盘口", "日期", "工单类型", "工单名称", "笔数", "占比",
    "总数", "合计", "总计", "allplatform", "全部平台", "所有平台", "已处理占比", "已驳回占比", "成功率", "失败率"
  ].includes(x);
}

function headerIndex(header: string[], start: number, end: number, names: string[]): number | undefined {
  const wanted = names.map(norm).filter(Boolean);
  const isPlatformLookup = wanted.some((w) => ["平台", "盘口", "platform"].includes(w));

  // 第一轮：只匹配完全相等，避免“盘口国家”被误认为“盘口/平台”。
  for (let i = start; i <= end && i < header.length; i++) {
    const h = norm(get(header, i));
    if (!h) continue;
    if (wanted.some((w) => h === w)) return i;
  }

  // 第二轮：允许包含匹配，但平台/盘口列必须避开“盘口国家/国家/地区”。
  for (let i = start; i <= end && i < header.length; i++) {
    const h = norm(get(header, i));
    if (!h) continue;
    if (isPlatformLookup && (h.includes("国家") || h.includes("地区"))) continue;
    if (wanted.some((w) => w.length >= 2 && h.includes(w))) return i;
  }

  return undefined;
}

function numberAt(row: string[], col?: number): number {
  if (col === undefined) return 0;
  return toNumber(get(row, col));
}


function exactHeaderIndex(header: string[], names: string[]): number | undefined {
  const wanted = names.map(norm).filter(Boolean);
  for (let i = 0; i < header.length; i++) {
    const h = norm(get(header, i));
    if (!h) continue;
    if (wanted.some((w) => h === w)) return i;
  }
  return undefined;
}

function looseHeaderIndex(header: string[], names: string[]): number | undefined {
  const exact = exactHeaderIndex(header, names);
  if (exact !== undefined) return exact;
  const wanted = names.map(norm).filter(Boolean);
  for (let i = 0; i < header.length; i++) {
    const h = norm(get(header, i));
    if (!h) continue;
    if (wanted.some((w) => w.length >= 2 && (h.includes(w) || w.includes(h)))) return i;
  }
  return undefined;
}


function isSummaryWorkLabel(value: string): boolean {
  const x = norm(value);
  if (!x) return true;
  if (["工单统计", "操作人统计", "平台日汇总", "国家汇总", "全部工单", "全部类型", "汇总", "总数", "总计", "合计", "total", "daily", "platformdaily"].includes(x)) return true;
  return x.includes("汇总") || x.includes("统计");
}

function hasRealWorkTypeOrName(workType: string, workName: string): boolean {
  const t = cleanText(workType || "");
  const n = cleanText(workName || "");
  return (!!t && !isMeaninglessLabel(t) && !isSummaryWorkLabel(t)) || (!!n && !isMeaninglessLabel(n) && !isSummaryWorkLabel(n));
}

function looksLikeRawWorkOrderHeader(header: string[]): boolean {
  const joined = header.map((cell) => norm(normalizeCell(cell))).join("|");
  const hasDate = /statdate|统计日期|日期|date/.test(joined);
  const hasCountry = /country|国家|地区/.test(joined);
  const hasPlatform = /platform|盘口|平台/.test(joined);
  const hasTotal = /totalcount|总工单|总工单数|总数/.test(joined);
  const hasDoneOrReject = /completedcount|successcount|processedcount|已处理|完成|成功|rejectedcount|rejectcount|failedcount|已驳回|驳回|失败/.test(joined);
  return hasDate && hasCountry && hasPlatform && hasTotal && hasDoneOrReject;
}

function parseNormalizedRawTables(sheetName: string, values: Values): WorkOrderRow[] {
  type ParsedRaw = {
    sheetName: string;
    rowIndex: number;
    date: string;
    country: string;
    platform: string;
    operator: string;
    accountType: string;
    workType: string;
    workName: string;
    total: number;
    success: number;
    failed: number;
    pending: number;
    amount: number;
    status: string;
    hasRealType: boolean;
    hasOperator: boolean;
    hasExplicitDaily: boolean;
  };

  const parsed: ParsedRaw[] = [];

  for (let headerRow = 0; headerRow < values.length; headerRow++) {
    const header = values[headerRow] || [];
    if (!looksLikeRawWorkOrderHeader(header)) continue;

    const dateCol = looseHeaderIndex(header, ["stat_date", "statdate", "统计日期", "日期", "date"]);
    const countryCol = looseHeaderIndex(header, ["country", "国家", "地区"]);
    const platformCol = looseHeaderIndex(header, ["platform", "盘口", "平台"]);
    // 标准 raw 里经常有 account_type，这不是操作人，不能用 account 模糊匹配。
    const operatorCol = looseHeaderIndex(header, ["employee_name", "employee_id", "operator", "operator_name", "后台账号", "操作人", "处理人", "客服", "员工", "账号"]);
    const accountTypeCol = looseHeaderIndex(header, ["account_type", "accounttype", "账号类型", "账号分类", "岗位", "岗位类型", "职位", "角色"]);
    const workTypeCol = looseHeaderIndex(header, ["work_type", "order_type", "ticket_type", "工单类型", "类型"]);
    const workNameCol = looseHeaderIndex(header, ["work_name", "order_name", "ticket_name", "工单名称", "名称"]);
    const totalCol = looseHeaderIndex(header, ["total_count", "total", "总工单", "总工单数", "总数"]);
    const successCol = looseHeaderIndex(header, ["completed_count", "success_count", "processed_count", "done_count", "已处理", "完成", "成功"]);
    const rejectedCol = looseHeaderIndex(header, ["rejected_count", "reject_count", "failed_count", "fail_count", "已驳回", "驳回", "失败"]);
    const pendingCol = looseHeaderIndex(header, ["pending_count", "pending", "待处理"]);
    const inProgressCol = looseHeaderIndex(header, ["in_progress_count", "inprogress_count", "processing_count", "处理中"]);
    const systemProcessingCol = looseHeaderIndex(header, ["system_processing_count", "systemprocessing_count", "系统处理中"]);
    const autoCol = looseHeaderIndex(header, ["auto_count", "auto_processed_count", "system_count", "system_processed_count", "自动处理", "系统自动", "admin_count"]);
    const manualCol = looseHeaderIndex(header, ["manual_count", "manual_processed_count", "人工处理", "人工", "manual"]);
    const amountCol = looseHeaderIndex(header, ["amount", "金额"]);

    if (dateCol === undefined || countryCol === undefined || platformCol === undefined || totalCol === undefined) continue;

    let blankStreak = 0;
    for (let rr = headerRow + 1; rr < values.length; rr++) {
      const row = values[rr] || [];
      const filled = row.map(normalizeCell).filter(Boolean);
      if (!filled.length) {
        blankStreak += 1;
        if (blankStreak >= 30) break;
        continue;
      }
      blankStreak = 0;
      if (rr > headerRow + 1 && looksLikeRawWorkOrderHeader(row)) break;

      const date = parseDate(get(row, dateCol));
      const countryText = get(row, countryCol);
      const country = countryFromText(countryText) || cleanText(countryText);
      const platform = get(row, platformCol);
      if (!date || !country || !platform || isTotalLike(country) || isTotalLike(platform) || isMeaninglessLabel(platform)) continue;

      const total = numberAt(row, totalCol);
      const success = numberAt(row, successCol);
      const failed = numberAt(row, rejectedCol);
      const pending = numberAt(row, pendingCol) + numberAt(row, inProgressCol) + numberAt(row, systemProcessingCol);
      const amount = numberAt(row, amountCol);
      const workType = workTypeCol !== undefined ? get(row, workTypeCol) : "";
      const workName = workNameCol !== undefined ? get(row, workNameCol) : "";
      const operator = operatorCol !== undefined ? get(row, operatorCol) : "";
      const accountType = accountTypeCol !== undefined ? get(row, accountTypeCol) : "";
      const fixed = fixCounts(total, success, failed, pending);
      if (fixed.total <= 0 && fixed.success <= 0 && fixed.failed <= 0 && fixed.pending <= 0 && amount <= 0) continue;

      const autoManual = fixAutoManual(numberAt(row, autoCol), numberAt(row, manualCol), fixed.total);
      const hasRealType = hasRealWorkTypeOrName(workType, workName);
      const hasOperator = !!operator && !isMeaninglessLabel(operator);
      const statusParts = ["标准RAW"];
      if (autoManual.auto || autoManual.manual) statusParts.push(`自动 ${autoManual.auto} · 人工 ${autoManual.manual}`);
      if (hasOperator) statusParts.push(isAutoOperator(operator) ? `自动 ${fixed.total} · 账号 ${operator}` : `人工 ${fixed.total} · 账号 ${operator}`);

      parsed.push({
        sheetName,
        rowIndex: rr,
        date,
        country,
        platform,
        operator: hasOperator ? operator : "",
        accountType,
        workType,
        workName,
        total: fixed.total,
        success: fixed.success,
        failed: fixed.failed,
        pending: fixed.pending,
        amount,
        status: statusParts.join(" · "),
        hasRealType,
        hasOperator,
        hasExplicitDaily: !hasRealType && !hasOperator
      });
    }
  }

  const explicitDailyKeys = new Set(parsed.filter((item) => item.hasExplicitDaily).map((item) => `${item.date}|||${item.country}|||${item.platform}`));
  const baseTypeKeys = new Set(parsed.filter((item) => item.hasRealType && !item.hasOperator).map((item) => {
    const typeName = item.workType || item.workName || "未分类";
    const orderName = normalizeWorkNameDisplay(item.workName || item.workType || "未命名工单");
    return `${item.date}|||${item.country}|||${item.platform}|||${canonicalWorkValue(typeName)}|||${canonicalWorkValue(orderName)}`;
  }));
  const rows: WorkOrderRow[] = [];

  for (const item of parsed) {
    const dailyKey = `${item.date}|||${item.country}|||${item.platform}`;
    const typeName = item.workType || item.workName || "未分类";
    const orderName = normalizeWorkNameDisplay(item.workName || item.workType || "未命名工单");

    if (!item.hasOperator && (!item.hasRealType || !explicitDailyKeys.has(dailyKey))) {
      const dailyItem = makeRow({
        kind: "daily",
        sheetName: item.sheetName,
        rowIndex: item.rowIndex,
        date: item.date,
        country: item.country,
        platform: item.platform,
        workType: "工单统计",
        workName: "平台日汇总",
        total: item.total,
        success: item.success,
        failed: item.failed,
        pending: item.pending,
        amount: item.amount,
        status: item.hasRealType ? `${item.status} · 由类型明细汇总日表` : `${item.status} · 每日汇总`
      });
      if (dailyItem) rows.push(dailyItem);
    }

    if (item.hasOperator) {
      const operatorItem = makeRow({
        kind: "operator",
        sheetName: item.sheetName,
        rowIndex: item.rowIndex,
        date: item.date,
        country: item.country,
        platform: item.platform,
        workType: item.hasRealType ? typeName : "操作人统计",
        workName: item.hasRealType ? orderName : "客服处理",
        operator: item.operator,
        accountType: item.accountType,
        total: item.total,
        success: item.success,
        failed: item.failed,
        pending: item.pending,
        amount: item.amount,
        status: `${item.status} · 操作人明细`
      });
      if (operatorItem) rows.push(operatorItem);
    }

    const itemTypeKey = `${item.date}|||${item.country}|||${item.platform}|||${canonicalWorkValue(typeName)}|||${canonicalWorkValue(orderName)}`;
    if (item.hasRealType && (!item.hasOperator || !baseTypeKeys.has(itemTypeKey))) {
      const typeItem = makeRow({
        kind: "type",
        sheetName: item.sheetName,
        rowIndex: item.rowIndex,
        date: item.date,
        country: item.country,
        platform: item.platform,
        workType: typeName,
        workName: orderName,
        operator: item.hasOperator ? item.operator : "",
        accountType: item.accountType,
        total: item.total,
        success: item.success,
        failed: item.failed,
        pending: item.pending,
        amount: item.amount,
        status: item.hasOperator ? `${item.status} · 操作人类型明细` : `${item.status} · 类型明细`
      });
      if (typeItem) rows.push(typeItem);
    }
  }

  return dedupeWorkRows(rows);
}

type CountFix = { total: number; success: number; failed: number; pending: number };

function fixCounts(totalInput: number, successInput: number, failedInput: number, pendingInput: number): CountFix {
  let total = Math.max(0, Math.round(totalInput || 0));
  let success = Math.max(0, Math.round(successInput || 0));
  let failed = Math.max(0, Math.round(failedInput || 0));
  let pending = Math.max(0, Math.round(pendingInput || 0));

  if (total <= 0) total = success + failed + pending;

  // 有些展示表会把“总数”读成放大 100 倍（例如 1070 被读成 107000），
  // 但已处理 + 驳回已经是准确口径。这里自动回正，避免待处理被补成几十万。
  const knownCount = success + failed + pending;
  if (total > 0 && knownCount > 0 && total > knownCount * 10) {
    const dividedBy100 = Math.round(total / 100);
    const dividedBy1000 = Math.round(total / 1000);
    if (dividedBy100 === knownCount) total = knownCount;
    else if (dividedBy1000 === knownCount) total = knownCount;
  }

  if (total > 0) {
    // 工单日表里“总数”是最可信字段；如果某个表头误匹配到其他区块，不能让已处理+驳回超过总数。
    if (success > total) success = total;
    const remainAfterSuccess = Math.max(0, total - success);

    if (pending > remainAfterSuccess) pending = remainAfterSuccess;
    const remainAfterPending = Math.max(0, total - success - pending);

    if (failed > remainAfterPending) failed = remainAfterPending;

    // 如果没有待处理列，且总数 > 已处理+驳回，剩余部分归为待处理，保证口径闭合。
    if (success + failed + pending < total) {
      pending = total - success - failed;
    }
  }

  return { total, success, failed, pending };
}

function fixAutoManual(autoInput: number, manualInput: number, total: number): { auto: number; manual: number } {
  let auto = Math.max(0, Math.round(autoInput || 0));
  let manual = Math.max(0, Math.round(manualInput || 0));
  const limit = Math.max(0, Math.round(total || 0));

  if (limit > 0 && auto + manual > limit) {
    const sum = auto + manual;
    auto = Math.round((auto / sum) * limit);
    manual = Math.max(0, limit - auto);
  }
  return { auto, manual };
}

function makeRow(args: {
  kind: WorkKind;
  sheetName: string;
  rowIndex: number;
  date?: string;
  country?: string;
  platform?: string;
  workType?: string;
  workName?: string;
  operator?: string;
  accountType?: string;
  total?: number;
  success?: number;
  failed?: number;
  pending?: number;
  amount?: number;
  status?: string;
}): WorkOrderRow | null {
  const country = cleanText(args.country || "");
  const platform = cleanText(args.platform || "");
  const workType = cleanText(args.workType || "");
  const workName = normalizeWorkNameDisplay(args.workName || "");
  const operator = cleanText(args.operator || "");
  const accountType = cleanText(args.accountType || "");
  const fixed = fixCounts(args.total || 0, args.success || 0, args.failed || 0, args.pending || 0);
  const total = fixed.total;
  const success = fixed.success;
  const failed = fixed.failed;
  const pending = fixed.pending;
  const amount = args.amount || 0;

  if (!country || !platform) return null;
  if (isTotalLike(country) || isTotalLike(platform)) return null;
  if (isMeaninglessLabel(platform)) return null;
  if (args.kind === "type" && !hasRealWorkTypeOrName(workType, workName)) return null;
  if (args.kind === "operator" && (!operator || isMeaninglessLabel(operator))) return null;
  if (total <= 0 && success <= 0 && failed <= 0 && pending <= 0 && amount <= 0) return null;

  return {
    id: `${args.kind}-${args.sheetName}-${args.rowIndex + 1}-${args.date || ""}-${country}-${platform}-${workType}-${workName}-${operator}`,
    date: args.date || "",
    country,
    platform,
    workType: workType || (args.kind === "operator" ? "操作人统计" : "工单统计"),
    workName: workName || (args.kind === "operator" ? "操作人处理" : "平台日汇总"),
    operator,
    accountType,
    total,
    success,
    failed,
    pending,
    amount,
    status: args.status || "",
    sourceSheet: args.sheetName,
    sourceRow: args.rowIndex + 1,
    kind: args.kind
  };
}


function canonicalWorkValue(value: string): string {
  return norm(cleanText(value || ""));
}

function canonicalWorkRowKey(row: WorkOrderRow): string {
  return [
    row.kind || "generic",
    row.date || "",
    canonicalWorkValue(row.country),
    canonicalWorkValue(row.platform),
    canonicalWorkValue(row.workType),
    canonicalWorkValue(row.workName),
    canonicalWorkValue(row.operator),
    canonicalWorkValue(row.accountType || ""),
    Math.round(row.total || 0),
    Math.round(row.success || 0),
    Math.round(row.failed || 0),
    Math.round(row.pending || 0),
    Math.round(row.amount || 0)
  ].join("|||");
}

function dedupeWorkRows(rows: WorkOrderRow[]): WorkOrderRow[] {
  const map = new Map<string, WorkOrderRow>();
  for (const row of rows) {
    const key = canonicalWorkRowKey(row);
    // 保留先读到的原始明细，后面同内容的汇总/重复区块不再重复显示。
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function dateBlockStarts(values: Values): Array<{ titleRow: number; headerRow: number; startCol: number; endCol: number; date: string }> {
  const found: Array<{ titleRow: number; headerRow: number; startCol: number; endCol: number; date: string }> = [];
  for (let r = 0; r < Math.min(values.length, 5000); r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const text = get(row, c);
      if (!text || !/(20\d{2}).*(月|\-).*?(\d{1,2}).*(日|\-)/.test(text)) continue;
      if (!/(工单|统计)/.test(text)) continue;
      const date = parseDate(text);
      if (!date) continue;
      const headerRow = r + 1;
      const nextStart = row.findIndex((cell, idx) => idx > c && parseDate(cell) && /(工单|统计)/.test(normalizeCell(cell)));
      found.push({ titleRow: r, headerRow, startCol: c, endCol: nextStart > c ? nextStart - 1 : c + 32, date });
    }
  }
  return found;
}

function parseDailyBlocks(sheetName: string, values: Values): WorkOrderRow[] {
  const rows: WorkOrderRow[] = [];
  const sourceCountry = sourceCountryFromSheet(sheetName);
  const blocks = dateBlockStarts(values);

  for (const block of blocks) {
    const header = values[block.headerRow] || [];
    const totalCol = headerIndex(header, block.startCol, block.endCol, ["总工单", "总数", "总工单数"]);
    if (totalCol === undefined) continue;

    const pendingCol = headerIndex(header, block.startCol, block.endCol, ["待处理"]);
    const processingCol = headerIndex(header, block.startCol, block.endCol, ["处理中"]);
    const systemProcessingCol = headerIndex(header, block.startCol, block.endCol, ["系统处理中"]);
    const successCol = headerIndex(header, block.startCol, block.endCol, ["已处理", "成功", "完成"]);
    const rejectedCol = headerIndex(header, block.startCol, block.endCol, ["已驳回", "驳回", "失败"]);
    const autoCol = headerIndex(header, block.startCol, block.endCol, ["自动处理", "自动出款"]);
    const manualCol = headerIndex(header, block.startCol, block.endCol, ["人工处理"]);
    const countryCol = headerIndex(header, block.startCol, block.endCol, ["盘口国家", "国家", "地区"]) ?? block.startCol;
    const platformCol = headerIndex(header, block.startCol, block.endCol, ["盘口", "平台"]) ?? Math.min(block.startCol + 1, block.endCol);

    let emptyStreak = 0;
    for (let rr = block.headerRow + 1; rr < values.length; rr++) {
      const row = values[rr] || [];
      const rowText = row.slice(block.startCol, Math.min(block.endCol + 1, row.length)).map(normalizeCell).join(" ");
      const leftA = get(row, 0);
      const leftB = get(row, 1);
      const leftNorm = norm(`${leftA}${leftB}`);
      // 只在真正遇到“底部类型统计表头/配置表头”时停止。
      // 工单名称（Deposit Not Receive / Game Problems / 取款未到账等）不能当成停止条件，
      // 否则会导致日期区块后半段被提前截断，看起来只剩少数几天。
      if (/各平台.*类型.*统计|各平台.*类型|类型统计/.test(rowText)) break;
      if (rr > block.headerRow + 1 && parseDate(rowText) && /(工单|统计)/.test(rowText)) break;
      if (leftNorm.includes("工单类型") || leftNorm.includes("工单名称") || leftNorm.includes("账号白名单") || leftNorm.includes("盘口国家盘口")) break;

      const rawCountry = get(row, countryCol);
      const parsedCountry = rawCountry ? countryFromText(rawCountry) : "";
      const country = parsedCountry || sourceCountry;
      const platform = get(row, platformCol);
      const totalCell = get(row, totalCol);
      if (!platform && !totalCell) {
        emptyStreak += 1;
        if (emptyStreak >= 35) break;
        continue;
      }
      emptyStreak = 0;
      if (!platform && !totalCell) continue;
      if (!country || isTotalLike(rawCountry) || isTotalLike(platform)) continue;
      if (isMeaninglessLabel(platform)) continue;

      const pending = numberAt(row, pendingCol) + numberAt(row, processingCol) + numberAt(row, systemProcessingCol);
      const success = numberAt(row, successCol);
      const failed = numberAt(row, rejectedCol);
      const rawTotal = numberAt(row, totalCol) || success + failed + pending;
      const fixedCounts = fixCounts(rawTotal, success, failed, pending);
      const fixedAutoManual = fixAutoManual(numberAt(row, autoCol), numberAt(row, manualCol), fixedCounts.total);
      const statusParts: string[] = [];
      if (autoCol !== undefined) statusParts.push(`自动 ${fixedAutoManual.auto}`);
      if (manualCol !== undefined) statusParts.push(`人工 ${fixedAutoManual.manual}`);

      const item = makeRow({
        kind: "daily",
        sheetName,
        rowIndex: rr,
        date: block.date,
        country,
        platform,
        workType: "工单统计",
        workName: "平台日汇总",
        total: rawTotal,
        success,
        failed,
        pending,
        status: statusParts.join(" · ")
      });
      if (item) rows.push(item);
    }
  }

  return rows;
}


function findCountryNearHeader(sheetName: string, values: Values, headerRow: number, startCol: number, endCol: number): string {
  for (let r = headerRow - 1; r >= Math.max(0, headerRow - 6); r--) {
    const row = values[r] || [];
    const cells: string[] = [];
    for (let c = startCol; c <= Math.min(endCol, row.length - 1); c++) {
      const cell = get(row, c);
      if (cell) cells.push(cell);
    }
    const found = countryFromText(cells.join(" "));
    if (found) return found;
  }
  return sourceCountryFromSheet(sheetName);
}

function parseEmployeeHorizontalBlocks(sheetName: string, values: Values): WorkOrderRow[] {
  const rows: WorkOrderRow[] = [];

  for (let r = 0; r < values.length; r++) {
    const header = values[r] || [];
    for (let c = 0; c < header.length; c++) {
      if (norm(get(header, c)) !== "日期") continue;

      const nextDateCol = header.findIndex((cell, idx) => idx > c && norm(normalizeCell(cell)) === "日期");
      const endCol = nextDateCol > c ? nextDateCol - 1 : Math.min(header.length - 1, c + 24);
      const platformCol = headerIndex(header, c, endCol, ["平台", "盘口"]);
      const operatorCol = headerIndex(header, c, endCol, ["后台账号", "操作人", "处理人", "账号"]);
      const totalCol = headerIndex(header, c, endCol, ["总工单", "总工单数", "总数"]);
      const successCol = headerIndex(header, c, endCol, ["已处理", "成功", "完成"]);
      const rejectCol = headerIndex(header, c, endCol, ["驳回", "已驳回", "失败"]);
      const workTypeCol = headerIndex(header, c, endCol, ["工单类型", "类型"]);
      const workNameCol = headerIndex(header, c, endCol, ["工单名称", "名称"]);

      if (platformCol === undefined || operatorCol === undefined || totalCol === undefined) continue;
      const country = findCountryNearHeader(sheetName, values, r, c, endCol);
      if (!country) continue;

      let emptyStreak = 0;
      for (let rr = r + 1; rr < values.length; rr++) {
        const row = values[rr] || [];
        const rowText = row.slice(c, Math.min(endCol + 1, row.length)).map(normalizeCell).join(" ");
        if (/各平台.*类型.*统计|类型统计|账号白名单|合计表|国家统计/.test(rowText)) break;

        const date = parseDate(get(row, c));
        const platform = get(row, platformCol);
        const operator = get(row, operatorCol);
        const totalValue = numberAt(row, totalCol);
        if (!date && !platform && !operator && totalValue <= 0) {
          emptyStreak += 1;
          if (emptyStreak >= 35) break;
          continue;
        }
        emptyStreak = 0;
        if (!date || !platform || !operator) continue;
        if (isTotalLike(platform) || isMeaninglessLabel(platform) || isMeaninglessLabel(operator)) continue;

        const workType = workTypeCol !== undefined ? get(row, workTypeCol) : "工单统计";
        const workName = workNameCol !== undefined ? get(row, workNameCol) : "平台日汇总";
        const success = numberAt(row, successCol);
        const failed = numberAt(row, rejectCol);
        const total = totalValue || success + failed;
        const status = isAutoOperator(operator) ? `自动 ${total} · 账号 ${operator}` : `人工 ${total} · 账号 ${operator}`;

        const operatorItem = makeRow({
          kind: "operator",
          sheetName,
          rowIndex: rr,
          date,
          country,
          platform,
          workType: workType || "工单统计",
          workName: workName || "平台日汇总",
          operator,
          total,
          success,
          failed,
          pending: 0,
          status
        });
        if (operatorItem) rows.push(operatorItem);

        const typeItem = makeRow({
          kind: "type",
          sheetName,
          rowIndex: rr,
          date,
          country,
          platform,
          workType: workType || "工单统计",
          workName: workName || "平台日汇总",
          operator,
          total,
          success,
          failed,
          pending: 0,
          status
        });
        if (typeItem) rows.push(typeItem);
      }
    }
  }

  return rows;
}

function parseTypeMatrices(sheetName: string, values: Values): WorkOrderRow[] {
  const rows: WorkOrderRow[] = [];
  const country = sourceCountryFromSheet(sheetName);
  if (!country) return rows;

  for (let r = 0; r < values.length; r++) {
    const rowText = (values[r] || []).map(normalizeCell).join(" ");
    if (!/各平台.*类型.*统计|类型统计/.test(rowText)) continue;

    const monthDate = parseMonthStart(rowText) || parseMonthStart((values[r - 1] || []).join(" ")) || "";
    const nameRowIndex = r + 1;
    const labelRowIndex = r + 2;
    const nameRow = values[nameRowIndex] || [];
    const labelRow = values[labelRowIndex] || [];

    let typeCol = 0;
    let nameCol = 1;
    for (let c = 0; c < Math.min(8, labelRow.length); c++) {
      const h = norm(labelRow[c] || nameRow[c] || "");
      if (h.includes("工单类型") || h === "类型") typeCol = c;
      if (h.includes("工单名称") || h === "名称") nameCol = c;
    }

    const platformCols: Array<{ platform: string; countCol: number }> = [];
    for (let c = Math.max(typeCol, nameCol) + 1; c < labelRow.length; c++) {
      const label = norm(get(labelRow, c));
      if (!label.includes("笔数") && label !== "count") continue;
      let platform = get(nameRow, c);
      if (!platform) {
        for (let back = c; back >= 0; back--) {
          if (get(nameRow, back)) { platform = get(nameRow, back); break; }
        }
      }
      if (!platform || isMeaninglessLabel(platform)) continue;
      platformCols.push({ platform, countCol: c });
    }

    if (!platformCols.length) continue;

    for (let rr = labelRowIndex + 1; rr < values.length; rr++) {
      const dataRow = values[rr] || [];
      const workType = get(dataRow, typeCol);
      const workName = get(dataRow, nameCol);
      const leftText = `${workType}${workName}`;
      if (!leftText) continue;
      if (isTotalLike(leftText)) break;
      if (isMeaninglessLabel(workType) && isMeaninglessLabel(workName)) continue;

      for (const col of platformCols) {
        const total = numberAt(dataRow, col.countCol);
        if (total <= 0) continue;
        const item = makeRow({
          kind: "type",
          sheetName,
          rowIndex: rr,
          date: monthDate,
          country,
          platform: col.platform,
          workType: workType || "未分类",
          workName: workName || workType || "未命名工单",
          total,
          success: total,
          status: "类型月汇总"
        });
        if (item) rows.push(item);
      }
    }
  }

  return rows;
}

function parseOperatorBlocks(sheetName: string, values: Values): WorkOrderRow[] {
  const rows: WorkOrderRow[] = [];

  for (let r = 0; r < values.length; r++) {
    const header = values[r] || [];
    for (let c = 0; c < header.length; c++) {
      if (!norm(get(header, c)).includes("日期")) continue;
      const platformCol = headerIndex(header, c, c + 12, ["平台", "盘口"]);
      const operatorCol = headerIndex(header, c, c + 12, ["后台账号", "操作人", "处理人", "账号"]);
      const processedCol = headerIndex(header, c, c + 12, ["已处理", "处理"]);
      const rejectCol = headerIndex(header, c, c + 12, ["驳回", "已驳回"]);
      if (platformCol === undefined || operatorCol === undefined || processedCol === undefined) continue;

      const titleText = (values[r - 1] || []).slice(c, Math.min(c + 12, header.length)).join(" ") || sheetName;
      const country = countryFromText(titleText) || sourceCountryFromSheet(sheetName);
      if (!country) continue;

      for (let rr = r + 1; rr < values.length; rr++) {
        const row = values[rr] || [];
        const date = parseDate(get(row, c));
        const platform = get(row, platformCol);
        const operator = get(row, operatorCol);
        const processed = numberAt(row, processedCol);
        const rejected = numberAt(row, rejectCol);
        if (!date && !platform && !operator && processed <= 0 && rejected <= 0) continue;
        if (!platform || !operator) continue;
        if (isTotalLike(platform) || isMeaninglessLabel(platform) || isMeaninglessLabel(operator)) continue;

        const item = makeRow({
          kind: "operator",
          sheetName,
          rowIndex: rr,
          date,
          country,
          platform,
          workType: "操作人统计",
          workName: "客服处理",
          operator,
          total: processed + rejected,
          success: processed,
          failed: rejected,
          pending: 0
        });
        if (item) rows.push(item);
      }
    }
  }

  return rows;
}

function summarize(rows: WorkOrderRow[]) {
  return {
    total: rows.reduce((sum, row) => sum + row.total, 0),
    success: rows.reduce((sum, row) => sum + row.success, 0),
    failed: rows.reduce((sum, row) => sum + row.failed, 0),
    pending: rows.reduce((sum, row) => sum + row.pending, 0),
    amount: rows.reduce((sum, row) => sum + row.amount, 0),
    countries: unique(rows.map((row) => row.country)).length,
    platforms: unique(rows.map((row) => row.platform)).length,
    types: unique(rows.map((row) => row.workType)).length,
    names: unique(rows.map((row) => row.workName)).length,
    operators: unique(rows.map((row) => row.operator)).length
  };
}

function buildAnomalies(rows: WorkOrderRow[]): string[] {
  const messages: string[] = [];
  const daily = rows.filter((row) => row.kind === "daily");
  const byPlatform = new Map<string, { total: number; failed: number; pending: number }>();

  for (const row of daily) {
    const key = `${row.country} ${row.platform}`;
    const item = byPlatform.get(key) || { total: 0, failed: 0, pending: 0 };
    item.total += row.total;
    item.failed += row.failed;
    item.pending += row.pending;
    byPlatform.set(key, item);
  }

  for (const [key, item] of Array.from(byPlatform.entries())) {
    if (item.total >= 10 && item.failed / item.total >= 0.15) messages.push(`${key}：失败/驳回占比 ${(item.failed / item.total * 100).toFixed(2)}%，建议检查工单类型。`);
  }

  return messages.slice(0, 120);
}

function parseSheet(sheetName: string, values: Values): WorkOrderRow[] {
  const rows: WorkOrderRow[] = [];
  const name = normalizeCell(sheetName);

  // 账号白名单、配置类页签不是工单统计数据，不能拿来当“未知盘口/未分类”。
  if (/白名单|说明|配置|模板|目录/.test(name)) return rows;

  // 优先读取标准 RAW 表头：stat_date / country / platform / total_count / completed_count / rejected_count。
  // 这种表头最准确，不会把展示页里的百分比或横向统计误当作工单数。
  const rawRows = parseNormalizedRawTables(sheetName, values);
  // 不要因为某个表里有标准 RAW 就直接 return；同一个文件/页签后面可能还有
  // 员工横表、类型统计、尼日利亚/巴基斯坦等国家区块。全部解析后再去重。
  rows.push(...rawRows);

  const employeeRows = parseEmployeeHorizontalBlocks(sheetName, values);
  rows.push(...parseDailyBlocks(sheetName, values));
  rows.push(...employeeRows);
  if (!employeeRows.some((row) => row.kind === "operator")) rows.push(...parseOperatorBlocks(sheetName, values));
  // 如果员工明细已经解析出 type 记录，就不要再把底部“各平台类型统计”也当成明细叠加，
  // 否则同一批工单会在类型统计和弹窗明细里重复出现。
  if (!employeeRows.some((row) => row.kind === "type")) rows.push(...parseTypeMatrices(sheetName, values));

  return dedupeWorkRows(rows);
}


type AccountTypeMap = Map<string, string>;

function accountTypeMapKey(country: string, platform: string, account: string): string {
  return [canonicalWorkValue(country), canonicalWorkValue(platform), canonicalWorkValue(account)].join("|||");
}

function extractAccountTypeMap(sheetValues: Record<string, Values>): AccountTypeMap {
  const map: AccountTypeMap = new Map();
  for (const values of Object.values(sheetValues)) {
    for (let r = 0; r < values.length; r++) {
      const header = values[r] || [];
      const accountCol = looseHeaderIndex(header, ["account", "账号", "后台账号", "操作人", "employee", "employee_id"]);
      const accountTypeCol = looseHeaderIndex(header, ["account_type", "accounttype", "账号类型", "账号分类", "岗位", "岗位类型", "职位", "角色"]);
      if (accountCol === undefined || accountTypeCol === undefined) continue;

      const countryCol = looseHeaderIndex(header, ["country", "国家", "地区"]);
      const platformCol = looseHeaderIndex(header, ["platform", "盘口", "平台"]);
      const enabledCol = looseHeaderIndex(header, ["enabled", "启用", "是否启用", "状态"]);
      let currentCountry = "";
      let currentPlatform = "";

      for (let rr = r + 1; rr < values.length; rr++) {
        const row = values[rr] || [];
        const account = cleanText(get(row, accountCol));
        const accountType = cleanText(get(row, accountTypeCol));
        const rowCountryText = countryCol !== undefined ? get(row, countryCol) : "";
        const rowPlatform = platformCol !== undefined ? cleanText(get(row, platformCol)) : "";
        if (rowCountryText) currentCountry = countryFromText(rowCountryText) || cleanText(rowCountryText);
        if (rowPlatform) currentPlatform = rowPlatform;

        if (!account && !accountType && !rowCountryText && !rowPlatform) continue;
        if (!account || !accountType || isMeaninglessLabel(account) || isMeaninglessLabel(accountType)) continue;
        const enabledText = enabledCol !== undefined ? norm(get(row, enabledCol)) : "";
        if (enabledText && ["false", "0", "no", "n", "停用", "关闭", "禁用"].includes(enabledText)) continue;

        const country = currentCountry;
        const platform = currentPlatform;
        const keys = [
          accountTypeMapKey(country, platform, account),
          accountTypeMapKey(country, "", account),
          accountTypeMapKey("", platform, account),
          accountTypeMapKey("", "", account)
        ];
        for (const key of keys) if (key && !map.has(key)) map.set(key, accountType);
      }
    }
  }
  return map;
}

function lookupAccountType(map: AccountTypeMap, row: WorkOrderRow): string {
  if (!row.operator) return row.accountType || "";
  const keys = [
    accountTypeMapKey(row.country, row.platform, row.operator),
    accountTypeMapKey(row.country, "", row.operator),
    accountTypeMapKey("", row.platform, row.operator),
    accountTypeMapKey("", "", row.operator)
  ];
  for (const key of keys) {
    const value = map.get(key);
    if (value) return value;
  }
  return row.accountType || "";
}

function enrichAccountTypes(rows: WorkOrderRow[], map: AccountTypeMap): WorkOrderRow[] {
  if (!map.size) return rows;
  return rows.map((row) => {
    const accountType = row.accountType || lookupAccountType(map, row);
    return accountType ? { ...row, accountType } : row;
  });
}

function buildSyntheticDailyRows(rows: WorkOrderRow[]): WorkOrderRow[] {
  const existing = new Set(rows.filter((row) => row.kind === "daily").map((row) => `${row.date}|||${row.country}|||${row.platform}`));
  const operatorGroups = new Map<string, WorkOrderRow[]>();
  const typeGroups = new Map<string, WorkOrderRow[]>();
  for (const row of rows) {
    if (!row.date || !row.country || !row.platform) continue;
    const key = `${row.date}|||${row.country}|||${row.platform}`;
    if (row.kind === "operator") operatorGroups.set(key, [...(operatorGroups.get(key) || []), row]);
    if (row.kind === "type") typeGroups.set(key, [...(typeGroups.get(key) || []), row]);
  }

  const output: WorkOrderRow[] = [];
  const keys = unique([...Array.from(operatorGroups.keys()), ...Array.from(typeGroups.keys())]);
  for (const key of keys) {
    if (existing.has(key)) continue;
    const source = operatorGroups.get(key)?.length ? operatorGroups.get(key)! : (typeGroups.get(key) || []);
    if (!source.length) continue;
    const [date, country, platform] = key.split("|||");
    let auto = 0;
    let manual = 0;
    for (const row of source) {
      if (row.kind === "operator") {
        if (isAutoOperatorName(row.operator)) auto += row.total;
        else manual += row.total;
      } else {
        const autoMatch = String(row.status || "").match(/自动\s*(\d+(?:\.\d+)?)/);
        const manualMatch = String(row.status || "").match(/人工\s*(\d+(?:\.\d+)?)/);
        if (autoMatch || manualMatch) {
          auto += Number(autoMatch?.[1] || 0);
          manual += Number(manualMatch?.[1] || 0);
        }
      }
    }
    const item = makeRow({
      kind: "daily",
      sheetName: "自动汇总",
      rowIndex: output.length,
      date,
      country,
      platform,
      workType: "工单统计",
      workName: "平台日汇总",
      total: source.reduce((sum, row) => sum + row.total, 0),
      success: source.reduce((sum, row) => sum + row.success, 0),
      failed: source.reduce((sum, row) => sum + row.failed, 0),
      pending: source.reduce((sum, row) => sum + row.pending, 0),
      amount: source.reduce((sum, row) => sum + row.amount, 0),
      status: `由${source[0].kind === "operator" ? "操作人" : "类型"}明细汇总日表 · 自动 ${Math.round(auto)} · 人工 ${Math.round(manual)}`
    });
    if (item) output.push(item);
  }
  return output;
}

export function buildWorkOrderPayload(sheetValues: Record<string, Values>): WorkOrderPayload {
  const accountTypeMap = extractAccountTypeMap(sheetValues);
  const parsedRows: WorkOrderRow[] = [];

  for (const [sheetName, values] of Object.entries(sheetValues)) {
    parsedRows.push(...parseSheet(sheetName, values || []));
  }

  const enrichedRows = enrichAccountTypes(parsedRows, accountTypeMap);
  const allRows = [...enrichedRows, ...buildSyntheticDailyRows(enrichedRows)];

  const rawDailyKeys = new Set(allRows.filter((row) => row.kind === "daily" && row.status.includes("标准RAW")).map((row) => `${row.date}|||${row.country}|||${row.platform}`));
  const preferredRows = rawDailyKeys.size
    ? allRows.filter((row) => row.kind !== "daily" || row.status.includes("标准RAW") || !rawDailyKeys.has(`${row.date}|||${row.country}|||${row.platform}`))
    : allRows;

  const rows = dedupeWorkRows(preferredRows).sort((a, b) => {
    return (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") ||
      a.kind!.localeCompare(b.kind || "") ||
      a.country.localeCompare(b.country, "zh-CN") ||
      a.platform.localeCompare(b.platform, "zh-CN") ||
      a.workType.localeCompare(b.workType, "zh-CN") ||
      a.workName.localeCompare(b.workName, "zh-CN") ||
      a.operator.localeCompare(b.operator, "zh-CN");
  });

  const dates = unique(rows.map((row) => row.date).filter((date) => /^20\d{2}-\d{2}-\d{2}$/.test(date))).sort();
  const latest = dates[dates.length - 1] || "";
  const now = new Date();

  return {
    meta: {
      year: latest ? latest.slice(0, 4) : String(now.getFullYear()),
      month: latest ? String(Number(latest.slice(5, 7))) : String(now.getMonth() + 1),
      updatedAt: now.toISOString(),
      source: "google-sheet",
      sheets: Object.keys(sheetValues)
    },
    summary: summarize(rows),
    rows,
    anomalies: buildAnomalies(rows)
  };
}
