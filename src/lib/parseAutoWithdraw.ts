import type { AutoWithdrawPayload, AutoWithdrawRow, DailyWithdrawRow, OperatorRow } from "./types";
import { formatDuration, inferCountryFromSheet, normalizeCell, parseDurationToSeconds, toNumber, toPercent } from "./format";

type Values = string[][];

function get(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return "";
  return normalizeCell(row[index]);
}

function findHeaderIndex(values: Values, requiredWords: string[]): number {
  for (let i = 0; i < values.length; i++) {
    const line = values[i].map(normalizeCell).join("|");
    const ok = requiredWords.every((word) => line.includes(word));
    if (ok) return i;
  }
  return -1;
}

function findIndex(headers: string[], candidates: string[], exclude: string[] = []): number {
  return headers.findIndex((h) => {
    const text = normalizeCell(h);
    return candidates.some((c) => text.includes(c)) && !exclude.some((x) => text.includes(x));
  });
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function normalizeDate(value: string): string {
  const text = normalizeCell(value);
  if (!text) return "";

  let m = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  m = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  return text;
}

function parseDateFromText(text: string): string {
  return normalizeDate(text);
}

function addDays(date: string, days: number): string {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return "";
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function autoWithdrawMaxDate(): string {
  const configured = normalizeCell(process.env.AUTO_WITHDRAW_MAX_DATE || "");
  if (/^20\d{2}-\d{2}-\d{2}$/.test(configured)) return configured;
  return new Date().toISOString().slice(0, 10);
}

function isAfterAutoWithdrawMaxDate(date: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(date) && date > autoWithdrawMaxDate();
}

function cleanMetaYear(value: string, fallback = ""): string {
  const text = normalizeCell(value);
  return /^20\d{2}$/.test(text) ? text : fallback;
}

function cleanMetaMonth(value: string, fallback = ""): string {
  const text = normalizeCell(value);
  if (/^\d{1,2}$/.test(text)) {
    const n = Number(text);
    if (n >= 1 && n <= 12) return String(n);
  }
  return fallback;
}

function comparePercentText(currentSeconds: number, previousSeconds: number): string {
  if (!currentSeconds || !previousSeconds) return "-";
  // 防止个别 Google Sheet 公式把上一日平均处理时间读成 1 秒，导致 +893502% 这种假异常。
  // 当两天处理时长差距过大且其中一天低于 10 秒时，先显示 -，避免误导。
  if ((previousSeconds < 10 && currentSeconds > 600) || (currentSeconds < 10 && previousSeconds > 600)) return "-";
  const pct = ((currentSeconds - previousSeconds) / previousSeconds) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > 9999) return "-";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

const PANGHU_BRAZIL_PLATFORM_KEYS = new Set([
  "VIP345", "KKVIP", "KK345", "FF555", "TPTP", "AA45", "F75", "25RR",
  "8599BET", "9596BET", "8566BET", "5V555", "58EE", "27FF", "222O",
  "32QQ", "67VIP", "234T", "888HH", "POPCRA", "POPNOV", "POPFEZ",
  "345F", "BET5697"
]);

function platformKey(value: string): string {
  return normalizeCell(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeAutoCountry(country: string, platform: string): string {
  const pKey = platformKey(platform);
  if (PANGHU_BRAZIL_PLATFORM_KEYS.has(pKey)) return "胖虎巴西";
  return country;
}


function findDateNearColumn(values: Values, headerIndex: number, col: number): { date: string; title: string } {
  for (let r = Math.max(0, headerIndex - 3); r <= headerIndex; r++) {
    const row = values[r] || [];
    for (let c = col; c >= Math.max(0, col - 2); c--) {
      const title = get(row, c);
      const date = parseDateFromText(title);
      if (date && /^20\d{2}-\d{2}-\d{2}$/.test(date)) return { date, title };
    }
  }
  return { date: "", title: "" };
}

function findDailyBlockStarts(values: Values, headerIndex: number): Array<{ start: number; date: string; title: string }> {
  const header = values[headerIndex] || [];
  const starts: Array<{ start: number; date: string; title: string }> = [];

  for (let c = 0; c < header.length; c++) {
    const h = get(header, c);
    if (!h) continue;
    const isTotalHeader = h.includes("总提款笔数") || h.includes("总笔数") || h.includes("提款笔数");
    if (!isTotalHeader) continue;

    const { date, title } = findDateNearColumn(values, headerIndex, c);
    if (!date || isAfterAutoWithdrawMaxDate(date)) continue;
    starts.push({ start: c, date, title });
  }

  return starts;
}



function findDailyBlocksFromTitleRows(values: Values): Array<{ start: number; date: string; title: string; headerIndex: number }> {
  const blocks: Array<{ start: number; date: string; title: string; headerIndex: number }> = [];
  const seen = new Set<string>();

  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const title = get(row, c);
      const date = parseDateFromText(title);
      if (!date || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || isAfterAutoWithdrawMaxDate(date)) continue;

      // 日期标题下一行一般就是：总提款笔数 / 成功 / 驳回 / 成功占比...
      for (let hr = r + 1; hr <= Math.min(values.length - 1, r + 3); hr++) {
        const header = values[hr] || [];
        let start = -1;
        for (let cc = c; cc < Math.min(header.length, c + 5); cc++) {
          const h = get(header, cc);
          if (h.includes("总提款笔数") || h.includes("总笔数") || h.includes("提款笔数")) {
            start = cc;
            break;
          }
        }
        if (start < 0) continue;
        const key = `${date}|||${start}|||${hr}`;
        if (!seen.has(key)) {
          seen.add(key);
          blocks.push({ start, date, title, headerIndex: hr });
        }
        break;
      }
    }
  }

  return blocks.sort((a, b) => a.start - b.start || a.date.localeCompare(b.date));
}

function buildWithdrawRow(row: string[], start: number, country: string, platform: string, sourceSheet: string): AutoWithdrawRow {
  const total = toNumber(get(row, start));
  const success = toNumber(get(row, start + 1));
  const rejected = toNumber(get(row, start + 2));
  const autoCount = toNumber(get(row, start + 5));
  const manualRaw = toNumber(get(row, start + 6));
  const manualCount = manualRaw || Math.max(total - autoCount, 0);

  return {
    country,
    platform,
    total,
    success,
    rejected,
    // 百分比以数量重新计算，避免 Google Sheet API 把 0.80% 读取成 0.8 后被误判为 80%。
    successRate: total ? success / total : toPercent(get(row, start + 3), 0),
    rejectRate: total ? rejected / total : toPercent(get(row, start + 4), 0),
    autoCount,
    manualCount,
    autoRate: total ? autoCount / total : toPercent(get(row, start + 7), 0),
    manualRate: total ? manualCount / total : toPercent(get(row, start + 8), 0),
    avgTime: get(row, start + 9) || "0秒",
    yesterdayAvgTime: get(row, start + 10) || "0秒",
    comparePercent: get(row, start + 11),
    sourceSheet
  };
}

export function parseMonthlySheet(values: Values, sourceSheet: string): { rows: AutoWithdrawRow[]; year: string; month: string } {
  const defaultCountry = inferCountryFromSheet(sourceSheet);
  const year = get(values[1], 0) || get(values[2], 0) || "";
  const month = get(values[1], 1) || get(values[2], 1) || "";

  const headerIndex = findHeaderIndex(values, ["盘口", "成功", "驳回"]);
  if (headerIndex < 0) return { rows: [], year, month };

  const headers = values[headerIndex].map(normalizeCell);

  const idxCountry = findIndex(headers, ["国家"]);
  const idxPlatform = findIndex(headers, ["盘口", "平台"], ["国家"]);
  const idxTotal = findIndex(headers, ["总提款笔数", "总笔数", "提款笔数"]);
  const idxSuccess = findIndex(headers, ["成功"], ["占比", "率"]);
  const idxRejected = findIndex(headers, ["驳回", "拒绝", "失败"], ["占比", "率"]);
  const idxSuccessRate = findIndex(headers, ["成功占比", "成功率"]);
  const idxRejectRate = findIndex(headers, ["驳回占比", "驳回率", "失败率"]);
  const idxAuto = findIndex(headers, ["自动出款笔数", "自动出款"], ["占比"]);
  const idxManual = findIndex(headers, ["人工处理", "人工出款"], ["占比"]);
  const idxAutoRate = findIndex(headers, ["自动占比", "自动率"]);
  const idxManualRate = findIndex(headers, ["人工占比", "人工率"]);
  const idxAvg = findIndex(headers, ["平均处理时间", "平均处理时长"], ["昨日"]);
  const idxYesterday = findIndex(headers, ["昨日平均处理时间", "昨日平均处理时长"]);
  const idxCompare = findIndex(headers, ["对比"]);

  const rows: AutoWithdrawRow[] = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const platform = idxPlatform >= 0 ? get(row, idxPlatform) : "";
    const total = idxTotal >= 0 ? toNumber(get(row, idxTotal)) : 0;
    const success = idxSuccess >= 0 ? toNumber(get(row, idxSuccess)) : 0;
    const rejected = idxRejected >= 0 ? toNumber(get(row, idxRejected)) : 0;

    if (!platform && total === 0 && success === 0 && rejected === 0) continue;
    if (!platform) continue;
    if (["盘口", "平台", "合计", "总计"].includes(platform)) continue;

    const autoCount = idxAuto >= 0 ? toNumber(get(row, idxAuto)) : 0;
    const manualCount = idxManual >= 0 ? toNumber(get(row, idxManual)) : Math.max(total - autoCount, 0);
    const rawCountry = idxCountry >= 0 ? get(row, idxCountry) || defaultCountry : defaultCountry;
    const country = normalizeAutoCountry(rawCountry, platform);

    rows.push({
      country,
      platform,
      total,
      success,
      rejected,
      successRate: total ? success / total : (idxSuccessRate >= 0 ? toPercent(get(row, idxSuccessRate), 0) : 0),
      rejectRate: total ? rejected / total : (idxRejectRate >= 0 ? toPercent(get(row, idxRejectRate), 0) : 0),
      autoCount,
      manualCount,
      autoRate: total ? autoCount / total : (idxAutoRate >= 0 ? toPercent(get(row, idxAutoRate), 0) : 0),
      manualRate: total ? manualCount / total : (idxManualRate >= 0 ? toPercent(get(row, idxManualRate), 0) : 0),
      avgTime: idxAvg >= 0 ? get(row, idxAvg) : "0秒",
      yesterdayAvgTime: idxYesterday >= 0 ? get(row, idxYesterday) : "0秒",
      comparePercent: idxCompare >= 0 ? get(row, idxCompare) : "",
      sourceSheet
    });
  }

  return { rows, year, month };
}

export function parseDailyCountrySheet(values: Values, sourceSheet: string): { rows: DailyWithdrawRow[]; year: string; month: string } {
  const defaultCountry = inferCountryFromSheet(sourceSheet);
  const year = get(values[1], 0) || get(values[2], 0) || "";
  const month = get(values[1], 1) || get(values[2], 1) || "";

  const titleBlocks = findDailyBlocksFromTitleRows(values);
  const oldHeaderIndex = findHeaderIndex(values, ["盘口", "成功", "驳回"]);
  const oldBlocks = oldHeaderIndex >= 0
    ? findDailyBlockStarts(values, oldHeaderIndex).map((b) => ({ ...b, headerIndex: oldHeaderIndex }))
    : [];

  // 重要修复：
  // 这张表是“4月在上面、5月在下面、一直到12月”的纵向区块结构。
  // 旧逻辑会把所有日期块放在一起，然后从第一行数据开始套全部日期块，
  // 导致 2026-05-02 可能读到 2026-04-02 的数据。
  // 现在每个日期块只读取自己 headerIndex 到下一个 headerIndex 之前的数据行。
  const blocks = (titleBlocks.length ? titleBlocks : oldBlocks).filter((block) => !isAfterAutoWithdrawMaxDate(block.date));
  if (!blocks.length) return { rows: [], year, month };

  const rows: DailyWithdrawRow[] = [];
  const headerRows = Array.from(new Set(blocks.map((b) => b.headerIndex))).sort((a, b) => a - b);

  for (const headerIndex of headerRows) {
    const sectionBlocks = blocks.filter((block) => block.headerIndex === headerIndex);
    const nextHeaderIndex = headerRows.find((row) => row > headerIndex);
    const endRowExclusive = nextHeaderIndex === undefined ? values.length : nextHeaderIndex;

    for (let r = headerIndex + 1; r < endRowExclusive; r++) {
      const row = values[r] || [];
      const platform = get(row, 1);
      const country = normalizeAutoCountry(get(row, 0) || defaultCountry, platform);

      if (!platform) continue;
      if (["盘口", "平台", "合计", "总计", "总数"].includes(platform)) continue;

      for (const block of sectionBlocks) {
        const built = buildWithdrawRow(row, block.start, country, platform, sourceSheet);
        if (!built.platform || (built.total === 0 && built.success === 0 && built.rejected === 0 && built.autoCount === 0 && built.manualCount === 0)) {
          continue;
        }
        rows.push({
          ...built,
          date: block.date,
          blockTitle: block.title || block.date
        });
      }
    }
  }

  return { rows: enrichDailyRowsWithPrevious(rows), year, month };
}

function enrichDailyRowsWithPrevious(rows: DailyWithdrawRow[]): DailyWithdrawRow[] {
  const secondsMap = new Map<string, number>();

  for (const row of rows) {
    const seconds = parseDurationToSeconds(row.avgTime);
    secondsMap.set(`${row.country}|||${row.platform}|||${row.date}`, seconds);
  }

  return rows.map((row) => {
    const currentSeconds = parseDurationToSeconds(row.avgTime);
    const yesterday = addDays(row.date, -1);
    const previousSeconds = secondsMap.get(`${row.country}|||${row.platform}|||${yesterday}`) || 0;
    return {
      ...row,
      yesterdayAvgTime: previousSeconds ? formatDuration(previousSeconds) : (row.yesterdayAvgTime || "-"),
      comparePercent: comparePercentText(currentSeconds, previousSeconds)
    };
  });
}

function groupKey(row: Pick<AutoWithdrawRow, "country" | "platform" | "sourceSheet">): string {
  return `${row.country}|||${row.platform}|||${row.sourceSheet}`;
}

export function aggregateWithdrawRows(rows: AutoWithdrawRow[]): AutoWithdrawRow[] {
  const map = new Map<string, AutoWithdrawRow & { _seconds: number; _weight: number }>();

  for (const row of rows) {
    const key = groupKey(row);
    const current = map.get(key);
    const weight = row.total || row.success + row.rejected || 0;
    const seconds = parseDurationToSeconds(row.avgTime);

    if (!current) {
      map.set(key, {
        ...row,
        successRate: 0,
        rejectRate: 0,
        autoRate: 0,
        manualRate: 0,
        avgTime: "0秒",
        yesterdayAvgTime: "-",
        comparePercent: "-",
        _seconds: seconds > 0 && weight > 0 ? seconds * weight : 0,
        _weight: seconds > 0 && weight > 0 ? weight : 0
      });
      continue;
    }

    current.total += row.total;
    current.success += row.success;
    current.rejected += row.rejected;
    current.autoCount += row.autoCount;
    current.manualCount += row.manualCount;
    if (seconds > 0 && weight > 0) {
      current._seconds += seconds * weight;
      current._weight += weight;
    }
  }

  return Array.from(map.values())
    .map(({ _seconds, _weight, ...row }) => ({
      ...row,
      successRate: row.total ? row.success / row.total : 0,
      rejectRate: row.total ? row.rejected / row.total : 0,
      autoRate: row.total ? row.autoCount / row.total : 0,
      manualRate: row.total ? row.manualCount / row.total : 0,
      avgTime: formatDuration(_weight ? _seconds / _weight : 0)
    }))
    .sort((a, b) => b.total - a.total);
}


export function parseRawDailySheet(values: Values, sourceSheet: string): DailyWithdrawRow[] {
  // 支持原始日汇总表，例如 raw_daily_2026_05：
  // stat_date / system_name / country / platform / total_count / success_count / reject_count / auto_count / manual_count / total_handle_seco / handle_count / updated_at
  const headerIndex = findHeaderIndex(values, ["stat_date", "total_count", "success_count"]);
  if (headerIndex < 0) return [];

  const headers = values[headerIndex].map(normalizeCell);
  const idxDate = findIndex(headers, ["stat_date", "date", "日期"]);
  const idxCountry = findIndex(headers, ["country", "国家"]);
  const idxPlatform = findIndex(headers, ["platform", "盘口", "平台"]);
  const idxTotal = findIndex(headers, ["total_count", "总提款笔数", "总笔数", "总数"]);
  const idxSuccess = findIndex(headers, ["success_count", "成功"]);
  const idxRejected = findIndex(headers, ["reject_count", "驳回", "拒绝", "失败"]);
  const idxAuto = findIndex(headers, ["auto_count", "自动出款", "自动处理"]);
  const idxManual = findIndex(headers, ["manual_count", "人工处理", "人工出款"]);
  const idxTotalHandleSeconds = findIndex(headers, ["total_handle_seco", "total_handle_second", "total_handle_seconds", "总处理秒", "处理总秒"]);
  const idxHandleCount = findIndex(headers, ["handle_count", "处理笔数", "处理数量"]);

  if (idxDate < 0 || idxPlatform < 0 || idxTotal < 0) return [];

  const defaultCountry = inferCountryFromSheet(sourceSheet);
  const rows: DailyWithdrawRow[] = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const date = normalizeDate(get(row, idxDate));
    const platform = get(row, idxPlatform);
    const rawCountry = idxCountry >= 0 ? (get(row, idxCountry) || defaultCountry) : defaultCountry;
    const country = normalizeAutoCountry(rawCountry, platform);
    const total = idxTotal >= 0 ? toNumber(get(row, idxTotal)) : 0;
    const success = idxSuccess >= 0 ? toNumber(get(row, idxSuccess)) : 0;
    const rejected = idxRejected >= 0 ? toNumber(get(row, idxRejected)) : 0;
    const autoCount = idxAuto >= 0 ? toNumber(get(row, idxAuto)) : 0;
    const manualCount = idxManual >= 0 ? toNumber(get(row, idxManual)) : Math.max(total - autoCount, 0);
    const totalHandleSeconds = idxTotalHandleSeconds >= 0 ? toNumber(get(row, idxTotalHandleSeconds)) : 0;
    const handleCount = idxHandleCount >= 0 ? toNumber(get(row, idxHandleCount)) : total;
    const avgSeconds = handleCount > 0 ? totalHandleSeconds / handleCount : 0;

    if (!date || isAfterAutoWithdrawMaxDate(date)) continue;
    if (!platform) continue;
    if (["盘口", "平台", "合计", "总计", "总数"].includes(platform)) continue;
    if (total === 0 && success === 0 && rejected === 0 && autoCount === 0 && manualCount === 0) continue;

    rows.push({
      country,
      platform,
      total,
      success,
      rejected,
      successRate: total ? success / total : 0,
      rejectRate: total ? rejected / total : 0,
      autoCount,
      manualCount,
      autoRate: total ? autoCount / total : 0,
      manualRate: total ? manualCount / total : 0,
      avgTime: formatDuration(avgSeconds),
      yesterdayAvgTime: "0秒",
      comparePercent: "-",
      sourceSheet,
      date,
      blockTitle: sourceSheet
    });
  }

  return enrichDailyRowsWithPrevious(rows);
}


