import type { CustomerServicePayload, CustomerServiceRow } from "./types";
import { normalizeCell, toNumber } from "./format";

type Values = string[][];

type ParsedSheet = {
  rows: CustomerServiceRow[];
  headers: string[];
};

function get(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return "";
  return normalizeCell(row[index]);
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function colName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function norm(value: string): string {
  return normalizeCell(value).replace(/[\s　:_：\-\/\\（）()【】\[\]]/g, "").toLowerCase();
}

function dedupeHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const base = normalizeCell(header) || `列${colName(index)}`;
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
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

  match = raw.match(/(20\d{2})[\-\/.](\d{1,2})[\-\/.](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return "";
}

function countryFromText(text: string): string {
  const value = normalizeCell(text);
  if (!value) return "";
  if (value.includes("胖虎巴西")) return "胖虎巴西";
  if (value.includes("巴基斯坦")) return "巴基斯坦";
  if (value.includes("菲律宾")) return "菲律宾";
  if (value.includes("尼日利亚")) return "尼日利亚";
  if (value.includes("印度唤醒")) return "印度唤醒";
  if (value.includes("印度原生")) return "印度原生";
  if (value.includes("印度")) return "印度";
  if (value.includes("南美")) return "南美";
  if (value.includes("巴西")) return "巴西";
  if (value.includes("越南")) return "越南";
  if (value.includes("印尼")) return "印尼";
  if (value.includes("缅甸")) return "缅甸";
  if (value.includes("马来")) return "马来";
  if (value.toUpperCase().includes("USDT")) return "USDT通道";
  return "";
}

function looksLikeHeader(row: string[]): number {
  const joined = row.map(norm).join("|");
  const nonEmpty = row.map(normalizeCell).filter(Boolean).length;
  if (nonEmpty < 2) return 0;

  let score = nonEmpty;
  const words = [
    "日期", "时间", "客服", "员工", "操作人", "后台账号", "账号", "姓名", "国家", "地区",
    "平台", "盘口", "站点", "组别", "部门", "团队", "岗位", "类型", "数量", "笔数",
    "成功", "失败", "回复", "接待", "会话", "满意", "处理", "已处理", "驳回", "待处理",
    "总数", "总量", "人数", "有效", "无效", "时长"
  ];
  for (const word of words) if (joined.includes(norm(word))) score += 5;
  if (/^\d+$/.test(row[0] || "")) score -= 4;
  return score;
}

function findHeaderIndex(values: Values): number {
  let bestIndex = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(values.length, 60); r++) {
    const score = looksLikeHeader(values[r] || []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = r;
    }
  }
  if (bestIndex >= 0 && bestScore >= 8) return bestIndex;
  return values.findIndex((row) => (row || []).map(normalizeCell).filter(Boolean).length >= 2);
}

function findHeader(headers: string[], words: string[]): number {
  const keys = words.map(norm).filter(Boolean);
  return headers.findIndex((header) => {
    const h = norm(header);
    if (!h) return false;
    return keys.some((key) => h === key || h.includes(key) || key.includes(h));
  });
}

function isContextHeader(header: string): boolean {
  const h = norm(header);
  const contextKeys = [
    "日期", "时间", "date", "国家", "地区", "country", "平台", "盘口", "站点", "platform",
    "客服", "员工", "姓名", "账号", "后台账号", "操作人", "staff", "operator", "团队", "部门", "组别", "岗位", "班次",
    "序号", "no", "编号", "备注", "remark", "说明", "说明内容", "来源", "source"
  ].map(norm);
  return contextKeys.some((key) => h === key || h.includes(key) || key.includes(h));
}

function isMetricHeader(header: string): boolean {
  const h = norm(header);
  if (!h || isContextHeader(header)) return false;
  if (/率|占比|百分|比例|环比|同比/.test(header)) return false;
  return true;
}

function inferMetricColumns(headers: string[], dataRows: string[][]): number[] {
  const result: number[] = [];
  for (let c = 0; c < headers.length; c++) {
    const header = headers[c] || `列${colName(c)}`;
    if (!isMetricHeader(header)) continue;

    let numericHits = 0;
    let nonEmptyHits = 0;
    for (let r = 0; r < Math.min(dataRows.length, 120); r++) {
      const value = get(dataRows[r], c);
      if (!value) continue;
      nonEmptyHits += 1;
      if (toNumber(value) !== 0 || /^0(?:\.0+)?$/.test(value.replace(/,/g, ""))) numericHits += 1;
    }

    // 客服统计最重要是数值列；如果标题像数量/笔数/成功/失败，也保留。
    if (numericHits > 0 || /数量|笔数|总数|处理|成功|失败|驳回|回复|接待|会话|满意|金额|人数|时长/.test(header)) {
      result.push(c);
    }
  }
  return result;
}

function isTotalRow(text: string): boolean {
  const value = normalizeCell(text);
  if (!value) return false;
  if (/^(合计|总计|总数|汇总)$/.test(value)) return true;
  if (/^(合计|总计|总数|汇总)\s*[:：]/.test(value)) return true;
  return false;
}


function metricHeaderLabel(header: string): string {
  return normalizeCell(header).replace(/_\d+$/, "") || "指标";
}

function looksLikeCountryHeader(header: string): boolean {
  const h = norm(header);
  return h.includes("盘口国家") || h === "国家" || h.includes("国家") || h.includes("地区") || h.includes("country");
}

function looksLikePlatformHeader(header: string): boolean {
  const h = norm(header);
  return h === "盘口" || h.includes("盘口") || h.includes("平台") || h.includes("站点") || h.includes("platform");
}

function findDateNearBlock(values: Values, headerRow: number, start: number, end: number): string {
  const left = Math.max(0, start - 2);
  const right = Math.max(end, start);
  for (let r = Math.max(0, headerRow - 5); r < headerRow; r++) {
    for (let c = left; c <= right; c++) {
      const date = parseDate(get(values[r], c));
      if (date) return date;
    }
  }
  // 有些表格合并单元格的日期会落在指标列，不一定落在盘口国家列上；再往右多扫一点。
  for (let r = Math.max(0, headerRow - 5); r < headerRow; r++) {
    for (let c = start; c <= Math.min((values[r] || []).length - 1, end + 8); c++) {
      const date = parseDate(get(values[r], c));
      if (date) return date;
    }
  }
  return "";
}

function parseHorizontalDailyBlocks(sheetName: string, values: Values): ParsedSheet {
  const rows: CustomerServiceRow[] = [];
  const headersSeen = new Set<string>();
  const maxRows = Math.min(values.length, 120);

  for (let headerIndex = 0; headerIndex < maxRows; headerIndex++) {
    const headerRow = values[headerIndex] || [];
    const starts: number[] = [];
    for (let c = 0; c < headerRow.length; c++) {
      const current = get(headerRow, c);
      const next = get(headerRow, c + 1);
      const after = get(headerRow, c + 2);
      if (looksLikeCountryHeader(current) && (looksLikePlatformHeader(next) || looksLikePlatformHeader(after))) {
        starts.push(c);
      }
    }
    if (!starts.length) continue;

    const blockHasDate = starts.some((start, index) => {
      const end = (starts[index + 1] ?? headerRow.length) - 1;
      return !!findDateNearBlock(values, headerIndex, start, end);
    });
    if (!blockHasDate) continue;

    for (let blockIndex = 0; blockIndex < starts.length; blockIndex++) {
      const start = starts[blockIndex];
      const end = (starts[blockIndex + 1] ?? headerRow.length) - 1;
      const date = findDateNearBlock(values, headerIndex, start, end);
      if (!date) continue;

      let countryIdx = -1;
      let platformIdx = -1;
      const metricColumns: number[] = [];

      for (let c = start; c <= end; c++) {
        const header = get(headerRow, c);
        if (!header) continue;
        if (countryIdx < 0 && looksLikeCountryHeader(header)) countryIdx = c;
        if (platformIdx < 0 && looksLikePlatformHeader(header)) platformIdx = c;
      }
      if (countryIdx < 0) countryIdx = start;
      if (platformIdx < 0) platformIdx = start + 1;

      for (let c = start; c <= end; c++) {
        if (c === countryIdx || c === platformIdx) continue;
        const header = get(headerRow, c);
        if (!header || !isMetricHeader(header)) continue;

        let numericHits = 0;
        for (let r = headerIndex + 1; r < Math.min(values.length, headerIndex + 90); r++) {
          const raw = get(values[r], c);
          if (!raw) continue;
          if (toNumber(raw) !== 0 || /^0(?:\.0+)?$/.test(raw.replace(/,/g, ""))) numericHits += 1;
        }
        if (numericHits > 0 || /总客服|客服数|成功|失败|驳回|自动|人工|处理|数量|笔数/.test(header)) {
          metricColumns.push(c);
          headersSeen.add(metricHeaderLabel(header));
        }
      }

      if (!metricColumns.length) continue;

      let blankStreak = 0;
      for (let r = headerIndex + 1; r < values.length; r++) {
        const row = values[r] || [];
        const blockFilled = row.slice(start, end + 1).map(normalizeCell).filter(Boolean);
        if (!blockFilled.length) {
          blankStreak += 1;
          if (blankStreak >= 8) break;
          continue;
        }
        blankStreak = 0;

        const firstCell = get(row, countryIdx) || blockFilled[0] || "";
        const joined = blockFilled.join(" ");
        if (isTotalRow(firstCell) || /#DIV\/0!/i.test(joined)) continue;
        // 跳过重复表头行。
        if (looksLikeCountryHeader(firstCell) && looksLikePlatformHeader(get(row, platformIdx))) continue;

        const countryRaw = get(row, countryIdx);
        const platform = get(row, platformIdx);
        if (!countryRaw && !platform) continue;
        if (!platform && /^\d+(?:\.\d+)?%?$/.test(countryRaw)) continue;

        const country = countryFromText(countryRaw) || countryRaw || countryFromText(sheetName) || "未填写";
        const fields: Record<string, string> = {
          统计日期: date,
          页签: sheetName,
          [metricHeaderLabel(get(headerRow, countryIdx)) || "国家"]: countryRaw,
          [metricHeaderLabel(get(headerRow, platformIdx)) || "平台"]: platform,
        };
        for (let c = start; c <= end; c++) {
          const header = metricHeaderLabel(get(headerRow, c));
          const value = get(row, c);
          if (header && value) fields[header] = value;
        }

        for (const col of metricColumns) {
          const rawValue = get(row, col);
          if (!rawValue) continue;
          const n = toNumber(rawValue);
          if (n === 0 && !/^0(?:\.0+)?$/.test(rawValue.replace(/,/g, ""))) continue;
          const metricName = metricHeaderLabel(get(headerRow, col));
          rows.push({
            id: `${sheetName}-${date}-${r + 1}-${colName(col)}`,
            sheetName,
            sourceRow: r + 1,
            date,
            country,
            platform,
            staff: "",
            team: "",
            metricName,
            metricValue: n,
            rawText: joined,
            fields,
          });
        }
      }
    }
  }

  const uniqueRows = new Map<string, CustomerServiceRow>();
  for (const row of rows) uniqueRows.set(row.id, row);
  return { rows: Array.from(uniqueRows.values()), headers: Array.from(headersSeen) };
}

function parseSheet(sheetName: string, values: Values): ParsedSheet {
  // 客服表常见格式是：同一个页签横向放 5月1日、5月2日... 每天一块。
  // 先按日期块读取，避免把 5月2日的数据错误套到 5月1日的平台上。
  const horizontal = parseHorizontalDailyBlocks(sheetName, values);
  if (horizontal.rows.length) return horizontal;

  const headerIndex = findHeaderIndex(values);
  if (headerIndex < 0) return { rows: [], headers: [] };

  const headers = dedupeHeaders(values[headerIndex] || []);
  const dataRows = values.slice(headerIndex + 1);
  const idxDate = findHeader(headers, ["日期", "时间", "统计日期", "date"]);
  const idxCountry = findHeader(headers, ["国家", "地区", "country"]);
  const idxPlatform = findHeader(headers, ["平台", "盘口", "站点", "platform"]);
  const idxStaff = findHeader(headers, ["客服", "员工", "姓名", "账号", "后台账号", "操作人", "staff", "operator"]);
  const idxTeam = findHeader(headers, ["团队", "部门", "组别", "岗位", "班次"]);
  const metricColumns = inferMetricColumns(headers, dataRows);

  const rows: CustomerServiceRow[] = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const filled = row.map(normalizeCell).filter(Boolean);
    if (!filled.length) continue;
    const joined = filled.join(" ");
    if (isTotalRow(filled[0] || joined)) continue;

    const fields: Record<string, string> = {};
    headers.forEach((header, index) => {
      const value = get(row, index);
      if (value) fields[header] = value;
    });

    let date = idxDate >= 0 ? parseDate(get(row, idxDate)) : "";
    if (!date) {
      for (const cell of row) {
        date = parseDate(cell);
        if (date) break;
      }
    }

    let country = idxCountry >= 0 ? get(row, idxCountry) : "";
    if (!country) country = countryFromText(sheetName) || countryFromText(joined);
    const platform = idxPlatform >= 0 ? get(row, idxPlatform) : "";
    const staff = idxStaff >= 0 ? get(row, idxStaff) : "";
    const team = idxTeam >= 0 ? get(row, idxTeam) : "";

    let emitted = 0;
    for (const col of metricColumns) {
      const rawValue = get(row, col);
      if (!rawValue) continue;
      const n = toNumber(rawValue);
      const header = headers[col] || `列${colName(col)}`;
      // 空白跳过，0 也保留一次，方便看“有人但没处理”的数据。
      if (n === 0 && !/^0(?:\.0+)?$/.test(rawValue.replace(/,/g, ""))) continue;
      rows.push({
        id: `${sheetName}-${r + 1}-${colName(col)}`,
        sheetName,
        sourceRow: r + 1,
        date,
        country,
        platform,
        staff,
        team,
        metricName: header,
        metricValue: n,
        rawText: joined,
        fields,
      });
      emitted += 1;
    }

    if (!emitted) {
      rows.push({
        id: `${sheetName}-${r + 1}-record`,
        sheetName,
        sourceRow: r + 1,
        date,
        country,
        platform,
        staff,
        team,
        metricName: "记录数",
        metricValue: 1,
        rawText: joined,
        fields,
      });
    }
  }

  return { rows, headers };
}

export function buildCustomerServicePayload(sheetValues: Record<string, Values>): CustomerServicePayload {
  const allRows: CustomerServiceRow[] = [];
  const allHeaders = new Set<string>();
  const sheets = Object.keys(sheetValues).filter(Boolean);

  for (const sheetName of sheets) {
    const parsed = parseSheet(sheetName, sheetValues[sheetName] || []);
    parsed.rows.forEach((row) => allRows.push(row));
    parsed.headers.forEach((header) => allHeaders.add(header));
  }

  const rows = allRows.sort((a, b) => {
    return (b.date || "").localeCompare(a.date || "") ||
      a.sheetName.localeCompare(b.sheetName, "zh-CN") ||
      a.sourceRow - b.sourceRow ||
      a.metricName.localeCompare(b.metricName, "zh-CN");
  });
  const metricTotal = rows.reduce((sum, row) => sum + (row.metricValue || 0), 0);
  const dates = uniq(rows.map((row) => row.date).filter(Boolean)).sort();
  const latest = dates[dates.length - 1] || "";
  const now = new Date();

  return {
    meta: {
      year: latest ? latest.slice(0, 4) : String(now.getFullYear()),
      month: latest ? String(Number(latest.slice(5, 7))) : String(now.getMonth() + 1),
      updatedAt: now.toISOString(),
      source: "google-sheet",
      sheets,
      headers: Array.from(allHeaders),
    },
    rows,
    summary: {
      rows: rows.length,
      sheets: sheets.length,
      countries: uniq(rows.map((row) => row.country)).length,
      platforms: uniq(rows.map((row) => row.platform)).length,
      staff: uniq(rows.map((row) => row.staff)).length,
      teams: uniq(rows.map((row) => row.team)).length,
      metricTotal,
    },
  };
}
