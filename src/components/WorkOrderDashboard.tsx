"use client";

// V91_WORKORDER_RESTRUCTURE: 一级改为 工单统计 / 工单日表 / 操作人统计；员工/类型明细全表读取；工单日表查看弹窗按子工单类型汇总；移除待处理/处理中展示。

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkOrderPayload, WorkOrderRow } from "@/lib/types";
import CustomerServiceDashboard from "./CustomerServiceDashboard";
import { formatNumber, formatPercent } from "@/lib/format";
import { monthRangeSignature, monthlyApiUrl, rangeIncludesCurrentMonthClient } from "@/lib/monthRange";
import { fetchPreferredMonthlyStatus, payloadSnapshotMonth, statusMatchesPayload } from "@/lib/monthlyStatusClient";

type LoadState = "loading" | "ready" | "error";
type MainTab = "orders" | "operators" | "customer";
type OrderView = "orderDashboard" | "orderDaily" | "orderMonthly" | "orderTypePlatform" | "orderTypeCountry" | "orderAnomaly";
type OperatorView = "operatorSummary" | "operatorDetail" | "operatorCompare";
type WorkView = OrderView | OperatorView;
type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection };

type WorkFilters = {
  countries: string[];
  platforms: string[];
  types: string[];
  names: string[];
  accountTypes: string[];
  operators: string[];
  startDate: string;
  endDate: string;
};

type CsvColumn<T> = {
  label: string;
  value: (row: T) => string | number;
};

type SummaryRow = {
  date?: string;
  country: string;
  platform: string;
  workType: string;
  workName: string;
  operator: string;
  total: number;
  success: number;
  failed: number;
  pending: number;
  amount: number;
  auto: number;
  manual: number;
};



type CountryTypeShareRow = SummaryRow & {
  countryTotal: number;
  countrySuccess: number;
  countryFailed: number;
  countryPending: number;
  share: number;
  auto: number;
  manual: number;
  autoRate: number;
  manualRate: number;
};

type LowRow = {
  country: string;
  platform: string;
  operator: string;
  days: number;
  lowDays: number;
  total: number;
  avg: number;
  dates: string;
};

type DetailModal = {
  title: string;
  subtitle: string;
  rows: WorkOrderRow[];
  summary?: ReturnType<typeof summarize>;
};

type SummaryModal = {
  title: string;
  subtitle: string;
  rows: SummaryRow[];
  targetView: WorkView;
};

type CompareMode = "day" | "week" | "month";

const EMPTY_FILTERS: WorkFilters = {
  countries: [],
  platforms: [],
  types: [],
  names: [],
  accountTypes: [],
  operators: [],
  startDate: "",
  endDate: ""
};

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
}

const WORK_COUNTRY_PRIORITY = [
  "印度", "巴基斯坦", "印尼", "马来", "缅甸", "尼日利亚",
  "越南", "菲律宾", "南美", "胖虎巴西", "哥伦比亚", "墨西哥", "智利", "埃及",
  "巴西"
];

function workCountryRank(country: string): number {
  const normalized = String(country || "").replace(/原生|盘口|线下|地区/g, "").trim();
  const index = WORK_COUNTRY_PRIORITY.findIndex((item) => normalized === item || String(country || "").includes(item));
  return index >= 0 ? index : WORK_COUNTRY_PRIORITY.length + 1;
}

function sortWorkCountries(values: string[]): string[] {
  return uniq(values).sort((a, b) => workCountryRank(a) - workCountryRank(b) || a.localeCompare(b, "zh-CN", { numeric: true }));
}

function isSummaryWorkText(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return true;
  const compact = text.replace(/[\s　_\-\/\\:：（）()【】\[\]]/g, "").toLowerCase();
  return ["工单统计", "操作人统计", "工单", "全部工单", "全部类型", "平台日汇总", "国家汇总", "平台汇总", "日汇总", "总汇总", "total", "daily", "platformdaily"].includes(compact) || compact.includes("汇总") || compact.includes("统计");
}

function isRealWorkType(type: string): boolean {
  return !isSummaryWorkText(type);
}

function isRealWorkName(name: string): boolean {
  return !isSummaryWorkText(name);
}

function isIsoDate(value: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value);
}

function inDateRange(date: string, startDate: string, endDate: string): boolean {
  if (!isIsoDate(date)) return true;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function monthOverlaps(date: string, startDate: string, endDate: string): boolean {
  if (!isIsoDate(date)) return true;
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEnd = `${date.slice(0, 7)}-31`;
  if (endDate && monthStart > endDate) return false;
  if (startDate && monthEnd < startDate) return false;
  return true;
}

function rowDateMatches(row: WorkOrderRow, startDate: string, endDate: string): boolean {
  // 标准 RAW 的 type 行有真实 stat_date，必须严格跟随筛选日期。
  // 只有旧展示页里解析出来的“类型月汇总”才按整月重叠保留。
  if (row.kind === "type" && String(row.status || "").includes("类型月汇总")) return monthOverlaps(row.date, startDate, endDate);
  return inDateRange(row.date, startDate, endDate);
}

function normalizeFilterText(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[\s　_\-\/\:：,，.。·•（）()【】\[\]]/g, "")
    .toLowerCase();
}

function matchesSelection(value: string, selected: string[]): boolean {
  if (!selected.length) return true;
  const normalized = normalizeFilterText(value);
  return selected.some((item) => normalizeFilterText(item) === normalized);
}

function matchesLooseSelection(value: string, selected: string[]): boolean {
  if (!selected.length) return true;
  const normalized = normalizeFilterText(value);
  return selected.some((item) => {
    const target = normalizeFilterText(item);
    return !!target && (normalized === target || normalized.includes(target) || target.includes(normalized));
  });
}

const WORK_ROLE_LABELS = new Set([
  "客服", "查单", "彩金", "改卡", "入款", "出款", "风控", "运营", "主管", "组长", "管理员", "自动处理", "人工处理", "全部岗位", "岗位", "账号类型"
].map(normalizeFilterText));

function isRoleLikeWorkType(value: string): boolean {
  const normalized = normalizeFilterText(value);
  if (!normalized) return true;
  // 只排除“完全等于岗位”的值，不能把“一对一客服”误排除。
  return WORK_ROLE_LABELS.has(normalized);
}

function isValidWorkTypeOption(value: string, accountTypes: Set<string> = new Set(), workNames: Set<string> = new Set()): boolean {
  const normalized = normalizeFilterText(value);
  if (!normalized || isSummaryWorkText(value)) return false;
  if (isRoleLikeWorkType(value)) return false;
  // 有些 RAW 表把 account_type 或 work_name 误读到 workType，这里兜底排除。
  if (accountTypes.has(normalized)) return false;
  if (workNames.has(normalized)) return false;
  return true;
}

function rowMatchesWorkTypeFilter(row: WorkOrderRow, selected: string[]): boolean {
  if (!selected.length) return true;
  const value = normalizeFilterText(row.workType || "");
  if (!value || isSummaryWorkText(row.workType || "")) return false;
  if (isRoleLikeWorkType(row.workType || "")) return false;
  return selected.some((item) => {
    const target = normalizeFilterText(item);
    if (!target) return false;
    // 工单类型必须按“工单类型”字段精确匹配。
    // 只允许目标值很完整时做单向包含，避免“一对一客服”误匹配到岗位“客服”。
    return value === target || (target.length >= 4 && value.includes(target));
  });
}

function filterLabel(values: string[], allText = "全部"): string {
  if (!values.length) return allText;
  if (values.length <= 2) return values.join("、");
  return `${values.slice(0, 2).join("、")} 等 ${values.length} 项`;
}