function rawHeaderKey(value: string): string {
  return normalizeCell(value).toLowerCase().replace(/[^a-z0-9一-龥]+/g, "");
}

function findRawOperatorHeaderIndex(values: Values): number {
  for (let i = 0; i < Math.min(values.length, 20); i++) {
    const keys = (values[i] || []).map(rawHeaderKey);
    const line = keys.join("|");
    const hasDate = keys.some((h) => h === "statdate" || h === "date" || h.includes("日期"));
    const hasPlatform = keys.some((h) => h === "platform" || h.includes("盘口") || h.includes("平台"));
    const hasOperator = keys.some((h) => h === "operator" || h.includes("操作人") || h.includes("后台账号") || h === "account");
    const hasProcessed = /processed(count|cou)?|completed(count|cou)?|已处理|处理笔数/.test(line);
    if (hasDate && hasPlatform && hasOperator && hasProcessed) return i;
  }
  return -1;
}

function findHeaderByKeys(headers: string[], candidates: string[], exclude: string[] = []): number {
  const keys = headers.map(rawHeaderKey);
  const wanted = candidates.map(rawHeaderKey).filter(Boolean);
  const blocked = exclude.map(rawHeaderKey).filter(Boolean);
  return keys.findIndex((h) => {
    if (!h) return false;
    return wanted.some((w) => h === w || h.includes(w) || w.includes(h)) && !blocked.some((b) => h.includes(b));
  });
}


