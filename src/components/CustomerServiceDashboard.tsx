"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CustomerServicePayload, CustomerServiceRow } from "@/lib/types";
import { formatNumber, formatPercent } from "@/lib/format";
import { monthRangeSignature, monthlyApiUrl, rangeIncludesCurrentMonthClient } from "@/lib/monthRange";

type LoadState = "loading" | "ready" | "error";
type MainTab = "customer" | "staff";
type CustomerView = "customerDashboard" | "customerDetail" | "platformSummary" | "metricSummary" | "customerAnomaly";
type StaffView = "staffDashboard" | "staffRank" | "staffDetail" | "staffLow";
type View = CustomerView | StaffView;
type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection };

type Filters = {
  sheets: string[];
  countries: string[];
  platforms: string[];
  teams: string[];
  staff: string[];
  metrics: string[];
  startDate: string;
  endDate: string;
  keyword: string;
};

type AggregateRow = {
  id: string;
  date?: string;
  sheetName?: string;
  country: string;
  platform: string;
  team: string;
  staff: string;
  metricName: string;
  value: number;
  records: number;
  days: number;
  sheets: number;
  sourceRows: CustomerServiceRow[];
};

type PlatformMetricRow = {
  id: string;
  date: string;
  country: string;
  platform: string;
  total: number;
  success: number;
  failed: number;
  auto: number;
  manual: number;
  records: number;
  days: number;
  sourceRows: CustomerServiceRow[];
};

type LowRow = {
  id: string;
  country: string;
  platform: string;
  team: string;
  staff: string;
  metricName: string;
  lowDays: number;
  totalDays: number;
  totalValue: number;
  avgValue: number;
  dates: string;
  sourceRows: CustomerServiceRow[];
};

type DetailModal = {
  title: string;
  subtitle: string;
  rows: CustomerServiceRow[];
};

const EMPTY_FILTERS: Filters = {
  sheets: [],
  countries: [],
  platforms: [],
  teams: [],
  staff: [],
  metrics: [],
  startDate: "",
  endDate: "",
  keyword: ""
};

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
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

function matchesSelection(value: string, selected: string[]): boolean {
  if (!selected.length) return true;
  return selected.includes(value || "未填写");
}

function normalizeOption(value: string): string {
  return value || "未填写";
}

function filterLabel(values: string[], allText = "全部"): string {
  if (!values.length) return allText;
  if (values.length <= 2) return values.join("、");
  return `${values.slice(0, 2).join("、")} 等 ${values.length} 项`;
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

function safeValue(row: CustomerServiceRow): number {
  return Number.isFinite(row.metricValue) ? row.metricValue : 0;
}

function compactMetricName(value: string): string {
  return String(value || "").replace(/[\s　:_：\-\/\\（）()【】\[\]]/g, "").toLowerCase();
}

type CustomerMetricCategory = "total" | "success" | "failed" | "auto" | "manual" | "other";

function customerMetricCategory(name: string): CustomerMetricCategory {
  const h = compactMetricName(name);
  if (!h) return "other";
  if (h.includes("总客服") || h.includes("客服总") || h === "总数" || h.includes("总客服数") || h.includes("总量")) return "total";
  if (h.includes("成功") || h.includes("已成功") || h.includes("success")) return "success";
  if (h.includes("驳回") || h.includes("失败") || h.includes("拒绝") || h.includes("reject") || h.includes("fail")) return "failed";
  if (h.includes("自动客服") || h.includes("自动处理") || h === "自动" || h.includes("auto")) return "auto";
  if (h.includes("人工处理") || h.includes("人工客服") || h === "人工" || h.includes("manual")) return "manual";
  return "other";
}

function primaryCustomerRows(rows: CustomerServiceRow[]): CustomerServiceRow[] {
  const totalRows = rows.filter((row) => customerMetricCategory(row.metricName) === "total");
  return totalRows.length ? totalRows : rows;
}

function buildPlatformMetricRows(rows: CustomerServiceRow[]): PlatformMetricRow[] {
  const map = new Map<string, PlatformMetricRow>();
  for (const row of rows) {
    const date = row.date || "未填写";
    const country = row.country || "未填写";
    const platform = row.platform || "未填写";
    const key = `${date}|||${country}|||${platform}`;
    const item = map.get(key) || {
      id: key,
      date,
      country,
      platform,
      total: 0,
      success: 0,
      failed: 0,
      auto: 0,
      manual: 0,
      records: 0,
      days: 0,
      sourceRows: []
    };
    const value = safeValue(row);
    switch (customerMetricCategory(row.metricName)) {
      case "total": item.total += value; break;
      case "success": item.success += value; break;
      case "failed": item.failed += value; break;
      case "auto": item.auto += value; break;
      case "manual": item.manual += value; break;
      default: break;
    }
    item.records += 1;
    item.sourceRows.push(row);
    map.set(key, item);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    days: uniq(row.sourceRows.map((r) => r.date).filter(isIsoDate)).length || (isIsoDate(row.date) ? 1 : 0),
  }));
}

function platformMetricValue(row: PlatformMetricRow, key: string): string | number {
  switch (key) {
    case "date": return row.date;
    case "country": return row.country;
    case "platform": return row.platform;
    case "success": return row.success;
    case "failed": return row.failed;
    case "auto": return row.auto;
    case "manual": return row.manual;
    case "autoRate": return row.auto + row.manual ? row.auto / (row.auto + row.manual) : 0;
    case "manualRate": return row.auto + row.manual ? row.manual / (row.auto + row.manual) : 0;
    case "records": return row.records;
    case "total":
    default: return row.total;
  }
}

