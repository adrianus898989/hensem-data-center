"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AutoWithdrawPayload, AutoWithdrawRow, DailyWithdrawRow, OperatorRow } from "@/lib/types";
import { formatDuration, formatNumber, formatPercent, parseDurationToSeconds } from "@/lib/format";
import { monthRangeSignature, monthlyApiUrl, rangeIncludesCurrentMonthClient } from "@/lib/monthRange";
import { fetchPreferredMonthlyStatus, payloadSnapshotMonth, statusMatchesPayload } from "@/lib/monthlyStatusClient";
import WorkOrderDashboard from "./WorkOrderDashboard";
import ThirdPartyVolumeDashboard from "./ThirdPartyVolumeDashboard";
import AdminControlCenter from "./AdminControlCenter";
import { useDashboardAuth } from "./DashboardAuthGate";
import { canOpenAdminCenter, hasDashboardPermission, normalizedManagementPermissions } from "@/lib/dashboardAuthClient";
import { aggregateAutoWithdrawByPlatform as aggregateByPlatform } from "@/lib/autoWithdrawComparison";
import { AutoWithdrawNotesProvider, AutoWithdrawReasonCell, AutoWithdrawNotesActions } from "./AutoWithdrawNotes";
import { AutoWithdrawReasonsProvider, AutoWithdrawReasonsButton, AutoWithdrawReasonsInlineRow, AutoWithdrawReasonsQueryButton } from "./AutoWithdrawReasons";
import { AutoWithdrawDailySummary } from "./AutoWithdrawDailySummary";

type LoadState = "idle" | "loading" | "ready" | "error";
type ModuleMode = "home" | "auto" | "operator" | "volume" | "work" | "admin";
type AutoView = "dashboard" | "summary" | "daily" | "month" | "compare" | "anomaly";
type OperatorView = "dashboard" | "ranking" | "summary" | "detail" | "low" | "date" | "compare";
type OperatorRankMode = "high" | "low";
type SortDirection = "asc" | "desc";
type TableSortState = { key: string; direction: SortDirection };
type SortTableName =
  | "autoSummary"
  | "autoDaily"
  | "autoCompare"
  | "operatorSummary"
  | "operatorDetail";
type TableSortMap = Record<SortTableName, TableSortState>;

type CsvColumn<T> = {
  label: string;
  value: (row: T) => string | number;
};

type FilterState = {
  countries: string[];
  platforms: string[];
  accounts: string[];
  startDate: string;
  endDate: string;
};

type OperatorPlatformDetail = {
  platform: string;
  processed: number;
  rejected: number;
};

type OperatorSummaryRow = OperatorRow & {
  platformCount: number;
  platformDetails: OperatorPlatformDetail[];
};

type OperatorDateSummaryRow = {
  title: string;
  processed: number;
  rejected: number;
  avgTime: string;
};

type AnomalyRow = AutoWithdrawRow & {
  reasons: string[];
  score: number;
};

type ConsistentLowRow = {
  key: string;
  account: string;
  country: string;
  avgProcessed: number;
  totalProcessed: number;
  hitDays: number;
  totalDays: number;
  platforms: string;
};

type ConsistentLowBucket = {
  window: number;
  totalDays: number;
  items: ConsistentLowRow[];
};

type ChartItem = {
  label: string;
  value: number;
  sub?: string;
};

type DetailModalState =
  | {
      kind: "auto-date";
      title: string;
      subtitle: string;
      rows: DailyWithdrawRow[];
    }
  | {
      kind: "operator-date" | "platform-operators";
      title: string;
      subtitle: string;
      rows: OperatorRow[];
      monthly?: boolean;
    };

type AutoListModalState =
  | { kind: "platform-rank"; title: string; subtitle: string; rows: AutoWithdrawRow[] }
  | { kind: "anomaly-rank"; title: string; subtitle: string; rows: AnomalyRow[] };

type CompareSummary = ReturnType<typeof summarize>;

type CountryCompareRow = {
  country: string;
  latest: CompareSummary;
  previous: CompareSummary;
  totalDiff: string;
  successDiff: string;
  manualDiff: string;
};

type CountryPlatformCountRow = {
  country: string;
  platforms: number;
  total: number;
  platformNames: string;
};

const EMPTY_FILTERS: FilterState = {
  countries: [],
  platforms: [],
  accounts: [],
  startDate: "",
  endDate: ""
};

const AUTO_PANE_ALL = "所有盘口";
const OPERATOR_PANE_ALL = "所有盘口";
const NPG_PANE_LABEL = "NPG盘口";
const PANGHU_BRAZIL_PANE_LABEL = "胖虎巴西盘口";

// V7P：提现/自动出款模块一进入就显示国家盘口，不再依赖“先查询出数据”才生成页签。
// 只影响自动出款 / 提现操作人，不修改三方量 / 三方费率。
const DEFAULT_AUTO_COUNTRY_PANES = [
  "印度盘口",
  "巴基斯坦盘口",
  "印尼盘口",
  "马来盘口",
  "缅甸盘口",
  "尼日利亚盘口",
  "越南盘口",
  "菲律宾盘口",
  PANGHU_BRAZIL_PANE_LABEL,
  NPG_PANE_LABEL,
  "巴西盘口"
];

function normalizePaneToken(value: string): string {
  return String(value || "").toLowerCase().replace(/[\s_\-\/\（）()]+/g, "");
}

function countryPaneLabelFor(country: string): string {
  const raw = String(country || "").trim();
  const x = normalizePaneToken(raw);
  if (!raw) return "其他盘口";
  if (x.includes("胖虎") || x.includes("panghu")) return PANGHU_BRAZIL_PANE_LABEL;
  if (x.includes("npg") || x.includes("哥伦比亚") || x.includes("colombia") || x.includes("墨西哥") || x.includes("mexico") || x.includes("智利") || x.includes("chile")) return NPG_PANE_LABEL;
  if (x.includes("巴西") || x === "br" || x.includes("brazil")) return "巴西盘口";
  if (x.includes("印度") || x === "in" || x.includes("india")) return "印度盘口";
  if (x.includes("印尼") || x.includes("印度尼西亚") || x === "id" || x.includes("indonesia")) return "印尼盘口";
  if (x.includes("巴基斯坦") || x === "pk" || x.includes("pakistan")) return "巴基斯坦盘口";
  if (x.includes("越南") || x === "vn" || x.includes("vietnam")) return "越南盘口";
  if (x.includes("马来") || x === "my" || x.includes("malaysia")) return "马来盘口";
  if (x.includes("缅甸") || x === "mm" || x.includes("myanmar")) return "缅甸盘口";
  if (x.includes("菲律宾") || x === "ph" || x.includes("philippines")) return "菲律宾盘口";
  if (x.includes("尼日利亚") || x === "ng" || x.includes("nigeria")) return "尼日利亚盘口";
  return raw.endsWith("盘口") ? raw : `${raw}盘口`;
}

function countryMatchesAutoPane(country: string, pane: string): boolean {
  if (!pane || pane === AUTO_PANE_ALL) return true;
  return countryPaneLabelFor(country) === pane;
}

function countryMatchesOperatorPane(country: string, pane: string): boolean {
  if (!pane || pane === OPERATOR_PANE_ALL) return true;
  return countryPaneLabelFor(country) === pane;
}

function sortAutoPanes(panes: string[]): string[] {
  const order = [
    "印度盘口", "巴基斯坦盘口", "印尼盘口", "马来盘口", "缅甸盘口", "尼日利亚盘口", "越南盘口", "菲律宾盘口", PANGHU_BRAZIL_PANE_LABEL, NPG_PANE_LABEL, "巴西盘口"
  ];
  return [...panes].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
  });
}
const DEFAULT_SORTS: TableSortMap = {
  autoSummary: { key: "total", direction: "desc" },
  autoDaily: { key: "date", direction: "desc" },
  autoCompare: { key: "total", direction: "desc" },
  operatorSummary: { key: "processed", direction: "desc" },
  operatorDetail: { key: "processed", direction: "desc" }
};