function summaryRowKey(row: Pick<SummaryRow, "date" | "country" | "platform" | "workType" | "workName" | "operator">): string {
  return [row.date || "", row.country || "", row.platform || "", row.workType || "", row.workName || "", row.operator || ""].join("|||");
}

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const header = columns.map((c) => escapeCsv(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsv(c.value(row))).join(",")).join("\n");
  const csv = `\ufeff${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function sortRows<T>(rows: T[], sort: SortState, getValue: (row: T, key: string) => string | number): T[] {
  return [...rows].sort((a, b) => {
    const av = getValue(a, sort.key);
    const bv = getValue(b, sort.key);
    let result = 0;
    if (typeof av === "number" && typeof bv === "number") result = av - bv;
    else result = String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN", { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
}

function aggregate(rows: WorkOrderRow[], keys: Array<keyof SummaryRow>): SummaryRow[] {
  const map = new Map<string, SummaryRow>();
  for (const row of rows) {
    const key = keys.map((k) => String((row as unknown as Record<string, string | number>)[k] || "-")).join("|||");
    const item = map.get(key) || {
      date: keys.includes("date") ? row.date || "-" : undefined,
      country: keys.includes("country") ? row.country : "全部国家",
      platform: keys.includes("platform") ? row.platform : "全部平台",
      workType: keys.includes("workType") ? row.workType : "全部类型",
      workName: keys.includes("workName") ? row.workName : "全部工单",
      operator: keys.includes("operator") ? row.operator : "全部操作人",
      total: 0,
      success: 0,
      failed: 0,
      pending: 0,
      amount: 0,
      auto: 0,
      manual: 0
    };
    const am = autoManualForRow(row);
    item.total += row.total;
    item.success += row.success;
    item.failed += row.failed;
    item.pending += row.pending;
    item.amount += row.amount;
    item.auto += am.auto;
    item.manual += am.manual;
    map.set(key, item);
  }
  return Array.from(map.values());
}


function detailValue(value: string): string {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function detailRowKey(row: WorkOrderRow): string {
  return [
    row.kind || "generic",
    row.date || "",
    detailValue(row.country),
    detailValue(row.platform),
    detailValue(row.workType),
    detailValue(row.workName),
    detailValue(row.operator),
    Math.round(row.total || 0),
    Math.round(row.success || 0),
    Math.round(row.failed || 0),
    Math.round(row.pending || 0)
  ].join("|||");
}

function dedupeDetailRows(rows: WorkOrderRow[]): WorkOrderRow[] {
  const map = new Map<string, WorkOrderRow>();
  for (const row of rows) {
    const key = detailRowKey(row);
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function aggregateDetailTypeRows(rows: WorkOrderRow[], sourceLabel = "子工单类型汇总"): WorkOrderRow[] {
  const map = new Map<string, WorkOrderRow & { autoCount?: number; manualCount?: number }>();
  for (const row of rows) {
    const workType = row.workType && !isSummaryWorkText(row.workType) ? row.workType : "未分类";
    const workName = row.workName && !isSummaryWorkText(row.workName) ? row.workName : workType;
    const key = [row.date || "", detailValue(row.country), detailValue(row.platform), detailValue(workType), detailValue(workName)].join("|||");
    const current = map.get(key) || {
      ...row,
      id: `detail-type-${key}`,
      workType,
      workName,
      operator: "全部操作人",
      total: 0,
      success: 0,
      failed: 0,
      pending: 0,
      amount: 0,
      sourceSheet: sourceLabel,
      sourceRow: 0,
      status: sourceLabel,
      autoCount: 0,
      manualCount: 0
    };
    const am = autoManualForRow(row);
    current.total += row.total || 0;
    current.success += row.success || 0;
    current.failed += row.failed || 0;
    current.pending += row.pending || 0;
    current.amount += row.amount || 0;
    current.autoCount = (current.autoCount || 0) + am.auto;
    current.manualCount = (current.manualCount || 0) + am.manual;
    current.status = `${sourceLabel} · 自动 ${current.autoCount || 0} · 人工 ${current.manualCount || 0}`;
    map.set(key, current);
  }
  return Array.from(map.values())
    .map(({ autoCount, manualCount, ...row }) => row)
    .sort((a, b) => b.total - a.total || a.workType.localeCompare(b.workType, "zh-CN") || a.workName.localeCompare(b.workName, "zh-CN"));
}

function summaryValue(row: SummaryRow | LowRow, key: string): string | number {
  if ("lowDays" in row) {
    switch (key) {
      case "country": return row.country;
      case "platform": return row.platform;
      case "operator": return row.operator;
      case "days": return row.days;
      case "lowDays": return row.lowDays;
      case "total": return row.total;
      case "avg": return row.avg;
      default: return "";
    }
  }
  switch (key) {
    case "date": return row.date || "";
    case "country": return row.country;
    case "platform": return row.platform;
    case "workType": return row.workType;
    case "workName": return row.workName;
    case "operator": return row.operator;
    case "total": return row.total;
    case "success": return row.success;
    case "failed": return row.failed;
    case "pending": return row.pending;
    case "amount": return row.amount;
    case "successRate": return row.total ? row.success / row.total : 0;
    case "failedRate": return row.total ? row.failed / row.total : 0;
    case "pendingRate": return row.total ? row.pending / row.total : 0;
    case "manualRate": return (row as Partial<CountryTypeShareRow>).manualRate ?? 0;
    case "autoRate": return (row as Partial<CountryTypeShareRow>).autoRate ?? 0;
    case "manual": return (row as Partial<CountryTypeShareRow>).manual ?? 0;
    case "auto": return (row as Partial<CountryTypeShareRow>).auto ?? 0;
    case "share": return (row as Partial<CountryTypeShareRow>).share ?? 0;
    case "countryPending": return (row as Partial<CountryTypeShareRow>).countryPending ?? 0;
    case "countryFailed": return (row as Partial<CountryTypeShareRow>).countryFailed ?? 0;
    case "countrySuccess": return (row as Partial<CountryTypeShareRow>).countrySuccess ?? 0;
    case "countryTotal": return (row as Partial<CountryTypeShareRow>).countryTotal ?? 0;
    default: return "";
  }
}

function summarize(rows: WorkOrderRow[]) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const success = rows.reduce((sum, row) => sum + row.success, 0);
  const failed = rows.reduce((sum, row) => sum + row.failed, 0);
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  const amount = rows.reduce((sum, row) => sum + row.amount, 0);
  const autoManual = parseAutoManualRows(rows);
  return {
    total,
    success,
    failed,
    pending,
    amount,
    auto: autoManual.auto,
    manual: autoManual.manual,
    autoRate: autoManual.autoRate,
    manualRate: autoManual.manualRate,
    successRate: total ? success / total : 0,
    failedRate: total ? failed / total : 0,
    pendingRate: total ? pending / total : 0,
    countries: uniq(rows.map((r) => r.country)).length,
    platforms: uniq(rows.map((r) => r.platform)).length,
    types: uniq(rows.map((r) => r.workType)).length,
    names: uniq(rows.map((r) => r.workName)).length,
    operators: uniq(rows.map((r) => r.operator)).length
  };
}

function titleForView(view: WorkView) {
  const map: Record<WorkView, string> = {
    orderDashboard: "工单看板",
    orderDaily: "工单日表",
    orderMonthly: "工单月表",
    orderTypePlatform: "各类型统计（已合并到国家页）",
    orderTypeCountry: "各国家类型占比（已移除）",
    orderAnomaly: "工单异常提醒（已隐藏）",
    operatorSummary: "操作人汇总表",
    operatorDetail: "操作人明细",
    operatorCompare: "操作人对比"
  };
  return map[view];
}

function subtitleForView(view: WorkView) {
  const map: Record<WorkView, string> = {
    orderDashboard: "按日期、国家、平台读取每日工单，并把类型统计单独分开，避免重复计算。",
    orderDaily: "按盘口按钮切换国家，表格显示日期 / 平台每日汇总；点展开可直接查看该平台当天包含的子工单类型。",
    orderMonthly: "按月份 + 国家 + 平台汇总，选 5 月就是 5 月总数据，不会每天重复一行。",
    orderTypePlatform: "已合并到工单日表/工单月表的国家页下方，不再单独显示页签。",
    orderTypeCountry: "这个页面已移除，请使用各平台类型统计。",
    orderAnomaly: "已隐藏，不参与主页面展示。",
    operatorSummary: "按操作人汇总处理量、驳回、平台和国家，适合看每个人整体表现。",
    operatorDetail: "按日期 / 平台 / 操作人查看明细；国家用上方盘口按钮切换。",
    operatorCompare: "合并原来的操作人排行榜和连续低处理观察，用于对比处理量和低处理人员。"
  };
  return map[view];
}


type AutoManualSummary = {
  auto: number;
  manual: number;
  autoRate: number;
  manualRate: number;
};

function isAutoOperatorName(value: string): boolean {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  return ["admin", "system", "auto", "robot", "机器人", "自动"].some((item) => text === item || text.includes(item));
}

function autoManualForRow(row: WorkOrderRow): { auto: number; manual: number } {
  const status = String(row.status || "");
  const autoMatch = status.match(/自动\s*(\d+(?:\.\d+)?)/);
  const manualMatch = status.match(/人工\s*(\d+(?:\.\d+)?)/);
  let auto = 0;
  let manual = 0;
  let matched = false;

  if (autoMatch) {
    auto += Number(autoMatch[1] || 0);
    matched = true;
  }
  if (manualMatch) {
    manual += Number(manualMatch[1] || 0);
    matched = true;
  }

  if (!matched) {
    if (isAutoOperatorName(row.operator)) auto += row.total;
    else if (row.operator) manual += row.total;
  }

  if (row.total > 0 && auto + manual > row.total) {
    const sum = auto + manual;
    auto = Math.round((auto / sum) * row.total);
    manual = Math.max(0, row.total - auto);
  }

  return { auto, manual };
}

function parseAutoManualRows(rows: WorkOrderRow[]): AutoManualSummary {
  let auto = 0;
  let manual = 0;
  for (const row of rows) {
    const am = autoManualForRow(row);
    auto += am.auto;
    manual += am.manual;
  }
  const total = auto + manual;
  return { auto, manual, autoRate: total ? auto / total : 0, manualRate: total ? manual / total : 0 };
}


function synthesizeClientDailyRows(rows: WorkOrderRow[]): WorkOrderRow[] {
  const explicitDaily = rows.filter((row) => row.kind === "daily");
  const explicitKeys = new Set(explicitDaily.map((row) => `${row.date}|||${row.country}|||${row.platform}`));
  const operatorGroups = new Map<string, WorkOrderRow[]>();
  const typeGroups = new Map<string, WorkOrderRow[]>();
  for (const row of rows) {
    if (!row.date || !row.country || !row.platform) continue;
    const key = `${row.date}|||${row.country}|||${row.platform}`;
    if (row.kind === "operator") operatorGroups.set(key, [...(operatorGroups.get(key) || []), row]);
    if (row.kind === "type") typeGroups.set(key, [...(typeGroups.get(key) || []), row]);
  }
  const synthetic: WorkOrderRow[] = [];
  const keys = Array.from(new Set([...operatorGroups.keys(), ...typeGroups.keys()]));
  for (const key of keys) {
    if (explicitKeys.has(key)) continue;
    const source = operatorGroups.get(key)?.length ? operatorGroups.get(key)! : (typeGroups.get(key) || []);
    if (!source.length) continue;
    const [date, country, platform] = key.split("|||");
    let auto = 0;
    let manual = 0;
    for (const row of source) {
      const am = autoManualForRow(row);
      auto += am.auto;
      manual += am.manual;
    }
    synthetic.push({
      id: `client-daily-${key}`,
      kind: "daily",
      date,
      country,
      platform,
      workType: "工单统计",
      workName: "平台日汇总",
      operator: "",
      accountType: "",
      total: source.reduce((sum, row) => sum + row.total, 0),
      success: source.reduce((sum, row) => sum + row.success, 0),
      failed: source.reduce((sum, row) => sum + row.failed, 0),
      pending: source.reduce((sum, row) => sum + row.pending, 0),
      amount: source.reduce((sum, row) => sum + row.amount, 0),
      status: `前端按当前筛选汇总 · 自动 ${Math.round(auto)} · 人工 ${Math.round(manual)}`,
      sourceSheet: "当前筛选汇总",
      sourceRow: 0
    });
  }
  return [...explicitDaily, ...synthetic];
}

function buildCountryTypeShareRows(rows: WorkOrderRow[]): CountryTypeShareRow[] {
  const countryTotals = new Map<string, { total: number; success: number; failed: number; pending: number }>();
  const grouped = new Map<string, { country: string; workType: string; workName: string; rows: WorkOrderRow[] }>();

  for (const row of rows) {
    const country = row.country || "未知国家";
    const totalItem = countryTotals.get(country) || { total: 0, success: 0, failed: 0, pending: 0 };
    totalItem.total += row.total;
    totalItem.success += row.success;
    totalItem.failed += row.failed;
    totalItem.pending += row.pending;
    countryTotals.set(country, totalItem);

    const key = `${country}|||${row.workType || "全部类型"}|||${row.workName || "全部工单"}`;
    const item = grouped.get(key) || { country, workType: row.workType || "全部类型", workName: row.workName || "全部工单", rows: [] };
    item.rows.push(row);
    grouped.set(key, item);
  }

  return Array.from(grouped.values()).map((item) => {
    const s = summarize(item.rows);
    const am = parseAutoManualRows(item.rows);
    const countryTotal = countryTotals.get(item.country) || { total: 0, success: 0, failed: 0, pending: 0 };
    return {
      country: item.country,
      platform: "全部平台",
      workType: item.workType,
      workName: item.workName,
      operator: "全部操作人",
      total: s.total,
      success: s.success,
      failed: s.failed,
      pending: s.pending,
      amount: s.amount,
      countryTotal: countryTotal.total,
      countrySuccess: countryTotal.success,
      countryFailed: countryTotal.failed,
      countryPending: countryTotal.pending,
      share: countryTotal.total ? s.total / countryTotal.total : 0,
      auto: am.auto,
      manual: am.manual,
      autoRate: am.autoRate,
      manualRate: am.manualRate
    };
  }).sort((a, b) => a.country.localeCompare(b.country, "zh-CN") || b.total - a.total);
}

function buildCountryAutoManualSummary(rows: WorkOrderRow[]) {
  const map = new Map<string, { country: string; total: number; success: number; failed: number; pending: number; auto: number; manual: number; autoRate: number; manualRate: number }>();
  for (const row of rows) {
    const current = map.get(row.country) || { country: row.country, total: 0, success: 0, failed: 0, pending: 0, auto: 0, manual: 0, autoRate: 0, manualRate: 0 };
    const am = parseAutoManualRows([row]);
    current.total += row.total;
    current.success += row.success;
    current.failed += row.failed;
    current.pending += row.pending;
    current.auto += am.auto;
    current.manual += am.manual;
    map.set(row.country, current);
  }
  return Array.from(map.values()).map((row) => {
    const total = row.auto + row.manual;
    return { ...row, autoRate: total ? row.auto / total : 0, manualRate: total ? row.manual / total : 0 };
  }).sort((a, b) => b.total - a.total);
}

function buildLowRows(rows: WorkOrderRow[]): LowRow[] {
  const dailyByOp = new Map<string, Map<string, { country: string; platform: string; operator: string; total: number }>>();
  for (const row of rows) {
    if (!row.date || !row.operator) continue;
    const key = `${row.country}|||${row.platform}|||${row.operator}`;
    const perDay = dailyByOp.get(key) || new Map<string, { country: string; platform: string; operator: string; total: number }>();
    const day = perDay.get(row.date) || { country: row.country, platform: row.platform, operator: row.operator, total: 0 };
    day.total += row.total;
    perDay.set(row.date, day);
    dailyByOp.set(key, perDay);
  }

  const result: LowRow[] = [];
  for (const perDay of Array.from(dailyByOp.values())) {
    const days = Array.from(perDay.values());
    if (!days.length) continue;
    const totals = days.map((d) => d.total);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const lowDays = totals.filter((v) => v <= 3 || v <= avg * 0.25).length;
    if (lowDays <= 0) continue;
    const first = days[0];
    result.push({
      country: first.country,
      platform: first.platform,
      operator: first.operator,
      days: days.length,
      lowDays,
      total: totals.reduce((a, b) => a + b, 0),
      avg,
      dates: Array.from(perDay.entries()).filter(([, d]) => d.total <= 3 || d.total <= avg * 0.25).map(([date]) => date).join("、")
    });
  }
  return result.sort((a, b) => b.lowDays - a.lowDays || a.total - b.total);
}

type CompareRow = {
  label: string;
  currentTotal: number;
  previousTotal: number;
  currentSuccessRate: number;
  previousSuccessRate: number;
  currentFailedRate: number;
  previousFailedRate: number;
  totalDiff: number;
  successRateDiff: number;
  failedRateDiff: number;
};

function pctDiff(current: number, previous: number): number {
  if (!previous) return current ? 1 : 0;
  return (current - previous) / previous;
}

function rateDiff(current: number, previous: number): number {
  return current - previous;
}

function periodKey(date: string, mode: CompareMode): string {
  if (!isIsoDate(date)) return date;
  if (mode === "month") return date.slice(0, 7);
  if (mode === "week") {
    const d = new Date(`${date}T00:00:00Z`);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - day + 1);
    return `${d.toISOString().slice(0, 10)}周`;
  }
  return date;
}

function buildWorkCompareRows(rows: WorkOrderRow[], groupKey: "all" | "country" | "platform" = "country", mode: CompareMode = "day"): CompareRow[] {
  const periods = uniq(rows.map((r) => periodKey(r.date, mode)).filter(Boolean));
  if (periods.length < 2) return [];
  const currentDate = periods[periods.length - 1];
  const previousDate = periods[periods.length - 2];

  function keyFor(row: WorkOrderRow) {
    if (groupKey === "all") return "总览";
    if (groupKey === "platform") return `${row.country} ${row.platform}`;
    return row.country;
  }

  const map = new Map<string, { c: WorkOrderRow[]; p: WorkOrderRow[] }>();
  for (const row of rows) {
    const period = periodKey(row.date, mode);
    if (period !== currentDate && period !== previousDate) continue;
    const key = keyFor(row);
    const item = map.get(key) || { c: [], p: [] };
    if (period === currentDate) item.c.push(row);
    if (period === previousDate) item.p.push(row);
    map.set(key, item);
  }

  return Array.from(map.entries()).map(([label, item]) => {
    const c = summarize(item.c);
    const p = summarize(item.p);
    return {
      label,
      currentTotal: c.total,
      previousTotal: p.total,
      currentSuccessRate: c.successRate,
      previousSuccessRate: p.successRate,
      currentFailedRate: c.failedRate,
      previousFailedRate: p.failedRate,
      totalDiff: pctDiff(c.total, p.total),
      successRateDiff: rateDiff(c.successRate, p.successRate),
      failedRateDiff: rateDiff(c.failedRate, p.failedRate)
    };
  }).sort((a, b) => Math.abs(b.totalDiff) - Math.abs(a.totalDiff));
}

const WORK_ORDER_CACHE_KEY = "hensem:last-good:work-orders:v238-current";

function readWorkLocalCache(): WorkOrderPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const text = window.localStorage.getItem(WORK_ORDER_CACHE_KEY);
    if (!text) return null;
    return JSON.parse(text) as WorkOrderPayload;
  } catch {
    return null;
  }
}

function writeWorkLocalCache(payload: WorkOrderPayload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORK_ORDER_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage 满了也不能影响页面展示
  }
}

function attachWorkClientFallbackMessage(payload: WorkOrderPayload, reason: string): WorkOrderPayload {
  return {
    ...payload,
    meta: {
      ...(payload.meta || {}),
      clientFallback: true,
      liveError: reason,
      message: [
        payload.meta?.message,
        reason ? `接口临时失败，当前显示浏览器最后一次成功缓存：${reason}` : "当前显示浏览器最后一次成功缓存"
      ].filter(Boolean).join("；")
    } as any
  };
}

function emptyClientWorkOrderPayload(message: string): WorkOrderPayload {
  const now = new Date();
  return {
    meta: {
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1),
      updatedAt: now.toISOString(),
      source: "google-sheet",
      sheets: [],
      message
    } as any,
    summary: { total: 0, success: 0, failed: 0, pending: 0, amount: 0, countries: 0, platforms: 0, types: 0, names: 0, operators: 0 },
    rows: [],
    anomalies: []
  };
}

export default function WorkOrderDashboard() {
  const [state, setState] = useState<LoadState>("loading");
  const [payload, setPayload] = useState<WorkOrderPayload | null>(null);
  const [error, setError] = useState("");
  const [mainTab, setMainTab] = useState<MainTab>("orders");
  const [orderView, setOrderView] = useState<OrderView>("orderDaily");
  const [operatorView, setOperatorView] = useState<OperatorView>("operatorSummary");
  const [filters, setFilters] = useState<WorkFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<WorkFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ key: "total", direction: "desc" });
  const [detailModal, setDetailModal] = useState<DetailModal | null>(null);
  const [summaryModal, setSummaryModal] = useState<SummaryModal | null>(null);
  const [expandedDailyKeys, setExpandedDailyKeys] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState<CompareMode>("day");
  const loadedMonthSignatureRef = useRef("");
  const payloadRef = useRef<WorkOrderPayload | null>(null);

  const snapshotMonthOptions = useMemo(() => {
    const out: Array<{ key: string; label: string; start: string; end: string }> = [];
    const start = new Date(2026, 3, 1);
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const cursor = new Date(start);
    while (cursor <= end && out.length < 36) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const ym = `${year}-${String(month).padStart(2, "0")}`;
      const lastDay = new Date(year, month, 0).getDate();
      const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const isSettling = now.getDate() <= 7 && year === prev.getFullYear() && month === prev.getMonth() + 1;
      out.push({
        key: ym,
        label: `${month}月${isCurrent ? "·当前" : isSettling ? "·结算中" : ""}`,
        start: `${ym}-01`,
        end: `${ym}-${String(lastDay).padStart(2, "0")}`
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }, []);

  useEffect(() => { payloadRef.current = payload; }, [payload]);

  const view: WorkView = mainTab === "operators" ? operatorView : orderView;

  function openSnapshotMonth(item: { start: string; end: string }) {
    const next = {
      ...draftFilters,
      countries: [],
      platforms: [],
      types: [],
      names: [],
      accountTypes: [],
      operators: [],
      startDate: item.start,
      endDate: item.end
    };
    setDraftFilters(next);
    setFilters(next);
    setPage(1);
  }

  async function loadData(silent = false, requestedStart = "", requestedEnd = "", version = "") {
    // 已有页面或旧缓存时静默重试，避免每60秒整页闪回 loading。
    if (!silent && !(payload?.rows || []).length) setState("loading");
    setError("");
    try {
      const requestUrl = monthlyApiUrl("/api/work-orders", requestedStart, requestedEnd, version);
      const res = await fetch(requestUrl, { cache: "default" });
      const text = await res.text();
      if (!text.trim()) throw new Error("工单接口没有返回数据");
      const json = JSON.parse(text) as WorkOrderPayload;
      if (!res.ok) throw new Error((json as any)?.message || "读取工单统计失败");
      if (!(json.rows || []).length && rangeIncludesCurrentMonthClient(requestedStart, requestedEnd)) {
        const cached = readWorkLocalCache();
        if (cached && (cached.rows || []).length > 0) {
          setPayload(attachWorkClientFallbackMessage(cached, String(json.meta?.message || "后台正在建立最新工单快照")));
          setState("ready");
          return;
        }
      }
      setPayload(json);
      payloadRef.current = json;
      loadedMonthSignatureRef.current = monthRangeSignature(requestedStart, requestedEnd);
      if ((json.rows || []).length > 0 && rangeIncludesCurrentMonthClient(requestedStart, requestedEnd)) writeWorkLocalCache(json);
      setState("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "读取工单统计失败";
      const cached = rangeIncludesCurrentMonthClient(requestedStart, requestedEnd) ? readWorkLocalCache() : null;
      if (cached && (cached.rows || []).length > 0) {
        setPayload(attachWorkClientFallbackMessage(cached, message));
        setState("ready");
        return;
      }
      setPayload(emptyClientWorkOrderPayload(`工单后台快照还没准备好；系统每小时自动更新，重新进入页面可查看；本次错误：${message}`));
      setState("ready");
    }
  }

  useEffect(() => {
    const cached = readWorkLocalCache();
    if (cached && (cached.rows || []).length > 0) {
      setPayload(cached);
      payloadRef.current = cached;
      loadedMonthSignatureRef.current = monthRangeSignature("", "");
      setState("ready");
      void (async () => {
        const status = await fetchPreferredMonthlyStatus("work-orders");
        if (!statusMatchesPayload(status, cached)) await loadData(true, "", "", status?.version || "");
      })();
    } else {
      void loadData(false);
    }
    // 首次优先显示浏览器最后成功快照；只用小状态接口判断是否真的需要重新下载大 JSON。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const requestedSignature = monthRangeSignature(filters.startDate, filters.endDate);
    if (payload && loadedMonthSignatureRef.current !== requestedSignature) {
      void loadData(true, filters.startDate, filters.endDate);
    }
    const hourlyTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !rangeIncludesCurrentMonthClient(filters.startDate, filters.endDate)) return;
      void (async () => {
        const status = await fetchPreferredMonthlyStatus("work-orders");
        if (statusMatchesPayload(status, payloadRef.current)) return;
        if (status?.preferredMonth && status.preferredMonth !== payloadSnapshotMonth(payloadRef.current)) {
          setFilters(EMPTY_FILTERS);
          setDraftFilters(EMPTY_FILTERS);
          await loadData(true, "", "", status.version);
          return;
        }
        await loadData(true, filters.startDate, filters.endDate, status?.version || "");
      })();
    }, 60 * 60 * 1000);
    return () => window.clearInterval(hourlyTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.startDate, filters.endDate]);

  const allDates = useMemo(() => payload ? uniq(payload.rows.map((r) => r.date).filter(isIsoDate)) : [], [payload]);

  useEffect(() => {
    if (!payload || !allDates.length) return;
    const latest = allDates[allDates.length - 1];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = formatDateKey(yesterday);
    const defaultDate = allDates.includes(yesterdayKey) ? yesterdayKey : latest;
    setFilters((prev) => prev.startDate || prev.endDate ? prev : { ...prev, startDate: defaultDate, endDate: defaultDate });
    setDraftFilters((prev) => prev.startDate || prev.endDate ? prev : { ...prev, startDate: defaultDate, endDate: defaultDate });
  }, [payload, allDates]);

  const allRows = payload?.rows || [];
  const countries = useMemo(() => sortWorkCountries(allRows.map((r) => r.country)), [allRows]);
  const platformOptions = useMemo(() => uniq(allRows.filter((r) => matchesSelection(r.country, draftFilters.countries)).map((r) => r.platform)), [allRows, draftFilters.countries]);
  const typeOptions = useMemo(() => {
    const rows = allRows
      .filter((r) => matchesSelection(r.country, draftFilters.countries))
      .filter((r) => matchesSelection(r.platform, draftFilters.platforms));
    const accountTypeSet = new Set(rows.map((r) => normalizeFilterText(r.accountType || "")).filter(Boolean));
    const workNameSet = new Set(rows.map((r) => normalizeFilterText(r.workName || "")).filter(Boolean));
    // 工单类型下拉只显示真正的工单类型：不混入工单名称、不混入岗位/账号类型。
    const fromTypeRows = rows
      .filter((r) => r.kind === "type")
      .map((r) => r.workType)
      .filter((value) => isValidWorkTypeOption(value, accountTypeSet, workNameSet));
    const fallback = rows
      .map((r) => r.workType)
      .filter((value) => isValidWorkTypeOption(value, accountTypeSet, workNameSet));
    return uniq(fromTypeRows.length ? fromTypeRows : fallback);
  }, [allRows, draftFilters.countries, draftFilters.platforms]);
  const nameOptions = useMemo(() => uniq(allRows.filter((r) => matchesSelection(r.country, draftFilters.countries)).filter((r) => matchesSelection(r.platform, draftFilters.platforms)).filter((r) => rowMatchesWorkTypeFilter(r, draftFilters.types)).map((r) => r.workName).filter(isRealWorkName)), [allRows, draftFilters.countries, draftFilters.platforms, draftFilters.types]);
  const accountTypeOptions = useMemo(() => uniq(allRows.filter((r) => matchesSelection(r.country, draftFilters.countries)).filter((r) => matchesSelection(r.platform, draftFilters.platforms)).map((r) => r.accountType || "").filter(Boolean)), [allRows, draftFilters.countries, draftFilters.platforms]);
  const operatorOptions = useMemo(() => uniq(allRows.filter((r) => matchesSelection(r.country, draftFilters.countries)).filter((r) => matchesSelection(r.platform, draftFilters.platforms)).filter((r) => matchesSelection(r.accountType || "", draftFilters.accountTypes)).map((r) => r.operator).filter(Boolean)), [allRows, draftFilters.countries, draftFilters.platforms, draftFilters.accountTypes]);

  const filteredAll = useMemo(() => {
    return allRows.filter((row) => {
      if (!matchesSelection(row.country, filters.countries)) return false;
      if (!matchesSelection(row.platform, filters.platforms)) return false;
      if (!rowMatchesWorkTypeFilter(row, filters.types)) return false;
      if (!matchesSelection(row.workName, filters.names)) return false;
      if (!matchesSelection(row.accountType || "", filters.accountTypes)) return false;
      if (!matchesSelection(row.operator, filters.operators)) return false;
      if (!rowDateMatches(row, filters.startDate, filters.endDate)) return false;
      return true;
    });
  }, [allRows, filters]);

  const shouldSynthesizeDaily = !!(filters.types.length || filters.names.length || filters.accountTypes.length || filters.operators.length);
  const dailyRowsRaw = useMemo(() => shouldSynthesizeDaily ? synthesizeClientDailyRows(filteredAll) : filteredAll.filter((r) => r.kind === "daily"), [filteredAll, shouldSynthesizeDaily]);
  const typeRowsRaw = useMemo(() => {
    const accountTypeSet = new Set(filteredAll.map((r) => normalizeFilterText(r.accountType || "")).filter(Boolean));
    const workNameSet = new Set(filteredAll.map((r) => normalizeFilterText(r.workName || "")).filter(Boolean));
    const isCleanTypeRow = (r: WorkOrderRow) => isValidWorkTypeOption(r.workType, accountTypeSet, workNameSet) || isRealWorkName(r.workName);
    const direct = filteredAll.filter((r) => r.kind === "type" && isCleanTypeRow(r));
    const directKeys = new Set(direct.map((r) => `${r.date}|||${r.country}|||${r.platform}|||${r.workType}|||${r.workName}`));
    const fromOperator = filteredAll
      .filter((r) => r.kind === "operator" && isCleanTypeRow(r))
      .filter((r) => !directKeys.has(`${r.date}|||${r.country}|||${r.platform}|||${r.workType}|||${r.workName}`));
    return [...direct, ...fromOperator];
  }, [filteredAll]);
  const operatorRowsRaw = useMemo(() => filteredAll.filter((r) => r.kind === "operator"), [filteredAll]);

  const dailySummary = useMemo(() => summarize(dailyRowsRaw), [dailyRowsRaw]);
  const typeSummary = useMemo(() => summarize(typeRowsRaw), [typeRowsRaw]);
  const operatorSummary = useMemo(() => summarize(operatorRowsRaw), [operatorRowsRaw]);
  const dailyAutoManual = useMemo(() => parseAutoManualRows(dailyRowsRaw), [dailyRowsRaw]);

  const orderDailyRows = useMemo(() => sortRows(aggregate(dailyRowsRaw, ["date", "country", "platform"]), sort, summaryValue), [dailyRowsRaw, sort]);
  const orderMonthlyRows = useMemo(() => {
    const monthRows = dailyRowsRaw
      .filter((row) => isIsoDate(row.date))
      .map((row) => ({ ...row, date: row.date.slice(0, 7) }));
    return sortRows(aggregate(monthRows, ["date", "country", "platform"]), sort, summaryValue);
  }, [dailyRowsRaw, sort]);
  const orderPlatformRows = useMemo(() => sortRows(aggregate(dailyRowsRaw, ["country", "platform"]), sort, summaryValue), [dailyRowsRaw, sort]);
  const orderTypePlatformRows = useMemo(() => sortRows(aggregate(typeRowsRaw, ["country", "platform", "workType", "workName"]), sort, summaryValue), [typeRowsRaw, sort]);
  const orderTypeCountryRows = useMemo(() => sortRows(aggregate(typeRowsRaw, ["country", "workType", "workName"]), sort, summaryValue), [typeRowsRaw, sort]);
  const countryTypeShareRows = useMemo(() => sortRows(buildCountryTypeShareRows(typeRowsRaw), sort, summaryValue), [typeRowsRaw, sort]);
  const countryTypeSummaryRows = useMemo(() => buildCountryAutoManualSummary(typeRowsRaw), [typeRowsRaw]);
  const orderAnomalyRows = useMemo(() => sortRows(aggregate(dailyRowsRaw, ["country", "platform"]).filter((row) => {
    const failedRate = row.total ? row.failed / row.total : 0;
    return row.total >= 10 && failedRate >= 0.15;
  }), { key: "failedRate", direction: "desc" }, summaryValue), [dailyRowsRaw]);

  const operatorRankRows = useMemo(() => sortRows(aggregate(operatorRowsRaw, ["country", "platform", "operator"]), sort, summaryValue), [operatorRowsRaw, sort]);
  const operatorDetailRows = useMemo(() => sortRows(aggregate(operatorRowsRaw, ["date", "country", "platform", "operator"]), sort, summaryValue), [operatorRowsRaw, sort]);
  const operatorLowRows = useMemo(() => sortRows(buildLowRows(operatorRowsRaw), sort, summaryValue), [operatorRowsRaw, sort]);

  const countryPlatformCounts = useMemo<Map<string, number>>(() => aggregate(dailyRowsRaw, ["country", "platform"]).reduce((map: Map<string, number>, row: SummaryRow) => {
    map.set(row.country, (map.get(row.country) || 0) + 1);
    return map;
  }, new Map<string, number>()), [dailyRowsRaw]);

  const countryAutoManualRows = useMemo(() => {
    const map = new Map<string, AutoManualSummary & { country: string; total: number }>();
    for (const row of dailyRowsRaw) {
      const current = map.get(row.country) || { country: row.country, auto: 0, manual: 0, autoRate: 0, manualRate: 0, total: 0 };
      const summary = parseAutoManualRows([row]);
      current.auto += summary.auto;
      current.manual += summary.manual;
      current.total += summary.auto + summary.manual;
      map.set(row.country, current);
    }
    return Array.from(map.values()).map((item) => ({
      ...item,
      autoRate: item.total ? item.auto / item.total : 0,
      manualRate: item.total ? item.manual / item.total : 0
    })).sort((a, b) => b.total - a.total);
  }, [dailyRowsRaw]);

  const workCompareRows = useMemo(() => buildWorkCompareRows(dailyRowsRaw, "country", compareMode), [dailyRowsRaw, compareMode]);
  const workCompareTotal = useMemo(() => buildWorkCompareRows(dailyRowsRaw, "all", compareMode)[0], [dailyRowsRaw, compareMode]);

  const currentRows: Array<SummaryRow | CountryTypeShareRow | LowRow> = view === "orderDaily"
    ? orderDailyRows
    : view === "orderMonthly"
      ? orderMonthlyRows
      : view === "orderTypePlatform"
      ? orderTypePlatformRows
      : view === "orderTypeCountry"
        ? orderTypePlatformRows
        : view === "orderAnomaly"
          ? orderAnomalyRows
          : view === "operatorSummary"
            ? operatorRankRows
            : view === "operatorDetail"
              ? operatorDetailRows
              : view === "operatorCompare"
                ? operatorRankRows
                : orderPlatformRows;

  const totalPages = pageCount(currentRows.length, pageSize);
  const visibleRows = paginateRows(currentRows, page, pageSize);

  useEffect(() => {
    setPage(1);
  }, [view, filters, pageSize, sort]);

  useEffect(() => {
    setExpandedDailyKeys([]);
  }, [filters, page, pageSize, sort, view, mainTab]);

  function updateDraft<K extends keyof WorkFilters>(key: K, value: WorkFilters[K]) {
    setDraftFilters((prev) => ({ ...prev, [key]: value }));
  }

  function applyFilters() {
    setFilters({ ...draftFilters });
    setPage(1);
  }

  function resetFilters() {
    const latest = allDates[allDates.length - 1] || "";
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = formatDateKey(yesterday);
    const defaultDate = allDates.includes(yesterdayKey) ? yesterdayKey : latest;
    const next = { ...EMPTY_FILTERS, startDate: defaultDate, endDate: defaultDate };
    setFilters(next);
    setDraftFilters(next);
    setPage(1);
  }


  function selectDailyCountry(country: string) {
    const next: WorkFilters = {
      ...filters,
      countries: country ? [country] : [],
      platforms: [],
      types: [],
      names: [],
      accountTypes: [],
      operators: []
    };
    setMainTab("orders");
    setOrderView((prev) => prev === "orderMonthly" ? "orderMonthly" : "orderDaily");
    setFilters(next);
    setDraftFilters(next);
    setPage(1);
  }



  function selectOperatorCountry(country: string) {
    const next: WorkFilters = {
      ...filters,
      countries: country ? [country] : [],
      platforms: [],
      operators: []
    };
    setMainTab("operators");
    setFilters(next);
    setDraftFilters(next);
    setPage(1);
  }

  function toggleSort(key: string) {
    setSort((prev) => ({ key, direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc" }));
  }

  function openRows(title: string, rows: WorkOrderRow[]) {
    const uniqueRows = dedupeDetailRows(rows);
    setDetailModal({
      title,
      subtitle: `弹窗查看，不改变当前页面筛选条件。已去重 ${formatNumber(uniqueRows.length)} 条原始记录，最多显示 800 条。`,
      rows: uniqueRows.slice(0, 800),
      summary: summarize(uniqueRows)
    });
  }

  function toggleDailyExpand(row: SummaryRow) {
    const key = summaryRowKey(row);
    setExpandedDailyKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  }

  function dailyTypeSummaryRows(row: SummaryRow): SummaryRow[] {
    return rowsForSummary(row).map((item) => {
      const am = autoManualForRow(item);
      return {
        date: item.date || row.date,
        country: item.country,
        platform: item.platform,
        workType: item.workType,
        workName: item.workName,
        operator: "全部操作人",
        total: item.total,
        success: item.success,
        failed: item.failed,
        pending: item.pending,
        amount: item.amount,
        auto: am.auto,
        manual: am.manual
      } satisfies SummaryRow;
    }).sort((a, b) => b.total - a.total || a.workType.localeCompare(b.workType, "zh-CN") || a.workName.localeCompare(b.workName, "zh-CN"));
  }

  function openTypeOperators(row: SummaryRow) {
    const matched = dedupeDetailRows(operatorRowsRaw.filter((item) => {
      if (row.date && row.date !== "-" && item.date !== row.date) return false;
      if (row.country && row.country !== "全部国家" && item.country !== row.country) return false;
      if (row.platform && row.platform !== "全部平台" && item.platform !== row.platform) return false;
      if (row.workType && row.workType !== "全部类型" && item.workType !== row.workType) return false;
      if (row.workName && row.workName !== "全部工单" && item.workName !== row.workName) return false;
      if (!matchesSelection(item.accountType || "", filters.accountTypes)) return false;
      return true;
    }));
    if (matched.length) {
      openRows(`${row.country} ${row.platform} ${row.workName} 操作人明细`, matched);
      return;
    }
    openRows(`${row.country} ${row.platform} ${row.workName} 明细`, rowsForSummary(row));
  }

  function openSummary(title: string, rows: SummaryRow[], targetView: WorkView) {
    setSummaryModal({
      title,
      subtitle: `共 ${formatNumber(rows.length)} 条汇总记录。点击“跳转”会带入国家、平台、类型筛选。`,
      rows,
      targetView
    });
  }

  function jumpToSummary(row: SummaryRow, targetView: WorkView) {
    const next: WorkFilters = {
      ...filters,
      countries: row.country && row.country !== "全部国家" ? [row.country] : [],
      platforms: row.platform && row.platform !== "全部平台" ? [row.platform] : [],
      types: row.workType && row.workType !== "全部类型" ? [row.workType] : [],
      names: row.workName && row.workName !== "全部工单" ? [row.workName] : [],
      accountTypes: [],
      operators: row.operator && row.operator !== "全部操作人" ? [row.operator] : []
    };
    setFilters(next);
    setDraftFilters(next);
    if (String(targetView).startsWith("operator")) {
      setMainTab("operators");
      setOperatorView(targetView as OperatorView);
    } else if (targetView === "orderDaily") {
      setMainTab("orders");
      setOrderView("orderDaily");
    } else {
      setMainTab("orders");
      setOrderView(targetView as OrderView);
    }
    setSummaryModal(null);
    setPage(1);
  }

  function rowsForSummary(row: SummaryRow | LowRow) {
    const isPlatformDailySummary = !("lowDays" in row) && !!row.date && row.platform !== "全部平台" && (
      row.workName === "平台日汇总" ||
      row.workType === "工单统计" ||
      (row.workType === "全部类型" && row.workName === "全部工单")
    );
    let sourceRows: WorkOrderRow[];
    if ("lowDays" in row) {
      sourceRows = operatorRowsRaw;
    } else if (row.operator && row.operator !== "全部操作人") {
      sourceRows = operatorRowsRaw;
    } else if (isPlatformDailySummary) {
      // 工单日表点“查看”时，不再弹出同一条日汇总。
      // 先按子工单类型汇总；没有 type 明细时，再用操作人明细里的工单类型聚合。
      const samePlatformTypeRows = typeRowsRaw.filter((item) => item.date === row.date && item.country === row.country && item.platform === row.platform && isRealWorkType(item.workType));
      if (samePlatformTypeRows.length) return aggregateDetailTypeRows(samePlatformTypeRows, "子工单类型汇总");

      const samePlatformOperatorTypeRows = operatorRowsRaw.filter((item) => item.date === row.date && item.country === row.country && item.platform === row.platform && (isRealWorkType(item.workType) || isRealWorkName(item.workName)));
      if (samePlatformOperatorTypeRows.length) return aggregateDetailTypeRows(samePlatformOperatorTypeRows, "操作人子工单汇总");

      sourceRows = dailyRowsRaw;
    } else if ((row.workType && row.workType !== "全部类型") || (row.workName && row.workName !== "全部工单")) {
      // 类型统计只从 type 视角取明细，避免同一条员工明细又以 operator 视角重复出现。
      sourceRows = typeRowsRaw.length ? typeRowsRaw : operatorRowsRaw;
    } else {
      sourceRows = dailyRowsRaw;
    }

    const matched = sourceRows.filter((item) => {
      if ("lowDays" in row) {
        return item.country === row.country && item.platform === row.platform && item.operator === row.operator;
      }
      if (row.date && row.date !== "-" && item.date !== row.date) return false;
      if (row.country !== "全部国家" && item.country !== row.country) return false;
      if (row.platform !== "全部平台" && item.platform !== row.platform) return false;
      if (!isPlatformDailySummary && row.workType !== "全部类型" && item.workType !== row.workType) return false;
      if (!isPlatformDailySummary && row.workName !== "全部工单" && item.workName !== row.workName) return false;
      if (row.operator !== "全部操作人" && item.operator !== row.operator) return false;
      if (!matchesSelection(item.accountType || "", filters.accountTypes)) return false;
      return true;
    });

    return dedupeDetailRows(matched);
  }

  function formatDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function monthRangeFromDateKey(dateKey: string): { startDate: string; endDate: string } {
    const match = String(dateKey || "").match(/^(\d{4})-(\d{2})/);
    const fallback = formatDateKey(new Date());
    const year = match ? Number(match[1]) : Number(fallback.slice(0, 4));
    const month = match ? Number(match[2]) : Number(fallback.slice(5, 7));
    const endDay = new Date(year, month, 0).getDate();
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    return { startDate: `${ym}-01`, endDate: `${ym}-${String(endDay).padStart(2, "0")}` };
  }

  function switchOrderView(nextView: OrderView) {
    setOrderView(nextView);
    if (nextView === "orderMonthly") {
      const range = monthRangeFromDateKey(draftFilters.startDate || filters.startDate || draftFilters.endDate || filters.endDate);
      const next = { ...draftFilters, startDate: range.startDate, endDate: range.endDate };
      setDraftFilters(next);
      setFilters(next);
    }
    setPage(1);
  }

  function applyDateShortcut(mode: "today" | "yesterday" | "beforeYesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth") {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    if (mode === "yesterday") {
      start.setDate(now.getDate() - 1);
      end.setDate(now.getDate() - 1);
    } else if (mode === "beforeYesterday") {
      start.setDate(now.getDate() - 2);
      end.setDate(now.getDate() - 2);
    } else if (mode === "thisWeek" || mode === "lastWeek") {
      const day = now.getDay() || 7;
      start.setDate(now.getDate() - day + 1);
      if (mode === "lastWeek") start.setDate(start.getDate() - 7);
      end.setTime(start.getTime());
      end.setDate(start.getDate() + 6);
    } else if (mode === "thisMonth" || mode === "lastMonth") {
      const selectedDateKey = draftFilters.startDate || filters.startDate || draftFilters.endDate || filters.endDate;
      const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDateKey)
        ? new Date(`${selectedDateKey}T12:00:00`)
        : new Date(now);
      const base = mode === "lastMonth" && !Number.isNaN(selectedDate.getTime()) ? selectedDate : now;
      start.setFullYear(base.getFullYear(), base.getMonth(), 1);
      if (mode === "lastMonth") start.setMonth(start.getMonth() - 1);
      end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0);
    }
    const next = { ...draftFilters, startDate: formatDateKey(start), endDate: formatDateKey(end) };
    setDraftFilters(next);
    setFilters(next);
    setPage(1);
  }


  function shiftDateRange(days: number) {
    if (mainTab === "orders" && orderView === "orderMonthly") {
      const base = draftFilters.startDate || filters.startDate || draftFilters.endDate || filters.endDate || formatDateKey(new Date());
      const current = new Date(`${base}T00:00:00`);
      if (Number.isNaN(current.getTime())) return;
      current.setMonth(current.getMonth() + days);
      const range = monthRangeFromDateKey(formatDateKey(current));
      const next = { ...draftFilters, startDate: range.startDate, endDate: range.endDate };
      setDraftFilters(next);
      setFilters(next);
      setPage(1);
      return;
    }
    const baseStart = draftFilters.startDate || filters.startDate || draftFilters.endDate || filters.endDate || formatDateKey(new Date());
    const baseEnd = draftFilters.endDate || filters.endDate || draftFilters.startDate || filters.startDate || baseStart;
    const start = new Date(`${baseStart}T00:00:00`);
    const end = new Date(`${baseEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    start.setDate(start.getDate() + days);
    end.setDate(end.getDate() + days);
    const next = { ...draftFilters, startDate: formatDateKey(start), endDate: formatDateKey(end) };
    setDraftFilters(next);
    setFilters(next);
    setPage(1);
  }

  function handleExport() {
    const suffix = `${mainTab}-${titleForView(view)}-${filters.startDate || "all"}-${filters.endDate || "all"}`.replace(/\s+/g, "");
    exportCsv(`工单统计-${suffix}.csv`, currentRows, [
      { label: "日期", value: (r) => "date" in r ? r.date || "-" : "-" },
      { label: "国家", value: (r) => r.country },
      { label: "平台", value: (r) => r.platform },
      { label: "工单类型", value: (r) => "workType" in r ? r.workType : "-" },
      { label: "工单名称", value: (r) => "workName" in r ? r.workName : "-" },
      { label: "操作人", value: (r) => r.operator },
      { label: "岗位", value: (r) => { const accountType = "accountType" in r ? (r as { accountType?: string | number }).accountType : ""; return accountType || "-"; } },
      { label: "总数", value: (r) => r.total },
      { label: "成功/完成", value: (r) => "success" in r ? r.success : "-" },
      { label: "失败/驳回", value: (r) => "failed" in r ? r.failed : "-" },
      { label: "自动处理", value: (r) => "auto" in r ? r.auto : "-" },
      { label: "人工处理", value: (r) => "manual" in r ? r.manual : "-" },
      { label: "自动占比", value: (r) => "auto" in r && "manual" in r && r.auto + r.manual ? `${((r.auto / (r.auto + r.manual)) * 100).toFixed(2)}%` : "-" },
      { label: "人工占比", value: (r) => "auto" in r && "manual" in r && r.auto + r.manual ? `${((r.manual / (r.auto + r.manual)) * 100).toFixed(2)}%` : "-" }
    ]);
  }

  const orderOverviewCards = (
    <section className="metrics work-metrics work-overview-metrics">
      <MetricCard label="工单总数" value={formatNumber(dailySummary.total)} sub={`已处理 ${formatNumber(dailySummary.success)} · 已驳回 ${formatNumber(dailySummary.failed)}`} onClick={() => { setMainTab("orders"); setOrderView("orderDaily"); }} />
      <MetricCard label="处理完成率" value={formatPercent(dailySummary.successRate)} sub={`驳回率 ${formatPercent(dailySummary.failedRate)} · 已驳回 ${formatNumber(dailySummary.failed)}`} />
      <MetricCard label="自动处理" value={formatNumber(dailyAutoManual.auto)} sub={`自动占比 ${formatPercent(dailyAutoManual.autoRate)} · admin/system 归为自动`} onClick={() => setOrderView("orderDaily")} />
      <MetricCard label="人工处理" value={formatNumber(dailyAutoManual.manual)} sub={`人工占比 ${formatPercent(dailyAutoManual.manualRate)} · 非 admin 归为人工`} onClick={() => setOrderView("orderDaily")} />
      <MetricCard label="国家 / 平台" value={`${dailySummary.countries} / ${dailySummary.platforms}`} sub="按每日工单去重统计" />
      <MetricCard label="工单类型" value={formatNumber(typeSummary.types)} sub={`工单名称 ${formatNumber(typeSummary.names)} 个`} onClick={() => setOrderView("orderDaily")} />
      <MetricCard label="类型统计笔数" value={formatNumber(typeSummary.total)} sub="来自操作人明细聚合，不和日表重复计算" onClick={() => setOrderView("orderDaily")} />
      <MetricCard label="操作人记录" value={formatNumber(operatorSummary.operators)} sub="切换到操作人统计查看明细" onClick={() => { setMainTab("operators"); setOperatorView("operatorDetail"); }} />
    </section>
  );

  const orderTypeRankPanels = (
    <section className="chart-grid work-order-rank-grid">
      <Panel title="平台工单排行" subtitle="按每日工单汇总，不读取底部类型表，避免重复。" action={<button className="ghost-btn small" onClick={() => openSummary("平台工单排行", orderPlatformRows, "orderDaily")}>查看更多</button>}>
        <MiniRank rows={orderPlatformRows.slice(0, 8)} valueKey="total" onOpen={(row) => openRows(`${row.country} ${row.platform} 工单明细`, rowsForSummary(row))} />
      </Panel>
      <Panel title="各类型排行" subtitle="来自操作人明细聚合，每个平台每种工单清楚显示。" action={<button className="ghost-btn small" onClick={() => openSummary("各平台类型排行", orderTypePlatformRows, "orderTypePlatform")}>查看更多</button>}>
        <MiniRank rows={orderTypePlatformRows.slice(0, 8)} valueKey="total" onOpen={(row) => openRows(`${row.country} ${row.platform} ${row.workName} 明细`, rowsForSummary(row))} />
      </Panel>
    </section>
  );

  if (state === "loading") return <div className="loading inner-loading">正在读取工单/客服...</div>;
  if (state === "error") {
    return (
      <div className="error-box inner-error">
        <h2>工单统计读取失败</h2>
        <p>{error}</p>
        <p className="muted-text">请确认 Netlify 的 WORK_ORDER_SHEET_ID / WORK_ORDER_SHEET_IDS 指向实际工单表，并已分享给 Service Account。</p>
        
      </div>
    );
  }
  if (!payload) return null;

  return (
    <div className="work-order-module">
      <div className="topbar">
        <div className="title">
          <h1>工单/客服</h1>
          <p>当前位置：Hensem数据后台 &gt; 工单/客服 &gt; {mainTab === "orders" ? "工单统计" : mainTab === "operators" ? "操作人统计" : "客服统计"} &gt; {mainTab === "customer" ? "客服统计" : titleForView(view)}</p>
        </div>
        <div className="status-box">
          <div className="status-line"><span>数据月份</span><strong>{payload.meta.year || "-"} 年 {payload.meta.month || "-"} 月</strong></div>
          <div className="status-line"><span>数据来源</span><strong>Google Sheet</strong></div>
          <div className="status-line"><span>读取页签</span><strong>{payload.meta.sheets.length} 个</strong></div>
          <div className="status-line"><span>更新时间</span><strong>{new Date(String((payload.meta as any).snapshotUpdatedAt || payload.meta.updatedAt)).toLocaleString("zh-CN")}</strong></div>
        </div>
      </div>

      {!(payload.rows || []).length && (
        <div style={{
          margin: "0 0 14px",
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid #bfdbfe",
          background: "#eff6ff",
          color: "#1e3a8a",
          fontSize: 13,
          lineHeight: 1.55
        }}>
          <strong>工单数据正在后台同步。</strong>
          <div>{String(payload.meta?.message || "页面会每60秒自动读取最新快照，不需要手动刷新。")}</div>
        </div>
      )}

      <section className="module-switch work-main-switch">
        <button className={mainTab !== "customer" ? "module-tab active" : "module-tab"} onClick={() => { setMainTab("orders"); setOrderView("orderDaily"); }}>工单</button>
        <button className={mainTab === "customer" ? "module-tab active" : "module-tab"} onClick={() => { setMainTab("customer"); }}>客服</button>
      </section>

      {mainTab !== "customer" && (
        <>
          <section className="module-switch work-sub-switch work-level-switch">
            <button className={mainTab === "orders" ? "module-tab active" : "module-tab"} onClick={() => { setMainTab("orders"); setOrderView("orderDaily"); }}>工单统计</button>
            <button className={mainTab === "operators" ? "module-tab active" : "module-tab"} onClick={() => { setMainTab("operators"); setOperatorView("operatorSummary"); }}>操作人统计</button>
          </section>

          {mainTab === "orders" ? (
            <>
              <section className="child-switch work-child-switch work-third-switch work-view-row">
                <button className={orderView === "orderDaily" ? "child-tab active" : "child-tab"} onClick={() => switchOrderView("orderDaily")}>工单日表</button>
                <button className={orderView === "orderMonthly" ? "child-tab active" : "child-tab"} onClick={() => switchOrderView("orderMonthly")}>工单月表</button>
              </section>
              <section className="child-switch work-child-switch work-third-switch work-country-row">
                {countries.map((country) => (
                  <button key={country} className={(orderView === "orderDaily" || orderView === "orderMonthly") && filters.countries.length === 1 && filters.countries[0] === country ? "child-tab active" : "child-tab"} onClick={() => selectDailyCountry(country)}>{country}盘口</button>
                ))}
              </section>
            </>
          ) : (
            <>
              <section className="child-switch work-child-switch work-third-switch work-view-row">
                <button className={operatorView === "operatorSummary" ? "child-tab active" : "child-tab"} onClick={() => setOperatorView("operatorSummary")}>操作人汇总表</button>
                <button className={operatorView === "operatorDetail" ? "child-tab active" : "child-tab"} onClick={() => setOperatorView("operatorDetail")}>操作人明细</button>
                <button className={operatorView === "operatorCompare" ? "child-tab active" : "child-tab"} onClick={() => setOperatorView("operatorCompare")}>操作人对比</button>
              </section>
              <section className="child-switch work-child-switch work-third-switch work-country-row">
                <button className={!filters.countries.length ? "child-tab active" : "child-tab"} onClick={() => selectOperatorCountry("")}>所有明细</button>
                {countries.map((country) => (
                  <button key={country} className={filters.countries.length === 1 && filters.countries[0] === country ? "child-tab active" : "child-tab"} onClick={() => selectOperatorCountry(country)}>{country}盘口</button>
                ))}
              </section>
            </>
          )}
        </>
      )}

      <div style={{ display: mainTab === "customer" ? "block" : "none" }}>
        <CustomerServiceDashboard embedded />
      </div>

      {mainTab !== "customer" && <section className="filter-card">
        <div className="filters work-filters">
          <div className="field">
            <label>开始日期</label>
            <input className="input" type="date" value={draftFilters.startDate} onChange={(e) => updateDraft("startDate", e.target.value)} />
          </div>
          <div className="field">
            <label>结束日期</label>
            <input className="input" type="date" value={draftFilters.endDate} onChange={(e) => updateDraft("endDate", e.target.value)} />
          </div>
          {!(mainTab === "orders" && (orderView === "orderDaily" || orderView === "orderMonthly")) && mainTab !== "operators" && <WorkMultiSelect label="国家" options={countries} value={draftFilters.countries} onChange={(value) => updateDraft("countries", value)} placeholder="全部国家" />}
          <WorkMultiSelect label="盘口 / 平台" options={platformOptions} value={draftFilters.platforms} onChange={(value) => updateDraft("platforms", value)} placeholder="全部平台" />
          <WorkMultiSelect label="工单类型" options={typeOptions} value={draftFilters.types} onChange={(value) => updateDraft("types", value)} placeholder="全部类型" />
          <WorkMultiSelect label="工单名称" options={nameOptions} value={draftFilters.names} onChange={(value) => updateDraft("names", value)} placeholder="全部工单" />
          <WorkMultiSelect label="岗位 / 账号类型" options={accountTypeOptions} value={draftFilters.accountTypes} onChange={(value) => updateDraft("accountTypes", value)} placeholder="全部岗位" />
          {mainTab === "operators" && <WorkMultiSelect label="操作人" options={operatorOptions} value={draftFilters.operators} onChange={(value) => updateDraft("operators", value)} placeholder="全部操作人" />}
          <div className="action-row action-row-v2">
            <button className="primary-btn" onClick={applyFilters}>查询</button>
            <button className="ghost-btn" onClick={resetFilters}>重置</button>
            <button className="ghost-btn" type="button" onClick={() => shiftDateRange(-1)}>{mainTab === "orders" && orderView === "orderMonthly" ? "上一月" : "上一日"}</button>
            <button className="ghost-btn" type="button" onClick={() => shiftDateRange(1)}>{mainTab === "orders" && orderView === "orderMonthly" ? "下一月" : "下一日"}</button>
            <button className="ghost-btn" onClick={handleExport}>导出</button>
          </div>
        </div>

        <div className="selected-row">
          <span>已选条件：</span>
          <b>{mainTab === "orders" && (orderView === "orderDaily" || orderView === "orderMonthly") ? "盘口" : "国家"}：{filterLabel(filters.countries, mainTab === "orders" && (orderView === "orderDaily" || orderView === "orderMonthly") ? "全部盘口" : "全部")}</b>
          <b>平台：{filterLabel(filters.platforms)}</b>
          <b>类型：{filterLabel(filters.types)}</b>
          <b>工单：{filterLabel(filters.names)}</b>
          <b>岗位：{filterLabel(filters.accountTypes, "全部岗位")}</b>
          {mainTab === "operators" && <b>操作人：{filterLabel(filters.operators)}</b>}
          <b>日期：{filters.startDate || "-"} 至 {filters.endDate || "-"}</b>
        </div>

        <div className="quick-row date-shortcuts">
          <span>快捷日期：</span>
          <button type="button" onClick={() => applyDateShortcut("today")}>今天</button>
          <button type="button" onClick={() => applyDateShortcut("yesterday")}>昨日</button>
          <button type="button" onClick={() => applyDateShortcut("beforeYesterday")}>前日</button>
          <button type="button" onClick={() => applyDateShortcut("thisWeek")}>本周</button>
          <button type="button" onClick={() => applyDateShortcut("lastWeek")}>上周</button>
          <button type="button" onClick={() => applyDateShortcut("thisMonth")}>本月</button>
          <button type="button" onClick={() => applyDateShortcut("lastMonth")}>上月</button>
        </div>

        <div className="quick-row date-shortcuts snapshot-month-row">
          <span>快照月份：</span>
          {snapshotMonthOptions.map((item) => (
            <button key={item.key} type="button" onClick={() => openSnapshotMonth(item)}>{item.label}</button>
          ))}
        </div>

        <div className="quick-row">
          <span>当前结果：</span>
          <label className="page-size-control">每页
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
          <b>工单日表 {formatNumber(dailyRowsRaw.length)} 行</b>
          <b>类型统计 {formatNumber(typeRowsRaw.length)} 行</b>
          <b>操作人 {formatNumber(operatorRowsRaw.length)} 行</b>
        </div>
      </section>}

      {mainTab === "orders" && orderView === "orderDashboard" && (
        <>
          <section className="metrics work-metrics">
            <MetricCard label="工单总数" value={formatNumber(dailySummary.total)} sub={`已处理 ${formatNumber(dailySummary.success)} · 已驳回 ${formatNumber(dailySummary.failed)}`} onClick={() => { setMainTab("orders"); setOrderView("orderDaily"); }} />
            <MetricCard label="处理完成率" value={formatPercent(dailySummary.successRate)} sub={`驳回率 ${formatPercent(dailySummary.failedRate)} · 已驳回 ${formatNumber(dailySummary.failed)}`} />
            <MetricCard label="自动处理" value={formatNumber(dailyAutoManual.auto)} sub={`自动占比 ${formatPercent(dailyAutoManual.autoRate)} · admin/system 归为自动`} onClick={() => setOrderView("orderDaily")} />
            <MetricCard label="人工处理" value={formatNumber(dailyAutoManual.manual)} sub={`人工占比 ${formatPercent(dailyAutoManual.manualRate)} · 非 admin 归为人工`} onClick={() => setOrderView("orderDaily")} />
            <MetricCard label="国家 / 平台" value={`${dailySummary.countries} / ${dailySummary.platforms}`} sub="按每日工单去重统计" />
            <MetricCard label="工单类型" value={formatNumber(typeSummary.types)} sub={`工单名称 ${formatNumber(typeSummary.names)} 个`} onClick={() => setOrderView("orderDaily")} />
            <MetricCard label="类型统计笔数" value={formatNumber(typeSummary.total)} sub="来自操作人明细聚合，不和日表重复计算" onClick={() => setOrderView("orderDaily")} />
            <MetricCard label="操作人记录" value={formatNumber(operatorSummary.operators)} sub="切换到操作人统计查看明细" onClick={() => { setMainTab("operators"); setOperatorView("operatorDetail"); }} />
          </section>

          <section className="chart-grid">
            <Panel title="平台工单排行" subtitle="按每日工单汇总，不读取底部类型表，避免重复。" action={<button className="ghost-btn small" onClick={() => openSummary("平台工单排行", orderPlatformRows, "orderDaily")}>查看更多</button>}>
              <MiniRank rows={orderPlatformRows.slice(0, 8)} valueKey="total" onOpen={(row) => openRows(`${row.country} ${row.platform} 工单明细`, rowsForSummary(row))} />
            </Panel>
            <Panel title="各类型排行" subtitle="来自操作人明细聚合，每个平台每种工单清楚显示。" action={<button className="ghost-btn small" onClick={() => openSummary("各平台类型排行", orderTypePlatformRows, "orderTypePlatform")}>查看更多</button>}>
              <MiniRank rows={orderTypePlatformRows.slice(0, 8)} valueKey="total" onOpen={(row) => openRows(`${row.country} ${row.platform} ${row.workName} 明细`, rowsForSummary(row))} />
            </Panel>
          </section>

          <section className="chart-grid">
            <Panel title="各国家类型占比" subtitle="按国家汇总类型表，保留在看板里查看，不再单独作为页签。">
              <CountryTypeSummaryList rows={countryTypeSummaryRows.slice(0, 12)} />
            </Panel>
            <Panel title="各国家平台数量" subtitle="当前日期范围内每个国家有几个平台。">
              <div className="mini-list">
                {Array.from(countryPlatformCounts.entries() as IterableIterator<[string, number]>).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([country, count], index) => (
                  <div className="rank-item" key={country}>
                    <div className="rank-no">{index + 1}</div>
                    <div><div className="rank-name">{country}</div><div className="rank-sub">平台数量</div></div>
                    <div className="rank-value">{count} 个</div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="自动 / 人工处理占比" subtitle="按国家汇总：admin/system 为自动，其余账号为人工。">
              <div className="mini-list">
                {countryAutoManualRows.slice(0, 12).map((row, index) => (
                  <div className="rank-item" key={row.country}>
                    <div className="rank-no">{index + 1}</div>
                    <div><div className="rank-name">{row.country}</div><div className="rank-sub">自动 {formatNumber(row.auto)} · 人工 {formatNumber(row.manual)}</div></div>
                    <div className="rank-value">{formatPercent(row.autoRate)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </section>

          <section className="chart-grid">
            <Panel title="周期对比总览" subtitle="可切换日 / 周 / 月，对比当前筛选范围最后两个周期。" action={<select className="input small-select" value={compareMode} onChange={(e) => setCompareMode(e.target.value as CompareMode)}><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select>}>
              <WorkCompareSummary row={workCompareTotal} />
            </Panel>
            <Panel title="各国家周期对比" subtitle="每个国家分别对比最后两个周期，方便快速定位变化。" action={<button className="ghost-btn small" onClick={() => openSummary("各国家周期对比", workCompareRows.map((r) => ({ country: r.label, platform: "全部平台", workType: "全部类型", workName: "全部工单", operator: "全部操作人", total: r.currentTotal, success: Math.round(r.currentSuccessRate * r.currentTotal), failed: Math.round(r.currentFailedRate * r.currentTotal), pending: 0, amount: 0, auto: 0, manual: 0 })), "orderDaily")}>查看更多</button>}>
              <WorkCountryCompareList rows={workCompareRows.slice(0, 10)} />
            </Panel>
          </section>
        </>
      )}

      {(mainTab === "orders" || mainTab === "operators") && (
        <Panel title={titleForView(view)} subtitle={subtitleForView(view)}>
          {mainTab === "orders" && (orderView === "orderDaily" || orderView === "orderMonthly" || orderView === "orderTypePlatform") ? orderOverviewCards : <SubViewSummaryCards view={view} rows={currentRows} />}
          {mainTab === "orders" && orderView === "orderDaily" && <WorkPlatformBreakdown rows={orderDailyRows} />}
          {mainTab === "orders" && orderView === "orderDaily" && <WorkCountryBreakdown rows={orderDailyRows} />}
          <Pagination total={currentRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
          {view === "operatorCompare" ? (
            <>
              <WorkTable rows={visibleRows as SummaryRow[]} totalRows={currentRows as SummaryRow[]} view={view} sortState={sort} onSort={toggleSort} onOpen={(row) => openRows("操作人明细", rowsForSummary(row))} expandedKeys={expandedDailyKeys} onToggleExpand={toggleDailyExpand} getExpandedRows={dailyTypeSummaryRows} onOpenChild={openTypeOperators} />
              <div className="operator-low-inline">
                <h4>连续低处理观察</h4>
                <p className="muted-text">合并在操作人对比里显示，按当前日期范围和国家盘口筛选。</p>
                <LowTable rows={operatorLowRows.slice(0, pageSize)} totalRows={operatorLowRows} sortState={sort} onSort={toggleSort} onOpen={(row) => openRows(`${row.operator} 低处理明细`, rowsForSummary(row))} />
              </div>
            </>
          ) : (
            <>
              <WorkTable rows={visibleRows as SummaryRow[]} totalRows={currentRows as SummaryRow[]} view={view} sortState={sort} onSort={toggleSort} onOpen={(row) => openRows("工单明细", rowsForSummary(row))} expandedKeys={expandedDailyKeys} onToggleExpand={toggleDailyExpand} getExpandedRows={dailyTypeSummaryRows} onOpenChild={openTypeOperators} />
              {mainTab === "orders" && (orderView === "orderDaily" || orderView === "orderMonthly") && (
                <div className="work-inline-rank-below">{orderTypeRankPanels}</div>
              )}
            </>
          )}
        </Panel>
      )}

      {detailModal && <WorkDetailModal detail={detailModal} onClose={() => setDetailModal(null)} />}
      {summaryModal && <WorkSummaryModal modal={summaryModal} onClose={() => setSummaryModal(null)} onOpenRows={(row) => openRows(`${row.country} ${row.platform} ${row.workName} 明细`, rowsForSummary(row))} onJump={jumpToSummary} />}
    </div>
  );
}

function MetricCard({ label, value, sub, onClick }: { label: string; value: string; sub: string; onClick?: () => void }) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{sub}</p>
    </>
  );
  if (onClick) {
    return <button type="button" className="metric-card metric-card-button" onClick={onClick}>{content}</button>;
  }
  return <div className="metric-card">{content}</div>;
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SortableTh({ label, sortKey, sortState, onSort, className = "" }: { label: string; sortKey: string; sortState: SortState; onSort: (key: string) => void; className?: string }) {
  const active = sortState.key === sortKey;
  const arrow = active ? (sortState.direction === "asc" ? "↑" : "↓") : "↕";
  return (
    <th className={`${className} sortable-th ${active ? "active" : ""}`}>
      <button className="th-sort-btn" type="button" onClick={() => onSort(sortKey)}>
        <span>{label}</span>
        <span className="sort-arrow">{arrow}</span>
      </button>
    </th>
  );
}

function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange }: { total: number; page: number; pageSize: number; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void }) {
  const totalPages = pageCount(total, pageSize);
  const start = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="pagination-row">
      <span>显示 {start} - {Math.min(page * pageSize, total)} / 共 {formatNumber(total)} 行</span>
      <div className="pager-actions">
        <label className="page-size-control">每页
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
        <button className="ghost-btn small" disabled={page <= 1} onClick={() => onPageChange(1)}>首页</button>
        <button className="ghost-btn small" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
        <strong>{page} / {totalPages}</strong>
        <button className="ghost-btn small" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</button>
        <button className="ghost-btn small" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>末页</button>
      </div>
    </div>
  );
}


function isLowRow(row: SummaryRow | CountryTypeShareRow | LowRow): row is LowRow {
  return "lowDays" in row;
}

function pageSummary(rows: Array<SummaryRow | CountryTypeShareRow | LowRow>) {
  const normalRows = rows.filter((row): row is SummaryRow | CountryTypeShareRow => !isLowRow(row));
  const lowRows = rows.filter(isLowRow);
  const total = normalRows.reduce((sum, row) => sum + row.total, 0) + lowRows.reduce((sum, row) => sum + row.total, 0);
  const success = normalRows.reduce((sum, row) => sum + row.success, 0);
  const failed = normalRows.reduce((sum, row) => sum + row.failed, 0);
  const pending = normalRows.reduce((sum, row) => sum + row.pending, 0);
  const auto = normalRows.reduce((sum, row) => sum + ("auto" in row ? row.auto : 0), 0);
  const manual = normalRows.reduce((sum, row) => sum + ("manual" in row ? row.manual : 0), 0);
  const countries = uniq(rows.map((row) => row.country));
  const platforms = uniq(rows.map((row) => row.platform));
  const types = uniq(normalRows.map((row) => row.workType));
  const names = uniq(normalRows.map((row) => row.workName));
  const operators = uniq(rows.map((row) => row.operator).filter(Boolean));
  const top = [...normalRows].sort((a, b) => b.total - a.total)[0];
  const topLow = [...lowRows].sort((a, b) => b.lowDays - a.lowDays || b.total - a.total)[0];
  return {
    total,
    success,
    failed,
    pending,
    auto,
    manual,
    countries: countries.length,
    platforms: platforms.length,
    types: types.length,
    names: names.length,
    operators: operators.length,
    successRate: total ? success / total : 0,
    failedRate: total ? failed / total : 0,
    pendingRate: total ? pending / total : 0,
    autoRate: auto + manual ? auto / (auto + manual) : 0,
    manualRate: auto + manual ? manual / (auto + manual) : 0,
    top,
    topLow
  };
}

function WorkPlatformBreakdown({ rows }: { rows: SummaryRow[] }) {
  const map = new Map<string, { key: string; country: string; platform: string; total: number; success: number; failed: number }>();
  for (const row of rows) {
    const key = `${row.country}|||${row.platform}`;
    const item = map.get(key) || { key, country: row.country, platform: row.platform, total: 0, success: 0, failed: 0 };
    item.total += row.total || 0;
    item.success += row.success || 0;
    item.failed += row.failed || 0;
    map.set(key, item);
  }
  const groups = Array.from(map.values()).filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
  const grandTotal = groups.reduce((sum, group) => sum + group.total, 0);
  if (groups.length <= 1 || !grandTotal) return null;
  return (
    <div className="work-platform-breakdown compact-breakdown">
      <div className="compact-breakdown-title">当前页面平台总订单占比</div>
      <div className="compact-breakdown-list platform-share-list">
        {groups.map((group) => (
          <div className="compact-breakdown-item platform-share-item" key={group.key}>
            <strong>{group.platform}</strong>
            <span>{group.country}</span>
            <span>总 {formatNumber(group.total)}</span>
            <span>占比 {formatPercent(group.total / grandTotal)}</span>
            <span>处理 {formatPercent(group.total ? group.success / group.total : 0)}</span>
            <span>驳回 {formatPercent(group.total ? group.failed / group.total : 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkCountryBreakdown({ rows }: { rows: SummaryRow[] }) {
  const groups = groupSummaryRowsByCountry(rows).filter((group) => group.total > 0);
  const grandTotal = groups.reduce((sum, group) => sum + group.total, 0);
  if (groups.length <= 1 || !grandTotal) return null;
  return (
    <div className="work-country-breakdown compact-breakdown">
      <div className="compact-breakdown-title">当前页面国家占比</div>
      <div className="compact-breakdown-list">
        {groups.map((group) => {
          const success = group.rows.reduce((sum, row) => sum + row.success, 0);
          const failed = group.rows.reduce((sum, row) => sum + row.failed, 0);
          const platformCount = uniq(group.rows.map((row) => row.platform)).length;
          return (
            <div className="compact-breakdown-item" key={group.country}>
              <strong>{group.country}</strong>
              <span>总 {formatNumber(group.total)}</span>
              <span>占比 {formatPercent(group.total / grandTotal)}</span>
              <span>处理 {formatPercent(group.total ? success / group.total : 0)}</span>
              <span>驳回 {formatPercent(group.total ? failed / group.total : 0)}</span>
              <span>平台 {platformCount}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubViewSummaryCards({ view, rows }: { view: WorkView; rows: Array<SummaryRow | CountryTypeShareRow | LowRow> }) {
  const s = pageSummary(rows);
  if (false) {
    return (
      <section className="metrics work-sub-metrics">
        <MetricCard label="命中人员" value={formatNumber(rows.length)} sub="当前筛选范围低处理记录" />
        <MetricCard label="处理总量" value={formatNumber(s.total)} sub={`涉及国家 ${formatNumber(s.countries)} · 平台 ${formatNumber(s.platforms)}`} />
        <MetricCard label="操作人数" value={formatNumber(s.operators)} sub="按操作人去重" />
        <MetricCard label="最高低处理" value={s.topLow ? s.topLow.operator : "-"} sub={s.topLow ? `${s.topLow.country} ${s.topLow.platform} · ${formatNumber(s.topLow.lowDays)} 天` : "暂无"} />
      </section>
    );
  }

  if (view === "orderTypeCountry") {
    return (
      <section className="metrics work-sub-metrics">
        <MetricCard label="类型统计总数" value={formatNumber(s.total)} sub={`已处理 ${formatNumber(s.success)} · 已驳回 ${formatNumber(s.failed)}`} />
        <MetricCard label="平均处理率" value={formatPercent(s.successRate)} sub={`平均驳回率 ${formatPercent(s.failedRate)}`} />
        <MetricCard label="自动 / 人工" value={`${formatPercent(s.autoRate)} / ${formatPercent(s.manualRate)}`} sub={`自动 ${formatNumber(s.auto)} · 人工 ${formatNumber(s.manual)}`} />
        <MetricCard label="国家 / 类型" value={`${formatNumber(s.countries)} / ${formatNumber(s.types)}`} sub={`工单名称 ${formatNumber(s.names)} 个`} />
        <MetricCard label="最大类型" value={s.top ? s.top.workName : "-"} sub={s.top ? `${s.top.country} · ${formatNumber(s.top.total)}` : "暂无"} />
      </section>
    );
  }

  if (view === "orderTypePlatform") {
    return (
      <section className="metrics work-sub-metrics">
        <MetricCard label="类型统计总数" value={formatNumber(s.total)} sub={`已处理 ${formatNumber(s.success)} · 已驳回 ${formatNumber(s.failed)}`} />
        <MetricCard label="处理率 / 驳回率" value={`${formatPercent(s.successRate)} / ${formatPercent(s.failedRate)}`} sub="当前筛选后的平台类型统计" />
        <MetricCard label="自动 / 人工" value={`${formatPercent(s.autoRate)} / ${formatPercent(s.manualRate)}`} sub={`自动 ${formatNumber(s.auto)} · 人工 ${formatNumber(s.manual)}`} />
        <MetricCard label="国家 / 平台" value={`${formatNumber(s.countries)} / ${formatNumber(s.platforms)}`} sub={`类型 ${formatNumber(s.types)} · 工单 ${formatNumber(s.names)}`} />
        <MetricCard label="最大平台类型" value={s.top ? `${s.top.platform}` : "-"} sub={s.top ? `${s.top.workName} · ${formatNumber(s.top.total)}` : "暂无"} />
      </section>
    );
  }

  if (view === "operatorSummary" || view === "operatorDetail" || view === "operatorCompare") {
    return (
      <section className="metrics work-sub-metrics">
        <MetricCard label="操作处理总量" value={formatNumber(s.total)} sub={`已处理 ${formatNumber(s.success)} · 驳回 ${formatNumber(s.failed)}`} />
        <MetricCard label="操作人数" value={formatNumber(s.operators)} sub={`国家 ${formatNumber(s.countries)} · 平台 ${formatNumber(s.platforms)}`} />
        <MetricCard label="平均每人" value={formatNumber(s.operators ? s.total / s.operators : 0)} sub="按当前筛选计算" />
        <MetricCard label="自动 / 人工" value={`${formatPercent(s.autoRate)} / ${formatPercent(s.manualRate)}`} sub={`自动 ${formatNumber(s.auto)} · 人工 ${formatNumber(s.manual)}`} />
        <MetricCard label="最高操作人" value={s.top ? s.top.operator : "-"} sub={s.top ? `${s.top.country} ${s.top.platform} · ${formatNumber(s.top.total)}` : "暂无"} />
      </section>
    );
  }

  return (
    <section className="metrics work-sub-metrics">
      <MetricCard label="当前总工单" value={formatNumber(s.total)} sub={`已处理 ${formatNumber(s.success)} · 已驳回 ${formatNumber(s.failed)}`} />
      <MetricCard label="处理率 / 驳回率" value={`${formatPercent(s.successRate)} / ${formatPercent(s.failedRate)}`} sub={`已处理 ${formatNumber(s.success)} · 已驳回 ${formatNumber(s.failed)}`} />
      <MetricCard label="自动 / 人工" value={`${formatPercent(s.autoRate)} / ${formatPercent(s.manualRate)}`} sub={`自动 ${formatNumber(s.auto)} · 人工 ${formatNumber(s.manual)}`} />
      <MetricCard label="国家 / 平台" value={`${formatNumber(s.countries)} / ${formatNumber(s.platforms)}`} sub="跟随当前搜索条件" />
      <MetricCard label="最大平台" value={s.top ? s.top.platform : "-"} sub={s.top ? `${s.top.country} · ${formatNumber(s.top.total)}` : "暂无"} />
    </section>
  );
}

function groupSummaryRowsByCountry<T extends { country: string; total: number }>(rows: T[]): Array<{ country: string; total: number; rows: T[] }> {
  const map = new Map<string, { country: string; total: number; rows: T[] }>();
  for (const row of rows) {
    const country = row.country || "未知国家";
    const item = map.get(country) || { country, total: 0, rows: [] };
    item.total += row.total || 0;
    item.rows.push(row);
    map.set(country, item);
  }
  return Array.from(map.values()).sort((a, b) => workCountryRank(a.country) - workCountryRank(b.country) || b.total - a.total || a.country.localeCompare(b.country, "zh-CN", { numeric: true }));
}

function WorkCountrySections({ rows, view, sortState, onSort, onOpen }: { rows: SummaryRow[]; view: WorkView; sortState: SortState; onSort: (key: string) => void; onOpen: (row: SummaryRow) => void }) {
  if (!rows.length) return <div className="empty">没有匹配的工单数据</div>;
  const groups = groupSummaryRowsByCountry(rows);
  if (groups.length <= 1) {
    return <WorkTable rows={rows} view={view} sortState={sortState} onSort={onSort} onOpen={onOpen} />;
  }
  return (
    <div className="country-section-list">
      {groups.map((group) => {
        const s = pageSummary(group.rows);
        return (
          <section className="country-data-section" key={group.country}>
            <div className="country-section-header">
              <div>
                <h4>{group.country}</h4>
                <p>总数 {formatNumber(s.total)} · 已处理 {formatNumber(s.success)} · 已驳回 {formatNumber(s.failed)} · 自动 {formatNumber(s.auto)} · 人工 {formatNumber(s.manual)} · 平台 {formatNumber(s.platforms)} 个</p>
              </div>
              <div className="country-section-rate">
                <span>处理率 {formatPercent(s.successRate)}</span>
                <span>驳回率 {formatPercent(s.failedRate)}</span>
                <span>自动/人工 {formatPercent(s.autoRate)} / {formatPercent(s.manualRate)}</span>
              </div>
            </div>
            <WorkTable rows={group.rows} view={view} sortState={sortState} onSort={onSort} onOpen={onOpen} hideCountry />
          </section>
        );
      })}
    </div>
  );
}

function CountryTypeShareCountrySections({ rows, sortState, onSort, onOpen }: { rows: CountryTypeShareRow[]; sortState: SortState; onSort: (key: string) => void; onOpen: (row: CountryTypeShareRow) => void }) {
  if (!rows.length) return <div className="empty">没有匹配的国家类型数据</div>;
  const groups = groupSummaryRowsByCountry(rows);
  if (groups.length <= 1) {
    return <CountryTypeShareTable rows={rows} sortState={sortState} onSort={onSort} onOpen={onOpen} />;
  }
  return (
    <div className="country-section-list">
      {groups.map((group) => {
        const s = pageSummary(group.rows);
        return (
          <section className="country-data-section" key={group.country}>
            <div className="country-section-header">
              <div>
                <h4>{group.country}</h4>
                <p>类型总数 {formatNumber(s.total)} · 自动 {formatNumber(s.auto)} · 人工 {formatNumber(s.manual)} · 类型 {formatNumber(s.types)} 个</p>
              </div>
              <div className="country-section-rate">
                <span>类型处理率 {formatPercent(s.successRate)}</span>
                <span>自动/人工 {formatPercent(s.autoRate)} / {formatPercent(s.manualRate)}</span>
              </div>
            </div>
            <CountryTypeShareTable rows={group.rows} sortState={sortState} onSort={onSort} onOpen={onOpen} hideCountry />
          </section>
        );
      })}
    </div>
  );
}

function WorkTable({ rows, totalRows = rows, view, sortState, onSort, onOpen, hideCountry = false, expandedKeys = [], onToggleExpand, getExpandedRows, onOpenChild }: { rows: SummaryRow[]; totalRows?: SummaryRow[]; view: WorkView; sortState: SortState; onSort: (key: string) => void; onOpen: (row: SummaryRow) => void; hideCountry?: boolean; expandedKeys?: string[]; onToggleExpand?: (row: SummaryRow) => void; getExpandedRows?: (row: SummaryRow) => SummaryRow[]; onOpenChild?: (row: SummaryRow) => void }) {
  const shownSummary = pageSummary(rows);
  const allSummary = pageSummary(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的工单数据</div>;

  const isOperatorView = view === "operatorSummary" || view === "operatorDetail" || view === "operatorCompare";
  const showDate = view === "orderDaily" || view === "operatorDetail";
  const showType = view === "orderTypePlatform" || view === "orderTypeCountry" || view === "orderAnomaly";
  const showName = view === "orderTypePlatform" || view === "orderTypeCountry";
  const showOperator = isOperatorView;
  const showOperatorMode = isOperatorView;
  const showPending = false;
  // 操作人页面也要看“这个操作人占当前筛选总量多少”，比分开显示自动/人工 100% 有意义。
  const showShare = view === "orderTypePlatform" || view === "orderDaily" || isOperatorView;
  const showAutoManual = !isOperatorView && (view === "orderDaily" || view === "orderTypePlatform" || view === "orderTypeCountry" || view === "orderAnomaly");
  const shareTotal = totalRows.reduce((sum, row) => sum + row.total, 0);
  const allowExpand = view === "orderDaily" && !!onToggleExpand && !!getExpandedRows;
  const leadingColSpan = Math.max(1,
    (showDate ? 1 : 0) +
    (hideCountry ? 0 : 1) +
    1 +
    (showType ? 1 : 0) +
    (showName ? 1 : 0) +
    (showOperator ? 1 : 0) +
    (showOperatorMode ? 1 : 0)
  );
  const expandedColSpan = leadingColSpan + 1 + (showShare ? 1 : 0) + 2 + (showPending ? 1 : 0) + (showAutoManual ? 4 : 0) + 2 + 1;

  return (
    <div className="table-wrap work-table-wrap">
      <table>
        <thead>
          <tr>
            {showDate && <SortableTh label="日期" sortKey="date" sortState={sortState} onSort={onSort} />}
            {!hideCountry && <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />}
            <SortableTh label="平台" sortKey="platform" sortState={sortState} onSort={onSort} />
            {showType && <SortableTh label="工单类型" sortKey="workType" sortState={sortState} onSort={onSort} />}
            {showName && <SortableTh label="工单名称" sortKey="workName" sortState={sortState} onSort={onSort} />}
            {showOperator && <SortableTh label="操作人" sortKey="operator" sortState={sortState} onSort={onSort} />}
            {showOperatorMode && <th>操作属性</th>}
            <SortableTh label="总数" sortKey="total" sortState={sortState} onSort={onSort} className="num" />
            {showShare && <th>{isOperatorView ? "总占比" : view === "orderDaily" ? "总订单占比" : "类型占比"}</th>}
            <SortableTh label="已处理" sortKey="success" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="已驳回" sortKey="failed" sortState={sortState} onSort={onSort} className="num" />
            {showPending && <SortableTh label="待处理/处理中" sortKey="pending" sortState={sortState} onSort={onSort} className="num" />}
            {showAutoManual && <SortableTh label="自动处理" sortKey="auto" sortState={sortState} onSort={onSort} className="num" />}
            {showAutoManual && <SortableTh label="人工处理" sortKey="manual" sortState={sortState} onSort={onSort} className="num" />}
            {showAutoManual && <SortableTh label="自动占比" sortKey="autoRate" sortState={sortState} onSort={onSort} />}
            {showAutoManual && <SortableTh label="人工占比" sortKey="manualRate" sortState={sortState} onSort={onSort} />}
            <SortableTh label="处理率" sortKey="successRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="驳回率" sortKey="failedRate" sortState={sortState} onSort={onSort} />
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = summaryRowKey(row);
            const expanded = allowExpand ? expandedKeys.includes(rowKey) : false;
            const childRows = expanded && getExpandedRows ? getExpandedRows(row) : [];
            return (
              <Fragment key={rowKey}>
                <tr key={`${index}-${row.date}-${row.country}-${row.platform}-${row.workType}-${row.workName}-${row.operator}`}>
                  {showDate && <td>{row.date || "-"}</td>}
                  {!hideCountry && <td><span className="country-pill">{row.country}</span></td>}
                  <td className="platform-cell">{row.platform}</td>
                  {showType && <td>{row.workType}</td>}
                  {showName && <td>{row.workName}</td>}
                  {showOperator && <td>{row.operator || "-"}</td>}
                  {showOperatorMode && <td><OperatorModeBadge row={row} /></td>}
                  <td className="num">{formatNumber(row.total)}</td>
                  {showShare && <td><RateBar value={shareTotal ? row.total / shareTotal : 0} /></td>}
                  <td className="num">{formatNumber(row.success)}</td>
                  <td className="num">{formatNumber(row.failed)}</td>
                  {showPending && <td className="num">{formatNumber(row.pending)}</td>}
                  {showAutoManual && <td className="num">{formatNumber(row.auto)}</td>}
                  {showAutoManual && <td className="num">{formatNumber(row.manual)}</td>}
                  {showAutoManual && <td><RateBar value={row.auto + row.manual ? row.auto / (row.auto + row.manual) : 0} /></td>}
                  {showAutoManual && <td><RateBar value={row.auto + row.manual ? row.manual / (row.auto + row.manual) : 0} danger /></td>}
                  <td><RateBar value={row.total ? row.success / row.total : 0} /></td>
                  <td><RateBar value={row.total ? row.failed / row.total : 0} danger /></td>
                  <td>{allowExpand ? <button className="ghost-btn small" type="button" onClick={() => onToggleExpand?.(row)}>{expanded ? "收起" : "展开"}</button> : <button className="ghost-btn small" type="button" onClick={() => onOpen(row)}>查看</button>}</td>
                </tr>
                {allowExpand && expanded && (
                  <tr key={`${rowKey}-expanded`} className="expanded-subrow">
                    <td colSpan={expandedColSpan}>
                      <ExpandedTypeTable rows={childRows} parentTotal={row.total} onOpen={onOpenChild || onOpen} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row">
            <td colSpan={leadingColSpan}>当前页汇总</td>
            <td className="num strong-cell">{formatNumber(shownSummary.total)}</td>
            {showShare && <td>{shareTotal ? formatPercent(shownSummary.total / shareTotal) : "-"}</td>}
            <td className="num">{formatNumber(shownSummary.success)}</td>
            <td className="num">{formatNumber(shownSummary.failed)}</td>
            {showPending && <td className="num">{formatNumber(shownSummary.pending)}</td>}
            {showAutoManual && <td className="num">{formatNumber(shownSummary.auto)}</td>}
            {showAutoManual && <td className="num">{formatNumber(shownSummary.manual)}</td>}
            {showAutoManual && <td>{shownSummary.auto + shownSummary.manual ? formatPercent(shownSummary.auto / (shownSummary.auto + shownSummary.manual)) : "-"}</td>}
            {showAutoManual && <td>{shownSummary.auto + shownSummary.manual ? formatPercent(shownSummary.manual / (shownSummary.auto + shownSummary.manual)) : "-"}</td>}
            <td>{formatPercent(shownSummary.successRate)}</td>
            <td>{formatPercent(shownSummary.failedRate)}</td>
            <td className="muted-cell">汇总</td>
          </tr>
          <tr className="summary-row overall-summary-row">
            <td colSpan={leadingColSpan}>全部汇总</td>
            <td className="num strong-cell">{formatNumber(allSummary.total)}</td>
            {showShare && <td>{shareTotal ? formatPercent(allSummary.total / shareTotal) : "-"}</td>}
            <td className="num">{formatNumber(allSummary.success)}</td>
            <td className="num">{formatNumber(allSummary.failed)}</td>
            {showPending && <td className="num">{formatNumber(allSummary.pending)}</td>}
            {showAutoManual && <td className="num">{formatNumber(allSummary.auto)}</td>}
            {showAutoManual && <td className="num">{formatNumber(allSummary.manual)}</td>}
            {showAutoManual && <td>{allSummary.auto + allSummary.manual ? formatPercent(allSummary.auto / (allSummary.auto + allSummary.manual)) : "-"}</td>}
            {showAutoManual && <td>{allSummary.auto + allSummary.manual ? formatPercent(allSummary.manual / (allSummary.auto + allSummary.manual)) : "-"}</td>}
            <td>{formatPercent(allSummary.successRate)}</td>
            <td>{formatPercent(allSummary.failedRate)}</td>
            <td className="muted-cell">汇总</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ExpandedTypeTable({ rows, parentTotal, onOpen }: { rows: SummaryRow[]; parentTotal: number; onOpen: (row: SummaryRow) => void }) {
  if (!rows.length) return <div className="empty">当前平台当天暂无可展开的子工单类型</div>;
  // 子类型占比以展开出来的子类型合计为分母，确保所有子类型占比加总接近 100%。
  const childTotal = rows.reduce((sum, row) => sum + row.total, 0) || parentTotal;
  return (
    <div className="expanded-type-table-wrap">
      <div className="expanded-type-title">包含的各种类型订单</div>
      <table className="expanded-type-table">
        <thead>
          <tr>
            <th>工单类型</th>
            <th>工单名称</th>
            <th>总数</th>
            <th>类型占比</th>
            <th>已处理</th>
            <th>已驳回</th>
            <th>自动处理</th>
            <th>人工处理</th>
            <th>自动占比</th>
            <th>人工占比</th>
            <th>处理率</th>
            <th>驳回率</th>
            <th>操作人</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${summaryRowKey(row)}-${index}`}>
              <td>{row.workType || "-"}</td>
              <td>{row.workName || "-"}</td>
              <td className="num">{formatNumber(row.total)}</td>
              <td><RateBar value={childTotal ? row.total / childTotal : 0} /></td>
              <td className="num">{formatNumber(row.success)}</td>
              <td className="num">{formatNumber(row.failed)}</td>
              <td className="num">{formatNumber(row.auto)}</td>
              <td className="num">{formatNumber(row.manual)}</td>
              <td><RateBar value={row.auto + row.manual ? row.auto / (row.auto + row.manual) : 0} /></td>
              <td><RateBar value={row.auto + row.manual ? row.manual / (row.auto + row.manual) : 0} danger /></td>
              <td><RateBar value={row.total ? row.success / row.total : 0} /></td>
              <td><RateBar value={row.total ? row.failed / row.total : 0} danger /></td>
              <td><button className="ghost-btn small" type="button" onClick={() => onOpen(row)}>查看</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LowTable({ rows, totalRows = rows, sortState, onSort, onOpen }: { rows: LowRow[]; totalRows?: LowRow[]; sortState: SortState; onSort: (key: string) => void; onOpen: (row: LowRow) => void }) {
  const shownSummary = pageSummary(rows);
  const allSummary = pageSummary(totalRows);
  if (!rows.length) return <div className="empty">当前筛选范围暂无连续低处理人员</div>;
  return (
    <div className="table-wrap work-table-wrap">
      <table>
        <thead>
          <tr>
            <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />
            <SortableTh label="平台" sortKey="platform" sortState={sortState} onSort={onSort} />
            <SortableTh label="操作人" sortKey="operator" sortState={sortState} onSort={onSort} />
            <SortableTh label="统计天数" sortKey="days" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="低处理天数" sortKey="lowDays" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="总处理" sortKey="total" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="日均处理" sortKey="avg" sortState={sortState} onSort={onSort} className="num" />
            <th>命中日期</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${row.country}-${row.platform}-${row.operator}`}>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td>{row.operator}</td>
              <td className="num">{row.days}</td>
              <td className="num">{row.lowDays}</td>
              <td className="num">{formatNumber(row.total)}</td>
              <td className="num">{formatNumber(row.avg)}</td>
              <td className="wide-text">{row.dates || "-"}</td>
              <td><button className="ghost-btn small" type="button" onClick={() => onOpen(row)}>查看</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={2}>当前页汇总</td><td>-</td><td className="num">-</td><td className="num strong-cell">{formatNumber(shownSummary.total)}</td><td className="num">{formatNumber(rows.reduce((sum, row) => sum + row.avg, 0) / Math.max(1, rows.length))}</td><td>-</td><td className="muted-cell">汇总</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={2}>全部汇总</td><td>-</td><td className="num">-</td><td className="num strong-cell">{formatNumber(allSummary.total)}</td><td className="num">{formatNumber(totalRows.reduce((sum, row) => sum + row.avg, 0) / Math.max(1, totalRows.length))}</td><td>-</td><td className="muted-cell">汇总</td></tr>
        </tfoot>
      </table>
    </div>
  );
}


function CountryTypeSummaryList({ rows }: { rows: Array<{ country: string; total: number; success: number; failed: number; pending: number; auto: number; manual: number; autoRate: number; manualRate: number }> }) {
  if (!rows.length) return <div className="empty">暂无国家类型统计</div>;
  return (
    <div className="mini-list">
      {rows.map((row, index) => (
        <div className="rank-item" key={row.country}>
          <div className="rank-no">{index + 1}</div>
          <div>
            <div className="rank-name">{row.country}</div>
            <div className="rank-sub">总数 {formatNumber(row.total)} · 处理率 {formatPercent(row.total ? row.success / row.total : 0)} · 驳回率 {formatPercent(row.total ? row.failed / row.total : 0)}</div>
          </div>
          <div className="rank-value">自动 {formatPercent(row.autoRate)} / 人工 {formatPercent(row.manualRate)}</div>
        </div>
      ))}
    </div>
  );
}

function CountryTypeShareTable({ rows, totalRows = rows, sortState, onSort, onOpen, hideCountry = false }: { rows: CountryTypeShareRow[]; totalRows?: CountryTypeShareRow[]; sortState: SortState; onSort: (key: string) => void; onOpen: (row: CountryTypeShareRow) => void; hideCountry?: boolean }) {
  const shownSummary = pageSummary(rows);
  const allSummary = pageSummary(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的国家类型数据</div>;
  return (
    <div className="table-wrap work-table-wrap">
      <table>
        <thead>
          <tr>
            {!hideCountry && <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />}
            <SortableTh label="工单类型" sortKey="workType" sortState={sortState} onSort={onSort} />
            <SortableTh label="工单名称" sortKey="workName" sortState={sortState} onSort={onSort} />
            <SortableTh label="国家总数" sortKey="countryTotal" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="类型总数" sortKey="total" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="类型占比" sortKey="share" sortState={sortState} onSort={onSort} />
            <SortableTh label="已处理" sortKey="success" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="已驳回" sortKey="failed" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="处理率" sortKey="successRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="驳回率" sortKey="failedRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="自动处理" sortKey="auto" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="人工处理" sortKey="manual" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="自动占比" sortKey="autoRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="人工占比" sortKey="manualRate" sortState={sortState} onSort={onSort} />
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${row.country}-${row.workType}-${row.workName}`}>
              {!hideCountry && <td><span className="country-pill">{row.country}</span></td>}
              <td>{row.workType}</td>
              <td>{row.workName}</td>
              <td className="num">{formatNumber(row.countryTotal)}</td>
              <td className="num">{formatNumber(row.total)}</td>
              <td><RateBar value={row.share} /></td>
              <td className="num">{formatNumber(row.success)}</td>
              <td className="num">{formatNumber(row.failed)}</td>
              <td><RateBar value={row.total ? row.success / row.total : 0} /></td>
              <td><RateBar value={row.total ? row.failed / row.total : 0} danger /></td>
              <td className="num">{formatNumber(row.auto)}</td>
              <td className="num">{formatNumber(row.manual)}</td>
              <td><RateBar value={row.autoRate} /></td>
              <td><RateBar value={row.manualRate} danger /></td>
              <td><button className="ghost-btn small" type="button" onClick={() => onOpen(row)}>查看</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={hideCountry ? 3 : 4}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.total)}</td><td>{formatPercent(shownSummary.total ? shownSummary.total / shownSummary.total : 1)}</td><td className="num">{formatNumber(shownSummary.success)}</td><td className="num">{formatNumber(shownSummary.failed)}</td><td>{formatPercent(shownSummary.successRate)}</td><td>{formatPercent(shownSummary.failedRate)}</td><td className="num">{formatNumber(shownSummary.auto)}</td><td className="num">{formatNumber(shownSummary.manual)}</td><td>{formatPercent(shownSummary.autoRate)}</td><td>{formatPercent(shownSummary.manualRate)}</td><td className="muted-cell">汇总</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={hideCountry ? 3 : 4}>全部汇总</td><td className="num strong-cell">{formatNumber(allSummary.total)}</td><td>{formatPercent(1)}</td><td className="num">{formatNumber(allSummary.success)}</td><td className="num">{formatNumber(allSummary.failed)}</td><td>{formatPercent(allSummary.successRate)}</td><td>{formatPercent(allSummary.failedRate)}</td><td className="num">{formatNumber(allSummary.auto)}</td><td className="num">{formatNumber(allSummary.manual)}</td><td>{formatPercent(allSummary.autoRate)}</td><td>{formatPercent(allSummary.manualRate)}</td><td className="muted-cell">汇总</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function RateBar({ value, danger = false }: { value: number; danger?: boolean }) {
  const width = Math.max(0, Math.min(100, value * 100));
  return (
    <div className={danger ? "rate-cell danger rate-cell-scale" : "rate-cell rate-cell-scale"}>
      <span>{formatPercent(value)}</span>
      {width > 0 ? <span className="bar"><i className="bar-fill" style={{ width: `${width}%` }} /></span> : null}
    </div>
  );
}

function operatorModeForRow(row: SummaryRow): "auto" | "manual" | "mixed" {
  if (row.auto > 0 && row.manual > 0) return "mixed";
  if (row.auto > 0 || isAutoOperatorName(row.operator)) return "auto";
  return "manual";
}

function OperatorModeBadge({ row }: { row: SummaryRow }) {
  const mode = operatorModeForRow(row);
  const label = mode === "auto" ? "自动" : mode === "mixed" ? "混合" : "人工";
  return <span className={`operator-mode-pill ${mode}`}>{label}</span>;
}

function MiniRank({ rows, valueKey, onOpen }: { rows: SummaryRow[]; valueKey: keyof SummaryRow; onOpen: (row: SummaryRow) => void }) {
  if (!rows.length) return <div className="empty">暂无数据</div>;
  return (
    <div className="mini-list">
      {rows.map((row, index) => (
        <button className="rank-item rank-button" type="button" key={`${index}-${row.country}-${row.platform}-${row.workType}-${row.workName}-${row.operator}`} onClick={() => onOpen(row)}>
          <div className="rank-no">{index + 1}</div>
          <div>
            <div className="rank-name">{row.operator && row.operator !== "全部操作人" ? row.operator : row.platform !== "全部平台" ? row.platform : row.workName !== "全部工单" ? row.workName : row.workType}</div>
            <div className="rank-sub">{row.country} · {row.platform} · {row.workType}</div>
          </div>
          <div className="rank-value">{formatNumber(Number(row[valueKey] || 0))}</div>
        </button>
      ))}
    </div>
  );
}

function LowList({ rows, onOpen }: { rows: LowRow[]; onOpen: (row: LowRow) => void }) {
  if (!rows.length) return <div className="empty">暂无连续低处理数据</div>;
  return (
    <div className="mini-list">
      {rows.map((row, index) => (
        <button className="rank-item rank-button" type="button" key={`${index}-${row.country}-${row.platform}-${row.operator}`} onClick={() => onOpen(row)}>
          <div className="rank-no danger-no">{index + 1}</div>
          <div>
            <div className="rank-name">{row.operator}</div>
            <div className="rank-sub">{row.country} · {row.platform} · 命中 {row.lowDays}/{row.days} 天</div>
          </div>
          <div className="rank-value">{formatNumber(row.avg)}</div>
        </button>
      ))}
    </div>
  );
}

function AnomalyList({ rows, onOpen }: { rows: SummaryRow[]; onOpen: (row: SummaryRow) => void }) {
  if (!rows.length) return <div className="empty">当前筛选结果暂无明显异常</div>;
  return (
    <div className="alert-list">
      {rows.map((row, index) => (
        <button className="alert-item alert-clickable" type="button" key={`${index}-${row.country}-${row.platform}`} onClick={() => onOpen(row)}>
          <span className="alert-dot" />
          <span>{row.country} {row.platform}：驳回率 {formatPercent(row.total ? row.failed / row.total : 0)}</span>
          <b>查看</b>
        </button>
      ))}
    </div>
  );
}

function DiffBadge({ value, inverse = false }: { value: number; inverse?: boolean }) {
  const improved = inverse ? value < 0 : value > 0;
  const worse = inverse ? value > 0 : value < 0;
  const cls = improved ? "good" : worse ? "bad" : "neutral";
  const sign = value > 0 ? "+" : "";
  return <span className={`compare-badge ${cls}`}>{sign}{formatPercent(value)}</span>;
}

function WorkCompareSummary({ row }: { row?: CompareRow }) {
  if (!row) return <div className="empty">当前日期范围不足 2 天，暂无对比数据</div>;
  return (
    <div className="compare-card-grid">
      <div className="compare-card"><span>总数对比</span><strong><DiffBadge value={row.totalDiff} /></strong><p>当前 {formatNumber(row.currentTotal)} · 前日 {formatNumber(row.previousTotal)}</p></div>
      <div className="compare-card"><span>处理率对比</span><strong><DiffBadge value={row.successRateDiff} /></strong><p>当前 {formatPercent(row.currentSuccessRate)} · 前日 {formatPercent(row.previousSuccessRate)}</p></div>
      <div className="compare-card"><span>驳回率对比</span><strong><DiffBadge value={row.failedRateDiff} inverse /></strong><p>当前 {formatPercent(row.currentFailedRate)} · 前日 {formatPercent(row.previousFailedRate)}</p></div>
    </div>
  );
}

function WorkCountryCompareList({ rows }: { rows: CompareRow[] }) {
  if (!rows.length) return <div className="empty">暂无国家对比数据</div>;
  return (
    <div className="mini-list">
      {rows.map((row, index) => (
        <div className="rank-item" key={row.label}>
          <div className="rank-no">{index + 1}</div>
          <div>
            <div className="rank-name">{row.label}</div>
            <div className="rank-sub">总数 {formatNumber(row.currentTotal)} · 处理率 {formatPercent(row.currentSuccessRate)} · 驳回率 {formatPercent(row.currentFailedRate)}</div>
          </div>
          <div className="rank-value compare-inline"><DiffBadge value={row.totalDiff} /></div>
        </div>
      ))}
    </div>
  );
}


function WorkSummaryModal({ modal, onClose, onOpenRows, onJump }: { modal: SummaryModal; onClose: () => void; onOpenRows: (row: SummaryRow) => void; onJump: (row: SummaryRow, targetView: WorkView) => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="detail-modal work-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="detail-modal-header">
          <div>
            <h3>{modal.title}</h3>
            <p>{modal.subtitle}</p>
          </div>
          <button className="ghost-btn small" type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="detail-table-wrap no-horizontal">
          <table className="detail-table work-detail-table">
            <thead>
              <tr>
                <th>国家</th><th>平台</th><th>类型</th><th>工单</th><th>操作人</th><th>总数</th><th>已处理</th><th>驳回</th><th>自动</th><th>人工</th><th>自动占比</th><th>人工占比</th><th>处理率</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {modal.rows.slice(0, 500).map((row, index) => (
                <tr key={`${index}-${row.country}-${row.platform}-${row.workType}-${row.workName}-${row.operator}`}>
                  <td>{row.country}</td><td>{row.platform}</td><td>{row.workType}</td><td>{row.workName}</td><td>{row.operator || "-"}</td>
                  <td>{formatNumber(row.total)}</td><td>{formatNumber(row.success)}</td><td>{formatNumber(row.failed)}</td><td>{formatNumber(row.auto)}</td><td>{formatNumber(row.manual)}</td><td>{formatPercent(row.auto + row.manual ? row.auto / (row.auto + row.manual) : 0)}</td><td>{formatPercent(row.auto + row.manual ? row.manual / (row.auto + row.manual) : 0)}</td><td>{formatPercent(row.total ? row.success / row.total : 0)}</td>
                  <td><button className="ghost-btn small" onClick={() => onOpenRows(row)}>明细</button><button className="ghost-btn small" onClick={() => onJump(row, modal.targetView)}>跳转</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WorkDetailModal({ detail, onClose }: { detail: DetailModal; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="detail-modal work-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="detail-modal-header">
          <div>
            <h3>{detail.title}</h3>
            <p>{detail.subtitle}</p>
          </div>
          <button className="ghost-btn small" type="button" onClick={onClose}>关闭</button>
        </div>
        {detail.summary && (
          <div className="modal-summary-grid">
            <MetricCard label="总数" value={formatNumber(detail.summary.total)} sub={`已处理 ${formatNumber(detail.summary.success)} · 驳回 ${formatNumber(detail.summary.failed)}`} />
            <MetricCard label="处理率" value={formatPercent(detail.summary.successRate)} sub={`驳回率 ${formatPercent(detail.summary.failedRate)} · 已驳回 ${formatNumber(detail.summary.failed)}`} />
            <MetricCard label="自动 / 人工" value={`${formatPercent(detail.summary.autoRate)} / ${formatPercent(detail.summary.manualRate)}`} sub={`自动 ${formatNumber(detail.summary.auto)} · 人工 ${formatNumber(detail.summary.manual)}`} />
            <MetricCard label="国家 / 平台" value={`${detail.summary.countries} / ${detail.summary.platforms}`} sub="弹窗明细范围" />
          </div>
        )}
        <div className="detail-table-wrap no-horizontal">
          <table className="detail-table work-detail-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>国家</th>
                <th>平台</th>
                <th>类型</th>
                <th>工单名称</th>
                <th>操作人</th>
                <th>岗位</th>
                <th>总数</th>
                <th>已处理</th>
                <th>已驳回</th>
                <th>自动处理</th>
                <th>人工处理</th>
                <th>自动占比</th>
                <th>人工占比</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.date || "-"}</td>
                  <td><span className="country-pill">{row.country}</span></td>
                  <td className="platform-cell">{row.platform}</td>
                  <td>{row.workType}</td>
                  <td>{row.workName}</td>
                  <td>{row.operator || "-"}</td>
                  <td>{row.accountType || "-"}</td>
                  <td>{formatNumber(row.total)}</td>
                  <td>{formatNumber(row.success)}</td>
                  <td>{formatNumber(row.failed)}</td>
                  {(() => { const am = autoManualForRow(row); const total = am.auto + am.manual; return <>
                    <td>{formatNumber(am.auto)}</td>
                    <td>{formatNumber(am.manual)}</td>
                    <td>{formatPercent(total ? am.auto / total : 0)}</td>
                    <td>{formatPercent(total ? am.manual / total : 0)}</td>
                  </>; })()}
                  <td>{row.sourceSheet} #{row.sourceRow}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!detail.rows.length && <div className="empty">没有明细数据</div>}
        </div>
      </div>
    </div>
  );
}

function WorkMultiSelect({ label, options, value, onChange, placeholder }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  const visibleOptions = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return options.filter((item) => !q || item.toLowerCase().includes(q));
  }, [keyword, options]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (target && boxRef.current && !boxRef.current.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [open]);

  function toggleOption(item: string) {
    if (value.includes(item)) onChange(value.filter((x) => x !== item));
    else onChange([...value, item]);
  }

  return (
    <div ref={boxRef} className="field multi-field">
      <label>{label}</label>
      <button className="multi-button" type="button" onClick={() => setOpen((x) => !x)}>
        <span>{value.length ? filterLabel(value, placeholder) : placeholder}</span>
        <span className="multi-caret">▾</span>
      </button>
      {open && (
        <div className="multi-menu">
          <input className="multi-search" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={`搜索${label}`} />
          <div className="multi-actions">
            <button type="button" onClick={() => onChange(uniq([...value, ...visibleOptions]))}>全选当前</button>
            <button type="button" onClick={() => { onChange([]); setKeyword(""); }}>清空</button>
            <button type="button" onClick={() => setOpen(false)}>完成</button>
          </div>
          <div className="multi-list">
            {visibleOptions.map((item) => (
              <label className="multi-option" key={item}>
                <input type="checkbox" checked={value.includes(item)} onChange={() => toggleOption(item)} />
                <span>{item}</span>
              </label>
            ))}
            {!visibleOptions.length && <div className="multi-empty">没有匹配选项</div>}
          </div>
          <div className="multi-footer">已选 {value.length} 项，点击“查询”后才会刷新数据</div>
        </div>
      )}
    </div>
  );
}