function sortPlatformMetricRows(rows: PlatformMetricRow[], sort: SortState): PlatformMetricRow[] {
  return [...rows].sort((a, b) => {
    const av = platformMetricValue(a, sort.key);
    const bv = platformMetricValue(b, sort.key);
    let result = 0;
    if (typeof av === "number" && typeof bv === "number") result = av - bv;
    else result = String(av || "").localeCompare(String(bv || ""), "zh-CN", { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
}

function summarizePlatformMetrics(rows: PlatformMetricRow[]) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const success = rows.reduce((sum, row) => sum + row.success, 0);
  const failed = rows.reduce((sum, row) => sum + row.failed, 0);
  const auto = rows.reduce((sum, row) => sum + row.auto, 0);
  const manual = rows.reduce((sum, row) => sum + row.manual, 0);
  return {
    total,
    success,
    failed,
    auto,
    manual,
    autoRate: auto + manual ? auto / (auto + manual) : 0,
    manualRate: auto + manual ? manual / (auto + manual) : 0,
    successRate: total ? success / total : 0,
    failedRate: total ? failed / total : 0,
  };
}

function aggregateRows(rows: CustomerServiceRow[], keys: Array<keyof AggregateRow>): AggregateRow[] {
  const map = new Map<string, AggregateRow>();

  for (const row of rows) {
    const key = keys.map((k) => String((row as unknown as Record<string, string | number>)[k] || "全部")).join("|||");
    const item = map.get(key) || {
      id: key,
      date: keys.includes("date") ? row.date || "未填写" : undefined,
      sheetName: keys.includes("sheetName") ? row.sheetName || "未填写" : undefined,
      country: keys.includes("country") ? row.country || "未填写" : "全部国家",
      platform: keys.includes("platform") ? row.platform || "未填写" : "全部平台",
      team: keys.includes("team") ? row.team || "未填写" : "全部团队",
      staff: keys.includes("staff") ? row.staff || "未填写" : "全部客服",
      metricName: keys.includes("metricName") ? row.metricName || "记录数" : "全部指标",
      value: 0,
      records: 0,
      days: 0,
      sheets: 0,
      sourceRows: []
    };
    item.value += safeValue(row);
    item.records += 1;
    item.sourceRows.push(row);
    map.set(key, item);
  }

  return Array.from(map.values()).map((item) => ({
    ...item,
    days: uniq(item.sourceRows.map((r) => r.date).filter(isIsoDate)).length,
    sheets: uniq(item.sourceRows.map((r) => r.sheetName)).length,
  }));
}

function sortAggregateRows(rows: AggregateRow[], sort: SortState): AggregateRow[] {
  return [...rows].sort((a, b) => {
    const av = getAggValue(a, sort.key);
    const bv = getAggValue(b, sort.key);
    let result = 0;
    if (typeof av === "number" && typeof bv === "number") result = av - bv;
    else result = String(av || "").localeCompare(String(bv || ""), "zh-CN", { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
}

function getAggValue(row: AggregateRow | LowRow, key: string): string | number {
  if ("lowDays" in row) {
    switch (key) {
      case "country": return row.country;
      case "platform": return row.platform;
      case "team": return row.team;
      case "staff": return row.staff;
      case "metricName": return row.metricName;
      case "lowDays": return row.lowDays;
      case "totalDays": return row.totalDays;
      case "totalValue": return row.totalValue;
      case "avgValue": return row.avgValue;
      default: return row.totalValue;
    }
  }
  switch (key) {
    case "date": return row.date || "";
    case "sheetName": return row.sheetName || "";
    case "country": return row.country;
    case "platform": return row.platform;
    case "team": return row.team;
    case "staff": return row.staff;
    case "metricName": return row.metricName;
    case "records": return row.records;
    case "days": return row.days;
    case "sheets": return row.sheets;
    case "avg": return row.records ? row.value / row.records : 0;
    case "value":
    default:
      return row.value;
  }
}

function sortLowRows(rows: LowRow[], sort: SortState): LowRow[] {
  return [...rows].sort((a, b) => {
    const av = getAggValue(a, sort.key);
    const bv = getAggValue(b, sort.key);
    let result = 0;
    if (typeof av === "number" && typeof bv === "number") result = av - bv;
    else result = String(av || "").localeCompare(String(bv || ""), "zh-CN", { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
}

function summarize(rows: CustomerServiceRow[]) {
  const dates = uniq(rows.map((r) => r.date).filter(isIsoDate));
  const totalValue = rows.reduce((sum, row) => sum + safeValue(row), 0);
  const staff = uniq(rows.map((r) => r.staff).map(normalizeOption));
  const platforms = uniq(rows.map((r) => r.platform).map(normalizeOption));
  return {
    records: rows.length,
    totalValue,
    avgPerDay: dates.length ? totalValue / dates.length : totalValue,
    avgPerStaff: staff.length ? totalValue / staff.length : totalValue,
    sheets: uniq(rows.map((r) => r.sheetName)).length,
    countries: uniq(rows.map((r) => r.country).map(normalizeOption)).length,
    platforms: platforms.length,
    staff: staff.length,
    teams: uniq(rows.map((r) => r.team).map(normalizeOption)).length,
    metrics: uniq(rows.map((r) => r.metricName).map(normalizeOption)).length,
    days: dates.length
  };
}

function buildLowRows(rows: CustomerServiceRow[]): LowRow[] {
  const daily = aggregateRows(rows, ["date", "country", "platform", "team", "staff", "metricName"])
    .filter((row) => isIsoDate(row.date || "") && row.staff !== "未填写" && row.staff !== "全部客服");
  const byStaff = new Map<string, AggregateRow[]>();

  for (const row of daily) {
    const key = `${row.country}|||${row.platform}|||${row.team}|||${row.staff}|||${row.metricName}`;
    const list = byStaff.get(key) || [];
    list.push(row);
    byStaff.set(key, list);
  }

  const result: LowRow[] = [];
  for (const [key, items] of Array.from(byStaff.entries())) {
    const sorted = items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const values = sorted.map((r) => r.value);
    if (!values.length) continue;
    const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
    const threshold = Math.max(1, avg * 0.45);
    const lowItems = sorted.filter((row) => row.value <= threshold);
    if (!lowItems.length) continue;
    const [country, platform, team, staff, metricName] = key.split("|||");
    result.push({
      id: key,
      country,
      platform,
      team,
      staff,
      metricName,
      lowDays: lowItems.length,
      totalDays: sorted.length,
      totalValue: sorted.reduce((sum, row) => sum + row.value, 0),
      avgValue: avg,
      dates: lowItems.map((row) => `${row.date}:${formatNumber(row.value)}`).join("、"),
      sourceRows: sorted.flatMap((row) => row.sourceRows)
    });
  }

  return result.sort((a, b) => b.lowDays - a.lowDays || a.avgValue - b.avgValue).slice(0, 500);
}

function buildAnomalies(rows: CustomerServiceRow[]): AggregateRow[] {
  const staffRows = aggregateRows(rows, ["country", "platform", "team", "staff", "metricName"])
    .filter((row) => row.staff !== "未填写" && row.value <= 1 && row.records <= 2);
  const platformRows = aggregateRows(rows, ["country", "platform", "metricName"])
    .filter((row) => row.value <= 0 && row.records >= 1);
  return [...staffRows, ...platformRows].sort((a, b) => a.value - b.value || b.records - a.records).slice(0, 200);
}

function exportCsv(filename: string, rows: CustomerServiceRow[]) {
  const allHeaders = Array.from(new Set(rows.flatMap((row) => Object.keys(row.fields))));
  const headers = ["日期", "国家", "平台", "客服", "团队", "指标", "数值", "来源页签", "来源行", ...allHeaders];
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const body = rows.map((row) => [
    row.date,
    row.country,
    row.platform,
    row.staff,
    row.team,
    row.metricName,
    row.metricValue,
    row.sheetName,
    row.sourceRow,
    ...allHeaders.map((header) => row.fields[header] || "")
  ].map(escape).join(",")).join("\n");
  const csv = `\ufeff${headers.map(escape).join(",")}\n${body}`;
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

function viewTitle(view: View): string {
  const map: Record<View, string> = {
    customerDashboard: "客服看板",
    customerDetail: "客服明细表",
    platformSummary: "国家 / 平台汇总",
    metricSummary: "指标汇总",
    customerAnomaly: "异常提醒",
    staffDashboard: "操作人看板",
    staffRank: "操作人排行榜",
    staffDetail: "操作人明细表",
    staffLow: "连续低处理观察"
  };
  return map[view];
}

function isStaffView(view: View): boolean {
  return view === "staffDashboard" || view === "staffRank" || view === "staffDetail" || view === "staffLow";
}

function renderMetricBar(value: number, max: number, sub?: string) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="rate-cell cs-rate-cell">
      <span className="bar"><span className="bar-fill" style={{ width: `${pct}%` }} /></span>
      {sub && <em>{sub}</em>}
    </div>
  );
}

export default function CustomerServiceDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  const [state, setState] = useState<LoadState>("loading");
  const [payload, setPayload] = useState<CustomerServicePayload | null>(null);
  const [error, setError] = useState("");
  const [mainTab, setMainTab] = useState<MainTab>("customer");
  const [view, setView] = useState<View>(() => "platformSummary");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ key: "value", direction: "desc" });
  const [detailModal, setDetailModal] = useState<DetailModal | null>(null);
  const loadedMonthSignatureRef = useRef("");

  async function loadData(silent = false, requestedStart = "", requestedEnd = "") {
    if (!silent) setState("loading");
    setError("");
    try {
      const requestUrl = monthlyApiUrl("/api/customer-service", requestedStart, requestedEnd);
      const res = await fetch(requestUrl, { cache: "default" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "读取客服统计失败");
      setPayload(json);
      loadedMonthSignatureRef.current = monthRangeSignature(requestedStart, requestedEnd);
      setState("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "读取客服统计失败";
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
    void loadData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const requestedSignature = monthRangeSignature(filters.startDate, filters.endDate);
    if (payload && loadedMonthSignatureRef.current !== requestedSignature) {
      void loadData(true, filters.startDate, filters.endDate);
    }
    const hourlyTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && rangeIncludesCurrentMonthClient(filters.startDate, filters.endDate)) {
        void loadData(true, filters.startDate, filters.endDate);
      }
    }, 60 * 60 * 1000);
    return () => window.clearInterval(hourlyTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.startDate, filters.endDate]);

  const allRows = payload?.rows || [];
  const dates = useMemo(() => uniq(allRows.map((r) => r.date).filter(isIsoDate)), [allRows]);

  useEffect(() => {
    if (!dates.length) return;
    const first = dates[0];
    const last = dates[dates.length - 1];
    setFilters((prev) => prev.startDate || prev.endDate ? prev : { ...prev, startDate: first, endDate: last });
    setDraftFilters((prev) => prev.startDate || prev.endDate ? prev : { ...prev, startDate: first, endDate: last });
  }, [dates]);

  const sheets = useMemo(() => uniq(allRows.map((r) => normalizeOption(r.sheetName))), [allRows]);
  const countries = useMemo(() => uniq(allRows.filter((r) => matchesSelection(normalizeOption(r.sheetName), draftFilters.sheets)).map((r) => normalizeOption(r.country))), [allRows, draftFilters.sheets]);
  const platforms = useMemo(() => uniq(allRows.filter((r) => matchesSelection(normalizeOption(r.sheetName), draftFilters.sheets)).filter((r) => matchesSelection(normalizeOption(r.country), draftFilters.countries)).map((r) => normalizeOption(r.platform))), [allRows, draftFilters.sheets, draftFilters.countries]);
  const teams = useMemo(() => uniq(allRows.filter((r) => matchesSelection(normalizeOption(r.country), draftFilters.countries)).filter((r) => matchesSelection(normalizeOption(r.platform), draftFilters.platforms)).map((r) => normalizeOption(r.team))), [allRows, draftFilters.countries, draftFilters.platforms]);
  const staffOptions = useMemo(() => uniq(allRows.filter((r) => matchesSelection(normalizeOption(r.country), draftFilters.countries)).filter((r) => matchesSelection(normalizeOption(r.platform), draftFilters.platforms)).filter((r) => matchesSelection(normalizeOption(r.team), draftFilters.teams)).map((r) => normalizeOption(r.staff))), [allRows, draftFilters.countries, draftFilters.platforms, draftFilters.teams]);
  const metricOptions = useMemo(() => uniq(allRows.map((r) => normalizeOption(r.metricName))), [allRows]);

  const filteredRows = useMemo(() => {
    const keyword = filters.keyword.trim().toLowerCase();
    return allRows.filter((row) => {
      const sheetName = normalizeOption(row.sheetName);
      const country = normalizeOption(row.country);
      const platform = normalizeOption(row.platform);
      const team = normalizeOption(row.team);
      const staff = normalizeOption(row.staff);
      const metricName = normalizeOption(row.metricName);
      if (!matchesSelection(sheetName, filters.sheets)) return false;
      if (!matchesSelection(country, filters.countries)) return false;
      if (!matchesSelection(platform, filters.platforms)) return false;
      if (!matchesSelection(team, filters.teams)) return false;
      if (!matchesSelection(staff, filters.staff)) return false;
      if (!matchesSelection(metricName, filters.metrics)) return false;
      if (!inDateRange(row.date, filters.startDate, filters.endDate)) return false;
      if (keyword) {
        const text = `${row.sheetName} ${row.date} ${row.country} ${row.platform} ${row.staff} ${row.team} ${row.metricName} ${row.rawText} ${Object.values(row.fields).join(" ")}`.toLowerCase();
        if (!text.includes(keyword)) return false;
      }
      return true;
    });
  }, [allRows, filters]);

  const summary = useMemo(() => summarize(filteredRows), [filteredRows]);
  const staffRows = useMemo(() => sortAggregateRows(aggregateRows(filteredRows, ["country", "platform", "team", "staff"]), sort), [filteredRows, sort]);
  const staffMetricRows = useMemo(() => sortAggregateRows(aggregateRows(filteredRows, ["country", "platform", "team", "staff", "metricName"]), sort), [filteredRows, sort]);
  const customerPlatformRows = useMemo(() => sortPlatformMetricRows(buildPlatformMetricRows(filteredRows), sort), [filteredRows, sort]);
  const customerMetricTotals = useMemo(() => summarizePlatformMetrics(customerPlatformRows), [customerPlatformRows]);
  const platformRows = useMemo(() => sortAggregateRows(aggregateRows(primaryCustomerRows(filteredRows), ["country", "platform"]), sort), [filteredRows, sort]);
  const metricRows = useMemo(() => sortAggregateRows(aggregateRows(filteredRows, ["metricName"]), sort), [filteredRows, sort]);
  const countryRows = useMemo(() => sortAggregateRows(aggregateRows(primaryCustomerRows(filteredRows), ["country"]), sort), [filteredRows, sort]);
  const detailRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      const av = getDetailValue(a, sort.key);
      const bv = getDetailValue(b, sort.key);
      let result = 0;
      if (typeof av === "number" && typeof bv === "number") result = av - bv;
      else result = String(av || "").localeCompare(String(bv || ""), "zh-CN", { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? result : -result;
    });
    return sorted;
  }, [filteredRows, sort]);
  const lowRows = useMemo(() => sortLowRows(buildLowRows(filteredRows), sort), [filteredRows, sort]);
  const anomalyRows = useMemo(() => sortAggregateRows(buildAnomalies(filteredRows), sort), [filteredRows, sort]);

  const currentRows: Array<AggregateRow | CustomerServiceRow | LowRow | PlatformMetricRow> = view === "customerDetail" || view === "staffDetail"
    ? detailRows
    : view === "platformSummary"
      ? customerPlatformRows
      : view === "metricSummary"
        ? metricRows
        : view === "customerAnomaly"
          ? anomalyRows
          : view === "staffLow"
            ? lowRows
            : view === "staffRank"
              ? staffMetricRows
              : [];

  const totalPages = pageCount(currentRows.length, pageSize);
  const visibleRows = paginateRows(currentRows, page, pageSize);

  useEffect(() => { setPage(1); }, [view, filters, pageSize, sort]);

  function updateDraft<K extends keyof Filters>(key: K, value: Filters[K]) {
    setDraftFilters((prev) => ({ ...prev, [key]: value }));
  }

  function applyFilters() {
    setFilters({ ...draftFilters });
    setPage(1);
  }

  function resetFilters() {
    const first = dates[0] || "";
    const last = dates[dates.length - 1] || "";
    const next = { ...EMPTY_FILTERS, startDate: first, endDate: last };
    setFilters(next);
    setDraftFilters(next);
    setPage(1);
  }


  function formatDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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
      start.setDate(1);
      if (mode === "lastMonth") {
        start.setMonth(start.getMonth() - 1);
        end.setDate(0);
      } else {
        end.setMonth(start.getMonth() + 1, 0);
      }
    }
    const next = { ...draftFilters, startDate: formatDateKey(start), endDate: formatDateKey(end) };
    setDraftFilters(next);
    setFilters(next);
    setPage(1);
  }


  function shiftDateRange(days: number) {
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

  function switchMain(tab: MainTab) {
    setMainTab(tab);
    setView(tab === "customer" ? "platformSummary" : "staffDashboard");
    setSort({ key: "value", direction: "desc" });
    setPage(1);
  }

  function switchView(next: View) {
    setView(next);
    setSort({ key: next === "customerDetail" || next === "staffDetail" ? "date" : "value", direction: "desc" });
    setPage(1);
  }

  function selectCustomerCountry(country: string) {
    const next: Filters = {
      ...filters,
      countries: country ? [country] : [],
      platforms: [],
      teams: [],
      staff: [],
      metrics: []
    };
    setMainTab("customer");
    setView("platformSummary");
    setFilters(next);
    setDraftFilters(next);
    setSort({ key: "value", direction: "desc" });
    setPage(1);
  }

  function toggleSort(key: string) {
    setSort((prev) => ({ key, direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc" }));
  }

  if (state === "loading") return <div className="loading inner-loading">正在读取客服统计...</div>;
  if (state === "error") {
    return (
      <div className="error-box inner-error">
        <h2>客服统计读取失败</h2>
        <p>{error}</p>
        <p className="muted-text">请确认 Netlify 已添加 CUSTOMER_SERVICE_SHEET_ID，并且这个 Google Sheet 已分享给 Service Account。</p>
        
      </div>
    );
  }
  if (!payload) return null;

  return (
    <div className="customer-service-module">
      {!embedded && <div className="topbar">
        <div className="title">
          <h1>客服统计</h1>
          <p>当前位置：Hensem数据后台 &gt; 客服统计 &gt; {isStaffView(view) ? "操作人统计" : "客服统计"} &gt; {viewTitle(view)}</p>
        </div>
        <div className="status-box">
          <div className="status-line"><span>数据月份</span><strong>{payload.meta.year} 年 {payload.meta.month} 月</strong></div>
          <div className="status-line"><span>数据来源</span><strong>Google Sheet</strong></div>
          <div className="status-line"><span>读取页签</span><strong>{payload.meta.sheets.length} 个</strong></div>
          <div className="status-line"><span>更新时间</span><strong>{new Date(String((payload.meta as any).snapshotUpdatedAt || payload.meta.updatedAt)).toLocaleString("zh-CN")}</strong></div>
        </div>
      </div>}

      {!embedded && <section className="module-switch work-main-switch">
        <button className={mainTab === "customer" ? "module-tab active" : "module-tab"} onClick={() => switchMain("customer")}>客服统计</button>
        <button className={mainTab === "staff" ? "module-tab active" : "module-tab"} onClick={() => switchMain("staff")}>操作人统计</button>
      </section>}

      <section className="child-switch work-child-switch">
        {mainTab === "customer" ? (
          <>
            <button className={view === "platformSummary" && !filters.countries.length ? "child-tab active" : "child-tab"} onClick={() => selectCustomerCountry("")}>全部盘口</button>
            {countries.map((item) => (
              <button key={item} className={view === "platformSummary" && filters.countries.length === 1 && filters.countries[0] === item ? "child-tab active" : "child-tab"} onClick={() => selectCustomerCountry(item)}>{item}盘口</button>
            ))}
            <button className={view === "customerDetail" ? "child-tab active" : "child-tab"} onClick={() => switchView("customerDetail")}>客服明细</button>
            <button className={view === "customerAnomaly" ? "child-tab active" : "child-tab"} onClick={() => switchView("customerAnomaly")}>异常提醒</button>
          </>
        ) : (
          <>
            <button className={view === "staffDashboard" ? "child-tab active" : "child-tab"} onClick={() => switchView("staffDashboard")}>操作人看板</button>
            <button className={view === "staffRank" ? "child-tab active" : "child-tab"} onClick={() => switchView("staffRank")}>操作人排行榜</button>
            <button className={view === "staffDetail" ? "child-tab active" : "child-tab"} onClick={() => switchView("staffDetail")}>操作人明细表</button>
            <button className={view === "staffLow" ? "child-tab active" : "child-tab"} onClick={() => switchView("staffLow")}>连续低处理观察</button>
          </>
        )}
      </section>

      <section className="filter-card">
        <div className="filters filters-v3 cs-filters">
          <div className="field"><label>开始日期</label><input className="input" type="date" value={draftFilters.startDate} onChange={(e) => updateDraft("startDate", e.target.value)} /></div>
          <div className="field"><label>结束日期</label><input className="input" type="date" value={draftFilters.endDate} onChange={(e) => updateDraft("endDate", e.target.value)} /></div>
          <CSMultiSelect label="页签" options={sheets} value={draftFilters.sheets} onChange={(value) => updateDraft("sheets", value)} placeholder="全部页签" />
          <CSMultiSelect label="国家" options={countries} value={draftFilters.countries} onChange={(value) => updateDraft("countries", value)} placeholder="全部国家" />
          <CSMultiSelect label="平台" options={platforms} value={draftFilters.platforms} onChange={(value) => updateDraft("platforms", value)} placeholder="全部平台" />
          <CSMultiSelect label="团队/岗位" options={teams} value={draftFilters.teams} onChange={(value) => updateDraft("teams", value)} placeholder="全部团队" />
          <CSMultiSelect label="客服/操作人" options={staffOptions} value={draftFilters.staff} onChange={(value) => updateDraft("staff", value)} placeholder="全部客服" />
          <CSMultiSelect label="指标" options={metricOptions} value={draftFilters.metrics} onChange={(value) => updateDraft("metrics", value)} placeholder="全部指标" />
          <div className="field"><label>关键词</label><input className="input" value={draftFilters.keyword} onChange={(e) => updateDraft("keyword", e.target.value)} placeholder="搜索客服 / 平台 / 指标 / 内容" /></div>
          <div className="action-row"><button className="primary-btn" onClick={applyFilters}>查询</button><button className="ghost-btn" onClick={resetFilters}>重置</button><button className="ghost-btn" type="button" onClick={() => shiftDateRange(-1)}>上一日</button><button className="ghost-btn" type="button" onClick={() => shiftDateRange(1)}>下一日</button><button className="ghost-btn" onClick={() => exportCsv("customer-service.csv", filteredRows)}>导出</button></div>
        </div>
        <div className="selected-row">
          <span>已选条件：</span>
          <b>页签：{filterLabel(filters.sheets, "全部")}</b>
          <b>国家：{filterLabel(filters.countries, "全部")}</b>
          <b>平台：{filterLabel(filters.platforms, "全部")}</b>
          <b>团队：{filterLabel(filters.teams, "全部")}</b>
          <b>客服：{filterLabel(filters.staff, "全部")}</b>
          <b>指标：{filterLabel(filters.metrics, "全部")}</b>
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
        <div className="selected-row">
          <span>当前结果：</span>
          <span className="page-size-control">每页 <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{[20, 50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}</select></span>
          <b>明细 {formatNumber(filteredRows.length)} 行</b>
          <b>指标 {summary.metrics} 个</b>
          <b>客服 {summary.staff} 人</b>
        </div>
      </section>

      {(view === "customerDashboard" || view === "staffDashboard") && (
        <section className="metrics">
          <MetricCard label="客服总数" value={formatNumber(customerMetricTotals.total)} sub={`成功 ${formatNumber(customerMetricTotals.success)} · 驳回 ${formatNumber(customerMetricTotals.failed)}`} />
          <MetricCard label="成功 / 驳回率" value={`${formatPercent(customerMetricTotals.successRate)} / ${formatPercent(customerMetricTotals.failedRate)}`} sub="按总客服数计算" />
          <MetricCard label="自动客服" value={formatNumber(customerMetricTotals.auto)} sub={`自动占比 ${formatPercent(customerMetricTotals.autoRate)}`} />
          <MetricCard label="人工处理" value={formatNumber(customerMetricTotals.manual)} sub={`人工占比 ${formatPercent(customerMetricTotals.manualRate)}`} />
          <MetricCard label="国家 / 平台" value={`${summary.countries} / ${summary.platforms}`} sub="按当前筛选范围统计" />
          <MetricCard label="明细记录" value={formatNumber(summary.records)} sub={`读取页签 ${summary.sheets} 个 · 指标 ${summary.metrics} 个`} />
        </section>
      )}

      {view === "customerDashboard" && (
        <>
          <section className="grid-two">
            <RankingPanel title="指标排行" subtitle="按当前筛选范围汇总，方便看主要客服指标" rows={metricRows.slice(0, 8)} max={metricRows[0]?.value || 0} onMore={() => switchView("metricSummary")} onOpen={(row) => setDetailModal({ title: `${row.metricName} 明细`, subtitle: `共 ${formatNumber(row.sourceRows.length)} 条来源记录`, rows: row.sourceRows })} />
            <RankingPanel title="平台客服量排行" subtitle="按国家 / 平台汇总指标值" rows={platformRows.slice(0, 8)} max={platformRows[0]?.value || 0} onMore={() => switchView("platformSummary")} onOpen={(row) => setDetailModal({ title: `${row.country} ${row.platform} 客服明细`, subtitle: `共 ${formatNumber(row.sourceRows.length)} 条来源记录`, rows: row.sourceRows })} />
          </section>
          <section className="grid-two">
            <RankingPanel title="客服处理排行" subtitle="按客服账号汇总指标值" rows={staffRows.slice(0, 8)} max={staffRows[0]?.value || 0} onMore={() => { switchMain("staff"); switchView("staffRank"); }} onOpen={(row) => setDetailModal({ title: `${row.staff} 客服明细`, subtitle: `${row.country} · ${row.platform} · ${row.team}`, rows: row.sourceRows })} />
            <RankingPanel title="国家分布" subtitle="各国家客服统计占比" rows={countryRows.slice(0, 8)} max={countryRows[0]?.value || 0} onMore={() => switchView("platformSummary")} onOpen={(row) => setDetailModal({ title: `${row.country} 客服明细`, subtitle: `共 ${formatNumber(row.sourceRows.length)} 条来源记录`, rows: row.sourceRows })} />
          </section>
        </>
      )}

      {view === "staffDashboard" && (
        <>
          <section className="grid-two">
            <RankingPanel title="操作人处理排行" subtitle="按客服 / 操作人汇总指标值" rows={staffRows.slice(0, 8)} max={staffRows[0]?.value || 0} onMore={() => switchView("staffRank")} onOpen={(row) => setDetailModal({ title: `${row.staff} 操作人明细`, subtitle: `${row.country} · ${row.platform} · ${row.team}`, rows: row.sourceRows })} />
            <RankingPanel title="处理最少排行" subtitle="当前筛选范围内指标值从少到多" rows={[...staffRows].reverse().slice(0, 8)} max={staffRows[0]?.value || 0} onMore={() => switchView("staffRank")} onOpen={(row) => setDetailModal({ title: `${row.staff} 操作人明细`, subtitle: `${row.country} · ${row.platform} · ${row.team}`, rows: row.sourceRows })} />
          </section>
          <section className="grid-two">
            <LowPanel rows={lowRows.slice(0, 8)} onMore={() => switchView("staffLow")} onOpen={(row) => setDetailModal({ title: `${row.staff} 连续低处理`, subtitle: `${row.country} · ${row.platform} · ${row.metricName}`, rows: row.sourceRows })} />
            <AnomalyPanel rows={anomalyRows.slice(0, 8)} onMore={() => switchView("customerAnomaly")} onOpen={(row) => setDetailModal({ title: `${row.staff || row.platform} 异常明细`, subtitle: `${row.country} · ${row.platform} · ${row.metricName}`, rows: row.sourceRows })} />
          </section>
        </>
      )}

      {view !== "customerDashboard" && view !== "staffDashboard" && (
        <>
          <section className="metrics work-metrics compact-sub-metrics">
            <MetricCard label="当前明细" value={formatNumber(summary.records)} sub={`指标总值 ${formatNumber(summary.totalValue)}`} />
            <MetricCard label="日均 / 人均" value={`${formatNumber(summary.avgPerDay)} / ${formatNumber(summary.avgPerStaff)}`} sub="按当前筛选范围" />
            <MetricCard label="国家 / 平台" value={`${summary.countries} / ${summary.platforms}`} sub={`客服 ${summary.staff} 人`} />
            <MetricCard label="指标类型" value={formatNumber(summary.metrics)} sub={`页签 ${summary.sheets} 个`} />
          </section>
          <section className="panel">
            <div className="panel-header">
              <div><div className="panel-title">{viewTitle(view)}</div><div className="panel-subtitle">点击表头可切换顺序 / 逆序，点击查看可以弹窗显示来源明细。</div></div>
            </div>
            <Pagination total={currentRows.length} page={page} pageSize={pageSize} setPage={setPage} setPageSize={setPageSize} />
            <div className="table-wrap">
              {view === "customerDetail" || view === "staffDetail" ? (
                <DetailTable rows={visibleRows as CustomerServiceRow[]} totalRows={currentRows as CustomerServiceRow[]} sort={sort} toggleSort={toggleSort} open={(row) => setDetailModal({ title: `${row.staff || row.platform || row.metricName} 原始明细`, subtitle: `${row.sheetName} 第 ${row.sourceRow} 行`, rows: [row] })} />
              ) : view === "platformSummary" ? (
                <PlatformMetricTable rows={visibleRows as PlatformMetricRow[]} totalRows={currentRows as PlatformMetricRow[]} sort={sort} toggleSort={toggleSort} open={(row) => setDetailModal({ title: `${row.country} ${row.platform} 客服日表`, subtitle: `${row.date} · 来源 ${formatNumber(row.records)} 条指标`, rows: row.sourceRows })} />
              ) : view === "staffLow" ? (
                <LowTable rows={visibleRows as LowRow[]} totalRows={currentRows as LowRow[]} sort={sort} toggleSort={toggleSort} max={lowRows[0]?.totalValue || 0} open={(row) => setDetailModal({ title: `${row.staff} 连续低处理明细`, subtitle: `${row.country} · ${row.platform} · ${row.metricName}`, rows: row.sourceRows })} />
              ) : (
                <AggregateTable rows={visibleRows as AggregateRow[]} totalRows={currentRows as AggregateRow[]} view={view} sort={sort} toggleSort={toggleSort} max={(currentRows[0] as AggregateRow | undefined)?.value || 0} open={(row) => setDetailModal({ title: `${row.staff || row.platform || row.metricName} 明细`, subtitle: `${row.country} · ${row.platform} · ${row.metricName}`, rows: row.sourceRows })} />
              )}
            </div>
          </section>
        </>
      )}

      {detailModal && <DetailModalView modal={detailModal} close={() => setDetailModal(null)} />}
    </div>
  );
}

function getDetailValue(row: CustomerServiceRow, key: string): string | number {
  switch (key) {
    case "date": return row.date;
    case "sheetName": return row.sheetName;
    case "country": return row.country;
    case "platform": return row.platform;
    case "team": return row.team;
    case "staff": return row.staff;
    case "metricName": return row.metricName;
    case "metricValue": return row.metricValue;
    case "sourceRow": return row.sourceRow;
    default: return row.metricValue;
  }
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return <div className="metric-card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-sub">{sub}</div></div>;
}

function RankingPanel({ title, subtitle, rows, max, onMore, onOpen }: { title: string; subtitle: string; rows: AggregateRow[]; max: number; onMore: () => void; onOpen: (row: AggregateRow) => void }) {
  return (
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">{subtitle}</div></div><button className="ghost-btn small" onClick={onMore}>查看更多</button></div>
      <div className="bar-chart-list">
        {rows.map((row) => (
          <button className="compact-row-clickable" key={row.id} onClick={() => onOpen(row)}>
            <div className="chart-row-top"><span>{row.country} {row.platform !== "全部平台" ? row.platform : ""} {row.staff !== "全部客服" ? row.staff : row.metricName}</span><strong>{formatNumber(row.value)}</strong></div>
            {renderMetricBar(row.value, max, `${formatNumber(row.records)} 条 · ${row.days || 0} 天`)}
          </button>
        ))}
        {!rows.length && <div className="small-empty muted-text">暂无数据</div>}
      </div>
    </section>
  );
}

function LowPanel({ rows, onMore, onOpen }: { rows: LowRow[]; onMore: () => void; onOpen: (row: LowRow) => void }) {
  return (
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">连续低处理观察</div><div className="panel-subtitle">按日期观察低于平均值 45% 的客服 / 指标。</div></div><button className="ghost-btn small" onClick={onMore}>查看更多</button></div>
      <div className="compact-table">
        {rows.map((row, index) => (
          <button className="compact-row compact-row-clickable" key={row.id} onClick={() => onOpen(row)}>
            <span className="rank-no">{index + 1}</span><div><div className="compact-main">{row.staff}</div><div className="compact-sub">{row.country} · {row.platform} · 命中 {row.lowDays}/{row.totalDays} 天 · {row.metricName}</div></div><strong>{formatNumber(row.avgValue)}</strong>
          </button>
        ))}
        {!rows.length && <div className="small-empty muted-text">暂无连续低处理数据</div>}
      </div>
    </section>
  );
}

function AnomalyPanel({ rows, onMore, onOpen }: { rows: AggregateRow[]; onMore: () => void; onOpen: (row: AggregateRow) => void }) {
  return (
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">异常提醒</div><div className="panel-subtitle">当前筛选范围内，指标过低或记录异常的项目。</div></div><button className="ghost-btn small" onClick={onMore}>查看更多</button></div>
      <div className="compact-table">
        {rows.map((row, index) => (
          <button className="compact-row compact-row-clickable" key={row.id} onClick={() => onOpen(row)}>
            <span className="alert-dot" /><div><div className="compact-main">{row.country} {row.platform} {row.staff}</div><div className="compact-sub">{row.metricName}：{formatNumber(row.value)} · 来源 {row.records} 行</div></div><strong>{index + 1}</strong>
          </button>
        ))}
        {!rows.length && <div className="small-empty muted-text">暂无异常提醒</div>}
      </div>
    </section>
  );
}

function SortButton({ label, column, sort, onClick }: { label: string; column: string; sort: SortState; onClick: (key: string) => void }) {
  return <button className="th-sort" type="button" onClick={() => onClick(column)}><span>{label}</span><span>{sort.key === column ? (sort.direction === "desc" ? "↓" : "↑") : "↕"}</span></button>;
}



function summarizePlatformMetricRows(rows: PlatformMetricRow[]) {
  return rows.reduce((acc, row) => {
    acc.total += row.total || 0;
    acc.success += row.success || 0;
    acc.failed += row.failed || 0;
    acc.auto += row.auto || 0;
    acc.manual += row.manual || 0;
    return acc;
  }, { total: 0, success: 0, failed: 0, auto: 0, manual: 0 });
}

function summarizeAggregateRows(rows: AggregateRow[]) {
  return rows.reduce((acc, row) => {
    acc.value += row.value || 0;
    acc.records += row.records || 0;
    acc.days += row.days || 0;
    return acc;
  }, { value: 0, records: 0, days: 0 });
}

function summarizeLowRows(rows: LowRow[]) {
  return rows.reduce((acc, row) => {
    acc.lowDays += row.lowDays || 0;
    acc.totalDays += row.totalDays || 0;
    acc.totalValue += row.totalValue || 0;
    return acc;
  }, { lowDays: 0, totalDays: 0, totalValue: 0 });
}

function summarizeDetailRows(rows: CustomerServiceRow[]) {
  return rows.reduce((acc, row) => {
    acc.metricValue += row.metricValue || 0;
    return acc;
  }, { metricValue: 0 });
}

function PlatformMetricTable({ rows, totalRows = rows, sort, toggleSort, open }: { rows: PlatformMetricRow[]; totalRows?: PlatformMetricRow[]; sort: SortState; toggleSort: (key: string) => void; open: (row: PlatformMetricRow) => void }) {
  const shownSummary = summarizePlatformMetricRows(rows);
  const allSummary = summarizePlatformMetricRows(totalRows);
  const totalAll = rows.reduce((sum, row) => sum + row.total, 0);
  return (
    <table className="cs-platform-table">
      <thead><tr>
        <th><SortButton label="日期" column="date" sort={sort} onClick={toggleSort} /></th>
        <th><SortButton label="国家" column="country" sort={sort} onClick={toggleSort} /></th>
        <th><SortButton label="平台" column="platform" sort={sort} onClick={toggleSort} /></th>
        <th className="num"><SortButton label="总客服数" column="total" sort={sort} onClick={toggleSort} /></th>
        <th className="num"><SortButton label="成功" column="success" sort={sort} onClick={toggleSort} /></th>
        <th className="num"><SortButton label="驳回" column="failed" sort={sort} onClick={toggleSort} /></th>
        <th className="num"><SortButton label="自动客服数" column="auto" sort={sort} onClick={toggleSort} /></th>
        <th className="num"><SortButton label="人工处理" column="manual" sort={sort} onClick={toggleSort} /></th>
        <th>自动占比</th>
        <th>人工占比</th>
        <th>总占比</th>
        <th>详情</th>
      </tr></thead>
      <tbody>
        {rows.map((row) => {
          const autoTotal = row.auto + row.manual;
          return (
            <tr key={row.id}>
              <td>{row.date}</td>
              <td><span className="country-pill">{row.country}</span></td>
              <td className="platform-cell">{row.platform}</td>
              <td className="num"><b>{formatNumber(row.total)}</b></td>
              <td className="num">{formatNumber(row.success)}</td>
              <td className="num">{formatNumber(row.failed)}</td>
              <td className="num">{formatNumber(row.auto)}</td>
              <td className="num">{formatNumber(row.manual)}</td>
              <td>{renderMetricBar(autoTotal ? row.auto / autoTotal : 0, 1, formatPercent(autoTotal ? row.auto / autoTotal : 0))}</td>
              <td>{renderMetricBar(autoTotal ? row.manual / autoTotal : 0, 1, formatPercent(autoTotal ? row.manual / autoTotal : 0))}</td>
              <td>{renderMetricBar(totalAll ? row.total / totalAll : 0, 1, formatPercent(totalAll ? row.total / totalAll : 0))}</td>
              <td><button className="ghost-btn small" onClick={() => open(row)}>查看</button></td>
            </tr>
          );
        })}
        {!rows.length && <tr><td colSpan={12} className="empty-cell">暂无客服日表数据</td></tr>}
      </tbody>
      <tfoot>
        <tr className="summary-row page-summary-row"><td colSpan={3}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.total)}</td><td className="num">{formatNumber(shownSummary.success)}</td><td className="num">{formatNumber(shownSummary.failed)}</td><td className="num">{formatNumber(shownSummary.auto)}</td><td className="num">{formatNumber(shownSummary.manual)}</td><td>{shownSummary.auto + shownSummary.manual ? formatPercent(shownSummary.auto / (shownSummary.auto + shownSummary.manual)) : '-'}</td><td>{shownSummary.auto + shownSummary.manual ? formatPercent(shownSummary.manual / (shownSummary.auto + shownSummary.manual)) : '-'}</td><td>100.00%</td><td className="muted-cell">汇总</td></tr>
        <tr className="summary-row overall-summary-row"><td colSpan={3}>全部汇总</td><td className="num strong-cell">{formatNumber(allSummary.total)}</td><td className="num">{formatNumber(allSummary.success)}</td><td className="num">{formatNumber(allSummary.failed)}</td><td className="num">{formatNumber(allSummary.auto)}</td><td className="num">{formatNumber(allSummary.manual)}</td><td>{allSummary.auto + allSummary.manual ? formatPercent(allSummary.auto / (allSummary.auto + allSummary.manual)) : '-'}</td><td>{allSummary.auto + allSummary.manual ? formatPercent(allSummary.manual / (allSummary.auto + allSummary.manual)) : '-'}</td><td>100.00%</td><td className="muted-cell">汇总</td></tr>
      </tfoot>
    </table>
  );
}

function AggregateTable({ rows, totalRows = rows, view, sort, toggleSort, max, open }: { rows: AggregateRow[]; totalRows?: AggregateRow[]; view: View; sort: SortState; toggleSort: (key: string) => void; max: number; open: (row: AggregateRow) => void }) {
  const shownSummary = summarizeAggregateRows(rows);
  const allSummary = summarizeAggregateRows(totalRows);
  return (
    <table>
      <thead><tr>
        {view !== "metricSummary" && <th><SortButton label="国家" column="country" sort={sort} onClick={toggleSort} /></th>}
        {view !== "metricSummary" && <th><SortButton label="平台" column="platform" sort={sort} onClick={toggleSort} /></th>}
        {view === "staffRank" && <th><SortButton label="团队" column="team" sort={sort} onClick={toggleSort} /></th>}
        {view === "staffRank" && <th><SortButton label="客服/操作人" column="staff" sort={sort} onClick={toggleSort} /></th>}
        <th><SortButton label="指标" column="metricName" sort={sort} onClick={toggleSort} /></th>
        <th className="num"><SortButton label="指标值" column="value" sort={sort} onClick={toggleSort} /></th>
        <th className="num"><SortButton label="来源行" column="records" sort={sort} onClick={toggleSort} /></th>
        <th className="num"><SortButton label="统计天数" column="days" sort={sort} onClick={toggleSort} /></th>
        <th>占比</th><th>详情</th>
      </tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            {view !== "metricSummary" && <td><span className="country-pill">{row.country}</span></td>}
            {view !== "metricSummary" && <td className="platform-cell">{row.platform}</td>}
            {view === "staffRank" && <td>{row.team}</td>}
            {view === "staffRank" && <td className="platform-cell">{row.staff}</td>}
            <td>{row.metricName}</td>
            <td className="num"><b>{formatNumber(row.value)}</b></td>
            <td className="num">{formatNumber(row.records)}</td>
            <td className="num">{formatNumber(row.days)}</td>
            <td>{renderMetricBar(row.value, max, max ? formatPercent(row.value / max) : "0.00%")}</td>
            <td><button className="ghost-btn small" onClick={() => open(row)}>查看</button></td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={10} className="empty-cell">暂无数据</td></tr>}
      </tbody>
      <tfoot>
        <tr className="summary-row page-summary-row">{view !== "metricSummary" && <td colSpan={view === "staffRank" ? 5 : 3}>当前页汇总</td>}{view === "metricSummary" && <td>当前页汇总</td>}<td className="num strong-cell">{formatNumber(shownSummary.value)}</td><td className="num">{formatNumber(shownSummary.records)}</td><td className="num">{formatNumber(shownSummary.days)}</td><td>-</td><td className="muted-cell">汇总</td></tr>
        <tr className="summary-row overall-summary-row">{view !== "metricSummary" && <td colSpan={view === "staffRank" ? 5 : 3}>全部汇总</td>}{view === "metricSummary" && <td>全部汇总</td>}<td className="num strong-cell">{formatNumber(allSummary.value)}</td><td className="num">{formatNumber(allSummary.records)}</td><td className="num">{formatNumber(allSummary.days)}</td><td>-</td><td className="muted-cell">汇总</td></tr>
      </tfoot>
    </table>
  );
}

function LowTable({ rows, totalRows = rows, sort, toggleSort, max, open }: { rows: LowRow[]; totalRows?: LowRow[]; sort: SortState; toggleSort: (key: string) => void; max: number; open: (row: LowRow) => void }) {
  const shownSummary = summarizeLowRows(rows);
  const allSummary = summarizeLowRows(totalRows);
  return (
    <table>
      <thead><tr><th><SortButton label="国家" column="country" sort={sort} onClick={toggleSort} /></th><th><SortButton label="平台" column="platform" sort={sort} onClick={toggleSort} /></th><th><SortButton label="团队" column="team" sort={sort} onClick={toggleSort} /></th><th><SortButton label="客服" column="staff" sort={sort} onClick={toggleSort} /></th><th><SortButton label="指标" column="metricName" sort={sort} onClick={toggleSort} /></th><th className="num"><SortButton label="命中天数" column="lowDays" sort={sort} onClick={toggleSort} /></th><th className="num"><SortButton label="统计天数" column="totalDays" sort={sort} onClick={toggleSort} /></th><th className="num"><SortButton label="总值" column="totalValue" sort={sort} onClick={toggleSort} /></th><th>趋势</th><th>详情</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td><span className="country-pill">{row.country}</span></td><td className="platform-cell">{row.platform}</td><td>{row.team}</td><td className="platform-cell">{row.staff}</td><td>{row.metricName}</td><td className="num">{row.lowDays}</td><td className="num">{row.totalDays}</td><td className="num"><b>{formatNumber(row.totalValue)}</b></td><td>{renderMetricBar(row.totalValue, max, row.dates)}</td><td><button className="ghost-btn small" onClick={() => open(row)}>查看</button></td></tr>)}{!rows.length && <tr><td colSpan={10} className="empty-cell">暂无数据</td></tr>}</tbody>
      <tfoot><tr className="summary-row page-summary-row"><td colSpan={5}>当前页汇总</td><td className="num">{shownSummary.lowDays}</td><td className="num">{shownSummary.totalDays}</td><td className="num strong-cell">{formatNumber(shownSummary.totalValue)}</td><td>-</td><td className="muted-cell">汇总</td></tr><tr className="summary-row overall-summary-row"><td colSpan={5}>全部汇总</td><td className="num">{allSummary.lowDays}</td><td className="num">{allSummary.totalDays}</td><td className="num strong-cell">{formatNumber(allSummary.totalValue)}</td><td>-</td><td className="muted-cell">汇总</td></tr></tfoot>
    </table>
  );
}

function DetailTable({ rows, totalRows = rows, sort, toggleSort, open }: { rows: CustomerServiceRow[]; totalRows?: CustomerServiceRow[]; sort: SortState; toggleSort: (key: string) => void; open: (row: CustomerServiceRow) => void }) {
  const shownSummary = summarizeDetailRows(rows);
  const allSummary = summarizeDetailRows(totalRows);
  return (
    <table>
      <thead><tr><th><SortButton label="日期" column="date" sort={sort} onClick={toggleSort} /></th><th><SortButton label="国家" column="country" sort={sort} onClick={toggleSort} /></th><th><SortButton label="平台" column="platform" sort={sort} onClick={toggleSort} /></th><th><SortButton label="团队" column="team" sort={sort} onClick={toggleSort} /></th><th><SortButton label="客服/操作人" column="staff" sort={sort} onClick={toggleSort} /></th><th><SortButton label="指标" column="metricName" sort={sort} onClick={toggleSort} /></th><th className="num"><SortButton label="数值" column="metricValue" sort={sort} onClick={toggleSort} /></th><th>来源页签</th><th className="num">来源行</th><th>详情</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td>{row.date || "-"}</td><td><span className="country-pill">{row.country || "未填写"}</span></td><td className="platform-cell">{row.platform || "未填写"}</td><td>{row.team || "-"}</td><td className="platform-cell">{row.staff || "未填写"}</td><td>{row.metricName}</td><td className="num"><b>{formatNumber(row.metricValue)}</b></td><td>{row.sheetName}</td><td className="num">{row.sourceRow}</td><td><button className="ghost-btn small" onClick={() => open(row)}>查看</button></td></tr>)}{!rows.length && <tr><td colSpan={10} className="empty-cell">暂无数据</td></tr>}</tbody>
      <tfoot><tr className="summary-row page-summary-row"><td colSpan={6}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.metricValue)}</td><td>-</td><td>-</td><td className="muted-cell">汇总</td></tr><tr className="summary-row overall-summary-row"><td colSpan={6}>全部汇总</td><td className="num strong-cell">{formatNumber(allSummary.metricValue)}</td><td>-</td><td>-</td><td className="muted-cell">汇总</td></tr></tfoot>
    </table>
  );
}