function parseRawOperatorSheetByFixedColumns(values: Values): OperatorRow[] {
  if (!values.length) return [];
  const firstHeader = (values[0] || []).map(rawHeaderKey).join("|");
  const looksHeader = firstHeader.includes("statdate") || firstHeader.includes("日期") || firstHeader.includes("platform") || firstHeader.includes("operator");
  const firstDataDate = normalizeDate(get(values[0], 0));
  const startRow = looksHeader && !/^20\d{2}-\d{2}-\d{2}$/.test(firstDataDate) ? 1 : 0;

  const rows: OperatorRow[] = [];
  for (let r = startRow; r < values.length; r++) {
    const row = values[r] || [];
    const date = normalizeDate(get(row, 0));
    const country = normalizeAutoCountry(get(row, 2) || "未知", get(row, 3));
    const platform = get(row, 3);
    const account = get(row, 4);
    const processed = toNumber(get(row, 5));
    const rejected = toNumber(get(row, 6));
    const totalHandleSeconds = toNumber(get(row, 7));
    const handleCount = toNumber(get(row, 8)) || processed + rejected || processed;
    const avgSeconds = handleCount > 0 ? totalHandleSeconds / handleCount : 0;

    if (!date || !platform || !account) continue;
    if (["platform", "盘口", "平台"].includes(platform.toLowerCase())) continue;
    if (["operator", "后台账号", "账号", "操作人"].includes(account.toLowerCase())) continue;
    if (processed === 0 && rejected === 0 && handleCount === 0) continue;

    rows.push({
      country,
      date,
      platform,
      account,
      processed,
      rejected,
      avgTime: formatDuration(avgSeconds),
      yesterdayAvgTime: "0秒",
      comparePercent: "-"
    });
  }

  return enrichOperatorRowsWithPrevious(rows);
}