function parseComparePercent(value?: string): number {
  const n = Number(String(value || "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function sortRows<T>(rows: T[], sort: TableSortState, getValue: (row: T, key: string) => string | number): T[] {
  const list = [...rows];
  list.sort((a, b) => {
    const av = getValue(a, sort.key);
    const bv = getValue(b, sort.key);

    let result = 0;
    if (typeof av === "number" && typeof bv === "number") {
      result = av - bv;
    } else {
      result = String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN", { numeric: true, sensitivity: "base" });
    }

    return sort.direction === "asc" ? result : -result;
  });
  return list;
}

function getAutoSortValue(row: AutoWithdrawRow, key: string): string | number {
  switch (key) {
    case "country": return row.country;
    case "platform": return row.platform;
    case "total": return row.total;
    case "success": return row.success;
    case "rejected": return row.rejected;
    case "successRate": return row.successRate;
    case "rejectRate": return row.rejectRate;
    case "autoCount": return row.autoCount;
    case "manualCount": return row.manualCount;
    case "autoRate": return row.autoRate;
    case "manualRate": return row.manualRate;
    case "avgTime": return parseDurationToSeconds(row.avgTime);
    case "yesterdayAvgTime": return parseDurationToSeconds(row.yesterdayAvgTime);
    case "comparePercent": return parseComparePercent(row.comparePercent);
    default: return 0;
  }
}

function getDailySortValue(row: DailyWithdrawRow, key: string): string | number {
  if (key === "date") return row.date;
  return getAutoSortValue(row, key);
}

function getOperatorSummarySortValue(row: OperatorSummaryRow, key: string): string | number {
  switch (key) {
    case "country": return row.country;
    case "account": return row.account;
    case "platform": return row.platform;
    case "processed": return row.processed;
    case "rejected": return row.rejected;
    case "rejectRate": return row.processed ? row.rejected / row.processed : 0;
    case "avgTime": return parseDurationToSeconds(row.avgTime);
    default: return 0;
  }
}

function getOperatorSortValue(row: OperatorRow, key: string): string | number {
  switch (key) {
    case "country": return row.country;
    case "date": return row.date;
    case "platform": return row.platform;
    case "account": return row.account;
    case "processed": return row.processed;
    case "rejected": return row.rejected;
    case "avgTime": return parseDurationToSeconds(row.avgTime);
    case "yesterdayAvgTime": return parseDurationToSeconds(row.yesterdayAvgTime);
    case "comparePercent": return parseComparePercent(row.comparePercent);
    default: return 0;
  }
}


function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function isIsoDate(value: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value);
}

function currentIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isFutureIsoDate(value: string): boolean {
  return isIsoDate(value) && value > currentIsoDate();
}


function inDateRange(date: string, startDate: string, endDate: string): boolean {
  if (!isIsoDate(date)) return true;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function matchesSelection(value: string, selected: string[]): boolean {
  if (!selected.length) return true;
  return selected.includes(value);
}

function filterLabel(values: string[], allText = "全部"): string {
  if (!values.length) return allText;
  if (values.length <= 2) return values.join("、");
  return `${values.slice(0, 2).join("、")} 等 ${values.length} 项`;
}

function weightedAvgTime(rows: AutoWithdrawRow[]): string {
  let totalWeight = 0;
  let totalSeconds = 0;
  for (const row of rows) {
    const weight = row.total || row.success + row.rejected || 0;
    const seconds = parseDurationToSeconds(row.avgTime);
    if (weight > 0 && seconds > 0) {
      totalWeight += weight;
      totalSeconds += weight * seconds;
    }
  }
  return formatDuration(totalWeight ? totalSeconds / totalWeight : 0);
}

function summarize(rows: AutoWithdrawRow[]) {
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const success = rows.reduce((sum, r) => sum + r.success, 0);
  const rejected = rows.reduce((sum, r) => sum + r.rejected, 0);
  const autoCount = rows.reduce((sum, r) => sum + r.autoCount, 0);
  const manualCount = rows.reduce((sum, r) => sum + r.manualCount, 0);
  return {
    total,
    success,
    rejected,
    autoCount,
    manualCount,
    successRate: total ? success / total : 0,
    rejectRate: total ? rejected / total : 0,
    autoRate: total ? autoCount / total : 0,
    manualRate: total ? manualCount / total : 0,
    avgTime: weightedAvgTime(rows)
  };
}

function summarizeOperators(rows: OperatorRow[]) {
  const totalProcessed = rows.reduce((sum, r) => sum + r.processed, 0);
  const totalRejected = rows.reduce((sum, r) => sum + r.rejected, 0);
  const uniqueAccounts = new Set(rows.map((r) => `${r.country}|||${r.account}`)).size;
  const uniquePlatforms = new Set(rows.map((r) => `${r.country}|||${r.platform}`)).size;
  let totalWeight = 0;
  let totalSeconds = 0;

  for (const row of rows) {
    const weight = row.processed || 0;
    const seconds = parseDurationToSeconds(row.avgTime);
    if (weight > 0 && seconds > 0) {
      totalWeight += weight;
      totalSeconds += weight * seconds;
    }
  }

  return {
    totalProcessed,
    totalRejected,
    uniqueAccounts,
    uniquePlatforms,
    avgTime: formatDuration(totalWeight ? totalSeconds / totalWeight : 0),
    rejectRate: totalProcessed ? totalRejected / totalProcessed : 0
  };
}

function topRows<T>(rows: T[], value: (row: T) => number, limit = 6): T[] {
  return [...rows].sort((a, b) => value(b) - value(a)).slice(0, limit);
}

function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = Math.max(0, (page - 1) * pageSize);
  return rows.slice(start, start + pageSize);
}

function aggregateByDate(rows: DailyWithdrawRow[]): AutoWithdrawRow[] {
  const map = new Map<string, AutoWithdrawRow & { date: string; _seconds: number; _weight: number }>();

  for (const row of rows) {
    const key = `${row.date}|||${row.country}`;
    const weight = row.total || row.success + row.rejected || 0;
    const seconds = parseDurationToSeconds(row.avgTime);
    const current = map.get(key);

    if (!current) {
      map.set(key, {
        ...row,
        platform: "全部盘口",
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
    .map(({ _seconds, _weight, date, ...row }) => ({
      ...row,
      platform: `${date} ${row.country} 汇总`,
      successRate: row.total ? row.success / row.total : 0,
      rejectRate: row.total ? row.rejected / row.total : 0,
      autoRate: row.total ? row.autoCount / row.total : 0,
      manualRate: row.total ? row.manualCount / row.total : 0,
      avgTime: formatDuration(_weight ? _seconds / _weight : 0)
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));
}

function aggregateDailyByMonth(rows: DailyWithdrawRow[]): DailyWithdrawRow[] {
  const map = new Map<string, DailyWithdrawRow & { _seconds: number; _weight: number }>();

  for (const row of rows) {
    const month = isIsoDate(row.date) ? row.date.slice(0, 7) : row.date;
    const key = `${month}|||${row.country}|||${row.platform}|||${row.sourceSheet}`;
    const weight = row.total || row.success + row.rejected || 0;
    const seconds = parseDurationToSeconds(row.avgTime);
    const current = map.get(key);

    if (!current) {
      map.set(key, {
        ...row,
        date: month,
        blockTitle: `${month} 月汇总`,
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
    .sort((a, b) => b.date.localeCompare(a.date) || b.total - a.total);
}

function aggregateOperators(rows: OperatorRow[]): OperatorSummaryRow[] {
  const map = new Map<string, OperatorSummaryRow & { _seconds: number; _weight: number; _platforms: Set<string>; _platformStats: Map<string, { processed: number; rejected: number }> }>();

  for (const row of rows) {
    const key = `${row.country}|||${row.account}`;
    const seconds = parseDurationToSeconds(row.avgTime);
    const weight = row.processed || 0;
    const current = map.get(key);

    if (!current) {
      map.set(key, {
        ...row,
        platform: row.platform,
        processed: row.processed,
        rejected: row.rejected,
        avgTime: "0秒",
        yesterdayAvgTime: "-",
        comparePercent: "-",
        platformCount: row.platform ? 1 : 0,
        platformDetails: [],
        _seconds: seconds > 0 && weight > 0 ? seconds * weight : 0,
        _weight: seconds > 0 && weight > 0 ? weight : 0,
        _platforms: new Set(row.platform ? [row.platform] : []),
        _platformStats: new Map(row.platform ? [[row.platform, { processed: row.processed, rejected: row.rejected }]] : [])
      });
      continue;
    }

    current.processed += row.processed;
    current.rejected += row.rejected;
    if (row.platform) {
      current._platforms.add(row.platform);
      const stat = current._platformStats.get(row.platform) || { processed: 0, rejected: 0 };
      stat.processed += row.processed;
      stat.rejected += row.rejected;
      current._platformStats.set(row.platform, stat);
    }
    if (seconds > 0 && weight > 0) {
      current._seconds += seconds * weight;
      current._weight += weight;
    }
  }

  return Array.from(map.values())
    .map(({ _seconds, _weight, _platforms, _platformStats, ...row }) => ({
      ...row,
      platformCount: _platforms.size,
      platform: _platforms.size === 1 ? Array.from(_platforms)[0] : `${_platforms.size} 个平台`,
      platformDetails: Array.from(_platformStats.entries())
        .map(([platform, stat]) => ({ platform, processed: stat.processed, rejected: stat.rejected }))
        .sort((a, b) => b.processed - a.processed || a.platform.localeCompare(b.platform, "zh-CN")),
      avgTime: formatDuration(_weight ? _seconds / _weight : 0)
    }))
    .sort((a, b) => b.processed - a.processed);
}

function aggregateOperatorByDate(rows: OperatorRow[]): OperatorDateSummaryRow[] {
  const map = new Map<string, { date: string; country: string; processed: number; rejected: number; _seconds: number; _weight: number }>();

  for (const row of rows) {
    const key = `${row.date}|||${row.country}`;
    const seconds = parseDurationToSeconds(row.avgTime);
    const weight = row.processed || 0;
    const current = map.get(key);

    if (!current) {
      map.set(key, {
        date: row.date,
        country: row.country,
        processed: row.processed,
        rejected: row.rejected,
        _seconds: seconds > 0 && weight > 0 ? seconds * weight : 0,
        _weight: seconds > 0 && weight > 0 ? weight : 0
      });
      continue;
    }

    current.processed += row.processed;
    current.rejected += row.rejected;
    if (seconds > 0 && weight > 0) {
      current._seconds += seconds * weight;
      current._weight += weight;
    }
  }

  return Array.from(map.values())
    .map((row) => ({
      title: `${row.date} ${row.country}`,
      processed: row.processed,
      rejected: row.rejected,
      avgTime: formatDuration(row._weight ? row._seconds / row._weight : 0)
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function makeAlerts(rows: AutoWithdrawRow[]): string[] {
  const alerts: string[] = [];
  const sorted = [...rows].sort((a, b) => b.rejected - a.rejected);

  for (const row of sorted) {
    if (alerts.length >= 5) break;
    if (row.total <= 0) continue;

    if (row.rejectRate >= 0.12) {
      alerts.push(`${row.country} ${row.platform} 驳回率 ${formatPercent(row.rejectRate)}，建议检查三方/自动出款状态。`);
      continue;
    }

    if (row.successRate < 0.9) {
      alerts.push(`${row.country} ${row.platform} 成功率 ${formatPercent(row.successRate)}，低于 90%。`);
      continue;
    }

    if (row.manualRate >= 0.6) {
      alerts.push(`${row.country} ${row.platform} 人工处理占比 ${formatPercent(row.manualRate)}，自动出款占比偏低。`);
      continue;
    }

    if (parseDurationToSeconds(row.avgTime) >= 3 * 3600) {
      alerts.push(`${row.country} ${row.platform} 平均处理时间 ${row.avgTime}，处理时长偏高。`);
    }
  }

  return alerts;
}

function buildAnomalyRows(rows: AutoWithdrawRow[]): AnomalyRow[] {
  return rows
    .map((row) => {
      const reasons: string[] = [];
      let score = 0;

      if (row.successRate < 0.9) {
        reasons.push(`成功率 ${formatPercent(row.successRate)}`);
        score += (0.9 - row.successRate) * 100;
      }
      if (row.rejectRate >= 0.12) {
        reasons.push(`驳回率 ${formatPercent(row.rejectRate)}`);
        score += row.rejectRate * 100;
      }
      if (row.autoRate < 0.5) {
        reasons.push(`自动占比 ${formatPercent(row.autoRate)}`);
        score += (0.5 - row.autoRate) * 100;
      }

      if (!reasons.length) return null;
      return { ...row, reasons, score };
    })
    .filter((row): row is AnomalyRow => !!row)
    .sort((a, b) => b.score - a.score || b.total - a.total);
}

function buildLatestVsPrevious(rows: DailyWithdrawRow[]) {
  const dates = uniq(rows.map((row) => row.date)).filter(isIsoDate).sort();
  const latestDate = dates[dates.length - 1] || "";
  const previousDate = dates[dates.length - 2] || "";
  const latestRows = latestDate ? rows.filter((row) => row.date === latestDate) : [];
  const previousRows = previousDate ? rows.filter((row) => row.date === previousDate) : [];
  const latest = summarize(latestRows);
  const previous = summarize(previousRows);

  function diff(now: number, prev: number): string {
    if (!prev) return "-";
    const value = ((now - prev) / prev) * 100;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  }

  return {
    latestDate,
    previousDate,
    totalDiff: diff(latest.total, previous.total),
    successDiff: diff(latest.successRate, previous.successRate),
    manualDiff: diff(latest.manualRate, previous.manualRate),
    latest,
    previous
  };
}

function buildCountryLatestCompare(rows: DailyWithdrawRow[]): CountryCompareRow[] {
  const dates = uniq(rows.map((row) => row.date)).filter(isIsoDate).sort();
  const latestDate = dates[dates.length - 1] || "";
  const previousDate = dates[dates.length - 2] || "";
  if (!latestDate || !previousDate) return [];

  function diff(now: number, prev: number): string {
    if (!prev) return "-";
    const value = ((now - prev) / prev) * 100;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  }

  const countries = uniq(rows.map((row) => row.country));
  return countries.map((country) => {
    const latest = summarize(rows.filter((row) => row.country === country && row.date === latestDate));
    const previous = summarize(rows.filter((row) => row.country === country && row.date === previousDate));
    return {
      country,
      latest,
      previous,
      totalDiff: diff(latest.total, previous.total),
      successDiff: diff(latest.successRate, previous.successRate),
      manualDiff: diff(latest.manualRate, previous.manualRate)
    };
  }).filter((row) => row.latest.total || row.previous.total).sort((a, b) => b.latest.total - a.latest.total || a.country.localeCompare(b.country, "zh-CN"));
}

function buildConsistentLowBuckets(rows: OperatorRow[]): ConsistentLowBucket[] {
  const dates = uniq(rows.map((row) => row.date)).filter(isIsoDate).sort();
  const windows = [3, 7, 30];

  return windows.map((window) => {
    const recentDates = dates.slice(-window);
    if (!recentDates.length) return { window, totalDays: 0, items: [] };

    const hitMap = new Map<string, ConsistentLowRow>();

    for (const date of recentDates) {
      const dayRows = rows.filter((row) => row.date === date);
      const accountMap = new Map<string, { account: string; country: string; processed: number; platforms: Set<string> }>();

      for (const row of dayRows) {
        const key = `${row.country}|||${row.account}`;
        const current = accountMap.get(key);
        if (!current) {
          accountMap.set(key, {
            account: row.account,
            country: row.country,
            processed: row.processed,
            platforms: new Set(row.platform ? [row.platform] : [])
          });
        } else {
          current.processed += row.processed;
          if (row.platform) current.platforms.add(row.platform);
        }
      }

      const dayAccounts = Array.from(accountMap.entries())
        .map(([key, item]) => ({ key, ...item, platforms: Array.from(item.platforms).join("、") }))
        .sort((a, b) => a.processed - b.processed || a.account.localeCompare(b.account, "zh-CN"));

      if (!dayAccounts.length) continue;
      const thresholdIndex = Math.min(dayAccounts.length, Math.max(1, Math.min(3, dayAccounts.length))) - 1;
      const threshold = dayAccounts[thresholdIndex]?.processed ?? dayAccounts[0].processed;
      const lows = dayAccounts.filter((item) => item.processed <= threshold);

      for (const item of lows) {
        const current = hitMap.get(item.key);
        if (!current) {
          hitMap.set(item.key, {
            key: item.key,
            account: item.account,
            country: item.country,
            avgProcessed: item.processed,
            totalProcessed: item.processed,
            hitDays: 1,
            totalDays: recentDates.length,
            platforms: item.platforms
          });
        } else {
          current.hitDays += 1;
          current.totalProcessed += item.processed;
          current.avgProcessed = current.totalProcessed / current.hitDays;
          if (item.platforms) {
            const merged = uniq([...current.platforms.split("、").filter(Boolean), ...item.platforms.split("、").filter(Boolean)]);
            current.platforms = merged.join("、");
          }
        }
      }
    }

    const all = Array.from(hitMap.values())
      .map((item) => ({ ...item, avgProcessed: item.hitDays ? item.totalProcessed / item.hitDays : 0 }))
      .sort((a, b) => b.hitDays - a.hitDays || a.avgProcessed - b.avgProcessed || a.account.localeCompare(b.account, "zh-CN"));

    const exact = all.filter((item) => item.hitDays === recentDates.length);
    return {
      window,
      totalDays: recentDates.length,
      items: (exact.length ? exact : all).slice(0, 6)
    };
  });
}


function buildConsistentLowRows(rows: OperatorRow[], windowValue: string): { label: string; totalDays: number; rows: ConsistentLowRow[] } {
  const dates = uniq(rows.map((row) => row.date)).filter(isIsoDate).sort();
  const windowNumber = windowValue === "range" ? 0 : Number(windowValue);
  const recentDates = windowNumber > 0 ? dates.slice(-windowNumber) : dates;
  const label = windowNumber > 0 ? `近 ${windowNumber} 天` : "当前筛选区间";
  if (!recentDates.length) return { label, totalDays: 0, rows: [] };
  const hitMap = new Map<string, ConsistentLowRow>();
  for (const date of recentDates) {
    const dayRows = rows.filter((row) => row.date === date);
    const accountMap = new Map<string, { account: string; country: string; processed: number; platforms: Set<string> }>();
    for (const row of dayRows) {
      const key = `${row.country}|||${row.account}`;
      const current = accountMap.get(key);
      if (!current) {
        accountMap.set(key, { account: row.account, country: row.country, processed: row.processed, platforms: new Set(row.platform ? [row.platform] : []) });
      } else {
        current.processed += row.processed;
        if (row.platform) current.platforms.add(row.platform);
      }
    }
    const dayAccounts = Array.from(accountMap.entries())
      .map(([key, item]) => ({ key, ...item, platforms: Array.from(item.platforms).join("、") }))
      .sort((a, b) => a.processed - b.processed || a.account.localeCompare(b.account, "zh-CN"));
    if (!dayAccounts.length) continue;
    const thresholdIndex = Math.min(dayAccounts.length, Math.max(1, Math.min(3, dayAccounts.length))) - 1;
    const threshold = dayAccounts[thresholdIndex]?.processed ?? dayAccounts[0].processed;
    const lows = dayAccounts.filter((item) => item.processed <= threshold);
    for (const item of lows) {
      const current = hitMap.get(item.key);
      if (!current) {
        hitMap.set(item.key, { key: item.key, account: item.account, country: item.country, avgProcessed: item.processed, totalProcessed: item.processed, hitDays: 1, totalDays: recentDates.length, platforms: item.platforms });
      } else {
        current.hitDays += 1;
        current.totalProcessed += item.processed;
        current.avgProcessed = current.totalProcessed / current.hitDays;
        if (item.platforms) {
          const merged = uniq([...current.platforms.split("、").filter(Boolean), ...item.platforms.split("、").filter(Boolean)]);
          current.platforms = merged.join("、");
        }
      }
    }
  }
  const all = Array.from(hitMap.values())
    .map((item) => ({ ...item, avgProcessed: item.hitDays ? item.totalProcessed / item.hitDays : 0 }))
    .sort((a, b) => b.hitDays - a.hitDays || a.avgProcessed - b.avgProcessed || a.account.localeCompare(b.account, "zh-CN"));
  const exact = all.filter((item) => item.hitDays === recentDates.length);
  return { label, totalDays: recentDates.length, rows: exact.length ? exact : all };
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

function blankFilters(startDate = "", endDate = ""): FilterState {
  return {
    countries: [],
    platforms: [],
    accounts: [],
    startDate,
    endDate
  };
}

const AUTO_WITHDRAW_CACHE_KEY = "hensem:last-good:auto-withdraw:v238-current";

function readAutoLocalCache(): AutoWithdrawPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const text = window.localStorage.getItem(AUTO_WITHDRAW_CACHE_KEY);
    return text ? JSON.parse(text) as AutoWithdrawPayload : null;
  } catch { return null; }
}

function writeAutoLocalCache(payload: AutoWithdrawPayload) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(AUTO_WITHDRAW_CACHE_KEY, JSON.stringify(payload)); } catch { /* 缓存失败不影响页面 */ }
}

type DashboardGlyphName = "home" | "cash" | "ticket" | "chart" | "settings" | "user" | "arrow";

function DashboardGlyph({ name }: { name: DashboardGlyphName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
      {name === "home" && <><path d="M3 10.8 12 3l9 7.8" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6" /></>}
      {name === "cash" && <><rect x="3" y="5" width="18" height="12" rx="2.5" /><path d="M7 9h.01M17 13h.01M9 21h8M12 8.5c-1.4 0-2.5.8-2.5 2s1.1 2 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2" /></>}
      {name === "ticket" && <><path d="M5 4h14a2 2 0 0 1 2 2v3a3 3 0 0 0 0 6v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a3 3 0 0 0 0-6V6a2 2 0 0 1 2-2Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>}
      {name === "chart" && <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /><path d="m4 7 6-4 6 6 5-5" /></>}
      {name === "settings" && <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1H3v-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.52V3h4v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.52 1H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>}
      {name === "user" && <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>}
      {name === "arrow" && <><path d="M5 12h14M14 7l5 5-5 5" /></>}
    </svg>
  );
}

export default function Dashboard() {
  const { session, profile, openProfile } = useDashboardAuth();
  const canThirdParty = hasDashboardPermission(profile, "third_party");
  const canAutoWithdraw = hasDashboardPermission(profile, "auto_withdraw");
  const canWorkSupport =
    hasDashboardPermission(profile, "work_orders") ||
    hasDashboardPermission(profile, "customer_service");
  const managementPermissions = normalizedManagementPermissions(profile);
  const isOwner = profile?.role === "owner";
  const canAdminUsers = Boolean(profile && (isOwner || managementPermissions.manage_viewers));
  const canAdminData = Boolean(profile && (isOwner || managementPermissions.refresh_data));
  const canAdminAudit = Boolean(profile && (isOwner || managementPermissions.view_audit));
  const [state, setState] = useState<LoadState>("idle");
  const [payload, setPayload] = useState<AutoWithdrawPayload | null>(null);
  const [hasBusinessQueried, setHasBusinessQueried] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [activeModule, setActiveModule] = useState<ModuleMode>("home");
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [adminSection, setAdminSection] = useState<"users" | "data" | "audit">("users");
  const [autoView, setAutoView] = useState<AutoView>("daily");
  const [autoCountryPane, setAutoCountryPane] = useState<string>("");
  const [operatorCountryPane, setOperatorCountryPane] = useState<string>("");
  const [operatorView, setOperatorView] = useState<OperatorView>("summary");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sorts, setSorts] = useState<TableSortMap>(DEFAULT_SORTS);
  const [operatorRankMode, setOperatorRankMode] = useState<OperatorRankMode>("high");
  const [operatorDateFilter, setOperatorDateFilter] = useState<string>("all");
  const [lowWindow, setLowWindow] = useState<string>("range");
  const [lowLimit, setLowLimit] = useState(20);
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null);
  const [autoListModal, setAutoListModal] = useState<AutoListModalState | null>(null);
  const [showFullPlatformRank, setShowFullPlatformRank] = useState(false);
  const [showFullAnomalyRank, setShowFullAnomalyRank] = useState(false);
  const loadedMonthSignatureRef = useRef("");
  const payloadRef = useRef<AutoWithdrawPayload | null>(null);

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

  useEffect(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    const next = blankFilters(key, key);
    setFilters((prev) => prev.startDate || prev.endDate ? prev : next);
    setDraftFilters((prev) => prev.startDate || prev.endDate ? prev : next);
  }, []);


  useEffect(() => {
    const openAdmin = () => {
      if (!profile || !canOpenAdminCenter(profile)) return;
      setAdminExpanded(true);
      const first = canAdminUsers ? "users" : canAdminData ? "data" : "audit";
      setAdminSection(first);
      setActiveModule("admin");
    };
    window.addEventListener("hensem:open-admin", openAdmin as EventListener);
    return () => window.removeEventListener("hensem:open-admin", openAdmin as EventListener);
  }, [profile, canAdminUsers, canAdminData, canAdminAudit]);

  async function loadData(silent = false, requestedStart = "", requestedEnd = "", version = "") {
    if (!silent) setState("loading");
    setError("");
    try {
      const requestUrl = monthlyApiUrl("/api/auto-withdraw", requestedStart, requestedEnd, version);
      const authHeaders = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
      const res = await fetch(requestUrl, { cache: "no-store", headers: authHeaders });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "读取数据失败");
      setPayload(json);
      payloadRef.current = json;
      loadedMonthSignatureRef.current = monthRangeSignature(requestedStart, requestedEnd);
      if (rangeIncludesCurrentMonthClient(requestedStart, requestedEnd)) writeAutoLocalCache(json);
      setState("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "读取数据失败";
      if (silent) {
        setError(message);
        setState("ready");
        return;
      }
      setError(message);
      setState("error");
    }
  }

  useEffect(() => {
    if (!hasBusinessQueried || !payload) return;
    if (activeModule !== "auto" && activeModule !== "operator") return;
    const currentTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !rangeIncludesCurrentMonthClient(filters.startDate, filters.endDate)) return;
      // 只有用户主动查询过后，才静默刷新当前已查询区间。
      void loadData(true, filters.startDate, filters.endDate);
    }, 10 * 60 * 1000);
    return () => window.clearInterval(currentTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModule, filters.startDate, filters.endDate, hasBusinessQueried, payload]);

  // V166：打开网站先进入“选择模块”首页；费率表全局直读重构。
  // 点击“提现/自动出款统计”或“提现操作人统计”后，才调用 loadData()。

  const allDates = useMemo(() => {
    if (!payload) return [];
    return uniq([
      ...payload.dailyRows.map((r) => r.date),
      ...payload.operatorRows.map((r) => r.date)
    ]).filter((date) => isIsoDate(date) && !isFutureIsoDate(date));
  }, [payload]);

  useEffect(() => {
    if (!payload) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = formatDateKey(yesterday);
    // 默认优先显示表格里已经成功同步的最新日期。
    // 如果昨天数据还没写入，不要默认卡在昨天导致页面看起来 0。
    const latestAvailableDate = allDates.filter((date) => date <= yesterdayKey).sort().pop();
    const defaultDate = latestAvailableDate || yesterdayKey;

    setFilters((prev) => {
      if (prev.startDate || prev.endDate) return prev;
      return blankFilters(defaultDate, defaultDate);
    });
    setDraftFilters((prev) => {
      if (prev.startDate || prev.endDate) return prev;
      return blankFilters(defaultDate, defaultDate);
    });
  }, [payload, allDates]);

  const countries = useMemo(() => {
    if (!payload) return [];
    return uniq([
      ...payload.monthlyRows.map((r) => r.country),
      ...payload.dailyRows.map((r) => r.country),
      ...payload.operatorRows.map((r) => r.country)
    ]);
  }, [payload]);

  const autoCountryPanes = useMemo(() => {
    const autoCountries = payload ? uniq([
      ...payload.monthlyRows.map((r) => r.country),
      ...payload.dailyRows.map((r) => r.country)
    ]) : [];
    return sortAutoPanes(uniq([
      ...DEFAULT_AUTO_COUNTRY_PANES,
      ...autoCountries.map(countryPaneLabelFor)
    ]));
  }, [payload]);

  const operatorCountryPanes = useMemo(() => {
    const operatorCountries = payload ? uniq(payload.operatorRows.map((r) => r.country)) : [];
    return sortAutoPanes(uniq([
      ...DEFAULT_AUTO_COUNTRY_PANES,
      ...operatorCountries.map(countryPaneLabelFor)
    ]));
  }, [payload]);

  useEffect(() => {
    if (!autoCountryPanes.length) return;
    if (!autoCountryPane || autoCountryPane === AUTO_PANE_ALL || !autoCountryPanes.includes(autoCountryPane)) {
      setAutoCountryPane(autoCountryPanes[0]);
    }
  }, [autoCountryPanes, autoCountryPane]);

  useEffect(() => {
    if (!operatorCountryPanes.length) return;
    if (!operatorCountryPane || operatorCountryPane === OPERATOR_PANE_ALL || !operatorCountryPanes.includes(operatorCountryPane)) {
      setOperatorCountryPane(operatorCountryPanes[0]);
    }
  }, [operatorCountryPanes, operatorCountryPane]);

  const platformOptions = useMemo(() => {
    if (!payload) return [];
    const sourceRows = activeModule === "operator"
      ? payload.operatorRows.filter((r) => countryMatchesOperatorPane(r.country, operatorCountryPane))
      : [...payload.monthlyRows, ...payload.dailyRows].filter((r) => countryMatchesAutoPane(r.country, autoCountryPane));
    return uniq(sourceRows.map((r) => r.platform));
  }, [payload, activeModule, operatorCountryPane, autoCountryPane]);

  const accountOptions = useMemo(() => {
    if (!payload) return [];
    return uniq(payload.operatorRows
      .filter((r) => countryMatchesOperatorPane(r.country, operatorCountryPane))
      .filter((r) => matchesSelection(r.platform, draftFilters.platforms))
      .map((r) => r.account));
  }, [payload, operatorCountryPane, draftFilters.platforms]);

  const filteredDailyRows = useMemo(() => {
    if (!payload) return [];
    return payload.dailyRows.filter((row) => {
      if (!countryMatchesAutoPane(row.country, autoCountryPane)) return false;
      if (!matchesSelection(row.platform, filters.platforms)) return false;
      if (!inDateRange(row.date, filters.startDate, filters.endDate)) return false;
      return true;
    });
  }, [payload, filters, autoCountryPane]);

  const summaryRows = useMemo(() => {
    if (!payload) return [];
    if (payload.dailyRows.length) return aggregateByPlatform(filteredDailyRows);
    return payload.monthlyRows.filter((row) => {
      if (!countryMatchesAutoPane(row.country, autoCountryPane)) return false;
      if (!matchesSelection(row.platform, filters.platforms)) return false;
      return true;
    });
  }, [payload, filteredDailyRows, filters, autoCountryPane]);

  const operatorRows = useMemo(() => {
    if (!payload) return [];
    return payload.operatorRows.filter((row) => {
      if (!countryMatchesOperatorPane(row.country, operatorCountryPane)) return false;
      if (!matchesSelection(row.platform, filters.platforms)) return false;
      if (!matchesSelection(row.account, filters.accounts)) return false;
      if (!inDateRange(row.date, filters.startDate, filters.endDate)) return false;
      return true;
    });
  }, [payload, filters, operatorCountryPane]);

  const summary = useMemo(() => summarize(summaryRows), [summaryRows]);
  const operatorSummary = useMemo(() => summarizeOperators(operatorRows), [operatorRows]);
  const operatorSummaryRows = useMemo(() => aggregateOperators(operatorRows), [operatorRows]);
  const sortedSummaryRows = useMemo(() => sortRows(summaryRows, sorts.autoSummary, getAutoSortValue), [summaryRows, sorts.autoSummary]);
  const monthlyDailyRows = useMemo(() => aggregateDailyByMonth(filteredDailyRows), [filteredDailyRows]);
  const sortedDailyRows = useMemo(() => sortRows(filteredDailyRows, sorts.autoDaily, getDailySortValue), [filteredDailyRows, sorts.autoDaily]);
  const sortedMonthlyRows = useMemo(() => sortRows(monthlyDailyRows, sorts.autoDaily, getDailySortValue), [monthlyDailyRows, sorts.autoDaily]);
  const sortedCompareRows = useMemo(() => sortRows(summaryRows, sorts.autoCompare, getAutoSortValue), [summaryRows, sorts.autoCompare]);
  const sortedOperatorSummaryRows = useMemo(() => sortRows(operatorSummaryRows, sorts.operatorSummary, getOperatorSummarySortValue), [operatorSummaryRows, sorts.operatorSummary]);
  const sortedOperatorRows = useMemo(() => sortRows(operatorRows, sorts.operatorDetail, getOperatorSortValue), [operatorRows, sorts.operatorDetail]);
  const topPlatforms = useMemo(() => topRows(summaryRows, (r) => r.total, 6), [summaryRows]);
  const topOperators = useMemo(() => topRows(operatorSummaryRows, (r) => r.processed, 6), [operatorSummaryRows]);
  const lowOperatorRows = useMemo(() => [...operatorSummaryRows].filter((r) => r.processed > 0).sort((a, b) => a.processed - b.processed), [operatorSummaryRows]);
  const lowOperators = useMemo(() => lowOperatorRows.slice(0, 6), [lowOperatorRows]);
  const operatorRankingRows = useMemo(() => operatorRankMode === "high" ? operatorSummaryRows : lowOperatorRows, [operatorRankMode, operatorSummaryRows, lowOperatorRows]);
  const operatorCountryProcessedMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of operatorSummaryRows) {
      map.set(row.country, (map.get(row.country) || 0) + row.processed);
    }
    return map;
  }, [operatorSummaryRows]);
  const dateSummaryRows = useMemo(() => aggregateByDate(filteredDailyRows), [filteredDailyRows]);
  const operatorDateSummaryRows = useMemo(() => aggregateOperatorByDate(operatorRows), [operatorRows]);
  const operatorDateOptions = useMemo(() => uniq(operatorRows.map((row) => row.date)).filter(isIsoDate).sort(), [operatorRows]);
  const filteredOperatorDateSummaryRows = useMemo(() => {
    if (operatorDateFilter === "all") return operatorDateSummaryRows;
    return operatorDateSummaryRows.filter((row) => row.title.startsWith(operatorDateFilter));
  }, [operatorDateSummaryRows, operatorDateFilter]);
  const alerts = useMemo(() => makeAlerts(summaryRows), [summaryRows]);
  const anomalyRows = useMemo(() => buildAnomalyRows(summaryRows), [summaryRows]);
  const latestCompare = useMemo(() => buildLatestVsPrevious(filteredDailyRows), [filteredDailyRows]);
  const lowConsistencyBuckets = useMemo(() => buildConsistentLowBuckets(operatorRows), [operatorRows]);
  const selectedLowConsistency = useMemo(() => buildConsistentLowRows(operatorRows, lowWindow), [operatorRows, lowWindow]);
  const visibleLowConsistencyRows = useMemo(() => selectedLowConsistency.rows.slice(0, lowLimit), [selectedLowConsistency.rows, lowLimit]);
  const countryAutoManualRows = useMemo(() => {
    const map = new Map<string, { country: string; auto: number; manual: number; total: number }>();
    for (const row of summaryRows) {
      const current = map.get(row.country) || { country: row.country, auto: 0, manual: 0, total: 0 };
      current.auto += row.autoCount;
      current.manual += row.manualCount;
      current.total += row.total;
      map.set(row.country, current);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total || a.country.localeCompare(b.country, "zh-CN"));
  }, [summaryRows]);
  const countryCompareRows = useMemo(() => buildCountryLatestCompare(filteredDailyRows), [filteredDailyRows]);
  const countryPlatformCountRows = useMemo<CountryPlatformCountRow[]>(() => {
    const map = new Map<string, { country: string; platforms: Set<string>; total: number }>();
    for (const row of summaryRows) {
      const current = map.get(row.country) || { country: row.country, platforms: new Set<string>(), total: 0 };
      if (row.platform) current.platforms.add(row.platform);
      current.total += row.total;
      map.set(row.country, current);
    }
    return Array.from(map.values()).map((row) => ({
      country: row.country,
      platforms: row.platforms.size,
      total: row.total,
      platformNames: Array.from(row.platforms).join("、")
    })).sort((a, b) => b.platforms - a.platforms || b.total - a.total || a.country.localeCompare(b.country, "zh-CN"));
  }, [summaryRows]);
  const activeDayCount = useMemo(
    () => Math.max(1, uniq(filteredDailyRows.map((row) => row.date)).length || 1),
    [filteredDailyRows]
  );
  const dailyAverageTotal = useMemo(() => summary.total / activeDayCount, [summary.total, activeDayCount]);
  const dailyAverageManual = useMemo(() => summary.manualCount / activeDayCount, [summary.manualCount, activeDayCount]);
  const operatorActiveDayCount = useMemo(() => Math.max(1, uniq(operatorRows.map((row) => row.date)).length || 1), [operatorRows]);
  const operatorDailyAverageProcessed = useMemo(() => operatorSummary.totalProcessed / operatorActiveDayCount, [operatorSummary.totalProcessed, operatorActiveDayCount]);
  const operatorDailyAverageRejected = useMemo(() => operatorSummary.totalRejected / operatorActiveDayCount, [operatorSummary.totalRejected, operatorActiveDayCount]);

  const totalChartItems = useMemo<ChartItem[]>(() => topRows(summaryRows, (r) => r.total, 10).map((r) => ({
    label: `${r.country} ${r.platform}`,
    value: r.total,
    sub: `成功率 ${formatPercent(r.successRate)}`
  })), [summaryRows]);

  const successChartItems = useMemo<ChartItem[]>(() => topRows(summaryRows, (r) => r.total, 10).map((r) => ({
    label: `${r.country} ${r.platform}`,
    value: r.successRate * 100,
    sub: `驳回 ${formatPercent(r.rejectRate)}`
  })), [summaryRows]);

  const compareTotalChartItems = useMemo<ChartItem[]>(() => summaryRows.map((r) => ({
    label: `${r.country} ${r.platform}`,
    value: r.total,
    sub: `成功率 ${formatPercent(r.successRate)}`
  })), [summaryRows]);

  const compareSuccessChartItems = useMemo<ChartItem[]>(() => summaryRows.map((r) => ({
    label: `${r.country} ${r.platform}`,
    value: r.successRate * 100,
    sub: `驳回 ${formatPercent(r.rejectRate)}`
  })), [summaryRows]);

  const operatorChartItems = useMemo<ChartItem[]>(() => topOperators.map((r) => ({
    label: `${r.country} ${r.account}`,
    value: r.processed,
    sub: r.platform
  })), [topOperators]);

  const operatorCountryChartItems = useMemo<ChartItem[]>(() => {
    const map = new Map<string, number>();
    for (const row of operatorRows) map.set(row.country, (map.get(row.country) || 0) + row.processed);
    return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [operatorRows]);

  function updateDraft<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setDraftFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSort(name: SortTableName, key: string) {
    setSorts((prev) => {
      const current = prev[name];
      const direction: SortDirection = current.key === key && current.direction === "desc" ? "asc" : "desc";
      return {
        ...prev,
        [name]: { key, direction }
      };
    });
    setPage(1);
  }

  async function applyFilters() {
    const next = {
      countries: [],
      platforms: draftFilters.platforms,
      accounts: draftFilters.accounts,
      startDate: draftFilters.startDate,
      endDate: draftFilters.endDate
    };
    setFilters(next);
    setHasBusinessQueried(true);
    setPage(1);
    await loadData(false, next.startDate, next.endDate);
  }

  function resetFilters() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const defaultDate = formatDateKey(yesterday);
    const next = blankFilters(defaultDate, defaultDate);
    if (activeModule === "auto") setAutoCountryPane(autoCountryPanes[0] || "");
    if (activeModule === "operator") setOperatorCountryPane(operatorCountryPanes[0] || "");
    setDraftFilters(next);
    setPage(1);
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

  function switchAutoView(nextView: AutoView) {
    setAutoView(nextView);
    if (nextView === "month") {
      const range = monthRangeFromDateKey(draftFilters.startDate || filters.startDate || draftFilters.endDate || filters.endDate);
      const next = { ...draftFilters, countries: [], startDate: range.startDate, endDate: range.endDate };
      setDraftFilters(next);
    }
    setPage(1);
  }

  useEffect(() => {
    if (autoView !== "month") return;
    const baseDate = draftFilters.startDate || filters.startDate || draftFilters.endDate || filters.endDate;
    const range = monthRangeFromDateKey(baseDate);
    if (draftFilters.startDate === range.startDate && draftFilters.endDate === range.endDate) return;
    const next = { ...draftFilters, countries: [], startDate: range.startDate, endDate: range.endDate };
    setDraftFilters(next);
    setPage(1);
  // 自动出款月表必须按整月统计：进入月表后自动切到当月 1 号至月底。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoView]);

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
      // “本月”固定回到当前自然月；“上月”则按当前已经选中的月份继续往前走。
      // 这样第一次从 7 月按“上月”到 6 月，再按一次会到 5 月，不会永远跳回 6 月。
      const selectedDateKey = draftFilters.startDate || filters.startDate || draftFilters.endDate || filters.endDate;
      const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDateKey)
        ? new Date(`${selectedDateKey}T12:00:00`)
        : new Date(now);
      const base = mode === "lastMonth" && !Number.isNaN(selectedDate.getTime()) ? selectedDate : now;
      start.setFullYear(base.getFullYear(), base.getMonth(), 1);
      if (mode === "lastMonth") start.setMonth(start.getMonth() - 1);
      end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0);
    }
    const next = { ...draftFilters, countries: [], startDate: formatDateKey(start), endDate: formatDateKey(end) };
    setDraftFilters(next);
    setPage(1);
  }


  function shiftDateRange(days: number) {
    if (activeModule === "auto" && autoView === "month") {
      const base = draftFilters.startDate || filters.startDate || draftFilters.endDate || filters.endDate || formatDateKey(new Date());
      const current = new Date(`${base}T00:00:00`);
      if (Number.isNaN(current.getTime())) return;
      current.setMonth(current.getMonth() + days);
      const range = monthRangeFromDateKey(formatDateKey(current));
      const next = { ...draftFilters, countries: [], startDate: range.startDate, endDate: range.endDate };
      setDraftFilters(next);
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
    const next = { ...draftFilters, countries: [], startDate: formatDateKey(start), endDate: formatDateKey(end) };
    setDraftFilters(next);
    setPage(1);
  }

  function openSnapshotMonth(item: { start: string; end: string }) {
    const next = { ...draftFilters, countries: [], platforms: [], accounts: [], startDate: item.start, endDate: item.end };
    setDraftFilters(next);
    setFilters(next);
    setPage(1);
  }

  function selectAutoCountryPane(pane: string) {
    setAutoCountryPane(pane);
    setDraftFilters((prev) => ({ ...prev, countries: [], platforms: [] }));
    setFilters((prev) => ({ ...prev, countries: [], platforms: [] }));
    setShowFullPlatformRank(false);
    setShowFullAnomalyRank(false);
    setPage(1);
  }

  function selectOperatorCountryPane(pane: string) {
    setOperatorCountryPane(pane);
    setDraftFilters((prev) => ({ ...prev, countries: [], platforms: [], accounts: [] }));
    setFilters((prev) => ({ ...prev, countries: [], platforms: [], accounts: [] }));
    setPage(1);
  }

  function switchModule(next: ModuleMode) {
    if (next === "volume" && !canThirdParty) return;
    if ((next === "auto" || next === "operator") && !canAutoWithdraw) return;
    if (next === "work" && !canWorkSupport) return;
    setActiveModule(next);
    if (next === "home") {
      setPage(1);
      return;
    }
    if (next === "auto") setAutoView("daily");
    if (next === "operator") setOperatorView("summary");

    // V7P：第一次点进自动出款 / 提现操作人就自动读取默认日期，
    // 国家盘口立即可见，不需要用户再点一次“查询”。
    if ((next === "auto" || next === "operator") && !hasBusinessQueried) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const fallbackDate = formatDateKey(yesterday);
      const startDate = draftFilters.startDate || filters.startDate || fallbackDate;
      const endDate = draftFilters.endDate || filters.endDate || startDate;
      const initialFilters = {
        ...filters,
        countries: [],
        platforms: [],
        accounts: [],
        startDate,
        endDate
      };
      setFilters(initialFilters);
      setDraftFilters(initialFilters);
      setHasBusinessQueried(true);
      void loadData(false, startDate, endDate);
    }
    setPage(1);
  }

  function openAutoDateSummary(row: AutoWithdrawRow) {
    const date = row.platform.slice(0, 10);
    if (!isIsoDate(date)) return;

    const rows = filteredDailyRows.filter((item) => item.date === date && item.country === row.country);

    setDetailModal({
      kind: "auto-date",
      title: `${date} ${row.country} 自动出款明细`,
      subtitle: `弹窗查看，不改变当前页面筛选条件。共 ${rows.length} 行。`,
      rows
    });
  }

  function openOperatorDateSummary(row: OperatorDateSummaryRow) {
    const date = row.title.slice(0, 10);
    if (!isIsoDate(date)) return;

    const country = row.title.replace(date, "").trim();
    const rows = operatorRows.filter((item) => item.date === date && item.country === country);

    setDetailModal({
      kind: "operator-date",
      title: `${date} ${country} 操作人明细`,
      subtitle: `弹窗查看，不改变当前页面筛选条件。共 ${rows.length} 行。`,
      rows
    });
  }

  function openAutoPlatformDaily(row: AutoWithdrawRow) {
    const rows = filteredDailyRows
      .filter((item) => item.country === row.country && item.platform === row.platform)
      .sort((a, b) => a.date.localeCompare(b.date) || b.total - a.total);

    setDetailModal({
      kind: "auto-date",
      title: `${row.country} ${row.platform} 每日明细`,
      subtitle: `${filters.startDate || "-"} 至 ${filters.endDate || "-"} · 区间累计 ${formatNumber(row.total)} 笔 · 共 ${rows.length} 天/行`,
      rows
    });
  }

  function openOperatorAccountDaily(row: OperatorSummaryRow) {
    const rows = operatorRows
      .filter((item) => item.country === row.country && item.account === row.account)
      .sort((a, b) => a.date.localeCompare(b.date) || b.processed - a.processed || a.platform.localeCompare(b.platform, "zh-CN"));

    setDetailModal({
      kind: "operator-date",
      title: `${row.country} ${row.account} 每日处理明细`,
      subtitle: `${filters.startDate || "-"} 至 ${filters.endDate || "-"} · 区间累计处理 ${formatNumber(row.processed)} 笔 · 共 ${uniq(rows.map((item) => item.date)).length} 天`,
      rows
    });
  }

  function openAutoPlatformOperators(row: AutoWithdrawRow | DailyWithdrawRow) {
    if (!payload) return;
    const rowDate = "date" in row ? row.date : "";
    const rows = payload.operatorRows
      .filter((item) => item.country === row.country && item.platform === row.platform)
      .filter((item) => {
        if (/^20\d{2}-\d{2}-\d{2}$/.test(rowDate)) return item.date === rowDate;
        if (/^20\d{2}-\d{2}$/.test(rowDate)) return item.date.startsWith(rowDate);
        return inDateRange(item.date, filters.startDate, filters.endDate);
      })
      .sort((a, b) => b.processed - a.processed || b.rejected - a.rejected || a.account.localeCompare(b.account, "zh-CN"));

    const dateText = rowDate || `${filters.startDate || "-"} 至 ${filters.endDate || "-"}`;
    setDetailModal({
      kind: "platform-operators",
      title: `${row.platform} 操作人详情`,
      subtitle: `${row.country} · ${dateText} · 共 ${rows.length} 个操作人明细`,
      rows,
      monthly: /^20\d{2}-\d{2}$/.test(rowDate)
    });
  }

  function openAutoAnomaly(row: AnomalyRow) {
    const rows = filteredDailyRows.filter((item) => item.country === row.country && item.platform === row.platform);

    setDetailModal({
      kind: "auto-date",
      title: `${row.country} ${row.platform} 异常明细`,
      subtitle: `${row.reasons.join("，")}。弹窗查看，不改变当前页面筛选条件。共 ${rows.length} 行。`,
      rows
    });
  }

  useEffect(() => {
    setPage(1);
  }, [activeModule, autoView, operatorView, filters, pageSize, autoCountryPane, operatorCountryPane]);

  function handleExport() {
    const suffix = `${filterLabel(filters.countries)}-${filters.startDate || "all"}-${filters.endDate || "all"}`.replace(/\s+/g, "");

    if (activeModule === "auto") {
      if (autoView === "anomaly") {
        exportCsv(`自动出款异常提醒-${suffix}.csv`, anomalyRows, [
          { label: "国家", value: (r) => r.country },
          { label: "盘口", value: (r) => r.platform },
          { label: "异常原因", value: (r) => r.reasons.join("；") },
          { label: "总提款笔数", value: (r) => r.total },
          { label: "成功", value: (r) => r.success },
          { label: "驳回", value: (r) => r.rejected },
          { label: "成功率", value: (r) => formatPercent(r.successRate) },
          { label: "驳回率", value: (r) => formatPercent(r.rejectRate) },
          { label: "自动出款", value: (r) => r.autoCount },
          { label: "人工处理", value: (r) => r.manualCount },
          { label: "自动占比", value: (r) => formatPercent(r.autoRate) },
          { label: "人工占比", value: (r) => formatPercent(r.manualRate) },
          { label: "平均处理时间", value: (r) => r.avgTime }
        ]);
        return;
      }
      if (autoView === "month") {
        exportCsv(`自动出款月表-${suffix}.csv`, monthlyDailyRows, [
          { label: "月份", value: (r) => r.date },
          { label: "国家", value: (r) => r.country },
          { label: "盘口", value: (r) => r.platform },
          { label: "总提款笔数", value: (r) => r.total },
          { label: "成功", value: (r) => r.success },
          { label: "驳回", value: (r) => r.rejected },
          { label: "成功占比", value: (r) => formatPercent(r.successRate) },
          { label: "驳回占比", value: (r) => formatPercent(r.rejectRate) },
          { label: "自动出款", value: (r) => r.autoCount },
          { label: "人工处理", value: (r) => r.manualCount },
          { label: "自动占比", value: (r) => formatPercent(r.autoRate) },
          { label: "人工占比", value: (r) => formatPercent(r.manualRate) },
          { label: "平均处理时间", value: (r) => r.avgTime }
        ]);
        return;
      }
      if (autoView === "daily") {
        exportCsv(`自动出款区间累计-${suffix}.csv`, summaryRows, [
          { label: "国家", value: (r) => r.country },
          { label: "盘口", value: (r) => r.platform },
          { label: "总提款笔数", value: (r) => r.total },
          { label: "成功", value: (r) => r.success },
          { label: "驳回", value: (r) => r.rejected },
          { label: "成功占比", value: (r) => formatPercent(r.successRate) },
          { label: "驳回占比", value: (r) => formatPercent(r.rejectRate) },
          { label: "自动出款", value: (r) => r.autoCount },
          { label: "人工处理", value: (r) => r.manualCount },
          { label: "自动占比", value: (r) => formatPercent(r.autoRate) },
          { label: "人工占比", value: (r) => formatPercent(r.manualRate) },
          { label: "平均处理时间", value: (r) => r.avgTime }
        ]);
        return;
      }

      exportCsv(`自动出款汇总-${suffix}.csv`, summaryRows, [
        { label: "国家", value: (r) => r.country },
        { label: "盘口", value: (r) => r.platform },
        { label: "总提款笔数", value: (r) => r.total },
        { label: "成功", value: (r) => r.success },
        { label: "驳回", value: (r) => r.rejected },
        { label: "成功占比", value: (r) => formatPercent(r.successRate) },
        { label: "驳回占比", value: (r) => formatPercent(r.rejectRate) },
        { label: "自动出款", value: (r) => r.autoCount },
        { label: "人工处理", value: (r) => r.manualCount },
        { label: "自动占比", value: (r) => formatPercent(r.autoRate) },
        { label: "人工占比", value: (r) => formatPercent(r.manualRate) },
        { label: "平均处理时间", value: (r) => r.avgTime }
      ]);
      return;
    }

    if (operatorView === "detail") {
      exportCsv(`提现操作人明细-${suffix}.csv`, operatorRows, [
        { label: "日期", value: (r) => r.date },
        { label: "国家", value: (r) => r.country },
        { label: "平台", value: (r) => r.platform },
        { label: "后台账号", value: (r) => r.account },
        { label: "已处理", value: (r) => r.processed },
        { label: "已处理占比", value: (r) => formatPercent(operatorSummary.totalProcessed ? r.processed / operatorSummary.totalProcessed : 0) },
        { label: "驳回", value: (r) => r.rejected },
        { label: "驳回占比", value: (r) => operatorSummary.totalRejected ? formatPercent(r.rejected / operatorSummary.totalRejected) : "-" },
        { label: "平均处理时长", value: (r) => r.avgTime },
        { label: "昨日平均处理时间", value: (r) => r.yesterdayAvgTime },
        { label: "对比%", value: (r) => r.comparePercent || "-" }
      ]);
      return;
    }

    exportCsv(`提现操作人汇总-${suffix}.csv`, operatorSummaryRows, [
      { label: "国家", value: (r) => r.country },
      { label: "平台覆盖", value: (r) => r.platform },
      { label: "后台账号", value: (r) => r.account },
      { label: "已处理总数", value: (r) => r.processed },
      { label: "已处理占比", value: (r) => formatPercent(operatorSummary.totalProcessed ? r.processed / operatorSummary.totalProcessed : 0) },
      { label: "驳回总数", value: (r) => r.rejected },
      { label: "驳回占比", value: (r) => operatorSummary.totalRejected ? formatPercent(r.rejected / operatorSummary.totalRejected) : "-" },
      { label: "平均处理时长", value: (r) => r.avgTime }
    ]);
  }

  const sidebarContent = (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo logo-data">H</div>
        <div>
          <div className="brand-title">Hensem数据后台</div>
          <div className="brand-subtitle">Operations Center</div>
        </div>
      </div>

      <div className="nav-section-title">入口</div>
      <button className={activeModule === "home" ? "nav-item active" : "nav-item"} onClick={() => switchModule("home")}>
        <span className="nav-left"><span className="nav-icon"><DashboardGlyph name="home" /></span>首页 / 选择模块</span>
      </button>

      <div className="nav-section-title">系统模块</div>
      <button className={(activeModule === "auto" || activeModule === "operator") ? "nav-item active" : "nav-item"} onClick={() => switchModule("auto")} disabled={!canAutoWithdraw} title={!canAutoWithdraw ? "管理员未开放此模块" : ""}>
        <span className="nav-left"><span className="nav-icon"><DashboardGlyph name="cash" /></span>提现/自动出款统计</span>
        <span className={canAutoWithdraw ? "badge ok" : "badge"}>{canAutoWithdraw ? "Supabase" : "无权限"}</span>
      </button>
      <button className={activeModule === "work" ? "nav-item active" : "nav-item"} onClick={() => switchModule("work")} disabled={!canWorkSupport} title={!canWorkSupport ? "管理员未开放此模块" : ""}>
        <span className="nav-left"><span className="nav-icon"><DashboardGlyph name="ticket" /></span>工单/客服</span>
        <span className={canWorkSupport ? "badge ok" : "badge"}>{canWorkSupport ? "已接入" : "无权限"}</span>
      </button>
      <button className={activeModule === "volume" ? "nav-item active" : "nav-item"} onClick={() => switchModule("volume")} disabled={!canThirdParty} title={!canThirdParty ? "管理员未开放此模块" : ""}>
        <span className="nav-left"><span className="nav-icon"><DashboardGlyph name="chart" /></span>三方量/费率</span>
        <span className={canThirdParty ? "badge ok" : "badge"}>{canThirdParty ? "Supabase" : "无权限"}</span>
      </button>

      <div className="nav-section-title system-admin-title">系统管理</div>
      {canOpenAdminCenter(profile) && (
        <>
          <button className={activeModule === "admin" ? "nav-item system-admin-nav active" : "nav-item system-admin-nav"} onClick={() => setAdminExpanded((value) => !value)}>
            <span className="nav-left"><span className="nav-icon"><DashboardGlyph name="settings" /></span>管理后台</span>
            <span className="nav-admin-toggle">{adminExpanded ? "⌃" : "⌄"}</span>
          </button>
          {adminExpanded && <div className="nav-admin-submenu">
            {canAdminUsers && <button className={activeModule === "admin" && adminSection === "users" ? "active" : ""} onClick={() => { setAdminSection("users"); setActiveModule("admin"); }}><span>账号与权限</span><small>账号 / 角色 / IP</small></button>}
            {canAdminData && <button className={activeModule === "admin" && adminSection === "data" ? "active" : ""} onClick={() => { setAdminSection("data"); setActiveModule("admin"); }}><span>数据同步</span><small>完整度 / 手动刷新</small></button>}
            {canAdminAudit && <button className={activeModule === "admin" && adminSection === "audit" ? "active" : ""} onClick={() => { setAdminSection("audit"); setActiveModule("admin"); }}><span>操作记录</span><small>后台审计日志</small></button>}
          </div>}
        </>
      )}
      <button className="nav-item system-admin-nav" onClick={openProfile}>
        <span className="nav-left"><span className="nav-icon"><DashboardGlyph name="user" /></span>个人资料</span>
      </button>
    </aside>
  );

  const homeContent = (
    <main className="main home-main">
      <div className="home-topbar">
        <div className="home-heading">
          <span className="home-eyebrow">OPERATIONS OVERVIEW</span>
          <h1>Hensem 数据中控</h1>
          <p>统一查看关键业务数据，快速进入你需要的工作模块。</p>
        </div>
        <span className="home-system-state"><i />系统运行正常</span>
      </div>

      <section className="home-card-grid">
        <button className="home-module-card home-module-blue" onClick={() => switchModule("auto")} disabled={!canAutoWithdraw} title={!canAutoWithdraw ? "管理员未开放此模块" : ""}>
          <span className="home-module-head"><span className="home-module-icon"><DashboardGlyph name="cash" /></span><span className="home-module-index">01</span></span>
          <span className="home-module-copy"><strong>提现 / 自动出款</strong><em>{canAutoWithdraw ? "自动出款日表、月表与操作人效率统计" : "你的账号暂未开放此模块"}</em></span>
          <span className="home-module-tags"><i>日/月趋势</i><i>人员效率</i><i>异常提醒</i></span>
          <span className="home-enter">{canAutoWithdraw ? <>进入模块 <DashboardGlyph name="arrow" /></> : "无查看权限"}</span>
        </button>
        <button className="home-module-card home-module-green" onClick={() => switchModule("work")} disabled={!canWorkSupport} title={!canWorkSupport ? "管理员未开放此模块" : ""}>
          <span className="home-module-head"><span className="home-module-icon"><DashboardGlyph name="ticket" /></span><span className="home-module-index">02</span></span>
          <span className="home-module-copy"><strong>工单 / 客服</strong><em>{canWorkSupport ? "工单、操作人和客服指标统一查看" : "你的账号暂未开放此模块"}</em></span>
          <span className="home-module-tags"><i>工单统计</i><i>客服效率</i><i>服务质量</i></span>
          <span className="home-enter">{canWorkSupport ? <>进入模块 <DashboardGlyph name="arrow" /></> : "无查看权限"}</span>
        </button>
        <button className="home-module-card home-module-purple" onClick={() => switchModule("volume")} disabled={!canThirdParty} title={!canThirdParty ? "管理员未开放此模块" : ""}>
          <span className="home-module-head"><span className="home-module-icon"><DashboardGlyph name="chart" /></span><span className="home-module-index">03</span></span>
          <span className="home-module-copy"><strong>三方量 / 费率</strong><em>{canThirdParty ? "充值、提款、费率和手续费集中分析" : "你的账号暂未开放此模块"}</em></span>
          <span className="home-module-tags"><i>国家汇总</i><i>费率匹配</i><i>费用分析</i></span>
          <span className="home-enter">{canThirdParty ? <>进入模块 <DashboardGlyph name="arrow" /></> : "无查看权限"}</span>
        </button>
      </section>
    </main>
  );

  if (activeModule === "home") {
    return <div className="app-shell">{sidebarContent}{homeContent}</div>;
  }

  // V251：管理后台作为业务后台内嵌页面，不再跳到独立工作区，也不使用弹窗。
  if (activeModule === "admin" && session && profile && canOpenAdminCenter(profile)) {
    return <div className="app-shell">{sidebarContent}<main className="main admin-inline-main"><AdminControlCenter open session={session} profile={profile} section={adminSection} embedded onClose={() => switchModule("home")} /></main></div>;
  }

  // V226：工单和三方量始终使用唯一、固定的组件挂载位置。
  // 旧版会在自动出款 payload 从空变为有值时切换 JSX 分支，造成三方量组件被销毁重建，
  // 所以用户只是在页面点击，也可能突然看到整页“正在读取三方量”。
  if (activeModule === "work") {
    return <div className="app-shell">{sidebarContent}<main className="main"><WorkOrderDashboard /></main></div>;
  }
  if (activeModule === "volume") {
    return <div className="app-shell">{sidebarContent}<main className="main"><ThirdPartyVolumeDashboard /></main></div>;
  }






  if (!payload && (activeModule === "work" || activeModule === "volume")) {
    return (
      <div className="app-shell">
        {sidebarContent}
        <main className="main">{activeModule === "work" ? <WorkOrderDashboard /> : <ThirdPartyVolumeDashboard />}</main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {sidebarContent}

      <main className={`main ${!hasBusinessQueried || !payload ? "business-prequery" : ""}`}>
        {activeModule === "volume" ? (
          <ThirdPartyVolumeDashboard />
        ) : activeModule === "work" ? (
          <WorkOrderDashboard />
        ) : (
          <>
        <div className="topbar">
          <div className="title">
            <h1>提现 / 自动出款统计</h1>
          </div>
          {hasBusinessQueried && payload && <div className="status-box">
            <div className="status-line"><span>数据来源</span><strong>{String(payload.meta.source || "").toLowerCase().includes("supabase") ? "Supabase" : payload.meta.source === "demo" ? "Demo" : "历史快照"}</strong></div>
            <div className="status-line"><span>日期区间</span><strong>{filters.startDate || "-"} 至 {filters.endDate || "-"}</strong></div>
            <div className="status-line"><span>更新时间</span><strong>{new Date(String((payload.meta as any).snapshotUpdatedAt || payload.meta.updatedAt)).toLocaleString("zh-CN")}</strong></div>
          </div>}
        </div>

        <section className="module-switch">
          <button
            className={activeModule === "auto" ? "module-tab active" : "module-tab"}
            onClick={() => switchModule("auto")}
          >
            自动出款
          </button>
          <button
            className={activeModule === "operator" ? "module-tab active" : "module-tab"}
            onClick={() => switchModule("operator")}
          >
            提现操作人
          </button>
        </section>

        {activeModule === "auto" && (
          <section className="child-switch view-switch-row">
            <button className={autoView === "daily" ? "child-tab active" : "child-tab"} onClick={() => switchAutoView("daily")}>自动出款日表</button>
            <button className={autoView === "month" ? "child-tab active" : "child-tab"} onClick={() => switchAutoView("month")}>自动出款月表</button>
            <button className={autoView === "anomaly" ? "child-tab active" : "child-tab"} onClick={() => switchAutoView("anomaly")}>异常提醒</button>
          </section>
        )}

        {activeModule === "operator" && (
          <section className="child-switch view-switch-row">
            <button className={operatorView === "summary" ? "child-tab active" : "child-tab"} onClick={() => setOperatorView("summary")}>操作人汇总表</button>
            <button className={operatorView === "detail" ? "child-tab active" : "child-tab"} onClick={() => setOperatorView("detail")}>操作人明细</button>
            <button className={operatorView === "compare" ? "child-tab active" : "child-tab"} onClick={() => setOperatorView("compare")}>操作人对比</button>
          </section>
        )}

        {activeModule === "auto" && (
          <section className="child-switch auto-country-pane-switch country-pane-row">
            {autoCountryPanes.map((pane) => (
              <button key={pane} className={autoCountryPane === pane ? "child-tab active" : "child-tab"} onClick={() => selectAutoCountryPane(pane)}>
                {pane}{pane === NPG_PANE_LABEL ? <span className="mini-red-badge">3国合并</span> : null}
              </button>
            ))}
          </section>
        )}

        {activeModule === "operator" && (
          <section className="child-switch auto-country-pane-switch operator-country-pane-switch country-pane-row">
            {operatorCountryPanes.map((pane) => (
              <button key={pane} className={operatorCountryPane === pane ? "child-tab active" : "child-tab"} onClick={() => selectOperatorCountryPane(pane)}>
                {pane}{pane === NPG_PANE_LABEL ? <span className="mini-red-badge">3国合并</span> : null}
              </button>
            ))}
          </section>
        )}

        <section className="filter-card">
          <div className="filters filters-v3">
            <div className="field">
              <label>开始日期</label>
              <input className="input" type="date" value={draftFilters.startDate} onChange={(e) => updateDraft("startDate", e.target.value)} />
            </div>
            <div className="field">
              <label>结束日期</label>
              <input className="input" type="date" value={draftFilters.endDate} onChange={(e) => updateDraft("endDate", e.target.value)} />
            </div>
            <MultiSelect label="盘口 / 平台" options={platformOptions} value={draftFilters.platforms} onChange={(value) => updateDraft("platforms", value)} placeholder="全部平台" />
            {activeModule === "operator" && (
              <MultiSelect label="操作人" options={accountOptions} value={draftFilters.accounts} onChange={(value) => updateDraft("accounts", value)} placeholder="全部操作人" />
            )}
            <div className="action-row action-row-v2">
              <button className="primary-btn" onClick={() => void applyFilters()} disabled={state === "loading"}>{state === "loading" ? "查询中..." : "查询"}</button>
              <button className="ghost-btn" onClick={resetFilters}>重置</button>
              <button className="ghost-btn" type="button" onClick={() => shiftDateRange(-1)}>{activeModule === "auto" && autoView === "month" ? "上一月" : "上一日"}</button>
              <button className="ghost-btn" type="button" onClick={() => shiftDateRange(1)}>{activeModule === "auto" && autoView === "month" ? "下一月" : "下一日"}</button>
              <button className="ghost-btn" onClick={handleExport}>导出</button>
            </div>
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
          {state === "error" && error && <div className="business-query-error">查询失败：{error}</div>}
        </section>

        {(!hasBusinessQueried || !payload) && (
          <section className="dashboard-query-empty" aria-live="polite">
            <span className="dashboard-query-empty-icon"><DashboardGlyph name="chart" /></span>
            <div><strong>选择条件，开始查看数据</strong><p>设置日期和盘口后点击“查询”，结果会在这里清晰展示。</p></div>
          </section>
        )}

        {activeModule === "auto" && (
          <>
            {autoView === "dashboard" && (
              <>
                <section className="metrics">
                  <Metric label="总提款笔数" value={formatNumber(summary.total)} sub={`成功 ${formatNumber(summary.success)} / 驳回 ${formatNumber(summary.rejected)}`} />
                  <Metric label="成功率" value={formatPercent(summary.successRate)} sub={`驳回率 ${formatPercent(summary.rejectRate)}`} />
                  <Metric label="自动出款" value={formatNumber(summary.autoCount)} sub={`自动占比 ${formatPercent(summary.autoRate)}`} />
                  <Metric label="人工处理" value={formatNumber(summary.manualCount)} sub={`人工占比 ${formatPercent(summary.manualRate)} · 平均 ${summary.avgTime}`} />
                  <Metric label="日均总笔数" value={formatNumber(Math.round(dailyAverageTotal))} sub={`按当前 ${activeDayCount} 天计算`} />
                  <Metric label="人工日均笔数" value={formatNumber(Math.round(dailyAverageManual))} sub={`人工总数 ${formatNumber(summary.manualCount)}`} />
                </section>

                <section className="grid-two">
                  <Panel title="提款量排行" subtitle="按当前日期区间汇总排序">
                    <div className="mini-list">
                      {topPlatforms.map((row, index) => (
                        <div className="rank-item" key={`${row.country}-${row.platform}-${index}`}>
                          <div className="rank-no">{index + 1}</div>
                          <div>
                            <div className="rank-name">{row.platform}</div>
                            <div className="rank-sub">{row.country} · 成功率 {formatPercent(row.successRate)} · 人工 {formatPercent(row.manualRate)}</div>
                          </div>
                          <div className="rank-value">{formatNumber(row.total)}</div>
                        </div>
                      ))}
                      {!topPlatforms.length && <div className="empty">暂无数据</div>}
                      {summaryRows.length > topPlatforms.length && (
                        <div className="compact-more-row">
                          <button className="ghost-btn small" type="button" onClick={() => setShowFullPlatformRank((value) => !value)}>{showFullPlatformRank ? "收起完整排行" : `展开完整排行（共 ${summaryRows.length} 项）`}</button>
                        </div>
                      )}
                    </div>
                  </Panel>

                  <Panel title="异常提醒" subtitle="自动根据当前筛选结果判断，点击可查看对应明细">
                    <div className="alert-list">
                      {anomalyRows.slice(0, 8).map((row, index) => (
                        <button className="alert-item alert-clickable" key={`${row.country}-${row.platform}-${index}`} type="button" onClick={() => openAutoAnomaly(row)}>
                          <span className="alert-dot" />
                          <span>{row.country} {row.platform}：{row.reasons.join("，")}</span>
                          <b>查看</b>
                        </button>
                      ))}
                      {!anomalyRows.length && <div className="empty">当前筛选结果暂无明显异常</div>}
                      {anomalyRows.length > 8 && (
                        <div className="compact-more-row">
                          <button className="ghost-btn small" type="button" onClick={() => setShowFullAnomalyRank((value) => !value)}>{showFullAnomalyRank ? "收起完整异常" : `展开完整异常（共 ${anomalyRows.length} 条）`}</button>
                        </div>
                      )}
                    </div>
                  </Panel>
                </section>

                {showFullPlatformRank && (
                  <Panel title="提款量排行完整列表" subtitle={`放在页面下面显示，不再弹窗。当前盘口：${autoCountryPane}，共 ${formatNumber(sortedSummaryRows.length)} 项。`}>
                    <AutoWithdrawTable rows={sortedSummaryRows} totalRows={sortedSummaryRows} sortState={sorts.autoSummary} onSort={(key) => toggleSort("autoSummary", key)} onOpenOperators={openAutoPlatformOperators} />
                  </Panel>
                )}

                {showFullAnomalyRank && (
                  <Panel title="异常提醒完整列表" subtitle={`放在页面下面显示，不再弹窗。当前盘口：${autoCountryPane}，共 ${formatNumber(anomalyRows.length)} 条。`}>
                    <AutoAnomalyTable rows={anomalyRows} totalRows={anomalyRows} onOpen={openAutoAnomaly} />
                  </Panel>
                )}

                <section className="grid-two">
                  <Panel title="异常平台排行榜" subtitle="成功率低于 90%、驳回率偏高、自动出款低于 50% 的平台">
                    <div className="mini-list">
                      {anomalyRows.slice(0, 8).map((row, index) => (
                        <button className="rank-item rank-button" type="button" key={`anomaly-${row.country}-${row.platform}-${index}`} onClick={() => openAutoAnomaly(row)}>
                          <div className="rank-no warn">{index + 1}</div>
                          <div>
                            <div className="rank-name">{row.platform}</div>
                            <div className="rank-sub">{row.country} · {row.reasons.join(" · ")}</div>
                          </div>
                          <div className="rank-value">{formatNumber(row.total)}</div>
                        </button>
                      ))}
                      {!anomalyRows.length && <div className="empty">当前筛选结果没有异常平台</div>}
                      {anomalyRows.length > 8 && (
                        <div className="compact-more-row">
                          <button className="ghost-btn small" type="button" onClick={() => setShowFullAnomalyRank((value) => !value)}>{showFullAnomalyRank ? "收起完整异常" : `展开完整异常（共 ${anomalyRows.length} 项）`}</button>
                        </div>
                      )}
                    </div>
                  </Panel>

                  <Panel title="平台提款量趋势对比" subtitle="按平台提款量排行展示">
                    <BarChart items={totalChartItems} valueSuffix="笔" />
                  </Panel>
                </section>

                <section className="chart-grid">
                  <Panel title="成功率对比" subtitle="按提款量前十平台展示成功率">
                    <BarChart items={successChartItems} valueSuffix="%" maxValue={100} />
                  </Panel>
                  <Panel title="日期汇总" subtitle="按日期汇总提款量、成功率、自动/人工占比">
                    <DateSummaryTable rows={dateSummaryRows} onOpen={openAutoDateSummary} />
                  </Panel>
                </section>

                <section className="chart-grid chart-grid-bottom">
                  <Panel title="昨日对比总览" subtitle={latestCompare.latestDate && latestCompare.previousDate ? `${latestCompare.latestDate} 对比 ${latestCompare.previousDate}` : "需要至少 2 天日表数据"}>
                    <QuickStats
                      items={[
                        { label: "总笔数对比", value: latestCompare.totalDiff, sub: latestCompare.latestDate ? `${latestCompare.latestDate}：${formatNumber(latestCompare.latest.total)}` : "-" },
                        { label: "成功率对比", value: latestCompare.successDiff, sub: latestCompare.latestDate ? `${latestCompare.latestDate}：${formatPercent(latestCompare.latest.successRate)}` : "-" },
                        { label: "人工占比对比", value: latestCompare.manualDiff, sub: latestCompare.latestDate ? `${latestCompare.latestDate}：${formatPercent(latestCompare.latest.manualRate)}` : "-" }
                      ]}
                    />
                    <CountryCompareList rows={countryCompareRows} />
                  </Panel>

                  <Panel title="自动 / 人工占比" subtitle="当前筛选范围内处理方式分布，并显示各国家占比">
                    <div className="auto-manual-panel">
                      <DonutChart items={[
                        { label: "自动出款", value: summary.autoCount },
                        { label: "人工处理", value: summary.manualCount }
                      ]} />
                      <CountryAutoManualList rows={countryAutoManualRows} />
                    </div>
                    <CountryPlatformCountList rows={countryPlatformCountRows} />
                  </Panel>
                </section>
              </>
            )}

            {autoView === "summary" && (
              <Panel title="自动出款汇总表" subtitle="按当前日期区间汇总国家 / 盘口数据">
                <QuickStats
                  items={[
                    { label: "统计天数", value: `${activeDayCount} 天`, sub: "按当前日期区间计算" },
                    { label: "日均总笔数", value: formatNumber(Math.round(dailyAverageTotal)), sub: `总笔数 ${formatNumber(summary.total)}` },
                    { label: "人工日均笔数", value: formatNumber(Math.round(dailyAverageManual)), sub: `人工总数 ${formatNumber(summary.manualCount)}` }
                  ]}
                />
                <PaginationControls total={sortedSummaryRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
                <AutoWithdrawTable rows={paginateRows(sortedSummaryRows, page, pageSize)} totalRows={sortedSummaryRows} sortState={sorts.autoSummary} onSort={(key) => toggleSort("autoSummary", key)} onOpenOperators={openAutoPlatformOperators} />
              </Panel>
            )}

            {autoView === "daily" && (
              <section className="panel aw-daily-panel" aria-label="自动出款日表">
                <AutoWithdrawReasonsProvider startDate={filters.startDate} endDate={filters.endDate} availableRows={filteredDailyRows} showToolbar={false}>
                <AutoWithdrawNotesProvider startDate={filters.startDate} endDate={filters.endDate} availableRows={filteredDailyRows} showToolbar={false}>
                  <AutoWithdrawDailySummary startDate={filters.startDate} endDate={filters.endDate} dayCount={activeDayCount} totals={summary}
                    actions={<><AutoWithdrawReasonsQueryButton /><AutoWithdrawNotesActions /></>} />
                  <PaginationControls total={sortedSummaryRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
                  <AutoWithdrawTable rows={paginateRows(sortedSummaryRows, page, pageSize)} totalRows={sortedSummaryRows} sortState={sorts.autoSummary} onSort={(key) => toggleSort("autoSummary", key)} onOpenOperators={openAutoPlatformDaily} withNotes singleDay={filters.startDate === filters.endDate} />
                </AutoWithdrawNotesProvider>
                </AutoWithdrawReasonsProvider>
              </section>
            )}

            {autoView === "month" && (
              <Panel title="自动出款月表" subtitle="按月份 + 国家 + 盘口汇总。选 5 月就是 5 月合计，不会每天重复一行。">
                <QuickStats
                  items={[
                    { label: "月份数量", value: formatNumber(new Set(monthlyDailyRows.map((row) => row.date)).size), sub: "按当前日期区间汇总" },
                    { label: "月表总笔数", value: formatNumber(summarize(monthlyDailyRows).total), sub: `成功 ${formatNumber(summarize(monthlyDailyRows).success)} · 驳回 ${formatNumber(summarize(monthlyDailyRows).rejected)}` },
                    { label: "月表自动 / 人工", value: `${formatNumber(summarize(monthlyDailyRows).autoCount)} / ${formatNumber(summarize(monthlyDailyRows).manualCount)}`, sub: `自动占比 ${formatPercent(summarize(monthlyDailyRows).autoRate)}` }
                  ]}
                />
                <PaginationControls total={sortedMonthlyRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
                <DailyWithdrawTable rows={paginateRows(sortedMonthlyRows, page, pageSize)} totalRows={sortedMonthlyRows} sortState={sorts.autoDaily} onSort={(key) => toggleSort("autoDaily", key)} onOpenOperators={openAutoPlatformOperators} />
              </Panel>
            )}

            {autoView === "anomaly" && (
              <Panel title="自动出款异常提醒" subtitle="按当前盘口页签和日期区间判断：成功率低、驳回率高、自动占比低。点查看可打开对应平台明细。">
                <QuickStats
                  items={[
                    { label: "异常平台", value: formatNumber(anomalyRows.length), sub: `${autoCountryPane} · 当前筛选条件` },
                    { label: "最高风险平台", value: anomalyRows[0]?.platform || "-", sub: anomalyRows[0] ? `${anomalyRows[0].country} · ${anomalyRows[0].reasons.join(" / ")}` : "暂无异常" },
                    { label: "异常总笔数", value: formatNumber(anomalyRows.reduce((sum, row) => sum + row.total, 0)), sub: "异常平台合计" }
                  ]}
                />
                <PaginationControls total={anomalyRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
                <AutoAnomalyTable rows={paginateRows(anomalyRows, page, pageSize)} totalRows={anomalyRows} onOpen={openAutoAnomaly} />
              </Panel>
            )}

            {autoView === "compare" && (
              <>
                <Panel title="平台对比明细" subtitle={filters.countries.length ? `${filterLabel(filters.countries)} 平台对比` : "全部国家平台对比；可多选国家和平台后点击查询"}>
                  <PaginationControls total={sortedCompareRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
                  <PlatformCompareTable rows={paginateRows(sortedCompareRows, page, pageSize)} totalRows={sortedCompareRows} sortState={sorts.autoCompare} onSort={(key) => toggleSort("autoCompare", key)} />
                </Panel>

                <section className="chart-grid chart-grid-after-table">
                  <Panel title="平台对比 - 总提款" subtitle="默认显示前 10，点击查看更多可展开全部">
                    <BarChart items={compareTotalChartItems} valueSuffix="笔" />
                  </Panel>
                  <Panel title="平台对比 - 成功率" subtitle="默认显示前 10，点击查看更多可展开全部">
                    <BarChart items={compareSuccessChartItems} valueSuffix="%" maxValue={100} />
                  </Panel>
                </section>
              </>
            )}
          </>
        )}

        {activeModule === "operator" && (
          <>
            {operatorView === "dashboard" && (
              <>
                <section className="metrics">
                  <Metric label="总处理笔数" value={formatNumber(operatorSummary.totalProcessed)} sub={`驳回 ${formatNumber(operatorSummary.totalRejected)} / 驳回率 ${formatPercent(operatorSummary.rejectRate)}`} />
                  <Metric label="操作人数" value={formatNumber(operatorSummary.uniqueAccounts)} sub={`覆盖平台 ${formatNumber(operatorSummary.uniquePlatforms)} 个`} />
                  <Metric label="最高处理量" value={formatNumber(topOperators[0]?.processed || 0)} sub={topOperators[0] ? `${topOperators[0].account} · ${topOperators[0].country}` : "暂无数据"} />
                  <Metric label="平均处理时长" value={operatorSummary.avgTime} sub={lowOperators[0] ? `最低处理量 ${lowOperators[0].account} · ${formatNumber(lowOperators[0].processed)}` : "暂无数据"} />
                </section>
                <QuickStats
                  items={[
                    { label: "统计天数", value: `${operatorActiveDayCount} 天`, sub: "按当前日期区间计算" },
                    { label: "日均处理笔数", value: formatNumber(Math.round(operatorDailyAverageProcessed)), sub: `总处理 ${formatNumber(operatorSummary.totalProcessed)}` },
                    { label: "日均驳回笔数", value: formatNumber(Math.round(operatorDailyAverageRejected)), sub: `总驳回 ${formatNumber(operatorSummary.totalRejected)}` }
                  ]}
                />

                <section className="grid-two">
                  <Panel title="操作人处理排行" subtitle="按当前日期区间已处理笔数从高到低">
                    <div className="mini-list">
                      {topOperators.map((row, index) => (
                        <div className="rank-item" key={`${row.country}-${row.account}-${index}`}>
                          <div className="rank-no">{index + 1}</div>
                          <div>
                            <div className="rank-name">{row.account}</div>
                            <div className="rank-sub">{row.country} · {row.platform} · 驳回 {formatNumber(row.rejected)} · 平均 {row.avgTime}</div>
                          </div>
                          <div className="rank-value">{formatNumber(row.processed)}</div>
                        </div>
                      ))}
                      {!topOperators.length && <div className="empty">暂无数据</div>}
                    </div>
                    <div className="panel-action-row">
                      <button className="ghost-btn small" onClick={() => { setOperatorRankMode("high"); setOperatorView("compare"); }}>查看全部处理排行</button>
                    </div>
                  </Panel>

                  <Panel title="处理最少排行" subtitle="按当前日期区间汇总后，已处理笔数从少到多">
                    <div className="mini-list">
                      {lowOperators.map((row, index) => (
                        <div className="rank-item" key={`low-${row.country}-${row.account}-${index}`}>
                          <div className="rank-no">{index + 1}</div>
                          <div>
                            <div className="rank-name">{row.account}</div>
                            <div className="rank-sub">{row.country} · {row.platform} · 驳回 {formatNumber(row.rejected)} · 平均 {row.avgTime}</div>
                          </div>
                          <div className="rank-value">{formatNumber(row.processed)}</div>
                        </div>
                      ))}
                      {!lowOperators.length && <div className="empty">暂无数据</div>}
                    </div>
                    <div className="panel-action-row">
                      <button className="ghost-btn small" onClick={() => { setOperatorRankMode("low"); setOperatorView("compare"); }}>查看全部最少排行</button>
                    </div>
                  </Panel>
                </section>

                <section className="chart-grid">
                  <Panel title="操作人处理量排行" subtitle="按处理笔数排序">
                    <BarChart items={operatorChartItems} valueSuffix="笔" />
                  </Panel>
                  <Panel title="国家处理量分布" subtitle="按操作人明细汇总">
                    <DonutChart items={operatorCountryChartItems} />
                  </Panel>
                </section>
              </>
            )}

            {operatorView === "summary" && (
              <Panel title="提现操作人汇总表" subtitle="按当前开始日期～结束日期累计到操作人；点“查看”弹窗展开该账号每天的处理明细">
                <OperatorResultStats accounts={operatorSummaryRows.length} platforms={operatorSummary.uniquePlatforms} totalProcessed={operatorSummary.totalProcessed} totalRejected={operatorSummary.totalRejected} avgTime={operatorSummary.avgTime} />
                <PaginationControls total={sortedOperatorSummaryRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
                <OperatorSummaryTable rows={paginateRows(sortedOperatorSummaryRows, page, pageSize)} totalRows={sortedOperatorSummaryRows} totalProcessed={operatorSummary.totalProcessed} totalRejected={operatorSummary.totalRejected} sortState={sorts.operatorSummary} onSort={(key) => toggleSort("operatorSummary", key)} onOpen={openOperatorAccountDaily} />
              </Panel>
            )}

            {operatorView === "detail" && (
              <Panel title={`${operatorCountryPane} 操作人明细`} subtitle="日期 / 平台 / 后台账号 / 已处理 / 驳回 / 平均处理时长">
                <OperatorResultStats accounts={operatorSummaryRows.length} platforms={operatorSummary.uniquePlatforms} totalProcessed={operatorSummary.totalProcessed} totalRejected={operatorSummary.totalRejected} avgTime={operatorSummary.avgTime} />
                <PaginationControls total={sortedOperatorRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
                <OperatorTable rows={paginateRows(sortedOperatorRows, page, pageSize)} totalProcessed={operatorSummary.totalProcessed} totalRejected={operatorSummary.totalRejected} sortState={sorts.operatorDetail} onSort={(key) => toggleSort("operatorDetail", key)} />
              </Panel>
            )}

            {operatorView === "compare" && (
              <>
                <Panel title="操作人对比" subtitle={operatorRankMode === "high" ? "按当前筛选条件统计，已处理笔数从高到低" : "按当前筛选条件统计，已处理笔数从少到多"}>
                  <div className="rank-mode-row">
                    <button className={operatorRankMode === "high" ? "rank-mode active" : "rank-mode"} onClick={() => { setOperatorRankMode("high"); setPage(1); }}>处理最多</button>
                    <button className={operatorRankMode === "low" ? "rank-mode active" : "rank-mode"} onClick={() => { setOperatorRankMode("low"); setPage(1); }}>处理最少</button>
                  </div>
                  <PaginationControls total={operatorRankingRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
                  <OperatorRankingTable rows={paginateRows(operatorRankingRows, page, pageSize)} totalRows={operatorRankingRows} totalProcessed={operatorSummary.totalProcessed} countryProcessedMap={operatorCountryProcessedMap} startIndex={(page - 1) * pageSize} />
                </Panel>

                <Panel title="连续低处理观察" subtitle="放在操作人对比下面，方便一起看处理最多、处理最少和连续低处理。">
                  <div className="inline-filter-row low-filter-row">
                    <label>
                      观察时间
                      <select value={lowWindow} onChange={(e) => setLowWindow(e.target.value)}>
                        <option value="range">当前筛选区间</option>
                        <option value="3">近 3 天</option>
                        <option value="7">近 7 天</option>
                        <option value="30">近 30 天</option>
                      </select>
                    </label>
                    <label>
                      显示数量
                      <select value={lowLimit} onChange={(e) => setLowLimit(Number(e.target.value))}>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                      </select>
                    </label>
                    <span className="inline-note">{selectedLowConsistency.label} · 有效 {selectedLowConsistency.totalDays} 天 · 共 {selectedLowConsistency.rows.length} 人</span>
                  </div>
                  <ConsistentLowTable rows={visibleLowConsistencyRows} totalRows={selectedLowConsistency.rows.length} />
                </Panel>
              </>
            )}
          </>
        )}
          </>
        )}

        {detailModal && (
          <DetailModal state={detailModal} onClose={() => setDetailModal(null)} />
        )}
        {/* 自动出款完整排行已改成页面下方展开，不再使用弹窗，避免弹窗高度不够无法下滑。 */}
      </main>
    </div>
  );
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const visibleOptions = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return options.filter((x) => !q || x.toLowerCase().includes(q));
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
    <div ref={boxRef} className={`field multi-field ${disabled ? "disabled" : ""}`}>
      <label>{label}</label>
      <button className="multi-button" type="button" disabled={disabled} onClick={() => !disabled && setOpen((x) => !x)}>
        <span>{value.length ? filterLabel(value, placeholder) : placeholder}</span>
        <span className="multi-caret">▾</span>
      </button>
      {open && !disabled && (
        <div className="multi-menu">
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

function PaginationControls({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(total, safePage * pageSize);

  useEffect(() => {
    if (safePage !== page) onPageChange(safePage);
  }, [safePage, page, onPageChange]);

  return (
    <div className="pagination-row">
      <div className="pagination-info">
        显示 {formatNumber(start)} - {formatNumber(end)} / 共 {formatNumber(total)} 行
      </div>
      <div className="pagination-actions">
        <label>
          每页
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
        <button className="ghost-btn small" onClick={() => onPageChange(1)} disabled={safePage <= 1}>首页</button>
        <button className="ghost-btn small" onClick={() => onPageChange(safePage - 1)} disabled={safePage <= 1}>上一页</button>
        <span>{safePage} / {totalPages}</span>
        <button className="ghost-btn small" onClick={() => onPageChange(safePage + 1)} disabled={safePage >= totalPages}>下一页</button>
        <button className="ghost-btn small" onClick={() => onPageChange(totalPages)} disabled={safePage >= totalPages}>末页</button>
      </div>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  sortState,
  onSort,
  className = ""
}: {
  label: string;
  sortKey: string;
  sortState: TableSortState;
  onSort: (key: string) => void;
  className?: string;
}) {
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

function QuickStats({
  items
}: {
  items: { label: string; value: string; sub?: string }[];
}) {
  return (
    <div className="quick-stats">
      {items.map((item) => (
        <div className="quick-stat" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.sub && <em>{item.sub}</em>}
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}


function OperatorResultStats({ accounts, platforms, totalProcessed, totalRejected, avgTime }: { accounts: number; platforms: number; totalProcessed: number; totalRejected: number; avgTime: string }) {
  return (
    <section className="metrics operator-result-metrics">
      <Metric label="账号数量" value={formatNumber(accounts)} sub="当前搜索条件下的后台账号数" />
      <Metric label="平台数量" value={formatNumber(platforms)} sub="当前搜索条件覆盖平台" />
      <Metric label="总处理笔数" value={formatNumber(totalProcessed)} sub={`驳回 ${formatNumber(totalRejected)} · 驳回率 ${formatPercent(totalProcessed ? totalRejected / totalProcessed : 0)}`} />
      <Metric label="总平均处理时长" value={avgTime} sub="按已处理笔数加权计算" />
    </section>
  );
}

function CountryCompareList({ rows }: { rows: CountryCompareRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 6);
  if (!rows.length) return <div className="empty small-empty">暂无国家对比数据</div>;
  return (
    <div className="country-compare-list">
      {visible.map((row) => (
        <div className="country-compare-row" key={row.country}>
          <div>
            <strong>{row.country}</strong>
            <span>总笔数 {formatNumber(row.latest.total)} · 成功率 {formatPercent(row.latest.successRate)} · 人工 {formatPercent(row.latest.manualRate)}</span>
          </div>
          <div className="compare-mini-values">
            <CompareCell value={row.totalDiff} />
            <CompareCell value={row.successDiff} />
            <CompareCell value={row.manualDiff} />
          </div>
        </div>
      ))}
      {rows.length > 6 && (
        <div className="compact-more-row">
          <button className="ghost-btn small" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "收起" : `查看更多国家对比（共 ${rows.length} 个）`}</button>
        </div>
      )}
    </div>
  );
}

function CountryPlatformCountList({ rows }: { rows: CountryPlatformCountRow[] }) {
  const [open, setOpen] = useState(false);
  const visible = rows.slice(0, 6);
  if (!rows.length) return null;
  return (
    <div className="country-platform-counts">
      <div className="country-platform-title">各国家平台数量</div>
      <div className="country-platform-grid">
        {visible.map((row) => (
          <div className="country-platform-item" key={row.country}>
            <span>{row.country}</span>
            <strong>{formatNumber(row.platforms)} 个平台</strong>
            <em>{formatNumber(row.total)} 笔</em>
          </div>
        ))}
      </div>
      {rows.length > 6 && <button className="link-btn" type="button" onClick={() => setOpen(true)}>查看全部国家平台数量</button>}
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="detail-modal compact-text-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header"><div><h3>各国家平台数量</h3><p>当前筛选范围内国家、平台数量和平台名单</p></div><button className="ghost-btn small" type="button" onClick={() => setOpen(false)}>关闭</button></div>
            <div className="full-text-box">{rows.map((row) => `${row.country}：${row.platforms} 个平台 / ${formatNumber(row.total)} 笔\n${row.platformNames || "-"}`).join("\n\n")}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function AutoListModal({ state, onClose, onOpenAnomaly }: { state: AutoListModalState; onClose: () => void; onOpenAnomaly: (row: AnomalyRow) => void }) {
  const [limit, setLimit] = useState(50);
  const rows = state.rows.slice(0, limit);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="detail-modal rate-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="detail-modal-header">
          <div>
            <h3>{state.title}</h3>
            <p>{state.subtitle} · 共 {state.rows.length} 项</p>
          </div>
          <button className="ghost-btn small" type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="inline-filter-row modal-limit-row">
          <label>显示数量
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
        </div>
        <div className="modal-card-grid">
          {rows.map((row, index) => (
            <div className="modal-data-card" key={`${row.country}-${row.platform}-${index}`}>
              <div className="detail-card-head">
                <div>
                  <strong>{index + 1}. {row.platform}</strong>
                  <span>{row.country}</span>
                </div>
                <b>{formatNumber(row.total)} 笔</b>
              </div>
              <div className="modal-mini-grid">
                <div><span>成功</span><b>{formatNumber(row.success)}</b></div>
                <div><span>驳回</span><b>{formatNumber(row.rejected)}</b></div>
                <div><span>成功率</span><b>{formatPercent(row.successRate)}</b></div>
                <div><span>驳回率</span><b>{formatPercent(row.rejectRate)}</b></div>
                <div><span>自动出款</span><b>{formatNumber(row.autoCount)}</b></div>
                <div><span>人工处理</span><b>{formatNumber(row.manualCount)}</b></div>
                <div><span>自动占比</span><b>{formatPercent(row.autoRate)}</b></div>
                <div><span>人工占比</span><b>{formatPercent(row.manualRate)}</b></div>
                <div><span>平均处理时间</span><b>{row.avgTime || "-"}</b></div>
              </div>
              {state.kind === "anomaly-rank" && (
                <button className="ghost-btn small" type="button" onClick={() => onOpenAnomaly(row as AnomalyRow)}>查看明细</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-subtitle">{subtitle}</div>
        </div>
      </div>
      {children}
    </section>
  );
}

function CompareCell({ value }: { value?: string }) {
  const text = value || "-";
  const numeric = Number(text.replace("%", ""));
  let className = "compare-cell neutral";

  if (Number.isFinite(numeric) && numeric > 0) className = "compare-cell positive";
  if (Number.isFinite(numeric) && numeric < 0) className = "compare-cell negative";

  return <span className={className}>{text}</span>;
}

function RateBar({ value, reject = false }: { value: number; reject?: boolean }) {
  const width = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="rate-cell">
      <span>{formatPercent(value)}</span>
      <span className="bar"><span className={`bar-fill ${reject ? "reject" : ""}`} style={{ width: `${width}%` }} /></span>
    </div>
  );
}

function DonutChart({ items }: { items: ChartItem[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const colors = ["#2563eb", "#22c55e", "#f97316", "#ec4899", "#8b5cf6", "#06b6d4", "#f59e0b", "#64748b"];
  let cursor = 0;
  const gradient = total
    ? items.map((item, index) => {
      const start = cursor;
      const size = (item.value / total) * 100;
      cursor += size;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    }).join(", ")
    : "#e2e8f0 0% 100%";

  return (
    <div className="donut-chart-wrap">
      <div className="donut-chart" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="donut-center">
          <strong>{formatNumber(total)}</strong>
          <span>总量</span>
        </div>
      </div>
      <div className="legend-list">
        {items.map((item, index) => (
          <div className="legend-row" key={item.label}>
            <span className="legend-dot" style={{ background: colors[index % colors.length] }} />
            <span>{item.label}</span>
            <strong>{formatNumber(item.value)} <em>{formatPercent(total ? item.value / total : 0)}</em></strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({ items, valueSuffix = "", maxValue }: { items: ChartItem[]; valueSuffix?: string; maxValue?: number }) {
  const [showAll, setShowAll] = useState(false);
  const visibleItems = showAll ? items : items.slice(0, 10);
  const max = maxValue || Math.max(...items.map((item) => item.value), 1);

  if (!items.length) return <div className="empty">暂无图表数据</div>;

  return (
    <div className="bar-chart-list">
      {visibleItems.map((item) => {
        const pct = Math.max(0, Math.min(100, max ? (item.value / max) * 100 : 0));
        const valueText = valueSuffix === "%" ? `${item.value.toFixed(2)}%` : `${formatNumber(item.value)}${valueSuffix}`;
        return (
          <div className="chart-row" key={item.label}>
            <div className="chart-row-top">
              <span>{item.label}</span>
              <strong>{valueText}</strong>
            </div>
            <div className="chart-bar"><span style={{ width: `${pct}%` }} /></div>
            {item.sub && <div className="chart-sub">{item.sub}</div>}
          </div>
        );
      })}

      {items.length > 10 && (
        <div className="chart-more-row">
          <button className="ghost-btn small" type="button" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "收起" : `查看更多（共 ${items.length} 项）`}
          </button>
        </div>
      )}
    </div>
  );
}

function DetailModal({ state, onClose }: { state: DetailModalState; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="detail-modal-header">
          <div>
            <h3>{state.title}</h3>
            <p>{state.subtitle}</p>
          </div>
          <button className="ghost-btn small" type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="detail-modal-body detail-modal-body-compact">
          {state.kind === "auto-date" ? (
            <AutoDateDetailTable rows={state.rows} />
          ) : state.kind === "platform-operators" && state.monthly ? (
            <PlatformOperatorsMonthlyDetailTable rows={state.rows} />
          ) : (
            <OperatorDateDetailTable rows={state.rows} />
          )}
        </div>
      </div>
    </div>
  );
}

function AutoDateDetailTable({ rows }: { rows: DailyWithdrawRow[] }) {
  const shownSummary = summarizeAutoRows(rows);
  const totalSummary = shownSummary;
  if (!rows.length) return <div className="empty">没有明细数据</div>;

  return (
    <div className="detail-table-wrap">
      <table className="detail-table auto-detail-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>国家</th>
            <th>盘口</th>
            <th>总笔数</th>
            <th>成功</th>
            <th>驳回</th>
            <th>成功占比</th>
            <th>驳回占比</th>
            <th>自动</th>
            <th>人工</th>
            <th>自动占比</th>
            <th>人工占比</th>
            <th>平均处理</th>
            <th>昨日平均</th>
            <th>对比%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.date}-${row.country}-${row.platform}-${index}`}>
              <td>{row.date}</td>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td>{formatNumber(row.total)}</td>
              <td>{formatNumber(row.success)}</td>
              <td>{formatNumber(row.rejected)}</td>
              <td>{formatPercent(row.successRate)}</td>
              <td>{formatPercent(row.rejectRate)}</td>
              <td>{formatNumber(row.autoCount)}</td>
              <td>{formatNumber(row.manualCount)}</td>
              <td>{formatPercent(row.autoRate)}</td>
              <td>{formatPercent(row.manualRate)}</td>
              <td>{row.avgTime}</td>
              <td>{row.yesterdayAvgTime}</td>
              <td><CompareCell value={row.comparePercent} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={3}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.total)}</td><td className="num">{formatNumber(shownSummary.success)}</td><td className="num">{formatNumber(shownSummary.rejected)}</td><td>{shownSummary.total ? formatPercent(shownSummary.success / shownSummary.total) : '-'}</td><td>{shownSummary.total ? formatPercent(shownSummary.rejected / shownSummary.total) : '-'}</td><td className="num">{formatNumber(shownSummary.autoCount)}</td><td className="num">{formatNumber(shownSummary.manualCount)}</td><td>{shownSummary.autoCount + shownSummary.manualCount ? formatPercent(shownSummary.autoCount / (shownSummary.autoCount + shownSummary.manualCount)) : '-'}</td><td>{shownSummary.autoCount + shownSummary.manualCount ? formatPercent(shownSummary.manualCount / (shownSummary.autoCount + shownSummary.manualCount)) : '-'}</td><td>-</td><td>-</td><td className="muted-cell">汇总</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={3}>全部汇总</td><td className="num strong-cell">{formatNumber(totalSummary.total)}</td><td className="num">{formatNumber(totalSummary.success)}</td><td className="num">{formatNumber(totalSummary.rejected)}</td><td>{totalSummary.total ? formatPercent(totalSummary.success / totalSummary.total) : '-'}</td><td>{totalSummary.total ? formatPercent(totalSummary.rejected / totalSummary.total) : '-'}</td><td className="num">{formatNumber(totalSummary.autoCount)}</td><td className="num">{formatNumber(totalSummary.manualCount)}</td><td>{totalSummary.autoCount + totalSummary.manualCount ? formatPercent(totalSummary.autoCount / (totalSummary.autoCount + totalSummary.manualCount)) : '-'}</td><td>{totalSummary.autoCount + totalSummary.manualCount ? formatPercent(totalSummary.manualCount / (totalSummary.autoCount + totalSummary.manualCount)) : '-'}</td><td>-</td><td>-</td><td className="muted-cell">汇总</td></tr>
        </tfoot>
      </table>
    </div>
  );
}


type PlatformOperatorAccountSummary = {
  account: string;
  platform: string;
  processed: number;
  rejected: number;
  rejectRate: number;
  avgTime: string;
  days: number;
  rows: OperatorRow[];
};

function buildPlatformOperatorAccountSummary(rows: OperatorRow[]): PlatformOperatorAccountSummary[] {
  const map = new Map<string, PlatformOperatorAccountSummary & { _seconds: number; _weight: number; _dates: Set<string> }>();
  for (const row of rows) {
    const key = row.account || "未知账号";
    const current = map.get(key) || {
      account: key,
      platform: row.platform,
      processed: 0,
      rejected: 0,
      rejectRate: 0,
      avgTime: "0秒",
      days: 0,
      rows: [],
      _seconds: 0,
      _weight: 0,
      _dates: new Set<string>()
    };
    current.processed += row.processed || 0;
    current.rejected += row.rejected || 0;
    current.rows.push(row);
    if (row.date) current._dates.add(row.date);
    const seconds = parseDurationToSeconds(row.avgTime);
    const weight = row.processed || 0;
    if (seconds > 0 && weight > 0) {
      current._seconds += seconds * weight;
      current._weight += weight;
    }
    map.set(key, current);
  }
  return Array.from(map.values()).map(({ _seconds, _weight, _dates, ...row }) => ({
    ...row,
    days: _dates.size,
    rejectRate: row.processed ? row.rejected / row.processed : 0,
    avgTime: formatDuration(_weight ? _seconds / _weight : 0),
    rows: row.rows.sort((a, b) => b.date.localeCompare(a.date) || b.processed - a.processed)
  })).sort((a, b) => b.processed - a.processed || b.rejected - a.rejected || a.account.localeCompare(b.account, "zh-CN"));
}

function PlatformOperatorsMonthlyDetailTable({ rows }: { rows: OperatorRow[] }) {
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const summaryRows = useMemo(() => buildPlatformOperatorAccountSummary(rows), [rows]);
  const selected = selectedAccount ? summaryRows.find((row) => row.account === selectedAccount) : null;

  if (!rows.length) return <div className="empty">没有操作人明细数据</div>;

  if (selected) {
    return (
      <div className="operator-month-drilldown">
        <div className="detail-toolbar">
          <button className="ghost-btn small" type="button" onClick={() => setSelectedAccount(null)}>返回操作人汇总</button>
          <span>{selected.account} · 当前搜索日期内每日处理明细 · 共 {selected.rows.length} 天</span>
        </div>
        <OperatorDateDetailTable rows={selected.rows} />
      </div>
    );
  }

  return (
    <div className="detail-table-wrap">
      <table className="detail-table operator-detail-table">
        <thead>
          <tr>
            <th>后台账号</th>
            <th>平台</th>
            <th>总处理笔数</th>
            <th>总驳回</th>
            <th>驳回率</th>
            <th>平均处理时长</th>
            <th>涉及天数</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {summaryRows.map((row) => (
            <tr key={row.account}>
              <td className="platform-cell">{row.account}</td>
              <td className="platform-cell">{row.platform}</td>
              <td>{formatNumber(row.processed)}</td>
              <td>{formatNumber(row.rejected)}</td>
              <td>{formatPercent(row.rejectRate)}</td>
              <td>{row.avgTime}</td>
              <td>{row.days} 天</td>
              <td><button className="ghost-btn small" type="button" onClick={() => setSelectedAccount(row.account)}>查看</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OperatorDateDetailTable({ rows }: { rows: OperatorRow[] }) {
  if (!rows.length) return <div className="empty">没有操作人明细数据</div>;

  return (
    <div className="detail-table-wrap">
      <table className="detail-table operator-detail-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>国家</th>
            <th>平台</th>
            <th>后台账号</th>
            <th>已处理</th>
            <th>驳回</th>
            <th>驳回率</th>
            <th>平均处理时长</th>
            <th>昨日平均</th>
            <th>对比%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.date}-${row.country}-${row.platform}-${row.account}-${index}`}>
              <td>{row.date}</td>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td className="platform-cell">{row.account}</td>
              <td>{formatNumber(row.processed)}</td>
              <td>{formatNumber(row.rejected)}</td>
              <td>{formatPercent(row.processed ? row.rejected / row.processed : 0)}</td>
              <td>{row.avgTime}</td>
              <td>{row.yesterdayAvgTime}</td>
              <td><CompareCell value={row.comparePercent} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountryAutoManualList({ rows }: { rows: { country: string; auto: number; manual: number; total: number }[] }) {
  if (!rows.length) return <div className="empty">暂无国家占比数据</div>;
  return (
    <div className="country-ratio-list">
      {rows.slice(0, 10).map((row) => {
        const autoRate = row.total ? row.auto / row.total : 0;
        const manualRate = row.total ? row.manual / row.total : 0;
        return (
          <div className="country-ratio-row" key={row.country}>
            <div className="country-ratio-head">
              <strong>{row.country}</strong>
              <span>{formatNumber(row.total)} 笔</span>
            </div>
            <div className="split-bar">
              <span className="split-auto" style={{ width: `${Math.max(0, Math.min(100, autoRate * 100))}%` }} />
              <span className="split-manual" style={{ width: `${Math.max(0, Math.min(100, manualRate * 100))}%` }} />
            </div>
            <div className="country-ratio-foot">
              <span>自动 {formatNumber(row.auto)} · {formatPercent(autoRate)}</span>
              <span>人工 {formatNumber(row.manual)} · {formatPercent(manualRate)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConsistentLowTable({ rows, totalRows }: { rows: ConsistentLowRow[]; totalRows: number }) {
  if (!rows.length) return <div className="empty">暂无符合条件的连续低处理人员</div>;
  return (
    <div className="table-wrap low-table-wrap">
      <div className="table-hint">显示 {rows.length} / 共 {totalRows} 人</div>
      <table>
        <thead>
          <tr>
            <th>排名</th>
            <th>国家</th>
            <th>操作人</th>
            <th>命中天数</th>
            <th>日均处理</th>
            <th>总处理</th>
            <th>涉及平台</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.key}-${index}`}>
              <td><span className="rank-no warn">{index + 1}</span></td>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.account}</td>
              <td>{row.hitDays}/{row.totalDays} 天</td>
              <td>{formatNumber(Math.round(row.avgProcessed))}</td>
              <td>{formatNumber(row.totalProcessed)}</td>
              <td>{row.platforms || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function summarizeAutoRows(rows: readonly AutoWithdrawRow[]) {
  return rows.reduce((acc, row) => {
    acc.total += row.total || 0;
    acc.success += row.success || 0;
    acc.rejected += row.rejected || 0;
    acc.autoCount += row.autoCount || 0;
    acc.manualCount += row.manualCount || 0;
    return acc;
  }, { total: 0, success: 0, rejected: 0, autoCount: 0, manualCount: 0 });
}

function summarizeOperatorRows(rows: OperatorSummaryRow[]) {
  return rows.reduce((acc, row) => {
    acc.processed += row.processed || 0;
    acc.rejected += row.rejected || 0;
    return acc;
  }, { processed: 0, rejected: 0 });
}

function autoSummaryFoot(
  current: ReturnType<typeof summarizeAutoRows>,
  overall: ReturnType<typeof summarizeAutoRows>,
  label: string,
  options: { leadingColSpan?: number; includeDetail?: boolean; includeNotes?: boolean } = {}
) {
  const source = label === "当前页汇总" ? current : overall;
  const leadingColSpan = options.leadingColSpan ?? 2;
  return (
    <tr className={`summary-row ${label === "当前页汇总" ? "page-summary-row" : "overall-summary-row"}`}>
      <td colSpan={leadingColSpan}>{label}</td>
      <td className="num strong-cell">{formatNumber(source.total)}</td>
      <td className="num">{formatNumber(source.success)}</td>
      <td className="num">{formatNumber(source.rejected)}</td>
      <td>{source.total ? formatPercent(source.success / source.total) : "-"}</td>
      <td>{source.total ? formatPercent(source.rejected / source.total) : "-"}</td>
      <td className="num">{formatNumber(source.autoCount)}</td>
      <td className="num">{formatNumber(source.manualCount)}</td>
      <td>{source.autoCount + source.manualCount ? formatPercent(source.autoCount / (source.autoCount + source.manualCount)) : "-"}</td>
      <td>{source.autoCount + source.manualCount ? formatPercent(source.manualCount / (source.autoCount + source.manualCount)) : "-"}</td>
      <td>-</td>
      <td>-</td>
      <td className="muted-cell">汇总</td>
      {options.includeNotes ? <td className="muted-cell">每日备注按盘口记录</td> : null}
      {options.includeDetail ? <td className="muted-cell">-</td> : null}
    </tr>
  );
}

function AutoAnomalyTable({ rows, totalRows = rows, onOpen }: { rows: AnomalyRow[]; totalRows?: AnomalyRow[]; onOpen: (row: AnomalyRow) => void }) {
  const shownSummary = summarizeAutoRows(rows);
  const totalSummary = summarizeAutoRows(totalRows);
  if (!rows.length) return <div className="empty">当前盘口和日期范围暂无异常提醒</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>国家</th>
            <th>盘口</th>
            <th>异常原因</th>
            <th className="num">总笔数</th>
            <th className="num">成功</th>
            <th className="num">驳回</th>
            <th>成功率</th>
            <th>驳回率</th>
            <th className="num">自动</th>
            <th className="num">人工</th>
            <th>自动占比</th>
            <th>人工占比</th>
            <th>平均处理</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`auto-anomaly-${row.country}-${row.platform}-${index}`}>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td>{row.reasons.join("，")}</td>
              <td className="num">{formatNumber(row.total)}</td>
              <td className="num">{formatNumber(row.success)}</td>
              <td className="num">{formatNumber(row.rejected)}</td>
              <td><RateBar value={row.successRate} /></td>
              <td><RateBar value={row.rejectRate} reject /></td>
              <td className="num">{formatNumber(row.autoCount)}</td>
              <td className="num">{formatNumber(row.manualCount)}</td>
              <td><RateBar value={row.autoRate} /></td>
              <td><RateBar value={row.manualRate} reject /></td>
              <td>{row.avgTime}</td>
              <td><button className="ghost-btn small" type="button" onClick={() => onOpen(row)}>查看</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={3}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.total)}</td><td className="num">{formatNumber(shownSummary.success)}</td><td className="num">{formatNumber(shownSummary.rejected)}</td><td>{shownSummary.total ? formatPercent(shownSummary.success / shownSummary.total) : '-'}</td><td>{shownSummary.total ? formatPercent(shownSummary.rejected / shownSummary.total) : '-'}</td><td className="num">{formatNumber(shownSummary.autoCount)}</td><td className="num">{formatNumber(shownSummary.manualCount)}</td><td>{shownSummary.autoCount + shownSummary.manualCount ? formatPercent(shownSummary.autoCount / (shownSummary.autoCount + shownSummary.manualCount)) : '-'}</td><td>{shownSummary.autoCount + shownSummary.manualCount ? formatPercent(shownSummary.manualCount / (shownSummary.autoCount + shownSummary.manualCount)) : '-'}</td><td>-</td><td className="muted-cell">汇总</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={3}>全部汇总</td><td className="num strong-cell">{formatNumber(totalSummary.total)}</td><td className="num">{formatNumber(totalSummary.success)}</td><td className="num">{formatNumber(totalSummary.rejected)}</td><td>{totalSummary.total ? formatPercent(totalSummary.success / totalSummary.total) : '-'}</td><td>{totalSummary.total ? formatPercent(totalSummary.rejected / totalSummary.total) : '-'}</td><td className="num">{formatNumber(totalSummary.autoCount)}</td><td className="num">{formatNumber(totalSummary.manualCount)}</td><td>{totalSummary.autoCount + totalSummary.manualCount ? formatPercent(totalSummary.autoCount / (totalSummary.autoCount + totalSummary.manualCount)) : '-'}</td><td>{totalSummary.autoCount + totalSummary.manualCount ? formatPercent(totalSummary.manualCount / (totalSummary.autoCount + totalSummary.manualCount)) : '-'}</td><td>-</td><td className="muted-cell">汇总</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function AutoWithdrawTable({
  rows,
  totalRows = rows,
  sortState,
  onSort,
  onOpenOperators,
  withNotes = false,
  singleDay = false
}: {
  rows: AutoWithdrawRow[];
  totalRows?: AutoWithdrawRow[];
  sortState: TableSortState;
  onSort: (key: string) => void;
  onOpenOperators?: (row: AutoWithdrawRow) => void;
  withNotes?: boolean;
  singleDay?: boolean;
}) {
  const shownSummary = summarizeAutoRows(rows);
  const totalSummary = summarizeAutoRows(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的自动出款数据</div>;

  return (
    <div className={withNotes ? "table-wrap auto-withdraw-daily-compact" : "table-wrap"}>
      <table>
        <thead>
          <tr>
            <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />
            <SortableTh label="盘口" sortKey="platform" sortState={sortState} onSort={onSort} />
            <SortableTh label="总提款笔数" sortKey="total" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="成功" sortKey="success" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="驳回" sortKey="rejected" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="成功占比" sortKey="successRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="驳回占比" sortKey="rejectRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="自动出款" sortKey="autoCount" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="人工处理" sortKey="manualCount" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="自动占比" sortKey="autoRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="人工占比" sortKey="manualRate" sortState={sortState} onSort={onSort} />
            <SortableTh label={withNotes ? "平均用时" : "平均处理时间"} sortKey="avgTime" sortState={sortState} onSort={onSort} />
            <SortableTh label={withNotes ? "昨日用时" : "昨日平均处理时间"} sortKey="yesterdayAvgTime" sortState={sortState} onSort={onSort} />
            <SortableTh label={withNotes ? "较昨日%" : "对比%"} sortKey="comparePercent" sortState={sortState} onSort={onSort} />
            {withNotes && <th className="auto-note-column">原因 / 每日备注</th>}
            <th className="detail-col">详情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Fragment key={withNotes ? JSON.stringify([row.country, row.platform]) : `${row.sourceSheet}-${row.country}-${row.platform}-${index}`}><tr>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td className="num">{formatNumber(row.total)}</td>
              <td className="num">{formatNumber(row.success)}</td>
              <td className="num">{formatNumber(row.rejected)}</td>
              <td><RateBar value={row.successRate} /></td>
              <td><RateBar value={row.rejectRate} reject /></td>
              <td className="num">{formatNumber(row.autoCount)}</td>
              <td className="num">{formatNumber(row.manualCount)}</td>
              <td><RateBar value={row.autoRate} /></td>
              <td><RateBar value={row.manualRate} reject /></td>
              <td>{row.avgTime}</td>
              <td title={withNotes && !singleDay ? "区间汇总不对应单个昨日，请查询单日查看较昨日变化" : "同一盘口前一自然日的平均处理时间；缺少昨日数据时显示 —"}>{withNotes && !singleDay ? "仅单日对比" : row.yesterdayAvgTime || "—"}</td>
              <td><CompareCell value={withNotes && !singleDay ? "-" : row.comparePercent} /></td>
              {withNotes && <td className="auto-note-column"><AutoWithdrawReasonCell country={row.country} platform={row.platform} /></td>}
              <td><div className={withNotes ? "wr-row-actions" : undefined}>{withNotes && <AutoWithdrawReasonsButton country={row.country} platform={row.platform} />}<button className="detail-view-btn" type="button" onClick={() => onOpenOperators?.(row)}>{withNotes ? "日明细" : "查看"}</button></div></td>
            </tr>
            {withNotes && <AutoWithdrawReasonsInlineRow country={row.country} platform={row.platform} />}</Fragment>
          ))}
        </tbody>
        <tfoot>
          {autoSummaryFoot(shownSummary, totalSummary, "当前页汇总", { leadingColSpan: 2, includeDetail: true, includeNotes: withNotes })}
          {autoSummaryFoot(shownSummary, totalSummary, "全部汇总", { leadingColSpan: 2, includeDetail: true, includeNotes: withNotes })}
        </tfoot>
      </table>
    </div>
  );
}

function PlatformCompareTable({
  rows,
  totalRows = rows,
  sortState,
  onSort
}: {
  rows: AutoWithdrawRow[];
  totalRows?: AutoWithdrawRow[];
  sortState: TableSortState;
  onSort: (key: string) => void;
}) {
  const shownSummary = summarizeAutoRows(rows);
  const totalSummary = summarizeAutoRows(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的平台对比数据</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />
            <SortableTh label="盘口" sortKey="platform" sortState={sortState} onSort={onSort} />
            <SortableTh label="总提款笔数" sortKey="total" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="成功" sortKey="success" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="驳回" sortKey="rejected" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="成功率" sortKey="successRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="驳回率" sortKey="rejectRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="自动出款" sortKey="autoCount" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="人工处理" sortKey="manualCount" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="自动占比" sortKey="autoRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="人工占比" sortKey="manualRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="平均处理时间" sortKey="avgTime" sortState={sortState} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`compare-${row.country}-${row.platform}-${index}`}>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td className="num">{formatNumber(row.total)}</td>
              <td className="num">{formatNumber(row.success)}</td>
              <td className="num">{formatNumber(row.rejected)}</td>
              <td><RateBar value={row.successRate} /></td>
              <td><RateBar value={row.rejectRate} reject /></td>
              <td className="num">{formatNumber(row.autoCount)}</td>
              <td className="num">{formatNumber(row.manualCount)}</td>
              <td><RateBar value={row.autoRate} /></td>
              <td><RateBar value={row.manualRate} reject /></td>
              <td>{row.avgTime}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={2}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.total)}</td><td className="num">{formatNumber(shownSummary.success)}</td><td className="num">{formatNumber(shownSummary.rejected)}</td><td>{shownSummary.total ? formatPercent(shownSummary.success / shownSummary.total) : '-'}</td><td>{shownSummary.total ? formatPercent(shownSummary.rejected / shownSummary.total) : '-'}</td><td className="num">{formatNumber(shownSummary.autoCount)}</td><td className="num">{formatNumber(shownSummary.manualCount)}</td><td>{shownSummary.autoCount + shownSummary.manualCount ? formatPercent(shownSummary.autoCount / (shownSummary.autoCount + shownSummary.manualCount)) : '-'}</td><td>{shownSummary.autoCount + shownSummary.manualCount ? formatPercent(shownSummary.manualCount / (shownSummary.autoCount + shownSummary.manualCount)) : '-'}</td><td className="muted-cell">汇总</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={2}>全部汇总</td><td className="num strong-cell">{formatNumber(totalSummary.total)}</td><td className="num">{formatNumber(totalSummary.success)}</td><td className="num">{formatNumber(totalSummary.rejected)}</td><td>{totalSummary.total ? formatPercent(totalSummary.success / totalSummary.total) : '-'}</td><td>{totalSummary.total ? formatPercent(totalSummary.rejected / totalSummary.total) : '-'}</td><td className="num">{formatNumber(totalSummary.autoCount)}</td><td className="num">{formatNumber(totalSummary.manualCount)}</td><td>{totalSummary.autoCount + totalSummary.manualCount ? formatPercent(totalSummary.autoCount / (totalSummary.autoCount + totalSummary.manualCount)) : '-'}</td><td>{totalSummary.autoCount + totalSummary.manualCount ? formatPercent(totalSummary.manualCount / (totalSummary.autoCount + totalSummary.manualCount)) : '-'}</td><td className="muted-cell">汇总</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function DailyWithdrawTable({
  rows,
  totalRows = rows,
  sortState,
  onSort,
  onOpenOperators
}: {
  rows: DailyWithdrawRow[];
  totalRows?: DailyWithdrawRow[];
  sortState: TableSortState;
  onSort: (key: string) => void;
  onOpenOperators?: (row: DailyWithdrawRow) => void;
}) {
  const shownSummary = summarizeAutoRows(rows);
  const totalSummary = summarizeAutoRows(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的日表数据</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortableTh label="日期" sortKey="date" sortState={sortState} onSort={onSort} />
            <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />
            <SortableTh label="盘口" sortKey="platform" sortState={sortState} onSort={onSort} />
            <SortableTh label="总提款笔数" sortKey="total" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="成功" sortKey="success" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="驳回" sortKey="rejected" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="成功占比" sortKey="successRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="驳回占比" sortKey="rejectRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="自动出款" sortKey="autoCount" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="人工处理" sortKey="manualCount" sortState={sortState} onSort={onSort} className="num" />
            <SortableTh label="自动占比" sortKey="autoRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="人工占比" sortKey="manualRate" sortState={sortState} onSort={onSort} />
            <SortableTh label="平均处理时间" sortKey="avgTime" sortState={sortState} onSort={onSort} />
            <SortableTh label="昨日平均处理时间" sortKey="yesterdayAvgTime" sortState={sortState} onSort={onSort} />
            <SortableTh label="对比%" sortKey="comparePercent" sortState={sortState} onSort={onSort} />
            <th className="detail-col">详情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.sourceSheet}-${row.date}-${row.platform}-${index}`}>
              <td>{row.date}</td>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td className="num">{formatNumber(row.total)}</td>
              <td className="num">{formatNumber(row.success)}</td>
              <td className="num">{formatNumber(row.rejected)}</td>
              <td><RateBar value={row.successRate} /></td>
              <td><RateBar value={row.rejectRate} reject /></td>
              <td className="num">{formatNumber(row.autoCount)}</td>
              <td className="num">{formatNumber(row.manualCount)}</td>
              <td><RateBar value={row.autoRate} /></td>
              <td><RateBar value={row.manualRate} reject /></td>
              <td>{row.avgTime}</td>
              <td>{row.yesterdayAvgTime}</td>
              <td><CompareCell value={row.comparePercent} /></td>
              <td><button className="detail-view-btn" type="button" onClick={() => onOpenOperators?.(row)}>查看</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {autoSummaryFoot(shownSummary, totalSummary, "当前页汇总", { leadingColSpan: 3, includeDetail: true })}
          {autoSummaryFoot(shownSummary, totalSummary, "全部汇总", { leadingColSpan: 3, includeDetail: true })}
        </tfoot>
      </table>
    </div>
  );
}

function OperatorPlatformCell({ row }: { row: OperatorSummaryRow }) {
  const [open, setOpen] = useState(false);
  const details = row.platformDetails || [];
  if (!details.length || row.platformCount <= 1) return <span>{row.platform || "-"}</span>;

  return (
    <>
      <button className="link-btn platform-detail-link" type="button" onClick={() => setOpen(true)}>{row.platform}</button>
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="detail-modal compact-text-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header">
              <div>
                <h3>{row.account} 平台处理明细</h3>
                <p>{row.country} · 共覆盖 {row.platformCount} 个平台 · 已处理 {formatNumber(row.processed)} · 驳回 {formatNumber(row.rejected)}</p>
              </div>
              <button className="ghost-btn small" type="button" onClick={() => setOpen(false)}>关闭</button>
            </div>
            <div className="table-wrap no-horizontal compact-detail-table-wrap">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>平台</th>
                    <th className="num">已处理</th>
                    <th className="num">驳回</th>
                    <th>占比</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((item) => (
                    <tr key={item.platform}>
                      <td className="platform-cell">{item.platform}</td>
                      <td className="num">{formatNumber(item.processed)}</td>
                      <td className="num">{formatNumber(item.rejected)}</td>
                      <td><RateBar value={row.processed ? item.processed / row.processed : 0} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OperatorRankingTable({
  rows,
  totalRows = rows,
  totalProcessed,
  countryProcessedMap,
  startIndex
}: {
  rows: OperatorSummaryRow[];
  totalRows?: OperatorSummaryRow[];
  totalProcessed: number;
  countryProcessedMap: Map<string, number>;
  startIndex: number;
}) {
  const shownSummary = summarizeOperatorRows(rows);
  const overallSummary = summarizeOperatorRows(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的排行数据</div>;

  return (
    <div className="table-wrap operator-table-wrap">
      <table className="operator-ranking-table">
        <thead>
          <tr>
            <th className="num">排名</th>
            <th>国家</th>
            <th>平台覆盖</th>
            <th>后台账号</th>
            <th className="num">已处理总数</th>
            <th>处理占比</th>
            <th className="num">驳回总数</th>
            <th>平均处理时长</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const countryProcessed = countryProcessedMap.get(row.country) || 0;
            const processRate = countryProcessed ? row.processed / countryProcessed : (totalProcessed ? row.processed / totalProcessed : 0);
            return (
              <tr key={`rank-${row.country}-${row.account}-${index}`}>
                <td className="num">{startIndex + index + 1}</td>
                <td><span className="country-pill">{row.country}</span></td>
                <td><OperatorPlatformCell row={row} /></td>
                <td className="platform-cell">{row.account}</td>
                <td className="num">{formatNumber(row.processed)}</td>
                <td className="operator-ratio-cell"><RateBar value={processRate} /></td>
                <td className="num">{formatNumber(row.rejected)}</td>
                <td>{row.avgTime}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={4}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.processed)}</td><td>{formatPercent(totalProcessed ? shownSummary.processed / totalProcessed : 0)}</td><td className="num">{formatNumber(shownSummary.rejected)}</td><td className="muted-cell">汇总</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={4}>全部汇总</td><td className="num strong-cell">{formatNumber(overallSummary.processed)}</td><td>{formatPercent(totalProcessed ? overallSummary.processed / totalProcessed : 0)}</td><td className="num">{formatNumber(overallSummary.rejected)}</td><td className="muted-cell">汇总</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function OperatorSummaryTable({
  rows,
  totalRows = rows,
  totalProcessed,
  totalRejected,
  sortState,
  onSort,
  onOpen
}: {
  rows: OperatorSummaryRow[];
  totalRows?: OperatorSummaryRow[];
  totalProcessed: number;
  totalRejected: number;
  sortState: TableSortState;
  onSort: (key: string) => void;
  onOpen?: (row: OperatorSummaryRow) => void;
}) {
  const shownSummary = summarizeOperatorRows(rows);
  const overallSummary = summarizeOperatorRows(totalRows);
  if (!rows.length) return <div className="empty">没有匹配的操作人汇总数据</div>;

  return (
    <div className="table-wrap operator-table-wrap">
      <table className="operator-summary-table">
        <colgroup>
          <col className="op-col-country" />
          <col className="op-col-platform" />
          <col className="op-col-account" />
          <col className="op-col-num" />
          <col className="op-col-rate" />
          <col className="op-col-num" />
          <col className="op-col-rate" />
          <col className="op-col-time" />
          <col className="detail-col" />
        </colgroup>
        <thead>
          <tr>
            <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />
            <SortableTh label="平台覆盖" sortKey="platform" sortState={sortState} onSort={onSort} />
            <SortableTh label="后台账号" sortKey="account" sortState={sortState} onSort={onSort} />
            <SortableTh label="已处理总数" sortKey="processed" sortState={sortState} onSort={onSort} className="num" />
            <th>已处理占比</th>
            <SortableTh label="驳回总数" sortKey="rejected" sortState={sortState} onSort={onSort} className="num" />
            <th>驳回占比</th>
            <SortableTh label="平均处理时长" sortKey="avgTime" sortState={sortState} onSort={onSort} />
            <th className="detail-col">详情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.country}-${row.account}-${index}`}>
              <td><span className="country-pill">{row.country}</span></td>
              <td><OperatorPlatformCell row={row} /></td>
              <td className="platform-cell">{row.account}</td>
              <td className="num">{formatNumber(row.processed)}</td>
              <td className="operator-ratio-cell"><RateBar value={totalProcessed ? row.processed / totalProcessed : 0} /></td>
              <td className="num">{formatNumber(row.rejected)}</td>
              <td className="operator-ratio-cell"><RateBar value={totalRejected ? row.rejected / totalRejected : 0} reject /></td>
              <td>{row.avgTime}</td>
              <td><button className="detail-view-btn" type="button" onClick={() => onOpen?.(row)}>查看</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="summary-row page-summary-row"><td colSpan={3}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.processed)}</td><td>{formatPercent(totalProcessed ? shownSummary.processed / totalProcessed : 0)}</td><td className="num">{formatNumber(shownSummary.rejected)}</td><td>{totalRejected ? formatPercent(shownSummary.rejected / totalRejected) : '-'}</td><td className="muted-cell">汇总</td><td>-</td></tr>
          <tr className="summary-row overall-summary-row"><td colSpan={3}>全部汇总</td><td className="num strong-cell">{formatNumber(overallSummary.processed)}</td><td>{formatPercent(totalProcessed ? overallSummary.processed / totalProcessed : 0)}</td><td className="num">{formatNumber(overallSummary.rejected)}</td><td>{totalRejected ? formatPercent(overallSummary.rejected / totalRejected) : '-'}</td><td className="muted-cell">汇总</td><td>-</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function OperatorTable({
  rows,
  totalProcessed,
  totalRejected,
  sortState,
  onSort
}: {
  rows: OperatorRow[];
  totalProcessed: number;
  totalRejected: number;
  sortState: TableSortState;
  onSort: (key: string) => void;
}) {
  if (!rows.length) return <div className="empty">没有匹配的操作人数据</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortableTh label="国家" sortKey="country" sortState={sortState} onSort={onSort} />
            <SortableTh label="日期" sortKey="date" sortState={sortState} onSort={onSort} />
            <SortableTh label="平台" sortKey="platform" sortState={sortState} onSort={onSort} />
            <SortableTh label="后台账号" sortKey="account" sortState={sortState} onSort={onSort} />
            <SortableTh label="已处理" sortKey="processed" sortState={sortState} onSort={onSort} className="num" />
            <th>已处理占比</th>
            <SortableTh label="驳回" sortKey="rejected" sortState={sortState} onSort={onSort} className="num" />
            <th>驳回占比</th>
            <SortableTh label="平均处理时长" sortKey="avgTime" sortState={sortState} onSort={onSort} />
            <SortableTh label="昨日平均处理时间" sortKey="yesterdayAvgTime" sortState={sortState} onSort={onSort} />
            <SortableTh label="对比%" sortKey="comparePercent" sortState={sortState} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.country}-${row.date}-${row.platform}-${row.account}-${index}`}>
              <td><span className="country-pill">{row.country}</span></td>
              <td>{row.date}</td>
              <td className="platform-cell">{row.platform}</td>
              <td>{row.account}</td>
              <td className="num">{formatNumber(row.processed)}</td>
              <td className="operator-ratio-cell"><RateBar value={totalProcessed ? row.processed / totalProcessed : 0} /></td>
              <td className="num">{formatNumber(row.rejected)}</td>
              <td className="operator-ratio-cell"><RateBar value={totalRejected ? row.rejected / totalRejected : 0} reject /></td>
              <td>{row.avgTime}</td>
              <td>{row.yesterdayAvgTime}</td>
              <td><CompareCell value={row.comparePercent} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DateSummaryTable({
  rows,
  onOpen
}: {
  rows: AutoWithdrawRow[];
  onOpen?: (row: AutoWithdrawRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, 8);

  if (!rows.length) return <div className="empty">暂无日期汇总</div>;

  return (
    <div className="compact-table">
      {visibleRows.map((row, index) => (
        <button className="compact-row compact-row-clickable" type="button" onClick={() => onOpen?.(row)} key={`${row.country}-${row.platform}-${index}`}>
          <div>
            <div className="compact-main">{row.platform}</div>
            <div className="compact-sub">成功率 {formatPercent(row.successRate)} · 人工 {formatPercent(row.manualRate)} · 点击弹窗查看</div>
          </div>
          <strong>{formatNumber(row.total)}</strong>
        </button>
      ))}

      {rows.length > 8 && (
        <div className="compact-more-row">
          <button className="ghost-btn small" type="button" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "收起" : `查看更多（共 ${rows.length} 项）`}
          </button>
        </div>
      )}
    </div>
  );
}

function OperatorDateSummaryTable({
  rows,
  onOpen
}: {
  rows: OperatorDateSummaryRow[];
  onOpen?: (row: OperatorDateSummaryRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, 8);

  if (!rows.length) return <div className="empty">暂无按日期处理汇总</div>;

  return (
    <div className="compact-table">
      {visibleRows.map((row, index) => (
        <button className="compact-row compact-row-clickable" type="button" onClick={() => onOpen?.(row)} key={`${row.title}-${index}`}>
          <div>
            <div className="compact-main">{row.title}</div>
            <div className="compact-sub">驳回 {formatNumber(row.rejected)} · 平均 {row.avgTime} · 点击弹窗查看</div>
          </div>
          <strong>{formatNumber(row.processed)}</strong>
        </button>
      ))}

      {rows.length > 8 && (
        <div className="compact-more-row">
          <button className="ghost-btn small" type="button" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "收起" : `查看更多（共 ${rows.length} 项）`}
          </button>
        </div>
      )}
    </div>
  );
}