function Pagination({ total, page, pageSize, setPage, setPageSize }: { total: number; page: number; pageSize: number; setPage: (page: number) => void; setPageSize: (size: number) => void }) {
  const totalPages = pageCount(total, pageSize);
  return (
    <div className="pagination-row"><div className="pagination-info">显示 {total ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, total)} / 共 {formatNumber(total)} 行</div><div className="pagination-actions"><span className="page-size-control">每页 <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{[20, 50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}</select></span><button className="ghost-btn small" disabled={page <= 1} onClick={() => setPage(1)}>首页</button><button className="ghost-btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><b>{page} / {totalPages}</b><button className="ghost-btn small" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button><button className="ghost-btn small" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
  );
}

function DetailModalView({ modal, close }: { modal: DetailModal; close: () => void }) {
  const rows = modal.rows.slice(0, 500);
  const allFields = Array.from(new Set(rows.flatMap((row) => Object.keys(row.fields))));
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-card rate-detail-modal cs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div><h2>{modal.title}</h2><p>{modal.subtitle}，弹窗查看不会改变当前筛选。</p></div><button className="ghost-btn small" onClick={close}>关闭</button></div>
        <div className="modal-summary-grid"><div className="compare-card"><span>来源记录</span><strong>{formatNumber(modal.rows.length)}</strong><p>最多显示前 500 条</p></div><div className="compare-card"><span>指标总值</span><strong>{formatNumber(modal.rows.reduce((sum, row) => sum + safeValue(row), 0))}</strong><p>按当前弹窗明细汇总</p></div><div className="compare-card"><span>字段数量</span><strong>{allFields.length}</strong><p>来自原始 Google Sheet</p></div></div>
        <div className="table-wrap modal-table-wrap"><table><thead><tr><th>日期</th><th>国家</th><th>平台</th><th>客服</th><th>团队</th><th>指标</th><th className="num">数值</th><th>来源</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.date || "-"}</td><td>{row.country || "-"}</td><td className="platform-cell">{row.platform || "-"}</td><td className="platform-cell">{row.staff || "-"}</td><td>{row.team || "-"}</td><td>{row.metricName}</td><td className="num"><b>{formatNumber(row.metricValue)}</b></td><td>{row.sheetName} #{row.sourceRow}</td></tr>)}</tbody></table></div>
        <div className="modal-section-title">原始字段</div>
        <div className="rate-detail-grid">{allFields.slice(0, 80).map((field) => <div className="rate-detail-cell" key={field}><span>{field}</span><strong>{uniq(rows.map((row) => row.fields[field]).filter(Boolean)).slice(0, 8).join("、") || "-"}</strong></div>)}</div>
      </div>
    </div>
  );
}