export function parseRawOperatorSheet(values: Values): OperatorRow[] {
  // 支持 raw_operator_daily_YYYY_MM：
  // stat_date / system_name / country / platform / operator / processed_count(processed_cou) / reject_count / total_handle_seconds / handle_count / updated_at
  // 这里不要再强制只认 processed_count，否则 Google 表头被截断成 processed_cou 时会读到 raw 行但页面 0。
  // 用户当前 AR_RAW_2026 的 raw_operator_daily_YYYY_MM 是固定 A:J 结构，优先按固定列解析，避免表头自动识别误判。
  const fixedRows = parseRawOperatorSheetByFixedColumns(values);
  if (fixedRows.length) return fixedRows;

  let headerIndex = findRawOperatorHeaderIndex(values);

  // 最后兜底：如果第一行像 raw operator 固定结构，就按 A:J 位置读取。
  if (headerIndex < 0 && values.length > 1) {
    const first = (values[0] || []).map(rawHeaderKey).join("|");
    if (first.includes("statdate") && first.includes("platform")) headerIndex = 0;
  }
  if (headerIndex < 0) return [];

  const headers = values[headerIndex].map(normalizeCell);
  let idxDate = findHeaderByKeys(headers, ["stat_date", "statdate", "date", "日期"]);
  let idxCountry = findHeaderByKeys(headers, ["country", "国家", "地区"]);
  let idxPlatform = findHeaderByKeys(headers, ["platform", "盘口", "平台"]);
  let idxOperator = findHeaderByKeys(headers, ["operator", "后台账号", "账号", "操作人", "employee_id"]);
  let idxProcessed = findHeaderByKeys(headers, ["processed_count", "processed_cou", "processed", "completed_count", "completed_cou", "已处理", "处理笔数"], ["reject", "rejected", "驳回", "拒绝", "total_handle", "avg_handle", "handle_count", "seconds", "秒"]);
  let idxRejected = findHeaderByKeys(headers, ["reject_count", "rejected_count", "reject", "rejected", "驳回", "拒绝"]);
  let idxTotalHandleSeconds = findHeaderByKeys(headers, ["total_handle_seconds", "total_handle_second", "total_handle_seco", "totalhandlesocc", "totalhandleseconds", "total_handle", "处理总秒", "总处理秒"]);
  let idxAvgHandleSeconds = findHeaderByKeys(headers, ["avg_handle_seconds", "avg_handle_second", "avg_handle_seco", "avg_handle", "平均处理秒", "平均处理时长"]);
  let idxHandleCount = findHeaderByKeys(headers, ["handle_count", "handlecount", "处理笔数", "处理数量"]);

  // 固定结构兜底，避免表头拼写变化导致整张操作人表 0 行。
  if (idxDate < 0) idxDate = 0;
  if (idxCountry < 0) idxCountry = 2;
  if (idxPlatform < 0) idxPlatform = 3;
  if (idxOperator < 0) idxOperator = 4;
  if (idxProcessed < 0) idxProcessed = 5;
  if (idxRejected < 0) idxRejected = 6;
  if (idxTotalHandleSeconds < 0) idxTotalHandleSeconds = 7;
  if (idxHandleCount < 0) idxHandleCount = 8;

  const rows: OperatorRow[] = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const date = normalizeDate(get(row, idxDate));
    const platform = get(row, idxPlatform);
    const rawCountry = idxCountry >= 0 ? get(row, idxCountry) : "未知";
    const country = normalizeAutoCountry(rawCountry, platform);
    const account = get(row, idxOperator);
    const processed = toNumber(get(row, idxProcessed));
    const rejected = idxRejected >= 0 ? toNumber(get(row, idxRejected)) : 0;
    const handleCount = idxHandleCount >= 0 ? toNumber(get(row, idxHandleCount)) : (processed + rejected || processed);

    let avgSeconds = 0;
    if (idxAvgHandleSeconds >= 0) {
      avgSeconds = parseDurationToSeconds(get(row, idxAvgHandleSeconds));
    }
    if (!avgSeconds && idxTotalHandleSeconds >= 0) {
      const totalHandleSeconds = toNumber(get(row, idxTotalHandleSeconds));
      avgSeconds = handleCount > 0 ? totalHandleSeconds / handleCount : 0;
    }

    if (!date && !platform && !account && processed === 0 && rejected === 0) continue;
    if (!date || !platform || !account) continue;
    if (["operator", "后台账号", "账号", "操作人"].includes(account.toLowerCase())) continue;

    rows.push({
      country,
      date,
      platform,
      account,
      processed,
      rejected,
      avgTime: formatDuration(avgSeconds),
      yesterdayAvgTime: "0秒",
      comparePercent: "-"
    });
  }

  return enrichOperatorRowsWithPrevious(rows);
}

