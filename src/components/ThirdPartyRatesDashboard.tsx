"use client";

import { useDashboardAuth } from "./DashboardAuthGate";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ThirdPartyPlatformStatusRow, ThirdPartyRatePayload, ThirdPartyRateRow } from "@/lib/types";
import { canonicalThirdPartyName } from "@/lib/thirdPartyNameMap";
import { formatNumber, formatPercent } from "@/lib/format";

type RateView = "dashboard" | "running" | "country" | "platform" | "rates" | "anomalies";
type RateMainView = "dashboard" | "countryRates";
type LoadState = "loading" | "ready" | "error";
type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection };

type RateFilters = {
  countries: string[];
  sheets: string[];
  platforms: string[];
  thirdParties: string[];
  categories: string[];
  statuses: string[];
  channelTypes: string[];
  keyword: string;
};

type CsvColumn<T> = {
  label: string;
  value: (row: T) => string | number;
};

type RateAnomalyDetail = {
  title: string;
  message: string;
  statusRows: ThirdPartyPlatformStatusRow[];
  rateRows: ThirdPartyRateRow[];
};

type ThirdPartyRunningRow = {
  thirdParty: string;
  country: string;
  countries: string;
  sheets: string;
  platforms: string;
  missingPlatforms: string;
  total: number;
  open: number;
  backup: number;
  bad: number;
  missing: number;
  openRate: number;
  statusSummary: string;
  collectFeeSummary: string;
  payoutFeeSummary: string;
  totalFeeSummary: string;
};

type CountryThirdPartyRow = {
  country: string;
  totalThirdParties: number;
  openThirdParties: number;
  backupThirdParties: number;
  badThirdParties: number;
  platforms: number;
  thirdParties: string;
  typeSummary: string;
  typeDetail: string;
  statusSummary: string;
};

type CountryRateSummaryRow = {
  country: string;
  platforms: number;
  thirdParties: number;
  statusRows: number;
  open: number;
  bad: number;
  backup: number;
  openRate: number;
  highFee: number;
  highFeeParties: string;
};

const EMPTY_RATE_FILTERS: RateFilters = {
  countries: [],
  sheets: [],
  platforms: [],
  thirdParties: [],
  categories: [],
  statuses: [],
  channelTypes: [],
  keyword: ""
};


const RATE_COUNTRY_PRIORITY = ["印度", "巴基斯坦", "印尼", "越南", "菲律宾", "马来", "缅甸", "哥伦比亚", "墨西哥", "智利", "尼日利亚", "胖虎巴西", "巴西", "南美", "USDT通道", "USDT"];

// V7Q：费率页面显示顺序严格跟 Google「各国三方费率」工作簿的页签顺序。
// 这里只控制前端展示，不修改三方量、不修改费率同步/匹配数据。
const RATE_SHEET_PRIORITY = [
  "USDT通道",
  "印度线下",
  "印度原生线上",
  "IFSC支持三方",
  "巴西盘口",
  "越南盘口",
  "菲律宾盘口",
  "印尼盘",
  "马来盘",
  "巴基斯坦盘口",
  "南美盘口",
  "缅甸盘",
  "尼日利亚盘口",
  "埃及-已关盘"
];

function isHiddenRateCountry(country: string): boolean {
  return String(country || "").includes("埃及");
}

function rateCountryRank(country: string): number {
  const text = String(country || "");
  const normalized = text.replace(/原生|盘口|线下|地区/g, "").trim();
  const index = RATE_COUNTRY_PRIORITY.findIndex((item) => normalized === item || text.includes(item));
  return index >= 0 ? index : RATE_COUNTRY_PRIORITY.length + 1;
}

function compareRateCountry(a: string, b: string): number {
  return rateCountryRank(a) - rateCountryRank(b) || String(a || "").localeCompare(String(b || ""), "zh-CN", { numeric: true });
}

function sortRateCountries(values: string[]): string[] {
  return uniq(values.filter((item) => !isHiddenRateCountry(item))).sort(compareRateCountry);
}

function rateSheetRank(sheetName: string): number {
  const text = String(sheetName || "").trim();
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  if (!normalized) return RATE_SHEET_PRIORITY.length + 1;
  const index = RATE_SHEET_PRIORITY.findIndex((item) => {
    const target = item.replace(/\s+/g, "").toLowerCase();
    return normalized === target || normalized.includes(target) || target.includes(normalized);
  });
  return index >= 0 ? index : RATE_SHEET_PRIORITY.length + 1;
}

function compareRateSheets(a: string, b: string): number {
  return rateSheetRank(a) - rateSheetRank(b) || String(a || "").localeCompare(String(b || ""), "zh-CN", { numeric: true });
}

function sortRateSheets(values: string[]): string[] {
  return uniq(values.filter((item) => !isHiddenRateCountry(item))).sort(compareRateSheets);
}