function CSMultiSelect({ label, options, value, onChange, placeholder }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const visible = useMemo(() => options.filter((item) => !keyword.trim() || item.toLowerCase().includes(keyword.trim().toLowerCase())), [options, keyword]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle(item: string) {
    onChange(value.includes(item) ? value.filter((x) => x !== item) : [...value, item]);
  }

  return (
    <div className="field multi-field rate-multi-field" ref={ref}>
      <label>{label}</label>
      <button className="multi-button" type="button" onClick={() => setOpen((x) => !x)}><span>{value.length ? filterLabel(value, placeholder) : placeholder}</span><span className="multi-caret">▾</span></button>
      {open && <div className="multi-menu rate-multi-menu"><input className="multi-search" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={`搜索${label}`} /><div className="multi-actions"><button type="button" onClick={() => onChange(uniq([...value, ...visible]))}>全选当前</button><button type="button" onClick={() => { onChange([]); setKeyword(""); }}>清空</button><button type="button" onClick={() => setOpen(false)}>完成</button></div><div className="multi-list">{visible.map((item) => <label className="multi-option" key={item}><input type="checkbox" checked={value.includes(item)} onChange={() => toggle(item)} /><span>{item}</span></label>)}{!visible.length && <div className="multi-empty">没有匹配选项</div>}</div><div className="multi-footer">已选 {value.length} 项，点击“查询”后刷新</div></div>}
    </div>
  );
}