function enrichOperatorRowsWithPrevious(rows: OperatorRow[]): OperatorRow[] {
  const secondsMap = new Map<string, number>();

  for (const row of rows) {
    const seconds = parseDurationToSeconds(row.avgTime);
    secondsMap.set(`${row.country}|||${row.platform}|||${row.account}|||${row.date}`, seconds);
  }

  return rows.map((row) => {
    const currentSeconds = parseDurationToSeconds(row.avgTime);
    const yesterday = addDays(row.date, -1);
    const previousSeconds = secondsMap.get(`${row.country}|||${row.platform}|||${row.account}|||${yesterday}`) || 0;

    return {
      ...row,
      yesterdayAvgTime: previousSeconds ? formatDuration(previousSeconds) : "0秒",
      comparePercent: comparePercentText(currentSeconds, previousSeconds)
    };
  });
}

export function parseOperatorSheet(values: Values): OperatorRow[] {
  const headerIndex = findHeaderIndex(values, ["日期", "平台", "账号"]);
  if (headerIndex < 0) return [];

  const headerRow = values[headerIndex].map(normalizeCell);
  const starts: number[] = [];

  for (let c = 0; c < headerRow.length; c++) {
    if (headerRow[c] === "日期" && normalizeCell(headerRow[c + 1]).includes("平台")) {
      starts.push(c);
    }
  }

  const rows: OperatorRow[] = [];

  for (let g = 0; g < starts.length; g++) {
    const start = starts[g];
    const end = g + 1 < starts.length ? starts[g + 1] - 1 : start + 7;
    const titleRow = values[headerIndex - 1] || [];
    let country = "未知";

    for (let c = start; c <= end; c++) {
      const title = get(titleRow, c);
      if (title) {
        country = inferCountryFromSheet(title);
        break;
      }
    }

    for (let r = headerIndex + 1; r < values.length; r++) {
      const row = values[r] || [];
      const date = normalizeDate(get(row, start));
      const platform = get(row, start + 1);
      const account = get(row, start + 2);
      const processed = toNumber(get(row, start + 3));
      const rejected = toNumber(get(row, start + 4));

      if (!date && !platform && !account && processed === 0 && rejected === 0) continue;
      if (!platform && !account) continue;
      if (platform === "平台" || account === "后台账号") continue;

      rows.push({
        country: normalizeAutoCountry(country, platform),
        date,
        platform,
        account,
        processed,
        rejected,
        avgTime: get(row, start + 5) || "0秒",
        yesterdayAvgTime: get(row, start + 6) || "0秒",
        comparePercent: get(row, start + 7)
      });
    }
  }

  return rows;
}