// V7R：费率展示顺序只认 Google 表里的原始行顺序。
// 某些旧同步记录 source_row 可能为空/0，但 id 里仍保留 v166/direct 的真实行号；
// 这里从 id 兜底恢复行号，避免页面退回按三方名称字母排序。
// 只影响「三方费率」前端展示，不修改三方量、费率同步或费率匹配。
function effectiveRateSourceRow(row: Pick<ThirdPartyRateRow, "id" | "sourceRow">): number {
  const id = String(row.id || "");

  // id 是同步时按 Google 实际行生成的，优先级高于旧数据里可能被写成固定值的 source_row。
  const v166 = id.match(/-v166-(\d+)-/i);
  if (v166) return Number(v166[1]) + 1; // v166 id 保存的是 0-based r

  const directId = id.match(/-direct-(\d+)-/i);
  if (directId) return Number(directId[1]); // direct id 保存的是 1-based sourceRow

  const direct = Number(row.sourceRow || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;

  return Number.MAX_SAFE_INTEGER;
}

function compareRateSourceOrder(a: ThirdPartyRateRow, b: ThirdPartyRateRow): number {
  return compareRateSheets(a.sheetName, b.sheetName)
    || effectiveRateSourceRow(a) - effectiveRateSourceRow(b)
    || String(a.thirdParty || "").localeCompare(String(b.thirdParty || ""), "zh-CN", { numeric: true, sensitivity: "base" });
}

function compareStatusSourceOrder(a: ThirdPartyPlatformStatusRow, b: ThirdPartyPlatformStatusRow): number {
  return compareRateSheets(a.sheetName, b.sheetName)
    || Number(a.sourceRow || 0) - Number(b.sourceRow || 0)
    || Number(a.sourceColumn || 0) - Number(b.sourceColumn || 0)
    || String(a.platform || "").localeCompare(String(b.platform || ""), "zh-CN", { numeric: true, sensitivity: "base" });
}

function removeHiddenRateData(payload: ThirdPartyRatePayload): ThirdPartyRatePayload {
  return {
    ...payload,
    meta: { ...payload.meta, sheets: payload.meta.sheets.filter((item) => !isHiddenRateCountry(item)) },
    rates: payload.rates.filter((row) => !isHiddenRateCountry(row.country) && !isHiddenRateCountry(row.sheetName)),
    platformStatuses: payload.platformStatuses.filter((row) => !isHiddenRateCountry(row.country) && !isHiddenRateCountry(row.sheetName)),
    anomalies: payload.anomalies.filter((text) => !String(text || "").includes("埃及"))
  };
}

const STATUS_LABELS = ["开启", "正常", "暂停", "备用", "停用", "未接入", "维护", "不支持", "对接中", "未知"];
const CHANNEL_TYPE_LABELS = ["代收", "代付", "代收+代付", "缺少代收", "缺少代付"];
const GOOD_STATUSES = new Set(["开启", "正常"]);
const BAD_STATUSES = new Set(["暂停", "停用", "未接入", "维护", "不支持"]);

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

function matchesSelection(value: string, selected: string[]): boolean {
  if (!selected.length) return true;
  return selected.includes(value);
}

function compactText(...values: string[]): string {
  return values.join(" ").toLowerCase();
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

function sortRows<T>(rows: T[], sort: SortState, getValue: (row: T, key: string) => string | number): T[] {
  const list = [...rows];
  list.sort((a, b) => {
    const av = getValue(a, sort.key);
    const bv = getValue(b, sort.key);
    let result = 0;
    if (sort.key === "country") result = compareRateCountry(String(av ?? ""), String(bv ?? ""));
    else if (typeof av === "number" && typeof bv === "number") result = av - bv;
    else result = String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN", { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
  return list;
}

function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function getStatusClass(status: string): string {
  if (GOOD_STATUSES.has(status)) return "ok";
  if (status === "备用") return "backup";
  if (BAD_STATUSES.has(status)) return "bad";
  if (status === "对接中") return "progress";
  return "neutral";
}

function rateNumber(value: string): number {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!text || text === "-" || text === "—" || text === "无") return 0;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : 0;
}

function isHighFeeRate(row: { collectFee: string; payoutFee: string; totalFee: string; collectSingleFee?: string; payoutSingleFee?: string }): boolean {
  const values = [row.collectFee, row.payoutFee, row.totalFee, row.collectSingleFee || "", row.payoutSingleFee || ""]
    .map(rateNumber)
    .filter((value) => value > 0);
  return values.some((value) => value >= 2);
}

function highFeeValue(row: { collectFee: string; payoutFee: string; totalFee: string; collectSingleFee?: string; payoutSingleFee?: string }): number {
  return Math.max(0, ...[row.collectFee, row.payoutFee, row.totalFee, row.collectSingleFee || "", row.payoutSingleFee || ""].map(rateNumber));
}


function hasFeeText(value: string): boolean {
  const text = String(value || "").trim();
  return !!text && text !== "-" && !/^#/.test(text);
}

function matchesChannelTypes(row: { collectFee: string; payoutFee: string; collectSingleFee?: string; payoutSingleFee?: string }, selected: string[]): boolean {
  if (!selected.length) return true;
  const hasCollect = hasFeeText(row.collectFee) || hasFeeText(row.collectSingleFee || "");
  const hasPayout = hasFeeText(row.payoutFee) || hasFeeText(row.payoutSingleFee || "");
  return selected.some((item) => {
    if (item === "代收") return hasCollect;
    if (item === "代付") return hasPayout;
    if (item === "代收+代付") return hasCollect && hasPayout;
    if (item === "缺少代收") return !hasCollect;
    if (item === "缺少代付") return !hasPayout;
    return true;
  });
}

function splitLimitValue(value: string): { min: string; max: string } {
  const text = String(value || "").trim();
  if (!text || text === "-") return { min: "-", max: "-" };
  const cleaned = text.replace(/^(限制|限额|唤醒限制|原生限制)\s*/i, "").trim();
  const match = cleaned.match(/(.+?)[\-–~至]+(.+)/);
  if (match) return { min: match[1].trim() || "-", max: match[2].trim() || "-" };
  return { min: cleaned, max: "-" };
}

function statusValue(row: ThirdPartyPlatformStatusRow, key: string): string | number {
  switch (key) {
    case "country": return row.country;
    case "sheetName": return row.sheetName;
    case "platform": return row.platform;
    case "thirdParty": return row.thirdParty;
    case "status": return row.status;
    case "collectFee": return rateNumber(row.collectFee);
    case "payoutFee": return rateNumber(row.payoutFee);
    case "collectSingleFee": return rateNumber(row.collectSingleFee);
    case "payoutSingleFee": return rateNumber(row.payoutSingleFee);
    case "sourceRow": return row.sourceRow;
    default: return "";
  }
}

function rateValue(row: ThirdPartyRateRow, key: string): string | number {
  switch (key) {
    case "country": return row.country;
    case "sheetName": return row.sheetName;
    case "category": return row.category;
    case "thirdParty": return row.thirdParty;
    case "collectFee": return rateNumber(row.collectFee);
    case "payoutFee": return rateNumber(row.payoutFee);
    case "collectSingleFee": return rateNumber(row.collectSingleFee);
    case "payoutSingleFee": return rateNumber(row.payoutSingleFee);
    case "collectLimit": return row.collectLimit;
    case "payoutLimit": return row.payoutLimit;
    case "totalFee": return rateNumber(row.totalFee);
    case "status": return row.status;
    case "sourceRow": return row.sourceRow;
    default: return "";
  }
}

function summarizePlatformHealth(rows: ThirdPartyPlatformStatusRow[]) {
  const map = new Map<string, { country: string; platform: string; total: number; open: number; paused: number; bad: number; backup: number }>();
  for (const row of rows) {
    const key = `${row.country}|||${row.platform}`;
    const item = map.get(key) || { country: row.country, platform: row.platform, total: 0, open: 0, paused: 0, bad: 0, backup: 0 };
    item.total += 1;
    if (GOOD_STATUSES.has(row.status)) item.open += 1;
    if (row.status === "暂停") item.paused += 1;
    if (BAD_STATUSES.has(row.status)) item.bad += 1;
    if (row.status === "备用") item.backup += 1;
    map.set(key, item);
  }
  return Array.from(map.values())
    // USDT 通道本来渠道少，不参与“可用少”排行；只有一个开启/正常都没有才显示。
    .filter((item) => !/USDT|U通道|USDT通道/i.test(item.country) || item.open <= 0)
    .sort((a, b) => a.open - b.open || b.bad - a.bad || a.platform.localeCompare(b.platform, "zh-CN"));
}

function summarizeThirdPartyUsage(rows: ThirdPartyPlatformStatusRow[]) {
  const map = new Map<string, { thirdParty: string; total: number; open: number; bad: number; countries: Set<string> }>();
  for (const row of rows) {
    const item = map.get(row.thirdParty) || { thirdParty: row.thirdParty, total: 0, open: 0, bad: 0, countries: new Set<string>() };
    item.total += 1;
    if (GOOD_STATUSES.has(row.status)) item.open += 1;
    if (BAD_STATUSES.has(row.status)) item.bad += 1;
    if (row.country) item.countries.add(row.country);
    map.set(row.thirdParty, item);
  }
  return Array.from(map.values()).sort((a, b) => b.open - a.open || b.total - a.total).slice(0, 12);
}



function cleanSummaryText(values: string[]): string {
  return uniq(values.map((v) => String(v || "").trim()).filter((v) => v && v !== "-")).slice(0, 6).join(" / ") || "-";
}

function preferDirectRateRows(rows: ThirdPartyRateRow[]): ThirdPartyRateRow[] {
  const map = new Map<string, ThirdPartyRateRow[]>();
  for (const row of rows) {
    const key = [row.country, row.sheetName, canonicalThirdPartyName(row.thirdParty, row.country) || row.thirdParty, row.category || ""].join("|||");
    map.set(key, [...(map.get(key) || []), row]);
  }
  return Array.from(map.values()).flatMap((items) => {
    const direct = items.filter((row) => /Google费率表直读/.test(row.channelInfo || ""));
    return direct.length ? direct : items;
  });
}

function normalizeRatePartyName(name: string, country?: string, row?: Partial<ThirdPartyRateRow | ThirdPartyPlatformStatusRow>): string {
  const canonical = canonicalThirdPartyName(name, country) || name;
  const text = `${name || ""} ${canonical || ""} ${row?.category || ""} ${row?.sheetName || ""} ${"totalFee" in (row || {}) ? (row as ThirdPartyRateRow).totalFee || "" : ""} ${row?.collectFee || ""} ${row?.payoutFee || ""} ${row?.collectSingleFee || ""} ${row?.payoutSingleFee || ""}`.toLowerCase();
  if (/usdt|trx|trc20|u通道|u通道/.test(text)) {
    if (/unipay|uni\s*pay/.test(text)) return "UniPayUSDT";
    if (/tronpay|tron\s*pay/.test(text)) return "TronPayUSDT";
    if (/uupay|uu\s*pay/.test(text)) return "UUPayUSDT";
    if (/upay13|upay\s*13/.test(text)) return "UPay13USDT";
    if (/aypay/.test(text)) return "AYPayUSDT";
  }
  return canonical;
}

function rateRowKey(row: ThirdPartyRateRow): string {
  return [
    row.country,
    row.sheetName,
    normalizeRatePartyName(row.thirdParty, row.country, row),
    row.category || "",
    row.totalFee || "",
    row.collectFee || "",
    row.payoutFee || "",
    row.collectSingleFee || "",
    row.payoutSingleFee || "",
    row.collectLimit || "",
    row.payoutLimit || "",
    row.status || ""
  ].map((v) => String(v).trim()).join("|||");
}

function dedupeRateRows(rows: ThirdPartyRateRow[]): ThirdPartyRateRow[] {
  const map = new Map<string, ThirdPartyRateRow>();
  for (const row of rows) {
    const key = rateRowKey(row);
    if (!map.has(key)) map.set(key, { ...row, thirdParty: normalizeRatePartyName(row.thirdParty, row.country, row) });
  }
  return Array.from(map.values());
}

function statusRowKey(row: ThirdPartyPlatformStatusRow): string {
  return [
    row.country,
    row.sheetName,
    row.platform,
    normalizeRatePartyName(row.thirdParty, row.country, row),
    row.category || "",
    row.status || "",
    row.collectFee || "",
    row.payoutFee || "",
    row.collectSingleFee || "",
    row.payoutSingleFee || "",
    row.collectLimit || "",
    row.payoutLimit || ""
  ].map((v) => String(v).trim()).join("|||");
}

function dedupeStatusRows(rows: ThirdPartyPlatformStatusRow[]): ThirdPartyPlatformStatusRow[] {
  const map = new Map<string, ThirdPartyPlatformStatusRow>();
  for (const row of rows) {
    const key = statusRowKey(row);
    if (!map.has(key)) map.set(key, { ...row, thirdParty: normalizeRatePartyName(row.thirdParty, row.country, row) });
  }
  return Array.from(map.values());
}

function summarizeThirdPartyRunning(statusRows: ThirdPartyPlatformStatusRow[], rateRows: ThirdPartyRateRow[]): ThirdPartyRunningRow[] {
  const allPlatformsByCountry = new Map<string, Set<string>>();
  for (const row of statusRows) {
    if (!row.country || !row.platform) continue;
    const set = allPlatformsByCountry.get(row.country) || new Set<string>();
    set.add(row.platform);
    allPlatformsByCountry.set(row.country, set);
  }

  const feeMap = new Map<string, { collect: string[]; payout: string[]; total: string[] }>();
  for (const row of preferDirectRateRows(rateRows)) {
    const current = feeMap.get(row.thirdParty) || { collect: [], payout: [], total: [] };
    if (row.collectFee) current.collect.push(row.collectFee);
    if (row.payoutFee) current.payout.push(row.payoutFee);
    if (row.totalFee) current.total.push(row.totalFee);
    feeMap.set(row.thirdParty, current);
  }

  const map = new Map<string, {
    thirdParty: string;
    countries: Set<string>;
    sheets: Set<string>;
    platforms: Set<string>;
    connectedByCountry: Map<string, Set<string>>;
    total: number;
    open: number;
    backup: number;
    bad: number;
    statusCounts: Map<string, number>;
  }>();

  for (const row of statusRows) {
    const current = map.get(row.thirdParty) || {
      thirdParty: row.thirdParty,
      countries: new Set<string>(),
      sheets: new Set<string>(),
      platforms: new Set<string>(),
      connectedByCountry: new Map<string, Set<string>>(),
      total: 0,
      open: 0,
      backup: 0,
      bad: 0,
      statusCounts: new Map<string, number>()
    };

    current.total += 1;
    if (GOOD_STATUSES.has(row.status)) current.open += 1;
    if (row.status === "备用") current.backup += 1;
    if (BAD_STATUSES.has(row.status)) current.bad += 1;
    if (row.country) current.countries.add(row.country);
    if (row.sheetName) current.sheets.add(row.sheetName);
    if (row.platform) current.platforms.add(row.platform);

    // 已接盘口：开启/正常/备用/对接中都算有接入；未接入/不支持/停用不算。
    if (row.country && row.platform && !["未接入", "不支持", "停用"].includes(row.status)) {
      const set = current.connectedByCountry.get(row.country) || new Set<string>();
      set.add(row.platform);
      current.connectedByCountry.set(row.country, set);
    }

    current.statusCounts.set(row.status || "未知", (current.statusCounts.get(row.status || "未知") || 0) + 1);
    map.set(row.thirdParty, current);
  }

  return Array.from(map.values())
    .map((item) => {
      const missingNames: string[] = [];
      for (const country of Array.from(item.countries)) {
        const allPlatforms = allPlatformsByCountry.get(country) || new Set<string>();
        const connected = item.connectedByCountry.get(country) || new Set<string>();
        for (const platform of Array.from(allPlatforms)) {
          if (!connected.has(platform)) missingNames.push(`${country} ${platform}`);
        }
      }

      const fees = feeMap.get(item.thirdParty) || { collect: [], payout: [], total: [] };
      return {
        thirdParty: item.thirdParty,
        country: Array.from(item.countries)[0] || "",
        countries: Array.from(item.countries).join("、"),
        sheets: Array.from(item.sheets).join("、"),
        platforms: Array.from(item.platforms).join("、"),
        missingPlatforms: missingNames.join("、"),
        total: item.total,
        open: item.open,
        backup: item.backup,
        bad: item.bad,
        missing: missingNames.length,
        openRate: item.total ? item.open / item.total : 0,
        statusSummary: Array.from(item.statusCounts.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join("、"),
        collectFeeSummary: cleanSummaryText(fees.collect),
        payoutFeeSummary: cleanSummaryText(fees.payout),
        totalFeeSummary: cleanSummaryText(fees.total)
      };
    })
    .sort((a, b) => b.open - a.open || b.total - a.total || a.thirdParty.localeCompare(b.thirdParty, "zh-CN"));
}

function summarizeCountryThirdParties(rows: ThirdPartyPlatformStatusRow[], rateRows: ThirdPartyRateRow[]): CountryThirdPartyRow[] {
  const map = new Map<string, {
    country: string;
    platforms: Set<string>;
    thirdParties: Set<string>;
    openThirdParties: Set<string>;
    backupThirdParties: Set<string>;
    badThirdParties: Set<string>;
    statusCounts: Map<string, number>;
    typeCounts: Map<string, number>;
    typeParties: Map<string, Set<string>>;
  }>();

  for (const row of rows) {
    const current = map.get(row.country) || {
      country: row.country,
      platforms: new Set<string>(),
      thirdParties: new Set<string>(),
      openThirdParties: new Set<string>(),
      backupThirdParties: new Set<string>(),
      badThirdParties: new Set<string>(),
      statusCounts: new Map<string, number>(),
      typeCounts: new Map<string, number>(),
      typeParties: new Map<string, Set<string>>()
    };
    if (row.platform) current.platforms.add(row.platform);
    if (row.thirdParty) current.thirdParties.add(row.thirdParty);
    if (GOOD_STATUSES.has(row.status)) current.openThirdParties.add(row.thirdParty);
    if (row.status === "备用") current.backupThirdParties.add(row.thirdParty);
    if (BAD_STATUSES.has(row.status)) current.badThirdParties.add(row.thirdParty);
    current.statusCounts.set(row.status || "未知", (current.statusCounts.get(row.status || "未知") || 0) + 1);
    map.set(row.country, current);
  }

  for (const row of rateRows) {
    if (!row.country) continue;
    const current = map.get(row.country) || {
      country: row.country,
      platforms: new Set<string>(),
      thirdParties: new Set<string>(),
      openThirdParties: new Set<string>(),
      backupThirdParties: new Set<string>(),
      badThirdParties: new Set<string>(),
      statusCounts: new Map<string, number>(),
      typeCounts: new Map<string, number>(),
      typeParties: new Map<string, Set<string>>()
    };
    if (row.thirdParty) current.thirdParties.add(row.thirdParty);
    const type = row.category || row.sheetName || "未分类";
    current.typeCounts.set(type, (current.typeCounts.get(type) || 0) + 1);
    if (row.thirdParty) {
      const set = current.typeParties.get(type) || new Set<string>();
      set.add(row.thirdParty);
      current.typeParties.set(type, set);
    }
    map.set(row.country, current);
  }

  return Array.from(map.values()).map((item) => ({
    country: item.country,
    totalThirdParties: item.thirdParties.size,
    openThirdParties: item.openThirdParties.size,
    backupThirdParties: item.backupThirdParties.size,
    badThirdParties: item.badThirdParties.size,
    platforms: item.platforms.size,
    thirdParties: Array.from(item.thirdParties).join("、"),
    typeSummary: Array.from(item.typeCounts.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join("、") || "-",
    typeDetail: Array.from(item.typeParties.entries())
      .sort((a, b) => b[1].size - a[1].size)
      .map(([type, parties]) => `${type}（${parties.size}）：${Array.from(parties).join("、")}`)
      .join("\n\n") || "-",
    statusSummary: Array.from(item.statusCounts.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join("、")
  })).sort((a, b) => compareRateCountry(a.country, b.country) || b.totalThirdParties - a.totalThirdParties);
}

function summarizeCountryRateDashboard(statusRows: ThirdPartyPlatformStatusRow[], rateRows: ThirdPartyRateRow[]): CountryRateSummaryRow[] {
  const map = new Map<string, {
    country: string;
    platforms: Set<string>;
    thirdParties: Set<string>;
    statusRows: number;
    open: number;
    bad: number;
    backup: number;
    highFeeParties: Set<string>;
  }>();

  for (const row of statusRows) {
    const country = row.country || "未知国家";
    const item = map.get(country) || {
      country,
      platforms: new Set<string>(),
      thirdParties: new Set<string>(),
      statusRows: 0,
      open: 0,
      bad: 0,
      backup: 0,
      highFeeParties: new Set<string>()
    };
    item.statusRows += 1;
    if (row.platform) item.platforms.add(row.platform);
    if (row.thirdParty) item.thirdParties.add(row.thirdParty);
    if (GOOD_STATUSES.has(row.status)) item.open += 1;
    if (BAD_STATUSES.has(row.status)) item.bad += 1;
    if (row.status === "备用") item.backup += 1;
    map.set(country, item);
  }

  for (const row of rateRows) {
    const country = row.country || "未知国家";
    const item = map.get(country) || {
      country,
      platforms: new Set<string>(),
      thirdParties: new Set<string>(),
      statusRows: 0,
      open: 0,
      bad: 0,
      backup: 0,
      highFeeParties: new Set<string>()
    };
    if (row.thirdParty) item.thirdParties.add(row.thirdParty);
    if (isHighFeeRate(row)) item.highFeeParties.add(row.thirdParty);
    map.set(country, item);
  }

  return Array.from(map.values())
    .map((item) => ({
      country: item.country,
      platforms: item.platforms.size,
      thirdParties: item.thirdParties.size,
      statusRows: item.statusRows,
      open: item.open,
      bad: item.bad,
      backup: item.backup,
      openRate: item.statusRows ? item.open / item.statusRows : 0,
      highFee: item.highFeeParties.size,
      highFeeParties: Array.from(item.highFeeParties).join("、")
    }))
    .sort((a, b) => compareRateCountry(a.country, b.country) || b.highFee - a.highFee || b.bad - a.bad || b.thirdParties - a.thirdParties);
}

function cleanForCompare(value: string): string {
  const text = String(value || "").trim();
  if (!text || text === "-" || text === "—" || text === "无") return "";
  return text;
}

function buildFeeConsistencyAnomalies(rateRows: ThirdPartyRateRow[]): string[] {
  const map = new Map<string, {
    country: string;
    thirdParty: string;
    collect: Set<string>;
    payout: Set<string>;
    total: Set<string>;
    collectSingle: Set<string>;
    payoutSingle: Set<string>;
  }>();
  for (const row of rateRows) {
    const key = `${row.country}|||${row.thirdParty}`;
    const item = map.get(key) || {
      country: row.country,
      thirdParty: row.thirdParty,
      collect: new Set<string>(),
      payout: new Set<string>(),
      total: new Set<string>(),
      collectSingle: new Set<string>(),
      payoutSingle: new Set<string>()
    };
    const collect = cleanForCompare(row.collectFee);
    const payout = cleanForCompare(row.payoutFee);
    const total = cleanForCompare(row.totalFee);
    const collectSingle = cleanForCompare(row.collectSingleFee);
    const payoutSingle = cleanForCompare(row.payoutSingleFee);
    if (collect) item.collect.add(collect);
    if (payout) item.payout.add(payout);
    if (total) item.total.add(total);
    if (collectSingle) item.collectSingle.add(collectSingle);
    if (payoutSingle) item.payoutSingle.add(payoutSingle);
    map.set(key, item);
  }

  const messages: string[] = [];
  for (const item of Array.from(map.values())) {
    const parts: string[] = [];
    if (item.collect.size > 1) parts.push(`代收手续费 ${Array.from(item.collect).join(" / ")}`);
    if (item.payout.size > 1) parts.push(`代付手续费 ${Array.from(item.payout).join(" / ")}`);
    if (item.total.size > 1) parts.push(`合计费率 ${Array.from(item.total).join(" / ")}`);
    if (item.collectSingle.size > 1) parts.push(`代收单笔 ${Array.from(item.collectSingle).join(" / ")}`);
    if (item.payoutSingle.size > 1) parts.push(`代付单笔 ${Array.from(item.payoutSingle).join(" / ")}`);
    if (parts.length) messages.push(`[费率不一致] ${item.country} ${item.thirdParty}：${parts.join("；")}`);
  }
  return messages;
}

function runningValue(row: ThirdPartyRunningRow, key: string): string | number {
  switch (key) {
    case "thirdParty": return row.thirdParty;
    case "countries": return row.countries;
    case "platforms": return row.platforms;
    case "total": return row.total;
    case "open": return row.open;
    case "bad": return row.bad;
    case "missing": return row.missing;
    case "backup": return row.backup;
    case "openRate": return row.openRate;
    default: return "";
  }
}

function countryPaneLabel(country: string): string {
  if (country.includes("哥伦比亚")) return "NPG哥伦比亚盘口";
  if (country.includes("墨西哥")) return "NPG墨西哥盘口";
  if (country.includes("智利")) return "NPG智利盘口";
  if (country.includes("盘口")) return country;
  if (country.includes("印度")) return `${country}线下盘口`;
  return `${country}盘口`;
}

function filterLabel(values: string[], all = "全部"): string {
  if (!values.length) return all;
  if (values.length <= 2) return values.join("、");
  return `${values.slice(0, 2).join("、")} 等 ${values.length} 项`;
}

export default function ThirdPartyRatesDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  const { session } = useDashboardAuth();
  const [state, setState] = useState<LoadState>("ready");
  const [payload, setPayload] = useState<ThirdPartyRatePayload | null>(null);
  const [hasQueried, setHasQueried] = useState(false);
  const [error, setError] = useState("");
  const [mainView, setMainView] = useState<RateMainView>("countryRates");
  const [view, setView] = useState<RateView>("anomalies");
  const [countryRatePage, setCountryRatePage] = useState("");
  const [filters, setFilters] = useState<RateFilters>(EMPTY_RATE_FILTERS);
  const [draftFilters, setDraftFilters] = useState<RateFilters>(EMPTY_RATE_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusSort, setStatusSort] = useState<SortState>({ key: "sourceOrder", direction: "asc" });
  const [rateSort, setRateSort] = useState<SortState>({ key: "sourceOrder", direction: "asc" });
  const [runningSort, setRunningSort] = useState<SortState>({ key: "open", direction: "desc" });
  const [anomalyModal, setAnomalyModal] = useState<RateAnomalyDetail | null>(null);
  const autoLoadTokenRef = useRef("");

  async function loadData() {
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/supabase-third-party-rates", { cache: "no-store", headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "读取三方费率失败");
      setPayload(removeHiddenRateData(json));
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取三方费率失败");
      setState("error");
    }
  }

  useEffect(() => {
    // V7Q：打开三方费率页面就自动读取，效果跟打开 Google 表一样；查询按钮只负责后续筛选/刷新。
    const token = String(session?.access_token || "");
    if (!token || autoLoadTokenRef.current === token) return;
    autoLoadTokenRef.current = token;
    setHasQueried(true);
    void loadData();
    // access token 刷新后允许自动取一次最新数据，但不会改变当前筛选条件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const countries = useMemo(() => payload ? sortRateCountries([...payload.platformStatuses.map((r) => r.country), ...payload.rates.map((r) => r.country)]) : [], [payload]);
  const sheets = useMemo(() => payload ? sortRateSheets(payload.meta.sheets) : [], [payload]);
  const platformOptions = useMemo(() => {
    if (!payload) return [];
    return uniq(payload.platformStatuses
      .filter((r) => matchesSelection(r.country, draftFilters.countries))
      .filter((r) => matchesSelection(r.sheetName, draftFilters.sheets))
      .map((r) => r.platform)).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [payload, draftFilters.countries, draftFilters.sheets]);
  const thirdPartyOptions = useMemo(() => {
    if (!payload) return [];
    return uniq([
      ...payload.platformStatuses
        .filter((r) => matchesSelection(r.country, draftFilters.countries))
        .filter((r) => matchesSelection(r.platform, draftFilters.platforms))
        .map((r) => r.thirdParty),
      ...payload.rates
        .filter((r) => matchesSelection(r.country, draftFilters.countries))
        .map((r) => r.thirdParty)
    ]).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [payload, draftFilters.countries, draftFilters.platforms]);

  const categoryOptions = useMemo(() => {
    if (!payload) return [];
    return uniq([
      ...payload.rates
        .filter((r) => matchesSelection(r.country, draftFilters.countries))
        .filter((r) => matchesSelection(r.sheetName, draftFilters.sheets))
        .map((r) => r.category),
      ...payload.platformStatuses
        .filter((r) => matchesSelection(r.country, draftFilters.countries))
        .filter((r) => matchesSelection(r.sheetName, draftFilters.sheets))
        .map((r) => r.category)
    ]).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [payload, draftFilters.countries, draftFilters.sheets]);

  const filteredStatusRows = useMemo(() => {
    if (!payload) return [];
    const keyword = filters.keyword.trim().toLowerCase();
    const matched = payload.platformStatuses.filter((row) => {
      const canonical = normalizeRatePartyName(row.thirdParty, row.country, row);
      if (!matchesSelection(row.country, filters.countries)) return false;
      if (!matchesSelection(row.sheetName, filters.sheets)) return false;
      if (!matchesSelection(row.platform, filters.platforms)) return false;
      if (!matchesSelection(row.thirdParty, filters.thirdParties) && !matchesSelection(canonical, filters.thirdParties)) return false;
      if (!matchesSelection(row.category || "", filters.categories)) return false;
      if (!matchesSelection(row.status, filters.statuses)) return false;
      if (!matchesChannelTypes(row, filters.channelTypes)) return false;
      if (filters.keyword && !compactText(row.country, row.sheetName, row.platform, row.thirdParty, canonical, row.status, row.collectFee, row.payoutFee, row.collectSingleFee, row.payoutSingleFee, row.category).includes(keyword)) return false;
      return true;
    });
    return dedupeStatusRows(matched).sort(compareStatusSourceOrder);
  }, [payload, filters, draftFilters.keyword]);

  const filteredRateRows = useMemo(() => {
    if (!payload) return [];
    const keyword = filters.keyword.trim().toLowerCase();
    const matched = payload.rates.filter((row) => {
      const canonical = normalizeRatePartyName(row.thirdParty, row.country, row);
      if (!matchesSelection(row.country, filters.countries)) return false;
      if (!matchesSelection(row.sheetName, filters.sheets)) return false;
      if (!matchesSelection(row.thirdParty, filters.thirdParties) && !matchesSelection(canonical, filters.thirdParties)) return false;
      if (!matchesSelection(row.category || "", filters.categories)) return false;
      if (!matchesSelection(row.status, filters.statuses)) return false;
      if (!matchesChannelTypes(row, filters.channelTypes)) return false;
      if (filters.keyword && !compactText(row.country, row.sheetName, row.category, row.thirdParty, canonical, row.status, row.collectFee, row.payoutFee, row.totalFee, row.collectSingleFee, row.payoutSingleFee, row.collectLimit, row.payoutLimit).includes(keyword)) return false;
      return true;
    });
    return dedupeRateRows(matched).sort(compareRateSourceOrder);
  }, [payload, filters, draftFilters.keyword]);

  const sortedStatusRows = useMemo(
    () => statusSort.key === "sourceOrder" ? [...filteredStatusRows].sort(compareStatusSourceOrder) : sortRows(filteredStatusRows, statusSort, statusValue),
    [filteredStatusRows, statusSort]
  );
  const sortedRateRows = useMemo(
    () => rateSort.key === "sourceOrder" ? [...filteredRateRows].sort(compareRateSourceOrder) : sortRows(filteredRateRows, rateSort, rateValue),
    [filteredRateRows, rateSort]
  );
  const runningRows = useMemo(() => summarizeThirdPartyRunning(filteredStatusRows, filteredRateRows), [filteredStatusRows, filteredRateRows]);
  const sortedRunningRows = useMemo(() => sortRows(runningRows, runningSort, runningValue), [runningRows, runningSort]);
  const countryThirdPartyRows = useMemo(() => summarizeCountryThirdParties(filteredStatusRows, filteredRateRows), [filteredStatusRows, filteredRateRows]);
  const statusCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of filteredStatusRows) map.set(row.status || "未知", (map.get(row.status || "未知") || 0) + 1);
    return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [filteredStatusRows]);
  const platformHealth = useMemo(() => summarizePlatformHealth(filteredStatusRows), [filteredStatusRows]);
  const thirdPartyUsage = useMemo(() => summarizeThirdPartyUsage(filteredStatusRows), [filteredStatusRows]);
  const feeConsistencyAnomalies = useMemo(() => buildFeeConsistencyAnomalies(filteredRateRows), [filteredRateRows]);
  const countryRateSummaryRows = useMemo(() => summarizeCountryRateDashboard(filteredStatusRows, filteredRateRows), [filteredStatusRows, filteredRateRows]);
  const highFeeRateRows = useMemo(() => [...filteredRateRows].filter(isHighFeeRate).sort((a, b) => highFeeValue(b) - highFeeValue(a) || a.country.localeCompare(b.country, "zh-CN") || a.thirdParty.localeCompare(b.thirdParty, "zh-CN")), [filteredRateRows]);
  const countryRateOptions = useMemo(() => sortRateCountries([...filteredStatusRows.map((r) => r.country), ...filteredRateRows.map((r) => r.country)]), [filteredStatusRows, filteredRateRows]);
  const activeCountryRate = countryRatePage && countryRateOptions.includes(countryRatePage) ? countryRatePage : (countryRateOptions[0] || "");
  const activeCountryStatusRows = useMemo(() => filteredStatusRows.filter((row) => activeCountryRate && row.country === activeCountryRate), [filteredStatusRows, activeCountryRate]);
  const activeCountryRateRows = useMemo(() => filteredRateRows.filter((row) => activeCountryRate && row.country === activeCountryRate), [filteredRateRows, activeCountryRate]);
  const filteredAnomalies = useMemo(() => {
    if (!payload) return feeConsistencyAnomalies;
    const selected = new Set(filteredStatusRows.map((r) => `${r.country} ${r.platform}`));
    const countryWords = filters.countries;
    const keyword = filters.keyword.toLowerCase();
    const base = payload.anomalies.filter((text) => {
      if (countryWords.length && !countryWords.some((country) => text.includes(country))) return false;
      if (keyword && !text.toLowerCase().includes(keyword)) return false;
      if (!filters.platforms.length) return true;
      return filters.platforms.some((platform) => text.includes(platform)) || Array.from(selected).some((key) => text.includes(key));
    });
    const feeItems = feeConsistencyAnomalies.filter((text) => {
      if (countryWords.length && !countryWords.some((country) => text.includes(country))) return false;
      if (keyword && !text.toLowerCase().includes(keyword)) return false;
      return true;
    });
    return Array.from(new Set([...base, ...feeItems]));
  }, [payload, filteredStatusRows, filters, feeConsistencyAnomalies]);

  function updateDraft<K extends keyof RateFilters>(key: K, value: RateFilters[K]) {
    setDraftFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function applyFilters() {
    setHasQueried(true);
    setFilters({ ...draftFilters });
    setPage(1);
    await loadData();
  }

  function resetFilters() {
    setDraftFilters(EMPTY_RATE_FILTERS);
    setPage(1);
  }

  function toggleStatusSort(key: string) {
    setStatusSort((prev) => ({ key, direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc" }));
    setPage(1);
  }

  function toggleRateSort(key: string) {
    setRateSort((prev) => ({ key, direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc" }));
    setPage(1);
  }

  function toggleRunningSort(key: string) {
    setRunningSort((prev) => ({ key, direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc" }));
    setPage(1);
  }

  function handleExport() {
    const suffix = `${filterLabel(filters.countries)}-${view}`.replace(/\s+/g, "");
    if (view === "running") {
      exportCsv(`三方运行查询-${suffix}.csv`, sortedRunningRows, [
        { label: "三方名称", value: (r) => r.thirdParty },
        { label: "开启/正常", value: (r) => r.open },
        { label: "全部接入", value: (r) => r.total },
        { label: "可用率", value: (r) => formatPercent(r.openRate) },
        { label: "备用", value: (r) => r.backup },
        { label: "异常", value: (r) => r.bad },
        { label: "国家", value: (r) => r.countries },
        { label: "盘口", value: (r) => r.platforms },
        { label: "状态汇总", value: (r) => r.statusSummary },
        { label: "代收费率", value: (r) => r.collectFeeSummary },
        { label: "代付费率", value: (r) => r.payoutFeeSummary },
        { label: "合计费率", value: (r) => r.totalFeeSummary },
        { label: "未接盘口", value: (r) => r.missingPlatforms }
      ]);
      return;
    }
    if (view === "rates") {
      exportCsv(`三方费率表-${suffix}.csv`, sortedRateRows, [
        { label: "国家", value: (r) => r.country },
        { label: "页签", value: (r) => r.sheetName },
        { label: "类型", value: (r) => r.category },
        { label: "三方", value: (r) => r.thirdParty },
        { label: "合计费率", value: (r) => r.totalFee },
        { label: "代收手续费", value: (r) => r.collectFee },
        { label: "代付手续费", value: (r) => r.payoutFee },
        { label: "代收单笔", value: (r) => r.collectSingleFee },
        { label: "代付单笔", value: (r) => r.payoutSingleFee },
        { label: "代收限制", value: (r) => r.collectLimit },
        { label: "代付限制", value: (r) => r.payoutLimit },
        { label: "状态", value: (r) => r.status },
        { label: "通道情况", value: (r) => r.channelInfo }
      ]);
      return;
    }
    exportCsv(`盘口接入状态-${suffix}.csv`, sortedStatusRows, [
      { label: "国家", value: (r) => r.country },
      { label: "页签", value: (r) => r.sheetName },
      { label: "盘口", value: (r) => r.platform },
      { label: "三方", value: (r) => r.thirdParty },
      { label: "状态", value: (r) => r.status },
      { label: "代收手续费", value: (r) => r.collectFee },
      { label: "代付手续费", value: (r) => r.payoutFee },
      { label: "代收单笔", value: (r) => r.collectSingleFee },
      { label: "代付单笔", value: (r) => r.payoutSingleFee },
      { label: "合计费率", value: (r) => r.totalFee },
      { label: "代收限制", value: (r) => r.collectLimit },
      { label: "代付限制", value: (r) => r.payoutLimit }
    ]);
  }

  function openAnomaly(message: string) {
    const cleanMessage = message.replace(/^\[[^\]]+\]\s*/, "");
    const prefix = cleanMessage.split(/[：:]/)[0]?.trim() || "";
    const parts = prefix.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const targetCountry = parts[0] || "";
    let targetName = parts.slice(1).join(" ");
    targetName = targetName.replace(/费率不一致|费率偏高|可用三方仅|暂停三方|未接入较多|当前状态为.*/g, "").trim();

    // 异常提醒的格式通常是：国家 + 盘口 或 国家 + 三方名称。
    // 这里必须精准匹配，避免点击“巴西 PLAYERBR”时把所有巴西资料都展示出来。
    let matchedStatusRows: ThirdPartyPlatformStatusRow[] = [];
    let matchedRateRows: ThirdPartyRateRow[] = [];

    if (targetCountry && targetName) {
      matchedStatusRows = filteredStatusRows.filter((row) => row.country === targetCountry && (row.platform === targetName || row.thirdParty === targetName || canonicalThirdPartyName(row.thirdParty, row.country) === canonicalThirdPartyName(targetName, row.country)));
      const thirdPartySet = new Set(matchedStatusRows.map((row) => row.thirdParty));
      matchedRateRows = filteredRateRows.filter((row) => row.country === targetCountry && (row.thirdParty === targetName || canonicalThirdPartyName(row.thirdParty, row.country) === canonicalThirdPartyName(targetName, row.country) || thirdPartySet.has(row.thirdParty) || thirdPartySet.has(canonicalThirdPartyName(row.thirdParty, row.country))));
    }

    if (!matchedStatusRows.length && !matchedRateRows.length) {
      const words = message
        .replace(/^\[[^\]]+\]\s*/, "")
        .replace(/[：:，。/()（）]/g, " ")
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 2 && word !== targetCountry);

      matchedStatusRows = filteredStatusRows.filter((row) => {
        const text = `${row.country} ${row.sheetName} ${row.platform} ${row.thirdParty} ${row.status} ${row.collectFee} ${row.payoutFee}`;
        return words.some((word) => text.includes(word));
      });

      matchedRateRows = filteredRateRows.filter((row) => {
        const text = `${row.country} ${row.sheetName} ${row.category} ${row.thirdParty} ${row.status} ${row.collectFee} ${row.payoutFee} ${row.totalFee}`;
        return words.some((word) => text.includes(word));
      });
    }

    setAnomalyModal({
      title: "三方费率异常详情",
      message,
      statusRows: matchedStatusRows.slice(0, 120),
      rateRows: matchedRateRows.slice(0, 120)
    });
  }


  function openRateAccess(row: ThirdPartyRateRow) {
    const target = normalizeRatePartyName(row.thirdParty, row.country, row);
    const sameCountryStatusRows = dedupeStatusRows(filteredStatusRows.filter((item) => {
      const name = normalizeRatePartyName(item.thirdParty, item.country, item);
      return item.country === row.country && name === target;
    }));
    const sameCountryRateRows = dedupeRateRows(filteredRateRows.filter((item) => {
      const name = normalizeRatePartyName(item.thirdParty, item.country, item);
      return item.country === row.country && name === target;
    }));
    setAnomalyModal({
      title: `${row.country} ${target} 详情`,
      message: sameCountryStatusRows.length
        ? `费率资料严格按 Google 费率表字段展示；下方再看各盘口接入状态。当前匹配 ${sameCountryStatusRows.length} 条盘口状态。`
        : `费率资料严格按 Google 费率表字段展示；当前没有匹配到盘口接入状态。`,
      statusRows: sameCountryStatusRows.slice(0, 300),
      rateRows: sameCountryRateRows.slice(0, 120)
    });
  }

  function openThirdPartyDetail(row: ThirdPartyRunningRow) {
    setAnomalyModal({
      title: `${row.thirdParty} 运行详情`,
      message: `开启/正常 ${row.open}/${row.total}，未接盘口 ${row.missing} 个，可用率 ${formatPercent(row.openRate)}。`,
      statusRows: filteredStatusRows.filter((item) => item.thirdParty === row.thirdParty || canonicalThirdPartyName(item.thirdParty, item.country) === canonicalThirdPartyName(row.thirdParty, row.country)).slice(0, 160),
      rateRows: filteredRateRows.filter((item) => item.thirdParty === row.thirdParty || canonicalThirdPartyName(item.thirdParty, item.country) === canonicalThirdPartyName(row.thirdParty, row.country)).slice(0, 160)
    });
  }


  const currentTotal = view === "dashboard" || view === "rates" ? sortedRateRows.length : view === "running" ? sortedRunningRows.length : view === "country" ? countryThirdPartyRows.length : sortedStatusRows.length;
  const totalPages = pageCount(currentTotal, pageSize);

  return (
    <div className={`third-party-module ${!hasQueried || !payload ? "business-prequery" : ""}`}>
      {!embedded && <div className="topbar rate-topbar">
        <div className="title">
          <h1>三方费率</h1>
          <p>当前位置：Hensem数据后台 &gt; 三方费率 &gt; {view === "dashboard" ? "总览看板" : view === "running" ? "三方运行查询" : view === "country" ? "国家三方查询" : view === "platform" ? "盘口接入状态" : view === "rates" ? "三方费率表" : "异常提醒"}</p>
        </div>
        {hasQueried && payload && <div className="status-box">
          <div className="status-line"><span>数据来源</span><strong>Google Sheet</strong></div>
          <div className="status-line"><span>读取页签</span><strong>{payload.meta.sheets.length} 个</strong></div>
          <div className="status-line"><span>更新时间</span><strong>{new Date(String((payload.meta as any).snapshotUpdatedAt || payload.meta.updatedAt)).toLocaleString("zh-CN")}</strong></div>
        </div>}
      </div>}

      <section className="third-party-tab-panel rate-module-switch">
        <div className="tab-group-row main-tab-row">
          <button className={mainView === "countryRates" ? "module-tab active" : "module-tab"} onClick={() => { setMainView("countryRates"); setView("rates"); setPage(1); }}>各国家费率</button>
          <button className={mainView === "dashboard" && view === "anomalies" ? "module-tab active" : "module-tab"} onClick={() => { setMainView("dashboard"); setView("anomalies"); setPage(1); }}>异常提醒</button>
        </div>
        {mainView === "countryRates" && (
          <div className="tab-group-row child-tab-row country-tab-row">
            {countryRateOptions.map((item) => <button key={item} className={activeCountryRate === item ? "module-tab active" : "module-tab"} onClick={() => { setMainView("countryRates"); setView("rates"); setCountryRatePage(item); setPage(1); }}>{countryPaneLabel(item)}</button>)}
            {!countryRateOptions.length && <span className="muted-text">暂无国家费率数据</span>}
          </div>
        )}
      </section>

      {embedded && hasQueried && payload && (
        <div className="rate-access-mode-note">
          费率数据最后同步：{new Date(String((payload.meta as any).snapshotUpdatedAt || payload.meta.updatedAt)).toLocaleString("zh-CN")} · 来源：Google Sheet → Supabase
        </div>
      )}

      <section className="filter-card">
        <div className="filters filters-v3 rate-filters">
          <RateMultiSelect label="国家 / 地区" options={countries} value={draftFilters.countries} onChange={(value) => updateDraft("countries", value)} placeholder="全部国家" />
          <RateMultiSelect label="表格页签" options={sheets} value={draftFilters.sheets} onChange={(value) => updateDraft("sheets", value)} placeholder="全部页签" />
          <RateMultiSelect label="盘口 / 平台" options={platformOptions} value={draftFilters.platforms} onChange={(value) => updateDraft("platforms", value)} placeholder="全部盘口" />
          <RateMultiSelect label="三方名称" options={thirdPartyOptions} value={draftFilters.thirdParties} onChange={(value) => updateDraft("thirdParties", value)} placeholder="全部三方" />
          <RateMultiSelect label="类型 / 钱包" options={categoryOptions} value={draftFilters.categories} onChange={(value) => updateDraft("categories", value)} placeholder="全部类型" />
          <RateMultiSelect label="状态" options={STATUS_LABELS} value={draftFilters.statuses} onChange={(value) => updateDraft("statuses", value)} placeholder="全部状态" />
          <RateMultiSelect label="业务方向" options={CHANNEL_TYPE_LABELS} value={draftFilters.channelTypes} onChange={(value) => updateDraft("channelTypes", value)} placeholder="全部方向" />
          <div className="field">
            <label>关键词</label>
            <input className="input" value={draftFilters.keyword} onChange={(e) => updateDraft("keyword", e.target.value)} placeholder="搜索三方 / 盘口 / 费率 / 状态" />
          </div>
          <div className="action-row action-row-v2">
            <button className="primary-btn" onClick={() => void applyFilters()} disabled={state === "loading"}>{state === "loading" ? "查询中..." : "查询"}</button>
            <button className="ghost-btn" onClick={resetFilters}>重置</button>
            <button className="ghost-btn" onClick={handleExport}>导出</button>
            
          </div>
        </div>
      </section>
      {state === "error" && error && <div className="business-query-error">查询失败：{error}</div>}

      {mainView === "countryRates" && (
        <CountryRatePage
          country={activeCountryRate}
          statusRows={activeCountryStatusRows}
          rateRows={activeCountryRateRows}
          highFeeRows={highFeeRateRows.filter((row) => row.country === activeCountryRate)}
          anomalies={filteredAnomalies.filter((text) => !activeCountryRate || text.includes(activeCountryRate))}
          onOpenRate={openRateAccess}
          onOpenAnomaly={openAnomaly}
        />
      )}

      {mainView === "dashboard" && view === "dashboard" && (
        <>
          <section className="metrics rate-metrics">
            <RateMetric label="接入记录" value={formatNumber(filteredStatusRows.length)} sub="盘口 × 三方状态" />
            <RateMetric label="盘口数量" value={formatNumber(uniq(filteredStatusRows.map((r) => `${r.country}|||${r.platform}`)).length)} sub="按国家 + 盘口去重" />
            <RateMetric label="三方数量" value={formatNumber(uniq(filteredStatusRows.map((r) => r.thirdParty)).length || filteredRateRows.length)} sub="当前筛选范围" />
            <RateMetric label="开启 / 正常" value={formatNumber(filteredStatusRows.filter((r) => GOOD_STATUSES.has(r.status)).length)} sub="当前可用状态" />
            <RateMetric label="暂停 / 停用 / 未接入" value={formatNumber(filteredStatusRows.filter((r) => BAD_STATUSES.has(r.status)).length)} sub="需要关注" />
            <RateMetric label="异常提醒" value={formatNumber(filteredAnomalies.length)} sub="按当前筛选结果" />
          </section>

          <section className="chart-grid">
            <RatePanel title="状态分布" subtitle="当前筛选范围内各状态数量">
              <StatusBars items={statusCounts} />
            </RatePanel>
            <RatePanel title="可用三方最少的盘口" subtitle="开启/正常数量越少越需要关注">
              <PlatformHealthList rows={platformHealth} statusRows={filteredStatusRows} rateRows={filteredRateRows} />
            </RatePanel>
          </section>

          <section className="chart-grid">
            <RatePanel title="三方运行总览" subtitle="看哪些三方正在跑、跑在哪些国家和盘口">
              <ThirdPartyRunningMiniList rows={sortedRunningRows.slice(0, 10)} onOpen={openThirdPartyDetail} />
              <div className="panel-action-row">
                <button className="ghost-btn small" type="button" onClick={() => { setView("running"); setPage(1); }}>查看全部三方运行</button>
              </div>
            </RatePanel>
            <RatePanel title="异常提醒" subtitle="按异常类型 + 国家分组，优先显示费率偏高和可用通道风险">
              <AnomalyList items={filteredAnomalies.slice(0, 18)} onOpen={openAnomaly} />
            </RatePanel>
          </section>

          <section className="chart-grid">
            <RatePanel title="各国家三方汇总" subtitle="每个国家有几个盘口、几个三方、正常比例和费率偏高数量">
              <CountryRateSummaryList rows={countryRateSummaryRows} />
            </RatePanel>
            <RatePanel title="费率偏高国家对比" subtitle="按国家分类查看费率偏高的三方，数量多的国家排前面">
              <HighFeeCountryList rows={countryRateSummaryRows} highFeeRows={highFeeRateRows} onOpen={openRateAccess} />
            </RatePanel>
          </section>
        </>
      )}

      {mainView === "dashboard" && view === "running" && (
        <RatePanel title="三方运行查询" subtitle="按三方名称汇总：能快速查看这个三方跑在哪些国家、哪些盘口、开启/正常多少个">
          <RatePagination total={sortedRunningRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
          <ThirdPartyRunningTable rows={paginateRows(sortedRunningRows, page, pageSize)} totalRows={sortedRunningRows} sortState={runningSort} onSort={toggleRunningSort} onOpen={openThirdPartyDetail} />
        </RatePanel>
      )}

      {mainView === "dashboard" && view === "country" && (
        <RatePanel title="国家三方查询" subtitle="按国家汇总：看每个国家有几个三方、哪些三方开启/备用/异常，以及覆盖哪些盘口">
          <RatePagination total={countryThirdPartyRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
          <CountryThirdPartyTable rows={paginateRows(countryThirdPartyRows, page, pageSize)} totalRows={countryThirdPartyRows} />
        </RatePanel>
      )}

      {mainView === "dashboard" && view === "platform" && (
        <RatePanel title="盘口接入状态" subtitle="按盘口查看每个三方当前状态，可点击表头排序">
          <RatePagination total={sortedStatusRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
          <PlatformStatusTable rows={paginateRows(sortedStatusRows, page, pageSize)} totalRows={sortedStatusRows} sortState={statusSort} onSort={toggleStatusSort} />
        </RatePanel>
      )}

      {mainView === "dashboard" && view === "rates" && (
        <RatePanel title="三方费率表" subtitle="主表严格对齐 Google 的合计费率、代收/代付合计、范围和业务状态；详细手续费、停用原因、通道能力与接入盘口请点「查看」。">
          <RatePagination total={sortedRateRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
          <RateTable rows={paginateRows(sortedRateRows, page, pageSize)} totalRows={sortedRateRows} sortState={rateSort} onSort={toggleRateSort} onOpen={openRateAccess} />
        </RatePanel>
      )}

      {mainView === "dashboard" && view === "anomalies" && (
        <RatePanel title="异常提醒" subtitle="自动根据当前筛选结果判断，方便你快速检查通道风险">
          <AnomalyList items={filteredAnomalies} expanded onOpen={openAnomaly} />
        </RatePanel>
      )}

      {anomalyModal && <RateAnomalyModal detail={anomalyModal} onClose={() => setAnomalyModal(null)} />}
    </div>
  );
}


function CountryRatePage({ country, statusRows, rateRows, highFeeRows, anomalies, onOpenRate, onOpenAnomaly }: { country: string; statusRows: ThirdPartyPlatformStatusRow[]; rateRows: ThirdPartyRateRow[]; highFeeRows: ThirdPartyRateRow[]; anomalies: string[]; onOpenRate: (row: ThirdPartyRateRow) => void; onOpenAnomaly: (message: string) => void }) {
  const open = statusRows.filter((row) => GOOD_STATUSES.has(row.status)).length;
  const bad = statusRows.filter((row) => BAD_STATUSES.has(row.status)).length;
  const platforms = uniq(statusRows.map((row) => row.platform));
  const parties = uniq([...statusRows.map((row) => canonicalThirdPartyName(row.thirdParty, row.country)), ...rateRows.map((row) => canonicalThirdPartyName(row.thirdParty, row.country))]);
  const statusGroups = summarizePlatformHealth(statusRows).slice(0, 10);
  const runningRows = summarizeThirdPartyRunning(statusRows, rateRows).slice(0, 10);

  return (
    <div className="country-rate-page">
      <section className="panel country-page-title">
        <div>
          <h2>{countryPaneLabel(country)}</h2>
          <p>这里只显示 {country || "当前国家"} 的三方费率、盘口接入状态和异常；主三方名称按映射表统一。</p>
        </div>
      </section>
      <RatePanel title={`${countryPaneLabel(country)} 三方费率明细`} subtitle="当前国家主表按 Google 原始费率字段显示；详细手续费、停用原因、通道能力与接入盘口统一放在「查看」。">
        <RateTable rows={[...rateRows].sort(compareRateSourceOrder).slice(0, 200)} sortState={{ key: "sourceOrder", direction: "asc" }} onSort={() => undefined} onOpen={onOpenRate} />
      </RatePanel>
      <section className="metrics rate-metrics">
        <RateMetric label="接入记录" value={formatNumber(statusRows.length)} sub="盘口 × 主三方状态" />
        <RateMetric label="盘口 / 主三方" value={`${formatNumber(platforms.length)} / ${formatNumber(parties.length)}`} sub="按当前国家去重" />
        <RateMetric label="开启 / 正常" value={formatNumber(open)} sub={`可用率 ${formatPercent(statusRows.length ? open / statusRows.length : 0)}`} />
        <RateMetric label="异常 / 未接" value={formatNumber(bad)} sub="暂停、停用、未接入、维护、不支持" />
        <RateMetric label="高费率" value={formatNumber(highFeeRows.length)} sub="按当前国家费率资料判断" />
        <RateMetric label="异常提醒" value={formatNumber(anomalies.length)} sub="仅当前国家" />
      </section>
      <section className="chart-grid">
        <RatePanel title={`${countryPaneLabel(country)} 可用三方较少盘口`} subtitle="本国家内开启/正常数量越少越需要关注。">
          <PlatformHealthList rows={statusGroups} statusRows={statusRows} rateRows={rateRows} />
        </RatePanel>
        <RatePanel title={`${countryPaneLabel(country)} 三方运行 TOP`} subtitle="本国家内哪些三方覆盖盘口最多、开启状态最多。">
          <ThirdPartyRunningMiniList rows={runningRows} onOpen={() => undefined} />
        </RatePanel>
      </section>
      <section className="chart-grid">
        <RatePanel title={`${countryPaneLabel(country)} 费率偏高`} subtitle="只显示当前国家费率偏高的三方。">
          <CountryHighFeeMini rows={highFeeRows.slice(0, 20)} onOpen={onOpenRate} />
        </RatePanel>
        <RatePanel title={`${countryPaneLabel(country)} 异常提醒`} subtitle="按当前国家过滤后的异常。">
          <AnomalyList items={anomalies.slice(0, 30)} expanded onOpen={onOpenAnomaly} />
        </RatePanel>
      </section>
      <RatePanel title={`${countryPaneLabel(country)} 盘口接入状态`} subtitle="当前国家的盘口接入状态，最多显示 200 行。">
        <PlatformStatusTable rows={statusRows.slice(0, 200)} sortState={{ key: "platform", direction: "asc" }} onSort={() => undefined} />
      </RatePanel>
    </div>
  );
}

function CountryHighFeeMini({ rows, onOpen }: { rows: ThirdPartyRateRow[]; onOpen: (row: ThirdPartyRateRow) => void }) {
  return (
    <div className="mini-list">
      {rows.map((row, index) => (
        <div className="rank-item" key={row.id}>
          <div className="rank-no">{index + 1}</div>
          <div>
            <div className="rank-name">{row.country} / {canonicalThirdPartyName(row.thirdParty, row.country)}</div>
            <div className="rank-sub">代收 {row.collectFee || "-"} · 代付 {row.payoutFee || "-"} · 合计 {row.totalFee || "-"}</div>
          </div>
          <button className="mini-btn" type="button" onClick={() => onOpen(row)}>查看</button>
        </div>
      ))}
      {!rows.length && <div className="empty">暂无高费率资料</div>}
    </div>
  );
}

function RateMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="metric-card rate-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{sub}</p>
    </div>
  );
}

function RatePanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="panel rate-panel">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
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


function RatePercentBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="rate-cell">
      <span>{formatPercent(value)}</span>
      <span className="bar"><span className="bar-fill" style={{ width: `${width}%` }} /></span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${getStatusClass(status)}`}>{status || "未知"}</span>;
}

function StatusBars({ items }: { items: Array<{ label: string; value: number }> }) {
  const [open, setOpen] = useState(false);
  const max = Math.max(...items.map((item) => item.value), 1);
  const visible = items.slice(0, 6);
  if (!items.length) return <div className="empty">暂无状态数据</div>;
  const fullText = items.map((item) => `${item.label}：${formatNumber(item.value)}`).join("\n");
  return (
    <div className="rate-bar-list">
      {visible.map((item) => (
        <div className="rate-bar-row" key={item.label}>
          <div className="rate-bar-top"><StatusBadge status={item.label} /><strong>{formatNumber(item.value)}</strong></div>
          <div className="chart-bar"><span style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }} /></div>
        </div>
      ))}
      {items.length > 6 && (
        <div className="chart-more-row">
          <button className="ghost-btn small" type="button" onClick={() => setOpen(true)}>{`查看更多（共 ${items.length} 项）`}</button>
        </div>
      )}
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="detail-modal compact-text-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header"><div><h3>状态分布完整数据</h3><p>当前筛选范围内各状态数量</p></div><button className="ghost-btn small" type="button" onClick={() => setOpen(false)}>关闭</button></div>
            <div className="full-text-box">{fullText}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformHealthList({ rows, statusRows, rateRows }: { rows: ReturnType<typeof summarizePlatformHealth>; statusRows: ThirdPartyPlatformStatusRow[]; rateRows: ThirdPartyRateRow[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReturnType<typeof summarizePlatformHealth>[number] | null>(null);
  const visible = rows.slice(0, 8);
  if (!rows.length) return <div className="empty">暂无盘口状态数据</div>;

  const selectedStatuses = selected ? statusRows.filter((row) => row.country === selected.country && row.platform === selected.platform) : [];
  const selectedThirdParties = new Set(selectedStatuses.map((row) => row.thirdParty));
  const selectedRates = selected ? rateRows.filter((row) => row.country === selected.country && selectedThirdParties.has(row.thirdParty)) : [];

  return (
    <div className="mini-list">
      {visible.map((row, index) => (
        <button className="rank-item rank-button" key={`${row.country}-${row.platform}`} type="button" onClick={() => { setSelected(row); setOpen(true); }}>
          <div className={row.open <= 2 ? "rank-no warn" : "rank-no"}>{index + 1}</div>
          <div>
            <div className="rank-name">{row.platform}</div>
            <div className="rank-sub">{row.country} · 开启/正常 {row.open}/{row.total} · 异常 {row.bad}</div>
          </div>
          <div className="rank-value">{row.open}</div>
        </button>
      ))}
      {rows.length > 8 && (
        <div className="chart-more-row">
          <button className="ghost-btn small" type="button" onClick={() => { setSelected(null); setOpen(true); }}>{`查看更多（共 ${rows.length} 项）`}</button>
        </div>
      )}
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="detail-modal rate-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header">
              <div>
                <h3>{selected ? `${selected.country} ${selected.platform} 接入详情` : "可用三方最少的盘口"}</h3>
                <p>{selected ? `开启/正常 ${selected.open}/${selected.total} · 暂停 ${selected.paused} · 备用 ${selected.backup} · 异常 ${selected.bad}` : "点击盘口可以进入对应详情，返回后继续看列表"}</p>
              </div>
              <div className="modal-header-actions">
                {selected && <button className="ghost-btn small" type="button" onClick={() => setSelected(null)}>返回列表</button>}
                <button className="ghost-btn small" type="button" onClick={() => setOpen(false)}>关闭</button>
              </div>
            </div>
            {!selected && (
              <div className="mini-list modal-mini-list">
                {rows.map((row, index) => (
                  <button className="rank-item rank-button" key={`${row.country}-${row.platform}-${index}`} type="button" onClick={() => setSelected(row)}>
                    <div className={row.open <= 2 ? "rank-no warn" : "rank-no"}>{index + 1}</div>
                    <div><div className="rank-name">{row.platform}</div><div className="rank-sub">{row.country} · 开启/正常 {row.open}/{row.total} · 暂停 {row.paused} · 备用 {row.backup} · 异常 {row.bad}</div></div>
                    <div className="rank-value">{row.open}</div>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <div className="detail-modal-body">
                <div className="modal-section-title">盘口接入状态</div>
                <div className="modal-card-grid">
                  {selectedStatuses.map((row) => (
                    <div className="modal-data-card" key={row.id}>
                      <div className="detail-card-head"><div><strong>{row.thirdParty}</strong><span>{row.country} · {row.platform} · {row.sheetName}</span></div><StatusBadge status={row.status || "未知"} /></div>
                      <div className="modal-mini-grid">
                        <div><span>合计费率</span><b>{row.totalFee || "-"}</b></div>
                        <div><span>代收手续费</span><b>{row.collectFee || "-"}</b></div>
                        <div><span>代付手续费</span><b>{row.payoutFee || "-"}</b></div>
                        <div><span>代收单笔</span><b>{row.collectSingleFee || "-"}</b></div>
                        <div><span>代付单笔</span><b>{row.payoutSingleFee || "-"}</b></div>
                        <div><span>代收限制</span><b>{row.collectLimit || "-"}</b></div>
                        <div><span>代付限制</span><b>{row.payoutLimit || "-"}</b></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="modal-section-title">对应费率资料</div>
                <div className="modal-card-grid">
                  {selectedRates.map((row) => (
                    <div className="modal-data-card" key={row.id}>
                      <div className="detail-card-head"><div><strong>{row.thirdParty}</strong><span>{row.country} · {row.sheetName} · {row.category || "-"}</span></div><StatusBadge status={row.status || "未知"} /></div>
                      <div className="modal-mini-grid">
                        <div><span>合计费率</span><b>{row.totalFee || "-"}</b></div>
                        <div><span>代收手续费</span><b>{row.collectFee || "-"}</b></div>
                        <div><span>代付手续费</span><b>{row.payoutFee || "-"}</b></div>
                        <div><span>代收单笔</span><b>{row.collectSingleFee || "-"}</b></div>
                        <div><span>代付单笔</span><b>{row.payoutSingleFee || "-"}</b></div>
                        <div><span>代收限制</span><b>{row.collectLimit || "-"}</b></div>
                        <div><span>代付限制</span><b>{row.payoutLimit || "-"}</b></div>
                      </div>
                    </div>
                  ))}
                  {!selectedRates.length && <div className="empty">没有匹配的费率资料</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CountryRateSummaryList({ rows }: { rows: CountryRateSummaryRow[] }) {
  const [open, setOpen] = useState(false);
  const visible = rows.slice(0, 8);
  if (!rows.length) return <div className="empty">暂无国家汇总数据</div>;
  const max = Math.max(...rows.map((row) => row.thirdParties), 1);
  const list = (open ? rows : visible);
  return (
    <div className="mini-list country-rate-summary-list">
      {list.map((row, index) => (
        <div className="rank-item" key={row.country}>
          <div className="rank-no">{index + 1}</div>
          <div>
            <div className="rank-name">{row.country}</div>
            <div className="rank-sub">盘口 {row.platforms} 个 · 三方 {row.thirdParties} 个 · 正常 {formatPercent(row.openRate)} · 费率偏高 {row.highFee} 个</div>
            <div className="chart-bar small"><span style={{ width: `${Math.max(4, (row.thirdParties / max) * 100)}%` }} /></div>
          </div>
          <div className="rank-value">{row.thirdParties}</div>
        </div>
      ))}
      {rows.length > 8 && !open && (
        <div className="chart-more-row"><button className="ghost-btn small" type="button" onClick={() => setOpen(true)}>{`查看更多国家（共 ${rows.length} 个）`}</button></div>
      )}
      {open && rows.length > 8 && (
        <div className="chart-more-row"><button className="ghost-btn small" type="button" onClick={() => setOpen(false)}>收起</button></div>
      )}
    </div>
  );
}

function HighFeeCountryList({ rows, highFeeRows, onOpen }: { rows: CountryRateSummaryRow[]; highFeeRows: ThirdPartyRateRow[]; onOpen: (row: ThirdPartyRateRow) => void }) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const countries = rows.filter((row) => row.highFee > 0);
  const visibleCountries = countries.slice(0, 8);
  if (!countries.length) return <div className="empty">当前筛选结果没有费率偏高数据</div>;
  const max = Math.max(...countries.map((row) => row.highFee), 1);
  const targetRows = country ? highFeeRows.filter((row) => row.country === country) : [];
  return (
    <div className="mini-list high-fee-country-list">
      {visibleCountries.map((row, index) => (
        <button className="rank-item rank-button" type="button" key={row.country} onClick={() => { setCountry(row.country); setOpen(true); }}>
          <div className="rank-no warn">{index + 1}</div>
          <div>
            <div className="rank-name">{row.country}</div>
            <div className="rank-sub">费率偏高 {row.highFee} 个 · 三方总数 {row.thirdParties} 个 · {row.highFeeParties || "-"}</div>
            <div className="chart-bar small warn-bar"><span style={{ width: `${Math.max(4, (row.highFee / max) * 100)}%` }} /></div>
          </div>
          <div className="rank-value">{row.highFee}</div>
        </button>
      ))}
      {countries.length > 8 && <div className="chart-more-row"><button className="ghost-btn small" type="button" onClick={() => { setCountry(null); setOpen(true); }}>{`查看更多（共 ${countries.length} 个国家）`}</button></div>}
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="detail-modal rate-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header">
              <div><h3>{country ? `${country} 费率偏高明细` : "费率偏高国家对比"}</h3><p>{country ? "点击单条可查看这个三方接了哪些平台。" : "选择国家后查看这个国家有哪些三方费率偏高。"}</p></div>
              <div className="modal-header-actions">{country && <button className="ghost-btn small" type="button" onClick={() => setCountry(null)}>返回国家列表</button>}<button className="ghost-btn small" type="button" onClick={() => setOpen(false)}>关闭</button></div>
            </div>
            {!country && <CountryRateSummaryList rows={countries} />}
            {country && (
              <div className="mini-list modal-mini-list">
                {targetRows.map((row, index) => (
                  <button className="rank-item rank-button" key={row.id} type="button" onClick={() => onOpen(row)}>
                    <div className="rank-no warn">{index + 1}</div>
                    <div><div className="rank-name">{row.thirdParty}</div><div className="rank-sub">{row.sheetName} · {row.category || "-"} · 合计 {row.totalFee || "-"} · 代收 {row.collectFee || "-"} · 代付 {row.payoutFee || "-"}</div></div>
                    <div className="rank-value">查看</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function ThirdPartyUsageList({ rows }: { rows: ReturnType<typeof summarizeThirdPartyUsage> }) {
  if (!rows.length) return <div className="empty">暂无三方覆盖数据</div>;
  return (
    <div className="mini-list">
      {rows.map((row, index) => (
        <div className="rank-item" key={row.thirdParty}>
          <div className="rank-no">{index + 1}</div>
          <div>
            <div className="rank-name">{row.thirdParty}</div>
            <div className="rank-sub">覆盖国家 {row.countries.size} 个 · 异常 {row.bad}</div>
          </div>
          <div className="rank-value">{row.open}/{row.total}</div>
        </div>
      ))}
    </div>
  );
}

function anomalyType(text: string): string {
  const match = String(text || "").match(/^\[([^\]]+)\]/);
  return match?.[1] || "其他异常";
}

function anomalyText(text: string): string {
  return String(text || "").replace(/^\[[^\]]+\]\s*/, "");
}

function anomalyCountry(text: string): string {
  const body = anomalyText(text);
  return body.split(/\s+/)[0]?.replace(/[：:，。]/g, "") || "未分类";
}

function anomalyPriority(type: string): number {
  if (type === "费率偏高") return 0;
  if (type === "费率不一致") return 1;
  if (type === "USDT可用为0") return 2;
  if (type === "少接入") return 3;
  if (type === "未接入较多") return 4;
  if (type === "暂停较多") return 5;
  if (type === "状态异常") return 6;
  return 20;
}

function AnomalyList({ items, expanded = false, onOpen }: { items: string[]; expanded?: boolean; onOpen?: (text: string) => void }) {
  const [showAll, setShowAll] = useState(expanded);
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const at = anomalyType(a);
      const bt = anomalyType(b);
      return anomalyPriority(at) - anomalyPriority(bt) || anomalyCountry(a).localeCompare(anomalyCountry(b), "zh-CN") || a.localeCompare(b, "zh-CN");
    });
  }, [items]);
  const visible = showAll ? sortedItems : sortedItems.slice(0, 12);
  if (!items.length) return <div className="empty">当前筛选结果暂无明显异常</div>;

  const groups = visible.reduce<Array<{ type: string; country: string; rows: string[] }>>((acc, text) => {
    const type = anomalyType(text);
    const country = anomalyCountry(text);
    let group = acc.find((item) => item.type === type && item.country === country);
    if (!group) {
      group = { type, country, rows: [] };
      acc.push(group);
    }
    group.rows.push(text);
    return acc;
  }, []);

  return (
    <div className="alert-list rate-alert-list">
      {groups.map((group) => (
        <div className="rate-alert-group" key={`${group.type}-${group.country}`}>
          <div className="anomaly-group-title">
            <span>{group.type} · {group.country}</span>
            <b>{group.rows.length} 条</b>
          </div>
          {group.rows.map((text, index) => (
            <button className="alert-item alert-clickable" key={`${text}-${index}`} type="button" onClick={() => onOpen?.(text)}>
              <span className="alert-dot" />
              <span>{anomalyText(text)}</span>
              <b>查看</b>
            </button>
          ))}
        </div>
      ))}
      {items.length > 12 && !expanded && (
        <div className="chart-more-row">
          <button className="ghost-btn small" onClick={() => setShowAll((v) => !v)}>{showAll ? "收起" : `查看更多（共 ${items.length} 条）`}</button>
        </div>
      )}
    </div>
  );
}


function RateAnomalyModal({ detail, onClose }: { detail: RateAnomalyDetail; onClose: () => void }) {
  const notConnectedStatuses = new Set(["未接入", "不支持", "对接中", "未知"]);
  const connectedRows = [...detail.statusRows]
    .filter((row) => !notConnectedStatuses.has(row.status || "未知"))
    .sort(compareStatusSourceOrder);
  const missingRows = [...detail.statusRows]
    .filter((row) => notConnectedStatuses.has(row.status || "未知"))
    .sort(compareStatusSourceOrder);

  const detailFieldDefs: Array<[string, string[]]> = [
    ["代收情况", ["代收情况"]],
    ["代付情况", ["代付情况"]],
    ["创建单子非整数", ["创建单子非整数", "创建单子小数点"]],
    ["授信", ["授信"]],
    ["公户打款", ["公户打款"]],
    ["限额最高", ["限额最高"]],
    ["打款时间", ["打款时间"]],
    ["通知群组", ["切换通道通知出款群组名称", "切换通道通知群组名称"]],
    ["三方收款UPI账号", ["三方收款UPI账号", "收款UPI账号"]],
    ["是否愿意升级", ["三方是否愿意升级", "是否愿意升级"]],
    ["IFSC 支持", ["请问我们商户是否支持IFSC AIRP0000001", "IFSC支持", "是否支持IFSC"]],
    ["UTR 查单补单", ["UTR接口查单补单", "UTR查单补单"]],
    ["代付成功返回UTR", ["代付出款成功支持UTR返回", "代付成功支持UTR返回"]],
    ["收款账户类型", ["收款是使用公户还是 个人", "收款是使用公户还是个人"]]
  ];

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="detail-modal rate-detail-modal tidy-rate-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="detail-modal-header">
          <div>
            <h3>{detail.title}</h3>
            <p>{detail.message}</p>
          </div>
          <button className="ghost-btn small" type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="detail-modal-body">
          <div className="modal-section-title">费率与业务资料（{detail.rateRows.length} 条）</div>
          <div className="modal-card-grid">
            {detail.rateRows.map((row) => {
              const collectStatus = rateBusinessStatus(row, "collect") || "-";
              const payoutStatus = rateBusinessStatus(row, "payout") || "-";
              const stopReason = rateStopReason(row);
              const extraFields = detailFieldDefs
                .map(([label, aliases]) => [label, rateInfoValue(row, aliases)] as [string, string])
                .filter(([, value]) => value && value !== "-");
              return (
                <div className="modal-data-card tidy-rate-card" key={row.id}>
                  <div className="detail-card-head tidy-detail-card-head">
                    <div>
                      <strong>{row.thirdParty}</strong>
                      <span>{row.country} · {row.category || "-"}</span>
                    </div>
                    <div className="detail-status-pair">
                      <span>代收 <StatusBadge status={collectStatus} /></span>
                      <span>代付 <StatusBadge status={payoutStatus} /></span>
                    </div>
                  </div>

                  <div className="rate-detail-section">
                    <div className="rate-detail-section-title">费率</div>
                    <div className="tidy-info-grid primary-rate-grid">
                      <div><span>合计费率</span><b>{row.totalFee || "-"}</b></div>
                      <div><span>代收合计%+单笔</span><b>{rateCombinedFee(row, "collect")}</b></div>
                      <div><span>代付合计%+单笔</span><b>{rateCombinedFee(row, "payout")}</b></div>
                      <div><span>代收费率</span><b>{row.collectFee || "-"}</b></div>
                      <div><span>代付费率</span><b>{row.payoutFee || "-"}</b></div>
                      <div><span>代收单笔</span><b>{row.collectSingleFee || "-"}</b></div>
                      <div><span>代付单笔</span><b>{row.payoutSingleFee || "-"}</b></div>
                      <div><span>代收范围</span><b>{row.collectLimit || "-"}</b></div>
                      <div><span>代付范围</span><b>{row.payoutLimit || "-"}</b></div>
                    </div>
                  </div>

                  <div className="rate-detail-section">
                    <div className="rate-detail-section-title">状态 / 停用原因</div>
                    <div className="tidy-info-grid status-info-grid">
                      <div><span>代收状态</span><div className="status-value"><BusinessStatusCell value={collectStatus} /></div></div>
                      <div><span>代付状态</span><div className="status-value"><BusinessStatusCell value={payoutStatus} /></div></div>
                      {row.status ? <div><span>表格状态</span><b>{row.status}</b></div> : null}
                      <div className="wide-info-cell"><span>停用原因 / 状态备注</span><b>{stopReason || "-"}</b></div>
                    </div>
                  </div>

                  {extraFields.length ? (
                    <div className="rate-detail-section">
                      <div className="rate-detail-section-title">通道能力 / 运营资料</div>
                      <div className="tidy-info-grid capability-grid">
                        {extraFields.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
                        <div><span>白名单</span><b>{row.whitelist || "-"}</b></div>
                        <div><span>是否有漏洞</span><b>{row.leak || "-"}</b></div>
                      </div>
                    </div>
                  ) : null}

                  <div className="rate-source-line">数据来源：{row.sheetName || "-"} · 第 {row.sourceRow || "-"} 行</div>
                </div>
              );
            })}
            {!detail.rateRows.length && <div className="empty">没有匹配的费率资料</div>}
          </div>

          <div className="modal-section-title">已接入 / 可用平台（{connectedRows.length} 个）</div>
          <div className="modal-chip-list tidy-platform-grid">
            {connectedRows.map((row) => (
              <div className="modal-platform-chip tidy-platform-chip" key={row.id}>
                <strong>{row.platform}</strong>
                <StatusBadge status={row.status || "未知"} />
              </div>
            ))}
            {!connectedRows.length && <div className="empty">暂无已接入平台</div>}
          </div>

          <div className="modal-section-title">未接入 / 不支持平台（{missingRows.length} 个）</div>
          <div className="modal-chip-list tidy-platform-grid">
            {missingRows.map((row) => (
              <div className="modal-platform-chip muted-platform-chip tidy-platform-chip" key={row.id}>
                <strong>{row.platform}</strong>
                <StatusBadge status={row.status || "未知"} />
              </div>
            ))}
            {!missingRows.length && <div className="empty">暂无未接入平台</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RatePagination({ total, page, pageSize, onPageChange, onPageSizeChange }: { total: number; page: number; pageSize: number; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void }) {
  const totalPages = pageCount(total, pageSize);
  return (
    <div className="pagination-row">
      <span>显示 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} / 共 {formatNumber(total)} 行</span>
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


function ThirdPartyRunningMiniList({ rows, onOpen }: { rows: ThirdPartyRunningRow[]; onOpen: (row: ThirdPartyRunningRow) => void }) {
  if (!rows.length) return <div className="empty">暂无三方运行数据</div>;
  return (
    <div className="mini-list">
      {rows.map((row, index) => (
        <button className="rank-item rank-button" key={row.thirdParty} type="button" onClick={() => onOpen(row)}>
          <div className={row.open <= 0 ? "rank-no warn" : "rank-no"}>{index + 1}</div>
          <div>
            <div className="rank-name">{row.thirdParty}</div>
            <div className="rank-sub">{row.countries || "-"} · 开启/正常 {row.open}/{row.total} · {formatPercent(row.openRate)}</div>
          </div>
          <div className="rank-value">查看</div>
        </button>
      ))}
    </div>
  );
}


function summarizeRunningRows(rows: ThirdPartyRunningRow[]) {
  return rows.reduce((acc, row) => {
    acc.open += row.open || 0; acc.total += row.total || 0; acc.missing += row.missing || 0; acc.backup += row.backup || 0; acc.bad += row.bad || 0; return acc;
  }, { open: 0, total: 0, missing: 0, backup: 0, bad: 0 });
}
function summarizeCountryRows(rows: CountryThirdPartyRow[]) {
  return rows.reduce((acc, row) => {
    acc.platforms += row.platforms || 0; acc.totalThirdParties += row.totalThirdParties || 0; acc.openThirdParties += row.openThirdParties || 0; acc.backupThirdParties += row.backupThirdParties || 0; acc.badThirdParties += row.badThirdParties || 0; return acc;
  }, { platforms: 0, totalThirdParties: 0, openThirdParties: 0, backupThirdParties: 0, badThirdParties: 0 });
}
function summarizeStatusRows(rows: ThirdPartyPlatformStatusRow[]) { return { count: rows.length }; }
function summarizeRateGroups(rows: RateGroupRow[]) { return { count: rows.length, multi: rows.filter((row) => row.multi).length }; }

function ThirdPartyRunningTable({
  rows,
  totalRows = rows,
  sortState,
  onSort,
  onOpen
}: {
  rows: ThirdPartyRunningRow[];
  totalRows?: ThirdPartyRunningRow[];
  sortState: SortState;
  onSort: (key: string) => void;
  onOpen: (row: ThirdPartyRunningRow) => void;
}) {
  const shownSummary = summarizeRunningRows(rows);
  const allSummary = summarizeRunningRows(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的三方运行数据</div>;
  return (
    <div className="table-wrap rate-table-wrap">
      <table>
        <thead>
          <tr>
            <SortableTh label="三方名称" sortKey="thirdParty" sortState={sortState} onSort={onSort} />
            <SortableTh label="开启/正常" sortKey="open" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="全部接入" sortKey="total" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="未接盘口" sortKey="missing" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="可用率" sortKey="openRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="备用" sortKey="backup" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="异常" sortKey="bad" sortState={sortState} onSort={onSort} className="num" />
            <th>覆盖国家</th>
            <th>已接/涉及盘口</th>
            <th>未接盘口明细</th>
            <th>状态汇总</th>
            <th>代收费率</th>
            <th>代付费率</th>
            <th>合计费率</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.thirdParty}>
              <td className="platform-cell">{row.thirdParty}</td>
              <td className="num"><strong>{formatNumber(row.open)}</strong></td>
              <td className="num">{formatNumber(row.total)}</td>
              <td className="num">{formatNumber(row.missing)}</td>
              <td><RatePercentBar value={row.openRate} /></td>
              <td className="num">{formatNumber(row.backup)}</td>
              <td className="num">{formatNumber(row.bad)}</td>
              <td>{row.countries || "-"}</td>
              <td className="wide-text"><TextPreview title={`${row.thirdParty} 已接/涉及盘口`} text={row.platforms || "-"} /></td>
              <td className="wide-text"><TextPreview title={`${row.thirdParty} 未接盘口`} text={row.missingPlatforms || "-"} /></td>
              <td className="wide-text"><TextPreview title={`${row.thirdParty} 状态汇总`} text={row.statusSummary || "-"} /></td>
              <td>{row.collectFeeSummary || "-"}</td>
              <td>{row.payoutFeeSummary || "-"}</td>
              <td>{row.totalFeeSummary || "-"}</td>
              <td><button className="ghost-btn small" type="button" onClick={() => onOpen(row)}>查看</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.open)}</td><td className="num">{formatNumber(shownSummary.total)}</td><td className="num">{formatNumber(shownSummary.missing)}</td><td>{shownSummary.total ? formatPercent(shownSummary.open / shownSummary.total) : '-'}</td><td className="num">{formatNumber(shownSummary.backup)}</td><td className="num">{formatNumber(shownSummary.bad)}</td><td colSpan={8} className="muted-cell">汇总</td></tr>
          <tr className="summary-row overall-summary-row"><td>全部汇总</td><td className="num strong-cell">{formatNumber(allSummary.open)}</td><td className="num">{formatNumber(allSummary.total)}</td><td className="num">{formatNumber(allSummary.missing)}</td><td>{allSummary.total ? formatPercent(allSummary.open / allSummary.total) : '-'}</td><td className="num">{formatNumber(allSummary.backup)}</td><td className="num">{formatNumber(allSummary.bad)}</td><td colSpan={8} className="muted-cell">汇总</td></tr>
        </tfoot>
      </table>
    </div>
  );
}


function TextPreview({ title, text, limit = 80 }: { title: string; text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  const clean = text || "-";
  const tooLong = clean.length > limit;
  return (
    <>
      <span>{tooLong ? `${clean.slice(0, limit)}...` : clean}</span>
      {tooLong && <button className="link-btn" type="button" onClick={() => setOpen(true)}>查看更多</button>}
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="detail-modal compact-text-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header">
              <div>
                <h3>{title}</h3>
                <p>完整信息如下</p>
              </div>
              <button className="ghost-btn small" type="button" onClick={() => setOpen(false)}>关闭</button>
            </div>
            <div className="full-text-box">{clean}</div>
          </div>
        </div>
      )}
    </>
  );
}

function CountryThirdPartyTable({ rows, totalRows = rows }: { rows: CountryThirdPartyRow[]; totalRows?: CountryThirdPartyRow[] }) {
  const shownSummary = summarizeCountryRows(rows);
  const allSummary = summarizeCountryRows(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的国家三方数据</div>;
  return (
    <div className="table-wrap rate-table-wrap">
      <table>
        <thead>
          <tr>
            <th>国家</th>
            <th>盘口数</th>
            <th>三方总数</th>
            <th>开启/正常三方</th>
            <th>备用三方</th>
            <th>异常三方</th>
            <th>三方名单</th>
            <th>类型分布</th>
            <th>状态汇总</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.country}>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="num-center">{formatNumber(row.platforms)}</td>
              <td className="num-center">{formatNumber(row.totalThirdParties)}</td>
              <td className="num-center">{formatNumber(row.openThirdParties)}</td>
              <td className="num-center">{formatNumber(row.backupThirdParties)}</td>
              <td className="num-center">{formatNumber(row.badThirdParties)}</td>
              <td className="wide-text"><TextPreview title={`${row.country} 三方名单`} text={row.thirdParties || "-"} /></td>
              <td className="wide-text"><TextPreview title={`${row.country} 类型分布 / 三方名单`} text={row.typeDetail || row.typeSummary || "-"} limit={44} /></td>
              <td className="wide-text"><TextPreview title={`${row.country} 状态汇总`} text={row.statusSummary || "-"} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td>当前页汇总</td><td className="num">{formatNumber(shownSummary.platforms)}</td><td className="num strong-cell">{formatNumber(shownSummary.totalThirdParties)}</td><td className="num">{formatNumber(shownSummary.openThirdParties)}</td><td className="num">{formatNumber(shownSummary.backupThirdParties)}</td><td className="num">{formatNumber(shownSummary.badThirdParties)}</td><td colSpan={3} className="muted-cell">汇总</td></tr>
          <tr className="summary-row overall-summary-row"><td>全部汇总</td><td className="num">{formatNumber(allSummary.platforms)}</td><td className="num strong-cell">{formatNumber(allSummary.totalThirdParties)}</td><td className="num">{formatNumber(allSummary.openThirdParties)}</td><td className="num">{formatNumber(allSummary.backupThirdParties)}</td><td className="num">{formatNumber(allSummary.badThirdParties)}</td><td colSpan={3} className="muted-cell">汇总</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function PlatformStatusTable({ rows, totalRows = rows, sortState, onSort }: { rows: ThirdPartyPlatformStatusRow[]; totalRows?: ThirdPartyPlatformStatusRow[]; sortState: SortState; onSort: (key: string) => void }) {
  const shownSummary = summarizeStatusRows(rows);
  const allSummary = summarizeStatusRows(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的盘口接入状态</div>;
  return (
    <div className="table-wrap rate-table-wrap">
      <table>
        <thead>
          <tr>
            <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />
            <SortableTh label="盘口" sortKey="platform" sortState={sortState} onSort={onSort} />
            <SortableTh label="三方" sortKey="thirdParty" sortState={sortState} onSort={onSort} />
            <SortableTh label="状态" sortKey="status" sortState={sortState} onSort={onSort} />
            <SortableTh label="代收手续费" sortKey="collectFee" sortState={sortState} onSort={onSort} />
            <SortableTh label="代付手续费" sortKey="payoutFee" sortState={sortState} onSort={onSort} />
            <th>代收单笔</th>
            <th>代付单笔</th>
            <SortableTh label="合计费率" sortKey="totalFee" sortState={sortState} onSort={onSort} />
            <SortableTh label="代收范围" sortKey="collectLimit" sortState={sortState} onSort={onSort} />
            <SortableTh label="代付范围" sortKey="payoutLimit" sortState={sortState} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td className="platform-cell">{row.thirdParty}</td>
              <td><StatusBadge status={row.status} /></td>
              <td className="fee-cell">{row.collectFee || "-"}</td>
              <td className="fee-cell">{row.payoutFee || "-"}</td>
              <td className="fee-cell">{row.collectSingleFee || "-"}</td>
              <td className="fee-cell">{row.payoutSingleFee || "-"}</td>
              <td className="fee-cell">{row.totalFee || "-"}</td>
              <td className="fee-cell">{compactFeeCell(row.collectLimit)}</td>
              <td className="fee-cell">{compactFeeCell(row.payoutLimit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={10}>当前页汇总</td><td className="muted-cell">共 {formatNumber(shownSummary.count)} 行</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={10}>全部汇总</td><td className="muted-cell">共 {formatNumber(allSummary.count)} 行</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function splitParts(value: string): string[] {
  return String(value || "")
    .split(/\s*\/\s*|\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactFeeDisplay(value: string): string {
  const parts = splitParts(value);
  if (!parts.length) return "";
  return parts.join(" + ").replace(/\s*\+\s*单笔/g, " + 单笔");
}

function compactFeeCell(value: string) {
  const text = compactFeeDisplay(value);
  return <span>{text || "-"}</span>;
}

function rateInfoEntries(row: ThirdPartyRateRow): Array<[string, string]> {
  return String(row.channelInfo || "")
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([^:：]+)\s*[:：]\s*(.*)$/);
      return match ? [match[1].trim(), match[2].trim()] as [string, string] : ["", part] as [string, string];
    });
}

function rateInfoValue(row: ThirdPartyRateRow, labels: string[]): string {
  const targets = labels.map((label) => label.toLowerCase());
  for (const [label, value] of rateInfoEntries(row)) {
    const key = label.toLowerCase();
    if (targets.includes(key) && value) return value;
  }
  return "";
}

function rateCombinedFee(row: ThirdPartyRateRow, kind: "collect" | "payout"): string {
  const raw = kind === "collect"
    ? rateInfoValue(row, ["代收合计%+单笔", "代收合计", "收款合计%+单笔"])
    : rateInfoValue(row, ["代付合计%+单笔", "代付合计", "付款合计%+单笔", "出款合计%+单笔"]);
  if (raw) return raw;

  const fee = String((kind === "collect" ? row.collectFee : row.payoutFee) || "").trim();
  const single = String((kind === "collect" ? row.collectSingleFee : row.payoutSingleFee) || "").trim();
  if (!fee) return single || "-";
  // 阶梯费率本身已经包含“以上/以下/+单笔”等说明时，不再重复拼接单笔。
  if (/以上|以下|\+\s*\d|单笔/.test(fee)) return fee;
  if (!single || /^(没有|无|-|—|0(?:\.0+)?)$/i.test(single)) return `${fee} + 0`;
  return `${fee} + ${single}`;
}

function rateStopReason(row: ThirdPartyRateRow): string {
  return rateInfoValue(row, ["停用原因", "状态备注", "状态备注内容", "备注原因", "停用备注"]);
}

function rateBusinessStatus(row: ThirdPartyRateRow, kind: "collect" | "payout"): string {
  return kind === "collect"
    ? rateInfoValue(row, ["代收状态", "代收情况"])
    : rateInfoValue(row, ["代付状态", "代付情况"]);
}

function BusinessStatusCell({ value }: { value: string }) {
  const parts = String(value || "")
    .split(/\s*\+\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parts.length) return <span className="muted-cell">-</span>;
  return (
    <div className="business-status-cell">
      {parts.map((item) => <StatusBadge key={item} status={item} />)}
    </div>
  );
}


type RateGroupRow = {
  id: string;
  country: string;
  sheetName: string;
  thirdParty: string;
  category: string;
  totalFee: string;
  collectFee: string;
  payoutFee: string;
  collectSingleFee: string;
  payoutSingleFee: string;
  collectLimit: string;
  payoutLimit: string;
  collectStatus: string;
  payoutStatus: string;
  status: string;
  sourceOrder: number;
  rows: ThirdPartyRateRow[];
  multi: boolean;
};

function joinUnique(values: string[], empty = "-"): string {
  const cleaned = Array.from(new Set(values.map((v) => String(v || "").trim()).filter(Boolean)));
  if (!cleaned.length) return empty;
  // 不同通道/类型是并列费率，不是相加关系。
  return cleaned.join(" / ");
}

function groupedRateRows(rows: ThirdPartyRateRow[]): RateGroupRow[] {
  const map = new Map<string, ThirdPartyRateRow[]>();
  for (const row of dedupeRateRows(rows)) {
    const name = normalizeRatePartyName(row.thirdParty, row.country, row);
    const key = [row.country, row.sheetName, name].join("|||");
    map.set(key, [...(map.get(key) || []), { ...row, thirdParty: name }]);
  }
  return Array.from(map.entries()).map(([key, items]) => {
    const feeItems = dedupeRateRows(preferDirectRateRows(items));
    const first = feeItems[0] || items[0];
    const categories = Array.from(new Set(feeItems.map((r) => r.category || "-").filter(Boolean)));
    const statuses = Array.from(new Set(items.map((r) => r.status || "").filter(Boolean)));
    const collectStatuses = Array.from(new Set(items.map((r) => rateBusinessStatus(r, "collect")).filter(Boolean)));
    const payoutStatuses = Array.from(new Set(items.map((r) => rateBusinessStatus(r, "payout")).filter(Boolean)));
    return {
      id: `rate-group-${key}`,
      country: first.country,
      sheetName: first.sheetName,
      thirdParty: first.thirdParty,
      category: feeItems.length > 1 || categories.length > 1 ? `多类型 ${feeItems.length} 项` : (first.category || "-"),
      totalFee: joinUnique(feeItems.map((r) => r.totalFee)),
      collectFee: joinUnique(feeItems.map((r) => r.collectFee)),
      payoutFee: joinUnique(feeItems.map((r) => r.payoutFee)),
      collectSingleFee: joinUnique(feeItems.map((r) => r.collectSingleFee)),
      payoutSingleFee: joinUnique(feeItems.map((r) => r.payoutSingleFee)),
      collectLimit: joinUnique(feeItems.map((r) => r.collectLimit)),
      payoutLimit: joinUnique(feeItems.map((r) => r.payoutLimit)),
      collectStatus: collectStatuses.length ? collectStatuses.join(" + ") : "",
      payoutStatus: payoutStatuses.length ? payoutStatuses.join(" + ") : "",
      status: statuses.length === 1 ? statuses[0] : (statuses.length > 1 ? `多状态 ${statuses.length} 项` : ""),
      sourceOrder: Math.min(...items.map((item) => effectiveRateSourceRow(item))),
      rows: [...feeItems].sort(compareRateSourceOrder),
      multi: feeItems.length > 1 || categories.length > 1
    } satisfies RateGroupRow;
  }).sort((a, b) =>
    compareRateCountry(a.country, b.country)
    || compareRateSheets(a.sheetName, b.sheetName)
    || a.sourceOrder - b.sourceOrder
    || a.thirdParty.localeCompare(b.thirdParty, "zh-CN", { numeric: true, sensitivity: "base" })
  );
}

function RateSubTable({ rows }: { rows: ThirdPartyRateRow[] }) {
  return (
    <div className="rate-subtable-wrap">
      <div className="rate-subtable-title">子渠道 / 子类型费率明细</div>
      <table className="rate-subtable">
        <thead>
          <tr>
            <th>类型 / 钱包</th>
            <th>三方名称</th>
            <th>合计费率</th>
            <th>代收手续费</th>
            <th>代付手续费</th>
            <th>代收单笔</th>
            <th>代付单笔</th>
            <th>代收限制</th>
            <th>代付限制</th>
            <th>代收状态</th>
            <th>代付状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.category || "-"}</td>
              <td>{canonicalThirdPartyName(row.thirdParty, row.country) || row.thirdParty}</td>
              <td>{row.totalFee || "-"}</td>
              <td>{row.collectFee || "-"}</td>
              <td>{row.payoutFee || "-"}</td>
              <td>{row.collectSingleFee || "-"}</td>
              <td>{row.payoutSingleFee || "-"}</td>
              <td>{row.collectLimit || "-"}</td>
              <td>{row.payoutLimit || "-"}</td>
              <td><BusinessStatusCell value={rateBusinessStatus(row, "collect")} /></td>
              <td><BusinessStatusCell value={rateBusinessStatus(row, "payout")} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RateTable({ rows, totalRows = rows, sortState, onSort, onOpen }: { rows: ThirdPartyRateRow[]; totalRows?: ThirdPartyRateRow[]; sortState: SortState; onSort: (key: string) => void; onOpen: (row: ThirdPartyRateRow) => void }) {
  const grouped = useMemo(() => groupedRateRows(rows), [rows]);
  const totalGrouped = useMemo(() => groupedRateRows(totalRows), [totalRows]);
  const shownSummary = summarizeRateGroups(grouped);
  const allSummary = summarizeRateGroups(totalGrouped);
  if (!grouped.length) return <div className="empty">没有匹配的三方费率资料</div>;
  return (
    <div className="table-wrap rate-table-wrap tidy-main-rate-table">
      <table>
        <thead>
          <tr>
            <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />
            <SortableTh label="三方名称" sortKey="thirdParty" sortState={sortState} onSort={onSort} />
            <th>类型</th>
            <SortableTh label="合计费率" sortKey="totalFee" sortState={sortState} onSort={onSort} />
            <th>代收合计%+单笔</th>
            <th>代付合计%+单笔</th>
            <SortableTh label="代收范围" sortKey="collectLimit" sortState={sortState} onSort={onSort} />
            <SortableTh label="代付范围" sortKey="payoutLimit" sortState={sortState} onSort={onSort} />
            <th>代收状态</th>
            <th>代付状态</th>
            <th>查看</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map((row) => {
            const first = row.rows[0];
            return (
              <tr key={row.id}>
                <td><span className="country-pill">{row.country}</span></td>
                <td className="platform-cell main-party-name">{row.thirdParty}</td>
                <td className="type-cell">{row.category}</td>
                <td className="fee-cell total-fee-cell">{compactFeeCell(row.totalFee)}</td>
                <td className="fee-cell combined-fee-cell">{joinUnique(row.rows.map((item) => rateCombinedFee(item, "collect")))}</td>
                <td className="fee-cell combined-fee-cell">{joinUnique(row.rows.map((item) => rateCombinedFee(item, "payout")))}</td>
                <td className="fee-cell range-cell">{compactFeeCell(row.collectLimit)}</td>
                <td className="fee-cell range-cell">{compactFeeCell(row.payoutLimit)}</td>
                <td><BusinessStatusCell value={row.collectStatus} /></td>
                <td><BusinessStatusCell value={row.payoutStatus} /></td>
                <td className="action-cell"><button className="ghost-btn small" type="button" onClick={() => onOpen(first)}>查看</button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={9}>当前页汇总</td><td>{formatNumber(shownSummary.count)} 组</td><td className="muted-cell">多类型 {formatNumber(shownSummary.multi)} 组</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={9}>全部汇总</td><td>{formatNumber(allSummary.count)} 组</td><td className="muted-cell">多类型 {formatNumber(allSummary.multi)} 组</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function RateMultiSelect({ label, options, value, onChange, placeholder }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void; placeholder: string }) {
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
      if (target && boxRef.current && !boxRef.current.contains(target)) {
        setOpen(false);
      }
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

  function selectVisible() {
    onChange(uniq([...value, ...visibleOptions]));
  }

  function clearAll() {
    onChange([]);
    setKeyword("");
  }

  return (
    <div ref={boxRef} className="field multi-field rate-multi-field">
      <label>{label}</label>
      <button className="multi-button" type="button" onClick={() => setOpen((x) => !x)}>
        <span>{value.length ? filterLabel(value, placeholder) : placeholder}</span>
        <span className="multi-caret">▾</span>
      </button>
      {open && (
        <div className="multi-menu rate-multi-menu">
          <input className="multi-search" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={`搜索${label}`} />
          <div className="multi-actions">
            <button type="button" onClick={selectVisible}>全选当前</button>
            <button type="button" onClick={clearAll}>清空</button>
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
          
        </div>
      )}
    </div>
  );
}