function dedupeDailyByBusinessKey(rows: DailyWithdrawRow[]): DailyWithdrawRow[] {
  const map = new Map<string, DailyWithdrawRow>();
  for (const row of rows) {
    const key = `${row.date}|||${row.country}|||${row.platform}`;
    map.set(key, row); // 多个 RAW 表重复时，后面的新表覆盖前面的旧表。
  }
  return Array.from(map.values());
}

function dedupeOperatorByBusinessKey(rows: OperatorRow[]): OperatorRow[] {
  const map = new Map<string, OperatorRow>();
  for (const row of rows) {
    const key = `${row.date}|||${row.country}|||${row.platform}|||${row.account}`;
    map.set(key, row);
  }
  return Array.from(map.values());
}

export function buildPayloadFromSheets(input: Record<string, Values>, operatorSheetName: string, rawOperatorSheetNames: string[] = [], rawDailySheetNames: string[] = []): AutoWithdrawPayload {
  const monthlyRowsFallback: AutoWithdrawRow[] = [];
  const dailyRows: DailyWithdrawRow[] = [];
  let year = "";
  let month = "";

  for (const [sheetName, values] of Object.entries(input)) {
    if (sheetName === operatorSheetName || rawOperatorSheetNames.includes(sheetName) || rawDailySheetNames.includes(sheetName)) continue;

    const dailyParsed = parseDailyCountrySheet(values, sheetName);
    const safeDailyRows = dailyParsed.rows.filter((row) => !isAfterAutoWithdrawMaxDate(row.date));
    dailyRows.push(...safeDailyRows);

    if (!year && dailyParsed.year) year = dailyParsed.year;
    if (!month && dailyParsed.month) month = dailyParsed.month;

    if (!safeDailyRows.length) {
      const monthlyParsed = parseMonthlySheet(values, sheetName);
      monthlyRowsFallback.push(...monthlyParsed.rows);
      if (!year && monthlyParsed.year) year = monthlyParsed.year;
      if (!month && monthlyParsed.month) month = monthlyParsed.month;
    }
  }

  const rawDailyRows = dedupeDailyByBusinessKey(rawDailySheetNames
    .flatMap((sheetName) => parseRawDailySheet(input[sheetName] || [], sheetName))
    .filter((row) => !isAfterAutoWithdrawMaxDate(row.date)));
  // 如果存在 raw_daily_YYYY_MM 原始日汇总，优先使用它。
  // 这样 5 月、月底补入的数据不会因为旧展示表没更新而显示 0。
  const finalDailyRows = rawDailyRows.length ? rawDailyRows : dailyRows;

  const rawOperatorRows = dedupeOperatorByBusinessKey(rawOperatorSheetNames
    .flatMap((sheetName) => parseRawOperatorSheet(input[sheetName] || []))
    .filter((row) => !isAfterAutoWithdrawMaxDate(row.date)));
  const operatorRows = dedupeOperatorByBusinessKey((rawOperatorRows.length ? rawOperatorRows : parseOperatorSheet(input[operatorSheetName] || []))
    .filter((row) => !isAfterAutoWithdrawMaxDate(row.date)));

  const monthlyRows = finalDailyRows.length ? aggregateWithdrawRows(finalDailyRows) : monthlyRowsFallback;
  const allDates = [...finalDailyRows.map((row) => row.date), ...operatorRows.map((row) => row.date)]
    .filter((date) => /^20\d{2}-\d{2}-\d{2}$/.test(date) && !isAfterAutoWithdrawMaxDate(date))
    .sort();
  const firstDate = allDates[0] || "";

  return {
    meta: {
      year: cleanMetaYear(year, firstDate ? firstDate.slice(0, 4) : ""),
      month: cleanMetaMonth(month, firstDate ? String(Number(firstDate.slice(5, 7))) : ""),
      updatedAt: new Date().toISOString(),
      source: "google-sheet"
    },
    monthlyRows,
    dailyRows: finalDailyRows,
    operatorRows
  };
}
